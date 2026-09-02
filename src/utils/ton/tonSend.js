// W5 transfer kurma ve gonderme.
//
// Tekrar koruma seqno ile: ayni seqno ile iki islem gonderilirse biri sessizce duser.
// Bu yuzden gonderim sonrasi seqno DEGISENE KADAR izlenir ve bekleyen islem varken
// ikinci gonderime izin verilmez (cagiran taraf).
//
// bounce DAIMA false: bounceable adrese giden para, hedef cuzdan henuz zincirde
// YOKSA geri seker ve kullanici "gonderdim ama ulasmadi" durumunda kalir.

import { internal } from '@ton/ton'
import { toNano, SendMode } from '@ton/core'
import { normalizeTonRecipient } from './tonAddress'
import { tonWalletContract } from './tonAccount'

// Onay ekraninda gosterilen IHTIYATLI ag ucreti payi. Canli teklif DEGIL:
// imzali govde (BOC) onay aninda henuz yok (anahtar background'da). Duz bir TON
// transferi pratikte bunun cok altinda kalir; MAX hesabinda da bu pay ayrilir.
export const TON_FEE_RESERVE = 0.01

const SEND_MODE = SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS

/**
 * Miktar + ucret payi bakiyeye SIGIYOR MU. `setMax`in ayirdigi AYNI TON_FEE_RESERVE
 * sabitini kullanir; baska bir sabit/oran kullanilsaydi MAX ile Send/ConfirmTransaction
 * dogrulamasi arasinda TUTARSIZ iki esik olusurdu (biri gecer, digeri geciremez).
 *
 * ESKI kontrol (Send.vue) yalniz `amount > balance` diyordu — UCRETI HIC HESABA
 * KATMIYORDU. Tum bakiyeyi yazan kullanicida (amount === balance) bu ESKI kontrol
 * GECIYORDU: gonderim modu PAY_GAS_SEPARATELY | IGNORE_ERRORS oldugu icin zincirde
 * compute fazi calisir (seqno ARTAR), action fazi ucreti karsilayamaz, mesaj
 * SESSIZCE duser — aliciya hicbir sey gitmez, ucret yanar, ama waitForSeqno seqno
 * degistigini gorup gonderimi "basarili" isaretler (bkz. sendTon/waitForSeqno).
 *
 * `<=` BILEREK: amount + reserve tam bakiyeye ESIT olsa da gonderim ucretin
 * TAMAMINI karsilar; sinir DEGERI degil, SIGMAMA durumunu reddediyoruz.
 */
export function tonSendAmountFits({ amount, balance, reserve = TON_FEE_RESERVE }) {
    const numAmount = Number(amount)
    const numBalance = Number(balance)
    if (!Number.isFinite(numAmount) || !Number.isFinite(numBalance)) return false
    return numAmount + reserve <= numBalance
}

/**
 * Kuyruk disinda seqno izlemek icin ayni cuzdani yeniden kurar.
 *
 * `tonAccount.js`teki TEK W5 fabrikasini (`tonWalletContract`) kullanir — bu
 * `sendTon`in actigi sozlesmeyle (openWallet asagida) AYNI kurulumdur. Iki ayri
 * `WalletContractV5R1.create(...)` cagrisi zamanla birbirinden SAPARSA (or. biri
 * degisip digeri unutulursa), waitForSeqno sendTon'un actigi sozlesmeyi DEGIL
 * baska bir adresi izler ve gonderilen islem sonsuza dek "beklemede" gorunur.
 */
export function walletFromKeyPair(keyPair, testnet = false) {
    return tonWalletContract(keyPair.publicKey, { testnet })
}

function openWallet(client, publicKey, testnet) {
    return client.open(tonWalletContract(publicKey, { testnet }))
}

export function buildTonTransfer({ to, amount, comment, testnet = false }) {
    const recipient = normalizeTonRecipient(to, { testnet })

    const numeric = Number(amount)
    if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('TON_AMOUNT_INVALID')

    const note = typeof comment === 'string' ? comment.trim() : ''

    // DIKKAT: String(amount) ile ZORLAMA YAPMA. Kucuk sayisal degerlerde (or.
    // 0.000000001) String() ustel gosterime ("1e-9") duser ve toNano'nun dize
    // ayristirici dali "Cannot convert 1e-9 to a BigInt" ile patlar. toNano
    // number/string ikisini de KENDISI dogru isler; amount oldugu gibi verilir.
    let value
    try {
        value = toNano(amount)
    } catch {
        // toNano bazi girdilerde (ustel gosterim, 9 ondaliktan fazla basamak, vb.)
        // KENDI ham hatasini firlatir (or. "Cannot convert 1e-9 to a BigInt",
        // "Invalid number"). Bu hatalar cagirana SIZMAMALI — hata sozlesmemiz
        // TEK bicimdir: TON_AMOUNT_INVALID.
        throw new Error('TON_AMOUNT_INVALID')
    }

    // DONUSUMDEN SONRA sifir kontrolu ZORUNLU. `numeric > 0` kontrolu YUKARIDA
    // GECER (or. 0.0000000004 sifirdan buyuktur) ama nanoton'a (9 ondalik basamak)
    // yuvarlanirken 0n'a duser. Bu deger sendTon'a verilirse zincirde GERCEK bir
    // sifir-degerli islem kurulur: gaz yakilir, aliciya HICBIR SEY gitmez — ve kod
    // tarafinda hic hata firlamadigi icin gonderim "basarili" gorunur. Kullanici
    // parasinin (aslinda sadece ucretinin) nereye gittigini SESSIZCE kaybeder.
    if (value <= 0n) throw new Error('TON_AMOUNT_INVALID')

    return {
        to: recipient,
        value,
        // Bos yorum govdeye GIRMEZ: bos hucre bosuna ucret ekler.
        body: note || undefined,
        bounce: false,
    }
}

export async function sendTon({ client, keyPair, to, amount, comment, testnet = false }) {
    // Alici/miktar dogrulamasi ZINCIRE CIKMADAN ONCE: gecersiz girdide seqno bile okunmaz.
    const transfer = buildTonTransfer({ to, amount, comment, testnet })

    const contract = openWallet(client, keyPair.publicKey, testnet)
    const seqno = await contract.getSeqno()

    // Cuzdan henuz zincirde degilse ilk transfer stateInit'i kendisi tasir (@ton/ton).
    await contract.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        sendMode: SEND_MODE,
        messages: [internal(transfer)],
    })

    return { seqno, address: contract.address.toString({ bounceable: false, testOnly: testnet }) }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * seqno degisimini bekler.
 * `false` "islem basarisiz" DEMEK DEGILDIR — yalnizca "sure icinde dogrulanamadi".
 * Cagiran taraf bunu basarisizlik olarak gostermemeli.
 */
export async function waitForSeqno({ contract, previous, attempts = 30, delayMs = 1500, sleep = defaultSleep }) {
    for (let i = 0; i < attempts; i++) {
        try {
            const current = await contract.getSeqno()
            if (current !== previous) return true
        } catch {
            // Gecici proxy/ag hatasi denemeyi bitirmez: islem zincire gitmis olabilir.
        }
        await sleep(delayMs)
    }
    return false
}

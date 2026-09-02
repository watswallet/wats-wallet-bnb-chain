// Jetton gonderimi: DORT KAPI, sonra imza.
//
// Ucret sabitleri GOREV 10'da OLCULDU
// (docs/superpowers/notes/2026-08-24-jetton-ucret-olcumu.md). Uydurulmadi.
// Plan testnet'te elle olcum ongormustu; fonlu testnet cuzdani olmadigi icin
// olcum mainnet'teki 120 gercek jetton transferinin trace'inden yapildi
// (DEX kirliligi ayiklanarak 80 temiz basit transfer).
//
// P1'deki TON_FEE_RESERVE karari surduruluyor: muhafazakar SABIT, dinamik hesap
// degil - orada 0.01, gercek ucreti (~0.005) bilerek fazla tahmin ediyordu ve
// dogru cikti.
//
// BU DOSYA IMZALAMADAN ONCEKI SON KAPIDIR. Kapilardan biri sessizce gecerse
// zincire cikan islem GERI ALINAMAZ.
import { internal, JettonWallet } from '@ton/ton'
import { Address, toNano, SendMode } from '@ton/core'
import { normalizeTonRecipient } from './tonAddress'
import { getJettonWalletAddress } from './jettonAddress'
import { getJettonBalance } from './jettonBalance'
import { buildJettonTransferBody } from './jettonTransfer'
import { hasPendingTonTx } from './tonPending'

// ILISTIRILEN TON. Fazlasi response_destination'a IADE EDILIR - olculen 80
// transferin 80'inde de iade mesaji (0xd53276db excesses) vardi. Yani comert
// secmenin kalici maliyeti yok, yalnizca islem suresince kisa bir kilitlenme.
//
// 0.05 ekosistemin fiili modudur (olculen dagilimda p10 = medyan = 0.05; ham
// mesaj orneginde 12'de 7 tam olarak bu deger). Bizim gonderecegimiz sekle
// birebir uyan dagitimli vaka yalnizca 0.0026 TON tuketmisti - 19 kat pay.
export const JETTON_ATTACH_TON = 0.05

// FORWARD TUTARI ASLA SIFIR OLAMAZ: sifirsa transfer_notification mesaji hic
// olusmaz ve icindeki yorum/memo TESLIM EDILMEZ; borsalar yatirimi memo ile
// eslestirdigi icin memo gitmezse para borsada KAYIP sayilir.
//
// 1 nanoton olculen degerdir: yorumlu transferlerin 24/27'si bunu kullaniyor,
// Gorev 2'nin altin vektorlerinin TAMAMI da oyle, ve olculen 52 vakanin
// 52'sinde de bildirim mesaji OLUSTU.
//
// BILINEN SINIR (kabul edildi): 1 nanoton bildirimi OLUSTURUR ama alicinin ona
// KARSILIK KOD CALISTIRMASINA yetmez (olculen 52 vakanin hepsinde bildirim
// isleminin compute fazi no_gas ile dustu). Bu ayrim onemli - dusen sey mesaj
// degil, alicinin kodu:
//   - Siradan cuzdan alicisi: calisacak kodu zaten yok, yorum zincirde duruyor.
//   - Borsa yatirim adresi: borsalar yatirimi INDEKSLEYEREK esler, kod
//     calistirarak degil. Yorum zincirde oldugu icin eslesir - spec'in
//     korumak istedigi durum budur ve korunuyor.
//   - Kod calistiran sozlesme alicisi (DEX havuzu): yetmez, kapsam disi.
// 0.05'e cikarmak her gonderimde kullanicidan KALICI olarak ~0.05 TON almak
// demektir (forward tutari IADE EDILMEZ, aliciya gecer) - ekosistem
// varsayilaninin 50 milyon kati, ve yalnizca kapsam disi bir alici tipi icin.
export const JETTON_FORWARD_TON = 0.000000001

const SEND_MODE = SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS

// Sozlesme SEVIYESINDE "bu get metodu yok" demek olan hatalar. Bunlar cevaptir:
// adres bir jetton cuzdani DEGIL. Bu listeye UYMAYAN her hata AG/TASIMA hatasi
// sayilir ve kapi sessizce gecirilmez (bkz. isJettonWallet).
const CONTRACT_LEVEL_ERROR = /exit_code|exit code|method|unable to execute|terminating vm|cannot run get/i

/**
 * Adres bir JETTON CUZDANI mi?
 *
 * K1: TEP-74'te `destination` ALICININ SAHIP adresidir, jetton cuzdani DEGIL.
 * Ikisi de ayni UQ.../EQ... biciminde gorunur ve GOZLE AYIRT EDILEMEZ. Jetton
 * cuzdanina gonderilen token pratikte kaybolur: o sozlesme kendisine gelen
 * transfer mesajini beklemiyor, iade de etmiyor.
 *
 * PLANIN TASARIMI BURADA KUSURLUYDU ve duzeltildi. Plan "getBalance cozulurse
 * true" diyordu. Ama kutuphane kaynagi bunu yanliliyor
 * (node_modules/@ton/ton/dist/jetton/JettonWallet.js:18-25):
 *     let state = await provider.getState();
 *     if (state.state.type !== "active") { return 0n; }   // HATA ATMADAN
 * Yani hesap dagitilmamissa getBalance HATA ATMAZ, sessizce 0n doner - ve plan
 * tasarimi ZINCIRDE HENUZ OLMAYAN HER ADRESI "jetton cuzdani" sayardi. Bu
 * adresler en yaygin mesru alici tipidir (hic TON almamis yeni bir kullanici):
 * kapi, kullaniciyi korumak yerine yeni birine jetton gondermeyi KALICI OLARAK
 * imkansiz kilardi. Ayni sinif hata (kutuphanenin gercek davranisini okumadan
 * varsaymak) bu planda daha once Gorev 5'te de cikmisti.
 *
 * Dogrusu: once hesap durumu okunur. Dagitilmamis/donmus hesap jetton cuzdani
 * OLAMAZ - jetton cuzdani bakiye tasidigi icin zaten aktiftir.
 *
 * AG HATASI "jetton cuzdani degil" DEMEK DEGILDIR. Sessizce false donmek,
 * proxy dustugu anda bu kapiyi tamamen devre disi birakirdi - yani kapinin
 * varlik sebebi olan tek durumda calismamasi. Bu yuzden ayirt edilemeyen hata
 * gonderimi DURDURUR.
 */
export async function isJettonWallet({ client, address }) {
    const parsed = Address.parse(address)

    let state
    try {
        state = await client.getContractState(parsed)
    } catch {
        throw new Error('JETTON_RECIPIENT_CHECK_FAILED')
    }

    if (state?.state !== 'active') return false

    try {
        await client.open(JettonWallet.create(parsed)).getBalance()
        return true
    } catch (error) {
        if (CONTRACT_LEVEL_ERROR.test(error?.message || '')) return false
        throw new Error('JETTON_RECIPIENT_CHECK_FAILED')
    }
}

/**
 * IKI AYRI bakiye tek kapida. Jettonu olup gaz icin TON'u olmayan kullanici COK
 * YAYGIN: jetton gonderimi jetton'un KENDISINDEN hicbir sey harcamaz ama TON
 * harcar. Tek bir "yetersiz bakiye" mesaji hangi bakiyenin eksik oldugunu
 * gizler ve kullanici jetton bakiyesine bakip "ama param var" der.
 *
 * `<=` BILEREK (tonSendAmountFits ile ayni karar): tam esitlik gonderimi
 * karsilar; sinir DEGERI degil, SIGMAMA durumunu reddediyoruz.
 */
export function jettonSendFits({ jettonAmount, jettonBalance, tonBalance, attach = JETTON_ATTACH_TON }) {
    const amount = Number(jettonAmount)
    const jetton = Number(jettonBalance)
    const ton = Number(tonBalance)
    const need = Number(attach)
    if (![amount, jetton, ton, need].every(Number.isFinite)) return false
    if (amount <= 0) return false
    return amount <= jetton && need <= ton
}

/**
 * Jetton gonderir. DORT KAPI SIRAYLA; hepsi gecmeden buildJettonTransferBody
 * cagrilmaz ve hicbir sey imzalanmaz.
 *
 * `wallet` ZATEN ACILMIS (client.open) gonderen W5 sozlesmesidir - cagiran taraf
 * anahtari elinde tuttugu icin onu kurar. Boylece bu dosya gizli anahtari HIC
 * gormez.
 */
export async function sendJetton({
    client, wallet, keyPair, to, amount, master, decimals, comment,
    owner, chainId, storage, pendingTransactions, testnet = false,
}) {
    // Ondalik en basta: yanlis/eksik ondalik gonderilen miktari 1000 kat yanlis
    // yapar (USDT-TON 6 kullanir, TON'un kendisi 9). jettonTransfer.js'in kendi
    // kapisi da var - katmanli savunma, biri digerinin yerine GECMEZ.
    if (!Number.isInteger(decimals)) throw new Error('JETTON_DECIMALS_MISSING')

    // --- KAPI 1: adres gecerli VE alici bir jetton cuzdani DEGIL (K1) ---------
    const recipient = normalizeTonRecipient(to, { testnet })
    if (await isJettonWallet({ client, address: recipient })) {
        throw new Error('JETTON_RECIPIENT_IS_JETTON_WALLET')
    }

    // --- KAPI 2: jetton bakiyesi yeterli -------------------------------------
    const myJettonWallet = await getJettonWalletAddress({ client, owner, master, chainId, storage })
    const jettonBalance = await getJettonBalance({ client, walletAddress: myJettonWallet, decimals })

    // --- KAPI 3: TON bakiyesi yeterli ---------------------------------------
    const tonBalance = Number(await client.getBalance(Address.parse(owner))) / 1e9

    // Kapi 2 ve 3 TEK fonksiyondan (jettonSendFits) gecer - arayuz de AYNI
    // fonksiyonu kullanir, boylece "Gonder dugmesi acildi ama gonderim reddedildi"
    // ayrisimi olusamaz. Ama HATA ANAHTARLARI AYRI olmak zorunda: jettonu olup
    // gaz icin TON'u olmayan kullanici COK YAYGIN ve tek bir "yetersiz bakiye"
    // mesaji hangi bakiyenin eksik oldugunu gizler - kullanici jetton bakiyesine
    // bakip "ama param var" der. Bu yuzden birlesik kapi once calisir, ayrimi
    // yalnizca MESAJ icin ondan sonra yapariz.
    if (!jettonSendFits({ jettonAmount: amount, jettonBalance, tonBalance })) {
        if (!(Number(amount) <= Number(jettonBalance))) throw new Error('JETTON_INSUFFICIENT_BALANCE')
        throw new Error('JETTON_INSUFFICIENT_TON')
    }

    // --- KAPI 4: bekleyen TON islemi yok ------------------------------------
    // TON'da tekrar koruma seqno ile calisir: ayni seqno ile gonderilen ikinci
    // islem SESSIZCE duser. Kullanici "gitmedi" sanip tekrar gonderirse ilk
    // islem sonradan onaylanabilir ve deger IKI KEZ gitmis olur. Bu kapi
    // native TON yolundakiyle AYNI (background.js:sendTonInternal).
    if (hasPendingTonTx(pendingTransactions)) throw new Error('TON_TX_ALREADY_PENDING')

    // --- Dort kapi de gecti: govde kurulur ve imzalanir ----------------------
    const body = buildJettonTransferBody({
        amount,
        decimals,
        // destination ALICININ SAHIP adresidir: alicinin jetton cuzdanini
        // alicinin kendi jetton master'i turetir, biz turetmeyiz.
        destination: recipient,
        // Fazla iliştirilen TON BURAYA iade edilir. Gonderenin kendi sahip
        // adresi olmali; baska bir adres yazilirsa kullanicinin parasi her
        // gonderimde baskasina gider.
        responseDestination: owner,
        forwardTon: JETTON_FORWARD_TON,
        comment,
    })

    const seqno = await wallet.getSeqno()

    await wallet.sendTransfer({
        seqno,
        secretKey: keyPair?.secretKey,
        sendMode: SEND_MODE,
        messages: [internal({
            // Mesaj GONDERENIN KENDI jetton cuzdanina gider, aliciya DEGIL.
            to: myJettonWallet,
            value: toNano(JETTON_ATTACH_TON),
            body,
            // bounce = TRUE, native TON'daki `false` ile CELISMEZ - farkli
            // hedefler: native TON alicinin SAHIP cuzdanina gider ve o cuzdan
            // henuz zincirde olmayabilir (bounceable gonderim parayi geri
            // sektirir). Jetton transferi GONDERENIN KENDI jetton cuzdanina
            // gider; gonderenin o jettondan bakiyesi oldugu icin o sozlesme
            // KESIN dagitilmistir. Burada false secilirse sozlesme transferi
            // reddettiginde (bozuk govde, yaris halinde dusen bakiye)
            // iliştirilen TON geri DONMEZ, yanar. Olculen 12 gercek mesajin
            // 11'i bounce=true.
            bounce: true,
        })],
    })

    return { seqno, jettonWallet: myJettonWallet }
}

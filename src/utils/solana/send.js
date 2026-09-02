import './bufferGlobal.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { solanaRpc } from './client'
import { toPublicKey, isWalletAddress } from './address'
import { SOL_NATIVE_MARKER } from './constants'

// Bir token hesabinin kira muafiyeti icin gereken alan (SPL Token hesabi = 165 bayt).
const TOKEN_ACCOUNT_SIZE = 165
// Bos bir sistem hesabinin kira muafiyeti icin gereken alan.
const SYSTEM_ACCOUNT_SIZE = 0

/**
 * RPC'den donen lamport degerini GERCEK, SONLU bir number'a cevirir.
 *
 * buildTransferPlan (maxSendableSol ve ATA-kira kontrolu) artik yalnizca
 * gercek `typeof x === 'number'` degerleri kabul ediyor — numaralik dizgeler
 * DAHIL degil. Deger ONCEDEN Number()'a ZORLANMAZ: Number(null) === 0 ve
 * Number('') === 0'dir, yani `typeof value === 'number' ? value : Number(value)`
 * null/''/false gibi degerleri GECERLI (sonlu, negatif olmayan) bir sayiya
 * cevirip SESSIZCE kabul ederdi -- tam olarak buildTransferPlan.js'nin
 * isValidLamportNumber icin kapatmaya calistigi delik burada yeniden acilirdi
 * (rent=null -> rentExemptLamports=0 -> maxSendableSol tum bakiyeyi onerir ->
 * hesap kira muafiyeti altina duser ve silinir). Deger DAHA BASTAN
 * `typeof === 'number'` DEGILSE, ACIKCA reddedilir; hicbir cevrim denenmez.
 */
function toFiniteLamports(value, errorCode) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(errorCode)
    }
    return value
}

/**
 * Transfer plani icin gereken ZINCIR DURUMU.
 *
 * buildTransferPlan saf oldugu icin bu degerleri disaridan alir. Toplama isi
 * burada, tek yerde: iki ekranin ayri ayri sorgulamasi, birinin eksik
 * sorgulamasi demekti.
 */
export async function prepareTransferContext({ from, to, mint }) {
    const [latest, rentExemptRaw] = await Promise.all([
        solanaRpc('getLatestBlockhash', [{ commitment: 'confirmed' }]),
        solanaRpc('getMinimumBalanceForRentExemption', [SYSTEM_ACCOUNT_SIZE]),
    ])

    const blockhash = latest?.value?.blockhash
    if (!blockhash) throw new Error('BLOCKHASH_UNAVAILABLE')

    const rentExemptLamports = toFiniteLamports(rentExemptRaw, 'RENT_EXEMPTION_UNAVAILABLE')

    // Temel ucret: imza basina 5000 lamport. Faz 1'de tek imzali islem
    // uretiliyor; oncelik ucreti (priority fee) eklenmiyor.
    const feeLamports = 5000

    if (mint === SOL_NATIVE_MARKER) {
        return {
            blockhash, feeLamports, rentExemptLamports,
            recipientAtaExists: true, ataRentLamports: 0
        }
    }

    // Alici bir CUZDAN adresi (egri uzerinde) olmali. getAssociatedTokenAddressSync
    // asagida AYNI kontrolu kendi icinde zaten yapar ama argumansiz bir
    // TokenOwnerOffCurveError firlatir (message === '') -- bu da sinir otesine
    // FALSY bir hata olarak sizar. buildTransferPlan da bu kontrolu yapiyor
    // ama ATA turetmesinden SONRA cagriliyor: SPL yolunda hic calisma sansi
    // olmuyordu. Ayni tanidik hata koduyla burada, ATA turetmesinden ONCE.
    if (!isWalletAddress(to)) throw new Error('RECIPIENT_NOT_WALLET')

    const toAta = getAssociatedTokenAddressSync(toPublicKey(mint), toPublicKey(to))
    const [info, ataRentRaw] = await Promise.all([
        solanaRpc('getAccountInfo', [toAta.toBase58(), { encoding: 'base64' }]),
        solanaRpc('getMinimumBalanceForRentExemption', [TOKEN_ACCOUNT_SIZE]),
    ])

    const recipientAtaExists = info?.value !== null && info?.value !== undefined

    // ATA zaten varsa kira ODENMEZ; 0 dondurmek onay ekraninda yanlis bir ek
    // maliyet satiri cikmasini onler. ATA YOKSA rakam GERCEK ve POZITIF olmali —
    // buildTransferPlan ATA_RENT_REQUIRED firlatarak zaten bunu zorluyor, ama
    // RPC'den beklenmedik bir bicim gelirse (dizge/null/NaN) hatayi burada,
    // daha acik bir kodla (ATA_RENT_UNAVAILABLE) yakalamak, cagirana
    // buildTransferPlan'in genel ATA_RENT_REQUIRED'inden daha net bir teshis verir.
    const ataRentLamports = recipientAtaExists ? 0 : toFiniteLamports(ataRentRaw, 'ATA_RENT_UNAVAILABLE')

    return {
        blockhash, feeLamports, rentExemptLamports,
        recipientAtaExists,
        ataRentLamports,
    }
}

/**
 * Imzali islemi yayinlar ve imzayi doner.
 *
 * `skipPreflight: false` BILEREK: preflight, yetersiz bakiye veya yanlis ATA
 * gibi sessiz basarisizliklari YAYINDAN ONCE yakalar. Atlanirsa islem zincire
 * gider, dususe gecer ve kullanici ucreti odemis olur.
 */
export async function broadcastSignedTransaction(base64Transaction) {
    return await solanaRpc('sendTransaction', [
        base64Transaction,
        { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }
    ])
}

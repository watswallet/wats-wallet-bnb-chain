// Islem kartinin hata satiri icin KOD -> i18n ANAHTARI tablosu.
//
// KOK NEDEN: background.js islem kaydina ham INGILIZCE cumleler yaziyordu
// ('Transaction failed on-chain', 'Insufficient balance.', ...) ve
// TransactionStatus.vue onlari oldugu gibi basiyordu. Turkce arayuzde kullanici
// basarisiz isleminin sebebini INGILIZCE okuyordu; ingilizce arayuzde ise TON
// kolundan gelen TURKCE cumleleri (TON_SEND_ERROR_MESSAGES) goruyordu. Yani her
// iki dilde de yanlis dil cikabiliyordu.
//
// SOZLESME solana/sendErrors.js ile AYNI: arka plan KOD yazar, ekran cevirir.
// Bilinmeyen bir kod ekranda HAM cikmaz -- resolveTxError jenerik anahtara duser,
// cunku kullaniciya "SWAP_USEROP_FAILED" yazan kirmizi bir satir gostermek, hicbir
// sey gostermemekten daha kotudur.
//
// CEVRILEMEYEN hata metinleri buraya GIRMEZ: ethers/SDK istisnalarinin metni
// (`error.message`) hicbir sozluge sigmaz. Arka plan onlari `meta.error` alaninda
// HAM birakir ve ekran yedek olarak oldugu gibi basar -- yanlis dilde ama DOGRU
// bilgi, jenerik bir cumleden daha faydalidir.

import { TON_SEND_ERRORS, isKnownTonSendError } from './ton/tonSendErrors'
import { TON_SWAP_ERRORS, isKnownTonSwapError } from './ton/tonSwapErrors'

const K = (name) => `transactionStatus.errors.${name}`

export const TX_ERRORS = {
    // Zincire ulasti, zincirde dustu. Ucret YANDI - kullanicinin bilmesi gereken
    // sey bu, o yuzden "gonderilemedi" DEMEZ.
    ONCHAIN_FAILED: K('onchainFailed'),
    // Zincire hic yazilmadi ya da mempool'dan dusuruldu: ucret YOK, tekrar denemek
    // guvenli. ONCHAIN_FAILED ile AYNI anahtari paylasmamasinin sebebi budur.
    TX_DROPPED: K('dropped'),

    // ATS/UserOp kolu. Uc ayri cagri yerinin AYNI anahtara dusmesi bilincli:
    // kullanici acisindan ucu de "ag bu islemi onaylamadi"dir; hangi paketleyicinin
    // hangi asamada dustugu teshis bilgisidir ve console'da kalir.
    USEROP_FAILED: K('userOpFailed'),
    SWAP_USEROP_FAILED: K('userOpFailed'),
    BRIDGE_USEROP_FAILED: K('userOpFailed'),

    SWAP_FAILED: K('swapFailed'),
    SWAP_EXECUTION_FAILED: K('swapFailed'),
    BRIDGE_FAILED: K('bridgeFailed'),
    BRIDGE_EXECUTION_FAILED: K('bridgeFailed'),

    // Bakiye dallari AYRI anahtarlar: kullanicinin atacagi ADIM farkli. Ag ucreti
    // eksikse native token lazim, token bakiyesi eksikse gonderilen tutar dusmeli.
    INSUFFICIENT_NATIVE: K('insufficientNative'),
    INSUFFICIENT_BALANCE: K('insufficientBalance'),
    INSUFFICIENT_TOKEN_BALANCE: K('insufficientTokenBalance'),

    // TEK interpolasyonlu anahtar. Ham `shortMessage`/`argument` metnin PARCASI
    // olmak ZORUNDA: "Gecersiz islem parametresi." tek basina HANGI cagrinin HANGI
    // argumanindan geldigini soylemez ve kullanicidan gelen tek kanit o metindir
    // (background.js'teki cagri yerinin bas yorumu ayni gerekceyi anlatiyor).
    INVALID_PARAMETER: K('invalidParameter'),
}

/**
 * Koddan i18n anahtarina. Bilinmeyen/bos kod jenerik anahtara duser - ekrana
 * ASLA ham kod cikmaz.
 */
export function resolveTxError(code) {
    if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(TX_ERRORS, code)) {
        return TX_ERRORS[code]
    }
    // TON kollari KENDI kod kumesini yaziyor (utils/ton/tonSendErrors.js) ve AYNI
    // karta dusuyor. Iki tabloyu birlestirmek yerine buradan devrediliyor: TON
    // kodlari gonderim ekranlarinda da (TonSendTx, TonConnectApprove, TonSignData)
    // cozuluyor, yani tablonun sahibi kart DEGIL.
    if (isKnownTonSendError(code)) return TON_SEND_ERRORS[code]
    // TAKAS kodlari da AYRI bir tabloda (utils/ton/tonSwapErrors.js): gonderim
    // sozlugune karistirilmiyorlar, cunku oradaki tamlik taramasi yalnizca
    // gonderim yolunu kapsiyor.
    if (isKnownTonSwapError(code)) return TON_SWAP_ERRORS[code]
    return K('generic')
}

// SCREAMING_SNAKE: en az bir alt cizgi ZORUNLU. Tek kelimelik bir BUYUK HARF
// dizisi ("OK", "HATA") bir cumlenin parcasi olabilir; alt cizgi ise pratikte
// yalnizca makine kodlarinda gecer.
const CODE_SHAPE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/

/**
 * Bu ham metin aslinda bir MAKINE KODU mu?
 *
 * CANLI KUSUR (kullanici ekran goruntusu): kart kirmizi satirda
 * "TON_QUOTE_FEE_ABOVE_APPROVED" yaziyordu. Ortak takas yakalayicisi
 * `error.message`i okunabilir bir cumle sayiyor, oysa TON kolu MAKINE KODU
 * firlatiyor (tonQuoteVerify'in on alti kodu, tonSwap'in TON_SWAP_*'lari) ve
 * bunlarin hicbiri TON_SEND_ERRORS tablosunda DEGIL.
 *
 * Tek tek tablolara yazmak bu sinifi KAPATMAZ: yarin eklenen bir kod yine sizar.
 * Bu yuzden karar SEKLE gore veriliyor -- son kapi, ureticiyi TANIMADAN calisir.
 */
export function looksLikeErrorCode(text) {
    return typeof text === 'string' && CODE_SHAPE.test(text.trim())
}

/**
 * Karta basilacak hata metni. Sira:
 *   1. `errorCode` varsa cevrilir (uretici kodu DOGRU alana yazmis).
 *   2. Ham metin bir KOD'a benzemiyorsa oldugu gibi basilir -- ethers/SDK
 *      istisnalari cevrilemez ve yanlis dilde ama DOGRU bir sebep, jenerik bir
 *      cumleden daha faydalidir.
 *   3. KOD'a benziyorsa: tablolarda varsa cevrilir (yanlis alana dusmus olmasi
 *      sebebi kaybettirmemeli), yoksa jenerik metne duser.
 *   4. Hicbiri yoksa ve islem GERCEKTEN dustuyse jenerik metin -- basarisiz bir
 *      kartin hicbir sey soylememesi en kotu secenek.
 */
export function txErrorText(tx, t) {
    const code = tx?.meta?.errorCode
    if (code) return t(resolveTxError(code), { detail: tx?.meta?.errorDetail || '' })

    const raw = tx?.meta?.error
    if (raw && !looksLikeErrorCode(raw)) return raw
    if (raw) return t(resolveTxError(raw), { detail: '' })

    return tx?.status === 'error' ? t(resolveTxError(null), { detail: '' }) : ''
}

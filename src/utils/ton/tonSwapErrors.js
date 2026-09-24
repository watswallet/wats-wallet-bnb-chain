// TON TAKASININ firlattigi kodlari i18n anahtarina esler -- saf katman, AG YOK.
// tonSendErrors.js / solana/sendErrors.js ile AYNI sozlesme.
//
// KOK NEDEN: bu kodlar ORTAK (EVM ile PAYLASILAN) takas yakalayicisina dusuyor ve
// orasi `error.message`i okunabilir bir cumle saniyordu. Sonuc: islem kartinda
// "TON_SWAP_QUOTE_STALE" gibi ham dizeler. Son kapi (utils/txErrors.js) artik
// KOD'a benzeyen hicbir seyi ham basmiyor, ama tek basina o kapi SEBEBI de
// gizler -- kullanici "Islem tamamlanamadi." gorup neden olduğunu bilemez. Bu
// tablo sebebi geri veriyor.
//
// NEDEN AYRI BIR TABLO: bu kodlar TON_SEND_ERRORS'a ait DEGIL. Orasi gonderim
// yolunun sozlugu ve tonBackgroundKeyPair.test.js "gonderimde firlatilan her kod
// orada olmali" diye tariyor; takas kodlarini oraya karistirmak iki kumeyi
// birbirine baglardi.
const K = (name) => `send.tonSwapErrors.${name}`

// TonSwapRelayError'un DOKUZ kodu TEK karsiliga toplanir: hepsi "role govdesi
// kurulamadi/dogrulanamadi" demek. Kullanici acisindan ayrimlari yok -- hicbirini
// duzeltemez, hepsinde ayni cikis var: GRAM ile odeyerek gondermek. Dokuz ayri
// metin yazmak listeyi kacinilmaz sekilde eskitirdi.
const RELAY = K('relayFailed')

export const TON_SWAP_ERRORS = {
    // --- tonSwap.js: gonderim oncesi kapilar ---
    TON_SWAP_QUOTE_STALE: K('quoteStale'),
    TON_SWAP_QUOTE_MISMATCH: K('quoteMismatch'),
    TON_SWAP_PRICE_IMPACT_HIGH: K('priceImpactHigh'),
    TON_SWAP_GAS_UNKNOWN: K('gasUnknown'),
    TON_SWAP_INSUFFICIENT_TON: K('insufficientTon'),
    // Metin BIREBIR aynisi zaten var -- kopyalamak yerine mevcut anahtar
    // gosteriliyor (solana/sendErrors.js'in `send.recipientNotWallet`i ile ayni
    // kalip). Kapi jetton bakiyesini olcuyor, yani metin dogru.
    TON_SWAP_INSUFFICIENT_BALANCE: 'send.tonErrors.jettonInsufficientBalance',

    // --- tonSwapQuote.js: sunucu teklifinin bicim dogrulamasi ---
    TON_SWAP_QUOTE_FAILED: K('quoteFailed'),

    // --- tonSwapRelayAction.js: role govdesi (TonSwapRelayError) ---
    TON_SWAP_RELAY_NO_BODY: RELAY,
    TON_SWAP_RELAY_BODY_UNREADABLE: RELAY,
    TON_SWAP_RELAY_NO_FORWARD_PAYLOAD: RELAY,
    TON_SWAP_RELAY_NO_FORWARD_TON: RELAY,
    TON_SWAP_RELAY_NO_ROUTER: RELAY,
    TON_SWAP_RELAY_GAS_UNRESOLVED: RELAY,
    TON_SWAP_RELAY_UNKNOWN_DIRECTION: RELAY,
    TON_SWAP_RELAY_AMOUNT_MISMATCH: RELAY,
    TON_SWAP_RELAY_PAYLOAD_TOO_LARGE: RELAY,
}

/**
 * Kod TABLO'da var mi? Cagiran taraf (background.js'in ortak yakalayicisi) ham
 * `error.message`in TANINAN bir kod olup olmadigini boyle sorar.
 */
export function isKnownTonSwapError(code) {
    return typeof code === 'string' && Object.prototype.hasOwnProperty.call(TON_SWAP_ERRORS, code)
}

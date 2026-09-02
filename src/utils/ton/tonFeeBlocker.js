// Sunucunun TON ucret yolu (ton-*) ve TON'a ozgu istemci dogrulama kapisinin
// (Task 2, tonQuoteVerify.js) urettigi kodlari mevcut engel bicimine cevirir.
// SAF: I/O yok, i18n lookup yok, storage yok - yalniz eslesme. atsBlocker.js'in
// bicimini birebir izler ki ConfirmTransaction.vue/Swap.vue YENI BIR EKRAN
// olmadan TON kararlarini da cizebilsin.
//
// UC AYRI KOD AILESI, UC AYRI MUAMELE (tasarim belgesi bolum 7):
//   ton-*                      -> kendi tablomuz (asagida)
//   src-*, balance-missing     -> resolveAtsBlocker'a DELEGE. BSC tarafinin
//                                 ekranlari zaten var; kopyalasak iki tablo
//                                 kacinilmaz olarak ayrisir ve kullanici
//                                 TON'da baska, EVM'de baska bir ekran gorur.
//   TON_QUOTE_*, TON_PAYLOAD_* -> sunucu hatasi DEGIL: istemcinin IMZALAMAYI
//                                 REDDETTIGI an (Task 2). Ag arizasi degil,
//                                 ya bir hata ya bir saldiridir - kullaniciyi
//                                 tekrar denemeye itmek YANLIS (ayni yanit
//                                 yine gelir, kullanici sonunda "sorun yok"
//                                 deyip zorlamaya calisir).
import { resolveAtsBlocker } from '../atsBlocker'

const OPERATOR = 'operator'   // ag sorunlu - kullanicinin yapabilecegi bir sey yok
const BLOCKED = 'blocked'     // kimsenin cozemeyecegi durum (burada: guvenlik reddi)
const USER = 'user'           // eylem kullanicida
const INTERNAL = 'internal'   // istemci/akis hatasi; kod duzeltir, sucla(n)maz
const TRANSIENT = 'transient' // gecici; suclama yok

const K = (name) => `send.confirmTransaction.${name}`

// i18n anahtarlari birden fazla yerde (tablo + fonksiyon govdesi) kullanildigi
// icin TEK yerde sabitlenir - metin ile TON_FEE_I18N_KEYS iki ayri liste olup
// kacinilmaz sekilde ayrismasin diye (asagida).
const KEY_UNSAFE_QUOTE = K('tonUnsafeQuote')
const KEY_FRESH_QUOTE = K('tonFreshQuoteNeeded')
const KEY_SERVER_ERROR = K('tonServerError')
const KEY_QUOTE_UNAVAILABLE = K('tonQuoteUnavailable')
const KEY_RELAY_UNAVAILABLE = K('tonRelayUnavailable')
const KEY_UNKNOWN = K('tonUnknownError')
const KEY_NETWORK_ERROR = K('tonNetworkError')

// Sunucunun ucret yolunda urettigi kodlar (tasarim belgesi 2026-08-29, bolum 7).
// Delege edilen src-*/balance-missing burada YOK - kopyalanirsa dosya basindaki
// ayrisma riski gerceklesir.
const TON_TABLE = {
  // --- operator: kullanicinin yapabilecegi bir sey yok ---
  'ton-stale-rate': { severity: OPERATOR, action: 'retry-later', i18nKey: K('tonRateStale') },
  'ton-tank-low':   { severity: OPERATOR, action: 'retry-later', i18nKey: K('tonTankLow') },

  // --- gecici: taze bir istek farkli sonuc verebilir, suclama yok ---
  'ton-estimate-failed': { severity: TRANSIENT, action: 'retry-later', i18nKey: K('tonEstimateFailed') },
  // Relay 502 doner ve tahsilat YAPILMADI (bkz. settlementDispositionFor) - kayit
  // guvenle silinir, kullaniciya "tekrar dene" demek dogru cunku ATS harcanmadi.
  'ton-collect-failed': { severity: TRANSIENT, action: 'retry-later', i18nKey: K('tonCollectFailed') },

  // --- kullanici: gosterilen/onayladigi tutari azaltmali ---
  'ton-cost-over-cap':   { severity: USER, action: 'reduce-amount', i18nKey: K('tonCostOverCap') },
  'ton-attach-over-cap': { severity: USER, action: 'reduce-amount', i18nKey: K('tonAttachOverCap') },

  // --- ic: teklif bayatlamis/tuketilmis - "hata" degil sessiz tazeleme ---
  // Ayni quoteId ile relay'i tekrar denemek YANLIS: onceki deneme ASLINDA
  // basarili olup quoteId'yi tuketmis OLABILIR. Bu belirsizlik yuzunden makbuz
  // burada silinmez (bkz. settlementDispositionFor) - yalniz taze bir teklif
  // istenir.
  'quote-expired':      { severity: INTERNAL, action: 'fresh-quote', i18nKey: KEY_FRESH_QUOTE },
  'ton-quote-consumed': { severity: INTERNAL, action: 'fresh-quote', i18nKey: KEY_FRESH_QUOTE },
}

// tonQuoteVerify.js'in (Task 2) firlattigi guvenlik/tutarlilik kodlari. Hepsi
// AYNI muameleyi gorur: retry-later YANLIS (ayni istek yine ayni govdeyi
// getirir), fresh-quote de YANLIS (sorun teklifin bayatligi degil, govdenin
// niyetten sapmasi) - bu yuzden bu gorevin tek yeni eylemi: abort-unsafe.
const ABORT_UNSAFE_CODES = new Set([
  'TON_QUOTE_HASH_MISMATCH', 'TON_QUOTE_AUTH_TYPE', 'TON_QUOTE_DEADLINE_MISMATCH',
  'TON_QUOTE_SEQNO_MISMATCH', 'TON_QUOTE_INTENT_MISMATCH', 'TON_QUOTE_PUBKEY_MISMATCH',
  'TON_QUOTE_WALLET_MISMATCH', 'TON_QUOTE_SEALED_MISMATCH', 'TON_FEE_DOMAIN_MISMATCH',
  'TON_QUOTE_FEE_MISMATCH', 'TON_QUOTE_FEE_ABOVE_APPROVED',
  'TON_PAYLOAD_UNPARSEABLE', 'TON_PAYLOAD_UNKNOWN_ACTION',
  'TON_PAYLOAD_BODY_UNVERIFIED', 'TON_PAYLOAD_INIT_UNVERIFIED',
])

// Bunlar AYRI: sure asimi/tuketim guvenlik olayi degil, sadece tazeleme isi -
// ayni sunucu tarafindaki quote-expired/ton-quote-consumed ile ayni muamele.
const QUOTE_STALE_CODES = new Set(['TON_QUOTE_EXPIRED', 'TON_QUOTE_WINDOW_TOO_LONG'])

function isDelegatedToAts(code) {
  return code === 'balance-missing' || (typeof code === 'string' && code.startsWith('src-'))
}

// Tahsilat yolundaki altyapi hatalarinin cogu sir sizdirmamak icin KODSUZ 400'e
// sariliyor (tasarim 7). Istek zaten iki imzayla dogrulanmis oldugu icin
// kullanicinin duzeltebilecegi hicbir sey yok -> USER ASLA verilmez. `phase`
// hangi ucun cevap veremedigini ayirt eder (quote vs relay) ki metin dogru
// adimi anlatsin.
function resolveCodeless({ httpStatus, phase } = {}) {
  const s = httpStatus
  if (s != null && s >= 500) return { severity: TRANSIENT, action: 'retry-later', i18nKey: KEY_SERVER_ERROR }
  if (s != null && s >= 400) {
    const i18nKey = phase === 'relay' ? KEY_RELAY_UNAVAILABLE : KEY_QUOTE_UNAVAILABLE
    return { severity: TRANSIENT, action: 'retry-later', i18nKey }
  }
  // KODSUZ VE HTTP YANITI YOK = ag hatasi (cevrimdisi, DNS, engellenen istek;
  // ornegin Task 4'un readTonFeeStatus'unun firlattigi TonFeeError). `null`
  // dondurmek burada "sorun yok" demek olurdu ve ekran HICBIR SEY cizmez:
  // kullanici cevrimdisi, ucret akisi coktu, gordugu tek sey bos bir kart.
  // Bu modulde `null`un TEK anlami vardir: ton-fee-already-settled (makbuz
  // sinyali) - baska hicbir yol null dondurmemeli.
  return { severity: TRANSIENT, action: 'retry-later', i18nKey: KEY_NETWORK_ERROR }
}

/**
 * @param {string|null|undefined} code  sunucu `code`u, ya da TonQuoteVerifyError.code
 * @param {{httpStatus?: number, phase?: 'quote'|'relay'}} [opts]
 * @returns {{severity: string, action: string, i18nKey: string, i18nDescKey?: string}|null}
 *          Bu modulde `null`un TEK anlami vardir: `ton-fee-already-settled` (makbuz
 *          sinyali). Kodsuz VE httpStatus'suz cagrilar (ag hatasi) dahil BASKA HICBIR
 *          durum null dondurmez - bkz. resolveCodeless. src- ile baslayan kodlar ve
 *          balance-missing icin resolveAtsBlocker'in DONDURDUGU NESNENIN KENDISI
 *          (kopya degil).
 */
export function resolveTonFeeBlocker(code, opts = {}) {
  // Makbuz sinyali: ucret ALINDI, bu bir hata degil. UI'ya cikarsa kullanici
  // "islem basarisiz" sanir - oysa kurtarma yolu var (tasarim bolum 6).
  if (code === 'ton-fee-already-settled') return null

  if (isDelegatedToAts(code)) return resolveAtsBlocker(code, { httpStatus: opts.httpStatus })

  if (code && TON_TABLE[code]) return TON_TABLE[code]

  if (code && ABORT_UNSAFE_CODES.has(code)) {
    return { severity: BLOCKED, action: 'abort-unsafe', i18nKey: KEY_UNSAFE_QUOTE }
  }
  if (code && QUOTE_STALE_CODES.has(code)) {
    return { severity: INTERNAL, action: 'fresh-quote', i18nKey: KEY_FRESH_QUOTE }
  }

  if (!code) return resolveCodeless(opts)

  // Bilinmeyen kod: sunucu ya da dogrulama katmani yeni bir kod eklemis
  // olabilir. "Engel yok" saymak sessiz bir bypass olurdu (bkz. atsBlocker.js
  // ayni karar) - gecici sayip UI'da mesaji oldugu gibi gostermek dogru taraf.
  return { severity: TRANSIENT, action: 'retry-later', i18nKey: KEY_UNKNOWN }
}

// Relay yanitina gore, diskteki makbuzun (chrome.storage.local, key
// ton_pending_settlements) akibeti. Bu, yukaridaki UI karariyla KARISTIRILMAZ:
// biri ekrana ne cizilecegini, diger kayitin silinip silinmeyecegini soyler.
// Sadece "kesinlikle tahsilat olmadi" diyen kodlar SILMEYE izin verir; geri
// kalan HER SEY (kodsuz yanit dahil) kayit BIRAKILARAK cozulur - cunku kayit
// yanlislikla silinirse odenmis bir ucretin kurtarma yolu da kaybolur.
const SAFE_TO_CLEAR_CODES = new Set(['ton-collect-failed', 'ton-cost-over-cap', 'ton-attach-over-cap'])

/**
 * @param {{httpStatus?: number, code?: string|null}} [info]  relay yanitinin durum kodu ve govde `code`u.
 *   `httpStatus` bugun karari degistirmiyor (ayrim tumuyle `code` uzerinden) - imzada
 *   duruyor cunku cagiran taraf relay yanitinin TAMAMINI elinde tutuyor.
 * @returns {'clear'|'keep-settled'|'keep'}
 */
export function settlementDispositionFor({ httpStatus, code } = {}) {
  // Ucret zaten ALINMIS - kayit SILINMEZ, 'collected' asamasina yukseltilir.
  if (code === 'ton-fee-already-settled') return 'keep-settled'

  // Bu kodlar tahsilat GIRISIMINDEN ONCEKI bir dogrulamada duser (kapasite
  // asimi ya da acik "tahsilat yapilmadi" sinyali) - ATS harcanmadigi KESIN.
  if (code && SAFE_TO_CLEAR_CODES.has(code)) return 'clear'

  // Geri kalan HER SEY (kodsuz yanit, quote-expired/ton-quote-consumed dahil)
  // BELIRSIZ: quote-expired/ton-quote-consumed bir ONCEKI denemenin ASLINDA
  // basarili olup quoteId'yi tukettigini gosteriyor olabilir. Kayit birakilir;
  // kurtarma zincirden dogrulayip karar verir (tasarim bolum 6).
  return 'keep'
}

// Task 8'in i18n parite testi bu kumeyi gezer (Ruling 2): anahtar adlari bir
// kez burada, TON_TABLE'dan TURETILEREK yasar - elle kopyalanan ikinci bir
// liste, TON_TABLE degistiginde sessizce eskir.
export const TON_FEE_I18N_KEYS = Array.from(new Set([
  ...Object.values(TON_TABLE).map((d) => d.i18nKey),
  KEY_UNSAFE_QUOTE,
  KEY_SERVER_ERROR,
  KEY_QUOTE_UNAVAILABLE,
  KEY_RELAY_UNAVAILABLE,
  KEY_UNKNOWN,
  KEY_NETWORK_ERROR,
]))

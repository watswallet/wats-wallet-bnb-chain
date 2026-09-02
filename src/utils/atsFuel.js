// ATS = cuzdanin YAKITI. Header'daki yakit pill'i bu modulden beslenir.
//
// Bu modul ZINCIR SECMEZ; okumayi yapan taraf (background.js) 56'yi sabitler. Sebep:
// kullanicinin gercek ATS'si yalniz BSC'de durur, diger zincirlerdeki ATSOFT bakiyeleri
// gelistirme kalintisidir ve kullaniciya hic acilmaz.
//
// Saf fonksiyonlar depoya DOKUNMAZ; depo yardimcilari mantik ICERMEZ.

const FUEL_CACHE_KEY = 'ats_fuel_cache'
const FEE_HINTS_KEY = 'ats_fee_hints'

// Kac op'luk yakitin ALTINDA "az" sayilir.
export const FUEL_LOW_OPS = 3

// ATS satin alma yolu. `BuyToken.vue` KULLANILMAZ: o ekran sunucu uzerinden MoonPay'e
// currencyCode:"ats" gonderiyor ve MoonPay ATS'yi listelemiyor -> kullanici "bu para
// birimi yok" hatasina duser. Borsa linki calisan tek yol.
export const ATS_BUY_URL = 'https://www.mexc.com/exchange/ATS_USDT'

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Sondaki sifirlari kirp: "12.0" -> "12", "0.40" -> "0.4". Noktasi olmayan dizgiye dokunma.
const trim = (s) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s)

// Kisaltilmis basamak. 100'un uzerinde ondalik DUSER: "987.7M" alti karakter, header'da
// yer yok; "988M" ayni bilgiyi verir.
const compact = (n, suffix) => (n < 100 ? trim(n.toFixed(1)) : String(Math.round(n))) + suffix

// Pill'deki KISA gosterim. Cikti hicbir durumda 5 karakteri gecmez (header'da yer yok).
export function formatFuel(balance) {
  const n = num(balance)
  if (n === null || n < 0) return '—'
  if (n === 0) return '0'
  // "0" yazmak "yakit yok" demektir; bakiye varken bunu soylememeli.
  if (n < 0.01) return '<0.01'
  if (n < 1) return trim(n.toFixed(2))
  if (n < 100) return trim(n.toFixed(1))
  // Yuvarlama bir UST basamaga tasiyorsa o basamaga gec: 999.6 -> "1K", 999999 -> "1M",
  // 999999999 -> "1B". Kontrol her basamakta ayni olmali; yalniz ilkine koymak "1000K" ve
  // "1000M" gibi hem garip hem kastedilmeyen ciktilar birakiyordu.
  if (Math.round(n) < 1000) return String(Math.round(n))
  if (n < 1e6 && Math.round(n / 1e3) < 1000) return compact(n / 1e3, 'K')
  if (n < 1e9 && Math.round(n / 1e6) < 1000) return compact(n / 1e6, 'M')
  // TAVAN: 999B'nin ustunde 5 karaktere sigan DOGRU bir sayi yok. Sessizce kirpmak yanlis
  // bir sayi gostermek olurdu; '>999B' hic degilse kirpildigini soyler. Tavan olmadan
  // 1e13 -> "10000B", yani alti karakter.
  if (Math.round(n / 1e9) > 999) return '>999B'
  return compact(n / 1e9, 'B')
}

// Popover'daki TAM gosterim. Pill kisaltir; kullanici gercek sayiyi bir yerde gorebilmeli.
export function formatFuelExact(balance) {
  const n = num(balance)
  if (n === null || n < 0) return '—'
  // formatFuel'deki '<0.01' korumasinin AYNISI, dort ondalikta: (0.00001).toFixed(4)
  // "0.0000" -> kirpilinca "0" olur. Pill '<0.01' derken popover '0 ATS' diyemez;
  // bakiye varken "0" yazmak "yakit yok" demektir.
  if (n > 0 && n < 0.0001) return '<0.0001'
  return trim(n.toFixed(4))
}

const validHint = (h) => h && num(h.perOp) !== null && num(h.perOp) > 0

// YALNIZ mevcut zincirin ipucu; yoksa null. BASKA bir zincirin ucretine GERI DUSULMEZ:
// Ethereum'daki op ucreti ile BSC'dekinin buyuklugu ayrisir, yani kayitlar birbiriyle
// KIYASLANABILIR degildir. Ethereum'da 50 ATS olan bir ucretle BSC'de duran 40 ATS'yi
// bolmek opsLeft=0 verir ve o 40 ATS BSC'de onlarca isleme yeterken kullaniciya kirmizi
// pill + "tek isleme yetmiyor" gosterir; tersi de sahte bir 'ok' uretir. Ipucu yoksa
// dogru cevap SESSIZLIKTIR: fuelLevel null ucreti 'unknown' (uyari yok) yapar.
export function pickFeeHint(hints, chainId) {
  if (!hints || typeof hints !== 'object') return null
  const own = hints[String(chainId)]
  return validHint(own) ? own : null
}

export function fuelOpsLeft({ balance, feePerOp }) {
  const b = num(balance)
  const f = num(feePerOp)
  if (b === null || f === null || f <= 0) return null
  return Math.floor(b / f)
}

export function fuelLevel({ balance, feePerOp }) {
  const b = num(balance)
  if (b === null) return 'unknown'
  if (b <= 0) return 'empty'
  const ops = fuelOpsLeft({ balance, feePerOp })
  // Ipucu yoksa SESSIZ kal: uydurulmus bir esikle 955 ATS'si olani korkutmak, hic
  // uyarmamaktan daha kotu.
  if (ops === null) return 'unknown'
  if (ops < 1) return 'empty'
  if (ops < FUEL_LOW_OPS) return 'low'
  return 'ok'
}

// ---- depo yardimcilari: MANTIK YOK, hata YUTULUR ----
// Ipucu ve onbellek birer KOLAYLIKTIR. Bir depo hatasi ne quote akisini ne header'i
// dusurmeli; en kotu ihtimalle pill '—' gosterir.

export async function readFeeHints() {
  try {
    const r = await chrome.storage.local.get(FEE_HINTS_KEY)
    const h = r && r[FEE_HINTS_KEY]
    return h && typeof h === 'object' ? h : {}
  } catch {
    return {}
  }
}

export async function writeFeeHint(chainId, perOp) {
  try {
    const p = num(perOp)
    if (p === null || p <= 0) return
    const hints = await readFeeHints()
    hints[String(chainId)] = { perOp: p, at: Date.now() }
    await chrome.storage.local.set({ [FEE_HINTS_KEY]: hints })
  } catch {
    // yutulur
  }
}

export async function readFuelCache(address) {
  try {
    if (!address) return null
    const r = await chrome.storage.local.get(FUEL_CACHE_KEY)
    const c = r && r[FUEL_CACHE_KEY]
    const rec = c && c[String(address).toLowerCase()]
    return rec && num(rec.balance) !== null ? rec : null
  } catch {
    return null
  }
}

export async function writeFuelCache(address, balance) {
  try {
    if (!address || num(balance) === null) return
    const r = await chrome.storage.local.get(FUEL_CACHE_KEY)
    const c = (r && r[FUEL_CACHE_KEY]) || {}
    c[String(address).toLowerCase()] = { balance: String(balance), at: Date.now() }
    await chrome.storage.local.set({ [FUEL_CACHE_KEY]: c })
  } catch {
    // yutulur
  }
}

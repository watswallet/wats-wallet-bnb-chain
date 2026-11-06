// ATS SATISI -- hatalarin ve fiyatin EKRAN karsiligi (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §7).
//
// SAF: I/O yok, i18n yok. Arka plan yalniz KOD yazar (utils/atsSale.js saleErrorOf); cumle
// burada anahtara cevrilir. Bilinmeyen kod ekranda HAM gorunmez: "Islem hazirlanamadi"ya duser.
//
// PARA BIRIMI (Plan B Gorev 11): tutar metinleri SECILI BIRIMDE yazilir. `money` (useMoney().money)
// ekrandan verilir; bu modul depoya/Intl'e dokunmaz, saf kalir. Girdiler USD'dir (sunucu maxUsd,
// teklifin display.price'i), cevirme ve sembol `money`de.
import { formatUnits } from 'ethers'
import { formatAtsAmount } from './atsAmountFormat'

const K = (name) => `atsSale.errors.${name}`

// Gizli modda kapinin ATS_SALE_QUOTE/EXECUTE icin verdigi neden kodu TEK kaynaktan gelir:
// privacyGate PRIVATE_GATE_CODES.ATS_SALE_BLOCKED (arayuz onu ice aktarir, burada kopya YOK). Bu dosyanin kendi
// ekran kodu asagidaki sabittir; Swap.vue kapidan donen kodu bu koda cevirir ve her yerde bu adi kullanir.
export const SALE_CODE_PRIVATE_BLOCKED = 'private-blocked'

// `exchange`: kartta MEXC linki de cizilir (spec §7 "Ek davranis").
const VIEWS = {
  'sale-closed': { key: K('saleClosed'), exchange: true },
  'amount-too-small': { key: K('amountTooSmall'), exchange: false },
  'amount-too-large': { key: K('amountTooLarge'), exchange: true },
  'price-unverified': { key: K('priceUnverified'), exchange: false },
  'usdc-depeg': { key: K('usdcDepeg'), exchange: false },
  'depth-insufficient': { key: K('depthInsufficient'), exchange: true },
  'rate-limited': { key: K('rateLimited'), exchange: false },
  'quote-failed': { key: K('quoteFailed'), exchange: false },
  'relay-failed': { key: K('relayFailed'), exchange: false },
  'result-unknown': { key: K('resultUnknown'), exchange: false },
  'prepare-failed': { key: K('prepareFailed'), exchange: false },
  // Gizli Hesap ATS alamaz (spec 23.8): kendi cumlesi, MEXC linki YOK (gizli modda disari yonlendirme yok).
  [SALE_CODE_PRIVATE_BLOCKED]: { key: 'privacy.atsSale.blocked', exchange: false },
}
// K13 (PRIVATE_ATS_SALE acik): Gizli Hesap kendi alimini yapar; kapi bu kodu yalniz eskimis mod / hesap yarisinda verir ve
// "Gizli modda ATS alinamaz" demek yanlis olurdu. Hicbir sey imzalanmadi: teklifi yeniden almak yeter.
const PRIVATE_SALE_STALE_KEY = 'privacy.atsSale.stale'

const atsText = (raw) => {
  try {
    return formatAtsAmount(formatUnits(BigInt(raw), 18))
  } catch {
    return null
  }
}

// USD tutarini (sayi ya da metin) `money` ile yazar. Bos / bozuk girdide ya da `money` yoksa null:
// Number(null) ve Number('') 0 verir, bu yuzden bos girdi sayiya cevrilmeden elenir ("$0.00" yazilmaz).
const moneyText = (value, money, opts) => {
  if (typeof money !== 'function') return null
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null
  const n = Number(value)
  return Number.isFinite(n) ? money(n, opts) ?? null : null
}

/**
 * @param {{code: string, maxAts?: string|null, maxUsd?: string|null}|null} err
 * @param {{privateSale?: boolean, money?: (usd: number, opts?: object) => string|null}} [opts] privateSale: PRIVATE_ATS_SALE acik mi. Bu modul SAF kalir (ortam okumaz); bayragi
 *   cagiran (Swap.vue) verir. Yalniz 'private-blocked' kartinin metnini etkiler. money: ekranin useMoney().money'si
 *   (USD tutari secili birimle yazar).
 * @returns {{key: string, params: object, exchange: boolean}|null}
 */
export function saleErrorView(err, { privateSale = false, money } = {}) {
  if (!err || !err.code) return null
  if (err.code === SALE_CODE_PRIVATE_BLOCKED && privateSale) return { key: PRIVATE_SALE_STALE_KEY, params: {}, exchange: false }
  if (err.code === 'stock-insufficient') {
    const amount = err.maxAts != null ? atsText(err.maxAts) : null
    // `usd` TAM BICIMLI tutardir ("$61.73", "₺2.469,36"); metin yalniz yer tutucuyu koyar, sembol basmaz.
    const usd = moneyText(err.maxUsd, money)
    // Ipucu (ya da `money`) eksikse sayisiz cumle: "en fazla — ATS" yazmak hicbir sey soylemez.
    if (!amount || !usd) return { key: K('stockInsufficientShort'), params: {}, exchange: false }
    return { key: K('stockInsufficient'), params: { amount, usd }, exchange: false }
  }
  const v = VIEWS[err.code] || VIEWS['prepare-failed']
  return { key: v.key, params: {}, exchange: v.exchange }
}

// 1 ATS'nin fiyati (teklifin display.price'i, USD), secili birimde TAM BICIMLI metin: "$0.0504",
// "₺2,02". Okunamazsa null -> satir CIZILMEZ; sifirli bir fiyat "bedava" demek olurdu.
// Birimin 100 en kucuk biriminin altinda (USD < 1, JPY < 100) 4 anlamli basamak: kucuk fiyat
// sifira ya da tamsayiya yuvarlanmaz (0.0504 USD -> "¥7.56"); ustunde standart. Esik money.js'te.
export function salePriceText(price, money) {
  const n = Number(price)
  if (price == null || price === '' || !Number.isFinite(n) || n <= 0) return null
  return moneyText(n, money, { significant: 4 })
}

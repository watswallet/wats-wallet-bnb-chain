import { formatUnits } from 'ethers'
import { COW_CHAIN_IDS, LOCK_REASON, payTokensFor } from './cow/config'
import { clampToDecimals, isInsufficientBalance } from './swapValidation'
import { percentAmount } from './sendPercent'
import { USD_DISPLAY, formatMoney } from './money'
import { isInsufficientAtoms } from './stockBalance'

// Al/Sat ekraninin karar ve bicimleme katmani. ARAYUZ HESAP YAPMAZ: tutarlar arka plandaki
// `display` modelinden gelen dizelerdir; burasi yalniz bicimler, gosterir ve dugmeyi kapatir.
// Kilit/koruma kararlari arka plandadir (invariant 8).

export const AMOUNT_MAX_DECIMALS = 18 // girdi kirpma tavani; kesin sinir arka planda (INVALID_REQUEST), K5

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const CLEAN_AMOUNT = /^\d+(\.\d+)?$/

/** COW_QUOTE mesaji: YALNIZ bu bes anahtar. Gecersiz girdi -> null. */
export function buildQuoteMessage({ side, chainId, stockAddress, payToken, amount } = {}) {
  if (side !== 'buy' && side !== 'sell') return null
  if (typeof chainId !== 'number' || !COW_CHAIN_IDS.includes(chainId)) return null
  if (typeof stockAddress !== 'string' || !ADDRESS.test(stockAddress)) return null
  if (typeof payToken !== 'string' || !ADDRESS.test(payToken)) return null
  if (typeof amount !== 'string' || !CLEAN_AMOUNT.test(amount) || !/[1-9]/.test(amount)) return null
  const clean = amount.includes('.') ? amount.replace(/0+$/, '').replace(/\.$/, '') : amount
  return { side, chainId, stockAddress, payToken, amount: clean }
}

/** Girdi kutusu temizligi. '0' / bos -> ''. Yazarken ara durumlar ('0.', '0.0') korunur. */
export function sanitizeAmountInput(text, decimals = AMOUNT_MAX_DECIMALS) {
  const raw = text === null || text === undefined ? '' : String(text).trim()
  if (/^\d*\.?\d*$/.test(raw)) {
    const [whole = '', fraction = ''] = raw.split('.')
    const w = whole.replace(/^0+(?=\d)/, '') || '0'
    if (!raw.includes('.') || !(decimals > 0)) return w === '0' ? '' : w
    return `${w}.${fraction.slice(0, decimals)}`
  }
  const clamped = clampToDecimals(raw, decimals)
  return clamped === '0' ? '' : clamped
}

export const isPositiveAmount = (text) => typeof text === 'string' && CLEAN_AMOUNT.test(text) && /[1-9]/.test(text)

export function percentOfBalance({ balance, percent, decimals }) {
  const out = percentAmount({ balance, reserve: 0, percent, decimals })
  return out === '0' ? '' : out
}

export const defaultPayToken = (chainId) => payTokensFor(chainId)[0] ?? null

/** null = Al/Sat/Onay izni. */
export function tradeBlockReason(s = {}) {
  if (!s.enabled) return 'disabled'
  if (!s.stockOk) return 'unsupported-stock'
  if (!s.accountReady) return 'no-account'
  if (!isPositiveAmount(s.amount)) return 'enter-amount'
  if (s.balanceLoading) return 'balance-loading'
  // Atom biliniyorsa karar BigInt ile verilir (Number esitligi 1 atom farki kayirir); belirsizse (null) float yolu.
  const exact = s.balanceAtoms == null ? null : isInsufficientAtoms(s.amount, s.balanceAtoms, s.balanceDecimals)
  if (exact === null ? isInsufficientBalance(s.amount, s.balance) : exact) return 'insufficient-balance'
  const q = s.quote ?? {}
  if (q.state === 'ready') return null
  if (q.state === 'error') return 'quote-error'
  if (q.state === 'locked') return `lock-${q.lockReason ?? 'UNKNOWN'}`
  return 'quote-loading'
}

export const primaryAction = (quoteResult) => (quoteResult?.approval?.mode === 'onchain' ? 'approve' : 'trade')

export function formatAmount(atoms, decimals, maxFrac = 6) {
  let units
  let positive
  try {
    const v = BigInt(atoms)
    positive = v > 0n
    units = formatUnits(v, decimals)
  } catch {
    return '-'
  }
  const [whole, fraction = ''] = units.split('.')
  const kept = fraction.slice(0, maxFrac).replace(/0+$/, '')
  if (whole === '0' && !kept && positive) {
    return maxFrac > 0 ? `<0.${'0'.repeat(maxFrac - 1)}1` : '<1'
  }
  return kept ? `${whole}.${kept}` : whole
}

/**
 * Secili birimde tutar metni (fiyat/ucret satirlari). Deger USD'dir; cevirme ve bicim money.js'te.
 * Gecersiz deger (null, NaN, Infinity, ''), ya da kur okunamiyorsa '-' (bugunku davranis; "$0.00" yazilmaz).
 */
function moneyText(usd, display, locale, style) {
  return formatMoney(usd, display, { locale, style }) ?? '-'
}

/** Birimsiz sayi (ekran metni, yerel ondalik ayraci). Gecersiz -> null. */
function formatPlain(value, digits, locale) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  try {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
  } catch {
    return value.toFixed(digits)
  }
}

export function formatLocalTime(iso, locale) {
  if (typeof iso !== 'string') return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
  } catch {
    return null
  }
}

/** Kilit/uyari satiri -> { key, params } */
export function lockLine({ lockReason, side, gapPct, nextChangeAt, locale } = {}) {
  switch (lockReason) {
    case LOCK_REASON.PRICE_PROTECTION: {
      const pct = typeof gapPct === 'number' && Number.isFinite(gapPct) ? Math.abs(gapPct).toFixed(1) : '-'
      return { key: `stockTrade.lock.PRICE_PROTECTION_${side === 'sell' ? 'SELL' : 'BUY'}`, params: { pct } }
    }
    case LOCK_REASON.MARKET_CLOSED: {
      const time = formatLocalTime(nextChangeAt, locale)
      return time
        ? { key: 'stockTrade.lock.MARKET_CLOSED', params: { time } }
        : { key: 'stockTrade.lock.MARKET_CLOSED_NOTIME', params: {} }
    }
    case LOCK_REASON.MARKET_UNKNOWN:
      return { key: 'stockTrade.lock.MARKET_UNKNOWN', params: {} }
    case LOCK_REASON.FEE_DEBT:
      return { key: 'stockTrade.atsFee.debtLock', params: {} }
    default:
      return { key: 'stockTrade.lock.REFERENCE_MISSING', params: {} }
  }
}

/**
 * 'Ag ucreti: $0,62 (%6,2)' satiri: arka planin hesapladigi networkFeeUsd / networkFeePct'yi yalniz bicimler.
 * params.fee TAM BICIMLI tutardir (sembol dahil, secili birimde); sozlukteki metin "$" gommez.
 */
function networkFeeLine(d, locale, display) {
  const fee = formatMoney(d.networkFeeUsd, display, { locale })
  const pct = formatPlain(d.networkFeePct, 1, locale)
  if (fee === null || pct === null) return null
  return { key: 'stockTrade.quote.networkFeeLine', params: { fee, pct } }
}

/**
 * Yuksek ag ucreti UYARISI (kilit degil): karari arka plan verir (display.feeWarning, BigInt); burasi yalniz bicimler.
 * BSC (56) disindaki zincirlerde ek cumle anahtari gelir ('BSC'de ag ucreti birkac sent').
 */
const BSC_CHAIN_ID = 56
function feeWarningLine(d, locale, chainId) {
  if (d.feeWarning !== true) return null
  const pct = formatPlain(d.networkFeePct, 1, locale)
  if (pct === null) return null
  return {
    key: 'stockTrade.quote.feeWarning',
    params: { pct },
    extraKey: chainId === BSC_CHAIN_ID ? null : 'stockTrade.quote.feeWarningBsc',
  }
}

/**
 * Teklif sonucundan ekran satirlari: i18n anahtari + hazir deger (hesap yok).
 * Tutar satirlari (birim fiyat, referans, ucretler) arka planin USD degerlerini 'display' (secili birim) ile yazar:
 * birim fiyat/referans 'price' stili, ucretler 'standard'. 'display' verilmezse USD.
 */
export function quoteRows({ result, side, symbol, paySymbol, locale, chainId, display = USD_DISPLAY } = {}) {
  const d = result?.display
  if (!d) return null
  const buy = side === 'buy'
  const getSym = buy ? symbol : paySymbol
  const spendSym = buy ? paySymbol : symbol
  const fees = d.fees ?? {}
  const gapPct = d.gapPct
  const notice = result.notice
  return {
    spend: { labelKey: buy ? 'stockTrade.quote.pay' : 'stockTrade.quote.sell', value: `${formatAmount(d.sellAmount, d.sellDecimals)} ${spendSym}` },
    primary: { labelKey: 'stockTrade.quote.estimate', value: `${formatAmount(d.expectedBuy, d.buyDecimals)} ${getSym}` },
    minimum: { labelKey: 'stockTrade.quote.minimum', value: `${formatAmount(d.minBuy, d.buyDecimals)} ${getSym}` },
    unitPrice: moneyText(d.unitPrice, display, locale, 'price'),
    reference: moneyText(d.referencePrice, display, locale, 'price'),
    gap:
      typeof gapPct === 'number' && Number.isFinite(gapPct)
        ? { key: 'stockTrade.quote.gap', pct: `${gapPct > 0 ? '+' : ''}${gapPct.toFixed(2)}%` }
        : null,
    fees: [
      { labelKey: 'stockTrade.quote.feeNetwork', usd: moneyText(fees.networkUsd, display, locale) },
      { labelKey: 'stockTrade.quote.feeCow', usd: moneyText(fees.cowUsd, display, locale) },
      { labelKey: 'stockTrade.quote.feeWats', usd: moneyText(fees.watsUsd, display, locale) },
    ],
    feesTotalUsd: moneyText(fees.totalUsd, display, locale),
    networkFee: networkFeeLine(d, locale, display),
    feeWarning: feeWarningLine(d, locale, chainId),
    notice:
      notice?.state === 'closed' || notice?.state === 'unknown'
        ? { key: `stockTrade.notice.${notice.state}`, time: formatLocalTime(notice.nextChangeAt, locale) }
        : null,
    warnings: (Array.isArray(result.warnings) ? result.warnings : []).map((w) =>
      lockLine({ lockReason: w?.code, side, gapPct, nextChangeAt: w?.nextChangeAt, locale }),
    ),
  }
}

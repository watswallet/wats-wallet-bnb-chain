import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../test-utils/kaynakTarama'
import {
  AMOUNT_MAX_DECIMALS,
  buildQuoteMessage,
  sanitizeAmountInput,
  isPositiveAmount,
  percentOfBalance,
  defaultPayToken,
  tradeBlockReason,
  primaryAction,
  formatAmount,
  formatLocalTime,
  quoteRows,
  lockLine,
} from './stockTrade'
import { PAY_TOKENS } from './cow/config'
import { smallAmountHint } from './stockTradeHint'
import { USD_DISPLAY } from './money'
import { createI18n } from 'vue-i18n'
import enMsg from '../i18n/locales/en.json'
import trMsg from '../i18n/locales/tr.json'

// Bosluklu biciler dilde nbsp (U+00A0) / dar nbsp (U+202F) kullanir: duz bosluga indirilir.
const norm = (s) => (typeof s === 'string' ? s.replace(/[\u00a0\u202f]/g, ' ') : s)
// Gorunum nesneleri (resolveDisplay ureticisi): TRY kur 40; kur yokken USD'ye dusme.
const TRY_40 = { code: 'try', rate: 40, fellBack: false }
const FELL_BACK = { code: 'usd', rate: 1, fellBack: true, requested: 'try' }

const STOCK = '0x1111111111111111111111111111111111111111'
const PAY = '0x2222222222222222222222222222222222222222'
const base = { side: 'buy', chainId: 1, stockAddress: STOCK, payToken: PAY, amount: '100.5' }

describe('buildQuoteMessage', () => {
  it('tam bes anahtar, ek alan dusur', () => {
    const out = buildQuoteMessage({ ...base, receiver: '0xabc', sellAmount: '1', extra: 1 })
    expect(out).toEqual(base)
    expect(Object.keys(out).sort()).toEqual(['amount', 'chainId', 'payToken', 'side', 'stockAddress'])
  })

  it.each(['1e3', '-1', '1,5', ' 1', '', '0', '0.0', '1.', '.5', null, undefined, 5])('bozuk tutar %j -> null', (amount) => {
    expect(buildQuoteMessage({ ...base, amount })).toBeNull()
  })

  it('bozuk zincir / adres / yon -> null; chainId dizesi -> null', () => {
    expect(buildQuoteMessage({ ...base, chainId: '1' })).toBeNull()
    expect(buildQuoteMessage({ ...base, chainId: 137 })).toBeNull()
    expect(buildQuoteMessage({ ...base, stockAddress: '0x12' })).toBeNull()
    expect(buildQuoteMessage({ ...base, payToken: null })).toBeNull()
    expect(buildQuoteMessage({ ...base, side: 'swap' })).toBeNull()
    expect(buildQuoteMessage()).toBeNull()
  })

  it('amount temiz ondalik dize: sondaki sifirlar atilir', () => {
    expect(buildQuoteMessage({ ...base, amount: '1.500' }).amount).toBe('1.5')
    expect(buildQuoteMessage({ ...base, amount: '2.0' }).amount).toBe('2')
  })
})

describe('tutar girdisi', () => {
  it('sanitize: sifir/bos -> bos, ara durumlar korunur, fazla ondalik kirpilir', () => {
    expect(AMOUNT_MAX_DECIMALS).toBe(18)
    expect(sanitizeAmountInput('0')).toBe('')
    expect(sanitizeAmountInput('')).toBe('')
    expect(sanitizeAmountInput(null)).toBe('')
    expect(sanitizeAmountInput('abc')).toBe('')
    expect(sanitizeAmountInput('0.')).toBe('0.')
    expect(sanitizeAmountInput('0.05')).toBe('0.05')
    expect(sanitizeAmountInput('007')).toBe('7')
    expect(sanitizeAmountInput('1.1234567890123456789012')).toBe('1.123456789012345678')
    expect(sanitizeAmountInput('1.239', 2)).toBe('1.23')
    expect(sanitizeAmountInput('1.9', 0)).toBe('1')
  })
  it('isPositiveAmount', () => {
    expect(isPositiveAmount('1')).toBe(true)
    expect(isPositiveAmount('0.001')).toBe(true)
    for (const v of ['', '0', '0.', '0.0', '1.', 'x', null, 1]) expect(isPositiveAmount(v)).toBe(false)
  })
  it('percentOfBalance: MAX = bakiye, yuzde tasmaz', () => {
    expect(percentOfBalance({ balance: '12.5', percent: 1, decimals: 6 })).toBe('12.5')
    expect(percentOfBalance({ balance: '1', percent: 0.5, decimals: 6 })).toBe('0.5')
    expect(percentOfBalance({ balance: '0.3', percent: 0.75, decimals: 18 })).toBe('0.225')
    expect(Number(percentOfBalance({ balance: '1.2', percent: 0.25, decimals: 6 }))).toBeLessThanOrEqual(1.2)
    expect(percentOfBalance({ balance: '0', percent: 1, decimals: 6 })).toBe('')
  })
  it('defaultPayToken ilk girdi (USDC); bilinmeyen zincir null', () => {
    expect(defaultPayToken(1)).toBe(PAY_TOKENS[1][0])
    expect(defaultPayToken(56).symbol).toBe('USDC')
    expect(defaultPayToken(137)).toBeNull()
  })
})

const okState = {
  enabled: true, stockOk: true, accountReady: true, amount: '10',
  balanceLoading: false, balance: '100', quote: { state: 'ready', lockReason: null, errorCode: null },
}

describe('tradeBlockReason', () => {
  it('ready -> null', () => {
    expect(tradeBlockReason(okState)).toBeNull()
  })
  describe('tam atom bakiyesi (balanceAtoms)', () => {
    const ATOM = 188405789675366912n
    const atomDurum = (amount, balance) => ({ ...okState, amount, balance, balanceAtoms: ATOM, balanceDecimals: 18 })
    it('atom bilinirken karar atomla verilir: Number esit gorunse de 1 atom fazla tutar yetersiz', () => {
      // Number('0.188405789675366913') === Number('0.188405789675366912'): float yolu bunu KAYIRIR
      expect(tradeBlockReason(atomDurum('0.188405789675366913', 0.188405789675366912))).toBe('insufficient-balance')
    })
    it('atom bakiyeye esit tutar gecer, Number golge dusumuyle kucuk kalsa bile', () => {
      expect(tradeBlockReason(atomDurum('0.188405789675366912', 0.1884057896753668))).toBeNull()
    })
    it('ondaligi asan tutar float yoluna doner', () => {
      expect(tradeBlockReason({ ...okState, amount: '1.0000000000000000001', balance: 5, balanceAtoms: ATOM, balanceDecimals: 18 })).toBeNull()
    })
    it('atom yoksa eski float yolu', () => {
      expect(tradeBlockReason({ ...okState, balance: '5', balanceAtoms: null })).toBe('insufficient-balance')
    })
  })
  it.each([
    [{ enabled: false }, 'disabled'],
    [{ stockOk: false }, 'unsupported-stock'],
    [{ accountReady: false }, 'no-account'],
    [{ amount: '' }, 'enter-amount'],
    [{ amount: '0' }, 'enter-amount'],
    [{ balanceLoading: true }, 'balance-loading'],
    [{ balance: '5' }, 'insufficient-balance'],
    [{ balance: undefined }, 'insufficient-balance'],
    [{ quote: { state: 'idle' } }, 'quote-loading'],
    [{ quote: { state: 'loading' } }, 'quote-loading'],
    [{ quote: { state: 'error', errorCode: 'NO_LIQUIDITY' } }, 'quote-error'],
    [{ quote: { state: 'locked', lockReason: 'MARKET_CLOSED' } }, 'lock-MARKET_CLOSED'],
    [{ quote: { state: 'locked', lockReason: 'REFERENCE_MISSING' } }, 'lock-REFERENCE_MISSING'],
    [{ quote: { state: 'locked', lockReason: 'PRICE_PROTECTION' } }, 'lock-PRICE_PROTECTION'],
  ])('tek bozuk kosul %j -> %s', (patch, expected) => {
    expect(tradeBlockReason({ ...okState, ...patch })).toBe(expected)
  })
  // Kullanici karari (2026-10-23): hissenin agi cuzdanin aktif agindan farkli olabilir; ag kilidi yok.
  it('chainOk (cuzdan agi) bir kilit degildir: yanlis ag bile engellemez', () => {
    expect(tradeBlockReason({ ...okState, chainOk: false })).toBeNull()
  })
  it('iki kosul bozukken onceki kazanir', () => {
    expect(tradeBlockReason({ ...okState, accountReady: false, amount: '' })).toBe('no-account')
    expect(tradeBlockReason({ ...okState, enabled: false, stockOk: false })).toBe('disabled')
    expect(tradeBlockReason({ ...okState, amount: '', quote: { state: 'error' } })).toBe('enter-amount')
    expect(tradeBlockReason({ ...okState, balance: '1', quote: { state: 'locked', lockReason: 'MARKET_CLOSED' } })).toBe('insufficient-balance')
  })
  it('bos girdi cokmez', () => {
    expect(tradeBlockReason()).toBe('disabled')
  })
})

describe('primaryAction', () => {
  it('onchain -> approve, digerleri -> trade', () => {
    expect(primaryAction({ approval: { mode: 'onchain' } })).toBe('approve')
    expect(primaryAction({ approval: { mode: 'permit' } })).toBe('trade')
    expect(primaryAction({ approval: { mode: 'none' } })).toBe('trade')
    expect(primaryAction(null)).toBe('trade')
  })
})

describe('formatAmount', () => {
  it('yuvarlamaz, keser', () => {
    expect(formatAmount('263447862041645538', 18)).toBe('0.263447')
    expect(formatAmount('999999999999999999', 18, 2)).toBe('0.99')
    expect(formatAmount('0', 18)).toBe('0')
    expect(formatAmount('1500000', 6)).toBe('1.5')
    expect(formatAmount('2000000', 6)).toBe('2')
    expect(formatAmount('123456789000000000000000000', 18)).toBe('123456789')
  })
  it('pozitif ama sifira kesilen tutar <esik gosterir', () => {
    expect(formatAmount('1', 18)).toBe('<0.000001')
    expect(formatAmount('1', 18, 2)).toBe('<0.01')
    expect(formatAmount('1', 18, 0)).toBe('<1')
  })
  it('ustel gosterim yok, bozuk girdi -', () => {
    expect(formatAmount('10000000000000000000000000000', 18)).not.toMatch(/e/i)
    expect(formatAmount('abc', 18)).toBe('-')
  })
})

describe('formatLocalTime', () => {
  it('formatLocalTime bozuk -> null, gecerli -> gun + saat:dakika', () => {
    expect(formatLocalTime('bozuk', 'en-US')).toBeNull()
    expect(formatLocalTime(null, 'en-US')).toBeNull()
    expect(formatLocalTime(undefined, 'tr-TR')).toBeNull()
    expect(formatLocalTime('2026-10-19T13:30:00.000Z', 'en-US')).toMatch(/^\p{L}+\.?,?\s+\d{1,2}:\d{2}/u)
  })
})

describe('lockLine', () => {
  it('PRICE_PROTECTION Al / Sat anahtar ayrimi', () => {
    expect(lockLine({ lockReason: 'PRICE_PROTECTION', side: 'buy', gapPct: 2.46 })).toEqual({
      key: 'stockTrade.lock.PRICE_PROTECTION_BUY', params: { pct: '2.5' },
    })
    expect(lockLine({ lockReason: 'PRICE_PROTECTION', side: 'sell', gapPct: 3 }).key).toBe('stockTrade.lock.PRICE_PROTECTION_SELL')
  })
  it('MARKET_CLOSED gecerli zamanla / zamansiz', () => {
    const t = lockLine({ lockReason: 'MARKET_CLOSED', side: 'buy', nextChangeAt: '2026-10-19T13:30:00.000Z', locale: 'en-US' })
    expect(t.key).toBe('stockTrade.lock.MARKET_CLOSED')
    expect(t.params.time).toMatch(/\d{1,2}:\d{2}/)
    for (const nextChangeAt of [null, 'bozuk', undefined]) {
      expect(lockLine({ lockReason: 'MARKET_CLOSED', side: 'buy', nextChangeAt })).toEqual({
        key: 'stockTrade.lock.MARKET_CLOSED_NOTIME', params: {},
      })
    }
  })
  it('FEE_DEBT kendi anahtari (REFERENCE_MISSING metnine dusmez)', () => {
    expect(lockLine({ lockReason: 'FEE_DEBT', side: 'buy' })).toEqual({ key: 'stockTrade.atsFee.debtLock', params: {} })
    expect(lockLine({ lockReason: 'FEE_DEBT', side: 'sell' }).key).not.toBe('stockTrade.lock.REFERENCE_MISSING')
  })
  it('MARKET_UNKNOWN ve REFERENCE_MISSING kendi anahtari', () => {
    expect(lockLine({ lockReason: 'MARKET_UNKNOWN' }).key).toBe('stockTrade.lock.MARKET_UNKNOWN')
    expect(lockLine({ lockReason: 'REFERENCE_MISSING' }).key).toBe('stockTrade.lock.REFERENCE_MISSING')
  })
})

describe('quoteRows', () => {
  const result = {
    success: true,
    locked: false,
    display: {
      side: 'buy', sellAmount: '100000000', sellDecimals: 6, expectedBuy: '263447862041645538', minBuy: '262130622731437310',
      buyDecimals: 18, unitPrice: 379.5, referencePrice: 378, gapPct: 0.4,
      fees: { networkUsd: 0.1, cowUsd: 0.2, watsUsd: 0.3, totalUsd: 0.6, networkSharePct: 1 },
    },
    notice: { state: 'closed', nextChangeAt: '2026-10-19T13:30:00.000Z' },
    warnings: [{ code: 'MARKET_CLOSED', nextChangeAt: '2026-10-19T13:30:00.000Z' }],
  }
  it('Al satirlari', () => {
    const r = quoteRows({ result, side: 'buy', symbol: 'AAPLx', paySymbol: 'USDC', locale: 'en-US' })
    expect(r.primary).toEqual({ labelKey: 'stockTrade.quote.estimate', value: '0.263447 AAPLx' })
    expect(r.minimum).toEqual({ labelKey: 'stockTrade.quote.minimum', value: '0.26213 AAPLx' })
    expect(r.spend).toEqual({ labelKey: 'stockTrade.quote.pay', value: '100 USDC' })
    expect(r.unitPrice).toBe('$379.50')
    expect(r.reference).toBe('$378.00')
    expect(r.gap).toEqual({ key: 'stockTrade.quote.gap', pct: '+0.40%' })
    expect(r.fees.map((f) => f.labelKey)).toEqual(['stockTrade.quote.feeNetwork', 'stockTrade.quote.feeCow', 'stockTrade.quote.feeWats'])
    expect(r.fees.map((f) => f.usd)).toEqual(['$0.10', '$0.20', '$0.30'])
    expect(r.feesTotalUsd).toBe('$0.60')
    expect(r.notice.key).toBe('stockTrade.notice.closed')
    expect(r.notice.time).toMatch(/\d{1,2}:\d{2}/)
    expect(r.warnings[0].key).toBe('stockTrade.lock.MARKET_CLOSED')
  })
  it('ag ucreti satiri: dolar ve yuzde, tr / en bicimi', () => {
    const withFee = { ...result, display: { ...result.display, networkFeeUsd: 0.62, networkFeePct: 6.2 } }
    const en = quoteRows({ result: withFee, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'en-US' })
    expect(en.networkFee).toEqual({ key: 'stockTrade.quote.networkFeeLine', params: { fee: '$0.62', pct: '6.2' } })
    const tr = quoteRows({ result: withFee, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'tr-TR' })
    expect(tr.networkFee.params).toEqual({ fee: '$0,62', pct: '6,2' })
  })
  describe('secili para birimi (display)', () => {
    const withFee = { ...result, display: { ...result.display, networkFeeUsd: 0.62, networkFeePct: 6.2 } }
    const rows = (res, extra = {}) => quoteRows({ result: res, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'en-US', ...extra })
    it('quoteRows varsayilan USD: unitPrice "$…", fees "$…", networkFee.params.fee "$0.62"', () => {
      const r = rows(withFee)
      expect(r.unitPrice).toBe('$379.50')
      expect(r.reference).toBe('$378.00')
      expect(r.fees.map((f) => f.usd)).toEqual(['$0.10', '$0.20', '$0.30'])
      expect(r.feesTotalUsd).toBe('$0.60')
      expect(r.networkFee.params.fee).toBe('$0.62')
      // display verilmesi (USD) ile verilmemesi ayni sonucu verir.
      expect(rows(withFee, { display: USD_DISPLAY })).toEqual(r)
    })
    it('quoteRows display try/kur 40 + tr: unitPrice ve fees ₺, networkFee.params.fee "₺24,80"', () => {
      const r = rows(withFee, { display: TRY_40, locale: 'tr-TR' })
      expect(norm(r.unitPrice)).toBe('₺15.180,00')
      expect(norm(r.reference)).toBe('₺15.120,00')
      expect(r.fees.map((f) => norm(f.usd))).toEqual(['₺4,00', '₺8,00', '₺12,00'])
      expect(norm(r.feesTotalUsd)).toBe('₺24,00')
      expect(norm(r.networkFee.params.fee)).toBe('₺24,80')
      expect(r.networkFee.params.pct).toBe('6,2')
      // Hicbir satirda eski "$" kalmaz.
      expect(JSON.stringify(r)).not.toContain('$')
    })
    it('quoteRows display fellBack: "USD 0.62" kod etiketli, "₺" ve "$" yok', () => {
      const r = rows(withFee, { display: FELL_BACK })
      expect(norm(r.unitPrice)).toBe('USD 379.50')
      expect(norm(r.fees[0].usd)).toBe('USD 0.10')
      expect(norm(r.feesTotalUsd)).toBe('USD 0.60')
      expect(norm(r.networkFee.params.fee)).toBe('USD 0.62')
      expect(JSON.stringify(r)).not.toMatch(/[$₺]/)
    })
    it('stil kurali: birim fiyat "price" (kucuk fiyat kesilmez), ucret "standard" (<$0.01)', () => {
      const small = { ...result, display: { ...result.display, unitPrice: 0.0042, referencePrice: 0.0000005, fees: { networkUsd: 0.004, cowUsd: 0, watsUsd: 0.5, totalUsd: 0.504 } } }
      const r = rows(small)
      expect(r.unitPrice).toBe('$0.0042')
      expect(r.reference).toBe('<$0.000001')
      expect(r.fees.map((f) => f.usd)).toEqual(['<$0.01', '$0.00', '$0.50'])
    })
    it('gecersiz fee → "-" ve networkFee null (NaN, null, "", Infinity; "$0.00" yazilmaz)', () => {
      for (const bad of [NaN, null, undefined, '', Infinity]) {
        const r = rows({ ...result, display: { ...result.display, unitPrice: bad, referencePrice: bad, fees: { networkUsd: bad, cowUsd: bad, watsUsd: bad, totalUsd: bad }, networkFeeUsd: bad, networkFeePct: 6.2 } }, { display: TRY_40 })
        expect(r.unitPrice).toBe('-')
        expect(r.reference).toBe('-')
        expect(r.fees.map((f) => f.usd)).toEqual(['-', '-', '-'])
        expect(r.feesTotalUsd).toBe('-')
        expect(r.networkFee).toBeNull()
      }
    })
    it('kuru gecersiz gorunum (0, eksi, NaN) ekrana yanlis para yazmaz: "-"', () => {
      for (const rate of [0, -1, NaN]) {
        const r = rows(withFee, { display: { code: 'try', rate, fellBack: false } })
        expect(r.unitPrice).toBe('-')
        expect(r.networkFee).toBeNull()
      }
    })
  })
  it('ag ucreti verisi yoksa satir yok', () => {
    expect(quoteRows({ result, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'en-US' }).networkFee).toBeNull()
    const bad = { ...result, display: { ...result.display, networkFeeUsd: NaN, networkFeePct: 6 } }
    expect(quoteRows({ result: bad, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'en-US' }).networkFee).toBeNull()
  })
  it('feeWarning: uyari satiri yuzde ile; BSC disinda ek cumle anahtari, BSC (56) de yok', () => {
    const warn = { ...result, display: { ...result.display, networkFeeUsd: 3.5, networkFeePct: 35, feeWarning: true } }
    const eth = quoteRows({ result: warn, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'en-US', chainId: 1 })
    expect(eth.feeWarning).toEqual({ key: 'stockTrade.quote.feeWarning', params: { pct: '35.0' }, extraKey: 'stockTrade.quote.feeWarningBsc' })
    expect(quoteRows({ result: warn, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'tr-TR', chainId: 1 }).feeWarning.params).toEqual({ pct: '35,0' })
    expect(quoteRows({ result: warn, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'en-US', chainId: 42161 }).feeWarning.extraKey).toBe('stockTrade.quote.feeWarningBsc')
    expect(quoteRows({ result: warn, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'en-US', chainId: 56 }).feeWarning.extraKey).toBeNull()
  })
  it('feeWarning yoksa / false ise ya da yuzde okunamazsa uyari yok', () => {
    const q = (display) => quoteRows({ result: { ...result, display: { ...result.display, ...display } }, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'en-US', chainId: 1 })
    expect(q({ networkFeeUsd: 0.5, networkFeePct: 5, feeWarning: false }).feeWarning).toBeNull()
    expect(q({ networkFeeUsd: 0.5, networkFeePct: 5 }).feeWarning).toBeNull()
    expect(q({ networkFeePct: NaN, feeWarning: true }).feeWarning).toBeNull()
  })
  it('Sat tarafinda alinan odeme tokenidir', () => {
    const sell = { ...result, display: { ...result.display, side: 'sell', sellAmount: '263447862041645538', sellDecimals: 18, expectedBuy: '99000000', minBuy: '98000000', buyDecimals: 6 }, notice: { state: 'open', nextChangeAt: null }, warnings: [] }
    const r = quoteRows({ result: sell, side: 'sell', symbol: 'AAPLx', paySymbol: 'USDC', locale: 'en-US' })
    expect(r.primary.value).toBe('99 USDC')
    expect(r.minimum.value).toBe('98 USDC')
    expect(r.spend).toEqual({ labelKey: 'stockTrade.quote.sell', value: '0.263447 AAPLx' })
    expect(r.notice).toBeNull()
    expect(r.warnings).toEqual([])
  })
  it('display yoksa null; bozuk sayilar tire', () => {
    expect(quoteRows({ result: { success: true, locked: true, display: null }, side: 'buy' })).toBeNull()
    const r = quoteRows({ result: { ...result, display: { ...result.display, unitPrice: null, gapPct: NaN, fees: {} } }, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'en-US' })
    expect(r.unitPrice).toBe('-')
    expect(r.gap).toBeNull()
    expect(r.feesTotalUsd).toBe('-')
  })
})

describe('stockTrade.js kaynak taramasi', () => {
  const kaynak = yorumsuz(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'stockTrade.js'), 'utf8'))
  it('Number( ile tutar hesabi yok', () => {
    expect(kaynak).not.toMatch(/Number\(/)
    expect(kaynak).not.toMatch(/parseFloat\(/)
  })
  it('BigInt( yalniz formatAmount icinde', () => {
    const yerler = [...kaynak.matchAll(/BigInt\(/g)].map((m) => m.index)
    expect(yerler.length).toBe(1)
    const bas = kaynak.indexOf('export function formatAmount')
    const son = kaynak.indexOf('export function formatLocalTime')
    expect(yerler[0]).toBeGreaterThan(bas)
    expect(yerler[0]).toBeLessThan(son)
  })
  it('chrome. ve window. yok', () => {
    expect(kaynak).not.toMatch(/chrome\./)
    expect(kaynak).not.toMatch(/window\./)
  })
  it('yerel USD bicimleyici ve elle "$" kalmadi: tutar yalniz money.js formatMoney tan gelir', () => {
    expect(kaynak).not.toMatch(/export function formatUsd/)
    expect(kaynak).not.toMatch(/currency:\s*'USD'/)
    expect(kaynak).not.toContain("'$'")
    expect(kaynak).not.toMatch(/\$\$\{/)
    expect(kaynak).toMatch(/formatMoney/)
  })
})

describe('smallAmountHint (CoW "tutar ucreti karsilamiyor" hatasi icin ipucu)', () => {
  it('AMOUNT_TOO_SMALL + BSC disi zincir: ana metin + BSC ek cumlesi', () => {
    for (const chainId of [1, 42161]) {
      expect(smallAmountHint({ chainId, errorCode: 'AMOUNT_TOO_SMALL' })).toEqual({
        key: 'stockTrade.hint.amountBelowFee',
        extraKey: 'stockTrade.hint.bscCheap',
      })
    }
  })
  it('BSC (56): ek cumle yok', () => {
    expect(smallAmountHint({ chainId: 56, errorCode: 'AMOUNT_TOO_SMALL' })).toEqual({ key: 'stockTrade.hint.amountBelowFee', extraKey: null })
  })
  it('tutar / zincir tablosu YOK: buyuk tutarda da, sabit tablo disi zincirde de ayni ipucu', () => {
    expect(smallAmountHint({ chainId: 1, errorCode: 'AMOUNT_TOO_SMALL', amount: '100000' }).key).toBe('stockTrade.hint.amountBelowFee')
    expect(smallAmountHint({ chainId: 137, errorCode: 'AMOUNT_TOO_SMALL' }).extraKey).toBe('stockTrade.hint.bscCheap')
  })
  it('neden filtresi: yalniz AMOUNT_TOO_SMALL hatasi', () => {
    for (const errorCode of ['NO_LIQUIDITY', 'NETWORK', 'REJECTED', null, undefined]) {
      expect(smallAmountHint({ chainId: 1, errorCode })).toBeNull()
    }
    expect(smallAmountHint()).toBeNull()
  })
  describe('ag ucreti, en az tutar ve eksik miktar (errorInfo)', () => {
    const info = { feeDisplay: '1.41', feeUsd: '1.41', minAmountDisplay: '1.69', missingDisplay: '1.19' }
    it('bilgi + sembol varsa sayili metin, params ve ham minAmount', () => {
      expect(smallAmountHint({ chainId: 1, errorCode: 'AMOUNT_TOO_SMALL', errorInfo: info, symbol: 'USDC' })).toEqual({
        key: 'stockTrade.hint.amountMin',
        params: { fee: '1.41', feeUsd: '$1.41', symbol: 'USDC', min: '1.69', missing: '1.19' },
        extraKey: 'stockTrade.hint.bscCheap',
        minAmount: '1.69',
      })
    })
    it('feeUsd yoksa parantezsiz anahtar', () => {
      const r = smallAmountHint({ chainId: 56, errorCode: 'AMOUNT_TOO_SMALL', errorInfo: { ...info, feeUsd: undefined }, symbol: 'TSLAx' })
      expect(r.key).toBe('stockTrade.hint.amountMinNoUsd')
      expect(r.extraKey).toBeNull()
      expect(r.params.symbol).toBe('TSLAx')
    })
    it('Turkce ondalik ayraci yalniz gosterimde (virgul); minAmount noktali kalir', () => {
      const r = smallAmountHint({ chainId: 1, errorCode: 'AMOUNT_TOO_SMALL', errorInfo: info, symbol: 'USDC', locale: 'tr' })
      expect(r.params).toMatchObject({ fee: '1,41', feeUsd: '$1,41', min: '1,69', missing: '1,19' })
      expect(r.minAmount).toBe('1.69')
    })
    it('feeUsd: display try/kur 40 + tr -> "₺56,40"; kur yokken "USD 1.41" (kod etiketli)', () => {
      const tr = smallAmountHint({ chainId: 1, errorCode: 'AMOUNT_TOO_SMALL', errorInfo: info, symbol: 'USDC', locale: 'tr', display: TRY_40 })
      expect(tr.key).toBe('stockTrade.hint.amountMin')
      expect(norm(tr.params.feeUsd)).toBe('₺56,40')
      // Token tutarlari (fee/min/missing) para degildir: kurdan etkilenmez.
      expect(tr.params).toMatchObject({ fee: '1,41', min: '1,69', missing: '1,19' })
      expect(tr.minAmount).toBe('1.69')
      const fell = smallAmountHint({ chainId: 1, errorCode: 'AMOUNT_TOO_SMALL', errorInfo: info, symbol: 'USDC', display: FELL_BACK })
      expect(norm(fell.params.feeUsd)).toBe('USD 1.41')
      expect(fell.params.feeUsd).not.toMatch(/[$₺]/)
    })
    it('display verilmezse USD ile ayni sonuc', () => {
      const a = smallAmountHint({ chainId: 1, errorCode: 'AMOUNT_TOO_SMALL', errorInfo: info, symbol: 'USDC' })
      expect(smallAmountHint({ chainId: 1, errorCode: 'AMOUNT_TOO_SMALL', errorInfo: info, symbol: 'USDC', display: USD_DISPLAY })).toEqual(a)
    })
    it('feeUsd yok / biçimlenemiyor (kuru gecersiz gorunum) -> amountMinNoUsd, yanlis para yazilmaz', () => {
      const dene = (extra, e = info) => smallAmountHint({ chainId: 1, errorCode: 'AMOUNT_TOO_SMALL', errorInfo: e, symbol: 'USDC', display: TRY_40, ...extra })
      expect(dene({}, { ...info, feeUsd: undefined }).key).toBe('stockTrade.hint.amountMinNoUsd')
      expect(dene({}, { ...info, feeUsd: '' }).key).toBe('stockTrade.hint.amountMinNoUsd')
      expect(dene({ display: { code: 'try', rate: 0, fellBack: false } }).key).toBe('stockTrade.hint.amountMinNoUsd')
      expect(dene({ display: { code: 'try', rate: NaN, fellBack: false } }).key).toBe('stockTrade.hint.amountMinNoUsd')
    })
    it('gecersiz bilgi / sembol yok / baska hata kodu -> genel metin ya da null', () => {
      const genel = { key: 'stockTrade.hint.amountBelowFee', extraKey: 'stockTrade.hint.bscCheap' }
      for (const errorInfo of [null, undefined, {}, { ...info, minAmountDisplay: '<b>' }, { ...info, missingDisplay: 5 }, { ...info, feeDisplay: '' }]) {
        expect(smallAmountHint({ chainId: 1, errorCode: 'AMOUNT_TOO_SMALL', errorInfo, symbol: 'USDC' })).toEqual(genel)
      }
      expect(smallAmountHint({ chainId: 1, errorCode: 'AMOUNT_TOO_SMALL', errorInfo: { ...info, feeUsd: '<b>1</b>' }, symbol: 'USDC' }).key).toBe('stockTrade.hint.amountMinNoUsd')
      expect(smallAmountHint({ chainId: 1, errorCode: 'AMOUNT_TOO_SMALL', errorInfo: info })).toEqual(genel)
      expect(smallAmountHint({ chainId: 1, errorCode: 'AMOUNT_TOO_SMALL', errorInfo: info, symbol: '' })).toEqual(genel)
      expect(smallAmountHint({ chainId: 1, errorCode: 'NO_LIQUIDITY', errorInfo: info, symbol: 'USDC' })).toBeNull()
    })
  })
  it('kaynakta yerel feeUsd ayraci / elle "$" yok; tutar money.js formatMoney tan gelir', () => {
    const kok = path.dirname(fileURLToPath(import.meta.url))
    const kaynak = yorumsuz(fs.readFileSync(path.join(kok, 'stockTradeHint.js'), 'utf8'))
    expect(kaynak).toMatch(/formatMoney/)
    expect(kaynak).not.toContain("'$'")
    expect(kaynak).not.toMatch(/\$\$\{/)
  })
  it('hicbir ipucu metninde sabit "~100" tablosu kalmadi (kaynak + sozluk)', () => {
    const kok = path.dirname(fileURLToPath(import.meta.url))
    const kaynak = fs.readFileSync(path.join(kok, 'stockTradeHint.js'), 'utf8')
    expect(kaynak).not.toMatch(/MIN_USD_BY_CHAIN|~100|100:/)
    for (const dil of ['en', 'tr']) {
      const m = fs.readFileSync(path.join(kok, '..', 'i18n', 'locales', `${dil}.json`), 'utf8')
      expect(m).not.toContain('~100')
      expect(m).not.toContain('"minAmount"')
    }
  })
})

describe('hesaplanmis tutar metinleri sozlukte "$" icermez (Plan B Gorev 12)', () => {
  const sozluk = { en: enMsg, tr: trMsg }
  const cevir = (locale, key, params) => createI18n({ legacy: false, locale, messages: sozluk }).global.t(key, params)
  const result = {
    success: true,
    locked: false,
    display: {
      side: 'buy', sellAmount: '100000000', sellDecimals: 6, expectedBuy: '263447862041645538', minBuy: '262130622731437310',
      buyDecimals: 18, unitPrice: 379.5, referencePrice: 378, gapPct: 0.4,
      fees: { networkUsd: 0.1, cowUsd: 0.2, watsUsd: 0.3, totalUsd: 0.6 }, networkFeeUsd: 0.62, networkFeePct: 6.2,
    },
  }
  it('networkFeeLine, amountMin ve amountMinNoUsd hicbir dilde "$" icermez; sembol param tutardan gelir', () => {
    for (const [dil, m] of Object.entries(sozluk)) {
      expect(m.stockTrade.quote.networkFeeLine, dil).not.toContain('$')
      expect(m.stockTrade.hint.amountMin, dil).not.toContain('$')
      expect(m.stockTrade.hint.amountMinNoUsd, dil).not.toContain('$')
    }
    expect(enMsg.stockTrade.quote.networkFeeLine).toBe('Network fee: {fee} ({pct}%)')
    expect(trMsg.stockTrade.quote.networkFeeLine).toBe('Ağ ücreti: {fee} (%{pct})')
    expect(enMsg.stockTrade.hint.amountMin).toBe('Network fee ~{fee} {symbol} (~{feeUsd}). Enter at least {min} {symbol}; {missing} {symbol} short.')
    expect(trMsg.stockTrade.hint.amountMin).toBe('Ağ ücreti ~{fee} {symbol} (~{feeUsd}). En az {min} {symbol} girmelisin; {missing} {symbol} eksik.')
  })
  it('networkFeeLine render: USD "Network fee: $0.62 (6.2%)", TL "Ağ ücreti: ₺24,80 (%6,2)"', () => {
    const usd = quoteRows({ result, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'en' }).networkFee
    expect(cevir('en', usd.key, usd.params)).toBe('Network fee: $0.62 (6.2%)')
    const tl = quoteRows({ result, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'tr', display: TRY_40 }).networkFee
    expect(norm(cevir('tr', tl.key, tl.params))).toBe('Ağ ücreti: ₺24,80 (%6,2)')
    const kodlu = quoteRows({ result, side: 'buy', symbol: 'A', paySymbol: 'B', locale: 'en', display: FELL_BACK }).networkFee
    expect(norm(cevir('en', kodlu.key, kodlu.params))).toBe('Network fee: USD 0.62 (6.2%)')
  })
  it('amountMin render: USD "(~$1.41)", TL "(~₺56,40)", feeUsd yokken parantezsiz', () => {
    const info = { feeDisplay: '1.41', feeUsd: '1.41', minAmountDisplay: '1.69', missingDisplay: '1.19' }
    const dene = (locale, display, errorInfo = info) => {
      const h = smallAmountHint({ chainId: 56, errorCode: 'AMOUNT_TOO_SMALL', errorInfo, symbol: 'USDC', locale, display })
      return norm(cevir(locale, h.key, h.params))
    }
    expect(dene('en')).toBe('Network fee ~1.41 USDC (~$1.41). Enter at least 1.69 USDC; 1.19 USDC short.')
    expect(dene('tr', TRY_40)).toBe('Ağ ücreti ~1,41 USDC (~₺56,40). En az 1,69 USDC girmelisin; 1,19 USDC eksik.')
    expect(dene('en', FELL_BACK)).toBe('Network fee ~1.41 USDC (~USD 1.41). Enter at least 1.69 USDC; 1.19 USDC short.')
    expect(dene('en', TRY_40, { ...info, feeUsd: undefined })).toBe('Network fee ~1.41 USDC. Enter at least 1.69 USDC; 1.19 USDC short.')
  })
})

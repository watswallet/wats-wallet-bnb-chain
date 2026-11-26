// Gorev 7: lcxEngine (LCX hisseleri, RWA). chrome stub'i ile: arka plan GERCEK cagrilmaz, mesajlar sayilir.
// Desen: pancakeEngine.test.js ('arayuz' / quote / place). Tablodaki her eslesme satiri ayri bir vaka.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { BSTOCKS } from '../../../data/bStocks'
import { _resetLcxStockRows, setLcxStockRows } from '../../tokenizedStocks'
import { LCX_PAY_TOKENS } from '../../lcx/payTokens'
import { gateLockedReply } from '../../stockGate/errors'
import { ENGINE_ERROR } from './errors'
import { LCX_PLACE_FIELDS, LCX_PLACE_OPTIONAL_FIELDS, LCX_QUOTE_TTL_MS, createLcxEngine, lcxEngine, lcxReplyCode } from './lcxEngine'
import { pancakeEngine } from './pancakeEngine'

const NOW = 1_800_000_000_000
const TSLAC = '0xb2000000000000000000001e800a7f5189430cD0' // Base, 8 ondalik
const AAPLO = '0x3333333333333333333333333333333333333333' // BSC, 18 ondalik
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const BASE_USDT = '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2'
const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955'
const BSTOCK = BSTOCKS[0].address // statik katalog (BSC); LCX satiri DEGIL
const DERIVATION = "m/44'/60'/0'/0/0"
const IMPORTED = '0x1234567890123456789012345678901234567890'
const ATS_QUOTED = { transferFee: 0.4, commissionFee: 0.1 }

const row = (over = {}) => ({
  issuer: 'Coinbase', chainId: 8453, address: TSLAC, symbol: 'TSLAC', name: 'Tesla (Coinbase)', decimals: 8,
  underlying: 'TSLA', priceUsd: 388.6, marketHours: 'us_equities', ...over,
})

// Base TSLAC alimi: 2 USDC -> 0.00513279 TSLAC (fikstur rwa-quote-base.json ile ayni sayilar)
const lcxQuote = (over = {}) => ({
  kind: 'rwa', quoteId: 'q_abc123', chainId: 8453, tokenIn: BASE_USDC, tokenOut: TSLAC, amountIn: '2000000',
  amountOut: '513279', minOut: '510712', slippageBps: 50, expiresAt: NOW / 1000 + 120,
  spender: '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0',
  rwa: { issuer: 'coinbase', marketOpen: false, refDeviationBps: -26.66, referenceUsd: 388.61280861, symbol: 'TSLAC', underlying: 'TSLA' },
  ...over,
})
const quoteData = (over = {}) => ({
  expectedOutput: '0.00513279',
  slippageTolerance: '0.50%',
  minimumReceived: '0.00510712',
  depthGateWarning: false,
  priceImpact: '0.02%',
  liquidityProviderFee: 'N/A',
  exchangeRate: '0.002566',
  reverseExchangeRate: '389.6',
  estimatedGasFee: { totalCost: null, totalCostFormatted: null, totalCostUSD: null, gasType: 'Estimated' },
  routerType: { name: 'lcx' },
  lcxQuote: lcxQuote(),
  ...over,
})
// Satis: 0.00513279 TSLAC -> 1.99 USDC
const sellData = () => quoteData({
  expectedOutput: '1.99', minimumReceived: '1.98',
  lcxQuote: lcxQuote({ tokenIn: TSLAC, tokenOut: BASE_USDC, amountIn: '513279', amountOut: '1990000', minOut: '1980000' }),
})

let send
let storage
let currentReplies

function installChrome({ replies = {}, active = { type: 'derived', derivationPath: DERIVATION, address: '0xabc' }, slippage } = {}) {
  storage = { active_account: active, ...(slippage === undefined ? {} : { swap_slippage: slippage }) }
  currentReplies = replies // degistirilebilir: place testleri yanitlari chrome yeniden kurulmadan degistirir
  send = vi.fn(async ({ type }) => {
    const r = currentReplies[type]
    if (typeof r === 'function') return r()
    return r
  })
  globalThis.chrome = {
    runtime: { sendMessage: send },
    storage: { local: { get: vi.fn(async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in storage).map((k) => [k, storage[k]]))) } },
  }
}

const buyReq = (extra = {}) =>
  lcxEngine.buildQuoteMessage({ side: 'buy', chainId: 8453, stockAddress: TSLAC, payToken: { address: BASE_USDC }, amount: '2', ...extra })
const sellReq = (extra = {}) =>
  lcxEngine.buildQuoteMessage({ side: 'sell', chainId: 8453, stockAddress: TSLAC, payToken: { address: BASE_USDC }, amount: '0.00513279', ...extra })
const sentOf = (type) => send.mock.calls.map((c) => c[0]).filter((m) => m.type === type)

beforeEach(() => {
  // Varsayilan motor Date.now kullanir: sabit saat, fikstur omru (NOW + 120 sn) bir gun gecmise dusmesin.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  setLcxStockRows([row(), row({ issuer: 'Ondo', chainId: 56, address: AAPLO, symbol: 'AAPLo', decimals: 18, underlying: 'AAPL' })], { usEquitiesOpen: false })
})

afterEach(() => {
  delete globalThis.chrome
  _resetLcxStockRows()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('arayuz', () => {
  it('bayraklar ve dondurulmus motor', () => {
    expect(lcxEngine).toMatchObject({
      id: 'lcx', hasApprovalStep: false, hasPriceImpactGate: false, hasReferenceLock: false,
      hasOrderLifecycle: false, showsCowDisclosure: false, usesAts: true,
    })
    expect(Object.isFrozen(lcxEngine)).toBe(true)
    expect(createLcxEngine()).not.toBe(lcxEngine)
  })
  it('motor alanlari pancake ile ayni fonksiyon kumesi', () => {
    for (const k of ['payTokens', 'buildQuoteMessage', 'quote', 'atsPayload', 'quoteRows', 'primaryAction', 'place', 'errorKey']) {
      expect(typeof lcxEngine[k]).toBe('function')
      expect(typeof pancakeEngine[k]).toBe('function')
    }
  })
  it.each(Object.keys(LCX_PAY_TOKENS).map(Number))('payTokens(%i): sira USDC, USDT, native; adres ve ondalik tablodaki gibi', (chainId) => {
    const t = lcxEngine.payTokens(chainId)
    expect(t).toHaveLength(3)
    expect(t.map((x) => x.address)).toEqual(LCX_PAY_TOKENS[chainId].map((x) => x.address))
    expect(t.map((x) => x.decimals)).toEqual(LCX_PAY_TOKENS[chainId].map((x) => x.decimals))
    expect(t.map((x) => x.symbol)).toEqual(LCX_PAY_TOKENS[chainId].map((x) => x.symbol))
    expect(t[0].symbol).toMatch(/^USDC/)
    expect(t[1].symbol).toBe('USDT')
    expect(t[2]).toMatchObject({ address: '0x0', decimals: 18, native: true })
    expect(t[0].native).toBeUndefined()
    expect(t[1].native).toBeUndefined()
  })
  it('payTokens: Base USDC adresi ve ondaligi, BSC USDT ondaligi 18, native adresi 0x0', () => {
    const base = lcxEngine.payTokens(8453)
    expect(base[0]).toEqual({ symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 })
    expect(base[2]).toEqual({ symbol: 'ETH', address: '0x0', decimals: 18, native: true })
    const bsc = lcxEngine.payTokens(56)
    expect(bsc[1]).toEqual({ symbol: 'USDT', address: BSC_USDT, decimals: 18 })
    expect(bsc[2].symbol).toBe('BNB')
    expect(lcxEngine.payTokens(137)[2].symbol).toBe('POL')
    expect(lcxEngine.payTokens(100)[0].symbol).toBe('USDC.e')
  })
  it('payTokens: bilinmeyen zincir / tip bos dizi; donen nesne tabloyu degistirmez', () => {
    for (const bad of [5000, 0, -1, '8453', null, undefined, 'constructor', '__proto__']) expect(lcxEngine.payTokens(bad)).toEqual([])
    const t = lcxEngine.payTokens(8453)
    t[0].decimals = 99
    expect(LCX_PAY_TOKENS[8453][0].decimals).toBe(6)
  })
  it('primaryAction her zaman trade; errorKey kapali kume', () => {
    expect(lcxEngine.primaryAction({ approval: { mode: 'onchain' } })).toBe('trade')
    expect(lcxEngine.primaryAction({})).toBe('trade')
    expect(lcxEngine.primaryAction()).toBe('trade')
    expect(lcxEngine.errorKey('NO_ROUTE')).toBe('stockTrade.error.NO_ROUTE')
    expect(lcxEngine.errorKey('garip')).toBe('stockTrade.error.UNKNOWN')
  })
  it.each([
    'REF_PRICE_OFF', 'NO_REFERENCE_PRICE', 'INSUFFICIENT_LIQUIDITY', 'RWA_EXCLUDED', 'ISSUER_MISMATCH', 'LCX_UNAVAILABLE', 'LCX_TX_REJECTED',
  ])('errorKey: yeni kod %s kendi anahtarina gider', (code) => {
    expect(lcxEngine.errorKey(code)).toBe(`stockTrade.error.${code}`)
  })
  it('errorKey: CoW a ozgu ag metni gorunmez (pancake ile ayni)', () => {
    for (const code of [ENGINE_ERROR.NETWORK, ENGINE_ERROR.TIMEOUT, ENGINE_ERROR.SERVER]) {
      expect(lcxEngine.errorKey(code)).toBe('stockTrade.error.NETWORK_GENERIC')
    }
    expect(lcxEngine.errorKey(ENGINE_ERROR.FORBIDDEN)).toBe('stockTrade.error.UNKNOWN')
  })
})

describe('buildQuoteMessage', () => {
  it('Al: odeme tokeni girdi, hisse cikti; tum alanlar tam kume', () => {
    const r = buyReq({ index: DERIVATION, slippage: 1 })
    expect(Object.keys(r).sort()).toEqual(
      ['amount', 'chainId', 'inTokenAddress', 'index', 'lcxKind', 'outTokenAddress', 'payToken', 'side', 'slippage', 'stockAddress'],
    )
    expect(r).toEqual({
      index: DERIVATION, chainId: 8453, inTokenAddress: BASE_USDC, outTokenAddress: TSLAC, amount: '2', slippage: 1,
      side: 'buy', lcxKind: 'rwa', stockAddress: TSLAC, payToken: BASE_USDC,
    })
  })
  it('Sat: hisse girdi, odeme tokeni cikti', () => {
    const r = sellReq({ index: DERIVATION, slippage: 1 })
    expect(r).toEqual({
      index: DERIVATION, chainId: 8453, inTokenAddress: TSLAC, outTokenAddress: BASE_USDC, amount: '0.00513279', slippage: 1,
      side: 'sell', lcxKind: 'rwa', stockAddress: TSLAC, payToken: BASE_USDC,
    })
  })
  it('index ve slippage yoksa anahtar da yok (quote depodan tamamlar)', () => {
    const r = buyReq()
    expect(r).not.toHaveProperty('index')
    expect(r).not.toHaveProperty('slippage')
    expect(r.lcxKind).toBe('rwa')
  })
  it('bozuk slippage / bos index yok sayilir', () => {
    for (const slippage of [-3, 0, NaN, 'x', null]) expect(buyReq({ slippage })).not.toHaveProperty('slippage')
    expect(buyReq({ index: '' })).not.toHaveProperty('index')
    expect(buyReq({ index: 5 })).not.toHaveProperty('index')
  })
  it('odeme tokeni dize adres olarak da kabul edilir; kucuk harf adres tablodaki yazimina cevrilir', () => {
    expect(buyReq({ payToken: BASE_USDC }).inTokenAddress).toBe(BASE_USDC)
    expect(buyReq({ payToken: BASE_USDC.toLowerCase() }).inTokenAddress).toBe(BASE_USDC)
    expect(buyReq({ payToken: { address: BASE_USDT } }).payToken).toBe(BASE_USDT)
  })
  it('native odeme: 0x0 / sifir adres / 0xEeee -> 0x0', () => {
    for (const address of ['0x0', '0x0000000000000000000000000000000000000000', '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE']) {
      const r = buyReq({ payToken: { address } })
      expect(r.inTokenAddress).toBe('0x0')
      expect(r.payToken).toBe('0x0')
      expect(r.outTokenAddress).toBe(TSLAC)
      const s = sellReq({ payToken: address })
      expect(s.outTokenAddress).toBe('0x0')
      expect(s.inTokenAddress).toBe(TSLAC)
    }
  })
  it('hisse adresi istenen yazimla kalir; BSC satiri 18 ondalikli hisse icin de kurulur', () => {
    expect(buyReq({ stockAddress: TSLAC.toLowerCase() }).outTokenAddress).toBe(TSLAC.toLowerCase())
    const bsc = lcxEngine.buildQuoteMessage({ side: 'buy', chainId: 56, stockAddress: AAPLO, payToken: { address: BSC_USDT }, amount: '5' })
    expect(bsc).toMatchObject({ chainId: 56, inTokenAddress: BSC_USDT, outTokenAddress: AAPLO })
  })
  it('tutar temizlenir: sondaki sifirlar atilir, ondalik degeri degismez', () => {
    expect(buyReq({ amount: '10.500' }).amount).toBe('10.5')
    expect(buyReq({ amount: '0.00000001' }).amount).toBe('0.00000001')
    expect(buyReq({ amount: '100' }).amount).toBe('100')
  })
  it('gecersiz girdi null: yon, zincir, hisse adresi, odeme tokeni, tutar', () => {
    expect(buyReq({ side: 'hold' })).toBeNull()
    expect(buyReq({ side: undefined })).toBeNull()
    expect(buyReq({ chainId: 5000 })).toBeNull()
    expect(buyReq({ chainId: '8453' })).toBeNull()
    expect(buyReq({ stockAddress: 'zzz' })).toBeNull()
    expect(buyReq({ stockAddress: '0x1111111111111111111111111111111111111111' })).toBeNull() // LCX satiri degil
    expect(buyReq({ stockAddress: undefined })).toBeNull()
    expect(buyReq({ payToken: { address: '0x4200000000000000000000000000000000000006' } })).toBeNull() // WETH: odeme tablosunda yok
    expect(buyReq({ payToken: null })).toBeNull()
    expect(buyReq({ payToken: undefined })).toBeNull()
    expect(buyReq({ payToken: { address: '' } })).toBeNull()
    expect(buyReq({ payToken: { address: BSC_USDT } })).toBeNull() // baska agin tokeni
    for (const amount of ['', '0', '0.0', '-1', '1e3', 'abc', 5, null, undefined, '1,5']) expect(buyReq({ amount })).toBeNull()
  })
  it('bStocks / xStocks adresi ve statik katalog hissesi LCX motoruna girmez', () => {
    // BSC'deki bStocks adresi LCX satiri degil (statik katalog kazanir)
    expect(lcxEngine.buildQuoteMessage({ side: 'buy', chainId: 56, stockAddress: BSTOCK, payToken: { address: BSC_USDT }, amount: '1' })).toBeNull()
  })
  it('hic argumansiz null', () => {
    expect(lcxEngine.buildQuoteMessage()).toBeNull()
  })
})

describe('atsPayload', () => {
  const resolved = () => ({ ...buyReq({ index: DERIVATION, slippage: 0.5 }), lcxQuote: lcxQuote() })
  it('tam alan kumesi: lcxKind, lcxQuote ve side (R1) dahil; display/odeme alanlari yok', () => {
    const p = lcxEngine.atsPayload(resolved())
    expect(p.kind).toBe('swap')
    expect(Object.keys(p.payload).sort()).toEqual(
      ['amount', 'chainId', 'inTokenAddress', 'index', 'lcxKind', 'lcxQuote', 'outTokenAddress', 'side', 'slippage'],
    )
    expect(p).toEqual({
      kind: 'swap',
      payload: {
        index: DERIVATION, chainId: 8453, inTokenAddress: BASE_USDC, outTokenAddress: TSLAC, amount: '2', slippage: 0.5,
        side: 'buy', lcxKind: 'rwa', lcxQuote: lcxQuote(),
      },
    })
  })
  it('satista side sell tasinir', () => {
    const r = { ...sellReq({ index: DERIVATION, slippage: 0.5 }), lcxQuote: lcxQuote() }
    expect(lcxEngine.atsPayload(r).payload).toMatchObject({ side: 'sell', inTokenAddress: TSLAC, outTokenAddress: BASE_USDC })
  })
  it('index / slippage cozulmemisse null (callData uyusmazligi olmasin)', () => {
    expect(lcxEngine.atsPayload({ ...buyReq(), lcxQuote: lcxQuote() })).toBeNull()
    expect(lcxEngine.atsPayload({ ...buyReq({ index: DERIVATION }), lcxQuote: lcxQuote() })).toBeNull()
    expect(lcxEngine.atsPayload({ ...buyReq({ slippage: 1 }), lcxQuote: lcxQuote() })).toBeNull()
  })
  it('teklif yok / rwa degil / yon yok / bos istek -> null', () => {
    expect(lcxEngine.atsPayload(null)).toBeNull()
    expect(lcxEngine.atsPayload(undefined)).toBeNull()
    expect(lcxEngine.atsPayload(buyReq({ index: DERIVATION, slippage: 1 }))).toBeNull() // lcxQuote yok
    expect(lcxEngine.atsPayload({ ...resolved(), lcxQuote: lcxQuote({ kind: 'swap' }) })).toBeNull()
    expect(lcxEngine.atsPayload({ ...resolved(), lcxQuote: 'x' })).toBeNull()
    expect(lcxEngine.atsPayload({ ...resolved(), side: undefined })).toBeNull()
    expect(lcxEngine.atsPayload({ ...resolved(), side: 'hold' })).toBeNull()
    expect(lcxEngine.atsPayload({ ...resolved(), lcxKind: 'swap' })).toBeNull()
  })
})

describe('quote', () => {
  it('SWAP_QUOTE mesaji tam alan kumesiyle gider (side + lcxKind rwa), tutar AYNEN, display YOK', async () => {
    installChrome({ slippage: 1, replies: { SWAP_QUOTE: { success: true, data: quoteData() } } })
    const res = await lcxEngine.quote(buyReq())
    expect(send).toHaveBeenCalledTimes(1)
    const sent = send.mock.calls[0][0]
    expect(sent.type).toBe('SWAP_QUOTE')
    expect(Object.keys(sent.message).sort()).toEqual(['amount', 'chainId', 'inTokenAddress', 'index', 'lcxKind', 'outTokenAddress', 'side', 'slippage'])
    expect(sent.message).toEqual({
      index: DERIVATION, chainId: 8453, inTokenAddress: BASE_USDC, outTokenAddress: TSLAC, amount: '2', slippage: 1, side: 'buy', lcxKind: 'rwa',
    })
    expect(JSON.stringify(sent)).not.toContain('display')
    expect(res.success).toBe(true)
  })
  it('satista mesaj yonu satir: girdi hisse, cikti odeme tokeni, side sell', async () => {
    installChrome({ slippage: 1, replies: { SWAP_QUOTE: { success: true, data: sellData() } } })
    const res = await lcxEngine.quote(sellReq())
    expect(sentOf('SWAP_QUOTE')[0].message).toEqual({
      index: DERIVATION, chainId: 8453, inTokenAddress: TSLAC, outTokenAddress: BASE_USDC, amount: '0.00513279', slippage: 1, side: 'sell', lcxKind: 'rwa',
    })
    expect(res.success).toBe(true)
    expect(res.display.side).toBe('sell')
  })
  it('basari: routerLabel LCX, lcxQuote request ile korunur, referans lcx kaynakli', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData() } } })
    const eng = createLcxEngine({ now: () => NOW })
    const res = await eng.quote(buyReq({ index: DERIVATION, slippage: 0.5 }))
    expect(res.success).toBe(true)
    expect(res.locked).toBe(false)
    expect(res.display.routerLabel).toBe('LCX')
    expect(res.display.engine).toBe('lcx')
    expect(res.reference).toEqual({ usd: 388.61280861, source: 'lcx' })
    expect(res.request.lcxQuote).toEqual(lcxQuote())
    expect(res.request).toMatchObject({ side: 'buy', index: DERIVATION, slippage: 0.5, amount: '2', lcxKind: 'rwa' })
    expect(res.approval).toEqual({ mode: 'none' })
    expect(res.quoteId).toMatch(/^lc_\d+$/)
    // gosterim alanlari toQuoteResponse ile ayni adlarda
    expect(res.display).toMatchObject({ sellDecimals: 18, buyDecimals: 18, referencePrice: 388.61280861 })
    expect(res.display.expectedBuy).toBe('5132790000000000') // 0.00513279 x 1e18
    // birim fiyat: 2 / 0.00513279
    expect(res.display.unitPrice).toBeCloseTo(389.64, 1)
    expect(res.display.gapPct).toBeGreaterThan(0)
    expect(res.display.gapPct).toBeLessThan(1)
  })
  it('oturum bilgisi (index/slippage) depodan tamamlanir ve cozulmus istek atsPayload icin geri verilir', async () => {
    installChrome({ slippage: 1.5, replies: { SWAP_QUOTE: { success: true, data: quoteData() } } })
    const res = await lcxEngine.quote(buyReq())
    expect(res.request).toMatchObject({ index: DERIVATION, slippage: 1.5 })
    expect(lcxEngine.atsPayload(res.request).payload).toMatchObject({ index: DERIVATION, slippage: 1.5, lcxKind: 'rwa', side: 'buy' })
  })
  it('istekte index/slippage varsa depoya sorulmaz', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData() } } })
    await lcxEngine.quote(buyReq({ index: IMPORTED, slippage: 2 }))
    expect(chrome.storage.local.get).not.toHaveBeenCalled()
    expect(send.mock.calls[0][0].message).toMatchObject({ index: IMPORTED, slippage: 2 })
  })
  it('ham istek screen gonderdigi buildQuoteMessage ciktisidir: ikinci kez normalize edilince ayni sonuc', async () => {
    installChrome({ slippage: 1, replies: { SWAP_QUOTE: { success: true, data: quoteData() } } })
    const raw = buyReq()
    const res = await lcxEngine.quote({ ...raw })
    expect(res.request).toMatchObject({ ...raw, index: DERIVATION, slippage: 1 })
  })
  it('teklif omru = min(LCX expiresAt x 1000, simdi + 30 sn)', async () => {
    expect(LCX_QUOTE_TTL_MS).toBe(30_000)
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData() } } }) // LCX: simdi + 120 sn
    const long = await createLcxEngine({ now: () => NOW }).quote(buyReq())
    expect(long.expiresAt).toBe(NOW + 30_000)
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData({ lcxQuote: lcxQuote({ expiresAt: NOW / 1000 + 10 }) }) } } })
    const short = await createLcxEngine({ now: () => NOW }).quote(buyReq())
    expect(short.expiresAt).toBe(NOW + 10_000)
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData({ lcxQuote: lcxQuote({ expiresAt: NOW / 1000 + 30 }) }) } } })
    const equal = await createLcxEngine({ now: () => NOW }).quote(buyReq())
    expect(equal.expiresAt).toBe(NOW + 30_000)
  })
  it('suresi coktan dolmus teklif QUOTE_EXPIRED: yenileme dongusu ve kayit olusmaz', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData({ lcxQuote: lcxQuote({ expiresAt: NOW / 1000 - 1 }) }) } } })
    const eng = createLcxEngine({ now: () => NOW })
    expect(await eng.quote(buyReq())).toMatchObject({ success: false, code: ENGINE_ERROR.QUOTE_EXPIRED })
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData({ lcxQuote: lcxQuote({ expiresAt: NOW / 1000 }) }) } } })
    expect(await eng.quote(buyReq())).toMatchObject({ success: false, code: ENGINE_ERROR.QUOTE_EXPIRED })
  })
  it('her teklif benzersiz quoteId alir', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData() } } })
    const a = await lcxEngine.quote(buyReq())
    const b = await lcxEngine.quote(buyReq())
    expect(a.quoteId).not.toBe(b.quoteId)
  })
  it('USDC / USDT ile birim fiyat ve fark dolu; native odemede birim fiyat ve fark BOS (yanlis USD gosterilmez)', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData() } } })
    const stable = await lcxEngine.quote(buyReq())
    expect(stable.display.unitPrice).not.toBeNull()
    expect(stable.display.gapPct).not.toBeNull()
    // 0.001 ETH -> 0.00513279 TSLAC: birim fiyat ETH cinsinden, USD referansla KIYASLANAMAZ
    const nativeQuote = quoteData({ lcxQuote: lcxQuote({ tokenIn: '0x0000000000000000000000000000000000000000', amountIn: '1000000000000000' }) })
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: nativeQuote } } })
    const native = await lcxEngine.quote(buyReq({ payToken: { address: '0x0' }, amount: '0.001' }))
    expect(native.success).toBe(true)
    expect(native.display.unitPrice).toBeNull()
    expect(native.display.gapPct).toBeNull()
    expect(native.display.gapWarn).toBe(false)
    expect(native.display.referencePrice).toBe(388.61280861) // referans USD, odeme tokeninden bagimsiz
    expect(native.reference).toEqual({ usd: 388.61280861, source: 'lcx' })
    expect(sentOf('SWAP_QUOTE').at(-1).message.inTokenAddress).toBe('0x0')
  })
  it('referans yoksa reference.usd null (uydurma deger yok)', async () => {
    const q = lcxQuote()
    q.rwa = { ...q.rwa, referenceUsd: null }
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData({ lcxQuote: q }) } } })
    const res = await lcxEngine.quote(buyReq())
    expect(res.reference).toEqual({ usd: null, source: 'lcx' })
    expect(res.display.referencePrice).toBeNull()
    expect(res.display.gapPct).toBeNull()
  })
  it('bozuk teklif: lcxQuote yok / rwa degil / quoteId yok / rwa blogu yok -> BAD_QUOTE_RESPONSE', async () => {
    const bads = [
      quoteData({ lcxQuote: undefined }),
      quoteData({ lcxQuote: lcxQuote({ kind: 'swap' }) }),
      quoteData({ lcxQuote: lcxQuote({ quoteId: '' }) }),
      quoteData({ lcxQuote: lcxQuote({ rwa: undefined }) }),
      quoteData({ lcxQuote: lcxQuote({ expiresAt: 'x' }) }),
      quoteData({ lcxQuote: 'saçma' }),
    ]
    for (const data of bads) {
      installChrome({ replies: { SWAP_QUOTE: { success: true, data } } })
      expect(await lcxEngine.quote(buyReq())).toMatchObject({ success: false, code: ENGINE_ERROR.BAD_QUOTE_RESPONSE })
    }
  })
  it('bozuk gosterim verisi (beklenen cikti yok) BAD_QUOTE_RESPONSE; kayit olusmaz', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData({ expectedOutput: '' }) } } })
    const res = await lcxEngine.quote(buyReq())
    expect(res).toMatchObject({ success: false, code: ENGINE_ERROR.BAD_QUOTE_RESPONSE })
  })
  it('yanit yok / sendMessage firlatir / bos data -> UNKNOWN ya da BAD_QUOTE_RESPONSE', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    installChrome({ replies: { SWAP_QUOTE: undefined } })
    expect((await lcxEngine.quote(buyReq())).code).toBe(ENGINE_ERROR.UNKNOWN)
    installChrome({ replies: { SWAP_QUOTE: () => { throw new Error('port kapandi') } } })
    expect((await lcxEngine.quote(buyReq())).code).toBe(ENGINE_ERROR.UNKNOWN)
    installChrome({ replies: { SWAP_QUOTE: { success: true } } })
    expect((await lcxEngine.quote(buyReq())).code).toBe(ENGINE_ERROR.BAD_QUOTE_RESPONSE)
    installChrome({ replies: { SWAP_QUOTE: { success: false } } })
    expect((await lcxEngine.quote(buyReq())).code).toBe(ENGINE_ERROR.UNKNOWN)
  })
  it('LCX agi degilse arka plana HIC gitmez (CHAIN_UNSUPPORTED)', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData() } } })
    const res = await lcxEngine.quote({ ...buyReq(), chainId: 5000 })
    expect(res).toMatchObject({ success: false, code: ENGINE_ERROR.CHAIN_UNSUPPORTED })
    expect(send).not.toHaveBeenCalled()
  })
  it('LCX satiri olmayan hisse / gecersiz tutar arka plana HIC gitmez (INVALID_REQUEST)', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData() } } })
    expect(await lcxEngine.quote({ ...buyReq(), stockAddress: '0x1111111111111111111111111111111111111111' })).toMatchObject({ success: false, code: ENGINE_ERROR.INVALID_REQUEST })
    expect(await lcxEngine.quote({ ...buyReq(), amount: '0' })).toMatchObject({ success: false, code: ENGINE_ERROR.INVALID_REQUEST })
    expect(await lcxEngine.quote(null)).toMatchObject({ success: false, code: ENGINE_ERROR.INVALID_REQUEST })
    expect(await lcxEngine.quote('x')).toMatchObject({ success: false, code: ENGINE_ERROR.INVALID_REQUEST })
    expect(send).not.toHaveBeenCalled()
  })
  it('aktif hesap yoksa arka plana gitmez', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData() } } })
    delete storage.active_account
    const res = await lcxEngine.quote(buyReq())
    expect(res).toMatchObject({ success: false, code: ENGINE_ERROR.INVALID_REQUEST })
    expect(send).not.toHaveBeenCalled()
  })
  it('depo okunamazsa (firlatir) arka plana gitmez', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: quoteData() } } })
    chrome.storage.local.get = vi.fn(async () => { throw new Error('depo') })
    expect((await lcxEngine.quote(buyReq())).success).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})

describe('kapi (ilk alim kapisi) eslemesi', () => {
  it('quote: STOCK_GATE:<NEDEN> hata degil kilit yanitidir (TAM sekil); console.error cagrilmaz; teklif kaydedilmez', async () => {
    installChrome({ replies: { SWAP_QUOTE: { error: 'STOCK_GATE:IP_COUNTRY_ISSUER' } } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await lcxEngine.quote(buyReq())
    expect(res).toEqual(gateLockedReply('IP_COUNTRY_ISSUER'))
    expect(res.quoteId).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    expect(await lcxEngine.place({ quote: { quoteId: res.quoteId }, atsQuoted: ATS_QUOTED })).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_NOT_FOUND })
  })
  it('quote: kume disi neden CHECK_FAILED olarak gorunur', async () => {
    installChrome({ replies: { SWAP_QUOTE: { error: 'STOCK_GATE:US_PERSON' } } })
    expect(await lcxEngine.quote(buyReq())).toEqual(gateLockedReply('CHECK_FAILED'))
  })
  it('quote: STOCK_GATE oneki tasimayan hata genel yolda kalir (sentinel dali genel dali yutmaz)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    installChrome({ replies: { SWAP_QUOTE: { error: 'bir sey STOCK_GATE:IP_COUNTRY_ISSUER' } } })
    expect(await lcxEngine.quote(buyReq())).toMatchObject({ success: false, code: ENGINE_ERROR.UNKNOWN })
  })
})

// Eslesme tablosu (gorev 7): arka plan / LCX kodu -> motor kodu. Her satir AYRI vaka; quote VE place yolunda ayni.
const lcxRefused = (lcxCode, lcxDetails) => ({ error: `LCX reddetti: ${lcxCode}`, code: 'LCX_REFUSED', lcxCode, ...(lcxDetails ? { lcxDetails } : {}) })
const coded = (code, extra = {}) => ({ error: code, code, ...extra })
const MAPPING = [
  ['below_tolerance', lcxRefused('below_tolerance'), 'REF_PRICE_OFF'],
  ['off_reference', lcxRefused('off_reference'), 'REF_PRICE_OFF'],
  ['no_reference_price', lcxRefused('no_reference_price'), 'NO_REFERENCE_PRICE'],
  ['no_reference_rate', lcxRefused('no_reference_rate'), 'NO_REFERENCE_PRICE'],
  ['insufficient_liquidity', lcxRefused('insufficient_liquidity'), 'INSUFFICIENT_LIQUIDITY'],
  ['excluded_coin', lcxRefused('excluded_coin'), 'RWA_EXCLUDED'],
  ['excluded', lcxRefused('excluded'), 'RWA_EXCLUDED'],
  ['not_an_rwa', lcxRefused('not_an_rwa'), 'RWA_EXCLUDED'],
  ['use_rwa', lcxRefused('use_rwa'), 'RWA_EXCLUDED'],
  ['issuer_mismatch', lcxRefused('issuer_mismatch'), 'ISSUER_MISMATCH'],
  ['LCX_UNAVAILABLE', coded('LCX_UNAVAILABLE'), 'LCX_UNAVAILABLE'],
  ['LCX_REQUOTE', coded('LCX_REQUOTE'), 'QUOTE_EXPIRED'],
  ['LCX_QUOTE_MISMATCH (alan yok)', coded('LCX_QUOTE_MISMATCH'), 'QUOTE_EXPIRED'],
  ...['lcxQuote', 'kind', 'chainId', 'stock', 'side', 'payToken', 'amount', 'slippage'].map((field) => [
    `LCX_QUOTE_MISMATCH (alan ${field})`, coded('LCX_QUOTE_MISMATCH', { field }), 'QUOTE_EXPIRED',
  ]),
  ['QUOTE_EXPIRED (kod)', coded('QUOTE_EXPIRED'), 'QUOTE_EXPIRED'],
  ['QUOTE_EXPIRED (lcxCode)', lcxRefused('QUOTE_EXPIRED'), 'QUOTE_EXPIRED'],
  ['price_moved', lcxRefused('price_moved'), 'QUOTE_EXPIRED'],
  ['LCX_TX_MISMATCH', coded('LCX_TX_MISMATCH', { field: 'to' }), 'LCX_TX_REJECTED'],
  ['INSUFFICIENT_BALANCE', coded('INSUFFICIENT_BALANCE'), 'INSUFFICIENT_BALANCE'],
  ['ONCHAIN_FAILED', coded('ONCHAIN_FAILED'), 'SWAP_REVERTED'],
  ['no_route (tabloda yok, NO_ROUTE metni dogru)', lcxRefused('no_route'), 'NO_ROUTE'],
]

describe('hata esleme tablosu: quote', () => {
  it.each(MAPPING)('%s -> %s', async (_name, reply, code) => {
    installChrome({ replies: { SWAP_QUOTE: reply } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await lcxEngine.quote(buyReq())
    expect(res.success).toBe(false)
    expect(res.code).toBe(code)
    expect(ENGINE_ERROR[res.code]).toBe(code) // kapali kume
    expect(spy).not.toHaveBeenCalled()
    expect(res).not.toHaveProperty('errorInfo') // detay verilmedi: errorInfo yok
  })
  it('red kodu ayri bir kod yerine LCX_REFUSED altinda gelir: lcxCode bilinmiyorsa UNKNOWN (sebep uydurulmaz), konsola yazilir', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const reply of [lcxRefused('yeni_bir_kod'), lcxRefused(undefined), { error: 'LCX reddetti', code: 'LCX_REFUSED' }, coded('GARIP_KOD'), { error: 'bambaska bir sey' }]) {
      installChrome({ replies: { SWAP_QUOTE: reply } })
      expect(await lcxEngine.quote(buyReq())).toMatchObject({ success: false, code: ENGINE_ERROR.UNKNOWN })
    }
    expect(spy).toHaveBeenCalledTimes(5)
  })
  it('kod tablolari ad tabanli tuzaklara dusmez (__proto__ / constructor / toString)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const reply of [lcxRefused('__proto__'), lcxRefused('constructor'), coded('toString'), coded('hasOwnProperty')]) {
      installChrome({ replies: { SWAP_QUOTE: reply } })
      expect(await lcxEngine.quote(buyReq())).toMatchObject({ success: false, code: ENGINE_ERROR.UNKNOWN })
    }
  })
  it('red kodu LCX_REFUSED disinda lcxCode tasiyorsa lcxCode okunmaz', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    installChrome({ replies: { SWAP_QUOTE: { error: 'x', code: 'LCX_UNAVAILABLE', lcxCode: 'below_tolerance' } } })
    expect((await lcxEngine.quote(buyReq())).code).toBe(ENGINE_ERROR.LCX_UNAVAILABLE)
  })
  it('hicbir red LCX_REFUSED / LCX_UNAVAILABLE bugunku takas motoruna dusmez: yalniz tek SWAP_QUOTE gider', async () => {
    installChrome({ replies: { SWAP_QUOTE: lcxRefused('use_rwa') } })
    await lcxEngine.quote(buyReq())
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('insufficient_liquidity: errorInfo.max (fillsUpTo, GIRDI tokeninin ondaligiyla)', () => {
  const liquidity = (fillsUpTo) => lcxRefused('insufficient_liquidity', { fillsUpTo })
  async function quoteMax(req, details) {
    installChrome({ replies: { SWAP_QUOTE: details } })
    return lcxEngine.quote(req)
  }
  it('Al: girdi odeme tokeni (USDC 6 ondalik): 2500000 -> "2.5 USDC"', async () => {
    const res = await quoteMax(buyReq(), liquidity('2500000'))
    expect(res).toEqual({ success: false, code: ENGINE_ERROR.INSUFFICIENT_LIQUIDITY, errorInfo: { max: '2.5 USDC' } })
  })
  it('Sat: girdi hisse (8 ondalik): 25000000 -> "0.25 TSLAC"', async () => {
    const res = await quoteMax(sellReq(), liquidity('25000000'))
    expect(res).toEqual({ success: false, code: ENGINE_ERROR.INSUFFICIENT_LIQUIDITY, errorInfo: { max: '0.25 TSLAC' } })
  })
  it('BSC Al: odeme tokeni 18 ondalik (USDT), BSC Sat: hisse 18 ondalik', async () => {
    const buy = lcxEngine.buildQuoteMessage({ side: 'buy', chainId: 56, stockAddress: AAPLO, payToken: { address: BSC_USDT }, amount: '5' })
    expect((await quoteMax(buy, liquidity('1500000000000000000'))).errorInfo).toEqual({ max: '1.5 USDT' })
    const sell = lcxEngine.buildQuoteMessage({ side: 'sell', chainId: 56, stockAddress: AAPLO, payToken: { address: BSC_USDT }, amount: '5' })
    expect((await quoteMax(sell, liquidity('3000000000000000000'))).errorInfo).toEqual({ max: '3 AAPLo' })
  })
  it('native odeme: 18 ondalik ve native sembol', async () => {
    const req = buyReq({ payToken: { address: '0x0' }, amount: '0.5' })
    expect((await quoteMax(req, liquidity('250000000000000000'))).errorInfo).toEqual({ max: '0.25 ETH' })
  })
  it('fillsUpTo sayi da olabilir', async () => {
    expect((await quoteMax(buyReq(), liquidity(2500000))).errorInfo).toEqual({ max: '2.5 USDC' })
  })
  it('4 ondaliga YUVARLANMAZ, KIRPILIR: ustsinirdan buyuk sayi yazilmaz', async () => {
    expect((await quoteMax(buyReq(), liquidity('1999999'))).errorInfo).toEqual({ max: '1.9999 USDC' }) // 1.999999 -> 1.9999 (2 DEGIL)
    expect((await quoteMax(buyReq(), liquidity('1000500'))).errorInfo).toEqual({ max: '1.0005 USDC' })
    expect((await quoteMax(buyReq(), liquidity('1000050'))).errorInfo).toEqual({ max: '1 USDC' }) // 1.00005 -> 1 (sondaki sifirlar atilir)
  })
  it('kirpinca sifir kalirsa (0.00009 gibi) max yok: errorInfo anahtari da yok', async () => {
    const res = await quoteMax(buyReq(), liquidity('90'))
    expect(res).toEqual({ success: false, code: ENGINE_ERROR.INSUFFICIENT_LIQUIDITY })
    expect(res).not.toHaveProperty('errorInfo')
  })
  it.each([
    ['fillsUpTo yok', { baska: 1 }],
    ['detay yok', undefined],
    ['yazi', { fillsUpTo: 'cok' }],
    ['HTML', { fillsUpTo: '<img src=x onerror=alert(1)>' }],
    ['negatif', { fillsUpTo: '-5' }],
    ['sifir', { fillsUpTo: '0' }],
    ['ondalikli', { fillsUpTo: '1.5' }],
    ['null', { fillsUpTo: null }],
    ['nesne', { fillsUpTo: { x: 1 } }],
    ['dizi', { fillsUpTo: ['5'] }],
    ['NaN', { fillsUpTo: NaN }],
    ['ondalikli sayi', { fillsUpTo: 2.5 }],
    ['negatif sayi', { fillsUpTo: -2500000 }],
    ['cok uzun', { fillsUpTo: '9'.repeat(79) }],
  ])('gecersiz fillsUpTo (%s): max yok, errorInfo anahtari yok, kod yine INSUFFICIENT_LIQUIDITY', async (_n, details) => {
    installChrome({ replies: { SWAP_QUOTE: { error: 'x', code: 'LCX_REFUSED', lcxCode: 'insufficient_liquidity', lcxDetails: details } } })
    const res = await lcxEngine.quote(buyReq())
    expect(res).toEqual({ success: false, code: ENGINE_ERROR.INSUFFICIENT_LIQUIDITY })
  })
  it('lcxDetails dizi / dize olsa da firlatmaz', async () => {
    for (const details of [['fillsUpTo'], 'fillsUpTo', 5, true]) {
      installChrome({ replies: { SWAP_QUOTE: { error: 'x', code: 'LCX_REFUSED', lcxCode: 'insufficient_liquidity', lcxDetails: details } } })
      expect(await lcxEngine.quote(buyReq())).toEqual({ success: false, code: ENGINE_ERROR.INSUFFICIENT_LIQUIDITY })
    }
  })
  it('baska red kodunda fillsUpTo okunmaz', async () => {
    installChrome({ replies: { SWAP_QUOTE: { error: 'x', code: 'LCX_REFUSED', lcxCode: 'below_tolerance', lcxDetails: { fillsUpTo: '2500000' } } } })
    expect(await lcxEngine.quote(buyReq())).toEqual({ success: false, code: ENGINE_ERROR.REF_PRICE_OFF })
  })
})

describe('place', () => {
  // chrome her testte BIR KEZ kurulur: send cagri gecmisi testin tamami boyunca birikir (birden cok teklif / place).
  beforeEach(() => installChrome({ slippage: 1, replies: { SWAP: { success: true, hash: '0xuserophash' } } }))
  async function quoted(eng = lcxEngine, req = buyReq(), data = quoteData()) {
    currentReplies.SWAP_QUOTE = { success: true, data }
    const res = await eng.quote(req)
    expect(res.success).toBe(true)
    return res
  }
  const placeArgs = (q, over = {}) => ({ quote: q, request: q.request, atsQuoted: ATS_QUOTED, accountIndex: DERIVATION, ...over })
  const setSwapReply = (SWAP) => { currentReplies.SWAP = SWAP }

  it('SWAP mesaji TAM alan kumesi: atsSwap + atsQuoted + lcxKind + lcxQuote + side (R1); display/quote nesnesi YOK', async () => {
    const q = await quoted()
    const r = await lcxEngine.place(placeArgs(q))
    const swaps = sentOf('SWAP')
    expect(swaps).toHaveLength(1)
    const m = swaps[0].message
    expect(Object.keys(m).sort()).toEqual([...LCX_PLACE_FIELDS].sort())
    expect(LCX_PLACE_FIELDS).toEqual([
      'index', 'chainId', 'inTokenAddress', 'outTokenAddress', 'amount', 'slippage', 'side', 'atsSwap', 'atsQuoted', 'lcxKind', 'lcxQuote',
    ])
    expect(m).toEqual({
      index: DERIVATION, chainId: 8453, inTokenAddress: BASE_USDC, outTokenAddress: TSLAC, amount: '2', slippage: 1, side: 'buy',
      atsSwap: true, atsQuoted: { transferFee: 0.4, commissionFee: 0.1 }, lcxKind: 'rwa', lcxQuote: lcxQuote(),
    })
    expect(JSON.stringify(swaps[0])).not.toMatch(/display|expectedBuy|minBuy|sellAmount|routerLabel/)
    expect(r).toMatchObject({ ok: true, kind: 'tx', id: q.quoteId, hash: '0xuserophash' })
  })
  it('satista side sell, girdi hisse; lcxQuote TEKLIFTEN gelir (ekranin verdigi istekteki lcxQuote yok sayilir)', async () => {
    const q = await quoted(lcxEngine, sellReq(), sellData())
    const evil = lcxQuote({ amountOut: '999999999999', minOut: '1' })
    const r = await lcxEngine.place(placeArgs(q, { request: { ...q.request, lcxQuote: evil } }))
    expect(r.ok).toBe(true)
    const m = sentOf('SWAP')[0].message
    expect(m).toMatchObject({ side: 'sell', inTokenAddress: TSLAC, outTokenAddress: BASE_USDC, amount: '0.00513279' })
    expect(m.lcxQuote).toEqual(sellData().lcxQuote)
    expect(m.lcxQuote.minOut).toBe('1980000')
  })
  it('kayitli lcxQuote dis degisiklikten korunur: donen istekteki nesneyi degistirmek SWAP mesajini degistirmez', async () => {
    const q = await quoted()
    q.request.lcxQuote.minOut = '1'
    q.request.lcxQuote.rwa.issuer = 'evil'
    await lcxEngine.place(placeArgs(q))
    expect(sentOf('SWAP')[0].message.lcxQuote).toEqual(lcxQuote())
  })
  it('native odeme: SWAP mesajinda girdi 0x0', async () => {
    const nativeQuote = quoteData({ lcxQuote: lcxQuote({ tokenIn: '0x0000000000000000000000000000000000000000', amountIn: '1000000000000000' }) })
    const q = await quoted(lcxEngine, buyReq({ payToken: { address: '0x0' }, amount: '0.001' }), nativeQuote)
    await lcxEngine.place(placeArgs(q))
    expect(sentOf('SWAP')[0].message).toMatchObject({ inTokenAddress: '0x0', outTokenAddress: TSLAC, amount: '0.001', side: 'buy' })
  })
  it('kimlik meta: inTokenData/outTokenData yalniz kimlik alanlariyla SWAP mesajina girer (gecmis karti sembol/logo)', async () => {
    const q = await quoted()
    const r = await lcxEngine.place(placeArgs(q, {
      inTokenData: { symbol: 'USDC', name: 'USD Coin', address: BASE_USDC.toLowerCase(), image: { large: 'https://x/usdc.png', evil: 'z' }, display: { price: 1 }, balance: '5' },
      outTokenData: { symbol: 'TSLAC', address: TSLAC, image: 'https://x/tsla.png', priceUSD: 388 },
    }))
    expect(r.ok).toBe(true)
    const m = sentOf('SWAP')[0].message
    expect(Object.keys(m).sort()).toEqual([...LCX_PLACE_FIELDS, ...LCX_PLACE_OPTIONAL_FIELDS].sort())
    expect(LCX_PLACE_OPTIONAL_FIELDS).toEqual(['inTokenData', 'outTokenData'])
    expect(m.inTokenData).toEqual({ symbol: 'USDC', name: 'USD Coin', address: BASE_USDC, image: { large: 'https://x/usdc.png' } })
    expect(m.outTokenData).toEqual({ symbol: 'TSLAC', address: TSLAC, image: 'https://x/tsla.png' })
    expect(JSON.stringify(m)).not.toMatch(/balance|priceUSD|evil/)
  })
  it('kimlik meta: native odeme tokeni 0x0 adresiyle eslesir', async () => {
    const nativeQuote = quoteData({ lcxQuote: lcxQuote({ tokenIn: '0x0000000000000000000000000000000000000000', amountIn: '1000000000000000' }) })
    const q = await quoted(lcxEngine, buyReq({ payToken: { address: '0x0' }, amount: '0.001' }), nativeQuote)
    const r = await lcxEngine.place(placeArgs(q, { inTokenData: { symbol: 'ETH', name: 'ETH', address: '0x0' } }))
    expect(r.ok).toBe(true)
    expect(sentOf('SWAP')[0].message.inTokenData).toEqual({ symbol: 'ETH', name: 'ETH', address: '0x0' })
  })
  it('kimlik meta: sembolsuz meta atlanir; adresi islemle eslesmeyen meta QUOTE_MISMATCH ve SWAP gitmez', async () => {
    const q = await quoted()
    const r = await lcxEngine.place(placeArgs(q, { inTokenData: { name: 'sembolsuz' }, outTokenData: 'saçma' }))
    expect(r).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_MISMATCH })
    expect(sentOf('SWAP')).toHaveLength(0)
    expect(await lcxEngine.place(placeArgs(q, { inTokenData: { symbol: 'USDC', address: BASE_USDT } }))).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_MISMATCH })
    expect(sentOf('SWAP')).toHaveLength(0)
    await lcxEngine.place(placeArgs(q, { inTokenData: { name: 'sembolsuz' } }))
    expect(sentOf('SWAP')[0].message).not.toHaveProperty('inTokenData')
  })
  it('sonuc "gonderildi" durumudur ve hash userOp hash olarak isaretlenir (tx hash DEGIL)', async () => {
    const r = await lcxEngine.place(placeArgs(await quoted()))
    expect(r).toMatchObject({ ok: true, kind: 'tx', submitted: true, hash: '0xuserophash', hashKind: 'userOp' })
    expect(r).not.toHaveProperty('confirmed')
    expect(r).not.toHaveProperty('uid')
    expect(r).not.toHaveProperty('unverified')
  })
  it('SWAP hash vermeden success donerse yine ok (cift gonderim riskine girilmez), hash null', async () => {
    const q = await quoted()
    setSwapReply({ success: true })
    expect(await lcxEngine.place(placeArgs(q))).toMatchObject({ ok: true, kind: 'tx', submitted: true, hash: null, hashKind: null })
  })
  it('arka plan unverified:true dondururse sonuc ok + unverified (hata DEGIL, tekrar-dene yok)', async () => {
    const q = await quoted()
    setSwapReply({ success: true, hash: '0xuserophash', unverified: true })
    expect(await lcxEngine.place(placeArgs(q))).toMatchObject({ ok: true, unverified: true, hash: '0xuserophash' })
  })
  it('hata metni "islem sonucu dogrulanamadi (txHash: ...)" ise basarisiz DEGIL: unverified gonderildi', async () => {
    const q = await quoted()
    const h = `0x${'ab'.repeat(32)}`
    setSwapReply({ error: `islem sonucu dogrulanamadi (txHash: ${h})` })
    expect(await lcxEngine.place(placeArgs(q))).toEqual({ ok: true, kind: 'tx', id: q.quoteId, hash: h, hashKind: 'userOp', submitted: true, unverified: true })
  })
  it('teklif tek kullanimlik: ikinci place QUOTE_USED ve ikinci SWAP gitmez', async () => {
    const q = await quoted()
    expect((await lcxEngine.place(placeArgs(q))).ok).toBe(true)
    expect(await lcxEngine.place(placeArgs(q))).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_USED })
    expect(sentOf('SWAP')).toHaveLength(1)
  })
  it('es zamanli iki place: yalniz biri SWAP gonderir', async () => {
    const q = await quoted()
    let release
    const gate = new Promise((res) => { release = res })
    setSwapReply(() => gate.then(() => ({ success: true, hash: '0xh' })))
    const p1 = lcxEngine.place(placeArgs(q))
    const p2 = lcxEngine.place(placeArgs(q))
    release()
    const [a, b] = await Promise.all([p1, p2])
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    expect(sentOf('SWAP')).toHaveLength(1)
  })
  it('hata sonrasi teklif yanik sayilir: ayni teklifle tekrar SWAP gitmez', async () => {
    const q = await quoted()
    setSwapReply({ error: 'bilinmeyen' })
    await lcxEngine.place(placeArgs(q))
    expect(await lcxEngine.place(placeArgs(q))).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_USED })
    expect(sentOf('SWAP')).toHaveLength(1)
  })
  it('QUOTE_NOT_FOUND: bilinmeyen / eksik quoteId', async () => {
    await quoted()
    expect(await lcxEngine.place({ quote: { quoteId: 'lc_999999' }, atsQuoted: ATS_QUOTED, accountIndex: DERIVATION })).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_NOT_FOUND })
    expect(await lcxEngine.place({ quote: {}, atsQuoted: ATS_QUOTED })).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_NOT_FOUND })
    expect(await lcxEngine.place({ quote: { quoteId: 5 } })).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_NOT_FOUND })
    expect(await lcxEngine.place()).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_NOT_FOUND })
    expect(sentOf('SWAP')).toHaveLength(0)
  })
  it('QUOTE_EXPIRED: omur dolunca (sinirda hala gecerli, sonrasi degil); SWAP gitmez; kayit silinir', async () => {
    let t = NOW
    const eng = createLcxEngine({ now: () => t })
    const q1 = await quoted(eng)
    t = NOW + 30_000 // tam sinir: expiresAt'a esit -> hala gecerli
    expect((await eng.place(placeArgs(q1))).ok).toBe(true)
    t = NOW
    const q2 = await quoted(eng)
    t = NOW + 30_001
    expect(await eng.place(placeArgs(q2))).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_EXPIRED })
    expect(sentOf('SWAP')).toHaveLength(1) // yalniz q1'inki
    expect(await eng.place(placeArgs(q2))).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_NOT_FOUND })
  })
  it('QUOTE_EXPIRED: LCX omru 30 sn den kisaysa o sinir gecerlidir', async () => {
    let t = NOW
    const eng = createLcxEngine({ now: () => t })
    const q = await quoted(eng, buyReq(), quoteData({ lcxQuote: lcxQuote({ expiresAt: NOW / 1000 + 5 }) }))
    t = NOW + 5_001
    expect(await eng.place(placeArgs(q))).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_EXPIRED })
    expect(sentOf('SWAP')).toHaveLength(0)
  })
  it('ACCOUNT_CHANGED: ekranin verdigi hesap ya da depodaki aktif hesap tekliften farkliysa SWAP gitmez', async () => {
    const q = await quoted()
    expect(await lcxEngine.place(placeArgs(q, { accountIndex: IMPORTED }))).toEqual({ ok: false, code: ENGINE_ERROR.ACCOUNT_CHANGED })
    // depodaki aktif hesap degisti (SWAP arka plani aktif hesabi DEPODAN okur!)
    storage.active_account = { type: 'imported', address: IMPORTED }
    expect(await lcxEngine.place(placeArgs(q))).toEqual({ ok: false, code: ENGINE_ERROR.ACCOUNT_CHANGED })
    expect(sentOf('SWAP')).toHaveLength(0)
  })
  it('hesap yok / depo okunamaz: ACCOUNT_CHANGED, SWAP gitmez', async () => {
    const q = await quoted()
    delete storage.active_account
    expect(await lcxEngine.place(placeArgs(q))).toEqual({ ok: false, code: ENGINE_ERROR.ACCOUNT_CHANGED })
    chrome.storage.local.get = vi.fn(async () => { throw new Error('depo') })
    expect(await lcxEngine.place(placeArgs(q))).toEqual({ ok: false, code: ENGINE_ERROR.ACCOUNT_CHANGED })
    expect(sentOf('SWAP')).toHaveLength(0)
  })
  it('hesap kontrolu SWAP kuyruga girmeden yapilir ve basarisiz kontrol teklifi YAKMAZ (yeniden denenebilir)', async () => {
    const q = await quoted()
    await lcxEngine.place(placeArgs(q, { accountIndex: IMPORTED }))
    expect((await lcxEngine.place(placeArgs(q))).ok).toBe(true)
  })
  it('QUOTE_MISMATCH: ekran teklifle farkli tutar/yon/token gonderirse', async () => {
    const q = await quoted()
    for (const over of [{ amount: '3' }, { inTokenAddress: BASE_USDT }, { outTokenAddress: BASE_USDT }, { chainId: 56 }]) {
      const r = await lcxEngine.place(placeArgs(q, { request: { ...q.request, ...over } }))
      expect(r).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_MISMATCH })
    }
    expect(sentOf('SWAP')).toHaveLength(0)
  })
  it('ATS_BLOCKED (fail-closed): atsQuoted yok / gecersiz / ucret 0 ise SWAP gitmez ve teklif yanmaz', async () => {
    const q = await quoted()
    for (const atsQuoted of [undefined, null, {}, { transferFee: 0, commissionFee: 0 }, { transferFee: 'x', commissionFee: 0 }, { transferFee: 0.4 }, { transferFee: -1, commissionFee: 0 }, { transferFee: 0.4, commissionFee: -1 }]) {
      expect(await lcxEngine.place(placeArgs(q, { atsQuoted }))).toEqual({ ok: false, code: ENGINE_ERROR.ATS_BLOCKED })
    }
    expect(sentOf('SWAP')).toHaveLength(0)
    expect((await lcxEngine.place(placeArgs(q))).ok).toBe(true)
  })
  it('ATS kararlari (decision) engelliyorsa ATS_BLOCKED', async () => {
    const q = await quoted()
    expect(await lcxEngine.place(placeArgs(q, { atsBlocked: true }))).toEqual({ ok: false, code: ENGINE_ERROR.ATS_BLOCKED })
    expect(sentOf('SWAP')).toHaveLength(0)
  })
  it('ATS ucreti 0 ve komisyon 0 atsQuoted yerine verilse de SWAP ucretsiz gonderilmez; atsQuoted dize sayilari kabul', async () => {
    const q = await quoted()
    const r = await lcxEngine.place(placeArgs(q, { atsQuoted: { transferFee: '0.4', commissionFee: '0' } }))
    expect(r.ok).toBe(true)
    expect(sentOf('SWAP')[0].message.atsQuoted).toEqual({ transferFee: 0.4, commissionFee: 0 })
  })

  describe('SWAP hatasi esleme tablosu (place)', () => {
    it.each(MAPPING)('%s -> %s', async (_name, reply, code) => {
      const q = await quoted()
      setSwapReply(reply)
      expect(await lcxEngine.place(placeArgs(q))).toEqual({ ok: false, code })
    })
    it('STOCK_GATE:<NEDEN> -> STOCK_GATE (SWAP_FAILED DEGIL, submitted yok); teklif used kalir', async () => {
      const q = await quoted()
      setSwapReply({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
      expect(await lcxEngine.place(placeArgs(q))).toEqual({ ok: false, code: ENGINE_ERROR.STOCK_GATE })
      expect(await lcxEngine.place(placeArgs(q))).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_USED })
    })
    it('kume disi kapi nedeni de STOCK_GATE koduna duser', async () => {
      const q = await quoted()
      setSwapReply({ error: 'STOCK_GATE:US_PERSON' })
      expect(await lcxEngine.place(placeArgs(q))).toEqual({ ok: false, code: ENGINE_ERROR.STOCK_GATE })
    })
    it.each([
      ['Insufficient balance', ENGINE_ERROR.INSUFFICIENT_BALANCE],
      ['insufficient funds for intrinsic transaction cost', ENGINE_ERROR.INSUFFICIENT_BALANCE],
      ['transfer islemi basarisiz veya sonucu dogrulanamadi', ENGINE_ERROR.SWAP_REVERTED],
      ['ATS ucreti onaylanan tutari asti (1 > 0.5)', ENGINE_ERROR.SWAP_FAILED],
      ['bilinmeyen', ENGINE_ERROR.SWAP_FAILED],
    ])('kodsuz arka plan metni: %s -> %s', async (error, code) => {
      const q = await quoted()
      setSwapReply({ error })
      expect(await lcxEngine.place(placeArgs(q))).toEqual({ ok: false, code })
    })
    it('taninmayan kod SWAP_FAILED (sebep uydurulmaz); LCX_REFUSED bilinmeyen lcxCode da', async () => {
      const q1 = await quoted()
      setSwapReply(coded('GARIP_KOD'))
      expect(await lcxEngine.place(placeArgs(q1))).toEqual({ ok: false, code: ENGINE_ERROR.SWAP_FAILED })
      const q2 = await quoted()
      setSwapReply(lcxRefused('yeni_bir_kod'))
      expect(await lcxEngine.place(placeArgs(q2))).toEqual({ ok: false, code: ENGINE_ERROR.SWAP_FAILED })
    })
    it('SWAP yaniti yok / sendMessage firlatir -> UNKNOWN (gonderilmis olabilir, "basarisiz" denmez)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const q1 = await quoted()
      setSwapReply(undefined)
      expect(await lcxEngine.place(placeArgs(q1))).toEqual({ ok: false, code: ENGINE_ERROR.UNKNOWN })
      const q2 = await quoted()
      setSwapReply(() => { throw new Error('port') })
      expect(await lcxEngine.place(placeArgs(q2))).toEqual({ ok: false, code: ENGINE_ERROR.UNKNOWN })
    })
  })

  it('bellek siniri: cok teklif birikse de en eski kayitlar atilir', async () => {
    const eng = createLcxEngine()
    const first = await quoted(eng)
    for (let i = 0; i < 40; i++) await quoted(eng)
    expect(await eng.place(placeArgs(first))).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_NOT_FOUND })
  })
  it('tek kullanim YEREL kimlige baglidir: ayni LCX quoteId ile yeni teklif gelse de used olan teklif sifirlanmaz', async () => {
    const q1 = await quoted()
    expect((await lcxEngine.place(placeArgs(q1))).ok).toBe(true)
    const q2 = await quoted() // ayni LCX teklifi (ayni quoteId) yeniden geldi
    expect(q2.request.lcxQuote.quoteId).toBe(q1.request.lcxQuote.quoteId)
    expect(q2.quoteId).not.toBe(q1.quoteId)
    expect(await lcxEngine.place(placeArgs(q1))).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_USED })
    expect(sentOf('SWAP')).toHaveLength(1)
  })
})

describe('quoteRows', () => {
  const display = {
    engine: 'lcx', side: 'buy', sellAmount: '2000000000000000000', sellDecimals: 18, expectedBuy: '5132790000000000',
    buyDecimals: 18, minBuy: '5107120000000000', unitPrice: 389.64, referencePrice: 388.61, gapPct: 0.26, gapWarn: false,
    priceImpact: { pct: 0.02, high: false, unmeasured: false },
    fees: { kind: 'ats', transfer: '0.4', commission: '0', total: '0.4', lpFeePct: null },
    networkFeeUsd: null, networkFeePct: null, minAmountUsdForFee: null, routerLabel: 'LCX',
  }
  const rows = (d = display, extra = {}) => lcxEngine.quoteRows({ result: { display: d, warnings: [], notice: null }, side: 'buy', symbol: 'TSLAC', paySymbol: 'USDC', locale: 'en', ...extra })
  it('ortak satirlar + ATS eki; CoW ucret/ag ucreti/bildirim satiri YOK', () => {
    const r = rows()
    expect(r.spend.value).toContain('USDC')
    expect(r.primary.value).toContain('TSLAC')
    expect(r.networkFee).toBeNull()
    expect(r.fees).toEqual([])
    expect(r.feesTotalUsd).toBeNull()
    expect(r.notice).toBeNull()
    expect(r.warnings).toEqual([])
    expect(r.gapWarn).toBe(false)
    expect(r.priceImpact).toEqual({ pct: 0.02, high: false, unmeasured: false })
    expect(r.ats).toMatchObject({ transfer: '0.4', commission: '0', total: '0.4' })
    expect(r.unitPrice).toBe('$389.64')
    expect(r.reference).toBe('$388.61')
  })
  it('native odemede birim fiyat / fark bos: satir "-" ve fark satiri yok', () => {
    const r = rows({ ...display, unitPrice: null, gapPct: null, gapWarn: false })
    expect(r.gap).toBeNull()
    expect(r.unitPrice).not.toContain('389')
  })
  it('display yoksa null', () => {
    expect(lcxEngine.quoteRows({ result: null })).toBeNull()
    expect(lcxEngine.quoteRows()).toBeNull()
  })
})

describe('kaynak taramasi', () => {
  const src = readFileSync(new URL('./lcxEngine.js', import.meta.url), 'utf8')
  it('toQuoteResponse pancakeQuote tan alinir (kopyalanmaz)', () => {
    expect(src).toMatch(/from '\.\/pancakeQuote'/)
    expect(src).not.toMatch(/function toQuoteResponse|function uiToAtoms/)
  })
  it('yalniz mevcut arka plan mesajlari: SWAP_QUOTE ve SWAP (yeni mesaj yok); ATS ucreti ekranin useAtsOpFee yoludur', () => {
    expect(src).toContain("'SWAP_QUOTE'")
    expect(src).toContain("'SWAP'")
    expect(src).not.toContain('COW_QUOTE')
    expect(src).not.toContain('ATS_SWAP_FEE_QUOTE')
    expect(src).not.toMatch(/type:\s*'LCX/)
  })
  it('kapi modulunu karar icin import ETMEZ (kapi arka planda; yalniz sentinel ayristirilir)', () => {
    expect(src).not.toMatch(/getStockGate|evaluateIssuer|evaluate\(/)
  })
})

// Gorev 8: ekran ATS ucret teklifinin LCX reddini (useAtsOpFee: errorCode + lcxCode) ayni esleme tablolariyla okunur metne cevirir.
describe('lcxReplyCode (ATS ucret teklifi reddi -> motor kodu)', () => {
  it.each([
    [{ code: 'LCX_REFUSED', lcxCode: 'use_rwa' }, ENGINE_ERROR.RWA_EXCLUDED],
    [{ code: 'LCX_REFUSED', lcxCode: 'no_reference_price' }, ENGINE_ERROR.NO_REFERENCE_PRICE],
    [{ code: 'LCX_REFUSED', lcxCode: 'insufficient_liquidity' }, ENGINE_ERROR.INSUFFICIENT_LIQUIDITY],
    [{ code: 'LCX_UNAVAILABLE' }, ENGINE_ERROR.LCX_UNAVAILABLE],
    [{ code: 'LCX_REQUOTE' }, ENGINE_ERROR.QUOTE_EXPIRED],
    [{ code: 'LCX_QUOTE_MISMATCH', field: 'side' }, ENGINE_ERROR.QUOTE_EXPIRED],
    [{ code: 'LCX_TX_MISMATCH' }, ENGINE_ERROR.LCX_TX_REJECTED],
  ])('%j -> %s', (reply, beklenen) => {
    expect(lcxReplyCode(reply)).toBe(beklenen)
  })

  it('tanimayan / bozuk yanit UNKNOWN (sebep uydurulmaz); prototip adlari tabloya karismaz', () => {
    for (const reply of [{ code: 'LCX_REFUSED' }, { code: 'LCX_REFUSED', lcxCode: 'yok' }, { code: 'LCX_REFUSED', lcxCode: 'constructor' },
      { code: 'LCX_REFUSED', lcxCode: '__proto__' }, { code: 'toString' }, { code: 'LCX_FOO' }, {}, null, undefined, 'LCX_REFUSED', 5, []]) {
      expect(lcxReplyCode(reply), JSON.stringify(reply)).toBe(ENGINE_ERROR.UNKNOWN)
    }
  })

  it('quote yolundaki tabloyla ayni: ayni (code, lcxCode) cifti ayni motor kodunu verir', async () => {
    installChrome({ replies: { SWAP_QUOTE: { error: 'use_rwa', code: 'LCX_REFUSED', lcxCode: 'use_rwa', lcxDetails: {} } } })
    const res = await lcxEngine.quote(buyReq())
    expect(res.code).toBe(lcxReplyCode({ code: 'LCX_REFUSED', lcxCode: 'use_rwa' }))
  })

  it('motorlar dizininden de disari verilir', async () => {
    const index = await import('./index')
    expect(index.lcxReplyCode).toBe(lcxReplyCode)
  })
})

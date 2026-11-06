// T12: pancakeEngine (bStocks / PancakeSwap). chrome stub'i ile: arka plan GERCEK cagrilmaz, mesajlar sayilir.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BSTOCKS } from '../../../data/bStocks'
import { BSTOCK_MULTIPLIER_ERROR } from '../../bstocksSpend'
import { LIQUIDITY_GATE_ERROR, NO_ROUTE_ERROR } from '../../swapRoutes'
import { ENGINE_ERROR } from './errors'
import { createPancakeEngine, pancakeEngine, readTradeContext, PANCAKE_PLACE_FIELDS, PANCAKE_PLACE_OPTIONAL_FIELDS } from './pancakeEngine'
import { engineFor } from './index'

const STOCK = BSTOCKS[0].address
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
const DERIVATION = "m/44'/60'/0'/0/0"
const IMPORTED = '0x1234567890123456789012345678901234567890'

const QUOTE_DATA = {
  expectedOutput: '0.5',
  minimumReceived: '0.49',
  priceImpact: '0.30%',
  liquidityProviderFee: '0.25%',
  routerType: { name: 'PancakeSwap', version: 3 },
}
const ATS_QUOTED = { transferFee: 0.4, commissionFee: 0.1 }

let send
let storage

function installChrome({ replies = {}, active = { type: 'derived', derivationPath: DERIVATION, address: '0xabc' }, slippage } = {}) {
  storage = { active_account: active, ...(slippage === undefined ? {} : { swap_slippage: slippage }) }
  send = vi.fn(async ({ type }) => {
    const r = replies[type]
    if (typeof r === 'function') return r()
    return r
  })
  globalThis.chrome = {
    runtime: { sendMessage: send },
    storage: { local: { get: vi.fn(async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in storage).map((k) => [k, storage[k]]))) } },
  }
}

const buyReq = (extra = {}) =>
  pancakeEngine.buildQuoteMessage({ side: 'buy', chainId: 56, stockAddress: STOCK, payToken: { address: USDT }, amount: '100', ...extra })

afterEach(() => {
  delete globalThis.chrome
  vi.restoreAllMocks()
})

describe('arayuz', () => {
  it('bayraklar ve motor kaydi', () => {
    expect(pancakeEngine).toMatchObject({
      id: 'pancake', hasApprovalStep: false, hasPriceImpactGate: true, hasReferenceLock: false,
      hasOrderLifecycle: false, showsCowDisclosure: false,
    })
    expect(Object.isFrozen(pancakeEngine)).toBe(true)
    expect(engineFor({ issuer: 'bstocks' })).toBe(pancakeEngine)
  })
  it('payTokens yalniz BSC: USDT ve USDC, 18 ondalik', () => {
    const t = pancakeEngine.payTokens(56)
    expect(t.map((x) => x.symbol).sort()).toEqual(['USDC', 'USDT'])
    for (const x of t) expect(x.decimals).toBe(18)
    expect(t.find((x) => x.symbol === 'USDT').address).toBe(USDT)
    expect(t.find((x) => x.symbol === 'USDC').address).toBe(USDC)
    expect(pancakeEngine.payTokens(1)).toEqual([])
    expect(pancakeEngine.payTokens(137)).toEqual([])
  })
  it('primaryAction her zaman trade (onay ara sayfasi yok), errorKey kapali kume', () => {
    expect(pancakeEngine.primaryAction({ approval: { mode: 'onchain' } })).toBe('trade')
    expect(pancakeEngine.primaryAction({})).toBe('trade')
    expect(pancakeEngine.errorKey('NO_ROUTE')).toBe('stockTrade.error.NO_ROUTE')
    expect(pancakeEngine.errorKey('garip')).toBe('stockTrade.error.UNKNOWN')
  })
})

describe('buildQuoteMessage', () => {
  it('Al: odeme tokeni girdi, hisse cikti, tutar UI dizesi', () => {
    const r = buyReq()
    expect(r).toMatchObject({ side: 'buy', chainId: 56, inTokenAddress: USDT, outTokenAddress: STOCK, amount: '100' })
  })
  it('Sat: hisse girdi, odeme tokeni cikti, adet UI dizesi', () => {
    const r = pancakeEngine.buildQuoteMessage({ side: 'sell', chainId: 56, stockAddress: STOCK, payToken: { address: USDC }, amount: '2.5' })
    expect(r).toMatchObject({ side: 'sell', chainId: 56, inTokenAddress: STOCK, outTokenAddress: USDC, amount: '2.5' })
  })
  it('odeme tokeni dize adres olarak da kabul edilir (cowEngine ile ayni)', () => {
    expect(buyReq({ payToken: USDT }).inTokenAddress).toBe(USDT)
  })
  it('tutar temizlenir: sondaki sifirlar atilir, ondalik degeri degismez', () => {
    expect(buyReq({ amount: '10.500' }).amount).toBe('10.5')
    expect(buyReq({ amount: '0.00000001' }).amount).toBe('0.00000001')
  })
  it('zincir 56 degilse null', () => {
    expect(buyReq({ chainId: 1 })).toBeNull()
    expect(buyReq({ chainId: '56' })).toBeNull()
  })
  it('gecersiz girdi null: yon, hisse adresi, odeme tokeni, tutar', () => {
    expect(buyReq({ side: 'hold' })).toBeNull()
    expect(buyReq({ stockAddress: '0x1111111111111111111111111111111111111111' })).toBeNull() // katalogda yok
    expect(buyReq({ stockAddress: 'zzz' })).toBeNull()
    expect(buyReq({ payToken: { address: '0x2222222222222222222222222222222222222222' } })).toBeNull() // PAY_TOKENS disi
    expect(buyReq({ payToken: null })).toBeNull()
    for (const amount of ['', '0', '0.0', '-1', '1e3', 'abc', 5, null, undefined, '1,5']) expect(buyReq({ amount })).toBeNull()
  })
  it('isteme index, slippage ve referans fiyat gecirilebilir; bozuk degerler yok sayilir', () => {
    const r = buyReq({ index: DERIVATION, slippage: 1, referencePrice: 248.4 })
    expect(r).toMatchObject({ index: DERIVATION, slippage: 1, referencePrice: 248.4 })
    const bad = buyReq({ slippage: -3, referencePrice: 'x' })
    expect(bad.slippage).toBeUndefined()
    expect(bad.referencePrice).toBeNull()
  })
})

describe('readTradeContext', () => {
  it('turetilmis hesap: derivationPath, ice aktarilmis: adres; slippage depodan, yoksa varsayilan', async () => {
    installChrome({ slippage: 1.5 })
    expect(await readTradeContext()).toEqual({ index: DERIVATION, slippage: 1.5 })
    installChrome({ active: { type: 'imported', address: IMPORTED } })
    expect(await readTradeContext()).toEqual({ index: IMPORTED, slippage: 0.5 })
  })
  it('aktif hesap yoksa null', async () => {
    installChrome({ active: undefined })
    delete storage.active_account
    expect(await readTradeContext()).toBeNull()
  })
})

describe('atsPayload', () => {
  it('Swap.vue ile ayni alanlar; index/slippage cozulmemisse null (callData uyusmazligi olmasin)', () => {
    const r = buyReq({ index: DERIVATION, slippage: 0.5 })
    expect(pancakeEngine.atsPayload(r)).toEqual({
      kind: 'swap',
      payload: { index: DERIVATION, chainId: 56, inTokenAddress: USDT, outTokenAddress: STOCK, amount: '100', slippage: 0.5 },
    })
    expect(pancakeEngine.atsPayload(buyReq())).toBeNull()
    expect(pancakeEngine.atsPayload(null)).toBeNull()
    expect(pancakeEngine.atsPayload({ ...r, chainId: 1 })).toBeNull()
  })
})

describe('quote', () => {
  it('SWAP_QUOTE mesaji tam alan kumesiyle gider, tutar AYNEN, display YOK', async () => {
    installChrome({ slippage: 1, replies: { SWAP_QUOTE: { success: true, data: QUOTE_DATA } } })
    const res = await pancakeEngine.quote(buyReq({ referencePrice: 250 }))
    expect(send).toHaveBeenCalledTimes(1)
    const sent = send.mock.calls[0][0]
    expect(sent.type).toBe('SWAP_QUOTE')
    expect(Object.keys(sent.message).sort()).toEqual(['amount', 'chainId', 'inTokenAddress', 'index', 'outTokenAddress', 'slippage'])
    expect(sent.message).toEqual({ index: DERIVATION, chainId: 56, inTokenAddress: USDT, outTokenAddress: STOCK, amount: '100', slippage: 1 })
    expect(JSON.stringify(sent)).not.toContain('display')
    expect(res.success).toBe(true)
    expect(res.quoteId).toMatch(/^ps_\d+$/)
    expect(res.display.engine).toBe('pancake')
    expect(res.display.referencePrice).toBe(250)
    // unitPrice: 100 / 0.5 = 200 (kendi tutarlarimizdan)
    expect(res.display.unitPrice).toBe(200)
    // oturum bilgisi cozulmus istek geri verilir (atsPayload icin)
    expect(res.request).toMatchObject({ index: DERIVATION, slippage: 1, amount: '100' })
    expect(pancakeEngine.atsPayload(res.request).payload.slippage).toBe(1)
  })
  it('istekte index/slippage varsa depoya sorulmaz', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: QUOTE_DATA } } })
    await pancakeEngine.quote(buyReq({ index: IMPORTED, slippage: 2 }))
    expect(chrome.storage.local.get).not.toHaveBeenCalled()
    expect(send.mock.calls[0][0].message).toMatchObject({ index: IMPORTED, slippage: 2 })
  })
  it('teklif omru 30 sn; now enjekte edilir', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: QUOTE_DATA } } })
    const eng = createPancakeEngine({ now: () => 1_000_000 })
    const res = await eng.quote(buyReq())
    expect(res.expiresAt).toBe(1_030_000)
  })
  it('her teklif benzersiz quoteId alir', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: QUOTE_DATA } } })
    const a = await pancakeEngine.quote(buyReq())
    const b = await pancakeEngine.quote(buyReq())
    expect(a.quoteId).not.toBe(b.quoteId)
  })
  it('ATS ucretleri istekte verilirse display.fees dolar', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: QUOTE_DATA } } })
    const res = await pancakeEngine.quote(buyReq({ atsFees: { transfer: '0.4', commission: '0.1' } }))
    expect(res.display.fees).toMatchObject({ kind: 'ats', transfer: '0.4', commission: '0.1', total: '0.5' })
  })
  it.each([
    [`getExpectedOutput error: ${NO_ROUTE_ERROR}`, ENGINE_ERROR.NO_ROUTE],
    [`getExpectedOutput error: ${LIQUIDITY_GATE_ERROR}`, ENGINE_ERROR.NO_LIQUIDITY],
    [`getExpectedOutput error: ${BSTOCK_MULTIPLIER_ERROR}: 0xabc (x)`, ENGINE_ERROR.MULTIPLIER_UNREADABLE],
    ['Unsupported chain', ENGINE_ERROR.CHAIN_UNSUPPORTED],
    ['XSTOCK_USE_COW: 0xabc', ENGINE_ERROR.UNSUPPORTED_TOKEN],
    ['Network Error: fetch failed', ENGINE_ERROR.NETWORK],
    ['bambaska bir sey', ENGINE_ERROR.UNKNOWN],
  ])('hata esleme: %s -> %s', async (error, code) => {
    installChrome({ replies: { SWAP_QUOTE: { error } } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await pancakeEngine.quote(buyReq())
    expect(res).toMatchObject({ success: false, code })
    if (code === ENGINE_ERROR.UNKNOWN) expect(spy).toHaveBeenCalled() // taninmayan hata konsola; "rota yok" DENMEZ
  })
  it('bilinmeyen hata asla NO_ROUTE olmaz', async () => {
    installChrome({ replies: { SWAP_QUOTE: { error: 'timeout' } } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await pancakeEngine.quote(buyReq())).code).not.toBe(ENGINE_ERROR.NO_ROUTE)
  })
  it('yanit yok / sendMessage firlatir / bos data -> UNKNOWN ya da BAD_QUOTE_RESPONSE', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    installChrome({ replies: { SWAP_QUOTE: undefined } })
    expect((await pancakeEngine.quote(buyReq())).code).toBe(ENGINE_ERROR.UNKNOWN)
    installChrome({ replies: { SWAP_QUOTE: () => { throw new Error('port kapandi') } } })
    expect((await pancakeEngine.quote(buyReq())).code).toBe(ENGINE_ERROR.UNKNOWN)
    installChrome({ replies: { SWAP_QUOTE: { success: true } } })
    expect((await pancakeEngine.quote(buyReq())).code).toBe(ENGINE_ERROR.BAD_QUOTE_RESPONSE)
  })
  it('beklenen cikti bos dize -> BAD_QUOTE_RESPONSE (AMOUNT_TOO_SMALL degil)', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: { ...QUOTE_DATA, expectedOutput: '' } } } })
    expect((await pancakeEngine.quote(buyReq())).code).toBe(ENGINE_ERROR.BAD_QUOTE_RESPONSE)
  })
  it('beklenen cikti sifir -> AMOUNT_TOO_SMALL', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: { ...QUOTE_DATA, expectedOutput: '0', minimumReceived: '0' } } } })
    expect((await pancakeEngine.quote(buyReq())).code).toBe(ENGINE_ERROR.AMOUNT_TOO_SMALL)
  })
  it('zincir 56 degilse arka plana HIC gitmez', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: QUOTE_DATA } } })
    const res = await pancakeEngine.quote({ ...buyReq(), chainId: 1 })
    expect(res).toMatchObject({ success: false, code: ENGINE_ERROR.CHAIN_UNSUPPORTED })
    expect(send).not.toHaveBeenCalled()
  })
  it('aktif hesap yoksa arka plana gitmez', async () => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: QUOTE_DATA } } })
    delete storage.active_account
    const res = await pancakeEngine.quote(buyReq())
    expect(res.success).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
  it('gecersiz istek (null) -> INVALID_REQUEST', async () => {
    installChrome()
    expect(await pancakeEngine.quote(null)).toMatchObject({ success: false, code: ENGINE_ERROR.INVALID_REQUEST })
  })
})

describe('quoteRows', () => {
  const display = {
    engine: 'pancake', sellAmount: '100000000000000000000', sellDecimals: 18, expectedBuy: '500000000000000000',
    buyDecimals: 18, minBuy: '490000000000000000', unitPrice: 200, referencePrice: 250, gapPct: -20, gapWarn: true,
    priceImpact: { pct: 0.3, high: false, unmeasured: false },
    fees: { kind: 'ats', transfer: '0.4', commission: '0.1', total: '0.5', lpFeePct: '0.25%' },
    networkFeeUsd: null, networkFeePct: null, minAmountUsdForFee: null,
  }
  const rows = (d = display) => pancakeEngine.quoteRows({ result: { display: d, warnings: [], notice: null }, side: 'buy', symbol: 'CRCLB', paySymbol: 'USDT', locale: 'en' })
  it('ortak satirlar + pancake ekleri; CoW ucret/ag ucreti/bildirim satiri YOK', () => {
    const r = rows()
    expect(r.spend.value).toContain('USDT')
    expect(r.primary.value).toContain('CRCLB')
    expect(r.networkFee).toBeNull()
    expect(r.fees).toEqual([])
    expect(r.feesTotalUsd).toBeNull()
    expect(r.notice).toBeNull()
    expect(r.warnings).toEqual([])
    expect(r.priceImpact).toEqual({ pct: 0.3, high: false, unmeasured: false })
    expect(r.gapWarn).toBe(true)
    expect(r.ats).toMatchObject({ transfer: '0.4', commission: '0.1', total: '0.5', lpFeePct: '0.25%' })
  })
  it('display yoksa null', () => {
    expect(pancakeEngine.quoteRows({ result: null })).toBeNull()
  })
  it('secili para birimi (display) ortak satirlara gecer: birim fiyat ve referans TL, verilmezse USD', () => {
    const tl = pancakeEngine.quoteRows({ result: { display, warnings: [], notice: null }, side: 'buy', symbol: 'CRCLB', paySymbol: 'USDT', locale: 'tr-TR', display: { code: 'try', rate: 40, fellBack: false } })
    // 200 x 40 = 8.000 ; 250 x 40 = 10.000
    expect(tl.unitPrice.replace(/[\u00a0\u202f]/g, ' ')).toBe('₺8.000,00')
    expect(tl.reference.replace(/[\u00a0\u202f]/g, ' ')).toBe('₺10.000,00')
    expect(rows().unitPrice).toBe('$200.00')
    expect(rows().reference).toBe('$250.00')
  })
})

describe('place', () => {
  async function quoted(engine = pancakeEngine, extra = {}) {
    const res = await engine.quote(buyReq(extra))
    expect(res.success).toBe(true)
    return res
  }
  const placeArgs = (q, over = {}) => ({ quote: q, request: q.request, atsQuoted: ATS_QUOTED, accountIndex: DERIVATION, ...over })
  const okReplies = () => ({ SWAP_QUOTE: { success: true, data: QUOTE_DATA }, SWAP: { success: true, hash: '0xuserophash' } })

  it('SWAP mesaji: atsSwap + atsQuoted + kayitli istek; display/quote nesnesi YOK', async () => {
    installChrome({ slippage: 1, replies: okReplies() })
    const q = await quoted()
    const r = await pancakeEngine.place(placeArgs(q))
    const swaps = send.mock.calls.map((c) => c[0]).filter((m) => m.type === 'SWAP')
    expect(swaps).toHaveLength(1)
    const m = swaps[0].message
    expect(Object.keys(m).sort()).toEqual([...PANCAKE_PLACE_FIELDS].sort())
    expect(m).toEqual({
      index: DERIVATION, chainId: 56, inTokenAddress: USDT, outTokenAddress: STOCK, amount: '100', slippage: 1,
      atsSwap: true, atsQuoted: { transferFee: 0.4, commissionFee: 0.1 },
    })
    expect(JSON.stringify(swaps[0])).not.toMatch(/display|expectedBuy|minBuy|sellAmount/)
    expect(r).toMatchObject({ ok: true, kind: 'tx', id: q.quoteId, hash: '0xuserophash' })
  })
  it('kimlik meta: inTokenData/outTokenData yalniz kimlik alanlariyla SWAP mesajina girer (gecmis karti sembol/logo)', async () => {
    installChrome({ slippage: 1, replies: okReplies() })
    const q = await quoted()
    const r = await pancakeEngine.place(placeArgs(q, {
      inTokenData: { symbol: 'USDT', name: 'Tether', address: USDT.toLowerCase(), image: { large: 'https://x/usdt.png', evil: 'z' }, display: { price: 1 }, balance: '5' },
      outTokenData: { symbol: 'AAPLb', address: STOCK, image: 'https://x/aapl.png', priceUSD: 200 },
    }))
    expect(r.ok).toBe(true)
    const m = send.mock.calls.map((c) => c[0]).find((x) => x.type === 'SWAP').message
    expect(Object.keys(m).sort()).toEqual([...PANCAKE_PLACE_FIELDS, ...PANCAKE_PLACE_OPTIONAL_FIELDS].sort())
    expect(m.inTokenData).toEqual({ symbol: 'USDT', name: 'Tether', address: USDT, image: { large: 'https://x/usdt.png' } })
    expect(m.outTokenData).toEqual({ symbol: 'AAPLb', address: STOCK, image: 'https://x/aapl.png' })
    expect(JSON.stringify(m)).not.toMatch(/display|balance|priceUSD|evil/)
  })
  it('kimlik meta: sembolsuz meta atlanir; adresi islemle eslesmeyen meta QUOTE_MISMATCH ve SWAP gitmez', async () => {
    installChrome({ replies: okReplies() })
    const q = await quoted()
    const r = await pancakeEngine.place(placeArgs(q, { inTokenData: { name: 'sembolsuz' }, outTokenData: 'saçma' }))
    expect(r).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_MISMATCH })
    expect(send.mock.calls.some((c) => c[0].type === 'SWAP')).toBe(false)
    const q2 = await quoted()
    expect(await pancakeEngine.place(placeArgs(q2, { inTokenData: { symbol: 'USDT', address: USDC } }))).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_MISMATCH })
    expect(send.mock.calls.some((c) => c[0].type === 'SWAP')).toBe(false)
    const q3 = await quoted()
    await pancakeEngine.place(placeArgs(q3, { inTokenData: { name: 'sembolsuz' } }))
    const m = send.mock.calls.map((c) => c[0]).find((x) => x.type === 'SWAP').message
    expect(m).not.toHaveProperty('inTokenData')
  })
  it('sonuc "gonderildi" durumudur ve hash userOp hash olarak isaretlenir (tx hash DEGIL)', async () => {
    installChrome({ replies: okReplies() })
    const r = await pancakeEngine.place(placeArgs(await quoted()))
    expect(r.submitted).toBe(true)
    expect(r.hashKind).toBe('userOp')
    expect(r).not.toHaveProperty('confirmed')
    expect(r).not.toHaveProperty('uid')
  })
  it('SWAP hash vermeden success donerse yine ok (cift gonderim riskine girilmez), hash null', async () => {
    installChrome({ replies: { ...okReplies(), SWAP: { success: true } } })
    const r = await pancakeEngine.place(placeArgs(await quoted()))
    expect(r).toMatchObject({ ok: true, kind: 'tx', submitted: true, hash: null, hashKind: null })
  })
  it('teklif tek kullanimlik: ikinci place QUOTE_USED ve ikinci SWAP gitmez', async () => {
    installChrome({ replies: okReplies() })
    const q = await quoted()
    await pancakeEngine.place(placeArgs(q))
    const again = await pancakeEngine.place(placeArgs(q))
    expect(again).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_USED })
    expect(send.mock.calls.filter((c) => c[0].type === 'SWAP')).toHaveLength(1)
  })
  it('es zamanli iki place: yalniz biri SWAP gonderir', async () => {
    let release
    const gate = new Promise((res) => { release = res })
    installChrome({ replies: { ...okReplies(), SWAP: () => gate.then(() => ({ success: true, hash: '0xh' })) } })
    const q = await quoted()
    const p1 = pancakeEngine.place(placeArgs(q))
    const p2 = pancakeEngine.place(placeArgs(q))
    release()
    const [a, b] = await Promise.all([p1, p2])
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    expect(send.mock.calls.filter((c) => c[0].type === 'SWAP')).toHaveLength(1)
  })
  it('QUOTE_NOT_FOUND: bilinmeyen / eksik quoteId', async () => {
    installChrome({ replies: okReplies() })
    expect(await pancakeEngine.place({ quote: { quoteId: 'ps_999999' }, atsQuoted: ATS_QUOTED, accountIndex: DERIVATION })).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_NOT_FOUND })
    expect(await pancakeEngine.place({ quote: {}, atsQuoted: ATS_QUOTED })).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_NOT_FOUND })
    expect(await pancakeEngine.place()).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_NOT_FOUND })
    expect(send.mock.calls.some((c) => c[0].type === 'SWAP')).toBe(false)
  })
  it('QUOTE_EXPIRED: omur dolunca (sinirda hala gecerli, sonrasi degil); SWAP gitmez', async () => {
    let t = 5_000
    const eng = createPancakeEngine({ now: () => t })
    installChrome({ replies: okReplies() })
    const q1 = await quoted(eng)
    t = 5_000 + 30_000 // tam sinir: expiresAt'a esit -> hala gecerli
    expect((await eng.place(placeArgs(q1))).ok).toBe(true)
    t = 5_000
    const q2 = await quoted(eng)
    t = 5_000 + 30_001
    const r = await eng.place(placeArgs(q2))
    expect(r).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_EXPIRED })
    expect(send.mock.calls.filter((c) => c[0].type === 'SWAP')).toHaveLength(1) // yalniz q1'inki
    // suresi dolmus kayit silinir: tekrar denenirse artik bulunamaz
    expect(await eng.place(placeArgs(q2))).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_NOT_FOUND })
  })
  it('ACCOUNT_CHANGED: ekranin verdigi hesap ya da depodaki aktif hesap tekliften farkliysa SWAP gitmez', async () => {
    installChrome({ replies: okReplies() })
    const q = await quoted()
    expect(await pancakeEngine.place(placeArgs(q, { accountIndex: IMPORTED }))).toEqual({ ok: false, code: ENGINE_ERROR.ACCOUNT_CHANGED })
    // depodaki aktif hesap degisti (SWAP arka plani aktif hesabi kullanir!)
    storage.active_account = { type: 'imported', address: IMPORTED }
    expect(await pancakeEngine.place(placeArgs(q))).toEqual({ ok: false, code: ENGINE_ERROR.ACCOUNT_CHANGED })
    expect(send.mock.calls.some((c) => c[0].type === 'SWAP')).toBe(false)
  })
  it('hesap kontrolu SWAP kuyruga girmeden yapilir ve basarisiz kontrol teklifi YAKMAZ (yeniden denenebilir)', async () => {
    installChrome({ replies: okReplies() })
    const q = await quoted()
    await pancakeEngine.place(placeArgs(q, { accountIndex: IMPORTED }))
    expect((await pancakeEngine.place(placeArgs(q))).ok).toBe(true)
  })
  it('QUOTE_MISMATCH: ekran teklifle farkli tutar/yon/token gonderirse', async () => {
    installChrome({ replies: okReplies() })
    const q = await quoted()
    for (const over of [{ amount: '101' }, { inTokenAddress: USDC }, { outTokenAddress: USDC }, { chainId: 1 }]) {
      const r = await pancakeEngine.place(placeArgs(q, { request: { ...q.request, ...over } }))
      expect(r).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_MISMATCH })
    }
    expect(send.mock.calls.some((c) => c[0].type === 'SWAP')).toBe(false)
  })
  it('ATS_BLOCKED (fail-closed): atsQuoted yok / gecersiz / ucret 0 ise SWAP gitmez ve teklif yanmaz', async () => {
    installChrome({ replies: okReplies() })
    const q = await quoted()
    for (const atsQuoted of [undefined, null, {}, { transferFee: 0, commissionFee: 0 }, { transferFee: 'x', commissionFee: 0 }, { transferFee: 0.4 }, { transferFee: -1, commissionFee: 0 }, { transferFee: 0.4, commissionFee: -1 }]) {
      expect(await pancakeEngine.place(placeArgs(q, { atsQuoted }))).toEqual({ ok: false, code: ENGINE_ERROR.ATS_BLOCKED })
    }
    expect(send.mock.calls.some((c) => c[0].type === 'SWAP')).toBe(false)
    expect((await pancakeEngine.place(placeArgs(q))).ok).toBe(true)
  })
  it('ATS kararlari (decision) engelliyorsa ATS_BLOCKED', async () => {
    installChrome({ replies: okReplies() })
    const q = await quoted()
    expect(await pancakeEngine.place(placeArgs(q, { atsBlocked: true }))).toEqual({ ok: false, code: ENGINE_ERROR.ATS_BLOCKED })
    expect(send.mock.calls.some((c) => c[0].type === 'SWAP')).toBe(false)
  })
  it('atsQuoted dize sayilari da kabul edilir (ekran formatlari)', async () => {
    installChrome({ replies: okReplies() })
    const q = await quoted()
    const r = await pancakeEngine.place(placeArgs(q, { atsQuoted: { transferFee: '0.4', commissionFee: '0' } }))
    expect(r.ok).toBe(true)
  })
  it.each([
    [`${BSTOCK_MULTIPLIER_ERROR}: 0xabc (rpc)`, ENGINE_ERROR.MULTIPLIER_UNREADABLE],
    ['Insufficient balance', ENGINE_ERROR.INSUFFICIENT_BALANCE],
    ['insufficient funds for intrinsic transaction cost', ENGINE_ERROR.INSUFFICIENT_BALANCE],
    ['Unsupported chain', ENGINE_ERROR.CHAIN_UNSUPPORTED],
    ['XSTOCK_USE_COW: 0xabc', ENGINE_ERROR.UNSUPPORTED_TOKEN],
    ['ATS ucreti onaylanan tutari asti (1 > 0.5)', ENGINE_ERROR.SWAP_FAILED],
    ['bilinmeyen', ENGINE_ERROR.SWAP_FAILED],
  ])('SWAP hatasi esleme: %s -> %s', async (error, code) => {
    installChrome({ replies: { ...okReplies(), SWAP: { error } } })
    const q = await quoted()
    const r = await pancakeEngine.place(placeArgs(q))
    expect(r).toEqual({ ok: false, code })
  })
  it('SWAP yaniti yok / sendMessage firlatir -> UNKNOWN (gonderilmis olabilir, "basarisiz" denmez)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    installChrome({ replies: { ...okReplies(), SWAP: undefined } })
    expect(await pancakeEngine.place(placeArgs(await quoted()))).toEqual({ ok: false, code: ENGINE_ERROR.UNKNOWN })
    installChrome({ replies: { ...okReplies(), SWAP: () => { throw new Error('port') } } })
    expect(await pancakeEngine.place(placeArgs(await quoted()))).toEqual({ ok: false, code: ENGINE_ERROR.UNKNOWN })
  })
  it('hata sonrasi teklif yanik sayilir: ayni teklifle tekrar SWAP gitmez', async () => {
    installChrome({ replies: { ...okReplies(), SWAP: { error: 'bilinmeyen' } } })
    const q = await quoted()
    await pancakeEngine.place(placeArgs(q))
    expect(await pancakeEngine.place(placeArgs(q))).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_USED })
    expect(send.mock.calls.filter((c) => c[0].type === 'SWAP')).toHaveLength(1)
  })
  it('bellek siniri: cok teklif birikse de en eski kayitlar atilir', async () => {
    installChrome({ replies: okReplies() })
    const eng = createPancakeEngine()
    const first = await quoted(eng)
    for (let i = 0; i < 40; i++) await quoted(eng)
    expect(await eng.place(placeArgs(first))).toEqual({ ok: false, code: ENGINE_ERROR.QUOTE_NOT_FOUND })
  })
})

describe('errorKey (T14): CoW a ozgu metin bStocks ta gorunmez', () => {
  it('ag/zaman asimi/sunucu hatalari notr metne, FORBIDDEN (CoW engeli) genel hataya', () => {
    for (const code of [ENGINE_ERROR.NETWORK, ENGINE_ERROR.TIMEOUT, ENGINE_ERROR.SERVER]) {
      expect(pancakeEngine.errorKey(code)).toBe('stockTrade.error.NETWORK_GENERIC')
    }
    expect(pancakeEngine.errorKey(ENGINE_ERROR.FORBIDDEN)).toBe('stockTrade.error.UNKNOWN')
  })
  it('pancake kodlari ve ortak kodlar kendi anahtarlarina, bilinmeyen UNKNOWN a', () => {
    for (const code of ['NO_ROUTE', 'MULTIPLIER_UNREADABLE', 'PRICE_IMPACT_HIGH', 'ATS_BLOCKED', 'SWAP_FAILED', 'CHAIN_UNSUPPORTED', 'NO_LIQUIDITY', 'QUOTE_EXPIRED']) {
      expect(pancakeEngine.errorKey(code)).toBe(`stockTrade.error.${code}`)
    }
    expect(pancakeEngine.errorKey('zzz')).toBe('stockTrade.error.UNKNOWN')
  })
})

describe('Swap.vue ile uyum (kaynak okuma)', () => {
  it('SWAP_QUOTE / SWAP / ATS yuku alanlari Swap.vue ile ayni adlari kullanir', async () => {
    const { readFileSync } = await import('node:fs')
    const vue = readFileSync(new URL('../../../components/Swap.vue', import.meta.url), 'utf8')
    for (const key of ['inTokenAddress', 'outTokenAddress', 'slippage', 'atsSwap', 'atsQuoted', 'transferFee', 'commissionFee', "'SWAP_QUOTE'", "type: 'SWAP'"]) {
      expect(vue).toContain(key)
    }
  })
})

beforeEach(() => {
  delete globalThis.chrome
})

// A-2 (nihai inceleme): ATS yolunda SWAP yaniti makbuzdan SONRA gelir. Makbuz dogrulanamazsa islem ZINCIRE
// GITMIS olabilir: "gonderilemedi, tekrar dene" demek cift alima yol acar. userOp ici revert ise "gonderildi"
// DEGIL, basarisizdir.
describe('place - makbuz dogrulanamadi / userOp ici revert (A-2)', () => {
  const placeArgs = (q) => ({ quote: q, request: q.request, atsQuoted: ATS_QUOTED, accountIndex: DERIVATION })
  const HASH_TX = `0x${'ab'.repeat(32)}`
  const quoteThenPlace = async (swapReply) => {
    installChrome({ replies: { SWAP_QUOTE: { success: true, data: QUOTE_DATA }, SWAP: swapReply } })
    const q = await pancakeEngine.quote(buyReq())
    return pancakeEngine.place(placeArgs(q))
  }
  it('arka plan unverified:true dondururse sonuc ok + unverified (hata DEGIL, tekrar-dene yok)', async () => {
    const r = await quoteThenPlace({ success: true, hash: '0xuserop', txHash: HASH_TX, unverified: true })
    expect(r).toMatchObject({ ok: true, kind: 'tx', submitted: true, unverified: true, hash: '0xuserop', hashKind: 'userOp' })
  })
  it('normal basarida unverified isareti YOK', async () => {
    const r = await quoteThenPlace({ success: true, hash: '0xuserop' })
    expect(r.ok).toBe(true)
    expect(r.unverified).not.toBe(true)
  })
  it('hata metni "islem sonucu dogrulanamadi (txHash: ...)" ise SWAP_FAILED DEGIL, unverified gonderildi', async () => {
    const r = await quoteThenPlace({ error: `islem sonucu dogrulanamadi (txHash: ${HASH_TX})` })
    expect(r).toMatchObject({ ok: true, kind: 'tx', submitted: true, unverified: true })
    expect(r.hash).toBe(HASH_TX)
  })
  it('userOp ici revert (executeAtsTransfer: transfer islemi basarisiz...) -> SWAP_REVERTED, ok degil', async () => {
    const r = await quoteThenPlace({ error: 'transfer islemi basarisiz veya sonucu dogrulanamadi' })
    expect(r).toEqual({ ok: false, code: ENGINE_ERROR.SWAP_REVERTED })
    expect(pancakeEngine.errorKey(r.code)).toBe('stockTrade.error.SWAP_REVERTED')
  })
  it('gercekten gonderilemeyen hata hala SWAP_FAILED', async () => {
    const r = await quoteThenPlace({ error: 'bambaska bir sey' })
    expect(r).toEqual({ ok: false, code: ENGINE_ERROR.SWAP_FAILED })
  })
})

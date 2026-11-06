import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { COW_ERROR } from '../../cow/errors'
import { buildQuoteMessage as cowBuild, primaryAction as cowPrimary, quoteRows as cowRows } from '../../stockTrade'
import { payTokensFor } from '../../cow/config'
import { ENGINE_ERROR, PANCAKE_ERROR_CODES, engineErrorKey, isEngineCode } from './errors'
import { cowEngine } from './cowEngine'
import { pancakeEngine } from './pancakeEngine'
import { engineFor, registerEngine, tradeEnabledFor } from './index'

const XS = '0x1111111111111111111111111111111111111111'
const PAY = payTokensFor(1)[0]

afterEach(() => {
  delete globalThis.chrome
  registerEngine('pancake', pancakeEngine)
})

describe('errors.js', () => {
  it('CoW kodlari AYNEN, pancake kodlari eklenir, kume kapali', () => {
    for (const k of Object.keys(COW_ERROR)) expect(ENGINE_ERROR[k]).toBe(k)
    for (const k of ['NO_ROUTE', 'NO_LIQUIDITY', 'AMOUNT_TOO_SMALL', 'MULTIPLIER_UNREADABLE', 'PRICE_IMPACT_HIGH', 'ATS_BLOCKED', 'SWAP_FAILED', 'QUOTE_EXPIRED', 'QUOTE_NOT_FOUND', 'ACCOUNT_CHANGED', 'CHAIN_UNSUPPORTED', 'UNKNOWN']) {
      expect(isEngineCode(k)).toBe(true)
    }
    expect(PANCAKE_ERROR_CODES).toContain('NO_ROUTE')
    expect(Object.isFrozen(ENGINE_ERROR)).toBe(true)
    expect(isEngineCode('FOO')).toBe(false)
    expect(isEngineCode(undefined)).toBe(false)
  })
  it('engineErrorKey bilinmeyeni UNKNOWNa dusurur', () => {
    expect(engineErrorKey('NO_ROUTE')).toBe('stockTrade.error.NO_ROUTE')
    expect(engineErrorKey('QUOTE_EXPIRED')).toBe('stockTrade.error.QUOTE_EXPIRED')
    expect(engineErrorKey('zzz')).toBe('stockTrade.error.UNKNOWN')
  })
})

describe('index.js', () => {
  it('engineFor: xstocks -> cow, bstocks -> pancake (kayit degistirilebilir), aksi null', () => {
    expect(engineFor({ issuer: 'xstocks' })).toBe(cowEngine)
    expect(engineFor({ issuer: 'bstocks' })).toBe(pancakeEngine)
    registerEngine('pancake', null)
    expect(engineFor({ issuer: 'bstocks' })).toBeNull()
    const fake = { id: 'pancake' }
    registerEngine('pancake', fake)
    expect(engineFor({ issuer: 'bstocks' })).toBe(fake)
    expect(engineFor({ issuer: 'other' })).toBeNull()
    expect(engineFor(null)).toBeNull()
  })
  it('registerEngine yalniz bilinen kimlikleri kabul eder; cow degistirilemez', () => {
    expect(() => registerEngine('cow', {})).toThrow()
    expect(() => registerEngine('x', {})).toThrow()
  })
  it('tradeEnabledFor bayrak matrisi', () => {
    expect(tradeEnabledFor({ issuer: 'bstocks' }, { xstocksEnabled: false })).toBe(true)
    expect(tradeEnabledFor({ issuer: 'bstocks' }, { xstocksEnabled: true })).toBe(true)
    expect(tradeEnabledFor({ issuer: 'xstocks' }, { xstocksEnabled: false })).toBe(false)
    expect(tradeEnabledFor({ issuer: 'xstocks' }, { xstocksEnabled: true })).toBe(true)
    expect(tradeEnabledFor(null)).toBe(false)
    expect(tradeEnabledFor({ issuer: 'zzz' }, { xstocksEnabled: true })).toBe(false)
  })
})

describe('cowEngine', () => {
  it('arayuz bayraklari', () => {
    expect(cowEngine).toMatchObject({
      id: 'cow', hasApprovalStep: true, hasPriceImpactGate: false, hasReferenceLock: true,
      hasOrderLifecycle: true, showsCowDisclosure: true,
    })
    expect(cowEngine.atsPayload({})).toBeNull()
  })
  it('stockTrade.js fonksiyonlarina delege eder (ayni referans/sonuc)', () => {
    const a = { side: 'buy', chainId: 1, stockAddress: XS, payToken: PAY.address, amount: '10' }
    expect(cowEngine.buildQuoteMessage({ ...a, payToken: PAY })).toEqual(cowBuild(a))
    expect(cowEngine.buildQuoteMessage({ ...a, payToken: PAY, chainId: 137 })).toBeNull()
    expect(cowEngine.primaryAction({ approval: { mode: 'onchain' } })).toBe(cowPrimary({ approval: { mode: 'onchain' } }))
    expect(cowEngine.primaryAction({})).toBe('trade')
    const arg = { result: { display: { sellAmount: '1000000', sellDecimals: 6, expectedBuy: '5', buyDecimals: 18, minBuy: '4', unitPrice: 1, referencePrice: 1, gapPct: 0.5, networkFeeUsd: 0.6, networkFeePct: 6.2, fees: { networkUsd: 0.6, cowUsd: 0.1, watsUsd: 0.1, totalUsd: 0.8 } } }, side: 'buy', symbol: 'TSLAx', paySymbol: 'USDC', locale: 'en' }
    expect(cowEngine.quoteRows(arg)).toEqual(cowRows(arg))
    expect(cowEngine.quoteRows(arg).networkFee).not.toBeNull()
  })
  it('payTokens cow tablosundan', () => {
    expect(cowEngine.payTokens(1)).toEqual(payTokensFor(1))
    expect(cowEngine.payTokens(137)).toEqual([])
  })
  it('quote COW_QUOTE mesajini yollar ve yaniti aynen dondurur', async () => {
    const reply = { success: true, locked: false, quoteId: 'q1', display: { x: 1 } }
    const send = vi.fn().mockResolvedValue(reply)
    globalThis.chrome = { runtime: { sendMessage: send } }
    const req = { side: 'buy', chainId: 1, stockAddress: XS, payToken: PAY.address, amount: '10' }
    expect(await cowEngine.quote(req)).toBe(reply)
    expect(send).toHaveBeenCalledWith({ type: 'COW_QUOTE', message: req })
  })
  it('place COW_PLACE_ORDER yalniz quoteId ile; basari/hata esleme', async () => {
    const send = vi.fn().mockResolvedValueOnce({ success: true, uid: '0xabc', state: 'open' })
      .mockResolvedValueOnce({ success: false, code: 'QUOTE_EXPIRED' })
      .mockResolvedValueOnce({ success: false, code: 'garip' })
      .mockRejectedValueOnce(new Error('x'))
    globalThis.chrome = { runtime: { sendMessage: send } }
    const q = { quoteId: 'q1', display: { a: 1 } }
    expect(await cowEngine.place({ quote: q, request: {}, accountIndex: 0 })).toEqual({ ok: true, id: '0xabc', kind: 'order', uid: '0xabc', state: 'open' })
    expect(send).toHaveBeenNthCalledWith(1, { type: 'COW_PLACE_ORDER', message: { quoteId: 'q1' } })
    expect(await cowEngine.place({ quote: q })).toEqual({ ok: false, code: 'QUOTE_EXPIRED' })
    expect(await cowEngine.place({ quote: q })).toEqual({ ok: false, code: 'UNKNOWN' })
    expect(await cowEngine.place({ quote: q })).toEqual({ ok: false, code: 'UNKNOWN' })
    expect(await cowEngine.place({ quote: {} })).toEqual({ ok: false, code: 'QUOTE_NOT_FOUND' })
  })
  it('place: yanitta state yoksa PlaceResult.state null (T15, StockOrderConfirm sonuc.state kullanir)', async () => {
    globalThis.chrome = { runtime: { sendMessage: vi.fn().mockResolvedValue({ success: true, uid: '0xdef' }) } }
    const r = await cowEngine.place({ quote: { quoteId: 'q2' } })
    expect(r).toEqual({ ok: true, id: '0xdef', kind: 'order', uid: '0xdef', state: null })
  })
  it('errorKey kapali kume', () => {
    expect(cowEngine.errorKey('QUOTE_USED')).toBe('stockTrade.error.QUOTE_USED')
    expect(cowEngine.errorKey('nope')).toBe('stockTrade.error.UNKNOWN')
  })
})

describe('kaynak taramasi', () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8')
  it('cowEngine stockTrade.js importu eder, CoW mantigini kopyalamaz', () => {
    const src = read('./cowEngine.js')
    expect(src).toMatch(/from '\.\.\/\.\.\/stockTrade'/)
    expect(src).toContain("'COW_QUOTE'")
    expect(src).toContain("'COW_PLACE_ORDER'")
    expect(src).not.toMatch(/PRICE_PROTECTION_BPS|parseFloat\(|Number\(/)
  })
})

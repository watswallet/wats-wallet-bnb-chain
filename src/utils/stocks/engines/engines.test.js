import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { COW_ERROR } from '../../cow/errors'
import { gateLockedReply } from '../../stockGate/errors'
import { buildQuoteMessage as cowBuild, primaryAction as cowPrimary, quoteRows as cowRows } from '../../stockTrade'
import { payTokensFor } from '../../cow/config'
import { ENGINE_ERROR, LCX_ERROR_CODES, PANCAKE_ERROR_CODES, engineErrorKey, isEngineCode } from './errors'
import { LCX_ENABLED } from '../../featureFlags'
import { cowEngine } from './cowEngine'
import { lcxEngine } from './lcxEngine'
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
  it('LCX (RWA) kodlari: yedi yeni kod, kume kapali; pancake ve CoW kod kumeleri degismez', () => {
    expect([...LCX_ERROR_CODES]).toEqual([
      'REF_PRICE_OFF', 'NO_REFERENCE_PRICE', 'INSUFFICIENT_LIQUIDITY', 'RWA_EXCLUDED', 'ISSUER_MISMATCH', 'LCX_UNAVAILABLE', 'LCX_TX_REJECTED',
    ])
    for (const k of LCX_ERROR_CODES) {
      expect(ENGINE_ERROR[k]).toBe(k)
      expect(isEngineCode(k)).toBe(true)
      expect(engineErrorKey(k)).toBe(`stockTrade.error.${k}`)
      expect(COW_ERROR[k]).toBeUndefined()
      expect(PANCAKE_ERROR_CODES).not.toContain(k)
    }
    expect(Object.isFrozen(LCX_ERROR_CODES)).toBe(true)
    // mevcut kodlar yerinde: LCX eslemesi SWAP_REVERTED / NO_ROUTE / QUOTE_EXPIRED / INSUFFICIENT_BALANCE i yeniden kullanir
    for (const k of ['SWAP_REVERTED', 'NO_ROUTE', 'QUOTE_EXPIRED', 'INSUFFICIENT_BALANCE', 'STOCK_GATE']) expect(isEngineCode(k)).toBe(true)
  })
  it('STOCK_GATE CoW kodundan yayilir (PANCAKE_ERROR_CODES te DEGIL); kume kapali kalir (K30)', () => {
    expect(ENGINE_ERROR.STOCK_GATE).toBe('STOCK_GATE')
    expect(isEngineCode('STOCK_GATE')).toBe(true)
    expect(COW_ERROR.STOCK_GATE).toBe('STOCK_GATE')
    expect(PANCAKE_ERROR_CODES).not.toContain('STOCK_GATE')
    expect(engineErrorKey('STOCK_GATE')).toBe('stockTrade.error.STOCK_GATE')
    expect(pancakeEngine.errorKey('STOCK_GATE')).toBe('stockTrade.error.STOCK_GATE')
    expect(cowEngine.errorKey('STOCK_GATE')).toBe('stockTrade.error.STOCK_GATE')
  })
  it('engineErrorKey bilinmeyeni UNKNOWNa dusurur', () => {
    expect(engineErrorKey('NO_ROUTE')).toBe('stockTrade.error.NO_ROUTE')
    expect(engineErrorKey('QUOTE_EXPIRED')).toBe('stockTrade.error.QUOTE_EXPIRED')
    expect(engineErrorKey('zzz')).toBe('stockTrade.error.UNKNOWN')
  })
})

describe('index.js', () => {
  it('engineFor: LCX satiri (source lcx) -> lcx; bu kontrol ihracci kontrollerinden ONCE gelir', () => {
    expect(engineFor({ source: 'lcx', issuer: 'coinbase' })).toBe(lcxEngine)
    expect(engineFor({ source: 'lcx', issuer: 'ondo' })).toBe(lcxEngine)
    expect(engineFor({ source: 'lcx' })).toBe(lcxEngine)
    // ihracci xstocks / bstocks yazsa bile source lcx ise lcx (statik motorlara dusmez)
    expect(engineFor({ source: 'lcx', issuer: 'xstocks' })).toBe(lcxEngine)
    expect(engineFor({ source: 'lcx', issuer: 'bstocks' })).toBe(lcxEngine)
    // source yoksa / baska ise eski davranis
    expect(engineFor({ issuer: 'coinbase' })).toBeNull()
    expect(engineFor({ source: 'static', issuer: 'bstocks' })).toBe(pancakeEngine)
    expect(engineFor({ issuer: 'xstocks' })).toBe(cowEngine)
    expect(engineFor({ source: 'LCX', issuer: 'coinbase' })).toBeNull()
    // pancake kaydi bosaltilsa da lcx etkilenmez
    registerEngine('pancake', null)
    expect(engineFor({ source: 'lcx', issuer: 'coinbase' })).toBe(lcxEngine)
  })
  it('registerEngine lcx i DEGISTIRMEZ (cow gibi sabit)', () => {
    expect(() => registerEngine('lcx', {})).toThrow()
    expect(engineFor({ source: 'lcx', issuer: 'coinbase' })).toBe(lcxEngine)
  })
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
  it('tradeEnabledFor LCX bayrak matrisi: LCX satiri yalniz lcxEnabled e bakar (xstocksEnabled etkisiz)', () => {
    const lcx = { source: 'lcx', issuer: 'coinbase' }
    expect(tradeEnabledFor(lcx, { lcxEnabled: true })).toBe(true)
    expect(tradeEnabledFor(lcx, { lcxEnabled: false })).toBe(false)
    expect(tradeEnabledFor(lcx, { lcxEnabled: true, xstocksEnabled: false })).toBe(true)
    expect(tradeEnabledFor(lcx, { lcxEnabled: false, xstocksEnabled: true })).toBe(false)
    expect(tradeEnabledFor(lcx, { xstocksEnabled: true })).toBe(LCX_ENABLED) // varsayilan: derleme bayragi
    expect(tradeEnabledFor(lcx)).toBe(LCX_ENABLED)
    expect(tradeEnabledFor({ source: 'lcx' }, { lcxEnabled: true })).toBe(true)
    // source lcx kontrolu ihracci kontrollerinden once: xstocks/bstocks yazan LCX satiri statik bayraga baglanmaz
    expect(tradeEnabledFor({ source: 'lcx', issuer: 'xstocks' }, { lcxEnabled: false, xstocksEnabled: true })).toBe(false)
    expect(tradeEnabledFor({ source: 'lcx', issuer: 'bstocks' }, { lcxEnabled: false })).toBe(false)
    expect(tradeEnabledFor({ source: 'lcx', issuer: 'xstocks' }, { lcxEnabled: true, xstocksEnabled: false })).toBe(true)
    // lcxEnabled yalniz gercek bir degerle acar (gevsek kapali degerler kapali)
    expect(tradeEnabledFor(lcx, { lcxEnabled: undefined })).toBe(LCX_ENABLED)
    expect(tradeEnabledFor(lcx, { lcxEnabled: 0 })).toBe(false)
    expect(tradeEnabledFor(lcx, { lcxEnabled: '' })).toBe(false)
    // statik satirlar lcxEnabled den etkilenmez
    expect(tradeEnabledFor({ issuer: 'bstocks' }, { lcxEnabled: false, xstocksEnabled: false })).toBe(true)
    expect(tradeEnabledFor({ issuer: 'xstocks' }, { lcxEnabled: true, xstocksEnabled: false })).toBe(false)
    expect(tradeEnabledFor({ issuer: 'coinbase' }, { lcxEnabled: true })).toBe(false) // source yok: LCX satiri degil
  })
})

describe('usesAts alani (Gorev 7)', () => {
  it('pancake ve lcx true, cow false; baska hicbir bayrak degismedi', () => {
    expect(pancakeEngine.usesAts).toBe(true)
    expect(lcxEngine.usesAts).toBe(true)
    expect(cowEngine.usesAts).toBe(false)
    expect(pancakeEngine).toMatchObject({ id: 'pancake', hasApprovalStep: false, hasPriceImpactGate: true, hasReferenceLock: false, hasOrderLifecycle: false, showsCowDisclosure: false })
    expect(cowEngine).toMatchObject({ id: 'cow', hasApprovalStep: true, hasPriceImpactGate: false, hasReferenceLock: true, hasOrderLifecycle: true, showsCowDisclosure: true })
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
  it('kapi: COW_QUOTE kilit yanitini AYNEN iletir (motor kapi bilmez, karar arka planda)', async () => {
    const reply = gateLockedReply('IP_COUNTRY_ISSUER')
    const send = vi.fn().mockResolvedValue(reply)
    globalThis.chrome = { runtime: { sendMessage: send } }
    const req = { side: 'buy', chainId: 1, stockAddress: XS, payToken: PAY.address, amount: '10' }
    expect(await cowEngine.quote(req)).toBe(reply)
    expect(send).toHaveBeenCalledWith({ type: 'COW_QUOTE', message: req })
    // K32: kilit yaniti 10 anahtardir, gateAction yoktur.
    expect(Object.keys(reply)).toHaveLength(10)
    expect(reply).not.toHaveProperty('gateAction')
  })
  it('kapi: COW_PLACE_ORDER STOCK_GATE ve ACCOUNT_CHANGED kodlari UNKNOWN a dusmeden gecer', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ success: false, code: 'STOCK_GATE', gateReason: 'IP_COUNTRY_ISSUER' })
      .mockResolvedValueOnce({ success: false, code: 'ACCOUNT_CHANGED' })
    globalThis.chrome = { runtime: { sendMessage: send } }
    const q = { quoteId: 'q1' }
    expect(await cowEngine.place({ quote: q })).toEqual({ ok: false, code: 'STOCK_GATE' })
    expect(await cowEngine.place({ quote: q })).toEqual({ ok: false, code: 'ACCOUNT_CHANGED' })
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
  it('cowEngine kapi modulunu import ETMEZ (kapi arka planda; kilit yaniti ve kod aynen iletilir)', () => {
    expect(read('./cowEngine.js')).not.toMatch(/stockGate/)
  })
})

// CoW marketGate: ihracci piyasa kapisi (betigin kopyasi + esitlik kilidi) ve Al/Sat kilit kurali.
// Kapali piyasada CoW 200 + sisken fiyat doner (Review Focus 1): kapi ihracci API'sinden okunur.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tradingGate as ref, extractTrading as refExtract } from '../../../scripts/verify-xstocks-core.mjs'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { extractTrading, tradingGate, marketNotice, preQuoteLock } from './marketGate'

const KAYNAK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'marketGate.js')

const acik = () => ({
  openNow: true,
  currentPeriod: 'market',
  nextChangeAt: '2026-10-12T00:00:00.000Z',
  limitsPerPeriod: { market: { maxOrderFiatValue: 1e8 }, TwentyFourFive: { maxOrderFiatValue: 1e8 } },
})
const kapali = () => ({
  openNow: false,
  currentPeriod: 'closed',
  nextChangeAt: '2026-10-12T00:00:00.000Z',
  limitsPerPeriod: { closed: { maxOrderFiatValue: 0 } },
})
const belirsiz = () => ({ openNow: true, currentPeriod: 'closed', nextChangeAt: null, limitsPerPeriod: {} })

describe('K2 esitlik kilidi: betikle ayni karar', () => {
  const openNows = [true, false, undefined, 'true', null]
  const periods = ['market', 'closed', undefined, 5]
  const limits = [undefined, null, '', 0, '0', 100, 'x']
  it('140 kombinasyonda tradingGate betikle ayni', () => {
    let n = 0
    for (const openNow of openNows) {
      for (const currentPeriod of periods) {
        for (const limit of limits) {
          const trading = { openNow, currentPeriod, nextChangeAt: '2026-10-12T00:00:00.000Z' }
          trading.limitsPerPeriod = { [String(currentPeriod)]: { maxOrderFiatValue: limit } }
          expect(tradingGate(trading)).toEqual(ref(trading))
          n += 1
        }
      }
    }
    expect(n).toBe(140)
  })
  it('betikle ayni karar: null / undefined / dize / bos nesne', () => {
    for (const t of [null, undefined, 'x', 5, {}]) expect(tradingGate(t)).toEqual(ref(t))
  })
  it('extractTrading: 5 zarf + null + {} betikle ayni', () => {
    const t = acik()
    const zarflar = [t && { trading: t }, { data: { trading: t } }, { asset: { trading: t } }, [{ trading: t }], { data: [{ trading: t }] }, null, {}]
    for (const z of zarflar) expect(extractTrading(z)).toEqual(refExtract(z))
    expect(extractTrading({ data: [{ trading: t }] })).toEqual(t)
    expect(extractTrading({ asset: { trading: t } })).toEqual(t)
    expect(extractTrading(null)).toBeNull()
    expect(extractTrading({})).toBeNull()
  })
})

describe('tradingGate sabit senaryolar', () => {
  it('acik (TwentyFourFive, 1e8)', () => {
    const g = tradingGate({ ...acik(), currentPeriod: 'TwentyFourFive' })
    expect(g.open).toBe(true)
    expect(g.reason).toBeNull()
  })
  it('acik (market, 1e8)', () => {
    expect(tradingGate(acik()).open).toBe(true)
  })
  it('Cumartesi: PIYASA_KAPALI', () => {
    expect(tradingGate(kapali())).toEqual({
      open: false,
      reason: 'PIYASA_KAPALI',
      period: 'closed',
      nextChangeAt: '2026-10-12T00:00:00.000Z',
    })
  })
  it('celiski: PIYASA_DURUMU_BELIRSIZ', () => {
    expect(tradingGate(belirsiz()).reason).toBe('PIYASA_DURUMU_BELIRSIZ')
    expect(tradingGate(belirsiz()).open).toBe(false)
  })
  it('null: TRADING_BILGISI_YOK', () => {
    expect(tradingGate(null).reason).toBe('TRADING_BILGISI_YOK')
  })
  it('openNow truthy dize ACIK sayilmaz', () => {
    expect(tradingGate({ ...acik(), openNow: 'true' }).open).toBe(false)
  })
  it('negatif limit ACIK sayilmaz (limit > 0 siniri; 0 ayri dalda kapali sayilir)', () => {
    const t = acik()
    t.limitsPerPeriod.market.maxOrderFiatValue = -5
    expect(tradingGate(t)).toEqual(ref(t))
    expect(tradingGate(t).open).toBe(false)
  })
  it('limit 0 ACIK sayilmaz', () => {
    const t = acik()
    t.limitsPerPeriod.market.maxOrderFiatValue = 0
    expect(tradingGate(t).open).toBe(false)
  })
})

describe('preQuoteLock matrisi (K1)', () => {
  const REF = 776.86
  const piyasalar = { acik: acik(), kapali: kapali(), bilinmiyor: belirsiz(), yok: null }

  it('Al: acik + ref -> null', () => {
    expect(preQuoteLock({ side: 'buy', trading: piyasalar.acik, reference: REF })).toBeNull()
  })
  it('Al: acik + ref yok -> REFERENCE_MISSING', () => {
    expect(preQuoteLock({ side: 'buy', trading: piyasalar.acik, reference: null })).toEqual({
      code: 'REFERENCE_MISSING',
      nextChangeAt: null,
    })
  })
  it('Al: kapali + ref -> MARKET_CLOSED + nextChangeAt', () => {
    expect(preQuoteLock({ side: 'buy', trading: piyasalar.kapali, reference: REF })).toEqual({
      code: 'MARKET_CLOSED',
      nextChangeAt: '2026-10-12T00:00:00.000Z',
    })
  })
  it('Al: kapali + ref yok -> MARKET_CLOSED (piyasa referanstan once)', () => {
    expect(preQuoteLock({ side: 'buy', trading: piyasalar.kapali, reference: null }).code).toBe('MARKET_CLOSED')
  })
  it('Al: bilinmiyor / trading yok -> MARKET_UNKNOWN (ref var ya da yok)', () => {
    for (const trading of [piyasalar.bilinmiyor, piyasalar.yok, undefined]) {
      for (const reference of [REF, null]) {
        expect(preQuoteLock({ side: 'buy', trading, reference })).toEqual({ code: 'MARKET_UNKNOWN', nextChangeAt: null })
      }
    }
  })
  it('Al: trading alani hata (dize / sayi) -> MARKET_UNKNOWN', () => {
    for (const trading of ['hata', 5, true]) {
      expect(preQuoteLock({ side: 'buy', trading, reference: REF }).code).toBe('MARKET_UNKNOWN')
    }
  })
  it('Sat: piyasa ne olursa olsun ref varsa kilit yok', () => {
    for (const trading of Object.values(piyasalar)) {
      expect(preQuoteLock({ side: 'sell', trading, reference: REF })).toBeNull()
    }
  })
  it('Sat: ref yoksa REFERENCE_MISSING (piyasa ne olursa olsun)', () => {
    for (const trading of Object.values(piyasalar)) {
      expect(preQuoteLock({ side: 'sell', trading, reference: null }).code).toBe('REFERENCE_MISSING')
    }
  })
  it('Sat + kapali piyasa kilit nedeni DEGIL', () => {
    expect(preQuoteLock({ side: 'sell', trading: piyasalar.kapali, reference: REF })).toBeNull()
  })
  it.each([null, undefined, 0, -1, NaN, Infinity, '776'])('gecersiz referans %s -> REFERENCE_MISSING (Al VE Sat)', (reference) => {
    expect(preQuoteLock({ side: 'buy', trading: acik(), reference }).code).toBe('REFERENCE_MISSING')
    expect(preQuoteLock({ side: 'sell', trading: acik(), reference }).code).toBe('REFERENCE_MISSING')
  })
  it.each(['swap', undefined, null, 'BUY', ''])('side %s -> INVALID_REQUEST firlatir', (side) => {
    let err
    try {
      preQuoteLock({ side, trading: acik(), reference: 1 })
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
    expect(err.code).toBe('INVALID_REQUEST')
  })
  it('nextChangeAt bozuksa null', () => {
    const t = { ...kapali(), nextChangeAt: 'bozuk' }
    expect(preQuoteLock({ side: 'buy', trading: t, reference: 1 })).toEqual({ code: 'MARKET_CLOSED', nextChangeAt: null })
    expect(marketNotice(t).nextChangeAt).toBeNull()
  })
})

describe('marketNotice', () => {
  it('uc durum', () => {
    expect(marketNotice(acik())).toEqual({ state: 'open', nextChangeAt: null })
    expect(marketNotice(kapali())).toEqual({ state: 'closed', nextChangeAt: '2026-10-12T00:00:00.000Z' })
    expect(marketNotice(belirsiz()).state).toBe('unknown')
    expect(marketNotice(null).state).toBe('unknown')
  })
})

describe('kaynak taramasi', () => {
  const kod = yorumsuz(fs.readFileSync(KAYNAK, 'utf8'))
  it('bayraktan bagimsiz (K1)', () => {
    expect(kod).not.toContain('featureFlags')
    expect(kod).not.toContain('XSTOCKS_ENABLED')
  })
  it('betikten import etmez (K2 kopya)', () => {
    expect(kod).not.toContain('verify-xstocks-core')
  })
})

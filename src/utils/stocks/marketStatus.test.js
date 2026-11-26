import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchMarketStatus, MARKET_STATUS_TIMEOUT_MS } from './marketStatus'
import { companyRows } from './stockCompanies'
import { setLcxStockRows, lcxStockRows, _resetLcxStockRows } from '../tokenizedStocks'

const rows = companyRows('TSLA', { xstocksEnabled: true })
const b = rows.find((r) => r.issuer === 'bstocks')
const x = rows.find((r) => r.issuer === 'xstocks')

const resp = (body, status = 200) => ({ status, json: async () => body })
const openBody = { symbol: x.symbol, trading: { openNow: true, currentPeriod: 'regular', limitsPerPeriod: { regular: { maxOrderFiatValue: 1000 } } } }
const closedBody = { symbol: x.symbol, trading: { openNow: false, currentPeriod: 'closed', nextChangeAt: '2026-10-22T13:30:00Z' } }

describe('fetchMarketStatus (TK9)', () => {
  it('bStocks: kaynak yok, ag istegi YOK', async () => {
    const f = vi.fn()
    expect(await fetchMarketStatus(b, { fetchImpl: f })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
  it('entry yok -> null', async () => {
    expect(await fetchMarketStatus(null, { fetchImpl: vi.fn() })).toBeNull()
  })
  it('acik', async () => {
    const f = vi.fn(async () => resp(openBody))
    expect(await fetchMarketStatus(x, { fetchImpl: f })).toEqual({ state: 'open', nextChangeAt: null })
    expect(f.mock.calls[0][0]).toContain(`/assets/${x.symbol}`)
    expect(f.mock.calls[0][1].method).toBe('GET')
  })
  it('kapali + sonraki degisim', async () => {
    const r = await fetchMarketStatus(x, { fetchImpl: async () => resp(closedBody) })
    expect(r.state).toBe('closed')
    expect(r.nextChangeAt).toBe('2026-10-22T13:30:00Z')
  })
  it('hata, 500, bozuk govde, sembol uyumsuz, belirsiz -> null', async () => {
    expect(await fetchMarketStatus(x, { fetchImpl: async () => { throw new Error('ag') } })).toBeNull()
    expect(await fetchMarketStatus(x, { fetchImpl: async () => resp({}, 500) })).toBeNull()
    expect(await fetchMarketStatus(x, { fetchImpl: async () => resp({ yok: 1 }) })).toBeNull()
    expect(await fetchMarketStatus(x, { fetchImpl: async () => resp({ ...openBody, symbol: 'BASKA' }) })).toBeNull()
    expect(await fetchMarketStatus(x, { fetchImpl: async () => resp({ symbol: x.symbol, trading: { openNow: true } }) })).toBeNull()
  })
  it('6 sn zaman asimi -> null', async () => {
    vi.useFakeTimers()
    try {
      expect(MARKET_STATUS_TIMEOUT_MS).toBe(6000)
      const p = fetchMarketStatus(x, { fetchImpl: () => new Promise(() => {}) })
      await vi.advanceTimersByTimeAsync(6001)
      expect(await p).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

// Bolum 2 Gorev 11: LCX satirinin piyasa durumu satirin KENDISINDEN (sunucunun usEquitiesOpen degeri -> row.marketOpen); ag istegi YOK.
// Yalniz gosterim bilgisidir (rozet): islem karari DEGIL.
describe('fetchMarketStatus: LCX satiri (Gorev 11)', () => {
  const raw = (over) => ({
    category: 'stocks', priceSource: 'Chainlink', priceUpdatedAt: 1795071867, marketHours: 'us_equities', depthUsd: 1000, decimals: 8, priceUsd: 388.6,
    chainId: 8453, address: '0xb2000000000000000000001e800a7f5189430cD0', symbol: 'TSLAC', name: 'Tesla (Coinbase)', issuer: 'coinbase', underlying: 'TSLA', ...over,
  })
  const lcx = (over, usEquitiesOpen) => {
    setLcxStockRows([raw(over)], { usEquitiesOpen })
    return lcxStockRows()[0]
  }
  afterEach(() => _resetLcxStockRows())

  it('us_equities + acik -> open; kapali -> closed; nextChangeAt null; fetch CAGRILMAZ', async () => {
    const f = vi.fn()
    expect(await fetchMarketStatus(lcx({}, true), { fetchImpl: f })).toEqual({ state: 'open', nextChangeAt: null })
    expect(await fetchMarketStatus(lcx({}, false), { fetchImpl: f })).toEqual({ state: 'closed', nextChangeAt: null })
    expect(f).not.toHaveBeenCalled()
  })

  it('always (7/24) -> marketOpen null -> null (rozet yok)', async () => {
    const row = lcx({ marketHours: 'always' }, false)
    expect(row.marketOpen).toBeNull()
    expect(await fetchMarketStatus(row, { fetchImpl: vi.fn() })).toBeNull()
  })

  it('marketOpen yalniz tam true / false okunur; baska deger null', async () => {
    for (const marketOpen of [undefined, null, 'true', 1, 0, NaN]) {
      expect(await fetchMarketStatus({ issuer: 'ondo', symbol: 'X', source: 'lcx', marketOpen }, { fetchImpl: vi.fn() }), String(marketOpen)).toBeNull()
    }
  })

  it('fetchImpl yoksa bile LCX durumu satirdan okunur (ag kullanmaz)', async () => {
    expect(await fetchMarketStatus(lcx({}, true), { fetchImpl: undefined })).toEqual({ state: 'open', nextChangeAt: null })
  })
})

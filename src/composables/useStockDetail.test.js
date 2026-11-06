import { describe, it, expect, vi } from 'vitest'
import { useStockDetail } from './useStockDetail'
import { companyRows } from '../utils/stocks/stockCompanies'
import { stockKey } from '../utils/tokenizedStocks'

const rows = companyRows('TSLA', { xstocksEnabled: true })
const b = rows.find((r) => r.issuer === 'bstocks')
const x = rows.find((r) => r.issuer === 'xstocks' && r.chainId === 56)
const ONE = 10n ** 18n

const records = [
  { coingecko_id: b.coingeckoId, market_data: { priceUSD: 100, change: { h24: 2 } } },
  { coingecko_id: x.coingeckoId, market_data: { priceUSD: 200, change: { h24: 2 } } },
]
const read = async () => new Map([
  [b.address.toLowerCase(), { balance: 2n * ONE, multiplier: null }],
  [x.address.toLowerCase(), { balance: ONE, multiplier: 2n * ONE }],
])

function make(over = {}) {
  return useStockDetail({
    entry: b, owner: '0xabc', rpcFor: () => 'http://rpc', xstocksEnabled: true,
    fetchRecords: vi.fn(async () => records), readBalances: read, fetchMarket: vi.fn(async () => null),
    ...over,
  })
}

describe('useStockDetail', () => {
  it('yukler: baslik, fiyat, pozisyon toplami, bilgi bloklari', async () => {
    const d = make()
    expect(d.recordsLoading.value).toBe(true)
    await d.load()
    expect(d.recordsLoading.value).toBe(false)
    expect(d.header.value.ticker).toBe('TSLA')
    expect(d.price.value.priceUsd).toBe(100)
    expect(d.price.value.change24h).toBe(2)
    expect(d.position.value.units).toBe(3)
    expect(d.position.value.usd).toBe(300)
    expect(d.info.value).toHaveLength(2)
  })
  it('kayitlar tek istekte, tekrarsiz kimliklerle', async () => {
    const fetchRecords = vi.fn(async () => records)
    await make({ fetchRecords }).load()
    expect(fetchRecords).toHaveBeenCalledTimes(1)
    expect(fetchRecords.mock.calls[0][0].sort()).toEqual([b.coingeckoId, x.coingeckoId].sort())
  })
  it('kayit istegi duserse fiyat null, bakiye yine gelir', async () => {
    const d = make({ fetchRecords: async () => { throw new Error('500') } })
    await d.load()
    expect(d.price.value.priceUsd).toBeNull()
    expect(d.position.value.units).toBe(3)
    expect(d.position.value.usd).toBeNull()
  })
  it('bakiye okumasi duserse pozisyon bilinmiyor (0 degil)', async () => {
    const d = make({ readBalances: async () => { throw new Error('rpc') } })
    await d.load()
    expect(d.position.value.unknown).toBe(true)
    expect(d.position.value.held).toBe(false)
  })
  it('owner yok: bakiye okunmaz', async () => {
    const readBalances = vi.fn(read)
    const d = make({ owner: null, readBalances })
    await d.load()
    expect(readBalances).not.toHaveBeenCalled()
    expect(d.balancesLoading.value).toBe(false)
  })
  it('piyasa durumu yalniz kaynak verince; hata -> null', async () => {
    const d1 = make({ entry: x, fetchMarket: async () => ({ state: 'open', nextChangeAt: null }) })
    await d1.load()
    expect(d1.market.value).toEqual({ state: 'open', nextChangeAt: null })
    const d2 = make({ entry: x, fetchMarket: async () => { throw new Error('x') } })
    await d2.load()
    expect(d2.market.value).toBeNull()
  })
  it('xStock acilisi: carpan bakiye okumasindan gelir, bolen sayi', async () => {
    const d = make({ entry: x })
    await d.load()
    expect(d.price.value.priceUsd).toBe(100)
    expect(d.price.value.chartDivisor).toBe(2)
    expect(d.balances.value[stockKey(x.chainId, x.address)].multiplier).toBe(2n * ONE)
  })
  it('xStock carpani yoksa bolen null (undefined degil)', async () => {
    const d = make({ entry: x, readBalances: async () => new Map([[x.address.toLowerCase(), { balance: ONE, multiplier: null }]]) })
    await d.load()
    expect(d.price.value.chartDivisor).toBeNull()
    expect(d.price.value.priceUsd).toBeNull()
  })
  it('aralik: varsayilan 30 gun, degisince gun degisir', () => {
    const d = make()
    expect(d.days.value).toBe(30)
    d.range.value = '1y'
    expect(d.days.value).toBe(365)
  })
})

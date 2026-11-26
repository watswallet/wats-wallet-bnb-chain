import { describe, it, expect, afterEach } from 'vitest'
import {
  RANGES, DEFAULT_RANGE, rangeDays, sameChainOptions, headerModel, chartDivisor, rowPriceUsd,
  priceModel, positionModel, infoBlocks, canSell, isLcxRow, hasChart, updatedAtMs,
} from './stockDetailModel'
import { companyRows } from './stockCompanies'
import { stockKey, setLcxStockRows, lcxStockRows, _resetLcxStockRows } from '../tokenizedStocks'

const rows = companyRows('TSLA', { xstocksEnabled: true })
const b56 = rows.find((r) => r.issuer === 'bstocks')
const x56 = rows.find((r) => r.issuer === 'xstocks' && r.chainId === 56)
const x1 = rows.find((r) => r.issuer === 'xstocks' && r.chainId === 1)
const ONE = 10n ** 18n
const ok = (balance, multiplier = null) => ({ status: 'ok', balance, multiplier })

describe('rangeDays (TK8)', () => {
  it('1H/1A/3A/1Y -> 7/30/90/365', () => {
    expect(RANGES.map((r) => r.days)).toEqual([7, 30, 90, 365])
    expect(rangeDays('1w')).toBe(7)
    expect(rangeDays('1y')).toBe(365)
  })
  it('varsayilan ve bilinmeyen anahtar 30 gun', () => {
    expect(rangeDays(DEFAULT_RANGE)).toBe(30)
    expect(rangeDays('xyz')).toBe(30)
    expect(rangeDays(undefined)).toBe(30)
  })
})

describe('sameChainOptions / headerModel', () => {
  it('yalniz ayni zincir, bStocks once', () => {
    const opts = sameChainOptions(b56, { xstocksEnabled: true })
    expect(opts.map((r) => r.issuer)).toEqual(['bstocks', 'xstocks'])
    expect(opts.every((r) => r.chainId === 56)).toBe(true)
  })
  it('bayrak kapaliyken xStock secenegi yok', () => {
    expect(sameChainOptions(b56, { xstocksEnabled: false }).map((r) => r.issuer)).toEqual(['bstocks'])
  })
  it('baslik: ad bStocks adi (TK4), ticker underlying', () => {
    const h = headerModel(x56, sameChainOptions(x56, { xstocksEnabled: true }))
    expect(h.name).toBe(b56.name)
    expect(h.ticker).toBe('TSLA')
  })
  it('tek ihracci (Ethereum xStock): kendi adi', () => {
    const h = headerModel(x1, sameChainOptions(x1, { xstocksEnabled: true }))
    expect(h.name).toBe(x1.name)
  })
  it('entry yok -> null / bos', () => {
    expect(headerModel(null)).toBeNull()
    expect(sameChainOptions(null)).toEqual([])
  })
  // Bolum 2 Gorev 10: ayni zincirdeki LCX kardesleri `lcxEnabled` ile gelir (siralama: bStocks, xStocks, LCX alfabetik); kapaliyken HIC.
  it('lcxEnabled: ayni zincirdeki LCX satiri kardes olarak gelir, baska zincirinki gelmez; kapaliyken yok', () => {
    const raw = (over) => ({
      category: 'stocks', priceSource: 'Chainlink', priceUpdatedAt: 1795071867, marketHours: 'us_equities', depthUsd: 1000, decimals: 18, priceUsd: 100, ...over,
    })
    setLcxStockRows([
      raw({ chainId: 56, address: `0x${'7'.padEnd(38, '0')}31`, symbol: 'TSLAON', issuer: 'Ondo', underlying: 'TSLA' }),
      raw({ chainId: 8453, address: `0x${'7'.padEnd(38, '0')}32`, symbol: 'TSLAC', issuer: 'Coinbase', underlying: 'TSLA' }),
    ], { usEquitiesOpen: true })
    try {
      expect(sameChainOptions(b56, { xstocksEnabled: true, lcxEnabled: true }).map((r) => r.issuer)).toEqual(['bstocks', 'xstocks', 'ondo'])
      expect(sameChainOptions(b56, { xstocksEnabled: true, lcxEnabled: false }).map((r) => r.issuer)).toEqual(['bstocks', 'xstocks'])
      expect(sameChainOptions(b56, { xstocksEnabled: true }).map((r) => r.issuer)).toEqual(['bstocks', 'xstocks']) // bayrak varsayilani (kapali)
      const ondo = sameChainOptions(b56, { xstocksEnabled: true, lcxEnabled: true })[2]
      expect(sameChainOptions(ondo, { xstocksEnabled: true, lcxEnabled: true }).map((r) => r.issuer)).toEqual(['bstocks', 'xstocks', 'ondo'])
    } finally {
      _resetLcxStockRows()
    }
  })
})

describe('chartDivisor (T4 notu: bilinmeyen null, undefined degil)', () => {
  it('bStock -> undefined (bolme yok)', () => {
    expect(chartDivisor(b56, null)).toBeUndefined()
  })
  it('xStock carpan bilinmiyor -> null', () => {
    expect(chartDivisor(x56, null)).toBeNull()
    expect(chartDivisor(x56, undefined)).toBeNull()
    expect(chartDivisor(x56, 0n)).toBeNull()
    expect(chartDivisor(x56, 'abc')).toBeNull()
  })
  it('xStock carpan -> 1e18 olcekli bolen', () => {
    expect(chartDivisor(x56, ONE)).toBe(1)
    expect(chartDivisor(x56, (ONE * 3n) / 2n)).toBe(1.5)
  })
})

describe('priceModel', () => {
  const NOW = Date.parse('2026-10-22T12:00:00Z')
  const rec = { market_data: { priceUSD: 300, change: { h24: -1.5 } }, price_source: 'atlas', price_updated_at: new Date(NOW - 60000).toISOString() }
  it('bStock: fiyat aynen, degisim ve kaynak', () => {
    expect(priceModel({ entry: b56, record: rec, multiplier: null, nowMs: NOW })).toEqual({
      priceUsd: 300, change24h: -1.5, priceSource: 'atlas', chartDivisor: undefined,
    })
  })
  it('xStock: carpana bolunur', () => {
    const m = priceModel({ entry: x56, record: rec, multiplier: ONE * 2n })
    expect(m.priceUsd).toBe(150)
    expect(m.chartDivisor).toBe(2)
  })
  it('xStock carpan yok: fiyat null (tire), bolen null; ham fiyat sizmaz', () => {
    const m = priceModel({ entry: x56, record: rec, multiplier: null })
    expect(m.priceUsd).toBeNull()
    expect(m.chartDivisor).toBeNull()
  })
  it('kayit yok: fiyat ve degisim null, 0 degil', () => {
    const m = priceModel({ entry: b56, record: undefined, multiplier: null })
    expect(m.priceUsd).toBeNull()
    expect(m.change24h).toBeNull()
    expect(m.priceSource).toBeNull()
  })
  // Nihai inceleme B2: etiket utils/priceSource.isAtlasPriced ile AYNI tazelik kuralini okur.
  it('B2: 6 saatlik atlas kaydi -> etiket yok (Hisseler sekmesiyle ayni)', () => {
    const stale = { ...rec, price_updated_at: new Date(NOW - 6 * 3600000).toISOString() }
    expect(priceModel({ entry: b56, record: stale, multiplier: null, nowMs: NOW }).priceSource).toBeNull()
  })
  it('B2: price_updated_at yok -> etiket yok', () => {
    const { price_updated_at, ...noTime } = rec
    expect(priceModel({ entry: b56, record: noTime, multiplier: null, nowMs: NOW }).priceSource).toBeNull()
  })
  it('B2: coingecko kaynagi etiket uretmez (S5: ek gorunurluk yok)', () => {
    const cg = { ...rec, price_source: 'coingecko' }
    expect(priceModel({ entry: b56, record: cg, multiplier: null, nowMs: NOW }).priceSource).toBeNull()
  })
  it('priceUSD 0 -> null', () => {
    expect(rowPriceUsd(b56, { market_data: { priceUSD: 0 } }, null)).toBeNull()
  })
})

describe('positionModel (TK7)', () => {
  const options = sameChainOptions(b56, { xstocksEnabled: true })
  const records = {
    [b56.coingeckoId]: { market_data: { priceUSD: 100 } },
    [x56.coingeckoId]: { market_data: { priceUSD: 200 } },
  }
  const key = (r) => stockKey(r.chainId, r.address)

  it('iki ihracci toplanir (adet ve USD)', () => {
    const balances = {
      [key(b56)]: ok(2n * ONE),
      [key(x56)]: ok(1n * ONE, 2n * ONE), // 200 / 2 = 100 birim fiyat
    }
    const p = positionModel({ options, balances, records })
    expect(p.held).toBe(true)
    expect(p.unknown).toBe(false)
    expect(p.units).toBe(3)
    expect(p.usd).toBe(300)
    expect(canSell(p)).toBe(true)
  })
  it('pozisyon yok: held false, usd null, Sat kapali', () => {
    const balances = { [key(b56)]: ok(0n), [key(x56)]: ok(0n) }
    const p = positionModel({ options, balances, records })
    expect(p).toMatchObject({ held: false, unknown: false, units: 0, usd: null })
    expect(canSell(p)).toBe(false)
  })
  it('tutulan secenegin fiyati bilinmiyorsa usd null ama adet gorunur', () => {
    const balances = { [key(b56)]: ok(ONE), [key(x56)]: ok(ONE, null) }
    const p = positionModel({ options, balances, records })
    expect(p.units).toBe(2)
    expect(p.usd).toBeNull()
  })
  it('okunamayan bakiye: unknown true, sahip sayilmaz', () => {
    const balances = { [key(b56)]: { status: 'error', balance: null, multiplier: null } }
    const p = positionModel({ options, balances, records })
    expect(p.unknown).toBe(true)
    expect(p.held).toBe(false)
    expect(canSell(p)).toBe(false)
  })
  it('multiplierOf yedegi kullanilir', () => {
    const balances = { [key(x56)]: ok(ONE) }
    const p = positionModel({ options: [x56], balances, records, multiplierOf: () => ONE * 4n })
    expect(p.usd).toBe(50)
  })
})

describe('infoBlocks (TK7)', () => {
  const options = sameChainOptions(b56, { xstocksEnabled: true })
  const key = (r) => stockKey(r.chainId, r.address)
  it('iki ihracci tutuluyorsa iki blok', () => {
    const blocks = infoBlocks({ entry: b56, options, balances: { [key(b56)]: ok(ONE), [key(x56)]: ok(ONE) } })
    expect(blocks.map((b) => b.issuer)).toEqual(['bstocks', 'xstocks'])
    expect(blocks[0].issuerKey).toBe('token.bStockIssuer')
    expect(blocks[1].issuerKey).toBe('token.xStockIssuer')
  })
  it('hic tutulmuyorsa acilan token icin tek blok', () => {
    const blocks = infoBlocks({ entry: x56, options, balances: {} })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ issuer: 'xstocks', address: x56.address, chainId: 56, decimals: 18 })
  })
  it('ISIN yalniz bStock', () => {
    const blocks = infoBlocks({ entry: b56, options, balances: { [key(b56)]: ok(ONE), [key(x56)]: ok(ONE) } })
    expect(blocks[0].isin).toBe(b56.isin)
    expect(blocks[1].isin).toBeNull()
  })
  it('entry yok -> bos', () => {
    expect(infoBlocks({ entry: null, options: [], balances: {} })).toEqual([])
  })
})

// Bolum 2 Gorev 11: LCX satiri (`source: 'lcx'`): grafik yok (coingeckoId null), fiyat satirin kendi priceUsd'si, kaynak 'lcx',
// guncelleme zamani satirdan, bilgi blogu LCX isareti tasir. Dallanma BURADA (modelde); Vue dosyasi `.issuer === '...'` yazmaz.
describe('LCX satiri (Gorev 11)', () => {
  const raw = (over) => ({
    category: 'stocks', priceSource: 'Chainlink', priceUpdatedAt: 1795071867, marketHours: 'us_equities', depthUsd: 1000, decimals: 8, priceUsd: 388.61280861,
    chainId: 8453, address: '0xb2000000000000000000001e800a7f5189430cD0', symbol: 'TSLAC', name: 'Tesla (Coinbase Tokenized Stocks)', issuer: 'coinbase', underlying: 'TSLA', ...over,
  })
  const lcx = (over) => {
    setLcxStockRows([raw(over)], { usEquitiesOpen: true })
    return lcxStockRows()[0]
  }
  afterEach(() => _resetLcxStockRows())

  it('isLcxRow: yalniz kaynagi lcx olan satir; statik satir, null ve bos nesne degil', () => {
    expect(isLcxRow(lcx())).toBe(true)
    expect(isLcxRow(b56)).toBe(false)
    expect(isLcxRow(x56)).toBe(false)
    expect(isLcxRow(null)).toBe(false)
    expect(isLcxRow(undefined)).toBe(false)
    expect(isLcxRow({})).toBe(false)
    expect(isLcxRow({ source: 'LCX' })).toBe(false)
  })

  it('hasChart: coingeckoId varsa true (bStocks / xStocks); LCX satiri, null ve bos id false', () => {
    expect(hasChart(b56)).toBe(true)
    expect(hasChart(x56)).toBe(true)
    expect(hasChart(lcx())).toBe(false)
    expect(hasChart(null)).toBe(false)
    expect(hasChart({ coingeckoId: '' })).toBe(false)
    expect(hasChart({ coingeckoId: null })).toBe(false)
  })

  it('priceModel: fiyat satirdan, kaynak lcx, guncelleme zamani satirdan; degisim ve grafik bolen yok', () => {
    const row = lcx()
    expect(priceModel({ entry: row, record: undefined, multiplier: null })).toEqual({
      priceUsd: 388.61280861, change24h: null, priceSource: 'lcx', chartDivisor: undefined, updatedAt: 1795071867,
    })
  })

  it('priceModel: sunucu kaydi ya da carpan LCX fiyatini DEGISTIRMEZ (CoinGecko kimligi yok)', () => {
    const row = lcx()
    const rec = { market_data: { priceUSD: 1, change: { h24: 9 } }, price_source: 'atlas', price_updated_at: new Date().toISOString() }
    const m = priceModel({ entry: row, record: rec, multiplier: ONE * 2n })
    expect(m.priceUsd).toBe(388.61280861)
    expect(m.change24h).toBeNull()
    expect(m.priceSource).toBe('lcx')
  })

  it('priceModel: priceUpdatedAt yoksa updatedAt null; fiyat yine satirdan', () => {
    const m = priceModel({ entry: lcx({ priceUpdatedAt: null }), record: undefined, multiplier: null })
    expect(m.updatedAt).toBeNull()
    expect(m.priceUsd).toBe(388.61280861)
  })

  it('statik satirin priceModel ciktisi degismez (updatedAt anahtari yok)', () => {
    const m = priceModel({ entry: b56, record: { market_data: { priceUSD: 10, change: { h24: 1 } } }, multiplier: null })
    expect(Object.keys(m).sort()).toEqual(['change24h', 'chartDivisor', 'priceSource', 'priceUsd'])
  })

  it('rowPriceUsd: LCX satirinin birim fiyati satirin priceUsd si; kayit yok sayilir', () => {
    expect(rowPriceUsd(lcx(), undefined, null)).toBe(388.61280861)
    expect(rowPriceUsd(lcx(), { market_data: { priceUSD: 5 } }, null)).toBe(388.61280861)
  })

  it('positionModel: tutulan LCX satirinin USD degeri satir fiyatindan (tire degil)', () => {
    const row = lcx()
    const p = positionModel({ options: [row], balances: { [stockKey(row.chainId, row.address)]: ok(2n * 10n ** 8n) }, records: {} })
    expect(p.held).toBe(true)
    expect(p.units).toBe(2)
    expect(p.usd).toBeCloseTo(777.22561722, 6)
  })

  it('infoBlocks: LCX blogu lcx true, issuerKey null (bStocks / xStocks metni degil), ISIN yok; statik blok lcx false', () => {
    const row = lcx()
    const [block] = infoBlocks({ entry: row, options: [row], balances: {} })
    expect(block).toMatchObject({ issuer: 'coinbase', issuerKey: null, lcx: true, isin: null, chainId: 8453, address: row.address, decimals: 8, symbol: 'TSLAC' })
    const [stat] = infoBlocks({ entry: b56, options: [b56], balances: {} })
    expect(stat.lcx).toBe(false)
    expect(stat.issuerKey).toBe('token.bStockIssuer')
  })

  it('updatedAtMs: saniye -> ms, zaten ms ise aynen; sonlu olmayan / sifir / negatif -> null', () => {
    expect(updatedAtMs(1795071867)).toBe(1795071867000)
    expect(updatedAtMs(1795071867000)).toBe(1795071867000)
    for (const bad of [null, undefined, NaN, Infinity, 0, -5, '1795071867']) expect(updatedAtMs(bad), String(bad)).toBeNull()
  })

  it('updatedAtMs: Date araligini (8.64e15 ms) asan sonlu deger (1e18 ms sayilir) Gecersiz Tarih uretmez -> null; aralik ucu gecerli', () => {
    for (const huge of [1e18, 1e16, 8.64e15 + 1, Number.MAX_VALUE]) {
      expect(updatedAtMs(huge), String(huge)).toBeNull()
    }
    expect(updatedAtMs(8.64e15)).toBe(8.64e15)
    expect(Number.isFinite(new Date(updatedAtMs(8.64e15)).getTime())).toBe(true)
  })
})

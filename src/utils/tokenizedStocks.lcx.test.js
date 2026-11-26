// tokenizedStocks.js -- DINAMIK LCX KATMANI (Bolum 2, Gorev 4). Satirlar sunucunun GET /lcx/stocks ciktisidir
// (server/utils/lcxStockFilter.js applyStockFilter satir bicimi). Statik katalog (bStocks + xStocks) HER ZAMAN kazanir:
// ayni adres dinamik katmanda satir olamaz. Bayrak ve gizli moda bu katman BAKMAZ; cagiran bakar.
import { describe, it, expect, beforeEach } from 'vitest'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'
import { XSTOCKS } from '../data/xStocks'
import { RETIRED_XSTOCKS } from '../data/xStocksRetired'
import { RETIRED_BSTOCKS } from '../data/bStocksRetired'
import {
  normalizeLcxIssuer, toLcxStockRow, setLcxStockRows, lcxStockRows, isLcxStock, _resetLcxStockRows,
  stockEntry, stockIssuer, stockKey, hasUiMultiplier, isBridgeBlocked, isBridgeTargetBlocked, isGeneralSwapExcluded,
  isGeneralSwapOutputExcluded, stockImportIdentity, stocksByChain, bridgeStockChainIds,
} from './tokenizedStocks'

// Sunucunun /lcx/stocks satir bicimi (server/test/fixtures/lcx/rwa-assets.json -> applyStockFilter, 2026-11-19).
const TSLAC = Object.freeze({
  chainId: 8453,
  address: '0xb2000000000000000000001e800a7f5189430cD0',
  symbol: 'TSLAC',
  name: 'Tesla (Coinbase Tokenized Stocks)',
  decimals: 8,
  issuer: 'coinbase',
  underlying: 'TSLA',
  category: 'stocks',
  priceUsd: 388.61280861,
  priceSource: 'Chainlink Coinbase TSLA on Base',
  priceUpdatedAt: 1795071867,
  marketHours: 'us_equities',
  depthUsd: 252144.395038,
})
const GMEON = Object.freeze({
  chainId: 56,
  address: '0xdABb9afF4cf02f26D2014e4cA9f94aC6fe6572a3',
  symbol: 'GMEON',
  name: 'GameStop (Ondo Tokenized Stock)',
  decimals: 18,
  issuer: 'ondo',
  underlying: 'GME',
  category: 'stocks',
  priceUsd: 27.02536498754133,
  priceSource: 'Chainlink GME / USD on BNB Chain',
  priceUpdatedAt: 1795032524,
  marketHours: 'us_equities',
  depthUsd: 42234.209440152175,
})
const ROWS = [TSLAC, GMEON]
const OPEN = { usEquitiesOpen: true }
const CLOSED = { usEquitiesOpen: false }

const BSTOCK = BSTOCKS[0]
const XSTOCK = XSTOCKS[0]

beforeEach(() => _resetLcxStockRows())

describe('normalizeLcxIssuer (sunucudaki normalizeIssuer ile birebir)', () => {
  it('sunucunun test girdileriyle ayni cikti', () => {
    expect(normalizeLcxIssuer('Ondo')).toBe('ondo')
    expect(normalizeLcxIssuer('Coinbase')).toBe('coinbase')
    expect(normalizeLcxIssuer('Robinhood')).toBe('robinhood')
    expect(normalizeLcxIssuer('st0x')).toBe('st0x')
    expect(normalizeLcxIssuer('bStocks')).toBe('bstocks')
    expect(normalizeLcxIssuer('Backed (xStocks)')).toBe('backed-xstocks')
    expect(normalizeLcxIssuer('  --Foo   Bar__ ')).toBe('foo-bar')
  })

  it('gecerli bicim ^[a-z0-9-]{2,32}$ degilse ya da dize degilse null', () => {
    expect(normalizeLcxIssuer('')).toBeNull()
    expect(normalizeLcxIssuer('---')).toBeNull()
    expect(normalizeLcxIssuer('a')).toBeNull()
    expect(normalizeLcxIssuer('ab')).toBe('ab')
    expect(normalizeLcxIssuer('a'.repeat(32))).toBe('a'.repeat(32))
    expect(normalizeLcxIssuer('a'.repeat(33))).toBeNull()
    expect(normalizeLcxIssuer(null)).toBeNull()
    expect(normalizeLcxIssuer(undefined)).toBeNull()
    expect(normalizeLcxIssuer(7)).toBeNull()
    expect(normalizeLcxIssuer({})).toBeNull()
  })
})

describe('toLcxStockRow', () => {
  it('katalog satiriyla ayni alan adlari; dondurulmus; source lcx; us_equities -> usEquitiesOpen', () => {
    const row = toLcxStockRow(TSLAC, OPEN)
    expect(row).toEqual({
      issuer: 'coinbase',
      chainId: 8453,
      symbol: 'TSLAC',
      name: 'Tesla (Coinbase Tokenized Stocks)',
      address: '0xb2000000000000000000001e800a7f5189430cD0',
      decimals: 8,
      coingeckoId: null,
      image: null,
      isin: null,
      scaled: false,
      underlying: 'TSLA',
      source: 'lcx',
      priceUsd: 388.61280861,
      priceUpdatedAt: 1795071867,
      marketHours: 'us_equities',
      marketOpen: true,
    })
    expect(Object.isFrozen(row)).toBe(true)
    expect(toLcxStockRow(TSLAC, CLOSED).marketOpen).toBe(false)
  })

  it("marketHours 'always' -> marketOpen null (usEquitiesOpen'a bakilmaz)", () => {
    expect(toLcxStockRow({ ...TSLAC, marketHours: 'always' }, OPEN).marketOpen).toBeNull()
    expect(toLcxStockRow({ ...TSLAC, marketHours: 'always' }, CLOSED).marketOpen).toBeNull()
    expect(toLcxStockRow({ ...TSLAC, marketHours: 'always' }, OPEN).marketHours).toBe('always')
  })

  it('usEquitiesOpen yalniz tam true acik sayilir (bozuk/eksik -> kapali)', () => {
    expect(toLcxStockRow(TSLAC, {}).marketOpen).toBe(false)
    expect(toLcxStockRow(TSLAC, undefined).marketOpen).toBe(false)
    expect(toLcxStockRow(TSLAC, { usEquitiesOpen: 'yes' }).marketOpen).toBe(false)
  })

  // ROZET BAYATLIGI: asOf (sunucunun listeyi LCX'ten yukledigi an, ms) verilirse 30 dk'dan eskiyse / yoksa / gecersizse marketOpen null.
  // asOf ANAHTARI hic verilmezse (dogrudan setLcxStockRows ceken eski cagri bicimi) denetim yok; uretim yolu (stockRows.js) hep verir.
  describe('asOf ile bayatlik', () => {
    const NOW = 1_795_100_000_000
    const MIN = 60_000
    const at = (asOf, extra = {}) => toLcxStockRow(TSLAC, { usEquitiesOpen: true, asOf, now: NOW, ...extra })

    it('taze asOf: usEquitiesOpen degeri (true ve false)', () => {
      expect(at(NOW - 5 * MIN).marketOpen).toBe(true)
      expect(at(NOW - 5 * MIN, { usEquitiesOpen: false }).marketOpen).toBe(false)
    })

    it('sinir: 30 dk gecerli, 30 dk + 1 ms bayat; 31 dk bayat', () => {
      expect(at(NOW - 30 * MIN).marketOpen).toBe(true)
      expect(at(NOW - 30 * MIN - 1).marketOpen).toBeNull()
      expect(at(NOW - 31 * MIN).marketOpen).toBeNull()
    })

    it('asOf anahtari var ama null / undefined / sayi degil / sifir / negatif / sonsuz: null', () => {
      for (const asOf of [null, undefined, 'dun', 0, -1, NaN, Infinity]) {
        expect(at(asOf).marketOpen, String(asOf)).toBeNull()
      }
    })

    it('gelecekteki asOf: kucuk saat farki (5 dk) gecerli, ondan fazlasi (saat geri alinmis) null', () => {
      expect(at(NOW + 2 * MIN).marketOpen).toBe(true)
      expect(at(NOW + 5 * MIN).marketOpen).toBe(true)
      expect(at(NOW + 5 * MIN + 1).marketOpen).toBeNull()
      expect(at(NOW + 24 * 60 * MIN).marketOpen).toBeNull()
    })

    it("now verilmezse Date.now(); 'always' satiri asOf'a bakmadan null", () => {
      expect(toLcxStockRow(TSLAC, { usEquitiesOpen: true, asOf: Date.now() - MIN }).marketOpen).toBe(true)
      expect(toLcxStockRow(TSLAC, { usEquitiesOpen: true, asOf: Date.now() - 31 * MIN }).marketOpen).toBeNull()
      expect(toLcxStockRow({ ...TSLAC, marketHours: 'always' }, { usEquitiesOpen: true, asOf: NOW - MIN, now: NOW }).marketOpen).toBeNull()
    })

    it('asOf anahtari yoksa denetim yok (eski cagri bicimi degismez)', () => {
      expect(toLcxStockRow(TSLAC, { usEquitiesOpen: true, now: NOW }).marketOpen).toBe(true)
      expect(toLcxStockRow(TSLAC, OPEN).marketOpen).toBe(true)
    })

    it('setLcxStockRows opts u satira gecirir: bayat asOf -> katmandaki satirlarin marketOpen i null', () => {
      setLcxStockRows(ROWS, { usEquitiesOpen: true, asOf: NOW - 31 * MIN, now: NOW })
      expect(stockEntry(8453, TSLAC.address).marketOpen).toBeNull()
      expect(stockEntry(56, GMEON.address).marketOpen).toBeNull()
      setLcxStockRows(ROWS, { usEquitiesOpen: true, asOf: NOW - MIN, now: NOW })
      expect(stockEntry(8453, TSLAC.address).marketOpen).toBe(true)
    })
  })

  it('priceUpdatedAt sonlu sayi degilse null; ad yoksa sembol', () => {
    expect(toLcxStockRow({ ...TSLAC, priceUpdatedAt: null }, OPEN).priceUpdatedAt).toBeNull()
    expect(toLcxStockRow({ ...TSLAC, priceUpdatedAt: 'x' }, OPEN).priceUpdatedAt).toBeNull()
    expect(toLcxStockRow({ ...TSLAC, name: undefined }, OPEN).name).toBe('TSLAC')
  })

  it('ihracci sunucudaki gibi normallesir; Backed (xStocks) -> backed-xstocks gecerli', () => {
    expect(toLcxStockRow({ ...TSLAC, issuer: 'Backed (xStocks)' }, OPEN).issuer).toBe('backed-xstocks')
    expect(toLcxStockRow({ ...TSLAC, issuer: 'Coinbase' }, OPEN).issuer).toBe('coinbase')
  })

  it('bozuk satir null: dayanak, fiyat, ondalik, ihracci, adres, zincir, sembol', () => {
    const bad = (patch) => toLcxStockRow({ ...TSLAC, ...patch }, OPEN)
    expect(bad({ underlying: null })).toBeNull()
    expect(bad({ underlying: 'tsla' })).toBeNull()
    expect(bad({ underlying: 'TSLATSLATSLA' })).toBeNull() // 12 hane > 10
    expect(bad({ underlying: '' })).toBeNull()
    expect(bad({ priceUsd: 0 })).toBeNull()
    expect(bad({ priceUsd: -1 })).toBeNull()
    expect(bad({ priceUsd: null })).toBeNull()
    expect(bad({ priceUsd: NaN })).toBeNull()
    expect(bad({ priceUsd: Infinity })).toBeNull()
    expect(bad({ priceUsd: '388.6' })).toBeNull()
    expect(bad({ decimals: 7.5 })).toBeNull()
    expect(bad({ decimals: -1 })).toBeNull()
    expect(bad({ decimals: 37 })).toBeNull()
    expect(bad({ decimals: '8' })).toBeNull()
    expect(bad({ issuer: null })).toBeNull()
    expect(bad({ issuer: '--' })).toBeNull()
    expect(bad({ address: '0x123' })).toBeNull()
    expect(bad({ address: null })).toBeNull()
    expect(bad({ chainId: '8453' })).toBeNull()
    expect(bad({ chainId: 7 })).toBeNull() // LCX aglari disinda
    expect(bad({ symbol: '' })).toBeNull()
    expect(bad({ marketHours: null })).toBeNull()
    expect(bad({ marketHours: 'weekends' })).toBeNull()
    expect(toLcxStockRow(null, OPEN)).toBeNull()
    expect(toLcxStockRow('x', OPEN)).toBeNull()
    expect(toLcxStockRow([], OPEN)).toBeNull()
  })

  it('sinir degerleri kabul: ondalik 0 ve 36, dayanak 10 hane ve nokta', () => {
    expect(toLcxStockRow({ ...TSLAC, decimals: 0 }, OPEN)).not.toBeNull()
    expect(toLcxStockRow({ ...TSLAC, decimals: 36 }, OPEN)).not.toBeNull()
    expect(toLcxStockRow({ ...TSLAC, underlying: 'BRK.B' }, OPEN)).not.toBeNull()
    expect(toLcxStockRow({ ...TSLAC, underlying: 'ABCDEFGHIJ' }, OPEN)).not.toBeNull()
  })

  it("ihracci 'bstocks' / 'xstocks' olan satir null (statik ihracci kimligiyle cakisamaz)", () => {
    expect(toLcxStockRow({ ...TSLAC, issuer: 'bStocks' }, OPEN)).toBeNull()
    expect(toLcxStockRow({ ...TSLAC, issuer: 'xStocks' }, OPEN)).toBeNull()
  })

  it('girdiyi DEGISTIRMEZ', () => {
    const raw = { ...TSLAC }
    toLcxStockRow(raw, OPEN)
    expect(raw).toEqual(TSLAC)
  })
})

describe('setLcxStockRows / stockEntry (test 1)', () => {
  it('iki satir kurulur: tutulan sayi 2; stockEntry source lcx, ihracci, ondalik; adres buyuk/kucuk harf duyarsiz', () => {
    expect(setLcxStockRows(ROWS, OPEN)).toBe(2)
    const entry = stockEntry(8453, TSLAC.address)
    expect(entry).toMatchObject({ source: 'lcx', issuer: 'coinbase', decimals: 8, symbol: 'TSLAC', chainId: 8453 })
    expect(stockEntry(8453, TSLAC.address.toLowerCase())).toBe(entry)
    expect(stockEntry('8453', TSLAC.address.toUpperCase().replace('0X', '0x'))).toBe(entry)
    expect(stockEntry(56, GMEON.address)).toMatchObject({ source: 'lcx', issuer: 'ondo', decimals: 18 })
    expect(stockIssuer(8453, TSLAC.address)).toBe('coinbase')
  })

  it('zincir anahtarin parcasi: ayni adres baska zincirde hisse degil', () => {
    setLcxStockRows(ROWS, OPEN)
    expect(stockEntry(1, TSLAC.address)).toBeNull()
    expect(stockEntry(56, TSLAC.address)).toBeNull()
  })

  it('kurulmadan once ve dizi olmayan girdide dinamik katman bos; sayi 0', () => {
    expect(stockEntry(8453, TSLAC.address)).toBeNull()
    expect(lcxStockRows()).toEqual([])
    expect(setLcxStockRows(null, OPEN)).toBe(0)
    expect(setLcxStockRows('x', OPEN)).toBe(0)
    expect(setLcxStockRows({}, OPEN)).toBe(0)
  })

  it('stockEntry bozuk adreste null (mevcut sozlesme)', () => {
    setLcxStockRows(ROWS, OPEN)
    expect(stockEntry(8453, '')).toBeNull()
    expect(stockEntry(8453, null)).toBeNull()
  })

  it('lcxStockRows: dondurulmus dizi, giris sirasi; isLcxStock yalniz dinamik katman', () => {
    setLcxStockRows(ROWS, OPEN)
    const list = lcxStockRows()
    expect(list.map((r) => r.symbol)).toEqual(['TSLAC', 'GMEON'])
    expect(Object.isFrozen(list)).toBe(true)
    expect(Object.isFrozen(list[0])).toBe(true)
    expect(isLcxStock(8453, TSLAC.address)).toBe(true)
    expect(isLcxStock(8453, TSLAC.address.toLowerCase())).toBe(true)
    expect(isLcxStock(56, TSLAC.address)).toBe(false)
    expect(isLcxStock(8453, '')).toBe(false)
    expect(isLcxStock(8453, null)).toBe(false)
    // statik katalog dinamik katman degildir
    expect(isLcxStock(BSTOCKS_CHAIN_ID, BSTOCK.address)).toBe(false)
    expect(isLcxStock(1, XSTOCK.address)).toBe(false)
  })

  it('ayni anahtar iki kez gelirse ilki kalir ve bir kez sayilir', () => {
    expect(setLcxStockRows([TSLAC, { ...TSLAC, symbol: 'TSLAC2', address: TSLAC.address.toLowerCase() }], OPEN)).toBe(1)
    expect(stockEntry(8453, TSLAC.address).symbol).toBe('TSLAC')
  })

  it('girdi dizisini DEGISTIRMEZ', () => {
    const input = [{ ...TSLAC }, { ...GMEON }]
    setLcxStockRows(input, OPEN)
    expect(input).toEqual(ROWS)
  })

  it('hisse olmayan alanlar stockEntry uzerinden: olcekli degil', () => {
    setLcxStockRows(ROWS, OPEN)
    expect(hasUiMultiplier(8453, TSLAC.address)).toBe(false)
  })
})

describe('setLcxStockRows eleme (test 2)', () => {
  it('underlying null/tsla, priceUsd 0, decimals 7.5 dusen; issuer Backed (xStocks) kalir', () => {
    const rows = [
      { ...TSLAC, address: '0x1000000000000000000000000000000000000001', symbol: 'A1', underlying: null },
      { ...TSLAC, address: '0x1000000000000000000000000000000000000002', symbol: 'A2', underlying: 'tsla' },
      { ...TSLAC, address: '0x1000000000000000000000000000000000000003', symbol: 'A3', priceUsd: 0 },
      { ...TSLAC, address: '0x1000000000000000000000000000000000000004', symbol: 'A4', decimals: 7.5 },
      { ...TSLAC, address: '0x1000000000000000000000000000000000000005', symbol: 'A5', issuer: 'Backed (xStocks)' },
    ]
    expect(setLcxStockRows(rows, OPEN)).toBe(1)
    expect(lcxStockRows().map((r) => r.symbol)).toEqual(['A5'])
    expect(lcxStockRows()[0].issuer).toBe('backed-xstocks')
  })
})

describe('statik katalog kazanir (test 3)', () => {
  const retiredBstock = RETIRED_BSTOCKS[0]
  const retiredXstock = RETIRED_XSTOCKS[0]

  it('bStocks satiriyla, dislanan xStocks adresiyle (Optimism) ve emekli bStocks adresiyle ayni adres: uc de dusurulur', () => {
    const rows = [
      { ...TSLAC, chainId: BSTOCKS_CHAIN_ID, address: BSTOCK.address, symbol: BSTOCK.symbol },
      { ...TSLAC, chainId: 10, address: XSTOCK.address, symbol: 'XOPT' },
      { ...TSLAC, chainId: BSTOCKS_CHAIN_ID, address: retiredBstock.address, symbol: retiredBstock.symbol },
      GMEON,
    ]
    expect(setLcxStockRows(rows, OPEN)).toBe(1)
    expect(lcxStockRows().map((r) => r.symbol)).toEqual(['GMEON'])

    // statik satir donmeye devam eder
    expect(stockEntry(BSTOCKS_CHAIN_ID, BSTOCK.address)).toMatchObject({ issuer: 'bstocks', symbol: BSTOCK.symbol })
    expect(stockEntry(BSTOCKS_CHAIN_ID, BSTOCK.address).source).toBeUndefined()
    expect(isLcxStock(BSTOCKS_CHAIN_ID, BSTOCK.address)).toBe(false)
    expect(isLcxStock(10, XSTOCK.address)).toBe(false)
    expect(isLcxStock(BSTOCKS_CHAIN_ID, retiredBstock.address)).toBe(false)
  })

  it('emekli xStocks adresi (var olunan zincirde) ve ayni adres her xStocks zincirinde dusurulur', () => {
    const rows = [
      { ...TSLAC, chainId: 1, address: retiredXstock.address, symbol: 'RET' },
      { ...TSLAC, chainId: 1, address: XSTOCK.address, symbol: 'X1' },
      { ...TSLAC, chainId: 56, address: XSTOCK.address, symbol: 'X56' },
      { ...TSLAC, chainId: 42161, address: XSTOCK.address.toLowerCase(), symbol: 'X42161' },
    ]
    expect(setLcxStockRows(rows, OPEN)).toBe(0)
    expect(isLcxStock(1, retiredXstock.address)).toBe(false)
  })

  it('statik bStocks adresi buyuk/kucuk harf farkiyla da dusurulur; stockEntry statik satiri doner', () => {
    expect(setLcxStockRows([{ ...TSLAC, chainId: BSTOCKS_CHAIN_ID, address: BSTOCK.address.toLowerCase() }], OPEN)).toBe(0)
    expect(stockEntry(BSTOCKS_CHAIN_ID, BSTOCK.address)).toMatchObject({ issuer: 'bstocks' })
  })

  it('xStocks adresi Base de (var olunan zincirler disinda) dislama kapsami disinda: satir kalir', () => {
    // Base (8453) XSTOCK_EXISTENCE_CHAIN_IDS'te yok: dislama kapsami zincir duyarlidir.
    expect(setLcxStockRows([{ ...TSLAC, chainId: 8453, address: XSTOCK.address }], OPEN)).toBe(1)
  })

  it('statikte de dinamikte de olan adres icin stockEntry statik satiri doner (statik once bakilir)', () => {
    setLcxStockRows([GMEON], OPEN)
    expect(stockEntry(BSTOCKS_CHAIN_ID, BSTOCK.address).issuer).toBe('bstocks')
    expect(stockKey(56, GMEON.address)).toBe(`56:${GMEON.address.toLowerCase()}`)
  })
})

describe('dislama ve kopru yasagi (test 4)', () => {
  it('LCX satiri genel Takas ve Kopru KAYNAGINDAN dislanir; _resetLcxStockRows sonrasi degil', () => {
    setLcxStockRows(ROWS, OPEN)
    expect(isGeneralSwapExcluded(8453, TSLAC.address)).toBe(true)
    expect(isBridgeBlocked(8453, TSLAC.address)).toBe(true)
    expect(isGeneralSwapOutputExcluded(8453, TSLAC.address)).toBe(true)
    expect(isGeneralSwapExcluded(56, GMEON.address)).toBe(true)
    // yalniz o zincirde
    expect(isGeneralSwapExcluded(1, TSLAC.address)).toBe(false)

    _resetLcxStockRows()
    expect(isGeneralSwapExcluded(8453, TSLAC.address)).toBe(false)
    expect(isBridgeBlocked(8453, TSLAC.address)).toBe(false)
    expect(isGeneralSwapOutputExcluded(8453, TSLAC.address)).toBe(false)
    expect(isLcxStock(8453, TSLAC.address)).toBe(false)
    expect(lcxStockRows()).toEqual([])
  })

  it('LCX satiri Kopru HEDEFI olarak da kapali (spec 9); _resetLcxStockRows sonrasi degil; yalniz o zincirde', () => {
    setLcxStockRows(ROWS, OPEN)
    expect(isBridgeTargetBlocked(8453, TSLAC.address)).toBe(true)
    expect(isBridgeTargetBlocked(8453, TSLAC.address.toLowerCase())).toBe(true)
    expect(isBridgeTargetBlocked(56, GMEON.address)).toBe(true)
    expect(isBridgeTargetBlocked(1, TSLAC.address)).toBe(false)

    _resetLcxStockRows()
    expect(isBridgeTargetBlocked(8453, TSLAC.address)).toBe(false)
  })

  it('Kopru hedefi kapisi bridgeStockChainIds kumesini DEGISTIRMEZ (yalniz statik satirlar: BSC)', () => {
    const before = bridgeStockChainIds()
    setLcxStockRows(ROWS, OPEN)
    expect(bridgeStockChainIds()).toEqual(before)
    expect(before).toEqual([BSTOCKS_CHAIN_ID])
  })

  it('statik davranis degismez: bStocks Takas da acik ama Kopru kaynagi kapali; xStocks ikisinde kapali', () => {
    setLcxStockRows(ROWS, OPEN)
    expect(isGeneralSwapExcluded(BSTOCKS_CHAIN_ID, BSTOCK.address)).toBe(false)
    expect(isBridgeBlocked(BSTOCKS_CHAIN_ID, BSTOCK.address)).toBe(true)
    expect(isGeneralSwapExcluded(1, XSTOCK.address)).toBe(true)
    expect(isBridgeBlocked(1, XSTOCK.address)).toBe(true)
  })
})

describe('stockImportIdentity LCX satirinda katalog kimligi vermez', () => {
  it('LCX adresi katalog kimligi (known:true + katalog logo/coingecko) tasimaz; sunucu kimligi aynen gecer', () => {
    setLcxStockRows(ROWS, OPEN)
    const backendToken = { image: 'https://logo.example/tslac.png', chain: 'base', coingecko_id: 'tsla-lcx' }
    const out = stockImportIdentity({ chainId: 8453, address: TSLAC.address, symbol: 'TSLAC', name: TSLAC.name, backendToken })
    expect(out).toEqual({ image: 'https://logo.example/tslac.png', chain: 'base', coingecko_id: 'tsla-lcx', known: true })
  })

  it('katalog (bStocks) adresi icin kimlik degismez', () => {
    setLcxStockRows(ROWS, OPEN)
    const out = stockImportIdentity({ chainId: BSTOCKS_CHAIN_ID, address: BSTOCK.address, symbol: BSTOCK.symbol, name: BSTOCK.name })
    expect(out).toMatchObject({ coingecko_id: BSTOCK.coingecko_id, known: true })
  })
})

describe('stocksByChain includeLcx (test 5)', () => {
  const chainIds = (groups) => groups.map((g) => g.chainId)

  it('includeLcx false (varsayilan) bugunku sonucla birebir ayni; LCX satirlari kurulu olsa bile', () => {
    const before = [
      stocksByChain(),
      stocksByChain({ includeXstocks: false }),
      stocksByChain({ activeChainId: 56 }),
      stocksByChain({ activeChainId: 42161, includeXstocks: true }),
    ]
    setLcxStockRows(ROWS, OPEN)
    expect(stocksByChain()).toEqual(before[0])
    expect(stocksByChain({ includeXstocks: false })).toEqual(before[1])
    expect(stocksByChain({ activeChainId: 56 })).toEqual(before[2])
    expect(stocksByChain({ activeChainId: 42161, includeXstocks: true })).toEqual(before[3])
    expect(stocksByChain({ includeLcx: false })).toEqual(before[0])
    expect(chainIds(stocksByChain())).toEqual([1, 56, 42161].filter((id) => chainIds(before[0]).includes(id)))
    for (const group of stocksByChain()) {
      for (const row of group.rows) expect(row.source).toBeUndefined()
    }
  })

  it('includeLcx true: Base grubu 1, 56, 42161den sonra gelir; BSC grubu LCX satirini statiklerden sonra tasir', () => {
    setLcxStockRows(ROWS, OPEN)
    const groups = stocksByChain({ includeLcx: true })
    const ids = chainIds(groups)
    expect(ids.indexOf(8453)).toBeGreaterThan(ids.indexOf(42161))
    expect(ids.indexOf(8453)).toBeGreaterThan(ids.indexOf(56))
    expect(ids.indexOf(8453)).toBeGreaterThan(ids.indexOf(1))
    expect(ids).toEqual([1, 56, 42161, 8453])
    expect(groups.find((g) => g.chainId === 8453).rows.map((r) => r.symbol)).toEqual(['TSLAC'])
    const bsc = groups.find((g) => g.chainId === 56).rows
    expect(bsc.at(-1)).toMatchObject({ symbol: 'GMEON', source: 'lcx' })
    expect(bsc.slice(0, -1).every((r) => r.source === undefined)).toBe(true)
  })

  it('aktif zincir basa alinir (LCX zinciri dahil); sabit sira CHAIN_ORDER', () => {
    setLcxStockRows([
      TSLAC,
      { ...TSLAC, chainId: 10, address: '0x1000000000000000000000000000000000000010', symbol: 'OPX' },
      { ...TSLAC, chainId: 137, address: '0x1000000000000000000000000000000000000137', symbol: 'POLX' },
      { ...TSLAC, chainId: 100, address: '0x1000000000000000000000000000000000000100', symbol: 'GNOX' },
      { ...TSLAC, chainId: 25, address: '0x1000000000000000000000000000000000000025', symbol: 'CROX' },
    ], OPEN)
    expect(chainIds(stocksByChain({ includeLcx: true }))).toEqual([1, 56, 42161, 8453, 10, 137, 100, 25])
    expect(chainIds(stocksByChain({ includeLcx: true, activeChainId: 8453 }))).toEqual([8453, 1, 56, 42161, 10, 137, 100, 25])
    expect(chainIds(stocksByChain({ includeLcx: true, activeChainId: 25 }))[0]).toBe(25)
    expect(chainIds(stocksByChain({ includeLcx: true, activeChainId: '137' }))[0]).toBe(137)
    // LCX satiri olmayan aktif zincir sirayi bozmaz
    expect(chainIds(stocksByChain({ includeLcx: true, activeChainId: 1 }))).toEqual([1, 56, 42161, 8453, 10, 137, 100, 25])
  })

  it('includeXstocks false + includeLcx true: xStocks satiri yok, bStocks ve LCX var', () => {
    setLcxStockRows(ROWS, OPEN)
    const groups = stocksByChain({ includeXstocks: false, includeLcx: true })
    expect(chainIds(groups)).toEqual([56, 8453])
    expect(groups[0].rows.some((r) => r.issuer === 'xstocks')).toBe(false)
    expect(groups[0].rows.at(-1).symbol).toBe('GMEON')
  })

  it('LCX satiri yokken includeLcx true bugunku sonuc', () => {
    expect(stocksByChain({ includeLcx: true })).toEqual(stocksByChain())
  })
})

describe('setLcxStockRows degistirir (test 6)', () => {
  it('ikinci cagri oncekileri tamamen degistirir; eski satir stockEntry ve dislamadan duser', () => {
    expect(setLcxStockRows([TSLAC], OPEN)).toBe(1)
    expect(setLcxStockRows([GMEON], CLOSED)).toBe(1)
    expect(lcxStockRows().map((r) => r.symbol)).toEqual(['GMEON'])
    expect(stockEntry(8453, TSLAC.address)).toBeNull()
    expect(isGeneralSwapExcluded(8453, TSLAC.address)).toBe(false)
    expect(stockEntry(56, GMEON.address).marketOpen).toBe(false)
  })

  it('bos dizi dinamik katmani bosaltir', () => {
    setLcxStockRows(ROWS, OPEN)
    expect(setLcxStockRows([], OPEN)).toBe(0)
    expect(lcxStockRows()).toEqual([])
    expect(stockEntry(8453, TSLAC.address)).toBeNull()
  })

  it('hepsi gecersiz girdi de oncekileri siler (tam degistirme)', () => {
    setLcxStockRows(ROWS, OPEN)
    expect(setLcxStockRows([{ ...TSLAC, priceUsd: 0 }], OPEN)).toBe(0)
    expect(lcxStockRows()).toEqual([])
  })
})

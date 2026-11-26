// stockCompanies.js -- ayni sirketin iki ihraccisini (bStocks / xStocks) tek sirkete baglayan SAF katman.
// Eslesme anahtari `underlying` (dayanak ticker) KATALOGDA ACIKCA yazilidir; sembolden sonek atarak
// URETILMEZ (TK3). Bu dosya o alanin yanlis eslesme uretmemesini KILITLER: yeni bir hisse eklendiginde
// ya da bir `underlying` degistiginde testler kirilir ve bilincli onay ister.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../../data/bStocks'
import { XSTOCKS } from '../../data/xStocks'
import { stockEntry, stocksByChain, stockKey, setLcxStockRows, _resetLcxStockRows } from '../tokenizedStocks'
import {
  PAIRS_REVIEWED, companyRows, compareIssuers, issuerOptions, mergeGroupRows, pickRepresentative, pickXstocksRow,
} from './stockCompanies'

const bsc = BSTOCKS_CHAIN_ID
const bOf = (underlying) => BSTOCKS.find((t) => t.underlying === underlying)
const xOf = (underlying) => XSTOCKS.find((t) => t.underlying === underlying)
const bRow = (underlying) => stockEntry(bsc, bOf(underlying).address)
const xRow = (underlying, chainId) => stockEntry(chainId, xOf(underlying).address)

describe('katalog underlying alani (TK3)', () => {
  it('her bStocks kaydinda buyuk harf underlying var ve sembolden "B" atilmis haline esit', () => {
    expect(BSTOCKS.length).toBeGreaterThan(0)
    for (const t of BSTOCKS) {
      expect(t.symbol.endsWith('B'), t.symbol).toBe(true)
      expect(t.underlying, t.symbol).toBe(t.symbol.slice(0, -1))
      expect(t.underlying, t.symbol).toBe(t.underlying.toUpperCase())
    }
  })

  it('her xStocks kaydinda underlying var ve sembolden "x" atilmis, buyuk harfe cevrilmis haline esit', () => {
    expect(XSTOCKS.length).toBeGreaterThan(0)
    for (const t of XSTOCKS) {
      expect(t.symbol.endsWith('x'), t.symbol).toBe(true)
      expect(t.underlying, t.symbol).toBe(t.symbol.slice(0, -1).toUpperCase())
    }
  })

  it('underlying her ihraccide TEKIL (bir ihracci icinde iki kayit ayni sirket olamaz)', () => {
    expect(new Set(BSTOCKS.map((t) => t.underlying)).size).toBe(BSTOCKS.length)
    expect(new Set(XSTOCKS.map((t) => t.underlying)).size).toBe(XSTOCKS.length)
  })

  it('iki ihraccida ORTAK dayanaklar, gozden gecirilmis 10 ciftlik listeye TAM ESIT', () => {
    const x = new Set(XSTOCKS.map((t) => t.underlying))
    const ortak = BSTOCKS.map((t) => t.underlying).filter((u) => x.has(u))
    expect([...ortak].sort()).toEqual([...PAIRS_REVIEWED].sort())
    expect(PAIRS_REVIEWED).toHaveLength(10)
    expect(Object.isFrozen(PAIRS_REVIEWED)).toBe(true)
  })

  it('normalize satir underlying tasir (stockEntry)', () => {
    for (const t of BSTOCKS) expect(stockEntry(bsc, t.address).underlying, t.symbol).toBe(t.underlying)
    for (const t of XSTOCKS) {
      for (const chainId of t.chains) expect(stockEntry(chainId, t.address).underlying, `${t.symbol}@${chainId}`).toBe(t.underlying)
    }
  })
})

describe('companyRows', () => {
  it('bayrak ACIKKEN cift hissenin TUM zincirlerdeki satirlari: bStocks once, sonra xStocks', () => {
    const rows = companyRows('TSLA', { xstocksEnabled: true })
    expect(rows.map((r) => [r.issuer, r.chainId])).toEqual(
      [['bstocks', bsc], ...xOf('TSLA').chains.map((c) => ['xstocks', c])],
    )
    expect(rows[0]).toBe(bRow('TSLA'))
  })

  it('bayrak KAPALIYKEN yalniz bStocks satiri doner', () => {
    expect(companyRows('TSLA', { xstocksEnabled: false }).map((r) => r.issuer)).toEqual(['bstocks'])
    expect(companyRows('KO', { xstocksEnabled: false })).toEqual([])
  })

  it('kucuk harf girdiyi buyutur; bilinmeyen / bos girdide bos dizi', () => {
    expect(companyRows('tsla', { xstocksEnabled: true })).toEqual(companyRows('TSLA', { xstocksEnabled: true }))
    expect(companyRows('YOKTUR', { xstocksEnabled: true })).toEqual([])
    expect(companyRows('', { xstocksEnabled: true })).toEqual([])
    expect(companyRows(undefined, { xstocksEnabled: true })).toEqual([])
  })

  it('yalniz xStocks hissesi (KO) bayrak acikken kendi zincirlerinde doner', () => {
    const rows = companyRows('KO', { xstocksEnabled: true })
    expect(rows.every((r) => r.issuer === 'xstocks')).toBe(true)
    expect(rows.map((r) => r.chainId)).toEqual(xOf('KO').chains)
  })
})

describe('pickXstocksRow (TK13 zincir secimi)', () => {
  const rows = [{ chainId: 1 }, { chainId: 56 }, { chainId: 42161 }]
  it('once tercih edilen (mevcut hissenin) zinciri', () => {
    expect(pickXstocksRow(rows, { preferChainId: 56, activeChainId: 1 }).chainId).toBe(56)
  })
  it('tercih edilen zincirde yoksa aktif ag', () => {
    expect(pickXstocksRow(rows, { preferChainId: 10, activeChainId: 42161 }).chainId).toBe(42161)
  })
  it('o da yoksa [1, 56, 42161] sirasindaki ilk zincir', () => {
    expect(pickXstocksRow([{ chainId: 42161 }, { chainId: 56 }], { preferChainId: 10, activeChainId: 137 }).chainId).toBe(56)
    expect(pickXstocksRow(rows, {}).chainId).toBe(1)
  })
  it('dize zincir kimligi de calisir; bos listede null', () => {
    expect(pickXstocksRow(rows, { preferChainId: '56' }).chainId).toBe(56)
    expect(pickXstocksRow([], { preferChainId: 56 })).toBeNull()
  })
})

describe('issuerOptions', () => {
  it('bayrak KAPALIYKEN katalogdaki HER satirda tek secenek (secici gizlenir)', () => {
    for (const t of BSTOCKS) {
      const opts = issuerOptions(stockEntry(bsc, t.address), { xstocksEnabled: false })
      expect(opts, t.symbol).toHaveLength(1)
      expect(opts[0].issuer).toBe('bstocks')
    }
    for (const t of XSTOCKS) {
      for (const chainId of t.chains) {
        expect(issuerOptions(stockEntry(chainId, t.address), { xstocksEnabled: false }), `${t.symbol}@${chainId}`).toHaveLength(1)
      }
    }
  })

  it('bayrak acikken yalniz CIFT sirketlerde iki secenek; digerlerinde tek', () => {
    for (const t of BSTOCKS) {
      const opts = issuerOptions(stockEntry(bsc, t.address), { xstocksEnabled: true })
      expect(opts.length, t.symbol).toBe(PAIRS_REVIEWED.includes(t.underlying) ? 2 : 1)
    }
    for (const t of XSTOCKS) {
      for (const chainId of t.chains) {
        const opts = issuerOptions(stockEntry(chainId, t.address), { xstocksEnabled: true })
        expect(opts.length, `${t.symbol}@${chainId}`).toBe(PAIRS_REVIEWED.includes(t.underlying) ? 2 : 1)
      }
    }
  })

  it('secenek sirasi bStocks, xStocks; satirlar KATALOG nesneleridir (serbest adres yok)', () => {
    const opts = issuerOptions(bRow('TSLA'), { xstocksEnabled: true })
    expect(opts.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks'])
    expect(opts[0].row).toBe(bRow('TSLA'))
    expect(opts[1].row).toBe(xRow('TSLA', bsc))
  })

  it('bStocks secili iken xStocks secenegi AYNI zincirde (BSC) gelir; aktif ag onemsiz', () => {
    const opts = issuerOptions(bRow('TSLA'), { xstocksEnabled: true, activeChainId: 1 })
    expect(opts[1].row.chainId).toBe(bsc)
    const mstr = issuerOptions(bRow('MSTR'), { xstocksEnabled: true, activeChainId: 42161 })
    expect(mstr[1].row.chainId).toBe(bsc)
  })

  it('xStocks secili iken kendi satiri (zinciri) KORUNUR, bStocks BSC satiri eklenir', () => {
    const eth = issuerOptions(xRow('TSLA', 1), { xstocksEnabled: true })
    expect(eth.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks'])
    expect(eth[1].row).toBe(xRow('TSLA', 1))
    expect(eth[0].row).toBe(bRow('TSLA'))

    const arb = issuerOptions(xRow('MSTR', 42161), { xstocksEnabled: true })
    expect(arb[1].row).toBe(xRow('MSTR', 42161))
  })

  it('AAPL / GOOGL / QQQ: iki secenek FARKLI zincirde (xStock yalniz Ethereum, bStock BSC)', () => {
    for (const u of ['AAPL', 'GOOGL', 'QQQ']) {
      expect(xOf(u).chains).toEqual([1])
      const opts = issuerOptions(bRow(u), { xstocksEnabled: true, activeChainId: 56 })
      expect(opts.map((o) => o.row.chainId), u).toEqual([bsc, 1])
    }
  })

  it('katalog disi / bozuk girdi bos dizi doner', () => {
    expect(issuerOptions(null)).toEqual([])
    expect(issuerOptions(undefined)).toEqual([])
    expect(issuerOptions({ issuer: 'bstocks', chainId: bsc, address: '0x0000000000000000000000000000000000000001' }, { xstocksEnabled: true })).toEqual([])
    expect(issuerOptions({ chainId: 8453, address: XSTOCKS[0].address }, { xstocksEnabled: true })).toEqual([])
  })

  it('verilen satir nesnesi sahteyse (underlying bozuk) katalogdaki gercek kayit kullanilir', () => {
    const sahte = { ...bRow('TSLA'), underlying: 'NVDA' }
    const opts = issuerOptions(sahte, { xstocksEnabled: true })
    expect(opts[0].row).toBe(bRow('TSLA'))
    expect(opts[1].row.underlying).toBe('TSLA')
  })
})

describe('mergeGroupRows (TK5)', () => {
  const group = (chainId, includeXstocks) => stocksByChain({ includeXstocks }).find((g) => g.chainId === chainId)

  it('BSC grubunda cift sirket TEK satir: iki secenek, bStocks once', () => {
    const g = group(bsc, true)
    const merged = mergeGroupRows(g.chainId, g.rows)
    const tsla = merged.filter((c) => c.underlying === 'TSLA')
    expect(tsla).toHaveLength(1)
    expect(tsla[0].options.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks'])
    expect(tsla[0].key).toBe(`${bsc}:TSLA`)
    expect(tsla[0].chainId).toBe(bsc)
    expect(tsla[0].ticker).toBe('TSLA')
  })

  it('satirlar korunur: toplam secenek sayisi grup satir sayisina esit, sirket anahtarlari tekil', () => {
    for (const includeXstocks of [true, false]) {
      for (const g of stocksByChain({ includeXstocks })) {
        const merged = mergeGroupRows(g.chainId, g.rows)
        expect(merged.reduce((n, c) => n + c.options.length, 0), `${g.chainId}/${includeXstocks}`).toBe(g.rows.length)
        expect(new Set(merged.map((c) => c.key)).size).toBe(merged.length)
        const keys = merged.flatMap((c) => c.options.map((o) => stockKey(o.chainId, o.address)))
        expect(new Set(keys).size).toBe(keys.length)
      }
    }
  })

  it('BSC grubunda satir sayisi = tekil dayanak sayisi; cift sayisi kadar azalir', () => {
    const g = group(bsc, true)
    const merged = mergeGroupRows(g.chainId, g.rows)
    const onBsc = (t) => t.chains.includes(bsc)
    const underlyings = new Set([...BSTOCKS.map((t) => t.underlying), ...XSTOCKS.filter(onBsc).map((t) => t.underlying)])
    expect(merged).toHaveLength(underlyings.size)
    expect(merged.filter((c) => c.options.length === 2).map((c) => c.underlying).sort())
      .toEqual(PAIRS_REVIEWED.filter((u) => xOf(u).chains.includes(bsc)).sort())
  })

  it('Ethereum grubunda her sirket tek secenek (ayni zincirde bStock yok); Tumu-cipi gibi ag basina ayri satir', () => {
    const g = group(1, true)
    const merged = mergeGroupRows(g.chainId, g.rows)
    expect(merged).toHaveLength(g.rows.length)
    expect(merged.every((c) => c.options.length === 1)).toBe(true)
    // ayni sirket (TSLA) BSC'deki sirketten AYRI bir satir ve anahtar
    const bscKeys = mergeGroupRows(bsc, group(bsc, true).rows).map((c) => c.key)
    expect(merged.find((c) => c.underlying === 'TSLA').key).toBe('1:TSLA')
    expect(bscKeys).toContain(`${bsc}:TSLA`)
  })

  it('bayrak kapaliyken BSC grubu bugunku bStocks satirlari kadar sirket verir, hepsi tek secenekli', () => {
    const g = group(bsc, false)
    const merged = mergeGroupRows(g.chainId, g.rows)
    expect(merged).toHaveLength(BSTOCKS.length)
    expect(merged.every((c) => c.options.length === 1 && c.options[0].issuer === 'bstocks')).toBe(true)
    expect(merged.map((c) => c.ticker)).toEqual(BSTOCKS.map((t) => t.underlying))
  })

  it('ad: ciftte bStocks katalog adi, tek ihraccida kendi adi (TK4)', () => {
    const merged = mergeGroupRows(bsc, group(bsc, true).rows)
    const byU = (u) => merged.find((c) => c.underlying === u)
    expect(byU('MSTR').name).toBe(bOf('MSTR').name)
    expect(byU('MSTR').name).not.toBe(xOf('MSTR').name)
    expect(byU('AMZN').name).toBe(bOf('AMZN').name)
    expect(byU('KO').name).toBe(xOf('KO').name) // yalniz xStocks
    expect(byU('NFLX').name).toBe(bOf('NFLX').name) // yalniz bStocks
  })

  it('logoRow: logosu olan secenek (bStocks), yoksa ilk secenek', () => {
    const merged = mergeGroupRows(bsc, group(bsc, true).rows)
    const tsla = merged.find((c) => c.underlying === 'TSLA')
    expect(tsla.logoRow).toBe(bRow('TSLA'))
    expect(tsla.logoRow.image).not.toBeNull()
    const ko = merged.find((c) => c.underlying === 'KO')
    expect(ko.logoRow).toBe(ko.options[0])
    expect(ko.logoRow.image).toBeNull()
  })

  it('sira: bStocks katalog sirasi, ardindan yalniz xStocks sirketleri (bugunku grup sirasi)', () => {
    const g = group(bsc, true)
    const merged = mergeGroupRows(g.chainId, g.rows)
    expect(merged.slice(0, BSTOCKS.length).map((c) => c.underlying)).toEqual(BSTOCKS.map((t) => t.underlying))
    expect(merged.slice(BSTOCKS.length).every((c) => c.options[0].issuer === 'xstocks')).toBe(true)
  })

  it('baska zincirin satirini kendi grubuna katmaz; bos / bozuk girdide patlamaz', () => {
    const rows = [bRow('TSLA'), xRow('TSLA', 1)]
    const merged = mergeGroupRows(bsc, rows)
    expect(merged).toHaveLength(1)
    expect(merged[0].options).toEqual([bRow('TSLA')])
    expect(mergeGroupRows(bsc, [])).toEqual([])
    expect(mergeGroupRows(bsc, undefined)).toEqual([])
  })

  it('underlying eksik bir satir BIRLESTIRILMEZ, kendi satiri olarak kalir (sessiz yanlis eslesme yok)', () => {
    const eksik = { ...bRow('TSLA'), underlying: undefined }
    const merged = mergeGroupRows(bsc, [eksik, bRow('NVDA')])
    expect(merged).toHaveLength(2)
    expect(merged[0].options).toEqual([eksik])
    expect(merged[0].key).not.toBe(merged[1].key)
  })
})

describe('pickRepresentative (TK6)', () => {
  const company = () => mergeGroupRows(bsc, stocksByChain({ includeXstocks: true }).find((g) => g.chainId === bsc).rows)
    .find((c) => c.underlying === 'TSLA')
  const b = bRow('TSLA')
  const x = xRow('TSLA', bsc)
  const val = (map) => (row) => map.get(row) ?? { held: false, usd: null }

  it('hicbiri tutulmuyorsa bStocks', () => {
    expect(pickRepresentative(company(), val(new Map()))).toBe(b)
  })

  it('yalniz xStocks tutuluyorsa xStocks', () => {
    expect(pickRepresentative(company(), val(new Map([[x, { held: true, usd: 5 }]])))).toBe(x)
  })

  it('ikisi de tutuluyorsa en buyuk USD deger', () => {
    expect(pickRepresentative(company(), val(new Map([[b, { held: true, usd: 10 }], [x, { held: true, usd: 50 }]])))).toBe(x)
    expect(pickRepresentative(company(), val(new Map([[b, { held: true, usd: 80 }], [x, { held: true, usd: 50 }]])))).toBe(b)
  })

  it('fiyati bilinmeyen TUTULAN secenek en sonda: bilinen degerli olan kazanir', () => {
    expect(pickRepresentative(company(), val(new Map([[b, { held: true, usd: null }], [x, { held: true, usd: 0.01 }]])))).toBe(x)
    expect(pickRepresentative(company(), val(new Map([[b, { held: true, usd: 3 }], [x, { held: true, usd: null }]])))).toBe(b)
  })

  it('tutulan ama fiyati bilinmeyen tek secenek, tutulmayan bStocks yerine secilir', () => {
    expect(pickRepresentative(company(), val(new Map([[x, { held: true, usd: null }]])))).toBe(x)
  })

  it('tutulmayan secenegin degeri (usd) sayilmaz', () => {
    expect(pickRepresentative(company(), val(new Map([[b, { held: false, usd: 9999 }], [x, { held: true, usd: 1 }]])))).toBe(x)
  })

  it('esit degerde bStocks (liste sirasi)', () => {
    expect(pickRepresentative(company(), val(new Map([[b, { held: true, usd: 7 }], [x, { held: true, usd: 7 }]])))).toBe(b)
  })

  it('tek secenekli sirket o secenegi verir; valueOf bozuk/eksik donerse tutulmayan sayilir', () => {
    const ko = mergeGroupRows(1, stocksByChain({ includeXstocks: true }).find((g) => g.chainId === 1).rows)
      .find((c) => c.underlying === 'KO')
    expect(pickRepresentative(ko, () => undefined)).toBe(ko.options[0])
    expect(pickRepresentative(company(), () => undefined)).toBe(b)
    expect(pickRepresentative(company(), () => ({ held: true, usd: NaN }))).toBe(b)
  })

  it('yalniz xStocks olan sirkette (bStock yok) tutulmuyorsa ilk secenek', () => {
    const ko = mergeGroupRows(56, stocksByChain({ includeXstocks: true }).find((g) => g.chainId === 56).rows)
      .find((c) => c.underlying === 'KO')
    expect(pickRepresentative(ko, val(new Map()))).toBe(ko.options[0])
  })
})

// ---- LCX ihraccilari (Bolum 2, Gorev 10): sirket modeli AG BASINA N secenek --------------------------------------------------
// Satirlar sunucunun GET /lcx/stocks bicimidir (tokenizedStocks.lcx.test.js ile ayni alanlar). Ethereum / ek BSC satirlarinin adresleri
// test icin uydurmadir (statik katalogla cakismaz). Dinamik katman her testten sonra bosaltilir: statik testler etkilenmez.
const lcxRaw = (over) => ({
  category: 'stocks', priceSource: 'Chainlink', priceUpdatedAt: 1795071867, marketHours: 'us_equities', depthUsd: 1000, decimals: 18, priceUsd: 100, ...over,
})
const testAddress = (n) => `0x${'7'.padEnd(38, '0')}${String(n).padStart(2, '0')}`
const TSLAC = lcxRaw({
  chainId: 8453, address: '0xb2000000000000000000001e800a7f5189430cD0', symbol: 'TSLAC', name: 'Tesla (Coinbase Tokenized Stocks)',
  decimals: 8, issuer: 'coinbase', underlying: 'TSLA', priceUsd: 388.61280861,
})
const GMEON = lcxRaw({
  chainId: 56, address: '0xdABb9afF4cf02f26D2014e4cA9f94aC6fe6572a3', symbol: 'GMEON', name: 'GameStop (Ondo Tokenized Stock)',
  issuer: 'ondo', underlying: 'GME', priceUsd: 27.02536498754133,
})
const TSLAON_ETH = lcxRaw({
  chainId: 1, address: testAddress(1), symbol: 'TSLAON', name: 'Tesla (Ondo Tokenized Stock)', issuer: 'Ondo', underlying: 'TSLA',
})
const ON = { xstocksEnabled: true, lcxEnabled: true }
const lcxRow = (raw) => stockEntry(raw.chainId, raw.address)
const issuersOf = (options) => options.map((o) => o.issuer)
const lcxGroup = (chainId) => stocksByChain({ includeXstocks: true, includeLcx: true }).find((g) => g.chainId === chainId)
const companyOf = (chainId, underlying) => mergeGroupRows(chainId, lcxGroup(chainId).rows).find((c) => c.underlying === underlying)

describe('LCX ihraccilari: sirket modeli ag basina N secenek (Gorev 10)', () => {
  beforeEach(() => { setLcxStockRows([TSLAC, GMEON, TSLAON_ETH], { usEquitiesOpen: true }) })
  afterEach(() => { _resetLcxStockRows() })

  it('test 1: BSC grubunda bStocks GME + Ondo GMEON TEK sirket satiri; secenekler [bstocks, ondo]', () => {
    const gme = mergeGroupRows(bsc, lcxGroup(bsc).rows).filter((c) => c.underlying === 'GME')
    expect(gme).toHaveLength(1)
    expect(issuersOf(gme[0].options)).toEqual(['bstocks', 'ondo'])
    expect(gme[0].options[0]).toBe(bRow('GME'))
    expect(gme[0].options[1]).toBe(lcxRow(GMEON))
    expect(gme[0].name).toBe(bOf('GME').name) // ad: ciftte bStocks adi
    expect(gme[0].key).toBe(`${bsc}:GME`)
    // ayni sonuc issuerOptions'ta: bStocks satirindan da, Ondo satirindan da
    expect(issuersOf(issuerOptions(bRow('GME'), ON))).toEqual(['bstocks', 'ondo'])
    expect(issuersOf(issuerOptions(lcxRow(GMEON), ON))).toEqual(['bstocks', 'ondo'])
    expect(issuerOptions(lcxRow(GMEON), ON)[1].row).toBe(lcxRow(GMEON))
  })

  it('test 2: Ethereum grubunda xStocks TSLAx + Ondo TSLAON tek sirket satiri; secenekler [xstocks, ondo]', () => {
    const tsla = companyOf(1, 'TSLA')
    expect(issuersOf(tsla.options)).toEqual(['xstocks', 'ondo'])
    expect(tsla.options[0]).toBe(xRow('TSLA', 1))
    expect(tsla.options[1]).toBe(lcxRow(TSLAON_ETH))
    expect(tsla.key).toBe('1:TSLA')
  })

  it('test 2b: issuerOptions Ethereum TSLAx: bugunku BSC bStocks (baska ag, pasif secenek) KORUNUR, Ondo ayni ag satiri eklenir', () => {
    const opts = issuerOptions(xRow('TSLA', 1), ON)
    expect(issuersOf(opts)).toEqual(['bstocks', 'xstocks', 'ondo'])
    expect(opts[0].row).toBe(bRow('TSLA')) // BSC satiri: useIssuerSwitch bunu `available:false` yapar
    expect(opts[1].row).toBe(xRow('TSLA', 1))
    expect(opts[2].row).toBe(lcxRow(TSLAON_ETH))
  })

  it('test 3: Base TSLAC tek secenekli Base sirket satiridir; BSC bStocks TSLA ile BIRLESMEZ (ag basina kural)', () => {
    const base = companyOf(8453, 'TSLA')
    expect(base.key).toBe('8453:TSLA')
    expect(base.options).toEqual([lcxRow(TSLAC)])
    expect(base.options).toHaveLength(1)
    expect(base.chainId).toBe(8453)
    // BSC TSLA satirinda coinbase / ondo yok
    expect(issuersOf(companyOf(bsc, 'TSLA').options)).toEqual(['bstocks', 'xstocks'])
    // issuerOptions: Base TSLAC'in tek gercek secenegi kendisi (secici gizlenir); bStocks / xStocks (baska ag) ya da Ondo (Ethereum) GELMEZ
    const opts = issuerOptions(lcxRow(TSLAC), ON)
    expect(opts).toEqual([{ issuer: 'coinbase', row: lcxRow(TSLAC) }])
    expect(opts[0].row).toBe(lcxRow(TSLAC))
    // BSC bStocks TSLA'nin secenekleri de Base / Ethereum LCX satirlarini icermez
    expect(issuersOf(issuerOptions(bRow('TSLA'), ON))).toEqual(['bstocks', 'xstocks'])
  })

  it('companyRows: LCX satirlari TUM zincirlerden toplanir (bStocks, xStocks, sonra LCX alfabetik); bayrak kapaliyken HIC', () => {
    expect(companyRows('TSLA', ON).map((r) => [r.issuer, r.chainId])).toEqual([
      ['bstocks', bsc], ...xOf('TSLA').chains.map((c) => ['xstocks', c]), ['coinbase', 8453], ['ondo', 1],
    ])
    expect(companyRows('tsla', ON)).toEqual(companyRows('TSLA', ON))
    expect(companyRows('GME', { xstocksEnabled: true, lcxEnabled: false }).map((r) => r.issuer)).toEqual(['bstocks'])
    expect(companyRows('GME', { xstocksEnabled: true, lcxEnabled: false })).toEqual(companyRows('GME', { xstocksEnabled: true }))
    expect(companyRows('TSLA', { xstocksEnabled: false, lcxEnabled: true }).map((r) => r.issuer)).toEqual(['bstocks', 'coinbase', 'ondo'])
  })

  it('bayrak KAPALI (lcxEnabled false): dinamik satirlar yuklu olsa da seceneklerde YOK, sonuc bugunkuyle ayni', () => {
    for (const xstocksEnabled of [true, false]) {
      const flags = { xstocksEnabled, lcxEnabled: false }
      expect(issuersOf(issuerOptions(bRow('GME'), flags))).toEqual(['bstocks'])
      expect(issuerOptions(bRow('TSLA'), flags)).toEqual(issuerOptions(bRow('TSLA'), { xstocksEnabled }))
    }
    // LCX satiri secili ama bayrak kapali (ulasilamaz durum): yalniz kendisi, uydurma secenek yok
    expect(issuerOptions(lcxRow(TSLAC), { xstocksEnabled: true, lcxEnabled: false })).toEqual([{ issuer: 'coinbase', row: lcxRow(TSLAC) }])
    expect(issuerOptions(lcxRow(TSLAC), { xstocksEnabled: false, lcxEnabled: false })).toEqual([{ issuer: 'coinbase', row: lcxRow(TSLAC) }])
  })

  it('xStocks bayragi kapaliyken LCX bayragi acik: bStocks + LCX secenekleri, xStocks yok', () => {
    const flags = { xstocksEnabled: false, lcxEnabled: true }
    expect(issuersOf(issuerOptions(bRow('GME'), flags))).toEqual(['bstocks', 'ondo'])
    expect(issuersOf(issuerOptions(lcxRow(GMEON), flags))).toEqual(['bstocks', 'ondo'])
    expect(issuersOf(issuerOptions(bRow('TSLA'), flags))).toEqual(['bstocks']) // Ondo / Coinbase satirlari baska agda
  })

  it('LCX satiri secili: yalniz O AGDAKI gercek secenekler (bStocks ve xStocks de gercek ise gelir, pasif secenek YOK)', () => {
    const ondoBsc = lcxRaw({ chainId: 56, address: testAddress(2), symbol: 'TSLAON', issuer: 'ondo', underlying: 'TSLA' })
    setLcxStockRows([TSLAC, GMEON, TSLAON_ETH, ondoBsc], { usEquitiesOpen: true })
    const opts = issuerOptions(lcxRow(ondoBsc), ON)
    expect(issuersOf(opts)).toEqual(['bstocks', 'xstocks', 'ondo'])
    expect(opts.map((o) => o.row.chainId)).toEqual([bsc, bsc, bsc]) // hepsi AYNI ag
    expect(opts[1].row).toBe(xRow('TSLA', bsc))
    // Ethereum Ondo TSLAON: xStocks Ethereum gercek; BSC bStocks baska ag oldugu icin YOK
    const eth = issuerOptions(lcxRow(TSLAON_ETH), ON)
    expect(issuersOf(eth)).toEqual(['xstocks', 'ondo'])
    expect(eth.every((o) => o.row.chainId === 1)).toBe(true)
  })

  it('secenek sirasi TEK yerde: bstocks, xstocks, sonra LCX ihraccilari ALFABETIK (satir gelis sirasindan bagimsiz)', () => {
    const extra = (issuer, n) => lcxRaw({ chainId: 56, address: testAddress(n), symbol: `GME${n}`, issuer, underlying: 'GME' })
    setLcxStockRows([extra('st0x', 11), extra('Robinhood', 12), GMEON, extra('Coinbase', 13)], { usEquitiesOpen: true })
    const expected = ['bstocks', 'coinbase', 'ondo', 'robinhood', 'st0x']
    expect(issuersOf(issuerOptions(bRow('GME'), ON))).toEqual(expected)
    expect(issuersOf(companyOf(bsc, 'GME').options)).toEqual(expected)
    expect(companyRows('GME', ON).map((r) => r.issuer)).toEqual(expected)
    // sirali liste ayni kural: compareIssuers
    expect(['st0x', 'ondo', 'xstocks', 'coinbase', 'bstocks'].sort(compareIssuers)).toEqual(['bstocks', 'xstocks', 'coinbase', 'ondo', 'st0x'])
  })

  it("'constructor' gibi miras adli ihracci sorun cikarmaz: sirali LCX ihraccisidir (dizi uyeligi, prototip aramasi yok)", () => {
    const odd = lcxRaw({ chainId: 56, address: testAddress(99), symbol: 'GMEC', issuer: 'constructor', underlying: 'GME' })
    setLcxStockRows([GMEON, odd], { usEquitiesOpen: true })
    expect(issuersOf(issuerOptions(bRow('GME'), ON))).toEqual(['bstocks', 'constructor', 'ondo'])
    expect(issuersOf(companyOf(bsc, 'GME').options)).toEqual(['bstocks', 'constructor', 'ondo'])
    expect(['ondo', 'constructor', 'toString', 'xstocks', 'bstocks'].sort(compareIssuers)).toEqual(['bstocks', 'xstocks', 'constructor', 'ondo', 'toString'])
  })

  it('pickRepresentative kurali DEGISMEZ: tutulan en degerli -> bStocks -> ilk', () => {
    const gme = companyOf(bsc, 'GME')
    const b = bRow('GME')
    const ondo = lcxRow(GMEON)
    const val = (map) => (row) => map.get(row) ?? { held: false, usd: null }
    expect(pickRepresentative(gme, val(new Map()))).toBe(b)
    expect(pickRepresentative(gme, val(new Map([[ondo, { held: true, usd: 3 }]])))).toBe(ondo)
    expect(pickRepresentative(gme, val(new Map([[b, { held: true, usd: 5 }], [ondo, { held: true, usd: 3 }]])))).toBe(b)
    expect(pickRepresentative(gme, val(new Map([[b, { held: true, usd: 5 }], [ondo, { held: true, usd: 50 }]])))).toBe(ondo)
    expect(pickRepresentative(companyOf(8453, 'TSLA'), val(new Map()))).toBe(lcxRow(TSLAC)) // bStocks yok -> listedeki ilk
    expect(pickRepresentative(companyOf(1, 'TSLA'), val(new Map()))).toBe(xRow('TSLA', 1)) // bStocks yok -> ilk (xStocks)
  })
})

describe('saflik', () => {
  it('stockCompanies.js ag, saglayici, cuzdan ya da tarayici API kullanmaz', () => {
    const src = readFileSync(new URL('./stockCompanies.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    for (const yasak of [/\bfetch\s*\(/, /\bchrome\b/, /\bwindow\b/, /\bdocument\b/, /\bethers\b/, /XMLHttpRequest/, /sendMessage/]) {
      expect(src, String(yasak)).not.toMatch(yasak)
    }
  })

  it('sembolden sonek atarak underlying URETMEZ (acik alan okunur)', () => {
    const src = readFileSync(new URL('./stockCompanies.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/\.slice\(0,\s*-1\)/)
    expect(src).not.toMatch(/symbol\.(replace|slice|substring)/)
  })
})

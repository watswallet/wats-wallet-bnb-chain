// stockCompanies.js -- ayni sirketin iki ihraccisini (bStocks / xStocks) tek sirkete baglayan SAF katman.
// Eslesme anahtari `underlying` (dayanak ticker) KATALOGDA ACIKCA yazilidir; sembolden sonek atarak
// URETILMEZ (TK3). Bu dosya o alanin yanlis eslesme uretmemesini KILITLER: yeni bir hisse eklendiginde
// ya da bir `underlying` degistiginde testler kirilir ve bilincli onay ister.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../../data/bStocks'
import { XSTOCKS } from '../../data/xStocks'
import { stockEntry, stocksByChain, stockKey } from '../tokenizedStocks'
import {
  PAIRS_REVIEWED, companyRows, issuerOptions, mergeGroupRows, pickRepresentative, pickXstocksRow,
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

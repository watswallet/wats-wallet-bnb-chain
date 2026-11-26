// Al/Sat ekraninin REFERANS FIYAT kaynagi (Bolum 2, Gorev 8): ekran satirin ihraccisina (`issuer === 'bstocks'`) degil, bu modele sorar.
import { describe, it, expect } from 'vitest'
import { BSTOCKS } from '../../data/bStocks'
import { XSTOCKS } from '../../data/xStocks'
import { stockEntry, setLcxStockRows, _resetLcxStockRows } from '../tokenizedStocks'
import { quoteReferenceUsd, referenceSourceOf } from './tradeReference'

const TSLAC = {
  chainId: 8453, address: '0xb2000000000000000000001e800a7f5189430cD0', symbol: 'TSLAC', name: 'Tesla (Coinbase)', decimals: 8,
  issuer: 'coinbase', underlying: 'TSLA', priceUsd: 388.6, marketHours: 'us_equities',
}

describe('referenceSourceOf', () => {
  it('statik katalog bStocks satiri: ekran referansi sunucudan okur (server)', () => {
    const entry = stockEntry(56, BSTOCKS[0].address)
    expect(entry.issuer).toBe('bstocks')
    expect(referenceSourceOf(entry)).toBe('server')
  })

  it('xStocks satiri: ekranda referans yok (arka plan kurar) -> null', () => {
    const x = XSTOCKS.find((s) => s.chains.includes(1))
    expect(referenceSourceOf(stockEntry(1, x.address))).toBeNull()
  })

  it('LCX satiri: referans teklifle birlikte gelir (quote)', () => {
    setLcxStockRows([TSLAC], { usEquitiesOpen: true })
    try {
      const entry = stockEntry(8453, TSLAC.address)
      expect(entry.source).toBe('lcx')
      expect(referenceSourceOf(entry)).toBe('quote')
    } finally {
      _resetLcxStockRows()
    }
  })

  it('LCX satiri ihracci ne yazarsa yazsin quote kalir (kaynak alani belirleyici)', () => {
    expect(referenceSourceOf({ source: 'lcx', issuer: 'bstocks' })).toBe('quote')
  })

  it('satir yok / bozuk -> null', () => {
    for (const v of [null, undefined, {}, 'bstocks', 5, []]) expect(referenceSourceOf(v)).toBeNull()
  })
})

describe('quoteReferenceUsd', () => {
  it('LCX teklifi { usd, source } nesnesi: usd dondurulur', () => {
    expect(quoteReferenceUsd({ reference: { usd: 388.6, source: 'lcx' } })).toBe(388.6)
  })

  it('pancake / cow teklifinin SAYI referansi bu yolu kullanmaz (null)', () => {
    expect(quoteReferenceUsd({ reference: 250 })).toBeNull()
    expect(quoteReferenceUsd({ reference: null })).toBeNull()
  })

  it('gecersiz usd (null, 0, negatif, NaN, Infinity, dize) ve eksik alan null', () => {
    for (const usd of [null, 0, -1, Number.NaN, Infinity, '388.6', undefined]) {
      expect(quoteReferenceUsd({ reference: { usd, source: 'lcx' } }), String(usd)).toBeNull()
    }
    for (const v of [null, undefined, {}, { reference: [] }, 'x']) expect(quoteReferenceUsd(v)).toBeNull()
  })
})

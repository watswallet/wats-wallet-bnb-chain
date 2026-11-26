// TK2: hisse yonlendirmesi. bStock her zaman, xStock yalniz bayrakla, katalog disi -> null.
// App.vue baglari (@click gibi kaynak) kaynak taramasiyla kilitlenir.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { stockEntryForRef } from './stockRoute'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../../data/bStocks'
import { XSTOCKS } from '../../data/xStocks'
import { setLcxStockRows, _resetLcxStockRows } from '../tokenizedStocks'

const here = dirname(fileURLToPath(import.meta.url))
const APP = readFileSync(join(here, '../../popup/App.vue'), 'utf8')

const b = BSTOCKS[0]
const x = XSTOCKS.find((s) => s.chains.includes(1))
const bRef = { chainId: BSTOCKS_CHAIN_ID, address: b.address }
const xRef = { chainId: 1, address: x.address }

describe('stockEntryForRef', () => {
    it('bStock bayraktan bagimsiz hisse', () => {
        expect(stockEntryForRef(bRef, { xstocksEnabled: false })?.issuer).toBe('bstocks')
        expect(stockEntryForRef(bRef, { xstocksEnabled: true })?.issuer).toBe('bstocks')
    })
    it('xStock yalniz bayrak aciksa', () => {
        expect(stockEntryForRef(xRef, { xstocksEnabled: false })).toBeNull()
        expect(stockEntryForRef(xRef, { xstocksEnabled: true })?.issuer).toBe('xstocks')
    })
    it('katalog disi, yabanci zincir, bos ref -> null', () => {
        expect(stockEntryForRef({ chainId: 1, address: '0x0000000000000000000000000000000000000001' })).toBeNull()
        expect(stockEntryForRef({ chainId: 137, address: b.address }, { xstocksEnabled: true })).toBeNull()
        expect(stockEntryForRef(null)).toBeNull()
        expect(stockEntryForRef({})).toBeNull()
        expect(stockEntryForRef({ chainId: 56 })).toBeNull()
    })
    // Gizli mod (Dilim 0c G5, E-R12a): hisse ekranlari ozel modda KAPALI; hisse tokeni siradan Token ekranina duser.
    it('privateMode: true -> bStock ve xStock icin null (hisse ekrani gizli modda kapali)', () => {
        expect(stockEntryForRef(bRef, { xstocksEnabled: true, privateMode: true })).toBeNull()
        expect(stockEntryForRef(bRef, { xstocksEnabled: false, privateMode: true })).toBeNull()
        expect(stockEntryForRef(xRef, { xstocksEnabled: true, privateMode: true })).toBeNull()
    })
    it('KONTROL: privateMode: false / verilmedi -> degismez (main davranisi)', () => {
        expect(stockEntryForRef(bRef, { xstocksEnabled: false, privateMode: false })?.issuer).toBe('bstocks')
        expect(stockEntryForRef(xRef, { xstocksEnabled: true, privateMode: false })?.issuer).toBe('xstocks')
        expect(stockEntryForRef(bRef)?.issuer).toBe('bstocks')
    })
    it('adres buyuk/kucuk harf duyarsiz', () => {
        expect(stockEntryForRef({ chainId: BSTOCKS_CHAIN_ID, address: b.address.toUpperCase().replace('0X', '0x') })?.issuer).toBe('bstocks')
    })
})

// LCX satirlari (Bolum 2, Gorev 10): dinamik katmandaki satir ref ile (chainId + adres) cozulur; katalog kimligi (id) GEREKMEZ.
// Home.openStock LCX satiri icin `id: null` yazar. Sonuc YALNIZ lcxEnabled'a baglidir (xStocks bayragindan bagimsiz); gizli modda null.
describe('stockEntryForRef: LCX satirlari', () => {
    const TSLAC = {
        chainId: 8453, address: '0xb2000000000000000000001e800a7f5189430cD0', symbol: 'TSLAC', name: 'Tesla (Coinbase Tokenized Stocks)', decimals: 8,
        issuer: 'coinbase', underlying: 'TSLA', category: 'stocks', priceUsd: 388.61280861, priceSource: 'Chainlink Coinbase TSLA on Base',
        priceUpdatedAt: 1795071867, marketHours: 'us_equities', depthUsd: 252144.395038,
    }
    // Home.openStock'un LCX satiri icin yazdigi ref sekli (id null; chainId + address kimlik)
    const lcxRef = { id: null, chainId: 8453, address: TSLAC.address, decimals: 8, symbol: 'TSLAC' }

    beforeEach(() => { setLcxStockRows([TSLAC], { usEquitiesOpen: true }) })
    afterEach(() => { _resetLcxStockRows() })

    it('test 5: bayrak KAPALI -> null (genel Token ekrani, bugunku davranis); ACIK -> hisse satiri', () => {
        expect(stockEntryForRef(lcxRef, { lcxEnabled: false })).toBeNull()
        expect(stockEntryForRef(lcxRef, { xstocksEnabled: true, lcxEnabled: false })).toBeNull()
        const entry = stockEntryForRef(lcxRef, { lcxEnabled: true })
        expect(entry).toMatchObject({ issuer: 'coinbase', source: 'lcx', chainId: 8453, symbol: 'TSLAC' })
        // bayrak verilmezse varsayilan LCX_ENABLED (derlemede kapali): dinamik satir yuklu olsa da hisse ekrani acilmaz
        expect(stockEntryForRef(lcxRef)).toBeNull()
    })

    it('gizli mod: bayrak acik olsa da LCX satiri icin HER ZAMAN null', () => {
        expect(stockEntryForRef(lcxRef, { lcxEnabled: true, privateMode: true })).toBeNull()
        expect(stockEntryForRef(lcxRef, { lcxEnabled: true, xstocksEnabled: true, privateMode: true })).toBeNull()
        expect(stockEntryForRef(lcxRef, { lcxEnabled: true, privateMode: false })?.source).toBe('lcx')
    })

    it('LCX bayragi xStocks bayragindan bagimsiz; statik satirlar lcxEnabled ile degismez', () => {
        expect(stockEntryForRef(lcxRef, { xstocksEnabled: false, lcxEnabled: true })?.issuer).toBe('coinbase')
        expect(stockEntryForRef(xRef, { xstocksEnabled: false, lcxEnabled: true })).toBeNull()
        expect(stockEntryForRef(xRef, { xstocksEnabled: true, lcxEnabled: false })?.issuer).toBe('xstocks')
        expect(stockEntryForRef(bRef, { xstocksEnabled: false, lcxEnabled: false })?.issuer).toBe('bstocks')
        expect(stockEntryForRef(bRef, { xstocksEnabled: false, lcxEnabled: true })?.issuer).toBe('bstocks')
    })

    it('ref cozumu: id olmadan, adres buyuk/kucuk harf duyarsiz; baska zincirdeki ayni adres hisse degil', () => {
        const { id, ...noId } = lcxRef
        expect(id).toBeNull()
        expect(stockEntryForRef(noId, { lcxEnabled: true })?.issuer).toBe('coinbase')
        expect(stockEntryForRef({ ...lcxRef, address: TSLAC.address.toLowerCase() }, { lcxEnabled: true })?.issuer).toBe('coinbase')
        expect(stockEntryForRef({ ...lcxRef, chainId: 56 }, { lcxEnabled: true })).toBeNull()
        expect(stockEntryForRef({ ...lcxRef, address: '0x0000000000000000000000000000000000000001' }, { lcxEnabled: true })).toBeNull()
    })

    it('dinamik katman bosken (sunucu satiri yok) LCX adresi hisse degil', () => {
        _resetLcxStockRows()
        expect(stockEntryForRef(lcxRef, { lcxEnabled: true })).toBeNull()
    })
})

describe('App.vue yonlendirme baglari', () => {
    const tpl = APP.split('<script')[0]
    it('token sayfasi hisse ise StockDetail, degilse Token', () => {
        expect(tpl).toMatch(/<StockDetail v-if="page\.currentPage === 'token' && isStockPage"/)
        expect(tpl).toMatch(/<Token v-if="page\.currentPage === 'token' && !isStockPage"/)
        expect(APP).toContain("import StockDetail from '../components/stocks/StockDetail.vue'")
        expect(APP).toContain('stockEntryForRef(crypto.selected_token_ref, { privateMode: privacy.active })')
    })
    it('stock_trade satiri bayrak kosuluna bagli degil; yalniz gizli mod KAPALIYKEN baglanir (G5)', () => {
        expect(tpl).toMatch(/<StockTrade v-if="!privacy\.active && page\.currentPage === 'stock_trade'"/)
        expect(tpl).not.toMatch(/XSTOCKS_ENABLED && page\.currentPage === 'stock_trade'/)
    })
})

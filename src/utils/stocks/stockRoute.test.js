// TK2: hisse yonlendirmesi. bStock her zaman, xStock yalniz bayrakla, katalog disi -> null.
// App.vue baglari (@click gibi kaynak) kaynak taramasiyla kilitlenir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { stockEntryForRef } from './stockRoute'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../../data/bStocks'
import { XSTOCKS } from '../../data/xStocks'

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

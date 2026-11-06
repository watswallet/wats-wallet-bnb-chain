// priceGate.js -- ozel modda fiyat istekleri aga CIKMADAN reddedilir (gizli-mod cok-ag spec 4.7, E6).
//
// Gercek bir axios ORNEGI + sahte bir `adapter` kullanilir: kesici gercek istek hattinda calisir, ag yoktur.
// `adapter` cagrilmadiysa istek aga CIKMAMISTIR (kesicinin asil iddiasi).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import axios from 'axios'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { PRIVATE_PRICE_OFF, isPriceRequest, createPriceGate, installPriceGate } from './priceGate'

const API = 'https://api.example.test'

function kur(ozel) {
    const cagrilar = []
    const http = axios.create({
        adapter: async (config) => {
            cagrilar.push(String(config.url))
            return { data: { tokens: [] }, status: 200, statusText: 'OK', headers: {}, config }
        },
    })
    const state = { ozel }
    const kaldir = installPriceGate(http, () => state.ozel)
    return { http, cagrilar, state, kaldir }
}

describe('priceGate -- kapali fiyat uclari ozel modda aga cikmaz', () => {
    it.each([
        ['/getTokensDataById'],
        ['/getTokenDataById'],
        ['/getTokenPriceHistory'],
        ['/getTokenByAddress'],
    ])('ozel modda %s reddedilir: PRIVATE_PRICE_OFF kodu, adapter HIC cagrilmaz', async (yol) => {
        const { http, cagrilar } = kur(true)
        const hata = await http.post(API + yol, { ids: ['x'] }).catch((e) => e)
        expect(hata.code).toBe(PRIVATE_PRICE_OFF)
        expect(hata.message).toBe(PRIVATE_PRICE_OFF)
        expect(cagrilar).toEqual([])
    })

    it('KONTROL: normal modda ayni uclar GECER (adapter cagrilir)', async () => {
        const { http, cagrilar } = kur(false)
        await http.post(API + '/getTokensDataById', { ids: ['x'] })
        await http.post(API + '/getTokenDataById', { id: 'x' })
        expect(cagrilar).toEqual([API + '/getTokensDataById', API + '/getTokenDataById'])
    })

    it('sorgu dizesi ve sondaki egik cizgi kesiciyi atlatmaz', async () => {
        const { http, cagrilar } = kur(true)
        for (const url of [API + '/getTokensDataById?x=1', API + '/getTokensDataById/', API + '/getTokensDataById#a']) {
            const hata = await http.post(url, {}).catch((e) => e)
            expect(hata.code, url).toBe(PRIVATE_PRICE_OFF)
        }
        expect(cagrilar).toEqual([])
    })

    it('baseURL ile birlesen goreli yol da yakalanir', async () => {
        const { http, cagrilar } = kur(true)
        const hata = await http.post('/getTokensDataById', {}, { baseURL: API }).catch((e) => e)
        expect(hata.code).toBe(PRIVATE_PRICE_OFF)
        expect(cagrilar).toEqual([])
    })

    it('api.coingecko.com ozel modda reddedilir (buyuk/kucuk harf farki yok), normal modda gecer', async () => {
        const ozel = kur(true)
        const hata = await ozel.http.get('https://API.CoinGecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd').catch((e) => e)
        expect(hata.code).toBe(PRIVATE_PRICE_OFF)
        expect(ozel.cagrilar).toEqual([])

        const normal = kur(false)
        await normal.http.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd')
        expect(normal.cagrilar).toHaveLength(1)
    })

    it('fiyat OLMAYAN uclar ozel modda GECER: token listesi, arama, haber, gecmis, itibar', async () => {
        const { http, cagrilar } = kur(true)
        const yollar = ['/getChainTokens', '/getTokenByName', '/news', '/wallet/history', '/wallet/reputation']
        for (const yol of yollar) await http.post(API + yol, {})
        expect(cagrilar).toEqual(yollar.map((yol) => API + yol))
    })

    it('mod HER istekte okunur: ayni ornekte mod degisince karar degisir', async () => {
        const { http, cagrilar, state } = kur(false)
        await http.post(API + '/getTokensDataById', {})
        state.ozel = true
        const hata = await http.post(API + '/getTokensDataById', {}).catch((e) => e)
        expect(hata.code).toBe(PRIVATE_PRICE_OFF)
        state.ozel = false
        await http.post(API + '/getTokensDataById', {})
        expect(cagrilar).toHaveLength(2)
    })

    it('installPriceGate donen islev kesiciyi KALDIRIR (tekrar kurulumda sizinti yok)', async () => {
        const { http, cagrilar, kaldir } = kur(true)
        kaldir()
        await http.post(API + '/getTokensDataById', {})
        expect(cagrilar).toHaveLength(1)
    })
})

describe('isPriceRequest / createPriceGate -- saf davranis', () => {
    it('config bos ya da eksikse firlatmaz ve false doner', () => {
        expect(isPriceRequest(undefined)).toBe(false)
        expect(isPriceRequest({})).toBe(false)
        expect(isPriceRequest({ url: null })).toBe(false)
    })

    it('kesici fiyat olmayan istekte config i AYNEN dondurur', () => {
        const config = { url: API + '/getChainTokens' }
        expect(createPriceGate(() => true)(config)).toBe(config)
    })

    it('kesici firlatirken config i hataya ekler (teshis icin)', () => {
        const config = { url: API + '/getTokensDataById' }
        try {
            createPriceGate(() => true)(config)
            throw new Error('firlatmaliydi')
        } catch (e) {
            expect(e.code).toBe(PRIVATE_PRICE_OFF)
            expect(e.config).toBe(config)
        }
    })
})

describe('priceGate -- popup paketi kilidi', () => {
    // privatePopupImports.test.js ayni kuralin GENEL kilididir; burada modulun KENDI kaynagi taranir.
    it('SDK, silentswap.js ya da privateOrderExec.js import etmez', () => {
        const kaynak = yorumsuz(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'priceGate.js'), 'utf8'))
        expect(kaynak).not.toMatch(/@silentswap|silentswap\.js|privateOrderExec/)
        expect(kaynak).not.toMatch(/\bimport\b/)
    })
})

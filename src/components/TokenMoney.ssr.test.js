// Token.vue (SSR) - para birimi (Plan B Gorev 8): baslik fiyati, deger kutusu, piyasa degeri, hacim,
// ATH ve ATL secili birimde yazilir; elle `'$' + ...` kalibi kalmaz. Bugun "0.00" / "0" basan yuzeylerde
// gecersiz girdi `moneyOrZero` ile sifir bicimini basar (bos, "NaN", "undefined" degil); fiyati BILINMEYEN
// xStock yuzeyi tire kalir (TokenXStock*.ssr.test.js kilitli). Kalip Token.ssr.test.js ile AYNI.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosPostMock = vi.fn()
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))

// Bakiye testten degistirilir (2 token, NaN, hata). Native ('0x0') adres: ERC-20 decimals() dali calismaz.
const bakiyeOku = vi.hoisted(() => ({ fn: null }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => bakiyeOku.fn(...args) }))

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { yorumsuzHtml } from '../test-utils/ssrHtmlYardimcilari.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { currencyStore } from '../store/currency'
import Token from './Token.vue'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const TIRE = '\u2014'

// Bosluklu biciler dilde nbsp (U+00A0) / dar nbsp (U+202F) kullanir: duz boslukla karsilastirilir.
const norm = (s) => (typeof s === 'string' ? s.replace(/[\u00a0\u202f]/g, ' ') : s)

const govdeMetni = (html, desen) => {
    const eslesme = html.match(desen)
    return eslesme ? norm(eslesme[1].replace(/\s+/g, ' ').trim()) : null
}
const baslikFiyati = (html) => govdeMetni(html, /<h1[^>]*>([\s\S]*?)<\/h1>/)
const degerKutusu = (html) => govdeMetni(html, /<p[^>]*text-indigo-600[^>]*font-mono[^>]*>([\s\S]*?)<\/p>/)
// Piyasa verisi satiri: etiket span'inin hemen ardindaki deger span'i.
const piyasaSatiri = (html, etiket) => govdeMetni(html, new RegExp('>\\s*' + etiket + '\\s*</span>\\s*<span[^>]*>([\\s\\S]*?)</span>'))

const mockTokenRecord = (marketData = {}, overrides = {}) => ({
    name: 'USD Coin',
    symbol: 'usdc',
    coingecko_id: 'usd-coin',
    image: { thumb: '', large: '' },
    address: '0x0',
    market_data: {
        priceUSD: 10,
        market_cap: 1000,
        volume: 500,
        circulating_supply: 1000,
        ath: 12,
        atl: 8,
        change: { h24: 0.1 },
        sparkline: { d7: [] },
        ...marketData,
    },
    ...overrides,
})

afterEach(() => {
    axiosPostMock.mockReset()
    delete globalThis.chrome
})

const tazeKur = (rates) => {
    const now = Date.now()
    return { rates, currencies: [], updatedAt: now, stale: false, fetchedAt: now }
}

// `marketData`: kayitin market_data'sina eklenir/ezer (undefined deger alani siler). `hazirla(store)`: secili birim.
async function ciz({ marketData = {}, bakiye = async () => 2, hazirla, locale = 'en' } = {}) {
    const kayit = mockTokenRecord(marketData)
    axiosPostMock.mockResolvedValue({ status: 200, data: { token: kayit } })
    bakiyeOku.fn = vi.fn(bakiye)

    installChromeStub({
        currentNetwork: ETH_CHAIN,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001' },
    })
    const app = createApp(Token, { props: { id: 'usd-coin' } })
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    networkStore().currentNetwork = ETH_CHAIN
    cryptoStore().selected_token_ref = { id: 'usd-coin', chainId: 1, address: '0x0' }
    hazirla?.(currencyStore())

    return yorumsuzHtml(await render(app))
}

describe('Token.vue (SSR) - para birimi: USD (varsayilan)', () => {
    it('baslik fiyati price stilinde: cok kucuk fiyat $0.00 degil $0.000008', async () => {
        const html = await ciz({ marketData: { priceUSD: 0.000008 } })
        expect(baslikFiyati(html)).toBe('$0.000008')
    })

    it('baslik fiyati, deger kutusu ve ATH / ATL standart tutar: $10.00, 2 x 10 = $20.00', async () => {
        const html = await ciz({ marketData: { priceUSD: 10, ath: 69000.5, atl: 0.00001234 } })
        expect(baslikFiyati(html)).toBe('$10.00')
        expect(degerKutusu(html)).toBe('$20.00')
        expect(piyasaSatiri(html, 'ATH \\(Highest\\)')).toBe('$69,000.50')
        expect(piyasaSatiri(html, 'ATL \\(Lowest\\)')).toBe('$0.000012')
    })

    it('piyasa degeri ve hacim compact: $1.23B ve $4.5M', async () => {
        const html = await ciz({ marketData: { market_cap: 1.23e9, volume: 4.5e6 } })
        expect(piyasaSatiri(html, 'Market Cap')).toBe('$1.23B')
        expect(piyasaSatiri(html, '24h Volume')).toBe('$4.5M')
    })

    it('dolasimdaki arz para degil: sembol yok, token adediyle yazilir', async () => {
        const html = await ciz({ marketData: { circulating_supply: 1234567 } })
        expect(piyasaSatiri(html, 'Circulating Supply')).toBe('1,234,567 USDC')
    })
})

describe('Token.vue (SSR) - para birimi: gecersiz deger sifir bicimini basar', () => {
    // Bugun 0.00 / 0 basan yuzeyler: `null` sablonda BOS render edilir, "NaN" / "undefined" yazilmaz.
    it('market_cap / volume / ath / atl hic yok -> hepsi $0.00', async () => {
        const html = await ciz({ marketData: { market_cap: undefined, volume: undefined, ath: undefined, atl: undefined } })
        expect(piyasaSatiri(html, 'Market Cap')).toBe('$0.00')
        expect(piyasaSatiri(html, '24h Volume')).toBe('$0.00')
        expect(piyasaSatiri(html, 'ATH \\(Highest\\)')).toBe('$0.00')
        expect(piyasaSatiri(html, 'ATL \\(Lowest\\)')).toBe('$0.00')
    })

    it('market_cap / volume / ath / atl 0 ya da null -> hepsi $0.00', async () => {
        for (const bos of [0, null]) {
            const html = await ciz({ marketData: { market_cap: bos, volume: bos, ath: bos, atl: bos } })
            expect(piyasaSatiri(html, 'Market Cap')).toBe('$0.00')
            expect(piyasaSatiri(html, '24h Volume')).toBe('$0.00')
            expect(piyasaSatiri(html, 'ATH \\(Highest\\)')).toBe('$0.00')
            expect(piyasaSatiri(html, 'ATL \\(Lowest\\)')).toBe('$0.00')
        }
    })

    it('priceUSD yok -> baslik fiyati $0.00 (bos degil)', async () => {
        const html = await ciz({ marketData: { priceUSD: undefined } })
        expect(baslikFiyati(html)).toBe('$0.00')
    })

    it('shownUsdBalance NaN -> deger kutusu $0.00', async () => {
        const html = await ciz({ bakiye: async () => NaN })
        expect(degerKutusu(html)).toBe('$0.00')
    })

    it('hicbir yuzeyde NaN / undefined / null / Infinity yazilmaz', async () => {
        const html = await ciz({
            marketData: { priceUSD: undefined, market_cap: NaN, volume: Infinity, ath: null, atl: undefined },
            bakiye: async () => NaN,
        })
        const govde = baslikFiyati(html) + degerKutusu(html) + ['Market Cap', '24h Volume', 'ATH \\(Highest\\)', 'ATL \\(Lowest\\)'].map((e) => piyasaSatiri(html, e)).join('')
        expect(govde).not.toMatch(/NaN|undefined|null|Infinity/)
        expect(govde).not.toMatch(/e\+\d/)
    })

    it('bakiye okunamadiysa deger kutusu tire kalir ($0.00 degil)', async () => {
        const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const html = await ciz({ bakiye: async () => { throw new Error('rpc down') } })
        expect(degerKutusu(html)).toBe(TIRE)
        uyari.mockRestore()
    })
})

describe('Token.vue (SSR) - para birimi: secili birim', () => {
    // en dilinde TRY sembolu "TRY" yazilir (₺ yalniz tr dilinde); sembol sinamasi icin EUR.
    it('eur ve kur taze: fiyat, deger, piyasa degeri, ATH secili birimde (kur 2)', async () => {
        const html = await ciz({
            marketData: { priceUSD: 10, market_cap: 1e9, ath: 12 },
            hazirla: (store) => { store.code = 'eur'; store.snapshot = tazeKur({ eur: 2 }) },
        })
        expect(baslikFiyati(html)).toBe('€20.00')
        expect(degerKutusu(html)).toBe('€40.00')
        expect(piyasaSatiri(html, 'Market Cap')).toBe('€2B')
        expect(piyasaSatiri(html, 'ATH \\(Highest\\)')).toBe('€24.00')
        expect(html).not.toContain('$')
    })

    it('uygulama dili tr: tutar tr bicimiyle yazilir', async () => {
        const html = await ciz({
            locale: 'tr',
            marketData: { priceUSD: 10 },
            hazirla: (store) => { store.code = 'try'; store.snapshot = tazeKur({ try: 40 }) },
        })
        expect(baslikFiyati(html)).toBe('₺400,00')
    })

    it('kur yok -> USD ve kod etiketli ("USD 10.00"); eski kurla sembol basilmaz', async () => {
        const html = await ciz({
            marketData: { priceUSD: 10, market_cap: 2e6 },
            hazirla: (store) => { store.code = 'try'; store.snapshot = null },
        })
        expect(baslikFiyati(html)).toBe('USD 10.00')
        expect(degerKutusu(html)).toBe('USD 20.00')
        expect(piyasaSatiri(html, 'Market Cap')).toBe('USD 2M')
        expect(html).not.toContain('₺')
    })

    it('ondaliksiz birim (jpy): sifir olmayan kucuk fiyat ¥0 gorunmez', async () => {
        const html = await ciz({
            marketData: { priceUSD: 0.00005 },
            hazirla: (store) => { store.code = 'jpy'; store.snapshot = tazeKur({ jpy: 150 }) },
        })
        expect(baslikFiyati(html)).not.toBe('¥0')
        expect(baslikFiyati(html)).toMatch(/^¥0\.0\d+/)
    })

    it('secili birimde gecersiz deger o birimin sifirini basar (eur -> €0.00)', async () => {
        const html = await ciz({
            marketData: { market_cap: undefined, ath: undefined, priceUSD: undefined },
            hazirla: (store) => { store.code = 'eur'; store.snapshot = tazeKur({ eur: 2 }) },
        })
        expect(baslikFiyati(html)).toBe('€0.00')
        expect(piyasaSatiri(html, 'Market Cap')).toBe('€0.00')
        expect(piyasaSatiri(html, 'ATH \\(Highest\\)')).toBe('€0.00')
    })
})

describe('Token.vue (SSR) - para birimi: kaynak kilidi', () => {
    const kaynak = readFileSync(fileURLToPath(new URL('./Token.vue', import.meta.url)), 'utf8')

    it('elle yazilmis "$" kalibi ve formatPrice kalmadi', () => {
        expect(kaynak).not.toMatch(/formatPrice/)
        expect(kaynak).not.toMatch(/'\$'\s*\+/)
        expect(kaynak).not.toMatch(/\$\{\{/)
    })

    it('formatCurrency yalniz dolasimdaki arz icin kaldi (token adedi, para degil)', () => {
        // Tanim `formatCurrency = (val) =>` parantezsiz; cagri yalniz sablondaki circulating_supply.
        const cagrilar = kaynak.match(/formatCurrency\(/g) || []
        expect(cagrilar).toHaveLength(1)
        expect(kaynak).toMatch(/formatCurrency\(displayToken\?\.market_data\.circulating_supply\)/)
    })

    it('bilinmeyen xStock fiyati tire kalir, bilinen yuzeyler moneyOrZero ile yazilir', () => {
        expect(kaynak).toMatch(/xStockPriceUnknown\s*\?\s*UNKNOWN_TEXT\s*:\s*moneyOrZero\(displayToken\?\.market_data\.priceUSD,\s*\{\s*style:\s*'price'\s*\}\)/)
        expect(kaynak).toMatch(/moneyOrZero\(displayToken\?\.market_data\.market_cap,\s*\{\s*style:\s*'compact'\s*\}\)/)
        expect(kaynak).toMatch(/moneyOrZero\(displayToken\?\.market_data\.volume,\s*\{\s*style:\s*'compact'\s*\}\)/)
        expect(kaynak).toMatch(/moneyOrZero\(displayToken\?\.market_data\.ath,\s*\{\s*style:\s*'price'\s*\}\)/)
        expect(kaynak).toMatch(/moneyOrZero\(displayToken\?\.market_data\.atl,\s*\{\s*style:\s*'price'\s*\}\)/)
    })
})

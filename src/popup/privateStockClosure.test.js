// E-R12a KILIDI: hisse ekranlari (StockDetail, StockTrade, StockAtsFeeCard -> AtsBuyButton) gizli modda ERISILEMEZ.
//
// Neden bu kilit: VITE_PRIVATE_ATS_SALE=true iken atsPurchaseBlocked(privacy) gizli modda `false` doner (satis acik),
// yani AtsBuyButton Gizli Hesap icin ACIK dugme cizer. main 2a8acd4 ile gelen StockAtsFeeCard AtsBuyButton'u kullanir;
// ekran gizli modda ACILABILIRSE dugme de acilirdi. Dugme kapisi yetmez: EKRAN seviyesinde kapali olmali (sahip karari
// 2026-10-16: hisse ekranlari gizli modda kapali). Uc katman:
//   (a) KAYNAK GRAFIGI: AtsBuyButton'a giden her yol App.vue'daki iki montaj noktasindan gecer ve ikisi de gizli mod
//       kosulunu tasir (yeni bir giris eklenirse bu test kirilir);
//   (b) CALISMA: bayrak ACIKKEN gizli modda App cizimi hisse tokeninde StockDetail / StockTrade baglamaz;
//   (c) KONTROL: ayni kurulum normal modda StockDetail cizer (yoksa "yok" iddiasi bos gecerdi).
// Birim kararlar: stockRoute.test.js; eve donus: xstocksPrivateRouting.test.js; Token.vue: TokenXStock.privateMode.ssr.test.js.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { yorumsuz } from '../test-utils/kaynakTarama'

// App.vue -> Header.vue -> utils/dappFunctions.js zinciri MODUL UST DUZEYINDE chrome.windows.onRemoved.addListener
// cagirir; o satir import ANINDA calisir (appSplash.ssr.test.js ile ayni).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        runtime: { onMessage: { addListener: () => {} }, sendMessage: async () => ({}) },
        storage: {
            local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
            onChanged: { addListener: () => {} },
        },
    }
})

// Ekranlarin ICERIGI degil, rotanin onlari baglayip baglamadigi olculur: ISARETLI saplamalar.
vi.mock('../components/stocks/StockTrade.vue', async () => {
    const { h } = await import('vue')
    return { default: { name: 'StockTrade', render: () => h('div', { 'data-stock-trade': '', 'data-stock-ats-card': '' }) } }
})
vi.mock('../components/stocks/StockDetail.vue', async () => {
    const { h } = await import('vue')
    return { default: { name: 'StockDetail', render: () => h('div', { 'data-stock-detail': '' }) } }
})
vi.mock('../components/Token.vue', async () => {
    const { h } = await import('vue')
    return { default: { name: 'Token', render: () => h('div', { 'data-plain-token': '' }) } }
})

import { createApp, render, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { pageStore } from '../store/pageStore'
import { privacyStore } from '../store/privacy'
import { cryptoStore } from '../store/crypto'
import { PRIVATE_ATS_SALE } from '../utils/featureFlags'
import { atsPurchaseBlocked } from '../utils/atsPurchaseGate'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'
import { XSTOCKS } from '../data/xStocks'
import App from './App.vue'

const SRC = fileURLToPath(new URL('../', import.meta.url))
const BSTOCK_REF = { chainId: BSTOCKS_CHAIN_ID, address: BSTOCKS[0].address }
const XSTOCK = XSTOCKS.find((s) => s.chains.includes(1))
const XSTOCK_REF = { chainId: 1, address: XSTOCK.address }

// --- (a) kaynak grafigi -------------------------------------------------------------------------------------------
function kaynakDosyalari() {
    const out = []
    for (const p of readdirSync(SRC, { recursive: true })) {
        const dosya = String(p).replace(/\\/g, '/')
        if (!/\.(?:vue|js)$/.test(dosya) || /\.test\.js$/.test(dosya) || dosya.startsWith('test-utils/')) continue
        out.push(dosya)
    }
    return out
}

/** dosya -> iceri aldigi .vue dosyalari (goreli import'lar, src'ye gore normalize). */
function vueImportHaritasi() {
    const harita = new Map()
    for (const dosya of kaynakDosyalari()) {
        const kod = yorumsuz(readFileSync(SRC + dosya, 'utf8'))
        const hedefler = []
        for (const m of kod.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+\.vue)['"]/g)) {
            hedefler.push(resolve(dirname(SRC + dosya), m[1]).replace(/\\/g, '/').replace(SRC.replace(/\\/g, '/'), ''))
        }
        harita.set(dosya, hedefler)
    }
    return harita
}

/** `hedef` .vue dosyasini iceri alan dosyalar. */
const iceriAlanlar = (harita, hedef) => [...harita].filter(([, h]) => h.includes(hedef)).map(([d]) => d)

describe('E-R12a (a): AtsBuyButton hisse ekranlarindan YALNIZ App.vue montaj noktalari uzerinden erisilir', () => {
    const harita = vueImportHaritasi()
    const STOK = (d) => d.startsWith('components/stocks/')

    it('grafik taramasi bos degil: AtsBuyButton\'u iceri alan stock dosyalari bulundu (olumlu iddia)', () => {
        const alanlar = iceriAlanlar(harita, 'components/AtsBuyButton.vue')
        expect(alanlar).toEqual(expect.arrayContaining(['components/stocks/StockAtsFeeCard.vue', 'components/stocks/StockTrade.vue']))
    })

    it('StockAtsFeeCard / StockTrade / StockDetail\'i iceri alan dosyalar YALNIZ App.vue ve components/stocks/* dosyalaridir', () => {
        for (const hedef of ['StockAtsFeeCard', 'StockTrade', 'StockDetail']) {
            const alanlar = iceriAlanlar(harita, `components/stocks/${hedef}.vue`)
            expect(alanlar.length, `${hedef} hic import edilmiyor`).toBeGreaterThan(0)
            for (const d of alanlar) expect(d === 'popup/App.vue' || STOK(d), `${hedef} <- ${d}`).toBe(true)
        }
        // Zincirin App.vue'ya ulastigi tek yer: StockDetail ve StockTrade.
        const appHisse = (harita.get('popup/App.vue') || []).filter(STOK).sort()
        expect(appHisse).toEqual(['components/stocks/StockDetail.vue', 'components/stocks/StockTrade.vue'])
    })

    it('stocks disindaki dosyalar (Token, Home, Swap...) StockDetail / StockTrade / StockAtsFeeCard import etmez', () => {
        for (const [d, hedefler] of harita) {
            if (STOK(d) || d === 'popup/App.vue') continue
            for (const h of hedefler) expect(h, `${d} -> ${h}`).not.toMatch(/^components\/stocks\/(?:StockDetail|StockTrade|StockAtsFeeCard)\.vue$/)
        }
    })

    it('App.vue iki montaj noktasi da gizli mod kosulunu tasir (StockDetail isStockPage ile, StockTrade !privacy.active ile)', () => {
        const app = yorumsuz(readFileSync(SRC + 'popup/App.vue', 'utf8'))
        const sablon = app.split('<script')[0]
        expect(sablon.split('<StockDetail').length - 1).toBe(1)
        expect(sablon.split('<StockTrade').length - 1).toBe(1)
        expect(sablon).toMatch(/<StockTrade v-if="!privacy\.active && page\.currentPage === 'stock_trade'"/)
        expect(sablon).toMatch(/<StockDetail v-if="page\.currentPage === 'token' && isStockPage"/)
        expect(app).toContain('stockEntryForRef(crypto.selected_token_ref, { privateMode: privacy.active })')
    })

    it('StockTrade.vue kokunu gizli modda cizmez (ek savunma)', () => {
        const trade = yorumsuz(readFileSync(SRC + 'components/stocks/StockTrade.vue', 'utf8'))
        expect(trade).toMatch(/<div v-if="!privacy\.active" data-stock-trade\b/)
    })
})

// --- (b) + (c) calisma --------------------------------------------------------------------------------------------
function renderApp({ page: sayfa, ref, privateActive }) {
    const pinia = createTestPinia()
    const page = pageStore()
    page.currentPage = sayfa
    page.firstLoadDone = true
    cryptoStore().selected_token_ref = ref
    privacyStore().active = privateActive
    const app = createApp(App)
    app.use(pinia)
    app.use(createTestI18n())
    return render(app)
}

afterEach(() => { vi.unstubAllGlobals() })

describe('E-R12a (b): VITE_PRIVATE_ATS_SALE acikken gizli modda hisse ekranlari ve ATS karti baglanmaz', () => {
    it('onkosul: vitest varsayilaninda satis bayragi ACIK ve gizli modda ATS dugme kapisi KAPALI degil (risk gercek)', () => {
        expect(PRIVATE_ATS_SALE).toBe(true)
        expect(atsPurchaseBlocked({ active: true })).toBe(false)
    })

    it.each([['bStock', BSTOCK_REF], ['xStock', XSTOCK_REF]])('%s tokeni, gizli mod: StockDetail ve ATS karti YOK, siradan Token ekrani cizilir', async (_ad, ref) => {
        const html = await renderApp({ page: 'token', ref, privateActive: true })

        expect(html).toContain('data-plain-token')
        expect(html).not.toContain('data-stock-detail')
        expect(html).not.toContain('data-stock-ats-card')
        expect(html).not.toContain('data-stock-trade')
    })

    it('stock_trade sayfasi, gizli mod: hicbir sey cizilmez (Al/Sat ve ATS karti baglanmaz)', async () => {
        const html = await renderApp({ page: 'stock_trade', ref: BSTOCK_REF, privateActive: true })

        expect(html).not.toContain('data-stock-trade')
        expect(html).not.toContain('data-stock-ats-card')
        expect(html).not.toContain('data-stock-detail')
    })
})

describe('E-R12a (c): KONTROL -- normal modda main davranisi ayni', () => {
    it('bStock tokeni, normal mod: StockDetail cizilir, siradan Token cizilmez', async () => {
        const html = await renderApp({ page: 'token', ref: BSTOCK_REF, privateActive: false })

        expect(html).toContain('data-stock-detail')
        expect(html).not.toContain('data-plain-token')
    })

    it('xStock tokeni, normal mod (bayrak testlerde acik): StockDetail cizilir', async () => {
        const html = await renderApp({ page: 'token', ref: XSTOCK_REF, privateActive: false })

        expect(html).toContain('data-stock-detail')
    })

    it('stock_trade sayfasi, normal mod: Al/Sat ekrani baglanir', async () => {
        const html = await renderApp({ page: 'stock_trade', ref: BSTOCK_REF, privateActive: false })

        expect(html).toContain('data-stock-trade')
    })
})

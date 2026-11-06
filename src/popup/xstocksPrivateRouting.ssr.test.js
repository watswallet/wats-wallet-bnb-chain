// xStocks Al / Sat EKRANI gizli modda KAPALI (sahip karari 2026-10-16): App.vue ekrani gizli modda hic BAGLAMAZ.
// Kalip appSplash.ssr.test.js ile AYNI (App.vue gercek SSR cizimi); StockTrade.vue ISARETLI bir saplamayla degistirilir:
// olculen sey ekranin ICERIGI degil, rotanin onu baglayip baglamadigidir. Kaynak-sekil kilitleri ve eve donus
// izleyicisi: xstocksPrivateRouting.test.js.
import { describe, it, expect, afterEach, vi } from 'vitest'

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

vi.mock('../components/stocks/StockTrade.vue', async () => {
    const { h } = await import('vue')
    return { default: { name: 'StockTrade', render: () => h('div', { 'data-stock-trade-screen': '' }) } }
})

import { createApp, render, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { pageStore } from '../store/pageStore'
import { privacyStore } from '../store/privacy'
import App from './App.vue'

function renderAt(currentPage, { privateActive }) {
    const pinia = createTestPinia()
    const page = pageStore()
    page.currentPage = currentPage
    page.firstLoadDone = true
    privacyStore().active = privateActive
    const app = createApp(App)
    app.use(pinia)
    app.use(createTestI18n())
    return render(app)
}

afterEach(() => { vi.unstubAllGlobals() })

describe('App.vue (SSR) -- xStocks Al / Sat ekrani, gizli mod', () => {
    it('normal modda stock_trade sayfasi Al / Sat ekranini baglar (regresyon: bayrak testlerde acik)', async () => {
        expect(await renderAt('stock_trade', { privateActive: false })).toContain('data-stock-trade-screen')
    })

    it('gizli modda stock_trade sayfasi Al / Sat ekranini BAGLAMAZ', async () => {
        const html = await renderAt('stock_trade', { privateActive: true })

        expect(html).not.toContain('data-stock-trade-screen')
    })
})

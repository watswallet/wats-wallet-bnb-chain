// KOK NEDEN / KAPATILAN HATA (K32, K37; Task 41): beyan kalkti, "Hisse beyanlari" ayar satiri ve gittigi sayfa (settings_stock_declarations)
// ulasilamaz oldu. Satir kalirsa kullanici bos / olu bir ekrana gider; satiri silerken yanlislikla yanindaki Genel satirlari
// (hesaplar, tercihler, adres defteri) ya da Hakkinda satiri da gidebilir. Bu dosya ikisini de kilitler.
// Eski Settings.stockDeclarations.ssr.test.js'in yerini alir (XSTOCKS bayragi KAPALI vi.mock kalibi korunur: Settings.vue
// bayraga baglanmaz, bayrak kapaliyken de satirlar ayni).
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bayrak KAPALI: xStocks yuzeyi kapaliyken de Genel / Hakkinda satirlari yerinde olmali (StockTrade.flagOff.ssr.test.js kalibi).
vi.mock('../utils/featureFlags', async (importOriginal) => ({
    ...(await importOriginal()),
    XSTOCKS_ENABLED: false,
}))

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { yorumsuz } from '../test-utils/kaynakTarama'
import { yorumsuzHtml, butonlar } from '../test-utils/ssrHtmlYardimcilari'
import { pageStore } from '../store/pageStore'
import Settings from './Settings.vue'

const here = dirname(fileURLToPath(import.meta.url))
const KAYNAK = readFileSync(join(here, 'Settings.vue'), 'utf8')

const KACIS = { '"': '&quot;', '&': '&amp;', "'": '&#39;', '<': '&lt;', '>': '&gt;' }
const esc = (s) => String(s).replace(/["&'<>]/g, (c) => KACIS[c])

afterEach(() => {
    delete globalThis.chrome
})

async function ciz(locale = 'en') {
    installChromeStub({ user: { username: 'tester' }, dapps: {}, vaults: [] })
    const app = createApp(Settings)
    app.use(createTestPinia())
    const i18n = createTestI18n(locale)
    app.use(i18n)
    pageStore().currentPage = 'settings'
    const html = yorumsuzHtml(await render(app))
    return { html, i18n }
}

describe('Settings (SSR) -- beyan satiri kalkti, mevcut satirlar yerinde (XSTOCKS bayragi KAPALIYKEN)', () => {
    it.each(['en', 'tr'])('%s: Hisse beyanlari satiri (data-settings-stock-declarations) yok', async (locale) => {
        const { html, i18n } = await ciz(locale)
        expect(html).not.toContain('data-settings-stock-declarations')
        expect(html).not.toContain('settings_stock_declarations')
        expect(html).not.toContain(esc(i18n.global.t('settings.stockDeclarations.title')))
        expect(butonlar(html).find((b) => b.nitelikler.includes('data-settings-stock-declarations'))).toBeUndefined()
    })

    it('mevcut Genel satirlari (hesaplar, tercihler, adres defteri) yerinde ve Adres defteri Guvenlik grubundan ONCE', async () => {
        const { html, i18n } = await ciz()
        for (const k of ['settings.manageAccounts', 'settings.preferences.title', 'settings.addressBook']) {
            expect(html, k).toContain(esc(i18n.global.t(k)))
        }
        const adres = html.indexOf(esc(i18n.global.t('settings.addressBook')))
        const guvenlik = html.indexOf(esc(i18n.global.t('settings.security.title')))
        expect(guvenlik).toBeGreaterThan(adres)
    })

    it('Hakkinda satiri duruyor (settings_about sayfasina gider)', async () => {
        const { html, i18n } = await ciz()
        const hakkinda = butonlar(html).find((b) => b.metin === esc(i18n.global.t('settings.about.title')))
        expect(hakkinda, 'Hakkinda satiri yok').toBeDefined()
        expect(yorumsuz(KAYNAK)).toMatch(/@click="page\.currentPage = 'settings_about'"/)
    })
})

describe('Settings -- kaynak', () => {
    const kod = yorumsuz(KAYNAK)

    it('beyan satirinin izi yok: settings_stock_declarations, data-settings-stock-declarations, stockDeclarations', () => {
        expect(kod).toContain("page.currentPage = 'settings_about'") // pozitif bekci: tarama gercek kaynagi goruyor
        expect(kod).not.toMatch(/settings_stock_declarations|data-settings-stock-declarations|stockDeclarations/)
    })

    it('Settings.vue XSTOCKS bayragina BAGLI DEGIL', () => {
        expect(kod).not.toContain('featureFlags')
        expect(kod).not.toContain('XSTOCKS_ENABLED')
    })
})

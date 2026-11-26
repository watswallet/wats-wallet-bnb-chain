// KOK NEDEN / KAPATILAN HATA (K18): DB-IP IP-to-Country Lite verisi CC BY 4.0 ile kullanilir ve atif ister
// ("IP Geolocation by DB-IP", db-ip.com'a baglanti). Atif yalniz beyan ekraninda kalirsa Hakkinda sayfasi eksik
// kalir; ikisi de gerekir (spec 6.6: DB-IP'nin "veriyi kullanan sayfa" sartinin tam kapsami hukuken teyit edilmedi,
// iki yer bu belirsizlige karsi). Mevcut uc yasal baglanti (web sitesi, gizlilik, kosullar) DEGISMEZ.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js).
import { describe, it, expect, vi } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { yorumsuzHtml } from '../../test-utils/ssrHtmlYardimcilari'
import About from './About.vue'

const KACIS = { '"': '&quot;', '&': '&amp;', "'": '&#39;', '<': '&lt;', '>': '&gt;' }
const esc = (s) => String(s).replace(/["&'<>]/g, (c) => KACIS[c])

async function ciz(locale = 'en') {
    const app = createApp(About)
    app.use(createTestPinia())
    const i18n = createTestI18n(locale)
    app.use(i18n)
    return { html: yorumsuzHtml(await render(app)), i18n }
}

const baglantilar = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, nitelikler, govde]) => ({
    nitelikler,
    href: (nitelikler.match(/href="([^"]*)"/) || [])[1],
    metin: govde.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
}))

describe('About (SSR) -- DB-IP atfi (K18)', () => {
    it.each(['en', 'tr'])('%s: atif baglantisi var, db-ip.com a gider, _blank ve rel="noopener noreferrer"', async (locale) => {
        const { html, i18n } = await ciz(locale)
        const atif = baglantilar(html).find((b) => b.nitelikler.includes('data-about-dbip'))
        expect(atif).toBeDefined()
        expect(atif.href).toBe('https://db-ip.com')
        expect(atif.nitelikler).toContain('target="_blank"')
        expect(atif.nitelikler).toContain('rel="noopener noreferrer"')
        expect(atif.metin).toBe(esc(i18n.global.t('settings.about.dbIp')))
        expect(atif.metin).toContain('IP Geolocation by DB-IP')
        // Hakkinda ile beyan ekrani dipnotu AYNI metni tasir (iki yer, tek atif).
        expect(atif.metin).toBe(esc(i18n.global.t('stockGate.attribution')))
    })

    it('mevcut yasal baglantilar korunur (web sitesi, gizlilik, kosullar) ve atif onlarin ARASINA girmez', async () => {
        const { html } = await ciz()
        const hepsi = baglantilar(html)
        const hreflar = hepsi.map((b) => b.href)
        expect(hreflar).toContain('https://watswallet.com')
        expect(hreflar).toContain('https://watswallet.github.io/privacy-policy/')
        expect(hreflar).toContain('https://alltoscan.github.io/extension-terms-of-service/extension-terms-of-service.txt')
        expect(hreflar).toContain('https://x.com/watswallet')
        expect(hepsi.filter((b) => b.href === 'https://db-ip.com')).toHaveLength(1)
    })

    it('atif satiri yasal baglantilar blogunun ALTINDA (siralama)', async () => {
        const { html } = await ciz()
        const yasalSon = html.lastIndexOf('extension-terms-of-service.txt')
        const atif = html.indexOf('data-about-dbip')
        expect(yasalSon).toBeGreaterThan(-1)
        expect(atif).toBeGreaterThan(yasalSon)
    })
})

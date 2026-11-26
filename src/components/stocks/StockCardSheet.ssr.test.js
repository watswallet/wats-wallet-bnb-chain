// StockCardSheet.vue (Ilk Alim Kapisi, Task 42, K38): salt okunur "Ne sahip oluyorsun" karti.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
//
// KOK NEDEN / KAPATILAN HATA: kart beyan ekranina gomuluydu; beyan kalkinca kartin onay / kayit / rizasiz yeni bir evi
// gerekiyor. Kart yalniz AYNADIR: yerel `open` ile acilan alt sayfa; mesaj, depo, sayfa kaydi, returnPage yok;
// gecersiz ihracci ya da open false iken HICBIR sey cizilmez.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { yorumsuzHtml } from '../../test-utils/ssrHtmlYardimcilari.js'
import StockCardSheet from './StockCardSheet.vue'

const KAYNAK = readFileSync(fileURLToPath(new URL('./StockCardSheet.vue', import.meta.url)), 'utf8')
const ISSUERS = ['bstocks', 'xstocks']
const LOCALES = ['tr', 'en']

const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const t = (locale, key, params) => createTestI18n(locale).global.t(key, params)

async function ciz({ issuer = 'bstocks', open = true, locale = 'tr' } = {}) {
    const app = createApp(StockCardSheet, { props: { issuer, open }, use: [createTestPinia(), createTestI18n(locale)] })
    // SSR ciktisi sablon yorumlarini tasir (icinde veri kanca adlari var): iddialardan ONCE atilir (G3)
    return yorumsuzHtml(await render(app))
}
// Metin sirasi: html dizgesindeki ilk konum (kodlanmis metin ayni kodlamayla aranir)
const KACIS = { '"': '&quot;', '&': '&amp;', "'": '&#39;', '<': '&lt;', '>': '&gt;' }
const esc = (s) => String(s).replace(/["&'<>]/g, (c) => KACIS[c])

afterEach(() => { delete globalThis.chrome })

describe.each(ISSUERS)('kart -- %s', (issuer) => {
    it.each(LOCALES)('kart: baslik, s1..s8, scope, notIssuer, locationNote, atif sirasiyla cizilir; s9 yok (%s)', async (locale) => {
        const html = await ciz({ issuer, locale })
        expect(html).toContain(`data-stock-card="${issuer}"`)
        const sira = [
            t(locale, `stockGate.card.${issuer}.title`),
            ...Array.from({ length: 8 }, (_, i) => t(locale, `stockGate.card.${issuer}.s${i + 1}`)),
            t(locale, 'stockGate.card.scope'),
            t(locale, 'stockGate.card.notIssuer'),
            t(locale, 'stockGate.card.locationNote'),
            t(locale, 'stockGate.attribution'),
        ]
        let onceki = -1
        for (const metin of sira) {
            expect(metin.length, 'pozitif bekci: metin bos degil').toBeGreaterThan(10)
            const konum = html.indexOf(esc(metin))
            expect(konum, metin.slice(0, 40)).toBeGreaterThan(onceki)
            onceki = konum
        }
        expect(html.match(/<li\b/g)).toHaveLength(8)
    })

    it('kart: ihracci rozeti baslik yaninda (home.stockBadge*) ve kapat dugmesi var', async () => {
        const html = await ciz({ issuer })
        const rozet = issuer === 'xstocks' ? 'home.stockBadgeXstocks' : 'home.stockBadgeBstocks'
        expect(html).toMatch(new RegExp(`data-stock-card-badge="${issuer}"[^>]*>${esc(t('tr', rozet))}<`))
        expect(html).toContain('data-stock-card-close')
        expect(html).toContain('data-stock-card-location')
    })
})

describe('kart -- K43 uzantisi', () => {
    // K43 uzantisi (2026-11-14, "kart da gitsin"): xStocks kartinda Turkiye / yerel mevzuat cumlesi yok; diger maddeler duruyor
    it.each(LOCALES)('kart: xStocks s7 Turkiye yerel mevzuat cumlesini tasimaz, s1..s8 yine cizilir (%s)', async (locale) => {
        const ham = await ciz({ issuer: 'xstocks', locale })
        const html = decode(ham)
        expect(html).not.toMatch(/yerel mevzuata|local law in T/)
        expect(html).not.toContain('Türkiye bu listelerde')
        expect(html).not.toContain('Türkiye is not named')
        expect(html).toContain('xstocks.fi') // pozitif bekci: s7 ihracci olgulari duruyor
        expect(ham.match(/<li\b/g)).toHaveLength(8)
        for (let n = 1; n <= 8; n++) expect(html, `s${n}`).toContain(decode(esc(t(locale, `stockGate.card.xstocks.s${n}`))))
    })
})

describe('kart -- yasaklar', () => {
    it('kart: onay kutusu, ulke secici, gonder / kabul dugmesi YOK (input, select, type=checkbox, data-gate-country-*, data-gate-ack yok)', async () => {
        for (const issuer of ISSUERS) {
            const html = await ciz({ issuer })
            expect(html.length, 'pozitif bekci').toBeGreaterThan(500)
            expect(html).not.toMatch(/<input\b/)
            expect(html).not.toMatch(/<select\b/)
            expect(html).not.toContain('type="checkbox"')
            expect(html).not.toContain('data-gate-country')
            expect(html).not.toContain('data-gate-ack')
            expect(html).not.toContain('data-gate-submit')
            // tek dugme: kapat
            expect(html.match(/<button\b/g)).toHaveLength(1)
        }
    })

    // Kart metni yalniz bstocks / xstocks icin vardir (ISSUER_CARD_KEYS). Bicimi gecersiz adlar bos cikti verir; bicimi gecerli
    // ama kart metni olmayan ihracci (yeni LCX ihraccilari, tabloda olmayan ad, miras ad) da bos cikti verir: kart bolumu yok, hata yok.
    it('kart: open false ya da issuer gecersiz (dizi, Dogecoin, null) -> bos cikti', async () => {
        expect(await ciz({ issuer: 'bstocks', open: false })).toBe('')
        expect(await ciz({ issuer: 'xstocks', open: false })).toBe('')
        for (const issuer of [['bstocks'], 'Dogecoin', null, '__proto__', 'BSTOCKS']) {
            expect(await ciz({ issuer, open: true }), String(issuer)).toBe('')
        }
        // pozitif bekci: gecerli + acik cizer
        expect(await ciz({ issuer: 'bstocks', open: true })).not.toBe('')
    })

    it.each(['coinbase', 'ondo', 'robinhood', 'st0x', 'dogecoin', 'foo', 'constructor', 'toString'])(
        'kart: bicimi gecerli ama kart metni olmayan ihracci (%s) icin kart bolumu YOK ve hata yok (bos cikti, ham ceviri anahtari yok)', async (issuer) => {
            for (const locale of LOCALES) {
                const html = await ciz({ issuer, open: true, locale })
                expect(html, `${issuer}/${locale}`).toBe('')
            }
        })

    it('kart: kart metni olan ihracci kumesi bilesen ici ISSUER_CARD_KEYS = [bstocks, xstocks]; uyelik dizi uyeligiyle sinanir', () => {
        const kod = yorumsuz(KAYNAK)
        expect(kod).toMatch(/const ISSUER_CARD_KEYS = \['bstocks', 'xstocks'\]/)
        expect(kod).toContain('ISSUER_CARD_KEYS.includes(props.issuer)')
        // bicim kontrolu (isValidIssuer) ihracci kumesi acildigindan beri "kart var mi" sorusunu CEVAPLAMAZ: bilesen onu kullanmaz
        expect(kod).not.toContain('isValidIssuer')
    })

    it('kart: kaynakta sendMessage, chrome.storage, currentPage, pageStore.data, returnPage yok (yorumsuz tarama)', () => {
        const kod = yorumsuz(KAYNAK)
        expect(kod.length, 'pozitif bekci: kaynak bos degil').toBeGreaterThan(1000)
        expect(kod).toContain('defineProps')
        for (const yasak of ['sendMessage', 'chrome.', 'storage', 'currentPage', 'pageStore', '.data', 'returnPage']) {
            expect(kod, yasak).not.toContain(yasak)
        }
    })

    it('kart: acilis yalniz ust bilesenin open propuyla (kaynakta open atamasi yok; setup / onMounted acmaz)', () => {
        const kod = yorumsuz(KAYNAK)
        expect(kod).not.toMatch(/\bopen\s*=[^=]/)
        expect(kod).not.toMatch(/\.open\s*=[^=]/)
        expect(kod).toContain('props.open === true')
    })
})

describe('kart -- DB-IP atfi', () => {
    it.each(LOCALES)('kart: atif <a> hrefi https://db-ip.com ve rel noopener noreferrer; metin "IP Geolocation by DB-IP" VERBATIM (%s)', async (locale) => {
        const html = await ciz({ locale })
        const a = html.match(/<a\b[^>]*data-gate-attribution[^>]*>([\s\S]*?)<\/a>/)
        expect(a, 'atif baglantisi var').not.toBeNull()
        expect(a[0]).toContain('href="https://db-ip.com"')
        expect(a[0]).toContain('target="_blank"')
        expect(a[0]).toContain('rel="noopener noreferrer"')
        expect(decode(a[1]).trim()).toBe('IP Geolocation by DB-IP')
    })

    it('kart: "IP\'yi saklamiyoruz" cumlesi eklenmez (nginx gunlugu dogrulanana kadar)', async () => {
        for (const locale of LOCALES) {
            const m = decode(await ciz({ locale }))
            expect(m).not.toMatch(/saklam[iı]yoruz|do not store|don't store|not stored/i)
        }
    })
})

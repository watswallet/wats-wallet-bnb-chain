// CurrencyPicker.vue -- aranabilir para birimi listesi. GERCEK vue/server-renderer ile
// render edilir (bkz. src/test-utils/ssrRender.js). Yazma (arama kutusu) SSR'da
// yapilamaz: `query` ic durumu captureInstance'in onCapture kancasindan verilir.
import { describe, it, expect, vi } from 'vitest'
import { createApp, captureInstance, render, createTestI18n } from '../../test-utils/ssrRender.js'
import CurrencyPicker from './CurrencyPicker.vue'

// Sunucu listesi gibi: BUYUK harfli kod, karisik sira.
const LIST = [
    { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
    { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
    { code: 'AED', name: 'United Arab Emirates Dirham', symbol: 'AED' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'USD', name: 'US Dollar', symbol: '$' },
]

// Picker savunma olarak da suzer: hariclar listeye sizsa bile gorunmez.
const HARIC = [
    { code: 'VEF', name: 'Venezuelan Bolivar', symbol: 'Bs' },
    { code: 'XDR', name: 'Special Drawing Rights', symbol: 'XDR' },
]

// `ic`: onCapture -- bilesenin ic durumunu (query) render'dan ONCE yazar.
function kur({ currencies = LIST, selected = 'usd', locale = 'en', ic, dinleyiciler = {} } = {}) {
    const app = createApp(CurrencyPicker, { props: { currencies, selected, ...dinleyiciler } })
    app.use(createTestI18n(locale))
    const captured = captureInstance(app, 'CurrencyPicker', ic)
    return { app, captured }
}

async function goster(secenekler) {
    const { app, captured } = kur(secenekler)
    const html = await render(app)
    return { html, captured }
}

// Etiketleri atip bosluklari tek bosluga indirir: satirin GORUNEN metni.
const metin = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

// `data-currency="kod"` tasiyan satirin (button) HTML'i.
function satir(html, kod) {
    const isaret = `data-currency="${kod}"`
    const orta = html.indexOf(isaret)
    if (orta < 0) return null
    const bas = html.lastIndexOf('<button', orta)
    return html.slice(bas, html.indexOf('</button>', orta) + '</button>'.length)
}

const konum = (html, kod) => html.indexOf(`data-currency="${kod}"`)

describe('CurrencyPicker.vue -- liste sirasi', () => {
    it('populer once: usd, eur, try sirasi; vef/xdr listede olsa bile gorunmez', async () => {
        const { html } = await goster({ currencies: [...HARIC, ...LIST] })

        expect(konum(html, 'usd')).toBeGreaterThan(-1)
        expect(konum(html, 'usd')).toBeLessThan(konum(html, 'eur'))
        expect(konum(html, 'eur')).toBeLessThan(konum(html, 'try'))
        // jpy da populer (try'dan sonra); populer olmayan chf/aed hepsinden sonra gelir.
        expect(konum(html, 'try')).toBeLessThan(konum(html, 'jpy'))
        expect(konum(html, 'jpy')).toBeLessThan(konum(html, 'aed'))
        // Populer olmayanlar koda gore sirali.
        expect(konum(html, 'aed')).toBeLessThan(konum(html, 'chf'))

        expect(konum(html, 'vef')).toBe(-1)
        expect(konum(html, 'xdr')).toBe(-1)
        expect(html).not.toContain('Venezuelan')
        expect(html).not.toContain('Special Drawing')
    })

    it('ayni kod iki kez gelirse (EUR + eur) tek satir cizilir', async () => {
        const { html } = await goster({
            currencies: [
                { code: 'EUR', name: 'Euro', symbol: '€' },
                { code: 'eur', name: 'Euro kopya', symbol: '€' },
            ],
        })
        expect(html.split('data-currency="eur"').length - 1).toBe(1)
        expect(html).not.toContain('Euro kopya')
    })

    it('"Populer" ve "Tum para birimleri" basliklari var; populerler ilk basligin altinda', async () => {
        const { html } = await goster()
        const duz = metin(html)

        expect(duz).toContain('Popular')
        expect(duz).toContain('All currencies')
        expect(duz.indexOf('Popular')).toBeLessThan(duz.indexOf('All currencies'))
        // usd (populer) "All currencies" basligindan once, aed (populer degil) sonra.
        expect(html.indexOf('Popular')).toBeLessThan(konum(html, 'usd'))
        expect(konum(html, 'usd')).toBeLessThan(html.indexOf('All currencies'))
        expect(html.indexOf('All currencies')).toBeLessThan(konum(html, 'aed'))
    })

    it('turkce arayuzde basliklar turkce', async () => {
        const { html } = await goster({ locale: 'tr' })
        const duz = metin(html)
        expect(duz).toContain('Popüler')
        expect(duz).toContain('Tüm para birimleri')
        expect(duz).toContain('Para birimi seç')
    })

    it('hic populer yoksa "Populer" basligi cizilmez', async () => {
        const { html } = await goster({ currencies: [LIST[0], LIST[3]] })
        expect(metin(html)).not.toContain('Popular')
        expect(konum(html, 'chf')).toBeGreaterThan(-1)
    })
})

describe('CurrencyPicker.vue -- satir', () => {
    it('satir: kod + sembol + ad (TRY ₺ Turkish Lira)', async () => {
        const { html } = await goster()
        const duz = metin(satir(html, 'try'))
        expect(duz).toMatch(/TRY\s*₺\s*Turkish Lira/)
    })

    it('kod BUYUK harf yazilir (sunucu kucuk harf yollasa da)', async () => {
        const { html } = await goster({ currencies: [{ code: 'eur', name: 'Euro', symbol: '€' }] })
        expect(metin(satir(html, 'eur'))).toMatch(/EUR\s*€\s*Euro/)
    })

    it('adi ya da sembolu metin olmayan kayit "undefined" yazmaz', async () => {
        const { html } = await goster({ currencies: [{ code: 'EUR', name: undefined, symbol: null }] })
        expect(satir(html, 'eur')).not.toBeNull()
        expect(html).not.toContain('undefined')
        expect(html).not.toContain('null')
    })
})

describe('CurrencyPicker.vue -- ad uygulama dilinde', () => {
    it('tr: TRY satiri "Türk lirası" gosterir, Ingilizce sunucu adi gosterilmez', async () => {
        const { html } = await goster({ locale: 'tr' })
        const duz = metin(satir(html, 'try'))
        expect(duz).toMatch(/türk lirası/i)
        expect(duz).not.toContain('Turkish Lira')
    })

    it('de: Euro ve US-Dollar', async () => {
        const { html } = await goster({ locale: 'de' })
        expect(metin(satir(html, 'eur'))).toContain('Euro')
        expect(metin(satir(html, 'usd'))).toContain('US-Dollar')
        expect(metin(satir(html, 'usd'))).not.toContain('US Dollar')
    })

    it('Intl.DisplayNames atarsa sunucu adina duser', async () => {
        const Gercek = Intl.DisplayNames
        Intl.DisplayNames = function () { throw new Error('desteklenmiyor') }
        try {
            const { html } = await goster({ locale: 'tr' })
            expect(metin(satir(html, 'try'))).toContain('Turkish Lira')
        } finally {
            Intl.DisplayNames = Gercek
        }
    })

    it('tr: turk / lira / turkish / try / ₺ aramalari TRY yi bulur', async () => {
        for (const sorgu of ['türk', 'turk', 'TÜRK', 'lira', 'LİRA', 'lirası', 'turkish', 'try', 'TRY', '₺']) {
            const { html } = await goster({ locale: 'tr', ic: (i) => { i.setupState.query = sorgu } })
            expect(konum(html, 'try'), sorgu).toBeGreaterThan(-1)
            expect(konum(html, 'usd'), sorgu).toBe(-1)
        }
    })

    it('de: "US-Dollar" ve sunucunun Ingilizce adi ("US Dollar") USD yi bulur', async () => {
        for (const sorgu of ['US-Dollar', 'us dollar']) {
            const { html } = await goster({ locale: 'de', ic: (i) => { i.setupState.query = sorgu } })
            expect(konum(html, 'usd'), sorgu).toBeGreaterThan(-1)
        }
    })
})

describe('CurrencyPicker.vue -- secili satir', () => {
    it('secili satir isaretli, digerleri degil', async () => {
        const { html } = await goster({ selected: 'try' })
        expect(satir(html, 'try')).toContain('aria-selected="true"')
        expect(satir(html, 'usd')).toContain('aria-selected="false"')
        expect(satir(html, 'eur')).toContain('aria-selected="false"')
        // Yalniz tek satir secili.
        expect(html.split('aria-selected="true"').length - 1).toBe(1)
    })

    it('secili kod buyuk harfle gelse de ayni satir isaretlenir', async () => {
        const { html } = await goster({ selected: 'EUR' })
        expect(satir(html, 'eur')).toContain('aria-selected="true"')
    })

    it('secili birim listede yoksa hicbir satir isaretlenmez', async () => {
        const { html } = await goster({ selected: 'xyz' })
        expect(html).not.toContain('aria-selected="true"')
    })
})

describe('CurrencyPicker.vue -- liste yok', () => {
    it('liste bos -> currencyListUnavailable metni (en)', async () => {
        const { html } = await goster({ currencies: [] })
        expect(metin(html)).toContain('The currency list could not be loaded. Check your connection and try again.')
        expect(html).not.toContain('data-currency=')
    })

    it('liste bos -> currencyListUnavailable metni (tr)', async () => {
        const { html } = await goster({ currencies: [], locale: 'tr' })
        expect(metin(html)).toContain('Para birimi listesi yüklenemedi. Bağlantını kontrol edip tekrar dene.')
    })

    it('yalniz hariclardan olusan liste de "yuklenemedi" sayilir', async () => {
        const { html } = await goster({ currencies: HARIC })
        expect(metin(html)).toContain('could not be loaded')
        expect(html).not.toContain('data-currency=')
    })

    it('liste dizi degilse (null) cokmez ve "yuklenemedi" yazar', async () => {
        const { html } = await goster({ currencies: null })
        expect(metin(html)).toContain('could not be loaded')
    })
})

describe('CurrencyPicker.vue -- arama', () => {
    it('sorgu doluyken duz sonuc listesi: baslik yok, yalniz eslesenler', async () => {
        const { html } = await goster({ ic: (instance) => { instance.setupState.query = 'lira' } })
        expect(konum(html, 'try')).toBeGreaterThan(-1)
        expect(konum(html, 'usd')).toBe(-1)
        expect(konum(html, 'eur')).toBe(-1)
        const duz = metin(html)
        expect(duz).not.toContain('Popular')
        expect(duz).not.toContain('All currencies')
    })

    it('kod, ad ve sembolde arar (buyuk-kucuk harfsiz)', async () => {
        const kod = await goster({ ic: (i) => { i.setupState.query = 'jp' } })
        expect(konum(kod.html, 'jpy')).toBeGreaterThan(-1)
        expect(konum(kod.html, 'usd')).toBe(-1)

        const sembol = await goster({ ic: (i) => { i.setupState.query = '€' } })
        expect(konum(sembol.html, 'eur')).toBeGreaterThan(-1)
        expect(konum(sembol.html, 'try')).toBe(-1)

        const ad = await goster({ ic: (i) => { i.setupState.query = 'SWISS' } })
        expect(konum(ad.html, 'chf')).toBeGreaterThan(-1)
    })

    it('sorgu yalniz bosluksa liste gruplu (aranmiyor sayilir)', async () => {
        const { html } = await goster({ ic: (i) => { i.setupState.query = '   ' } })
        expect(metin(html)).toContain('Popular')
        expect(konum(html, 'usd')).toBeGreaterThan(-1)
    })

    it('eslesen yoksa currencyNoMatch metni; "yuklenemedi" DEGIL', async () => {
        const { html } = await goster({ ic: (i) => { i.setupState.query = 'zzzz' } })
        const duz = metin(html)
        expect(duz).toContain('No currency matches your search')
        expect(duz).not.toContain('could not be loaded')
        expect(html).not.toContain('data-currency=')
    })

    it('haric tutulan birim aramayla da bulunmaz', async () => {
        const { html } = await goster({
            currencies: [...HARIC, ...LIST],
            ic: (i) => { i.setupState.query = 'bolivar' },
        })
        expect(konum(html, 'vef')).toBe(-1)
        expect(metin(html)).toContain('No currency matches your search')
    })

    it('arama kutusunun yer tutucusu ve etiketi var (en + tr)', async () => {
        const en = await goster()
        expect(en.html).toContain('placeholder="Search currency"')
        const tr = await goster({ locale: 'tr' })
        expect(tr.html).toContain('placeholder="Para birimi ara"')
    })
})

describe('CurrencyPicker.vue -- olaylar', () => {
    it('satira basinca select(kucuk harfli kod) yayilir', async () => {
        const onSelect = vi.fn()
        const { app, captured } = kur({ dinleyiciler: { onSelect } })
        await render(app)

        captured.instance.setupState.choose('TRY')

        expect(onSelect).toHaveBeenCalledTimes(1)
        expect(onSelect).toHaveBeenCalledWith('try')
    })

    it('arka plana basinca close yayilir, select yayilmaz', async () => {
        const onClose = vi.fn()
        const onSelect = vi.fn()
        const { app, captured } = kur({ dinleyiciler: { onClose, onSelect } })
        await render(app)

        captured.instance.setupState.dismiss()

        expect(onClose).toHaveBeenCalledTimes(1)
        expect(onSelect).not.toHaveBeenCalled()
    })
})

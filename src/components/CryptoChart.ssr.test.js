// CryptoChart: `days` ve `divisor` ozellikleri (hisse ekrani T4). Token.vue yolu (ozelliksiz)
// ayni 30 gun kalir. SSR'de canvas yok; seri cizimi ve izleyiciler kaynak taramasiyla kilitlenir.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

// `watch` cagrilari kaydedilir (gercek watch'a aynen iletilir): bilesenin izleyici KAYNAKLARI
// SSR'da hic calismaz, ama kaynaklar buradan alinip gercek watch ile disarida surulebilir.
const izle = vi.hoisted(() => ({ cagrilar: [] }))
vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        onMounted: actual.onServerPrefetch,
        watch: (...a) => { izle.cagrilar.push(a); return actual.watch(...a) },
    }
})

// Grafik artik fetchPriceSeries'ten { points, currency } alir. chartTooltipLabel GERCEK kalir
// (saf yardimci; kendi testi priceHistory.test.js'te), yalniz ag cagrisi sahtelenir.
const gecmis = vi.hoisted(() => ({ fn: vi.fn(async () => ({ points: [], currency: 'usd' })) }))
vi.mock('../utils/priceHistory', async (importOriginal) => ({
    ...(await importOriginal()),
    fetchPriceSeries: (...a) => gecmis.fn(...a),
}))

import { createApp, render, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { currencyStore } from '../store/currency'
import CryptoChart from './CryptoChart.vue'

const kaynak = readFileSync(new URL('./CryptoChart.vue', import.meta.url), 'utf8')
const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

afterEach(() => {
    gecmis.fn.mockClear()
    izle.cagrilar.length = 0
})

// `hazirla(store)` render'dan once secili birimi/kuru kurar; `locale` uygulama dilidir.
async function ciz(props = {}, hazirla, locale = 'en') {
    const app = createApp(CryptoChart, { props })
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    hazirla?.(currencyStore())
    return render(app)
}

const taze = (rates) => {
    const now = Date.now()
    return { rates, currencies: [], updatedAt: now, stale: false, fetchedAt: now }
}

describe('CryptoChart days', () => {
    it('ozellik yoksa 30 gun ister (Token.vue yolu)', async () => {
        await ciz({ id: 'bitcoin' })
        expect(gecmis.fn).toHaveBeenCalledTimes(1)
        expect(gecmis.fn.mock.calls[0][1]).toBe('bitcoin')
        expect(gecmis.fn.mock.calls[0][2]).toBe(30)
    })

    it('days verilince o aralik istenir', async () => {
        await ciz({ id: 'x', days: 365 })
        expect(gecmis.fn.mock.calls[0][2]).toBe(365)
    })

    it('days degisince yeniden yuklenir (izleyici kaynakta)', () => {
        // Cok kaynakli form: her kaynak ayri getter (tek dizi donduren getter HEP degismis sayilir).
        expect(kaynak).toMatch(/watch\(\s*\[\s*\(\)\s*=>\s*props\.id,\s*\(\)\s*=>\s*props\.days,\s*\(\)\s*=>\s*props\.divisor/)
        expect(kaynak).not.toMatch(/watch\(\s*\(\)\s*=>\s*\[/)
    })
})

describe('CryptoChart para birimi', () => {
    it('varsayilan birim usd: 4. arguman "usd"', async () => {
        await ciz({ id: 'bitcoin' })
        expect(gecmis.fn.mock.calls[0][3]).toBe('usd')
    })

    it('secili birim try ve kur taze: 4. arguman display.code ("try")', async () => {
        await ciz({ id: 'bitcoin' }, (store) => {
            store.code = 'try'
            store.snapshot = taze({ try: 40 })
        })
        expect(gecmis.fn.mock.calls[0][3]).toBe('try')
    })

    it("kur yoksa gorunum usd'ye dusar: sunucuya usd istenir (eski kurla try istenmez)", async () => {
        await ciz({ id: 'bitcoin' }, (store) => {
            store.code = 'try'
            store.snapshot = null
        })
        expect(gecmis.fn.mock.calls[0][3]).toBe('usd')
    })

    it('birim degisince yeniden yuklenir: izleme kaynaklari currencyCode (display.code metni) icerir (kaynak kilidi)', () => {
        expect(kaynak).toMatch(/const\s+currencyCode\s*=\s*computed\(\s*\(\)\s*=>\s*display\.value\.code\s*\)/)
        expect(kaynak).toMatch(/watch\(\s*\[[^\]]*,\s*currencyCode\b/)
    })

    it('tooltip etiketi chartTooltipLabel ile yazilir, seri birimi yanittan gelir (kaynak kilidi)', () => {
        expect(kaynak).toMatch(/fetchPriceSeries\(\s*config\.api,\s*props\.id,\s*gun,\s*kod,\s*locale\.value\s*\)/)
        expect(kaynak).toMatch(/callbacks:\s*\{[\s\S]*?label:[\s\S]*?chartTooltipLabel\(/)
        expect(kaynak).toMatch(/seriesCurrency/)
        // Eski tekli imza kalmadi.
        expect(kaynak).not.toMatch(/fetchPriceHistory/)
    })
})

// Tarih etiketleri UYGULAMA DILINE gore yazilir: dil fetchPriceSeries'in 5. argumani olarak gider
// (4. arguman display.code AYNEN kalir). `locale` bilesene useMoney() uzerinden gelir (vue-i18n).
describe('CryptoChart dil', () => {
    it("varsayilan dil 'en': 5. arguman 'en', 4. arguman (birim) degismez", async () => {
        await ciz({ id: 'bitcoin' })
        expect(gecmis.fn.mock.calls[0][3]).toBe('usd')
        expect(gecmis.fn.mock.calls[0][4]).toBe('en')
    })

    it("uygulama dili 'de' iken 5. arguman 'de'", async () => {
        // Test i18n'inde yalniz en/tr mesajlari var: 'de' icin vue-i18n "anahtar yok, en'e dus" uyarisi
        // basar. Bu testin konusu mesaj degil dil argumani; uyari sessizlestirilir.
        const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            await ciz({ id: 'bitcoin' }, undefined, 'de')
        } finally {
            uyari.mockRestore()
        }
        expect(gecmis.fn.mock.calls[0][3]).toBe('usd')
        expect(gecmis.fn.mock.calls[0][4]).toBe('de')
    })

    it('dil degisince yeniden yuklenir: izleme kaynaklari locale icerir (kaynak kilidi)', () => {
        expect(kaynak).toMatch(/watch\(\s*\[[^\]]*,\s*currencyCode,\s*locale\s*\]/)
        // `locale` useMoney()'den (vue-i18n locale ref'i) gelir; ayri bir sabit dil kullanilmaz.
        expect(kaynak).toMatch(/const\s*\{[^}]*\blocale\b[^}]*\}\s*=\s*useMoney\(\)/)
    })

    it('yanit beklenirken dil degistiyse eski yanit yeni etiketleri ezmez (kaynak kilidi)', () => {
        expect(kaynak).toMatch(/lang\s*!==\s*locale\.value/)
    })
})

// BS1: `display` her saat tikinde ve her kur yenilemesinde YENI nesne olur. Izleyici yalniz
// props/kod/dil DEGISINCE tetiklenmeli; yoksa acik bir Token/Hisse ekraninda grafik her dakika
// yeniden kurulur (istek, animasyon, kaybolan ipucu, birikan boyut gozlemcisi).
describe('CryptoChart izleyici: yalniz gercek degisimde yeniden yukler', () => {
    // Bilesenin GERCEK izleyici kaynaklarini alir ve gercek watch ile surer.
    async function kaynaklariSur(hazirla) {
        const app = createApp(CryptoChart, { props: { id: 'bitcoin' } })
        app.use(createTestPinia())
        const i18n = createTestI18n('en')
        app.use(i18n)
        const store = currencyStore()
        hazirla(store)
        await render(app)

        const cagri = izle.cagrilar.find(([kaynaklar]) => Array.isArray(kaynaklar) && kaynaklar.length === 5)
        expect(cagri, 'bilesen cok kaynakli bir watch kurmali').toBeTruthy()
        const { watch: gercekWatch, nextTick } = await vi.importActual('vue')
        const geriCagri = vi.fn()
        const durdur = gercekWatch(cagri[0], geriCagri)
        // Kontrol: eski tek-dizi getter'i (display nesnesine bagli) ayni olaylarda tetiklenir.
        const eskiGeriCagri = vi.fn()
        const eskiDurdur = gercekWatch(() => [store.display.code], eskiGeriCagri)
        return { store, i18n, geriCagri, eskiGeriCagri, nextTick, durdur: () => { durdur(); eskiDurdur() } }
    }

    it('saat tiki ve kur yenilemesi (kod ayni) grafigi YENIDEN YUKLEMEZ; birim ve dil degisince yukler', async () => {
        const { store, i18n, geriCagri, eskiGeriCagri, nextTick, durdur } = await kaynaklariSur((s) => {
            s.code = 'try'
            s.snapshot = taze({ try: 40, eur: 0.9 })
        })
        try {
            const ilk = store.display
            expect(ilk.code).toBe('try')

            // 1) Saat tiki: display yeni nesne, kod ayni.
            store.clock = store.clock + 60 * 1000
            await nextTick()
            expect(store.display).not.toBe(ilk)
            expect(store.display.code).toBe('try')
            expect(geriCagri).not.toHaveBeenCalled()
            // Kontrol: eski dizi getter'i bu olayda (yanlis yere) tetiklenirdi.
            expect(eskiGeriCagri).toHaveBeenCalledTimes(1)

            // 2) Kur yenilemesi: snapshot yeni nesne, kod ayni.
            store.snapshot = taze({ try: 41, eur: 0.9 })
            await nextTick()
            expect(store.display.rate).toBe(41)
            expect(geriCagri).not.toHaveBeenCalled()

            // 3) Gercek birim degisimi: tam bir kez.
            store.code = 'eur'
            await nextTick()
            expect(geriCagri).toHaveBeenCalledTimes(1)

            // 4) Dil degisimi: bir kez daha.
            i18n.global.locale.value = 'tr'
            await nextTick()
            expect(geriCagri).toHaveBeenCalledTimes(2)
        } finally {
            durdur()
        }
    })

    it('yeniden kurulum sizintisi yok: disposeChart gozlemciyi keser ve her kurulumdan once calisir (kaynak kilidi)', () => {
        expect(kaynak).toMatch(/function\s+disposeChart\(\)\s*\{[\s\S]*?__resizeObserver\?\.disconnect\(\)[\s\S]*?chartInstance\.destroy\(\)/)
        expect(kaynak).toMatch(/disposeChart\(\)\s*\n\s*\n\s*chartInstance\s*=\s*new\s+Chart\(/)
        // Eski dogrudan destroy cagrilari kalmadi: hepsi disposeChart uzerinden.
        const govdeSiz = kaynak.replace(/function\s+disposeChart\(\)\s*\{[\s\S]*?\n\}/, '')
        expect(govdeSiz).not.toMatch(/chartInstance\.destroy\(\)/)
    })
})

describe('CryptoChart divisor', () => {
    it('divisor bilinmiyorsa (null / 0 / NaN / negatif) seri cizilmez ve bos yazi gosterilir', async () => {
        for (const d of [null, 0, NaN, -2, 'abc']) {
            gecmis.fn.mockResolvedValueOnce({ points: [{ time: 1, date: 'a', close: 5 }], currency: 'usd' })
            const html = gorunen(await ciz({ id: 'x', divisor: d }))
            expect(html).toContain('No price history for this token.')
        }
    })

    it('divisor yokken (varsayilan) bolme yapilmaz: close dogrudan kullanilir', () => {
        expect(kaynak).toMatch(/divisor\s*===\s*undefined/)
    })
})

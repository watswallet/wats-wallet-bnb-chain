// NewsStrip.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN: bu seridin butun degeri KOSULLU GORUNURLUKTE -- kapatilan kart bir daha
// cikmamali, hepsi kapatilinca bolum HIC cizilmemeli, sunucu dusunce gomulu liste
// devralmali. Bunlarin hicbiri kaynak taramasiyla olculemez: `v-if="items.length"`
// dogru yazilmis olsa bile `items` yanlis kaynaga baglanirsa tarama bunu goremez.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (hoisting; onMounted ->
// onServerPrefetch aliasi olmadan `load()` HIC kosmaz ve serit hep gomulu listeyi
// gosterirdi -- yani sunucudan gelen liste TEST EDILMEMIS olurdu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosGetMock = vi.fn(async () => ({ status: 200, data: { news: [] } }))
vi.mock('axios', () => ({ default: { get: (...args) => axiosGetMock(...args) } }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { NEWS_DISMISSED_KEY, NEWS_CACHE_KEY } from '../utils/news'
import { DEFAULT_NEWS } from '../data/defaultNews'
import NewsStrip from './NewsStrip.vue'

const SERVER_NEWS = [
    { id: 'srv-1', date: '2026-09-01', accent: 'blue', title: { tr: 'Birinci duyuru', en: 'First notice' }, body: { tr: 'Birinci govde', en: 'First body' } },
    { id: 'srv-2', date: '2026-09-01', accent: 'purple', title: { tr: 'Ikinci duyuru', en: 'Second notice' }, body: { tr: 'Ikinci govde', en: 'Second body' } },
    { id: 'srv-3', date: '2026-09-01', accent: 'amber', title: { tr: 'Ucuncu duyuru', en: 'Third notice' }, body: { tr: 'Ucuncu govde', en: 'Third body' } },
]

/** Serit `<section>` ile baslar; hic kart yoksa bolumun KENDISI cizilmez. */
const hasStrip = (html) => html.includes('<section')

// Vue metni HTML olarak KACISLAR: "TON'da" ciktida "TON&#39;da" olur. Duyuru
// basliklarinda kesme isareti var, yani ham cikti uzerinde toContain YANLIS negatif
// verir -- metin ASLINDA orada. Karsilastirmadan once geri cozuluyor. (Sinif adlarinda
// kacislanacak karakter yok; gorsel assertion'lar bundan etkilenmez.)
const decodeEntities = (html) => html
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

async function mount({ locale = 'tr', localStore = {} } = {}) {
    const chrome = installChromeStub(localStore)
    const pinia = createTestPinia()
    const i18n = createTestI18n(locale)
    const app = createApp(NewsStrip, { use: [pinia, i18n] })
    const holder = captureInstance(app, 'NewsStrip')
    const html = decodeEntities(await render(app))
    return { html, holder, chrome }
}

beforeEach(() => {
    axiosGetMock.mockReset()
    axiosGetMock.mockResolvedValue({ status: 200, data: { news: SERVER_NEWS } })
})

afterEach(() => {
    delete globalThis.chrome
})

describe('NewsStrip — sunucudan gelen liste', () => {
    it('uc duyuruyu da basliklari ve govdeleriyle cizer', async () => {
        const { html } = await mount()

        for (const item of SERVER_NEWS) {
            expect(html).toContain(item.title.tr)
            expect(html).toContain(item.body.tr)
        }
    })

    it('dogru uca gider', async () => {
        await mount()
        expect(axiosGetMock).toHaveBeenCalledTimes(1)
        expect(axiosGetMock.mock.calls[0][0]).toMatch(/\/news$/)
    })

    it('aktif dilde cizer — metin sunucudan geldigi icin i18n anahtari YOK', async () => {
        const { html } = await mount({ locale: 'en' })
        expect(html).toContain('First notice')
        expect(html).not.toContain('Birinci duyuru')
    })

    it('basarili yanit onbellege yazilir — sonraki acilista ziplama olmasin', async () => {
        const { chrome } = await mount()
        expect(chrome.localStore[NEWS_CACHE_KEY]).toEqual({ news: SERVER_NEWS })
    })

    it('sunucu BOS liste donerse bolum HIC cizilmez — duyurular kaldirilabilmeli', async () => {
        axiosGetMock.mockResolvedValue({ status: 200, data: { news: [] } })
        const { html } = await mount()
        expect(hasStrip(html)).toBe(false)
    })

    it('bicimi taninmayan govde elimizdekini BOZMAZ — gomulu liste kalir', async () => {
        axiosGetMock.mockResolvedValue({ status: 200, data: { success: false } })
        const { html } = await mount()
        expect(html).toContain(DEFAULT_NEWS[0].title.tr)
    })
})

describe('NewsStrip — sunucu ulasilamazken', () => {
    it('uc dusunce gomulu varsayilan duyurular gorunur', async () => {
        axiosGetMock.mockRejectedValue(new Error('404'))
        const { html } = await mount()

        expect(hasStrip(html)).toBe(true)
        for (const item of DEFAULT_NEWS) {
            expect(html).toContain(item.title.tr)
        }
    })

    it('uc dusuk ama onbellek varsa ONBELLEK kazanir', async () => {
        axiosGetMock.mockRejectedValue(new Error('timeout'))
        const { html } = await mount({ localStore: { [NEWS_CACHE_KEY]: { news: SERVER_NEWS } } })

        expect(html).toContain('Birinci duyuru')
        expect(html).not.toContain(DEFAULT_NEWS[0].title.tr)
    })
})

describe('NewsStrip — kapatma', () => {
    it('kapatilmis id cizilmez, digerleri KALIR', async () => {
        const { html } = await mount({ localStore: { [NEWS_DISMISSED_KEY]: ['srv-2'] } })

        expect(html).toContain('Birinci duyuru')
        expect(html).not.toContain('Ikinci duyuru')
        expect(html).toContain('Ucuncu duyuru')
    })

    it('hepsi kapatilmissa bolum HIC cizilmez — bos baslik "bozuk" gorunur', async () => {
        const { html } = await mount({ localStore: { [NEWS_DISMISSED_KEY]: ['srv-1', 'srv-2', 'srv-3'] } })
        expect(hasStrip(html)).toBe(false)
    })

    it('dismiss() hem depoya yazar hem listeden duser', async () => {
        const { holder, chrome } = await mount()
        expect(holder.instance.setupState.items).toHaveLength(3)

        await holder.instance.setupState.dismiss('srv-2')

        expect(chrome.localStore[NEWS_DISMISSED_KEY]).toEqual(['srv-2'])
        expect(holder.instance.setupState.items.map((x) => x.id)).toEqual(['srv-1', 'srv-3'])
    })
})

describe('NewsStrip — gorsel isaretler', () => {
    it('birden fazla kartta nokta gostergesi cizilir', async () => {
        const { html } = await mount()
        expect(html.match(/w-3\.5 bg-indigo-500|w-1 bg-slate-300/g)?.length).toBe(3)
    })

    it('tek kartta nokta gostergesi YOK — kaydirilacak baska sey yok', async () => {
        axiosGetMock.mockResolvedValue({ status: 200, data: { news: [SERVER_NEWS[0]] } })
        const { html } = await mount()

        expect(hasStrip(html)).toBe(true)
        expect(html).not.toMatch(/w-1 bg-slate-300/)
    })

    it('vurgu rengi kayda gore degisir — sabit degil', async () => {
        const { html } = await mount()
        expect(html).toContain('bg-blue-500')
        expect(html).toContain('bg-purple-500')
        expect(html).toContain('bg-amber-500')
    })
})

// --- kaydirma kontrolleri ---------------------------------------------------------------
//
// KOK NEDEN (kullanici bildirimi: "haberler kaydirilmiyor"): serit YALNIZCA yatay kayiyor
// ve kaydirma cubugu gizli. Gercek Chrome'da (CDP, uretim CSS'i, 360x600 kap) olculdu:
//   dikey tekerlek  -> stripScrollLeft 0,   popup scrollTop 141   (serit HIC oynamadi)
//   Shift+tekerlek  -> stripScrollLeft 280
//   yatay tekerlek  -> stripScrollLeft 280  (yalniz trackpad uretir)
// Yani siradan fareli kullanicinin seridi oynatmasinin HICBIR yolu yoktu. Cozum OK ve NOKTA
// dugmeleridir; tekerlek BILEREK baglanmadi (kullanici karari, 2026-09-02) -- serit
// uzerinde tekerlek popup'i dikey kaydirmaya devam etmeli. Asagidakiler bu iki karari da
// kilitler; hicbiri gercek bir DOM olcumune ihtiyac duymadan test edilebilsin diye
// kaydirici sahte bir elemanla degistiriliyor.

/** Uretimde OLCULEN degerlerle sahte kaydirici: 3 kart, 268px, gap-3, px-6. */
function fakeScroller({ scrollLeft = 0, clientWidth = 356, scrollWidth = 876, offsets = [24, 304, 584] } = {}) {
    return {
        scrollLeft, clientWidth, scrollWidth,
        lastScrollTo: null,
        scrollTo({ left }) { this.lastScrollTo = left; this.scrollLeft = left },
        querySelectorAll: () => offsets.map((offsetLeft) => ({ offsetLeft })),
    }
}

describe('NewsStrip — kaydirma kontrolleri', () => {
    it('birden fazla kartta ONCEKI/SONRAKI oklari cizilir', async () => {
        const { html } = await mount()
        expect(html).toContain('aria-label="Önceki"')
        expect(html).toContain('aria-label="Sonraki"')
    })

    it('tek kartta ok YOK — kaydirilacak baska sey yok', async () => {
        axiosGetMock.mockResolvedValue({ status: 200, data: { news: [SERVER_NEWS[0]] } })
        const { html } = await mount()
        expect(html).not.toContain('aria-label="Sonraki"')
    })

    it('ilk kartta ONCEKI, son kartta SONRAKI pasif', async () => {
        const { html, holder } = await mount()
        expect(html).toContain('disabled')

        holder.instance.setupState.scroller = fakeScroller()
        holder.instance.setupState.scrollToIndex(2)
        expect(holder.instance.setupState.activeIndex).toBe(2)
    })

    it('nokta dugmesi dogrudan o kartin hedefine goturur', async () => {
        const { holder } = await mount()
        const el = fakeScroller()
        holder.instance.setupState.scroller = el

        holder.instance.setupState.scrollToIndex(1)
        // 304 (kartin offsetLeft'i) - 24 (px-6 boslugu) = 280; gercek Chrome'da olculen deger.
        expect(el.lastScrollTo).toBe(280)
    })

    it('son kart, kaydirilabilir AZAMI degerle sinirlanir — yoksa ulasilamaz olurdu', async () => {
        const { holder } = await mount()
        const el = fakeScroller()
        holder.instance.setupState.scroller = el

        holder.instance.setupState.scrollToIndex(2)
        expect(el.lastScrollTo).toBe(520) // scrollWidth 876 - clientWidth 356
    })

    it('step() bir kart ileri/geri gider ve sinirlarda tasmaz', async () => {
        const { holder } = await mount()
        const el = fakeScroller()
        const state = holder.instance.setupState
        state.scroller = el

        state.step(1)
        expect(state.activeIndex).toBe(1)
        state.step(1)
        expect(state.activeIndex).toBe(2)
        state.step(1)
        expect(state.activeIndex).toBe(2) // sonda kalir
        state.step(-5)
        expect(state.activeIndex).toBe(0) // basta kalir
    })

    it("TEKERLEK isleyicisi YOK -- serit uzerinde tekerlek popup'i kaydirmali", async () => {
        const { holder } = await mount()
        // Kullanici karari (2026-09-02): dikey tekerlegi yatay kaydirmaya ceviren isleyici
        // KALDIRILDI. Geri eklenirse serit uzerinden gecerken sayfa kaymaz ve ayni sikayet
        // geri gelir; bu satir o donusu bir KARAR haline getirir, kaza olmaktan cikarir.
        expect(holder.instance.setupState.onWheel).toBeUndefined()
    })

    it('gosterge EN YAKIN karta bakar — orantisal tahmin orta kartta sasiyordu', async () => {
        const { holder } = await mount()
        const state = holder.instance.setupState

        state.scroller = fakeScroller({ scrollLeft: 260 })
        state.syncActiveIndex()
        expect(state.activeIndex).toBe(1)

        state.scroller = fakeScroller({ scrollLeft: 500 })
        state.syncActiveIndex()
        expect(state.activeIndex).toBe(2)
    })

    it('son kart kapatilinca aktif indeks listede kalir', async () => {
        const { holder } = await mount()
        const state = holder.instance.setupState
        state.scroller = fakeScroller()

        state.scrollToIndex(2)
        expect(state.activeIndex).toBe(2)

        await state.dismiss('srv-3')
        expect(state.items).toHaveLength(2)
        expect(state.activeIndex).toBe(1)
    })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ssrRender, installChromeStub, createTestI18n, createTestPinia, createApp, captureInstance, render } from '../test-utils/ssrRender'
import { pageStore } from '../store/pageStore'
import SidePanelNotice from './SidePanelNotice.vue'

// vi.mock('vue', ...) TEST DOSYASININ KENDISINDE olmak ZORUNDA: vitest mock
// hoisting yalniz bu dosyanin kendi kaynagindaki cagriyi tasir. Bir yardimciya
// sarilirsa onMounted SSR'da HIC calismaz ve test sessizce bos deger olcer.
//
// ALIAS `onServerPrefetch`E, DUZ "(fn) => fn()"E DEGIL (bkz. ssrRender.js basindaki
// KULLANIM notu ve depodaki tum diger *.ssr.test.js dosyalari -- orn. NewsStrip.ssr.test.js).
// Duz cagri onMounted'in ASYNC govdesini "fire and forget" calistirir: `renderToString`
// bu donen promise'i BEKLEMEZ, yani `await chrome.storage.local.get(...)` cozulmeden
// render ciktisi ALINIR ve kart HER ZAMAN bayraga bakilmaksizin `<!---->` olarak
// olcumlenir -- deneyle dogrulandi (bkz. Gorev 15 raporu). `onServerPrefetch` ise
// `renderToString`in ACIKCA BEKLEDIGI kancadir.
vi.mock('vue', async (orijinal) => {
    const vue = await orijinal()
    return { ...vue, onMounted: vue.onServerPrefetch }
})

let stub
let pinia

// GORUNME UC SART GEREKTIRIR (bkz. SidePanelNotice.vue basindaki not): yan panel
// yuzeyi, bayrak yazilmamis, kilit/karsilama disi bir sayfa. Bu dosyanin testleri
// SADECE bayrak/i18n davranisini olcer -- diger IKI sart burada SABIT TUTULUR:
//   - `globalThis.window` panel yolunu (`/sidepanel/`) tasir -- gercek panel
//     yuzeyinde `isPanel()`in gordugu ile AYNI sekil. Stub'suz bu ortamda
//     `window` hic TANIMLI DEGIL (bkz. vitest.config.js: environment 'node'),
//     yani `isPanel()` HER ZAMAN false donup karti SESSIZCE gizli birakirdi --
//     "bayrak yokken kart gorunur" testi o zaman bayraktan degil, eksik
//     `window`den dolayi kirilirdi.
//   - `page.currentPage` 'home'a CEKILIR: varsayilan '' degeri KILIT_EKRANLARI
//     icinde (TransactionStatus'un ayni deseniyle -- sayfa henuz BELLI DEGILKEN
//     hicbir yuzen kart gosterilmez). Render'dan ONCE doldurulmus bir Pinia
//     (`ssrRender`e `pinia` olarak verilir) gerekir; aksi halde ssrRender KENDI
//     taze/bos ornegini kurar ve bu atama kaybolur.
beforeEach(() => {
    stub = installChromeStub()
    pinia = createTestPinia()
    pageStore().currentPage = 'home'
    globalThis.window = { location: { pathname: '/sidepanel/index.html' } }
})
afterEach(() => {
    delete globalThis.chrome
    delete globalThis.window
})

describe('SidePanelNotice', () => {
    it('bayrak yokken kart gorunur', async () => {
        const html = await ssrRender(SidePanelNotice, { pinia, global: { plugins: [createTestI18n('tr')] } })
        expect(html).toContain('yan panelde')
    })

    // Bayrak okumasi KATI: installChromeStub eksik anahtar icin undefined
    // doner; `!x` yazilsaydi varsayilan davranis tersine donerdi.
    it('bayrak true iken kart GORUNMEZ', async () => {
        stub.localStore.sidePanelNoticeSeen = true
        const html = await ssrRender(SidePanelNotice, { pinia, global: { plugins: [createTestI18n('tr')] } })
        expect(html).not.toContain('yan panelde')
    })

    it('iki buton da var', async () => {
        const html = await ssrRender(SidePanelNotice, { pinia, global: { plugins: [createTestI18n('tr')] } })
        expect(html).toContain('Popup olarak kullan')
        expect(html).toContain('Tamam')
    })

    it('ingilizce metin de cevriliyor', async () => {
        const html = await ssrRender(SidePanelNotice, { pinia, global: { plugins: [createTestI18n('en')] } })
        expect(html).toContain('side panel')
        expect(html).not.toMatch(/sidePanelNotice\./)
    })
})

// KOD INCELEMESI (Gorev 15 fix turu 1, Bulgu 2): SET_UI_MODE {success:true,mode}
// VEYA {error} ile COZULUR (background.js REJECT ETMEZ) ama `popupaGec()` yaniti
// hic OKUMUYORDU -- basarisiz gecişte bile bayrak yazilip kart kapaniyordu, yani
// kullanici NE popup'a geçiyordu NE de karti bir daha GORUYORDU: tek yeniden
// deneme yolu SONSUZA dek kayboluyordu. Asagidaki testler dogrudan `popupaGec()`i
// cagirir (captureInstance ile) ki DAVRANIS -- kaynaktaki bir alt dizge degil --
// olculsun.
describe('SidePanelNotice -- popupaGec() SET_UI_MODE yanitini okur', () => {
    function kur(sendMessageImpl) {
        const stub = installChromeStub()
        stub.setSendMessage(sendMessageImpl)
        const pinia = createTestPinia()
        pageStore().currentPage = 'home'
        globalThis.window = { location: { pathname: '/sidepanel/index.html' }, close: () => {} }

        const app = createApp(SidePanelNotice)
        app.use(pinia)
        app.use(createTestI18n('tr'))
        const captured = captureInstance(app, 'SidePanelNotice')
        return { stub, captured, app }
    }

    // Ust seviye afterEach (dosya basi) globalThis.chrome/window'u zaten
    // temizliyor -- burada AYRI bir afterEach GEREKMEZ.

    it('{error} donerse: bayrak YAZILMAZ, kart ACIK kalir', async () => {
        const cagrilar = []
        const { stub, captured, app } = kur(async (msg) => {
            cagrilar.push(msg)
            return { error: 'Invalid ui mode' }
        })
        await render(app)

        // On kosul: kart baslangicta gorunur (aksi halde asagidaki "hala
        // gorunur" iddiasi anlamsizlasirdi).
        expect(captured.instance.setupState.gorunur).toBe(true)

        await captured.instance.setupState.popupaGec()

        expect(cagrilar).toEqual([{ type: 'SET_UI_MODE', mode: 'popup' }])
        expect(stub.localStore.sidePanelNoticeSeen).toBeUndefined()
        expect(captured.instance.setupState.gorunur).toBe(true)
    })

    it('{success:true} donerse: bayrak yazilir, kart kapanir (kontrol -- test vakumda gecmiyor)', async () => {
        const { stub, captured, app } = kur(async () => ({ success: true, mode: 'popup' }))
        await render(app)

        expect(captured.instance.setupState.gorunur).toBe(true)

        await captured.instance.setupState.popupaGec()

        expect(stub.localStore.sidePanelNoticeSeen).toBe(true)
        expect(captured.instance.setupState.gorunur).toBe(false)
    })
})

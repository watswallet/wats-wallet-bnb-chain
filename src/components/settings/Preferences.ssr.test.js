// Preferences.vue -- arayuz modu anahtarinin SET_UI_MODE yanitini okudugunu
// GERCEKTEN render ederek dogrular (bkz. src/test-utils/ssrRender.js).
//
// KAPSAM (bilerek DAR): bu dosya SADECE Gorev 15 kod incelemesi turu 1,
// Bulgu 2'nin kapattigi bosluk icin var -- background {success:true,mode}
// VEYA {error} ile COZULUR (REJECT ETMEZ) ama `arayuzModunuDegistir()`
// yaniti hic OKUMUYORDU: basarisiz bir gecişte bile anahtar ISTENEN duruma
// ATLIYORDU, yani ayarlar ekrani cuzdanin GERCEKTE hangi yuzeyde acilacagi
// konusunda YALAN soyluyordu. Bilesenin geri kalani (dil/tema secimi, 7702
// geri alma) bu dosyanin KONUSU DEGIL.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basi KULLANIM notu): onMounted -> onServerPrefetch aliasi olmadan panelModu
// hic doldurulmaz.
import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import Preferences from './Preferences.vue'

afterEach(() => { delete globalThis.chrome })

// `userTheme` ONCEDEN doldurulur ki bilesenin AYRI (bu dosyanin konusu
// olmayan) tema onMounted'i `window.matchMedia` dalina DUSMESIN -- bu ortamda
// `window` yok (bkz. vitest.config.js: environment 'node'), dallanmasa bile
// stub'lanmamis bir global'e dokunmak gurultuye sebep olurdu.
function kur(sendMessageImpl, extraStore = {}) {
    const stub = installChromeStub({ uiMode: 'sidepanel', userTheme: 'dark', ...extraStore })
    stub.setSendMessage(sendMessageImpl)
    // panelSupported() bu bayragi arar (bkz. utils/uiMode.js); installChromeStub
    // varsayilan olarak sidePanel EKLEMEZ -- eklenmezse arayuzModunuDegistir()
    // ilk satirda SESSIZCE geri doner ve asagidaki testler HICBIR SEY olcmezdi.
    globalThis.chrome.sidePanel = {}

    const app = createApp(Preferences)
    app.use(createTestPinia())
    app.use(createTestI18n('tr'))
    const captured = captureInstance(app, 'Preferences')
    return { stub, captured, app }
}

describe('Preferences.vue -- arayuz modu anahtari, SET_UI_MODE yanitini okur', () => {
    it('{error} donerse: anahtar GERCEK (onceki) durumda kalir', async () => {
        const cagrilar = []
        const { captured, app } = kur(async (msg) => {
            cagrilar.push(msg)
            return { error: 'Invalid ui mode' }
        })
        await render(app)

        // On kosul: depoda 'sidepanel' kayitli, yani anahtar PANEL (true) ile
        // basliyor -- aksi halde asagidaki "hala true" iddiasi anlamsizlasirdi.
        expect(captured.instance.setupState.panelModu).toBe(true)

        await captured.instance.setupState.arayuzModunuDegistir()

        expect(cagrilar).toEqual([{ type: 'SET_UI_MODE', mode: 'popup' }])
        // Basarisiz gecis: anahtar HALA true (panel) -- ISTENEN 'popup'
        // durumuna GECMEDI, ekran YALAN SOYLEMIYOR.
        expect(captured.instance.setupState.panelModu).toBe(true)
    })

    it('{success:true} donerse: anahtar GERCEKTEN doner (kontrol -- test vakumda gecmiyor)', async () => {
        const { captured, app } = kur(async (msg) => ({ success: true, mode: msg.mode }))
        await render(app)

        expect(captured.instance.setupState.panelModu).toBe(true)

        await captured.instance.setupState.arayuzModunuDegistir()

        expect(captured.instance.setupState.panelModu).toBe(false)
    })
})

// Kullanim istatistigi anahtari (analytics_enabled / analytics_state). Yukaridaki
// describe'in konusu SET_UI_MODE'dur; bu blok baska bir anahtarin ayni sessiz
// "ekran yalan soyler" riskini olcer: gorsel durum DEPODAKI gercek durumdur ve
// kapatmak kimligi (analytics_state) gercekten siler. `extraStore` ile depo
// ONCEDEN doldurulur.
describe('Preferences.vue -- kullanim istatistigi anahtari', () => {
    it('depoda KAPALI ise anahtar kapali baslar; acinca depoya true yazar', async () => {
        const { stub, captured, app } = kur(async () => ({ success: true }), { analytics_enabled: false })
        await render(app)
        expect(captured.instance.setupState.analitikAcik).toBe(false)

        await captured.instance.setupState.analitigiDegistir()

        expect(captured.instance.setupState.analitikAcik).toBe(true)
        expect(stub.localStore.analytics_enabled).toBe(true)
    })

    it('kayit yoksa ACIK baslar; kapatinca kimlik SILINIR', async () => {
        const { stub, captured, app } = kur(async () => ({ success: true }), { analytics_state: { installId: 'x', lastPingDay: '2026-10-15' } })
        await render(app)
        expect(captured.instance.setupState.analitikAcik).toBe(true)

        await captured.instance.setupState.analitigiDegistir()

        expect(captured.instance.setupState.analitikAcik).toBe(false)
        expect(stub.localStore.analytics_enabled).toBe(false)
        expect(stub.localStore.analytics_state).toBeUndefined()
    })
})

// Bayat ekran: popup ve yan panel AYNI ANDA acikken birinde yapilan degisiklik
// digerinin ekranina yansimayabilir. Yeni deger kullanicinin GORDUGUNUN tersidir
// (kullanici gordugu anahtara tiklayip onu cevirmek istedi); depodan turetilirse bayat
// ekranda tiklanan yonun TERSI uygulanir. Bayatligi chrome.storage.onChanged cozer.
describe('Preferences.vue -- kullanim istatistigi anahtari, bayat ekran', () => {
    it('ekran bayat ACIK, depo KAPALI: kullanici kapatmak istedi -> depo false KALIR, ekran KAPALI olur', async () => {
        const { stub, captured, app } = kur(async () => ({ success: true }), { analytics_enabled: false })
        await render(app)
        // Baska yuzey depoyu kapatti ama bu ekran haberdar degil: ekran 'acik' diyor.
        captured.instance.setupState.analitikAcik = true

        await captured.instance.setupState.analitigiDegistir()

        // Eski davranis (depodan turet) burada depoyu ACARDI: kullanicinin istedigi tersi.
        expect(stub.localStore.analytics_enabled).toBe(false)
        expect(captured.instance.setupState.analitikAcik).toBe(false)
    })

    it('ekran bayat KAPALI, depo ACIK: kullanici acmak istedi -> depo true olur, ekran ACIK', async () => {
        const { stub, captured, app } = kur(async () => ({ success: true }), { analytics_state: { installId: 'x' } })
        await render(app)
        captured.instance.setupState.analitikAcik = false

        await captured.instance.setupState.analitigiDegistir()

        expect(stub.localStore.analytics_enabled).toBe(true)
        expect(captured.instance.setupState.analitikAcik).toBe(true)
        // Acmak kimligi silmez (silme yalniz kapatirken olur).
        expect(stub.localStore.analytics_state).toEqual({ installId: 'x' })
    })
})

describe('Preferences.vue -- kullanim istatistigi anahtari, onChanged senkronu', () => {
    it('acilista bir onChanged dinleyicisi kurulur', async () => {
        const { stub, app } = kur(async () => ({ success: true }))
        await render(app)
        expect(stub.changeListenerCount()).toBe(1)
    })

    it('depo disaridan degisince ekran guncellenir (kapat / ac / kayit silinirse varsayilan ACIK)', async () => {
        const { stub, captured, app } = kur(async () => ({ success: true }))
        await render(app)
        expect(captured.instance.setupState.analitikAcik).toBe(true)

        stub.emitStorageChange({ analytics_enabled: { newValue: false } })
        expect(captured.instance.setupState.analitikAcik).toBe(false)

        stub.emitStorageChange({ analytics_enabled: { newValue: true } })
        expect(captured.instance.setupState.analitikAcik).toBe(true)

        stub.emitStorageChange({ analytics_enabled: { newValue: false } })
        expect(captured.instance.setupState.analitikAcik).toBe(false)
        // Kayit silindi (storage.clear): kayit yok = varsayilan ACIK.
        stub.emitStorageChange({ analytics_enabled: { newValue: undefined } })
        expect(captured.instance.setupState.analitikAcik).toBe(true)
    })

    it("baska alan ('sync') ya da baska anahtar ekrani DEGISTIRMEZ", async () => {
        const { stub, captured, app } = kur(async () => ({ success: true }), { analytics_enabled: false })
        await render(app)
        expect(captured.instance.setupState.analitikAcik).toBe(false)

        stub.emitStorageChange({ analytics_enabled: { newValue: true } }, 'sync')
        stub.emitStorageChange({ analytics_state: { newValue: { installId: 'y' } } })

        expect(captured.instance.setupState.analitikAcik).toBe(false)
    })

    it('dinleyici onUnmounted ile kaldirilir (kaynak: ayni islev eklenir ve kaldirilir)', async () => {
        const { readFileSync } = await import('node:fs')
        const { fileURLToPath } = await import('node:url')
        const kaynak = readFileSync(fileURLToPath(new URL('./Preferences.vue', import.meta.url)), 'utf8')
        // NEDEN kaynak taramasi: SSR'da onUnmounted calismaz; kaldirmanin varligini ancak buradan olceriz.
        expect(kaynak).toMatch(/onUnmounted\(\s*\(\)\s*=>/)
        expect(kaynak).toContain('onChanged?.removeListener?.(depoDegisti)')
        expect(kaynak).toContain('onChanged?.addListener?.(depoDegisti)')
    })
})

// Ilk okuma bitene dek anahtar CIZILMEZ: tercihi kapali kullanici her acilista
// ACIK->KAPALI kayma animasyonu gormesin.
describe('Preferences.vue -- kullanim istatistigi anahtari, ilk okuma', () => {
    it('baslangic durumu null (okuma oncesi) ve null iken tiklama hicbir sey yazmaz', async () => {
        let baslangic = 'yakalanmadi'
        let tiklama = null
        const stub = installChromeStub({ uiMode: 'sidepanel', userTheme: 'dark', analytics_enabled: false })
        stub.setSendMessage(async () => ({ success: true }))
        globalThis.chrome.sidePanel = {}
        const app = createApp(Preferences)
        app.use(createTestPinia())
        app.use(createTestI18n('tr'))
        const captured = captureInstance(app, 'Preferences', (instance) => {
            // Bilesenin KENDI okuma kancasindan ONCE (senkron) yakalanir.
            baslangic = instance.setupState.analitikAcik
            tiklama = instance.setupState.analitigiDegistir()
        })
        await render(app)

        expect(baslangic).toBeNull()
        await tiklama
        // Okuma bitmeden yapilan tiklama depoyu degistirmedi.
        expect(stub.localStore.analytics_enabled).toBe(false)
        expect(captured.instance.setupState.analitikAcik).toBe(false)
    })

    it('anahtar gorseli analitikAcik null iken cizilmez (sablon v-if ile korunur)', async () => {
        const { readFileSync } = await import('node:fs')
        const { fileURLToPath } = await import('node:url')
        const kaynak = readFileSync(fileURLToPath(new URL('./Preferences.vue', import.meta.url)), 'utf8')
        const kapi = kaynak.indexOf('v-if="analitikAcik !== null"')
        expect(kapi).toBeGreaterThan(-1)
        // Kapi, analitik anahtarinin sinif baglamasindan ONCE ve ayni elemanda olmali.
        const sinif = kaynak.indexOf(":class=\"analitikAcik ? 'bg-indigo-500'")
        expect(kapi).toBeLessThan(sinif)
        expect(sinif - kapi).toBeLessThan(400)
    })

    it('okuma SONRASI anahtar cizilir', async () => {
        const { app } = kur(async () => ({ success: true }), { analytics_enabled: false })
        const html = await render(app)
        expect(html).toContain('bg-slate-300')
        expect(html).toContain('translate-x-0')
    })

    it('okuma hata verirse varsayilan ACIK ile anahtar yine cizilir', async () => {
        const { captured, app } = kur(async () => ({ success: true }))
        const gercekGet = globalThis.chrome.storage.local.get
        globalThis.chrome.storage.local.get = async (keys) => {
            if (keys === 'analytics_enabled') throw new Error('depo yok')
            return gercekGet(keys)
        }
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
        await render(app)
        expect(captured.instance.setupState.analitikAcik).toBe(true)
        hata.mockRestore()
    })
})

// Istatistik satiri kardes satirlarla AYNI dizilimi kullanir (ikon dairesi + metin
// blogu). NEDEN: ekran goruntusunde satir ikonsuz ve hizasiz duruyordu.
describe('Preferences.vue -- kullanim istatistigi satiri gorunumu', () => {
    it('kardes satirlar gibi w-8 h-8 ikon dairesi ve w-4 h-4 cubuk-grafik SVG i tasir', async () => {
        const { app } = kur(async () => ({ success: true }))
        const html = await render(app)
        // Satiri, ikon dairesinin ait oldugu dugmenin basindan kapanisina kadar kes.
        const bas = html.lastIndexOf('<button', html.indexOf('bg-violet-100'))
        const satir = html.slice(bas, html.indexOf('</button>', bas))
        expect(satir).toContain('bg-violet-100')
        expect(satir).toContain('dark:bg-violet-500/10')
        expect(satir).toContain('text-violet-600')
        expect(satir).toContain('dark:text-violet-400')
        expect(satir).toContain('w-8 h-8 rounded-full')
        // NEDEN: uzun aciklama yaninda flex satirinda daire ezilmesin (shrink-0 yoksa daralir).
        expect(satir.match(/<div class="([^"]*bg-violet-100[^"]*)"/)[1].split(/\s+/)).toContain('shrink-0')
        expect(satir).toMatch(/<svg class="w-4 h-4"[^>]*stroke="currentColor"/)
        expect(satir).toContain('flex items-center gap-3')
    })
})

// Derleme bayragi KAPALIYKEN satir hic render edilmez (yayin varsayilani).
describe('Preferences.vue -- ANALYTICS_ENABLED kapaliyken', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

    const goster = async (deger) => {
        vi.resetModules()
        vi.stubEnv('VITE_ANALYTICS_ENABLED', deger)
        const ssr = await import('../../test-utils/ssrRender.js')
        const { default: Pref } = await import('./Preferences.vue')
        const stub = ssr.installChromeStub({ uiMode: 'sidepanel', userTheme: 'dark' })
        stub.setSendMessage(async () => ({ success: true }))
        globalThis.chrome.sidePanel = {}
        // Hangi anahtarlarin okundugunu kaydet (uiMode okumasi serbest, analytics_enabled degil).
        const okunan = []
        const gercekGet = globalThis.chrome.storage.local.get
        globalThis.chrome.storage.local.get = (keys, ...a) => { okunan.push(keys); return gercekGet(keys, ...a) }
        const app = ssr.createApp(Pref)
        app.use(ssr.createTestPinia())
        app.use(ssr.createTestI18n('tr'))
        const html = await ssr.render(app)
        return { html, okunan, stub }
    }

    it('anahtar satiri ve onun ayiricisi YOK; acikken VAR', async () => {
        const kapali = (await goster('false')).html
        const acik = (await goster('true')).html
        expect(kapali).not.toContain('bg-violet-100')
        expect(acik).toContain('bg-violet-100')
        // Ayirici sayisi: acikken 3, kapaliyken 2 (satirla birlikte ayirici da gider).
        const ayirici = (h) => h.split('h-px bg-slate-100').length - 1
        expect(ayirici(acik) - ayirici(kapali)).toBe(1)
    })

    it('depoda analytics_enabled OKUNMAZ ve onChanged dinleyicisi KURULMAZ', async () => {
        const { okunan, stub } = await goster('false')
        expect(okunan.flat()).not.toContain('analytics_enabled')
        expect(stub.changeListenerCount()).toBe(0)
    })

    it('kontrol: bayrak acikken ayni olcum analytics_enabled okur ve dinleyici kurar', async () => {
        const { okunan, stub } = await goster('true')
        expect(okunan.flat()).toContain('analytics_enabled')
        expect(stub.changeListenerCount()).toBe(1)
    })
})

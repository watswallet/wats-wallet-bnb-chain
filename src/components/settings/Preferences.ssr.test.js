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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Para birimi satiri kur tablosunu AGDAN ceker (refreshRates); testte ag yok, sahte yanit.
vi.mock('../../utils/fiatRates', async (importOriginal) => ({
    ...(await importOriginal()),
    fetchRatesSnapshot: vi.fn(),
}))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { fetchRatesSnapshot } from '../../utils/fiatRates'
import { currencyStore } from '../../store/currency'
import Preferences from './Preferences.vue'
import { LANGUAGES } from '../../i18n/languages.js'

beforeEach(() => {
    fetchRatesSnapshot.mockReset()
    fetchRatesSnapshot.mockImplementation(async () => snap())
})

afterEach(() => { delete globalThis.chrome })

// `userTheme` ONCEDEN doldurulur ki bilesenin AYRI (bu dosyanin konusu
// olmayan) tema onMounted'i `window.matchMedia` dalina DUSMESIN -- bu ortamda
// `window` yok (bkz. vitest.config.js: environment 'node'), dallanmasa bile
// stub'lanmamis bir global'e dokunmak gurultuye sebep olurdu.
// `depoHazirla(store)`: para birimi deposunu render'dan ONCE doldurmak icin (verilirse).
// `onCapture`: bilesenin ic durumunu render'dan ONCE yazmak icin (captureInstance kancasi).
function kur(sendMessageImpl, extraStore = {}, depoHazirla, onCapture) {
    const stub = installChromeStub({ uiMode: 'sidepanel', userTheme: 'dark', ...extraStore })
    stub.setSendMessage(sendMessageImpl)
    // panelSupported() bu bayragi arar (bkz. utils/uiMode.js); installChromeStub
    // varsayilan olarak sidePanel EKLEMEZ -- eklenmezse arayuzModunuDegistir()
    // ilk satirda SESSIZCE geri doner ve asagidaki testler HICBIR SEY olcmezdi.
    globalThis.chrome.sidePanel = {}

    const app = createApp(Preferences)
    const pinia = createTestPinia()
    if (depoHazirla) depoHazirla(currencyStore())
    app.use(pinia)
    app.use(createTestI18n('tr'))
    const captured = captureInstance(app, 'Preferences', onCapture)
    return { stub, captured, app }
}

// Sunucunun /getRates yanitindan cikan kur gorunumu (taze, yasi sifir).
const SUNUCU_LISTESI = [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
]
function snap(over = {}) {
    const now = Date.now()
    return { rates: { eur: 0.9, try: 40 }, currencies: SUNUCU_LISTESI, updatedAt: now, stale: false, fetchedAt: now, ...over }
}

// Etiketleri atip bosluklari tek bosluga indirir: ekranin GORUNEN metni.
const metin = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

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

    it('kayit yoksa KAPALI baslar (karar yok); acmak kabul sayilir', async () => {
        const { stub, captured, app } = kur(async () => ({ success: true }))
        await render(app)
        expect(captured.instance.setupState.analitikAcik).toBe(false)
        await captured.instance.setupState.analitigiDegistir()
        expect(captured.instance.setupState.analitikAcik).toBe(true)
        expect(stub.localStore.analytics_enabled).toBe(true)
    })

    it('kabul edilmisse ACIK baslar; kapatinca kimlik SILINIR', async () => {
        const { stub, captured, app } = kur(async () => ({ success: true }), { analytics_enabled: true, analytics_state: { installId: 'x', lastPingDay: '2026-10-15' } })
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

    it('depo disaridan degisince ekran guncellenir (kapat / ac / kayit silinirse KAPALI)', async () => {
        const { stub, captured, app } = kur(async () => ({ success: true }))
        await render(app)
        expect(captured.instance.setupState.analitikAcik).toBe(false)

        stub.emitStorageChange({ analytics_enabled: { newValue: false } })
        expect(captured.instance.setupState.analitikAcik).toBe(false)

        stub.emitStorageChange({ analytics_enabled: { newValue: true } })
        expect(captured.instance.setupState.analitikAcik).toBe(true)

        stub.emitStorageChange({ analytics_enabled: { newValue: false } })
        expect(captured.instance.setupState.analitikAcik).toBe(false)
        // Kayit silindi (storage.clear): kayit yok = karar yok = KAPALI.
        stub.emitStorageChange({ analytics_enabled: { newValue: true } })
        stub.emitStorageChange({ analytics_enabled: { newValue: undefined } })
        expect(captured.instance.setupState.analitikAcik).toBe(false)
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
        // Kapi, analitik anahtarinin sinif baglamasindan ONCE ve ayni elemanda olmali. Zemin sinifi anahtarZemini'nden
        // gelir (gizli modda grafit, bkz. Preferences.privateMode.ssr.test.js).
        const sinif = kaynak.indexOf(':class="anahtarZemini(analitikAcik')
        expect(kapi).toBeLessThan(sinif)
        expect(sinif - kapi).toBeLessThan(400)
    })

    it('okuma SONRASI anahtar cizilir', async () => {
        const { app } = kur(async () => ({ success: true }), { analytics_enabled: false })
        const html = await render(app)
        expect(html).toContain('bg-slate-300')
        expect(html).toContain('translate-x-0')
    })

    it('okuma hata verirse KAPALI ile anahtar yine cizilir', async () => {
        const { captured, app } = kur(async () => ({ success: true }))
        const gercekGet = globalThis.chrome.storage.local.get
        globalThis.chrome.storage.local.get = async (keys) => {
            if (keys === 'analytics_enabled') throw new Error('depo yok')
            return gercekGet(keys)
        }
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
        await render(app)
        expect(captured.instance.setupState.analitikAcik).toBe(false)
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

// Dil secici (spec Bolum C): 12 dillik katalog tek kaynaktan (i18n/languages.js) gelir,
// depodaki kayit resolveLanguage ile kanonik koda cevrilir. Kurulumda `createTestI18n('tr')`
// 'tr' ile baslar; bu yuzden "locale degismedi" iddiasi 'tr' ile olculur.
describe('Preferences.vue -- dil secici', () => {
    // Test i18n'inde yalniz en/tr mesajlari var: 'pt-BR', 'ja' gibi bir dile gecince vue-i18n her
    // anahtar icin "bulunamadi, en'e dusuluyor" uyarisi basar. Uyari bu testlerin konusu degil.
    let uyari
    beforeEach(() => { uyari = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
    afterEach(() => { uyari.mockRestore() })

    const SECICI_SIRASI = [
        'Español', 'Português (Brasil)', 'Русский', '简体中文', 'Tiếng Việt', 'Bahasa Indonesia',
        '한국어', '日本語', 'Deutsch', 'Français', 'Türkçe', 'English',
    ]

    it('secici 12 dili katalogdaki sirayla ve her birinin KENDI adiyla sunar', async () => {
        const { captured, app } = kur(async () => ({ success: true }), {})
        await render(app)

        const { languages } = captured.instance.setupState
        expect(languages.map((l) => l.name)).toEqual(SECICI_SIRASI)
        // Tek kaynak: Preferences kendi listesini TUTMAZ, katalogun kendisini kullanir.
        expect(languages).toBe(LANGUAGES)
    })

    it('secici acikken 12 satirin hepsini render eder (yalniz tr/en degil)', async () => {
        installChromeStub({ uiMode: 'sidepanel', userTheme: 'dark' })
        globalThis.chrome.sidePanel = {}
        const app = createApp(Preferences)
        app.use(createTestPinia())
        app.use(createTestI18n('tr'))
        // Secici acilir (tiklama yok: SSR'da bilesenin KENDI durumu kancadan yazilir).
        captureInstance(app, 'Preferences', (instance) => { instance.setupState.showLangModal = true })
        const html = await render(app)

        for (const ad of SECICI_SIRASI) expect(html).toContain(ad)
        // Her dilin bayragi yaninda gorunur.
        for (const { flag } of LANGUAGES) expect(html).toContain(flag)
    })

    // Kayit -> okuma gidis-donusu: eskiden 'pt-BR' kesilip 'pt'ye, oradan 'en'e dusuyordu;
    // eski/bolgesiz kayitlar ('pt', 'zh-TW') kanonik koda cevrilmelidir.
    it.each([
        ['pt', 'pt-BR', 'Português (Brasil)'],
        ['pt-BR', 'pt-BR', 'Português (Brasil)'],
        ['zh-TW', 'zh-CN', '简体中文'],
        ['es-419', 'es', 'Español'],
        ['de', 'de', 'Deutsch'],
        ['en', 'en', 'English'],
    ])("depoda language '%s' -> locale '%s' ve etiket '%s'", async (kayit, beklenenKod, beklenenEtiket) => {
        const { captured, app } = kur(async () => ({ success: true }), { language: kayit })
        await render(app)

        expect(captured.instance.setupState.locale).toBe(beklenenKod)
        expect(captured.instance.setupState.currentLangLabel).toBe(beklenenEtiket)
    })

    // Gecersiz kayit mevcut dili BOZMAZ: locale 'en'e ya da undefined'a donmez.
    it.each([['zz'], [''], [42], [null], [undefined]])(
        "depoda gecersiz language (%j) -> locale baslangic degerinde ('tr') kalir",
        async (kayit) => {
            const { captured, app } = kur(async () => ({ success: true }), { language: kayit })
            await render(app)

            expect(captured.instance.setupState.locale).toBe('tr')
            expect(captured.instance.setupState.currentLangLabel).toBe('Türkçe')
        },
    )

    it("setLanguage({code:'ja'}) kanonik kodu depoya yazar ve locale'i degistirir", async () => {
        const { stub, captured, app } = kur(async () => ({ success: true }), {})
        await render(app)

        await captured.instance.setupState.setLanguage({ code: 'ja' })

        expect(stub.localStore.language).toBe('ja')
        expect(captured.instance.setupState.locale).toBe('ja')
        expect(captured.instance.setupState.currentLangLabel).toBe('日本語')
    })

    it("bolgeli kod kaydedilip yeniden acilinca ayni kodla gelir (kayit -> okuma gidis-donusu)", async () => {
        const ilk = kur(async () => ({ success: true }), {})
        await render(ilk.app)
        await ilk.captured.instance.setupState.setLanguage({ code: 'pt-BR' })
        expect(ilk.stub.localStore.language).toBe('pt-BR')

        // Popup yeniden acilir: yeni i18n ornegi 'tr' ile baslar, depodaki kayit okunur.
        const kayitli = ilk.stub.localStore.language
        const { captured, app } = kur(async () => ({ success: true }), { language: kayitli })
        await render(app)
        expect(captured.instance.setupState.locale).toBe('pt-BR')
    })
})

// Dil satirinin altindaki "Para birimi" satiri ve secici (spec Bolum B, "Secim yeri").
describe('Preferences.vue -- para birimi satiri', () => {
    const tamam = async () => ({ success: true })

    it('depo "eur" iken satir EUR gosterir; satir dil satirinin ALTINDA, tema satirinin USTUNDE', async () => {
        const { app } = kur(tamam, {}, (depo) => { depo.adopt('eur'); depo.snapshot = snap() })
        const duz = metin(await render(app))

        expect(duz).toContain('Para birimi')
        expect(duz).toContain('EUR · Euro')
        expect(duz.indexOf('Türkçe')).toBeGreaterThan(-1)
        expect(duz.indexOf('Türkçe')).toBeLessThan(duz.indexOf('Para birimi'))
        expect(duz.indexOf('Para birimi')).toBeLessThan(duz.indexOf('Tema'))
    })

    it('kur tablosu henuz yokken yalniz kod yazilir (uydurma ad ya da "undefined" yok)', async () => {
        const { app } = kur(tamam)
        const duz = metin(await render(app))

        expect(duz).toContain('Para birimi')
        expect(duz).toMatch(/Para birimi USD(?! ·)/)
        expect(duz).not.toContain('undefined')
    })

    it('secili birim tabloda yoksa ("xyz") yalniz kod yazilir', async () => {
        const { app } = kur(tamam, {}, (depo) => { depo.adopt('xyz'); depo.snapshot = snap() })
        const duz = metin(await render(app))

        expect(duz).toMatch(/Para birimi XYZ(?! ·)/)
    })

    it('satir dil satiriyla ayni dizilimi kullanir (ikon dairesi + iki satirli metin + ok)', async () => {
        const { app } = kur(tamam, {}, (depo) => { depo.adopt('try'); depo.snapshot = snap() })
        const html = await render(app)
        const bas = html.lastIndexOf('<button', html.indexOf('Para birimi'))
        const satir = html.slice(bas, html.indexOf('</button>', bas))

        expect(satir).toContain('w-8 h-8 rounded-full')
        expect(satir).toContain('flex items-center gap-3')
        expect(satir).toMatch(/<svg class="w-4 h-4"[^>]*stroke="currentColor"/)
        expect(metin(satir)).toContain('TRY · Turkish Lira')
    })

    it('modal kapaliyken secici cizilmez', async () => {
        const { app } = kur(tamam, {}, (depo) => { depo.snapshot = snap() })
        const html = await render(app)

        expect(html).not.toContain('data-currency=')
        expect(html).not.toContain('Para birimi seç')
    })

    it('modal aciksa secici cizilir: liste, secili satir isaretli', async () => {
        const { app } = kur(tamam, {}, (depo) => { depo.adopt('eur'); depo.snapshot = snap() },
            (instance) => { instance.setupState.showCurrencyModal = true })
        const html = await render(app)

        expect(html).toContain('data-currency="usd"')
        expect(html).toContain('data-currency="try"')
        expect(html.slice(html.lastIndexOf('<button', html.indexOf('data-currency="eur"')))).toMatch(/^[^>]*aria-selected="true"/)
        expect(metin(html)).toContain('Para birimi seç')
    })

    it('modal aciksa ve liste yoksa "yuklenemedi" metni cizilir', async () => {
        const { app } = kur(tamam, {}, undefined,
            (instance) => { instance.setupState.showCurrencyModal = true })
        const duz = metin(await render(app))

        expect(duz).toContain('Para birimi listesi yüklenemedi')
    })
})

describe('Preferences.vue -- para birimi secici davranisi', () => {
    const tamam = async () => ({ success: true })
    afterEach(() => { vi.useRealTimers() })

    it('modal acilirken liste bossa kur tablosu ZORLA yenilenir ve liste dolar', async () => {
        const { app, captured } = kur(tamam)
        await render(app)
        const depo = currencyStore()
        expect(depo.list).toEqual([])

        captured.instance.setupState.openCurrencyModal()
        await vi.waitFor(() => expect(depo.list.length).toBeGreaterThan(0))

        expect(captured.instance.setupState.showCurrencyModal).toBe(true)
        expect(fetchRatesSnapshot).toHaveBeenCalledTimes(1)
    })

    it('liste bossa yenileme taze onbellege takilmaz (force: oran var ama currencies bos)', async () => {
        // Onbellek "taze" ama liste bos. Zorlanmazsa refreshRates erken doner, istek HIC atilmazdi.
        const { app, captured } = kur(tamam, {}, (depo) => { depo.snapshot = snap({ currencies: [] }) })
        await render(app)

        captured.instance.setupState.openCurrencyModal()
        await vi.waitFor(() => expect(fetchRatesSnapshot).toHaveBeenCalledTimes(1))
    })

    it('liste doluysa modal acilirken ag istegi ATILMAZ', async () => {
        const { app, captured } = kur(tamam, {}, (depo) => { depo.snapshot = snap() })
        await render(app)

        captured.instance.setupState.openCurrencyModal()

        expect(captured.instance.setupState.showCurrencyModal).toBe(true)
        expect(fetchRatesSnapshot).not.toHaveBeenCalled()
    })

    it('secim: depo ve diske yazilir, modal 200 ms sonra kapanir (dil seciciyle ayni)', async () => {
        const { app, captured, stub } = kur(tamam, {}, (depo) => { depo.snapshot = snap() })
        await render(app)
        vi.useFakeTimers({ toFake: ['setTimeout'] })
        captured.instance.setupState.showCurrencyModal = true

        await captured.instance.setupState.selectCurrency('eur')

        expect(currencyStore().code).toBe('eur')
        expect(stub.localStore.currency).toBe('eur')
        // Secimden hemen sonra modal hala acik: kullanici secimin isaretlendigini gorur.
        expect(captured.instance.setupState.showCurrencyModal).toBe(true)
        vi.advanceTimersByTime(199)
        expect(captured.instance.setupState.showCurrencyModal).toBe(true)
        vi.advanceTimersByTime(1)
        expect(captured.instance.setupState.showCurrencyModal).toBe(false)
    })

    it('gecersiz / haric kod secilirse hicbir sey yazilmaz ve modal ACIK kalir', async () => {
        const { app, captured, stub } = kur(tamam, {}, (depo) => { depo.adopt('try'); depo.snapshot = snap() })
        await render(app)
        vi.useFakeTimers({ toFake: ['setTimeout'] })
        captured.instance.setupState.showCurrencyModal = true

        await captured.instance.setupState.selectCurrency('vef')
        vi.advanceTimersByTime(1000)

        expect(currencyStore().code).toBe('try')
        expect(stub.localStore.currency).toBeUndefined()
        expect(captured.instance.setupState.showCurrencyModal).toBe(true)
    })

    it('baska pencerede secim degisince (adopt) satir anlik guncellenir', async () => {
        const { app, captured } = kur(tamam, {}, (depo) => { depo.adopt('try'); depo.snapshot = snap() })
        await render(app)
        expect(captured.instance.setupState.currentCurrencyLabel).toBe('TRY · Turkish Lira')

        currencyStore().adopt('eur')

        expect(captured.instance.setupState.currentCurrencyLabel).toBe('EUR · Euro')
    })
})

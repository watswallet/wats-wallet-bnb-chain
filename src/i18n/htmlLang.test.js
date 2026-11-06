// <html lang> calisma ani baglamasi (spec Bolum C). Uc index.html'deki statik lang="en"
// yalnizca BASLANGIC degeridir; secili dil degisince tarayici/ekran okuyucu/yazim denetimi
// dogru dili gormeli. Service worker'da document yoktur: baglama sessizce atlanir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createI18n } from 'vue-i18n'
import { bindHtmlLang } from './htmlLang.js'

const yeniI18n = (locale = 'en') => createI18n({
    legacy: false,
    locale,
    messages: { en: {} },
})

const sahteBelge = () => ({ documentElement: { lang: '' } })

describe('bindHtmlLang', () => {
    it('baglanir baglanmaz mevcut dili yazar (immediate)', () => {
        const doc = sahteBelge()
        bindHtmlLang(yeniI18n('en'), doc)
        expect(doc.documentElement.lang).toBe('en')
    })

    it('baslangic dili en olmayabilir', () => {
        const doc = sahteBelge()
        bindHtmlLang(yeniI18n('de'), doc)
        expect(doc.documentElement.lang).toBe('de')
    })

    it('dil degisince eszamanli (sync) gunceller, bolgeli kodlar kesilmez', () => {
        const doc = sahteBelge()
        const i18n = yeniI18n('en')
        bindHtmlLang(i18n, doc)

        // Atama ile okuma ARASINDA await yok: flush 'sync' oldugu icin ayni kosuda yazilmali.
        i18n.global.locale.value = 'pt-BR'
        expect(doc.documentElement.lang).toBe('pt-BR')

        i18n.global.locale.value = 'zh-CN'
        expect(doc.documentElement.lang).toBe('zh-CN')

        i18n.global.locale.value = 'tr'
        expect(doc.documentElement.lang).toBe('tr')
    })

    it('donen durdurucu cagrilinca izleme biter', () => {
        const doc = sahteBelge()
        const i18n = yeniI18n('en')
        const durdur = bindHtmlLang(i18n, doc)
        expect(typeof durdur).toBe('function')

        i18n.global.locale.value = 'fr'
        expect(doc.documentElement.lang).toBe('fr')

        durdur()
        i18n.global.locale.value = 'ja'
        expect(doc.documentElement.lang).toBe('fr')
    })

    it('bos ya da string olmayan dil lang ozelligini bozmaz (gecerli kalir)', () => {
        const doc = sahteBelge()
        const i18n = yeniI18n('ko')
        bindHtmlLang(i18n, doc)

        i18n.global.locale.value = ''
        expect(doc.documentElement.lang).toBe('ko')

        i18n.global.locale.value = undefined
        expect(doc.documentElement.lang).toBe('ko')

        i18n.global.locale.value = 'vi'
        expect(doc.documentElement.lang).toBe('vi')
    })

    it('document yoksa (service worker / node) null doner ve cokmez', () => {
        expect(bindHtmlLang(yeniI18n(), undefined)).toBeNull()
        expect(bindHtmlLang(yeniI18n(), null)).toBeNull()
    })

    it('documentElement yoksa null doner ve cokmez', () => {
        expect(bindHtmlLang(yeniI18n(), {})).toBeNull()
    })
})

describe('i18n/index.js baglantisi', () => {
    beforeEach(() => {
        globalThis.document = sahteBelge()
        // index.js import edilirken applySavedLanguage chrome.storage.local.get'i cagirir.
        globalThis.chrome = { storage: { local: { get: vi.fn(async () => ({})) } } }
        vi.resetModules()
    })

    afterEach(() => {
        delete globalThis.document
        delete globalThis.chrome
        vi.restoreAllMocks()
    })

    it('uretim i18n ornegi acilista html lang yazar (node algilamasi: en)', async () => {
        await import('./index.js')
        expect(globalThis.document.documentElement.lang).toBe('en')
    })

    it('kayitli dil uygulaninca html lang kanonik koda guncellenir', async () => {
        // Eski/bolgesiz kayit 'pt' -> applySavedLanguage 'pt-BR'ye cevirir; izleme bunu yakalar.
        globalThis.chrome.storage.local.get = vi.fn(async () => ({ language: 'pt' }))
        await import('./index.js')
        await vi.waitFor(() => expect(globalThis.document.documentElement.lang).toBe('pt-BR'))
    })

    it('gecersiz kayitli dil html lang degerini bozmaz', async () => {
        globalThis.chrome.storage.local.get = vi.fn(async () => ({ language: 'zz' }))
        await import('./index.js')
        // applySavedLanguage zz'yi reddeder (null doner); lang algilanan dilde kalir.
        await new Promise((r) => setTimeout(r, 0))
        expect(globalThis.document.documentElement.lang).toBe('en')
    })

    it('document yokken index.js yine de yuklenir', async () => {
        delete globalThis.document
        const { default: i18n } = await import('./index.js')
        expect(i18n.global.locale.value).toBe('en')
    })
})

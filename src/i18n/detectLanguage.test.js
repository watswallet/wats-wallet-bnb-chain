// Dil kodu cozumleme (resolveLanguage / detectLanguage / applySavedLanguage) ve
// languages.js dil katalogu.
//
// KOK NEDEN: eski kod dil kodunu '-' ile kesiyordu ('pt-BR' -> 'pt'). Yalnizca
// SUPPORTED_LANGS'a 'pt-BR' eklemek yetmezdi: kayitli 'pt-BR' okunurken 'pt'ye kesilir,
// listede bulunamaz ve kullanici sessizce 'en'e duserdi. Bu dosya (1) tarayici dili
// cesitlerini, (2) kayit -> okuma gidis-donusunu ve (3) katalog sabitlerini kilitler.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    LANGUAGE_STORAGE_KEY,
    resolveLanguage,
    isSupportedLanguage,
    detectLanguage,
    applySavedLanguage,
} from './detectLanguage'
import {
    FALLBACK_LANG,
    LANGUAGES,
    SUPPORTED_LANGS,
    PLURAL_FORMS,
    CHROME_LOCALE_DIR,
} from './languages'

describe('resolveLanguage', () => {
    it.each([
        ['pt', 'pt-BR'], ['pt-PT', 'pt-BR'], ['pt-BR', 'pt-BR'], ['pt_br', 'pt-BR'], ['PT-br', 'pt-BR'],
        ['zh', 'zh-CN'], ['zh-CN', 'zh-CN'], ['zh-TW', 'zh-CN'], ['zh-Hant-HK', 'zh-CN'],
        ['es', 'es'], ['es-MX', 'es'], ['es-419', 'es'], ['de-AT', 'de'], ['fr-CA', 'fr'],
        ['ja-JP', 'ja'], ['ko-KR', 'ko'], ['vi-VN', 'vi'], ['id-ID', 'id'], ['ru-RU', 'ru'],
        ['tr-TR', 'tr'], ['en-GB', 'en'], ['EN', 'en'],
        // Buyuk 'I' iceren kodlar: toLocaleLowerCase Turkce makinede 'ID' icin noktasiz
        // kucuk i'li bir dizgi uretir; kod yerel ayardan bagimsiz kucultmeli.
        ['ID', 'id'], ['TR-tr', 'tr'],
    ])('resolveLanguage(%s) -> %s', (raw, beklenen) => expect(resolveLanguage(raw)).toBe(beklenen))

    it.each([
        'ar', 'xx', 'nb-NO', '', null, undefined, 42, {},
        // Prototip uyeleri: duz nesne aramasi bunlari bir islev/nesneye cozerdi.
        'constructor', '__proto__', 'toString', 'hasOwnProperty',
    ])('resolveLanguage(%j) -> null', (raw) => expect(resolveLanguage(raw)).toBeNull())

    it('katalogdaki her kod kendi kendine cozulur (kucuk/buyuk harf ve alt cizgi cesitleriyle)', () => {
        for (const kod of SUPPORTED_LANGS) {
            expect(resolveLanguage(kod)).toBe(kod)
            expect(resolveLanguage(kod.toLowerCase())).toBe(kod)
            expect(resolveLanguage(kod.toUpperCase())).toBe(kod)
            expect(resolveLanguage(kod.replace('-', '_'))).toBe(kod)
        }
    })

    it('donen deger her zaman katalogdaki bir kod ya da null', () => {
        const girdiler = ['pt', 'pt-PT', 'zh-TW', 'zh-Hant-HK', 'es-419', 'en-GB', 'ar', 'xx', '', null]
        for (const girdi of girdiler) {
            const sonuc = resolveLanguage(girdi)
            expect(sonuc === null || SUPPORTED_LANGS.includes(sonuc)).toBe(true)
        }
    })
})

describe('isSupportedLanguage', () => {
    it('bolgeli ve bolgesiz desteklenen kodlar icin true', () => {
        expect(isSupportedLanguage('pt-BR')).toBe(true)
        expect(isSupportedLanguage('tr-TR')).toBe(true)
        expect(isSupportedLanguage('pt')).toBe(true)
    })

    it('desteklenmeyen ya da string olmayan degerler icin false', () => {
        expect(isSupportedLanguage('zz')).toBe(false)
        expect(isSupportedLanguage('')).toBe(false)
        expect(isSupportedLanguage(null)).toBe(false)
        expect(isSupportedLanguage(undefined)).toBe(false)
        expect(isSupportedLanguage(['en'])).toBe(false)
    })
})

describe('detectLanguage(nav)', () => {
    it('desteklenmeyen dil basta ise sonraki desteklenen dili secer', () => {
        expect(detectLanguage({ languages: ['ar', 'fr-CA'], language: 'ar' })).toBe('fr')
    })

    it('ilk desteklenen dil kazanir', () => {
        expect(detectLanguage({ languages: ['en-US', 'tr'] })).toBe('en')
    })

    it('languages bossa nav.language kullanilir ve bolgeli kod kesilmez', () => {
        expect(detectLanguage({ languages: [], language: 'pt-BR' })).toBe('pt-BR')
    })

    it('languages hic yoksa yalnizca nav.language okunur', () => {
        expect(detectLanguage({ language: 'ja-JP' })).toBe('ja')
    })

    it('hicbir dil desteklenmiyorsa en', () => {
        expect(detectLanguage({ languages: ['zz'] })).toBe('en')
        expect(detectLanguage({ languages: ['ar'], language: 'xx' })).toBe('en')
        expect(detectLanguage({})).toBe('en')
    })

    it('Portekizce ve Cince cesitleri kanonik koda baglanir', () => {
        expect(detectLanguage({ languages: ['pt-PT'] })).toBe('pt-BR')
        expect(detectLanguage({ languages: ['zh-Hant-HK'] })).toBe('zh-CN')
        expect(detectLanguage({ languages: ['es-419'] })).toBe('es')
    })

    it('languages dizi degilse ya da bozuk ogeler iceriyorsa cokmez', () => {
        expect(detectLanguage({ languages: 'de', language: 'fr' })).toBe('fr')
        expect(detectLanguage({ languages: [null, 42, 'ko-KR'] })).toBe('ko')
    })
})

describe('detectLanguage() argumansiz', () => {
    afterEach(() => { vi.unstubAllGlobals() })

    // TUZAK: Node >= 21'de globalThis.navigator VARDIR ve isletim sistemi dilini verir.
    // Korumayi `typeof window`dan `globalThis.navigator`a cevirmek, i18n/index.js'i import
    // eden onlarca SSR testini gelistiricinin makine diline baglar (Turkce makinede 'tr',
    // Almanca makinede 'de' ...). Burada navigator BILEREK dolu; yine de 'en' donmeli.
    it('window tanimsizken (node ortami) navigator dolu olsa bile en doner', () => {
        vi.stubGlobal('navigator', { languages: ['de-DE'], language: 'de-DE' })
        expect(typeof window).toBe('undefined')
        expect(detectLanguage()).toBe('en')
    })

    it('window varken tarayici dilini navigator.languages sirasiyla okur', () => {
        vi.stubGlobal('window', {})
        vi.stubGlobal('navigator', { languages: ['ar', 'de-AT'], language: 'ar' })
        expect(detectLanguage()).toBe('de')
    })

    it('window varken languages bossa navigator.language kullanilir', () => {
        vi.stubGlobal('window', {})
        vi.stubGlobal('navigator', { languages: [], language: 'pt-PT' })
        expect(detectLanguage()).toBe('pt-BR')
    })

    it('window varken hicbir dil desteklenmiyorsa en', () => {
        vi.stubGlobal('window', {})
        vi.stubGlobal('navigator', { languages: ['ar'], language: 'ar' })
        expect(detectLanguage()).toBe('en')
    })
})

describe('applySavedLanguage', () => {
    let depo

    const sahteI18n = (baslangic = 'en') => ({ global: { locale: { value: baslangic } } })

    beforeEach(() => {
        depo = {}
        globalThis.chrome = {
            storage: {
                local: {
                    get: vi.fn(async (anahtar) => (anahtar in depo ? { [anahtar]: depo[anahtar] } : {})),
                    set: vi.fn(async (nesne) => { Object.assign(depo, nesne) }),
                },
            },
        }
    })

    afterEach(() => {
        delete globalThis.chrome
        vi.restoreAllMocks()
    })

    it('depo anahtari Preferences.vue ile ayni', () => {
        expect(LANGUAGE_STORAGE_KEY).toBe('language')
    })

    // KAYIT -> OKUMA GIDIS-DONUSU: Preferences.vue'nun yazdigi her kod, uygulama acilisinda
    // AYNEN geri uygulanmali; bolgeli kod ('pt-BR') kesilip 'en'e dusmemeli.
    it.each(SUPPORTED_LANGS)('gidis-donus: %s kaydedilir ve ayni kod uygulanir', async (kod) => {
        await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: kod })
        // Baslangic dili hedefle ayni olmasin ki yazma gercekten sinansin.
        const i18n = sahteI18n(kod === 'en' ? 'tr' : 'en')

        const donen = await applySavedLanguage(i18n)

        expect(donen).toBe(kod)
        expect(i18n.global.locale.value).toBe(kod)
        expect(chrome.storage.local.get).toHaveBeenCalledWith('language')
    })

    it.each([
        ['pt', 'pt-BR'],
        ['zh-TW', 'zh-CN'],
        ['es-MX', 'es'],
        ['PT-br', 'pt-BR'],
    ])('depodaki eski/bolgeli deger %s kanonik %s koduna cevrilir', async (kayitli, beklenen) => {
        await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: kayitli })
        const i18n = sahteI18n('en')

        expect(await applySavedLanguage(i18n)).toBe(beklenen)
        expect(i18n.global.locale.value).toBe(beklenen)
    })

    it.each(['zz', '', 42, null, {}])('depodaki gecersiz deger %j icin null doner ve dil degismez', async (kayitli) => {
        await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: kayitli })
        const i18n = sahteI18n('tr')

        expect(await applySavedLanguage(i18n)).toBeNull()
        expect(i18n.global.locale.value).toBe('tr')
    })

    it('depoda dil kaydi yoksa null doner ve dil degismez', async () => {
        const i18n = sahteI18n('tr')

        expect(await applySavedLanguage(i18n)).toBeNull()
        expect(i18n.global.locale.value).toBe('tr')
    })

    it('chrome tanimsizsa cokmez, null doner ve dil degismez', async () => {
        delete globalThis.chrome
        const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const i18n = sahteI18n('tr')

        await expect(applySavedLanguage(i18n)).resolves.toBeNull()
        expect(i18n.global.locale.value).toBe('tr')
        expect(uyari).toHaveBeenCalledTimes(1)
    })

    it('depo okuma hatasinda cokmez, null doner ve dil degismez', async () => {
        chrome.storage.local.get.mockRejectedValueOnce(new Error('depo kapali'))
        const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const i18n = sahteI18n('tr')

        await expect(applySavedLanguage(i18n)).resolves.toBeNull()
        expect(i18n.global.locale.value).toBe('tr')
        expect(uyari).toHaveBeenCalledTimes(1)
    })
})

describe('languages.js dil katalogu', () => {
    const SIRA = ['es', 'pt-BR', 'ru', 'zh-CN', 'vi', 'id', 'ko', 'ja', 'de', 'fr', 'tr', 'en']
    const ULKE = {
        es: 'ES', 'pt-BR': 'BR', ru: 'RU', 'zh-CN': 'CN', vi: 'VN', id: 'ID',
        ko: 'KR', ja: 'JP', de: 'DE', fr: 'FR', tr: 'TR', en: 'US',
    }
    // Bayrak emojisi = iki "bolgesel gosterge" kod noktasi (A = U+1F1E6).
    const bayrak = (ulke) => String.fromCodePoint(...[...ulke].map((h) => 0x1f1e6 + h.charCodeAt(0) - 65))

    it('12 dil secici sirasiyla listelenir', () => {
        expect(LANGUAGES.map((l) => l.code)).toEqual(SIRA)
        expect(SUPPORTED_LANGS).toEqual(SIRA)
    })

    it('her dil kendi adiyla yazilir', () => {
        expect(LANGUAGES.map((l) => l.name)).toEqual([
            'Español', 'Português (Brasil)', 'Русский', '简体中文', 'Tiếng Việt', 'Bahasa Indonesia',
            '한국어', '日本語', 'Deutsch', 'Français', 'Türkçe', 'English',
        ])
    })

    it('adlar Unicode NFC (secici ve algilama ayni dizgiyi gorur)', () => {
        for (const { name } of LANGUAGES) expect(name).toBe(name.normalize('NFC'))
    })

    it('bayraklar ulke kodundan turetilen emojilerdir', () => {
        for (const { code, flag } of LANGUAGES) expect(flag).toBe(bayrak(ULKE[code]))
    })

    it('her ogede yalnizca code, name ve flag vardir ve kodlar tekildir', () => {
        for (const dil of LANGUAGES) expect(Object.keys(dil).sort()).toEqual(['code', 'flag', 'name'])
        expect(new Set(SUPPORTED_LANGS).size).toBe(SUPPORTED_LANGS.length)
    })

    it('geri dusme dili en ve katalogda', () => {
        expect(FALLBACK_LANG).toBe('en')
        expect(SUPPORTED_LANGS).toContain(FALLBACK_LANG)
    })

    it('cogul bicim sayilari dil kurallariyla birebir', () => {
        expect(PLURAL_FORMS).toEqual({
            es: 2, 'pt-BR': 2, ru: 3, 'zh-CN': 1, vi: 1, id: 1, ko: 1, ja: 1, de: 2, fr: 2, tr: 1, en: 2,
        })
        expect(Object.keys(PLURAL_FORMS).sort()).toEqual([...SUPPORTED_LANGS].sort())
    })

    it('_locales klasorleri: bolgeli kodlarda tire alt cizgi olur, digerleri ayni', () => {
        expect(CHROME_LOCALE_DIR).toEqual({
            es: 'es', 'pt-BR': 'pt_BR', ru: 'ru', 'zh-CN': 'zh_CN', vi: 'vi', id: 'id',
            ko: 'ko', ja: 'ja', de: 'de', fr: 'fr', tr: 'tr', en: 'en',
        })
    })

    it('sabitler donmus: paylasilan katalog calisma aninda degistirilemez', () => {
        expect(Object.isFrozen(LANGUAGES)).toBe(true)
        expect(LANGUAGES.every((dil) => Object.isFrozen(dil))).toBe(true)
        expect(Object.isFrozen(SUPPORTED_LANGS)).toBe(true)
        expect(Object.isFrozen(PLURAL_FORMS)).toBe(true)
        expect(Object.isFrozen(CHROME_LOCALE_DIR)).toBe(true)
    })
})

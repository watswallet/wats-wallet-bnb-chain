// Rusca cogul kurali (3 bicim) ve vue-i18n'e baglanmasi (spec Bolum C, Review Focus 4).
//
// vue-i18n'in varsayilan kurali iki bicimlidir (1 -> 0, digerleri -> 1); Rusca "ya | yb | yc"
// mesajinda 2 sayisi 'yb'ye, 5 sayisi 'yc'ye dusmeli. Tek bicimli dillerde (ja, zh-CN, ko,
// vi, id, tr) `|` yoktur ve t(key, {count}, n) cagrisi patlamamalidir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createI18n } from 'vue-i18n'
import { ruPlural, pluralRules } from './pluralRules.js'

describe('ruPlural (CLDR Rusca: bir / birkac / cok)', () => {
    it.each([
        [1, 0], [21, 0], [101, 0],
        [2, 1], [4, 1], [22, 1], [24, 1],
        [0, 2], [5, 2], [11, 2], [12, 2], [14, 2], [25, 2], [111, 2], [112, 2],
    ])('ruPlural(%i) -> %i', (n, idx) => {
        expect(ruPlural(n, 3)).toBe(idx)
    })

    it('eksi sayida mutlak degeri kullanir', () => {
        expect(ruPlural(-1, 3)).toBe(0)
        expect(ruPlural(-2, 3)).toBe(1)
        expect(ruPlural(-5, 3)).toBe(2)
    })

    it('parca sayisindan buyuk indeks donmez (hatali 2 parcali mesaj cokmesin)', () => {
        expect(ruPlural(5, 2)).toBe(1)
        expect(ruPlural(2, 2)).toBe(1)
        expect(ruPlural(1, 2)).toBe(0)
        expect(ruPlural(5, 1)).toBe(0)
    })

    it('pluralRules nesnesi yalnizca ru icin kural tasir', () => {
        expect(Object.keys(pluralRules)).toEqual(['ru'])
        expect(pluralRules.ru).toBe(ruPlural)
    })
})

describe('createI18n ile Rusca cogul', () => {
    const rusca = () => createI18n({
        legacy: false,
        locale: 'ru',
        pluralRules,
        messages: { ru: { k: 'ya | yb | yc' } },
    })

    it.each([
        [1, 'ya'], [21, 'ya'],
        [2, 'yb'], [22, 'yb'],
        [0, 'yc'], [5, 'yc'], [11, 'yc'], [12, 'yc'], [111, 'yc'],
    ])('t(k, {count: %i}, %i) -> %s', (n, beklenen) => {
        const { t } = rusca().global
        expect(t('k', { count: n }, n)).toBe(beklenen)
    })
})

describe('hatali 2 parcali Rusca mesaj', () => {
    it('t() firlatmaz, son parcaya duser', () => {
        const i18n = createI18n({
            legacy: false,
            locale: 'ru',
            pluralRules,
            messages: { ru: { k: 'ya | yb' } },
        })
        expect(i18n.global.t('k', { count: 5 }, 5)).toBe('yb')
        expect(i18n.global.t('k', { count: 1 }, 1)).toBe('ya')
    })
})

describe('Rusca arayuzde en yedegine dusen cogul anahtar', () => {
    // fallbackLocale 'en': ru'da eksik anahtar 2 parcali Ingilizce mesajdan gelir. Kural ru
    // icin calisir; parca sayisina kisaltma olmasa n=5 burada da firlatirdi.
    it('2 parcali en mesaji ru dilinde cokmeden basilir', () => {
        const i18n = createI18n({
            legacy: false,
            locale: 'ru',
            fallbackLocale: 'en',
            missingWarn: false,
            fallbackWarn: false,
            pluralRules,
            messages: { ru: {}, en: { k: '{count} item | {count} items' } },
        })
        expect(i18n.global.t('k', { count: 1 }, 1)).toBe('1 item')
        expect(i18n.global.t('k', { count: 5 }, 5)).toBe('5 items')
        expect(i18n.global.t('k', { count: 0 }, 0)).toBe('0 items')
    })
})

describe('tek bicimli dil (ja) cogul kuralindan etkilenmez', () => {
    it.each([[0, '≈ 0 回'], [1, '≈ 1 回'], [5, '≈ 5 回']])('n=%i patlamadan basar', (n, beklenen) => {
        const i18n = createI18n({
            legacy: false,
            locale: 'ja',
            pluralRules,
            messages: { ja: { k: '≈ {count} 回' } },
        })
        expect(i18n.global.t('k', { count: n }, n)).toBe(beklenen)
    })
})

describe('i18n/index.js baglantisi', () => {
    beforeEach(() => {
        // index.js import edilirken applySavedLanguage chrome.storage.local.get'i cagirir;
        // tanimsiz chrome console.warn gurultusu uretirdi.
        globalThis.chrome = { storage: { local: { get: vi.fn(async () => ({})) } } }
        vi.resetModules()
    })

    afterEach(() => {
        delete globalThis.chrome
        vi.restoreAllMocks()
    })

    it('uretim i18n ornegi ruPlural kuralini kullanir', async () => {
        const { ruPlural: kural } = await import('./pluralRules.js')
        const { default: i18n } = await import('./index.js')
        expect(i18n.global.pluralRules.ru).toBe(kural)
    })
})

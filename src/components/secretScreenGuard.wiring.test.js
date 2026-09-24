import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// KAYNAK KILIDI -- sirri EKRANA BASAN dort bilesenin hepsi korumaya bagli
// olmali. Bu bilesenler SSR'da mount edilemiyor (props olarak canli sir
// bekliyorlar), bu yuzden tel kaynak duzeyinde kilitleniyor.
//
// Listenin DOGRU olmasi onemli: parola istemleri (ShowPhrases / ShowPrivateKey /
// ShowTonKey) sirri GOSTERMEZ, emit eder -- onlarda korunacak bir sey yok.
const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

const SIR_EKRANLARI = [
    'components/settings/security/ShowPhrase.vue',
    'components/settings/accounts/Phrases.vue',
    'components/settings/accounts/PrivateKey.vue',
    'components/settings/accounts/TonKey.vue',
]

const PAROLA_ISTEMLERI = [
    'components/settings/accounts/ShowPhrases.vue',
    'components/settings/accounts/ShowPrivateKey.vue',
    'components/settings/accounts/ShowTonKey.vue',
]

describe('sir ekranlari -- gorunurluk korumasi bagli', () => {
    for (const yol of SIR_EKRANLARI) {
        it(`${yol} useSecretScreenGuard kullanir`, () => {
            const kaynak = read(yol)
            expect(kaynak).toContain('useSecretScreenGuard')
            expect(kaynak).toMatch(/from ['"](\.\.\/)+composables\/useSecretScreenGuard['"]/)
        })
    }

    for (const yol of PAROLA_ISTEMLERI) {
        it(`${yol} bir sir ekrani DEGIL, korumaya baglanmaz`, () => {
            expect(read(yol)).not.toContain('useSecretScreenGuard')
        })
    }
})

describe('App.vue -- ebeveyndeki sir referanslari temizleniyor', () => {
    const app = read('popup/App.vue')

    it('uc sir ref i icin de temizleyici var', () => {
        expect(app).toMatch(/const clearMnemonic = \(\) => \{/)
        expect(app).toMatch(/const clearPrivateKey = \(\) => \{/)
        expect(app).toMatch(/const clearTonKey = \(\) => \{/)
    })

    it('dort ekran da temizleyicisini @clear ile bagliyor', () => {
        expect(app).toMatch(/<Phrases[^>]*@clear="clearMnemonic"/)
        expect(app).toMatch(/<ShowPhrase[^>]*@clear="clearMnemonic"/)
        expect(app).toMatch(/<PrivateKey[^>]*@clear="clearPrivateKey"/)
        expect(app).toMatch(/<TonKey[^>]*@clear="clearTonKey"/)
    })
})

// KAYNAK KILIDI -- `@clear`in KACIRDIGI iki yol.
//
// App.vue SSR'da mount edilemiyor (canli chrome.* ve store'lar bekliyor), bu
// yuzden tel kaynak duzeyinde kilitleniyor; ayni kalip sessionLifecycle.test.js
// ve yukaridaki blokta da kullaniliyor.
describe('App.vue -- sirlar zincir disina cikilinca ve kilitlenince duser', () => {
    const app = read('popup/App.vue')
    const TEMIZLEYICILER = ['clearMnemonic()', 'clearPrivateKey()', 'clearTonKey()']

    // 1. YOL: SESSION_EXPIRED.
    // Isleyici `clearTonMnemonicCache()` cagiriyordu ama uc ref'e DOKUNMUYORDU:
    // cuzdan kilitlenmis, ekran `welcome`a dusmus, ama acik panelin belleginde
    // cozulmus kurtarma ifadesi / ozel anahtar / TON anahtari duruyordu.
    describe('SESSION_EXPIRED uc sirri da temizler', () => {
        const basla = app.indexOf("message.type === 'SESSION_EXPIRED'")
        const bit = app.indexOf("page.currentPage = 'welcome'", basla)
        const blok = app.slice(basla, bit)

        it('blok bulunabiliyor (kaynak kilidi hala dogru yere bakiyor)', () => {
            expect(basla).toBeGreaterThan(-1)
            expect(bit).toBeGreaterThan(basla)
        })

        for (const cagri of TEMIZLEYICILER) {
            it(`${cagri} cagriliyor`, () => {
                expect(blok).toContain(cagri)
            })
        }

        it('TON onbellegi bosaltmasi KORUNUYOR', () => {
            expect(blok).toContain('clearTonMnemonicCache()')
        })
    })

    // 2. YOL: sayfa degisimi.
    // Dort parola kapisi sirri ONCE ebeveyne emit edip SONRA bir UYARI sayfasina
    // geciyor; korunan sir ekrani bir adim DAHA ileride ve `@clear` yalnizca
    // ORANIN `onUnmounted`inda atiliyor. Uyaridan vazgecen kullanicida sir
    // ekrani HIC mount olmaz -- ham sir belge yasadigi surece ref'te asili
    // kalirdi. Yan panel kapanmadigi icin bu GUNLER demek.
    describe('sayfa izleyicisi zincir disinda uc sirri da temizler', () => {
        const zincirBasla = app.indexOf('const SIR_ZINCIRI = [')
        const zincirBit = app.indexOf(']', zincirBasla)
        const zincir = app.slice(zincirBasla, zincirBit)

        const izleyiciBasla = app.indexOf('watch(() => page.currentPage', zincirBit)
        const izleyici = app.slice(izleyiciBasla, app.indexOf('\n})', izleyiciBasla))

        // Zincirdeki sayfa adlari TAHMIN EDILMEDI, sablondan dogrulaniyor:
        // her ad gercekten render edilen bir sayfaya karsilik gelmeli.
        const ZINCIR_SAYFALARI = [
            'settings_show_phrases', 'settings_phrase_disclaimer', 'settings_phrases',
            'settings_show_private_key', 'settings_private_key_disclaimer', 'settings_private_key',
            'settings_show_ton_key', 'settings_ton_key_disclaimer', 'settings_ton_key',
            'settings_security_unlock_vault', 'settings_security_phrases_disclaimer',
            'settings_security_show_phrase',
        ]

        it('SIR_ZINCIRI listesi var', () => {
            expect(zincirBasla).toBeGreaterThan(-1)
            expect(zincirBit).toBeGreaterThan(zincirBasla)
        })

        for (const sayfa of ZINCIR_SAYFALARI) {
            it(`${sayfa} zincirde ve sablonda var`, () => {
                expect(zincir).toContain(`'${sayfa}'`)
                expect(app).toContain(`page.currentPage === '${sayfa}'`)
            })
        }

        it('zincir disina cikinca uc temizleyici de cagriliyor', () => {
            expect(izleyiciBasla).toBeGreaterThan(-1)
            expect(izleyici).toContain('SIR_ZINCIRI.includes')
            for (const cagri of TEMIZLEYICILER) expect(izleyici).toContain(cagri)
        })
    })
})

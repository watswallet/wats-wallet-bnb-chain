// Surum metni: Login, Ayarlar ve Hakkinda ekranlari package.json surumunu basar.
// package.json bu ekranlarda ADLI import ile okunur (gerekce:
// tonInjectedTekParca.test.js); gorunen metin degismemeli.
//
// 'vue' mock'u BURADA olmak ZORUNDA (hoisting; bkz. test-utils/ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { readFileSync } from 'node:fs'
import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import en from '../i18n/locales/en.json'
import tr from '../i18n/locales/tr.json'
import Login from './Login.vue'
import Settings from './Settings.vue'
import About from './settings/About.vue'

// Literal degil DOSYADAN: surum artisi testi bozmaz.
const SURUM = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

async function ciz(Bilesen, locale = 'en') {
    installChromeStub()
    const app = createApp(Bilesen, { use: [createTestPinia(), createTestI18n(locale)] })
    // SSR sablon yorumlarini basar; iddialar yalniz cizilen icerige bakar.
    return (await render(app)).replace(/<!--[\s\S]*?-->/g, '')
}

afterEach(() => { delete globalThis.chrome })

describe('surum metni package.json surumunu basar', () => {
    it('beklenen surum gercek bir semver', () => {
        // Bos surum, asagidaki iddialari bos yere gecirirdi.
        expect(SURUM).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('Login alt cubugu: v<surum>', async () => {
        expect(await ciz(Login)).toContain(`>v${SURUM}</span>`)
    })

    it('Ayarlar alt satiri: Version <surum> - WATS Wallet', async () => {
        expect(await ciz(Settings)).toContain(`Version ${SURUM} • WATS Wallet</p>`)
    })

    it.each([['en', en], ['tr', tr]])('Hakkinda surum rozeti (%s)', async (locale, mesajlar) => {
        const beklenen = mesajlar.settings.about.version.replace('{v}', SURUM)
        expect(beklenen).toContain(SURUM)
        expect(await ciz(About, locale)).toContain(`>${beklenen}</span>`)
    })
})

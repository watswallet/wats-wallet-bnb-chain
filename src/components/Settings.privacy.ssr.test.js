// Ayarlar gizli modda: "Hesaplari yonet" satiri CIZILMEZ. O ekran normal hesaplari listeler ve "Cuzdan ekle"
// uzerinden yeni hesap turetir; yeni hesap aktif olunca gizli mod sessizce kapanir (Header cekmecesiyle ayni kural).
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { privacyStore } from '../store/privacy'
import Settings from './Settings.vue'

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function kur({ gizli }) {
    installChromeStub({ vaults: [], dapps: {} })
    const app = createApp(Settings)
    app.use(createTestPinia())
    app.use(createTestI18n())
    privacyStore().active = gizli
    return app
}

describe('Settings.vue (SSR) -- gizli mod', () => {
    it('gizli modda Hesaplari yonet satiri CIZILMEZ', async () => {
        const html = await render(kur({ gizli: true }))
        expect(html).not.toContain('Manage Accounts')
    })

    it('pozitif kontrol: genel modda Hesaplari yonet satiri cizilir', async () => {
        const html = await render(kur({ gizli: false }))
        expect(html).toContain('Manage Accounts')
    })
})

// Satir ikonlarinin hover rengi (son inceleme, 2026-10-27): gizli modda esleme indigo hover'i griye cekiyor, zumrut/mavi/
// amber hover'lar renkli kaliyordu; zumrut gizli modda yalniz "bir koruma acik" demek. Gizli modda hepsi tek notr hover.
describe('Settings.vue (SSR) -- gizli modda satir ikonlarinin hover rengi notr', () => {
    // SSR dinamik siniflari ONE yazar: sira varsayilmaz, karo statik siniflarinin hepsini tasiyan ogedir.
    const KARO = 'p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800/50'
    const karolar = (html) => [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1].split(/\s+/).filter(Boolean)).filter((s) => KARO.split(' ').every((k) => s.includes(k))).map((s) => s.sort())
    const renkli = (r) => [...KARO.split(' '), `group-hover:bg-${r}-100`, `dark:group-hover:bg-${r}-500/20`, `group-hover:text-${r}-600`, `dark:group-hover:text-${r}-400`, 'transition-colors', 'duration-300'].sort()

    it('KONTROL: normal modda her satirin kendi hover rengi (hesaplar/tercihler indigo, adres defteri zumrut, dapp mavi, guvenlik amber, hakkinda mavi)', async () => {
        const html = await render(kur({ gizli: false }))
        expect(karolar(html)).toEqual(['indigo', 'indigo', 'emerald', 'blue', 'amber', 'blue'].map(renkli))
    })

    it('gizli modda her satirda ayni notr hover: renk yok, ikon murekkebe koyulasir', async () => {
        const html = await render(kur({ gizli: true }))
        const notr = [...KARO.split(' '), 'group-hover:bg-zinc-200', 'dark:group-hover:bg-white/10', 'group-hover:text-zinc-950', 'dark:group-hover:text-white', 'transition-colors', 'duration-300'].sort()
        expect(karolar(html)).toEqual(Array(5).fill(notr))
    })
})

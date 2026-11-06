// Hesap ekranlari (Hesaplari yonet ve ondan acilan her sey) gizli modda ERISILEMEZ: giris dugmeleri cizilmez
// (Header.privacy.ssr.test.js, Settings.privacy.ssr.test.js). Gizli mod BASKA bir panelden (uiSync) acilirsa bu panel o
// ekranlarda kalmaz, eve doner (privatePageGuard.js). Aksi halde "Hesap olustur" ile turetilen yeni hesap aktif olur ve gizli
// mod sessizce kapanir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { nextTick, watch } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { pageStore } from '../store/pageStore'
import { privacyStore } from '../store/privacy'
import { leaveAccountPagesWhenOn, ACCOUNT_PAGES } from './privatePageGuard'
import { yorumsuz } from '../test-utils/kaynakTarama'

const app = yorumsuz(readFileSync(fileURLToPath(new URL('./App.vue', import.meta.url)), 'utf8'))

function kur(sayfa, gizli = false) {
    setActivePinia(createPinia())
    const page = pageStore()
    const privacy = privacyStore()
    privacy.active = gizli
    page.currentPage = sayfa
    const stop = watch(() => privacy.active, (on) => leaveAccountPagesWhenOn(on, page))
    return { page, privacy, stop }
}

describe('leaveAccountPagesWhenOn: hesap ekranindayken gizli mod acilirsa panel eve doner', () => {
    it.each(ACCOUNT_PAGES)('%s -> home', async (sayfa) => {
        const { page, privacy, stop } = kur(sayfa)
        privacy.active = true
        await nextTick()
        expect(page.currentPage).toBe('home')
        stop()
    })

    it('hesap disi bir ayar ekraninda kalinir', async () => {
        const { page, privacy, stop } = kur('settings_preferences')
        privacy.active = true
        await nextTick()
        expect(page.currentPage).toBe('settings_preferences')
        stop()
    })

    it('gizli mod KAPANIRKEN hesap ekranina dokunulmaz', async () => {
        const { page, privacy, stop } = kur('settings_create_account', true)
        privacy.active = false
        await nextTick()
        expect(page.currentPage).toBe('settings_create_account')
        stop()
    })
})

describe('ACCOUNT_PAGES kapsami', () => {
    it('hesap olusturma yolu ve sir ekranlari listede', () => {
        for (const sayfa of ['settings_manage_accounts', 'settings_add_wallet', 'settings_create_account', 'settings_edit_account']) {
            expect(ACCOUNT_PAGES).toContain(sayfa)
        }
        // App.vue'daki sir zincirinin hesap duzenleme ekranindan acilan her ekrani. Kasa ifadesi ekranlari
        // (settings_security_*) Guvenlik'ten acilir, hesap akisina ait degildir.
        const zincir = /const SIR_ZINCIRI = \[([\s\S]*?)\]/.exec(app)
        expect(zincir, 'SIR_ZINCIRI bulunamadi').not.toBeNull()
        const sirlar = [...zincir[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((s) => !s.startsWith('settings_security_'))
        expect(sirlar.length).toBeGreaterThan(0)
        for (const sayfa of sirlar) expect(ACCOUNT_PAGES).toContain(sayfa)
    })

    it('listedeki her ekran App.vue da baglidir', () => {
        for (const sayfa of ACCOUNT_PAGES) expect(app).toContain(`page.currentPage === '${sayfa}'`)
    })
})

describe('App.vue: izleyici', () => {
    it('AYRI bir satirdir ve yalniz DEGISIMDE calisir', () => {
        const m = /watch\(\(\) => privacy\.active, \(on\) => leaveAccountPagesWhenOn\(on, page\)\)/.exec(app)
        expect(m).not.toBeNull()
        expect(app.slice(m.index, m.index + m[0].length + 40)).not.toMatch(/immediate|flush:\s*'sync'/)
        // Mevcut iki izleyici AYNEN durur.
        expect(app).toMatch(/watch\(\(\) => privacy\.active, \(on\) => leavePrivatePagesWhenOff\(on, page\)\)/)
        expect(app).toMatch(/watch\(\(\) => privacy\.active, \(on\) => leaveStockPagesWhenOn\(on, page, crypto\)\)/)
    })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { nextTick, watch } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { pageStore } from '../store/pageStore'
import { privacyStore } from '../store/privacy'
import { leavePrivatePagesWhenOff, PRIVATE_PAGES } from './privatePageGuard'
import { yorumsuz } from '../test-utils/kaynakTarama'

// App.vue current_request.type'i UC ayri switch'te yonlendirir (kilidi acik, kilitli,
// canli degisim) ve cozulen istek icin bir "home'a don" listesi tutar. Yeni tip
// birinde unutulursa popup bos pencere gosterir ya da onay ekraninda takili kalir.
const app = readFileSync(fileURLToPath(new URL('./App.vue', import.meta.url)), 'utf8')

describe('PRIVACY_BLOCKED yonlendirmesi', () => {
    it('uc switch\'te de var', () => {
        expect(app.match(/case 'PRIVACY_BLOCKED'/g)?.length).toBe(3)
    })

    it('temizleme listesinde var ve sayfa render ediliyor', () => {
        expect(app).toMatch(/\[[^\]]*'privacy_blocked'[^\]]*\]\.includes\(page\.currentPage\)/)
        expect(app).toContain(`page.currentPage === 'privacy_blocked'`)
    })
})

const home = readFileSync(fileURLToPath(new URL('../components/Home.vue', import.meta.url)), 'utf8')

describe('Gizli ekran yonlendirmesi (Task 18)', () => {
    it('U-M8 Home nin her private_* hedefinin App.vue da karsilik gelen rotasi var', () => {
        const hedefler = [...new Set([...home.matchAll(/'(private_[a-z_]+)'/g)].map((m) => m[1]))]
        // Emniyet kemeri: tarama bos kalirsa test anlamsiz yesil olmasin.
        expect(hedefler.sort()).toEqual(['private_bridge', 'private_fund', 'private_send', 'private_swap'])
        for (const rota of hedefler) {
            expect(app, rota).toContain(`page.currentPage === '${rota}'`)
        }
    })

    it('App.vue nin her page.currentPage === private_* rotasi PRIVATE_PAGES icinde ve rotalar tam dort ekrandir', () => {
        const rotalar = [...new Set([...yorumsuz(app).matchAll(/page\.currentPage === '(private_[a-z_]+)'/g)].map((m) => m[1]))]
        // Emniyet kemeri: sessiz bos tarama yesil gecmesin.
        expect(rotalar.length).toBeGreaterThan(0)
        for (const rota of rotalar) expect(PRIVATE_PAGES, rota).toContain(rota)
        expect([...rotalar].sort()).toEqual(['private_bridge', 'private_fund', 'private_send', 'private_swap'])
    })

    it('U-I3 gizli mod kapaninca dort gizli ekran eve doner: GERCEK store ve Vue watch ile (T25 U:M-8a)', async () => {
        setActivePinia(createPinia())
        const privacy = privacyStore()
        const page = pageStore()
        const stop = watch(() => privacy.active, (on) => leavePrivatePagesWhenOff(on, page))
        try {
            for (const rota of PRIVATE_PAGES) {
                privacy.active = true
                await nextTick()
                page.currentPage = rota
                privacy.active = false
                await nextTick()
                expect(page.currentPage, rota).toBe('home')
            }
            // Gizli olmayan ekranda kalinir: mod kapaninca baska ekran eve zorlanmaz.
            privacy.active = true
            await nextTick()
            page.currentPage = 'settings'
            privacy.active = false
            await nextTick()
            expect(page.currentPage).toBe('settings')
        } finally {
            stop()
        }
    })

    it('mod kapaninca gizli ekranin biraktigi tek seferlik not da silinir; mod acilinca dokunulmaz (T25 U:M-2)', async () => {
        setActivePinia(createPinia())
        const privacy = privacyStore()
        const page = pageStore()
        const stop = watch(() => privacy.active, (on) => leavePrivatePagesWhenOff(on, page))
        try {
            privacy.active = true
            await nextTick()
            page.ordersNotice = 'privacy.orders.unconfirmedNotice'
            page.currentPage = 'home'
            privacy.active = false
            await nextTick()
            expect(page.ordersNotice).toBeNull()
            page.ordersNotice = 'privacy.orders.unconfirmedNotice'
            privacy.active = true
            await nextTick()
            expect(page.ordersNotice).toBe('privacy.orders.unconfirmedNotice')
        } finally {
            stop()
        }
    })

    it('U-I3b mod kapaninca Token\'dan gelen tek seferlik privateSwapSource SILINMEZ, panel eve doner (ekran onu acilista kendisi tuketir)', async () => {
        setActivePinia(createPinia())
        const privacy = privacyStore()
        const page = pageStore()
        const stop = watch(() => privacy.active, (on) => leavePrivatePagesWhenOff(on, page))
        try {
            privacy.active = true
            await nextTick()
            page.privateSwapSource = { chainId: 137, asset: 'USDC' }
            page.currentPage = 'private_swap'
            privacy.active = false
            await nextTick()
            expect(page.currentPage).toBe('home')
            expect(page.privateSwapSource).toEqual({ chainId: 137, asset: 'USDC' })
        } finally {
            stop()
        }
    })

    it('izleyici yalniz DEGISIMDE calisir (immediate/sync yok) ve ekran sinifi listesi dort ekrandir', () => {
        const m = /watch\(\(\) => privacy\.active, \(on\) => leavePrivatePagesWhenOff\(on, page\)\)/.exec(app)
        expect(m).not.toBeNull()
        expect(app.slice(m.index, m.index + m[0].length + 40)).not.toMatch(/immediate|flush:\s*'sync'/)
        expect([...PRIVATE_PAGES].sort()).toEqual(['private_bridge', 'private_fund', 'private_send', 'private_swap'])
        // Gizli islemler artik ayri sayfa degil, ana ekran sekmesi.
        expect(app).not.toContain("'private_orders'")
    })
})

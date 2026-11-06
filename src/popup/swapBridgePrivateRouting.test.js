// Klasik Takas (swap) ve Kopru (bridge) sayfalari gizli modda VITE_PRIVATE_SWAP_BRIDGE'nin degerinden BAGIMSIZ kapalidir: Kopru hic
// baglanmaz, Takas yalniz "yalniz ATS satin alma" kipinde baglanir. Gizli mod BASKA bir panelden (uiSync) ACILIRSA bu panel kapanan
// bir sayfada bos kalmasin: eve doner (privatePageGuard.js leaveSwapBridgePagesWhenOn; leaveStockPagesWhenOn ile ayni desen).
// SSR render'i izleyici calistirmaz: burada GERCEK store + Vue watch + nextTick kullanilir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { nextTick, watch } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { pageStore } from '../store/pageStore'
import { privacyStore } from '../store/privacy'
import { leaveSwapBridgePagesWhenOn, SWAP_BRIDGE_PAGES } from './privatePageGuard'
import { yorumsuz } from '../test-utils/kaynakTarama'

const app = yorumsuz(readFileSync(fileURLToPath(new URL('./App.vue', import.meta.url)), 'utf8'))

describe('leaveSwapBridgePagesWhenOn: gizli mod acilinca klasik Takas / Kopru sayfasindan eve donulur', () => {
    it('SWAP_BRIDGE_PAGES tam iki sayfadir: swap ve bridge', () => {
        expect([...SWAP_BRIDGE_PAGES]).toEqual(['swap', 'bridge'])
    })

    it('bridge sayfasi, gizli mod acilinca eve doner (swapShown ne olursa olsun, bayraktan bagimsiz)', () => {
        for (const swapShown of [true, false, undefined]) {
            const page = { currentPage: 'bridge' }
            leaveSwapBridgePagesWhenOn(true, page, swapShown)
            expect(page.currentPage, String(swapShown)).toBe('home')
        }
    })

    it('swap sayfasi, ATS satin alma kapali (swapShown false ya da verilmedi): eve doner', () => {
        for (const swapShown of [false, undefined]) {
            const page = { currentPage: 'swap' }
            leaveSwapBridgePagesWhenOn(true, page, swapShown)
            expect(page.currentPage, String(swapShown)).toBe('home')
        }
    })

    it('swap sayfasi, ATS satin alma acik (swapShown === true): yerinde kalir', () => {
        const page = { currentPage: 'swap' }
        leaveSwapBridgePagesWhenOn(true, page, true)
        expect(page.currentPage).toBe('swap')
    })

    it('diger sayfalara dokunmaz; mod KAPANIRKEN swap ve bridge de yerinde kalir', () => {
        // private_swap / private_bridge (SilentSwap) klasik sayfa DEGILDIR: listeye girmezler, eve gonderilmezler.
        for (const sayfa of ['token', 'home', 'private_swap', 'private_bridge', 'private_send', 'settings']) {
            const page = { currentPage: sayfa }
            leaveSwapBridgePagesWhenOn(true, page, false)
            expect(page.currentPage, sayfa).toBe(sayfa)
        }
        for (const sayfa of ['swap', 'bridge']) {
            const page = { currentPage: sayfa }
            leaveSwapBridgePagesWhenOn(false, page, false)
            expect(page.currentPage, sayfa).toBe(sayfa)
        }
    })

    it('en cok BIR kez yazar; dokunulmayan sayfaya hic yazmaz', () => {
        const sayacliSayfa = (ilk) => {
            const durum = { yazim: 0, simdiki: ilk }
            const page = {
                get currentPage() { return durum.simdiki },
                set currentPage(v) { durum.yazim += 1; durum.simdiki = v },
            }
            return { page, durum }
        }
        const { page, durum } = sayacliSayfa('bridge')
        leaveSwapBridgePagesWhenOn(true, page, false)
        expect(durum.yazim).toBe(1)
        expect(durum.simdiki).toBe('home')
        // Ikinci cagri: sayfa artik home, yazim sayisi artmaz.
        leaveSwapBridgePagesWhenOn(true, page, false)
        expect(durum.yazim).toBe(1)
        // Dokunulmayan sayfa: hic yazilmaz.
        const baska = sayacliSayfa('token')
        leaveSwapBridgePagesWhenOn(true, baska.page, false)
        expect(baska.durum.yazim).toBe(0)
    })

    it('GERCEK store ve Vue watch ile: bridge -> home; swap: satis kapaliyken home, acikken yerinde; mod kapaninca dokunulmaz', async () => {
        setActivePinia(createPinia())
        const privacy = privacyStore()
        const page = pageStore()
        let swapShown = false
        const stop = watch(() => privacy.active, (on) => leaveSwapBridgePagesWhenOn(on, page, swapShown))
        try {
            // (i) bridge sayfasindayken gizli mod acilir -> eve doner.
            privacy.active = false
            page.currentPage = 'bridge'
            privacy.active = true
            await nextTick()
            expect(page.currentPage).toBe('home')

            // (ii) mod kapanirken hicbir sey degismez.
            privacy.active = false
            await nextTick()
            expect(page.currentPage).toBe('home')

            // (iii) izleyici yalniz mod DEGISIMINE tepki verir, sayfa degisimine degil.
            page.currentPage = 'bridge'
            await nextTick()
            expect(page.currentPage).toBe('bridge')

            // (iv) swap sayfasi, satin alma kapali -> eve doner.
            swapShown = false
            page.currentPage = 'swap'
            privacy.active = true
            await nextTick()
            expect(page.currentPage).toBe('home')

            // (v) swap sayfasi, satin alma acik -> yerinde kalir.
            privacy.active = false
            await nextTick()
            swapShown = true
            page.currentPage = 'swap'
            privacy.active = true
            await nextTick()
            expect(page.currentPage).toBe('swap')
        } finally {
            stop()
        }
    })

    it('App.vue: izleyici AYRI satir, swapShown.value gecirir, yalniz DEGISIMDE calisir; mevcut uc izleyici AYNEN durur', () => {
        const m = /watch\(\(\) => privacy\.active, \(on\) => leaveSwapBridgePagesWhenOn\(on, page, swapShown\.value\)\)/.exec(app)
        expect(m).not.toBeNull()
        expect(app.slice(m.index, m.index + m[0].length + 40)).not.toMatch(/immediate|flush:\s*'sync'/)
        const satirlar = app.split(/\r?\n/).filter((s) => s.includes('leaveSwapBridgePagesWhenOn(on, page'))
        expect(satirlar).toHaveLength(1)
        // Kendi satiri: baska bir izleyiciye katilmamis.
        expect(satirlar[0].trim().startsWith('watch(')).toBe(true)
        expect(app).toMatch(/import \{[^}]*leaveSwapBridgePagesWhenOn[^}]*\} from '\.\/privatePageGuard'/)
        // Mevcut uc izleyici ayni tam satir bicimiyle durur (accountPagesPrivateRouting.test.js, xstocksPrivateRouting.test.js).
        expect(app).toMatch(/watch\(\(\) => privacy\.active, \(on\) => leavePrivatePagesWhenOff\(on, page\)\)/)
        expect(app).toMatch(/watch\(\(\) => privacy\.active, \(on\) => leaveStockPagesWhenOn\(on, page, crypto\)\)/)
        expect(app).toMatch(/watch\(\(\) => privacy\.active, \(on\) => leaveAccountPagesWhenOn\(on, page\)\)/)
    })
})

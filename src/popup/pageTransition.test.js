// SAYFA GECISI KILIDI (kaymak ana sayfa, C: yonlu gecis; D3 ile bilincli guncellendi, 2026-11-13).
//
// Degismeyen kural (hiz isi, 2026-11-07 + 2026-11-13 duzeltmesi): `mode="out-in"` beklemesi yok; eski sayfa gecis
// basinda HEMEN gizlenir (`display: none`, `visibility` degil) ve tiklanamaz, yeni sayfa tek basina girer. Iki sayfa
// hicbir karede ust uste gorunmez (K4).
// Yeni (C): gecis suresi sabit degil; pageNav.js her sayfa degisiminde `html[data-nav]` ve `pageDuration` yazar.
// Notr kol bugunku 4px/120 ms girisi; ileri gezinmede yeni sayfa sagdan (+36px), geride soldan (-36px) 200 ms'de
// girer; simge ucusunda yalniz opacity (140 ms). Hareket azaltilinca sure 0 ve CSS gecisi kapali.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NAV_DURATION_MS } from './pageNav'
import { yorumsuz, cssKuralGovdesi, cssSeciciListesi } from '../test-utils/kaynakTarama'

const app = readFileSync(fileURLToPath(new URL('./App.vue', import.meta.url)), 'utf8')
const css = readFileSync(fileURLToPath(new URL('./style.css', import.meta.url)), 'utf8')

const gecisEtiketi = app.match(/<Transition[^>]*name="page-swap"[^>]*>/)?.[0]
// App.vue <style> bolumu, yorumlari temizlenmis (sira karsilastirmasi yorumlara kanmasin).
const stil = yorumsuz(app.slice(app.indexOf('<style'), app.indexOf('</style>')))
const REDUCE = '@media (prefers-reduced-motion: reduce)'
const reduceBlok = cssKuralGovdesi(stil, REDUCE) ?? ''

// `transition` bildirimindeki butun sureleri ms olarak doner (".2s" -> 200).
const sureler = (govde) => [...(govde.match(/transition:[^;]*/)?.[0] ?? '').matchAll(/(\d*\.?\d+)s\b/g)]
    .map((m) => Math.round(Number(m[1]) * 1000))

describe('App.vue sayfa gecisi', () => {
    it('sayfa gecisi var ve out-in beklemesi YOK', () => {
        expect(gecisEtiketi, 'page-swap gecisi').toBeTruthy()
        expect(gecisEtiketi).not.toContain('out-in')
        expect(gecisEtiketi).not.toMatch(/mode=/)
    })

    it('etiket aynen: sure pageDuration ve atmosfer bagi', () => {
        expect(gecisEtiketi).toBe('<Transition name="page-swap" :duration="pageDuration" @after-enter="atmosphere.onPageEntered">')
    })

    it('NAV_DURATION_MS degerleri 0 ile 260 ms arasinda, none 120', () => {
        for (const v of Object.values(NAV_DURATION_MS)) {
            expect(v).toBeGreaterThan(0)
            expect(v).toBeLessThanOrEqual(260)
        }
        expect(NAV_DURATION_MS.none).toBe(120)
    })

    it('eski sure/yon kalintilari silindi', () => {
        const k = yorumsuz(app)
        for (const ad of ['transitionName', 'previousPage', 'PAGE_TRANSITION_MS', 'reduceMotion']) {
            expect(k, ad).not.toContain(ad)
        }
    })

    it('pageDuration ref, baslangic hareket iznine gore', () => {
        expect(yorumsuz(app)).toContain('const pageDuration = ref(motionAllowed() ? NAV_DURATION_MS.none : 0)')
    })

    it('denetleyici ve izleyiciler App.vue ya bagli', () => {
        const k = yorumsuz(app)
        expect(k).toContain('const pageNav = createPageNavController({')
        expect(k).toContain('getPrivacyActive: () => privacy.active')
        expect(k).toContain("approvalPages: [...DAPP_APPROVAL_PAGES, 'ton_alert', 'privacy_blocked']")
        expect(k).toContain("watch(() => page.currentPage, (now, prev) => { pageDuration.value = pageNav.onPageChange(now, prev ?? '').duration }, { flush: 'pre' })")
        expect(k).toContain("watch(() => privacy.active, () => pageNav.notePrivacy(), { flush: 'post' })")
    })

    it('SESSION_EXPIRED: pageNav.reset() welcome atamasindan ONCE', () => {
        const k = yorumsuz(app)
        const dal = k.slice(k.indexOf("if (message.type === 'SESSION_EXPIRED')"))
        expect(dal.indexOf('pageNav.reset()')).toBeGreaterThan(-1)
        expect(dal.indexOf('pageNav.reset()')).toBeLessThan(dal.indexOf("page.currentPage = 'welcome'"))
    })
})

describe('App.vue sayfa gecisi CSS', () => {
    it('notr giris: yalniz opacity ve transform (all degil), sure NAV_DURATION_MS.none', () => {
        const giris = cssKuralGovdesi(stil, '.page-swap-enter-active') ?? ''
        expect(giris).toMatch(/transition:\s*opacity[^;,]*,\s*transform[^;,]*;/)
        expect(giris).not.toMatch(/\ball\b/)
        expect(sureler(giris)).toEqual([NAV_DURATION_MS.none, NAV_DURATION_MS.none])
    })
    it('notr giris baslangici opacity 0 ve 1-6px translateY', () => {
        const from = cssKuralGovdesi(stil, '.page-swap-enter-from') ?? ''
        const px = Number(from.match(/translateY\((\d+)px\)/)?.[1])
        expect(px).toBeGreaterThan(0)
        expect(px).toBeLessThanOrEqual(6)
        expect(from).toContain('opacity: 0')
    })
    it('yonlu kollar: ileri +, geri - translateX (1..36px), translateY yok', () => {
        const fwd = cssKuralGovdesi(stil, 'html[data-nav="fwd"] .page-swap-enter-from') ?? ''
        const back = cssKuralGovdesi(stil, 'html[data-nav="back"] .page-swap-enter-from') ?? ''
        const f = Number(fwd.match(/translateX\((\d+)px\)/)?.[1])
        const b = Number(back.match(/translateX\(-(\d+)px\)/)?.[1])
        expect(f).toBeGreaterThanOrEqual(1)
        expect(f).toBeLessThanOrEqual(36)
        expect(b).toBeGreaterThanOrEqual(1)
        expect(b).toBeLessThanOrEqual(36)
        expect(fwd).not.toContain('translateY')
        expect(back).not.toContain('translateY')
    })
    it('yonlu kollar ayni kuralda: opacity + transform, sure NAV_DURATION_MS.fwd/back', () => {
        expect(cssSeciciListesi(stil, 'html[data-nav="fwd"] .page-swap-enter-active'))
            .toEqual(['html[data-nav="fwd"] .page-swap-enter-active', 'html[data-nav="back"] .page-swap-enter-active'])
        const govde = cssKuralGovdesi(stil, 'html[data-nav="fwd"] .page-swap-enter-active') ?? ''
        expect(govde).toMatch(/transition:\s*opacity[^;,]*,\s*transform[^;,]*;/)
        expect(govde).not.toMatch(/\ball\b/)
        expect(sureler(govde)).toEqual([NAV_DURATION_MS.fwd, NAV_DURATION_MS.back])
    })
    it('ucus kolu: transform none, yalniz opacity, sure NAV_DURATION_MS.flight', () => {
        const from = cssKuralGovdesi(stil, 'html[data-nav="flight"] .page-swap-enter-from') ?? ''
        expect(from).toMatch(/transform:\s*none/)
        const aktif = cssKuralGovdesi(stil, 'html[data-nav="flight"] .page-swap-enter-active') ?? ''
        expect(aktif).toMatch(/transition:\s*opacity[^;,]*;/)
        expect(aktif).not.toMatch(/transform|\ball\b/)
        expect(sureler(aktif)).toEqual([NAV_DURATION_MS.flight])
    })
    it('reduce blogu notr ve yonlu kollari ayni ozgullukte kapatir', () => {
        expect(reduceBlok).not.toBe('')
        const from = cssKuralGovdesi(reduceBlok, 'html[data-nav] .page-swap-enter-from') ?? ''
        expect(from).toMatch(/opacity:\s*1/)
        expect(from).toMatch(/transform:\s*none/)
        const aktif = cssKuralGovdesi(reduceBlok, 'html[data-nav] .page-swap-enter-active') ?? ''
        expect(aktif).toMatch(/transition:\s*none/)
        expect(cssSeciciListesi(reduceBlok, '.page-swap-enter-from')).toContain('.page-swap-enter-from')
        expect(cssSeciciListesi(reduceBlok, '.page-swap-enter-active')).toContain('.page-swap-enter-active')
    })
    it('SIRA: butun yonlu/ucus kurallari reduce blogundan ONCE (ayni ozgullukte sonraki kazanir)', () => {
        expect(stil.indexOf(REDUCE)).toBeGreaterThan(-1)
        expect(stil.lastIndexOf('html[data-nav=')).toBeGreaterThan(-1)
        expect(stil.lastIndexOf('html[data-nav=')).toBeLessThan(stil.indexOf(REDUCE))
    })
    it('eski sayfa gecis basinda HEMEN gizlenir ve tiklanamaz', () => {
        const leave = app.match(/\.page-swap-leave-active\s*\{([^}]*)\}/)?.[1] ?? ''
        expect(leave).toContain('pointer-events: none')
        // `visibility: hidden` YETMEZ (olculdu): `transition-all` olan cocuklar visibility'yi interpole eder ve ~150 ms gorunur kalir.
        expect(leave).toMatch(/display:\s*none/)
        expect(leave).not.toMatch(/visibility/)
        expect(app).not.toMatch(/\.page-swap-leave-to/)
    })
    it('eski ve yeni sayfa ust uste binebilir: .page-wrapper mutlak konumlu', () => {
        expect(css).toMatch(/\.page-wrapper\s*\{[^}]*position:\s*absolute/)
    })
})

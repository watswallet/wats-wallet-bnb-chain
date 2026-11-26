// KAYMAK G13: kaydirma hafizasi denetleyicisi (spec 7.10, K2, H10; Review Focus 1 ve 6). Yasam dongusu kancalari
// yakalanir (useHomeStickyBar.test.js kalibi); watch ve nextTick gercek. Kaydirici sahte: satirin ekran ustu =
// kaydirici ustu + icerik ustu - scrollTop.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ref, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { yorumsuz, cagriGovdesi } from '../test-utils/kaynakTarama'

const kanca = vi.hoisted(() => ({ mounted: [], unmount: [] }))
vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        onMounted: (fn) => { kanca.mounted.push(fn) },
        onBeforeUnmount: (fn) => { kanca.unmount.push(fn) },
    }
})

import { createScrollMemory, useHomeScrollMemory } from './useHomeScrollMemory'
import { pageStore } from '../store/pageStore'

const burasi = dirname(fileURLToPath(import.meta.url))
const kaynak = yorumsuz(readFileSync(join(burasi, 'useHomeScrollMemory.js'), 'utf8'))
const APP = yorumsuz(readFileSync(join(burasi, '..', 'popup', 'App.vue'), 'utf8'))
const HOME = yorumsuz(readFileSync(join(burasi, '..', 'components', 'Home.vue'), 'utf8'))

// satirlar: [{ key, icerikUst }] (kaydirici iceriginin ustune gore).
function sahteKaydirici({ ust = 100, scrollTop = 0, scrollHeight = 3000, clientHeight = 500, satirlar = [] } = {}) {
    const dinleyiciler = new Map()
    const k = {
        scrollTop,
        scrollHeight,
        clientHeight,
        satirlar,
        dinleyiciler,
        getBoundingClientRect: () => ({ top: ust }),
        querySelectorAll: (secici) => (secici === '[data-row-key]'
            ? k.satirlar.map((s) => ({
                getAttribute: (ad) => (ad === 'data-row-key' ? s.key : null),
                getBoundingClientRect: () => ({ top: ust + s.icerikUst - k.scrollTop }),
            }))
            : []),
        addEventListener: (ad, fn) => { dinleyiciler.set(ad, fn) },
        removeEventListener: (ad, fn) => { if (dinleyiciler.get(ad) === fn) dinleyiciler.delete(ad) },
        ekranUstu: (anahtar) => ust + k.satirlar.find((s) => s.key === anahtar).icerikUst - k.scrollTop,
    }
    return k
}

const SATIRLAR = [{ key: 'a', icerikUst: 0 }, { key: 'b', icerikUst: 100 }, { key: 'c', icerikUst: 200 }, { key: 'd', icerikUst: 300 }]

let page
beforeEach(() => {
    kanca.mounted = []
    kanca.unmount = []
    setActivePinia(createPinia())
    page = pageStore()
    page.currentPage = 'home'
})
afterEach(() => {
    vi.useRealTimers()
    delete globalThis.chrome
})

const bellekKur = (ek = {}) => createScrollMemory({ page, key: () => 'acc1|0|all', tab: () => 'assets', boundary: () => 50, ...ek })

describe('createScrollMemory: save ve restore', () => {
    it('save -> restore dongusu ayni satiri ayni gorunur konuma getirir (ustune satir eklense de)', () => {
        const bellek = bellekKur()
        const once = sahteKaydirici({ scrollTop: 150, satirlar: SATIRLAR })
        // c'nin gorunur ofseti 200 - 150 = 50 = sinir: capa c, ofset 0.
        bellek.save(once)
        expect(page.homeScroll).toEqual({ key: 'acc1|0|all', tab: 'assets', top: 150, anchorKey: 'c', anchorOffset: 0 })
        const gorunurOnce = once.ekranUstu('c')

        // Donuste ustte yeni bir satir: c artik icerikte 300'de.
        const sonra = sahteKaydirici({ scrollTop: 0, satirlar: [{ key: 'yeni', icerikUst: 0 }, ...SATIRLAR.map((s) => ({ ...s, icerikUst: s.icerikUst + 100 }))] })
        expect(bellek.restore(sonra)).toBe(true)
        expect(sonra.scrollTop).toBe(250)
        expect(sonra.ekranUstu('c')).toBe(gorunurOnce)
    })

    it('kaydirilmis kaydiricida iki olcu: kayitta gorunur ofset, geri yuklemede icerik koordinati', () => {
        const bellek = bellekKur()
        // scrollTop 300, kaydirici ust 100, capa satiri ekranda 160 (icerikte 360).
        const once = sahteKaydirici({ ust: 100, scrollTop: 300, satirlar: [{ key: 'u', icerikUst: 200 }, { key: 'x', icerikUst: 360 }] })
        expect(once.ekranUstu('x')).toBe(160)
        bellek.save(once)
        expect(page.homeScroll.anchorKey).toBe('x')
        expect(page.homeScroll.anchorOffset).toBe(10)

        const sonra = sahteKaydirici({ ust: 100, scrollTop: 0, satirlar: [{ key: 'u', icerikUst: 200 }, { key: 'x', icerikUst: 360 }] })
        expect(sonra.ekranUstu('x')).toBe(460)
        expect(bellek.restore(sonra)).toBe(true)
        expect(sonra.scrollTop).toBe(300)
    })

    it('capa satiri yok (token gizlendi) ve liste kisaldi: kayitli top, [0, scrollHeight - clientHeight] icinde (Review Focus 1)', () => {
        const bellek = bellekKur()
        page.homeScroll = { key: 'acc1|0|all', tab: 'assets', top: 2000, anchorKey: 'silindi', anchorOffset: 10 }
        const k = sahteKaydirici({ scrollHeight: 1200, clientHeight: 500, satirlar: SATIRLAR })
        expect(bellek.restore(k)).toBe(true)
        expect(k.scrollTop).toBe(700)
    })

    it('anahtar ya da sekme uyusmazsa restore false, scrollTop degismez', () => {
        page.homeScroll = { key: 'acc1|0|all', tab: 'assets', top: 300, anchorKey: null, anchorOffset: null }
        const k = sahteKaydirici({ scrollTop: 0, satirlar: SATIRLAR })
        expect(bellekKur({ key: () => 'acc2|0|all' }).restore(k)).toBe(false)
        expect(bellekKur({ tab: () => 'stocks' }).restore(k)).toBe(false)
        expect(bellekKur({ tab: () => 'activity' }).restore(k)).toBe(false)
        expect(k.scrollTop).toBe(0)
    })

    it('kaydirici yoksa ikisi de bir sey yapmaz', () => {
        const bellek = bellekKur()
        bellek.save(null)
        expect(page.homeScroll).toBeNull()
        expect(bellek.restore(null)).toBe(false)
    })

    it('chrome.storage.local.set ve session.set save/restore boyunca HIC cagrilmaz (K2)', () => {
        globalThis.chrome = { storage: { local: { set: vi.fn() }, session: { set: vi.fn() } } }
        const bellek = bellekKur()
        bellek.save(sahteKaydirici({ scrollTop: 150, satirlar: SATIRLAR }))
        bellek.restore(sahteKaydirici({ scrollTop: 0, satirlar: SATIRLAR }))
        expect(globalThis.chrome.storage.local.set).not.toHaveBeenCalled()
        expect(globalThis.chrome.storage.session.set).not.toHaveBeenCalled()
    })
})

describe('createScrollMemory: kilit korumasi (Review Focus 6)', () => {
    it('home iken yazar; App onReset sonrasi kilit sayfasinda save yazmaz; kilit acilinca geri yukleme yok', () => {
        const bellek = bellekKur()
        const k = sahteKaydirici({ scrollTop: 150, satirlar: SATIRLAR })
        bellek.save(k)
        expect(page.homeScroll).not.toBeNull()

        // App'in pre izleyicisi (pageNav onReset) once siler, Home'un onBeforeUnmount'u SONRA calisir.
        page.homeScroll = null
        page.currentPage = 'welcome'
        bellek.save(k)
        expect(page.homeScroll).toBeNull()

        page.currentPage = 'home'
        const yeni = sahteKaydirici({ scrollTop: 0, satirlar: SATIRLAR })
        expect(bellek.restore(yeni)).toBe(false)
        expect(yeni.scrollTop).toBe(0)
    })

    it.each(['welcome', 'forgot_password', 'onboarding_pending'])('%s sayfasinda save hicbir sey yazmaz', (kilit) => {
        page.currentPage = kilit
        bellekKur().save(sahteKaydirici({ scrollTop: 150, satirlar: SATIRLAR }))
        expect(page.homeScroll).toBeNull()
    })
})

describe('useHomeScrollMemory: yasam dongusu', () => {
    const kur = ({ kaydirici = sahteKaydirici({ satirlar: SATIRLAR }), sekme = 'assets', hazir = false, ...ek } = {}) => {
        const scrollerRef = ref(kaydirici)
        const listReady = ref(hazir)
        const onRestored = vi.fn()
        const sekmeRef = ref(sekme)
        const h = useHomeScrollMemory({
            scrollerRef, page, key: () => 'acc1|0|all', tab: () => sekmeRef.value, boundary: () => 50, listReady, onRestored, ...ek,
        })
        let cozuldu
        h.settled.then((v) => { cozuldu = v })
        return { h, scrollerRef, listReady, onRestored, sekmeRef, kaydirici, sonuc: () => cozuldu }
    }
    const mount = () => { for (const fn of kanca.mounted) fn() }
    const unmount = () => { for (const fn of kanca.unmount) fn() }
    const bellekVar = (ek = {}) => { page.homeScroll = { key: 'acc1|0|all', tab: 'assets', top: 150, anchorKey: 'c', anchorOffset: 0, ...ek } }

    it('ref bos (SSR): settled false, hicbir sey yazilmaz', async () => {
        bellekVar()
        const t = kur({ kaydirici: null })
        mount()
        expect(await t.h.settled).toBe(false)
        expect(t.onRestored).not.toHaveBeenCalled()
        unmount()
        expect(page.homeScroll.top).toBe(150)
    })

    it('stocks: onMounted icinde hemen geri yukler, sonra onRestored, sonra settled true', async () => {
        bellekVar({ tab: 'stocks' })
        const sira = []
        const t = kur({ sekme: 'stocks', onRestored: () => sira.push(['onRestored', t.kaydirici.scrollTop]) })
        mount()
        expect(t.kaydirici.scrollTop).toBe(150)
        expect(sira).toEqual([['onRestored', 150]])
        expect(await t.h.settled).toBe(true)
    })

    it('stocks bellek yokken: geri yukleme yok, onRestored cagrilmaz, settled true', async () => {
        const t = kur({ sekme: 'stocks' })
        mount()
        expect(t.kaydirici.scrollTop).toBe(0)
        expect(t.onRestored).not.toHaveBeenCalled()
        expect(await t.h.settled).toBe(true)
    })

    it('assets: liste hazir olana kadar bekler; hazir olunca bir sonraki tick te geri yukler, onRestored, settled true', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        bellekVar()
        const t = kur()
        mount()
        await nextTick()
        expect(t.kaydirici.scrollTop).toBe(0)
        expect(t.sonuc()).toBeUndefined()
        t.listReady.value = true
        expect(await t.h.settled).toBe(true)
        expect(t.kaydirici.scrollTop).toBe(150)
        expect(t.onRestored).toHaveBeenCalledTimes(1)
        // Bekleme zamanlayicisi ve girdi dinleyicileri kalkti.
        expect(vi.getTimerCount()).toBe(0)
        expect(t.kaydirici.dinleyiciler.size).toBe(0)
    })

    it('assets: liste mount aninda zaten hazirsa bir sonraki tick te geri yukler', async () => {
        bellekVar()
        const t = kur({ hazir: true })
        mount()
        expect(await t.h.settled).toBe(true)
        expect(t.kaydirici.scrollTop).toBe(150)
    })

    it('assets: 150 ms icinde liste gelmezse geri yukleme yok, settled false; gec gelen liste sicratmaz', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        bellekVar()
        const t = kur()
        mount()
        vi.advanceTimersByTime(149)
        await nextTick()
        expect(t.sonuc()).toBeUndefined()
        vi.advanceTimersByTime(1)
        expect(await t.h.settled).toBe(false)
        t.listReady.value = true
        await nextTick()
        await nextTick()
        expect(t.kaydirici.scrollTop).toBe(0)
        expect(t.onRestored).not.toHaveBeenCalled()
        expect(t.kaydirici.dinleyiciler.size).toBe(0)
    })

    it('waitMs ayarlanabilir', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        bellekVar()
        const t = kur({ waitMs: 40 })
        mount()
        vi.advanceTimersByTime(40)
        expect(await t.h.settled).toBe(false)
    })

    it.each(['wheel', 'touchstart', 'keydown', 'pointerdown'])('assets: beklerken %s gelirse geri yukleme iptal, settled false', async (olay) => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        bellekVar()
        const t = kur()
        mount()
        expect(t.kaydirici.dinleyiciler.has(olay)).toBe(true)
        t.kaydirici.dinleyiciler.get(olay)()
        expect(await t.h.settled).toBe(false)
        expect(t.kaydirici.dinleyiciler.size).toBe(0)
        expect(vi.getTimerCount()).toBe(0)
        t.listReady.value = true
        await nextTick()
        await nextTick()
        expect(t.kaydirici.scrollTop).toBe(0)
    })

    it.each(['activity', 'private'])('%s: geri yukleme yok, onRestored yok, settled true', async (sekme) => {
        bellekVar({ tab: sekme })
        const t = kur({ sekme })
        mount()
        expect(await t.h.settled).toBe(true)
        expect(t.kaydirici.scrollTop).toBe(0)
        expect(t.onRestored).not.toHaveBeenCalled()
    })

    it('onBeforeUnmount: kaydeder; bekleyen settled false ile cozulur, dinleyiciler kalkar', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const t = kur()
        mount()
        t.kaydirici.scrollTop = 150
        unmount()
        expect(page.homeScroll).toEqual({ key: 'acc1|0|all', tab: 'assets', top: 150, anchorKey: 'c', anchorOffset: 0 })
        expect(await t.h.settled).toBe(false)
        expect(t.kaydirici.dinleyiciler.size).toBe(0)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('onBeforeUnmount kilit sayfasindayken yazmaz (Review Focus 6)', () => {
        const t = kur({ sekme: 'stocks' })
        mount()
        t.kaydirici.scrollTop = 150
        page.homeScroll = null
        page.currentPage = 'welcome'
        unmount()
        expect(page.homeScroll).toBeNull()
    })

    it('chrome.storage hic cagrilmaz: mount, geri yukleme ve unmount boyunca (K2)', async () => {
        globalThis.chrome = { storage: { local: { set: vi.fn() }, session: { set: vi.fn() } } }
        bellekVar({ tab: 'stocks' })
        const t = kur({ sekme: 'stocks' })
        mount()
        await t.h.settled
        unmount()
        expect(globalThis.chrome.storage.local.set).not.toHaveBeenCalled()
        expect(globalThis.chrome.storage.session.set).not.toHaveBeenCalled()
    })
})

describe('kaynak kilidi (K2)', () => {
    it('useHomeScrollMemory.js chrome import etmez, chrome. gecmez; depo import etmez (pageStore parametre)', () => {
        expect(kaynak).not.toMatch(/\bchrome\b/)
        expect(kaynak).not.toMatch(/from\s+['"][^'"]*store[^'"]*['"]/)
    })

    it('kilit korumasi LOCK_PAGES ile (G3), page.currentPage uzerinden', () => {
        expect(kaynak).toMatch(/import\s*\{[^}]*\bLOCK_PAGES\b[^}]*\}\s*from\s*['"]\.\.\/utils\/motion\/navDirection['"]/)
        expect(kaynak).toContain('LOCK_PAGES.includes(page.currentPage)')
    })

    it('Home homeScroll a dogrudan dokunmaz (bellek yalniz denetleyiciden yazilir)', () => {
        expect(HOME).not.toContain('homeScroll')
    })
})

describe('App.vue sifirlama baglantisi (spec 7.10 Sifirlama, K2)', () => {
    it('pageNav onReset kaydirma bellegini siler (kilit sayfasina gidis, kilitten cikis, gizli mod, SESSION_EXPIRED)', () => {
        const govde = cagriGovdesi(APP, 'const pageNav = createPageNavController(')
        expect(govde).toContain('onReset: () => { page.homeScroll = null }')
    })

    it('hesap, gizli mod ve kapsam degisiminde bellek silinir', () => {
        expect(APP).toContain('watch(() => [user.address, privacy.active, scope.filter], () => { page.homeScroll = null })')
        expect(APP).toMatch(/import\s*\{\s*tokenScopeStore\s*\}\s*from\s*['"]\.\.\/store\/tokenScope['"]/)
        expect(APP).toContain('const scope = tokenScopeStore()')
    })

    it('App homeScroll u yalniz bu iki yerde yazar', () => {
        expect(APP.split('page.homeScroll = null').length - 1).toBe(2)
        expect(APP).not.toMatch(/homeScroll\s*=(?!=)\s*(?!null\b)[^\s=]/)
    })
})

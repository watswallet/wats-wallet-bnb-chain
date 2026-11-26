// KAYMAK G10: yapiskan sekmeler (spec 7.9, K8). Yasam dongusu kancalari yakalanir; gozlemci sahte.
// KAYMAK G11: mini bakiye seridi (spec 7.9 Mini serit, K8): baslik gozlemcisi ve stripShown dosya sonunda.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ref } from 'vue'
import { yorumsuz } from '../test-utils/kaynakTarama'

const kanca = vi.hoisted(() => ({ mounted: [], unmount: [], watchers: [] }))
vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        onMounted: (fn) => { kanca.mounted.push(fn) },
        onBeforeUnmount: (fn) => { kanca.unmount.push(fn) },
        watch: (kaynaklar, cb, secenek) => { kanca.watchers.push({ kaynaklar, cb, secenek }); return () => {} },
    }
})

import { SERIT_PX, ALT_PAY_PX, isStuck, headlineGone, useHomeStickyBar } from './useHomeStickyBar'

const kaynak = yorumsuz(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'useHomeStickyBar.js'), 'utf8'))

let ioler = []
class SahteIO {
    constructor(cb, secenek) {
        this.cb = cb
        this.secenek = secenek
        this.gozlenen = []
        this.kapali = false
        ioler.push(this)
    }
    observe(el) { this.gozlenen.push(el) }
    disconnect() { this.kapali = true }
}
const giris = (bottom, top) => [{ boundingClientRect: { bottom }, rootBounds: { top } }]

const kur = ({ kok = { getBoundingClientRect: () => ({ top: 100 }), clientTop: 0 }, gozcu = { getBoundingClientRect: () => ({ bottom: 400 }) }, ofset = 44 } = {}) => {
    const scrollerRef = ref(kok)
    const sentinelRef = ref(gozcu)
    const ofsetRef = ref(ofset)
    const cubuk = useHomeStickyBar({ scrollerRef, sentinelRef, offsetPx: () => ofsetRef.value })
    for (const fn of kanca.mounted) fn()
    return { cubuk, scrollerRef, sentinelRef, ofsetRef }
}

beforeEach(() => {
    ioler = []
    kanca.mounted = []
    kanca.unmount = []
    kanca.watchers = []
    vi.stubGlobal('IntersectionObserver', SahteIO)
})
afterEach(() => vi.unstubAllGlobals())

describe('isStuck (spec 7.9)', () => {
    it('gozcunun alti cizginin ustunde ya da tam cizgide -> yapisti', () => {
        expect(isStuck(43, 44)).toBe(true)
        expect(isStuck(44, 44)).toBe(true)
        expect(isStuck(-200, 44)).toBe(true)
    })
    it('gozcunun alti cizginin altinda -> yapismadi', () => {
        expect(isStuck(45, 44)).toBe(false)
        expect(isStuck(600, 0)).toBe(false)
    })
    it('serit 44 px (K8)', () => expect(SERIT_PX).toBe(44))
})

describe('useHomeStickyBar', () => {
    it('ilk kurulum onMounted ta: kok kaydirici, ust pay -ofset, buyuk alt pay, esik 0; gozcuyu izler', () => {
        const { cubuk, scrollerRef, sentinelRef } = kur()
        expect(ioler).toHaveLength(1)
        expect(ioler[0].secenek).toEqual({ root: scrollerRef.value, rootMargin: `-44px 0px ${ALT_PAY_PX}px 0px`, threshold: 0 })
        expect(ioler[0].gozlenen).toEqual([sentinelRef.value])
        expect(cubuk.stuck.value).toBe(false)
    })

    it('gizli modda (ofset 0) ust pay 0px', () => {
        kur({ ofset: 0 })
        expect(ioler[0].secenek.rootMargin).toBe(`0px 0px ${ALT_PAY_PX}px 0px`)
    })

    it('alt pay gozcunun ustundeki icerikten (ust bolge) cok buyuk: cizginin alti her yerde kesisir, tek karelik sicrama da geri cagri alir', () => {
        expect(ALT_PAY_PX).toBeGreaterThanOrEqual(10000)
    })

    it('geri cagri isStuck(gozcu alti, kok cizgisi) ile yazar; son giris kazanir', () => {
        const { cubuk } = kur()
        ioler[0].cb(giris(140, 144))
        expect(cubuk.stuck.value).toBe(true)
        ioler[0].cb(giris(300, 144))
        expect(cubuk.stuck.value).toBe(false)
        ioler[0].cb([...giris(300, 144), ...giris(100, 144)])
        expect(cubuk.stuck.value).toBe(true)
    })

    it('rootBounds yoksa durum degismez', () => {
        const { cubuk } = kur()
        ioler[0].cb(giris(10, 44))
        ioler[0].cb([{ boundingClientRect: { bottom: 900 }, rootBounds: null }])
        expect(cubuk.stuck.value).toBe(true)
    })

    it('ref bos ya da IntersectionObserver yoksa gozlemci kurulmaz, hata yok', () => {
        kur({ kok: null })
        kur({ gozcu: null })
        expect(ioler).toHaveLength(0)
        vi.stubGlobal('IntersectionObserver', undefined)
        expect(() => kur()).not.toThrow()
        expect(ioler).toHaveLength(0)
    })

    it('yeniden kurulum izleyicisi flush post; ofset, baslik ve gozcu ref ine bakar (G11: baslik kaynagi eklendi)', () => {
        const { ofsetRef, sentinelRef } = kur()
        expect(kanca.watchers).toHaveLength(1)
        const w = kanca.watchers[0]
        expect(w.secenek).toEqual({ flush: 'post' })
        expect(Array.isArray(w.kaynaklar)).toBe(true)
        const degerler = () => w.kaynaklar.map((k) => (typeof k === 'function' ? k() : k.value))
        // Baslik ref'i verilmediyse kaynagi undefined (G10 bicimli cagrilar bozulmaz).
        expect(degerler()).toEqual([44, undefined, sentinelRef.value])
        ofsetRef.value = 0
        expect(degerler()).toEqual([0, undefined, sentinelRef.value])
    })

    it('yeniden kurulum eskisini kapatir, yeni ofsetle kurar', () => {
        const { ofsetRef } = kur()
        ofsetRef.value = 0
        kanca.watchers[0].cb()
        expect(ioler).toHaveLength(2)
        expect(ioler[0].kapali).toBe(true)
        expect(ioler[1].kapali).toBe(false)
        expect(ioler[1].secenek.rootMargin).toBe(`0px 0px ${ALT_PAY_PX}px 0px`)
    })

    it('ayni girdilerle (kok, gozcu, ofset) yeniden kurulum gozlemciyi korur: mount ta onMounted + ref yazimi izleyicisi tek kurulum', () => {
        const { cubuk } = kur()
        ioler[0].cb(giris(10, 144))
        kanca.watchers[0].cb()
        kanca.watchers[0].cb()
        expect(ioler).toHaveLength(1)
        expect(ioler[0].kapali).toBe(false)
        expect(cubuk.stuck.value).toBe(true)
    })

    it('gozcu ya da kok ogesi degisince yeniden kurulur', () => {
        const { sentinelRef, scrollerRef } = kur()
        const yeniGozcu = { getBoundingClientRect: () => ({ bottom: 400 }) }
        sentinelRef.value = yeniGozcu
        kanca.watchers[0].cb()
        expect(ioler).toHaveLength(2)
        expect(ioler[0].kapali).toBe(true)
        expect(ioler[1].gozlenen).toEqual([yeniGozcu])
        const yeniKok = { getBoundingClientRect: () => ({ top: 0 }), clientTop: 0 }
        scrollerRef.value = yeniKok
        kanca.watchers[0].cb()
        expect(ioler).toHaveLength(3)
        expect(ioler[1].kapali).toBe(true)
        expect(ioler[2].secenek.root).toBe(scrollerRef.value)
    })

    it('ofset geri donunce (gizli -> normal) yeniden kurulur; eski ofsetin gozlemcisi kalmaz', () => {
        const { ofsetRef } = kur()
        ofsetRef.value = 0
        kanca.watchers[0].cb()
        ofsetRef.value = 44
        kanca.watchers[0].cb()
        expect(ioler).toHaveLength(3)
        expect(ioler[1].kapali).toBe(true)
        expect(ioler[2].secenek.rootMargin).toBe(`-44px 0px ${ALT_PAY_PX}px 0px`)
    })

    it('yeniden kurulumda gozcu null ise yeni gozlemci kurulmaz ve yapisma duser', () => {
        const { cubuk, sentinelRef } = kur()
        ioler[0].cb(giris(10, 144))
        expect(cubuk.stuck.value).toBe(true)
        sentinelRef.value = null
        kanca.watchers[0].cb()
        expect(ioler).toHaveLength(1)
        expect(ioler[0].kapali).toBe(true)
        expect(cubuk.stuck.value).toBe(false)
    })

    it('recompute bir kez olcer: gozcu alti <= kok ustu + ofset', () => {
        let gozcuAlt = 150
        const { cubuk } = kur({ gozcu: { getBoundingClientRect: () => ({ bottom: gozcuAlt }) } })
        cubuk.recompute()
        expect(cubuk.stuck.value).toBe(false)
        gozcuAlt = 144
        cubuk.recompute()
        expect(cubuk.stuck.value).toBe(true)
        gozcuAlt = 145
        cubuk.recompute()
        expect(cubuk.stuck.value).toBe(false)
    })

    it('recompute ref bosken bir sey yapmaz', () => {
        const { cubuk, scrollerRef } = kur()
        ioler[0].cb(giris(10, 144))
        scrollerRef.value = null
        expect(() => cubuk.recompute()).not.toThrow()
        expect(cubuk.stuck.value).toBe(true)
    })

    it('ayrilirken gozlemci kapanir', () => {
        kur()
        for (const fn of kanca.unmount) fn()
        expect(ioler[0].kapali).toBe(true)
    })
})

describe('useHomeStickyBar kaynak kilidi', () => {
    it('gozlemci yalniz ref dolu ve typeof IntersectionObserver === function iken kurulur', () => {
        expect(kaynak).toMatch(/typeof IntersectionObserver !== 'function'/)
        expect(kaynak).toMatch(/!kok \|\| !gozcu \|\| typeof IntersectionObserver !== 'function'/)
    })
    it('scroll olay dinleyicisi yok', () => {
        expect(kaynak).not.toMatch(/addEventListener|['"]scroll['"]|onscroll/)
    })
    it('yeniden kurulum izleyicisi flush post, kaynak dizisinde ofset ve gozcu ref i', () => {
        const m = kaynak.match(/watch\(\[([^\]]*)\],\s*yenidenKur,\s*\{\s*flush:\s*'post'\s*\}\)/)
        expect(m).not.toBeNull()
        expect(m[1]).toContain('offsetPx')
        expect(m[1]).toContain('sentinelRef.value')
    })
    it('chrome ya da store import etmez', () => {
        expect(kaynak).not.toMatch(/\bchrome\b|store/)
    })
})

// KAYMAK G11: mini bakiye seridi (spec 7.9 Mini serit, K8). Baslik bakiyesi kaydiricinin gorunen alanindan cikinca
// serit belirir; esik sabit piksel degil, baslik ogesini izleyen ikinci gozlemci (kok Home kaydiricisi).
describe('headlineGone (spec 7.9 mini serit)', () => {
    it('baslik alti kok ustunde ya da tam ustte -> cikti', () => {
        expect(headlineGone(100, 100)).toBe(true)
        expect(headlineGone(99, 100)).toBe(true)
        expect(headlineGone(-500, 0)).toBe(true)
    })
    it('baslik alti kok ustunun altinda -> gorunuyor', () => {
        expect(headlineGone(101, 100)).toBe(false)
        expect(headlineGone(0, -1)).toBe(false)
    })
})

describe('useHomeStickyBar -- mini serit (G11)', () => {
    const kurBaslikli = ({
        kok = { getBoundingClientRect: () => ({ top: 100 }), clientTop: 0 },
        gozcu = { getBoundingClientRect: () => ({ bottom: 400 }) },
        baslik = { getBoundingClientRect: () => ({ bottom: 250 }) },
        ofset = 44,
    } = {}) => {
        const scrollerRef = ref(kok)
        const sentinelRef = ref(gozcu)
        const headlineRef = ref(baslik)
        const ofsetRef = ref(ofset)
        const cubuk = useHomeStickyBar({ scrollerRef, sentinelRef, headlineRef, offsetPx: () => ofsetRef.value })
        for (const fn of kanca.mounted) fn()
        return { cubuk, scrollerRef, sentinelRef, headlineRef, ofsetRef }
    }
    const izleyen = (el) => ioler.filter((io) => io.gozlenen.includes(el))
    const acik = () => ioler.filter((io) => !io.kapali)
    const degerler = () => kanca.watchers[0].kaynaklar.map((k) => (typeof k === 'function' ? k() : k.value))

    it('baslik verilince ikinci gozlemci: kok kaydirici, ust pay 0 (cizgi kok ustu, ofsetten bagimsiz), buyuk alt pay, esik 0; stripShown false baslar', () => {
        const { cubuk, scrollerRef, sentinelRef, headlineRef } = kurBaslikli()
        expect(ioler).toHaveLength(2)
        const b = izleyen(headlineRef.value)
        expect(b).toHaveLength(1)
        expect(b[0].secenek).toEqual({ root: scrollerRef.value, rootMargin: `0px 0px ${ALT_PAY_PX}px 0px`, threshold: 0 })
        expect(b[0].gozlenen).toEqual([headlineRef.value])
        expect(izleyen(sentinelRef.value)[0].secenek.rootMargin).toBe(`-44px 0px ${ALT_PAY_PX}px 0px`)
        expect(cubuk.stripShown.value).toBe(false)
        expect(cubuk.stuck.value).toBe(false)
    })

    it('baslik geri cagrisi headlineGone(baslik alti, kok ustu) ile yazar; son giris kazanir; rootBounds yoksa degismez; yapisma etkilenmez', () => {
        const { cubuk, headlineRef } = kurBaslikli()
        const b = izleyen(headlineRef.value)[0]
        b.cb(giris(100, 100))
        expect(cubuk.stripShown.value).toBe(true)
        expect(cubuk.stuck.value).toBe(false)
        b.cb(giris(101, 100))
        expect(cubuk.stripShown.value).toBe(false)
        b.cb([...giris(300, 100), ...giris(-20, 100)])
        expect(cubuk.stripShown.value).toBe(true)
        b.cb([{ boundingClientRect: { bottom: 900 }, rootBounds: null }])
        expect(cubuk.stripShown.value).toBe(true)
    })

    it('gozcu geri cagrisi stripShown a dokunmaz', () => {
        const { cubuk, sentinelRef } = kurBaslikli()
        izleyen(sentinelRef.value)[0].cb(giris(10, 144))
        expect(cubuk.stuck.value).toBe(true)
        expect(cubuk.stripShown.value).toBe(false)
    })

    it('baslik ref i null: baslik gozlemcisi kurulmaz, stripShown false; gozcu gozlemcisi yine kurulur', () => {
        const { cubuk, sentinelRef } = kurBaslikli({ baslik: null, ofset: 0 })
        expect(ioler).toHaveLength(1)
        expect(izleyen(sentinelRef.value)).toHaveLength(1)
        expect(cubuk.stripShown.value).toBe(false)
    })

    it('normal -> gizli (Home acik, yeniden kurulmaz): baslik null olunca post izleyici baslik gozlemcisini kapatir, stripShown duser', () => {
        const { cubuk, headlineRef, ofsetRef, sentinelRef } = kurBaslikli()
        const eski = izleyen(headlineRef.value)[0]
        eski.cb(giris(10, 100))
        expect(cubuk.stripShown.value).toBe(true)
        headlineRef.value = null
        ofsetRef.value = 0
        kanca.watchers[0].cb()
        expect(eski.kapali).toBe(true)
        expect(cubuk.stripShown.value).toBe(false)
        expect(acik()).toHaveLength(1)
        expect(acik()[0].gozlenen).toEqual([sentinelRef.value])
        expect(acik()[0].secenek.rootMargin).toBe(`0px 0px ${ALT_PAY_PX}px 0px`)
    })

    it('gizli -> normal (Home acik): YENI baslik ogesi dogar; izleyici kaynagi onu gorur, post izleyici onu izleyen gozlemciyi kurar', () => {
        const { cubuk, headlineRef, ofsetRef, sentinelRef } = kurBaslikli({ baslik: null, ofset: 0 })
        expect(degerler()).toEqual([0, null, sentinelRef.value])
        headlineRef.value = { getBoundingClientRect: () => ({ bottom: 250 }) }
        ofsetRef.value = 44
        // Not: ref() duz nesneyi proxy'ler; karsilastirma ref'in okudugu ogeyle (gercek DOM ogesi proxy'lenmez).
        const yeni = headlineRef.value
        expect(degerler()).toEqual([44, yeni, sentinelRef.value])
        kanca.watchers[0].cb()
        const b = izleyen(yeni)
        expect(b).toHaveLength(1)
        expect(b[0].kapali).toBe(false)
        b[0].cb(giris(-5, 100))
        expect(cubuk.stripShown.value).toBe(true)
    })

    it('yalniz baslik ogesi degisirse baslik gozlemcisi yeniden kurulur, gozcu gozlemcisi korunur', () => {
        const { headlineRef, sentinelRef } = kurBaslikli()
        const gozcuIO = izleyen(sentinelRef.value)[0]
        const eskiB = izleyen(headlineRef.value)[0]
        headlineRef.value = { getBoundingClientRect: () => ({ bottom: 1 }) }
        kanca.watchers[0].cb()
        expect(gozcuIO.kapali).toBe(false)
        expect(eskiB.kapali).toBe(true)
        expect(izleyen(headlineRef.value)).toHaveLength(1)
        expect(ioler).toHaveLength(3)
    })

    it('ayni girdilerle yeniden kurulum iki gozlemciyi de korur (mount ta onMounted + ref yazimi izleyicisi)', () => {
        const { cubuk, headlineRef } = kurBaslikli()
        izleyen(headlineRef.value)[0].cb(giris(10, 100))
        kanca.watchers[0].cb()
        kanca.watchers[0].cb()
        expect(ioler).toHaveLength(2)
        expect(acik()).toHaveLength(2)
        expect(cubuk.stripShown.value).toBe(true)
    })

    it('kok degisince iki gozlemci de yeni kokle kurulur', () => {
        const { scrollerRef, headlineRef } = kurBaslikli()
        scrollerRef.value = { getBoundingClientRect: () => ({ top: 0 }), clientTop: 0 }
        const yeniKok = scrollerRef.value
        kanca.watchers[0].cb()
        expect(ioler).toHaveLength(4)
        expect(acik()).toHaveLength(2)
        for (const io of acik()) expect(io.secenek.root).toBe(yeniKok)
        expect(izleyen(headlineRef.value).filter((io) => !io.kapali)).toHaveLength(1)
    })

    it('kok null ya da IntersectionObserver yoksa baslik gozlemcisi kurulmaz, hata yok', () => {
        kurBaslikli({ kok: null })
        expect(ioler).toHaveLength(0)
        vi.stubGlobal('IntersectionObserver', undefined)
        expect(() => kurBaslikli()).not.toThrow()
        expect(ioler).toHaveLength(0)
    })

    it('recompute iki durumu da bir kez olcer: stripShown = baslik alti <= kok ustu (ofsetsiz), stuck = gozcu alti <= kok ustu + ofset', () => {
        let bAlt = 101
        let gAlt = 400
        const { cubuk } = kurBaslikli({
            kok: { getBoundingClientRect: () => ({ top: 90 }), clientTop: 10 },
            gozcu: { getBoundingClientRect: () => ({ bottom: gAlt }) },
            baslik: { getBoundingClientRect: () => ({ bottom: bAlt }) },
        })
        cubuk.recompute()
        expect(cubuk.stripShown.value).toBe(false)
        expect(cubuk.stuck.value).toBe(false)
        bAlt = 100
        cubuk.recompute()
        expect(cubuk.stripShown.value).toBe(true)
        expect(cubuk.stuck.value).toBe(false)
        bAlt = -300
        gAlt = 144
        cubuk.recompute()
        expect(cubuk.stripShown.value).toBe(true)
        expect(cubuk.stuck.value).toBe(true)
        bAlt = 101
        cubuk.recompute()
        expect(cubuk.stripShown.value).toBe(false)
    })

    it('recompute: baslik null ise stripShown false; kok null ise hicbir sey yapmaz', () => {
        const { cubuk, headlineRef, scrollerRef } = kurBaslikli()
        izleyen(headlineRef.value)[0].cb(giris(10, 100))
        scrollerRef.value = null
        expect(() => cubuk.recompute()).not.toThrow()
        expect(cubuk.stripShown.value).toBe(true)
        scrollerRef.value = { getBoundingClientRect: () => ({ top: 100 }), clientTop: 0 }
        headlineRef.value = null
        cubuk.recompute()
        expect(cubuk.stripShown.value).toBe(false)
    })

    it('ayrilirken iki gozlemci de kapanir', () => {
        kurBaslikli()
        for (const fn of kanca.unmount) fn()
        expect(ioler).toHaveLength(2)
        expect(acik()).toHaveLength(0)
    })
})

describe('useHomeStickyBar kaynak kilidi -- mini serit (G11)', () => {
    it('yeniden kurulum izleyicisinin kaynak dizisinde headlineRef gecer; izleyici flush post', () => {
        const m = kaynak.match(/watch\(\[([^\]]*)\],\s*yenidenKur,\s*\{\s*flush:\s*'post'\s*\}\)/)
        expect(m).not.toBeNull()
        expect(m[1]).toContain('headlineRef?.value')
        expect(m[1]).toContain('offsetPx')
        expect(m[1]).toContain('sentinelRef.value')
    })
    it('baslik ref i null dalinda stripShown.value = false', () => {
        expect(kaynak).toMatch(/if \(!baslik\) stripShown\.value = false/)
    })
    it('baslik gozlemcisi yalniz kok ve baslik dolu, typeof IntersectionObserver === function iken kurulur', () => {
        expect(kaynak).toMatch(/!kok \|\| !baslik \|\| typeof IntersectionObserver !== 'function'/)
    })
})

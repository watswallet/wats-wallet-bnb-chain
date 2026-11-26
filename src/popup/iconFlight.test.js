import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
    createIconFlight,
    flipTransform,
    isFullyVisible,
    FLIGHT_MS,
    FLIGHT_SAFETY_MS,
    FLIGHT_WAIT_MS,
} from './iconFlight'
import { yorumsuz } from '../test-utils/kaynakTarama'

// Sahte DOM: yalniz denetleyicinin kullandigi yuzey. Testler SSR/node ortaminda (DOM yok).
function sahteDoc({ reduce = false, sinif = [] } = {}) {
    const ogeler = []
    const klonlar = []
    const app = {
        id: 'app',
        children: [],
        appendChild(c) { this.children.push(c); c.parent = this; return c },
    }
    const doc = {
        ogeler,
        klonlar,
        app,
        visibilityState: 'visible',
        defaultView: { matchMedia: () => ({ matches: reduce }) },
        documentElement: { classList: { contains: (c) => sinif.includes(c) } },
        getElementById: (id) => (id === 'app' ? app : null),
        querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null },
        querySelectorAll(sel) {
            if (sel === '#app') return [app]
            const m = /^\[([\w-]+)\]$/.exec(sel)
            if (!m) throw new Error('beklenmeyen secici: ' + sel)
            return ogeler.filter((o) => !o.silindi && o.getAttribute(m[1]) !== null)
        },
        createElement: () => oge(doc, { rect: bos() }),
    }
    return doc
}

const bos = () => ({ left: 0, top: 0, width: 0, height: 0 })

function oge(doc, { rect, attrs = {}, kaydet = true } = {}) {
    const yazimlar = []
    const stilDeger = {}
    const style = new Proxy(stilDeger, {
        set(t, k, v) { t[k] = v; yazimlar.push([k, v]); return true },
    })
    const o = {
        attrs: { ...attrs },
        rect: { ...rect },
        style,
        yazimlar,
        dinleyiciler: {},
        olcum: 0,
        silindi: false,
        parent: null,
        getBoundingClientRect() {
            o.olcum++
            yazimlar.push(['@olcum'])
            const r = o.rect
            return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height }
        },
        getAttribute: (k) => (Object.prototype.hasOwnProperty.call(o.attrs, k) ? o.attrs[k] : null),
        setAttribute: (k, v) => { o.attrs[k] = String(v) },
        removeAttribute: (k) => { delete o.attrs[k] },
        cloneNode: () => {
            const c = oge(doc, { rect: o.rect, attrs: o.attrs, kaydet: false })
            c.kaynak = o
            doc.klonlar.push(c)
            return c
        },
        closest: () => null,
        addEventListener: (t, f) => { (o.dinleyiciler[t] ||= []).push(f) },
        removeEventListener: (t, f) => { o.dinleyiciler[t] = (o.dinleyiciler[t] || []).filter((x) => x !== f) },
        dispatch: (t, e = {}) => { for (const f of [...(o.dinleyiciler[t] || [])]) f({ target: o, propertyName: 'transform', ...e }) },
        remove: () => {
            o.silindi = true
            if (o.parent) o.parent.children = o.parent.children.filter((x) => x !== o)
            o.parent = null
        },
    }
    if (kaydet) doc.ogeler.push(o)
    return o
}

const ANAHTAR = '56_0xabc'

// Ana sayfa: sekme satiri alt kenari 200, kaydirici alt kenari 600; satir simgesi 40px.
function anaSayfa(doc, { simgeTop = 300, anahtar = ANAHTAR } = {}) {
    const scroller = oge(doc, { rect: { left: 0, top: 0, width: 360, height: 600 }, attrs: { 'data-home-scroller': '' } })
    const tabs = oge(doc, { rect: { left: 0, top: 160, width: 360, height: 40 }, attrs: { 'data-home-tabs': '' } })
    const simge = oge(doc, { rect: { left: 24, top: simgeTop, width: 40, height: 40 }, attrs: { 'data-flight-icon': anahtar } })
    return { scroller, tabs, simge }
}

// Vue degisimi: eski sayfa kalkar (display:none), yeni sayfa kurulur.
const kaldir = (...l) => { for (const o of l) o.silindi = true }

function tokenBasligi(doc) {
    return oge(doc, { rect: { left: 20, top: 20, width: 40, height: 40 }, attrs: { 'data-flight-target': '' } })
}

function kur(opts = {}) {
    const doc = opts.doc ?? sahteDoc(opts)
    const durum = {
        stock: opts.stock ?? false,
        gizli: opts.gizli ?? false,
        anahtar: opts.anahtar === undefined ? ANAHTAR : opts.anahtar,
        sekme: opts.sekme ?? 'assets',
    }
    const ucus = createIconFlight({
        doc,
        ...(opts.allowed ? { allowed: opts.allowed } : {}),
        isStockPage: () => durum.stock,
        isPrivate: () => durum.gizli,
        selectedKey: () => durum.anahtar,
        homeTab: () => durum.sekme,
    })
    return { doc, durum, ucus }
}

const kopyalar = (doc) => doc.app.children.filter((c) => c.kaynak)

beforeEach(() => {
    vi.useFakeTimers()
})
afterEach(() => {
    vi.useRealTimers()
})

describe('sabitler ve saf yardimcilar', () => {
    it('sureler', () => {
        expect(FLIGHT_MS).toBe(240)
        expect(FLIGHT_SAFETY_MS).toBe(400)
        expect(FLIGHT_WAIT_MS).toBe(150)
    })
    it('flipTransform: hedefteki ogeyi kaynakta gosterir (koken sol ust)', () => {
        expect(flipTransform({ left: 10, top: 20, width: 20, height: 20 }, { left: 100, top: 200, width: 40, height: 40 }))
            .toBe('translate(-90px, -180px) scale(0.5, 0.5)')
        expect(flipTransform({ left: 5, top: 5, width: 40, height: 40 }, { left: 5, top: 5, width: 40, height: 40 }))
            .toBe('translate(0px, 0px) scale(1, 1)')
    })
    it('isFullyVisible: ust ve alt sinir icinde, bos dikdortgen gorunmez', () => {
        const b = { top: 200, bottom: 600 }
        expect(isFullyVisible({ left: 0, top: 200, width: 40, height: 40 }, b)).toBe(true)
        expect(isFullyVisible({ left: 0, top: 560, width: 40, height: 40 }, b)).toBe(true)
        expect(isFullyVisible({ left: 0, top: 199, width: 40, height: 40 }, b)).toBe(false)
        expect(isFullyVisible({ left: 0, top: 561, width: 40, height: 40 }, b)).toBe(false)
        expect(isFullyVisible({ left: 0, top: 300, width: 0, height: 0 }, b)).toBe(false)
        expect(isFullyVisible(null, b)).toBe(false)
    })
})

describe('ileri ucus: Varliklar satiri -> Token', () => {
    it("'flight' doner; afterPatch kopyayi #app'e ekler, hedef gizlenir, 400 ms sonra temizlenir", () => {
        const { doc, ucus } = kur()
        const home = anaSayfa(doc)
        expect(ucus.onPageChange('token', 'home', 'fwd')).toBe('flight')
        kaldir(home.scroller, home.tabs, home.simge)
        const hedef = tokenBasligi(doc)
        ucus.afterPatch()

        const k = kopyalar(doc)
        expect(k).toHaveLength(1)
        const kopya = k[0]
        expect(kopya.kaynak).toBe(hedef)
        expect(kopya.style.position).toBe('fixed')
        expect(kopya.style.pointerEvents).toBe('none')
        expect(String(kopya.style.zIndex)).toBe('40')
        expect(kopya.style.margin).toBe('0')
        expect(kopya.style.left).toBe('20px')
        expect(kopya.style.top).toBe('20px')
        expect(kopya.style.width).toBe('40px')
        expect(kopya.style.height).toBe('40px')
        expect(kopya.style.transformOrigin).toBe('0 0')
        expect(kopya.getAttribute('aria-hidden')).toBe('true')
        expect(kopya.getAttribute('data-flight-target')).toBeNull()
        expect(hedef.style.visibility).toBe('hidden')

        // FLIP sirasi: once kaynaktaki donusum, bir yerlesim okumasi, sonra gecis + transform:none.
        const tr = kopya.yazimlar.filter((y) => y[0] === 'transform').map((y) => y[1])
        expect(tr[0]).toBe(flipTransform({ left: 24, top: 300, width: 40, height: 40 }, { left: 20, top: 20, width: 40, height: 40 }))
        expect(tr.at(-1)).toBe('none')
        const ilkTr = kopya.yazimlar.findIndex((y) => y[0] === 'transform')
        const olcum = kopya.yazimlar.findIndex((y) => y[0] === '@olcum')
        const gecis = kopya.yazimlar.findIndex((y) => y[0] === 'transition' && /transform/.test(y[1]))
        expect(ilkTr).toBeGreaterThanOrEqual(0)
        expect(olcum).toBeGreaterThan(ilkTr)
        expect(gecis).toBeGreaterThan(olcum)
        expect(kopya.style.transition).toMatch(/^transform 0?\.24s var\(--ease-kaymak\)$/)

        vi.advanceTimersByTime(FLIGHT_SAFETY_MS - 1)
        expect(kopyalar(doc)).toHaveLength(1)
        vi.advanceTimersByTime(1)
        expect(kopyalar(doc)).toHaveLength(0)
        expect(kopya.silindi).toBe(true)
        expect(hedef.style.visibility).toBe('')
    })

    it('transitionend kopyayi kaldirir; cocuktan gelen transitionend yok sayilir', () => {
        const { doc, ucus } = kur()
        const home = anaSayfa(doc)
        ucus.onPageChange('token', 'home', 'fwd')
        kaldir(home.scroller, home.tabs, home.simge)
        const hedef = tokenBasligi(doc)
        ucus.afterPatch()
        const kopya = kopyalar(doc)[0]
        kopya.dispatch('transitionend', { target: { cocuk: true } })
        expect(kopyalar(doc)).toHaveLength(1)
        kopya.dispatch('transitionend')
        expect(kopyalar(doc)).toHaveLength(0)
        expect(hedef.style.visibility).toBe('')
        // emniyet zamanlayicisi da temizlendi: sonradan hicbir sey olmaz
        expect(vi.getTimerCount()).toBe(0)
    })

    it('hedef bulunamazsa afterPatch hicbir sey yapmaz', () => {
        const { doc, ucus } = kur()
        const home = anaSayfa(doc)
        expect(ucus.onPageChange('token', 'home', 'fwd')).toBe('flight')
        kaldir(home.scroller, home.tabs, home.simge)
        ucus.afterPatch()
        expect(kopyalar(doc)).toHaveLength(0)
    })

    it('ucus olmayan degisimde afterPatch hicbir sey yapmaz', () => {
        const { doc, ucus } = kur()
        anaSayfa(doc)
        tokenBasligi(doc)
        expect(ucus.onPageChange('send', 'home', 'fwd')).toBe('fwd')
        ucus.afterPatch()
        expect(kopyalar(doc)).toHaveLength(0)
    })

    const atlama = [
        ['hareket azalt', { reduce: true }],
        ['gizli belge', { gizliBelge: true }],
        ['gizli mod', { gizli: true }],
        ['hisse sayfasi', { stock: true }],
        ['privacy-switching sinifi', { sinif: ['privacy-switching'] }],
        ['privacy-arriving sinifi', { sinif: ['privacy-arriving'] }],
        ['kaynak sekmelerin altinda kaliyor (top < tabs.bottom)', { simgeTop: 180 }],
        ['kaynak kaydiricinin altindan tasiyor', { simgeTop: 570 }],
        ['secili anahtar yok', { anahtar: null }],
        ['kaynak anahtari secimle eslesmiyor', { simgeAnahtari: '1_0xdef' }],
    ]
    for (const [ad, o] of atlama) {
        it(`atlama: ${ad} -> dir aynen, kopya yok`, () => {
            const { doc, ucus } = kur(o)
            if (o.gizliBelge) doc.visibilityState = 'hidden'
            const home = anaSayfa(doc, { simgeTop: o.simgeTop ?? 300, anahtar: o.simgeAnahtari ?? ANAHTAR })
            expect(ucus.onPageChange('token', 'home', 'fwd')).toBe('fwd')
            kaldir(home.scroller, home.tabs, home.simge)
            const hedef = tokenBasligi(doc)
            ucus.afterPatch()
            expect(kopyalar(doc)).toHaveLength(0)
            expect(hedef.style.visibility).toBeUndefined()
        })
    }

    it('yalniz home -> token ileri yonunde: baska yon ya da kaynak sayfa ucus degil', () => {
        const { doc, ucus } = kur()
        anaSayfa(doc)
        expect(ucus.onPageChange('token', 'home', 'none')).toBe('none')
        expect(ucus.onPageChange('token', 'select_asset', 'fwd')).toBe('fwd')
        expect(ucus.onPageChange('send', 'home', 'fwd')).toBe('fwd')
    })

    it('sekme satiri ya da kaydirici isareti yoksa ucus yok', () => {
        const { doc, ucus } = kur()
        oge(doc, { rect: { left: 24, top: 300, width: 40, height: 40 }, attrs: { 'data-flight-icon': ANAHTAR } })
        expect(ucus.onPageChange('token', 'home', 'fwd')).toBe('fwd')
    })
})

describe('geri ucus: Token -> ana sayfa', () => {
    function ileriUcus(o = {}) {
        const k = kur(o)
        const home = anaSayfa(k.doc)
        expect(k.ucus.onPageChange('token', 'home', 'fwd')).toBe('flight')
        kaldir(home.scroller, home.tabs, home.simge)
        const hedef = tokenBasligi(k.doc)
        k.ucus.afterPatch()
        vi.advanceTimersByTime(FLIGHT_SAFETY_MS)
        expect(kopyalar(k.doc)).toHaveLength(0)
        return { ...k, hedef }
    }

    it("dogrudan ileri ucusla baslayan ziyarette 'flight'; homeReady(true) simgeye ucurur", () => {
        const { doc, ucus, hedef } = ileriUcus()
        expect(ucus.onPageChange('home', 'token', 'back')).toBe('flight')
        kaldir(hedef)
        const home = anaSayfa(doc, { simgeTop: 320 })
        vi.advanceTimersByTime(FLIGHT_WAIT_MS - 1)
        ucus.homeReady(true)
        const k = kopyalar(doc)
        expect(k).toHaveLength(1)
        expect(k[0].kaynak).toBe(home.simge)
        expect(k[0].style.pointerEvents).toBe('none')
        expect(k[0].getAttribute('data-flight-icon')).toBeNull()
        const tr = k[0].yazimlar.filter((y) => y[0] === 'transform').map((y) => y[1])
        expect(tr[0]).toBe(flipTransform({ left: 20, top: 20, width: 40, height: 40 }, { left: 24, top: 320, width: 40, height: 40 }))
        expect(tr.at(-1)).toBe('none')
        expect(home.simge.style.visibility).toBe('hidden')
        vi.advanceTimersByTime(FLIGHT_SAFETY_MS)
        expect(kopyalar(doc)).toHaveLength(0)
        expect(home.simge.style.visibility).toBe('')
    })

    it('geri ucus tek seferlik: ikinci token -> home ziyareti ucussuz', () => {
        const { doc, ucus, hedef } = ileriUcus()
        expect(ucus.onPageChange('home', 'token', 'back')).toBe('flight')
        kaldir(hedef)
        anaSayfa(doc)
        ucus.homeReady(true)
        vi.advanceTimersByTime(FLIGHT_SAFETY_MS)
        tokenBasligi(doc)
        expect(ucus.onPageChange('token', 'home', 'none')).toBe('none')
        expect(ucus.onPageChange('home', 'token', 'back')).toBe('back')
    })

    it('home->token (ucus), token->send, send->token, token->home: geri ucus yok', () => {
        const { doc, ucus } = ileriUcus()
        expect(ucus.onPageChange('send', 'token', 'fwd')).toBe('fwd')
        expect(ucus.onPageChange('token', 'send', 'back')).toBe('back')
        tokenBasligi(doc)
        expect(ucus.onPageChange('home', 'token', 'back')).toBe('back')
        anaSayfa(doc)
        ucus.homeReady(true)
        expect(kopyalar(doc)).toHaveLength(0)
    })

    it('ileri ucussuz Token ziyaretinden donus ucussuz', () => {
        const { doc, ucus } = kur()
        anaSayfa(doc, { simgeTop: 180 })
        expect(ucus.onPageChange('token', 'home', 'fwd')).toBe('fwd')
        tokenBasligi(doc)
        expect(ucus.onPageChange('home', 'token', 'back')).toBe('back')
    })

    const geriAtlama = [
        ['hareket azalt', (d) => { d.doc.defaultView.matchMedia = () => ({ matches: true }) }],
        ['gizli mod', (d) => { d.durum.gizli = true }],
        ['hatirlanan sekme assets degil', (d) => { d.durum.sekme = 'stocks' }],
        ['secim degisti', (d) => { d.durum.anahtar = '1_0xdef' }],
        ['baslik bulunamadi', (d) => { kaldir(d.hedef) }],
    ]
    for (const [ad, boz] of geriAtlama) {
        it(`geri atlama: ${ad} -> 'back'`, () => {
            const d = ileriUcus()
            boz(d)
            expect(d.ucus.onPageChange('home', 'token', 'back')).toBe('back')
            anaSayfa(d.doc)
            d.ucus.homeReady(true)
            expect(kopyalar(d.doc)).toHaveLength(0)
        })
    }

    it('geri bekleme: homeReady(true) 150 ms sonra gelirse kopya yok', () => {
        const { doc, ucus, hedef } = ileriUcus()
        expect(ucus.onPageChange('home', 'token', 'back')).toBe('flight')
        kaldir(hedef)
        const home = anaSayfa(doc)
        vi.advanceTimersByTime(FLIGHT_WAIT_MS)
        ucus.homeReady(true)
        expect(kopyalar(doc)).toHaveLength(0)
        expect(home.simge.style.visibility).toBeUndefined()
    })

    it('homeReady(false) iptal eder; sonradan gelen homeReady(true) da ucurmaz', () => {
        const { doc, ucus, hedef } = ileriUcus()
        expect(ucus.onPageChange('home', 'token', 'back')).toBe('flight')
        kaldir(hedef)
        anaSayfa(doc)
        ucus.homeReady(false)
        ucus.homeReady(true)
        expect(kopyalar(doc)).toHaveLength(0)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('hedef simge gorunur alanda degilse ucus yok', () => {
        const { doc, ucus, hedef } = ileriUcus()
        expect(ucus.onPageChange('home', 'token', 'back')).toBe('flight')
        kaldir(hedef)
        const home = anaSayfa(doc, { simgeTop: 590 })
        ucus.homeReady(true)
        expect(kopyalar(doc)).toHaveLength(0)
        expect(home.simge.style.visibility).toBeUndefined()
    })

    it('bekleyen geri ucus yokken homeReady yok sayilir', () => {
        const { doc, ucus } = kur()
        anaSayfa(doc)
        ucus.homeReady(true)
        expect(kopyalar(doc)).toHaveLength(0)
    })
})

describe('Review Focus 4: ucus ya da bekleme surerken yeni gezinme', () => {
    it('ileri ucus surerken yeni onPageChange kopyayi hemen kaldirir, hedef gorunur', () => {
        const { doc, ucus } = kur()
        const home = anaSayfa(doc)
        ucus.onPageChange('token', 'home', 'fwd')
        kaldir(home.scroller, home.tabs, home.simge)
        const hedef = tokenBasligi(doc)
        ucus.afterPatch()
        expect(kopyalar(doc)).toHaveLength(1)
        expect(ucus.onPageChange('send', 'token', 'fwd')).toBe('fwd')
        expect(kopyalar(doc)).toHaveLength(0)
        expect(hedef.style.visibility).toBe('')
        expect(vi.getTimerCount()).toBe(0)
        ucus.afterPatch()
        expect(kopyalar(doc)).toHaveLength(0)
    })

    it('geri bekleme sirasinda yeni onPageChange, ardindan gelen homeReady(true): kopya yok', () => {
        const { doc, ucus } = kur()
        const home = anaSayfa(doc)
        ucus.onPageChange('token', 'home', 'fwd')
        kaldir(home.scroller, home.tabs, home.simge)
        const hedef = tokenBasligi(doc)
        ucus.afterPatch()
        vi.advanceTimersByTime(FLIGHT_SAFETY_MS)
        expect(ucus.onPageChange('home', 'token', 'back')).toBe('flight')
        kaldir(hedef)
        const home2 = anaSayfa(doc)
        expect(ucus.onPageChange('send', 'home', 'fwd')).toBe('fwd')
        ucus.homeReady(true)
        expect(kopyalar(doc)).toHaveLength(0)
        expect(home2.simge.style.visibility).toBeUndefined()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('cancel() suren ucusu ve bekleyen anahtari siler', () => {
        const { doc, ucus } = kur()
        const home = anaSayfa(doc)
        ucus.onPageChange('token', 'home', 'fwd')
        kaldir(home.scroller, home.tabs, home.simge)
        const hedef = tokenBasligi(doc)
        ucus.afterPatch()
        ucus.cancel()
        expect(kopyalar(doc)).toHaveLength(0)
        expect(hedef.style.visibility).toBe('')
        expect(ucus.onPageChange('home', 'token', 'back')).toBe('back')
    })
})

describe('DOM yokken (SSR) guvenli', () => {
    it('doc null: dir aynen doner, afterPatch/homeReady/cancel atmaz', () => {
        const ucus = createIconFlight({ doc: null, allowed: () => true, selectedKey: () => ANAHTAR })
        expect(ucus.onPageChange('token', 'home', 'fwd')).toBe('fwd')
        expect(() => { ucus.afterPatch(); ucus.homeReady(true); ucus.cancel() }).not.toThrow()
    })
})

describe('kaynak kilidi (K2)', () => {
    it('iconFlight.js store ve chrome import etmez, chrome. gecmez, currentPage yazmaz', () => {
        const k = yorumsuz(readFileSync(fileURLToPath(new URL('./iconFlight.js', import.meta.url)), 'utf8'))
        expect(k).not.toMatch(/from\s+['"][^'"]*(store|chrome)/)
        expect(k).not.toMatch(/(import|require)\s*\(\s*['"][^'"]*(store|chrome)/)
        expect(k).not.toContain('chrome.')
        expect(k).not.toMatch(/\bchrome\b/)
        expect(k).not.toContain('currentPage')
        expect(k).not.toMatch(/\b(localStorage|sessionStorage|indexedDB)\b/)
    })
})

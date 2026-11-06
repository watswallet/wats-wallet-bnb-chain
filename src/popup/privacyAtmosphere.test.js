import { describe, it, expect, vi, afterEach } from 'vitest'
import { createAtmosphereController, ATMOSPHERE_PAUSED_PAGES } from './privacyAtmosphere'

afterEach(() => { vi.useRealTimers() })

function fakeDoc({ vt = true, reducedMotion = false } = {}) {
    const classes = new Set()
    const doc = {
        documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } },
        defaultView: { matchMedia: (q) => ({ matches: reducedMotion && q.includes('reduce') }) },
        classes,
        started: 0,
        arrivingDuringUpdate: null,
    }
    if (vt) {
        doc.startViewTransition = (update) => {
            doc.started++
            doc.arrivingDuringUpdate = classes.has('privacy-arriving')
            update()
            return { finished: Promise.resolve() }
        }
    }
    return doc
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('privacyAtmosphere', () => {
    it('acilis, giris ve sifremi unuttum ekranlari duraklatir', () => {
        expect([...ATMOSPHERE_PAUSED_PAGES].sort()).toEqual(['', 'forgot_password', 'welcome'])
        for (const p of ATMOSPHERE_PAUSED_PAGES) {
            const doc = fakeDoc()
            createAtmosphereController({ doc }).onPageChange(p, null)
            expect(doc.classes.has('privacy-paused'), p).toBe(true)
        }
    })

    it('giristen ana ekrana: sayfa belirene kadar bekler, sonra gecisle kaldirir', async () => {
        const doc = fakeDoc()
        const c = createAtmosphereController({ doc })
        c.onPageChange('welcome', '')
        c.onPageChange('home', 'welcome')
        expect(doc.classes.has('privacy-paused')).toBe(true)
        c.onPageEntered()
        expect(doc.started).toBe(1)
        expect(doc.arrivingDuringUpdate).toBe(true)
        expect(doc.classes.has('privacy-paused')).toBe(false)
        await flush()
        expect(doc.classes.has('privacy-arriving')).toBe(false)
    })

    it('acilis yuklemesinden ana ekrana (kilitsiz popup): gecis oynamaz, aninda kalkar', () => {
        const doc = fakeDoc()
        const c = createAtmosphereController({ doc })
        c.onPageChange('', null)
        c.onPageChange('home', '')
        expect(doc.classes.has('privacy-paused')).toBe(false)
        c.onPageEntered()
        expect(doc.started).toBe(0)
    })

    it('kilitlenince tekrar duraklatir; bekleyen gecis iptal olur', () => {
        const doc = fakeDoc()
        const c = createAtmosphereController({ doc })
        c.onPageChange('welcome', '')
        c.onPageChange('home', 'welcome')
        c.onPageChange('welcome', 'home')
        c.onPageEntered()
        expect(doc.started).toBe(0)
        expect(doc.classes.has('privacy-paused')).toBe(true)
    })

    it('duraklatma yokken sayfa degisimi hicbir sey yapmaz', () => {
        const doc = fakeDoc()
        const c = createAtmosphereController({ doc })
        c.onPageChange('token', 'home')
        c.onPageEntered()
        expect(doc.started).toBe(0)
        expect(doc.classes.size).toBe(0)
    })

    it('hareketi azalt / API yok: gecissiz kaldirir', () => {
        for (const opts of [{ reducedMotion: true }, { vt: false }]) {
            const doc = fakeDoc(opts)
            const c = createAtmosphereController({ doc })
            c.onPageChange('welcome', '')
            c.onPageChange('home', 'welcome')
            c.onPageEntered()
            expect(doc.started).toBe(0)
            expect(doc.classes.has('privacy-paused')).toBe(false)
        }
    })

    it('sayfa belirme olayi gelmezse emniyet suresi sonunda yine kaldirir', () => {
        vi.useFakeTimers()
        const doc = fakeDoc()
        const c = createAtmosphereController({ doc, fallbackMs: 1500 })
        c.onPageChange('welcome', '')
        c.onPageChange('home', 'welcome')
        vi.advanceTimersByTime(1499)
        expect(doc.classes.has('privacy-paused')).toBe(true)
        vi.advanceTimersByTime(1)
        expect(doc.classes.has('privacy-paused')).toBe(false)
        c.onPageEntered()
        expect(doc.started).toBe(1)
    })

    it('belge yoksa (SSR) firlatmaz', () => {
        const c = createAtmosphereController({ doc: undefined })
        expect(() => { c.onPageChange('welcome', ''); c.onPageChange('home', 'welcome'); c.onPageEntered() }).not.toThrow()
    })
})

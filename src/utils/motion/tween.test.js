// KAYMAK G7: sayan degerler (spec 7.6, K6, K7, D8). Saf tween, paylasilan ticker, birlestirici, sayac.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { easeOutQuart, createTicker, getSharedTicker, createCoalescer, createCounter } from './tween.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'

// Elle adimlanan sahte ticker: add kaydeder, test tick(now) ile kare atar.
function sahteTicker() {
    const fns = new Set()
    return {
        fns,
        add(fn) { fns.add(fn) },
        remove(fn) { fns.delete(fn) },
        tick(now) {
            for (const fn of [...fns]) {
                if (!fns.has(fn)) continue
                if (fn(now) === false) fns.delete(fn)
            }
        },
    }
}

const bicim = (n) => n.toFixed(2)

function kur({ text = '100 SON', value = 100, identity = 'k', izin = true, ticker = sahteTicker(), durationMs, coalesceMs } = {}) {
    const yazilan = []
    const izinRef = { v: izin }
    const sayac = createCounter({
        initial: { text, value, identity },
        format: bicim,
        onText: (s) => yazilan.push(s),
        ticker,
        motionAllowed: () => izinRef.v,
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(coalesceMs !== undefined ? { coalesceMs } : {}),
    })
    return { sayac, yazilan, ticker, izinRef }
}

afterEach(() => {
    vi.useRealTimers()
})

describe('easeOutQuart', () => {
    it('0 -> 0, 1 -> 1, araliga kirpar', () => {
        expect(easeOutQuart(0)).toBe(0)
        expect(easeOutQuart(1)).toBe(1)
        expect(easeOutQuart(-1)).toBe(0)
        expect(easeOutQuart(2)).toBe(1)
        expect(easeOutQuart(Number.NaN)).toBe(0)
    })

    it('1 - (1-t)^4 ve monoton artan', () => {
        expect(easeOutQuart(0.5)).toBeCloseTo(1 - 0.5 ** 4, 12)
        let onceki = -1
        for (let i = 0; i <= 100; i++) {
            const v = easeOutQuart(i / 100)
            expect(v).toBeGreaterThanOrEqual(onceki)
            onceki = v
        }
    })
})

describe('createTicker', () => {
    function sahteRaf() {
        let id = 0
        const bekleyen = new Map()
        return {
            bekleyen,
            raf: vi.fn((cb) => { id += 1; bekleyen.set(id, cb); return id }),
            caf: vi.fn((i) => { bekleyen.delete(i) }),
            kare() {
                const cbs = [...bekleyen.values()]
                bekleyen.clear()
                for (const cb of cbs) cb()
            },
        }
    }

    it('tek rAF dongusu butun kayitlari ilerletir; false donen cikarilir; bos kalinca durur', () => {
        const r = sahteRaf()
        let simdi = 0
        const t = createTicker({ raf: r.raf, caf: r.caf, now: () => simdi })
        const a = vi.fn(() => true)
        let bSayac = 0
        const b = vi.fn(() => { bSayac += 1; return bSayac < 2 })
        t.add(a)
        t.add(b)
        expect(r.raf).toHaveBeenCalledTimes(1)
        simdi = 16
        r.kare()
        expect(a).toHaveBeenLastCalledWith(16)
        expect(b).toHaveBeenLastCalledWith(16)
        expect(r.bekleyen.size).toBe(1)
        simdi = 32
        r.kare()
        expect(b).toHaveBeenCalledTimes(2)
        simdi = 48
        r.kare()
        expect(b).toHaveBeenCalledTimes(2)
        expect(a).toHaveBeenCalledTimes(3)
        t.remove(a)
        expect(r.caf).toHaveBeenCalledTimes(1)
        expect(r.bekleyen.size).toBe(0)
    })

    it('kayit kalmayinca yeni kare istenmez; yeniden add donguyu baslatir', () => {
        const r = sahteRaf()
        const t = createTicker({ raf: r.raf, caf: r.caf, now: () => 0 })
        t.add(() => false)
        r.kare()
        expect(r.bekleyen.size).toBe(0)
        expect(r.raf).toHaveBeenCalledTimes(1)
        t.add(() => false)
        expect(r.raf).toHaveBeenCalledTimes(2)
    })

    it('hata atan kayit cikarilir, digerleri ilerlemeye devam eder', () => {
        const r = sahteRaf()
        const t = createTicker({ raf: r.raf, caf: r.caf, now: () => 0 })
        const kotu = vi.fn(() => { throw new Error('x') })
        const iyi = vi.fn(() => true)
        t.add(kotu)
        t.add(iyi)
        r.kare()
        r.kare()
        expect(kotu).toHaveBeenCalledTimes(1)
        expect(iyi).toHaveBeenCalledTimes(2)
    })
})

describe('getSharedTicker', () => {
    it('requestAnimationFrame yoksa (SSR/node) null', () => {
        expect(typeof globalThis.requestAnimationFrame).not.toBe('function')
        expect(getSharedTicker()).toBeNull()
    })

    it('rAF varsa tembel tek ornek; kayitlar sahte rAF ile ilerler', () => {
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
        const a = getSharedTicker()
        const b = getSharedTicker()
        expect(a).not.toBeNull()
        expect(a).toBe(b)
        const fn = vi.fn(() => false)
        a.add(fn)
        vi.advanceTimersByTime(20)
        expect(fn).toHaveBeenCalledTimes(1)
        expect(typeof fn.mock.calls[0][0]).toBe('number')
    })
})

describe('createCoalescer', () => {
    it('ilk push pencereyi acar; pencere sonunda son deger kazanir (en fazla ms gecikme)', () => {
        vi.useFakeTimers()
        const c = createCoalescer({ ms: 120 })
        const ates = vi.fn()
        c.push(150, ates)
        vi.advanceTimersByTime(60)
        c.push(180, ates)
        vi.advanceTimersByTime(59)
        expect(ates).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(ates).toHaveBeenCalledTimes(1)
        expect(ates).toHaveBeenCalledWith(180)
    })

    it('cancel bekleyeni dusurur', () => {
        vi.useFakeTimers()
        const c = createCoalescer({ ms: 120 })
        const ates = vi.fn()
        c.push(1, ates)
        c.cancel()
        vi.advanceTimersByTime(500)
        expect(ates).not.toHaveBeenCalled()
    })

    it('enjekte zamanlayici kullanilir', () => {
        const kurulan = []
        const setTimer = vi.fn((fn, ms) => { kurulan.push({ fn, ms }); return kurulan.length })
        const clearTimer = vi.fn()
        const c = createCoalescer({ ms: 120, setTimer, clearTimer })
        const ates = vi.fn()
        c.push('a', ates)
        c.push('b', ates)
        expect(setTimer).toHaveBeenCalledTimes(1)
        expect(kurulan[0].ms).toBe(120)
        kurulan[0].fn()
        expect(ates).toHaveBeenCalledWith('b')
        c.push('c', ates)
        c.cancel()
        expect(clearTimer).toHaveBeenCalledWith(2)
    })
})

describe('createCounter', () => {
    it('ilk deger animasyonsuz: kurulumda onText yok; ayni degerle update de yok', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker } = kur()
        expect(yazilan).toEqual([])
        sayac.update({ text: '100 SON', value: 100, identity: 'k' })
        vi.advanceTimersByTime(500)
        ticker.tick(0)
        expect(yazilan).toEqual([])
        expect(ticker.fns.size).toBe(0)
    })

    it('100 -> 200: 120 ms sonra tween baslar; ara kare format ile; son kare birebir text', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker } = kur()
        sayac.update({ text: '200 SON', value: 200, identity: 'k' })
        vi.advanceTimersByTime(119)
        expect(ticker.fns.size).toBe(0)
        vi.advanceTimersByTime(1)
        expect(ticker.fns.size).toBe(1)
        ticker.tick(1000)
        ticker.tick(1260)
        const ara = yazilan[yazilan.length - 1]
        expect(ara).toBe(bicim(100 + 100 * easeOutQuart(0.5)))
        ticker.tick(1520)
        expect(yazilan[yazilan.length - 1]).toBe('200 SON')
        expect(ticker.fns.size).toBe(0)
        // Bitisten sonra kare yazilmaz.
        const n = yazilan.length
        ticker.tick(2000)
        expect(yazilan.length).toBe(n)
        // Her kare hedefe dogru, asla geri ya da otesine degil.
        const sayilar = yazilan.slice(0, -1).map(Number)
        for (const s of sayilar) {
            expect(s).toBeGreaterThanOrEqual(100)
            expect(s).toBeLessThanOrEqual(200)
        }
    })

    it('sure 0,52 sn: varsayilan durationMs ile 520 ms de biter', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker } = kur()
        sayac.update({ text: '200 SON', value: 200, identity: 'k' })
        vi.advanceTimersByTime(120)
        ticker.tick(0)
        ticker.tick(519)
        expect(yazilan[yazilan.length - 1]).not.toBe('200 SON')
        ticker.tick(520)
        expect(yazilan[yazilan.length - 1]).toBe('200 SON')
    })

    it('kimlik degisimi -> aninda text, tween yok', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker } = kur()
        sayac.update({ text: '900 SON', value: 900, identity: 'k2' })
        expect(yazilan).toEqual(['900 SON'])
        vi.advanceTimersByTime(500)
        ticker.tick(0)
        ticker.tick(300)
        expect(yazilan).toEqual(['900 SON'])
        expect(ticker.fns.size).toBe(0)
    })

    it('value null (—) -> sayiya: aninda', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker } = kur({ text: '—', value: null })
        sayac.update({ text: '200 SON', value: 200, identity: 'k' })
        expect(yazilan).toEqual(['200 SON'])
        vi.advanceTimersByTime(500)
        ticker.tick(0)
        expect(ticker.fns.size).toBe(0)
    })

    it('sonlu olmayan value (NaN, Infinity, undefined) sayilmaz: aninda', () => {
        vi.useFakeTimers()
        for (const bozuk of [Number.NaN, Infinity, undefined]) {
            const { sayac, yazilan, ticker } = kur()
            sayac.update({ text: 'X', value: bozuk, identity: 'k' })
            expect(yazilan).toEqual(['X'])
            sayac.update({ text: '300 SON', value: 300, identity: 'k' })
            expect(yazilan).toEqual(['X', '300 SON'])
            vi.advanceTimersByTime(500)
            expect(ticker.fns.size).toBe(0)
        }
    })

    it('suren tween ortasinda okuma duser (null): aninda text, sonraki tick lerde onText yok, dongu biter (Review Focus 2)', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker } = kur()
        sayac.update({ text: '200 SON', value: 200, identity: 'k' })
        vi.advanceTimersByTime(120)
        ticker.tick(0)
        ticker.tick(100)
        expect(yazilan.length).toBe(1)
        sayac.update({ text: '—', value: null, identity: 'k' })
        expect(yazilan[yazilan.length - 1]).toBe('—')
        expect(ticker.fns.size).toBe(0)
        const n = yazilan.length
        ticker.tick(200)
        ticker.tick(600)
        vi.advanceTimersByTime(500)
        expect(yazilan.length).toBe(n)
    })

    it('suren tween ortasinda kimlik degisir: aninda yeni text, eski hedefe kare yazilmaz', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker } = kur()
        sayac.update({ text: '200 SON', value: 200, identity: 'k' })
        vi.advanceTimersByTime(120)
        ticker.tick(0)
        ticker.tick(100)
        sayac.update({ text: '5 YENI', value: 5, identity: 'k2' })
        expect(yazilan[yazilan.length - 1]).toBe('5 YENI')
        expect(ticker.fns.size).toBe(0)
        ticker.tick(700)
        expect(yazilan[yazilan.length - 1]).toBe('5 YENI')
    })

    it('motionAllowed false -> aninda', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker } = kur({ izin: false })
        sayac.update({ text: '200 SON', value: 200, identity: 'k' })
        expect(yazilan).toEqual(['200 SON'])
        vi.advanceTimersByTime(500)
        expect(ticker.fns.size).toBe(0)
    })

    it('ticker null (SSR / rAF yok) -> aninda', () => {
        vi.useFakeTimers()
        const { sayac, yazilan } = kur({ ticker: null })
        sayac.update({ text: '200 SON', value: 200, identity: 'k' })
        expect(yazilan).toEqual(['200 SON'])
    })

    it('120 ms birlestirme: 0. ms 150, 60. ms 180 -> tek tween hedefi 180, 120. ms de baslar', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker } = kur()
        sayac.update({ text: '150 SON', value: 150, identity: 'k' })
        vi.advanceTimersByTime(60)
        sayac.update({ text: '180 SON', value: 180, identity: 'k' })
        vi.advanceTimersByTime(59)
        expect(ticker.fns.size).toBe(0)
        expect(yazilan).toEqual([])
        vi.advanceTimersByTime(1)
        expect(ticker.fns.size).toBe(1)
        ticker.tick(0)
        ticker.tick(260)
        expect(yazilan[yazilan.length - 1]).toBe(bicim(100 + 80 * easeOutQuart(0.5)))
        ticker.tick(520)
        expect(yazilan[yazilan.length - 1]).toBe('180 SON')
        expect(yazilan).not.toContain('150 SON')
    })

    it('suren tween de yeni hedef: baslangic o anki deger (atlama yok)', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker } = kur()
        sayac.update({ text: '200 SON', value: 200, identity: 'k' })
        vi.advanceTimersByTime(120)
        ticker.tick(1000)
        ticker.tick(1260)
        const anlik = 100 + 100 * easeOutQuart(0.5)
        expect(yazilan[yazilan.length - 1]).toBe(bicim(anlik))
        sayac.update({ text: '300 SON', value: 300, identity: 'k' })
        vi.advanceTimersByTime(120)
        expect(ticker.fns.size).toBe(1)
        ticker.tick(2000)
        ticker.tick(2260)
        const beklenen = anlik + (300 - anlik) * easeOutQuart(0.5)
        expect(yazilan[yazilan.length - 1]).toBe(bicim(beklenen))
        // Yeni tween'in hicbir karesi o anki degerin altina dusmez (100'e ya da 200'e atlama yok).
        const sonrasi = yazilan.slice(yazilan.indexOf(bicim(anlik)) + 1).map(Number)
        for (const s of sonrasi) expect(s).toBeGreaterThanOrEqual(anlik)
        ticker.tick(2520)
        expect(yazilan[yazilan.length - 1]).toBe('300 SON')
    })

    it('birlestirme penceresindeyken kimlik degisti: bekleyen hedef duser, aninda yeni text', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker } = kur()
        sayac.update({ text: '200 SON', value: 200, identity: 'k' })
        vi.advanceTimersByTime(60)
        sayac.update({ text: '7 BASKA', value: 7, identity: 'k2' })
        expect(yazilan).toEqual(['7 BASKA'])
        vi.advanceTimersByTime(500)
        ticker.tick(0)
        ticker.tick(300)
        expect(yazilan).toEqual(['7 BASKA'])
        expect(ticker.fns.size).toBe(0)
    })

    it('hedef ayni sayi, metin farkli: tween yok, metin pencere sonunda birebir', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker } = kur()
        sayac.update({ text: '100 FARKLI', value: 100, identity: 'k' })
        vi.advanceTimersByTime(120)
        expect(yazilan).toEqual(['100 FARKLI'])
        expect(ticker.fns.size).toBe(0)
    })

    it('dispose: ticker dan cikar, zamanlayici temizlenir, sonraki update yazmaz', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker } = kur()
        sayac.update({ text: '200 SON', value: 200, identity: 'k' })
        vi.advanceTimersByTime(120)
        ticker.tick(0)
        expect(ticker.fns.size).toBe(1)
        sayac.update({ text: '250 SON', value: 250, identity: 'k' })
        sayac.dispose()
        expect(ticker.fns.size).toBe(0)
        expect(vi.getTimerCount()).toBe(0)
        const n = yazilan.length
        vi.advanceTimersByTime(500)
        ticker.tick(300)
        sayac.update({ text: '1 X', value: 1, identity: 'k3' })
        expect(yazilan.length).toBe(n)
    })

    it('enjekte setTimer/clearTimer ve coalesceMs kullanilir', () => {
        const kurulan = []
        const setTimer = vi.fn((fn, ms) => { kurulan.push({ fn, ms }); return kurulan.length })
        const clearTimer = vi.fn()
        const ticker = sahteTicker()
        const yazilan = []
        const sayac = createCounter({
            initial: { text: '1', value: 1, identity: '' },
            format: bicim,
            onText: (s) => yazilan.push(s),
            ticker,
            motionAllowed: () => true,
            coalesceMs: 80,
            setTimer,
            clearTimer,
        })
        sayac.update({ text: '2', value: 2, identity: '' })
        expect(kurulan[0].ms).toBe(80)
        sayac.dispose()
        expect(clearTimer).toHaveBeenCalledWith(1)
    })

    it('pencere sonunda hareket izni kalktiysa tween yerine aninda text', () => {
        vi.useFakeTimers()
        const { sayac, yazilan, ticker, izinRef } = kur()
        sayac.update({ text: '200 SON', value: 200, identity: 'k' })
        izinRef.v = false
        vi.advanceTimersByTime(120)
        expect(yazilan).toEqual(['200 SON'])
        expect(ticker.fns.size).toBe(0)
    })
})

describe('tween.js kaynak kilidi (K7)', () => {
    const kaynak = yorumsuz(readFileSync(new URL('./tween.js', import.meta.url), 'utf8'))

    it('store, chrome, vue import yok; chrome. gecmez', () => {
        expect(kaynak).not.toMatch(/from\s+['"][^'"]*(store|chrome|vue)[^'"]*['"]/)
        expect(kaynak).not.toMatch(/import\s*\(/)
        expect(kaynak).not.toContain('chrome.')
    })

    it('@vueuse useTransition kullanilmaz (D8)', () => {
        expect(kaynak).not.toMatch(/useTransition|@vueuse/)
    })
})

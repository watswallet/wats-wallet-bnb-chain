import { describe, it, expect, vi, afterEach } from 'vitest'
import { createTokenBucket } from './tokenBucket'

// Sahte saat: testler gercek zaman beklemez.
function fakeClock(start = 1_000_000) {
    let t = start
    return { now: () => t, advance: (ms) => { t += ms }, set: (v) => { t = v } }
}

describe('createTokenBucket', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('kova dolu baslar: burst kadar istek hemen gecer, bir sonrakini reddeder', () => {
        const clock = fakeClock()
        const b = createTokenBucket({ rate: 1, burst: 3, now: clock.now })

        expect(b.take()).toEqual({ ok: true })
        expect(b.take()).toEqual({ ok: true })
        expect(b.take()).toEqual({ ok: true })
        const denied = b.take()
        expect(denied.ok).toBe(false)
        expect(denied.retryAfterMs).toBe(1000)
    })

    it('retryAfterMs tam: o kadar ms sonra gecer, 1 ms once gecmez', () => {
        const clock = fakeClock()
        const b = createTokenBucket({ rate: 5, burst: 1, now: clock.now })

        expect(b.take().ok).toBe(true)
        expect(b.take()).toEqual({ ok: false, retryAfterMs: 200 })

        clock.advance(199)
        expect(b.take()).toEqual({ ok: false, retryAfterMs: 1 })

        clock.advance(1)
        expect(b.take()).toEqual({ ok: true })
    })

    it('kesirli hizda yukari yuvarlar (3 istek / 10 sn = 0.3/sn -> 3334 ms)', () => {
        const clock = fakeClock()
        const b = createTokenBucket({ rate: 0.3, burst: 3, now: clock.now })
        for (let i = 0; i < 3; i++) expect(b.take().ok).toBe(true)

        const denied = b.take()
        expect(denied).toEqual({ ok: false, retryAfterMs: 3334 })

        clock.advance(3334)
        expect(b.take().ok).toBe(true)
    })

    it('yenileme burst ile sinirlidir: uzun bekleme kovayi tasirmaz', () => {
        const clock = fakeClock()
        const b = createTokenBucket({ rate: 10, burst: 2, now: clock.now })
        expect(b.take().ok).toBe(true)

        clock.advance(3_600_000)

        expect(b.available()).toBe(2)
        expect(b.take().ok).toBe(true)
        expect(b.take().ok).toBe(true)
        expect(b.take().ok).toBe(false)
    })

    it('agirlikli istek: 5 agirlik 20 patlamada 4 kez gecer, 5.si reddedilir', () => {
        const clock = fakeClock()
        const b = createTokenBucket({ rate: 5, burst: 20, now: clock.now })

        for (let i = 0; i < 4; i++) expect(b.take(5).ok).toBe(true)
        expect(b.take(5)).toEqual({ ok: false, retryAfterMs: 1000 })
        // Hafif istek de ayni kovadan yer: kova bos.
        expect(b.take(1).ok).toBe(false)
    })

    it('cost kapasiteyi asarsa kapasiteye kirpilir: dolu kovada gecer ve kovayi bosaltir', () => {
        const clock = fakeClock()
        const b = createTokenBucket({ rate: 1, burst: 3, now: clock.now })

        expect(b.take(5)).toEqual({ ok: true })
        expect(b.take(1).ok).toBe(false)

        // Dolu degilken ASLA gecmez.
        clock.advance(2000)
        expect(b.take(5).ok).toBe(false)
    })

    it('gecersiz cost ucretsiz sayilmaz: 1 jeton oder', () => {
        const clock = fakeClock()
        const b = createTokenBucket({ rate: 1, burst: 3, now: clock.now })

        for (const bad of [0, -4, NaN, Infinity, 'x', null, {}]) {
            const before = b.available()
            expect(b.take(bad).ok).toBe(true)
            expect(b.available()).toBeCloseTo(before - 1, 6)
            b.refund(1)
        }
    })

    it('saat geriye giderse kova dondurulmaz ve bedava jeton da uretilmez', () => {
        const clock = fakeClock(5_000_000)
        const b = createTokenBucket({ rate: 1, burst: 1, now: clock.now })
        expect(b.take().ok).toBe(true)

        clock.set(5_000_000 - 10_000) // sistem saati 10 sn geri alindi
        expect(b.take().ok).toBe(false) // geri gitmek jeton vermez

        clock.advance(1000) // yeni saat uzerinden 1 sn
        expect(b.take().ok).toBe(true) // dondurulmadi
    })

    it('gecersiz saat okumasi (NaN) yok sayilir', () => {
        let t = 1000
        let bad = false
        const b = createTokenBucket({ rate: 1, burst: 1, now: () => (bad ? NaN : t) })
        expect(b.take().ok).toBe(true)

        bad = true
        expect(b.take().ok).toBe(false)

        bad = false
        t += 1000
        expect(b.take().ok).toBe(true)
    })

    it('refund jetonu geri verir ve burst ustune cikmaz', () => {
        const clock = fakeClock()
        const b = createTokenBucket({ rate: 1, burst: 2, now: clock.now })

        expect(b.take(2).ok).toBe(true)
        expect(b.take().ok).toBe(false)
        b.refund(1)
        expect(b.take().ok).toBe(true)

        b.refund(100)
        expect(b.available()).toBe(2)
    })

    it('kovalar birbirinden bagimsizdir', () => {
        const clock = fakeClock()
        const a = createTokenBucket({ rate: 1, burst: 1, now: clock.now })
        const c = createTokenBucket({ rate: 1, burst: 1, now: clock.now })

        expect(a.take().ok).toBe(true)
        expect(a.take().ok).toBe(false)
        expect(c.take().ok).toBe(true)
    })

    it('now verilmezse Date.now kullanir', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-10-05T00:00:00Z'))
        const b = createTokenBucket({ rate: 1, burst: 1 })

        expect(b.take().ok).toBe(true)
        expect(b.take().ok).toBe(false)
        vi.advanceTimersByTime(1000)
        expect(b.take().ok).toBe(true)
    })

    it('gecersiz kurulum parametrelerinde firlatir (programci hatasi, sessiz kabul yok)', () => {
        expect(() => createTokenBucket({ rate: 0, burst: 1 })).toThrow(RangeError)
        expect(() => createTokenBucket({ rate: -1, burst: 1 })).toThrow(RangeError)
        expect(() => createTokenBucket({ rate: NaN, burst: 1 })).toThrow(RangeError)
        expect(() => createTokenBucket({ rate: 1, burst: 0 })).toThrow(RangeError)
        expect(() => createTokenBucket({ rate: 1, burst: Infinity })).toThrow(RangeError)
        expect(() => createTokenBucket({ rate: 1, burst: 1, now: 5 })).toThrow(TypeError)
        expect(() => createTokenBucket()).toThrow(RangeError)
    })
})

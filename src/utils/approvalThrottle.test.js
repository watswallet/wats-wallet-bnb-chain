import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    createApprovalThrottle,
    checkApprovalThrottle,
    noteApprovalRejected,
    resetApprovalThrottle,
    APPROVAL_THROTTLE_LIMITS,
} from './approvalThrottle'

function fakeClock(start = 1_000_000) {
    let t = start
    return { now: () => t, advance: (ms) => { t += ms }, set: (v) => { t = v } }
}

const A = 'https://a.example'
const B = 'https://b.example'

describe('createApprovalThrottle: kayan pencere (10 sn / 3)', () => {
    it('ilk 3 pencere gecer, 4.su reddedilir ve ne zaman olacagi soylenir', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({ now: clock.now })

        expect(th.check(A)).toEqual({ ok: true })
        clock.advance(1000)
        expect(th.check(A)).toEqual({ ok: true })
        clock.advance(1000)
        expect(th.check(A)).toEqual({ ok: true })
        clock.advance(1000)

        // Ilk kayit t=0'da: 10000 - 3000 = 7000 ms sonra bir hak acilir.
        expect(th.check(A)).toEqual({ ok: false, retryAfterMs: 7000 })
    })

    it('pencere KAYAR: ilk kayit suresi dolunca TEK hak acilir, hepsi degil', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({ now: clock.now })
        th.check(A) // t=0
        clock.advance(4000)
        th.check(A) // t=4000
        th.check(A) // t=4000

        clock.advance(6000) // t=10000: ilk kayit (t=0) dustu
        expect(th.check(A)).toEqual({ ok: true })
        expect(th.check(A).ok).toBe(false) // t=4000'dakiler hala pencerede
    })

    it('reddedilen cagri kaydedilmez: istek yagdirmak engeli UZATMAZ', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({ now: clock.now })
        for (let i = 0; i < 3; i++) th.check(A)

        for (let i = 0; i < 50; i++) {
            clock.advance(100)
            expect(th.check(A).ok).toBe(false)
        }
        // t = 5000. Ilk uc kayit t=0'daydi: t=10000'de pencere tamamen bosalir.
        clock.advance(5000)
        expect(th.check(A)).toEqual({ ok: true })
    })

    it('origin\'ler birbirinden bagimsizdir', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({ now: clock.now })
        for (let i = 0; i < 3; i++) th.check(A)
        expect(th.check(A).ok).toBe(false)
        expect(th.check(B)).toEqual({ ok: true })
    })

    it('Unknown origin TEK paylasilan kayittir; gecersiz origin degerleri Unknown olur', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({ now: clock.now })

        expect(th.check('Unknown').ok).toBe(true)
        expect(th.check(undefined).ok).toBe(true)
        expect(th.check('').ok).toBe(true)
        expect(th.check(null).ok).toBe(false) // 4. cagri: hepsi ayni kayit
        expect(th.check({ evil: true }).ok).toBe(false)
        expect(th.check(42).ok).toBe(false)
    })

    it('cok uzun origin 256 karakterde kesilir (bellek sisirilemez) ve yine sayilir', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({ now: clock.now })
        const long = 'https://' + 'a'.repeat(5000) + '.example'
        for (let i = 0; i < 3; i++) expect(th.check(long).ok).toBe(true)
        expect(th.check(long).ok).toBe(false)
    })
})

describe('createApprovalThrottle: ret sonrasi geri cekilme', () => {
    it('ilk ret origin\'i 2 sn engeller; engel sureyi tam soyler', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({ now: clock.now })
        expect(th.check(A).ok).toBe(true)

        th.noteRejected(A)
        expect(th.check(A)).toEqual({ ok: false, retryAfterMs: 2000 })

        clock.advance(1999)
        expect(th.check(A)).toEqual({ ok: false, retryAfterMs: 1 })

        clock.advance(1)
        expect(th.check(A)).toEqual({ ok: true })
    })

    it('art arda retler engeli ikiye katlar ve 60 sn\'de durur', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({ now: clock.now })
        const expected = [2000, 4000, 8000, 16000, 32000, 60000, 60000]

        for (const ms of expected) {
            th.noteRejected(A)
            expect(th.check(A)).toEqual({ ok: false, retryAfterMs: ms })
            clock.advance(ms) // engel bitti; bir sonraki ret 120 sn icinde
        }
    })

    it('120 sn sessizlikten sonra seri sifirlanir: yine 2 sn', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({ now: clock.now })
        th.noteRejected(A)
        th.noteRejected(A) // 4 sn
        clock.advance(120_000)

        th.noteRejected(A)
        expect(th.check(A)).toEqual({ ok: false, retryAfterMs: 2000 })
    })

    it('hic pencere acmamis origin\'e de ret islenir; baska origin etkilenmez', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({ now: clock.now })
        th.noteRejected(A)
        expect(th.check(A).ok).toBe(false)
        expect(th.check(B).ok).toBe(true)
    })

    it('engel bitince pencere kurali yine gecerlidir', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({ now: clock.now })
        th.check(A)
        th.check(A)
        th.check(A) // pencere dolu
        th.noteRejected(A) // 2 sn engel

        clock.advance(2000) // engel bitti ama 3 kayit hala pencerede (t=0)
        expect(th.check(A)).toEqual({ ok: false, retryAfterMs: 8000 })
    })
})

describe('createApprovalThrottle: saat ve bellek', () => {
    it('saat geri giderse kalici engel olusmaz', () => {
        const clock = fakeClock(9_000_000)
        const th = createApprovalThrottle({ now: clock.now })
        for (let i = 0; i < 3; i++) th.check(A)
        th.noteRejected(A)

        clock.set(9_000_000 - 3_600_000) // saat 1 saat geri alindi
        const r = th.check(A)
        expect(r.ok).toBe(false)
        expect(r.retryAfterMs).toBeLessThanOrEqual(APPROVAL_THROTTLE_LIMITS.backoffMaxMs)

        clock.advance(APPROVAL_THROTTLE_LIMITS.backoffMaxMs)
        expect(th.check(A).ok).toBe(true)
    })

    it('gecersiz saat okumasi (NaN) yok sayilir: kisitlayici kalici donmaz', () => {
        let t = 1_000_000
        let bad = true
        const th = createApprovalThrottle({ now: () => (bad ? NaN : t) })

        // Hic gecerli okuma yokken NaN: damga 0 olur. NaN damgasi olsaydi pencerenin basinda
        // budanamadan kalir ve origin sonsuza dek engelli olurdu.
        expect(th.check(A)).toEqual({ ok: true })
        bad = false
        expect(th.check(A)).toEqual({ ok: true })
        expect(th.check(A)).toEqual({ ok: true })
        expect(th.check(A)).toEqual({ ok: true })
        expect(th.check(A)).toEqual({ ok: false, retryAfterMs: 10_000 })

        // Ret anindaki NaN okuma son gecerli okumayla degisir: engel yine tam 2 sn.
        t += 10_000
        expect(th.check(B)).toEqual({ ok: true }) // son gecerli okuma = t
        bad = true
        th.noteRejected(A)
        bad = false
        expect(th.check(A)).toEqual({ ok: false, retryAfterMs: 2000 })
        t += 2000
        expect(th.check(A)).toEqual({ ok: true })
    })

    it('izlenen origin sayisi sinirlidir: dolunca en eski kayit atilir', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({ now: clock.now, limits: { maxTrackedOrigins: 2 } })
        for (let i = 0; i < 3; i++) th.check(A)
        expect(th.check(A).ok).toBe(false)

        th.check(B)
        th.check('https://c.example') // 3. origin: A (en eski) atilir

        expect(th.check(A).ok).toBe(true) // sayaci sifirlandi (sinirin bilinen bedeli)
    })

    it('dolunca once BOSTA kalan kayit atilir; hala engelli origin korunur', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({
            now: clock.now,
            limits: { maxTrackedOrigins: 2, backoffBaseMs: 30_000 },
        })
        th.noteRejected(A) // t=0: A 30 sn engelli, EN ESKI kayit
        clock.advance(1)
        th.check(B) // B bosta kalacak

        clock.advance(20_000)
        th.check('https://c.example') // 3. origin: B bosta -> B atilir, A KORUNUR

        expect(th.check(A)).toEqual({ ok: false, retryAfterMs: 9999 })
    })

    it('reset her seyi temizler', () => {
        const clock = fakeClock()
        const th = createApprovalThrottle({ now: clock.now })
        th.noteRejected(A)
        th.reset()
        expect(th.check(A).ok).toBe(true)
    })
})

describe('paylasilan ornek (checkApprovalThrottle / noteApprovalRejected)', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))
        resetApprovalThrottle()
    })
    afterEach(() => {
        resetApprovalThrottle()
        vi.useRealTimers()
    })

    it('Date.now ile calisir: 3 hak, 4.su ret, 10 sn sonra yeniden hak', () => {
        expect(checkApprovalThrottle(A)).toEqual({ ok: true })
        expect(checkApprovalThrottle(A)).toEqual({ ok: true })
        expect(checkApprovalThrottle(A)).toEqual({ ok: true })
        expect(checkApprovalThrottle(A)).toEqual({ ok: false, retryAfterMs: 10_000 })

        vi.advanceTimersByTime(10_000)
        expect(checkApprovalThrottle(A)).toEqual({ ok: true })
    })

    it('noteApprovalRejected paylasilan sayaca islenir', () => {
        noteApprovalRejected(A)
        expect(checkApprovalThrottle(A)).toEqual({ ok: false, retryAfterMs: 2000 })
        resetApprovalThrottle()
        expect(checkApprovalThrottle(A)).toEqual({ ok: true })
    })

    it('sabitler spec ile birebir: 10 sn / 3, geri cekilme 2 sn -> 60 sn', () => {
        expect(APPROVAL_THROTTLE_LIMITS.windowMs).toBe(10_000)
        expect(APPROVAL_THROTTLE_LIMITS.maxInWindow).toBe(3)
        expect(APPROVAL_THROTTLE_LIMITS.backoffBaseMs).toBe(2000)
        expect(APPROVAL_THROTTLE_LIMITS.backoffMaxMs).toBe(60_000)
        expect(Object.isFrozen(APPROVAL_THROTTLE_LIMITS)).toBe(true)
    })
})

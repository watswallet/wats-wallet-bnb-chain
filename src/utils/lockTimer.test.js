import { describe, it, expect } from 'vitest'
import {
    shouldLock,
    normalizeLockTimer,
    DEFAULT_LOCK_TIMER_MINUTES,
    LOCK_NEVER,
    LOCK_IMMEDIATE
} from './lockTimer'

const NOW = 1_800_000_000_000
const minutesAgo = (m) => NOW - m * 60 * 1000

describe('normalizeLockTimer', () => {
    it('ayar yoksa varsayilan 15 dakika', () => {
        expect(normalizeLockTimer(undefined)).toBe(DEFAULT_LOCK_TIMER_MINUTES)
        expect(normalizeLockTimer(null)).toBe(DEFAULT_LOCK_TIMER_MINUTES)
        expect(normalizeLockTimer('abc')).toBe(DEFAULT_LOCK_TIMER_MINUTES)
    })

    it('negatif degerler "asla" demektir', () => {
        expect(normalizeLockTimer(-1)).toBe(LOCK_NEVER)
    })

    it('gecerli dakika degerleri oldugu gibi kalir', () => {
        expect(normalizeLockTimer(0)).toBe(LOCK_IMMEDIATE)
        expect(normalizeLockTimer(30)).toBe(30)
    })
})

describe('shouldLock', () => {
    it('#19: "Asla" secildiyse ne kadar beklenirse beklensin kilitlenmez', () => {
        // Onceden sabit 15 dakika kullaniliyordu: "Asla" secen kullanici yine kilitleniyordu.
        expect(shouldLock(-1, minutesAgo(600), NOW)).toBe(false)
    })

    it('#19: "1 dakika" secildiyse 2 dakika sonra kilitlenir', () => {
        // Onceden 15 dakika beklemek gerekiyordu.
        expect(shouldLock(1, minutesAgo(2), NOW)).toBe(true)
    })

    it('"1 dakika" secildiyse 30 saniye sonra kilitlenmez', () => {
        expect(shouldLock(1, NOW - 30_000, NOW)).toBe(false)
    })

    it('"1 saat" secildiyse 30 dakika sonra kilitlenmez', () => {
        // Onceden 15 dakikada kilitleniyordu.
        expect(shouldLock(60, minutesAgo(30), NOW)).toBe(false)
    })

    it('"1 saat" secildiyse 61 dakika sonra kilitlenir', () => {
        expect(shouldLock(60, minutesAgo(61), NOW)).toBe(true)
    })

    it('ayar yoksa 15 dakika varsayilani uygulanir', () => {
        expect(shouldLock(undefined, minutesAgo(14), NOW)).toBe(false)
        expect(shouldLock(undefined, minutesAgo(16), NOW)).toBe(true)
    })

    // "Hemen" ARTIK bir zaman asimi DEGIL: anlami "acik arayuz kalmadi".
    // Alarm dali bu degeri gormezden gelir; kilidi utils/uiRegistry.js verir.
    // Eski davranis (her alarm tikinda true) panelde kullaniciyi ekranin
    // onunde otururken kilitliyordu -- panel kapanmadigi icin "arayuz kapandi"
    // sinyali hic gelmiyor, geriye yalnizca bu tik kaliyordu.
    it('"Hemen" alarm dalinda ASLA kilitlemez (karar kayit defterinde)', () => {
        expect(shouldLock(0, minutesAgo(1), NOW)).toBe(false)
        expect(shouldLock(0, minutesAgo(600), NOW)).toBe(false)
        expect(shouldLock('0', minutesAgo(600), NOW)).toBe(false)
    })

    it('"Hemen" damga hic yokken de alarm dalinda kilitlemez', () => {
        // `!lastActiveTime -> true` guvenli-taraf kurali LOCK_IMMEDIATE'i
        // KAPSAMAZ: burada kilidi verecek olan alarm degil, kayit defteri.
        expect(shouldLock(0, null, NOW)).toBe(false)
        expect(shouldLock(0, undefined, NOW)).toBe(false)
    })

    it('ayari olmayan kullanici HALA 15 dakika varsayilanindadir (0 sanilmaz)', () => {
        // normalizeLockTimer'daki null/undefined/'' elemesi LOCK_IMMEDIATE
        // dalinin USTUNE yazilmamali: aksi halde ayari olmayan kullanici
        // "Hemen" secmis sayilir ve HIC kilitlenmez.
        expect(shouldLock(null, minutesAgo(20), NOW)).toBe(true)
        expect(shouldLock(undefined, minutesAgo(20), NOW)).toBe(true)
        expect(shouldLock('', minutesAgo(20), NOW)).toBe(true)
        expect(shouldLock(null, minutesAgo(5), NOW)).toBe(false)
    })

    it('etkinlik damgasi yoksa kilitlenir', () => {
        expect(shouldLock(15, undefined, NOW)).toBe(true)
        expect(shouldLock(15, 0, NOW)).toBe(true)
    })
})

import { describe, it, expect } from 'vitest'
import { dayKey, groupByDay, needsYear } from './historyGrouping'

// Sabit bir "simdi": 16 Eylul 2026, 14:00 YEREL saat. Testler yerel saate gore
// yazilir cunku kullanicinin gordugu "Bugun" de yerel saattir (UTC DEGIL).
const NOW = new Date(2026, 8, 16, 14, 0, 0)
const yerel = (y, ay, gun, saat = 12, dk = 0) => new Date(y, ay, gun, saat, dk, 0)

describe('dayKey — bir tarihi gun kovasina cevirir', () => {
    it('ayni takvim gunu "today" doner', () => {
        expect(dayKey(yerel(2026, 8, 16, 9), NOW)).toBe('today')
    })

    it('gunun SON dakikasi da "today" doner (UTC kaymasina dusmez)', () => {
        expect(dayKey(yerel(2026, 8, 16, 23, 59), NOW)).toBe('today')
    })

    it('bir onceki takvim gunu "yesterday" doner', () => {
        expect(dayKey(yerel(2026, 8, 15, 23, 59), NOW)).toBe('yesterday')
    })

    it('daha eski gunler YYYY-MM-DD anahtari doner', () => {
        expect(dayKey(yerel(2026, 8, 14), NOW)).toBe('2026-09-14')
    })

    it('yil siniri: 31 Aralik ile 1 Ocak AYNI kovaya DUSMEZ', () => {
        const yilbasi = new Date(2026, 0, 1, 10, 0, 0)
        expect(dayKey(yerel(2025, 11, 31, 23, 0), yilbasi)).toBe('yesterday')
        expect(dayKey(yerel(2025, 11, 30, 23, 0), yilbasi)).toBe('2025-12-30')
    })

    it('ISO dizgi (EVM/TON satiri) kabul eder', () => {
        expect(dayKey(yerel(2026, 8, 16, 9).toISOString(), NOW)).toBe('today')
    })

    it('ms sayisi (Solana satiri) kabul eder', () => {
        expect(dayKey(yerel(2026, 8, 15, 9).getTime(), NOW)).toBe('yesterday')
    })

    it('gecersiz/eksik tarihte FIRLATMAZ, null doner', () => {
        expect(dayKey(null, NOW)).toBeNull()
        expect(dayKey(undefined, NOW)).toBeNull()
        expect(dayKey('bu bir tarih degil', NOW)).toBeNull()
        expect(dayKey(NaN, NOW)).toBeNull()
    })

    it('gelecekteki bir tarih "today" degilse kendi gun anahtarini alir', () => {
        expect(dayKey(yerel(2026, 8, 17), NOW)).toBe('2026-09-17')
    })
})

describe('needsYear — gun basliginda yil gosterilmeli mi', () => {
    it('ayni yilda yil GEREKMEZ', () => {
        expect(needsYear(yerel(2026, 0, 3), NOW)).toBe(false)
    })

    it('farkli yilda yil GEREKIR', () => {
        expect(needsYear(yerel(2023, 4, 3), NOW)).toBe(true)
    })

    it('gecersiz tarihte false doner (baslik bozulmasin)', () => {
        expect(needsYear(null, NOW)).toBe(false)
    })
})

describe('groupByDay — listeyi gun bloklarina ayirir', () => {
    const dateOf = (r) => r.t

    it('ayni gunun satirlari TEK grupta toplanir', () => {
        const rows = [
            { id: 1, t: yerel(2026, 8, 16, 14) },
            { id: 2, t: yerel(2026, 8, 16, 9) },
        ]
        const gruplar = groupByDay(rows, dateOf, NOW)
        expect(gruplar).toHaveLength(1)
        expect(gruplar[0].key).toBe('today')
        expect(gruplar[0].rows.map((r) => r.id)).toEqual([1, 2])
    })

    it('farkli gunler AYRI gruplara ayrilir ve sira KORUNUR', () => {
        const rows = [
            { id: 1, t: yerel(2026, 8, 16, 14) },
            { id: 2, t: yerel(2026, 8, 15, 22) },
            { id: 3, t: yerel(2026, 8, 14, 16) },
        ]
        const gruplar = groupByDay(rows, dateOf, NOW)
        expect(gruplar.map((g) => g.key)).toEqual(['today', 'yesterday', '2026-09-14'])
        expect(gruplar.map((g) => g.rows.map((r) => r.id))).toEqual([[1], [2], [3]])
    })

    // KRITIK: gruplama bir SIRALAMA DEGILDIR. Liste ust katmanda zaten siralanmis
    // geliyor (ve bekleyen kayitlar bilerek one alinabiliyor); burada yeniden
    // siralamak o karari sessizce EZERDI. Bu yuzden ayni gun ARADA KESILIRSE
    // iki AYRI grup olusur, tek gruba BIRLESTIRILMEZ.
    it('sirali gelmeyen listede satirlari YENIDEN SIRALAMAZ, ardisik bloklara boler', () => {
        const rows = [
            { id: 1, t: yerel(2026, 8, 16, 10) },
            { id: 2, t: yerel(2026, 8, 14, 10) },
            { id: 3, t: yerel(2026, 8, 16, 8) },
        ]
        const gruplar = groupByDay(rows, dateOf, NOW)
        expect(gruplar.map((g) => g.key)).toEqual(['today', '2026-09-14', 'today'])
        expect(gruplar.flatMap((g) => g.rows.map((r) => r.id))).toEqual([1, 2, 3])
    })

    it('tarihi cozulemeyen satir DUSMEZ, kendi grubunda kalir (key null)', () => {
        const rows = [
            { id: 1, t: yerel(2026, 8, 16, 10) },
            { id: 2, t: null },
        ]
        const gruplar = groupByDay(rows, dateOf, NOW)
        expect(gruplar).toHaveLength(2)
        expect(gruplar[1].key).toBeNull()
        expect(gruplar[1].rows.map((r) => r.id)).toEqual([2])
    })

    it('bos liste bos dizi doner', () => {
        expect(groupByDay([], dateOf, NOW)).toEqual([])
    })

    it('dizi olmayan girdide FIRLATMAZ', () => {
        expect(groupByDay(null, dateOf, NOW)).toEqual([])
        expect(groupByDay(undefined, dateOf, NOW)).toEqual([])
    })

    it('her grup, basligi bicimlendirmek icin gercek bir Date tasir', () => {
        const rows = [{ id: 1, t: yerel(2026, 8, 14, 16) }]
        const [grup] = groupByDay(rows, dateOf, NOW)
        expect(grup.date).toBeInstanceOf(Date)
        expect(grup.date.getFullYear()).toBe(2026)
        expect(grup.date.getMonth()).toBe(8)
        expect(grup.date.getDate()).toBe(14)
    })
})

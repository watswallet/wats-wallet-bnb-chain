// KAYMAK G8: sayac rakamli toplam bakiye (spec 7.7, K6, D9, H9).
// Saf plan (roll / rebuild / plain), hucreler, gecikmeler ve donus denetleyicisi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { moneyParts } from '../money'
import { SUPPORTED_LANGS } from '../../i18n/languages'
import {
    digitSignature,
    hasNonAsciiDigit,
    isRtlLocale,
    odometerPlan,
    odometerCells,
    rollDelays,
    createOdometer,
    ROLL_MS,
    ROLL_STEP_MS,
    ROLL_DELAY_MAX_MS,
} from './odometerPlan'

const BIRIMLER = ['usd', 'try', 'eur', 'idr', 'vnd', 'krw', 'jpy']
const S = 'text-[42px]'
const rakamSayisi = (t) => (t.match(/[0-9]/g) || []).length
const geriYaz = (hucreler) => hucreler.map((h) => ('digit' in h ? String(h.digit) : h.char)).join('')
const birim = (code) => ({ code, rate: 1, fellBack: false })

describe('odometerPlan yardimcilari', () => {
    it('digitSignature: yalniz ASCII rakamlar # olur', () => {
        expect(digitSignature('1,234.56')).toBe('#,###.##')
        expect(digitSignature('-12.00')).toBe('-##.##')
        expect(digitSignature('1 234,00')).toBe('# ###,##')
        expect(digitSignature('١٢٣')).toBe('١٢٣')
    })

    it('hasNonAsciiDigit: \\p{Nd} olup [0-9] olmayan rakam', () => {
        expect(hasNonAsciiDigit('1,234.56')).toBe(false)
        expect(hasNonAsciiDigit('١٢٣')).toBe(true)
        expect(hasNonAsciiDigit('१२३')).toBe(true)
        expect(hasNonAsciiDigit('12۳')).toBe(true)
        expect(hasNonAsciiDigit('')).toBe(false)
    })

    it('isRtlLocale: ar, fa, he, ur, ps, yi, dv, ku, sd, ug onekleri', () => {
        for (const l of ['ar', 'ar-EG', 'fa', 'he', 'ur', 'ps', 'yi', 'dv', 'ku', 'sd', 'ug', 'AR_sa']) {
            expect(isRtlLocale(l), l).toBe(true)
        }
        for (const l of SUPPORTED_LANGS) expect(isRtlLocale(l), l).toBe(false)
        for (const l of ['', undefined, null, 'arn', 'kum']) expect(isRtlLocale(l), String(l)).toBe(false)
    })
})

describe('odometerPlan: 12 dil x 7 para birimi (moneyParts ciktisi)', () => {
    const ciftler = SUPPORTED_LANGS.flatMap((locale) => BIRIMLER.map((code) => [locale, code]))

    it('12 dil x 7 birim = 84 cift', () => {
        expect(SUPPORTED_LANGS.length).toBe(12)
        expect(ciftler.length).toBe(84)
    })

    it.each(ciftler)('%s %s: 1234 -> 1243 metinleri farkli ve plan roll; hucrelerde rakam sayisi = ASCII rakam sayisi', (locale, code) => {
        const a = moneyParts(1234, birim(code), { locale }).number
        const b = moneyParts(1243, birim(code), { locale }).number
        // Tam sayi hanesi degisen cift: JPY, KRW, VND sifir ondalikli; 1234.56 -> 1234.57 bos gecerdi.
        expect(a).not.toBe(b)
        expect(odometerPlan({ text: a, size: S }, { text: b, size: S }, { locale })).toBe('roll')
        for (const t of [a, b]) {
            const h = odometerCells(t)
            expect(h.filter((x) => 'digit' in x).length).toBe(rakamSayisi(t))
            expect(geriYaz(h)).toBe(t)
        }
    })

    it('ru metnindeki U+00A0 ve fr metnindeki U+202F sabit hucre olarak aynen korunur', () => {
        const ru = moneyParts(1234, birim('usd'), { locale: 'ru' }).number
        const fr = moneyParts(1234, birim('usd'), { locale: 'fr' }).number
        expect(ru).toContain(' ')
        expect(fr).toContain(' ')
        expect(odometerCells(ru)).toContainEqual({ char: ' ' })
        expect(odometerCells(fr)).toContainEqual({ char: ' ' })
        expect(geriYaz(odometerCells(ru))).toBe(ru)
        expect(geriYaz(odometerCells(fr))).toBe(fr)
    })
})

describe('odometerPlan: rebuild ve plain', () => {
    it('es gruplama degisimi (9999,99 -> 10.000,00) rebuild', () => {
        const a = moneyParts(9999.99, birim('eur'), { locale: 'es' }).number
        const b = moneyParts(10000, birim('eur'), { locale: 'es' }).number
        expect(a).toBe('9999,99')
        expect(b).toBe('10.000,00')
        expect(odometerPlan({ text: a, size: S }, { text: b, size: S }, { locale: 'es' })).toBe('rebuild')
    })

    it('uzunluk degisimi (99,99 -> 100,00) rebuild', () => {
        expect(odometerPlan({ text: '99,99', size: S }, { text: '100,00', size: S }, { locale: 'es' })).toBe('rebuild')
    })

    it("eksi isareti ('-12.00' -> '12.00') rebuild", () => {
        expect(odometerPlan({ text: '-12.00', size: S }, { text: '12.00', size: S })).toBe('rebuild')
    })

    it('ASCII disi rakam plain (once ya da sonra)', () => {
        expect(odometerPlan({ text: '123', size: S }, { text: '١٢٣', size: S })).toBe('plain')
        expect(odometerPlan({ text: '١٢٣', size: S }, { text: '124', size: S })).toBe('plain')
    })

    it('ayni metin, boyut sinifi text-[42px] -> text-[32px] rebuild', () => {
        expect(odometerPlan({ text: '1,234.56', size: 'text-[42px]' }, { text: '1,234.56', size: 'text-[32px]' })).toBe('rebuild')
    })

    it("locale 'ar' plain", () => {
        expect(odometerPlan({ text: '1,234.56', size: S }, { text: '1,234.57', size: S }, { locale: 'ar' })).toBe('plain')
    })

    it('ayni imza ve boyut roll', () => {
        expect(odometerPlan({ text: '1,234.56', size: S }, { text: '9,999.99', size: S }, { locale: 'en' })).toBe('roll')
    })
})

describe('rollDelays', () => {
    it('12 rakamda en buyuk deger 200, en sag 0, adim 22', () => {
        const hucreler = odometerCells('123,456,789,012')
        const g = rollDelays(hucreler)
        expect(g.length).toBe(12)
        expect(Math.max(...g)).toBe(200)
        expect(g[g.length - 1]).toBe(0)
        expect(g[g.length - 2]).toBe(22)
        for (let i = 0; i < g.length - 1; i++) {
            const fark = g[i] - g[i + 1]
            expect(fark === 22 || (g[i] === 200 && fark <= 22)).toBe(true)
        }
    })

    it('sabitler: 600 + en buyuk gecikme <= 800 (spec 7.7, Ek insaatci notu 3)', () => {
        expect(ROLL_MS).toBe(600)
        expect(ROLL_STEP_MS).toBe(22)
        expect(ROLL_DELAY_MAX_MS).toBe(200)
        expect(ROLL_MS + ROLL_DELAY_MAX_MS).toBeLessThanOrEqual(800)
    })

    it('rakamsiz metin bos dizi; sabit hucreler gecikme almaz', () => {
        expect(rollDelays(odometerCells('—'))).toEqual([])
        expect(rollDelays(odometerCells('1.2'))).toEqual([22, 0])
    })
})

describe('createOdometer (donus denetleyicisi)', () => {
    let durumlar
    let sonraki
    let izin
    let hazir

    const kur = (ilk = { text: '1,234.56', size: S, identity: 'k1', locale: 'en' }) => {
        durumlar = []
        sonraki = []
        return createOdometer({
            initial: ilk,
            onState: (s) => durumlar.push(s),
            motionAllowed: () => izin,
            canRoll: () => hazir,
            afterRender: (fn) => sonraki.push(fn),
        })
    }
    const rakamlar = (s) => s.cells.filter((h) => 'digit' in h).map((h) => h.digit).join('')
    const son = () => durumlar[durumlar.length - 1]

    beforeEach(() => {
        vi.useFakeTimers()
        izin = true
        hazir = true
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('kurulumda ve ayni degerde hicbir sey yazilmaz (ilk cizim duz, K6)', () => {
        const o = kur()
        o.update({ text: '1,234.56', size: S, identity: 'k1', locale: 'en' })
        vi.advanceTimersByTime(2000)
        expect(durumlar).toEqual([])
        expect(sonraki).toEqual([])
    })

    it('roll: 120 ms sonra onceki rakamlarda baslangic, cizimden sonra yeni rakamlar, 600 + en buyuk gecikmede duz metin', () => {
        const o = kur()
        o.update({ text: '1,234.57', size: S, identity: 'k1', locale: 'en' })
        vi.advanceTimersByTime(119)
        expect(durumlar).toEqual([])
        vi.advanceTimersByTime(1)
        expect(durumlar.length).toBe(1)
        expect(son().start).toBe(true)
        expect(son().text).toBe('1,234.57')
        expect(rakamlar(son())).toBe('123456')
        expect(son().cells).toContainEqual({ char: ',' })
        expect(sonraki.length).toBe(1)

        sonraki.shift()()
        expect(durumlar.length).toBe(2)
        expect(son().start).toBe(false)
        expect(rakamlar(son())).toBe('123457')
        // gecikme: en sag 0, sola dogru +22
        const g = son().cells.filter((h) => 'digit' in h).map((h) => h.delay)
        expect(g).toEqual([110, 88, 66, 44, 22, 0])

        vi.advanceTimersByTime(ROLL_MS + 110 - 1)
        expect(durumlar.length).toBe(2)
        vi.advanceTimersByTime(1)
        expect(son()).toEqual({ text: '1,234.57', cells: null, start: false })
    })

    it('120 ms birlestirme: 0. ms ve 60. ms iki hedef -> tek donus, hedef son deger', () => {
        const o = kur()
        o.update({ text: '1,234.60', size: S, identity: 'k1', locale: 'en' })
        vi.advanceTimersByTime(60)
        o.update({ text: '1,234.70', size: S, identity: 'k1', locale: 'en' })
        vi.advanceTimersByTime(59)
        expect(durumlar).toEqual([])
        vi.advanceTimersByTime(1)
        expect(durumlar.length).toBe(1)
        expect(son().text).toBe('1,234.70')
        sonraki.shift()()
        expect(rakamlar(son())).toBe('123470')
    })

    it('kimlik degisimi aninda duz metin; bekleyen hedef duser', () => {
        const o = kur()
        o.update({ text: '1,234.60', size: S, identity: 'k1', locale: 'en' })
        vi.advanceTimersByTime(50)
        o.update({ text: '9,999.99', size: S, identity: 'k2', locale: 'en' })
        expect(durumlar).toEqual([{ text: '9,999.99', cells: null, start: false }])
        vi.advanceTimersByTime(2000)
        expect(durumlar.length).toBe(1)
        expect(sonraki).toEqual([])
    })

    it('donus surerken kimlik degisti: aninda duz, bitis zamanlayicisi ve bekleyen cizim gecersiz (Review Focus 2)', () => {
        const o = kur()
        o.update({ text: '1,234.57', size: S, identity: 'k1', locale: 'en' })
        vi.advanceTimersByTime(120)
        const bekleyen = sonraki.shift()
        o.update({ text: '—', size: S, identity: 'k2', locale: 'en' })
        expect(son()).toEqual({ text: '—', cells: null, start: false })
        const n = durumlar.length
        bekleyen()
        vi.advanceTimersByTime(2000)
        expect(durumlar.length).toBe(n)
    })

    it('dil degisimi kimlik gibi aninda', () => {
        const o = kur()
        o.update({ text: '1.234,56', size: S, identity: 'k1', locale: 'tr' })
        expect(durumlar).toEqual([{ text: '1.234,56', cells: null, start: false }])
    })

    it('hareket izni yoksa ya da kok hazir degilse aninda duz', () => {
        let o = kur()
        izin = false
        o.update({ text: '1,234.57', size: S, identity: 'k1', locale: 'en' })
        expect(durumlar).toEqual([{ text: '1,234.57', cells: null, start: false }])

        o = kur()
        izin = true
        hazir = false
        o.update({ text: '1,234.57', size: S, identity: 'k1', locale: 'en' })
        expect(durumlar).toEqual([{ text: '1,234.57', cells: null, start: false }])
    })

    it('pencere sonunda izin kalkmissa aninda duz (sutun kurulmaz)', () => {
        const o = kur()
        o.update({ text: '1,234.57', size: S, identity: 'k1', locale: 'en' })
        izin = false
        vi.advanceTimersByTime(120)
        expect(durumlar).toEqual([{ text: '1,234.57', cells: null, start: false }])
        expect(sonraki).toEqual([])
    })

    it('yapi degisimi (imza ya da boyut) animasyonsuz, aninda', () => {
        const o = kur()
        o.update({ text: '12,234.56', size: 'text-[32px]', identity: 'k1', locale: 'en' })
        expect(durumlar).toEqual([{ text: '12,234.56', cells: null, start: false }])
        o.update({ text: '12,234.56', size: S, identity: 'k1', locale: 'en' })
        expect(son()).toEqual({ text: '12,234.56', cells: null, start: false })
        expect(sonraki).toEqual([])
    })

    it('donus surerken ayni imzali yeni hedef: rakamlar yeniden hedeflenir (baslangic yok), bitis yeniden kurulur', () => {
        const o = kur()
        o.update({ text: '1,234.57', size: S, identity: 'k1', locale: 'en' })
        vi.advanceTimersByTime(120)
        sonraki.shift()()
        vi.advanceTimersByTime(300)
        o.update({ text: '1,234.99', size: S, identity: 'k1', locale: 'en' })
        vi.advanceTimersByTime(120)
        expect(sonraki).toEqual([])
        expect(son().start).toBe(false)
        expect(son().text).toBe('1,234.99')
        expect(rakamlar(son())).toBe('123499')
        const n = durumlar.length
        // ilk bitis (120 + 710) artik gecersiz; yeni bitis yeniden hedeflemeden 710 ms sonra
        vi.advanceTimersByTime(ROLL_MS + 110 - 1)
        expect(durumlar.length).toBe(n)
        vi.advanceTimersByTime(1)
        expect(son()).toEqual({ text: '1,234.99', cells: null, start: false })
    })

    it('donus surerken imzasi farkli yeni hedef: aninda duz', () => {
        const o = kur()
        o.update({ text: '1,234.57', size: S, identity: 'k1', locale: 'en' })
        vi.advanceTimersByTime(120)
        sonraki.shift()()
        o.update({ text: '-1,234.57', size: S, identity: 'k1', locale: 'en' })
        expect(son()).toEqual({ text: '-1,234.57', cells: null, start: false })
        const n = durumlar.length
        vi.advanceTimersByTime(2000)
        expect(durumlar.length).toBe(n)
    })

    it('pencerede A -> B -> A: hicbir sey yazilmaz', () => {
        const o = kur()
        o.update({ text: '1,234.57', size: S, identity: 'k1', locale: 'en' })
        o.update({ text: '1,234.56', size: S, identity: 'k1', locale: 'en' })
        vi.advanceTimersByTime(2000)
        expect(durumlar).toEqual([])
    })

    it('dispose: bekleyen hedef, cizim ve bitis zamanlayicisi bir sey yazmaz', () => {
        const o = kur()
        o.update({ text: '1,234.57', size: S, identity: 'k1', locale: 'en' })
        vi.advanceTimersByTime(120)
        const bekleyen = sonraki.shift()
        o.update({ text: '1,234.58', size: S, identity: 'k1', locale: 'en' })
        const n = durumlar.length
        o.dispose()
        bekleyen()
        vi.advanceTimersByTime(2000)
        o.update({ text: '9,999.99', size: S, identity: 'k9', locale: 'en' })
        expect(durumlar.length).toBe(n)
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe('odometerPlan kaynak kilidi (K7)', () => {
    const KOD = yorumsuz(readFileSync(new URL('./odometerPlan.js', import.meta.url), 'utf8'))

    it('store/chrome import yok; chrome. gecmez', () => {
        expect(KOD).not.toMatch(/from\s+['"][^'"]*(store|chrome)[^'"]*['"]/)
        expect(KOD).not.toContain('chrome.')
    })

    it('120 ms birlestirme tween.js createCoalescer ile', () => {
        expect(KOD).toMatch(/import\s*\{[^}]*\bcreateCoalescer\b[^}]*\}\s*from\s*'\.\/tween'/)
        expect(KOD).toMatch(/createCoalescer\(/)
    })
})

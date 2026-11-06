// Normal modda "logosuz token" kurallari: secici gizler, malvarligi yalniz KESIN sifiri gizler, ag kaniti.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    hideLogoless, hideLogolessZero, hideLogolessUnlessHeld, isKnownZeroBalance, isKnownPositiveBalance, isLogoMissing, reportLogoExhausted,
    reportLogoLoaded, resetLogoState, logoKey,
} from './tokenLogoState'
import { setLocalLogosOnly } from './tokenLogo'

beforeEach(() => resetLogoState())

const WITH_PACKAGED = { chainId: 1, address: '0x514910771af9ca656af840dff83e8264ecf986ca', symbol: 'LINK' }
const WITH_REMOTE = { chainId: 137, address: '0x1111111111111111111111111111111111111111', symbol: 'RMT', image: { large: 'https://cdn/x.png' } }
// Hicbir aday yok: ag desteklenmiyor, gorsel yok.
const LOGOLESS = { chainId: 999999, address: '0x2222222222222222222222222222222222222222', symbol: 'GHOST', name: 'Ghost' }
const LOGOLESS_2 = { chainId: 999999, address: '0x3333333333333333333333333333333333333333', symbol: 'NOPE', name: 'Nope' }

describe('isLogoMissing', () => {
    it('aday yoksa logosuz; paketli ve uzak adayli token logolu', () => {
        expect(isLogoMissing(LOGOLESS)).toBe(true)
        expect(isLogoMissing(WITH_PACKAGED)).toBe(false)
        expect(isLogoMissing(WITH_REMOTE)).toBe(false)
    })

    it('yerel coin her zaman logolu', () => {
        expect(isLogoMissing({ chainId: 8453, address: '0x0', symbol: 'ETH', native: true })).toBe(false)
    })
})

describe('hideLogoless -- SECICI / ARAMA', () => {
    it('logosuz token gizlenir, digerleri sirayla kalir; girdi degismez', () => {
        const rows = [WITH_PACKAGED, LOGOLESS, WITH_REMOTE, LOGOLESS_2]
        expect(hideLogoless(rows)).toEqual([WITH_PACKAGED, WITH_REMOTE])
        expect(rows).toHaveLength(4)
    })

    it('dizi olmayan girdi bos dizi', () => {
        expect(hideLogoless(undefined)).toEqual([])
        expect(hideLogoless(null)).toEqual([])
    })

    it('chainIdOf: kayit chainId tasimiyorsa aktif ag kullanilir', () => {
        const imported = { address: '0x514910771af9ca656af840dff83e8264ecf986ca', symbol: 'LINK' }
        expect(hideLogoless([imported])).toEqual([])
        expect(hideLogoless([imported], { chainIdOf: () => 1 })).toEqual([imported])
    })
})

describe('isKnownZeroBalance', () => {
    it('yalniz KESIN sifir', () => {
        expect(isKnownZeroBalance(0)).toBe(true)
        expect(isKnownZeroBalance('0')).toBe(true)
        expect(isKnownZeroBalance('0.000')).toBe(true)
        expect(isKnownZeroBalance({ amount: 0 })).toBe(true)
        expect(isKnownZeroBalance({ amount: '0' })).toBe(true)
    })

    it('sifir olmayan, bilinmeyen, yuklenmemis, hatali -> sifir DEGIL', () => {
        for (const v of [undefined, null, {}, { amount: undefined }, { amount: 0, error: true }, { amount: 5 }, 0.0001, '1', '', ' ', NaN, 'abc', { amount: NaN }]) {
            expect(isKnownZeroBalance(v)).toBe(false)
        }
    })
})

describe('hideLogolessZero -- MALVARLIGI (Home / Gonder / Takas kaynak)', () => {
    const balances = {
        [logoKey(LOGOLESS)]: { amount: 0 },
        [logoKey(LOGOLESS_2)]: { amount: 12.5 },
    }
    const balanceOf = (row) => balances[logoKey(row)]

    it('logosuz + sifir bakiye gizlenir; logosuz + bakiyeli GORUNUR; logolu sifir bakiyeli GORUNUR', () => {
        const zeroWithLogo = { ...WITH_PACKAGED }
        const rows = [LOGOLESS, LOGOLESS_2, zeroWithLogo]
        const out = hideLogolessZero(rows, (r) => (r === zeroWithLogo ? { amount: 0 } : balanceOf(r)))
        expect(out).toEqual([LOGOLESS_2, zeroWithLogo])
    })

    it('bakiye bilinmiyor / yuklenmedi / hatali olan logosuz satir GORUNUR', () => {
        const rows = [LOGOLESS, LOGOLESS_2]
        expect(hideLogolessZero(rows, () => undefined)).toEqual(rows)
        expect(hideLogolessZero(rows, () => ({ error: true, amount: 0 }))).toEqual(rows)
        expect(hideLogolessZero(rows, () => ({}))).toEqual(rows)
        expect(hideLogolessZero(rows)).toEqual(rows)
    })

    it('para gizlenmez: "0" bakiyeli ama sifirdan buyuk deger iceren hicbir satir dusmez', () => {
        expect(hideLogolessZero([LOGOLESS], () => ({ amount: '0.0000001' }))).toEqual([LOGOLESS])
        expect(hideLogolessZero([LOGOLESS], () => 0.5)).toEqual([LOGOLESS])
    })
})

describe('dinamik logosuzluk (tum kaynaklar yuklenemedi) ve ag kaniti', () => {
    it('yalniz YEREL kaynakli token tukenince hemen kesinlesir', () => {
        const t = { chainId: 1, address: '0x514910771af9ca656af840dff83e8264ecf986ca', symbol: 'LINK' }
        expect(isLogoMissing(t)).toBe(false)
        reportLogoExhausted(t, { triedRemote: false })
        expect(isLogoMissing(t)).toBe(true)
        expect(hideLogoless([t])).toEqual([])
    })

    it('uzak denenmis tukenme AG KANITI olmadan beklemede kalir (cevrimdisi tum listeyi silmez)', () => {
        reportLogoExhausted(WITH_REMOTE, { triedRemote: true })
        expect(isLogoMissing(WITH_REMOTE)).toBe(false)
        expect(hideLogoless([WITH_REMOTE])).toEqual([WITH_REMOTE])
    })

    it('ilk basarili UZAK yukleme bekleyenleri kesinlestirir; yerel yukleme kesinlestirmez', () => {
        reportLogoExhausted(WITH_REMOTE, { triedRemote: true })
        reportLogoLoaded('/tokens/1/0xabc.png')
        expect(isLogoMissing(WITH_REMOTE)).toBe(false)
        reportLogoLoaded('https://cdn.example/ok.png')
        expect(isLogoMissing(WITH_REMOTE)).toBe(true)
        expect(hideLogoless([WITH_PACKAGED, WITH_REMOTE])).toEqual([WITH_PACKAGED])
    })

    it('ag kaniti VARKEN gelen tukenme hemen kesinlesir', () => {
        reportLogoLoaded('https://cdn.example/ok.png')
        reportLogoExhausted(WITH_REMOTE, { triedRemote: true })
        expect(isLogoMissing(WITH_REMOTE)).toBe(true)
    })

    it('malvarligi: dinamik logosuz ama bakiyeli token GORUNUR kalir', () => {
        reportLogoLoaded('https://cdn.example/ok.png')
        reportLogoExhausted(WITH_REMOTE, { triedRemote: true })
        expect(hideLogolessZero([WITH_REMOTE], () => ({ amount: 3 }))).toEqual([WITH_REMOTE])
        expect(hideLogolessZero([WITH_REMOTE], () => ({ amount: 0 }))).toEqual([])
    })
})

describe('hideLogolessUnlessHeld -- bakiyeli SECICI (Takas/Kopru kaynak, Gonder)', () => {
    const balanceOf = (map) => (row) => map[row.symbol]

    it('logosuz token YALNIZ bakiyesi sifirdan buyukse kalir; bakiyesiz / bilinmeyen / sifir / hatali logosuz satir gizlenir', () => {
        const rows = [WITH_PACKAGED, LOGOLESS, LOGOLESS_2, { ...LOGOLESS, symbol: 'ERR', address: '0x4444444444444444444444444444444444444444' }]
        const out = hideLogolessUnlessHeld(rows, balanceOf({ GHOST: 0, NOPE: 7.5, ERR: { error: true, amount: 9 } }))
        expect(out).toEqual([WITH_PACKAGED, LOGOLESS_2])
    })

    it('logolu satir bakiyesiz de kalir; girdi degismez; dizi olmayan girdi bos dizi', () => {
        const rows = [WITH_PACKAGED, WITH_REMOTE]
        expect(hideLogolessUnlessHeld(rows, () => undefined)).toEqual(rows)
        expect(hideLogolessUnlessHeld(undefined)).toEqual([])
    })

    it('isKnownPositiveBalance: yalniz kesin pozitif', () => {
        for (const v of [1, 0.0001, '2', { amount: 3 }, { amount: '0.5' }]) expect(isKnownPositiveBalance(v)).toBe(true)
        for (const v of [0, '0', undefined, null, {}, { amount: 0 }, { amount: 5, error: true }, NaN, 'x', '', -1]) expect(isKnownPositiveBalance(v)).toBe(false)
    })
})

describe('gizli mod anahtari acikken suzgecler satir kumesini DEGISTIRMEZ', () => {
    afterEach(() => setLocalLogosOnly(false))

    it('hideLogoless / hideLogolessZero / hideLogolessUnlessHeld girdiyi aynen doner', () => {
        setLocalLogosOnly(true)
        const rows = [WITH_PACKAGED, LOGOLESS, LOGOLESS_2]
        expect(hideLogoless(rows)).toBe(rows)
        expect(hideLogolessZero(rows, () => ({ amount: 0 }))).toBe(rows)
        expect(hideLogolessUnlessHeld(rows, () => 0)).toBe(rows)
    })
})

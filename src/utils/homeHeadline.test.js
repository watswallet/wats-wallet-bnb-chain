import { describe, it, expect } from 'vitest'
import { headlineSizeClass } from './homeHeadline'

describe('headlineSizeClass', () => {
    it('kisa metin 42 px kalir (0, "$1,234.56" = 9, sinir 10)', () => {
        expect(headlineSizeClass(0)).toBe('text-[42px]')
        expect(headlineSizeClass(9)).toBe('text-[42px]')
        expect(headlineSizeClass(10)).toBe('text-[42px]')
    })

    it('11-13 karakter 32 px (VND "₫25,000,000" = 11 dahil)', () => {
        expect(headlineSizeClass(11)).toBe('text-[32px]')
        expect(headlineSizeClass(13)).toBe('text-[32px]')
    })

    it('14-17 karakter 26 px (IDR "IDR 16,000,000.00" = 17 dahil)', () => {
        expect(headlineSizeClass(14)).toBe('text-[26px]')
        expect(headlineSizeClass(17)).toBe('text-[26px]')
    })

    it('18 ve uzeri 20 px', () => {
        expect(headlineSizeClass(18)).toBe('text-[20px]')
        expect(headlineSizeClass(40)).toBe('text-[20px]')
    })

    it('gecersiz uzunluk (NaN, undefined, null, metin) 42 px: boyut kurali ekrani bozmaz', () => {
        expect(headlineSizeClass(NaN)).toBe('text-[42px]')
        expect(headlineSizeClass(undefined)).toBe('text-[42px]')
        expect(headlineSizeClass(null)).toBe('text-[42px]')
        expect(headlineSizeClass('abc')).toBe('text-[42px]')
    })
})

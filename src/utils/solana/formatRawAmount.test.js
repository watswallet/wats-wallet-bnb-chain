import { describe, it, expect } from 'vitest'
import { formatRawAmount } from './formatRawAmount'

describe('formatRawAmount (ham birim dizesi -> BigInt ondalik)', () => {
    it('tam hassasiyet, sondaki sifirlar kirpilir, Number yok', () => {
        expect(formatRawAmount('1500000000', 9)).toBe('1.5')
        expect(formatRawAmount('1000000000', 9)).toBe('1')
        expect(formatRawAmount('1', 9)).toBe('0.000000001')
        expect(formatRawAmount('100000000', 6)).toBe('100')
        expect(formatRawAmount('0', 9)).toBe('0')
        // 2^64-1 Number'da hassasiyet kaybederdi
        expect(formatRawAmount('18446744073709551615', 6)).toBe('18446744073709.551615')
        expect(formatRawAmount('18446744073709551615', 0)).toBe('18446744073709551615')
    })

    it('BigInt girdi kabul edilir; decimals 0..255 sinirlari', () => {
        expect(formatRawAmount(5_000_000n, 6)).toBe('5')
        expect(formatRawAmount('5', 255)).toBe('0.' + '0'.repeat(254) + '5')
    })

    it('cozulemeyen girdide null doner (uydurma yok)', () => {
        for (const bozuk of [null, undefined, '', 'abc', '1.5', '-5', '1e9', {}, NaN]) {
            expect(formatRawAmount(bozuk, 9), String(bozuk)).toBeNull()
        }
        for (const d of [null, undefined, -1, 256, 1.5, '9', NaN]) {
            expect(formatRawAmount('100', d), String(d)).toBeNull()
        }
    })
})

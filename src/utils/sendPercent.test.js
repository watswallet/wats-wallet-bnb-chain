import { describe, it, expect } from 'vitest'
import { SEND_PERCENTS, spendableBalance, percentAmount } from './sendPercent'

describe('SEND_PERCENTS', () => {
    it('%25 %50 %75 ve MAX', () => {
        expect(SEND_PERCENTS).toEqual([0.25, 0.5, 0.75, 1])
    })
})

describe('spendableBalance', () => {
    it('bakiyeden ucret payini duser', () => {
        expect(spendableBalance(10, 0.05)).toBe(9.95)
    })

    it('pay yoksa tam bakiye (jetton / ERC-20)', () => {
        expect(spendableBalance(10, 0)).toBe(10)
    })

    // Bakiye ucreti bile karsilamiyorsa negatif bir "harcanabilir" anlamsiz.
    it('bakiye ucretten kucukse 0', () => {
        expect(spendableBalance(0.01, 0.05)).toBe(0)
    })

    it('sayi olmayan girdi 0', () => {
        expect(spendableBalance(undefined, 0)).toBe(0)
        expect(spendableBalance('abc', 0)).toBe(0)
    })
})

describe('percentAmount', () => {
    // MAX bugunku setMax ile BIREBIR ayni sonucu vermeli: eski davranis
    // degistirilmiyor, yalnizca yuzdenin ozel hali oluyor.
    it('%100 harcanabilirin TA KENDISI - yuvarlanmaz, kirpilmaz', () => {
        expect(percentAmount({ balance: 0.05, reserve: 0.000000000000000004, percent: 1, decimals: 18 }))
            .toBe(String(0.05 - 0.000000000000000004))
    })

    it('%50 yarisini verir', () => {
        expect(percentAmount({ balance: 10, reserve: 0, percent: 0.5, decimals: 18 })).toBe('5')
    })

    // 1.2 * 0.25 kayan noktada 0.30000000000000004 uretir; kutuda bu gorunemez.
    it('kayan nokta gurultusu temizlenir', () => {
        expect(percentAmount({ balance: 1.2, reserve: 0, percent: 0.25, decimals: 18 })).toBe('0.3')
    })

    it('ondalik basamaga gore kirpilir', () => {
        expect(percentAmount({ balance: 10, reserve: 0, percent: 0.75, decimals: 2 })).toBe('7.5')
        expect(percentAmount({ balance: 1, reserve: 0, percent: 0.75, decimals: 1 })).toBe('0.7')
    })

    // KAPI: gurultu temizligi yukari yuvarlarsa sonuc harcanabiliri asabilirdi.
    // Asan her sonuc harcanabilire cekilir.
    it('sonuc harcanabiliri ASLA asmaz', () => {
        for (const percent of SEND_PERCENTS) {
            const out = Number(percentAmount({ balance: 0.049999999999999996, reserve: 0, percent, decimals: 18 }))
            expect(out).toBeLessThanOrEqual(0.049999999999999996)
        }
    })

    it('harcanabilir 0 ise 0', () => {
        expect(percentAmount({ balance: 0.01, reserve: 0.05, percent: 0.5, decimals: 18 })).toBe('0')
    })

    it('bilimsel gosterim uretmez', () => {
        const out = percentAmount({ balance: 0.0000001, reserve: 0, percent: 0.25, decimals: 18 })
        expect(out).not.toContain('e')
    })
})

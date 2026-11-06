import { describe, it, expect } from 'vitest'
import {
    totalSilentSwapFee,
    feePercent,
    estimatedServiceFee,
    effectiveMinUsdc,
    amountAtLeast,
    PERCENT_CHIPS,
    percentChipAmount,
    exceedsBalance,
    exceedsBalanceWithFee,
    balanceFeeBps,
    etaMinutes
} from './feeBreakdown'
import { MIN_PAYOUT_USDC } from './silentswapConfig'

describe('totalSilentSwapFee', () => {
    it('iki ucreti BigInt ile toplar, sondaki sifirlari kirpar', () => {
        expect(totalSilentSwapFee({ serviceFeeUsdc: '0.175', integratorFeeUsdc: '0.075' })).toBe('0.25')
        expect(totalSilentSwapFee({ serviceFeeUsdc: '0', integratorFeeUsdc: '0' })).toBe('0')
        expect(totalSilentSwapFee({ serviceFeeUsdc: '0.5', integratorFeeUsdc: '0.5' })).toBe('1')
    })

    it('kayan nokta hatasi yok', () => {
        expect(totalSilentSwapFee({ serviceFeeUsdc: '0.1', integratorFeeUsdc: '0.2' })).toBe('0.3')
    })

    it('eksik, bozuk ya da negatif alanda null', () => {
        expect(totalSilentSwapFee({ serviceFeeUsdc: '0.1' })).toBeNull()
        expect(totalSilentSwapFee({ serviceFeeUsdc: undefined, integratorFeeUsdc: '0.1' })).toBeNull()
        expect(totalSilentSwapFee({ serviceFeeUsdc: 'abc', integratorFeeUsdc: '0.1' })).toBeNull()
        expect(totalSilentSwapFee({ serviceFeeUsdc: '0.1', integratorFeeUsdc: '-1' })).toBeNull()
        expect(totalSilentSwapFee({ serviceFeeUsdc: '-1', integratorFeeUsdc: '0.1' })).toBeNull()
    })

    it('summary null/undefined atmaz', () => {
        expect(totalSilentSwapFee(null)).toBeNull()
        expect(totalSilentSwapFee(undefined)).toBeNull()
    })
})

describe('feePercent', () => {
    it('summary yokken feeBps / 100, bir ondaliga yarim yukari', () => {
        expect(feePercent({ feeBps: 100 })).toBe(1)
        expect(feePercent({ feeBps: 125 })).toBe(1.3)
    })

    it('summary toplam ucret ve totalUsdc verirse onu kullanir', () => {
        const summary = { totalUsdc: '25.25', serviceFeeUsdc: '0.175', integratorFeeUsdc: '0.075' }
        expect(feePercent({ summary })).toBe(1)
        // summary feeBps ten ustundur
        expect(feePercent({ feeBps: 500, summary })).toBe(1)
    })

    it('summary bozuksa ya da totalUsdc 0/eksikse feeBps e duser', () => {
        expect(feePercent({ feeBps: 100, summary: { totalUsdc: '25', serviceFeeUsdc: 'abc', integratorFeeUsdc: '0.1' } })).toBe(1)
        expect(feePercent({ feeBps: 200, summary: { totalUsdc: '0', serviceFeeUsdc: '0.1', integratorFeeUsdc: '0.1' } })).toBe(2)
        expect(feePercent({ feeBps: 200, summary: { serviceFeeUsdc: '0.1', integratorFeeUsdc: '0.1' } })).toBe(2)
    })

    it('ikisi de yoksa null (sabit yedek yok)', () => {
        expect(feePercent({})).toBeNull()
        expect(feePercent({ feeBps: null })).toBeNull()
        expect(feePercent({ feeBps: 0 })).toBeNull()
        expect(feePercent({ feeBps: -5 })).toBeNull()
        expect(feePercent({ summary: { totalUsdc: '0', serviceFeeUsdc: '0', integratorFeeUsdc: '0' } })).toBeNull()
    })

    it('summary null/undefined atmaz', () => {
        expect(feePercent({ feeBps: 100, summary: null })).toBe(1)
        expect(feePercent({ feeBps: 100, summary: undefined })).toBe(1)
        expect(feePercent({ summary: null })).toBeNull()
        expect(feePercent(undefined)).toBeNull()
    })
})

describe('estimatedServiceFee', () => {
    it('amount x feeBps / 10000', () => {
        expect(estimatedServiceFee('25', 100)).toBe('0.25')
        expect(estimatedServiceFee('12.5', 100)).toBe('0.125')
        expect(estimatedServiceFee('12', 10000)).toBe('12')
    })

    it('gecersiz girdide null', () => {
        expect(estimatedServiceFee('abc', 100)).toBeNull()
        expect(estimatedServiceFee('25', null)).toBeNull()
        expect(estimatedServiceFee('25', 0)).toBeNull()
        expect(estimatedServiceFee('25', 10001)).toBeNull()
        expect(estimatedServiceFee('', 100)).toBeNull()
        expect(estimatedServiceFee('12,5', 100)).toBeNull()
    })

    it('18 ondalikli tutar tam cikar, asagi yuvarlar', () => {
        expect(estimatedServiceFee('12.123456789012345678', 10000)).toBe('12.123456789012345678')
        // 0.000000000000000001 x 100 / 10000 = 1e-20 -> asagi yuvarlanir
        expect(estimatedServiceFee('0.000000000000000001', 100)).toBe('0')
        expect(estimatedServiceFee('0.000000000000000199', 100)).toBe('0.000000000000000001')
    })

    it('eksik girdi atmaz', () => {
        expect(() => estimatedServiceFee(undefined, undefined)).not.toThrow()
        expect(estimatedServiceFee(undefined, undefined)).toBeNull()
    })
})

describe('effectiveMinUsdc', () => {
    it('max(builtIn, info.minUsdc)', () => {
        expect(effectiveMinUsdc({ minUsdc: 15 })).toBe(15)
        expect(effectiveMinUsdc({ minUsdc: 5 })).toBe(12)
        expect(effectiveMinUsdc({ minUsdc: 15 }, 20)).toBe(20)
    })

    it('bozuk bilgide builtIn', () => {
        expect(effectiveMinUsdc(null)).toBe(12)
        expect(effectiveMinUsdc(undefined)).toBe(12)
        expect(effectiveMinUsdc({})).toBe(12)
        expect(effectiveMinUsdc({ minUsdc: NaN })).toBe(12)
        expect(effectiveMinUsdc({ minUsdc: Infinity })).toBe(12)
        expect(effectiveMinUsdc({ minUsdc: -3 })).toBe(12)
        expect(effectiveMinUsdc({ minUsdc: '20' })).toBe(12)
    })

    it('yerlesik varsayilan MIN_PAYOUT_USDC ile ayni', () => {
        expect(effectiveMinUsdc({})).toBe(MIN_PAYOUT_USDC)
    })
})

describe('amountAtLeast', () => {
    it('kanonik tutar ve esik karsilastirmasi', () => {
        expect(amountAtLeast('12', 12)).toBe(true)
        expect(amountAtLeast('12.000000000000000001', 12)).toBe(true)
        expect(amountAtLeast('11.999999999999999999', 12)).toBe(false)
        expect(amountAtLeast('0012', 12)).toBe(true)
        expect(amountAtLeast('12.5', 12.5)).toBe(true)
    })

    it('kanonik olmayan tutar false', () => {
        expect(amountAtLeast('12,5', 12)).toBe(false)
        expect(amountAtLeast('', 12)).toBe(false)
        expect(amountAtLeast('1e3', 12)).toBe(false)
        expect(amountAtLeast(' 12', 12)).toBe(false)
        expect(amountAtLeast('12.', 12)).toBe(false)
        expect(amountAtLeast(null, 12)).toBe(false)
        expect(amountAtLeast(undefined, 12)).toBe(false)
    })

    it('bozuk esik atmaz', () => {
        expect(() => amountAtLeast('12', NaN)).not.toThrow()
        expect(amountAtLeast('12', NaN)).toBe(false)
    })
})

describe('percentChipAmount', () => {
    it('cipler 25, 50, MAX', () => {
        expect(PERCENT_CHIPS).toEqual([0.25, 0.5, 1])
    })

    it('MAX dahil 6 ondaliga KIRPAR', () => {
        expect(percentChipAmount(250.1234567, 1)).toBe('250.123456')
        expect(percentChipAmount(250, 0.25)).toBe('62.5')
        expect(percentChipAmount(250, 0.5)).toBe('125')
        expect(percentChipAmount(250, 1)).toBe('250')
    })

    it('gecersiz bakiyede 0', () => {
        expect(percentChipAmount(null, 1)).toBe('0')
        expect(percentChipAmount(undefined, 1)).toBe('0')
        expect(percentChipAmount(0, 0.5)).toBe('0')
        expect(percentChipAmount(NaN, 1)).toBe('0')
        expect(percentChipAmount(-5, 1)).toBe('0')
    })

    it('hicbir cip bakiyeyi asmaz (rastgele 200 bakiye x 3 cip)', () => {
        let seed = 12345
        const rnd = () => {
            seed = (seed * 1664525 + 1013904223) % 4294967296
            return seed / 4294967296
        }
        for (let i = 0; i < 200; i++) {
            const balance = Number((rnd() * 10 ** Math.floor(rnd() * 6)).toFixed(Math.floor(rnd() * 10)))
            for (const p of PERCENT_CHIPS) {
                const text = percentChipAmount(balance, p)
                expect(Number(text)).toBeLessThanOrEqual(balance)
                expect(text).toMatch(/^\d+(\.\d{1,6})?$/)
            }
        }
    })

    it('ustel gosterimli kucuk bakiye ustel yazilmaz', () => {
        expect(percentChipAmount(2.5e-8, 1)).not.toMatch(/e/i)
    })
})

describe('exceedsBalance', () => {
    it('yalniz bakiye sonlu ve tutar kanonikken karsilastirir', () => {
        expect(exceedsBalance(25, '25.0000001')).toBe(true)
        expect(exceedsBalance(25, '25')).toBe(false)
        expect(exceedsBalance(25, '24.99')).toBe(false)
        expect(exceedsBalance(null, '99')).toBe(false)
        expect(exceedsBalance(undefined, '99')).toBe(false)
        expect(exceedsBalance(NaN, '99')).toBe(false)
        expect(exceedsBalance(25, 'abc')).toBe(false)
        expect(exceedsBalance(25, '')).toBe(false)
        expect(exceedsBalance(25, '1e3')).toBe(false)
    })
})

describe('percentChipAmount feeBps ile (ucret tutarin ustune eklenir)', () => {
    it('MAX = bakiye / (1 + feeBps/10000), 6 ondalik asagi', () => {
        expect(percentChipAmount(15.15, 1, 100)).toBe('15')
        expect(percentChipAmount(10, 1, 100)).toBe('9.90099')
        expect(percentChipAmount(10, 0.5, 100)).toBe('4.950495')
        expect(percentChipAmount(10, 0.25, 100)).toBe('2.475247')
        expect(percentChipAmount(250, 1, 50)).toBe('248.756218')
    })

    it('odeme + ucret bakiyeyi asmaz (rastgele 200 bakiye x 3 cip x 3 oran)', () => {
        let seed = 777
        const rnd = () => {
            seed = (seed * 1664525 + 1013904223) % 4294967296
            return seed / 4294967296
        }
        for (let i = 0; i < 200; i++) {
            const balance = Number((rnd() * 10 ** Math.floor(rnd() * 6)).toFixed(Math.floor(rnd() * 8)))
            for (const bps of [50, 100, 250]) {
                for (const p of PERCENT_CHIPS) {
                    const text = percentChipAmount(balance, p, bps)
                    expect(text).toMatch(/^\d+(\.\d{1,6})?$/)
                    expect(Number(text) * (1 + bps / 10000)).toBeLessThanOrEqual(balance + 1e-9)
                }
            }
        }
    })

    it('gecersiz bakiye ya da oran: bakiye 0; oran gecersizse eski davranis', () => {
        expect(percentChipAmount(null, 1, 100)).toBe('0')
        expect(percentChipAmount(0, 1, 100)).toBe('0')
        expect(percentChipAmount(-5, 1, 100)).toBe('0')
        expect(percentChipAmount(NaN, 0.5, 100)).toBe('0')
        expect(percentChipAmount(250, 1, 0)).toBe('250')
        expect(percentChipAmount(250, 1)).toBe('250')
    })
})

describe('exceedsBalanceWithFee', () => {
    it('tutar x (1 + feeBps/10000) bakiyeyi asiyor mu (15 -> 15.15)', () => {
        expect(exceedsBalanceWithFee(15.1, '15', 100)).toBe(true)
        expect(exceedsBalanceWithFee(15.15, '15', 100)).toBe(false)
        expect(exceedsBalanceWithFee(15.150001, '15', 100)).toBe(false)
        expect(exceedsBalanceWithFee(15.149999, '15', 100)).toBe(true)
        expect(exceedsBalanceWithFee(15.15, '15', 200)).toBe(true)
        expect(exceedsBalanceWithFee(15, '15', 0)).toBe(false)
    })

    it('bakiye ya da tutar ya da oran gecersizse false', () => {
        expect(exceedsBalanceWithFee(null, '99', 100)).toBe(false)
        expect(exceedsBalanceWithFee(NaN, '99', 100)).toBe(false)
        expect(exceedsBalanceWithFee(10, 'abc', 100)).toBe(false)
        expect(exceedsBalanceWithFee(10, '1e3', 100)).toBe(false)
        expect(exceedsBalanceWithFee(10, '99', null)).toBe(false)
    })
})

describe('balanceFeeBps', () => {
    it('bilinen feeBps ya da yedek 100', () => {
        expect(balanceFeeBps({ feeBps: 50 })).toBe(50)
        expect(balanceFeeBps({ feeBps: 100 })).toBe(100)
        expect(balanceFeeBps(null)).toBe(100)
        expect(balanceFeeBps({ feeBps: null })).toBe(100)
        expect(balanceFeeBps({ feeBps: 0 })).toBe(100)
        expect(balanceFeeBps({ feeBps: 'x' })).toBe(100)
    })
})

describe('etaMinutes', () => {
    it('dakikaya yuvarlar, en az 1', () => {
        expect(etaMinutes(180000)).toBe(3)
        expect(etaMinutes(1000)).toBe(1)
        expect(etaMinutes(90000)).toBe(2)
    })

    it('gecersizde null', () => {
        expect(etaMinutes(0)).toBeNull()
        expect(etaMinutes(null)).toBeNull()
        expect(etaMinutes(undefined)).toBeNull()
        expect(etaMinutes(NaN)).toBeNull()
        expect(etaMinutes(-5)).toBeNull()
        expect(etaMinutes(Infinity)).toBeNull()
    })
})

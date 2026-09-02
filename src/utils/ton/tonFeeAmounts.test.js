import { describe, it, expect } from 'vitest'
import { NANO_PER_TON, nanoToTon, atsWeiToHuman, asBigInt } from './tonFeeAmounts'
import GOLDEN from './__fixtures__/tonQuote.golden.json'

describe('birim tuzagi', () => {
    // NANO_PER_TON yanlislikla 1e18 (wei olcegi) yapilirsa nanoToTon(1 TON)
    // '1' yerine '0.000000001' doner — TON'da 1e9, EVM'de 1e18 farkli olcekler.
    it('NANO_PER_TON tam olarak 1e9', () => {
        expect(NANO_PER_TON).toBe(1_000_000_000n)
    })
})

describe('nanoToTon', () => {
    it('tam TON', () => {
        expect(nanoToTon(1000000000n)).toBe('1')
    })

    it('altin vektorun attachNanoton u — sondaki sifirlar atilir', () => {
        expect(nanoToTon(181950n)).toBe('0.00018195')
    })

    it('sifir', () => {
        expect(nanoToTon(0n)).toBe('0')
    })

    it('string girdi kabul eder', () => {
        expect(nanoToTon('181950')).toBe('0.00018195')
    })

    it('en fazla 9 ondalik basamak', () => {
        // 1 nanoton = 9. ondalik basamaktaki en kucuk birim.
        expect(nanoToTon(1n)).toBe('0.000000001')
    })
})

describe('atsWeiToHuman', () => {
    it('altin vektorun atsFee i atsFeeFormatted ile birebir', () => {
        expect(atsWeiToHuman(GOLDEN.atsFee)).toBe(GOLDEN.atsFeeFormatted)
    })

    it('varsayilan decimals 18', () => {
        expect(atsWeiToHuman(1_000_000_000_000_000_000n)).toBe('1')
    })

    it('ozel decimals ile calisir', () => {
        expect(atsWeiToHuman(150n, 2)).toBe('1.5')
    })
})

describe('asBigInt', () => {
    it('bigint i oldugu gibi dondurur', () => {
        expect(asBigInt(5n)).toBe(5n)
    })

    it('tam sayi string i bigint e cevirir', () => {
        expect(asBigInt('181950')).toBe(181950n)
    })

    it('tam sayi number i bigint e cevirir', () => {
        expect(asBigInt(181950)).toBe(181950n)
    })

    it('ondalikli string de firlatir', () => {
        expect(() => asBigInt('1.5')).toThrow('TON_AMOUNT_NOT_INTEGER')
    })

    it('ondalikli number da firlatir', () => {
        expect(() => asBigInt(1.5)).toThrow('TON_AMOUNT_NOT_INTEGER')
    })

    it('sayi olmayan string de firlatir', () => {
        expect(() => asBigInt('abc')).toThrow('TON_AMOUNT_NOT_INTEGER')
    })

    it('desteklenmeyen tipte firlatir', () => {
        expect(() => asBigInt(null)).toThrow('TON_AMOUNT_INVALID_TYPE')
        expect(() => asBigInt(undefined)).toThrow('TON_AMOUNT_INVALID_TYPE')
        expect(() => asBigInt({})).toThrow('TON_AMOUNT_INVALID_TYPE')
    })
})

import { describe, it, expect } from 'vitest'
import { deliveredShare, COST_WARNING_ABOVE_PCT } from './deliveredShare'

// Teklif ozeti: arka planin quoteSummary ciktisinin yalniz bu modulun okudugu alanlari.
const teklif = (totalUsdc, dest) => ({ totalUsdc, dest })
const usdc6 = (expectedDestAmount) => ({ decimals: 6, expectedDestAmount, quoteUsd: null })

describe('deliveredShare: tablo USDC si (teklifin kendi tutarlarindan, BigInt)', () => {
    it('Base canli olcumu: 15 USDC brut, 14.787310 USDC beklenen -> %98.6, maliyet %1.4, uyari yok', () => {
        expect(deliveredShare(teklif('15.0', usdc6('14787310')), { tableUsdc: true })).toEqual({ pay: 98.6, cost: 1.4, warn: false })
    })

    it('BSC (18 ondalik): 25.25 brut, 24.65 beklenen -> %97.6', () => {
        const dest = { decimals: 18, expectedDestAmount: '24650000000000000000', quoteUsd: null }
        expect(deliveredShare(teklif('25.25', dest), { tableUsdc: true })).toEqual({ pay: 97.6, cost: 2.4, warn: false })
    })

    it('Ethereum canli olcumu %94.6: maliyet %5.4 uyari verir', () => {
        expect(deliveredShare(teklif('15.0', usdc6('14190000')), { tableUsdc: true })).toEqual({ pay: 94.6, cost: 5.4, warn: true })
    })

    it('uyari esigi KESIN buyuktur: maliyet tam 4.0 uyarmaz, 4.1 uyarir', () => {
        expect(COST_WARNING_ABOVE_PCT).toBe(4)
        const tam = deliveredShare(teklif('15.0', usdc6('14400000')), { tableUsdc: true })
        expect(tam).toEqual({ pay: 96, cost: 4, warn: false })
        const biraz = deliveredShare(teklif('15.0', usdc6('14385000')), { tableUsdc: true })
        expect(biraz).toEqual({ pay: 95.9, cost: 4.1, warn: true })
    })

    it('yuvarlama yarim yukari: tam %95.95 -> %96.0 (ondalik kesilmez)', () => {
        expect(deliveredShare(teklif('20', usdc6('19190000')), { tableUsdc: true }).pay).toBe(96)
    })

    it('sunucunun USD yankisi tablo USDC si icin KULLANILMAZ: quoteUsd tamamen farkli olsa da tutarlardan hesaplanir', () => {
        const dest = { decimals: 6, expectedDestAmount: '14787310', quoteUsd: 1 }
        expect(deliveredShare(teklif('15.0', dest), { tableUsdc: true }).pay).toBe(98.6)
    })

    it('beklenen brutun ustundeyse (rota kazanci) pay 100u asar ve uyari cikmaz', () => {
        const r = deliveredShare(teklif('15.0', usdc6('15200000')), { tableUsdc: true })
        expect(r).toEqual({ pay: 101.3, cost: -1.3, warn: false })
    })
})

describe('deliveredShare: diger tokenler (dest.quoteUsd, yalniz bilgi)', () => {
    it('Arbitrum yerel coin canli olcumu: 14.739282208687 USD / 15 brut -> %98.3, uyari yok', () => {
        const dest = { decimals: 18, expectedDestAmount: '6153854783951967', quoteUsd: 14.739282208687 }
        expect(deliveredShare(teklif('15.0', dest))).toEqual({ pay: 98.3, cost: 1.7, warn: false })
    })

    it('Cronos yerel coin olcumu %94.5 uyari verir', () => {
        const dest = { decimals: 18, expectedDestAmount: '1', quoteUsd: 14.175 }
        expect(deliveredShare(teklif('15.0', dest))).toEqual({ pay: 94.5, cost: 5.5, warn: true })
    })

    it('USDC sembollu ama TABLO USDC si olmayan token USD yankisiyla degerlenir (sembol karar vermez)', () => {
        const dest = { asset: 'USDC', decimals: 6, expectedDestAmount: '14787310', quoteUsd: 10 }
        expect(deliveredShare(teklif('15.0', dest), { tableUsdc: false }).pay).toBe(66.7)
    })
})

describe('deliveredShare: hesaplanamayan durumlar uyarisiz ve null doner', () => {
    const NULL = { pay: null, cost: null, warn: false }

    it.each([
        ['quoteUsd yok', teklif('15.0', { decimals: 18, expectedDestAmount: '1', quoteUsd: null })],
        ['quoteUsd sifir', teklif('15.0', { decimals: 18, expectedDestAmount: '1', quoteUsd: 0 })],
        ['quoteUsd negatif', teklif('15.0', { decimals: 18, expectedDestAmount: '1', quoteUsd: -3 })],
        ['quoteUsd sayi degil', teklif('15.0', { decimals: 18, expectedDestAmount: '1', quoteUsd: 'abc' })],
        ['quoteUsd sonsuz', teklif('15.0', { decimals: 18, expectedDestAmount: '1', quoteUsd: Infinity })],
        ['dest yok', teklif('15.0', null)],
        ['teklif yok', null],
    ])('token: %s', (_ad, q) => {
        expect(deliveredShare(q)).toEqual(NULL)
    })

    it.each([
        ['brut sifir', teklif('0', usdc6('14787310'))],
        ['brut bozuk', teklif('abc', usdc6('14787310'))],
        ['brut yok', teklif(undefined, usdc6('14787310'))],
        ['brut 19 ondalik', teklif('1.0000000000000000001', usdc6('14787310'))],
        ['ondalik kesirli', teklif('15.0', { decimals: 6.5, expectedDestAmount: '14787310' })],
        ['ondalik negatif', teklif('15.0', { decimals: -1, expectedDestAmount: '14787310' })],
        ['ondalik 18 den buyuk', teklif('15.0', { decimals: 19, expectedDestAmount: '14787310' })],
        ['beklenen bilimsel gosterim', teklif('15.0', usdc6('1e7'))],
        ['beklenen negatif', teklif('15.0', usdc6('-5'))],
        ['beklenen bos', teklif('15.0', usdc6(''))],
        ['beklenen yok', teklif('15.0', { decimals: 6 })],
    ])('tablo USDC: %s', (_ad, q) => {
        expect(deliveredShare(q, { tableUsdc: true })).toEqual(NULL)
    })
})

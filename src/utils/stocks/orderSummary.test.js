// Emir durum paneli sunum yardimcilari: saf, sayi uydurmaz (Task S1).
import { describe, it, expect } from 'vitest'
import { formatAtomsLocale, cowExplorerOrderUrl, averageUnitPrice, stepIndexOf, formatElapsed, stockValueUsd, ORDER_STEP_KEYS } from './orderSummary'

const UID = `0x${'ab'.repeat(56)}`

describe('formatAtomsLocale', () => {
    it('Turkce: virgul ondalik, binlik nokta', () => {
        expect(formatAtomsLocale('10000000', 6, 'tr')).toBe('10')
        expect(formatAtomsLocale('1234500000', 6, 'tr')).toBe('1.234,5')
    })
    it('Ingilizce: nokta ondalik', () => {
        expect(formatAtomsLocale('1500000000000000000', 18, 'en')).toBe('1.5')
    })
    it('kucuk miktarda anlamli haneler korunur (kesilir, yuvarlanmaz)', () => {
        expect(formatAtomsLocale('728000000000000', 18, 'tr')).toBe('0,000728')
        expect(formatAtomsLocale('728999000000000', 18, 'tr')).toBe('0,000728')
    })
    it('1 uzeri miktarda en fazla 4 ondalik', () => {
        expect(formatAtomsLocale('1234567000', 6, 'en')).toBe('1,234.567')
        expect(formatAtomsLocale('1234567891', 6, 'en')).toBe('1,234.5678')
    })
    it('gecersiz ya da sifir girdi -> null', () => {
        expect(formatAtomsLocale(null, 6, 'tr')).toBeNull()
        expect(formatAtomsLocale('abc', 6, 'tr')).toBeNull()
        expect(formatAtomsLocale('0', 6, 'tr')).toBeNull()
        expect(formatAtomsLocale('5', undefined, 'tr')).toBeNull()
    })
})

describe('cowExplorerOrderUrl', () => {
    it('CoW kaynak kodundaki ag yollari: mainnet yolsuz, bnb, arb1', () => {
        expect(cowExplorerOrderUrl(1, UID)).toBe(`https://explorer.cow.fi/orders/${UID}`)
        expect(cowExplorerOrderUrl(56, UID)).toBe(`https://explorer.cow.fi/bnb/orders/${UID}`)
        expect(cowExplorerOrderUrl(42161, UID)).toBe(`https://explorer.cow.fi/arb1/orders/${UID}`)
    })
    it('bilinmeyen ag ya da bozuk uid -> null', () => {
        expect(cowExplorerOrderUrl(137, UID)).toBeNull()
        expect(cowExplorerOrderUrl(1, '0x12')).toBeNull()
        expect(cowExplorerOrderUrl(1, null)).toBeNull()
    })
})

describe('averageUnitPrice', () => {
    it('Al: odenen / alinan', () => {
        expect(averageUnitPrice({ side: 'buy', paidAtoms: '10000000', paidDecimals: 6, stockAtoms: '45000000000000000', stockDecimals: 18 })).toBeCloseTo(222.222, 2)
    })
    it('veri eksik ya da sifir -> null', () => {
        expect(averageUnitPrice({ side: 'buy', paidAtoms: null, paidDecimals: 6, stockAtoms: '1', stockDecimals: 18 })).toBeNull()
        expect(averageUnitPrice({ side: 'buy', paidAtoms: '10', paidDecimals: 6, stockAtoms: '0', stockDecimals: 18 })).toBeNull()
    })
})

describe('stepIndexOf', () => {
    it('submitting -> 1, pending/open/active -> 2, solved/executing -> 3, fulfilled -> 4', () => {
        expect(stepIndexOf('submitting', null)).toBe(1)
        expect(stepIndexOf('pending', null)).toBe(2)
        expect(stepIndexOf('pending', 'open')).toBe(2)
        expect(stepIndexOf('pending', 'active')).toBe(2)
        expect(stepIndexOf('pending', 'solved')).toBe(3)
        expect(stepIndexOf('pending', 'executing')).toBe(3)
        expect(stepIndexOf('fulfilled', 'traded')).toBe(4)
    })
    it('expired/cancelled adim uretmez', () => {
        expect(stepIndexOf('expired', null)).toBeNull()
        expect(stepIndexOf('cancelled', null)).toBeNull()
    })
    it('bes adim anahtari', () => expect(ORDER_STEP_KEYS).toHaveLength(5))
})

describe('formatElapsed', () => {
    it('dd:ss', () => {
        expect(formatElapsed(0)).toBe('0:00')
        expect(formatElapsed(65_000)).toBe('1:05')
        expect(formatElapsed(-5)).toBe('0:00')
        expect(formatElapsed(NaN)).toBe('0:00')
    })
})

describe('stockValueUsd', () => {
    it('miktar x referans fiyat; fiyat yok/gecersiz -> null', () => {
        expect(stockValueUsd({ atoms: '45000000000000000', decimals: 18, price: 222 })).toBeCloseTo(9.99, 5)
        expect(stockValueUsd({ atoms: '45000000000000000', decimals: 18, price: null })).toBeNull()
        expect(stockValueUsd({ atoms: '45000000000000000', decimals: 18, price: 0 })).toBeNull()
        expect(stockValueUsd({ atoms: null, decimals: 18, price: 5 })).toBeNull()
    })
})

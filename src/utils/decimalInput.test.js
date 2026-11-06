import { describe, it, expect } from 'vitest'
import { normalizeDecimalInput, trimDecimalTail } from './decimalInput'

describe('normalizeDecimalInput', () => {
    it('nokta ve virgul ikisi de ondalik ayiraci, sonuc hep nokta', () => {
        expect(normalizeDecimalInput('100,50', '')).toBe('100.50')
        expect(normalizeDecimalInput('100.50', '')).toBe('100.50')
        expect(normalizeDecimalInput('0,5', '')).toBe('0.5')
    })

    it('yazim sirasinda ara degerler kabul edilir', () => {
        expect(normalizeDecimalInput('', '5')).toBe('')
        expect(normalizeDecimalInput('5,', '5')).toBe('5.')
        expect(normalizeDecimalInput('5.', '5')).toBe('5.')
        expect(normalizeDecimalInput('0', '')).toBe('0')
    })

    it('bastaki ayirac basa 0 alir', () => {
        expect(normalizeDecimalInput(',5', '')).toBe('0.5')
        expect(normalizeDecimalInput('.5', '')).toBe('0.5')
        expect(normalizeDecimalInput(',', '')).toBe('0.')
        expect(normalizeDecimalInput('.', '')).toBe('0.')
    })

    it('ikinci ayirac reddedilir: alan son gecerli degerde kalir', () => {
        expect(normalizeDecimalInput('1,2,', '1,2')).toBe('1,2'.replace(',', '.'))
        expect(normalizeDecimalInput('1,2,3', '1.2')).toBe('1.2')
        expect(normalizeDecimalInput('1.2.', '1.2')).toBe('1.2')
        expect(normalizeDecimalInput('1,2.', '1.2')).toBe('1.2')
    })

    it('binlik ayiraci reddedilir', () => {
        expect(normalizeDecimalInput('1.000,50', '1.000')).toBe('1.000')
        expect(normalizeDecimalInput('1,000.50', '1.000')).toBe('1.000')
    })

    it('harf, eksi, bosluk, us ve diger karakterler reddedilir', () => {
        expect(normalizeDecimalInput('abc', '')).toBe('')
        expect(normalizeDecimalInput('12a', '12')).toBe('12')
        expect(normalizeDecimalInput('-5', '')).toBe('')
        expect(normalizeDecimalInput('1 5', '1')).toBe('1')
        expect(normalizeDecimalInput('1e5', '1')).toBe('1')
        expect(normalizeDecimalInput('+5', '')).toBe('')
    })

    it('onceki deger bossa ve girdi gecersizse bos kalir; null/undefined guvenli', () => {
        expect(normalizeDecimalInput(null, '7')).toBe('')
        expect(normalizeDecimalInput(undefined, '')).toBe('')
        expect(normalizeDecimalInput('x', undefined)).toBe('')
    })

    it('sayi tipi girdi metne cevrilir', () => {
        expect(normalizeDecimalInput(12.5, '')).toBe('12.5')
    })
})

describe('trimDecimalTail', () => {
    it('sondaki ayiraci atar, gerisine dokunmaz', () => {
        expect(trimDecimalTail('5.')).toBe('5')
        expect(trimDecimalTail('0.')).toBe('0')
        expect(trimDecimalTail('5.10')).toBe('5.10')
        expect(trimDecimalTail('')).toBe('')
        expect(trimDecimalTail('100')).toBe('100')
    })
})

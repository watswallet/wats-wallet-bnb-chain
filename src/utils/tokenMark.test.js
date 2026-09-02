import { describe, it, expect } from 'vitest'
import { markInitials, markClass, formatBalance } from './tokenMark'

describe('markInitials', () => {
  it('ilk 2 harf buyuk', () => {
    expect(markInitials('usdc')).toBe('US')
  })
  it('tek harf', () => {
    expect(markInitials('X')).toBe('X')
  })
  it('bos/gecersiz -> ?', () => {
    expect(markInitials('')).toBe('?')
    expect(markInitials(null)).toBe('?')
  })
})

describe('markClass', () => {
  it('deterministik (ayni sembol ayni sinif)', () => {
    expect(markClass('USDC')).toBe(markClass('USDC'))
  })
  it('native her zaman emerald', () => {
    expect(markClass('ETH', true)).toContain('emerald')
  })
  it('literal tailwind siniflari dondurur', () => {
    expect(markClass('USDT')).toMatch(/bg-\w+-100/)
  })
})

describe('formatBalance', () => {
  it('kucuk sayi en fazla 4 ondalik', () => {
    expect(formatBalance(125.456789)).toBe('125.4568')
  })
  it('binlik ayrac', () => {
    expect(formatBalance(1234.5)).toBe('1,234.5')
  })
  it('milyon kisaltma', () => {
    expect(formatBalance(2500000)).toBe('2.50M')
  })
  it('milyar kisaltma', () => {
    expect(formatBalance(3200000000)).toBe('3.20B')
  })
  it('gecersiz -> 0', () => {
    expect(formatBalance('abc')).toBe('0')
  })
})

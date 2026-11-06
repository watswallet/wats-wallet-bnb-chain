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

  // `locale` EN SONA eklenen istege bagli parametre; verilmezse en-US davranisi AYNEN kalir.
  it('locale verilince ayraclar dile gore degisir (de)', () => {
    expect(formatBalance(1234.5, 'de')).toBe('1.234,5')
    expect(formatBalance(125.456789, 'de')).toBe('125,4568')
  })
  it('locale verilmezse en-US: binlik virgul, ondalik nokta', () => {
    expect(formatBalance(1234.5)).toBe('1,234.5')
    expect(formatBalance(125.456789)).toBe('125.4568')
  })
  // Ayni fonksiyonun kisaltma kolu da ayni dili izler (yoksa "125,4568" yaninda "2.50M" cikardi).
  it('milyon/milyar kisaltmasinda ondalik ayraci da dile baglidir; binlik ayraci eklenmez', () => {
    expect(formatBalance(2500000, 'de')).toBe('2,50M')
    expect(formatBalance(3200000000, 'de')).toBe('3,20B')
    expect(formatBalance(2500000, 'en-US')).toBe('2.50M')
    // 999 999 999 / 1e6 = 999.999999 -> '1000.00M' (eski toFixed davranisi): gruplama yok.
    expect(formatBalance(999999999)).toBe('1000.00M')
  })
  it('gecersiz deger dilden bagimsiz "0"', () => {
    expect(formatBalance('abc', 'de')).toBe('0')
  })
})

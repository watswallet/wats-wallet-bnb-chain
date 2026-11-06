import { describe, it, expect } from 'vitest'
import {
  unitsString,
  percentOfAtoms,
  formatAtoms,
  decimalToAtoms,
  toAtomsCeil,
  shortfallOfNumbers,
  isInsufficientAtoms,
  buildInsufficient,
  chipAmount,
} from './stockBalance'

// Kiran vaka: BSC USDC 18 ondalik. Gercek bakiye 0.188405789675366912 (atom). Number() bunu
// 0.18840578967536692 yapar ve 'toFixed(6)' 0.188406'ya YUKARI yuvarlar: ikisi de bakiyeyi asar.
const BAKIYE_18 = 188405789675366912n

describe('unitsString', () => {
  it('atomu tam duz ondalik metne cevirir (kayip yok)', () => {
    expect(unitsString(BAKIYE_18, 18)).toBe('0.188405789675366912')
    expect(unitsString(1_500_000n, 6)).toBe('1.5')
    expect(unitsString(2n * 10n ** 18n, 18)).toBe('2')
    expect(unitsString(0n, 6)).toBe('0')
  })
})

describe('percentOfAtoms', () => {
  it('yuzdeler asagi yuvarlar ve bakiyeyi asmaz', () => {
    expect(percentOfAtoms(10n, 0.25)).toBe(2n)
    expect(percentOfAtoms(10n, 0.75)).toBe(7n)
    expect(percentOfAtoms(BAKIYE_18, 1)).toBe(BAKIYE_18)
    for (const p of [0.25, 0.5, 0.75, 1]) expect(percentOfAtoms(BAKIYE_18, p) <= BAKIYE_18).toBe(true)
  })
  it('1den buyuk yuzde bakiyeyi asmaz', () => {
    expect(percentOfAtoms(100n, 2)).toBe(100n)
  })
  it('gecersiz yuzde 0 verir', () => {
    expect(percentOfAtoms(100n, 0)).toBe(0n)
    expect(percentOfAtoms(100n, -1)).toBe(0n)
    expect(percentOfAtoms(100n, Number.NaN)).toBe(0n)
  })
})

describe('chipAmount (MAX ve yuzde cipleri)', () => {
  it('MAX tam atom degerini verir, bakiyeyi asmaz', () => {
    const c = chipAmount({ atoms: BAKIYE_18, decimals: 18, percent: 1 })
    expect(c.amount).toBe('0.188405789675366912')
    expect(decimalToAtoms(c.amount, 18)).toBe(BAKIYE_18)
  })
  it('girdi gosterimi 6 ondalikla asagi kirpilir', () => {
    const c = chipAmount({ atoms: BAKIYE_18, decimals: 18, percent: 1 })
    expect(c.display).toBe('0.188405')
    expect(Number(c.display)).toBeLessThanOrEqual(0.188405789675366912)
  })
  it('yuzde yarim bakiyeyi asagi yuvarlar', () => {
    const c = chipAmount({ atoms: 3n, decimals: 18, percent: 0.5 })
    expect(decimalToAtoms(c.amount, 18)).toBe(1n)
  })
  it('sifir sonuc bos metin', () => {
    expect(chipAmount({ atoms: 0n, decimals: 6, percent: 1 }).amount).toBe('')
    expect(chipAmount({ atoms: 1n, decimals: 6, percent: 0.25 }).amount).toBe('')
  })
  it('6 ondalikli tokende gosterim tam atom degeridir', () => {
    const c = chipAmount({ atoms: 1_234_567n, decimals: 6, percent: 1 })
    expect(c.amount).toBe('1.234567')
    expect(c.display).toBe('1.234567')
  })
})

describe('decimalToAtoms', () => {
  it('ondaligi asarsa null (belirsiz)', () => {
    expect(decimalToAtoms('1.1234567', 6)).toBeNull()
    expect(decimalToAtoms('abc', 6)).toBeNull()
    expect(decimalToAtoms('1.5', 6)).toBe(1_500_000n)
    expect(decimalToAtoms('0.', 6)).toBe(0n)
  })
})

describe('isInsufficientAtoms', () => {
  it('tutar bakiyeyi asarsa true, esitse false', () => {
    expect(isInsufficientAtoms('0.188405789675366913', BAKIYE_18, 18)).toBe(true)
    expect(isInsufficientAtoms('0.188405789675366912', BAKIYE_18, 18)).toBe(false)
  })
  it('ondaligi asan girdi null (cagiran float yoluna doner)', () => {
    expect(isInsufficientAtoms('1.1234567', 5n, 6)).toBeNull()
  })
})

describe('formatAtoms', () => {
  it('tr virgul, asagi kirpar', () => {
    expect(formatAtoms(BAKIYE_18, 18, { locale: 'tr' })).toBe('0,188405')
    expect(formatAtoms(BAKIYE_18, 18, { locale: 'en' })).toBe('0.188405')
  })
  it('yukari yuvarlama gereken ve eksik icindir', () => {
    expect(formatAtoms(BAKIYE_18, 18, { locale: 'tr', round: 'up' })).toBe('0,188406')
    expect(formatAtoms(1_500_000n, 6, { locale: 'tr', round: 'up' })).toBe('1,5')
  })
  it('sifir degil ama gosterilemeyecek kadar kucuk: <0,000001', () => {
    expect(formatAtoms(5n, 18, { locale: 'tr' })).toBe('<0,000001')
    expect(formatAtoms(0n, 18, { locale: 'tr' })).toBe('0')
  })
})

describe('buildInsufficient', () => {
  it('USDC 6 ondalik: gereken, mevcut ve eksik', () => {
    const m = buildInsufficient({ requiredAtoms: 2_500_000n, availableAtoms: 1_000_000n, decimals: 6, symbol: 'USDC', locale: 'tr' })
    expect(m.params).toEqual({ required: '2,5', have: '1', missing: '1,5', symbol: 'USDC' })
    expect(m.equalizeAmount).toBe('1')
  })
  it('USDC 18 ondalik: mevcut asagi, gereken ve eksik yukari', () => {
    const m = buildInsufficient({ requiredAtoms: BAKIYE_18 + 1n, availableAtoms: BAKIYE_18, decimals: 18, symbol: 'USDC', locale: 'tr' })
    expect(m.params.have).toBe('0,188405')
    expect(m.params.required).toBe('0,188406')
    expect(m.params.missing).toBe('0,000001')
    expect(m.equalizeAmount).toBe('0.188405789675366912')
  })
  it('hisse 18 ondalik', () => {
    const m = buildInsufficient({ requiredAtoms: 3n * 10n ** 18n, availableAtoms: 5n * 10n ** 17n, decimals: 18, symbol: 'TSLAx', locale: 'en' })
    expect(m.params).toEqual({ required: '3', have: '0.5', missing: '2.5', symbol: 'TSLAx' })
  })
  it('mevcut 0 ise esitleme yok', () => {
    const m = buildInsufficient({ requiredAtoms: 10n, availableAtoms: 0n, decimals: 6, symbol: 'ATS', locale: 'tr' })
    expect(m.equalizeAmount).toBeNull()
    expect(m.params.have).toBe('0')
  })
  it('gecersiz ya da yeterli bakiye null', () => {
    expect(buildInsufficient({ requiredAtoms: 'x', availableAtoms: 1n, decimals: 6, symbol: 'A' })).toBeNull()
    expect(buildInsufficient({ requiredAtoms: 5n, availableAtoms: 5n, decimals: 6, symbol: 'A' })).toBeNull()
    expect(buildInsufficient({ requiredAtoms: 5n, availableAtoms: 1n, decimals: 6, symbol: '' })).toBeNull()
  })
  it('atomlar metin olarak da gelebilir (arka plan mesaji)', () => {
    const m = buildInsufficient({ requiredAtoms: '2000000', availableAtoms: '500000', decimals: 6, symbol: 'USDC', locale: 'tr' })
    expect(m.params.missing).toBe('1,5')
  })
})

describe('toAtomsCeil', () => {
  it('duz metni tam cevirir', () => {
    expect(toAtomsCeil('0.1', 18)).toBe(10n ** 17n)
    expect(toAtomsCeil('4', 18)).toBe(4n * 10n ** 18n)
  })
  it('fazla ondaligi YUKARI yuvarlar', () => {
    expect(toAtomsCeil('0.0000001', 6)).toBe(1n)
    expect(toAtomsCeil('0.0000000', 6)).toBe(0n)
  })
  it('ustel gosterim ve Number yoluna duser, bozuk girdi 0', () => {
    expect(toAtomsCeil(1e-7, 18)).toBe(100000000000n)
    expect(toAtomsCeil('abc', 6)).toBe(0n)
    expect(toAtomsCeil(-5, 6)).toBe(0n)
  })
})

describe('shortfallOfNumbers (ATS ucreti: Number degerlerinden kart)', () => {
  it('ATS 18 ondalik: gereken, mevcut, eksik', () => {
    const m = shortfallOfNumbers({ required: 2.5, have: 1, decimals: 18, symbol: 'ATS', locale: 'tr' })
    expect(m.params).toEqual({ required: '2,5', have: '1', missing: '1,5', symbol: 'ATS' })
  })
  it('mevcut asagi, gereken yukari yuvarlanir', () => {
    const m = shortfallOfNumbers({ required: 0.1234567, have: 0.1234561, decimals: 18, symbol: 'ATS', locale: 'en' })
    expect(m.params.required).toBe('0.123457')
    expect(m.params.have).toBe('0.123456')
  })
  it('mevcut ASAGI cevrilir: 0.1 bakiyesi 0.100000000000000001 olmaz', () => {
    expect(shortfallOfNumbers({ required: 1, have: 0.1, decimals: 18, symbol: 'ATS' }).equalizeAmount).toBe('0.1')
  })
  it('yeterli bakiye ya da bozuk girdi null', () => {
    expect(shortfallOfNumbers({ required: 1, have: 2, decimals: 18, symbol: 'ATS' })).toBeNull()
    expect(shortfallOfNumbers({ required: null, have: 0, decimals: 18, symbol: 'ATS' })).toBeNull()
    expect(shortfallOfNumbers({ required: Number.NaN, have: 0, decimals: 18, symbol: 'ATS' })).toBeNull()
  })
  it('bakiye bilinmiyorsa (undefined) 0 sayilir', () => {
    const m = shortfallOfNumbers({ required: 2, have: undefined, decimals: 18, symbol: 'ATS', locale: 'tr' })
    expect(m.params.have).toBe('0')
  })
})

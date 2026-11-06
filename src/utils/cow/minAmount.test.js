// "Tutar ag ucretini karsilamiyor" (CoW) hatasi icin en az tutar / eksik miktar hesabi. Tam BigInt, yukari yuvarlama.
import { describe, it, expect } from 'vitest'
import { smallAmountInfo } from './minAmount'

const SAYISAL = /^\d+(\.\d+)?$/

describe('smallAmountInfo Al (USDC 6 ondalik, USD tokeni)', () => {
  it('ucret 1.407872, girilen 0.5 -> ucret 1.41, en az 1.69, eksik 1.19, USD 1:1', () => {
    expect(smallAmountInfo({ side: 'buy', feeAtoms: '1407872', enteredAtoms: 500000n, sellDecimals: 6, reference: 380 })).toEqual({
      feeAtoms: '1407872',
      feeDisplay: '1.41',
      feeUsd: '1.41',
      minAmountDisplay: '1.69',
      missingDisplay: '1.19',
    })
  })

  it('1.2 kat ve gosterim yuvarlamasi HER ZAMAN yukari: ucret 1.000001 -> en az 1.21 (1.2000012 -> 1.21)', () => {
    const r = smallAmountInfo({ side: 'buy', feeAtoms: '1000001', enteredAtoms: 100000n, sellDecimals: 6, reference: 380 })
    expect(r.feeDisplay).toBe('1.01')
    expect(r.minAmountDisplay).toBe('1.21')
    expect(r.missingDisplay).toBe('1.11')
  })

  it('eksik, YUVARLANMIS en azdan hesaplanir (ham 1.200002 degil): girilen 1.205 -> eksik 0.01', () => {
    const r = smallAmountInfo({ side: 'buy', feeAtoms: '1000001', enteredAtoms: 1_205_000n, sellDecimals: 6, reference: 380 })
    expect(r.minAmountDisplay).toBe('1.21')
    expect(r.missingDisplay).toBe('0.01')
  })

  it('tam sinirda yukari yuvarlama yok: ucret 5 -> en az 6.00, eksik 5.90 (girilen 0.1)', () => {
    const r = smallAmountInfo({ side: 'buy', feeAtoms: '5000000', enteredAtoms: 100000n, sellDecimals: 6, reference: 380 })
    expect(r).toMatchObject({ feeDisplay: '5.00', minAmountDisplay: '6.00', missingDisplay: '5.90' })
  })

  it('cok kucuk ucret en az 0.01 gosterilir (asla 0.00)', () => {
    const r = smallAmountInfo({ side: 'buy', feeAtoms: '1', enteredAtoms: 0n, sellDecimals: 6, reference: 380 })
    expect(r.feeDisplay).toBe('0.01')
    expect(r.feeUsd).toBe('0.01')
    expect(r.minAmountDisplay).toBe('0.01')
  })

  it('BSC 18 ondalikli USDT: ucret 0.03 USDT, girilen 0.01', () => {
    const r = smallAmountInfo({ side: 'buy', feeAtoms: String(3n * 10n ** 16n), enteredAtoms: 10n ** 16n, sellDecimals: 18, reference: 380 })
    expect(r).toMatchObject({ feeDisplay: '0.03', feeUsd: '0.03', minAmountDisplay: '0.04', missingDisplay: '0.03' })
  })

  it('en az tutar girilen tutarin ustunde olmali: min = girilen + eksik (yuvarlama payi disinda)', () => {
    const r = smallAmountInfo({ side: 'buy', feeAtoms: '1407872', enteredAtoms: 1_000_000n, sellDecimals: 6, reference: null })
    expect(Number(r.minAmountDisplay)).toBeGreaterThanOrEqual(1 + Number(r.missingDisplay) - 1e-9)
  })

  it('referans Al icin gerekmez (USD 1:1)', () => {
    expect(smallAmountInfo({ side: 'buy', feeAtoms: '1407872', enteredAtoms: 500000n, sellDecimals: 6, reference: null }).feeUsd).toBe('1.41')
  })
})

describe('smallAmountInfo Sat (hisse 18 ondalik)', () => {
  it('ucret 0.005 hisse, referans 380 -> ucret 0.005, USD 1.90, en az 0.006, eksik 0.005 (girilen 0.001)', () => {
    expect(
      smallAmountInfo({ side: 'sell', feeAtoms: String(5n * 10n ** 15n), enteredAtoms: 10n ** 15n, sellDecimals: 18, reference: 380 }),
    ).toEqual({
      feeAtoms: '5000000000000000',
      feeDisplay: '0.005',
      feeUsd: '1.90',
      minAmountDisplay: '0.006',
      missingDisplay: '0.005',
    })
  })

  it('anlamli 6 hane yukari: ucret 0.003333333333333333 -> 0.00333334, en az 0.004', () => {
    const r = smallAmountInfo({ side: 'sell', feeAtoms: '3333333333333333', enteredAtoms: 10n ** 15n, sellDecimals: 18, reference: 380 })
    expect(r.feeDisplay).toBe('0.00333334')
    expect(r.minAmountDisplay).toBe('0.004')
    expect(r.missingDisplay).toBe('0.003')
  })

  it('buyuk hisse miktari: ucret 12.3456781 -> 12.3457 (6 hane yukari), sondaki sifirlar atilir', () => {
    const r = smallAmountInfo({ side: 'sell', feeAtoms: '12345678100000000000', enteredAtoms: 10n ** 18n, sellDecimals: 18, reference: 380 })
    expect(r.feeDisplay).toBe('12.3457')
    expect(r.minAmountDisplay).toBe('14.8149')
  })

  it('USD ucreti de yukari yuvarlanir (ucret 1e-9 hisse x 380 = 3.8e-7 $ -> 0.01)', () => {
    const r = smallAmountInfo({ side: 'sell', feeAtoms: String(10n ** 9n), enteredAtoms: 0n, sellDecimals: 18, reference: 380 })
    expect(r.feeUsd).toBe('0.01')
  })

  it('referans yoksa feeUsd alani YOK, kalan alanlar var', () => {
    const r = smallAmountInfo({ side: 'sell', feeAtoms: String(5n * 10n ** 15n), enteredAtoms: 10n ** 15n, sellDecimals: 18, reference: null })
    expect('feeUsd' in r).toBe(false)
    expect(r.minAmountDisplay).toBe('0.006')
    const sifir = smallAmountInfo({ side: 'sell', feeAtoms: String(5n * 10n ** 15n), enteredAtoms: 10n ** 15n, sellDecimals: 18, reference: 0 })
    expect('feeUsd' in sifir).toBe(false)
  })
})

describe('smallAmountInfo gecersiz / tutarsiz girdi -> null (genel metin)', () => {
  const ok = { side: 'buy', feeAtoms: '1407872', enteredAtoms: 500000n, sellDecimals: 6, reference: 380 }
  it('gecersiz ucret', () => {
    for (const feeAtoms of [undefined, null, '', '0', '-1', '1.5', 'abc', 5, 10n, String(10n ** 37n)]) {
      expect(smallAmountInfo({ ...ok, feeAtoms })).toBeNull()
    }
  })
  it('gecersiz taraf / ondalik / girilen', () => {
    expect(smallAmountInfo({ ...ok, side: 'x' })).toBeNull()
    expect(smallAmountInfo({ ...ok, sellDecimals: -1 })).toBeNull()
    expect(smallAmountInfo({ ...ok, sellDecimals: 1.5 })).toBeNull()
    expect(smallAmountInfo({ ...ok, enteredAtoms: -1n })).toBeNull()
    expect(smallAmountInfo({ ...ok, enteredAtoms: 5 })).toBeNull()
    expect(smallAmountInfo()).toBeNull()
  })
  it('girilen tutar zaten en azin ustundeyse (ucret tahmini girilenden kucuk) eksik yok -> null', () => {
    expect(smallAmountInfo({ ...ok, feeAtoms: '100000', enteredAtoms: 500000n })).toBeNull()
    expect(smallAmountInfo({ ...ok, feeAtoms: '1000000', enteredAtoms: 1_200_000n })).toBeNull()
  })
  it('cikti alanlari yalniz rakam dizesi (BigInt / nesne yok), JSON.stringify calisir', () => {
    const r = smallAmountInfo(ok)
    for (const v of Object.values(r)) expect(typeof v === 'string' && SAYISAL.test(v)).toBe(true)
    expect(() => JSON.stringify(r)).not.toThrow()
  })
})

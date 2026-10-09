// Satis yolu kapisi -- ekran ve arka plan AYNI fonksiyonu sorar (spec §6.1, §6.3).
import { describe, it, expect, vi, afterEach } from 'vitest'

const satis = vi.hoisted(() => ({ acik: true }))
vi.mock('./atsSaleConfig', async (importOriginal) => ({
  ...(await importOriginal()),
  isAtsSaleLive: () => satis.acik,
}))

import { salePayTokenFor, saleRequestFor, liveSaleRequest, isAtsSaleRoute, isAtsSaleHint } from './atsSaleRoute'

const USDT = '0x55d398326f99059fF775485246999027B3197955'
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
const ATS = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'
const CAKE = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'
const ZERO = '0x0000000000000000000000000000000000000000'
const istek = (inTokenAddress, over = {}) => ({ chainId: 56, inTokenAddress, outTokenAddress: ATS, ...over })

afterEach(() => { satis.acik = true })

describe('salePayTokenFor', () => {
  it('USDT/USDC adresle, harf duyarsiz', () => {
    expect(salePayTokenFor(USDT).symbol).toBe('USDT')
    expect(salePayTokenFor(USDC.toLowerCase()).symbol).toBe('USDC')
  })

  // REVIEW FOCUS 3: "Varliklarim" kaydi BNB'yi ZeroAddress ile tasir.
  it("native BNB hem '0x0' hem ZeroAddress", () => {
    expect(salePayTokenFor('0x0')).toMatchObject({ symbol: 'BNB', quoteAddress: ZERO })
    expect(salePayTokenFor(ZERO)).toMatchObject({ symbol: 'BNB', quoteAddress: ZERO })
  })

  // REVIEW FOCUS 3: adressiz kayit baska bir token olabilir -- BNB SAYILMAZ (fail-closed).
  it.each([[''], ['   '], [undefined], [null], [42]])('bos/tanimsiz adres (%s) BNB sayilmaz', (a) => {
    expect(salePayTokenFor(a)).toBeNull()
  })

  it('baska token ya da 0xEeee yer tutucusu -> null', () => {
    expect(salePayTokenFor(CAKE)).toBeNull()
    expect(salePayTokenFor('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')).toBeNull()
  })
})

describe('saleRequestFor (bayraga BAKMAZ)', () => {
  it('BSC + hedef ATS + odeme tokeni -> istek', () => {
    expect(saleRequestFor(istek(USDT))).toMatchObject({ symbol: 'USDT', quoteAddress: USDT })
    expect(saleRequestFor(istek(ZERO))).toMatchObject({ symbol: 'BNB', quoteAddress: ZERO })
  })

  it("chainId metin '56' de BSC sayilir", () => {
    expect(saleRequestFor(istek(USDT, { chainId: '56' }))).not.toBeNull()
  })

  it('baska zincir, hedef ATS degil ya da ATS satisi -> null', () => {
    expect(saleRequestFor(istek(USDT, { chainId: 137 }))).toBeNull()
    expect(saleRequestFor(istek(USDT, { outTokenAddress: USDC }))).toBeNull()
    expect(saleRequestFor({ chainId: 56, inTokenAddress: ATS, outTokenAddress: USDT })).toBeNull()
    expect(saleRequestFor()).toBeNull()
  })
})

describe('liveSaleRequest / isAtsSaleRoute', () => {
  it('bayrak acik -> istek', () => {
    expect(liveSaleRequest(istek(USDC)).symbol).toBe('USDC')
    expect(isAtsSaleRoute(istek(USDC))).toBe(true)
  })

  it('bayrak KAPALI -> null (takas yolu birebir bugunku)', () => {
    satis.acik = false
    expect(liveSaleRequest(istek(USDT))).toBeNull()
    expect(isAtsSaleRoute(istek(USDT))).toBe(false)
  })
})

describe('isAtsSaleHint', () => {
  it('hedef ATS (BSC) + odeme tokeni olmayan kaynak -> true', () => {
    expect(isAtsSaleHint(istek(CAKE))).toBe(true)
  })

  it('kaynak odeme tokeni (zaten satis yolu), kaynak secili degil ya da baska zincir -> false', () => {
    expect(isAtsSaleHint(istek(USDT))).toBe(false)
    expect(isAtsSaleHint(istek(undefined))).toBe(false)
    expect(isAtsSaleHint(istek(CAKE, { chainId: 1 }))).toBe(false)
  })

  it('bayrak kapali -> false', () => {
    satis.acik = false
    expect(isAtsSaleHint(istek(CAKE))).toBe(false)
  })
})

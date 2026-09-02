// Ucret gaz TAVANINDAN turer. Capraz-zincirde iade YOKTUR -> her fazla limit dogrudan
// kullanicinin cebinden cikar. Bu testler belgede olculen 3 kurali kilitler.
import { describe, it, expect } from 'vitest'
import { buildGasParams, withMargin } from './gas-estimate'

const base = { callGas: 100000n, baseFeePerGas: 1000n, priorityFeePerGas: 100n }

describe('withMargin', () => {
  it('yukari yuvarlar (asagi yuvarlamak op u zincirde dusurur)', () => {
    expect(withMargin(3n, 25)).toBe(4n)      // 3.75 -> 4
    expect(withMargin(100n, 25)).toBe(125n)
    expect(withMargin(0n, 25)).toBe(0n)
  })
  it('marj 0 degeri aynen birakir', () => {
    expect(withMargin(12345n, 0)).toBe(12345n)
  })
  it('negatif ya da ondalikli marj firlatir', () => {
    expect(() => withMargin(1n, -1)).toThrow()
    expect(() => withMargin(1n, 2.5)).toThrow()
  })
})

describe('buildGasParams', () => {
  it('capraz-zincirde paymasterPostOpGasLimit SIFIR', () => {
    // Remote paymaster'in postOp'u yok: context bos doner, EntryPoint onu hic cagirmaz.
    const g = buildGasParams({ ...base, crosschain: true })
    expect(g.paymasterPostOpGasLimit).toBe(0n)
  })
  it('ayni-zincirde postOp limiti 200000 + marj', () => {
    const g = buildGasParams({ ...base, crosschain: false })
    expect(g.paymasterPostOpGasLimit).toBe(250000n)
  })
  it('callGasLimit olculen degerin marjlisi', () => {
    expect(buildGasParams(base).callGasLimit).toBe(125000n)
  })
  it('maxFeePerGas = baseFee*2 + priority', () => {
    expect(buildGasParams(base).maxFeePerGas).toBe(2100n)
  })
  it('dogrulama limitleri belgedeki sabitlerin marjlisi', () => {
    const g = buildGasParams(base)
    expect(g.verificationGasLimit).toBe(375000n)
    expect(g.preVerificationGas).toBe(125000n)
    expect(g.paymasterVerificationGasLimit).toBe(250000n)
  })
})

import { describe, it, expect } from 'vitest'
import { isGaslessChain, GASLESS_CHAINS, SIMPLE_ACCOUNT_IMPL } from './gaslessConfig'

describe('gaslessConfig', () => {
  it('Base/Ethereum/Polygon gaslesss destekler', () => {
    expect(isGaslessChain(1)).toBe(true)
    expect(isGaslessChain(8453)).toBe(true)
    expect(isGaslessChain(137)).toBe(true)
  })
  it('Avalanche desteklemez', () => {
    expect(isGaslessChain(43114)).toBe(false)
  })
  it('string chainId ile de calisir', () => {
    expect(isGaslessChain('1')).toBe(true)
  })
  it('sabitler dogru', () => {
    expect(GASLESS_CHAINS).toEqual([1, 56, 8453, 10, 42161, 137])
    expect(SIMPLE_ACCOUNT_IMPL).toBe('0xe6Cae83BdE06E4c305530e199D7217f42808555B')
  })
})

import { describe, it, expect } from 'vitest'
import supported_chains from '../data/supported_chains.json'
import { getNativeSymbol, getNativeCoingeckoId } from './nativeChainInfo'

describe('native varlik bilgisi', () => {
  it('her zincirde nativeCoingeckoId dolu', () => {
    for (const chain of supported_chains) {
      expect(chain.nativeCoingeckoId, `chainId ${chain.chainId}`).toBeTruthy()
    }
  })

  it('sembol zincire gore degisir', () => {
    expect(getNativeSymbol(56)).toBe('BNB')
    expect(getNativeSymbol(137)).toBe('POL')
    expect(getNativeSymbol(1)).toBe('ETH')
  })

  it('CoinGecko kimligi zincire gore degisir', () => {
    expect(getNativeCoingeckoId(56)).toBe('binancecoin')
    expect(getNativeCoingeckoId(137)).toBe('polygon-ecosystem-token')
    expect(getNativeCoingeckoId(8453)).toBe('ethereum')
  })
})

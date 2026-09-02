import { describe, it, expect } from 'vitest'
import { isDelegated, delegatedImplementation, filterGasTokens, getGasTokenOptions, estimateTokenGasFee } from './smartAccount'

describe('isDelegated', () => {
  it('7702 delegation designator true', () => {
    expect(isDelegated('0xef0100e6cae83bde06e4c305530e199d7217f42808555b')).toBe(true)
  })
  it('uppercase prefix da kabul', () => {
    expect(isDelegated('0xEF0100E6CAE83BDE06E4C305530E199D7217F42808555B')).toBe(true)
  })
  it('kod yoksa (0x) false', () => {
    expect(isDelegated('0x')).toBe(false)
  })
  it('null/undefined false', () => {
    expect(isDelegated(null)).toBe(false)
    expect(isDelegated(undefined)).toBe(false)
  })
  it('rastgele kontrat kodu false', () => {
    expect(isDelegated('0x60806040')).toBe(false)
  })

  it('#24: BASKA bir implementasyona delege edilmis EOA delege SAYILMAZ', () => {
    // Kullanici ayni EOA'yi once baska bir cuzdanin 7702 delegator'una yukseltmis
    // olabilir. Yalnizca 0xef0100 on ekine bakildiginda authorization imzalanmiyor,
    // bundler userOp'u YABANCI ABI'ye karsi simule ediyor ve gasless gonderim o
    // hesap icin kalici olarak basarisiz oluyordu.
    expect(isDelegated('0xef0100' + '11'.repeat(20))).toBe(false)
  })

  it('beklenen implementasyon acikca verilebilir', () => {
    const foreign = '0x' + '11'.repeat(20)
    expect(isDelegated('0xef0100' + '11'.repeat(20), foreign)).toBe(true)
  })

  it('eksik/bozuk implementasyon adresi false', () => {
    expect(isDelegated('0xef0100abcd')).toBe(false)
  })
})

describe('delegatedImplementation', () => {
  it('delege edilen adresi cikarir', () => {
    expect(delegatedImplementation('0xef0100e6cae83bde06e4c305530e199d7217f42808555b'))
      .toBe('0xe6cae83bde06e4c305530e199d7217f42808555b')
  })

  it('delege degilse null', () => {
    expect(delegatedImplementation('0x')).toBeNull()
    expect(delegatedImplementation('0x60806040')).toBeNull()
    expect(delegatedImplementation(null)).toBeNull()
  })
})

describe('filterGasTokens', () => {
  const supported = [
    { token: '0xAAA0000000000000000000000000000000000000', symbol: 'USDC', decimals: 6 },
    { token: '0xBBB0000000000000000000000000000000000000', symbol: 'USDT', decimals: 6 },
  ]
  it('yalnizca bakiyesi > 0 olan desteklenen tokenlari dondurur', () => {
    const held = [
      { address: '0xaaa0000000000000000000000000000000000000', balance: 12.5 },
      { address: '0xCCC0000000000000000000000000000000000000', balance: 99 },
    ]
    const out = filterGasTokens(supported, held)
    expect(out).toHaveLength(1)
    expect(out[0].symbol).toBe('USDC')
    expect(out[0].balance).toBe(12.5)
  })
  it('bakiye 0 olani eler', () => {
    const held = [{ address: '0xaaa0000000000000000000000000000000000000', balance: 0 }]
    expect(filterGasTokens(supported, held)).toHaveLength(0)
  })
})

describe('getGasTokenOptions', () => {
  // Aday token yoksa hicbir RPC/client kurmadan [] doner (yeni guard).
  it('aday token yoksa [] doner (ag cagrisi yapmaz)', async () => {
    expect(await getGasTokenOptions({ chainId: 1, rpcUrl: 'http://x', bundlerBase: 'http://y', address: '0x0', candidates: [] })).toEqual([])
    expect(await getGasTokenOptions({ chainId: 1, rpcUrl: 'http://x', bundlerBase: 'http://y', address: '0x0' })).toEqual([])
  })
})

describe('estimateTokenGasFee', () => {
  it('Pimlico formulunu uygular: ((userOpGas+postOpGas)*maxFeePerGas*exchangeRate)/1e18', () => {
    // userOpGas=500000, postOpGas=0, maxFeePerGas=1gwei(1e9), exchangeRate=2e18, decimals=18
    // raw = 500000 * 1e9 * 2e18 / 1e18 = 1e15 -> formatUnits(1e15,18) = 0.001
    const fee = estimateTokenGasFee({
      exchangeRate: 2000000000000000000n, postOpGas: 0n, maxFeePerGas: 1000000000n, decimals: 18,
    })
    expect(fee).toBeCloseTo(0.001, 12)
  })
  it('postOpGas hesaba katilir', () => {
    // userOpGas=500000, postOpGas=500000 -> toplam 1e6; raw = 1e6*1e9*1e18/1e18 = 1e15 -> 0.001
    const fee = estimateTokenGasFee({
      exchangeRate: 1000000000000000000n, postOpGas: 500000n, maxFeePerGas: 1000000000n, decimals: 18,
    })
    expect(fee).toBeCloseTo(0.001, 12)
  })
  it('maxFeePerGas veya exchangeRate yoksa null', () => {
    expect(estimateTokenGasFee({ exchangeRate: 1n, postOpGas: 0n, maxFeePerGas: 0n, decimals: 18 })).toBe(null)
    expect(estimateTokenGasFee({ exchangeRate: 0n, postOpGas: 0n, maxFeePerGas: 1n, decimals: 18 })).toBe(null)
  })
})

import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import {
  buildPathCandidates, DEFAULT_FEE_TIERS, feeTiersFor,
  v3RouterAbiFor, v3QuoterAbiFor, v3SwapParams, v3QuoteArgs, v3QuoteOut,
  MAX_POOL_SHARE_BPS, poolTooShallow, compoundPriceImpact, defaultGasLimit,
  V3_ROUTER_ABI_DEADLINE, V3_ROUTER_ABI_NO_DEADLINE,
} from './swapRoutes'

const W = '0x4200000000000000000000000000000000000006'
const USDC = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'
const DAI = '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'
const TOKEN = '0x1111111111111111111111111111111111111111'

describe('buildPathCandidates', () => {
  it('once direkt yol gelir', () => {
    const paths = buildPathCandidates(TOKEN, USDC, [W, USDC, DAI])
    expect(paths[0]).toEqual([TOKEN, USDC])
  })

  it('her ara token icin bir aday uretir', () => {
    const paths = buildPathCandidates(TOKEN, DAI, [W, USDC])
    expect(paths).toEqual([
      [TOKEN, DAI],
      [TOKEN, W, DAI],
      [TOKEN, USDC, DAI],
    ])
  })

  it('girdiye veya cikisa esit ara token elenir', () => {
    const paths = buildPathCandidates(W, USDC, [W, USDC, DAI])
    expect(paths).toEqual([
      [W, USDC],
      [W, DAI, USDC],
    ])
  })

  it('buyuk-kucuk harf farki eleme yapar', () => {
    const paths = buildPathCandidates(W.toLowerCase(), TOKEN, [W, USDC])
    expect(paths).toEqual([
      [W.toLowerCase(), TOKEN],
      [W.toLowerCase(), USDC, TOKEN],
    ])
  })

  it('ara token listesi bossa yalniz direkt yol', () => {
    expect(buildPathCandidates(TOKEN, USDC, [])).toEqual([[TOKEN, USDC]])
  })
})

describe('feeTiersFor', () => {
  it('alan yoksa varsayilan kademeler', () => {
    expect(feeTiersFor({ VERSION: 3 })).toEqual(DEFAULT_FEE_TIERS)
    expect(DEFAULT_FEE_TIERS).toEqual([100, 500, 3000, 10000])
  })

  it('alan varsa DEX kendi kademelerini verir', () => {
    expect(feeTiersFor({ FEE_TIERS: [100, 500, 2500, 10000] })).toEqual([100, 500, 2500, 10000])
  })
})

describe('V3 router varyanti', () => {
  it('deadline varyantinda struct deadline icerir', () => {
    const dex = { ROUTER_VARIANT: 'deadline' }
    expect(v3RouterAbiFor(dex)).toBe(V3_ROUTER_ABI_DEADLINE)
    const p = v3SwapParams(dex, {
      tokenIn: W, tokenOut: USDC, fee: 500, recipient: TOKEN,
      deadline: 1234, amountIn: 5n, amountOutMinimum: 4n,
    })
    expect(p.deadline).toBe(1234)
    expect(p.sqrtPriceLimitX96).toBe(0)
  })

  it('no-deadline varyantinda struct deadline ICERMEZ', () => {
    const dex = { ROUTER_VARIANT: 'no-deadline' }
    expect(v3RouterAbiFor(dex)).toBe(V3_ROUTER_ABI_NO_DEADLINE)
    const p = v3SwapParams(dex, {
      tokenIn: W, tokenOut: USDC, fee: 500, recipient: TOKEN,
      deadline: 1234, amountIn: 5n, amountOutMinimum: 4n,
    })
    expect('deadline' in p).toBe(false)
  })

  it('varyant belirtilmemisse deadline varsayilir (mevcut davranis)', () => {
    expect(v3RouterAbiFor({})).toBe(V3_ROUTER_ABI_DEADLINE)
  })
})

describe('V3 quoter surumu', () => {
  const fields = { tokenIn: W, tokenOut: USDC, fee: 500, amountIn: 7n }

  it('surum 1 duz argumanlarla cagrilir', () => {
    expect(v3QuoteArgs({ QUOTER_VERSION: 1 }, fields)).toEqual([W, USDC, 500, 7n, 0])
  })

  it('surum 2 tek struct ile cagrilir ve amountIn fee ONCESINDE gelir', () => {
    const args = v3QuoteArgs({ QUOTER_VERSION: 2 }, fields)
    expect(args).toHaveLength(1)
    expect(args[0]).toEqual({ tokenIn: W, tokenOut: USDC, amountIn: 7n, fee: 500, sqrtPriceLimitX96: 0 })
  })

  it('surum 1 ciktisi dogrudan, surum 2 ciktisi ilk alandir', () => {
    expect(v3QuoteOut({ QUOTER_VERSION: 1 }, 99n)).toBe(99n)
    expect(v3QuoteOut({ QUOTER_VERSION: 2 }, [99n, 0n, 0n, 0n])).toBe(99n)
  })

  it('quoter ABI surume gore secilir', () => {
    expect(v3QuoterAbiFor({ QUOTER_VERSION: 2 })).not.toBe(v3QuoterAbiFor({ QUOTER_VERSION: 1 }))
  })
})

describe('poolTooShallow', () => {
  it('varsayilan esik %2', () => {
    expect(MAX_POOL_SHARE_BPS).toBe(200)
  })

  it('esigin altindaki takas kabul edilir', () => {
    expect(poolTooShallow(1n, 1000n)).toBe(false)       // %0.1
    expect(poolTooShallow(20n, 1000n)).toBe(false)      // tam %2 — sinir dahil
  })

  it('esigi asan takas reddedilir', () => {
    expect(poolTooShallow(21n, 1000n)).toBe(true)       // %2.1
    expect(poolTooShallow(500n, 1000n)).toBe(true)      // %50
  })

  it('rezerv sifirsa reddedilir', () => {
    expect(poolTooShallow(1n, 0n)).toBe(true)
  })

  it('esik parametreyle degistirilebilir', () => {
    expect(poolTooShallow(50n, 1000n, 500)).toBe(false) // %5 esikte %5 takas
    expect(poolTooShallow(51n, 1000n, 500)).toBe(true)
  })
})

describe('compoundPriceImpact', () => {
  it('tek hop bugunku degerle ayni kalir', () => {
    expect(compoundPriceImpact([1.5])).toBeCloseTo(1.5, 10)
  })

  it('iki hop bilesik hesaplanir', () => {
    // 1 - (0.99 * 0.98) = 0.0298
    expect(compoundPriceImpact([1, 2])).toBeCloseTo(2.98, 10)
  })

  it('bos listede sifir', () => {
    expect(compoundPriceImpact([])).toBe(0)
  })

  it('tek hop degeri, cok hop degerinden kucuktur', () => {
    expect(compoundPriceImpact([1])).toBeLessThan(compoundPriceImpact([1, 1]))
  })

  it('sifir etkili hoplar sonucu degistirmez', () => {
    expect(compoundPriceImpact([2, 0])).toBeCloseTo(2, 10)
  })
})

describe('defaultGasLimit', () => {
  it('tek hop bugunku sabitlerle ayni', () => {
    expect(defaultGasLimit(2, 1)).toBe(350000n)
    expect(defaultGasLimit(3, 1)).toBe(400000n)
  })

  it('her ek hop limiti buyutur', () => {
    expect(defaultGasLimit(2, 2)).toBe(470000n)
    expect(defaultGasLimit(3, 2)).toBe(520000n)
  })
})

describe('V2 cok adimli encode', () => {
  const V2 = [
    'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
  ]

  it('uc elemanli yol calldata icinde aynen tasinir', () => {
    const iface = new ethers.Interface(V2)
    const path = [TOKEN, W, USDC]
    const data = iface.encodeFunctionData('swapExactTokensForTokens', [1n, 0n, path, TOKEN, 99])
    const decoded = iface.decodeFunctionData('swapExactTokensForTokens', data)
    expect([...decoded[2]]).toEqual(path)
  })
})

describe('V3 varyant selektorleri', () => {
  it('deadline varyanti 0x414bf389 kodlar', () => {
    expect(new ethers.Interface(V3_ROUTER_ABI_DEADLINE).getFunction('exactInputSingle').selector).toBe('0x414bf389')
  })

  it('no-deadline varyanti 0x04e45aaf kodlar', () => {
    expect(new ethers.Interface(V3_ROUTER_ABI_NO_DEADLINE).getFunction('exactInputSingle').selector).toBe('0x04e45aaf')
  })
})

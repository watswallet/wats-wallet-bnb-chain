// Odeme cipi logosu (Bolum 2, Gorev 8): stable'lar CoinGecko gorseliyle, native coin AGIN native logosuyla (TokenAvatar'in token'i).
import { describe, it, expect } from 'vitest'
import { LCX_PAY_TOKENS } from './lcx/payTokens'
import { tokenLogoSources } from './tokenLogoSources'
import { PAY_META, cgImage, payTokenForAvatar } from './payTokenMeta'

describe('payTokenForAvatar', () => {
  it('USDC / USDT: CoinGecko gorseli (mevcut davranis), native degil', () => {
    const usdc = LCX_PAY_TOKENS[8453][0]
    const t = payTokenForAvatar(usdc, 8453)
    expect(t).toMatchObject({ symbol: 'USDC', address: usdc.address, image: cgImage(PAY_META.USDC.large) })
    expect(t.native).toBeUndefined()
    expect(payTokenForAvatar(LCX_PAY_TOKENS[8453][1], 8453).image).toEqual(cgImage(PAY_META.USDT.large))
  })

  it('Gnosis USDC.e (PAY_META te yok): gorselsiz, adres ve sembol korunur', () => {
    const usdce = LCX_PAY_TOKENS[100][0]
    expect(payTokenForAvatar(usdce, 100)).toMatchObject({ symbol: 'USDC.e', address: usdce.address, image: null })
  })

  it.each(Object.keys(LCX_PAY_TOKENS).map(Number))('native (%i): native isaretli token, ilk kaynak agin paketli native logosu (bos degil)', (chainId) => {
    const native = LCX_PAY_TOKENS[chainId].find((t) => t.native)
    const t = payTokenForAvatar(native, chainId)
    expect(t).toMatchObject({ symbol: native.symbol, address: '0x0', native: true })
    const sources = tokenLogoSources(t, { chainId })
    expect(sources.length).toBeGreaterThan(0)
    expect(sources[0]).toMatch(/^\/(chains|tokens)\//) // paketli yerel dosya once
  })

  it('Base ETH: Ethereum logosu (L2 zincir logosu DEGIL), CoinGecko yedegi sonda', () => {
    const t = payTokenForAvatar(LCX_PAY_TOKENS[8453][2], 8453)
    const sources = tokenLogoSources(t, { chainId: 8453 })
    expect(sources[0]).toBe('/chains/1.png')
    expect(sources.some((s) => s.startsWith('https://coin-images.coingecko.com/'))).toBe(true)
  })

  it('native sembolu PAY_META ya da prototip anahtariyla karismaz', () => {
    const t = payTokenForAvatar({ symbol: 'constructor', address: '0x0', decimals: 18, native: true }, 1)
    expect(t.native).toBe(true)
    expect(t.symbol).toBe('constructor')
  })
})

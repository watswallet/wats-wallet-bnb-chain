import { describe, it, expect } from 'vitest'
import supportedChains from './supported_chains.json'
import { isEvm, isTon } from '../utils/chainKind'

// chainSlug tek bir yerde kullaniliyor: /getChainTokens govdesindeki `chain` alani
// (SearchTokens, SelectAssets, swapFrom, swapTo). Sunucu bu degeri Token.chain ile
// karsilastirir ve o alani seeder `data.asset_platform_id` olarak yazar
// (server/.js) — yani DEGERLER COINGECKO PLATFORM KIMLIKLERIDIR.
//
// Cuzdanin kendi slug'lari iki agda bu kimlikten AYRILIYORDU:
//   137 -> "polygon"  ama coingecko "polygon-pos"
//    10 -> "optimism" ama coingecko "optimistic-ethereum"
// Filtre hicbir kayda uymadigi icin Polygon ve Optimism'de token listesi BOS
// donuyordu ("bazi aglarda token listesi gelmiyor").
//
// Sunucu tarafinda alias tablosu (server/utils/chainTokens.js) her iki yazimi da
// kabul ediyor; bu test kaynaktaki degerin geri kaymasini engeller.
const COINGECKO_PLATFORM_ID = {
  1: 'ethereum',
  10: 'optimistic-ethereum',
  25: 'cronos',
  56: 'binance-smart-chain',
  100: 'xdai',
  137: 'polygon-pos',
  5000: 'mantle',
  8453: 'base',
  42161: 'arbitrum-one',
  42220: 'celo',
  // Solana'nin CoinGecko asset platform kimligi de 'solana'dir; kayittaki
  // chainSlug bununla birebir ayni deger secildi.
  'solana-mainnet': 'solana',
}

describe('desteklenen zincir slug lari', () => {
  it('her zincirin bos olmayan bir chainSlug u var', () => {
    for (const c of supportedChains) {
      expect(typeof c.chainSlug, `${c.chainId} chainSlug yok`).toBe('string')
      expect(c.chainSlug.trim().length, `${c.chainId} chainSlug bos`).toBeGreaterThan(0)
    }
  })

  it('EVM slug lari coingecko platform kimligiyle ayni', () => {
    // Slug bilgisi yalnizca EVM zincirlerinden geliyor. TON'un coingecko platformu var ama
    // COINGECKO_PLATFORM_ID tablosunda tanimli degil (TON'un kendi platform kimliği "the-open-network").
    // Bu test EVM zincirlerine odaklanır; TON mainnet slug'ı ayri test'te dogrulaniyor.
    for (const c of supportedChains) {
      if (!isEvm(c)) continue
      const expected = COINGECKO_PLATFORM_ID[c.chainId]
      expect(expected, `${c.chainId} icin beklenen platform kimligi tanimli degil`).toBeTruthy()
      expect(c.chainSlug, `${c.name} (${c.chainId}) yanlis slug`).toBe(expected)
    }
  })

  it('TON mainnet slug u coingecko platform kimligidir', () => {
    const ton = supportedChains.find((c) => Number(c.chainId) === -239)
    expect(ton, 'TON mainnet kaydi yok').toBeTruthy()
    expect(ton.chainSlug).toBe('the-open-network')
    expect(ton.nativeCoingeckoId).toBe('the-open-network')
    expect(ton.nativeCurrency.decimals).toBe(9)
    expect(ton.kind).toBe('ton')
  })

  it('iki ag ayni slug u paylasmaz', () => {
    const slugs = supportedChains.map((c) => c.chainSlug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})

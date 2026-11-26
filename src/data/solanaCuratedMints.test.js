import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { SOLANA_CURATED_MINTS, curatedMintInfo } from './solanaCuratedMints'

// Sunucu dosyasi CommonJS; istemci testinden createRequire ile okunur.
const require = createRequire(import.meta.url)
const { SPL_TOKENS } = require(fileURLToPath(new URL('../../../server/data/splTokens.js', import.meta.url)))

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

describe('solanaCuratedMints', () => {
  it('USDC mint adresi {symbol:USDC, decimals:6} dondurur', () => {
    expect(curatedMintInfo(USDC_MINT)).toEqual({ symbol: 'USDC', decimals: 6 })
  })

  it('kurasyonlu olmayan mint null dondurur', () => {
    expect(curatedMintInfo('So11111111111111111111111111111111111111112')).toBeNull()
    expect(curatedMintInfo('')).toBeNull()
    expect(curatedMintInfo(undefined)).toBeNull()
    expect(curatedMintInfo(null)).toBeNull()
  })

  it('harf degisince null dondurur (base58 harf kutusu duyarli, toLowerCase yok)', () => {
    expect(curatedMintInfo(USDC_MINT.toLowerCase())).toBeNull()
    expect(curatedMintInfo(USDC_MINT.toUpperCase())).toBeNull()
    expect(curatedMintInfo(USDC_MINT.slice(0, -1) + 'u')).toBeNull()
  })

  it('Object.prototype anahtarlari kurasyonlu sayilmaz', () => {
    expect(curatedMintInfo('constructor')).toBeNull()
    expect(curatedMintInfo('__proto__')).toBeNull()
    expect(curatedMintInfo('toString')).toBeNull()
  })

  it('tam 7 kayit var ve her kayitta yalniz symbol + decimals alani bulunur', () => {
    const mintler = Object.keys(SOLANA_CURATED_MINTS)
    expect(mintler).toHaveLength(7)
    for (const mint of mintler) {
      expect(Object.keys(SOLANA_CURATED_MINTS[mint]).sort()).toEqual(['decimals', 'symbol'])
    }
  })

  // final SU-4: tablo disari acik ve donduruksuzdu -- onay ekrani etiketinin TEK kaynagi
  // olan bu tabloyu calisma zamaninda degistirmek ("USDC" sembolunu baska bir mint'e
  // baglamak) mumkundu. Tablo ve her kayit dondurulur; ESM katidir, yazma TypeError atar.
  it('tablo ve her kayit dondurulmustur (calisma zamaninda degistirilemez)', () => {
    expect(Object.isFrozen(SOLANA_CURATED_MINTS)).toBe(true)
    for (const mint of Object.keys(SOLANA_CURATED_MINTS)) {
      expect(Object.isFrozen(SOLANA_CURATED_MINTS[mint])).toBe(true)
    }
    expect(() => { SOLANA_CURATED_MINTS[USDC_MINT].symbol = 'SAHTE' }).toThrow(TypeError)
    expect(() => { SOLANA_CURATED_MINTS.YeniMint1111111111111111111111111111111 = { symbol: 'X', decimals: 6 } }).toThrow(TypeError)
    expect(() => { delete SOLANA_CURATED_MINTS[USDC_MINT] }).toThrow(TypeError)
    expect(curatedMintInfo(USDC_MINT)).toEqual({ symbol: 'USDC', decimals: 6 })
  })

  it('curatedMintInfo donen nesne tabloya baglanmaz (degistirmek tabloyu etkilemez)', () => {
    const bilgi = curatedMintInfo(USDC_MINT)
    bilgi.symbol = 'SAHTE'
    expect(curatedMintInfo(USDC_MINT)).toEqual({ symbol: 'USDC', decimals: 6 })
  })

  it('sunucu server/data/splTokens.js ile mint/sembol/decimals birebir esit', () => {
    expect(SPL_TOKENS).toHaveLength(7)
    expect(Object.keys(SOLANA_CURATED_MINTS)).toHaveLength(SPL_TOKENS.length)
    for (const t of SPL_TOKENS) {
      expect(SOLANA_CURATED_MINTS[t.mint]).toEqual({ symbol: t.symbol, decimals: t.decimals })
      expect(curatedMintInfo(t.mint)).toEqual({ symbol: t.symbol, decimals: t.decimals })
    }
  })
})

import { describe, it, expect } from 'vitest'
import { bStockByAddress, isBStock, applyUiMultiplier, rawFromUiAmount, UI_MULTIPLIER_ONE } from './bstocks'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'

const GOOGLB = BSTOCKS.find((t) => t.symbol === 'GOOGLB')
const SAHTE = '0x3f46948c00000000000000000000000000000000'

describe('isBStock / bStockByAddress', () => {
  it('kayitli adresi bulur', () => {
    expect(isBStock(BSTOCKS_CHAIN_ID, GOOGLB.address)).toBe(true)
    expect(bStockByAddress(BSTOCKS_CHAIN_ID, GOOGLB.address)?.symbol).toBe('GOOGLB')
  })

  it('harf duyarsiz', () => {
    // imported_tokens checksum'li, sunucu kaydi kucuk harf olabiliyor.
    expect(isBStock(BSTOCKS_CHAIN_ID, GOOGLB.address.toLowerCase())).toBe(true)
    expect(isBStock(BSTOCKS_CHAIN_ID, GOOGLB.address.toUpperCase().replace('0X', '0x'))).toBe(true)
  })

  it('BASKA ZINCIRDE ayni adres bStock DEGIL', () => {
    // Adres benzersiz degil; baska bir zincirde baska bir varlik olabilir.
    expect(isBStock(1, GOOGLB.address)).toBe(false)
    expect(isBStock(137, GOOGLB.address)).toBe(false)
  })

  it('chainId dize olarak gelse de calisir', () => {
    // imported_tokens kova anahtarlari dize; Number.isFinite suzgeci var ama
    // her cagri yerinde degil.
    expect(isBStock('56', GOOGLB.address)).toBe(true)
  })

  it('kayitli OLMAYAN adres reddedilir (sahte token savunmasi)', () => {
    expect(isBStock(BSTOCKS_CHAIN_ID, SAHTE)).toBe(false)
    expect(bStockByAddress(BSTOCKS_CHAIN_ID, SAHTE)).toBeNull()
  })

  it('bos/tanimsiz girdide patlamaz', () => {
    expect(isBStock(BSTOCKS_CHAIN_ID, undefined)).toBe(false)
    expect(isBStock(BSTOCKS_CHAIN_ID, null)).toBe(false)
    expect(isBStock(BSTOCKS_CHAIN_ID, '')).toBe(false)
    expect(isBStock(undefined, GOOGLB.address)).toBe(false)
  })
})

describe('applyUiMultiplier', () => {
  it('1e18 carpani bakiyeyi DEGISTIRMEZ', () => {
    expect(applyUiMultiplier(1234n, UI_MULTIPLIER_ONE)).toBe(1234n)
  })

  it('gercek zincir degerini uygular (SPYB, 2026-09-18)', () => {
    // uiAmount = rawAmount * uiMultiplier / 1e18
    const raw = 10n ** 18n
    const mul = 1001729792036835231n
    expect(applyUiMultiplier(raw, mul)).toBe(mul)
  })

  it('carpan YOKSA bakiyeyi degistirmez', () => {
    // uiMultiplier() revert ederse 1e18 kabul edilir.
    expect(applyUiMultiplier(500n, null)).toBe(500n)
    expect(applyUiMultiplier(500n, undefined)).toBe(500n)
    expect(applyUiMultiplier(500n, 0n)).toBe(500n)
  })

  it('sifir bakiye sifir kalir', () => {
    expect(applyUiMultiplier(0n, 1001729792036835231n)).toBe(0n)
  })

  it('bolunme olcegindeki carpanda da dogru (4:1)', () => {
    // Hisse bolunmesinde carpan 4e18 olur; duz balanceOf kullanici varliginin
    // DORTTE BIRINI gosterirdi.
    expect(applyUiMultiplier(10n ** 18n, 4n * UI_MULTIPLIER_ONE)).toBe(4n * 10n ** 18n)
  })

  it('BigInt disi girdide patlamaz, girdiyi aynen doner', () => {
    expect(applyUiMultiplier(100n, 'bozuk')).toBe(100n)
  })
})

describe('rawFromUiAmount - BIRIM SINIRI', () => {
  const SPYB_MUL = 1001729792036835231n

  it('1e18 carpani miktari DEGISTIRMEZ', () => {
    expect(rawFromUiAmount(1234n, UI_MULTIPLIER_ONE)).toBe(1234n)
  })

  it('UI miktarini hama cevirir (applyUiMultiplier\'in tersi)', () => {
    const raw = 10n ** 18n
    const ui = applyUiMultiplier(raw, SPYB_MUL)
    expect(rawFromUiAmount(ui, SPYB_MUL)).toBe(raw)
  })

  it('GIDIS-DONUS ham bakiyeyi ASLA ASMAZ (MAX guvenligi)', () => {
    // MAX'in guvenliginin KANITI. Iki taraf da tabana yuvarladigi icin
    // sonuc <= baslangic. Asarsa islem zincirde revert eder.
    for (const raw of [1n, 7n, 999n, 10n ** 18n, 123456789012345678n, 10n ** 24n]) {
      for (const mul of [SPYB_MUL, 1000478058978107511n, 4n * UI_MULTIPLIER_ONE, UI_MULTIPLIER_ONE]) {
        const geriDonen = rawFromUiAmount(applyUiMultiplier(raw, mul), mul)
        expect(geriDonen <= raw).toBe(true)
      }
    }
  })

  it('carpan YOKSA miktari degistirmez', () => {
    expect(rawFromUiAmount(500n, null)).toBe(500n)
    expect(rawFromUiAmount(500n, undefined)).toBe(500n)
    expect(rawFromUiAmount(500n, 0n)).toBe(500n)
  })

  it('bolunme olceginde de dogru (4:1)', () => {
    // Carpan 4e18 iken kullanicinin gordugu 4 token, zincirde 1 tokendir.
    expect(rawFromUiAmount(4n * UI_MULTIPLIER_ONE, 4n * UI_MULTIPLIER_ONE)).toBe(UI_MULTIPLIER_ONE)
  })
})

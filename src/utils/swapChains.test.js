import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import supported_chains from '../data/supported_chains.json'
import { isEvm, TON_MAINNET_ID } from './chainKind'
import { CHAIN_CONFIG, getChainSwapConfig, getWrappedNative, getIntermediates, getDexes, isSwapSupported } from './swapChains'
import { SOLANA_CHAIN_ID } from './solana/constants'

describe('CHAIN_CONFIG butunlugu', () => {
  it('desteklenen her EVM zincir icin kayit var', () => {
    // CHAIN_CONFIG bir Uniswap tarzi DEX/router adres tablosudur, yani tanimi geregi
    // EVM'e ozgudur. Iki EVM disi zincir de bu tablonun DISINDA ve sebepleri AYRI:
    //   - TON: swap'i VAR (STON.fi) ama router SABIT DEGIL, her takasta teklif
    //     yanitindan gelir -- burada bir kaydi olmasi gerekmiyor.
    //   - Solana: kendi swap yolunu ileriki bir gorevde alacak (Task 2 brief:
    //     secilebilir ama bu katmana henuz baglanmadi).
    for (const chain of supported_chains.filter((c) => isEvm(c))) {
      expect(CHAIN_CONFIG[chain.chainId], `chainId ${chain.chainId} eksik`).toBeDefined()
    }
  })

  // Review Bulgu 4: EVM filtresinin karsiligi — iki zincirin de bu tablodan
  // BILEREK disarida oldugunu (unutma degil) kilitler.
  it('Solana icin swap desteklenmiyor (henuz baglanmadi)', () => {
    expect(isSwapSupported(SOLANA_CHAIN_ID)).toBe(false)
  })

  // DIKKAT: bu, "TON'da takas yok" DEMEK DEGILDIR. TON'da takas VARDIR ve kapisi
  // chainKind.chainSupportsFlow(FLOW.SWAP) icindeki TON dalidir; o dal BILEREK
  // isSwapSupported'a bakmaz. Buraya bir TON kaydi eklenirse iki gercek kaynak
  // dogar ve EVM quoter yolu TON'da calistirilmaya kalkisilir.
  it('TON bu EVM router tablosunda YOK (kendi motoru STON.fi)', () => {
    expect(isSwapSupported(TON_MAINNET_ID)).toBe(false)
  })

  it('tum adresler EIP-55 checksum biciminde', () => {
    for (const [id, cfg] of Object.entries(CHAIN_CONFIG)) {
      const addresses = [cfg.wrappedNative, ...cfg.intermediates]
      for (const d of cfg.dexes) {
        addresses.push(d.ROUTER_ADDRESS, d.FACTORY_ADDRESS)
        if (d.QUOTER_ADDRESS) addresses.push(d.QUOTER_ADDRESS)
      }
      for (const a of addresses) {
        expect(ethers.getAddress(a), `${id}: ${a} checksum degil`).toBe(a)
      }
    }
  })

  it('intermediates bos degil ve ilk eleman wrappedNative', () => {
    for (const [id, cfg] of Object.entries(CHAIN_CONFIG)) {
      expect(cfg.intermediates.length, `${id}: intermediates bos`).toBeGreaterThan(0)
      expect(cfg.intermediates[0]).toBe(cfg.wrappedNative)
    }
  })

  it('intermediates mukerrer icermez', () => {
    for (const [id, cfg] of Object.entries(CHAIN_CONFIG)) {
      const lower = cfg.intermediates.map(a => a.toLowerCase())
      expect(new Set(lower).size, `${id}: mukerrer ara token`).toBe(lower.length)
    }
  })

  it('her zincirde en az bir DEX var', () => {
    for (const [id, cfg] of Object.entries(CHAIN_CONFIG)) {
      expect(cfg.dexes.length, `${id}: DEX yok`).toBeGreaterThan(0)
    }
  })

  it('her V2 kaydi FEE tasir (baz puan)', () => {
    for (const [id, cfg] of Object.entries(CHAIN_CONFIG)) {
      for (const d of cfg.dexes.filter(d => d.VERSION === 2)) {
        expect(typeof d.FEE, `${id}/${d.NAME}: FEE yok`).toBe('number')
        expect(d.FEE).toBeGreaterThan(0)
        expect(d.FEE).toBeLessThan(100)
      }
    }
  })

  it('her V3 kaydi quoter, quoter surumu ve router varyanti tasir', () => {
    for (const [id, cfg] of Object.entries(CHAIN_CONFIG)) {
      for (const d of cfg.dexes.filter(d => d.VERSION === 3)) {
        expect(d.QUOTER_ADDRESS, `${id}/${d.NAME}: quoter yok`).toBeTruthy()
        expect([1, 2], `${id}/${d.NAME}: quoter surumu`).toContain(d.QUOTER_VERSION)
        expect(['deadline', 'no-deadline'], `${id}/${d.NAME}: router varyanti`).toContain(d.ROUTER_VARIANT)
      }
    }
  })

  it('DEX adlari zincir icinde benzersiz', () => {
    for (const [id, cfg] of Object.entries(CHAIN_CONFIG)) {
      const names = cfg.dexes.map(d => d.NAME)
      expect(new Set(names).size, `${id}: mukerrer DEX adi`).toBe(names.length)
    }
  })

  it('INIT_CODE_HASH yalnizca zincir 1 ve 56da (R8) — digerlerinde yok', () => {
    for (const [id, cfg] of Object.entries(CHAIN_CONFIG)) {
      const legacyChain = Number(id) === 1 || Number(id) === 56
      for (const d of cfg.dexes) {
        if (legacyChain) {
          expect(d.INIT_CODE_HASH, `${id}/${d.NAME}: INIT_CODE_HASH eksik`).toBeTruthy()
        } else {
          expect(d.INIT_CODE_HASH, `${id}/${d.NAME}: INIT_CODE_HASH olmamali`).toBeUndefined()
        }
      }
    }
  })
})

describe('arama fonksiyonlari', () => {
  it('getWrappedNative dogru adresi dondurur', () => {
    expect(getWrappedNative(56)).toBe('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c')
    expect(getWrappedNative(137)).toBe('0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270')
  })

  it('desteklenmeyen zincirde getChainSwapConfig hata verir', () => {
    expect(() => getChainSwapConfig(999999)).toThrow(/999999/)
  })

  it('isSwapSupported desteklenmeyen zincirde false', () => {
    expect(isSwapSupported(56)).toBe(true)
    expect(isSwapSupported(999999)).toBe(false)
  })

  it('getIntermediates ve getDexes kopya degil kaynak dondurur', () => {
    expect(getIntermediates(1)[0]).toBe(getWrappedNative(1))
    expect(getDexes(1).length).toBeGreaterThan(0)
  })
})

// docs/ats-komisyon-router-listesi.json ile CHAIN_CONFIG ayrisirsa BURASI kirmizi yanar.
//
// Manifesto backend'in komisyon siniflandirmasini besliyor: listede olmayan bir router'dan
// gecen swap sradan bir op sayilir ve komisyon SESSIZCE tahsil edilmez — zincirde hata da
// vermez. Yani ayrisma ancak gelir raporunda fark edilir; tek erken uyari bu test.
//
// Yeni DEX ekleyen kisi icin dogru hareket: `cd client && npm run routers:manifest`.
import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import supported_chains from '../data/supported_chains.json'
import { isEvm, TON_MAINNET_ID } from './chainKind'
import { CHAIN_CONFIG } from './swapChains'
import manifest from '../../../docs/ats-komisyon-router-listesi.json'
import { SOLANA_CHAIN_ID } from './solana/constants'

const expected = (dex) => ({
  dex: dex.NAME,
  version: dex.VERSION,
  router: dex.ROUTER_ADDRESS,
  factory: dex.FACTORY_ADDRESS,
})

describe('router manifestosu <-> CHAIN_CONFIG', () => {
  it('ayni zincir kumesi', () => {
    expect(Object.keys(manifest.zincirler).sort()).toEqual(Object.keys(CHAIN_CONFIG).sort())
  })

  it('her zincirde router listesi birebir ayni (sira dahil)', () => {
    for (const [chainId, cfg] of Object.entries(CHAIN_CONFIG)) {
      expect(manifest.zincirler[chainId].routers).toEqual(cfg.dexes.map(expected))
    }
  })

  it('ozet sayilar gercek icerikle tutuyor', () => {
    const routers = Object.values(manifest.zincirler).reduce((n, c) => n + c.routers.length, 0)
    expect(manifest.zincirSayisi).toBe(Object.keys(manifest.zincirler).length)
    expect(manifest.routerSayisi).toBe(routers)
  })
})

describe('manifesto kapsami', () => {
  // ATS ucret/komisyon sistemi yalnizca EVM zincirlerinde calisir. TON'un kendi komisyon
  // mekanizmasi var. Bir EVM agi swap'a acilip manifestoya girmezse komisyon o agda hic
  // toplanmaz — bu testin varlik sebebi tam olarak budur.
  it('desteklenen her EVM ag manifestoda var', () => {
    // Manifesto EVM DEX router'larini kapsar. Iki EVM disi zincirin de burada kaydi
    // yok: TON'un kendi komisyon mekanizmasi var (ve router'i sabit degil), Solana'da
    // ise AMM/router kavrami farkli (Jupiter vb.) ve ileriki bir gorevde ele alinacak.
    for (const c of supported_chains.filter((x) => isEvm(x))) {
      expect(manifest.zincirler[String(c.chainId)], `zincir ${c.chainId} eksik`).toBeTruthy()
    }
  })

  // Review Bulgu 4: EVM filtresinin karsiligi — iki zincir icin de manifestoda
  // BILEREK kayit olmadigini kilitler (unutma ile kasitli disleme karistirilmasin).
  // Anahtar tipine DIKKAT: JSON anahtarlari metindir; Solana'nin kimligi zaten
  // metin ('solana-mainnet'), TON'unki NEGATIF sayidir ve String()'e cevrilmelidir.
  it('Solana manifestoda YOK (henuz baglanmadi)', () => {
    expect(manifest.zincirler[SOLANA_CHAIN_ID]).toBeUndefined()
  })

  it('TON manifestoda YOK (kendi komisyon mekanizmasi var)', () => {
    expect(manifest.zincirler[String(TON_MAINNET_ID)]).toBeUndefined()
  })

  it('her zincirde en az bir router', () => {
    for (const [chainId, entry] of Object.entries(manifest.zincirler)) {
      expect(entry.routers.length, `zincir ${chainId} bos`).toBeGreaterThan(0)
    }
  })
})

describe('adres saglamligi', () => {
  // EIP-55 kasa hatasi ethers'in Contract'ini gecer ama ABI kodlayicisi gonderim aninda
  // reddeder (2026-08-09 canli olayi). Backend tarafinda ayni dizgi kucuk harfe cevrilerek
  // karsilastirilacak olsa da, bozuk kasa buraya girerse kaynagi da bozuk demektir.
  it('tum router ve factory adresleri checksum-dogru', () => {
    for (const [chainId, entry] of Object.entries(manifest.zincirler)) {
      for (const r of entry.routers) {
        expect(ethers.getAddress(r.router.toLowerCase()), `${chainId} ${r.dex} router`).toBe(r.router)
        expect(ethers.getAddress(r.factory.toLowerCase()), `${chainId} ${r.dex} factory`).toBe(r.factory)
      }
    }
  })

  it('bir zincir icinde ayni router iki kez gecmez', () => {
    for (const [chainId, entry] of Object.entries(manifest.zincirler)) {
      const seen = entry.routers.map((r) => r.router.toLowerCase())
      expect(new Set(seen).size, `zincir ${chainId} mukerrer router`).toBe(seen.length)
    }
  })

  // Eslesme (chainId, adres) CIFTI uzerinden yapilmali: duz bir adres kumesi, o router'in
  // bulunmadigi zincirlerde de eslesir. Bu test o gercegin kayitli kanitidir.
  it('ayni router adresi birden cok zincirde bulunabiliyor', () => {
    const byAddress = new Map()
    for (const [chainId, entry] of Object.entries(manifest.zincirler)) {
      for (const r of entry.routers) {
        const key = r.router.toLowerCase()
        byAddress.set(key, [...(byAddress.get(key) || []), chainId])
      }
    }
    const shared = [...byAddress.values()].filter((v) => v.length > 1)
    expect(shared.length).toBeGreaterThan(0)
  })
})

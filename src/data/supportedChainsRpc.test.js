import { describe, it, expect } from 'vitest'
import supportedChains from './supported_chains.json'
import { isEvm, isTon, isSolana } from '../utils/chainKind'

// Bu dosya yalnizca EVM'in ethers.JsonRpcProvider uclarini denetler. EVM DISI iki
// zincir tipinin de `rpc` listesi bilerek bostur ve bunun sebepleri AYRI:
//   - TON: istemci DOGRUDAN RPC kullanmaz, erisim kendi backend proxy'mizden gecer
//     ve toncenter anahtari sunucuda kalir.
//   - Solana: kaydin `rpc` ALANI HIC YOK (bkz. vm.js/rpcUrlsOf) -- boylece hicbir
//     ethers.JsonRpcProvider Solana icin acilamaz.
// Ikisi de asagida AYRI testlerle kilitli; buradaki filtre yalnizca EVM listesini
// ayirir. Kapi isEvm: TON kaydi `kind:'ton'`, Solana kaydi `vm:'solana'` tasir --
// tek bir alana bakan bir filtre otekini EVM sayardi.
const evmChains = supportedChains.filter((c) => isEvm(c))

// 2026-08-05 canli ariza: Arbitrum One'da basarili bir 7702 bootstrap islemi ekranda
// "ISLEM BASARISIZ ... islem sonucu dogrulanamadi (timeout)" olarak gorundu ve ATS
// transferi hic gonderilmedi. Sebep zincir ya da imza degil, RPC idi:
// *-rpc.publicnode.com uclari yuksek hacimli zincirlerde eth_getTransactionReceipt'i
// ucretli token arkasina almis:
//   {"code":-32602,"message":"Archive requests require a personal token..."}
// (42161, 8453 ve 56'da dogrulandi; 1, 10, 137, 100, 25, 5000, 42220'de makbuz calisiyor.)
//
// ethers v6 waitForTransaction bu hatayi YUTAR ve her blokta yeniden dener; sonuc
// TX_WAIT_TIMEOUT_MS sonunda code=TIMEOUT'tur. Yani zincirde BASARILI olan islem
// istemcide "dogrulanamadi" olur — hem ATS akisi (transfer atlanir) hem de normal
// islemler ("Transaction failed or dropped") bundan etkilenir.
//
// Cuzdan yalnizca rpc[0]'i kullanir (background.js `found.rpc[0].url`), bu yuzden
// listenin ilerisinde calisan bir uc bulunmasi kurtarmaz.
const RECEIPT_GATED_HOSTS = [
  'arbitrum-one-rpc.publicnode.com',
  'base-rpc.publicnode.com',
  'bsc-rpc.publicnode.com',
]

describe('desteklenen zincir RPC leri', () => {
  it('her EVM zincirinin en az bir https RPC si var', () => {
    expect(evmChains.length, 'EVM kaydi sayisi degisti').toBe(10)
    for (const c of evmChains) {
      expect(Array.isArray(c.rpc), `${c.chainId} rpc dizi degil`).toBe(true)
      expect(c.rpc.length, `${c.chainId} rpc bos`).toBeGreaterThan(0)
      for (const r of c.rpc) expect(r.url.startsWith('https://')).toBe(true)
    }
  })

  it('TON zincirlerinin rpc listesi BOS kalir', () => {
    const tonChains = supportedChains.filter((c) => isTon(c))
    expect(tonChains.length, 'TON kaydi yok').toBe(2)
    for (const c of tonChains) {
      expect(Array.isArray(c.rpc), `${c.chainId} rpc dizi degil`).toBe(true)
      // Buraya bir uc eklenirse toncenter API anahtari uzanti paketine gomulmus olur.
      expect(c.rpc.length, `${c.chainId} rpc dolu — anahtar sizabilir`).toBe(0)
    }
  })

  it('Solana kaydinda rpc ALANI HIC YOK', () => {
    const solana = supportedChains.filter((c) => isSolana(c))
    expect(solana.length, 'Solana kaydi yok').toBe(1)
    // BOS DIZI DE YETMEZ: rpcUrlsOf bos diziyi zaten bos donduruyor ama alanin
    // VAR olmasi, ileride birinin oraya bir uc yazmasini davet eder ve o uc
    // ethers.JsonRpcProvider'a beslenirse Solana JSON-RPC'si EVM istemcisiyle
    // konusturulmus olur (sessiz, anlasilmasi zor bir ariza).
    expect(solana[0].rpc, 'Solana kaydina rpc eklenmis').toBeUndefined()
  })

  it('makbuz vermeyen uclar HIC listelenmez', () => {
    for (const c of evmChains) {
      for (const r of c.rpc) {
        const host = new URL(r.url).host
        expect(RECEIPT_GATED_HOSTS, `${c.chainId} icin makbuz vermeyen RPC: ${r.url}`)
          .not.toContain(host)
      }
    }
  })
})

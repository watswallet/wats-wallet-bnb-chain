// useTokenBalance'in bStocks kolu. ethers ve chrome.storage saplaniyor;
// hicbir test RPC istemez.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'

const GOOGLB = BSTOCKS.find((t) => t.symbol === 'GOOGLB')
const DUZ_TOKEN = '0x1111111111111111111111111111111111111111'
const CUZDAN = '0x2222222222222222222222222222222222222222'

const cagrilar = vi.hoisted(() => ({ list: [] }))

vi.mock('ethers', () => {
  class Contract {
    constructor(address) { this.address = address }
    async balanceOf() { cagrilar.list.push('balanceOf'); return 10n ** 18n }
    async balanceOfUI() { cagrilar.list.push('balanceOfUI'); return 1000478058978107511n }
    async decimals() { return 18 }
  }
  return {
    ethers: {
      // nativeAsset.js modul yuklenirken ethers.ZeroAddress okuyor; saplamada
      // eksik olursa dosya hic import edilemez.
      ZeroAddress: '0x0000000000000000000000000000000000000000',
      JsonRpcProvider: class { async getCode() { return '0x60' } async getBalance() { return 0n } },
      Contract,
      formatUnits: (v, d) => (Number(v) / 10 ** Number(d)).toString(),
      formatEther: (v) => String(Number(v) / 1e18),
    },
  }
})

beforeEach(() => {
  cagrilar.list = []
  globalThis.chrome = { storage: { local: { get: async () => ({ pending_transactions: [] }) } } }
})

describe('useTokenBalance - bStocks carpani', () => {
  it('bStock icin balanceOfUI kullanilir, balanceOf DEGIL', async () => {
    const { useTokenBalance } = await import('./useTokenBalance')
    const bakiye = await useTokenBalance(CUZDAN, GOOGLB.address, 'http://rpc', BSTOCKS_CHAIN_ID)

    expect(cagrilar.list).toContain('balanceOfUI')
    expect(cagrilar.list).not.toContain('balanceOf')
    // Duz balanceOf 1.0 verirdi, yani EKSIK.
    expect(bakiye).toBeCloseTo(1.000478058978, 9)
  })

  it('bStock OLMAYAN token icin balanceOf kullanilir', async () => {
    const { useTokenBalance } = await import('./useTokenBalance')
    await useTokenBalance(CUZDAN, DUZ_TOKEN, 'http://rpc', BSTOCKS_CHAIN_ID)

    expect(cagrilar.list).toContain('balanceOf')
    expect(cagrilar.list).not.toContain('balanceOfUI')
  })

  it('BASKA ZINCIRDE ayni adres icin balanceOf kullanilir', async () => {
    const { useTokenBalance } = await import('./useTokenBalance')
    await useTokenBalance(CUZDAN, GOOGLB.address, 'http://rpc', 1)

    expect(cagrilar.list).toContain('balanceOf')
  })

  it('chainId verilmezse bStock kolu ACILMAZ (geriye donuk guvenli)', async () => {
    const { useTokenBalance } = await import('./useTokenBalance')
    await useTokenBalance(CUZDAN, GOOGLB.address, 'http://rpc')

    expect(cagrilar.list).toContain('balanceOf')
  })

  // Beacon yukseltmesi arayuzu kaldirirsa bakiye GIZLENMEZ: zincirdeki ham deger
  // gosterilir. "Bakiyeniz 0" demek, biraz eksik gostermekten cok daha kotudur.
  it('balanceOfUI revert ederse balanceOf a dusulur', async () => {
    const { useTokenBalance } = await import('./useTokenBalance')
    const { ethers } = await import('ethers')
    const orjinal = ethers.Contract.prototype.balanceOfUI
    ethers.Contract.prototype.balanceOfUI = async () => { throw new Error('execution reverted') }
    try {
      const bakiye = await useTokenBalance(CUZDAN, GOOGLB.address, 'http://rpc', BSTOCKS_CHAIN_ID)
      expect(cagrilar.list).toContain('balanceOf')
      expect(bakiye).toBeCloseTo(1, 9)
    } finally {
      ethers.Contract.prototype.balanceOfUI = orjinal
    }
  })

  // chainId dize gelirse (rota parametreleri ve depo kayitlari oyle tasiyor)
  // kol yine ACILMALI: isBStock Number() ile normalize ediyor.
  it('chainId dize ("56") gelse de bStock kolu acilir', async () => {
    const { useTokenBalance } = await import('./useTokenBalance')
    await useTokenBalance(CUZDAN, GOOGLB.address, 'http://rpc', String(BSTOCKS_CHAIN_ID))

    expect(cagrilar.list).toContain('balanceOfUI')
  })
})

// A-4 (nihai inceleme): Sat MAX / %100, useTokenBalance'in Number yuvarlamasi yuzunden gercek bakiyeyi
// goreli ~1e-16 ASABILIR (20000 rastgele 18-ondalikli bakiyede ~%45-48). Takas yolu ham tutari gercek bakiyeye
// SINIRLAR (yalniz kayan nokta gurultusu kadar: goreli <= 1e-12); gercek fazla (yetersiz bakiye) SINIRLANMAZ.
import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { MultiChainSwapManager } from './swap'
import { clampFloatDust } from './swapValidation'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const abiCoder = ethers.AbiCoder.defaultAbiCoder()
const SEL_BALANCE_OF = ethers.id('balanceOf(address)').slice(0, 10)
const SEL_UI_MULTIPLIER = ethers.id('uiMultiplier()').slice(0, 10)
const CIKIS = '0x55d398326f99059fF775485246999027B3197955'
const ROUTER = '0x9999999999999999999999999999999999999999'
const ALICI = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const DUZ = '0x1111111111111111111111111111111111111111'
const NVDAB = BSTOCKS.find((t) => t.symbol === 'NVDAB')
const V2_ROUTER_ABI = ['function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)']

describe('clampFloatDust', () => {
  const B = 4999999999999999999n
  it('kayan nokta gurultusu kadar fazla -> bakiyeye sinirlanir', () => {
    expect(clampFloatDust(5n * 10n ** 18n, B)).toBe(B)
  })
  it('bakiyeyi asmayan tutar DEGISMEZ', () => {
    expect(clampFloatDust(B - 1n, B)).toBe(B - 1n)
    expect(clampFloatDust(B, B)).toBe(B)
  })
  it('GERCEK fazla (goreli > 1e-12) sinirlanmaz: "yetersiz bakiye" kapisi calismaya devam eder', () => {
    const fazla = (B * 1001n) / 1000n
    expect(clampFloatDust(fazla, B)).toBe(fazla)
  })
  it('bakiye 0 / bigint degilse dokunmaz', () => {
    expect(clampFloatDust(5n, 0n)).toBe(5n)
    expect(clampFloatDust(5n, undefined)).toBe(5n)
    expect(clampFloatDust('5', 4n)).toBe('5')
  })
})

describe('buildSwapCalls - MAX gurultusu (ATS/gasless yolu)', () => {
  const kur = ({ girdi, mul = 10n ** 18n, bakiye }) => {
    const m = new MultiChainSwapManager('0x' + '1'.repeat(64), BSTOCKS_CHAIN_ID)
    m.isNativeToken = async () => false
    m.getTokenDecimals = async () => 18
    m.getWallet = () => ({ address: ALICI })
    m.getProvider = () => ({
      resolveName: async (n) => n,
      call: async (tx) => {
        const sel = (tx.data || '').slice(0, 10)
        if (sel === SEL_UI_MULTIPLIER) return abiCoder.encode(['uint256'], [mul])
        if (sel === SEL_BALANCE_OF) return abiCoder.encode(['uint256'], [bakiye])
        throw new Error(`beklenmeyen cagri: ${sel}`)
      },
    })
    m.findBestDexRoute = async () => ({
      dex: { NAME: 'TestV2', VERSION: 2, ROUTER_ADDRESS: ROUTER, FEE: 25 },
      outputAmount: 10n ** 18n, fee: null, path: [girdi, CIKIS],
    })
    return m
  }
  const amountInOf = (calls) =>
    new ethers.Interface(V2_ROUTER_ABI).parseTransaction({ data: calls[calls.length - 1].data }).args[0]

  it('duz token: MAX metni gercek bakiyeyi 1 wei asiyorsa tutar bakiyeye sinirlanir', async () => {
    const bakiye = 4999999999999999999n
    const m = kur({ girdi: DUZ, bakiye })
    const { calls } = await m.buildSwapCalls(DUZ, CIKIS, '5', '1')
    expect(amountInOf(calls)).toBe(bakiye)
  })

  it('bStock (carpan 1.00173): UI MAX ham bakiyeyi asiyorsa ham bakiyeye sinirlanir', async () => {
    const mul = 1001730000000000000n
    const ham = 1234567890123456789n
    const ui = (ham * mul) / 10n ** 18n
    // Number turu yuvarlamayi taklit: UI bakiyenin double karsiligi (yukari kayabilir)
    const metin = String(Number(ethers.formatUnits(ui, 18)))
    const m = kur({ girdi: NVDAB.address, mul, bakiye: ham })
    const { calls } = await m.buildSwapCalls(NVDAB.address, CIKIS, metin, '1')
    expect(amountInOf(calls) <= ham).toBe(true)
  })

  it('bakiyenin ALTINDAKI tutar degismez', async () => {
    const m = kur({ girdi: DUZ, bakiye: 10n ** 19n })
    const { calls } = await m.buildSwapCalls(DUZ, CIKIS, '5', '1')
    expect(amountInOf(calls)).toBe(5n * 10n ** 18n)
  })

  it('GERCEK yetersiz bakiye sinirlanmaz (tutar aynen gider; kapi baska yerde)', async () => {
    const m = kur({ girdi: DUZ, bakiye: 4n * 10n ** 18n })
    const { calls } = await m.buildSwapCalls(DUZ, CIKIS, '5', '1')
    expect(amountInOf(calls)).toBe(5n * 10n ** 18n)
  })

  it('bakiye okunamazsa eski davranis (tutar degismez, teklif olmez demez)', async () => {
    const m = kur({ girdi: DUZ, bakiye: 0n })
    m.getTokenBalance = async () => { throw new Error('rpc yok') }
    const { calls } = await m.buildSwapCalls(DUZ, CIKIS, '5', '1')
    expect(amountInOf(calls)).toBe(5n * 10n ** 18n)
  })
})

describe('executeSwap - bakiye kapisi gurultuyu sinirlar (kaynak)', () => {
  it('Insufficient balance kapisindan ONCE clampFloatDust', () => {
    const src = readFileSync(fileURLToPath(new URL('./swap.js', import.meta.url)), 'utf8')
    const i = src.indexOf('if (balance < amountIn) throw new Error(`Insufficient balance`)')
    expect(i).toBeGreaterThan(0)
    expect(src.slice(i - 400, i)).toMatch(/amountIn\s*=\s*clampFloatDust\(\s*amountIn\s*,\s*balance\s*\)/)
  })
})

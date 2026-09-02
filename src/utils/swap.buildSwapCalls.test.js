// buildSwapCalls, findBestDexRoute'un sectigi yolu ("path") router calldata'sina
// AYNEN tasimak zorunda. Motor cok adimli bir rota secebiliyor (bkz. Task 6); encode
// katmani bu yolu tekrar iki elemanli bir direkt yola indirgerse iki sonuctan biri
// olur: islem zincirde revert eder (router'a gonderilen yol havuzda yok) ya da takas,
// likidite esiginin az once reddettigi sig havuzda sessizce gerceklesir (bkz. Task 7
// brief). Bu dosya o regresyonu yakalamak icin var.
//
// executeSwap burada BILEREK test edilmiyor: agi imzalayip gonderiyor, onu test etmek
// icin provider/wallet/tx-response'u o kadar derine stub'lamak mock'u dogrulamis olur,
// kodu degil. buildSwapCalls (gasless/UserOp yolu) burada durustce test edilebilen
// yuzey — network'e sadece 4 metot uzerinden dokunuyor, hepsi burada override edildi.

import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { MultiChainSwapManager } from './swap'

const PRIVATE_KEY = '0x' + '1'.repeat(64)
const CHAIN_ID = 56 // BSC — supported_chains.json ve swapChains.js'te tanimli

const TOKEN_A = '0x1111111111111111111111111111111111111111'
const TOKEN_B = '0x2222222222222222222222222222222222222222'
const TOKEN_MID = '0x3333333333333333333333333333333333333333'
const ROUTER_ADDRESS = '0x9999999999999999999999999999999999999999'
const RECIPIENT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const V2_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
]

// buildSwapCalls agla YALNIZCA su dorduyle konusuyor: isNativeToken, getTokenDecimals,
// findBestDexRoute, getWallet. Hepsi burada stub'lanir; gercek MultiChainSwapManager
// constructor'i sadece degerleri saklar (bkz. swap.js:35), network cagrisi yapmaz.
function makeManager({
  path,
  outputAmount = 1000000000000000000n,
  chainId = CHAIN_ID,
  natives = [],
  dex = { NAME: 'TestDexV2', VERSION: 2, ROUTER_ADDRESS, FEE: 25 },
  fee = null,
  decimals = 18,
} = {}) {
  const manager = new MultiChainSwapManager(PRIVATE_KEY, chainId)

  const nativeSet = new Set(natives.map((t) => t.toLowerCase()))
  manager.isNativeToken = async (token) => nativeSet.has(String(token).toLowerCase())
  manager.getTokenDecimals = async () => decimals
  manager.getWallet = () => ({ address: RECIPIENT })
  manager.findBestDexRoute = async () => ({ dex, outputAmount, fee, path })

  return manager
}

// token->token bir cagriyla calisir: approve + swap, tam 2 call uretir; swap her zaman
// sonuncusu. Native taraf ya da V3 unwrap dallari burada devrede degil (isNativeToken
// hep false), yani calls[calls.length - 1] guvenle swap call'u.
function swapCallOf(calls) {
  return calls[calls.length - 1]
}

describe('buildSwapCalls - rota yolu encode katmanina degismeden gider', () => {
  it('uc elemanli (cok adimli) rota yolu calldata icinde AYNEN tasinir', async () => {
    const path = [TOKEN_A, TOKEN_MID, TOKEN_B]
    const manager = makeManager({ path })

    const { calls } = await manager.buildSwapCalls(TOKEN_A, TOKEN_B, '1', '1')
    const swapCall = swapCallOf(calls)

    expect(swapCall.to).toBe(ROUTER_ADDRESS)

    const iface = new ethers.Interface(V2_ROUTER_ABI)
    const decoded = iface.decodeFunctionData('swapExactTokensForTokens', swapCall.data)
    expect([...decoded[2]]).toEqual(path)
  })

  it('iki elemanli (direkt) rota yolu calldata icinde degismeden tasinir — regresyon', async () => {
    const path = [TOKEN_A, TOKEN_B]
    const manager = makeManager({ path })

    const { calls } = await manager.buildSwapCalls(TOKEN_A, TOKEN_B, '1', '1')
    const swapCall = swapCallOf(calls)

    const iface = new ethers.Interface(V2_ROUTER_ABI)
    const decoded = iface.decodeFunctionData('swapExactTokensForTokens', swapCall.data)
    expect([...decoded[2]]).toEqual(path)
  })

  it('V2 token->token rota swapExactTokensForTokens secicisiyle kodlanir', async () => {
    const path = [TOKEN_A, TOKEN_B]
    const manager = makeManager({ path })

    const { calls } = await manager.buildSwapCalls(TOKEN_A, TOKEN_B, '1', '1')
    const swapCall = swapCallOf(calls)

    const iface = new ethers.Interface(V2_ROUTER_ABI)
    const selector = iface.getFunction('swapExactTokensForTokens').selector
    // Selector kontrolu: bir sonraki degisiklik router varyantini (orn. FeeOnTransfer
    // varyantina) sessizce degistirirse burada yakalanir.
    expect(swapCall.data.slice(0, 10)).toBe(selector)
  })
})

// --- Celo: native varlik bir SARMALAYICI DEGIL, ERC20'nin kendisi -----------------
//
// Zincirden olculdu (2026-08-18): Ubeswap ve SushiSwap router'larinda
// swapExactETHForTokens / swapExactTokensForETH YOK, CELO token'inda withdraw(uint256)
// YOK. Quote yolu calisiyor (havuzlar gercek), yani hata ancak GONDERIMDE ortaya
// cikiyordu. nativeIsErc20 bayragi native tarafi duz token gibi isletir; bu blok
// bayragin uc etkisini de kilitler.
const CELO_CHAIN_ID = 42220
const CELO = '0x471EcE3750Da237f93B8E339c536989b8978a438' // hem native hem ERC20
const NATIVE = ethers.ZeroAddress

const V2_ETH_ABI = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
]

const selectorOf = (abi, name) => new ethers.Interface(abi).getFunction(name).selector

describe('buildSwapCalls - nativeIsErc20 zincirinde (Celo) native taraf duz token', () => {
  it('bayrak Celo icin acik, BSC icin kapali', () => {
    expect(makeManager({ path: [] , chainId: CELO_CHAIN_ID }).nativeIsErc20).toBe(true)
    expect(makeManager({ path: [] }).nativeIsErc20).toBe(false)
  })

  it('native GIRDI: swapExactTokensForTokens kodlanir, value tasinmaz', async () => {
    const manager = makeManager({
      path: [CELO, TOKEN_B], chainId: CELO_CHAIN_ID, natives: [NATIVE],
    })

    const { calls } = await manager.buildSwapCalls(NATIVE, TOKEN_B, '1', '1')
    const swapCall = swapCallOf(calls)

    expect(swapCall.data.slice(0, 10)).toBe(selectorOf(V2_ROUTER_ABI, 'swapExactTokensForTokens'))
    expect(swapCall.data.slice(0, 10)).not.toBe(selectorOf(V2_ETH_ABI, 'swapExactETHForTokens'))
    expect(swapCall.value).toBe(0n)
  })

  it('native GIRDI: approve adimi ATLANMAZ ve CELO token adresine gider', async () => {
    const manager = makeManager({
      path: [CELO, TOKEN_B], chainId: CELO_CHAIN_ID, natives: [NATIVE],
    })

    const { calls } = await manager.buildSwapCalls(NATIVE, TOKEN_B, '1', '1')

    // approve + swap = 2 call. Sifir adrese approve gonderilmemeli.
    expect(calls).toHaveLength(2)
    expect(calls[0].to).toBe(CELO)
    expect(calls[0].data.slice(0, 10)).toBe(
      new ethers.Interface(['function approve(address,uint256) returns (bool)']).getFunction('approve').selector
    )
  })

  it('native CIKTI: swapExactTokensForETH degil swapExactTokensForTokens kodlanir', async () => {
    const manager = makeManager({
      path: [TOKEN_A, CELO], chainId: CELO_CHAIN_ID, natives: [NATIVE],
    })

    const { calls } = await manager.buildSwapCalls(TOKEN_A, NATIVE, '1', '1')
    const swapCall = swapCallOf(calls)

    expect(swapCall.data.slice(0, 10)).toBe(selectorOf(V2_ROUTER_ABI, 'swapExactTokensForTokens'))
    expect(swapCall.data.slice(0, 10)).not.toBe(selectorOf(V2_ETH_ABI, 'swapExactTokensForETH'))
  })

  it('V3 + native CIKTI: withdraw() unwrap call\'u URETILMEZ', async () => {
    const manager = makeManager({
      path: [TOKEN_A, CELO], chainId: CELO_CHAIN_ID, natives: [NATIVE], fee: 500,
      dex: { NAME: 'TestDexV3', VERSION: 3, ROUTER_ADDRESS, ROUTER_VARIANT: 'no-deadline' },
    })

    const { calls, meta } = await manager.buildSwapCalls(TOKEN_A, NATIVE, '1', '1')

    // approve + swap = 2; ucuncu bir call (withdraw) OLMAMALI.
    expect(calls).toHaveLength(2)
    expect(calls.some((c) => c.to === CELO && c.data.startsWith(
      new ethers.Interface(['function withdraw(uint256)']).getFunction('withdraw').selector
    ))).toBe(false)
    expect(meta.unwrappedAmount).toBeNull()
  })
})

describe('buildSwapCalls - sarmalayicili zincirde (BSC) davranis DEGISMEZ', () => {
  const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'

  it('native GIRDI hala swapExactETHForTokens + value', async () => {
    const manager = makeManager({ path: [WBNB, TOKEN_B], natives: [NATIVE] })

    const { calls } = await manager.buildSwapCalls(NATIVE, TOKEN_B, '1', '1')
    const swapCall = swapCallOf(calls)

    expect(swapCall.data.slice(0, 10)).toBe(selectorOf(V2_ETH_ABI, 'swapExactETHForTokens'))
    expect(swapCall.value).toBe(ethers.parseUnits('1', 18))
    // Native girdide approve YOK: tek call uretilir.
    expect(calls).toHaveLength(1)
  })

  it('V3 + native CIKTI hala withdraw() unwrap call\'u uretir', async () => {
    const manager = makeManager({
      path: [TOKEN_A, WBNB], natives: [NATIVE], fee: 500,
      dex: { NAME: 'TestDexV3', VERSION: 3, ROUTER_ADDRESS, ROUTER_VARIANT: 'deadline' },
    })

    const { calls, meta } = await manager.buildSwapCalls(TOKEN_A, NATIVE, '1', '1')

    expect(calls).toHaveLength(3) // approve + swap + withdraw
    expect(calls[2].to).toBe(WBNB)
    expect(meta.unwrappedAmount).not.toBeNull()
  })
})

// --- V3 gonderim yuzeyi da ROTADAN okur ------------------------------------------
//
// estimateSwapGas zaten path[0] / path[path.length - 1] kullaniyordu; buildSwapCalls ve
// executeSwap ise actualInput / actualOutput okuyordu. Bugun V3 tek hop oldugu icin
// ikisi ayni; Faz 2'de exactInput cok adima acildiginda gonderim yuzeyi SESSIZCE
// direkt cifti kodlamaya devam ederdi. Asagidaki rota bilerek istenen ciftten
// ayrilir — tek amaci "hangi kaynaktan okuyor" sorusunu ayirt etmek.
describe('buildSwapCalls - V3 struct tokenIn/tokenOut rotadan gelir', () => {
  const V3_ABI = [
    'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  ]

  it('rota ucu istenen cikis tokeninden farkliysa calldata ROTAYI tasir', async () => {
    const manager = makeManager({
      path: [TOKEN_A, TOKEN_MID], fee: 500,
      dex: { NAME: 'TestDexV3', VERSION: 3, ROUTER_ADDRESS, ROUTER_VARIANT: 'deadline' },
    })

    const { calls } = await manager.buildSwapCalls(TOKEN_A, TOKEN_B, '1', '1')
    const decoded = new ethers.Interface(V3_ABI).decodeFunctionData('exactInputSingle', swapCallOf(calls).data)

    expect(decoded[0].tokenIn).toBe(TOKEN_A)
    expect(decoded[0].tokenOut).toBe(TOKEN_MID) // path'in ucu; TOKEN_B DEGIL
  })
})

// #? Canli hata: "getExpectedOutput error: too many decimals for format
// (value=2148417.315917383879423141)". Motor miktari dogrudan parseUnits'e veriyordu;
// token'in tasidigindan fazla ondalik NUMERIC_FAULT firlatiyor ve hata teklifi
// tamamen olduruyordu — kullanici hicbir fiyat goremiyordu. Iki yoldan doguyor:
// MAX dugmesi (toFixed(18) buyuk bakiyelerde float gurultusunu basamak olarak yazar)
// ve kullanicinin elle fazla ondalik yazmasi.
describe('buildSwapCalls - token hassasiyetini asan miktar teklifi oldurmez', () => {
  const V2 = new ethers.Interface(V2_ROUTER_ABI)
  const amountInOf = (calls) =>
    V2.decodeFunctionData('swapExactTokensForTokens', swapCallOf(calls).data)[0]

  it('6 haneli tokenda fazla ondalik PATLAMAZ, kesilir', async () => {
    const manager = makeManager({ path: [TOKEN_A, TOKEN_B], decimals: 6 })

    const { calls } = await manager.buildSwapCalls(TOKEN_A, TOKEN_B, '2148417.3159170001745224', '0.5')

    expect(amountInOf(calls)).toBe(ethers.parseUnits('2148417.315917', 6))
  })

  it('elle yazilan fazla ondalik da kabul edilir', async () => {
    const manager = makeManager({ path: [TOKEN_A, TOKEN_B], decimals: 6 })

    const { calls } = await manager.buildSwapCalls(TOKEN_A, TOKEN_B, '1.1234567', '0.5')

    expect(amountInOf(calls)).toBe(ethers.parseUnits('1.123456', 6))
  })

  it('YUVARLAMAZ, keser — MAX bakiyeyi asamaz', async () => {
    const manager = makeManager({ path: [TOKEN_A, TOKEN_B], decimals: 6 })

    const { calls } = await manager.buildSwapCalls(TOKEN_A, TOKEN_B, '9.9999999', '0.5')

    // Yuvarlansaydi 10.0 olurdu ve bakiyeyi asardi.
    expect(amountInOf(calls)).toBe(ethers.parseUnits('9.999999', 6))
  })

  it('hassasiyete uyan miktar hic degismez', async () => {
    const manager = makeManager({ path: [TOKEN_A, TOKEN_B], decimals: 6 })

    const { calls } = await manager.buildSwapCalls(TOKEN_A, TOKEN_B, '2.5', '0.5')

    expect(amountInOf(calls)).toBe(ethers.parseUnits('2.5', 6))
  })
})

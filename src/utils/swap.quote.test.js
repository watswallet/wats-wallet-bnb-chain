// Teklif yolunun AG'SIZ testleri: findBestDexRoute'un aday eleme kararlari ve
// getExpectedOutput'un fiyat etkisi dongusu.
//
// Bu iki yuzey bugune kadar hic kapsanmamisti; ikisi de kullaniciya gosterilen
// rakami ve hata metnini belirliyor. Stub tekniği swap.buildSwapCalls.test.js ile
// AYNI: gercek MultiChainSwapManager kurulur (constructor ag cagrisi yapmaz) ve
// network'e dokunan metotlar ornek uzerinde override edilir. Hicbir test RPC
// istemez.

import { describe, it, expect, vi } from 'vitest'
import { MultiChainSwapManager } from './swap'
import { LIQUIDITY_GATE_ERROR, NO_ROUTE_ERROR } from './swapRoutes'

const PRIVATE_KEY = '0x' + '1'.repeat(64)
const CHAIN_ID = 56

const TOKEN_A = '0x1111111111111111111111111111111111111111'
const TOKEN_B = '0x2222222222222222222222222222222222222222'
const TOKEN_MID = '0x3333333333333333333333333333333333333333'
const OTHER = '0x4444444444444444444444444444444444444444'
const ROUTER_ADDRESS = '0x9999999999999999999999999999999999999999'

const V2_DEX = { NAME: 'TestV2', VERSION: 2, ROUTER_ADDRESS, FEE: 30 }
const V3_DEX = { NAME: 'TestV3', VERSION: 3, ROUTER_ADDRESS, QUOTER_VERSION: 1, FEE_TIERS: [500] }

// --- findBestDexRoute -------------------------------------------------------------

// intermediates BOSALTILIR: aday sayisini bire indirip testin ne olcttugunu tek
// degiskene baglar (gercek BSC config'i uc ara token tasiyor).
function routeManager({ dexes, v2Quote }) {
  const manager = new MultiChainSwapManager(PRIVATE_KEY, CHAIN_ID)
  manager.intermediates = []
  manager.getDexRouters = () => dexes
  if (v2Quote) manager.quoteV2Path = v2Quote
  return manager
}

// V3 quoter yuzeyi: findBestDexRoute yalnizca quoteExactInputSingle.staticCall cagirir.
const quoterReturning = (amountOut) => ({
  quoteExactInputSingle: { staticCall: async () => amountOut },
})

describe('findBestDexRoute - esikle elenen aday "havuz yok"tan ayirt edilir', () => {
  it('tek aday esikle elenirse MIKTAR hatasi firlatir, "rota yok" degil', async () => {
    const manager = routeManager({
      dexes: [V2_DEX],
      v2Quote: async () => ({ tooShallow: true }),
    })

    await expect(manager.findBestDexRoute(TOKEN_A, TOKEN_B, 10n))
      .rejects.toThrow(LIQUIDITY_GATE_ERROR)
  })

  it('havuz gercekten yoksa eski "rota yok" hatasi korunur', async () => {
    const manager = routeManager({
      dexes: [V2_DEX],
      v2Quote: async () => null,
    })

    await expect(manager.findBestDexRoute(TOKEN_A, TOKEN_B, 10n))
      .rejects.toThrow(NO_ROUTE_ERROR)
  })

  it('iki hata metni birbirinden FARKLI (ayirt edilebilirligin kendisi)', () => {
    expect(LIQUIDITY_GATE_ERROR).not.toBe(NO_ROUTE_ERROR)
  })

  it('kazanan aday varken esikle elenen bir baska aday hata URETMEZ', async () => {
    const manager = routeManager({
      dexes: [V2_DEX],
      v2Quote: async (dex, path) =>
        path.length === 2 ? { amountOut: 500n, pools: [] } : { tooShallow: true },
    })

    const route = await manager.findBestDexRoute(TOKEN_A, TOKEN_B, 10n)
    expect(route.outputAmount).toBe(500n)
  })
})

describe('findBestDexRoute - V2 tamamen esikle elenip V3 kazandiginda bayrak', () => {
  it('V2 elendi + V3 hayatta => v2DepthRejected true', async () => {
    const manager = routeManager({
      dexes: [V2_DEX, { ...V3_DEX, quoterContract: quoterReturning(900n) }],
      v2Quote: async () => ({ tooShallow: true }),
    })

    const route = await manager.findBestDexRoute(TOKEN_A, TOKEN_B, 10n)
    expect(route.dex.VERSION).toBe(3)
    expect(route.v2DepthRejected).toBe(true)
  })

  it('V2 aday hayattaysa bayrak KALKMAZ (V3 kazansa bile)', async () => {
    const manager = routeManager({
      dexes: [V2_DEX, { ...V3_DEX, quoterContract: quoterReturning(900n) }],
      v2Quote: async () => ({ amountOut: 100n, pools: [] }),
    })

    const route = await manager.findBestDexRoute(TOKEN_A, TOKEN_B, 10n)
    expect(route.dex.VERSION).toBe(3) // V3 daha yuksek teklif verdi
    expect(route.v2DepthRejected).toBe(false)
  })

  it('hicbir aday elenmediyse bayrak false', async () => {
    const manager = routeManager({
      dexes: [V2_DEX],
      v2Quote: async () => ({ amountOut: 100n, pools: [] }),
    })

    const route = await manager.findBestDexRoute(TOKEN_A, TOKEN_B, 10n)
    expect(route.v2DepthRejected).toBe(false)
  })
})

// --- getExpectedOutput: fiyat etkisi donqusu --------------------------------------

const pool = (token0, token1, r0, r1) => ({ reserves: [r0, r1, 0], token0, token1 })

function quoteManager({ route, pairAddress }) {
  const manager = new MultiChainSwapManager(PRIVATE_KEY, CHAIN_ID)

  manager.getProvider = () => ({}) // dongude yalniz ethers.Contract'a gecirilir
  manager.isNativeToken = async () => false
  manager.getTokenDecimals = async () => 18
  manager.findBestDexRoute = async () => route
  manager.estimateSwapGas = async () => ({ totalCostFormatted: '0.001 BNB' })
  manager.getPairAddress = pairAddress ?? vi.fn(async () => {
    throw new Error('getPairAddress cagrilmamaliydi')
  })

  return manager
}

describe('getExpectedOutput - fiyat etkisi hop dongusu', () => {
  it('tek hop: etki rezerv orani uzerinden hesaplanir', async () => {
    // 1 token girdi, 1000 token rezerv, %0.3 ucret:
    // amountInWithFee = 0.997, inputReserveAfter = 1000.997 -> %0.0996 -> "0.10"
    const manager = quoteManager({
      route: {
        dex: V2_DEX, outputAmount: 10n ** 18n, fee: null,
        path: [TOKEN_A, TOKEN_B],
        pools: [pool(TOKEN_A, TOKEN_B, 1000n * 10n ** 18n, 1000n * 10n ** 18n)],
      },
    })

    const quote = await manager.getExpectedOutput(TOKEN_A, TOKEN_B, '1', '0.5')
    expect(quote.priceImpact).toBe('0.10%')
  })

  it('cok adimli rota: her hop ayri hesaplanir ve bilesik birlestirilir', async () => {
    const manager = quoteManager({
      route: {
        dex: V2_DEX, outputAmount: 10n ** 18n, fee: null,
        path: [TOKEN_A, TOKEN_MID, TOKEN_B],
        pools: [
          pool(TOKEN_A, TOKEN_MID, 1000n * 10n ** 18n, 1000n * 10n ** 18n),
          pool(TOKEN_MID, TOKEN_B, 1000n * 10n ** 18n, 1000n * 10n ** 18n),
        ],
      },
    })

    const quote = await manager.getExpectedOutput(TOKEN_A, TOKEN_B, '1', '0.5')
    // Iki hop tek hop'un yaklasik iki kati etki uretir; tek hop 0.10 idi.
    expect(quote.priceImpact).toBe('0.20%')
    // Ucret de hop basina alinir: 2 x 30bps = %0.60
    expect(quote.liquidityProviderFee).toBe('0.60%')
  })

  it('girdi token1 ise rezerv yonu DOGRU secilir (ters secim baska sonuc verirdi)', async () => {
    // Havuzda token0 = TOKEN_B (rezerv 10), token1 = TOKEN_A (rezerv 1000).
    // Girdi TOKEN_A oldugu icin inputReserve 1000 olmali -> ~%0.10.
    // Yon ters secilseydi inputReserve 10 olur ve etki ~%9 cikardi.
    const manager = quoteManager({
      route: {
        dex: V2_DEX, outputAmount: 10n ** 18n, fee: null,
        path: [TOKEN_A, TOKEN_B],
        pools: [pool(TOKEN_B, TOKEN_A, 10n * 10n ** 18n, 1000n * 10n ** 18n)],
      },
    })

    const quote = await manager.getExpectedOutput(TOKEN_A, TOKEN_B, '1', '0.5')
    expect(quote.priceImpact).toBe('0.10%')
  })

  it('havuz beklenen cift degilse (pairMismatch) N/A basar, uydurma yuzde degil', async () => {
    const manager = quoteManager({
      route: {
        dex: V2_DEX, outputAmount: 10n ** 18n, fee: null,
        path: [TOKEN_A, TOKEN_B],
        pools: [pool(OTHER, TOKEN_B, 10n ** 18n, 10n ** 18n)],
      },
    })

    const quote = await manager.getExpectedOutput(TOKEN_A, TOKEN_B, '1', '0.5')
    expect(quote.priceImpact).toBe('N/A%')
    // Teklifin geri kalani AYAKTA: ucret hop sayisindan bilinir.
    expect(quote.liquidityProviderFee).toBe('0.30%')
  })

  it('rezervler rotayla geldiginde getPairAddress HIC cagrilmaz (RPC turu tasarrufu)', async () => {
    const getPairAddress = vi.fn(async () => ROUTER_ADDRESS)
    const manager = quoteManager({
      route: {
        dex: V2_DEX, outputAmount: 10n ** 18n, fee: null,
        path: [TOKEN_A, TOKEN_B],
        pools: [pool(TOKEN_A, TOKEN_B, 1000n * 10n ** 18n, 1000n * 10n ** 18n)],
      },
      pairAddress: getPairAddress,
    })

    await manager.getExpectedOutput(TOKEN_A, TOKEN_B, '1', '0.5')
    expect(getPairAddress).not.toHaveBeenCalled()
  })
})

describe('getExpectedOutput - fiyat etkisi patlarsa TEKLIF olmez (R19)', () => {
  it('rezerv okumasi hata verirse teklif doner ve priceImpact N/A olur', async () => {
    // pools YOK (eski rota / bayat aday) ve okuma yolu patliyor: eskiden bu, disaridaki
    // try'a dusup "getExpectedOutput error: ..." firlatiyor ve kullanici HIC fiyat
    // goremiyordu. Fiyat etkisi kozmetik tek alan; teklif ayakta kalmali.
    const manager = quoteManager({
      route: {
        dex: V2_DEX, outputAmount: 10n ** 18n, fee: null,
        path: [TOKEN_A, TOKEN_B],
      },
      pairAddress: vi.fn(async () => { throw new Error('Network Error: failed to fetch') }),
    })

    const quote = await manager.getExpectedOutput(TOKEN_A, TOKEN_B, '1', '0.5')
    expect(quote.priceImpact).toBe('N/A%')
    expect(quote.expectedOutput).toBe('1.0')
    expect(quote.exchangeRate).toBe('1.000000')
  })
})

describe('getExpectedOutput - derinlik esigi uyarisi arayuze tasinir (R20)', () => {
  it('V2 esikle elenip V3 kazandiginda depthGateWarning true', async () => {
    const manager = quoteManager({
      route: {
        dex: V3_DEX, outputAmount: 10n ** 18n, fee: 500,
        path: [TOKEN_A, TOKEN_B], v2DepthRejected: true,
      },
    })

    const quote = await manager.getExpectedOutput(TOKEN_A, TOKEN_B, '1', '0.5')
    expect(quote.depthGateWarning).toBe(true)
    // Bu rotada quoterContract stub'i YOK, yani prob alinamiyor ve N/A'ya dusuyor.
    // depthGateWarning'in var olma sebebi bu: V2 elendi, V3 olculemedi.
    expect(quote.priceImpact).toBe('N/A%')
  })

  it('V2 kazandiysa bayrak false (fiyat etkisi zaten hesaplanir)', async () => {
    const manager = quoteManager({
      route: {
        dex: V2_DEX, outputAmount: 10n ** 18n, fee: null,
        path: [TOKEN_A, TOKEN_B], v2DepthRejected: false,
        pools: [pool(TOKEN_A, TOKEN_B, 1000n * 10n ** 18n, 1000n * 10n ** 18n)],
      },
    })

    const quote = await manager.getExpectedOutput(TOKEN_A, TOKEN_B, '1', '0.5')
    expect(quote.depthGateWarning).toBe(false)
  })
})

// --- V3 fiyat etkisi: iki-miktarli prob ------------------------------------------

// QUOTER_VERSION 1 duz argumanlar alir: [tokenIn, tokenOut, fee, amountIn, 0].
// Prob testi amountIn'e DUYARLI olmak zorunda, yoksa iki kotasyon ayni cikar
// ve etki her zaman sifir olur.
const probingQuoterV1 = (outFor) => ({
  quoteExactInputSingle: { staticCall: async (_tIn, _tOut, _fee, amountIn) => outFor(amountIn) },
})

describe('getExpectedOutput - V3 fiyat etkisi iki-miktarli probla olculur', () => {
  it('dogrusal havuzda etki sifir', async () => {
    const manager = quoteManager({
      route: {
        dex: { ...V3_DEX, quoterContract: probingQuoterV1((amountIn) => amountIn) },
        outputAmount: 10n ** 18n, fee: 500,
        path: [TOKEN_A, TOKEN_B], v2DepthRejected: false,
      },
    })

    const quote = await manager.getExpectedOutput(TOKEN_A, TOKEN_B, '1', '0.5')
    expect(quote.priceImpact).toBe('0.00%')
  })

  it('sig havuzda gercek bir yuzde basar', async () => {
    // Prob (amountIn/100) dogrusal fiyat verir; gercek miktar %2 kotu doner.
    const E18 = 10n ** 18n
    const manager = quoteManager({
      route: {
        dex: { ...V3_DEX, quoterContract: probingQuoterV1((amountIn) => amountIn) },
        outputAmount: 98n * E18 / 100n, fee: 2500,
        path: [TOKEN_A, TOKEN_B], v2DepthRejected: false,
      },
    })

    const quote = await manager.getExpectedOutput(TOKEN_A, TOKEN_B, '1', '0.5')
    expect(quote.priceImpact).toBe('2.00%')
  })

  it('prob kotasyonu REVERT ederse teklif YASAR ve N/A basar', async () => {
    // R19: fiyat etkisi kozmetik tek bir alan; gecici bir RPC hatasi
    // kullaniciyi fiyatsiz birakmamali.
    const manager = quoteManager({
      route: {
        dex: {
          ...V3_DEX,
          quoterContract: { quoteExactInputSingle: { staticCall: async () => { throw new Error('execution reverted') } } },
        },
        outputAmount: 10n ** 18n, fee: 500,
        path: [TOKEN_A, TOKEN_B], v2DepthRejected: false,
      },
    })

    const quote = await manager.getExpectedOutput(TOKEN_A, TOKEN_B, '1', '0.5')
    expect(quote.priceImpact).toBe('N/A%')
    expect(quote.expectedOutput).toBe('1.0') // teklif hayatta
  })

  it('quoterContract hic yoksa N/A basar, patlamaz', async () => {
    const manager = quoteManager({
      route: {
        dex: { ...V3_DEX, quoterContract: null },
        outputAmount: 10n ** 18n, fee: 500,
        path: [TOKEN_A, TOKEN_B], v2DepthRejected: false,
      },
    })

    const quote = await manager.getExpectedOutput(TOKEN_A, TOKEN_B, '1', '0.5')
    expect(quote.priceImpact).toBe('N/A%')
  })

  it('prob SIFIRA dustugunde quoter HIC cagrilmaz', async () => {
    // BigInt bolmesi tabana yuvarlar. amountIn < V3_PROBE_DIVISOR ise prob 0 olur
    // ve QuoterV2 sifir girdide revert eder - hic sormamak dogrusu.
    const staticCall = vi.fn(async (_tIn, _tOut, _fee, amountIn) => amountIn)
    const manager = quoteManager({
      route: {
        dex: { ...V3_DEX, quoterContract: { quoteExactInputSingle: { staticCall } } },
        outputAmount: 50n, fee: 500,
        path: [TOKEN_A, TOKEN_B], v2DepthRejected: false,
      },
    })
    manager.getTokenDecimals = async () => 0 // 50 birim girdi, V3_PROBE_DIVISOR=100 -> prob 0

    const quote = await manager.getExpectedOutput(TOKEN_A, TOKEN_B, '50', '0.5')
    expect(staticCall).not.toHaveBeenCalled()
    expect(quote.priceImpact).toBe('N/A%')
  })
})

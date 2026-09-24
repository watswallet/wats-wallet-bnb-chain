import { Percent } from '@uniswap/sdk-core'
import { ethers } from 'ethers'
import ROUTER_V2_ABI from '../data/router_v2_ABI.json'
import supported_chains from '../data/supportedChains'
import { buildApprovePendingSkeleton, buildSwapPendingSkeleton, saveOrUpdateTxInStorage } from './processTransaction'
import { clampToDecimals } from './swapValidation'
import { getChainSwapConfig, getDexes, isNativeErc20 } from './swapChains'
import { getNativeCoingeckoId, getNativeSymbol } from './nativeChainInfo'
import { buildPathCandidates, compoundPriceImpact, defaultGasLimit, poolTooShallow, feeTiersFor, v3QuoteArgs, v3QuoteOut, v3QuoterAbiFor, v3RouterAbiFor, v3SwapParams, v3PriceImpact, V3_PROBE_DIVISOR, LIQUIDITY_GATE_ERROR, NO_ROUTE_ERROR } from './swapRoutes'
import { toRawSpendAmount } from './bstocksSpend'

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  // Bekleyen takas satirinin token adi icin: bu satir olmadan
  // buildSwapPendingSkeleton'a gercek sembol gecirilemez ve iskelet
  // 'INPUT'/'OUTPUT' yer tutucusuna duserdi (bkz. getTokenSymbol).
  "function symbol() view returns (string)"
]

const UNISWAP_V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)",
  // --- AŞAĞIDAKİLER EKLENDİ ---
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)", // BabyDoge için bu çok önemli!
  // -----------------------------
  "function factory() view returns (address)"
]

const UNISWAP_V2_FACTORY_ABI = ["function getPair(address, address) view returns (address)"]
const PAIR_ABI = [
  "function getReserves() view returns (uint112, uint112, uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
]  

export class MultiChainSwapManager {
  constructor(privateKey, chainId) {
    const found = supported_chains.find(chain => chain.chainId === chainId)
    if (!found) throw new Error("Unsupported chain")

    // Zincirin swap yapilandirmasi YOKSA burada patlar: ekran "sessizce bos rota"
    // yerine tasinabilir bir hata gorur.
    const swapConfig = getChainSwapConfig(chainId)

    this.chainId = chainId
    this.networkConfig = found
    this.privateKey = privateKey
    this.wrappedNative = swapConfig.wrappedNative
    // Celo'da native varlik ZATEN bir ERC20 (bkz. swapChains.js, 42220). O zincirde
    // wrappedNative bir sarmalayici degil, token'in kendisidir: ne wrap/unwrap vardir
    // ne de router'da ETH giris/cikis fonksiyonu. Bu bayrak native tarafi duz token
    // gibi isletir; olmadan quote calisir ama GONDERIM revert eder.
    this.nativeIsErc20 = isNativeErc20(chainId)
    this.intermediates = swapConfig.intermediates
    this.pairCache = new Map()
    this.tokenDecimalsCache = new Map()
    this.tokenSymbolCache = new Map()
    this.provider = null
  }

  // Ornek basina TEK provider: her cagrida yeni JsonRpcProvider olusturmak
  // ethers v6'nin ayni-tick eth_call'lari birkac HTTP istegine toplayan
  // batching'ini devre disi birakiyordu (bkz. R12). background.js manager'i
  // her quote icin yeniden kurdugu icin bayat provider riski yok.
  getProvider() {
    if (!this.provider) {
      this.provider = new ethers.JsonRpcProvider(this.networkConfig.rpc[0].url)
    }
    return this.provider
  }

  getWallet() {
    return new ethers.Wallet(this.privateKey, this.getProvider())
  }

  getDexRouters() {
    const provider = this.getProvider()
    const wallet = this.getWallet()
    
    return getDexes(this.chainId).map(dex => {
      let routerAbi, factoryAbi, quoterContract = null

      if (dex.VERSION === 3) {
        routerAbi = v3RouterAbiFor(dex)
        factoryAbi = []

        // V3 için quoter adresi kontrolü
        if (dex.QUOTER_ADDRESS) {
          quoterContract = new ethers.Contract(
            dex.QUOTER_ADDRESS,
            v3QuoterAbiFor(dex),
            provider
          )
        }
      } else {
        routerAbi = UNISWAP_V2_ROUTER_ABI
        factoryAbi = UNISWAP_V2_FACTORY_ABI
      }

      return {
        ...dex,
        routerContract: new ethers.Contract(
          dex.ROUTER_ADDRESS,
          routerAbi,
          wallet
        ),
        factoryContract: dex.FACTORY_ADDRESS ? new ethers.Contract(
          dex.FACTORY_ADDRESS,
          factoryAbi,
          provider
        ) : null,
        quoterContract
      }
    })
  }

// Token sembolu — getTokenDecimals ile AYNI desen (onbellek + zincir cagrisi +
// guvenli yedek), cunku ayni sinifta bir ihtiyac: bekleyen takas satirinin
// ekranda ne yazacagi.
//
// KOK NEDEN: cagiran taraf sembolu HIC cozmedigi icin buildSwapPendingSkeleton
// sabit 'INPUT'/'OUTPUT' yaziyordu ve kullanici takas onaylanana kadar
// aktivite listesinde "+120,5 OUTPUT" goruyordu.
//
// Cozulemeyen sembolde BOS dize doner, yer tutucu UYDURMAZ: birimsiz bir sayi
// durust, yanlis token adiyla yazilmis bir sayi yalandir. Basarisiz sonuc da
// onbelleklenir - her satir icin cevapsiz bir RPC'yi tekrar denemek anlamsiz.
async getTokenSymbol(tokenAddress) {
  if (await this.isNativeToken(tokenAddress)) {
    try {
      return getNativeSymbol(this.chainId) || ''
    } catch (error) {
      return ''
    }
  }

  if (this.tokenSymbolCache.has(tokenAddress)) return this.tokenSymbolCache.get(tokenAddress)

  let symbol = ''
  try {
    const provider = this.getProvider()
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
    const okunan = await tokenContract.symbol()
    symbol = typeof okunan === 'string' ? okunan.trim() : ''
  } catch (error) {
    console.warn(`Token symbol error (${tokenAddress}):`, error.message)
  }

  this.tokenSymbolCache.set(tokenAddress, symbol)
  return symbol
}

async getTokenDecimals(tokenAddress) {
  if (tokenAddress === ethers.ZeroAddress || tokenAddress === '0x0') return 18
  if (this.tokenDecimalsCache.has(tokenAddress)) return this.tokenDecimalsCache.get(tokenAddress)
  
  const knownTokenDecimals = this.getKnownTokenDecimals(tokenAddress.toLowerCase())
  if (knownTokenDecimals !== null) {
    this.tokenDecimalsCache.set(tokenAddress, knownTokenDecimals)
    return knownTokenDecimals
  }
  
  try {
    const provider = this.getProvider()
    const decimals = await this.tryMultipleDecimalsMethods(tokenAddress, provider)
    
    this.tokenDecimalsCache.set(tokenAddress, decimals)
    return decimals
    
  } catch (error) {
    console.error(`Token decimals error (${tokenAddress}):`, error.message)
    this.tokenDecimalsCache.set(tokenAddress, 18)
    return 18
  }
}

getKnownTokenDecimals(tokenAddress) {
  const knownTokens = {
    '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,  // USDT
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,  // USDC
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,  // WBTC
    
    // BSC
    '0x55d398326f99059ff775485246999027b3197955': 18, // USDT BSC
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 18, // USDC BSC
    '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd': 18, // ChainLink
    
    // Polygon
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 6,  // USDT Polygon
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 6,  // USDC Polygon
    
    // Diğer sorunlu tokenları buraya ekleyebilirsiniz
  }
  
  return knownTokens[tokenAddress] || null
}

// Çoklu method deneme fonksiyonu
async tryMultipleDecimalsMethods(tokenAddress, provider) {
  const methods = [
    // Method 1: Standart decimals()
    async () => {
      const contract = new ethers.Contract(tokenAddress, ['function decimals() view returns (uint8)'], provider)
      return await contract.decimals()
    },
    
    // Method 2: DECIMALS() (büyük harf)
    async () => {
      const contract = new ethers.Contract(tokenAddress, ['function DECIMALS() view returns (uint8)'], provider)
      return await contract.DECIMALS()
    },
    
    // Method 3: Decimals() (PascalCase)
    async () => {
      const contract = new ethers.Contract(tokenAddress, ['function Decimals() view returns (uint8)'], provider)
      return await contract.Decimals()
    },
    
    // Method 4: Manuel low-level call
    async () => {
      const decimalsSelector = '0x313ce567' // decimals() function selector
      const result = await provider.call({
        to: tokenAddress,
        data: decimalsSelector
      })
      
      if (result && result !== '0x' && result.length >= 66) {
        const decimals = parseInt(result, 16)
        if (decimals >= 0 && decimals <= 77) { // Makul decimal aralığı
          return decimals
        }
      }
      throw new Error('Invalid decimals result')
    },
    
    // Method 5: Hex parse denemesi
    async () => {
      const decimalsSelector = '0x313ce567'
      const result = await provider.call({
        to: tokenAddress,
        data: decimalsSelector
      })
      
      if (result && result !== '0x') {
        // Son 64 karakteri al (32 byte)
        const hexValue = result.slice(-64)
        const decimals = parseInt(hexValue, 16)
        
        if (decimals >= 0 && decimals <= 77) {
          return decimals
        }
      }
      throw new Error('Hex parse failed')
    }
  ]
  
  let lastError = null
  
  // Her methodu sırayla dene
  for (let i = 0; i < methods.length; i++) {
    try {
      const result = await methods[i]()
      const decimals = parseInt(result.toString())
      
      // Makul bir decimal değeri mi kontrol et
      if (decimals >= 0 && decimals <= 77) return decimals
    } catch (error) {
      lastError = error
      continue
    }
  }
  
  // Hiçbir method çalışmazsa hata fırlat
  throw lastError || new Error('All decimal methods failed')
}

// Batch işleme için yardımcı fonksiyon
async getTokenDecimalsBatch(tokenAddresses, batchSize = 5) {
  const results = new Map()
  
  for (let i = 0; i < tokenAddresses.length; i += batchSize) {
    const batch = tokenAddresses.slice(i, i + batchSize)
    
    const batchPromises = batch.map(async (address) => {
      try {
        const decimals = await this.getTokenDecimals(address)
        return { address, decimals, success: true }
      } catch (error) {
        return { address, decimals: 18, success: false, error: error.message }
      }
    })
    
    const batchResults = await Promise.allSettled(batchPromises)
    
    batchResults.forEach((result, index) => {
      const address = batch[index]
      if (result.status === 'fulfilled') {
        results.set(address, result.value)
      } else {
        results.set(address, { address, decimals: 18, success: false, error: result.reason })
      }
    })
    
    // Rate limiting için kısa bekleme
    if (i + batchSize < tokenAddresses.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  
  return results
}

// Cache temizleme fonksiyonu
clearTokenDecimalsCache() {
  this.tokenDecimalsCache.clear()
}

// Cache istatistikleri
getTokenDecimalsCacheStats() {
  return {
    size: this.tokenDecimalsCache.size,
    entries: Array.from(this.tokenDecimalsCache.entries())
  }
}

async getPairAddress(dex, tokenA, tokenB) {
  if (dex.VERSION !== 2 || !dex.factoryContract) return ethers.ZeroAddress;

  const cacheKey = `${dex.NAME}-${tokenA}-${tokenB}`;
  if (this.pairCache.has(cacheKey)) return this.pairCache.get(cacheKey);

  try {
    const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase() 
      ? [tokenA, tokenB] 
      : [tokenB, tokenA];

    // RPC isteği öncesi provider kontrolü
    const provider = this.getProvider();
    if (!provider) throw new Error("Provider not found");

    // 1. ADIM: Factory'den sorgula (Network isteği)
    let pairAddress = await dex.factoryContract.getPair(token0, token1).catch(() => ethers.ZeroAddress);
    
    // 2. ADIM: CREATE2 Hesabı (Eğer factory 0 dönerse ve hash varsa)
    if (pairAddress === ethers.ZeroAddress && dex.INIT_CODE_HASH) {
      pairAddress = ethers.getCreate2Address(
        dex.FACTORY_ADDRESS,
        ethers.keccak256(ethers.solidityPacked(["address", "address"], [token0, token1])),
        dex.INIT_CODE_HASH
      );
    }

    // 3. ADIM: Kod Kontrolü (Network isteği)
    if (pairAddress && pairAddress !== ethers.ZeroAddress) {
      // "Failed to fetch" genellikle burada patlar.
      const code = await provider.getCode(pairAddress).catch(err => {
          // Eğer ağ hatasıysa adresi ZeroAddress yapma, hatayı yukarı fırlat ki cache'lenmesin!
          throw new Error(`Network Error: ${err.message}`);
      });
      
      if (code === "0x") pairAddress = ethers.ZeroAddress;
    }

    // Başarılıysa cache'le
    this.pairCache.set(cacheKey, pairAddress);
    return pairAddress;

  } catch (error) {
    // KRİTİK: Eğer hata bir ağ hatasıysa (fetch hatası vb.) 
    // sonucu ASLA cache'e (pairCache) set etme! 
    // Aksi halde kullanıcı sayfayı yenileyene kadar düzelmez.
    console.warn(`getPairAddress Error [${dex.NAME}]:`, error.message);
    return ethers.ZeroAddress;
  }
}

  // Bir V2 yolunun her ardisik cifti icin: havuz var mi, rezerv sifir mi ve
  // o hop'un girdisi havuzun kaldirabileceginden buyuk mu.
  //
  // Donus:
  //   null                                -> aday yok (havuz yok, rezerv sifir, RPC hatasi,
  //                                          beklenmeyen cift). "Bu rota calismiyor."
  //   { tooShallow: true }                -> havuz VAR ve saglikli, miktar cok buyuk.
  //                                          Cagiran bunu ayri bir hata mesajina cevirir (R17).
  //   { amountOut, pools }                -> basarili. pools, hop basina okunan
  //                                          { reserves, token0, token1 } — getExpectedOutput
  //                                          fiyat etkisi icin AYNI verileri tekrar
  //                                          okumasin diye birlikte doner (bir RPC turu).
  async quoteV2Path(dex, path, amountIn) {
    const provider = this.getProvider()

    // Hop'lar arasi bagimlilik yok: cift adresleri paralel kesfedilir. Sirali
    // await hem gereksiz yavas hem de ayni-tick eth_call batching'ini bozardi.
    const pairAddresses = await Promise.all(
      path.slice(0, -1).map((token, i) => this.getPairAddress(dex, token, path[i + 1]))
    )
    if (pairAddresses.some((address) => address === ethers.ZeroAddress)) return null

    let pools
    try {
      pools = await Promise.all(pairAddresses.map(async (address) => {
        const pair = new ethers.Contract(address, PAIR_ABI, provider)
        const [reserves, token0, token1] = await Promise.all([pair.getReserves(), pair.token0(), pair.token1()])
        return { reserves, token0, token1 }
      }))
    } catch (error) {
      console.error(`Reserve check error (${dex.NAME}):`, error.message)
      return null
    }

    if (pools.some(({ reserves }) => reserves[0] === 0n || reserves[1] === 0n)) return null

    let amounts
    try {
      amounts = await dex.routerContract.getAmountsOut.staticCall(amountIn, path)
    } catch (error) {
      console.error(`getAmountsOut error (${dex.NAME}):`, error.message)
      return null
    }

    // Likidite esigi HER hop'ta, o hop'un GERCEK girdi miktariyla olculur:
    // amounts[i] hop i'nin girdisidir. Olu bir havuz bu kapidan gecemez.
    for (let i = 0; i < pools.length; i++) {
      const { reserves, token0, token1 } = pools[i]
      const inputIsToken0 = path[i].toLowerCase() === token0.toLowerCase()
      const inputIsToken1 = path[i].toLowerCase() === token1.toLowerCase()
      // Havuz beklenen cift degilse rezerv yonu TERSINE donerdi ve esik korumadan
      // cok zarar verirdi. Sessizce yanlis olmaktansa adayi ele.
      if (!inputIsToken0 && !inputIsToken1) return null
      const reserveIn = inputIsToken0 ? reserves[0] : reserves[1]
      // Havuz saglikli, sorun MIKTAR: bunu "havuz yok"tan ayirt edilebilir tut (R17).
      if (poolTooShallow(amounts[i], reserveIn)) return { tooShallow: true }
    }

    const out = amounts[amounts.length - 1]
    return out > 0n ? { amountOut: out, pools } : null
  }

  async findBestDexRoute(inputToken, outputToken, amountIn) {
    const dexRouters = this.getDexRouters()
    const candidates = buildPathCandidates(inputToken, outputToken, this.intermediates)

    const queries = []

    for (const dex of dexRouters) {
      if (dex.VERSION === 2) {
        // Her yol adayi ayri sorgulanir; en yuksek cikti kazanir.
        for (const path of candidates) {
          queries.push((async () => {
            try {
              const quote = await this.quoteV2Path(dex, path, amountIn)
              if (!quote) return null
              // Esikle elenen aday KAYBOLMAZ: "havuz yok" ile ayni sonuca dusmesin diye
              // isaretli olarak geri doner (R17).
              if (quote.tooShallow) return { gateRejected: true }
              return { dex, outputAmount: quote.amountOut, fee: null, path, pools: quote.pools }
            } catch (error) {
              console.error(`findBestDexRoute error (${dex.NAME}):`, error.message)
              return null
            }
          })())
        }
        continue
      }

      // V3 cok adim Faz 2'nin konusu: burada yalniz direkt yol sorulur.
      queries.push((async () => {
        try {
          if (!dex.quoterContract) return null

          // Kademeler DEX kaydindan gelir: PancakeSwap V3'un orta kademesi 2500,
          // Base'deki Uniswap'te 200 ve 400 de acik. Sabit liste bunlari kaciriyordu.
          const fees = feeTiersFor(dex)
          let bestAmountOut = 0n
          let bestFee = 0

          for (const fee of fees) {
            try {
              const raw = await dex.quoterContract.quoteExactInputSingle.staticCall(
                ...v3QuoteArgs(dex, { tokenIn: inputToken, tokenOut: outputToken, fee, amountIn })
              )
              const amountOut = v3QuoteOut(dex, raw)
              if (amountOut > bestAmountOut) {
                bestAmountOut = amountOut
                bestFee = fee
              }
            } catch {
              // Bu kademede likidite yok, devam et
              continue
            }
          }

          return bestAmountOut > 0n
            ? { dex, outputAmount: bestAmountOut, fee: bestFee, path: [inputToken, outputToken] }
            : null
        } catch (error) {
          console.error(`findBestDexRoute error (${dex.NAME}):`, error.message)
          return null
        }
      })())
    }

    const settled = (await Promise.all(queries)).filter(Boolean)
    const results = settled.filter((r) => r.outputAmount)
    // En az bir aday DERINLIK ESIGIYLE elendi mi? (havuz vardi, miktar buyuktu)
    const gateRejected = settled.some((r) => r.gateRejected)

    if (results.length === 0) {
      // Hicbir aday kalmadi. Sebep esikse kullaniciya bunu SOYLE: "rota yok" mesaji
      // cozumu (miktari kucult) gizliyordu ve iki farkli durum ayni metni uretiyordu.
      throw new Error(gateRejected ? LIQUIDITY_GATE_ERROR : NO_ROUTE_ERROR)
    }

    const best = results.reduce((best, current) =>
      current.outputAmount > best.outputAmount ? current : best
    )

    // R20: esik YALNIZ V2'yi tariyor. Buyuk bir takasta derin V2 rotasi elenip
    // taranmamis bir V3 rotasi kazandiginda fiyat etkisi 'N/A' basiliyor — yani
    // uyariya en cok ihtiyaci olan islem, uyari almayacagi garanti olan islem oluyor.
    // Bayrak arayuze bunu bir satirla soyleme imkani verir.
    const v2DepthRejected = gateRejected && !results.some((r) => r.dex.VERSION === 2)

    return { ...best, v2DepthRejected }
  }

  async optimizeGasParameters() {
    try {
      const provider = this.getProvider()
      const feeData = await provider.getFeeData()
      
      return {
        maxFeePerGas: feeData.maxFeePerGas ? feeData.maxFeePerGas : undefined,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? feeData.maxPriorityFeePerGas : undefined,
        gasLimit: this.networkConfig.DEFAULT_GAS_LIMIT
      }
    } catch (error) {
      console.warn("optimizeGasParameters error", error.message)
      return { gasLimit: this.networkConfig.DEFAULT_GAS_LIMIT }
    }
  }

  async isNativeToken(tokenAddress) {
    return tokenAddress === ethers.ZeroAddress || tokenAddress === '0x0'
  }

  async getTokenBalance(tokenAddress, address) {
    const provider = this.getProvider()
    
    if (await this.isNativeToken(tokenAddress)) {
      return provider.getBalance(address)
    }
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
    return tokenContract.balanceOf(address)
  }

  // Gonderimsiz: approve (gerekirse) + swap call'larini uretir. Gasless (UserOp) icin.
  async buildSwapCalls(inputToken, outputToken, amountHumanReadable, slippage) {
    const isInputNative = await this.isNativeToken(inputToken)
    const isOutputNative = await this.isNativeToken(outputToken)

    const inputDecimals = await this.getTokenDecimals(inputToken)
    // Token'in tasiyabileceginden fazla ondalik parseUnits'i NUMERIC_FAULT ile
    // patlatir ve hata tum teklifi oldurur. Fazlasi kesilir (yuvarlanmaz).
    // BIRIM SINIRI: `amountHumanReadable` KULLANICININ GORDUGU sayidir; bStock'ta
    // o sayi UI birimindedir (bkz. bstocksSpend.js). Router, approve ve bakiye
    // karsilastirmasi HAM birim ister - cevrilmezse MAX her seferinde duser.
    const amountIn = await toRawSpendAmount({
      provider: this.getProvider(),
      chainId: this.chainId,
      tokenAddress: inputToken,
      parsedAmount: ethers.parseUnits(clampToDecimals(amountHumanReadable, inputDecimals), inputDecimals),
    })

    const WRAPPED_NATIVE = this.wrappedNative

    const actualInput = isInputNative ? WRAPPED_NATIVE : inputToken
    const actualOutput = isOutputNative ? WRAPPED_NATIVE : outputToken

    const { dex, outputAmount, fee, path } = await this.findBestDexRoute(actualInput, actualOutput, amountIn)

    const cappedSlippage = Math.min(parseFloat(slippage), 15)
    const slippagePercent = new Percent(Math.floor(cappedSlippage * 100), 10000)
    const minOutput = outputAmount * (BigInt(slippagePercent.denominator) - BigInt(slippagePercent.numerator)) / BigInt(slippagePercent.denominator)

    const recipient = this.getWallet().address
    const deadline = Math.floor(Date.now() / 1000) + 600
    const calls = []

    // nativeIsErc20 zincirinde (Celo) native taraf DUZ TOKEN'dir: value tasinmaz,
    // approve gerekir, ETH giris/cikis router fonksiyonlari zaten YOKTUR.
    const nativeAsToken = this.nativeIsErc20
    const ethInput = isInputNative && !nativeAsToken
    const ethOutput = isOutputNative && !nativeAsToken

    // 1) DEX router approve. Native girdide normalde gerekmez — ama native ERC20 ise
    // (Celo) router token'i transferFrom ile ceker, yani izin SART. Izin actualInput
    // uzerinden verilir: native girdide inputToken sifir adrestir.
    if (!ethInput) {
      const erc20 = new ethers.Interface(['function approve(address,uint256) returns (bool)'])
      const approveData = erc20.encodeFunctionData('approve', [dex.ROUTER_ADDRESS, ethers.MaxUint256])
      calls.push({ to: actualInput, value: 0n, data: approveData })
    }

    // 2) Swap call (V2/V3)
    let swapData
    let swapValue = 0n
    if (dex.VERSION === 2) {
      const r = new ethers.Interface(UNISWAP_V2_ROUTER_ABI)
      if (ethInput) {
        swapData = r.encodeFunctionData('swapExactETHForTokens', [minOutput, path, recipient, deadline])
        swapValue = amountIn
      } else if (ethOutput) {
        swapData = r.encodeFunctionData('swapExactTokensForETH', [amountIn, minOutput, path, recipient, deadline])
      } else {
        swapData = r.encodeFunctionData('swapExactTokensForTokens', [amountIn, minOutput, path, recipient, deadline])
      }
    } else {
      const r = new ethers.Interface(v3RouterAbiFor(dex))
      // tokenIn/tokenOut ROTADAN okunur (actualInput/actualOutput'tan degil). V3 bugun
      // tek hop oldugu icin ikisi ayni sonucu verir; ama Faz 2'de exactInput cok adima
      // acildiginda adres ciftini elle kurmak sessizce DIREKT cifti kodlamaya devam
      // ederdi ve rota secimi bosa giderdi. estimateSwapGas zaten path'ten okuyor.
      const params = v3SwapParams(dex, {
        tokenIn: path[0], tokenOut: path[path.length - 1], fee, recipient,
        deadline, amountIn, amountOutMinimum: minOutput,
      })
      swapData = r.encodeFunctionData('exactInputSingle', [params])
      if (ethInput) swapValue = amountIn
    }
    calls.push({ to: dex.ROUTER_ADDRESS, value: swapValue, data: swapData })

    // 3) V3 + native cikti: exactInputSingle WRAPPED_NATIVE dondurur, unwrap ETMEZ.
    // (V2'de router swapExactTokensForETH icinde kendisi unwrap ediyor.) Normal yolda
    // bu is gonderimden sonra ayri bir tx ile yapiliyor; gasless kullanicinin native
    // gas'i olmadigi icin ayri tx atamaz - unwrap AYNI UserOp yigininda olmali,
    // yoksa kullanici ETH yerine WETH ile kalir ve cuzdan hicbir sey gelmemis gosterir.
    //
    // Cekilen miktar minOutput: yigin kurulurken gercek cikti bilinmiyor ve
    // withdraw(minOutput) HER ZAMAN basarili olur (cikti >= minOutput garantili).
    // Slippage payi kadar kucuk bir WETH bakiyesi hesapta kalabilir; router'a ozgu
    // unwrapWETH9 sentinel'lerine (address(0) vs address(2)) bel baglamak yerine
    // her router'da calisan bu yol secildi.
    //
    // nativeIsErc20 zincirinde bu adim HIC uretilmez: Celo'da CELO token'inda
    // withdraw(uint256) yoktur, cagri tum UserOp yigininin revert etmesine yol acardi —
    // ve zaten cikti dogrudan native varliktir, cevrilecek bir sey yok.
    const needsUnwrapCall = dex.VERSION === 3 && ethOutput
    if (needsUnwrapCall && minOutput > 0n) {
      const weth = new ethers.Interface(['function withdraw(uint256)'])
      calls.push({ to: WRAPPED_NATIVE, value: 0n, data: weth.encodeFunctionData('withdraw', [minOutput]) })
    }

    return {
      calls,
      meta: { dex: dex.NAME, outputAmount: outputAmount.toString(), inputToken, outputToken, unwrappedAmount: needsUnwrapCall ? minOutput.toString() : null }
    }
  }

  async executeSwap(inputToken, outputToken, amountHumanReadable, slippage, onProgress = () => {}) {
    try {
      const provider = this.getProvider()
      const wallet = this.getWallet()
      
      const isInputNative = await this.isNativeToken(inputToken)
      const isOutputNative = await this.isNativeToken(outputToken)

      // nativeIsErc20 zincirinde (Celo) native taraf DUZ TOKEN'dir; ETH giris/cikis
      // router fonksiyonlari zincirde YOKTUR, value tasinmaz ve approve SARTTIR.
      const nativeAsToken = this.nativeIsErc20
      const ethInput = isInputNative && !nativeAsToken
      const ethOutput = isOutputNative && !nativeAsToken

      const inputDecimals = await this.getTokenDecimals(inputToken)
      // Token'in tasiyabileceginden fazla ondalik parseUnits'i NUMERIC_FAULT ile
      // patlatir ve hata tum teklifi oldurur. Fazlasi kesilir (yuvarlanmaz).
      // BIRIM SINIRI: buildSwapCalls ile AYNI cevrim - bkz. oradaki not. Bu iki
      // yol (gasless / duz gonderim) ayni miktari uretmek ZORUNDA.
      const amountIn = await toRawSpendAmount({
        provider,
        chainId: this.chainId,
        tokenAddress: inputToken,
        parsedAmount: ethers.parseUnits(clampToDecimals(amountHumanReadable, inputDecimals), inputDecimals),
      })

      // SEMBOLLER GONDERIMDEN ONCE COZULUR. Bekleyen satirin etiketi icin
      // gerekiyorlar ama iskelet islem ZINCIRE FIRLATILDIKTAN sonra kuruluyor;
      // cagriyi oraya birakmak, gerceklesmis bir takasin kaydini RPC'nin
      // cevabina bagli kilardi (ethers varsayilan istek zaman asimi 300 sn).
      // Burada ise, hata olsa bile kullanici henuz hicbir sey gondermemis olur.
      // getTokenSymbol zaten HICBIR KOSULDA FIRLATMAZ; yine de yeri onemli.
      const [inputSymbol, outputSymbol] = await Promise.all([
        this.getTokenSymbol(inputToken),
        this.getTokenSymbol(outputToken),
      ])

      // Bakiye kaynagi native girdide provider.getBalance kalir: Celo'da CELO
      // kontratinin balanceOf'u zaten hesabin native bakiyesini okur, yani iki kaynak
      // ayni sonucu verir — ekstra bir eth_call yapmamak icin mevcut yol korunur.
      const balance = isInputNative
        ? await provider.getBalance(wallet.address)
        : await this.getTokenBalance(inputToken, wallet.address)

      // BU KAPI HAM BIRIMDE KALIR - BILEREK. `balance` zincirden duz balanceOf ile
      // okunuyor (HAM) ve `amountIn` artik toRawSpendAmount'tan geciyor (HAM), yani
      // iki taraf AYNI birimde. balanceOfUI'ye cevirmek burayi bozardi: UI bakiye
      // ham miktarla karsilastirilir ve kapi bStock'ta yanlis tarafa acilirdi.
      if (balance < amountIn) throw new Error(`Insufficient balance`)

      let actualInput = inputToken
      let actualOutput = outputToken

      const WRAPPED_NATIVE = this.wrappedNative

      if (isInputNative) {
        actualInput = WRAPPED_NATIVE
      }
      if (isOutputNative) {
        actualOutput = WRAPPED_NATIVE
      }

      const { dex, outputAmount, fee, path } = await this.findBestDexRoute(
        actualInput,
        actualOutput,
        amountIn
      )

      const cappedSlippage = Math.min(parseFloat(slippage), 15)
      const slippagePercent = new Percent(Math.floor(cappedSlippage * 100), 10000)
      
      const minOutput = outputAmount * (BigInt(slippagePercent.denominator) - BigInt(slippagePercent.numerator)) / 
        BigInt(slippagePercent.denominator)

      // Native ERC20 zincirinde (Celo) native girdi de approve ISTER: router token'i
      // transferFrom ile ceker. Sozlesme actualInput uzerinden kurulur — native girdide
      // inputToken sifir adrestir ve orada allowance/approve cagrisi bos donerdi.
      if (!ethInput) {
        const inputContract = new ethers.Contract(actualInput, ERC20_ABI, wallet);
        const currentAllowance = await inputContract.allowance(wallet.address, dex.ROUTER_ADDRESS);
        
        if (currentAllowance < amountIn) {
          onProgress({ status: 'APPROVING', message: 'Harcama izni ağa gönderiliyor...' });
            
          try {
            // 1. APPROVE İŞLEMİNİ AĞA FIRLAT
            const approveTx = await inputContract.approve(dex.ROUTER_ADDRESS, ethers.MaxUint256, { gasLimit: 100000 });
            
            // 🔥 2. APPROVE İÇİN PENDING İSKELETİ OLUŞTUR VE KAYDET
            const approveSkeleton = buildApprovePendingSkeleton(approveTx, wallet.address, actualInput, dex.ROUTER_ADDRESS);
            await saveOrUpdateTxInStorage(approveSkeleton); // Vue arayüzünde hemen "Approve Bekliyor" çıkacak!

            onProgress({ status: 'APPROVING_WAIT', message: 'Harcama izninin onaylanması bekleniyor...' });
            
            // 3. APPROVE İŞLEMİNİN ONAYLANMASINI BEKLE (Background'da olduğumuz için güvenli)
            const approveReceipt = await approveTx.wait();

            // 4. ONAYLANDI! İSKELETİ BAŞARILI (SUCCESS) OLARAK GÜNCELLE
            approveSkeleton.receipt_status = "1";
            approveSkeleton.block_number = approveReceipt.blockNumber.toString();
            approveSkeleton.receipt_gas_used = approveReceipt.gasUsed.toString();
            
            const feeWei = approveReceipt.gasUsed * (approveReceipt.effectiveGasPrice || approveTx.gasPrice || 0n);
            approveSkeleton.transaction_fee = ethers.formatEther(feeWei);

            await saveOrUpdateTxInStorage(approveSkeleton); // Geçmişte "Approve" yeşile döndü!

          } catch (error) {
            console.error("Approve işlemi başarısız:", error);
            // İskeleti başarısız olarak güncelle ve tüm süreci durdur
            // (TODO: skeleton'u bulup status="0" yapmak eklenebilir)
            throw new Error("Token harcama izni (Approve) başarısız oldu veya reddedildi.");
          }
        }
      }

      const gasParams = await this.optimizeGasParameters()
      const deadline = Math.floor(Date.now() / 1000) + 600

      const routerContract = new ethers.Contract(
        dex.ROUTER_ADDRESS,
        dex.VERSION === 3 ? v3RouterAbiFor(dex) : UNISWAP_V2_ROUTER_ABI,
        wallet
      )

      let txResponse // Artık tx değil txResponse diyoruz
      let needsUnwrap = false

      // --- SWAP İŞLEMİNİ AĞA FIRLATMA ---
      if (dex.VERSION === 2) {
        if (ethInput) {
          txResponse = await routerContract.swapExactETHForTokens(minOutput, path, wallet.address, deadline, { ...gasParams, value: amountIn })
        } else if (ethOutput) {
          try {
            txResponse = await routerContract.swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn, minOutput, path, wallet.address, deadline, gasParams)
          } catch (e) {
            txResponse = await routerContract.swapExactTokensForETH(amountIn, minOutput, path, wallet.address, deadline, gasParams)
          }
        } else {
          txResponse = await routerContract.swapExactTokensForTokens(amountIn, minOutput, path, wallet.address, deadline, gasParams)
        }
      } else if (dex.VERSION === 3) {
        // tokenIn/tokenOut ROTADAN: buildSwapCalls ile ayni gerekce (Faz 2 tuzagi).
        const params = v3SwapParams(dex, {
          tokenIn: path[0], tokenOut: path[path.length - 1], fee,
          recipient: wallet.address, deadline, amountIn, amountOutMinimum: minOutput,
        })
        if (ethInput) txResponse = await routerContract.exactInputSingle(params, { ...gasParams, value: amountIn })
        else txResponse = await routerContract.exactInputSingle(params, gasParams)

        // ethOutput: nativeIsErc20 zincirinde unwrap YOKTUR (CELO'da withdraw() yok,
        // zaten cikti dogrudan native varlik).
        if (ethOutput) needsUnwrap = true
      }

      const pendingSkeleton = buildSwapPendingSkeleton({
        txResponse, wallet, inputToken, outputToken, amountHumanReadable,
        inputSymbol, outputSymbol,
        outputAmountHuman: ethers.formatUnits(outputAmount, await this.getTokenDecimals(outputToken))
      });

      await saveOrUpdateTxInStorage(pendingSkeleton)

      const waitPromise = this.watchSwapResolutionAndUnwrap(txResponse, pendingSkeleton, needsUnwrap, WRAPPED_NATIVE, wallet);

      return { 
        hash: txResponse.hash, 
        status: 'pending',
        message: 'Swap transaction broadcasted to mempool.',
        waitPromise
      };

    } catch (error) {
      throw new Error(`executeSwap error: ${error.message}`)
    }
  }


  async watchSwapResolutionAndUnwrap(txResponse, skeleton, needsUnwrap, WRAPPED_NATIVE, wallet) {
    try {
      // 1. İşlemin bloğa yazılmasını bekle
      const receipt = await txResponse.wait();

      // 2. V3 için otomatik Unwrap gerekiyorsa yap.
      // nativeIsErc20 zincirinde (Celo) ASLA yapilmaz: WRAPPED_NATIVE bir sarmalayici
      // degil native varligin kendisidir, withdraw(uint256) o kontratta yoktur ve
      // cagri bosuna gaz yakarak revert eder. Cagiran taraf zaten needsUnwrap=false
      // gonderiyor; bu ikinci kapi, ileride baska bir cagiran eklenirse diye.
      if (needsUnwrap && !this.nativeIsErc20 && receipt.status === 1) {
        try {
          const WETH_ABI = ["function withdraw(uint256 amount)", "function balanceOf(address) view returns (uint256)"]
          const wrappedToken = new ethers.Contract(WRAPPED_NATIVE, WETH_ABI, wallet)
          const wrappedBalance = await wrappedToken.balanceOf(wallet.address)
          
          if (wrappedBalance > 0n) {          
            const unwrapTx = await wrappedToken.withdraw(wrappedBalance, { gasLimit: 100000 })
            await unwrapTx.wait()
            // İsteğe bağlı: skeleton içine unwrapHash eklenebilir
            skeleton.unwrap_hash = unwrapTx.hash;
          }
        } catch (unwrapError) {
          console.warn('Automatic unwrap failed silently:', unwrapError.message)        
        }
      }

      // 3. Fiş (Receipt) bilgilerini iskelete doldur ve durumu 1 (Başarılı) yap
      skeleton.receipt_status = receipt.status.toString();
      skeleton.block_number = receipt.blockNumber.toString();
      skeleton.receipt_gas_used = receipt.gasUsed.toString();
      const feeWei = receipt.gasUsed * (receipt.effectiveGasPrice || txResponse.gasPrice || 0n);
      skeleton.transaction_fee = ethers.formatEther(feeWei);

      // 4. Storage'daki pending işlemini güncelle (veya silip geçmişe at)
      await saveOrUpdateTxInStorage(skeleton);
      
      return receipt;

    } catch (error) {
      console.warn("Swap işlemi başarısız veya düştü:", error);
      skeleton.receipt_status = "0"; // Başarısız
      await saveOrUpdateTxInStorage(skeleton);
      throw error;
    }
  }

  async generateReceipt(receipt, inputAmount, outputToken, unwrapInfo = null) {
    try {
      const provider = this.getProvider()
      const wallet = this.getWallet()
      
      const isOutputNative = await this.isNativeToken(outputToken)
      let newBalance
      
      if (isOutputNative) {
        newBalance = await provider.getBalance(wallet.address)
      } else {
        const outputContract = new ethers.Contract(outputToken, ERC20_ABI, provider)
        newBalance = await outputContract.balanceOf(wallet.address)
      }

      const receiptData = {
        success: true,
        chainId: this.chainId,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        inputAmount,
        outputBalance: ethers.formatUnits(newBalance, await this.getTokenDecimals(outputToken)),
        timestamp: Date.now(),
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: ethers.formatUnits(receipt.gasPrice || receipt.effectiveGasPrice, 'gwei')
      }

      // Unwrap bilgilerini ekle
      if (unwrapInfo) {
        receiptData.unwrap = {
          performed: unwrapInfo.unwrapped,
          transactionHash: unwrapInfo.unwrapTx || null,
          amount: unwrapInfo.unwrapAmount || null,
          error: unwrapInfo.unwrapError || null,
          message: unwrapInfo.unwrapped 
            ? `✅ Automatically unwrapped ${unwrapInfo.unwrapAmount} to native token`
            : `⚠️ Unwrap failed: ${unwrapInfo.unwrapError}`
        }
      }

      return receiptData
    } catch (error) {
      console.error("generateReceipt error", error.message)
      
      // Minimal receipt döndür
      const minimalReceipt = {
        success: true,
        transactionHash: receipt.hash,
        inputAmount,
        timestamp: Date.now()
      }

      if (unwrapInfo) {
        minimalReceipt.unwrap = {
          performed: unwrapInfo.unwrapped,
          transactionHash: unwrapInfo.unwrapTx || null,
          error: unwrapInfo.unwrapError || null
        }
      }

      return minimalReceipt
    }
  }

  async getExpectedOutput(inputToken, outputToken, amountHumanReadable, slippageTolerance) {
    try {
      const provider = this.getProvider()
      
      const isInputNative = await this.isNativeToken(inputToken)
      const isOutputNative = await this.isNativeToken(outputToken)

      // Gerçek token adreslerini belirle (Wrapped tokenlerle değiştir)
      let actualInput = inputToken
      let actualOutput = outputToken
      
      if (isInputNative) {
        actualInput = this.wrappedNative
      }

      if (isOutputNative) {
        actualOutput = this.wrappedNative
      }

      // Ondalık değerleri al
      const inputDecimals = await this.getTokenDecimals(inputToken)
      const outputDecimals = await this.getTokenDecimals(outputToken)
      // Token'in tasiyabileceginden fazla ondalik parseUnits'i NUMERIC_FAULT ile
      // patlatir ve hata tum teklifi oldurur. Fazlasi kesilir (yuvarlanmaz).
      // BIRIM SINIRI: TEKLIF de cevrilir. Cevrilmezse ekranda fiyatlanan miktar
      // ile gonderilen miktar AYRISIR (bStock'ta bugun %0,05-0,17) ve kullanici
      // onayladigindan baska bir islem imzalar.
      const amountIn = await toRawSpendAmount({
        provider,
        chainId: this.chainId,
        tokenAddress: inputToken,
        parsedAmount: ethers.parseUnits(clampToDecimals(amountHumanReadable, inputDecimals), inputDecimals),
      })

      // En iyi rotayı bul
      const bestRoute = await this.findBestDexRoute(
        actualInput,
        actualOutput,
        amountIn
      )

      let priceImpact, liquidityProviderFee

      const cappedSlippage = Math.min(parseFloat(slippageTolerance), 15)
      const slippage = new Percent(Math.floor(cappedSlippage * 100), 10000)

      slippageTolerance = slippage.toFixed(2)

      const minReceivedBigInt = bestRoute.outputAmount * 
        (BigInt(slippage.denominator) - BigInt(slippage.numerator)) / 
        BigInt(slippage.denominator)
      
      const minReceivedFormatted = ethers.formatUnits(
        minReceivedBigInt, 
        isOutputNative ? 18 : outputDecimals // Native çıktıda 18 decimal kullan
      )

      // Price Impact ve Ücretler
      if (bestRoute.dex.VERSION === 2) {
        const feeBasisPoints = bestRoute.dex.FEE
        const hops = bestRoute.path.length - 1
        const perHopImpact = []
        let hopAmountIn = amountIn
        let pairMismatch = false

        // Butun dongu TEK bir guard icinde: fiyat etkisi KOZMETIK tek bir alan, ama
        // buradaki her await disaridaki try'a dusuyordu — gecici bir RPC hatasi ya da
        // getPairAddress'in (bilerek cache'lemedigi) ZeroAddress donusu teklifin
        // TAMAMINI oldurup kullaniciyi fiyatsiz birakiyordu. pairMismatch + 'N/A'
        // zaten bu is icin var olan zarif dusus yolu (R19).
        try {
          for (let i = 0; i < hops; i++) {
            // Rezervler quoteV2Path'te ZATEN okundu ve kazanan aday icin atiliyordu;
            // artik rotayla birlikte geliyor. Yoksa (eski/stub rota) okumaya duseriz.
            let pool = bestRoute.pools?.[i]
            if (!pool) {
              const pairAddress = await this.getPairAddress(bestRoute.dex, bestRoute.path[i], bestRoute.path[i + 1])
              const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, provider)
              const [reserves, token0, token1] = await Promise.all([pairContract.getReserves(), pairContract.token0(), pairContract.token1()])
              pool = { reserves, token0, token1 }
            }
            const { reserves, token0, token1 } = pool

            const inputIsToken0 = bestRoute.path[i].toLowerCase() === token0.toLowerCase()
            const inputIsToken1 = bestRoute.path[i].toLowerCase() === token1.toLowerCase()
            // Havuz beklenen cift degilse rezerv yonu TERSINE donerdi ve yanlis
            // bir yuzde uretirdi. Sessizce yanlis olmaktansa "hesaplanamadi" de.
            if (!inputIsToken0 && !inputIsToken1) {
              pairMismatch = true
              break
            }

            const inputReserve = inputIsToken0 ? reserves[0] : reserves[1]
            const outputReserve = inputIsToken0 ? reserves[1] : reserves[0]

            const amountInWithFee = hopAmountIn * (10000n - BigInt(feeBasisPoints)) / 10000n
            const inputReserveAfter = inputReserve + amountInWithFee

            perHopImpact.push((Number(amountInWithFee) / Number(inputReserveAfter)) * 100)

            // Sonraki hop'un girdisi bu hop'un ciktisi.
            hopAmountIn = amountInWithFee * outputReserve / inputReserveAfter
          }
        } catch (error) {
          console.warn('Fiyat etkisi hesaplanamadi, teklif korunuyor:', error.message)
          pairMismatch = true
        }

        priceImpact = pairMismatch ? 'N/A' : compoundPriceImpact(perHopImpact).toFixed(2)
        // Ucret her hop'ta ayri alinir; rezerv okumasi basarisiz olsa da bilinir.
        liquidityProviderFee = ((feeBasisPoints * hops) / 100).toFixed(2)
      } else if (bestRoute.dex.VERSION === 3) {
        liquidityProviderFee = (bestRoute.fee / 10000).toFixed(2)

        // V3'te rezerv yok, etki IKINCI bir kotasyondan cikarilir: kazanan
        // kademeye kucuk bir prob miktariyla tekrar sorulur ve birim fiyat
        // sapmasi olculur. KAZANAN kademe icin TEK ek eth_call - kademe
        // dongusune girmedi cunku o dongu sirali await ve prob orada
        // 4-6 cagriyi 8-12'ye cikarirdi.
        //
        // Blok KENDI guard'i icinde: fiyat etkisi kozmetik tek bir alan, ama
        // buradaki await disaridaki try'a duserse gecici bir RPC hatasi
        // teklifin TAMAMINI oldurup kullaniciyi fiyatsiz birakir (R19, V2
        // kolunun 989-996'daki ayni karari).
        priceImpact = 'N/A'
        try {
          const probeIn = amountIn / V3_PROBE_DIVISOR
          // BigInt bolmesi tabana yuvarlar: dusuk ondalikli tokenlerde ya da
          // kucuk miktarlarda prob SIFIRA duser ve QuoterV2 sifir girdide
          // revert eder. Hic sormamak dogrusu.
          if (probeIn > 0n && bestRoute.dex.quoterContract) {
            const raw = await bestRoute.dex.quoterContract.quoteExactInputSingle.staticCall(
              ...v3QuoteArgs(bestRoute.dex, {
                tokenIn: bestRoute.path[0],
                tokenOut: bestRoute.path[bestRoute.path.length - 1],
                fee: bestRoute.fee,
                amountIn: probeIn,
              })
            )
            const impact = v3PriceImpact({
              inSmall: probeIn,
              outSmall: v3QuoteOut(bestRoute.dex, raw),
              inLarge: amountIn,
              outLarge: bestRoute.outputAmount,
            })
            if (impact !== null) priceImpact = impact.toFixed(2)
          }
        } catch (error) {
          console.warn('V3 fiyat etkisi olculemedi, teklif korunuyor:', error.message)
        }
      }

      // Gerçek output miktarını formatla
      let expectedOutput = ethers.formatUnits(
        bestRoute.outputAmount, 
        isOutputNative ? 18 : outputDecimals
      )

      // Native token durumunda Wrapped token miktarından native'e çevir
      if (isOutputNative) {
        expectedOutput = ethers.formatUnits(
          bestRoute.outputAmount, 
          outputDecimals
        )
      }

      const exchangeRate = parseFloat(expectedOutput) / parseFloat(amountHumanReadable)
      const reverseExchangeRate = parseFloat(amountHumanReadable) / parseFloat(expectedOutput)

      // Gas ücreti tahmini. Yol ROTADAN gelir: çok adımlı bir rota seçildiyse
      // [in, ara, out] üç elemanlıdır ve estimateGas'a aynen gitmelidir.
      const gasEstimate = await this.estimateSwapGas(
        inputToken,
        outputToken,
        amountIn,
        bestRoute,
        bestRoute.path
      )

      // R20: derinlik esigi TUM V2 adaylarini eledi ve taranmamis bir V3 rotasi kazandi.
      // Bu tam olarak buyuk takas demek, ama V3'te rezerv okumasi olmadigi icin
      // priceImpact 'N/A' basiliyor — yani uyariya en cok ihtiyaci olan islem, uyari
      // almayacagi garanti olan islem. Arayuz bunu bir satirla soylesin diye bayrak.
      const depthGateWarning = Boolean(bestRoute.v2DepthRejected) && bestRoute.dex.VERSION === 3

      return {
        expectedOutput,
        slippageTolerance: `${slippageTolerance}%`,
        minimumReceived: minReceivedFormatted,
        depthGateWarning,
        priceImpact: `${priceImpact}%`,
        liquidityProviderFee: `${liquidityProviderFee}%`,
        exchangeRate: exchangeRate.toFixed(6), // 1 input = ? output
        reverseExchangeRate: reverseExchangeRate.toFixed(6), // 1 output = ? input
        estimatedGasFee: gasEstimate, // Gas ücreti bilgileri
        routerType: {
          name: bestRoute.dex.NAME,
          version: bestRoute.dex.VERSION
        }
      }
    } catch (error) {
      throw new Error(`getExpectedOutput error: ${error.message}`)
    }
  }

  /**
   * Swap icin gas tahmini.
   *
   * Bu fonksiyonun ICI daha once HIC calismiyordu: findBestDexRoute
   * `{ dex, outputAmount, fee }` donduruyor - `path` diye bir alan YOK - ve her dal
   * `bestRoute.path[0]` diyerek ilk erisimde TypeError firlatiyordu. Ayrica
   * `this.walletAddress` hicbir yerde atanmiyor. Ic catch bunu sessizce yutup her
   * seferinde sabit varsayilan limiti kullaniyordu, yani gosterilen ve dogrulamada
   * kullanilan gas ucreti uydurmaydi.
   *
   * @param {string[]} routePath bestRoute.path - secilen rotanin adres dizisi.
   *   Tek hop'ta [in, out], cok hop'ta [in, ara, ..., out]; native taraf zaten
   *   WRAPPED_NATIVE'e cevrilmis olarak gelir.
   */
  async estimateSwapGas(inputToken, outputToken, amountIn, bestRoute, routePath) {
    try {
      const provider = this.getProvider()
      const gasPrice = await provider.getFeeData()

      const isInputNative = await this.isNativeToken(inputToken)
      const isOutputNative = await this.isNativeToken(outputToken)

      // nativeIsErc20 zincirinde ETH giris/cikis fonksiyonlari router'da YOK: onlarla
      // tahmin denemek her seferinde revert edip varsayilan limite duserdi, yani
      // ekranda gosterilen gaz ucreti gercek islemin degil.
      const nativeAsToken = this.nativeIsErc20
      const ethInput = isInputNative && !nativeAsToken
      const ethOutput = isOutputNative && !nativeAsToken

      const path = Array.isArray(routePath) && routePath.length >= 2 ? routePath : null
      const owner = this.getWallet().address

      let gasLimit

      // Router contract'ı al
      const routerContract = new ethers.Contract(
        bestRoute.dex.ROUTER_ADDRESS,
        bestRoute.dex.VERSION === 2 ? ROUTER_V2_ABI : v3RouterAbiFor(bestRoute.dex),
        provider
      )

      try {
        if (!path) throw new Error('route path yok')

        const deadline = Math.floor(Date.now() / 1000) + 300

        // Gas limitini tahmin et
        if (bestRoute.dex.VERSION === 2) {
          if (ethInput && !ethOutput) {
            // ETH/BNB -> Token
            gasLimit = await routerContract.swapExactETHForTokens.estimateGas(
              0, path, owner, deadline, { value: amountIn, from: owner }
            )
          } else if (!ethInput && ethOutput) {
            // Token -> ETH/BNB
            gasLimit = await routerContract.swapExactTokensForETH.estimateGas(
              amountIn, 0, path, owner, deadline, { from: owner }
            )
          } else {
            // Token -> Token
            gasLimit = await routerContract.swapExactTokensForTokens.estimateGas(
              amountIn, 0, path, owner, deadline, { from: owner }
            )
          }
        } else if (bestRoute.dex.VERSION === 3) {
          // Uniswap V3 için exactInputSingle kullan
          const params = v3SwapParams(bestRoute.dex, {
            tokenIn: path[0], tokenOut: path[path.length - 1], fee: bestRoute.fee,
            recipient: owner, deadline, amountIn, amountOutMinimum: 0,
          })

          if (ethInput) {
            gasLimit = await routerContract.exactInputSingle.estimateGas(params, { value: amountIn, from: owner })
          } else {
            gasLimit = await routerContract.exactInputSingle.estimateGas(params, { from: owner })
          }
        }
      } catch (estimateError) {
        // Tahmin başarısız olursa varsayılan değerler kullan. Token henüz approve
        // edilmemişse estimateGas revert eder; bu yol hâlâ sık kullanılıyor.
        // Değer hop sayısına göre ölçeklenir: çok adımlı takas tek adımlıya göre
        // belirgin fazla gaz harcar.
        const hopCount = path ? path.length - 1 : 1
        gasLimit = defaultGasLimit(bestRoute.dex.VERSION, hopCount)
        console.warn('Gas estimation failed, using default:', estimateError.message)
      }

      // Gas maliyetlerini hesapla
      const maxFeePerGas = gasPrice.maxFeePerGas || gasPrice.gasPrice
      const maxPriorityFeePerGas = gasPrice.maxPriorityFeePerGas || BigInt(0)
      
      const totalGasCost = gasLimit * maxFeePerGas
      const totalGasCostInEth = ethers.formatEther(totalGasCost)
      
      // Native token sembolünü belirle
      const nativeSymbol = getNativeSymbol(this.chainId)

      // USD cinsinden değer için native token fiyatını al (opsiyonel)
      let gasCostUSD = null
      try {
        const nativeTokenPrice = await this.getNativeTokenPrice() // Bu fonksiyonu implement etmeniz gerekebilir
        gasCostUSD = (parseFloat(totalGasCostInEth) * nativeTokenPrice).toFixed(2)
      } catch (priceError) {
        console.warn('Native token price fetch failed:', priceError.message)
      }

      return {
        gasLimit: gasLimit.toString(),
        maxFeePerGas: ethers.formatUnits(maxFeePerGas, 'gwei'),
        maxPriorityFeePerGas: ethers.formatUnits(maxPriorityFeePerGas, 'gwei'),
        totalCost: totalGasCostInEth,
        totalCostFormatted: `${parseFloat(totalGasCostInEth).toFixed(6)} ${nativeSymbol}`,
        totalCostUSD: gasCostUSD ? `$${gasCostUSD}` : null,
        gasType: gasPrice.maxFeePerGas ? 'EIP-1559' : 'Legacy'
      }
    } catch (error) {
      console.error('Gas estimation error:', error)
      
      // Hata durumunda varsayılan değerler return et
      const nativeSymbol = getNativeSymbol(this.chainId)
      return {
        gasLimit: '200000',
        maxFeePerGas: '5.0',
        maxPriorityFeePerGas: '1.0',
        totalCost: '0.001',
        totalCostFormatted: `0.001 ${nativeSymbol}`,
        totalCostUSD: null,
        gasType: 'Estimated',
        error: error.message
      }
    }
  }

  async getNativeTokenPrice() {
    try {
      const coingeckoId = getNativeCoingeckoId(this.chainId)
      const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`)
      const data = await response.json()
      return data[coingeckoId].usd
    } catch (error) {
      throw new Error(`Price fetch failed: ${error.message}`)
    }
  }
}
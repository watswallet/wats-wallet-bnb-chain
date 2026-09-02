// Swap rota kararlarinin SAF katmani: ag cagrisi, saglayici, cuzdan yok.
// swap.js bu fonksiyonlari cagirir; boylece rota mantigi RPC olmadan test edilebilir.

// --- Yol adaylari ---------------------------------------------------------

// Direkt yol + her ara token uzerinden iki adimli yollar.
// wrappedNative ayrica eklenmez: CHAIN_CONFIG'de intermediates[0] zaten odur.
export function buildPathCandidates(inputToken, outputToken, intermediates) {
  const inL = inputToken.toLowerCase()
  const outL = outputToken.toLowerCase()
  const paths = [[inputToken, outputToken]]

  for (const mid of intermediates) {
    const midL = mid.toLowerCase()
    // Girdiye veya cikisa esit ara token, direkt yolun kopyasini uretir.
    if (midL === inL || midL === outL) continue
    paths.push([inputToken, mid, outputToken])
  }

  return paths
}

// --- V3 fee kademeleri ----------------------------------------------------

export const DEFAULT_FEE_TIERS = [100, 500, 3000, 10000]

// PancakeSwap V3 orta kademesi 2500, Base'deki Uniswap'te 200/400 de acik.
// Sabit liste bu havuzlari hic sormuyordu.
export const feeTiersFor = (dex) => dex?.FEE_TIERS ?? DEFAULT_FEE_TIERS

// --- V3 router varyanti ---------------------------------------------------
//
// Uniswap'in iki router surumu exactInputSingle'i farkli imzayla aciyor.
// SwapRouter (0x414bf389) struct'inda deadline VAR; SwapRouter02'de (0x04e45aaf) YOK.
// Yanlis varyant secilirse cagri zincirde revert eder — quote asamasinda belli olmaz.

export const V3_ROUTER_ABI_DEADLINE = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
]

export const V3_ROUTER_ABI_NO_DEADLINE = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
]

export const v3RouterAbiFor = (dex) =>
  dex?.ROUTER_VARIANT === 'no-deadline' ? V3_ROUTER_ABI_NO_DEADLINE : V3_ROUTER_ABI_DEADLINE

export function v3SwapParams(dex, { tokenIn, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum }) {
  const params = { tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96: 0 }
  if (dex?.ROUTER_VARIANT === 'no-deadline') return params
  return { ...params, deadline }
}

// --- V3 quoter surumu -----------------------------------------------------
//
// QuoterV1 duz argumanlar alir ve tek deger doner. QuoterV2 tek struct alir,
// dort deger doner ve struct'ta amountIn, fee'den ONCE gelir.

export const V3_QUOTER_ABI_V1 = [
  'function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
]

export const V3_QUOTER_ABI_V2 = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
]

export const v3QuoterAbiFor = (dex) =>
  dex?.QUOTER_VERSION === 2 ? V3_QUOTER_ABI_V2 : V3_QUOTER_ABI_V1

export function v3QuoteArgs(dex, { tokenIn, tokenOut, fee, amountIn }) {
  if (dex?.QUOTER_VERSION === 2) {
    return [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 }]
  }
  return [tokenIn, tokenOut, fee, amountIn, 0]
}

export const v3QuoteOut = (dex, raw) => (dex?.QUOTER_VERSION === 2 ? raw[0] : raw)

// --- Likidite esigi -------------------------------------------------------
//
// Bazi V2 havuzlari fiilen olu (spec §5.3). Motor en iyi teklifi sectigi icin
// ana ciftlerde zararsizlar, ama bir token'in TEK rotasi olduklarinda kullanici
// felaket fiyata takas yapar: minOutput da ayni bozuk teklifin uzerinden hesaplanir,
// yani slippage korumasi devreye girmez. Cozum, havuzun kendisini reddetmek.

export const MAX_POOL_SHARE_BPS = 200 // %2

export function poolTooShallow(amountIn, reserveIn, maxShareBps = MAX_POOL_SHARE_BPS) {
  if (reserveIn <= 0n) return true
  return amountIn * 10000n > reserveIn * BigInt(maxShareBps)
}

// Esikle elenen aday "havuz yok" ile AYNI hatayi uretiyordu ("No liquidity source
// found"): kullanicinin gordugu metin, sorunun MIKTAR oldugunu hic soylemiyordu —
// oysa cozum tek tikla elinde (miktari kucult). Ayri bir sentinel gerekli, cunku hata
// arayuze chrome.runtime uzerinden yalnizca STRING olarak geciyor.
export const LIQUIDITY_GATE_ERROR = 'Amount too large for available liquidity'
export const NO_ROUTE_ERROR = 'No liquidity source found'

// --- Fiyat etkisi ---------------------------------------------------------

// Hop basina yuzde etkiler bilesik birlestirilir: 1 - Π(1 - etki_i).
// Tek hop'ta sonuc girdi degerine esittir, yani mevcut davranis korunur.
export function compoundPriceImpact(perHopPercent) {
  if (!perHopPercent.length) return 0
  const remaining = perHopPercent.reduce((acc, p) => acc * (1 - p / 100), 1)
  return (1 - remaining) * 100
}

// --- Gaz geri dusus limiti ------------------------------------------------

// estimateGas basarisiz olursa kullanilan varsayilan. Cok adimli takas tek adimliya
// gore belirgin fazla gaz harcar; tek limitle ikisini temsil etmek yanlis rakam gosterir.
export function defaultGasLimit(version, hopCount) {
  const base = version === 2 ? 350000 : 400000
  return BigInt(base + Math.max(0, hopCount - 1) * 120000)
}

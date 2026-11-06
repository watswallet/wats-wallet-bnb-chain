// verify:xstocks CEKIRDEGI -- SAF karar mantigi ve istemci kurallari (RPC / CoinGecko /
// ihracci API'si YOK). Komut: scripts/verify-xstocks.mjs. Testi:
// src/data/xStocksVerify.test.js (import.meta.env KULLANMAZ; Node'da dogrudan yuklenir).
//
// KATALOGA GIRIS KAPISI (spec 5.11, 2026-10-10 Cumartesi olcumuyle sertlestirildi):
//   1. ihracci API'si piyasanin ACIK oldugunu soylemeli (`trading.openNow`). Kapaliyken
//      CoW HATA DONMEYEBILIR: 200 doner ve fiyat 4,5-49 kat SISKINDIR (ETH NVDAx $1k ->
//      $1033/token, dayanak ~$229). "Piyasa kapaliyken InsufficientLiquidity doner"
//      varsayimi GUVENILMEZ; kapali hisse kapiya HIC sokulmaz ("OLCULEMEDI").
//   2. ALIS primi <= %1: CoW $10.000 USDC -> hisse birim fiyati (ag ucreti DAHIL),
//      CoinGecko / getCurrentMultiplier() referansina gore.
//      ALIS primi >= %-2 (MIN_PREMIUM_PCT): referansin cok ALTINDAKI teklif de gecmez (bayat
//      referans, carpan hatasi ya da depeg); bu bir sapma degil, insanin bakacagi OLCULEMEDI'dir.
//   3. ALIS-SATIS farki <= %2: ayni buyuklukte hisse -> USDC birim fiyati ile alis birim
//      fiyati arasindaki fark. Tek yonlu sisirme / referans kaymasi bu kapidan gecmez.
//   4. SATIS birim fiyati >= referans %-2 (MIN_SELL_PCT): satis tarafinin simetrik alt siniri (Faz 2 satis kilidi %2).
//      Alis primi MIN_PREMIUM_PCT altindaysa (referans guvenilmez) bu kural uygulanmaz.
// CoW /quote hiz siniri: ~1 istek/sn'de isteklerin yarisi 429 verdi ("custom rate
// limits"); 2,5 sn sonra yeniden denemek hepsini gecirdi. Istek araligi >= 2 sn.

import { getAddress } from 'ethers'
import { XSTOCK_FAMILY_ID, XSTOCKS_CHAIN_IDS, XSTOCKS_PLATFORM_BY_CHAIN } from '../src/data/xStocks.js'

export const GATE_NOTIONAL_USD = 10_000
export const MAX_BUY_PREMIUM_PCT = 1
export const MIN_PREMIUM_PCT = -2
export const MIN_SELL_PCT = -2 // satis birim fiyati referansin en cok %2 altinda olabilir
export const MAX_ROUNDTRIP_SPREAD_PCT = 2

export const COW_MIN_GAP_MS = 2000
export const COW_RETRY_DEFAULT_MS = 30_000
export const COW_MAX_RETRIES = 2
export const COW_REQUEST_TIMEOUT_MS = 10_000
const RETRY_AFTER_CAP_MS = 60_000

// Katalogla AYNI kaynak: zincirler ve CoinGecko platform kimlikleri tek yerde (data/xStocks.js).
export const VERIFY_CHAIN_IDS = XSTOCKS_CHAIN_IDS
export const CG_PLATFORM_BY_CHAIN = XSTOCKS_PLATFORM_BY_CHAIN
export const COW_PATH_BY_CHAIN = { 1: 'mainnet', 56: 'bnb', 42161: 'arbitrum_one' }

// Odeme tokeni: her zincirin yerli USDC'si (spec Ek A.5). Ondaliklar zincirden okunur
// (BSC Binance-Peg USDC 18 ondalik); burada yalniz adres.
export const PAY_TOKENS = {
  1: { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  56: { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' },
  42161: { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
}

export const REASON = Object.freeze({
  INVALID_PRICE: 'GECERSIZ_FIYAT',
  BUY_PREMIUM: 'ALIS_PRIMI_YUKSEK',
  ROUNDTRIP_SPREAD: 'ALIS_SATIS_FARKI_YUKSEK',
  SELL_DISCOUNT: 'SATIS_ISKONTOSU_YUKSEK',
  REFERENCE_INCONSISTENT: 'REFERANS_TUTARSIZ',
})

const round6 = (x) => Math.round(x * 1e6) / 1e6

// --- KOMUT SATIRI ------------------------------------------------------------------
// `--candidates TSLAx,NVDAx` ya da `--candidates=TSLAx,NVDAx` otomatik aday kumesini verilen
// sembollerle gecersiz kilar. `--limit N` (ya da `--limit=N`): olculecek ONERILEN sembol sayisi
// (varsayilan 50, 1..228; 22 bStock + 228 = sunucunun tek istekte kabul ettigi 250 kimlik).
// Bilinmeyen her `--` bayragi, bos liste, gecersiz limit ve artan konumsal arguman KULLANIM
// HATASIDIR (firlatir): yazim hatasi sessizce TUM kumeyi (~1600 cift, ~2 saat) kosturmasin.
export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 228
export const USAGE = `Kullanim: npm run verify:xstocks [-- --candidates TSLAx,NVDAx] [--limit N]  (N: 1-${MAX_LIMIT}, varsayilan ${DEFAULT_LIMIT})`

export function parseArgs(argv) {
  const out = { candidates: null, limit: DEFAULT_LIMIT }
  let limitSeen = false
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i])
    const eq = arg.indexOf('=')
    const flag = arg.startsWith('--') && eq !== -1 ? arg.slice(0, eq) : arg
    if (flag === '--candidates' || flag === '--limit') {
      let value
      if (arg.startsWith('--') && eq !== -1) {
        value = arg.slice(eq + 1)
      } else {
        value = argv[i + 1]
        i++
      }
      if (flag === '--candidates') {
        if (out.candidates !== null) throw new Error('--candidates iki kez verildi')
        if (!value || String(value).startsWith('--')) throw new Error('--candidates sembol listesi ister: --candidates TSLAx,NVDAx')
        const list = String(value).split(',').map((x) => x.trim()).filter(Boolean)
        if (list.length === 0) throw new Error('--candidates sembol listesi ister: --candidates TSLAx,NVDAx')
        out.candidates = list
      } else {
        if (limitSeen) throw new Error('--limit iki kez verildi')
        limitSeen = true
        const text = value === undefined ? '' : String(value).trim()
        const n = /^\d+$/.test(text) ? Number(text) : NaN
        if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
          throw new Error(`--limit 1 ile ${MAX_LIMIT} arasinda bir tam sayi ister (verilen: ${value === undefined ? 'yok' : value}): --limit ${DEFAULT_LIMIT}`)
        }
        out.limit = n
      }
    } else if (arg.startsWith('--')) {
      throw new Error(`bilinmeyen bayrak: ${flag}`)
    } else {
      throw new Error(`beklenmeyen arguman: ${arg} (semboller virgulle ayrilir: --candidates TSLAx,NVDAx)`)
    }
  }
  return out
}

// --- ADAY KESISIMI -----------------------------------------------------------------
const stripXStock = (name) => String(name ?? '').replace(/\s+xstock$/i, '').trim()

/**
 * Resmi token listesi (1 / 56 / 42161 girdileri) KESISIM CoinGecko `/coins/list?include_platform=true`
 * (ayni kontrat adresini ilgili platformda listeleyen kayitlar). `wrapped-*` kimlikleri
 * (ERC-4626 sarmalayici) ve xStock ailesi disindaki kimlikler elenir.
 * @returns {Array<{symbol,name,address,chains:number[],coingeckoId,decimals,issuer}>} sembole gore
 */
export function candidatesFromSources({ tokenList, coinsList, chainIds = VERIFY_CHAIN_IDS, only = null }) {
  const byPlatformAddress = new Map()
  for (const coin of coinsList || []) {
    if (!XSTOCK_FAMILY_ID.test(coin?.id || '') || coin.id.startsWith('wrapped-')) continue
    for (const [platform, address] of Object.entries(coin.platforms || {})) {
      if (typeof address === 'string' && address) byPlatformAddress.set(`${platform}:${address.toLowerCase()}`, coin)
    }
  }

  const found = new Map()
  for (const token of tokenList?.tokens || []) {
    if (!chainIds.includes(token.chainId)) continue
    const coin = byPlatformAddress.get(`${CG_PLATFORM_BY_CHAIN[token.chainId]}:${String(token.address).toLowerCase()}`)
    if (!coin) continue

    let candidate = found.get(coin.id)
    if (!candidate) {
      candidate = {
        symbol: token.symbol,
        name: stripXStock(token.name),
        address: getAddress(token.address),
        chains: [],
        coingeckoId: coin.id,
        decimals: token.decimals,
        issuer: 'xstocks',
      }
      found.set(coin.id, candidate)
    }
    // Ayni CoinGecko kimligi baska bir ADRESLE gelirse (zincirler arasi uyusmazlik) o girdi
    // aday sayilmaz: katalog "tum zincirlerde ayni adres" varsayimina dayanir.
    if (candidate.address.toLowerCase() !== String(token.address).toLowerCase()) continue
    if (!candidate.chains.includes(token.chainId)) candidate.chains.push(token.chainId)
  }

  let list = [...found.values()]
    .map((c) => ({ ...c, chains: [...c.chains].sort((a, b) => a - b) }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
  if (only) {
    const wanted = new Set(only.map((s) => s.toLowerCase()))
    list = list.filter((c) => wanted.has(c.symbol.toLowerCase()))
  }
  return list
}

/**
 * Adaylari SEMBOL bazinda CoinGecko piyasa degerine gore buyukten kucuge siralar (yeni dizi doner).
 * `prices`: { [coingeckoId]: { usd, marketCap } } (makeLiveDeps.prices). Piyasa degeri OLMAYANLAR (yok, 0,
 * sayi degil) sona gider; onlar arasinda fiyati olan once gelir (fiyatsiz aday referans yokken HER ZAMAN
 * olculemez). Esitlikte sembol alfabetik: sira kosudan kosuya ayni kalir.
 */
export function rankCandidates(candidates, prices) {
  const cap = (c) => {
    const n = Number(prices?.[c.coingeckoId]?.marketCap)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const hasPrice = (c) => Number(prices?.[c.coingeckoId]?.usd) > 0
  return [...candidates].sort((a, b) => {
    const [ca, cb] = [cap(a), cap(b)]
    if (ca !== null || cb !== null) {
      if (ca === null) return 1
      if (cb === null) return -1
      if (ca !== cb) return cb - ca
    } else if (hasPrice(a) !== hasPrice(b)) {
      return hasPrice(a) ? -1 : 1
    }
    return a.symbol.localeCompare(b.symbol)
  })
}

// Katalog dosyasina eklenecek satirlari (insan commit eder) data/xStocks.js bicimiyle basar.
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
export function catalogEntry(c) {
  return [
    '  {',
    `    symbol: ${q(c.symbol)},`,
    `    name: ${q(c.name)},`,
    `    address: ${q(c.address)},`,
    `    chains: [${c.chains.join(', ')}],`,
    `    coingeckoId: ${q(c.coingeckoId)},`,
    `    decimals: ${c.decimals ?? 18},`,
    "    issuer: 'xstocks',",
    '  },',
  ].join('\n')
}

// --- IHRACCI PIYASA KAPISI ---------------------------------------------------------
// GET https://api.xstocks.fi/api/v2/public/assets/{SYMBOL}. Yanit zarfi (ham / data / asset /
// dizi) olculmedi: ayni yere inen dort sekil de kabul edilir.
export function extractTrading(body) {
  const adaylar = [body, body?.data, body?.asset, Array.isArray(body) ? body[0] : null, Array.isArray(body?.data) ? body.data[0] : null]
  for (const aday of adaylar) {
    if (aday && typeof aday === 'object' && aday.trading && typeof aday.trading === 'object') return aday.trading
  }
  return null
}

// Gecerli donemin siparis ust limiti: sayi degilse (alan yok, null, bos, cozulemeyen metin) null.
function periodLimit(trading, period) {
  const raw = period ? trading.limitsPerPeriod?.[period]?.maxOrderFiatValue : undefined
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * @returns {{open: boolean, reason: string|null, period: string|null, nextChangeAt: string|null}}
 * ACIK demek icin UC kosul BIRLIKTE gerekir: `openNow === true` VE gecerli donemin limiti var
 * (`limitsPerPeriod[currentPeriod]`) VE `maxOrderFiatValue > 0`. Baska her durum ACIK DEGILDIR:
 * acikca kapali (`openNow === false` ya da donem limiti 0) -> PIYASA_KAPALI; celiski ya da eksik
 * alan (ornek openNow true ama `closed` donemi) -> PIYASA_DURUMU_BELIRSIZ; trading nesnesi hic
 * yoksa -> TRADING_BILGISI_YOK. Hepsi OLCULEMEDI'dir (CoW a istek atilmaz).
 */
export function tradingGate(trading) {
  if (!trading || typeof trading !== 'object') {
    return { open: false, reason: 'TRADING_BILGISI_YOK', period: null, nextChangeAt: null }
  }
  const period = typeof trading.currentPeriod === 'string' ? trading.currentPeriod : null
  const nextChangeAt = trading.nextChangeAt ?? null
  const limit = periodLimit(trading, period)

  if (trading.openNow === false || limit === 0) {
    return { open: false, reason: 'PIYASA_KAPALI', period, nextChangeAt }
  }
  if (trading.openNow === true && limit !== null && limit > 0) {
    return { open: true, reason: null, period, nextChangeAt }
  }
  return { open: false, reason: 'PIYASA_DURUMU_BELIRSIZ', period, nextChangeAt }
}

// --- FIYAT KAPISI ------------------------------------------------------------------
const scaled = (value, decimals) => Number(value) / 10 ** decimals

function unitPrice({ payRaw, payDecimals, stockRaw, stockDecimals }) {
  try {
    const pay = scaled(BigInt(payRaw), payDecimals)
    const stock = scaled(BigInt(stockRaw), stockDecimals)
    return pay > 0 && stock > 0 ? pay / stock : null
  } catch {
    return null
  }
}

// ALIS teklifi: odenen USDC (sellAmount + feeAmount = ag ucreti DAHIL) / alinan hisse.
export function buyUnitFromQuote(quote, { payDecimals, stockDecimals }) {
  try {
    return unitPrice({ payRaw: BigInt(quote.sellAmount) + BigInt(quote.feeAmount ?? 0), payDecimals, stockRaw: quote.buyAmount, stockDecimals })
  } catch {
    return null
  }
}

// SATIS teklifi: alinan USDC / satilan hisse (sellAmount + feeAmount = ag ucreti DAHIL).
export function sellUnitFromQuote(quote, { payDecimals, stockDecimals }) {
  try {
    return unitPrice({ payRaw: quote.buyAmount, payDecimals, stockRaw: BigInt(quote.sellAmount) + BigInt(quote.feeAmount ?? 0), stockDecimals })
  } catch {
    return null
  }
}

// CoinGecko fiyati carpanli HAM birimdedir; zincirdeki getCurrentMultiplier() (1e18 olcekli)
// ile bolunur (uygulamadaki utils/stockPricing.js unitPriceUsd ile AYNI formul).
export function referencePrice({ coingeckoUsd, multiplier }) {
  try {
    const factor = Number(BigInt(multiplier)) / 1e18
    const price = Number(coingeckoUsd) / factor
    return Number.isFinite(price) && price > 0 ? price : null
  } catch {
    return null
  }
}

export const premiumPct = (unit, reference) => round6((unit / reference - 1) * 100)
export const spreadPct = (buy, sell) => round6((Math.abs(buy - sell) / ((buy + sell) / 2)) * 100)

export function gateDecision({ buyUnit, sellUnit, reference }) {
  if (![buyUnit, sellUnit, reference].every((v) => Number.isFinite(v) && v > 0)) {
    return { pass: false, premiumPct: null, spreadPct: null, sellPct: null, reasons: [REASON.INVALID_PRICE] }
  }
  const premium = premiumPct(buyUnit, reference)
  const spread = spreadPct(buyUnit, sellUnit)
  const sellPct = round6((sellUnit / reference - 1) * 100)
  const reasons = []
  if (premium > MAX_BUY_PREMIUM_PCT) reasons.push(REASON.BUY_PREMIUM)
  // Referansin cok altindaki teklif: sapma degil, referans/carpan guvenilmez (bkz. checkPair: OLCULEMEDI).
  if (premium < MIN_PREMIUM_PCT) reasons.push(REASON.REFERENCE_INCONSISTENT)
  if (spread > MAX_ROUNDTRIP_SPREAD_PCT) reasons.push(REASON.ROUNDTRIP_SPREAD)
  // Referans tutarsizken (alis cok altinda) satis de ayni yonde kayar; kural bastirilir, OLCULEMEDI korunur.
  if (premium >= MIN_PREMIUM_PCT && sellPct < MIN_SELL_PCT) reasons.push(REASON.SELL_DISCOUNT)
  return { pass: reasons.length === 0, premiumPct: premium, spreadPct: spread, sellPct, reasons }
}

// Satis teklifinin buyuklugu: referans fiyatta $10.000 degerinde hisse (18 ondalik, 6 hane
// hassasiyet). Alis teklifinin sonucundan TURETILMEZ: sisirilmis bir alis teklifi satis
// tarafini da sisirirdi.
export function sellAmountForNotional(reference, stockDecimals = 18) {
  const micro = BigInt(Math.floor((GATE_NOTIONAL_USD / reference) * 1e6))
  return (micro * 10n ** BigInt(stockDecimals)) / 1_000_000n
}

// Cikis kodu (yalniz KATALOGDAKI kayitlar icin): 1 sapma / esik asimi, 2 olculemedi, 0 hepsi gecti.
// Kesin sapma, belirsizlikten once gelir.
export function exitCodeFor(results) {
  if (results.some((r) => r.status === 'fail')) return 1
  if (results.some((r) => r.status === 'unmeasured')) return 2
  return 0
}

// --- COW ISTEMCISI -----------------------------------------------------------------
export function classifyQuoteError(status, body) {
  const type = String(body?.errorType ?? '')
  if (status === 404 || type === 'NoLiquidity' || type === 'InsufficientLiquidity') return 'NO_LIQUIDITY'
  return 'REJECTED'
}

export function parseRetryAfter(value) {
  if (value === null || value === undefined || value === '') return null
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS)
}

/**
 * Hiz sinirina uyan CoW teklif istemcisi: iki istek arasi >= minGapMs; 429'da `Retry-After`
 * varsa ona, yoksa retryDefaultMs'e uyulur ve en fazla maxRetries kez yeniden denenir.
 * HICBIR HTTP hatasi firlatmaz; sonuc her zaman bir nesnedir.
 */
export function createCowClient({
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  minGapMs = COW_MIN_GAP_MS,
  retryDefaultMs = COW_RETRY_DEFAULT_MS,
  maxRetries = COW_MAX_RETRIES,
  timeoutMs = COW_REQUEST_TIMEOUT_MS,
  baseUrl = 'https://api.cow.fi',
} = {}) {
  let lastAt = -Infinity

  const waitTurn = async () => {
    const wait = lastAt + minGapMs - now()
    if (wait > 0) await sleep(wait)
    lastAt = now()
  }

  return {
    async quote(chainId, body) {
      const path = COW_PATH_BY_CHAIN[chainId]
      if (!path) return { ok: false, kind: 'UNSUPPORTED_CHAIN' }

      let retries = 0
      for (;;) {
        await waitTurn()

        let response
        try {
          response = await fetchImpl(`${baseUrl}/${path}/api/v1/quote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(body),
            signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined,
          })
        } catch (error) {
          return { ok: false, kind: 'NETWORK', message: String(error?.message || error) }
        }

        if (response.status === 429) {
          if (retries >= maxRetries) return { ok: false, kind: 'RATE_LIMITED', status: 429 }
          retries++
          await sleep(parseRetryAfter(response.headers?.get?.('retry-after')) ?? retryDefaultMs)
          continue
        }

        let json = null
        try {
          json = await response.json()
        } catch {
          json = null
        }
        if (response.status === 200 && json?.quote) return { ok: true, quote: json.quote, verified: json.verified === true }
        return {
          ok: false,
          kind: classifyQuoteError(response.status, json),
          status: response.status,
          message: json?.description || json?.errorType || '',
        }
      }
    },
  }
}

// CoW /quote govdesi. `from` yalniz teklif icindir: hicbir emir imzalanmaz ya da gonderilir.
export const VERIFY_FROM = '0x1111111111111111111111111111111111111111'

export function buildQuoteBody({ side, stock, pay, amount, from = VERIFY_FROM }) {
  const buying = side === 'buy'
  return {
    sellToken: buying ? pay.address : stock.address,
    buyToken: buying ? stock.address : pay.address,
    from,
    receiver: from,
    kind: 'sell',
    sellAmountBeforeFee: String(amount),
    validFor: 1800,
    signingScheme: 'eip712',
    onchainOrder: false,
  }
}

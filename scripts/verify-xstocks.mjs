// verify:xstocks -- KOMUT. Katalogu zincire, ihracciya ve CoW'a karsi sinar; ADAYLARI otomatik bulup
// ayni kapidan gecirir ve katalog satirlarini ONERIR (dosyaya YAZMAZ, insan commit eder).
// CI yok, elle calistirilir ve her yayindan once ZORUNLUDUR:
//   npm run verify:xstocks
//   npm run verify:xstocks -- --candidates TSLAx,NVDAx   (otomatik aday kumesini gecersiz kilar)
//   npm run verify:xstocks -- --limit 100                (onerilecek sembol sayisi; varsayilan 50, en fazla 228)
//   (--candidates=TSLAx,NVDAx de olur; bilinmeyen bayrak / bos liste / gecersiz limit = kullanim hatasi, cikis 2, hic istek yok)
//
// Adaylar CoinGecko piyasa degerine gore (buyukten kucuge) olculur ve ONERILEN benzersiz sembol sayisi
// --limit'e ulasinca durulur; katalogdaki hisseler limitten bagimsiz HER ZAMAN olculur.
//
// Karar mantigi verify-xstocks-core.mjs'te (saf, testli). Bu dosya yalnizca ag/zincir okumalarini
// baglar ve sonucu yazdirir; tum bagimliliklar `deps` ile ENJEKTE EDILIR, bu yuzden testler aga
// cikmaz. Hicbir emir imzalanmaz ya da gonderilir: yalniz POST /quote (okuma).
//
// Cikis kodu (yalniz KATALOGDAKI kayitlar): 0 hepsi gecti, 1 en az bir sapma / esik asimi,
// 2 olculemedi (piyasa kapali, CoW teklifi yok, ag hatasi). Adaylar cikis kodunu ETKILEMEZ.
// Betigin kendisi beklenmedik bir hatayla dusarse de cikis kodu 2'dir.
//
// Hata siniflamasi: zincir okumasi AG/ZAMAN ASIMI ile duserse o alan "okunamadi" sayilir ve cift
// OLCULEMEDI olur; yalniz OKUNMUS ve beklenenden FARKLI bir deger HATA ("SAHTE TOKEN OLABILIR") verir.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { JsonRpcProvider, Contract, getAddress } from 'ethers'
import { XSTOCKS, XSTOCKS_IMPLEMENTATIONS, XSTOCKS_IMPL_SLOT } from '../src/data/xStocks.js'
import {
  GATE_NOTIONAL_USD, PAY_TOKENS, VERIFY_CHAIN_IDS,
  USAGE, DEFAULT_LIMIT, parseArgs, candidatesFromSources, rankCandidates, catalogEntry, extractTrading, tradingGate,
  buyUnitFromQuote, sellUnitFromQuote, referencePrice, gateDecision, sellAmountForNotional,
  buildQuoteBody, exitCodeFor, createCowClient, parseRetryAfter, REASON, MIN_PREMIUM_PCT,
} from './verify-xstocks-core.mjs'

// JSON, import niteligi (`with { type: 'json' }`) olmadan okunur: vitest ve Node ayni sekilde calisir.
const chains = JSON.parse(readFileSync(new URL('../src/data/supported_chains.json', import.meta.url), 'utf8'))

const TOKEN_LIST_URL = 'https://raw.githubusercontent.com/backed-fi/cowswap-xstocks-tokenlist/main/tokenlist.json'
const COINS_LIST_URL = 'https://api.coingecko.com/api/v3/coins/list?include_platform=true'
// Fiyat + piyasa degeri TEK istekte gelir. `simple/price?ids=...` ile ~800 kimlik (~17,5 bin karakter) 414
// "Request-URI Too Large" verdi (olculen: 8,9 bin karakter 200); bu yuzden 250'lik partiler.
const COINGECKO_MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets'
const COINGECKO_BATCH = 250
const COINGECKO_MAX_RETRIES = 2
const COINGECKO_RETRY_DEFAULT_MS = 60_000
const positiveOrNull = (value) => { const n = Number(value); return value != null && Number.isFinite(n) && n > 0 ? n : null }
const ISSUER_ASSET_URL = 'https://api.xstocks.fi/api/v2/public/assets/'
const ISSUER_GAP_MS = 250
const HTTP_TIMEOUT_MS = 20_000

// Ihracci yanitindaki deployments[].network adlari (GERCEK yanittan, 2026-10-11).
const ISSUER_NETWORK_BY_CHAIN = { 1: 'Ethereum', 56: 'BinanceSmartChain', 42161: 'Arbitrum' }

const TOKEN_ABI = [
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function getCurrentMultiplier() view returns (uint256)',
  'function isPaused() view returns (bool)',
]

const ENV_BY_CHAIN = { 1: 'ETH_RPC_URL', 56: 'BSC_RPC_URL', 42161: 'ARBITRUM_RPC_URL' }

// RPC secimi verify-bstocks.mjs ile AYNI kalip: once ortam degiskeni, sonra cuzdanin kendi listesi.
export function rpcUrlFor(chainId, env = process.env) {
  return env[ENV_BY_CHAIN[chainId]] || chains.find((c) => Number(c.chainId) === chainId)?.rpc?.[0]?.url || null
}

// Kontratin KESIN yaniti (revert / bos ya da cozulemeyen veri) "cevap vermiyor" demektir ve bir degerdir (null);
// sunucu hatasi, hiz siniri, zaman asimi, baglanti kopmasi ise OKUNAMADI demektir.
// DIKKAT: ethers, eth_call'a donen HER JSON-RPC hatasini (hiz siniri dahil) CALL_EXCEPTION yapar; bu yuzden
// CALL_EXCEPTION ancak revert verisi tasiyorsa ya da RPC mesaji "revert" diyorsa kesin yanit sayilir.
const isDefiniteAnswer = (error) => {
  if (error?.code === 'BAD_DATA') return true
  if (error?.code !== 'CALL_EXCEPTION') return false
  return error.data != null || /revert/i.test(String(error.info?.error?.message ?? ''))
}
const probe = async (fn) => {
  try {
    return { value: await fn() }
  } catch (error) {
    return isDefiniteAnswer(error) ? { value: null } : { unreadable: true }
  }
}

// --- CANLI BAGIMLILIKLAR -----------------------------------------------------------
export function makeLiveDeps({ env = process.env, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const providers = new Map()
  const providerFor = (chainId) => {
    if (!providers.has(chainId)) {
      const url = rpcUrlFor(chainId, env)
      if (!url) throw new Error(`RPC adresi yok (zincir ${chainId})`)
      providers.set(chainId, new JsonRpcProvider(url, { chainId, name: String(chainId) }, { staticNetwork: true }))
    }
    return providers.get(chainId)
  }

  const getJson = async (url) => {
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
      return { ok: true, body: await response.json() }
    } catch (error) {
      return { ok: false, error: String(error?.message || error) }
    }
  }

  // CoinGecko hiz siniri: 429'da Retry-After (yoksa 60 sn) kadar bekler, en fazla 2 yeniden dener.
  const fetchCoinGeckoRows = async (url) => {
    for (let retries = 0; ; retries++) {
      let response
      try {
        response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
      } catch (error) {
        throw new Error(`CoinGecko coins/markets istegi basarisiz: ${String(error?.message || error)}`)
      }
      if (response.status === 429 && retries < COINGECKO_MAX_RETRIES) {
        await sleep(parseRetryAfter(response.headers?.get?.('retry-after')) ?? COINGECKO_RETRY_DEFAULT_MS)
        continue
      }
      if (!response.ok) throw new Error(`CoinGecko coins/markets istegi basarisiz: HTTP ${response.status}`)
      const body = await response.json()
      if (!Array.isArray(body)) throw new Error('CoinGecko coins/markets yaniti dizi degil (yanit bicimi beklenmedik)')
      return body
    }
  }

  const cow = createCowClient({ fetchImpl, sleep })
  let lastIssuerAt = 0

  return {
    cow,
    async loadSources() {
      const [tokenList, coinsList] = [await getJson(TOKEN_LIST_URL), await getJson(COINS_LIST_URL)]
      if (!tokenList.ok || !coinsList.ok) {
        throw new Error(`aday kaynaklari alinamadi (token listesi: ${tokenList.error ?? 'ok'}, CoinGecko: ${coinsList.error ?? 'ok'})`)
      }
      return { tokenList: tokenList.body, coinsList: coinsList.body }
    },
    // { [coingeckoId]: { usd: number|null, marketCap: number|null } }. Tum kimlikler TEK URL'de ISTENMEZ
    // (~800 kimlik 414 verir, bkz. COINGECKO_BATCH); 250'lik partiler halinde `coins/markets` istenir.
    // Herhangi bir parti dusunce FIRLATIR: sessiz bos sonuc "CoinGecko fiyati alinamadi" yanilgisina yol acar.
    async prices(ids) {
      const unique = [...new Set(ids)]
      const out = {}
      for (let i = 0; i < unique.length; i += COINGECKO_BATCH) {
        const batch = unique.slice(i, i + COINGECKO_BATCH)
        const url = `${COINGECKO_MARKETS_URL}?vs_currency=usd&ids=${encodeURIComponent(batch.join(','))}&per_page=${COINGECKO_BATCH}&page=1`
        const rows = await fetchCoinGeckoRows(url)
        for (const row of rows) {
          if (!row || typeof row.id !== 'string') continue
          out[row.id] = { usd: positiveOrNull(row.current_price), marketCap: positiveOrNull(row.market_cap) }
        }
      }
      return out
    },
    // { hasCode:false } | { hasCode:true, symbol, name, decimals, multiplier, paused, implementation, unreadable:[alan,...] }
    // Alan degeri null: kontrat cevap vermedi (kesin yanit) YA DA okunamadi (alan `unreadable` listesinde).
    async readToken(chainId, address) {
      const provider = providerFor(chainId)
      if ((await provider.getCode(address)) === '0x') return { hasCode: false }
      const token = new Contract(address, TOKEN_ABI, provider)
      const reads = {
        symbol: probe(() => token.symbol()),
        name: probe(() => token.name()),
        decimals: probe(() => token.decimals()),
        multiplier: probe(() => token.getCurrentMultiplier()),
        paused: probe(() => token.isPaused()),
        // Depolama okumasinin "kesin yaniti" yoktur: her hata okunamadi sayilir.
        implementation: provider.getStorage(address, XSTOCKS_IMPL_SLOT).then(
          (slot) => ({ value: slot ? getAddress('0x' + slot.slice(26)) : null }),
          () => ({ unreadable: true }),
        ),
      }
      const names = Object.keys(reads)
      const done = await Promise.all(names.map((name) => reads[name]))
      const out = { hasCode: true, unreadable: [] }
      names.forEach((name, i) => {
        out[name] = done[i].unreadable ? null : done[i].value
        if (done[i].unreadable) out.unreadable.push(name)
      })
      if (out.decimals !== null) out.decimals = Number(out.decimals)
      return out
    },
    async payDecimals(chainId) {
      const token = new Contract(PAY_TOKENS[chainId].address, ['function decimals() view returns (uint8)'], providerFor(chainId))
      return Number(await token.decimals())
    },
    async issuerAsset(symbol) {
      const wait = lastIssuerAt + ISSUER_GAP_MS - Date.now()
      if (wait > 0) await sleep(wait)
      lastIssuerAt = Date.now()
      return getJson(ISSUER_ASSET_URL + encodeURIComponent(symbol))
    },
  }
}

// --- TEK (HISSE, ZINCIR) CIFTININ KAPISI -------------------------------------------
const unmeasured = (reason, extra = {}) => ({ status: 'unmeasured', reason, ...extra })
const failed = (problems, extra = {}) => ({ status: 'fail', problems, ...extra })

// Kapida karar veren alanlar: okunamazlarsa cift OLCULEMEDI olur. `name` ve `paused` yalniz bilgi / uyaridir.
const GATING_FIELDS = ['symbol', 'decimals', 'implementation', 'multiplier']

// Ihracci govdesinden dagitim listesi (govde kokte; `data` / `asset` / dizi zarflari da kabul edilir).
function extractDeployments(body) {
  const adaylar = [body, body?.data, body?.asset, Array.isArray(body) ? body[0] : null, Array.isArray(body?.data) ? body.data[0] : null]
  for (const aday of adaylar) {
    const list = aday && typeof aday === 'object' ? aday.deployments : null
    if (Array.isArray(list) && list.length > 0) return list.filter((d) => d && typeof d === 'object')
  }
  return null
}

/**
 * Sira (ilk basarisizlik durur): zincir okumalari -> ihracci dagitimi ve piyasa kapisi ->
 * referans fiyat -> CoW alis + satis teklifi -> iki yonlu fiyat kapisi.
 * `state`: { prices, payDecimals } ayni kosuda paylasilan onbellek.
 */
export async function checkPair({ stock, chainId, deps, state }) {
  const problems = []
  // Tamami kucuk (ya da buyuk) harfli adres gecerlidir ve EIP-55'e cevrilip oyle kullanilir.
  // KARISIK harfli ama checksum'u yanlis adreste getAddress FIRLATIR: yalniz bu cift HATA olur,
  // kosu diger ciftlerle devam eder (yanlis adresle zincire de gidilmez).
  try {
    stock = { ...stock, address: getAddress(stock.address) }
  } catch {
    return failed(['adres EIP-55 bicimde degil'])
  }

  let token
  try {
    token = await deps.readToken(chainId, stock.address)
  } catch (error) {
    return unmeasured(`zincir okunamadi: ${error?.message || error}`)
  }
  if (!token.hasCode) return failed(['eth_getCode bos: bu zincirde kontrat yok'])

  // Okunamayan alan (ag / zaman asimi) sapma SAYILMAZ; yalniz okunmus ve beklenenden farkli deger sapmadir.
  const unreadable = new Set(token.unreadable ?? [])
  if (!unreadable.has('symbol') && token.symbol !== stock.symbol) problems.push(`symbol zincirde "${token.symbol}", katalogda "${stock.symbol}"`)
  if (!unreadable.has('decimals') && token.decimals !== 18) problems.push(`decimals zincirde ${token.decimals}, beklenen 18`)
  if (!unreadable.has('implementation') && !XSTOCKS_IMPLEMENTATIONS.some((impl) => impl.toLowerCase() === String(token.implementation).toLowerCase())) {
    problems.push(`implementasyon ${token.implementation} - SAHTE TOKEN OLABILIR`)
  }
  if (!unreadable.has('multiplier') && !(typeof token.multiplier === 'bigint' && token.multiplier > 0n)) {
    problems.push('getCurrentMultiplier() cevap vermiyor ya da <= 0')
  }
  const warnings = []
  if (token.paused === true) warnings.push('isPaused() true: transferler durdurulmus')
  if (unreadable.has('paused')) warnings.push('isPaused() okunamadi')
  const meta = { warnings, name: token.name ?? null }

  // Kesin sapma, belirsizlikten once gelir.
  if (problems.length) return failed(problems, meta)
  const unreadableGating = GATING_FIELDS.filter((field) => unreadable.has(field))
  if (unreadableGating.length) return unmeasured(`zincir okunamadi: ${unreadableGating.join(', ')}`, meta)

  // IHRACCI: dagitim (hisse, ZINCIR) basina + piyasa kapisi. Kapali piyasada CoW 200 donup SISKIN fiyat
  // verebilir, bu yuzden kapali hisse kapiya HIC sokulmaz.
  const asset = await deps.issuerAsset(stock.symbol)
  if (!asset.ok) return unmeasured(`ihracci API'sine ulasilamadi: ${asset.error}`, meta)

  const deployments = extractDeployments(asset.body)
  const knownNetworks = Object.values(ISSUER_NETWORK_BY_CHAIN)
  if (!deployments || !deployments.some((d) => knownNetworks.includes(d.network))) {
    return unmeasured('ihracci yanitinda dagitim listesi (deployments) ya da taninan ag adi bulunamadi (yanit bicimi beklenmedik)', meta)
  }
  const network = ISSUER_NETWORK_BY_CHAIN[chainId]
  const listed = deployments.some((d) => d.network === network && typeof d.address === 'string' && d.address.toLowerCase() === stock.address.toLowerCase())
  if (!listed) return failed([`ihracci API'sinde bu adres yok (${network}): ${stock.address}`], meta)

  const gate = tradingGate(extractTrading(asset.body))
  if (!gate.open) {
    const reason = {
      PIYASA_KAPALI: `piyasa kapali, acilis: ${gate.nextChangeAt ?? 'bilinmiyor'}`,
      PIYASA_DURUMU_BELIRSIZ: `PIYASA_DURUMU_BELIRSIZ: ihracci trading bilgisi celiskili ya da eksik (donem: ${gate.period ?? 'yok'}); piyasa acik sayilmadi`,
    }[gate.reason] ?? 'ihracci trading bilgisi yok'
    return unmeasured(reason, { ...meta, period: gate.period })
  }

  const reference = referencePrice({ coingeckoUsd: state.prices?.[stock.coingeckoId]?.usd, multiplier: token.multiplier })
  if (reference === null) return unmeasured('CoinGecko fiyati alinamadi', meta)

  if (state.payDecimals[chainId] === undefined) {
    try {
      state.payDecimals[chainId] = await deps.payDecimals(chainId)
    } catch (error) {
      return unmeasured(`odeme tokeni ondaligi okunamadi: ${error?.message || error}`, meta)
    }
  }
  const payDecimals = state.payDecimals[chainId]
  const pay = PAY_TOKENS[chainId]

  const buy = await deps.cow.quote(chainId, buildQuoteBody({
    side: 'buy', stock, pay, amount: BigInt(GATE_NOTIONAL_USD) * 10n ** BigInt(payDecimals),
  }))
  if (!buy.ok) return unmeasured(`CoW alis teklifi yok (${buy.kind}${buy.message ? ': ' + buy.message : ''})`, meta)

  const sell = await deps.cow.quote(chainId, buildQuoteBody({
    side: 'sell', stock, pay, amount: sellAmountForNotional(reference, stock.decimals),
  }))
  if (!sell.ok) return unmeasured(`CoW satis teklifi yok (${sell.kind}${sell.message ? ': ' + sell.message : ''})`, meta)

  const decimals = { payDecimals, stockDecimals: stock.decimals }
  const buyUnit = buyUnitFromQuote(buy.quote, decimals)
  const sellUnit = sellUnitFromQuote(sell.quote, decimals)
  const decision = gateDecision({ buyUnit, sellUnit, reference })
  const detail = { ...meta, decision, buyUnit, sellUnit, reference }

  // Yalnizca referans tutarsizligi (alis referansin %2 den fazla ALTINDA, baska sapma yok): referans
  // guvenilmez (bayat fiyat, carpan hatasi ya da depeg) -> sapma degil OLCULEMEDI; insan bakmali.
  // Kesin sapma (alis-satis farki gibi) belirsizlikten once gelir ve HATA kalir.
  if (decision.reasons.length === 1 && decision.reasons[0] === REASON.REFERENCE_INCONSISTENT) {
    return unmeasured(
      `${REASON.REFERENCE_INCONSISTENT}: alis primi ${sign(decision.premiumPct)}% (esik ${MIN_PREMIUM_PCT}%); referans $${fmt(reference)} bayat, carpan hatali ya da token depeg olabilir; insan bakmali`,
      detail,
    )
  }

  return decision.pass
    ? { status: 'pass', ...detail }
    : failed(decision.reasons, detail)
}

// --- CIKTI -------------------------------------------------------------------------
const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '-')
const sign = (n) => (n >= 0 ? '+' : '') + fmt(n)

export function formatResultLine(result) {
  const head = `${{ pass: 'TAMAM', fail: 'HATA', unmeasured: 'OLCULEMEDI' }[result.status].padEnd(11)} ${result.symbol.padEnd(8)} ${String(result.chainId).padEnd(6)}`
  // Zincirdeki ad ve uyarilar (ornegin duraklatilmis token) her satirin sonuna yazilir.
  const tail = `${result.name ? ` [${result.name}]` : ''}${(result.warnings ?? []).map((w) => ` UYARI: ${w}`).join('')}`
  if (result.status === 'unmeasured') return `${head} ${result.reason}${tail}`
  if (result.decision) {
    const { decision, buyUnit, sellUnit, reference } = result
    const olcu = `alis ${sign(decision.premiumPct)}% | alis-satis farki ${fmt(decision.spreadPct)}% | satis ${sign(decision.sellPct)}% | alis $${fmt(buyUnit)} satis $${fmt(sellUnit)} ref $${fmt(reference)}`
    return result.status === 'pass' ? `${head} ${olcu}${tail}` : `${head} ${decision.reasons.join(', ')} -- ${olcu}${tail}`
  }
  return `${head} ${result.problems.join('; ')}${tail}`
}

// --- KOSU --------------------------------------------------------------------------
// ADAYLAR piyasa degeri sirasiyla (buyukten kucuge, SEMBOL bazinda) olculur; ONERILEN (en az bir zincirde
// kapidan gecen) benzersiz sembol sayisi `limit`e ulasinca durulur. Bir sembol sayildiktan sonra o sembolun
// KALAN zincirleri de olculur. Kalan adaylar tek ozet satirinda sayilir. KATALOGDAKI cifterin hepsi limitten
// bagimsiz olculur. Fiyatlar (ve piyasa degerleri) kosu basina BIR kez, toplu alinir.
export async function runVerification({ catalog, candidateOverride = null, limit = DEFAULT_LIMIT, deps, log = console.log }) {
  const state = { prices: {}, payDecimals: {} }
  const inCatalog = (stock, chainId) => catalog.some((c) => c.symbol === stock.symbol && c.chains.includes(chainId))

  let candidates = []
  try {
    const sources = await deps.loadSources()
    candidates = candidatesFromSources({ ...sources, only: candidateOverride })
  } catch (error) {
    log(`UYARI: ${error?.message || error} -- yalniz katalog sinanacak`)
  }

  const pairsOf = (stock) =>
    stock.chains.filter((chainId) => VERIFY_CHAIN_IDS.includes(chainId) && !inCatalog(stock, chainId)).map((chainId) => ({ stock, chainId }))
  const catalogPairs = catalog.flatMap((stock) => stock.chains.map((chainId) => ({ stock, chainId })))
  const candidateStocks = candidates.filter((stock) => pairsOf(stock).length > 0)

  const ids = [...new Set([...catalog, ...candidateStocks].map((stock) => stock.coingeckoId))]
  let pricesOk = true
  try {
    state.prices = await deps.prices(ids)
  } catch (error) {
    pricesOk = false
    log(`UYARI: CoinGecko fiyatlari alinamadi (${error?.message || error}) -- referans yok, katalog cifterleri olculemedi sayilir`)
    if (candidateStocks.length) log('UYARI: piyasa degeri sirasi da yok -- adaylar atlandi, yalniz katalog sinanacak')
  }

  // Piyasa degeri sirasi (fiyatlar gelmediyse siralanamaz: aday yok sayilir).
  // Fiyati olmayan aday (usd > 0 degil) HIC olculmez: referans fiyat yok -> checkPair en sonda OLCULEMEDI
  // dondurur, ama o noktaya kadar zincir okumasi + ihracci istegi harcanmis olur ve olculemedi sayisini
  // sismirir. Bunlar tek ozet satirina yazilir; fiyatlilar piyasa degeri sirasiyla olculur.
  const ranked = pricesOk ? rankCandidates(candidateStocks, state.prices).map((stock) => ({ stock, pairs: pairsOf(stock) })) : []
  const hasUsdPrice = ({ stock }) => Number(state.prices?.[stock.coingeckoId]?.usd) > 0
  const groups = ranked.filter(hasUsdPrice)
  const unpriced = ranked.filter((g) => !hasUsdPrice(g))
  const noPrice = { symbols: unpriced.length, pairs: unpriced.reduce((n, g) => n + g.pairs.length, 0) }
  const totalCandidatePairs = groups.reduce((n, g) => n + g.pairs.length, 0)

  log(`${catalogPairs.length} katalog cifti, ${totalCandidatePairs} aday cifti (${groups.length} sembol; limit ${limit}) sinaniyor...\n`)

  const run = async (pairs) => {
    const out = []
    for (const { stock, chainId } of pairs) {
      const result = { symbol: stock.symbol, chainId, ...(await checkPair({ stock, chainId, deps, state })) }
      log(formatResultLine(result))
      out.push(result)
    }
    return out
  }

  log('--- KATALOG ---')
  const catalogResults = await run(catalogPairs)
  log('\n--- ADAYLAR (piyasa degerine gore) ---')
  const candidateResults = []
  const passedSymbols = new Set()
  let measuredSymbols = 0
  let skipped = { symbols: 0, pairs: 0 }
  let stopReason = groups.length ? 'aday listesi bitti' : noPrice.pairs ? 'fiyatli aday yok' : 'aday yok'
  for (let g = 0; g < groups.length; g++) {
    if (passedSymbols.size >= limit) {
      const rest = groups.slice(g)
      skipped = { symbols: rest.length, pairs: rest.reduce((n, x) => n + x.pairs.length, 0) }
      stopReason = `limit doldu (${limit} sembol kapidan gecti)`
      break
    }
    const results = await run(groups[g].pairs)
    measuredSymbols++
    candidateResults.push(...results)
    if (results.some((r) => r.status === 'pass')) passedSymbols.add(groups[g].stock.symbol)
  }
  if (skipped.pairs) {
    log(`OLCULMEDI (limit)  ${skipped.pairs} aday cifti (${skipped.symbols} sembol) ${limit} sembollik limit doldugu icin sorulmadi`)
  }
  if (noPrice.pairs) {
    log(`OLCULMEDI (fiyat yok)  ${noPrice.pairs} aday cifti (${noPrice.symbols} sembol) CoinGecko fiyati olmadigi icin sorulmadi`)
  }

  // Gecen adaylardan katalog satiri onerisi: mevcut `chains` ile birlestirilir.
  const suggestions = []
  const bySymbol = new Map()
  for (const r of candidateResults.filter((x) => x.status === 'pass')) {
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, [])
    bySymbol.get(r.symbol).push(r.chainId)
  }
  for (const [symbol, newChains] of bySymbol) {
    const candidate = candidates.find((c) => c.symbol === symbol)
    const existing = catalog.find((c) => c.symbol === symbol)
    const merged = [...new Set([...(existing?.chains ?? []), ...newChains])].sort((a, b) => a - b)
    suggestions.push({ action: existing ? 'GUNCELLE' : 'EKLE', entry: catalogEntry({ ...candidate, chains: merged }) })
  }
  if (suggestions.length) {
    log('\n--- ONERILEN KATALOG SATIRLARI (dosyaya YAZILMAZ; elle ekleyip commit edin) ---')
    for (const s of suggestions) log(`// ${s.action}\n${s.entry}`)
  }

  const count = (list, status) => list.filter((r) => r.status === status).length
  log(`\nKatalog: ${count(catalogResults, 'pass')} gecti, ${count(catalogResults, 'fail')} sapma, ${count(catalogResults, 'unmeasured')} olculemedi`)
  log(`Adaylar: ${count(candidateResults, 'pass')} gecti, ${count(candidateResults, 'fail')} elendi, ${count(candidateResults, 'unmeasured')} olculemedi`)
  log(`Limit ${limit}, olculen sembol ${measuredSymbols}, onerilen sembol ${passedSymbols.size}, durma nedeni: ${stopReason}`)

  return {
    catalogResults, candidateResults, suggestions, exitCode: exitCodeFor(catalogResults),
    limit, measuredSymbols, suggestedSymbols: passedSymbols.size, skipped, noPrice, stopReason,
  }
}

// `makeDeps` / `catalog`: yalniz testler icin (canli bagimlilik ve gercek katalog varsayilandir).
export async function main(argv = process.argv.slice(2), env = process.env, { makeDeps = makeLiveDeps, catalog = XSTOCKS } = {}) {
  // Kullanim hatasi (bilinmeyen bayrak, bos liste...): kullanim mesaji, cikis 2; CoW a ve zincire
  // HIC istek atilmaz (deps ve aday kaynaklari parseArgs gecmeden kurulmaz).
  let args
  try {
    args = parseArgs(argv)
  } catch (error) {
    console.error(`HATA: ${error?.message || error}`)
    console.error(USAGE)
    process.exitCode = 2
    return
  }
  const deps = makeDeps({ env })
  const outcome = await runVerification({ catalog, candidateOverride: args.candidates, limit: args.limit, deps })
  process.exitCode = outcome.exitCode
}

// Dogrudan calistirildiginda kosar; test icin ice aktarildiginda AGA CIKMAZ.
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error('HATA:', error?.message || error)
    process.exitCode = 2
  })
}

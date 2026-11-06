// Tokenize hisse BAKIYE ve CARPAN okumasi: zincir basina TEK Multicall3 cagrisi.
//
// NEDEN: Hisseler sekmesi her zincirde N token tasir (BSC'de 22 bStock + xStocks).
// Tek tek `getCode + balanceOf + decimals` yuzlerce RPC istegi demekti; Multicall3
// (uc zincirde de ayni adreste kodlu) zincir basina 1 cagriya indirir.
//
// HANGI OKUMA FONKSIYONUNUN CAGRILACAGI `hasUiMultiplier` ile TEK YERDE belirlenir ve
// useTokenBalance ayni karari kullanir: bStocks balanceOfUI (BEP-677, carpan uygulanmis),
// xStocks balanceOf (ZATEN carpanli). Ondalik katalogdan gelir (18): decimals() cagrisi yok.
//
// BASARISIZ OKUMA SIFIR DEGILDIR: tek bir tokenin okumasi duserse o tokenin `balance`i
// `null` ("bilinmiyor") olur, ekran tire yazar; 0 yazmak kullanicinin varligini yok sanmasina
// yol acardi (Token.vue "bakiye hata durumunda asla 0 gostermez" ilkesi).

import { Interface, JsonRpcProvider } from 'ethers'
import { hasUiMultiplier, stockIssuer, stockKey } from './tokenizedStocks'

// Ethereum, BSC ve Arbitrum'da kodlu (2026-10-10, eth_getCode).
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

// Carpan bellek onbellegi omru (spec 5.3).
export const MULTIPLIER_TTL_MS = 60_000

// Carpan okumasinin ust siniri (ms). ensureMultipliersFor Varliklar / Gonder turunda AWAIT
// edilir; takili bir RPC ethers'in 300 sn varsayilanina kadar turu tutmasin diye zincir basina
// bu sureden sonra vazgecilir ve carpan bilinmiyor (tire) kalir.
export const MULTIPLIER_FETCH_TIMEOUT_MS = 6_000

// Interface nesneleri ILK KULLANIMDA kurulur, modul yuklenirken DEGIL. Kismi `vi.mock('ethers')`
// yapan testler (Token / Home ekranlari) bu modulu dolayli import eder; mock'ta `Interface`
// yoksa modul duzeyindeki `new Interface` import ANINDA patlar ve tum test dosyasini dusurur
// (nativeAsset.js ile ayni sinif hata: orada ethers importu bu yuzden yok).
let erc20Interface = null
const erc20 = () => (erc20Interface ??= new Interface([
  'function balanceOf(address owner) view returns (uint256)',
  'function balanceOfUI(address owner) view returns (uint256)',
  'function getCurrentMultiplier() view returns (uint256)',
]))

let multicallInterface = null
const multicall = () => (multicallInterface ??= new Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
]))

export function encodeAggregate3(calls) {
  return multicall().encodeFunctionData('aggregate3', [
    calls.map(({ target, allowFailure, callData }) => [target, allowFailure, callData]),
  ])
}

export function decodeAggregate3(data) {
  const [results] = multicall().decodeFunctionResult('aggregate3', data)
  return results.map((r) => ({ success: Boolean(r[0]), returnData: String(r[1]) }))
}

// uint256 donuslu bir cagrinin ham verisi -> bigint | null (bos / bozuk veri = bilinmiyor).
function uint256(returnData) {
  try {
    return erc20().decodeFunctionResult('balanceOf', returnData)[0]
  } catch {
    return null
  }
}

// --- CARPAN ONBELLEGI --------------------------------------------------------------
// Anahtar zincir+adres (ayni adres uc zincirde ayri token). Hisseler Multicall'i
// doldurur; Varliklar, Token detayi ve Gonder secicisi eksigi tek cagriyla doldurur.
const cache = new Map()

export function rememberMultiplier(chainId, address, multiplier, now = Date.now()) {
  cache.set(stockKey(chainId, address), { multiplier, at: now })
}

// Omru dolmus ya da saati geriye alinmis (negatif sure) kayit GECERSIZ: null doner.
export function multiplierFor(chainId, address, now = Date.now()) {
  const key = stockKey(chainId, address)
  const hit = cache.get(key)
  if (!hit) return null
  const age = now - hit.at
  if (age < 0 || age >= MULTIPLIER_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.multiplier
}

export function _resetMultiplierCache() {
  cache.clear()
}

// --- OKUMA -------------------------------------------------------------------------
// staticNetwork: eth_chainId turu yok (bridge.js ile ayni kalip).
const makeProvider = (rpcUrl, chainId) =>
  new JsonRpcProvider(rpcUrl, { chainId: Number(chainId), name: String(chainId) }, { staticNetwork: true })

const positive = (v) => (typeof v === 'bigint' && v > 0n ? v : null)

/**
 * @param {object} p
 * @param {number|string} p.chainId
 * @param {string} p.owner          bakiyesi okunan adres
 * @param {Array<{address:string}>} p.entries   katalog satirlari (tokenizedStocks kaydi)
 * @param {string} [p.rpcUrl]
 * @param {{call: Function}} [p.provider]   test icin; verilmezse rpcUrl'den kurulur
 * @returns {Promise<Map<string, {balance: bigint|null, multiplier: bigint|null}>>}
 *          anahtar: adres (kucuk harf). `multiplier` yalniz xStocks icin dolu olabilir.
 *          Multicall3 cagrisinin KENDISI duserse FIRLATIR (cagiran o zincirin satirlarini
 *          tire yapar); tek tokenlik hata o tokenin `balance: null` olmasiyla gosterilir.
 */
export async function readStockBalances({ chainId, owner, entries, rpcUrl, provider = null, now = Date.now() }) {
  const out = new Map()
  if (!entries?.length) return out

  const rpc = provider ?? makeProvider(rpcUrl, chainId)
  const calls = []
  const plan = entries.map((entry) => {
    const scaled = hasUiMultiplier(chainId, entry.address)
    const slot = { entry, scaled, balanceAt: calls.length, multiplierAt: null }
    calls.push({
      target: entry.address,
      allowFailure: true,
      callData: erc20().encodeFunctionData(scaled ? 'balanceOfUI' : 'balanceOf', [owner]),
    })
    if (stockIssuer(chainId, entry.address) === 'xstocks') {
      slot.multiplierAt = calls.length
      calls.push({ target: entry.address, allowFailure: true, callData: erc20().encodeFunctionData('getCurrentMultiplier', []) })
    }
    return slot
  })

  const first = decodeAggregate3(await rpc.call({ to: MULTICALL3_ADDRESS, data: encodeAggregate3(calls) }))
  if (first.length !== calls.length) throw new Error('Multicall3 sonuc sayisi beklenenle uyusmuyor')

  const fallbacks = []
  for (const slot of plan) {
    const key = slot.entry.address.toLowerCase()
    const b = first[slot.balanceAt]
    const balance = b.success ? uint256(b.returnData) : null

    let multiplier = null
    if (slot.multiplierAt !== null) {
      const m = first[slot.multiplierAt]
      multiplier = m.success ? positive(uint256(m.returnData)) : null
      if (multiplier !== null) rememberMultiplier(chainId, slot.entry.address, multiplier, now)
    }

    out.set(key, { balance, multiplier })
    if (balance === null && slot.scaled) fallbacks.push(slot)
  }

  // Beacon yukseltmesi balanceOfUI'yi kaldirirsa ham bakiyeye dus (useTokenBalance ile AYNI
  // kural): eksik veri yuzunden bakiyeyi GIZLEMEKTENSE zincirdeki degeri gostermek dogru.
  if (fallbacks.length) {
    console.warn(`balanceOfUI cevap vermedi, balanceOf'a dusuluyor: ${fallbacks.length} token`)
    try {
      const retry = fallbacks.map((slot) => ({
        target: slot.entry.address,
        allowFailure: true,
        callData: erc20().encodeFunctionData('balanceOf', [owner]),
      }))
      const second = decodeAggregate3(await rpc.call({ to: MULTICALL3_ADDRESS, data: encodeAggregate3(retry) }))
      fallbacks.forEach((slot, i) => {
        const r = second[i]
        const value = r?.success ? uint256(r.returnData) : null
        if (value !== null) out.get(slot.entry.address.toLowerCase()).balance = value
      })
    } catch (error) {
      console.warn('balanceOf yedek turu da basarisiz:', error?.message || error)
    }
  }

  return out
}

// Eksik / omru dolmus carpanlari TEK Multicall3 ile doldurur. Zincir basina cagirilir.
export async function ensureMultipliers({ chainId, addresses, rpcUrl, provider = null, now = Date.now() }) {
  const missing = (addresses || []).filter((address) => multiplierFor(chainId, address, now) === null)
  if (!missing.length) return

  const rpc = provider ?? makeProvider(rpcUrl, chainId)
  const calls = missing.map((target) => ({
    target,
    allowFailure: true,
    callData: erc20().encodeFunctionData('getCurrentMultiplier', []),
  }))
  const results = decodeAggregate3(await rpc.call({ to: MULTICALL3_ADDRESS, data: encodeAggregate3(calls) }))

  missing.forEach((address, i) => {
    const r = results[i]
    const value = r?.success ? positive(uint256(r.returnData)) : null
    if (value !== null) rememberMultiplier(chainId, address, value, now)
  })
}

/**
 * Tuketicilerin (Varliklar, Token detayi, Gonder secicisi) tek giris noktasi.
 * `tokens`: [{ chainId, address }]. xStock OLMAYANLAR yok sayilir; xStock yoksa HICBIR
 * ag istegi yapilmaz. Hata YUTULUR ve uyari yazar: carpan bilinmezse tuketici deger
 * yerine tire gosterir (multiplierFor null doner). Her zincir `timeoutMs` ile sinirlidir;
 * asili RPC tum turu tutmaz (zaman asimi da ayni yoldan yutulur).
 */
export async function ensureMultipliersFor(
  tokens,
  { rpcFor, now = Date.now(), provider = null, timeoutMs = MULTIPLIER_FETCH_TIMEOUT_MS } = {},
) {
  const byChain = new Map()
  for (const token of tokens || []) {
    if (stockIssuer(token.chainId, token.address) !== 'xstocks') continue
    const id = Number(token.chainId)
    if (!byChain.has(id)) byChain.set(id, new Set())
    byChain.get(id).add(token.address)
  }

  await Promise.all([...byChain].map(async ([chainId, addresses]) => {
    try {
      const rpcUrl = provider ? null : rpcFor?.(chainId)
      if (!provider && !rpcUrl) return
      let timer = null
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`zaman asimi (${timeoutMs} ms)`)), timeoutMs)
      })
      try {
        await Promise.race([
          ensureMultipliers({ chainId, addresses: [...addresses], rpcUrl, provider, now }),
          timeout,
        ])
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      console.warn(`Hisse carpani okunamadi (zincir ${chainId}):`, error?.message || error)
    }
  }))
}

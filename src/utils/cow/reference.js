// CoW referans ve piyasa girdileri (spec 6.4 adim 1-3, 8.3, K1, K14): CoinGecko fiyati SUNUCUDAN, carpan ZINCIRDEN
// (cow/chain.js), ihracci `trading` bilgisi ihracci API'sinden. HICBIRI firlatmaz: eksik olan null doner ve
// kilide gider (K1(a)). Bayatlik olculmez (K14: yanitta price_updated_at yok).
// Popup ile arka plan AYRI JS baglami oldugundan stockBalances.js carpan onbellegi KULLANILMAZ.
import { ISSUER_ASSET_URL } from './config'
import { referenceFrom } from './pricing'
import { extractTrading } from './marketGate'

export const REFERENCE_TTL_MS = 30_000
export const TRADING_TTL_MS = 30_000
export const HTTP_TIMEOUT_MS = 6000

const HATA = Object.freeze({ ok: false, trading: null })

// Korumali JSON: bozuk govde (HTML 502 sayfasi vb.) firlatmaz.
function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, value: null }
  }
}

// Gecerli CoinGecko fiyati: sonlu ve > 0 (sayi ya da sayisal dize); aksi null.
function validPrice(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
}

export function createCowReference({
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000',
  chain,
  now = Date.now,
} = {}) {
  const referenceCache = new Map()
  const tradingCache = new Map()

  // fetch + res.text() birlikte zaman asimli; AbortController yedek, Promise.race asil koruma (sahte fetch sinyali yok sayabilir).
  async function fetchText(url, init) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    let timer
    const zamanAsimi = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort()
        reject(new Error('timeout'))
      }, HTTP_TIMEOUT_MS)
    })
    try {
      return await Promise.race([
        (async () => {
          const res = await fetchImpl(url, { ...init, ...(controller ? { signal: controller.signal } : {}) })
          return { status: res.status, text: await res.text() }
        })(),
        zamanAsimi,
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  async function fetchPrice(stock) {
    try {
      const id = stock?.coingeckoId
      if (typeof id !== 'string' || id === '') return null
      const { status, text } = await fetchText(`${String(apiBase).replace(/\/+$/, '')}/getTokensDataById`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
        credentials: 'omit',
        cache: 'no-store',
      })
      if (status !== 200) return null
      const parsed = parseJson(text)
      if (!parsed.ok) return null
      const tokens = parsed.value?.tokens
      if (!Array.isArray(tokens)) return null
      // sunucu bulunmayan kimligi SESSIZCE dusurur (bos dizi = null); yalniz AYNI kimlikli kayit kabul edilir
      const kayit = tokens.find((t) => t && t.coingecko_id === id)
      return validPrice(kayit?.market_data?.priceUSD)
    } catch {
      return null
    }
  }

  async function fetchMultiplier(chainId, stock) {
    try {
      const m = await chain.readMultiplier(chainId, stock.address)
      return typeof m === 'bigint' && m > 0n ? m : null
    } catch {
      return null
    }
  }

  async function getReference(chainId, stock) {
    try {
      const key = `${Number(chainId)}:${String(stock?.address).toLowerCase()}:${stock?.coingeckoId}`
      const hit = referenceCache.get(key)
      if (hit && now() - hit.at < REFERENCE_TTL_MS) return { ...hit.value }
      const [priceUsd, multiplier] = await Promise.all([fetchPrice(stock), fetchMultiplier(chainId, stock)])
      const value = { reference: referenceFrom({ priceUsd, multiplier }), priceUsd, multiplier }
      // yalniz basarili sonuc onbellege girer; null tekrar denenir
      if (value.reference != null) referenceCache.set(key, { at: now(), value })
      return { ...value }
    } catch {
      return { reference: null, priceUsd: null, multiplier: null }
    }
  }

  // Govde zarf adaylari extractTrading ile AYNI; trading'i tasiyan adayin `symbol`u (varsa) katalogdakiyle ayni olmali.
  function symbolMismatch(body, symbol) {
    const adaylar = [body, body?.data, body?.asset, Array.isArray(body) ? body[0] : null, Array.isArray(body?.data) ? body.data[0] : null]
    return adaylar.some((a) => a && typeof a === 'object' && a.symbol !== undefined && a.symbol !== symbol)
  }

  async function getTrading(stock) {
    try {
      const symbol = stock?.symbol
      if (typeof symbol !== 'string' || symbol === '') return { ...HATA }
      const hit = tradingCache.get(symbol)
      if (hit && now() - hit.at < TRADING_TTL_MS) return { ok: true, trading: hit.trading }
      // sembol YALNIZ katalogdan gelir (arayuzden degil)
      const { status, text } = await fetchText(ISSUER_ASSET_URL + encodeURIComponent(symbol), {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
      })
      if (status !== 200) return { ...HATA }
      const parsed = parseJson(text)
      if (!parsed.ok) return { ...HATA }
      if (symbolMismatch(parsed.value, symbol)) return { ...HATA }
      const trading = extractTrading(parsed.value)
      if (!trading) return { ...HATA }
      tradingCache.set(symbol, { at: now(), trading })
      return { ok: true, trading }
    } catch {
      return { ...HATA }
    }
  }

  return { getReference, getTrading }
}

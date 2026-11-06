// Piyasa durumu (TK9): yalniz xStocks icin ihracci API'sinden `trading.openNow`.
// Salt-okunur GET, 6 sn zaman asimi. Kaynak yok / hata / belirsiz -> null (satir hic cizilmez).
// bStocks icin kaynak YOK: null. Statik "ABD borsasi saati" tahmini YAPILMAZ.
// Ayristirma utils/cow/marketGate.js yardimcilarindan okunur (o dosya DEGISTIRILMEZ).

import { ISSUER_ASSET_URL } from '../cow/config'
import { extractTrading, marketNotice } from '../cow/marketGate'

export const MARKET_STATUS_TIMEOUT_MS = 6_000

/**
 * @param {{issuer:string, symbol:string}} entry
 * @param {{fetchImpl?:Function, timeoutMs?:number}} [opts]
 * @returns {Promise<null | {state:'open'|'closed', nextChangeAt:string|null}>}
 */
export async function fetchMarketStatus(entry, { fetchImpl = globalThis.fetch, timeoutMs = MARKET_STATUS_TIMEOUT_MS } = {}) {
  if (!entry || entry.issuer !== 'xstocks' || typeof entry.symbol !== 'string' || !entry.symbol) return null
  if (typeof fetchImpl !== 'function') return null

  const controller = typeof AbortController === 'function' ? new AbortController() : null
  let timer = null
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller?.abort()
      resolve(null)
    }, timeoutMs)
  })

  const work = (async () => {
    const response = await fetchImpl(ISSUER_ASSET_URL + encodeURIComponent(entry.symbol), {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      ...(controller ? { signal: controller.signal } : {}),
    })
    if (!response || response.status !== 200) return null
    const body = await response.json()
    const candidates = [body, body?.data, body?.asset, Array.isArray(body) ? body[0] : null, Array.isArray(body?.data) ? body.data[0] : null]
    if (candidates.some((c) => c && typeof c === 'object' && c.symbol !== undefined && c.symbol !== entry.symbol)) return null
    const trading = extractTrading(body)
    if (!trading) return null
    const notice = marketNotice(trading)
    return notice.state === 'unknown' ? null : { state: notice.state, nextChangeAt: notice.nextChangeAt }
  })().catch(() => null)

  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

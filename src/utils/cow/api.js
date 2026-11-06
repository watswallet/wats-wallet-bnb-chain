// CoW HTTP istemcisi (spec 5.4 ag kurallari, 6.1, 9): seri kuyruk (iki istek baslangici arasi >= minGapMs),
// zaman asimi 10 sn, en fazla 1 yeniden deneme (403 haric). HICBIR yontem firlatmaz: { ok } doner.
// DuplicatedOrder BASARIDIR (K9): UID deterministik, ikinci POST ayni emri uretir.
// Imza / govde HICBIR yerde console'a yazilmaz.
import { COW_API_BASE, COW_TIMEOUT_MS, COW_MIN_GAP_MS, COW_RETRY_DEFAULT_MS, cowPathFor } from './config'
import { COW_ERROR, classifyCowError } from './errors'

const RETRY_AFTER_CAP_MS = 5000
const UID_RE = /^0x[0-9a-f]{112}$/i

/** Retry-After (saniye) -> ms, en fazla capMs. Gecersiz / bos / negatif / HTTP-date -> null. */
export function parseRetryAfter(value, capMs = Infinity) {
  let seconds
  if (typeof value === 'number') seconds = value
  else if (typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value)) seconds = Number(value)
  else return null
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return Math.min(seconds * 1000, capMs)
}

// CoW "SellAmountDoesNotCoverFee" govdesi: data.fee_amount ondalik ya da 0x hex dize. YALNIZ dogrulanmis pozitif
// tamsayi (rakam dizesi) cikar; ham govde / metin hicbir yere tasinmaz. Gecersiz, sifir, negatif, 10^36 ustu -> null.
const FEE_AMOUNT_MAX = 10n ** 36n
export function parseFeeAmount(value) {
  if (typeof value !== 'string' || !/^(?:[0-9]{1,40}|0x[0-9a-fA-F]{1,40})$/.test(value)) return null
  const n = BigInt(value)
  return n > 0n && n <= FEE_AMOUNT_MAX ? n.toString() : null
}

const TIMED_OUT = Symbol('timedOut')
const NETWORK_FAILED = Symbol('networkFailed')

const parseJson = (text) => {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, value: null }
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

const invalid = (code) => ({ ok: false, code })

export function createCowApi({
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  baseUrl = COW_API_BASE,
  timeoutMs = COW_TIMEOUT_MS,
  minGapMs = COW_MIN_GAP_MS,
  retryDefaultMs = COW_RETRY_DEFAULT_MS,
  maxRetries = 1,
} = {}) {
  let lastAt = -Infinity
  let tail = Promise.resolve()

  // Tek seri kuyruk: yeniden denemeler dahil her yontem sirayla calisir (SW'de teklif + yoklama cakisabilir).
  const enqueue = (job) => {
    const run = tail.then(job, job)
    tail = run.then(() => {}, () => {})
    return run
  }

  const waitTurn = async () => {
    const wait = lastAt + minGapMs - now()
    if (wait > 0) await sleep(wait)
    lastAt = now()
  }

  // Tek HTTP denemesi: { status, retryAfter, text } | TIMED_OUT | NETWORK_FAILED. Asla firlatmaz.
  const send = async (url, init) => {
    const controller = new AbortController()
    let timer
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve(TIMED_OUT)
      }, timeoutMs)
    })
    const work = (async () => {
      try {
        const res = await fetchImpl(url, { ...init, signal: controller.signal, credentials: 'omit', cache: 'no-store' })
        const text = await res.text()
        return { status: res.status, retryAfter: res.headers?.get?.('retry-after') ?? null, text }
      } catch {
        return controller.signal.aborted ? TIMED_OUT : NETWORK_FAILED
      }
    })()
    try {
      return await Promise.race([work, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * @param {{ context: string, url: string, init: object, onSuccess: (status: number, text: string) => object }} istek
   */
  const request = ({ context, url, init, onSuccess }) =>
    enqueue(async () => {
      try {
        for (let attempt = 0; ; attempt++) {
          await waitTurn()
          const r = await send(url, init)

          let failure
          let status
          let errorBody = null
          if (r === TIMED_OUT) failure = classifyCowError({ context, timedOut: true })
          else if (r === NETWORK_FAILED) failure = classifyCowError({ context, networkError: true })
          else if (r.status >= 200 && r.status < 300) return onSuccess(r.status, r.text)
          else {
            status = r.status
            const parsed = parseJson(r.text)
            errorBody = parsed.ok ? parsed.value : null
            failure = classifyCowError({ context, status, body: errorBody })
          }

          if (context === 'order' && failure.code === COW_ERROR.DUPLICATED_ORDER) {
            return { ok: true, data: null, status, duplicated: true }
          }
          if (failure.retryable && attempt < maxRetries) {
            const header = r === TIMED_OUT || r === NETWORK_FAILED ? null : r.retryAfter
            await sleep(parseRetryAfter(header, RETRY_AFTER_CAP_MS) ?? retryDefaultMs)
            continue
          }
          const out = { ok: false, code: failure.code }
          if (status !== undefined) out.status = status
          if (failure.detail !== undefined) out.detail = failure.detail
          if (context === 'quote' && failure.code === COW_ERROR.AMOUNT_TOO_SMALL) {
            const fee = parseFeeAmount(isObject(errorBody?.data) ? errorBody.data.fee_amount : undefined)
            if (fee !== null) out.feeAtoms = fee
          }
          return out
        }
      } catch {
        // Beklenmeyen ic hata bile sozlesmeyi bozmaz (asla firlatma).
        return { ok: false, code: COW_ERROR.UNKNOWN }
      }
    })

  const jsonOk = (status, text, check) => {
    const parsed = parseJson(text)
    if (!parsed.ok) return { ok: false, code: COW_ERROR.BAD_RESPONSE, status }
    if (check) {
      const kod = check(parsed.value)
      if (kod) return { ok: false, code: kod, status }
    }
    return { ok: true, data: parsed.value, status }
  }

  const headers = (json) => (json ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' })

  const orderRead = (context, suffix) => (chainId, uid) => {
    const path = cowPathFor(chainId)
    if (path === null) return Promise.resolve(invalid(COW_ERROR.UNSUPPORTED_CHAIN))
    if (typeof uid !== 'string' || !UID_RE.test(uid)) return Promise.resolve(invalid(COW_ERROR.INVALID_REQUEST))
    return request({
      context,
      url: `${baseUrl}/${path}${suffix(uid)}`,
      init: { method: 'GET', headers: headers(false) },
      onSuccess: (status, text) => jsonOk(status, text),
    })
  }

  return {
    quote(chainId, body) {
      const path = cowPathFor(chainId)
      if (path === null) return Promise.resolve(invalid(COW_ERROR.UNSUPPORTED_CHAIN))
      if (!isObject(body) || body.kind !== 'sell' || !sameAddress(body.receiver, body.from)) {
        return Promise.resolve(invalid(COW_ERROR.INVALID_REQUEST))
      }
      return request({
        context: 'quote',
        url: `${baseUrl}/${path}/api/v1/quote`,
        // Govde BIREBIR JSON.stringify(girdi): appData kacislari yeniden serilestirmeyle degismesin.
        init: { method: 'POST', headers: headers(true), body: JSON.stringify(body) },
        onSuccess: (status, text) =>
          jsonOk(status, text, (v) =>
            isObject(v) && isObject(v.quote) && v.id !== undefined && v.id !== null &&
            typeof v.expiration === 'string' && v.expiration !== ''
              ? null
              : COW_ERROR.BAD_QUOTE_RESPONSE),
      })
    },

    postOrder(chainId, body) {
      const path = cowPathFor(chainId)
      if (path === null) return Promise.resolve(invalid(COW_ERROR.UNSUPPORTED_CHAIN))
      // Guvenlik degismezi 2: istek atilmadan once emir govdesi sabit sekle uymali.
      const ok =
        isObject(body) &&
        body.feeAmount === '0' &&
        body.kind === 'sell' &&
        sameAddress(body.receiver, body.from) &&
        body.signingScheme === 'eip712' &&
        body.partiallyFillable === false &&
        body.sellTokenBalance === 'erc20' &&
        body.buyTokenBalance === 'erc20' &&
        typeof body.appData === 'string'
      if (!ok) return Promise.resolve(invalid(COW_ERROR.INVALID_ORDER))
      return request({
        context: 'order',
        url: `${baseUrl}/${path}/api/v1/orders`,
        init: { method: 'POST', headers: headers(true), body: JSON.stringify(body) },
        onSuccess: (status, text) => {
          const parsed = parseJson(text)
          if (!parsed.ok || typeof parsed.value !== 'string') return { ok: false, code: COW_ERROR.BAD_RESPONSE, status }
          return { ok: true, data: parsed.value, status }
        },
      })
    },

    getOrder: orderRead('orderGet', (uid) => `/api/v1/orders/${uid}`),
    getOrderStatus: orderRead('status', (uid) => `/api/v1/orders/${uid}/status`),
    getTrades: orderRead('trades', (uid) => `/api/v2/trades?orderUid=${uid}`),
  }
}

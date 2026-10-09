// Okuma gecidi TASIYICISI: izinli bir salt-okuma RPC cagrisini service worker'dan
// DOGRUDAN zincirin public RPC'lerine iletir. Politika (hangi ad) evmRpcPolicy.js'te.
//
// NEDEN BOYLE:
//   - ethers KULLANILMAZ: hatayi kendi tipine sarar ve `error.data` (revert verisi)
//     kaybolur. Ham fetch ile {code, message, data} birebir elde edilir.
//   - URL'ler PAKETLI supported_chains verisinden, cagri anindaki chainId ile bulunur;
//     depodaki `currentNetwork.rpc` (kullanici/uzak veri) ASLA kullanilmaz.
//   - host_permissions <all_urls> oldugu icin CORS yok; manifest degismez.
//   - Hicbir sey onbellege alinmaz (eth_blockNumber taze olmali).
//
// SOZLESME: forwardRead({ method, params, chain, origin, deps })
//             -> { ok: true, result } | { ok: false, error: { code, message, data? } }
//   Cagiran (T14b `default:` kablolamasi) ONCE aktif agin EVM oldugunu denetler (4901) ve
//   `chain` olarak O ANKI aktif ag kaydini verir. Burada yalniz `chain.chainId` okunur.
//   Her hata nesnesi SAYISAL `code` tasir; hata metninde RPC URL'si veya ana makine adi yoktur.
//
// HATA SOZLESMESI:
//   - Altyapi hatasi (fetch hatasi/zaman asimi, HTTP 429/5xx/herhangi non-2xx, JSON degil,
//     zarf bozuk, JSON-RPC -32005/35/-32601/-32614/-32701, "forbidden method", mesajda
//     archive requests / personal token / free plan / rate limit ...) -> SONRAKI URL.
//   - Anlamsal hata (revert, -32602, insufficient funds ...) -> DUSME, sunucu hatasi
//     SUZULEREK doner: `code` yalniz -32768..-32000 veya 3 ise iletilir (aksi -32603: 4001/4100
//     gibi kodlar cuzdan karari gibi gorunurdu); `message` en cok 512 karakter, URL ve
//     ana makine adlari supurulur, "user rejected/denied/cancel" gecen mesaj DEGISTIRILIR
//     (AppKit bunu kullanici reddi sayar); `data` (revert verisi) <= 64 KB ise korunur.
//   - Hepsi basarisiz -> -32603 ("RPC endpoint unavailable" / zamanlayici ise "RPC request
//     timed out").
//   - Limit asimi (hiz, eszamanlilik, parametre 256 KB, yanit 2 MB) -> -32005.
//
// SINIRLAR (hepsi bellekte): global kova 20 istek/sn; origin basina 5 istek/sn (patlama 20);
// 'Unknown' origin TEK paylasilan, daha siki kova; agir yontemler 5 jeton; origin basina
// en cok 8 eszamanli istek. Servis calisani yeniden baslarsa sifirlanir (kabul edilen sinir).
//
// OZEL MOD: WT'de YOK. Gizli-mod yeniden-tabanlamasinda bu yol varsayilan olarak ENGELLENIR
// (spec bolum 13); bu dosyada ozel mod kodu YAZILMAZ.

import supported_chains from '../data/supportedChains'
import { chainVm, isSameChainId, rpcUrlsOf } from './vm'
import { createTokenBucket } from './tokenBucket'
import { classifyRpcMethod, rpcMethodWeight, unsupportedMethodError } from './evmRpcPolicy'

export const READ_RPC_LIMITS = Object.freeze({
    maxParamsBytes: 256 * 1024,
    maxResponseBytes: 2 * 1024 * 1024,
    endpointTimeoutMs: 10_000,
    totalTimeoutMs: 25_000,
    globalRate: 20,
    globalBurst: 20,
    originRate: 5,
    originBurst: 20,
    unknownRate: 1,
    unknownBurst: 5,
    maxConcurrentPerOrigin: 8,
    maxTrackedOrigins: 500,
    maxOriginLength: 256,
    maxErrorMessageChars: 512,
    maxErrorDataChars: 64 * 1024,
})

const UNKNOWN_ORIGIN = 'Unknown'

const fail = (code, message) => ({ ok: false, error: { code, message } })

// ---------------------------------------------------------------------------
// Hiz sinirlayici: global kova + origin kovasi + origin basina eszamanlilik.
// ---------------------------------------------------------------------------

export function createReadLimiter({ now = () => Date.now(), limits = {} } = {}) {
    const cfg = { ...READ_RPC_LIMITS, ...limits }
    const globalBucket = createTokenBucket({ rate: cfg.globalRate, burst: cfg.globalBurst, now })
    const origins = new Map() // origin -> { bucket, inFlight }

    const keyOf = (origin) =>
        typeof origin === 'string' && origin !== '' ? origin.slice(0, cfg.maxOriginLength) : UNKNOWN_ORIGIN

    function stateFor(key) {
        let st = origins.get(key)
        if (st) {
            origins.delete(key) // en son kullanilan sona
            origins.set(key, st)
            return st
        }
        const stricter = key === UNKNOWN_ORIGIN
        st = {
            bucket: createTokenBucket({
                rate: stricter ? cfg.unknownRate : cfg.originRate,
                burst: stricter ? cfg.unknownBurst : cfg.originBurst,
                now,
            }),
            inFlight: 0,
        }
        origins.set(key, st)
        if (origins.size > cfg.maxTrackedOrigins) {
            for (const [k, v] of origins) {
                if (origins.size <= cfg.maxTrackedOrigins) break
                if (k !== key && k !== UNKNOWN_ORIGIN && v.inFlight === 0) origins.delete(k)
            }
        }
        return st
    }

    // -> { ok: true, release() } | { ok: false, reason: 'concurrency'|'origin'|'global', retryAfterMs? }
    function acquire(origin, weight = 1) {
        const st = stateFor(keyOf(origin))
        if (st.inFlight >= cfg.maxConcurrentPerOrigin) return { ok: false, reason: 'concurrency' }

        const o = st.bucket.take(weight)
        if (!o.ok) return { ok: false, reason: 'origin', retryAfterMs: o.retryAfterMs }

        const g = globalBucket.take(weight)
        if (!g.ok) {
            st.bucket.refund(weight) // kullanilmadi: origin hakki yanmasin
            return { ok: false, reason: 'global', retryAfterMs: g.retryAfterMs }
        }

        st.inFlight += 1
        let released = false
        return {
            ok: true,
            release() {
                if (released) return
                released = true
                st.inFlight -= 1
            },
        }
    }

    return { acquire }
}

let sharedLimiter = null
const getSharedLimiter = () => (sharedLimiter ??= createReadLimiter())

// ---------------------------------------------------------------------------
// Hata suzme
// ---------------------------------------------------------------------------

const URL_RE = /\b(?:https?|wss?):\/\/[^\s"'<>)\]}]+/gi
const USER_REJECT_RE = /user (rejected|denied|cancel)/i
const REDACTED = '[redacted]'
const GENERIC_FAILURE = 'RPC request failed.'
const MAX_SCRUB_DEPTH = 8

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Paketli listedeki TUM RPC ana makine adlari (yalniz aktif zincirinki degil: bir saglayici
// baska bir zincirin ucunu da yansitabilir).
function hostNamesOf(chains) {
    const hosts = new Set()
    for (const c of chains) {
        for (const u of rpcUrlsOf(c)) {
            try {
                hosts.add(new URL(u).hostname.toLowerCase())
            } catch (e) {
                /* gecersiz URL: atla */
            }
        }
    }
    return [...hosts]
}

function makeScrubber(chains) {
    const hosts = hostNamesOf(chains)
    const hostRe = hosts.length > 0 ? new RegExp(hosts.map(escapeRegExp).join('|'), 'gi') : null
    const scrubText = (text) => {
        let out = text.replace(URL_RE, REDACTED)
        if (hostRe) out = out.replace(hostRe, REDACTED)
        return out
    }
    const scrubDeep = (value, depth) => {
        if (typeof value === 'string') return scrubText(value)
        if (value === null || typeof value !== 'object') return value
        if (depth >= MAX_SCRUB_DEPTH) return undefined
        if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1))
        // fromEntries OZ ozellik tanimlar: JSON'dan gelen "__proto__" anahtari prototipi DEGISTIRMEZ.
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [scrubText(k), scrubDeep(v, depth + 1)]))
    }
    return { scrubText, scrubDeep }
}

function sanitizeUpstreamError(err, scrubber, cfg) {
    const raw = err && typeof err === 'object' ? err : {}
    const code =
        Number.isInteger(raw.code) && ((raw.code >= -32768 && raw.code <= -32000) || raw.code === 3) ? raw.code : -32603

    let message = typeof raw.message === 'string' ? scrubber.scrubText(raw.message) : ''
    if (USER_REJECT_RE.test(message)) message = GENERIC_FAILURE
    message = Array.from(message).slice(0, cfg.maxErrorMessageChars).join('')
    if (message === '') message = GENERIC_FAILURE

    const out = { code, message }
    if (raw.data !== undefined) {
        const data = scrubber.scrubDeep(raw.data, 0)
        try {
            const json = JSON.stringify(data)
            if (json !== undefined && json.length <= cfg.maxErrorDataChars) out.data = data
        } catch (e) {
            /* serilestirilemeyen veri: dusur */
        }
    }
    return out
}

// ---------------------------------------------------------------------------
// Altyapi hatasi mi, anlamsal hata mi?
// ---------------------------------------------------------------------------

const INFRA_CODES = new Set([-32005, 35, -32601, -32614, -32701])
const INFRA_MESSAGE_RE =
    /archive requests|personal token|free plan|upstream overloaded|rate limit|limit exceeded|not whitelisted|forbidden method|too many requests/i

function isInfraRpcError(err) {
    if (!err || typeof err !== 'object') return true // anlamsiz hata govdesi: bu uc guvenilmez
    const message = typeof err.message === 'string' ? err.message : ''
    if (INFRA_MESSAGE_RE.test(message)) return true
    if (INFRA_CODES.has(err.code)) return true
    return false
}

// ---------------------------------------------------------------------------
// Tek uc nokta denemesi
// ---------------------------------------------------------------------------

class BodyTooLarge extends Error {}
class AttemptTimeout extends Error {}

async function readBodyCapped(response, maxBytes) {
    const declared = Number(response.headers?.get?.('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
        try {
            await response.body?.cancel?.()
        } catch (e) {
            /* yok say */
        }
        throw new BodyTooLarge()
    }

    const reader = response.body?.getReader?.()
    if (!reader) {
        const text = await response.text()
        if (text.length > maxBytes) throw new BodyTooLarge()
        return text
    }

    const decoder = new TextDecoder()
    let total = 0
    let out = ''
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) {
            try {
                await reader.cancel()
            } catch (e) {
                /* yok say */
            }
            throw new BodyTooLarge()
        }
        out += decoder.decode(value, { stream: true })
    }
    return out + decoder.decode()
}

let nextRequestId = 1

// -> { kind: 'ok', result } | { kind: 'semantic', error } | { kind: 'infra', timeout?: true } | { kind: 'toolarge' }
async function attemptEndpoint({ url, method, params, timeoutMs, fetchImpl, maxBytes }) {
    const controller = new AbortController()
    let timer
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort()
            reject(new AttemptTimeout())
        }, timeoutMs)
    })

    const run = async () => {
        // Govde HER cagrida TAZE kurulur: sayfa nesnesi yayilmaz, kimlik cuzdana aittir.
        const body = JSON.stringify({ jsonrpc: '2.0', id: nextRequestId++, method, params })
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            cache: 'no-store',
            signal: controller.signal,
        })
        if (!res || !res.ok) return { kind: 'infra' }

        const text = await readBodyCapped(res, maxBytes)
        let json
        try {
            json = JSON.parse(text)
        } catch (e) {
            return { kind: 'infra' }
        }
        if (!json || typeof json !== 'object' || Array.isArray(json)) return { kind: 'infra' }

        if (json.error !== undefined && json.error !== null) {
            return isInfraRpcError(json.error) ? { kind: 'infra' } : { kind: 'semantic', error: json.error }
        }
        if ('result' in json) return { kind: 'ok', result: json.result }
        return { kind: 'infra' }
    }

    try {
        return await Promise.race([run(), timeout])
    } catch (e) {
        if (e instanceof AttemptTimeout) return { kind: 'infra', timeout: true }
        if (e instanceof BodyTooLarge) return { kind: 'toolarge' }
        return { kind: 'infra' }
    } finally {
        clearTimeout(timer)
    }
}

// ---------------------------------------------------------------------------
// Giris noktasi
// ---------------------------------------------------------------------------

const byteLength = (s) => new TextEncoder().encode(s).length

export async function forwardRead({ method, params, chain, origin, deps = {} } = {}) {
    const cfg = READ_RPC_LIMITS

    // 1) Politika. Yasak ad: fetch YOK, kova tuketilmez.
    if (classifyRpcMethod(method) !== 'forward') return { ok: false, error: unsupportedMethodError(method) }

    // 2) Hiz siniri (ayristirmadan once: spam CPU yemesin).
    const limiter = deps.limiter ?? getSharedLimiter()
    const grant = limiter.acquire(origin, rpcMethodWeight(method))
    if (!grant.ok) return fail(-32005, 'Rate limited')

    try {
        // 3) Parametreler: dizi (veya yok), 256 KB, serilestirilebilir.
        const p = params === undefined ? [] : params
        if (!Array.isArray(p)) return fail(-32602, 'Invalid params: expected an array.')
        let json
        try {
            json = JSON.stringify(p)
        } catch (e) {
            return fail(-32602, 'Invalid params: not serializable.')
        }
        if (byteLength(json) > cfg.maxParamsBytes) return fail(-32005, 'Request too large')

        // 4) Uc noktalar: PAKETLI veri, cagri anindaki chainId.
        const chains = deps.chains ?? supported_chains
        const found = chains.find((c) => chainVm(c) === 'evm' && isSameChainId(c.chainId, chain?.chainId))
        const urls = found ? rpcUrlsOf(found) : []
        if (urls.length === 0) return fail(-32603, 'No RPC endpoint is available for this network.')

        const fetchImpl = deps.fetch ?? globalThis.fetch
        const clock = deps.now ?? (() => Date.now())
        const startedAt = clock()
        let allTimeouts = true

        for (const url of urls) {
            const remaining = cfg.totalTimeoutMs - (clock() - startedAt)
            if (remaining <= 0) break

            const r = await attemptEndpoint({
                url,
                method,
                params: p,
                timeoutMs: Math.min(cfg.endpointTimeoutMs, remaining),
                fetchImpl,
                maxBytes: cfg.maxResponseBytes,
            })

            if (r.kind === 'ok') return { ok: true, result: r.result }
            if (r.kind === 'toolarge') return fail(-32005, 'Response too large')
            if (r.kind === 'semantic') {
                return { ok: false, error: sanitizeUpstreamError(r.error, makeScrubber(chains), cfg) }
            }
            if (!r.timeout) allTimeouts = false
        }

        return fail(-32603, allTimeouts ? 'RPC request timed out' : 'RPC endpoint unavailable')
    } finally {
        grant.release()
    }
}

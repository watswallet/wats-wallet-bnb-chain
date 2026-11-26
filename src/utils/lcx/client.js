// LCX SUNUCU ISTEMCISI -- eklentinin /lcx/* uclarina tek giris kapisi. Saf JS: chrome ve depo yok;
// fetch ve saat dis dunyadan verilebilir (testler `fetchImpl` ve `now` enjekte eder).
//
// Eklenti LCX'e DOGRUDAN konusmaz: API anahtari sunucudadir. Sunucu LCX'in cevabini su sozlesmeye
// yazar (server/controllers/lcxController.js):
//   teklif     200 { success: true, kind, data }
//   build      200 { success: true, tx: { to, data, value }, approval: { target } | null }
//   stablecoin 200 { success: true, chains: [{ chainId, coins: [{ address, symbol, decimals, currency }] }] }
//   hisseler   200 { success: true, usEquitiesOpen, asOf, rows: [...] }   (GET /lcx/stocks; satir ayrintisi stockRows.js / tokenizedStocks.js)
//   red        400/409/410/422 { success: false, code, details }   (400: { code: 'bad_request', field })
//   ulasilamaz 503 { success: false, code: 'lcx_unavailable', reason }   ve bizim IP limiter'imiz 429 (reason 'rate_limited')
//
// IKI HATA TURU, IKI FARKLI KARAR (cagiranlar ayirt eder):
//   LcxUnavailableError -> LCX yolu KULLANILAMAZ; bugunku (yedek) takas yoluna dusulur.
//   LcxRefusalError     -> LCX bu takasi bilincli REDDETTI (off_peg, use_rwa, ...); yedege DUSULMEZ,
//                          kullaniciya sebep gosterilir.
// Beklenmeyen HER sey (baska durum kodu, JSON olmayan govde, success:true olmayan 200) yedege dusurur:
// kapali basarisizlik, yani belirsizlikte LCX yolu secilmez.

// eklenti -> sunucu zaman asimi (Global Constraints). Sunucunun LCX'e karsi kendi 4 sn'si ayridir.
const REQUEST_TIMEOUT_MS = 4000

// Eklenti onbellekleri (Global Constraints). Modul kapsaminda: arka plan hizmet isciligi bellegi, yani
// isci oldurulunce kendiliginden bosalir; kalici depoya HICBIR sey yazilmaz.
const QUOTE_TTL_MS = 18_000
const BUILD_TTL_MS = 18_000
const STABLECOINS_TTL_MS = 3_600_000

// Her onbellek en fazla bu kadar girdi tutar (en eskisi atilir). TTL kontrolu okumada yapildigindan
// hic okunmayan girdiler suresiz kalirdi; hizmet isciligi uzun yasarsa bellek siniri bu.
const MAX_CACHE_ENTRIES = 64

// Sunucunun bilincli red olarak dondugu HTTP durumlari (lcxController REFUSAL_STATUSES ile ayni).
const REFUSAL_STATUSES = new Set([400, 409, 410, 422])

export class LcxUnavailableError extends Error {
    /** @param {string} reason timeout | network | upstream_5xx | rate_limited | disabled | quota_exceeded | auth | bad_quote ... */
    constructor(reason) {
        super(`LCX kullanilamiyor: ${reason}`)
        this.name = 'LcxUnavailableError'
        this.reason = reason
    }
}

export class LcxRefusalError extends Error {
    /**
     * @param {string} code LCX'in red kodu (off_peg, use_rwa, bad_request, ...)
     * @param {object} [details] sunucunun gecirdigi ek alanlar
     */
    constructor(code, details) {
        super(`LCX reddetti: ${code}`)
        this.name = 'LcxRefusalError'
        this.code = code
        this.details = details
    }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// Vite bu ifadeyi derlemede metin sabitine cevirir; cagri ANINDA okunur ki testler vi.stubEnv ile degistirebilsin.
const apiBase = () => String(import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '')

// `reason` sunucudan gelir ama yalniz bir etikettir; beklenmedik bicimdeki metin hata nesnesine tasinmaz.
const REASON_RE = /^[a-z0-9_]{1,40}$/
const reasonOf = (body, fallback) => (isObject(body) && typeof body.reason === 'string' && REASON_RE.test(body.reason) ? body.reason : fallback)

/**
 * Sunucu yanitini sozlesmeye gore ayirir: basari govdesini dondurur, digerlerini firlatir.
 * @returns {object} success:true govdesi
 */
function classify(status, body) {
    if (status === 200) {
        if (isObject(body) && body.success === true) return body
        throw new LcxUnavailableError('upstream_5xx')
    }
    if (status === 429) throw new LcxUnavailableError(reasonOf(body, 'rate_limited'))
    if (status === 503) throw new LcxUnavailableError(reasonOf(body, 'upstream_5xx'))
    if (REFUSAL_STATUSES.has(status) && isObject(body) && body.success === false && typeof body.code === 'string' && body.code) {
        // 400 bad_request { field } govdesinde `details` yoktur; bozuk alan adi details icinde gecirilir.
        const details = body.details !== undefined ? body.details : body.field !== undefined ? { field: body.field } : undefined
        throw new LcxRefusalError(body.code, details)
    }
    throw new LcxUnavailableError('upstream_5xx')
}

/**
 * Tek HTTP degisimi: fetch + govde okuma TOPLAMI REQUEST_TIMEOUT_MS ile sinirlidir (yalniz baslik degil).
 * Sureyi AbortController'in dinlenmesine BAGLAMAYIZ: enjekte edilen sahte fetch sinyali yok sayabilir;
 * yaris her durumda sonlanir ve sinyal yalniz asil istegi de iptal eder.
 * @returns {Promise<object>} success:true govdesi
 */
async function call(path, { method, body, fetchImpl }) {
    const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args))
    const controller = new AbortController()
    const init = { method, signal: controller.signal }
    if (body !== undefined) {
        init.headers = { 'Content-Type': 'application/json' }
        init.body = JSON.stringify(body)
    }
    const url = `${apiBase()}${path}`

    let timer
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort()
            reject(new LcxUnavailableError('timeout'))
        }, REQUEST_TIMEOUT_MS)
    })
    const exchange = (async () => {
        let res
        try {
            res = await doFetch(url, init)
        } catch {
            throw new LcxUnavailableError('network')
        }
        let parsed = null
        try {
            parsed = await res.json()
        } catch {
            parsed = null
        }
        return classify(res.status, parsed)
    })()

    try {
        return await Promise.race([exchange, timeout])
    } finally {
        clearTimeout(timer)
    }
}

// --- Onbellek -------------------------------------------------------------------------------------

const quoteCache = new Map()
const buildCache = new Map()
let stablecoinsCache = null // { value: Map, at: number }

function cacheGet(cache, key, ttlMs, nowMs) {
    const hit = cache.get(key)
    if (!hit) return undefined
    // `>` : tam ttlMs yasindaki girdi hala gecerlidir ("18 000 ms icinde"); ttlMs + 1'de gecersiz.
    if (nowMs - hit.at > ttlMs) {
        cache.delete(key)
        return undefined
    }
    return hit.value
}

function cacheSet(cache, key, value, nowMs) {
    cache.delete(key) // yeniden yazilan girdi en yeni sayilir (Map ekleme sirasini korur)
    cache.set(key, { value, at: nowMs })
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
}

/** YALNIZ testler icin: uc onbellegin hepsini bosaltir. */
export function _resetLcxCaches() {
    quoteCache.clear()
    buildCache.clear()
    stablecoinsCache = null
}

// --- Uclar ----------------------------------------------------------------------------------------

const lower = (v) => String(v).toLowerCase()

// 0x + 40 onaltilik hane (buyuk/kucuk harf serbest; checksum denetimi routerGuard'da).
const ANY_CASE_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

// Teklif onbellegi anahtari. fetchLcxQuote ve evictLcxQuote AYNI fonksiyonu kullanir: iki ayri kopya olsaydi biri
// degistiginde silme sessizce yanlis girdiyi hedefler ve eski teklif onbellekte kalirdi.
function quoteCacheKey({ kind, chainId, tokenIn, tokenOut, amountIn, slippageBps }) {
    const amount = typeof amountIn === 'bigint' ? amountIn.toString() : amountIn
    return [kind, chainId, lower(tokenIn), lower(tokenOut), amount, slippageBps].join('|')
}

/**
 * Teklif onbellegindeki TEK girdiyi siler (fetchLcxQuote ile ayni anahtar: kind, chainId, adresler, ham tutar, kayma).
 * Arka plan, yurutmede teklifin suresi doldu / fiyat kaydi (LCX_REQUOTE) diye reddedilince cagirir: yoksa ekranin yeniden
 * teklifi ayni (bayat) teklifi 18 sn'lik onbellekten alir ve kullanici "fiyat degisti" mesajini tekrar tekrar gorurdu.
 * Baska girdilere ve build onbellegine DOKUNMAZ. Girdi yoksa sessizce hicbir sey yapmaz.
 * @param {{ kind: string, chainId: number, tokenIn: string, tokenOut: string, amountIn: string|bigint, slippageBps: number }} params
 */
export function evictLcxQuote(params) {
    quoteCache.delete(quoteCacheKey(params))
}

/**
 * POST /lcx/quote. Govdeye YALNIZ bu alti alan girer (cagirandaki fazlalik sizmaz).
 * Donen `data` LCX'in ham `data`sidir (quote, stable teklifte stablecoin, rwa teklifinde rwa);
 * onbellekten gelen AYNI nesne olabilir: DEGISTIRILMEMELIDIR (lcxSwapData yalniz okur).
 * @param {{ kind: string, chainId: number, tokenIn: string, tokenOut: string, amountIn: string|bigint, slippageBps: number }} params
 * @param {{ fetchImpl?: typeof fetch, now?: () => number }} [opts]
 * @returns {Promise<object>} data
 * @throws {LcxUnavailableError|LcxRefusalError}
 */
export async function fetchLcxQuote(params, { fetchImpl, now = Date.now } = {}) {
    const { kind, chainId, tokenIn, tokenOut, slippageBps } = params
    const amountIn = typeof params.amountIn === 'bigint' ? params.amountIn.toString() : params.amountIn
    const key = quoteCacheKey(params)

    const cached = cacheGet(quoteCache, key, QUOTE_TTL_MS, now())
    if (cached !== undefined) return cached

    const body = await call('/lcx/quote', {
        method: 'POST',
        body: { kind, chainId, tokenIn, tokenOut, amountIn, slippageBps },
        fetchImpl,
    })
    if (!isObject(body.data)) throw new LcxUnavailableError('upstream_5xx')
    cacheSet(quoteCache, key, body.data, now())
    return body.data
}

/**
 * POST /lcx/build. Govdeye YALNIZ bu dort alan girer.
 * Donen tx'e GUVENILMEZ: imzadan once routerGuard.verifyLcxSwapTx'ten gecmelidir.
 * @param {{ kind: string, quoteId: string, recipient: string, slippageBps: number }} params
 * @param {{ fetchImpl?: typeof fetch, now?: () => number }} [opts]
 * @returns {Promise<{ tx: { to: string, data: string, value: string }, approval: { target: string } | null }>}
 * @throws {LcxUnavailableError|LcxRefusalError}
 */
export async function fetchLcxBuild(params, { fetchImpl, now = Date.now } = {}) {
    const { kind, quoteId, recipient, slippageBps } = params
    const key = [quoteId, lower(recipient), slippageBps].join('|')

    const cached = cacheGet(buildCache, key, BUILD_TTL_MS, now())
    if (cached !== undefined) return cached

    const body = await call('/lcx/build', {
        method: 'POST',
        body: { kind, quoteId, recipient, slippageBps },
        fetchImpl,
    })
    // SEKIL denetimi (icerik denetimi imzadan once routerGuard'indir): tx { to, data, value } UCU de dize olmali;
    // approval yok / null ya da { target: adres } olmali. Baska her sey bozuk yanittir: yedege dusulur, onbellege yazilmaz.
    const { tx, approval } = body
    if (!isObject(tx) || typeof tx.to !== 'string' || typeof tx.data !== 'string' || typeof tx.value !== 'string') {
        throw new LcxUnavailableError('upstream_5xx')
    }
    if (approval !== undefined && approval !== null) {
        if (!isObject(approval) || typeof approval.target !== 'string' || !ANY_CASE_ADDRESS_RE.test(approval.target)) {
            throw new LcxUnavailableError('upstream_5xx')
        }
    }
    const result = { tx, approval: approval ?? null }
    cacheSet(buildCache, key, result, now())
    return result
}

const ADDRESS_RE = /^0x[0-9a-f]{40}$/

// chains -> Map(chainId -> Set(kucuk harfli adres)); bozuk satirlar atlanir. Dizi degilse null.
function parseStablecoins(body) {
    if (!Array.isArray(body.chains)) return null
    const map = new Map()
    for (const group of body.chains) {
        if (!isObject(group) || !Number.isInteger(group.chainId) || !Array.isArray(group.coins)) continue
        const set = new Set()
        for (const coin of group.coins) {
            if (!isObject(coin) || typeof coin.address !== 'string') continue
            const address = coin.address.toLowerCase()
            if (ADDRESS_RE.test(address)) set.add(address)
        }
        if (set.size > 0) map.set(group.chainId, set)
    }
    return map
}

/**
 * GET /lcx/stablecoins -> Map(chainId -> Set(kucuk harfli adres)). 1 saat onbellek.
 * HICBIR hatada firlatmaz: bos Map doner (stable yolu kapanir, genel takas surer) ve basarisizlik ya da
 * bos liste ONBELLEGE YAZILMAZ -- gecici bir arizanin stable yolunu bir saat kapali tutmasi istenmez.
 * @param {{ fetchImpl?: typeof fetch, now?: () => number }} [opts]
 * @returns {Promise<Map<number, Set<string>>>}
 */
export async function fetchLcxStablecoins({ fetchImpl, now = Date.now } = {}) {
    if (stablecoinsCache && now() - stablecoinsCache.at <= STABLECOINS_TTL_MS) return stablecoinsCache.value
    try {
        const body = await call('/lcx/stablecoins', { method: 'GET', fetchImpl })
        const map = parseStablecoins(body)
        if (!map || map.size === 0) return new Map()
        stablecoinsCache = { value: map, at: now() }
        return map
    } catch {
        return new Map()
    }
}

/**
 * GET /lcx/stocks -> { usEquitiesOpen, asOf, rows }. ONBELLEK YOK: tazelik ve tek-ucus karari stockRows.js'tedir.
 * `rows` sunucunun HAM satirlaridir (icerik denetimi tokenizedStocks.toLcxStockRow'da); `asOf` sunucunun listeyi LCX'ten
 * yukledigi an (ms), sunucu vermediyse null. `usEquitiesOpen` bu ana kadar 24 saate dek bayat olabilir: asOf ile birlikte tutulur.
 * Bu uc icin bilincli RED yoktur: 4xx durumlari da LcxUnavailableError olur (LcxRefusalError DEGIL).
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<{ usEquitiesOpen: boolean, asOf: number|null, rows: object[] }>}
 * @throws {LcxUnavailableError}
 */
export async function fetchLcxStocks({ fetchImpl } = {}) {
    let body
    try {
        body = await call('/lcx/stocks', { method: 'GET', fetchImpl })
    } catch (e) {
        if (e instanceof LcxRefusalError) throw new LcxUnavailableError('upstream_5xx')
        throw e
    }
    if (typeof body.usEquitiesOpen !== 'boolean' || !Array.isArray(body.rows)) throw new LcxUnavailableError('upstream_5xx')
    return {
        usEquitiesOpen: body.usEquitiesOpen,
        asOf: Number.isFinite(body.asOf) ? body.asOf : null,
        rows: body.rows,
    }
}

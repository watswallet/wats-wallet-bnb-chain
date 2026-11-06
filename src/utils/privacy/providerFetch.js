// SILENTSWAP ISTEKLERINE GERCEK ZAMAN ASIMI (gizli-mod cok-ag spec 4.2, P14, E17). YALNIZ ARKA PLAN.
//
// SDK `jsonFetch` global fetch'i SURESIZ cagirir ve istek basina sinyal gecmez (node_modules/@silentswap/sdk/src/http.ts);
// background.js'teki withPrivateTimeout yalniz sozu yaristirir, bekleyen istegi IPTAL ETMEZ (bellekte kalir). Bu modul
// globalThis.fetch'i sarar: YALNIZ https://api.silentswap.com ana makinesine giden isteklere gercek bir AbortSignal.timeout(ms)
// verilir. AbortSignal.any KULLANILMAZ (Chrome 116'da geldi, en dusuk surum 115): istegin kendi sinyali varsa sarmalayici
// DOKUNMAZ (SDK sinyal gecmez), diger ana makineler degismeden gecer. Orijinal fetch globalThis baglamiyla cagrilir (baglamsiz
// cagri "Illegal invocation" verir). AbortError ve TimeoutError PRIVATE_PROVIDER_DOWN'a eslenir (silentswap.js privacyErrorCode).
//
// Sureler: POST /orders (teklif) 28 sn (canli olcum 2026-10-29: ilk teklif bazen 27-30 sn, tekrar denemede 1-3 sn; Chrome MV3
// servis calisani 30 sn'den gec yanitlanan fetch'te sonlanabilir, bu yuzden sinir 30 sn'nin ALTINDA ve zaman asiminda arka plan
// YALNIZ teklifi bir kez yeniden ister), GET /order/{ticket} ve POST /order/{ticket}/deposit-tx 20 sn, GET /dest-assets 8 sn.
export const SILENTSWAP_API_ORIGIN = 'https://api.silentswap.com'
export const TIMEOUT_QUOTE_MS = 28000
export const TIMEOUT_DEFAULT_MS = 20000
export const TIMEOUT_STATUS_MS = 8000

const MARK = Symbol.for('wats.providerFetch')

// Dizge ya da URL girdisi icin sure; baska ana makine, goreli yol ve Request nesnesi null (dokunulmaz).
export function providerTimeoutFor(input) {
    let href
    if (typeof input === 'string') href = input
    else if (typeof URL !== 'undefined' && input instanceof URL) href = input.href
    else return null
    let url
    try { url = new URL(href) } catch { return null }
    if (url.origin !== SILENTSWAP_API_ORIGIN) return null
    if (url.pathname === '/dest-assets') return TIMEOUT_STATUS_MS
    if (url.pathname === '/orders') return TIMEOUT_QUOTE_MS
    return TIMEOUT_DEFAULT_MS
}

export function wrapProviderFetch(baseFetch, { timeoutSignal = (ms) => AbortSignal.timeout(ms) } = {}) {
    const wrapped = function providerFetch(input, init) {
        const ms = providerTimeoutFor(input)
        if (ms === null || init?.signal != null) return baseFetch.call(globalThis, input, init)
        return baseFetch.call(globalThis, input, { ...init, signal: timeoutSignal(ms) })
    }
    wrapped[MARK] = true
    return wrapped
}

// Idempotent: modul her test/yeniden yuklemede yeniden calisir, sarmalayici tekrar sarilmaz.
export function installProviderFetch(target = globalThis) {
    if (typeof target.fetch !== 'function' || target.fetch[MARK]) return false
    target.fetch = wrapProviderFetch(target.fetch)
    return true
}

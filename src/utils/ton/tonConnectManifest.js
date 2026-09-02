// TonConnect manifest DOGRULAMA -- saf katman.
//
// INDIRME BURADA DEGIL (tonDappFunctions.js'te, arka planda). Ayrim kasitli:
// indirmeyi sayfaya birakmak, dapp'in kendi manifest'ini uydurmasi demekti;
// dogrulamayi indirmeye baglamak ise bu kurallari test edilemez hale getirirdi.
//
// AG YOK, chrome YOK.

export const MANIFEST_NOT_FOUND = 2
export const MANIFEST_CONTENT_ERROR = 3

const MAX_NAME = 64

const err = (code, message) => ({ ok: false, code, message })

function originOf(url) {
    try { return new URL(url).origin } catch (e) { return null }
}

function hasHttpsProtocol(value) {
    if (typeof value !== 'string') return false
    try {
        const u = new URL(value)
        return u.protocol === 'http:' || u.protocol === 'https:'
    } catch (e) {
        return false
    }
}

function safeIcon(value) {
    if (value === undefined || value === null || value === '') return { ok: true, value: null }
    if (typeof value !== 'string') return { ok: false }
    if (!hasHttpsProtocol(value)) return { ok: false }
    return { ok: true, value: new URL(value).toString() }
}

/**
 * @param {unknown} raw indirilen JSON govdesi
 * @param {{manifestUrl: string, dappOrigin: string}} ctx
 */
export function validateManifest(raw, { manifestUrl, dappOrigin } = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return err(MANIFEST_CONTENT_ERROR, 'Manifest is not a JSON object')
    }

    const url = typeof raw.url === 'string' ? raw.url.trim() : ''
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!url || !name) return err(MANIFEST_CONTENT_ERROR, 'Manifest is missing url or name')

    // URL sehasi http(s) olmali. new URL() bir string'i parse eder ama sema
    // kontrolu yapmaz -- javascript: ve data: icin new URL().origin "null"
    // string'i doner (null degil), bu da truthy bir check'i esir.
    if (!hasHttpsProtocol(url)) return err(MANIFEST_CONTENT_ERROR, 'Manifest url is not an http(s) URL')

    const icon = safeIcon(raw.iconUrl)
    if (!icon.ok) return err(MANIFEST_CONTENT_ERROR, 'Manifest iconUrl is not an http(s) URL')

    // sameOrigin BIR KARAR DEGIL, BIR OLCUMDUR: burasi baglantiyi kesmez, yalnizca
    // "manifest dapp'in kendi adresinde mi" sorusunu cevaplar. Karari onay ekrani
    // kullaniciya birakir (K5) -- cunku CDN'de manifest tutmak mesru bir desen ve
    // burada reddetmek o dapp'leri tamamen kapatirdi.
    const manifestOrigin = originOf(manifestUrl)
    const sameOrigin = !!manifestOrigin && !!dappOrigin && manifestOrigin === dappOrigin

    return {
        ok: true,
        manifest: {
            url,
            // Ad KIRPILIR: uzun bir ad onay ekranini tasirir ve gercek origin'i
            // ekrandan dusurebilir -- yani kirpma bir kozmetik degil, K5'in parcasi.
            name: name.slice(0, MAX_NAME),
            iconUrl: icon.value,
            manifestUrl: typeof manifestUrl === 'string' ? manifestUrl : null,
            sameOrigin,
        },
    }
}

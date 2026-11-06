import { parseUnits } from 'ethers'
import { MIN_PAYOUT_USDC } from './silentswapConfig'
import { CANONICAL_AMOUNT_RE } from './privateConstants'

// SILENTSWAP DURUM OKUMA, TUTAR SINIRI VE TEKLIF HIZ PENCERESI (gizli-mod cok-ag spec 4.2, P2, P14, E2, E3). YALNIZ ARKA PLAN.
//
// GET https://api.silentswap.com/dest-assets herkese aciktir ve adres tasimaz (2026-10-15 yaniti: enabled, maintenanceMode,
// directEvmPayoutEnabled, limits { minUsdc 12, maxUsdc 20010 }, feeBps 100). Kullanimi:
//  - enabled === false ya da maintenanceMode === true  -> PRIVATE_PROVIDER_DOWN, teklif istenmez
//  - etkin en az = max(limits.minUsdc, MIN_PAYOUT_USDC) (sunucu degeri yalniz YUKSELTME yonunde izlenir, E2; olculen en az 12:
//    11 USDC amount_below_minimum verdi); altina PRIVATE_MIN_AMOUNT. limits.maxUsdc ustune PRIVATE_MAX_AMOUNT. Ikisi de
//    `limitUsdc` dizgesini tasir; ekran metni onu kullanir.
//  - directEvmPayoutEnabled yalniz OKUNUR, karar vermez (istekler her zaman `dest` tasir).
//  - minUsdcInRaw OKUNMAZ: 2026-10-15'te 10 USDC idi ama olculen en az 12'dir; hakem limits.minUsdc ve teklifin kendisidir.
// OKUNAMAZSA (8 sn zaman asimi, HTTP hata, JSON degil, alan tipi bozuk) ENGEL KONMAZ: yerlesik 12 USDC gecerlidir, ust sinir
// yoktur ve teklif istegi hakem olur (SilentSwap kapaliysa PRIVATE_PROVIDER_DOWN ile fail-closed olur). Onbellek: basari 60 sn,
// basarisizlik 15 sn; es zamanli okumalar tek istekte birlesir.
//
// HIZ PENCERESI (P14): sunucu POST /orders icin 20 istek / 60 sn verir (olculdu). Yerel kayan pencere 60 sn'de en cok 15
// teklife izin verir (QUOTE_WINDOW_MAX; pay: baska pencere, sunucu saati farki); 16.'si SDK cagrilmadan PRIVATE_RATE_LIMITED.
// Pencere bellektedir (servis calisani yeniden baslarsa sifirlanir; sunucunun 429'u PRIVATE_RATE_LIMITED'e eslenir).
export const PROVIDER_STATUS_URL = 'https://api.silentswap.com/dest-assets'
export const STATUS_TIMEOUT_MS = 8000
export const STATUS_OK_TTL_MS = 60000
export const STATUS_FAIL_TTL_MS = 15000
export const QUOTE_WINDOW_MS = 60000
export const QUOTE_WINDOW_MAX = 15

// Sunucu sayilari 0 < v < 1e12 araliginda okunur: ustu okunamaz sayilir. Neden: String(1e21) = '1e+21' ustel gosterimdir ve
// parseUnits onu reddeder; bu deger yerlesik en az tutari (12) sessizce atlatmamali.
const MAX_READABLE_USDC = 1e12
const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < MAX_READABLE_USDC ? v : null)
const flag = (v) => (typeof v === 'boolean' ? v : null)
// feeBps (SilentSwap hizmet orani, baz puan): tamsayi ve 0 < v <= 10000; aksi null. Ekran null'da "—" der, sabit %1 yedegi YOKTUR.
const integerBps = (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10000 ? v : null)

// Govde nesne degilse null (okunamadi); alan tipi bozuksa YALNIZ o alan null olur (ote alanlar okunur: kapali yazan saglayici,
// bozuk bir `limits` yuzunden acik sayilmasin).
export function parseProviderStatus(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    const limits = body.limits && typeof body.limits === 'object' ? body.limits : {}
    return {
        enabled: flag(body.enabled),
        maintenanceMode: flag(body.maintenanceMode),
        directEvmPayoutEnabled: flag(body.directEvmPayoutEnabled),
        minUsdc: positive(limits.minUsdc),
        maxUsdc: positive(limits.maxUsdc),
        feeBps: integerBps(body.feeBps),
    }
}

// Ekranin okudugu ozet (PRIVATE_PROVIDER_INFO): YALNIZ sayilar ve musaitlik bayragi; adres, anahtar, ticket yok. Durum okunamadiysa
// (null) sayilar null ve saglayici musait sayilir (engel koymak assertAllowed'in ve teklifin isidir; burada fail-open okuma).
export function providerInfoOf(status) {
    if (!status) return { feeBps: null, minUsdc: null, maxUsdc: null, available: true }
    return {
        feeBps: status.feeBps ?? null,
        minUsdc: status.minUsdc ?? null,
        maxUsdc: status.maxUsdc ?? null,
        available: !(status.enabled === false || status.maintenanceMode === true),
    }
}

const guardError = (code, extra = {}) => Object.assign(new Error(code), extra)
const unitsOrNull = (n) => {
    try { return parseUnits(String(n), 18) } catch { return null }
}

export function createProviderGuard({ fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now(), minPayoutUsdc = MIN_PAYOUT_USDC } = {}) {
    let cached = null
    let inFlight = null
    let stamps = []

    async function readOnce() {
        try {
            const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(STATUS_TIMEOUT_MS) : undefined
            const res = await fetchImpl(PROVIDER_STATUS_URL, { method: 'GET', cache: 'no-store', credentials: 'omit', ...(signal ? { signal } : {}) })
            if (!res || res.ok !== true) return null
            return parseProviderStatus(await res.json())
        } catch {
            return null
        }
    }

    function status() {
        if (cached) {
            const age = now() - cached.at
            // Negatif yas (saat geri alindi) onbellegi gecersiz sayar.
            if (age >= 0 && age < cached.ttl) return Promise.resolve(cached.value)
        }
        if (!inFlight) {
            inFlight = readOnce().then((value) => {
                cached = { at: now(), ttl: value ? STATUS_OK_TTL_MS : STATUS_FAIL_TTL_MS, value }
                return value
            }).finally(() => { inFlight = null })
        }
        return inFlight
    }

    // status() onbellegini kullanir (ek istek yok).
    async function info() {
        return providerInfoOf(await status())
    }

    async function assertAllowed({ payoutUsdc } = {}) {
        const text = String(payoutUsdc)
        // Ekranla ve istek kurucuyla AYNI kanonik kural (privateConstants.js): bozuk tutar icin ag istegi yapilmaz.
        if (!CANONICAL_AMOUNT_RE.test(text)) throw guardError('PRIVATE_UNSUPPORTED', { reason: 'request.payout' })
        const s = await status()
        if (s?.enabled === false || s?.maintenanceMode === true) throw guardError('PRIVATE_PROVIDER_DOWN')
        const payout = parseUnits(text, 18)
        // Yerlesik taban HER ZAMAN hesaplanir ve uygulanir; sunucunun en az degeri yalniz YUKSELTME yonunde ve yalniz birime
        // cevrilebiliyorsa izlenir (cevrilemeyen deger yerlesik tabani sessizce atlatamaz).
        const builtIn = parseUnits(String(minPayoutUsdc), 18)
        const serverMin = s?.minUsdc != null ? unitsOrNull(s.minUsdc) : null
        const raise = serverMin !== null && serverMin > builtIn
        if (payout < (raise ? serverMin : builtIn)) throw guardError('PRIVATE_MIN_AMOUNT', { limitUsdc: String(raise ? s.minUsdc : minPayoutUsdc) })
        if (s?.maxUsdc != null) {
            const maxUnits = unitsOrNull(s.maxUsdc)
            if (maxUnits !== null && payout > maxUnits) throw guardError('PRIVATE_MAX_AMOUNT', { limitUsdc: String(s.maxUsdc) })
        }
    }

    function takeQuoteSlot() {
        const t = now()
        stamps = stamps.filter((at) => t - at < QUOTE_WINDOW_MS)
        if (stamps.length >= QUOTE_WINDOW_MAX) throw guardError('PRIVATE_RATE_LIMITED')
        stamps.push(t)
    }

    function reset() {
        cached = null
        inFlight = null
        stamps = []
    }

    return { status, info, assertAllowed, takeQuoteSlot, reset }
}

// Arka plan tek ornek kullanir (bellekte).
export const providerGuard = createProviderGuard()

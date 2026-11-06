import { nextTick, watch } from 'vue'
import { requestPrivacyMode } from './privacyModeRequest'

// Gizli moda giris/cikis gecisi. Hesap degisince header avatari, aksiyon izgarasi
// ve "Gizli islemlerim" ayni anda degisip icerigi kaydiriyordu; View Transitions
// API eski ekrani dondurur, guncelleme bitince yeniye erir (stil: popup/style.css,
// html.privacy-switching). Sinif yalniz bu gecis suresince durur: tema gecisi
// (Preferences.vue) de ayni API'yi kullanir ve varsayilan animasyonunu korur.
//
// Arayuz durumu privacyUiSync ile depodan ASENKRON doner; guncelleme, store hedef
// duruma gecene kadar (en cok timeoutMs) bekler ki yeni ekran yarim cizilmesin.
// Store donmese de onApplied cagrilir: istek basariliysa arayuz takili kalmaz.
// requestPrivacyMode gibi asla firlatmaz.
const SWITCHING_CLASS = 'privacy-switching'

export function canAnimate(doc) {
    if (typeof doc?.startViewTransition !== 'function') return false
    try {
        return !doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    } catch {
        return true
    }
}

function waitForPrivacyState(privacy, enabled, timeoutMs) {
    if (privacy.active === enabled) return Promise.resolve()
    return new Promise((resolve) => {
        let stop = null
        const done = () => {
            clearTimeout(timer)
            stop?.()
            resolve()
        }
        const timer = setTimeout(done, timeoutMs)
        stop = watch(() => privacy.active, (v) => { if (v === enabled) done() })
    })
}

export async function switchPrivacyMode(enabled, { privacy, onApplied, doc = globalThis.document, timeoutMs = 1500 } = {}) {
    let result = { ok: false, errorKey: 'privacy.errors.generic' }
    const update = async () => {
        result = await requestPrivacyMode(enabled)
        if (!result.ok) return
        await waitForPrivacyState(privacy, enabled, timeoutMs)
        onApplied?.()
        await nextTick()
    }

    if (!canAnimate(doc)) {
        await update()
        return result
    }

    const root = doc.documentElement
    root?.classList?.add(SWITCHING_CLASS)
    try {
        const vt = doc.startViewTransition(update)
        // Guncelleme hata verirse ya da tarayici gecisi atlarsa (or. 4 sn sinir) DOM yine
        // guncellenmis olur; sonuc update icinde yazildi.
        await vt.updateCallbackDone.catch(() => {})
        await vt.finished.catch(() => {})
    } catch {
        // startViewTransition kendisi firlatirsa animasyonsuz devam et.
        if (!result.ok) await update()
    } finally {
        root?.classList?.remove(SWITCHING_CLASS)
    }
    return result
}

import { canAnimate } from '../utils/privacy/privacySwitch'

// Gizli mod tonu ("atmosfer", popup/style.css) giris ekranlarinda DURAKLATILIR: hesap
// gizli olsa da kilit ekrani notr gorunur. <html class="privacy-paused"> varken ton
// kurallari uygulanmaz. Girisle ana ekrana gecilince ton, sayfa tamamen belirdikten
// sonra View Transition ile yavasca gelir (html.privacy-arriving). Kilitsiz acilista
// (yukleme -> ana ekran) gecis OYNAMAZ: her acilista animasyon yorucu olurdu.
// Cagiran App.vue: sayfa degisimini izler ve sayfa <Transition>'inin after-enter'ini iletir.
export const ATMOSPHERE_PAUSED_PAGES = ['', 'welcome', 'forgot_password']
const LOGIN_PAGES = ['welcome', 'forgot_password']
const PAUSED = 'privacy-paused'
const ARRIVING = 'privacy-arriving'

export function createAtmosphereController({ doc = globalThis.document, fallbackMs = 1500 } = {}) {
    let pending = false
    let fallback = null

    const clearPending = () => {
        pending = false
        clearTimeout(fallback)
        fallback = null
    }

    const arrive = () => {
        clearPending()
        const root = doc?.documentElement
        if (!root?.classList.contains(PAUSED)) return
        if (!canAnimate(doc)) {
            root.classList.remove(PAUSED)
            return
        }
        root.classList.add(ARRIVING)
        try {
            const vt = doc.startViewTransition(() => { root.classList.remove(PAUSED) })
            Promise.resolve(vt?.finished).catch(() => {}).finally(() => root.classList.remove(ARRIVING))
        } catch {
            root.classList.remove(PAUSED)
            root.classList.remove(ARRIVING)
        }
    }

    return {
        onPageChange(now, prev) {
            const root = doc?.documentElement
            if (!root) return
            if (ATMOSPHERE_PAUSED_PAGES.includes(now)) {
                clearPending()
                root.classList.add(PAUSED)
                return
            }
            if (!root.classList.contains(PAUSED)) return
            if (LOGIN_PAGES.includes(prev)) {
                // Sayfa gecisi (fade-slide) bitince onPageEntered gelir; gelmezse emniyet suresi.
                pending = true
                clearTimeout(fallback)
                fallback = setTimeout(arrive, fallbackMs)
                return
            }
            root.classList.remove(PAUSED)
        },
        onPageEntered() {
            if (pending) arrive()
        },
    }
}

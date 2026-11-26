// Sayfa yonu denetleyicisi: gezinme yigini, niyet, html[data-nav] ve gecis suresi.
// Gizlilik (K2): yigin ve niyet YALNIZ bellekte; bu modul depo ya da tarayici deposu kullanmaz.
import { navDirection } from '../utils/motion/navDirection'
import { motionAllowed } from '../utils/motion/motionAllowed'

export const NAV_DURATION_MS = Object.freeze({ none: 120, fwd: 200, back: 200, flight: 140 })

export function createPageNavController({
    doc = globalThis.document,
    page,
    getPrivacyActive = () => false,
    approvalPages = [],
    onReset = () => {},
    pickNav = (next, prev, dir) => dir,
} = {}) {
    let stack = []
    let privacyBase = !!getPrivacyActive()

    const privacyTransitionNow = () => {
        const cl = doc?.documentElement?.classList
        if (!cl || typeof cl.contains !== 'function') return false
        return !!(cl.contains('privacy-switching') || cl.contains('privacy-arriving'))
    }

    function onPageChange(next, prev) {
        const intent = page?.navIntent ?? null
        if (page) page.navIntent = null
        const nowPrivacy = !!getPrivacyActive()
        const res = navDirection({
            prev,
            next,
            stack,
            intent,
            privacyChanged: nowPrivacy !== privacyBase,
            privacyTransition: privacyTransitionNow(),
            approvalPages,
        })
        stack = res.stack
        privacyBase = nowPrivacy
        if (res.reset) onReset()
        const nav = pickNav(next, prev, res.dir) || res.dir
        const root = doc?.documentElement
        if (!root || typeof root.setAttribute !== 'function') return { nav, duration: 0 }
        root.setAttribute('data-nav', nav)
        const duration = motionAllowed(doc) ? (NAV_DURATION_MS[nav] ?? 0) : 0
        return { nav, duration }
    }

    function notePrivacy() {
        privacyBase = !!getPrivacyActive()
    }

    function reset() {
        stack = []
        onReset()
    }

    return { onPageChange, notePrivacy, reset, stack: () => stack.slice() }
}

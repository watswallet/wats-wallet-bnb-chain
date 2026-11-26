// Saf sayfa yonu ve gezinme yigini kurali. Girdi yigini degistirilmez.
export const NAV_STACK_MAX = 20
export const LOCK_PAGES = Object.freeze(['welcome', 'forgot_password', 'onboarding_pending'])

const none = (stack, reset = false) => ({ dir: 'none', stack, reset })

// next yigindaysa oraya kadar (dahil) keser; degilse null.
function cutTo(stack, next) {
    const i = stack.indexOf(next)
    return i >= 0 ? stack.slice(0, i + 1) : null
}

function pushCapped(stack, next) {
    const out = [...stack, next]
    while (out.length > NAV_STACK_MAX) {
        out.splice(out[0] === 'home' ? 1 : 0, 1)
    }
    return out
}

// 7-9: niyetsiz (ya da notr) yigin guncellemesi.
function plainUpdate(stack, next) {
    if (next === 'home') return { dir: 'back', stack: ['home'] }
    const cut = cutTo(stack, next)
    if (cut) return { dir: 'back', stack: cut }
    return { dir: 'fwd', stack: pushCapped(stack, next) }
}

export function navDirection({
    prev,
    next,
    stack = [],
    intent = null,
    privacyChanged = false,
    privacyTransition = false,
    approvalPages = [],
} = {}) {
    const cur = Array.isArray(stack) ? stack : []
    if (prev === next) return none([...cur])
    if (prev === '') return none([next])
    if (LOCK_PAGES.includes(prev) || LOCK_PAGES.includes(next)) {
        return none(LOCK_PAGES.includes(next) ? [] : [next], true)
    }
    if (approvalPages.includes(prev) || approvalPages.includes(next)) return none([next])
    if (privacyChanged || privacyTransition) return none([next], true)
    if (intent === 'neutral') return none(plainUpdate(cur, next).stack)
    if (intent === 'back') {
        const st = cutTo(cur, next) ?? [...cur.slice(0, -1), next]
        return { dir: 'back', stack: st, reset: false }
    }
    const r = plainUpdate(cur, next)
    return { dir: r.dir, stack: r.stack, reset: false }
}

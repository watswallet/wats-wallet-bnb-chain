// Simge ucusu denetleyicisi (spec 7.5, K5, D7): elle FLIP kopyasi.
// Ileri: Varliklar satirindaki simge -> Token basligi. Geri: Token basligi -> ayni satir simgesi.
// Kopya #app'in dogrudan cocugu, fixed, z-40, pointer-events:none; alttaki sayfa ilk kareden tiklanabilir.
// Gizlilik (K2): ucus anahtari YALNIZ bu modulun bellegindedir; depo ya da tarayici deposu kullanilmaz.
// Sayfa durumuna YAZMAZ: yalniz yon degerini secer ve DOM'da gecici kopya kurar.
import { motionAllowed } from '../utils/motion/motionAllowed'

export const FLIGHT_MS = 240
export const FLIGHT_SAFETY_MS = 400
export const FLIGHT_WAIT_MS = 150

const ICON_ATTR = 'data-flight-icon'
const TARGET_ATTR = 'data-flight-target'

// `to` konumundaki ogeyi `from`'da gosteren donusum (koken sol ust).
export function flipTransform(from, to) {
    const dx = from.left - to.left
    const dy = from.top - to.top
    const sx = to.width ? from.width / to.width : 1
    const sy = to.height ? from.height / to.height : 1
    return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
}

// Dikdortgen sinirlar icinde TAMAMEN mi? Bos (display:none) dikdortgen gorunmez sayilir.
export function isFullyVisible(rect, bounds) {
    if (!rect || !bounds) return false
    if (!(rect.width > 0) || !(rect.height > 0)) return false
    const bottom = rect.top + rect.height
    return rect.top >= bounds.top && bottom <= bounds.bottom
}

const rectOf = (el) => {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null
    const r = el.getBoundingClientRect()
    if (!r) return null
    return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export function createIconFlight({
    doc = globalThis.document,
    setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimer = (id) => globalThis.clearTimeout(id),
    allowed = () => motionAllowed(doc),
    isStockPage = () => false,
    isPrivate = () => false,
    selectedKey = () => null,
    homeTab = () => 'assets',
} = {}) {
    let flightKey = null // dogrudan ileri ucusla baslayan Token ziyaretinin anahtari
    let fwdPending = null // { from } afterPatch'i bekleyen ileri ucus
    let backPending = null // { from, key, timer } homeReady'yi bekleyen geri ucus
    let active = null // { clone, target, timer, onEnd, prevVisibility }

    const query = (sel) => (doc && typeof doc.querySelector === 'function' ? doc.querySelector(sel) : null)

    const privacyTransitionNow = () => {
        const cl = doc?.documentElement?.classList
        if (!cl || typeof cl.contains !== 'function') return false
        return !!(cl.contains('privacy-switching') || cl.contains('privacy-arriving'))
    }

    const findIcon = (key) => {
        if (key == null || !doc || typeof doc.querySelectorAll !== 'function') return null
        for (const el of Array.from(doc.querySelectorAll(`[${ICON_ATTR}]`))) {
            if (el && typeof el.getAttribute === 'function' && el.getAttribute(ICON_ATTR) === key) return el
        }
        return null
    }

    // Satir simgesi kaydiricinin gorunen alaninda (yapiskan sekmelerin altinda degil) tamamen mi?
    const iconVisibleRect = (icon) => {
        const rect = rectOf(icon)
        const tabs = rectOf(query('[data-home-tabs]'))
        const scroller = rectOf(query('[data-home-scroller]'))
        if (!rect || !tabs || !scroller) return null
        const bounds = { top: tabs.top + tabs.height, bottom: scroller.top + scroller.height }
        return isFullyVisible(rect, bounds) ? rect : null
    }

    const appRoot = () => {
        if (!doc) return null
        if (typeof doc.getElementById === 'function') {
            const el = doc.getElementById('app')
            if (el) return el
        }
        return query('#app')
    }

    function finish() {
        if (!active) return
        const a = active
        active = null
        clearTimer(a.timer)
        if (typeof a.clone.removeEventListener === 'function') a.clone.removeEventListener('transitionend', a.onEnd)
        if (typeof a.clone.remove === 'function') a.clone.remove()
        else a.clone.parentNode?.removeChild?.(a.clone)
        a.target.style.visibility = a.prevVisibility
    }

    // `target` yerinde duran ogenin kopyasi `from`'dan yerine kayar; gercek oge ucus boyunca gizli.
    function launch(target, from) {
        const app = appRoot()
        const to = rectOf(target)
        if (!app || typeof app.appendChild !== 'function' || !target?.style || typeof target.cloneNode !== 'function') return
        if (!to || !(to.width > 0) || !(to.height > 0)) return
        const clone = target.cloneNode(true)
        if (!clone?.style) return
        if (typeof clone.removeAttribute === 'function') {
            clone.removeAttribute(TARGET_ATTR)
            clone.removeAttribute(ICON_ATTR)
            clone.removeAttribute('id')
        }
        if (typeof clone.setAttribute === 'function') clone.setAttribute('aria-hidden', 'true')
        const s = clone.style
        s.transition = 'none'
        s.position = 'fixed'
        s.boxSizing = 'border-box'
        s.left = `${to.left}px`
        s.top = `${to.top}px`
        s.width = `${to.width}px`
        s.height = `${to.height}px`
        s.margin = '0'
        s.zIndex = '40'
        s.pointerEvents = 'none'
        s.transformOrigin = '0 0'
        s.transform = flipTransform(from, to)
        app.appendChild(clone)

        const prevVisibility = target.style.visibility ?? ''
        target.style.visibility = 'hidden'

        // Yerlesimi bir kez oku: baslangic donusumu boyansin, gecis ondan baslasin.
        if (typeof clone.getBoundingClientRect === 'function') clone.getBoundingClientRect()
        s.transition = `transform ${FLIGHT_MS / 1000}s var(--ease-kaymak)`
        s.transform = 'none'

        const onEnd = (e) => {
            if (e && e.target && e.target !== clone) return
            finish()
        }
        if (typeof clone.addEventListener === 'function') clone.addEventListener('transitionend', onEnd)
        active = { clone, target, onEnd, prevVisibility, timer: setTimer(finish, FLIGHT_SAFETY_MS) }
    }

    function cancel() {
        finish()
        fwdPending = null
        if (backPending) {
            clearTimer(backPending.timer)
            backPending = null
        }
        flightKey = null
    }

    function canFly() {
        return !!allowed() && !isPrivate() && !privacyTransitionNow()
    }

    function onPageChange(next, prev, dir) {
        const visitKey = flightKey
        cancel()

        if (prev === 'home' && next === 'token' && dir === 'fwd') {
            if (!canFly() || isStockPage()) return dir
            const key = selectedKey()
            const from = iconVisibleRect(findIcon(key))
            if (!from) return dir
            fwdPending = { from }
            flightKey = key
            return 'flight'
        }

        if (prev === 'token' && next === 'home' && dir === 'back') {
            if (visitKey == null || visitKey !== selectedKey()) return dir
            if (!canFly() || homeTab() !== 'assets') return dir
            const from = rectOf(query(`[${TARGET_ATTR}]`))
            if (!from || !(from.width > 0) || !(from.height > 0)) return dir
            const pending = { from, key: visitKey, timer: null }
            pending.timer = setTimer(() => {
                if (backPending === pending) backPending = null
            }, FLIGHT_WAIT_MS)
            backPending = pending
            return 'flight'
        }

        return dir
    }

    // Sayfa DOM'u guncellendikten sonra (post): bekleyen ileri ucusu baslatir.
    function afterPatch() {
        if (!fwdPending) return
        const { from } = fwdPending
        fwdPending = null
        const target = query(`[${TARGET_ATTR}]`)
        if (!target) return
        launch(target, from)
    }

    // Home konumu oturdu (geri ucus): bekleme suresi icindeyse simgeye ucar.
    function homeReady(ok) {
        if (!backPending) return
        const { from, key, timer } = backPending
        backPending = null
        clearTimer(timer)
        if (!ok) return
        if (!canFly()) return
        const icon = findIcon(key)
        if (!iconVisibleRect(icon)) return
        launch(icon, from)
    }

    return { onPageChange, afterPatch, homeReady, cancel }
}

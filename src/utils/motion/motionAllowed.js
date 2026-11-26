// Hareket izni: azaltilmis hareket tercihi ve gizli belge hareketi kapatir.
// Her cagrida yeniden okunur (tercih calisirken degisebilir).
export function motionAllowed(
    doc = globalThis.document,
    win = doc?.defaultView ?? globalThis.window,
) {
    if (!doc) return false
    if (doc.visibilityState === 'hidden') return false
    if (typeof win?.matchMedia !== 'function') return false
    try {
        const q = win.matchMedia('(prefers-reduced-motion: reduce)')
        if (q && q.matches) return false
    } catch {
        return false
    }
    return true
}

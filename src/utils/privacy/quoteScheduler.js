// Gizli mod otomatik teklif durum makinesi (saf; hicbir sey import etmez).
// Zaman, zamanlayici ve teklif cagrisi disaridan verilir: testler sahte saat kullanir.
//
// Fazlar: idle | waiting | quoting | ready | error | rateWait | expired | locked | stopped

export const AMOUNT_DEBOUNCE_MS = 800
export const DISCRETE_DEBOUNCE_MS = 300
export const QUOTE_COOLDOWN_MS = 2000
export const LOCAL_BUDGET_MAX = 12
export const LOCAL_BUDGET_WINDOW_MS = 60000
export const REFRESH_LEAD_MS = 8000
export const AUTO_REFRESH_MAX = 5
export const RATE_RETRY_FIRST_MS = 5000
export const RATE_RETRY_MAX = 3

const RATE_LIMITED = 'PRIVATE_RATE_LIMITED'
const RATE_WAIT_CAP_MS = 60000

/**
 * run({ seq, isCurrent, refresh }) =>
 *   Promise<{ status:'ok', endMs:number } | { status:'stale' } | { status:'error', code:string|null }>
 */
export function createQuoteScheduler({
    run,
    onChange,
    now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    isVisible = () => true
}) {
    let phase = 'idle'
    let seq = 0
    let errorCode = null
    let autoRefreshes = 0
    let endMs = null
    let refreshing = false

    let disposed = false
    let inFlight = false // bir run uctayken (eski seq olsa da) yenisi baslamaz
    let pending = null // { refresh:boolean, minAt:number } planlanan sonraki run
    let runTimer = null
    let expiryTimer = null
    let runStarts = [] // son 60 sn icindeki run baslangic damgalari
    let lastStart = null
    let lastEnd = null
    let rateCount = 0
    let staleCount = 0
    let refreshBlocked = false // on yenileme hata verdi: yeni girdiye dek tekrar denenmez

    let lastEmitted = null

    function snapshot() {
        return { phase, seq, errorCode, autoRefreshes, endMs, refreshing }
    }

    function emit() {
        if (disposed) return
        const s = snapshot()
        if (
            lastEmitted &&
            lastEmitted.phase === s.phase &&
            lastEmitted.seq === s.seq &&
            lastEmitted.errorCode === s.errorCode &&
            lastEmitted.autoRefreshes === s.autoRefreshes &&
            lastEmitted.endMs === s.endMs &&
            lastEmitted.refreshing === s.refreshing
        ) {
            return
        }
        lastEmitted = s
        if (typeof onChange === 'function') onChange(s)
    }

    function cancelRunTimer() {
        if (runTimer !== null) {
            clearTimer(runTimer)
            runTimer = null
        }
    }

    function cancelExpiryTimer() {
        if (expiryTimer !== null) {
            clearTimer(expiryTimer)
            expiryTimer = null
        }
    }

    function cancelTimers() {
        cancelRunTimer()
        cancelExpiryTimer()
        pending = null
    }

    function pruneBudget(t) {
        while (runStarts.length && t - runStarts[0] >= LOCAL_BUDGET_WINDOW_MS) runStarts.shift()
    }

    // Butce acikken t, doluysa en eski damga + pencere
    function budgetFreeAt(t) {
        pruneBudget(t)
        if (runStarts.length >= LOCAL_BUDGET_MAX) return runStarts[0] + LOCAL_BUDGET_WINDOW_MS
        return t
    }

    function computeDue(p) {
        const t = now()
        let due = Math.max(p.minAt, t)
        if (lastStart !== null) {
            const anchor = lastEnd !== null ? Math.max(lastStart, lastEnd) : lastStart
            due = Math.max(due, anchor + QUOTE_COOLDOWN_MS)
        }
        return Math.max(due, budgetFreeAt(t))
    }

    function dropRefreshPlan() {
        if (pending && pending.refresh) {
            cancelRunTimer()
            pending = null
            autoRefreshes = Math.max(0, autoRefreshes - 1)
        }
    }

    function armPending() {
        cancelRunTimer()
        if (!pending || inFlight || disposed) return
        const due = computeDue(pending)
        if (pending.refresh && !(due < endMs)) {
            dropRefreshPlan()
            return
        }
        runTimer = setTimer(fireRun, Math.max(0, due - now()))
    }

    function fireRun() {
        runTimer = null
        if (disposed || !pending) return
        if (inFlight) return // bitince onResult yeniden kurar
        const due = computeDue(pending)
        if (due > now()) {
            armPending()
            return
        }
        if (pending.refresh && !isVisible()) {
            dropRefreshPlan()
            emit()
            return
        }
        const p = pending
        pending = null
        startRun(p.refresh)
    }

    function planRun(minAt) {
        pending = { refresh: false, minAt }
        armPending()
    }

    function planRefresh() {
        if (disposed || phase !== 'ready' || refreshing || pending) return
        if (refreshBlocked || autoRefreshes >= AUTO_REFRESH_MAX) return
        if (!isVisible()) return
        if (!(endMs > now())) return
        const p = { refresh: true, minAt: endMs - REFRESH_LEAD_MS }
        // planlanan an endMs ten kucuk degilse yenileme denenmez
        if (!(computeDue(p) < endMs)) return
        autoRefreshes++
        pending = p
        armPending()
    }

    function toExpired() {
        cancelTimers()
        refreshing = false
        phase = 'expired'
    }

    // Etkin bitisi uygular: gecmis/gecersizse HEMEN expired, degilse bitis zamanlayicisi
    function applyEnd(newEndMs) {
        cancelExpiryTimer()
        endMs = newEndMs
        if (!(newEndMs > now())) {
            toExpired()
            return false
        }
        expiryTimer = setTimer(onExpiry, Math.max(0, newEndMs - now()))
        return true
    }

    function onExpiry() {
        expiryTimer = null
        if (disposed || phase !== 'ready') return
        toExpired()
        emit()
    }

    function startRun(refresh) {
        const mySeq = seq
        const t = now()
        runStarts.push(t)
        lastStart = t
        inFlight = true
        if (refresh) {
            refreshing = true
        } else {
            phase = 'quoting'
            errorCode = null
        }
        emit()
        let result
        try {
            result = Promise.resolve(run({ seq: mySeq, isCurrent: () => mySeq === seq, refresh }))
        } catch (e) {
            result = Promise.resolve({ status: 'error', code: null })
        }
        result
            .then(
                (r) => r,
                () => ({ status: 'error', code: null })
            )
            .then((r) => onResult(mySeq, refresh, r))
    }

    function onResult(mySeq, refresh, r) {
        inFlight = false
        lastEnd = now()
        if (disposed) return
        const res = r && typeof r === 'object' ? r : { status: 'error', code: null }
        if (mySeq === seq) {
            if (refresh) applyRefreshResult(res)
            else applyQuoteResult(res)
        }
        if (pending && runTimer === null) armPending()
        emit()
    }

    function applyRefreshResult(res) {
        if (phase !== 'ready' || !refreshing) return
        refreshing = false
        if (res.status === 'ok') {
            refreshBlocked = false
            if (applyEnd(res.endMs)) planRefresh()
        } else if (res.status === 'error') {
            // faz ready kalir, endMs te expired; yeni girdiye dek tekrar denenmez
            refreshBlocked = true
        }
    }

    function applyQuoteResult(res) {
        if (phase !== 'quoting') return
        if (res.status === 'ok') {
            rateCount = 0
            staleCount = 0
            errorCode = null
            refreshBlocked = false
            if (applyEnd(res.endMs)) {
                phase = 'ready'
                planRefresh()
            }
            return
        }
        if (res.status === 'stale') {
            // seq guncel ama sonuc atildi: quoting da takilma
            staleCount++
            if (staleCount > RATE_RETRY_MAX) {
                phase = 'error'
                errorCode = null
                return
            }
            phase = 'waiting'
            planRun(now())
            return
        }
        const code = res.code === undefined ? null : res.code
        if (code === RATE_LIMITED) {
            rateCount++
            if (rateCount > RATE_RETRY_MAX) {
                phase = 'error'
                errorCode = code
                return
            }
            const t = now()
            const delay = Math.min(RATE_WAIT_CAP_MS, Math.max(RATE_RETRY_FIRST_MS, budgetFreeAt(t) - t))
            phase = 'rateWait'
            errorCode = code
            planRun(t + delay)
            return
        }
        phase = 'error'
        errorCode = code
    }

    function resetForNewSeq() {
        seq++
        cancelTimers()
        refreshing = false
        autoRefreshes = 0
        endMs = null
        errorCode = null
        rateCount = 0
        staleCount = 0
        refreshBlocked = false
    }

    function input(kind, eligible) {
        if (disposed) return
        resetForNewSeq()
        if (eligible === false) {
            phase = 'idle'
        } else {
            phase = 'waiting'
            const debounce = kind === 'amount' ? AMOUNT_DEBOUNCE_MS : DISCRETE_DEBOUNCE_MS
            planRun(now() + debounce)
        }
        emit()
    }

    function retry() {
        if (disposed || phase === 'locked') return
        resetForNewSeq()
        phase = 'waiting'
        planRun(now())
        emit()
    }

    function stop() {
        if (disposed) return
        resetForNewSeq()
        phase = 'stopped'
        emit()
    }

    function fail(code) {
        if (disposed) return
        cancelTimers()
        refreshing = false
        phase = 'error'
        errorCode = code === undefined ? null : code
        emit()
    }

    function lock() {
        if (disposed) return
        cancelTimers()
        refreshing = false
        phase = 'locked'
        emit()
    }

    function touch() {
        if (disposed) return
        autoRefreshes = 0
        planRefresh()
        emit()
    }

    function visibilityChanged() {
        if (disposed) return
        if (phase === 'ready') {
            if (isVisible()) planRefresh()
            else dropRefreshPlan()
        }
        emit()
    }

    function dispose() {
        if (disposed) return
        cancelTimers()
        disposed = true
    }

    return { input, retry, stop, fail, lock, touch, visibilityChanged, snapshot, dispose }
}

import { computed, onScopeDispose, shallowRef, toValue, watch } from 'vue'
import { QUOTE_DEBOUNCE_MS } from '../utils/cow/config'

const IDLE = Object.freeze({ state: 'idle', result: null, quoteId: null, expiresAt: null, approveUntil: null, errorCode: null, lockReason: null, errorInfo: null })

// "Tutar ag ucretini karsilamiyor" yanitinin sayisal alanlari. Arka plan zaten yalniz rakam dizeleri yollar; burada bir
// kez daha dogrulanir: ham metin / nesne arayuze ASLA gecmez. Gecersizse null (ekran genel metni gosterir).
const ATOMS = /^\d{1,40}$/
const PLAIN_NUMBER = /^\d{1,40}(\.\d{1,40})?$/
const okText = (re, v) => typeof v === 'string' && re.test(v)
const ATOM_TEXT = /^\d{1,60}$/
function pickInsufficientInfo(res) {
  const { requiredAtoms, availableAtoms, decimals } = res
  if (!okText(ATOM_TEXT, requiredAtoms) || !okText(ATOM_TEXT, availableAtoms)) return null
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null
  return { requiredAtoms, availableAtoms, decimals }
}
function pickErrorInfo(res) {
  if (res.code === 'INSUFFICIENT_BALANCE') return pickInsufficientInfo(res)
  if (res.code !== 'AMOUNT_TOO_SMALL') return null
  const { feeAtoms, feeDisplay, feeUsd, minAmountDisplay, missingDisplay } = res
  if (!okText(ATOMS, feeAtoms) || !okText(PLAIN_NUMBER, feeDisplay)) return null
  if (!okText(PLAIN_NUMBER, minAmountDisplay) || !okText(PLAIN_NUMBER, missingDisplay)) return null
  const out = { feeDisplay, minAmountDisplay, missingDisplay }
  if (okText(PLAIN_NUMBER, feeUsd)) out.feeUsd = feeUsd
  return out
}

/** Saf cekirdek (Vue'suz, zamanlayici enjekte). send(message) -> Promise<COW_QUOTE yaniti>. */
export function createQuoteController({
  send,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  debounceMs = QUOTE_DEBOUNCE_MS,
  visible = () => true,
  onChange = () => {},
} = {}) {
  let snap = { ...IDLE }
  let seq = 0
  let disposed = false
  let lastMsg = null
  let debounceTimer = null
  let expiryTimer = null
  let inflight = null

  const set = (next) => {
    snap = { ...IDLE, ...next }
    onChange({ ...snap })
  }
  const clearTimers = () => {
    if (debounceTimer !== null) clearTimer(debounceTimer)
    if (expiryTimer !== null) clearTimer(expiryTimer)
    debounceTimer = null
    expiryTimer = null
  }

  function scheduleExpiry() {
    if (expiryTimer !== null) {
      clearTimer(expiryTimer)
      expiryTimer = null
    }
    if (disposed || snap.state !== 'ready' || !visible()) return
    const at = snap.expiresAt
    if (typeof at !== 'number' || !Number.isFinite(at)) return
    expiryTimer = setTimer(() => {
      expiryTimer = null
      if (visible()) refresh()
    }, Math.max(0, at - now()))
  }

  function apply(mySeq, res) {
    if (disposed || mySeq !== seq) return
    inflight = null
    if (!res || typeof res !== 'object' || (res.success !== true && res.success !== false)) {
      set({ state: 'error', errorCode: 'UNKNOWN' })
      return
    }
    if (res.success === false) {
      set({ state: 'error', errorCode: typeof res.code === 'string' ? res.code : 'UNKNOWN', errorInfo: pickErrorInfo(res) })
      return
    }
    const common = {
      result: res,
      quoteId: res.quoteId ?? null,
      expiresAt: res.expiresAt ?? null,
      approveUntil: res.approveUntil ?? null,
    }
    if (res.locked) {
      set({ ...common, state: 'locked', lockReason: res.lockReason ?? null })
      return
    }
    set({ ...common, state: 'ready' })
    scheduleExpiry()
  }

  function fire(mySeq, msg) {
    let p
    try {
      p = Promise.resolve(send(msg))
    } catch (e) {
      p = Promise.reject(e)
    }
    // hata metni arayuze sizmaz: reddedilen her istek UNKNOWN olur
    const done = p.then(
      (res) => apply(mySeq, res),
      () => apply(mySeq, null),
    )
    inflight = done
    return done
  }

  function request(msg) {
    if (disposed) return
    if (msg === null || msg === undefined) {
      invalidate()
      return
    }
    clearTimers()
    inflight = null
    lastMsg = msg
    seq += 1
    const mySeq = seq
    set({ state: 'loading' })
    debounceTimer = setTimer(() => {
      debounceTimer = null
      fire(mySeq, msg)
    }, debounceMs)
  }

  function refresh() {
    if (disposed || lastMsg === null) return Promise.resolve()
    if (inflight && debounceTimer === null && snap.state === 'loading') return inflight
    clearTimers()
    seq += 1
    set({ state: 'loading' })
    return fire(seq, lastMsg)
  }

  function invalidate() {
    clearTimers()
    inflight = null
    lastMsg = null
    seq += 1
    set({ state: 'idle' })
  }

  /** Gorunurluk degisince: gorunur olduysa suresi gecmis teklifi hemen yeniler. */
  function syncVisibility() {
    if (disposed) return
    if (snap.state === 'ready') scheduleExpiry()
  }

  function dispose() {
    disposed = true
    clearTimers()
    inflight = null
    seq += 1
  }

  return { request, refresh, invalidate, dispose, syncVisibility, snapshot: () => ({ ...snap }) }
}

/** Vue sarmalayici: request getter'i izler, onChange'i ref'e yansitir, kapsam bitince dispose. */
export function useCowQuote({ request, enabled = true, visible = true, send } = {}) {
  const view = shallowRef({ ...IDLE })
  const sender = send ?? ((message) => chrome.runtime.sendMessage({ type: 'COW_QUOTE', message }))
  const ctrl = createQuoteController({
    send: sender,
    visible: () => toValue(visible) !== false,
    onChange: (s) => {
      view.value = s
    },
  })
  const key = () => {
    if (!toValue(enabled)) return ''
    const msg = toValue(request)
    return msg ? JSON.stringify(msg) : ''
  }
  watch(key, (k) => ctrl.request(k ? JSON.parse(k) : null), { immediate: true })
  watch(
    () => toValue(visible),
    (v) => {
      if (v) ctrl.syncVisibility()
    },
  )
  onScopeDispose(() => ctrl.dispose())
  const pick = (name) => computed(() => view.value[name])
  return {
    state: pick('state'),
    result: pick('result'),
    quoteId: pick('quoteId'),
    expiresAt: pick('expiresAt'),
    errorCode: pick('errorCode'),
    errorInfo: pick('errorInfo'),
    lockReason: pick('lockReason'),
    refresh: () => ctrl.refresh(),
    invalidate: () => ctrl.invalidate(),
  }
}

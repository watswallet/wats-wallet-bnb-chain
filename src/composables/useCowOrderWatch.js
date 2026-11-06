import { computed, onScopeDispose, shallowRef, toValue, watch } from 'vue'
import { POPUP_POLL_MS } from '../utils/cow/config'

// Popup acikken bekleyen TEK emri 3 sn'de bir arka plana sordurur (COW_ORDERS_REFRESH). Karar arka plandadir
// (poller); burasi yalniz sonucu gosterilebilir faza cevirir. Popup kapaliyken Gecmis'i alarm gunceller.

export const WATCH_INTERVAL_MS = POPUP_POLL_MS
export const STILL_PENDING_MS = Object.freeze({ 56: 60_000, default: 90_000 }) // spec 6.7 ipucu

// Arka plan COW_UID_RE ile ayni. UID gecersizse HIC istek atilmaz: arka plan gecersiz UID'leri sessizce
// eler, bos liste doner; "hepsi gecersiz" ile "kayit yok" ayrimi arayuzde yapilamaz, bu yuzden onlenir.
const UID_RE = /^0x[0-9a-f]{112}$/i
const TERMINAL = new Set(['fulfilled', 'expired', 'cancelled'])
const PHASE_OF = Object.freeze({
  submitting: 'submitting',
  open: 'pending',
  fulfilled: 'fulfilled',
  expired: 'expired',
  cancelled: 'cancelled',
})

const lc = (v) => String(v ?? '').toLowerCase()
const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

/** Saf cekirdek (Vue'suz, zamanlayici enjekte). send({ type, message }) -> Promise<COW_ORDERS_REFRESH yaniti>. */
export function createOrderWatch({
  send,
  uid,
  chainId,
  initial = 'submitting',
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  visible = isVisible,
  onChange = () => {},
} = {}) {
  const wanted = typeof uid === 'string' && UID_RE.test(uid) ? lc(uid) : null
  const threshold = STILL_PENDING_MS[Number(chainId)] ?? STILL_PENDING_MS.default
  let snap = {
    phase: initial === 'pending' ? 'pending' : 'submitting',
    apiStatus: null,
    txHash: null,
    executedBuy: null,
    executedSell: null,
  }
  let startedAt = null
  let timer = null
  let started = false
  let stopped = false
  let lastKey = null

  const stillPending = () => startedAt !== null && !TERMINAL.has(snap.phase) && now() - startedAt >= threshold
  const snapshot = () => ({ ...snap, stillPending: stillPending() })
  const emitIfChanged = () => {
    const s = snapshot()
    const key = JSON.stringify(s)
    if (key === lastKey) return
    lastKey = key
    onChange(s)
  }

  function apply(res) {
    if (!res || res.success !== true || !Array.isArray(res.orders)) return
    const rec = res.orders.find((o) => o && lc(o.uid) === wanted)
    const phase = rec ? PHASE_OF[rec.status] : undefined
    if (!phase) return
    snap = {
      phase,
      apiStatus: rec.apiStatus ?? null,
      txHash: rec.txHash ?? null,
      executedBuy: rec.executedBuyAmount ?? null,
      executedSell: rec.executedSellAmount ?? null,
    }
  }

  function schedule() {
    if (stopped || !started || timer !== null) return
    timer = setTimer(tick, WATCH_INTERVAL_MS)
  }

  async function tick() {
    timer = null
    if (stopped) return
    if (visible()) {
      try {
        const res = await send({ type: 'COW_ORDERS_REFRESH', message: { uids: [wanted] } })
        if (stopped) return
        apply(res)
      } catch {
        // sendMessage reddi hata fazi uretmez; sonraki tikte yeniden denenir
        if (stopped) return
      }
    }
    if (TERMINAL.has(snap.phase)) stop()
    emitIfChanged()
    schedule()
  }

  function start() {
    if (started || stopped || wanted === null) return
    started = true
    startedAt = now()
    lastKey = JSON.stringify(snapshot())
    schedule()
  }

  function stop() {
    stopped = true
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  return { start, stop, snapshot }
}

/** Vue sarmalayici: uid getter'i dolunca yoklamayi baslatir, degisince yeniler, kapsam bitince durdurur. */
export function useCowOrderWatch({ uid, chainId, initial, send } = {}) {
  const sender = send ?? ((message) => chrome.runtime.sendMessage(message))
  const view = shallowRef(createOrderWatch({ uid: null }).snapshot())
  let ctrl = null
  const halt = () => {
    if (ctrl) ctrl.stop()
    ctrl = null
  }
  watch(
    () => toValue(uid),
    (u) => {
      halt()
      view.value = createOrderWatch({ uid: null, initial: toValue(initial) }).snapshot()
      if (!u) return
      ctrl = createOrderWatch({
        send: sender,
        uid: u,
        chainId: toValue(chainId),
        initial: toValue(initial),
        onChange: (s) => {
          view.value = s
        },
      })
      view.value = ctrl.snapshot()
      ctrl.start()
    },
    { immediate: true },
  )
  onScopeDispose(halt)
  const pick = (name) => computed(() => view.value[name])
  return {
    phase: pick('phase'),
    apiStatus: pick('apiStatus'),
    txHash: pick('txHash'),
    executedBuy: pick('executedBuy'),
    executedSell: pick('executedSell'),
    stillPending: pick('stillPending'),
  }
}

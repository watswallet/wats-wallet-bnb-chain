// CoW emir yoklayicisi (spec 5.6, 6.7; K9-K11): bekleyen emirleri CoW'dan cozer, cow_orders kaydini ve
// Gecmis satirini gunceller. Bayraktan BAGIMSIZ (K10): servis calisani olse de kalici kayittan devam eder;
// bekleyen kayit yoksa HIC ag istegi atmaz. Govde / imza / postBody log'a ve sonuca girmez.
import { ORDER_STATUS, isPendingOrder, reconcileOrder, applyTrades, planSubmitting, resolveNotFound } from './orders'
import { reconcileFee } from './fee'
import { COW_RECEIPT_STATUS } from '../processTransaction'

// Bir tikte en fazla bu kadar kayit (en eski createdAt once); kalan sonraki tike
export const POLL_MAX_PER_TICK = 5
// fulfilled ama txHash'siz kayit icin GET trades yeniden deneme penceresi
export const TRADES_RETRY_WINDOW_MS = 10 * 60 * 1000

// POST'un gecici sayilan hatalari: kayit kalir, sonraki tik cozer. Digerleri (4xx red) para cikmadan biter.
const TRANSIENT_POST = new Set(['NETWORK', 'TIMEOUT', 'SERVER', 'RATE_LIMITED', 'BAD_RESPONSE', 'UNKNOWN'])
const STOP_CODES = new Set(['RATE_LIMITED', 'FORBIDDEN'])
const TERMINAL_RECEIPT = {
  [ORDER_STATUS.EXPIRED]: COW_RECEIPT_STATUS.expired,
  [ORDER_STATUS.CANCELLED]: COW_RECEIPT_STATUS.cancelled,
}

const lc = (v) => String(v ?? '').toLowerCase()
const str = (v) => (v == null ? null : String(v))

/** Mesaj-guvenli ozet (postBody, appData YOK; tutarlar dize). */
export function orderView(rec) {
  const r = rec || {}
  return {
    uid: r.uid,
    chainId: r.chainId,
    side: r.side,
    symbol: r.symbol,
    status: r.status,
    apiStatus: r.apiStatus ?? null,
    sellAmount: str(r.sellAmount),
    buyAmount: str(r.buyAmount),
    expectedBuy: str(r.expectedBuy),
    executedSellAmount: str(r.executedSellAmount),
    executedBuyAmount: str(r.executedBuyAmount),
    txHash: r.txHash ?? null,
    validTo: r.validTo,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    approvalMode: r.approvalMode,
    lastError: r.lastError ?? null,
  }
}

/** deps = { api, orders: { loadOrders, patchOrder, removeOrder }, pendingRows: { resolve, remove }, now } */
export function createCowPoller({ api, orders, pendingRows, now = Date.now }) {
  let inflight = null

  // Kayit yoksa / hata varsa null; asla firlatmaz (yama hatasi cagiran try/catch'ine birakilir)
  const patch = (uid, patchOrFn, at) => orders.patchOrder(uid, patchOrFn, at)

  const dropRecord = async (uid) => {
    await orders.removeOrder(uid)
    await pendingRows.remove(uid)
  }

  // fulfilled kaydi icin trades -> txHash; basarisizlik kaydi geri almaz ve updatedAt'i oynatmaz
  const completeTrades = async (rec, at) => {
    const res = await api.getTrades(rec.chainId, rec.uid)
    if (!res.ok) return null
    const updated = await patch(rec.uid, (cur) => (cur.txHash ? {} : applyTrades(cur, res.data, at)), at)
    return updated?.txHash ?? null
  }

  const resolveRow = (uid, receiptStatus, txHash) => {
    const arg = { uid, receiptStatus }
    if (receiptStatus === COW_RECEIPT_STATUS.fulfilled) arg.txHash = txHash ?? undefined
    return pendingRows.resolve(arg)
  }

  // GET /orders/{uid} sonucunu kayda isler; terminal gecis yan etkilerini yurutur. { status, apiStatus }
  const applyOrderResponse = async (rec, data, at, withProgress) => {
    let applied = {}
    const updated = await patch(
      rec.uid,
      (cur) => {
        applied = reconcileOrder(cur, data, at)
        if (!applied.status) return applied
        // Basarili durum gecisinde eski gecici hata temizlenir
        const patch = { ...applied, lastError: null }
        // Terminal gecis: ucret durumu AYNI yamada ilerler (yarim kalmis durum olusmaz).
        // Ag, anahtar ya da bayrak yok; mode 'none' kayitta reconcileFee {} dondurur.
        if (applied.status !== ORDER_STATUS.OPEN) {
          Object.assign(patch, reconcileFee(cur, { type: 'ORDER_STATUS', status: applied.status }, at))
        }
        return patch
      },
      at,
    )
    if (!updated) return { status: rec.status, apiStatus: rec.apiStatus ?? null }
    const next = applied.status

    if (next === ORDER_STATUS.FULFILLED) {
      let txHash = null
      try {
        txHash = await completeTrades(updated, at)
      } catch {
        // trades hatasi kaydi geri almaz (K9/K11)
      }
      await resolveRow(rec.uid, COW_RECEIPT_STATUS.fulfilled, txHash)
      return { status: ORDER_STATUS.FULFILLED, apiStatus: updated.apiStatus ?? null }
    }
    if (next === ORDER_STATUS.EXPIRED || next === ORDER_STATUS.CANCELLED) {
      await resolveRow(rec.uid, TERMINAL_RECEIPT[next])
      return { status: next, apiStatus: updated.apiStatus ?? null }
    }

    let apiStatus = updated.apiStatus ?? null
    if (withProgress && updated.status === ORDER_STATUS.OPEN) {
      const st = await api.getOrderStatus(rec.chainId, rec.uid)
      const label = typeof st.data === 'string' ? st.data : st.data?.type
      if (st.ok && typeof label === 'string' && label) {
        await patch(rec.uid, (cur) => (isPendingOrder(cur) ? { apiStatus: label } : {}), at)
        apiStatus = label
      }
    }
    return { status: updated.status, apiStatus }
  }

  const markError = (rec, code, at) => patch(rec.uid, { lastError: code }, at)

  // submitting: 60 sn sonra GET; yoksa en fazla bir kez yeniden POST (write-ahead sayac once)
  const handleSubmitting = async (rec, at, withProgress) => {
    if (planSubmitting(rec, at) === 'WAIT') return { status: rec.status }
    const res = await api.getOrder(rec.chainId, rec.uid)
    if (res.ok) return applyOrderResponse(rec, res.data, at, withProgress)
    if (STOP_CODES.has(res.code)) {
      await markError(rec, res.code, at)
      return { status: rec.status, stop: res.code }
    }
    if (res.code !== 'ORDER_NOT_FOUND') {
      await markError(rec, res.code, at)
      return { status: rec.status }
    }

    const plan = resolveNotFound(rec, at)
    if (plan === 'DROP') {
      await dropRecord(rec.uid)
      return { status: 'removed' }
    }
    if (plan === 'WAIT') return { status: rec.status }

    // REPOST: postBody yoksa gonderilecek bir sey de yok
    if (!rec.postBody) {
      await markError(rec, 'INVALID_ORDER', at)
      return { status: rec.status }
    }
    // Sayac POST'tan ONCE yazilir: servis calisani POST sirasinda olse bile ikinci POST olmaz
    await patch(rec.uid, (cur) => ({ repostCount: (cur.repostCount || 0) + 1, lastPostAt: at }), at)
    const post = await api.postOrder(rec.chainId, rec.postBody)
    if (post.ok) {
      await patch(
        rec.uid,
        (cur) => (cur.status === ORDER_STATUS.SUBMITTING ? { status: ORDER_STATUS.OPEN, postBody: null, lastError: null } : {}),
        at,
      )
      return { status: ORDER_STATUS.OPEN }
    }
    if (TRANSIENT_POST.has(post.code)) {
      await markError(rec, post.code, at)
      return { status: rec.status, stop: STOP_CODES.has(post.code) ? post.code : undefined }
    }
    // Kesin red: para cikmadi, kayit ve satir silinir
    await dropRecord(rec.uid)
    return { status: 'removed', stop: STOP_CODES.has(post.code) ? post.code : undefined }
  }

  const handleOpen = async (rec, at, withProgress) => {
    const res = await api.getOrder(rec.chainId, rec.uid)
    if (res.ok) return applyOrderResponse(rec, res.data, at, withProgress)
    // 404 ve diger hatalar acik emri DUSURMEZ (ag / CDN tuhafligi); expired yalniz CoW yanitindan gelir
    await markError(rec, res.code, at)
    return { status: rec.status, stop: STOP_CODES.has(res.code) ? res.code : undefined }
  }

  // fulfilled ama txHash'siz: yalniz trades; basarisizlikta kayda DOKUNULMAZ (pencere uzamaz)
  const handleFulfilled = async (rec, at) => {
    const txHash = await completeTrades(rec, at)
    if (txHash) await resolveRow(rec.uid, COW_RECEIPT_STATUS.fulfilled, txHash)
    return { status: ORDER_STATUS.FULFILLED }
  }

  const tick = async ({ uids, withProgress } = {}) => {
    const at = now()
    const all = await orders.loadOrders()
    const wanted = Array.isArray(uids) ? new Set(uids.map(lc)) : null
    const candidates = (all || [])
      .filter((r) => {
        if (!r) return false
        if (wanted && !wanted.has(lc(r.uid))) return false
        if (isPendingOrder(r)) return true
        return r.status === ORDER_STATUS.FULFILLED && !r.txHash && at - r.updatedAt < TRADES_RETRY_WINDOW_MS
      })
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, POLL_MAX_PER_TICK)

    const results = []
    let stoppedBy
    for (const rec of candidates) {
      let out
      try {
        if (rec.status === ORDER_STATUS.SUBMITTING) out = await handleSubmitting(rec, at, withProgress)
        else if (rec.status === ORDER_STATUS.OPEN) out = await handleOpen(rec, at, withProgress)
        else out = await handleFulfilled(rec, at)
      } catch {
        // Bir kaydin hatasi digerini bozmaz
        out = { status: rec.status }
      }
      const item = { uid: rec.uid, status: out.status }
      if (out.apiStatus) item.apiStatus = out.apiStatus
      results.push(item)
      if (out.stop) {
        stoppedBy = out.stop
        break
      }
    }
    const out = { polled: results.length, results }
    if (stoppedBy) out.stoppedBy = stoppedBy
    return out
  }

  return {
    // Tek ucus (K10): suren cagriya gelen ikinci cagri AYNI sozu paylasir. ASLA firlatmaz.
    pollCowOrders(opts) {
      if (inflight) return inflight
      inflight = tick(opts)
        .catch(() => ({ polled: 0, results: [] }))
        .finally(() => {
          inflight = null
        })
      return inflight
    },
  }
}

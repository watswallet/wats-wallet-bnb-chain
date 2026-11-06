// CoW emir kaydi: kalici cow_orders deposu (write-ahead), saf durum makinesi ve depo islemleri.
// Kayittaki TUM tutarlar ondalik DIZEDIR (chrome.storage BigInt serilestiremez).
// Depo islemlerinde (withStorageList icinde) ag cagrisi YOKTUR; ag isi poller.js'tedir.
import { withStorageList, COW_ORDERS } from '../txStorage'
import { TERMINAL_RETENTION_MS, FEE_STUCK_MARK_MS } from './config'
import { newFeeState, newRefundState, unresolvedFee, FEE_MODE, FEE_STATE, FEE_BLOCKER } from './fee'

export const ORDER_STATUS = Object.freeze({
  SUBMITTING: 'submitting',
  OPEN: 'open',
  FULFILLED: 'fulfilled',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
})

// submitting kaydi icin GET'e gecmeden bekleme
export const SUBMIT_GRACE_MS = 60_000

const UID_RE = /^0x[0-9a-f]{112}$/
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/
const DIGITS_RE = /^\d+$/
const TERMINAL = new Set([ORDER_STATUS.FULFILLED, ORDER_STATUS.EXPIRED, ORDER_STATUS.CANCELLED])

const isDigits = (v) => typeof v === 'string' && DIGITS_RE.test(v)
const lc = (v) => String(v ?? '').toLowerCase()

export const isPendingOrder = (rec) =>
  !!rec && (rec.status === ORDER_STATUS.SUBMITTING || rec.status === ORDER_STATUS.OPEN)

const isTerminal = (rec) => !!rec && TERMINAL.has(rec.status)

const UNRESOLVED_REFUND = new Set(['claimable', 'claiming', 'approved'])

/** Iade hakki henuz sonuclanmadi mi? (claimable|claiming|approved) */
export const hasUnresolvedRefund = (rec) => !!rec && UNRESOLVED_REFUND.has(rec.refund?.state)

function requireDigits(name, value) {
  if (!isDigits(value)) throw new Error(`orders: ${name} rakam dizesi olmali`)
  return value
}

/**
 * Spec 5.6 kayit sekli + { repostCount: 0, lastPostAt: createdAt, lastError: null }.
 * Tutar alanlari rakam dizesi degilse throw (BigInt/Number reddedilir). status = 'submitting'.
 */
export function newOrderRecord(fields) {
  const f = fields || {}
  const uid = lc(f.uid)
  if (!UID_RE.test(uid)) throw new Error('orders: uid 0x + 112 onaltilik hane olmali')
  if (!f.postBody) throw new Error('orders: postBody zorunlu')

  requireDigits('sellAmount', f.sellAmount)
  requireDigits('buyAmount', f.buyAmount)
  if (f.expectedBuy != null) requireDigits('expectedBuy', f.expectedBuy)
  if (f.fees != null) {
    for (const k of Object.keys(f.fees)) requireDigits(`fees.${k}`, f.fees[k])
  }

  // fee.quotedAtsRaw varsa rakam dizesi olmali (BigInt chrome.storage'a yazilamaz)
  if (f.fee?.quotedAtsRaw != null) requireDigits('fee.quotedAtsRaw', f.fee.quotedAtsRaw)

  const createdAt = f.createdAt
  return {
    ...f,
    uid,
    status: ORDER_STATUS.SUBMITTING,
    apiStatus: null,
    executedSellAmount: null,
    executedBuyAmount: null,
    txHash: null,
    repostCount: 0,
    lastPostAt: createdAt,
    lastError: null,
    updatedAt: createdAt,
    // sema eklemeli: ucret/iade alanlari yayilimdan SONRA kurulur (Faz 2 cagrisi mode:'none' alir)
    fee: f.fee ?? newFeeState({ mode: FEE_MODE.NONE, quotedAtsRaw: null }),
    refund: f.refund ?? newRefundState(),
  }
}

/**
 * Saf. apiOrder = GET /orders/{uid} govdesi. Yama nesnesi doner ({} = degisiklik yok).
 */
export function reconcileOrder(record, apiOrder, now) {
  // Terminal durumdan geri donus yok
  if (!record || isTerminal(record)) return {}
  if (!apiOrder || typeof apiOrder !== 'object') return {}

  if (apiOrder.uid != null && lc(apiOrder.uid) !== lc(record.uid)) {
    return { lastError: 'UID_MISMATCH', updatedAt: now }
  }

  const st = apiOrder.status
  if (st === 'open' || st === 'presignaturePending') {
    return { status: ORDER_STATUS.OPEN, apiStatus: st, postBody: null }
  }
  if (st === 'fulfilled') {
    return {
      status: ORDER_STATUS.FULFILLED,
      apiStatus: 'traded',
      executedSellAmount: isDigits(apiOrder.executedSellAmount) ? apiOrder.executedSellAmount : record.executedSellAmount,
      executedBuyAmount: isDigits(apiOrder.executedBuyAmount) ? apiOrder.executedBuyAmount : record.executedBuyAmount,
      postBody: null,
    }
  }
  if (st === 'expired') return { status: ORDER_STATUS.EXPIRED, postBody: null }
  if (st === 'cancelled') return { status: ORDER_STATUS.CANCELLED, postBody: null }
  // Taninmayan durum: kayit oldugu gibi kalir, open varsayilmaz
  return {}
}

/** GET /api/v2/trades?orderUid= yaniti: uid eslesen ilk kaydin txHash'i gecerliyse alinir. */
export function applyTrades(record, trades, now) {
  if (!record || !Array.isArray(trades)) return {}
  const hit = trades.find((t) => t && lc(t.orderUid) === lc(record.uid))
  if (!hit || typeof hit.txHash !== 'string' || !TX_HASH_RE.test(hit.txHash)) return {}
  return { txHash: hit.txHash, updatedAt: now }
}

export function planSubmitting(record, now) {
  const base = record.lastPostAt ?? record.createdAt
  return now - base >= SUBMIT_GRACE_MS ? 'CHECK' : 'WAIT'
}

// GET 404: validTo gectiyse kayit duser; yeniden POST en fazla bir kez
export function resolveNotFound(record, now) {
  if (record.validTo * 1000 <= now) return 'DROP'
  if (record.repostCount < 1) return 'REPOST'
  return 'WAIT'
}

/** submitting|open kayitlarinin ayni owner+chain+sellToken icin sellAmount toplami (bakiye rezervi). */
export function reservedAmount(list, { owner, chainId, token }) {
  const o = lc(owner)
  const t = lc(token)
  const c = Number(chainId)
  let total = 0n
  for (const r of list || []) {
    if (!isPendingOrder(r)) continue
    if (lc(r.owner) !== o || Number(r.chainId) !== c || lc(r.sellToken) !== t) continue
    total += BigInt(r.sellAmount)
  }
  return total
}

/**
 * Saf; liste dondurur. Terminal kayit 7 gunden eskiyse atilir, ANCAK:
 * - cozulmemis ucret (owed|sending|blocked) ASLA atilmaz; 30 gunu asarsa blocked/FEE_STUCK isaretlenir (op korunur);
 * - cozulmemis iade hakki 30 gun saklanir, dolunca atilir;
 * - submitting|open hicbir zaman atilmaz.
 */
export function pruneOrders(list, now) {
  const out = []
  for (const r of list || []) {
    if (!isTerminal(r)) {
      out.push(r)
      continue
    }
    const at = r.updatedAt ?? r.createdAt
    if (!Number.isFinite(at)) {
      out.push(r)
      continue
    }
    const age = now - at
    if (unresolvedFee(r)) {
      const stuck = r.fee.state === FEE_STATE.BLOCKED && r.fee.blocker === FEE_BLOCKER.FEE_STUCK
      if (age > FEE_STUCK_MARK_MS && !stuck) {
        out.push({ ...r, fee: { ...r.fee, state: FEE_STATE.BLOCKED, blocker: FEE_BLOCKER.FEE_STUCK } })
      } else {
        out.push(r)
      }
      continue
    }
    if (hasUnresolvedRefund(r)) {
      if (age <= FEE_STUCK_MARK_MS) out.push(r)
      continue
    }
    if (age <= TERMINAL_RETENTION_MS) out.push(r)
  }
  return out
}

export async function loadOrders() {
  // mutate undefined doner: yazma yok, taze liste geri gelir
  return withStorageList(COW_ORDERS, () => undefined)
}

export async function saveOrder(record, now = Date.now()) {
  await withStorageList(COW_ORDERS, (list) => {
    const i = list.findIndex((r) => r && r.uid === record.uid)
    const next = i === -1 ? [...list, record] : list.map((r, k) => (k === i ? record : r))
    return pruneOrders(next, now)
  })
}

/** fn(current) -> yama (ya da dogrudan yama nesnesi). Kayit yoksa null; bos yamada yazma yok. */
export async function patchOrder(uid, patchOrFn, now = Date.now()) {
  let updated = null
  await withStorageList(COW_ORDERS, (list) => {
    const i = list.findIndex((r) => r && r.uid === uid)
    if (i === -1) return undefined
    const current = list[i]
    const patch = typeof patchOrFn === 'function' ? patchOrFn(current) : patchOrFn
    if (!patch || Object.keys(patch).length === 0) {
      updated = current
      return undefined
    }
    // uid kimliktir, yamayla degismez
    const next = { ...current, ...patch, uid: current.uid, updatedAt: now }
    updated = next
    return list.map((r, k) => (k === i ? next : r))
  })
  return updated
}

export async function removeOrder(uid) {
  await withStorageList(COW_ORDERS, (list) => list.filter((r) => !r || r.uid !== uid))
}

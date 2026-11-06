// cow/refundClaim.js: odenmis ucretin iadesini sunucudan talep eder (spec 6.8, Review Focus 3).
// Anahtar GEREKTIRMEZ (kilitliyken de calisir) ve ozellik bayragindan BAGIMSIZDIR: kullanici odedi, hak yasar.
// Govde TAM {uid, chainId, feeTxHash}; tutar/adres/imza/kimlik GONDERILMEZ. YALNIZ sunucunun acik
// `status: 'rejected'` cevabi kesin sonuctur; baska her sey (400 dahil) gecicidir ve hakki korur.
// CLAIM_START POST'tan ONCE kalici yazilir (await) ve karar depo icinde atomik verilir: iki tik arasi cift POST yok.
import { REFUND_CLAIM_PATH } from './config'
import { claimDue, reconcileRefund } from './fee'

const OUTCOME = Object.freeze({
  APPROVED: 'APPROVED',
  SENT: 'SENT',
  REJECTED: 'REJECTED',
  TRANSIENT: 'TRANSIENT',
  SKIPPED: 'SKIPPED',
})

const ACTIVE = new Set(['claimable', 'claiming', 'approved'])
const HASH_RE = /^0x[0-9a-fA-F]{64}$/
const DIGITS_RE = /^\d+$/
const MAX_PER_TICK = 3

const skipped = () => ({ outcome: OUTCOME.SKIPPED })

/** Talep edilebilir mi? (istek oncesi saf kapi; depo icinde ayni kapi tekrar uygulanir) */
function eligible(rec, now) {
  const refund = rec?.refund
  if (!refund || !ACTIVE.has(refund.state)) return false
  if (!claimDue(refund, now)) return false
  const hash = rec.fee?.paidTxHash
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) return false
  if (typeof rec.uid !== 'string' || rec.uid === '') return false
  return Number.isInteger(Number(rec.chainId)) && Number(rec.chainId) > 0
}

/** Yanit govdesinden yalniz status/code/atsRaw/txHash okunur -> iade olayi + sonuc. */
function mapResponse(httpStatus, body) {
  const transient = { event: { type: 'CLAIM_TRANSIENT' }, outcome: OUTCOME.TRANSIENT }
  if (httpStatus !== 200 || !body || typeof body !== 'object') return transient
  const status = body.status
  if (status === 'approved' || status === 'sending') {
    return { event: { type: 'CLAIM_RESULT', status: 'approved' }, outcome: OUTCOME.APPROVED }
  }
  if (status === 'sent') {
    const { atsRaw, txHash } = body
    if (typeof atsRaw !== 'string' || !DIGITS_RE.test(atsRaw)) return transient
    if (typeof txHash !== 'string' || txHash.length !== 66 || !HASH_RE.test(txHash)) return transient
    return { event: { type: 'CLAIM_RESULT', status: 'sent', atsRaw, txHash }, outcome: OUTCOME.SENT }
  }
  if (status === 'rejected') {
    return {
      event: { type: 'CLAIM_RESULT', status: 'rejected', code: typeof body.code === 'string' ? body.code : '' },
      outcome: OUTCOME.REJECTED,
    }
  }
  return transient
}

export function createRefundClaimer({
  orders,
  fetchImpl,
  baseUrl,
  now = Date.now,
  timeoutMs = 10_000,
  log = () => {},
} = {}) {
  const safeLog = (...a) => {
    try {
      log(...a)
    } catch {
      // gunluk hatasi akisi bozmaz
    }
  }

  /** POST; ag hatasi, zaman asimi, bozuk govde -> { status: 0 } (gecici). Ham hata/mesaj tasinmaz. */
  async function post(body) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetchImpl(`${baseUrl}${REFUND_CLAIM_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      let json = null
      try {
        json = await res.json()
      } catch {
        json = null
      }
      return { status: Number(res?.status) || 0, json }
    } catch {
      return { status: 0, json: null }
    } finally {
      clearTimeout(timer)
    }
  }

  async function claimRefund(rec) {
    if (typeof baseUrl !== 'string' || baseUrl === '' || typeof fetchImpl !== 'function') return skipped()
    if (!eligible(rec, now())) return skipped()

    // CLAIM_START: karar ve yazim depo icinde atomik; yalniz gecis gercekten olduysa POST'a gecilir.
    let body = null
    const t = now()
    const startFn = (cur) => {
      if (!eligible(cur, t)) return {}
      const patch = reconcileRefund(cur, { type: 'CLAIM_START' }, t)
      if (!patch.refund) return {}
      body = { uid: cur.uid, chainId: Number(cur.chainId), feeTxHash: cur.fee.paidTxHash }
      return patch
    }
    startFn.eventType = 'CLAIM_START' // yalniz gozlem icin
    await orders.patchOrder(rec.uid, startFn, t)
    if (!body) return skipped()

    const res = await post(body)
    const mapped = mapResponse(res.status, res.json)
    const resultFn = (cur) => reconcileRefund(cur, mapped.event, now())
    resultFn.eventType = mapped.event.type
    await orders.patchOrder(rec.uid, resultFn, now())
    safeLog('refund-claim', mapped.outcome)
    return { outcome: mapped.outcome }
  }

  async function claimRefunds() {
    if (typeof baseUrl !== 'string' || baseUrl === '' || typeof fetchImpl !== 'function') return { tried: 0 }
    const t = now()
    let list = []
    try {
      list = await orders.loadOrders()
    } catch {
      return { tried: 0 }
    }
    const due = (Array.isArray(list) ? list : [])
      .filter((r) => r?.refund && ACTIVE.has(r.refund.state) && eligible(r, t))
      .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
      .slice(0, MAX_PER_TICK)
    let tried = 0
    for (const rec of due) {
      tried += 1
      try {
        await claimRefund(rec)
      } catch {
        safeLog('refund-claim', 'ERROR') // bir kayit digerlerini durdurmaz
      }
    }
    return { tried }
  }

  return { claimRefund, claimRefunds }
}

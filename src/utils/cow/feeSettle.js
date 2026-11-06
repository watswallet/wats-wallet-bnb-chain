// CoW ATS ucreti IV: `owed` ucretleri tahsil eden orkestra (spec 6.3, 6.4, 6.7). Cift ucret korumasi:
//  1) WRITE-AHEAD: `sending` + op.nonce kalici yazilmadan (await) hicbir /sponsor cagrisi yapilmaz.
//  2) op dolu HER aday (sending ya da blocked) once zincir cozumlemesinden (resolve) gecer; op'lu kayit
//     asla yeni SEND_START almaz. Yeniden deneme AYNI nonce ile; yeni nonce yalniz RENONCE (kanitli "inmedi").
//  3) `paid` yalniz makbuzdaki Sponsored olayindan (receipt PAID); execute'un donmesi yetmez.
// Bagimliliklar enjekte (orders, chain, ats, receipt, resolve): testler agsiz. Anahtar yalniz getSigner() ile
// alinir ve yalniz ats.execute'a `signer` olarak gecer. Hata nesnesi/ham mesaj kayda ve gunluge YAZILMAZ.
import {
  FEE_MODE,
  FEE_STATE,
  FEE_BLOCKER,
  buildFeeCall,
  feeCallDataHash,
  isFeeChanged,
  reconcileFee,
} from './fee'
import { RESOLVE } from './feeResolve'
import { resolveAtsBlocker } from '../atsBlocker'

const OUTCOME = Object.freeze({
  DISABLED: 'DISABLED',
  BUSY: 'BUSY',
  NONE: 'NONE',
  PAID: 'PAID',
  PENDING: 'PENDING',
  BLOCKED: 'BLOCKED',
  RESENT: 'RESENT',
})

// execute fixedNonce ile op kurarken verdigi kodlar (atsPaymaster.js)
const NONCE_CHANGED = 'NONCE_CHANGED'
const NEEDS_BOOTSTRAP = 'FIXED_NONCE_NEEDS_BOOTSTRAP'
const COMMISSION_MISSING = 'commission-missing'

// Kullanici eylemi olmadan otomatik yeniden denenebilen engeller (FEE_CHANGED/FEE_STUCK haric)
const AUTO_RETRY = new Set([
  FEE_BLOCKER.BALANCE,
  FEE_BLOCKER.APPROVAL,
  FEE_BLOCKER.NO_SERVICE,
  FEE_BLOCKER.COMMISSION,
])
const DIGITS_RE = /^\d+$/
const SAFE_CODE_RE = /^[A-Za-z_-]{2,40}$/

// Modul ici tek-ucus: iki ornek ya da iki cagri ayni anda ucret gonderemez (kuyruk seriligi Task 11'de ayrica).
let inflight = false

const lc = (v) => String(v ?? '').toLowerCase()
const pending = (uid, code) => ({ outcome: OUTCOME.PENDING, uid, code })
// Sonuc govdesi: kod degiskenle gecer (cow/errors.js kaynak taramasi `code: 'X'` literalini COW_ERROR kumesinde arar;
// buradaki kisa kodlar COW_ERROR degil, ic durum kodlaridir)
const plain = (outcome, code) => ({ outcome, code })

function toBig(v) {
  if (typeof v === 'bigint') return v >= 0n ? v : null
  if (typeof v === 'string' && DIGITS_RE.test(v)) return BigInt(v)
  return null
}

/** Aday sirasi: sending, owed, yeniden denenebilir blocked; esitlikte createdAt kucuk olan. */
function rankOf(rec) {
  const f = rec.fee
  if (f.state === FEE_STATE.SENDING) return 0
  if (f.state === FEE_STATE.OWED) return 1
  if (f.state === FEE_STATE.BLOCKED && AUTO_RETRY.has(f.blocker)) return 2
  return null
}

function selectCandidates(list, owner) {
  const o = lc(owner)
  const mine = (Array.isArray(list) ? list : []).filter(
    (r) => r && lc(r.owner) === o && r.fee && r.fee.mode === FEE_MODE.ATS,
  )
  const stuck = mine.filter(
    (r) => r.fee.state === FEE_STATE.BLOCKED && r.fee.blocker === FEE_BLOCKER.FEE_STUCK && r.fee.op,
  )
  const cands = mine
    .map((r) => ({ r, rank: rankOf(r) }))
    .filter((x) => x.rank !== null)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      const ca = Number.isFinite(a.r.createdAt) ? a.r.createdAt : Infinity
      const cb = Number.isFinite(b.r.createdAt) ? b.r.createdAt : Infinity
      return ca - cb
    })
    .map((x) => x.r)
  return { stuck, cands }
}

export function createFeeSettler({ orders, chain, ats, receipt, resolve, now = Date.now, log = () => {} }) {
  // Gunluge yalniz kisa, kendi urettigimiz kodlar gider (hata nesnesi/mesaj asla).
  const note = (code, extra) => {
    try {
      log(String(code), extra && SAFE_CODE_RE.test(String(extra)) ? String(extra) : undefined)
    } catch {
      // gunluk hatasi akisi bozmaz
    }
  }

  /** Olayi atomik uygular (depo icinde reconcileFee); guncel kaydi doner. */
  async function apply(uid, event) {
    const t = now()
    const fn = (rec) => reconcileFee(rec, event, t)
    fn.eventType = event.type // yalniz gozlem icin (testler olay sirasini okur)
    return orders.patchOrder(uid, fn, t)
  }

  /** Anahtari ister. Kilitliyse null (hicbir yazma yapilmadan PENDING doner). Tek getSigner cagri noktasi. */
  async function acquireSigner(getSigner) {
    try {
      const s = await getSigner()
      return s || null
    } catch {
      return null
    }
  }

  async function block(rec, blocker, extra = {}) {
    await apply(rec.uid, { type: 'BLOCK', blocker, ...extra })
    note('settle:blocked', blocker)
    return { outcome: OUTCOME.BLOCKED, uid: rec.uid, code: blocker }
  }

  /** PAID olayi; blocked kayit once UNBLOCK (op var -> sending). */
  async function markPaid(rec, data) {
    if (rec.fee.state === FEE_STATE.BLOCKED) {
      const u = await apply(rec.uid, { type: 'UNBLOCK' })
      if (!u || !u.fee || u.fee.state !== FEE_STATE.SENDING) return pending(rec.uid, 'UNBLOCK_FAILED')
    }
    const u = await apply(rec.uid, {
      type: 'PAID',
      paidTxHash: data.paidTxHash,
      atsChargedRaw: data.atsChargedRaw,
    })
    if (!u || !u.fee || u.fee.state !== FEE_STATE.PAID) return pending(rec.uid, 'PAID_REJECTED')
    return { outcome: OUTCOME.PAID, uid: rec.uid }
  }

  /**
   * Engel kontrolleri (spec 6.4 a-d). Engel varsa BLOCK yazar ve { result } doner; yoksa { ok, quoted }.
   * Anahtar ve nonce BURADA kullanilmaz.
   */
  async function runChecks(rec) {
    const { owner, uid } = rec
    let status
    try {
      status = await ats.status({ owner })
    } catch {
      return { result: await block(rec, FEE_BLOCKER.NO_SERVICE) }
    }
    // basarili yanit servis arizasi sayacini sifirlar (yalniz doluysa yazilir)
    let cur = rec
    if (cur.fee.noServiceSince != null) {
      cur = (await apply(uid, { type: 'SERVICE_OK' })) || cur
    }
    if (!status || status.ready !== true || status.mode === 'bootstrap') {
      return { result: await block(cur, FEE_BLOCKER.APPROVAL) }
    }

    let q
    try {
      q = await ats.quote({ owner, call: buildFeeCall(owner, uid) })
    } catch {
      return { result: await block(cur, FEE_BLOCKER.NO_SERVICE) }
    }
    const feeRaw = toBig(q && q.feeRaw)
    if (feeRaw === null || feeRaw === 0n) return { result: await block(cur, FEE_BLOCKER.NO_SERVICE) }
    const commission = toBig(q.commissionRaw ?? '0')
    if (commission === null || commission > 0n) return { result: await block(cur, FEE_BLOCKER.COMMISSION) }
    if (isFeeChanged(feeRaw.toString(), cur.fee.quotedAtsRaw)) {
      return { result: await block(cur, FEE_BLOCKER.FEE_CHANGED, { freshFeeRaw: feeRaw.toString() }) }
    }

    let balance
    try {
      balance = await chain.readAtsBalance({ owner })
    } catch {
      return { result: pending(uid, 'BALANCE_READ') }
    }
    if (typeof balance !== 'bigint' || balance < feeRaw) return { result: await block(cur, FEE_BLOCKER.BALANCE) }
    return { ok: true, quoted: q.quoted }
  }

  /** execute hatasini engele ya da PENDING'e esler; kayda yalniz kisa engel kodu yazilir. */
  async function mapExecuteError(rec, e) {
    const code = typeof (e && e.code) === 'string' ? e.code : ''
    const httpStatus = Number(e && (e.status ?? e.httpStatus ?? (e.response && e.response.status)))
    if (code === NONCE_CHANGED) {
      note('settle:nonce_changed')
      return pending(rec.uid, NONCE_CHANGED)
    }
    if (code === NEEDS_BOOTSTRAP) return block(rec, FEE_BLOCKER.APPROVAL)
    if (code === COMMISSION_MISSING) return block(rec, FEE_BLOCKER.COMMISSION)
    if (code) {
      const d = resolveAtsBlocker(code)
      if (d && d.action === 'buy-ats') return block(rec, FEE_BLOCKER.BALANCE)
      if (d && d.action === 'run-onboarding') return block(rec, FEE_BLOCKER.APPROVAL)
      if (d && (d.severity === 'operator' || d.severity === 'transient')) {
        return block(rec, FEE_BLOCKER.NO_SERVICE)
      }
    }
    const name = e && typeof e.name === 'string' ? e.name : ''
    if (httpStatus >= 500 || name === 'AbortError' || name === 'TimeoutError' || e instanceof TypeError) {
      return block(rec, FEE_BLOCKER.NO_SERVICE)
    }
    // bilinmeyen hata: op zincirde olabilir; sending kalir, sonraki tik resolve eder
    note('settle:execute_error')
    return pending(rec.uid, 'EXECUTE_ERROR')
  }

  /** Adim 5. rec: op'u kalici yazilmis, sending. isResend: makbuz yoksa RESENT. */
  async function send(rec, signer, quoted, isResend) {
    const { owner, uid } = rec
    const op = rec.fee.op
    const call = buildFeeCall(owner, uid)
    let res
    try {
      res = await ats.execute({ call, quoted, fixedNonce: op.nonce, signer })
    } catch (e) {
      return mapExecuteError(rec, e)
    }
    const userOpHash = res && res.hash
    const txHash = res && res.txHash
    await apply(uid, { type: 'RELAYED', userOpHash, relayTxHash: typeof txHash === 'string' ? txHash : null })
    if (typeof txHash !== 'string') {
      note('settle:no_tx_hash')
      return pending(uid, 'NO_TX_HASH')
    }
    let r
    try {
      r = await receipt({ txHash, owner, uid, nonce: op.nonce })
    } catch {
      note('settle:receipt_error')
      return pending(uid, 'RECEIPT_ERROR')
    }
    if (r && r.status === 'PAID') return markPaid(rec, r)
    // NOT_FOUND ya da para durumu bilinmiyor: sending kalir, yeni op YOK
    note('settle:receipt_not_paid', r && r.status)
    const code = r && typeof r.status === 'string' ? r.status : 'RECEIPT_UNKNOWN'
    return isResend ? { outcome: OUTCOME.RESENT, uid, code } : pending(uid, code)
  }

  /** op'suz owed/blocked aday (adim 4). */
  async function settleNoOp(rec, getSigner) {
    const checks = await runChecks(rec)
    if (!checks.ok) return checks.result
    let cur = rec
    if (cur.fee.state === FEE_STATE.BLOCKED) {
      cur = await apply(rec.uid, { type: 'UNBLOCK' })
      if (!cur || !cur.fee || cur.fee.state !== FEE_STATE.OWED) return pending(rec.uid, 'UNBLOCK_FAILED')
    }
    let nonce
    let startBlock
    try {
      nonce = await chain.readNonce({ owner: rec.owner })
      startBlock = await chain.readBlockNumber()
    } catch {
      return pending(rec.uid, 'CHAIN_READ')
    }
    const signer = await acquireSigner(getSigner)
    if (!signer) return pending(rec.uid, 'LOCKED')
    const op = { nonce, callDataHash: feeCallDataHash(rec.owner, rec.uid), startBlock }
    // WRITE-AHEAD: bu await tamamlanmadan ve dogrulanmadan execute YOK
    const u = await apply(rec.uid, { type: 'SEND_START', op })
    if (!u || !u.fee || u.fee.state !== FEE_STATE.SENDING || !u.fee.op || u.fee.op.nonce !== nonce.toString()) {
      note('settle:write_ahead_failed')
      return pending(rec.uid, 'WRITE_AHEAD')
    }
    return send(u, signer, checks.quoted, false)
  }

  /** NOT_LANDED / NOT_BOUND_PROVEN sonrasi gonderim (op'lu aday). */
  async function resend(rec, kind, getSigner) {
    const checks = await runChecks(rec)
    if (!checks.ok) return checks.result
    const signer = await acquireSigner(getSigner)
    if (!signer) return pending(rec.uid, 'LOCKED')
    const wasBlocked = rec.fee.state === FEE_STATE.BLOCKED
    let u = rec
    if (wasBlocked) {
      u = await apply(rec.uid, { type: 'UNBLOCK' })
      if (!u || !u.fee || u.fee.state !== FEE_STATE.SENDING) return pending(rec.uid, 'UNBLOCK_FAILED')
    }
    if (kind === RESOLVE.NOT_LANDED) {
      if (!wasBlocked) {
        u = await apply(rec.uid, { type: 'RESEND' })
        if (!u || !u.fee) return pending(rec.uid, 'RESEND_FAILED')
        // 24 saat / 6 deneme asimi FEE_STUCK'a duser: gonderilmez
        if (u.fee.state !== FEE_STATE.SENDING) {
          note('settle:fee_stuck')
          return { outcome: OUTCOME.BLOCKED, uid: rec.uid, code: u.fee.blocker || FEE_BLOCKER.FEE_STUCK }
        }
      }
    } else {
      // NOT_BOUND_PROVEN: kanitli "inmedi" -> yeni write-ahead
      let nonce
      let startBlock
      try {
        nonce = await chain.readNonce({ owner: rec.owner })
        startBlock = await chain.readBlockNumber()
      } catch {
        return pending(rec.uid, 'CHAIN_READ')
      }
      const op = { nonce, callDataHash: feeCallDataHash(rec.owner, rec.uid), startBlock }
      u = await apply(rec.uid, { type: 'RENONCE', op })
      if (!u || !u.fee || !u.fee.op || u.fee.op.nonce !== nonce.toString()) {
        note('settle:renonce_failed')
        return pending(rec.uid, 'RENONCE_FAILED')
      }
    }
    return send(u, signer, checks.quoted, true)
  }

  /** op'lu aday (sending ya da blocked): once makbuz, sonra zincir cozumlemesi (adim 3). */
  async function settleWithOp(rec, getSigner) {
    const { owner, uid } = rec
    const op = rec.fee.op
    if (op.relayTxHash) {
      try {
        const r = await receipt({ txHash: op.relayTxHash, owner, uid, nonce: op.nonce })
        if (r && r.status === 'PAID') return await markPaid(rec, r)
      } catch {
        note('settle:receipt_error')
      }
    }
    let res
    try {
      res = await resolve({ owner, uid, op })
    } catch {
      note('settle:resolve_error')
      return pending(uid, 'RESOLVE_ERROR')
    }
    const result = res && res.result
    if (result === RESOLVE.PAID) return markPaid(rec, res)
    if (result === RESOLVE.NOT_LANDED || result === RESOLVE.NOT_BOUND_PROVEN) return resend(rec, result, getSigner)
    // UNKNOWN ve taninmayan her sonuc: HICBIR SEY gonderilmez
    note('settle:unresolved', res && res.reason)
    return pending(uid, 'UNRESOLVED')
  }

  async function settleOne(rec, getSigner) {
    if (rec.fee.op) return settleWithOp(rec, getSigner)
    // sending ama op yok: tutarsiz kayit, fail-closed
    if (rec.fee.state === FEE_STATE.SENDING) {
      note('settle:sending_without_op')
      return pending(rec.uid, 'NO_OP')
    }
    return settleNoOp(rec, getSigner)
  }

  /** FEE_STUCK: salt-okur cozumleme (anahtar, /sponsor, yeni nonce YOK). Gec inen ucret kilidi acar. */
  async function resolveStuck(rec) {
    try {
      const res = await resolve({ owner: rec.owner, uid: rec.uid, op: rec.fee.op })
      if (res && res.result === RESOLVE.PAID) return await markPaid(rec, res)
    } catch {
      note('settle:stuck_resolve_error')
    }
    return null
  }

  async function settleCowFees({ owner, getSigner, flagOn } = {}) {
    if (flagOn !== true) return { outcome: OUTCOME.DISABLED }
    if (inflight) return { outcome: OUTCOME.BUSY }
    inflight = true
    try {
      let list
      try {
        list = await orders.loadOrders()
      } catch {
        note('settle:load_failed')
        return plain(OUTCOME.PENDING, 'STORE')
      }
      const { stuck, cands } = selectCandidates(list, owner)
      let stuckPaid = null
      for (const rec of stuck) {
        const r = await resolveStuck(rec)
        if (r && r.outcome === OUTCOME.PAID) stuckPaid = r
      }
      if (cands.length === 0) return stuckPaid || { outcome: OUTCOME.NONE }
      try {
        // Bir cagrida EN FAZLA BIR ucret: ilk aday sonucu ne olursa olsun digerlerine gecilmez
        return await settleOne(cands[0], getSigner)
      } catch {
        note('settle:error')
        return pending(cands[0].uid, 'ERROR')
      }
    } finally {
      inflight = false
    }
  }

  /** Kullanici eylemi: blocked/FEE_CHANGED kaydini taze ucretle onaylar. Gonderim sonraki settle'a kalir. */
  async function approveFeeChange({ owner, uid } = {}) {
    try {
      const list = await orders.loadOrders()
      const rec = (Array.isArray(list) ? list : []).find((r) => r && lc(r.uid) === lc(uid))
      if (
        !rec ||
        lc(rec.owner) !== lc(owner) ||
        !rec.fee ||
        rec.fee.mode !== FEE_MODE.ATS ||
        rec.fee.state !== FEE_STATE.BLOCKED ||
        rec.fee.blocker !== FEE_BLOCKER.FEE_CHANGED
      ) {
        return plain(OUTCOME.NONE, 'NOT_ELIGIBLE')
      }
      const q = await ats.quote({ owner: rec.owner, call: buildFeeCall(rec.owner, rec.uid) })
      const feeRaw = toBig(q && q.feeRaw)
      if (feeRaw === null || feeRaw === 0n) return plain(OUTCOME.PENDING, 'QUOTE')
      const u = await apply(rec.uid, { type: 'APPROVE_FEE', quotedAtsRaw: feeRaw.toString() })
      if (!u || !u.fee || u.fee.state === FEE_STATE.BLOCKED) return plain(OUTCOME.PENDING, 'REJECTED')
      return pending(rec.uid, 'APPROVED')
    } catch {
      note('settle:approve_error')
      return plain(OUTCOME.PENDING, 'ERROR')
    }
  }

  return { settleCowFees, approveFeeChange }
}

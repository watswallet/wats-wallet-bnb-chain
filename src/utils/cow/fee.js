// CoW ATS ucreti I: hazirlik karari, ucret cagrisi (execute(owner,0,uid)) ve borc kurali. SAF modul:
// ag yok, saat yok (now parametre), modul durumu yok. Ucret ve iade durum makineleri (reconcileFee,
// reconcileRefund) bu dosyanin sonundadir: settleCowFees, poller ve iade talebi AYNI kurali kullanir.
import { Interface, getAddress, keccak256 } from 'ethers'
import {
  ATS_FEE_CHAINS,
  FEE_READY_BALANCE_BPS,
  FEE_DRIFT_BPS,
  FEE_NO_SERVICE_MS,
  FEE_RETRY_MAX,
  FEE_RETRY_WINDOW_MS,
  REFUND_CLAIM_BACKOFF_MS,
  REFUND_CLAIM_WINDOW_MS,
  REFUND_POLL_MIN_MS,
  REFUND_APPROVED_WINDOW_MS,
  REFUND_CLAIMING_STALE_MS,
  LOCK_REASON,
} from './config'

export const FEE_MODE = Object.freeze({ ATS: 'ats', NONE: 'none' })
export const FEE_STATE = Object.freeze({
  IDLE: 'idle',
  OWED: 'owed',
  SENDING: 'sending',
  PAID: 'paid',
  VOID: 'void',
  BLOCKED: 'blocked',
})
export const FEE_BLOCKER = Object.freeze({
  BALANCE: 'BALANCE',
  APPROVAL: 'APPROVAL',
  FEE_CHANGED: 'FEE_CHANGED',
  FEE_STUCK: 'FEE_STUCK',
  COMMISSION: 'COMMISSION',
  NO_SERVICE: 'NO_SERVICE',
})
export const FEE_ERROR = Object.freeze({
  FEE_BAD_UID: 'FEE_BAD_UID',
  FEE_BAD_OWNER: 'FEE_BAD_OWNER',
  FEE_BAD_TARGET: 'FEE_BAD_TARGET',
})

// atsPaymaster'dan import YOK (dongu/bagimlilik); calldata ayni imza ile kurulur, capraz golden testle kilitli.
const EXECUTE_IFACE = new Interface(['function execute(address dest, uint256 value, bytes func)'])
const UID_RE = /^0x[0-9a-f]{112}$/
const DIGITS_RE = /^\d+$/
const UNRESOLVED_STATES = new Set([FEE_STATE.OWED, FEE_STATE.SENDING, FEE_STATE.BLOCKED])

function feeError(code) {
  const e = new Error(code)
  e.code = code
  return e
}

/** owner'i EIP-55'e cevirir; gecersizse null. */
function toChecksum(owner) {
  if (typeof owner !== 'string') return null
  try {
    return getAddress(owner)
  } catch {
    return null
  }
}

/**
 * Kesin kosullar: owner EIP-55, uid ^0x[0-9a-f]{112}$ (buyuk harf kucultulur), to === owner, value 0n.
 * Aksi halde Error{code}. Donen to HER ZAMAN owner'dir (cagiran atlayamaz).
 */
export function buildFeeCall(owner, uid) {
  const to = toChecksum(owner)
  if (!to) throw feeError(FEE_ERROR.FEE_BAD_OWNER)
  const u = typeof uid === 'string' ? uid.toLowerCase() : ''
  if (!UID_RE.test(u)) throw feeError(FEE_ERROR.FEE_BAD_UID)
  return { to, value: 0n, data: u }
}

/** execute(address dest,uint256 value,bytes func) kodlamasi: execute(owner, 0, uid). */
export function feeCallData(owner, uid) {
  const c = buildFeeCall(owner, uid)
  return EXECUTE_IFACE.encodeFunctionData('execute', [c.to, c.value, c.data])
}

export function feeCallDataHash(owner, uid) {
  return keccak256(feeCallData(owner, uid))
}

/** rakam dizesi ya da negatif olmayan BigInt -> BigInt; aksi halde null. */
function toRaw(v) {
  if (typeof v === 'bigint') return v >= 0n ? v : null
  if (typeof v === 'string' && DIGITS_RE.test(v)) return BigInt(v)
  return null
}

/**
 * Hazirlik karari (spec 6.1). Ilk uymayan durur; hata/beklenmeyen girdi ASLA firlatmaz -> 'none'.
 * @returns {{ mode: 'ats'|'none', reason: string|null }}
 */
export function evaluateFeeGate(input) {
  const none = (reason) => ({ mode: FEE_MODE.NONE, reason })
  try {
    const { flagOn, chainId, isEvm, status, balanceRaw, quotedFeeRaw } = input ?? {}
    if (flagOn !== true) return none('FLAG_OFF')
    if (!ATS_FEE_CHAINS.includes(Number(chainId))) return none('CHAIN')
    if (isEvm !== true) return none('NOT_EVM')
    if (status?.mode === 'bootstrap') return none('BOOTSTRAP')
    if (status?.ready !== true || status?.mode !== 'normal') return none('NOT_READY')
    const balance = toRaw(balanceRaw)
    if (balance === null) return none('BALANCE_UNKNOWN')
    const fee = toRaw(quotedFeeRaw)
    if (fee === null || fee <= 0n) return none('FEE_UNKNOWN')
    if (balance * 10000n < fee * FEE_READY_BALANCE_BPS) return none('BALANCE_LOW')
    return { mode: FEE_MODE.ATS, reason: null }
  } catch {
    return none('NOT_READY')
  }
}

/** Faz 2 kaydi (fee alani yok) false; ats modunda owed|sending|blocked true. */
export function unresolvedFee(rec) {
  return !!rec && rec.fee?.mode === FEE_MODE.ATS && UNRESOLVED_STATES.has(rec.fee.state)
}

const lc = (v) => String(v ?? '').toLowerCase()

/**
 * Borc (spec 6.5): yalniz owner'in kayitlari, zincirden bagimsiz. NO_SERVICE ardisik >= 10 dk ise
 * kilitlemez (serviceOnlyUids).
 * @returns {{ hasDebt: boolean, lockingUids: string[], serviceOnlyUids: string[] }}
 */
export function feeDebt(list, owner, now) {
  const lockingUids = []
  const serviceOnlyUids = []
  const o = lc(owner)
  for (const rec of Array.isArray(list) ? list : []) {
    if (!rec || lc(rec.owner) !== o || !unresolvedFee(rec)) continue
    const since = rec.fee.noServiceSince
    const serviceOnly =
      rec.fee.blocker === FEE_BLOCKER.NO_SERVICE &&
      typeof since === 'number' &&
      Number.isFinite(since) &&
      typeof now === 'number' &&
      now - since >= FEE_NO_SERVICE_MS
    ;(serviceOnly ? serviceOnlyUids : lockingUids).push(rec.uid)
  }
  return { hasDebt: lockingUids.length + serviceOnlyUids.length > 0, lockingUids, serviceOnlyUids }
}

/** null | { code: 'FEE_DEBT', uids }. Bayrak kapaliyken borc kilitlemez. */
export function feeDebtLock({ list, owner, flagOn, now } = {}) {
  if (flagOn !== true) return null
  const { lockingUids } = feeDebt(list, owner, now)
  return lockingUids.length ? { code: LOCK_REASON.FEE_DEBT, uids: lockingUids } : null
}

// ---------------------------------------------------------------- durum makineleri (spec 6.3, 6.8)

const HASH_RE = /^0x[0-9a-fA-F]{64}$/
const CODE_RE = /^[A-Z_]{3,32}$/
const BLOCKERS = new Set(Object.values(FEE_BLOCKER))

export function newFeeState({ mode, quotedAtsRaw } = {}) {
  return {
    mode,
    state: FEE_STATE.IDLE,
    blocker: null,
    quotedAtsRaw: quotedAtsRaw ?? null,
    freshFeeRaw: null,
    op: null,
    paidTxHash: null,
    atsChargedRaw: null,
    noServiceSince: null,
    updatedAt: null,
  }
}

export function newRefundState() {
  return {
    state: 'none',
    claimAttempts: 0,
    lastClaimAt: null,
    firstClaimableAt: null,
    atsRaw: null,
    txHash: null,
    code: null,
  }
}

/** Yalniz rakam dizesi -> BigInt; aksi halde null (kayit JSON dizesi tasir). */
function digitsOnly(v) {
  return typeof v === 'string' && DIGITS_RE.test(v) ? BigInt(v) : null
}

/** Write-ahead op alanlari: nonce (bigint | rakam | 0x hex) -> ondalik dize; hash 32 bayt; startBlock >= 0 tamsayi. */
function parseOp(op) {
  if (!op || typeof op !== 'object') return null
  let nonce
  const n = op.nonce
  if (typeof n === 'bigint') nonce = n
  else if (typeof n === 'string' && /^(\d+|0x[0-9a-fA-F]+)$/.test(n)) nonce = BigInt(n)
  else return null
  if (nonce < 0n) return null
  if (typeof op.callDataHash !== 'string' || !HASH_RE.test(op.callDataHash)) return null
  const sb = op.startBlock
  if (typeof sb !== 'number' || !Number.isSafeInteger(sb) || sb < 0) return null
  return {
    nonce: nonce.toString(),
    callDataHash: op.callDataHash,
    startBlock: sb,
  }
}

const patchFee = (fee, changes, now) => ({
  fee: { ...fee, ...changes, updatedAt: now },
})

/**
 * Ucret durum makinesi. record -> { fee?, refund? } YAMA (tam nesneler; {} = degisiklik yok).
 * Terminal paid/void'e olay islemez. `paid` yalniz sending'den ve makbuz verisiyle gelir.
 */
export function reconcileFee(record, event, now) {
  const fee = record?.fee
  if (!fee || fee.mode !== FEE_MODE.ATS || !event || typeof event !== 'object') return {}
  const st = fee.state
  if (st === FEE_STATE.PAID || st === FEE_STATE.VOID) return {}
  // op'lu kayit asla op'suz owed'a dusmez (cift ucret katmani)
  const resume = () => (fee.op ? FEE_STATE.SENDING : FEE_STATE.OWED)

  switch (event.type) {
    case 'ORDER_STATUS': {
      if (st !== FEE_STATE.IDLE) return {}
      if (event.status === 'fulfilled') return patchFee(fee, { state: FEE_STATE.OWED }, now)
      if (event.status === 'expired' || event.status === 'cancelled') {
        return patchFee(fee, { state: FEE_STATE.VOID }, now)
      }
      return {}
    }
    case 'SEND_START': {
      // cift ucret kemeri: op dolu kayitta ikinci write-ahead yalniz RENONCE ile olur
      if (st !== FEE_STATE.OWED || fee.op !== null) return {}
      const p = parseOp(event.op)
      if (!p) return {}
      const op = {
        ...p,
        attempts: 1,
        firstSentAt: now,
        userOpHash: null,
        relayTxHash: null,
      }
      return patchFee(fee, { state: FEE_STATE.SENDING, op }, now)
    }
    case 'RELAYED': {
      if (st !== FEE_STATE.SENDING || !fee.op) return {}
      if (typeof event.userOpHash !== 'string' || !HASH_RE.test(event.userOpHash)) return {}
      const rtx = event.relayTxHash ?? null
      if (rtx !== null && (typeof rtx !== 'string' || !HASH_RE.test(rtx))) return {}
      return patchFee(fee, { op: { ...fee.op, userOpHash: event.userOpHash, relayTxHash: rtx } }, now)
    }
    case 'RESEND': {
      if (st !== FEE_STATE.SENDING || !fee.op) return {}
      const attempts = (Number(fee.op.attempts) || 0) + 1
      const first = Number(fee.op.firstSentAt)
      if (attempts > FEE_RETRY_MAX || !Number.isFinite(first) || now - first > FEE_RETRY_WINDOW_MS) {
        // op KORUNUR
        return patchFee(
          fee,
          {
            state: FEE_STATE.BLOCKED,
            blocker: FEE_BLOCKER.FEE_STUCK,
            noServiceSince: null,
          },
          now,
        )
      }
      return patchFee(fee, { op: { ...fee.op, attempts } }, now)
    }
    case 'RENONCE': {
      if (st !== FEE_STATE.SENDING || !fee.op) return {}
      const p = parseOp(event.op)
      if (!p) return {}
      // attempts ve firstSentAt KORUNUR: yeni nonce deneme sinirini sifirlayamaz; eski op'un hash'leri tasinmaz
      return patchFee(fee, { op: { ...fee.op, ...p, userOpHash: null, relayTxHash: null } }, now)
    }
    case 'PAID': {
      if (st !== FEE_STATE.SENDING) return {}
      if (typeof event.paidTxHash !== 'string' || !HASH_RE.test(event.paidTxHash)) return {}
      const charged = digitsOnly(event.atsChargedRaw)
      if (charged === null || charged <= 0n) return {}
      const changes = {
        state: FEE_STATE.PAID,
        blocker: null,
        paidTxHash: event.paidTxHash,
        atsChargedRaw: charged.toString(),
      }
      return {
        ...patchFee(fee, changes, now),
        refund: {
          ...newRefundState(),
          state: 'claimable',
          firstClaimableAt: now,
        },
      }
    }
    case 'BLOCK': {
      if (st !== FEE_STATE.OWED && st !== FEE_STATE.SENDING && st !== FEE_STATE.BLOCKED) return {}
      if (!BLOCKERS.has(event.blocker)) return {}
      const since =
        event.blocker === FEE_BLOCKER.NO_SERVICE ? (Number.isFinite(fee.noServiceSince) ? fee.noServiceSince : now) : null
      const fresh =
        event.blocker === FEE_BLOCKER.FEE_CHANGED && digitsOnly(event.freshFeeRaw) !== null ? event.freshFeeRaw : null
      return patchFee(
        fee,
        {
          state: FEE_STATE.BLOCKED,
          blocker: event.blocker,
          noServiceSince: since,
          freshFeeRaw: fresh,
        },
        now,
      )
    }
    case 'UNBLOCK': {
      if (st !== FEE_STATE.BLOCKED) return {}
      return patchFee(fee, { state: resume(), blocker: null, freshFeeRaw: null }, now)
    }
    case 'APPROVE_FEE': {
      if (st !== FEE_STATE.BLOCKED || fee.blocker !== FEE_BLOCKER.FEE_CHANGED) return {}
      const q = digitsOnly(event.quotedAtsRaw)
      if (q === null || q <= 0n) return {}
      return patchFee(
        fee,
        {
          state: resume(),
          blocker: null,
          freshFeeRaw: null,
          quotedAtsRaw: q.toString(),
        },
        now,
      )
    }
    case 'SERVICE_OK': {
      if (fee.noServiceSince == null) return {}
      return patchFee(fee, { noServiceSince: null }, now)
    }
    default:
      return {}
  }
}

/** fresh > quoted x 12500/10000 (BigInt). Tam sinir false. Gecersiz/0 quoted ve gecersiz fresh -> true (yeniden onay). */
export function isFeeChanged(freshFeeRaw, quotedAtsRaw) {
  const fresh = toRaw(freshFeeRaw)
  const quoted = toRaw(quotedAtsRaw)
  if (fresh === null || quoted === null || quoted === 0n) return true
  return fresh * 10000n > quoted * FEE_DRIFT_BPS
}

const claimingStale = (refund, now) =>
  !Number.isFinite(refund.lastClaimAt) || now - refund.lastClaimAt >= REFUND_CLAIMING_STALE_MS

/** Iade durum makinesi; record -> { refund? } YAMA. sent/rejected terminaldir. */
export function reconcileRefund(record, event, now) {
  const refund = record?.refund
  if (!refund || !event || typeof event !== 'object') return {}
  const st = refund.state
  const put = (changes) => ({ refund: { ...refund, ...changes } })

  switch (event.type) {
    case 'CLAIM_START': {
      const attempts = (Number(refund.claimAttempts) || 0) + 1
      if (st === 'claimable' || (st === 'claiming' && claimingStale(refund, now))) {
        return put({
          state: 'claiming',
          claimAttempts: attempts,
          lastClaimAt: now,
        })
      }
      // approved yoklamasi: durum approved kalir, lastClaimAt yoklama araligini tutar
      if (st === 'approved') return put({ claimAttempts: attempts, lastClaimAt: now })
      return {}
    }
    case 'CLAIM_RESULT': {
      if (st !== 'claiming' && st !== 'approved') return {}
      if (event.status === 'approved' || event.status === 'sending') return put({ state: 'approved' })
      if (event.status === 'sent') {
        if (digitsOnly(event.atsRaw) === null) return {}
        if (typeof event.txHash !== 'string' || !HASH_RE.test(event.txHash)) return {}
        return put({
          state: 'sent',
          atsRaw: event.atsRaw,
          txHash: event.txHash,
        })
      }
      if (event.status === 'rejected') {
        const code = typeof event.code === 'string' && CODE_RE.test(event.code) ? event.code : 'UNKNOWN'
        return put({ state: 'rejected', code })
      }
      return {}
    }
    case 'CLAIM_TRANSIENT': {
      if (st === 'claiming') return put({ state: 'claimable' }) // hak ve sayac korunur
      return {}
    }
    default:
      return {}
  }
}

/** Otomatik geri cekilme zamani geldi mi? Pencere dolunca claimable SILINMEZ, yalniz otomatik deneme durur. */
export function claimDue(refund, now) {
  if (!refund || typeof now !== 'number') return false
  const first = Number.isFinite(refund.firstClaimableAt) ? refund.firstClaimableAt : null
  const last = Number.isFinite(refund.lastClaimAt) ? refund.lastClaimAt : null
  const attempts = Number(refund.claimAttempts) || 0
  switch (refund.state) {
    case 'claimable': {
      if (first !== null && now - first > REFUND_CLAIM_WINDOW_MS) return false
      if (attempts === 0 || last === null) return true
      return now - last >= REFUND_CLAIM_BACKOFF_MS[Math.min(attempts - 1, 2)]
    }
    case 'claiming':
      return claimingStale(refund, now)
    case 'approved': {
      if (first !== null && now - first > REFUND_APPROVED_WINDOW_MS) return false
      return last === null || now - last >= REFUND_POLL_MIN_MS
    }
    default:
      return false
  }
}

/**
 * Mesaj-guvenli gorunum (arka plan yaniti ve ekran): op/nonce/callDataHash/postBody YOK.
 * fee.mode !== 'ats' ve refund.state === 'none' (ya da iade yok) ise null.
 */
export function feeView(rec) {
  if (!rec || typeof rec !== 'object') return null
  const fee = rec.fee ?? null
  const refund = rec.refund ?? null
  const feeOn = fee?.mode === FEE_MODE.ATS
  const refundOn = !!refund && refund.state !== 'none'
  if (!feeOn && !refundOn) return null
  const code = refund?.code ?? null
  return {
    uid: rec.uid,
    chainId: rec.chainId,
    state: fee?.state ?? null,
    blocker: fee?.blocker ?? null,
    quotedAtsRaw: fee?.quotedAtsRaw ?? null,
    freshFeeRaw: fee?.freshFeeRaw ?? null,
    atsChargedRaw: fee?.atsChargedRaw ?? null,
    paidTxHash: fee?.paidTxHash ?? null,
    noServiceSince: fee?.noServiceSince ?? null,
    refund: {
      state: refund?.state ?? 'none',
      atsRaw: refund?.atsRaw ?? null,
      txHash: refund?.txHash ?? null,
      code: code === null ? null : typeof code === 'string' && CODE_RE.test(code) ? code : 'UNKNOWN',
    },
  }
}

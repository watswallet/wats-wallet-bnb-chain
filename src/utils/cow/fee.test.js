// cow/fee.js I: ucret cagrisi (execute(owner,0,uid)), hazirlik karari, borc kurali. Saf modul.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Interface, keccak256, getAddress } from 'ethers'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { buildTransferCallData } from '../atsPaymaster'
import {
  FEE_NO_SERVICE_MS,
  LOCK_REASON,
  FEE_RETRY_MAX,
  FEE_RETRY_WINDOW_MS,
  REFUND_CLAIM_WINDOW_MS,
  REFUND_APPROVED_WINDOW_MS,
  REFUND_CLAIMING_STALE_MS,
  REFUND_POLL_MIN_MS,
} from './config'
import {
  FEE_MODE,
  FEE_STATE,
  FEE_BLOCKER,
  FEE_ERROR,
  buildFeeCall,
  feeCallData,
  feeCallDataHash,
  evaluateFeeGate,
  unresolvedFee,
  feeDebt,
  feeDebtLock,
  newFeeState,
  newRefundState,
  reconcileFee,
  isFeeChanged,
  reconcileRefund,
  claimDue,
  feeView,
} from './fee'

const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' // hardhat #0 (EIP-55)
const OTHER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const UID = '0x' + 'ab'.repeat(56)
const NOW = 1_800_000_000_000

const EXEC_IFACE = new Interface(['function execute(address dest, uint256 value, bytes func)'])

function codeOf(fn) {
  try {
    fn()
  } catch (e) {
    return e.code
  }
  return null
}

describe('feeCallData / feeCallDataHash', () => {
  it('execute(owner,0,uid) secicisi 0xb61d27f6 ve cozulunce [owner, 0n, uid]', () => {
    const data = feeCallData(OWNER, UID)
    expect(data.startsWith('0xb61d27f6')).toBe(true)
    const [dest, value, func] = EXEC_IFACE.decodeFunctionData('execute', data)
    expect(dest).toBe(OWNER)
    expect(value).toBe(0n)
    expect(func).toBe(UID)
  })

  it('atsPaymaster.buildTransferCallData ile BIREBIR ayni (capraz kilit)', () => {
    expect(feeCallData(OWNER, UID)).toBe(buildTransferCallData({ to: OWNER, value: 0n, data: UID }))
  })

  it('feeCallDataHash = keccak256(feeCallData)', () => {
    expect(feeCallDataHash(OWNER, UID)).toBe(keccak256(feeCallData(OWNER, UID)))
  })

  it('value 1n ya da bos data farkli calldata uretir (mutasyon kilidi)', () => {
    const data = feeCallData(OWNER, UID)
    expect(data).not.toBe(buildTransferCallData({ to: OWNER, value: 1n, data: UID }))
    expect(data).not.toBe(buildTransferCallData({ to: OWNER, value: 0n, data: '0x' }))
  })
})

describe('buildFeeCall', () => {
  it('to = EIP-55 owner (kucuk harfli girdi), value 0n, data = uid', () => {
    const c = buildFeeCall(OWNER.toLowerCase(), UID)
    expect(c).toEqual({ to: OWNER, value: 0n, data: UID })
    expect(c.to).toBe(getAddress(OWNER))
  })

  it('buyuk harfli uid kabul edilir ve kucultulur', () => {
    const c = buildFeeCall(OWNER, '0x' + 'AB'.repeat(56))
    expect(c.data).toBe(UID)
    expect(c.data).toBe(c.data.toLowerCase())
  })

  it('gecersiz owner -> FEE_BAD_OWNER', () => {
    for (const bad of ['', '0x123', 'abc', null, undefined, 42, '0x' + 'g'.repeat(40)]) {
      expect(codeOf(() => buildFeeCall(bad, UID))).toBe(FEE_ERROR.FEE_BAD_OWNER)
    }
  })

  it('uid 111 / 113 hane, 0x oneksiz, bos, dize degil -> FEE_BAD_UID', () => {
    expect(codeOf(() => buildFeeCall(OWNER, '0x' + 'a'.repeat(111)))).toBe(FEE_ERROR.FEE_BAD_UID)
    expect(codeOf(() => buildFeeCall(OWNER, '0x' + 'a'.repeat(113)))).toBe(FEE_ERROR.FEE_BAD_UID)
    expect(codeOf(() => buildFeeCall(OWNER, 'ab'.repeat(56)))).toBe(FEE_ERROR.FEE_BAD_UID)
    expect(codeOf(() => buildFeeCall(OWNER, '0x' + 'zz'.repeat(56)))).toBe(FEE_ERROR.FEE_BAD_UID)
    expect(codeOf(() => buildFeeCall(OWNER, ''))).toBe(FEE_ERROR.FEE_BAD_UID)
    expect(codeOf(() => buildFeeCall(OWNER, null))).toBe(FEE_ERROR.FEE_BAD_UID)
  })

  it('owner hatasi uid hatasindan once raporlanir', () => {
    expect(codeOf(() => buildFeeCall('x', 'y'))).toBe(FEE_ERROR.FEE_BAD_OWNER)
  })

  it('feeCallData ayni kesin kosullari uygular', () => {
    expect(codeOf(() => feeCallData('x', UID))).toBe(FEE_ERROR.FEE_BAD_OWNER)
    expect(codeOf(() => feeCallData(OWNER, '0x12'))).toBe(FEE_ERROR.FEE_BAD_UID)
  })
})

describe('evaluateFeeGate', () => {
  const OK_STATUS = { ready: true, mode: 'normal' }
  const base = { flagOn: true, chainId: 56, isEvm: true, status: OK_STATUS, balanceRaw: '1200', quotedFeeRaw: '1000' }

  it.each([
    ['FLAG_OFF', { flagOn: false }],
    ['FLAG_OFF', { flagOn: 'true' }],
    ['CHAIN', { chainId: 137 }],
    ['NOT_EVM', { isEvm: false }],
    ['BOOTSTRAP', { status: { ready: true, mode: 'bootstrap' } }],
    ['NOT_READY', { status: { ready: false, mode: 'normal' } }],
    ['NOT_READY', { status: { ready: true, mode: 'other' } }],
    ['NOT_READY', { status: null }],
    ['BALANCE_UNKNOWN', { balanceRaw: null }],
    ['BALANCE_UNKNOWN', { balanceRaw: 'abc' }],
    ['BALANCE_UNKNOWN', { balanceRaw: -1n }],
    ['FEE_UNKNOWN', { quotedFeeRaw: null }],
    ['FEE_UNKNOWN', { quotedFeeRaw: '0' }],
    ['FEE_UNKNOWN', { quotedFeeRaw: '-5' }],
    ['BALANCE_LOW', { balanceRaw: '1199' }],
  ])('%s', (reason, patch) => {
    expect(evaluateFeeGate({ ...base, ...patch })).toEqual({ mode: FEE_MODE.NONE, reason })
  })

  it('tam gecis: ats, reason null', () => {
    expect(evaluateFeeGate(base)).toEqual({ mode: FEE_MODE.ATS, reason: null })
  })

  it('siniri: bakiye tam %120 -> ats, 1 atom eksik -> BALANCE_LOW', () => {
    const fee = '1000000000000000000'
    expect(evaluateFeeGate({ ...base, quotedFeeRaw: fee, balanceRaw: '1200000000000000000' }).mode).toBe('ats')
    expect(evaluateFeeGate({ ...base, quotedFeeRaw: fee, balanceRaw: '1199999999999999999' }).reason).toBe('BALANCE_LOW')
  })

  it('BigInt ve dize bakiye/ucret esdeger', () => {
    expect(evaluateFeeGate({ ...base, balanceRaw: 1200n, quotedFeeRaw: 1000n })).toEqual({ mode: 'ats', reason: null })
    expect(evaluateFeeGate({ ...base, balanceRaw: 1199n, quotedFeeRaw: '1000' }).reason).toBe('BALANCE_LOW')
  })

  it('uc zincirin hepsi gecer', () => {
    for (const chainId of [1, 56, 42161]) expect(evaluateFeeGate({ ...base, chainId }).mode).toBe('ats')
  })

  it('sira: bootstrap, ready false olsa bile NOT_READY degil BOOTSTRAP doner', () => {
    expect(evaluateFeeGate({ ...base, status: { ready: false, mode: 'bootstrap' } }).reason).toBe('BOOTSTRAP')
  })

  it('hata/beklenmeyen girdi asla firlatmaz -> none', () => {
    expect(evaluateFeeGate()).toEqual({ mode: 'none', reason: 'FLAG_OFF' })
    expect(evaluateFeeGate(null).mode).toBe('none')
    expect(() => evaluateFeeGate({ ...base, chainId: Symbol('x') })).not.toThrow()
    expect(evaluateFeeGate({ ...base, chainId: Symbol('x') }).mode).toBe('none')
    expect(evaluateFeeGate({ ...base, status: undefined }).mode).toBe('none')
  })
})

describe('unresolvedFee', () => {
  const rec = (mode, state) => ({ fee: { mode, state } })
  it('ats + owed|sending|blocked true', () => {
    for (const s of ['owed', 'sending', 'blocked']) expect(unresolvedFee(rec('ats', s))).toBe(true)
  })
  it('paid, void, idle ve none modu false', () => {
    for (const s of ['paid', 'void', 'idle']) expect(unresolvedFee(rec('ats', s))).toBe(false)
    for (const s of ['owed', 'sending', 'blocked']) expect(unresolvedFee(rec('none', s))).toBe(false)
  })
  it('fee alani olmayan (Faz 2) kayit ve bos girdi false', () => {
    expect(unresolvedFee({ uid: UID })).toBe(false)
    expect(unresolvedFee(null)).toBe(false)
    expect(unresolvedFee(undefined)).toBe(false)
  })
})

describe('feeDebt / feeDebtLock', () => {
  const mk = (uid, owner, fee, chainId = 56) => ({ uid, owner, chainId, fee })
  const owed = (uid, owner = OWNER, extra = {}) => mk(uid, owner, { mode: 'ats', state: 'owed', ...extra })

  it('farkli owner borcu gorulmez; owner karsilastirmasi harf boyuna duyarsiz', () => {
    const list = [owed('u1', OTHER), owed('u2', OWNER.toLowerCase())]
    expect(feeDebt(list, OWNER, NOW).lockingUids).toEqual(['u2'])
    expect(feeDebt(list, OTHER, NOW).lockingUids).toEqual(['u1'])
  })

  it('none modlu, paid ve void kayitlar borc degil', () => {
    const list = [
      mk('a', OWNER, { mode: 'none', state: 'idle' }),
      mk('b', OWNER, { mode: 'ats', state: 'paid' }),
      mk('c', OWNER, { mode: 'ats', state: 'void' }),
      { uid: 'd', owner: OWNER },
    ]
    expect(feeDebt(list, OWNER, NOW)).toEqual({ hasDebt: false, lockingUids: [], serviceOnlyUids: [] })
    expect(feeDebtLock({ list, owner: OWNER, flagOn: true, now: NOW })).toBeNull()
  })

  it('owed, sending, blocked kilitler', () => {
    const list = [
      owed('a'),
      mk('b', OWNER, { mode: 'ats', state: 'sending' }),
      mk('c', OWNER, { mode: 'ats', state: 'blocked', blocker: FEE_BLOCKER.BALANCE }),
    ]
    const d = feeDebt(list, OWNER, NOW)
    expect(d.hasDebt).toBe(true)
    expect(d.lockingUids).toEqual(['a', 'b', 'c'])
    expect(feeDebtLock({ list, owner: OWNER, flagOn: true, now: NOW })).toEqual({
      code: LOCK_REASON.FEE_DEBT,
      uids: ['a', 'b', 'c'],
    })
  })

  it('NO_SERVICE: 9 dk 59 sn kilit, 10 dk kilitlemez (serviceOnly)', () => {
    const rec = (age) =>
      mk('ns', OWNER, { mode: 'ats', state: 'blocked', blocker: FEE_BLOCKER.NO_SERVICE, noServiceSince: NOW - age })
    const just = feeDebt([rec(FEE_NO_SERVICE_MS - 1000)], OWNER, NOW)
    expect(just.lockingUids).toEqual(['ns'])
    expect(just.serviceOnlyUids).toEqual([])
    const full = feeDebt([rec(FEE_NO_SERVICE_MS)], OWNER, NOW)
    expect(full.lockingUids).toEqual([])
    expect(full.serviceOnlyUids).toEqual(['ns'])
    expect(feeDebtLock({ list: [rec(FEE_NO_SERVICE_MS)], owner: OWNER, flagOn: true, now: NOW })).toBeNull()
    expect(feeDebtLock({ list: [rec(FEE_NO_SERVICE_MS - 1000)], owner: OWNER, flagOn: true, now: NOW })).not.toBeNull()
  })

  it('NO_SERVICE ama noServiceSince yok ya da sayi degil -> kilitler; baska blocker icin noServiceSince etkisiz', () => {
    const a = mk('a', OWNER, { mode: 'ats', state: 'blocked', blocker: FEE_BLOCKER.NO_SERVICE })
    const b = mk('b', OWNER, { mode: 'ats', state: 'blocked', blocker: FEE_BLOCKER.NO_SERVICE, noServiceSince: '1' })
    const c = mk('c', OWNER, { mode: 'ats', state: 'blocked', blocker: FEE_BLOCKER.BALANCE, noServiceSince: 1 })
    expect(feeDebt([a, b, c], OWNER, NOW).lockingUids).toEqual(['a', 'b', 'c'])
  })

  it('bayrak kapali -> null (borc kilitlemez)', () => {
    expect(feeDebtLock({ list: [owed('a')], owner: OWNER, flagOn: false, now: NOW })).toBeNull()
    expect(feeDebtLock({ list: [owed('a')], owner: OWNER, flagOn: undefined, now: NOW })).toBeNull()
  })

  it('zincirden bagimsiz: BSC emrinin odenmemis ucreti Arbitrum emrini de kilitler (owner bazli)', () => {
    const list = [owed('bsc', OWNER)] // chainId 56
    const lock = feeDebtLock({ list, owner: OWNER, flagOn: true, now: NOW })
    expect(lock).toEqual({ code: 'FEE_DEBT', uids: ['bsc'] })
  })

  it('bos ya da gecersiz liste', () => {
    expect(feeDebt(undefined, OWNER, NOW)).toEqual({ hasDebt: false, lockingUids: [], serviceOnlyUids: [] })
    expect(feeDebt([null, undefined], OWNER, NOW).hasDebt).toBe(false)
  })
})

describe('sabitler', () => {
  it('FEE_MODE / FEE_STATE / FEE_BLOCKER / FEE_ERROR donmus ve tam', () => {
    expect(FEE_MODE).toEqual({ ATS: 'ats', NONE: 'none' })
    expect(Object.values(FEE_STATE).sort()).toEqual(['blocked', 'idle', 'owed', 'paid', 'sending', 'void'])
    expect(Object.keys(FEE_BLOCKER).sort()).toEqual([
      'APPROVAL',
      'BALANCE',
      'COMMISSION',
      'FEE_CHANGED',
      'FEE_STUCK',
      'NO_SERVICE',
    ])
    expect(Object.keys(FEE_ERROR).sort()).toEqual(['FEE_BAD_OWNER', 'FEE_BAD_TARGET', 'FEE_BAD_UID'])
    for (const o of [FEE_MODE, FEE_STATE, FEE_BLOCKER, FEE_ERROR]) expect(Object.isFrozen(o)).toBe(true)
  })
})

// ---------------------------------------------------------------- Task 3: durum makineleri

const H1 = '0x' + '11'.repeat(32)
const H2 = '0x' + '22'.repeat(32)
const H3 = '0x' + '33'.repeat(32)
const OP = { nonce: '7', callDataHash: H1, startBlock: 1000 }
const OP2 = { nonce: '8', callDataHash: H2, startBlock: 1200 }
const T0 = NOW - 5000

/** Bir kayit kurar (fee ve istege bagli refund uzerine yazilir). */
function rec(fee = {}, refund = null) {
  const r = {
    uid: UID,
    chainId: 56,
    owner: OWNER,
    fee: {
      ...newFeeState({ mode: 'ats', quotedAtsRaw: '25000000000000000000' }),
      ...fee,
    },
  }
  if (refund) r.refund = { ...newRefundState(), ...refund }
  return r
}
const opOf = (over = {}) => ({
  nonce: '7',
  callDataHash: H1,
  startBlock: 1000,
  attempts: 1,
  firstSentAt: T0,
  userOpHash: null,
  relayTxHash: null,
  ...over,
})
const owed = (over = {}) => rec({ state: 'owed', ...over })
const sending = (over = {}) => rec({ state: 'sending', op: opOf(), ...over })
const blocked = (blocker, over = {}) => rec({ state: 'blocked', blocker, op: opOf(), ...over })
const PAID_EV = {
  type: 'PAID',
  paidTxHash: H3,
  atsChargedRaw: '24000000000000000000',
}

describe('newFeeState / newRefundState', () => {
  it('varsayilan sekiller tam', () => {
    expect(newFeeState({ mode: 'ats', quotedAtsRaw: '5' })).toEqual({
      mode: 'ats',
      state: 'idle',
      blocker: null,
      quotedAtsRaw: '5',
      freshFeeRaw: null,
      op: null,
      paidTxHash: null,
      atsChargedRaw: null,
      noServiceSince: null,
      updatedAt: null,
    })
    expect(newFeeState({ mode: 'none' }).quotedAtsRaw).toBeNull()
    expect(newRefundState()).toEqual({
      state: 'none',
      claimAttempts: 0,
      lastClaimAt: null,
      firstClaimableAt: null,
      atsRaw: null,
      txHash: null,
      code: null,
    })
  })
})

describe('reconcileFee gecis tablosu', () => {
  const EV = {
    ORDER_STATUS: { type: 'ORDER_STATUS', status: 'fulfilled' },
    SEND_START: { type: 'SEND_START', op: OP },
    RELAYED: { type: 'RELAYED', userOpHash: H2, relayTxHash: H3 },
    RESEND: { type: 'RESEND' },
    RENONCE: { type: 'RENONCE', op: OP2 },
    PAID: PAID_EV,
    BLOCK: { type: 'BLOCK', blocker: 'BALANCE' },
    UNBLOCK: { type: 'UNBLOCK' },
    APPROVE_FEE: { type: 'APPROVE_FEE', quotedAtsRaw: '38' },
    SERVICE_OK: { type: 'SERVICE_OK' },
  }
  // durum -> [kayit kurucu, { olay: beklenen yeni fee.state }]; listede olmayan olay {} verir
  const TABLE = {
    idle: [() => rec(), { ORDER_STATUS: 'owed' }],
    owed: [() => owed(), { SEND_START: 'sending', BLOCK: 'blocked' }],
    sending: [
      () => sending(),
      {
        RELAYED: 'sending',
        RESEND: 'sending',
        RENONCE: 'sending',
        PAID: 'paid',
        BLOCK: 'blocked',
      },
    ],
    'blocked/BALANCE': [() => blocked('BALANCE'), { BLOCK: 'blocked', UNBLOCK: 'sending' }],
    'blocked/FEE_CHANGED': [
      () => blocked('FEE_CHANGED', { freshFeeRaw: '38' }),
      { BLOCK: 'blocked', UNBLOCK: 'sending', APPROVE_FEE: 'sending' },
    ],
    paid: [() => rec({ state: 'paid', paidTxHash: H3, atsChargedRaw: '1', op: opOf() }), {}],
    void: [() => rec({ state: 'void' }), {}],
  }
  for (const [name, [build, ok]] of Object.entries(TABLE)) {
    for (const [evName, ev] of Object.entries(EV)) {
      const expected = ok[evName] ?? null
      it(`${name} + ${evName} -> ${expected ?? '{}'}`, () => {
        const before = JSON.stringify(build())
        const r = build()
        const patch = reconcileFee(r, ev, NOW)
        expect(JSON.stringify(r)).toBe(before) // girdi degismez
        if (expected === null) expect(patch).toEqual({})
        else expect(patch.fee.state).toBe(expected)
      })
    }
  }

  it('terminal paid ve void hicbir olayi islemez (expired/cancelled dahil)', () => {
    const p = rec({ state: 'paid', paidTxHash: H3, atsChargedRaw: '1' })
    const v = rec({ state: 'void' })
    for (const ev of [
      { type: 'ORDER_STATUS', status: 'fulfilled' },
      { type: 'ORDER_STATUS', status: 'cancelled' },
      { type: 'BLOCK', blocker: 'BALANCE' },
      { type: 'UNBLOCK' },
      PAID_EV,
    ]) {
      expect(reconcileFee(p, ev, NOW)).toEqual({})
      expect(reconcileFee(v, ev, NOW)).toEqual({})
    }
  })

  it('mode none, bilinmeyen olay ve bos kayit -> {}', () => {
    expect(reconcileFee({ fee: newFeeState({ mode: 'none' }) }, EV.ORDER_STATUS, NOW)).toEqual({})
    expect(reconcileFee(rec(), { type: 'NOPE' }, NOW)).toEqual({})
    expect(reconcileFee(rec(), null, NOW)).toEqual({})
    expect(reconcileFee(null, EV.ORDER_STATUS, NOW)).toEqual({})
    expect(reconcileFee({ uid: UID }, EV.ORDER_STATUS, NOW)).toEqual({})
  })
})

describe('reconcileFee ORDER_STATUS', () => {
  it('fulfilled -> owed; expired|cancelled -> void; updatedAt=now', () => {
    expect(reconcileFee(rec(), { type: 'ORDER_STATUS', status: 'fulfilled' }, NOW).fee).toMatchObject({
      state: 'owed',
      updatedAt: NOW,
    })
    for (const s of ['expired', 'cancelled']) {
      expect(reconcileFee(rec(), { type: 'ORDER_STATUS', status: s }, NOW).fee.state).toBe('void')
    }
  })
  it('open, submitting ve bilinmeyen durumlar -> {}', () => {
    for (const s of ['open', 'submitting', 'presignaturePending', '', undefined, null, 5]) {
      expect(reconcileFee(rec(), { type: 'ORDER_STATUS', status: s }, NOW)).toEqual({})
    }
  })
  it('owed uzerinde ORDER_STATUS expired -> {} (void yalniz idle den)', () => {
    expect(reconcileFee(owed(), { type: 'ORDER_STATUS', status: 'expired' }, NOW)).toEqual({})
  })
})

describe('reconcileFee SEND_START (cift ucret kemeri)', () => {
  it('owed + op null -> sending; op tam sekil, nonce dize', () => {
    const p = reconcileFee(
      owed(),
      {
        type: 'SEND_START',
        op: { nonce: 7n, callDataHash: H1, startBlock: 1000 },
      },
      NOW,
    )
    expect(p.fee.state).toBe('sending')
    expect(p.fee.op).toEqual({
      nonce: '7',
      callDataHash: H1,
      startBlock: 1000,
      attempts: 1,
      firstSentAt: NOW,
      userOpHash: null,
      relayTxHash: null,
    })
  })
  it('op dolu kayitta SEND_START -> {} (op ve nonce degismez)', () => {
    const r = owed({ op: opOf({ nonce: '3' }) })
    expect(reconcileFee(r, { type: 'SEND_START', op: OP2 }, NOW)).toEqual({})
    expect(r.fee.op.nonce).toBe('3')
  })
  it('bozuk op -> {}', () => {
    const bad = [
      null,
      undefined,
      {},
      { nonce: 'x', callDataHash: H1, startBlock: 1 },
      { nonce: '1', callDataHash: '0x12', startBlock: 1 },
      { nonce: '1', callDataHash: H1, startBlock: -1 },
      { nonce: '-1', callDataHash: H1, startBlock: 1 },
    ]
    for (const op of bad) expect(reconcileFee(owed(), { type: 'SEND_START', op }, NOW)).toEqual({})
  })
})

describe('reconcileFee RELAYED / RESEND / RENONCE', () => {
  it('RELAYED iki alani yazar, op in kalani korunur', () => {
    const p = reconcileFee(sending(), { type: 'RELAYED', userOpHash: H2, relayTxHash: H3 }, NOW)
    expect(p.fee.op).toMatchObject({
      userOpHash: H2,
      relayTxHash: H3,
      nonce: '7',
      attempts: 1,
      firstSentAt: T0,
    })
  })
  it('RELAYED bozuk userOpHash -> {}', () => {
    expect(reconcileFee(sending(), { type: 'RELAYED', userOpHash: 'x', relayTxHash: H3 }, NOW)).toEqual({})
  })
  it('RESEND attempts+1, firstSentAt korunur; op yoksa {}', () => {
    const p = reconcileFee(sending(), { type: 'RESEND' }, NOW)
    expect(p.fee.state).toBe('sending')
    expect(p.fee.op.attempts).toBe(2)
    expect(p.fee.op.firstSentAt).toBe(T0)
    expect(reconcileFee(rec({ state: 'sending', op: null }), { type: 'RESEND' }, NOW)).toEqual({})
  })
  it('Review Focus 1: 6. yeniden gonderim FEE_STUCK (op korunur), 5. serbest', () => {
    expect(FEE_RETRY_MAX).toBe(6)
    const ok = reconcileFee(sending({ op: opOf({ attempts: FEE_RETRY_MAX - 1 }) }), { type: 'RESEND' }, NOW)
    expect(ok.fee.state).toBe('sending')
    expect(ok.fee.op.attempts).toBe(FEE_RETRY_MAX)
    const r = sending({ op: opOf({ attempts: FEE_RETRY_MAX }) })
    const stuck = reconcileFee(r, { type: 'RESEND' }, NOW)
    expect(stuck.fee.state).toBe('blocked')
    expect(stuck.fee.blocker).toBe('FEE_STUCK')
    expect(stuck.fee.op).toEqual(r.fee.op) // op KORUNUR
  })
  it('Review Focus 1: 24 saat sinirda serbest, +1 ms FEE_STUCK', () => {
    const at = (d) => reconcileFee(sending(), { type: 'RESEND' }, T0 + FEE_RETRY_WINDOW_MS + d)
    expect(at(0).fee.state).toBe('sending')
    const stuck = at(1)
    expect(stuck.fee.state).toBe('blocked')
    expect(stuck.fee.blocker).toBe('FEE_STUCK')
    expect(stuck.fee.op.nonce).toBe('7')
  })
  it('Review Focus 1: RENONCE attempts ve firstSentAt i SIFIRLAMAZ; yeni nonce ile 7. deneme atlatilamaz', () => {
    const r = sending({
      op: opOf({
        attempts: 5,
        firstSentAt: T0,
        userOpHash: H2,
        relayTxHash: H3,
      }),
    })
    const p = reconcileFee(r, { type: 'RENONCE', op: OP2 }, NOW)
    expect(p.fee.state).toBe('sending')
    expect(p.fee.op).toMatchObject({
      nonce: '8',
      callDataHash: H2,
      startBlock: 1200,
      attempts: 5,
      firstSentAt: T0,
    })
    expect(p.fee.op.userOpHash).toBeNull() // eski op a ait hash tasinmaz
    let cur = { ...r, fee: p.fee }
    cur = { ...cur, fee: reconcileFee(cur, { type: 'RESEND' }, NOW).fee }
    expect(cur.fee.op.attempts).toBe(6)
    expect(reconcileFee(cur, { type: 'RESEND' }, NOW).fee.blocker).toBe('FEE_STUCK')
  })
  it('RENONCE op yoksa ya da bozuksa {}', () => {
    expect(reconcileFee(rec({ state: 'sending', op: null }), { type: 'RENONCE', op: OP2 }, NOW)).toEqual({})
    expect(reconcileFee(sending(), { type: 'RENONCE', op: { nonce: '1' } }, NOW)).toEqual({})
  })
})

describe('reconcileFee PAID', () => {
  it('sending + gecerli makbuz -> paid, refund claimable', () => {
    const p = reconcileFee(sending({ blocker: null }), PAID_EV, NOW)
    expect(p.fee).toMatchObject({
      state: 'paid',
      paidTxHash: H3,
      atsChargedRaw: '24000000000000000000',
      blocker: null,
      updatedAt: NOW,
    })
    expect(p.refund).toEqual({
      ...newRefundState(),
      state: 'claimable',
      firstClaimableAt: NOW,
    })
  })
  it('owed ve blocked tan PAID kabul edilmez', () => {
    expect(reconcileFee(owed(), PAID_EV, NOW)).toEqual({})
    expect(reconcileFee(blocked('BALANCE'), PAID_EV, NOW)).toEqual({})
  })
  it('bozuk makbuz verisi -> {}', () => {
    const bad = [
      { paidTxHash: '0x1234', atsChargedRaw: '5' },
      { paidTxHash: H3, atsChargedRaw: '0' },
      { paidTxHash: H3, atsChargedRaw: '-5' },
      { paidTxHash: H3, atsChargedRaw: '1.5' },
      { paidTxHash: H3, atsChargedRaw: 'abc' },
      { paidTxHash: H3, atsChargedRaw: 5n },
      { paidTxHash: H3, atsChargedRaw: 5 },
      { paidTxHash: H3 },
      { atsChargedRaw: '5' },
    ]
    for (const b of bad) expect(reconcileFee(sending(), { type: 'PAID', ...b }, NOW)).toEqual({})
  })
})

describe('reconcileFee BLOCK / UNBLOCK / APPROVE_FEE / SERVICE_OK', () => {
  it('NO_SERVICE: ilk BLOCK noServiceSince=now, ikincisi ayni kalir', () => {
    const a = reconcileFee(owed(), { type: 'BLOCK', blocker: 'NO_SERVICE' }, NOW)
    expect(a.fee).toMatchObject({
      state: 'blocked',
      blocker: 'NO_SERVICE',
      noServiceSince: NOW,
    })
    const b = reconcileFee({ ...owed(), fee: a.fee }, { type: 'BLOCK', blocker: 'NO_SERVICE' }, NOW + 60_000)
    expect(b.fee.noServiceSince).toBe(NOW)
  })
  it('baska blocker noServiceSince i siler; SERVICE_OK da siler', () => {
    const r = blocked('NO_SERVICE', { noServiceSince: T0 })
    expect(reconcileFee(r, { type: 'BLOCK', blocker: 'BALANCE' }, NOW).fee.noServiceSince).toBeNull()
    const ok = reconcileFee(r, { type: 'SERVICE_OK' }, NOW)
    expect(ok.fee.noServiceSince).toBeNull()
    expect(ok.fee.state).toBe('blocked')
  })
  it('BLOCK kapali kume disi blocker -> {}; op korunur', () => {
    expect(reconcileFee(owed(), { type: 'BLOCK', blocker: 'WHATEVER' }, NOW)).toEqual({})
    expect(reconcileFee(owed(), { type: 'BLOCK' }, NOW)).toEqual({})
    const r = sending()
    expect(reconcileFee(r, { type: 'BLOCK', blocker: 'APPROVAL' }, NOW).fee.op).toEqual(r.fee.op)
  })
  it('FEE_CHANGED freshFeeRaw yazar; UNBLOCK/APPROVE_FEE siler; gecersiz ya da baska blocker te yazilmaz', () => {
    const b = reconcileFee(sending(), { type: 'BLOCK', blocker: 'FEE_CHANGED', freshFeeRaw: '38000' }, NOW)
    expect(b.fee.freshFeeRaw).toBe('38000')
    expect(
      reconcileFee(sending(), { type: 'BLOCK', blocker: 'FEE_CHANGED', freshFeeRaw: '3.8' }, NOW).fee.freshFeeRaw,
    ).toBeNull()
    expect(reconcileFee(sending(), { type: 'BLOCK', blocker: 'BALANCE', freshFeeRaw: '38' }, NOW).fee.freshFeeRaw).toBeNull()
    const r = { ...sending(), fee: b.fee }
    expect(reconcileFee(r, { type: 'UNBLOCK' }, NOW).fee.freshFeeRaw).toBeNull()
    expect(reconcileFee(r, { type: 'APPROVE_FEE', quotedAtsRaw: '38000' }, NOW).fee.freshFeeRaw).toBeNull()
  })
  it('UNBLOCK op lu kayitta sending, op suzda owed; blocker silinir', () => {
    const a = reconcileFee(blocked('BALANCE'), { type: 'UNBLOCK' }, NOW)
    expect(a.fee).toMatchObject({ state: 'sending', blocker: null })
    const b = reconcileFee(blocked('BALANCE', { op: null }), { type: 'UNBLOCK' }, NOW)
    expect(b.fee).toMatchObject({ state: 'owed', blocker: null })
  })
  it('UNBLOCK noServiceSince i silmez (ardisik hata olcumu SERVICE_OK ile biter)', () => {
    const r = blocked('NO_SERVICE', { noServiceSince: T0 })
    expect(reconcileFee(r, { type: 'UNBLOCK' }, NOW).fee.noServiceSince).toBe(T0)
  })
  it('APPROVE_FEE: yalniz blocked/FEE_CHANGED; op lu sending (op korunur), op suz owed; quotedAtsRaw yenilenir', () => {
    const r = blocked('FEE_CHANGED', { freshFeeRaw: '38' })
    const a = reconcileFee(r, { type: 'APPROVE_FEE', quotedAtsRaw: '38' }, NOW)
    expect(a.fee).toMatchObject({
      state: 'sending',
      blocker: null,
      quotedAtsRaw: '38',
    })
    expect(a.fee.op).toEqual(r.fee.op)
    const b = reconcileFee(blocked('FEE_CHANGED', { op: null }), { type: 'APPROVE_FEE', quotedAtsRaw: '38' }, NOW)
    expect(b.fee).toMatchObject({ state: 'owed', op: null })
    expect(reconcileFee(blocked('BALANCE'), { type: 'APPROVE_FEE', quotedAtsRaw: '38' }, NOW)).toEqual({})
    for (const q of ['x', '3.8', '-1', undefined, 38, '0']) {
      expect(reconcileFee(r, { type: 'APPROVE_FEE', quotedAtsRaw: q }, NOW)).toEqual({})
    }
  })
})

describe('isFeeChanged', () => {
  const Q = 25_000_000_000_000_000_000n // 25 ATS
  const LIMIT = (Q * 12500n) / 10000n
  it('tam %125 sinirda false, 1 atom fazlasi true', () => {
    expect(isFeeChanged(LIMIT.toString(), Q.toString())).toBe(false)
    expect(isFeeChanged((LIMIT + 1n).toString(), Q.toString())).toBe(true)
    expect(isFeeChanged(Q.toString(), Q.toString())).toBe(false)
    expect(isFeeChanged('1', Q.toString())).toBe(false)
  })
  it('BigInt girdi kabul eder', () => {
    expect(isFeeChanged(LIMIT, Q)).toBe(false)
    expect(isFeeChanged(LIMIT + 1n, Q)).toBe(true)
  })
  it('gecersiz ya da 0 quoted -> true (yeniden onay); gecersiz fresh -> true', () => {
    for (const q of [null, undefined, '', 'x', '0', 0n, '-5', '1.5']) expect(isFeeChanged('10', q)).toBe(true)
    for (const f of [null, undefined, 'x', '-1']) expect(isFeeChanged(f, '10')).toBe(true)
  })
})

describe('feeView', () => {
  const PAID_REC = {
    uid: UID,
    chainId: 56,
    owner: OWNER,
    postBody: { secret: 1 },
    rawTx: '0xdead',
    fee: {
      ...newFeeState({ mode: 'ats', quotedAtsRaw: '25' }),
      state: 'paid',
      op: opOf({ nonce: '99', callDataHash: H1 }),
      paidTxHash: H3,
      atsChargedRaw: '24',
    },
    refund: {
      ...newRefundState(),
      state: 'sent',
      atsRaw: '24',
      txHash: H2,
      code: null,
      claimAttempts: 2,
    },
  }
  it('anahtar kumesi tam liste', () => {
    const v = feeView(PAID_REC)
    expect(Object.keys(v).sort()).toEqual(
      [
        'atsChargedRaw',
        'blocker',
        'chainId',
        'freshFeeRaw',
        'noServiceSince',
        'paidTxHash',
        'quotedAtsRaw',
        'refund',
        'state',
        'uid',
      ].sort(),
    )
    expect(Object.keys(v.refund).sort()).toEqual(['atsRaw', 'code', 'state', 'txHash'])
    expect(v).toMatchObject({
      uid: UID,
      chainId: 56,
      state: 'paid',
      paidTxHash: H3,
      atsChargedRaw: '24',
    })
  })
  it('op / nonce / callDataHash / postBody / rawTx sizmaz', () => {
    const j = JSON.stringify(feeView(PAID_REC))
    for (const s of ['nonce', 'callDataHash', 'postBody', 'rawTx', 'firstSentAt', 'claimAttempts', '"op"']) {
      expect(j).not.toContain(s)
    }
  })
  it('bozuk refund.code -> UNKNOWN; gecerli kod ve null korunur', () => {
    const mk = (code) =>
      feeView({
        ...PAID_REC,
        refund: { ...PAID_REC.refund, state: 'rejected', code },
      })
    expect(mk('lowercase').refund.code).toBe('UNKNOWN')
    expect(mk('<script>').refund.code).toBe('UNKNOWN')
    expect(mk('AB').refund.code).toBe('UNKNOWN')
    expect(mk('NO_REFUND_DUE').refund.code).toBe('NO_REFUND_DUE')
    expect(mk(null).refund.code).toBeNull()
  })
  it('mode none + refund none -> null; mode none ama iade hakki varsa gorunum', () => {
    expect(feeView({ uid: UID, chainId: 56, fee: newFeeState({ mode: 'none' }) })).toBeNull()
    expect(feeView({ uid: UID, chainId: 56 })).toBeNull()
    expect(feeView(null)).toBeNull()
    const v = feeView({
      uid: UID,
      chainId: 1,
      fee: newFeeState({ mode: 'none' }),
      refund: { ...newRefundState(), state: 'claimable' },
    })
    expect(v.refund.state).toBe('claimable')
  })
  it('ats modunda iade yok -> refund none gorunumu', () => {
    const v = feeView(rec({ state: 'owed' }))
    expect(v.refund).toEqual({
      state: 'none',
      atsRaw: null,
      txHash: null,
      code: null,
    })
    expect(v.state).toBe('owed')
  })
})

describe('reconcileRefund', () => {
  const claimable = (over = {}) => rec({ state: 'paid' }, { state: 'claimable', firstClaimableAt: T0, ...over })
  it('CLAIM_START claimable -> claiming, attempts+1, lastClaimAt', () => {
    const p = reconcileRefund(claimable(), { type: 'CLAIM_START' }, NOW)
    expect(p.refund).toMatchObject({
      state: 'claiming',
      claimAttempts: 1,
      lastClaimAt: NOW,
      firstClaimableAt: T0,
    })
  })
  it('taze claiming CLAIM_START almaz; bayat claiming alir', () => {
    const fresh = claimable({
      state: 'claiming',
      lastClaimAt: NOW - REFUND_CLAIMING_STALE_MS + 1,
      claimAttempts: 1,
    })
    expect(reconcileRefund(fresh, { type: 'CLAIM_START' }, NOW)).toEqual({})
    const stale = claimable({
      state: 'claiming',
      lastClaimAt: NOW - REFUND_CLAIMING_STALE_MS,
      claimAttempts: 1,
    })
    expect(reconcileRefund(stale, { type: 'CLAIM_START' }, NOW).refund).toMatchObject({
      state: 'claiming',
      claimAttempts: 2,
      lastClaimAt: NOW,
    })
  })
  it('none / sent / rejected CLAIM_START almaz', () => {
    for (const s of ['none', 'sent', 'rejected']) {
      expect(reconcileRefund(claimable({ state: s }), { type: 'CLAIM_START' }, NOW)).toEqual({})
    }
    expect(reconcileRefund({ uid: UID }, { type: 'CLAIM_START' }, NOW)).toEqual({})
  })
  it('approved yoklamasi: CLAIM_START approved kalir, lastClaimAt yenilenir', () => {
    const r = claimable({
      state: 'approved',
      lastClaimAt: T0,
      claimAttempts: 1,
    })
    expect(reconcileRefund(r, { type: 'CLAIM_START' }, NOW).refund).toMatchObject({
      state: 'approved',
      lastClaimAt: NOW,
      claimAttempts: 2,
    })
  })
  const claiming = () => claimable({ state: 'claiming', lastClaimAt: NOW, claimAttempts: 1 })
  it('CLAIM_RESULT approved|sending -> approved', () => {
    for (const status of ['approved', 'sending']) {
      expect(reconcileRefund(claiming(), { type: 'CLAIM_RESULT', status }, NOW).refund.state).toBe('approved')
    }
  })
  it('CLAIM_RESULT sent: atsRaw rakam, txHash 66 karakter; yoksa/bozuksa {}', () => {
    const ok = reconcileRefund(claiming(), { type: 'CLAIM_RESULT', status: 'sent', atsRaw: '24', txHash: H2 }, NOW)
    expect(ok.refund).toMatchObject({
      state: 'sent',
      atsRaw: '24',
      txHash: H2,
    })
    const bad = [{ atsRaw: 'x', txHash: H2 }, { atsRaw: '24', txHash: '0x12' }, { atsRaw: '24' }, { txHash: H2 }, {}]
    for (const b of bad) {
      expect(reconcileRefund(claiming(), { type: 'CLAIM_RESULT', status: 'sent', ...b }, NOW)).toEqual({})
    }
  })
  it('CLAIM_RESULT rejected: kod yazilir, bozuk kod UNKNOWN', () => {
    expect(
      reconcileRefund(claiming(), { type: 'CLAIM_RESULT', status: 'rejected', code: 'NO_REFUND_DUE' }, NOW).refund,
    ).toMatchObject({ state: 'rejected', code: 'NO_REFUND_DUE' })
    expect(
      reconcileRefund(claiming(), { type: 'CLAIM_RESULT', status: 'rejected', code: 'bad code' }, NOW).refund.code,
    ).toBe('UNKNOWN')
  })
  it('CLAIM_RESULT claimable/terminal durumda {}; bilinmeyen status {}', () => {
    expect(reconcileRefund(claimable(), { type: 'CLAIM_RESULT', status: 'sent', atsRaw: '1', txHash: H2 }, NOW)).toEqual({})
    expect(
      reconcileRefund(claimable({ state: 'rejected', code: 'ADMIN' }), { type: 'CLAIM_RESULT', status: 'approved' }, NOW),
    ).toEqual({})
    expect(reconcileRefund(claiming(), { type: 'CLAIM_RESULT', status: 'weird' }, NOW)).toEqual({})
  })
  it('CLAIM_TRANSIENT -> claimable, hak ve sayac korunur; approved degismez', () => {
    const p = reconcileRefund(
      claimable({ state: 'claiming', claimAttempts: 3, lastClaimAt: NOW }),
      { type: 'CLAIM_TRANSIENT' },
      NOW,
    )
    expect(p.refund).toMatchObject({
      state: 'claimable',
      claimAttempts: 3,
      firstClaimableAt: T0,
    })
    // approved yoklamasi gecici hatada approved kalir (yama yok)
    expect(reconcileRefund(claimable({ state: 'approved', claimAttempts: 2 }), { type: 'CLAIM_TRANSIENT' }, NOW)).toEqual({})
    expect(reconcileRefund(claimable(), { type: 'CLAIM_TRANSIENT' }, NOW)).toEqual({})
  })
})

describe('claimDue', () => {
  const R = (over = {}) => ({
    ...newRefundState(),
    state: 'claimable',
    firstClaimableAt: T0,
    ...over,
  })
  it('0 deneme -> hemen', () => {
    expect(claimDue(R(), T0)).toBe(true)
  })
  it('geri cekilme: 1 deneme 59 sn yanlis / 60 sn dogru; 2. 5 dk; 3+ 30 dk', () => {
    const last = T0 + 1000
    expect(claimDue(R({ claimAttempts: 1, lastClaimAt: last }), last + 59_000)).toBe(false)
    expect(claimDue(R({ claimAttempts: 1, lastClaimAt: last }), last + 60_000)).toBe(true)
    expect(claimDue(R({ claimAttempts: 2, lastClaimAt: last }), last + 299_999)).toBe(false)
    expect(claimDue(R({ claimAttempts: 2, lastClaimAt: last }), last + 300_000)).toBe(true)
    expect(claimDue(R({ claimAttempts: 3, lastClaimAt: last }), last + 1_799_999)).toBe(false)
    expect(claimDue(R({ claimAttempts: 3, lastClaimAt: last }), last + 1_800_000)).toBe(true)
    expect(claimDue(R({ claimAttempts: 9, lastClaimAt: last }), last + 1_799_999)).toBe(false)
    expect(claimDue(R({ claimAttempts: 9, lastClaimAt: last }), last + 1_800_000)).toBe(true)
  })
  it('24 saat sonrasi yanlis ama durum claimable kalir (silinmez)', () => {
    const r = R({ claimAttempts: 1, lastClaimAt: T0 })
    expect(claimDue(r, T0 + REFUND_CLAIM_WINDOW_MS)).toBe(true)
    expect(claimDue(r, T0 + REFUND_CLAIM_WINDOW_MS + 1)).toBe(false)
    expect(r.state).toBe('claimable')
  })
  it('bayat claiming dogru, taze claiming yanlis', () => {
    const c = R({ state: 'claiming', claimAttempts: 1, lastClaimAt: NOW })
    expect(claimDue(c, NOW + REFUND_CLAIMING_STALE_MS - 1)).toBe(false)
    expect(claimDue(c, NOW + REFUND_CLAIMING_STALE_MS)).toBe(true)
  })
  it('approved: yoklama araligi ve 7 gun penceresi', () => {
    const a = R({ state: 'approved', claimAttempts: 1, lastClaimAt: NOW })
    expect(claimDue(a, NOW + REFUND_POLL_MIN_MS - 1)).toBe(false)
    expect(claimDue(a, NOW + REFUND_POLL_MIN_MS)).toBe(true)
    const old = R({
      state: 'approved',
      claimAttempts: 5,
      lastClaimAt: T0 + REFUND_APPROVED_WINDOW_MS,
    })
    expect(claimDue(old, T0 + REFUND_APPROVED_WINDOW_MS + REFUND_POLL_MIN_MS)).toBe(false)
    expect(claimDue(R({ state: 'approved', claimAttempts: 1, lastClaimAt: T0 }), T0 + REFUND_APPROVED_WINDOW_MS)).toBe(true)
  })
  it('none / sent / rejected / bos -> false', () => {
    for (const s of ['none', 'sent', 'rejected']) expect(claimDue(R({ state: s }), NOW)).toBe(false)
    expect(claimDue(null, NOW)).toBe(false)
    expect(claimDue(undefined, NOW)).toBe(false)
  })
})

describe('kaynak taramasi', () => {
  const kaynak = yorumsuz(
    fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fee.js'), 'utf8'),
  )
  it('fee.js saf: fetch(, chrome., Date.now( icermez', () => {
    expect(kaynak).not.toContain('fetch(')
    expect(kaynak).not.toContain('chrome.')
    expect(kaynak).not.toContain('Date.now(')
  })
  it('atsPaymaster import etmez', () => {
    expect(kaynak).not.toMatch(/from ['"]\.\.\/atsPaymaster['"]/)
  })
})

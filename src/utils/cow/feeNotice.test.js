// feeNotice.js: FeeView -> gosterim eslemesi (spec 4.2 tablosu). Saf; yalniz anahtar doner.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { feeNoticeOf } from './feeNotice'

const P = 'stockTrade.atsFee.'
const fmt = (raw) => `F(${raw})`
const view = (over = {}, refund = {}) => ({
  uid: '0x' + 'a'.repeat(112),
  chainId: 56,
  state: 'owed',
  blocker: null,
  quotedAtsRaw: '25000000000000000000',
  freshFeeRaw: null,
  atsChargedRaw: null,
  paidTxHash: null,
  noServiceSince: null,
  refund: { state: 'none', atsRaw: null, txHash: null, code: null, ...refund },
  ...over,
})

describe('feeNoticeOf', () => {
  it('bos / gecersiz / idle / void -> null', () => {
    expect(feeNoticeOf(null)).toBeNull()
    expect(feeNoticeOf(undefined)).toBeNull()
    expect(feeNoticeOf(view({ state: 'void' }))).toBeNull()
    expect(feeNoticeOf(view({ state: 'idle' }))).toBeNull()
    expect(feeNoticeOf(view({ state: null }))).toBeNull()
  })

  it('owed, cuzdan acik -> paying + payNow', () => {
    expect(feeNoticeOf(view(), { walletLocked: false, format: fmt })).toEqual({
      key: P + 'state.paying', params: {}, tone: 'info', actions: ['payNow'],
    })
  })

  it('owed, cuzdan kilitli -> owedLocked (payNow YOK), tutar format ile', () => {
    expect(feeNoticeOf(view(), { walletLocked: true, format: fmt })).toEqual({
      key: P + 'state.owedLocked', params: { amount: 'F(25000000000000000000)' }, tone: 'info', actions: [],
    })
  })

  it('sending -> paying, eylem yok', () => {
    expect(feeNoticeOf(view({ state: 'sending' }))).toEqual({
      key: P + 'state.paying', params: {}, tone: 'info', actions: [],
    })
  })

  it('blocked BALANCE -> balance [buyAts, retry]', () => {
    expect(feeNoticeOf(view({ state: 'blocked', blocker: 'BALANCE', freshFeeRaw: '30' }), { format: fmt })).toEqual({
      key: P + 'state.balance', params: { amount: 'F(30)' }, tone: 'warn', actions: ['buyAts', 'retry'],
    })
  })

  it('blocked BALANCE taze ucret yoksa teklif edilen tutar', () => {
    expect(feeNoticeOf(view({ state: 'blocked', blocker: 'BALANCE', quotedAtsRaw: '25' }), { format: fmt }).params)
      .toEqual({ amount: 'F(25)' })
  })

  it('blocked APPROVAL -> approval [prepare]', () => {
    expect(feeNoticeOf(view({ state: 'blocked', blocker: 'APPROVAL' }))).toEqual({
      key: P + 'state.approval', params: {}, tone: 'warn', actions: ['prepare'],
    })
  })

  it('blocked FEE_CHANGED -> feeChanged 25 -> 38 [approve, decline]', () => {
    const n = feeNoticeOf(view({ state: 'blocked', blocker: 'FEE_CHANGED', quotedAtsRaw: '25', freshFeeRaw: '38' }), { format: fmt })
    expect(n).toEqual({
      key: P + 'state.feeChanged', params: { from: 'F(25)', to: 'F(38)' }, tone: 'warn', actions: ['approve', 'decline'],
    })
  })

  it('blocked FEE_STUCK -> stuck (error, eylem yok)', () => {
    expect(feeNoticeOf(view({ state: 'blocked', blocker: 'FEE_STUCK' }))).toEqual({
      key: P + 'state.stuck', params: {}, tone: 'error', actions: [],
    })
  })

  it.each(['COMMISSION', 'NO_SERVICE'])('blocked %s -> unavailable', (blocker) => {
    expect(feeNoticeOf(view({ state: 'blocked', blocker }))).toEqual({
      key: P + 'state.unavailable', params: {}, tone: 'info', actions: [],
    })
  })

  it('paid + iade bekliyor -> paidPending', () => {
    for (const s of ['claimable', 'claiming', 'approved']) {
      expect(feeNoticeOf(view({ state: 'paid' }, { state: s }))).toEqual({
        key: P + 'state.paidPending', params: {}, tone: 'info', actions: [],
      })
    }
  })

  it('paid + iade yok -> null', () => {
    expect(feeNoticeOf(view({ state: 'paid' }))).toBeNull()
  })

  it('refund sent -> refundSent (ok, tutar format ile)', () => {
    expect(feeNoticeOf(view({ state: 'paid' }, { state: 'sent', atsRaw: '31' }), { format: fmt })).toEqual({
      key: P + 'state.refundSent', params: { amount: 'F(31)' }, tone: 'ok', actions: [],
    })
  })

  it('refund rejected -> refundRejected (error, kod)', () => {
    expect(feeNoticeOf(view({ state: 'paid' }, { state: 'rejected', code: 'NO_REFUND_DUE' }))).toEqual({
      key: P + 'state.refundRejected', params: { code: 'NO_REFUND_DUE' }, tone: 'error', actions: [],
    })
  })

  it('bozuk refund.code ekrana girmez -> UNKNOWN', () => {
    for (const bad of ['<script>', 'ab', 'x'.repeat(40), 'lower_case', null, 42]) {
      expect(feeNoticeOf(view({ state: 'paid' }, { state: 'rejected', code: bad })).params.code).toBe('UNKNOWN')
    }
  })

  it('kaynak: $t( / i18n icermez (yalniz anahtar doner)', () => {
    const src = readFileSync(fileURLToPath(new URL('./feeNotice.js', import.meta.url)), 'utf8')
    const yorumsuz = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(yorumsuz).not.toMatch(/\$t\(/)
    expect(yorumsuz).not.toMatch(/i18n/)
  })
})

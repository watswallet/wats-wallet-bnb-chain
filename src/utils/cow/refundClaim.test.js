// cow/refundClaim.js: iade talebi (Review Focus 3). Sahte fetchImpl + bellek ici emir deposu; ag yok.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { newFeeState, newRefundState } from './fee'
import { createRefundClaimer } from './refundClaim'

const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const UID = '0x' + 'ab'.repeat(56)
const FEE_HASH = '0x' + '22'.repeat(32)
const SENT_HASH = '0x' + '33'.repeat(32)
const BASE = 'https://api.example.test'
const NOW = 1_700_000_000_000
const uidOf = (n) => '0x' + String(n).repeat(112)

const mkRec = (uid = UID, refund = {}, extra = {}) => ({
  uid,
  owner: OWNER,
  chainId: 1,
  createdAt: 1000,
  status: 'fulfilled',
  fee: { ...newFeeState({ mode: 'ats', quotedAtsRaw: '1' }), state: 'paid', paidTxHash: FEE_HASH },
  refund: { ...newRefundState(), state: 'claimable', firstClaimableAt: NOW - 1000, ...refund },
  ...extra,
})

const jsonRes = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })

function makeEnv(records, o = {}) {
  const store = new Map(records.map((r) => [r.uid, structuredClone(r)]))
  const calls = []
  // Gercek withStorageList gibi yazmalar SERI (kuyruk): her patch tazeyi okur, sonraki onu bekler
  let queue = Promise.resolve()
  const orders = {
    loadOrders: vi.fn(async () => [...store.values()].map((r) => structuredClone(r))),
    patchOrder: vi.fn((uid, fn, t) => {
      const run = queue.then(async () => {
        const cur = store.get(uid)
        if (!cur) return null
        const patch = typeof fn === 'function' ? fn(structuredClone(cur)) : fn
        await new Promise((r) => setTimeout(r, 0)) // tamamlanma ani gunluge girer
        calls.push(`patch:${fn?.eventType ?? 'raw'}`)
        if (!patch || Object.keys(patch).length === 0) return structuredClone(cur)
        const next = { ...cur, ...patch, uid: cur.uid, updatedAt: t }
        store.set(uid, next)
        return structuredClone(next)
      })
      queue = run.catch(() => {})
      return run
    }),
  }
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push('fetch')
    return (o.fetch ?? (async () => jsonRes(200, { status: 'approved' })))(url, init)
  })
  const claimer = createRefundClaimer({
    orders,
    fetchImpl,
    baseUrl: 'baseUrl' in o ? o.baseUrl : BASE,
    now: () => NOW,
    timeoutMs: o.timeoutMs ?? 10_000,
    log: o.log,
  })
  return { store, calls, orders, fetchImpl, claimer }
}

describe('claimRefund: yanit tablosu', () => {
  const sentBody = { status: 'sent', atsRaw: '1500000000000000000', txHash: SENT_HASH }
  const cases = [
    ['200 approved', () => jsonRes(200, { status: 'approved' }), 'APPROVED', 'approved'],
    ['200 sending', () => jsonRes(200, { status: 'sending' }), 'APPROVED', 'approved'],
    ['200 sent', () => jsonRes(200, sentBody), 'SENT', 'sent'],
    ['200 rejected', () => jsonRes(200, { status: 'rejected', code: 'NO_REFUND_DUE' }), 'REJECTED', 'rejected'],
    ['404', () => jsonRes(404, { status: 'rejected', code: 'NOT_FOUND' }), 'TRANSIENT', 'claimable'],
    ['409', () => jsonRes(409, {}), 'TRANSIENT', 'claimable'],
    ['503', () => jsonRes(503, { status: 'rejected', code: 'REFUNDS_PAUSED' }), 'TRANSIENT', 'claimable'],
    ['400', () => jsonRes(400, { status: 'rejected', code: 'BAD_REQUEST' }), 'TRANSIENT', 'claimable'],
    ['500', () => jsonRes(500, {}), 'TRANSIENT', 'claimable'],
    ['ag hatasi', () => Promise.reject(new Error('net down')), 'TRANSIENT', 'claimable'],
    [
      'bozuk JSON',
      () => ({
        status: 200,
        ok: true,
        json: async () => {
          throw new SyntaxError('x')
        },
      }),
      'TRANSIENT',
      'claimable',
    ],
    ['200 bilinmeyen status', () => jsonRes(200, { status: 'weird' }), 'TRANSIENT', 'claimable'],
    ['200 sent atsRaw bozuk', () => jsonRes(200, { ...sentBody, atsRaw: '-1' }), 'TRANSIENT', 'claimable'],
    ['200 sent txHash kisa', () => jsonRes(200, { ...sentBody, txHash: '0x12' }), 'TRANSIENT', 'claimable'],
    ['200 sent txHash yok', () => jsonRes(200, { status: 'sent', atsRaw: '1' }), 'TRANSIENT', 'claimable'],
  ]
  for (const [ad, fetch, outcome, state] of cases) {
    it(`${ad} -> ${outcome} / refund.state ${state}`, async () => {
      const env = makeEnv([mkRec()], { fetch })
      const r = await env.claimer.claimRefund(env.store.get(UID))
      expect(r).toEqual({ outcome })
      expect(env.store.get(UID).refund.state).toBe(state)
      expect(env.fetchImpl).toHaveBeenCalledTimes(1)
    })
  }

  it('zaman asimi: istek iptal edilir -> TRANSIENT, hak korunur', async () => {
    const env = makeEnv([mkRec()], {
      timeoutMs: 20,
      fetch: (url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    })
    const r = await env.claimer.claimRefund(env.store.get(UID))
    expect(r).toEqual({ outcome: 'TRANSIENT' })
    expect(env.store.get(UID).refund.state).toBe('claimable')
  })

  it('rejected: gecersiz kod UNKNOWN olur, ham metin kayda girmez', async () => {
    const env = makeEnv([mkRec()], { fetch: () => jsonRes(200, { status: 'rejected', code: '<script>x' }) })
    await env.claimer.claimRefund(env.store.get(UID))
    expect(env.store.get(UID).refund).toMatchObject({ state: 'rejected', code: 'UNKNOWN' })
  })

  it('sent: atsRaw ve txHash kayda yazilir', async () => {
    const env = makeEnv([mkRec()], { fetch: () => jsonRes(200, sentBody) })
    await env.claimer.claimRefund(env.store.get(UID))
    expect(env.store.get(UID).refund).toMatchObject({ state: 'sent', atsRaw: sentBody.atsRaw, txHash: SENT_HASH })
  })

  it('approved yoklamasi: approved kayit tekrar sorulur ve sent olur', async () => {
    const env = makeEnv([mkRec(UID, { state: 'approved', claimAttempts: 1, lastClaimAt: NOW - 120_000 })], {
      fetch: () => jsonRes(200, sentBody),
    })
    const r = await env.claimer.claimRefund(env.store.get(UID))
    expect(r).toEqual({ outcome: 'SENT' })
    expect(env.store.get(UID).refund.state).toBe('sent')
  })
})

describe('claimRefund: gonderilen istek (Review Focus 3)', () => {
  it('govde TAM {uid, chainId, feeTxHash}; feeTxHash === fee.paidTxHash; kimlik/cerez yok', async () => {
    const env = makeEnv([mkRec()])
    await env.claimer.claimRefund(env.store.get(UID))
    const [url, init] = env.fetchImpl.mock.calls[0]
    expect(url).toBe(`${BASE}/cow/refund-claim`)
    const body = JSON.parse(init.body)
    expect(Object.keys(body).sort()).toEqual(['chainId', 'feeTxHash', 'uid'])
    expect(body).toEqual({ uid: UID, chainId: 1, feeTxHash: FEE_HASH })
    expect(body.feeTxHash).toBe(env.store.get(UID).fee.paidTxHash)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.credentials).toBe('omit')
    expect(init.signal).toBeDefined()
    expect(Object.keys(init).sort()).toEqual(['body', 'credentials', 'headers', 'method', 'signal'])
  })
})

describe('claimRefund: CLAIM_START yazimi', () => {
  it('CLAIM_START POST ONCE kalici yazilir, CLAIM_RESULT sonra', async () => {
    const env = makeEnv([mkRec()])
    await env.claimer.claimRefund(env.store.get(UID))
    expect(env.calls).toEqual(['patch:CLAIM_START', 'fetch', 'patch:CLAIM_RESULT'])
  })

  it('CLAIM_START yazimi basarisizsa istek GITMEZ', async () => {
    const env = makeEnv([mkRec()])
    env.orders.patchOrder.mockRejectedValueOnce(new Error('store-down'))
    await expect(env.claimer.claimRefund(env.store.get(UID))).rejects.toThrow()
    expect(env.fetchImpl).not.toHaveBeenCalled()
  })

  it('iki eszamanli claimRefund (ayni kayit): ikincisi SKIPPED, tek POST', async () => {
    const env = makeEnv([mkRec()], {
      fetch: async () => {
        await new Promise((r) => setTimeout(r, 5))
        return jsonRes(200, { status: 'approved' })
      },
    })
    const stale = env.store.get(UID) // ikisi de eski (claimable) goruntuyu tutar
    const [a, b] = await Promise.all([env.claimer.claimRefund(stale), env.claimer.claimRefund(stale)])
    expect([a.outcome, b.outcome].sort()).toEqual(['APPROVED', 'SKIPPED'])
    expect(env.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('taze claiming kayit SKIPPED, istek yok', async () => {
    const env = makeEnv([mkRec(UID, { state: 'claiming', claimAttempts: 1, lastClaimAt: NOW - 1000 })])
    expect(await env.claimer.claimRefund(env.store.get(UID))).toEqual({ outcome: 'SKIPPED' })
    expect(env.fetchImpl).not.toHaveBeenCalled()
    expect(env.orders.patchOrder).not.toHaveBeenCalled()
  })

  it('bayat claiming kayit yeniden denenir', async () => {
    const env = makeEnv([mkRec(UID, { state: 'claiming', claimAttempts: 1, lastClaimAt: NOW - 200_000 })])
    expect(await env.claimer.claimRefund(env.store.get(UID))).toEqual({ outcome: 'APPROVED' })
  })
})

describe('claimRefund: kapilar', () => {
  it('claimDue yanlis (geri cekilme dolmadi) -> istek yok', async () => {
    const env = makeEnv([mkRec(UID, { claimAttempts: 1, lastClaimAt: NOW - 1000 })])
    expect(await env.claimer.claimRefund(env.store.get(UID))).toEqual({ outcome: 'SKIPPED' })
    expect(env.fetchImpl).not.toHaveBeenCalled()
  })

  it('24 saat penceresi dolunca istek yok', async () => {
    const env = makeEnv([
      mkRec(UID, { firstClaimableAt: NOW - 25 * 3600_000, claimAttempts: 3, lastClaimAt: NOW - 3600_000 }),
    ])
    expect(await env.claimer.claimRefund(env.store.get(UID))).toEqual({ outcome: 'SKIPPED' })
    expect(env.fetchImpl).not.toHaveBeenCalled()
  })

  for (const state of ['none', 'sent', 'rejected', 'x']) {
    it(`refund.state ${state} -> istek yok`, async () => {
      const env = makeEnv([mkRec(UID, { state })])
      expect(await env.claimer.claimRefund(env.store.get(UID))).toEqual({ outcome: 'SKIPPED' })
      expect(env.fetchImpl).not.toHaveBeenCalled()
    })
  }

  it('refund alani yok -> istek yok', async () => {
    const rec = mkRec()
    delete rec.refund
    const env = makeEnv([rec])
    expect(await env.claimer.claimRefund(rec)).toEqual({ outcome: 'SKIPPED' })
    expect(env.fetchImpl).not.toHaveBeenCalled()
  })

  for (const bad of [null, undefined, '', '0x12', FEE_HASH.slice(0, 65), FEE_HASH + '00', 'zz' + FEE_HASH.slice(2), 5]) {
    it(`paidTxHash ${JSON.stringify(bad)} gecersiz -> istek yok`, async () => {
      const rec = mkRec()
      rec.fee.paidTxHash = bad
      const env = makeEnv([rec])
      expect(await env.claimer.claimRefund(rec)).toEqual({ outcome: 'SKIPPED' })
      expect(env.fetchImpl).not.toHaveBeenCalled()
      expect(env.orders.patchOrder).not.toHaveBeenCalled()
    })
  }

  it('baseUrl bos -> istek yok, yazim yok', async () => {
    const env = makeEnv([mkRec()], { baseUrl: '' })
    expect(await env.claimer.claimRefund(env.store.get(UID))).toEqual({ outcome: 'SKIPPED' })
    expect(await env.claimer.claimRefunds()).toEqual({ tried: 0 })
    expect(env.fetchImpl).not.toHaveBeenCalled()
    expect(env.orders.patchOrder).not.toHaveBeenCalled()
  })

  it('depodaki guncel kayit esas alinir: eski goruntu claimable ama depoda sent ise istek yok', async () => {
    const stale = mkRec()
    const env = makeEnv([mkRec(UID, { state: 'sent', atsRaw: '1', txHash: SENT_HASH })])
    expect(await env.claimer.claimRefund(stale)).toEqual({ outcome: 'SKIPPED' })
    expect(env.fetchImpl).not.toHaveBeenCalled()
  })

  it('depodaki kayit geri cekilmede ise (eski goruntu vadesi gelmis gorunse de) istek yok', async () => {
    const stale = mkRec()
    const env = makeEnv([mkRec(UID, { claimAttempts: 1, lastClaimAt: NOW - 1000 })])
    expect(await env.claimer.claimRefund(stale)).toEqual({ outcome: 'SKIPPED' })
    expect(env.fetchImpl).not.toHaveBeenCalled()
  })

  it('depodaki paidTxHash esas alinir: eski goruntudeki hash gonderilmez', async () => {
    const stale = mkRec()
    const fresh = mkRec()
    fresh.fee.paidTxHash = '0x' + '44'.repeat(32)
    const env = makeEnv([fresh])
    await env.claimer.claimRefund(stale)
    expect(JSON.parse(env.fetchImpl.mock.calls[0][1].body).feeTxHash).toBe('0x' + '44'.repeat(32))
  })

  it('kaynak taramasi: bayrak/anahtar/ham hata yok', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const kaynak = yorumsuz(fs.readFileSync(path.join(dir, 'refundClaim.js'), 'utf8'))
    expect(kaynak).not.toMatch(/featureFlags/)
    expect(kaynak).not.toMatch(/XSTOCKS_ATS_FEE_ENABLED/)
    expect(kaynak).not.toMatch(/getSigner|privateKey|mnemonic|seedPhrase/i)
    expect(kaynak).not.toMatch(/console\s*\.\s*(log|error|warn|info|debug)\s*\(/)
    expect(kaynak).not.toMatch(/\.message\b/)
  })
})

describe('claimRefunds', () => {
  it('5 aday -> 3 deneme, createdAt sirasiyla', async () => {
    const recs = [5, 3, 1, 4, 2].map((n) => mkRec(uidOf(n), {}, { createdAt: n * 100 }))
    const env = makeEnv(recs)
    const r = await env.claimer.claimRefunds()
    expect(r).toEqual({ tried: 3 })
    const sent = env.fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).uid)
    expect(sent).toEqual([1, 2, 3].map(uidOf))
  })

  it('SIRAYLA: bir istek bitmeden digeri baslamaz', async () => {
    const order = []
    const recs = [1, 2].map((n) => mkRec(uidOf(n), {}, { createdAt: n }))
    const env = makeEnv(recs, {
      fetch: async () => {
        order.push('start')
        await new Promise((r) => setTimeout(r, 5))
        order.push('end')
        return jsonRes(200, { status: 'approved' })
      },
    })
    await env.claimer.claimRefunds()
    expect(order).toEqual(['start', 'end', 'start', 'end'])
  })

  it('bir kayit firlatsa digerleri surer', async () => {
    const recs = [1, 2, 3].map((n) => mkRec(uidOf(n), {}, { createdAt: n }))
    const env = makeEnv(recs)
    const real = env.orders.patchOrder.getMockImplementation()
    env.orders.patchOrder.mockImplementation(async (uid, fn, t) => {
      if (uid === uidOf(1)) throw new Error('store-down')
      return real(uid, fn, t)
    })
    const r = await env.claimer.claimRefunds()
    expect(r).toEqual({ tried: 3 })
    expect(env.fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('yalniz vadesi gelenler; vadesi gelmeyen kayitlar 3 kontenjanini yemez', async () => {
    const notDue = [1, 2, 3].map((n) => mkRec(uidOf(n), { claimAttempts: 1, lastClaimAt: NOW - 1000 }, { createdAt: n }))
    const sent = mkRec(uidOf(4), { state: 'sent' }, { createdAt: 4 })
    const due = mkRec(uidOf(5), {}, { createdAt: 5 })
    const env = makeEnv([...notDue, sent, due])
    expect(await env.claimer.claimRefunds()).toEqual({ tried: 1 })
    expect(env.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('loadOrders firlatirsa { tried: 0 }', async () => {
    const env = makeEnv([mkRec()])
    env.orders.loadOrders.mockRejectedValueOnce(new Error('x'))
    expect(await env.claimer.claimRefunds()).toEqual({ tried: 0 })
  })
})

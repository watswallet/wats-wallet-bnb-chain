// cow/feeSettle.js: ucret tahsilati (Review Focus 1: cift ucret). Butun bagimliliklar sahte; ag/anahtar yok.
// Olay sirasi calls[] dizisine kaydedilir: write-ahead (SEND_START) execute'tan ONCE olmali.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { buildFeeCall, feeCallDataHash, newFeeState, reconcileFee } from './fee'
import { createFeeSettler } from './feeSettle'

const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const OTHER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const UID = '0x' + 'ab'.repeat(56)
const UID2 = '0x' + 'cd'.repeat(56)
const UID3 = '0x' + 'ef'.repeat(56)
const H1 = '0x' + '11'.repeat(32)
const H2 = '0x' + '22'.repeat(32)
const H3 = '0x' + '33'.repeat(32)
const FEE = '1000000000000000000'
const NOW = 1_700_000_000_000

const mkOp = (extra = {}) => ({
  nonce: '7',
  callDataHash: feeCallDataHash(OWNER, UID),
  startBlock: 900,
  attempts: 1,
  firstSentAt: NOW - 60_000,
  userOpHash: null,
  relayTxHash: null,
  ...extra,
})
const mkRec = (fee = {}, extra = {}) => ({
  uid: UID,
  owner: OWNER,
  createdAt: 1000,
  status: 'fulfilled',
  fee: { ...newFeeState({ mode: 'ats', quotedAtsRaw: FEE }), state: 'owed', ...fee },
  ...extra,
})

/** Sahte ortam: bellek ici emir deposu + sirali cagri gunlugu. */
function makeEnv(records, o = {}) {
  const store = new Map(records.map((r) => [r.uid, structuredClone(r)]))
  const calls = []
  const rec = (name, fn) =>
    vi.fn(async (...a) => {
      calls.push(name)
      return fn(...a)
    })
  const signer = { sentinel: 'signer' }
  const orders = {
    loadOrders: vi.fn(async () => [...store.values()].map((r) => structuredClone(r))),
    patchOrder: vi.fn(async (uid, fn, t) => {
      const tag = fn?.eventType ?? 'raw'
      if (o.failPatch === tag) {
        await new Promise((r) => setTimeout(r, 0))
        throw new Error('store-down')
      }
      const cur = store.get(uid)
      if (!cur) return null
      const patch = typeof fn === 'function' ? fn(structuredClone(cur)) : fn
      await new Promise((r) => setTimeout(r, 0)) // tamamlanma ANI gunluge girer: await silinirse sira bozulur
      calls.push(`patch:${tag}`)
      if (!patch || Object.keys(patch).length === 0) return structuredClone(cur)
      const next = { ...cur, ...patch, uid: cur.uid, updatedAt: t }
      store.set(uid, next)
      return structuredClone(next)
    }),
  }
  const chain = {
    readNonce: rec('nonce', o.readNonce ?? (async () => 7n)),
    readBlockNumber: rec('block', o.readBlockNumber ?? (async () => 1000)),
    readAtsBalance: rec('balance', o.readAtsBalance ?? (async () => 5n * 10n ** 18n)),
  }
  const ats = {
    status: rec('status', o.status ?? (async () => ({ ready: true, mode: 'normal' }))),
    quote: rec(
      'quote',
      o.quote ?? (async () => ({ feeRaw: FEE, commissionRaw: '0', quoted: { transferFee: FEE } })),
    ),
    execute: rec('execute', o.execute ?? (async () => ({ hash: H1, txHash: H2 }))),
  }
  const receipt = rec(
    'receipt',
    o.receipt ?? (async () => ({ status: 'PAID', atsChargedRaw: FEE, paidTxHash: H2 })),
  )
  const resolve = rec('resolve', o.resolve ?? (async () => ({ result: 'UNKNOWN', reason: 'EVENT_NOT_FOUND' })))
  const logs = []
  const settler = createFeeSettler({
    orders,
    chain,
    ats,
    receipt,
    resolve,
    now: () => NOW,
    log: (...a) => logs.push(a),
  })
  const getSigner = o.getSigner ?? vi.fn(async () => signer)
  const run = (extra = {}) => settler.settleCowFees({ owner: OWNER, getSigner, flagOn: true, ...extra })
  return { store, calls, orders, chain, ats, receipt, resolve, settler, getSigner, signer, run, logs }
}

const events = (env) => env.calls.filter((c) => c.startsWith('patch:')).map((c) => c.slice(6))
const executes = (env) => env.ats.execute.mock.calls

describe('settleCowFees: bayrak ve tek-ucus', () => {
  it('bayrak true degilse DISABLED ve hicbir bagimlilik cagrilmaz', async () => {
    for (const flagOn of [false, undefined, 'true', 1, null]) {
      const env = makeEnv([mkRec()])
      const r = await env.run({ flagOn })
      expect(r.outcome).toBe('DISABLED')
      expect(env.orders.loadOrders).not.toHaveBeenCalled()
      expect(env.calls).toEqual([])
      expect(env.getSigner).not.toHaveBeenCalled()
    }
  })

  it('iki eszamanli cagri: ikincisi BUSY, yalniz bir execute', async () => {
    const env = makeEnv([mkRec()])
    const [a, b] = await Promise.all([env.run(), env.run()])
    expect([a.outcome, b.outcome].sort()).toEqual(['BUSY', 'PAID'])
    expect(executes(env)).toHaveLength(1)
    // tek-ucus serbest birakilir
    const c = await env.run()
    expect(c.outcome).toBe('NONE')
  })

  it('tek-ucus hata olsa da serbest kalir', async () => {
    const env = makeEnv([mkRec()])
    env.orders.loadOrders.mockRejectedValueOnce(new Error('x'))
    const a = await env.run()
    expect(a.outcome).toBe('PENDING')
    const b = await env.run()
    expect(b.outcome).toBe('PAID')
  })

  it('aday yoksa NONE: baska sahip, none modu, idle, paid, FEE_CHANGED, sonlu durumlar', async () => {
    const env = makeEnv([
      mkRec({}, { uid: UID, owner: OTHER }),
      mkRec({ mode: 'none' }, { uid: UID2 }),
      mkRec({ state: 'idle' }, { uid: UID3 }),
      mkRec({ state: 'paid' }, { uid: '0x' + '01'.repeat(56) }),
      mkRec({ state: 'void' }, { uid: '0x' + '02'.repeat(56) }),
      mkRec({ state: 'blocked', blocker: 'FEE_CHANGED' }, { uid: '0x' + '03'.repeat(56) }),
    ])
    const r = await env.run()
    expect(r.outcome).toBe('NONE')
    expect(env.calls).toEqual([])
    expect(env.getSigner).not.toHaveBeenCalled()
  })
})

describe('settleCowFees: owed tahsilati ve write-ahead (Review Focus 1)', () => {
  it('Review Focus 1: tam olay sirasi, SEND_START execute den ONCE', async () => {
    const env = makeEnv([mkRec()])
    const r = await env.run()
    expect(r).toEqual({ outcome: 'PAID', uid: UID })
    expect(env.calls).toEqual([
      'status',
      'quote',
      'balance',
      'nonce',
      'block',
      'patch:SEND_START',
      'execute',
      'patch:RELAYED',
      'receipt',
      'patch:PAID',
    ])
  })

  it('write-ahead kaydi: sending + nonce/startBlock/callDataHash kalici, sonra paid + iade claimable', async () => {
    const env = makeEnv([mkRec()])
    let seenAtExecute
    env.ats.execute.mockImplementationOnce(async () => {
      seenAtExecute = structuredClone(env.store.get(UID))
      return { hash: H1, txHash: H2 }
    })
    await env.run()
    // execute cagrildigi anda kayit ZATEN sending ve op dolu
    expect(seenAtExecute.fee.state).toBe('sending')
    expect(seenAtExecute.fee.op.nonce).toBe('7')
    expect(seenAtExecute.fee.op.startBlock).toBe(1000)
    expect(seenAtExecute.fee.op.callDataHash).toBe(feeCallDataHash(OWNER, UID))
    const fin = env.store.get(UID)
    expect(fin.fee.state).toBe('paid')
    expect(fin.fee.paidTxHash).toBe(H2)
    expect(fin.fee.atsChargedRaw).toBe(FEE)
    expect(fin.fee.op.userOpHash).toBe(H1)
    expect(fin.fee.op.relayTxHash).toBe(H2)
    expect(fin.refund.state).toBe('claimable')
  })

  it('execute argumanlari: ucret cagrisi (to=owner, value=0, data=uid), fixedNonce, signer', async () => {
    const env = makeEnv([mkRec()])
    await env.run()
    const arg = executes(env)[0][0]
    expect(arg.call).toEqual(buildFeeCall(OWNER, UID))
    expect(arg.call.to).toBe(OWNER)
    expect(arg.call.value).toBe(0n)
    expect(arg.call.data).toBe(UID)
    expect(arg.fixedNonce).toBe('7')
    expect(arg.signer).toBe(env.signer)
    expect(arg.quoted).toEqual({ transferFee: FEE })
    expect(env.getSigner).toHaveBeenCalledTimes(1)
  })

  it('SEND_START yazimi reddedilirse execute CAGRILMAZ ve getSigner kullanilmaz sonuc PENDING', async () => {
    const env = makeEnv([mkRec()], { failPatch: 'SEND_START' })
    const r = await env.run()
    expect(r.outcome).toBe('PENDING')
    expect(executes(env)).toHaveLength(0)
    expect(env.store.get(UID).fee.state).toBe('owed')
    expect(env.store.get(UID).fee.op).toBeNull()
  })

  it('SEND_START depoda uygulanmazsa (reconcile {} dondu) execute CAGRILMAZ', async () => {
    const env = makeEnv([mkRec()])
    env.orders.patchOrder.mockImplementation(async (uid) => structuredClone(env.store.get(uid)))
    const r = await env.run()
    expect(r.outcome).toBe('PENDING')
    expect(executes(env)).toHaveLength(0)
  })

  it('oncelik: sending > owed > blocked(yeniden denenebilir); esitlikte createdAt kucuk; tek gonderim', async () => {
    const env = makeEnv(
      [
        mkRec({ state: 'blocked', blocker: 'BALANCE' }, { uid: UID3, createdAt: 1 }),
        mkRec({ state: 'owed' }, { uid: UID2, createdAt: 50 }),
        mkRec({ state: 'owed' }, { uid: UID, createdAt: 20 }),
      ],
      {},
    )
    const r = await env.run()
    expect(r.uid).toBe(UID) // owed ve createdAt kucuk
    expect(executes(env)).toHaveLength(1)
    // ikinci tikte siradaki owed
    const r2 = await env.run()
    expect(r2.uid).toBe(UID2)
    // ucuncu tikte blocked/BALANCE (op yok) engel kalkmis -> UNBLOCK + gonderim
    const r3 = await env.run()
    expect(r3.uid).toBe(UID3)
    expect(executes(env)).toHaveLength(3)
  })

  it('sending adayi owed adayindan ONCE islenir (resolve cagrilir, owed a dokunulmaz)', async () => {
    const env = makeEnv(
      [
        mkRec({ state: 'owed' }, { uid: UID2, createdAt: 1 }),
        mkRec({ state: 'sending', op: mkOp() }, { uid: UID, createdAt: 99 }),
      ],
      { resolve: async () => ({ result: 'UNKNOWN', reason: 'RPC' }) },
    )
    const r = await env.run()
    expect(r).toMatchObject({ outcome: 'PENDING', uid: UID })
    expect(executes(env)).toHaveLength(0)
    expect(env.store.get(UID2).fee.state).toBe('owed')
  })
})

describe('settleCowFees: cift ucret katmanlari (op dolu kayit)', () => {
  const stuckBlockers = ['NO_SERVICE', 'BALANCE', 'APPROVAL', 'COMMISSION']

  it('blocked + op: SEND_START ASLA yazilmaz, resolve cagrilir (her yeniden denenebilir engel)', async () => {
    for (const blocker of stuckBlockers) {
      const env = makeEnv([mkRec({ state: 'blocked', blocker, op: mkOp() })])
      const r = await env.run()
      expect(r.outcome).toBe('PENDING') // resolve UNKNOWN
      expect(env.resolve).toHaveBeenCalledTimes(1)
      expect(events(env)).not.toContain('SEND_START')
      expect(executes(env)).toHaveLength(0)
    }
  })

  it('blocked + op: resolve=PAID -> UNBLOCK + PAID, execute yok', async () => {
    const env = makeEnv([mkRec({ state: 'blocked', blocker: 'NO_SERVICE', op: mkOp() })], {
      resolve: async () => ({ result: 'PAID', paidTxHash: H3, atsChargedRaw: FEE }),
    })
    const r = await env.run()
    expect(r).toEqual({ outcome: 'PAID', uid: UID })
    expect(events(env)).toEqual(['UNBLOCK', 'PAID'])
    expect(executes(env)).toHaveLength(0)
    expect(env.store.get(UID).fee.state).toBe('paid')
    expect(env.store.get(UID).fee.paidTxHash).toBe(H3)
  })

  it('blocked + op: resolve=NOT_LANDED -> engel yoksa UNBLOCK + AYNI nonce ile gonderim (SEND_START yok)', async () => {
    const env = makeEnv([mkRec({ state: 'blocked', blocker: 'BALANCE', op: mkOp({ nonce: '12' }) })], {
      resolve: async () => ({ result: 'NOT_LANDED' }),
    })
    await env.run()
    expect(events(env)).not.toContain('SEND_START')
    expect(events(env)[0]).toBe('UNBLOCK')
    expect(executes(env)).toHaveLength(1)
    expect(executes(env)[0][0].fixedNonce).toBe('12')
    expect(env.chain.readNonce).not.toHaveBeenCalled()
  })

  it('blocked + op: NOT_LANDED ama engel suruyor -> yeniden BLOCK, execute ve getSigner yok', async () => {
    const env = makeEnv([mkRec({ state: 'blocked', blocker: 'BALANCE', op: mkOp() })], {
      resolve: async () => ({ result: 'NOT_LANDED' }),
      readAtsBalance: async () => 1n,
    })
    const r = await env.run()
    expect(r).toEqual({ outcome: 'BLOCKED', uid: UID, code: 'BALANCE' })
    expect(executes(env)).toHaveLength(0)
    expect(env.getSigner).not.toHaveBeenCalled()
    expect(env.store.get(UID).fee.op.nonce).toBe('7')
  })

  it('execute firlatip BLOCK yazdiktan sonra op zincirdeyse ikinci execute YOK', async () => {
    const env = makeEnv([mkRec()], {
      execute: async () => {
        const e = new Error('upstream')
        e.status = 503
        throw e
      },
    })
    const r1 = await env.run()
    expect(r1).toEqual({ outcome: 'BLOCKED', uid: UID, code: 'NO_SERVICE' })
    expect(env.store.get(UID).fee.state).toBe('blocked')
    expect(env.store.get(UID).fee.op).not.toBeNull() // op KORUNUR
    // op aslinda zincire inmis
    env.resolve.mockImplementation(async () => ({ result: 'PAID', paidTxHash: H3, atsChargedRaw: FEE }))
    const r2 = await env.run()
    expect(r2.outcome).toBe('PAID')
    expect(executes(env)).toHaveLength(1)
  })

  it('FEE_STUCK: aday degil, resolve=PAID -> UNBLOCK + PAID', async () => {
    const env = makeEnv([mkRec({ state: 'blocked', blocker: 'FEE_STUCK', op: mkOp() })], {
      resolve: async () => ({ result: 'PAID', paidTxHash: H3, atsChargedRaw: FEE }),
    })
    const r = await env.run()
    expect(r).toEqual({ outcome: 'PAID', uid: UID })
    expect(events(env)).toEqual(['UNBLOCK', 'PAID'])
    expect(env.store.get(UID).fee.state).toBe('paid')
    expect(env.getSigner).not.toHaveBeenCalled()
    expect(executes(env)).toHaveLength(0)
  })

  it('FEE_STUCK: diger her sonucta FEE_STUCK kalir, execute/getSigner/status/quote 0', async () => {
    for (const res of [
      { result: 'UNKNOWN', reason: 'RPC' },
      { result: 'NOT_LANDED' },
      { result: 'NOT_BOUND_PROVEN', txHash: H3 },
    ]) {
      const env = makeEnv([mkRec({ state: 'blocked', blocker: 'FEE_STUCK', op: mkOp() })], {
        resolve: async () => res,
      })
      const r = await env.run()
      expect(r.outcome).toBe('NONE')
      expect(executes(env)).toHaveLength(0)
      expect(env.getSigner).not.toHaveBeenCalled()
      expect(env.ats.status).not.toHaveBeenCalled()
      expect(env.ats.quote).not.toHaveBeenCalled()
      expect(env.chain.readNonce).not.toHaveBeenCalled()
      expect(env.orders.patchOrder).not.toHaveBeenCalled()
      expect(env.store.get(UID).fee.blocker).toBe('FEE_STUCK')
    }
  })

  it('FEE_STUCK cozumlemesi baska bir adayin gonderimini engellemez ama kendisi gonderilmez', async () => {
    const env = makeEnv(
      [
        mkRec({ state: 'blocked', blocker: 'FEE_STUCK', op: mkOp() }, { uid: UID2 }),
        mkRec({ state: 'owed' }, { uid: UID, createdAt: 5 }),
      ],
      { resolve: async () => ({ result: 'UNKNOWN', reason: 'RPC' }) },
    )
    const r = await env.run()
    expect(r).toEqual({ outcome: 'PAID', uid: UID })
    expect(executes(env)).toHaveLength(1)
    expect(executes(env)[0][0].call.data).toBe(UID)
  })

  it('sending + NOT_LANDED: AYNI nonce ile execute, RESEND yazilir', async () => {
    const env = makeEnv([mkRec({ state: 'sending', op: mkOp({ nonce: '9' }) })], {
      resolve: async () => ({ result: 'NOT_LANDED' }),
    })
    const r = await env.run()
    expect(r.outcome).toBe('PAID')
    expect(events(env)[0]).toBe('RESEND')
    expect(events(env)).not.toContain('SEND_START')
    expect(executes(env)).toHaveLength(1)
    expect(executes(env)[0][0].fixedNonce).toBe('9')
    expect(env.chain.readNonce).not.toHaveBeenCalled() // yeni nonce OKUNMAZ
    expect(env.store.get(UID).fee.op.attempts).toBe(2)
  })

  it('sending + UNKNOWN: hicbir sey gonderilmez, getSigner cagrilmaz', async () => {
    const env = makeEnv([mkRec({ state: 'sending', op: mkOp() })], {
      resolve: async () => ({ result: 'UNKNOWN', reason: 'EVENT_NOT_FOUND' }),
    })
    const r = await env.run()
    expect(r).toMatchObject({ outcome: 'PENDING', uid: UID })
    expect(executes(env)).toHaveLength(0)
    expect(env.getSigner).not.toHaveBeenCalled()
    expect(events(env)).toEqual([])
    expect(env.logs.length).toBeGreaterThan(0) // neden gunluge yazilir
  })

  it('sending + NOT_BOUND_PROVEN: once RENONCE (yeni nonce) sonra execute(yeni nonce)', async () => {
    const env = makeEnv([mkRec({ state: 'sending', op: mkOp({ nonce: '7' }) })], {
      resolve: async () => ({ result: 'NOT_BOUND_PROVEN', txHash: H3 }),
      readNonce: async () => 8n,
      readBlockNumber: async () => 1234,
    })
    const r = await env.run()
    expect(r.outcome).toBe('PAID')
    const iR = env.calls.indexOf('patch:RENONCE')
    const iE = env.calls.indexOf('execute')
    expect(iR).toBeGreaterThan(-1)
    expect(iR).toBeLessThan(iE)
    expect(executes(env)[0][0].fixedNonce).toBe('8')
    expect(env.store.get(UID).fee.op.nonce).toBe('8')
    expect(env.store.get(UID).fee.op.startBlock).toBe(1234)
  })

  it('RENONCE yazimi reddedilirse execute YOK', async () => {
    const env = makeEnv([mkRec({ state: 'sending', op: mkOp() })], {
      resolve: async () => ({ result: 'NOT_BOUND_PROVEN', txHash: H3 }),
      readNonce: async () => 8n,
      failPatch: 'RENONCE',
    })
    const r = await env.run()
    expect(r.outcome).toBe('PENDING')
    expect(executes(env)).toHaveLength(0)
  })

  it('execute NONCE_CHANGED firlatirsa PENDING, ikinci execute YOK (sonraki tik resolve)', async () => {
    const env = makeEnv([mkRec()], {
      execute: async () => {
        const e = new Error('x')
        e.code = 'NONCE_CHANGED'
        throw e
      },
    })
    const r1 = await env.run()
    expect(r1).toMatchObject({ outcome: 'PENDING', uid: UID })
    expect(env.store.get(UID).fee.state).toBe('sending')
    const r2 = await env.run() // resolve UNKNOWN
    expect(r2.outcome).toBe('PENDING')
    expect(executes(env)).toHaveLength(1)
    expect(env.resolve).toHaveBeenCalledTimes(1)
  })

  it('RESEND siniri asilinca FEE_STUCK ve execute YOK', async () => {
    const env = makeEnv([mkRec({ state: 'sending', op: mkOp({ attempts: 6 }) })], {
      resolve: async () => ({ result: 'NOT_LANDED' }),
    })
    const r = await env.run()
    expect(r).toEqual({ outcome: 'BLOCKED', uid: UID, code: 'FEE_STUCK' })
    expect(executes(env)).toHaveLength(0)
    expect(env.store.get(UID).fee.blocker).toBe('FEE_STUCK')
    expect(env.store.get(UID).fee.op.nonce).toBe('7')
  })

  it('sending + relayTxHash: makbuz PAID ise resolve cagrilmaz', async () => {
    const env = makeEnv([mkRec({ state: 'sending', op: mkOp({ relayTxHash: H2, userOpHash: H1 }) })])
    const r = await env.run()
    expect(r.outcome).toBe('PAID')
    expect(env.resolve).not.toHaveBeenCalled()
    expect(executes(env)).toHaveLength(0)
    expect(env.receipt.mock.calls[0][0]).toMatchObject({ txHash: H2, owner: OWNER, uid: UID, nonce: '7' })
  })

  it('sending + relayTxHash: makbuz PAID degilse resolve e duser', async () => {
    const env = makeEnv([mkRec({ state: 'sending', op: mkOp({ relayTxHash: H2 }) })], {
      receipt: async () => ({ status: 'NOT_FOUND' }),
    })
    const r = await env.run()
    expect(r.outcome).toBe('PENDING')
    expect(env.resolve).toHaveBeenCalledTimes(1)
    expect(executes(env)).toHaveLength(0)
  })

  it('sending + resolve=PAID: PAID olayi, execute yok', async () => {
    const env = makeEnv([mkRec({ state: 'sending', op: mkOp() })], {
      resolve: async () => ({ result: 'PAID', paidTxHash: H3, atsChargedRaw: '5' }),
    })
    const r = await env.run()
    expect(r.outcome).toBe('PAID')
    expect(env.store.get(UID).fee.atsChargedRaw).toBe('5')
    expect(executes(env)).toHaveLength(0)
  })

  it('sending ama op yok (bozuk kayit): hicbir sey gonderilmez', async () => {
    const env = makeEnv([mkRec({ state: 'sending', op: null })])
    const r = await env.run()
    expect(r.outcome).toBe('PENDING')
    expect(executes(env)).toHaveLength(0)
    expect(events(env)).toEqual([])
  })
})

describe('settleCowFees: blokaj tablosu', () => {
  const noSigner = (env) => expect(env.getSigner).not.toHaveBeenCalled()

  it('status 503 -> NO_SERVICE; ilk noServiceSince yazilir, ikincide korunur', async () => {
    const down = async () => {
      const e = new Error('503')
      e.status = 503
      throw e
    }
    const env = makeEnv([mkRec()], { status: down })
    const r = await env.run()
    expect(r).toEqual({ outcome: 'BLOCKED', uid: UID, code: 'NO_SERVICE' })
    expect(env.store.get(UID).fee.noServiceSince).toBe(NOW)
    expect(executes(env)).toHaveLength(0)
    noSigner(env)
    // ikinci tik, saat ilerlemis (now sabit) -> deger korunur
    env.store.get(UID).fee.noServiceSince = NOW - 5 * 60_000
    await env.run()
    expect(env.store.get(UID).fee.noServiceSince).toBe(NOW - 5 * 60_000)
  })

  it('basarili status noServiceSince i siler (SERVICE_OK); yokken yazma yapmaz', async () => {
    const env = makeEnv([mkRec({ state: 'owed', noServiceSince: NOW - 1000 })])
    await env.run()
    expect(events(env)[0]).toBe('SERVICE_OK')
    expect(env.store.get(UID).fee.noServiceSince).toBeNull()
    const env2 = makeEnv([mkRec()])
    await env2.run()
    expect(events(env2)).not.toContain('SERVICE_OK')
  })

  it('bootstrap ya da !ready -> APPROVAL', async () => {
    for (const st of [{ ready: true, mode: 'bootstrap' }, { ready: false, mode: 'normal', blocker: 'x' }]) {
      const env = makeEnv([mkRec()], { status: async () => st })
      const r = await env.run()
      expect(r).toEqual({ outcome: 'BLOCKED', uid: UID, code: 'APPROVAL' })
      expect(executes(env)).toHaveLength(0)
      noSigner(env)
      expect(env.ats.quote).not.toHaveBeenCalled()
    }
  })

  it('komisyon > 0 -> COMMISSION ve execute 0', async () => {
    const env = makeEnv([mkRec()], {
      quote: async () => ({ feeRaw: FEE, commissionRaw: '1', quoted: {} }),
    })
    const r = await env.run()
    expect(r).toEqual({ outcome: 'BLOCKED', uid: UID, code: 'COMMISSION' })
    expect(executes(env)).toHaveLength(0)
    noSigner(env)
  })

  it('feeRaw > 1,25 x quoted -> FEE_CHANGED (taze ucret kayda) ve execute 0; tam sinir gecer', async () => {
    const env = makeEnv([mkRec()], {
      quote: async () => ({ feeRaw: '1250000000000001000', commissionRaw: '0', quoted: {} }),
    })
    const r = await env.run()
    expect(r).toEqual({ outcome: 'BLOCKED', uid: UID, code: 'FEE_CHANGED' })
    expect(env.store.get(UID).fee.freshFeeRaw).toBe('1250000000000001000')
    expect(executes(env)).toHaveLength(0)
    noSigner(env)
    const env2 = makeEnv([mkRec()], {
      quote: async () => ({ feeRaw: '1250000000000000000', commissionRaw: '0', quoted: {} }),
    })
    expect((await env2.run()).outcome).toBe('PAID')
  })

  it('bakiye < ucret -> BALANCE, execute 0; esit bakiye gecer', async () => {
    const env = makeEnv([mkRec()], { readAtsBalance: async () => 10n ** 18n - 1n })
    const r = await env.run()
    expect(r).toEqual({ outcome: 'BLOCKED', uid: UID, code: 'BALANCE' })
    expect(executes(env)).toHaveLength(0)
    noSigner(env)
    const env2 = makeEnv([mkRec()], { readAtsBalance: async () => 10n ** 18n })
    expect((await env2.run()).outcome).toBe('PAID')
  })

  it('blocked(op yok) engel kalkinca UNBLOCK -> SEND_START sirasi, sonra gonderim', async () => {
    const env = makeEnv([mkRec({ state: 'blocked', blocker: 'BALANCE' })])
    const r = await env.run()
    expect(r.outcome).toBe('PAID')
    expect(events(env).slice(0, 2)).toEqual(['UNBLOCK', 'SEND_START'])
  })

  it('engel suruyorsa blocked(op yok) kaydi blocked kalir, anahtar istenmez', async () => {
    const env = makeEnv([mkRec({ state: 'blocked', blocker: 'COMMISSION' })], {
      quote: async () => ({ feeRaw: FEE, commissionRaw: '5', quoted: {} }),
    })
    const r = await env.run()
    expect(r.outcome).toBe('BLOCKED')
    expect(env.store.get(UID).fee.state).toBe('blocked')
    noSigner(env)
  })
})

describe('settleCowFees: execute hata eslemesi ve makbuz', () => {
  const failWith = (props) => async () => {
    const e = new Error('ham mesaj kayda GIRMEMELI')
    Object.assign(e, props)
    throw e
  }

  it('hata kodu -> engel tablosu', async () => {
    const cases = [
      [{ code: 'balance-missing' }, 'BALANCE'],
      [{ code: 'src-balance-missing' }, 'BALANCE'],
      [{ code: 'src-allowance-missing' }, 'APPROVAL'],
      [{ code: 'FIXED_NONCE_NEEDS_BOOTSTRAP' }, 'APPROVAL'],
      [{ code: 'commission-missing' }, 'COMMISSION'],
      [{ status: 503 }, 'NO_SERVICE'],
      [{ code: 'rate-stale' }, 'NO_SERVICE'], // operator
      [{ code: 'route-value-unreadable' }, 'NO_SERVICE'], // transient
    ]
    for (const [props, blocker] of cases) {
      const env = makeEnv([mkRec()], { execute: failWith(props) })
      const r = await env.run()
      expect(r, JSON.stringify(props)).toEqual({ outcome: 'BLOCKED', uid: UID, code: blocker })
      expect(env.store.get(UID).fee.blocker).toBe(blocker)
      expect(env.store.get(UID).fee.op).not.toBeNull()
    }
  })

  it('agi/zaman asimi hatasi -> NO_SERVICE', async () => {
    for (const make of [() => new TypeError('fetch failed'), () => Object.assign(new Error('t'), { name: 'AbortError' })]) {
      const env = makeEnv([mkRec()], {
        execute: async () => {
          throw make()
        },
      })
      expect((await env.run()).code).toBe('NO_SERVICE')
    }
  })

  it('bilinmeyen (kodsuz) hata -> sending kalir, PENDING, yeni op yok', async () => {
    const env = makeEnv([mkRec()], { execute: failWith({}) })
    const r = await env.run()
    expect(r).toMatchObject({ outcome: 'PENDING', uid: UID })
    expect(env.store.get(UID).fee.state).toBe('sending')
    const r2 = await env.run() // resolve UNKNOWN
    expect(r2.outcome).toBe('PENDING')
    expect(executes(env)).toHaveLength(1)
  })

  it('hata mesaji / nesnesi kayda ve gunluge YAZILMAZ', async () => {
    const env = makeEnv([mkRec()], { execute: failWith({ code: 'balance-missing', status: 400 }) })
    await env.run()
    expect(JSON.stringify(env.store.get(UID))).not.toContain('ham mesaj')
    expect(JSON.stringify(env.logs)).not.toContain('ham mesaj')
  })

  it('PAID yalniz makbuz PAID ise: execute dondu ama makbuz NOT_FOUND -> sending', async () => {
    const env = makeEnv([mkRec()], { receipt: async () => ({ status: 'NOT_FOUND' }) })
    const r = await env.run()
    expect(r.outcome).toBe('PENDING')
    expect(env.store.get(UID).fee.state).toBe('sending')
    expect(events(env)).not.toContain('PAID')
  })

  it('makbuz NO_SPONSORED_EVENT/NOT_BOUND/REVERTED/UNSUPPORTED_WRAPPER -> sending kalir, yeni op yok', async () => {
    for (const status of ['NO_SPONSORED_EVENT', 'NOT_BOUND', 'REVERTED', 'UNSUPPORTED_WRAPPER']) {
      const env = makeEnv([mkRec()], { receipt: async () => ({ status }) })
      const r = await env.run()
      expect(r.outcome).toBe('PENDING')
      expect(env.store.get(UID).fee.state).toBe('sending')
      expect(executes(env)).toHaveLength(1)
      expect(env.logs.length).toBeGreaterThan(0)
    }
  })

  it('makbuz okuma hatasi -> PENDING, sending kalir', async () => {
    const env = makeEnv([mkRec()], {
      receipt: async () => {
        throw new Error('rpc')
      },
    })
    const r = await env.run()
    expect(r.outcome).toBe('PENDING')
    expect(env.store.get(UID).fee.state).toBe('sending')
  })

  it('yeniden gonderimden sonra makbuz henuz yoksa RESENT', async () => {
    const env = makeEnv([mkRec({ state: 'sending', op: mkOp() })], {
      resolve: async () => ({ result: 'NOT_LANDED' }),
      receipt: async () => ({ status: 'NOT_FOUND' }),
    })
    const r = await env.run()
    expect(r.outcome).toBe('RESENT')
  })
})

describe('settleCowFees: anahtar', () => {
  it('getSigner kilitli firlatirsa owed kalir, hicbir yazma ve execute yok, PENDING', async () => {
    const getSigner = vi.fn(async () => {
      throw new Error('locked')
    })
    const env = makeEnv([mkRec()], { getSigner })
    const r = await env.run()
    expect(r.outcome).toBe('PENDING')
    expect(env.store.get(UID).fee.state).toBe('owed')
    expect(executes(env)).toHaveLength(0)
    expect(events(env)).toEqual([])
  })

  it('sending + NOT_LANDED + kilitli anahtar: deneme hakki harcanmaz (RESEND yok), sending kalir', async () => {
    const getSigner = vi.fn(async () => {
      throw new Error('locked')
    })
    const env = makeEnv([mkRec({ state: 'sending', op: mkOp() })], {
      getSigner,
      resolve: async () => ({ result: 'NOT_LANDED' }),
    })
    const r = await env.run()
    expect(r.outcome).toBe('PENDING')
    expect(events(env)).toEqual([])
    expect(env.store.get(UID).fee.op.attempts).toBe(1)
  })

  it('getSigner yalniz gonderim yolunda tam bir kez cagrilir', async () => {
    const env = makeEnv([mkRec()])
    await env.run()
    expect(env.getSigner).toHaveBeenCalledTimes(1)
  })
})

describe('approveFeeChange', () => {
  const changed = (extra = {}) => mkRec({ state: 'blocked', blocker: 'FEE_CHANGED', freshFeeRaw: '2000000000000000000', ...extra })

  it('FEE_CHANGED kaydi taze teklifle onaylar; sonra normal akis gonderir', async () => {
    const env = makeEnv([changed()], {
      quote: async () => ({ feeRaw: '1500000000000000000', commissionRaw: '0', quoted: { transferFee: 'x' } }),
    })
    const r = await env.settler.approveFeeChange({ owner: OWNER, uid: UID })
    expect(r.outcome).not.toBe('NONE')
    const fee = env.store.get(UID).fee
    expect(fee.state).toBe('owed')
    expect(fee.quotedAtsRaw).toBe('1500000000000000000')
    expect(executes(env)).toHaveLength(0) // onay gondermez
    const r2 = await env.run()
    expect(r2.outcome).toBe('PAID')
  })

  it('baska sahip, baska engel, baska durum ya da kayit yok -> NONE ve yazma yok', async () => {
    const cases = [
      [changed(), { owner: OTHER, uid: UID }],
      [mkRec({ state: 'blocked', blocker: 'BALANCE' }), { owner: OWNER, uid: UID }],
      [mkRec({ state: 'owed' }), { owner: OWNER, uid: UID }],
      [changed(), { owner: OWNER, uid: UID2 }],
    ]
    for (const [rec, arg] of cases) {
      const env = makeEnv([rec])
      const r = await env.settler.approveFeeChange(arg)
      expect(r.outcome).toBe('NONE')
      expect(env.orders.patchOrder).not.toHaveBeenCalled()
      expect(env.ats.quote).not.toHaveBeenCalled()
    }
  })

  it('teklif alinamazsa kayit degismez', async () => {
    const env = makeEnv([changed()], {
      quote: async () => {
        throw new Error('down')
      },
    })
    const r = await env.settler.approveFeeChange({ owner: OWNER, uid: UID })
    expect(r.outcome).toBe('PENDING')
    expect(env.store.get(UID).fee.state).toBe('blocked')
  })
})

describe('feeSettle.js kaynak taramasi', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const kaynak = yorumsuz(fs.readFileSync(path.join(dir, 'feeSettle.js'), 'utf8'))

  it('console.log yok; hata mesaji/nesnesi kayda yazilmaz; gizli alan adi yok', () => {
    expect(kaynak).not.toMatch(/console\s*\.\s*(log|error|warn|info|debug)\s*\(/)
    expect(kaynak).not.toMatch(/\.message\b/)
    expect(kaynak).not.toMatch(/privateKey|mnemonic|seedPhrase/i)
  })

  it('getSigner yalniz settle govdesinde bir kez cagrilir; anahtar yalniz signer olarak execute a gecer', () => {
    const cagrilar = kaynak.match(/getSigner\s*\(/g) || []
    expect(cagrilar.length).toBe(1)
    expect(kaynak).toMatch(/signer\s*[,}]/)
  })
})

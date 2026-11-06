import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCowPoller, orderView, POLL_MAX_PER_TICK, TRADES_RETRY_WINDOW_MS } from './poller'
import { newOrderRecord, SUBMIT_GRACE_MS } from './orders'
import { newFeeState } from './fee'
import { COW_RECEIPT_STATUS } from '../processTransaction'
import { yorumsuz } from '../../test-utils/kaynakTarama'

const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const STOCK = '0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const NOW = 1_800_000_000_000
const HASH = '0x' + '77'.repeat(32)
const uidOf = (n) => '0x' + n.toString(16).padStart(2, '0').repeat(56)
const UID = uidOf(0xab)

function mk(over = {}) {
  return newOrderRecord({
    uid: UID,
    chainId: 1,
    owner: OWNER,
    side: 'sell',
    symbol: 'AAPLx',
    sellToken: STOCK,
    buyToken: USDC,
    sellAmount: '1000000000000000000',
    buyAmount: '190000000',
    expectedBuy: '191000000',
    validTo: Math.floor(NOW / 1000) + 1800,
    createdAt: NOW,
    approvalMode: 'none',
    postBody: { signature: '0x' + 'aa'.repeat(65), appData: '{"secret":1}' },
    ...over,
  })
}
const withStatus = (status, over = {}) => ({ ...mk(), status, ...over })

// Bellek ici depo: patchOrder gercek sozlesmeyle ayni (fn(current) -> yama, uid korunur, updatedAt = verilen an)
function makeStore(initial) {
  const list = [...initial]
  const orders = {
    loadOrders: vi.fn(async () => structuredClone(list)),
    patchOrder: vi.fn(async (uid, patchOrFn, at) => {
      const i = list.findIndex((r) => r.uid === uid)
      if (i === -1) return null
      const patch = typeof patchOrFn === 'function' ? patchOrFn(list[i]) : patchOrFn
      if (!patch || Object.keys(patch).length === 0) return list[i]
      list[i] = { ...list[i], ...patch, uid: list[i].uid, updatedAt: at }
      return list[i]
    }),
    removeOrder: vi.fn(async (uid) => {
      const i = list.findIndex((r) => r.uid === uid)
      if (i !== -1) list.splice(i, 1)
    }),
  }
  return { list, orders }
}

const ok = (data) => ({ ok: true, data })
const fail = (code) => ({ ok: false, code })

function setup(records, apiOver = {}, t = { now: NOW }) {
  const store = makeStore(records)
  const api = {
    getOrder: vi.fn(async () => fail('NETWORK')),
    getOrderStatus: vi.fn(async () => fail('NETWORK')),
    getTrades: vi.fn(async () => fail('NETWORK')),
    postOrder: vi.fn(async () => fail('NETWORK')),
    ...apiOver,
  }
  const pendingRows = { resolve: vi.fn(async () => true), remove: vi.fn(async () => {}) }
  const poller = createCowPoller({ api, orders: store.orders, pendingRows, now: () => t.now })
  return { ...store, api, pendingRows, poller, t }
}
const apiCalls = (api) => Object.values(api).reduce((n, f) => n + f.mock.calls.length, 0)

describe('sabitler', () => {
  it('tik tavani 5, trades penceresi 10 dk', () => {
    expect(POLL_MAX_PER_TICK).toBe(5)
    expect(TRADES_RETRY_WINDOW_MS).toBe(600000)
  })
})

describe('aday secimi', () => {
  it('bos kayit listesi: ag istegi yok', async () => {
    const s = setup([])
    expect(await s.poller.pollCowOrders()).toEqual({ polled: 0, results: [] })
    expect(apiCalls(s.api)).toBe(0)
  })

  it('yalniz terminal kayitlar (txHash dolu / pencere disi): ag istegi yok', async () => {
    const s = setup([
      withStatus('fulfilled', { txHash: HASH }),
      withStatus('expired', { uid: uidOf(2) }),
      withStatus('cancelled', { uid: uidOf(3) }),
      withStatus('fulfilled', { uid: uidOf(4), txHash: null, updatedAt: NOW - TRADES_RETRY_WINDOW_MS }),
    ])
    const r = await s.poller.pollCowOrders()
    expect(r).toEqual({ polled: 0, results: [] })
    expect(apiCalls(s.api)).toBe(0)
  })

  it('uids filtresi harf duyarsiz', async () => {
    const a = withStatus('open')
    const b = withStatus('open', { uid: uidOf(2) })
    const s = setup([a, b], { getOrder: vi.fn(async () => ok({ uid: a.uid, status: 'open' })) })
    const buyuk = '0x' + a.uid.slice(2).toUpperCase()
    const r = await s.poller.pollCowOrders({ uids: [buyuk] })
    expect(r.polled).toBe(1)
    expect(s.api.getOrder).toHaveBeenCalledTimes(1)
    expect(s.api.getOrder.mock.calls[0][1]).toBe(a.uid)
  })
})

describe('aday secimi: karisik harfli kayitli uid', () => {
  // kayit karisik harfle saklanmis olsa da (dis kaynak / eski kayit) uids filtresi hangi yazimla gelirse gelsin eslesmeli
  const karisik = (uid) => '0x' + uid.slice(2).split('').map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join('')

  it('kayit karisik harfli, uids kucuk / buyuk / karisik: hepsi ayni kaydi secer; baska kayit secilmez', async () => {
    const a = withStatus('open', { uid: karisik(UID) })
    const b = withStatus('open', { uid: uidOf(2) })
    expect(a.uid).not.toBe(a.uid.toLowerCase())
    for (const istek of [UID.toLowerCase(), '0x' + UID.slice(2).toUpperCase(), karisik(UID).toLowerCase()]) {
      const s = setup([a, b], { getOrder: vi.fn(async () => ok({ uid: a.uid, status: 'open' })) })
      const r = await s.poller.pollCowOrders({ uids: [istek] })
      expect(r.polled).toBe(1)
      expect(s.api.getOrder).toHaveBeenCalledTimes(1)
      expect(s.api.getOrder.mock.calls[0][1]).toBe(a.uid)
    }
  })

  it('uids bos dizi: hicbir kayit secilmez (filtre yok sayilmaz)', async () => {
    const s = setup([withStatus('open', { uid: karisik(UID) })])
    expect(await s.poller.pollCowOrders({ uids: [] })).toEqual({ polled: 0, results: [] })
    expect(apiCalls(s.api)).toBe(0)
  })
})

describe('submitting', () => {
  it('59 sn: WAIT, api yok', async () => {
    const s = setup([mk()], {}, { now: NOW + SUBMIT_GRACE_MS - 1000 })
    const r = await s.poller.pollCowOrders()
    expect(apiCalls(s.api)).toBe(0)
    expect(r.results[0]).toMatchObject({ uid: UID, status: 'submitting' })
  })

  it('61 sn + 200 open: kayit open, postBody null', async () => {
    const s = setup([mk()], { getOrder: vi.fn(async () => ok({ uid: UID, status: 'open' })) }, { now: NOW + 61_000 })
    await s.poller.pollCowOrders()
    expect(s.list[0].status).toBe('open')
    expect(s.list[0].postBody).toBeNull()
    expect(s.api.postOrder).not.toHaveBeenCalled()
  })

  it('404 + validTo gecmis: kayit ve Gecmis satiri silinir', async () => {
    const s = setup(
      [mk({ validTo: Math.floor(NOW / 1000) + 10 })],
      { getOrder: vi.fn(async () => fail('ORDER_NOT_FOUND')) },
      { now: NOW + 120_000 },
    )
    await s.poller.pollCowOrders()
    expect(s.list).toHaveLength(0)
    expect(s.pendingRows.remove).toHaveBeenCalledWith(UID)
    expect(s.api.postOrder).not.toHaveBeenCalled()
  })

  it('Review Focus 4: 404 + repostCount 0: sayac yazimi POST oncesi, sonra open', async () => {
    const sira = []
    const s = setup(
      [mk()],
      {
        getOrder: vi.fn(async () => fail('ORDER_NOT_FOUND')),
        postOrder: vi.fn(async () => {
          sira.push('post')
          return ok(UID)
        }),
      },
      { now: NOW + 61_000 },
    )
    const orijinal = s.orders.patchOrder.getMockImplementation()
    s.orders.patchOrder.mockImplementation(async (uid, p, at) => {
      const r = await orijinal(uid, p, at)
      if (r?.repostCount === 1 && !sira.includes('sayac')) sira.push('sayac')
      return r
    })
    await s.poller.pollCowOrders()
    expect(sira).toEqual(['sayac', 'post'])
    expect(s.api.postOrder).toHaveBeenCalledWith(1, expect.objectContaining({ signature: expect.any(String) }))
    expect(s.list[0]).toMatchObject({ status: 'open', postBody: null, repostCount: 1, lastPostAt: NOW + 61_000 })
  })

  it('postOrder NETWORK: kayit kalir lastError; ikinci tikte 404 WAIT, ikinci POST yok', async () => {
    const s = setup([mk()], { getOrder: vi.fn(async () => fail('ORDER_NOT_FOUND')) }, { now: NOW + 61_000 })
    await s.poller.pollCowOrders()
    expect(s.list[0]).toMatchObject({ status: 'submitting', repostCount: 1, lastError: 'NETWORK' })
    expect(s.api.postOrder).toHaveBeenCalledTimes(1)
    s.t.now = NOW + 61_000 + 61_000
    await s.poller.pollCowOrders()
    expect(s.api.getOrder).toHaveBeenCalledTimes(2)
    expect(s.api.postOrder).toHaveBeenCalledTimes(1)
  })

  it('postOrder duplicated: basari sayilir, open', async () => {
    const s = setup(
      [mk()],
      {
        getOrder: vi.fn(async () => fail('ORDER_NOT_FOUND')),
        postOrder: vi.fn(async () => ({ ok: true, data: null, duplicated: true })),
      },
      { now: NOW + 61_000 },
    )
    await s.poller.pollCowOrders()
    expect(s.list[0]).toMatchObject({ status: 'open', postBody: null })
  })

  it('postOrder kesin red: kayit ve satir silinir', async () => {
    const s = setup(
      [mk()],
      {
        getOrder: vi.fn(async () => fail('ORDER_NOT_FOUND')),
        postOrder: vi.fn(async () => fail('INSUFFICIENT_BALANCE')),
      },
      { now: NOW + 61_000 },
    )
    await s.poller.pollCowOrders()
    expect(s.list).toHaveLength(0)
    expect(s.pendingRows.remove).toHaveBeenCalledWith(UID)
  })

  it('getOrder baska hata: durum ayni, lastError, POST yok', async () => {
    const s = setup([mk()], { getOrder: vi.fn(async () => fail('SERVER')) }, { now: NOW + 61_000 })
    await s.poller.pollCowOrders()
    expect(s.list[0]).toMatchObject({ status: 'submitting', lastError: 'SERVER' })
    expect(s.api.postOrder).not.toHaveBeenCalled()
  })
})

describe('open -> terminal', () => {
  it('fulfilled: getTrades, txHash yazilir, satir 1 + hash ile cozulur', async () => {
    const s = setup([withStatus('open')], {
      getOrder: vi.fn(async () =>
        ok({ uid: UID, status: 'fulfilled', executedSellAmount: '1000000000000000000', executedBuyAmount: '191000000' }),
      ),
      getTrades: vi.fn(async () => ok([{ orderUid: UID, txHash: HASH }])),
    })
    const r = await s.poller.pollCowOrders()
    expect(s.list[0]).toMatchObject({ status: 'fulfilled', txHash: HASH, executedBuyAmount: '191000000' })
    expect(s.pendingRows.resolve).toHaveBeenCalledWith({ uid: UID, receiptStatus: COW_RECEIPT_STATUS.fulfilled, txHash: HASH })
    expect(r.results[0]).toMatchObject({ uid: UID, status: 'fulfilled' })
  })

  it('trades hatasi: kayit fulfilled kalir, satir hashsiz 1; pencerede tamamlanir', async () => {
    const trades = vi.fn(async () => fail('NETWORK'))
    const s = setup([withStatus('open')], {
      getOrder: vi.fn(async () => ok({ uid: UID, status: 'fulfilled' })),
      getTrades: trades,
    })
    await s.poller.pollCowOrders()
    expect(s.list[0]).toMatchObject({ status: 'fulfilled', txHash: null })
    expect(s.pendingRows.resolve).toHaveBeenCalledTimes(1)
    expect(s.pendingRows.resolve.mock.calls[0][0]).toEqual({ uid: UID, receiptStatus: '1', txHash: undefined })

    // 3 dk sonra hala hata: pencere kendi kendini uzatmaz
    s.t.now = NOW + 3 * 60_000
    await s.poller.pollCowOrders()
    expect(trades).toHaveBeenCalledTimes(2)
    expect(s.list[0].updatedAt).toBe(NOW)

    // 5 dk: trades gelir
    s.t.now = NOW + 5 * 60_000
    trades.mockImplementation(async () => ok([{ orderUid: UID, txHash: HASH }]))
    await s.poller.pollCowOrders()
    expect(s.list[0].txHash).toBe(HASH)
    expect(s.pendingRows.resolve).toHaveBeenLastCalledWith({ uid: UID, receiptStatus: '1', txHash: HASH })
    expect(s.api.getOrder).toHaveBeenCalledTimes(1)
  })

  it('trades 11. dakikada hala yok: istek atilmaz', async () => {
    const s = setup([withStatus('open')], {
      getOrder: vi.fn(async () => ok({ uid: UID, status: 'fulfilled' })),
      getTrades: vi.fn(async () => fail('NETWORK')),
    })
    await s.poller.pollCowOrders()
    s.t.now = NOW + 11 * 60_000
    const oncesi = s.api.getTrades.mock.calls.length
    const r = await s.poller.pollCowOrders()
    expect(s.api.getTrades.mock.calls.length).toBe(oncesi)
    expect(r.polled).toBe(0)
  })

  it.each([['expired'], ['cancelled']])('%s: satir cozulur, sonraki tik degistirmez', async (st) => {
    const s = setup([withStatus('open')], { getOrder: vi.fn(async () => ok({ uid: UID, status: st })) })
    await s.poller.pollCowOrders()
    expect(s.list[0].status).toBe(st)
    expect(s.pendingRows.resolve).toHaveBeenCalledWith({ uid: UID, receiptStatus: st })
    const once = structuredClone(s.list)
    s.t.now += 5000
    await s.poller.pollCowOrders()
    expect(s.list).toEqual(once)
    expect(s.api.getOrder).toHaveBeenCalledTimes(1)
  })

  it('UID uyusmazligi: lastError UID_MISMATCH, durum ayni, satir cozulmez', async () => {
    const s = setup([withStatus('open')], { getOrder: vi.fn(async () => ok({ uid: uidOf(9), status: 'fulfilled' })) })
    await s.poller.pollCowOrders()
    expect(s.list[0]).toMatchObject({ status: 'open', lastError: 'UID_MISMATCH' })
    expect(s.pendingRows.resolve).not.toHaveBeenCalled()
    expect(s.api.getTrades).not.toHaveBeenCalled()
  })

  it('open + ORDER_NOT_FOUND: open kalir, dusurulmez (validTo gecmis olsa bile)', async () => {
    const s = setup([withStatus('open', { validTo: Math.floor(NOW / 1000) - 100 })], {
      getOrder: vi.fn(async () => fail('ORDER_NOT_FOUND')),
    })
    await s.poller.pollCowOrders()
    expect(s.list).toHaveLength(1)
    expect(s.list[0]).toMatchObject({ status: 'open', lastError: 'ORDER_NOT_FOUND' })
    expect(s.pendingRows.remove).not.toHaveBeenCalled()
  })
})

describe('withProgress', () => {
  const ayar = () => ({
    getOrder: vi.fn(async () => ok({ uid: UID, status: 'open' })),
    getOrderStatus: vi.fn(async () => ok({ type: 'active' })),
  })

  it('bayrak yok: getOrderStatus cagrilmaz', async () => {
    const s = setup([withStatus('open')], ayar())
    await s.poller.pollCowOrders()
    expect(s.api.getOrderStatus).not.toHaveBeenCalled()
  })

  it('bayrak var + open kalan: apiStatus yamali', async () => {
    const s = setup([withStatus('open')], ayar())
    const r = await s.poller.pollCowOrders({ withProgress: true })
    expect(s.api.getOrderStatus).toHaveBeenCalledTimes(1)
    expect(s.list[0].apiStatus).toBe('active')
    expect(r.results[0].apiStatus).toBe('active')
  })

  it('kayit terminale gecti: getOrderStatus yok; status hatasi sessiz', async () => {
    const s = setup([withStatus('open')], { getOrder: vi.fn(async () => ok({ uid: UID, status: 'expired' })) })
    await s.poller.pollCowOrders({ withProgress: true })
    expect(s.api.getOrderStatus).not.toHaveBeenCalled()
    const s2 = setup([withStatus('open')], { ...ayar(), getOrderStatus: vi.fn(async () => fail('SERVER')) })
    await s2.poller.pollCowOrders({ withProgress: true })
    expect(s2.list[0]).toMatchObject({ status: 'open', lastError: null })
  })
})

describe('hiz ve kesme', () => {
  it('7 aday: yalniz ilk 5 (en eski createdAt once) islenir', async () => {
    const recs = Array.from({ length: 7 }, (_, i) => withStatus('open', { uid: uidOf(i + 1), createdAt: NOW - i * 1000 }))
    const s = setup(recs, { getOrder: vi.fn(async (c, uid) => ok({ uid, status: 'open' })) })
    const r = await s.poller.pollCowOrders()
    expect(r.polled).toBe(POLL_MAX_PER_TICK)
    expect(s.api.getOrder).toHaveBeenCalledTimes(5)
    const sorulan = s.api.getOrder.mock.calls.map((c) => c[1])
    expect(sorulan).toEqual([7, 6, 5, 4, 3].map(uidOf))
  })

  it.each([['RATE_LIMITED'], ['FORBIDDEN']])('%s ikinci kayitta: ucuncuye istek yok, stoppedBy', async (kod) => {
    const recs = [1, 2, 3].map((n) => withStatus('open', { uid: uidOf(n), createdAt: NOW + n }))
    let n = 0
    const s = setup(recs, {
      getOrder: vi.fn(async (c, uid) => (++n === 2 ? fail(kod) : ok({ uid, status: 'open' }))),
    })
    const r = await s.poller.pollCowOrders()
    expect(s.api.getOrder).toHaveBeenCalledTimes(2)
    expect(r.stoppedBy).toBe(kod)
  })

  it('bir kaydin hatasi digerini bozmaz', async () => {
    const recs = [1, 2].map((n) => withStatus('open', { uid: uidOf(n), createdAt: NOW + n }))
    let n = 0
    const s = setup(recs, {
      getOrder: vi.fn(async (c, uid) => {
        if (++n === 1) throw new Error('beklenmeyen')
        return ok({ uid, status: 'open' })
      }),
    })
    const r = await s.poller.pollCowOrders()
    expect(r.polled).toBe(2)
    expect(s.api.getOrder).toHaveBeenCalledTimes(2)
  })
})

describe('tek ucus', () => {
  it('eszamanli iki cagri ayni soz: loadOrders ve getOrder bir kez', async () => {
    const s = setup([withStatus('open')], { getOrder: vi.fn(async () => ok({ uid: UID, status: 'open' })) })
    const p1 = s.poller.pollCowOrders()
    const p2 = s.poller.pollCowOrders({ withProgress: true })
    expect(p2).toBe(p1)
    await Promise.all([p1, p2])
    expect(s.orders.loadOrders).toHaveBeenCalledTimes(1)
    expect(s.api.getOrder).toHaveBeenCalledTimes(1)
    // ucus bitti: yeni cagri yeni ucus
    await s.poller.pollCowOrders()
    expect(s.orders.loadOrders).toHaveBeenCalledTimes(2)
  })

  it('ucus patlasa da firlatmaz ve sonraki cagri yeni ucus baslatir', async () => {
    const s = setup([withStatus('open')], { getOrder: vi.fn(async () => ok({ uid: UID, status: 'open' })) })
    s.orders.loadOrders.mockRejectedValueOnce(new Error('depo'))
    await expect(s.poller.pollCowOrders()).resolves.toEqual({ polled: 0, results: [] })
    const r = await s.poller.pollCowOrders()
    expect(r.polled).toBe(1)
    expect(s.orders.loadOrders).toHaveBeenCalledTimes(2)
  })
})

describe('ucret gecisi (terminal ile tek yazim)', () => {
  const atsFee = () => newFeeState({ mode: 'ats', quotedAtsRaw: '25090000000000000000' })
  const open = (over = {}) => withStatus('open', over)

  it('fulfilled + ats: TEK patchOrder cagrisinda status fulfilled ve fee.state owed', async () => {
    const s = setup([open({ fee: atsFee() })], {
      getOrder: vi.fn(async () => ok({ uid: UID, status: 'fulfilled' })),
      getTrades: vi.fn(async () => ok([{ orderUid: UID, txHash: HASH }])),
    })
    // durum + ucret ayni yamada: fulfilled'a gecirenle ucret yamasini tasiyan cagri AYNI olmali
    await s.poller.pollCowOrders()
    const calls = s.orders.patchOrder.mock.calls
    const durumCagrilari = calls.filter(([, fn]) => {
      if (typeof fn !== 'function') return false
      const y = fn(open({ fee: atsFee() }))
      return y.status === 'fulfilled'
    })
    expect(durumCagrilari).toHaveLength(1)
    const yama = durumCagrilari[0][1](open({ fee: atsFee() }))
    expect(yama.fee.state).toBe('owed')
    expect(yama.fee.mode).toBe('ats')
    // kayit son durumda da tutarli
    expect(s.list[0]).toMatchObject({ status: 'fulfilled' })
    expect(s.list[0].fee.state).toBe('owed')
    // ucret yamasi icin ayri bir patchOrder cagrisi yok
    const feeYazan = calls.filter(([, fn]) => {
      const y = typeof fn === 'function' ? fn(open({ fee: atsFee() })) : fn
      return y && y.fee && !y.status
    })
    expect(feeYazan).toHaveLength(0)
  })

  it('expired|cancelled + ats: fee.state void (ATS alinmaz)', async () => {
    for (const st of ['expired', 'cancelled']) {
      const s = setup([open({ fee: atsFee() })], { getOrder: vi.fn(async () => ok({ uid: UID, status: st })) })
      await s.poller.pollCowOrders()
      expect(s.list[0].status).toBe(st)
      expect(s.list[0].fee.state).toBe('void')
    }
  })

  it('fulfilled + none: fee yamasi YOK, fee nesnesi degismez', async () => {
    const rec = open()
    const once = structuredClone(rec.fee)
    const s = setup([rec], {
      getOrder: vi.fn(async () => ok({ uid: UID, status: 'fulfilled' })),
      getTrades: vi.fn(async () => ok([{ orderUid: UID, txHash: HASH }])),
    })
    await s.poller.pollCowOrders()
    expect(s.list[0].status).toBe('fulfilled')
    expect(s.list[0].fee).toEqual(once)
    const yama = s.orders.patchOrder.mock.calls
      .map(([, fn]) => (typeof fn === 'function' ? fn(rec) : fn))
      .find((y) => y && y.status === 'fulfilled')
    expect(Object.keys(yama)).not.toContain('fee')
  })

  it('Faz 2 kaydi (fee alani yok) fulfilled: calisir, fee eklenmez', async () => {
    const rec = open()
    delete rec.fee
    delete rec.refund
    const s = setup([rec], {
      getOrder: vi.fn(async () => ok({ uid: UID, status: 'fulfilled' })),
      getTrades: vi.fn(async () => ok([{ orderUid: UID, txHash: HASH }])),
    })
    await s.poller.pollCowOrders()
    expect(s.list[0].status).toBe('fulfilled')
    expect('fee' in s.list[0]).toBe(false)
  })

  it('hala open: ucret yamasi yok', async () => {
    const s = setup([open({ fee: atsFee() })], { getOrder: vi.fn(async () => ok({ uid: UID, status: 'open' })) })
    await s.poller.pollCowOrders()
    expect(s.list[0].fee.state).toBe('idle')
  })

  it('ag cagri sayisi Faz 2 ile ayni: fulfilled icin getOrder 1 + getTrades 1, baska istek yok', async () => {
    const mkApi = () => ({
      getOrder: vi.fn(async () => ok({ uid: UID, status: 'fulfilled' })),
      getTrades: vi.fn(async () => ok([{ orderUid: UID, txHash: HASH }])),
    })
    const a = setup([open()], mkApi())
    const b = setup([open({ fee: atsFee() })], mkApi())
    await a.poller.pollCowOrders()
    await b.poller.pollCowOrders()
    expect(apiCalls(b.api)).toBe(apiCalls(a.api))
    expect(apiCalls(b.api)).toBe(2)
    expect(b.api.postOrder).not.toHaveBeenCalled()
  })

  it('terminal kayit tekrar islenmez: owed iken ikinci tik fee degistirmez', async () => {
    const s = setup([open({ fee: atsFee() })], {
      getOrder: vi.fn(async () => ok({ uid: UID, status: 'fulfilled' })),
      getTrades: vi.fn(async () => ok([{ orderUid: UID, txHash: HASH }])),
    })
    await s.poller.pollCowOrders()
    const once = structuredClone(s.list[0].fee)
    s.t.now += 5000
    await s.poller.pollCowOrders()
    expect(s.list[0].fee).toEqual(once)
  })
})

describe('orderView ve kaynak', () => {
  it('postBody / appData yok, JSON.stringify gecer', () => {
    const v = orderView({ ...mk(), appData: '{"x":1}', txHash: HASH })
    expect(Object.keys(v)).not.toContain('postBody')
    expect(Object.keys(v)).not.toContain('appData')
    expect(() => JSON.stringify(v)).not.toThrow()
    expect(v).toMatchObject({
      uid: UID,
      chainId: 1,
      side: 'sell',
      symbol: 'AAPLx',
      status: 'submitting',
      sellAmount: '1000000000000000000',
      txHash: HASH,
      approvalMode: 'none',
    })
    expect(JSON.stringify(v)).not.toContain('secret')
  })

  it('kaynak: featureFlags, XSTOCKS_ENABLED, console., fetch( yok', () => {
    const kaynak = yorumsuz(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'poller.js'), 'utf8'))
    for (const yasak of ['featureFlags', 'XSTOCKS_ENABLED', 'XSTOCKS_ATS_FEE_ENABLED', 'console.', 'fetch(']) {
      expect(kaynak.includes(yasak), yasak).toBe(false)
    }
  })
})

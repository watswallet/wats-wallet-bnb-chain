import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COW_ORDERS } from '../txStorage'
import { TERMINAL_RETENTION_MS, FEE_STUCK_MARK_MS } from './config'
import { newFeeState, newRefundState } from './fee'
import {
  ORDER_STATUS,
  SUBMIT_GRACE_MS,
  isPendingOrder,
  newOrderRecord,
  reconcileOrder,
  applyTrades,
  planSubmitting,
  resolveNotFound,
  reservedAmount,
  pruneOrders,
  hasUnresolvedRefund,
  loadOrders,
  saveOrder,
  patchOrder,
  removeOrder,
} from './orders'
import { yorumsuz } from '../../test-utils/kaynakTarama'

const UID = '0x' + 'ab'.repeat(56)
const UID2 = '0x' + 'cd'.repeat(56)
const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const STOCK = '0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const NOW = 1_800_000_000_000

function fields(over = {}) {
  return {
    uid: UID,
    chainId: 1,
    owner: OWNER,
    side: 'sell',
    symbol: 'AAPLx',
    stockAddress: STOCK,
    payToken: USDC,
    sellToken: STOCK,
    buyToken: USDC,
    sellAmount: '1000000000000000000',
    buyAmount: '190000000',
    expectedBuy: '191000000',
    validTo: Math.floor(NOW / 1000) + 1800,
    createdAt: NOW,
    appDataHash: '0x' + '11'.repeat(32),
    approvalMode: 'none',
    postBody: { signature: '0x' + 'aa'.repeat(65) },
    fees: { network: '0', protocol: '0', partner: '100' },
    ...over,
  }
}
const rec = (over = {}) => newOrderRecord(fields(over))
const as = (status, over = {}) => ({ ...rec(), status, ...over })

// chrome.storage.local taklidi: get/set bilerek bir mikro-gorev yielder (yaris penceresi gercek olsun)
let store
beforeEach(() => {
  store = {}
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async (key) => {
          await Promise.resolve()
          return key in store ? { [key]: structuredClone(store[key]) } : {}
        }),
        set: vi.fn(async (obj) => {
          await Promise.resolve()
          Object.assign(store, structuredClone(obj))
        }),
      },
    },
  }
})

describe('sabitler', () => {
  it('COW_ORDERS anahtari ve durum kumesi', () => {
    expect(COW_ORDERS).toBe('cow_orders')
    expect(SUBMIT_GRACE_MS).toBe(60_000)
    expect(Object.values(ORDER_STATUS).sort()).toEqual(['cancelled', 'expired', 'fulfilled', 'open', 'submitting'])
    expect(Object.isFrozen(ORDER_STATUS)).toBe(true)
  })

  it('isPendingOrder yalniz submitting ve open icin dogru', () => {
    expect(isPendingOrder({ status: 'submitting' })).toBe(true)
    expect(isPendingOrder({ status: 'open' })).toBe(true)
    for (const s of ['fulfilled', 'expired', 'cancelled', undefined]) expect(isPendingOrder({ status: s })).toBe(false)
    expect(isPendingOrder(null)).toBe(false)
  })
})

describe('newOrderRecord', () => {
  it('gecerli kayit: submitting, sayaclar ve varsayilanlar', () => {
    const r = rec()
    expect(r.status).toBe('submitting')
    expect(r.uid).toBe(UID)
    expect(r.repostCount).toBe(0)
    expect(r.lastPostAt).toBe(NOW)
    expect(r.lastError).toBe(null)
    expect(r.sellAmount).toBe('1000000000000000000')
    expect(r.postBody).toEqual({ signature: '0x' + 'aa'.repeat(65) })
  })

  it('buyuk harfli uid kucultulur', () => {
    const r = rec({ uid: '0x' + 'AB'.repeat(56) })
    expect(r.uid).toBe('0x' + 'ab'.repeat(56))
  })

  it('kisa ya da bozuk uid reddedilir', () => {
    expect(() => rec({ uid: '0x1234' })).toThrow()
    expect(() => rec({ uid: 'ab'.repeat(56) })).toThrow()
    expect(() => rec({ uid: '0x' + 'zz'.repeat(56) })).toThrow()
    expect(() => rec({ uid: undefined })).toThrow()
  })

  it('tutar alani dize degilse reddedilir (BigInt, Number, ondalik, bos)', () => {
    expect(() => rec({ sellAmount: 10n })).toThrow()
    expect(() => rec({ sellAmount: 10 })).toThrow()
    expect(() => rec({ buyAmount: '1.5' })).toThrow()
    expect(() => rec({ buyAmount: '' })).toThrow()
    expect(() => rec({ expectedBuy: 5n })).toThrow()
    expect(() => rec({ fees: { network: 1n, protocol: '0', partner: '0' } })).toThrow()
  })

  it('postBody zorunlu', () => {
    expect(() => rec({ postBody: null })).toThrow()
    expect(() => rec({ postBody: undefined })).toThrow()
  })

  it('kayit chrome.storage icin JSON-serilestirilebilir (BigInt yok)', () => {
    expect(() => JSON.stringify(rec())).not.toThrow()
  })

  it('ucret/iade alanlari: varsayilan fee.mode none, refund.state none', () => {
    const r = rec()
    expect(r.fee).toEqual(newFeeState({ mode: 'none', quotedAtsRaw: null }))
    expect(r.fee.mode).toBe('none')
    expect(r.fee.state).toBe('idle')
    expect(r.refund).toEqual(newRefundState())
    expect(r.refund.state).toBe('none')
  })

  it('verilen ats ucreti ve quotedAtsRaw korunur', () => {
    const fee = newFeeState({ mode: 'ats', quotedAtsRaw: '25090000000000000000' })
    const r = rec({ fee })
    expect(r.fee.mode).toBe('ats')
    expect(r.fee.quotedAtsRaw).toBe('25090000000000000000')
    expect(r.refund.state).toBe('none')
  })

  it('verilen refund korunur', () => {
    const refund = { ...newRefundState(), state: 'claimable', atsRaw: '5' }
    expect(rec({ refund }).refund).toBe(refund)
  })

  it('fee.quotedAtsRaw rakam dizesi degilse reddedilir (BigInt, ondalik)', () => {
    expect(() => rec({ fee: newFeeState({ mode: 'ats', quotedAtsRaw: 25n }) })).toThrow()
    expect(() => rec({ fee: newFeeState({ mode: 'ats', quotedAtsRaw: '1.5' }) })).toThrow()
    expect(() => rec({ fee: newFeeState({ mode: 'ats', quotedAtsRaw: 25 }) })).toThrow()
  })

  it('alan yayilimi fee/refund i ezemez: ucret alanlari yayilimdan SONRA kurulur', () => {
    expect(rec({ fee: undefined, refund: undefined }).fee.mode).toBe('none')
    expect(rec({ fee: null }).fee.mode).toBe('none')
  })
})

describe('reconcileOrder', () => {
  it('submitting + open -> open ve postBody silinir', () => {
    expect(reconcileOrder(as('submitting'), { status: 'open' }, NOW)).toEqual({
      status: 'open',
      apiStatus: 'open',
      postBody: null,
    })
  })

  it('presignaturePending open sayilir', () => {
    expect(reconcileOrder(as('open'), { status: 'presignaturePending' }, NOW)).toEqual({
      status: 'open',
      apiStatus: 'presignaturePending',
      postBody: null,
    })
  })

  it('open + fulfilled -> fulfilled ve yurutulen tutarlar dize', () => {
    const patch = reconcileOrder(
      as('open'),
      { status: 'fulfilled', executedSellAmount: '1000', executedBuyAmount: '2000' },
      NOW,
    )
    expect(patch).toEqual({
      status: 'fulfilled',
      apiStatus: 'traded',
      executedSellAmount: '1000',
      executedBuyAmount: '2000',
      postBody: null,
    })
  })

  it('fulfilled: eksik ya da dize-olmayan tutar kayittaki degeri korur', () => {
    const r = as('open', { executedSellAmount: '7', executedBuyAmount: '8' })
    const patch = reconcileOrder(r, { status: 'fulfilled', executedSellAmount: 55n, executedBuyAmount: undefined }, NOW)
    expect(patch.executedSellAmount).toBe('7')
    expect(patch.executedBuyAmount).toBe('8')
    expect(patch.status).toBe('fulfilled')
  })

  it('submitting + fulfilled dogrudan terminal olur', () => {
    const patch = reconcileOrder(as('submitting'), { status: 'fulfilled', executedSellAmount: '1', executedBuyAmount: '2' }, NOW)
    expect(patch.status).toBe('fulfilled')
  })

  it('open + expired / cancelled', () => {
    expect(reconcileOrder(as('open'), { status: 'expired' }, NOW)).toEqual({ status: 'expired', postBody: null })
    expect(reconcileOrder(as('open'), { status: 'cancelled' }, NOW)).toEqual({ status: 'cancelled', postBody: null })
  })

  it('bilinmeyen durum {} doner ve open varsayilmaz', () => {
    expect(reconcileOrder(as('submitting'), { status: 'wat' }, NOW)).toEqual({})
    expect(reconcileOrder(as('open'), {}, NOW)).toEqual({})
    expect(reconcileOrder(as('open'), null, NOW)).toEqual({})
  })

  it('terminal kayit icin her girdi {} (geri donus yok)', () => {
    const girdiler = [
      { status: 'open' },
      { status: 'expired' },
      { status: 'fulfilled', executedSellAmount: '1' },
      { status: 'cancelled' },
    ]
    for (const t of ['fulfilled', 'expired', 'cancelled']) {
      for (const api of girdiler) {
        expect(reconcileOrder(as(t), api, NOW)).toEqual({})
      }
    }
  })

  it('uid uyusmazligi lastError yazar, durum degismez, open yapilmaz', () => {
    const patch = reconcileOrder(as('submitting'), { uid: UID2, status: 'open' }, NOW)
    expect(patch).toEqual({ lastError: 'UID_MISMATCH', updatedAt: NOW })
    expect(patch.status).toBeUndefined()
  })

  it('uid eslesmesi buyuk/kucuk harf duyarsiz', () => {
    const patch = reconcileOrder(as('submitting'), { uid: '0x' + 'AB'.repeat(56), status: 'open' }, NOW)
    expect(patch.status).toBe('open')
  })
})

describe('planSubmitting / resolveNotFound', () => {
  it('60 sn dolmadan WAIT, dolunca CHECK', () => {
    const r = as('submitting', { lastPostAt: NOW })
    expect(planSubmitting(r, NOW + 59_999)).toBe('WAIT')
    expect(planSubmitting(r, NOW + 60_000)).toBe('CHECK')
  })

  it('lastPostAt yeniden POST sonrasi sayaci sifirlar', () => {
    const r = as('submitting', { createdAt: NOW, lastPostAt: NOW + 100_000 })
    expect(planSubmitting(r, NOW + 120_000)).toBe('WAIT')
    expect(planSubmitting(r, NOW + 160_000)).toBe('CHECK')
  })

  it('lastPostAt yoksa createdAt kullanilir', () => {
    const r = { ...as('submitting'), lastPostAt: undefined }
    expect(planSubmitting(r, NOW + 59_999)).toBe('WAIT')
    expect(planSubmitting(r, NOW + 60_000)).toBe('CHECK')
  })

  it('validTo gecti -> DROP', () => {
    const r = as('submitting', { validTo: 1000, repostCount: 0 })
    expect(resolveNotFound(r, 1000 * 1000)).toBe('DROP')
    expect(resolveNotFound(r, 1000 * 1000 + 1)).toBe('DROP')
  })

  it('validTo gecmedi: repostCount 0 -> REPOST, 1 -> WAIT', () => {
    const base = { validTo: 2000 }
    expect(resolveNotFound(as('submitting', { ...base, repostCount: 0 }), 1_999_999)).toBe('REPOST')
    expect(resolveNotFound(as('submitting', { ...base, repostCount: 1 }), 1_999_999)).toBe('WAIT')
    expect(resolveNotFound(as('submitting', { ...base, repostCount: 2 }), 1_999_999)).toBe('WAIT')
  })
})

describe('applyTrades', () => {
  const HASH = '0x' + '9f'.repeat(32)
  it('uid eslesen kaydin txHash i alinir', () => {
    const trades = [
      { orderUid: UID2, txHash: '0x' + '11'.repeat(32) },
      { orderUid: UID, txHash: HASH },
    ]
    expect(applyTrades(as('open'), trades, NOW)).toEqual({ txHash: HASH, updatedAt: NOW })
  })

  it('uid karsilastirmasi buyuk harfe duyarsiz', () => {
    const trades = [{ orderUid: '0x' + 'AB'.repeat(56), txHash: HASH }]
    expect(applyTrades(as('open'), trades, NOW).txHash).toBe(HASH)
  })

  it('bozuk hash, eslesen kayit yok ve bos dizi {} doner', () => {
    expect(applyTrades(as('open'), [{ orderUid: UID, txHash: '0x12' }], NOW)).toEqual({})
    expect(applyTrades(as('open'), [{ orderUid: UID2, txHash: HASH }], NOW)).toEqual({})
    expect(applyTrades(as('open'), [], NOW)).toEqual({})
    expect(applyTrades(as('open'), null, NOW)).toEqual({})
    expect(applyTrades(as('open'), { not: 'array' }, NOW)).toEqual({})
  })
})

describe('reservedAmount', () => {
  const key = { owner: OWNER, chainId: 1, token: STOCK }
  it('ayni owner/zincir/token daki iki bekleyen toplanir', () => {
    const list = [as('open', { sellAmount: '5' }), as('submitting', { uid: UID2, sellAmount: '7' })]
    expect(reservedAmount(list, key)).toBe(12n)
  })

  it('terminal, baska zincir, baska token ve baska owner sayilmaz (Review Focus 5)', () => {
    const list = [
      as('open', { sellAmount: '5' }),
      as('fulfilled', { sellAmount: '100' }),
      as('expired', { sellAmount: '100' }),
      as('cancelled', { sellAmount: '100' }),
      as('open', { chainId: 42161, sellAmount: '100' }),
      as('open', { sellToken: USDC, sellAmount: '100' }),
      as('open', { owner: '0x' + '22'.repeat(20), sellAmount: '100' }),
    ]
    expect(reservedAmount(list, key)).toBe(5n)
  })

  it('owner/token buyuk-kucuk harf duyarsiz, chainId dize olabilir', () => {
    const list = [as('open', { sellAmount: '9' })]
    expect(reservedAmount(list, { owner: OWNER.toLowerCase(), chainId: '1', token: STOCK.toLowerCase() })).toBe(9n)
  })

  it('bos liste 0n', () => {
    expect(reservedAmount([], key)).toBe(0n)
  })
})

describe('pruneOrders', () => {
  it('8 gunluk terminal atilir, 8 gunluk open/submitting kalir', () => {
    const old = NOW - TERMINAL_RETENTION_MS - 1
    const list = [
      as('fulfilled', { uid: '0x' + '01'.repeat(56), updatedAt: old }),
      as('expired', { uid: '0x' + '02'.repeat(56), updatedAt: old }),
      as('cancelled', { uid: '0x' + '03'.repeat(56), updatedAt: old }),
      as('open', { uid: '0x' + '04'.repeat(56), updatedAt: old }),
      as('submitting', { uid: '0x' + '05'.repeat(56), updatedAt: old }),
    ]
    expect(pruneOrders(list, NOW).map((r) => r.status)).toEqual(['open', 'submitting'])
  })

  it('tam 7 gun terminal henuz atilmaz', () => {
    const list = [as('fulfilled', { updatedAt: NOW - TERMINAL_RETENTION_MS })]
    expect(pruneOrders(list, NOW)).toHaveLength(1)
  })
})

describe('pruneOrders: ucret ve iade', () => {
  const DAY = 24 * 3600 * 1000
  const feeOf = (state, extra = {}) => ({
    ...newFeeState({ mode: 'ats', quotedAtsRaw: '1000' }),
    state,
    ...extra,
  })
  const refundOf = (state) => ({ ...newRefundState(), state })
  const at = (days) => NOW - days * DAY

  it('terminal none kayit 8 gun sonra atilir', () => {
    expect(pruneOrders([as('fulfilled', { updatedAt: at(8) })], NOW)).toEqual([])
  })

  it('owed 8 gun sonra KALIR', () => {
    const r = as('fulfilled', { updatedAt: at(8), fee: feeOf('owed') })
    expect(pruneOrders([r], NOW)).toEqual([r])
  })

  it('sending ve blocked da 8 gun sonra kalir', () => {
    const list = [
      as('fulfilled', { uid: '0x' + '01'.repeat(56), updatedAt: at(8), fee: feeOf('sending') }),
      as('fulfilled', { uid: '0x' + '02'.repeat(56), updatedAt: at(8), fee: feeOf('blocked', { blocker: 'BALANCE' }) }),
    ]
    expect(pruneOrders(list, NOW)).toHaveLength(2)
  })

  it('owed 31 gun: kalir ve blocked/FEE_STUCK olur, op korunur', () => {
    const op = { nonce: '7', callDataHash: '0x' + '11'.repeat(32), startBlock: 5, attempts: 1 }
    const r = as('fulfilled', { updatedAt: at(31), fee: feeOf('owed', { op }) })
    const out = pruneOrders([r], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].fee.state).toBe('blocked')
    expect(out[0].fee.blocker).toBe('FEE_STUCK')
    expect(out[0].fee.op).toEqual(op)
    expect(out[0].fee.mode).toBe('ats')
    // girdi nesnesi degismez (saf)
    expect(r.fee.state).toBe('owed')
  })

  it('tam 30 gun henuz isaretlenmez', () => {
    const r = as('fulfilled', { updatedAt: NOW - FEE_STUCK_MARK_MS, fee: feeOf('owed') })
    expect(pruneOrders([r], NOW)[0].fee.state).toBe('owed')
  })

  it('zaten FEE_STUCK olan kayit aynen kalir', () => {
    const r = as('fulfilled', { updatedAt: at(40), fee: feeOf('blocked', { blocker: 'FEE_STUCK' }) })
    const out = pruneOrders([r], NOW)
    expect(out[0]).toBe(r)
  })

  it('updatedAt yoksa createdAt kullanilir', () => {
    const r = { ...as('fulfilled', { fee: feeOf('owed') }), updatedAt: undefined, createdAt: at(31) }
    expect(pruneOrders([r], NOW)[0].fee.blocker).toBe('FEE_STUCK')
  })

  it('claimable 8 gun kalir, 31 gun atilir', () => {
    const paid = feeOf('paid')
    const r8 = as('fulfilled', { updatedAt: at(8), fee: paid, refund: refundOf('claimable') })
    const r31 = as('fulfilled', { updatedAt: at(31), fee: paid, refund: refundOf('claimable') })
    expect(pruneOrders([r8], NOW)).toHaveLength(1)
    expect(pruneOrders([r31], NOW)).toEqual([])
  })

  it('claiming ve approved da iade hakki gibi saklanir', () => {
    const paid = feeOf('paid')
    const list = [
      as('fulfilled', { uid: '0x' + '01'.repeat(56), updatedAt: at(8), fee: paid, refund: refundOf('claiming') }),
      as('fulfilled', { uid: '0x' + '02'.repeat(56), updatedAt: at(8), fee: paid, refund: refundOf('approved') }),
    ]
    expect(pruneOrders(list, NOW)).toHaveLength(2)
  })

  it('paid + refund.sent 8 gun sonra atilir', () => {
    const r = as('fulfilled', { updatedAt: at(8), fee: feeOf('paid'), refund: refundOf('sent') })
    expect(pruneOrders([r], NOW)).toEqual([])
  })

  it('void ucretli (expired) 8 gun sonra atilir', () => {
    const r = as('expired', { updatedAt: at(8), fee: feeOf('void') })
    expect(pruneOrders([r], NOW)).toEqual([])
  })

  it('open 100 gun kalir', () => {
    const r = as('open', { updatedAt: at(100) })
    expect(pruneOrders([r], NOW)).toEqual([r])
  })

  it('hasUnresolvedRefund: yalniz claimable|claiming|approved', () => {
    for (const st of ['claimable', 'claiming', 'approved']) {
      expect(hasUnresolvedRefund({ refund: refundOf(st) })).toBe(true)
    }
    for (const st of ['none', 'sent', 'rejected']) {
      expect(hasUnresolvedRefund({ refund: refundOf(st) })).toBe(false)
    }
    expect(hasUnresolvedRefund({})).toBe(false)
    expect(hasUnresolvedRefund(null)).toBe(false)
  })
})

describe('depo', () => {
  it('saveOrder ekler, ayni uid yi degistirir', async () => {
    await saveOrder(rec(), NOW)
    await saveOrder(rec({ uid: UID2 }), NOW)
    expect(await loadOrders()).toHaveLength(2)
    await saveOrder({ ...rec(), status: 'open' }, NOW)
    const list = await loadOrders()
    expect(list).toHaveLength(2)
    expect(list.find((r) => r.uid === UID).status).toBe('open')
    expect(store[COW_ORDERS]).toHaveLength(2)
  })

  it('loadOrders bos depoda []', async () => {
    expect(await loadOrders()).toEqual([])
  })

  it('patchOrder fn ile taze kaydi gorur ve updatedAt yazar', async () => {
    await saveOrder(rec(), NOW)
    let gordu
    const out = await patchOrder(
      UID,
      (cur) => {
        gordu = cur
        return { status: 'open', postBody: null }
      },
      NOW + 5,
    )
    expect(gordu.status).toBe('submitting')
    expect(out.status).toBe('open')
    const [saved] = await loadOrders()
    expect(saved.status).toBe('open')
    expect(saved.postBody).toBe(null)
    expect(saved.updatedAt).toBe(NOW + 5)
  })

  it('patchOrder nesne yamasi kabul eder; uid degistirilemez', async () => {
    await saveOrder(rec(), NOW)
    await patchOrder(UID, { lastError: 'X', uid: UID2 }, NOW + 1)
    const [saved] = await loadOrders()
    expect(saved.lastError).toBe('X')
    expect(saved.uid).toBe(UID)
  })

  it('patchOrder bos yamada yazmaz ve updatedAt i ilerletmez', async () => {
    await saveOrder(rec(), NOW)
    store[COW_ORDERS][0].updatedAt = 123
    chrome.storage.local.set.mockClear()
    const out = await patchOrder(UID, () => ({}), NOW + 9)
    expect(out.updatedAt).toBe(123)
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
  })

  it('patchOrder olmayan uid icin null doner ve yazmaz', async () => {
    await saveOrder(rec(), NOW)
    chrome.storage.local.set.mockClear()
    expect(await patchOrder(UID2, { status: 'open' }, NOW)).toBe(null)
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
  })

  it('removeOrder siler', async () => {
    await saveOrder(rec(), NOW)
    await saveOrder(rec({ uid: UID2 }), NOW)
    await removeOrder(UID)
    expect((await loadOrders()).map((r) => r.uid)).toEqual([UID2])
  })

  it('8 gunluk terminal saveOrder ile budanir, 8 gunluk open kalir', async () => {
    const old = NOW - 8 * 24 * 3600 * 1000
    store[COW_ORDERS] = [
      as('fulfilled', { uid: '0x' + '01'.repeat(56), updatedAt: old }),
      as('open', { uid: '0x' + '02'.repeat(56), updatedAt: old }),
    ]
    await saveOrder(rec(), NOW)
    const uids = (await loadOrders()).map((r) => r.uid)
    expect(uids).toContain('0x' + '02'.repeat(56))
    expect(uids).not.toContain('0x' + '01'.repeat(56))
    expect(uids).toContain(UID)
  })

  it('paralel iki patchOrder ikisini de uygular (kayip yazma yok)', async () => {
    await saveOrder(rec(), NOW)
    await saveOrder(rec({ uid: UID2 }), NOW)
    await Promise.all([
      patchOrder(UID, { lastError: 'A' }, NOW + 1),
      patchOrder(UID2, { lastError: 'B' }, NOW + 1),
    ])
    const list = await loadOrders()
    expect(list.find((r) => r.uid === UID).lastError).toBe('A')
    expect(list.find((r) => r.uid === UID2).lastError).toBe('B')
  })

  it('paralel saveOrder ve patchOrder birbirini ezmez', async () => {
    await saveOrder(rec(), NOW)
    await Promise.all([saveOrder(rec({ uid: UID2 }), NOW), patchOrder(UID, { status: 'open' }, NOW + 1)])
    const list = await loadOrders()
    expect(list).toHaveLength(2)
    expect(list.find((r) => r.uid === UID).status).toBe('open')
  })
})

describe('kaynak taramasi', () => {
  const klasor = path.dirname(fileURLToPath(import.meta.url))
  const kaynak = yorumsuz(fs.readFileSync(path.join(klasor, 'orders.js'), 'utf8'))

  it('mutate icinde ag yok: fetch/axios yok, await + api. birlikteligi yok', () => {
    expect(kaynak).not.toMatch(/\bfetch\(/)
    expect(kaynak).not.toMatch(/axios/)
    expect(kaynak.includes('await ') && /\bapi\./.test(kaynak)).toBe(false)
  })

  it('console. yok', () => {
    expect(kaynak).not.toMatch(/console\./)
  })

  it('depo yazimi withStorageList uzerinden: dogrudan chrome.storage get/set yok', () => {
    expect(kaynak).toMatch(/withStorageList\(/)
    expect(kaynak).not.toMatch(/chrome\.storage/)
  })
})

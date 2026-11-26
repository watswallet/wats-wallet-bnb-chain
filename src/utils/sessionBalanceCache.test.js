import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  BALANCE_SNAPSHOT_KEY, snapshotKey, readBalanceSnapshot, writeBalanceSnapshot,
  hydrateBalanceSnapshot, persistBalanceSnapshot, clearSessionCaches,
} from './sessionBalanceCache'

let session
let local
const mkArea = (store) => ({
  get: vi.fn(async (k) => {
    const keys = Array.isArray(k) ? k : [k]
    return Object.fromEntries(keys.filter((x) => x in store).map((x) => [x, store[x]]))
  }),
  set: vi.fn(async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))) }),
  remove: vi.fn(async (k) => { for (const x of (Array.isArray(k) ? k : [k])) delete store[x] }),
})

beforeEach(() => {
  session = {}
  local = {}
  globalThis.chrome = { storage: { session: mkArea(session), local: mkArea(local) } }
})

const KEY = snapshotKey({ accountKey: 'acc-A', chainId: 56, currency: 'usd' })
const rows = () => ({
  '56_0xaa': { amount: 2, price: 3, change: 1.5, value: 6, nowValue: 6, oldValue: 5, error: true, extra: 'x' },
})
const freshUser = (over = {}) => ({
  tokenBalances: {}, usd: 0, percentage: 0, percentageUSD: 0, balancesAccountKey: null, ...over,
})

describe('snapshotKey', () => {
  it('hesap + ag + para birimi ile anahtarlanir, biri eksikse null', () => {
    expect(KEY).toBe('acc-A|56|usd')
    expect(snapshotKey({ accountKey: 'acc-A', chainId: 1, currency: 'usd' })).not.toBe(KEY)
    expect(snapshotKey({ accountKey: 'acc-A', chainId: 56, currency: 'try' })).not.toBe(KEY)
    expect(snapshotKey({ accountKey: 'acc-B', chainId: 56, currency: 'usd' })).not.toBe(KEY)
    expect(snapshotKey({ accountKey: null, chainId: 56, currency: 'usd' })).toBe(null)
    expect(snapshotKey({ accountKey: 'a', chainId: undefined, currency: 'usd' })).toBe(null)
    expect(snapshotKey({ accountKey: 'a', chainId: 56, currency: '' })).toBe(null)
  })
})

describe('depo: YALNIZ chrome.storage.session', () => {
  it('yazar, okur; diske (local) HIC yazmaz; error/bilinmeyen alanlar atilir', async () => {
    await writeBalanceSnapshot(KEY, { tokenBalances: rows(), usd: 6, percentage: 2, percentageUSD: 1 })
    expect(local).toEqual({})
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
    const snap = await readBalanceSnapshot(KEY)
    expect(snap.usd).toBe(6)
    expect(snap.tokenBalances['56_0xaa']).toEqual({ amount: 2, price: 3, change: 1.5, value: 6, nowValue: 6, oldValue: 5 })
  })

  it('baska hesabin / agin / para biriminin kaydi okunmaz', async () => {
    await writeBalanceSnapshot(KEY, { tokenBalances: rows(), usd: 6, percentage: 0, percentageUSD: 0 })
    expect(await readBalanceSnapshot(snapshotKey({ accountKey: 'acc-B', chainId: 56, currency: 'usd' }))).toBe(null)
    expect(await readBalanceSnapshot(snapshotKey({ accountKey: 'acc-A', chainId: 1, currency: 'usd' }))).toBe(null)
    expect(await readBalanceSnapshot(snapshotKey({ accountKey: 'acc-A', chainId: 56, currency: 'try' }))).toBe(null)
  })

  it('depo hatasi YUTULUR', async () => {
    chrome.storage.session.get.mockRejectedValue(new Error('x'))
    chrome.storage.session.set.mockRejectedValue(new Error('x'))
    await expect(readBalanceSnapshot(KEY)).resolves.toBe(null)
    await expect(writeBalanceSnapshot(KEY, { tokenBalances: rows(), usd: 1 })).resolves.toBeUndefined()
  })

  it('kayit sayisi sinirli (eskiler duser)', async () => {
    for (let i = 0; i < 12; i++) {
      await writeBalanceSnapshot(snapshotKey({ accountKey: 'a' + i, chainId: 56, currency: 'usd' }), { tokenBalances: rows(), usd: i })
    }
    expect(Object.keys(session[BALANCE_SNAPSHOT_KEY]).length).toBeLessThanOrEqual(8)
    expect(await readBalanceSnapshot(snapshotKey({ accountKey: 'a11', chainId: 56, currency: 'usd' }))).not.toBe(null)
  })
})

describe('hydrateBalanceSnapshot', () => {
  it('bos depoya son bilinen degeri yazar ve hesabi isaretler', async () => {
    await writeBalanceSnapshot(KEY, { tokenBalances: rows(), usd: 6, percentage: 2, percentageUSD: 1 })
    const user = freshUser()
    const ok = await hydrateBalanceSnapshot(user, { accountKey: 'acc-A', chainId: 56, currency: 'usd', isPrivate: false })
    expect(ok).toBe(true)
    expect(user.usd).toBe(6)
    expect(user.tokenBalances['56_0xaa'].amount).toBe(2)
    expect(user.balancesAccountKey).toBe('acc-A')
  })

  it('GIZLI modda ne okur ne yazar', async () => {
    await writeBalanceSnapshot(KEY, { tokenBalances: rows(), usd: 6 })
    chrome.storage.session.get.mockClear()
    const user = freshUser()
    expect(await hydrateBalanceSnapshot(user, { accountKey: 'acc-A', chainId: 56, currency: 'usd', isPrivate: true })).toBe(false)
    expect(user.tokenBalances).toEqual({})
    expect(chrome.storage.session.get).not.toHaveBeenCalled()
  })

  it('canli veri varsa (ya da baska hesap isaretliyse) DOKUNMAZ', async () => {
    await writeBalanceSnapshot(KEY, { tokenBalances: rows(), usd: 6 })
    const live = freshUser({ tokenBalances: { x: { amount: 9 } }, usd: 9, balancesAccountKey: 'acc-A' })
    expect(await hydrateBalanceSnapshot(live, { accountKey: 'acc-A', chainId: 56, currency: 'usd', isPrivate: false })).toBe(false)
    expect(live.usd).toBe(9)
    const other = freshUser({ balancesAccountKey: 'acc-B' })
    expect(await hydrateBalanceSnapshot(other, { accountKey: 'acc-A', chainId: 56, currency: 'usd', isPrivate: false })).toBe(false)
    expect(other.usd).toBe(0)
  })

  it('okuma sirasinda canli tur gelirse onbellek canliyi EZMEZ', async () => {
    await writeBalanceSnapshot(KEY, { tokenBalances: rows(), usd: 6 })
    const user = freshUser()
    const realGet = chrome.storage.session.get.getMockImplementation()
    chrome.storage.session.get.mockImplementation(async (k) => {
      const r = await realGet(k)
      user.tokenBalances = { live: { amount: 1 } }
      user.usd = 77
      return r
    })
    expect(await hydrateBalanceSnapshot(user, { accountKey: 'acc-A', chainId: 56, currency: 'usd', isPrivate: false })).toBe(false)
    expect(user.usd).toBe(77)
  })
})

describe('persistBalanceSnapshot', () => {
  const base = { accountKey: 'acc-A', chainId: 56, currency: 'usd', isPrivate: false, expectedKeys: ['56_0xaa'] }
  const liveUser = (over = {}) => freshUser({ tokenBalances: { '56_0xaa': { amount: 2, value: 6, nowValue: 6, oldValue: 5, price: 3, change: 1 } }, usd: 6, balancesAccountKey: 'acc-A', ...over })

  it('tam turu yazar', async () => {
    expect(await persistBalanceSnapshot(liveUser(), base)).toBe(true)
    expect((await readBalanceSnapshot(KEY)).usd).toBe(6)
  })

  it('GIZLI modda YAZMAZ', async () => {
    expect(await persistBalanceSnapshot(liveUser(), { ...base, isPrivate: true })).toBe(false)
    expect(session[BALANCE_SNAPSHOT_KEY]).toBeUndefined()
  })

  it('YARIM tur yazilmaz: hata isaretli ya da hic okunmamis satir varsa', async () => {
    const withError = liveUser()
    withError.tokenBalances['56_0xaa'].error = true
    expect(await persistBalanceSnapshot(withError, base)).toBe(false)
    expect(await persistBalanceSnapshot(liveUser(), { ...base, expectedKeys: ['56_0xaa', '1_0xbb'] })).toBe(false)
    expect(session[BALANCE_SNAPSHOT_KEY]).toBeUndefined()
  })

  it('sozluk baska hesaba aitse YAZMAZ', async () => {
    expect(await persistBalanceSnapshot(liveUser({ balancesAccountKey: 'acc-B' }), base)).toBe(false)
  })

  it('beklenen satir yoksa yazmaz (bos portfoy onbellegi uydurulmaz)', async () => {
    expect(await persistBalanceSnapshot(liveUser(), { ...base, expectedKeys: [] })).toBe(false)
  })
})

describe('clearSessionCaches (kilit / cikis / sifirlama)', () => {
  it('bakiye anlik goruntusunu ve ATS yakit onbellegini siler; eski diskteki duz metin kopyayi da', async () => {
    session[BALANCE_SNAPSHOT_KEY] = { x: 1 }
    session.ats_fuel_cache = { '0xa': { balance: '1', at: 1 } }
    local.ats_fuel_cache = { '0xa': { balance: '1', at: 1 } }
    local.ats_fee_hints = { 56: { perOp: 1, at: 1 } }
    await clearSessionCaches()
    expect(session[BALANCE_SNAPSHOT_KEY]).toBeUndefined()
    expect(session.ats_fuel_cache).toBeUndefined()
    expect(local.ats_fuel_cache).toBeUndefined()
    // ucret ipuclari bakiye degil; kilitte silinmez
    expect(local.ats_fee_hints).toBeDefined()
  })

  it('depo hatasi YUTULUR (kilit asla bozulmaz)', async () => {
    chrome.storage.session.remove.mockRejectedValue(new Error('x'))
    chrome.storage.local.remove.mockRejectedValue(new Error('x'))
    await expect(clearSessionCaches()).resolves.toBeUndefined()
  })
})

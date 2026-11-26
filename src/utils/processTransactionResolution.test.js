// watchTransactionResolution hata ayrimi: RPC hatasi islemi "basarisiz" YAZMAZ.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { yorumsuz } from '../test-utils/kaynakTarama'

const kaydedilen = []
vi.mock('./txStorage', () => ({
  withStorageList: vi.fn(async (_k, fn) => { fn([]) }),
  PENDING_TRANSACTIONS: 'pending_transactions',
}))

import { watchTransactionResolution, classifyWaitError } from './processTransaction'
import { withStorageList } from './txStorage'

const receipt = (status) => ({
  status, blockNumber: 5, blockHash: '0xbh', index: 1, gasUsed: 21000n, cumulativeGasUsed: 21000n, effectiveGasPrice: 1n,
})
const hata = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra })
const iskelet = () => ({ hash: '0xold', receipt_status: 'pending' })
const yazilanlar = () => withStorageList.mock.calls.length

describe('watchTransactionResolution hata ayrimi', () => {
  beforeEach(() => { withStorageList.mockClear(); kaydedilen.length = 0 })

  it('(a) RPC down: receipt_status 0 OLMAZ, "0" ile kayit yazilmaz, unresolved firlatir', async () => {
    const sk = iskelet()
    const tx = { hash: '0xold', wait: vi.fn().mockRejectedValue(new Error('RPC down')) }
    await expect(watchTransactionResolution(tx, sk)).rejects.toMatchObject({ unresolved: true })
    expect(sk.receipt_status).toBe('pending')
    expect(yazilanlar()).toBe(0)
  })

  it('(b) CALL_EXCEPTION + receipt status 0: "0", receipt DONDURULUR', async () => {
    const sk = iskelet()
    const r = receipt(0)
    const tx = { hash: '0xold', wait: vi.fn().mockRejectedValue(hata('CALL_EXCEPTION', { receipt: r })) }
    const sonuc = await watchTransactionResolution(tx, sk)
    expect(sonuc.status).toBe(0)
    expect(sk.receipt_status).toBe('0')
    expect(sk.block_number).toBe('5')
    expect(yazilanlar()).toBe(1)
  })

  it('CALL_EXCEPTION receipt OLMADAN (eth_call gibi) unresolved sayilir', async () => {
    const sk = iskelet()
    const tx = { hash: '0xold', wait: vi.fn().mockRejectedValue(hata('CALL_EXCEPTION')) }
    await expect(watchTransactionResolution(tx, sk)).rejects.toMatchObject({ unresolved: true })
    expect(sk.receipt_status).toBe('pending')
  })

  it('(c) TRANSACTION_REPLACED cancelled:false: receipt ile cozulur, hash guncellenir', async () => {
    const sk = iskelet()
    const r = receipt(1)
    const tx = { hash: '0xold', wait: vi.fn().mockRejectedValue(hata('TRANSACTION_REPLACED', { cancelled: false, receipt: r, replacement: { hash: '0xnew' } })) }
    const sonuc = await watchTransactionResolution(tx, sk)
    expect(sonuc.status).toBe(1)
    expect(sk.receipt_status).toBe('1')
    expect(sk.hash).toBe('0xnew')
  })

  it('(d) TRANSACTION_REPLACED cancelled:true: "0" yazilir, unresolved DEGIL', async () => {
    const sk = iskelet()
    const tx = { hash: '0xold', wait: vi.fn().mockRejectedValue(hata('TRANSACTION_REPLACED', { cancelled: true, receipt: receipt(1), replacement: { hash: '0xnew' } })) }
    const e = await watchTransactionResolution(tx, sk).catch((x) => x)
    expect(e.unresolved).toBeUndefined()
    expect(sk.receipt_status).toBe('0')
  })

  it('basarili makbuz eskisi gibi doner', async () => {
    const sk = iskelet()
    const tx = { hash: '0xold', wait: vi.fn().mockResolvedValue(receipt(1)) }
    const r = await watchTransactionResolution(tx, sk)
    expect(r.status).toBe(1)
    expect(sk.receipt_status).toBe('1')
  })

  it('classifyWaitError siniflari ayirir', () => {
    expect(classifyWaitError(new Error('x')).kind).toBe('unresolved')
    expect(classifyWaitError(hata('CALL_EXCEPTION', { receipt: receipt(0) })).kind).toBe('reverted')
    expect(classifyWaitError(hata('TRANSACTION_REPLACED', { cancelled: true, receipt: receipt(1), replacement: { hash: '0x1' } })).kind).toBe('cancelled')
    expect(classifyWaitError(hata('TRANSACTION_REPLACED', { cancelled: false, receipt: receipt(1), replacement: { hash: '0x1' } })).kind).toBe('replaced')
  })
})

describe('background.js SEND_TRANSACTION cagiran', () => {
  const kod = yorumsuz(readFileSync(new URL('../background.js', import.meta.url), 'utf8'))
  const i = kod.indexOf('watchTransactionResolution(txResponse, pendingSkeleton)')
  const parca = kod.slice(i, i + 900)

  it('(e) unresolved hatasi karti error yapmaz', () => {
    expect(parca).toMatch(/\.catch\(\(e\) => \{\s*if \(e\?\.unresolved\) return/)
  })
  it('(f) receipt status 0 ONCHAIN_FAILED yazar, catch yalniz iptal/dusme icin TX_DROPPED', () => {
    expect(parca).toContain("receipt.status === 0")
    expect(parca).toContain("txErrorMeta('ONCHAIN_FAILED')")
    expect(parca).toContain("txErrorMeta('TX_DROPPED')")
  })
})

describe('G1b: takas/kopru arka plan yollari', () => {
  const oku = (y) => yorumsuz(readFileSync(new URL(y, import.meta.url), 'utf8'))

  it('takas waitPromise.catch unresolved hatasinda SWAP_EXECUTION_FAILED yazmaz', () => {
    const kod = oku('../background.js')
    const i = kod.indexOf("txErrorMeta('SWAP_EXECUTION_FAILED'")
    expect(kod.slice(i - 250, i)).toContain('if (e?.unresolved) return')
  })
  it('kopru waitPromise.catch unresolved hatasinda BRIDGE_EXECUTION_FAILED yazmaz', () => {
    const kod = oku('../background.js')
    const i = kod.indexOf("txErrorMeta('BRIDGE_EXECUTION_FAILED'")
    expect(kod.slice(i - 250, i)).toContain('if (e?.unresolved) return')
  })
  it('takas ve kopru izleyicileri catch te "0" i dogrudan yazmaz, resolveWaitFailure kullanir', () => {
    const swap = oku('./swap.js')
    const bridge = oku('./bridge.js')
    expect(swap).toContain('resolveWaitFailure(txResponse, skeleton, error)')
    expect(bridge).toContain('resolveWaitFailure(txResponse, skeleton, waitError)')
    expect(swap).not.toMatch(/Swap işlemi başarısız[\s\S]{0,80}receipt_status = "0"/)
  })
  it('revert -> makbuz doner (ONCHAIN_FAILED yolu), RPC hatasi -> unresolved', async () => {
    const { resolveWaitFailure } = await import('./processTransaction')
    const r = receipt(0)
    const sonuc = await resolveWaitFailure({}, iskelet(), hata('CALL_EXCEPTION', { receipt: r }))
    expect(sonuc.status).toBe(0)
    await expect(resolveWaitFailure({}, iskelet(), new Error('RPC down'))).rejects.toMatchObject({ unresolved: true })
  })
})

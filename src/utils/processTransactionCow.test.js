// CoW "Bekliyor" Gecmis satiri (spec 5.6, Review Focus 5): iskelet, cozumleme ve silme yardimcilari.
// chrome.storage.local taklidi: get/set bir mikro-gorev yielder (yaris penceresi gercek olsun).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildCowOrderPendingSkeleton,
  resolveCowPendingRow,
  removeCowPendingRow,
  COW_RECEIPT_STATUS,
} from './processTransaction'
import { GPV2_SETTLEMENT } from './cow/config'
import { isResolved, isStillPending, prunePendingTransactions } from './pendingTransactions'
import { blokGovdesi, yorumsuz } from '../test-utils/kaynakTarama'

const klasor = path.dirname(fileURLToPath(import.meta.url))

const UID = '0x' + 'ab'.repeat(56)
const UID_BUYUK = '0x' + 'AB'.repeat(56)
const OWNER = '0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const USDC = '0xAf88d065e77c8cC2239327C5EDb3A432268e5831'
const XSTOCK = '0x1111111111111111111111111111111111111111'
const NOW = Date.parse('2026-10-14T10:00:00.000Z')
const TX_HASH = '0x' + 'cd'.repeat(32)

const iskelet = (over = {}) => buildCowOrderPendingSkeleton({
  uid: UID, owner: OWNER, chainId: 42161,
  sellToken: USDC, buyToken: XSTOCK,
  sellSymbol: 'USDC', buySymbol: 'TSLAx',
  sellAmountHuman: '100', buyAmountHuman: '0.4',
  now: NOW, ...over,
})

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

describe('buildCowOrderPendingSkeleton', () => {
  it('alanlarin tamami (spec 5.6 Gecmis satiri)', () => {
    expect(iskelet()).toEqual({
      hash: UID,
      nonce: null,
      from_address: OWNER.toLowerCase(),
      to_address: GPV2_SETTLEMENT.toLowerCase(),
      receipt_status: 'pending',
      block_timestamp: new Date(NOW).toISOString(),
      transaction_fee: null,
      category: 'token swap',
      summary: 'Swap 100 USDC to 0.4 TSLAx',
      erc20_transfers: [
        { direction: 'send', token_symbol: 'USDC', token_address: USDC.toLowerCase(), value_formatted: '100' },
        { direction: 'receive', token_symbol: 'TSLAx', token_address: XSTOCK.toLowerCase(), value_formatted: '0.4' },
      ],
      chain_id: 42161,
      source: 'cow',
      cow_uid: UID,
    })
  })

  it('chain_id Number olur ("0x38" ve "56" -> 56); chainId anahtari YOK', () => {
    expect(iskelet({ chainId: '0x38' }).chain_id).toBe(56)
    expect(iskelet({ chainId: '56' }).chain_id).toBe(56)
    expect('chainId' in iskelet()).toBe(false)
  })

  it('cow_uid ve hash kucuk harfli UID ile ayni degerdir (buyuk harf girdi normalize edilir)', () => {
    const s = iskelet({ uid: UID_BUYUK })
    expect(s.hash).toBe(UID)
    expect(s.cow_uid).toBe(UID)
  })

  it('adresler kucuk harf, nonce null, native alanlari yok', () => {
    const s = iskelet()
    expect(s.nonce).toBeNull()
    expect(s.from_address).toBe(s.from_address.toLowerCase())
    expect(s.to_address).toBe(s.to_address.toLowerCase())
    expect(s.erc20_transfers.every((t) => t.token_address === t.token_address.toLowerCase())).toBe(true)
    expect('value' in s).toBe(false)
    expect(s.transaction_fee).toBeNull()
  })

  it('bos sembolde kisa ozet bicimi (buildSwapPendingSkeleton ile ayni kural)', () => {
    expect(iskelet({ sellSymbol: '', buySymbol: 'TSLAx' }).summary).toBe('Swap 100 to 0.4')
    expect(iskelet({ sellSymbol: 'USDC', buySymbol: undefined }).summary).toBe('Swap 100 to 0.4')
  })

  it('uzun ve bosluklu sembol kirpilir', () => {
    const s = iskelet({ sellSymbol: 'U S D C ' + 'X'.repeat(40), buySymbol: 'TS LAx' })
    expect(s.erc20_transfers[0].token_symbol).toBe(('USDC' + 'X'.repeat(40)).slice(0, 16))
    expect(s.erc20_transfers[1].token_symbol).toBe('TSLAx')
    expect(s.summary).toBe(`Swap 100 ${s.erc20_transfers[0].token_symbol} to 0.4 TSLAx`)
  })

  it('Review Focus 5: govdede chainId: anahtari yok (kurtarma yolu pTx.chainId gormez)', () => {
    const kaynak = fs.readFileSync(path.join(klasor, 'processTransaction.js'), 'utf8')
    const govde = blokGovdesi(kaynak, /export function buildCowOrderPendingSkeleton\([^)]*\)/)
    expect(govde).toBeTruthy()
    expect(govde).toContain('chain_id')
    expect(govde).not.toMatch(/chainId\s*:/)
    expect(yorumsuz(kaynak)).toContain('buildCowOrderPendingSkeleton')
  })
})

describe('COW_RECEIPT_STATUS', () => {
  it('uc deger ve dondurulmus', () => {
    expect(COW_RECEIPT_STATUS).toEqual({ fulfilled: '1', expired: 'expired', cancelled: 'cancelled' })
    expect(Object.isFrozen(COW_RECEIPT_STATUS)).toBe(true)
  })
})

describe('resolveCowPendingRow', () => {
  const komsu = { hash: '0xkomsu', receipt_status: 'pending', from_address: OWNER.toLowerCase() }
  beforeEach(() => { store.pending_transactions = [komsu, iskelet()] })

  const satir = () => store.pending_transactions.find((r) => r.cow_uid === UID)

  it('fulfilled + gecerli txHash: hash degisir, receipt_status 1, diger alanlar AYNI', async () => {
    const onceki = iskelet()
    expect(await resolveCowPendingRow({ uid: UID, receiptStatus: COW_RECEIPT_STATUS.fulfilled, txHash: TX_HASH })).toBe(true)
    const s = satir()
    expect(s.hash).toBe(TX_HASH)
    expect(s.receipt_status).toBe('1')
    expect(s.cow_uid).toBe(UID)
    expect(s.erc20_transfers).toEqual(onceki.erc20_transfers)
    expect(s.summary).toBe(onceki.summary)
    expect(s.chain_id).toBe(42161)
    expect(s.source).toBe('cow')
    expect(store.pending_transactions[0]).toEqual(komsu)
    expect(store.pending_transactions).toHaveLength(2)
  })

  it('gecersiz txHash: hash UID kalir, durum yine yazilir', async () => {
    for (const bad of [undefined, null, '', '0x12', 'zz', '0x' + 'g'.repeat(64), UID]) {
      store.pending_transactions = [komsu, iskelet()]
      await resolveCowPendingRow({ uid: UID, receiptStatus: 'expired', txHash: bad })
      expect(satir().hash).toBe(UID)
      expect(satir().receipt_status).toBe('expired')
    }
  })

  it('ikinci cagri (txHash sonradan gelir) satiri cow_uid ile yine bulur', async () => {
    await resolveCowPendingRow({ uid: UID, receiptStatus: 'cancelled' })
    expect(satir().hash).toBe(UID)
    expect(await resolveCowPendingRow({ uid: UID, receiptStatus: '1', txHash: TX_HASH })).toBe(true)
    expect(satir().hash).toBe(TX_HASH)
    expect(satir().cow_uid).toBe(UID)
    expect(satir().receipt_status).toBe('1')
  })

  it('hash degistikten sonra txHash vermeyen cagri onceki hash i korur', async () => {
    await resolveCowPendingRow({ uid: UID, receiptStatus: '1', txHash: TX_HASH })
    await resolveCowPendingRow({ uid: UID, receiptStatus: '1' })
    expect(satir().hash).toBe(TX_HASH)
  })

  it('UID buyuk harfle verilse de (kucuk harfe normalize) satiri bulur', async () => {
    expect(await resolveCowPendingRow({ uid: UID_BUYUK, receiptStatus: '1' })).toBe(true)
    expect(satir().receipt_status).toBe('1')
  })

  it('olmayan UID: false doner, liste degismez, yazma yok', async () => {
    const onceki = structuredClone(store.pending_transactions)
    chrome.storage.local.set.mockClear()
    expect(await resolveCowPendingRow({ uid: '0x' + '99'.repeat(56), receiptStatus: '1' })).toBe(false)
    expect(store.pending_transactions).toEqual(onceki)
    expect(chrome.storage.local.set).not.toHaveBeenCalled()
  })

  it('gecersiz receiptStatus firlatir ve satiri degistirmez', async () => {
    const onceki = structuredClone(store.pending_transactions)
    for (const bad of ['pending', 'failed', '0', '', undefined, null]) {
      await expect(resolveCowPendingRow({ uid: UID, receiptStatus: bad })).rejects.toThrow()
    }
    expect(store.pending_transactions).toEqual(onceki)
  })

  it('cow_uid tasimayan ama hash i UID olan satiri da bulur', async () => {
    store.pending_transactions = [{ hash: UID, receipt_status: 'pending' }]
    expect(await resolveCowPendingRow({ uid: UID, receiptStatus: 'expired' })).toBe(true)
    expect(store.pending_transactions[0].receipt_status).toBe('expired')
  })

  it('es zamanli iki cozumleme birbirini ezmez', async () => {
    await Promise.all([
      resolveCowPendingRow({ uid: UID, receiptStatus: '1', txHash: TX_HASH }),
      resolveCowPendingRow({ uid: UID, receiptStatus: '1' }),
    ])
    expect(satir().hash).toBe(TX_HASH)
  })

  it('Review Focus 5: cozulen satir isResolved, isStillPending degil, prune eler', async () => {
    for (const st of ['1', 'expired', 'cancelled']) {
      store.pending_transactions = [iskelet()]
      await resolveCowPendingRow({ uid: UID, receiptStatus: st })
      const s = satir()
      expect(isResolved(s)).toBe(true)
      expect(isStillPending(s, NOW)).toBe(false)
      expect(prunePendingTransactions([s], NOW)).toEqual([])
    }
  })
})

describe('removeCowPendingRow', () => {
  it('yalniz o satiri siler, komsular kalir', async () => {
    const a = { hash: '0xa', receipt_status: 'pending' }
    const b = { hash: '0xb', receipt_status: 'pending' }
    store.pending_transactions = [a, iskelet(), b]
    await removeCowPendingRow(UID)
    expect(store.pending_transactions).toEqual([a, b])
  })

  it('olmayan UID listeyi degistirmez', async () => {
    const a = { hash: '0xa', receipt_status: 'pending' }
    store.pending_transactions = [a]
    await removeCowPendingRow('0x' + '77'.repeat(56))
    expect(store.pending_transactions).toEqual([a])
  })

  it('UID buyuk harfle verilse de siler (kucuk harfe normalize)', async () => {
    store.pending_transactions = [iskelet()]
    await removeCowPendingRow(UID_BUYUK)
    expect(store.pending_transactions).toEqual([])
  })
})

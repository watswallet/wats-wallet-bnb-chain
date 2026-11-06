// cow/feeRuntime.js (plan Task 10): ucret/iade akisinin arka plan baglantisi. Burada yalniz durum gorunumu
// (statusFor) ve kaynak taramasi sinanir; settler / claimer kendi dosyalarinda sinanir.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { createFeeRuntime } from './feeRuntime'
import { getAtsConfig } from '../atsConfig'
import { feeDebtLock, newFeeState, newRefundState, FEE_STATE } from './fee'

const zincir = vi.hoisted(() => ({ bakiye: vi.fn() }))
vi.mock('./feeChain', async (importOriginal) => ({
  ...(await importOriginal()),
  readTokenBalance: (...a) => zincir.bakiye(...a),
}))

const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BASKA = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const uidOf = (n) => '0x' + n.toString(16).padStart(2, '0').repeat(56)
const NOW = 1_800_000_000_000

function kayit(n, { owner = OWNER, state = FEE_STATE.OWED, mode = 'ats', refund = null } = {}) {
  const fee = { ...newFeeState({ mode, quotedAtsRaw: '1000' }), state }
  if (mode === 'ats') {
    fee.op = {
      nonce: '77', callDataHash: '0x' + 'cd'.repeat(32), startBlock: 5, relayTxHash: '0x' + 'ee'.repeat(32),
    }
  }
  return {
    uid: uidOf(n),
    owner,
    chainId: 56,
    createdAt: 1000 + n,
    updatedAt: 2000 + n,
    postBody: { signature: '0x' + 'aa'.repeat(65), appData: '{"gizli":1}' },
    rawTx: '0x' + 'bb'.repeat(40),
    fee,
    refund: refund ?? newRefundState(),
  }
}

function kur(list, extra = {}) {
  const orders = { loadOrders: vi.fn(async () => list), patchOrder: vi.fn() }
  const rt = createFeeRuntime({
    orders,
    atsFns: { quoteAtsTransfer: vi.fn(), executeAtsTransfer: vi.fn(), readAtsStatus: vi.fn() },
    rpcFor: () => 'http://127.0.0.1:1',
    fetchImpl: vi.fn(),
    baseUrl: 'http://api.test',
    flag: true,
    now: () => NOW,
    ...extra,
  })
  return { rt, orders }
}

describe('createFeeRuntime', () => {
  it('settler, claimer ve statusFor doner', () => {
    const { rt } = kur([])
    expect(typeof rt.settler.settleCowFees).toBe('function')
    expect(typeof rt.settler.approveFeeChange).toBe('function')
    expect(typeof rt.claimer.claimRefunds).toBe('function')
    expect(typeof rt.statusFor).toBe('function')
  })

  it('statusFor yanitinda op / nonce / callDataHash / rawTx / postBody anahtari YOK (JSON taramasi)', async () => {
    const { rt } = kur([kayit(1), kayit(2, { state: FEE_STATE.SENDING })])
    const res = await rt.statusFor(OWNER)
    expect(res.fees).toHaveLength(2)
    const metin = JSON.stringify(res)
    for (const yasak of ['"op"', 'nonce', 'callDataHash', 'rawTx', 'postBody', 'signature', 'appData', 'relayTxHash', 'startBlock']) {
      expect(metin).not.toContain(yasak)
    }
  })

  it('yalniz sahibinin kayitlari, createdAt AZALAN; ucretsiz (mode none) kayit yok', async () => {
    const { rt } = kur([
      kayit(1),
      kayit(2, { owner: BASKA }),
      kayit(3, { owner: OWNER.toLowerCase() }),
      kayit(4, { mode: 'none' }),
    ])
    const res = await rt.statusFor(OWNER)
    expect(res.fees.map((f) => f.uid)).toEqual([uidOf(3), uidOf(1)])
  })

  it('60 kayitta 50 ye keser, en yeni 50 si tutar', async () => {
    const list = Array.from({ length: 60 }, (_, i) => kayit(i + 1))
    const { rt } = kur(list)
    const res = await rt.statusFor(OWNER)
    expect(res.fees).toHaveLength(50)
    expect(res.fees[0].uid).toBe(uidOf(60))
    expect(res.fees[49].uid).toBe(uidOf(11))
    const sirali = res.fees.map((f) => f.uid)
    expect(sirali).toEqual(list.slice(10).reverse().map((r) => r.uid))
  })

  it('debt, feeDebtLock ile uyumlu (bayrak acik: cozulmemis ucret varsa true; yoksa false)', async () => {
    const borclu = [kayit(1)]
    const { rt } = kur(borclu)
    expect((await rt.statusFor(OWNER)).debt).toBe(feeDebtLock({ list: borclu, owner: OWNER, flagOn: true, now: NOW }) !== null)
    expect((await rt.statusFor(OWNER)).debt).toBe(true)

    const odenmis = [kayit(1, { state: FEE_STATE.PAID })]
    const k2 = kur(odenmis)
    expect((await k2.rt.statusFor(OWNER)).debt).toBe(false)
  })

  it('debt yalniz sahibinin kayitlarindan; baska hesabin borcu kilitlemez', async () => {
    const { rt } = kur([kayit(1, { owner: BASKA })])
    expect((await rt.statusFor(OWNER)).debt).toBe(false)
  })

  it('bayrak KAPALIYKEN ucretler listelenir ama debt false (borc kilidi uygulanmaz)', async () => {
    const { rt } = kur([kayit(1)], { flag: false })
    const res = await rt.statusFor(OWNER)
    expect(res.fees).toHaveLength(1)
    expect(res.debt).toBe(false)
  })

  it('kasa/anahtar istenmez: statusFor yalniz depoyu okur', async () => {
    const { rt, orders } = kur([kayit(1)])
    await rt.statusFor(OWNER)
    expect(orders.loadOrders).toHaveBeenCalledTimes(1)
    expect(orders.patchOrder).not.toHaveBeenCalled()
  })
})

// Faz 3 W1: service.js'in fee.prepare bagimliligi (salt-okur hazirlik: durum + BSC ATS bakiyesi + teklif).
describe('fee.prepare (service icin hazirlik okumasi)', () => {
  const HAZIR = { ready: true, mode: 'normal' }
  function kurPrepare({ status = HAZIR, quote, bakiye = 5000n } = {}) {
    zincir.bakiye.mockReset()
    zincir.bakiye.mockImplementation(async () => bakiye)
    const atsFns = {
      readAtsStatus: vi.fn(async () => status),
      quoteAtsTransfer: vi.fn(quote ?? (async () => ({ feeRaw: '1234', commissionAts: '0' }))),
      executeAtsTransfer: vi.fn(),
    }
    const { rt } = kur([], { atsFns })
    return { rt, atsFns }
  }

  it('durum, bakiye ve cowFee teklifini service sekliyle doner (BSC, ondalik 18)', async () => {
    const { rt, atsFns } = kurPrepare()
    const res = await rt.prepare({ owner: OWNER, chainId: 1 })
    expect(res).toEqual({
      isEvm: true, status: HAZIR, balanceRaw: '5000', quotedFeeRaw: '1234',
      decimals: getAtsConfig(56).token.decimals,
    })
    // siparisin zinciri ne olursa olsun ucret BSC'de hesaplanir
    const q = atsFns.quoteAtsTransfer.mock.calls[0][0]
    expect(q.chainId).toBe(56)
    expect(q.opKind).toBe('cowFee')
    expect(q.address).toBe(OWNER)
    expect(q.call.to).toBe(OWNER)
    expect(q.call.value).toBe(0n)
    expect(atsFns.readAtsStatus.mock.calls[0][0]).toMatchObject({ chainId: 56, address: OWNER, force: true })
    expect(zincir.bakiye.mock.calls[0][0]).toMatchObject({ owner: OWNER })
  })

  it('salt okur: ucret op u gonderilmez, kayit yazilmaz', async () => {
    const { rt, atsFns } = kurPrepare()
    await rt.prepare({ owner: OWNER, chainId: 56 })
    expect(atsFns.executeAtsTransfer).not.toHaveBeenCalled()
  })

  it('teklifte komisyon varsa quotedFeeRaw null (settler COMMISSION engeli: kullaniciya ucret gosterilmez)', async () => {
    const { rt } = kurPrepare({ quote: async () => ({ feeRaw: '1234', commissionAts: '7' }) })
    expect((await rt.prepare({ owner: OWNER, chainId: 56 })).quotedFeeRaw).toBeNull()
  })

  it('teklif ya da durum okunamazsa reddeder (service none sayar)', async () => {
    const a = kurPrepare({ quote: async () => { throw new Error('x') } })
    await expect(a.rt.prepare({ owner: OWNER, chainId: 56 })).rejects.toThrow()
    const b = kurPrepare()
    b.atsFns.readAtsStatus.mockRejectedValue(new Error('x'))
    await expect(b.rt.prepare({ owner: OWNER, chainId: 56 })).rejects.toThrow()
  })

  it('bakiye okunamazsa balanceRaw null (kapi BALANCE_UNKNOWN, ucret yok)', async () => {
    const { rt } = kurPrepare()
    zincir.bakiye.mockRejectedValue(new Error('rpc'))
    expect((await rt.prepare({ owner: OWNER, chainId: 56 })).balanceRaw).toBeNull()
  })
})

describe('feeRuntime.js kaynak taramasi', () => {
  const KAYNAK = yorumsuz(readFileSync(fileURLToPath(new URL('./feeRuntime.js', import.meta.url)), 'utf8'))

  it('privateKey gecmez (anahtar yalniz background.js getSigner kapanisindan gecer)', () => {
    expect(KAYNAK.length).toBeGreaterThan(200)
    expect(KAYNAK).not.toMatch(/privateKey/i)
    expect(KAYNAK).not.toMatch(/mnemonic|seed/i)
  })

  it('ucret op u opKind cowFee ve fixedNonce ile gonderilir; teklif de cowFee ile', () => {
    expect(KAYNAK).toMatch(/executeAtsTransfer\s*\(\s*\{[^}]*opKind:\s*FEE_OP_KIND[^}]*fixedNonce/s)
    expect(KAYNAK).toMatch(/quoteAtsTransfer\s*\(\s*\{[^}]*opKind:\s*FEE_OP_KIND/s)
  })
})

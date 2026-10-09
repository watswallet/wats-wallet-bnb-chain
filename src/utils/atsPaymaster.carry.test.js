// Odeme devri — depo yardimcilari (spec docs/superpowers/specs/2026-10-01-xc-odeme-devri-design.md §6.1, §6.3).
import { describe, it, expect, beforeEach } from 'vitest'
import { keccak256 } from 'ethers'
import {
  carryCandidatesFor, clearPendingNonce, maxCostOfGas, CARRY_MAX_ENTRIES,
  savePendingSettlement, _setAtsSettlementStore, settlementRecordKey, XC_PENDING_WAIT_MS,
} from './atsPaymaster'

const KEY = 'ats_pending_settlements'
const SENDER = '0x' + 'a'.repeat(40)
const GAS = {
  callGasLimit: '100', verificationGasLimit: '200', preVerificationGas: '300',
  paymasterVerificationGasLimit: '400', paymasterPostOpGasLimit: '0', maxFeePerGas: '2',
}
const CAP = String((100n + 200n + 300n + 400n + 0n) * 2n)   // 2000
const C1 = '0x' + 'c1'.repeat(32)
const ref = (over = {}) => ({ chainId: 42161, sender: SENDER, nonce: '7', ...over })

const fakeStore = (initial = {}) => {
  const data = { ...initial }
  return {
    data,
    get: async (k) => (k in data ? { [k]: data[k] } : {}),
    set: async (o) => { Object.assign(data, o) },
  }
}

const onayli = (callData, over = {}) => ({
  ...ref(), callData, settlementId: C1, atsFee: '60',
  settlementGas: GAS, settlementPrio: '1', ...over,
})

let store
beforeEach(() => {
  store = fakeStore()
  _setAtsSettlementStore(store)
})

describe('maxCostOfGas', () => {
  it('paymaster maxCostOf ile ayni formul', () => {
    expect(maxCostOfGas(GAS).toString()).toBe(CAP)
  })
})

describe('carryCandidatesFor', () => {
  it('ayni nonce taki BASKA islemin onayli makbuzunu verir', async () => {
    await savePendingSettlement(onayli('0xaaaa'))
    const r = await carryCandidatesFor({ ...ref(), callData: '0xbbbb' })
    expect(r.list).toEqual([{ id: C1, atsAmount: '60', callDataHash: keccak256('0xaaaa'), maxCostCap: CAP }])
    expect(r.inFlightAt).toBe(null)
  })

  it('islemin KENDI kaydini vermez (o makbuz yolu)', async () => {
    await savePendingSettlement(onayli('0xaaaa'))
    expect((await carryCandidatesFor({ ...ref(), callData: '0xaaaa' })).list).toEqual([])
  })

  it('baska nonce, baska zincir ya da baska hesabin kaydini vermez', async () => {
    await savePendingSettlement(onayli('0xaaaa', { nonce: '8' }))
    await savePendingSettlement(onayli('0xaaab', { chainId: 8453 }))
    await savePendingSettlement(onayli('0xaaac', { sender: '0x' + 'b'.repeat(40) }))
    expect((await carryCandidatesFor({ ...ref(), callData: '0xbbbb' })).list).toEqual([])
  })

  it('onayli makbuzlar once, K12 adaylari sonra; tutara gore buyukten kucuge; kimlige gore tekil', async () => {
    await savePendingSettlement({
      ...ref(), callData: '0xaaaa', candidates: [
        { id: '0x' + 'd1'.repeat(32), atsAmount: '50', gas: GAS, maxPriorityFeePerGas: '1' },
        { id: '0x' + 'd2'.repeat(32), atsAmount: '70', gas: GAS, maxPriorityFeePerGas: '1' },
        { id: C1, atsAmount: '60', gas: GAS, maxPriorityFeePerGas: '1' },
      ],
    })
    await savePendingSettlement(onayli('0xcccc', { atsFee: '40' }))
    const { list } = await carryCandidatesFor({ ...ref(), callData: '0xbbbb' })
    expect(list.map((e) => e.id)).toEqual([C1, '0x' + 'd2'.repeat(32), '0x' + 'd1'.repeat(32)])
    expect(list[0].atsAmount).toBe('40')
  })

  it(`en fazla ${CARRY_MAX_ENTRIES} oge`, async () => {
    const candidates = Array.from({ length: 6 }, (_, i) => ({
      id: '0x' + String(i + 1).repeat(64), atsAmount: String(10 + i), gas: GAS, maxPriorityFeePerGas: '1',
    }))
    await savePendingSettlement({ ...ref(), callData: '0xaaaa', candidates })
    expect((await carryCandidatesFor({ ...ref(), callData: '0xbbbb' })).list).toHaveLength(CARRY_MAX_ENTRIES)
  })

  it('5 dakikadan yeni belirsiz deneme inFlightAt verir; eskisi vermez', async () => {
    const yeni = Date.now() - 60_000
    await savePendingSettlement({ ...ref(), callData: '0xaaaa', uncertainAt: yeni, candidates: [] })
    expect((await carryCandidatesFor({ ...ref(), callData: '0xbbbb' })).inFlightAt).toBe(yeni)
    await savePendingSettlement({ ...ref(), callData: '0xaaaa', uncertainAt: Date.now() - XC_PENDING_WAIT_MS - 1 })
    expect((await carryCandidatesFor({ ...ref(), callData: '0xbbbb' })).inFlightAt).toBe(null)
  })

  it('onayli makbuzu olan kayit belirsiz SAYILMAZ (sonuc belli: odendi)', async () => {
    await savePendingSettlement(onayli('0xaaaa', { uncertainAt: Date.now() - 1000 }))
    const r = await carryCandidatesFor({ ...ref(), callData: '0xbbbb' })
    expect(r.inFlightAt).toBe(null)
    expect(r.list).toHaveLength(1)
  })

  it('gazi bozuk kayit atlanir', async () => {
    await savePendingSettlement(onayli('0xaaaa', { settlementGas: { callGasLimit: 'x' }, gasKey: 'bozuk' }))
    expect((await carryCandidatesFor({ ...ref(), callData: '0xbbbb' })).list).toEqual([])
  })

  it('depo okunamazsa bos sonuc (gonderim durmaz)', async () => {
    _setAtsSettlementStore({ get: async () => { throw new Error('okunamadi') }, set: async () => {} })
    expect(await carryCandidatesFor({ ...ref(), callData: '0xbbbb' })).toEqual({ list: [], inFlightAt: null })
  })
})

describe('clearPendingNonce', () => {
  it('o nonce taki TUM kayitlari (eski anahtar dahil) siler, digerlerine dokunmaz', async () => {
    await savePendingSettlement(onayli('0xaaaa'))
    await savePendingSettlement(onayli('0xbbbb'))
    await savePendingSettlement(onayli('0xcccc', { nonce: '8' }))
    store.data[KEY][`42161:${SENDER}:7`] = { ...onayli('0xdddd'), savedAt: Date.now() }   // eski anahtar
    await clearPendingNonce(ref())
    expect(Object.keys(store.data[KEY])).toEqual([settlementRecordKey({ ...ref({ nonce: '8' }), callData: '0xcccc' })])
  })

  it('depo okunamazsa hicbir sey yazmaz', async () => {
    let yazildi = false
    _setAtsSettlementStore({ get: async () => { throw new Error('okunamadi') }, set: async () => { yazildi = true } })
    await clearPendingNonce(ref())
    expect(yazildi).toBe(false)
  })
})

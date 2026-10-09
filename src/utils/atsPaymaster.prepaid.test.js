// Ekran tarafi odeme devri — quoteAtsTransfer.prepaid (spec docs/superpowers/specs/2026-10-01-xc-odeme-devri-design.md §6.5).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const H = vi.hoisted(() => ({ state: {} }))

vi.mock('./sdk/gasless', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    GaslessClient: class {
      status() { return Promise.resolve(H.state.status) }
      quote() { return Promise.resolve(H.state.quote) }
    },
  }
})

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: class {
        estimateGas() { return Promise.resolve(40000n) }
        getFeeData() { return Promise.resolve({ maxPriorityFeePerGas: 100n, gasPrice: 5n }) }
        getBlock() { return Promise.resolve({ baseFeePerGas: 1000n }) }
      },
      Contract: class {
        getNonce() {
          if (H.state.nonceFails) return Promise.reject(new Error('rpc'))
          return Promise.resolve(7n)
        }
        balanceOf() { return Promise.resolve(0n) }
      },
    },
  }
})

const {
  quoteAtsTransfer, _resetAtsStatusCache, _setAtsSettlementStore, savePendingSettlement, buildTransferCallData,
} = await import('./atsPaymaster')

const ADDR = '0x' + '1'.repeat(40)
const CALL = { to: '0x' + '9'.repeat(40), value: '0', data: '0x' }
const GAS = {
  callGasLimit: '100', verificationGasLimit: '200', preVerificationGas: '300',
  paymasterVerificationGasLimit: '400', paymasterPostOpGasLimit: '0', maxFeePerGas: '2',
}

const fakeStore = () => {
  const data = {}
  return { data, get: async (k) => (k in data ? { [k]: data[k] } : {}), set: async (o) => { Object.assign(data, o) } }
}

const kayit = (callData, atsFee, over = {}) => savePendingSettlement({
  chainId: 8453, sender: ADDR, nonce: '7', callData, settlementId: '0x' + 'c1'.repeat(32), atsFee,
  settlementGas: GAS, settlementPrio: '1', ...over,
})

beforeEach(() => {
  _resetAtsStatusCache()
  _setAtsSettlementStore(fakeStore())
  H.state = {
    status: {
      chainId: 8453, mode: 'crosschain', ready: true, delegated: true, nextSteps: [],
      budget: { srcBalance: '0', srcAllowance: '0', minChargeAts: '1' },
    },
    quote: { atsFee: '1000', atsFeeCrosschain: '2000', quoteId: 'Q' },
    nonceFails: false,
  }
})

const teklif = (chainId = 8453) => quoteAtsTransfer({ chainId, rpcUrl: 'http://x', address: ADDR, call: CALL })

describe('quoteAtsTransfer — onceki odeme (prepaid)', () => {
  it('kayit yoksa null', async () => {
    expect((await teklif()).prepaid).toBe(null)
  })

  it('AYNI islemin onayli makbuzu -> same (tutar ne olursa olsun)', async () => {
    await kayit(buildTransferCallData(CALL), '1')
    expect((await teklif()).prepaid).toMatchObject({ kind: 'same', atsAmountRaw: '1' })
  })

  // SON INCELEME (onemli #3): gonderimde teklif YENIDEN alinir; gaz ya da kur ekrandakinden yuksek
  // cikarsa sunucu odemeyi saymaz ve ucret ikinci kez alinir. Ekran 'yeni ucret yok' sozunu yalniz
  // cuzdanin ekran->gonderim sapma toleransi (x1.25) kadar PAYLA verir.
  it('BASKA islemin makbuzu tutara PAYLA (x1.25) yetiyorsa -> carry', async () => {
    await kayit('0xdeadbeef', '2500')
    expect((await teklif()).prepaid).toMatchObject({ kind: 'carry', atsAmountRaw: '2500' })
  })

  it('BASKA islemin makbuzu tutara yetiyor ama payi yoksa -> null (soz verilmez)', async () => {
    await kayit('0xdeadbeef', '2499')
    expect((await teklif()).prepaid).toBe(null)
  })

  it('BASKA islemin makbuzu yetmiyorsa -> null', async () => {
    await kayit('0xdeadbeef', '1999')
    expect((await teklif()).prepaid).toBe(null)
  })

  it('yalniz K12 adayi (odendigi bilinmiyor) -> null', async () => {
    await savePendingSettlement({
      chainId: 8453, sender: ADDR, nonce: '7', callData: '0xdeadbeef',
      candidates: [{ id: '0x' + 'd1'.repeat(32), atsAmount: '5000', gas: GAS, maxPriorityFeePerGas: '1' }],
    })
    expect((await teklif()).prepaid).toBe(null)
  })

  it('baska nonce taki makbuz sayilmaz', async () => {
    await kayit('0xdeadbeef', '5000', { nonce: '6' })
    expect((await teklif()).prepaid).toBe(null)
  })

  it('nonce okunamazsa null ve teklif yine doner', async () => {
    await kayit('0xdeadbeef', '5000')
    H.state.nonceFails = true
    const r = await teklif()
    expect(r.prepaid).toBe(null)
    expect(r.feeRaw).toBe('2000')
  })

  it('BSC de (capraz-zincir degil) bakilmaz', async () => {
    H.state.status = { ...H.state.status, chainId: 56, mode: 'normal' }
    await savePendingSettlement({
      chainId: 56, sender: ADDR, nonce: '7', callData: '0xdeadbeef',
      settlementId: '0x' + 'c1'.repeat(32), atsFee: '5000', settlementGas: GAS, settlementPrio: '1',
    })
    expect((await teklif(56)).prepaid).toBe(null)
  })
})

// Onboarding'in SPONSOR MODU mutabakati — kritik bulgu.
//
// Bu dosya atsPaymaster.onboarding.test.js'ten AYRI durur cunku farkli bir katmani mock'lar:
// oradaki testler `runSponsoredOp`'u BUTUN olarak degistirir, dolayisiyla `onSponsored` geri
// cagrimi HIC calismaz ve icindeki uc kontrol (mod mutabakati, paymaster allowlist, ucret
// tavani) gorunmez kalir. Burada mock BIR KATMAN ASAGIDA — GaslessClient — kurulur, boylece
// gercek runSponsoredOp ve gercek onSponsored yolu kosar.
//
// Kapanan hata: runAtsOnboarding her adima `expectedMode: 'normal'` geciriyordu. Oysa 1. adim
// (approve-paymaster) TANIM GEREGI bootstrap op'udur — BSC'de paymaster izni henuz yoktur
// (zaten 2. adimin 'normal' olabilmesinin sebebi budur). Backend'in classify'i 'bootstrap'
// doner, assertSponsorModeConsistent FIRLATIR ve onboarding HIC tamamlanamaz. Ustelik firlatma
// /sponsor BASARILI olduktan SONRA gerceklesir: o cagri acik bir bootstrap imzasi (~5 dk kilit)
// uretmis ve adres basina 3 ile sinirli haklardan birini ZATEN yakmistir (belge 11).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const PK = '0x' + '1'.repeat(64)
const ADDR = '0x' + '2'.repeat(40)
const BSC_PM = '0x6C0d986513962aF9e3ae88341fEa0837363Bb7E1'
const EP = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
const DELEGATE = '0x268D193D74D3B9a13a82DA831302cf8DBdC9245A'

const H = vi.hoisted(() => ({ state: {} }))

vi.mock('./sdk/gasless', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    GaslessClient: class {
      health() { return Promise.resolve({ ok: true, chains: [{ chainId: 56, paymaster: BSC_PM }] }) }
      quote() { return Promise.resolve({ atsFee: '10', atsFeeCrosschain: '20', quoteId: 'Q1' }) }
      sponsor(req) {
        H.state.sponsorReqs.push(req)
        // Backend'in adim basina dondurecegi mod. Varsayilan GERCEKCI olan: 1. adim
        // (paymaster izni henuz yok) -> bootstrap, 2. adim -> normal.
        const mode = H.state.sponsorModes[H.state.sponsorReqs.length - 1]
        return Promise.resolve({
          paymaster: BSC_PM, paymasterAndDataPrefix: BSC_PM + '0'.repeat(64),
          paymasterData: '0xabcd', atsFee: '10', settlementId: '0xset', mode,
        })
      }
      relay(userOp) {
        H.state.relayCount++
        // GERCEK hash: makbuz log'unun topics[1]'i bununla eslesmek ZORUNDA, yoksa
        // extractUserOpSuccess null doner ve adim "basarisiz" sayilir.
        H.state.lastUserOpHash = actual.computeUserOpHash(userOp, { chainId: 56n, entryPoint: EP })
        return Promise.resolve({ success: true, txHash: '0x' + 'f'.repeat(64) })
      }
    },
  }
})

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal()
  const TOPIC0 = actual.ethers.id(
    'UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)')
  const receipt = () => ({
    logs: [{
      address: EP,
      topics: [TOPIC0, H.state.lastUserOpHash],
      data: actual.ethers.AbiCoder.defaultAbiCoder()
        .encode(['uint256', 'bool', 'uint256', 'uint256'], [0n, true, 0n, 0n]),
    }],
  })
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: class {
        estimateGas() { return Promise.resolve(60000n) }
        getFeeData() { return Promise.resolve({ maxPriorityFeePerGas: 100n, gasPrice: 5n }) }
        getBlock() { return Promise.resolve({ baseFeePerGas: 1000n }) }
        // BSC'de zaten delege: authorization uretilmez, initCode '0x' kalir ve userOpHash
        // 7702 delegesi OLMADAN hesaplanir (yukaridaki relay mock'u ile ayni).
        getCode() { return Promise.resolve('0xef0100' + DELEGATE.slice(2).toLowerCase()) }
        getTransactionCount() { return Promise.resolve(0) }
        waitForTransaction() { return Promise.resolve(receipt()) }
        getTransactionReceipt() { return Promise.resolve(receipt()) }
      },
      Wallet: class {
        constructor() {
          this.address = ADDR
          this.signingKey = { sign: () => ({ serialized: '0x' + 'cd'.repeat(65) }) }
        }
      },
      Contract: class { getNonce() { return Promise.resolve(0n) } },
    },
  }
})

const { runAtsOnboarding, _resetPaymasterAllowlist, _setAtsSettlementStore } =
  await import('./atsPaymaster')

const STEPS = [
  { chainId: 56, action: 'approve-paymaster', sponsored: true },
  { chainId: 56, action: 'approve-collector', sponsored: true, suggestedAmount: '50000000000000000000' },
]

beforeEach(() => {
  H.state = {
    sponsorReqs: [], relayCount: 0, lastUserOpHash: '0x' + '0'.repeat(64),
    sponsorModes: ['bootstrap', 'normal'],
  }
  _resetPaymasterAllowlist()
  _setAtsSettlementStore(null)
})

const run = () => runAtsOnboarding({ privateKey: PK, address: ADDR, nextSteps: STEPS, srcRpcUrl: 'http://bsc' })

describe('runAtsOnboarding — sponsor modu mutabakati (gercek onSponsored yolu)', () => {
  it('1. adima backend BOOTSTRAP dondurdugunde onboarding TAMAMLANIR', async () => {
    // Bu, ilk kez kurulum yapan HER kullanicinin normal yoludur; eskiden burada patliyordu.
    const r = await run()
    expect(H.state.relayCount).toBe(2)
    expect(r.steps).toHaveLength(2)
  })

  it('1. adim BOOTSTRAP beklenir: sponsor normal donerse de durdurulmaz (izin arada olusmus olabilir)', async () => {
    H.state.sponsorModes = ['normal', 'normal']
    const r = await run()
    expect(r.steps).toHaveLength(2)
  })

  // Ters yon HALA olumcul olmali: 2. adim (toplayici izni) bir kurulum op'u DEGILDIR.
  // Backend ona 'bootstrap' diyorsa istemci ile sunucu ayni op hakkinda ayri seyler
  // dusunuyor demektir — imzalamadan dur.
  it('2. adima backend BOOTSTRAP dondurdugunde IPTAL (1. adim inmis olsa bile)', async () => {
    H.state.sponsorModes = ['bootstrap', 'bootstrap']
    await expect(run()).rejects.toThrow(/bootstrap/i)
    expect(H.state.relayCount).toBe(1)   // 2. adim IMZADAN ONCE durdu
  })

  // Kalici (is kurali) hatalarda yeniden deneme YOK: /sponsor'u bir kez daha cagirmak
  // bootstrap kotasindan bir hak daha yakar.
  it('mod uyusmazliginda ikinci bir /sponsor cagrisi YAPILMAZ', async () => {
    H.state.sponsorModes = ['bootstrap', 'bootstrap']
    await expect(run()).rejects.toThrow(/bootstrap/i)
    expect(H.state.sponsorReqs).toHaveLength(2)   // adim1 + adim2, adim2 icin TEKRAR yok
  })
})

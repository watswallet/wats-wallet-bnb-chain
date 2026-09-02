// quoteAtsTransfer'in KOMISYON tarafi — ekranda gosterilen tutar ve §06.1 tavani.
//
// Burada kanitlanan sey su: ekran, komisyonu /status'un ON TAHMININDEN degil, GONDERILECEK
// callData ile yapilan /quote'un cevabindan okur. Ikisi ayni sey DEGILDIR: /status bir op'a
// bakmaz ve canli olcumde (2026-08-19) on zincirin hepsinde ayni tutari doner. /status'u
// otorite saymak, hic alinmayacak bir komisyonu ekranda gostermek ve maxAtsSellRaw tavanini
// bosuna dusurmek demektir.
//
// Tersi de olumlu: /quote'a callData HIC verilmediyse (onboarding tazelemesi) alanin yoklugu
// "komisyonsuz" DEGIL "soru sorulmadi" demektir; orada muhafazakar taraf /status'tur.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ethers as realEthers } from 'ethers'

const H = vi.hoisted(() => ({ state: {} }))

vi.mock('./sdk/gasless', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    GaslessClient: class {
      constructor(opts) { H.state.clientChainId = opts.chainId }
      status() { return Promise.resolve(H.state.status) }
      // callData KAYDEDILIR: "alan yoklugu = komisyonsuz" cikarimi ancak soru SORULDUYSA
      // gecerlidir, o yuzden sorunun sorulup sorulmadigi testin konusudur.
      quote(gas, sender, callData) {
        H.state.quoteArgs = { gas, sender, callData }
        return Promise.resolve(H.state.quote)
      }
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
        balanceOf() { return Promise.resolve(H.state.onChainBalance ?? 0n) }
      },
    },
  }
})

const { quoteAtsTransfer, _resetAtsStatusCache } = await import('./atsPaymaster')

const ADDR = '0x' + '1'.repeat(40)
const ATS_BSC = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'
const TREASURY = '0xb42f545bF8AB1A1Ba968e21a32E553d25fdF8e6d'
const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E'
const CALL = { to: '0x' + '9'.repeat(40), value: '0', data: '0xdeadbeef' }
// CANLI OLCUM (2026-08-19): /status on zincirin hepsinde bu tutari doner.
const STATUS_COMMISSION = '6881838827334664106'

const BATCH_IFACE = new realEthers.Interface([
  'function executeBatch((address target, uint256 value, bytes data)[] calls)',
])
const EXEC_IFACE = new realEthers.Interface(['function execute(address dest, uint256 value, bytes func)'])
const ERC20_IFACE = new realEthers.Interface(['function transfer(address to, uint256 amount)'])
const decodeBatch = (cd) => BATCH_IFACE.decodeFunctionData('executeBatch', cd)[0]
const isBatch = (cd) => cd.slice(0, 10) === '0x34fcd5be'

const FEE = '1000000000000000000'
const BALANCE = 100n * 10n ** 18n

beforeEach(() => {
  _resetAtsStatusCache()
  H.state = {
    status: {
      chainId: 56, mode: 'normal', ready: true, delegated: true, collection: 'local',
      nextSteps: [],
      budget: {
        srcBalance: '0', srcAllowance: '0', minChargeAts: '1',
        commissionAts: STATUS_COMMISSION, commissionTreasury: TREASURY,
      },
    },
    quote: { atsFee: FEE, atsFeeCrosschain: FEE, quoteId: 'Q' },
    onChainBalance: BALANCE,
  }
})

const q = (over = {}) => quoteAtsTransfer({
  chainId: 56, rpcUrl: 'http://x', address: ADDR, call: CALL, ...over,
})

describe('kilitlenen komisyon — otorite /quote, /status yalniz tohum', () => {
  it('callData GONDERILDI ve alan YOKSA komisyon 0 dir (status un tahmini kullanilmaz)', async () => {
    const r = await q()
    expect(r.commissionAts).toBe('0')
    expect(r.commissionAtsHuman).toBe(0)
    // Tavan yalniz gaz ucreti kadar dusrur; hic alinmayacak bir komisyon dusulmez.
    expect(r.maxAtsSellRaw).toBe((BALANCE - BigInt(FEE)).toString())
    // On kosul: soru gercekten SORULDU.
    expect(H.state.quoteArgs.callData).toBeTruthy()
    expect(isBatch(H.state.quoteArgs.callData)).toBe(false)
    expect(H.state.quoteArgs.callData).toBe(
      EXEC_IFACE.encodeFunctionData('execute', [CALL.to, 0n, CALL.data]))
  })

  // INCE AYRIM: alanin yoklugu iki farkli sey olabilir. callData verilmediyse (onboarding
  // tazelemesi) soru HIC sorulmamistir; orada 0 saymak tavani sahte olarak yukseltir ve
  // op zincirde AA33 ile olur.
  it('callData VERILMEDIYSE alan yoklugu komisyonsuz ANLAMINA GELMEZ', async () => {
    const r = await q({ call: null })
    expect(H.state.quoteArgs.callData).toBeUndefined()
    expect(r.commissionAts).toBe(STATUS_COMMISSION)
  })

  it('/quote alan donerse O kazanir ve tavandan dusulur', async () => {
    H.state.status.budget.commissionAts = '4200'
    H.state.quote = { ...H.state.quote, commissionAts: '5000' }
    const r = await q()
    expect(r.commissionAts).toBe('5000')
    expect(r.maxAtsSellRaw).toBe((BALANCE - BigInt(FEE) - 5000n).toString())
  })

  // Ekran ve gonderim AYNI callData ile AYNI soruyu sormali; ayrisirsa ekrandaki tavan ile
  // gonderimde kurulan batch birbirini tutmaz.
  it('swap/bridge tohumu ekranda da uygulanir (ayni callData, ayni soru)', async () => {
    H.state.status.budget.commissionAts = '4200'
    await q({ calls: [{ to: ROUTER, value: '0', data: '0xbbbbbbbb' }], opKind: 'swap' })
    const cd = H.state.quoteArgs.callData
    expect(isBatch(cd)).toBe(true)
    const calls = decodeBatch(cd)
    expect(calls.length).toBe(2)
    expect(calls[0].target.toLowerCase()).toBe(ATS_BSC.toLowerCase())
    expect(calls[0].data).toBe(ERC20_IFACE.encodeFunctionData('transfer', [TREASURY, 4200n]))
  })

  // FAIL-CLOSED: cozulemeyen bir tutarla ekranda rakam gostermek, gonderimde
  // commission-missing'e ve sebebi gorunmeyen bir hataya cikar.
  it('cozulemeyen commissionAts FIRLATIR', async () => {
    H.state.quote = { ...H.state.quote, commissionAts: 'abc' }
    await expect(q()).rejects.toThrow(/commissionAts/)
  })
})

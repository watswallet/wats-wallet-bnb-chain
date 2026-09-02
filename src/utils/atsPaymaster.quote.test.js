// quoteAtsTransfer — /status + /quote birlesimi. Zincir okumasi YALNIZ kaynak zincirin
// kendisinde (56) yapilir; diger aglarda bakiye /status'un budget.srcBalance'indan gelir.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const H = vi.hoisted(() => ({ state: {} }))

vi.mock('./sdk/gasless', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    GaslessClient: class {
      constructor(opts) { H.state.clientChainId = opts.chainId }
      status() { return Promise.resolve(H.state.status) }
      quote(gas, sender) { H.state.quoteArgs = { gas, sender }; return Promise.resolve(H.state.quote) }
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

const { quoteAtsTransfer, readAtsStatus, _resetAtsStatusCache } = await import('./atsPaymaster')

const ADDR = '0x' + '1'.repeat(40)
const CALL = { to: '0x' + '9'.repeat(40), value: '0', data: '0x' }

const okStatus = (over = {}) => ({
  chainId: 8453, mode: 'crosschain', ready: true, delegated: false, delegation: 'none',
  nextSteps: [],
  budget: { srcBalance: '5000000000000000000', srcAllowance: '9000000000000000000', minChargeAts: '1' },
  ...over,
})

beforeEach(() => {
  _resetAtsStatusCache()
  H.state = {
    status: okStatus(),
    quote: { atsFee: '1000000000000000000', atsFeeCrosschain: '2000000000000000000', quoteId: 'Q' },
  }
})

describe('quoteAtsTransfer', () => {
  it('crosschain modunda atsFeeCrosschain i ucret olarak dondurur', async () => {
    const r = await quoteAtsTransfer({ chainId: 8453, rpcUrl: 'http://x', address: ADDR, call: CALL })
    expect(r.isCrosschain).toBe(true)
    expect(r.feeRaw).toBe('2000000000000000000')
    expect(r.transferFee).toBe(2)
  })

  it('bakiyeyi budget.srcBalance ten (BSC) okur, hedef zincirden DEGIL', async () => {
    H.state.onChainBalance = 777n // hedef zincirdeki ATSOFT — kullaniciya hic acilmaz
    const r = await quoteAtsTransfer({ chainId: 8453, rpcUrl: 'http://x', address: ADDR, call: CALL })
    expect(r.atsBalance).toBe(5)
  })

  it('kaynak zincirin kendisinde (56) bakiyeyi ZINCIRDEN okur', async () => {
    // Belge 05: chainId 56'da budget.srcBalance her zaman "0" doner.
    H.state.status = okStatus({ chainId: 56, mode: 'normal', budget: { srcBalance: '0', srcAllowance: '0', minChargeAts: '1' } })
    H.state.onChainBalance = 3000000000000000000n
    const r = await quoteAtsTransfer({ chainId: 56, rpcUrl: 'http://x', address: ADDR, call: CALL })
    expect(r.atsBalance).toBe(3)
    expect(r.feeRaw).toBe('1000000000000000000')
  })

  it('gaz alanlarini modun crosschain bayragiyla kurar', async () => {
    await quoteAtsTransfer({ chainId: 8453, rpcUrl: 'http://x', address: ADDR, call: CALL })
    expect(H.state.quoteArgs.gas.paymasterPostOpGasLimit).toBe(0n)
    expect(H.state.quoteArgs.sender).toBe(ADDR)   // quoteId kilidi icin ZORUNLU
  })

  it('ready:false ise decision uretir ve quote yine de denenir', async () => {
    H.state.status = okStatus({ ready: false, blocker: 'src-allowance-missing', mode: undefined })
    const r = await quoteAtsTransfer({ chainId: 8453, rpcUrl: 'http://x', address: ADDR, call: CALL })
    expect(r.ready).toBe(false)
    expect(r.decision).toMatchObject({ action: 'run-onboarding' })
    expect(r.nextSteps).toEqual([])
  })

  // Bootstrap modunda gonderim IKI op'tur (approve + transfer) ve her biri AYRI AYRI
  // fiyatlanip tahsil edilir. Ekran/butce bunu bilmeden tek op uzerinden hesaplarsa,
  // 1x-2x arasi bakiyesi olan kullaniciya "yeterli" gosterilir ve op1 odendikten sonra
  // op2 bakiyeden duser: para gitmis, transfer gonderilmemis olur.
  it('bootstrap modunda opCount 2 doner (transferFee PER-OP kalir)', async () => {
    H.state.status = okStatus({ chainId: 56, mode: 'bootstrap', budget: { srcBalance: '0', srcAllowance: '0', minChargeAts: '1' } })
    const r = await quoteAtsTransfer({ chainId: 56, rpcUrl: 'http://x', address: ADDR, call: CALL })
    expect(r.opCount).toBe(2)
    expect(r.transferFee).toBe(1)   // per-op; toplam (2) ekranda opCount ile carpilir
  })

  it('normal ve crosschain modlarinda opCount 1 doner', async () => {
    const xc = await quoteAtsTransfer({ chainId: 8453, rpcUrl: 'http://x', address: ADDR, call: CALL })
    expect(xc.opCount).toBe(1)
    _resetAtsStatusCache()
    H.state.status = okStatus({ chainId: 56, mode: 'normal', budget: { srcBalance: '0', srcAllowance: '0', minChargeAts: '1' } })
    const n = await quoteAtsTransfer({ chainId: 56, rpcUrl: 'http://x', address: ADDR, call: CALL })
    expect(n.opCount).toBe(1)
  })

  // background.js'in atsRunOnboarding'i "Taze /status sart" diyordu ama 30 sn'lik onbellegin
  // icinden geciyordu: bayat bir nextSteps zaten yapilmis bir adimi tekrar gonderir.
  it('force:true /status onbellegini ATLAR', async () => {
    const q = (over = {}) => quoteAtsTransfer({ chainId: 8453, rpcUrl: 'http://x', address: ADDR, call: CALL, ...over })
    await q()   // onbellegi doldur
    // Uc tarafta durum degisti (kullanici baska bir cihazda adim attı / yeni adim gerekti).
    H.state.status = okStatus({
      nextSteps: [{ chainId: 56, action: 'approve-collector', sponsored: true, suggestedAmount: '1' }],
    })
    expect((await q()).nextSteps).toEqual([])              // bayat cevap: yeni adim GORUNMEZ
    expect((await q({ force: true })).nextSteps).toHaveLength(1)   // taze cevap
  })

  it('ucret izni asiyorsa needsTopUp true', async () => {
    H.state.status = okStatus({ budget: { srcBalance: '5000000000000000000', srcAllowance: '1', minChargeAts: '1' } })
    const r = await quoteAtsTransfer({ chainId: 8453, rpcUrl: 'http://x', address: ADDR, call: CALL })
    expect(r.needsTopUp).toBe(true)
  })

  // Kaynak-zincir izni YALNIZ capraz-zincir yolunda harcanir. Belge 05: kaynak zincirin
  // KENDISINDE srcAllowance her kosulda "0" doner — suzmezsek BSC'deki HER transfer sahte
  // bir "butce tazeleme" karti ile bloklanirdi. Suzgeci zincire tasirken kaybolmamasi
  // gereken kenar durum budur.
  it('kaynak zincirde (56) srcAllowance "0" olsa bile needsTopUp FALSE', async () => {
    H.state.status = okStatus({ chainId: 56, mode: 'normal', budget: { srcBalance: '0', srcAllowance: '0', minChargeAts: '1' } })
    const r = await quoteAtsTransfer({ chainId: 56, rpcUrl: 'http://x', address: ADDR, call: CALL })
    expect(r.needsTopUp).toBe(false)
  })

  // GERCEK VAKA (2026-08-10, chainId 1). Bu testin ESKI hali "mod normal/bootstrap ise
  // kaynak izni bu op'u ilgilendirmez" diyordu ve tam da BU varsayim yanlisti:
  //   /status -> mode:"bootstrap", ready:true, srcAllowance:"0"
  //   /sponsor -> src-allowance-missing (op olur, ekran yesildi)
  // `mode` HEDEF zincirdeki sponsorluk seklidir; tahsilatin NEREDE oldugunu SOYLEMEZ.
  // Kullanicinin ATS'si yalniz BSC'de durdugu icin 56 disindaki HER agda kaynak izni
  // harcanir — suzgec ZINCIR olmali, mod degil.
  it("mode 'bootstrap'/'normal' olsa bile hedef zincirde srcAllowance yetmiyorsa needsTopUp TRUE", async () => {
    for (const mode of ['normal', 'bootstrap']) {
      H.state.status = okStatus({ mode, budget: { srcBalance: '5000000000000000000', srcAllowance: '1', minChargeAts: '1' } })
      const r = await quoteAtsTransfer({ chainId: 8453, rpcUrl: 'http://x', address: ADDR, call: CALL, force: true })
      expect(r.needsTopUp, mode).toBe(true)
      expect(r.isCrosschain, mode).toBe(true)
    }
  })
})

describe('readAtsStatus onbellegi', () => {
  it('ayni zincir+adres icin ucu IKINCI KEZ cagirmaz', async () => {
    _resetAtsStatusCache()
    let n = 0
    const client = { status: async () => { n++; return { ready: true } } }
    await readAtsStatus({ client, address: ADDR, chainId: 8453 })
    await readAtsStatus({ client, address: ADDR, chainId: 8453 })
    expect(n).toBe(1)
  })
  it('farkli zincir ayri kayittir', async () => {
    _resetAtsStatusCache()
    let n = 0
    const client = { status: async () => { n++; return { ready: true } } }
    await readAtsStatus({ client, address: ADDR, chainId: 8453 })
    await readAtsStatus({ client, address: ADDR, chainId: 42161 })
    expect(n).toBe(2)
  })
  it('force:true onbellegi atlar (onboarding sonrasi sart)', async () => {
    _resetAtsStatusCache()
    let n = 0
    const client = { status: async () => { n++; return { ready: true } } }
    await readAtsStatus({ client, address: ADDR, chainId: 8453 })
    await readAtsStatus({ client, address: ADDR, chainId: 8453, force: true })
    expect(n).toBe(2)
  })
})

// Izin, GONDERILECEK TUM op'lari karsilamali. Bootstrap'ta iki op gider ve ikisi de ayri
// ayri tahsil edilir. Per-op ucretle karsilastirmak, izni 1x ile 2x arasinda olan kullaniciya
// yesil ekran gosterir: op1 iner ve ODENIR, op2 izin yetmediginden duser — para gitmis,
// transfer hic gonderilmemis olur. Bakiye tarafinda ayni tuzak opCount ile zaten kapali.
describe('needsTopUp — izin TUM op sayisina gore olculur', () => {
  const allowanceFor = (x) => String(x)
  it('bootstrap (2 op): izin tek op a yetip ikisine yetmiyorsa needsTopUp TRUE', async () => {
    // H.state.quote.atsFeeCrosschain sabitine gore: tek op < izin < iki op araligi.
    H.state.status = okStatus({
      mode: 'bootstrap',
      budget: { srcBalance: '1000000000000000000000', srcAllowance: allowanceFor(3n * 10n ** 18n), minChargeAts: '1' },
    })
    H.state.quote = { atsFee: '2000000000000000000', atsFeeCrosschain: '2000000000000000000' }
    const r = await quoteAtsTransfer({ chainId: 8453, rpcUrl: 'http://x', address: ADDR, call: CALL, force: true })
    expect(r.opCount).toBe(2)
    expect(r.needsTopUp).toBe(true)   // 2 x 2 ATS = 4 > 3 izin
  })

  it('ayni izin TEK op luk modda yeterlidir', async () => {
    H.state.status = okStatus({
      mode: 'normal',
      budget: { srcBalance: '1000000000000000000000', srcAllowance: allowanceFor(3n * 10n ** 18n), minChargeAts: '1' },
    })
    H.state.quote = { atsFee: '2000000000000000000', atsFeeCrosschain: '2000000000000000000' }
    const r = await quoteAtsTransfer({ chainId: 8453, rpcUrl: 'http://x', address: ADDR, call: CALL, force: true })
    expect(r.opCount).toBe(1)
    expect(r.needsTopUp).toBe(false)  // 1 x 2 ATS = 2 < 3 izin
  })
})

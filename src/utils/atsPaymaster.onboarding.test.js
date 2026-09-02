// Onboarding op'lari KAYNAK ZINCIRDE (56) kosar, kullanici hangi agda olursa olsun; ve
// SIRAYLA kosar (2. adim ucretini pesin alir, bunu ancak 1. adimin izni mumkun kilar).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const PK = '0x' + '1'.repeat(64)
const ADDR = '0x' + '2'.repeat(40)

const H = vi.hoisted(() => ({ state: {} }))

// Varsayilan implementasyon YOK: her test kendi ihtiyacina gore beforeEach'te kurulan
// varsayilani KORUR ya da tek testlik ozel bir implementasyonla EZER. Boylece bir testte
// kurulan ozel davranis (red, inFlight kontrolu...) diger testlere SIZMAZ (vitest.config.js'te
// mockReset/restoreMocks kapali; sizinti izole olmayan yanlis-yesil testler uretirdi).
vi.mock('./sdk/flow', () => ({ runSponsoredOp: vi.fn() }))

// sendOneOp paymasterAllowlist icin /health cagirir; gercek fetch'e cikmasin.
vi.mock('./sdk/gasless', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    GaslessClient: class {
      health() { return Promise.resolve({ ok: true, chains: [{ chainId: 56, paymaster: '0x6C0d986513962aF9e3ae88341fEa0837363Bb7E1' }] }) }
      status() { return Promise.resolve({ ready: true, mode: 'normal', delegated: true, budget: {} }) }
    },
  }
})

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal()
  const TOPIC0 = actual.ethers.id(
    'UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)')
  // GERCEK sekilli makbuz. Eskiden bu mock `{logs: []}` donuyordu, yani her adimin sonucu
  // "BILINMIYOR" (extractUserOpSuccess -> null) idi ve testler yalnizca uretimdeki
  // `r.success === false` kontrolunun bilinmiyeni BASARI saymasi sayesinde yesildi.
  const receipt = () => (H.state.receiptHasEvent === false ? { logs: [] } : {
    logs: [{
      address: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
      topics: [TOPIC0, '0x' + 'a'.repeat(64)],
      data: actual.ethers.AbiCoder.defaultAbiCoder()
        .encode(['uint256', 'bool', 'uint256', 'uint256'], [0n, H.state.opSuccess !== false, 0n, 0n]),
    }],
  })
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: class {
        // Bulgu 2 kanitini bu diziden okuyoruz: her adim GERCEK ic cagriyi ({to,value,data})
        // mi tahmin ediyor, yoksa hep ayni bos cagriyi mi.
        estimateGas(tx) { H.state.estimateGasCalls.push(tx); return Promise.resolve(40000n) }
        getFeeData() { return Promise.resolve({ maxPriorityFeePerGas: 100n, gasPrice: 5n }) }
        getBlock() { return Promise.resolve({ baseFeePerGas: 1000n }) }
        getCode() { return Promise.resolve('0xef0100268d193d74d3b9a13a82da831302cf8dbdc9245a') }
        getTransactionCount() { return Promise.resolve(0) }
        waitForTransaction() { return Promise.resolve(receipt()) }
        getTransactionReceipt() { return Promise.resolve(receipt()) }
      },
      Wallet: class { constructor() { this.address = ADDR; this.signingKey = { sign: () => ({ serialized: '0x' + 'cd'.repeat(65) }) } } },
      Contract: class { getNonce() { return Promise.resolve(0n) } },
    },
  }
})

const { runAtsOnboarding, _resetPaymasterAllowlist } = await import('./atsPaymaster')
const { runSponsoredOp } = await import('./sdk/flow')

// Varsayilan (basarili) davranis: kaydeder ve doner. Testler ozel bir senaryo icin
// runSponsoredOp.mockImplementation(...) ile bunu KENDI GOVDESI icinde ezebilir — beforeEach
// bir sonraki test icin daima bu varsayilana DONER.
const defaultRunSponsoredOp = vi.fn(async (a) => {
  H.state.runs.push({ chainId: a.chainId, callData: a.callData, delegated: a.delegated })
  return { userOpHash: '0x' + 'a'.repeat(64), txHash: '0x' + String(H.state.runs.length).repeat(64) }
})

beforeEach(() => {
  H.state = { runs: [], estimateGasCalls: [], receiptHasEvent: true, opSuccess: true }
  _resetPaymasterAllowlist()
  runSponsoredOp.mockReset()
  runSponsoredOp.mockImplementation(defaultRunSponsoredOp)
})

const STEPS = [
  { chainId: 56, action: 'approve-paymaster', sponsored: true },
  { chainId: 56, action: 'approve-collector', sponsored: true, suggestedAmount: '50000000000000000000' },
]

describe('runAtsOnboarding', () => {
  it('iki adimi da chainId 56 ya gonderir', async () => {
    await runAtsOnboarding({ privateKey: PK, address: ADDR, nextSteps: STEPS, srcRpcUrl: 'http://bsc' })
    expect(H.state.runs.map((r) => r.chainId)).toEqual([56, 56])
  })

  it('adimlari SIRAYLA kosar (paralel DEGIL)', async () => {
    // inFlight bayragi: birinci cagri HENUZ donmeden ikincisi gelirse (bayrak acikken)
    // bu paralel calistigi anlamina gelir ve mock'un kendisi FIRLATIR — test bunu yakalar.
    // Salt "callData farkli" veya "2 kayit var" kontrolu SIRA garantisini KANITLAMAZ (paralel
    // calisip yine de 2 farkli kayit uretebilirdi); bu bayrak zamanlamayi da dogrular.
    let inFlight = false
    runSponsoredOp.mockImplementation(async (a) => {
      if (inFlight) throw new Error('paralel cagri: 1. adim donmeden 2. adim basladı')
      inFlight = true
      await Promise.resolve()
      H.state.runs.push({ chainId: a.chainId, callData: a.callData, delegated: a.delegated })
      await Promise.resolve()
      inFlight = false
      return { userOpHash: '0x' + 'a'.repeat(64), txHash: '0x' + String(H.state.runs.length).repeat(64) }
    })
    await runAtsOnboarding({ privateKey: PK, address: ADDR, nextSteps: STEPS, srcRpcUrl: 'http://bsc' })
    expect(H.state.runs).toHaveLength(2)
    expect(H.state.runs[0].callData).not.toBe(H.state.runs[1].callData)
  })

  it('ilk adim duserse ikinci adim GONDERILMEZ', async () => {
    // KAYIT YAPTIKTAN SONRA reddet: mockRejectedValue varsayilan implementasyonu tamamen EZER
    // ve H.state.runs'i olculemez hale getirir (hicbir zaman dolmaz) — o zaman
    // toHaveLength(0) KOSULSUZ gecer ve "1. adimdan sonra durdu" ile "iki adimi da denedi,
    // ikisi de dustu" arasini AYIRT ETMEZ. Hata txHash TASIMIYOR (ag hatasi simulasyonu):
    // sendOneOp (Task 7 fix'i) byle bir hatayi bir kez daha dener, bu yuzden runs.length 1
    // DEGIL 2 cikabilir — onemli olan HEPSININ ayni (1. adimin) callData'siyla olmasi;
    // 2. adim (farkli callData) hic gorunmemeli.
    runSponsoredOp.mockImplementation(async (a) => {
      H.state.runs.push({ chainId: a.chainId, callData: a.callData, delegated: a.delegated })
      throw new Error('sponsor reddetti')
    })
    await expect(runAtsOnboarding({ privateKey: PK, address: ADDR, nextSteps: STEPS, srcRpcUrl: 'http://bsc' }))
      .rejects.toThrow(/sponsor reddetti/)
    expect(H.state.runs.length).toBeGreaterThan(0)
    expect(new Set(H.state.runs.map((r) => r.callData)).size).toBe(1)
  })

  // GERCEK VAKA (2026-08-10): backend chainId 1 icin `ready:true` + `nextSteps:[]` dondu.
  // Bu fonksiyon o zaman sessizce {steps: []} donuyordu -> "kurulumu baslat" butonu basildi,
  // hicbir op gitmedi, hicbir hata gorunmedi, ekran ayni kaldi. Kullanici butona defalarca
  // basti. Sifir adim BASARI DEGILDIR: buton zaten "kurulum gerekli" denildigi icin var.
  //
  // Adimlari burada UYDURMUYORUZ (bkz. sdk/onboarding.ts) — cikmaz sokagi GORUNUR kiliyoruz.
  it('bos nextSteps: hicbir op gondermez ve sessizce BASARILI donmez', async () => {
    await expect(runAtsOnboarding({ privateKey: PK, address: ADDR, nextSteps: [], srcRpcUrl: 'http://bsc' }))
      .rejects.toMatchObject({ code: 'onboarding-steps-missing' })
    expect(H.state.runs).toHaveLength(0)
  })

  it('nextSteps hic verilmemisse de ayni sekilde firlatir', async () => {
    await expect(runAtsOnboarding({ privateKey: PK, address: ADDR, srcRpcUrl: 'http://bsc' }))
      .rejects.toMatchObject({ code: 'onboarding-steps-missing' })
    expect(H.state.runs).toHaveLength(0)
  })

  it('address parametresi private key in turettigi adresle uyusmuyorsa FIRLATIR', async () => {
    // Review minor: address hic okunmuyordu. Yanlis hesap icin sessizce onboarding kosmak,
    // kullaniciya "hazir" gosterilen hesapta hicbir sey degismeden basarili donerdi.
    const WRONG = '0x' + '3'.repeat(40)
    await expect(runAtsOnboarding({ privateKey: PK, address: WRONG, nextSteps: STEPS, srcRpcUrl: 'http://bsc' }))
      .rejects.toThrow(/adres/i)
    expect(H.state.runs).toHaveLength(0)
  })

  // Bulgu 6: cikis kontrolu `r.success === false` idi. confirmUserOp eslesen bir
  // UserOperationEvent bulamadiginda null (BILINMIYOR) doner — handleOps revert etmis ya da
  // hash tutmamis olabilir. `=== false` bu durumda GECER: onboarding 1. adimi "yapildi"
  // sayar, delegated=true der ve 2. adimi HIC VERILMEMIS bir izin uzerine gonderir (ve bir
  // bootstrap hakkini daha yakar). Dosyadaki diger tum cikis kontrolleri `!== true` kullanir.
  it('makbuzda eslesen UserOperationEvent YOKSA (sonuc bilinmiyor) adim BASARISIZ sayilir ve sonraki adim gonderilmez', async () => {
    H.state.receiptHasEvent = false
    await expect(runAtsOnboarding({ privateKey: PK, address: ADDR, nextSteps: STEPS, srcRpcUrl: 'http://bsc' }))
      .rejects.toThrow(/basarisiz/i)
    expect(H.state.runs).toHaveLength(1)   // 2. adim HIC denenmedi
  })

  it('op zincirde basarisiz olduysa (success=false) da adim BASARISIZ sayilir', async () => {
    H.state.opSuccess = false
    await expect(runAtsOnboarding({ privateKey: PK, address: ADDR, nextSteps: STEPS, srcRpcUrl: 'http://bsc' }))
      .rejects.toThrow(/basarisiz/i)
    expect(H.state.runs).toHaveLength(1)
  })

  // Minor 9: op.chainId hic okunmuyordu. Baska bir zincire ait bir adim, BSC'nin
  // client/provider/cfg/entryPoint'i ile gonderilirdi — izin yanlis token/paymaster'a giderdi.
  it('adim kaynak zincire (56) ait DEGILSE hicbir op gondermeden FIRLATIR', async () => {
    const foreign = [{ chainId: 8453, action: 'approve-paymaster', sponsored: true }]
    await expect(runAtsOnboarding({ privateKey: PK, address: ADDR, nextSteps: foreign, srcRpcUrl: 'http://bsc' }))
      .rejects.toThrow(/kaynak zincire ait degil/i)
    expect(H.state.runs).toHaveLength(0)
  })

  it('her adim GERCEK ic cagriyi (approve calldata) tahmin eder, bos veri DEGIL', async () => {
    // Bulgu 2: gaz tahmini eskiden her adimda ayni bos {to: token, data: '0x'} cagrisini
    // olcuyordu -> sistematik eksik tahmin. Simdi her adimin GERCEK approve(...) verisini
    // (op.callData'dan cozulen ic cagri) olcmesi gerekiyor.
    await runAtsOnboarding({ privateKey: PK, address: ADDR, nextSteps: STEPS, srcRpcUrl: 'http://bsc' })
    expect(H.state.estimateGasCalls).toHaveLength(2)
    const [c1, c2] = H.state.estimateGasCalls
    expect(c1.data).not.toBe('0x')
    expect(c2.data).not.toBe('0x')
    expect(c1.data).not.toBe(c2.data)   // paymaster izni != toplayici izni
  })
})

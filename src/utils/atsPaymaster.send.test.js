// executeAtsTransfer — v3 gonderim akisi.
// Kapsanan: mod bazli op sayisi, makbuzlu TEK yeniden deneme (YALNIZ ag hatasinda — txHash
// URETILDIYSE asla), makbuz dogrulamasinin waitForTransaction zaman asimindan kurtulmasi,
// paymaster allowlist'in uctan uca baglanmasi, sponsor mod uyusmazliginin (transfer op'una
// backend bootstrap donmesi) yakalanmasi, onRelayed bildirimi.
//
// Onboarding (7702 authorization + initCode marker + txCount 'pending') burada YENIDEN
// test EDILMEZ: bu davranis artik sdk/flow.ts'in sorumlulugu ve flow.test.js'te zaten
// kanitlanmis (bkz. 'delege DEGILSE authorization imzalar ve marker initCode kullanir').
// Buradaki senaryolarin cogu status.delegated=true ile calisir; atsPaymaster.js'e ozgu olan
// tek sey ONA gore op sayisi/allowlist/retry kurmasidir (txCount 'pending' cagrisi haric —
// bkz. asagidaki minor regresyon testi).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ADDR = '0x' + '1'.repeat(40)
const PK = '0x' + '1'.repeat(64)
const PM = '0x767F90D739812D707719F3dcc131bD86BC2255f6'   // 42161 paymaster'i
const PREFIX = PM + '0'.repeat(64)
const CALL = { to: '0x' + '9'.repeat(40), value: '0', data: '0x' }
const DELEGATE = '0x268D193D74D3B9a13a82DA831302cf8DBdC9245A' // atsConfig'teki gercek 42161 delegesi

const H = vi.hoisted(() => ({ state: {} }))

// Backend'in classify'i TEK fonksiyondur ve zincirin O ANKI durumuna bakar: bootstrap
// akisinda 1. op (approve) icin 'bootstrap' doner; o op indikten SONRA izin olustugu icin 2.
// op (asil transfer) icin 'normal' doner. Mock bunu boyle taklit etmeli — iki op'a da
// 'bootstrap' dondurmek zincirde IMKANSIZ bir cevaptir ve minor 7'nin duzeltmesi (transfer
// op'u artik 'normal' bekler) yanlislikla kirilmis gorunurdu.
// Ayrim callData uzerinden yapilir; boylece op1'in YENIDEN DENEMESI de dogru sekilde
// 'bootstrap' almaya devam eder.
const sponsorMode = (req) => {
  const m = H.state.status.mode
  if (m !== 'bootstrap') return m
  if (H.state.bootstrapCallData === undefined) H.state.bootstrapCallData = req.callData
  return req.callData === H.state.bootstrapCallData ? 'bootstrap' : 'normal'
}

vi.mock('./sdk/gasless', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    GaslessClient: class {
      status() { return Promise.resolve(H.state.status) }
      health() { return Promise.resolve({ ok: true, chains: [{ chainId: 42161, paymaster: PM }] }) }
      quote() {
        // Cagri SAYISI olculur: fiyat kilidi yeniden kullanildiginda ikinci bir /quote
        // OLMAMALIDIR (belge 09 katman 1).
        H.state.quoteCount++
        if (H.state.quoteFailures > 0) {
          H.state.quoteFailures--
          return Promise.reject(new Error('quote dustu'))
        }
        return Promise.resolve(
          H.state.quote || { atsFee: '10', atsFeeCrosschain: '20', quoteId: `Q${H.state.quoteCount}` })
      }
      sponsor(req) {
        H.state.sponsorReqs.push(req)
        if (H.state.sponsorErrors && H.state.sponsorErrors.length) {
          const err = new Error('sponsor reddetti')
          err.code = H.state.sponsorErrors.shift()
          return Promise.reject(err)
        }
        // Yanit TASIMADA kayboldu: sunucu tahsilati yapmis olabilir ama onSponsored hic
        // kosmaz, dolayisiyla settlementId yakalanamaz ve makbuz yazilamaz.
        if (H.state.sponsorNetworkFail > 0) {
          H.state.sponsorNetworkFail--
          return Promise.reject(new Error('socket hang up'))
        }
        // Test siniri: paymaster allowlist testleri sponsor'un DONDURDUGU paymaster'i degistirir
        // (bkz. asagidaki 'paymaster allowlist' describe'u) — allowlist kontrolunun sendOneOp
        // icinde GERCEKTEN sarili oldugunu, salt izole assertPaymasterAllowed testinin otesinde
        // gostermek icin.
        const pm = H.state.sponsorPaymasterOverride || PM
        return Promise.resolve({
          paymaster: pm, paymasterAndDataPrefix: pm + '0'.repeat(64), paymasterData: '0xabcd',
          atsFee: '10',
          ...(H.state.noSettlement ? {} : { settlementId: '0xset' }),
          mode: H.state.sponsorModeOverride || sponsorMode(req),
        })
      }
      relay(userOp) {
        H.state.relayCount++
        if (H.state.relayFailures > 0) {
          H.state.relayFailures--
          const err = new Error('relay dustu')
          // Backend kodlu 400 donebilir; cuzdan Turkce METNE degil KODA bakar (atsBlocker).
          if (H.state.relayErrorCode) err.code = H.state.relayErrorCode
          return Promise.reject(err)
        }
        // GERCEK hash'i hesapla: makbuz log'unun topics[1]'i bununla eslesmek ZORUNDA,
        // yoksa extractUserOpSuccess null doner. Boylece imzalanan digest ile dogrulanan
        // digest'in ayni oldugu da kanitlanmis olur. Delege OLMAYAN hesap testinde initCode
        // 7702 marker olur; o zaman eip7702Delegate ZORUNLUDUR (bkz. computeUserOpHash).
        const usesMarker = userOp.initCode && userOp.initCode !== '0x'
        H.state.lastUserOpHash = actual.computeUserOpHash(userOp, {
          chainId: 42161n, entryPoint: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
          ...(usesMarker ? { eip7702Delegate: DELEGATE } : {}),
        })
        if (H.state.relaySuccessFalse) {
          // Backend YANIT VERDI ama basarisiz dedi — bu durumda hala bir txHash var (tx muhtemelen
          // zincire gitti). Review bulgu 1: bu durumda YENIDEN DENENMEMELI.
          return Promise.resolve({ success: false, txHash: '0x' + 'b'.repeat(64) })
        }
        return Promise.resolve({ success: true, txHash: '0x' + 'f'.repeat(64) })
      }
    },
  }
})

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal()
  const TOPIC0 = actual.ethers.id(
    'UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)')
  // Gercek sekilli makbuz: extractUserOpSuccess'in dort kelimelik data'yi cozmesi gerekir
  // (nonce, success, actualGasCost, actualGasUsed).
  const receipt = () => ({
    logs: [{
      address: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
      topics: [TOPIC0, H.state.lastUserOpHash],
      data: actual.ethers.AbiCoder.defaultAbiCoder()
        .encode(['uint256', 'bool', 'uint256', 'uint256'], [0n, H.state.opSuccess, 0n, 0n]),
    }],
  })
  H.makeReceipt = receipt
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: class {
        estimateGas() { return Promise.resolve(40000n) }
        getFeeData() { return Promise.resolve({ maxPriorityFeePerGas: 100n, gasPrice: 5n }) }
        getBlock() { return Promise.resolve({ baseFeePerGas: 1000n }) }
        getCode() { return Promise.resolve('0xef0100268d193d74d3b9a13a82da831302cf8dbdc9245a') }
        getTransactionCount(address, blockTag) {
          H.state.txCountArgs.push({ address, blockTag })
          return Promise.resolve(0)
        }
        waitForTransaction() {
          if (H.state.waitThrows) return Promise.reject(new Error('TIMEOUT'))
          return Promise.resolve(receipt())
        }
        getTransactionReceipt() {
          if (H.state.receiptFails) return Promise.reject(new Error('receipt de dustu'))
          return Promise.resolve(receipt())
        }
      },
      Wallet: class {
        constructor() {
          this.address = ADDR
          this.signingKey = { sign: () => ({ serialized: '0x' + 'cd'.repeat(65) }) }
        }
      },
      // Nonce SENARYOLANABILIR olmali: sabit 0n donduren eski mock, "op zincire indi ama
      // yaniti alamadik" durumunu (nonce ilerlemesi) YAPISAL olarak test edilemez kiliyordu.
      // H.state.nonces bir kuyruktur; bitince son deger tekrarlanir.
      Contract: class {
        getNonce() {
          H.state.nonceReads++
          const q = H.state.nonces
          return Promise.resolve(q.length > 1 ? q.shift() : q[0])
        }
      },
    },
  }
})

const {
  executeAtsTransfer, _resetAtsStatusCache, _resetPaymasterAllowlist, _setAtsSettlementStore,
} = await import('./atsPaymaster')

// chrome.storage node ortaminda YOK; makbuz deposunu testlerde enjekte ediyoruz.
const fakeStore = (initial = {}) => {
  const data = { ...initial }
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (obj) => { Object.assign(data, obj) },
  }
}

beforeEach(() => {
  H.state = {
    status: { ready: true, mode: 'crosschain', delegated: true, blocker: undefined, budget: {} },
    sponsorReqs: [], relayCount: 0, relayFailures: 0, waitThrows: false, receiptFails: false,
    opSuccess: true, sponsorPaymasterOverride: null, sponsorModeOverride: null,
    relaySuccessFalse: false, txCountArgs: [],
    lastUserOpHash: '0x' + '0'.repeat(64),
    nonces: [0n], nonceReads: 0, bootstrapCallData: undefined,
    quoteCount: 0, quoteFailures: 0, sponsorErrors: [],
    sponsorNetworkFail: 0, noSettlement: false, relayErrorCode: null,
  }
  _resetAtsStatusCache()
  _resetPaymasterAllowlist()
  // Varsayilan: depo YOK -> eski bellek ici davranis. Makbuz testleri kendi deposunu kurar.
  _setAtsSettlementStore(null)
})

const args = (over = {}) => ({
  privateKey: PK, chainId: 42161, rpcUrl: 'http://rpc', call: CALL,
  quoted: { mode: H.state.status.mode, transferFee: 5 }, ...over,
})

describe('executeAtsTransfer — mod bazli op sayisi', () => {
  it('crosschain modunda TEK op gonderir (kurulum BSC ye tasindi)', async () => {
    const r = await executeAtsTransfer(args())
    expect(r.ops).toHaveLength(1)
    expect(H.state.relayCount).toBe(1)
  })

  it('normal modunda TEK op gonderir', async () => {
    H.state.status.mode = 'normal'
    const r = await executeAtsTransfer(args())
    expect(r.ops).toHaveLength(1)
  })

  it('bootstrap modunda IKI op gonderir', async () => {
    H.state.status.mode = 'bootstrap'
    const r = await executeAtsTransfer(args())
    expect(r.ops).toHaveLength(2)
    expect(H.state.relayCount).toBe(2)
  })

  it('bootstrap op1 basarisizsa op2 HIC gonderilmez', async () => {
    H.state.status.mode = 'bootstrap'
    H.state.opSuccess = false
    await expect(executeAtsTransfer(args())).rejects.toThrow(/kurulum/)
    expect(H.state.relayCount).toBe(1)
  })

  it('ready:false ise HIC op gondermez ve kodu tasir', async () => {
    H.state.status = { ready: false, blocker: 'remote-not-ready', delegated: true, budget: {} }
    await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'remote-not-ready' })
    expect(H.state.relayCount).toBe(0)
  })
})

describe('executeAtsTransfer — capraz-zincirde gaz', () => {
  // Testler 42161 (Arbitrum) uzerinde kosar, yani kaynak zincir (BSC 56) DEGIL: tahsilat
  // her kosulda BSC'deki toplayici uzerinden yapilir ve remote paymaster'in postOp'u YOKTUR.
  it('hedef zincirde paymasterPostOpGasLimit SIFIR gonderilir', async () => {
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs[0].gas.paymasterPostOpGasLimit).toBe(0n)
  })

  // GERCEK VAKA (2026-08-10): bu testin ESKI hali "mode normal ise postOp'a limit ayrilir"
  // diyordu — yani gaz butcesini /status'un `mode` alanina bagliyordu. Canlida chainId 1
  // icin backend mode:"bootstrap" dondu ama ucreti BSC'den (capraz-zincir) tahsil etmeye
  // calisti. `mode` HEDEF zincirdeki sponsorluk seklidir; tahsilatin nerede oldugunu
  // SOYLEMEZ. Mod ne olursa olsun hedef zincirde postOp butcesi ayirmak, capraz-zincirde
  // IADESI OLMAYAN bir fazla odemedir.
  it('mod degisse bile hedef zincirde postOp butcesi ayrilmaz', async () => {
    for (const mode of ['normal', 'bootstrap']) {
      H.state.sponsorReqs.length = 0
      H.state.status.mode = mode
      await executeAtsTransfer(args())
      expect(H.state.sponsorReqs[0].gas.paymasterPostOpGasLimit, mode).toBe(0n)
    }
  })
})

describe('executeAtsTransfer — makbuzlu yeniden deneme (yalniz AG hatasinda)', () => {
  // Review bulgu 1: yeniden deneme yalniz txHash'in HIC uretilmedigi (ag hatasi) durumda
  // gecerlidir — relay isteginin kendisi reddedilirse islem zincire hic ulasmamis demektir.
  it('relay istegi txHash uretmeden duserse (ag hatasi) ayni settlementId ile TEK KEZ tekrar dener', async () => {
    H.state.relayFailures = 1
    const r = await executeAtsTransfer(args())
    expect(H.state.relayCount).toBe(2)
    expect(H.state.sponsorReqs).toHaveLength(2)
    expect(H.state.sponsorReqs[0].settlement).toBeUndefined()
    expect(H.state.sponsorReqs[1].settlement).toEqual({ id: '0xset', atsAmount: '10' })
    expect(r.txHash).toBeTruthy()
  })

  it('ikinci deneme de duserse UCUNCU deneme YAPILMAZ', async () => {
    H.state.relayFailures = 2
    await expect(executeAtsTransfer(args())).rejects.toThrow()
    expect(H.state.sponsorReqs).toHaveLength(2)
  })
})

// Review bulgu 1 (controller karari — plan tablosu galip): relay txHash URETTIYSE islem
// ZINCIRE GITMISTIR; makbuz okunamamasi ya da relay'in kendisinin basarisiz demesi bunu
// degistirmez. Bu durumda AYNI NONCE ile yeniden denemek 2026-08-05'teki yanlis-negatifin
// (makbuz vermeyen RPC) ta kendisini tekrarlar VEYA AA25/cift-gonderim riski dogurur.
describe('executeAtsTransfer — txHash uretildiyse YENIDEN DENENMEZ', () => {
  it('relay basariyla dondu ama makbuz HICBIR yoldan dogrulanamadi -> relayCount 1 kalir, hata txHash tasir', async () => {
    H.state.waitThrows = true
    H.state.receiptFails = true
    const err = await executeAtsTransfer(args()).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('dogrulanamadi')
    expect(err.txHash).toBeTruthy()
    expect(err.userOpHash).toBeTruthy()
    expect(H.state.relayCount).toBe(1)
    expect(H.state.sponsorReqs).toHaveLength(1)
  })

  it('relay basarisiz dondu (success:false, txHash VAR) -> relayCount 1 kalir, hata txHash tasir', async () => {
    H.state.relaySuccessFalse = true
    const err = await executeAtsTransfer(args()).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.txHash).toBeTruthy()
    expect(H.state.relayCount).toBe(1)
    expect(H.state.sponsorReqs).toHaveLength(1)
  })
})

describe('executeAtsTransfer — makbuz beklemesi', () => {
  it('waitForTransaction zaman asimina ugrasa bile getTransactionReceipt ile sonuc okunur', async () => {
    // 2026-08-05: makbuz vermeyen RPC yuzunden zincirde BASARILI islem "dogrulanamadi" ciktı.
    H.state.waitThrows = true
    const r = await executeAtsTransfer(args())
    expect(r.txHash).toBeTruthy()
  })
})

// Eski atsPaymaster.orchestration.test.js'in "sponsor paymaster mutabakati" testinden tasindi
// (bkz. rapor): mekanizma birebir esitlikten allowlist'e degisti ama davranis hala gecerli —
// backend allowlist DISINDA bir paymaster dondururse gonderim durmali, imza/relay hic olmamali.
describe('executeAtsTransfer — paymaster allowlist uctan uca', () => {
  it('backend allowlist disinda bir paymaster dondururse gonderim IPTAL, relay hic olmaz', async () => {
    H.state.sponsorPaymasterOverride = '0x' + '9'.repeat(40)
    await expect(executeAtsTransfer(args())).rejects.toThrow(/paymaster/i)
    expect(H.state.relayCount).toBe(0)
  })
})

// Eski atsPaymaster.orchestration.test.js'in "onRelayed" bolumunden tasindi (bkz. rapor):
// txHash + kind relay doner donmez (makbuz beklemeden ONCE) bildirilir; bildirim atarsa akis
// bozulmaz (best-effort).
describe('executeAtsTransfer — onRelayed bildirimi', () => {
  it('bootstrap modunda her op icin dogru kind ile bildirilir', async () => {
    H.state.status.mode = 'bootstrap'
    const seen = []
    await executeAtsTransfer(args({ onRelayed: (e) => seen.push(e.kind) }))
    expect(seen).toEqual(['bootstrap', 'transfer'])
  })

  it('onRelayed firlatirsa akis bozulmaz (best-effort)', async () => {
    const r = await executeAtsTransfer(args({ onRelayed: () => { throw new Error('depo yazilamadi') } }))
    expect(r.txHash).toBeTruthy()
  })
})

// Minor (review): eski orchestration testinde vardi, gecise kaybolmustu. Delege OLMAYAN hesapta
// authorization nonce'u 'pending' etiketiyle okunmali — 'latest' okunursa bekleyen bir islem
// authorization'i sessizce gecersiz kilar.
describe('executeAtsTransfer — delege olmayan hesapta txCount (minor regresyon)', () => {
  it("getTransactionCount 'pending' blok etiketiyle cagrilir", async () => {
    H.state.status.delegated = false
    await executeAtsTransfer(args())
    expect(H.state.txCountArgs).toHaveLength(1)
    expect(H.state.txCountArgs[0].blockTag).toBe('pending')
  })
})

// Review bulgu 2: transfer op'una (mod normal/crosschain) backend bootstrap donerse gonderim
// uctan uca durmali — sadece izole assertSponsorModeConsistent testinin otesinde.
describe('executeAtsTransfer — sponsor mod uyusmazligi (review bulgu 2)', () => {
  it('crosschain modunda backend bootstrap dondururse gonderim IPTAL, relay hic olmaz', async () => {
    H.state.sponsorModeOverride = 'bootstrap'
    await expect(executeAtsTransfer(args())).rejects.toThrow(/bootstrap/i)
    expect(H.state.relayCount).toBe(0)
  })

  // Minor 7: iki-op akisinda HER IKI op'a da expectedMode: status.mode ('bootstrap')
  // geciriliyordu. 'bootstrap' beklentisi assertSponsorModeConsistent'in YALNIZ UYARAN koluna
  // duser — yani kontrol tam da spec §4.11'in olumcul saydigi op'ta (kullanicinin gercek
  // transferi) kapaliydi. Op2 artik 'normal' bekler ve uyusmazlik OLUMCULDUR.
  it('bootstrap akisinda TRANSFER op una backend bootstrap dondururse IPTAL (op1 inmis olsa bile)', async () => {
    H.state.status.mode = 'bootstrap'
    // Her iki op'a da 'bootstrap' dondur: op1 icin bu BEKLENEN cevap (gecer), op2 icin ise
    // kullanicinin gercek transferini kurulum op'u sanmak demektir (olumcul).
    H.state.sponsorModeOverride = 'bootstrap'
    await expect(executeAtsTransfer(args())).rejects.toThrow(/bootstrap/i)
    expect(H.state.relayCount).toBe(1)   // op1 gonderildi, op2 IMZADAN ONCE durdu
  })
})

// Review bulgu (kritik): /relay yanitini alamadigimizda nonce TAZELENIYORDU. ERC-4337'de
// key-0 nonce'u yalnizca o sender'in bir op'u CALISTIGINDA ilerler — yani degismis bir nonce
// "op zincire indi" demektir. Eski kod tam bu sinyali okuyup atiyor ve n+1 ile YENI bir
// quote/sponsor/relay turu baslatiyordu: kullanicinin transferi IKINCI KEZ calisirdi (deger
// iki kez gider, ucret iki kez odenir).
describe('executeAtsTransfer — nonce ilerlediyse YENIDEN GONDERILMEZ', () => {
  it('relay ag hatasiyla duser ve nonce ilerlemisse ikinci bir relay/sponsor YAPILMAZ', async () => {
    H.state.relayFailures = 1
    H.state.nonces = [7n, 8n]     // ilk okuma 7 (op bununla gonderildi), sonraki okuma 8 = op indi
    const err = await executeAtsTransfer(args()).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(/dogrulanamadi/i)
    expect(err.txHash).toBeUndefined()          // relay yaniti hic gelmedi
    expect(err.userOpHash).toBeTruthy()         // ama op'un tanitici hash'i tasinir
    expect(H.state.relayCount).toBe(1)          // IKINCI relay YOK
    expect(H.state.sponsorReqs).toHaveLength(1) // ikinci sponsor da YOK
  })

  it('nonce DEGISMEDIYSE ayni nonce ile bir kez yeniden dener (ve nonce tazelenmez)', async () => {
    H.state.relayFailures = 1
    H.state.nonces = [7n]
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs).toHaveLength(2)
    expect(H.state.sponsorReqs[0].nonce).toBe(7n)
    expect(H.state.sponsorReqs[1].nonce).toBe(7n)   // AYNI nonce — makbuz da ancak boyle tutar
  })
})

// Belge 09, KATMAN 1 (fiyat kilidi). Yeniden denemede TAZE bir /quote almak, "ayni quoteId ->
// ayni ucret -> ayni settlementId -> settled[id] eslesir -> ikinci tahsilat YOK" zincirini
// kirar. Kirilma senaryosu makbuz katmaniyla KAPANMAZ: /sponsor sunucuda BASARILI olup yaniti
// tasimada kaybolursa (baglanti koptu / CDN 504) onSponsored hic kosmaz, settlementId
// yakalanamaz ve kalici makbuz da yazilamaz. Geriye tek savunma olarak kilit kalir.
describe('executeAtsTransfer — fiyat kilidi (quoteId) yeniden denemede KORUNUR', () => {
  it('ikinci /sponsor ILK denemenin quoteId sini tasir ve IKINCI bir /quote yapilmaz', async () => {
    H.state.relayFailures = 1
    // Makbuzu devre disi birak: bu testin olctugu sey KILIT, makbuz degil.
    H.state.noSettlement = true
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs).toHaveLength(2)
    expect(H.state.quoteCount).toBe(1)                     // taze quote ALINMADI
    expect(H.state.sponsorReqs[0].quoteId).toBe('Q1')
    expect(H.state.sponsorReqs[1].quoteId).toBe('Q1')      // AYNI kilit
  })

  it('sunucu yaniti KAYBOLSA bile (sponsor ag hatasi) kilit korunur', async () => {
    // onSponsored hic kosmaz -> settlementId yok, makbuz yok. Kilit tek savunma.
    H.state.sponsorNetworkFail = 1
    await executeAtsTransfer(args())
    expect(H.state.quoteCount).toBe(1)
    expect(H.state.sponsorReqs[1].quoteId).toBe('Q1')
    expect(H.state.sponsorReqs[1].settlement).toBeUndefined()
  })

  it('MAKBUZ varsa quoteId GONDERILMEZ (makbuz kilidin onunde gelir)', async () => {
    H.state.relayFailures = 1
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs[1].settlement).toEqual({ id: '0xset', atsAmount: '10' })
    expect(H.state.sponsorReqs[1].quoteId).toBeUndefined()
    expect(H.state.quoteCount).toBe(1)   // makbuz zaten /quote u atlatir
  })

  it('/quote un KENDISI duserse kilit olusmamistir; yeniden denemede TAZE quote alinir', async () => {
    H.state.quoteFailures = 1
    await executeAtsTransfer(args())
    expect(H.state.quoteCount).toBe(2)
    expect(H.state.sponsorReqs).toHaveLength(1)
    expect(H.state.sponsorReqs[0].quoteId).toBe('Q2')
  })
})

// Sunucu makbuzu REDDETTIYSE (settlement-mismatch / settlement-unpaid) o kayit oludur.
// Depoda birakmak her denemede ayni reddi uretir ve op 24 saat takili kalir.
describe('executeAtsTransfer — reddedilen makbuz depodan SILINIR', () => {
  const KEY = 'ats_pending_settlements'
  for (const code of ['settlement-mismatch', 'settlement-unpaid']) {
    it(`${code} geldiginde kayit silinir ve yeniden deneme makbuzsuz gider`, async () => {
      // Once gecerli sekilli bir kayit uret.
      const store = fakeStore()
      _setAtsSettlementStore(store)
      H.state.waitThrows = true
      H.state.receiptFails = true
      await executeAtsTransfer(args()).catch(() => {})
      const saved = store.data[KEY]
      expect(Object.keys(saved)).toHaveLength(1)

      // Yeni kosu: depodaki makbuz sunulur, sunucu REDDEDER.
      H.state = {
        ...H.state, sponsorReqs: [], relayCount: 0, waitThrows: false, receiptFails: false,
        quoteCount: 0, sponsorErrors: [code],
      }
      const store2 = fakeStore({ [KEY]: saved })
      _setAtsSettlementStore(store2)
      await executeAtsTransfer(args())
      expect(H.state.sponsorReqs[0].settlement).toBeTruthy()      // 1. deneme makbuzu sundu
      expect(H.state.sponsorReqs[1].settlement).toBeUndefined()   // 2. deneme SUNMADI
      expect(Object.keys(store2.data[KEY])).toHaveLength(0)       // olu kayit silindi
    })
  }
})

// background.js hatanin `code`'unu atsBlocker'a tasiyor. Nonce-ilerledi dalinda TAZE bir
// Error uretiliyordu ve orijinal kod dusuyordu -> makine-okunur sebep kaybolur, kullanici
// jenerik bir karta duser.
describe('executeAtsTransfer — nonce ilerledi hatasinda orijinal kodu KORUNUR', () => {
  it('orijinal hatanin code alani yeni hataya tasinir', async () => {
    H.state.relayFailures = 1
    H.state.relayErrorCode = 'rate-stale'
    H.state.nonces = [7n, 8n]
    const err = await executeAtsTransfer(args()).catch((e) => e)
    expect(err.message).toMatch(/dogrulanamadi/i)
    expect(err.code).toBe('rate-stale')
    expect(err.txHash).toBeUndefined()
  })
})

// Is kurali ihlalleri GECICI DEGILDIR. Yeniden denemek /sponsor'u bir kez daha cagirir; BSC
// bootstrap'inda bu, adres basina 3 ile sinirli hakkin ikincisini yakar (belge 11).
describe('executeAtsTransfer — kalici (is kurali) hatalarda yeniden deneme YOK', () => {
  it('mod uyusmazliginda tek sponsor cagrisi yapilir, ikinci deneme olmaz', async () => {
    H.state.sponsorModeOverride = 'bootstrap'
    await expect(executeAtsTransfer(args())).rejects.toThrow(/bootstrap/i)
    expect(H.state.sponsorReqs).toHaveLength(1)
  })
  it('izinsiz paymaster donduginde de tek sponsor cagrisi yapilir', async () => {
    H.state.sponsorPaymasterOverride = '0x' + '9'.repeat(40)
    await expect(executeAtsTransfer(args())).rejects.toThrow(/paymaster/i)
    expect(H.state.sponsorReqs).toHaveLength(1)
  })
  it('ucret onaylanan tutari astiginda da tekrar DENENMEZ', async () => {
    // 3 ATS'lik taze quote'a karsi 1 ATS onaylanmis: 3 > 1 * 1.25 -> iptal.
    H.state.quote = { atsFee: '3000000000000000000', atsFeeCrosschain: '3000000000000000000', quoteId: 'Q1' }
    await expect(executeAtsTransfer(args({ quoted: { transferFee: 1 } }))).rejects.toThrow(/asti/i)
    expect(H.state.sponsorReqs).toHaveLength(0)   // /quote asamasinda durdu, sponsor hic cagrilmadi
    expect(H.state.relayCount).toBe(0)
  })
})

// Capraz-zincirde ucret IMZADAN ONCE tahsil edilir. Makbuz yalnizca sendOneOp'un yerel
// degiskeninde tutuluyordu: MV3 worker'i herhangi bir await'te sonlanirsa odenmis ucretin
// tek kaniti kaybolur ve kullanici ayni op icin IKINCI KEZ oder.
describe('executeAtsTransfer — makbuzun KALICI deposu', () => {
  const KEY = 'ats_pending_settlements'
  // Depodaki kaydin gaz parmak izi, quote/sponsor'un kuracagi gaz alanlariyla BIREBIR ayni
  // olmali. Testin bunu elle kurmasi kirilgan olurdu; bunun yerine sonucu dogrulanamayan bir
  // kosu yapip GERCEK kaydi depodan okuyoruz.
  async function captureRecord() {
    const store = fakeStore()
    _setAtsSettlementStore(store)
    H.state.waitThrows = true
    H.state.receiptFails = true
    await executeAtsTransfer(args()).catch(() => {})
    const [key, record] = Object.entries(store.data[KEY] || {})[0] || []
    // Bir sonraki kosu icin durumu temizle (worker yeniden basladi gibi).
    H.state = { ...H.state, sponsorReqs: [], relayCount: 0, waitThrows: false, receiptFails: false }
    return { key, record }
  }

  it('basarili op sonrasi kayit SILINIR (odenmis is icin makbuz tutulmaz)', async () => {
    const store = fakeStore()
    _setAtsSettlementStore(store)
    await executeAtsTransfer(args())
    expect(Object.keys(store.data[KEY] || {})).toHaveLength(0)
  })

  it('sonucu dogrulanamayan op un makbuzu depoda KALIR', async () => {
    const store = fakeStore()
    _setAtsSettlementStore(store)
    H.state.waitThrows = true
    H.state.receiptFails = true
    await executeAtsTransfer(args()).catch(() => {})
    const map = store.data[KEY] || {}
    expect(Object.keys(map)).toHaveLength(1)
    expect(Object.values(map)[0]).toMatchObject({ settlementId: '0xset', atsFee: '10' })
  })

  it('ESLESEN kayit YENI bir kosuda (worker yeniden basladiktan sonra) kullanilir', async () => {
    const { key, record } = await captureRecord()
    expect(record).toBeTruthy()
    // Bellekte hicbir sey yok; makbuzun tek kaynagi depo.
    _setAtsSettlementStore(fakeStore({ [KEY]: { [key]: record } }))
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs[0].settlement).toEqual({ id: '0xset', atsAmount: '10' })
  })

  it('BASKA bir nonce icin kaydedilmis makbuz KULLANILMAZ', async () => {
    const { record } = await captureRecord()
    _setAtsSettlementStore(fakeStore({
      [KEY]: { [`42161:${ADDR.toLowerCase()}:999`]: { ...record, nonce: '999' } },
    }))
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs[0].settlement).toBeUndefined()
  })

  it('ayni nonce ama BASKA callData icin kaydedilmis makbuz KULLANILMAZ', async () => {
    const { key, record } = await captureRecord()
    _setAtsSettlementStore(fakeStore({ [KEY]: { [key]: { ...record, callData: '0xdeadbeef' } } }))
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs[0].settlement).toBeUndefined()
  })

  it('gaz alanlari ayrisirsa makbuz KULLANILMAZ (settlementId gaz tavanini baglar)', async () => {
    const { key, record } = await captureRecord()
    _setAtsSettlementStore(fakeStore({ [KEY]: { [key]: { ...record, gasKey: 'baska:gaz:izi' } } }))
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs[0].settlement).toBeUndefined()
  })

  it('24 saatten eski kayit KULLANILMAZ', async () => {
    const { key, record } = await captureRecord()
    const old = { ...record, savedAt: Date.now() - 25 * 60 * 60 * 1000 }
    _setAtsSettlementStore(fakeStore({ [KEY]: { [key]: old } }))
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs[0].settlement).toBeUndefined()
  })
})

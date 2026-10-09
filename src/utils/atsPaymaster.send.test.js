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
  const { keccak256, encodeAbiParameters } = await import('viem')

  // K12 SUNUCU BENZETIMI (paymaster server/sponsor.ts + crosschain.ts + xc-fee-auth.ts):
  // makbuz kimligi imzalanan mesajin alti alanindan turer; tahsilat imzadan sonra, bakiye/izin
  // kontrolu "zaten odendi"den ONCE yapilir; makbuzla gelen istek imza istemez.
  // maxCostCap = istegin gaz alanlarindan (server/userop.ts maxCost): yanlis gazla sunulan makbuz
  // sunucuda baska bir kimlik uretir ve settlement-mismatch alir — benzetim bunu yakalamali.
  const maxCostOf = (g) => String(
    (BigInt(g.verificationGasLimit) + BigInt(g.callGasLimit) + BigInt(g.preVerificationGas)
      + BigInt(g.paymasterVerificationGasLimit) + BigInt(g.paymasterPostOpGasLimit)) * BigInt(g.maxFeePerGas))
  const xcMessage = ({ sender, callData, nonce, gas }) => ({
    dstChainId: '42161', sender, nonce: BigInt(nonce).toString(), callDataHash: keccak256(callData),
    maxCostCap: maxCostOf(gas), atsAmount: H.state.xc.atsAmount, deadline: 1790000000,
  })
  const xcIdOf = (m) => keccak256(encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }],
    [BigInt(m.dstChainId), m.sender.toLowerCase(), BigInt(m.nonce), m.callDataHash, BigInt(m.maxCostCap), BigInt(m.atsAmount)],
  ))
  H.xcIdOf = xcIdOf
  H.xcMessage = xcMessage
  const kodlu = (code, status = 400, message = code) => Object.assign(new Error(message), { code, status })
  H.xcSponsor = (req) => {
    const xc = H.state.xc
    const ok = (extra) => ({
      paymaster: PM, paymasterAndDataPrefix: PREFIX, paymasterData: '0xabcd',
      atsFee: xc.atsAmount, mode: 'crosschain', ...extra,
    })
    if (H.state.sponsorErrors.length) {
      const s = H.state.sponsorErrors.shift()
      if (typeof s === 'string') throw kodlu(s)
      throw Object.assign(new Error(s.message || s.code || 'hata'), { code: s.code, status: s.status })
    }
    if (req.settlement) {
      const mid = xcIdOf({ ...xcMessage(req), atsAmount: String(req.settlement.atsAmount) })
      if (String(req.settlement.id).toLowerCase() !== mid.toLowerCase()) throw kodlu('settlement-mismatch')
      if (!xc.paid.has(mid)) throw kodlu('settlement-unpaid')
      return ok({ settlementId: mid, settlementReused: true, atsFee: String(req.settlement.atsAmount) })
    }
    const id = xcIdOf(xcMessage(req))
    if (xc.paid.has(id)) {
      // Ayni istegin TEKRARI: sunucu bakiye/izni "zaten odendi" kontrolunden ONCE yoklar; yeterse
      // collectOnSource 'alreadySettled' der ve yeniden imzalar (server/crosschain.ts).
      if (xc.drainedAfterCollect) throw kodlu('src-balance-missing')
      return ok({ settlementId: id })
    }
    if (!req.feeAuthSignature && xc.required) throw kodlu('xc-fee-auth-required')
    if (xc.hangBeforeCollect) { xc.hangBeforeCollect = false; return new Promise(() => {}) }
    if (xc.unreachable > 0) { xc.unreachable--; throw new Error('socket hang up') }   // sunucuya ULASMADI
    xc.paid.add(id)                                                                    // TAHSIL EDILDI
    if (xc.hangAfterCollect > 0) { xc.hangAfterCollect--; return new Promise(() => {}) }  // yanit HIC gelmez
    if (xc.loseResponse > 0) { xc.loseResponse--; throw new Error('socket hang up') } // yanit kayboldu
    return ok({ settlementId: id })
  }

  return {
    ...actual,
    GaslessClient: class {
      status() { return Promise.resolve(H.state.status) }
      health() { return Promise.resolve({ ok: true, chains: [{ chainId: 42161, paymaster: PM }] }) }
      quote(gas, sender, callData, nonce) {
        // Cagri SAYISI olculur: fiyat kilidi yeniden kullanildiginda ikinci bir /quote
        // OLMAMALIDIR (belge 09 katman 1).
        H.state.quoteCount++
        H.state.quoteArgs.push({ sender, callData, nonce })
        if (H.state.quoteFailures > 0) {
          H.state.quoteFailures--
          return Promise.reject(new Error('quote dustu'))
        }
        const base = H.state.quote || { atsFee: '10', atsFeeCrosschain: '20', quoteId: `Q${H.state.quoteCount}` }
        if (!H.state.xc || nonce === undefined || !callData) return Promise.resolve(base)
        return Promise.resolve({
          ...base,
          feeAuth: {
            domain: { name: 'ATS Crosschain Gas', version: '1', chainId: 56, verifyingContract: '0xE39E4D2EAb51b7a77D2d6bf35b1C0501B7cB75cF', ...(H.state.feeAuthDomainOver || {}) },
            types: { ...(H.state.feeAuthTypesExtra || {}), XcFeeAuth: [
              { name: 'dstChainId', type: 'uint256' }, { name: 'sender', type: 'address' },
              { name: 'nonce', type: 'uint256' }, { name: 'callDataHash', type: 'bytes32' },
              { name: 'maxCostCap', type: 'uint256' }, { name: 'atsAmount', type: 'uint256' },
              { name: 'deadline', type: 'uint64' },
            ] },
            primaryType: 'XcFeeAuth',
            message: H.xcMessage({ sender, callData, nonce, gas }),
          },
        })
      }
      sponsor(req) {
        H.state.sponsorReqs.push(req)
        if (H.state.onSponsorCall) H.state.onSponsorCall(req)
        if (H.state.xc) {
          try {
            const r = H.xcSponsor(req)
            return r && typeof r.then === 'function' ? r : Promise.resolve(r)
          } catch (e) { return Promise.reject(e) }
        }
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
        getBlock() { return Promise.resolve({ baseFeePerGas: H.state.baseFee ?? 1000n }) }
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
  _setXcRateLimitWait,
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
    quoteArgs: [], xc: null, baseFee: undefined, onSponsorCall: null,
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

// Capraz-zincirde /sponsor BASARILI donmus (onaylanmis) bir makbuzu sunucu reddederse bu
// BEKLENMEZ (paymaster rehberi "Yeniden deneme" C/3): yeni teklif alinmaz, durulur ve kayit
// KALIR. Eskiden kayit silinip makbuzsuz tekrar deneniyordu — zamanla taze bir teklife, yani
// ikinci bir tahsilata varabilirdi (K12 oncesi kayitlar ve imzasiz tahsilatlar dahil).
describe('executeAtsTransfer — reddedilen onaylanmis makbuz', () => {
  const KEY = 'ats_pending_settlements'
  for (const code of ['settlement-mismatch', 'settlement-unpaid']) {
    it(`${code} geldiginde durur, makbuzsuz tekrar DENEMEZ ve kayit KALIR`, async () => {
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
      await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code })
      expect(H.state.sponsorReqs).toHaveLength(1)                 // makbuzsuz ikinci deneme YOK
      expect(H.state.sponsorReqs[0].settlement).toBeTruthy()
      expect(H.state.quoteCount).toBe(0)
      expect(Object.keys(store2.data[KEY])).toHaveLength(1)       // kayit KALDI (operator inceler)
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

  // ONCEKI SURUMUN KAYDI (anahtarda callData yok, makbuz gazini tasimiyor): yalniz gaz izi
  // BIREBIR tutarsa kullanilir — kimlik gaz tavanini baglar.
  const eskiKayit = async (gasKeyOver) => {
    const { record } = await captureRecord()
    const eski = {
      chainId: 42161, sender: record.sender, nonce: record.nonce, callData: record.callData,
      gasKey: gasKeyOver ?? record.gasKey, settlementId: record.settlementId, atsFee: record.atsFee,
      savedAt: Date.now(),
    }
    return { [`42161:${String(record.sender).toLowerCase()}:${record.nonce}`]: eski }
  }

  it('onceki surumun kaydi gaz izi tutuyorsa kullanilir', async () => {
    _setAtsSettlementStore(fakeStore({ [KEY]: await eskiKayit() }))
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs[0].settlement).toEqual({ id: '0xset', atsAmount: '10' })
  })

  it('onceki surumun kaydi gaz izi ayrisirsa KULLANILMAZ', async () => {
    _setAtsSettlementStore(fakeStore({ [KEY]: await eskiKayit('baska:gaz:izi') }))
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs[0].settlement).toBeUndefined()
  })

  // Kayit op tamamlanana kadar tutulur; 24 saat KISAYDI (nonce ilerlemeden bir gun sonra ayni op
  // yeniden gonderilince odenmis makbuz silinmis olur, ucret ikinci kez alinirdi). Sinir 7 gun.
  it('bir gunluk kayit hala KULLANILIR', async () => {
    const { key, record } = await captureRecord()
    _setAtsSettlementStore(fakeStore({ [KEY]: { [key]: { ...record, savedAt: Date.now() - 25 * 60 * 60 * 1000 } } }))
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs[0].settlement).toEqual({ id: '0xset', atsAmount: '10' })
  })

  it('7 gunden eski kayit KULLANILMAZ', async () => {
    const { key, record } = await captureRecord()
    const old = { ...record, savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }
    _setAtsSettlementStore(fakeStore({ [KEY]: { [key]: old } }))
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs[0].settlement).toBeUndefined()
  })
})

// CAPRAZ-ZINCIR UCRET YETKISI (K12) — paymaster docs/cuzdan-xc-ucret-yetkisi-gecis.md.
// Sunucu BSC'den ATS cekmeden once odeyicinin EIP-712 imzasini ister. Asil risk imza degil,
// YENIDEN DENEME: ucretin cekilmis olabilecegi bir durumda yeni /quote + yeni imza ikinci bir
// tahsilat demektir ve iade yolu yoktur. Kurallar: A (kesin red) -> bir kez taze teklif;
// B (belirsiz) -> once ayni govde, sonra makbuz; C (sponsor basarili) -> asla yeni imza.
describe('executeAtsTransfer — capraz-zincir ucret yetkisi (K12)', () => {
  const KEY = 'ats_pending_settlements'
  const xc = (over = {}) => ({
    required: true, atsAmount: '10', maxCostCap: '1000', paid: new Set(),
    unreachable: 0, loseResponse: 0, drainedAfterCollect: false, ...over,
  })
  const kayit = (store) => Object.values(store.data[KEY] || {})[0]

  it('quote a nonce gider; feeAuth imzalanip sponsor a feeAuthSignature olarak gider', async () => {
    H.state.xc = xc()
    const store = fakeStore()
    _setAtsSettlementStore(store)
    await executeAtsTransfer(args())
    expect(H.state.quoteArgs[0].nonce).toBe(0n)
    expect(H.state.sponsorReqs).toHaveLength(1)
    expect(H.state.sponsorReqs[0].feeAuthSignature).toMatch(/^0x[0-9a-f]{130}$/)
    expect(H.state.relayCount).toBe(1)
    expect(Object.keys(store.data[KEY] || {})).toHaveLength(0)   // basari: kayit silindi
  })

  it('imzalanan tutar onaylananı asarsa IMZALANMAZ ve sponsor a gidilmez', async () => {
    H.state.xc = xc({ atsAmount: '9000000000000000000' })   // 9 ATS
    await expect(executeAtsTransfer(args({ quoted: { transferFee: 5 } }))).rejects.toThrow(/asti/i)
    expect(H.state.sponsorReqs).toHaveLength(0)
  })

  // YAZ-ONCE: /sponsor yaniti beklenirken MV3 worker'i olebilir. Aday (makbuz kimligi) imzadan
  // hemen sonra, /sponsor'dan ONCE depoya yazilmali.
  it('makbuz adayi /sponsor dan ONCE depoya yazilir (kimlik = sunucunun settlementId si)', async () => {
    H.state.xc = xc({ unreachable: 99 })
    const store = fakeStore()
    _setAtsSettlementStore(store)
    // Depo ILK /sponsor cagrisi ANINDA okunur: worker tam o anda olse bile aday yazilmis olmali.
    let sponsorAnindaKayit
    let alindi = false
    H.state.onSponsorCall = () => {
      if (alindi) return
      alindi = true
      sponsorAnindaKayit = JSON.parse(JSON.stringify(kayit(store) || null))
    }
    await executeAtsTransfer(args()).catch(() => {})
    const ilk = H.state.sponsorReqs[0]
    const beklenen = H.xcIdOf(H.xcMessage({ sender: ADDR, callData: ilk.callData, nonce: 0n, gas: ilk.gas }))
    expect(sponsorAnindaKayit.candidates).toHaveLength(1)
    expect(sponsorAnindaKayit.candidates[0]).toMatchObject({ id: beklenen, atsAmount: '10' })
    expect(sponsorAnindaKayit.candidates[0].gas.maxFeePerGas).toBe(String(ilk.gas.maxFeePerGas))
    expect(kayit(store).uncertainAt).toBeGreaterThan(0)
  })

  describe('A — kesin red, ucret cekilmedi: BIR KEZ taze teklif + yeni imza', () => {
    for (const hata of [
      'xc-fee-auth-invalid', 'xc-fee-auth-required', 'quote-lock-stale', 'quote-lock-required',
      { message: 'quoteId has expired', status: 400 },
    ]) {
      const ad = typeof hata === 'string' ? hata : hata.message
      it(`${ad} -> taze /quote ile yeniden imzalanir ve gecer`, async () => {
        H.state.xc = xc()
        H.state.sponsorErrors = [hata]
        await executeAtsTransfer(args())
        expect(H.state.quoteCount).toBe(2)
        expect(H.state.sponsorReqs).toHaveLength(2)
        expect(H.state.sponsorReqs[1].quoteId).toBe('Q2')
        expect(H.state.relayCount).toBe(1)
      })
    }

    it('ayni red ikinci kez gelirse DURUR (entegrasyon hatasi, tekrar cozmez)', async () => {
      H.state.xc = xc()
      H.state.sponsorErrors = ['xc-fee-auth-invalid', 'xc-fee-auth-invalid']
      await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'xc-fee-auth-invalid' })
      expect(H.state.sponsorReqs).toHaveLength(2)
    })
  })

  it('xc-fee-auth-format YENIDEN DENENMEZ (imza kodlamasi istemci hatasi)', async () => {
    H.state.xc = xc()
    H.state.sponsorErrors = ['xc-fee-auth-format']
    await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'xc-fee-auth-format' })
    expect(H.state.sponsorReqs).toHaveLength(1)
  })

  it('ilk denemede kullanici engeli (src-allowance-low) yeniden DENENMEZ ve kayit silinir', async () => {
    H.state.xc = xc()
    H.state.sponsorErrors = ['src-allowance-low']
    const store = fakeStore()
    _setAtsSettlementStore(store)
    await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'src-allowance-low' })
    expect(H.state.sponsorReqs).toHaveLength(1)
    expect(Object.keys(store.data[KEY] || {})).toHaveLength(0)   // ucret cekilmedi: aday tutulmaz
  })

  describe('B — sonuc belirsiz: once AYNI govde, sonra makbuz; ASLA yeni imza', () => {
    it('istek sunucuya ulasmadiysa ayni govde (ayni quoteId + ayni imza) bir kez gider ve gecer', async () => {
      H.state.xc = xc({ unreachable: 1 })
      await executeAtsTransfer(args())
      expect(H.state.quoteCount).toBe(1)
      expect(H.state.sponsorReqs).toHaveLength(2)
      expect(H.state.sponsorReqs[1].quoteId).toBe(H.state.sponsorReqs[0].quoteId)
      expect(H.state.sponsorReqs[1].feeAuthSignature).toBe(H.state.sponsorReqs[0].feeAuthSignature)
      expect(H.state.xc.paid.size).toBe(1)                     // TEK tahsilat
      expect(H.state.relayCount).toBe(1)
    })

    // Rehberin uyardigi tuzak: odeme bakiyeyi dusurdu, ayni govdenin tekrari src-balance-missing
    // aliyor. Bu "ucret cekilmedi" DEMEK DEGIL — makbuza sorulur ve op oradan devam eder.
    it('tahsil edilip yanit kaybolduysa: ayni govde engel alir, makbuz odenmis cikar, op devam eder', async () => {
      H.state.xc = xc({ loseResponse: 1, drainedAfterCollect: true })
      await executeAtsTransfer(args())
      expect(H.state.quoteCount).toBe(1)                       // YENI teklif yok
      const [ilk, ayni, makbuz] = H.state.sponsorReqs
      expect(ayni.feeAuthSignature).toBe(ilk.feeAuthSignature)
      expect(makbuz.settlement).toEqual({ id: [...H.state.xc.paid][0], atsAmount: '10' })
      expect(makbuz.feeAuthSignature).toBeUndefined()
      expect(H.state.xc.paid.size).toBe(1)                     // TEK tahsilat
      expect(H.state.relayCount).toBe(1)
    })

    it('makbuz odenmemis cikarsa yeni imza ALINMAZ; xc-fee-pending ile durur ve kayit kalir', async () => {
      H.state.xc = xc({ unreachable: 2 })                      // ilk deneme + ayni govde ulasamadi
      const store = fakeStore()
      _setAtsSettlementStore(store)
      await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'xc-fee-pending' })
      expect(H.state.quoteCount).toBe(1)
      expect(H.state.xc.paid.size).toBe(0)
      const r = kayit(store)
      expect(r.candidates).toHaveLength(1)
      expect(r.uncertainAt).toBeGreaterThan(0)
    })
  })

  describe('B devam — kullanici sonra tekrar dener', () => {
    async function belirsizKayit() {
      H.state.xc = xc({ unreachable: 2 })
      const store = fakeStore()
      _setAtsSettlementStore(store)
      await executeAtsTransfer(args()).catch(() => {})
      const map = store.data[KEY]
      H.state = { ...H.state, sponsorReqs: [], quoteArgs: [], quoteCount: 0, relayCount: 0 }
      return map
    }

    it('5 dakika dolmadan: once makbuz sorulur, odenmemisse YENI imza yine alinmaz', async () => {
      const map = await belirsizKayit()
      _setAtsSettlementStore(fakeStore({ [KEY]: map }))
      await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'xc-fee-pending' })
      expect(H.state.quoteCount).toBe(0)
      expect(H.state.sponsorReqs[0].settlement).toBeTruthy()
    })

    it('makbuz odenmis cikarsa op oradan devam eder (yeni teklif ve imza YOK)', async () => {
      const map = await belirsizKayit()
      const id = Object.values(map)[0].candidates[0].id
      H.state.xc.paid.add(id)                                   // ilk istek sunucuda GEC islendi
      _setAtsSettlementStore(fakeStore({ [KEY]: map }))
      await executeAtsTransfer(args())
      expect(H.state.quoteCount).toBe(0)
      expect(H.state.sponsorReqs[0].settlement).toEqual({ id, atsAmount: '10' })
      expect(H.state.relayCount).toBe(1)
    })

    it('5 dakika dolduysa ve hala odenmemisse taze teklif + imza ile devam eder', async () => {
      const map = await belirsizKayit()
      for (const r of Object.values(map)) r.uncertainAt = Date.now() - 6 * 60 * 1000
      _setAtsSettlementStore(fakeStore({ [KEY]: map }))
      await executeAtsTransfer(args())
      expect(H.state.sponsorReqs[0].settlement).toBeTruthy()   // once makbuz soruldu
      expect(H.state.quoteCount).toBe(1)                        // sonra taze teklif
      expect(H.state.xc.paid.size).toBe(1)
      expect(H.state.relayCount).toBe(1)
    })
  })

  // C kurali ("asla yeniden imzalatmayin") kullanicinin SONRAKI denemesinde de gecerli: gaz
  // tahmini degisse bile makbuz, kaydedildigi gazla sunulur (kimlik gaz tavanini baglar).
  it('odenmis makbuz, yeni denemede gaz tahmini degisse bile KAYITLI gazla kullanilir', async () => {
    H.state.xc = xc()
    const store = fakeStore()
    _setAtsSettlementStore(store)
    H.state.waitThrows = true
    H.state.receiptFails = true
    await executeAtsTransfer(args()).catch(() => {})            // sponsor basarili, sonuc dogrulanamadi
    const map = store.data[KEY]
    const ilkGaz = H.state.sponsorReqs[0].gas
    H.state = {
      ...H.state, sponsorReqs: [], quoteArgs: [], quoteCount: 0, relayCount: 0,
      waitThrows: false, receiptFails: false, baseFee: 9999n,  // gaz fiyati degisti
    }
    _setAtsSettlementStore(fakeStore({ [KEY]: map }))
    await executeAtsTransfer(args())
    expect(H.state.quoteCount).toBe(0)
    expect(H.state.sponsorReqs[0].settlement).toBeTruthy()
    expect(H.state.sponsorReqs[0].gas.maxFeePerGas).toBe(ilkGaz.maxFeePerGas)
    expect(H.state.xc.paid.size).toBe(1)                         // TEK tahsilat
  })
})

describe('executeAtsTransfer — K12 kenar durumlari', () => {
  const KEY = 'ats_pending_settlements'
  const xc = (over = {}) => ({
    required: true, atsAmount: '10', maxCostCap: '1000', paid: new Set(),
    unreachable: 0, loseResponse: 0, drainedAfterCollect: false, ...over,
  })

  // Bozuk ya da ele gecirilmis bir sunucu BASKA bir op'un yetkisini imzalatamaz. Imzalanmadigi
  // gibi kilit IMZASIZ da gonderilmemeli (zorunlu modda reddedilir, gecis modunda imzasiz tahsilat).
  it('sunucu baska bir op un yetkisini dondururse IMZALANMAZ, sponsor a hic gidilmez ve durur', async () => {
    H.state.xc = xc()
    H.state.quote = undefined
    const asil = H.xcMessage
    H.xcMessage = (a) => ({ ...asil(a), nonce: '999' })
    try {
      await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'xc-fee-auth-mismatch' })
    } finally {
      H.xcMessage = asil
    }
    expect(H.state.sponsorReqs).toHaveLength(0)
    expect(H.state.quoteCount).toBe(1)                          // tekrar denenmez: ayni sunucu ayni seyi ister
  })

  // Imza ASAMASINDA dusen bir deneme (/sponsor'a varilmadi): o kilit ancak imzasiyla
  // kullanilabilir. Eski yol kilidi imzasiz tekrar gonderiyordu = gecis modunda imzasiz tahsilat.
  it('imza asamasinda dusen deneme kilidi IMZASIZ tekrar gondermez; taze teklif alir', async () => {
    H.state.xc = xc()
    const asil = H.xcMessage
    H.xcMessage = (a) => ({ ...asil(a), deadline: -1 })        // uint64'e sigmaz: imzalayici reddeder
    try {
      await expect(executeAtsTransfer(args())).rejects.toThrow()
    } finally {
      H.xcMessage = asil
    }
    expect(H.state.quoteCount).toBe(2)                          // ikinci deneme TAZE teklif
    expect(H.state.sponsorReqs).toHaveLength(0)                 // imzasiz istek HIC gitmedi
  })

  it('429 da kisa beklemeden sonra AYNI istek (ayni kilit + ayni imza) bir kez tekrar gider', async () => {
    _setXcRateLimitWait(0)
    H.state.xc = xc()
    H.state.sponsorErrors = [{ code: 'rate-limited', status: 429 }]
    await executeAtsTransfer(args())
    expect(H.state.quoteCount).toBe(1)
    expect(H.state.sponsorReqs).toHaveLength(2)
    expect(H.state.sponsorReqs[1].feeAuthSignature).toBe(H.state.sponsorReqs[0].feeAuthSignature)
    expect(H.state.sponsorReqs[1].quoteId).toBe(H.state.sponsorReqs[0].quoteId)
  })

  it('makbuz sorgusu settlement-mismatch alirsa durur ve kayit SILINMEZ (ucret durumu belirsiz)', async () => {
    H.state.xc = xc({ unreachable: 2 })
    const store = fakeStore()
    _setAtsSettlementStore(store)
    await executeAtsTransfer(args()).catch(() => {})            // belirsiz kayit olusur
    H.state = { ...H.state, sponsorReqs: [], quoteCount: 0, sponsorErrors: ['settlement-mismatch'] }
    const store2 = fakeStore({ [KEY]: store.data[KEY] })
    _setAtsSettlementStore(store2)
    await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'settlement-mismatch' })
    expect(H.state.quoteCount).toBe(0)
    expect(Object.keys(store2.data[KEY])).toHaveLength(1)
  })

  it('basarili bir A tekrarindan sonra kayit SILINIR (cekilmeyen ucretin adayi tutulmaz)', async () => {
    H.state.xc = xc()
    H.state.sponsorErrors = ['xc-fee-auth-invalid']
    const store = fakeStore()
    _setAtsSettlementStore(store)
    await executeAtsTransfer(args())
    expect(Object.keys(store.data[KEY] || {})).toHaveLength(0)
  })
})

describe('executeAtsTransfer — K12 belirsizlik kalicidir', () => {
  const KEY = 'ats_pending_settlements'
  const xc = (over = {}) => ({
    required: true, atsAmount: '10', maxCostCap: '1000', paid: new Set(),
    unreachable: 0, loseResponse: 0, drainedAfterCollect: false, hangAfterCollect: 0, ...over,
  })

  // MV3 worker'i /sponsor yanitini beklerken olebilir. Geride YALNIZ yaz-once kaydi kalir.
  // O kayit "ucus halinde" bir tahsilati temsil eder: sonraki deneme YENI imza almadan once
  // makbuza sormali — ilk istek tahsil ettiyse yeni teklif (kur oynadiysa) ikinci tahsilattir.
  async function olenWorker(xcOver) {
    H.state.xc = xc(xcOver)
    const store = fakeStore()
    _setAtsSettlementStore(store)
    let snapshot
    H.state.onSponsorCall = () => { if (!snapshot) snapshot = JSON.parse(JSON.stringify(store.data)) }
    executeAtsTransfer(args()).catch(() => {})                   // cevap hic gelmeyecek
    await vi.waitFor(() => expect(snapshot).toBeTruthy())
    await new Promise((r) => setTimeout(r, 0))
    H.state = { ...H.state, sponsorReqs: [], quoteArgs: [], quoteCount: 0, relayCount: 0, onSponsorCall: null }
    H.state.xc.atsAmount = '11'                                  // bu arada kur oynadi
    return snapshot
  }

  it('olen worker tahsil ettiyse: sonraki deneme makbuzla devam eder, ikinci tahsilat YOK', async () => {
    const snapshot = await olenWorker({ hangAfterCollect: 1 })
    _setAtsSettlementStore(fakeStore(snapshot))
    await executeAtsTransfer(args())
    expect(H.state.quoteCount).toBe(0)
    expect(H.state.sponsorReqs[0].settlement).toBeTruthy()
    expect(H.state.xc.paid.size).toBe(1)
    expect(H.state.relayCount).toBe(1)
  })

  it('olen worker in istegi sunucuya ulasmadiysa: 5 dk dolmadan yeni imza ALINMAZ', async () => {
    const snapshot = await olenWorker({ unreachable: 0, hangAfterCollect: 0, hangBeforeCollect: true })
    _setAtsSettlementStore(fakeStore(snapshot))
    await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'xc-fee-pending' })
    expect(H.state.quoteCount).toBe(0)
    expect(H.state.xc.paid.size).toBe(0)
  })

  // Rehber C/3: /sponsor BASARILI dondu (makbuz elde), sonra relay dustu; makbuzla tekrar
  // denenince sunucu "odenmemis" diyor. Bu BEKLENMEZ: yeni teklif ALINMAZ, durulur ve kayit
  // kalir (operator inceler). Eski yol kaydi silip zamanla taze teklife gidebiliyordu.
  it('onaylanmis makbuz settlement-unpaid alirsa yeni teklif ALINMAZ, durur, kayit kalir', async () => {
    H.state.xc = xc()
    H.state.relayFailures = 1
    const store = fakeStore()
    _setAtsSettlementStore(store)
    let n = 0
    H.state.onSponsorCall = () => { n++; if (n === 2) H.state.xc.paid.clear() }   // tahsilat zincirden dustu
    await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'settlement-unpaid' })
    expect(H.state.quoteCount).toBe(1)
    expect(H.state.sponsorReqs).toHaveLength(2)
    expect(H.state.sponsorReqs[1].settlement).toBeTruthy()
    expect(Object.keys(store.data[KEY] || {})).toHaveLength(1)
  })

  // Kesin red (A) bir "ucusta" isaretini KALDIRIR: ardindan cagri baska bir sebeple (teklif
  // alinamadi) biterse, sonraki deneme bosuna makbuz sorup 5 dakika bekletilmemeli.
  it('kesin redden sonra biten cagri, sonraki denemeyi BEKLETMEZ', async () => {
    H.state.xc = xc()
    H.state.sponsorErrors = ['xc-fee-auth-invalid']
    const store = fakeStore()
    _setAtsSettlementStore(store)
    let n = 0
    H.state.onSponsorCall = () => { n++; if (n === 1) H.state.quoteFailures = 5 }   // sonraki teklifler duser
    await expect(executeAtsTransfer(args())).rejects.toThrow()
    H.state = { ...H.state, sponsorReqs: [], quoteArgs: [], quoteCount: 0, relayCount: 0, quoteFailures: 0, onSponsorCall: null }
    _setAtsSettlementStore(fakeStore({ [KEY]: store.data[KEY] || {} }))
    await executeAtsTransfer(args())
    expect(H.state.quoteCount).toBe(1)
    expect(H.state.relayCount).toBe(1)
  })

  // Belirsiz bir denemeden sonra gelen komisyon kodu "ucret cekilmedi" DEMEK DEGIL. Eski komisyon
  // yolu kilidi dusurup yeni teklif + yeni imza aliyordu: kur arada oynadiysa ikinci tahsilat.
  it('belirsiz denemeden sonra gelen komisyon kodu yeni imzaya yol ACMAZ', async () => {
    H.state.xc = xc({ loseResponse: 1 })
    let n = 0
    H.state.onSponsorCall = () => {
      n++
      if (n === 1) H.state.xc.atsAmount = '11'                   // ilk tahsilattan sonra kur oynadi
      if (n === 2) H.state.sponsorErrors.push('commission-quote-required')
    }
    await executeAtsTransfer(args({ opKind: 'swap' })).catch(() => {})
    expect(H.state.quoteCount).toBe(1)
    expect(H.state.xc.paid.size).toBe(1)                         // TEK tahsilat
  })
})

// OP KIMLIGI = zincir + gonderen + nonce + callData. Ayni nonce'ta kullanici FARKLI bir op
// baslatirsa (tutari degistirdi, takas yeni rota aldi) iki op'un kayitlari birbirine KARISMAZ:
// eskiden tek anahtar paylasiliyordu, yeni op'un kesin bir reddi ESKI op'un odenmis makbuzunu
// siliyordu (ayni op sonra yeniden gonderilince ucret ikinci kez alinirdi).
describe('executeAtsTransfer — K12 op kimligi ve gaz', () => {
  const KEY = 'ats_pending_settlements'
  const xc = (over = {}) => ({
    required: true, atsAmount: '10', paid: new Set(),
    unreachable: 0, loseResponse: 0, drainedAfterCollect: false, hangAfterCollect: 0, ...over,
  })
  const BASKA = { to: '0x' + '9'.repeat(40), value: '0', data: '0x1234' }

  async function odenmisAmaGonderilmemis() {
    H.state.xc = xc()
    const store = fakeStore()
    _setAtsSettlementStore(store)
    H.state.waitThrows = true
    H.state.receiptFails = true
    await executeAtsTransfer(args()).catch(() => {})            // tahsil edildi, sonuc dogrulanamadi
    H.state = { ...H.state, sponsorReqs: [], quoteArgs: [], quoteCount: 0, relayCount: 0, waitThrows: false, receiptFails: false }
    return store
  }

  it('farkli op un kesin reddi, ESKI op un odenmis makbuzunu SILMEZ', async () => {
    const store = await odenmisAmaGonderilmemis()
    const once = JSON.parse(JSON.stringify(store.data[KEY]))
    expect(Object.keys(once)).toHaveLength(1)
    H.state.sponsorErrors = ['src-allowance-low']
    await expect(executeAtsTransfer(args({ call: BASKA }))).rejects.toMatchObject({ code: 'src-allowance-low' })
    expect(store.data[KEY]).toEqual(once)                         // eski op'un kaydi AYNEN duruyor
  })

  it('eski op ayni haliyle yeniden gonderilince makbuzla devam eder (ikinci tahsilat YOK)', async () => {
    const store = await odenmisAmaGonderilmemis()
    H.state.sponsorErrors = ['src-allowance-low']
    await executeAtsTransfer(args({ call: BASKA })).catch(() => {})
    H.state = { ...H.state, sponsorReqs: [], quoteCount: 0, relayCount: 0 }
    await executeAtsTransfer(args())
    expect(H.state.quoteCount).toBe(0)
    expect(H.state.sponsorReqs[0].settlement).toBeTruthy()
    expect(H.state.xc.paid.size).toBe(1)
    expect(H.state.relayCount).toBe(1)
  })

  it('tahsil edilip yanit kaybolduysa ve bakiye yetiyorsa ayni govde dogrudan gecer', async () => {
    H.state.xc = xc({ loseResponse: 1 })
    await executeAtsTransfer(args())
    expect(H.state.quoteCount).toBe(1)
    expect(H.state.sponsorReqs).toHaveLength(2)
    expect(H.state.sponsorReqs[1].feeAuthSignature).toBe(H.state.sponsorReqs[0].feeAuthSignature)
    expect(H.state.xc.paid.size).toBe(1)
    expect(H.state.relayCount).toBe(1)
  })

  // Makbuz sorgusu adayin TAHSIL EDILDIGI gazla gider (kimlik gaz tavanini baglar); 5 dakika
  // sonra alinan YENI tahsilat ise guncel gazla — eski gaz taban ucretin altinda kalabilir ve
  // odenmis op zincire hic giremez.
  it('5 dk sonrasi yeni tahsilat GUNCEL gazla, makbuz sorgusu adayin gaziyla gider', async () => {
    H.state.xc = xc({ unreachable: 2 })
    const store = fakeStore()
    _setAtsSettlementStore(store)
    await executeAtsTransfer(args()).catch(() => {})
    const eskiGaz = H.state.sponsorReqs[0].gas.maxFeePerGas
    for (const r of Object.values(store.data[KEY])) r.uncertainAt = Date.now() - 6 * 60 * 1000
    H.state = { ...H.state, sponsorReqs: [], quoteArgs: [], quoteCount: 0, relayCount: 0, baseFee: 9999n }
    await executeAtsTransfer(args())
    const [makbuz, taze] = H.state.sponsorReqs
    expect(makbuz.settlement).toBeTruthy()
    expect(makbuz.gas.maxFeePerGas).toBe(eskiGaz)
    expect(taze.settlement).toBeUndefined()
    expect(taze.gas.maxFeePerGas).not.toBe(eskiGaz)
    expect(H.state.relayCount).toBe(1)
  })

  // Rehber: B'ye dusen op'un adaylari op tamamlanana kadar TUTULUR. 5 dakika sonrasi taze deneme
  // kesin bir engelle bitse bile eski aday silinmez — gec tahsil edilmisse bir sonraki deneme
  // onu makbuzla bulur.
  it('5 dk sonrasi taze deneme engelle bitse de ESKI adaylar silinmez', async () => {
    H.state.xc = xc({ unreachable: 2 })
    const store = fakeStore()
    _setAtsSettlementStore(store)
    await executeAtsTransfer(args()).catch(() => {})
    const [eskiAday] = Object.values(store.data[KEY])[0].candidates
    for (const r of Object.values(store.data[KEY])) r.uncertainAt = Date.now() - 6 * 60 * 1000
    H.state = { ...H.state, sponsorReqs: [], quoteArgs: [], quoteCount: 0, relayCount: 0 }
    let n = 0
    H.state.onSponsorCall = () => { n++; if (n === 2) H.state.sponsorErrors.push('src-allowance-low') }
    await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'src-allowance-low' })
    const kalan = Object.values(store.data[KEY])[0]
    expect(kalan.candidates.map((c) => c.id)).toContain(eskiAday.id)
  })
})

describe('executeAtsTransfer — K12 sertlestirme', () => {
  const KEY = 'ats_pending_settlements'
  const xc = (over = {}) => ({
    required: true, atsAmount: '10', paid: new Set(),
    unreachable: 0, loseResponse: 0, drainedAfterCollect: false, hangAfterCollect: 0, ...over,
  })

  // Makbuzla gelen yanit YENI bir tahsilat degildir: onay tavani ilk tahsilatta uygulandi. Fiyat
  // dustukten sonra tekrar uygulamak, ODENMIS op'u her denemede kilitler ve ucret kaybolurdu.
  it('odenmis makbuzla devam ederken guncel onay tavani islemi KILITLEMEZ', async () => {
    H.state.xc = xc({ atsAmount: '6000000000000000000' })      // 6 ATS, onay 5 -> tavan 6.25
    const store = fakeStore()
    _setAtsSettlementStore(store)
    H.state.waitThrows = true
    H.state.receiptFails = true
    await executeAtsTransfer(args({ quoted: { transferFee: 5 } })).catch(() => {})
    H.state = { ...H.state, sponsorReqs: [], quoteCount: 0, relayCount: 0, waitThrows: false, receiptFails: false }
    // Sonraki onay ekrani ucuzladi: 1 ATS (tavan 1.25 < odenmis 6).
    await executeAtsTransfer(args({ quoted: { transferFee: 1 } }))
    expect(H.state.sponsorReqs[0].settlement).toBeTruthy()
    expect(H.state.relayCount).toBe(1)
    expect(H.state.xc.paid.size).toBe(1)
  })

  // B'nin 5 dakikasi SON imzali /sponsor isteginin baslangicindan sayilir. Ayni govdenin
  // tekrari (B.1) kendi baslangicini YAZMAZSA worker o sirada olurse kayit eski zamani gosterir ve
  // sonraki deneme 5 dakika dolmadan yeni imza alabilir.
  it('ayni govde tekrari ucmadan once ucusta isaretini TAZELER', async () => {
    H.state.xc = xc({ unreachable: 1 })
    const store = fakeStore()
    _setAtsSettlementStore(store)
    const isaretler = []
    H.state.onSponsorCall = () => {
      isaretler.push(Object.values(store.data[KEY] || {})[0]?.uncertainAt)
      const t = Date.now(); while (Date.now() - t < 5) { /* zaman ilerlesin */ }
    }
    await executeAtsTransfer(args())
    expect(isaretler).toHaveLength(2)
    expect(isaretler[0]).toBeGreaterThan(0)
    expect(isaretler[1]).toBeGreaterThan(isaretler[0])
  })

  for (const [ad, over] of [
    ['domain.chainId', { feeAuthDomainOver: { chainId: 97 } }],
    ['domain.verifyingContract', { feeAuthDomainOver: { verifyingContract: '0x' + '7'.repeat(40) } }],
    ['domain.version', { feeAuthDomainOver: { version: '2' } }],
    ['types', { feeAuthTypesExtra: { Baska: [{ name: 'x', type: 'uint256' }] } }],
  ]) {
    // Imza YALNIZ BSC'deki gercek ATSGasCollector icin gecerli olmali: baska bir alan/kontrat
    // icin atilmis yetki kullanicinin adina baska bir yerde kullanilabilirdi.
    it(`yetkinin ${ad} alani beklenen degilse IMZALANMAZ ve sponsor a gidilmez`, async () => {
      H.state.xc = xc()
      Object.assign(H.state, over)
      await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'xc-fee-auth-mismatch' })
      expect(H.state.sponsorReqs).toHaveLength(0)
      expect(H.state.quoteCount).toBe(1)
    })
  }

  it('kayit depoya yazilamazsa tahsilat istegi GITMEZ', async () => {
    H.state.xc = xc()
    _setAtsSettlementStore({ get: async () => ({}), set: async () => { throw new Error('depo dolu') } })
    await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'xc-store-failed' })
    expect(H.state.sponsorReqs).toHaveLength(0)
    expect(H.state.xc.paid.size).toBe(0)
  })
})

describe('executeAtsTransfer — K12 yeniden denetim bulgulari', () => {
  const KEY = 'ats_pending_settlements'
  const xc = (over = {}) => ({
    required: true, atsAmount: '10', paid: new Set(),
    unreachable: 0, loseResponse: 0, drainedAfterCollect: false, hangAfterCollect: 0, ...over,
  })

  // Olen worker'in "ucusta" kaydi da bir B donemidir: sonucu bilinmeyen bir aday var. 5 dakika
  // sonrasi taze deneme engelle bitse bile o aday SILINMEZ — sunucu ilk istegi gec tahsil
  // etmis olabilir; kullanici sonra tekrar denediginde makbuzla bulunur.
  it('olen worker in adayi, 5 dk sonrasi engelle biten denemede SILINMEZ ve gec odeme bulunur', async () => {
    H.state.xc = xc({ hangBeforeCollect: true })
    const store = fakeStore()
    _setAtsSettlementStore(store)
    let snapshot
    H.state.onSponsorCall = () => { if (!snapshot) snapshot = JSON.parse(JSON.stringify(store.data)) }
    executeAtsTransfer(args()).catch(() => {})                   // cevap hic gelmeyecek
    await vi.waitFor(() => expect(snapshot).toBeTruthy())
    await new Promise((r) => setTimeout(r, 0))
    const [ilkAday] = Object.values(snapshot[KEY])[0].candidates
    for (const r of Object.values(snapshot[KEY])) r.uncertainAt = Date.now() - 6 * 60 * 1000

    // Yeni worker: makbuz odenmemis -> taze deneme -> engel.
    const store2 = fakeStore(snapshot)
    _setAtsSettlementStore(store2)
    let n = 0
    H.state = { ...H.state, sponsorReqs: [], quoteArgs: [], quoteCount: 0, relayCount: 0 }
    H.state.onSponsorCall = () => { n++; if (n === 2) H.state.sponsorErrors.push('src-allowance-low') }
    await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'src-allowance-low' })
    expect(Object.values(store2.data[KEY])[0].candidates.map((c) => c.id)).toContain(ilkAday.id)

    // Ilk istek gec tahsil edildi; kullanici tekrar dener: makbuzla devam, YENI tahsilat yok.
    H.state.xc.paid.add(ilkAday.id)
    H.state = { ...H.state, sponsorReqs: [], quoteArgs: [], quoteCount: 0, relayCount: 0, onSponsorCall: null }
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs[0].settlement).toBeTruthy()
    expect(H.state.quoteCount).toBe(0)
    expect(H.state.xc.paid.size).toBe(1)
    expect(H.state.relayCount).toBe(1)
  })

  // Onceki surumun kaydi gazi ayri tasimiyor ama gaz izi gazin TAMAMIDIR. Gaz fiyati oynayinca
  // eski kayit yok sayiliyordu ve odenmis op ikinci kez tahsil ediliyordu.
  it('onceki surumun kaydi, gaz izi guncel gazdan farkli olsa da KENDI gaziyla kullanilir', async () => {
    const store = fakeStore()
    _setAtsSettlementStore(store)
    H.state.waitThrows = true
    H.state.receiptFails = true
    await executeAtsTransfer(args()).catch(() => {})
    const record = Object.values(store.data[KEY])[0]
    const parcalar = String(record.gasKey).split(':')
    parcalar[5] = '7777'                                           // maxFeePerGas farkli
    const eski = {
      chainId: 42161, sender: record.sender, nonce: record.nonce, callData: record.callData,
      gasKey: parcalar.join(':'), settlementId: record.settlementId, atsFee: record.atsFee, savedAt: Date.now(),
    }
    H.state = { ...H.state, sponsorReqs: [], quoteCount: 0, relayCount: 0, waitThrows: false, receiptFails: false }
    _setAtsSettlementStore(fakeStore({ [KEY]: { [`42161:${String(record.sender).toLowerCase()}:${record.nonce}`]: eski } }))
    await executeAtsTransfer(args())
    expect(H.state.sponsorReqs[0].settlement).toEqual({ id: '0xset', atsAmount: '10' })
    expect(H.state.sponsorReqs[0].gas.maxFeePerGas).toBe(7777n)
  })

  // Depo okumasi gecici olarak duserse bos harita sanilip YALNIZ bu op'la yeniden yazilmamali:
  // diger op'larin odenmis makbuzlari silinirdi.
  it('depo okunamazsa istek gitmez ve DIGER op larin kayitlari silinmez', async () => {
    H.state.xc = xc()
    const baska = { chainId: 42161, sender: ADDR, nonce: '0', callData: '0xdeadbeef', settlementId: '0xbaska', atsFee: '5', savedAt: Date.now() }
    const data = { [KEY]: { 'baska-op': baska } }
    let okuma = 0
    _setAtsSettlementStore({
      data,
      get: async (k) => { okuma++; if (okuma === 2) throw new Error('gecici okuma hatasi'); return k in data ? { [k]: JSON.parse(JSON.stringify(data[k])) } : {} },
      set: async (o) => { Object.assign(data, JSON.parse(JSON.stringify(o))) },
    })
    await expect(executeAtsTransfer(args())).rejects.toMatchObject({ code: 'xc-store-failed' })
    expect(H.state.sponsorReqs).toHaveLength(0)
    expect(data[KEY]['baska-op']).toEqual(baska)
  })

  // 429 tekrari kendi "ucusta" isaretini yazar; ardindan gelen komisyon kodu (tahsilattan ONCE)
  // o isareti KALDIRMALI — yoksa cagri baska sebeple biterse sonraki deneme bosuna 5 dk bekler.
  it('429 tekrarindan sonra gelen komisyon kodu ucusta isaretini kaldirir', async () => {
    _setXcRateLimitWait(0)
    H.state.xc = xc()
    const store = fakeStore()
    _setAtsSettlementStore(store)
    H.state.sponsorErrors = [{ code: 'rate-limited', status: 429 }, 'commission-quote-required']
    let n = 0
    H.state.onSponsorCall = () => { n++; if (n === 2) H.state.quoteFailures = 5 }
    await expect(executeAtsTransfer(args())).rejects.toThrow()
    const kayit = Object.values(store.data[KEY] || {})[0]
    expect(kayit ? kayit.uncertainAt : null).toBeFalsy()
  })
})

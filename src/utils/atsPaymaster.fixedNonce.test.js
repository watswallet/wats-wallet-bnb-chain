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
    // KULLANICI BUTCESI (decideMode src-*; paymaster sponsor.ts): makbuzsuz her istekte once bakilir.
    // Devri tanimayan sunucu hemen reddeder; taniyan sunucu devir listesi doluysa ERTELER ve devir
    // kullanilamazsa ayni kodu tahsilattan ONCE dondurur.
    const carryOffered = xc.carrySupported && Array.isArray(req.carry) && req.carry.length > 0
    if (xc.budgetBlocker && !carryOffered) throw kodlu(xc.budgetBlocker)
    // ODEME DEVRI (paymaster server/xc-carry.ts): sunucu destekliyorsa ilk gecerli oge kullanilir —
    // tutar >= bu islemin tutari, kimlik istegin sender/nonce/zincirinden yeniden hesaplanir,
    // odenmis olmali. Gecmezse asagidaki normal yol (K12 imzasiyla tahsilat).
    if (xc.carrySupported && Array.isArray(req.carry)) {
      for (const e of req.carry.slice(0, 4)) {
        if (BigInt(e.atsAmount) < BigInt(xc.atsAmount)) continue
        const cid = xcIdOf({
          dstChainId: '42161', sender: req.sender, nonce: BigInt(req.nonce).toString(),
          callDataHash: e.callDataHash, maxCostCap: e.maxCostCap, atsAmount: e.atsAmount,
        })
        if (cid.toLowerCase() !== String(e.id).toLowerCase() || !xc.paid.has(cid)) continue
        return ok({ settlementId: cid, atsFee: String(e.atsAmount), settlementReused: true, settlementCarried: true })
      }
    }
    if (xc.budgetBlocker) throw kodlu(xc.budgetBlocker)
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
      // receiptUserOpHash: makbuzdaki olay BASKA bir op'a aitse sonuc BILINMIYOR (success null).
      topics: [TOPIC0, H.state.receiptUserOpHash || H.state.lastUserOpHash],
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
  executeAtsTransfer, commissionSeedFor, commissionPlanFor, _resetAtsStatusCache, _resetPaymasterAllowlist, _setAtsSettlementStore,
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

describe('executeAtsTransfer — fixedNonce (cowFee write-ahead nonce)', () => {
  // Review Focus 1: iki okuma arasinda baska bir ATS islemi araya girdiyse /sponsor, /quote ve
  // /relay HIC cagrilmadan durulur (cift ucret korumasinin 1. katmani).
  it('fixedNonce 7, zincir nonce 8: NONCE_CHANGED, /quote /sponsor /relay HIC cagrilmaz', async () => {
    H.state.status.mode = 'normal'
    H.state.nonces = [8n]
    const err = await executeAtsTransfer(args({ opKind: 'cowFee', fixedNonce: 7n })).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('NONCE_CHANGED')
    expect(err.permanent).toBe(true)
    expect(err.currentNonce).toBe('8')
    expect(H.state.quoteCount).toBe(0)
    expect(H.state.sponsorReqs).toHaveLength(0)
    expect(H.state.relayCount).toBe(0)
    expect(H.state.txCountArgs).toHaveLength(0)
  })

  it('fixedNonce 7, zincir nonce 7: op normal gider ve imzalanan nonce 7', async () => {
    H.state.status.mode = 'normal'
    H.state.nonces = [7n]
    const r = await executeAtsTransfer(args({ opKind: 'cowFee', fixedNonce: 7n }))
    expect(r.ops).toHaveLength(1)
    expect(H.state.relayCount).toBe(1)
    expect(H.state.sponsorReqs[0].nonce).toBe(7n)
    expect(H.state.quoteArgs.every((q) => BigInt(q.nonce) === 7n)).toBe(true)
  })

  it("fixedNonce rakam dizesi '7' bigint 7n ile esdegerdir", async () => {
    H.state.status.mode = 'normal'
    H.state.nonces = [7n]
    await executeAtsTransfer(args({ opKind: 'cowFee', fixedNonce: '7' }))
    expect(H.state.sponsorReqs[0].nonce).toBe(7n)
    H.state.nonces = [9n]
    const err = await executeAtsTransfer(args({ opKind: 'cowFee', fixedNonce: '7' })).catch((e) => e)
    expect(err.code).toBe('NONCE_CHANGED')
    expect(err.currentNonce).toBe('9')
  })

  it('fixedNonce yok: nonce ne olursa olsun davranis degismez', async () => {
    H.state.status.mode = 'normal'
    H.state.nonces = [8n]
    const r = await executeAtsTransfer(args())
    expect(r.ops).toHaveLength(1)
    expect(H.state.sponsorReqs[0].nonce).toBe(8n)
  })

  it('fixedNonce null: davranis degismez', async () => {
    H.state.status.mode = 'normal'
    H.state.nonces = [3n]
    const r = await executeAtsTransfer(args({ fixedNonce: null }))
    expect(r.ops).toHaveLength(1)
  })

  it('fixedNonce 0n gecerli bir degerdir (null gibi yok sayilmaz)', async () => {
    H.state.status.mode = 'normal'
    H.state.nonces = [1n]
    const err = await executeAtsTransfer(args({ opKind: 'cowFee', fixedNonce: 0n })).catch((e) => e)
    expect(err.code).toBe('NONCE_CHANGED')
    expect(H.state.sponsorReqs).toHaveLength(0)
  })

  it('bootstrap modu + fixedNonce: FIXED_NONCE_NEEDS_BOOTSTRAP, hicbir sponsor/relay yok', async () => {
    H.state.status.mode = 'bootstrap'
    const err = await executeAtsTransfer(args({ opKind: 'cowFee', fixedNonce: 7n })).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('FIXED_NONCE_NEEDS_BOOTSTRAP')
    expect(err.permanent).toBe(true)
    expect(H.state.sponsorReqs).toHaveLength(0)
    expect(H.state.quoteCount).toBe(0)
    expect(H.state.relayCount).toBe(0)
    expect(H.state.nonceReads).toBe(0)
  })

  it('bootstrap modu + fixedNonce YOK: mevcut iki-op akisi (regresyon)', async () => {
    H.state.status.mode = 'bootstrap'
    const r = await executeAtsTransfer(args())
    expect(r.ops).toHaveLength(2)
    expect(H.state.relayCount).toBe(2)
  })
})

describe('opKind cowFee — komisyon kumelerine girmez', () => {
  it('commissionSeedFor cowFee 0, swap hala tohumlar', () => {
    expect(commissionSeedFor('cowFee', 'local', 5n)).toBe(0n)
    expect(commissionSeedFor('swap', 'local', 5n)).toBe(5n)
    expect(commissionSeedFor('bridge', 'local', 5n)).toBe(5n)
  })

  it('commissionPlanFor cowFee 0, swap 1', () => {
    expect(commissionPlanFor('cowFee', 'local')).toBe(0)
    expect(commissionPlanFor('swap', 'local')).toBe(1)
    expect(commissionPlanFor('bridge', 'local')).toBe(1)
  })
})

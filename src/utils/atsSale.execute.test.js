// ATS satisi -- yurutme (spec §6.2/2-5). Sunucu ve zincir SAHTE; imza, 7702 yetkisi ve
// userOpHash GERCEK (runSponsoredOp + viem). Satis sabitleri test adresleriyle degistirilir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ethers } from 'ethers'

// vi.mock fabrikasi dosyanin en ustune tasinir: adresler vi.hoisted ile ONCE kurulmali.
const { DESK, SPONSOR } = vi.hoisted(() => ({
  DESK: '0x1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d',
  SPONSOR: '0x5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b',
}))
vi.mock('./atsSaleConfig', async (importOriginal) => ({
  ...(await importOriginal()), ATS_SALE_DESK: DESK, ATS_SALE_SPONSOR: SPONSOR,
}))

import { executeAtsSale, assertSaleSponsorResult, saleClientFor, saleErrorOf, isSaleRequoteError } from './atsSale'
import { computeUserOpHash } from './sdk/gasless'
import { readAtsStatus, _resetAtsStatusCache } from './atsPaymaster'
import { getAtsSourceConfig } from './atsConfig'

const cfg = getAtsSourceConfig()
const PK = '0x' + '11'.repeat(32)
const BUYER = new ethers.Wallet(PK).address
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const QID = '0x' + 'ab'.repeat(32)
const SIG = '0x' + 'cd'.repeat(65)
const TOPIC0 = ethers.id('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)')
const coder = ethers.AbiCoder.defaultAbiCoder()
const BATCH = new ethers.Interface(['function executeBatch((address target, uint256 value, bytes data)[] calls)'])
const ERC20 = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)'])
const DESK_IFACE = new ethers.Interface([
  'function buy((address buyer,address payToken,uint256 payAmount,uint256 atsAmount,uint256 deadline,bytes32 quoteId) q, bytes signature) payable',
])
const DELEGE_KODU = '0xef0100' + cfg.delegate.slice(2).toLowerCase()
const YABANCI_KOD = '0xef0100' + '12'.repeat(20)
const ERC20_IZIN = new ethers.Interface(['function allowance(address owner, address spender) view returns (uint256)'])
const IZIN_SECICI = ERC20_IZIN.getFunction('allowance').selector
const ayni = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const MAX = ethers.MaxUint256

// Teklif: toplayici izni tutari varsayilan 123 wei (ATS'si olmayan ilk alicinin alacagi izin).
const saleQuote = (quoteOver = {}, over = {}) => ({
  quote: {
    buyer: BUYER, payToken: USDT, payAmount: '5000000000000000000', atsAmount: '96000000000000000000',
    deadline: 1790000000, quoteId: QID, ...quoteOver,
  },
  signature: SIG, desk: DESK, sponsor: SPONSOR, collectorApproveAmount: '123', deadline: 1790000000,
  receivedAt: Date.now(), display: {}, ...over,
})

// Sahte sunucu + zincir. `izin`: zincirdeki ATS.allowance(alici, harcayici) -- { paymaster, collector },
// sayi ya da 'hata' (okuma duser); verilmeyen 0. `sponsorErr`: /sale/sponsor un firlattigi hata.
// `relay`: 'ok' | 'http' (4xx) | 'http5xx' | 'network' | 'reverted'; `receipt`: 'ok' | 'none'.
function sahne({ code = '0x', izin = {}, sponsorRes = {}, sponsorErr = null, relay = 'ok', opSuccess = true, receipt = 'ok' } = {}) {
  const kayit = { sponsor: [], relay: [], status: 0, txCount: [], izin: [] }
  let sonHash = null
  const client = {
    // Satis /status OKUMAZ (izinler zincirden); bu uc yalniz onbellek testlerinde cagrilir.
    status: async () => {
      kayit.status++
      return { ready: false, nextSteps: [] }
    },
    saleSponsor: async (req) => {
      kayit.sponsor.push(req)
      if (sponsorErr) throw sponsorErr
      return {
        paymaster: SPONSOR, paymasterAndDataPrefix: SPONSOR + '0'.repeat(64), paymasterData: '0x' + 'ee'.repeat(97),
        atsFee: '0', atsFeeFormatted: '0', mode: 'sale', settlementId: QID, ...sponsorRes,
      }
    },
    relay: async (userOp, authorization) => {
      kayit.relay.push({ userOp, authorization })
      sonHash = computeUserOpHash(userOp, {
        chainId: 56n, entryPoint: cfg.entryPoint,
        ...(userOp.initCode && userOp.initCode !== '0x' ? { eip7702Delegate: cfg.delegate } : {}),
      })
      if (relay === 'network') throw new TypeError('Failed to fetch')
      if (relay === 'http') throw Object.assign(new Error('simulation failed'), { code: 'simulation-failed', status: 400 })
      if (relay === 'http5xx') throw Object.assign(new Error('bundler unavailable'), { code: 'internal', status: 503 })
      if (relay === 'reverted') return { success: false, txHash: '0x' + 'b'.repeat(64) }
      return { success: true, txHash: '0x' + 'f'.repeat(64) }
    },
  }
  const makbuz = () => ({
    logs: [{
      address: cfg.entryPoint, topics: [TOPIC0, sonHash],
      data: coder.encode(['uint256', 'bool', 'uint256', 'uint256'], [0n, opSuccess, 0n, 0n]),
    }],
  })
  const provider = {
    getCode: async () => code,
    getTransactionCount: async (address, tag) => { kayit.txCount.push({ address, tag }); return 3 },
    getBalance: async () => 0n,
    estimateGas: async () => 60000n,
    getFeeData: async () => ({ gasPrice: 50000000n, maxPriorityFeePerGas: null }),
    getBlock: async () => ({ baseFeePerGas: 0n }),
    call: async (tx) => {
      const data = String(tx.data)
      if (data.startsWith(IZIN_SECICI)) {
        const [owner, spender] = ERC20_IZIN.decodeFunctionData('allowance', data)
        kayit.izin.push({ to: String(tx.to).toLowerCase(), owner, spender: spender.toLowerCase() })
        const v = ayni(spender, cfg.paymaster) ? izin.paymaster : ayni(spender, cfg.collector) ? izin.collector : undefined
        if (v === 'hata') throw new Error('rpc dustu')
        return coder.encode(['uint256'], [BigInt(v ?? 0)])
      }
      return coder.encode(['uint256'], [0n])   // EntryPoint.getNonce
    },
    waitForTransaction: async () => { if (receipt === 'none') throw new Error('TIMEOUT'); return makbuz() },
    getTransactionReceipt: async () => (receipt === 'none' ? null : makbuz()),
  }
  return { client, provider, kayit }
}

const calistir = (s, over = {}) => executeAtsSale({
  privateKey: PK, rpcUrl: 'http://bsc.invalid', saleQuote: saleQuote(), client: s.client, provider: s.provider, ...over,
})
const kod = async (p) => { try { await p } catch (e) { return saleErrorOf(e).code } return null }
const liste = (req) => BATCH.decodeFunctionData('executeBatch', req.callData)[0]

beforeEach(() => {
  _resetAtsStatusCache()
  globalThis.chrome = { storage: { local: { remove: vi.fn(async () => {}) } } }
})
afterEach(() => { delete globalThis.chrome })

describe('executeAtsSale -- cagri listesi, zincirdeki izinler, 7702 ve gaz', () => {
  it("ATS'si hic olmayan yeni alici (iki izin 0): executeBatch [approve, buy, paymaster izni, toplayici izni] + 7702 yetkisi", async () => {
    const s = sahne()
    const r = await calistir(s)
    expect(r.txHash).toBe('0x' + 'f'.repeat(64))

    const req = s.kayit.sponsor[0]
    expect(req.callData.slice(0, 10)).toBe('0x34fcd5be')
    const calls = liste(req)
    expect(calls.map((c) => c.target.toLowerCase())).toEqual(
      [USDT, DESK, cfg.token.address, cfg.token.address].map((a) => a.toLowerCase()))
    expect(ERC20.decodeFunctionData('approve', calls[2].data)[0].toLowerCase()).toBe(cfg.paymaster.toLowerCase())
    expect(ERC20.decodeFunctionData('approve', calls[2].data)[1]).toBe(MAX)
    expect(ERC20.decodeFunctionData('approve', calls[3].data)[0].toLowerCase()).toBe(cfg.collector.toLowerCase())
    expect(ERC20.decodeFunctionData('approve', calls[3].data)[1]).toBe(123n)

    // Izinler ZINCIRDEN okundu (ATS sozlesmesi; bu hesap -> paymaster / toplayici). /status OKUNMADI:
    // sifir ATS'li hesapta nextSteps BOS doner ve ilk alici izinleri hic alamazdi.
    expect(s.kayit.izin).toEqual(expect.arrayContaining([
      { to: cfg.token.address.toLowerCase(), owner: BUYER, spender: cfg.paymaster.toLowerCase() },
      { to: cfg.token.address.toLowerCase(), owner: BUYER, spender: cfg.collector.toLowerCase() },
    ]))
    expect(s.kayit.status).toBe(0)

    // Ilk islem: 7702 yetkisi hesabin 'pending' islem sayisiyla imzalanir.
    expect(req.initCode).not.toBe('0x')
    expect(req.authorization).toMatchObject({ chainId: 56, nonce: 3 })
    expect(req.authorization.address.toLowerCase()).toBe(cfg.delegate.toLowerCase())
    expect(s.kayit.txCount).toContainEqual({ address: BUYER, tag: 'pending' })
    expect(s.kayit.relay[0].authorization).toEqual(req.authorization)
  })

  // REVIEW FOCUS 4
  it('kurulumu tamam BNB alicisi (izinler zincirde yeterli): TEK cagri ama yine executeBatch; value = odeme; yetki YOK', async () => {
    const s = sahne({ code: DELEGE_KODU, izin: { paymaster: MAX, collector: 500 } })
    await calistir(s, { saleQuote: saleQuote({ payToken: ethers.ZeroAddress }) })
    const req = s.kayit.sponsor[0]
    expect(req.callData.slice(0, 10)).toBe('0x34fcd5be')
    const calls = liste(req)
    expect(calls).toHaveLength(1)
    expect(calls[0].target.toLowerCase()).toBe(DESK)
    expect(calls[0].value).toBe(5000000000000000000n)
    expect(DESK_IFACE.decodeFunctionData('buy', calls[0].data)[0].quoteId).toBe(QID)
    expect(req.initCode).toBe('0x')
    expect(req.authorization).toBeUndefined()
  })

  it('toplayici izni zaten teklifteki tutar kadar -> 4. satir YOK', async () => {
    const s = sahne({ izin: { paymaster: 0, collector: 123 } })
    await calistir(s)
    const calls = liste(s.kayit.sponsor[0])
    expect(calls).toHaveLength(3)
    expect(ERC20.decodeFunctionData('approve', calls[2].data)[0].toLowerCase()).toBe(cfg.paymaster.toLowerCase())
  })

  it('toplayici izni tutardan AZ -> 4. satir, n = teklifteki tutar', async () => {
    const s = sahne({ izin: { paymaster: MAX, collector: 100 } })
    await calistir(s)
    const calls = liste(s.kayit.sponsor[0])
    expect(calls).toHaveLength(3)
    expect(calls[2].target.toLowerCase()).toBe(cfg.token.address.toLowerCase())
    expect(ERC20.decodeFunctionData('approve', calls[2].data)[0].toLowerCase()).toBe(cfg.collector.toLowerCase())
    expect(ERC20.decodeFunctionData('approve', calls[2].data)[1]).toBe(123n)
  })

  it('teklifte collectorApproveAmount "0" ya da MaxUint256 -> 4. satir YOK', async () => {
    const sifir = sahne()
    await calistir(sifir, { saleQuote: saleQuote({}, { collectorApproveAmount: '0' }) })
    expect(liste(sifir.kayit.sponsor[0])).toHaveLength(3)
    const sinirsiz = sahne()
    await calistir(sinirsiz, { saleQuote: saleQuote({}, { collectorApproveAmount: MAX.toString() }) })
    expect(liste(sinirsiz.kayit.sponsor[0])).toHaveLength(3)
  })

  it('izin okumalari duserse o satirlar EKLENMEZ, alim yine yurur: yalniz approve + buy', async () => {
    const s = sahne({ izin: { paymaster: 'hata', collector: 'hata' } })
    const r = await calistir(s)
    expect(r.txHash).toBe('0x' + 'f'.repeat(64))
    expect(liste(s.kayit.sponsor[0])).toHaveLength(2)
  })

  it('tek okuma duserse yalniz o satir duser', async () => {
    const s = sahne({ izin: { paymaster: 'hata', collector: 0 } })
    await calistir(s)
    const calls = liste(s.kayit.sponsor[0])
    expect(calls).toHaveLength(3)
    expect(ERC20.decodeFunctionData('approve', calls[2].data)[0].toLowerCase()).toBe(cfg.collector.toLowerCase())
  })

  it('gaz: postOp limiti 0 (satis sponsorunun postOp u yok), fiyat sifir degil', async () => {
    const s = sahne()
    await calistir(s)
    const gas = s.kayit.sponsor[0].gas
    expect(BigInt(gas.paymasterPostOpGasLimit)).toBe(0n)
    expect(BigInt(gas.maxFeePerGas)).toBeGreaterThan(0n)
  })
})

describe('executeAtsSale -- sponsorun teklif retleri (spec §7)', () => {
  it('sale-quote-expired: kod KORUNUR (cagiran requote yapar), relay e gidilmez, onbellege dokunulmaz', async () => {
    const s = sahne({ sponsorErr: Object.assign(new Error('teklif suresi doldu'), { code: 'sale-quote-expired', status: 409 }) })
    const e = await calistir(s).catch((x) => x)
    expect(isSaleRequoteError(e)).toBe(true)
    expect(s.kayit.relay).toHaveLength(0)
    expect(globalThis.chrome.storage.local.remove).not.toHaveBeenCalled()
  })

  it('sale-quote-used: "hazirlanamadi" kalir ama /status ve yakit onbellekleri TAZELENIR', async () => {
    const s = sahne({ sponsorErr: Object.assign(new Error('teklif kullanildi'), { code: 'sale-quote-used', status: 409 }) })
    await readAtsStatus({ client: s.client, address: BUYER, chainId: 56 })   // onbellege girer
    const e = await calistir(s).catch((x) => x)
    expect(saleErrorOf(e).code).toBe('prepare-failed')
    expect(isSaleRequoteError(e)).toBe(false)
    expect(s.kayit.relay).toHaveLength(0)
    expect(globalThis.chrome.storage.local.remove).toHaveBeenCalledWith(['ats_fuel_cache', 'ats_fee_hints'])
    await readAtsStatus({ client: s.client, address: BUYER, chainId: 56 })
    expect(s.kayit.status).toBe(2)
  })
})

describe('executeAtsSale -- izinli TEK paymaster satis sponsoru (spec §6.2/4)', () => {
  it('sponsor BASKA bir paymaster donerse op imzalanmaz, relay e gidilmez', async () => {
    const BASKA = '0x' + '77'.repeat(20)
    const s = sahne({ sponsorRes: { paymaster: BASKA, paymasterAndDataPrefix: BASKA + '0'.repeat(64) } })
    expect(await kod(calistir(s))).toBe('prepare-failed')
    expect(s.kayit.relay).toHaveLength(0)
  })

  it('her isleme izinli ATSPaymaster bile satista KABUL EDILMEZ', async () => {
    const pm = cfg.paymaster
    const s = sahne({ sponsorRes: { paymaster: pm, paymasterAndDataPrefix: pm + '0'.repeat(64) } })
    expect(await kod(calistir(s))).toBe('prepare-failed')
    expect(s.kayit.relay).toHaveLength(0)
  })

  it('sponsor ATS ucreti isterse ya da baska teklife aitse durur', async () => {
    const ucretli = sahne({ sponsorRes: { atsFee: '5' } })
    expect(await kod(calistir(ucretli))).toBe('prepare-failed')
    expect(ucretli.kayit.relay).toHaveLength(0)
    const baskaTeklif = sahne({ sponsorRes: { settlementId: '0x' + '99'.repeat(32) } })
    expect(await kod(calistir(baskaTeklif))).toBe('prepare-failed')
    expect(baskaTeklif.kayit.relay).toHaveLength(0)
  })

  it('assertSaleSponsorResult dogru yaniti gecirir', () => {
    expect(() => assertSaleSponsorResult({
      paymaster: SPONSOR, paymasterAndDataPrefix: SPONSOR + '0'.repeat(64), atsFee: '0', mode: 'sale', settlementId: QID,
    }, { quoteId: QID })).not.toThrow()
  })

  it('saleClientFor: quote AG CAGRISI YAPMAZ; sponsor /sale/sponsor a, relay mevcut uca', async () => {
    const gc = { saleSponsor: vi.fn(async () => 'S'), relay: vi.fn(async () => 'R'), quote: vi.fn() }
    const c = saleClientFor(gc)
    const q = await c.quote()
    expect(q.atsFee).toBe('0')
    expect(q.quoteId).toBeUndefined()
    expect(q.feeAuth).toBeUndefined()
    expect(gc.quote).not.toHaveBeenCalled()
    expect(await c.sponsor({ a: 1 })).toBe('S')
    expect(gc.saleSponsor).toHaveBeenCalledWith({ a: 1 })
    expect(await c.relay('op', 'auth')).toBe('R')
    expect(gc.relay).toHaveBeenCalledWith('op', 'auth')
  })
})

describe('executeAtsSale -- kapilar', () => {
  it('baska bir 7702 delegesi varsa imzadan once durur', async () => {
    const s = sahne({ code: YABANCI_KOD })
    expect(await kod(calistir(s))).toBe('prepare-failed')
    expect(s.kayit.sponsor).toHaveLength(0)
  })

  it('teklifin alicisi bu hesap degilse durur', async () => {
    const s = sahne()
    expect(await kod(calistir(s, { saleQuote: saleQuote({ buyer: '0x' + '97'.repeat(20) }) }))).toBe('prepare-failed')
    expect(s.kayit.sponsor).toHaveLength(0)
  })
})

describe('executeAtsSale -- sonuc siniflandirmasi (spec §7)', () => {
  it.each([
    ['relay HTTP 4xx (400, gonderilmedi)', { relay: 'http' }, 'relay-failed'],
    ['relay HTTP 5xx (503, op yayinlanmis olabilir)', { relay: 'http5xx' }, 'result-unknown'],
    ['relay tx revert etti', { relay: 'reverted' }, 'relay-failed'],
    ['op zincirde basarisiz (atomik: odeme yok)', { opSuccess: false }, 'relay-failed'],
    ['relay yaniti kayboldu', { relay: 'network' }, 'result-unknown'],
    ['makbuz dogrulanamadi', { receipt: 'none' }, 'result-unknown'],
  ])('%s -> %s', async (_ad, over, beklenen) => {
    expect(await kod(calistir(sahne(over)))).toBe(beklenen)
  })

  it('onRelayed zincir hash i ile cagrilir', async () => {
    const s = sahne()
    const onRelayed = vi.fn()
    await calistir(s, { onRelayed })
    expect(onRelayed).toHaveBeenCalledWith({ txHash: '0x' + 'f'.repeat(64) })
  })
})

describe('executeAtsSale -- onbellekler (spec §6.2/5)', () => {
  it('basaridan sonra /status onbellegi ve yakit onbellekleri temizlenir', async () => {
    const s = sahne()
    await readAtsStatus({ client: s.client, address: BUYER, chainId: 56 })   // onbellege girer
    await calistir(s)
    await readAtsStatus({ client: s.client, address: BUYER, chainId: 56 })
    // Satis /status OKUMAZ; ikinci okuma onbellek temizlendigi icin aga gitti.
    expect(s.kayit.status).toBe(2)
    expect(globalThis.chrome.storage.local.remove).toHaveBeenCalledWith(['ats_fuel_cache', 'ats_fee_hints'])
  })

  it('sonuc bilinmese de (relay e gidildi) temizlenir', async () => {
    const s = sahne({ relay: 'network' })
    await calistir(s).catch(() => {})
    expect(globalThis.chrome.storage.local.remove).toHaveBeenCalled()
  })

  it('sponsor imzasindan once duran alimda onbellege dokunulmaz', async () => {
    const s = sahne({ code: YABANCI_KOD })
    await calistir(s).catch(() => {})
    expect(globalThis.chrome.storage.local.remove).not.toHaveBeenCalled()
  })
})

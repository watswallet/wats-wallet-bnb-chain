// GIZLI HESAP ATS SATIN ALMA: BAG KURMAMA KILITLERI (gizli-mod cok-ag spec 4.7 "Bag kuran tanimlayici bulunmadi (kanit)" ve
// "Sert gereksinim (test kilitli)", 5.1 atsSalePrivacy.test.js; satir 24-25).
//
// Ozel modda satis istekleri (/sale/quote, /sale/sponsor, /paymaster/relay) Gizli adresi genel hesaplara baglayabilecek HICBIR
// tanimlayici tasimaz: kurulum/cihaz kimligi, JWT/Authorization, cerez/credentials, yonlendirme kodu, genel hesap adresi,
// eklenti anahtari, ek baslik. Bu dosya istegi UCTAN UCA yakalar: GERCEK GaslessClient + gercek executeAtsSale/fetchAtsSaleQuote
// (imza, 7702 yetkisi, userOpHash gercek), yalniz `fetch` ve zincir saglayicisi sahte. gasless.ts `sponsorBody()` herkese acik
// /paymaster/sponsor ile paylasilir: oraya eklenen bir alan satisa da girer ve BURADA kirmizi olur.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ethers } from 'ethers'
import { yorumsuz, blokGovdesi } from '../test-utils/kaynakTarama'

// vi.mock fabrikasi dosyanin en ustune tasinir: adresler vi.hoisted ile ONCE kurulmali.
const { DESK, SPONSOR } = vi.hoisted(() => ({
  DESK: '0x1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d',
  SPONSOR: '0x5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b',
}))
vi.mock('./atsSaleConfig', async (importOriginal) => ({
  ...(await importOriginal()), ATS_SALE_DESK: DESK, ATS_SALE_SPONSOR: SPONSOR,
}))

import { executeAtsSale, fetchAtsSaleQuote } from './atsSale'
import { GaslessClient, computeUserOpHash, EIP7702_INITCODE_MARKER } from './sdk/gasless'
import { _resetAtsStatusCache } from './atsPaymaster'
import { getAtsSourceConfig } from './atsConfig'

const cfg = getAtsSourceConfig()
const PK = '0x' + '11'.repeat(32)
const BUYER = new ethers.Wallet(PK).address
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const QID = '0x' + 'ab'.repeat(32)
const SIG = '0x' + 'cd'.repeat(65)
const TOPIC0 = ethers.id('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)')
const coder = ethers.AbiCoder.defaultAbiCoder()
const DELEGE_KODU = '0xef0100' + cfg.delegate.slice(2).toLowerCase()
const BASE_URL = cfg.backendBase

const teklifYaniti = () => ({
  quote: { buyer: BUYER, payToken: USDT, payAmount: '5000000000000000000', atsAmount: '96000000000000000000', deadline: 1790000000, quoteId: QID },
  signature: SIG, desk: DESK, sponsor: SPONSOR, collectorApproveAmount: '123',
  display: { usdValue: '5', price: '0.05173', commissionPct: 1 },
})
const saleQuote = () => ({ ...teklifYaniti(), deadline: 1790000000, receivedAt: Date.now() })

// Sahte fetch + zincir: tum istekleri (url, init, govde) yakalar.
function sahne({ delegated = false } = {}) {
  const istekler = []
  let sonHash = null
  const fetchImpl = async (url, init) => {
    const govde = init && init.body ? JSON.parse(init.body) : null
    istekler.push({ url, init, govde })
    const yol = new URL(url).pathname
    const cevap = (j) => ({ ok: true, status: 200, text: async () => JSON.stringify(j) })
    if (yol === '/sale/quote') return cevap(teklifYaniti())
    if (yol === '/sale/sponsor') {
      return cevap({
        paymaster: SPONSOR, paymasterAndDataPrefix: SPONSOR + '0'.repeat(64), paymasterData: '0x' + 'ee'.repeat(97),
        atsFee: '0', atsFeeFormatted: '0', mode: 'sale', settlementId: QID,
      })
    }
    if (yol === '/paymaster/relay') {
      sonHash = computeUserOpHash(govde.userOp, {
        chainId: 56n, entryPoint: cfg.entryPoint,
        ...(govde.userOp.initCode && govde.userOp.initCode !== '0x' ? { eip7702Delegate: cfg.delegate } : {}),
      })
      return cevap({ success: true, txHash: '0x' + 'f'.repeat(64) })
    }
    throw new Error(`beklenmeyen uc: ${url}`)
  }
  const makbuz = () => ({
    logs: [{
      address: cfg.entryPoint, topics: [TOPIC0, sonHash],
      data: coder.encode(['uint256', 'bool', 'uint256', 'uint256'], [0n, true, 0n, 0n]),
    }],
  })
  const provider = {
    getCode: async () => (delegated ? DELEGE_KODU : '0x'),
    getTransactionCount: async () => 3,
    getBalance: async () => 0n,
    estimateGas: async () => 60000n,
    getFeeData: async () => ({ gasPrice: 50000000n, maxPriorityFeePerGas: null }),
    getBlock: async () => ({ baseFeePerGas: 0n }),
    call: async () => coder.encode(['uint256'], [0n]),   // allowance 0 ve EntryPoint.getNonce 0
    waitForTransaction: async () => makbuz(),
    getTransactionReceipt: async () => makbuz(),
  }
  return { istekler, fetchImpl, provider, client: new GaslessClient({ baseUrl: BASE_URL, chainId: 56 }, fetchImpl) }
}

const calistir = (s) => executeAtsSale({
  privateKey: PK, rpcUrl: 'http://bsc.invalid', saleQuote: saleQuote(), client: s.client, provider: s.provider,
})
const anahtarlar = (o) => Object.keys(o).sort()
const yola = (s, yol) => s.istekler.filter((i) => new URL(i.url).pathname === yol)

beforeEach(() => {
  _resetAtsStatusCache()
  globalThis.chrome = { storage: { local: { remove: vi.fn(async () => {}) } } }
  // Gercek ag yasak: enjekte client/provider disina cikan her global fetch (ileride atsSale.js / atsFee.js eklerse) testi kirar.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('gercek ag yasak') }))
})
afterEach(() => { delete globalThis.chrome; vi.unstubAllGlobals() })

describe('satis istekleri: baslik ve credentials (a)', () => {
  it('uc istegin (/sale/quote, /sale/sponsor, /paymaster/relay) init.headers TAM { content-type } ve credentials tanimsiz', async () => {
    const s = sahne()
    await fetchAtsSaleQuote({
      client: s.client, buyer: BUYER, request: { symbol: 'USDT', quoteAddress: USDT }, payAmountRaw: 5000000000000000000n,
    })
    await calistir(s)
    expect(s.istekler.map((i) => new URL(i.url).pathname)).toEqual(['/sale/quote', '/sale/sponsor', '/paymaster/relay'])
    for (const i of s.istekler) {
      expect(i.init.headers, i.url).toEqual({ 'content-type': 'application/json' })
      expect(i.init.credentials, i.url).toBeUndefined()
      expect(anahtarlar(i.init), i.url).toEqual(['body', 'headers', 'method'])
      expect(i.init.method, i.url).toBe('POST')
    }
  })

  it('tum istekler TEK Wats ana makinesine gider (bundler.watswallet.com); baska ana makine ya da uc yok', async () => {
    const s = sahne()
    await fetchAtsSaleQuote({
      client: s.client, buyer: BUYER, request: { symbol: 'USDT', quoteAddress: USDT }, payAmountRaw: 5000000000000000000n,
    })
    await calistir(s)
    expect(new Set(s.istekler.map((i) => new URL(i.url).origin))).toEqual(new Set(['https://bundler.watswallet.com']))
    for (const yasak of ['/paymaster/status', '/paymaster/quote', '/paymaster/sponsor', '/health', '/bundler/auth']) {
      expect(yola(s, yasak), yasak).toEqual([])
    }
  })
})

describe('satis istekleri: govde anahtar kumeleri TAM esitlik (b)', () => {
  const GAS = ['callGasLimit', 'maxFeePerGas', 'paymasterPostOpGasLimit', 'paymasterVerificationGasLimit', 'preVerificationGas', 'verificationGasLimit']
  const YETKI = ['address', 'chainId', 'nonce', 'r', 's', 'yParity']
  const USEROP = ['accountGasLimits', 'callData', 'gasFees', 'initCode', 'nonce', 'paymasterAndData', 'preVerificationGas', 'sender', 'signature']
  const SATISTA_OLMAYAN = ['quoteId', 'settlement', 'feeAuthSignature', 'carry']

  it('/sale/quote = buyer, payToken, payAmount (baska hicbir alan)', async () => {
    const s = sahne()
    await fetchAtsSaleQuote({
      client: s.client, buyer: BUYER, request: { symbol: 'USDT', quoteAddress: USDT }, payAmountRaw: 5000000000000000000n,
    })
    const g = yola(s, '/sale/quote')[0].govde
    expect(anahtarlar(g)).toEqual(['buyer', 'payAmount', 'payToken'])
    expect(g).toEqual({ buyer: BUYER, payToken: 'USDT', payAmount: '5000000000000000000' })
  })

  it('ilk alim (devredilmemis hesap): /sale/sponsor ve /paymaster/relay gövdeleri, gas / authorization / userOp ic nesneleriyle birlikte', async () => {
    const s = sahne()
    await calistir(s)
    const sponsor = yola(s, '/sale/sponsor')[0].govde
    expect(anahtarlar(sponsor)).toEqual(['authorization', 'callData', 'chainId', 'gas', 'initCode', 'maxPriorityFeePerGas', 'nonce', 'sender'])
    expect(anahtarlar(sponsor.gas)).toEqual(GAS)
    expect(anahtarlar(sponsor.authorization)).toEqual(YETKI)
    expect(sponsor.sender).toBe(BUYER)
    for (const k of SATISTA_OLMAYAN) expect(k in sponsor, k).toBe(false)

    const relay = yola(s, '/paymaster/relay')[0].govde
    expect(anahtarlar(relay)).toEqual(['authorization', 'chainId', 'userOp'])
    expect(anahtarlar(relay.userOp)).toEqual(USEROP)
    expect(anahtarlar(relay.authorization)).toEqual(YETKI)
    expect(relay.userOp.sender).toBe(BUYER)
  })

  it('devredilmis hesap: authorization gövdeye GIRMEZ (yalniz ilk alimda)', async () => {
    const s = sahne({ delegated: true })
    await calistir(s)
    const sponsor = yola(s, '/sale/sponsor')[0].govde
    expect(anahtarlar(sponsor)).toEqual(['callData', 'chainId', 'gas', 'initCode', 'maxPriorityFeePerGas', 'nonce', 'sender'])
    expect(anahtarlar(sponsor.gas)).toEqual(GAS)
    expect(anahtarlar(yola(s, '/paymaster/relay')[0].govde)).toEqual(['chainId', 'userOp'])
    for (const k of SATISTA_OLMAYAN) expect(k in sponsor, k).toBe(false)
  })

  it('govdelerde Gizli adresten baska hesap adresi yok (sender / buyer / yetki disinda adres gecen alan yok)', async () => {
    const s = sahne()
    await fetchAtsSaleQuote({
      client: s.client, buyer: BUYER, request: { symbol: 'USDT', quoteAddress: USDT }, payAmountRaw: 5000000000000000000n,
    })
    await calistir(s)
    const adresler = new Set()
    for (const i of s.istekler) {
      for (const m of JSON.stringify(i.govde).matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g)) adresler.add(m[0].toLowerCase())
    }
    // Izinli adresler: alici (Gizli adres), 7702 delegesi (yetkinin hedefi), sponsor / paymaster (paymasterAndData oneki),
    // satis desk'i ve ATS sozlesmeleri (callData icindeki hedefler), 7702 initCode isaretcisi (20 bayt, adres bicimli).
    // Baska hicbir adres govdede dolasmaz.
    const IZINLI = new Set([BUYER, cfg.delegate, SPONSOR, DESK, USDT, cfg.token.address, cfg.paymaster, cfg.collector, EIP7702_INITCODE_MARKER].map((a) => a.toLowerCase()))
    expect([...adresler].filter((a) => !IZINLI.has(a))).toEqual([])
  })
})

// (c) KAYNAK TARAMASI -- dosya basina (client/src geneline BAKMAZ: baska bir yere eklenen kurulum kimligi satis dosyalarina
// girmedikce bu testi kirmaz). Yorumlar cikarilir.
describe('satis dosyalari: kaynak taramasi (c)', () => {
  const oku = (ad) => readFileSync(fileURLToPath(new URL(ad, import.meta.url)), 'utf8')
  const DOSYALAR = ['./atsSale.js', './sdk/gasless.ts', './sdk/flow.ts']
  const YASAK = ['axios', 'config.api', 'getBundlerToken', 'credentials', 'localStorage', 'sessionStorage', 'chrome.storage', 'cookie', 'deviceId', 'installId']

  it.each(DOSYALAR)('%s kimlik / depolama / ek istek yuzeyi icermez', (ad) => {
    const kaynak = yorumsuz(oku(ad))
    expect(kaynak.length, 'kaynak okunabildi').toBeGreaterThan(500)
    for (const k of YASAK) {
      // atsSale.js `resetSaleCaches` kendi onbellegini siler (chrome.storage.local.remove): yazma/okuma degil, kimlik degil.
      if (ad === './atsSale.js' && k === 'chrome.storage') continue
      expect(kaynak.includes(k), `${ad} icinde "${k}" gecmemeli`).toBe(false)
    }
  })

  it('gasless.ts yalniz viem, flow.ts yalniz viem ve ./gasless i ice aktarir', () => {
    const ice = (ad) => [...oku(ad).matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(ice('./sdk/gasless.ts').every((m) => m === 'viem' || m.startsWith('viem/'))).toBe(true)
    expect(ice('./sdk/flow.ts').every((m) => m === 'viem' || m.startsWith('viem/') || m === './gasless')).toBe(true)
  })

  // Spec 5.1: atsSaleQuote ve atsSaleExecute govdeleri de taranir (kimlik / yazma ekleyebilecek en yakin yer).
  // chrome.storage bu iki govdede de gecmemeli (assertSaleSignerAllowed ayri bir islevdir, bu taramanin disindadir); YASAK listesinin tamami taranir.
  it('background.js atsSaleQuote ve atsSaleExecute govdeleri kimlik / depolama / ek istek yuzeyi icermez', () => {
    const bg = oku('../background.js')
    for (const imza of [/async function atsSaleQuote\s*\(/, /async function atsSaleExecute\s*\(/]) {
      const govde = blokGovdesi(bg, imza)
      expect(govde, `${imza} govdesi bulundu`).toBeTruthy()
      const kaynak = yorumsuz(govde)
      for (const k of YASAK) expect(kaynak.includes(k), `${imza} icinde "${k}" gecmemeli`).toBe(false)
    }
  })

  it('"headers" yalniz gasless.ts post() icinde gecer (ek baslik eklemek icin ikinci bir yer yok)', () => {
    const kaynak = yorumsuz(oku('./sdk/gasless.ts'))
    const yerler = [...kaynak.matchAll(/\bheaders\b/g)].length
    expect(yerler).toBe(1)
    const post = kaynak.slice(kaynak.indexOf('private async post('), kaynak.indexOf('private async get('))
    expect(post).toMatch(/headers: \{ 'content-type': 'application\/json' \}/)
  })
})

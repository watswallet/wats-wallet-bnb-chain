// CoW emir yardimcilari I: appData (sabit vektor) ve computeAmounts (BigInt, sabit vektorler).
// Vektorler formulden node ile BIR KEZ uretildi; beklenen degerler literal gomulu (formul testte yeniden kurulmaz).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { keccak256, toUtf8Bytes, id, TypedDataEncoder, AbiCoder, concat, Wallet, verifyTypedData } from 'ethers'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import {
  APP_CODE,
  APP_DATA_VERSION,
  appEnvironment,
  canonicalJson,
  buildAppData,
  computeAmounts,
  ORDER_TYPE_STRING,
  ORDER_TYPE_HASH,
  ORDER_TYPES,
  DOMAIN_SEPARATORS,
  domainSeparator,
  buildOrder,
  orderTypedData,
  orderDigest,
  orderUid,
  signOrder,
  buildPostBody,
} from './order'
import { cowDomain } from './config'

// DOMAIN_MISMATCH dalini dogrudan sinamak icin cowDomain'in ciktisi test icinde ezilebilir; varsayilan gercek fonksiyondur.
const domainEzme = vi.hoisted(() => ({ fn: null }))
vi.mock('./config', async (importOriginal) => {
  const gercek = await importOriginal()
  return { ...gercek, cowDomain: (chainId) => (domainEzme.fn ? domainEzme.fn(gercek.cowDomain(chainId)) : gercek.cowDomain(chainId)) }
})

const HARDHAT_1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

const AL = { qs: 98592128n, qf: 1407872n, qb: 263447862041645538n, protocolFeeBps: '2' }
const AL_BEKLENEN = {
  S: 100000000n,
  networkFee: 1407872n,
  networkCostB: 3761972440926476n,
  protocolFee: 52700112430815n,
  spotBuy: 267262534595002829n,
  partnerFee: 267262534595002n,
  expectedBuy: 263180599507050536n,
  minBuy: 261864696509515284n,
}
const SAT = { qs: 996000000000000000n, qf: 4000000000000000n, qb: 380500000n, protocolFeeBps: 2 }
const SAT_BEKLENEN = {
  S: 1000000000000000000n,
  networkFee: 4000000000000000n,
  networkCostB: 1528112n,
  protocolFee: 76115n,
  spotBuy: 382104227n,
  partnerFee: 382104n,
  expectedBuy: 380117896n,
  minBuy: 378217307n,
}

const APP_JSON =
  '{"appCode":"WatsWallet","environment":"production","metadata":{"orderClass":{"orderClass":"market"},"partnerFee":{"recipient":"' +
  HARDHAT_1 +
  '","volumeBps":10},"quote":{"slippageBips":50}},"version":"1.15.0"}'
const APP_HASH = '0x0c2f74fe7ead497333c081b064e3aad319ad439bcf8d3c8e290f0857ad9f1c1a'
const HOOK_HASH = '0xa668e68b57ca80b6775d531bfc705360a01da7f2521eca4d3c52869f699418bc'

const kod = (fn) => {
  try {
    fn()
  } catch (e) {
    return e.code
  }
  return undefined
}

describe('cow/order sabitleri', () => {
  it('APP_CODE ve surum sabit; ortam bayragi PROD a bagli', () => {
    expect(APP_CODE).toBe('WatsWallet')
    expect(APP_DATA_VERSION).toBe('1.15.0')
    expect(['production', 'development']).toContain(appEnvironment())
  })
})

describe('cow/order canonicalJson', () => {
  it('anahtarlari ozyinelemeli siralar, bosluksuz, dizi sirasini korur', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,1]},"b":1}')
  })
})

describe('cow/order buildAppData', () => {
  it('sabit vektor: json BIREBIR, hash bagimsiz keccak ile de eslesir', () => {
    const r = buildAppData({ recipient: HARDHAT_1, environment: 'production' })
    expect(r.json).toBe(APP_JSON)
    expect(r.json.length).toBe(235)
    expect(r.hash).toBe(APP_HASH)
    expect(keccak256(toUtf8Bytes(r.json))).toBe(r.hash)
  })

  it('hook vektoru: gasLimit dize, alfabetik anahtar, hash sabit', () => {
    const r = buildAppData({
      recipient: HARDHAT_1,
      environment: 'production',
      hook: { target: USDC_ETH, callData: '0xd505accf' },
    })
    expect(r.json).toContain(
      '"hooks":{"pre":[{"callData":"0xd505accf","gasLimit":"100000","target":"' + USDC_ETH + '"}]}'
    )
    expect(r.json.indexOf('"hooks"')).toBeLessThan(r.json.indexOf('"orderClass"'))
    expect(r.hash).toBe(HOOK_HASH)
    expect(keccak256(toUtf8Bytes(r.json))).toBe(r.hash)
  })

  it('hook yoksa hooks anahtari gecmez; kucuk harf target EIP-55 e normalize olur; bozuk hook INVALID_HOOK', () => {
    const yok = buildAppData({ recipient: HARDHAT_1, environment: 'production' })
    expect(yok.json).not.toContain('hooks')
    const kucuk = buildAppData({
      recipient: HARDHAT_1,
      environment: 'production',
      hook: { target: USDC_ETH.toLowerCase(), callData: '0xd505accf' },
    })
    expect(kucuk.json).toContain('"target":"' + USDC_ETH + '"')
    expect(kucuk.hash).toBe(HOOK_HASH)
    const hook = (h) => () => buildAppData({ recipient: HARDHAT_1, hook: h })
    expect(kod(hook({ target: USDC_ETH, callData: 'zz' }))).toBe('INVALID_HOOK')
    expect(kod(hook({ target: USDC_ETH, callData: '0x' }))).toBe('INVALID_HOOK')
    expect(kod(hook({ target: '0x12', callData: '0xaa' }))).toBe('INVALID_HOOK')
  })

  it('varsayilan cagri: partnerFee.recipient tam Safe adresi, volumeBps 10', () => {
    for (const r of [buildAppData({}), buildAppData()]) {
      const o = JSON.parse(r.json)
      expect(o.metadata.partnerFee).toEqual({ recipient: '0xb42f545bF8AB1A1Ba968e21a32E553d25fdF8e6d', volumeBps: 10 })
    }
  })

  it('alici gecersizse PARTNER_FEE_RECIPIENT_MISSING (acik null, kucuk harf, sifir adres)', () => {
    expect(kod(() => buildAppData({ recipient: null }))).toBe('PARTNER_FEE_RECIPIENT_MISSING')
    expect(kod(() => buildAppData({ recipient: HARDHAT_1.toLowerCase() }))).toBe('PARTNER_FEE_RECIPIENT_MISSING')
    expect(kod(() => buildAppData({ recipient: '0x0000000000000000000000000000000000000000' }))).toBe(
      'PARTNER_FEE_RECIPIENT_MISSING'
    )
  })

  it('JSON.parse: partnerFee tam iki anahtar, appCode/bps/slippage sabit, boyut < 1000 bayt', () => {
    const r = buildAppData({ recipient: HARDHAT_1, environment: 'development' })
    const o = JSON.parse(r.json)
    expect(Object.keys(o.metadata.partnerFee).sort()).toEqual(['recipient', 'volumeBps'])
    expect(o.appCode).toBe('WatsWallet')
    expect(o.environment).toBe('development')
    expect(o.metadata.partnerFee.volumeBps).toBe(10)
    expect(o.metadata.quote.slippageBips).toBe(50)
    expect(new TextEncoder().encode(r.json).length).toBeLessThan(1000)
  })
})

describe('cow/order computeAmounts', () => {
  it('Al vektoru (gercek 100 USDC -> TSLAx teklifi)', () => {
    expect(computeAmounts(AL)).toEqual(AL_BEKLENEN)
  })

  it('Sat vektoru (hisse 18, USDC 6)', () => {
    expect(computeAmounts(SAT)).toEqual(SAT_BEKLENEN)
  })

  it('P=0 ve Sl=0 uclari: partnerFee 0, expectedBuy = minBuy = qb', () => {
    const r = computeAmounts({ ...AL, partnerBps: 0, slippageBips: 0 })
    expect(r.partnerFee).toBe(0n)
    expect(r.expectedBuy).toBe(AL.qb)
    expect(r.minBuy).toBe(AL.qb)
  })

  it('varsayilan kayma 50 bps, ozel deger kullanilir', () => {
    const r = computeAmounts({ ...AL, slippageBips: 100 })
    expect(r.minBuy).toBe(AL_BEKLENEN.expectedBuy - (AL_BEKLENEN.expectedBuy * 100n) / 10000n)
    expect(r.minBuy).not.toBe(AL_BEKLENEN.minBuy)
  })

  it('qf = 0: networkCostB 0, S = qs', () => {
    const r = computeAmounts({ qs: 5000000n, qf: 0n, qb: 1000000n, protocolFeeBps: '2' })
    expect(r.networkCostB).toBe(0n)
    expect(r.S).toBe(5000000n)
  })

  it('S = qs + qf (qf sifirdan farkliyken)', () => {
    expect(computeAmounts(AL).S).toBe(AL.qs + AL.qf)
  })

  it('degismezler: minBuy <= expectedBuy <= qb, hepsi bigint, dize/BigInt/Number ayni sonuc', () => {
    for (const g of [AL, SAT]) {
      const r = computeAmounts(g)
      expect(r.minBuy <= r.expectedBuy).toBe(true)
      expect(r.expectedBuy <= g.qb).toBe(true)
      for (const v of Object.values(r)) expect(typeof v).toBe('bigint')
    }
    const dize = computeAmounts({ qs: '98592128', qf: '1407872', qb: '263447862041645538', protocolFeeBps: '2' })
    expect(dize).toEqual(AL_BEKLENEN)
    const sayi = computeAmounts({ qs: 5000000, qf: 100, qb: 1000000, protocolFeeBps: 2 })
    const bigint = computeAmounts({ qs: 5000000n, qf: 100n, qb: 1000000n, protocolFeeBps: '2' })
    expect(sayi).toEqual(bigint)
  })

  it('bolmeler asagi yuvarlar', () => {
    const r = computeAmounts({ qs: 3n, qf: 1n, qb: 10n, protocolFeeBps: 0 })
    expect(r.networkCostB).toBe(3n) // 10*1/3
    expect(r.protocolFee).toBe(0n)
  })

  it('gecersiz girdiler BAD_QUOTE_RESPONSE', () => {
    const ok = { qs: 1000000n, qf: 100n, qb: 1000000n, protocolFeeBps: 2 }
    const gecersiz = [
      { qs: 0n },
      { qs: -5n },
      { qb: 0n },
      { qf: -1n },
      { protocolFeeBps: undefined },
      { protocolFeeBps: 'x' },
      { protocolFeeBps: -1 },
      { protocolFeeBps: 1001 },
      { qs: Number(2 ** 60) },
      { qb: 1.5 },
      { qs: '1.5' },
      { qf: 'abc' },
    ]
    for (const d of gecersiz) {
      expect(kod(() => computeAmounts({ ...ok, ...d }))).toBe('BAD_QUOTE_RESPONSE')
    }
  })

  it('minBuy <= 0 BAD_QUOTE_RESPONSE', () => {
    expect(kod(() => computeAmounts({ qs: 1000n, qf: 0n, qb: 1n, protocolFeeBps: 0, slippageBips: 10000 }))).toBe('BAD_QUOTE_RESPONSE')
  })
})

describe('cow/order kaynak taramasi', () => {
  it('WatsWallet dizesi src/utils/cow altinda yalniz order.js te gecer (testler haric)', () => {
    const klasor = path.dirname(fileURLToPath(import.meta.url))
    const dosyalar = fs.readdirSync(klasor).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    const iceren = dosyalar.filter((f) => yorumsuz(fs.readFileSync(path.join(klasor, f), 'utf8')).includes('WatsWallet'))
    expect(iceren).toEqual(['order.js'])
  })
})

// ---------------------------------------------------------------------------
// Task 4: emir yapisi, typed data, digest, UID, imza, POST govdesi (Ek C vektorleri).
// ---------------------------------------------------------------------------
const HARDHAT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const HARDHAT_0_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // herkesce bilinen test anahtari
const HARDHAT_1_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const STOCK_ETH = '0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0'
const ORDER_APP_HASH = '0x0c2f74fe7ead497333c081b064e3aad319ad439bcf8d3c8e290f0857ad9f1c1a'
const VALID_TO = 1791922000

const SABIT = {
  sellToken: USDC_ETH,
  buyToken: STOCK_ETH,
  owner: HARDHAT_0,
  sellAmount: '100000000',
  buyAmount: '261864696509515284',
  validTo: VALID_TO,
  appDataHash: ORDER_APP_HASH,
}
const ORDER_ALANLARI = [
  'sellToken',
  'buyToken',
  'receiver',
  'sellAmount',
  'buyAmount',
  'validTo',
  'appData',
  'feeAmount',
  'kind',
  'partiallyFillable',
  'sellTokenBalance',
  'buyTokenBalance',
]
const DIGEST_1 = '0x4f40de0a859a7c2e9459ea9c874b362c12219f8807cf8a4c16915831b44bdc98'
const UID_1 = '0x4f40de0a859a7c2e9459ea9c874b362c12219f8807cf8a4c16915831b44bdc98f39fd6e51aad88f6f4ce6ab8827279cfffb922666ace8f50'
const IMZA_1 =
  '0x63f5e1108716aafaa6db0c72881e0fef8641c9daf0e113f0e8a532eac6761263468530096bb3f1d21583dc29908bf7649ffda07d45502fb6ddae0a77b1b2a0b71c'

const kodAsync = async (fn) => {
  try {
    await fn()
  } catch (e) {
    return e.code
  }
  return undefined
}

describe('cow/order tip ve alan sirasi', () => {
  it('ORDER_TYPE_STRING hash i TYPE_HASH e esit ve ethers kodlamasi ayni dizeyi verir', () => {
    expect(id(ORDER_TYPE_STRING)).toBe(ORDER_TYPE_HASH)
    expect(ORDER_TYPE_HASH).toBe('0xd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489')
    expect(TypedDataEncoder.from(ORDER_TYPES).encodeType('Order')).toBe(ORDER_TYPE_STRING)
  })

  it('ORDER_TYPES.Order 12 alan, Ek C.2 sirasi, dondurulmus', () => {
    expect(ORDER_TYPES.Order.map((a) => a.name)).toEqual(ORDER_ALANLARI)
    expect(ORDER_TYPES.Order).toHaveLength(12)
    expect(Object.isFrozen(ORDER_TYPES)).toBe(true)
    expect(Object.isFrozen(ORDER_TYPES.Order)).toBe(true)
  })
})

describe('cow/order domainSeparator', () => {
  it('1, 56, 42161 icin Ek C.1 sabitleri', () => {
    expect(domainSeparator(1)).toBe('0xc078f884a2676e1345748b1feace7b0abee5d00ecadb6e574dcdd109a63e8943')
    expect(domainSeparator(56)).toBe('0x0cbb18dfca28d2ceac8c72a17289168e03c1ad121338f5573e3b0c3255207fc7')
    expect(domainSeparator(42161)).toBe('0x69d78e7a7cafcaf924483f99f65e8f4e303a99a446db7ab319f9d40e940bced2')
    expect(Object.isFrozen(DOMAIN_SEPARATORS)).toBe(true)
  })

  it('desteklenmeyen zincir UNSUPPORTED_CHAIN', () => {
    expect(kod(() => domainSeparator(10))).toBe('UNSUPPORTED_CHAIN')
  })

  afterEach(() => { domainEzme.fn = null })

  it('cowDomain tablodakinden farkli bir domain uretirse (version v1) DOMAIN_MISMATCH: domainSeparator, orderDigest ve signOrder uc zincirde de reddeder', async () => {
    const order = buildOrder(SABIT)
    const imzaci = { signTypedData: vi.fn() }
    for (const zincir of [1, 56, 42161]) {
      domainEzme.fn = (d) => ({ ...d, version: 'v1' })
      expect(kod(() => domainSeparator(zincir))).toBe('DOMAIN_MISMATCH')
      expect(kod(() => orderDigest(zincir, order))).toBe('DOMAIN_MISMATCH')
      await expect(signOrder(imzaci, zincir, order)).rejects.toMatchObject({ code: 'DOMAIN_MISMATCH' })
    }
    // imza istenmeden once reddedilir: imzaciya hic gidilmez
    expect(imzaci.signTypedData).not.toHaveBeenCalled()
    // ezme kalkinca ayni zincirler gecer (tablo ile gercek domain tutarli)
    domainEzme.fn = null
    expect(domainSeparator(1)).toBe(DOMAIN_SEPARATORS[1])
  })

  it('domain ayni kalip yalniz chainId degisirse de (baska zincirin ayiraci) DOMAIN_MISMATCH', () => {
    domainEzme.fn = (d) => ({ ...d, chainId: 56 })
    expect(kod(() => domainSeparator(1))).toBe('DOMAIN_MISMATCH')
  })
})

describe('cow/order buildOrder', () => {
  it('12 alan, Object.keys sirasi Ek C.2, sabit degerler, tutarlar dize', () => {
    const o = buildOrder(SABIT)
    expect(Object.keys(o)).toEqual(ORDER_ALANLARI)
    expect(o).toEqual({
      sellToken: USDC_ETH,
      buyToken: STOCK_ETH,
      receiver: HARDHAT_0,
      sellAmount: '100000000',
      buyAmount: '261864696509515284',
      validTo: VALID_TO,
      appData: ORDER_APP_HASH,
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
    })
    expect(typeof o.sellAmount).toBe('string')
    expect(typeof o.validTo).toBe('number')
  })

  it('receiver owner dir ve parametre olarak verilen receiver/feeAmount/kind/bakiye alanlari YOK SAYILIR', () => {
    const o = buildOrder({
      ...SABIT,
      receiver: HARDHAT_1,
      feeAmount: '5',
      kind: 'buy',
      partiallyFillable: true,
      sellTokenBalance: 'internal',
      buyTokenBalance: 'external',
    })
    expect(o.receiver).toBe(HARDHAT_0)
    expect(o.feeAmount).toBe('0')
    expect(o.kind).toBe('sell')
    expect(o.partiallyFillable).toBe(false)
    expect(o.sellTokenBalance).toBe('erc20')
    expect(o.buyTokenBalance).toBe('erc20')
  })

  it('tutar girdisi BigInt, dize ve guvenli Number kabul eder; cikti her zaman dize', () => {
    const o = buildOrder({ ...SABIT, sellAmount: 100000000n, buyAmount: 12345 })
    expect(o.sellAmount).toBe('100000000')
    expect(o.buyAmount).toBe('12345')
  })

  it('kucuk harfli adresler EIP-55 e normalize olur', () => {
    const o = buildOrder({
      ...SABIT,
      sellToken: USDC_ETH.toLowerCase(),
      buyToken: STOCK_ETH.toLowerCase(),
      owner: HARDHAT_0.toLowerCase(),
    })
    expect(o.sellToken).toBe(USDC_ETH)
    expect(o.buyToken).toBe(STOCK_ETH)
    expect(o.receiver).toBe(HARDHAT_0)
  })

  it('gecersiz girdiler INVALID_ORDER', () => {
    const ver = (ek) => kod(() => buildOrder({ ...SABIT, ...ek }))
    expect(ver({ buyToken: USDC_ETH })).toBe('INVALID_ORDER')
    expect(ver({ buyToken: USDC_ETH.toLowerCase() })).toBe('INVALID_ORDER')
    expect(ver({ sellAmount: '0' })).toBe('INVALID_ORDER')
    expect(ver({ buyAmount: 0n })).toBe('INVALID_ORDER')
    expect(ver({ sellAmount: '-5' })).toBe('INVALID_ORDER')
    expect(ver({ sellAmount: '1.5' })).toBe('INVALID_ORDER')
    expect(ver({ sellAmount: 1.5 })).toBe('INVALID_ORDER')
    expect(ver({ sellAmount: 2n ** 256n })).toBe('INVALID_ORDER')
    expect(ver({ sellAmount: 2n ** 256n - 1n })).toBeUndefined()
    expect(ver({ validTo: 2 ** 32 })).toBe('INVALID_ORDER')
    expect(ver({ validTo: 2 ** 32 - 1 })).toBeUndefined()
    expect(ver({ validTo: 0 })).toBe('INVALID_ORDER')
    expect(ver({ validTo: 1.5 })).toBe('INVALID_ORDER')
    expect(ver({ sellToken: '0x1234' })).toBe('INVALID_ORDER')
    expect(ver({ owner: 'degil' })).toBe('INVALID_ORDER')
    expect(ver({ appDataHash: '0x' + 'ab'.repeat(31) })).toBe('INVALID_ORDER')
    expect(ver({ appDataHash: 'ab'.repeat(32) })).toBe('INVALID_ORDER')
    expect(ver({ appDataHash: '0x' + 'zz'.repeat(32) })).toBe('INVALID_ORDER')
  })
})

// GPv2Order.hash in bagimsiz yeniden uygulamasi (uretim koduna bagimli degil).
function elleDigest(chainId, o) {
  const kodla = AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'address', 'address', 'address', 'uint256', 'uint256', 'uint32', 'bytes32', 'uint256', 'bytes32', 'bool', 'bytes32', 'bytes32'],
    [
      ORDER_TYPE_HASH,
      o.sellToken,
      o.buyToken,
      o.receiver,
      BigInt(o.sellAmount),
      BigInt(o.buyAmount),
      o.validTo,
      o.appData,
      BigInt(o.feeAmount),
      id(o.kind),
      o.partiallyFillable,
      id(o.sellTokenBalance),
      id(o.buyTokenBalance),
    ]
  )
  return keccak256(concat(['0x1901', DOMAIN_SEPARATORS[chainId], keccak256(kodla)]))
}

describe('cow/order typed data, digest, UID', () => {
  it('orderTypedData domain/types/primaryType/message', () => {
    const o = buildOrder(SABIT)
    const td = orderTypedData(1, o)
    expect(td.domain).toEqual(cowDomain(1))
    expect(td.types).toBe(ORDER_TYPES)
    expect(td.primaryType).toBe('Order')
    expect(td.message).toBe(o)
  })

  it('digest sabit vektoru (chain 1) ve bagimsiz GPv2Order.hash yeniden uygulamasi ayni', () => {
    const o = buildOrder(SABIT)
    expect(orderDigest(1, o)).toBe(DIGEST_1)
    expect(elleDigest(1, o)).toBe(DIGEST_1)
  })

  it('kind buy olsaydi digest degisirdi (kind imzaya girer)', () => {
    const o = buildOrder(SABIT)
    expect(elleDigest(1, { ...o, kind: 'buy' })).not.toBe(DIGEST_1)
    expect(orderDigest(1, { ...o, kind: 'buy' })).not.toBe(DIGEST_1)
  })

  it('ayni emir 1, 56 ve 42161 de FARKLI digest verir ve her biri bagimsiz hesapla esit', () => {
    const o = buildOrder(SABIT)
    const d = [1, 56, 42161].map((c) => orderDigest(c, o))
    expect(new Set(d).size).toBe(3)
    for (const c of [1, 56, 42161]) expect(orderDigest(c, o)).toBe(elleDigest(c, o))
  })

  it('desteklenmeyen zincirde digest UNSUPPORTED_CHAIN', () => {
    expect(kod(() => orderDigest(10, buildOrder(SABIT)))).toBe('UNSUPPORTED_CHAIN')
  })

  it('UID sabit vektoru: digest || owner || validTo, 56 bayt, kucuk harf', () => {
    const uid = orderUid(DIGEST_1, HARDHAT_0, VALID_TO)
    expect(uid).toBe(UID_1)
    expect(uid).toHaveLength(2 + 112)
    expect(uid).toBe(uid.toLowerCase())
    expect(uid.slice(2, 66)).toBe(DIGEST_1.slice(2))
    expect(uid.slice(66, 106)).toBe(HARDHAT_0.slice(2).toLowerCase())
    expect(uid.slice(106)).toBe('6ace8f50')
  })

  it('UID validTo 4 bayta sol sifir dolgulu', () => {
    expect(orderUid(DIGEST_1, HARDHAT_0, 1).slice(106)).toBe('00000001')
  })

  it('UID gecersiz digest/owner/validTo icin firlatir', () => {
    expect(kod(() => orderUid('0x1234', HARDHAT_0, VALID_TO))).toBe('INVALID_ORDER')
    expect(kod(() => orderUid(DIGEST_1, '0x12', VALID_TO))).toBe('INVALID_ORDER')
    expect(kod(() => orderUid(DIGEST_1, HARDHAT_0, 2 ** 32))).toBe('INVALID_ORDER')
  })
})

describe('cow/order signOrder', () => {
  it('hardhat #0 ile deterministik sabit imza, owner a karsi dogrulanir', async () => {
    const o = buildOrder(SABIT)
    const imza = await signOrder(new Wallet(HARDHAT_0_KEY), 1, o)
    expect(imza).toBe(IMZA_1)
    expect(imza).toHaveLength(132)
    const { domain, types, message } = orderTypedData(1, o)
    expect(verifyTypedData(domain, types, message, imza)).toBe(HARDHAT_0)
  })

  it('baska anahtarla imza yapan signer SIGNATURE_MISMATCH', async () => {
    const o = buildOrder(SABIT)
    expect(await kodAsync(() => signOrder(new Wallet(HARDHAT_1_KEY), 1, o))).toBe('SIGNATURE_MISMATCH')
  })

  it('kisa imza donen signer SIGNATURE_MISMATCH', async () => {
    const o = buildOrder(SABIT)
    const kisa = { signTypedData: async () => '0x' + '11'.repeat(64) }
    expect(await kodAsync(() => signOrder(kisa, 1, o))).toBe('SIGNATURE_MISMATCH')
  })

  it('desteklenmeyen zincirde signer HIC cagrilmaz (UNSUPPORTED_CHAIN)', async () => {
    let cagri = 0
    const signer = {
      signTypedData: async () => {
        cagri += 1
        return IMZA_1
      },
    }
    expect(await kodAsync(() => signOrder(signer, 10, buildOrder(SABIT)))).toBe('UNSUPPORTED_CHAIN')
    expect(cagri).toBe(0)
  })

  it('signer a domain, types ve mesaj olarak verilir', async () => {
    const o = buildOrder(SABIT)
    let alinan
    const w = new Wallet(HARDHAT_0_KEY)
    const signer = {
      signTypedData: async (...a) => {
        alinan = a
        return w.signTypedData(...a)
      },
    }
    await signOrder(signer, 56, o)
    expect(alinan[0]).toEqual(cowDomain(56))
    expect(alinan[1]).toBe(ORDER_TYPES)
    expect(alinan[2]).toBe(o)
  })
})

describe('cow/order buildPostBody', () => {
  const girdi = (ek = {}) => ({
    order: buildOrder(SABIT),
    signature: IMZA_1,
    quoteId: 1081297372,
    appDataJson: APP_JSON,
    appDataHash: ORDER_APP_HASH,
    ...ek,
  })

  it('anahtar sirasi spec 6.4 ve degerler', () => {
    const b = buildPostBody(girdi())
    expect(Object.keys(b)).toEqual([
      'sellToken',
      'buyToken',
      'receiver',
      'sellAmount',
      'buyAmount',
      'validTo',
      'feeAmount',
      'kind',
      'partiallyFillable',
      'sellTokenBalance',
      'buyTokenBalance',
      'signingScheme',
      'signature',
      'from',
      'quoteId',
      'appData',
      'appDataHash',
    ])
    expect(b.signingScheme).toBe('eip712')
    expect(b.from).toBe(HARDHAT_0)
    expect(b.receiver).toBe(HARDHAT_0)
    expect(b.feeAmount).toBe('0')
    expect(b.kind).toBe('sell')
    expect(b.partiallyFillable).toBe(false)
    expect(b.signature).toBe(IMZA_1)
    expect(b.quoteId).toBe(1081297372)
    expect(b.appDataHash).toBe(ORDER_APP_HASH)
  })

  it('appData govdede DIZE (nesne degil)', () => {
    const b = buildPostBody(girdi())
    expect(typeof b.appData).toBe('string')
    expect(b.appData).toBe(APP_JSON)
    expect(typeof JSON.parse(b.appData)).toBe('object')
  })

  it('quoteId yalniz tamsayi ise eklenir', () => {
    for (const q of [undefined, null, 1.5, '1081297372', NaN]) {
      const b = buildPostBody(girdi({ quoteId: q }))
      expect(Object.hasOwn(b, 'quoteId')).toBe(false)
    }
    expect(Object.hasOwn(buildPostBody(girdi({ quoteId: 0 })), 'quoteId')).toBe(true)
  })
})

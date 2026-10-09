import { describe, it, expect } from 'vitest'
import { TypedDataEncoder } from 'ethers'
import { hashTypedData } from 'viem'
import { parseTypedDataParams, LIMITS } from './parse.js'
import { hashTypedDataDigest } from './digest.js'

// Ek B: AppKit Lab'in gonderdigi yuk (EIP-712 spec "Ether Mail" ornegi), ikinci
// argumani JSON STRING, EIP712Domain types icinde, domain.chainId sayi.
const LAB_PAYLOAD = '{"domain":{"name":"Ether Mail","version":"1","chainId":1,"verifyingContract":"0xcccccccccccccccccccccccccccccccccccccccc"},"message":{"from":{"name":"Cow","wallet":"0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826"},"to":{"name":"Bob","wallet":"0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"},"contents":"Hello, Bob!"},"primaryType":"Mail","types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],"Person":[{"name":"name","type":"string"},{"name":"wallet","type":"address"}],"Mail":[{"name":"from","type":"Person"},{"name":"to","type":"Person"},{"name":"contents","type":"string"}]}}'
const SIGNER = '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826'
const SPENDER = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
const TOKEN = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'

const parse = (payload, activeChainId = 1, addr = SIGNER) =>
  parseTypedDataParams([addr, typeof payload === 'string' ? payload : JSON.stringify(payload)], { activeChainId })

const errorOf = (r) => {
  expect(r.ok).toBe(false)
  expect(r.error.code).toBe(-32602)
  expect(typeof r.error.message).toBe('string')
  return r.error.message
}

// EIP-2612 Permit: domain chainId/verifyingContract'li; alanlari ezilebilir.
const permit = ({ message = {}, domain = {}, domainType, extraTypes = {} } = {}) => ({
  types: {
    EIP712Domain: domainType || [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    ...extraTypes,
  },
  primaryType: 'Permit',
  domain: { name: 'Token', version: '1', chainId: 1, verifyingContract: TOKEN, ...domain },
  message: { owner: SIGNER, spender: SPENDER, value: '1000', nonce: 0, deadline: 1900000000, ...message },
})

// DAI tipi: bool `allowed` -- "false" dizgisi dogru olarak kodlanmasin diye.
const daiPermit = (message = {}) => ({
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Permit: [
      { name: 'holder', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
      { name: 'allowed', type: 'bool' },
    ],
  },
  primaryType: 'Permit',
  domain: { name: 'Dai', version: '1', chainId: 1, verifyingContract: TOKEN },
  message: { holder: SIGNER, spender: SPENDER, nonce: 0, expiry: 0, allowed: true, ...message },
})

describe('parseTypedDataParams: Lab yuku (Ek B)', () => {
  it('JSON string yuku ayristirir, normallestirir ve chainCheck=match verir', () => {
    const r = parse(LAB_PAYLOAD)
    expect(r.ok).toBe(true)
    expect(r.value.signWith).toBe(SIGNER.toLowerCase())
    expect(r.value.chainCheck).toBe('match')
    const td = r.value.typedData
    expect(td.primaryType).toBe('Mail')
    expect(td.domain).toEqual({
      name: 'Ether Mail', version: '1', chainId: '1', verifyingContract: TOKEN,
    })
    expect(Object.keys(td.types)).toEqual(['EIP712Domain', 'Person', 'Mail'])
    expect(td.message.to.wallet).toBe(SPENDER)
  })

  it('nesne olarak gelen typedData ayni sonucu verir', () => {
    const asString = parse(LAB_PAYLOAD)
    const asObject = parseTypedDataParams([SIGNER, JSON.parse(LAB_PAYLOAD)], { activeChainId: 1 })
    expect(asObject).toEqual(asString)
  })

  it('aktif zincir hex, ondalik string veya bigint olarak da kabul edilir', () => {
    for (const active of [1, '1', '0x1', 1n]) expect(parse(LAB_PAYLOAD, active).ok).toBe(true)
  })

  it('imza adresi kucultulur; yanlis sagitma toplamli karisik harf reddedilir', () => {
    expect(parse(LAB_PAYLOAD, 1, SIGNER.toLowerCase()).value.signWith).toBe(SIGNER.toLowerCase())
    const bad = '0xcD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826'
    errorOf(parse(LAB_PAYLOAD, 1, bad))
  })
})

describe('parseTypedDataParams: params bicimi', () => {
  it('params dizi degil / kisa / adres bozuk / typedData tipi yanlis -> -32602', () => {
    errorOf(parseTypedDataParams(undefined, { activeChainId: 1 }))
    errorOf(parseTypedDataParams([SIGNER], { activeChainId: 1 }))
    errorOf(parseTypedDataParams(['nope', LAB_PAYLOAD], { activeChainId: 1 }))
    errorOf(parseTypedDataParams([SIGNER, 42], { activeChainId: 1 }))
    errorOf(parseTypedDataParams([SIGNER, [1, 2]], { activeChainId: 1 }))
    errorOf(parseTypedDataParams([SIGNER, '{not json'], { activeChainId: 1 }))
    errorOf(parseTypedDataParams([SIGNER, '[]'], { activeChainId: 1 }))
  })

  it('types/primaryType/domain/message eksikse -32602', () => {
    for (const key of ['types', 'primaryType', 'domain', 'message']) {
      const doc = JSON.parse(LAB_PAYLOAD)
      delete doc[key]
      errorOf(parse(doc))
    }
  })

  it('hicbir hata yolu firlatmaz ve her hata sayisal koddur', () => {
    const r = parseTypedDataParams([SIGNER, '{"types":{"A":[{"name":"x","type":"uint256"}]},"primaryType":"A","domain":{},"message":{"x":"zzz"}}'])
    expect(r.ok).toBe(false)
    expect(Number.isInteger(r.error.code)).toBe(true)
  })
})

describe('parseTypedDataParams: zincir kurali', () => {
  it('bildirilmis chainId aktif zincirle uyusmazsa -32602 ve MetaMask metni', () => {
    const r = parse(LAB_PAYLOAD, 10)
    expect(errorOf(r)).toBe('Provided chainId "1" must match the active chainId "10".')
  })

  it('bildirimi uint olmayan chainId -32602', () => {
    const p = permit({ domainType: [{ name: 'chainId', type: 'string' }], domain: { chainId: '1' } })
    errorOf(parse(p))
  })

  it('EIP712Domain chainId BILDIRMIYOR ama domain yanlis chainId tasiyor: reddedilmez, chainCheck=missing', () => {
    const p = permit({
      domainType: [{ name: 'name', type: 'string' }, { name: 'verifyingContract', type: 'address' }],
      domain: { chainId: 999 },
    })
    const r = parse(p, 1)
    expect(r.ok).toBe(true)
    expect(r.value.chainCheck).toBe('missing')
    // imzaya girmeyen alan saklanir ki gorunum "imzalanmayan alan" desin
    expect(r.value.typedData.domain.chainId).toBe(999)
    expect(r.value.typedData.types.EIP712Domain.map((f) => f.name)).toEqual(['name', 'verifyingContract'])
  })

  it('chainId hic yoksa chainCheck=missing; aktif zincir gerekmez', () => {
    const p = permit({ domainType: [{ name: 'name', type: 'string' }], domain: {} })
    delete p.domain.chainId
    delete p.domain.verifyingContract
    const r = parseTypedDataParams([SIGNER, JSON.stringify(p)])
    expect(r.ok).toBe(true)
    expect(r.value.chainCheck).toBe('missing')
  })

  it('bildirilmis chainId varken aktif zincir bilinmiyorsa -32603', () => {
    const r = parseTypedDataParams([SIGNER, LAB_PAYLOAD], { activeChainId: 'solana-mainnet' })
    expect(r.ok).toBe(false)
    expect(r.error.code).toBe(-32603)
  })

  it('chainId onaltilik string de esitlik icin kabul edilir', () => {
    const p = permit({ domain: { chainId: '0x1' } })
    expect(parse(p, 1).value.chainCheck).toBe('match')
  })
})

describe('parseTypedDataParams: EIP712Domain turetme ve bicimi', () => {
  it('types.EIP712Domain yoksa domain alanlarindan kanonik sirayla turetilir', () => {
    const p = permit()
    delete p.types.EIP712Domain
    // alanlar bilerek kanonik olmayan sirada yazildi
    p.domain = { verifyingContract: TOKEN, chainId: 1, name: 'Token', version: '1' }
    const r = parse(p)
    expect(r.ok).toBe(true)
    expect(r.value.typedData.types.EIP712Domain.map((f) => f.name)).toEqual(['name', 'version', 'chainId', 'verifyingContract'])
    expect(r.value.chainCheck).toBe('match')
    const { digest } = hashTypedDataDigest(r.value.typedData)
    const { EIP712Domain: _omit, ...rest } = r.value.typedData.types
    expect(digest).toBe(hashTypedData({
      domain: { name: 'Token', version: '1', chainId: 1n, verifyingContract: TOKEN },
      types: rest, primaryType: 'Permit', message: {
        owner: SIGNER, spender: SPENDER, value: 1000n, nonce: 0n, deadline: 1900000000n,
      },
    }))
  })

  it('ozel (standart olmayan) EIP712Domain alani kabul edilir ve ozete girer', () => {
    const p = permit({
      domainType: [
        { name: 'name', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'foo', type: 'uint256' },
      ],
      domain: { foo: 7 },
    })
    const r = parse(p)
    expect(r.ok).toBe(true)
    expect(r.value.typedData.domain.foo).toBe('7')
  })

  it('standart adin turu bozuksa (verifyingContract string) -32602', () => {
    errorOf(parse(permit({ domainType: [{ name: 'verifyingContract', type: 'string' }], domain: { verifyingContract: 'x' } })))
  })

  it('EIP712Domain alani dizi/yapi turuyle bildirilirse -32602', () => {
    errorOf(parse(permit({ domainType: [{ name: 'name', type: 'string[]' }], domain: { name: ['a'] } })))
  })

  it('bildirilen domain alani domain nesnesinde yoksa -32602', () => {
    const p = permit()
    delete p.domain.version
    errorOf(parse(p))
  })

  it('primaryType EIP712Domain veya bilinmeyen tip -32602', () => {
    const a = permit(); a.primaryType = 'EIP712Domain'
    errorOf(parse(a))
    const b = permit(); b.primaryType = 'Nope'
    errorOf(parse(b))
  })

  it('primaryType`tan erisilemeyen fazladan tip atilir ve ozeti etkilemez', () => {
    const plain = parse(permit())
    const withExtra = parse(permit({ extraTypes: { Junk: [{ name: 'a', type: 'MissingType' }] } }))
    expect(withExtra.ok).toBe(true)
    expect(Object.keys(withExtra.value.typedData.types)).toEqual(['EIP712Domain', 'Permit'])
    expect(hashTypedDataDigest(withExtra.value.typedData).digest).toBe(hashTypedDataDigest(plain.value.typedData).digest)
  })

  it('dongulu tip grafigi -32602', () => {
    const p = {
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        A: [{ name: 'b', type: 'B' }],
        B: [{ name: 'a', type: 'A' }],
      },
      primaryType: 'A',
      domain: { name: 'x' },
      message: { b: { a: {} } },
    }
    errorOf(parse(p))
  })

  it('erisilebilir tipte bilinmeyen tur / yapi adi yerlesik tur adi -32602', () => {
    const a = permit(); a.types.Permit[0].type = 'Ghost'
    errorOf(parse(a))
    const b = permit(); b.types.uint256 = [{ name: 'x', type: 'string' }]
    errorOf(parse(b))
  })

  it('uint/int takma adlari (genislik yok) reddedilir', () => {
    const p = permit(); p.types.Permit[2].type = 'uint'
    errorOf(parse(p))
  })
})

describe('parseTypedDataParams: SIKI yaprak gecisi', () => {
  it('bool alanina JSON string "false" / sayi 0 -> -32602 (DAI allowed tuzagi)', () => {
    errorOf(parse(daiPermit({ allowed: 'false' })))
    errorOf(parse(daiPermit({ allowed: 0 })))
    errorOf(parse(daiPermit({ allowed: 'true' })))
    expect(parse(daiPermit({ allowed: false })).value.typedData.message.allowed).toBe(false)
  })

  it('uint: ustel bicim, ondalik ve guvenli aralik disi ham sayi -> -32602 (ham metin taramasi)', () => {
    const base = JSON.stringify(permit())
    const withValue = (token) => base.replace('"value":"1000"', `"value":${token}`)
    errorOf(parse(withValue('1e21')))
    errorOf(parse(withValue('1.5')))
    errorOf(parse(withValue('1.0')))
    errorOf(parse(withValue('9007199254740993')))
    expect(parse(withValue('1000')).ok).toBe(true)
  })

  it('2^53 ustu deger STRING olarak gelirse tam korunur', () => {
    const r = parse(permit({ message: { value: '115792089237316195423570985008687907853269984665640564039457584007913129639935' } }))
    expect(r.ok).toBe(true)
    expect(r.value.typedData.message.value).toBe('115792089237316195423570985008687907853269984665640564039457584007913129639935')
  })

  it('dize icindeki sayi benzeri metin tarama tarafindan reddedilmez', () => {
    const doc = JSON.parse(LAB_PAYLOAD)
    doc.message.contents = 'price 1e21 or 1.5 or 99999999999999999999 "quoted \\" 1e9"'
    expect(parse(doc).ok).toBe(true)
  })

  it('uint: onluk string, 0x hex string ve sayi ayni degere normallesir', () => {
    for (const v of ['255', '0xff', 255]) {
      expect(parse(permit({ message: { value: v } })).value.typedData.message.value).toBe('255')
    }
  })

  it('uint: negatif, aralik disi, bos hex, onluk olmayan string -> -32602', () => {
    errorOf(parse(permit({ message: { value: '-1' } })))
    errorOf(parse(permit({ message: { value: '0x' } })))
    errorOf(parse(permit({ message: { value: '12abc' } })))
    errorOf(parse(permit({ message: { value: '' } })))
    errorOf(parse(permit({ message: { value: true } })))
    errorOf(parse(permit({ message: { value: '1'.padEnd(79, '0') } })))
    const p = permit(); p.types.Permit[2].type = 'uint8'
    errorOf(parse(Object.assign(p, { message: { ...p.message, value: 256 } })))
    expect(parse(Object.assign(p, { message: { ...p.message, value: 255 } })).ok).toBe(true)
  })

  it('int: isaretli aralik denetlenir', () => {
    const p = permit(); p.types.Permit[2].type = 'int8'
    expect(parse(Object.assign(p, { message: { ...p.message, value: -128 } })).value.typedData.message.value).toBe('-128')
    errorOf(parse(Object.assign(p, { message: { ...p.message, value: -129 } })))
    errorOf(parse(Object.assign(p, { message: { ...p.message, value: 128 } })))
  })

  it('address: ICAP, kisa, sagitma toplami bozuk, sayi -> -32602; kucuk harf kabul ve sagitmali yazilir', () => {
    errorOf(parse(permit({ message: { spender: 'XE7338O073KYGTWWZN0F2WZ0R8PX5ZPPZS' } })))
    errorOf(parse(permit({ message: { spender: '0x1234' } })))
    errorOf(parse(permit({ message: { spender: 12345 } })))
    errorOf(parse(permit({ message: { spender: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbb' } })))
    const r = parse(permit({ message: { spender: SPENDER.toLowerCase() } }))
    expect(r.value.typedData.message.spender).toBe(SPENDER)
  })

  it('bytes / bytesN: hex ve uzunluk', () => {
    const p = permit()
    p.types.Permit.push({ name: 'salt', type: 'bytes32' }, { name: 'blob', type: 'bytes' })
    const ok = Object.assign({}, p, { message: { ...p.message, salt: '0x' + 'AB'.repeat(32), blob: '0xDEAD' } })
    const r = parse(ok)
    expect(r.value.typedData.message.salt).toBe('0x' + 'ab'.repeat(32))
    expect(r.value.typedData.message.blob).toBe('0xdead')
    errorOf(parse(Object.assign({}, p, { message: { ...p.message, salt: '0x' + 'ab'.repeat(31), blob: '0x' } })))
    errorOf(parse(Object.assign({}, p, { message: { ...p.message, salt: '0x' + 'ab'.repeat(32), blob: '0xabc' } })))
    errorOf(parse(Object.assign({}, p, { message: { ...p.message, salt: 'ab', blob: '0x' } })))
  })

  it('string: yalniz JS string; yalniz-yari vekil (lone surrogate) reddedilir', () => {
    const doc = JSON.parse(LAB_PAYLOAD)
    doc.message.contents = 5
    errorOf(parse(doc))
    const raw = LAB_PAYLOAD.replace('Hello, Bob!', 'bad \\ud800 text')
    errorOf(parse(raw))
    const emoji = LAB_PAYLOAD.replace('Hello, Bob!', 'ok \\ud83d\\ude00')
    expect(parse(emoji).ok).toBe(true)
  })

  it('dizi turleri: dizi olmali, sabit uzunluk tutmali, ic ice dizi calisir', () => {
    const p = {
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        Batch: [{ name: 'ids', type: 'uint256[]' }, { name: 'pair', type: 'address[2]' }, { name: 'grid', type: 'uint8[][2]' }],
      },
      primaryType: 'Batch',
      domain: { name: 'x' },
      message: { ids: ['1', 2, '0x3'], pair: [SIGNER, SPENDER], grid: [[1], [2, 3]] },
    }
    const r = parse(p)
    expect(r.ok).toBe(true)
    expect(r.value.typedData.message.ids).toEqual(['1', '2', '3'])
    errorOf(parse({ ...p, message: { ...p.message, ids: 'nope' } }))
    errorOf(parse({ ...p, message: { ...p.message, pair: [SIGNER] } }))
    errorOf(parse({ ...p, message: { ...p.message, grid: [[1]] } }))
    errorOf(parse({ ...p, message: { ...p.message, grid: [[1], [999]] } }))
  })

  it('yapi alani: eksik alan ve nesne olmayan deger -> -32602', () => {
    const a = JSON.parse(LAB_PAYLOAD); delete a.message.from.wallet
    errorOf(parse(a))
    const b = JSON.parse(LAB_PAYLOAD); b.message.to = 'Bob'
    errorOf(parse(b))
    const c = JSON.parse(LAB_PAYLOAD); c.message.to = [1]
    errorOf(parse(c))
  })

  it('semada olmayan fazladan mesaj alani imzaya girmez ama saklanir', () => {
    const doc = JSON.parse(LAB_PAYLOAD)
    doc.message.extra = 'surprise'
    doc.message.from.note = { deep: 1 }
    const r = parse(doc)
    expect(r.ok).toBe(true)
    expect(r.value.typedData.message.extra).toBe('surprise')
    expect(r.value.typedData.message.from.note).toEqual({ deep: 1 })
    const plain = parse(LAB_PAYLOAD)
    expect(hashTypedDataDigest(r.value.typedData).digest).toBe(hashTypedDataDigest(plain.value.typedData).digest)
  })

  it('normallesmis alanlar sema sirasindadir, fazladan alanlar sonda', () => {
    const doc = JSON.parse(LAB_PAYLOAD)
    doc.message = { zzz: 1, contents: 'c', to: doc.message.to, from: doc.message.from }
    expect(Object.keys(parse(doc).value.typedData.message)).toEqual(['from', 'to', 'contents', 'zzz'])
  })

  it('yinelenen JSON anahtarlari son-kazanir', () => {
    const raw = LAB_PAYLOAD.replace('"contents":"Hello, Bob!"', '"contents":"first","contents":"Hello, Bob!"')
    expect(parse(raw).value.typedData.message.contents).toBe('Hello, Bob!')
  })
})

describe('parseTypedDataParams: bos ve uc degerler', () => {
  it('bos EIP712Domain, bos domain ve bos dizi kabul edilir; chainCheck=missing', () => {
    const p = {
      types: { EIP712Domain: [], Batch: [{ name: 'ids', type: 'uint256[]' }] },
      primaryType: 'Batch',
      domain: {},
      message: { ids: [] },
    }
    const r = parseTypedDataParams([SIGNER, JSON.stringify(p)])
    expect(r.ok).toBe(true)
    expect(r.value.chainCheck).toBe('missing')
    expect(r.value.typedData.message.ids).toEqual([])
  })

  it('EIP712Domain tanimsiz ve domain bos: bos domain turetilir', () => {
    const p = { types: { Person: [{ name: 'name', type: 'string' }] }, primaryType: 'Person', domain: {}, message: { name: 'x' } }
    const r = parseTypedDataParams([SIGNER, JSON.stringify(p)])
    expect(r.ok).toBe(true)
    expect(r.value.typedData.types.EIP712Domain).toEqual([])
  })

  it('uint256 azami ve int256 alt sinir kabul edilir, bir fazlasi reddedilir', () => {
    const p = permit()
    p.types.Permit[2].type = 'int256'
    const min = (-(2n ** 255n)).toString()
    expect(parse(Object.assign(p, { message: { ...p.message, value: min } })).value.typedData.message.value).toBe(min)
    errorOf(parse(Object.assign(p, { message: { ...p.message, value: (-(2n ** 255n) - 1n).toString() } })))
    const q = permit()
    const max = (2n ** 256n - 1n).toString()
    expect(parse(Object.assign(q, { message: { ...q.message, value: max } })).value.typedData.message.value).toBe(max)
    errorOf(parse(Object.assign(q, { message: { ...q.message, value: (2n ** 256n).toString() } })))
  })
})

describe('parseTypedDataParams: ad hijyeni ve sinirlar', () => {
  it('__proto__ / constructor / prototype anahtarlari her derinlikte reddedilir', () => {
    const rawProto = LAB_PAYLOAD.replace('"contents":"Hello, Bob!"', '"contents":"x","__proto__":{"polluted":true}')
    errorOf(parse(rawProto))
    const a = JSON.parse(LAB_PAYLOAD); a.message.from.constructor = 'x'
    errorOf(parse(a))
    const b = JSON.parse(LAB_PAYLOAD); b.types.constructor = [{ name: 'a', type: 'string' }]
    errorOf(parse(b))
    const c = JSON.parse(LAB_PAYLOAD); c.types.Person.push({ name: 'prototype', type: 'string' })
    errorOf(parse(c))
    const d = JSON.parse(LAB_PAYLOAD); d.domain.prototype = 1
    errorOf(parse(d))
    expect({}.polluted).toBeUndefined()
  })

  it('gecersiz tip/alan adlari (bosluk, rakamla baslama, cok uzun) -> -32602', () => {
    const a = JSON.parse(LAB_PAYLOAD); a.types.Person[0].name = 'first name'
    errorOf(parse(a))
    const b = JSON.parse(LAB_PAYLOAD); b.types['1Bad'] = []
    errorOf(parse(b))
    const c = JSON.parse(LAB_PAYLOAD); c.types.Person[0].name = 'a'.repeat(LIMITS.MAX_NAME_LENGTH + 1)
    errorOf(parse(c))
    const d = JSON.parse(LAB_PAYLOAD); d.types.Person.push({ name: 'name', type: 'string' })
    errorOf(parse(d))
  })

  it('ham JSON 256 KiB ustu -> -32602', () => {
    const doc = JSON.parse(LAB_PAYLOAD)
    doc.message.contents = 'x'.repeat(LIMITS.MAX_RAW_BYTES)
    expect(errorOf(parse(doc))).toMatch(/too large/)
  })

  it('bayt siniri UTF-8 uzerinden olculur (cok baytli karakter)', () => {
    const doc = JSON.parse(LAB_PAYLOAD)
    doc.message.contents = '\u20ac'.repeat(Math.ceil(LIMITS.MAX_RAW_BYTES / 3))
    expect(errorOf(parse(doc))).toMatch(/too large/)
  })

  it('dugum sayisi siniri', () => {
    const p = {
      types: { EIP712Domain: [{ name: 'name', type: 'string' }], A: [{ name: 'xs', type: 'uint8[]' }] },
      primaryType: 'A',
      domain: { name: 'x' },
      message: { xs: new Array(LIMITS.MAX_NODES + 1).fill(1) },
    }
    expect(errorOf(parse(p))).toMatch(/too many/)
  })

  it('JSON ic ice gecme derinligi siniri (yigin tasmasi yok)', () => {
    const deep = '['.repeat(LIMITS.MAX_DEPTH + 5) + ']'.repeat(LIMITS.MAX_DEPTH + 5)
    const raw = `{"types":{"EIP712Domain":[]},"primaryType":"A","domain":{},"message":{"x":${deep}}}`
    errorOf(parse(raw))
  })

  it('tip grafigi derinligi siniri', () => {
    const types = { EIP712Domain: [{ name: 'name', type: 'string' }] }
    const n = LIMITS.MAX_DEPTH + 2
    for (let i = 0; i < n; i++) types[`T${i}`] = [{ name: 'v', type: i === n - 1 ? 'uint8' : `T${i + 1}` }]
    errorOf(parse({ types, primaryType: 'T0', domain: { name: 'x' }, message: {} }))
  })
})

describe('parseTypedDataParams: altin vektorler (oracle: viem + ethers)', () => {
  it('Lab yuku: normallesmis cikti viem ve ethers ile ayni ozeti verir', () => {
    const r = parse(LAB_PAYLOAD)
    const td = r.value.typedData
    const { digest } = hashTypedDataDigest(td)
    const original = JSON.parse(LAB_PAYLOAD)
    const { EIP712Domain: _d, ...types } = original.types
    expect(digest).toBe(hashTypedData({ domain: { ...original.domain, chainId: 1n }, types, primaryType: 'Mail', message: original.message }))
    expect(digest).toBe(TypedDataEncoder.hash({ ...original.domain }, types, original.message))
  })
})

import { describe, it, expect } from 'vitest'
import { TypedDataEncoder } from 'ethers'
import { classifyTypedData, canonicalTypeString } from './risk.js'

const OWNER = '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826'
const SPENDER = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
const TOKEN = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
const OTHER = '0x1111111111111111111111111111111111111111'
const MAX256 = (2n ** 256n - 1n).toString()

const DOMAIN_FULL = [
  { name: 'name', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
]
const domainOf = (fields) => ({ EIP712Domain: fields })

// ---- fixture ureticileri (parse.js'in normallestirilmis bicimi) ----
const erc2612 = ({ message = {}, domainFields = DOMAIN_FULL } = {}) => ({
  domain: {},
  types: {
    ...domainOf(domainFields),
    Permit: [
      { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'Permit',
  message: { owner: OWNER, spender: SPENDER, value: '1000', nonce: '0', deadline: '1900000000', ...message },
})

const dai = (message = {}) => ({
  domain: {},
  types: {
    ...domainOf(DOMAIN_FULL),
    Permit: [
      { name: 'holder', type: 'address' }, { name: 'spender', type: 'address' },
      { name: 'nonce', type: 'uint256' }, { name: 'expiry', type: 'uint256' },
      { name: 'allowed', type: 'bool' },
    ],
  },
  primaryType: 'Permit',
  message: { holder: OWNER, spender: SPENDER, nonce: '0', expiry: '1900000000', allowed: true, ...message },
})

const DETAILS = [
  { name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' },
  { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' },
]
const permit2Single = ({ details = {}, sigDeadline = '1900000000', domainFields = DOMAIN_FULL } = {}) => ({
  domain: {},
  types: {
    ...domainOf(domainFields),
    PermitSingle: [
      { name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' },
    ],
    PermitDetails: DETAILS,
  },
  primaryType: 'PermitSingle',
  message: {
    details: { token: TOKEN, amount: '5000', expiration: '1900000000', nonce: '0', ...details },
    spender: SPENDER,
    sigDeadline,
  },
})

const permit2Batch = (list) => ({
  domain: {},
  types: {
    ...domainOf(DOMAIN_FULL),
    PermitBatch: [
      { name: 'details', type: 'PermitDetails[]' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' },
    ],
    PermitDetails: DETAILS,
  },
  primaryType: 'PermitBatch',
  message: { details: list, spender: SPENDER, sigDeadline: '1900000000' },
})

const TOKEN_PERMISSIONS = [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }]
const transferFrom = ({ permitted = {}, deadline = '1900000000' } = {}) => ({
  domain: {},
  types: {
    ...domainOf(DOMAIN_FULL),
    PermitTransferFrom: [
      { name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' },
      { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
    ],
    TokenPermissions: TOKEN_PERMISSIONS,
  },
  primaryType: 'PermitTransferFrom',
  message: { permitted: { token: TOKEN, amount: '10', ...permitted }, spender: SPENDER, nonce: '1', deadline },
})

const batchTransferFrom = (list) => ({
  domain: {},
  types: {
    ...domainOf(DOMAIN_FULL),
    PermitBatchTransferFrom: [
      { name: 'permitted', type: 'TokenPermissions[]' }, { name: 'spender', type: 'address' },
      { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
    ],
    TokenPermissions: TOKEN_PERMISSIONS,
  },
  primaryType: 'PermitBatchTransferFrom',
  message: { permitted: list, spender: SPENDER, nonce: '1', deadline: '1900000000' },
})

const witness = (batch, tokenPermissions = TOKEN_PERMISSIONS) => ({
  domain: {},
  types: {
    ...domainOf(DOMAIN_FULL),
    [batch ? 'PermitBatchWitnessTransferFrom' : 'PermitWitnessTransferFrom']: [
      { name: 'permitted', type: batch ? 'TokenPermissions[]' : 'TokenPermissions' },
      { name: 'spender', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
      { name: 'witness', type: 'ExampleWitness' },
    ],
    TokenPermissions: tokenPermissions,
    ExampleWitness: [{ name: 'user', type: 'address' }],
  },
  primaryType: batch ? 'PermitBatchWitnessTransferFrom' : 'PermitWitnessTransferFrom',
  message: {
    permitted: batch ? [{ token: TOKEN, amount: '7' }] : { token: TOKEN, amount: '7' },
    spender: SPENDER, nonce: '1', deadline: '1900000000', witness: { user: OWNER },
  },
})

const seaport = ({ offer, consideration, counterName = 'counter', offerer = OWNER, domainFields = DOMAIN_FULL } = {}) => ({
  domain: {},
  types: {
    ...domainOf(domainFields),
    OrderComponents: [
      { name: 'offerer', type: 'address' }, { name: 'zone', type: 'address' },
      { name: 'offer', type: 'OfferItem[]' }, { name: 'consideration', type: 'ConsiderationItem[]' },
      { name: 'orderType', type: 'uint8' }, { name: 'startTime', type: 'uint256' }, { name: 'endTime', type: 'uint256' },
      { name: 'zoneHash', type: 'bytes32' }, { name: 'salt', type: 'uint256' }, { name: 'conduitKey', type: 'bytes32' },
      { name: counterName, type: 'uint256' },
    ],
    OfferItem: [
      { name: 'itemType', type: 'uint8' }, { name: 'token', type: 'address' }, { name: 'identifierOrCriteria', type: 'uint256' },
      { name: 'startAmount', type: 'uint256' }, { name: 'endAmount', type: 'uint256' },
    ],
    ConsiderationItem: [
      { name: 'itemType', type: 'uint8' }, { name: 'token', type: 'address' }, { name: 'identifierOrCriteria', type: 'uint256' },
      { name: 'startAmount', type: 'uint256' }, { name: 'endAmount', type: 'uint256' }, { name: 'recipient', type: 'address' },
    ],
  },
  primaryType: 'OrderComponents',
  message: {
    offerer, zone: OTHER, offer, consideration, orderType: '0', startTime: '0', endTime: '1900000000',
    zoneHash: '0x' + '00'.repeat(32), salt: '1', conduitKey: '0x' + '00'.repeat(32), [counterName]: '0',
  },
})
const NFT = { itemType: '2', token: TOKEN, identifierOrCriteria: '77', startAmount: '1', endAmount: '1' }
const pay = (recipient, amount) => ({ itemType: '0', token: '0x0000000000000000000000000000000000000000', identifierOrCriteria: '0', startAmount: amount, endAmount: amount, recipient })

describe('canonicalTypeString', () => {
  it('ethers encodeType ile ayni (Mail ve Permit2 PermitSingle)', () => {
    const mail = {
      Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }],
      Mail: [{ name: 'from', type: 'Person' }, { name: 'to', type: 'Person' }, { name: 'contents', type: 'string' }],
    }
    expect(canonicalTypeString(mail, 'Mail')).toBe('Mail(Person from,Person to,string contents)Person(string name,address wallet)')
    expect(canonicalTypeString(mail, 'Mail')).toBe(TypedDataEncoder.from(mail).encodeType('Mail'))
    const p2 = permit2Single().types
    const { EIP712Domain: _d, ...p2Types } = p2
    expect(canonicalTypeString(p2, 'PermitSingle')).toBe(TypedDataEncoder.from(p2Types).encodeType('PermitSingle'))
  })

  it('bagimli tipler alfabetik (Seaport: ConsiderationItem, OfferItem)', () => {
    const { EIP712Domain: _d, ...types } = seaport({ offer: [], consideration: [] }).types
    const s = canonicalTypeString(seaport({ offer: [], consideration: [] }).types, 'OrderComponents')
    expect(s).toBe(TypedDataEncoder.from(types).encodeType('OrderComponents'))
    expect(s.indexOf('ConsiderationItem(')).toBeLessThan(s.indexOf('OfferItem('))
  })

  it('eksik tip veya bozuk girdide null', () => {
    expect(canonicalTypeString({ A: [{ name: 'x', type: 'B' }] }, 'A')).toBe('A(B x)')
    expect(canonicalTypeString({}, 'A')).toBeNull()
    expect(canonicalTypeString(null, 'A')).toBeNull()
    expect(canonicalTypeString({ A: [null] }, 'A')).toBeNull()
  })
})

describe('canonicalTypeString: resmi kaynak dizgileri (DOGRULANDI: PermitHash.sol, dai.sol, seaport-js constants.ts)', () => {
  it('Permit2 ve DAI ve Seaport fixture dizgileri resmi dizgilerle birebir', () => {
    const details = 'PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)'
    const perms = 'TokenPermissions(address token,uint256 amount)'
    expect(canonicalTypeString(permit2Single().types, 'PermitSingle')).toBe(`PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)${details}`)
    expect(canonicalTypeString(permit2Batch([]).types, 'PermitBatch')).toBe(`PermitBatch(PermitDetails[] details,address spender,uint256 sigDeadline)${details}`)
    expect(canonicalTypeString(transferFrom().types, 'PermitTransferFrom')).toBe(`PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)${perms}`)
    expect(canonicalTypeString(batchTransferFrom([]).types, 'PermitBatchTransferFrom')).toBe(`PermitBatchTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline)${perms}`)
    expect(canonicalTypeString(dai().types, 'Permit')).toBe('Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)')
    expect(canonicalTypeString(erc2612().types, 'Permit')).toBe('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
    expect(canonicalTypeString(seaport({ offer: [], consideration: [] }).types, 'OrderComponents')).toBe(
      'OrderComponents(address offerer,address zone,OfferItem[] offer,ConsiderationItem[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 counter)'
      + 'ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)'
      + 'OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)',
    )
  })
})

describe('classifyTypedData: tanimama', () => {
  it('permit benzeri olmayan tur null', () => {
    const mail = {
      domain: {},
      types: {
        ...domainOf(DOMAIN_FULL),
        Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }],
        Mail: [{ name: 'from', type: 'Person' }, { name: 'contents', type: 'string' }],
      },
      primaryType: 'Mail',
      message: { from: { name: 'Cow', wallet: OWNER }, contents: 'hi' },
    }
    expect(classifyTypedData(mail)).toBeNull()
  })

  it('bozuk girdide firlatmaz', () => {
    for (const bad of [undefined, null, 5, {}, { types: null }, { types: {}, message: {}, primaryType: 'X' }]) {
      expect(() => classifyTypedData(bad)).not.toThrow()
      expect(classifyTypedData(bad)).toBeNull()
    }
  })
})

describe('classifyTypedData: EIP-2612', () => {
  it('siradan permit: warning, bayraksiz; harcayici TAM ve EIP-55', () => {
    const r = classifyTypedData(erc2612())
    expect(r.kind).toBe('erc2612')
    expect(r.level).toBe('warning')
    expect(r.flags).toEqual([])
    expect(r.spender).toBe(SPENDER)
    expect(r.spender).toHaveLength(42)
    expect(r.amount).toBe('1000')
    expect(r.expiry).toBe('1900000000')
  })

  it('harcayici kucuk harfle gelse de EIP-55 gosterilir', () => {
    expect(classifyTypedData(erc2612({ message: { spender: SPENDER.toLowerCase() } })).spender).toBe(SPENDER)
  })

  it('deadline:0 SURESI DOLMUS (suresiz DEGIL)', () => {
    const r = classifyTypedData(erc2612({ message: { deadline: '0' } }))
    expect(r.flags).toEqual(['expired'])
    expect(r.flags).not.toContain('no_expiry')
    expect(r.level).toBe('warning')
  })

  it('MaxUint256 -> unlimited + danger', () => {
    const r = classifyTypedData(erc2612({ message: { value: MAX256 } }))
    expect(r.flags).toEqual(['unlimited'])
    expect(r.level).toBe('danger')
  })

  it('MaxUint256 esitligi degil: 2^255 ve 2^160-1 ve 2^128 PRATIKTE sinirsiz; 2^128-1 degil', () => {
    for (const v of [2n ** 255n, 2n ** 160n - 1n, 2n ** 128n]) {
      const r = classifyTypedData(erc2612({ message: { value: v.toString() } }))
      expect(r.flags).toEqual(['practically_unlimited'])
      expect(r.level).toBe('danger')
    }
    expect(classifyTypedData(erc2612({ message: { value: (2n ** 128n - 1n).toString() } })).flags).toEqual([])
  })

  it('amount ham birim string olarak doner (insan okunur sayi YOK)', () => {
    expect(classifyTypedData(erc2612({ message: { value: MAX256 } })).amount).toBe(MAX256)
  })

  it('cok buyuk deadline -> no_expiry', () => {
    expect(classifyTypedData(erc2612({ message: { deadline: MAX256 } })).flags).toEqual(['no_expiry'])
  })

  it('domain`de chainId YOK -> replayable + danger (notr not DEGIL)', () => {
    const r = classifyTypedData(erc2612({ domainFields: [{ name: 'name', type: 'string' }, { name: 'verifyingContract', type: 'address' }] }))
    expect(r.flags).toEqual(['replayable'])
    expect(r.level).toBe('danger')
  })

  it('domain`de verifyingContract YOK -> replayable', () => {
    const r = classifyTypedData(erc2612({ domainFields: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }] }))
    expect(r.flags).toEqual(['replayable'])
  })

  it('bayraklar sabit sirada ve tekrarsiz', () => {
    const r = classifyTypedData(erc2612({
      message: { value: MAX256, deadline: '0' },
      domainFields: [{ name: 'name', type: 'string' }],
    }))
    expect(r.flags).toEqual(['unlimited', 'expired', 'replayable'])
  })
})

describe('classifyTypedData: DAI tipi', () => {
  it('allowed:true tanim geregi SINIRSIZ; amount null', () => {
    const r = classifyTypedData(dai())
    expect(r.kind).toBe('dai')
    expect(r.flags).toEqual(['unlimited'])
    expect(r.level).toBe('danger')
    expect(r.amount).toBeNull()
    expect(r.allowed).toBe(true)
  })

  it('expiry:0 SURESIZ', () => {
    expect(classifyTypedData(dai({ expiry: '0' })).flags).toEqual(['unlimited', 'no_expiry'])
  })

  it('allowed:false izni geri alir: sinirsiz bayragi YOK, amount 0, warning', () => {
    const r = classifyTypedData(dai({ allowed: false }))
    expect(r.flags).toEqual([])
    expect(r.amount).toBe('0')
    expect(r.level).toBe('warning')
    expect(r.allowed).toBe(false)
  })

  it('allowed alani bool degilse (normallesmemis dize) sinirsiz sayilmaz ama firlatmaz', () => {
    expect(() => classifyTypedData(dai({ allowed: 'true' }))).not.toThrow()
  })
})

describe('classifyTypedData: Permit2', () => {
  it('PermitSingle: amount 2^160-1 -> unlimited, expiration 2^48-1 -> no_expiry', () => {
    const r = classifyTypedData(permit2Single({ details: { amount: (2n ** 160n - 1n).toString(), expiration: (2n ** 48n - 1n).toString() } }))
    expect(r.kind).toBe('permit2')
    expect(r.flags).toEqual(['unlimited', 'no_expiry'])
    expect(r.level).toBe('danger')
    expect(r.items).toEqual([{ token: TOKEN, amount: (2n ** 160n - 1n).toString(), expiration: (2n ** 48n - 1n).toString() }])
    expect(r.spender).toBe(SPENDER)
    expect(r.deadline).toBe('1900000000')
  })

  it('PermitSingle: 2^140 pratikte sinirsiz; sade deger bayraksiz', () => {
    expect(classifyTypedData(permit2Single({ details: { amount: (2n ** 140n).toString() } })).flags).toEqual(['practically_unlimited'])
    expect(classifyTypedData(permit2Single()).flags).toEqual([])
    expect(classifyTypedData(permit2Single()).level).toBe('warning')
  })

  it('PermitSingle: expiration 0 Permit2`de "hemen" anlamina gelir; bayrak YOK', () => {
    expect(classifyTypedData(permit2Single({ details: { expiration: '0' } })).flags).toEqual([])
  })

  it('PermitSingle: sigDeadline suresiz -> no_expiry; chainId`siz domain -> replayable', () => {
    expect(classifyTypedData(permit2Single({ sigDeadline: MAX256 })).flags).toEqual(['no_expiry'])
    const r = classifyTypedData(permit2Single({ domainFields: [{ name: 'name', type: 'string' }] }))
    expect(r.flags).toEqual(['replayable'])
  })

  it('PermitBatch: kalemler listelenir, bayraklar birlesir', () => {
    const r = classifyTypedData(permit2Batch([
      { token: TOKEN, amount: '5', expiration: '1900000000', nonce: '0' },
      { token: OTHER, amount: (2n ** 160n - 1n).toString(), expiration: '1900000000', nonce: '1' },
    ]))
    expect(r.kind).toBe('permit2')
    expect(r.items).toHaveLength(2)
    expect(r.items[1].token).toBe('0x1111111111111111111111111111111111111111')
    expect(r.flags).toEqual(['unlimited'])
    expect(r.amount).toBeNull()
  })

  it('PermitTransferFrom ve PermitBatchTransferFrom', () => {
    const one = classifyTypedData(transferFrom({ permitted: { amount: MAX256 } }))
    expect(one.kind).toBe('permit2')
    expect(one.flags).toEqual(['unlimited'])
    expect(one.items).toEqual([{ token: TOKEN, amount: MAX256 }])
    const many = classifyTypedData(batchTransferFrom([{ token: TOKEN, amount: '1' }, { token: OTHER, amount: '2' }]))
    expect(many.kind).toBe('permit2')
    expect(many.items).toHaveLength(2)
    expect(many.flags).toEqual([])
  })

  it('witness`li aileler (tekil ve toplu) permit2 olarak taninir', () => {
    for (const batch of [false, true]) {
      const r = classifyTypedData(witness(batch))
      expect(r.kind).toBe('permit2')
      expect(r.items).toEqual([{ token: TOKEN, amount: '7' }])
      expect(r.spender).toBe(SPENDER)
    }
  })

  it('witness ailesi TokenPermissions farkliysa "yorumlanamiyor" (permit_unknown)', () => {
    const r = classifyTypedData(witness(false, [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint128' }]))
    expect(r.kind).toBe('permit_unknown')
    expect(r.level).toBe('danger')
  })
})

describe('classifyTypedData: Seaport', () => {
  it('verilen ve ALINAN kalemler; yalniz alici=offerer olan consideration listelenir', () => {
    const r = classifyTypedData(seaport({
      offer: [NFT],
      consideration: [pay(OWNER, '1000000000000000000'), pay(OTHER, '25000000000000000')],
    }))
    expect(r.kind).toBe('seaport')
    expect(r.flags).toEqual([])
    expect(r.level).toBe('warning')
    expect(r.items).toEqual([
      { side: 'give', itemType: 'ERC721', token: TOKEN, identifier: '77', amount: '1', endAmount: '1' },
      { side: 'receive', itemType: 'NATIVE', token: '0x0000000000000000000000000000000000000000', identifier: '0', amount: '1000000000000000000', endAmount: '1000000000000000000' },
    ])
  })

  it('imzalayana hicbir sey donmuyorsa "receives_nothing" + danger', () => {
    const r = classifyTypedData(seaport({ offer: [NFT], consideration: [pay(OTHER, '1000')] }))
    expect(r.flags).toEqual(['receives_nothing'])
    expect(r.level).toBe('danger')
    expect(r.items.filter((i) => i.side === 'receive')).toEqual([])
  })

  it('consideration bos / yalniz sifir miktarli iade de "hicbir sey almiyorsunuz"', () => {
    expect(classifyTypedData(seaport({ offer: [NFT], consideration: [] })).flags).toEqual(['receives_nothing'])
    expect(classifyTypedData(seaport({ offer: [NFT], consideration: [pay(OWNER, '0')] })).flags).toEqual(['receives_nothing'])
  })

  it('alici karsilastirmasi buyuk/kucuk harfe duyarsiz', () => {
    const r = classifyTypedData(seaport({ offer: [NFT], consideration: [pay(OWNER.toLowerCase(), '5')] }))
    expect(r.flags).toEqual([])
  })

  it('Seaport 1.0 (`nonce` adli sayac) varyanti da taninir', () => {
    expect(classifyTypedData(seaport({ offer: [NFT], consideration: [pay(OWNER, '5')], counterName: 'nonce' })).kind).toBe('seaport')
  })

  it('bilinmeyen itemType UNKNOWN olarak adlandirilir', () => {
    const r = classifyTypedData(seaport({ offer: [{ ...NFT, itemType: '9' }], consideration: [pay(OWNER, '5')] }))
    expect(r.items[0].itemType).toBe('UNKNOWN')
  })

  it('ayristirilamayan itemType ("zzz") NATIVE degil UNKNOWN olur (kapali-basarisiz)', () => {
    const r = classifyTypedData(seaport({ offer: [{ ...NFT, itemType: 'zzz' }], consideration: [pay(OWNER, '5')] }))
    expect(r.items[0].itemType).toBe('UNKNOWN')
  })

  it('chainId`siz Seaport domain`i replayable', () => {
    const r = classifyTypedData(seaport({ offer: [NFT], consideration: [pay(OWNER, '5')], domainFields: [{ name: 'name', type: 'string' }] }))
    expect(r.flags).toEqual(['replayable'])
  })
})

describe('classifyTypedData: yedek sezgi (kanonik olmayan permit benzeri)', () => {
  it('primaryType adi permit iceriyorsa ve dizgi kanonik degilse permit_unknown + danger', () => {
    const td = erc2612()
    td.types.Permit.push({ name: 'extra', type: 'uint256' })
    td.message.extra = '1'
    const r = classifyTypedData(td)
    expect(r.kind).toBe('permit_unknown')
    expect(r.level).toBe('danger')
    expect(r.spender).toBe(SPENDER)
  })

  it('farkli ad ama `spender` address alani varsa permit_unknown', () => {
    const td = {
      domain: {},
      types: { ...domainOf(DOMAIN_FULL), Approve: [{ name: 'spender', type: 'address' }, { name: 'amt', type: 'uint256' }] },
      primaryType: 'Approve',
      message: { spender: SPENDER, amt: '1' },
    }
    expect(classifyTypedData(td).kind).toBe('permit_unknown')
  })

  it('kanonik tabloda olmayan primaryType adi (MyPermit) sezgiyle permit_unknown olur', () => {
    const td = erc2612()
    td.types = { ...td.types, MyPermit: td.types.Permit }
    delete td.types.Permit
    td.primaryType = 'MyPermit'
    // dizgi `MyPermit(...)` ile baslar: kanonik tabloda yok
    expect(classifyTypedData(td).kind).toBe('permit_unknown')
  })
})

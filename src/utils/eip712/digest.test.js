import { describe, it, expect } from 'vitest'
import { TypedDataEncoder } from 'ethers'
import { hashTypedData } from 'viem'
import { hashTypedDataDigest } from './digest.js'

const TOKEN = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
const OWNER = '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826'
const SPENDER = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'

// EIP-712 spec "Ether Mail" ornegi (Ek B yuku), parse.js'in urettigi
// normallesmis sekilde. Beklenen degerler EIP'in referans Example.js'inden
// (https://eips.ethereum.org/assets/eip-712/Example.js) okunup sabitlendi:
// hafizadan YAZILMADI.
const MAIL = {
  domain: { name: 'Ether Mail', version: '1', chainId: '1', verifyingContract: TOKEN },
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }],
    Mail: [{ name: 'from', type: 'Person' }, { name: 'to', type: 'Person' }, { name: 'contents', type: 'string' }],
  },
  primaryType: 'Mail',
  message: {
    from: { name: 'Cow', wallet: OWNER },
    to: { name: 'Bob', wallet: SPENDER },
    contents: 'Hello, Bob!',
  },
}

const withoutDomainType = (types) => {
  const { EIP712Domain: _omit, ...rest } = types
  return rest
}

describe('hashTypedDataDigest: EIP-712 spec vektoru', () => {
  it('Ether Mail: domainSeparator, structHash ve digest EIP referans degerleriyle eslesir', () => {
    expect(hashTypedDataDigest(MAIL)).toEqual({
      domainSeparator: '0xf2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f',
      structHash: '0xc52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e',
      digest: '0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2',
    })
  })

  it('viem hashTypedData ve ethers TypedDataEncoder.hash ile esit (oracle)', () => {
    const { digest } = hashTypedDataDigest(MAIL)
    const types = withoutDomainType(MAIL.types)
    expect(digest).toBe(hashTypedData({
      domain: { ...MAIL.domain, chainId: 1n }, types, primaryType: 'Mail', message: MAIL.message,
    }))
    expect(digest).toBe(TypedDataEncoder.hash(MAIL.domain, types, MAIL.message))
  })
})

describe('hashTypedDataDigest: gercekci imza turleri (oracle: viem)', () => {
  it('EIP-2612 Permit', () => {
    const td = {
      domain: { name: 'USD Coin', version: '2', chainId: '1', verifyingContract: TOKEN },
      types: {
        EIP712Domain: MAIL.types.EIP712Domain,
        Permit: [
          { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: { owner: OWNER, spender: SPENDER, value: '1000000', nonce: '3', deadline: '1900000000' },
    }
    expect(hashTypedDataDigest(td).digest).toBe(hashTypedData({
      domain: { name: 'USD Coin', version: '2', chainId: 1n, verifyingContract: TOKEN },
      types: withoutDomainType(td.types),
      primaryType: 'Permit',
      message: { owner: OWNER, spender: SPENDER, value: 1000000n, nonce: 3n, deadline: 1900000000n },
    }))
  })

  it('Permit2 PermitSingle (domain`de version YOK, ic ice yapi)', () => {
    const td = {
      domain: { name: 'Permit2', chainId: '1', verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3' },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        PermitSingle: [
          { name: 'details', type: 'PermitDetails' },
          { name: 'spender', type: 'address' },
          { name: 'sigDeadline', type: 'uint256' },
        ],
        PermitDetails: [
          { name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' },
          { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' },
        ],
      },
      primaryType: 'PermitSingle',
      message: {
        details: { token: TOKEN, amount: '1461501637330902918203684832716283019655932542975', expiration: '281474976710655', nonce: '0' },
        spender: SPENDER,
        sigDeadline: '1900000000',
      },
    }
    expect(hashTypedDataDigest(td).digest).toBe(hashTypedData({
      domain: { name: 'Permit2', chainId: 1n, verifyingContract: td.domain.verifyingContract },
      types: withoutDomainType(td.types),
      primaryType: 'PermitSingle',
      message: {
        details: { token: TOKEN, amount: 2n ** 160n - 1n, expiration: 2 ** 48 - 1, nonce: 0 },
        spender: SPENDER,
        sigDeadline: 1900000000n,
      },
    }))
  })
})

describe('hashTypedDataDigest: dapp`e sadakat', () => {
  it('EIP712Domain alan sirasi kanonik DEGILSE dapp`in sirasi kullanilir (viem ile esit, kanonik siradan farkli)', () => {
    const td = {
      ...MAIL,
      domain: { verifyingContract: TOKEN, chainId: '1', name: 'Ether Mail', version: '1' },
      types: {
        ...MAIL.types,
        EIP712Domain: [
          { name: 'verifyingContract', type: 'address' },
          { name: 'chainId', type: 'uint256' },
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
        ],
      },
    }
    const { digest } = hashTypedDataDigest(td)
    expect(digest).toBe(hashTypedData({
      domain: { verifyingContract: TOKEN, chainId: 1n, name: 'Ether Mail', version: '1' },
      types: td.types, primaryType: 'Mail', message: MAIL.message,
    }))
    expect(digest).not.toBe(hashTypedDataDigest(MAIL).digest)
  })

  it('domain`de chainId ve version yoksa yalniz bildirilen alanlar hash`lenir', () => {
    const td = {
      domain: { name: 'Only Name' },
      types: { EIP712Domain: [{ name: 'name', type: 'string' }], Person: MAIL.types.Person },
      primaryType: 'Person',
      message: { name: 'Cow', wallet: OWNER },
    }
    expect(hashTypedDataDigest(td).digest).toBe(hashTypedData({
      domain: { name: 'Only Name' },
      types: { Person: MAIL.types.Person },
      primaryType: 'Person',
      message: td.message,
    }))
  })

  it('primaryType`tan erisilemeyen fazladan tip ozeti degistirmez ve ethers`i atmaz', () => {
    const extra = { ...MAIL, types: { ...MAIL.types, Unused: [{ name: 'x', type: 'uint256' }] } }
    expect(hashTypedDataDigest(extra).digest).toBe(hashTypedDataDigest(MAIL).digest)
  })

  it('semada olmayan fazladan mesaj ve domain alanlari ozete girmez', () => {
    const extra = {
      ...MAIL,
      domain: { ...MAIL.domain, chainId: '1', stray: 'x' },
      message: { ...MAIL.message, stray: 'y' },
    }
    expect(hashTypedDataDigest(extra).digest).toBe(hashTypedDataDigest(MAIL).digest)
  })

  it('ozel EIP712Domain alani ozete girer', () => {
    const td = {
      ...MAIL,
      domain: { ...MAIL.domain, extra: '7' },
      types: { ...MAIL.types, EIP712Domain: [...MAIL.types.EIP712Domain, { name: 'extra', type: 'uint256' }] },
    }
    expect(hashTypedDataDigest(td).digest).toBe(hashTypedData({
      domain: { ...MAIL.domain, chainId: 1n, extra: 7n },
      types: td.types, primaryType: 'Mail', message: MAIL.message,
    }))
    expect(hashTypedDataDigest(td).digest).not.toBe(hashTypedDataDigest(MAIL).digest)
  })

  it('mesaj icerigi degisirse ozet degisir', () => {
    const changed = { ...MAIL, message: { ...MAIL.message, contents: 'Hello, Eve!' } }
    expect(hashTypedDataDigest(changed).digest).not.toBe(hashTypedDataDigest(MAIL).digest)
  })
})

describe('hashTypedDataDigest: sinir degerler (oracle: viem)', () => {
  it('uint256 azami, negatif int256, bool, bytes, bytes32, bos dizi ve Unicode metin', () => {
    const text = 'merhaba \u00fc\u011f \u{1F600}'
    const td = {
      domain: { name: 'Edge' },
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        Edge: [
          { name: 'big', type: 'uint256' },
          { name: 'neg', type: 'int256' },
          { name: 'flag', type: 'bool' },
          { name: 'blob', type: 'bytes' },
          { name: 'tag', type: 'bytes32' },
          { name: 'ids', type: 'uint8[]' },
          { name: 'text', type: 'string' },
        ],
      },
      primaryType: 'Edge',
      message: {
        big: (2n ** 256n - 1n).toString(), neg: '-1', flag: false, blob: '0x', tag: '0x' + 'ab'.repeat(32), ids: [], text,
      },
    }
    expect(hashTypedDataDigest(td).digest).toBe(hashTypedData({
      domain: { name: 'Edge' },
      types: { Edge: td.types.Edge },
      primaryType: 'Edge',
      message: {
        big: 2n ** 256n - 1n, neg: -1n, flag: false, blob: '0x', tag: '0x' + 'ab'.repeat(32), ids: [], text,
      },
    }))
  })

  it('bos EIP712Domain: ayirici ethers hashDomain({}) ile esit', () => {
    const td = {
      domain: {},
      types: { EIP712Domain: [], Person: MAIL.types.Person },
      primaryType: 'Person',
      message: { name: 'Cow', wallet: OWNER },
    }
    expect(hashTypedDataDigest(td).domainSeparator).toBe(TypedDataEncoder.hashDomain({}))
  })
})

describe('hashTypedDataDigest: gecersiz girdide firlatir', () => {
  it('primaryType EIP712Domain', () => {
    expect(() => hashTypedDataDigest({ ...MAIL, primaryType: 'EIP712Domain' })).toThrow()
  })
  it('types.EIP712Domain yok', () => {
    expect(() => hashTypedDataDigest({ ...MAIL, types: withoutDomainType(MAIL.types) })).toThrow()
  })
  it('primaryType tanimsiz', () => {
    expect(() => hashTypedDataDigest({ ...MAIL, primaryType: 'Nope' })).toThrow()
  })
  it('mesajda tanimli alan eksik', () => {
    expect(() => hashTypedDataDigest({ ...MAIL, message: { contents: 'x' } })).toThrow()
  })
})

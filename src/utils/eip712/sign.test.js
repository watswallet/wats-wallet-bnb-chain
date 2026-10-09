import { describe, it, expect, vi } from 'vitest'
import { Wallet, id, verifyTypedData, Signature } from 'ethers'
import { recoverTypedDataAddress } from 'viem'
import { signStoredTypedData } from './sign.js'
import { hashTypedDataDigest } from './digest.js'
import { parseTypedDataParams } from './parse.js'
import { TYPED_DATA_USER_REJECT_MESSAGE } from './errors.js'

const LAB_PAYLOAD = '{"domain":{"name":"Ether Mail","version":"1","chainId":1,"verifyingContract":"0xcccccccccccccccccccccccccccccccccccccccc"},"message":{"from":{"name":"Cow","wallet":"0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826"},"to":{"name":"Bob","wallet":"0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"},"contents":"Hello, Bob!"},"primaryType":"Mail","types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],"Person":[{"name":"name","type":"string"},{"name":"wallet","type":"address"}],"Mail":[{"name":"from","type":"Person"},{"name":"to","type":"Person"},{"name":"contents","type":"string"}]}}'

// EIP-712 spec ornegindeki PUBLIC test anahtari (keccak256("cow")); gercek bir
// tohum/anahtar DEGIL, hicbir yerde deger tasimaz.
const wallet = new Wallet(id('cow'))
const signer = { signDigest: async (hex) => wallet.signingKey.sign(hex).serialized }

const buildRequest = () => {
  const parsed = parseTypedDataParams([wallet.address, LAB_PAYLOAD], { activeChainId: 1 })
  expect(parsed.ok).toBe(true)
  const typedData = parsed.value.typedData
  return { typedData, digest: hashTypedDataDigest(typedData).digest }
}

describe('errors', () => {
  it('kullanici-reddi metni sabit ve Ingilizce', () => {
    expect(TYPED_DATA_USER_REJECT_MESSAGE).toBe('User rejected the request.')
  })
})

describe('signStoredTypedData: basari yolu', () => {
  it('EIP referans imzasiyla birebir esit (r, s, v) ve adres cow cuzdanidir', async () => {
    const request = buildRequest()
    const res = await signStoredTypedData({ request, expectedDigest: request.digest, signer })
    expect(res.ok).toBe(true)
    // Degerler EIP-712 Example.js'ten okunup sabitlendi (r, s, v=28).
    const sig = Signature.from(res.signature)
    expect(sig.r).toBe('0x4355c47d63924e8a72e509b65029052eb6c299d53a04e167c5775fd466751c9d')
    expect(sig.s).toBe('0x07299936d304c153f6443dfa05f40ff007d72911b6f72307f996231605b91562')
    expect(sig.v).toBe(28)
    expect(wallet.address).toBe('0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826')
  })

  it('imza ethers.verifyTypedData ve viem recoverTypedDataAddress ile imzalayan adrese cozulur', async () => {
    const request = buildRequest()
    const res = await signStoredTypedData({ request, expectedDigest: request.digest, signer })
    const original = JSON.parse(LAB_PAYLOAD)
    const { EIP712Domain: _omit, ...types } = original.types
    expect(verifyTypedData(original.domain, types, original.message, res.signature)).toBe(wallet.address)
    const viemAddress = await recoverTypedDataAddress({
      domain: { ...original.domain, chainId: 1n }, types, primaryType: 'Mail', message: original.message, signature: res.signature,
    })
    expect(viemAddress).toBe(wallet.address)
  })

  it('expectedDigest buyuk harfli de kabul edilir; senkron imzaci da calisir', async () => {
    const request = buildRequest()
    const upper = '0x' + request.digest.slice(2).toUpperCase()
    const syncSigner = { signDigest: (hex) => wallet.signingKey.sign(hex).serialized }
    const res = await signStoredTypedData({ request, expectedDigest: upper, signer: syncSigner })
    expect(res.ok).toBe(true)
  })

  it('kayitta digest alani yoksa yine imzalar (digest yeniden hesaplanir)', async () => {
    const { typedData, digest } = buildRequest()
    const res = await signStoredTypedData({ request: { typedData }, expectedDigest: digest, signer })
    expect(res.ok).toBe(true)
  })

  it('signDigest cagrisina HAM digest hex verilir (baska yuk degil)', async () => {
    const request = buildRequest()
    const spy = vi.fn(async (hex) => wallet.signingKey.sign(hex).serialized)
    await signStoredTypedData({ request, expectedDigest: request.digest, signer: { signDigest: spy } })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(request.digest)
  })
})

describe('signStoredTypedData: imzalanan = gosterilen', () => {
  it('popup`in gonderdigi expectedDigest kayittan farkliysa IMZALAMAZ (-32603)', async () => {
    const request = buildRequest()
    const spy = vi.fn(signer.signDigest)
    const other = '0x' + '11'.repeat(32)
    const res = await signStoredTypedData({ request, expectedDigest: other, signer: { signDigest: spy } })
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe(-32603)
    expect(spy).not.toHaveBeenCalled()
  })

  it('kayitli typedData degistirildiyse (digest alani eski) IMZALAMAZ', async () => {
    const request = buildRequest()
    request.typedData.message.contents = 'Hello, Eve!'
    const spy = vi.fn(signer.signDigest)
    const res = await signStoredTypedData({ request, expectedDigest: request.digest, signer: { signDigest: spy } })
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe(-32603)
    expect(spy).not.toHaveBeenCalled()
  })

  it('popup degisen metni gosterip degisen digest yollasa da kayit ile uyusmaz', async () => {
    const request = buildRequest()
    const forged = { ...request.typedData, message: { ...request.typedData.message, contents: 'Hello, Eve!' } }
    const forgedDigest = hashTypedDataDigest(forged).digest
    const res = await signStoredTypedData({ request, expectedDigest: forgedDigest, signer })
    expect(res.ok).toBe(false)
  })
})

describe('signStoredTypedData: hata yollari hicbir zaman firlatmaz', () => {
  it('gecersiz girdiler', async () => {
    const request = buildRequest()
    for (const args of [
      undefined,
      {},
      { request: null, expectedDigest: request.digest, signer },
      { request: {}, expectedDigest: request.digest, signer },
      { request, expectedDigest: 'nope', signer },
      { request, expectedDigest: undefined, signer },
      { request, expectedDigest: request.digest },
      { request, expectedDigest: request.digest, signer: {} },
    ]) {
      const res = await signStoredTypedData(args)
      expect(res.ok).toBe(false)
      expect(res.error.code).toBe(-32603)
      expect(typeof res.error.message).toBe('string')
    }
  })

  it('ozetlenemeyen kayit', async () => {
    const res = await signStoredTypedData({
      request: { typedData: { domain: {}, types: {}, primaryType: 'X', message: {} } },
      expectedDigest: '0x' + '22'.repeat(32),
      signer,
    })
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe(-32603)
  })

  it('imzaci firlatirsa ayrinti sizdirilmaz', async () => {
    const request = buildRequest()
    const boom = { signDigest: async () => { throw new Error('secret key material 0xdeadbeef') } }
    const res = await signStoredTypedData({ request, expectedDigest: request.digest, signer: boom })
    expect(res).toEqual({ ok: false, error: { code: -32603, message: 'Signing failed.' } })
  })

  it('imzaci bozuk imza dondururse reddedilir', async () => {
    const request = buildRequest()
    for (const bad of [undefined, null, '0x12', 42, '0x' + 'zz'.repeat(65)]) {
      const res = await signStoredTypedData({ request, expectedDigest: request.digest, signer: { signDigest: async () => bad } })
      expect(res.ok).toBe(false)
    }
  })

  it('hata mesajlarinda "user rejected" ifadesi gecmez', async () => {
    const request = buildRequest()
    const res = await signStoredTypedData({ request, expectedDigest: '0x' + '11'.repeat(32), signer })
    expect(res.error.message.toLowerCase()).not.toContain('reject')
  })
})

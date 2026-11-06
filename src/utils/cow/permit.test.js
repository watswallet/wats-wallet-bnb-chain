// cow/permit.js: EIP-2612 typed data, domain dogrulama, hook ve onay modu karari. Zincir okumasi yok (Task 9).
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AbiCoder, Interface, MaxUint256, Wallet, TypedDataEncoder, getAddress, keccak256, toUtf8Bytes, verifyTypedData } from 'ethers'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { GPV2_VAULT_RELAYER, PAY_TOKENS } from './config'
import { buildAppData } from './order'
import {
  PERMIT_SELECTOR,
  PERMIT_TYPES,
  PERMIT_ABI,
  permitDomain,
  verifyPermitDomain,
  permitTypedData,
  signPermit,
  buildPermitHook,
  decideApproval,
} from './permit'

const HARDHAT_0_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const HARDHAT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const HARDHAT_1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const HARDHAT_1_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

const USDC_ETH = PAY_TOKENS[1].find((t) => t.symbol === 'USDC').address
const USDT_ETH = PAY_TOKENS[1].find((t) => t.symbol === 'USDT').address
const USDC_ARB = PAY_TOKENS[42161].find((t) => t.symbol === 'USDC').address
const USDC_BSC = PAY_TOKENS[56].find((t) => t.symbol === 'USDC').address
const STOCK = '0x1111111111111111111111111111111111111111'

const S = 5_000_000n
const kod = (fn) => {
  try {
    fn()
  } catch (e) {
    return e.code
  }
  return undefined
}
const kodAsync = async (fn) => {
  try {
    await fn()
  } catch (e) {
    return e.code
  }
  return undefined
}

describe('decideApproval', () => {
  const girdi = (o = {}) => ({ side: 'buy', chainId: 1, payToken: USDC_ETH, allowance: 0n, sellAmount: S, permitInfoOk: true, ...o })

  it('tablo: permit yalniz Al + permit destekli token + dogrulanmis domain + yetersiz izin', () => {
    expect(decideApproval(girdi()).mode).toBe('permit')
    expect(decideApproval(girdi({ chainId: 42161, payToken: USDC_ARB })).mode).toBe('permit')
    expect(decideApproval(girdi({ payToken: USDT_ETH })).mode).toBe('onchain')
    expect(decideApproval(girdi({ chainId: 56, payToken: USDC_BSC })).mode).toBe('onchain')
    expect(decideApproval(girdi({ side: 'sell', payToken: STOCK })).mode).toBe('onchain')
    expect(decideApproval(girdi({ permitInfoOk: false })).mode).toBe('onchain')
    // Sat'ta odeme token'i permit destekli olsa bile (stok satilir ama token sahte yonlu) permit cikmaz
    expect(decideApproval(girdi({ side: 'sell' })).mode).toBe('onchain')
  })

  it('permitInfoOk yalniz tam true ise permit (truthy yetmez)', () => {
    expect(decideApproval(girdi({ permitInfoOk: 1 })).mode).toBe('onchain')
    expect(decideApproval(girdi({ permitInfoOk: undefined })).mode).toBe('onchain')
  })

  it('izin yeterliyse none, bir eksikse permit', () => {
    expect(decideApproval(girdi({ allowance: S })).mode).toBe('none')
    expect(decideApproval(girdi({ allowance: S + 1n })).mode).toBe('none')
    expect(decideApproval(girdi({ allowance: S - 1n })).mode).toBe('permit')
    // Sat tarafinda da yeterli izin none verir
    expect(decideApproval(girdi({ side: 'sell', payToken: STOCK, allowance: S })).mode).toBe('none')
  })

  it('BigInt olmayan allowance/sellAmount ve sellAmount <= 0n INVALID_REQUEST', () => {
    expect(kod(() => decideApproval(girdi({ allowance: '0' })))).toBe('INVALID_REQUEST')
    expect(kod(() => decideApproval(girdi({ allowance: 0 })))).toBe('INVALID_REQUEST')
    expect(kod(() => decideApproval(girdi({ allowance: undefined })))).toBe('INVALID_REQUEST')
    expect(kod(() => decideApproval(girdi({ sellAmount: 5 })))).toBe('INVALID_REQUEST')
    expect(kod(() => decideApproval(girdi({ sellAmount: '5000000' })))).toBe('INVALID_REQUEST')
    expect(kod(() => decideApproval(girdi({ sellAmount: 0n })))).toBe('INVALID_REQUEST')
    expect(kod(() => decideApproval(girdi({ sellAmount: -1n })))).toBe('INVALID_REQUEST')
  })
})

describe('permitDomain', () => {
  it('bos name, sayi version, undefined PERMIT_DOMAIN_MISMATCH', () => {
    const t = (o) => kod(() => permitDomain({ chainId: 1, token: USDC_ETH, name: 'USD Coin', version: '2', ...o }))
    expect(t({ name: '' })).toBe('PERMIT_DOMAIN_MISMATCH')
    expect(t({ name: undefined })).toBe('PERMIT_DOMAIN_MISMATCH')
    expect(t({ name: 5 })).toBe('PERMIT_DOMAIN_MISMATCH')
    expect(t({ version: 2 })).toBe('PERMIT_DOMAIN_MISMATCH')
    expect(t({ version: '' })).toBe('PERMIT_DOMAIN_MISMATCH')
    expect(t({ version: undefined })).toBe('PERMIT_DOMAIN_MISMATCH')
    expect(t({ version: null })).toBe('PERMIT_DOMAIN_MISMATCH')
    expect(t({})).toBeUndefined()
  })

  it('gecerli girdi: chainId Number, verifyingContract EIP-55', () => {
    const d = permitDomain({ chainId: '42161', token: USDC_ARB.toLowerCase(), name: 'USD Coin', version: '2' })
    expect(d).toEqual({ name: 'USD Coin', version: '2', chainId: 42161, verifyingContract: getAddress(USDC_ARB) })
    expect(typeof d.chainId).toBe('number')
    expect(d.verifyingContract).toBe(getAddress(USDC_ARB))
  })
})

describe('verifyPermitDomain', () => {
  const DOMAIN_TYPEHASH = keccak256(toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'))
  const bagimsizAyirici = ({ name, version, chainId, verifyingContract }) =>
    keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [DOMAIN_TYPEHASH, keccak256(toUtf8Bytes(name)), keccak256(toUtf8Bytes(version)), chainId, verifyingContract]
      )
    )
  const domain = permitDomain({ chainId: 1, token: USDC_ETH, name: 'USD Coin', version: '2' })

  it('TypedDataEncoder.hashDomain bagimsiz hesapla ayni degeri verir', () => {
    expect(TypedDataEncoder.hashDomain(domain)).toBe(bagimsizAyirici(domain))
  })

  it('dogru ayirici gecer, kucuk harfli dogru gecer, bir bit farkli firlatir', () => {
    const dogru = bagimsizAyirici(domain)
    expect(() => verifyPermitDomain(domain, dogru)).not.toThrow()
    expect(() => verifyPermitDomain(domain, dogru.toLowerCase())).not.toThrow()
    expect(() => verifyPermitDomain(domain, '0x' + dogru.slice(2).toUpperCase())).not.toThrow()
    const sonBit = (parseInt(dogru.slice(-1), 16) ^ 1).toString(16)
    const bozuk = dogru.slice(0, -1) + sonBit
    expect(kod(() => verifyPermitDomain(domain, bozuk))).toBe('PERMIT_DOMAIN_MISMATCH')
  })

  it('farkli zincir/isim ayiricisi ve dize olmayan deger firlatir', () => {
    const baska = bagimsizAyirici({ ...domain, chainId: 42161 })
    expect(kod(() => verifyPermitDomain(domain, baska))).toBe('PERMIT_DOMAIN_MISMATCH')
    expect(kod(() => verifyPermitDomain(domain, undefined))).toBe('PERMIT_DOMAIN_MISMATCH')
    expect(kod(() => verifyPermitDomain(domain, 5n))).toBe('PERMIT_DOMAIN_MISMATCH')
  })
})

describe('permitTypedData', () => {
  const domain = permitDomain({ chainId: 1, token: USDC_ETH, name: 'USD Coin', version: '2' })
  const kur = (o = {}) => permitTypedData({ domain, owner: HARDHAT_0, nonce: 7n, deadline: 1_800_000_000n, ...o })

  it('spender VaultRelayer, value MaxUint256 SABIT, degerler dize, birincil tip Permit', () => {
    const td = kur()
    expect(td.primaryType).toBe('Permit')
    expect(td.types).toBe(PERMIT_TYPES)
    expect(td.domain).toBe(domain)
    expect(td.message).toEqual({
      owner: HARDHAT_0,
      spender: GPV2_VAULT_RELAYER,
      value: MaxUint256.toString(),
      nonce: '7',
      deadline: '1800000000',
    })
    expect(typeof td.message.deadline).toBe('string')
    expect(typeof td.message.nonce).toBe('string')
  })

  it('cagirici spender/value veremez: ek alanlar yok sayilir', () => {
    const td = kur({ spender: HARDHAT_1, value: 1n, sellAmount: 5n })
    expect(td.message.spender).toBe(GPV2_VAULT_RELAYER)
    expect(td.message.value).toBe(MaxUint256.toString())
  })

  it('nonce/deadline tamsayi dizesi kabul, gecersiz INVALID_REQUEST; owner EIP-55', () => {
    expect(kur({ nonce: '12', deadline: '99' }).message).toMatchObject({ nonce: '12', deadline: '99' })
    expect(kur({ owner: HARDHAT_0.toLowerCase() }).message.owner).toBe(HARDHAT_0)
    expect(kod(() => kur({ nonce: '1.5' }))).toBe('INVALID_REQUEST')
    expect(kod(() => kur({ deadline: -1n }))).toBe('INVALID_REQUEST')
    expect(kod(() => kur({ deadline: undefined }))).toBe('INVALID_REQUEST')
    expect(kod(() => kur({ owner: 'abc' }))).toBe('INVALID_REQUEST')
  })

  it('kaynak: fonksiyon imzasinda spender yok, spender: literali yalniz GPV2_VAULT_RELAYER ile', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const kaynak = yorumsuz(fs.readFileSync(path.join(dir, 'permit.js'), 'utf8'))
    const eslesmeler = [...kaynak.matchAll(/spender\s*:\s*([^,}\s]+)/g)].map((m) => m[1])
    expect(eslesmeler.length).toBeGreaterThan(0)
    for (const e of eslesmeler) expect(e).toBe('GPV2_VAULT_RELAYER')
    const imza = kaynak.match(/export function permitTypedData\(([^)]*)\)/)
    expect(imza).not.toBeNull()
    expect(imza[1]).not.toMatch(/spender|value/)
  })
})

describe('signPermit', () => {
  const domain = permitDomain({ chainId: 1, token: USDC_ETH, name: 'USD Coin', version: '2' })
  const td = permitTypedData({ domain, owner: HARDHAT_0, nonce: 0n, deadline: 1_800_000_000n })

  it('gercek anahtarla imza owner a karsi dogrulanir', async () => {
    const imza = await signPermit(new Wallet(HARDHAT_0_KEY), td)
    expect(imza).toMatch(/^0x[0-9a-f]{130}$/i)
    expect(verifyTypedData(td.domain, td.types, td.message, imza)).toBe(HARDHAT_0)
  })

  it('baska sahibin typed data si icin SIGNATURE_MISMATCH', async () => {
    const baskasi = new Wallet(HARDHAT_1_KEY)
    expect(baskasi.address).toBe(HARDHAT_1)
    expect(await kodAsync(() => signPermit(baskasi, td))).toBe('SIGNATURE_MISMATCH')
  })

  it('bozuk imza (signer cop dondurur) SIGNATURE_MISMATCH, mesajda imza yok, console sessiz', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const spyW = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spyE = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cop = '0x' + 'ab'.repeat(65)
    let err
    try {
      await signPermit({ signTypedData: async () => cop }, td)
    } catch (e) {
      err = e
    }
    expect(err.code).toBe('SIGNATURE_MISMATCH')
    expect(String(err.message)).not.toContain(cop)
    expect(spy).not.toHaveBeenCalled()
    expect(spyW).not.toHaveBeenCalled()
    expect(spyE).not.toHaveBeenCalled()
    spy.mockRestore()
    spyW.mockRestore()
    spyE.mockRestore()
  })
})

describe('buildPermitHook', () => {
  const domain = permitDomain({ chainId: 1, token: USDC_ETH, name: 'USD Coin', version: '2' })
  const deadline = 1_800_000_000n

  async function hook(o = {}) {
    const typedData = permitTypedData({ domain, owner: HARDHAT_0, nonce: 3n, deadline })
    const signature = await signPermit(new Wallet(HARDHAT_0_KEY), typedData)
    return buildPermitHook({ token: USDC_ETH, owner: HARDHAT_0, deadline, signature, ...o })
  }

  it('callData PERMIT_SELECTOR ile baslar ve cozulunce spender/value/deadline/owner dogru', async () => {
    const h = await hook()
    expect(PERMIT_SELECTOR).toBe('0xd505accf')
    expect(h.callData.startsWith(PERMIT_SELECTOR)).toBe(true)
    expect(h.target).toBe(USDC_ETH)
    const tx = new Interface(PERMIT_ABI).parseTransaction({ data: h.callData })
    expect(tx.name).toBe('permit')
    expect(tx.args.owner).toBe(HARDHAT_0)
    expect(tx.args.spender).toBe(GPV2_VAULT_RELAYER)
    expect(tx.args.value).toBe(MaxUint256)
    expect(tx.args.deadline).toBe(deadline)
  })

  it('owner ve token EIP-55 e normalize edilir; bozuk adres INVALID_HOOK', async () => {
    const typedData = permitTypedData({ domain, owner: HARDHAT_0, nonce: 0n, deadline })
    const signature = await signPermit(new Wallet(HARDHAT_0_KEY), typedData)
    const h = buildPermitHook({ token: USDC_ETH.toLowerCase(), owner: HARDHAT_0.toLowerCase(), deadline, signature })
    expect(h.target).toBe(USDC_ETH)
    expect(new Interface(PERMIT_ABI).parseTransaction({ data: h.callData }).args.owner).toBe(HARDHAT_0)
    const t = (o) => kod(() => buildPermitHook({ token: USDC_ETH, owner: HARDHAT_0, deadline, signature, ...o }))
    expect(t({ token: '0x123' })).toBe('INVALID_HOOK')
    expect(t({ owner: 'abc' })).toBe('INVALID_HOOK')
    expect(t({ signature: '0x1234' })).toBe('INVALID_HOOK')
    expect(t({ deadline: 'x' })).toBe('INVALID_HOOK')
  })

  it('v/r/s Signature.from dan: imza geri kurulabilir', async () => {
    const typedData = permitTypedData({ domain, owner: HARDHAT_0, nonce: 3n, deadline })
    const signature = await signPermit(new Wallet(HARDHAT_0_KEY), typedData)
    const h = buildPermitHook({ token: USDC_ETH, owner: HARDHAT_0, deadline, signature })
    const a = new Interface(PERMIT_ABI).parseTransaction({ data: h.callData }).args
    const v = Number(a.v).toString(16)
    expect(a.r + a.s.slice(2) + v.padStart(2, '0')).toBe(signature.toLowerCase())
  })

  it('entegrasyon: buildAppData hooks.pre[0].gasLimit 100000 ve hedef EIP-55', async () => {
    const h = await hook()
    const { json } = buildAppData({ recipient: HARDHAT_1, hook: h })
    const pre = JSON.parse(json).metadata.hooks.pre
    expect(pre).toHaveLength(1)
    expect(pre[0].gasLimit).toBe('100000')
    expect(pre[0].target).toBe(USDC_ETH)
    expect(pre[0].callData).toBe(h.callData)
  })
})

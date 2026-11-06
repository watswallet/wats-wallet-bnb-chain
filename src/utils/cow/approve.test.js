import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Interface, MaxUint256 } from 'ethers'
import {
  APPROVE_ABI,
  APPROVE_RESET_TOKENS,
  buildApproveCalls,
  createCowApprove,
  needsApproveReset,
} from './approve'
import { GPV2_VAULT_RELAYER, PAY_TOKENS } from './config'
import * as quoteStoreFns from './quoteStore'
import { yorumsuz } from '../../test-utils/kaynakTarama'

const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const OTHER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const ATTACKER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const NOW = 1_800_000_000_000
const QUOTE_ID = 'ab'.repeat(16)
const IFACE = new Interface(APPROVE_ABI)

const usdt1 = PAY_TOKENS[1].find((t) => t.symbol === 'USDT').address
const usdc1 = PAY_TOKENS[1].find((t) => t.symbol === 'USDC').address
const usdt56 = PAY_TOKENS[56].find((t) => t.symbol === 'USDT').address
const usdt42161 = PAY_TOKENS[42161].find((t) => t.symbol === 'USDT').address

const decode = (call) => IFACE.decodeFunctionData('approve', call.data)

function memStorage() {
  const m = new Map()
  return {
    async get(k) {
      if (k === null) return Object.fromEntries(m)
      return m.has(k) ? { [k]: m.get(k) } : {}
    },
    async set(o) {
      for (const [k, v] of Object.entries(o)) m.set(k, v)
    },
    async remove(keys) {
      for (const k of [].concat(keys)) m.delete(k)
    },
  }
}

const baseRecord = (over = {}) => ({
  quoteId: QUOTE_ID,
  owner: OWNER,
  chainId: 1,
  sellToken: usdt1,
  buyToken: OTHER,
  sellAmount: '1000000',
  expectedBuy: '5',
  minBuy: '4',
  cowQuoteId: 7,
  createdAt: NOW - 1000,
  expiresAt: NOW + 600_000,
  approveUntil: NOW + 300_000,
  locked: false,
  consumed: false,
  approval: { mode: 'onchain' },
  ...over,
})

async function kur({ record = baseRecord(), allowances = [0n], atsQuoteImpl, atsExecuteImpl, signerAddress = OWNER } = {}) {
  const storage = memStorage()
  if (record) await storage.set({ [quoteStoreFns.QUOTE_KEY_PREFIX + record.quoteId]: record })
  const store = {
    peekQuoteForApprove: vi.fn((a) => quoteStoreFns.peekQuoteForApprove({ ...a, storage })),
  }
  const lista = [...allowances]
  const chain = { readAllowance: vi.fn(async () => (lista.length > 1 ? lista.shift() : lista[0])) }
  const atsQuote = vi.fn(atsQuoteImpl ?? (async ({ calls }) => ({ fee: '1', n: calls.length })))
  const atsExecute = vi.fn(atsExecuteImpl ?? (async () => ({ txHash: '0xabc' })))
  const getSigner = vi.fn(async () => ({ address: signerAddress, privateKey: '0xSECRET' }))
  const svc = createCowApprove({ chain, quoteStore: store, atsQuote, atsExecute, now: () => NOW })
  return { svc, chain, store, atsQuote, atsExecute, getSigner, storage }
}

describe('buildApproveCalls', () => {
  it('allowance 0 -> tek cagri; spender sabit VaultRelayer, deger MaxUint256, to token, call value 0n', () => {
    const calls = buildApproveCalls({ chainId: 1, token: usdt1, allowance: 0n })
    expect(calls).toHaveLength(1)
    const [spender, value] = decode(calls[0])
    expect(spender).toBe(GPV2_VAULT_RELAYER)
    expect(value).toBe(MaxUint256)
    expect(calls[0].to).toBe(usdt1)
    expect(calls[0].value).toBe(0n)
  })

  it('spender/value parametre degil: istekten gelen alanlar yok sayilir', () => {
    const calls = buildApproveCalls({ chainId: 1, token: usdc1, allowance: 0n, spender: ATTACKER, value: 5n })
    const [spender, value] = decode(calls[0])
    expect(spender).toBe(GPV2_VAULT_RELAYER)
    expect(value).toBe(MaxUint256)
    expect(buildApproveCalls.toString()).not.toMatch(/spender\s*[,}]/)
  })

  it('Ethereum USDT + allowance 5n -> [approve 0, approve Max] sirasiyla', () => {
    const calls = buildApproveCalls({ chainId: 1, token: usdt1, allowance: 5n })
    expect(calls).toHaveLength(2)
    expect(decode(calls[0])).toEqual([GPV2_VAULT_RELAYER, 0n])
    expect(decode(calls[1])).toEqual([GPV2_VAULT_RELAYER, MaxUint256])
    expect(calls.every((c) => c.to === usdt1 && c.value === 0n)).toBe(true)
  })

  it('Ethereum USDT + 0n -> tek; BSC USDT + 5n -> tek; Ethereum USDC + 5n -> tek; Arbitrum USDT + 5n -> tek', () => {
    expect(buildApproveCalls({ chainId: 1, token: usdt1, allowance: 0n })).toHaveLength(1)
    expect(buildApproveCalls({ chainId: 56, token: usdt56, allowance: 5n })).toHaveLength(1)
    expect(buildApproveCalls({ chainId: 1, token: usdc1, allowance: 5n })).toHaveLength(1)
    expect(buildApproveCalls({ chainId: 42161, token: usdt42161, allowance: 5n })).toHaveLength(1)
  })

  it('kucuk harf adres ayni sonucu verir, to checksum olur', () => {
    const calls = buildApproveCalls({ chainId: 1, token: usdt1.toLowerCase(), allowance: 5n })
    expect(calls).toHaveLength(2)
    expect(calls[0].to).toBe(usdt1)
  })

  it('gecersiz token / allowance -> INVALID_REQUEST', () => {
    for (const token of ['0x123', '', null, undefined, 5]) {
      expect(() => buildApproveCalls({ chainId: 1, token, allowance: 0n })).toThrow(
        expect.objectContaining({ code: 'INVALID_REQUEST' }),
      )
    }
    expect(() => buildApproveCalls({ chainId: 1, token: usdt1, allowance: 5 })).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    )
  })

  it('sifirlama tablosu config ile uyumlu: yalniz Ethereum USDT', () => {
    expect(Object.keys(APPROVE_RESET_TOKENS)).toEqual(['1'])
    expect(APPROVE_RESET_TOKENS[1]).toEqual([usdt1.toLowerCase()])
    expect(Object.isFrozen(APPROVE_RESET_TOKENS)).toBe(true)
    expect(needsApproveReset(1, usdt1, 1n)).toBe(true)
    expect(needsApproveReset(1, usdt1, 0n)).toBe(false)
    expect(needsApproveReset(56, usdt1, 1n)).toBe(false)
  })
})

describe('createCowApprove.quote', () => {
  it('basari: ATS teklifi, resetFirst ve approveUntil kayittan; calls kayittan kurulur', async () => {
    const { svc, atsQuote } = await kur({ allowances: [5n] })
    const r = await svc.quote({ quoteId: QUOTE_ID, activeAddress: OWNER })
    expect(r).toEqual({
      success: true,
      quote: { fee: '1', n: 2 },
      resetFirst: true,
      approveUntil: NOW + 300_000,
      token: usdt1,
      chainId: 1,
    })
    const arg = atsQuote.mock.calls[0][0]
    expect(arg.chainId).toBe(1)
    expect(arg.address).toBe(OWNER)
    expect(arg.calls).toHaveLength(2)
  })

  it('allowance 0 -> resetFirst false, tek cagri', async () => {
    const { svc, atsQuote } = await kur({ allowances: [0n] })
    const r = await svc.quote({ quoteId: QUOTE_ID, activeAddress: OWNER })
    expect(r.success).toBe(true)
    expect(r.resetFirst).toBe(false)
    expect(atsQuote.mock.calls[0][0].calls).toHaveLength(1)
  })

  const reddedilir = [
    ['onchain olmayan kayit', () => baseRecord({ approval: { mode: 'permit' } }), 'INVALID_REQUEST', OWNER],
    ['kilitli kayit', () => baseRecord({ locked: true }), 'INVALID_REQUEST', OWNER],
    ['suresi gecmis approveUntil', () => baseRecord({ approveUntil: NOW }), 'QUOTE_EXPIRED', OWNER],
    ['baska activeAddress', () => baseRecord(), 'ACCOUNT_CHANGED', OTHER],
    ['kayit yok', () => null, 'QUOTE_NOT_FOUND', OWNER],
  ]
  it.each(reddedilir)('%s -> %s kodu aynen, atsQuote ve allowance okumasi yok', async (_ad, rec, kod, aktif) => {
    const { svc, atsQuote, chain } = await kur({ record: rec() })
    const r = await svc.quote({ quoteId: QUOTE_ID, activeAddress: aktif })
    expect(r).toEqual({ success: false, code: kod })
    expect(atsQuote).not.toHaveBeenCalled()
    expect(chain.readAllowance).not.toHaveBeenCalled()
  })

  it('peekQuoteForApprove kullanilir ve kaydi tuketmez', async () => {
    const { svc, store, storage } = await kur({ allowances: [0n] })
    await svc.quote({ quoteId: QUOTE_ID, activeAddress: OWNER })
    expect(store.peekQuoteForApprove).toHaveBeenCalledTimes(1)
    const key = quoteStoreFns.QUOTE_KEY_PREFIX + QUOTE_ID
    expect((await storage.get(key))[key].consumed).toBe(false)
  })

  it('taze allowance >= S -> INVALID_REQUEST, atsQuote yok', async () => {
    const { svc, atsQuote } = await kur({ allowances: [1000000n] })
    const r = await svc.quote({ quoteId: QUOTE_ID, activeAddress: OWNER })
    expect(r).toEqual({ success: false, code: 'INVALID_REQUEST' })
    expect(atsQuote).not.toHaveBeenCalled()
  })

  it('ATS hatasi -> UNKNOWN + atsCode, ic mesaj sizmaz', async () => {
    const { svc } = await kur({
      atsQuoteImpl: async () => {
        throw Object.assign(new Error('ic ayrinti: rpc https://gizli.example/key'), { code: 'ATS_BALANCE_LOW' })
      },
    })
    const r = await svc.quote({ quoteId: QUOTE_ID, activeAddress: OWNER })
    expect(r).toEqual({ success: false, code: 'UNKNOWN', atsCode: 'ATS_BALANCE_LOW' })
    expect(JSON.stringify(r)).not.toContain('gizli')
  })

  it('ATS hatasi kodsuz -> yalniz UNKNOWN; garip atsCode tasinmaz', async () => {
    const a = await kur({
      atsQuoteImpl: async () => {
        throw new Error('x')
      },
    })
    expect(await a.svc.quote({ quoteId: QUOTE_ID, activeAddress: OWNER })).toEqual({ success: false, code: 'UNKNOWN' })
    const b = await kur({
      atsQuoteImpl: async () => {
        throw Object.assign(new Error('x'), { code: 'bosluk ve <script>' })
      },
    })
    expect(await b.svc.quote({ quoteId: QUOTE_ID, activeAddress: OWNER })).toEqual({ success: false, code: 'UNKNOWN' })
  })

  it('zincir okuma hatasi kodlu aynen, atsQuote yok', async () => {
    const k = await kur()
    k.chain.readAllowance.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'TIMEOUT' }))
    expect(await k.svc.quote({ quoteId: QUOTE_ID, activeAddress: OWNER })).toEqual({ success: false, code: 'TIMEOUT' })
    expect(k.atsQuote).not.toHaveBeenCalled()
  })

  it('saldiri: istekteki spender/calls/token yok sayilir', async () => {
    const { svc, atsQuote } = await kur({ allowances: [0n] })
    await svc.quote({ quoteId: QUOTE_ID, activeAddress: OWNER, spender: ATTACKER, calls: [{ to: ATTACKER }], token: ATTACKER })
    const [call] = atsQuote.mock.calls[0][0].calls
    expect(call.to).toBe(usdt1)
    expect(decode(call)[0]).toBe(GPV2_VAULT_RELAYER)
  })
})

describe('createCowApprove.execute', () => {
  it('basari: getSigner bir kez, atsExecute dogru argumanla, allowance sonradan okunur', async () => {
    const { svc, atsExecute, getSigner, chain } = await kur({ allowances: [5n, MaxUint256] })
    const quoted = { fee: '1' }
    const r = await svc.execute({ quoteId: QUOTE_ID, activeAddress: OWNER, quoted, getSigner })
    expect(r).toEqual({ success: true, txHash: '0xabc', allowance: MaxUint256.toString(), confirmed: true })
    expect(getSigner).toHaveBeenCalledTimes(1)
    expect(chain.readAllowance).toHaveBeenCalledTimes(2)
    const arg = atsExecute.mock.calls[0][0]
    expect(arg.quoted).toBe(quoted)
    expect(arg.address).toBe(OWNER)
    expect(arg.chainId).toBe(1)
    expect(arg.signer.address).toBe(OWNER)
    expect(arg.calls).toHaveLength(2)
    expect(decode(arg.calls[0])).toEqual([GPV2_VAULT_RELAYER, 0n])
    expect(decode(arg.calls[1])).toEqual([GPV2_VAULT_RELAYER, MaxUint256])
  })

  it('kontroller gecmeden getSigner cagrilmaz (kayit yok / hesap degisti / sure doldu / gereksiz)', async () => {
    const durumlar = [
      [null, OWNER, [0n]],
      [baseRecord(), OTHER, [0n]],
      [baseRecord({ approveUntil: NOW - 1 }), OWNER, [0n]],
      [baseRecord({ approval: { mode: 'none' } }), OWNER, [0n]],
    ]
    for (const [record, aktif, allowances] of durumlar) {
      const k = await kur({ record, allowances })
      const r = await k.svc.execute({ quoteId: QUOTE_ID, activeAddress: aktif, quoted: {}, getSigner: k.getSigner })
      expect(r.success).toBe(false)
      expect(k.getSigner).not.toHaveBeenCalled()
      expect(k.atsExecute).not.toHaveBeenCalled()
    }
  })

  it('signer.address farkli -> ACCOUNT_CHANGED, atsExecute yok', async () => {
    const k = await kur({ allowances: [0n], signerAddress: OTHER })
    const r = await k.svc.execute({ quoteId: QUOTE_ID, activeAddress: OWNER, quoted: {}, getSigner: k.getSigner })
    expect(r).toEqual({ success: false, code: 'ACCOUNT_CHANGED' })
    expect(k.getSigner).toHaveBeenCalledTimes(1)
    expect(k.atsExecute).not.toHaveBeenCalled()
  })

  it('signer.address kucuk harfle de eslesir', async () => {
    const k = await kur({ allowances: [0n, MaxUint256], signerAddress: OWNER.toLowerCase() })
    const r = await k.svc.execute({ quoteId: QUOTE_ID, activeAddress: OWNER, quoted: {}, getSigner: k.getSigner })
    expect(r.success).toBe(true)
  })

  it('allowance sonrasi okuma yetersiz -> APPROVAL_REQUIRED, basari yok', async () => {
    const k = await kur({ allowances: [0n, 999999n] })
    const r = await k.svc.execute({ quoteId: QUOTE_ID, activeAddress: OWNER, quoted: {}, getSigner: k.getSigner })
    expect(r).toEqual({ success: false, code: 'APPROVAL_REQUIRED' })
    expect(k.atsExecute).toHaveBeenCalledTimes(1)
  })

  it('allowance tam S ise basari sayilir (>= S)', async () => {
    const k = await kur({ allowances: [0n, 1000000n] })
    const r = await k.svc.execute({ quoteId: QUOTE_ID, activeAddress: OWNER, quoted: {}, getSigner: k.getSigner })
    expect(r.success).toBe(true)
    expect(r.allowance).toBe('1000000')
  })

  it('execute sinir: baslangic allowance TAM S ise skipped (>= S), S - 1 ise approve gonderilir', async () => {
    const tam = await kur({ allowances: [1000000n] })
    const r = await tam.svc.execute({ quoteId: QUOTE_ID, activeAddress: OWNER, quoted: {}, getSigner: tam.getSigner })
    expect(r).toEqual({ success: true, skipped: true, allowance: '1000000', confirmed: true, txHash: null })
    expect(tam.atsExecute).not.toHaveBeenCalled()
    expect(tam.getSigner).not.toHaveBeenCalled()
    const az = await kur({ allowances: [999999n, 1000000n] })
    const r2 = await az.svc.execute({ quoteId: QUOTE_ID, activeAddress: OWNER, quoted: {}, getSigner: az.getSigner })
    expect(r2.success).toBe(true)
    expect(r2.skipped).toBeUndefined()
    expect(az.atsExecute).toHaveBeenCalledTimes(1)
  })

  it('skipped yolu: allowance >= S -> atsExecute ve getSigner cagrilmaz', async () => {
    const k = await kur({ allowances: [MaxUint256] })
    const r = await k.svc.execute({ quoteId: QUOTE_ID, activeAddress: OWNER, quoted: {}, getSigner: k.getSigner })
    expect(r).toEqual({ success: true, skipped: true, allowance: MaxUint256.toString(), confirmed: true, txHash: null })
    expect(k.atsExecute).not.toHaveBeenCalled()
    expect(k.getSigner).not.toHaveBeenCalled()
  })

  it('ATS hatasi -> { UNKNOWN, atsCode }, ic mesaj sizmaz, sonrasi okuma yapilmaz', async () => {
    const k = await kur({
      allowances: [0n],
      atsExecuteImpl: async () => {
        throw Object.assign(new Error('rpc https://gizli.example/anahtar 0xSECRET'), { code: 'ATS_SEND_FAILED' })
      },
    })
    const r = await k.svc.execute({ quoteId: QUOTE_ID, activeAddress: OWNER, quoted: {}, getSigner: k.getSigner })
    expect(r).toEqual({ success: false, code: 'UNKNOWN', atsCode: 'ATS_SEND_FAILED' })
    expect(JSON.stringify(r)).not.toMatch(/gizli|SECRET/)
    expect(k.chain.readAllowance).toHaveBeenCalledTimes(1)
  })

  it('getSigner firlatirsa kodlu hata aynen, bilinmeyen UNKNOWN', async () => {
    const k = await kur({ allowances: [0n] })
    const r1 = await k.svc.execute({
      quoteId: QUOTE_ID,
      activeAddress: OWNER,
      quoted: {},
      getSigner: async () => {
        throw Object.assign(new Error('x'), { code: 'WALLET_LOCKED' })
      },
    })
    expect(r1).toEqual({ success: false, code: 'WALLET_LOCKED' })
    const r2 = await k.svc.execute({
      quoteId: QUOTE_ID,
      activeAddress: OWNER,
      quoted: {},
      getSigner: async () => {
        throw new Error('ham')
      },
    })
    expect(r2).toEqual({ success: false, code: 'UNKNOWN' })
  })

  it('saldiri: istekteki spender/calls/token atsExecute calls degerini degistirmez', async () => {
    const k = await kur({ allowances: [0n, MaxUint256] })
    await k.svc.execute({
      quoteId: QUOTE_ID,
      activeAddress: OWNER,
      quoted: {},
      getSigner: k.getSigner,
      spender: ATTACKER,
      calls: [{ to: ATTACKER, value: 9n, data: '0x' }],
      token: ATTACKER,
    })
    const { calls } = k.atsExecute.mock.calls[0][0]
    expect(calls).toHaveLength(1)
    expect(calls[0].to).toBe(usdt1)
    expect(calls[0].value).toBe(0n)
    expect(decode(calls[0])).toEqual([GPV2_VAULT_RELAYER, MaxUint256])
  })

  it('sonuc JSON.stringify ile gecer (BigInt yok) ve console cagrilmaz', async () => {
    const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const k = await kur({ allowances: [5n, MaxUint256] })
    const r = await k.svc.execute({ quoteId: QUOTE_ID, activeAddress: OWNER, quoted: {}, getSigner: k.getSigner })
    const q = await (await kur({ allowances: [5n] })).svc.quote({ quoteId: QUOTE_ID, activeAddress: OWNER })
    expect(() => JSON.stringify(r)).not.toThrow()
    expect(() => JSON.stringify(q)).not.toThrow()
    expect(JSON.stringify(r)).not.toContain('SECRET')
    for (const s of spies) expect(s).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

describe('approve.js kaynak taramasi', () => {
  const kaynak = yorumsuz(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'approve.js'), 'utf8'))
  it('privateKey, localStorage, fetch( ve console. yok', () => {
    expect(kaynak).not.toMatch(/privateKey/)
    expect(kaynak).not.toMatch(/localStorage/)
    expect(kaynak).not.toMatch(/fetch\(/)
    expect(kaynak).not.toMatch(/console\./)
  })
  it('harcayici yalniz GPV2_VAULT_RELAYER sabitinden gelir, adres literali yok', () => {
    expect(kaynak).toMatch(/GPV2_VAULT_RELAYER/)
    expect(kaynak.replace('0xdac17f958d2ee523a2206206994597c13d831ec7', '')).not.toMatch(/0x[0-9a-fA-F]{40}/)
  })
})

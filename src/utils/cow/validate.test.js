import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateQuoteId, validateQuoteRequest } from './validate'
import { XSTOCKS } from '../../data/xStocks'
import { BSTOCKS } from '../../data/bStocks'
import { COW_CHAIN_IDS, PAY_TOKENS } from './config'
import { yorumsuz } from '../../test-utils/kaynakTarama'

const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BSC_USDT = PAY_TOKENS[56].find((t) => t.symbol === 'USDT').address
const ETH_USDC = PAY_TOKENS[1].find((t) => t.symbol === 'USDC').address
const HISSE = XSTOCKS.find((t) => t.chains.includes(56))
const istek = (ek = {}) => ({ side: 'buy', chainId: 56, stockAddress: HISSE.address, payToken: BSC_USDT, amount: '100.5', ...ek })
const dene = (ek) => validateQuoteRequest(istek(ek), { owner: OWNER })
const INVALID = { ok: false, code: 'INVALID_REQUEST' }

describe('validateQuoteId', () => {
  it('32 kucuk hex kabul', () => {
    expect(validateQuoteId('a1'.repeat(16))).toEqual({ ok: true, value: 'a1'.repeat(16) })
  })
  it('buyuk harf, kisa, uzun, nesne, bos reddedilir', () => {
    for (const v of ['A1'.repeat(16), 'a'.repeat(31), 'a'.repeat(33), {}, null, undefined, 5, ['a'.repeat(32)], ' ' + 'a'.repeat(32)]) {
      expect(validateQuoteId(v)).toEqual(INVALID)
    }
  })
})

describe('validateQuoteRequest', () => {
  it('gecerli Al (BSC USDT)', () => {
    const r = dene()
    expect(r.ok).toBe(true)
    expect(r.value.side).toBe('buy')
    expect(r.value.chainId).toBe(56)
    expect(r.value.owner).toBe(OWNER)
    expect(r.value.stock.symbol).toBe(HISSE.symbol)
    expect(r.value.stock.issuer).toBe('xstocks')
    expect(r.value.pay.symbol).toBe('USDT')
    expect(r.value.amountText).toBe('100.5')
  })

  it('gecerli Sat (Ethereum USDC, kucuk harf adres)', () => {
    const h = XSTOCKS.find((t) => t.chains.includes(1))
    const r = dene({ side: 'sell', chainId: 1, stockAddress: h.address.toLowerCase(), payToken: ETH_USDC.toLowerCase(), amount: '3' })
    expect(r.ok).toBe(true)
    expect(r.value.stock.address).toBe(h.address)
    expect(r.value.pay.symbol).toBe('USDC')
  })

  it('side gecersiz -> INVALID_REQUEST', () => {
    for (const side of ['BUY', 'swap', undefined, null, 1]) expect(dene({ side })).toEqual(INVALID)
  })

  it('chainId: dize, 10, olmayan -> UNSUPPORTED_CHAIN', () => {
    for (const chainId of ['1', 10, 5000, 1.5, undefined, null, NaN]) {
      expect(dene({ chainId })).toEqual({ ok: false, code: 'UNSUPPORTED_CHAIN' })
    }
  })

  it('bozuk adres / eksik girdi -> INVALID_REQUEST', () => {
    expect(dene({ stockAddress: '0x123' })).toEqual(INVALID)
    expect(dene({ payToken: 'abc' })).toEqual(INVALID)
    expect(dene({ stockAddress: undefined })).toEqual(INVALID)
    expect(validateQuoteRequest(istek(), { owner: '0xbozuk' })).toEqual(INVALID)
    expect(validateQuoteRequest(istek(), {})).toEqual(INVALID)
    expect(validateQuoteRequest(null, { owner: OWNER })).toEqual(INVALID)
  })

  it('bozuk checksum (karisik harf) INVALID_REQUEST', () => {
    const i = HISSE.address.search(/[a-f]/i)
    const c = HISSE.address[i]
    const bozuk = HISSE.address.slice(0, i) + (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()) + HISSE.address.slice(i + 1)
    expect(dene({ stockAddress: bozuk })).toEqual(INVALID)
  })

  it('katalogda olmayan hisse (...x sembollu olsa da) -> UNSUPPORTED_TOKEN', () => {
    expect(dene({ stockAddress: '0x' + '11'.repeat(20) })).toEqual({ ok: false, code: 'UNSUPPORTED_TOKEN' })
  })

  it('katalogun chains listesi disindaki cift -> UNSUPPORTED_TOKEN (G2)', () => {
    const t = XSTOCKS.find((x) => COW_CHAIN_IDS.some((c) => !x.chains.includes(c)))
    const c = COW_CHAIN_IDS.find((id) => !t.chains.includes(id))
    const pay = PAY_TOKENS[c][0].address
    expect(dene({ chainId: c, stockAddress: t.address, payToken: pay })).toEqual({ ok: false, code: 'UNSUPPORTED_TOKEN' })
  })

  it('xStocks olmayan (bStocks) hisse -> UNSUPPORTED_TOKEN', () => {
    const b = BSTOCKS[0]
    expect(dene({ stockAddress: b.address })).toEqual({ ok: false, code: 'UNSUPPORTED_TOKEN' })
  })

  it('USDC.e ve listede olmayan odeme tokeni -> UNSUPPORTED_TOKEN', () => {
    const usdce = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'
    const arb = XSTOCKS.find((t) => t.chains.includes(42161))
    if (arb) expect(dene({ chainId: 42161, stockAddress: arb.address, payToken: usdce })).toEqual({ ok: false, code: 'UNSUPPORTED_TOKEN' })
    expect(dene({ payToken: '0x' + '33'.repeat(20) })).toEqual({ ok: false, code: 'UNSUPPORTED_TOKEN' })
    // baska zincirin odeme tokeni bu zincirde gecmez
    expect(dene({ payToken: ETH_USDC })).toEqual({ ok: false, code: 'UNSUPPORTED_TOKEN' })
  })

  it('amount gecersizleri -> INVALID_REQUEST', () => {
    for (const amount of ['1e3', '0', '0.0', '0.000', '-1', ' 1', '1 ', '', '.5', '5.', '01', '1,5', '+1', '0x10', 5, 0, null, undefined, 1n, {}]) {
      expect(dene({ amount }), String(amount)).toEqual(INVALID)
    }
  })

  it('amount sinirlari: 30 tam hane + 36 ondalik gecer, fazlasi reddedilir', () => {
    expect(dene({ amount: '1' + '0'.repeat(29) }).ok).toBe(true)
    expect(dene({ amount: '1' + '0'.repeat(30) }).ok).toBe(false)
    expect(dene({ amount: '0.' + '1'.repeat(36) }).ok).toBe(true)
    expect(dene({ amount: '0.' + '1'.repeat(37) }).ok).toBe(false)
    expect(dene({ amount: '0.5' }).value.amountText).toBe('0.5')
    expect(dene({ amount: '0.000001' }).ok).toBe(true)
  })

  it('istekteki alici/harcayici alani cikti degerine girmez', () => {
    const r = dene({ receiver: '0x' + '44'.repeat(20), spender: '0x' + '55'.repeat(20) })
    expect(r.ok).toBe(true)
    expect(Object.keys(r.value).sort()).toEqual(['amountText', 'chainId', 'owner', 'pay', 'side', 'stock'])
  })
})

describe('kaynak taramasi', () => {
  const kod = yorumsuz(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'validate.js'), 'utf8'))
  it('alici/harcayici anahtari yok (arayuzden okunmaz)', () => {
    expect(kod).not.toMatch(/receiver/i)
    expect(kod).not.toMatch(/spender/i)
  })
})

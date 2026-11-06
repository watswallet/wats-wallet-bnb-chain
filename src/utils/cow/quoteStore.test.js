import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  QUOTE_KEY_PREFIX,
  QUOTE_GC_GRACE_MS,
  newQuoteId,
  saveQuote,
  getQuote,
  checkQuote,
  claimQuote,
  peekQuoteForApprove,
  pruneQuotes,
} from './quoteStore'
import { APPROVE_WINDOW_MS } from './config'
import { yorumsuz } from '../../test-utils/kaynakTarama'

const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const OTHER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const NOW = 1_800_000_000_000
const ID = 'a'.repeat(32)

// Bellekte sahte session deposu; get(null) tumunu doner.
function sahteDepo(baslangic = {}) {
  const veri = { ...baslangic }
  return {
    veri,
    async get(keys) {
      if (keys === null || keys === undefined) return { ...veri }
      const liste = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(liste.filter((k) => k in veri).map((k) => [k, veri[k]]))
    },
    async set(obj) {
      Object.assign(veri, JSON.parse(JSON.stringify(obj)))
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete veri[k]
    },
  }
}

const kayit = (ek = {}) => ({
  quoteId: ID,
  createdAt: NOW,
  expiresAt: NOW + 30_000,
  approveUntil: NOW + APPROVE_WINDOW_MS,
  owner: OWNER,
  chainId: 56,
  side: 'buy',
  symbol: 'TSLAx',
  stockAddress: '0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0',
  payToken: '0x55d398326f99059fF775485246999027B3197955',
  sellToken: '0x55d398326f99059fF775485246999027B3197955',
  buyToken: '0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0',
  sellAmount: '100000000000000000000',
  expectedBuy: '400000000000000000',
  minBuy: '398000000000000000',
  sellDecimals: 18,
  buyDecimals: 18,
  protocolFeeBps: 0,
  fees: { network: '0', protocol: '0', partner: '100000000000000000' },
  cowQuoteId: 12345,
  verified: true,
  appData: { json: '{}', hash: '0x' + '00'.repeat(32) },
  approval: { mode: 'none', allowance: '0' },
  locked: false,
  lockReason: null,
  consumed: false,
  display: {},
  reference: null,
  ...ek,
})

const ONCHAIN = { mode: 'onchain', allowance: '0' }
const ctx = (ek = {}) => ({ activeAddress: OWNER, now: NOW + 1000, window: 'place', ...ek })

describe('newQuoteId', () => {
  it('32 kucuk harf hex, iki cagri farkli', () => {
    const a = newQuoteId()
    const b = newQuoteId()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(b).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })
})

describe('checkQuote', () => {
  it('gecerli kayit null doner', () => {
    expect(checkQuote(kayit(), ctx())).toBeNull()
    expect(checkQuote(kayit({ approval: ONCHAIN }), ctx({ window: 'approve' }))).toBeNull()
  })

  it('kayit yok -> QUOTE_NOT_FOUND', () => {
    expect(checkQuote(null, ctx())).toBe('QUOTE_NOT_FOUND')
    expect(checkQuote(undefined, ctx())).toBe('QUOTE_NOT_FOUND')
  })

  it('her kod icin tek kosul bozulur', () => {
    expect(checkQuote(kayit({ consumed: true }), ctx())).toBe('QUOTE_USED')
    expect(checkQuote(kayit(), ctx({ activeAddress: OTHER }))).toBe('ACCOUNT_CHANGED')
    expect(checkQuote(kayit({ locked: true, lockReason: 'PRICE_PROTECTION' }), ctx())).toBe('QUOTE_LOCKED')
    expect(checkQuote(kayit({ approval: ONCHAIN }), ctx())).toBe('APPROVAL_REQUIRED')
    expect(checkQuote(kayit(), ctx({ now: NOW + 30_000 }))).toBe('QUOTE_EXPIRED')
  })

  it('hesap karsilastirmasi buyuk/kucuk harf duyarsiz', () => {
    expect(checkQuote(kayit(), ctx({ activeAddress: OWNER.toLowerCase() }))).toBeNull()
    expect(checkQuote(kayit(), ctx({ activeAddress: undefined }))).toBe('ACCOUNT_CHANGED')
  })

  it('siralama: USED > ACCOUNT_CHANGED > LOCKED > APPROVAL_REQUIRED > EXPIRED', () => {
    const cokBozuk = kayit({ consumed: true, locked: true, approval: ONCHAIN, expiresAt: NOW })
    expect(checkQuote(cokBozuk, ctx({ activeAddress: OTHER }))).toBe('QUOTE_USED')
    expect(checkQuote({ ...cokBozuk, consumed: false }, ctx({ activeAddress: OTHER }))).toBe('ACCOUNT_CHANGED')
    expect(checkQuote({ ...cokBozuk, consumed: false }, ctx())).toBe('QUOTE_LOCKED')
    expect(checkQuote({ ...cokBozuk, consumed: false, locked: false }, ctx())).toBe('APPROVAL_REQUIRED')
    expect(checkQuote({ ...cokBozuk, consumed: false, locked: false, approval: { mode: 'none', allowance: '0' } }, ctx())).toBe(
      'QUOTE_EXPIRED',
    )
  })

  it('sure siniri: expiresAt - 1 gecer, expiresAt dolmus', () => {
    const k = kayit()
    expect(checkQuote(k, ctx({ now: k.expiresAt - 1 }))).toBeNull()
    expect(checkQuote(k, ctx({ now: k.expiresAt }))).toBe('QUOTE_EXPIRED')
  })

  it('approve penceresi approveUntil e gore; place suresi dolmus kayit approve da gecerli (K6)', () => {
    const k = kayit({ approval: ONCHAIN })
    expect(checkQuote(k, ctx({ window: 'approve', now: k.expiresAt + 1000 }))).toBeNull()
    expect(checkQuote(k, ctx({ window: 'approve', now: k.approveUntil - 1 }))).toBeNull()
    expect(checkQuote(k, ctx({ window: 'approve', now: k.approveUntil }))).toBe('QUOTE_EXPIRED')
  })

  it('approve penceresinde locked ya da mode onchain degilse INVALID_REQUEST', () => {
    expect(checkQuote(kayit(), ctx({ window: 'approve' }))).toBe('INVALID_REQUEST')
    expect(checkQuote(kayit({ locked: true, approval: ONCHAIN }), ctx({ window: 'approve' }))).toBe('INVALID_REQUEST')
    expect(checkQuote(kayit({ approval: { mode: 'permit', allowance: '0' } }), ctx({ window: 'approve' }))).toBe(
      'INVALID_REQUEST',
    )
  })

  it('approve penceresinde de consumed ve hesap kontrolu yapilir', () => {
    const k = kayit({ approval: ONCHAIN })
    expect(checkQuote({ ...k, consumed: true }, ctx({ window: 'approve' }))).toBe('QUOTE_USED')
    expect(checkQuote(k, ctx({ window: 'approve', activeAddress: OTHER }))).toBe('ACCOUNT_CHANGED')
  })

  it('now sonlu sayi degilse sure kontrolu GECMEZ: INVALID_REQUEST (fail-closed), iki pencerede de', () => {
    const k = kayit({ approval: ONCHAIN })
    const gecerli = kayit()
    for (const now of [undefined, null, NaN, Infinity, -Infinity, '1700000001000', {}]) {
      expect(checkQuote(gecerli, ctx({ now }))).toBe('INVALID_REQUEST')
      expect(checkQuote(k, ctx({ window: 'approve', now }))).toBe('INVALID_REQUEST')
    }
  })

  it('bilinmeyen pencere INVALID_REQUEST', () => {
    expect(checkQuote(kayit(), ctx({ window: 'x' }))).toBe('INVALID_REQUEST')
  })
})

describe('saveQuote / getQuote', () => {
  it('yazar ve okur; anahtar onekli', async () => {
    const storage = sahteDepo()
    await saveQuote(kayit(), { storage, now: NOW })
    expect(Object.keys(storage.veri)).toEqual([QUOTE_KEY_PREFIX + ID])
    expect(await getQuote(ID, { storage })).toEqual(kayit())
    expect(await getQuote('b'.repeat(32), { storage })).toBeNull()
  })

  it('BigInt / fonksiyon iceren kaydi reddeder (dis ve ic alan)', async () => {
    const storage = sahteDepo()
    await expect(saveQuote(kayit({ sellAmount: 5n }), { storage, now: NOW })).rejects.toThrow()
    await expect(saveQuote(kayit({ fees: { network: 0n, protocol: '0', partner: '0' } }), { storage, now: NOW })).rejects.toThrow()
    await expect(saveQuote(kayit({ display: { x: () => 1 } }), { storage, now: NOW })).rejects.toThrow()
    expect(storage.veri).toEqual({})
  })

  it('sekil dogrulamasi: quoteId, tutar dizesi, cowQuoteId', async () => {
    const storage = sahteDepo()
    for (const bozuk of [
      { quoteId: 'A'.repeat(32) },
      { quoteId: 'a'.repeat(31) },
      { sellAmount: '1.5' },
      { expectedBuy: 7 },
      { minBuy: '' },
      { cowQuoteId: 1.5 },
      { cowQuoteId: '12' },
    ]) {
      await expect(saveQuote(kayit(bozuk), { storage, now: NOW })).rejects.toThrow()
    }
    expect(storage.veri).toEqual({})
  })

  it('hata kodu INVALID_REQUEST', async () => {
    const e = await saveQuote(kayit({ sellAmount: 5n }), { storage: sahteDepo(), now: NOW }).catch((x) => x)
    expect(e.code).toBe('INVALID_REQUEST')
  })
})

describe('pruneQuotes', () => {
  it('suresi + 60 sn gecenleri siler, gecmeyeni korur, onek disina dokunmaz', async () => {
    const eski = kayit({ quoteId: '1'.repeat(32) })
    const taze = kayit({ quoteId: '2'.repeat(32), expiresAt: NOW + 10 * 60_000, approveUntil: NOW + 10 * 60_000 })
    const storage = sahteDepo({
      [QUOTE_KEY_PREFIX + eski.quoteId]: eski,
      [QUOTE_KEY_PREFIX + taze.quoteId]: taze,
      baska_anahtar: { expiresAt: 1, approveUntil: 1 },
    })
    await pruneQuotes(eski.approveUntil + QUOTE_GC_GRACE_MS + 1, { storage })
    expect(Object.keys(storage.veri).sort()).toEqual(['baska_anahtar', QUOTE_KEY_PREFIX + taze.quoteId])
  })

  it('iki sureden gec olani esas alir: approveUntil dolmadan silinmez', async () => {
    const k = kayit()
    const storage = sahteDepo({ [QUOTE_KEY_PREFIX + k.quoteId]: k })
    await pruneQuotes(k.expiresAt + QUOTE_GC_GRACE_MS + 1, { storage })
    expect(Object.keys(storage.veri)).toHaveLength(1)
  })

  it('saveQuote yazimdan sonra eskileri budar', async () => {
    const eski = kayit({ quoteId: '1'.repeat(32) })
    const storage = sahteDepo({ [QUOTE_KEY_PREFIX + eski.quoteId]: eski })
    const simdi = eski.approveUntil + QUOTE_GC_GRACE_MS + 1
    const yeni = kayit({ quoteId: '3'.repeat(32), createdAt: simdi, expiresAt: simdi + 30_000, approveUntil: simdi + APPROVE_WINDOW_MS })
    await saveQuote(yeni, { storage, now: simdi })
    expect(Object.keys(storage.veri)).toEqual([QUOTE_KEY_PREFIX + yeni.quoteId])
  })
})

describe('claimQuote', () => {
  const args = (storage, ek = {}) => ({ quoteId: ID, activeAddress: OWNER, now: NOW + 1000, storage, ...ek })

  it('now bozuksa (NaN/null) claim emri TUKETMEZ: INVALID_REQUEST, kayit consumed olmaz, sonra gecerli now ile alinabilir', async () => {
    const storage = sahteDepo()
    await saveQuote(kayit(), { storage, now: NOW })
    for (const now of [NaN, null]) {
      expect(await claimQuote(args(storage, { now }))).toEqual({ ok: false, code: 'INVALID_REQUEST' })
      expect((await getQuote(ID, { storage })).consumed).toBe(false)
    }
    expect((await claimQuote(args(storage))).ok).toBe(true)
  })

  it('ilk cagri ok ve kayit consumed; ikinci QUOTE_USED', async () => {
    const storage = sahteDepo()
    await saveQuote(kayit(), { storage, now: NOW })
    const a = await claimQuote(args(storage))
    expect(a.ok).toBe(true)
    expect(a.record.quoteId).toBe(ID)
    expect((await getQuote(ID, { storage })).consumed).toBe(true)
    expect(await claimQuote(args(storage))).toEqual({ ok: false, code: 'QUOTE_USED' })
  })

  it('Promise.all ile iki eszamanli cagri: tam bir ok', async () => {
    const storage = sahteDepo()
    await saveQuote(kayit(), { storage, now: NOW })
    const sonuc = await Promise.all([claimQuote(args(storage)), claimQuote(args(storage))])
    expect(sonuc.filter((s) => s.ok)).toHaveLength(1)
    expect(sonuc.filter((s) => !s.ok).map((s) => s.code)).toEqual(['QUOTE_USED'])
  })

  it('depo yavas olsa da uc eszamanli cagridan yalniz biri gecer', async () => {
    const storage = sahteDepo()
    await saveQuote(kayit(), { storage, now: NOW })
    const get = storage.get.bind(storage)
    storage.get = async (k) => {
      const s = await get(k)
      await new Promise((r) => setTimeout(r, 5))
      return s
    }
    const sonuc = await Promise.all([claimQuote(args(storage)), claimQuote(args(storage)), claimQuote(args(storage))])
    expect(sonuc.filter((s) => s.ok)).toHaveLength(1)
  })

  it('locked ve onchain kayit consumed OLMADAN reddedilir', async () => {
    const storage = sahteDepo()
    await saveQuote(kayit({ locked: true, lockReason: 'PRICE_PROTECTION' }), { storage, now: NOW })
    expect(await claimQuote(args(storage))).toEqual({ ok: false, code: 'QUOTE_LOCKED' })
    expect((await getQuote(ID, { storage })).consumed).toBe(false)

    const s2 = sahteDepo()
    await saveQuote(kayit({ approval: ONCHAIN }), { storage: s2, now: NOW })
    expect(await claimQuote(args(s2))).toEqual({ ok: false, code: 'APPROVAL_REQUIRED' })
    expect((await getQuote(ID, { storage: s2 })).consumed).toBe(false)
  })

  it('hesap degisimi / yok / sure dolmus tuketmez', async () => {
    const storage = sahteDepo()
    await saveQuote(kayit(), { storage, now: NOW })
    expect(await claimQuote(args(storage, { activeAddress: OTHER }))).toEqual({ ok: false, code: 'ACCOUNT_CHANGED' })
    expect(await claimQuote(args(storage, { now: NOW + 40_000 }))).toEqual({ ok: false, code: 'QUOTE_EXPIRED' })
    expect(await claimQuote(args(storage, { quoteId: 'c'.repeat(32) }))).toEqual({ ok: false, code: 'QUOTE_NOT_FOUND' })
    expect((await getQuote(ID, { storage })).consumed).toBe(false)
  })

  it('bozuk quoteId depoya gitmeden QUOTE_NOT_FOUND', async () => {
    const storage = sahteDepo()
    expect(await claimQuote(args(storage, { quoteId: { x: 1 } }))).toEqual({ ok: false, code: 'QUOTE_NOT_FOUND' })
  })
})

describe('peekQuoteForApprove', () => {
  const args = (storage, ek = {}) => ({ quoteId: ID, activeAddress: OWNER, now: NOW + 1000, storage, ...ek })

  it('tuketmez: iki ardisik ok', async () => {
    const storage = sahteDepo()
    await saveQuote(kayit({ approval: ONCHAIN }), { storage, now: NOW })
    expect((await peekQuoteForApprove(args(storage))).ok).toBe(true)
    expect((await peekQuoteForApprove(args(storage))).ok).toBe(true)
    expect((await getQuote(ID, { storage })).consumed).toBe(false)
  })

  it('mode none kayit INVALID_REQUEST; place suresi dolmus kayit hala gecerli', async () => {
    const storage = sahteDepo()
    await saveQuote(kayit(), { storage, now: NOW })
    expect(await peekQuoteForApprove(args(storage))).toEqual({ ok: false, code: 'INVALID_REQUEST' })
    const s2 = sahteDepo()
    await saveQuote(kayit({ approval: ONCHAIN }), { storage: s2, now: NOW })
    expect((await peekQuoteForApprove(args(s2, { now: NOW + 60_000 }))).ok).toBe(true)
    expect(await peekQuoteForApprove(args(s2, { now: NOW + APPROVE_WINDOW_MS }))).toEqual({ ok: false, code: 'QUOTE_EXPIRED' })
  })
})

describe('kaynak taramasi', () => {
  const kod = yorumsuz(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'quoteStore.js'), 'utf8'))
  it('bayraktan ve betikten bagimsiz, tek chrome.storage.session', () => {
    expect(kod).not.toContain('featureFlags')
    expect(kod).not.toContain('chrome.storage.local')
  })
})

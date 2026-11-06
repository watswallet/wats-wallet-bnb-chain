import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TypedDataEncoder, keccak256, toUtf8Bytes } from 'ethers'
import { createCowService } from './service'
import { XSTOCKS } from '../../data/xStocks'
import { APPROVE_WINDOW_MS, FEE_PREPARE_TIMEOUT_MS, ORDER_VALIDITY_SEC, PAY_TOKENS } from './config'
import { permitDomain } from './permit'
import { yorumsuz } from '../../test-utils/kaynakTarama'

const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const ATTACKER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const NOW = 1_800_000_000_000
const EXPIRATION = new Date(NOW + 60_000).toISOString()

const STOCK_ETH = XSTOCKS.find((s) => s.chains.includes(1))
const STOCK_BSC = XSTOCKS.find((s) => s.chains.includes(56))
const payOf = (chainId, symbol) => PAY_TOKENS[chainId].find((t) => t.symbol === symbol)

const ACIK = {
  openNow: true,
  currentPeriod: 'market',
  nextChangeAt: '2026-10-15T20:00:00.000Z',
  limitsPerPeriod: { market: { maxOrderFiatValue: '100000' } },
}
const KAPALI = { ...ACIK, openNow: false, currentPeriod: 'closed', limitsPerPeriod: { closed: { maxOrderFiatValue: '0' } } }

// CoW fixture: 100 USDC
const KOTA_100 = { sellAmount: '98592128', feeAmount: '1407872', buyAmount: '263447862041645538' }

function kotaYaniti({ sellToken, buyToken, receiver = OWNER, kind = 'sell', fixture = KOTA_100, ...ust }) {
  return {
    quote: { sellToken, buyToken, receiver, kind, ...fixture },
    id: 777,
    expiration: EXPIRATION,
    verified: false,
    protocolFeeBps: '2',
    ...ust,
  }
}

function kur(ek = {}) {
  const kayitlar = []
  const cagrilar = []
  const kaydet = (ad, sonuc) =>
    vi.fn(async (...a) => {
      cagrilar.push(ad)
      return typeof sonuc === 'function' ? sonuc(...a) : sonuc
    })

  const api = {
    quote: vi.fn(async (chainId, body) => {
      cagrilar.push('api.quote')
      if (ek.apiQuote) return ek.apiQuote(chainId, body)
      return { ok: true, data: kotaYaniti({ sellToken: body.sellToken, buyToken: body.buyToken, ...(ek.yanit ?? {}) }) }
    }),
  }
  const chain = {
    readDecimals: kaydet('chain.readDecimals', ek.readDecimals ?? 6),
    readBalance: kaydet('chain.readBalance', ek.balance ?? 10n ** 30n),
    readAllowance: kaydet('chain.readAllowance', ek.allowance ?? 0n),
    readPermitInfo: kaydet('chain.readPermitInfo', ek.permitInfo ?? { ok: false }),
  }
  const reference = {
    getReference: kaydet('reference.getReference', { reference: ek.reference === undefined ? 380 : ek.reference }),
    getTrading: kaydet('reference.getTrading', ek.trading === undefined ? { ok: true, trading: ACIK } : ek.trading),
  }
  const quoteStore = {
    newQuoteId: () => 'ab'.repeat(16),
    saveQuote: kaydet('quoteStore.saveQuote', async (r) => {
      kayitlar.push(r)
    }),
    claimQuote: vi.fn(),
  }
  const orders = { loadOrders: kaydet('orders.loadOrders', ek.orders ?? []), saveOrder: vi.fn(), patchOrder: vi.fn(), removeOrder: vi.fn() }
  const pendingRows = { save: vi.fn(), resolve: vi.fn(), remove: vi.fn() }
  const servis = createCowService({
    api,
    chain,
    reference,
    quoteStore,
    orders,
    pendingRows,
    now: () => NOW,
    recipient: 'recipient' in ek ? ek.recipient : RECIPIENT,
    fee: ek.fee,
    feeEnabled: ek.feeEnabled,
  })
  return { servis, api, chain, reference, quoteStore, orders, kayitlar, cagrilar }
}

const alIstek = (ek = {}) => ({
  side: 'buy',
  chainId: 1,
  stockAddress: STOCK_ETH.address,
  payToken: payOf(1, 'USDC').address,
  amount: '100',
  ...ek,
})
const satIstek = (ek = {}) => ({
  side: 'sell',
  chainId: 1,
  stockAddress: STOCK_ETH.address,
  payToken: payOf(1, 'USDC').address,
  amount: '1',
  ...ek,
})

const USDC_PERMIT = (chainId = 1, token = payOf(1, 'USDC').address, name = 'USD Coin', version = '2') => ({
  ok: true,
  name,
  version,
  nonce: 0n,
  separator: TypedDataEncoder.hashDomain(permitDomain({ chainId, token, name, version })),
})

describe('quote Al mutlu yol', () => {
  it('istek govdesi anahtar sirasi ve degerleri birebir; kayit ve sonuc', async () => {
    const t = kur({ permitInfo: USDC_PERMIT() })
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r.success).toBe(true)
    const body = t.api.quote.mock.calls[0][1]
    expect(t.api.quote.mock.calls[0][0]).toBe(1)
    expect(Object.keys(body)).toEqual([
      'sellToken', 'buyToken', 'from', 'receiver', 'kind', 'sellAmountBeforeFee', 'validFor',
      'appData', 'appDataHash', 'signingScheme', 'onchainOrder',
    ])
    expect(body.sellToken).toBe(payOf(1, 'USDC').address)
    expect(body.buyToken).toBe(STOCK_ETH.address)
    expect(body.from).toBe(OWNER)
    expect(body.receiver).toBe(OWNER)
    expect(body.kind).toBe('sell')
    expect(body.sellAmountBeforeFee).toBe('100000000')
    expect(body.validFor).toBe(ORDER_VALIDITY_SEC)
    expect(body.signingScheme).toBe('eip712')
    expect(body.onchainOrder).toBe(false)
    expect(body.appDataHash).toBe(keccak256(toUtf8Bytes(body.appData)))

    expect(r.approval.mode).toBe('permit')
    expect(r.approval.allowance).toBe('0')
    expect(r.locked).toBe(false)
    expect(r.quoteId).toBe('ab'.repeat(16))
    expect(r.expiresAt).toBe(NOW + 60_000)
    expect(r.approveUntil).toBe(NOW + APPROVE_WINDOW_MS)
    expect(r.reference).toBe(380)
    expect(r.notice.state).toBe('open')
    expect(r.warnings).toEqual([])

    const k = t.kayitlar[0]
    expect(k.sellAmount).toBe('100000000')
    expect(k.owner).toBe(OWNER)
    expect(k.sellToken).toBe(payOf(1, 'USDC').address)
    expect(k.buyToken).toBe(STOCK_ETH.address)
    expect(BigInt(k.minBuy)).toBeLessThan(BigInt(k.expectedBuy))
    expect(k.appData.hash).toBe(keccak256(toUtf8Bytes(k.appData.json)))
    expect(k.approveUntil).toBe(NOW + APPROVE_WINDOW_MS)
    expect(k.expiresAt).toBe(NOW + 60_000)
    expect(k.cowQuoteId).toBe(777)
    expect(k.verified).toBe(false)
    expect(k.consumed).toBe(false)
    expect(k.sellDecimals).toBe(6)
    expect(k.buyDecimals).toBe(18)
    expect(() => JSON.stringify(r)).not.toThrow()
    expect(structuredClone(r)).toEqual(r)
  })
})

describe('quote Review Focus 1: teklif oncesi kapilar', () => {
  it('Al + kapali piyasa -> MARKET_CLOSED + nextChangeAt; CoW ve zincir okumasi 0', async () => {
    const t = kur({ trading: { ok: true, trading: KAPALI } })
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r).toMatchObject({ success: true, locked: true, lockReason: 'MARKET_CLOSED', quoteId: null, display: null, approval: null })
    expect(r.nextChangeAt).toBe(KAPALI.nextChangeAt)
    expect(t.api.quote).toHaveBeenCalledTimes(0)
    expect(t.chain.readBalance).toHaveBeenCalledTimes(0)
    expect(t.chain.readDecimals).toHaveBeenCalledTimes(0)
    expect(t.kayitlar).toHaveLength(0)
  })

  it('trading yok (ok:false) -> MARKET_UNKNOWN', async () => {
    const t = kur({ trading: { ok: false, trading: null } })
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r).toMatchObject({ success: true, locked: true, lockReason: 'MARKET_UNKNOWN', nextChangeAt: null })
    expect(t.api.quote).toHaveBeenCalledTimes(0)
  })

  it('reference null -> Al VE Sat REFERENCE_MISSING', async () => {
    for (const request of [alIstek(), satIstek()]) {
      const t = kur({ reference: null })
      const r = await t.servis.quote({ request, owner: OWNER })
      expect(r).toMatchObject({ success: true, locked: true, lockReason: 'REFERENCE_MISSING', quoteId: null })
      expect(t.api.quote).toHaveBeenCalledTimes(0)
      expect(t.chain.readBalance).toHaveBeenCalledTimes(0)
    }
  })

  it('Sat + kapali piyasa -> CoW a gider, uyari MARKET_CLOSED', async () => {
    const sat = kur({
      trading: { ok: true, trading: KAPALI },
      readDecimals: 6,
      apiQuote: (_c, body) => ({
        ok: true,
        data: kotaYaniti({
          sellToken: body.sellToken,
          buyToken: body.buyToken,
          fixture: { sellAmount: '996000000000000000', feeAmount: '4000000000000000', buyAmount: '380500000' },
        }),
      }),
    })
    const r = await sat.servis.quote({ request: satIstek(), owner: OWNER })
    expect(r.success).toBe(true)
    expect(sat.api.quote).toHaveBeenCalledTimes(1)
    expect(r.warnings[0].code).toBe('MARKET_CLOSED')
    expect(r.warnings[0].nextChangeAt).toBe(KAPALI.nextChangeAt)
    expect(r.locked).toBe(false)
  })

  it('Sat + bilinmeyen piyasa -> gider, uyari MARKET_UNKNOWN', async () => {
    const sat = kur({
      trading: { ok: false, trading: null },
      apiQuote: (_c, body) => ({
        ok: true,
        data: kotaYaniti({
          sellToken: body.sellToken,
          buyToken: body.buyToken,
          fixture: { sellAmount: '996000000000000000', feeAmount: '4000000000000000', buyAmount: '380500000' },
        }),
      }),
    })
    const r = await sat.servis.quote({ request: satIstek(), owner: OWNER })
    expect(r.success).toBe(true)
    expect(sat.api.quote).toHaveBeenCalledTimes(1)
    expect(r.warnings).toEqual([{ code: 'MARKET_UNKNOWN', nextChangeAt: null }])
  })

  it('trading nesnesi (onbellek referansi) degistirilmez', async () => {
    const trading = Object.freeze({ ...KAPALI, limitsPerPeriod: Object.freeze({ ...KAPALI.limitsPerPeriod }) })
    const t = kur({ trading: { ok: true, trading } })
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r.lockReason).toBe('MARKET_CLOSED')
    expect(trading).toEqual(KAPALI)
  })
})

describe('quote yuzde 2 kilidi (tam sinir)', () => {
  // qb 1e18, qf 0, pf 0 -> partner 0.1%, expectedBuy 0.999e18; referans 100 USD (1e8 mikro)
  const alKota = (qs) => ({ sellAmount: qs, feeAmount: '0', buyAmount: '1000000000000000000' })
  const fixtureYanit = (fixture) => (_c, body) => ({
    ok: true,
    data: kotaYaniti({ sellToken: body.sellToken, buyToken: body.buyToken, fixture, protocolFeeBps: '0' }),
  })

  it('Al: birim fiyat tam 2 yuzde ustunde -> kilit yok; 1 atom ustunde kilitli + kayit locked', async () => {
    const tam = kur({ reference: 100, apiQuote: fixtureYanit(alKota('101898000')) })
    const a = await tam.servis.quote({ request: alIstek({ amount: '101.898' }), owner: OWNER })
    expect(a.success).toBe(true)
    expect(a.locked).toBe(false)
    expect(a.lockReason).toBeNull()
    expect(tam.kayitlar[0].locked).toBe(false)

    const fazla = kur({ reference: 100, apiQuote: fixtureYanit(alKota('101898001')) })
    const b = await fazla.servis.quote({ request: alIstek({ amount: '101.898001' }), owner: OWNER })
    expect(b.success).toBe(true)
    expect(b.locked).toBe(true)
    expect(b.lockReason).toBe('PRICE_PROTECTION')
    expect(b.quoteId).toBe('ab'.repeat(16))
    expect(b.display.locked).toBe(true)
    expect(fazla.kayitlar).toHaveLength(1)
    expect(fazla.kayitlar[0].locked).toBe(true)
    expect(fazla.kayitlar[0].lockReason).toBe('PRICE_PROTECTION')
  })

  it('Sat: ters yon; tam sinir gecer, 1 atom azi kilitli', async () => {
    // 1 hisse satilir; expectedBuy 98_000_000 tam %2 alti
    const sat = (qb) => ({ sellAmount: '1000000000000000000', feeAmount: '0', buyAmount: qb })
    const tam = kur({ reference: 100, apiQuote: fixtureYanit(sat('98098098')) })
    const a = await tam.servis.quote({ request: satIstek(), owner: OWNER })
    expect(a.locked).toBe(false)
    const az = kur({ reference: 100, apiQuote: fixtureYanit(sat('98098097')) })
    const b = await az.servis.quote({ request: satIstek(), owner: OWNER })
    expect(b.locked).toBe(true)
    expect(b.lockReason).toBe('PRICE_PROTECTION')
    expect(az.kayitlar[0].locked).toBe(true)
  })
})

describe('quote ag ucreti fiyat korumasindan ayri (2026-10-21)', () => {
  // referans 100; protokol ucreti 0; partner %0,1 expectedBuy icinde kalir
  const yanit = (fixture) => (_c, body) => ({
    ok: true,
    data: kotaYaniti({ sellToken: body.sellToken, buyToken: body.buyToken, fixture, protocolFeeBps: '0' }),
  })

  it('Al 10 USDC: ucret %6, spot sapma kucuk -> KILITSIZ; ucret alanlari ve kayit', async () => {
    const fx = { sellAmount: '9400000', feeAmount: '600000', buyAmount: '93600000000000000' }
    const t = kur({ reference: 100, apiQuote: yanit(fx) })
    const r = await t.servis.quote({ request: alIstek({ amount: '10' }), owner: OWNER })
    expect(r.success).toBe(true)
    expect(r.locked).toBe(false)
    expect(r.lockReason).toBeNull()
    expect(r.display.networkFeeUsd).toBe(0.6)
    expect(r.display.networkFeePct).toBeCloseTo(6, 6)
    expect(r.display.feeWarning).toBe(false)
    expect(Math.abs(r.display.gapPct)).toBeLessThan(2)
    expect(t.kayitlar[0].networkFee).toBe('600000')
    expect(t.kayitlar[0].locked).toBe(false)
  })

  it('Al 10 USDC: ucret %12 -> KILITSIZ, feeWarning, kayit kilitsiz', async () => {
    const fx = { sellAmount: '8800000', feeAmount: '1200000', buyAmount: '87700000000000000' }
    const t = kur({ reference: 100, apiQuote: yanit(fx) })
    const r = await t.servis.quote({ request: alIstek({ amount: '10' }), owner: OWNER })
    expect(r).toMatchObject({ success: true, locked: false, lockReason: null })
    expect(r.display.feeWarning).toBe(true)
    expect(t.kayitlar[0]).toMatchObject({ locked: false, lockReason: null, networkFee: '1200000' })
  })

  it('Al: spot 5 kat -> PRICE_PROTECTION (ucret %6 olsa da)', async () => {
    const fx = { sellAmount: '9400000', feeAmount: '600000', buyAmount: '18800000000000000' }
    const t = kur({ reference: 100, apiQuote: yanit(fx) })
    const r = await t.servis.quote({ request: alIstek({ amount: '10' }), owner: OWNER })
    expect(r).toMatchObject({ locked: true, lockReason: 'PRICE_PROTECTION' })
  })

  it('Sat 0,1 hisse: ucret %6 hisse tokeninde -> KILITSIZ; %12 -> kilitsiz + uyari', async () => {
    const ok = kur({
      reference: 100,
      apiQuote: yanit({ sellAmount: '94000000000000000', feeAmount: '6000000000000000', buyAmount: '9353000' }),
    })
    const a = await ok.servis.quote({ request: satIstek({ amount: '0.1' }), owner: OWNER })
    expect(a.locked).toBe(false)
    expect(a.display.networkFeeUsd).toBeCloseTo(0.6, 9)
    expect(ok.kayitlar[0].networkFee).toBe('6000000000000000')

    const yuksek = kur({
      reference: 100,
      apiQuote: yanit({ sellAmount: '88000000000000000', feeAmount: '12000000000000000', buyAmount: '8756000' }),
    })
    const b = await yuksek.servis.quote({ request: satIstek({ amount: '0.1' }), owner: OWNER })
    expect(b).toMatchObject({ success: true, locked: false, lockReason: null })
    expect(b.display.feeWarning).toBe(true)
  })
})

describe('quote yanit dogrulamasi', () => {
  const dene = async (yanitDegis) => {
    const t = kur({
      apiQuote: (_c, body) => {
        const d = kotaYaniti({ sellToken: body.sellToken, buyToken: body.buyToken })
        return { ok: true, data: yanitDegis(d) }
      },
    })
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    return { r, t }
  }

  it('qs+qf farkli -> QUOTE_MISMATCH', async () => {
    const { r, t } = await dene((d) => ({ ...d, quote: { ...d.quote, feeAmount: '1407873' } }))
    expect(r).toMatchObject({ success: false, code: 'QUOTE_MISMATCH' })
    expect(t.kayitlar).toHaveLength(0)
  })
  it('baska buyToken / sellToken / receiver / kind -> BAD_QUOTE_RESPONSE', async () => {
    expect((await dene((d) => ({ ...d, quote: { ...d.quote, buyToken: ATTACKER } }))).r.code).toBe('BAD_QUOTE_RESPONSE')
    expect((await dene((d) => ({ ...d, quote: { ...d.quote, sellToken: ATTACKER } }))).r.code).toBe('BAD_QUOTE_RESPONSE')
    expect((await dene((d) => ({ ...d, quote: { ...d.quote, receiver: ATTACKER } }))).r.code).toBe('BAD_QUOTE_RESPONSE')
    expect((await dene((d) => ({ ...d, quote: { ...d.quote, kind: 'buy' } }))).r.code).toBe('BAD_QUOTE_RESPONSE')
  })
  it('tutar rakam dizesi degil / protocolFeeBps yok ya da bozuk / id tamsayi degil -> BAD_QUOTE_RESPONSE', async () => {
    expect((await dene((d) => ({ ...d, quote: { ...d.quote, buyAmount: '1e18' } }))).r.code).toBe('BAD_QUOTE_RESPONSE')
    expect((await dene((d) => ({ ...d, quote: { ...d.quote, sellAmount: 98592128 } }))).r.code).toBe('BAD_QUOTE_RESPONSE')
    expect((await dene((d) => ({ ...d, protocolFeeBps: undefined }))).r.code).toBe('BAD_QUOTE_RESPONSE')
    expect((await dene((d) => ({ ...d, protocolFeeBps: 'x' }))).r.code).toBe('BAD_QUOTE_RESPONSE')
    expect((await dene((d) => ({ ...d, id: 'abc' }))).r.code).toBe('BAD_QUOTE_RESPONSE')
  })
  it('buyAmount 0 -> NO_LIQUIDITY', async () => {
    const { r } = await dene((d) => ({ ...d, quote: { ...d.quote, buyAmount: '0' } }))
    expect(r).toMatchObject({ success: false, code: 'NO_LIQUIDITY' })
  })
  it('expiration gecmiste -> CLOCK_SKEW; bozuk -> BAD_QUOTE_RESPONSE', async () => {
    expect((await dene((d) => ({ ...d, expiration: new Date(NOW - 1000).toISOString() }))).r.code).toBe('CLOCK_SKEW')
    expect((await dene((d) => ({ ...d, expiration: new Date(NOW).toISOString() }))).r.code).toBe('CLOCK_SKEW')
    expect((await dene((d) => ({ ...d, expiration: 'yarin' }))).r.code).toBe('BAD_QUOTE_RESPONSE')
  })
})

describe('quote ondalik (Review Focus 3)', () => {
  it('BSC USDT readDecimals 18 -> 100 = 10^20; Ethereum 6 -> 10^8', async () => {
    const bsc = kur({ readDecimals: 18, apiQuote: () => ({ ok: false, code: 'NO_LIQUIDITY' }) })
    await bsc.servis.quote({
      request: alIstek({ chainId: 56, stockAddress: STOCK_BSC.address, payToken: payOf(56, 'USDT').address }),
      owner: OWNER,
    })
    expect(bsc.api.quote.mock.calls[0][1].sellAmountBeforeFee).toBe('100000000000000000000')
    expect(bsc.chain.readDecimals).toHaveBeenCalledWith(56, payOf(56, 'USDT').address)

    const eth = kur({ readDecimals: 6, apiQuote: () => ({ ok: false, code: 'NO_LIQUIDITY' }) })
    await eth.servis.quote({ request: alIstek(), owner: OWNER })
    expect(eth.api.quote.mock.calls[0][1].sellAmountBeforeFee).toBe('100000000')
  })

  it('ondalik fazlasi ya da sifir -> INVALID_REQUEST, CoW a gidilmez', async () => {
    const t = kur()
    const r = await t.servis.quote({ request: alIstek({ amount: '1.0000001' }), owner: OWNER })
    expect(r).toMatchObject({ success: false, code: 'INVALID_REQUEST' })
    const sifir = await t.servis.quote({ request: alIstek({ amount: '0.0000000' }), owner: OWNER })
    expect(sifir.code).toBe('INVALID_REQUEST')
    expect(t.api.quote).toHaveBeenCalledTimes(0)
  })

  it('Sat tutari hisse ondaligiyla (18) parse edilir', async () => {
    const t = kur({ apiQuote: () => ({ ok: false, code: 'NO_LIQUIDITY' }) })
    await t.servis.quote({ request: satIstek({ amount: '1.5' }), owner: OWNER })
    const body = t.api.quote.mock.calls[0][1]
    expect(body.sellAmountBeforeFee).toBe('1500000000000000000')
    expect(body.sellToken).toBe(STOCK_ETH.address)
    expect(body.buyToken).toBe(payOf(1, 'USDC').address)
  })
})

describe('quote: "tutar ucreti karsilamiyor" -> ag ucreti, en az tutar, eksik miktar', () => {
  const KUCUK = (ek = {}) => ({ ok: false, code: 'AMOUNT_TOO_SMALL', status: 400, ...ek })
  const SAYISAL = /^\d+(\.\d+)?$/
  const yedekOk = (body, fixture) => ({ ok: true, data: kotaYaniti({ sellToken: body.sellToken, buyToken: body.buyToken, fixture }) })
  const FIX_YEDEK = { sellAmount: '48592128', feeAmount: '1407872', buyAmount: '1' }

  it('Al: govdedeki ucret kullanilir, yedek teklif ISTENMEZ (tek api.quote)', async () => {
    const t = kur({ apiQuote: () => KUCUK({ feeAtoms: '1407872' }) })
    const r = await t.servis.quote({ request: alIstek({ amount: '0.5' }), owner: OWNER })
    expect(r).toEqual({
      success: false,
      code: 'AMOUNT_TOO_SMALL',
      feeAtoms: '1407872',
      feeDisplay: '1.41',
      feeUsd: '1.41',
      minAmountDisplay: '1.69',
      missingDisplay: '1.19',
    })
    expect(t.api.quote).toHaveBeenCalledTimes(1)
    expect(t.kayitlar).toHaveLength(0)
  })

  it('Sat: hisse birimi, USD referansla (380): 0.001 girildi, ucret 0.005', async () => {
    const t = kur({ apiQuote: () => KUCUK({ feeAtoms: String(5n * 10n ** 15n) }) })
    const r = await t.servis.quote({ request: satIstek({ amount: '0.001' }), owner: OWNER })
    expect(r).toEqual({
      success: false,
      code: 'AMOUNT_TOO_SMALL',
      feeAtoms: '5000000000000000',
      feeDisplay: '0.005',
      feeUsd: '1.90',
      minAmountDisplay: '0.006',
      missingDisplay: '0.005',
    })
    expect(t.api.quote).toHaveBeenCalledTimes(1)
  })

  it('BSC 18 ondalikli odeme tokeni (Al): ucret 0.03, girilen 0.01', async () => {
    const t = kur({ readDecimals: 18, apiQuote: () => KUCUK({ feeAtoms: String(3n * 10n ** 16n) }) })
    const r = await t.servis.quote({
      request: alIstek({ chainId: 56, stockAddress: STOCK_BSC.address, payToken: payOf(56, 'USDT').address, amount: '0.01' }),
      owner: OWNER,
    })
    expect(r).toMatchObject({ code: 'AMOUNT_TOO_SMALL', feeDisplay: '0.03', minAmountDisplay: '0.04', missingDisplay: '0.03' })
  })

  it('sonuc mesaj-guvenli: yalniz rakam dizeleri, ham govde / detail yok', async () => {
    const t = kur({ apiQuote: () => KUCUK({ feeAtoms: '1407872', ham: 'SIR' }) })
    const r = await t.servis.quote({ request: alIstek({ amount: '0.5' }), owner: OWNER })
    expect(() => JSON.stringify(r)).not.toThrow()
    expect(JSON.stringify(r)).not.toContain('SIR')
    for (const [k, v] of Object.entries(r)) {
      if (k === 'success' || k === 'code') continue
      expect(typeof v === 'string' && SAYISAL.test(v)).toBe(true)
    }
  })

  it('servis da ucreti yeniden dogrular: gecersiz feeAtoms yok sayilir, yedek teklife gecilir', async () => {
    let n = 0
    const t = kur({
      apiQuote: (chainId, body) => {
        n += 1
        return n === 1 ? KUCUK({ feeAtoms: '-5' }) : yedekOk(body, FIX_YEDEK)
      },
    })
    const r = await t.servis.quote({ request: alIstek({ amount: '0.5' }), owner: OWNER })
    expect(t.api.quote).toHaveBeenCalledTimes(2)
    expect(r.feeAtoms).toBe('1407872')
  })

  it('YEDEK: govdede ucret yoksa tek yedek teklif, ~50 USD (Al: 50 stable), ayni cift ve taraf', async () => {
    let n = 0
    const t = kur({ apiQuote: (chainId, body) => { n += 1; return n === 1 ? KUCUK() : yedekOk(body, FIX_YEDEK) } })
    const r = await t.servis.quote({ request: alIstek({ amount: '0.5' }), owner: OWNER })
    expect(t.api.quote).toHaveBeenCalledTimes(2)
    const [ilk, yedek] = t.api.quote.mock.calls.map((c) => c[1])
    expect(ilk.sellAmountBeforeFee).toBe('500000')
    expect(yedek.sellAmountBeforeFee).toBe('50000000')
    expect({ ...yedek, sellAmountBeforeFee: null }).toEqual({ ...ilk, sellAmountBeforeFee: null })
    expect(t.api.quote.mock.calls[1][0]).toBe(1)
    expect(r).toEqual({
      success: false, code: 'AMOUNT_TOO_SMALL', feeAtoms: '1407872', feeDisplay: '1.41', feeUsd: '1.41', minAmountDisplay: '1.69', missingDisplay: '1.19',
    })
    expect(t.kayitlar).toHaveLength(0) // yedek teklif KAYDEDILMEZ
  })

  it('YEDEK Sat: ~50 USD hisse = 50 / referans (380), asagi yuvarlama', async () => {
    let n = 0
    const fix = { sellAmount: '131578947368421052630', feeAmount: String(5n * 10n ** 15n), buyAmount: '1' }
    const t = kur({ apiQuote: (chainId, body) => { n += 1; return n === 1 ? KUCUK() : yedekOk(body, fix) } })
    const r = await t.servis.quote({ request: satIstek({ amount: '0.001' }), owner: OWNER })
    const yedek = t.api.quote.mock.calls[1][1]
    expect(yedek.sellAmountBeforeFee).toBe(((50n * 10n ** 6n * 10n ** 18n) / 380_000_000n).toString())
    expect(yedek.sellToken).toBe(STOCK_ETH.address)
    expect(r).toMatchObject({ feeDisplay: '0.005', feeUsd: '1.90', minAmountDisplay: '0.006', missingDisplay: '0.005' })
  })

  it('YEDEK de basarisiz -> genel hata (sayisal alan YOK), toplam TAM 2 istek', async () => {
    const t = kur({ apiQuote: () => KUCUK() })
    const r = await t.servis.quote({ request: alIstek({ amount: '0.5' }), owner: OWNER })
    expect(r).toEqual({ success: false, code: 'AMOUNT_TOO_SMALL' })
    expect(t.api.quote).toHaveBeenCalledTimes(2)
  })

  it('YEDEK yaniti bozuksa (yanlis token / ucret yok / ucret >= tutar / hata) yok sayilir', async () => {
    const kotu = [
      (b) => ({ ok: true, data: kotaYaniti({ sellToken: ATTACKER, buyToken: b.buyToken }) }),
      (b) => yedekOk(b, { sellAmount: '1', feeAmount: 'x', buyAmount: '1' }),
      (b) => yedekOk(b, { sellAmount: '0', feeAmount: '0', buyAmount: '1' }),
      (b) => yedekOk(b, { sellAmount: '1', feeAmount: '50000000', buyAmount: '1' }),
      () => ({ ok: true, data: { quote: null } }),
      () => ({ ok: false, code: 'NO_LIQUIDITY' }),
    ]
    for (const yedek of kotu) {
      let n = 0
      const t = kur({ apiQuote: (c, body) => { n += 1; return n === 1 ? KUCUK() : yedek(body) } })
      const r = await t.servis.quote({ request: alIstek({ amount: '0.5' }), owner: OWNER })
      expect(r).toEqual({ success: false, code: 'AMOUNT_TOO_SMALL' })
      expect(t.api.quote).toHaveBeenCalledTimes(2)
    }
  })

  it('tutar zaten ~50 USD ustundeyse yedek teklif istenmez', async () => {
    const t = kur({ apiQuote: () => KUCUK() })
    const r = await t.servis.quote({ request: alIstek({ amount: '60' }), owner: OWNER })
    expect(r).toEqual({ success: false, code: 'AMOUNT_TOO_SMALL' })
    expect(t.api.quote).toHaveBeenCalledTimes(1)
  })

  it('referans yokken teklif oncesi kilit: CoW a hic gidilmez, yedek de yok', async () => {
    const t = kur({ reference: null, apiQuote: () => KUCUK() })
    const r = await t.servis.quote({ request: satIstek({ amount: '0.001' }), owner: OWNER })
    expect(r.locked).toBe(true)
    expect(t.api.quote).toHaveBeenCalledTimes(0)
  })

  it('baska hata kodlarinda yedek teklif ve sayisal alan YOK', async () => {
    for (const code of ['NO_LIQUIDITY', 'RATE_LIMITED', 'NETWORK', 'REJECTED']) {
      const t = kur({ apiQuote: () => ({ ok: false, code, feeAtoms: '1407872' }) })
      const r = await t.servis.quote({ request: alIstek({ amount: '0.5' }), owner: OWNER })
      expect(r).toEqual({ success: false, code })
      expect(t.api.quote).toHaveBeenCalledTimes(1)
    }
  })

  it('ucret tahmini girilenin altindaysa (eksik yok) genel hata, alan yok', async () => {
    const t = kur({ apiQuote: () => KUCUK({ feeAtoms: '100000' }) })
    const r = await t.servis.quote({ request: alIstek({ amount: '0.5' }), owner: OWNER })
    expect(r).toEqual({ success: false, code: 'AMOUNT_TOO_SMALL' })
  })
})

describe('quote bakiye ve rezerv', () => {
  const bekleyen = (ek = {}) => ({
    status: 'open',
    owner: OWNER,
    chainId: 1,
    sellToken: payOf(1, 'USDC').address,
    sellAmount: '60000000',
    ...ek,
  })

  it('bakiye 100, bekleyen 60, istek 50 -> INSUFFICIENT_BALANCE ve CoW yok', async () => {
    const t = kur({ balance: 100_000_000n, orders: [bekleyen()] })
    const r = await t.servis.quote({ request: alIstek({ amount: '50' }), owner: OWNER })
    expect(r).toMatchObject({ success: false, code: 'INSUFFICIENT_BALANCE' })
    expect(t.api.quote).toHaveBeenCalledTimes(0)
  })

  it('INSUFFICIENT_BALANCE gereken ve kullanilabilir atomu ve ondaligi tasir (kullanilabilir = bakiye - rezerv)', async () => {
    const t = kur({ balance: 100_000_000n, orders: [bekleyen()] })
    const r = await t.servis.quote({ request: alIstek({ amount: '50' }), owner: OWNER })
    expect(r).toEqual({ success: false, code: 'INSUFFICIENT_BALANCE', requiredAtoms: '50000000', availableAtoms: '40000000', decimals: 6 })
  })

  it('rezerv bakiyeyi astiysa kullanilabilir 0 (negatif atom yok)', async () => {
    const t = kur({ balance: 10_000_000n, orders: [bekleyen()] })
    const r = await t.servis.quote({ request: alIstek({ amount: '5' }), owner: OWNER })
    expect(r).toMatchObject({ code: 'INSUFFICIENT_BALANCE', requiredAtoms: '5000000', availableAtoms: '0', decimals: 6 })
  })

  it('baska zincirdeki bekleyen kayit dusulmez', async () => {
    const t = kur({
      balance: 100_000_000n,
      orders: [bekleyen({ chainId: 56 })],
      apiQuote: () => ({ ok: false, code: 'NO_LIQUIDITY' }),
    })
    await t.servis.quote({ request: alIstek({ amount: '50' }), owner: OWNER })
    expect(t.api.quote).toHaveBeenCalledTimes(1)
  })

  it('bakiye tam yetiyorsa gecer (S == kullanilabilir)', async () => {
    const t = kur({ balance: 50_000_000n, apiQuote: () => ({ ok: false, code: 'NO_LIQUIDITY' }) })
    await t.servis.quote({ request: alIstek({ amount: '50' }), owner: OWNER })
    expect(t.api.quote).toHaveBeenCalledTimes(1)
  })
})

describe('quote onay modu (K8)', () => {
  const modu = async (ek, request) => {
    const t = kur(ek)
    const r = await t.servis.quote({ request, owner: OWNER })
    expect(r.success).toBe(true)
    return { mode: r.approval.mode, t }
  }

  it('allowance >= S -> none', async () => {
    expect((await modu({ allowance: 100_000_000n }, alIstek())).mode).toBe('none')
    expect((await modu({ allowance: 10n ** 30n }, alIstek())).mode).toBe('none')
  })
  it('Al + USDC 1 ve 42161 -> permit', async () => {
    expect((await modu({ permitInfo: USDC_PERMIT() }, alIstek())).mode).toBe('permit')
    const arb = payOf(42161, 'USDC').address
    const arbStock = XSTOCKS.find((s) => s.chains.includes(42161))
    const m = await modu(
      { permitInfo: USDC_PERMIT(42161, arb), readDecimals: 6 },
      alIstek({ chainId: 42161, stockAddress: arbStock.address, payToken: arb }),
    )
    expect(m.mode).toBe('permit')
    expect(m.t.chain.readPermitInfo).toHaveBeenCalledWith(42161, arb, OWNER)
  })
  it('permit bilgisi ok:false ya da ayirici uyusmazsa -> onchain (hata degil)', async () => {
    expect((await modu({ permitInfo: { ok: false } }, alIstek())).mode).toBe('onchain')
    const bozuk = { ...USDC_PERMIT(), separator: '0x' + '11'.repeat(32) }
    expect((await modu({ permitInfo: bozuk }, alIstek())).mode).toBe('onchain')
    // yanlis zincir/token icin uretilmis ayirici
    const yanlisZincir = USDC_PERMIT(56)
    expect((await modu({ permitInfo: yanlisZincir }, alIstek())).mode).toBe('onchain')
  })
  it('permit bilgisi version bos ise -> onchain', async () => {
    const info = { ...USDC_PERMIT(), version: '' }
    expect((await modu({ permitInfo: info }, alIstek())).mode).toBe('onchain')
  })
  it('USDT / Sat / BSC -> onchain; permit bilgisi hic okunmaz', async () => {
    const usdt = await modu({ permitInfo: USDC_PERMIT() }, alIstek({ payToken: payOf(1, 'USDT').address }))
    expect(usdt.mode).toBe('onchain')
    expect(usdt.t.chain.readPermitInfo).toHaveBeenCalledTimes(0)

    const satT = kur({
      permitInfo: USDC_PERMIT(),
      apiQuote: (_c, body) => ({
        ok: true,
        data: kotaYaniti({
          sellToken: body.sellToken,
          buyToken: body.buyToken,
          fixture: { sellAmount: '996000000000000000', feeAmount: '4000000000000000', buyAmount: '380500000' },
        }),
      }),
    })
    const satR = await satT.servis.quote({ request: satIstek(), owner: OWNER })
    expect(satR.approval.mode).toBe('onchain')
    expect(satT.chain.readPermitInfo).toHaveBeenCalledTimes(0)

    const bsc = kur({
      readDecimals: 18,
      permitInfo: USDC_PERMIT(56, payOf(56, 'USDC').address),
      apiQuote: (_c, body) => ({
        ok: true,
        data: kotaYaniti({
          sellToken: body.sellToken,
          buyToken: body.buyToken,
          fixture: { sellAmount: '98592128000000000000', feeAmount: '1407872000000000000', buyAmount: '263447862041645538' },
        }),
      }),
    })
    const bscR = await bsc.servis.quote({
      request: alIstek({ chainId: 56, stockAddress: STOCK_BSC.address, payToken: payOf(56, 'USDC').address }),
      owner: OWNER,
    })
    expect(bscR.approval.mode).toBe('onchain')
    expect(bsc.chain.readPermitInfo).toHaveBeenCalledTimes(0)
  })
})

describe('quote recipient ve hata esleme', () => {
  it('recipient null -> PARTNER_FEE_RECIPIENT_MISSING, hicbir bagimlilik cagrilmaz', async () => {
    const t = kur({ recipient: null })
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r).toMatchObject({ success: false, code: 'PARTNER_FEE_RECIPIENT_MISSING' })
    expect(t.cagrilar).toEqual([])
  })

  it('gecersiz istek -> dogrulama kodu, bagimlilik yok', async () => {
    const t = kur()
    const r = await t.servis.quote({ request: alIstek({ chainId: '1' }), owner: OWNER })
    expect(r).toMatchObject({ success: false, code: 'UNSUPPORTED_CHAIN' })
    expect(t.cagrilar).toEqual([])
  })

  it('api {ok:false, code} -> ayni kod', async () => {
    const t = kur({ apiQuote: () => ({ ok: false, code: 'NO_LIQUIDITY' }) })
    expect(await t.servis.quote({ request: alIstek(), owner: OWNER })).toMatchObject({ success: false, code: 'NO_LIQUIDITY' })
  })

  it('chain.readAllowance NETWORK firlatir -> NETWORK', async () => {
    const t = kur({
      allowance: () => {
        throw Object.assign(new Error('NETWORK'), { code: 'NETWORK' })
      },
    })
    expect(await t.servis.quote({ request: alIstek(), owner: OWNER })).toMatchObject({ success: false, code: 'NETWORK' })
  })

  it('duz Error -> UNKNOWN ve ic mesaj sizmaz', async () => {
    const t = kur({
      balance: () => {
        throw new Error('rpc https://gizli.example/anahtar=SIR')
      },
    })
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r).toEqual({ success: false, code: 'UNKNOWN' })
    expect(JSON.stringify(r)).not.toContain('SIR')
  })

  it('quote hicbir yolda firlatmaz (null girdi)', async () => {
    const t = kur()
    await expect(t.servis.quote(undefined)).resolves.toMatchObject({ success: false })
    await expect(t.servis.quote({ request: null, owner: OWNER })).resolves.toMatchObject({ success: false })
  })
})

// ---------------------------------------------------------------- Faz 3: feePreview ve borc kilidi
const ATS_1 = '1000000000000000000'
const HAZIR = { ready: true, mode: 'normal' }
const hazirlik = (ek = {}) => ({ isEvm: true, status: HAZIR, balanceRaw: '10000000000000000000', quotedFeeRaw: ATS_1, decimals: 18, ...ek })
const feeKur = (hazir = hazirlik()) => ({
  prepare: vi.fn(async () => (typeof hazir === 'function' ? hazir() : hazir)),
})
const borcluKayit = (ek = {}) => ({
  uid: '0x' + 'ab'.repeat(56),
  owner: OWNER,
  chainId: 1,
  fee: { mode: 'ats', state: 'owed', blocker: null, noServiceSince: null },
  ...ek,
})
const YOK_ONIZLEME = { mode: 'none', quotedAtsRaw: null, decimals: null, hint: false, lowNetworkFee: false }
const ACIK_FEE = (fee, orders = []) => ({ fee, feeEnabled: () => true, orders })
const bscIstek = () => alIstek({ chainId: 56, stockAddress: STOCK_BSC.address, payToken: payOf(56, 'USDC').address })

describe('quote Faz 3: bayrak kapaliyken Faz 2 ile birebir', () => {
  it('fee verilmez: feePreview none, kayitta feePreview none', async () => {
    const t = kur()
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r.success).toBe(true)
    expect(r.feePreview).toEqual(YOK_ONIZLEME)
    expect(t.kayitlar[0].feePreview).toEqual({ mode: 'none', quotedAtsRaw: null })
  })

  it('feeEnabled false + fee verilmis + borclu owed kayit: kilitlenmez, fee.prepare 0, cagri dizisi fee verilmeyenle AYNI', async () => {
    const taban = kur()
    await taban.servis.quote({ request: alIstek(), owner: OWNER })
    const fee = feeKur()
    const t = kur({ fee, feeEnabled: () => false, orders: [borcluKayit()] })
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r.success).toBe(true)
    expect(r.locked).toBe(false)
    expect(r.feePreview).toEqual(YOK_ONIZLEME)
    expect(fee.prepare).not.toHaveBeenCalled()
    expect(t.orders.loadOrders).toHaveBeenCalledTimes(taban.orders.loadOrders.mock.calls.length)
    expect(t.cagrilar).toEqual(taban.cagrilar)
  })

  it('feeEnabled true ama fee yok: Faz 2 (kilit yok, prepare yok)', async () => {
    const t = kur({ feeEnabled: () => true, orders: [borcluKayit()] })
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r).toMatchObject({ success: true, locked: false, feePreview: YOK_ONIZLEME })
  })
})

describe('quote Faz 3: borc kilidi', () => {
  it('owner in owed kaydi -> FEE_DEBT kilidi; chain/api/reference cagrilari 0; feeDebtUids', async () => {
    const fee = feeKur()
    const t = kur(ACIK_FEE(fee, [borcluKayit()]))
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r).toEqual({
      success: true,
      locked: true,
      lockReason: 'FEE_DEBT',
      quoteId: null,
      display: null,
      approval: null,
      reference: null,
      notice: null,
      warnings: [],
      feeDebtUids: [borcluKayit().uid],
    })
    expect(t.api.quote).not.toHaveBeenCalled()
    expect(t.chain.readDecimals).not.toHaveBeenCalled()
    expect(t.chain.readBalance).not.toHaveBeenCalled()
    expect(t.reference.getReference).not.toHaveBeenCalled()
    expect(t.reference.getTrading).not.toHaveBeenCalled()
    expect(fee.prepare).not.toHaveBeenCalled()
    expect(t.kayitlar).toHaveLength(0)
  })

  it('baska owner in borcu kilitlemez', async () => {
    const t = kur(ACIK_FEE(feeKur(), [borcluKayit({ owner: ATTACKER })]))
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r).toMatchObject({ success: true, locked: false })
  })

  it('NO_SERVICE >= 10 dk olan borc kilitlemez; 10 dk dolmadan kilitler', async () => {
    const eski = borcluKayit({ fee: { mode: 'ats', state: 'blocked', blocker: 'NO_SERVICE', noServiceSince: NOW - 10 * 60 * 1000 } })
    const t1 = kur(ACIK_FEE(feeKur(), [eski]))
    expect(await t1.servis.quote({ request: alIstek(), owner: OWNER })).toMatchObject({ locked: false })
    const taze = borcluKayit({ fee: { mode: 'ats', state: 'blocked', blocker: 'NO_SERVICE', noServiceSince: NOW - 60_000 } })
    const t2 = kur(ACIK_FEE(feeKur(), [taze]))
    expect(await t2.servis.quote({ request: alIstek(), owner: OWNER })).toMatchObject({ locked: true, lockReason: 'FEE_DEBT' })
  })

  it('paid ve void ucret kilitlemez', async () => {
    const t = kur(
      ACIK_FEE(feeKur(), [
        borcluKayit({ fee: { mode: 'ats', state: 'paid' } }),
        borcluKayit({ fee: { mode: 'ats', state: 'void' } }),
      ]),
    )
    expect(await t.servis.quote({ request: alIstek(), owner: OWNER })).toMatchObject({ locked: false })
  })
})

describe('quote Faz 3: feePreview', () => {
  it('hazir kullanici: mode ats, quotedAtsRaw ve decimals; kayitta yalniz mode ve quotedAtsRaw', async () => {
    const fee = feeKur()
    const t = kur(ACIK_FEE(fee))
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r.feePreview).toEqual({ mode: 'ats', quotedAtsRaw: ATS_1, decimals: 18, hint: false, lowNetworkFee: false })
    expect(t.kayitlar[0].feePreview).toEqual({ mode: 'ats', quotedAtsRaw: ATS_1 })
    expect(fee.prepare).toHaveBeenCalledWith({ owner: OWNER, chainId: 1 })
    expect(() => JSON.stringify(r)).not.toThrow()
  })

  it('hint: BALANCE_LOW ve NOT_READY icin true', async () => {
    const dusuk = kur(ACIK_FEE(feeKur(hazirlik({ balanceRaw: '1' }))))
    expect((await dusuk.servis.quote({ request: alIstek(), owner: OWNER })).feePreview).toMatchObject({ mode: 'none', quotedAtsRaw: null, hint: true })
    const hazirDegil = kur(ACIK_FEE(feeKur(hazirlik({ status: { ready: false, mode: 'normal' } }))))
    expect((await hazirDegil.servis.quote({ request: alIstek(), owner: OWNER })).feePreview).toMatchObject({ mode: 'none', hint: true })
  })

  it('hint: BOOTSTRAP ve BALANCE_UNKNOWN icin true', async () => {
    const boot = kur(ACIK_FEE(feeKur(hazirlik({ status: { ready: true, mode: 'bootstrap' } }))))
    expect((await boot.servis.quote({ request: alIstek(), owner: OWNER })).feePreview.hint).toBe(true)
    const bilinmiyor = kur(ACIK_FEE(feeKur(hazirlik({ balanceRaw: null }))))
    expect((await bilinmiyor.servis.quote({ request: alIstek(), owner: OWNER })).feePreview.hint).toBe(true)
  })

  it('hint: FEE_UNKNOWN icin false', async () => {
    const bilinmeyenUcret = kur(ACIK_FEE(feeKur(hazirlik({ quotedFeeRaw: null }))))
    expect((await bilinmeyenUcret.servis.quote({ request: alIstek(), owner: OWNER })).feePreview).toMatchObject({ mode: 'none', hint: false })
  })

  it('lowNetworkFee: Ethereum false, BSC true', async () => {
    const eth = kur(ACIK_FEE(feeKur()))
    expect((await eth.servis.quote({ request: alIstek(), owner: OWNER })).feePreview.lowNetworkFee).toBe(false)
    const bsc = kur({
      ...ACIK_FEE(feeKur()),
      readDecimals: 18,
      yanit: { fixture: { sellAmount: '98592128000000000000', feeAmount: '1407872000000000000', buyAmount: '263447862041645538' } },
    })
    const r = await bsc.servis.quote({ request: bscIstek(), owner: OWNER })
    expect(r.success).toBe(true)
    expect(r.feePreview.lowNetworkFee).toBe(true)
  })

  it('fee.prepare firlatir: mode none, hint false, kullanici bloklanmaz', async () => {
    const t = kur(
      ACIK_FEE({
        prepare: vi.fn(async () => {
          throw new Error('rpc yok')
        }),
      }),
    )
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r).toMatchObject({ success: true, locked: false, feePreview: { mode: 'none', quotedAtsRaw: null, hint: false } })
    expect(t.kayitlar[0].feePreview).toEqual({ mode: 'none', quotedAtsRaw: null })
  })

  it('fee.prepare 4 sn icinde donmezse mode none', async () => {
    vi.useFakeTimers()
    try {
      const t = kur(ACIK_FEE({ prepare: vi.fn(() => new Promise(() => {})) }))
      const p = t.servis.quote({ request: alIstek(), owner: OWNER })
      await vi.advanceTimersByTimeAsync(FEE_PREPARE_TIMEOUT_MS + 1)
      const r = await p
      expect(r).toMatchObject({ success: true, feePreview: { mode: 'none', hint: false } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('CoW teklifi kilitliyken de feePreview alani verilir (UI karti gizler)', async () => {
    const t = kur({ ...ACIK_FEE(feeKur()), reference: 100 })
    const r = await t.servis.quote({ request: alIstek(), owner: OWNER })
    expect(r.success).toBe(true)
    expect(r.locked).toBe(true)
    expect(r.feePreview).toBeTruthy()
  })
})

describe('service.js kaynak taramasi', () => {
  const kaynak = yorumsuz(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'service.js'), 'utf8'))
  it('console / localStorage / window kullanmaz', () => {
    expect(kaynak).not.toMatch(/console\./)
    expect(kaynak).not.toMatch(/localStorage/)
    expect(kaynak).not.toMatch(/window\./)
  })
  it('teklif oncesi kilit chain/api cagrilarindan once gelir', () => {
    expect(kaynak.indexOf('preQuoteLock(')).toBeGreaterThan(0)
    expect(kaynak.indexOf('preQuoteLock(')).toBeLessThan(kaynak.indexOf('chain.readDecimals('))
    expect(kaynak.indexOf('preQuoteLock(')).toBeLessThan(kaynak.indexOf('api.quote('))
  })
  it('permit domaini dogrulanir', () => {
    expect(kaynak).toMatch(/verifyPermitDomain\(/)
  })
})

beforeEach(() => {
  vi.restoreAllMocks()
})

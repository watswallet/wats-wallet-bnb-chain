// ATS satisi -- teklif katmani (spec §5.1, §6.2/1, §7). Sunucu sahte bir istemciyle; desk ve
// sponsor sabitleri test adresleriyle degistirilir.
import { describe, it, expect, vi } from 'vitest'

// vi.mock fabrikasi dosyanin en ustune tasinir: adresler vi.hoisted ile ONCE kurulmali.
const { DESK, SPONSOR } = vi.hoisted(() => ({
  DESK: '0x1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d',
  SPONSOR: '0x5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b',
}))
vi.mock('./atsSaleConfig', async (importOriginal) => ({
  ...(await importOriginal()), ATS_SALE_DESK: DESK, ATS_SALE_SPONSOR: SPONSOR,
}))

import {
  saleError, saleErrorOf, saleErrorResponse, saleGaslessClient, parseSaleAmount, assertSaleQuote,
  fetchAtsSaleQuote, mapSaleQuote, quoteMsLeft, saleQuoteUsable, normalizeCollectorApproveAmount,
  isSaleRequoteError,
} from './atsSale'
import { GaslessClient } from './sdk/gasless'

const BUYER = '0xAbCdEf0000000000000000000000000000000001'
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
const PAY = 5000000000000000000n
const QID = '0x' + 'ab'.repeat(32)
const yanit = (over = {}, quoteOver = {}) => ({
  quote: {
    buyer: BUYER, payToken: USDT, payAmount: PAY.toString(), atsAmount: '96000000000000000000',
    deadline: 1790000000, quoteId: QID, ...quoteOver,
  },
  signature: '0x' + 'cd'.repeat(65), desk: DESK, sponsor: SPONSOR, collectorApproveAmount: '123000000000000000000',
  display: { usdValue: '5', price: '0.05173', referencePrice: '0.0512', priceImpactPct: 0.56, commissionPct: 1, commissionAts: '960000000000000000' },
  ...over,
})
const REF = { buyer: BUYER, payTokenAddress: USDT, payAmountRaw: PAY }
const ISTEK = { symbol: 'USDT', address: USDT, quoteAddress: USDT, decimals: 18 }
const kodu = (fn) => { try { fn() } catch (e) { return e.code } return null }

describe('parseSaleAmount', () => {
  it('insan-okur tutari 18 ondalikla wei yapar', () => {
    expect(parseSaleAmount('5')).toBe(PAY)
    expect(parseSaleAmount('0.05')).toBe(50000000000000000n)
  })

  it.each([['0'], [''], ['abc'], ['-1'], [null]])('gecersiz tutar (%s) bad-request', (v) => {
    expect(kodu(() => parseSaleAmount(v))).toBe('bad-request')
  })
})

describe('saleGaslessClient', () => {
  it('BSC satis istemcisi atsConfig backendBase ine konusur', () => {
    const c = saleGaslessClient()
    expect(c).toBeInstanceOf(GaslessClient)
    expect(c.opts).toEqual({ baseUrl: 'https://bundler.watswallet.com', chainId: 56 })
  })
})

describe('assertSaleQuote -- sunucuya korlemesine guvenilmez', () => {
  it('istenen alim + sabit adresler -> gecer', () => {
    expect(assertSaleQuote(yanit(), REF).quote.quoteId).toBe(QID)
  })

  it('adres karsilastirmasi harf duyarsiz', () => {
    expect(assertSaleQuote(yanit({ desk: '0x1D1D1D1D1D1D1D1D1D1D1D1D1D1D1D1D1D1D1D1D' }), REF)).toBeTruthy()
  })

  it.each([
    ['baska desk', yanit({ desk: '0x' + '99'.repeat(20) })],
    ['baska sponsor', yanit({ sponsor: '0x' + '98'.repeat(20) })],
    ['baska alici', yanit({}, { buyer: '0x' + '97'.repeat(20) })],
    ['baska odeme tokeni', yanit({}, { payToken: USDC })],
    ['baska tutar', yanit({}, { payAmount: '6000000000000000000' })],
    ['sifir ATS', yanit({}, { atsAmount: '0' })],
    ['bozuk tutar', yanit({}, { atsAmount: 'abc' })],
    ['bozuk quoteId', yanit({}, { quoteId: '0x1234' })],
    ['bozuk imza', yanit({ signature: '0xdead' })],
    ['eksik deadline', yanit({}, { deadline: undefined })],
    ['teklif yok', { desk: DESK, sponsor: SPONSOR }],
  ])('%s -> sale-quote-mismatch', (_ad, r) => {
    expect(kodu(() => assertSaleQuote(r, REF))).toBe('sale-quote-mismatch')
  })
})

describe('fetchAtsSaleQuote', () => {
  it('/sale/quote a sembol ve wei tutarla gider, dogrulanmis yaniti doner', async () => {
    const client = { saleQuote: vi.fn(async () => yanit()) }
    const r = await fetchAtsSaleQuote({ client, buyer: BUYER, request: ISTEK, payAmountRaw: PAY })
    expect(client.saleQuote).toHaveBeenCalledWith({ buyer: BUYER, payToken: 'USDT', payAmount: '5000000000000000000' })
    expect(r.quote.quoteId).toBe(QID)
  })

  it('sunucunun kodlu hatasi (stok ipucu govdesiyle) OLDUGU GIBI gecer', async () => {
    const hata = Object.assign(new Error('stok yetersiz'), {
      code: 'stock-insufficient', status: 409, body: { maxAts: '1000000000000000000000', maxUsd: '51.20' },
    })
    const client = { saleQuote: vi.fn(async () => { throw hata }) }
    await expect(fetchAtsSaleQuote({ client, buyer: BUYER, request: ISTEK, payAmountRaw: PAY })).rejects.toBe(hata)
  })

  it('kodsuz hata (ag, HTML 502) quote-failed olur', async () => {
    const client = { saleQuote: vi.fn(async () => { throw new TypeError('Failed to fetch') }) }
    await expect(fetchAtsSaleQuote({ client, buyer: BUYER, request: ISTEK, payAmountRaw: PAY }))
      .rejects.toMatchObject({ code: 'quote-failed' })
  })

  it('yanit dogrulanamazsa (baska desk) reddedilir', async () => {
    const client = { saleQuote: vi.fn(async () => yanit({ desk: '0x' + '99'.repeat(20) })) }
    await expect(fetchAtsSaleQuote({ client, buyer: BUYER, request: ISTEK, payAmountRaw: PAY }))
      .rejects.toMatchObject({ code: 'sale-quote-mismatch' })
  })
})

describe('mapSaleQuote -- takas ekraninin bicimi', () => {
  it('ekranin okudugu alanlar + saleQuote', () => {
    const d = mapSaleQuote(yanit(), { receivedAt: 1000 })
    expect(d.expectedOutput).toBe('96.0')
    expect(d.minimumReceived).toBe('96.0')
    expect(d.exchangeRate).toBe('19.200000')
    expect(d.priceImpact).toBe('0.56%')
    expect(d.depthGateWarning).toBe(false)
    expect(d.estimatedGasFee.totalCost).toBe('0')
    expect(d.saleQuote).toMatchObject({
      desk: DESK, sponsor: SPONSOR, deadline: 1790000000, receivedAt: 1000, signature: '0x' + 'cd'.repeat(65),
      collectorApproveAmount: '123000000000000000000',
    })
    expect(d.saleQuote.quote).toEqual({
      buyer: BUYER, payToken: USDT, payAmount: '5000000000000000000', atsAmount: '96000000000000000000',
      deadline: 1790000000, quoteId: QID,
    })
    expect(d.saleQuote.display.price).toBe('0.05173')
  })

  it('fiyat etkisi yoksa N/A% (ekran "olculemedi" satirini gosterir)', () => {
    expect(mapSaleQuote(yanit({ display: {} })).priceImpact).toBe('N/A%')
  })

  it('yanit JSON-guvenli (BigInt yok)', () => {
    expect(() => JSON.stringify(mapSaleQuote(yanit()))).not.toThrow()
  })
})

describe('saleQuoteUsable -- requote kurali (spec §6.2/1)', () => {
  const T0 = 1_000_000
  const sq = (over = {}, quoteOver = {}) => {
    const s = mapSaleQuote(yanit({}, quoteOver), { receivedAt: T0 }).saleQuote
    return { ...s, ...over }
  }

  it('taze ve istekle ayni -> kullanilir', () => {
    expect(saleQuoteUsable(sq(), REF, T0 + 1000)).toBe(true)
  })

  it('kalan sure 10 sn ve uzeri -> kullanilir; altinda -> requote', () => {
    expect(saleQuoteUsable(sq(), REF, T0 + 20_000)).toBe(true)
    expect(saleQuoteUsable(sq(), REF, T0 + 20_001)).toBe(false)
  })

  // REVIEW FOCUS 1: ekran yeni tutari 400 ms'lik bekleme bitmeden gonderdi.
  it('tutar teklifinkinden farkliysa -> requote, eski teklifle ALIM YOK', () => {
    expect(saleQuoteUsable(sq(), { ...REF, payAmountRaw: 6000000000000000000n }, T0 + 1000)).toBe(false)
  })

  it('baska hesap ya da baska odeme tokeni -> requote', () => {
    expect(saleQuoteUsable(sq(), { ...REF, buyer: '0x' + '97'.repeat(20) }, T0 + 1000)).toBe(false)
    expect(saleQuoteUsable(sq(), { ...REF, payTokenAddress: USDC }, T0 + 1000)).toBe(false)
  })

  it('teklif yoksa ya da alinma ani okunamazsa -> requote', () => {
    expect(saleQuoteUsable(undefined, REF, T0)).toBe(false)
    expect(saleQuoteUsable({}, REF, T0)).toBe(false)
    expect(saleQuoteUsable(sq({ receivedAt: 'x' }), REF, T0)).toBe(false)
  })

  // REVIEW FOCUS 2: istemci saati sunucudan 25 sn ileride.
  it('kalan sure ALINDIGI andan olculur; sunucu deadline i yerel saatle KARSILASTIRILMAZ', () => {
    const now = 1790000000 * 1000 + 25_000   // yerel saate gore deadline 25 sn once gecmis
    expect(saleQuoteUsable(sq({ receivedAt: now - 1000 }), REF, now)).toBe(true)
    // Ters yon: deadline ileride gorunse de teklif 21 sn once alindiysa requote.
    expect(saleQuoteUsable(sq({ receivedAt: now - 21_000 }, { deadline: 1890000000 }), REF, now)).toBe(false)
  })

  it('quoteMsLeft = 30 sn - gecen sure', () => {
    expect(quoteMsLeft(T0, T0 + 5000)).toBe(25_000)
  })
})

describe('normalizeCollectorApproveAmount -- toplayici izni ASLA sinirsiz degil (spec §4.3)', () => {
  const MAX = (2n ** 256n - 1n).toString()

  it.each([
    ['123000000000000000000', '123000000000000000000'],
    ['0', '0'],
    ['007', '7'],
    [(2n ** 256n - 2n).toString(), (2n ** 256n - 2n).toString()],
  ])('%s -> %s', (v, beklenen) => {
    expect(normalizeCollectorApproveAmount(v)).toBe(beklenen)
  })

  it.each([[MAX], [(2n ** 256n).toString()], ['-1'], ['1.5'], ['1e18'], [' 12'], ['abc'], [''], [123], [null], [undefined]])(
    'gecersiz (%s) -> "0"', (v) => {
      expect(normalizeCollectorApproveAmount(v)).toBe('0')
    })

  it('mapSaleQuote normallestirilmis tutari saleQuote a koyar', () => {
    expect(mapSaleQuote(yanit()).saleQuote.collectorApproveAmount).toBe('123000000000000000000')
    expect(mapSaleQuote(yanit({ collectorApproveAmount: MAX })).saleQuote.collectorApproveAmount).toBe('0')
    expect(mapSaleQuote(yanit({ collectorApproveAmount: undefined })).saleQuote.collectorApproveAmount).toBe('0')
  })
})

describe('isSaleRequoteError -- sponsor teklifi bu turda kabul etmiyor (spec §6.2/1)', () => {
  it('sale-quote-expired -> requote yolu', () => {
    expect(isSaleRequoteError(Object.assign(new Error('x'), { code: 'sale-quote-expired', status: 409 }))).toBe(true)
    expect(isSaleRequoteError(saleError('sale-quote-expired'))).toBe(true)
  })

  it.each(['sale-quote-used', 'sale-quote-invalid', 'sale-calldata', 'relay-failed', 'result-unknown'])(
    '%s -> requote DEGIL', (code) => {
      expect(isSaleRequoteError(Object.assign(new Error(code), { code }))).toBe(false)
    })

  it('kodsuz hata ya da bos -> false', () => {
    expect(isSaleRequoteError(new Error('x'))).toBe(false)
    expect(isSaleRequoteError(undefined)).toBe(false)
  })
})

describe('saleErrorOf / saleErrorResponse -- ekran kodu (spec §7)', () => {
  it('stok ipucu sunucunun hata GOVDESINDEN alinir', () => {
    const e = Object.assign(new Error('x'), { code: 'stock-insufficient', body: { maxAts: '1000', maxUsd: '51.20' } })
    expect(saleErrorOf(e)).toEqual({ code: 'stock-insufficient', maxAts: '1000', maxUsd: '51.20' })
  })

  it('stok ipucu yoksa alanlar null', () => {
    expect(saleErrorOf(saleError('stock-insufficient'))).toEqual({ code: 'stock-insufficient', maxAts: null, maxUsd: null })
  })

  it.each(['sale-closed', 'amount-too-small', 'amount-too-large', 'price-unverified', 'usdc-depeg', 'depth-insufficient', 'rate-limited'])(
    '%s oldugu gibi gecer', (code) => {
      expect(saleErrorOf(Object.assign(new Error(code), { code }))).toEqual({ code })
    })

  it.each(['sale-calldata', 'sale-quote-invalid', 'sale-quote-expired', 'sale-quote-used', 'sale-balance', 'gas-cap', 'bad-request', 'sale-quote-mismatch'])(
    '%s "hazirlanamadi"ya duser', (code) => {
      expect(saleErrorOf(Object.assign(new Error(code), { code }))).toEqual({ code: 'prepare-failed' })
    })

  it('faz kodlari (saleError) gecer; kodsuz hata prepare-failed', () => {
    expect(saleErrorOf(saleError('relay-failed'))).toEqual({ code: 'relay-failed' })
    expect(saleErrorOf(saleError('result-unknown'))).toEqual({ code: 'result-unknown' })
    expect(saleErrorOf(saleError('quote-failed'))).toEqual({ code: 'quote-failed' })
    expect(saleErrorOf(new Error('boom'))).toEqual({ code: 'prepare-failed' })
    expect(saleErrorOf(undefined)).toEqual({ code: 'prepare-failed' })
  })

  it('yanit bicimi', () => {
    expect(saleErrorResponse(saleError('rate-limited'))).toEqual({
      success: false, error: 'rate-limited', saleError: { code: 'rate-limited' },
    })
  })

  // Controller hukmu P2-C3: sale-quote-used = bu teklifle bir alim zaten yapilmis olabilir; ekran
  // otomatik requote yapmaz. Ekran kodu "hazirlanamadi" kalir, ama yanit `consumed: true` tasir.
  it('sale-quote-used yanita consumed: true ekler; ekran kodu prepare-failed kalir', () => {
    const r = saleErrorResponse(Object.assign(new Error('used'), { code: 'sale-quote-used', status: 409 }))
    expect(r).toEqual({ success: false, error: 'used', saleError: { code: 'prepare-failed' }, consumed: true })
    expect(saleErrorResponse(saleError('sale-quote-used')).consumed).toBe(true)
  })

  it('baska kodlarda consumed alani YOK', () => {
    for (const code of ['sale-quote-expired', 'sale-quote-invalid', 'relay-failed', 'result-unknown']) {
      expect(saleErrorResponse(saleError(code))).not.toHaveProperty('consumed')
    }
    expect(saleErrorResponse(undefined)).not.toHaveProperty('consumed')
  })
})

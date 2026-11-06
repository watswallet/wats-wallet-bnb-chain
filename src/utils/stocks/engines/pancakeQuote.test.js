// T11: SWAP_QUOTE yaniti -> ortak QuoteResponse/display eslemesi (saf). RPC, chrome, ag YOK.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseUnits } from 'ethers'
import { MAX_PRICE_IMPACT_PERCENT } from '../../swapRoutes'
import { ENGINE_ERROR } from './errors'
import {
  toQuoteResponse,
  priceImpactBlocked,
  PANCAKE_QUOTE_TTL_MS,
  REFERENCE_GAP_WARN_PCT,
} from './pancakeQuote'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(here, 'pancakeQuote.js'), 'utf8')
const kod = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const NOW = 1_700_000_000_000
const swapData = (over = {}) => ({
  expectedOutput: '0.5',
  slippageTolerance: '0.50%',
  minimumReceived: '0.4975',
  depthGateWarning: false,
  priceImpact: '0.40%',
  liquidityProviderFee: '0.25%',
  exchangeRate: '0.005000',
  reverseExchangeRate: '200.000000',
  estimatedGasFee: { totalCost: '0.001' },
  routerType: { name: 'PancakeSwap', version: 3 },
  ...over,
})
// Al: 100 USDT oder, 0.5 hisse alir -> birim 200
const buyCtx = (over = {}) => ({ side: 'buy', amount: '100', referencePrice: 200, quoteId: 'ps_1', now: NOW, ...over })
// Sat: 0.5 hisse satar, 99 USDT alir -> birim 198
const sellData = (over = {}) => swapData({ expectedOutput: '99', minimumReceived: '98.505', ...over })
const sellCtx = (over = {}) => ({ side: 'sell', amount: '0.5', referencePrice: 200, quoteId: 'ps_2', now: NOW, ...over })

describe('toQuoteResponse temel sekil', () => {
  it('Al: ortak QuoteResponse alanlari', () => {
    const r = toQuoteResponse(swapData(), buyCtx())
    expect(r.success).toBe(true)
    expect(r.locked).toBe(false)
    expect(r.lockReason).toBeUndefined()
    expect(r.quoteId).toBe('ps_1')
    expect(r.expiresAt).toBe(NOW + PANCAKE_QUOTE_TTL_MS)
    expect(PANCAKE_QUOTE_TTL_MS).toBe(30000)
    expect(r.approval).toEqual({ mode: 'none' })
    expect(r.reference).toBe(200)
    expect(r.notice).toBeNull()
    expect(r.warnings).toEqual([])
  })

  it('display.engine pancake ve CoW display alan adlari korunur', () => {
    const d = toQuoteResponse(swapData(), buyCtx()).display
    expect(d.engine).toBe('pancake')
    expect(d.side).toBe('buy')
    for (const k of ['sellAmount', 'sellDecimals', 'expectedBuy', 'minBuy', 'buyDecimals', 'unitPrice', 'referencePrice', 'gapPct', 'priceImpact', 'fees']) {
      expect(d).toHaveProperty(k)
    }
  })

  it('display BigInt icermez (mesaj-guvenli, JSON-lanabilir)', () => {
    const r = toQuoteResponse(swapData(), buyCtx())
    expect(() => JSON.stringify(r)).not.toThrow()
  })

  it('CoW a ozgu alanlar bStocks display inde YOK; ag ucreti alanlari null (P1/P2)', () => {
    const d = toQuoteResponse(swapData(), buyCtx()).display
    expect(d.fees.cowUsd).toBeUndefined()
    expect(d.fees.watsUsd).toBeUndefined()
    expect(d.fees.networkUsd).toBeUndefined()
    expect(d.networkFeeUsd).toBeNull()
    expect(d.networkFeePct).toBeNull()
    expect(d.minAmountUsdForFee).toBeNull()
    expect(d.locked).toBe(false)
    expect(d.lockReason).toBeNull()
  })
})

describe('UI-atom degerleri (18 ondalik)', () => {
  it('Al: sellAmount odenen stable, expectedBuy/minBuy alinan hisse; hepsi parseUnits(.,18)', () => {
    const d = toQuoteResponse(swapData(), buyCtx()).display
    expect(d.sellAmount).toBe(parseUnits('100', 18).toString())
    expect(d.expectedBuy).toBe(parseUnits('0.5', 18).toString())
    expect(d.minBuy).toBe(parseUnits('0.4975', 18).toString())
    expect(d.sellDecimals).toBe(18)
    expect(d.buyDecimals).toBe(18)
  })

  it('Sat: sellAmount satilan hisse adedi, expectedBuy alinan stable', () => {
    const d = toQuoteResponse(sellData(), sellCtx()).display
    expect(d.side).toBe('sell')
    expect(d.sellAmount).toBe(parseUnits('0.5', 18).toString())
    expect(d.expectedBuy).toBe(parseUnits('99', 18).toString())
    expect(d.minBuy).toBe(parseUnits('98.505', 18).toString())
  })

  it('tum atom alanlari saf rakam dizesi (HAM 8 ondalik carpani karismaz)', () => {
    const d = toQuoteResponse(swapData(), buyCtx()).display
    for (const k of ['sellAmount', 'expectedBuy', 'minBuy']) expect(d[k]).toMatch(/^\d+$/)
  })

  it('18 ondaliktan uzun kullanici tutari 18 e KIRPILIR (firlatmaz)', () => {
    const d = toQuoteResponse(swapData(), buyCtx({ amount: '1.1234567890123456789012' })).display
    expect(d.sellAmount).toBe(parseUnits('1.123456789012345678', 18).toString())
  })

  it('ondalik noktasi baslayan ve biten UI dizeleri', () => {
    expect(toQuoteResponse(swapData({ expectedOutput: '.5' }), buyCtx()).display.expectedBuy).toBe(parseUnits('0.5', 18).toString())
    expect(toQuoteResponse(swapData(), buyCtx({ amount: '100.' })).display.sellAmount).toBe(parseUnits('100', 18).toString())
  })
})

describe('unitPrice kendi tutarlarimizdan', () => {
  it('Al: odenen stable / alinan adet', () => {
    expect(toQuoteResponse(swapData(), buyCtx()).display.unitPrice).toBeCloseTo(200, 6)
  })

  it('Sat: alinan stable / satilan adet', () => {
    expect(toQuoteResponse(sellData(), sellCtx()).display.unitPrice).toBeCloseTo(198, 6)
  })

  it('exchangeRate KULLANILMAZ: bozuk exchangeRate sonucu degistirmez', () => {
    const a = toQuoteResponse(swapData({ exchangeRate: '999.000000', reverseExchangeRate: '0.000001' }), buyCtx())
    const b = toQuoteResponse(swapData({ exchangeRate: 'NaN', reverseExchangeRate: undefined }), buyCtx())
    expect(a.display.unitPrice).toBeCloseTo(200, 6)
    expect(b.display.unitPrice).toBeCloseTo(200, 6)
    expect(kod).not.toMatch(/exchangeRate|reverseExchangeRate/)
  })

  it('kucuk tutar hassasiyeti: 0.000001 hisse', () => {
    const r = toQuoteResponse(swapData({ expectedOutput: '0.000001', minimumReceived: '0.000000995' }), buyCtx({ amount: '0.0002' }))
    expect(r.display.unitPrice).toBeCloseTo(200, 4)
  })
})

describe('referans farki (gapPct) yalniz bilgi, KILIT YOK (S1/TK10)', () => {
  it('Al: pozitif = kullanici fazla oder', () => {
    // 100 / 0.5 = 200, referans 190 -> +%5.263
    const r = toQuoteResponse(swapData(), buyCtx({ referencePrice: 190 }))
    expect(r.display.gapPct).toBeCloseTo((200 / 190 - 1) * 100, 6)
    expect(r.display.gapPct).toBeGreaterThan(0)
    expect(r.locked).toBe(false)
    expect(r.display.locked).toBe(false)
  })

  it('Sat: pozitif = kullanici eksik alir (Al ile ayni isaret anlami)', () => {
    // 198 birim, referans 200 -> +%1
    const r = toQuoteResponse(sellData(), sellCtx())
    expect(r.display.gapPct).toBeCloseTo(1, 6)
  })

  it('dev fark bile kilitlemez (referans kilidi YOK)', () => {
    const r = toQuoteResponse(swapData(), buyCtx({ referencePrice: 100 }))
    expect(r.display.gapPct).toBeGreaterThan(50)
    expect(r.locked).toBe(false)
    expect(r.lockReason).toBeUndefined()
  })

  it('uyari bayragi: |fark| >= %2 ise gapWarn', () => {
    expect(REFERENCE_GAP_WARN_PCT).toBe(2)
    // birim 200: ref 200 -> 0
    expect(toQuoteResponse(swapData(), buyCtx()).display.gapWarn).toBe(false)
    // ref 196 -> +%2.04
    expect(toQuoteResponse(swapData(), buyCtx({ referencePrice: 196 })).display.gapWarn).toBe(true)
    // ref 204 -> -%1.96 (alti)
    expect(toQuoteResponse(swapData(), buyCtx({ referencePrice: 204 })).display.gapWarn).toBe(false)
    // ref 210 -> -%4.76, mutlak deger esigi gecer
    expect(toQuoteResponse(swapData(), buyCtx({ referencePrice: 210 })).display.gapWarn).toBe(true)
  })

  it('referans yoksa/gecersizse gapPct ve referencePrice null, gapWarn false, teklif yine basarili', () => {
    for (const bad of [null, undefined, 0, -5, NaN, Infinity, '200']) {
      const r = toQuoteResponse(swapData(), buyCtx({ referencePrice: bad }))
      expect(r.success).toBe(true)
      expect(r.display.referencePrice).toBeNull()
      expect(r.display.gapPct).toBeNull()
      expect(r.display.gapWarn).toBe(false)
      expect(r.reference).toBeNull()
    }
  })
})

describe('priceImpact', () => {
  it('olculen dusuk etki: high false, unmeasured false', () => {
    const p = toQuoteResponse(swapData({ priceImpact: '0.40%' }), buyCtx()).display.priceImpact
    expect(p).toEqual({ pct: 0.4, high: false, unmeasured: false })
  })

  it('N/A% -> unmeasured (high DEGIL, kilitlemez)', () => {
    const r = toQuoteResponse(swapData({ priceImpact: 'N/A%' }), buyCtx())
    expect(r.display.priceImpact).toEqual({ pct: null, high: false, unmeasured: true })
    expect(r.locked).toBe(false)
  })

  it('NaN% ve eksik alan da unmeasured', () => {
    expect(toQuoteResponse(swapData({ priceImpact: 'NaN%' }), buyCtx()).display.priceImpact.unmeasured).toBe(true)
    expect(toQuoteResponse(swapData({ priceImpact: undefined }), buyCtx()).display.priceImpact.unmeasured).toBe(true)
  })

  it('esik swapRoutes.MAX_PRICE_IMPACT_PERCENT: tam esik YUKSEK degil, esik ustu yuksek', () => {
    expect(MAX_PRICE_IMPACT_PERCENT).toBe(5)
    expect(toQuoteResponse(swapData({ priceImpact: `${MAX_PRICE_IMPACT_PERCENT}.00%` }), buyCtx()).display.priceImpact.high).toBe(false)
    expect(toQuoteResponse(swapData({ priceImpact: '5.01%' }), buyCtx()).display.priceImpact.high).toBe(true)
    expect(toQuoteResponse(swapData({ priceImpact: '12.30%' }), buyCtx()).display.priceImpact).toEqual({ pct: 12.3, high: true, unmeasured: false })
  })

  it('yuksek etki teklifi KILITLEMEZ: kapi onay kutusudur (priceImpactBlocked)', () => {
    const r = toQuoteResponse(swapData({ priceImpact: '9.00%' }), buyCtx())
    expect(r.success).toBe(true)
    expect(r.locked).toBe(false)
    expect(r.display.locked).toBe(false)
  })

  it('priceImpactBlocked: yuksek etki onaysiz engeller, onayla acilir; dusuk/olculemeyen engellemez', () => {
    const high = { pct: 9, high: true, unmeasured: false }
    expect(priceImpactBlocked(high, false)).toEqual({ blocked: true, code: ENGINE_ERROR.PRICE_IMPACT_HIGH })
    expect(priceImpactBlocked(high, true)).toEqual({ blocked: false, code: null })
    expect(priceImpactBlocked({ pct: 1, high: false, unmeasured: false }, false)).toEqual({ blocked: false, code: null })
    expect(priceImpactBlocked({ pct: null, high: false, unmeasured: true }, false)).toEqual({ blocked: false, code: null })
    expect(priceImpactBlocked(null, false)).toEqual({ blocked: false, code: null })
  })
})

describe('fees (ATS) ve ag ucreti ayrimi (P1/P2)', () => {
  it('ATS ucreti teklifte yoksa transfer/commission/total null; lpFeePct dizesi korunur', () => {
    const f = toQuoteResponse(swapData(), buyCtx()).display.fees
    expect(f).toEqual({ kind: 'ats', transfer: null, commission: null, total: null, lpFeePct: '0.25%' })
  })

  it('lpFeePct eksik/sayisal degilse null', () => {
    expect(toQuoteResponse(swapData({ liquidityProviderFee: undefined }), buyCtx()).display.fees.lpFeePct).toBeNull()
    expect(toQuoteResponse(swapData({ liquidityProviderFee: 'N/A%' }), buyCtx()).display.fees.lpFeePct).toBeNull()
  })

  it('ctx.atsFees verilirse toplam BigInt ile hesaplanir', () => {
    const f = toQuoteResponse(swapData(), buyCtx({ atsFees: { transfer: '1.5', commission: '0.25' } })).display.fees
    expect(f).toMatchObject({ kind: 'ats', transfer: '1.5', commission: '0.25', total: '1.75' })
  })

  it('ctx.atsFees gecersizse alanlar null (uydurma toplam yok)', () => {
    const f = toQuoteResponse(swapData(), buyCtx({ atsFees: { transfer: 'abc', commission: '1' } })).display.fees
    expect(f).toMatchObject({ transfer: null, commission: null, total: null })
  })
})

describe('bozuk yanit -> BAD_QUOTE_RESPONSE (kapali kume, firlatmaz)', () => {
  const bad = (data, ctx = buyCtx()) => {
    const r = toQuoteResponse(data, ctx)
    expect(r).toEqual({ success: false, code: ENGINE_ERROR.BAD_QUOTE_RESPONSE })
  }

  it('data yok / nesne degil', () => {
    bad(null)
    bad(undefined)
    bad('x')
  })

  it('expectedOutput eksik, sifir, negatif, sayi degil', () => {
    bad(swapData({ expectedOutput: undefined }))
    bad(swapData({ expectedOutput: '0' }))
    bad(swapData({ expectedOutput: '0.0' }))
    bad(swapData({ expectedOutput: '-1' }))
    bad(swapData({ expectedOutput: 'abc' }))
    bad(swapData({ expectedOutput: '1e5' }))
    bad(swapData({ expectedOutput: 5 }))
  })

  it('minimumReceived eksik, sayi degil veya beklenenden BUYUK', () => {
    bad(swapData({ minimumReceived: undefined }))
    bad(swapData({ minimumReceived: 'x' }))
    bad(swapData({ minimumReceived: '0.6' }))
  })

  it('kullanici tutari gecersiz/sifir', () => {
    bad(swapData(), buyCtx({ amount: '' }))
    bad(swapData(), buyCtx({ amount: '0' }))
    bad(swapData(), buyCtx({ amount: '-3' }))
    bad(swapData(), buyCtx({ amount: undefined }))
    bad(swapData(), buyCtx({ amount: 5 }))
  })

  it('taraf gecersiz', () => {
    bad(swapData(), buyCtx({ side: 'hold' }))
    bad(swapData(), buyCtx({ side: undefined }))
  })

  it('quoteId yok', () => {
    bad(swapData(), buyCtx({ quoteId: '' }))
    bad(swapData(), buyCtx({ quoteId: undefined }))
  })

  it('minimumReceived sifir olabilir (slippage ucta) ama beklenen > 0 sart', () => {
    const r = toQuoteResponse(swapData({ minimumReceived: '0' }), buyCtx())
    expect(r.success).toBe(true)
    expect(r.display.minBuy).toBe('0')
  })
})

describe('kaynak taramasi (birim siniri, kopya sabit yok)', () => {
  it('MAX_PRICE_IMPACT_PERCENT ve parsePriceImpactPercent swapRoutes ten ice aktarilir, 5 sabiti kopyalanmaz', () => {
    expect(kod).toMatch(/import\s*\{[^}]*MAX_PRICE_IMPACT_PERCENT[^}]*\}\s*from\s*'\.\.\/\.\.\/swapRoutes'/)
    expect(kod).toMatch(/parsePriceImpactPercent/)
    expect(kod).not.toMatch(/>\s*5\b/)
    expect(kod).not.toMatch(/MAX_PRICE_IMPACT_PERCENT\s*=/)
  })

  it('yasak desenler yok: carpan, 1e18, parseFloat/Number(ondalik dizesi)', () => {
    expect(kod).not.toMatch(/toRawSpendAmount|uiMultiplier|readUiMultiplier|1e18/)
    expect(kod).not.toMatch(/parseFloat\s*\(/)
  })

  it('Number( yalniz null/yuzde gosterimi ve BigInt->Number olcekleme icin; ham dize Number() e verilmez', () => {
    const cagrilar = kod.match(/Number\s*\([^)]*\)/g) || []
    for (const c of cagrilar) expect(c).not.toMatch(/amount|expectedOutput|minimumReceived/)
  })

  it('chrome/mesaj/ag cagrisi yok (saf modul)', () => {
    expect(kod).not.toMatch(/chrome\.|sendMessage|fetch\(|window\./)
  })
})

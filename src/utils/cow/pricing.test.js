// Task 6: referans fiyat, simetrik yuzde 2 kilidi (tam BigInt), ucret dokumu, goruntu modeli.
// Vektorler Task 3 (order.test.js) ciktilaridir; beklenen degerler literal.
import { describe, it, expect } from 'vitest'
import { referencePrice } from '../../../scripts/verify-xstocks-core.mjs'
import { LOCK_REASON, PRICE_PROTECTION_BPS, NETWORK_FEE_WARN_PCT } from './config'
import { referenceFrom, referenceMicro, unitPrice, priceGap, feeBreakdown, buildDisplay, tradeGate } from './pricing'

const ONE = 10n ** 18n
const kod = (fn) => {
  try {
    fn()
  } catch (e) {
    return e.code
  }
  return null
}

const AL = {
  S: 100000000n,
  networkFee: 1407872n,
  networkCostB: 3761972440926476n,
  protocolFee: 52700112430815n,
  spotBuy: 267262534595002829n,
  partnerFee: 267262534595002n,
  expectedBuy: 263180599507050536n,
  minBuy: 261864696509515284n,
}
const SAT = {
  S: 1000000000000000000n,
  networkFee: 4000000000000000n,
  networkCostB: 1528112n,
  protocolFee: 76115n,
  spotBuy: 382104227n,
  partnerFee: 382104n,
  expectedBuy: 380117896n,
  minBuy: 378217307n,
}

describe('referenceFrom / referenceMicro', () => {
  it('SPYx vektoru ve betikteki referencePrice ile ayni', () => {
    const m = 1005714560286254000n
    const r = referenceFrom({ priceUsd: 781.3, multiplier: m })
    expect(r).toBeCloseTo(776.86, 2)
    expect(r).toBe(referencePrice({ coingeckoUsd: 781.3, multiplier: m }))
  })

  it('gecersiz carpan ve fiyat -> null', () => {
    for (const multiplier of [0n, '', -1n, 'abc', null, undefined]) {
      expect(referenceFrom({ priceUsd: 100, multiplier })).toBeNull()
    }
    for (const priceUsd of [0, null, -5, NaN, 'x', undefined]) {
      expect(referenceFrom({ priceUsd, multiplier: ONE })).toBeNull()
    }
    expect(referenceFrom()).toBeNull()
  })

  it('bolme: carpan 2 iken fiyat yarisi (carpma degil)', () => {
    expect(referenceFrom({ priceUsd: 100, multiplier: 2n * ONE })).toBe(50)
  })

  it('referenceMicro: mikro-USD, gecersiz ve 0a yuvarlanan null', () => {
    expect(referenceMicro(776.86)).toBe(776860000n)
    expect(referenceMicro(100)).toBe(100000000n)
    for (const v of [0, -1, NaN, Infinity, null, undefined, '100', 1e-7]) expect(referenceMicro(v)).toBeNull()
  })
})

describe('unitPrice', () => {
  it('stable / hisse, gecersizde null', () => {
    expect(unitPrice({ payAmount: 100000000n, stockAmount: ONE, payDecimals: 6, stockDecimals: 18 })).toBe(100)
    expect(unitPrice({ payAmount: 0n, stockAmount: ONE, payDecimals: 6, stockDecimals: 18 })).toBeNull()
    expect(unitPrice({ payAmount: 1n, stockAmount: 0n, payDecimals: 6, stockDecimals: 18 })).toBeNull()
    expect(unitPrice({ payAmount: 1, stockAmount: 1n, payDecimals: 6, stockDecimals: 18 })).toBeNull()
  })
})

describe('priceGap: Al esigi (ref 100, 1 hisse)', () => {
  const al = (payAmount, payDecimals = 6) =>
    priceGap({ side: 'buy', payAmount, stockAmount: ONE, reference: 100, payDecimals, stockDecimals: 18 })

  it('tam %2 gecer, 1 atom fazlasi kilitli (USDC 6)', () => {
    const tam = al(102000000n)
    expect(tam.locked).toBe(false)
    expect(tam.gapPct).toBeCloseTo(2, 9)
    expect(al(102000001n).locked).toBe(true)
    expect(al(101999999n).locked).toBe(false)
  })

  it('BSC 18 ondalik odeme: sinir ayni', () => {
    expect(al(102n * 10n ** 18n, 18).locked).toBe(false)
    expect(al(102n * 10n ** 18n + 1n, 18).locked).toBe(true)
  })
})

describe('priceGap: Sat esigi (ref 100, 1 hisse satilir)', () => {
  const sat = (payAmount, payDecimals = 6) =>
    priceGap({ side: 'sell', payAmount, stockAmount: ONE, reference: 100, payDecimals, stockDecimals: 18 })

  it('tam %2 gecer, 1 atom azi kilitli (USDC 6)', () => {
    const tam = sat(98000000n)
    expect(tam.locked).toBe(false)
    expect(tam.gapPct).toBeCloseTo(2, 9)
    expect(sat(97999999n).locked).toBe(true)
    expect(sat(98000001n).locked).toBe(false)
  })

  it('18 ondalik stable: sinir ayni', () => {
    expect(sat(98n * 10n ** 18n, 18).locked).toBe(false)
    expect(sat(98n * 10n ** 18n - 1n, 18).locked).toBe(true)
  })
})

describe('priceGap: simetri ve kesirli referans', () => {
  it('ayni sayilarla Al/Sat gap isaretleri ters', () => {
    const girdi = { payAmount: 101000000n, stockAmount: ONE, reference: 100, payDecimals: 6, stockDecimals: 18 }
    const a = priceGap({ side: 'buy', ...girdi })
    const s = priceGap({ side: 'sell', ...girdi })
    expect(a.gapPct).toBeCloseTo(1, 9)
    expect(s.gapPct).toBeCloseTo(-1, 9)
  })

  it('ref 776.86 (rm 776860000): sinir 1 atomda dogru, Al ve Sat', () => {
    // Al: 776.86 * 1.02 = 792.3972 USDC -> 792397200
    const alGir = { side: 'buy', stockAmount: ONE, reference: 776.86, payDecimals: 6, stockDecimals: 18 }
    expect(priceGap({ ...alGir, payAmount: 792397200n }).locked).toBe(false)
    expect(priceGap({ ...alGir, payAmount: 792397201n }).locked).toBe(true)
    // Sat: 776.86 * 0.98 = 761.3228 USDC -> 761322800
    const satGir = { side: 'sell', stockAmount: ONE, reference: 776.86, payDecimals: 6, stockDecimals: 18 }
    expect(priceGap({ ...satGir, payAmount: 761322800n }).locked).toBe(false)
    expect(priceGap({ ...satGir, payAmount: 761322799n }).locked).toBe(true)
  })

  it('esik PRICE_PROTECTION_BPS sabitinden gelir (yuzde 2): 102.5 kilitli, 102.9 de', () => {
    expect(PRICE_PROTECTION_BPS).toBe(200)
    // yuzde 2.5 ve 2.9 fark: sabit 103 yazilsaydi (yuzde 3) 102.5 kilitlenmezdi
    for (const p of [102500000n, 102900000n]) {
      const r = priceGap({ side: 'buy', payAmount: p, stockAmount: ONE, reference: 100, payDecimals: 6, stockDecimals: 18 })
      expect(r.locked).toBe(true)
    }
  })

  it('referans null/0/NaN -> null (kapi atlandi, kilit degil)', () => {
    for (const reference of [null, 0, NaN, undefined]) {
      expect(priceGap({ side: 'buy', payAmount: 1n, stockAmount: 1n, reference, payDecimals: 6, stockDecimals: 18 })).toBeNull()
    }
  })

  it('gecersiz taraf + referans yok: referans kontrolu ONCE gelir, null doner (kapi atlandi); referans VARKEN ayni taraf firlatir', () => {
    const t = { payAmount: 1n, stockAmount: ONE, payDecimals: 6, stockDecimals: 18 }
    for (const reference of [null, undefined, 0, NaN]) {
      for (const side of ['x', undefined, null, 'BUY']) expect(priceGap({ side, reference, ...t })).toBeNull()
    }
    // ayni gecersiz taraf referans varken sessizce gecmez
    for (const side of ['x', undefined, null, 'BUY']) expect(kod(() => priceGap({ side, reference: 100, ...t }))).toBe('BAD_QUOTE_RESPONSE')
  })

  it('gecersiz miktar ya da taraf sessizce gecmez, firlatir', () => {
    const t = { reference: 100, payDecimals: 6, stockDecimals: 18 }
    expect(kod(() => priceGap({ side: 'buy', payAmount: 0n, stockAmount: ONE, ...t }))).toBe('BAD_QUOTE_RESPONSE')
    expect(kod(() => priceGap({ side: 'x', payAmount: 1n, stockAmount: ONE, ...t }))).toBe('BAD_QUOTE_RESPONSE')
  })
})

describe('feeBreakdown', () => {
  it('Al vektoru', () => {
    const f = feeBreakdown({ side: 'buy', amounts: AL, payDecimals: 6 })
    expect(f.networkUsd).toBe(1.407872)
    expect(f.cowUsd).toBe(0.019718)
    expect(f.watsUsd).toBe(0.099999)
    expect(f.totalUsd).toBeCloseTo(1.527589, 6)
    expect(f.networkSharePct).toBeCloseTo(1.407872, 6)
  })

  it('Sat vektoru', () => {
    const f = feeBreakdown({ side: 'sell', amounts: SAT, payDecimals: 6 })
    expect(f.networkUsd).toBe(1.528112)
    expect(f.cowUsd).toBe(0.076115)
    expect(f.watsUsd).toBe(0.382104)
    expect(f.totalUsd).toBeCloseTo(1.986331, 6)
    expect(f.networkSharePct).toBeCloseTo(0.3999, 3)
  })

  it('totalUsd uc kalemin toplami', () => {
    for (const [side, amounts] of [
      ['buy', AL],
      ['sell', SAT],
    ]) {
      const f = feeBreakdown({ side, amounts, payDecimals: 6 })
      expect(f.totalUsd).toBeCloseTo(f.networkUsd + f.cowUsd + f.watsUsd, 9)
      expect(f.totalUsd).toBeGreaterThan(f.networkUsd)
    }
  })

  it('BSC 18 ondalik odeme: USD degeri ayni olcekte', () => {
    const k = 10n ** 12n
    const f = feeBreakdown({
      side: 'sell',
      amounts: { ...SAT, networkCostB: 1528112n * k, protocolFee: 76115n * k, partnerFee: 382104n * k, spotBuy: 382104227n * k },
      payDecimals: 18,
    })
    expect(f.networkUsd).toBeCloseTo(1.528112, 6)
    expect(f.totalUsd).toBeCloseTo(1.986331, 6)
  })
})

describe('buildDisplay', () => {
  it('Al vektoru, ref 378', () => {
    const d = buildDisplay({ side: 'buy', amounts: AL, reference: 378, payDecimals: 6, stockDecimals: 18 })
    expect(d.unitPrice).toBeCloseTo(379.9672, 4)
    // gapPct ag ucreti (1,41 USD) HARIC fiyattan: 98,59 / 0,26318 = 374,6 -> ref 378'e gore -%0,89
    expect(d.gapPct).toBeCloseTo(-0.8948, 3)
    expect(d.locked).toBe(false)
    expect(d.lockReason).toBeNull()
    expect(d.sellAmount).toBe('100000000')
    expect(d.expectedBuy).toBe('263180599507050536')
    expect(d.minBuy).toBe('261864696509515284')
    expect(d.sellDecimals).toBe(6)
    expect(d.buyDecimals).toBe(18)
    expect(d.referencePrice).toBe(378)
    expect(d.side).toBe('buy')
    expect(() => JSON.stringify(d)).not.toThrow()
    expect(JSON.parse(JSON.stringify(d)).sellAmount).toBe('100000000')
  })

  it('Sat vektoru, ref 381', () => {
    const d = buildDisplay({ side: 'sell', amounts: SAT, reference: 381, payDecimals: 6, stockDecimals: 18 })
    expect(d.unitPrice).toBeCloseTo(380.1179, 4)
    // ag ucreti (0,004 hisse) haric: 380,12 / 0,996 = 381,64 -> ref 381e gore -%0,17
    expect(d.gapPct).toBeCloseTo(-0.1692, 3)
    expect(d.locked).toBe(false)
    expect(d.sellAmount).toBe('1000000000000000000')
    expect(d.sellDecimals).toBe(18)
    expect(d.buyDecimals).toBe(6)
    expect(d.fees.watsUsd).toBe(0.382104)
    expect(() => JSON.stringify(d)).not.toThrow()
  })

  it('kilitli teklif de modele yazilir (K12)', () => {
    const d = buildDisplay({
      side: 'buy',
      amounts: { ...AL, S: 105000000n, expectedBuy: ONE }, // ucret haric 103,59 -> +%3,59
      reference: 100,
      payDecimals: 6,
      stockDecimals: 18,
    })
    expect(d.locked).toBe(true)
    expect(d.lockReason).toBe(LOCK_REASON.PRICE_PROTECTION)
  })

  it('referans null/gecersiz -> REFERENCE_MISSING firlatir', () => {
    for (const reference of [null, 0, NaN]) {
      expect(kod(() => buildDisplay({ side: 'buy', amounts: AL, reference, payDecimals: 6, stockDecimals: 18 }))).toBe(
        'REFERENCE_MISSING',
      )
    }
  })
})

// 2026-10-21 kullanici karari: ag ucreti %2 fiyat korumasindan ayrildi; ucret emir degerinin %10'unu asarsa YALNIZ feeWarning (kilit YOK).
// Vektorler elle kurulur (ref 100): Al = 10 USDC odenir; Sat = 0.1 hisse (10 USD) satilir.
describe('tradeGate: ag ucreti fiyat korumasindan ayri (Al)', () => {
  const al = (ek = {}) =>
    tradeGate({
      side: 'buy',
      sellAmount: 10000000n,
      networkFee: 600000n,
      expectedBuy: 93532338308457711n, // 9.4 USDC / 100.5 = spot +%0,5
      reference: 100,
      payDecimals: 6,
      stockDecimals: 18,
      ...ek,
    })

  it('spot +%0,5 ve ag ucreti %6 -> KILITSIZ, ucret alanlari dogru', () => {
    const g = al()
    expect(g.locked).toBe(false)
    expect(g.lockReason).toBeNull()
    expect(g.gapPct).toBeCloseTo(0.5, 3)
    expect(g.networkFeeUsd).toBe(0.6)
    expect(g.networkFeePct).toBeCloseTo(6, 6)
    expect(g.feeWarning).toBe(false)
  })

  it('ucret %12 -> KILITSIZ + feeWarning (fiyat sapmasi temiz)', () => {
    const g = al({ networkFee: 1200000n, expectedBuy: 87562189054726368n })
    expect(g.locked).toBe(false)
    expect(g.lockReason).toBeNull()
    expect(g.feeWarning).toBe(true)
    expect(g.gapPct).toBeCloseTo(0.5, 3)
    expect(g.networkFeeUsd).toBe(1.2)
    expect(g.networkFeePct).toBeCloseTo(12, 6)
  })

  it('ucret %35 -> kilitsiz + uyari', () => {
    const g = al({ networkFee: 3500000n, expectedBuy: 64676616915422885n })
    expect(g.locked).toBe(false)
    expect(g.lockReason).toBeNull()
    expect(g.feeWarning).toBe(true)
    expect(g.networkFeePct).toBeCloseTo(35, 6)
  })

  it('ucret %5 -> uyari yok', () => {
    const g = al({ networkFee: 500000n })
    expect(g.locked).toBe(false)
    expect(g.feeWarning).toBe(false)
  })

  it('spot 5 kat (kapali piyasa sisirmesi) -> PRICE_PROTECTION, ucret %6 olsa da', () => {
    const g = al({ expectedBuy: 18800000000000000n })
    expect(g.locked).toBe(true)
    expect(g.lockReason).toBe(LOCK_REASON.PRICE_PROTECTION)
    expect(g.gapPct).toBeCloseTo(400, 3)
  })

  it('hem fiyat hem ucret ihlalinde fiyat korumasi kilitler, uyari da yanar', () => {
    const g = al({ networkFee: 1200000n, expectedBuy: 17600000000000000n })
    expect(g.locked).toBe(true)
    expect(g.lockReason).toBe(LOCK_REASON.PRICE_PROTECTION)
    expect(g.feeWarning).toBe(true)
  })

  it('sinir: ucret tam %10 uyarisiz, 1 atom fazlasi uyarili (ikisi de kilitsiz)', () => {
    const ok = al({ networkFee: 1000000n, expectedBuy: 90000000000000000n })
    expect(ok.locked).toBe(false)
    expect(ok.feeWarning).toBe(false)
    const ust = al({ networkFee: 1000001n, expectedBuy: 90000000000000000n })
    expect(ust.locked).toBe(false)
    expect(ust.feeWarning).toBe(true)
  })

  it('FEE_TOO_HIGH artik kilit nedeni degil ve donusde minAmountUsdForFee yok', () => {
    expect(Object.hasOwn(LOCK_REASON, 'FEE_TOO_HIGH')).toBe(false)
    expect(al()).not.toHaveProperty('minAmountUsdForFee')
  })

  it('BSC 18 ondalik odeme: ayni kararlar', () => {
    const g = tradeGate({
      side: 'buy',
      sellAmount: 10n * 10n ** 18n,
      networkFee: 6n * 10n ** 17n,
      expectedBuy: 93532338308457711n,
      reference: 100,
      payDecimals: 18,
      stockDecimals: 18,
    })
    expect(g.locked).toBe(false)
    expect(g.networkFeeUsd).toBe(0.6)
    expect(g.feeWarning).toBe(false)
  })
})

describe('tradeGate: ag ucreti fiyat korumasindan ayri (Sat)', () => {
  const sat = (ek = {}) =>
    tradeGate({
      side: 'sell',
      sellAmount: 100000000000000000n, // 0.1 hisse = 10 USD
      networkFee: 6000000000000000n, // 0.006 hisse, hisse tokeninde
      expectedBuy: 9353000n, // 0.094 x 99.5 (spot -%0,5)
      reference: 100,
      payDecimals: 6,
      stockDecimals: 18,
      ...ek,
    })

  it('spot -%0,5 ve ag ucreti %6 -> KILITSIZ; ucret hisse tokeninde, USD referansla', () => {
    const g = sat()
    expect(g.locked).toBe(false)
    expect(g.gapPct).toBeCloseTo(0.5, 3)
    expect(g.networkFeeUsd).toBeCloseTo(0.6, 9)
    expect(g.networkFeePct).toBeCloseTo(6, 6)
    expect(g.feeWarning).toBe(false)
  })

  it('ucret USD degeri referansa baglidir (ref 200 -> 1.2 USD)', () => {
    const g = sat({ reference: 200, expectedBuy: 18706000n })
    expect(g.networkFeeUsd).toBeCloseTo(1.2, 9)
    expect(g.networkFeePct).toBeCloseTo(6, 6)
  })

  it('ucret %12 -> kilitsiz + feeWarning', () => {
    const g = sat({ networkFee: 12000000000000000n, expectedBuy: 8756000n })
    expect(g.locked).toBe(false)
    expect(g.lockReason).toBeNull()
    expect(g.feeWarning).toBe(true)
  })

  it('spot 5 kat dusuk (alici 1/5 oder) -> PRICE_PROTECTION', () => {
    const g = sat({ expectedBuy: 1880000n })
    expect(g.locked).toBe(true)
    expect(g.lockReason).toBe(LOCK_REASON.PRICE_PROTECTION)
  })

  it('sinir: ucret tam %10 uyarisiz, 1 atom fazlasi uyarili (ikisi de kilitsiz)', () => {
    const ok = sat({ networkFee: 10000000000000000n, expectedBuy: 9000000n })
    expect(ok.locked).toBe(false)
    expect(ok.feeWarning).toBe(false)
    const ust = sat({ networkFee: 10000000000000001n, expectedBuy: 9000000n })
    expect(ust.locked).toBe(false)
    expect(ust.feeWarning).toBe(true)
  })
})

describe('tradeGate: girdi dogrulamasi ve sabit', () => {
  it('esik sabiti 10 (yuzde)', () => {
    expect(NETWORK_FEE_WARN_PCT).toBe(10)
  })

  it('referans yok -> REFERENCE_MISSING, gecersiz tutar -> BAD_QUOTE_RESPONSE', () => {
    const base = { side: 'buy', sellAmount: 10000000n, networkFee: 600000n, expectedBuy: 93532338308457711n, payDecimals: 6, stockDecimals: 18 }
    expect(kod(() => tradeGate({ ...base, reference: null }))).toBe('REFERENCE_MISSING')
    for (const ek of [{ networkFee: 10000000n }, { networkFee: -1n }, { sellAmount: 0n }, { expectedBuy: 0n }, { networkFee: '6' }]) {
      expect(kod(() => tradeGate({ ...base, reference: 100, ...ek }))).toBe('BAD_QUOTE_RESPONSE')
    }
  })

  it('buildDisplay ayni kapiyi kullanir: ucret alanlari + feeWarning modelde, kilit yok', () => {
    const amounts = { ...AL, S: 10000000n, networkFee: 1200000n, expectedBuy: 87562189054726368n }
    const d = buildDisplay({ side: 'buy', amounts, reference: 100, payDecimals: 6, stockDecimals: 18 })
    expect(d.locked).toBe(false)
    expect(d.lockReason).toBeNull()
    expect(d.feeWarning).toBe(true)
    expect(d.networkFeeUsd).toBe(1.2)
    expect(d.networkFeePct).toBeCloseTo(12, 6)
    expect(() => JSON.stringify(d)).not.toThrow()
  })
})

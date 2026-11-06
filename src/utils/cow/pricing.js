// CoW fiyat modeli: referans fiyat, birim fiyat, simetrik yuzde 2 kilidi, ucret dokumu ve
// ekranin TEK veri kaynagi olan goruntu modeli (spec 6.3, 8.3). Arayuz hesap YAPMAZ, bunu cizer.
// Kilit karari tam BigInt'tir (invariant 5); Number yalniz gosterimde (gapPct, unitPrice, USD).

import { formatUnits } from 'ethers'
import { PRICE_PROTECTION_BPS, NETWORK_FEE_WARN_PCT, LOCK_REASON } from './config'
import { unitPriceUsd } from '../stockPricing'

const fail = (code, msg) => Object.assign(new Error(msg || code), { code })

const BPS_BASE = 10000n
const MICRO = 10n ** 6n

/** CoinGecko ham fiyat / getCurrentMultiplier() = hisse basi USD. Gecersizse null. */
export function referenceFrom({ priceUsd, multiplier } = {}) {
  const ref = unitPriceUsd(priceUsd, multiplier)
  return Number.isFinite(ref) && ref > 0 ? ref : null
}

/** Number referans -> mikro-USD BigInt; gecersiz ya da 0'a yuvarlanan -> null. */
export function referenceMicro(reference) {
  if (typeof reference !== 'number' || !Number.isFinite(reference) || reference <= 0) return null
  const micro = Math.round(reference * 1e6)
  if (!Number.isFinite(micro) || micro <= 0) return null
  return BigInt(micro)
}

const usd = (amount, decimals) => Number(formatUnits(amount, decimals))

/** stable / hisse, ucretler DAHIL. Gecersiz (sifir/negatif/sonsuz) -> null. */
export function unitPrice({ payAmount, stockAmount, payDecimals, stockDecimals }) {
  if (typeof payAmount !== 'bigint' || typeof stockAmount !== 'bigint') return null
  if (payAmount <= 0n || stockAmount <= 0n) return null
  const p = usd(payAmount, payDecimals) / usd(stockAmount, stockDecimals)
  return Number.isFinite(p) && p > 0 ? p : null
}

/**
 * Al:  payAmount = S (odenen),           stockAmount = expectedBuy
 * Sat: payAmount = expectedBuy (alinan), stockAmount = S (satilan)
 * locked KESIN BigInt karsilastirmadir; tam sinir GECER, 1 atom fazlasi/azi kilitli.
 * Referans yoksa null ("kapi atlandi"; karari teklif oncesi preQuoteLock verir).
 */
export function priceGap({ side, payAmount, stockAmount, reference, payDecimals, stockDecimals }) {
  const rm = referenceMicro(reference)
  if (rm === null) return null
  if (side !== 'buy' && side !== 'sell') throw fail('BAD_QUOTE_RESPONSE')
  const birim = unitPrice({ payAmount, stockAmount, payDecimals, stockDecimals })
  if (birim === null) throw fail('BAD_QUOTE_RESPONSE')

  const bps = BigInt(PRICE_PROTECTION_BPS)
  const lhs = payAmount * MICRO * BPS_BASE * 10n ** BigInt(stockDecimals)
  const base = stockAmount * rm * 10n ** BigInt(payDecimals)
  const locked = side === 'buy' ? lhs > base * (BPS_BASE + bps) : lhs < base * (BPS_BASE - bps)
  const gapPct = side === 'buy' ? (birim / reference - 1) * 100 : (1 - birim / reference) * 100
  return { gapPct, locked }
}

const isBig = (v) => typeof v === 'bigint'

/**
 * Ortak kilit kapisi (quote() VE placeOrder() ayni fonksiyonu kullanir, K7 tutarliligi).
 * 2026-10-21 kullanici karari: ag ucreti %2 fiyat korumasindan AYRILDI.
 *  - Fiyat sapmasi (simetrik %2) YALNIZ ag ucreti (feeAmount) HARIC fiyattan hesaplanir; yuzdesel ucretler
 *    (Wats partner, CoW protokol) expectedBuy icinde kalir.
 *  - Ag ucreti emir degerinin NETWORK_FEE_WARN_PCT yuzdesini asarsa feeWarning = true; bu bir KILIT DEGILDIR
 *    (kullanici istedigi miktarda alir, ucret ayri satirda gosterilir).
 *    Kilit nedenleri yalniz fiyat korumasidir; placeOrder da ucret yuzunden reddetmez.
 * Girdi atomlari: sellAmount = S (ucret DAHIL satilan), networkFee = CoW feeAmount (SAT TOKENINDE:
 * Al'da stable, Sat'ta hisse), expectedBuy = alinan token. Karar tam BigInt; Number yalniz gosterim.
 */
export function tradeGate({ side, sellAmount, networkFee, expectedBuy, reference, payDecimals, stockDecimals } = {}) {
  const rm = referenceMicro(reference)
  if (rm === null) throw fail('REFERENCE_MISSING')
  if (side !== 'buy' && side !== 'sell') throw fail('BAD_QUOTE_RESPONSE')
  if (!isBig(sellAmount) || !isBig(networkFee) || !isBig(expectedBuy)) throw fail('BAD_QUOTE_RESPONSE')
  if (sellAmount <= 0n || expectedBuy <= 0n || networkFee < 0n || networkFee >= sellAmount) {
    throw fail('BAD_QUOTE_RESPONSE')
  }
  const buy = side === 'buy'

  // fiyat: ag ucreti haric satilan miktar (qs = S - feeAmount)
  const qs = sellAmount - networkFee
  const gap = priceGap({
    side,
    payAmount: buy ? qs : expectedBuy,
    stockAmount: buy ? expectedBuy : qs,
    reference,
    payDecimals,
    stockDecimals,
  })

  // ucret: yuzde sat tokeninde (referans sadelesir); USD Al'da stable 1:1, Sat'ta hisse x referans
  const feeWarning = networkFee * 100n > sellAmount * BigInt(NETWORK_FEE_WARN_PCT)
  const feeNum = buy ? networkFee : networkFee * rm
  const networkFeeUsd = Number(formatUnits(feeNum, buy ? payDecimals : stockDecimals + 6))
  const networkFeePct = Number((networkFee * MICRO) / sellAmount) / 10000

  const lockReason = gap.locked ? LOCK_REASON.PRICE_PROTECTION : null
  return { locked: lockReason !== null, lockReason, gapPct: gap.gapPct, networkFeeUsd, networkFeePct, feeWarning }
}

/** amounts = computeAmounts() ciktisi; tum degerler stable USD (Number, yaklasik). */
export function feeBreakdown({ side, amounts, payDecimals }) {
  const { S, networkFee, networkCostB, protocolFee, spotBuy, partnerFee } = amounts
  let network
  let cow
  let wats
  let base
  if (side === 'buy') {
    network = networkFee
    cow = (protocolFee * S) / spotBuy
    wats = (partnerFee * S) / spotBuy
    base = S
  } else {
    network = networkCostB
    cow = protocolFee
    wats = partnerFee
    base = spotBuy
  }
  const networkUsd = usd(network, payDecimals)
  const cowUsd = usd(cow, payDecimals)
  const watsUsd = usd(wats, payDecimals)
  const baseUsd = usd(base, payDecimals)
  return {
    networkUsd,
    cowUsd,
    watsUsd,
    totalUsd: networkUsd + cowUsd + watsUsd,
    networkSharePct: baseUsd > 0 ? (networkUsd / baseUsd) * 100 : 0,
  }
}

/** Mesaj-guvenli (BigInt YOK) goruntu modeli. Referanssiz model kurulmaz. */
export function buildDisplay({ side, amounts, reference, payDecimals, stockDecimals }) {
  const buy = side === 'buy'
  const payAmount = buy ? amounts.S : amounts.expectedBuy
  const stockAmount = buy ? amounts.expectedBuy : amounts.S
  // kilit karari ortak kapidan (tradeGate); birim fiyat ucretler DAHIL kalir (kullanicinin odedigi)
  const gate = tradeGate({
    side,
    sellAmount: amounts.S,
    networkFee: amounts.networkFee,
    expectedBuy: amounts.expectedBuy,
    reference,
    payDecimals,
    stockDecimals,
  })
  return {
    side,
    sellAmount: String(amounts.S),
    sellDecimals: buy ? payDecimals : stockDecimals,
    expectedBuy: String(amounts.expectedBuy),
    minBuy: String(amounts.minBuy),
    buyDecimals: buy ? stockDecimals : payDecimals,
    unitPrice: unitPrice({ payAmount, stockAmount, payDecimals, stockDecimals }),
    referencePrice: reference,
    gapPct: gate.gapPct,
    fees: feeBreakdown({ side, amounts, payDecimals }),
    networkFeeUsd: gate.networkFeeUsd,
    networkFeePct: gate.networkFeePct,
    feeWarning: gate.feeWarning,
    locked: gate.locked,
    lockReason: gate.lockReason,
  }
}

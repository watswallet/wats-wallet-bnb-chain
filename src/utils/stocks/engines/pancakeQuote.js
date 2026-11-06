// bStocks (PancakeSwap) teklifi -> ortak QuoteResponse/display (spec 7.4). SAF modul: chrome, ag, RPC,
// cuzdan YOK. `SWAP_QUOTE` yaniti (`swapManager.getExpectedOutput` ciktisi) ve istek baglami girer, CoW
// `service.quote` ile ayni sekilli, mesaj-guvenli (BigInt YOK) bir sonuc cikar.
//
// BIRIM SINIRI (spec 8): tutarlar HEP UI birimi dizesidir. `SWAP_QUOTE.message.amount` ve `expectedOutput` /
// `minimumReceived` UI birimindedir: girdi tarafini `toRawSpendAmount`, bStock CIKTISI (Al) tarafini
// `toUiReceiveAmount` cevirir (ikisi de swap.getExpectedOutput icinde; A-1: eskiden cikti HAM kaliyordu); burada
// hicbir carpan okunmaz ya da uygulanmaz. Atom degerleri `parseUnits(UI dizesi, 18)` (UI-atom): HAM atom DEGIL.
//
// KILIT POLITIKASI (patron S1 + TK10): bStocks'ta referans fiyat kilidi ve kapali piyasa kilidi YOKTUR.
// `gapPct` yalniz bilgidir (|fark| >= %2 -> `gapWarn`). Yuksek fiyat etkisi (> %5) teklifi KILITLEMEZ; kapi
// ekranda onay kutusudur (`priceImpactBlocked`). Bu yuzden `locked` her zaman false'tur.
//
// AG UCRETI (P1/P2): CoW'un ayri "ag ucreti" satiri (networkFeeUsd/Pct, minAmountUsdForFee) bStocks'ta YOKTUR;
// alanlar null kalir. bStocks'un ATS ucreti ayri kartta (`fees.kind === 'ats'`) gosterilir ve fiyat
// korumasina girmez (zaten korumasi yok).
//
// `exchangeRate` KULLANILMAZ: birim fiyat kendi tutarlarimizdan hesaplanir (toFixed(6) yuvarlamasi 6
// ondaligin altindaki fiyatlari bozar ve yonu (Al/Sat) bilmez).

import { formatUnits, parseUnits } from 'ethers'
import { MAX_PRICE_IMPACT_PERCENT, parsePriceImpactPercent } from '../../swapRoutes'
import { ENGINE_ERROR } from './errors'

/** Teklif omru (spec 7.3 adim 5); `useCowQuote` yenilemeyi `expiresAt`ta yapar. */
export const PANCAKE_QUOTE_TTL_MS = 30000
/** Referanstan sapma bu yuzdeye ulasirsa sari uyari (bilgi; kilit degil). */
export const REFERENCE_GAP_WARN_PCT = 2

const UI_DECIMALS = 18
// birim fiyat olcegi: 1e-8 USD (BigInt bolme, Number'a yalniz sonuc cevrilir)
const PRICE_SCALE = 10n ** 8n

const fail = (code) => ({ success: false, code })
const NOT_NUMBER = /^(\d*)(?:\.(\d*))?$/

/** UI ondalik dizesi -> 18 ondalikli atom (BigInt). Gecersiz (rakam yok, ussel, isaretli, dize degil) -> null. */
function uiToAtoms(value) {
  if (typeof value !== 'string') return null
  const m = NOT_NUMBER.exec(value.trim())
  if (!m) return null
  const whole = m[1] ?? ''
  const frac = (m[2] ?? '').slice(0, UI_DECIMALS)
  if (whole === '' && frac === '') return null
  return parseUnits(`${whole || '0'}.${frac || '0'}`, UI_DECIMALS)
}

const isRef = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0

/** pay/stock, ucretler dahil kullanicinin odedigi/aldigi birim fiyat (USD). Olculemezse null. */
function unitPriceOf(payAtoms, stockAtoms) {
  if (payAtoms <= 0n || stockAtoms <= 0n) return null
  const scaled = (payAtoms * PRICE_SCALE) / stockAtoms
  if (scaled <= 0n) return null
  return Number(scaled) / Number(PRICE_SCALE)
}

/** Pozitif = kullanici referanstan KOTU durumda (Al: fazla oder, Sat: eksik alir). Yalniz bilgi. */
function gapOf(side, unitPrice, reference) {
  if (unitPrice === null || !isRef(reference)) return null
  const ratio = unitPrice / reference
  return side === 'buy' ? (ratio - 1) * 100 : (1 - ratio) * 100
}

function priceImpactOf(raw) {
  const pct = parsePriceImpactPercent(raw)
  return { pct, high: pct !== null && pct > MAX_PRICE_IMPACT_PERCENT, unmeasured: pct === null }
}

// '0.25%' gibi saglayici ucreti dizesi; sayisal degilse null (uydurma deger yok)
function lpFeeOf(raw) {
  return typeof raw === 'string' && /^\d+(?:\.\d+)?%$/.test(raw.trim()) ? raw.trim() : null
}

// ATS ucret tutarlari ekranin useAtsOpFee sonucundan gelir (insan birimi dizeleri); gecersizse null.
function atsFeesOf(atsFees) {
  const transfer = uiToAtoms(atsFees?.transfer)
  const commission = uiToAtoms(atsFees?.commission)
  if (transfer === null || commission === null) return { transfer: null, commission: null, total: null }
  return {
    transfer: atsFees.transfer,
    commission: atsFees.commission,
    total: formatUnits(transfer + commission, UI_DECIMALS),
  }
}

/**
 * @param {object} data SWAP_QUOTE yanitinin `data` alani (expectedOutput, minimumReceived, priceImpact, ...)
 * @param {{side:'buy'|'sell', amount:string, referencePrice?:number|null, quoteId:string, now?:number,
 *          ttlMs?:number, atsFees?:{transfer:string, commission:string}}} ctx
 *   amount: Al'da odenecek stable, Sat'ta satilacak hisse adedi (UI dizesi, SWAP_QUOTE'a giden AYNI deger).
 * @returns {{success:true, ...}|{success:false, code:string}} asla firlatmaz
 */
export function toQuoteResponse(data, ctx = {}) {
  try {
    const { side, amount, referencePrice, quoteId, now = Date.now(), ttlMs = PANCAKE_QUOTE_TTL_MS, atsFees } = ctx
    if (side !== 'buy' && side !== 'sell') return fail(ENGINE_ERROR.BAD_QUOTE_RESPONSE)
    if (typeof quoteId !== 'string' || quoteId === '') return fail(ENGINE_ERROR.BAD_QUOTE_RESPONSE)
    if (!data || typeof data !== 'object') return fail(ENGINE_ERROR.BAD_QUOTE_RESPONSE)

    const spend = uiToAtoms(amount)
    const expected = uiToAtoms(data.expectedOutput)
    const minimum = uiToAtoms(data.minimumReceived)
    if (spend === null || spend <= 0n) return fail(ENGINE_ERROR.BAD_QUOTE_RESPONSE)
    if (expected === null || expected <= 0n) return fail(ENGINE_ERROR.BAD_QUOTE_RESPONSE)
    if (minimum === null || minimum > expected) return fail(ENGINE_ERROR.BAD_QUOTE_RESPONSE)

    const buy = side === 'buy'
    const unitPrice = buy ? unitPriceOf(spend, expected) : unitPriceOf(expected, spend)
    const reference = isRef(referencePrice) ? referencePrice : null
    const gapPct = gapOf(side, unitPrice, reference)
    const router = data.routerType
    const routerLabel = router && typeof router.name === 'string' ? `${router.name} v${router.version}` : null

    const display = {
      engine: 'pancake',
      side,
      sellAmount: spend.toString(),
      sellDecimals: UI_DECIMALS,
      expectedBuy: expected.toString(),
      minBuy: minimum.toString(),
      buyDecimals: UI_DECIMALS,
      unitPrice,
      referencePrice: reference,
      gapPct,
      gapWarn: gapPct !== null && Math.abs(gapPct) >= REFERENCE_GAP_WARN_PCT,
      priceImpact: priceImpactOf(data.priceImpact),
      fees: { kind: 'ats', ...atsFeesOf(atsFees), lpFeePct: lpFeeOf(data.liquidityProviderFee) },
      networkFeeUsd: null,
      networkFeePct: null,
      minAmountUsdForFee: null,
      routerLabel,
      locked: false,
      lockReason: null,
    }

    return {
      success: true,
      locked: false,
      quoteId,
      expiresAt: now + ttlMs,
      display,
      approval: { mode: 'none' },
      reference,
      notice: null,
      warnings: [],
    }
  } catch {
    return fail(ENGINE_ERROR.BAD_QUOTE_RESPONSE)
  }
}

/**
 * Fiyat etkisi onay kapisi (ekranin onay kutusu): etki yuksekse ve kullanici onaylamadiysa islem engellenir.
 * Olculemeyen etki ENGELLEMEZ (Swap.vue ile ayni; ekran ayrica "olculemedi" uyarisi gosterir).
 * @returns {{blocked:boolean, code:string|null}}
 */
export function priceImpactBlocked(priceImpact, acknowledged) {
  const blocked = priceImpact?.high === true && acknowledged !== true
  return { blocked, code: blocked ? ENGINE_ERROR.PRICE_IMPACT_HIGH : null }
}

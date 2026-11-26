// Motor hata sozlesmesi (spec 7.5): CoW kodlari AYNEN + pancake'e ozgu eklemeler + LCX hisse (RWA) eklemeleri. Kapali kume.
import { COW_ERROR } from '../../cow/errors'

/** Yalniz pancake (bStocks) motorunun ekledigi kodlar; CoW ile ortak olanlar (NO_LIQUIDITY, AMOUNT_TOO_SMALL, ...) COW_ERROR'dadir. */
export const PANCAKE_ERROR_CODES = Object.freeze([
  'NO_ROUTE',
  'MULTIPLIER_UNREADABLE',
  'PRICE_IMPACT_HIGH',
  'ATS_BLOCKED',
  'SWAP_FAILED',
  'SWAP_REVERTED',
  'CHAIN_UNSUPPORTED',
])

/**
 * Yalniz LCX hisse (RWA) motorunun ekledigi kodlar (Bolum 2, Gorev 7). Eslesme tablosu lcxEngine.js'tedir; SWAP_REVERTED, NO_ROUTE,
 * QUOTE_EXPIRED, INSUFFICIENT_BALANCE ve STOCK_GATE mevcut kodlardir ve yeniden kullanilir.
 */
export const LCX_ERROR_CODES = Object.freeze([
  'REF_PRICE_OFF',
  'NO_REFERENCE_PRICE',
  'INSUFFICIENT_LIQUIDITY',
  'RWA_EXCLUDED',
  'ISSUER_MISMATCH',
  'LCX_UNAVAILABLE',
  'LCX_TX_REJECTED',
])

export const ENGINE_ERROR = Object.freeze({
  ...COW_ERROR,
  ...Object.fromEntries(PANCAKE_ERROR_CODES.map((k) => [k, k])),
  ...Object.fromEntries(LCX_ERROR_CODES.map((k) => [k, k])),
})

export const isEngineCode = (code) => typeof code === 'string' && Object.hasOwn(ENGINE_ERROR, code)

export const engineErrorKey = (code) => `stockTrade.error.${isEngineCode(code) ? code : 'UNKNOWN'}`

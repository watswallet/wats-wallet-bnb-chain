// Motor hata sozlesmesi (spec 7.5): CoW kodlari AYNEN + pancake'e ozgu eklemeler. Kapali kume.
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

export const ENGINE_ERROR = Object.freeze({
  ...COW_ERROR,
  ...Object.fromEntries(PANCAKE_ERROR_CODES.map((k) => [k, k])),
})

export const isEngineCode = (code) => typeof code === 'string' && Object.hasOwn(ENGINE_ERROR, code)

export const engineErrorKey = (code) => `stockTrade.error.${isEngineCode(code) ? code : 'UNKNOWN'}`

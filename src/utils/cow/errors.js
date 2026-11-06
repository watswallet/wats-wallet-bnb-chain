// CoW hata sozlesmesi (K13): kapali kod kumesi + HTTP/ag hatasi siniflandirmasi. Saf modul.
// CoW errorType dizeleri `services` kaynagindan alindi, canli yanitla DOGRULANMADI (Task 28 yalniz teklif hatalarini gorur).
import { LOCK_REASON } from './config'

const KODLAR = [
  // kilit (config.LOCK_REASON ile ayni degerler)
  ...Object.values(LOCK_REASON),
  // istek / durum
  'XSTOCKS_DISABLED', 'INVALID_REQUEST', 'UNSUPPORTED_CHAIN', 'UNSUPPORTED_TOKEN', 'WALLET_LOCKED', 'ACCOUNT_CHANGED',
  'QUOTE_NOT_FOUND', 'QUOTE_EXPIRED', 'QUOTE_USED', 'QUOTE_LOCKED', 'QUOTE_MISMATCH', 'APPROVAL_REQUIRED',
  'BAD_QUOTE_RESPONSE', 'BAD_RESPONSE', 'DECIMALS_UNAVAILABLE', 'PARTNER_FEE_RECIPIENT_MISSING',
  'PERMIT_DOMAIN_MISMATCH', 'DOMAIN_MISMATCH', 'SIGNATURE_MISMATCH', 'INVALID_ORDER', 'INVALID_HOOK', 'UID_MISMATCH',
  // CoW
  'NO_LIQUIDITY', 'AMOUNT_TOO_SMALL', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_ALLOWANCE', 'FORBIDDEN', 'RATE_LIMITED',
  'NETWORK', 'TIMEOUT', 'SERVER', 'CLOCK_SKEW', 'ORDER_NOT_FOUND', 'DUPLICATED_ORDER', 'REJECTED',
  // bilinmeyen kodun i18n yedegi
  'UNKNOWN',
]

export const COW_ERROR = Object.freeze(Object.fromEntries(KODLAR.map((k) => [k, k])))

export const isCowCode = (code) => typeof code === 'string' && Object.hasOwn(COW_ERROR, code)

export const cowErrorKey = (code) => `stockTrade.error.${isCowCode(code) ? code : 'UNKNOWN'}`

// order.js yerel fail ile AYNI sekil (Error + code); detail yalniz verilirse eklenir.
export function codedError(code, detail) {
  const err = Object.assign(new Error(code), { code })
  if (detail !== undefined) err.detail = detail
  return err
}

const ERROR_TYPE_CODE = Object.freeze({
  DuplicatedOrder: COW_ERROR.DUPLICATED_ORDER,
  InsufficientBalance: COW_ERROR.INSUFFICIENT_BALANCE,
  InsufficientAllowance: COW_ERROR.INSUFFICIENT_ALLOWANCE,
  NoLiquidity: COW_ERROR.NO_LIQUIDITY,
  InsufficientLiquidity: COW_ERROR.NO_LIQUIDITY,
  SellAmountDoesNotCoverFee: COW_ERROR.AMOUNT_TOO_SMALL,
  UnsupportedToken: COW_ERROR.UNSUPPORTED_TOKEN,
  ExcessiveValidTo: COW_ERROR.CLOCK_SKEW,
  InsufficientValidTo: COW_ERROR.CLOCK_SKEW,
})

const RETRYABLE = new Set([COW_ERROR.TIMEOUT, COW_ERROR.NETWORK, COW_ERROR.RATE_LIMITED, COW_ERROR.SERVER])
const DETAIL_MAX = 64

const result = (code, detail) => {
  const out = { code, retryable: RETRYABLE.has(code) }
  if (detail !== undefined) out.detail = detail
  return out
}

/**
 * HTTP / ag sonucunu kapali koda cevirir. Oncelik: timedOut, networkError, 403, 429, >=500, errorType, 404, kalan 4xx.
 * @param {{ context: 'quote'|'order'|'orderGet'|'status'|'trades', status?: number, body?: any, networkError?: boolean, timedOut?: boolean }} girdi
 * @returns {{ code: string, retryable: boolean, detail?: string }}
 */
export function classifyCowError({ context, status, body, networkError, timedOut } = {}) {
  if (timedOut) return result(COW_ERROR.TIMEOUT)
  if (networkError) return result(COW_ERROR.NETWORK)
  if (status === 403) return result(COW_ERROR.FORBIDDEN)
  if (status === 429) return result(COW_ERROR.RATE_LIMITED)
  if (typeof status === 'number' && status >= 500) return result(COW_ERROR.SERVER)

  const type = typeof body?.errorType === 'string' ? body.errorType.slice(0, DETAIL_MAX) : undefined
  if (type !== undefined && Object.hasOwn(ERROR_TYPE_CODE, type)) return result(ERROR_TYPE_CODE[type])

  if (status === 404) {
    if (context === 'quote') return result(COW_ERROR.NO_LIQUIDITY)
    if (context === 'orderGet' || context === 'status' || context === 'trades') return result(COW_ERROR.ORDER_NOT_FOUND)
    return result(COW_ERROR.REJECTED, type)
  }
  if (typeof status === 'number' && status >= 400) return result(COW_ERROR.REJECTED, type)
  return result(COW_ERROR.BAD_RESPONSE)
}

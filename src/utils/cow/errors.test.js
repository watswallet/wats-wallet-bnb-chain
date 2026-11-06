// CoW hata sozlesmesi (K13): kapali kod kumesi, i18n anahtari, HTTP/ag hatasi siniflandirmasi.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { COW_ERROR, isCowCode, cowErrorKey, codedError, classifyCowError } from './errors'

const KLASOR = path.dirname(fileURLToPath(import.meta.url))

const BEKLENEN_KODLAR = [
  // kilit
  'PRICE_PROTECTION', 'REFERENCE_MISSING', 'MARKET_CLOSED', 'MARKET_UNKNOWN', 'FEE_DEBT',
  // istek / durum
  'XSTOCKS_DISABLED', 'INVALID_REQUEST', 'UNSUPPORTED_CHAIN', 'UNSUPPORTED_TOKEN', 'WALLET_LOCKED', 'ACCOUNT_CHANGED',
  'QUOTE_NOT_FOUND', 'QUOTE_EXPIRED', 'QUOTE_USED', 'QUOTE_LOCKED', 'QUOTE_MISMATCH', 'APPROVAL_REQUIRED',
  'BAD_QUOTE_RESPONSE', 'BAD_RESPONSE', 'DECIMALS_UNAVAILABLE', 'PARTNER_FEE_RECIPIENT_MISSING',
  'PERMIT_DOMAIN_MISMATCH', 'DOMAIN_MISMATCH', 'SIGNATURE_MISMATCH', 'INVALID_ORDER', 'INVALID_HOOK', 'UID_MISMATCH',
  // CoW
  'NO_LIQUIDITY', 'AMOUNT_TOO_SMALL', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_ALLOWANCE', 'FORBIDDEN', 'RATE_LIMITED',
  'NETWORK', 'TIMEOUT', 'SERVER', 'CLOCK_SKEW', 'ORDER_NOT_FOUND', 'DUPLICATED_ORDER', 'REJECTED',
  // i18n yedegi
  'UNKNOWN',
]

describe('COW_ERROR kapali kume', () => {
  it('tam anahtar listesi (kume kilidi), anahtar === deger, dondurulmus', () => {
    expect(BEKLENEN_KODLAR).toHaveLength(41)
    expect(Object.keys(COW_ERROR).sort()).toEqual([...BEKLENEN_KODLAR].sort())
    for (const [k, v] of Object.entries(COW_ERROR)) expect(v).toBe(k)
    expect(Object.isFrozen(COW_ERROR)).toBe(true)
  })

  it('kaynak taramasi: cow/*.js icindeki fail / codedError / code literal lerinin hepsi COW_ERROR icinde', () => {
    const dosyalar = fs.readdirSync(KLASOR).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    expect(dosyalar).toEqual(expect.arrayContaining(['order.js', 'config.js', 'errors.js', 'api.js']))
    const bulunan = new Set()
    for (const dosya of dosyalar) {
      const kaynak = yorumsuz(fs.readFileSync(path.join(KLASOR, dosya), 'utf8'))
      for (const m of kaynak.matchAll(/\b(?:fail|codedError)\(\s*'([A-Z][A-Z_]*)'/g)) bulunan.add(m[1])
      for (const m of kaynak.matchAll(/\bcode:\s*'([A-Z][A-Z_]*)'/g)) bulunan.add(m[1])
    }
    // tarama bos kalirsa kilit anlamsiz olur: order.js bilinen bir kodu mutlaka bulunmali
    expect(bulunan.has('INVALID_HOOK')).toBe(true)
    const kume = new Set(Object.values(COW_ERROR))
    expect([...bulunan].filter((k) => !kume.has(k))).toEqual([])
  })
})

describe('isCowCode / cowErrorKey', () => {
  it('bilinen kod -> kendi anahtari', () => {
    expect(isCowCode('NO_LIQUIDITY')).toBe(true)
    expect(cowErrorKey('NO_LIQUIDITY')).toBe('stockTrade.error.NO_LIQUIDITY')
  })

  it('bilinmeyen / tipsiz / prototip anahtari -> UNKNOWN', () => {
    expect(cowErrorKey('HAYDI_BAKALIM')).toBe('stockTrade.error.UNKNOWN')
    expect(cowErrorKey(undefined)).toBe('stockTrade.error.UNKNOWN')
    expect(cowErrorKey('constructor')).toBe('stockTrade.error.UNKNOWN')
    expect(isCowCode('toString')).toBe(false)
  })
})

describe('codedError', () => {
  it('Error + code (+ detail), order.js fail ile ayni sekil', () => {
    const e = codedError('INVALID_ORDER', 'ayrinti')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('INVALID_ORDER')
    expect(e.detail).toBe('ayrinti')
    expect(e.message).toBe('INVALID_ORDER')
    expect('detail' in codedError('INVALID_ORDER')).toBe(false)
  })
})

describe('classifyCowError (spec 9)', () => {
  const c = (o) => classifyCowError(o)

  it('404 teklif -> NO_LIQUIDITY; 404 durum/islem -> ORDER_NOT_FOUND; 404 emir -> REJECTED', () => {
    expect(c({ context: 'quote', status: 404, body: null })).toMatchObject({ code: 'NO_LIQUIDITY', retryable: false })
    expect(c({ context: 'status', status: 404, body: null }).code).toBe('ORDER_NOT_FOUND')
    expect(c({ context: 'trades', status: 404, body: null }).code).toBe('ORDER_NOT_FOUND')
    expect(c({ context: 'order', status: 404, body: null }).code).toBe('REJECTED')
  })

  it('404 emir OKUMA (orderGet) -> ORDER_NOT_FOUND, yeniden denenmez', () => {
    expect(c({ context: 'orderGet', status: 404, body: null })).toMatchObject({ code: 'ORDER_NOT_FOUND', retryable: false })
  })

  it('errorType tablosu', () => {
    const t = (errorType, status = 400) => c({ context: 'order', status, body: { errorType } }).code
    expect(t('InsufficientLiquidity')).toBe('NO_LIQUIDITY')
    expect(t('NoLiquidity')).toBe('NO_LIQUIDITY')
    expect(t('InsufficientBalance')).toBe('INSUFFICIENT_BALANCE')
    expect(t('InsufficientAllowance')).toBe('INSUFFICIENT_ALLOWANCE')
    expect(t('SellAmountDoesNotCoverFee')).toBe('AMOUNT_TOO_SMALL')
    expect(t('UnsupportedToken')).toBe('UNSUPPORTED_TOKEN')
    expect(t('ExcessiveValidTo')).toBe('CLOCK_SKEW')
    expect(t('InsufficientValidTo')).toBe('CLOCK_SKEW')
    expect(t('DuplicatedOrder')).toBe('DUPLICATED_ORDER')
  })

  it('403 FORBIDDEN, 429 RATE_LIMITED, 5xx SERVER, timedOut, networkError', () => {
    expect(c({ context: 'quote', status: 403, body: null }).code).toBe('FORBIDDEN')
    expect(c({ context: 'quote', status: 429, body: null }).code).toBe('RATE_LIMITED')
    expect(c({ context: 'quote', status: 500, body: null }).code).toBe('SERVER')
    expect(c({ context: 'quote', status: 502, body: null }).code).toBe('SERVER')
    expect(c({ context: 'quote', timedOut: true }).code).toBe('TIMEOUT')
    expect(c({ context: 'quote', networkError: true }).code).toBe('NETWORK')
  })

  it('oncelik: timedOut > networkError > durum kodu > errorType', () => {
    expect(c({ context: 'quote', timedOut: true, networkError: true, status: 403 }).code).toBe('TIMEOUT')
    expect(c({ context: 'quote', networkError: true, status: 403 }).code).toBe('NETWORK')
    // 403 ve 5xx, errorType'tan once gelir
    expect(c({ context: 'order', status: 403, body: { errorType: 'DuplicatedOrder' } }).code).toBe('FORBIDDEN')
    expect(c({ context: 'order', status: 500, body: { errorType: 'DuplicatedOrder' } }).code).toBe('SERVER')
  })

  it('bilinmeyen 4xx -> REJECTED + detail = errorType', () => {
    expect(c({ context: 'order', status: 400, body: { errorType: 'GaripHata' } })).toEqual({
      code: 'REJECTED', retryable: false, detail: 'GaripHata',
    })
    expect(c({ context: 'order', status: 400, body: null }).code).toBe('REJECTED')
    expect(c({ context: 'order', status: 400, body: { errorType: 'constructor' } }).code).toBe('REJECTED')
  })

  it('retryable yalniz TIMEOUT / NETWORK / RATE_LIMITED / SERVER', () => {
    const cases = [
      [{ timedOut: true }, true], [{ networkError: true }, true], [{ status: 429 }, true], [{ status: 503 }, true],
      [{ status: 403 }, false], [{ status: 400, body: { errorType: 'DuplicatedOrder' } }, false],
      [{ status: 400, body: { errorType: 'InsufficientBalance' } }, false], [{ status: 404 }, false], [{ status: 418 }, false],
    ]
    for (const [girdi, beklenen] of cases) {
      expect(c({ context: 'quote', ...girdi }).retryable, JSON.stringify(girdi)).toBe(beklenen)
    }
  })
})

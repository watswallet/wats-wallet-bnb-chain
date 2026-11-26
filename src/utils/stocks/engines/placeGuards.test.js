// placeGuards.js: pancake ve lcx motorlarinin ortak, saf `place` parcalari (R8). Iki motorun `place`i uzerinden parite
// placeGuards.parity.test.js'te; burada fonksiyonlar DOGRUDAN sinanir.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { finitePositive, normalizeAtsQuoted, placeFail, sanitizeTokenData, send } from './placeGuards'

const ADDR = '0x55d398326f99059fF775485246999027B3197955'

afterEach(() => {
  delete globalThis.chrome
})

describe('finitePositive', () => {
  it('yalniz sonlu pozitif SAYI', () => {
    for (const v of [1, 0.5, 1e-9, 1e21]) expect(finitePositive(v)).toBe(true)
    for (const v of [0, -1, NaN, Infinity, -Infinity, '1', '', null, undefined, true, {}, [], 1n]) expect(finitePositive(v)).toBe(false)
  })
})

describe('placeFail', () => {
  it('{ ok:false, code } ve baska alan yok', () => {
    expect(placeFail('ATS_BLOCKED')).toEqual({ ok: false, code: 'ATS_BLOCKED' })
    expect(Object.keys(placeFail('X'))).toEqual(['ok', 'code'])
  })
})

describe('send', () => {
  it('chrome.runtime.sendMessage i CAGRI ANINDA okur ve yaniti dondurur', async () => {
    const fn = vi.fn(async () => ({ success: true }))
    globalThis.chrome = { runtime: { sendMessage: fn } }
    expect(await send({ type: 'SWAP', message: { a: 1 } })).toEqual({ success: true })
    expect(fn).toHaveBeenCalledWith({ type: 'SWAP', message: { a: 1 } })
    const fn2 = vi.fn(async () => 'ikinci')
    globalThis.chrome = { runtime: { sendMessage: fn2 } } // test arasi degisim: modul yukleme aninda yakalanmaz
    expect(await send({ type: 'X' })).toBe('ikinci')
  })
})

describe('normalizeAtsQuoted (ATS fail-closed kapisi)', () => {
  it('gecerli: ucret > 0, komisyon >= 0; sayi ve sayi dizesi; yalniz iki alan doner', () => {
    expect(normalizeAtsQuoted({ transferFee: 0.4, commissionFee: 0.1 })).toEqual({ transferFee: 0.4, commissionFee: 0.1 })
    expect(normalizeAtsQuoted({ transferFee: '0.4', commissionFee: '0' })).toEqual({ transferFee: 0.4, commissionFee: 0 })
    expect(normalizeAtsQuoted({ transferFee: ' 2 ', commissionFee: ' 0.5 ' })).toEqual({ transferFee: 2, commissionFee: 0.5 })
    expect(normalizeAtsQuoted({ transferFee: 1e-9, commissionFee: 0, evil: 1 })).toEqual({ transferFee: 1e-9, commissionFee: 0 })
  })
  it('gecersiz her sey null (SWAP gonderilmez)', () => {
    const bad = [
      undefined, null, 0, 1, '0.4', true, [], [0.4, 0.1], {},
      { transferFee: 0.4 }, { commissionFee: 0.1 },
      { transferFee: 0, commissionFee: 0 }, { transferFee: '0', commissionFee: 0 }, { transferFee: -1, commissionFee: 0 },
      { transferFee: 0.4, commissionFee: -0.01 }, { transferFee: NaN, commissionFee: 0 }, { transferFee: Infinity, commissionFee: 0 },
      { transferFee: 0.4, commissionFee: Infinity }, { transferFee: 'abc', commissionFee: 0 }, { transferFee: '1e3', commissionFee: 0 },
      { transferFee: '-1', commissionFee: 0 }, { transferFee: '0,4', commissionFee: 0 }, { transferFee: '', commissionFee: 0 },
      { transferFee: 0.4, commissionFee: ' ' }, { transferFee: true, commissionFee: 0 }, { transferFee: null, commissionFee: 0 },
      { transferFee: { v: 1 }, commissionFee: 0 }, { transferFee: 1n, commissionFee: 0 },
    ]
    for (const [i, v] of bad.entries()) expect(normalizeAtsQuoted(v), `satir ${i}`).toBeNull()
  })
})

describe('sanitizeTokenData (gecmis karti kimligi)', () => {
  it('veri yok -> null; nesne olmayan -> mismatch', () => {
    expect(sanitizeTokenData(undefined, ADDR)).toBeNull()
    expect(sanitizeTokenData(null, ADDR)).toBeNull()
    for (const v of ['x', 5, true, 1n]) expect(sanitizeTokenData(v, ADDR)).toBe('mismatch')
  })
  it('adres verilmisse islemin adresiyle (buyuk / kucuk harf fark etmez) eslesmeli; cikti adresi beklenen yazimdir', () => {
    expect(sanitizeTokenData({ symbol: 'USDT', address: ADDR.toLowerCase() }, ADDR)).toEqual({ symbol: 'USDT', address: ADDR })
    expect(sanitizeTokenData({ symbol: 'USDT', address: '0x2222222222222222222222222222222222222222' }, ADDR)).toBe('mismatch')
    expect(sanitizeTokenData({ symbol: 'USDT', address: 5 }, ADDR)).toBe('mismatch')
    expect(sanitizeTokenData({ symbol: 'USDT', address: null }, ADDR)).toEqual({ symbol: 'USDT', address: ADDR })
  })
  it('sembolsuz / bos / uzun / dize olmayan sembol -> null (hata degil)', () => {
    for (const symbol of [undefined, '', '   ', 5, null, 'x'.repeat(513)]) expect(sanitizeTokenData({ symbol }, ADDR)).toBeNull()
    expect(sanitizeTokenData({ symbol: 'x'.repeat(512) }, ADDR)).toEqual({ symbol: 'x'.repeat(512), address: ADDR })
    expect(sanitizeTokenData(['x'], ADDR)).toBeNull()
    expect(sanitizeTokenData({ name: 'sembolsuz' }, ADDR)).toBeNull()
  })
  it('yalniz bilinen alanlar: symbol (kirpilir), name, address, image (dize ya da large/small/thumb), logoURI, logo', () => {
    const out = sanitizeTokenData({
      symbol: ' USDT ', name: ' Tether ', address: ADDR, image: { large: 'L', small: 'S', thumb: 'T', evil: 'z' }, logoURI: 'U', logo: 'O',
      display: { price: 1 }, balance: '5', priceUSD: 1,
    }, ADDR)
    expect(out).toEqual({ symbol: 'USDT', name: 'Tether', address: ADDR, image: { large: 'L', small: 'S', thumb: 'T' }, logoURI: 'U', logo: 'O' })
    expect(sanitizeTokenData({ symbol: 'A', image: 'https://x/a.png' }, ADDR).image).toBe('https://x/a.png')
  })
  it('bozuk / uzun alanlar atilir, sembol kalir', () => {
    const long = 'x'.repeat(513)
    expect(sanitizeTokenData({ symbol: 'A', name: long, image: long, logoURI: long, logo: 5 }, ADDR)).toEqual({ symbol: 'A', address: ADDR })
    expect(sanitizeTokenData({ symbol: 'A', image: { evil: 'z', large: 5 } }, ADDR)).toEqual({ symbol: 'A', address: ADDR })
    expect(sanitizeTokenData({ symbol: 'A', image: null }, ADDR)).toEqual({ symbol: 'A', address: ADDR })
  })
})

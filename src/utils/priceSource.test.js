import { describe, it, expect, vi, afterEach } from 'vitest'
import { isAtlasPriced, ATLAS_LABEL_MAX_AGE_MS } from './priceSource'

// Sabit bir "simdi": testler duvar saatine bagli kalmasin.
const NOW = Date.parse('2026-09-29T12:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()
const kayit = (overrides = {}) => ({
  coingecko_id: 'spy-bstocks-tokenized-stock',
  price_source: 'atlas',
  price_updated_at: iso(NOW - 60 * 1000),
  ...overrides,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('isAtlasPriced', () => {
  it('sinir 10 dakika', () => {
    expect(ATLAS_LABEL_MAX_AGE_MS).toBe(600000)
  })

  it('Atlas + 1 dakika once yazilmis -> etiket GORUNUR', () => {
    expect(isAtlasPriced(kayit(), NOW)).toBe(true)
  })

  // Sinirin IKI yani: tam 10 dakika dahil, 1 ms fazlasi degil.
  it('tam 10 dakika dahil, 10 dakika + 1 ms haric', () => {
    expect(isAtlasPriced(kayit({ price_updated_at: iso(NOW - ATLAS_LABEL_MAX_AGE_MS) }), NOW)).toBe(true)
    expect(isAtlasPriced(kayit({ price_updated_at: iso(NOW - ATLAS_LABEL_MAX_AGE_MS - 1) }), NOW)).toBe(false)
  })

  it('CoinGecko kaynakli taze kayit -> etiket YOK', () => {
    expect(isAtlasPriced(kayit({ price_source: 'coingecko' }), NOW)).toBe(false)
  })

  // Bayrak sunucuda hic acilmadiysa belgede alan YOKTUR -- bugunku uretim durumu.
  it('price_source alani hic yoksa etiket YOK', () => {
    const { price_source, ...alansiz } = kayit()
    expect(price_source).toBe('atlas')
    expect(isAtlasPriced(alansiz, NOW)).toBe(false)
  })

  // Spec 6.6: bayrak kapatilinca price_source 'atlas' KALIR ama zaman eskir.
  it('Atlas yazan poller durdu (2 saatlik kayit) -> etiket YOK', () => {
    expect(isAtlasPriced(kayit({ price_updated_at: iso(NOW - 2 * 3600 * 1000) }), NOW)).toBe(false)
  })

  it('zaman damgasi eksik, null ya da bozuksa etiket YOK', () => {
    expect(isAtlasPriced(kayit({ price_updated_at: undefined }), NOW)).toBe(false)
    // new Date(null) 1970'tir: sonlu ama cok eski.
    expect(isAtlasPriced(kayit({ price_updated_at: null }), NOW)).toBe(false)
    expect(isAtlasPriced(kayit({ price_updated_at: 'dun' }), NOW)).toBe(false)
  })

  it('kayit yoksa patlamaz', () => {
    expect(isAtlasPriced(null, NOW)).toBe(false)
    expect(isAtlasPriced(undefined, NOW)).toBe(false)
  })

  // JSON'dan ISO metin gelir; sunucu tarafi testleri Date ya da ms verebilir.
  it('Date nesnesi ve milisaniye de kabul edilir', () => {
    expect(isAtlasPriced(kayit({ price_updated_at: new Date(NOW - 5000) }), NOW)).toBe(true)
    expect(isAtlasPriced(kayit({ price_updated_at: NOW - 5000 }), NOW)).toBe(true)
  })

  // Sunucu saati birkac saniye ileride olabilir; bir dakikadan fazla gelecek bozuk veridir.
  it('saat kaymasi: 60 sn ileri kabul, 60 sn + 1 ms ileri RED', () => {
    expect(isAtlasPriced(kayit({ price_updated_at: iso(NOW + 60000) }), NOW)).toBe(true)
    expect(isAtlasPriced(kayit({ price_updated_at: iso(NOW + 60001) }), NOW)).toBe(false)
  })

  it('nowMs verilmezse Date.now() kullanilir', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(isAtlasPriced(kayit())).toBe(true)
    vi.setSystemTime(NOW + ATLAS_LABEL_MAX_AGE_MS)
    expect(isAtlasPriced(kayit())).toBe(false)
  })
})

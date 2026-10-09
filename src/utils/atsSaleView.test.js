// ATS satis hatalarinin ve fiyatin EKRAN karsiligi (spec §7). Metinler GERCEK vue-i18n ile
// cizilir: `$` ve `%` karakterleri mesaj derleyicisinden sag cikmali.
import { describe, it, expect } from 'vitest'
import { saleErrorView, salePriceText } from './atsSaleView'
import { createTestI18n } from '../test-utils/ssrRender.js'
import en from '../i18n/locales/en.json'
import tr from '../i18n/locales/tr.json'

const yol = (sozluk, anahtar) => anahtar.split('.').reduce((o, k) => (o == null ? undefined : o[k]), sozluk)

const KODLAR = [
  'sale-closed', 'amount-too-small', 'amount-too-large', 'price-unverified', 'usdc-depeg',
  'depth-insufficient', 'rate-limited', 'quote-failed', 'relay-failed', 'result-unknown', 'prepare-failed',
]

describe('saleErrorView', () => {
  it.each(KODLAR)('%s icin iki dilde de metin var', (code) => {
    const v = saleErrorView({ code })
    expect(typeof yol(en, v.key)).toBe('string')
    expect(typeof yol(tr, v.key)).toBe('string')
  })

  it('MEXC linki YALNIZ sale-closed, amount-too-large, depth-insufficient (spec §7)', () => {
    const linkli = KODLAR.filter((code) => saleErrorView({ code }).exchange)
    expect(linkli.sort()).toEqual(['amount-too-large', 'depth-insufficient', 'sale-closed'])
  })

  it('bilinmeyen kod ekrana HAM cikmaz: "hazirlanamadi"', () => {
    expect(saleErrorView({ code: 'sale-calldata' })).toEqual({ key: 'atsSale.errors.prepareFailed', params: {}, exchange: false })
  })

  it('hata yoksa null', () => {
    expect(saleErrorView(null)).toBeNull()
    expect(saleErrorView({})).toBeNull()
  })

  it('stok: en fazla X ATS (~$Y) ipucuyla', () => {
    expect(saleErrorView({ code: 'stock-insufficient', maxAts: '1234500000000000000000', maxUsd: '61.734' })).toEqual({
      key: 'atsSale.errors.stockInsufficient', params: { amount: '1,234.5', usd: '61.73' }, exchange: false,
    })
  })

  it('stok ipucu eksikse sayisiz cumle ("en fazla — ATS" yazilmaz)', () => {
    expect(saleErrorView({ code: 'stock-insufficient', maxAts: null, maxUsd: null }).key).toBe('atsSale.errors.stockInsufficientShort')
    expect(saleErrorView({ code: 'stock-insufficient', maxAts: 'bozuk', maxUsd: '5' }).key).toBe('atsSale.errors.stockInsufficientShort')
  })
})

describe('metinler gercekten cizilir ($ ve % dahil)', () => {
  it('en', () => {
    const { t } = createTestI18n('en').global
    expect(t('atsSale.errors.amountTooSmall')).toBe('The minimum purchase is $2')
    expect(t('atsSale.errors.amountTooLarge')).toBe('You can buy at most $2,000 at once')
    expect(t('atsSale.errors.stockInsufficient', { amount: '1,234.5', usd: '61.73' })).toBe('You can buy at most 1,234.5 ATS (~$61.73) right now')
    expect(t('atsSale.commissionIncluded', { pct: 1 })).toBe('1% commission included')
    expect(t('atsSale.buy')).toBe('Buy ATS')
  })

  it('tr: spec §7 metinleri birebir', () => {
    const { t } = createTestI18n('tr').global
    expect(t('atsSale.errors.saleClosed')).toBe('ATS satışı şu an kullanılamıyor')
    expect(t('atsSale.errors.amountTooSmall')).toBe("En az $2'lık alım yapabilirsin")
    expect(t('atsSale.errors.amountTooLarge')).toBe('Tek seferde en fazla $2.000 alabilirsin')
    expect(t('atsSale.errors.stockInsufficient', { amount: '1,234.5', usd: '61.73' })).toBe('Şu an en fazla 1,234.5 ATS (~$61.73) alabilirsin')
    expect(t('atsSale.errors.priceUnverified')).toBe('Fiyat şu an doğrulanamıyor, birazdan tekrar dene')
    expect(t('atsSale.errors.usdcDepeg')).toBe('USDC ile alım şu an kapalı, USDT veya BNB kullan')
    expect(t('atsSale.errors.depthInsufficient')).toBe('Borsada şu an yeterli satış yok')
    expect(t('atsSale.errors.rateLimited')).toBe('Çok sık alım yaptın, biraz sonra tekrar dene')
    expect(t('atsSale.requoted')).toBe('Fiyat güncellendi')
    expect(t('atsSale.errors.prepareFailed')).toBe('İşlem hazırlanamadı')
    expect(t('atsSale.errors.relayFailed')).toBe('İşlem gerçekleşmedi, paran çekilmedi')
    expect(t('atsSale.payWithHint')).toBe("ATS'yi USDT, USDC veya BNB ile alabilirsin")
    expect(t('atsSale.commissionIncluded', { pct: 1 })).toBe('%1 komisyon dahil')
    expect(t('atsSale.noNetworkFee')).toBe('Ağ ücreti yok')
    expect(t('atsSale.sourceValue')).toBe('Alltoscan stoğu (MEXC fiyatı)')
    expect(t('atsSale.buy')).toBe('ATS Al')
    expect(t('atsSale.exchange')).toBe('Borsadan al')
  })
})

describe('salePriceText', () => {
  it.each([
    ['0.05173', '0.05173'], ['0.051734567', '0.05173'], [1.5, '1.50'],
    ['', null], [null, null], ['abc', null], ['0', null], ['-1', null],
  ])('%s -> %s', (girdi, cikti) => {
    expect(salePriceText(girdi)).toBe(cikti)
  })
})

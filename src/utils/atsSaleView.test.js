// ATS satis hatalarinin ve fiyatin EKRAN karsiligi (spec §7). Metinler GERCEK vue-i18n ile
// cizilir: `$` ve `%` karakterleri mesaj derleyicisinden sag cikmali.
//
// Para birimi (Plan B Gorev 11): tutar metinleri SECILI BIRIMDE yazilir; `money` (useMoney().money)
// disaridan verilir, bu modul saf kalir. Bu dosyada `money` yerine formatMoney + sabit gorunum kullanilir.
import { describe, it, expect } from 'vitest'
import { saleErrorView, salePriceText } from './atsSaleView'
import { formatMoney, USD_DISPLAY } from './money'
import { createTestI18n } from '../test-utils/ssrRender.js'
import en from '../i18n/locales/en.json'
import tr from '../i18n/locales/tr.json'

const yol = (sozluk, anahtar) => anahtar.split('.').reduce((o, k) => (o == null ? undefined : o[k]), sozluk)

// Ekranin verdigi `money`: varsayilan USD gorunumu, en dili.
const money = (v, opts) => formatMoney(v, USD_DISPLAY, { locale: 'en', ...opts })
// Secili birim TL, kur 40, tr dili.
const TRY_DISPLAY = { code: 'try', rate: 40, fellBack: false }
const moneyTry = (v, opts) => formatMoney(v, TRY_DISPLAY, { locale: 'tr', ...opts })
// Boslukli bicimler dilde nbsp (U+00A0) / dar nbsp (U+202F) kullanir: duz bosluga indirilip karsilastirilir.
const norm = (s) => (typeof s === 'string' ? s.replace(/[  ]/g, ' ') : s)

const KODLAR = [
  'sale-closed', 'amount-too-small', 'amount-too-large', 'price-unverified', 'usdc-depeg',
  'depth-insufficient', 'rate-limited', 'quote-failed', 'relay-failed', 'result-unknown', 'prepare-failed',
]

describe('saleErrorView', () => {
  it.each(KODLAR)('%s icin iki dilde de metin var', (code) => {
    const v = saleErrorView({ code }, { money })
    expect(typeof yol(en, v.key)).toBe('string')
    expect(typeof yol(tr, v.key)).toBe('string')
  })

  it('MEXC linki YALNIZ sale-closed, amount-too-large, depth-insufficient (spec §7)', () => {
    const linkli = KODLAR.filter((code) => saleErrorView({ code }, { money }).exchange)
    expect(linkli.sort()).toEqual(['amount-too-large', 'depth-insufficient', 'sale-closed'])
  })

  it('bilinmeyen kod ekrana HAM cikmaz: "hazirlanamadi"', () => {
    expect(saleErrorView({ code: 'sale-calldata' }, { money })).toEqual({ key: 'atsSale.errors.prepareFailed', params: {}, exchange: false })
  })

  it('hata yoksa null', () => {
    expect(saleErrorView(null, { money })).toBeNull()
    expect(saleErrorView({}, { money })).toBeNull()
  })

  it('stok: en fazla X ATS (~Y) ipucuyla; Y secili birimde TAM BICIMLI tutardir', () => {
    expect(saleErrorView({ code: 'stock-insufficient', maxAts: '1234500000000000000000', maxUsd: '61.734' }, { money })).toEqual({
      key: 'atsSale.errors.stockInsufficient', params: { amount: '1,234.5', usd: '$61.73' }, exchange: false,
    })
  })

  it('stok: secili birim TL / kur 40 -> usd parametresi "₺2.469,36" ("$" yok)', () => {
    const v = saleErrorView({ code: 'stock-insufficient', maxAts: '1234500000000000000000', maxUsd: '61.734' }, { money: moneyTry })
    expect(norm(v.params.usd)).toBe('₺2.469,36')
    expect(v.params.usd).not.toContain('$')
  })

  it('stok ipucu eksikse sayisiz cumle ("en fazla — ATS" yazilmaz)', () => {
    expect(saleErrorView({ code: 'stock-insufficient', maxAts: null, maxUsd: null }, { money }).key).toBe('atsSale.errors.stockInsufficientShort')
    expect(saleErrorView({ code: 'stock-insufficient', maxAts: 'bozuk', maxUsd: '5' }, { money }).key).toBe('atsSale.errors.stockInsufficientShort')
  })

  it('maxUsd yok / bos / bozuk -> stockInsufficientShort (Number(null) = 0 tuzagi: "$0.00" yazilmaz)', () => {
    const base = { code: 'stock-insufficient', maxAts: '1234500000000000000000' }
    expect(saleErrorView({ ...base }, { money }).key).toBe('atsSale.errors.stockInsufficientShort')
    expect(saleErrorView({ ...base, maxUsd: null }, { money }).key).toBe('atsSale.errors.stockInsufficientShort')
    expect(saleErrorView({ ...base, maxUsd: '' }, { money }).key).toBe('atsSale.errors.stockInsufficientShort')
    expect(saleErrorView({ ...base, maxUsd: 'abc' }, { money }).key).toBe('atsSale.errors.stockInsufficientShort')
  })

  it('money yok ya da null donerse stockInsufficientShort (yarim tutar yazilmaz)', () => {
    const err = { code: 'stock-insufficient', maxAts: '1234500000000000000000', maxUsd: '61.73' }
    expect(saleErrorView(err).key).toBe('atsSale.errors.stockInsufficientShort')
    expect(saleErrorView(err, {}).key).toBe('atsSale.errors.stockInsufficientShort')
    expect(saleErrorView(err, { money: () => null }).key).toBe('atsSale.errors.stockInsufficientShort')
  })
})

describe('metinler gercekten cizilir ($ ve % dahil)', () => {
  it('en', () => {
    const { t } = createTestI18n('en').global
    expect(t('atsSale.errors.amountTooSmall')).toBe('The minimum purchase is $2')
    expect(t('atsSale.errors.amountTooLarge')).toBe('You can buy at most $2,000 at once')
    expect(t('atsSale.errors.stockInsufficient', { amount: '1,234.5', usd: '$61.73' })).toBe('You can buy at most 1,234.5 ATS (~$61.73) right now')
    expect(t('atsSale.commissionIncluded', { pct: 1 })).toBe('1% commission included')
    expect(t('atsSale.buy')).toBe('Buy ATS')
  })

  it('tr: spec §7 metinleri birebir', () => {
    const { t } = createTestI18n('tr').global
    expect(t('atsSale.errors.saleClosed')).toBe('ATS satışı şu an kullanılamıyor')
    expect(t('atsSale.errors.amountTooSmall')).toBe("En az $2'lık alım yapabilirsin")
    expect(t('atsSale.errors.amountTooLarge')).toBe('Tek seferde en fazla $2.000 alabilirsin')
    expect(t('atsSale.errors.stockInsufficient', { amount: '1,234.5', usd: '$61.73' })).toBe('Şu an en fazla 1,234.5 ATS (~$61.73) alabilirsin')
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

describe('stockInsufficient metni sembolu kendi basmaz (yer tutucu tam biçimli tutari alir)', () => {
  it('en: secili birim TL -> "$" gecmez', () => {
    const { t } = createTestI18n('en').global
    expect(norm(t('atsSale.errors.stockInsufficient', { amount: '1,234.5', usd: moneyTry(61.734) })))
      .toBe('You can buy at most 1,234.5 ATS (~₺2.469,36) right now')
  })

  it('tr: secili birim TL -> "$" gecmez', () => {
    const { t } = createTestI18n('tr').global
    expect(norm(t('atsSale.errors.stockInsufficient', { amount: '1,234.5', usd: moneyTry(61.734) })))
      .toBe('Şu an en fazla 1,234.5 ATS (~₺2.469,36) alabilirsin')
  })

  it('iki dilde de anahtar "$" icermez, yer tutucu {usd} kalir', () => {
    for (const sozluk of [en, tr]) {
      expect(sozluk.atsSale.errors.stockInsufficient).not.toContain('$')
      expect(sozluk.atsSale.errors.stockInsufficient).toContain('{usd}')
    }
  })
})

describe('salePriceText', () => {
  it.each([
    [0.0504, '$0.0504'],
    ['0.05173', '$0.05173'],
    ['0.051734567', '$0.05173'],
    [1.5, '$1.50'],
    ['1.5', '$1.50'],
    [12, '$12.00'],
  ])('%s -> %s (USD; 1 altinda 4 anlamli basamak, 1 ve ustu standart)', (girdi, cikti) => {
    expect(salePriceText(girdi, money)).toBe(cikti)
  })

  it('secili birim TL / kur 40: 0.0504 x 40 = 2,016 -> "₺2,02"', () => {
    expect(norm(salePriceText(0.0504, moneyTry))).toBe('₺2,02')
  })

  it('secili birim JPY (ondaliksiz): 0.0504 x 150 = 7,56 -> "¥7.56" (tamsayiya yuvarlanmaz); 0.0099 x 150 -> "¥1.485"; 100 ve ustu standart', () => {
    const jpy = (v, opts) => formatMoney(v, { code: 'jpy', rate: 150, fellBack: false }, { locale: 'en', ...opts })
    expect(salePriceText(0.0504, jpy)).toBe('¥7.56')
    expect(salePriceText(0.0099, jpy)).toBe('¥1.485')
    expect(salePriceText(1, jpy)).toBe('¥150')
  })

  it('kur 0,5: kucuk fiyat birimde de kucukse anlamli basamak korunur ("£0.0252")', () => {
    const yarim = (v, opts) => formatMoney(v, { code: 'gbp', rate: 0.5, fellBack: false }, { locale: 'en', ...opts })
    expect(salePriceText(0.0504, yarim)).toBe('£0.0252')
  })

  it('kur yok (USD etiketli): "USD 0.0504"', () => {
    const dusme = (v, opts) => formatMoney(v, { code: 'usd', rate: 1, fellBack: true, requested: 'try' }, { locale: 'en', ...opts })
    expect(norm(salePriceText(0.0504, dusme))).toBe('USD 0.0504')
  })

  it.each([['', null], [null, null], [undefined, null], ['abc', null], ['0', null], [0, null], ['-1', null], [NaN, null], [Infinity, null]])(
    'gecersiz %s -> null (satir cizilmez; "$0.00" bedava demek olurdu)',
    (girdi, cikti) => {
      expect(salePriceText(girdi, money)).toBe(cikti)
    },
  )

  it('money yok ya da null donerse null (fiyat yazilmaz)', () => {
    expect(salePriceText(0.0504)).toBeNull()
    expect(salePriceText(0.0504, () => null)).toBeNull()
  })
})

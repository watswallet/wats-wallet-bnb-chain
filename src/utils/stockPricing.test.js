// xStocks FIYAT BIRIMI: CoinGecko carpanli HAM birimde, EVM birim fiyati = CoinGecko / (carpan / 1e18).
// Carpan bilinmiyorsa null (ekran tire yazar); asla ham fiyat ve asla 0.
import { describe, it, expect } from 'vitest'
import { BSTOCKS } from '../data/bStocks'
import { XSTOCKS } from '../data/xStocks'
import { MULTIPLIER_ONE, unitPriceUsd, isRebasedStock, marketForDisplay } from './stockPricing'
// verify:xstocks referans fiyati AYNI formulu betikte (uygulama paketinin disinda) ayri tasir; esitlik burada kilitli.
import { referencePrice } from '../../scripts/verify-xstocks-core.mjs'

// Spec Ek B.1 olcumu: SPYx carpani ve CoinGecko ham fiyati.
const SPY_M = 1005714560286254000n
const SPY = XSTOCKS.find((s) => s.symbol === 'SPYx')
const GOOGLB = BSTOCKS.find((s) => s.symbol === 'GOOGLB')

describe('unitPriceUsd', () => {
  it('MULTIPLIER_ONE 1e18', () => {
    expect(MULTIPLIER_ONE).toBe(10n ** 18n)
  })

  it('SPYx: 781,30 / 1,005714560286254 = 776,86 (bolunmezse +%0,57 hata)', () => {
    expect(unitPriceUsd(781.30, SPY_M)).toBeCloseTo(776.86, 2)
    expect(781.30 / unitPriceUsd(781.30, SPY_M) - 1).toBeCloseTo(0.0057, 3)
  })

  it('carpan 1,0 ise fiyat degismez', () => {
    expect(unitPriceUsd(379.30, MULTIPLIER_ONE)).toBeCloseTo(379.30, 2)
  })

  it('tam sayi dizesi de kabul edilir (depo ve JSON bigint tasimaz)', () => {
    expect(unitPriceUsd(781.30, '1005714560286254000')).toBeCloseTo(776.86, 2)
  })

  // Review Focus 2: 4:1 bolunmeden sonra carpan ~4,03 olur; ham fiyat 4 kat sismis gorunur.
  it('Review Focus 2: bolunme (4:1) carpani 4,032 fiyati dogru boler', () => {
    expect(unitPriceUsd(4 * 380, 4_032_000_000_000_000_000n)).toBeCloseTo(376.98, 2)
  })

  // Review Focus 2: carpan bilinmiyor -> null; ASLA ham CoinGecko fiyati, ASLA 0.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['bos dize', ''],
    ['sifir', 0n],
    ['negatif', -5n],
    ['sayi olmayan dize', 'abc'],
    ['olceksiz ondalik sayi', 1.5],
  ])('Review Focus 2: carpan %s -> null', (_ad, carpan) => {
    expect(unitPriceUsd(781.30, carpan)).toBeNull()
  })

  it.each([
    ['sifir', 0],
    ['negatif', -1],
    ['null', null],
    ['undefined', undefined],
    ['sayi olmayan', 'x'],
    ['sonsuz', Infinity],
  ])('ham fiyat %s -> null', (_ad, fiyat) => {
    expect(unitPriceUsd(fiyat, SPY_M)).toBeNull()
  })

  it('verify:xstocks referans fiyatiyla AYNI sonucu verir (iki kopya ayrisamaz)', () => {
    for (const carpan of [MULTIPLIER_ONE, SPY_M, 1001701196801074000n, 4_032_000_000_000_000_000n]) {
      expect(unitPriceUsd(781.30, carpan)).toBeCloseTo(referencePrice({ coingeckoUsd: 781.30, multiplier: carpan }), 9)
    }
  })
})

describe('isRebasedStock', () => {
  it('yalniz xStocks, KATALOGDAKI her zincirinde', () => {
    for (const chainId of SPY.chains) expect(isRebasedStock(chainId, SPY.address), String(chainId)).toBe(true)
  })

  it('bStock, katalog disi zincirdeki ayni adres ve bilinmeyen token false', () => {
    expect(isRebasedStock(56, GOOGLB.address)).toBe(false)
    expect(isRebasedStock(137, SPY.address)).toBe(false) // Review Focus 1: Polygon'da ayni adres hisse SAYILMAZ
    expect(isRebasedStock(1, '0x1111111111111111111111111111111111111111')).toBe(false)
    expect(isRebasedStock(1, undefined)).toBe(false)
  })
})

// Sunucunun market_data kaydi ekranlar arasinda PAYLASILIYOR (Home, SelectAssets, Token). Gosterim kopyasi
// priceUSD'yi ve 24 saatlik degisimi hesaplayan sparkline'i AYNI carpanla boler; yalniz fiyati bolup
// sparkline'i ham birakmak portfoy gunluk yuzdesine sahte bir %0,57 kaydirirdi.
describe('marketForDisplay', () => {
  const kayit = () => ({ priceUSD: 781.3, change: { h24: 1.2 }, sparkline: { d7: [780, 781, 0, 782.5] } })

  it('xStock: priceUSD ve sparkline carpana bolunur; degisim yuzdesi ve diger alanlar korunur', () => {
    const out = marketForDisplay({ chainId: 1, address: SPY.address, market: kayit(), multiplier: SPY_M })

    expect(out.priceUSD).toBeCloseTo(776.86, 2)
    expect(out.sparkline.d7[0]).toBeCloseTo(775.57, 2)
    expect(out.sparkline.d7[2]).toBe(0) // gecersiz nokta 0 kalir; tuketici `|| priceUSD` ile yedege duser
    expect(out.change).toEqual({ h24: 1.2 })
  })

  it('kayit KOPYALANIR: sunucudan gelen nesne ve sparkline dizisi degismez', () => {
    const market = kayit()

    const out = marketForDisplay({ chainId: 1, address: SPY.address, market, multiplier: SPY_M })

    expect(out).not.toBe(market)
    expect(market.priceUSD).toBe(781.3)
    expect(market.sparkline.d7).toEqual([780, 781, 0, 782.5])
  })

  // Review Focus 2: carpan bilinmiyor -> fiyat 0 (assetPriceUSD bunu "fiyat yok" sayar), HAM fiyat ve HAM sparkline sizmaz.
  it('Review Focus 2: carpan bilinmiyorsa priceUSD 0 ve sparkline atilir (ham deger sizmaz)', () => {
    const out = marketForDisplay({ chainId: 1, address: SPY.address, market: kayit(), multiplier: null })

    expect(out.priceUSD).toBe(0)
    expect(out.sparkline).toBeUndefined()
    expect(out.change).toEqual({ h24: 1.2 })
  })

  it('xStock DEGILSE ya da katalog disi zincirdeyse AYNI nesne doner (eski davranis)', () => {
    const market = kayit()

    expect(marketForDisplay({ chainId: 56, address: GOOGLB.address, market, multiplier: SPY_M })).toBe(market)
    expect(marketForDisplay({ chainId: 137, address: SPY.address, market, multiplier: SPY_M })).toBe(market)
  })

  it('kayit yoksa (undefined / null) oldugu gibi doner; sparkline yoksa eklenmez; ham fiyat 0 ise 0 kalir', () => {
    expect(marketForDisplay({ chainId: 1, address: SPY.address, market: undefined, multiplier: SPY_M })).toBeUndefined()
    expect(marketForDisplay({ chainId: 1, address: SPY.address, market: null, multiplier: SPY_M })).toBeNull()
    expect('sparkline' in marketForDisplay({ chainId: 1, address: SPY.address, market: { priceUSD: 781.3 }, multiplier: SPY_M })).toBe(false)
    expect(marketForDisplay({ chainId: 1, address: SPY.address, market: { priceUSD: 0, sparkline: { d7: [1] } }, multiplier: SPY_M }).priceUSD).toBe(0)
  })
})

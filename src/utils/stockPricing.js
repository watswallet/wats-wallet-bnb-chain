// xStocks FIYAT BIRIMI (saf: ag, saglayici, cuzdan YOK).
//
// CoinGecko xStocks'u carpanli HAM birim uzerinden fiyatliyor (Solana'daki gibi: ham
// bakiye x carpan = gorunen). EVM'de ise balanceOf() ZATEN carpanli oldugundan 1 token
// ~ dayanak 1 hisse: EVM birim fiyati = CoinGecko / (getCurrentMultiplier() / 1e18).
// Bolunmezse SPYx'te +%0,57 hata olur (spec 2.2, Ek B.1).
//
// Carpan BILINMIYORSA fiyat da bilinmiyor: `null` doner, ekran tire yazar. Yanlis fiyat
// gostermektense hic gostermemek (spec 8.2). Grafik serisi bolunmez (spec kapsam disi).

import { stockIssuer } from './tokenizedStocks'

// getCurrentMultiplier() 1e18 olcekli tam sayi doner (1.0 = 10^18).
export const MULTIPLIER_ONE = 10n ** 18n

const bosMu = (v) => v === null || v === undefined || v === ''

export function unitPriceUsd(rawPriceUsd, multiplier) {
  if (bosMu(rawPriceUsd) || bosMu(multiplier)) return null

  const raw = Number(rawPriceUsd)
  if (!Number.isFinite(raw) || raw <= 0) return null

  // bigint, tam sayi dizesi ya da tam sayi Number kabul edilir; digerleri "bilinmiyor".
  let scaled
  try {
    scaled = Number(typeof multiplier === 'bigint' ? multiplier : BigInt(multiplier))
  } catch {
    return null
  }

  const factor = scaled / Number(MULTIPLIER_ONE)
  if (!Number.isFinite(factor) || factor <= 0) return null

  const price = raw / factor
  return Number.isFinite(price) && price > 0 ? price : null
}

// Bu satirin CoinGecko fiyati carpana bolunmeli mi? Yalniz xStocks: bStocks fiyati zaten
// gosterim birimindedir (Atlas uiMultiplier'a boler; CoinGecko'dan gelen bStock fiyatina dokunulmaz).
export const isRebasedStock = (chainId, address) => stockIssuer(chainId, address) === 'xstocks'

// Piyasa kaydinin (market_data) GOSTERIM kopyasi: xStock icin priceUSD ve 7 gunluk sparkline carpana
// bolunur. Kayit KOPYALANIR: sunucudan gelen nesne ekranlar arasinda paylasiliyor, yerinde yazmak
// sonraki turlara sizar. Carpan bilinmiyorsa priceUSD 0 olur ve sparkline atilir: assetPriceUSD 0'i
// "fiyat yok" sayar (null YAZILMAZ: `null ?? yedek` zinciri market_data'daki HAM fiyata duserdi, K4).
// xStock DEGILSE kayit AYNI nesne olarak doner (eski davranis).
export function marketForDisplay({ chainId, address, market, multiplier }) {
  if (!market || !isRebasedStock(chainId, address)) return market

  const price = unitPriceUsd(market.priceUSD, multiplier)
  if (price === null) return { ...market, priceUSD: 0, sparkline: undefined }

  const d7 = market.sparkline?.d7
  return {
    ...market,
    priceUSD: price,
    ...(Array.isArray(d7) ? { sparkline: { ...market.sparkline, d7: d7.map((v) => unitPriceUsd(v, multiplier) ?? 0) } } : {}),
  }
}

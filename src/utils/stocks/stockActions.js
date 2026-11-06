// Hisse detayi eylemlerinin SAF yardimcilari (ag, saglayici, cuzdan, depo YOK).
//
// Gonder: `crypto.sendAsset` kaydi Token.vue selectSend ile AYNI sozlesmeyi tasir:
//   - SATIR KIMLIGI (chainId, address, decimals, symbol) kanonik kaydin USTUNE yazilir
//     (satirin ondaligi/sembolu CoinGecko'nunkini ezer; satir tasimiyorsa alan UYDURULMAZ).
//   - `market` alani: Send.vue USD tahminini `sendAsset.market.priceUSD`den okur (assetPriceUSD).
//     Token.vue `market_data`yi `market`e kopyalar; ayni yapilir.
//   - xStock fiyati CARPANA BOLUNMUS gelir (useStockDetail.price.priceUsd). Bilinmiyorsa priceUSD 0
//     olur (assetPriceUSD 0'i "fiyat yok" sayar; ham CoinGecko fiyatina DUSULMEZ). Ham seri carpanla
//     bolunmedigi icin xStock'ta sparkline tasinmaz (stockPricing.marketForDisplay ile ayni karar).
// BIRIM SINIRI: bu dosya hicbir tutar cevirmez; yalniz kimlik ve fiyat tasir.

import { rowTokenRecord } from '../tokenRowRecord'

const EMPTY_IMAGE = Object.freeze({ thumb: '', small: '', large: '' })

/**
 * @param {object} p
 * @param {object|null} p.entry      katalog satiri (stockEntryForRef)
 * @param {object|null} [p.ref]      crypto.selected_token_ref (satir kimligi: decimals/symbol)
 * @param {object|null} [p.record]   sunucu kaydi (/getTokensDataById tokens[i]); yoksa satirdan uretilir
 * @param {number|null} [p.priceUsd] gosterim birimindeki birim fiyat (xStock icin bolunmus)
 * @returns {object|null}
 */
export function sendAssetFor({ entry, ref = null, record = null, priceUsd = null }) {
  if (!entry) return null

  const decimals = Number.isInteger(ref?.decimals) ? ref.decimals : entry.decimals
  const symbol = ref?.symbol || entry.symbol

  const base = record
    ? { ...record }
    : rowTokenRecord({ chainId: entry.chainId, address: entry.address, decimals, symbol, name: entry.name })

  const market = {
    ...(base.market_data ?? {}),
    priceUSD: typeof priceUsd === 'number' && Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : 0,
  }
  if (entry.issuer === 'xstocks') market.sparkline = undefined

  return {
    ...base,
    name: base.name || entry.name,
    image: base.image ?? entry.image ?? EMPTY_IMAGE,
    coingecko_id: base.coingecko_id ?? entry.coingeckoId ?? null,
    chainId: entry.chainId,
    address: entry.address,
    decimals,
    symbol,
    market_data: market,
    market,
  }
}

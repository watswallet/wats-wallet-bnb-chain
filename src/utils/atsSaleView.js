// ATS SATISI -- hatalarin ve fiyatin EKRAN karsiligi (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §7).
//
// SAF: I/O yok, i18n yok. Arka plan yalniz KOD yazar (utils/atsSale.js saleErrorOf); cumle
// burada anahtara cevrilir. Bilinmeyen kod ekranda HAM gorunmez: "Islem hazirlanamadi"ya duser.
import { formatUnits } from 'ethers'
import { formatAtsAmount } from './atsAmountFormat'
import { formatUsd } from './assetPrice'

const K = (name) => `atsSale.errors.${name}`

// `exchange`: kartta MEXC linki de cizilir (spec §7 "Ek davranis").
const VIEWS = {
  'sale-closed': { key: K('saleClosed'), exchange: true },
  'amount-too-small': { key: K('amountTooSmall'), exchange: false },
  'amount-too-large': { key: K('amountTooLarge'), exchange: true },
  'price-unverified': { key: K('priceUnverified'), exchange: false },
  'usdc-depeg': { key: K('usdcDepeg'), exchange: false },
  'depth-insufficient': { key: K('depthInsufficient'), exchange: true },
  'rate-limited': { key: K('rateLimited'), exchange: false },
  'quote-failed': { key: K('quoteFailed'), exchange: false },
  'relay-failed': { key: K('relayFailed'), exchange: false },
  'result-unknown': { key: K('resultUnknown'), exchange: false },
  'prepare-failed': { key: K('prepareFailed'), exchange: false },
}

const atsText = (raw) => {
  try {
    return formatAtsAmount(formatUnits(BigInt(raw), 18))
  } catch {
    return null
  }
}

/**
 * @param {{code: string, maxAts?: string|null, maxUsd?: string|null}|null} err
 * @returns {{key: string, params: object, exchange: boolean}|null}
 */
export function saleErrorView(err) {
  if (!err || !err.code) return null
  if (err.code === 'stock-insufficient') {
    const amount = err.maxAts != null ? atsText(err.maxAts) : null
    const usd = err.maxUsd != null ? formatUsd(Number(err.maxUsd)) : null
    // Ipucu eksikse sayisiz cumle: "en fazla — ATS" yazmak hicbir sey soylemez.
    if (!amount || !usd) return { key: K('stockInsufficientShort'), params: {}, exchange: false }
    return { key: K('stockInsufficient'), params: { amount, usd }, exchange: false }
  }
  const v = VIEWS[err.code] || VIEWS['prepare-failed']
  return { key: v.key, params: {}, exchange: v.exchange }
}

// 1 ATS'nin dolar fiyati (teklifin display.price'i). Okunamazsa null -> satir CIZILMEZ;
// sifirli bir fiyat "bedava" demek olurdu.
export function salePriceText(price) {
  const n = Number(price)
  if (price == null || price === '' || !Number.isFinite(n) || n <= 0) return null
  return n >= 1 ? n.toFixed(2) : String(Number(n.toPrecision(4)))
}

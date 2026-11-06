// Hisse detayi VERI MODELI (saf: ag, saglayici, cuzdan, tarayici API'si YOK).
// StockDetail.vue yalniz bunu cizer; kararlar (fiyat/tire, pozisyon toplami, bilgi bloklari,
// aralik->gun) burada, RPC'siz testle olculur.
//
// BIRIM SINIRI: bStocks bakiyesi balanceOfUI (gosterim birimi), xStocks balanceOf (zaten carpanli).
// Bu dosya ham birime CEVIRME yapmaz; yalniz gosterim icin formatUnits kullanir.

import { formatUnits } from 'ethers'
import { stockKey, stockIssuerInfo } from '../tokenizedStocks'
import { unitPriceUsd, MULTIPLIER_ONE } from '../stockPricing'
import { companyRows } from './stockCompanies'
import { isAtlasPriced } from '../priceSource'

/** TK8: 1H/1A/3A/1Y, hepsi gunluk nokta. */
export const RANGES = Object.freeze([
  Object.freeze({ key: '1w', days: 7 }),
  Object.freeze({ key: '1m', days: 30 }),
  Object.freeze({ key: '3m', days: 90 }),
  Object.freeze({ key: '1y', days: 365 }),
])
export const DEFAULT_RANGE = '1m'

/** Aralik anahtari -> gun. Bilinmeyen anahtar -> 30 (varsayilan). */
export function rangeDays(key) {
  return RANGES.find((r) => r.key === key)?.days ?? 30
}

/** Hissenin AYNI ZINCIRDEKI tum ihracci satirlari, bStocks once. xstocksEnabled verilmezse bayrak degeri. */
export function sameChainOptions(entry, { xstocksEnabled } = {}) {
  if (!entry) return []
  const rows = companyRows(entry.underlying, xstocksEnabled === undefined ? {} : { xstocksEnabled })
    .filter((row) => Number(row.chainId) === Number(entry.chainId))
  // Acilan katalog satiri her zaman listede olsun.
  return rows.some((r) => r.address.toLowerCase() === entry.address.toLowerCase()) ? rows : [entry, ...rows]
}

/** 1. Baslik: ad (TK4: ciftte bStocks adi), ticker, logo satiri. */
export function headerModel(entry, options = sameChainOptions(entry)) {
  if (!entry) return null
  const bstocks = options.find((row) => row.issuer === 'bstocks')
  const logoRow = options.find((row) => row.image) ?? entry
  return { name: (bstocks ?? entry).name, ticker: entry.underlying, logoRow }
}

const finiteOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Grafik bolen: xStock carpani (1e18 olcekli) -> sayi; carpan bilinmiyorsa null (CryptoChart seri cizmez).
 * bStocks icin undefined (bolme yok). null ile undefined FARKLIDIR (T4 notu).
 */
export function chartDivisor(row, multiplier) {
  if (!row || row.issuer !== 'xstocks') return undefined
  if (multiplier === null || multiplier === undefined || multiplier === '') return null
  try {
    const factor = Number(typeof multiplier === 'bigint' ? multiplier : BigInt(multiplier)) / Number(MULTIPLIER_ONE)
    return Number.isFinite(factor) && factor > 0 ? factor : null
  } catch {
    return null
  }
}

/** Satirin birim fiyati (USD) ya da null (bilinmiyor; asla 0, asla ham xStock fiyati). */
export function rowPriceUsd(row, record, multiplier) {
  const raw = record?.market_data?.priceUSD
  if (row.issuer === 'xstocks') return unitPriceUsd(raw, multiplier)
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 2. Fiyat + 24s degisim + kaynak etiketi + grafik boleni.
 * Etiket (NIHAI INCELEME B2): Hisseler sekmesiyle AYNI kural, utils/priceSource.isAtlasPriced
 * (kaynak 'atlas' VE 10 dk tazelik). Bayat 'atlas' ve 'coingecko' etiket DOGURMAZ (S5: ek
 * kaynak gorunurlugu yok). nowMs yalniz test icin.
 */
export function priceModel({ entry, record, multiplier, nowMs }) {
  if (!entry) return null
  return {
    priceUsd: rowPriceUsd(entry, record, multiplier),
    change24h: finiteOrNull(record?.market_data?.change?.h24),
    priceSource: isAtlasPriced(record, nowMs) ? 'atlas' : null,
    chartDivisor: chartDivisor(entry, multiplier),
  }
}

/**
 * 5. Pozisyon toplami (TK7): ayni zincirdeki tum ihracci tokenleri; ihracci kirilimi yok.
 * balances: { [stockKey]: {status:'ok'|'error', balance:bigint|null, multiplier} }
 * records:  { [coingeckoId]: sunucu kaydi }
 * unknown: en az bir secenegin bakiyesi okunamadi. usd null: tutulan bir secenegin fiyati bilinmiyor.
 * @returns {{held:boolean, unknown:boolean, units:number, usd:number|null}}
 */
export function positionModel({ options, balances, records, multiplierOf = () => null }) {
  let held = false
  let unknown = false
  let units = 0
  let usd = 0
  let usdKnown = true

  for (const row of options ?? []) {
    const state = balances?.[stockKey(row.chainId, row.address)]
    if (!state || state.status !== 'ok' || typeof state.balance !== 'bigint') {
      unknown = true
      continue
    }
    if (state.balance <= 0n) continue
    held = true
    const amount = Number(formatUnits(state.balance, row.decimals))
    units += amount
    const price = rowPriceUsd(row, records?.[row.coingeckoId], state.multiplier ?? multiplierOf(row))
    if (price === null) usdKnown = false
    else usd += amount * price
  }

  return { held, unknown, units, usd: held && usdKnown ? usd : null }
}

/**
 * 6. Bilgi bloklari (TK7): tutulan her ihracci icin bir blok; hic tutulmuyorsa acilan token icin bir blok.
 * Ihracci adi YALNIZ burada (issuerKey i18n anahtari). ISIN yoksa null (satir gizlenir).
 */
export function infoBlocks({ entry, options, balances }) {
  if (!entry) return []
  const heldRows = (options ?? []).filter((row) => {
    const state = balances?.[stockKey(row.chainId, row.address)]
    return state?.status === 'ok' && typeof state.balance === 'bigint' && state.balance > 0n
  })
  const rows = heldRows.length ? heldRows : [entry]
  return rows.map((row) => ({
    issuer: row.issuer,
    issuerKey: stockIssuerInfo(row)?.issuerKey ?? null,
    isin: row.isin ?? null,
    chainId: row.chainId,
    address: row.address,
    decimals: row.decimals,
    symbol: row.symbol,
  }))
}

/** Sat: yalniz bakiyesi KESIN pozitifken (okunamadi / 0 -> devre disi). */
export const canSell = (position) => Boolean(position?.held)

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

/**
 * LCX satiri mi (dinamik katman, `source: 'lcx'`)? Detay ekrani dallanmasi ihracci ADINA degil bu yardimciya (ve hasChart'a) bakar:
 * yeni bir LCX ihraccisi ekranda kod degisikligi gerektirmez.
 */
export const isLcxRow = (entry) => entry?.source === 'lcx'

/** Fiyat grafigi var mi? Grafik CoinGecko kimligine baglidir (LCX satiri kimlik tasimaz: coingeckoId null). */
export const hasChart = (entry) => Boolean(entry?.coingeckoId)

/**
 * LCX fiyat guncelleme zamani -> ms ya da null. Sunucu `reference.updatedAt`'i unix SANIYE olarak verir; 1e12 ve ustu zaten ms sayilir.
 * Sonlu olmayan, sifir ve negatif (ve sayi olmayan) deger null: "Guncellendi" satiri cizilmez. Date araligini asan sonlu deger
 * (ms > 8.64e15, ornegin 1e18) de null: Gecersiz Tarih, Intl.DateTimeFormat().format'ta RangeError atip ekrani cokertirdi.
 */
export function updatedAtMs(updatedAt) {
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return null
  const ms = updatedAt < 1e12 ? updatedAt * 1000 : updatedAt
  return Number.isFinite(new Date(ms).getTime()) ? ms : null
}

/** Hissenin AYNI ZINCIRDEKI tum ihracci satirlari (bStocks, xStocks, LCX ihraccilari). Bayrak verilmezse bayrak degeri. */
export function sameChainOptions(entry, { xstocksEnabled, lcxEnabled } = {}) {
  if (!entry) return []
  const flags = {}
  if (xstocksEnabled !== undefined) flags.xstocksEnabled = xstocksEnabled
  if (lcxEnabled !== undefined) flags.lcxEnabled = lcxEnabled
  const rows = companyRows(entry.underlying, flags)
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

/**
 * Satirin birim fiyati (USD) ya da null (bilinmiyor; asla 0, asla ham xStock fiyati).
 * LCX satiri: fiyat satirin kendi priceUsd'si (sunucu kaydi / CoinGecko kimligi yok; satir dogrulamasi sonlu ve > 0 garanti eder).
 */
export function rowPriceUsd(row, record, multiplier) {
  if (isLcxRow(row)) return typeof row.priceUsd === 'number' && Number.isFinite(row.priceUsd) && row.priceUsd > 0 ? row.priceUsd : null
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
 * LCX satiri: fiyat satirdan, kaynak 'lcx' (Chainlink referansi), `updatedAt` satirin priceUpdatedAt'i (unix saniye; yok -> null);
 * 24s degisim ve grafik bolen yok. Statik satirin ciktisi DEGISMEZ (`updatedAt` anahtari yok).
 */
export function priceModel({ entry, record, multiplier, nowMs }) {
  if (!entry) return null
  if (isLcxRow(entry)) {
    return {
      priceUsd: rowPriceUsd(entry),
      change24h: null,
      priceSource: 'lcx',
      chartDivisor: chartDivisor(entry, multiplier),
      updatedAt: finiteOrNull(entry.priceUpdatedAt),
    }
  }
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
 * `lcx`: LCX satiri (issuerKey null: bStocks / xStocks ihracci metni LCX ihraccisina ait degildir); ekran ihracci adini
 * utils/stocks/issuerNames.js ile cozer.
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
    lcx: isLcxRow(row),
    isin: row.isin ?? null,
    chainId: row.chainId,
    address: row.address,
    decimals: row.decimals,
    symbol: row.symbol,
  }))
}

/** Sat: yalniz bakiyesi KESIN pozitifken (okunamadi / 0 -> devre disi). */
export const canSell = (position) => Boolean(position?.held)

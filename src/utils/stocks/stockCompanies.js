// Sirket modeli: ayni hissenin iki ihraccisini (bStocks / xStocks) TEK sirkete baglar.
// SAF katman: ag, saglayici, cuzdan, tarayici API'si YOK (tokenizedStocks.js ile ayni sozlesme);
// testler RPC'siz kosar.
//
// ESLESME ANAHTARI: katalog kayitlarindaki ACIK `underlying` alani (dayanak ticker, ornek 'TSLA').
// Sembolden sonek atarak TURETILMEZ: ISIN xStocks'ta yok, ad guvenilmez (MSTR "Strategy" /
// "MicroStrategy"), otomatik turetme sessiz yanlis eslesme uretirdi. Yeni bir hisse eklenince
// stockCompanies.test.js `PAIRS_REVIEWED` esitligiyle KIRILIR ve bilincli onay ister.
//
// ONEMLI: bu dosyadaki hicbir fonksiyon serbest adres kabul etmez. Disaridan gelen satir (ornek
// `crypto.selected_token_ref`) once `stockEntry` ile KATALOGDAKI donuk kayda cevrilir; ihracci
// degisimi token adresini degistirdigi icin secenekler yalniz katalog satirlarindan secilir.

import { XSTOCKS_ENABLED } from '../featureFlags'
import { stockEntry, stocksByChain } from '../tokenizedStocks'

/**
 * Normalize satir: tokenizedStocks.js bstockRow / xstockRow.
 * @typedef {{issuer:'bstocks'|'xstocks', chainId:number, symbol:string, name:string, address:string,
 *            decimals:number, coingeckoId:string, image:object|null, isin:string|null, scaled:boolean,
 *            underlying:string}} StockRow
 */

/**
 * Hisseler sekmesi sirket satiri.
 * @typedef {{key:string, chainId:number, underlying:string, ticker:string, name:string,
 *            options:StockRow[], logoRow:StockRow}} CompanyRow
 */

/** Gozden gecirilmis cift listesi (iki ihraccida da bulunan dayanaklar); katalog degisince test KIRILIR (TK3). */
export const PAIRS_REVIEWED = Object.freeze(['TSLA', 'NVDA', 'AAPL', 'GOOGL', 'AMZN', 'MSFT', 'CRCL', 'MSTR', 'SPY', 'QQQ'])

// xStocks cok zincirli oldugunda son tercih sirasi (TK13). Yerel: tokenizedStocks sirasina bagli kalmaz.
const XSTOCKS_FALLBACK_CHAIN_ORDER = Object.freeze([1, 56, 42161])

const upper = (value) => (typeof value === 'string' ? value.trim().toUpperCase() : '')

// bStocks once, sonra xStocks; kendi icinde `stocksByChain` sirasi (zincir sirasi, katalog sirasi).
function allRows(xstocksEnabled) {
  const flat = stocksByChain({ includeXstocks: Boolean(xstocksEnabled) }).flatMap((group) => group.rows)
  return [...flat.filter((row) => row.issuer === 'bstocks'), ...flat.filter((row) => row.issuer === 'xstocks')]
}

/**
 * Ayni dayanaga sahip TUM zincirlerdeki satirlar. xStocks yalniz `xstocksEnabled` iken. bStocks once.
 * @returns {StockRow[]}
 */
export function companyRows(underlying, { xstocksEnabled = XSTOCKS_ENABLED } = {}) {
  const target = upper(underlying)
  if (!target) return []
  return allRows(xstocksEnabled).filter((row) => row.underlying === target)
}

/**
 * TK13: ihracci xStocks birden cok zincirde ise hangisi? Once `preferChainId` (mevcut hissenin
 * zinciri), yoksa `activeChainId`, yoksa [1, 56, 42161] sirasindaki ilk zincir, yoksa listedeki ilk.
 * @param {Array<{chainId:number}>} rows
 * @returns {object|null}
 */
export function pickXstocksRow(rows, { preferChainId = null, activeChainId = null } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const on = (chainId) => {
    if (chainId === null || chainId === undefined || chainId === '') return null
    return rows.find((row) => Number(row.chainId) === Number(chainId)) ?? null
  }
  const preferred = on(preferChainId)
  if (preferred) return preferred
  const active = on(activeChainId)
  if (active) return active
  for (const chainId of XSTOCKS_FALLBACK_CHAIN_ORDER) {
    const hit = on(chainId)
    if (hit) return hit
  }
  return rows[0]
}

/**
 * Al/Sat ihracci secenegi: ihracci basina TEK satir, bStocks once. Uzunluk 1 ise secici gizlenir.
 * `entry` katalogdaki satira cevrilir (bilinmeyen / bozuk girdi -> []). Bayrak kapaliyken HEP tek eleman.
 * Ihraccinin mevcut satiri (entry) korunur: xStocks secili iken zinciri DEGISMEZ.
 * @returns {Array<{issuer:'bstocks'|'xstocks', row:StockRow}>}
 */
export function issuerOptions(entry, { xstocksEnabled = XSTOCKS_ENABLED, activeChainId = null } = {}) {
  const current = entry ? stockEntry(entry.chainId, entry.address) : null
  if (!current) return []
  if (!xstocksEnabled) return [{ issuer: current.issuer, row: current }]

  const rows = companyRows(current.underlying, { xstocksEnabled: true })
  const options = []

  const bstocks = current.issuer === 'bstocks' ? current : rows.find((row) => row.issuer === 'bstocks')
  if (bstocks) options.push({ issuer: 'bstocks', row: bstocks })

  const xstocksRows = rows.filter((row) => row.issuer === 'xstocks')
  const xstocks = current.issuer === 'xstocks'
    ? current
    : pickXstocksRow(xstocksRows, { preferChainId: current.chainId, activeChainId })
  if (xstocks) options.push({ issuer: 'xstocks', row: xstocks })

  return options
}

/**
 * Hisseler sekmesi: BIR ag grubundaki satirlari sirket satirlarina birlestirir (TK5). Ayni zincirde
 * ayni dayanaga sahip satirlar tek sirkettir; baska zincirin satiri bu gruba KATILMAZ.
 * Sira: satirlarin ilk gorunme sirasi (bugunku grup sirasi korunur). `underlying`i olmayan satir
 * birlestirilmez, kendi satiri olur (sessiz yanlis eslesme yok).
 * @returns {CompanyRow[]}
 */
export function mergeGroupRows(chainId, rows) {
  if (!Array.isArray(rows)) return []
  const byKey = new Map()

  for (const row of rows) {
    if (!row || Number(row.chainId) !== Number(chainId)) continue
    const id = row.underlying || row.symbol
    const key = `${Number(chainId)}:${id}`
    const company = byKey.get(key)
    if (company) {
      if (!company.options.includes(row)) company.options.push(row)
    } else {
      byKey.set(key, { key, chainId: Number(chainId), underlying: id, options: [row] })
    }
  }

  return [...byKey.values()].map((company) => {
    // bStocks once: ad ve logo kararlari bu sirayi kullanir.
    const options = [
      ...company.options.filter((row) => row.issuer === 'bstocks'),
      ...company.options.filter((row) => row.issuer !== 'bstocks'),
    ]
    const bstocks = options.find((row) => row.issuer === 'bstocks')
    return {
      key: company.key,
      chainId: company.chainId,
      underlying: company.underlying,
      ticker: company.underlying,
      name: (bstocks ?? options[0]).name, // TK4: ciftte bStocks katalog adi
      options,
      logoRow: options.find((row) => row.image) ?? options[0],
    }
  })
}

/**
 * TK6: satira basinca acilacak secenek.
 * (1) o zincirde TUTULAN seceneklerden en buyuk USD deger (fiyati bilinmeyen tutulan secenek en sona);
 * (2) hicbiri tutulmuyorsa bStocks; (3) o da yoksa listedeki ilk.
 * Esitlikte liste sirasi (bStocks once).
 * @param {CompanyRow} company
 * @param {(row:StockRow)=>({held:boolean, usd:number|null}|undefined)} valueOf
 * @returns {StockRow}
 */
export function pickRepresentative(company, valueOf) {
  const options = company?.options ?? []
  let best = null
  let bestUsd = null

  for (const row of options) {
    const value = typeof valueOf === 'function' ? valueOf(row) : undefined
    if (!value || value.held !== true) continue
    const usd = Number.isFinite(value.usd) ? value.usd : null
    // Ilk tutulan secenek yerlesir; sonrakiler yalniz KESIN buyukse (ya da onceki fiyatsizsa) onu gecer.
    if (best === null || (usd !== null && (bestUsd === null || usd > bestUsd))) {
      best = row
      bestUsd = usd
    }
  }

  if (best) return best
  return options.find((row) => row.issuer === 'bstocks') ?? options[0]
}

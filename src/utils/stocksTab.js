// Hisseler sekmesinin VERI katmani: bakiye yukleme, tohum plani ve satir metinleri.
// Home.vue yalnizca BAGLAR; kararlar burada, RPC'siz testle olculur (okuyucu enjekte edilir).

import { formatUnits } from 'ethers'
import { stockKey } from './tokenizedStocks'
import { unitPriceUsd } from './stockPricing'
import { readStockBalances } from './stockBalances'

// Gosterilecek bir deger YOKKEN ekranin tek yazisi: tire (U+2014). Home.vue ile ayni karakter.
export const UNKNOWN_TEXT = '—'

// Fiyat istegi tek POST (sunucu siniri 250 kimlik): bStocks + xStocks kimlikleri, tekrarsiz.
export const collectStockIds = (groups) => [...new Set(groups.flatMap((group) => group.rows.map((row) => row.coingeckoId)))]

// Zincir basina bakiye okumasinin ust siniri (ms). ethers JsonRpcProvider'in istek zaman asimi
// varsayilan 300 sn'dir ve loadGroupBalances uc zinciri Promise.all ile BEKLER: takili tek bir RPC
// tum bakiyeleri (ve tohumlamayi) dakikalarca tutardi. Sinir asilinca o grubun satirlari 'error'
// (tire) olur, diger zincirler etkilenmez.
export const STOCK_BALANCE_TIMEOUT_MS = 12_000

/**
 * Her zincir grubunun bakiyesini TEK Multicall3 ile ve zincirler PARALEL okur.
 * Bir zincir hata verirse YA DA `timeoutMs` icinde cevap vermezse YALNIZ o zincirin satirlari
 * 'error' olur (diger zincirler etkilenmez); `rejects` YOKTUR. Okuma duserse bakiye 0 DEGIL
 * bilinmiyor'dur.
 * @returns {Promise<Record<string, {status:'ok'|'error', balance: bigint|null, multiplier: bigint|null}>>}
 *          anahtar: stockKey(chainId, address)
 */
export async function loadGroupBalances({
  owner, groups, rpcFor, read = readStockBalances, timeoutMs = STOCK_BALANCE_TIMEOUT_MS,
}) {
  const result = {}

  await Promise.all(groups.map(async (group) => {
    try {
      const rpcUrl = rpcFor(group.chainId)
      if (!rpcUrl) throw new Error(`RPC adresi yok (zincir ${group.chainId})`)

      // Promise.race + clearTimeout (ensureMultipliersFor ile ayni kalip): hizli okuma sayaci temizler,
      // artakalan zamanlayici birakmaz. Zaman asimi asagidaki catch koluna duser.
      let timer = null
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`zaman asimi (${timeoutMs} ms)`)), timeoutMs)
      })
      let map
      try {
        map = await Promise.race([read({ chainId: group.chainId, owner, entries: group.rows, rpcUrl }), timeout])
      } finally {
        clearTimeout(timer)
      }
      for (const row of group.rows) {
        const hit = map.get(row.address.toLowerCase())
        const known = typeof hit?.balance === 'bigint'
        result[stockKey(row.chainId, row.address)] = {
          status: known ? 'ok' : 'error',
          balance: known ? hit.balance : null,
          multiplier: hit?.multiplier ?? null,
        }
      }
    } catch (error) {
      console.error(`Hisse bakiyeleri okunamadi (zincir ${group.chainId}):`, error)
      for (const row of group.rows) {
        result[stockKey(row.chainId, row.address)] = { status: 'error', balance: null, multiplier: null }
      }
    }
  }))

  return result
}

// Bakiyesi SIFIRDAN BUYUK olan satirlar (okunamayan satir sahip sayilmaz).
export function ownedRows(groups, balances) {
  return groups.flatMap((group) => group.rows).filter((row) => {
    const state = balances[stockKey(row.chainId, row.address)]
    return state?.status === 'ok' && state.balance > 0n
  })
}

/**
 * Sahip olunan hisseleri imported_tokens kovasina eklemek icin plan: { [zincirAnahtari]: eklenecek[] }.
 * Kovada ZATEN olan adres tekrar eklenmez. `imageOf(row)`: katalogda logosu olmayan (xStocks)
 * satirin sunucu kaydindaki gorseli.
 */
export function planSeed({ owned, bucket, imageOf = () => null }) {
  const additions = {}
  for (const row of owned) {
    const chainKey = String(row.chainId)
    const known = new Set((bucket?.[chainKey] || []).map((token) => String(token.address).toLowerCase()))
    if (known.has(row.address.toLowerCase())) continue

    const list = (additions[chainKey] ??= [])
    if (list.some((token) => token.address.toLowerCase() === row.address.toLowerCase())) continue
    list.push({
      name: row.name,
      symbol: row.symbol,
      decimals: row.decimals,
      address: row.address,
      image: row.image ?? imageOf(row) ?? null,
      coingecko_id: row.coingeckoId,
    })
  }
  return additions
}

// Home.vue formatUSDAmount ile AYNI ifade (bStock metni bugunku davranisla birebir kalir).
const usd2 = (amount) => (!amount ? '0.00' : parseFloat(amount).toFixed(2))

/**
 * Satirin fiyat metni. bStock: bugunku Home.vue davranisi BIREBIR (kayit/market_data yoksa tire,
 * varsa '$' + 2 hane; priceUSD yok/null/0 ise '$0.00'). xStock: CoinGecko fiyati zincirdeki
 * carpana bolunur; kayit, fiyat ya da carpan bilinmiyorsa tire (asla ham fiyat, asla $0.00).
 */
export function stockPriceText({ row, record, multiplier }) {
  const market = record?.market_data
  if (row.issuer === 'xstocks') {
    const unit = unitPriceUsd(market?.priceUSD, multiplier)
    return unit === null ? UNKNOWN_TEXT : '$' + unit.toFixed(2)
  }
  return market ? '$' + usd2(market.priceUSD) : UNKNOWN_TEXT
}

/**
 * Satirin bakiye metni: yuklenmedi / sifir -> '' (hicbir sey cizilmez); okunamadi -> tire;
 * pozitif -> 4 haneli miktar ('<0.0001' toz icin).
 */
export function stockBalanceText({ state, decimals = 18 }) {
  if (!state) return ''
  if (state.status === 'error') return UNKNOWN_TEXT
  if (!(state.balance > 0n)) return ''
  const value = Number(formatUnits(state.balance, decimals))
  return value < 0.0001 ? '<0.0001' : value.toFixed(4)
}

// AG CIPLERI (Hisseler sekmesi, bayrak aciksa): yalniz LISTEYI suzer, cuzdanin aktif agini DEGISTIRMEZ.
// Secim: 'all' ya da bir zincir kimligi (sayi).
export const STOCK_CHIP_ALL = 'all'
const CHIP_CHAIN_ORDER = [1, 56, 42161]

// Cip sirasi SABITTIR (Tumu, Ethereum, BSC, Arbitrum); gruplar aktif-ag-ustte siralidir, cipler degil.
export function stockChipIds(groups) {
  const rank = (id) => { const i = CHIP_CHAIN_ORDER.indexOf(id); return i === -1 ? CHIP_CHAIN_ORDER.length : i }
  const ids = [...new Set(groups.map((group) => Number(group.chainId)))].sort((a, b) => rank(a) - rank(b))
  return [STOCK_CHIP_ALL, ...ids]
}

// Baslangic: cuzdanin aktif agi hissesi olan bir agsa o, degilse Tumu. Zincir kimligi sayi ya da 0x onaltilik olabilir.
export function initialStockChip(groups, activeChainId) {
  if (activeChainId === undefined || activeChainId === null) return STOCK_CHIP_ALL
  const id = Number(activeChainId)
  return groups.some((group) => Number(group.chainId) === id) ? id : STOCK_CHIP_ALL
}

// Tumu (ya da listede olmayan secim) = tum gruplar; tek ag = yalniz o grup.
export function filterStockGroups(groups, selected) {
  if (selected === STOCK_CHIP_ALL || !groups.some((group) => Number(group.chainId) === Number(selected))) return groups
  return groups.filter((group) => Number(group.chainId) === Number(selected))
}

/**
 * Sirket satirinin TOPLAM bakiye metni (TK6/5.2): ayni zincirdeki tum seceneklerin okunabilen
 * bakiyeleri toplanir. Hicbiri yuklenmediyse / hepsi sifirsa '' ; pozitif toplam varsa 4 haneli
 * miktar ('<0.0001' toz); pozitif yok ama okunamayan secenek varsa tire (sifir DEGIL, bilinmiyor).
 */
export function companyBalanceText({ company, balances }) {
  let total = 0
  let sawError = false
  for (const row of company?.options ?? []) {
    const state = balances?.[stockKey(row.chainId, row.address)]
    if (!state) continue
    if (state.status === 'error') { sawError = true; continue }
    if (state.balance > 0n) total += Number(formatUnits(state.balance, row.decimals))
  }
  if (total > 0) return total < 0.0001 ? '<0.0001' : total.toFixed(4)
  return sawError ? UNKNOWN_TEXT : ''
}

/**
 * pickRepresentative icin deger okuyucu: (row) -> { held, usd }. held: bakiye okundu ve > 0.
 * usd: adet x birim fiyat (xStocks'ta carpana bolunmus); fiyat bilinmiyorsa null.
 */
export function companyValueOf({ balances, recordOf, multiplierOf }) {
  return (row) => {
    const state = balances?.[stockKey(row.chainId, row.address)]
    if (state?.status !== 'ok' || !(state.balance > 0n)) return { held: false, usd: null }
    const market = recordOf(row)?.market_data
    const raw = Number(market?.priceUSD)
    let unit = null
    if (market && Number.isFinite(raw)) {
      unit = row.issuer === 'xstocks' ? unitPriceUsd(market.priceUSD, multiplierOf(row)) : raw
    }
    const qty = Number(formatUnits(state.balance, row.decimals))
    return { held: true, usd: unit === null ? null : qty * unit }
  }
}

// Hisse detayi veri katmani. Tum dis bagimliliklar ENJEKTE edilir (RPC'siz, agsiz test).
// Her kaynak bagimsiz hata yutar: biri duserse digerleri gosterilir; fiyat/bakiye bilinmiyorsa
// model tire/okunamadi uretir (asla sahte 0).

import { ref, computed } from 'vue'
import { stockKey } from '../utils/tokenizedStocks'
import { loadGroupBalances } from '../utils/stocksTab'
import { fetchMarketStatus } from '../utils/stocks/marketStatus'
import {
  sameChainOptions, headerModel, priceModel, positionModel, infoBlocks, rangeDays, DEFAULT_RANGE,
} from '../utils/stocks/stockDetailModel'

/**
 * @param {object} p
 * @param {object} p.entry                katalog satiri (stockEntryForRef)
 * @param {string|null} p.owner           cuzdan adresi (yoksa bakiye okunmaz)
 * @param {(chainId:number)=>string|null} p.rpcFor
 * @param {(ids:string[])=>Promise<Array<object>>} p.fetchRecords   /getTokensDataById tokens[]
 * @param {Function} [p.readBalances]     loadGroupBalances `read` (test)
 * @param {Function} [p.fetchMarket]      (entry)=>Promise<{state,nextChangeAt}|null>
 * @param {boolean} [p.xstocksEnabled]
 */
export function useStockDetail({
  entry, owner = null, rpcFor, fetchRecords, readBalances, fetchMarket = fetchMarketStatus, xstocksEnabled,
}) {
  const options = sameChainOptions(entry, { xstocksEnabled })
  const records = ref({}) // coingeckoId -> kayit
  const balances = ref({})
  const market = ref(null)
  const range = ref(DEFAULT_RANGE)
  const recordsLoading = ref(true)
  const balancesLoading = ref(true)

  const days = computed(() => rangeDays(range.value))

  async function loadRecords() {
    try {
      const ids = [...new Set(options.map((row) => row.coingeckoId))]
      const list = await fetchRecords(ids)
      const next = {}
      for (const rec of list ?? []) if (rec?.coingecko_id) next[rec.coingecko_id] = rec
      records.value = next
    } catch {
      records.value = {}
    } finally {
      recordsLoading.value = false
    }
  }

  async function loadBalances() {
    try {
      if (!owner) { balances.value = {}; return }
      balances.value = await loadGroupBalances({
        owner,
        groups: [{ chainId: entry.chainId, rows: options }],
        rpcFor,
        ...(readBalances ? { read: readBalances } : {}),
      })
    } catch {
      balances.value = {}
    } finally {
      balancesLoading.value = false
    }
  }

  async function loadMarket() {
    try {
      market.value = (await fetchMarket(entry)) ?? null
    } catch {
      market.value = null
    }
  }

  const multiplierOf = (row) => balances.value[stockKey(row.chainId, row.address)]?.multiplier ?? null

  const header = computed(() => headerModel(entry, options))
  const price = computed(() => priceModel({
    entry, record: records.value[entry.coingeckoId], multiplier: multiplierOf(entry),
  }))
  const position = computed(() => positionModel({
    options, balances: balances.value, records: records.value, multiplierOf,
  }))
  const info = computed(() => infoBlocks({ entry, options, balances: balances.value }))

  /** Hepsini paralel yukler; reject YOKTUR. */
  function load() {
    return Promise.all([loadRecords(), loadBalances(), loadMarket()]).then(() => undefined)
  }

  return {
    options, range, days, records, balances, market, header, price, position, info,
    recordsLoading, balancesLoading, load,
  }
}

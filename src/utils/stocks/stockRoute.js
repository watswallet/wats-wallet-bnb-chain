// TK2: hisse yonlendirmesi (saf, ag/saglayici yok).
// bStocks HER ZAMAN hisse ekranina duser; xStocks yalniz XSTOCKS_ENABLED iken (bayrak
// kapaliyken xStock detayi bugunku gibi duz Token.vue kalir).
import { stockEntry } from '../tokenizedStocks'
import { XSTOCKS_ENABLED } from '../featureFlags'

/**
 * ref = crypto.selected_token_ref. Hisse degilse null.
 * GIZLI MOD (Dilim 0c G5, E-R12a): `privateMode` true ise HER ZAMAN null. Hisse ekranlari (StockDetail, StockTrade,
 * StockAtsFeeCard -> AtsBuyButton) ozel modda KAPALIDIR (sahip karari 2026-10-16); hisse tokeni siradan Token ekranina
 * duser. App.vue `isStockPage` tek kaynaktir ve bunu `privacy.active` ile cagirir.
 */
export function stockEntryForRef(ref, { xstocksEnabled = XSTOCKS_ENABLED, privateMode = false } = {}) {
  if (privateMode) return null
  if (!ref || typeof ref.address !== 'string' || !ref.address) return null
  const entry = stockEntry(ref.chainId, ref.address)
  if (!entry) return null
  if (entry.issuer === 'bstocks') return entry
  return entry.issuer === 'xstocks' && xstocksEnabled ? entry : null
}

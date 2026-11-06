// TK2: hisse yonlendirmesi (saf, ag/saglayici yok).
// bStocks HER ZAMAN hisse ekranina duser; xStocks yalniz XSTOCKS_ENABLED iken (bayrak
// kapaliyken xStock detayi bugunku gibi duz Token.vue kalir).
import { stockEntry } from '../tokenizedStocks'
import { XSTOCKS_ENABLED } from '../featureFlags'

/** ref = crypto.selected_token_ref. Hisse degilse null. */
export function stockEntryForRef(ref, { xstocksEnabled = XSTOCKS_ENABLED } = {}) {
  if (!ref || typeof ref.address !== 'string' || !ref.address) return null
  const entry = stockEntry(ref.chainId, ref.address)
  if (!entry) return null
  if (entry.issuer === 'bstocks') return entry
  return entry.issuer === 'xstocks' && xstocksEnabled ? entry : null
}

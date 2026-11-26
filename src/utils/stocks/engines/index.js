// Motor kaydi: hisse satirindan (katalog kaydi) motoru secer. Spec 7.2.
// pancake dogrudan import edilir (pancakeEngine bu dosyayi import ETMEZ: dairesel import yok);
// `registerEngine('pancake', engine)` yalniz test icin degistirir. cow ve lcx sabittir ve degistirilemez.
import { LCX_ENABLED, XSTOCKS_ENABLED } from '../../featureFlags'
import { cowEngine } from './cowEngine'
import { lcxEngine } from './lcxEngine'
import { pancakeEngine } from './pancakeEngine'

const registry = { cow: cowEngine, pancake: pancakeEngine, lcx: lcxEngine }

export function registerEngine(id, engine) {
  if (id !== 'pancake') throw new Error(`registerEngine: bilinmeyen veya degistirilemez motor: ${id}`)
  registry.pancake = engine ?? null
}

export const engineFor = (entry) => {
  // LCX satiri (dinamik katman) ONCE sorulur: ihracci kimligi ne yazarsa yazsin statik motorlara dusmez.
  if (entry?.source === 'lcx') return registry.lcx
  if (entry?.issuer === 'xstocks') return registry.cow
  if (entry?.issuer === 'bstocks') return registry.pancake
  return null
}

// LCX satiri yalniz `lcxEnabled`e bakar (LCX_ENABLED); statik satirlarin kurali aynen: bStocks her zaman, xStocks bayrakla.
export const tradeEnabledFor = (entry, { xstocksEnabled = XSTOCKS_ENABLED, lcxEnabled = LCX_ENABLED } = {}) => {
  if (entry?.source === 'lcx') return Boolean(lcxEnabled)
  return entry?.issuer === 'bstocks' || (entry?.issuer === 'xstocks' && Boolean(xstocksEnabled))
}

export { cowEngine, lcxEngine, pancakeEngine }
// ATS ucret teklifinin LCX yaniti -> motor kodu (ekran, ATS reddinin sebebini okunur metinle gosterir).
export { lcxReplyCode } from './lcxEngine'

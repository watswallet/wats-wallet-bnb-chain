// Motor kaydi: hisse satirindan (katalog kaydi) motoru secer. Spec 7.2.
// pancake dogrudan import edilir (pancakeEngine bu dosyayi import ETMEZ: dairesel import yok);
// `registerEngine('pancake', engine)` yalniz test icin degistirir. cow sabittir ve degistirilemez.
import { XSTOCKS_ENABLED } from '../../featureFlags'
import { cowEngine } from './cowEngine'
import { pancakeEngine } from './pancakeEngine'

const registry = { cow: cowEngine, pancake: pancakeEngine }

export function registerEngine(id, engine) {
  if (id !== 'pancake') throw new Error(`registerEngine: bilinmeyen veya degistirilemez motor: ${id}`)
  registry.pancake = engine ?? null
}

export const engineFor = (entry) => {
  if (entry?.issuer === 'xstocks') return registry.cow
  if (entry?.issuer === 'bstocks') return registry.pancake
  return null
}

export const tradeEnabledFor = (entry, { xstocksEnabled = XSTOCKS_ENABLED } = {}) =>
  entry?.issuer === 'bstocks' || (entry?.issuer === 'xstocks' && Boolean(xstocksEnabled))

export { cowEngine, pancakeEngine }

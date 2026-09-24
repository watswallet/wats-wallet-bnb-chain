// Zincirin native varligi hakkinda gosterim ve fiyat bilgisi.
//
// swapChains.js'ten AYRI durur: o dosya duz Node ile calisan dogrulama betigi
// tarafindan import ediliyor ve Node ESM, import attribute'suz JSON import'unu
// reddediyor. Bu dosya JSON okudugu icin ayri tutuldu.

import supported_chains from '../data/supportedChains'

function chainEntry(chainId) {
  const entry = supported_chains.find((chain) => chain.chainId === Number(chainId))
  if (!entry) throw new Error(`Desteklenmeyen zincir: ${chainId}`)
  return entry
}

export const getNativeSymbol = (chainId) => chainEntry(chainId).nativeCurrency.symbol
export const getNativeCoingeckoId = (chainId) => chainEntry(chainId).nativeCoingeckoId

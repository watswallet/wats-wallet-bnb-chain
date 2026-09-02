// Hesabin token haritasina TON native satirini ekler.
//
// Ana ekran listesi `imported_tokens[account.key][chainId]` uzerinden kuruluyor ve
// CAPRAZ ZINCIR (tum aglarin tokenlari bir arada). TON satiri buraya girmezse
// kullanicinin TON bakiyesi hicbir yerde gorunmez.
//
// Girdi YERINDE degistirilmez: cagiran taraf `changed` false ise diske yazmaz.
import { buildNativeToken } from '../nativeToken'
import { TON_MAINNET_ID } from '../chainKind'

const KEY = String(TON_MAINNET_ID)

export function ensureTonNativeToken(byChain) {
    const source = byChain && typeof byChain === 'object' ? byChain : {}
    const existing = source[KEY]

    if (Array.isArray(existing) && existing.length > 0) {
        return { changed: false, byChain: source }
    }

    const native = buildNativeToken(TON_MAINNET_ID)
    if (!native) return { changed: false, byChain: source }

    // Ana ekran satiri `coingecko_id` bekliyor (getTokensDataById govdesi) ve
    // `id` alanini SearchTokens kullaniyor; buildNativeToken ikisini de saglamaz.
    const row = { ...native, id: native.coingecko_id }

    return { changed: true, byChain: { ...source, [KEY]: [row] } }
}

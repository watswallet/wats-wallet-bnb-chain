// chainId -> analytics ag anahtari (saf katman, S6).
//
// NEDEN sabit tablo: anahtar kumesi sunucuyla paylasilan KAPALI listedir
// (NETWORK_KEYS). Zincir kaydindan tureyen bir ad, ozel/ileri zincirlerin adini
// ya da bilinmeyen bir degeri sunucuya sizdirabilirdi. Cozulemeyen HER sey 'other'.
// Testnet (TON -3 dahil) bilerek tabloda yok: 'other'e duser.

export const NETWORK_KEY_BY_CHAIN = {
    1: 'eth',
    56: 'bsc',
    10: 'op',
    100: 'gnosis',
    42220: 'celo',
    5000: 'mantle',
    8453: 'base',
    25: 'cronos',
    42161: 'arb',
    137: 'polygon',
    '-239': 'ton',
    'solana-mainnet': 'solana'
}

// Kimligi tablo anahtarina cevirir: sayi, hex dize ('0x38') ve sayisal dize ('56')
// ayni sonucu verir. Cozulemezse null.
function normalize(chainId) {
    if (typeof chainId === 'number') return Number.isSafeInteger(chainId) ? String(chainId) : null
    if (typeof chainId !== 'string') return null
    const s = chainId.trim()
    if (s === 'solana-mainnet') return s
    if (/^0x[0-9a-f]+$/i.test(s)) return String(parseInt(s, 16))
    if (/^-?\d+$/.test(s)) return String(Number(s))
    return null
}

export function networkKeyForChain(chainId) {
    const key = normalize(chainId)
    if (key === null) return 'other'
    return Object.prototype.hasOwnProperty.call(NETWORK_KEY_BY_CHAIN, key) ? NETWORK_KEY_BY_CHAIN[key] : 'other'
}

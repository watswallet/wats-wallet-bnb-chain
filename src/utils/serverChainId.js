// Sunucu zincir kimligi <-> istemci zincir kimligi eslemesi -- SAF katman.
//
// Sunucu EVM disi zincirleri NEGATIF SAYISAL kimlikle adresler (TON -239, Solana
// -101; bkz. server/utils/solanaSplTokens.js). Istemcide TON ayni kimligi tasir,
// Solana ise bilerek METIN kimliklidir ('solana-mainnet'): EVM kimlik uzayiyla
// cakismamasi gerekir. Iki uzay arasindaki TEK gecit burasidir.
//
// KRITIK: pozitif 101 gercek bir EVM kimligidir; yalniz NEGATIF -101 Solana'dir.
//
// AG YOK, DEPO YOK, chrome YOK: yalniz ./solana/constants ve ./vm okunur
// (nativeAsset.js de saftir; native yer tutucu kararinin TEK kaynagi).
import { SOLANA_CHAIN_ID } from './solana/constants'
import { isSameChainId } from './vm'
import { isNativeAsset } from './nativeAsset'

// server/utils/solanaSplTokens.js:21 ile esitligi serverChainId.test.js kilitler.
export const SOLANA_SERVER_CHAIN_ID = -101

// Number()'a dogrudan guvenilmez: Number('') ve Number(null) 0, Number(true) 1.
// Bunlar kimlik DEGILDIR; cozulememis bir zincir chainId 0 olarak gecmemeli.
function finiteChainId(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value)
        return Number.isFinite(n) ? n : null
    }
    return null
}

/**
 * Istemci kimligini sunucunun kimligine cevirir. Solana -> -101; digerleri
 * sonlu sayi; cozulemeyen `null`.
 */
export function toServerChainId(id) {
    if (isSameChainId(id, SOLANA_CHAIN_ID)) return SOLANA_SERVER_CHAIN_ID
    return finiteChainId(id)
}

/**
 * Sunucunun kimligini istemcininkine cevirir. -101 -> 'solana-mainnet'; digerleri
 * (pozitif 101 EVM, TON -239 dahil) sayi olarak aynen; sonlu degilse `null`.
 */
export function fromServerChainId(id) {
    const n = finiteChainId(id)
    if (n === null) return null
    return n === SOLANA_SERVER_CHAIN_ID ? SOLANA_CHAIN_ID : n
}

/**
 * Sunucu token satirlarini istemci kimligiyle damgalar. Kimligi cozulemeyen satir
 * elenir. Solana'da sunucunun '0x0' native SOL satiri atilir: o adres Solana
 * tarafinda bir SPL mint'i sayilirdi (yanlis varlik); SOL zincirden okunur
 * (composables/useSolanaAssets.js).
 */
export function stampServerTokens(rows, fallbackChainId) {
    if (!Array.isArray(rows)) return []

    const out = []
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue

        const chainId = fromServerChainId(row.chainId ?? fallbackChainId)
        if (chainId === null) continue
        if (chainId === SOLANA_CHAIN_ID && isNativeAsset(row.address)) continue

        out.push({ ...row, chainId })
    }
    return out
}

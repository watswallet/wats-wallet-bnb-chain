// LCX yol SECIMI -- saf modul: ag yok, chrome yok, depo yok.
//
// Arka plan (Gorev 6-7) ve Takas ekrani (Gorev 8) "bu takas LCX'ten mi yurutulsun" sorusunu burada
// verilen yardimcilarla cevaplar. Hicbiri LCX'e istek atmaz; yalniz karar verir. KARAR KAPALI
// BASARISIZDIR: belirsiz her girdi LCX'i secmez, yani bugunku (yedek) takas yolu surer.

import { getAddress } from 'ethers'
// Native isaretcilerinin TEK kaynagi: '0x0', ZeroAddress ve 0xEeee...EEeE. (Bu modul ethers'a DEGIL duz metne
// dayanir; yoksa kismi `vi.mock('ethers')` yapan testler onu dolayli import edince yuklenemez -- bkz. notu.)
import { isNativeAsset } from '../nativeAsset.js'
import { LCX_NATIVE } from './routerGuard.js'

// LCX'in destekledigi sekiz ag (plan: Global Constraints). Router adresleri routerGuard.js'te.
export const LCX_CHAIN_IDS = Object.freeze([1, 56, 10, 137, 42161, 8453, 100, 25])

// LCX kayma siniri baz puan olarak [1, 2000] (yuzde 0,01 - 20).
const MIN_SLIPPAGE_BPS = 1
const MAX_SLIPPAGE_BPS = 2000

/**
 * Eklentinin token adresini LCX bicimine cevirir. Eklenti native'i birden cok bicimde gosterir ('0x0', ZeroAddress,
 * 0xEeee...EEeE: nativeAsset.js isNativeAsset); LCX native icin tam 40 haneli sifir adresi bekler. ERC-20 adresleri
 * checksum'lanir.
 * @param {string} address
 * @returns {string}
 * @throws null / undefined / bos dize / adres olmayan girdide (isNativeAsset bunlara "native" derdi ama burada
 *   sessizce native'e cevrilmez; cagiran LCX yolunu secmemeli).
 */
export function toLcxToken(address) {
    if (typeof address !== 'string' || address.trim() === '') {
        throw new TypeError('toLcxToken: adres bos ya da dize degil')
    }
    if (isNativeAsset(address)) return LCX_NATIVE
    return getAddress(address)
}

/**
 * Arayuzdeki kayma YUZDESINI (0.5) LCX'in baz puanina (50) cevirir: Math.round(p * 100).
 * [1, 2000] disi ve sayi olmayan her girdi null -- cagiran LCX yolunu secmez (yedek yol surer).
 * @param {number|string} percent
 * @returns {number|null}
 */
export function slippageToBps(percent) {
    if (typeof percent !== 'number' && typeof percent !== 'string') return null
    // Bos / bosluklu dizge Number() ile 0 olur; zaten aralik disi, ama niyeti acik tut.
    if (typeof percent === 'string' && percent.trim() === '') return null
    const n = Number(percent)
    if (!Number.isFinite(n)) return null
    const bps = Math.round(n * 100)
    return bps >= MIN_SLIPPAGE_BPS && bps <= MAX_SLIPPAGE_BPS ? bps : null
}

/**
 * LCX yolu bu takas icin hic denenebilir mi? Yalniz TUM kosullar saglaninca true:
 *   bayrak acik, imzaci Gizli Hesap DEGIL (gizli modda LCX'e ve /lcx/*'a hic istek yok),
 *   ag LCX agi, kayma gecerli.
 * `privateSigner` AYNEN false olmali: eksik ya da yanlis yazilmis (undefined), null, 0 ve 'false' dizgesi kapiyi
 * ACMAZ. Bu, "gizli modda LCX'e hic istek yok" kuralinin tek koruyucusudur; kapali basarisiz olmak zorundadir.
 * @param {{ enabled: boolean, privateSigner: boolean, chainId: number, slippageBps: number|null }} p
 */
export function lcxEligible({ enabled, privateSigner, chainId, slippageBps }) {
    return (
        enabled === true &&
        privateSigner === false &&
        LCX_CHAIN_IDS.includes(chainId) &&
        Number.isInteger(slippageBps) &&
        slippageBps >= MIN_SLIPPAGE_BPS &&
        slippageBps <= MAX_SLIPPAGE_BPS
    )
}

/**
 * Teklif turu: iki taraf da o agin stablecoin kumesindeyse 'stable', digerlerinde 'swap'.
 * Native taraf, kume bos / yok ya da ag icin kayit yoksa 'swap' (stable yolu kapanir, genel takas surer).
 * Hisse (rwa) secimi Bolum 2'dir; burada uretilmez.
 * @param {{ chainId: number, tokenIn: string, tokenOut: string, stablecoins: Map<number, Set<string>> }} p
 *   stablecoins: fetchLcxStablecoins() sonucu (kucuk harfli adresler).
 * @returns {'stable'|'swap'}
 */
export function lcxKindFor({ chainId, tokenIn, tokenOut, stablecoins }) {
    const set = stablecoins instanceof Map ? stablecoins.get(chainId) : undefined
    if (!(set instanceof Set) || set.size === 0) return 'swap'
    if (isNativeAsset(tokenIn) || isNativeAsset(tokenOut)) return 'swap'
    if (typeof tokenIn !== 'string' || typeof tokenOut !== 'string') return 'swap'
    return set.has(tokenIn.toLowerCase()) && set.has(tokenOut.toLowerCase()) ? 'stable' : 'swap'
}

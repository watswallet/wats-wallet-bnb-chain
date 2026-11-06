import { chainLogo } from '../chainLogo'
import { deliveryChainOf } from './deliveryChains'
import { localTokenLogoPath } from './localTokenLogos'

// GIZLI MODDA YEREL COINLERIN LOGOSU + AG ROZETI (privateTokenLogo.js'in SDK'siz alt katmani). Ayri dosya cunku privateDefaultTokens.js
// (Home'un yerel coin satiri) bu logolara ihtiyac duyar ama import zinciri @silentswap/* paketini cekemez (privatePopupImports.test.js); token
// cozucusu ise SDK kayit defterini okur. Logo kurali TEK yerdedir: privateTokenLogo.js yerel coin dalinda buradaki islevleri cagirir.
export const UNKNOWN_TOKEN_LOGO = '/default-token.png'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const XDAI_CHAIN_ID = 100

// Coin sembolu -> coinin paketli logosu. Tek coinli aglarda coinin logosu aginkiyle ayni dosyadir (BNB: /chains/56.png), bu yuzden dosya "evi" olan
// aginin logosundan okunur; ETH'in evi Ethereum'dur (/chains/1.png ETH elmasi), L2 logolari (Base, Arbitrum, Optimism) ETH degildir. xDAI'nin
// logosu Gnosis aginin logosu (baykus, GNO) DEGILDIR: kendi dosyasi (Gnosis, sifir adres) paketlidir.
const COIN_HOME_CHAIN = Object.freeze({ ETH: 1, BNB: 56, POL: 137, CELO: 42220, MNT: 5000, CRO: 25 })

/** Coin sembolunun paketli logosu (ag bilinmese de); paketli logosu olmayan sembol icin null. */
export function coinLogoOf(symbol) {
    if (typeof symbol !== 'string') return null
    if (Object.hasOwn(COIN_HOME_CHAIN, symbol)) return chainLogo(COIN_HOME_CHAIN[symbol], null)
    if (symbol === 'XDAI') return localTokenLogoPath(XDAI_CHAIN_ID, ZERO_ADDRESS)
    return null
}

/**
 * Bir agin yerel coininin logosu (COININ logosu: Base'te ETH = ETH elmasi). Ag teslim tablosunda biliniyorsa coin tablodaki sembolden
 * (ag kazanir), degilse verilen sembolden cozulur; once (ag, sifir adres) paketli dosyasi aranir. Cozulemezse null.
 */
export function nativeCoinLogo(chainId, symbol) {
    const chain = deliveryChainOf(chainId)
    if (chain) {
        const exact = localTokenLogoPath(chain.chainId, ZERO_ADDRESS)
        if (exact) return exact
    }
    return coinLogoOf(chain ? chain.nativeSymbol : symbol)
}

/** Cipin sag alt rozeti: teslim agi tablosundaki agin paketli logosu; ag okunamiyorsa null (rozet cizilmez). */
export function privateChainBadge(chainId) {
    const chain = deliveryChainOf(chainId)
    return chain ? chainLogo(chain.chainId, null) : null
}

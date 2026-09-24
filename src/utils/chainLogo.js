// Zincir kimliginden AD ve LOGO cozumlemesi — tek kopya.
//
// NEDEN BURADA: ayni uc satir alti bilesende kopyalanmisti (Home.vue,
// NetworkScopePill.vue, SelectAssets.vue, SearchTokens.vue, swap/swapFrom.vue,
// bridge/bridgeFrom.vue) ve DORDU karsilastirmayi `Number()` ile yapiyordu.
// Solana'nin kimligi METIN ('solana-mainnet'); Number('solana-mainnet') NaN ve
// NaN === NaN yanlis — o dort yerde Solana rozeti sessizce varsayilana dusuyordu.
// Karsilastirma artik TEK yerde ve isSameChainId ile (bkz. utils/vm.js).
//
// ARAMA ALL_CHAINS uzerinde, LISTED_CHAINS uzerinde DEGIL: testnet kayitlari prod
// derlemesinde LISTEDEN duser ama kimlik cozumlemesi ASLA filtrelenmemeli — aksi
// halde gecmisteki bir testnet islemi adsiz/logosuz kalir.

import { ALL_CHAINS } from '../data/chains'
import { isSameChainId } from './vm'

// SelectAssets.ssr.test.js:288 bu dizeye BAGLI — varsayilan yedek DEGISMEZ.
export const DEFAULT_CHAIN_LOGO = '/default-chain.png'

/** Zincir kaydinin kendisi; cozulemezse undefined. */
export function chainOf(chainId) {
    return ALL_CHAINS.find((c) => isSameChainId(c.chainId, chainId))
}

/**
 * Zincirin logo URL'i.
 *
 * Yedek CAGIRANA birakilabilir: '/default-chain.png' dosyasi client/public altinda
 * GERCEKTEN yok, yani varsayilani basmak KIRIK RESIM cizer. Rozet cizen yerler onu
 * (gorsel gerileme olmasin diye) oldugu gibi kullanir; islem karti ise ACIKCA null
 * verip TokenLogo monogramina duser.
 */
export function chainLogo(chainId, fallback = DEFAULT_CHAIN_LOGO) {
    return chainOf(chainId)?.logoURI || fallback
}

/**
 * Zincirin adi; cozulemezse BOS DIZE — cagiran kendi metnine dussun diye
 * (kartta t('header.network')). Uydurulmus bir ad, anlasilmayan bir addan kotudur.
 */
export function chainName(chainId) {
    return chainOf(chainId)?.name || ''
}

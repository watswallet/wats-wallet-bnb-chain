import { evmOnlyFeatures } from './evmGates'

/**
 * TonConnect istek tipleri. Bunlar aktif agdan BAGIMSIZ (tasarim belgesi K3):
 * `window.wats.tonconnect` ile `window.ethereum` ayri ad alanlaridir ve kullanici
 * Ethereum'da dururken de bir TON dapp'ine baglanabilir.
 *
 * Kume ACIKCA sayilir, "EVM tipi degilse TON'dur" DENMEZ: yarin eklenecek
 * uctuncu bir VM'in istegi sessizce bu muafiyete girmemeli.
 */
export const TON_REQUEST_TYPES = new Set(['TON_CONNECT', 'TON_SEND_TX', 'TON_SIGN_DATA'])

/**
 * Solana onay istek tipleri. TON kumesiyle AYNI gerekce (K6): oturum aktif agdan
 * BAGIMSIZ, `window.solana` ile `window.ethereum` ayri ad alanlaridir.
 *
 * AYRI kume, TON'unkinin genisletilmesi DEGIL: "EVM tipi degilse muaftir" demek,
 * yarin eklenecek dorduncu bir VM'in istegini sessizce bu muafiyete sokardi
 * (yukaridaki ayni not). Zincir kapilari (chainSupportsFlow / evmOnlyFeatures)
 * GENISLETILMEZ -- onlar "EIP-1193 burada calisir" diyor ve dogru soyluyorlar.
 */
export const SOLANA_REQUEST_TYPES = new Set(['SOLANA_CONNECT', 'SOLANA_SIGN_TX', 'SOLANA_SIGN_MESSAGE'])

/**
 * Bekleyen bir dapp istegi (`current_request`: CONNECT/SEND_TX/SIGN_MESSAGE) hala
 * GECERLI mi -- saf katman.
 *
 * KOK NEDEN (F5, kod incelemesi): `current_request` diskte KALICI ve onu temizleyen
 * TEK yer (`resolvePendingRequest`, dappFunctions.js) yalniz modul-kapsamli
 * `pendingRequests` Map'inde bir kayit VARSA calisir. Bu Map bir MV3
 * service-worker yeniden baslatilmasinda (uzanti guncellemesi, tarayici uyku
 * modu...) BOSALIR -- yani eski bir istek diskte kalabilir. App.vue bunu SADECE
 * `current_request.type`e bakarak yonlendiriyordu (chain kontrolu YOKTU) ve
 * Dapp.vue TAMAMEN EVM'e ozel (`currentNetwork.rpc[0].url` guard'siz okur, bkz.
 * Dapp.vue'daki not) -- aktif ag Solana'ysa bu TypeError'a duserdi, dapp onay
 * ekraninin TAM ORTASINDA.
 *
 * Bu istek zaten hicbir zaman Solana aktifken YENI YAZILAMAZDI (eth_requestAccounts/
 * eth_sendTransaction giriste requireEvmChain ile reddeder, bkz. dappFunctions.js);
 * yani "istek var AMA aktif ag EVM degil" durumu HER ZAMAN bayat/gecersiz bir
 * kayittir, gecerli bir kullanici akisi degil.
 */
export function isDappRequestStale(currentRequest, currentNetwork) {
    if (!currentRequest) return false
    // TIP once sorulur: EVM kapisi TON istegine hic UYGULANMAZ. Sira ters olsaydi
    // evmOnlyFeatures(TON).dapp === false, gecerli bir TON istegini bayat sayardi.
    if (TON_REQUEST_TYPES.has(currentRequest.type)) return false
    // TON satirindaki AYNI sira gerekcesi: TIP once sorulur. Bu satir olmadan
    // evmOnlyFeatures(Solana).dapp === false, GECERLI bir Solana onay kaydini
    // popup acilir acilmaz bayat sayip siler.
    if (SOLANA_REQUEST_TYPES.has(currentRequest.type)) return false
    return !evmOnlyFeatures(currentNetwork).dapp
}

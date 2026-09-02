import { chainVm, rpcUrlsOf } from './vm'

/**
 * EVM'e ozgu ozelliklerin acik/kapali durumu -- ARAYUZ icin tek kaynak.
 *
 * Arayuz bu bayraklarla dugmeleri gizler (`v-if`, `disabled` DEGIL: Solana'da
 * anlamsiz gri bir dugme "bu ozellik bozuk" izlenimi verir, "burada gecerli
 * degil" degil). Background AYRICA `requireEvmChain` ile korunur -- iki katman
 * GEREKLI: arayuz gizlese de bir mesaj her zaman background'a ulasabilir (eski
 * bir popup, baska bir sekme, bir dapp).
 *
 * Zincir cozulemediginde (`chain` null/undefined) HEPSI KAPALI: acik varsaymak,
 * arayuzun var olmayan bir RPC ile calismaya kalkmasi demek.
 *
 * BES BAYRAK AYNI KOSULA BAGLI DEGIL -- kasitli:
 *   - swap/bridge: motoru calistirmak icin zincirin KENDI RPC'sine ihtiyac
 *     duyar (bakiye, quote, islem kurma/gonderme). RPC yoksa bu ikisi zaten
 *     calisamaz; `rpcUrlsOf(chain).length > 0` bu yuzden ekli.
 *   - ats/buy/dapp: hicbiri o an SECILI zincirin RPC'sine bakmaz. ATS yakit
 *     hapi bakiyeyi HER ZAMAN BSC'den okur (AtsFuelPill.vue); MoonPay satin
 *     alma bir imza URL'i uretip yeni sekmede acar; eth_requestAccounts/
 *     eth_chainId de zaten var olan bir adresi/kimligi bildirir. Bunlari da
 *     rpc sartina baglamak, "EVM mi" sorusuyla "bu EVM zincirin RPC'si su an
 *     calisiyor mu" sorusunu (ilgisiz, ayri bir ariza modu) birbirine karistirir
 *     ve gercek bir EVM zincirinde -- yalnizca rpc alani bos/yanlis girildiyse --
 *     bu uc ozelligi de gerekcesizce kapatirdi.
 */
export function evmOnlyFeatures(chain) {
    const isEvm = !!chain && chainVm(chain) === 'evm'
    const hasWorkingRpc = isEvm && rpcUrlsOf(chain).length > 0

    return {
        swap: hasWorkingRpc,
        bridge: hasWorkingRpc,
        ats: isEvm,
        buy: isEvm,
        dapp: isEvm,
    }
}

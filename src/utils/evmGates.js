import { chainVm } from './vm'

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
 * UC BAYRAK, TEK KOSUL: yalnizca "bu zincir EVM mi". Hicbiri o an SECILI
 * zincirin RPC'sine bakmaz -- ATS yakit hapi bakiyeyi HER ZAMAN BSC'den okur
 * (AtsFuelPill.vue); MoonPay satin alma bir imza URL'i uretip yeni sekmede
 * acar; eth_requestAccounts/eth_chainId de zaten var olan bir adresi/kimligi
 * bildirir. Bunlari rpc sartina baglamak, "EVM mi" sorusuyla "bu EVM zincirin
 * RPC'si su an calisiyor mu" sorusunu (ilgisiz, ayri bir ariza modu) birbirine
 * karistirirdi ve gercek bir EVM zincirinde -- yalnizca rpc alani bos/yanlis
 * girildiyse -- uc ozelligi de gerekcesizce kapatirdi.
 *
 * BURADA `swap`/`bridge` YOK, VE BU BILINCLI BIR KALDIRMADIR.
 *
 * Bu iki bayrak bir donem burada duruyordu ve "EVM + rpc listesi dolu"
 * soruyordu. TON takasinin (STON.fi) kapisi `chainSupportsFlow`a tasinip her
 * iki ekran korumasi da (Swap.vue, Bridge.vue -> useFlowScreenGuard) o tabloya
 * baglaninca bu alanlarin UretimDE TEK BIR OKUYUCUSU KALMADI. Yine de burada
 * durmalari ZARARSIZ DEGILDI: `evmOnlyFeatures(TON).swap === false` cumlesi
 * hala OTORITE GIBI OKUNUYOR ama hicbir sey onu okumuyordu -- ve TAM OLARAK bu
 * (iki kapinin ayni soruya farkli cevap vermesi, birinin sessizce yururlukte
 * sanilmasi) kalici siyah ekrani ureten celiskiydi. Yarin biri "zaten var" diye
 * `features.swap`e geri baglanirsa celiski da geri gelir.
 *
 * "Bu akis bu zincirde anlamli mi" sorusunun TEK adresi artik
 * `chainSupportsFlow(chain, FLOW.X)` (utils/chainKind.js) -- dugmeyi SUNAN
 * otorite de (Home.vue, Token.vue canSwap/canBridge) ekrani KAPATAN otorite de
 * odur.
 */
export function evmOnlyFeatures(chain) {
    const isEvm = !!chain && chainVm(chain) === 'evm'

    return {
        ats: isEvm,
        buy: isEvm,
        dapp: isEvm,
    }
}

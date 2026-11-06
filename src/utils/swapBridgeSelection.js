// Takas ve Kopru ekranlarinin secili token / zincir / tutar durumunu sifirlar.
//
// TEK GOVDE, iki cagiran: aktif ag degisince (applyNetworkChange.js) ve gizli moddan cikista ag
// geri yuklenince (PrivacyToggle.vue, P5 / SP2 spec 4.9). Neden ikincisi de gerekli: cikista ag,
// storage.onChanged -> uiSync.adoptNetwork ile popup'a ULASIR ama adoptNetwork secimleri temizlemez
// (yalniz chainId'ye gore agi benimser). Gizli oturumda baska agda secilmis bir token geri
// yuklenen agda YOKTUR; birakilirsa kullanici farkinda olmadan yanlis zincirin adresine islem kurar.
//
// `crypto` cryptoStore() ornegidir; parametre olarak alinir ki modul store zincirini import etmesin
// (saf ve testi kolay). Baska hicbir alana (sendAsset, secili token, taslak) dokunulmaz.
export function clearSwapBridgeSelection(crypto) {
    crypto.bridge.amount = 0
    crypto.bridge.inToken = null
    crypto.bridge.outToken = null
    crypto.bridge.toChain = null

    crypto.swap.inToken = null
    crypto.swap.outToken = null
}

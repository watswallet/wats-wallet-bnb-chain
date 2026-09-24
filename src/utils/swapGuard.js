// Swap gonderiminin BLOKLAMA SEBEBI — saf katman.
//
// Kararlar Swap.vue'daki eski `isValid()` ile BIREBIR ayni; degisen tek sey sebebin
// adlandirilmasi. Gerekce: buton metni sebebi soylemek zorunda ve bugun YALAN
// soyluyordu. Polygon bir ATS zinciri (atsConfig.js), ama `refreshAtsOpFee`
// "token yoksa cik" ile hic calismadigi icin `atsReady` false'ta cakiliyor ve
// buton kalici olarak "ATS ile gonderilemiyor" yaziyordu — oysa gercek sebep
// girdi tokeninin hic secilmemis olmasiydi. Sirayi tek yerde tutmak, metnin ve
// engelin ayni kaynaktan turemesini saglar.

/**
 * @returns {null|string} null ise gonderime izin var. Ilk eslesen sebep doner.
 */
export function swapBlockReason(s = {}) {
    // Zincir cozulemiyorsa geri kalan her sey anlamsiz.
    if (!s.chainSupported) return 'unsupported-chain'

    // ATS dalindan ONCE: bugunku yalanin kok noktasi.
    if (!s.inToken) return 'select-in-token'
    if (!s.outToken) return 'select-out-token'

    if (!s.amount || Number(s.amount) <= 0) return 'enter-amount'

    // Bakiye HENUZ bilinmiyorken gonderime izin verilmez.
    if (s.balanceLoading) return 'balance-loading'
    if (s.insufficientBalance) return 'insufficient-balance'

    if (s.loading || s.swapLoading) return 'quote-loading'

    // TEKLIF YOKSA GONDERIM YOK. ("Teklif alinamadi" karti ekranda dururken
    // Takas dugmesi PARLIYORDU - 2026-09-15 kullanici ekran goruntusu.)
    //
    // Kapinin agirligi EVM kolunda: background/swap() teklifi mesajdan ALMIYOR,
    // MultiChainSwapManager kendi teklifini cekip takasi GERCEKTEN yapiyor. Yani
    // ekranda hicbir fiyat gorulmemisken para el degistirebiliyordu. TON kolunda
    // zincir korunuyordu (prepareTonSwap KAPI 1, TON_SWAP_QUOTE_STALE) ama ekran
    // gonderimden hemen sonra Ana Sayfa'ya atladigi icin kullanici YANLIS bir
    // sebep goruyordu: "bayat teklif" -- oysa teklif HIC alinamamisti.
    //
    // Bridge'de bu kapi zaten vardi (Bridge.vue isValid: `|| !bridgeData.value`);
    // Swap'ta HIC olmadi (ilk commit dbd1578'deki isValid de teklife bakmiyor),
    // yani bu refaktorun getirdigi bir gerileme degil, bastan acik kalmis delik.
    //
    // YUKLEME SEBEPLERINDEN SONRA: teklif yoldayken dogru sebep "yukleniyor";
    // "teklif yok" demek gelmekte olan teklifi OLMAYAN gibi gosterirdi.
    // ATS DALINDAN ONCE: o dal kendi `return null`u ile biter, sonrasina konsaydi
    // delik tam da takasin sessizce gerceklestigi kolda ACIK kalirdi.
    //
    // KAPALI VARSAYILANLI: alan hic verilmezse de engeller. Teklifi tasimayi
    // unutan bir cagiran, fiyatsiz gonderim yapan bir cagirandir.
    if (!s.hasQuote) return 'no-quote'

    if (s.payWithAts) {
        // §06.1 tavani: asilirsa op zincirde AA33 ile duser ve gaz yanar.
        if (s.atsCapExceeded) return 'ats-cap'
        if (s.atsLoading) return 'ats-loading'
        // Hazir olmayan bir /status ile gondermek op'u ucus sirasinda oldurur ve
        // BSC'de bir bootstrap hakki yakar.
        if (!s.atsReady) return 'ats-not-ready'
        // ATS kolunda native yetersizligi ENGEL DEGILDIR: ucret zaten ATS ile
        // odenir. Secili bir Pimlico fee-token'inin yetersizligi de konu disidir.
        return null
    }

    // TON relay kolu: EVM'deki `ats-not-ready` ile AYNI is. Bloklayici bir ucret
    // karari (kurulum gerekli, ATS gerekli, /status okunamadi) varken butonu acik
    // birakmak, gonderimi sessizce self-pay'e dusurur — kullaniciya gasless
    // soylenmisken KENDI TON'u yanar (2026-09-01 olcumu, ConfirmTransaction'da AYNI
    // bosluk). ATS dali yukarida kendi `return null`u ile bittigi icin bu kapi yalniz
    // TON kolunda calisir; ikisi zaten ayni anda acik olamaz.
    if (s.tonFeeBlocked) return 'ton-fee-blocked'

    // ATS kolunun DISINDA: gasless akista ucret bir token ile odenebilir, bu yuzden
    // insufficientGas tek basina engellemez — ama fee-token secilmemisse engeller.
    //
    // `relayPaysGas` (2026-09-15): TON role kolunda gazi ROLECI oder ve native
    // yetersizligi orada bir engel DEGILDIR. Kapi, ekrandaki "Yetersiz Bakiye (Gas)"
    // kartinin v-if'iyle AYNI soruyu sorar — ve sormak ZORUNDA: o kart role kolunu
    // disliyor, bu kapi dislamiyordu, yani kart gizlenirken buton kilitli kaliyor ve
    // kullanici ekranda HICBIR aciklama olmadan olu bir dugmeyle kaliyordu (kullanici
    // sikayeti, 2026-09-15).
    //
    // SATILAN NATIVE TON BU KAPININ DISINDA: role `amountNano`yu HICBIR ZAMAN
    // sponsorlamaz (sozlesme ss00/ss04) ve o yetersizlik yukarida `insufficient-balance`
    // ile ZATEN engellendi. Burasi yalnizca GAZ payini konusur.
    //
    // KAPALI VARSAYILANLI (false): alan tasinmayan her cagiran icin davranis AYNEN
    // eskisi gibi kalir — EVM kollarinda bu kavram zaten yok.
    if (s.insufficientGas && !s.gasToken && !s.relayPaysGas) return 'insufficient-gas'
    if (s.selectedInsufficient) return 'fee-token-insufficient'

    return null
}

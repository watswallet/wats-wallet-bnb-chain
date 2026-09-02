// KREDI KARTI ILE SATIN ALMA (on-ramp) ACIK MI.
//
// Akis MoonPay uzerinden isliyor: Token.vue'daki "Al" dugmesi -> BuyToken.vue ->
// sunucunun /moonpay/getSignUrl ucu. Su anda EKRANDA GIZLI.
//
// KOD SILINMEDI, yalnizca ulasilamiyor: BuyToken.vue, `buy_token` rotasi, sunucu
// ucu ve `buyToken` cevirileri yerinde duruyor. Geri acmak bu satiri `true`
// yapmaktir.
//
// Bayrak AYRI bir dosyada ve evmGates.js'e KONMADI: oradaki `features.buy`
// "bu ZINCIR satin almayi destekliyor mu" sorusunun cevabi (chainVm === 'evm'),
// buradaki ise "biz bu ozelligi acik tutuyor muyuz" karari. Ikisini tek bayraga
// toplamak, zincir kapisini olcen uc testi (assetRouteWiring, jettonTokenWiring,
// tonFlowWiring) anlamsiz kilardi.
export const ONRAMP_ENABLED = false

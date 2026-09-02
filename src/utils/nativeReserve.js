// NATIVE UCRET PAYI
//
// Gonder ekraninda MAX bir kez zaten cikmaz uretmisti: tam bakiye yazilinca
// onay ekraninin "bakiye < gas + tutar" kapisi kapaniyor ve Onayla dugmesi
// KALICI olarak kilitleniyordu - MAX hicbir zaman tamamlanamiyordu.
//
// Takas ve Kopru bugun ayni durumda: MAX tam bakiyeyi yaziyor, `insufficientGas`
// kirmiziya donuyor ve is orada bitiyor (Swap.vue'daki yorum bu hatanin bir kez
// yasandigini zaten yaziyor). Karar tek yerde toplaniyor.

// Teklifin gaz tahmininin ustune birakilan marj. Tahminle gonderim arasinda
// gaz fiyati oynayabilir.
export const RESERVE_HEADROOM = 1.2

// Teklif HENUZ YOKKEN kullanilacak ihtiyatli gaz limitleri. Duz transfer 21000;
// takas ve kopru bunun kat kat ustunde harcar, o yuzden Send'in sabiti buraya
// tasinamaz.
export const SWAP_GAS_FALLBACK = 300000
export const BRIDGE_GAS_FALLBACK = 400000

// TON takasinda teklif HENUZ YOKKEN ayrilacak pay.
//
// TAHMIN DEGIL, OLCUM: STON.fi SDK'sinin router filosundaki `swapTonToJetton`
// gaz sabitlerinin en buyugu 0.479 TON (v2_1 Router.WStable). Uzerine standart
// marj: 0.479 * 1.2 = 0.575, yukari yuvarlanip 0.6.
//
// Yeniden turetmek icin:
//   node --input-type=module -e "import * as s from '@ston-fi/sdk'; ..."
//   (gasConstants.swapTonToJetton alanlarinin maksimumu)
//
// Fazla ayirmanin bedeli kullanicinin son kesrini takas edememesi; AZ ayirmanin
// bedeli duzeltilen cikmazin ta kendisi. Bu yuzden bilerek comert.
export const TON_SWAP_GAS_RESERVE = 0.6

// Pay GEREKIYOR MU.
//
// Gerekmedigi uc durum var ve ucu de ayni seyi soyler: bu islemde native
// harcanmiyor. Girdi zaten bir token, ya da ucret ATS ile odeniyor, ya da ucret
// secilen bir gas tokeni ile odeniyor. Bu durumlarda pay ayirmak kullanicinin
// bakiyesinin TAMAMINI kullanmasini gereksiz yere engellerdi - ustelik ATS
// kolunun hedef kitlesi zaten native'i olmayan kullanici.
export function needsNativeReserve({ isNativeIn, gasToken, payWithAts } = {}) {
    if (!isNativeIn) return false
    if (payWithAts) return false
    if (gasToken) return false
    return true
}

// Canli teklifin gaz tahmininden pay uretir. Tahmin yoksa 0 doner ve cagiran
// kendi ihtiyatli sabitine duser; buradan uydurma bir sayi dondurmek o dususu
// sessizce engellerdi.
export function reserveFromQuote(estimatedNativeCost, headroom = RESERVE_HEADROOM) {
    const cost = Number(estimatedNativeCost)
    if (!Number.isFinite(cost) || cost <= 0) return 0

    return cost * headroom
}

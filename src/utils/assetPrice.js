import { truncateDecimals } from './decimalString'

// VARLIK FIYATI - TEK OKUMA NOKTASI
//
// Bu depoda fiyat IKI AYRI ISIMLE dolasiyor:
//   `market_data` -> sunucunun kanonik kaydi (/getTokenDataById, /getChainTokens)
//   `market`      -> SelectAssets.vue:206 ve :345 kanonik kaydi bu isme KOPYALIYOR
//
// Send.vue yalnizca `market` okuyordu. Varlik listesinden gelince fiyat vardi ama
// Ana ekran -> Token -> Gonder yolunda Token.vue kaydi oldugu gibi (market_data
// olarak) tasidigi icin fiyat bulunamiyor ve ekranda "$0.00" yaziyordu. Ucuncu
// ekranin ayni tuzaga dusmemesi icin okuma tek yerde toplaniyor.

// Bilinen ve KULLANILABILIR fiyat, yoksa null.
//
// null TEK BIR SEY demektir: fiyat bilinmiyor. Ekran "-" gosterir ve dolar girisi
// kapanir. 0 dondurmek "$0.00" yalanini geri getirirdi; ustelik dolar -> token
// cevriminde sifire bolme demekti.
export function assetPriceUSD(asset) {
    const raw = asset?.market?.priceUSD ?? asset?.market_data?.priceUSD
    if (raw === null || raw === undefined || raw === '') return null

    const price = Number(raw)
    if (!Number.isFinite(price) || price <= 0) return null

    return price
}

// Token miktarinin dolar karsiligi - SAYI olarak. Fiyat bilinmiyorsa null.
//
// Metin DEGIL sayi doner cunku iki farkli tuketicisi var ve ikisi ayni bicimi
// kaldiramaz: ekrandaki satir "<0.01" gibi bir ETIKET isterken, dolar kutusuna
// geri yazilan deger `type="number"` girisine giriyor ve duz bir sayi olmak
// ZORUNDA. Bicimlendirme bu yuzden formatUsd'de ayri duruyor.
export function tokenToUsd(amount, price) {
    if (price === null || price === undefined) return null

    const p = Number(price)
    if (!Number.isFinite(p)) return null
    if (amount === null || amount === undefined || amount === '') return null

    const value = Number(amount) * p
    return Number.isFinite(value) ? value : null
}

// Ekranda gosterilecek dolar metni.
export function formatUsd(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return null

    const n = Number(value)

    // toFixed(2) kucuk tutarlari "0.00" yapiyor ve bu, fiyatin HIC olmadigi
    // durumla ayni goruntuyu uretiyordu. Sifir olmayan kucuk deger ayirt edilir.
    if (n > 0 && n < 0.01) return '<0.01'

    return n.toFixed(2)
}

// Dolar KUTUSUNA yazilacak metin. Ekrandaki etiketten (formatUsd) ayri durur:
// `type="number"` girisi "<0.01" gibi bir etiketi kabul etmez.
//
// ASAGI kirpar, yuvarlamaz. Yuvarlamak bu degeri kullanicinin gercekte sahip
// oldugu tutarin USTUNE cikarabilirdi: dolar modunda MAX'a basildiginda kutuya
// yazilan sayi token'a geri cevrilir ve yukari yuvarlanmis bir dolar, bakiyeyi
// asan bir token miktari uretirdi.
export function tokenToUsdInput(amount, price) {
    const value = tokenToUsd(amount, price)
    return value === null ? '' : truncateDecimals(value, 2)
}

// Dolar tutarinin token karsiligi. Fiyat bilinmiyorsa null.
//
// `decimals` bilinmiyorsa 8 basamaga kirpilir. Bu, "ondaligi ASLA varsayma"
// kuralinin ihlali DEGIL: oradaki tehlike ham miktari yanlis carpanla zincire
// yazmak (toNano) ve 1000 kat sapmakti. Burada sayi zaten token biriminde;
// basamak yalnizca sondaki artigi kesiyor ve kirpma her zaman ASAGI yonlu.
export function usdToToken(usd, price, decimals) {
    if (price === null || price === undefined) return null

    const p = Number(price)
    if (!Number.isFinite(p) || p <= 0) return null
    if (usd === null || usd === undefined || usd === '') return null

    const value = Number(usd) / p
    if (!Number.isFinite(value)) return null

    const d = Number.isFinite(Number(decimals)) ? Number(decimals) : 8
    return truncateDecimals(value, d)
}

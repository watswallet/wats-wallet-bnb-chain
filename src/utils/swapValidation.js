/**
 * "Yetersiz bakiye" karari.
 *
 * Swap ekraninda bu karar iki ayri watcher tarafindan ELLE atanıyordu: biri
 * ONCEKI token'in bakiyesine gore hesapliyor, digeri kosulsuz false'a cekip
 * yeni bakiyeyi async cekiyor ama cevap gelince bir daha karsilastirma yapmiyordu.
 * Sonuc: token degistirildikten sonra karar "yeterli"de takili kaliyor ve
 * zincirde kesin revert edecek bir swap gonderilebiliyordu.
 *
 * Karar artik miktar ve bakiyeden TURETILIYOR; elle atanmiyor.
 */
/**
 * Bir sayiyi parseUnits'in kabul ettigi ondalik metne cevirir.
 *
 * MAX dugmesi ham JS Number'i (useTokenBalance ciktisi) dogrudan giriş alanina
 * yaziyordu. 1e-6'nin altindaki bakiyelerde String(5e-8) === '5e-8' olur ve
 * ethers v6 parseUnits bunu reddeder ("invalid FixedNumber string value").
 * Hata swapData=null icinde yutuldugu icin kullanici sadece sonsuza kadar 0.00
 * goruyor, MAX kucuk bakiyelerde hic calismiyordu.
 */
export function toDecimalString(value, maxDecimals = 18) {
    const num = Number(value)
    if (!Number.isFinite(num) || num <= 0) return '0'

    // toFixed ustel gosterim uretmez; sondaki gereksiz sifirlar kirpilir.
    const fixed = num.toFixed(maxDecimals)
    const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '')
    return trimmed || '0'
}

export function isInsufficientBalance(amount, balance) {
    const wanted = Number(amount)
    if (!Number.isFinite(wanted) || wanted <= 0) return false

    const available = Number(balance)
    // Bakiye bilinmiyorsa yetersiz kabul edilir: bilinmeyen bir bakiyeye guvenip
    // islemi gecirmektense engellemek dogru taraftir.
    if (!Number.isFinite(available)) return true

    return wanted > available
}

/**
 * Bir miktar metnini token'in hassasiyetine KESEREK indirger.
 *
 * ethers parseUnits, token'in decimals degerinden fazla ondalik tasiyan bir metni
 * NUMERIC_FAULT ile reddeder ("too many decimals for format"). Motor miktari
 * dogrudan parseUnits'e verdigi icin bu hata getExpectedOutput'tan disari cikip
 * TUM teklifi olduruyordu — kullanici hicbir fiyat goremiyordu.
 *
 * Boyle bir metin iki yoldan doguyor:
 *   1. MAX dugmesi. toDecimalString varsayilan olarak toFixed(18) yapar; float64'te
 *      tam temsil edilemeyen buyuk bakiyelerde bu, gercek hassasiyetin otesindeki
 *      gurultuyu gercek basamak olarak yazar (2148417.315917 -> ...3159170001745224).
 *   2. Kullanicinin elle fazla ondalik yazmasi: 6 haneli bir token icin "1.1234567".
 *
 * YUVARLAMAZ, keser. Yuvarlama MAX'ta bakiyeyi asabilir ve islemi "yetersiz bakiye"ye
 * dusurur; asagi kesmek her zaman guvenli taraftir.
 */
export function clampToDecimals(value, decimals) {
    const parsedDecimals = Number(decimals)
    const max = Number.isFinite(parsedDecimals) ? Math.max(0, Math.floor(parsedDecimals)) : 18

    let text = value === null || value === undefined ? '' : String(value).trim()
    if (!text) return '0'

    // String(5e-8) === '5e-8'; parseUnits ustel gosterimi de reddeder.
    if (/e/i.test(text)) text = toDecimalString(value)
    if (text === '.' || !/^\d*\.?\d*$/.test(text)) return '0'

    const [whole = '0', fraction = ''] = text.split('.')
    const kept = fraction.slice(0, max).replace(/0+$/, '')

    return kept ? `${whole || '0'}.${kept}` : (whole || '0')
}

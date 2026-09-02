// ONDALIK METIN YARDIMCILARI
//
// assetPrice.js ve sendPercent.js ikisi de sayiyi bir <input>'a yazilabilir metne
// cevirmek zorunda. Ayni iki fonksiyonu iki dosyada tutmak, birinin duzeltilip
// digerinin unutulmasi demekti.

// Sayiyi USTEL GOSTERIMSIZ metne cevirir. `String(2.5e-8)` "2.5e-8" uretir; bu
// metin v-model'e ve oradan gonderim yoluna giderse bozuk bir miktar olur.
export function plainDecimalString(value) {
    const s = String(value)
    return s.toLowerCase().includes('e') ? Number(value).toFixed(20) : s
}

// Ondalik basamaklari KIRPAR - yuvarlamaz. Yukari yuvarlamak sonucu bakiyenin
// ustune cikarabilir; kirpmak asla cikaramaz.
export function truncateDecimals(value, decimals) {
    const [whole, fraction = ''] = plainDecimalString(value).split('.')
    const cut = fraction.slice(0, Math.max(0, decimals))
    const out = cut ? `${whole}.${cut}` : whole

    return out.includes('.') ? out.replace(/0+$/, '').replace(/\.$/, '') : out
}

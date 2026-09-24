// Islem kartlarinin KENDILIGINDEN kapanma karari -- saf katman, zamanlayici YOK.
//
// KOK NEDEN: tamamlanan bir transfer hicbir zaman kendiliginden kaybolmuyordu.
// Kullanici "Kapat" ya da "Tamamlananlari Temizle" demezse bitmis bir is ekranda
// suresiz duruyordu; kucultulmus balon da "Tamamlandi" yazip oylece bekliyordu.
// Bitmis isin yeri gecmis, ust uste binen bir rozet degil.
//
// BASARISIZ KAYIT HIC KAPANMAZ. Sebebi tasiyor ve kullanicinin atacagi bir adim
// var; kendiliginden kaybolan bir hata, hic gosterilmemis hatadir.

// Kullanicinin okumasina yetecek kadar uzun, bekletmeyecek kadar kisa. Sure
// ARAYUZ kayda baktigi ANDAN itibaren sayilir, islemin basarili oldugu andan
// DEGIL: eklenti acilir penceresi odak kaybinda kapaniyor ve "basari anindan"
// saysaydik, pencereyi sonra acan kullanici onayi HIC gormezdi.
export const SUCCESS_TTL_MS = 6000

/**
 * Kendiliginden kapanacak kayitlarin id'leri.
 *
 * `toneOf` DISARIDAN verilir: karar, TON ucret kurtarmasini da hesaba katan
 * `tonFeeTone`a aittir ve o fonksiyon TransactionStatus.vue'nun ICINDE yasamak
 * zorunda (tonFeeUiWiring.test.js govdesini orada kilitliyor). Ham `tx.status`
 * ile calisilsaydi, ucreti alinmis ama sonucu HENUZ BILINMEYEN bir TON islemi
 * ('recovering'/'unresolved' iken status hala 'success' olabiliyor) "tamamlandi"
 * sayilip sessizce ekrandan silinirdi.
 */
export function autoDismissIds(transactions, toneOf) {
    if (!Array.isArray(transactions) || typeof toneOf !== 'function') return []
    return transactions
        .filter((tx) => tx && tx.id !== undefined && toneOf(tx) === 'success')
        .map((tx) => tx.id)
}

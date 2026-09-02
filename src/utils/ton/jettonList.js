// Sunucudan gelen token kayitlarini jetton listesine cevirir.
//
// Ondaligi olmayan kayit DUSURULUR ve bu bilinclidir: yanlis ondalikla gosterilen bir
// bakiye, hic gosterilmeyen bir bakiyeden cok daha tehlikelidir.
//
// Ku1 DUZELTMESI: eskiden burada YALNIZCA `Number.isInteger(t.decimals)` kontrol
// ediliyordu - negatif (-1) ya da anlamsiz buyuk (10**7) bir "decimals" da tamsayi
// oldugu icin GECIYORDU. jettonTransfer.js ve server/utils/tonJettonHistory.js zaten
// AYNI sinira (tamsayi VE 0..30) sahipti; jettonList.js ve jettonBalance.js bu
// sinirdan SAPMIS iki ayri modul olarak kalmisti - bu depoda ondalik yuzunden IKI
// AYRI kusur cikmisti (bkz. K1/O1), sinirlarin ayrisik olmasi ucuncuyu davet
// ediyordu. Deger bilerek diger dosyalarla AYNI YERDE (30) ve AYNI SEKILDE
// (yerel sabit, paylasilan import degil - digerleriyle AYNI desen) tutuluyor.
const MAX_JETTON_DECIMALS = 30

export function jettonsFromTokens(tokens) {
    if (!Array.isArray(tokens)) return []
    return tokens
        .filter((t) => t && typeof t.address === 'string' && t.address
            && Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= MAX_JETTON_DECIMALS)
        .map((t) => ({ symbol: t.symbol, name: t.name, master: t.address, decimals: t.decimals, image: t.image }))
}

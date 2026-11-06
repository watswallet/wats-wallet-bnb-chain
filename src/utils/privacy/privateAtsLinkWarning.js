// Gizli modda Takas ve Kopru ekranlarindaki ATS ucret kartinin "ATS YETERSIZ / ATS AL" durumunda gosterilen KIRMIZI baglanti uyarisinin
// gorunurluk kosulu (2026-10-28 kullanici karari; spec 2026-10-15 D16 geri alindi). Uyari ATS-once kartindan tasindi: ATS kontrolu
// artik Para yukle'de degil islem aninda yapilir ve kullanici ATS eksigini orada gorur. Metin mevcut anahtardir (privacy.transfer.atsLinkWarning).
//
// SAF: depo ve ag yok. Gizli modda uyariyi gosteren TEK ekran PrivateTransfer'dir (Gonder, Takas ve Kopru modlari; kosulu BURADAN okur, cagiran
// ekran kendi isaretlerini verir). Swap.vue ve Bridge.vue de islevi cagirir ama Gizli modda uyariyi HIC gostermez: Bridge o modda baglanmaz,
// Swap yalniz "ATS satin alma" ekranidir (ucret karti ve uyari cizilmez); normal modda ise privacyActive false oldugundan uyari yoktur.
// Isaretler:
//   privacyActive : gizli mod acik mi (normal modda uyari HIC yok). PrivateTransfer'da Gonder, Takas ve Kopru'de (mode !== fund) true, Para yukle'de false verilir:
//                   Para yukle'de ucreti ODEYEN Gizli Hesap degil normal hesaptir, ATS'nin Gizli adrese dogrudan gitmesi diye bir risk yoktur
//                   (bag riski yok); islev davranisi DEGISMEZ, ekran parametreyi mode'a gore verir.
//   payWithAts    : ucret ATS kolunda mi VE ATS satis rotasi degil mi (satis rotasinda ayri gri not var, kart yok)
//   shortfall     : eksik-ATS bolumu cizilebilir (sunucu "ATS al" diyor + eksik miktar biliniyor)
//   insufficient  : istemcinin kendi hesabi, bakiye bu islemin ucretine yetmiyor
//   buyAts        : sunucu karari "ATS al" (engel satiri / ATS Al dugmesi)
// Yalniz kesin `true` degerleri sayilir.
export function privateAtsLinkWarningVisible({ privacyActive, payWithAts, shortfall, insufficient, buyAts } = {}) {
    if (privacyActive !== true || payWithAts !== true) return false
    return shortfall === true || insufficient === true || buyAts === true
}

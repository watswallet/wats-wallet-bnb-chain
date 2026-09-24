// Onboarding sekmesinin HANGI EKRANDA acilacagini URL hash'inden cozer -- saf katman.
//
// NEDEN VAR: Ayarlar > Cuzdan Ekle ekranindaki iki ice-aktarma dugmesi de
// onboarding.html'i HEDEF BILGISI OLMADAN aciyordu. index.vue de kosulsuz
// 'import_wallet' (yontem secici) ile basliyor ve o secicinin varsayilan sekmesi
// 'import_phrases'. Sonuc: "Ozel anahtar ile ice aktar" dugmesi kullaniciyi
// GIZLI IFADE sekmesine dusuruyordu. Ifade dugmesinin dogru yere dusmesi ise
// bir TESADUFTU -- seciciden gelen varsayilan sekme.
//
// Hash deseni repoda zaten var: popup/main.js `window.location.hash === '#window'`
// ile pencere modunu ayiriyor. Ikinci bir mekanizma icat edilmedi.
//
// AG YOK, DEPO YOK, window YOK (hash disaridan verilir -- test edilebilsin diye).

// BEYAZ LISTE. Genisletmeden ONCE asagidaki notu oku.
//
// 'start' ve 'password' BU LISTEYE ASLA GIRMEZ.
// index.vue'nun FIRST_WALLET_ONLY korumasinin gerekcesi: cuzdan VARKEN
// CreatePassword calisirsa `walletSalt` KOSULSUZ ezilir ve mevcut TUM kasalar
// kalici olarak acilamaz hale gelir. O koruma bugun bir KOD yolu; baslangic
// ekranini URL'den secilebilir yapmak, ayni kapiyi ADRES CUBUGUNDAN asilabilir
// kilardi. Kilit: onboardingTarget.test.js.
export const ONBOARDING_HASH_TARGETS = new Set(['import_phrases', 'import_private'])

/**
 * @param {string} hash  `window.location.hash` (bas taraftaki '#' opsiyonel)
 * @returns {string|null} beyaz listedeki ekran adi, ya da null (cagiran kendi
 *   varsayilanina duser -- bu fonksiyon ASLA bir varsayilan UYDURMAZ)
 */
export function onboardingStartScreen(hash) {
    if (typeof hash !== 'string') return null

    // TAM ESLESME sarti: `#import_private?x=1` ya da `#import_private#password`
    // gibi ek tasiyan degerler REDDEDILIR. "Baslangicta esitse kabul et" gibi
    // gevsek bir kontrol, beyaz listeyi bir onek oyunuyla asmanin yolu olurdu.
    const ad = hash.replace(/^#/, '').trim().toLowerCase()
    return ONBOARDING_HASH_TARGETS.has(ad) ? ad : null
}

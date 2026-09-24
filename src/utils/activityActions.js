/**
 * "Kullanici etkin" ne demek?
 *
 * Otomatik kilit, `lastActiveTime` damgasinin bayatlamasina bakar. Damgayi
 * tazeleyen kural onceden MESAJIN KOKENIYDI: eklenti kokenli her mesaj
 * kullaniciyi aktif sayiyordu. Popup birkac saniye yasadigi icin bu zararsizdi.
 *
 * Yan panelde degil: panel kapanmaz ve kullanici Takas/Kopru ekraninda
 * biraktiginda kotasyon dongusu (SWAP_QUOTE 10 sn, BRIDGE_QUOTE 20 sn) saatlerce
 * arka plana mesaj atar. Damga hic bayatlamaz, shouldLock hicbir zaman true
 * donmez ve "kullanici bilgisayardan kalkti" durumu kilitsiz gecer.
 *
 * Bu yuzden etkinlik artik KOKENE degil, ACIK BIR LISTEYE baglidir: yalnizca
 * kullanicinin kendi hareketi (HEARTBEAT -- mousemove/click/keydown ile
 * tetiklenir) ve kullanicinin bastigi kilit aksiyonlari sayilir.
 *
 * Liste BILEREK dardir. Yeni bir ad eklerken tek soru: "bunu kullanicinin
 * KENDISI mi tetikler, yoksa bir zamanlayici mi?"
 */
export const USER_ACTIVITY_ACTIONS = new Set([
    // Arayuzdeki mousemove/click/keydown -> 5 sn throttle (popup/App.vue).
    'HEARTBEAT',
    // Parola girildi. unlockWalletSession zaten refreshSession cagiriyor; burada
    // olmasi o cagriyi YEDEKLER, degistirmez.
    'UNLOCK_WALLET',
    // Kullanici "Kilitle"ye bastiysa etkindir -- ve damga zaten anlamsizlasir.
    'LOCK',
    // Arayuz acildi/kilit ekrani cizildi: kullanici cuzdana BAKIYOR.
    'CHECK_UNLOCK',
])

export function isUserActivity(action) {
    if (typeof action !== 'string') return false
    return USER_ACTIVITY_ACTIONS.has(action)
}

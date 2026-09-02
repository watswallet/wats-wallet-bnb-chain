/**
 * Hesap Solana imzalayabilir mi?
 *
 * Ice aktarilmis hesaplarin sirri bir secp256k1 private key'idir ve ondan ed25519
 * anahtari TURETILEMEZ. Onay ve gonderim ekranlari bunu ONCEDEN bilmezse
 * kullanici "Onayla"ya basar, pencere kapanir ve hicbir aciklama gormez.
 *
 * Kural TEK YERDE: imzalayicinin kosulu degisirse ekranlar da onunla degisir.
 * Bilinmeyen/eksik hesap ENGELLENMEZ — bilinmeyeni desteklenmiyor saymak gecerli
 * bir hesapla gelen kullaniciyi da kilitlerdi.
 */
export function isSolanaUnsupportedAccount(account) {
    return account?.type === 'imported' || account?.type === 'privateKey'
}

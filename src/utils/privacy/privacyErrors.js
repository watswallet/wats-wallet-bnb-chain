// Arka planin dondurdugu gizli mod hata kodlari -> i18n anahtari. Bilinmeyen kod
// (or. beklenmeyen bir istisna metni, INVALID_ENABLED ya da kapinin PRIVATE_* kodlari)
// ham haliyle kullaniciya GOSTERILMEZ; fallbackKey'e (varsayilan: generic) duser.
export const KNOWN_PRIVACY_ERROR_CODES = new Set([
    'WALLET_LOCKED', 'PRIVATE_NEEDS_HD_VAULT', 'NO_PUBLIC_ACCOUNT', 'PRIVACY_DISABLED',
    // Gizli aktarma/gonderme/siparis ekranlari (Plan 2): arka plan bu kodlari dondurur.
    'PRIVATE_MIN_AMOUNT', 'PRIVATE_MAX_AMOUNT', 'PRIVATE_PROVIDER_DOWN', 'PRIVATE_PROVIDER_ERROR',
    'PRIVATE_QUOTE_EXPIRED', 'PRIVATE_QUOTE_NOT_FOUND', 'PRIVATE_QUOTE_MISMATCH',
    'PRIVATE_INSUFFICIENT_BALANCE', 'PRIVATE_INSUFFICIENT_GAS', 'PRIVATE_SAME_ADDRESS',
    'PRIVATE_TRANSFER_TARGET', 'PRIVATE_UNSUPPORTED', 'PRIVATE_EVM_ONLY', 'PRIVACY_MODE_OFF',
    'PRIVATE_ORDER_IN_PROGRESS', 'PRIVATE_REFUND_NOT_ALLOWED', 'PRIVATE_FAILED',
    // Yatirma yayini belirsiz bitti (ag/zaman asimi): islem gonderilmis olabilir.
    'PRIVATE_DEPOSIT_UNCONFIRMED',
    // ATS yatirmasi gonderilmis olabilir ama zincir hash'i YOK (izlenemez, kayit yazilmaz): kullanici tekrar
    // denememeli, kaynak hesabin islem gecmisine bakmali. Hash'li belirsiz durum UNCONFIRMED olarak kalir.
    'PRIVATE_DEPOSIT_UNTRACKED',
    // Iade yayini belirsiz bitti (hash kayitli): iade gonderilmis olabilir, ayni siparis tekrar gonderilmez.
    'PRIVATE_REFUND_UNCONFIRMED',
    // Iadenin ag ucreti ATS ile odenir (native coin YOK): ATS bakiyesi yetmiyor (cevap atsNeeded/atsBalance tasir) ya da ATS ile
    // ucret odeme su an yapilamiyor (kurulum gerekli / hizmet duraklatildi). Ikisinde de hicbir sey gonderilmez, siparis iade edilebilir kalir.
    'PRIVATE_INSUFFICIENT_ATS', 'PRIVATE_ATS_UNAVAILABLE',
    // Secilen teslim tokeni icin SilentSwap'ta su an rota yok (502 ROUTE_TEMPORARILY_UNAVAILABLE).
    'PRIVATE_ROUTE_UNAVAILABLE',
    // SP2 (gizli-mod cok-ag spec 4.10): teslim agi bu surumde kapali (derleme listesi), fiyat farki cok yuksek (SWAP_IMPACT_TOO_HIGH),
    // teklif hiz siniri (yerel pencere ya da HTTP 429).
    'PRIVATE_CHAIN_CLOSED', 'PRIVATE_IMPACT_TOO_HIGH', 'PRIVATE_RATE_LIMITED',
    // Gizli modda klasik Takas/Kopru PRIVATE_SWAP_BRIDGE degerinden bagimsiz kapali (ekranlarda klasik dugme yok, kod yalniz kapinin ic yanitinda).
    'PRIVATE_SWAP_BRIDGE_CLOSED',
])

// Aktarma/siparis ekranlari "Mod degistirilemedi" metnini gostermesin diye fallbackKey
// olarak 'privacy.errors.PRIVATE_FAILED' verir; varsayilan eski cagrilari bozmaz.
export function privacyErrorKey(code, fallbackKey = 'privacy.errors.generic') {
    return KNOWN_PRIVACY_ERROR_CODES.has(code) ? `privacy.errors.${code}` : fallbackKey
}

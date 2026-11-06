import { privacyErrorKey } from './privacyErrors'

// Gizli modu acma/kapama istegi icin TEK yol: arka plana PRIVACY_MODE_SET gonderir,
// basarisiz ya da firlatan cevabi bir i18n hata anahtarina cevirir. Uc ekran
// (PrivacyToggle, PrivacyIntro, PrivacyBlocked) ayni davranisi paylassin diye tek
// yerde: ham hata kodu ya da istisna metni kullaniciya GOSTERILMEZ, bilinmeyen
// her sey privacyErrorKey ile generic metne duser. Bu fonksiyon asla firlatmaz.
export async function requestPrivacyMode(enabled) {
    let res = null
    try {
        res = await chrome.runtime.sendMessage({ type: 'PRIVACY_MODE_SET', enabled })
    } catch {
        // Mesaj hic ulasmadi (or. uzanti baglami gecersiz): basarisizlik sayilir.
    }
    if (res?.success) return { ok: true }
    return { ok: false, errorKey: privacyErrorKey(res?.error) }
}

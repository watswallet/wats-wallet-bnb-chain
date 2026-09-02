// Popup acikken background ile acik kalan baglanti. Kopmasi = popup kapandi.
// "Kilit suresi: Hemen" secenegi bununla calisiyor; chrome.alarms en fazla
// dakikada bir tetiklenebildigi icin tek basina yeterli degil.
export const POPUP_PORT_NAME = 'wats_popup'

export function connectPopupPort() {
    try {
        return chrome.runtime.connect({ name: POPUP_PORT_NAME })
    } catch (e) {
        // Background uyanik degilse baglanti kurulamayabilir; alarm yedegi devrede.
        console.warn('Popup portu acilamadi:', e)
        return null
    }
}

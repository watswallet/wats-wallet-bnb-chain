import { closeOrNavigate } from './uiSurface'

/**
 * TonConnect onay ekranlarinin Kapat-yalniz cikisi (B1): dapp yanitini coktan
 * aldi, buradan ona HICBIR SEY gitmez.
 *
 * current_request yalniz arka plan bu istegi artik TUTMUYORSA silinir: istek
 * kaybolduysa (SW yeniden basladi) onu baska hicbir yol temizlemez ve popup her
 * acilista ayni olu ekrana doner. Kayit hala bir pencereye bagliysa (isleniyor
 * ya da yanitlanip acik) current_request o pencerenindir; kapanisi (onRemoved)
 * temizler. Baska bir istegin kaydina dokunulmaz.
 */
export async function tonOnayiKapat(requestId, page) {
    try {
        if (requestId != null && !(await arkaPlandaDuruyor(requestId))) {
            const { current_request } = await chrome.storage.local.get('current_request')
            if (current_request?.id === requestId) {
                await chrome.storage.local.remove('current_request')
            }
        }
    } catch (e) {
        console.warn('[tonconnect] onay kaydi temizlenemedi:', e?.message)
    }
    closeOrNavigate('home', { page })
}

// Ikinci bir yuzey (or. eylem popup'i) kaydi silerse onay penceresi ana
// sayfaya doner ve oradaki durust hata metni kaybolur. Cevap alinamazsa kayit
// yok sayilir (eski davranis): cevap veremeyen arka planda bekleyen istek de yok.
async function arkaPlandaDuruyor(requestId) {
    try {
        const r = await chrome.runtime.sendMessage({ type: 'TON_DAPP_REQUEST_STATE', requestId })
        return typeof r?.state === 'string' && r.state !== 'gone'
    } catch {
        return false
    }
}

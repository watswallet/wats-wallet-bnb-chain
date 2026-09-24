import { panelOpenSupported } from './uiMode'

/**
 * Yan paneli, cagrildigi PENCEREDE acar.
 *
 * KULLANICI HAREKETI KURALI: chrome.sidePanel.open() "yalnizca bir kullanici
 * hareketine yanit olarak" cagrilabilir. Hareket gecici bir aktivasyon
 * penceresidir -- "sifir await" kurali DEGIL, ama harcanabilir bir butcedir.
 *
 * open() ayrica tabId veya windowId'den EN AZ BIRINI ZORUNLU ister, yani bir
 * pencere aramasi (chrome.windows.getCurrent) HER ZAMAN gerekir.
 *
 * BUTCE KURALI (duzeltildi -- eski yorum burada cagri yerinin ihlal ettigi bir
 * seyi vaat ediyordu): open()'dan once en fazla BIR chrome IPC gidis-donusu
 * gecmelidir. Cagri yerinin KENDI de gercek bir chrome cagrisi bekliyorsa
 * (ornegin readUiMode -> chrome.storage.local.get), o cagriyi buradaki pencere
 * aramasiyla SIRALI degil PARALEL baslatmasi sarttir -- yoksa iki round-trip
 * ust uste biner ve butce chrome.sidePanel.open()'a hic ulasmadan tukenebilir.
 *
 * Bu yuzden `pencereBeklemesi` parametresi VAR: cagri yeri chrome.windows.getCurrent()'i
 * KENDISI, kendi chrome cagrisiyla AYNI ANDA baslatip sonucunu (deger ya da
 * promise olarak) buraya verebilir -- bu durumda burada IKINCI bir
 * windows.getCurrent() cagrisi YAPILMAZ. Parametre atlanirsa (bagimsiz, tek
 * basina cagrilan yerler icin) fonksiyon aramayi KENDI baslatir; o zaman butce
 * zaten sadece bu tek cagriyi tasir.
 *
 * @param {Promise<{id?: number}>|{id?: number}} [pencereBeklemesi] onceden
 *   baslatilmis chrome.windows.getCurrent() sonucu (deger veya promise).
 *   Verilmezse burada baslatilir.
 * @returns {Promise<boolean>} panel gercekten acildiysa true
 */
export async function openSidePanelHere(pencereBeklemesi) {
    if (!panelOpenSupported()) return false

    try {
        const w = await (pencereBeklemesi ?? chrome.windows.getCurrent())
        if (typeof w?.id !== 'number') return false
        await chrome.sidePanel.open({ windowId: w.id })
        return true
    } catch (e) {
        // Hareket penceresi kacirilmis ya da API reddetmis olabilir. Cagri yeri
        // normal yuzey olarak devam edebilmeli -- bu bir hata ekrani DEGIL.
        console.warn('Yan panel acilamadi:', e)
        return false
    }
}

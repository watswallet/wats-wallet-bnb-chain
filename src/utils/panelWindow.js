import { isPanel } from './uiSurface'

/**
 * Panelin KENDI pencere kimligi.
 *
 * Yan panel PENCERE BASINADIR: ayni anda N pencerede acik olabilir ve her biri
 * ayri bir belgedir. `tabs.query({ lastFocusedWindow: true })` bu durumda
 * BASKA bir pencerenin sekmesini dondurebilir -- ve hostname yalnizca
 * gosterimde degil YAZMA yolunda da kullaniliyor (izin kaydini silmek/
 * guncellemek). Yanlis pencere = kullanicinin bakmadigi sitenin baglantisini
 * kesmek.
 *
 * Kimlik panel URL'sine parametre olarak GECIRILMEZ: global panelin tek bir
 * default_path'i vardir, setOptions({path}) tabId'siz cagrildiginda TUM
 * pencereleri birden degistirir ve crxjs yoldan '#'/'?' sonrasini kirpar.
 * Bunun yerine panel acilista BIR KEZ chrome.windows.getCurrent() cagirir.
 *
 * Not: chrome.runtime.getContexts() panel baglamlari icin windowId: -1
 * donduruyor (Chromium 40925107) -- ama bu yalnizca ARKA PLANDAN sorgulamayi
 * gecersiz kilar, panelin KENDI sorgusunu degil.
 */
let panelWindowId = null
let cozuldu = false

export async function initPanelWindowId() {
    if (cozuldu) return panelWindowId
    cozuldu = true

    if (!isPanel()) return null

    try {
        const w = await chrome.windows.getCurrent()
        panelWindowId = typeof w?.id === 'number' ? w.id : null
    } catch (e) {
        console.warn('Panel pencere kimligi cozulemedi:', e)
        panelWindowId = null
    }
    return panelWindowId
}

export function getPanelWindowId() {
    return panelWindowId
}

/**
 * "Bu yuzeyin baktigi aktif sekme" sorgusu.
 *
 * Panelde kendi penceresine SABITLENIR. Kimlik cozulemediyse eski bicime
 * duseriz: yanlis pencere riskini geri getirir ama Header'i tamamen bos
 * birakmaktan iyidir -- bilincli bir takas.
 */
export function activeTabQuery() {
    if (isPanel() && typeof panelWindowId === 'number') {
        return { active: true, windowId: panelWindowId }
    }
    return { active: true, lastFocusedWindow: true }
}

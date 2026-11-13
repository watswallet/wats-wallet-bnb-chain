// UI baglamlarindan (onboarding) islem sayaci istegi.
//
// SAYAC TEK YAZARLI: yalniz service worker yazar (analyticsPing.countAction). Burasi
// yalnizca mesaj yollar; fire-and-forget, hata YUTULUR (sayac hicbir akisi bozmamali).
// Yalniz cuzdan olusturma/ice aktarma: transfer/swap/bridge arka plandan dogrudan sayilir.
// `kind` disinda HICBIR sey gonderilmez (adres, tutar, kasa bilgisi yok).
export function requestAnalyticsCount(kind) {
    try {
        const p = chrome.runtime.sendMessage({ type: 'ANALYTICS_COUNT', message: { kind } })
        if (p && typeof p.catch === 'function') p.catch(() => {})
    } catch { /* yan ozellik: sessiz */ }
}

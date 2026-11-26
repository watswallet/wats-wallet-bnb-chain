// UI baglamlarindan (onboarding) islem sayaci istegi.
//
// SAYAC TEK YAZARLI: yalniz service worker yazar (analyticsPing.countAction). Burasi
// yalnizca mesaj yollar; fire-and-forget, hata YUTULUR (sayac hicbir akisi bozmamali).
// Yalniz cuzdan olusturma/ice aktarma: transfer/swap/bridge arka plandan dogrudan sayilir.
// `kind` ve (ekran sayimi icin) `key` disinda HICBIR sey gonderilmez (adres, tutar, kasa bilgisi yok).
export function requestAnalyticsCount(kind, extra = {}) {
    try {
        const p = chrome.runtime.sendMessage({ type: 'ANALYTICS_COUNT', message: { kind, ...(extra.key ? { key: extra.key } : {}) } })
        if (p && typeof p.catch === 'function') p.catch(() => {})
    } catch { /* yan ozellik: sessiz */ }
}

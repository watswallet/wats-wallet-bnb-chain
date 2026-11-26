// Sekme icerigi yonlu giris (spec 7.3, K9): yeni sekmenin sirasi eskisinden buyukse icerik
// sagdan, kucukse soldan gelir. Saf kural; store/chrome/vue bilmez.
export const TAB_ORDER = Object.freeze(['assets', 'stocks', 'activity', 'private'])

// Yon sinifinin kaldirilacagi an (ms): en uzun hareket bittikten sonra, 0,26 sn sinirinin icinde
// (icerik .22s; satir .18s + en fazla 70 ms gecikme = .25s; style.css KAYMAK bolumu).
// Sinif kalkinca sonradan gelen satirlar (veri gelisi) animasyon almaz.
export const TAB_SLIDE_CLEAR_MS = 260

export function tabSlideClass(prev, next) {
    const a = TAB_ORDER.indexOf(prev)
    const b = TAB_ORDER.indexOf(next)
    if (a === -1 || b === -1 || a === b) return ''
    return b > a ? 'kaymak-sekme-sag' : 'kaymak-sekme-sol'
}

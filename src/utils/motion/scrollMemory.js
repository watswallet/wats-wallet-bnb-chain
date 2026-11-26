// KAYMAK G13: kaydirma hafizasinin saf hesabi (spec 7.10, K2). Bellek tek bir deger:
// { key, tab, top, anchorKey, anchorOffset } | null. Yalniz bellekte (pageStore) yasar; bu modul depo, tarayici
// deposu ya da Vue kullanmaz. Girdiler degistirilmez.
//
// Iki olcu karistirilmaz:
//  - GORUNUR ofset: satirin kaydiricinin gorunen ustune uzakligi (kayitta capa secimi; sinirla karsilastirilir).
//  - ICERIK koordinati: gorunur ofset + scrollTop (geri yuklemede hedef scrollTop hesabi).

// Geri yuklenen sekmeler. Aktiviteler ve Gizli islemler her kurulumda yeniden cekiliyor; konum guvenilmez.
export const RESTORE_TABS = Object.freeze(['assets', 'stocks'])

// '<hesap>|<0/1>|<kapsam>': hesap, gizli mod ya da ag kapsami degisince anahtar tutmaz, geri yukleme olmaz.
export function scrollKey({ accountKey, privateMode, scope } = {}) {
    return `${accountKey ?? ''}|${privateMode ? 1 : 0}|${scope ?? ''}`
}

// Capa: yapiskan sinirin hemen altindaki (gorunur ofseti sinira esit ya da buyuk) ilk satir ve sinira uzakligi.
// rows DOM (gorunum) sirasindadir.
export function pickAnchor(rows, boundary) {
    if (!Array.isArray(rows)) return null
    const sinir = Number(boundary) || 0
    for (const satir of rows) {
        if (!satir || typeof satir.key !== 'string' || satir.key === '' || !Number.isFinite(satir.top)) continue
        if (satir.top >= sinir) return { anchorKey: satir.key, anchorOffset: satir.top - sinir }
    }
    return null
}

// top: kaydiricinin scrollTop'u; rows: gorunur ofsetli satirlar. Capa yoksa iki alan null.
export function captureScroll({ key, tab, top, rows, boundary } = {}) {
    const capa = pickAnchor(rows, boundary)
    return {
        key,
        tab,
        top: Number.isFinite(Number(top)) ? Number(top) : 0,
        anchorKey: capa ? capa.anchorKey : null,
        anchorOffset: capa ? capa.anchorOffset : null,
    }
}

// Yalniz bellek varsa, anahtar ve sekme ayniysa ve sekme geri yuklenen sekmelerdense.
export function shouldRestore(memory, { key, tab } = {}) {
    return !!memory && memory.key === key && memory.tab === tab && RESTORE_TABS.includes(tab)
}

// anchorTop: capa satirinin ICERIK koordinati (bulunamadiysa null). Capa bulunduysa satir kayittaki gorunur
// ofsetine doner; bulunamadiysa (satir gizlendi/silindi) kayitli top. Sonuc [0, maxTop] icine kirpilir ve
// yuvarlanir: liste kisaldiysa sonun otesine ya da negatif konuma sicrama yok.
export function targetScrollTop(memory, { anchorTop = null, boundary = 0, maxTop = 0 } = {}) {
    const ust = Math.max(0, Number(maxTop) || 0)
    const capali = anchorTop !== null && Number.isFinite(anchorTop) && Number.isFinite(memory?.anchorOffset)
    const hedef = capali
        ? anchorTop - (Number(boundary) || 0) - memory.anchorOffset
        : Number(memory?.top) || 0
    return Math.min(ust, Math.max(0, Math.round(hedef)))
}

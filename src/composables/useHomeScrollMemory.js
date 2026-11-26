// KAYMAK G13: kaydirma hafizasi (spec 7.10, K2, H10). KeepAlive yok: Home her donuste yeniden kurulur; kalinan yer
// onBeforeUnmount'ta (DOM o anda henuz gizlenmemis) bellege yazilir, Home kurulunca anahtar ve sekme tutarsa geri
// yuklenir. Bellek pageStore'da (parametre olarak gelir), yalniz bellekte; tarayici deposuna hicbir sey yazilmaz.
// Satirlar `[data-row-key]` ile bulunur.
//
// Iki olcu karistirilmaz (kok = kaydirici.getBoundingClientRect()):
//  - save: satirin GORUNUR ofseti (satir.top - kok.top), yapiskan sinirla karsilastirilir.
//  - restore: capa satirinin ICERIK koordinati (gorunur ofset + scrollTop).
import { nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { LOCK_PAGES } from '../utils/motion/navDirection'
import { captureScroll, shouldRestore, targetScrollTop } from '../utils/motion/scrollMemory'

// Bekleme sirasinda kullanici kaydirici uzerinde davranirsa geri yukleme iptal (spec 7.10 "Kullanici once davranirsa").
const GIRDI_OLAYLARI = ['wheel', 'touchstart', 'keydown', 'pointerdown']

const olcer = (el) => !!el && typeof el.getBoundingClientRect === 'function'
const satirOgeleri = (kaydirici) => (typeof kaydirici.querySelectorAll === 'function'
    ? Array.from(kaydirici.querySelectorAll('[data-row-key]'))
    : [])
const satirAnahtari = (el) => (el && typeof el.getAttribute === 'function' ? el.getAttribute('data-row-key') : null)

export function createScrollMemory({ page, key, tab, boundary }) {
    function save(kaydirici) {
        if (!page || !olcer(kaydirici)) return
        // KILIT KORUMASI (Review Focus 6): onBeforeUnmount aninda currentPage zaten yeni sayfadir. Home acikken kilit
        // olunca App'in pre izleyicisi bellegi ONCE siler, bu kayit yamada SONRA calisir; korumasiz kayit bellegi
        // (gizli hesabin capa anahtari dahil) kilit boyunca geri yazardi.
        if (LOCK_PAGES.includes(page.currentPage)) return
        const kokUst = kaydirici.getBoundingClientRect().top
        const rows = []
        for (const el of satirOgeleri(kaydirici)) {
            const anahtar = satirAnahtari(el)
            if (!anahtar || !olcer(el)) continue
            rows.push({ key: anahtar, top: el.getBoundingClientRect().top - kokUst })
        }
        page.homeScroll = captureScroll({
            key: key(),
            tab: tab(),
            top: Number(kaydirici.scrollTop) || 0,
            rows,
            boundary: boundary(),
        })
    }

    function restore(kaydirici) {
        if (!page || !olcer(kaydirici)) return false
        const bellek = page.homeScroll
        if (!shouldRestore(bellek, { key: key(), tab: tab() })) return false
        let anchorTop = null
        if (bellek.anchorKey !== null && bellek.anchorKey !== undefined) {
            const capa = satirOgeleri(kaydirici).find((el) => satirAnahtari(el) === bellek.anchorKey)
            if (olcer(capa)) {
                anchorTop = capa.getBoundingClientRect().top - kaydirici.getBoundingClientRect().top + (Number(kaydirici.scrollTop) || 0)
            }
        }
        const maxTop = (Number(kaydirici.scrollHeight) || 0) - (Number(kaydirici.clientHeight) || 0)
        kaydirici.scrollTop = targetScrollTop(bellek, { anchorTop, boundary: boundary(), maxTop })
        return true
    }

    return { save, restore }
}

// settled: Home'un konumu oturdu mu (G15 geri ucusu bunu bekler). true: geri yukleme yapildi ya da gerekmiyordu;
// false: kaydirici yok (SSR), bekleme suresi doldu, kullanici once davrandi ya da Home bekleme bitmeden ayrildi.
// Sira (spec 7.10): (1) capaya gore scrollTop, (2) onRestored (serit ve yapisma bir kez senkron), (3) settled.
// onRestored yalniz gercekten geri yuklenince cagrilir; geri yukleme yoksa konum en ustte ve gozlemciler devralir.
export function useHomeScrollMemory({ scrollerRef, page, key, tab, boundary, listReady, onRestored = () => {}, waitMs = 150 }) {
    const bellek = createScrollMemory({ page, key, tab, boundary })
    let coz = () => {}
    const settled = new Promise((resolve) => { coz = resolve })
    let bitti = false
    let bekliyor = false
    let zamanlayici = null
    let dinlenen = null

    const temizle = () => {
        bekliyor = false
        if (zamanlayici !== null) clearTimeout(zamanlayici)
        zamanlayici = null
        if (dinlenen) {
            for (const ad of GIRDI_OLAYLARI) dinlenen.removeEventListener(ad, iptal)
        }
        dinlenen = null
    }
    const bitir = (sonuc) => {
        if (bitti) return
        bitti = true
        temizle()
        coz(sonuc)
    }
    function iptal() {
        bitir(false)
    }
    const uygula = (kaydirici) => {
        if (bellek.restore(kaydirici)) onRestored()
        bitir(true)
    }
    // Liste hazir: ilk tur bitti; satirlar bir sonraki tick'te cizilmis olur.
    const listeGeldi = () => {
        if (!bekliyor) return
        bekliyor = false
        nextTick(() => {
            if (bitti) return
            const kaydirici = scrollerRef.value
            if (kaydirici) uygula(kaydirici)
            else bitir(false)
        })
    }

    watch(() => !!(listReady && listReady.value), (hazir) => { if (hazir) listeGeldi() })

    onMounted(() => {
        const kaydirici = scrollerRef.value
        if (!kaydirici) {
            bitir(false)
            return
        }
        const sekme = tab()
        // Hisseler katalogdan senkron gelir: boyamadan once, hemen.
        if (sekme === 'stocks') {
            uygula(kaydirici)
            return
        }
        if (sekme !== 'assets') {
            bitir(true)
            return
        }
        // Varliklar: liste en fazla waitMs beklenir; gec sicrama hic geri yuklememekten kotu.
        bekliyor = true
        if (typeof kaydirici.addEventListener === 'function' && typeof kaydirici.removeEventListener === 'function') {
            for (const ad of GIRDI_OLAYLARI) kaydirici.addEventListener(ad, iptal, { passive: true })
            dinlenen = kaydirici
        }
        zamanlayici = setTimeout(iptal, waitMs)
        if (listReady && listReady.value) listeGeldi()
    })

    onBeforeUnmount(() => {
        const kaydirici = scrollerRef.value
        if (kaydirici) bellek.save(kaydirici)
        bitir(false)
    })

    return { settled }
}

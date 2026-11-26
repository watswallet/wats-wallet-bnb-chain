// KAYMAK G10: yapiskan sekmeler (spec 7.9, K8). "Yapisti mi" sorusunu CSS soramaz: sekme satirinin hemen
// ustundeki 1 px gozcu, kok Home kaydiricisi ve ust payi serit yuksekligi olan bir IntersectionObserver ile
// izlenir. Kaydirma olayi dinlenmez, her karede yerlesim okunmaz; recompute() tek seferlik olcumdur (G13).
// Gizli mod Home acikken degisir (Home yeniden kurulmaz): ofset ya da gozcu degisince gozlemci post izleyicide
// (DOM guncel) yeniden kurulur.
// KAYMAK G11: mini bakiye seridi (spec 7.9 Mini serit, K8). Ikinci gozlemci baslik bakiyesini izler (kok yine Home
// kaydiricisi): baslik kaydiricinin gorunen alanindan cikinca stripShown. Esik sabit piksel degil (yan panelde
// yukseklik degisken). Baslik `v-if="!privacy.active"` kabinin icinde: gizli -> normal donuste YENI oge dogar, bu
// yuzden baslik ref'i de yeniden kurulum izleyicisinin kaynagidir (post: ref o an dolu).
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

// Mini bakiye seridinin yuksekligi (`h-11`, K8); normal modda sekmeler bunun altina (`top-11`) yapisir.
export const SERIT_PX = 44

// Gozlemcinin alt payi (spec 10.1: pay degerleri insaatciya birakildi). Alt pay 0 olsaydi gozcu "gorunen alanin
// altinda" ile "cizginin ustunde" arasinda TEK KAREDE sicradiginda (Home/End, kaydirma cubugu surukleme, kisa yan
// panel) iki hal de "kesismiyor" sayilir ve geri cagri gelmezdi; kose yanlis halde takili kalirdi. Buyuk alt payla
// cizginin alti her yerde kesisir: cizgiyi her gecis geri cagri uretir. Gozcunun ustunde yalniz ust bolge (baslik,
// eylemler, duyuru) var; gozcu gorunen alanin altindan bundan fazla uzakta olamaz. Baslik gozlemcisi ayni payi
// ayni nedenle kullanir (baslik gozcunun de ustunde).
export const ALT_PAY_PX = 10000

// Gozcunun alt kenari yapisma cizgisine (kok ustu + ofset) ulastiysa ya da gectiyse satir yapismistir.
export function isStuck(sentinelBottom, lineTop) {
    return sentinelBottom <= lineTop
}

// Baslik bakiyesinin alt kenari kaydiricinin gorunen alaninin ustune (kok ustu) ulastiysa ya da gectiyse baslik
// cikmistir; serit belirir.
export function headlineGone(headlineBottom, rootTop) {
    return headlineBottom <= rootTop
}

export function useHomeStickyBar({ scrollerRef, sentinelRef, headlineRef, offsetPx }) {
    const stuck = ref(false)
    const stripShown = ref(false)
    let gozlemci = null
    // Kurulu gozlemcinin girdileri (kok, gozcu, ofset). Mount'ta onMounted ile hemen ardindan sablon ref'inin
    // yazilmasiyla tetiklenen post izleyici ayni girdilerle iki kez kurardi (G10 inceleme bulgusu); girdiler
    // degismediyse kurulu gozlemci korunur.
    let kurulan = null
    // Baslik gozlemcisi ve girdileri (kok, baslik); ayni kural. Ofsete bagli degil: yalniz baslik degisince (mod
    // gecisi) baslik gozlemcisi yeniden kurulur, yapisma gozlemcisi korunur.
    let baslikGozlemci = null
    let baslikKurulan = null

    const baslikOgesi = () => (headlineRef ? headlineRef.value : null)

    const gozcuKapat = () => {
        if (gozlemci) gozlemci.disconnect()
        gozlemci = null
        kurulan = null
    }

    const baslikKapat = () => {
        if (baslikGozlemci) baslikGozlemci.disconnect()
        baslikGozlemci = null
        baslikKurulan = null
    }

    const kapat = () => {
        gozcuKapat()
        baslikKapat()
    }

    const gozcuKur = (kok) => {
        const gozcu = sentinelRef.value
        const ofset = offsetPx()
        if (gozlemci && kurulan && kurulan.kok === kok && kurulan.gozcu === gozcu && kurulan.ofset === ofset) return
        gozcuKapat()
        if (!gozcu) stuck.value = false
        if (!kok || !gozcu || typeof IntersectionObserver !== 'function') return
        gozlemci = new IntersectionObserver((girisler) => {
            const son = girisler[girisler.length - 1]
            if (!son || !son.rootBounds) return
            stuck.value = isStuck(son.boundingClientRect.bottom, son.rootBounds.top)
        }, { root: kok, rootMargin: `${-ofset}px 0px ${ALT_PAY_PX}px 0px`, threshold: 0 })
        kurulan = { kok, gozcu, ofset }
        gozlemci.observe(gozcu)
    }

    const baslikKur = (kok) => {
        const baslik = baslikOgesi()
        if (baslikGozlemci && baslikKurulan && baslikKurulan.kok === kok && baslikKurulan.baslik === baslik) return
        baslikKapat()
        if (!baslik) stripShown.value = false
        if (!kok || !baslik || typeof IntersectionObserver !== 'function') return
        baslikGozlemci = new IntersectionObserver((girisler) => {
            const son = girisler[girisler.length - 1]
            if (!son || !son.rootBounds) return
            stripShown.value = headlineGone(son.boundingClientRect.bottom, son.rootBounds.top)
        }, { root: kok, rootMargin: `0px 0px ${ALT_PAY_PX}px 0px`, threshold: 0 })
        baslikKurulan = { kok, baslik }
        baslikGozlemci.observe(baslik)
    }

    const yenidenKur = () => {
        const kok = scrollerRef.value
        gozcuKur(kok)
        baslikKur(kok)
    }

    // Tek seferlik olcum (G13 geri yuklemeden sonra cagirir): kok bir kez, gozcu ve baslik birer kez okunur.
    function recompute() {
        const kok = scrollerRef.value
        if (!kok || typeof kok.getBoundingClientRect !== 'function') return
        const kokUst = kok.getBoundingClientRect().top + (Number(kok.clientTop) || 0)
        const gozcu = sentinelRef.value
        if (gozcu && typeof gozcu.getBoundingClientRect === 'function') {
            stuck.value = isStuck(gozcu.getBoundingClientRect().bottom, kokUst + offsetPx())
        }
        const baslik = baslikOgesi()
        if (!baslik) stripShown.value = false
        else if (typeof baslik.getBoundingClientRect === 'function') {
            stripShown.value = headlineGone(baslik.getBoundingClientRect().bottom, kokUst)
        }
    }

    onMounted(yenidenKur)
    watch([offsetPx, () => headlineRef?.value, () => sentinelRef.value], yenidenKur, { flush: 'post' })
    onBeforeUnmount(kapat)

    return { stuck, stripShown, recompute }
}

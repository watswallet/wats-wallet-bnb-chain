import { onMounted, onUnmounted } from 'vue'

/**
 * Sir ekranlarinin gorunurluk korumasi.
 *
 * Kurtarma kelimelerini ve ozel anahtarlari bugune kadar koruyan sey KOD DEGIL,
 * popup'in odak kaybinda KAPANMASIYDI. Yan panel kapanmaz: kullanici kelimeleri
 * acar, toplantiya girer, ekran paylasir -- kelimeler saatlerce gorunur kalir.
 *
 * TETIKLEYICI YUZEYE GORE AYRILIR:
 *  - popup ve onay penceresi ('#window'): `visibilitychange` ve `blur` ayni
 *    seydir, ikisi de sayilir.
 *  - yan panel: YALNIZCA `visibilityState === 'hidden'` sayilir. Panel kullanici
 *    web sayfasina tikladiginda GORUNUR kalir ama blur alir; blur'a baglamak
 *    kullaniciyi kelimeleri kagida yazarken HER tikta geri sarardi.
 *
 * Ayrica 60 saniyelik otomatik geri donus: kullanici ekrani acik unutursa.
 */
export const SECRET_TIMEOUT_MS = 60000

/**
 * Saf cekirdek -- Vue yasam dongusune bagimli DEGIL, bu yuzden sahte
 * zamanlayicilarla ve sahte bir `host` ile dogrudan test edilebilir.
 *
 * IKI HOST, cunku iki olay IKI FARKLI HEDEFTE firlar:
 *  - `visibilitychange` -> `document`,
 *  - `blur` (pencere seviyesi odak kaybi) -> `window`.
 *
 * Tek bir `document` host'u kullanilirsa blur dinleyicisi HIC calismaz: pencere
 * blur'u `window`'da firlar ve DOM agacinda BUBBLE ETMEZ, yani `document`'e
 * ULASMAZ. Bugun gorunmez bir hata (hicbir cagiran `blurCounts: true`
 * gecmiyor), ama popup/onay penceresi icin acildigi gun SESSIZCE hicbir sey
 * yapmayan bir koruma birakirdi -- sirri gosteren bir ekranda en kotu ariza
 * bicimi. Testteki sahte host bu farki goremez (handler dogrudan cagriliyor),
 * bu yuzden ayrim BURADA, kaynakta yapiliyor.
 *
 * `blurHost` verilmezse `host`a duser: mevcut tek-host cagrilari ve testler
 * oldugu gibi calisir.
 */
export function createSecretGuard({ onHide, host, blurHost = host, blurCounts = false, timeoutMs = SECRET_TIMEOUT_MS } = {}) {
    let timer = null
    let kurulu = false

    const tetikle = () => {
        try {
            onHide?.()
        } catch (e) {
            console.error('Sir ekrani korumasi basarisiz:', e)
        }
    }

    const onVisibility = () => {
        if (host?.visibilityState === 'hidden') tetikle()
    }
    const onBlur = () => { tetikle() }

    return {
        install() {
            if (!host || kurulu) return
            kurulu = true
            host.addEventListener('visibilitychange', onVisibility)
            if (blurCounts) blurHost?.addEventListener('blur', onBlur)
            timer = setTimeout(tetikle, timeoutMs)
        },
        teardown() {
            if (!host || !kurulu) return
            kurulu = false
            host.removeEventListener('visibilitychange', onVisibility)
            if (blurCounts) blurHost?.removeEventListener('blur', onBlur)
            if (timer) { clearTimeout(timer); timer = null }
        },
    }
}

/**
 * Vue sarmalayicisi. Bilesenler bunu cagirir; mount/unmount kendiliginden
 * baglanir.
 *
 * `blurCounts` varsayilani `false`: en guvenli DAVRANIS degil, en guvenli
 * KULLANIM. Yanlis tarafta hata yapmak (panelde blur sayip ekrani surekli geri
 * sarmak) kullaniciyi kelimeleri yanlis yazmaya iter -- kaybedilen para,
 * kazanilan gizlilik degil.
 */
export function useSecretScreenGuard({ onHide, blurCounts = false, timeoutMs = SECRET_TIMEOUT_MS } = {}) {
    // Test ortami 'node': window/document yok. Guard host'suz no-op olur.
    //
    // `visibilitychange` document'te, `blur` window'da dinlenir -- ikisi ayri
    // hedeflerde firlar (gerekce createSecretGuard'in bas yorumunda).
    const host = typeof document === 'undefined' ? null : document
    const blurHost = typeof window === 'undefined' ? null : window
    const guard = createSecretGuard({ onHide, host, blurHost, blurCounts, timeoutMs })

    onMounted(() => { guard.install() })
    onUnmounted(() => { guard.teardown() })

    return guard
}

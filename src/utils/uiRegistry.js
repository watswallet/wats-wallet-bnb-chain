/**
 * Acik cuzdan arayuzlerinin kaydi.
 *
 * ESKI HALI: tek bir portun kopmasi kosulsuz "kullanici cuzdani kapatti"
 * demekti. Iki yonde birden yanlisti:
 *
 *  - YANLIS NEGATIF: yan panel kapanmaz. Sekme degistirmek, baska siteye
 *    gitmek, odak kaybi -- hicbiri portu koparmaz. "Hemen" secen kullanici
 *    panelde HIC kilitlenmez.
 *  - YANLIS POZITIF: panel ayni anda N pencerede acik olabilir ve Chrome
 *    paneli pencere kapanisinda / uzanti guncellemesinde YENIDEN YUKLER.
 *    Bunlarin her biri bir kopma uretir; eski kod kullanici ekranin onunde
 *    otururken -- hatta bir imza akisinin ortasinda -- kilitlerdi.
 *
 * YENI HALI: kac arayuzun acik oldugu sayilir ve kilit YALNIZCA kume
 * bosaldiginda, kisa bir bekleme penceresinden SONRA verilir. Bekleme icinde
 * yeni bir port gelirse (yeniden yukleme) karar iptal edilir.
 *
 * Bu modul BILEREK `chrome`'suzdur: girdisi yalnizca `name` ve
 * `onDisconnect.addListener` tasiyan nesnelerdir, boylece zamanlayici
 * davranisi sahte zamanlayicilarla test edilebilir.
 */

// Kimlikli arayuz portu. Kimlik (uuid) yalnizca AYIRT ETMEK icindir: ayni
// baglamdan iki kez baglanmak kumeyi yaniltmasin.
export const UI_PORT_PREFIX = 'wats_ui:'

// Eski ad. Guncelleme aninda ACIK kalan bir popup hala bu adla baglidir ve
// kayit defteri onu de saymak zorunda -- aksi halde guncelleme, acik popup'in
// sahibini aninda kilitlerdi.
export const POPUP_PORT_NAME = 'wats_popup'

export const DEFAULT_GRACE_MS = 3000

export function isUiPortName(name) {
    if (typeof name !== 'string') return false
    return name === POPUP_PORT_NAME || name.startsWith(UI_PORT_PREFIX)
}

export function createUiRegistry({ onEmpty, graceMs = DEFAULT_GRACE_MS } = {}) {
    const ports = new Set()
    let graceTimer = null

    const iptalEt = () => {
        if (graceTimer === null) return
        clearTimeout(graceTimer)
        graceTimer = null
    }

    const kontrolEt = () => {
        if (ports.size > 0) return
        iptalEt()
        graceTimer = setTimeout(() => {
            graceTimer = null
            // `iptalEt()` (clearTimeout) TEK BASINA YETMEZ: zamanlayici ateşleyip
            // bu geri cagri kuyruga girdikten SONRA, ama daha CALISMADAN ONCE bir
            // `add()` gelirse, `iptalEt()` calisir ama artik iptal edecek bir
            // zamanlayici yoktur (`clearTimeout` kuyruga girmis bir geri cagriyi
            // GERI CEKMEZ) -- yani `add()`'in kendi `iptalEt()` cagrisi bu noktada
            // NO-OP'tur. O anda kumede bir port VARDIR ve kilidi yalnizca bu
            // kontrol onler. Bu yaris sahte zamanlayicilarla (`vi.useFakeTimers`)
            // URETILEMEZ -- gercek bir mikro-gorev/makro-gorev sıralamasi gerekir --
            // dolayisiyla bu satiri silmeden once BU YORUMU OKU: onu koruyan test
            // yok, ama silinmesi gereken bir kalinti da degil.
            if (ports.size > 0) return
            try {
                onEmpty?.()
            } catch (e) {
                // Kilit cagrisi patlarsa kayit defteri calisir kalmali; aksi
                // halde bir hata butun sonraki kararlari da goturur.
                console.error('Kayit defteri onEmpty basarisiz:', e)
            }
        }, graceMs)
    }

    return {
        add(port) {
            if (!port || ports.has(port)) return
            ports.add(port)
            // Yeni arayuz geldi: bekleyen kilit karari varsa DUSER.
            iptalEt()
            port.onDisconnect.addListener(() => {
                ports.delete(port)
                kontrolEt()
            })
        },
        /**
         * ACILIS KONTROLU -- service worker dogdugunda BIR KEZ cagrilir.
         *
         * `onDisconnect` yalnizca SW YASIYORSA calisir. SW ~30 saniye atalette
         * olurken butun portlar kopar; kullanici tam o pencerede arayuzu
         * kapatirsa kopmayi duyacak hicbir dinleyici KALMAMISTIR ve "Hemen"
         * kilidi HIC gelmez. Ayni bosluk uzanti guncellemesinde ve
         * `runtime.reload()`ta da acilir.
         *
         * Kayit defteri her SW dogusunda ZATEN BOS dogar, yani acilista
         * bekleme kontrolunu baslatmak yeterlidir: gercekten acik bir arayuz
         * varsa bekleme icinde yeniden baglanir (utils/popupPort.js) ve
         * `add()` karari DUSURUR; baglanmazsa arayuz gercekten kapaliydi.
         *
         * Kasten `kontrolEt()`e devredilir: iptal/bosluk mantiginin IKINCI bir
         * kopyasi olmasin.
         */
        bootCheck() {
            kontrolEt()
        },
        size: () => ports.size,
        pending: () => graceTimer !== null,
    }
}

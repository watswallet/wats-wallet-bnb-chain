/**
 * Arayuz ile arka plan arasinda acik kalan baglanti.
 *
 * IKI ISI VAR:
 *  1. Arka plandaki kayit defterine "bir arayuz acik" demek (utils/uiRegistry.js).
 *  2. Koptugunda YENIDEN BAGLANMAK.
 *
 * (2) yeni ve zorunlu: MV3'te service worker ~30 saniye atalette sonlanir ve
 * acik bir port bu sayaci SIFIRLAMAZ (bkz. utils/ton/swKeepAlive.js bas yorumu).
 * Cuzdanin HEARTBEAT'i yalnizca kullanici girdisinde gittigi icin, girdisiz
 * gecen ~30 saniyede SW oluyor ve port kopuyordu. Eski kod tek seferlik
 * baglaniyordu: o andan sonra panel bir daha HIC kayitli olmuyordu -- yani
 * kullanici paneli gercekten kapattiginda bile kilit gelmiyordu.
 *
 * Kopma bir HATA DEGILDIR, normal isleyistir: kullaniciya gosterilmez.
 */
import { UI_PORT_PREFIX, POPUP_PORT_NAME } from './uiRegistry'

export { POPUP_PORT_NAME }

const ILK_GECIKME_MS = 250
const AZAMI_GECIKME_MS = 5000

// Bir baglantinin "tutmus" sayilmasi icin ayakta kalmasi gereken sure.
//
// NEDEN BOYLE BIR ESIK: `chrome.runtime.connect()` SW OLU OLSA BILE senkron bir
// port nesnesi dondurur (ve SW'yi uyandirir), yani "basari" neredeyse HER ZAMAN
// gerceklesir. Gecikme baglantinin hemen ardindan sifirlanirsa ustel geri
// cekilme HIC devreye girmez: `AZAMI_GECIKME_MS` olu bir sabit olur ve arka
// plan acilista firlatiyorsa (import hatasi, bozuk dist) port aninda kopar --
// arayuz saniyede dort kez `connect()` cagirip SW'yi durmadan yeniden
// baslatmaya calisir. Pil/CPU yakan sessiz bir dongu.
//
// ~30 sn'lik SW atalet olumu bu esigin USTUNDE kaldigi icin normal isleyiste
// gecikme yine 250 ms'ye doner; yalnizca GERCEKTEN kisa dongude buyur.
const KARARLI_MS = 10000

function portAdi() {
    // crypto.randomUUID her uzanti sayfasinda vardir (guvenli baglam).
    const kimlik = globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2)
    return UI_PORT_PREFIX + kimlik
}

/**
 * Arka plana baglanir ve kopmalarda ustel geri cekilmeyle yeniden baglanir.
 * @returns {{ port: chrome.runtime.Port|null, stop: () => void }}
 */
export function connectPopupPort() {
    let durduruldu = false
    let gecikme = ILK_GECIKME_MS
    let zamanlayici = null
    let kararliZamanlayici = null
    let aktif = null

    const kararliIptal = () => {
        if (kararliZamanlayici === null) return
        clearTimeout(kararliZamanlayici)
        kararliZamanlayici = null
    }

    const yenidenDene = () => {
        if (durduruldu) return
        zamanlayici = setTimeout(bagla, gecikme)
        gecikme = Math.min(gecikme * 2, AZAMI_GECIKME_MS)
    }

    const bagla = () => {
        if (durduruldu) return null
        try {
            const port = chrome.runtime.connect({ name: portAdi() })
            aktif = port

            // Gecikme BURADA SIFIRLANMAZ. Sifirlama, baglantinin KARARLI_MS
            // boyunca AYAKTA KALMASINA baglanir (yukaridaki gerekce): kisa
            // dongude her deneme bir oncekinin iki kati bekler, azami 5 sn.
            kararliIptal()
            kararliZamanlayici = setTimeout(() => {
                kararliZamanlayici = null
                gecikme = ILK_GECIKME_MS
            }, KARARLI_MS)

            port.onDisconnect.addListener(() => {
                aktif = null
                // Baglanti tutmadi: bekleyen "kararli" sayaci da dusmeli, yoksa
                // kopmus bir baglantinin sayaci sonraki denemenin gecikmesini
                // sifirlardi.
                kararliIptal()
                yenidenDene()
            })
            return port
        } catch (e) {
            // Arka plan uyanmamis olabilir; sessizce tekrar dene.
            yenidenDene()
            return null
        }
    }

    const port = bagla()

    return {
        port,
        stop() {
            durduruldu = true
            if (zamanlayici) clearTimeout(zamanlayici)
            kararliIptal()
            try { aktif?.disconnect() } catch { /* zaten kopmus */ }
        },
    }
}

/**
 * Arayuz modu: yan panel mi, acilir pencere mi?
 *
 * IKI CHROME DAVRANISI TERS YONDE CALISIR ve tasarimin cekirdegi budur:
 *
 *  - chrome.action.setPopup({popup:''}) KALICI DEGIL: tarayici yeniden
 *    baslayinca manifest'teki default_popup GERI GELIR.
 *  - chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}) KALICI:
 *    profilde saklanir; kodu silmek geri almaya YETMEZ, acikca false yazmak
 *    gerekir.
 *
 * Ayrica default_popup TANIMLIYKEN openPanelOnActionClick ETKISIZDIR (popup
 * kazanir) ve chrome.action.onClicked HIC tetiklenmez. Bu yuzden manifest'teki
 * default_popup silinmez, KOPRU olarak kullanilir (S4.2).
 *
 * SURUM DALLARI (minimum_chrome_version 115):
 *   sidePanel YOK           -> etkin mod POPUP. setPopup('') CAGRILMAZ, yoksa
 *                              ikona basan kullanici hicbir sey acilmadigini
 *                              gorur ve cuzdan ulasilmaz olur.
 *   sidePanel VAR, open YOK -> (115) panel davranisi kurulur, programatik
 *                              acma denenmez.
 *   ikisi de VAR            -> (116+) tam davranis.
 */
export const UI_MODE_KEY = 'uiMode'
export const UI_MODE_PANEL = 'sidepanel'
export const UI_MODE_POPUP = 'popup'
export const POPUP_PATH = 'src/popup/index.html'

const GECERLI = new Set([UI_MODE_PANEL, UI_MODE_POPUP])

/** Bir degerin GECERLI bir uiMode olup olmadigini soyler. background.js'in
 *  switch'i bunu GECERLILIK icin OTORITER referans olarak kullanir -- kume
 *  burada, tek yerde tanimli, baska yerde COPYALANMAZ. */
export function isValidUiMode(mode) {
    return GECERLI.has(mode)
}

export function panelSupported() {
    return typeof chrome !== 'undefined' && !!chrome.sidePanel
}

export function panelOpenSupported() {
    return panelSupported() && typeof chrome.sidePanel.open === 'function'
}

/** Kullanicinin KAYITLI tercihi (yetenek suzgecinden GECMEMIS hali). */
export async function readStoredUiMode() {
    try {
        const { [UI_MODE_KEY]: mode } = await chrome.storage.local.get(UI_MODE_KEY)
        return GECERLI.has(mode) ? mode : UI_MODE_PANEL
    } catch {
        return UI_MODE_PANEL
    }
}

/** ETKIN mod: tercih + tarayicinin gercekten yapabildigi. */
export async function readUiMode() {
    const mode = await readStoredUiMode()
    if (mode === UI_MODE_PANEL && !panelSupported()) return UI_MODE_POPUP
    return mode
}

export async function writeUiMode(mode) {
    if (!GECERLI.has(mode)) return
    try {
        await chrome.storage.local.set({ [UI_MODE_KEY]: mode })
    } catch (e) {
        console.error('Arayuz modu yazilamadi:', e)
    }
}

/**
 * KURULUM MODU: cuzdan HENUZ YOKKEN ikon tiklamasi hicbir YUZEY acmaz.
 *
 * NEDEN AYRI BIR MOD: iki normal modun ikisi de bir yuzey acar ve ikisi de
 * yanlistir. Panel modunda (`openPanelOnActionClick: true`) Chrome paneli
 * DOGRUDAN acar ve `chrome.action.onClicked` HIC TETIKLENMEZ -- yani arada
 * "once cuzdan var mi" diye bakabilecegimiz bir nokta YOKTUR. Popup modunda ise
 * kucuk pencere acilir, onboarding sekmesini acar ve kendini kapatir: kullanici
 * bir pencerenin acilip kapandigini gorur.
 *
 * UCUNCU DURUM ikisinin de kapatilmasidir: popup yolu TEMIZ **ve** panel
 * davranisi KAPALI. Chrome o zaman `chrome.action.onClicked`i tetikler ve karari
 * arka plan verir -- yalnizca onboarding sekmesi acilir.
 *
 * TEK SART, DOSYANIN BAS NOTUYLA AYNI: popup yolunu temizlemek ancak karsiliginda
 * BIR SEY acilacaksa guvenlidir. Burada onu `chrome.action.onClicked` saglar;
 * dinleyici yoksa ya da `setPanelBehavior` cagrilamiyorsa mod UYGULANMAZ ve
 * cagiran normal moda duser -- yoksa ikona basan kullanici hicbir sey acilmadigini
 * gorur ve cuzdan ULASILAMAZ olur.
 *
 * @returns {Promise<boolean>} kurulum modu gercekten kuruldu mu
 */
export async function applySetupMode() {
    const davranisKurulabilir =
        panelSupported() && typeof chrome.sidePanel.setPanelBehavior === 'function'
    const tiklamaYakalanabilir = typeof chrome?.action?.onClicked?.addListener === 'function'
    if (!davranisKurulabilir || !tiklamaYakalanabilir) return false

    try {
        // SIRA: ONCE davranisi kapat, SONRA popup yolunu temizle. Ters sirada
        // `setPanelBehavior` reddederse popup yolu ZATEN temizlenmis olur ve
        // panel hala otomatik acilir -- yani hem yuzey acilir hem karar noktasi
        // kaybolur.
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
        if (typeof chrome.action?.setPopup === 'function') {
            await chrome.action.setPopup({ popup: '' })
        }
        return true
    } catch (e) {
        console.error('Kurulum modu uygulanamadi:', e)
        return false
    }
}

/**
 * Modu tarayiciya UYGULA ve ETKIN modu dondur.
 *
 * IKI CAGRI DA ZORUNLUDUR. Yalnizca setPopup('') yapilip setPanelBehavior
 * atlanirsa ikon tiklamasi HICBIR SEY yapmaz (onClicked dinleyicisi olsa bile
 * davranis kurulmamistir).
 *
 * Ozellik adi tam olarak `openPanelOnActionClick`. Yanlis yazim senkron bir
 * TypeError firlatir ve service worker'i SESSIZCE cokertir -- uzanti tamamen
 * olu gorunur, konsola bakmadan anlasilmaz.
 *
 * setPanelBehavior/setPopup cagrilarindan once `typeof ... === 'function'`
 * kontrolu var: MV3'te bu API'ler HER ZAMAN fonksiyondur, kontrol yalnizca
 * EKSIK stub'lu test ortamlari icindir (bkz. Task 11 fix raporu -- eksik
 * stub'da cagri TypeError firlatiyor, catch'e dusup HER cagirilan testte
 * gurultulu bir stack trace basiyordu). Cagri atlanirsa o yuzeyin mevcut
 * durumu degismeden kalir; bu SESSIZCE davranis degistirmek DEGIL, sadece
 * gercekte var olmayan bir API'ye dokunmamak.
 */
export async function applyUiMode(mode) {
    const hedef = GECERLI.has(mode) ? mode : UI_MODE_PANEL

    // TEK BAYRAK, IKI CAGRI ICIN. Onceden iki cagri BAGIMSIZ kapilardan
    // geciyordu: `chrome.sidePanel` VAR ama `setPanelBehavior` YOK olan bir
    // tarayicida davranis kurulmadan popup yolu TEMIZLENIYORDU -- yani ikona
    // basan kullanici hicbir sey acilmadigini gorurdu. Bu modulun var olma
    // sebebi tam olarak o durumu onlemek. Popup yolu ARTIK yalnizca panel
    // davranisi GERCEKTEN kurulabildiyse temizlenir.
    const davranisKurulabilir =
        panelSupported() && typeof chrome.sidePanel.setPanelBehavior === 'function'

    try {
        if (hedef === UI_MODE_PANEL && davranisKurulabilir) {
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
            if (typeof chrome.action?.setPopup === 'function') {
                await chrome.action.setPopup({ popup: '' })
            }
            return UI_MODE_PANEL
        }

        // Popup modu VEYA panel davranisi kurulamiyor.
        //
        // SIRA ONEMLI (S9'daki geri alma yordamiyla AYNI): ONCE popup yolu geri
        // yazilir, SONRA kalici panel davranisi kapatilir. Ters sirada
        // `setPanelBehavior(false)` reddederse `setPopup(POPUP_PATH)` HIC
        // calismazdi -- kullanici ne panelde ne popup'ta, yani yuzeysiz kalirdi.
        if (typeof chrome.action?.setPopup === 'function') {
            await chrome.action.setPopup({ popup: POPUP_PATH })
        }
        if (davranisKurulabilir) {
            // KALICI ayari acikca geri al: kodu silmek yetmez.
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
        }
        return UI_MODE_POPUP
    } catch (e) {
        // Mod uygulanamadiysa uzanti calisir kalmali: manifest'teki default_popup
        // zaten gecerli bir yuzey.
        console.error('Arayuz modu uygulanamadi:', e)
        return UI_MODE_POPUP
    }
}

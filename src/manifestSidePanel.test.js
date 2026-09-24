import { describe, it, expect } from 'vitest'
import manifest from '../manifest.config.js'
import { POPUP_PATH } from './utils/uiMode'

// manifest.config.js NODE tarafinda calisir ve duz bir nesne dondurur:
// chrome taklidi GEREKMEZ (manifestInjection.test.js ile ayni kalip).
// dist/manifest.json testte OKUNMAZ: vitest derleme yapmaz ve eski bir dist
// yanlis yesil uretir -- bu depoda `npm run dev` dist'i bozdugu icin ozellikle
// tehlikeli. dist dogrulamasi elle yapilir.
describe('manifest -- yan panel', () => {
    it("permissions icinde 'sidePanel' var", () => {
        expect(manifest.permissions).toContain('sidePanel')
    })

    it('mevcut izinler korunuyor', () => {
        for (const izin of ['storage', 'alarms']) {
            expect(manifest.permissions).toContain(izin)
        }
        // 'tabs' dizide SONUNDA BOSLUKLA yazili; esitlik yerine gevsek arama.
        expect(manifest.permissions.some(p => p.trim() === 'tabs')).toBe(true)
    })

    it('side_panel.default_path panel sayfasini gosterir', () => {
        expect(manifest.side_panel).toBeDefined()
        expect(manifest.side_panel.default_path).toBe('src/sidepanel/index.html')
    })

    // crxjs `htmlFiles()` icinde yolu `split(/[#?]/)[0]` ile KIRPAR. Yola
    // parametre koymak sessizce duser -- panel kendi pencere kimligini
    // URL'den DEGIL, chrome.windows.getCurrent() ile ogrenir (S4.8).
    it('default_path hash veya sorgu parametresi TASIMAZ', () => {
        expect(manifest.side_panel.default_path).not.toMatch(/[#?]/)
    })

    // KOPRU: setPopup('') tarayici yeniden baslayinca sifirlaniyor ve
    // manifest'teki deger geri geliyor. default_popup'i silmek, o ilk
    // tiklamada kullaniciyi yuzeysiz birakirdi.
    it('action.default_popup SILINMEDI (kopru olarak duruyor)', () => {
        expect(manifest.action.default_popup).toBe('src/popup/index.html')
    })

    // M8 -- AYNI YOL, IKI BAGIMSIZ LITERAL. `utils/uiMode.js`in POPUP_PATH'i
    // popup moduna donerken `chrome.action.setPopup`a verilen degerdir;
    // manifest'teki `default_popup` ise tarayici yeniden baslatildiginda geri
    // gelen degerdir. Ikisi ayrisirsa hicbir test kirilmadan popup modu YANLIS
    // (ya da var olmayan) bir sayfaya isaret eder -- ve hata yalnizca gercek bir
    // tarayicida, ikona basildiginda gorunur. Bu iddia iki literali baglar.
    it('M8: POPUP_PATH ile manifest.action.default_popup AYNI', () => {
        expect(POPUP_PATH).toBe(manifest.action.default_popup)
    })

    // sidePanel API'si 114+, ama open() 116+. Surumu yukseltmek 115'teki
    // kullanicilarin GUVENLIK yamalarini da almayi durdururdu; bunun yerine
    // her cagri yetenek kontrolunden geciyor (utils/uiMode.js).
    it('minimum_chrome_version 115 te kaldi', () => {
        expect(manifest.minimum_chrome_version).toBe('115')
    })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz, saltKod, blokGovdesi } from '../test-utils/kaynakTarama'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

const bootstrap = read('shared/bootstrap.js')
const popupMain = read('popup/main.js')
const panelMain = read('sidepanel/main.js')
const panelHtml = read('sidepanel/index.html')

// `bootstrapWalletUi`nin KENDI govdesi -- suslu parantez ESLESTIRILEREK
// kesilir (satir sonundan bagimsiz), yorumlari BOSLUKLA degistirilmis kaynaktan.
const bootstrapWalletUiGovdesi = blokGovdesi(bootstrap, /export function bootstrapWalletUi\([^)]*\)\s*/)

describe('ortak onyukleme', () => {
    // KOD INCELEMESI (import turu): `toContain('createApp')` dosya genelinde
    // ariyordu ve 10. satirdaki `import { createApp } from 'vue'` onu TEK
    // BASINA sagliyordu. Olculdu: `const app = createApp(App)` satiri
    // `const app = globalThis.__app` ile degistirildiginde -- yani bootstrap
    // artik hicbir Vue uygulamasi KURMUYORKEN -- iddia YESIL kaliyordu.
    // Cagri artik fonksiyonun GOVDESINDE aranir; import govdenin disinda.
    it('bootstrap Vue uygulamasini kurar ve mount eder', () => {
        expect(bootstrapWalletUiGovdesi).not.toBeNull()
        expect(bootstrapWalletUiGovdesi).toMatch(/\bcreateApp\s*\(/)
        expect(bootstrapWalletUiGovdesi).toContain("mount('#app')")
    })

    it('bootstrap yuzeyi parametre olarak alir', () => {
        expect(bootstrap).toMatch(/export function bootstrapWalletUi\(\{\s*surface/)
    })

    // KOD INCELEMESI (import turu): testin adi iki girisin bootstrap'i
    // CAGIRDIGINI soyluyor ama `toContain('bootstrapWalletUi')` her iki
    // dosyada da 1. satirdaki IMPORT tarafindan saglaniyordu. Olculdu: gercek
    // cagri (popup/main.js 65, sidepanel/main.js 10) silinip import
    // birakildiginda iddia IKISINDE DE YESIL kaliyordu. Artik yorumlari ve
    // import satirlari temizlenmis kaynakta CAGRI aranir.
    it('iki giris de bootstrap i cagirir', () => {
        expect(saltKod(popupMain)).toMatch(/\bbootstrapWalletUi\s*\(/)
        expect(saltKod(panelMain)).toMatch(/\bbootstrapWalletUi\s*\(/)
    })

    // Negatif iddia yorumsuz kaynakta yapilir: bugun dogru olsa da, giris
    // dosyalarindan birine `createApp`i ANAN bir yorum yazilmasi testi yanlis
    // yere kirmiziya cevirirdi (olculdu). Olculen sey KOPYA KOD, prose degil.
    it('giris dosyalari Vue uygulamasini KENDILERI kurmaz (kopya kod yok)', () => {
        expect(yorumsuz(popupMain)).not.toContain('createApp')
        expect(yorumsuz(panelMain)).not.toContain('createApp')
    })
})

describe('panel giris noktasi', () => {
    it('index.html sade: #app + modul betigi', () => {
        expect(panelHtml).toContain('<div id="app"></div>')
        expect(panelHtml).toContain('<script type="module" src="./main.js"></script>')
    })

    // popup/index.html'deki satir ici POPUP_READY / CLOSE_POPUP betigi OLU KOD
    // (alicisi/gondereni yok) ve panele TASINMADI.
    it('index.html olu POPUP_READY / CLOSE_POPUP betigini TASIMAZ', () => {
        expect(panelHtml).not.toContain('POPUP_READY')
        expect(panelHtml).not.toContain('CLOSE_POPUP')
    })

    // Yorumsuz kaynak: satirin basina `// ` konulmasi bu iddiayi yesil
    // birakiyordu (ayni kusur popupStandaloneWindow.test.js'te de vardi;
    // sinifin mount'tan ONCE konuldugu orada kilitleniyor).
    it('panel girisi side-panel sinifini koyar', () => {
        expect(yorumsuz(panelMain)).toContain("classList.add('side-panel')")
    })

    // KOD INCELEMESI (import turu): testin adi "SURFACE_PANEL ILE onyukler"
    // diyor ama `toContain('SURFACE_PANEL')` 2. satirdaki IMPORT tarafindan
    // saglaniyordu. Olculdu: cagri `bootstrapWalletUi()` yapilip yuzey
    // argumani TAMAMEN kaldirildiginda -- panel sessizce POPUP yuzeyi olarak
    // acilirken -- iddia YESIL kaliyordu; cagri butunuyle silindiginde de
    // yesil kaliyordu. Sabit artik CAGRININ ARGUMANI olarak aranir.
    it('panel girisi SURFACE_PANEL ile onyukler', () => {
        expect(yorumsuz(panelMain)).toMatch(/bootstrapWalletUi\(\s*\{\s*surface:\s*SURFACE_PANEL\s*\}\s*\)/)
    })
})

describe('popup girisi -- mevcut isaretler korundu', () => {
    // popupStandaloneWindow.test.js bu iki dizgeyi ariyor; bootstrap tasimasi
    // sirasinda kaybolmalari sessiz bir gerileme olurdu.
    it("'#window' hash kontrolu ve standalone-window sinifi popup/main.js'te", () => {
        expect(popupMain).toMatch(/window\.location\.hash === '#window'/)
        expect(popupMain).toContain("classList.add('standalone-window')")
    })
})

// uiSync.js kendi testinde (uiSync.test.js) izole olarak dogrulaniyor, ama
// bootstrap.js NODE ortaminda CALISTIRILAMAZ (chrome, Vue mount, gercek
// store'lar gerekir) -- kablolamanin kendisi (import + cagri + teardown'i
// SAKLAMA + SIRA) hicbir testte olculmuyordu. Diger testler gibi readFileSync
// + regex kaynak kilidi kullanilir; sira kontrolu butun DOSYADA degil, SADECE
// bootstrapWalletUi'nin govdesinde yapilir -- yoksa yorumlardaki veya baska
// bir fonksiyondaki rastlantisal bir esleme testi sessizce yesile cevirebilir.
//
// KOD INCELEMESI: `bootstrapOnGovde` eskiden `slice(0, indexOf(...))` idi ve
// indexOf BULAMAZSA -1 donup `slice(0, -1)` BUTUN DOSYAYI (eksi bir karakter)
// veriyordu -- bolge-kapsamli iddia sessizce dosya-genelinde bir aramaya
// donusuyordu. Olculdu: imza `export const bootstrapWalletUi = (` seklinde
// yeniden yazilip `let uiSyncTeardown` fonksiyonun ICINE tasindiginda, tam da
// bunu yakalamak icin var olan asagidaki iddia YESIL kaliyordu. Cipa artik
// acikca dogrulanir.
const bootstrapImzaAt = yorumsuz(bootstrap).indexOf('export function bootstrapWalletUi')
const bootstrapOnGovde = bootstrapImzaAt === -1 ? null : yorumsuz(bootstrap).slice(0, bootstrapImzaAt)

describe('uiSync kablolamasi -- paneller arasi durum koprusu', () => {
    it("installUiSync '../utils/uiSync'den import edilir", () => {
        expect(bootstrap).toMatch(/import\s*\{\s*installUiSync\s*\}\s*from\s*['"]\.\.\/utils\/uiSync['"]/)
    })

    it('uiSyncTeardown MODUL kapsaminda (fonksiyon disinda) tanimlanir', () => {
        expect(bootstrapOnGovde).not.toBeNull()
        expect(bootstrapOnGovde).toMatch(/\blet\s+uiSyncTeardown\s*=/)
    })

    it('bootstrapWalletUi govdesi installUiSync i UC bagimlilikla cagirir ve donen teardown u SAKLAR (atmaz)', () => {
        // Donus degeri bir degiskene ATANMALI -- sadece installUiSync(...) i
        // cagirip sonucu atmak teardown'i sonsuza dek kaybeder.
        expect(bootstrapWalletUiGovdesi).toMatch(
            /uiSyncTeardown\s*=\s*installUiSync\(\s*\{\s*userStore\s*,\s*networkStore\s*,\s*i18n\s*\}\s*\)/
        )
    })

    it('ONCEKI teardown, YENISI atanmadan ONCE cagrilir (yoksa listener SIZAR)', () => {
        const guardIndex = bootstrapWalletUiGovdesi.indexOf('uiSyncTeardown?.()')
        const assignIndex = bootstrapWalletUiGovdesi.indexOf('uiSyncTeardown = installUiSync(')

        expect(guardIndex).toBeGreaterThan(-1)
        expect(assignIndex).toBeGreaterThan(-1)
        expect(guardIndex).toBeLessThan(assignIndex)
    })
})

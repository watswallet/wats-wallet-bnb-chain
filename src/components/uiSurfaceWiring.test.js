import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz, saltKod } from '../test-utils/kaynakTarama'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

// Panelde calisan bilesenlerde ham `window.close()` KALMAMALI: orada bu cagri
// ya hicbir sey yapmaz ya da TUM paneli kapatir -- ikisi de cagri yerinin
// niyeti degil. Niyet "su ekrana don"du ve artik acikca yaziliyor.
const PANEL_BILESENLERI = [
    'components/settings/security/ResetApp.vue',
    'components/ForgotPassword.vue',
    'components/settings/security/ChangePassword.vue',
    'components/settings/AddWallets.vue',
    'components/Settings.vue',
    'popup/App.vue',
    // Spec S4.7 bu dosyayi ON call site arasinda sayiyor ve S3.6 acikca
    // "reject() icindeki window.close() ... S4.7 bu cagriyi zaten donusturuyor"
    // diyor; Gorev 14 dosyayi ATLADI ve bu liste de atladigi icin asagidaki
    // NEGATIF iddia tam da hala ham cagri tasiyan tek bileseni KAPSAMIYORDU.
    'components/ConfirmTransaction.vue',
]

describe('panel bilesenlerinde ham window.close yok', () => {
    for (const yol of PANEL_BILESENLERI) {
        // KOD INCELEMESI (yorum/import turu): `toContain('closeOrNavigate')`
        // YEDI dosyanin HEPSINDE zaten IMPORT satiri tarafindan saglaniyordu
        // (ConfirmTransaction.vue'de ustelik bir de YORUM var, 1477. satir).
        // Olculdu: ForgotPassword.vue, popup/App.vue ve ConfirmTransaction.vue
        // icinde TUM `closeOrNavigate(...)` CAGRILARI silinip import
        // birakildiginda iddia UCUNDE de YESIL kaliyordu -- yani "closeOrNavigate
        // kullanir" adli test, bilesen onu kullanmayi BIRAKTIGINDA kirmizi
        // OLAMIYORDU. Artik yorumlar ve import satirlari temizlenmis kaynakta
        // bir CAGRI aranir.
        it(`${yol} closeOrNavigate kullanir`, () => {
            const kaynak = read(yol)
            // Negatif iddia BILEREK HAM kaynakta kalir: onu yorum-kor yapmak
            // ispat gucunu DUSURURDU (bir yorumun bile ham cagriyi anmasi
            // burada istenmiyor).
            expect(kaynak).not.toMatch(/window\.close\(\)/)
            expect(saltKod(kaynak)).toMatch(/\bcloseOrNavigate\s*\(/)
        })
    }
})

// Dosya duzeyindeki NEGATIF iddia "ham cagri KALMADI" der ama cagrinin YERINE
// NE kondugunu soylemez. Bu iddia `reject()`in KENDI govdesine bakar: iki satir
// yer degistirse ya da `closeOrNavigate` baska bir fonksiyona tasinsa
// (regresyon) yukaridaki liste YINE yesil kalirdi.
describe('ConfirmTransaction.reject() -- hedef ACIKCA verilir', () => {
    it("reject() govdesi closeOrNavigate('send', ...) cagirir", () => {
        const kaynak = read('components/ConfirmTransaction.vue')
        // `\r?\n`: bu depoda satir sonlari dosyadan dosyaya degisiyor (CRLF/LF).
        const govdeEslesme = kaynak.match(/const reject = \(\) => \{\r?\n([\s\S]*?)\r?\n\}/)
        expect(govdeEslesme).not.toBeNull()
        expect(govdeEslesme[1]).toMatch(/closeOrNavigate\('send',\s*\{\s*page\s*\}\)/)
    })
})

describe('kapsam disi kalan cagri yerleri', () => {
    // Onboarding AYRI BIR SEKMEDE acilir, panel degildir: window.close()
    // orada dogru davranistir.
    //
    // KOD INCELEMESI (yorum turu): Ready.vue'de `window.close()` dizgesi IKI
    // kez geciyor -- 76. satir bir YORUM ("Eskiden once window.close() sonra
    // chrome.action.openPopup()") ve 106. satir gercek cagri. Olculdu: gercek
    // cagri silindiginde iddia YALNIZCA o yorum sayesinde YESIL kaliyordu.
    // Iddia artik yorumlari temizlenmis kaynakta, CAGRI olarak arar.
    it('onboarding sekmesi window.close kullanmaya devam eder', () => {
        expect(yorumsuz(read('components/onboarding/Ready.vue'))).toContain('window.close()')
        expect(yorumsuz(read('components/onboarding/index.vue'))).toContain('window.close()')
    })

    // Olu kod: CLOSE_POPUP'i GONDEREN hicbir yer yok.
    it('popup/index.html olu CLOSE_POPUP betigini artik tasimaz', () => {
        const html = read('popup/index.html')
        expect(html).not.toContain('CLOSE_POPUP')
        expect(html).not.toContain('POPUP_READY')
    })
})

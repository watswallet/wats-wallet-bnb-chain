import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz, cagriGovdesi, diziGovdesi } from '../test-utils/kaynakTarama'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

const app = read('popup/App.vue')
const notice = read('components/SidePanelNotice.vue')
const prefs = read('components/settings/Preferences.vue')

describe('bildirim karti -- App.vue tel', () => {
    // Kart `.page-wrapper`in DISINDA olmali: icine konursa `:key` her sayfa
    // degisiminde onu SOKER ve animasyonla yeniden sokar.
    it('kart page-wrapper in DISINDA render ediliyor', () => {
        const kartAt = app.indexOf('<SidePanelNotice')
        const wrapperAt = app.indexOf('class="page-wrapper"')
        expect(kartAt).toBeGreaterThan(-1)
        expect(kartAt).toBeLessThan(wrapperAt)
    })

    it('kart import edildi', () => {
        expect(app).toContain("import SidePanelNotice from '../components/SidePanelNotice.vue'")
    })
})

describe('bildirim karti -- gorunme kosullari', () => {
    // Uc sartin UCU DE `gorunur` computed'inin ICINDE aranir, dosyanin
    // herhangi bir yerinde DEGIL.
    //
    // KOD INCELEMESI (CRLF/yorum turu, Bulgu B1): onceki hal
    // `expect(notice).toContain('isPanel')` idi. 'isPanel' dosyada IKI kez
    // geciyor: 54. satirdaki IMPORT ve 66. satirdaki gercek `&& isPanel()`
    // kapisi. `&& isPanel()` satiri computed'dan TAMAMEN silinse bile import
    // iddiayi tek basina saglayip testi YESIL tutuyordu -- yani "yalniz panel
    // yuzeyinde" adli test, o yuzey kapisi kaldirildiginda kirmizi OLAMIYORDU.
    const gorunurGovdesi = () => cagriGovdesi(notice, 'const gorunur = computed(')

    it('yalniz panel yuzeyinde', () => {
        const govde = gorunurGovdesi()
        expect(govde).not.toBeNull()
        expect(govde).toMatch(/&&\s*isPanel\(\)/)
    })

    // KOD INCELEMESI (final inceleme, I4): onceki hali
    // `/sidePanelNoticeSeen\s*===\s*true|=== true/` idi ve DOSYANIN TAMAMINDA
    // ariyordu. Gercek kontrol `gorulmus !== true`; dosyadaki TEK `=== true`
    // ise bas yorumun icinde ("KATI `=== true` karsilastirmasi"). Yani iddia
    // YALNIZCA bir YORUM sayesinde geciyordu: mekanik olarak dogrulandi --
    // yorumlar cikarilinca regex eslesmiyor, gercek kontrol gevsek `!gorulmus`e
    // cevrildiginde ise test YINE YESIL kaliyordu. Iki SSR testi de bunu
    // kapatmiyor (hem `!gorulmus` hem `gorulmus !== true` ikisini de saglar).
    //
    // NEDEN KATI OLMALI: depo EKSIK anahtar icin `undefined` doner. `!gorulmus`
    // yazilsaydi "false" ve "0" gibi degerler de karti GOSTERIR duruma gecerdi;
    // dahasi bayrak acikca `false` yazilmis bir kurulumda davranis TERSINE
    // donerdi. Assertion artik `onMounted` GOVDESINE (kardes kapat()/bayragiYaz()
    // testleriyle AYNI kalip) ve GERCEK tanimlayiciya bakar.
    //
    // SATIR SONU TUZAGI (bu tur): yakalama `\{\n` yaziyordu. Dosya diskte
    // CRLF, yani `{`in hemen ardindaki baytlar `\r\n` -- `\n` ESLESMIYOR ve
    // `match()` null donuyordu ("expected null not to be null"). Regex artik
    // `\r?\n` kullanir; iki satir sonu bicimiyle de AYNI bolgeyi yakalar.
    it('onMounted govdesi bayragi KATI karsilastirir (gorulmus !== true)', () => {
        const govdeEslesme = notice.match(/onMounted\(async \(\) => \{\r?\n([\s\S]*?)\r?\n\}\)/)
        expect(govdeEslesme).not.toBeNull()
        expect(govdeEslesme[1]).toMatch(/gorulmus\s*!==\s*true/)
    })

    // KOD INCELEMESI (Bulgu B2): onceki hal dosyanin TAMAMINDA `'welcome'` ve
    // `'forgot_password'` ariyordu. Ikisi de YALNIZCA 59. satirdaki
    // `KILIT_EKRANLARI` dizisinde geciyor -- yani iddia bir SABITIN varligini
    // olcuyordu, o sabitin gorunurluk kararinda KULLANILDIGINI degil.
    // `gorunur` computed'indan `&& !KILIT_EKRANLARI.includes(...)` satiri
    // silinse (tam da testin adindaki gizleme mantigi) test YESIL kaliyordu.
    // Artik IKI parca da ayri ayri aranir: liste dogru ekranlari sayar VE
    // computed listeyi GERCEKTEN sorgular.
    it('kilit/karsilama ekranlarinda gizli', () => {
        const liste = diziGovdesi(notice, 'const KILIT_EKRANLARI =')
        expect(liste).not.toBeNull()
        expect(liste).toMatch(/'welcome'/)
        expect(liste).toMatch(/'forgot_password'/)

        const govde = gorunurGovdesi()
        expect(govde).not.toBeNull()
        expect(govde).toMatch(/&&\s*!KILIT_EKRANLARI\.includes\(page\.currentPage\)/)
    })

    // Kapatma yazimi ONCE depoya, SONRA ekrana: ters sirada yazilir ve depo
    // yazimi sessizce duserse kart bir sonraki acilista geri gelir.
    //
    // KOD INCELEMESI (Gorev 15 fix turu 1, Bulgu 1): onceki hali dosyanin
    // HERHANGI BIR YERINDE 'storage.local.set' < 'gorunur.value = false'
    // ARIYORDU -- `gorunur` READONLY bir computed oldugu icin GERCEK kodda
    // bu alt dizge HICBIR ZAMAN GECEMEZ, yani iddia yalniz oraya EKLENMIS bir
    // YORUM sayesinde gecerdi. Boyle bir test GERCEK sirayi degil bir
    // yorumun KONUMUNU olcer: `kapat()` icinde iki satir yer degistirse
    // (gercek bir regresyon -- bayrak karti gizledikten SONRA yazilsa) bu
    // test YINE YESIL kalirdi. Asagidaki iki test bunun yerine `kapat()`in
    // GOVDESINE (dosyanin baska bir yerine DEGIL) ve GERCEK tanimlayiciya
    // (`gosterilebilir.value = false`, `gorunur`in TUREDIGI ref) bakar.
    it('kapat() govdesi ONCE bayragiYaz()i cagirir, SONRA karti gizler', () => {
        // `\r?\n`: dosya diskte CRLF; duz `\n` `{`in yanindaki `\r`e takilip
        // null donuyordu.
        const govdeEslesme = notice.match(/async function kapat\(\) \{\r?\n([\s\S]*?)\r?\n\}/)
        expect(govdeEslesme).not.toBeNull()
        const govde = govdeEslesme[1]

        const yazAt = govde.indexOf('bayragiYaz()')
        const gizleAt = govde.indexOf('gosterilebilir.value = false')
        expect(yazAt).toBeGreaterThan(-1)
        expect(gizleAt).toBeGreaterThan(yazAt)
    })

    it('bayragiYaz() govdesi GERCEKTEN depoya yazar (chrome.storage.local.set)', () => {
        // `\r?\n`: yukaridaki ile ayni CRLF tuzagi.
        const govdeEslesme = notice.match(/async function bayragiYaz\(\) \{\r?\n([\s\S]*?)\r?\n\}/)
        expect(govdeEslesme).not.toBeNull()
        expect(govdeEslesme[1]).toContain('chrome.storage.local.set')
    })
})

describe('kalici tercih -- Ayarlar', () => {
    // KOD INCELEMESI (Bulgu C1): `toContain('settings.preferences.uiMode')`
    // ONEKLE saglaniyordu. Dosyada uc anahtar var ve ikisi digerinin onekiyle
    // basliyor: `settings.preferences.uiMode` (satirin ETIKETI),
    // `settings.preferences.uiModePanel` ve `...uiModePopup` (alt satirdaki
    // durum metni). Etiket satiri tamamen silinse bile `uiModePanel` alt
    // dizgeyi saglayip testi YESIL tutuyordu. Artik anahtar TAM olarak,
    // `$t(...)` cagrisinin ICINDE aranir.
    it('Preferences.vue arayuz modu satiri tasir', () => {
        const kod = yorumsuz(prefs)
        expect(kod).toContain('SET_UI_MODE')
        expect(kod).toMatch(/\$t\('settings\.preferences\.uiMode'\)/)
    })
})

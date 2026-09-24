import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz, blokGovdesi, cssKuralGovdesi, cssSeciciListesi } from '../test-utils/kaynakTarama'

// KAYNAK KILIDI -- popup/style.css'teki pencere modu (chrome.windows.create ile acilan
// onay ekranlari) boyutlandirmasi.
//
// Kapatilan hata: `html/body/#app` temel kurallari 360x600'u `!important` ile sabitler.
// CSS'te `!important` her zaman `!important` OLMAYANI yener -- secici ne kadar ozel
// olursa olsun. Pencere modu geçersiz kilmalari onemsiz birakildiginda zincir
// html'de KOPUYOR ve sayfa, penceresinin gercek yuksekligi ne olursa olsun 600px'te
// kaliyordu. Olculen sonuc (CDP, 700px'lik gorunum): html/body/#app/.page-wrapper
// hepsi 600px, buton seridinin alti 600'de bitiyor -> 100px OLU SERIT.
const kaynak = readFileSync(fileURLToPath(new URL('./style.css', import.meta.url)), 'utf8')

// `html.standalone-window ...` ile baslayip ilk `}`e kadar olan blok.
const pencereBloku = () => {
    const bas = kaynak.indexOf('html.standalone-window,')
    expect(bas).toBeGreaterThan(-1)
    const son = kaynak.indexOf('}', bas)
    expect(son).toBeGreaterThan(bas)
    return kaynak.slice(bas, son + 1)
}

describe('popup/style.css -- pencere modu boyutlandirmasi', () => {
    it('temel html/body/#app kurallari 600px sabitini !important ile tasir (on kosul)', () => {
        // Bu dogru KALDIGI surece asagidaki !important sarti gereklidir. Temel
        // kurallardan !important kaldirilirsa bu test kirmizi olur ve pencere modu
        // kurallarinin da gozden gecirilmesi gerektigini soyler.
        //
        // KOD INCELEMESI: onceki hal `html.standalone-window,` isaretine kadar
        // olan 1486 karakterlik BOLGEDE tek bir eslesme ariyordu. Iki ayri
        // sekilde kirmizi OLAMIYORDU: (1) testin adi UC temel kuraldan
        // bahsederken YALNIZ BIRINDE `!important` bulunmasi yetiyordu -- olculdu,
        // sadece `html {}` kuralindan `!important` kaldirildiginda hicbir test
        // kirmiziya donmuyordu; (2) bolge CSS YORUMLARINI da iceriyordu --
        // olculdu, uc kuraldan da `!important` silinip yerine tek satirlik bir
        // `/* ... height: 600px !important ... */` yorumu konuldugunda iddia
        // yesile donuyordu. Artik her kural AYRI AYRI, yorumlari temizlenmis
        // kaynaktan kesilip denetlenir.
        const standaloneAt = yorumsuz(kaynak).indexOf('html.standalone-window,')
        for (const secici of ['html {', 'body {', '#app {']) {
            expect(yorumsuz(kaynak).indexOf(secici), secici).toBeGreaterThan(-1)
            expect(yorumsuz(kaynak).indexOf(secici), secici).toBeLessThan(standaloneAt)
            const govde = cssKuralGovdesi(kaynak, secici)
            expect(govde, secici).not.toBeNull()
            expect(govde, secici).toMatch(/height:\s*600px\s*!important/)
            expect(govde, secici).toMatch(/width:\s*360px\s*!important/)
        }
    })

    // KOD INCELEMESI: onceki haldeki DORT `toContain`den ILKI TOTOLOJIKTI --
    // `blok` zaten `kaynak.indexOf('html.standalone-window,')` konumundan
    // BASLIYOR, yani `blok.toContain('html.standalone-window,')` hicbir girdide
    // kirmizi olamazdi (olculdu: `html.standalone-window,garbage}` gibi bilerek
    // bozulmus girdilerde bile yesil; tek yanlislayan durum `bas === -1`, onu da
    // yukaridaki `toBeGreaterThan(-1)` zaten yakaliyor). Artik secici listesi
    // ayristirilip TAM OLARAK bu dortlukle karsilastirilir: fazla, eksik ya da
    // bozuk bir secici kirmizidir.
    it('pencere modu html, body, #app ve .page-wrapper icin gecerlidir', () => {
        expect(cssSeciciListesi(kaynak, 'html.standalone-window,')).toEqual([
            'html.standalone-window',
            'html.standalone-window body',
            'html.standalone-window #app',
            'html.standalone-window .page-wrapper',
        ])
    })

    it('pencere modu genislik ve yuksekligi !important ile %100 yapar', () => {
        const blok = pencereBloku()
        expect(blok).toMatch(/width:\s*100%\s*!important/)
        expect(blok).toMatch(/height:\s*100%\s*!important/)
    })

    it('ekran kok kutusu da pencere modunda %100 kalir', () => {
        expect(kaynak).toMatch(/html\.standalone-window \.page-wrapper > div\s*\{[^}]*height:\s*100%\s*!important/)
    })
})

describe('popup/main.js -- pencere modu isareti', () => {
    const main = readFileSync(fileURLToPath(new URL('./main.js', import.meta.url)), 'utf8')

    it("standalone-window sinifi yalnizca '#window' hash'inde eklenir", () => {
        // Arka plan onay penceresini `index.html#window` ile acar (dappFunctions.js
        // openApprovalWindow). Hash kontrolu duserse acilir listedeki popup da
        // pencere modu kurallarina girer ve 360x600 sabiti bozulur.
        //
        // KOD INCELEMESI: iki iddia da dosya GENELINDE arayan, birbirinden
        // BAGIMSIZ dizge aramalariydi -- testin adindaki "YALNIZCA" iddiasi
        // hicbirinde olculmuyordu. Olculdu: `if (pencereModu) { ... }` sarmali
        // silinip sinif HER popup acilisinda eklendiginde iddialar YESIL
        // kaliyordu; `const pencereModu = false` yazilip hash kontrolu bir
        // YORUMA tasindiginda da yesil kaliyordu. Artik hash kontrolu bir ATAMA
        // olarak aranir ve sinif ekleme o kosulun GOVDESINDE olmak zorundadir.
        const kod = yorumsuz(main)
        expect(kod).toMatch(/const pencereModu = window\.location\.hash === '#window'/)

        const kosulGovdesi = blokGovdesi(main, /if \(pencereModu\)\s*/)
        expect(kosulGovdesi).not.toBeNull()
        expect(kosulGovdesi).toContain("classList.add('standalone-window')")
    })
})

// UCUNCU MOD -- yan panel.
//
// Yeni blok, standalone blogundan AYRI ve onun ALTINDA olmak zorunda:
// yukaridaki `pencereBloku()` yardimcisi `html.standalone-window,` dizgesinden
// ilk `}` karakterine kadar kesiyor ve dort ayri `toContain` yapiyor. Iki modu
// tek bir secici listesinde birlestirmek o testi kirar.
const panelBloku = () => {
    const bas = kaynak.indexOf('html.side-panel,')
    expect(bas).toBeGreaterThan(-1)
    const son = kaynak.indexOf('}', bas)
    expect(son).toBeGreaterThan(bas)
    return kaynak.slice(bas, son + 1)
}

describe('popup/style.css -- yan panel modu', () => {
    it('panel blogu standalone blogunun ALTINDA', () => {
        // Yer onemli: ilk testteki `kaynak.slice(0, indexOf('html.standalone-window,'))`
        // dilimi temel kurallari olcuyor. Panel blogu o isaretin ONUNE konursa
        // dilime girer ve blok siniri yanilticilasir.
        expect(kaynak.indexOf('html.side-panel,')).toBeGreaterThan(kaynak.indexOf('html.standalone-window,'))
    })

    // Yukaridaki standalone ikiziyle AYNI totoloji (ilk `toContain` kesilen
    // blogun BASLANGIC dizgesiydi); ayni sekilde TAM secici listesi ile
    // degistirildi.
    it('panel modu html, body, #app ve .page-wrapper icin gecerlidir', () => {
        expect(cssSeciciListesi(kaynak, 'html.side-panel,')).toEqual([
            'html.side-panel',
            'html.side-panel body',
            'html.side-panel #app',
            'html.side-panel .page-wrapper',
        ])
    })

    // KILIT ZINCIRI: temel kurallar 360x600'u `!important` ile sabitliyor ve
    // `!important` her zaman `!important` OLMAYANI yener. Besli zincirden
    // (html, body, #app, .page-wrapper, .page-wrapper > div) biri atlanirsa
    // zincir orada kopar ve panel 360px kalir -- 2026-09-05'te pencere modunda
    // yasanan olu-serit hatasinin aynisi.
    it('panel modu genislik ve yuksekligi !important ile %100 yapar', () => {
        const blok = panelBloku()
        expect(blok).toMatch(/width:\s*100%\s*!important/)
        expect(blok).toMatch(/height:\s*100%\s*!important/)
    })

    it('ekran kok kutusu da panel modunda %100 kalir', () => {
        expect(kaynak).toMatch(/html\.side-panel \.page-wrapper > div\s*\{[^}]*height:\s*100%\s*!important/)
    })

    // OLCULDU 2026-09-14 (gercek derlenmis CSS + Chrome, 360/420/500/600/760/1000px):
    // panel genisletildikce ekran kokunun HER YANINDA sirasiyla 0/0/40/90/170/290px
    // bos siyah serit kaliyordu -- kullanici bildirimi "sidebar genis ekranlarda
    // yanlarda siyah bosluk yapiyor".
    //
    // KOK NEDEN: `width` `max-width`i YENMEZ. Zincir genisligi `100% !important`
    // yapiyordu ama HER ekran kokunun kendi Tailwind sinifi (`max-w-[420px]
    // mx-auto` -- Home/Send/Swap/ApprovalShell... hepsinde ayni) 420px'te
    // kelepceliyor, `mx-auto` da artani iki yana bosluk olarak dagitiyordu.
    // Serit `body`nin zeminiyle (rgb(9,9,11)) AYNI renk oldugu icin duz siyah
    // gorunuyordu.
    //
    // AYRI TEST: yukaridaki `height` olcumune eklenmedi -- ikisi FARKLI seyler
    // soyluyor ve biri gecerken oteki dusebilmeli.
    it('ekran kok kutusunun 420px kelepcesi panel modunda ACILIR', () => {
        expect(kaynak).toMatch(/html\.side-panel \.page-wrapper > div\s*\{[^}]*max-width:\s*100%\s*!important/)
    })
})

describe('sidepanel/main.js -- panel modu isareti', () => {
    const panelMain = readFileSync(fileURLToPath(new URL('../sidepanel/main.js', import.meta.url)), 'utf8')

    // KOD INCELEMESI: dosya genelinde tek bir dizge aramasiydi ve iki sekilde
    // kirmizi OLAMIYORDU. (1) Cagri satirinin basina `// ` konuldugunda dizge
    // YORUMUN ICINDE hayatta kaliyordu (olculdu: yesil). (2) sidepanel/main.js
    // 4-7. satirlardaki yorumun acikca yazdigi kural -- sinif Vue mount'undan
    // ONCE konmali, yoksa ilk cizim 360px olur ve panel gozle gorulur bicimde
    // ziplar -- hic olculmuyordu: cagri `bootstrapWalletUi(...)` SONRASINA
    // tasindiginda da yesil kaliyordu. Artik yorumsuz kaynakta, mount
    // cagrisindan ONCE olmak sartiyla aranir.
    it("'side-panel' sinifi panel girisinde ekleniyor", () => {
        const kod = yorumsuz(panelMain)
        const sinifAt = kod.indexOf("classList.add('side-panel')")
        const mountAt = kod.indexOf('bootstrapWalletUi(')
        expect(sinifAt).toBeGreaterThan(-1)
        expect(mountAt).toBeGreaterThan(-1)
        expect(sinifAt).toBeLessThan(mountAt)
    })
})

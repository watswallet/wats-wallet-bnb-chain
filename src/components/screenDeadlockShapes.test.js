// SINIF KILIDI, IKINCI YARI -- KAYNAK UZERINDEN, YORUM-KOR, ZINCIRDEN BAGIMSIZ.
//
// Kardes dosya `screenSetupPageWrite.ssr.test.js` ekranlari GERCEKTEN render
// eder ve "setup/render sirasinda currentPage yazilmadi" iddiasini DAVRANISLA
// olcer. O olcumun IKI kor noktasi var ve ikisi de tam olarak bu isin konusu
// olan KALICI SIYAH EKRANI uretebilir:
//
// 1) SSR BAZI KANCALARI HIC CALISTIRMAZ. `onMounted` calismaz (zaten duzeltme
//    de bunu kullaniyor) -- ama `onBeforeMount` DA calismaz. Oysa
//    `onBeforeMount` yamadan ONCE, `onMounted`in cozdugu sorunun TAM ICINDE
//    kosar: orada yazilan bir `currentPage` gecisi aynen kilitler ve SSR
//    kilidi bunu YESIL gecer. Ayni sey bir DEGISIMLE atesleyecek
//    `flush: 'sync'` izleyicisi icin de gecerli: kurulur, SSR'da atesle*mez*,
//    gercekte patch'in ORTASINDA senkron kosar.
//
// 2) DAVRANIS KOSULA BAGLIDIR. Render belli bir zincirde yapilir. "TON ise
//    currentPage'e yaz" seklindeki bir yazma -- yani duzeltilen kusurun TAM
//    KENDISI, cunku o da yalniz TON'da atesleniyordu -- yanlis zincirde
//    olculurse sessiz kalir. Buradaki tarama KOSULA HIC BAKMAZ: tehlikeli
//    SEKLIN kaynakta var olmasi yeter.
//
// TARAMA YORUM-KOR: `yorumsuz()` once yorumlari esit uzunlukta boslukla
// degistirir, yani bir yorumda gecen `onBeforeMount` kelimesi ne iddiayi
// kirmiziya dusurur ne de (ters yonde) gercek kodu maskeler.
//
// DOLAYLILIK COZULUR. Duzeltilen kusurun kendisi DOLAYLIYDI: tehlikeli cagri
// `watch(getChain, enforce, { immediate: true })` idi ve `currentPage` yazmasi
// `enforce` -> `leaveScreen` zincirinin UCUNDAYDI. Cagrinin ARGUMAN METNINE
// bakan bir tarayici bunu goremezdi. Bu yuzden once dosyadaki YEREL
// tanimlardan "currentPage yazabilenler" kumesi SABIT NOKTAYA kadar
// buyutulur, sonra tehlikeli cagrinin argumanlarinda o isimlerden biri
// geciyor mu diye bakilir.
//
// KAPSAM: `src/` altindaki TUM `.vue` bilesenleri + `src/composables/`
// altindaki TUM composable'lar.
//
// NEDEN YALNIZ EKRANLAR DEGIL: kilitlenmeyi ureten sey "ekran olmak" degil,
// YAMANIN ICINDE senkron yazmaktir. Bir ekranin ICINDE render edilen herhangi
// bir cocuk bilesen (Header.vue, ChangeNetwork.vue, ...) ayni yamada kosar ve
// ayni zarari verir -- nitekim kusurun ilk denetimi Header'i "Transition
// icinde render edilmiyor" diye elemisti, oysa Home.vue Header'i render eder
// ve Home ANAHTARLI sarmalayicinin TAM ICINDEDIR. Composable'lar da SART:
// kusur zaten orada yasiyordu ve bir bilesen tehlikeli sekli tek satirlik bir
// `useX()` cagrisinin arkasina saklayabilir.
//
// App.vue'dan turetilen ekran listesi yine de kullanilir: her ekranin taranan
// kume ICINDE oldugu ayrica iddia edilir, yani kapsam bir gun daralirsa
// (dizin degisir, filtre bozulur) sessizce degil, kirmiziyla ogrenilir.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz, eslesenKapanis } from '../test-utils/kaynakTarama.js'
import { ekranListesi } from '../test-utils/ekranListesi.js'

const BURASI = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(BURASI, '..')
const COMPOSABLES = resolve(SRC, 'composables')

// `page.currentPage = x` / `pageStore().currentPage = x` -- ama `===`, `!==`,
// `==` DEGIL. `(?!=)` karsilastirmalari eler.
const YAZMA = /currentPage\s*=(?!=)/

/** `imzaRe` ile eslesen HER cagrinin parantez ici argumanlarini doner. */
function cagriArgumanlari(kod, imzaRe) {
    const govdeler = []
    const re = new RegExp(imzaRe.source, 'g')
    let m
    while ((m = re.exec(kod))) {
        const acilis = kod.indexOf('(', m.index)
        if (acilis === -1) continue
        const son = eslesenKapanis(kod, acilis)
        if (son === -1) continue
        govdeler.push({ indeks: m.index, metin: kod.slice(acilis + 1, son) })
    }
    return govdeler
}

// Yerel TANIM sekilleri. Her kalibin SON karakteri govdeyi acan `{`; govde
// parantez eslestirmeyle cikarilir (satir sonundan BAGIMSIZ -- bu depoda
// dosyalar CRLF).
const TANIM_KALIPLARI = [
    // const f = (a, b) => {  |  const f = async (a) => {  |  const f = function (a) {
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*)?\((?:[^()]|\([^()]*\))*\)\s*(?:=>\s*)?\{/,
    // const f = x => {
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?[A-Za-z_$][\w$]*\s*=>\s*\{/,
    // function f(a) {
    /function\s+([A-Za-z_$][\w$]*)\s*\((?:[^()]|\([^()]*\))*\)\s*\{/,
    // nesne ozelligi: leaveScreen: () => {   <-- duzeltilen kusurda yazma TAM BURADAYDI
    /([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?\((?:[^()]|\([^()]*\))*\)\s*=>\s*\{/,
]

/** Dosyadaki yerel tanimlar: ad -> govde metni (ayni ad birden fazlaysa birlestirilir). */
function yerelTanimlar(kod) {
    const tanimlar = new Map()
    for (const kalip of TANIM_KALIPLARI) {
        const re = new RegExp(kalip.source, 'g')
        let m
        while ((m = re.exec(kod))) {
            const acilis = m.index + m[0].length - 1
            const son = eslesenKapanis(kod, acilis)
            if (son === -1) continue
            const govde = kod.slice(acilis + 1, son)
            tanimlar.set(m[1], (tanimlar.get(m[1]) || '') + '\n' + govde)
        }
    }
    return tanimlar
}

/**
 * `currentPage` yazabilen YEREL isimler -- SABIT NOKTA.
 * Once dogrudan yazanlar, sonra onlardan BIRINI cagiranlar, degisim bitene dek.
 */
function yazabilenIsimler(kod) {
    const tanimlar = yerelTanimlar(kod)
    const yazanlar = new Set()
    for (const [ad, govde] of tanimlar) if (YAZMA.test(govde)) yazanlar.add(ad)

    let degisti = true
    while (degisti) {
        degisti = false
        for (const [ad, govde] of tanimlar) {
            if (yazanlar.has(ad)) continue
            for (const yazan of yazanlar) {
                if (new RegExp('\\b' + yazan + '\\b').test(govde)) { yazanlar.add(ad); degisti = true; break }
            }
        }
    }
    return yazanlar
}

/** Arguman metni `currentPage`e ULASIYOR mu (dogrudan ya da yazabilen bir isim uzerinden)? */
function currentPageeUlasir(argumanlar, yazanlar) {
    if (YAZMA.test(argumanlar)) return true
    for (const ad of yazanlar) if (new RegExp('\\b' + ad + '\\b').test(argumanlar)) return true
    return false
}

/**
 * Bir dosyadaki TEHLIKELI SEKILLER.
 *
 * Tehlikeli olanin ne oldugu TEK cumleyle: patch'in ICINDE ya da setup'in
 * KENDISINDE senkron kosup `currentPage` yazabilen her sey.
 */
function tehlikeliSekiller(kaynak) {
    const kod = yorumsuz(kaynak)
    const yazanlar = yazabilenIsimler(kod)
    const bulgular = []

    const bildir = (tur, arg) => bulgular.push(`${tur}: ${arg.metin.replace(/\s+/g, ' ').trim().slice(0, 120)}`)

    for (const arg of cagriArgumanlari(kod, /\bwatch\s*\(/)) {
        if (!currentPageeUlasir(arg.metin, yazanlar)) continue
        // `immediate: true` -> ilk kontrol SETUP'ta, SENKRON. Kusurun kendisi.
        if (/\bimmediate\s*:\s*true/.test(arg.metin)) bildir('immediate:true watch currentPage yaziyor', arg)
        // `flush: 'sync'` -> patch'in ORTASINDA kosar.
        if (/\bflush\s*:\s*['"]sync['"]/.test(arg.metin)) bildir("flush:'sync' watch currentPage yaziyor", arg)
    }

    // watchEffect / watchSyncEffect: ilk calistirma HER ZAMAN setup'ta ve senkron.
    for (const arg of cagriArgumanlari(kod, /\bwatch(?:Effect|SyncEffect)\s*\(/)) {
        if (currentPageeUlasir(arg.metin, yazanlar)) bildir('watchEffect currentPage yaziyor', arg)
    }

    // onBeforeMount / onBeforeUpdate: yama BITMEDEN kosar -- onMounted'a
    // tasimanin cozdugu sorunun tam ICINDE.
    for (const arg of cagriArgumanlari(kod, /\bonBefore(?:Mount|Update)\s*\(/)) {
        if (currentPageeUlasir(arg.metin, yazanlar)) bildir('onBeforeMount/onBeforeUpdate currentPage yaziyor', arg)
    }

    return bulgular
}

/** `kok` altindaki tum dosyalari (ic ice) `uzanti` filtresiyle toplar. */
function dosyalariTopla(kok, kabul) {
    const cikti = []
    for (const girdi of readdirSync(kok, { withFileTypes: true })) {
        const yol = resolve(kok, girdi.name)
        if (girdi.isDirectory()) cikti.push(...dosyalariTopla(yol, kabul))
        else if (kabul(girdi.name)) cikti.push(yol)
    }
    return cikti
}

const TARANAN = [
    ...dosyalariTopla(SRC, (ad) => ad.endsWith('.vue')),
    ...dosyalariTopla(COMPOSABLES, (ad) => ad.endsWith('.js') && !ad.endsWith('.test.js')),
].sort()

describe('SINIF KILIDI: hicbir bilesen/composable currentPage i patch icinde SENKRON yazmaz', () => {
    it('taranan dosya sayisi anlamli (liste sessizce bosalmadi)', () => {
        expect(TARANAN.length).toBeGreaterThanOrEqual(90)
    })

    // KAPSAMIN KENDISI DE KILITLI: App.vue'nun barindirdigi HER ekran taranan
    // kumede olmak ZORUNDA. Kapsam daralirsa bu iddia duser.
    it('App.vue daki her ekran taranan kumede', () => {
        const kume = new Set(TARANAN)
        const disarida = ekranListesi().filter((e) => !kume.has(e.dosya)).map((e) => e.tag)
        expect(disarida).toEqual([])
    })

    for (const dosya of TARANAN) {
        it(relative(SRC, dosya).replace(/\\/g, '/'), () => {
            const bulgular = tehlikeliSekiller(readFileSync(dosya, 'utf8'))
            // Hata mesaji TESHISI TASIR: hangi sekil, hangi arguman metni.
            expect(bulgular).toEqual([])
        })
    }
})

// Tarayicinin KENDISI de yanlislanabilir olmali: asagidaki sentetik kaynaklar
// gercek dosyalardan BAGIMSIZ olarak, dort seklin de GERCEKTEN yakalandigini
// gosterir. Tarayici bir gun sessizce "hicbir sey bulamaz" hale gelirse (bir
// regex bozulur, `eslesenKapanis` -1 doner) bu iddialar duser -- yukaridaki
// ~60 dosya iddiasi ise yine yesil kalirdi.
describe('tarayici gercekten yakaliyor (sentetik ornekler)', () => {
    it('immediate: true izleyicisi -- DOGRUDAN yazma', () => {
        const kod = "watch(() => n.chain, () => { page.currentPage = 'home' }, { immediate: true })"
        expect(tehlikeliSekiller(kod)).toHaveLength(1)
    })

    it('immediate: true izleyicisi -- DOLAYLI yazma (kusurun gercek sekli)', () => {
        const kod = [
            "const leaveScreen = () => { pageStore().currentPage = 'home' }",
            'const enforce = () => { if (ok()) return; leaveScreen() }',
            'watch(getChain, enforce, { immediate: true, deep: true })',
        ].join('\n')
        expect(tehlikeliSekiller(kod)).toHaveLength(1)
    })

    it('onBeforeMount -- SSR harness inin GOREMEDIGI sekil', () => {
        const kod = "onBeforeMount(() => { page.currentPage = 'home' })"
        expect(tehlikeliSekiller(kod)).toHaveLength(1)
    })

    it("watchEffect ve flush: 'sync' izleyicisi", () => {
        expect(tehlikeliSekiller("watchEffect(() => { page.currentPage = 'home' })")).toHaveLength(1)
        expect(tehlikeliSekiller("watch(x, () => { page.currentPage = 'home' }, { flush: 'sync' })")).toHaveLength(1)
    })

    it('YORUM KOR: yalnizca yorumda gecen sekil bulgu URETMEZ', () => {
        const kod = "// watch(x, () => { page.currentPage = 'home' }, { immediate: true })\nconst a = 1"
        expect(tehlikeliSekiller(kod)).toEqual([])
    })

    it('YANLIS POZITIF YOK: currentPage yazmayan immediate izleyici temizdir', () => {
        const kod = "watch(() => payWithAts.value, () => { atsFee.value = null }, { immediate: true })"
        expect(tehlikeliSekiller(kod)).toEqual([])
    })

    it('YANLIS POZITIF YOK: immediate OLMAYAN bir izleyici currentPage yazabilir', () => {
        // Korumanin BUGUNKU sekli: ag SONRADAN degisince ekrani terk etmek
        // MESRUDUR -- o an patch'in icinde degiliz.
        const kod = [
            "const leaveScreen = () => { pageStore().currentPage = 'home' }",
            'watch(getChain, leaveScreen, { deep: true })',
        ].join('\n')
        expect(tehlikeliSekiller(kod)).toEqual([])
    })
})

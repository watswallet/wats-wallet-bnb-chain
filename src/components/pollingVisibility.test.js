import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz, blokGovdesi } from '../test-utils/kaynakTarama'

// Panel gorunmezken (kullanici baska sekmede) yoklama dongusu calismaya devam
// ederdi: surekli ag trafigi ve kullanicinin cuzdani acik tuttugunu ele veren
// duzenli bir istek deseni. App.vue'daki ag izleyicisi Asama 1'de kapatildi;
// bunlar kalan uc: Home'un bakiye dongusu, Swap'in ve Bridge'in kotasyon
// donguleri.
//
// Bilesenler MOUNT EDILMIYOR (ortam 'node', document/window yok) -- bu yuzden
// kaynak kilidi kalibi kullanilir. Ham `toContain('visibilityState')` gibi bir
// iddia dosyanin HERHANGI bir yerinde gecen bir yorumla bile GECERDI; bu yuzden
// asagidaki yardimcilar once ILGILI setInterval GOVDESINI izole eder ve iddialar
// o govde icinde, sirayla dogrulanir. Boylece guard yanlis yere (govdenin
// disina, yanlis dongunun icine) konulsa test YINE KIRMIZI kalir.
//
// KOD INCELEMESI (yorum turu): yukaridaki uyariya RAGMEN dosya-genelindeki
// iddialar (onVisible bildirimi, addEventListener, removeEventListener,
// visibilityState izi) HAM kaynakta ariyordu ve olculdu -- ilgili satirin
// basina `// ` konuldugunda ucu de dahil BUTUN kilitler YESIL kaliyordu
// ("locks now FAILING: NONE"), yani dinleyici hic kaydedilmedigi halde
// "dinleyici ekleniyor" testi geciyordu. `read` artik kaynagi yorumlari
// BOSLUKLA degistirilmis halde dondurur: uzunluk ve satir sayisi korunur,
// yani asagidaki sira karsilastirmalari aynen calisir, ama hicbir iddia bir
// YORUM METNIYLE saglanamaz.
const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => yorumsuz(readFileSync(join(here, rel), 'utf8'))

const DONGULER = [
    { dosya: 'Home.vue', ms: 10000, cagrilar: ['updateBalance'] },
    { dosya: 'Swap.vue', ms: 10000, cagrilar: ['getSwapData', 'refreshAtsOpFee'] },
    { dosya: 'Bridge.vue', ms: 20000, cagrilar: ['getBridgeData'] },
]

const GUARD_RE = /if\s*\(\s*typeof document !== 'undefined' && document\.visibilityState === 'hidden'\s*\)\s*return/

// `setInterval(async () => { ... }, <ms>)` govdesini yakalar. Uc dosyadaki
// govdelerin hicbirinde ic ice `{}` yok (duz if/await dizisi), yani tembel
// (non-greedy) bir yakalama guvenli.
function extractIntervalBody(kaynak, ms) {
    const re = new RegExp(`setInterval\\(\\s*async\\s*\\(\\)\\s*=>\\s*\\{([\\s\\S]*?)\\}\\s*,\\s*${ms}\\s*\\)`)
    const match = kaynak.match(re)
    return match ? match[1] : null
}

// `onVisible = (async) () => { ... }` govdesini AYNI sekilde izole eder. Bu
// olmadan "onVisible tanimli mi" ve "guard var mi" testleri dosyanin
// HERHANGI bir yerinde gecen bir guard'la bile gecerdi VE -- daha onemlisi --
// govde icindeki yenileme cagrisi (updateBalance/getSwapData+refreshAtsOpFee/
// getBridgeData) SILINSE bile guard tek basina orada durdugu surece yesil
// kalirdi. "Bir kez tazele" adiminin BUTUN amaci o cagri; asagidaki test
// onu govde icinde, guard'dan SONRA, ayrica arar.
function extractOnVisibleBody(kaynak) {
    const re = /onVisible\s*=\s*(?:async\s*)?\(\)\s*=>\s*\{([\s\S]*?)\}/
    const match = kaynak.match(re)
    return match ? match[1] : null
}

describe('yoklama donguleri gorunmezken duraklar', () => {
    for (const { dosya, ms, cagrilar } of DONGULER) {
        describe(dosya, () => {
            it(`interval suresi degismedi ve govde bulunabiliyor (${ms}ms)`, () => {
                const kaynak = read(dosya)
                const govde = extractIntervalBody(kaynak, ms)
                // null donerse ya sure degisti ya da govde sekli beklenenden farkli --
                // asagidaki testlerin hicbiri o zaman anlamli olmaz, o yuzden burada
                // ayri bir iddia olarak durur.
                expect(govde).not.toBeNull()
            })

            it('gizliyken erken cikma kapisi INTERVAL GOVDESININ ICINDE ve ILK islem', () => {
                const kaynak = read(dosya)
                const govde = extractIntervalBody(kaynak, ms)
                expect(govde).toMatch(GUARD_RE)

                // "ilk islem": guard'dan ONCE govdede baska bir ifade (yorum haric)
                // olmamali. Yorum satirlarini atip ilk kod satirinin guard oldugunu
                // dogrudan kontrol eder -- guard'in govdenin SONUNA ya da ortasina
                // konulmasi (calismasi gecikmis/etkisiz bir kapi) burada yakalanir.
                const ilkKodSatiri = govde
                    .split('\n')
                    .map((satir) => satir.trim())
                    .find((satir) => satir.length > 0 && !satir.startsWith('//'))
                expect(ilkKodSatiri).toMatch(GUARD_RE)

                // Guard, yenileme cagrisindan/cagrilarindan ONCE gelmeli -- aksi halde
                // panel gizliyken bile istek atilir (kapinin tum amaci budur).
                // `search()` BULUNAMAYINCA -1 doner ve `-1 < cagriIndex` HER
                // ZAMAN dogrudur: guard tamamen SILINSE bile asagidaki sira
                // iddiasi yesil kalirdi (olculdu -- guard silindiginde bu
                // iddia kirmiziya donen kilitler arasinda YOKTU). Kapinin
                // VARLIGI bu yuzden acikca sart kosulur.
                const guardIndex = govde.search(GUARD_RE)
                expect(guardIndex).toBeGreaterThan(-1)
                for (const cagri of cagrilar) {
                    const cagriIndex = govde.indexOf(`${cagri}(`)
                    expect(cagriIndex).toBeGreaterThan(-1)
                    expect(guardIndex).toBeLessThan(cagriIndex)
                }
            })

            it('gorunur olunca bir kez tazeleyen dinleyici ekleniyor, kaldiriliyor VE GERCEKTEN tazeliyor', () => {
                const kaynak = read(dosya)

                // onVisible modul seviyesinde bildirilmis, kimlige atanabilir olmali --
                // aksi halde onUnmounted'da kaldirilamaz (Asama 1 Task 7'deki setInterval
                // kimlik hatasinin ayni sekli, burada listener icin).
                expect(kaynak).toMatch(/let onVisible = null/)

                const govde = extractOnVisibleBody(kaynak)
                // null donerse asagidaki govde-kapsamli iddialarin hicbiri anlamli
                // olmaz, o yuzden ayri bir iddia olarak durur (ornegin `onVisible =`
                // hic tanimlanmamissa ya da farkli bir sekilde yazilmissa burada
                // KIRMIZI olur, asagidaki testler SESSIZCE atlanmaz).
                expect(govde).not.toBeNull()

                // Geri cagirma GORUNUR olmadikca hicbir sey yapmamali (gizliyken VEYA
                // document yokken erken cikar) -- App.vue'daki Asama 1 Task 7
                // onVisibilityChange ile ayni kapi. Govde icinde VE ilk satir olarak.
                const onVisibleGuardRe = /if\s*\(\s*typeof document === 'undefined' \|\| document\.visibilityState !== 'visible'\s*\)\s*return/
                expect(govde).toMatch(onVisibleGuardRe)
                const ilkSatir = govde
                    .split('\n')
                    .map((satir) => satir.trim())
                    .find((satir) => satir.length > 0 && !satir.startsWith('//'))
                expect(ilkSatir).toMatch(onVisibleGuardRe)

                // ASIL NOKTA (bu testin var olma sebebi): guard'i YERINDE birakip
                // yalniz yenileme cagrisini/cagrilarini silseniz yukaridaki iddialar
                // YINE yesil kalirdi -- "bir kez tazele" adiminin butun amaci bu
                // cagri(lar). Her biri govde icinde, guard'dan SONRA aranir; DONGULER
                // dizisindeki `cagrilar` ile ayni liste kullanilir ki interval govdesi
                // ile onVisible govdesi FARKLI bir fonksiyon cagirirsa da kirmizi olsun.
                // Yukaridakiyle AYNI -1 tuzagi: guard kaldirilsa `search()` -1
                // doner ve sira iddiasi vacuous olarak gecerdi.
                const guardIndex = govde.search(onVisibleGuardRe)
                expect(guardIndex).toBeGreaterThan(-1)
                for (const cagri of cagrilar) {
                    const cagriIndex = govde.indexOf(`${cagri}(`)
                    expect(cagriIndex).toBeGreaterThan(-1)
                    expect(guardIndex).toBeLessThan(cagriIndex)
                }

                // Ekleme VE kaldirma document ADI VERILMEDEN cagrilamaz -- ortam 'node'
                // oldugu icin (SSR testleri onMounted'i GERCEKTEN calistirir, bkz.
                // Home/Swap/Bridge .ssr.test.js) korumasiz bir `document.addEventListener`
                // bu dosyanin KENDI SSR testini kirar. Guard'in varligi burada dogrudan
                // sinanir.
                //
                // KOD INCELEMESI (kapsam turu): bu iki iddia dosya GENELINDE
                // ariyordu. Olculdu: `removeEventListener` satiri
                // onUnmounted'dan alinip hicbir zaman cagrilmayan bir
                // `__neverCalled()` fonksiyonuna konuldugunda BUTUN kilitler
                // YESIL kaliyordu -- yani testin adinda yazan dinleyici
                // SIZINTISI gorunmezdi. Iddialar artik kayit icin onMounted,
                // kaldirma icin onUnmounted GOVDESINE bakar. Bosluklar da
                // `\s*` ile esnetildi: yeniden bicimlendirme yanlis kirmizi
                // vermemeli, gercek yer degistirme ise vermeli.
                const mountGovdesi = blokGovdesi(kaynak, /onMounted\(async\s*\(\)\s*=>\s*/)
                expect(mountGovdesi).not.toBeNull()
                expect(mountGovdesi).toMatch(
                    /if\s*\(\s*typeof document !== 'undefined'\s*\)\s*document\.addEventListener\('visibilitychange',\s*onVisible\)/
                )

                const unmountGovdesi = blokGovdesi(kaynak, /onUnmounted\(\(\)\s*=>\s*/)
                expect(unmountGovdesi).not.toBeNull()
                expect(unmountGovdesi).toMatch(
                    /if\s*\(\s*onVisible\s*&&\s*typeof document !== 'undefined'\s*\)\s*document\.removeEventListener\('visibilitychange',\s*onVisible\)/
                )
            })
        })

        it(`${dosya} gizliyken erken cikar (kaynak genelinde iz)`, () => {
            // Brief'teki asil iddia: dosyada guard string'i GECIYOR mu. Yukaridaki
            // govde-kapsamli testler bunun DOGRU YERDE oldugunu kanitliyor; bu iddia
            // aynen tutuluyor cunku "hicbir yerde gecmiyor" hala anlamli bir kirmizi
            // durum (RED asamasinda gorundu).
            //
            // KOD INCELEMESI (yorum turu): eskiden HAM kaynakta ariyordu, yani
            // guard satirinin basina `// ` konulunca (kapi FIILEN YOK) dizge
            // yorumun ICINDE hayatta kalip testi YESIL tutuyordu. `read` artik
            // yorumsuz kaynak dondurdugu icin bu kapandi. Kapinin DOGRU YERDE
            // oldugu -- ve yenileme cagrisindan ONCE geldigi -- bilincli olarak
            // yukaridaki govde-kapsamli testlerin isi olarak birakildi; bu blok
            // yalnizca "hicbir yerde YOK" durumunu tutar.
            const kaynak = read(dosya)
            expect(kaynak).toMatch(/visibilityState === 'hidden'/)
        })

        it(`${dosya} interval i bir kimlige atar (atanmamis setInterval yok)`, () => {
            // Atanmamis setInterval durdurulamaz -- Asama 1 Task 7'de App.vue'da
            // kapatilan hatanin aynisi.
            const kaynak = read(dosya)
            expect([...kaynak.matchAll(/^\s*setInterval\(/gm)]).toEqual([])
        })
    }
})

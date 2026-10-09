import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// UCRET VE EKSIK BAKIYE AYNI KARTTA.
//
// Ikisi TEK bir konuyu anlatiyor: "bu islemin ucreti su kadar ATS" ve "senin ATS'n su
// kadar eksik". Ayri kartlar olarak cizildiginde ekranda birbirinden kopuyorlardi --
// dapp ekraninda aralarina teknik detaylar akordiyonu bile giriyordu -- ve kullanici
// ayni bilgiyi iki yerde topluyordu.
//
// OLCUM ARACI DEGISTI (ucret kartlari AtsFeeCard.vue'da toplandiktan sonra).
// Eskiden bes ekranin HER BIRINDE kartin govdesi kaynak metinden cikariliyor ve
// bolumun o govdenin icinde oldugu dogrulaniyordu. Kart artik ekranlarda DEGIL;
// ekranlarda yalnizca `<AtsFeeCard ...>` cagrisi ve slot icerikleri var. Ayni iddia
// bu yuzden IKI KATMANDA olculuyor:
//
//   KATMAN 1 -- AtsFeeCard.vue: `shortfall` slot'u kartin ROUNDED-XL kabugunun
//               ICINDE mi? (eski `kartGovdesi` araci, tek dosyaya uygulanmis hali)
//   KATMAN 2 -- her ekran: `AtsShortfallNote` o slot'un ICINE mi veriliyor, yoksa
//               kartin disina mi birakilmis?
//
// Kartin METIN kurallari (etiket, "en fazla", "iade edilmez", yanma uyarisi, ham
// tutar) burada DEGIL, AtsFeeCard.ssr.test.js'te gercek render ile kilitli --
// kaynak metin taramasi onlari zaten olcemiyordu.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const sinifi = (etiket) => {
    const m = etiket.match(/class="([^"]*)"/)
    return m ? m[1] : ''
}

/**
 * `isaret` metnini iceren EN ICTEKI kart elemaninin govdesini dondurur.
 * Kart = sinifinda `rounded-xl` gecen div (ucret kartinin kabugu).
 */
function kartGovdesi(src, isaret) {
    const satirlar = src.split('\n')
    const yigin = []            // { sinif, satirIndex }
    let hedef = null            // isaretin bulundugu andaki en icteki kart

    for (let i = 0; i < satirlar.length; i++) {
        const satir = satirlar[i]

        if (hedef === null && satir.includes(isaret)) {
            for (let k = yigin.length - 1; k >= 0; k--) {
                if (/rounded-xl/.test(yigin[k].sinif)) { hedef = { ...yigin[k], derinlik: k } ; break }
            }
            if (hedef === null) return null
        }

        for (const a of (satir.match(/<div\b[^>]*>/g) || [])) yigin.push({ sinif: sinifi(a), satirIndex: i })
        for (let k = 0; k < (satir.match(/<\/div>/g) || []).length; k++) {
            yigin.pop()
            // Hedef kart kapandi: govde tam burada biter.
            if (hedef && yigin.length === hedef.derinlik) {
                return satirlar.slice(hedef.satirIndex, i + 1).join('\n')
            }
        }
    }
    return null
}

/**
 * Bir ekrandaki TUM `<AtsFeeCard ...>` cagrilarini govdeleriyle dondurur.
 * Kendi kapanan cagrilar (dapp TON gonderimi) yalniz acilis etiketidir.
 *
 * NOT: acilis etiketinin sonu "ilk `>`" ile bulunuyor; bu ancak hicbir oznitelik
 * degeri `>` TASIMADIGI surece dogrudur. Asagidaki "arac gercekten olcuyor" testi
 * tam da bunu dogruluyor -- sinir yanlis olsaydi iddialar hicbir sey kanitlamazdi.
 */
function kartCagrilari(src, tag = 'AtsFeeCard') {
    const out = []
    let i = 0
    for (;;) {
        const b = src.indexOf(`<${tag}`, i)
        if (b < 0) break
        const acilisSonu = src.indexOf('>', b)
        if (acilisSonu < 0) break
        if (src[acilisSonu - 1] === '/') {
            out.push(src.slice(b, acilisSonu + 1))
            i = acilisSonu + 1
            continue
        }
        const kapanis = src.indexOf(`</${tag}>`, acilisSonu)
        if (kapanis < 0) break
        out.push(src.slice(b, kapanis + tag.length + 3))
        i = kapanis + 1
    }
    return out
}

const KART = read('./AtsFeeCard.vue')

// Bolumu kartin ICINE veren ekranlar. Kopru ve dapp TON gonderiminde
// `AtsShortfallNote` HIC yok, o yuzden listede degiller -- ama kart cagrisi
// kablolama testlerinde olculuyor. Kopru'de sunucunun "ATS gerekli" karari ayri bir
// engel kartinda; istemcinin kendi hesabi (bakiye < ucret) ise kartin #shortfall
// slot'undaki yetersiz bakiye blogunda (asagidaki "yetersiz ATS blogu" testi).
const BOLUMLU_EKRANLAR = [
    ['Onayla', read('./ConfirmTransaction.vue'), 2],
    ['Dapp', read('./Dapp.vue'), 1],
    ['Takas', read('./Swap.vue'), 2],
]

const TUM_EKRANLAR = [
    ...BOLUMLU_EKRANLAR.map(([ad, src]) => [ad, src]),
    ['Kopru', read('./Bridge.vue')],
    ['DappTonGonderim', read('./dapp/TonSendTx.vue')],
]

describe('KATMAN 1 -- paylasilan kart: bolum kabugun ICINDE', () => {
    const govde = kartGovdesi(KART, '<slot name="shortfall"')

    it('shortfall slot\'u rounded-xl kabugun icinde', () => {
        expect(govde).not.toBeNull()
        expect(govde).toContain('<slot name="shortfall"')
    })

    it('details ve decision slotlari da ayni kabugun icinde', () => {
        // Ucu de kartin alt seridi. Biri disari tasarsa ekranda kopuk bir blok olur.
        expect(govde).toContain('<slot name="details"')
        expect(govde).toContain('<slot name="decision"')
    })

    it('cikarilan govde GERCEKTEN kartla sinirli', () => {
        // Olcum aracinin kendi kontrolu: govde tum dosyaya tassaydi yukaridaki
        // iddialar yerlesim hakkinda HICBIR SEY kanitlamazdi. `defineProps`
        // sablonun DISINDA, <script setup> icinde.
        expect(govde).not.toContain('defineProps')
    })

    it('kabuk STATIK rounded-xl tasir (araci ayakta tutan kisit)', () => {
        // `:class` ile uretilen bir kabuk yukaridaki araci kor eder.
        expect(KART).toMatch(/<div[^>]*class="[^"]*rounded-xl/)
    })
})

describe.each(BOLUMLU_EKRANLAR)('KATMAN 2 -- %s: bolum slot\'a veriliyor', (_ad, SRC, kartSayisi) => {
    const cagrilar = kartCagrilari(SRC)

    it('beklenen sayida ucret karti cizilir', () => {
        expect(cagrilar).toHaveLength(kartSayisi)
    })

    it('HER kart eksik bakiye bolumunu KENDI slot\'una alir', () => {
        for (const c of cagrilar) {
            expect(c, 'kart shortfall slot\'u tasimiyor').toContain('#shortfall')
            expect(c, 'bolum kartin disina tasmis').toContain('<AtsShortfallNote')
        }
    })

    it('sinir GERCEKTEN cagrinin kapanisinda (arac kendi kendini denetler)', () => {
        // Dilim butun dosyaya tassaydi ustteki iddialar bedava gecerdi. Bu anahtar
        // engel/hata kartlarinda -- yani ucret kartinin DISINDA.
        for (const c of cagrilar) {
            expect(c, 'dilim hata kartina tasmis').not.toContain('atsQuoteRetry')
            expect(c.length, 'dilim bos').toBeGreaterThan(200)
        }
    })

    it('kabuklu (standalone) dal kartlarin DISINDA kalir', () => {
        // TON kolunda bakiye yetmeyince teklif hic donmez, ucret karti da CIZILMEZ.
        // Bolum o durumda icine yerlesecek bir kart bulamaz; kendi kabugunu tasimali.
        // Ice dususe ya iki kez cizilir ya hic cizilmez.
        //
        // DAL HER EKRANDA YOK: Dapp'te TON kolu hic olmadigi icin kabuklu dal da
        // yazilmamis (bu refactor'dan ONCE de boyleydi). Iddia bu yuzden iki parcali:
        // "dal varsa kartin disinda" -- "her ekranda dal olmali" DEGIL.
        const STANDALONE = 'v-if="showAtsShortfall && shortfallStandalone"'
        for (const c of cagrilar) expect(c).not.toContain(STANDALONE)
    })
})

describe.each(TUM_EKRANLAR)('KATMAN 2 -- %s: kablolama', (_ad, SRC) => {
    const cagrilar = kartCagrilari(SRC)

    it('ucret karti cizilir', () => {
        expect(cagrilar.length).toBeGreaterThan(0)
    })

    // Y1: etiket ("Tahmini Gaz Ucreti" / "Kesilen Ucret" / "Ucret {symbol} ile odendi")
    // ekranin karari. Component secseydi TON'a "tahmini", EVM'e "kesin" diyebilirdi --
    // ikisi de kullaniciya iade konusunda yanlis bilgi verir.
    it('HER kart etiketini ACIKCA gecirir', () => {
        for (const c of cagrilar) expect(c).toMatch(/label-key=/)
    })

    // Y4: tutar ekranda hazirlanir. TON kolunda gosterilen sayi DOGRUDAN imzalanacak
    // alandir; component bicimlerse ekrandaki sayi imzalanandan ayrisir.
    it('HER kart tutari ekrandan alir', () => {
        for (const c of cagrilar) expect(c).toMatch(/:amount=/)
    })
})

describe('Eksik bakiye bolumu TEK kaynakta', () => {
    const NOTE = read('./AtsShortfallNote.vue')

    it('metin ve duzen yalniz paylasilan bilesende', () => {
        expect(NOTE).toContain('atsShortfallBreakdown')
        // Ekranlar ve ucret karti kendi kopyalarini TUTMAZ: bes yerde cizilen bir
        // bolumun bes kopyasi, biri duzeltilip digerleri geride kalan bir ayrisma demekti.
        for (const [, SRC] of [...TUM_EKRANLAR, ['Kart', KART]]) {
            expect(SRC).not.toContain('atsShortfallBreakdown')
            expect(SRC).not.toContain('atsShortfallWhere')
        }
    })

    it('kart disinda cizilebilmesi KORUNUR', () => {
        expect(NOTE).toContain('standalone')
        expect(read('./ConfirmTransaction.vue')).toMatch(/v-if="showAtsShortfall && shortfallStandalone"/)
        expect(read('./Swap.vue')).toMatch(/v-if="showAtsShortfall && shortfallStandalone"/)
    })
})

describe('Ucret karti TEK kaynakta', () => {
    // Refactor'un kendi kilidi: bir ekran ileride kendi kartini yeniden ciziverirse
    // (kopyala-yapistir) bes ekran yeniden ayrisir. Ucret kartinin METINLERI artik
    // yalnizca AtsFeeCard.vue'da gecebilir.
    it('ekranlar ucret satirlarini KENDILERI cizmez', () => {
        for (const [ad, SRC] of TUM_EKRANLAR) {
            expect(SRC, `${ad} kendi "en fazla" satirini ciziyor`).not.toContain("'send.confirmTransaction.atsFeeUpTo'")
            expect(SRC, `${ad} kendi yanma uyarisini ciziyor`).not.toContain("'send.confirmTransaction.tonFeeBurnsWarning'")
        }
    })
})

// "EN FAZLA" YALNIZ IADE GERCEKTEN MUMKUNSE.
//
// Normal yolda kontrat hem on odemeyi hem postOp borcunu minChargeAts tabaninda keser:
// ucret tabandaysa (BSC'de her zaman -- gaz ~$0.04, taban $1) iade SIFIRDIR. Capraz-
// zincirde postOp hic yoktur. Eskiden Onayla/Dapp niteleyiciyi `!isCrosschain` ile,
// Takas/Kopru ise KOSULSUZ aciyordu -- ikincisi capraz-zincirde bile. Karar tek yerde:
// quoteAtsTransfer.feeRefundable -> composable -> `atsFeeRefundable`.
describe('"en fazla" niteleyicisi yalniz iade mumkunse acilir', () => {
    const EVM_EKRANLAR = [
        ['Onayla', read('./ConfirmTransaction.vue')],
        ['Dapp', read('./Dapp.vue')],
        ['Takas', read('./Swap.vue')],
        ['Kopru', read('./Bridge.vue')],
    ]

    it.each(EVM_EKRANLAR)('%s: her show-up-to atsFeeRefundable a bagli', (ad, SRC) => {
        // Yorumlar DEGIL, yalniz nitelik olarak gecen kullanimlar: once yorumlar atilir,
        // sonra her yazim bicimi (statik, `:`, `v-bind:`, kebab/camel, tek/cift tirnak) aranir.
        const kod = SRC.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        const kullanimlar = kod.match(/(?:v-bind:|:)?(?:show-up-to|showUpTo)(?:\s*=\s*(?:"[^"]*"|'[^']*'))?(?=[\s>/])/g) || []
        expect(kullanimlar.length, `${ad} kartinda niteleyici kablosu yok`).toBeGreaterThan(0)
        for (const k of kullanimlar) {
            expect(k.trim(), `${ad} niteleyiciyi feeRefundable disinda bir kosulla aciyor`)
                .toBe(':show-up-to="atsFeeRefundable"')
        }
        // Ref'in kaynagi composable olmali (quoteAtsTransfer.feeRefundable), ekranin kendi turettigi bir sey degil.
        expect(kod, `${ad} atsFeeRefundable'i composable'dan almiyor`).toMatch(/feeRefundable:\s*atsFeeRefundable/)
    })
})

// YETERSIZ ATS BLOGU (bakiye < bu op'un ucreti) -- Takas ve Kopru'de de ucret kartinin
// ICINDE, Send/Dapp ile ayni yerde. Kartin disina birakilsaydi "ucret su kadar" ile
// "bakiyen yetmiyor" yine iki ayri kutuda anlatilirdi.
describe('yetersiz ATS blogu ucret kartinin #shortfall slot unda', () => {
    const yorumsuzSablon = (src) => src.replace(/<!--[\s\S]*?-->/g, '')
    const EKRANLAR = [
        ['Takas', read('./Swap.vue')],
        ['Kopru', read('./Bridge.vue')],
    ]

    it.each(EKRANLAR)('%s: ATS ucret kartinin slot u blogu tasir', (_ad, SRC) => {
        const kart = kartCagrilari(yorumsuzSablon(SRC))[0]
        expect(kart, 'ATS ucret karti bulunamadi').toBeTruthy()
        const slot = kart.slice(kart.indexOf('<template #shortfall>'))
        expect(kart).toContain('<template #shortfall>')
        expect(slot).toContain("'send.confirmTransaction.atsInsufficientTitle'")
        expect(slot).toContain("'send.confirmTransaction.atsInsufficientDesc'")
        // Sunucu zaten "ATS al" diyorsa (buy-ats) ayni sey iki kez yazilmaz -- Send kurali.
        // Bu yalniz kaynak-metin kilidi; iki dislamanin DAVRANISI gercek render ile
        // SwapAtsInsufficient/BridgeAtsInsufficient.ssr.test.js'te olculuyor.
        expect(slot).toMatch(/atsInsufficient && !atsLoading && !\(atsDecision && atsDecision\.action === 'buy-ats'\)/)
    })
})

describe('Dapp: eksik ATS ekranda IKI KEZ yazilmaz', () => {
    // CANLI OLCUM 2026-09-18 (ekran goruntusu): ATS transferi, bakiye 0.699871 ATS.
    // Ucret kartinda "Eksik bakiye 102.444071 ATS / Bakiye 0.699871 ATS" yaziyordu;
    // ekranin EN ALTINDA ayrica turuncu bir kart "Yetersiz Bakiye -- bu islemi
    // gerceklestirmek icin yeterli ats yok" diyordu. Ikincisi yeni HICBIR sey
    // soylemiyor: ayni gercegin sayisiz tekrari, ustelik Onayla butonu da zaten
    // "Yetersiz Bakiye" yaziyor.
    const DAPP = read('./Dapp.vue')

    it('token bakiyesi karti bolum ciziliyken KAPALI', () => {
        expect(DAPP).toContain('v-if="insufficientTokenBalance && !showAtsShortfall"')
    })

    it('kart bolum YOKKEN hala cizilebilir (ATS disi transferlerin tek aciklamasi)', () => {
        // Sadece silseydik, duz bir ERC-20 gonderiminde ekranda bloklamanin
        // sebebini anlatan HICBIR metin kalmazdi.
        expect(DAPP).toContain("send.confirmTransaction.insufficientBalance")
    })

    it('bloklama BAGIMSIZ: kart gizlense de gonderim kapali kalir', () => {
        // Gorunurluk kapisi `sendBlocked`e DOKUNMAZ.
        expect(DAPP).toMatch(/const sendBlocked = computed\(\(\) => kurulumDustu\.value \|\| feeBlocked\.value \|\| insufficientTokenBalance\.value\)/)
    })
})

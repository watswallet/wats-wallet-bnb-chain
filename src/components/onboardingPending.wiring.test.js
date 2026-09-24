import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import TR from '../i18n/locales/tr.json'
import EN from '../i18n/locales/en.json'

// CUZDANI OLMAYAN KULLANICI PANELDE SIFRE SORULMAMALI.
//
// KOK NEDEN (2026-09-14, canli olculdu): `popup/App.vue` kasa yokken onboarding
// sekmesini aciyor ve paneli `'welcome'` sayfasina gonderiyordu. `'welcome'`
// `Login.vue`yi cizer -- basligi "Tekrar hos geldin", alt basligi "Devam etmek
// icin sifreni gir". Yani:
//
//   sol sekme : "Yeni Cuzdan Olustur"
//   sag panel : "Tekrar hos geldin / sifreni gir"
//
// Iki yuzey ayni anda birbiriyle CELISEN sey soyluyordu; panelde girilecek bir
// sifre, basilacak calisan bir buton ve gidilecek bir yer YOKTU ("Sifremi
// unuttum" da cuzdan yokken anlamsiz).
//
// Kusurun kaynagi bir ISIMDI: App.vue'deki yorum "karsilama ekranina duser"
// diyordu, cunku sayfanin adi `'welcome'`. Bu dosya ismin tekrar yaniltmasini
// engeller -- kilit, sayfanin `Login`e DUSMEDIGINI olcer.

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

const app = read('popup/App.vue')
const notice = read('components/SidePanelNotice.vue')
const ekran = read('components/OnboardingPending.vue')

// `chrome.tabs.create(...)` cagrisini iceren dali bulur: kasa yoklugu dali.
const kasaYokDali = () => {
    const i = app.indexOf("if (!vaults || !vaults.length)")
    expect(i, 'kasa yoklugu dali bulunamadi').toBeGreaterThan(-1)
    return app.slice(i, i + 900)
}

describe('cuzdan yokken panel -- yonlendirme', () => {
    it('kasa yoksa panel Login e DUSMEZ', () => {
        const dal = kasaYokDali()
        expect(dal, "panel hala 'welcome' (Login) sayfasina gonderiliyor")
            .not.toContain("closeOrNavigate('welcome'")
    })

    it('kasa yoksa panel onboarding_pending sayfasina gider', () => {
        expect(kasaYokDali()).toContain("closeOrNavigate('onboarding_pending'")
    })

    it('onboarding sekmesi YINE de acilir (davranis kaybolmadi)', () => {
        // Duzeltme paneli degistirdi, kurulumu ACMAYI degil.
        expect(kasaYokDali()).toContain('chrome.tabs.create')
    })

    it("'welcome' HALA Login i cizer -- yani yeniden kullanilamaz", () => {
        // Bu satir bir belgeleme degil bir KANIT: yukaridaki iki testin neden
        // gerekli oldugunu, sayfanin bugunku anlamini olcerek gosterir. `'welcome'`
        // bir gun gercek bir karsilama ekranina baglanirsa bu test duser ve o an
        // yukaridaki kilidin gozden gecirilmesi gerekir.
        expect(app).toContain("<Login v-if=\"page.currentPage === 'welcome'\">")
    })

    it('yeni sayfa App.vue de cizilir ve import edilir', () => {
        expect(app).toContain("import OnboardingPending from '../components/OnboardingPending.vue'")
        expect(app).toContain("<OnboardingPending v-if=\"page.currentPage === 'onboarding_pending'\">")
    })
})

describe('cuzdan yokken panel -- ustune bir sey binmez', () => {
    // Bu ekran KILIT EKRANLARIYLA AYNI sinifta: cuzdan-oncesi. Uzerine islem
    // durumu serilmesi ya da "cuzdan artik yan panelde" ipucu kartinin kurulum
    // yonergesini ORTMESI, duzeltilen kafa karisikligini baska bicimde geri getirir.
    it('TransactionStatus cizilmez', () => {
        const i = app.indexOf('<TransactionStatus')
        const satir = app.slice(i, app.indexOf('>', i))
        expect(satir).toContain("'onboarding_pending'")
    })

    it('yan panel ipucu karti cizilmez', () => {
        const i = notice.indexOf('const KILIT_EKRANLARI')
        const satir = notice.slice(i, notice.indexOf('\n', i))
        expect(satir).toContain("'onboarding_pending'")
    })
})

describe('cuzdan yokken panel -- ekranin kendisi', () => {
    // CIKMAZ OLMAMALI. Sekme kazara kapatilirsa panelde yapilabilecek bir sey
    // kalmali; aksi halde tek cikis uzantiyi kapatip yeniden acmak olur.
    it('kurulumu yeniden acan bir yol var', () => {
        expect(ekran).toContain('chrome.tabs.create')
        expect(ekran).toContain("chrome.runtime.getURL('onboarding.html')")
    })

    it('SIFRE alani YOK', () => {
        expect(ekran).not.toMatch(/type="password"/)
        expect(ekran).not.toContain('login.')
    })

    it('ceviri anahtarlari iki dilde de var', () => {
        for (const [ad, sozluk] of [['tr', TR], ['en', EN]]) {
            expect(sozluk.onboardingPending, `${ad}: blok yok`).toBeTruthy()
            for (const k of ['title', 'body', 'reopen']) {
                expect(String(sozluk.onboardingPending[k] ?? ''), `${ad}.${k} bos`).not.toBe('')
            }
        }
    })

    it('metin bir cuzdanin VAR oldugunu ima ETMEZ', () => {
        // Duzeltilen kusurun ozu buydu: "Tekrar hos geldin" cumlesi ilk kez gelen
        // kullaniciya soylenmisti.
        expect(TR.onboardingPending.title).not.toMatch(/tekrar|geri döndün/i)
        expect(EN.onboardingPending.title).not.toMatch(/welcome back|again/i)
    })
})

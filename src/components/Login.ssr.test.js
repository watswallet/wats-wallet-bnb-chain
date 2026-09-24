// Login.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN: bu ekranin tamami DURUMA GORE degisen sinif listelerinden ibaret ve bu
// siniftaki hata kaynak taramasiyla YAKALANMAZ. Nitekim yenilemeden once tam boyle bir
// hata vardi: buton hem bir computed'dan hem bir ucluk ifadeden arka plan rengi aliyordu,
// ikisi de sinif listesine giriyordu ve hangisinin kazandigi CSS SIRASINA kaliyordu.
// Asagidaki "tema basina tek arka plan" testi o kusurun geri gelmesini engeller.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (hoisting).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { readFileSync } from 'node:fs'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { yorumsuz, blokGovdesi, cagriGovdesi } from '../test-utils/kaynakTarama.js'
import Login from './Login.vue'

// SSR, sablondaki HTML yorumlarini CIKTIYA basar (uretim derlemesi basmaz -- Vue
// derleyicisi production'da yorumlari duser). Bu dosyadaki "sunu ICERMEMELI" iddialari
// yorum metnini yakalayip YANLIS yere duserdi; iddialar RENDER EDILEN ICERIGE bakmali,
// koddaki gerekce yazilarina degil.
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

/**
 * `setup`: instance YAKALANDIGI ANDA (bilesenin kendi onMounted'indan ONCE) calisir --
 * durum ancak burada kurulabilir, `render()` DONDUKTEN sonra degil (bkz. ssrRender.js).
 */
async function mount({ locale = 'tr', localStore = {}, setup } = {}) {
    const chrome = installChromeStub(localStore)
    const app = createApp(Login, { use: [createTestPinia(), createTestI18n(locale)] })
    const holder = captureInstance(app, 'Login', (instance) => setup?.(instance.setupState))
    const html = stripComments(await render(app))
    return { html, holder, chrome }
}

/** Kilit acma butonunun sinif listesi -- yukseklik+genislik ikilisiyle tek o eslesir. */
function buttonClasses(html) {
    const attrs = [...html.matchAll(/<button([^>]*)>/g)]
        .map((m) => m[1])
        .find((a) => a.includes('h-11') && a.includes('w-full'))
    expect(attrs, 'kilit acma butonu bulunamadi').toBeTruthy()
    return attrs.match(/class="([^"]*)"/)[1]
}

/**
 * Butonun bir TEMADAKI arka plan siniflari.
 *
 * `hover:` ve `dark:hover:` KASITLI olarak disarida: onlar ayri bir duruma (imlec ustte)
 * aittir ve temel arka planla cakismaz. Olculen sey "bu tema, bu durumda KAC arka plan
 * beyan ediliyor" sorusudur; dogru cevap her zaman BIR'dir.
 */
const backgrounds = (classes, theme) => classes.split(/\s+/).filter((c) =>
    theme === 'dark' ? /^dark:bg-/.test(c) : /^bg-/.test(c))

const STATES = [
    { name: 'pasif', setup: () => {} },
    { name: 'hazir', setup: (s) => { s.password = 'sifre' } },
    { name: 'yukleniyor', setup: (s) => { s.password = 'sifre'; s.isLoading = true } },
    { name: 'basarili', setup: (s) => { s.isSuccess = true } },
]

afterEach(() => {
    delete globalThis.chrome
})

describe('Login — marka', () => {
    it('WATS amblemi cizilir — jenerik ikon DEGIL', async () => {
        const { html } = await mount()
        expect(html).toContain('src="/logo.png"')
    })

    it('amblem plakasi HER durumda ayni kalir — marka yanip sonmez', async () => {
        for (const state of STATES) {
            const { html } = await mount({ setup: state.setup })
            expect(html, state.name).toContain('bg-[#141419]')
            expect(html, state.name).toContain('src="/logo.png"')
            delete globalThis.chrome
        }
    })

    it('plaka her iki temada da koyu — gumus amblem acik zeminde kayboluyordu', async () => {
        const { html } = await mount()
        // Tema kosullu bir plaka olsaydi burada `dark:bg-` ile ikinci bir deger olurdu.
        const plate = html.match(/class="h-10 w-10[^"]*"/)[0]
        expect(plate).toContain('bg-[#141419]')
        expect(plate).not.toContain('dark:bg-')
    })

    it('alt cubuk okunabilir bir renkle cizilir', async () => {
        const { html } = await mount()

        expect(html).toContain('Cihazında şifrelenir')
        expect(html).toContain('v1.')
        // Onceki surumdeki `dark:text-zinc-800`, #09090b zemin uzerinde ~1.4:1 kontrast.
        expect(html).not.toContain('dark:text-zinc-800')
    })
})

describe('Login — sadelik kurallari', () => {
    // Kullanici onceki surumu "hic profesyonel durmuyor" diye reddetti; sebep efekt
    // yigmakti. Bu testler o efektlerin GERI SIZMASINI engeller.
    it('gradyan, parlama ve bulanik isik kumesi YOK', async () => {
        const { html } = await mount({ setup: (s) => { s.password = 'sifre' } })

        expect(html).not.toMatch(/bg-linear-to/)
        expect(html).not.toMatch(/animate-shine/)
        expect(html).not.toMatch(/blur-\[/)
        expect(html).not.toMatch(/backdrop-blur/)
    })

    it('marka vurgu rengi YOK — buton notr, renk yalniz ANLAM tasir', async () => {
        const ready = await mount({ setup: (s) => { s.password = 'sifre' } })
        const classes = buttonClasses(ready.html)

        expect(classes).toContain('bg-slate-900')
        expect(classes).toContain('dark:bg-white')
        expect(classes).not.toMatch(/bg-(indigo|purple|violet|blue)/)
    })
})

describe('Login — buton durumlari', () => {
    it('her durumda ve her temada TAM BIR arka plan — cakisma regresyonu', async () => {
        for (const state of STATES) {
            const classes = buttonClasses((await mount({ setup: state.setup })).html)

            expect(backgrounds(classes, 'light'), `${state.name} / acik`).toHaveLength(1)
            expect(backgrounds(classes, 'dark'), `${state.name} / koyu`).toHaveLength(1)
            delete globalThis.chrome
        }
    })

    it('sifre bosken buton PASIF', async () => {
        const { html } = await mount()

        expect(buttonClasses(html)).toContain('cursor-not-allowed')
        expect(html).toContain('disabled')
    })

    it('sifre girilince buton etkinlesir', async () => {
        const { html } = await mount({ setup: (s) => { s.password = 'sifre' } })
        expect(buttonClasses(html)).not.toContain('cursor-not-allowed')
    })

    it('yukleniyor ve basarili durumlari kendi metinlerini basar', async () => {
        const loading = await mount({ setup: (s) => { s.password = 'x'; s.isLoading = true } })
        expect(loading.html).toContain('Kontrol ediliyor')
        expect(loading.html).toContain('animate-spin')
        delete globalThis.chrome

        const success = await mount({ setup: (s) => { s.isSuccess = true } })
        expect(success.html).toContain('Açıldı')
        expect(buttonClasses(success.html)).toContain('bg-emerald-600')
    })
})

describe('Login — profil ve hata', () => {
    it('profil varsa kullanici adiyla hitap eder', async () => {
        const { html } = await mount({ localStore: { user: { username: 'yusuf' } } })
        expect(html).toContain('yusuf olarak devam ediyorsun')
    })

    it('profil YOKSA jenerik alt satir cizilir — bos bir ad yer tutmaz', async () => {
        const { html } = await mount()

        expect(html).toContain('Devam etmek için şifreni gir')
        expect(html).not.toContain('olarak devam ediyorsun')
    })

    it('hata mesaji etiket satirinda cikar ve alanin kenarligi kizarir', async () => {
        const { html } = await mount({ setup: (s) => { s.isError = true } })

        expect(html).toContain('Yanlış şifre')
        expect(html).toContain('border-red-500/70')
        expect(html).toContain('animate-nudge')
    })

    it('hata yokken mesaj HIC render edilmez — yer tutucu bosluk da yok', async () => {
        const { html } = await mount()

        expect(html).not.toContain('Yanlış şifre')
        expect(html).not.toContain('animate-nudge')
    })
})

describe('Login — erisilebilirlik ve dil', () => {
    it('alan gercek bir <label> ile eslenir', async () => {
        const { html } = await mount()

        expect(html).toContain('for="login-password"')
        expect(html).toContain('id="login-password"')
    })

    it('ingilizce cizilir', async () => {
        const { html } = await mount({ locale: 'en', localStore: { user: { username: 'yusuf' } } })

        expect(html).toContain('Welcome back')
        expect(html).toContain('Continuing as yusuf')
        expect(html).toContain('Encrypted on your device')
    })
})

// ---------------------------------------------------------------------------
// KAYNAK KILIDI: acilista odak.
//
// Bu davranis SSR'de render EDILEMEZ (odak gercek bir DOM ve gercek bir pencere
// ister), o yuzden burada kaynak taraniyor. Iddialar `yorumsuz()` uzerinden
// gider: bir yorum metni testi TATMIN EDEMEZ.
//
// NEDEN kilitleniyor: tek bir focus() cagrisi bu urunde YETMIYOR. Olculen iki
// kirilma var -- (1) pencere etkinlesirken tarayici odagi govdeye geri aliyor,
// (2) yan panel, kullanici icine tiklayana kadar klavye odagini hic almiyor.
// Ikisi de "odak verildi, sonra kayboldu" seklinde; tek atisla kapatilamaz.
describe('Login — acilista odak (kaynak kilidi)', () => {
    const kaynak = readFileSync(new URL('./Login.vue', import.meta.url), 'utf8')
    const kod = yorumsuz(kaynak)

    it('odak, kisa bir sure boyunca ISRARLA denenir — tek atis degil', () => {
        const govde = blokGovdesi(kod, /const israrEt = \([^)]*\) =>/)

        expect(govde).not.toBeNull()
        expect(govde).toMatch(/setInterval\(/)
        // Ilk odak tuttu diye cikilirsa, asil kirilma aninda (odak geri
        // alindiginda) dongu calismiyor olur -- olculen hata tam buydu.
        expect(govde).not.toMatch(/if \(odaklan\(\)\)\s*return/)
    })

    it('israr bir sure sonra KENDILIGINDEN biter — sonsuz donmez', () => {
        const govde = blokGovdesi(kod, /const israrEt = \([^)]*\) =>/)

        expect(govde).toMatch(/israriBirak\(\)/)
        expect(govde).toMatch(/Date\.now\(\)/)
    })

    it('kullanici bir yere dokununca israr biter — odak CALINMAZ', () => {
        expect(kod).toMatch(/addEventListener\(\s*'pointerdown'\s*,\s*israriBirak\s*,\s*true\s*\)/)
        expect(kod).toMatch(/removeEventListener\(\s*'pointerdown'\s*,\s*israriBirak\s*,\s*true\s*\)/)
    })

    it('sadece GERCEK bir yazma alanindan geri cekilir — dugme/govde engel degil', () => {
        const govde = blokGovdesi(kod, /const odaklan = \(\) =>/)

        expect(govde).not.toBeNull()
        expect(govde).toMatch(/yazmaAlani\(aktif\)/)
        // Eski kapi: "activeElement govde degilse dokunma". Yan panelde
        // kullanici panele tikladiginda odak zaten baska bir seye gecmis
        // oluyordu, bu yuzden kapi HER SEFERINDE geri donuyordu.
        expect(govde).not.toMatch(/aktif !== document\.body/)
    })

    it('pencere sonradan odak alirsa tekrar denenir (yan panel yolu)', () => {
        expect(kod).toMatch(/addEventListener\(\s*'focus'\s*,\s*pencereOdaklandi\s*\)/)
        expect(kod).toMatch(/removeEventListener\(\s*'focus'\s*,\s*pencereOdaklandi\s*\)/)
    })

    it('bilesen sokulunce zamanlayici temizlenir — sizinti yok', () => {
        const govde = cagriGovdesi(kod, /onUnmounted\(/)

        expect(govde).not.toBeNull()
        expect(govde).toMatch(/israriBirak\(\)/)
    })

    it('SSR guvenli: window/document yokken hicbir sey calismaz', () => {
        const israr = blokGovdesi(kod, /const israrEt = \([^)]*\) =>/)
        const odak = blokGovdesi(kod, /const odaklan = \(\) =>/)

        expect(israr).toMatch(/typeof window === 'undefined'/)
        expect(odak).toMatch(/typeof document === 'undefined'/)
    })
})

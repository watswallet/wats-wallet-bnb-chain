// Bilesenleri GERCEK vue/server-renderer ile render eden, TEKRAR KULLANILABILIR
// SSR test yardimcisi.
//
// NEDEN: Bu depoda component mount-test harness'i YOKTU (bkz. sendConfirmWiring.test.js,
// homeSolanaWiring.test.js, historyWiring.test.js ustundeki notlar) ve bu bosluk
// render/gorunum zamanindaki hatalarin (History.vue'de: getIcon(selectedTx.category)
// cokmesi, basarili Solana isleminin receipt_status kontrolu yuzunden "Basarisiz"
// gorunmesi) yesil bir 1462-testlik suite'ten SESSIZCE SIZMASINA sebep oldu.
//
// Bu modul GERCEK BIR TARAYICI/DOM GEREKTIRMEDEN (happy-dom/jsdom YOK) ve YENI
// BIR BAGIMLILIK EKLEMEDEN (@vue/server-renderer zaten `vue` paketinin bir
// parcasi) bilesenleri render eder. Iki teknik BIRLIKTE calisir:
//
// 1) onMounted -> onServerPrefetch ALIASI.
//    SSR'da mount-lifecycle hook'lari (onMounted DAHIL) hic TETIKLENMEZ --
//    Vue'nun kendi belgeledigi davranis budur, cunku "mount" bir DOM'a
//    baglanmayi ifade eder ve sunucu tarafinda boyle bir sey yoktur.
//    `renderToString` ise `onServerPrefetch` ile kaydedilen callback'lerin
//    DONDURDUGU PROMISE'I BEKLER, cikti o promise COZULDUKTEN SONRA uretilir.
//    Test dosyasi (HER dosya KENDI icinde, asagidaki KULLANIM notuna bakin)
//    'vue' modulunu mock'layip `onMounted`i `onServerPrefetch`e ESITLER --
//    boylece bilesen KAYNAK KODUNU DEGISTIRMEDEN (`onMounted(fetchHistory)`
//    oldugu gibi kalir) gercek async veri cekme GERCEKTEN beklenir ve GERCEK
//    veriyle olusan HTML doner.
//
// 2) `serverPrefetch` (Options API) GLOBAL MIXIN'i ile ic duruma erisim.
//    <script setup> bilesenleri EBEVEYNE KAPALIDIR (defineExpose'suz hicbir
//    sey disari sizmaz) -- ama bu, TIKLAMA gerektiren ic durumu (orn.
//    History.vue'nun `selectedTx` ref'i, modal'i acan) test etmeyi
//    engelliyormus gibi gorunur: bu ortamda DOM yok, gercek bir click event'i
//    ATILAMAZ. Cozum: `app.mixin({ serverPrefetch() {...} })` ile TUM bilesen
//    agacina uygulanan bir hook eklenir; bu hook `getCurrentInstance()` ile
//    HAM instance'a erisir. `instance.setupState`, <script setup>'in TUM
//    ust-seviye binding'lerini (ref'ler DAHIL, proxyRefs ile otomatik
//    ac-sar edilmis olarak) tasir -- `instance.proxy` (mixin Options API
//    hook'unun `this`'i, ya da bir ebeveynin template ref'i) KAPALI kalirken
//    `setupState` HAM instance uzerinden HALA erisilebilir VE YAZILABILIR:
//    `instance.setupState.selectedTx = x` ATAMASI, proxyRefs'in set tuzagi
//    sayesinde GERCEK ic ref'in .value'sunu gunceller. Yani bilesen KENDI
//    KAYNAK KODUNU DEGISTIRMEDEN, tikla-madan, ic-duruma-bagli gorunumler
//    (modal gibi) GERCEKTEN render edilebilir; ayni yol OKUMA icin de
//    kullanilir (fetchHistory tamamlandiktan SONRA `transactions`/`historyError`
//    gibi ic degiskenleri DOGRUDAN, HTML ayristirmadan okumak icin).
//
//    Bu, `@vitejs/plugin-vue`'nun vitest/dev boru hattinda <script setup>
//    bilesenlerini `inlineTemplate: false` ile derlemesine DAYANIR (render
//    fonksiyonu ayri derlenir, setup() TUM binding'leri dondurur). Bu secim
//    eklentinin KENDISI tarafindan otomatik yapilir (bkz. isUseInlineTemplate:
//    devServer/devTools acikken inlineTemplate KAPALI); production build'i
//    (`vite.config.js`) AYRI bir yapilandirmadir ve bundan ETKILENMEZ.
//
// KULLANIM (her tuketen test dosyasinda, TAM OLARAK bu sirayla):
//
//   import { vi, describe, it, expect } from 'vitest'
//   vi.mock('vue', async (importOriginal) => {
//       const actual = await importOriginal()
//       return { ...actual, onMounted: actual.onServerPrefetch }
//   })
//   import { createApp, captureInstance, render, installChromeStub } from '../test-utils/ssrRender.js'
//   import MyComponent from './MyComponent.vue'
//
// `vi.mock('vue', ...)` BURADA, tuketen dosyanin KENDISINDE yazilmak ZORUNDA:
// vitest/vite'in mock hoisting'i yalniz TEST DOSYASININ KENDI kaynagindaki
// `vi.mock(...)` cagrilarini derleme ANINDA yukari tasir; bu cagriyi bir
// yardimci fonksiyonun ICINE sarip BURADAN disari aktarmak CALISMAZ (o zaman
// mock, bilesen ZATEN 'vue'yu gercek haliyle import ettikten SONRA devreye
// girmeye calisir).

import { createSSRApp, getCurrentInstance } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import en from '../i18n/locales/en.json'
import tr from '../i18n/locales/tr.json'

/**
 * Bilesenin SSR uygulamasini olusturur. `use`: app.use(...) ile kurulacak
 * eklentiler dizisi (`[plugin]` ya da `[plugin, ...args]`).
 */
export function createApp(Component, { props = {}, use = [] } = {}) {
    const app = createSSRApp(Component, props)
    for (const entry of use) {
        Array.isArray(entry) ? app.use(...entry) : app.use(entry)
    }
    return app
}

/**
 * Depodaki GERCEK ceviri dosyalariyla (en.json/tr.json) TAZE bir i18n ornegi.
 * Uygulamanin kendi `src/i18n/index.js`'i YENIDEN KULLANILMAZ: o modul
 * `applySavedLanguage` ile chrome.storage'a bagli KALICI bir singleton kurar
 * ve testler arasi durum sizdirir; burasi HER cagrida TAZE bir ornek doner.
 */
export function createTestI18n(locale = 'en') {
    return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: { en, tr } })
}

/**
 * TAZE bir Pinia ornegi kurar ve aktif yapar. `setActivePinia` ACIKCA
 * cagrilir: store'lar render'dan ONCE (network.currentNetwork gibi durumu
 * onceden kurmak icin) `app.use(pinia)`'dan BAGIMSIZ olarak da cagrilabilsin.
 */
export function createTestPinia() {
    const pinia = createPinia()
    setActivePinia(pinia)
    return pinia
}

/**
 * Bilesen agacina bir "durum yakalama/enjeksiyonu" kancasi ekler.
 *
 * `componentName`: bilesenin derlenmis `__name`'i (SFC dosya adi, uzantisiz --
 * orn. 'History.vue' icin 'History'). Donen `holder.instance`, o bilesenin
 * `serverPrefetch` asamasina ULASTIGI ANDA (bilesenin KENDI onServerPrefetch/
 * onMounted callback'i baslamadan HEMEN ONCE) doldurulur ve `render()`
 * tamamlaninca kadar AYNI CANLI nesneyi gosterir (proxyRefs sayesinde --
 * anlik bir kopya DEGIL, canli bir goruntu):
 *
 *   - OKUMAK icin: `render()` tamamlandiktan SONRA `holder.instance.setupState.x`
 *     okumak, bilesenin fetchHistory gibi async isini bitirdikten SONRAKI
 *     NIHAI degeri verir.
 *   - YAZMAK icin (orn. tikla-madan bir modal acmak): `onCapture` callback'i
 *     ver -- bu, instance YAKALANDIGI ANDA (senkron, `serverPrefetch` icinde,
 *     yani bilesenin KENDI veri-cekme kancasindan ONCE) cagrilir. `holder.instance`
 *     `render()`i CAGIRMADAN ONCE ELLE atanamaz (henuz `null`dur -- instance
 *     ancak render SIRASINDA olusturulur); bu yuzden yazma islemi BU callback
 *     icinde yapilmak ZORUNDADIR, `render()`in DONUS DEGERINDEN SONRA degil.
 *
 * Birden fazla instance olusursa (ayni bilesen birden fazla yerde
 * kullanilirsa) YALNIZ ILKI yakalanir -- History.vue gibi kok bilesenler icin
 * bu her zaman yeterlidir.
 */
export function captureInstance(app, componentName, onCapture) {
    const holder = { instance: null }
    app.mixin({
        serverPrefetch() {
            if (holder.instance) return
            const instance = getCurrentInstance()
            if (instance?.type?.__name === componentName) {
                // KOD INCELEMESI (review round 2, Bulgu E): teknik SESSIZCE
                // bozulursa (orn. @vitejs/plugin-vue baska bir surumde/modda
                // <script setup>'i inlineTemplate: true ile derlerse -- render
                // fonksiyonu setup()'a GOMULUR, hicbir binding donmez, Vue'nun
                // kendi EMPTY_OBJ sabiti setupState'e atanir) asagidaki her
                // okuma/yazma sessizce degeri kaybeder ve testler "expected
                // undefined to be 'fetch'" gibi KAFA KARISTIRICI assertion
                // hatalariyla duser -- gercek nedeni (bu harness'in KENDISI
                // kirildi) SOYLEMEZ. Asagidaki kontrol bunu ERKENDEN yakalar.
                //
                // DENEYLE dogrulandi: burada bir CIPLAK `throw` Vue'nun KENDI
                // serverPrefetch hata isleyicisi tarafindan YUTULUR -- Vue
                // yalniz jenerik "[Vue warn]: Unhandled error during execution
                // of serverPrefetch hook" yazip render'a DEVAM eder, mesajin
                // ICERIGI (asagidaki metin) HICBIR YERE YAZILMAZ ve
                // renderToString YINE COZULUR -- yani `throw` TEK BASINA bu
                // yolda "yuksek sesli" DEGIL. Bu yuzden mesaj ONCE ACIKCA
                // console.error ile YAZDIRILIR (testin CIKTISINDA HER ZAMAN
                // gorunur) VE holder'a da KAYDEDILIR (cagiran isterse
                // `expect(holder.setupStateEmptyError).toBeUndefined()` ile
                // SERT bir basarisizliga cevirebilsin diye) -- `throw` da
                // AYRICA denenir, baska bir Vue surumu/baglaminda GERCEKTEN
                // propagate ederse zarari olmaz.
                const keys = Object.keys(instance.setupState || {})
                if (keys.length === 0) {
                    const message = "captureInstance('" + componentName + "'): setupState BOS. " +
                        "Bu genellikle @vitejs/plugin-vue'nun bu derlemede " +
                        "<script setup>'i inlineTemplate: true ile derledigi " +
                        "(render fonksiyonu setup()'a GOMULUR, hicbir binding " +
                        "donmez) anlamina gelir -- bu durumda getCurrentInstance() " +
                        "uzerinden hicbir seye ULASILAMAZ ve butun captureInstance " +
                        "mekanizmasi (bkz. dosya basindaki KULLANIM notu) sessizce " +
                        "ise yaramaz hale gelir. isUseInlineTemplate SADECE hem " +
                        "devServer hem devToolsEnabled false ise inline secer; " +
                        "vitest altinda devToolsEnabled (isProduction false oldugu " +
                        "surece) dogrudur, yani bu hatayi goruyorsan boru hatti " +
                        "production modunda VE dev server olmadan calisiyor " +
                        "olabilir -- @vitejs/plugin-vue surumunu kontrol et."
                    console.error(message)
                    holder.setupStateEmptyError = new Error(message)
                    throw holder.setupStateEmptyError
                }
                holder.instance = instance
                onCapture?.(instance)
            }
        },
    })
    return holder
}

/** `renderToString` sarmalayicisi -- tek basina anlamli olmasa da okunurlugu artirir. */
export async function render(app) {
    return renderToString(app)
}

/**
 * Kisa yol: ic duruma (captureInstance) erisim GEREKTIRMEYEN, tek bilesenlik SSR
 * render'lar icin. `createApp` + `render`in ince bir sarmalayicisi -- `global.plugins`
 * sekli vue-test-utils'un `mount(Component, { global: { plugins } })` API'siyle AYNI.
 *
 * HER cagirimda (aksi belirtilmedikce) TAZE bir Pinia ornegi kurup aktif eder:
 * cogu bilesen (orn. SidePanelNotice.vue) `pageStore()` gibi bir Pinia store'u
 * DOGRUDAN cagirir ve aktif bir Pinia olmadan bu cagri patlar -- cagiran ayrica
 * bir Pinia vermek ZORUNDA KALMASIN diye burada OTOMATIK kurulur.
 *
 * `pinia`: render'dan ONCE bir store'un durumunu doldurmak gereken testler icin
 * (orn. `page.currentPage = 'home'`) -- `createTestPinia()` ile ONCEDEN olusturulup
 * doldurulan ayni ornek buraya verilir, boylece bilesenin `pageStore()` cagrisi
 * TAZE/bos bir kopya degil doldurulmus olani gorur.
 *
 * Ic duruma erismek (modal acmak gibi) gereken testler HALA `createApp`/
 * `captureInstance`/`render`i DOGRUDAN kullanmali (bkz. dosya basindaki KULLANIM
 * notu) -- bu sarmalayici o senaryoyu KAPSAMAZ.
 */
export async function ssrRender(Component, { props = {}, global = {}, pinia } = {}) {
    const activePinia = pinia || createTestPinia()
    const app = createApp(Component, { props, use: [activePinia, ...(global.plugins || [])] })
    return render(app)
}

/**
 * Depo genelinde tekrarlanan chrome.storage.local + chrome.runtime.sendMessage
 * sahte uygulamasi (bkz. background.solanaDerive.test.js ile AYNI desen).
 * `globalThis.chrome`'u DOGRUDAN ATAR -- cagiranin sorumlulugu, testten sonra
 * geri almaktir (orn. `afterEach(() => { delete globalThis.chrome })`),
 * aksi halde baska test dosyalarina SIZAR (vitest dosya izolasyonu bunu HER
 * ZAMAN engellemez, ozellikle ayni worker'da ardisik calisan dosyalarda).
 */
export function installChromeStub(initialLocalStore = {}) {
    const localStore = { ...initialLocalStore }
    let sendMessageImpl = async () => ({ error: 'installChromeStub: sendMessage yapilandirilmadi' })

    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const wanted = keys === undefined
                        ? Object.keys(localStore)
                        : (Array.isArray(keys) ? keys : [keys])
                    return Object.fromEntries(wanted.map((k) => [k, localStore[k]]))
                },
                set: async (obj) => { Object.assign(localStore, obj) },
            },
        },
        runtime: {
            sendMessage: (...args) => sendMessageImpl(...args),
        },
    }

    return {
        localStore,
        setSendMessage: (fn) => { sendMessageImpl = fn },
    }
}

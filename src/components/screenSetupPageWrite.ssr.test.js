// DEGISMEZ KURAL: `<Transition>` icinde yasayan HICBIR ekran bileseni, KENDI
// setup'i / render'i SIRASINDA `page.currentPage`e YAZMAZ -- ve her ekran
// GERCEKTEN BIR SEY render eder.
//
// NEDEN (gercek Chrome'da uretildi, konsolda HIC hata yok -- bu bir istisna
// degil, bir KILITLENME): App.vue ekranlari
// `<Transition name="fade-slide" mode="out-in"><div :key="page.currentPage">`
// icinde tutuyor. Bir ekran setup'inda currentPage'i degistirirse anahtar TEK
// bir flush icinde token -> swap -> home olur. `swap` sarmalayicisinin AYRILMA
// gecisi o anda HENUZ baslamamis GIRIS gecisinden ONCE kurulur; girisin
// ertelenen nextFrame'i `el._endId`i artirir ve ayrilmanin `resolveIfNotStale`i
// KALICI OLARAK bayat kalir -- `finishLeave`/`afterLeave` hic cagrilmaz,
// BaseTransition'in `state.isLeaving`i sonsuza dek `true` kalir, Transition o
// andan sonra yalniz BOS BIR YORUM dugumu render eder ve hayatta kalan tek
// dugum `fade-slide-leave-to` (opacity 0) ile asili kalir. Kullanicinin
// gordugu: KALICI SIYAH EKRAN, belgenin omru boyunca.
//
// BU DOSYA BIR SINIF KILIDIDIR, IKI EKRANIN KILIDI DEGIL.
//
// Once yalnizca Swap ve Bridge ornekleniyordu -- yani TAM OLARAK bu gunahi
// artik isleyemeyen iki bilesen. Kural ~50 ekran icin iddia ediliyor ama iki
// tanesi icin olculuyorsa, ayni gunahi isleyen YENI bir ekran yesil olarak
// yayina cikar. Liste bu yuzden ELLE YAZILMAZ: `ekranListesi()` onu App.vue'nun
// KENDISINDEN cikarir (bkz. test-utils/ekranListesi.js), yani kapsama yeni
// ekranlarla birlikte kendiliginden buyur.
//
// IKI IDDIA, IKI AYRI ARIZA:
//   1) SAYFA DEGISMEDI  -- gunahin KENDISI.
//   2) BIR SEY RENDER EDILDI -- kullanicinin GORDUGU semptom. Kilitlenmis bir
//      Transition'in ciktisi tam olarak `"<!---->"`tir: bos bir yorum dugumu.
//      Yalnizca (1) iddia edilirse, "ekran hicbir sey render etmiyor"
//      gerilemesi -- bu isin konusu olan tam o semptom -- YESIL kalirdi.
//      (Deneyle sinir cizildi: setup/render icindeki bir `throw`
//      `renderToString`i reddeder, yani COKMELER zaten yakalanir; SESSIZCE bos
//      donen bir render yakalanMAZ. (2) o araligi kapatir.)
//
// NICIN BU HARNESS OLCEBILIYOR: 'vue' modulu BU dosyada MOCK'LANMAZ. Yani
// `onMounted` SSR'da (Vue'nun belgeledigi davranis) HIC calismaz; geriye
// yalnizca setup + render kalir. Sayfa degeri DEGISMISSE, degisikligi
// yapabilecek TEK yer setup/render'dir. (`immediate: true` bir watch ve
// `watchEffect` de SSR'da senkron kosar -- Vue setup sirasinda bunlarin flush'ini
// 'sync'e cevirir -- yani o iki sekil de BURADA yakalanir.)
//
// BU HARNESS'IN GORMEDIGI SEKILLER -- `onBeforeMount` (SSR'da hic kosmaz) ve
// bir DEGISIMLE atesleyecek `flush: 'sync'` izleyicisi -- ve "yalnizca TON'da
// yazan" gibi KOSULA BAGLI yazmalar kardes dosya
// `screenDeadlockShapes.test.js`te KAYNAK UZERINDEN, yorum-kor bicimde ve
// zincirden BAGIMSIZ olarak kilitlenir. Iki dosya birlikte sinifi kapatir;
// yalniz biri kapatmaz.
import { describe, it, expect, afterEach } from 'vitest'

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { ekranListesi, ekranYukle } from '../test-utils/ekranListesi.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const TON_CHAIN = supported_chains.find((c) => c.chainId === -239)
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')

// UC ZINCIR BIRDEN: gunah KOSULA BAGLI olabilir. Yalnizca Ethereum'da render
// eden bir kilit, "TON ise currentPage'e yaz" seklindeki TAM OLARAK BU
// hatanin kendisini kaciririrdi -- duzeltilen kusur da zaten yalniz TON'da
// ateslenip Ethereum'da sessiz kaliyordu.
const ZINCIRLER = [
    ['EVM', ETH_CHAIN],
    ['TON', TON_CHAIN],
    ['Solana', SOLANA_CHAIN],
]

// Sablonun `v-if`i ile BIRLIKTE gecirilen prop'lar (App.vue'daki cagri
// yerlerinin AYNISI). Ekran yalniz o prop varken goruntulendigi icin bunlari
// vermek gercek kosullari TAKLIT eder, gevsetmez.
const PROPLAR = {
    Token: { id: 1 },
    // `:dapp="page.data"` -- bu ekranda `data` bir HOST DIZGESIDIR, nesne degil.
    DappPermissions: { dapp: 'ornek.test' },
    EditAccount: { account: { address: '0x1', key: 'acc1', name: 'A' } },
    EditAccountName: { account: { address: '0x1', key: 'acc1', name: 'A' } },
    ShowPhrases: { account: { address: '0x1', key: 'acc1' } },
    ShowPrivateKey: { account: { address: '0x1', key: 'acc1' } },
    ShowTonKey: { account: { address: '0x1', key: 'acc1' } },
    Phrases: { mnemonic: 'abandon abandon about' },
    PrivateKey: { privateKey: '0x00' },
    TonKey: { tonKey: { mnemonic: 'abandon abandon about' } },
    EditAddress: { savedAddress: { label: 'l', address: '0x1' }, savedAddressIndex: 0 },
    ShowPhrase: { mnemonic: 'abandon abandon about', vault: { id: 'v1' } },
    UnlockVault: { vault: { id: 'v1' } },
}

afterEach(() => {
    delete globalThis.chrome
})

/**
 * SSR ciktisi KULLANICIYA BIR SEY GOSTERIYOR MU.
 *
 * Vue'nun SSR'i parcali (fragment) koklerini `<!--[-->`/`<!--]-->`, bos
 * dallari `<!---->` ile isaretler. Kilitlenmis Transition'in TEK ciktisi da
 * budur. Yorumlar atildiktan sonra GERCEK bir etiket kalmali.
 */
function gorunurIcerikVar(html) {
    return /<[a-zA-Z]/.test(html.replace(/<!--[\s\S]*?-->/g, ''))
}

async function ekraniRenderEt(ekran, zincir) {
    installChromeStub({
        currentNetwork: zincir,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
        accounts: [{ address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }],
        vaults: [{ id: 'v1' }],
    })
    // `utils/dappFunctions.js` MODUL UST DUZEYINDE `chrome.windows.onRemoved.addListener`
    // cagirir (bkz. Home.ssr.test.js / ConnectDapp.ssr.test.js'teki ayni not):
    // o satir bileseni IMPORT ettigimiz anda kosar, render'da degil. Paylasilan
    // stub'a eklenmiyor -- oradaki sadelik baska ~300 test dosyasinin varsayimi.
    globalThis.chrome.windows = {
        onRemoved: { addListener() {}, removeListener() {} },
        create: async () => ({ id: 1 }), remove: async () => {}, get: async () => ({}),
        getLastFocused: async () => ({ width: 1200, left: 0, top: 0 }),
    }
    globalThis.chrome.tabs = {
        onRemoved: { addListener() {}, removeListener() {} },
        create() {}, remove() {}, query: async () => [],
    }

    const Bilesen = await ekranYukle(ekran.anahtar)
    const app = createApp(Bilesen, { props: PROPLAR[ekran.tag] || {} })
    app.use(createTestPinia())
    app.use(createTestI18n())

    networkStore().currentNetwork = zincir
    // BuyToken ekranina App.vue'dan ancak kullanici bir token sectikten SONRA
    // gelinir; `onramp_token` o secimdir ve ekran onsuz zaten acilmaz.
    cryptoStore().onramp_token = { symbol: 'eth', chainId: 1 }
    pageStore().currentPage = ekran.page

    const html = await render(app)
    return html
}

const EKRANLAR = ekranListesi()

describe('SINIF KILIDI: <Transition> icindeki ekranlar setup/render sirasinda currentPage YAZMAZ', () => {
    // Liste App.vue'dan turetildigi icin "kac ekran" degeri de bir OLCUMDUR:
    // taban 54. Sifira ya da bire dusmesi (regex'in sessizce eslesmeyi
    // birakmasi) kilidi hicbir sey soylemeden kapatirdi.
    it('App.vue en az 40 ekran barindiriyor ve hepsi cozulebiliyor', () => {
        expect(EKRANLAR.length).toBeGreaterThanOrEqual(40)
        expect(EKRANLAR.map((e) => e.tag)).toContain('Swap')
        expect(EKRANLAR.map((e) => e.tag)).toContain('Bridge')
        // Yorum satirina alinmis bir ekran GERCEK ekran degildir.
        expect(EKRANLAR.map((e) => e.tag)).not.toContain('SelectPhrase')
    })

    for (const [zincirAdi, zincir] of ZINCIRLER) {
        describe(zincirAdi + ' aktifken', () => {
            for (const ekran of EKRANLAR) {
                it(`${ekran.tag} (${ekran.page}): sayfa degismez ve ekran BIR SEY render eder`, async () => {
                    const html = await ekraniRenderEt(ekran, zincir)

                    expect(pageStore().currentPage).toBe(ekran.page)
                    expect(
                        gorunurIcerikVar(html),
                        `${ekran.tag} HICBIR SEY render etmedi (kilitlenmis Transition'in ciktisiyla ayni sekil). Ham cikti: ${JSON.stringify(html.slice(0, 120))}`,
                    ).toBe(true)
                })
            }
        })
    }
})

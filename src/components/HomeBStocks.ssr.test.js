// Home.vue (SSR) -- "Hisseler" sekmesi (Task 9).
//
// KESIF GORUNUMU: ana ekran listesi bakiyeye degil, imported_tokens
// kovasinda OLMAYA baglidir (kova hesap acilisinda BIR KEZ dolar, bir daha
// TAZELENMEZ). 22 bStock'u o kovaya yazmak her kullaniciya 22 tane $0,00
// satiri eklemek olurdu -- bu yuzden Hisseler sekmesi KATALOGDAN (BSTOCKS,
// Task 4) kurulur, kovadan DEGIL. Sekme acildiginda bakiyeler okunur ve
// YALNIZCA sifirdan buyuk olanlar kovaya eklenir (boylece Varliklar'da da
// gorunurler).
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu -- hoisting, bilesen import edilmeden ONCE devreye
// girmeli). Kalip HomeJettonPrice.ssr.test.js'ten BIREBIR kopyalandi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))

// bStocks bakiyesi: SADECE OWNED_ADDRESS sifirdan buyuk doner, diger 21 tanesi
// SIFIR -- bu dosyanin konusu useTokenBalance'in SONUCUNU Home.vue'nun dogru
// islemesi (katalogu gostermek + sifirdan buyuk olani kovaya eklemek), o
// sonucun KENDISI degil (bkz. Home.vue DIKKAT notu: bakiye tek kapi
// useTokenBalance'tir, ikinci bir Multicall3 kopyasi YOK).
const OWNED_ADDRESS = '0x80f3D493EBCe97e343c53D29a137942416B4ffC0' // CRCLB
const useTokenBalanceMock = vi.fn(async (walletAddress, tokenAddress) => {
    return tokenAddress.toLowerCase() === OWNED_ADDRESS.toLowerCase() ? 12.5 : 0
})
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

const axiosPostMock = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
vi.mock('axios', () => ({
    default: {
        post: (...args) => axiosPostMock(...args),
        get: async () => ({ status: 200, data: { news: [] } }),
    },
}))

// Home.vue <Header> icerir ve Header.vue -> utils/dappFunctions.js zinciri
// MODUL UST DUZEYINDE chrome.windows.onRemoved.addListener cagirir; o satir
// import ANINDA calisir, installChromeStub ise ancak test govdesinde.
// vi.hoisted olmadan `import Home from './Home.vue'` "chrome is not defined"
// ile patlar (ayni tuzak: Home.ssr.test.js, Header.ssr.test.js).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import Home from './Home.vue'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'
import supported_chains from '../data/supported_chains.json'

const here = dirname(fileURLToPath(import.meta.url))
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const CHAIN_KEY = String(BSTOCKS_CHAIN_ID)
const GOOGLB_ID = BSTOCKS.find((s) => s.symbol === 'GOOGLB').coingecko_id
const VARSAYILAN_HESAP = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    // `mockClear` CAGRILARI temizler, IMPLEMENTASYONU DEGIL: bir test
    // `mockImplementation` ile fiyat dondurdugunde o davranis sonraki testlere
    // SIZAR. Varsayilan her testten sonra geri konur.
    axiosPostMock.mockReset()
    axiosPostMock.mockImplementation(async () => ({ status: 200, data: { tokens: [] } }))
    useSolanaAssetsMock.mockClear()
    useTokenBalanceMock.mockClear()
    delete globalThis.chrome
})

/**
 * Home.vue'yu `activeTab` ZATEN 'stocks' iken render eder.
 *
 * `activeTab` bilesenin KENDI onMounted'i (onServerPrefetch'e aliaslanmis)
 * baslamadan HEMEN ONCE, captureInstance'in `onCapture` kancasi ile yazilir
 * (ssrRender.js basindaki KULLANIM notu): bu sayede Home.vue'nun onMounted'i
 * "sekme zaten 'stocks' ise bStock verisini yukle" kontrolunu GERCEK bir
 * async akiskla (renderToString'in bekledigi promise zincirinin ICINDE)
 * calistirir -- tiklama atmadan, sekme "acilmis" GIBI davranir.
 */
async function renderHome({ locale = 'en', importedTokens = {}, account = VARSAYILAN_HESAP, sekme = 'stocks', pinia = null } = {}) {
    const stub = installChromeStub({
        currentNetwork: ETH_CHAIN,
        active_account: account,
        imported_tokens: importedTokens,
        vaults: [],
    })

    const app = createApp(Home, { props: { embedded: false } })
    // `pinia` DISARIDAN verilebilir: gercek uygulamada pinia uzantinin omru
    // boyunca TEK, Home.vue onun ICINDE yeniden mount oluyor (home -> token ->
    // home). Her render'da taze bir pinia kurmak o dolasimi MODELLEMEZ ve
    // depoda yasayan sekme hafizasini olcemez hale getirir.
    const kullanilanPinia = pinia ?? createTestPinia()
    app.use(kullanilanPinia)
    app.use(createTestI18n(locale))

    const network = networkStore()
    network.currentNetwork = ETH_CHAIN

    const captured = captureInstance(app, 'Home', (instance) => {
        // `sekme: null` -> HIC yazma: modul duzeyinde HATIRLANAN sekmeyi olcen
        // testler icin, bileseni kendi baslangic degeriyle birakir.
        if (sekme !== null) instance.setupState.activeTab = sekme
    })
    const html = await render(app)

    return { html, captured, stub, pinia: kullanilanPinia }
}

describe('Home.vue (SSR) -- Hisseler sekmesi KESIF GORUNUMU (Task 9)', () => {
    it('activeTab "stocks" iken 22 satirin TAMAMI BSTOCKS kaydindan gelir -- kova BOSKEN bile', async () => {
        const { html } = await renderHome({ importedTokens: {} })

        const renderedCount = BSTOCKS.filter((stock) => html.includes(stock.symbol)).length
        expect(renderedCount).toBe(22)
    })

    // findings F6: axios.post icin zaman asimi yoktu -- takilan bir istek
    // stocksRefresh'in inFlight bayragini kalici tutar ve HER sonraki 60 sn'lik
    // tazelemeyi bloke ederdi. 10 sn hem ilk yukleme (loadBStockData) hem de
    // sekme acikken tazeleme (loadBStockPrices) icin AYNI cagriyi kullanir.
    it('hisse fiyat istegi 10 sn zaman asimi ile gonderilir', async () => {
        await renderHome({ importedTokens: {} })

        const call = axiosPostMock.mock.calls.find(([url]) => String(url).includes('/getTokensDataById'))
        expect(call).toBeDefined()
        expect(call[2]).toEqual({ timeout: 10000 })
    })

    it('bakiyesi SIFIRDAN BUYUK olan bStock imported_tokens kovasina EKLENIR (Varliklar da gorsun diye)', async () => {
        const { stub } = await renderHome({ importedTokens: {} })

        const bucket = stub.localStore.imported_tokens?.acc1?.[CHAIN_KEY] ?? []
        expect(bucket.some((t) => t.address.toLowerCase() === OWNED_ADDRESS.toLowerCase())).toBe(true)
    })

    it('bakiyesi SIFIR olan bStock kovaya EKLENMEZ', async () => {
        const { stub } = await renderHome({ importedTokens: {} })

        const bucket = stub.localStore.imported_tokens?.acc1?.[CHAIN_KEY] ?? []
        const zeroBalanceStock = BSTOCKS.find((s) => s.address.toLowerCase() !== OWNED_ADDRESS.toLowerCase())

        expect(bucket.some((t) => t.address.toLowerCase() === zeroBalanceStock.address.toLowerCase())).toBe(false)
        // Kovada YALNIZCA sahip olunan tek kayit olmali -- 21 sifir-bakiyeli
        // bStock hicbiri eklenmemis olmali.
        expect(bucket.length).toBe(1)
    })

    // FIYAT GELMEDEN '$0.00' YAZILMAZ.
    //
    // Sekme artik hatirlandigi icin panel veri gelmeden de cizilebiliyor (hisse
    // detayindan geri donus). O pencerede satirlar "$0.00" ve YESIL "+0.00%"
    // gosteriyordu: Apple'i sifir fiyatta ve yukseliste gostermek, eksik veriden
    // daha kotu. Bu harness'te axios ZATEN bos fiyat listesi donuyor, yani
    // olculen durum tam olarak o pencere.
    it('fiyat verisi YOKKEN satir "—" yazar, "$0.00" DEGIL', async () => {
        const { html } = await renderHome()
        // SSR CIKTISI SABLON YORUMLARINI AYNEN TASIR -- olculdu. Bu iddianin
        // anlattigi davranisi ACIKLAYAN yorumun kendisi ("$0.00 DEGIL") ciktida
        // geciyor ve iddiayi SAHTE KIRMIZIYA dusuruyordu.
        const govde = html.replace(/<!--[\s\S]*?-->/g, '')

        // Iddia SATIRIN ICINE dar tutulur: ekranin ustundeki portfoy basligi
        // kendi degisim yuzdesini ("0.00%") zaten basiyor ve belge genelinde
        // aranirsa bu iddia OLCTUGU SEYI degil onu yakalar.
        const satir = govde.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?GOOGLB[\s\S]*?<\/button>/)
        expect(satir).not.toBeNull()

        expect(satir[0]).toContain('—')
        expect(satir[0]).not.toContain('$0.00')
        expect(satir[0]).not.toContain('0.00%')
    })

    // KARSI ORNEK: yukaridaki iddia "fiyat HIC gosterilmiyor" ile de yesil
    // kalirdi. Veri GELDIGINDE gercek sayinin ciktigi ayrica olculur.
    it('fiyat verisi GELDIGINDE gercek fiyat ve degisim yazilir', async () => {
        axiosPostMock.mockImplementation(async (url, body) => {
            if (String(url).includes('/getTokensDataById') && body?.ids?.includes(GOOGLB_ID)) {
                return {
                    status: 200,
                    data: {
                        tokens: [{
                            coingecko_id: GOOGLB_ID,
                            market_data: { priceUSD: 231.45, change: { h24: -1.23 } },
                        }],
                    },
                }
            }
            return { status: 200, data: { tokens: [] } }
        })

        const { html } = await renderHome()
        const govde = html.replace(/<!--[\s\S]*?-->/g, '')
        const satir = govde.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?GOOGLB[\s\S]*?<\/button>/)

        expect(satir).not.toBeNull()
        expect(satir[0]).toContain('$231.45')
        expect(satir[0]).toContain('-1.23%')
        expect(satir[0]).not.toContain('—')
        // Dususte KIRMIZI: `>= 0` dali yanlis tarafa dusmuyor.
        expect(satir[0]).toContain('text-red-500')
    })

    // ISIN/marka gerekcesi bStocks.js'te: ihraccinin hukuki niteligi (sertifika,
    // hisse senedi degil) kullaniciya GORUNMELI ve sabit kodlanmamali -- locale
    // degisince metin de degismeli, aksi halde $t() yerine duz metin yazilmis
    // demektir.
    it('ihracci uyarisi $t(\'home.stocksIssuer\') ile gelir -- locale EN metni', async () => {
        const { html } = await renderHome({ locale: 'en' })
        expect(html).toContain('certificates over shares')
    })

    it('ihracci uyarisi $t(\'home.stocksIssuer\') ile gelir -- locale TR metni (sabit kodlanmadi)', async () => {
        const { html } = await renderHome({ locale: 'tr' })
        expect(html).toContain('hisse üzerine sertifika')
    })
})

// ------------------------------------------------------------------
// HISSE DETAYI.
//
// Katalog satirlari TIKLANAMIYORDU: Token.vue bStock'u Task 10'dan beri taniyor
// (rozet, ihracci notu, Kopru kapali) ama oraya ancak hisseye SAHIPSEN -- yani
// satir imported_tokens kovasina dusup Varliklar listesinde gorundugunde --
// ulasabiliyordun. Katalogda duran 22 hissenin 21'i erisilmezdi.
describe('Home.vue (SSR) -- hisse detayina gecis', () => {
    const GOOGLB = BSTOCKS.find((s) => s.symbol === 'GOOGLB')

    it('hisse satirlari BUTON olarak render edilir', async () => {
        const { html } = await renderHome()

        const butonlar = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?GOOGLB[\s\S]*?<\/button>/g) || []
        expect(butonlar.length).toBeGreaterThan(0)
    })

    // @click KAYNAKTAN kilitlenir, render'dan DEGIL.
    //
    // Vue'nun SUNUCU render'i olay dinleyicilerini HIC serilestirmez: yukaridaki
    // HTML iddiasi <button> etiketini gorur ama @click'i GOREMEZ. Bagi koparsaniz
    // -- satir buton olarak kalir, openStock hicbir yerden cagrilmaz -- o test
    // YESIL kalirdi ve ikinci test openStock'u DOGRUDAN cagirdigi icin o da
    // yesil kalirdi. Yani bu degisikligin BASLIK OZELLIGI kilitsizdi.
    //
    // Deponun bu is icin kalibi kaynak taramasi (utils/assetRouteWiring.test.js
    // ayni satirin kardesi icin `@click="selectToken(token)"` iddiasini boyle
    // yaziyor).
    it('satirin @click bagi openStock a gider (kaynak kilidi)', () => {
        const kaynak = readFileSync(join(here, 'Home.vue'), 'utf8')

        // AYNI elemanda hem v-for hem @click: iki ayri iddia, bagin baska bir
        // elemana kaymasini yakalamaz.
        const satirBlogu = kaynak.match(/<button[^>]*?v-for="stock in BSTOCKS"[\s\S]*?>/)
        expect(satirBlogu).not.toBeNull()
        expect(satirBlogu[0]).toContain('@click="openStock(stock)"')
    })

    it('openStock, Token.vue nun BEKLEDIGI kaydi yazar (id + chainId + address)', async () => {
        const { captured } = await renderHome()

        captured.instance.setupState.openStock(GOOGLB)

        // Token.vue `pickedRef()` kaydi ANCAK `id === props.id` VE chainId/address
        // dolu ise kabul eder; biri eksikse kayit sessizce BAYAT sayilir ve ekran
        // kanonik kayda (yanlis zincirin adresine) duser.
        expect(cryptoStore().selected_token_ref).toEqual({
            id: GOOGLB.coingecko_id,
            chainId: BSTOCKS_CHAIN_ID,
            address: GOOGLB.address,
            decimals: GOOGLB.decimals,
            symbol: GOOGLB.symbol,
        })
        expect(cryptoStore().selected_token_id).toBe(GOOGLB.coingecko_id)
        expect(pageStore().currentPage).toBe('token')
    })

    // chainId SABIT 56 olmak ZORUNDA: BSTOCKS kayitlarinda chainId ALANI YOK.
    // `stock.chainId` yazilsaydi undefined gecerdi ve Token.vue bakiyeyi AKTIF
    // agdan (burada Ethereum) okurdu -- kullanici sifir gorurdu.
    it('chainId AKTIF AGDAN degil, bStocks zincirinden gelir', async () => {
        const { captured } = await renderHome()
        expect(networkStore().currentNetwork.chainId).toBe(1)

        captured.instance.setupState.openStock(GOOGLB)

        expect(cryptoStore().selected_token_ref.chainId).toBe(BSTOCKS_CHAIN_ID)
        expect(cryptoStore().selected_token_ref.chainId).not.toBe(1)
    })
})

// ------------------------------------------------------------------
// HESAP KAPISI. Sekme tiklanabilir olunca "zararsiz katalog" olmaktan cikip
// BOZUK bir detay ekranina acilan kapiya donusuyor: BSC tutamayan bir hesapta
// (eski `type: 'ton'` kaydi) bakiye okumasi adres kodlamasinda duser.
describe('Home.vue (SSR) -- Hisseler sekmesi hesap kapisi', () => {
    const TON_HESABI = { address: 'UQTest000000000000000000000000000000000000000', key: 'acc-ton', type: 'ton' }

    it('BSC tutamayan hesapta sekme GIZLI ve katalog RENDER EDILMEZ', async () => {
        const { html, captured } = await renderHome({ account: TON_HESABI })

        expect(captured.instance.setupState.stocksAvailable).toBe(false)
        // Hatirlanan sekme 'stocks' olsa BILE ekran bos kalmaz, Varliklar'a duser.
        expect(captured.instance.setupState.gorunenSekme).toBe('assets')
        expect(html).not.toContain('GOOGLB')
    })

    it('EVM tutabilen hesapta (imported) sekme ACIK kalir', async () => {
        const { captured } = await renderHome({
            account: { ...VARSAYILAN_HESAP, type: 'imported' },
        })

        expect(captured.instance.setupState.stocksAvailable).toBe(true)
        expect(captured.instance.setupState.gorunenSekme).toBe('stocks')
    })

    // FAIL-OPEN: kaydin TIPI COZULEMIYORSA (accountKindsOf null doner) sekme
    // KAYBOLMAMALI. Iki ayri durum ayni yoldan geciyor: hesap henuz
    // yuklenmemisken (activeAccount null) ve `type` alani taniyamadigimiz bir
    // deger oldugunda. Ikisi de gizlenirse sekme her acilista titrerdi ya da
    // gecerli bir kayitla gelen kullanici sessizce kilitlenirdi.
    it('TIPI COZULEMEYEN hesapta sekme GIZLENMEZ (fail-open)', async () => {
        const { captured } = await renderHome({
            account: { ...VARSAYILAN_HESAP, type: 'boyle-bir-tip-yok' },
        })
        expect(captured.instance.setupState.stocksAvailable).toBe(true)
    })

    it('hesap HENUZ YUKLENMEMISKEN sekme GIZLENMEZ (fail-open)', async () => {
        const { captured } = await renderHome({ account: VARSAYILAN_HESAP })

        // `type` alani HIC YOK -- accountKindsOf null doner, tipki activeAccount
        // null iken oldugu gibi.
        expect(VARSAYILAN_HESAP.type).toBeUndefined()
        expect(captured.instance.setupState.stocksAvailable).toBe(true)
    })
})

// ------------------------------------------------------------------
// SEKME HAFIZASI. Ana ekran token detayindan geri donuldugunde YENIDEN MOUNT
// olur (App.vue <Transition mode="out-in">); bilesen ici bir `ref` her donuste
// 'assets'e sifirlanirdi ve Hisseler'den bir hisseye girip geri donen kullanici
// kendini Varliklar'da bulurdu.
describe('Home.vue (SSR) -- sekme hafizasi', () => {
    it('sekmeSec ile secilen sekme AYNI pinia icinde SONRAKI mount ta korunur', async () => {
        // `sekme: null` -> harness activeTab'i YAZMAZ, yani olculen sey yalnizca
        // hatirlanan degerdir.
        const ilk = await renderHome({ sekme: null })
        expect(ilk.captured.instance.setupState.activeTab).toBe('assets')

        ilk.captured.instance.setupState.sekmeSec('stocks')

        // AYNI pinia: home -> token -> home dolasiminin karsiligi.
        const ikinci = await renderHome({ sekme: null, pinia: ilk.pinia })
        expect(ikinci.captured.instance.setupState.activeTab).toBe('stocks')
    })

    it('TAZE pinia da varsayilan sekme assets -- hafiza oturum disina TASMAZ', async () => {
        const { captured } = await renderHome({ sekme: null })
        expect(captured.instance.setupState.activeTab).toBe('assets')
    })

    it('sekmeSec depoyu da yazar (bilesen ici ref TEK BASINA yetmez)', async () => {
        const { captured, pinia } = await renderHome({ sekme: null })

        captured.instance.setupState.sekmeSec('activity')

        expect(pageStore(pinia).homeTab).toBe('activity')
    })
})

// ------------------------------------------------------------------
// FIYAT KAYNAGI SATIRI (spec 7). "Fiyat: Atlas Oracle" YALNIZCA en az bir
// satir Atlas'tan son 10 dakikada yazilmissa gorunur. Sunucu bayragi
// kapaliyken belgelerde alan hic yok (bugunku uretim); bayrak kapatilirsa
// `price_source` 'atlas' kalir ama zaman eskir.
describe('Home.vue (SSR) -- Hisseler fiyat kaynagi satiri', () => {
    const DAKIKA = 60 * 1000
    const googlbKaydi = (ek = {}) => ({
        coingecko_id: GOOGLB_ID,
        market_data: { priceUSD: 231.45, change: { h24: -1.23 } },
        ...ek,
    })
    const fiyatlariVer = (tokens) => {
        axiosPostMock.mockImplementation(async (url, body) => {
            if (String(url).includes('/getTokensDataById') && body?.ids?.includes(GOOGLB_ID)) {
                return { status: 200, data: { tokens } }
            }
            return { status: 200, data: { tokens: [] } }
        })
    }
    // SSR ciktisi sablon yorumlarini tasir: yokluk iddiasi yorumdaki bir
    // ornek metne takilmasin diye once temizlenir.
    const yorumsuzHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

    it('Atlas tan TAZE yazilmis bir satir varsa satir ihracci notunun USTUNDE gorunur', async () => {
        fiyatlariVer([googlbKaydi({ price_source: 'atlas', price_updated_at: new Date(Date.now() - DAKIKA).toISOString() })])

        const { html, captured } = await renderHome()
        const govde = yorumsuzHtml(html)

        expect(captured.instance.setupState.stocksAtlasPriced).toBe(true)
        // Yer de kilitli: Hisseler bolumunun altindaki not blogunda, ihracci
        // satirinin hemen onunde.
        expect(govde).toMatch(/Price: Atlas Oracle<\/p>\s*<p>Issuer: BTech/)
    })

    it('TR metni ceviriden gelir (sabit kodlanmadi)', async () => {
        fiyatlariVer([googlbKaydi({ price_source: 'atlas', price_updated_at: new Date(Date.now() - DAKIKA).toISOString() })])

        const { html } = await renderHome({ locale: 'tr' })

        expect(yorumsuzHtml(html)).toContain('Fiyat: Atlas Oracle')
    })

    // Uc YOKLUK testi de fiyatin EKRANA geldigini ayrica dogrular: aksi halde
    // "veri hic gelmedi" durumu da satiri gizler ve test yanlis sebeple yesil kalir.
    it('CoinGecko kaynakli kayitta satir YOK', async () => {
        fiyatlariVer([googlbKaydi({ price_source: 'coingecko', price_updated_at: new Date(Date.now() - DAKIKA).toISOString() })])

        const { html, captured } = await renderHome()
        const govde = yorumsuzHtml(html)

        expect(govde).toContain('$231.45')
        expect(captured.instance.setupState.stocksAtlasPriced).toBe(false)
        expect(govde).not.toContain('Price: Atlas Oracle')
        expect(govde).toContain('certificates over shares')
    })

    it('Atlas ama 10 dakikadan ESKI kayitta satir YOK (poller durmus)', async () => {
        fiyatlariVer([googlbKaydi({ price_source: 'atlas', price_updated_at: new Date(Date.now() - 11 * DAKIKA).toISOString() })])

        const { html, captured } = await renderHome()
        const govde = yorumsuzHtml(html)

        expect(govde).toContain('$231.45')
        expect(captured.instance.setupState.stocksAtlasPriced).toBe(false)
        expect(govde).not.toContain('Price: Atlas Oracle')
    })

    it('sunucu alanlari HIC yoksa (bayrak kapali) satir YOK', async () => {
        fiyatlariVer([googlbKaydi()])

        const { html, captured } = await renderHome()
        const govde = yorumsuzHtml(html)

        expect(govde).toContain('$231.45')
        expect(captured.instance.setupState.stocksAtlasPriced).toBe(false)
        expect(govde).not.toContain('Price: Atlas Oracle')
    })
})

// ------------------------------------------------------------------
// 60 SN'LIK FIYAT TAZELEMESI (spec 7). Sekme acikken YALNIZCA fiyat yeniden
// istenir; bakiyeler DEGIL (22 token x getCode+balanceOfUI+decimals tek
// public BSC ucuna gider).
//
// Yalnizca setInterval/clearInterval sahte: firstLoadGate'in setTimeout'u ve
// Date gercek kalir (Atlas etiketi testinde Date de bilerek sahtelenir). Ana
// ekranin 10 sn'lik bakiye dongusu de ayni sahte saatle doner -- asagidaki
// sayaclar iki istegi bu yuzden AYIRT EDER: hisse istegi KATALOGUN TAMAMINI
// sorar, bakiye turunun fiyat istegi yalnizca kovadaki kimlikleri (burada tek
// hisse, CRCLB).
//
// Tazelemeyi sekmeye baglayan izleyici `flush: 'sync'`: Vue SSR onu render
// SURESINCE canli tutar ve render bitince durdurur. Asagidaki testler bu
// yuzden sekme ve hesap degisimlerini render ICINDE (harness'in onCapture'i ve
// Home'un kendi onMounted'i) yapar; render'dan sonra setupState'e yazilan bir
// sekme izleyiciye ULASMAZ. O yol utils/stocksRefresh.test.js'te.
describe('Home.vue (SSR) -- Hisseler fiyat tazelemesi (60 sn)', () => {
    const GOOGLB = BSTOCKS.find((s) => s.symbol === 'GOOGLB')
    const TON_HESABI = { address: 'UQTest000000000000000000000000000000000000000', key: 'acc-ton', type: 'ton' }
    const hisseFiyatIstekleri = () => axiosPostMock.mock.calls.filter(([url, body]) =>
        String(url).includes('/getTokensDataById') && body?.ids?.length === BSTOCKS.length)
    // GOOGLB kovada YOK: bakiyesini yalnizca sekmenin katalog taramasi okur.
    const googlbBakiyeOkumalari = () =>
        useTokenBalanceMock.mock.calls.filter(([, adres]) => adres === GOOGLB.address).length

    afterEach(() => {
        vi.useRealTimers()
    })

    it('sekme acikken fiyat 60 sn de bir YENIDEN istenir, bakiye OKUNMAZ', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
        const { captured } = await renderHome()
        const state = captured.instance.setupState

        expect(state.stocksRefresher.isRunning()).toBe(true)
        // Sekme acilisinin kendi yuklemesi: bir fiyat istegi + katalog bakiye taramasi.
        expect(hisseFiyatIstekleri().length).toBe(1)
        expect(googlbBakiyeOkumalari()).toBe(1)

        await vi.advanceTimersByTimeAsync(59999)
        expect(hisseFiyatIstekleri().length).toBe(1)

        await vi.advanceTimersByTimeAsync(1)
        expect(hisseFiyatIstekleri().length).toBe(2)

        await vi.advanceTimersByTimeAsync(60000)
        expect(hisseFiyatIstekleri().length).toBe(3)
        // Iki tazeleme turu gecti: katalog bakiyesi HIC yeniden okunmadi.
        expect(googlbBakiyeOkumalari()).toBe(1)

        state.stocksRefresher.stop()
    })

    it('tazelenen fiyat satira ULASIR', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
        let tur = 0
        axiosPostMock.mockImplementation(async (url, body) => {
            if (String(url).includes('/getTokensDataById') && body?.ids?.length === BSTOCKS.length) {
                tur++
                const priceUSD = tur === 1 ? 231.45 : 240.1
                return { status: 200, data: { tokens: [{ coingecko_id: GOOGLB.coingecko_id, market_data: { priceUSD, change: { h24: 0.5 } } }] } }
            }
            return { status: 200, data: { tokens: [] } }
        })

        const { captured } = await renderHome()
        const state = captured.instance.setupState
        expect(state.bStockFiyatMetni(GOOGLB)).toBe('$231.45')

        await vi.advanceTimersByTimeAsync(60000)
        expect(state.bStockFiyatMetni(GOOGLB)).toBe('$240.10')

        state.stocksRefresher.stop()
    })

    it('Varliklar sekmesinde tazeleme KURULMAZ', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
        const { captured } = await renderHome({ sekme: 'assets' })

        expect(captured.instance.setupState.stocksRefresher.isRunning()).toBe(false)
        await vi.advanceTimersByTimeAsync(120000)
        expect(hisseFiyatIstekleri().length).toBe(0)
    })

    // HESAP KAPISI, TIKLAMASIZ. Hatirlanan sekme 'stocks' ve hesap TON'a
    // kilitli: kurulumda hesap henuz bilinmedigi icin kapi fail-open ve panel
    // 'stocks' sayilir, tazeleme KURULUR. Hesap Home'un kendi onMounted'inda
    // yuklenince panel Varliklar'a duser -- `activeTab` hala 'stocks', kimse
    // sekmeye basmadi -- ve tazeleme DURMALI.
    it('hesap kapisi paneli TIKLAMASIZ gizleyince tazeleme DURUR', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
        const kurulan = vi.spyOn(globalThis, 'setInterval')
        try {
            const { captured } = await renderHome({ account: TON_HESABI })
            const state = captured.instance.setupState

            // Kuruldu: 60 sn'lik TEK zamanlayici (digeri 10 sn'lik bakiye dongusu).
            expect(kurulan.mock.calls.filter(([, ms]) => ms === 60000)).toHaveLength(1)
            // ...ve hesap yuklenince durdu.
            expect(state.activeTab).toBe('stocks')
            expect(state.gorunenSekme).toBe('assets')
            expect(state.stocksRefresher.isRunning()).toBe(false)

            const once = hisseFiyatIstekleri().length
            await vi.advanceTimersByTimeAsync(180000)
            expect(hisseFiyatIstekleri().length).toBe(once)
        } finally {
            kurulan.mockRestore()
        }
    })

    // SOKULME VE GERI DONUS. Hisse satirina basmak Home'u SOKER (App.vue
    // `:key="page.currentPage"`), geri donus onu AYNI pinia ile yeniden kurar ve
    // sekme depodan 'stocks' gelir. Vue unmount'ta bilesenin effect kapsamini
    // durdurur (unmountComponent -> `instance.scope.stop()`); SSR'da sokulme
    // olmadigi icin AYNI adim elle atilir.
    it('hisse detayina gecis (sokulme) tazelemeyi DURDURUR, geri donus YENIDEN baslatir', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
        const pinia = createTestPinia()
        pageStore(pinia).homeTab = 'stocks'

        const ilk = await renderHome({ sekme: null, pinia })
        const ilkTazeleme = ilk.captured.instance.setupState.stocksRefresher
        expect(ilkTazeleme.isRunning()).toBe(true)

        ilk.captured.instance.setupState.openStock(GOOGLB)
        expect(pageStore(pinia).currentPage).toBe('token')
        ilk.captured.instance.scope.stop()
        expect(ilkTazeleme.isRunning()).toBe(false)

        const sokulmede = hisseFiyatIstekleri().length
        await vi.advanceTimersByTimeAsync(120000)
        expect(hisseFiyatIstekleri().length).toBe(sokulmede)

        // Geri donus: sekmeye TIKLANMADAN, kurulum aninda baslar.
        const ikinci = await renderHome({ sekme: null, pinia })
        const ikinciTazeleme = ikinci.captured.instance.setupState.stocksRefresher
        expect(ikinciTazeleme).not.toBe(ilkTazeleme)
        expect(ikinciTazeleme.isRunning()).toBe(true)

        // Acilisin kendi yuklemesi (onMounted -> loadBStockData) bir istek...
        const acilista = hisseFiyatIstekleri().length
        expect(acilista).toBe(sokulmede + 1)
        // ...60 sn sonra TEK tazeleme: sokulmus bilesenin zamanlayicisi olu.
        await vi.advanceTimersByTimeAsync(60000)
        expect(hisseFiyatIstekleri().length).toBe(acilista + 1)

        ikinciTazeleme.stop()
    })

    // Istek dusse de kontrol ani ilerler: eldeki Atlas fiyati 10 dakikayi
    // gecince "Price: Atlas Oracle" kendiliginden kalkar. Date de sahte --
    // 10 dakika gercekten gecsin.
    it('fiyat istegi DUSMEYE baslarsa Atlas satiri 10 dakika sonra kalkar', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
        const yazildi = new Date(Date.now() - 60 * 1000).toISOString()
        let tur = 0
        axiosPostMock.mockImplementation(async (url, body) => {
            if (String(url).includes('/getTokensDataById') && body?.ids?.length === BSTOCKS.length) {
                tur++
                if (tur > 1) throw new Error('ag yok')
                return {
                    status: 200,
                    data: {
                        tokens: [{
                            coingecko_id: GOOGLB.coingecko_id,
                            market_data: { priceUSD: 231.45, change: { h24: 0.5 } },
                            price_source: 'atlas',
                            price_updated_at: yazildi,
                        }],
                    },
                }
            }
            return { status: 200, data: { tokens: [] } }
        })

        try {
            const { captured } = await renderHome()
            const state = captured.instance.setupState
            expect(state.stocksAtlasPriced).toBe(true)

            // 8 dakika: kayit 9 dakikalik, hala taze.
            await vi.advanceTimersByTimeAsync(8 * 60 * 1000)
            expect(state.stocksAtlasPriced).toBe(true)

            // 10 dakika: kayit 11 dakikalik. Fiyat EKRANDA KALIR, etiket kalkar.
            await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
            expect(state.stocksAtlasPriced).toBe(false)
            expect(state.bStockFiyatMetni(GOOGLB)).toBe('$231.45')

            state.stocksRefresher.stop()
        } finally {
            hata.mockRestore()
        }
    })
})

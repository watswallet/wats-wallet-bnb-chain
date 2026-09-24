// GLOBAL AG ANAHTARI (Task 16a, Madde 1) -- bilesenler GERCEKTEN render edilerek
// olculur (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN: cuzdanin hic global ag anahtari YOKTU. `popups.network_popup = true`
// yazan TEK satir Swap ekraninin icindeki ChangeNetwork'tu (Swap.vue:43) ve o
// ekranin listesi -- dogru bir sebeple -- Solana'yi disliyor. Sonuc: Solana
// desteginin tamami (bakiye, gonderim, gecmis) arayuzden ERISILEMEZ durumdaydi.
//
// GUNCELLEME (Task 16c -- iki ag secici TEK kontrolde birlestirildi):
// global ag anahtari ARTIK Header'da DEGIL. Ana ekranda gorsel olarak neredeyse
// ayni IKI acilir menu vardi (baslikta ChangeNetwork = aktif ag, hemen altinda
// NetworkScopePill = yalnizca liste filtresi) ve kullanici hangisinin ne yaptigini
// ayirt edemedi. Anahtar Home.vue'deki pill'e (`switches-network`) TASINDI.
//
// Bu dosyanin ILK blogu SILINMEDI, YENI KONUMU olcecek sekilde YENIDEN YAZILDI:
// ayni bes soru (anahtar var mi / Solana'da da var mi / EVM kapilari kapaliyken
// de var mi / hangi agda oldugu okunabiliyor mu / dapp modunda YOK mu) artik
// Home uzerinden soruluyor. Anahtarin KENDI secim davranisi (applyNetworkChange'e
// giden yol) NetworkScopePill.ssr.test.js'te kilitli.
//
// Bu dosya kalan halkalari da ayri ayri kilitler:
//   ChangeNetwork (chip) -> networksPopup (liste)
// ve AYNI popup'in Swap kopyasinin Solana'yi listelemeye BASLAMADIGINI da olcer:
// tek prop iki davranisi tasiyor, ikisi de kanitlanmali.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Home.vue'nun veri yollari bu dosyanin konusu DEGIL (bkz. Home.ssr.test.js /
// homeSolanaWiring.test.js): ikisi de sabit/bos donecek sekilde saplanir ki test
// yalnizca AG ANAHTARININ VARLIGINA ve KABLOLAMASINA baksin.
const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))

const axiosPostMock = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))

// Header.vue -> utils/dappFunctions.js zinciri (FIX 5, isEvmDappAddress ithali)
// MODUL UST DUZEYINDE chrome.windows.onRemoved.addListener cagirir; o satir
// import ANINDA calisir, installChromeStub ise ancak test govdesinde.
// vi.hoisted olmadan asagidaki `import Header from './Header.vue'` "chrome is
// not defined" ile patlar (ayni tuzak: ConnectDapp.ssr.test.js, Header.ssr.test.js).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { popupStore } from '../store/popup'
import { pageStore } from '../store/pageStore'
import Header from './Header.vue'
import Home from './Home.vue'
import ChangeNetwork from './ChangeNetwork.vue'
import NetworksPopup from './popups/networksPopup.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA_CHAIN_ID = 'solana-mainnet'
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === SOLANA_CHAIN_ID)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const POLYGON_CHAIN = supported_chains.find((c) => c.chainId === 137)

// Header disari-tiklama dinleyicisi kuruyor; bu ortamda DOM yok.
beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    axiosPostMock.mockClear()
    useSolanaAssetsMock.mockClear()
    delete globalThis.chrome
})

/**
 * ANA EKRANI (Home -> Header + NetworkScopePill) GERCEKTEN render eder.
 * `openMenu`: pill'in acilir menusu `v-if="open"` -- acilmadan hicbir satir ve
 * aktif zincir isareti render edilmez.
 */
function homeApp(chainRecord, { openMenu = false } = {}) {
    installChromeStub({
        currentNetwork: chainRecord,
        active_account: {
            address: '0xAbCdEf0000000000000000000000000000000001',
            solanaAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
            key: 'acc1',
        },
        imported_tokens: {},
        user: { username: 'tester' },
        vaults: [],
        dapps: {},
    })
    globalThis.chrome.tabs = { query: async () => [{ url: 'https://example.com' }] }

    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord
    pageStore().currentPage = 'home'

    const pill = captureInstance(app, 'NetworkScopePill', openMenu
        ? (instance) => { instance.setupState.open = true }
        : undefined)

    return { app, pill }
}

/**
 * Acilir menudeki TEK BIR SATIRIN html'i. Satir bazli olmayan bir
 * `toContain(">active<")` iddiasi menudeki HERHANGI bir satirdan saglanir:
 * olculdu ki isaretin polaritesi ters cevrilince (rozet AKTIF OLMAYAN 10 satira
 * kayinca) suite YESIL kaliyordu -- yani kullaniciya tam TERSINI gosteren bir
 * arayuz testten geciyordu.
 */
function menuRow(html, chainName) {
    const marker = '<span class="truncate">' + chainName + '</span>'
    return html.split('<button').find((part) => part.includes(marker)) || ''
}

/**
 * Ekranda GERCEKTEN OKUNAN metin: etiketler (dolayisiyla TUM OZNITELIKLER) atilir.
 * `title="Ethereum"` bir fare-ustu ipucusudur ve ana ekrani okunur KILMAZ --
 * ustelik Header'in dekoratif 4 logoluk yigini (popularChains) her EVM zincirinde
 * AYNI `title="Ethereum"`u basar, yani oznitelikler uzerinden yapilan bir iddia
 * aktif agla hic ilgisi olmadan gecerdi.
 */
const visibleText = (html) => html.replace(/<[^>]*>/g, ' ')

function headerApp(chainRecord, { dappMode = false } = {}) {
    installChromeStub({
        currentNetwork: chainRecord,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', type: 'hd' },
        user: { username: 'tester' },
        vaults: [],
        dapps: {},
    })
    globalThis.chrome.tabs = { query: async () => [{ url: 'https://example.com' }] }

    const app = createApp(Header, { props: { dappMode } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord

    // SAYFA ACIKCA 'home' (kod incelemesi, Bulgu C). Onceden hic ayarlanmiyordu ve
    // pageStore varsayilani '' idi: eski `v-if="!['home'].includes(page.currentPage)"`
    // kosulu '' icin ZATEN true donuyordu, yani "ad gorunuyor" testleri DUZELTMEDEN
    // ONCE de gecerdi (olculdu: ChangeNetwork.vue@01658f9 ile 12/12 yesil). Header
    // GERCEKTE yalnizca Home.vue'de render ediliyor; test o gercegi kurmali.
    pageStore().currentPage = 'home'

    return app
}

describe('ana ekranda GLOBAL ag anahtari VAR -- Header den Home un kapsam pill ine TASINDI', () => {
    it('anahtar NetworkScopePill dir ve switchesNetwork=true ile gelir', async () => {
        const { app, pill } = homeApp(ETH_CHAIN)
        const chip = captureInstance(app, 'ChangeNetwork')
        await render(app)

        expect(pill.instance).not.toBeNull()
        // Prop'un DEGERI onemli: `switchesNetwork` olmadan bu pill yalnizca liste
        // filtresidir -- dugme var ama aktif agi DEGISTIRMEZ.
        expect(pill.instance.props.switchesNetwork).toBe(true)

        // BIRLESTIRMENIN KENDISI: ana ekranda ARTIK ikinci bir ag menusu YOK.
        // (Bu iddia dusmeden Header'a bir chip geri konamaz -- kullanicinin
        // bildirdigi "birbirinin ayni iki menu" hatasi tam olarak buydu.)
        expect(chip.instance).toBeNull()
    })

    it('Solana AKTIFKEN de gorunur ve listesinde Solana VAR (geri donus yolu)', async () => {
        const { app, pill } = homeApp(SOLANA_CHAIN, { openMenu: true })
        const chip = captureInstance(app, 'ChangeNetwork')
        const html = await render(app)

        expect(pill.instance).not.toBeNull()
        expect(pill.instance.props.switchesNetwork).toBe(true)
        expect(chip.instance).toBeNull()

        // Liste hem Solana'yi hem EVM zincirlerini tasir: Solana'ya GIRIS ve
        // Solana'dan CIKIS ayni menuden.
        expect(html).toContain('<span class="truncate">Solana</span>')
        expect(html).toContain('<span class="truncate">Ethereum</span>')
    })

    // ATS hapi ve dapp baglanti girisi Solana'da gizleniyor (Task 15). Ag
    // anahtari o kapiya BAGLANMAMALI: gizlendigi an Solana'dan cikis kalmaz.
    it('Solana da EVM ozellik kapilari kapaliyken anahtar acik kalir', async () => {
        const { app, pill } = homeApp(SOLANA_CHAIN, { openMenu: true })
        const header = captureInstance(app, 'Header')
        const html = await render(app)

        expect(header.instance.setupState.features.ats).toBe(false)
        expect(header.instance.setupState.features.dapp).toBe(false)
        expect(pill.instance).not.toBeNull()
        // Solana satiri GERCEKTEN listede (logo pill'in KENDI satirindan gelir --
        // Header'in cuzdan rozeti de ayni dosyayi basar, o yuzden satirin kendisi
        // aranir).
        expect(html).toContain('<span class="truncate">Solana</span>')
        expect(html).toContain('/chains/solana.svg')
    })

    // KOD INCELEMESI (Bulgu 6) ve birlestirmenin TEK gercek riski: agi DEGISTIREN
    // kontrol, hangi agda olundugunu da SOYLEMELI. Kapsam "Tum Aglar" iken pill'in
    // etiketi hicbir zincir adi tasimaz; cevap menudeki AKTIF ZINCIR ISARETIDIR.
    // ANA EKRANIN VARSAYILAN DURUMU -- menu ACILMADAN. Bu, eski testin ATLADIGI
    // sorunun ta kendisiydi: iddia `openMenu: true` ile olculuyordu, yani "ad ana
    // ekranda gorunur" degil "ad ZORLA acilmis menude gorunur" kanitlaniyordu.
    // tokenScope OTURUM ICI ve her acilista 'all' oldugu icin kapali durum bir
    // kenar durum DEGIL, popup'in HER acilisidir.
    it('AKTIF AGIN adi menu ACILMADAN ana ekranda okunur (varsayilan durum)', async () => {
        const { app, pill } = homeApp(POLYGON_CHAIN)
        const html = await render(app)

        // Kapsam gercekten dokunulmamis: pill "Tum Aglar" gosteriyor.
        expect(pill.instance.props.modelValue).toBe('all')
        expect(pill.instance.setupState.open).toBe(false)
        // Menu kapali: hicbir satir yok.
        expect(html).not.toContain('<span class="truncate">Ethereum</span>')
        expect(html).not.toContain('>active<')

        // ...ve cuzdanin hangi zincirde IMZALADIGI yine de EKRANDA YAZIYOR.
        expect(visibleText(html)).toContain('Polygon')
    })

    it('ag ADI ana ekranda GORUNUR ve AKTIF zincir SATIRI isaretlenir (EVM)', async () => {
        const { app, pill } = homeApp(ETH_CHAIN, { openMenu: true })
        const html = await render(app)

        expect(pageStore().currentPage).toBe('home')
        expect(html).toContain('<span class="truncate">Ethereum</span>')

        const isActiveChain = pill.instance.setupState.isActiveChain
        expect(isActiveChain(1)).toBe(true)
        expect(isActiveChain(137)).toBe(false)

        // ISARET AKTIF SATIRDA -- ve BASKA HICBIR SATIRDA.
        expect(menuRow(html, 'Ethereum')).toContain('>active<')
        expect(menuRow(html, 'Polygon')).not.toContain('>active<')
        expect(menuRow(html, 'Solana')).not.toContain('>active<')
        // HAM ANAHTAR EKRANDA GORUNMEZ.
        expect(html).not.toContain('common.activeNetwork')
    })

    it('ag ADI ana ekranda Solana da GORUNUR ve isaret Solana satirinda', async () => {
        const { app, pill } = homeApp(SOLANA_CHAIN, { openMenu: true })
        const html = await render(app)

        expect(pageStore().currentPage).toBe('home')
        expect(html).toContain('<span class="truncate">Solana</span>')
        // Tam ad kirpilsa bile `title` ile okunabilir kalir.
        expect(html).toContain('title="Solana"')

        const isActiveChain = pill.instance.setupState.isActiveChain
        expect(isActiveChain(SOLANA_CHAIN_ID)).toBe(true)
        expect(isActiveChain(1)).toBe(false)

        expect(menuRow(html, 'Solana')).toContain('>active<')
        expect(menuRow(html, 'Ethereum')).not.toContain('>active<')
    })

    // Dapp modundaki rozet SALT OKUNUR: aktif zinciri orada dapp belirler.
    // Header'in dappMode dali Home'dan BAGIMSIZ render edilebilir; orada HICBIR
    // ag anahtari (ne eski chip, ne yeni pill) bulunmamali.
    it('dapp modunda Header HICBIR ag anahtari render ETMEZ (rozet salt okunur)', async () => {
        const app = headerApp(ETH_CHAIN, { dappMode: true })
        const chip = captureInstance(app, 'ChangeNetwork')
        const pill = captureInstance(app, 'NetworkScopePill')
        const html = await render(app)

        expect(chip.instance).toBeNull()
        expect(pill.instance).toBeNull()
        // Rozet YERINDE: ag adi okunur, ama degistirilemez.
        expect(html).toContain('Ethereum')
    })

    // Header artik normal modda da anahtar TASIMAZ; tasidigi seyler (ATS yakit
    // hapi, dapp baglanti girisi) yerinde kalir. Bu iddia olmadan "chip'i
    // kaldirdik" degisikligi Header'da SESSIZ bir bosluga donusebilirdi.
    it('normal modda da Header in KENDISI anahtar tasimaz (tek kontrol Home da)', async () => {
        const app = headerApp(ETH_CHAIN)
        const chip = captureInstance(app, 'ChangeNetwork')
        const pill = captureInstance(app, 'NetworkScopePill')
        const ats = captureInstance(app, 'AtsFuelPill')
        await render(app)

        expect(chip.instance).toBeNull()
        expect(pill.instance).toBeNull()
        expect(ats.instance).not.toBeNull()
    })
})

function changeNetworkApp(props = {}) {
    // Stub, networkStore()'dan ONCE: store olusur olusmaz fire-and-forget
    // initializeCurrentNetwork() chrome.storage'i okumaya calisir.
    installChromeStub({ currentNetwork: ETH_CHAIN })

    const app = createApp(ChangeNetwork, { props })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = ETH_CHAIN

    // Popup ancak bu bayrakla render edilir; kapaliyken alt bilesen hic olusmaz.
    popupStore().network_popup = true

    return app
}

describe('ChangeNetwork.vue (SSR) -- allVms popup a AKTARILIR', () => {
    it('allVms verilince popup Solana yi da listeler', async () => {
        const app = changeNetworkApp({ allVms: true })
        const popup = captureInstance(app, 'networksPopup')
        await render(app)

        expect(popup.instance.props.allVms).toBe(true)
        expect(popup.instance.setupState.filteredChains.map((c) => c.chainId)).toContain(SOLANA_CHAIN_ID)
    })

    // REGRESYON: Swap.vue chip'i prop VERMEDEN kullaniyor.
    it('prop VERILMEZSE (Swap in kullanimi) popup EVM de kalir', async () => {
        const app = changeNetworkApp()
        const popup = captureInstance(app, 'networksPopup')
        await render(app)

        expect(popup.instance.props.allVms).toBe(false)
        expect(popup.instance.setupState.filteredChains.map((c) => c.chainId)).not.toContain(SOLANA_CHAIN_ID)
    })
})

function popupApp(props = {}, currentNetwork = ETH_CHAIN) {
    installChromeStub({ currentNetwork })

    const app = createApp(NetworksPopup, { props })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = currentNetwork
    popupStore().network_popup = true

    return app
}

describe('popups/networksPopup.vue (SSR) -- allVms listeyi belirler', () => {
    it('allVms=true: DESTEKLENEN her zincir listelenir (Solana dahil)', async () => {
        const app = popupApp({ allVms: true })
        const captured = captureInstance(app, 'networksPopup')
        const html = await render(app)

        const ids = captured.instance.setupState.filteredChains.map((c) => c.chainId)
        expect(ids).toContain(SOLANA_CHAIN_ID)
        // EVM zincirleri KAYBOLMADI.
        expect(ids).toContain(1)
        expect(ids).toContain(137)
        expect(html).toContain('Solana')
    })

    it('arama kutusu Solana yi bulur (metin chainId arama filtresini bozmaz)', async () => {
        const app = popupApp({ allVms: true })
        const captured = captureInstance(app, 'networksPopup')
        await render(app)

        captured.instance.setupState.searchQuery = 'sol'
        const ids = captured.instance.setupState.filteredChains.map((c) => c.chainId)
        expect(ids).toEqual([SOLANA_CHAIN_ID])
    })

    // Aktif satirin isaretlenmesi ARTIK isSameChainId ile: duz `===` ayni zincirin
    // sayi ve metin yazimini (137 / '137') AYRI sayardi.
    it('aktif zincir isareti METIN yazimli EVM kimliginde de dogru (EVM regresyonu)', async () => {
        const app = popupApp({ allVms: true }, { ...POLYGON_CHAIN, chainId: '137' })
        const captured = captureInstance(app, 'networksPopup')
        await render(app)

        const isActiveChain = captured.instance.setupState.isActiveChain
        expect(isActiveChain(POLYGON_CHAIN)).toBe(true)
        expect(isActiveChain(ETH_CHAIN)).toBe(false)
    })

    it('Solana aktifken Solana satiri isaretli, EVM satirlari degil', async () => {
        const app = popupApp({ allVms: true }, SOLANA_CHAIN)
        const captured = captureInstance(app, 'networksPopup')
        await render(app)

        const isActiveChain = captured.instance.setupState.isActiveChain
        expect(isActiveChain(SOLANA_CHAIN)).toBe(true)
        expect(isActiveChain(ETH_CHAIN)).toBe(false)
    })
})

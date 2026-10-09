// Home.vue (SSR) -- import edilen cuzdanda VARSAYILAN TOKENLAR gelir.
//
// KULLANICI RAPORU: "yeni import edilen cuzdanda hicbir token import edilmis sekilde
// gelmiyor". Cumle ile import (ImportPhrases) yalniz GRAM gosteriyordu, ozel anahtar
// importu (ImportPrivate) HIC satir gostermiyordu.
//
// KOK NEDEN ZINCIRI (hepsi kodla dogrulandi):
//   1) Varsayilanlar (ETH+USDT / ATS+BNB) yalniz App.vue acilisinda tohumlaniyordu,
//      `!imported_tokens[hesap]` kapisiyla. Import ekranlari hic tohumlamiyor.
//   2) Home.loadCurrentTokens -> ensureTonNativeToken bos kovayi `{'-239':[GRAM]}` olarak
//      YARATIP DISKE yaziyor: kapi KALICI olarak kapaniyor.
//   3) Ozel anahtar hesabi (type 'imported') EVM-only: TON satiri accountSupportsChain
//      suzgecinde dusuyor, liste BOS kaliyor.
//   4) Yan panel varsayilan oldugundan (2026-09-12) Ekle > import > Home yolunda App
//      yeniden KURULMUYOR: acilis tohumu hic calismiyor.
//   5) imported_tokens HIC yokken (Forgot password / sifirlama) okuma TypeError atiyor,
//      catch listeyi [] yapiyor.
//
// DUZELTME: tek kural + tek yazici (utils/defaultTokenSeed.js), Home.loadCurrentTokens
// TON tohumundan ONCE cagirir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bu dosyanin konusu token LISTESI: Solana, EVM bakiye okumasi ve ag HERMETIK saplanir.
// Varsayilan satirlar EVM oldugu icin useTokenBalance + JsonRpcProvider saplanmazsa
// gercek bir RPC'ye gidilirdi.
const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))

const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} } }
})

const axiosPostMock = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
const axiosGetMock = vi.fn()
vi.mock('axios', () => ({
    default: {
        post: (...args) => axiosPostMock(...args),
        get: (...args) => axiosGetMock(...args),
    },
}))

// Home.vue <Header> icerir ve Header.vue -> utils/dappFunctions.js zinciri MODUL UST
// DUZEYINDE chrome.windows.onRemoved.addListener cagirir (bkz. Home.ssr.test.js).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { tokenScopeStore } from '../store/tokenScope'
import Home from './Home.vue'
import { resetDefaultTokenSeed, DEFAULT_TOKENS_RETRY_MS } from '../utils/defaultTokenSeed'
import { BSTOCKS } from '../data/bStocks'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

const img = { thumb: 't', small: 's', large: 'l' }
const ZERO = '0x0000000000000000000000000000000000000000'
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const ATS_ADDRESS = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'

// /getImportedTokens'in GERCEK satir bicimi (server/controllers/tokenController.js).
const ETH = { _id: 'e1', name: 'Ethereum', symbol: 'eth', address: ZERO, chain: 'ethereum', decimals: 18, coingecko_id: 'ethereum', image: img }
const USDT = { _id: 'e2', name: 'Tether', symbol: 'usdt', address: USDT_ADDRESS, chain: 'ethereum', decimals: 6, coingecko_id: 'tether', image: img }
const ATS = { _id: 'b1', name: 'Alltoscan', symbol: 'ats', address: ATS_ADDRESS, chain: 'binance-smart-chain', decimals: 18, coingecko_id: 'alltoscan', image: img }
const BNB = { _id: 'b2', name: 'BNB', symbol: 'bnb', address: ZERO, chain: 'binance-smart-chain', decimals: 18, coingecko_id: 'binancecoin', image: img }
const SERVER_DEFAULTS = { 1: [ETH, USDT], 56: [ATS, BNB] }

// Home.vue'nun TON tohumunun yazdigi GRAM satiri (utils/ton/tonTokenSeed.js).
const GRAM_KEY = '-239|0x0'
const DEFAULT_KEYS = [`1|${ZERO}`, `1|${USDT_ADDRESS}`, `56|${ATS_ADDRESS}`, `56|${ZERO}`]

// Sahip olunan hisse (bStock): bakiye BSC RPC'sinden gelir, kendi API'mizden DEGIL.
const OWNED_STOCK = BSTOCKS.find((stock) => stock.symbol === 'CRCLB')
const ownedStockBalances = async (_owner, tokenAddress) =>
    (String(tokenAddress).toLowerCase() === OWNED_STOCK.address.toLowerCase() ? 12.5 : 0)
const lower = (rows) => rows.map((row) => row.address.toLowerCase())
const GRAM_ROW = { name: 'GRAM', symbol: 'GRAM', address: '0x0', decimals: 9, coingecko_id: 'the-open-network', id: 'the-open-network' }

const T0 = Date.parse('2026-10-07T12:00:00.000Z')

// "Su sirada bir sey YAZILMADI" iddialari icin: bekleyen asenkron isler (22 sahte bakiye okumasi,
// hisse tohumu denemesi) bitsin diye kisa GERCEK bekleme.
const settle = () => new Promise((resolve) => setTimeout(resolve, 100))

const EVM_ADRES = '0xAbCdEf0000000000000000000000000000000001'
const IMPORTED_ACCOUNT = { address: EVM_ADRES, key: 'acc1', type: 'imported', name: 'Wats 2' }
const HD_ACCOUNT = { address: EVM_ADRES, key: 'acc1', type: 'hd', name: 'Hesap 1' }

const serverAnswers = () => {
    axiosGetMock.mockImplementation(async (url) => {
        if (String(url).endsWith('/getImportedTokens')) {
            return { status: 200, data: { success: true, importedTokens: SERVER_DEFAULTS } }
        }
        // NewsStrip'in GET /news'u ve diger her GET (bkz. Home.ssr.test.js notu).
        return { status: 200, data: { news: [] } }
    })
}

const defaultsCalls = () => axiosGetMock.mock.calls.filter(([url]) => String(url).endsWith('/getImportedTokens'))

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    // Basarisizlik onbellegi modul duzeyinde ve tum testler 'acc1' kullaniyor: sifirlanmazsa
    // onceki testin hatasi sonrakinin tohum istegini kesip sessizce yesil/kirmizi yapardi.
    resetDefaultTokenSeed()
    serverAnswers()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    axiosGetMock.mockReset()
    axiosPostMock.mockClear()
    useSolanaAssetsMock.mockClear()
    useTokenBalanceMock.mockReset()
    useTokenBalanceMock.mockImplementation(async () => 0)
    delete globalThis.chrome
})

/** Depoyu kurar (BIR KEZ) ve ayni depoyla Home'u istenildigi kadar yeniden render eder. */
function installStore(initial) {
    return installChromeStub({ currentNetwork: ETH_CHAIN, vaults: [], ...initial })
}

/**
 * Home'u render etmeye BASLAR ama beklemez: `rendering` bitene dek (ornegin tohum istegi
 * asiliyken) `captured.instance` uzerinden bilesenin ic durumuna erisilebilir.
 */
function startHome() {
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = ETH_CHAIN
    network.rpc = 'https://evm.example/rpc'
    // Capraz-zincir liste: HTML'de her satir gorunsun.
    tokenScopeStore().filter = 'all'

    const captured = captureInstance(app, 'Home')
    return { captured, rendering: render(app) }
}

async function mountHome() {
    const { captured, rendering } = startHome()
    const html = await rendering
    return { captured, html }
}

const rowKeys = (captured) => captured.instance.setupState.currentTokens.map((t) => `${t.chainId}|${t.address}`)

describe('Home.vue (SSR) -- import edilen cuzdanda varsayilan tokenlar', () => {
    // (a) KULLANICI RAPORU, ozel anahtar importu: eskiden SIFIR satir.
    it('ozel anahtarla import edilen (type imported) hesapta ETH, USDT, ATS ve BNB satirlari gelir', async () => {
        const { localStore } = installStore({ active_account: IMPORTED_ACCOUNT, imported_tokens: {} })

        const { captured, html } = await mountHome()

        expect(rowKeys(captured)).toEqual(DEFAULT_KEYS)
        for (const name of ['Ethereum', 'Tether', 'Alltoscan', 'BNB']) expect(html).toContain(`>${name}<`)

        const bucket = localStore.imported_tokens.acc1
        expect(bucket[1]).toEqual([ETH, USDT])
        expect(bucket[56]).toEqual([ATS, BNB])
        expect(defaultsCalls()).toHaveLength(1)
    })

    // (b) Cumle importu: eskiden yalniz GRAM. Hasarli kova iyilesir, GRAM KORUNUR.
    it("hd hesapta GRAM tohumuyla hasarli kova ({'-239':[GRAM]}) iyilesir ve GRAM KALIR", async () => {
        const gramRow = { name: 'GRAM', symbol: 'GRAM', address: '0x0', decimals: 9, coingecko_id: 'the-open-network', id: 'the-open-network' }
        const { localStore } = installStore({
            active_account: HD_ACCOUNT,
            imported_tokens: { acc1: { '-239': [gramRow] } },
        })

        const { captured } = await mountHome()

        expect(rowKeys(captured)).toEqual([...DEFAULT_KEYS, GRAM_KEY])
        const bucket = localStore.imported_tokens.acc1
        expect(bucket[1]).toEqual([ETH, USDT])
        expect(bucket[56]).toEqual([ATS, BNB])
        expect(bucket['-239']).toHaveLength(1)
        expect(bucket['-239'][0]).toEqual(expect.objectContaining({ address: '0x0' }))
    })

    it('hd hesapta HIC kova yokken (taze cumle importu) varsayilanlar + GRAM birlikte gelir', async () => {
        const { localStore } = installStore({ active_account: HD_ACCOUNT, imported_tokens: {} })

        const { captured } = await mountHome()

        expect(rowKeys(captured)).toEqual([...DEFAULT_KEYS, GRAM_KEY])
        expect(Object.keys(localStore.imported_tokens.acc1).sort()).toEqual(['-239', '1', '56'])
    })

    // (c) SAGLIKLI kova DOKUNULMAZ. Kullanici tum varsayilanlari silmis olabilir
    // (anahtarlar BOS dizi olarak kalir): bunu geri almak onun kasitli secimini ezerdi.
    it("saglikli kova ('1':[] ve '56':[]) icin AG ISTEGI YOK, varsayilanlar geri GELMEZ", async () => {
        const { localStore } = installStore({
            active_account: IMPORTED_ACCOUNT,
            imported_tokens: { acc1: { 1: [], 56: [] } },
        })

        const { captured } = await mountHome()

        expect(defaultsCalls()).toHaveLength(0)
        expect(rowKeys(captured)).toEqual([])
        expect(localStore.imported_tokens.acc1[1]).toEqual([])
        expect(localStore.imported_tokens.acc1[56]).toEqual([])
    })

    it('saglikli kovada kullanicinin kendi tokenlari OLDUGU GIBI kalir (ag istegi yok)', async () => {
        const userRows = [USDT]
        const { localStore } = installStore({
            active_account: IMPORTED_ACCOUNT,
            imported_tokens: { acc1: { 1: userRows } },
        })

        const { captured } = await mountHome()

        expect(defaultsCalls()).toHaveLength(0)
        expect(rowKeys(captured)).toEqual([`1|${USDT_ADDRESS}`])
        expect(localStore.imported_tokens.acc1[1]).toEqual(userRows)
        expect(localStore.imported_tokens.acc1[56]).toBeUndefined()
    })

    // (d) Sifirlama (Forgot password) sonrasi depoda `imported_tokens` HIC yok.
    it('imported_tokens depoda HIC yokken firlatmaz ve tohumlar', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const { localStore } = installStore({ active_account: IMPORTED_ACCOUNT })
        expect('imported_tokens' in localStore).toBe(false)

        const { captured } = await mountHome()

        // Eskiden TypeError -> catch -> liste []: "Token yukleme hatasi" sessizce yutuluyordu.
        const loadErrors = errorSpy.mock.calls.filter(([message]) => String(message).includes('Token y'))
        expect(loadErrors).toEqual([])
        expect(rowKeys(captured)).toEqual(DEFAULT_KEYS)
        expect(localStore.imported_tokens.acc1[1]).toEqual([ETH, USDT])
        expect(localStore.imported_tokens.acc1[56]).toEqual([ATS, BNB])
    })

    // (e) Sunucu ulasilamaz: ana ekran ACILIR, varsayilan YAZILMAZ. Kesintide her yukleme 8 sn
    // beklemesin diye 60 sn icinde ikinci yukleme aga CIKMAZ; sure dolunca ve sunucu duzelince iyilesir.
    it('sunucu ulasilamazsa firlatmaz ve varsayilan YAZMAZ; 60 sn dolunca sonraki yukleme iyilestirir', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(T0)
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        axiosGetMock.mockImplementation(async (url) => {
            if (String(url).endsWith('/getImportedTokens')) throw new Error('Network Error')
            return { status: 200, data: { news: [] } }
        })
        const { localStore } = installStore({ active_account: HD_ACCOUNT, imported_tokens: {} })

        const first = await mountHome()

        expect(defaultsCalls()).toHaveLength(1)
        const loadErrors = errorSpy.mock.calls.filter(([message]) => String(message).includes('Token y'))
        expect(loadErrors).toEqual([])
        // TON tohumu (mevcut davranis) yine calisir; varsayilan anahtarlar YOK.
        expect(rowKeys(first.captured)).toEqual([GRAM_KEY])
        expect(Object.keys(localStore.imported_tokens.acc1)).toEqual(['-239'])

        // Sunucu duzeldi AMA 60 sn dolmadi: ikinci yukleme aga CIKMAZ, ana ekran yine acilir.
        serverAnswers()
        vi.setSystemTime(T0 + DEFAULT_TOKENS_RETRY_MS - 1)
        const early = await mountHome()

        expect(defaultsCalls()).toHaveLength(1)
        expect(rowKeys(early.captured)).toEqual([GRAM_KEY])

        // Sure doldu: bir sonraki Home yuklemesi ayni depoyla iyilestirir.
        vi.setSystemTime(T0 + DEFAULT_TOKENS_RETRY_MS)
        const second = await mountHome()

        expect(defaultsCalls()).toHaveLength(2)
        expect(rowKeys(second.captured)).toEqual([...DEFAULT_KEYS, GRAM_KEY])
        expect(Object.keys(localStore.imported_tokens.acc1).sort()).toEqual(['-239', '1', '56'])
    })

    it('sunucu `{news: []}` bicimli (alakasiz) govde donerse YAZMAZ', async () => {
        axiosGetMock.mockImplementation(async () => ({ status: 200, data: { news: [] } }))
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { localStore } = installStore({ active_account: IMPORTED_ACCOUNT, imported_tokens: {} })

        const { captured } = await mountHome()

        expect(rowKeys(captured)).toEqual([])
        // Home'un TON tohumu kovayi yine yaratir (mevcut davranis) ama varsayilan YOK.
        expect(Object.keys(localStore.imported_tokens.acc1)).toEqual(['-239'])
    })

    // Bayat anlik goruntuden TUM haritayi yazmak baska hesaplari ezerdi.
    it('YALNIZ aktif hesabin kovasi yazilir; baska hesaplarin kovalari OLDUGU GIBI kalir', async () => {
        const other = { 1: [], 56: [ATS], 137: [{ ...USDT, address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' }] }
        const { localStore } = installStore({
            active_account: IMPORTED_ACCOUNT,
            imported_tokens: { acc2: other },
        })

        await mountHome()

        expect(localStore.imported_tokens.acc2).toEqual(other)
        expect(localStore.imported_tokens.acc1[1]).toEqual([ETH, USDT])
    })

    // Sunucu beklenirken (en fazla 8 sn) kullanici hesap degistirebilir. Liste, bekleme
    // oncesi okunan ESKI hesaptan degil, ANLIK aktif hesabin kovasindan kurulmali: aksi halde
    // yeni hesabin adresiyle eski hesabin satirlari okunurdu (yanlis bakiyeler).
    it('tohum istegi beklenirken hesap degisirse liste YENI aktif hesabin kovasindan kurulur', async () => {
        const hesapB = { address: '0xAbCdEf0000000000000000000000000000000002', key: 'acc2', type: 'imported', name: 'Wats 3' }
        let sunucuyuSerbestBirak
        axiosGetMock.mockImplementation(async (url) => {
            if (String(url).endsWith('/getImportedTokens')) {
                await new Promise((resolve) => { sunucuyuSerbestBirak = resolve })
                return { status: 200, data: { success: true, importedTokens: SERVER_DEFAULTS } }
            }
            return { status: 200, data: { news: [] } }
        })
        const { localStore } = installStore({
            active_account: IMPORTED_ACCOUNT,
            imported_tokens: { acc2: { 1: [USDT] } },
        })

        const mounted = mountHome()
        await vi.waitFor(() => expect(sunucuyuSerbestBirak).toBeDefined())
        localStore.active_account = hesapB
        sunucuyuSerbestBirak()
        const { captured } = await mounted

        expect(captured.instance.setupState.activeAccount.key).toBe('acc2')
        expect(rowKeys(captured)).toEqual([`1|${USDT_ADDRESS}`])
        // Bekleyen tohum yine ESKI hesabin kovasina yazildi (kendi isi bitti).
        expect(localStore.imported_tokens.acc1[1]).toEqual([ETH, USDT])
    })

    // ISTEMCI TESTI BOSLUGU (inceleme turu 2, madde 5): (d) yalniz sunucu BASARILIYKEN
    // depoda `imported_tokens` yoksa durumunu olcuyordu -- o yolda yardimci kovayi YAZDIGI icin
    // Home'un okumasi zaten tanimliydi. Sunucu BASARISIZKEN depo bos kalir ve Home'un kendi
    // `?.` null-guvenligi tek basina yetmek zorundadir: `?.` olmadan TypeError -> catch -> liste [].
    it('imported_tokens depoda HIC yokken VE sunucu ulasilamazken firlatmaz: mevcut olan (GRAM) listelenir', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        axiosGetMock.mockImplementation(async (url) => {
            if (String(url).endsWith('/getImportedTokens')) throw new Error('Network Error')
            return { status: 200, data: { news: [] } }
        })
        const { localStore } = installStore({ active_account: HD_ACCOUNT })
        expect('imported_tokens' in localStore).toBe(false)

        const { captured } = await mountHome()

        const loadErrors = errorSpy.mock.calls.filter(([message]) => String(message).includes('Token y'))
        expect(loadErrors).toEqual([])
        expect(defaultsCalls()).toHaveLength(1)
        expect(rowKeys(captured)).toEqual([GRAM_KEY])
        // Yalniz Home'un TON tohumu yazildi; varsayilan YOK.
        expect(Object.keys(localStore.imported_tokens.acc1)).toEqual(['-239'])
    })
})

// HISSE (bStock) TOHUMU VE VARSAYILANLAR (inceleme turu 2, madde 1).
//
// seedOwnedBStocks sahip olunan hisseyi imported_tokens[hesap]['56'] kovasina ekler. Bakiye BSC
// RPC'sinden gelir, kendi API'mizden DEGIL: varsayilan istegi basarisizken (ya da hala yoldayken)
// hasarli bir kovaya `'56': [hisse]` yazarsa `bucketNeedsDefaults` kovayi sonsuza dek "saglikli"
// sayar ve ETH/USDT/ATS/BNB HIC gelmez; yavas-ama-basarili durumda da "mevcut kazanir"
// birlestirmesi hisse-yalniz '56'yi korur, ATS/BNB kaybolur.
describe('Home.vue (SSR) -- hisse tohumu varsayilanlari BEKLER', () => {
    it('hasarli kova + sunucu kapali + sahip olunan hisse: kova \'56\' KAZANMAZ; sunucu duzelince varsayilanlar gelir, hisse ONDAN SONRA eklenir', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(T0)
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        useTokenBalanceMock.mockImplementation(ownedStockBalances)
        axiosGetMock.mockImplementation(async (url) => {
            if (String(url).endsWith('/getImportedTokens')) throw new Error('Network Error')
            return { status: 200, data: { news: [] } }
        })
        const { localStore } = installStore({
            active_account: IMPORTED_ACCOUNT,
            imported_tokens: { acc1: { '-239': [GRAM_ROW] } },
        })

        const first = await mountHome()
        await first.captured.instance.setupState.loadBStockData()

        // Hisse bakiyesi okundu (RPC calisiyor) ama kova varsayilan beklediginden '56' YARATILMADI.
        expect(Object.keys(localStore.imported_tokens.acc1)).toEqual(['-239'])

        // API duzeldi (60 sn doldu): sonraki yukleme varsayilanlari TAM yazar...
        vi.setSystemTime(T0 + DEFAULT_TOKENS_RETRY_MS)
        serverAnswers()
        const second = await mountHome()

        expect(lower(localStore.imported_tokens.acc1[56])).toEqual(lower([ATS, BNB]))
        expect(localStore.imported_tokens.acc1[1]).toEqual([ETH, USDT])

        // ...ve hisse ONDAN SONRA eklenir (varsayilanlarin yanina, yerine degil).
        await second.captured.instance.setupState.loadBStockData()
        expect(lower(localStore.imported_tokens.acc1[56])).toEqual(lower([ATS, BNB, OWNED_STOCK]))
    })

    it('hisse tohumu varsayilan istegi YOLDAYKEN zincir anahtari YARATMAZ: ATS/BNB sonra eksiksiz gelir', async () => {
        useTokenBalanceMock.mockImplementation(ownedStockBalances)
        let sunucuyuSerbestBirak
        axiosGetMock.mockImplementation(async (url) => {
            if (String(url).endsWith('/getImportedTokens')) {
                await new Promise((resolve) => { sunucuyuSerbestBirak = resolve })
                return { status: 200, data: { success: true, importedTokens: SERVER_DEFAULTS } }
            }
            return { status: 200, data: { news: [] } }
        })
        const { localStore } = installStore({
            active_account: IMPORTED_ACCOUNT,
            imported_tokens: { acc1: { '-239': [GRAM_ROW] } },
        })

        const { captured, rendering } = startHome()
        await vi.waitFor(() => expect(sunucuyuSerbestBirak).toBeDefined())
        // Hisse yuklemesi, varsayilan istegi hala yoldayken calisir. BEKLENMEZ: eski kodda hisse
        // tohumu '56' yazdiktan sonra ayni (asili) istegi bekleyip takilirdi.
        const stocks = captured.instance.setupState.loadBStockData()
        try {
            await settle()
            expect(Object.keys(localStore.imported_tokens.acc1)).toEqual(['-239'])
        } finally {
            // Iddia basarisiz olsa bile istek serbest birakilir: askida is testten sonra sizmasin.
            sunucuyuSerbestBirak()
            await Promise.all([rendering, stocks])
        }

        // Eskiden hisse-yalniz '56' yaratilmis ve "mevcut kazanir" birlestirmesi onu korumustu.
        expect(lower(localStore.imported_tokens.acc1[56])).toEqual(lower([ATS, BNB]))
        expect(localStore.imported_tokens.acc1[1]).toEqual([ETH, USDT])
    })
})

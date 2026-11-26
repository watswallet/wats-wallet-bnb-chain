// Home.vue (SSR) -- Hisseler sekmesinde LCX gruplari (Bolum 2, Gorev 9): satirlar depodan (hydrate) ve agdan (refresh) gelir,
// fiyat satirin kendi priceUsd'sidir (24 sa degisimi yok), bakiye zincirin Multicall3'uyle (balanceOf, carpan YOK), LCX satiri
// imported_tokens'a TOHUMLANMAZ. Bayrak kapaliyken (LCX_ENABLED) ve ozel modda depo okunmaz / /lcx/stocks istegi gitmez.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Interface, toBeHex } from 'ethers'
import { setActivePinia } from 'pinia'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// LCX bayragi bu dosyada testten surulur (getter: Home her okumada gunceli gorur). Varsayilan ACIK.
const flags = vi.hoisted(() => ({ lcx: true }))
vi.mock('../utils/featureFlags', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, get LCX_ENABLED() { return flags.lcx } }
})

// Dinamik satir katmaninin yukleyicileri: GERCEK uygulamaya delege eden casuslar (depo chrome.storage taklidinden, ag `fetch` taklidinden).
const lcxSpy = vi.hoisted(() => ({ actual: null, hydrate: null, refresh: null }))
vi.mock('../utils/lcx/stockRows', async (importOriginal) => {
    const actual = await importOriginal()
    lcxSpy.actual = actual
    return {
        ...actual,
        hydrateLcxStockRows: (...args) => lcxSpy.hydrate(...args),
        refreshLcxStockRows: (...args) => lcxSpy.refresh(...args),
    }
})

vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: async () => [] }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))

// Hisseler bakiyesi: GERCEK readStockBalances, ama Multicall3 saglayicisi taklit (RPC yok); hangi fonksiyonlarin sorulduguna bakilir.
const providerSpy = vi.hoisted(() => ({ provider: null }))
vi.mock('../utils/stockBalances', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        readStockBalances: (args) => actual.readStockBalances({ ...args, provider: providerSpy.provider(args.chainId) }),
        ensureMultipliersFor: async () => {},
    }
})

vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: async () => true }))

const axiosPostMock = vi.fn()
vi.mock('axios', () => ({
    default: {
        post: (...args) => axiosPostMock(...args),
        get: async () => ({ status: 200, data: { news: [] } }),
    },
}))

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import { privacyStore } from '../store/privacy'
import { disposeStockEligibilityStore } from '../composables/useStockEligibility'
import Home from './Home.vue'
import { MULTICALL3_ADDRESS } from '../utils/stockBalances'
import { XSTOCKS } from '../data/xStocks'
import { BSTOCKS } from '../data/bStocks'
import { LCX_STOCK_ROWS_KEY } from '../utils/lcx/stockRows'
import { _resetLcxStockRows, lcxStockRows } from '../utils/tokenizedStocks'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const HESAP = { address: '0xabcdef0000000000000000000000000000000001', key: 'acc1' }
const GIZLI = { address: '0x' + 'cd'.repeat(20), key: 'private-' + 'cd'.repeat(20), type: 'hd', private: true }
const E18 = 10n ** 18n
const OK = { decision: 'OK', reason: 'OK', ipCountry: null }
// Zorunlu iki ihracci + LCX ihraccilari: ssrRender varsayilani yalniz bstocks / xstocks verir ("karar yok" = kullanilamaz).
const ELIGIBILITY = { bstocks: OK, xstocks: OK, coinbase: OK, ondo: OK }
const TIRE = '—'

// Sunucunun /lcx/stocks satir bicimi (stockRows.test.js ile ayni): TSLAC Base'te 8 ondalikli, GMEON BSC'de bStocks GME ile ayni sirkette.
const TSLAC = {
    chainId: 8453, address: '0xb2000000000000000000001e800a7f5189430cD0', symbol: 'TSLAC', name: 'Tesla (Coinbase Tokenized Stocks)',
    decimals: 8, issuer: 'coinbase', underlying: 'TSLA', category: 'stocks', priceUsd: 364.74, priceSource: 'Chainlink Coinbase TSLA on Base',
    priceUpdatedAt: 1795071867, marketHours: 'us_equities', depthUsd: 252144.39,
}
const GMEON = {
    chainId: 56, address: '0xdABb9afF4cf02f26D2014e4cA9f94aC6fe6572a3', symbol: 'GMEON', name: 'GameStop (Ondo Tokenized Stock)',
    decimals: 18, issuer: 'ondo', underlying: 'GME', category: 'stocks', priceUsd: 27.02536498754133, priceSource: 'Chainlink GME / USD',
    priceUpdatedAt: 1795032524, marketHours: 'always', depthUsd: 42234.2,
}
const depoKaydi = (rows = [TSLAC, GMEON], over = {}) => ({
    fetchedAt: Date.now() - 30_000, asOf: Date.now() - 40_000, usEquitiesOpen: true, rows, ...over,
})

// --- Multicall3 taklidi -------------------------------------------------------------------------------------------------
const ERC20 = new Interface([
    'function balanceOf(address owner) view returns (uint256)',
    'function balanceOfUI(address owner) view returns (uint256)',
    'function getCurrentMultiplier() view returns (uint256)',
])
const MC = new Interface([
    'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
])
const word = (n) => toBeHex(n, 32)

let tablo = {} // `${zincir}:${adres kucuk harf}:${fonksiyon}` -> bigint
let cagrilar = [] // { chainId, to, calls: [{ target, fn }] }
const taklitSaglayici = (chainId) => ({
    async call({ to, data }) {
        const [subs] = MC.decodeFunctionData('aggregate3', data)
        const calls = subs.map((s) => ({ target: s[0].toLowerCase(), fn: ERC20.parseTransaction({ data: s[2] }).name }))
        cagrilar.push({ chainId, to, calls })
        const out = calls.map(({ target, fn }) => {
            const deger = tablo[`${chainId}:${target}:${fn}`]
            if (deger !== undefined) return [true, word(deger)]
            return [true, word(fn === 'getCurrentMultiplier' ? E18 : 0n)]
        })
        return MC.encodeFunctionResult('aggregate3', [out])
    },
})

// --- ag taklidi ---------------------------------------------------------------------------------------------------------
const fetchMock = vi.fn()
let fiyatlar = []

beforeEach(() => {
    flags.lcx = true
    tablo = {}
    cagrilar = []
    fiyatlar = []
    providerSpy.provider = taklitSaglayici
    _resetLcxStockRows()
    lcxSpy.hydrate = vi.fn((...args) => lcxSpy.actual.hydrateLcxStockRows(...args))
    lcxSpy.refresh = vi.fn((...args) => lcxSpy.actual.refreshLcxStockRows(...args))
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => { throw new Error('ag yok') })
    axiosPostMock.mockReset()
    axiosPostMock.mockImplementation(async () => ({ status: 200, data: { tokens: fiyatlar } }))
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
    _resetLcxStockRows()
    disposeStockEligibilityStore()
    delete globalThis.chrome
})

/**
 * Home.vue'yu activeTab ZATEN 'stocks' iken render eder (HomeXStocks.ssr.test.js ile ayni kalip). `depo`: lcx_stock_rows kaydi
 * (null = depo bos). Depoya yapilan her get cagrisinin anahtarlari `getKeys`'e yazilir.
 */
async function renderHome({ depo = depoKaydi(), account = HESAP, privateActive = false, importedTokens = {}, pinia, eligibility = ELIGIBILITY } = {}) {
    const store = { currentNetwork: ETH_CHAIN, active_account: account, imported_tokens: importedTokens, vaults: [] }
    if (depo !== null) store[LCX_STOCK_ROWS_KEY] = depo
    const stub = installChromeStub(store, { eligibility })
    const getKeys = []
    const realGet = globalThis.chrome.storage.local.get
    globalThis.chrome.storage.local.get = async (keys) => {
        getKeys.push(...(Array.isArray(keys) ? keys : [keys]))
        return realGet(keys)
    }

    const app = createApp(Home, { props: { embedded: false } })
    if (pinia) setActivePinia(pinia)
    app.use(pinia ?? createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = ETH_CHAIN
    privacyStore().active = privateActive

    const captured = captureInstance(app, 'Home', (instance) => {
        instance.setupState.activeTab = 'stocks'
        instance.setupState.stockChipChoice = 'all'
    })
    const html = await render(app)
    return { html, state: captured.instance.setupState, stub, getKeys }
}

// Sekme yukleyicisi (loadBStockData) onMounted'da BEKLENMEZ: SSR ciktisi yuklemeden ONCE uretilebilir. Yukleme sonuclarina (bakiye,
// tohum, yenilenen satirlar) bakan testler durumun oturmasini bekler; HTML yalniz yuklemeden bagimsiz iddialar icindir.
const bitir = (state) => vi.waitFor(() => expect(state.balancesLoaded).toBe(true), { timeout: 3000 })
// Sirket satirinin bakiye etiketi (durumdan): HTML bakiyesi yukleme sonrasi uretilmeyebilir.
const etiket = (state, chainId, ticker) => state.companyBalanceLabel(
    state.visibleStockGroups.find((g) => g.chainId === chainId).rows.find((c) => c.ticker === ticker),
)

// SSR ciktisi sablon yorumlarini tasir: metin aramadan once temizlenir.
const govdeOf = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
// data-row-key'i verilen satirin <button> govdesi ('8453:TSLA'); yoksa null.
const satirOf = (html, rowKey) => govdeOf(html).match(new RegExp(`<button[^>]*data-row-key="${rowKey}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0] ?? null
const lcxIstekleri = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/lcx/stocks'))
const fiyatIstekGovdeleri = () => axiosPostMock.mock.calls.filter(([url]) => String(url).endsWith('/getTokensDataById')).map(([, govde]) => govde)

describe('Home.vue (SSR) -- Hisseler: LCX gruplari (bayrak acik, normal mod)', () => {
    it('Test 1: acilista depo yuklenir (hydrate), SONRA refresh({ maxAgeMs: 60000 }); Base grubunda TSLAC fiyati $364.74', async () => {
        const { html, state } = await renderHome()

        expect(lcxSpy.hydrate).toHaveBeenCalled()
        expect(lcxSpy.refresh).toHaveBeenCalledWith(expect.objectContaining({ maxAgeMs: 60_000 }))
        // Depo ONCE: hydrate ilk cagrisi refresh ilk cagrisindan once.
        expect(lcxSpy.hydrate.mock.invocationCallOrder[0]).toBeLessThan(lcxSpy.refresh.mock.invocationCallOrder[0])

        expect(state.stockGroups.map((g) => g.chainId)).toEqual([1, 56, 42161, 8453])
        const base = state.visibleStockGroups.find((g) => g.chainId === 8453)
        expect(base.rows.map((c) => c.ticker)).toEqual(['TSLA'])
        const satir = satirOf(html, '8453:TSLA')
        expect(satir, 'Base TSLA satiri cizilmedi').not.toBeNull()
        expect(satir).toContain('$364.74')
        // 24 sa degisimi yok: yuzde satiri cizilmez (kirmizi / yesil "0.00%" uydurmasi yok).
        expect(satir).not.toContain('%')
        // Ag basligi: Base grubu kendi basligiyla.
        expect(govdeOf(html)).toContain('Base')
        // Fiyat yardimcilari: ayni deger.
        expect(state.bStockFiyatMetni(base.rows[0].options[0])).toBe('$364.74')
        expect(state.bStockMarketData(base.rows[0].options[0])).toBeNull()
    })

    it('Test 1b: 60 sn yenilemede (refreshStocks) refresh({ maxAgeMs: 60000 }) yeniden cagrilir; depo hydrate ile yeniden yuklenir', async () => {
        const { state } = await renderHome()
        lcxSpy.hydrate.mockClear()
        lcxSpy.refresh.mockClear()

        await state.refreshStocks()

        expect(lcxSpy.refresh).toHaveBeenCalledTimes(1)
        expect(lcxSpy.refresh).toHaveBeenCalledWith(expect.objectContaining({ maxAgeMs: 60_000 }))
        expect(lcxSpy.hydrate.mock.invocationCallOrder[0]).toBeLessThan(lcxSpy.refresh.mock.invocationCallOrder[0])
    })

    it('Test 1c: yenileme taze depodan satirlari getirir (ag yok); bayat depoda /lcx/stocks istenir ve yeni satir sekmeye girer', async () => {
        // Taze depo: fetchedAt 30 sn once -> 60 sn sinirinin icinde, ag YOK.
        await renderHome()
        expect(lcxIstekleri()).toHaveLength(0)
        expect(lcxStockRows().map((r) => r.symbol)).toEqual(['TSLAC', 'GMEON'])

        // Bayat depo (10 dk): ag istenir; yanit yeni bir satir icerir.
        _resetLcxStockRows()
        fetchMock.mockImplementation(async () => ({
            status: 200, ok: true,
            json: async () => ({ success: true, usEquitiesOpen: true, asOf: Date.now(), rows: [{ ...TSLAC, priceUsd: 371.5 }] }),
        }))
        const { state } = await renderHome({ depo: depoKaydi([TSLAC, GMEON], { fetchedAt: Date.now() - 600_000 }) })
        await bitir(state)

        expect(lcxIstekleri().length).toBeGreaterThan(0)
        expect(state.stockGroups.map((g) => g.chainId)).toEqual([1, 56, 42161, 8453])
        const base = state.visibleStockGroups.find((g) => g.chainId === 8453).rows[0]
        expect(state.bStockFiyatMetni(base.options[0])).toBe('$371.50')
        expect(lcxStockRows().map((r) => r.symbol)).toEqual(['TSLAC']) // yanitta GMEON yok: katman yanitla degisti
    })

    it('Test 2: fiyat istegi gövdesinde null yok (LCX satiri katalog kimligi tasimaz); kimlikler yalniz statik hisselerinki', async () => {
        const { state } = await renderHome()

        expect(state.stockGroups.some((g) => g.rows.some((r) => r.source === 'lcx'))).toBe(true)
        const govdeler = fiyatIstekGovdeleri()
        expect(govdeler.length).toBeGreaterThan(0)
        for (const govde of govdeler) {
            expect(govde.ids.every((id) => typeof id === 'string' && id !== ''), JSON.stringify(govde.ids.filter((id) => typeof id !== 'string'))).toBe(true)
            expect(govde.ids).toHaveLength(BSTOCKS.length + XSTOCKS.length)
        }
    })

    it('Test 3: Base grubu icin Multicall3 okumasi gider; 8 ondalikli balanceOf degeri dogru gosterilir; carpan cagrisi YOK', async () => {
        tablo[`8453:${TSLAC.address.toLowerCase()}:balanceOf`] = 250_000_001n // 2.50000001 TSLAC (8 ondalik)
        const { state } = await renderHome()
        await bitir(state)

        const base = cagrilar.filter((c) => c.chainId === 8453)
        expect(base).toHaveLength(1) // zincir basina TEK Multicall3
        expect(base[0].to).toBe(MULTICALL3_ADDRESS)
        expect(base[0].calls).toEqual([{ target: TSLAC.address.toLowerCase(), fn: 'balanceOf' }])
        expect(cagrilar.filter((c) => c.chainId === 8453).flatMap((c) => c.calls).some((c) => c.fn === 'getCurrentMultiplier')).toBe(false)
        // Diger zincirler de okunur (zincir basina tek cagri): LCX eklenmesi okumalari degistirmez.
        expect(cagrilar.map((c) => c.chainId).sort((a, b) => a - b)).toEqual([1, 56, 8453, 42161])

        expect(etiket(state, 8453, 'TSLA')).toBe('2.5000')
    })

    it('Test 3b: BSC satiri LCX GMEON bStocks GME ile ayni sirkette; bakiyesi balanceOf ile okunur ve toplama girer', async () => {
        const gme = BSTOCKS.find((b) => b.underlying === 'GME')
        tablo[`56:${gme.address.toLowerCase()}:balanceOfUI`] = E18
        tablo[`56:${GMEON.address.toLowerCase()}:balanceOf`] = 2n * E18
        const { state } = await renderHome()
        await bitir(state)

        const gmeSirketi = state.visibleStockGroups.find((g) => g.chainId === 56).rows.find((c) => c.underlying === 'GME')
        expect(gmeSirketi.options.map((o) => o.issuer)).toEqual(['bstocks', 'ondo'])
        expect(etiket(state, 56, 'GME')).toBe('3.0000')
        const bsc = cagrilar.find((c) => c.chainId === 56)
        expect(bsc.calls.find((c) => c.target === GMEON.address.toLowerCase()).fn).toBe('balanceOf')
    })

    it('Test 4: depo bos, fetch basarisiz -> bugunku gibi bStocks / xStocks gruplari; LCX grubu yok; hata bandi yok; yeniden denenir', async () => {
        const { html, state } = await renderHome({ depo: null })

        expect(lcxIstekleri().length).toBeGreaterThan(0) // gercekten denendi
        expect(await lcxSpy.refresh.mock.results[0].value).toEqual({ ok: false, count: 0, fetched: false })
        expect(lcxStockRows()).toEqual([])
        expect(state.stockGroups.map((g) => g.chainId)).toEqual([1, 56, 42161])
        expect(state.stockGroups.some((g) => g.rows.some((r) => r.source === 'lcx'))).toBe(false)
        expect(govdeOf(html)).not.toContain('data-stock-empty')
        expect(satirOf(html, '8453:TSLA')).toBeNull()

        // Bayrak kapaliyken ayni durumla BIREBIR ayni cikti (bugunku gorunum).
        flags.lcx = false
        _resetLcxStockRows()
        const kapali = await renderHome({ depo: null })
        expect(govdeOf(html)).toBe(govdeOf(kapali.html))

        // 60 sn sonra yeniden denenir: bir sonraki yenileme /lcx/stocks'u yine sorar.
        flags.lcx = true
        fetchMock.mockClear()
        await state.refreshStocks()
        expect(lcxIstekleri().length).toBeGreaterThan(0)
    })

    it('Test 7: LCX satiri imported_tokens a TOHUMLANMAZ; ayni durumda tutulan statik xStock tohumlanir (kontrol)', async () => {
        const mstr = XSTOCKS.find((s) => s.symbol === 'MSTRx')
        tablo[`8453:${TSLAC.address.toLowerCase()}:balanceOf`] = 5_000_000_000n // 50 TSLAC TUTULUYOR
        tablo[`1:${mstr.address.toLowerCase()}:balanceOf`] = E18

        // Saglikli kova ('1' ve '56' anahtarlari var): hasarli kovada tohum varsayilanlari BEKLER (bucketNeedsDefaults).
        const { stub, state } = await renderHome({ importedTokens: { acc1: { 1: [], 56: [] } } })
        await bitir(state)
        const kova = stub.localStore.imported_tokens.acc1

        // Kontrol: seed yolu bu ortamda gercekten calisiyor (statik xStock yazildi).
        expect(kova['1'].map((t) => t.symbol)).toEqual(['MSTRx'])
        // LCX: ne 8453 anahtari ne baska bir kova satiri.
        expect(kova['8453']).toBeUndefined()
        expect(Object.values(kova).flat().some((t) => String(t.address).toLowerCase() === TSLAC.address.toLowerCase())).toBe(false)
        // ... ama sekmede tutulan hisse olarak GORUNUR (bakiye okundu).
        expect(etiket(state, 8453, 'TSLA')).toBe('50.0000')
    })

    it('Test 8: openStock LCX satirinda selected_token_ref.id === null yazar (undefined degil); cuzdan agi degismez', async () => {
        const { state } = await renderHome()
        const company = state.visibleStockGroups.find((g) => g.chainId === 8453).rows[0]

        await state.openStock(company)

        expect(cryptoStore().selected_token_ref.id).toBeNull()
        expect(cryptoStore().selected_token_ref).toEqual({ id: null, chainId: 8453, address: TSLAC.address, decimals: 8, symbol: 'TSLAC' })
        expect(cryptoStore().selected_token_id).toBeNull()
        expect(pageStore().currentPage).toBe('token')
        expect(networkStore().currentNetwork.chainId).toBe(1)
    })

    it('coinbase icin karar yoksa (yanitta yok = kullanilamaz) LCX satiri listelenmez; statik satirlar kalir', async () => {
        const { html, state } = await renderHome({ eligibility: { bstocks: OK, xstocks: OK } })
        await bitir(state)

        expect(lcxStockRows().map((r) => r.symbol)).toEqual(['TSLAC', 'GMEON']) // katman yuklu (kimlik amacli)
        expect(state.stockGroups.map((g) => g.chainId)).toContain(8453) // katalog grubu var ...
        expect(state.listedGroups.map((g) => g.chainId)).toEqual([1, 56, 42161]) // ... ama liste (gosterim) suzulmus
        expect(satirOf(html, '8453:TSLA')).toBeNull()
        expect(govdeOf(html)).not.toContain('$364.74')
    })

    it('coinbase karari yok AMA satir TUTULUYORSA listelenir (K35: Sat / goruntuleme acik)', async () => {
        tablo[`8453:${TSLAC.address.toLowerCase()}:balanceOf`] = 100_000_000n // 1 TSLAC
        const { state } = await renderHome({ eligibility: { bstocks: OK, xstocks: OK } })
        await bitir(state)

        expect(state.listedGroups.map((g) => g.chainId)).toEqual([1, 56, 42161, 8453])
        expect(etiket(state, 8453, 'TSLA')).toBe('1.0000')
    })
})

describe('Home.vue (SSR) -- Hisseler: LCX gizli modda ve bayrak kapaliyken', () => {
    it('Test 5: gizli modda /lcx/stocks istegi YOK, refresh cagrilmaz, LCX satiri / Base grubu yok, hisse bakiye okumasi yok', async () => {
        const { html, state } = await renderHome({ account: GIZLI, privateActive: true })

        expect(lcxSpy.refresh).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(lcxIstekleri()).toEqual([])
        expect(state.gorunenSekme).toBe('assets')
        expect(state.stocksTabVisible).toBe(false)
        expect(state.stockGroups.map((g) => g.chainId)).toEqual([56]) // yalniz bStocks (bugunku gizli mod gruplari)
        expect(state.stockGroups.some((g) => g.rows.some((r) => r.source === 'lcx'))).toBe(false)
        expect(govdeOf(html)).not.toContain('TSLAC')
        expect(satirOf(html, '8453:TSLA')).toBeNull()
        expect(cagrilar).toEqual([])
    })

    it('Test 5b: Home bagliyken mod acilirsa LCX gruplari canli kapanir; sekmeye donuste yeniden tazeleme bayat-yenileme degil', async () => {
        const { state } = await renderHome()
        expect(state.stockGroups.map((g) => g.chainId)).toContain(8453)

        privacyStore().active = true

        expect(state.stockGroups.map((g) => g.chainId)).toEqual([56])
        expect(state.lcxOn).toBe(false)
        expect(state.stocksTabVisible).toBe(false)
    })

    it('Test 5c: ozel mod penceresi (store genel, depodaki hesap Gizli): yenileme LCX agina CIKMAZ', async () => {
        const { state, stub } = await renderHome()
        lcxSpy.refresh.mockClear()
        fetchMock.mockClear()

        stub.localStore.active_account = GIZLI
        expect(privacyStore().active).toBe(false)
        await state.refreshStocks()

        expect(lcxSpy.refresh).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('Test 6: bayrak kapali -> depo OKUNMAZ, hydrate / refresh cagrilmaz, /lcx/stocks yok, LCX satiri yok; cikti depo bos halinden ayirt edilemez', async () => {
        flags.lcx = false
        const { html, state, getKeys } = await renderHome()

        expect(getKeys).not.toContain(LCX_STOCK_ROWS_KEY)
        expect(lcxSpy.hydrate).not.toHaveBeenCalled()
        expect(lcxSpy.refresh).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(lcxStockRows()).toEqual([])
        expect(state.lcxOn).toBe(false)
        expect(state.stockGroups.map((g) => g.chainId)).toEqual([1, 56, 42161])
        expect(satirOf(html, '8453:TSLA')).toBeNull()

        // Elle yenileme (60 sn dongusu) da dokunmaz.
        await state.refreshStocks()
        expect(lcxSpy.refresh).not.toHaveBeenCalled()
        expect(getKeys).not.toContain(LCX_STOCK_ROWS_KEY)

        // Depo bos baska bir render ile ayni cikti.
        const bos = await renderHome({ depo: null })
        expect(govdeOf(html)).toBe(govdeOf(bos.html))
    })
})

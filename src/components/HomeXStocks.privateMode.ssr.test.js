// Home.vue (SSR) -- Hisseler sekmesi GIZLI MODDA: sekme HIC YOK (gizli-mod cok-ag spec 4.7, P13). xStocks (sahip karari
// 2026-10-16) ve bStocks (Dilim D) satirlari, ag basliklari ve rozetleri cizilmez; hicbir Hisseler zincirine (Ethereum,
// Arbitrum VE BSC) Gizli adresle bakiye sorusu ya da fiyat istegi GITMEZ. Hatirlanan sekme ('stocks') korunur, gorunen
// sekme Varliklar'a duser. Kalip HomeXStocks.ssr.test.js ile AYNI. 'vue' mock'u BURADA, dosyanin KENDISINDE olmak
// ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: async () => [] }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))

// Hisseler bakiyesi: zincir basina TEK Multicall3 (utils/stockBalances). Okuyucu testten kurulur.
const readStockBalancesMock = vi.fn()
vi.mock('../utils/stockBalances', async (importOriginal) => ({
    ...(await importOriginal()),
    readStockBalances: (...args) => readStockBalancesMock(...args),
    ensureMultipliersFor: async () => {},
}))

const applyNetworkChangeMock = vi.fn(async () => true)
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: (...args) => applyNetworkChangeMock(...args) }))

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
import { privacyStore } from '../store/privacy'
import Home from './Home.vue'
import { BSTOCKS } from '../data/bStocks'
import { XSTOCKS } from '../data/xStocks'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const NORMAL = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }
const GIZLI = { address: '0x' + 'cd'.repeat(20), key: 'private-' + 'cd'.repeat(20), type: 'hd', private: true }
const E18 = 10n ** 18n

beforeEach(() => {
    readStockBalancesMock.mockReset()
    readStockBalancesMock.mockImplementation(async ({ entries }) => new Map(entries.map((e) => [
        e.address.toLowerCase(), { balance: 0n, multiplier: e.issuer === 'xstocks' ? E18 : null },
    ])))
    applyNetworkChangeMock.mockReset()
    axiosPostMock.mockReset()
    axiosPostMock.mockImplementation(async () => ({ status: 200, data: { tokens: [] } }))
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

/** Home.vue'yu activeTab ZATEN 'stocks' iken render eder (HomeXStocks.ssr.test.js ile ayni kalip). */
async function renderHome({ privateActive }) {
    const stub = installChromeStub({
        currentNetwork: ETH_CHAIN,
        active_account: privateActive ? GIZLI : NORMAL,
        imported_tokens: {},
        vaults: [],
    })
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = ETH_CHAIN
    privacyStore().active = privateActive
    // stockChipChoice 'all': baslangic cipi aktif aga (Ethereum) inmesin, tum gruplar cizilsin (HomeXStocks.ssr.test.js ile ayni).
    const captured = captureInstance(app, 'Home', (instance) => {
        instance.setupState.activeTab = 'stocks'
        instance.setupState.stockChipChoice = 'all'
    })
    const html = await render(app)
    return { html, state: captured.instance.setupState, stub }
}

// SSR ciktisi sablon yorumlarini tasir: metin aramadan once temizlenir.
const govdeOf = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
// Hisseler sekme dugmesi: <button ...> Stocks <div .../> (home.stocks = "Stocks", en dilinde).
const SEKME_DUGMESI = /<button[^>]*>\s*Stocks\s*<div/
// Belirli bir dayanak ticker'ini (`underlying`) tasiyan sirket satirlari, belge sirasiyla (main 2a8acd4: satir = sirket x ag,
// ticker `data-stock-ticker` ile isaretli).
const satirlar = (html, ticker) => govdeOf(html).match(
    new RegExp(`<button[^>]*>(?:(?!<\\/button>)[\\s\\S])*?data-stock-ticker[^>]*>${ticker}<\\/span>[\\s\\S]*?<\\/button>`, 'g'),
) || []

describe('Home.vue (SSR) -- Hisseler, gizli mod', () => {
    it('normal modda xStocks gruplari ve satirlari CIZILIR; uc zincir sorulur (regresyon)', async () => {
        const { html, state } = await renderHome({ privateActive: false })

        expect(state.stockGroups.map((g) => g.chainId)).toEqual([1, 56, 42161])
        expect(state.stocksTabVisible).toBe(true)
        // Kontrol: sekme DUGMESI normal modda gercekten cizilir (gizli moddaki "yok" iddiasi bos gecmesin).
        expect(govdeOf(html)).toMatch(SEKME_DUGMESI)
        expect(govdeOf(html)).toContain('data-stock-chips')
        // Kontrol: sayac normal modda gercekten eslesiyor (gizli moddaki 0 iddiasi bos gecmesin).
        expect((govdeOf(html).match(/data-stock-chip(?![-\w])/g) ?? []).length).toBeGreaterThan(0)
        for (const stock of XSTOCKS) {
            const zincirler = new Set(stock.chains)
            if (BSTOCKS.some((b) => b.underlying === stock.underlying)) zincirler.add(56)
            expect(satirlar(html, stock.underlying), stock.underlying).toHaveLength(zincirler.size)
        }
        expect(readStockBalancesMock.mock.calls.map(([arg]) => arg.chainId).sort((a, b) => a - b)).toEqual([1, 56, 42161])
    })

    it('gizli modda Hisseler sekmesi HIC yok: sekme dugmesi, bStock ve xStock satiri, ag basligi, ag logosu, ihracci rozeti CIZILMEZ', async () => {
        const { html, state } = await renderHome({ privateActive: true })
        const govde = govdeOf(html)

        // Hatirlanan sekme 'stocks' KALIR (gizli moddan cikinca geri gelir) ama GORUNEN sekme Varliklar'a duser.
        expect(state.activeTab).toBe('stocks')
        expect(state.stocksTabVisible).toBe(false)
        expect(state.gorunenSekme).toBe('assets')
        expect(govde).not.toMatch(SEKME_DUGMESI)

        for (const stock of [...BSTOCKS, ...XSTOCKS]) expect(satirlar(html, stock.underlying), stock.underlying).toHaveLength(0)
        expect(govde).not.toContain('data-stock-chips')
        // 'data-stock-chip=' aranamaz: Vue SSR bos nitelikleri '=' olmadan yazar. Bu yuzden tam nitelik adi sayilir.
        expect(govde.match(/data-stock-chip(?![-\w])/g) ?? []).toHaveLength(0)
        expect(govde).not.toContain('data-stock-group-header')
        expect(govde).not.toContain('data-stock-chain-logo')
        expect(govde).not.toMatch(/>\s*xStocks\s*<\/span>/)
        expect(govde).not.toContain('Backed Assets (JE) Limited')
        expect(govde).not.toContain('BTech Holdings Limited')
    })

    it('gizli modda hicbir Hisseler zincirine (BSC dahil) bakiye sorusu gitmez; fiyat istegi hisse kimligi tasimaz', async () => {
        await renderHome({ privateActive: true })

        // Eski davranis: BSC'deki 22 bStock Gizli adresle sorulurdu. Sekme gorunmeyince HIC okuma yok.
        expect(readStockBalancesMock).not.toHaveBeenCalled()
        const sorulanKimlikler = axiosPostMock.mock.calls.flatMap(([, govde]) => govde?.ids ?? [])
        const hisseKimlikleri = new Set([...XSTOCKS, ...BSTOCKS].map((s) => s.coingeckoId ?? s.coingecko_id).filter(Boolean))
        expect(hisseKimlikleri.size).toBeGreaterThan(0)
        expect(sorulanKimlikler.filter((id) => hisseKimlikleri.has(id))).toEqual([])
    })

    it('Home bagliyken mod acilirsa xStocks kapisi canli kapanir (xstocksOn reaktif; hesap degisimi yeniden yuklemesi Gizli adresi ETH/ARB a gondermesin)', async () => {
        const { state } = await renderHome({ privateActive: false })
        expect(state.stockGroups.map((g) => g.chainId)).toEqual([1, 56, 42161])

        privacyStore().active = true

        expect(state.stockGroups.map((g) => g.chainId)).toEqual([56])
        // Sekmenin kendisi de canli kapanir (P13): Hisseler gorunurlugu `!privacy.active` ile reaktif.
        expect(state.stocksTabVisible).toBe(false)
        expect(state.gorunenSekme).toBe('assets')
    })

    // MOD GECISINDE HESAP IZLEYICISI SIRASI. `active_account` degisince arayuz senkronu `user.address`i hemen yazar;
    // `watch(user.address)` bir mikrogorev sonra `onUserAddressChanged`i calistirir ve gizlilik senkronu (`privacy.active`)
    // AYRI bir `storage.onChanged` dinleyicisidir: izleyici modu GUNCELLENMEDEN once okuyabilir. Asagidaki iki test bu sirayi
    // taklit eder (izleyici once, `privacy.active` hemen sonra) ve yukleyicilerin kararini ilk beklemeden SONRA verdigini olcer.
    it('Hisseler sekmesi acikken mod ozel moda gecerse (hesap izleyicisi privacy.active guncellenmeden calisir) hicbir hisse okumasi ya da hisse fiyat istegi gitmez', async () => {
        const { state, stub } = await renderHome({ privateActive: false })
        expect(state.gorunenSekme).toBe('stocks')
        readStockBalancesMock.mockClear()
        axiosPostMock.mockClear()

        // Gercek siralama: aktif hesap Gizliye gecer (PF-DD11: kapi hesaba bakar), user.address izleyicisi ONCE
        // (privacy.active hala false), gizlilik durumu HEMEN SONRA.
        stub.localStore.active_account = GIZLI
        const calisan = state.onUserAddressChanged()
        privacyStore().active = true
        await calisan

        expect(readStockBalancesMock).not.toHaveBeenCalled()
        const kimlikler = axiosPostMock.mock.calls.flatMap(([, govde]) => govde?.ids ?? [])
        const hisseKimlikleri = new Set([...XSTOCKS, ...BSTOCKS].map((s) => s.coingeckoId ?? s.coingecko_id).filter(Boolean))
        expect(hisseKimlikleri.size).toBeGreaterThan(0)
        expect(kimlikler.filter((id) => hisseKimlikleri.has(id))).toEqual([])
    })

    it('ozel moddan cikista hatirlanan Hisseler sekmesi (hesap izleyicisi privacy.active guncellenmeden calisir) HEMEN yuklenir', async () => {
        const { state, stub } = await renderHome({ privateActive: true })
        expect(state.activeTab).toBe('stocks')
        expect(state.gorunenSekme).toBe('assets')
        readStockBalancesMock.mockClear()

        // Gercek siralama: aktif hesap genele doner (PF-DD11), user.address izleyicisi ONCE (privacy.active hala true),
        // gizlilik durumu HEMEN SONRA (false).
        stub.localStore.active_account = NORMAL
        const calisan = state.onUserAddressChanged()
        privacyStore().active = false
        await calisan

        expect(state.gorunenSekme).toBe('stocks')
        expect(readStockBalancesMock).toHaveBeenCalled()
    })

    // PF-DD11: karar HESAP tabanlidir; gizlilik store'u hic guncellenmese de (gec kalan storage.onChanged) kapilar hesaba bakar.
    const hisseKimlikleriGiden = () => {
        const kimlikler = axiosPostMock.mock.calls.flatMap(([, govde]) => govde?.ids ?? [])
        const hisseKimlikleri = new Set([...XSTOCKS, ...BSTOCKS].map((s) => s.coingeckoId ?? s.coingecko_id).filter(Boolean))
        expect(hisseKimlikleri.size).toBeGreaterThan(0)
        return kimlikler.filter((id) => hisseKimlikleri.has(id))
    }

    it('GIRIS penceresi (store genel, depodaki hesap Gizli): yukleyiciler hisse bakiyesi okumaz, hisse fiyati istemez, kovaya hisse tohumlamaz', async () => {
        const { state, stub } = await renderHome({ privateActive: false })
        expect(state.gorunenSekme).toBe('stocks')
        readStockBalancesMock.mockClear()
        axiosPostMock.mockClear()

        // Gizli kova "saglikli" (56 anahtari bir dizi): seedOwnedStocks'un varsayilan kapisi (bucketNeedsDefaults) ERKEN donmesin.
        stub.localStore.active_account = GIZLI
        stub.localStore.imported_tokens = { ...stub.localStore.imported_tokens, [GIZLI.key]: { 56: [] } }
        const kovaOnce = JSON.stringify(stub.localStore.imported_tokens)
        const bStock = state.stockGroups.flatMap((g) => g.rows).find((row) => row.chainId === 56)
        expect(bStock).toBeTruthy()
        expect(privacyStore().active).toBe(false)
        await state.onUserAddressChanged()
        await state.refreshStocks()
        await state.loadBStockPrices()
        await state.seedOwnedStocks([bStock])

        expect(readStockBalancesMock).not.toHaveBeenCalled()
        expect(hisseKimlikleriGiden()).toEqual([])
        expect(JSON.stringify(stub.localStore.imported_tokens)).toBe(kovaOnce)
    })

    it('CIKIS penceresi (store Gizli, depodaki hesap normal): yukleyiciler calisir -- hisse bakiyesi okunur ve hisse fiyati istenir', async () => {
        const { state, stub } = await renderHome({ privateActive: true })
        readStockBalancesMock.mockClear()
        axiosPostMock.mockClear()

        stub.localStore.active_account = NORMAL
        expect(privacyStore().active).toBe(true)
        await state.refreshStocks()

        expect(readStockBalancesMock).toHaveBeenCalled()
        expect(axiosPostMock.mock.calls.filter(([url]) => String(url).endsWith('/getTokensDataById')).length).toBeGreaterThan(0)
    })
})

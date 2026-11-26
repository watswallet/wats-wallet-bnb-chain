// App.vue ACILISI: LCX hisse satirlarini (chrome.storage.local `lcx_stock_rows`) YALNIZ DEPODAN yukler (Bolum 2, Gorev 9, test 9).
// NEDEN App'te: popup dogrudan Takas ekraninda acilabilir (ATS satin alma penceresi, Home'a hic ugramadan). Genel Takas / Kopru
// secicileri LCX hissesini listelememek icin dinamik katmani bilmek zorundadir (isGeneralSwapExcluded); katmani yalniz Hisseler
// sekmesi yukleseydi, Home'a ugramayan popup'ta LCX hissesi "siradan token" gibi listelenirdi.
// Depodan okumak ag istegi DEGILDIR: gizli modda da yapilir. Bayrak kapaliyken depo OKUNMAZ.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})
const axiosPost = vi.fn()
vi.mock('axios', () => ({ default: { get: async () => ({ status: 200, data: {} }), post: (...a) => axiosPost(...a) } }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))

const EVM_AG = { chainId: 8453, name: 'Base', rpc: [{ url: 'https://rpc.example' }] }
const HESAP = { address: '0xAbC0000000000000000000000000000000000001', key: 'k1', type: 'hd' }
const GIZLI_HESAP = { address: '0xCcccCccc00000000000000000000000000000003', key: 'private-0xcccccccc00000000000000000000000000000003', type: 'hd', private: true }
const TSLAC_ADRESI = '0xb2000000000000000000001e800a7f5189430cD0'
const TSLAC = {
    chainId: 8453, address: TSLAC_ADRESI, symbol: 'TSLAC', name: 'Tesla (Coinbase Tokenized Stocks)', decimals: 8, issuer: 'coinbase',
    underlying: 'TSLA', priceUsd: 364.74, priceUpdatedAt: 1795071867, marketHours: 'us_equities',
}
const GMEON = {
    chainId: 56, address: '0xdABb9afF4cf02f26D2014e4cA9f94aC6fe6572a3', symbol: 'GMEON', name: 'GameStop (Ondo Tokenized Stock)', decimals: 18,
    issuer: 'ondo', underlying: 'GME', priceUsd: 27.02, priceUpdatedAt: 1795032524, marketHours: 'always',
}
const KAYIT = { fetchedAt: Date.now() - 30_000, asOf: Date.now() - 40_000, usEquitiesOpen: true, rows: [TSLAC, GMEON] }
const img = { thumb: 't', small: 's', large: 'l' }
const USDC = { name: 'USD Coin', symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, coingecko_id: 'usd-coin', image: img }

/**
 * App.vue'yu render eder (appOpenParallel.test.js ile ayni harness). Modul kaydi HER cagrida sifirlanir: App, tokenizedStocks ve
 * (sonradan ice aktarilan) swapTo AYNI kayittan gelir, yani App'in yukledigi katman swapTo'nun gordugu katmandir.
 */
async function hazirla({ bayrak, depo = {}, hesap = HESAP, yavasDepoMs = 0 }) {
    vi.resetModules()
    vi.stubEnv('VITE_LCX_ENABLED', bayrak ? 'true' : 'false')
    const okumalar = []
    const aglar = []
    const store = { vaults: [{ accounts: [hesap] }], active_account: hesap, currentNetwork: EVM_AG, ...depo }
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const istenen = Array.isArray(keys) ? keys : [keys]
                    okumalar.push(...istenen)
                    if (yavasDepoMs && istenen.includes('lcx_stock_rows')) await new Promise((r) => setTimeout(r, yavasDepoMs))
                    await Promise.resolve()
                    return Object.fromEntries(istenen.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]))
                },
                set: async () => {},
                remove: async () => {},
            },
            onChanged: { addListener: () => {}, removeListener: () => {} },
        },
        runtime: {
            sendMessage: (msg) => (msg?.type === 'CHECK_UNLOCK' ? Promise.resolve({ unlocked: false }) : Promise.resolve({})),
            onMessage: { addListener: () => {}, removeListener: () => {} },
            getURL: (p) => p,
        },
        tabs: { create: () => {}, query: async () => [] },
        windows: { onRemoved: { addListener: () => {} }, getCurrent: async () => ({ id: 1 }) },
    }
    const belge = {
        addEventListener: () => {}, removeEventListener: () => {},
        createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
        querySelector: () => null,
        documentElement: { classList: { add: () => {}, remove: () => {}, contains: () => false } },
        visibilityState: 'hidden',
    }
    vi.stubGlobal('window', {
        location: { pathname: '/src/popup/index.html', hash: '' }, document: belge,
        addEventListener: () => {}, removeEventListener: () => {},
        matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
        performance: { now: () => Date.now() }, close: () => {},
    })
    vi.stubGlobal('document', belge)
    vi.stubGlobal('setInterval', () => 1)
    vi.stubGlobal('fetch', async (url) => { aglar.push(String(url)); return { ok: true, status: 200, json: async () => ({}) } })

    const { createApp, render, createTestPinia, createTestI18n } = await import('../test-utils/ssrRender.js')
    const App = (await import('./App.vue')).default
    const katalog = await import('../utils/tokenizedStocks')
    const app = createApp(App)
    app.use(createTestPinia())
    app.use(createTestI18n())
    return { okumalar, aglar, katalog, render: () => render(app) }
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    delete globalThis.chrome
    axiosPost.mockReset()
})

describe('App.vue acilisi: LCX satirlari depodan yuklenir', () => {
    it('bayrak acik: acilista depodaki satirlar kurulur (Home gerekmez); ag istegi YOK; popup kilitli de olsa', async () => {
        const { okumalar, aglar, katalog, render } = await hazirla({ bayrak: true, depo: { lcx_stock_rows: KAYIT } })

        await render()

        expect(okumalar).toContain('lcx_stock_rows')
        expect(katalog.lcxStockRows().map((r) => r.symbol)).toEqual(['TSLAC', 'GMEON'])
        expect(katalog.stockEntry(8453, TSLAC_ADRESI)?.source).toBe('lcx')
        // Depo okumasi ag istegi degildir: /lcx/* istegi yok (App'in kendi RPC yoklamasi baska konu).
        expect(aglar.filter((u) => u.includes('/lcx/'))).toEqual([])
        expect(axiosPost).not.toHaveBeenCalled()
    }, 60000)

    it('depo okumasi acilis yonlendirmesinden ONCE biter (yavas depoda bile: App onMounted depo okumasini bekler)', async () => {
        const { katalog, render } = await hazirla({ bayrak: true, depo: { lcx_stock_rows: KAYIT }, yavasDepoMs: 30 })

        await render()

        expect(katalog.lcxStockRows()).toHaveLength(2)
    }, 60000)

    it('bayrak KAPALI: depo OKUNMAZ (lcx_stock_rows anahtari hic istenmez) ve dinamik katman bos', async () => {
        const { okumalar, katalog, render } = await hazirla({ bayrak: false, depo: { lcx_stock_rows: KAYIT } })

        await render()

        expect(okumalar).not.toContain('lcx_stock_rows')
        expect(katalog.lcxStockRows()).toEqual([])
        expect(katalog.stockEntry(8453, TSLAC_ADRESI)).toBeNull()
    }, 60000)

    it('gizli hesapla da yuklenir (depo okumasi ag istegi degil); /lcx/* istegi yine yok', async () => {
        const { aglar, katalog, render } = await hazirla({ bayrak: true, hesap: GIZLI_HESAP, depo: { lcx_stock_rows: KAYIT } })

        await render()

        expect(katalog.lcxStockRows()).toHaveLength(2)
        expect(aglar.filter((u) => u.includes('/lcx/'))).toEqual([])
        expect(axiosPost).not.toHaveBeenCalled()
    }, 60000)

    it('depo bos ya da bozuksa acilis bozulmaz ve katman bos kalir', async () => {
        for (const depo of [{}, { lcx_stock_rows: 'bozuk' }, { lcx_stock_rows: { fetchedAt: 'x', rows: 1 } }]) {
            const { katalog, render } = await hazirla({ bayrak: true, depo })
            await render()
            expect(katalog.lcxStockRows()).toEqual([])
        }
    }, 60000)

    // Ayni modul kaydindan swapTo secicisini render eder; App'in yukledigi katman bu secicinin gordugu katmandir.
    async function swapToOkut() {
        const { createApp, render: ciz, captureInstance, createTestPinia, createTestI18n } = await import('../test-utils/ssrRender.js')
        const { networkStore } = await import('../store/network')
        const SwapTo = (await import('../components/swap/swapTo.vue')).default
        const storedRow = (t) => ({ name: t.name, symbol: t.symbol, address: t.address, decimals: t.decimals, coingecko_id: null, image: img })
        globalThis.chrome.storage.local.get = async (keys) => {
            const store = { currentNetwork: EVM_AG, active_account: HESAP, imported_tokens: { k1: { 8453: [USDC, storedRow(TSLAC)] } } }
            return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, store[k]]))
        }
        axiosPost.mockImplementation(async (url) => {
            if (String(url).endsWith('/getChainTokens')) {
                return { status: 200, data: { success: true, tokens: [{ ...storedRow(TSLAC), address: TSLAC_ADRESI.toLowerCase(), chain: 'base', chainId: 8453 }] } }
            }
            return { status: 200, data: { success: true, tokens: [] } }
        })

        const app = createApp(SwapTo)
        app.use(createTestPinia())
        app.use(createTestI18n())
        networkStore().currentNetwork = EVM_AG
        networkStore().rpc = EVM_AG.rpc[0].url
        const captured = captureInstance(app, 'swapTo')
        const html = await ciz(app)
        return { state: captured.instance.setupState, html }
    }

    it('KONTROL: katman yuklenmediyse (bayrak kapali) ayni secici TSLAC adresini siradan token olarak LISTELER', async () => {
        const { render } = await hazirla({ bayrak: false, depo: { lcx_stock_rows: KAYIT } })
        await render()

        const { state, html } = await swapToOkut()

        expect(state.importedTokens.map((t) => t.symbol)).toEqual(['USDC', 'TSLAC'])
        expect(html).toContain('TSLAC')
    }, 60000)

    it("Home'a ugramadan acilan popup: swapTo secicisi LCX hissesini LISTELEMEZ (imported ve sunucu listesi), siradan token kalir", async () => {
        const { katalog, render } = await hazirla({ bayrak: true, depo: { lcx_stock_rows: KAYIT } })
        await render() // App (kilitli: Home mount olmaz) -> depodan yukler
        expect(katalog.isGeneralSwapExcluded(8453, TSLAC_ADRESI)).toBe(true)

        const { state, html } = await swapToOkut()

        expect(state.importedTokens.map((t) => t.symbol)).toEqual(['USDC'])
        expect(state.displayedTokens.map((t) => t.symbol)).toEqual([])
        expect(html).not.toContain('TSLAC')
    }, 60000)
})

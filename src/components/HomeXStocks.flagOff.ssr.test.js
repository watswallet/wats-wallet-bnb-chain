// Home.vue (SSR) - ozellik bayragi KAPALI (XSTOCKS_ENABLED false, spec 5.12): Hisseler sekmesi BUGUNKU bStocks
// gorunumunde. xStock satiri/grubu, ag basligi, rozet, ag logosu ve bakiye cizilmez; fiyat istegi yalniz bStocks
// kimliklerini tasir; bakiye yalniz BSC icin okunur.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bayrak KAPALI: vitest.config.js test.env tum testlerde ACIK yapar; bu dosya modulu taklit eder.
vi.mock('../utils/featureFlags', async (importOriginal) => ({ ...(await importOriginal()), XSTOCKS_ENABLED: false }))

vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: async () => [] }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))

// Satira basinca ag gecisi (K3) bayrak KAPALIYKEN YAPILMAZ (kullanici karari 2026-10-11, secenek b).
const applyNetworkChangeMock = vi.fn(async () => true)
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: (...args) => applyNetworkChangeMock(...args) }))

const readStockBalancesMock = vi.fn()
vi.mock('../utils/stockBalances', async (importOriginal) => ({
    ...(await importOriginal()),
    readStockBalances: (...args) => readStockBalancesMock(...args),
    ensureMultipliersFor: async () => {},
}))

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
import Home from './Home.vue'
import { BSTOCKS } from '../data/bStocks'
import { XSTOCKS } from '../data/xStocks'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const GOOGLB = BSTOCKS.find((s) => s.symbol === 'GOOGLB')
const HESAP = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }

beforeEach(() => {
    applyNetworkChangeMock.mockReset()
    applyNetworkChangeMock.mockResolvedValue(true)
    readStockBalancesMock.mockReset()
    readStockBalancesMock.mockImplementation(async ({ entries }) => new Map(entries.map((e) => [e.address.toLowerCase(), { balance: 0n, multiplier: null }])))
    axiosPostMock.mockReset()
    axiosPostMock.mockImplementation(async () => ({ status: 200, data: { tokens: [] } }))
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

async function renderHome() {
    installChromeStub({ currentNetwork: ETH_CHAIN, active_account: HESAP, imported_tokens: {}, vaults: [] })
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = ETH_CHAIN

    const captured = captureInstance(app, 'Home', (instance) => { instance.setupState.activeTab = 'stocks' })
    const html = await render(app)
    return { html, captured }
}

const govdeOf = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

describe('Home.vue (SSR) - bayrak KAPALI: Hisseler bugunku bStocks gorunumu', () => {
    it('xStock satiri YOK, 22 bStock satiri var; yalniz BSC grubu', async () => {
        const { html, captured } = await renderHome()
        const govde = govdeOf(html)

        // Satirda sembol degil TICKER gorunur (TSLA, TSLAB degil); xStocks sembolleri hic gorunmez.
        for (const stock of XSTOCKS) expect(govde, stock.symbol).not.toContain(stock.symbol)
        for (const stock of BSTOCKS) {
            expect(govde, stock.underlying).toContain('data-stock-ticker>' + stock.underlying + '</span>')
            expect(govde, stock.symbol).not.toContain(stock.symbol)
        }
        // Bayrak kapali: 22 sirket satiri (her bStocks bir satir), bakiye etiketi yok.
        expect(govde.match(/data-stock-ticker/g)).toHaveLength(BSTOCKS.length)
        expect(govde).not.toContain('data-stock-balance')
        expect(captured.instance.setupState.stockGroups.map((g) => g.chainId)).toEqual([56])
    })

    it('ihracci rozeti, xStocks notu, ag basligi ve ag logosu CIZILMEZ', async () => {
        const { html } = await renderHome()
        const govde = govdeOf(html)

        expect(govde).not.toContain('xStocks')
        expect(govde).not.toMatch(/>\s*bStocks\s*<\/span>/) // bStocks rozeti de bayrak kapaliyken cizilmez (bugunku gorunum)
        expect(govde).not.toContain('data-stock-group-header') // ag basligi
        expect(govde).not.toContain('data-stock-chain-logo') // satir ag logosu
        expect(govde).not.toContain('Backed Assets')
        expect(govde).toContain('certificates over shares') // bStocks notu aynen
    })

    it('fiyat istegi yalniz bStocks kimliklerini tasir; bakiye yalniz BSC icin okunur', async () => {
        await renderHome()

        const fiyat = axiosPostMock.mock.calls.find(([url, body]) =>
            String(url).includes('/getTokensDataById') && body?.ids?.length === BSTOCKS.length)
        expect(fiyat).toBeDefined()
        expect(fiyat[1].ids.some((id) => id.endsWith('-xstock'))).toBe(false)
        expect(readStockBalancesMock.mock.calls.map(([arg]) => arg.chainId)).toEqual([56])
    })
})

describe('Home.vue (SSR) - bayrak KAPALI: ag cipleri', () => {
    it('cip cubugu HIC yok', async () => {
        const { html } = await renderHome()

        expect(html).not.toContain('data-stock-chip')
    })
})

describe('Home.vue (SSR) - bayrak KAPALI: satira basinca Faz 1 ONCESI davranis (FIN-bilesen-6, secenek b)', () => {
    it('Ethereum aktifken GOOGLB: ag gecisi CAGRILMAZ, detay acilir, chainId 56', async () => {
        const { captured } = await renderHome()
        expect(networkStore().currentNetwork.chainId).toBe(1)

        await captured.instance.setupState.openStock(GOOGLB)

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(networkStore().currentNetwork.chainId).toBe(1) // cuzdan aga GECMEDI
        expect(cryptoStore().selected_token_ref).toEqual({
            id: GOOGLB.coingecko_id,
            chainId: 56,
            address: GOOGLB.address,
            decimals: GOOGLB.decimals,
            symbol: GOOGLB.symbol,
        })
        expect(cryptoStore().selected_token_id).toBe(GOOGLB.coingecko_id)
        expect(pageStore().currentPage).toBe('token')
    })
})

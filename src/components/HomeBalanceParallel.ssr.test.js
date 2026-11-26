// Home.vue (SSR) -- updateBalance: fiyat istegi bakiye okumalarini BEKLETMEZ (acilis suresi).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const events = vi.hoisted(() => [])

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))

const axiosPostMock = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
vi.mock('axios', () => ({
    default: {
        post: (...args) => axiosPostMock(...args),
        get: async () => ({ status: 200, data: { news: [] } }),
    },
}))

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} } }
})

// TON zinciri: adres/istemci/bakiye kollari saplanir. Bu dosyanin konusu FIYAT
// ESLEMESI; bakiye okumasinin KENDISI jettonBalance.test.js'in konusu.
vi.mock('../utils/ton/tonIdentity', () => ({ ensureTonAddress: async () => 'UQTestOwner' }))
vi.mock('../utils/ton/tonClient', () => ({ getTonClient: () => ({}) }))
vi.mock('../utils/ton/tonBalance', () => ({ getTonBalance: async () => { events.push('ton-bakiye-cagrildi'); return 2 } }))
vi.mock('../utils/ton/jettonAddress', () => ({ getJettonWalletAddress: async () => 'EQJettonWalletTest' }))
vi.mock('../utils/ton/jettonBalance', () => ({ getJettonBalance: async () => { events.push('jetton-bakiye-cagrildi'); return 12.5 } }))

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { userStore } from '../store/user'
import Home from './Home.vue'
import supported_chains from '../data/supported_chains.json'

const TON = supported_chains.find((c) => c.chainId === -239)
const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'

// tokenBucketKey bicimi (alt cizgi) — Home.vue jetton anahtarini boyle kuruyor.
const JETTON_KEY = `-239_${USDT_MASTER}`
const NATIVE_KEY = '-239_0x0'

// CANLI OLCUM: POST /getTokensDataById {"ids":["the-open-network","tether"]}
const PRICES = [
    {
        coingecko_id: 'the-open-network',
        market_data: { priceUSD: 1.357, change: { h24: -1.2 }, sparkline: { d7: Array(144).fill(1.4) } },
    },
    {
        coingecko_id: 'tether',
        market_data: { priceUSD: 0.999189, change: { h24: 0.00143 }, sparkline: { d7: Array(144).fill(0.9998) } },
    },
]

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    events.length = 0
    axiosPostMock.mockImplementation(async (url) => {
        if (String(url).endsWith('/getTokensDataById')) {
            events.push('fiyat-basladi')
            await new Promise((r) => setTimeout(r, 60))
            events.push('fiyat-bitti')
            return { status: 200, data: { tokens: PRICES } }
        }
        return { status: 200, data: { tokens: [] } }
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
    axiosPostMock.mockClear()
    useSolanaAssetsMock.mockClear()
    delete globalThis.chrome
})

async function renderHome() {
    installChromeStub({
        currentNetwork: TON,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
        imported_tokens: {
            acc1: {
                '-239': [
                    {
                        name: 'TON', symbol: 'GRAM', decimals: 9, address: '0x0',
                        image: { thumb: '', small: '', large: '' }, coingecko_id: 'the-open-network',
                    },
                    {
                        name: 'Tether USD', symbol: 'USDT', decimals: 6, address: USDT_MASTER,
                        image: { thumb: '', small: '', large: '' }, coingecko_id: 'tether',
                    },
                ],
            },
        },
        vaults: [],
    })

    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = TON

    const captured = captureInstance(app, 'Home')
    const html = await render(app)

    return { html, captured, user: userStore() }
}

describe('Home.vue (SSR) -- fiyat istegi ile bakiye okumalari PARALEL', () => {
    it('bakiye okumalari fiyat istegi bitmeden baslar', async () => {
        await renderHome()
        expect(events.indexOf('fiyat-basladi')).toBeGreaterThanOrEqual(0)
        expect(events.indexOf('ton-bakiye-cagrildi')).toBeLessThan(events.indexOf('fiyat-bitti'))
        expect(events.indexOf('jetton-bakiye-cagrildi')).toBeLessThan(events.indexOf('fiyat-bitti'))
    })

    it('fiyat gelmeden hicbir satira miktar/deger yazilmaz, sonuc ayni ve eksiksiz', async () => {
        const { user } = await renderHome()
        expect(user.tokenBalances[NATIVE_KEY].value).toBeCloseTo(2 * 1.357, 6)
        expect(user.tokenBalances[JETTON_KEY].value).toBeCloseTo(12.5 * 0.999189, 6)
        expect(user.usd).toBeCloseTo(2 * 1.357 + 12.5 * 0.999189, 5)
    })
})

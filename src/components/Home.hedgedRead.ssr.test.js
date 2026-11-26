// Home.vue (SSR) -- bakiye okumasi: ilk RPC takilirsa ayni zincirin SIRADAKI RPC'si de denenir (yalniz okuma).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: async () => [] }))
const useTokenBalanceMock = vi.fn()
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))
vi.mock('../utils/stockBalances', async (importOriginal) => ({ ...(await importOriginal()), ensureMultipliersFor: async () => {} }))

const axiosPostMock = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
vi.mock('axios', () => ({
    default: { post: (...a) => axiosPostMock(...a), get: async () => ({ status: 200, data: { news: [] } }) },
}))
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} } }
})

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { userStore } from '../store/user'
import { tokenScopeStore } from '../store/tokenScope'
import Home from './Home.vue'
import supported_chains from '../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const ETH = supported_chains.find((c) => c.chainId === 1)
const [BSC_A, BSC_B] = BSC.rpc.map((r) => r.url)
const img = { thumb: '', small: '', large: '' }
const BNB = { name: 'BNB', symbol: 'BNB', decimals: 18, address: '0x0000000000000000000000000000000000000000', image: img, coingecko_id: 'binancecoin' }
const ETHTOK = { name: 'Ethereum', symbol: 'ETH', decimals: 18, address: '0x0000000000000000000000000000000000000000', image: img, coingecko_id: 'ethereum' }

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    useTokenBalanceMock.mockReset()
})
afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

async function renderHome(chain, token, extra = {}) {
    installChromeStub({
        currentNetwork: chain,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
        imported_tokens: { acc1: { [String(chain.chainId)]: [token] } },
        vaults: [],
        ...extra,
    })
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    const network = networkStore()
    network.currentNetwork = chain
    network.rpc = chain.rpc[0].url
    tokenScopeStore().filter = 'all'
    await render(app)
    return userStore()
}
const row = (user, chain) => user.tokenBalances[Object.keys(user.tokenBalances).find((k) => k.startsWith(`${chain.chainId}_`))]

describe('Home.vue (SSR) -- yedekli bakiye okumasi', () => {
    it('ilk RPC takilirsa (yanitsiz) ikinci RPC den okunan bakiye yazilir, satir hata isaretlenmez', async () => {
        useTokenBalanceMock.mockImplementation((addr, tok, url) => (url === BSC_A ? new Promise(() => {}) : Promise.resolve(3.5)))
        const user = await renderHome(BSC, BNB)
        expect(row(user, BSC).amount).toBe(3.5)
        expect(row(user, BSC).error).toBeFalsy()
        expect(useTokenBalanceMock.mock.calls.map((c) => c[2])).toEqual([BSC_A, BSC_B])
    }, 15000)

    it('ilk RPC hizli yanit verirse ikinci RPC e HIC istek gitmez', async () => {
        useTokenBalanceMock.mockResolvedValue(1)
        const user = await renderHome(BSC, BNB)
        expect(row(user, BSC).amount).toBe(1)
        expect(useTokenBalanceMock).toHaveBeenCalledTimes(1)
    })

    it('tum RPC ler basarisizsa bugunku davranis: satir error, amount yazilmaz, toplam yazilmaz', async () => {
        useTokenBalanceMock.mockRejectedValue(new Error('down'))
        const user = await renderHome(BSC, BNB)
        expect(row(user, BSC).error).toBe(true)
        expect(row(user, BSC).amount).toBeUndefined()
        expect(user.usd).toBeFalsy()
    })

    it('tek RPC li zincirde (Ethereum) yedek yoktur, okuma aynen tek uca gider', async () => {
        useTokenBalanceMock.mockResolvedValue(2)
        const user = await renderHome(ETH, ETHTOK)
        expect(row(user, ETH).amount).toBe(2)
        expect(useTokenBalanceMock).toHaveBeenCalledTimes(1)
    })
})

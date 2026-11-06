// ImportToken.vue - ozellik bayragi KAPALI (XSTOCKS_ENABLED false): sahte xStock uyarisi KORUYUCUDUR ve bayraktan
// BAGIMSIZDIR (plan K1, karar D10). Yanlis hisse kimligi bayrak kapaliyken de zarar verir.
import { describe, it, expect, vi, afterEach } from 'vitest'

// Bayrak KAPALI: vitest.config.js test.env tum testlerde ACIK yapar; bu dosya modulu taklit eder.
vi.mock('../utils/featureFlags', async (importOriginal) => ({ ...(await importOriginal()), XSTOCKS_ENABLED: false }))

const { KONTRATLAR, axiosPostMock } = vi.hoisted(() => ({
    KONTRATLAR: new Map(),
    axiosPostMock: vi.fn(),
}))

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class JsonRpcProvider {
        async getCode() { return '0x6080' }
    }
    class Contract {
        constructor(address) {
            const k = KONTRATLAR.get(address.toLowerCase())
            this.name = async () => k.name
            this.symbol = async () => k.symbol
            this.decimals = async () => 18n
        }
    }
    return { ...actual, JsonRpcProvider, Contract }
})

vi.mock('axios', () => ({ default: { post: (...a) => axiosPostMock(...a), get: vi.fn() } }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import ImportToken from './ImportToken.vue'
import { XSTOCKS_ENABLED } from '../utils/featureFlags'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SAHTE_AAPLX = '0x3f46948c00000000000000000000000000000000'

afterEach(() => {
    delete globalThis.chrome
    KONTRATLAR.clear()
    axiosPostMock.mockReset()
})

describe('ImportToken.vue (SSR) - bayrak KAPALI iken sahte xStock uyarisi yine cikar', () => {
    it('D10: bayrak kapali (kanit) ve sahte AAPLx yine dogrulanmamis sayilir', async () => {
        expect(XSTOCKS_ENABLED).toBe(false)
        KONTRATLAR.set(SAHTE_AAPLX, { name: 'Apple', symbol: 'AAPLx' })
        axiosPostMock.mockResolvedValue({ data: { token: { coingecko_id: 'apple-xstock', image: { large: 'https://sunucu/apple.png' }, chain: 'ethereum' } } })

        installChromeStub({ active_account: { key: 'acc-1' } })
        const app = createApp(ImportToken)
        app.use(createTestPinia())
        app.use(createTestI18n())
        const network = networkStore()
        network.currentNetwork = ETH_CHAIN
        network.rpc = 'https://rpc.example'
        const captured = captureInstance(app, 'ImportToken')
        await render(app)

        const sonuc = await captured.instance.setupState.validateTokenContract(SAHTE_AAPLX)

        expect(sonuc).toMatchObject({ image: null, chain: null, coingecko_id: null, known: false })
    })
})

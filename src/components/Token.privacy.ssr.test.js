// Token.vue -- gizli modda Gonder kapisi (C-I1). Plan 2 ozel gonder ekranini
// getirene kadar hicbir arayuz yolu siradan Gonder akisini acmamali: kapi arka
// planda PRIVATE_USE_PRIVATE_SEND ile reddeder, kullanici formu doldurup bos yere
// onay ekranina kadar giderdi.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosPostMock = vi.fn()
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: vi.fn(async () => 0) }))
vi.mock('../utils/ton/tonIdentity', () => ({ ensureTonAddress: async () => 'UQTest' }))
vi.mock('../utils/ton/tonClient', () => ({ getTonClient: () => ({}) }))
vi.mock('../utils/ton/tonBalance', () => ({ getTonBalance: async () => 0 }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import { privacyStore } from '../store/privacy'
import Token from './Token.vue'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

const tokenRecord = () => ({
    name: 'USD Coin', symbol: 'usdc', coingecko_id: 'usd-coin',
    image: { thumb: '', large: '' }, address: '0x0',
    market_data: {
        priceUSD: 1, market_cap: 1000, volume: 500, circulating_supply: 1000,
        ath: 1.1, atl: 0.9, change: { h24: 0.1 }, sparkline: { d7: [] },
    },
})

afterEach(() => {
    axiosPostMock.mockReset()
    delete globalThis.chrome
})

async function mount({ privateActive }) {
    axiosPostMock.mockResolvedValue({ status: 200, data: { token: tokenRecord() } })
    installChromeStub({
        currentNetwork: ETH_CHAIN,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001' },
    })
    const app = createApp(Token, { props: { id: 'usd-coin' } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    networkStore().currentNetwork = ETH_CHAIN
    cryptoStore().selected_token_ref = { id: 'usd-coin', chainId: 1, address: '0x0' }
    privacyStore().active = privateActive
    const captured = captureInstance(app, 'Token')
    const html = await render(app)
    return { html, state: captured.instance.setupState }
}

describe('Token.vue (SSR) -- gizli mod Gonder kapisi', () => {
    it('normal modda Gonder dugmesi GORUNUR (regresyon)', async () => {
        const { html } = await mount({ privateActive: false })
        expect(html).toContain('>Send<')
    })

    it('gizli modda Gonder dugmesi GIZLENIR', async () => {
        const { html } = await mount({ privateActive: true })
        expect(html).not.toContain('>Send<')
    })

    it('gizli modda selectSend dogrudan cagrilsa bile Gonder sayfasi ACILMAZ', async () => {
        const { state } = await mount({ privateActive: true })
        pageStore().currentPage = 'token'
        cryptoStore().sendAsset = null
        await state.selectSend()
        expect(pageStore().currentPage).toBe('token')
        expect(cryptoStore().sendAsset).toBeNull()
    })

    it('normal modda selectSend Gonder sayfasini acar (regresyon)', async () => {
        const { state } = await mount({ privateActive: false })
        pageStore().currentPage = 'token'
        await state.selectSend()
        expect(pageStore().currentPage).toBe('send')
    })
})

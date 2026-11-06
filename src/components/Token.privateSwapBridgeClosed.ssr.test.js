// Token.vue (SSR) -- 1.10: VITE_PRIVATE_SWAP_BRIDGE KAPALI iken gizli modda Takas ve Kopru dugmeleri CIZILMEZ.
// NORMAL MOD ETKILENMEZ: ayni token ekraninda iki dugme durur. Bayrak derleme sabitidir: vi.hoisted ile modullerden ONCE kapatilir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.hoisted(() => { process.env.VITE_PRIVATE_SWAP_BRIDGE = 'false' })

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
const axiosPostMock = vi.fn()
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 2 }))
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} },
        Contract: class { async decimals() { return 18n } },
    }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { privacyStore } from '../store/privacy'
import { PRIVATE_SWAP_BRIDGE } from '../utils/featureFlags'
import Token from './Token.vue'
import supported_chains from '../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const ME = '0xCcccCccc00000000000000000000000000000003'
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'

afterEach(() => { axiosPostMock.mockReset(); delete globalThis.chrome })

const apiKaydi = () => ({
    name: 'USD Coin', symbol: 'usdc', coingecko_id: 'usd-coin',
    image: { thumb: 'https://cdn.example/usdc.png', large: 'https://cdn.example/usdc.png' }, address: '0x0',
    market_data: { priceUSD: 1.5, market_cap: 1000, volume: 500, circulating_supply: 1000, ath: 1.1, atl: 0.9, change: { h24: 0.1 }, sparkline: { d7: [] } },
})

async function mountToken({ gizli }) {
    axiosPostMock.mockResolvedValue({ status: 200, data: { token: apiKaydi() } })
    installChromeStub({ currentNetwork: BSC, active_account: { address: ME } })
    const app = createApp(Token, { props: { id: 'usd-coin' } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = BSC
    networkStore().rpc = BSC.rpc[0].url
    cryptoStore().selected_token_ref = { id: 'usd-coin', chainId: 56, address: USDC_BSC, decimals: 18, symbol: 'USDC' }
    cryptoStore().selected_token_id = 'usd-coin'
    privacyStore().active = gizli
    return render(app)
}

const gorunurMetin = (html) => html.replace(/<[^>]*>/g, ' ')

describe('Token.vue (SSR) -- PRIVATE_SWAP_BRIDGE kapali (1.10)', () => {
    it('ortam: bayrak bu dosyada gercekten kapali (aksi halde asagidaki iddialar bos gecer)', () => {
        expect(PRIVATE_SWAP_BRIDGE).toBe(false)
    })

    it('gizli modda Takas ve Kopru dugmeleri YOK', async () => {
        const metin = gorunurMetin(await mountToken({ gizli: true }))
        expect(metin).not.toMatch(/\bSwap\b/)
        expect(metin).not.toMatch(/\bBridge\b/)
        expect(metin).toContain('Your Balance')
    })

    it('KONTROL: normal modda ayni token ekraninda Takas ve Kopru dugmeleri durur', async () => {
        const metin = gorunurMetin(await mountToken({ gizli: false }))
        expect(metin).toMatch(/\bSwap\b/)
        expect(metin).toMatch(/\bBridge\b/)
    })
})

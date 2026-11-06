// Token.vue (SSR) - xStock detayi: carpan doldurma BITINCE fiyat/deger yeniden hesaplanir (`multiplierTick`,
// FIN-bilesen-8). SSR'da `computed` ONBELLEKSIZ calisir (runtime-core, isSSR), bu yuzden tick'i kaldiran
// mutasyon digerlerinde YESIL kalir. Burada `computed` tarayicidaki gibi ONBELLEKLI (@vue/reactivity) yapilir.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    const reactivity = await import('@vue/reactivity')
    return { ...actual, onMounted: actual.onServerPrefetch, computed: reactivity.computed }
})

const axiosPostMock = vi.fn()
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))

const bakiyeOku = vi.hoisted(() => vi.fn(async () => 2))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => bakiyeOku(...args) }))

// multiplierFor REAKTIF DEGIL (utils/stockBalances.js duz Map): uretimdeki hali taklit edilir.
const carpan = vi.hoisted(() => ({ deger: null, doldur: null, zincir: null, adres: null }))
vi.mock('../utils/stockBalances', async (importOriginal) => ({
    ...(await importOriginal()),
    ensureMultipliersFor: async (...args) => carpan.doldur(...args),
    multiplierFor: (chainId, address) => (
        Number(chainId) === carpan.zincir && String(address).toLowerCase() === carpan.adres ? carpan.deger : null
    ),
}))

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} },
        Contract: class { async decimals() { return 18n } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import Token from './Token.vue'
import { XSTOCKS } from '../data/xStocks'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SPY = XSTOCKS.find((s) => s.symbol === 'SPYx')
const SPY_M = 1005714560286254000n // Spec Ek B.1 olcumu

beforeEach(() => {
    bakiyeOku.mockClear()
    carpan.deger = null
    carpan.doldur = vi.fn(async () => {})
    carpan.zincir = 1
    carpan.adres = SPY.address.toLowerCase()
    axiosPostMock.mockResolvedValue({
        status: 200,
        data: { token: { name: 'SP500', symbol: 'spyx', coingecko_id: 'sp500-xstock', image: { thumb: '', large: '' }, address: '0x0', market_data: { priceUSD: 781.3, market_cap: 1, volume: 1, circulating_supply: 1, ath: 1, atl: 1, change: { h24: 0 }, sparkline: { d7: [] } } } },
    })
})

afterEach(() => {
    axiosPostMock.mockReset()
    delete globalThis.chrome
})

describe('Token.vue (SSR, onbellekli computed) - carpan doldurma sonrasi yeniden hesap', () => {
    it('doldurma decimals atamasindan SONRA biterse displayToken tick ile yeniden hesaplanir (bayat tire kalmaz)', async () => {
        let bitir
        carpan.doldur = vi.fn(() => new Promise((resolve) => { bitir = () => { carpan.deger = SPY_M; resolve() } }))

        installChromeStub({ currentNetwork: ETH_CHAIN, active_account: { address: '0xAbCdEf0000000000000000000000000000000001' } })
        const app = createApp(Token, { props: { id: 'sp500-xstock' } })
        app.use(createTestPinia())
        app.use(createTestI18n('en'))
        networkStore().currentNetwork = ETH_CHAIN
        cryptoStore().selected_token_ref = { id: 'sp500-xstock', chainId: 1, address: SPY.address }
        const captured = captureInstance(app, 'Token')

        const bitti = render(app)
        try {
            // Bakiye okumasi basladiysa decimals atamasi (token.value) yapildi; doldurma hala asili.
            await vi.waitFor(() => expect(bakiyeOku).toHaveBeenCalled())
            const st = captured.instance.setupState
            expect(st.xStockPriceUnknown).toBe(true) // carpan bilinmiyor: displayToken onbellege ALINDI (tire)
        } finally {
            bitir?.()
            await bitti
        }

        const st = captured.instance.setupState
        expect(st.displayToken.market_data.priceUSD).toBeCloseTo(776.86, 2)
        expect(st.xStockPriceUnknown).toBe(false)
    })
})

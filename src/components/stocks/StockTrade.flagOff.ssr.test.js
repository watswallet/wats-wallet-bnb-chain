// Bayrak KAPALI: xStocks icin ekran "kullanilamiyor" cizer, ana dugme yok, hicbir arka plan mesaji gonderilmez.
// bStocks bayraksiz ACIKTIR (K6): ekran cizilir, ihracci secici yoktur (bayrak kapaliyken tek ihracci).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
vi.mock('../../utils/featureFlags', async (importOriginal) => ({ ...(await importOriginal()), XSTOCKS_ENABLED: false }))
vi.mock('../../composables/useTokenBalance', () => ({ useTokenBalance: async () => 1000 }))
vi.mock('axios', () => ({ default: { post: async () => ({ status: 200, data: { tokens: [] } }) } }))

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import { ALL_CHAINS } from '../../data/chains'
import { XSTOCKS } from '../../data/xStocks'
import { BSTOCKS } from '../../data/bStocks'
import StockTrade from './StockTrade.vue'

afterEach(() => {
    delete globalThis.chrome
})

describe('StockTrade.vue -- bayrak kapali', () => {
    it('kullanilamiyor cizer, ana dugme yok, sendMessage HIC cagrilmaz', async () => {
        const stock = XSTOCKS.find((s) => s.chains.includes(1))
        const { setSendMessage } = installChromeStub({ active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'a' } })
        const spy = vi.fn(async () => ({}))
        setSendMessage(spy)
        const app = createApp(StockTrade)
        app.use(createTestPinia())
        app.use(createTestI18n())
        networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === 1)
        cryptoStore().selected_token_ref = { id: 'x', chainId: 1, address: stock.address, decimals: stock.decimals, symbol: stock.symbol }
        const html = (await render(app)).replace(/<!--[\s\S]*?-->/g, '')
        expect(html).toContain('not available')
        expect(html).not.toContain('data-trade-primary')
        expect(spy).not.toHaveBeenCalled()
    })
})

describe('StockTrade.vue -- bayrak kapali, bStocks acik (K6)', () => {
    const b = BSTOCKS.find((x) => x.underlying === 'TSLA') // xStocks esi VAR ama bayrak kapali: secici cikmaz

    async function mountB() {
        const { setSendMessage } = installChromeStub({ active_account: { address: '0xAbCdEf0000000000000000000000000000000001', type: 'imported', key: 'a' } })
        const spy = vi.fn(async () => ({}))
        setSendMessage(spy)
        const app = createApp(StockTrade)
        app.use(createTestPinia())
        app.use(createTestI18n())
        networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === 56)
        cryptoStore().selected_token_ref = { id: 'b', chainId: 56, address: b.address, decimals: b.decimals, symbol: b.symbol }
        const html = (await render(app)).replace(/<!--[\s\S]*?-->/g, '')
        return { html, spy }
    }

    it('ekran acik: ana dugme var, "kullanilamiyor" yok', async () => {
        const { html } = await mountB()
        expect(html).toContain('data-trade-primary')
        expect(html).not.toContain('not available')
        expect(html).toContain('data-pay-token="USDT"')
    })

    it('ihracci secici DOM da yok (tek ihracci)', async () => {
        const { html } = await mountB()
        expect(html).not.toContain('data-issuer-switch')
        expect(html).not.toContain('data-issuer-option')
    })

    it('tutar girilmeden hicbir teklif/ATS mesaji gitmez', async () => {
        const { spy } = await mountB()
        expect(spy).not.toHaveBeenCalled()
    })

    it('xStocks hala kapali: ayni bayrakla xStock kimligi "kullanilamiyor"', async () => {
        const x = XSTOCKS.find((s) => s.chains.includes(56)) ?? XSTOCKS[0]
        installChromeStub({ active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'a' } })
        const app = createApp(StockTrade)
        app.use(createTestPinia())
        app.use(createTestI18n())
        networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === (x.chains.includes(56) ? 56 : x.chains[0]))
        cryptoStore().selected_token_ref = { id: 'x', chainId: x.chains.includes(56) ? 56 : x.chains[0], address: x.address, decimals: x.decimals, symbol: x.symbol }
        const html = (await render(app)).replace(/<!--[\s\S]*?-->/g, '')
        expect(html).toContain('not available')
        expect(html).not.toContain('data-trade-primary')
    })
})

describe('StockTrade.vue -- bayrak kapali, ATS ucret ekrani', () => {
    it('ucret karti, ipucu ve bildirim hicbir zaman cizilmez (ekran kullanilamiyor)', async () => {
        const stock = XSTOCKS.find((s) => s.chains.includes(1))
        installChromeStub({ active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'a' } })
        const app = createApp(StockTrade)
        app.use(createTestPinia())
        app.use(createTestI18n())
        networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === 1)
        cryptoStore().selected_token_ref = { id: 'x', chainId: 1, address: stock.address, decimals: stock.decimals, symbol: stock.symbol }
        const html = (await render(app)).replace(/<!--[\s\S]*?-->/g, '')
        expect(html).not.toContain('data-trade-ats-fee')
        expect(html).not.toContain('data-trade-ats-hint')
        expect(html).not.toContain('data-fee-notice')
    })
})

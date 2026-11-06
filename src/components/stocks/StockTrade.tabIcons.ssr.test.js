// StockTrade.vue -- Al/Sat sekme dugmelerinde ikon (aria-hidden, currentColor, metin ayni).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
vi.mock('../../composables/useCowQuote', async () => {
    const { reactive } = await import('vue')
    const __quote = reactive({
        state: 'idle', result: null, quoteId: null, expiresAt: null, errorCode: null, errorInfo: null, lockReason: null,
        refresh: vi.fn(), invalidate: vi.fn(),
    })
    return { useCowQuote: () => __quote, __quote }
})
vi.mock('../../composables/useTokenBalance', () => ({ useTokenBalance: async () => 1000 }))
vi.mock('axios', () => ({ default: { post: vi.fn(async () => ({ status: 200, data: { tokens: [] } })) } }))

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import { pageStore } from '../../store/pageStore'
import { ALL_CHAINS } from '../../data/chains'
import { XSTOCKS } from '../../data/xStocks'
import StockTrade from './StockTrade.vue'

const STOCK = XSTOCKS.find((s) => s.chains.includes(1))

async function html() {
    installChromeStub({ active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' } })
    const app = createApp(StockTrade)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === 1)
    cryptoStore().selected_token_ref = { id: 'x', chainId: 1, address: STOCK.address, decimals: STOCK.decimals, symbol: STOCK.symbol }
    pageStore().currentPage = 'stock_trade'
    return (await render(app)).replace(/<!--[\s\S]*?-->/g, '')
}
afterEach(() => { delete globalThis.chrome })

const tabOf = (h, t) => { const i = h.indexOf(`data-trade-tab="${t}"`); return h.slice(h.lastIndexOf("<button", i), h.indexOf("</button>", i) + 9) }

describe('StockTrade sekme ikonlari', () => {
    for (const t of ['buy', 'sell']) {
        it(`${t} dugmesinde aria-hidden ikon metnin solunda`, async () => {
            const b = tabOf(await html(), t)
            expect(b).toMatch(/<svg[^>]*aria-hidden="true"/)
            expect(b).toContain('stroke="currentColor"')
            expect(b.indexOf('<svg')).toBeLessThan(b.indexOf(t === 'buy' ? 'Buy' : 'Sell'))
            expect(b.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim()).toBe(t === 'buy' ? 'Buy' : 'Sell')
        })
    }
    it('Al ve Sat ikonlari farkli', async () => {
        const h = await html()
        const p = (b) => b.match(/<svg[\s\S]*?<\/svg>/)[0]
        expect(p(tabOf(h, 'buy'))).not.toBe(p(tabOf(h, 'sell')))
    })
})

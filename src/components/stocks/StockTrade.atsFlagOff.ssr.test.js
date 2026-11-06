// Faz 3 ucret bayragi KAPALI, xStocks ACIK: Faz 2 ekrani birebir. Kart, ipucu, bildirim cizilmez ve ucret mesaji gitmez.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
vi.mock('../../utils/featureFlags', async (importOriginal) => ({ ...(await importOriginal()), XSTOCKS_ATS_FEE_ENABLED: false }))
vi.mock('../../composables/useTokenBalance', () => ({ useTokenBalance: async () => 1000 }))
vi.mock('../../composables/useCowQuote', async () => {
    const { reactive } = await import('vue')
    const __quote = reactive({
        state: 'ready', quoteId: 'q1', expiresAt: null, errorCode: null, errorInfo: null, lockReason: null,
        result: {
            success: true, locked: false, lockReason: null, quoteId: 'q1',
            display: {
                sellAmount: '10000000', sellDecimals: 6, expectedBuy: '45000000000000000', buyDecimals: 18, minBuy: '44000000000000000',
                unitPrice: 222.2, referencePrice: 222, gapPct: 0.09, locked: false,
                fees: { networkUsd: 0.1, cowUsd: 0.05, watsUsd: 0.01, totalUsd: 0.16 },
            },
            approval: { mode: 'permit' }, notice: { state: 'open', nextChangeAt: null }, warnings: [],
            feePreview: { mode: 'ats', quotedAtsRaw: '1234500000000000000', decimals: 18, hint: true, lowNetworkFee: true },
        },
        refresh: vi.fn(), invalidate: vi.fn(),
    })
    return { useCowQuote: () => __quote }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n, captureInstance } from '../../test-utils/ssrRender.js'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import { ALL_CHAINS } from '../../data/chains'
import { XSTOCKS } from '../../data/xStocks'
import StockTrade from './StockTrade.vue'

afterEach(() => {
    delete globalThis.chrome
})

describe('StockTrade.vue -- ATS ucret bayragi kapali', () => {
    it('kart, ipucu, bildirim YOK; COW_FEE_* mesaji gitmez; eylem de mesaj gondermez', async () => {
        const stock = XSTOCKS.find((s) => s.chains.includes(1))
        const { setSendMessage } = installChromeStub({ active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'a' } })
        const spy = vi.fn(async () => ({ success: true, fees: [], debt: false }))
        setSendMessage(spy)
        const app = createApp(StockTrade)
        app.use(createTestPinia())
        app.use(createTestI18n())
        networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === 1)
        cryptoStore().selected_token_ref = { id: 'x', chainId: 1, address: stock.address, decimals: stock.decimals, symbol: stock.symbol }
        const holder = captureInstance(app, 'StockTrade')
        const html = (await render(app)).replace(/<!--[\s\S]*?-->/g, '')
        expect(html).toContain('data-trade-primary')
        expect(html).not.toContain('data-trade-ats-fee')
        expect(html).not.toContain('data-trade-ats-hint')
        expect(html).not.toContain('data-fee-notice')
        expect(spy.mock.calls.filter(([m]) => String(m?.type).startsWith('COW_FEE'))).toEqual([])
        await holder.instance.setupState.onFeeAction({ name: 'payNow', uid: '0x' + 'cd'.repeat(56) })
        expect(spy.mock.calls.filter(([m]) => String(m?.type).startsWith('COW_FEE'))).toEqual([])
    })
})

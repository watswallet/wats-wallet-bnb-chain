// "ATS Al" -- kopru ekraninin buy-ats engel karti (spec §6.4). Kopruda eksik-ATS bolumu yok; engel
// karti tek yer. Satis kapaliyken dugme HIC yok.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const satis = vi.hoisted(() => ({ acik: true }))
const acilis = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../composables/useAtsPurchase', () => ({
    useAtsPurchase: () => ({ live: satis.acik, open: acilis }),
}))

const useTokenBalanceMock = vi.fn(async () => 1000)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

const durum = vi.hoisted(() => ({ decision: null }))
vi.mock('../composables/useAtsOpFee', async () => {
    const { ref } = await import('vue')
    const TOPLAM = 21.76
    const requiredAtsFor = (extra = 0) => TOPLAM + Number(extra || 0)
    return {
        useAtsOpFee: () => ({
            atsFee: ref(20.87), atsSymbol: ref('ATS'), atsBalance: ref(1), opCount: ref(2),
            bootstrapFee: ref(0.89), feeRefundable: ref(false), prepaid: ref(null),
            ready: ref(false), decision: ref(durum.decision), nextSteps: ref([]),
            loading: ref(false), error: ref(null), errorCode: ref(null), blocked: ref(true),
            commissionAts: ref('0'), commissionHuman: ref(0), commissionRegion: ref('local'), commissionTreasury: ref(null),
            hasCommission: ref(false), totalAtsCost: ref(TOPLAM), maxAtsSellRaw: ref(null),
            exceedsAtsCap: () => false,
            insufficient: ref(true),
            requiredAtsFor,
            insufficientFor: () => true,
            load: async () => {}, runOnboarding: async () => true, reset: () => {},
        }),
    }
})

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import { resolveAtsBlocker } from '../utils/atsBlocker'
import Bridge from './Bridge.vue'
import supported_chains from '../data/supported_chains.json'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const token = (symbol, address, chainId) => ({
    name: symbol, symbol, address, decimals: 18, chainId, image: { thumb: '', large: '' },
})
const USDT_BSC = token('usdt', '0x55d398326f99059fF775485246999027B3197955', 56)
const USDC_HEDEF = token('usdc', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 1)

const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const kacKez = (html, metin) => html.split(metin).length - 1
const DUGME = 'Buy ATS'

afterEach(() => {
    useTokenBalanceMock.mockClear()
    acilis.mockClear()
    delete globalThis.chrome
    satis.acik = true
    durum.decision = null
})

async function ciz({ decision }) {
    durum.decision = decision
    installChromeStub({
        currentNetwork: BSC_CHAIN,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    })
    const app = createApp(Bridge)
    app.use(createTestPinia())
    app.use(createTestI18n())
    networkStore().currentNetwork = BSC_CHAIN
    pageStore().currentPage = 'bridge'
    const crypto = cryptoStore()
    crypto.bridge.inToken = USDT_BSC
    crypto.bridge.outToken = USDC_HEDEF
    crypto.bridge.toChain = ETH_CHAIN
    const holder = captureInstance(app, 'Bridge', (instance) => {
        instance.setupState.amount = 5
        instance.setupState.bridgeData = {
            estimate: { toAmount: '5000000000000000000', executionDuration: 30, feeCosts: [], gasCosts: [] },
            action: { fromChainId: 56, toChainId: 1, fromToken: USDT_BSC, toToken: { decimals: 18 }, fromAmount: '5000000000000000000' },
            transactionRequest: { to: '0x1111111111111111111111111111111111111111', data: '0x', value: '0' },
        }
    })
    const dugme = captureInstance(app, 'AtsBuyButton')
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState, dugme: dugme.instance }
}

describe('Bridge.vue (SSR) -- buy-ats engel kartinda "ATS Al"', () => {
    it('dugme cizilir ve satin alma ekranini acar', async () => {
        const { html, state, dugme } = await ciz({ decision: resolveAtsBlocker('balance-missing') })
        expect(state.atsDecision.action).toBe('buy-ats')
        expect(html).toContain('ATS balance required')
        expect(kacKez(html, DUGME)).toBe(1)
        await dugme.setupState.onClick()
        expect(acilis).toHaveBeenCalledTimes(1)
    })

    it('buy-ats DISINDA bir engelde dugme YOK', async () => {
        const { html } = await ciz({ decision: resolveAtsBlocker('src-allowance-missing') })
        expect(html).not.toContain(DUGME)
    })

    it('satis KAPALI: dugme YOK', async () => {
        satis.acik = false
        const { html } = await ciz({ decision: resolveAtsBlocker('balance-missing') })
        expect(html).toContain('ATS balance required')
        expect(html).not.toContain(DUGME)
    })
})

// "ATS Al" -- takas ekraninin buy-ats yerleri (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §6.4).
//
// Iki yer var ve ikisi AYNI ANDA cizilmez: ATS ucret kartinin engel satiri (eksik miktar bilinmiyorken)
// ve eksik-ATS bolumu (miktar biliniyorken). Dugme de bu yuzden TEK kez cizilir. Satis kapaliyken
// (useAtsPurchase().live false) dugme HIC yok: kartlar bugunku gibi yalniz metin.
//
// useAtsOpFee ve useAtsFuel SABITLENIR: konu kararin kendisi degil, ekranin onu nereye cizdigi.
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
vi.mock('../utils/ton/tonIdentity', () => ({
    ensureTonAddress: async () => 'UQTestTonAddress000000000000000000000000000000',
}))
vi.mock('../composables/useTonFee', async () => {
    const { ref } = await import('vue')
    return {
        useTonFee: () => ({
            atsMaxFee: ref(null), atsMaxFeeRaw: ref(null), relayActive: ref(false), statusUnreadable: ref(false),
            ready: ref(false), decision: ref(null), quote: ref(null), budget: ref(null),
            loading: ref(false), onboarding: ref(false), error: ref(null),
            load: async () => {}, stop: () => {}, runOnboarding: async () => {},
        }),
    }
})

// BSC'deki ATS bakiyesi (ATS_FUEL_BALANCE): null -> okunamadi, eksik miktar hesaplanamaz.
const yakit = vi.hoisted(() => ({ bakiye: null }))
vi.mock('../composables/useAtsFuel', async () => {
    const { ref } = await import('vue')
    return {
        useAtsFuel: () => ({
            balance: ref(yakit.bakiye), symbol: ref('ATS'), loading: ref(false), stale: ref(false),
            feePerOp: ref(null), level: ref('unknown'), opsLeft: ref(null), display: ref('—'), exact: ref('—'),
            load: async () => {}, refresh: async () => {}, setChain: async () => {},
        }),
    }
})

// Ucret 21.76 ATS, bakiye yetmiyor; karar testin sectigi deger.
const durum = vi.hoisted(() => ({ decision: null }))
vi.mock('../composables/useAtsOpFee', async () => {
    const { ref } = await import('vue')
    const TOPLAM = 21.76
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
            requiredAtsFor: (extra = 0) => TOPLAM + Number(extra || 0),
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
import Swap from './Swap.vue'
import supported_chains from '../data/supported_chains.json'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const token = (symbol, address) => ({
    name: symbol, symbol, address, decimals: 18, chainId: 56, image: { thumb: '', large: '' },
})
const USDT = token('usdt', '0x55d398326f99059fF775485246999027B3197955')
const USDC = token('usdc', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d')

const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const kacKez = (html, metin) => html.split(metin).length - 1
const DUGME = 'Buy ATS'

afterEach(() => {
    useTokenBalanceMock.mockClear()
    acilis.mockClear()
    delete globalThis.chrome
    satis.acik = true
    yakit.bakiye = null
    durum.decision = null
})

async function ciz({ decision, bakiye = null }) {
    durum.decision = decision
    yakit.bakiye = bakiye
    installChromeStub({
        currentNetwork: BSC_CHAIN,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    })
    const app = createApp(Swap)
    app.use(createTestPinia())
    app.use(createTestI18n())
    networkStore().currentNetwork = BSC_CHAIN
    pageStore().currentPage = 'swap'
    const crypto = cryptoStore()
    crypto.swap.inToken = USDT
    crypto.swap.outToken = USDC
    const holder = captureInstance(app, 'Swap', (instance) => {
        instance.setupState.inTokenAmount = 5
        instance.setupState.swapData = { expectedOutput: '5', exchangeRate: '1', depthGateWarning: false }
    })
    const dugme = captureInstance(app, 'AtsBuyButton')
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState, dugme: dugme.instance }
}

describe('Swap.vue (SSR) -- buy-ats yerlerinde "ATS Al"', () => {
    it('engel satirinda (eksik miktar bilinmiyor): dugme cizilir ve satin alma ekranini acar', async () => {
        const { html, state, dugme } = await ciz({ decision: resolveAtsBlocker('balance-missing') })
        expect(state.showAtsShortfall).toBe(false)
        expect(html).toContain('ATS balance required')
        expect(kacKez(html, DUGME)).toBe(1)
        await dugme.setupState.onClick()
        expect(acilis).toHaveBeenCalledTimes(1)
    })

    it('eksik-ATS bolumunde (miktar biliniyor): dugme TEK kez cizilir', async () => {
        const { html, state } = await ciz({ decision: resolveAtsBlocker('balance-missing'), bakiye: 1 })
        expect(state.showAtsShortfall).toBe(true)
        expect(html).toContain('Missing balance')
        expect(kacKez(html, DUGME)).toBe(1)
    })

    it('buy-ats DISINDA bir engelde dugme YOK (kurulum gerekli)', async () => {
        const { html } = await ciz({ decision: resolveAtsBlocker('src-allowance-missing') })
        expect(html).not.toContain(DUGME)
    })

    it('satis KAPALI: iki yerde de dugme YOK (bugunku davranis; kartlar yine cizilir)', async () => {
        satis.acik = false
        const engel = await ciz({ decision: resolveAtsBlocker('balance-missing') })
        // Pozitif kontrol: kart cizildi (bos sayfa "dugme yok" testini bosuna gecirmesin).
        expect(engel.html).toContain('ATS balance required')
        expect(engel.html).not.toContain(DUGME)
        const eksik = await ciz({ decision: resolveAtsBlocker('balance-missing'), bakiye: 1 })
        expect(eksik.state.showAtsShortfall).toBe(true)
        expect(eksik.html).toContain('Missing balance')
        expect(eksik.html).not.toContain(DUGME)
    })
})

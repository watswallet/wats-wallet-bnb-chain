// Swap ekraninda SPOKE zincirde ATSOFT satarken -- gercek render.
//
// §06.1 satis tavani (bakiye - ucret - komisyon) BSC'ye ozgudur: orada paymaster'in
// pesin tahsilati ve router'in transferFrom'u AYNI ATS bakiyesinden cikar, tavan
// asilirsa op AA33 ile duser (paymaster docs/gasless-wallet-entegrasyon.md "Cuzdanin
// uymasi gereken kural"). Spoke zincirlerde ucret op'tan ONCE BSC'den tahsil edilir;
// satilan ATSOFT o bakiyeye hic dokunmaz. Eskiden ekran ATSOFT miktarini BSC bakiyesine
// gore kurulmus tavanla karsilastiriyor (calisan takasi kilitliyor) ve "yetersiz ATS"
// blogunda gereken tutara satilan ATSOFT'u ekliyordu (kullaniciya yuzlerce kat fazla ATS
// aldiriyordu).
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const useTokenBalanceMock = vi.fn(async () => 100000)
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

// Ucret 21.76 ATS (BSC'den). Tavan BSC bakiyesinden kuruldugu icin ATSOFT miktarini
// "asiyor" (`exceedsAtsCap` true) -- spoke'ta bu karsilastirma ANLAMSIZ.
const durum = vi.hoisted(() => ({ insufficient: false }))
vi.mock('../composables/useAtsOpFee', async () => {
    const { ref } = await import('vue')
    const TOPLAM = 21.76
    return {
        useAtsOpFee: () => ({
            atsFee: ref(20.87), atsSymbol: ref('ATS'), atsBalance: ref(1), opCount: ref(2),
            bootstrapFee: ref(0.89), feeRefundable: ref(false), needsTopUp: ref(false),
            ready: ref(true), decision: ref(null), nextSteps: ref([]),
            loading: ref(false), error: ref(null), errorCode: ref(null), blocked: ref(false),
            commissionAts: ref('0'), commissionHuman: ref(0), commissionRegion: ref('src'), commissionTreasury: ref(null),
            hasCommission: ref(false), totalAtsCost: ref(TOPLAM), maxAtsSellRaw: ref('0'),
            exceedsAtsCap: () => true,
            insufficient: ref(durum.insufficient),
            requiredAtsFor: (extra = 0) => TOPLAM + Number(extra || 0),
            insufficientFor: () => durum.insufficient,
            load: async () => {}, runOnboarding: async () => true, reset: () => {},
        }),
    }
})

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import { getAtsConfig } from '../utils/atsConfig'
import Swap from './Swap.vue'
import supported_chains from '../data/supported_chains.json'

const POLYGON = supported_chains.find((c) => c.chainId === 137)
const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)

const token = (symbol, address, chainId) => ({
    name: symbol, symbol, address, decimals: 18, chainId, image: { thumb: '', large: '' },
})
const ATSOFT_POL = token('ats', getAtsConfig(137).token.address, 137)
const USDC_POL = token('usdc', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 137)
const ATS_BSC = token('ats', getAtsConfig(56).token.address, 56)
const USDC_BSC = token('usdc', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 56)

const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const TAVAN_BASLIK = 'Amount too high'

afterEach(() => {
    useTokenBalanceMock.mockClear()
    delete globalThis.chrome
    durum.insufficient = false
})

async function ciz({ chain = POLYGON, inToken = ATSOFT_POL, outToken = USDC_POL, amount = 1000, insufficient = false }) {
    durum.insufficient = insufficient
    installChromeStub({
        currentNetwork: chain,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    })

    const app = createApp(Swap)
    app.use(createTestPinia())
    app.use(createTestI18n())

    networkStore().currentNetwork = chain
    pageStore().currentPage = 'swap'
    const crypto = cryptoStore()
    crypto.swap.inToken = inToken
    crypto.swap.outToken = outToken

    const holder = captureInstance(app, 'Swap', (instance) => {
        instance.setupState.inTokenAmount = amount
        instance.setupState.swapData = { expectedOutput: '5', exchangeRate: '1', depthGateWarning: false }
    })
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState }
}

describe('Swap.vue (SSR) -- spoke zincirde ATSOFT satisi', () => {
    it('BSC tavani UYGULANMAZ: tavan karti yok, tavan sebebi yok', async () => {
        const { html, state } = await ciz({})
        expect(state.payWithAts).toBe(true)
        expect(state.atsCapExceeded).toBe(false)
        expect(html).not.toContain(TAVAN_BASLIK)
        expect(state.blockReason).not.toBe('ats-cap')
    })

    it('ucret yetmiyorsa gereken tutara satilan ATSOFT EKLENMEZ', async () => {
        const { html, state } = await ciz({ insufficient: true })
        expect(state.atsInsufficient).toBe(true)
        expect(state.atsRequiredTotal).toBeCloseTo(21.76, 10)
        expect(html).toContain('You need ~21.76 ATS')
        expect(html).not.toContain('You need ~1,021.76')
        expect(html).not.toContain('You need ~1021.76')
    })

    it('ESLENMIS: BSC de ATS satarken tavan HALA uygulanir', async () => {
        const { html, state } = await ciz({ chain: BSC_CHAIN, inToken: ATS_BSC, outToken: USDC_BSC })
        expect(state.atsCapExceeded).toBe(true)
        expect(html).toContain(TAVAN_BASLIK)
    })

    it('ESLENMIS: BSC de ucret yetmiyorsa satilan ATS gereken tutara EKLENIR', async () => {
        const { state } = await ciz({ chain: BSC_CHAIN, inToken: ATS_BSC, outToken: USDC_BSC, amount: 5, insufficient: true })
        expect(state.atsRequiredTotal).toBeCloseTo(26.76, 10)
    })
})

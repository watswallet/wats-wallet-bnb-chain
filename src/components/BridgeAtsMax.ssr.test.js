// Kopru'de BSC ATS'si koprulenirken MAX/yuzde dugmeleri -- gercek render.
//
// Ucret ATS kolunda AYNI bakiyeden (BSC ATS) cikar. Eskiden pay yalniz native coin icin
// ayriliyordu (needsNativeReserve ATS kolunda 0 doner); MAX tam bakiyeyi yaziyor ve
// dugme "Insufficient Balance" ile kilitleniyordu -- Takas'taki "Set to X" gibi bir cikis
// da yoktu, kullanici ucreti elle dusmek zorundaydi.
//
// Artik: ucret biliniyorsa (teklif elde) yuzde, bakiyeden ucret DUSULEREK hesaplanir.
// Bilinmiyorsa (ilk teklif yolda) MAX tam bakiyeyi yazar; teklif gelince ve tutar
// odenemez cikarsa AYNI yuzde BIR KEZ, ucret ayrilarak yeniden uygulanir.
//
// SSR'da `watch` geri cagrilari CALISMAZ; yeniden uygulama bu yuzden teklif tazeleme
// fonksiyonunun (refreshAtsOpFee) ICINDE -- test onu dogrudan cagirir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Girdi tokeni bakiyesi 1000 (ATS kopruleniyorsa ayni zamanda ucret bakiyesi).
const useTokenBalanceMock = vi.fn(async () => 1000)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

// Ucret `durum.toplam` (null = teklif henuz yok). Karar GERCEK bakiye ile verilir ki
// ekranin `insufficientFor`a hangi miktari verdigi davranissal olarak olculsun.
const durum = vi.hoisted(() => ({ bakiye: 1000, toplam: 21.76 }))
vi.mock('../composables/useAtsOpFee', async () => {
    const { ref } = await import('vue')
    return {
        useAtsOpFee: () => {
            const totalAtsCost = ref(durum.toplam)
            const requiredAtsFor = (extra = 0) =>
                (totalAtsCost.value == null ? null : totalAtsCost.value + Number(extra || 0))
            return {
                atsFee: ref(20.87), atsSymbol: ref('ATS'), atsBalance: ref(durum.bakiye), opCount: ref(2),
                bootstrapFee: ref(0.89), feeRefundable: ref(false), needsTopUp: ref(false),
                ready: ref(true), decision: ref(null), nextSteps: ref([]),
                loading: ref(false), error: ref(null), errorCode: ref(null), blocked: ref(false),
                commissionAts: ref('0'), commissionHuman: ref(0), commissionRegion: ref('local'), commissionTreasury: ref(null),
                hasCommission: ref(false), totalAtsCost, maxAtsSellRaw: ref(null),
                exceedsAtsCap: () => false,
                insufficient: ref(false),
                requiredAtsFor,
                insufficientFor: (extra = 0) => {
                    const gereken = requiredAtsFor(extra)
                    return gereken != null && durum.bakiye < gereken
                },
                load: async () => {}, runOnboarding: async () => true, reset: () => {},
            }
        },
    }
})

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import { getAtsConfig } from '../utils/atsConfig'
import Bridge from './Bridge.vue'
import supported_chains from '../data/supported_chains.json'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

const token = (symbol, address, chainId) => ({
    name: symbol, symbol, address, decimals: 18, chainId, image: { thumb: '', large: '' },
})
const USDT_BSC = token('usdt', '0x55d398326f99059fF775485246999027B3197955', 56)
const ATS_BSC = token('ats', getAtsConfig(56).token.address, 56)
// Ethereum'daki ATSOFT: ayni sembol, ama ucret bakiyesi DEGIL (ucret BSC'den tahsil edilir).
const ATSOFT_ETH = token('ats', getAtsConfig(1).token.address, 1)
const USDC_HEDEF = token('usdc', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 1)

const UCRET = 21.76

afterEach(() => {
    useTokenBalanceMock.mockClear()
    delete globalThis.chrome
    durum.bakiye = 1000
    durum.toplam = UCRET
})

async function ciz({ chain = BSC_CHAIN, inToken, toChain = ETH_CHAIN, toplam = UCRET }) {
    durum.toplam = toplam
    installChromeStub({
        currentNetwork: chain,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', type: 'imported' },
    })

    const app = createApp(Bridge)
    app.use(createTestPinia())
    app.use(createTestI18n())

    networkStore().currentNetwork = chain
    pageStore().currentPage = 'bridge'
    const crypto = cryptoStore()
    crypto.bridge.inToken = inToken
    crypto.bridge.outToken = USDC_HEDEF
    crypto.bridge.toChain = toChain

    // Teklif elde: refreshAtsOpFee ancak transactionRequest varken calisir.
    const holder = captureInstance(app, 'Bridge', (instance) => {
        instance.setupState.bridgeData = {
            estimate: { toAmount: '5000000000000000000', executionDuration: 30, feeCosts: [], gasCosts: [] },
            action: { fromChainId: chain.chainId, toChainId: toChain.chainId, fromToken: inToken, toToken: { decimals: 18 }, fromAmount: '5000000000000000000' },
            transactionRequest: { to: '0x1111111111111111111111111111111111111111', data: '0x', value: '0' },
        }
    })
    await render(app)
    return holder.instance.setupState
}

describe('Bridge.vue (SSR) -- BSC ATS koprulenirken MAX ucreti ayirir', () => {
    it('ucret biliniyorsa MAX = bakiye - ucret ve dugme kilitlenmez', async () => {
        const state = await ciz({ inToken: ATS_BSC })
        await state.setPercent(1)
        expect(Number(state.amount)).toBeCloseTo(1000 - UCRET, 6)
        expect(state.atsInsufficient).toBe(false)
    })

    it('yuzdeler de ucret dusulmus bakiyeden hesaplanir', async () => {
        const state = await ciz({ inToken: ATS_BSC })
        await state.setPercent(0.5)
        expect(Number(state.amount)).toBeCloseTo((1000 - UCRET) / 2, 6)
    })

    it('ESLENMIS: baska token kopruleniyorsa MAX tam bakiye (ucret ayri bakiyeden)', async () => {
        const state = await ciz({ inToken: USDT_BSC })
        await state.setPercent(1)
        expect(Number(state.amount)).toBe(1000)
    })

    it('ESLENMIS: spoke zincirdeki ATSOFT ucret bakiyesi degil -- MAX tam bakiye', async () => {
        const state = await ciz({ chain: ETH_CHAIN, inToken: ATSOFT_ETH, toChain: BSC_CHAIN })
        await state.setPercent(1)
        expect(Number(state.amount)).toBe(1000)
    })
})

describe('Bridge.vue (SSR) -- ucret bilinmeden secilen yuzde teklif gelince duzeltilir', () => {
    it('MAX: teklif gelince ucret ayrilarak BIR KEZ yeniden uygulanir', async () => {
        const state = await ciz({ inToken: ATS_BSC, toplam: null })
        await state.setPercent(1)
        expect(Number(state.amount)).toBe(1000)          // ucret bilinmiyor: pay 0

        state.totalAtsCost = UCRET                        // teklif geldi
        await state.refreshAtsOpFee()
        expect(Number(state.amount)).toBeCloseTo(1000 - UCRET, 6)
        expect(state.atsInsufficient).toBe(false)
    })

    // Elle yazilan tutar da odenemez (990 + 21.76 > 1000): yine de DOKUNULMAZ -- kullanicinin
    // kendi yazdigi sayi sessizce degismesin; dugme "yetersiz" der, karar kullanicinin.
    it('kullanici arada miktari degistirdiyse DOKUNULMAZ (odenemez olsa bile)', async () => {
        const state = await ciz({ inToken: ATS_BSC, toplam: null })
        await state.setPercent(1)
        state.amount = 990
        state.totalAtsCost = UCRET
        await state.refreshAtsOpFee()
        expect(Number(state.amount)).toBe(990)
        expect(state.atsInsufficient).toBe(true)
    })

    // Teklif yoldayken girdi tokeni ATS'den baska bir tokene cevrildiyse bekleyen yuzde
    // o tokene AIT DEGIL: yeniden uygulamak yeni tokenin miktarini sessizce degistirirdi.
    it('girdi tokeni arada ATS den cikarildiysa DOKUNULMAZ', async () => {
        durum.bakiye = 10                                  // ucret bakiyesi yetmiyor: blok acik
        const state = await ciz({ inToken: ATS_BSC, toplam: null })
        await state.setPercent(1)
        cryptoStore().bridge.inToken = USDT_BSC
        state.inBalance = 400                              // yeni tokenin bakiyesi (SSR'da izleyici kosmaz)
        state.totalAtsCost = UCRET
        expect(state.atsInsufficient).toBe(true)          // yeniden uygulamanin diger kosulu saglaniyor
        await state.refreshAtsOpFee()
        expect(Number(state.amount)).toBe(1000)
    })

    it('tutar odenebiliyorsa (yuzde < 100) DOKUNULMAZ', async () => {
        const state = await ciz({ inToken: ATS_BSC, toplam: null })
        await state.setPercent(0.5)
        state.totalAtsCost = UCRET
        await state.refreshAtsOpFee()
        expect(Number(state.amount)).toBe(500)
    })

    it('tek seferlik: duzeltmeden sonra elle yazilan tutara bir sonraki teklif dokunmaz', async () => {
        const state = await ciz({ inToken: ATS_BSC, toplam: null })
        await state.setPercent(1)
        state.totalAtsCost = UCRET
        await state.refreshAtsOpFee()
        state.amount = 999                                 // kullanici yine tam bakiyeye yakin yazdi
        await state.refreshAtsOpFee()
        expect(Number(state.amount)).toBe(999)            // dugme "yetersiz" der, tutar degismez
    })
})

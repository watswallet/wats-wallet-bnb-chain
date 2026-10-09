// Kopru ekraninda ATS BAKIYESI UCRETE YETMIYORSA -- gercek render.
//
// 2026-09-25 incelemesi: Kopru'nun ATS kolu yalniz `!atsLoading && atsReady` soruyordu.
// ready:true bu op'un odenebilir oldugunu soylemez; kullanici basiyor, /sponsor
// 'balance-missing' ile reddediyor ve ekran genel bir "gonderilemedi" kartiyla
// kaliyordu. Artik ucret kartinin icinde Send ile ayni blok cizilir ve dugme
// "Insufficient Balance" ile kilitlenir.
//
// KOPRUYE OZGU: kullanici BSC'deki ATS'sini kopruluyorsa ucret ve gonderilen miktar
// AYNI bakiyeden cikar; router'in transferFrom'u ne istemcinin ne sunucunun ATS
// harcamasina sayiliyor, yani bu kapi tek koruma. Spoke zincirlerdeki ATSOFT ise
// ucret bakiyesi DEGIL -- orada miktar eklenmez.
//
// useAtsOpFee SABITLENIR ama kararini GERCEK bir bakiye ile verir (`durum.bakiye`),
// boylece ekranin `insufficientFor`a HANGI miktari verdigi davranissal olarak olculur.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Girdi tokeni bakiyesi bol: "girdi tokeni yetersiz" sebebi ATS sebebini GOLGELEMESIN.
const useTokenBalanceMock = vi.fn(async () => 1000)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

// Ucret 21.76 ATS (20.87 transfer + 0.89 op1); bakiye, `loading` ve `decision` testin
// sectigi degerler.
const durum = vi.hoisted(() => ({ bakiye: 1, loading: false, decision: null }))
vi.mock('../composables/useAtsOpFee', async () => {
    const { ref } = await import('vue')
    const TOPLAM = 21.76
    const requiredAtsFor = (extra = 0) => TOPLAM + Number(extra || 0)
    return {
        useAtsOpFee: () => ({
            atsFee: ref(20.87), atsSymbol: ref('ATS'), atsBalance: ref(durum.bakiye), opCount: ref(2),
            bootstrapFee: ref(0.89), feeRefundable: ref(false),
            ready: ref(true), decision: ref(durum.decision), nextSteps: ref([]),
            loading: ref(durum.loading), error: ref(null), errorCode: ref(null), blocked: ref(false),
            commissionAts: ref('0'), commissionHuman: ref(0), commissionRegion: ref('local'), commissionTreasury: ref(null),
            hasCommission: ref(false), totalAtsCost: ref(TOPLAM), maxAtsSellRaw: ref(null),
            exceedsAtsCap: () => false,
            insufficient: ref(durum.bakiye < TOPLAM),
            requiredAtsFor,
            insufficientFor: (extra = 0) => durum.bakiye < requiredAtsFor(extra),
            load: async () => {}, runOnboarding: async () => true, reset: () => {},
        }),
    }
})

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import { getAtsConfig } from '../utils/atsConfig'
import { resolveAtsBlocker } from '../utils/atsBlocker'
import Bridge from './Bridge.vue'
import supported_chains from '../data/supported_chains.json'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

const token = (symbol, address, chainId) => ({
    name: symbol, symbol, address, decimals: 18, chainId, image: { thumb: '', large: '' },
})
const USDT_BSC = token('usdt', '0x55d398326f99059fF775485246999027B3197955', 56)
const ATS_BSC = token('ats', getAtsConfig(56).token.address, 56)
// Ethereum'daki ATSOFT: ayni sembol, ama ucret bakiyesi DEGIL.
const ATSOFT_ETH = token('ats', getAtsConfig(1).token.address, 1)
const USDC_HEDEF = token('usdc', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 1)

const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

// Ana dugmenin OKUNAN metni: sayfanin SON dugmesi (acilir pencereler ustte, dugme en
// altta). Kapsamli stil etiketlere data-v ekledigi icin etiketler atilir.
const dugmeMetni = (html) => {
    const bas = html.lastIndexOf('<button')
    const son = html.indexOf('</button>', bas)
    return html.slice(bas, son).replace(/<[^>]+>/g, '').trim()
}

const BLOK_BASLIK = 'Insufficient ATS balance'

afterEach(() => {
    useTokenBalanceMock.mockClear()
    delete globalThis.chrome
    durum.bakiye = 1
    durum.loading = false
    durum.decision = null
})

async function ciz({ chain = BSC_CHAIN, inToken, amount = 5, bakiye, toChain = ETH_CHAIN, loading = false, decision = null }) {
    durum.bakiye = bakiye
    durum.loading = loading
    durum.decision = decision
    installChromeStub({
        currentNetwork: chain,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
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

    // Teklif ELDE ve miktar girilmis: dugmenin kapisi ATS koluna kadar ilerlesin.
    const holder = captureInstance(app, 'Bridge', (instance) => {
        instance.setupState.amount = amount
        instance.setupState.bridgeData = {
            estimate: { toAmount: '5000000000000000000', executionDuration: 30, feeCosts: [], gasCosts: [] },
            action: { fromChainId: chain.chainId, toChainId: toChain.chainId, fromToken: inToken, toToken: { decimals: 18 }, fromAmount: '5000000000000000000' },
            transactionRequest: { to: '0x1111111111111111111111111111111111111111', data: '0x', value: '0' },
        }
    })
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState }
}

describe('Bridge.vue (SSR) -- ATS bakiyesi ucrete yetmiyor', () => {
    it('ucret kartinin icinde Send ile ayni blok cizilir ve dugme kilitlenir', async () => {
        const { html, state } = await ciz({ inToken: USDT_BSC, bakiye: 1 })

        expect(state.atsInsufficient).toBe(true)
        expect(html).toContain(BLOK_BASLIK)
        expect(html).toContain('You need ~21.76 ATS')
        expect(html.indexOf(BLOK_BASLIK)).toBeGreaterThan(html.indexOf('Fee paid with ATS'))

        expect(state.isValid()).toBe(false)
        expect(dugmeMetni(html)).toBe('Insufficient Balance')
    })

    it('ESLENMIS: bakiye yetiyorsa blok yok, dugme acik', async () => {
        const { html, state } = await ciz({ inToken: USDT_BSC, bakiye: 100 })

        expect(state.atsInsufficient).toBe(false)
        expect(html).not.toContain(BLOK_BASLIK)
        expect(state.isValid()).toBe(true)
        expect(dugmeMetni(html)).toBe('Bridge')
    })

    // BSC ATS kopruleniyor: ucret (21.76) + gonderilen (5) = 26.76 > 25.
    it('BSC ATS kopruleniyorsa gonderilen miktar da sayilir', async () => {
        const { html, state } = await ciz({ inToken: ATS_BSC, amount: 5, bakiye: 25 })

        expect(state.bridgingAts).toBe(true)
        expect(state.atsInsufficient).toBe(true)
        expect(html).toContain('You need ~26.76 ATS')
        expect(state.isValid()).toBe(false)
    })

    // ESLENMIS: ayni miktar ve bakiye, ATS OLMAYAN bir token -- yalniz ucret sayilir.
    it('ESLENMIS: ATS disi token ayni bakiyeyle gecer', async () => {
        const { state } = await ciz({ inToken: USDT_BSC, amount: 5, bakiye: 25 })

        expect(state.bridgingAts).toBe(false)
        expect(state.atsInsufficient).toBe(false)
        expect(state.isValid()).toBe(true)
    })

    // Spoke zincirde ATSOFT ucret bakiyesi degil: miktar EKLENMEZ.
    it('Ethereum da ATSOFT kopruleniyorsa miktar sayilmaz', async () => {
        const { state } = await ciz({ chain: ETH_CHAIN, toChain: BSC_CHAIN, inToken: ATSOFT_ETH, amount: 5, bakiye: 25 })

        expect(state.bridgingAts).toBe(false)
        expect(state.atsInsufficient).toBe(false)
        expect(state.isValid()).toBe(true)
    })
})

// BLOGUN IKI DISLAMASI -- sablon kosulunun `!atsLoading` ve buy-ats parcalari, GERCEK
// render ile (Takas'taki esi: SwapAtsInsufficient.ssr.test.js). Her iki durumda da
// `atsInsufficient` TRUE kalir: blogu gizleyen tek sey dislamanin kendisi olmali.
describe('Bridge.vue (SSR) -- yetersiz ATS blogu ne zaman CIZILMEZ', () => {
    it('teklif yenilenirken (atsLoading) blok cizilmez, dugme kilitli kalir', async () => {
        const { html, state } = await ciz({ inToken: USDT_BSC, bakiye: 1, loading: true })

        expect(state.atsLoading).toBe(true)
        expect(state.atsInsufficient).toBe(true)
        expect(html).toContain('Fee paid with ATS')
        expect(html).not.toContain(BLOK_BASLIK)
        expect(state.isValid()).toBe(false)
    })

    // Sunucu zaten "ATS al" diyorsa onu kartin altindaki engel karti anlatir; ayni sey
    // iki kez yazilmaz (Send kurali).
    it('sunucu buy-ats derken blok cizilmez, engel karti anlatir', async () => {
        const { html, state } = await ciz({
            inToken: USDT_BSC, bakiye: 1, decision: resolveAtsBlocker('balance-missing'),
        })

        expect(state.atsDecision.action).toBe('buy-ats')
        expect(state.atsInsufficient).toBe(true)
        expect(html).toContain('ATS balance required')
        expect(html).not.toContain(BLOK_BASLIK)
        expect(state.isValid()).toBe(false)
    })
})

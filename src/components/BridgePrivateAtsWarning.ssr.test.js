// Kopru ekraninda GIZLI MODDA ATS YETERSIZ / ATS AL durumu -- gercek render (2026-10-28 kullanici karari).
//
// Para yukle'deki ATS-once karti kaldirildi: ATS kontrolu ISLEM ANINDA, Takas ve Kopru'nun ATS ucret karti yapar. Kartin kirmizi
// baglanti uyarisi buraya tasindi: yalniz gizli modda ve yalniz ATS yetersiz / ATS Al durumunda. Bu dosya ayrica ISLEM ANI
// KONTROLUNUN gizli modda calistigini kanitlar: Gizli Hesap'ta ATS yokken kart "yetersiz" ya da "ATS gerekli" der, Kopru dugmesi
// kilitlenir ve (satis yolu aciksa) "ATS Al" dugmesi cizilir; PRIVATE_ATS_SALE kapaliysa dugme yerine aciklama cikar.
//
// useAtsOpFee SABITLENIR. 'vue' mock'u BURADA olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const satis = vi.hoisted(() => ({ acik: true }))
const bayrak = vi.hoisted(() => ({ privateAtsSale: true }))
vi.mock('../utils/featureFlags', async (importOriginal) => ({
    ...(await importOriginal()),
    get PRIVATE_ATS_SALE() { return bayrak.privateAtsSale },
}))
vi.mock('../composables/useAtsPurchase', async (importOriginal) => ({
    ...(await importOriginal()),
    useAtsPurchase: () => ({ live: satis.acik, open: async () => true }),
}))

const useTokenBalanceMock = vi.fn(async () => 1000)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

// Ucret 21.76 ATS. `bakiye` ve `decision` testin sectigi degerlerdir.
const durum = vi.hoisted(() => ({ bakiye: 0, decision: null }))
vi.mock('../composables/useAtsOpFee', async () => {
    const { ref } = await import('vue')
    const TOPLAM = 21.76
    const requiredAtsFor = (extra = 0) => TOPLAM + Number(extra || 0)
    return {
        useAtsOpFee: () => ({
            atsFee: ref(20.87), atsSymbol: ref('ATS'), atsBalance: ref(durum.bakiye), opCount: ref(2),
            bootstrapFee: ref(0.89), feeRefundable: ref(false), prepaid: ref(null),
            ready: ref(durum.bakiye >= TOPLAM), decision: ref(durum.decision), nextSteps: ref([]),
            loading: ref(false), error: ref(null), errorCode: ref(null), blocked: ref(false),
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

// Fiyat sorgusu gercek aga cikmasin (onMounted'ta atsPrice.loadById; yoksa localhost:8000'e ECONNREFUSED yazar).
vi.mock('../composables/useUsdPrice', async () => (await import('../test-utils/offlineMocks.js')).usdPriceOfflineModule())

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import { privacyStore } from '../store/privacy'
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
const UYARI_ID = 'data-testid="private-ats-link-warning"'
const UYARI_METNI = 'straight from your own wallet or an exchange'
const BLOK_BASLIK = 'Insufficient ATS balance'
const ENGEL_BASLIK = 'ATS balance required'
const DUGME = 'Buy ATS'
const SATIN_ALINAMAZ = 'ATS purchases are not available in private mode.'
const kacKez = (html, metin) => html.split(metin).length - 1

// Ana dugmenin OKUNAN metni: sayfanin SON dugmesi.
const dugmeMetni = (html) => {
    const bas = html.lastIndexOf('<button')
    const son = html.indexOf('</button>', bas)
    return html.slice(bas, son).replace(/<[^>]+>/g, '').trim()
}

afterEach(() => {
    useTokenBalanceMock.mockClear()
    delete globalThis.chrome
    satis.acik = true
    bayrak.privateAtsSale = true
    durum.bakiye = 0
    durum.decision = null
})

async function ciz({ gizli, bakiye, decision = null }) {
    durum.bakiye = bakiye
    durum.decision = decision
    installChromeStub({
        currentNetwork: BSC_CHAIN,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    })
    const app = createApp(Bridge)
    app.use(createTestPinia())
    app.use(createTestI18n())
    privacyStore().active = gizli
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
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState }
}

describe('Bridge.vue (SSR) -- gizli modda ATS YETERSIZ: kirmizi baglanti uyarisi', () => {
    it('Gizli Hesapta ATS yok (istemci hesabi: yetersiz): yetersiz blogu + kirmizi uyari, Kopru kilitli; uyari bloktan SONRA, TEK kez', async () => {
        const { html, state } = await ciz({ gizli: true, bakiye: 0 })

        // Islem ani kontrolu calisiyor: kart yetersiz diyor ve dugme kilitli.
        expect(state.atsInsufficient).toBe(true)
        expect(html).toContain('Fee paid with ATS')
        expect(html).toContain(BLOK_BASLIK)
        expect(state.isValid()).toBe(false)
        expect(dugmeMetni(html)).toBe('Insufficient Balance')
        // Kirmizi uyari
        expect(html).toContain(UYARI_METNI)
        expect(html).toMatch(/data-testid="private-ats-link-warning"[^>]*class="[^"]*text-red-600/)
        expect(kacKez(html, UYARI_ID)).toBe(1)
        expect(html.indexOf(UYARI_ID)).toBeGreaterThan(html.indexOf(BLOK_BASLIK))
    })

    it('sunucu "ATS al" derken (engel karti + ATS Al dugmesi): uyari dugmenin ARDINDA, TEK kez', async () => {
        const { html, state } = await ciz({ gizli: true, bakiye: 0, decision: resolveAtsBlocker('balance-missing') })

        expect(state.atsDecision.action).toBe('buy-ats')
        expect(html).toContain(ENGEL_BASLIK)
        expect(kacKez(html, DUGME)).toBe(1)
        expect(kacKez(html, UYARI_ID)).toBe(1)
        expect(html.indexOf(UYARI_ID)).toBeGreaterThan(html.indexOf(DUGME))
        expect(state.isValid()).toBe(false)
    })

    it('PRIVATE_ATS_SALE KAPALI: dugme yerine "gizli modda satin alinamaz" aciklamasi cikar, kirmizi uyari yine vardir', async () => {
        bayrak.privateAtsSale = false
        const { html } = await ciz({ gizli: true, bakiye: 0, decision: resolveAtsBlocker('balance-missing') })

        expect(html).toContain(ENGEL_BASLIK)
        expect(html).not.toContain(DUGME)
        expect(html).toContain(SATIN_ALINAMAZ)
        expect(kacKez(html, UYARI_ID)).toBe(1)
    })

    it('NORMAL modda ayni durumlarda uyari YOK (yetersiz blogu ve buy-ats)', async () => {
        for (const decision of [null, resolveAtsBlocker('balance-missing')]) {
            const { html } = await ciz({ gizli: false, bakiye: 0, decision })
            // Pozitif kontrol: kart gercekten yetersiz/engel durumunda cizildi.
            expect(html.includes(BLOK_BASLIK) || html.includes(ENGEL_BASLIK)).toBe(true)
            expect(html).not.toContain(UYARI_ID)
            expect(html).not.toContain(UYARI_METNI)
        }
    })

    it('ESLENMIS: gizli modda ATS yeterliyse (karar yok, yetersizlik yok) uyari YOK ve Kopru acik', async () => {
        const { html, state } = await ciz({ gizli: true, bakiye: 100 })

        expect(state.atsInsufficient).toBe(false)
        expect(html).toContain('Fee paid with ATS')
        expect(html).not.toContain(BLOK_BASLIK)
        expect(html).not.toContain(UYARI_ID)
        expect(state.isValid()).toBe(true)
        expect(dugmeMetni(html)).toBe('Bridge')
    })

    it('kaynak: uyari yardimci islevden okunur ve ATS Al engel kartinin ardinda cizilir', () => {
        const kaynak = readFileSync(fileURLToPath(new URL('./Bridge.vue', import.meta.url)), 'utf8')
        expect(kaynak).toMatch(/privateAtsLinkWarningVisible\(/)
        expect(kaynak).toMatch(/<AtsBuyButton v-if="atsDecision\.action === 'buy-ats'" \/>[\s\S]*?<PrivateAtsLinkWarning v-if="privateAtsLinkWarn"/)
    })
})

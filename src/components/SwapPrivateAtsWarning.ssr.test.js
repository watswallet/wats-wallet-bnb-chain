// Takas ekraninda ATS YETERSIZ / ATS AL durumu: ATS ucret karti ve kirmizi baglanti uyarisi -- gercek render (2026-10-28 kullanici
// karari; 2026-11-02 guncellemesi).
//
// 2026-11-02: gizli modda klasik Takas, VITE_PRIVATE_SWAP_BRIDGE'nin degeri ne olursa olsun YALNIZ "yalniz ATS satin alma" ekranidir
// (Swap.vue saleOnlyMode). O ekranda ATS ucret karti (AtsFeeCard) ve kirmizi baglanti uyarisi (PrivateAtsLinkWarning) cizilemez; bu yuzden
// eski gizli mod senaryolari tek bir OLUMSUZ kilitte toplandi (bayrak ACIK: kart ve uyari hic yok, "Buy ATS" ekrani var). Kartin ve
// uyarinin davranisi NORMAL modda (kart yetersiz/engel durumunu cizer, uyari orada yoktur) ve kaynak taramasiyla (uyari yardimci
// islevden okunur, bilesen kartin ardinda) kilitli kalir.
//
// useAtsOpFee SABITLENIR (konu kararin kendisi degil, ekranin onu nasil cizdigi). 'vue' mock'u BURADA olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Bayrak derleme sabitidir; bu dosya ona (vitest varsayilanina) GUVENMEZ: modullerden ONCE acikca 'true' yazilir, ilk test bunu olcer.
vi.hoisted(() => { process.env.VITE_PRIVATE_SWAP_BRIDGE = 'true' })

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Satis yolu sabit "canli" (PRIVATE_ATS_SALE vitest.config.js varsayilanindan 'true' gelir); bu dosyada hicbir test ikisini de degistirmez.
vi.mock('../composables/useAtsPurchase', async (importOriginal) => ({
    ...(await importOriginal()),
    useAtsPurchase: () => ({ live: true, open: async () => true }),
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

// Gizli Hesap'in BSC ATS bakiyesi (ATS_FUEL_BALANCE): null -> okunamadi (eksik miktar hesaplanamaz), sayi -> eksik-ATS bolumu cizilebilir.
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

// Ucret 21.76 ATS. `insufficient` ve `decision` testin sectigi degerlerdir.
const durum = vi.hoisted(() => ({ insufficient: true, decision: null, bakiye: 0 }))
vi.mock('../composables/useAtsOpFee', async () => {
    const { ref } = await import('vue')
    const TOPLAM = 21.76
    return {
        useAtsOpFee: () => ({
            atsFee: ref(20.87), atsSymbol: ref('ATS'), atsBalance: ref(durum.bakiye), opCount: ref(2),
            bootstrapFee: ref(0.89), feeRefundable: ref(false), prepaid: ref(null),
            ready: ref(!durum.insufficient), decision: ref(durum.decision), nextSteps: ref([]),
            loading: ref(false), error: ref(null), errorCode: ref(null), blocked: ref(false),
            commissionAts: ref('0'), commissionHuman: ref(0), commissionRegion: ref('local'), commissionTreasury: ref(null),
            hasCommission: ref(false), totalAtsCost: ref(TOPLAM), maxAtsSellRaw: ref(null),
            exceedsAtsCap: () => false,
            insufficient: ref(durum.insufficient),
            requiredAtsFor: (extra = 0) => TOPLAM + Number(extra || 0),
            insufficientFor: () => durum.insufficient,
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
import { PRIVATE_SWAP_BRIDGE } from '../utils/featureFlags'
import Swap from './Swap.vue'
import supported_chains from '../data/supported_chains.json'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const token = (symbol, address) => ({
    name: symbol, symbol, address, decimals: 18, chainId: 56, image: { thumb: '', large: '' },
})
const USDT = token('usdt', '0x55d398326f99059fF775485246999027B3197955')
const USDC = token('usdc', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d')

const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const UYARI_ID = 'data-testid="private-ats-link-warning"'
const UYARI_METNI = 'straight from your own wallet or an exchange'
const BLOK_BASLIK = 'Insufficient ATS balance'
const ENGEL_BASLIK = 'ATS balance required'
const DUGME = 'Buy ATS'

afterEach(() => {
    useTokenBalanceMock.mockClear()
    delete globalThis.chrome
    yakit.bakiye = null
    durum.insufficient = true
    durum.decision = null
    durum.bakiye = 0
})

async function ciz({ gizli, insufficient = true, decision = null, bakiye = null, atsBakiyesi = 0 }) {
    durum.insufficient = insufficient
    durum.decision = decision
    durum.bakiye = atsBakiyesi
    yakit.bakiye = bakiye
    installChromeStub({
        currentNetwork: BSC_CHAIN,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    })
    const app = createApp(Swap)
    app.use(createTestPinia())
    app.use(createTestI18n())
    privacyStore().active = gizli
    networkStore().currentNetwork = BSC_CHAIN
    pageStore().currentPage = 'swap'
    const crypto = cryptoStore()
    crypto.swap.inToken = USDT
    crypto.swap.outToken = USDC
    const holder = captureInstance(app, 'Swap', (instance) => {
        instance.setupState.inTokenAmount = 5
        instance.setupState.swapData = { expectedOutput: '5', exchangeRate: '1', depthGateWarning: false }
    })
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState }
}

describe('ortam', () => {
    it('ortam: bayrak bu dosyada gercekten acik', () => {
        expect(PRIVATE_SWAP_BRIDGE).toBe(true)
    })
})

describe('Swap.vue (SSR) -- ATS yetersiz: gizli modda klasik ucret karti hic yok (yalniz ATS satin alma), normal modda uyari yok', () => {
    it('gizli modda (bayrak ACIK) ATS ucret karti ve kirmizi baglanti uyarisi hic cizilmez', async () => {
        // Bayrak bu dosyada gercekten acik (yoksa "bayraktan bagimsiz" iddiasi bos gecerdi).
        expect(PRIVATE_SWAP_BRIDGE).toBe(true)
        const senaryolar = [
            { insufficient: true },
            { insufficient: true, decision: resolveAtsBlocker('balance-missing') },
            { insufficient: true, decision: resolveAtsBlocker('balance-missing'), bakiye: 1 },
            { insufficient: false, atsBakiyesi: 100 },
        ]
        for (const [i, ek] of senaryolar.entries()) {
            const { html, state } = await ciz({ gizli: true, ...ek })

            expect(state.saleOnlyMode, 'senaryo ' + i).toBe(true)
            // Pozitif kontrol: ekran gercekten "yalniz ATS satin alma" ekrani ("Buy ATS" basligi).
            expect(html, 'senaryo ' + i).toContain(DUGME)
            for (const yasak of ['Fee paid with ATS', BLOK_BASLIK, ENGEL_BASLIK, 'Missing balance', UYARI_ID, UYARI_METNI]) {
                expect(html, 'senaryo ' + i + ': ' + yasak).not.toContain(yasak)
            }
        }
    })

    it('NORMAL modda ayni durumlarda uyari YOK (yetersiz blogu, buy-ats ve eksik-ATS)', async () => {
        for (const ek of [{}, { decision: resolveAtsBlocker('balance-missing') }, { decision: resolveAtsBlocker('balance-missing'), bakiye: 1 }]) {
            const { html } = await ciz({ gizli: false, insufficient: true, ...ek })
            // Pozitif kontrol: kart gercekten yetersiz/engel durumunda cizildi.
            expect(html.includes(BLOK_BASLIK) || html.includes(ENGEL_BASLIK) || html.includes('Missing balance')).toBe(true)
            expect(html).not.toContain(UYARI_ID)
            expect(html).not.toContain(UYARI_METNI)
        }
    })

    it('kaynak: uyari yardimci islevden okunur ve bilesen ATS ucret kartinin hemen ardinda cizilir', () => {
        const kaynak = readFileSync(fileURLToPath(new URL('./Swap.vue', import.meta.url)), 'utf8')
        expect(kaynak).toMatch(/privateAtsLinkWarningVisible\(/)
        expect(kaynak).toMatch(/<\/AtsFeeCard>\s*(<!--[\s\S]*?-->\s*)?<PrivateAtsLinkWarning v-if="privateAtsLinkWarn"/)
    })
})

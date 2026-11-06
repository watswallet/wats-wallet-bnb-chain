// Takas ekrani, GIZLI MOD (VITE_PRIVATE_SWAP_BRIDGE'nin degerinden bagimsiz): "yalniz ATS satin alma" kipi -- gercek render (2026-10-31, "ATS al bos ekran").
//
// Hata: gizli modda Gonder -> "ATS al" bos grafit ekran birakiyordu; satin alma ekrani Takas'in KENDISI (satis rotasi) ve 1.10 Takas'i
// gizli modda kapatmisti. Karar: Takas, Gizli Hesap kendi ATS alimini yapabildigi surece "yalniz ATS satin alma" ekranidir. Bu dosya
// ekranin O KIPTE ne olduguna bakar (App.vue kapisi: popup/privateSwapBridgeClosure.test.js):
//   - alinan token ATS'ye SABIT: secici ve yon dugmesi YOK; ag secici ve ayarlar YOK; baslik "ATS Al";
//   - satis cifti DISINDA hicbir istek gitmez: SWAP, SWAP_QUOTE, ATS_SWAP_FEE_QUOTE (ve Kopru) HIC; satis cifti ATS_SALE_QUOTE ister;
//   - cift satis cifti degilse acilista openAtsPurchase'in yardimcilariyla kurulur (gecerli odeme tokeni KORUNUR);
//   - BSC degil / satis canli degil / alim (PRIVATE_ATS_SALE) kapali: ekran ana sayfaya doner (bos ekran asla);
//   - KONTROL: normal modda ekran BUGUNKU gibi tam takastir; gizli modda bayrak ne olursa olsun yalniz ATS satin alma.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

// Bayrak derleme sabitidir; bu dosya ona (vitest varsayilanina) GUVENMEZ: modullerden ONCE acikca 'true' yazilir, ilk test bunu olcer.
vi.hoisted(() => { process.env.VITE_PRIVATE_SWAP_BRIDGE = 'true' })

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bayraklar derleme sabitidir; bu dosyada getter ile acilip kapatilir (SwapAtsSale.ssr.test.js deseni).
const bayrak = vi.hoisted(() => ({ privateAtsSale: true, satisCanli: true }))
vi.mock('../utils/featureFlags', async (importOriginal) => ({
    ...(await importOriginal()),
    get PRIVATE_ATS_SALE() { return bayrak.privateAtsSale },
}))
vi.mock('../utils/atsSaleConfig', async (importOriginal) => ({
    ...(await importOriginal()),
    isAtsSaleLive: () => bayrak.satisCanli,
}))
vi.mock('../composables/useAtsPurchase', async (importOriginal) => ({
    ...(await importOriginal()),
    useAtsPurchase: () => ({ live: bayrak.satisCanli, open: async () => true }),
}))

vi.mock('../composables/useUsdPrice', async () => (await import('../test-utils/offlineMocks.js')).usdPriceOfflineModule())
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 1000 }))
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
vi.mock('../composables/useAtsFuel', async () => {
    const { ref } = await import('vue')
    return {
        useAtsFuel: () => ({
            balance: ref(null), symbol: ref('ATS'), loading: ref(false), stale: ref(false),
            feePerOp: ref(null), level: ref('unknown'), opsLeft: ref(null), display: ref('—'), exact: ref('—'),
            load: async () => {}, refresh: async () => {}, setChain: async () => {},
        }),
    }
})

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import { privacyStore } from '../store/privacy'
import Swap from './Swap.vue'
import supported_chains from '../data/supported_chains.json'
import { ATS_SALE_ATS, ATS_SALE_PAY_TOKENS } from '../utils/atsSaleConfig'
import { isAtsSaleTarget } from '../utils/atsSaleRoute'
import { PRIVATE_SWAP_BRIDGE } from '../utils/featureFlags'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const token = (symbol, address) => ({
    name: symbol, symbol, address, decimals: 18, chainId: 56, image: { thumb: '', large: '' },
})
const USDT = token('usdt', '0x55d398326f99059fF775485246999027B3197955')
const USDC = token('usdc', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d')
const CAKE = token('cake', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82')
const ATS = token('ats', ATS_SALE_ATS)
const HESAP = '0xAbCdEf0000000000000000000000000000000001'

const YASAK_TIPLER = ['SWAP', 'SWAP_QUOTE', 'ATS_SWAP_FEE_QUOTE', 'ATS_BRIDGE_FEE_QUOTE', 'BRIDGE', 'BRIDGE_QUOTE']
const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

// Arka planin mapSaleQuote ciktisinin bicimi (SwapAtsSale.ssr.test.js ile ayni).
const SATIS_VERISI = {
    expectedOutput: '96.0', exchangeRate: '19.200000', reverseExchangeRate: '0.052083',
    priceImpact: '0.56%', depthGateWarning: false, minimumReceived: '96.0', slippageTolerance: '0.00%',
    liquidityProviderFee: 'N/A', routerType: { name: 'ATS_SALE', version: 1 },
    estimatedGasFee: { totalCost: '0', totalCostFormatted: '0', totalCostUSD: null, gasType: 'sponsored' },
    saleQuote: {
        quote: {
            buyer: HESAP, payToken: USDT.address, payAmount: '5000000000000000000',
            atsAmount: '96000000000000000000', deadline: 1790000000, quoteId: '0x' + 'ab'.repeat(32),
        },
        signature: '0x' + 'cd'.repeat(65), desk: '0x' + '1d'.repeat(20), sponsor: '0x' + '5b'.repeat(20),
        deadline: 1790000000, receivedAt: 1,
        display: { usdValue: '5', price: '0.05173', referencePrice: '0.0512', priceImpactPct: 0.56, commissionPct: 1, commissionAts: '960000000000000000' },
    },
}

afterEach(() => {
    delete globalThis.chrome
    bayrak.privateAtsSale = true
    bayrak.satisCanli = true
})

// `gizli`: gizli mod; `ag`: aktif zincir; `inToken`/`outToken`: ekran acilmadan once yazilan secim (openAtsPurchase deseni).
async function ciz({ gizli = true, ag = BSC_CHAIN, inToken = USDT, outToken = ATS } = {}) {
    const chrome = installChromeStub({
        currentNetwork: ag,
        active_account: { address: HESAP, key: 'acc1' },
    })
    const mesajlar = []
    chrome.setSendMessage(async (m) => {
        mesajlar.push(m)
        if (m?.type === 'ATS_SALE_QUOTE') return { data: SATIS_VERISI }
        return { error: 'beklenmeyen ' + m?.type }
    })
    const app = createApp(Swap)
    app.use(createTestPinia())
    app.use(createTestI18n())
    privacyStore().active = gizli
    networkStore().currentNetwork = ag
    pageStore().currentPage = 'swap'
    const crypto = cryptoStore()
    crypto.swap.inToken = inToken
    crypto.swap.outToken = outToken
    const holder = captureInstance(app, 'Swap')
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState, mesajlar, crypto }
}

const tipler = (mesajlar) => mesajlar.map((m) => m?.type)
const BASLIK = (html) => (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]?.trim()

describe('ortam', () => {
    it('ortam: bayrak bu dosyada gercekten acik', () => {
        expect(PRIVATE_SWAP_BRIDGE).toBe(true)
    })
})

describe('Swap.vue -- gizli mod: "yalniz ATS satin alma" ekrani (bayraktan bagimsiz)', () => {
    it('ekran cizilir: baslik "Buy ATS", alinan token ATS sabit (secici yok), yon dugmesi / ag secici / ayarlar YOK', async () => {
        const { html } = await ciz()

        expect(BASLIK(html)).toBe('Buy ATS')
        expect(html).toContain('data-testid="swap-receive-fixed"')
        expect(html).not.toContain('data-testid="swap-receive-picker"')
        expect(html).not.toContain('data-testid="swap-reverse"')
        expect(html).not.toContain('data-testid="swap-network"')
        expect(html).not.toContain('data-testid="swap-settings"')
        // Sabit alinan token ATS'yi soyler.
        expect(html.split('data-testid="swap-receive-fixed"')[1].slice(0, 400).toUpperCase()).toContain('ATS')
    })

    it('satis rotasi: odeme (USDT) -> ATS, odeme listesi YALNIZ BNB/USDT/USDC hedefi (isAtsSaleTarget)', async () => {
        const { state } = await ciz()

        expect(state.saleOnlyMode).toBe(true)
        expect(state.saleRoute).toBe(true)
        expect(isAtsSaleTarget({ chainId: 56, outTokenAddress: ATS_SALE_ATS })).toBe(true)
        expect(ATS_SALE_PAY_TOKENS.map((p) => p.symbol)).toEqual(['USDT', 'USDC', 'BNB'])
    })

    it('satis cifti + miktar: ATS_SALE_QUOTE gider; SWAP, SWAP_QUOTE, ATS_SWAP_FEE_QUOTE ve Kopru HIC gitmez', async () => {
        const { state, mesajlar } = await ciz()
        state.inTokenAmount = 5
        await state.getSwapData()
        await state.refreshAtsOpFee()

        expect(tipler(mesajlar)).toContain('ATS_SALE_QUOTE')
        for (const t of YASAK_TIPLER) expect(tipler(mesajlar)).not.toContain(t)
        expect(state.swapData?.saleQuote).toBeTruthy()
    })

    it('satis cifti DEGILKEN (kaynak baska token): hicbir teklif istenmez, "USDT, USDC veya BNB ile al" ipucu cikar, gonder kilitli', async () => {
        const { state, mesajlar, crypto } = await ciz()
        mesajlar.length = 0
        crypto.swap.inToken = CAKE
        state.inTokenAmount = 5
        await state.getSwapData()
        await state.refreshAtsOpFee()
        await state.swap()

        expect(state.saleRoute).toBe(false)
        expect(tipler(mesajlar)).toEqual([])
        expect(state.quoteError).toBe('route')
        expect(state.saleHint).toBe(true)
        expect(state.isValid()).toBe(false)
    })

    it('yon degistirme islevi de kipte etkisizdir (inToken/outToken yer degistirmez)', async () => {
        const { state, crypto } = await ciz()
        state.reverse()

        expect(crypto.swap.inToken.symbol).toBe('usdt')
        expect(crypto.swap.outToken.address.toLowerCase()).toBe(ATS_SALE_ATS.toLowerCase())
    })

    it('acilista cift satis cifti degilse openAtsPurchase yardimcilariyla kurulur: gecersiz kaynak -> USDT, alinan -> ATS', async () => {
        const { crypto } = await ciz({ inToken: CAKE, outToken: USDC })

        expect(crypto.swap.inToken.symbol).toBe('usdt')
        expect(crypto.swap.outToken.address.toLowerCase()).toBe(ATS_SALE_ATS.toLowerCase())
        expect(crypto.swap.outToken.chainId).toBe(56)
    })

    it('gecerli odeme tokeni (USDC) KORUNUR; yalniz alinan taraf ATS yapilir', async () => {
        const { crypto } = await ciz({ inToken: USDC, outToken: CAKE })

        expect(crypto.swap.inToken.symbol).toBe('usdc')
        expect(crypto.swap.outToken.address.toLowerCase()).toBe(ATS_SALE_ATS.toLowerCase())
    })

    it('gizli mod, PRIVATE_SWAP_BRIDGE acik: YINE yalniz ATS satin alma (tam takas yok)', async () => {
        // Bayrak bu dosyada gercekten acik (yoksa asagidaki "bagimsizlik" kilidi bos gecerdi).
        expect(PRIVATE_SWAP_BRIDGE).toBe(true)
        const { html, state } = await ciz({ gizli: true, inToken: USDT, outToken: USDC })

        expect(state.saleOnlyMode).toBe(true)
        expect(BASLIK(html)).toBe('Buy ATS')
        expect(html).toContain('data-testid="swap-receive-fixed"')
        expect(html).not.toContain('data-testid="swap-reverse"')
        expect(html).not.toContain('data-testid="swap-receive-picker"')
    })
})

describe('Swap.vue -- yalniz ATS satin alma kipi: kip calisamiyorsa ekran ana sayfaya doner (bos ekran asla)', () => {
    it('BSC degil: ana sayfa', async () => {
        await ciz({ ag: ETH_CHAIN })
        expect(pageStore().currentPage).toBe('home')
    })

    it('satis canli degil: ana sayfa', async () => {
        bayrak.satisCanli = false
        await ciz()
        expect(pageStore().currentPage).toBe('home')
    })

    it('Gizli Hesap alimi kapali (PRIVATE_ATS_SALE=false, uretim): ana sayfa', async () => {
        bayrak.privateAtsSale = false
        await ciz()
        expect(pageStore().currentPage).toBe('home')
    })

    it('KONTROL: kip calisirken sayfa DEGISMEZ', async () => {
        await ciz()
        expect(pageStore().currentPage).toBe('swap')
    })
})

describe('Swap.vue -- KONTROL: kip YALNIZ gizli modda; normal modda ekran bugunku gibi tam takas', () => {
    it('normal mod: baslik "Swap", secici, yon dugmesi, ag secici, ayarlar VAR', async () => {
        const { html, state } = await ciz({ gizli: false, inToken: USDT, outToken: USDC })

        expect(state.saleOnlyMode).toBe(false)
        expect(BASLIK(html)).toBe('Swap')
        for (const id of ['swap-receive-picker', 'swap-reverse', 'swap-network', 'swap-settings']) {
            expect(html, id).toContain(`data-testid="${id}"`)
        }
        expect(html).not.toContain('data-testid="swap-receive-fixed"')
    })

    it('normal mod: secimler DEGISTIRILMEZ (cift USDT/USDC kalir) ve ag BSC disi olsa da ana sayfaya donmez', async () => {
        const { crypto } = await ciz({ gizli: false, ag: ETH_CHAIN, inToken: CAKE, outToken: USDC })

        expect(pageStore().currentPage).toBe('swap')
        expect(crypto.swap.outToken.symbol).toBe('usdc')
    })
})

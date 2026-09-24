// Home.vue (SSR) — TON JETTON satirinin DOLAR KARSILIGI.
//
// KOK NEDEN (canli teshis 2026-09-18): jetton satiri ana ekranda DOGRU miktari
// ("12.5 USDT") gosteriyor ama dolar karsiligi HER ZAMAN "$0.00", degisimi "%0"
// kaliyordu. Sebep kimlik eksikligi DEGILDI -- sunucu kimligi yayinliyor (CANLI
// OLCUM: POST /getChainTokens {chainId:-239} -> USDT satiri coingecko_id:"tether")
// ama istemci jetton satiri icin fiyat eslemesini HIC YAPMIYORDU:
//
//   1. Home.vue'nun TON kolu `if (token.address !== NATIVE_TOKEN_ADDRESS) return`
//      ile jetton satirini fiyat eslemesinden ONCE disari atiyordu; asagidaki
//      jetton blogu yalnizca `amount` ve `error` yaziyordu. `price`/`change`/
//      `value`/`nowValue`/`oldValue` jetton icin HICBIR YERDE atanmiyordu.
//   2. utils/ton/jettonList.js'in mapper'i `coingecko_id` alanini GECIRMIYORDU,
//      yani blok fiyati eslemek isteseydi bile elinde kimlik olmayacakti (ayni
//      kusurun sunucu tarafi: e70b89d).
//
// Sonuc kullanici icin: bakiye var, portfoy toplami eksik. Spec'in gerekcesi:
// "Portfoy toplami eksik olursa kullanici parasinin kayboldugunu sanir."
//
// Bu dosya davranisa bakar: bakiye sozlugune GERCEK dolar degeri yazilmali ve
// deger portfoy toplamina KATILMALI.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))

const axiosPostMock = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
vi.mock('axios', () => ({
    default: {
        post: (...args) => axiosPostMock(...args),
        get: async () => ({ status: 200, data: { news: [] } }),
    },
}))

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} } }
})

// TON zinciri: adres/istemci/bakiye kollari saplanir. Bu dosyanin konusu FIYAT
// ESLEMESI; bakiye okumasinin KENDISI jettonBalance.test.js'in konusu.
vi.mock('../utils/ton/tonIdentity', () => ({ ensureTonAddress: async () => 'UQTestOwner' }))
vi.mock('../utils/ton/tonClient', () => ({ getTonClient: () => ({}) }))
vi.mock('../utils/ton/tonBalance', () => ({ getTonBalance: async () => 2 }))
vi.mock('../utils/ton/jettonAddress', () => ({ getJettonWalletAddress: async () => 'EQJettonWalletTest' }))
vi.mock('../utils/ton/jettonBalance', () => ({ getJettonBalance: async () => 12.5 }))

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { userStore } from '../store/user'
import Home from './Home.vue'
import supported_chains from '../data/supported_chains.json'

const TON = supported_chains.find((c) => c.chainId === -239)
const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'

// tokenBucketKey bicimi (alt cizgi) — Home.vue jetton anahtarini boyle kuruyor.
const JETTON_KEY = `-239_${USDT_MASTER}`
const NATIVE_KEY = '-239_0x0'

// CANLI OLCUM: POST /getTokensDataById {"ids":["the-open-network","tether"]}
const PRICES = [
    {
        coingecko_id: 'the-open-network',
        market_data: { priceUSD: 1.357, change: { h24: -1.2 }, sparkline: { d7: Array(144).fill(1.4) } },
    },
    {
        coingecko_id: 'tether',
        market_data: { priceUSD: 0.999189, change: { h24: 0.00143 }, sparkline: { d7: Array(144).fill(0.9998) } },
    },
]

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    axiosPostMock.mockImplementation(async (url) => {
        if (String(url).endsWith('/getTokensDataById')) return { status: 200, data: { tokens: PRICES } }
        return { status: 200, data: { tokens: [] } }
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
    axiosPostMock.mockClear()
    useSolanaAssetsMock.mockClear()
    delete globalThis.chrome
})

async function renderHome() {
    installChromeStub({
        currentNetwork: TON,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
        imported_tokens: {
            acc1: {
                '-239': [
                    {
                        name: 'TON', symbol: 'GRAM', decimals: 9, address: '0x0',
                        image: { thumb: '', small: '', large: '' }, coingecko_id: 'the-open-network',
                    },
                    {
                        name: 'Tether USD', symbol: 'USDT', decimals: 6, address: USDT_MASTER,
                        image: { thumb: '', small: '', large: '' }, coingecko_id: 'tether',
                    },
                ],
            },
        },
        vaults: [],
    })

    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = TON

    const captured = captureInstance(app, 'Home')
    const html = await render(app)

    return { html, captured, user: userStore() }
}

describe('Home.vue (SSR) -- jetton satiri DOLAR KARSILIGINI gosterir', () => {
    it('jetton bakiyesine fiyat ve deger YAZILIR (satir artik $0.00 degil)', async () => {
        const { user } = await renderHome()

        expect(user.tokenBalances[JETTON_KEY].amount).toBe(12.5)
        expect(user.tokenBalances[JETTON_KEY].price).toBeCloseTo(0.999189, 6)
        expect(user.tokenBalances[JETTON_KEY].value).toBeCloseTo(12.5 * 0.999189, 6)
    })

    it('24 saatlik degisim de yazilir (rozet artik hep %0 degil)', async () => {
        const { user } = await renderHome()

        expect(user.tokenBalances[JETTON_KEY].change).toBeCloseTo(0.00143, 6)
    })

    it('jetton degeri PORTFOY TOPLAMINA katilir', async () => {
        const { user } = await renderHome()

        // native GRAM (2 * 1.357) + jetton USDT (12.5 * 0.999189)
        expect(user.usd).toBeCloseTo(2 * 1.357 + 12.5 * 0.999189, 5)
    })

    it('yuzde hesabi icin nowValue/oldValue de yazilir', async () => {
        const { user } = await renderHome()

        expect(user.tokenBalances[JETTON_KEY].nowValue).toBeCloseTo(12.5 * 0.999189, 6)
        expect(user.tokenBalances[JETTON_KEY].oldValue).toBeCloseTo(12.5 * 0.9998, 6)
    })

    it('native GRAM satiri BOZULMAZ (mevcut davranis aynen korunur)', async () => {
        const { user } = await renderHome()

        expect(user.tokenBalances[NATIVE_KEY].amount).toBe(2)
        expect(user.tokenBalances[NATIVE_KEY].value).toBeCloseTo(2 * 1.357, 6)
    })
})

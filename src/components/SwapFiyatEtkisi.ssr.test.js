// Swap.vue (SSR) -- FIYAT ETKISI OLCULEMEDIGINDE kullanici uyarisiz kalmamali.
//
// Tasarim (Swap.vue priceImpactHigh yorumu): 'N/A%' (olculemedi) YUKSEK SAYILMAZ,
// takasi KILITLEMEZ; "ama uyari satiri o durumu ayrica bildiriyor". O satirin
// kosulu `depthGateWarning`a bagliydi ve bu bayrak V3 etkisinin HIC olculemedigi
// donemde yazilmisti (= V2 derinlik kapisinda elendi VE V3 kazandi). V3 artik
// prob ile olculuyor, yani bayrak iki yonde yanlis calisiyordu:
//   - V2 havuz uyusmazligi ya da V3 probunun dusmesi 'N/A' uretip bayrak false
//     kalinca kullanici NE onay karti NE uyari goruyordu (tasarimin kendi
//     kurali bozuktu);
//   - etki OLCULUP %5'i asinca "Fiyat etkisi yuksek" kartinin yaninda "fiyat
//     etkisi olculemedi" satiri da cikiyordu. TON'da ayni alan "etki yuksek"
//     anlamina geliyor (background.js) ve orada da ayni celiski vardi.
// Satir artik "etki olculemedi" kosuluna bagli; metni sebebe gore secilir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

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

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import Swap from './Swap.vue'
import supported_chains from '../data/supported_chains.json'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const TON_CHAIN = supported_chains.find((c) => c.chainId === -239)

const USDT = { name: 'Tether USD', symbol: 'usdt', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, chainId: 56, image: { thumb: '', large: '' } }
const USDC = { name: 'USD Coin', symbol: 'usdc', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, chainId: 56, image: { thumb: '', large: '' } }
const TON_TOKENLARI = {
    inToken: { name: 'GRAM', symbol: 'gram', address: '0x0', decimals: 9, chainId: -239, image: { thumb: '', large: '' } },
    outToken: { name: 'Tether USD', symbol: 'usdt', address: '0:' + 'a'.repeat(64), decimals: 6, chainId: -239, image: { thumb: '', large: '' } },
}

// Gorunen metinler (EN).
const GENEL = 'Price impact could not be measured for this route.'
const DERINLIK = 'The deepest pool was skipped at this size; price impact could not be measured for the route used.'
const OLCULEMEDI = 'could not be measured'
const YUKSEK_KART = 'High price impact'

const yorumsuz = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

afterEach(() => {
    delete globalThis.chrome
})

async function ciz(zincir, swapData, tokenlar = { inToken: USDT, outToken: USDC }) {
    installChromeStub({
        currentNetwork: zincir,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    })
    const app = createApp(Swap)
    app.use(createTestPinia())
    app.use(createTestI18n())

    networkStore().currentNetwork = zincir
    pageStore().currentPage = 'swap'
    const crypto = cryptoStore()
    crypto.swap.inToken = tokenlar.inToken
    crypto.swap.outToken = tokenlar.outToken

    const holder = captureInstance(app, 'Swap', (instance) => {
        instance.setupState.inTokenAmount = 5
        instance.setupState.swapData = { expectedOutput: '5', exchangeRate: '1', ...swapData }
    })
    const html = yorumsuz(await render(app))
    return { html, state: holder.instance.setupState }
}

describe('EVM: fiyat etkisi olculemedi', () => {
    it('derinlik kapisi devrede DEGILKEN de uyari cikar (eskiden sessizdi)', async () => {
        const { html, state } = await ciz(BSC_CHAIN, { priceImpact: 'N/A%', depthGateWarning: false })

        expect(html).toContain(GENEL)
        expect(html).not.toContain(DERINLIK)
        // Tasarim karari: olculemeyen etki UYARIR ama KILITLEMEZ.
        expect(state.priceImpactHigh).toBe(false)
        expect(html).not.toContain(YUKSEK_KART)
    })

    it('derinlik kapisi devredeyse sebebi soyleyen metin cikar', async () => {
        const { html } = await ciz(BSC_CHAIN, { priceImpact: 'N/A%', depthGateWarning: true })

        expect(html).toContain(DERINLIK)
        expect(html).not.toContain(GENEL)
    })
})

describe('etki OLCULDU: "olculemedi" demek yanlis', () => {
    it('EVM: V3 probu etkiyi olcup %5 i asinca yalniz onay karti cikar', async () => {
        const { html, state } = await ciz(BSC_CHAIN, { priceImpact: '12.00%', depthGateWarning: true })

        expect(state.priceImpactHigh).toBe(true)
        expect(html).toContain(YUKSEK_KART)
        expect(html).not.toContain(OLCULEMEDI)
    })

    it('EVM: olculen dusuk etkide ne kart ne uyari', async () => {
        const { html, state } = await ciz(BSC_CHAIN, { priceImpact: '1.00%', depthGateWarning: false })

        expect(state.priceImpactHigh).toBe(false)
        expect(html).not.toContain(YUKSEK_KART)
        expect(html).not.toContain(OLCULEMEDI)
    })

    it('TON: depthGateWarning "etki yuksek" demek; onay karti cikar, "olculemedi" CIKMAZ', async () => {
        const { html, state } = await ciz(TON_CHAIN, { priceImpact: '8.00%', depthGateWarning: true }, TON_TOKENLARI)

        expect(state.priceImpactHigh).toBe(true)
        expect(html).toContain(YUKSEK_KART)
        expect(html).not.toContain(OLCULEMEDI)
    })
})

// TON teklifinde etki yoksa background `(undefined * 100).toFixed(2)` ile 'NaN%'
// uretir. Kural zincirden bagimsiz: olculemeyen etki TON'da da uyarir.
describe('TON: fiyat etkisi olculemedi', () => {
    it('genel uyari cikar, takas kilitlenmez', async () => {
        const { html, state } = await ciz(TON_CHAIN, { priceImpact: 'NaN%', depthGateWarning: false }, TON_TOKENLARI)

        expect(html).toContain(GENEL)
        expect(state.priceImpactHigh).toBe(false)
    })
})

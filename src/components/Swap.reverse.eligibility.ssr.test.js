// Swap.vue (SSR) -- reverse() uygun olmayan hisseyi "Alinan" tarafina TASIMAZ (Ilk Alim Kapisi, Task 46; K34; spec 6.8).
//
// KOK NEDEN: reverse() Odenen ile Alinan'i yer degistirir; Odenen uygun olmayan bir hisse (Sat yoluyla elde tutulan
// bStocks) ise cevirme onu "Alinan"a, yani edinme (Al) tarafina tasirdi ve secicinin suzgecini atlatirdi. Bu dosyanin
// kapattigi hata siniflari:
//  (1) uygun olmayan hisse ile cevirme yapilir (inToken / outToken degisir);
//  (2) store hazir degilken (yukleme = gizli) cevirme yapilir ya da ready olunca HIC yapilmaz;
//  (3) hisse olmayan Odenen ile cevirme engellenir ya da hisse olmayan Odenen icin uygunluk mesaji gider;
//  (4) Swap.vue kendi aboneligini tasimaz (swapTo popup'tir, reverse() calisirken kapalidir): tekil store'un anlik
//      goruntusune guvenilirse store hic acilmaz ve cevirme sonsuza dek reddedilir.
// Bu yuzden GERCEK useStockEligibility ve GERCEK tekil store kullanilir; uygunluk yaniti installChromeStub'in
// `eligibility` secenegiyle surulur (STOCK_GATE_STATUS mesaji).
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bu dosyanin konusu reverse() kapisi: gercek bakiye / kotasyon / TON agina ihtiyac yok (Swap.stockGate.ssr.test.js ile AYNI mock seti).
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))
vi.mock('../composables/useUsdPrice', async () => {
    const { ref } = await import('vue')
    return { useUsdPrice: () => ({ price: ref(null), loadById: async () => {} }) }
})
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

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { yorumsuz } from '../test-utils/kaynakTarama'
import { disposeStockEligibilityStore, getStockEligibilityStore } from '../composables/useStockEligibility'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import Swap from './Swap.vue'
import supported_chains from '../data/supported_chains.json'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'

const here = dirname(fileURLToPath(import.meta.url))
const BSC_CHAIN = supported_chains.find((c) => c.chainId === BSTOCKS_CHAIN_ID)
const GOOGLB = BSTOCKS.find((t) => t.symbol === 'GOOGLB')
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'

const tokenKaydi = (over = {}) => ({
    name: 'Alphabet', symbol: 'googlb', address: GOOGLB.address, decimals: 18, chainId: BSTOCKS_CHAIN_ID,
    image: { thumb: '', large: '' }, ...over,
})
const HISSE = () => tokenKaydi()
const USDT = () => tokenKaydi({ name: 'Tether USD', symbol: 'usdt', address: USDT_BSC })
const USDC = () => tokenKaydi({ name: 'USD Coin', symbol: 'usdc', address: USDC_BSC })

const verdict = (decision, reason, ipCountry = null) => ({ decision, reason, ipCountry })
const UYGUN = { bstocks: verdict('OK', 'OK'), xstocks: verdict('OK', 'OK') }
const UYGUN_DEGIL = { bstocks: verdict('BLOCKED', 'IP_COUNTRY_ISSUER', 'TR'), xstocks: verdict('OK', 'OK') }

let mesajlar
let eligibility
beforeEach(() => {
    mesajlar = []
    eligibility = (m) => { mesajlar.push(m); return UYGUN }
    disposeStockEligibilityStore()
})
afterEach(() => {
    disposeStockEligibilityStore()
    delete globalThis.chrome
})

let holderOf = null
async function ekran({ inToken, outToken }) {
    holderOf = null
    const stub = installChromeStub({
        currentNetwork: BSC_CHAIN,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    }, { eligibility: (m) => eligibility(m) })
    stub.setSendMessage(async () => ({ error: 'yapilandirilmadi' }))
    const app = createApp(Swap)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = BSC_CHAIN
    pageStore().currentPage = 'swap'
    const crypto = cryptoStore()
    crypto.swap.inToken = inToken
    crypto.swap.outToken = outToken
    const holder = captureInstance(app, 'Swap', (instance) => { holderOf = instance.setupState })
    await render(app)
    return { st: holder.instance.setupState, crypto }
}

const durumSayisi = () => mesajlar.filter((m) => m?.type === 'STOCK_GATE_STATUS').length

describe('Swap reverse ssr: uygun olmayan hisse Alinan\'a tasinmaz (K34)', () => {
    it('Swap reverse: Odenen uygun olmayan bStocks iken reverse() Alinan\'a tasimaz (inToken / outToken degismez)', async () => {
        eligibility = (m) => { mesajlar.push(m); return UYGUN_DEGIL }
        const hisse = HISSE()
        const usdt = USDT()
        const { st, crypto } = await ekran({ inToken: hisse, outToken: usdt })
        st.reverse()
        expect(crypto.swap.inToken.address).toBe(hisse.address)
        expect(crypto.swap.outToken.address).toBe(usdt.address)
    })

    it('Swap reverse: uygun bStocks ve hisse olmayan token tasinir', async () => {
        const { st, crypto } = await ekran({ inToken: HISSE(), outToken: USDT() })
        st.reverse()
        expect(crypto.swap.inToken.address).toBe(USDT_BSC)
        expect(crypto.swap.outToken.address).toBe(GOOGLB.address)
        // hisse olmayan Odenen: cevirme her zaman yapilir (uygunluk bilinmese bile)
        const iki = await ekran({ inToken: USDC(), outToken: USDT() })
        iki.st.reverse()
        expect(iki.crypto.swap.inToken.address).toBe(USDT_BSC)
        expect(iki.crypto.swap.outToken.address).toBe(USDC_BSC)
    })

    it('Swap reverse: store hazir degilken (ELIGIBILITY_LOADING) hisse olan Odenen icin cevirme yapilmaz; ready + uygun olunca yapilir', async () => {
        let ac
        const bekle = new Promise((coz) => { ac = coz })
        eligibility = async (m) => { mesajlar.push(m); await bekle; return UYGUN }
        // yanit gelmedigi surece render onServerPrefetch'te asili kalir: render'i BEKLEMEDEN store loading iken yokla.
        const bitti = ekran({ inToken: HISSE(), outToken: USDT() })
        await vi.waitFor(() => expect(durumSayisi()).toBe(1))
        const crypto = cryptoStore()
        await vi.waitFor(() => expect(crypto.swap.inToken).toBeTruthy())
        expect(getStockEligibilityStore().snapshot().status).toBe('loading')
        await vi.waitFor(() => expect(holderOf).toBeTruthy())
        holderOf.reverse()
        expect(crypto.swap.inToken.address).toBe(GOOGLB.address)
        expect(crypto.swap.outToken.address).toBe(USDT_BSC)
        // yanit gelince: ready + uygun -> cevirme yapilir
        ac()
        const { st } = await bitti
        expect(getStockEligibilityStore().snapshot().status).toBe('ready')
        st.reverse()
        expect(crypto.swap.inToken.address).toBe(USDT_BSC)
        expect(crypto.swap.outToken.address).toBe(GOOGLB.address)
    })

    it('Swap reverse: Swap.vue kendi aboneliklerini yalniz Odenen token hisseyse acar (hisse olmayan Odenen ile hic STOCK_GATE_STATUS gitmez)', async () => {
        await ekran({ inToken: USDC(), outToken: USDT() })
        expect(durumSayisi()).toBe(0)

        mesajlar = []
        disposeStockEligibilityStore()
        await ekran({ inToken: HISSE(), outToken: USDT() })
        expect(durumSayisi()).toBe(1)
    })

    it('Swap reverse: Odenen hisse + kendi aboneligi: kaynakta stockOutputIssuer(inToken) olcutu ve reverse() unavailableOutput ile kapili', () => {
        const kod = yorumsuz(readFileSync(join(here, 'Swap.vue'), 'utf8'))
        expect(kod).toMatch(/useStockEligibility\(\{\s*enabled: \(\) => stockOutputIssuer\(network\.currentNetwork\?\.chainId, crypto\.swap\.inToken\?\.address\) !== null/)
        expect(kod).toMatch(/if \(unavailableOutput\(network\.currentNetwork\?\.chainId, in_token\?\.address, reverseIssuerAvailable\)\) return/)
    })
})

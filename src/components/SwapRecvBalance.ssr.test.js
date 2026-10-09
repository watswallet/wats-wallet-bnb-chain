// Takas ekraninda ALINAN tarafin "Balance:" satiri -- gercek render (bkz. src/test-utils/ssrRender.js).
//
// HATA (1.9.0): "ATS Al" kisayolu (openAtsPurchase) inToken/outToken'i ve currentPage'i Swap.vue
// KURULMADAN ONCE yazar. Alinan tarafin bakiyesi yalniz `watch(() => crypto.swap.outToken)` ile
// okunuyordu; izleyici KURULDUGU andaki degeri ATESLEMEZ (immediate yok), yani onceden secilmis
// outToken icin okuma HIC yapilmiyor ve ekran cuzdanda 216.56 ATS varken "Balance: 0" gosteriyordu.
// Odeme tarafi onMounted'ta ayrica tohumlandigi icin dogruydu. Hata satis yoluna OZGU DEGIL: onceden
// secilmis her outToken (kisayol bugun tek uretici) ayni sekilde bos kalir.
//
// OLCTUGU: "ekran kurulurken outToken zaten doluysa onun bakiyesi okunur". SSR'da izleyiciler hic
// atesleme yapmaz; bu dosya yalniz onMounted tohumunu olcer. Izleyici yolu (kullanici swapTo
// penceresinden token secer) swapWiring.test.js'te kaynak kilidiyle korunur.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Adrese gore cevap veren TEK okuyucu: Swap.vue'nun okuBakiye'si iki taraf icin de buradan gecer.
const bal = vi.hoisted(() => ({ calls: [], table: {}, fail: new Set() }))
vi.mock('../composables/useTokenBalance', () => ({
    useTokenBalance: async (wallet, tokenAddress, rpc, chainId) => {
        bal.calls.push({ wallet, tokenAddress, rpc, chainId })
        const k = String(tokenAddress).toLowerCase()
        // ethers cuzdan adresi undefined iken reddeder; setup aninda (activeAccount henuz null) okuyan bir
        // izleyici ({ immediate: true }) bu yuzden COZUM DEGIL ve test onu yakalar.
        if (!wallet) throw new Error('invalid address (cuzdan yok)')
        if (bal.fail.has(k)) throw new Error('rpc down')
        return k in bal.table ? bal.table[k] : 0
    },
}))
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
// Fiyat sorgusu gercek aga cikmasin (ekran onMounted'ta atsPrice.loadById cagiriyor).
vi.mock('../composables/useUsdPrice', async () => {
    const { ref } = await import('vue')
    return { useUsdPrice: () => ({ price: ref(null), loadById: async () => {} }) }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import Swap from './Swap.vue'
import { openAtsPurchase, salePayRecord } from '../composables/useAtsPurchase'
import supported_chains from '../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const HESAP = '0xAbCdEf0000000000000000000000000000000001'
const ADRES = {
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    ATS: '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d',
}
const USDT_KAYDI = { name: 'Tether USD', symbol: 'usdt', address: ADRES.USDT, decimals: 18, chainId: 56 }
// Kullanicinin ekran goruntusundeki sayilar: 0.0084 BNB, 216.5616 ATS.
const ELDEKI = () => ({ '0x0': 0.0084, [ADRES.USDT.toLowerCase()]: 0, [ADRES.USDC.toLowerCase()]: 0, [ADRES.ATS.toLowerCase()]: 216.5616 })

const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
// Sirayla [odeme, alinan] "Balance:" metinleri. Alinan satir yalniz outToken varken cizilir.
const bakiyeSatirlari = (html) => [...gorunen(html).matchAll(/Balance: ([^<]*)</g)].map((m) => m[1].trim())

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete globalThis.chrome
    bal.calls.length = 0
    bal.table = {}
    bal.fail.clear()
})

function ortam() {
    vi.stubGlobal('setInterval', vi.fn(() => 7))
    vi.stubGlobal('clearInterval', () => {})
    installChromeStub({
        currentNetwork: BSC,
        active_account: { address: HESAP, key: 'acc1', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" },
    }).setSendMessage(async () => ({}))
    const pinia = createTestPinia()
    networkStore().currentNetwork = BSC
    networkStore().rpc = 'https://bsc.example'
    return pinia
}

// Swap, tokenler depoda ZATEN yazilmisken kurulur: App.vue <Swap v-if="currentPage === 'swap'"> boyle kurar.
async function swapiKur(pinia) {
    const app = createApp(Swap)
    app.use(pinia)
    app.use(createTestI18n())
    const oncekiOkuma = bal.calls.length
    const html = await render(app)
    return { html, rows: bakiyeSatirlari(html), kurulumOkumalari: bal.calls.slice(oncekiOkuma) }
}

describe('Swap.vue (SSR) -- onceden secilmis outToken icin alinan taraf bakiyesi', () => {
    it('"ATS Al" kisayolu: odeme tarafi BNB, alinan taraf ATS bakiyesini gosterir', async () => {
        bal.table = ELDEKI()
        const pinia = ortam()
        await openAtsPurchase({ t: (k) => k })
        expect(pageStore().currentPage).toBe('swap')

        const { rows, kurulumOkumalari } = await swapiKur(pinia)

        expect(rows).toEqual(['0.0084', '216.5616'])
        expect(kurulumOkumalari.map((c) => c.tokenAddress.toLowerCase())).toContain(ADRES.ATS.toLowerCase())
    })

    it('satis yolu DEGIL (BNB -> USDT) onceden secilince de alinan taraf okunur', async () => {
        bal.table = { ...ELDEKI(), [ADRES.USDT.toLowerCase()]: 1234.5 }
        const pinia = ortam()
        cryptoStore().swap.inToken = salePayRecord('BNB')
        cryptoStore().swap.outToken = { ...USDT_KAYDI }
        pageStore().currentPage = 'swap'

        const { rows } = await swapiKur(pinia)

        // Odeme satiriyla ayni bicim: 4 ondalik (eskiden ham sayi "1234.5" basiliyordu).
        expect(rows).toEqual(['0.0084', '1234.5000'])
    })

    it('okuma AKTIF hesapla, AKTIF agin rpc ve zincir kimligiyle yapilir', async () => {
        bal.table = ELDEKI()
        const pinia = ortam()
        await openAtsPurchase({ t: (k) => k })

        const { kurulumOkumalari } = await swapiKur(pinia)

        const ats = kurulumOkumalari.find((c) => c.tokenAddress.toLowerCase() === ADRES.ATS.toLowerCase())
        expect(ats).toEqual({ wallet: HESAP, tokenAddress: ADRES.ATS, rpc: 'https://bsc.example', chainId: 56 })
    })

    it('okuma duserse alinan taraf 0 olur ve ekran bozulmaz', async () => {
        bal.table = ELDEKI()
        bal.fail.add(ADRES.ATS.toLowerCase())
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const pinia = ortam()
        await openAtsPurchase({ t: (k) => k })

        const { rows } = await swapiKur(pinia)

        expect(rows).toEqual(['0.0084', '0.0000'])
    })

    it('outToken YOKKEN alinan satir cizilmez ve onun icin okuma yapilmaz', async () => {
        bal.table = ELDEKI()
        const pinia = ortam()
        cryptoStore().swap.inToken = salePayRecord('BNB')
        cryptoStore().swap.outToken = null
        pageStore().currentPage = 'swap'

        const { rows, kurulumOkumalari } = await swapiKur(pinia)

        expect(rows).toEqual(['0.0084'])
        expect(kurulumOkumalari.map((c) => c.tokenAddress)).toEqual(['0x0'])
    })
})

// Alinan satir, odeme satiriyle (Number(inBalance).toFixed(4)) AYNI bicimde yazilir. Eskiden ham sayi
// basiliyordu: 216.56160493021233 gibi 14 haneli bir kuyruk satira sigmiyor ve odeme satirina benzemiyordu.
describe('Swap.vue (SSR) -- alinan taraf bakiyesi 4 ondalikla yazilir', () => {
    it('ham uzun sayi 4 ondalika yuvarlanir (216.56160493021233 -> 216.5616)', async () => {
        bal.table = { ...ELDEKI(), [ADRES.ATS.toLowerCase()]: 216.56160493021233 }
        const pinia = ortam()
        await openAtsPurchase({ t: (k) => k })

        const { rows, html } = await swapiKur(pinia)

        expect(rows).toEqual(['0.0084', '216.5616'])
        expect(gorunen(html)).not.toContain('216.56160493021233')
    })

    it('bakiye yokken odeme satirinin sifir durumuyla ayni: 0.0000', async () => {
        bal.table = { ...ELDEKI(), [ADRES.ATS.toLowerCase()]: 0 }
        const pinia = ortam()
        await openAtsPurchase({ t: (k) => k })

        const { rows } = await swapiKur(pinia)

        expect(rows).toEqual(['0.0084', '0.0000'])
    })

    it('iki taraf da sifirken ayni sifir bicimi: odeme 0.0000, alinan 0.0000', async () => {
        bal.table = ELDEKI()
        const pinia = ortam()
        cryptoStore().swap.inToken = { ...USDT_KAYDI }
        cryptoStore().swap.outToken = { name: 'USD Coin', symbol: 'usdc', address: ADRES.USDC, decimals: 18, chainId: 56 }
        pageStore().currentPage = 'swap'

        const { rows } = await swapiKur(pinia)

        expect(rows).toEqual(['0.0000', '0.0000'])
    })
})

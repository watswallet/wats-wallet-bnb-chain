// Takas ekraninda ATS SATIS YOLU -- gercek render (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §6.3).
//
// Olculen: satis yolunun SECILMESI (bayrak + BSC + hedef ATS + kaynak USDT/USDC/BNB), bu yolda ATS
// ucret karti / gaz karti / ATS ve gaz kapilarinin KAPANMASI (ATS'si ve BNB'si olmayan kullanici
// dugmeyi acabilmeli), ekrandaki satis bilgileri, satis hatalari, "USDT, USDC veya BNB ile al"
// ipucu ve 20 sn'lik yenileme. Bayrak kapaliyken ekran BUGUNKU gibi davranir.
//
// useAtsOpFee SABITLENIR: ATS'si olmayan kullanicinin ucret karari (buy-ats, yetersiz, hazir degil).
// Iddialar CEVRILMIS metin uzerinde; SSR sablon yorumlarini ciktiya bastigi icin yorumlar atilir.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const satis = vi.hoisted(() => ({ acik: true }))
vi.mock('../utils/atsSaleConfig', async (importOriginal) => ({
    ...(await importOriginal()),
    isAtsSaleLive: () => satis.acik,
}))

// "ATS Al" acicisi: gercek openAtsPurchase ag degistirir/chrome'a konusur; burada yalniz CAGRILDIGI
// ve o ANDA yerel durumun temiz oldugu olculur. `live` bayrak kapisini aynen izler.
const atsAc = vi.hoisted(() => ({ cagrilar: [], durumlar: [], oku: null }))
vi.mock('../composables/useAtsPurchase', async (importOriginal) => ({
    ...(await importOriginal()),
    useAtsPurchase: () => ({
        live: satis.acik,
        open: async () => { atsAc.cagrilar.push(1); atsAc.durumlar.push(atsAc.oku?.()); return true },
    }),
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

// `durum.yetersiz`: true -> ATS'si olmayan kullanici (buy-ats, hazir degil); false -> ATS hazir.
const durum = vi.hoisted(() => ({ yetersiz: true }))
const atsLoad = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../composables/useAtsOpFee', async () => {
    const { ref } = await import('vue')
    const { resolveAtsBlocker } = await import('../utils/atsBlocker')
    return {
        useAtsOpFee: () => ({
            atsFee: ref(20.87), atsSymbol: ref('ATS'), atsBalance: ref(durum.yetersiz ? 0 : 100), opCount: ref(1),
            bootstrapFee: ref(0), feeRefundable: ref(false), prepaid: ref(null),
            ready: ref(!durum.yetersiz), decision: ref(durum.yetersiz ? resolveAtsBlocker('balance-missing') : null),
            nextSteps: ref([]), loading: ref(false), error: ref(null), errorCode: ref(null), blocked: ref(durum.yetersiz),
            commissionAts: ref('0'), commissionHuman: ref(0), commissionRegion: ref('local'), commissionTreasury: ref(null),
            hasCommission: ref(false), totalAtsCost: ref(20.87), maxAtsSellRaw: ref(null),
            exceedsAtsCap: () => false,
            insufficient: ref(durum.yetersiz),
            requiredAtsFor: (extra = 0) => 20.87 + Number(extra || 0),
            insufficientFor: () => durum.yetersiz,
            load: atsLoad, runOnboarding: async () => true, reset: () => {},
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
const token = (symbol, address) => ({
    name: symbol, symbol, address, decimals: 18, chainId: 56, image: { thumb: '', large: '' },
})
const USDT = token('usdt', '0x55d398326f99059fF775485246999027B3197955')
const USDC = token('usdc', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d')
const BNB_SIFIR = token('bnb', '0x0000000000000000000000000000000000000000')
const CAKE = token('cake', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82')
const ATS = token('ats', '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d')
const HESAP = '0xAbCdEf0000000000000000000000000000000001'

// Arka planin mapSaleQuote ciktisinin bicimi (Task 3).
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
const TAKAS_VERISI = { expectedOutput: '5', exchangeRate: '1', priceImpact: '0.10%', depthGateWarning: false }

const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
// Ana dugmenin OKUNAN metni: sayfanin SON dugmesi.
const dugmeMetni = (html) => {
    const bas = html.lastIndexOf('<button')
    const son = html.indexOf('</button>', bas)
    return html.slice(bas, son).replace(/<[^>]+>/g, '').trim()
}

const mesajlar = []
const VARSAYILAN_YANITLAR = () => ({
    satisTeklifi: { success: true, data: SATIS_VERISI },
    yurutme: { success: true, hash: '0xuserop', txHash: '0xzincir' },
})
let yanitlar = VARSAYILAN_YANITLAR()
const zamanlayici = vi.fn(() => 7)

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
    satis.acik = true
    durum.yetersiz = true
    mesajlar.length = 0
    yanitlar = VARSAYILAN_YANITLAR()
    atsLoad.mockClear()
    zamanlayici.mockClear()
    useTokenBalanceMock.mockClear()
    atsAc.cagrilar.length = 0
    atsAc.durumlar.length = 0
    atsAc.oku = null
})

async function ciz({ inToken = USDT, outToken = ATS, amount = 5, swapData = SATIS_VERISI, onCapture } = {}) {
    vi.stubGlobal('setInterval', zamanlayici)
    vi.stubGlobal('clearInterval', () => {})
    const stub = installChromeStub({
        currentNetwork: BSC_CHAIN,
        active_account: { address: HESAP, key: 'acc1', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" },
    })
    stub.setSendMessage(async (msg) => {
        mesajlar.push(msg)
        if (msg.type === 'ATS_SALE_QUOTE') return yanitlar.satisTeklifi
        if (msg.type === 'ATS_SALE_EXECUTE') {
            if (yanitlar.yurutmeReddi) throw yanitlar.yurutmeReddi
            return yanitlar.yurutme
        }
        if (msg.type === 'SWAP_QUOTE') return { success: true, data: TAKAS_VERISI }
        return {}
    })

    const app = createApp(Swap)
    app.use(createTestPinia())
    app.use(createTestI18n())
    networkStore().currentNetwork = BSC_CHAIN
    pageStore().currentPage = 'swap'
    const crypto = cryptoStore()
    crypto.swap.inToken = inToken
    crypto.swap.outToken = outToken

    const holder = captureInstance(app, 'Swap', (instance) => {
        instance.setupState.inTokenAmount = amount
        instance.setupState.swapData = swapData
        onCapture?.(instance.setupState)
    })
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState }
}

describe('Swap.vue (SSR) -- ATS satis yolu: secim ve ekran', () => {
    it('USDT -> ATS (BSC) satis yoludur; ATS ucret karti CIZILMEZ, satis bilgileri cizilir', async () => {
        const { html, state } = await ciz()
        expect(state.saleRoute).toBe(true)
        expect(html).not.toContain('Fee paid with ATS')
        expect(html).toContain('1 ATS ≈ $0.05173')
        expect(html).toContain('1% commission included')
        expect(html).toContain('No network fee')
        expect(html).toContain('AllToScan stock (MEXC price)')
    })

    it("ATS'si ve BNB'si olmayan kullanici: ATS ve gaz kapilari SORULMAZ, dugme acik ('Buy ATS')", async () => {
        const { html, state } = await ciz({ onCapture: (s) => { s.evmInsufficientGas = true } })
        expect(state.atsInsufficient).toBe(true)   // ucret karari "yetersiz" ...
        expect(state.insufficientGas).toBe(true)   // ... ve BNB yok,
        expect(state.blockReason).toBeNull()       // ama satis yolunda engel degil.
        expect(state.isValid()).toBe(true)
        expect(dugmeMetni(html)).toBe('Buy ATS')
        expect(html).not.toContain('Insufficient Balance (Gas)')
    })

    it('Varliklarim kaydindaki BNB (ZeroAddress) ve USDC de satis yoludur', async () => {
        expect((await ciz({ inToken: BNB_SIFIR })).state.saleRoute).toBe(true)
        expect((await ciz({ inToken: USDC })).state.saleRoute).toBe(true)
    })

    it('teklif ATS_SALE_QUOTE ile istenir (SWAP_QUOTE degil), yanit ekrana yazilir', async () => {
        const { state } = await ciz({ swapData: null })
        await state.getSwapData()
        expect(mesajlar.some((m) => m.type === 'SWAP_QUOTE')).toBe(false)
        const istek = mesajlar.find((m) => m.type === 'ATS_SALE_QUOTE')
        expect(istek.message).toMatchObject({ chainId: 56, inTokenAddress: USDT.address, outTokenAddress: ATS.address, amount: '5' })
        expect(state.swapData).toEqual(SATIS_VERISI)
        expect(state.saleError).toBeNull()
    })

    it('satis hatasi kendi durumuna yazilir; teklif silinir, genel teklif hatasi YOK', async () => {
        yanitlar.satisTeklifi = { success: false, error: 'x', saleError: { code: 'amount-too-small' } }
        const { state } = await ciz({ swapData: null })
        await state.getSwapData()
        expect(state.swapData).toBeNull()
        expect(state.saleError).toEqual({ code: 'amount-too-small' })
        expect(state.quoteError).toBeNull()
    })

    it('stok hatasi "en fazla X ATS (~$Y)" ile cizilir', async () => {
        const { html } = await ciz({
            swapData: null,
            onCapture: (s) => { s.saleError = { code: 'stock-insufficient', maxAts: '1234500000000000000000', maxUsd: '61.73' } },
        })
        expect(html).toContain('You can buy at most 1,234.5 ATS (~$61.73) right now')
        expect(html).not.toContain('Buy on exchange')
    })

    it('satis kapali hatasinda MEXC linki de cizilir', async () => {
        const { html, state } = await ciz({ swapData: null, onCapture: (s) => { s.saleError = { code: 'sale-closed' } } })
        expect(html).toContain('ATS sales are unavailable right now')
        expect(html).toContain('Buy on exchange')
        const acilan = vi.fn()
        vi.stubGlobal('window', { open: acilan })
        state.openExchange()
        expect(acilan).toHaveBeenCalledWith('https://www.mexc.com/exchange/ATS_USDT', '_blank')
    })

    it('satis yolunda ATS ucret teklifi ISTENMEZ', async () => {
        const { state } = await ciz()
        await state.refreshAtsOpFee()
        expect(atsLoad).not.toHaveBeenCalled()
    })

    it('teklif 20 sn de bir yenilenir', async () => {
        const { state } = await ciz()
        state.startQuoteTimer()
        expect(zamanlayici).toHaveBeenLastCalledWith(expect.any(Function), 20000)
    })
})

// 20 sn'lik satis yoklamasi ve yeniden kurulumu (Task 9). Takas govdesi (10000) ve guard'i
// components/pollingVisibility.test.js'te kilitli; o test 20000 govdesini YAKALAYAMAZ (tembel
// regexp ilk setInterval'in 10 sn'lik govdesini yakalar), bu yuzden satis govdesi burada, gercek
// bilesenin kurdugu zamanlayici GERI CAGRISI cagrilarak olculur.
describe('Swap.vue (SSR) -- satis yoklamasi: gorunmezken durur, yol degisince yeniden kurulur', () => {
    const zamanlayiciGeriCagrisi = (ms) => {
        const cagri = zamanlayici.mock.calls.filter(([, sure]) => sure === ms).at(-1)
        return cagri ? cagri[0] : null
    }
    const belgeGorunurlugu = (durum) => vi.stubGlobal('document', {
        visibilityState: durum, addEventListener() {}, removeEventListener() {},
    })
    const teklifSayisi = () => mesajlar.filter((m) => m.type === 'ATS_SALE_QUOTE').length

    it('panel GIZLIyken 20 sn govdesi teklif ISTEMEZ; gorunur olunca ister (pozitif kontrol)', async () => {
        const { state } = await ciz()
        state.startQuoteTimer()
        const govde = zamanlayiciGeriCagrisi(20000)
        expect(govde).toEqual(expect.any(Function))
        mesajlar.length = 0

        belgeGorunurlugu('hidden')
        await govde()
        expect(teklifSayisi()).toBe(0)

        belgeGorunurlugu('visible')
        await govde()
        expect(teklifSayisi()).toBe(1)
    })

    it('satis yolundan takas yoluna gecince zamanlayici 10 sn ile YENIDEN kurulur', async () => {
        const { state } = await ciz()
        state.startQuoteTimer()
        expect(zamanlayici).toHaveBeenLastCalledWith(expect.any(Function), 20000)

        zamanlayici.mockClear()
        cryptoStore().swap.inToken = CAKE
        expect(state.saleRoute).toBe(false)
        state.startQuoteTimer()
        expect(zamanlayici).toHaveBeenCalledTimes(1)
        expect(zamanlayici).toHaveBeenLastCalledWith(expect.any(Function), 10000)
    })

    it('takas yolundan satis yoluna gecince zamanlayici 20 sn ile YENIDEN kurulur', async () => {
        const { state } = await ciz({ inToken: CAKE })
        expect(state.saleRoute).toBe(false)
        state.startQuoteTimer()
        expect(zamanlayici).toHaveBeenLastCalledWith(expect.any(Function), 10000)

        zamanlayici.mockClear()
        cryptoStore().swap.inToken = USDT
        expect(state.saleRoute).toBe(true)
        state.startQuoteTimer()
        expect(zamanlayici).toHaveBeenCalledTimes(1)
        expect(zamanlayici).toHaveBeenLastCalledWith(expect.any(Function), 20000)
    })

    it('yol DEGISMEDIYSE zamanlayici yeniden kurulmaz (her iki yolda da)', async () => {
        const { state } = await ciz()
        state.startQuoteTimer()
        zamanlayici.mockClear()
        state.startQuoteTimer()
        expect(zamanlayici).not.toHaveBeenCalled()

        cryptoStore().swap.inToken = CAKE
        state.startQuoteTimer()
        zamanlayici.mockClear()
        state.startQuoteTimer()
        expect(zamanlayici).not.toHaveBeenCalled()
    })
})

// ATS AL bu ekranin ICINDEN (BSC'de her takas ATS ister, basliga yakin ilk akis): tokenler satis
// cifti olur ama miktar yerel durumdadir; eski tokenin miktari yeni birime TASINMAZ.
describe('Swap.vue (SSR) -- "ATS Al" bu ekrandan: yerel durum temizlenir', () => {
    it('miktar, teklif ve hatalar acicidan ONCE temizlenir, acici bir kez cagrilir', async () => {
        const { state } = await ciz({ inToken: CAKE, amount: 100 })
        atsAc.oku = () => ({
            miktar: state.inTokenAmount, teklif: state.swapData, teklifHatasi: state.quoteError,
            satisHatasi: state.saleError, yurutmeHatasi: state.saleExecError,
        })
        state.swapData = SATIS_VERISI
        state.quoteError = 'route'
        state.saleError = { code: 'stock-insufficient' }
        state.saleExecError = { code: 'prepare-failed' }
        expect(state.inTokenAmount).toBe(100)

        await state.openAtsPurchaseFromSwap()

        expect(atsAc.cagrilar).toHaveLength(1)
        expect(state.inTokenAmount).toBe('')
        expect(state.swapData).toBeNull()
        expect(state.quoteError).toBeNull()
        expect(state.saleError).toBeNull()
        expect(state.saleExecError).toBeNull()
        // SIRA: acici cagrildigi anda durum ZATEN temizdi (acici tokenleri yazar, izleyici tetiklenir).
        expect(atsAc.durumlar[0]).toEqual({ miktar: '', teklif: null, teklifHatasi: null, satisHatasi: null, yurutmeHatasi: null })
    })

    it('iki "Buy ATS" dugmesi de bu isleyiciyi tasir (kaynak kilidi)', async () => {
        const { readFileSync } = await import('node:fs')
        const { join, dirname } = await import('node:path')
        const { fileURLToPath } = await import('node:url')
        const kaynak = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Swap.vue'), 'utf8')
        const dugmeler = kaynak.match(/<AtsBuyButton [^>]*>/g) || []
        expect(dugmeler).toHaveLength(2)
        for (const d of dugmeler) expect(d).toContain(':handler="openAtsPurchaseFromSwap"')
    })
})

describe('Swap.vue (SSR) -- hedef ATS ama kaynak odeme tokeni degil', () => {
    it('"rota yok" yerine "USDT, USDC veya BNB ile alabilirsin"', async () => {
        const { html, state } = await ciz({ inToken: CAKE, swapData: null, onCapture: (s) => { s.quoteError = 'route' } })
        expect(state.saleRoute).toBe(false)
        expect(html).toContain('You can buy ATS with USDT, USDC or BNB')
        expect(html).not.toContain('No route found')
    })
})

describe('Swap.vue (SSR) -- bayrak KAPALI: bugunku davranis', () => {
    it('USDT -> ATS takas yoludur: ATS ucret karti, ATS kapisi, SWAP_QUOTE, 10 sn yenileme', async () => {
        satis.acik = false
        const { html, state } = await ciz({ swapData: TAKAS_VERISI })
        expect(state.saleRoute).toBe(false)
        expect(html).toContain('Fee paid with ATS')
        expect(html).not.toContain('AllToScan stock (MEXC price)')
        expect(state.blockReason).toBe('ats-insufficient')
        expect(dugmeMetni(html)).toBe('Insufficient Balance')

        await state.refreshAtsOpFee()
        expect(atsLoad).toHaveBeenCalledTimes(1)

        await state.getSwapData()
        expect(mesajlar.some((m) => m.type === 'ATS_SALE_QUOTE')).toBe(false)
        expect(mesajlar.some((m) => m.type === 'SWAP_QUOTE')).toBe(true)

        state.startQuoteTimer()
        expect(zamanlayici).toHaveBeenLastCalledWith(expect.any(Function), 10000)
    })

    it('CAKE -> ATS rota yoksa genel "No route found" karti (ipucu YOK)', async () => {
        satis.acik = false
        const { html } = await ciz({ inToken: CAKE, swapData: null, onCapture: (s) => { s.quoteError = 'route' } })
        expect(html).toContain('No route found')
        expect(html).not.toContain('You can buy ATS with USDT, USDC or BNB')
    })
})

describe('Swap.vue (SSR) -- ATS satis yolu: yurutme (spec §6.2, §7)', () => {
    it('ATS_SALE_EXECUTE ekrandaki teklif ve tutarla gider; basari ana sayfaya doner', async () => {
        const { state } = await ciz()
        await state.swap()
        const istek = mesajlar.find((m) => m.type === 'ATS_SALE_EXECUTE')
        expect(istek.message.saleQuote).toEqual(SATIS_VERISI.saleQuote)
        expect(istek.message.amount).toBe('5')
        expect(istek.message.inTokenData.address).toBe(USDT.address)
        expect(mesajlar.some((m) => m.type === 'SWAP')).toBe(false)
        expect(pageStore().currentPage).toBe('home')
    })

    it('requote: yeni fiyat ekrana gelir, kullanici YENIDEN onaylar (sayfa degismez)', async () => {
        const YENI = { ...SATIS_VERISI, expectedOutput: '95.0', saleQuote: { ...SATIS_VERISI.saleQuote, receivedAt: 2 } }
        yanitlar.yurutme = { requote: YENI }
        const { state } = await ciz()
        await state.swap()
        expect(state.swapData).toEqual(YENI)
        expect(state.saleNotice).toBe('requote')
        expect(pageStore().currentPage).toBe('swap')
        expect(zamanlayici).toHaveBeenLastCalledWith(expect.any(Function), 20000)
    })

    it('"Fiyat guncellendi" notu cizilir', async () => {
        const { html } = await ciz({ onCapture: (s) => { s.saleNotice = 'requote' } })
        expect(html).toContain('Price updated')
    })

    it('islem gerceklesmedi: hata ekranda kalir, KULLANILMIS teklif atilir ve yenisi istenir', async () => {
        yanitlar.yurutme = { success: false, error: 'x', saleError: { code: 'relay-failed' } }
        const { state } = await ciz()
        await state.swap()
        expect(state.saleExecError).toEqual({ code: 'relay-failed' })
        const sira = mesajlar.map((m) => m.type)
        expect(sira.lastIndexOf('ATS_SALE_QUOTE')).toBeGreaterThan(sira.indexOf('ATS_SALE_EXECUTE'))
        expect(state.swapData).toEqual(SATIS_VERISI)
        expect(pageStore().currentPage).toBe('swap')
    })

    it('sonuc BILINMIYOR: yeni teklif kendiliginden ISTENMEZ, dugme kapali kalir (cift alim yok)', async () => {
        yanitlar.yurutme = { success: false, error: 'x', saleError: { code: 'result-unknown' } }
        const { state } = await ciz()
        zamanlayici.mockClear()
        await state.swap()
        expect(state.saleExecError).toEqual({ code: 'result-unknown' })
        expect(state.swapData).toBeNull()
        expect(mesajlar.filter((m) => m.type === 'ATS_SALE_QUOTE')).toHaveLength(0)
        expect(zamanlayici).not.toHaveBeenCalled()
        expect(state.blockReason).toBe('no-quote')

        // Calisan 20 sn'lik yenileme ve "panel gorunur oldu" turu da getSwapData'yi cagirir:
        // bekletme orada da SURER, dugme kendiliginden yeniden acilmaz.
        await state.getSwapData()
        expect(mesajlar.filter((m) => m.type === 'ATS_SALE_QUOTE')).toHaveLength(0)
        expect(state.swapData).toBeNull()

        // Token ya da miktar degisince teklif izleyicisi hatayi temizler: teklif yeniden istenir.
        state.saleExecError = null
        await state.getSwapData()
        expect(mesajlar.filter((m) => m.type === 'ATS_SALE_QUOTE')).toHaveLength(1)
        expect(state.swapData).toEqual(SATIS_VERISI)
    })

    it('yurutme hatasi kartta yazar ve teklif hatasindan once gelir', async () => {
        const { html } = await ciz({
            onCapture: (s) => { s.saleExecError = { code: 'relay-failed' }; s.saleError = { code: 'rate-limited' } },
        })
        expect(html).toContain('The transaction did not go through; no funds were taken')
        expect(html).not.toContain('Too many purchases')
    })

    it('bayrak KAPALI: gonderim bugunku SWAP mesajiyla (satis mesaji YOK)', async () => {
        satis.acik = false
        durum.yetersiz = false
        const { state } = await ciz({ swapData: TAKAS_VERISI })
        await state.swap()
        expect(mesajlar.some((m) => m.type === 'ATS_SALE_EXECUTE')).toBe(false)
        expect(mesajlar.find((m) => m.type === 'SWAP').message.atsSwap).toBe(true)
    })
})

// Denetci karari (P2-C3): "teklif kullanildi" (consumed) ve "yanit yok / istek reddedildi" da
// sonucu BILINMEYEN alimdir: op zaten imzalanmis ve gonderilmis olabilir, ikinci alim yapilamaz.
describe('Swap.vue (SSR) -- ATS satis yolu: teklif kullanildi / yanit yok = sonuc bilinmiyor', () => {
    const teklifSayisi = () => mesajlar.filter((m) => m.type === 'ATS_SALE_QUOTE').length

    async function bekletmeyiDogrula(state) {
        expect(state.swapData).toBeNull()
        expect(teklifSayisi()).toBe(0)
        expect(zamanlayici).not.toHaveBeenCalled()
        expect(state.blockReason).toBe('no-quote')
        expect(state.isValid()).toBe(false)
        // 20 sn'lik tur ve "panel gorunur oldu" turu da teklif istemez.
        await state.getSwapData()
        expect(teklifSayisi()).toBe(0)
        expect(state.swapData).toBeNull()
        // Token/miktar degisince izleyici hatayi temizler: teklif yeniden istenir.
        state.saleExecError = null
        await state.getSwapData()
        expect(teklifSayisi()).toBe(1)
        expect(state.swapData).toEqual(SATIS_VERISI)
    }

    it('consumed: true (sale-quote-used): yeni teklif ISTENMEZ, dugme kapali, "hazirlanamadi" yazar', async () => {
        yanitlar.yurutme = { success: false, error: 'used', saleError: { code: 'prepare-failed' }, consumed: true }
        const { state } = await ciz()
        zamanlayici.mockClear()
        await state.swap()
        expect(state.saleExecError).toMatchObject({ code: 'prepare-failed', consumed: true })
        expect(pageStore().currentPage).toBe('swap')
        await bekletmeyiDogrula(state)
    })

    it('consumed olmayan prepare-failed bekletme YAPMAZ: yeni teklif istenir', async () => {
        yanitlar.yurutme = { success: false, error: 'x', saleError: { code: 'prepare-failed' } }
        const { state } = await ciz()
        await state.swap()
        expect(teklifSayisi()).toBe(1)
        expect(state.swapData).toEqual(SATIS_VERISI)
    })

    it('yanit YOK (undefined): sonuc bilinmiyor sayilir, yeni teklif ISTENMEZ', async () => {
        yanitlar.yurutme = undefined
        const { state } = await ciz()
        zamanlayici.mockClear()
        await state.swap()
        expect(state.saleExecError).toEqual({ code: 'result-unknown' })
        await bekletmeyiDogrula(state)
    })

    it('istek REDDEDILDI (sendMessage firlatir): sonuc bilinmiyor sayilir, yeni teklif ISTENMEZ', async () => {
        yanitlar.yurutmeReddi = new Error('Extension context invalidated')
        const { state } = await ciz()
        zamanlayici.mockClear()
        await state.swap()
        expect(state.saleExecError).toEqual({ code: 'result-unknown' })
        expect(pageStore().currentPage).toBe('swap')
        await bekletmeyiDogrula(state)
    })

    it('saleError tasimayan basarisiz yanit da sonuc bilinmiyor sayilir', async () => {
        yanitlar.yurutme = { success: false, error: 'beklenmeyen' }
        const { state } = await ciz()
        zamanlayici.mockClear()
        await state.swap()
        expect(state.saleExecError).toEqual({ code: 'result-unknown' })
        await bekletmeyiDogrula(state)
    })
})

// Denetim turu 1: bekletme yalniz getSwapData'nin BASINDA degil, yolda olan teklif cevabinda da
// uygulanir. 20 sn'lik tur / gorunurluk turu / 400 ms ertelemeyle baslamis bir teklif sorgusu,
// onay aninda yoldaysa ve hizli basarisiz olan yurutme yanitindan SONRA donerse dugmeyi yeniden
// acmamali (ikinci alim).
describe('Swap.vue (SSR) -- ATS satis yolu: yolda olan teklif sonuc bilinmiyorken dugmeyi acmaz', () => {
    const yurutmeSayisi = () => mesajlar.filter((m) => m.type === 'ATS_SALE_EXECUTE').length

    // Dugme teklif sorgusu SURERKEN zaten kapali (swapLoading); acik pencere: yurutme beklenirken
    // (swap() araligi yalniz durdurur) gorunurluk turu ya da 400 ms erteleme yeni sorgu baslatir.
    async function yolundaTeklifSenaryosu(yurutmeYaniti, reddet) {
        let yurutmeyiBitir
        let teklifiBitir
        yanitlar.yurutme = new Promise((coz, red) => { yurutmeyiBitir = () => (reddet ? red(reddet) : coz(yurutmeYaniti)) })
        yanitlar.satisTeklifi = new Promise((coz) => { teklifiBitir = coz })
        const { state } = await ciz()
        const swapSozu = state.swap()
        await Promise.resolve()
        const yoldaki = state.getSwapData()
        yurutmeyiBitir()
        await swapSozu
        expect(state.swapData).toBeNull()
        teklifiBitir({ success: true, data: SATIS_VERISI })
        await yoldaki
        return state
    }

    it('consumed: yurutme yanitindan SONRA donen teklif yok sayilir (swapData null, isValid() false)', async () => {
        const state = await yolundaTeklifSenaryosu({ success: false, error: 'used', saleError: { code: 'prepare-failed' }, consumed: true })
        expect(state.saleExecError).toMatchObject({ consumed: true })
        expect(state.swapData).toBeNull()
        expect(state.isValid()).toBe(false)
    })

    it('reddedilen istekte (sendMessage firlatir) de yolda olan teklif dugmeyi acmaz', async () => {
        const state = await yolundaTeklifSenaryosu(null, new Error('Extension context invalidated'))
        expect(state.saleExecError).toEqual({ code: 'result-unknown' })
        expect(state.swapData).toBeNull()
        expect(state.isValid()).toBe(false)
    })

    it('isValid() sonuc bilinmiyorken teklif olsa bile false; swap() ATS_SALE_EXECUTE gondermez', async () => {
        const { state } = await ciz()
        state.saleExecError = { code: 'result-unknown' }
        expect(state.swapData).toEqual(SATIS_VERISI)
        expect(state.isValid()).toBe(false)
        await state.swap()
        expect(yurutmeSayisi()).toBe(0)
        // Hata temizlenince (token/miktar degisimi) kapi yeniden acilir.
        state.saleExecError = null
        expect(state.isValid()).toBe(true)
    })
})

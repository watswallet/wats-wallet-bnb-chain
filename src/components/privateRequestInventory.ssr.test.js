// OZEL MOD ISTEK ENVANTERI (gizli-mod cok-ag spec 4.7 "Istek envanteri" ve 5.1 `privateRequestInventory.ssr.test.js`).
//
// "Her istek turu" iddiasini MEKANIK yapan test: Gizli Hesap aktifken ekranlar GERCEKTEN render edilir ve aga
// cikan her istek kaydedilir (sahte `axios`, `fetch`, `chrome.runtime.sendMessage` ve zincir okumasi). Envanterde
// KAPI ya da KALKAR olan satirlar (fiyat uclari, getImportedTokens, SOLANA_GET_ADDRESS, /bundler/auth, uzak
// gorseller...) HER EKRANDA sifir olmak zorundadir; KALIR ve DARALIR satirlari izinli kumedir. Yeni bir ekran yeni
// bir istek eklerse bu dosya KIRMIZI olur: istek ya atlanir ya da envantere (spec 4.7) yazilir.
//
// KESICI (utils/privacy/priceGate.js) BU DOSYADA KURULU DEGILDIR: olculen sey CAGIRAN YERLERIN atlamasidir, kesici
// yalniz guvenlik agidir (kendi testi priceGate.test.js'te). Kurulu olsaydi atlamayi unutan bir ekran burada sessizce
// gecerdi.
//
// Her senaryonun bir KONTROL ciftı vardir: ayni ekran NORMAL modda ayni istegi ATAR. Kontrol yesil degilse "istek yok"
// iddiasi bos gecerdi (ekran hic istek atmiyor olabilir).
//
// GIZLI MODDA KLASIK TAKAS / KOPRU NOTU (VITE_PRIVATE_SWAP_BRIDGE'nin degerinden BAGIMSIZ): klasik Takas ve Kopru gizli modda kapalidir.
// Takas yalniz "yalniz ATS satin alma" kipidir (Swap.vue saleOnlyMode; tek teklif ATS_SALE_QUOTE), Kopru gizli modda hic baglanmaz. Bu
// dosyadaki Swap / Bridge / swapFrom / bridgeFrom senaryolari bu yuzden SAVUNMA amaclidir: ekran dogrudan kurulsa bile gizli modda hangi
// isteklerin gidebilecegini kilitler. Kendine Takas/Kopru (SilentSwap) ekranlarinin istekleri ayri satirlardir: PrivateTransfer swap / bridge
// (asagidaki Para yukle / Gonder blogu). Klasik ekranlara giden yol yoktur: dugmeler, ekran baglama (popup/privateSwapBridgeClosure) ve kapi ayri kilitlidir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { heavyBackgroundTimeouts } from '../test-utils/heavyBackgroundTimeouts.js'
import { blokGovdesi } from '../test-utils/kaynakTarama'

// Cok sayida buyuk ekran tek dosyada yuklenir (Swap, Bridge, Home...): soguk makinede 15 sn yetmez.
heavyBackgroundTimeouts()

// Bayrak derleme sabitidir; bu dosya ona (vitest varsayilanina) GUVENMEZ: modullerden ONCE acikca 'true' yazilir, ilk test bunu olcer.
vi.hoisted(() => { process.env.VITE_PRIVATE_SWAP_BRIDGE = 'true' })

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Aga cikan HER istegin kaydi. vi.hoisted: vi.mock fabrikalari modul degerlendirilmeden once calisir.
const kayit = vi.hoisted(() => ({ istekler: [], gecmis: [], zincirTokenleri: [], gonderilen: [], bakiye: 0 }))

// Sunucu yanitlari: ekranlarin beklediği bos ama gecerli govdeler. Fiyat ucu normal modda fiyat dondurur
// (kontrol senaryosu "fiyat istegi atildi mi"yi buradan degil, KAYITTAN okur).
vi.mock('axios', () => {
    const yanit = (yol) => {
        if (yol.endsWith('/news')) return { status: 200, data: { news: [] } }
        if (yol.endsWith('/wallet/history')) return { status: 200, data: { success: true, history: kayit.gecmis } }
        if (yol.endsWith('/getChainTokens')) return { status: 200, data: { success: true, tokens: kayit.zincirTokenleri } }
        if (yol.endsWith('/getTokenDataById')) {
            return {
                status: 200,
                data: {
                    token: {
                        name: 'BNB', symbol: 'bnb', coingecko_id: 'binancecoin', address: '0x0',
                        image: { thumb: '/chains/56.png', small: '/chains/56.png', large: '/chains/56.png' },
                        market_data: {
                            priceUSD: 600, market_cap: 1, volume: 1, circulating_supply: 1, ath: 1, atl: 1,
                            change: { h24: 0 }, sparkline: { d7: [] },
                        },
                    },
                },
            }
        }
        if (yol.includes('li.quest')) return { status: 200, data: { tokens: {} } }
        return { status: 200, data: { tokens: [], success: true } }
    }
    const yolu = (url) => String(url).replace(/^https?:\/\/(localhost:8000|api\.example\.test)/, '')
    return {
        default: {
            post: async (url, govde) => {
                kayit.istekler.push({ tur: 'http', yontem: 'post', yol: yolu(url), govde })
                return yanit(yolu(url))
            },
            get: async (url) => {
                kayit.istekler.push({ tur: 'http', yontem: 'get', yol: yolu(url) })
                return yanit(yolu(url))
            },
        },
    }
})

// Zincir bakiye okumasi: hangi RPC'ye gidildigi kaydedilir.
vi.mock('../composables/useTokenBalance', () => ({
    useTokenBalance: async (owner, tokenAddress, rpc, chainId) => {
        kayit.istekler.push({ tur: 'rpc-bakiye', rpc, chainId, sahip: owner })
        return kayit.bakiye
    },
}))
vi.mock('../composables/useSolanaAssets', () => ({
    useSolanaAssets: async () => {
        kayit.istekler.push({ tur: 'solana-varlik' })
        return []
    },
}))

// Zincir saglayicisi: gercek bir uca baglanmaz; kurulum ve okumalar kaydedilir. Kismi mock: ethers'in geri kalani GERCEK.
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SahteSaglayici {
        constructor(url) { kayit.istekler.push({ tur: 'rpc-saglayici', rpc: String(url) }) }
        destroy() {}
        async getBalance() { return 10n ** 18n }
        async getFeeData() { return { maxFeePerGas: 1n, gasPrice: 1n, maxPriorityFeePerGas: 1n } }
        async getNetwork() { return { chainId: 56n } }
        async getCode() { return '0x6080' }
        async estimateGas() { return 65000n }
    }
    class SahteSozlesme {
        async name() { return 'USD Coin' }
        async symbol() { return 'USDC' }
        async decimals() { return 18n }
        async balanceOf() { return 0n }
    }
    return {
        ...actual,
        JsonRpcProvider: SahteSaglayici,
        Contract: SahteSozlesme,
        ethers: { ...actual.ethers, JsonRpcProvider: SahteSaglayici, Contract: SahteSozlesme },
    }
})

// Carpan okumasi (satir 30): ekranlarin ensureMultipliersFor'a HANGI zincirlerin satirlarini verdigi kaydedilir
// (gercek Multicall3 cagrisi yapilmaz; olculen sey sorgu kumesidir, Q = {S}).
vi.mock('../utils/stockBalances', async (importOriginal) => {
    const gercek = await importOriginal()
    return {
        ...gercek,
        ensureMultipliersFor: async (satirlar) => {
            const zincirler = [...new Set((satirlar ?? []).map((r) => Number(r.chainId)))].sort((a, b) => a - b)
            kayit.istekler.push({ tur: 'carpan', zincirler })
        },
    }
})

// Home.vue <Header> icerir ve Header -> utils/dappFunctions zinciri MODUL UST DUZEYINDE
// chrome.windows.onRemoved.addListener cagirir (bkz. Home.ssr.test.js).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { privacyStore } from '../store/privacy'
import { setLocalLogosOnly } from '../utils/tokenLogo'
import { _onbellegiTemizle } from '../composables/useUsdPrice'
import SwapFrom from './swap/swapFrom.vue'
import SwapTo from './swap/swapTo.vue'
import BridgeFrom from './bridge/bridgeFrom.vue'
import BridgeTo from './bridge/bridgeTo.vue'
import SelectAssets from './SelectAssets.vue'
import Swap from './Swap.vue'
import Bridge from './Bridge.vue'
import AtsFuelPill from './AtsFuelPill.vue'
import Home from './Home.vue'
import Token from './Token.vue'
import SearchTokens from './SearchTokens.vue'
import ImportToken from './ImportToken.vue'
import PrivateTransfer from './privacy/PrivateTransfer.vue'
import { pageStore } from '../store/pageStore'
import { XSTOCKS } from '../data/xStocks'
import { cryptoStore } from '../store/crypto'
import { ref } from 'vue'
import { usePrivateSourceBalance } from '../composables/usePrivateSourceBalance'
import { buildNativeToken } from '../utils/nativeToken'
import { salePayRecord, ATS_SALE_OUT_RECORD } from '../composables/useAtsPurchase'
import { usdcTokenOf, nativeTokenOf } from '../utils/privacy/deliveryTokens'
import { sourceAssetAddress } from '../utils/privacy/sourceAssets'
import { PRIVATE_SWAP_BRIDGE } from '../utils/featureFlags'
import supported_chains from '../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const ETH = supported_chains.find((c) => c.chainId === 1)
const GNOSIS = supported_chains.find((c) => c.chainId === 100)
const POLYGON = supported_chains.find((c) => c.chainId === 137)

const NORMAL = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', type: 'hd', name: 'Hesap 1' }
const GIZLI = { address: '0xCcccCccc00000000000000000000000000000003', key: 'private-0xcccccccc00000000000000000000000000000003', type: 'hd', private: true, name: 'Gizli Hesap' }

const img = { thumb: '/usdc.png', small: '/usdc.png', large: '/usdc.png' }
const USDT_BSC = { name: 'Tether', symbol: 'usdt', address: '0x55d398326f99059fF775485246999027B3197955', chain: 'binance-smart-chain', decimals: 18, coingecko_id: 'tether', image: img }

beforeEach(() => {
    kayit.istekler.length = 0
    kayit.gonderilen.length = 0
    kayit.bakiye = 0
    kayit.gecmis = []
    kayit.zincirTokenleri = []
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('fetch', async (url) => {
        kayit.istekler.push({ tur: 'fetch', yol: String(url) })
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
    setLocalLogosOnly(false)
    delete globalThis.chrome
})

/** Kayittaki HTTP isteklerinin yollari (sirasiyla). */
const yollar = () => kayit.istekler.filter((i) => i.tur === 'http').map((i) => i.yol)
const fiyatIstekleri = () => yollar().filter((y) => /\/(getTokensDataById|getTokenDataById|getTokenPriceHistory|getTokenByAddress)$/.test(y) || y.includes('coingecko'))

/**
 * Bir ekrani `gizli` modda kurar ve render eder. Hesabin BSC kovasinda bir USDT satiri vardir (`coingecko_id`
 * dolu): ekranin fiyat istegi atmasi icin gereken ZEMIN budur.
 */
async function ekranKur(Bilesen, ad, { gizli, props = {}, onCapture, depo = {}, hazirla, ag = BSC, yanit } = {}) {
    kayit.istekler.length = 0
    kayit.gonderilen.length = 0
    // useUsdPrice fiyati 60 sn MODUL onbelleginde tutar: ayni testteki onceki kurulumun fiyati, sonrakinin istegini
    // yutup "istek yok" iddiasini bos gecirmesin. Her kurulum temiz onbellekle baslar.
    _onbellegiTemizle()
    const hesap = gizli ? GIZLI : NORMAL
    const stub = installChromeStub({
        currentNetwork: ag,
        active_account: hesap,
        imported_tokens: { [hesap.key]: { 56: [USDT_BSC] } },
        vaults: [],
        ...depo,
    })
    stub.setSendMessage(async (msg) => {
        kayit.istekler.push({ tur: 'mesaj', tip: msg?.type })
        kayit.gonderilen.push(msg)
        return yanit ? yanit(msg) : {}
    })
    const app = createApp(Bilesen, { props })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = ag
    networkStore().rpc = ag.rpc[0].url
    privacyStore().active = gizli
    // installPrivacySync SSR testinde calismaz: logo anahtari store ile birlikte elle cevrilir.
    setLocalLogosOnly(gizli)
    hazirla?.()
    const captured = captureInstance(app, ad, onCapture)
    const html = await render(app)
    return { html, state: captured.instance?.setupState, stub }
}

describe('Ozel mod istek envanteri -- ortam', () => {
    it('ortam: bayrak bu dosyada gercekten acik', () => {
        expect(PRIVATE_SWAP_BRIDGE).toBe(true)
    })
})

describe('Ozel mod istek envanteri -- token seciciler: fiyat istegi YOK (satir 2)', () => {
    const SECICILER = [
        ['swapFrom', SwapFrom, 'swapFrom', {}],
        ['swapTo', SwapTo, 'swapTo', {}],
        ['bridgeFrom', BridgeFrom, 'bridgeFrom', {}],
        ['bridgeTo', BridgeTo, 'bridgeTo', {}],
        ['SelectAssets', SelectAssets, 'SelectAssets', {}],
    ]

    it.each(SECICILER)('%s: KONTROL -- normal modda /getTokensDataById ATILIR', async (_ad, Bilesen, ad, props) => {
        await ekranKur(Bilesen, ad, {
            gizli: false,
            props,
            hazirla: () => { cryptoStore().bridge = { inToken: null, outToken: null, toChain: BSC, amount: 0 } },
        })
        expect(yollar().filter((y) => y.endsWith('/getTokensDataById')).length).toBeGreaterThan(0)
    })

    it.each(SECICILER)('%s: gizli modda fiyat uclari ve CoinGecko SIFIR', async (_ad, Bilesen, ad, props) => {
        await ekranKur(Bilesen, ad, {
            gizli: true,
            props,
            hazirla: () => { cryptoStore().bridge = { inToken: null, outToken: null, toChain: BSC, amount: 0 } },
        })
        expect(fiyatIstekleri()).toEqual([])
    })
})

/** Kayittaki chrome.runtime.sendMessage tipleri (sirasiyla). */
const mesajlar = () => kayit.istekler.filter((i) => i.tur === 'mesaj').map((i) => i.tip)

// Teklif yanitlari: ekranlarin ilerlemesi icin yeterli govdeler. Bilinmeyen tip `{}` doner.
const TEKLIFLER = {
    SWAP_QUOTE: { data: { expectedOutput: '1', exchangeRate: '1', estimatedGasFee: { totalCost: '0.001', totalCostFormatted: '0.001 BNB' } } },
    BRIDGE_QUOTE: {
        success: true,
        data: {
            estimate: { feeCosts: [], gasCosts: [], toAmount: '1', toAmountMin: '1' },
            transactionRequest: { to: '0x' + '11'.repeat(20), data: '0x', value: '0x0', gasLimit: '100000', gasPrice: '1' },
        },
    },
}
const teklifVer = (stub) => stub.setSendMessage(async (msg) => {
    kayit.istekler.push({ tur: 'mesaj', tip: msg?.type })
    return TEKLIFLER[msg?.type] ?? {}
})

const CIKIS_TOKEN = { address: '0x' + '22'.repeat(20), decimals: 18, symbol: 'TKN', name: 'Token' }

describe('Ozel mod istek envanteri -- Takas ekrani (gizli modda yalniz ATS satin alma): gaz secenekleri ve ATS fiyati YOK (satir 2 ve 16)', () => {
    async function takasKur(gizli) {
        const sonuc = await ekranKur(Swap, 'Swap', {
            gizli,
            hazirla: () => { cryptoStore().swap = { inToken: buildNativeToken(56), outToken: CIKIS_TOKEN } },
        })
        teklifVer(sonuc.stub)
        kayit.istekler.length = 0
        sonuc.state.inTokenAmount = '1'
        await sonuc.state.getSwapData()
        return sonuc
    }

    it('KONTROL: normal modda teklif GASLESS_TOKEN_OPTIONS kesfini yapar', async () => {
        await takasKur(false)
        expect(mesajlar()).toContain('SWAP_QUOTE')
        expect(mesajlar()).toContain('GASLESS_TOKEN_OPTIONS')
    })

    it('gizli modda Takas yalniz satis teklifi ister: ATS_SALE_QUOTE gider; SWAP_QUOTE, GASLESS_TOKEN_OPTIONS ve ATS_SWAP_FEE_QUOTE gitmez', async () => {
        // takasKur(true) BNB -> TKN kurar; yalniz-satin-alma kipi cikisi ATS'ye ceker, bu yuzden teklif satis teklifidir (satisKur ile ayni yol).
        await takasKur(true)
        expect(mesajlar()).toContain('ATS_SALE_QUOTE')
        for (const tip of ['SWAP_QUOTE', 'GASLESS_TOKEN_OPTIONS', 'ATS_SWAP_FEE_QUOTE']) expect(mesajlar()).not.toContain(tip)
        // Izinli kume: satis teklifi (arka plan) ve ATS yakit bakiyesi (satir 17).
        const izinli = new Set(['ATS_SALE_QUOTE', 'ATS_FUEL_BALANCE'])
        expect(mesajlar().filter((tip) => !izinli.has(tip))).toEqual([])
        expect(fiyatIstekleri()).toEqual([])
        expect(kayit.istekler.filter((i) => i.tur === 'fetch')).toEqual([])
    })

    it('gizli modda satis disi cift: hicbir klasik takas teklifi istenmez (bayrak ACIK da olsa)', async () => {
        // Bayrak bu dosyada gercekten acik (yoksa "bayraktan bagimsiz" iddiasi bos gecerdi).
        expect(PRIVATE_SWAP_BRIDGE).toBe(true)
        const sonuc = await ekranKur(Swap, 'Swap', {
            gizli: true,
            hazirla: () => { cryptoStore().swap = { inToken: buildNativeToken(56), outToken: CIKIS_TOKEN } },
        })
        teklifVer(sonuc.stub)
        // Kurulum (setup) cifti satis ciftine cevirir; klasik cifti ACILISTAN SONRA geri yaziyoruz.
        cryptoStore().swap.outToken = CIKIS_TOKEN
        kayit.istekler.length = 0
        sonuc.state.inTokenAmount = '1'
        await sonuc.state.getSwapData()
        // Kontrol: klasik cift gercekten yerinde (satis rotasi degil); yoksa asagidaki "yok" iddialari bos gecerdi.
        expect(sonuc.state.saleRoute).toBe(false)
        for (const tip of ['SWAP_QUOTE', 'GASLESS_TOKEN_OPTIONS', 'ATS_SWAP_FEE_QUOTE']) expect(mesajlar()).not.toContain(tip)
    })

    it('KONTROL: normal modda acilista ATS fiyati istenir; gizli modda fiyat istegi SIFIR', async () => {
        await ekranKur(Swap, 'Swap', { gizli: false })
        expect(yollar().filter((y) => y.endsWith('/getTokensDataById')).length).toBeGreaterThan(0)
        await ekranKur(Swap, 'Swap', { gizli: true })
        expect(fiyatIstekleri()).toEqual([])
    })
})

// K13 (cok-ag spec 4.7 satir 24-26, 5.1): ATS SATIN ALMA ekranlari. Ekranlar Wats ana makinesine (bundler.watswallet.com)
// DOGRUDAN istek atmaz: yalniz arka plana ATS_SALE_QUOTE / ATS_SALE_EXECUTE mesaji gonderir; teklif, sponsor ve relay
// govdeleri, basliklari ve ana makine kumesi utils/atsSalePrivacy.test.js'te uctan uca kilitlidir. Burada ekran tarafi
// olculur: ana API'ye (config.api) HICBIR istek yok (fiyat uclari dahil), satis rotasinda takas teklifi / ATS ucret teklifi /
// gaz secenekleri mesaji yok, bakiye okumalari yalniz BSC (satir 1 ve 26), uzak gorsel yok.
describe('Ozel mod istek envanteri -- ATS satin alma ekranlari: Swap satis rotasi ve swapFrom odeme listesi (satir 24-26)', () => {
    const SATIS_VERISI = {
        success: true,
        data: {
            expectedOutput: '96.0', exchangeRate: '19.2', priceImpact: '0.56%', depthGateWarning: false,
            minimumReceived: '96.0', slippageTolerance: '0.00%', routerType: { name: 'ATS_SALE', version: 1 },
            estimatedGasFee: { totalCost: '0', totalCostFormatted: '0', totalCostUSD: null, gasType: 'sponsored' },
            saleQuote: { quote: { quoteId: '0x' + 'ab'.repeat(32) }, display: { price: '0.05173', commissionPct: 1 } },
        },
    }
    // acilisDenetle: gizli modda EKRANIN ACILIS (mount) asamasinda ana API ve fiyat istegi yok. Kayit, teklif
    // hazirligindan once temizlendigi icin bu denetim temizlemeden ONCE yapilir (PF-E8).
    const satisKur = async (gizli, { acilisDenetle = false } = {}) => {
        const sonuc = await ekranKur(Swap, 'Swap', {
            gizli,
            hazirla: () => { cryptoStore().swap = { inToken: salePayRecord('USDT'), outToken: { ...ATS_SALE_OUT_RECORD } } },
        })
        if (acilisDenetle) {
            expect(fiyatIstekleri()).toEqual([])
            expect(yollar()).toEqual([])
        }
        sonuc.stub.setSendMessage(async (msg) => {
            kayit.istekler.push({ tur: 'mesaj', tip: msg?.type })
            return msg?.type === 'ATS_SALE_QUOTE' ? SATIS_VERISI : {}
        })
        kayit.istekler.length = 0
        sonuc.state.inTokenAmount = '5'
        await sonuc.state.getSwapData()
        return sonuc
    }

    it('KONTROL: normal modda satis rotasi ATS_SALE_QUOTE ister (ekran gercekten teklif atiyor)', async () => {
        await satisKur(false)
        expect(mesajlar()).toContain('ATS_SALE_QUOTE')
    })

    it('gizli modda satis rotasi: yalniz ATS_SALE_QUOTE (ATS_FUEL_BALANCE ile); ana API, fetch, takas teklifi, ATS ucret teklifi ve gaz kesfi SIFIR', async () => {
        const { html } = await satisKur(true, { acilisDenetle: true })
        expect(mesajlar()).toContain('ATS_SALE_QUOTE')
        const izinli = new Set(['ATS_SALE_QUOTE', 'ATS_FUEL_BALANCE'])
        expect(mesajlar().filter((tip) => !izinli.has(tip))).toEqual([])
        expect(fiyatIstekleri()).toEqual([])
        expect(yollar()).toEqual([])
        ozelModKurallari(html)
    })

    it('gizli modda swapFrom satis modu odeme listesi: ana API istegi yok (sunucu listesi ve fiyat), bakiyeler yalniz BSC RPC sinden', async () => {
        const { html } = await ekranKur(SwapFrom, 'swapFrom', {
            gizli: true,
            hazirla: () => { cryptoStore().swap = { inToken: null, outToken: { ...ATS_SALE_OUT_RECORD } } },
        })
        expect(yollar()).toEqual([])
        expect(rpcZincirleri()).toEqual([56])
        ozelModKurallari(html)
    })

    it('KONTROL: normal modda ayni odeme listesi fiyat istegi (loadSalePrices) atar', async () => {
        await ekranKur(SwapFrom, 'swapFrom', {
            gizli: false,
            hazirla: () => { cryptoStore().swap = { inToken: null, outToken: { ...ATS_SALE_OUT_RECORD } } },
        })
        expect(yollar().filter((y) => y.endsWith('/getTokensDataById')).length).toBeGreaterThan(0)
    })
})

describe('Ozel mod istek envanteri -- Kopru: gaz secenekleri ve ATS fiyati YOK (satir 2 ve 16)', () => {
    async function kopruKur(gizli) {
        const sonuc = await ekranKur(Bridge, 'Bridge', {
            gizli,
            hazirla: () => { cryptoStore().bridge = { inToken: buildNativeToken(56), outToken: CIKIS_TOKEN, toChain: ETH, amount: 0 } },
        })
        teklifVer(sonuc.stub)
        sonuc.state.activeAccount = gizli ? GIZLI : NORMAL
        kayit.istekler.length = 0
        sonuc.state.amount = '1'
        await sonuc.state.getBridgeData()
        return sonuc
    }

    it('KONTROL: normal modda teklif GASLESS_TOKEN_OPTIONS kesfini yapar', async () => {
        await kopruKur(false)
        expect(mesajlar()).toContain('BRIDGE_QUOTE')
        expect(mesajlar()).toContain('GASLESS_TOKEN_OPTIONS')
    })

    it('gizli modda teklif GASLESS_TOKEN_OPTIONS GONDERMEZ; yalniz izinli mesajlar', async () => {
        await kopruKur(true)
        expect(mesajlar()).toContain('BRIDGE_QUOTE')
        expect(mesajlar()).not.toContain('GASLESS_TOKEN_OPTIONS')
        const izinli = new Set(['BRIDGE_QUOTE', 'ATS_BRIDGE_FEE_QUOTE', 'ATS_FUEL_BALANCE'])
        expect(mesajlar().filter((tip) => !izinli.has(tip))).toEqual([])
        expect(fiyatIstekleri()).toEqual([])
    })

    it('KONTROL: normal modda acilista ATS fiyati istenir; gizli modda fiyat istegi SIFIR', async () => {
        await ekranKur(Bridge, 'Bridge', { gizli: false })
        expect(yollar().filter((y) => y.endsWith('/getTokensDataById')).length).toBeGreaterThan(0)
        await ekranKur(Bridge, 'Bridge', { gizli: true })
        expect(fiyatIstekleri()).toEqual([])
    })
})

describe('Ozel mod istek envanteri -- ATS yakit hapi: panel acilinca ATS fiyati YOK (satir 2)', () => {
    async function hapKur(gizli) {
        return ekranKur(AtsFuelPill, 'AtsFuelPill', { gizli, props: { address: gizli ? GIZLI.address : NORMAL.address } })
    }

    it('KONTROL: normal modda panel acilinca ATS fiyati istenir', async () => {
        const { state } = await hapKur(false)
        kayit.istekler.length = 0
        state.fiyatiYukle(true)
        await Promise.resolve()
        expect(yollar().filter((y) => y.endsWith('/getTokensDataById')).length).toBe(1)
    })

    it('gizli modda panel acilinca fiyat istegi atilmaz; yakit bakiyesi okumasi (ATS_FUEL_BALANCE) KALIR', async () => {
        const { state } = await hapKur(true)
        expect(mesajlar()).toContain('ATS_FUEL_BALANCE')
        kayit.istekler.length = 0
        state.fiyatiYukle(true)
        await Promise.resolve()
        expect(fiyatIstekleri()).toEqual([])
    })
})

// Baslatma yolu (E-R4): AtsFuelPill > buyAts > openAtsPurchase. Gizli modda agi degistirir, Gizli adresin BNB/USDT/USDC
// bakiyesini RPC'den okur ve token kayitlarini kurar. useAtsPurchase bu dosyada taklit EDILMEZ; useTokenBalance taklidi
// 'rpc-bakiye' kaydi tutar.
describe('Ozel mod istek envanteri -- ATS satin alma BASLATMA yolu: AtsFuelPill buyAts (satir 1, 24-26)', () => {
    it('KONTROL: normal modda buyAts cagrilir (yol gercekten calisiyor)', async () => {
        const { state } = await ekranKur(AtsFuelPill, 'AtsFuelPill', { gizli: false, props: { address: NORMAL.address } })
        kayit.istekler.length = 0
        await state.buyAts()
        expect(rpcZincirleri().length).toBeGreaterThan(0)
    })

    it('gizli mod + PRIVATE_ATS_SALE ACIK + satis canli: buyAts ana API ve fiyat istegi atmaz, bakiye okumalari yalniz BSC RPC sinden', async () => {
        const { state, html } = await ekranKur(AtsFuelPill, 'AtsFuelPill', { gizli: true, props: { address: GIZLI.address } })
        kayit.istekler.length = 0
        await state.buyAts()
        expect(rpcZincirleri().length).toBeGreaterThan(0)
        expect(rpcZincirleri().every((z) => z === 56)).toBe(true)
        expect(yollar()).toEqual([])
        expect(fiyatIstekleri()).toEqual([])
        const izinli = new Set(['ATS_FUEL_BALANCE', 'ATS_SALE_QUOTE'])
        expect(mesajlar().filter((tip) => !izinli.has(tip))).toEqual([])
        ozelModKurallari(html)
    })

    it('gizli mod: buyAts does not call window.open', async () => {
        const { state } = await ekranKur(AtsFuelPill, 'AtsFuelPill', { gizli: true, props: { address: GIZLI.address } })
        // window kurulumdan SONRA taklit edilir (PF-E8): ekran cizimi window'a bagli kalmaz.
        const acilan = vi.fn()
        vi.stubGlobal('window', { open: acilan })
        await state.buyAts()
        expect(acilan).not.toHaveBeenCalled()
        vi.unstubAllGlobals()
    })
})

// Para yukle, Gonder, Takas ve Kopru (sade ekran plani Task 22; spec 2026-10-28 Bolum 7.5 N1-N5, K7; kendine Takas/Kopru spec 2026-11-02). "Para yukle HICBIR istek atmaz" iddiasi (PF-E13)
// BIRAKILDI: Gizli oturumda dort ekran da izinli kucuk bir kume atar (N1-N5), baska hicbir sey atmaz. Kume ekran uzerinden mekanik olculur:
//   N1 PRIVATE_PROVIDER_INFO (acilista; arka plan GET /dest-assets, yalniz IP, KALIR)
//   N3 kaynak bakiyesi balanceOf/getBalance (yalniz ilk RPC; fund'da NORMAL hesap, send/swap/bridge'de Gizli Hesap; swap/bridge'de KAYNAK zincirin ilk RPC si: Takas'ta Ethereum, Kopru'de BSC; KALIR)
//   N5 otomatik teklifler PRIVATE_QUOTE (girdi gecerli olunca; yeni alan yok, KALIR)
//   N2 ATS_PRIVATE_FEE_QUOTE (yalniz { ticket }; arka plan bundler'a gider, KALIR kabul edilen bedel)
// N4 (artik izin allowance okumasi) ekran istegi DEGILDIR: arka planda ATS_PRIVATE_FEE_QUOTE icinde yapilir (testi arka plan testlerindedir).
// Takas (swap) ve Kopru (bridge) Gonder ile AYNI kumeyi kullanir; alici hep Gizli Hesap'tir, bu yuzden alici alani, itibar sorgusu ve gecmis sorgusu yoktur (yollar() bos kalir).
// Klasik SWAP*, BRIDGE*, ATS_SWAP_FEE_QUOTE ve ATS_BRIDGE_FEE_QUOTE bu ekranlardan HIC gitmez (SilentSwap tek yol, klasik yedek yok).
// Kontrol cifti: ayni ekran NORMAL modda ayni istekleri atar (kayit calisiyor; "baska istek yok" iddiasi bos gecmez).
describe('Ozel mod istek envanteri -- Para yukle / Gonder / Takas / Kopru: izinli istek kumesi N1-N5 (sade ekran Task 22)', () => {
    const SAGLAYICI = { success: true, info: { feeBps: 100, minUsdc: '12', maxUsdc: '5000', available: true } }
    const ATS_UCRETI = { success: true, transferFee: 19.7, symbol: 'ATS', atsBalance: 100, opCount: 1, ready: true, nextSteps: [], commissionAts: '0', commissionAtsHuman: 0, commissionRegion: 'local', maxAtsSellRaw: '97' }
    const BILET = '0x' + 'ab'.repeat(32)
    const yanit = (msg) => {
        if (msg?.type === 'PRIVATE_PROVIDER_INFO') return SAGLAYICI
        if (msg?.type === 'ATS_PRIVATE_FEE_QUOTE') return ATS_UCRETI
        if (msg?.type === 'PRIVATE_QUOTE') {
            const g = msg.message
            const t = g.outputToken
            return {
                success: true,
                quote: {
                    ticket: BILET, payoutUsdc: g.payoutUsdc, totalUsdc: '25.25', serviceFeeUsdc: '0.175', integratorFeeUsdc: '0.075',
                    integratorAddress: '0x' + '99'.repeat(20), expiresAtMs: Date.now() + 600000, expectedFulfillmentMs: 90000,
                    recipient: g.outputAddress, recipientChainId: t.chainId,
                    sourceInput: { amount: '25250000000000000000', asset: g.sourceAsset, decimals: 18, chainId: g.sourceChainId },
                    dest: { chainId: t.chainId, asset: t.symbol, decimals: t.decimals, expectedDestAmount: '24650000000000000000', minDestAmount: '24000000000000000000', quoteUsd: null },
                },
            }
        }
        return {}
    }
    // Gizli Hesap adresi bu blokta TAMAMEN kucuk harf: GIZLI.address karisik harfli ve saglama toplami gecersizdir (isAddress false, teklif uygunlugu kapanir).
    const GIZLI_ADRES = GIZLI.address.toLowerCase()
    const vaultlar = [{ accounts: [NORMAL], privateAccount: { key: GIZLI.key, address: GIZLI_ADRES, private: true, type: 'hd', name: 'Gizli Hesap' } }]
    const depo = { vaults: vaultlar, privacy_mode: { lastPublicAccountKey: NORMAL.key } }
    // Bakiye yeterli (1000): teklif uygunlugu bakiye asimiyla kapanmasin; gercek bakiye okumasi useTokenBalance taklidinden gelir.
    beforeEach(() => { kayit.bakiye = 1000 })
    const hazirla = () => { privacyStore().privateAddress = GIZLI_ADRES; privacyStore().privateAccountKey = GIZLI.key }
    const kur = (mode, { gizli = true, onCapture } = {}) => ekranKur(PrivateTransfer, 'PrivateTransfer', { gizli, props: { mode }, depo, hazirla, onCapture, yanit })
    const fon = (ek) => kur('fund', ek)
    const gonder = (ek) => kur('send', ek)
    const BASKA_AG = (inst) => { inst.setupState.deliveryChainId = 8453 }
    // Kaldirilan ATS-once karti, "ATS satin al" dugmesi ve cikis notu hicbir ag/ekran durumunda cizilmez (2026-10-28 karari; Task 18).
    const KALDIRILANLAR = ['ats-first-card', 'ats-first-unknown', 'ats-first-note', 'ats-first-buy', 'ats-first-retry', 'ats-exit-note']
    const kaldirilanYok = (html) => { for (const id of KALDIRILANLAR) expect(html).not.toContain(`data-testid="${id}"`) }
    // Gecerli alici (Gizli Hesap'tan farkli): gonder modunda teklif uygunlugu icin.
    const ALICI = '0x' + '77'.repeat(20)

    // Ilk RPC okumasi: bakiye sahibi, zincir ve uc kaydi.
    const bakiyeOkumalari = () => kayit.istekler.filter((i) => i.tur === 'rpc-bakiye')
    const bakiyeDogru = (sahip, zincir = BSC) => {
        const b = bakiyeOkumalari()
        expect(b).toHaveLength(1)
        expect(b[0].chainId).toBe(zincir.chainId)
        expect(b[0].rpc).toBe(zincir.rpc[0].url)
        expect(b[0].sahip).toBe(sahip)
    }
    // Fund: kaynak hesap onMounted'ta cozulur ve SSR'da izleyici render'dan sonra calismaz (Global Constraints); bu yuzden ekran render'inda
    // bakiye okumasi en cok BIR kez olur ve varsa NORMAL hesap, BSC ve ilk RPC icindir. "Tam bir kez" iddiasi asagidaki N3 testiyle kilitlidir.
    const fonBakiyeOkumasi = () => {
        const b = bakiyeOkumalari()
        expect(b.length).toBeLessThanOrEqual(1)
        for (const o of b) {
            expect(o.chainId).toBe(56)
            expect(o.rpc).toBe(BSC.rpc[0].url)
            expect(o.sahip).toBe(NORMAL.address)
        }
    }
    // Hicbir istek bundler'a DOGRUDAN gitmez: ekran yalniz arka plana mesaj yollar (HTTP ve fetch kaydinda bundler yok).
    const bundlerDogrudanYok = () => {
        const hepsi = kayit.istekler.filter((i) => i.tur === 'http' || i.tur === 'fetch').map((i) => i.yol)
        expect(hepsi.filter((y) => y.includes('bundler.watswallet.com'))).toEqual([])
    }
    // Sahte zamanlayici: yalniz bu cagri suresince; 800 ms tutar yazimi beklenir, sonra zamanlayici kapatilir (on yenileme planlanmaz).
    async function teklifBekle(state) {
        vi.useFakeTimers()
        try {
            state.onQuoteInput('amount')
            await vi.advanceTimersByTimeAsync(800)
        } finally {
            state.scheduler?.dispose?.()
            vi.useRealTimers()
        }
        await new Promise((r) => setTimeout(r, 0))
    }
    const atsMesajlari = () => kayit.gonderilen.filter((m) => m.type === 'ATS_PRIVATE_FEE_QUOTE')
    const teklifMesajlari = () => kayit.gonderilen.filter((m) => m.type === 'PRIVATE_QUOTE')

    // --- Para yukle (fund) ---
    it('KONTROL: Para yukle NORMAL modda da ayni acilis istegini atar (PRIVATE_PROVIDER_INFO)', async () => {
        await fon({ gizli: false })
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO'])
    })

    it('Para yukle (Gizli oturum): acilista yalniz PRIVATE_PROVIDER_INFO; zincir okumasi yalniz bir kez, BSC, NORMAL hesap adresi icin; HTTP, fetch, fiyat ve uzak gorsel yok (N1, N3)', async () => {
        const { html, state } = await fon()
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO'])
        fonBakiyeOkumasi()
        // Ekranin kendi baglantisi: kaynak bakiyesi Gizli adresle ya da hesapsiz degil, NORMAL hesap adresiyle okunur (BSC, USDC).
        await new Promise((r) => setTimeout(r, 0))
        expect(state.balanceAddress).toBe(NORMAL.address)
        expect(state.chainId).toBe(56)
        expect(state.asset).toBe('USDC')
        kaldirilanYok(html)
        expect(yollar()).toEqual([])
        expect(kayit.istekler.filter((i) => i.tur === 'fetch')).toEqual([])
        expect(fiyatIstekleri()).toEqual([])
        expect(uzakGorseller(html)).toEqual([])
        bundlerDogrudanYok()
        ozelModKurallari(html)
    })

    // N3 (fund), composable seviyesi: ekranin kullandigi composable, kendisine verilen adres (burada NORMAL hesap) icin TAM BIR okuma yapar ve
    // yalniz ilk RPC ye gider. Ekranin bu adresi NORMAL hesaptan bagladigi ustteki testte (state.balanceAddress) kilitlidir.
    it('Para yukle N3 (composable): verilen adres icin bakiye okumasi TAM bir kez, zincir 56, ilk RPC (usePrivateSourceBalance)', async () => {
        kayit.istekler.length = 0
        const { balance } = usePrivateSourceBalance({ address: ref(NORMAL.address), chain: ref(BSC), asset: ref('USDC') })
        await new Promise((r) => setTimeout(r, 0))
        bakiyeDogru(NORMAL.address)
        expect(balance.value).toBe(1000)
    })

    it('KONTROL: Para yukle NORMAL modda tutar yazilinca ayni teklif ve ATS ucret mesajlarini atar', async () => {
        const { state } = await fon({ gizli: false })
        state.amount = '25'
        await teklifBekle(state)
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO', 'PRIVATE_QUOTE', 'ATS_PRIVATE_FEE_QUOTE'])
    })

    // KABUL EDILEN BEDEL: bundler normal hesap adresini Gizli oturumda gorur (K7, spec 2026-10-28 7.5 N2). Para yukle'de ag ucretini ATS ile
    // NORMAL hesap oder; ATS ucret teklifi/yurutme istegini bundler'a arka plan atar ve bu istek normal hesabin adresini tasir. Bu test
    // o mesajin GONDERILDIGINI kilitler: bedeli sessizce kaldiran ya da buyuten bir degisiklik KIRMIZI olur.
    it('Para yukle (Gizli oturum) -- KABUL EDILEN BEDEL: bundler normal hesap adresini Gizli oturumda gorur (K7, spec 2026-10-28 7.5 N2): tutar sonrasi TAM PRIVATE_QUOTE + ATS_PRIVATE_FEE_QUOTE ({ ticket }); teklifte kaynak NORMAL hesap', async () => {
        const { html, state } = await fon()
        state.amount = '25'
        await teklifBekle(state)
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO', 'PRIVATE_QUOTE', 'ATS_PRIVATE_FEE_QUOTE'])
        // K7: fund'da ATS ucret teklifi GONDERILIR (bedel kaldirilirsa bu iddia kirilir).
        expect(atsMesajlari()).toHaveLength(1)
        expect(Object.keys(atsMesajlari()[0].message)).toEqual(['ticket'])
        expect(atsMesajlari()[0].message.ticket).toBe(BILET)
        expect(teklifMesajlari()).toHaveLength(1)
        expect(teklifMesajlari()[0].message.sourceAccountKey).toBe(NORMAL.key)
        expect(teklifMesajlari()[0].message.outputAddress).toBe(GIZLI_ADRES)
        expect(yollar()).toEqual([])
        expect(kayit.istekler.filter((i) => i.tur === 'fetch')).toEqual([])
        bundlerDogrudanYok()
        expect(fiyatIstekleri()).toEqual([])
        ozelModKurallari(html)
    })

    it('Para yukle: BSC disi teslim agi (deliveryChainId 8453) ek istek CIKARMAZ -- ayni uc mesaj', async () => {
        const { html, state } = await fon({ onCapture: BASKA_AG })
        expect(state.deliveryChainId).toBe(8453)
        kaldirilanYok(html)
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO'])
        fonBakiyeOkumasi()
        state.amount = '25'
        await teklifBekle(state)
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO', 'PRIVATE_QUOTE', 'ATS_PRIVATE_FEE_QUOTE'])
        expect(teklifMesajlari()[0].message.outputToken.chainId).toBe(8453)
        expect(Object.keys(atsMesajlari()[0].message)).toEqual(['ticket'])
        expect(yollar()).toEqual([])
        bundlerDogrudanYok()
        ozelModKurallari(html)
    })

    it('Para yukle: BSC disi aga gecince ek istek yok (mesaj, HTTP, fetch ya da RPC)', async () => {
        const { state } = await fon()
        kayit.istekler.length = 0
        state.deliveryChainId = 8453
        await Promise.resolve()
        await new Promise((r) => setTimeout(r, 0))
        expect(kayit.istekler).toEqual([])
    })

    // --- Gonder (send) ---
    it('KONTROL: Gonder NORMAL modda da acilista PRIVATE_PROVIDER_INFO atar', async () => {
        await gonder({ gizli: false })
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO'])
    })

    it('Gonder (Gizli oturum): acilista yalniz PRIVATE_PROVIDER_INFO ve Gizli adres icin tek rpc-bakiye (56); fiyat, getImportedTokens, fetch ve uzak gorsel yok', async () => {
        const { html } = await gonder()
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO'])
        bakiyeDogru(GIZLI_ADRES)
        expect(yollar().filter((y) => y === '/getChainTokens')).toEqual([])
        expect(yollar().filter((y) => y.endsWith('/getImportedTokens'))).toEqual([])
        expect(fiyatIstekleri()).toEqual([])
        expect(kayit.istekler.filter((i) => i.tur === 'fetch')).toEqual([])
        expect(uzakGorseller(html)).toEqual([])
        ozelModKurallari(html)
    })

    it('Gonder (Gizli oturum): gecerli alici + tutar sonrasi PRIVATE_QUOTE + ATS_PRIVATE_FEE_QUOTE ({ ticket }); teklifte kaynak Gizli Hesap; baska mesaj yok', async () => {
        const { html, state } = await gonder()
        state.recipient = ALICI
        state.amount = '25'
        await teklifBekle(state)
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO', 'PRIVATE_QUOTE', 'ATS_PRIVATE_FEE_QUOTE'])
        expect(Object.keys(atsMesajlari()[0].message)).toEqual(['ticket'])
        expect(teklifMesajlari()[0].message.sourceAccountKey).toBe(GIZLI.key)
        expect(teklifMesajlari()[0].message.outputAddress).toBe(ALICI)
        expect(yollar().filter((y) => y === '/getChainTokens')).toEqual([])
        expect(fiyatIstekleri()).toEqual([])
        bundlerDogrudanYok()
        ozelModKurallari(html)
    })

    it('Gonder: /getChainTokens YALNIZ teslim secici ACILINCA; secici acikken satir basina bakiye RPC si yok (sT13)', async () => {
        await gonder()
        expect(yollar().filter((y) => y === '/getChainTokens')).toEqual([])
        const kapaliBakiye = bakiyeOkumalari().length
        const { html } = await gonder({ onCapture: (inst) => { inst.setupState.pickerOpen = true } })
        expect(yollar().filter((y) => y === '/getChainTokens').length).toBeGreaterThan(0)
        expect(bakiyeOkumalari()).toHaveLength(kapaliBakiye)
        expect(fiyatIstekleri()).toEqual([])
        expect(yollar().filter((y) => y.endsWith('/getImportedTokens'))).toEqual([])
        ozelModKurallari(html)
    })

    it.each([['fund'], ['send'], ['swap'], ['bridge']])('%s: kaynak secici (sourcePickerOpen) acilinca satir basina bakiye RPC si yok (sT13)', async (mode) => {
        await kur(mode)
        const kapaliBakiye = bakiyeOkumalari().length
        const { html } = await kur(mode, { onCapture: (inst) => { inst.setupState.sourcePickerOpen = true } })
        expect(bakiyeOkumalari()).toHaveLength(kapaliBakiye)
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO'])
        ozelModKurallari(html)
    })

    // --- Takas / Kopru (swap, bridge): Gonder ile AYNI izinli kume; alici hep Gizli Hesap, kaynak Takas'ta Ethereum USDC, Kopru'de BSC USDC (varsayilan cift) ---
    const KENDINE = [['swap', ETH, false], ['bridge', BSC, true]] // [mode, varsayilan kaynak zincir kaydi, cikis baska agda mi]
    const KLASIK_MESAJLAR = new Set(['SWAP', 'SWAP_QUOTE', 'BRIDGE', 'BRIDGE_QUOTE', 'ATS_SWAP_FEE_QUOTE', 'ATS_BRIDGE_FEE_QUOTE', 'GASLESS_TOKEN_OPTIONS'])
    const klasikMesajYok = () => expect(mesajlar().filter((tip) => KLASIK_MESAJLAR.has(tip))).toEqual([])

    it.each(KENDINE)('KONTROL: %s NORMAL modda da acilista PRIVATE_PROVIDER_INFO atar', async (mode) => {
        await kur(mode, { gizli: false })
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO'])
    })

    it.each(KENDINE)('KONTROL: %s NORMAL modda tutar yazilinca ayni teklif ve ATS ucret mesajlarini atar', async (mode) => {
        const { state } = await kur(mode, { gizli: false })
        state.amount = '25'
        await teklifBekle(state)
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO', 'PRIVATE_QUOTE', 'ATS_PRIVATE_FEE_QUOTE'])
    })

    it.each(KENDINE)('%s (Gizli oturum): acilista yalniz PRIVATE_PROVIDER_INFO ve Gizli adres icin tek rpc-bakiye (kaynak zincirin ilk RPC si); klasik Takas/Kopru mesaji, HTTP, fetch, fiyat ve uzak gorsel yok (N1, N3)', async (mode, zincir) => {
        const { html, state } = await kur(mode)
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO'])
        klasikMesajYok()
        bakiyeDogru(GIZLI_ADRES, zincir)
        expect(state.chainId).toBe(zincir.chainId)
        expect(state.asset).toBe('USDC')
        expect(state.balanceAddress).toBe(GIZLI_ADRES)
        expect(yollar()).toEqual([])
        expect(kayit.istekler.filter((i) => i.tur === 'fetch')).toEqual([])
        expect(fiyatIstekleri()).toEqual([])
        expect(uzakGorseller(html)).toEqual([])
        kaldirilanYok(html)
        bundlerDogrudanYok()
        ozelModKurallari(html)
    })

    it.each(KENDINE)('%s (Gizli oturum): tutar sonrasi TAM PRIVATE_QUOTE + ATS_PRIVATE_FEE_QUOTE ({ ticket }); kaynak ve alici Gizli Hesap; klasik mesaj yok (N2, N5)', async (mode, zincir, agDegisir) => {
        const { html, state } = await kur(mode)
        state.amount = '25'
        await teklifBekle(state)
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO', 'PRIVATE_QUOTE', 'ATS_PRIVATE_FEE_QUOTE'])
        klasikMesajYok()
        expect(atsMesajlari()).toHaveLength(1)
        expect(Object.keys(atsMesajlari()[0].message)).toEqual(['ticket'])
        expect(atsMesajlari()[0].message.ticket).toBe(BILET)
        expect(teklifMesajlari()).toHaveLength(1)
        const g = teklifMesajlari()[0].message
        expect(g.sourceAccountKey).toBe(GIZLI.key)
        expect(g.outputAddress).toBe(GIZLI_ADRES)
        expect(g.sourceChainId).toBe(zincir.chainId)
        expect(g.sourceAsset).toBe('USDC')
        expect(g.payoutUsdc).toBe('25')
        // Rota sekli: Takas kaynak agda kalir, Kopru kaynak agdan cikar; cikis hicbir zaman kaynak varligin kendisi degildir.
        expect(g.outputToken.chainId === g.sourceChainId).toBe(!agDegisir)
        const kaynakAdres = sourceAssetAddress(g.sourceChainId, g.sourceAsset)
        expect(g.outputToken.chainId === g.sourceChainId && g.outputToken.address.toLowerCase() === kaynakAdres.toLowerCase()).toBe(false)
        expect(state.deliveryChains.map((c) => c.chainId)).toContain(g.outputToken.chainId)
        expect(yollar()).toEqual([])
        expect(kayit.istekler.filter((i) => i.tur === 'fetch')).toEqual([])
        bundlerDogrudanYok()
        expect(fiyatIstekleri()).toEqual([])
        ozelModKurallari(html)
    })

    it('swap (Gizli oturum): cikis kaynakla ayni (zincir, adres) ise PRIVATE_QUOTE ve ATS ucret teklifi GITMEZ; ikiz: baska varlik ayni kurulumda teklif atar', async () => {
        // Engellenen yarim: onCapture setup() SONRASI kosar, kurulum anindaki uydurma (fitDeliveryToSource) yeniden calismaz; ayni cift zorlanir.
        const { state } = await kur('swap', { onCapture: (inst) => { inst.setupState.outputToken = usdcTokenOf(1) } })
        state.amount = '25'
        await teklifBekle(state)
        expect(state.sameAsSource).toBe(true)
        expect(state.quoteEligible).toBe(false)
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO'])
        klasikMesajYok()
        // Ikiz yarim (pozitif kontrol): tek fark cikis tokeni; eksik teklifin nedeni ayni-varlik korumasidir, baska hicbir sey degil.
        const ikiz = await kur('swap', { onCapture: (inst) => { inst.setupState.outputToken = nativeTokenOf(1) } })
        ikiz.state.amount = '25'
        await teklifBekle(ikiz.state)
        expect(ikiz.state.sameAsSource).toBe(false)
        expect(mesajlar()).toEqual(['PRIVATE_PROVIDER_INFO', 'PRIVATE_QUOTE', 'ATS_PRIVATE_FEE_QUOTE'])
    })

    it.each(KENDINE)('%s: /getChainTokens YALNIZ teslim secici ACILINCA ve kapsam cikis tokeninin agidir; secici acikken satir basina bakiye RPC si yok (sT13)', async (mode, zincir, agDegisir) => {
        await kur(mode)
        expect(yollar().filter((y) => y === '/getChainTokens')).toEqual([])
        const kapaliBakiye = bakiyeOkumalari().length
        const { html, state } = await kur(mode, { onCapture: (inst) => { inst.setupState.pickerOpen = true } })
        const listeler = kayit.istekler.filter((i) => i.tur === 'http' && i.yol === '/getChainTokens')
        expect(listeler.length).toBeGreaterThan(0)
        // Her istek govdesi yalniz cikis tokeninin agini tasir (Takas kaynak agin, Kopru kaynaktan baska bir agin listesini ister).
        expect([...new Set(listeler.map((i) => i.govde.chainId))]).toEqual([state.outputToken.chainId])
        expect(state.outputToken.chainId === zincir.chainId).toBe(!agDegisir)
        expect(JSON.stringify(listeler.map((i) => i.govde)).toLowerCase()).not.toContain(GIZLI_ADRES)
        expect(bakiyeOkumalari()).toHaveLength(kapaliBakiye)
        expect(fiyatIstekleri()).toEqual([])
        expect(yollar().filter((y) => y.endsWith('/getImportedTokens'))).toEqual([])
        klasikMesajYok()
        ozelModKurallari(html)
    })
})

// ----------------------------------------------------------------------------------------------------------------
// TUM EKRANLAR: genel kurallar. Her ozel mod ekraninda (a) izinli kume disinda HTTP istegi yok, (b) KAPI ve KALKAR
// satirlari sifir, (c) yerel olmayan <img src> yok. Izinli HTTP uclari: KALIR ya da DARALIR satirlari (6, 8, 9, 19, 23).
// ----------------------------------------------------------------------------------------------------------------
const IZINLI_HTTP = new Set(['/getChainTokens', '/wallet/history', '/news', '/wallet/reputation', '/getTokenByName'])
const UZAK = /^(https?:)?\/\//
// Gorsel alan her kapi taranir: img/source/image/link etiketlerinin src, srcset ve href ozellikleri (srcset'te her aday
// ayri), ve cizilen HTML'in her yerindeki CSS url(...) (satir ici style, background-image).
export const uzakGorseller = (html) => {
    const adaylar = []
    for (const [etiket] of html.matchAll(/<(?:img|source|image|link)\b[^>]*>/gi)) {
        for (const [, ad, , deger] of etiket.matchAll(/\s(src|srcset|href|xlink:href)=(["'])(.*?)\2/gi)) {
            if (/^srcset$/i.test(ad)) adaylar.push(...deger.split(',').map((a) => a.trim().split(/\s+/)[0]))
            else adaylar.push(deger)
        }
    }
    for (const [, ic] of html.matchAll(/url\(([^)]*)\)/gi)) adaylar.push(ic.trim().replace(/^(["'])(.*)\1$/, '$2'))
    return adaylar.filter((src) => UZAK.test(src))
}
const rpcZincirleri = () => [...new Set(kayit.istekler.filter((i) => i.tur === 'rpc-bakiye').map((i) => i.chainId))].sort((a, b) => a - b)
const carpanZincirleri = () => [...new Set(kayit.istekler.filter((i) => i.tur === 'carpan').flatMap((i) => i.zincirler))].sort((a, b) => a - b)

// LI.FI token listesi (satir 14, KALIR, kabul edilen): yalniz Kopru secicileri ister; ekstra izinli olarak verilir.
const LIFI_TOKENS = 'https://li.quest/v1/tokens?chainTypes=EVM'

function ozelModKurallari(html, ekstraIzinli = []) {
    expect(yollar().filter((y) => !IZINLI_HTTP.has(y) && !ekstraIzinli.includes(y))).toEqual([])
    expect(fiyatIstekleri()).toEqual([])
    expect(yollar().filter((y) => y.endsWith('/getImportedTokens'))).toEqual([])
    expect(mesajlar()).not.toContain('SOLANA_GET_ADDRESS')
    expect(mesajlar()).not.toContain('GASLESS_TOKEN_OPTIONS')
    expect(kayit.istekler.filter((i) => i.tur === 'fetch')).toEqual([])
    expect(uzakGorseller(html)).toEqual([])
}

const UZAK_LOGOLU = {
    name: 'Uzak', symbol: 'REM', address: '0x' + '77'.repeat(20), chain: 'binance-smart-chain', decimals: 18, coingecko_id: 'remote-token',
    image: { thumb: 'https://cdn.example/t.png', small: 'https://cdn.example/s.png', large: 'https://cdn.example/l.png' },
}
const GECMIS_SATIRI = {
    hash: '0x' + 'aa'.repeat(32), chainId: 56, from_address: GIZLI.address, to_address: '0x' + '11'.repeat(20),
    category: 'send', receipt_status: '1', block_timestamp: new Date().toISOString(),
    to_address_entity_logo: 'https://cdn.example/entity.png', native_transfers: [], erc20_transfers: [],
}

describe('Ozel mod istek envanteri -- Home (Varliklar): sorgu kumesi yalniz S, fiyat ve Solana yok (satir 1, 2, 5, 10, 11)', () => {
    const KOVA = { 56: [USDT_BSC, UZAK_LOGOLU], 1: [{ ...USDT_BSC, chain: 'ethereum' }], 137: [{ ...USDT_BSC, chain: 'polygon-pos' }] }

    it('KONTROL: normal modda "Tum aglar" uc aginin RPC sine gider, fiyat istenir, Solana adresi istenir, uzak logo cizilir', async () => {
        const { html } = await ekranKur(Home, 'Home', { gizli: false, depo: { imported_tokens: { acc1: KOVA } } })
        expect(rpcZincirleri()).toEqual([1, 56, 137])
        expect(yollar().filter((y) => y.endsWith('/getTokensDataById')).length).toBeGreaterThan(0)
        expect(mesajlar()).toContain('SOLANA_GET_ADDRESS')
        expect(uzakGorseller(html).length).toBeGreaterThan(0)
    })

    it('gizli modda yalniz S (BSC) okunur; Ethereum ve Polygon SORGULANMAZ; genel kurallar', async () => {
        const { html } = await ekranKur(Home, 'Home', { gizli: true, depo: { imported_tokens: { [GIZLI.key]: KOVA } } })
        expect(rpcZincirleri()).toEqual([56])
        expect(kayit.istekler.filter((i) => i.tur === 'rpc-saglayici').map((i) => i.rpc).filter((r) => r !== BSC.rpc[0].url)).toEqual([])
        ozelModKurallari(html)
    })
})

describe('Ozel mod istek envanteri -- Home (Aktivite): uzak gorsel ve desteklenmeyen ag istegi YOK (satir 8 ve 22)', () => {
    const aktivite = (instance) => { instance.setupState.activeTab = 'activity' }

    it('KONTROL: normal modda gecmis istenir ve varlik logosu uzak URL ile cizilir', async () => {
        kayit.gecmis = [GECMIS_SATIRI]
        const { html } = await ekranKur(Home, 'Home', { gizli: false, onCapture: aktivite })
        expect(yollar()).toContain('/wallet/history')
        expect(uzakGorseller(html)).toContain('https://cdn.example/entity.png')
    })

    it('gizli modda desteklenen agda (BSC) gecmis KALIR ama uzak gorsel yok; genel kurallar', async () => {
        kayit.gecmis = [GECMIS_SATIRI]
        const { html } = await ekranKur(Home, 'Home', { gizli: true, onCapture: aktivite })
        const gecmis = kayit.istekler.filter((i) => i.tur === 'http' && i.yol === '/wallet/history')
        expect(gecmis).toHaveLength(1)
        expect(gecmis[0].govde).toEqual({ address: GIZLI.address, chainId: 56 })
        ozelModKurallari(html)
        expect(html).not.toContain('cdn.example')
    })

    it.each([{ ag: GNOSIS, id: 100 }, { ag: POLYGON, id: 137 }])('gizli modda zincir $id: destek durumuna gore /wallet/history', async ({ ag, id }) => {
        kayit.gecmis = [GECMIS_SATIRI]
        const { html } = await ekranKur(Home, 'Home', { gizli: true, ag, onCapture: aktivite })
        const gecmis = kayit.istekler.filter((i) => i.tur === 'http' && i.yol === '/wallet/history')
        if (id === 100) {
            expect(gecmis).toEqual([])
            expect(html).toContain('data-history-unsupported')
        } else {
            expect(gecmis).toHaveLength(1)
            expect(html).not.toContain('data-history-unsupported')
        }
        ozelModKurallari(html)
    })
})

describe('Ozel mod istek envanteri -- sunucu liste satirlarinin uzak logolari cizilmez (satir 7)', () => {
    // /getChainTokens yaniti (KALIR, satir 6) uzak logo URL'leri tasir; arayuz onlari tokenLogo() ile cizer ve ozel modda
    // yalniz yerel yollar kabul edilir. Fiksturde uzak URL gercekten var: kontrol normal modda cizildigini gosterir.
    const SUNUCU_TOKENI = {
        name: 'Sunucu Tokeni', symbol: 'SRV', address: '0x' + '99'.repeat(20), chainId: 56, decimals: 18, coingecko_id: 'srv-token',
        image: { thumb: 'https://cdn.example/srv-t.png', small: 'https://cdn.example/srv-s.png', large: 'https://cdn.example/srv-l.png' },
    }
    const EKRANLAR = [
        ['SearchTokens', SearchTokens, 'SearchTokens'],
        ['swapFrom', SwapFrom, 'swapFrom'],
        ['swapTo', SwapTo, 'swapTo'],
    ]

    it.each(EKRANLAR)('%s: KONTROL -- normal modda sunucu satirinin uzak logosu cizilir', async (_ad, Bilesen, ad) => {
        kayit.zincirTokenleri = [SUNUCU_TOKENI]
        const { html } = await ekranKur(Bilesen, ad, { gizli: false })
        expect(html).toContain('SRV')
        expect(uzakGorseller(html).some((src) => src.includes('cdn.example/srv'))).toBe(true)
    })

    it.each(EKRANLAR)('%s: gizli modda sunucu satiri gorunur ama uzak logo YOK (yer tutucu); genel kurallar', async (_ad, Bilesen, ad) => {
        kayit.zincirTokenleri = [SUNUCU_TOKENI]
        const { html } = await ekranKur(Bilesen, ad, { gizli: true })
        expect(html).toContain('SRV')
        expect(html).not.toContain('cdn.example')
        ozelModKurallari(html)
    })
})

describe('Ozel mod istek envanteri -- eldeki (kayitli) token satirlarinin uzak logolari cizilmez: Kopru secicileri ve SelectAssets (satir 7)', () => {
    // bridgeFrom / bridgeTo satirlari LI.FI listesinden (satir 14, KALIR) ve kayitli tokenlerden gelir; SelectAssets yalniz
    // kayitli tokenleri listeler (arama /getChainTokens'a gider, yukaridaki blokta). Kayitli satirin logosu uzak URL tasir.
    const EKRANLAR = [
        ['bridgeFrom', BridgeFrom, 'bridgeFrom'],
        ['bridgeTo', BridgeTo, 'bridgeTo'],
        ['SelectAssets', SelectAssets, 'SelectAssets'],
    ]
    const depo = { imported_tokens: { acc1: { 56: [UZAK_LOGOLU] }, [GIZLI.key]: { 56: [UZAK_LOGOLU] } } }
    const hazirla = () => { cryptoStore().bridge = { inToken: null, outToken: null, toChain: BSC, amount: 0 } }

    it.each(EKRANLAR)('%s: KONTROL -- normal modda kayitli satirin uzak logosu cizilir', async (_ad, Bilesen, ad) => {
        const { html } = await ekranKur(Bilesen, ad, { gizli: false, depo, hazirla })
        expect(html).toContain('REM')
        expect(uzakGorseller(html).some((src) => src.includes('cdn.example/'))).toBe(true)
    })

    it.each(EKRANLAR)('%s: gizli modda kayitli satir gorunur ama uzak logo YOK (yer tutucu); genel kurallar', async (_ad, Bilesen, ad) => {
        const { html } = await ekranKur(Bilesen, ad, { gizli: true, depo, hazirla })
        expect(html).toContain('REM')
        expect(html).not.toContain('cdn.example')
        ozelModKurallari(html, [LIFI_TOKENS])
    })
})

describe('Ozel mod istek envanteri -- Token, SearchTokens, ImportToken (satir 3, 6, 23)', () => {
    const TOKEN_REF = { id: null, chainId: 56, address: '0x0', decimals: 18, symbol: 'BNB' }

    it('KONTROL: normal modda Token kanonik kayit ve grafik icin fiyat uclarini ister', async () => {
        await ekranKur(Token, 'Token', {
            gizli: false, props: { id: 'binancecoin' },
            hazirla: () => { cryptoStore().selected_token_ref = { ...TOKEN_REF, id: 'binancecoin' } },
        })
        expect(fiyatIstekleri().length).toBeGreaterThan(0)
    })

    it('gizli modda Token acilir, bakiye satirin zincirinden okunur, hicbir ag istegi yok; genel kurallar', async () => {
        const { html } = await ekranKur(Token, 'Token', {
            gizli: true, props: { id: null },
            hazirla: () => { cryptoStore().selected_token_ref = TOKEN_REF },
        })
        expect(yollar()).toEqual([])
        expect(kayit.istekler.filter((i) => i.tur === 'rpc-bakiye').map((i) => i.chainId)).toEqual([56])
        ozelModKurallari(html)
    })

    it('SearchTokens: gizli modda yalniz /getChainTokens (KALIR); genel kurallar', async () => {
        const { html } = await ekranKur(SearchTokens, 'SearchTokens', { gizli: true })
        expect(yollar().every((y) => y === '/getChainTokens')).toBe(true)
        ozelModKurallari(html)
    })

    it('ImportToken: gizli modda sozlesme dogrulamasi yalniz /getTokenByName ve zincir okumasi yapar; genel kurallar', async () => {
        const { html, state } = await ekranKur(ImportToken, 'ImportToken', { gizli: true, props: { chain: 'binance-smart-chain' } })
        kayit.istekler.length = 0
        await state.validateTokenContract('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d')
        expect(yollar()).toEqual(['/getTokenByName'])
        expect(kayit.istekler.filter((i) => i.tur === 'rpc-saglayici').map((i) => i.rpc)).toEqual([BSC.rpc[0].url])
        ozelModKurallari(html)
    })
})

describe('Ozel mod istek envanteri -- carpan okumasi yalniz S zincirinin xStock satirlari icin (satir 30)', () => {
    const SPY = XSTOCKS.find((x) => x.symbol === 'SPYx')
    const satir = (zincirAdi) => ({
        name: SPY.name, symbol: SPY.symbol, address: SPY.address, chain: zincirAdi, decimals: 18, coingecko_id: null,
        image: { thumb: '/default-token.png', small: '/default-token.png', large: '/default-token.png' },
    })
    const KOVA = { 1: [satir('ethereum')], 56: [satir('binance-smart-chain')] }

    it('KONTROL: normal modda "Tum aglar" iki aginin xStock satirini da carpan okumasina verir', async () => {
        await ekranKur(Home, 'Home', { gizli: false, depo: { imported_tokens: { acc1: KOVA } } })
        // Normal modda TON yerel coin satiri da tohumlanir (-239): onu saymayiz, iki EVM aginin ikisi de olmali.
        expect(carpanZincirleri()).toEqual(expect.arrayContaining([1, 56]))
    })

    it('gizli modda yalniz S (BSC) satirlari carpan okumasina gider; Ethereum xStock satiri sorgulanmaz', async () => {
        await ekranKur(Home, 'Home', { gizli: true, depo: { imported_tokens: { [GIZLI.key]: KOVA } } })
        expect(carpanZincirleri()).toEqual([56])
    })

    it('gizli modda S Ethereum iken yalniz Ethereum satiri gider', async () => {
        await ekranKur(Home, 'Home', { gizli: true, ag: ETH, depo: { imported_tokens: { [GIZLI.key]: KOVA } } })
        expect(carpanZincirleri()).toEqual([1])
    })
})

describe('Ozel mod istek envanteri -- uzak gorsel taramasi kendini yakalar (sabotaj)', () => {
    it.each([
        ['img src', '<img src="https://cdn.example/a.png">'],
        ['img srcset', '<img src="/y.png" srcset="/a.png 1x, https://cdn.example/b.png 2x">'],
        ['source srcset', '<picture><source srcset="//cdn.example/c.webp"></picture>'],
        ['svg image href', '<svg><image href="https://cdn.example/d.png"/></svg>'],
        ['link href', '<link rel="preload" as="image" href="https://cdn.example/e.png">'],
        ['style url()', '<div style="background-image:url(https://cdn.example/f.png)"></div>'],
        ['style url(quoted)', "<div style='background:url(\"//cdn.example/g.png\")'></div>"],
    ])('%s yakalanir', (_ad, html) => {
        expect(uzakGorseller(html).length).toBeGreaterThan(0)
    })

    it('yerel ve data: kaynaklar yakalanmaz', () => {
        expect(uzakGorseller('<img src="/chains/56.png" srcset="/a.png 1x"><div style="background:url(data:image/png;base64,AA)"></div>')).toEqual([])
    })
})

describe('Ozel mod istek envanteri -- App.vue baglanti izleyicileri adres tasimaz (satir 18 ve 21)', () => {
    const kaynak = readFileSync(fileURLToPath(new URL('../popup/App.vue', import.meta.url)), 'utf8')

    it.each([
        ['reconnect', /const reconnect = async \(\) => \{/],
        ['checkConnection', /const checkConnection = async \(\) => \{/],
    ])('%s govdesinde hesap/adres bilgisi gecmez', (_ad, imza) => {
        const govde = blokGovdesi(kaynak, imza)
        expect(govde, 'govde bulunamadi').not.toBeNull()
        expect(govde.length).toBeGreaterThan(80)
        expect(govde).not.toMatch(/address|active_account|privateAddress|0x[0-9a-fA-F]{40}/i)
    })

    it('yoklama govdesi ag tarafinda yalniz network.rpc ve eth_blockNumber kullanir (adressiz IP + ag)', () => {
        const govde = blokGovdesi(kaynak, /const checkConnection = async \(\) => \{/)
        expect(govde).toContain('fetch(network.rpc')
        expect(govde).toContain("method: 'eth_blockNumber'")
        expect(govde).toContain('params: []')
    })
})

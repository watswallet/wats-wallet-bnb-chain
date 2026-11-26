// swapTo.vue (SSR) -- "Alinan" listesi ihracci uygunluguna gore suzulur (Ilk Alim Kapisi, Task 46; K34, K36; spec 6.8).
//
// KOK NEDEN: uygun olmayan bStocks Takas "Alinan" secicisinde gorunuyor (reverse() ile de tasinabiliyordu) ve
// `importedTokens` mount'ta BIR KEZ suzulen sabit bir degerdi: store yuklenirken elenen bStocks ready olunca da geri
// gelmezdi. Bu dosyanin kapattigi hata siniflari:
//  (1) uygun olmayan bStocks Tokenlarim / Tum tokenlar / arama / yapistirilan adreste gorunur;
//  (2) yukleme sirasinda gorunur (yukleme = gizli) ya da ready olunca geri GELMEZ (sabit suzme);
//  (3) abonelik BSC disi zincirde de mesaj atar (Ethereum / Arbitrum'da xStocks satirlari vardir ama genel Takas'ta
//      dislidir -> mesaj YOK, PE15) ya da BSC'de birden cok mesaj atar;
//  (4) Odenen (swapFrom) listesi suzulur (K35: Sat acik).
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu). useStockEligibility
// test-utils/useStockEligibilityMock.js ile surulur; yalniz "abonelik sayisi" testleri GERCEK kancayi kullanir (modu.gercek).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const modu = vi.hoisted(() => ({ gercek: false }))
vi.mock('../../composables/useStockEligibility', async (importOriginal) => {
    const actual = await importOriginal()
    const { createUseStockEligibilityMock } = await import('../../test-utils/useStockEligibilityMock.js')
    const sahte = createUseStockEligibilityMock(actual)
    return { ...sahte, useStockEligibility: (options) => (modu.gercek ? actual.useStockEligibility(options) : sahte.useStockEligibility(options)) }
})

// Ozellik bayragi: derleme sabiti test boyunca degisebilsin diye okuyucu (getter) olarak taklit edilir.
const bayrak = vi.hoisted(() => ({ acik: true }))
vi.mock('../../utils/featureFlags', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, get XSTOCKS_ENABLED() { return bayrak.acik } }
})

const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../../composables/useTokenBalance', () => ({ useTokenBalance: (...a) => useTokenBalanceMock(...a) }))

const axiosPost = vi.fn()
vi.mock('axios', () => ({ default: { post: (...a) => axiosPost(...a), get: async () => ({ status: 200, data: { tokens: {} } }) } }))

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import {
    eligibilityMock, resetEligibilityMock, ELIGIBILITY_ALL, ELIGIBILITY_NONE, ELIGIBILITY_XSTOCKS_ONLY, ELIGIBILITY_LOADING,
} from '../../test-utils/useStockEligibilityMock.js'
import { disposeStockEligibilityStore } from '../../composables/useStockEligibility'
import { networkStore } from '../../store/network'
import { balanceKey } from '../../utils/tokenScope'
import SwapFrom from './swapFrom.vue'
import SwapTo from './swapTo.vue'
import supported_chains from '../../data/supported_chains.json'
import { BSTOCKS } from '../../data/bStocks'
import { RETIRED_BSTOCKS } from '../../data/bStocksRetired'

const here = dirname(fileURLToPath(import.meta.url))
const ETH = supported_chains.find((c) => c.chainId === 1)
const BSC = supported_chains.find((c) => c.chainId === 56)
const ARB = supported_chains.find((c) => c.chainId === 42161)
const CRCLB = BSTOCKS.find((s) => s.symbol === 'CRCLB')
const GOOGLB = BSTOCKS.find((s) => s.symbol === 'GOOGLB')
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
const img = { thumb: 't', small: 's', large: 'l' }
const ACCOUNT = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }

const storedRow = (t) => ({
    name: t.name, symbol: t.symbol, address: t.address, decimals: 18,
    coingecko_id: t.coingeckoId ?? t.coingecko_id, image: img,
})
const serverRow = (t, chainId, chain) => ({ ...storedRow(t), address: t.address.toLowerCase(), chain, chainId })
const USDT_ROW = { name: 'Tether USD', symbol: 'USDT', address: USDT_BSC, decimals: 18, coingecko_id: 'tether', image: img }
const USDC_FIELDS = { name: 'USD Coin', symbol: 'USDC', address: USDC_BSC, coingeckoId: 'usd-coin' }

const durumMesajlari = []
const yanit = (mesaj) => {
    durumMesajlari.push(mesaj)
    return { bstocks: { decision: 'OK', reason: 'OK', ipCountry: null }, xstocks: { decision: 'OK', reason: 'OK', ipCountry: null } }
}

beforeEach(() => {
    modu.gercek = false
    bayrak.acik = true
    resetEligibilityMock(ELIGIBILITY_ALL)
    disposeStockEligibilityStore()
    durumMesajlari.length = 0
    axiosPost.mockReset()
    useTokenBalanceMock.mockClear()
})
afterEach(() => {
    modu.gercek = false
    disposeStockEligibilityStore()
    delete globalThis.chrome
})

async function mount(Component, name, { chain = BSC, imported = {}, serverTokens = [] } = {}) {
    installChromeStub({ currentNetwork: chain, active_account: ACCOUNT, imported_tokens: { acc1: imported } }, { eligibility: yanit })
    axiosPost.mockImplementation(async (url) => {
        if (String(url).endsWith('/getChainTokens')) return { status: 200, data: { success: true, tokens: serverTokens } }
        if (String(url).endsWith('/getTokensDataById')) return { status: 200, data: { success: true, tokens: [] } }
        throw new Error('beklenmeyen url ' + url)
    })
    const app = createApp(Component)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const network = networkStore()
    network.currentNetwork = chain
    network.rpc = chain.rpc[0].url
    const captured = captureInstance(app, name)
    const html = await render(app)
    return { st: captured.instance.setupState, html }
}

const simgeler = (liste) => liste.map((t) => t.symbol)

describe('swapTo ssr: uygun olmayan bStocks "Alinan" listesinde YOK (K34, K36)', () => {
    it('pozitif bekci: katalog satirlari gercek ve senaryolar bStocks icin ayrisiyor', () => {
        expect(CRCLB).toBeDefined()
        expect(GOOGLB).toBeDefined()
        expect(ETH).toBeDefined()
        expect(ARB).toBeDefined()
        expect(ELIGIBILITY_NONE.verdicts.bstocks.decision).toBe('BLOCKED')
        expect(ELIGIBILITY_ALL.verdicts.bstocks.decision).toBe('OK')
    })

    it('swapTo: uygun olmayan bStocks listede ve aramada YOK; yapistirilan adres bulunamaz', async () => {
        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        const { st, html } = await mount(SwapTo, 'swapTo', {
            imported: { 56: [USDT_ROW, storedRow(CRCLB)] },
            serverTokens: [serverRow(CRCLB, 56, 'binance-smart-chain'), serverRow(GOOGLB, 56, 'binance-smart-chain'), serverRow(USDC_FIELDS, 56, 'binance-smart-chain')],
        })
        expect(simgeler(st.importedTokens)).toEqual(['USDT'])
        expect(simgeler(st.displayedTokens)).toEqual(['USDC'])
        expect(html).not.toContain('CRCLB')
        expect(html).not.toContain('GOOGLB')

        for (const sorgu of ['crclb', 'googlb', CRCLB.address, CRCLB.address.toLowerCase(), GOOGLB.address.toLowerCase()]) {
            st.searchQuery = sorgu
            expect(st.filteredTokens, `arama: ${sorgu}`).toEqual([])
        }
        // siradan token aramada kalir (suzgec her seyi gizlemez)
        st.searchQuery = 'usdc'
        expect(simgeler(st.filteredTokens)).toEqual(['USDC'])
    })

    it('swapTo: uygun olunca ayni bStocks Tokenlarim, Tum tokenlar ve aramada VAR (pozitif es)', async () => {
        const { st } = await mount(SwapTo, 'swapTo', {
            imported: { 56: [USDT_ROW, storedRow(CRCLB)] },
            serverTokens: [serverRow(GOOGLB, 56, 'binance-smart-chain')],
        })
        expect(simgeler(st.importedTokens)).toEqual(['USDT', 'CRCLB'])
        expect(simgeler(st.displayedTokens)).toEqual(['GOOGLB'])
        st.searchQuery = GOOGLB.address.toLowerCase()
        expect(simgeler(st.filteredTokens)).toEqual(['GOOGLB'])
    })

    // K28 ilkesinin bStocks karsiligi: BMNRB / FLNCB katalogdan cikti (e7089f2d) ama sunucunun /getChainTokens listesinde
    // kaldi; kapi onlari bstocks sayar, secici de ayni ihracciya sorar. Uygun ihraccide listede KALIR (dislama YOK).
    it('swapTo: emekli bStocks (BMNRB / FLNCB) uygun olmayan ihraccide Tokenlarim, Tum tokenlar ve aramada YOK; uygun olunca VAR', async () => {
        const [BMNRB, FLNCB] = RETIRED_BSTOCKS
        resetEligibilityMock(ELIGIBILITY_NONE)
        const { st, html } = await mount(SwapTo, 'swapTo', {
            imported: { 56: [USDT_ROW, storedRow(BMNRB)] },
            serverTokens: [serverRow(FLNCB, 56, 'binance-smart-chain'), serverRow(USDC_FIELDS, 56, 'binance-smart-chain')],
        })
        expect(simgeler(st.importedTokens)).toEqual(['USDT'])
        expect(simgeler(st.displayedTokens)).toEqual(['USDC'])
        expect(html).not.toContain('BMNRB')
        expect(html).not.toContain('FLNCB')
        for (const sorgu of ['bmnrb', 'flncb', BMNRB.address, BMNRB.address.toLowerCase(), FLNCB.address.toLowerCase()]) {
            st.searchQuery = sorgu
            expect(st.filteredTokens, `arama: ${sorgu}`).toEqual([])
        }

        // pozitif es: ihracci uygun olunca ayni satirlar gelir (store reaktif)
        eligibilityMock.scenario = ELIGIBILITY_ALL
        st.searchQuery = ''
        expect(simgeler(st.importedTokens)).toEqual(['USDT', 'BMNRB'])
        expect(simgeler(st.displayedTokens).sort()).toEqual(['FLNCB', 'USDC'])
    })

    it('swapTo: yukleniyor (ELIGIBILITY_LOADING) bStocks YOK; ready + uygun -> gelir (importedTokens reaktif)', async () => {
        resetEligibilityMock(ELIGIBILITY_LOADING)
        const { st } = await mount(SwapTo, 'swapTo', {
            imported: { 56: [USDT_ROW, storedRow(CRCLB)] },
            serverTokens: [serverRow(GOOGLB, 56, 'binance-smart-chain')],
        })
        expect(simgeler(st.importedTokens)).toEqual(['USDT'])
        expect(st.displayedTokens).toEqual([])
        // mount'ta bir kez suzulseydi (sabit deger) bStocks ready olunca da geri gelmezdi
        eligibilityMock.scenario = ELIGIBILITY_ALL
        expect(simgeler(st.importedTokens)).toEqual(['USDT', 'CRCLB'])
        expect(simgeler(st.displayedTokens)).toEqual(['GOOGLB'])
        // ve geri: uygunluk kaybolursa yeniden gizlenir
        eligibilityMock.scenario = ELIGIBILITY_NONE
        expect(simgeler(st.importedTokens)).toEqual(['USDT'])
        expect(st.displayedTokens).toEqual([])
    })

    it('swapTo: gizli bStocks icin de bakiye okunur (ready olunca satir bakiyesiyle gelsin)', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        await mount(SwapTo, 'swapTo', { imported: { 56: [USDT_ROW, storedRow(CRCLB)] } })
        const okunan = useTokenBalanceMock.mock.calls.map((c) => String(c[1]).toLowerCase())
        expect(okunan).toContain(CRCLB.address.toLowerCase())
        expect(okunan).toContain(USDT_BSC.toLowerCase())
    })

    it('swapTo: gizli imported bStocks sunucu listesinde ikinci kez belirmez (tekrar ayiklama HAM listeden)', async () => {
        resetEligibilityMock(ELIGIBILITY_LOADING)
        const { st } = await mount(SwapTo, 'swapTo', {
            // ayni yazim: tekrar ayiklama adres dizisini birebir karsilastirir (kucuk harf farki bu testin konusu degil)
            imported: { 56: [serverRow(CRCLB, 56, 'binance-smart-chain')] },
            serverTokens: [serverRow(CRCLB, 56, 'binance-smart-chain')],
        })
        eligibilityMock.scenario = ELIGIBILITY_ALL
        expect(simgeler(st.importedTokens)).toEqual(['CRCLB'])
        expect(st.displayedTokens).toEqual([])
    })
})

describe('swapTo ssr: Odenen (swapFrom) listesi SUZULMEZ (K35)', () => {
    it('swapFrom: uygun olmayan bStocks Odenen listesinde VAR', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        const { st } = await mount(SwapFrom, 'swapFrom', { imported: { 56: [storedRow(CRCLB)] } })
        expect(st.displayedTokens.map((t) => balanceKey(t.chainId, t.address))).toContain(balanceKey(56, CRCLB.address))
    })

    it('swapFrom: yukleniyorken de bStocks VAR', async () => {
        resetEligibilityMock(ELIGIBILITY_LOADING)
        const { st } = await mount(SwapFrom, 'swapFrom', { imported: { 56: [storedRow(CRCLB)] } })
        expect(st.displayedTokens.map((t) => balanceKey(t.chainId, t.address))).toContain(balanceKey(56, CRCLB.address))
    })
})

// VITE_XSTOCKS_ENABLED KAPALI VE ACIK iki derlemede de kosar: acikta katalogda 1 ve 42161 icin xStocks satirlari vardir
// ama genel Takas'ta dislidir; hicbir derlemede BSC disi zincirde uygunluk mesaji gitmez.
describe.each([[true], [false]])('swapTo ssr: uygunluk aboneligi yalniz genel Takas CIKTISI olabilen zincirde (VITE_XSTOCKS_ENABLED=%s)', (xstocks) => {
    beforeEach(() => { bayrak.acik = xstocks })

    it.each([[1], [42161]])('BSC disi zincirde (%s) useStockEligibility enabled false ve STOCK_GATE_STATUS mesaji gitmez', async (id) => {
        const zincir = supported_chains.find((c) => c.chainId === id)
        expect(zincir).toBeDefined()
        await mount(SwapTo, 'swapTo', { chain: zincir })
        expect(eligibilityMock.options).toHaveLength(1)
        expect(eligibilityMock.options[0].enabled()).toBe(false)

        modu.gercek = true
        disposeStockEligibilityStore()
        await mount(SwapTo, 'swapTo', { chain: zincir })
        expect(durumMesajlari).toEqual([])
    })

    it("swapTo: BSC'de ilk acilista tek mesaj", async () => {
        await mount(SwapTo, 'swapTo', { chain: BSC })
        expect(eligibilityMock.options[0].enabled()).toBe(true)

        modu.gercek = true
        disposeStockEligibilityStore()
        await mount(SwapTo, 'swapTo', { chain: BSC })
        expect(durumMesajlari).toEqual([{ type: 'STOCK_GATE_STATUS' }])
    })
})

describe('swapTo ssr: enabled getter zincir kimligini Number() ile karsilastirir', () => {
    it("zincir kimligi dize ('56') gelse de enabled true; zincir yokken false", async () => {
        await mount(SwapTo, 'swapTo', { chain: { ...BSC, chainId: '56' } })
        expect(eligibilityMock.options[0].enabled()).toBe(true)
        networkStore().currentNetwork = undefined
        expect(eligibilityMock.options[0].enabled()).toBe(false)
    })
})

describe('swapTo ssr: kaynak kilidi', () => {
    const kod = (rel) => yorumsuz(readFileSync(join(here, rel), 'utf8'))

    it('swapTo TEK swapable noktasi: dislama + uygunluk; importedTokens computed, mount-ici atama YOK', () => {
        const src = kod('swapTo.vue')
        expect(src).toMatch(/const swapable = \(token\) => !outputExcluded\(token\)\s*&& !unavailableOutput\(network\.currentNetwork\?\.chainId, token\.address, isAvailable\)/)
        expect(src).toMatch(/const importedTokens = computed\(\(\) => importedRaw\.value\.filter\(swapable\)\)/)
        expect(src).toMatch(/enabled: \(\) => generalSwapStockChainIds\(\)\.includes\(Number\(network\.currentNetwork\?\.chainId\)\)/)
        expect(src).not.toMatch(/importedTokens\.value\s*=/)
        expect((src.match(/\.filter\(swapable\)/g) || []).length).toBe(2)
    })

    it('swapFrom uygunluk kancasini ve unavailableOutput u HIC kullanmaz (K35)', () => {
        const src = kod('swapFrom.vue')
        expect(src).not.toMatch(/useStockEligibility/)
        expect(src).not.toMatch(/unavailableOutput|offerable/)
    })
})

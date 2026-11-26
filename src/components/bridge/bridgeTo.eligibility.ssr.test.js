// bridgeTo.vue (SSR) -- Kopru HEDEF listesi ihracci uygunluguna gore suzulur (Ilk Alim Kapisi, Task 46; K34, K36; spec 6.8).
//
// KOK NEDEN: uygun olmayan bStocks Kopru hedef secicisinde gorunuyordu. Zincir HEDEF zincirdir (crypto.bridge.toChain),
// aktif ag DEGIL: Ethereum'dan BSC'ye hisse alirken uygunluk BSC adresine, BSC'den Ethereum'a giderken ayni adresi
// tasiyan alakasiz bir tokene bakilmamalidir. Bu dosyanin kapattigi hata siniflari:
//  (1) uygun olmayan bStocks hedef listesinde gorunur (Tokenlarim ya da LI.FI listesinden);
//  (2) suzgec aktif agi kullanir (hedef zinciri degil);
//  (3) hedef zincir hisse hedefi olamiyorsa (BSC disi) abonelik mesaj atar, ya da BSC'de birden cok mesaj atar;
//  (4) yukleme sirasinda bStocks gorunur ya da ready olunca geri gelmez.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
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

vi.mock('../../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))

const { lifiListesi } = vi.hoisted(() => ({ lifiListesi: { tokens: {} } }))
vi.mock('axios', () => ({
    default: {
        get: vi.fn(async () => ({ status: 200, data: lifiListesi })),
        post: vi.fn(async () => ({ status: 200, data: { tokens: [] } })),
    },
}))

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import {
    eligibilityMock, resetEligibilityMock, ELIGIBILITY_ALL, ELIGIBILITY_NONE, ELIGIBILITY_LOADING,
} from '../../test-utils/useStockEligibilityMock.js'
import { disposeStockEligibilityStore } from '../../composables/useStockEligibility'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import BridgeTo from './bridgeTo.vue'
import supported_chains from '../../data/supported_chains.json'
import { BSTOCKS } from '../../data/bStocks'
import { RETIRED_BSTOCKS } from '../../data/bStocksRetired'

const here = dirname(fileURLToPath(import.meta.url))
const ETH = supported_chains.find((c) => c.chainId === 1)
const BSC = supported_chains.find((c) => c.chainId === 56)
const POLYGON = supported_chains.find((c) => c.chainId === 137)
const CRCLB = BSTOCKS.find((s) => s.symbol === 'CRCLB')
const GOOGLB = BSTOCKS.find((s) => s.symbol === 'GOOGLB')
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const img = { thumb: 't', small: 's', large: 'l' }
const ACCOUNT = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }

const lifi = (t) => ({ address: t.address, symbol: t.symbol, name: t.name ?? t.symbol, decimals: 18 })
const storedRow = (t) => ({ name: t.name, symbol: t.symbol, address: t.address, decimals: 18, coingecko_id: t.coingeckoId, image: img })

const durumMesajlari = []
const yanit = (mesaj) => {
    durumMesajlari.push(mesaj)
    return { bstocks: { decision: 'OK', reason: 'OK', ipCountry: null }, xstocks: { decision: 'OK', reason: 'OK', ipCountry: null } }
}

beforeEach(() => {
    modu.gercek = false
    resetEligibilityMock(ELIGIBILITY_ALL)
    disposeStockEligibilityStore()
    durumMesajlari.length = 0
    lifiListesi.tokens = {}
})
afterEach(() => {
    modu.gercek = false
    disposeStockEligibilityStore()
    delete globalThis.chrome
})

// aktif: cuzdanin AKTIF agi; hedef: crypto.bridge.toChain (iki ayri sey: bu dosyanin asil konusu).
async function mount({ aktif = ETH, hedef = BSC, imported = {} } = {}) {
    installChromeStub({ currentNetwork: aktif, active_account: ACCOUNT, imported_tokens: { acc1: imported } }, { eligibility: yanit })
    const app = createApp(BridgeTo)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const network = networkStore()
    network.currentNetwork = aktif
    network.rpc = aktif.rpc[0].url
    if (hedef !== undefined) cryptoStore().bridge.toChain = hedef
    const captured = captureInstance(app, 'bridgeTo')
    const html = await render(app)
    return { st: captured.instance.setupState, html }
}

const simgeler = (st) => st.mergedTokens.map((t) => t.symbol)

describe('bridgeTo ssr: uygun olmayan bStocks hedef listesinde YOK (K34, K36)', () => {
    it('pozitif bekci: katalog satirlari gercek', () => {
        expect(CRCLB).toBeDefined()
        expect(GOOGLB).toBeDefined()
        expect(POLYGON).toBeDefined()
    })

    it('bridgeTo: uygun olmayan bStocks hedef listesinde YOK (hedef zincir 56); uygun olunca VAR', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        lifiListesi.tokens = { 56: [lifi(CRCLB), lifi(GOOGLB), { address: USDT_BSC, symbol: 'USDT', name: 'Tether', decimals: 18 }] }
        const { st, html } = await mount({ aktif: ETH, hedef: BSC, imported: { 56: [storedRow(GOOGLB)] } })
        expect(simgeler(st)).toEqual(['USDT'])
        expect(html).not.toContain('CRCLB')
        expect(html).not.toContain('GOOGLB')

        // arama ve yapistirilan adres de bulamaz (tek suzgec noktasi)
        for (const sorgu of ['crclb', 'googlb', CRCLB.address, GOOGLB.address.toLowerCase()]) {
            st.searchQuery = sorgu
            expect(st.filteredTokens, `arama: ${sorgu}`).toEqual([])
        }

        eligibilityMock.scenario = ELIGIBILITY_ALL
        st.searchQuery = ''
        expect(simgeler(st).sort()).toEqual(['CRCLB', 'GOOGLB', 'USDT'])
        st.searchQuery = CRCLB.address.toLowerCase()
        expect(st.filteredTokens.map((t) => t.symbol)).toEqual(['CRCLB'])
    })

    // K28 ilkesinin bStocks karsiligi: emekli BMNRB / FLNCB (e7089f2d) LI.FI listesinden gelse bile uygun olmayan ihraccide
    // hedef listesinde YOK; uygun ihraccide kalir (bStocks hedef olarak acik, dislama YOK).
    it('bridgeTo: emekli bStocks (BMNRB / FLNCB) uygun olmayan ihraccide hedef listesinde YOK (hedef zincir 56); uygun olunca VAR', async () => {
        const [BMNRB, FLNCB] = RETIRED_BSTOCKS
        resetEligibilityMock(ELIGIBILITY_NONE)
        lifiListesi.tokens = { 56: [lifi(BMNRB), lifi(FLNCB), { address: USDT_BSC, symbol: 'USDT', name: 'Tether', decimals: 18 }] }
        const { st, html } = await mount({ aktif: ETH, hedef: BSC, imported: { 56: [storedRow(BMNRB)] } })
        expect(simgeler(st)).toEqual(['USDT'])
        expect(html).not.toContain('BMNRB')
        expect(html).not.toContain('FLNCB')
        for (const sorgu of ['bmnrb', 'flncb', BMNRB.address, FLNCB.address.toLowerCase()]) {
            st.searchQuery = sorgu
            expect(st.filteredTokens, `arama: ${sorgu}`).toEqual([])
        }

        eligibilityMock.scenario = ELIGIBILITY_ALL
        st.searchQuery = ''
        expect(simgeler(st).sort()).toEqual(['BMNRB', 'FLNCB', 'USDT'])
    })

    it('bridgeTo: yukleniyor (ELIGIBILITY_LOADING) bStocks YOK; ready + uygun -> gelir (reaktif)', async () => {
        resetEligibilityMock(ELIGIBILITY_LOADING)
        lifiListesi.tokens = { 56: [lifi(CRCLB), { address: USDT_BSC, symbol: 'USDT', name: 'Tether', decimals: 18 }] }
        const { st } = await mount({ aktif: ETH, hedef: BSC })
        expect(simgeler(st)).toEqual(['USDT'])
        eligibilityMock.scenario = ELIGIBILITY_ALL
        expect(simgeler(st).sort()).toEqual(['CRCLB', 'USDT'])
    })

    it('bridgeTo: suzgec HEDEF zincirdendir; aktif ag BSC iken hedef Ethereum -> ayni adresli token gorunur (aktif ag hisse sormaz)', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        lifiListesi.tokens = { 1: [lifi(CRCLB), { address: USDC_ETH, symbol: 'USDC', name: 'USD Coin', decimals: 6 }] }
        const { st } = await mount({ aktif: BSC, hedef: ETH })
        expect(simgeler(st).sort()).toEqual(['CRCLB', 'USDC'])
    })

    it('bridgeTo: toChain 56 degil iken (Polygon) suzgec hisse sormaz: ayni adresli token uygunluktan bagimsiz gorunur', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        lifiListesi.tokens = { 137: [lifi(CRCLB)] }
        const { st } = await mount({ aktif: BSC, hedef: POLYGON })
        expect(simgeler(st)).toEqual(['CRCLB'])
    })

    it('bridgeTo: aktif ag Ethereum iken hedef BSC -> uygun olmayan bStocks yine YOK (hedef zincir 56 sayilir)', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        lifiListesi.tokens = { 56: [lifi(CRCLB)] }
        const { st } = await mount({ aktif: ETH, hedef: BSC })
        expect(simgeler(st)).toEqual([])
    })
})

describe('bridgeTo ssr: uygunluk aboneligi yalniz hedef zincir hisse hedefi olabiliyorsa (PE15)', () => {
    it.each([[ETH, 'Ethereum'], [POLYGON, 'Polygon']])('bridgeTo: toChain hisse hedefi olamayan zincirse (%#: %s) STOCK_GATE_STATUS mesaji gitmez', async (hedef) => {
        await mount({ aktif: BSC, hedef })
        expect(eligibilityMock.options).toHaveLength(1)
        expect(eligibilityMock.options[0].enabled()).toBe(false)

        modu.gercek = true
        disposeStockEligibilityStore()
        await mount({ aktif: BSC, hedef })
        expect(durumMesajlari).toEqual([])
    })

    it('bridgeTo: toChain secilmemisse mesaj gitmez ve enabled false', async () => {
        await mount({ aktif: BSC, hedef: null })
        expect(eligibilityMock.options[0].enabled()).toBe(false)
        modu.gercek = true
        disposeStockEligibilityStore()
        await mount({ aktif: BSC, hedef: null })
        expect(durumMesajlari).toEqual([])
    })

    it("bridgeTo: hedef BSC ise ilk acilista tek mesaj (aktif ag Ethereum olsa da)", async () => {
        await mount({ aktif: ETH, hedef: BSC })
        expect(eligibilityMock.options[0].enabled()).toBe(true)
        modu.gercek = true
        disposeStockEligibilityStore()
        await mount({ aktif: ETH, hedef: BSC })
        expect(durumMesajlari).toEqual([{ type: 'STOCK_GATE_STATUS' }])
    })

    it("bridgeTo: hedef zincir kimligi dize ('56') gelse de enabled true (Number)", async () => {
        await mount({ aktif: ETH, hedef: { ...BSC, chainId: '56' } })
        expect(eligibilityMock.options[0].enabled()).toBe(true)
    })

    it('bridgeTo: aktif ag BSC iken hedef Ethereum -> mesaj gitmez (abonelik aktif aga DEGIL hedefe bakar)', async () => {
        await mount({ aktif: BSC, hedef: ETH })
        expect(eligibilityMock.options[0].enabled()).toBe(false)
    })
})

describe('bridgeTo ssr: kaynak kilidi', () => {
    const kod = yorumsuz(readFileSync(join(here, 'bridgeTo.vue'), 'utf8'))

    it('suzgec ve abonelik HEDEF zincirden (crypto.bridge.toChain); aktif ag (network) kullanilmaz', () => {
        expect(kod).toMatch(/unavailableOutput\(crypto\.bridge\.toChain\?\.chainId, token\.address, isAvailable\)/)
        expect(kod).toMatch(/enabled: \(\) => bridgeStockChainIds\(\)\.includes\(Number\(crypto\.bridge\.toChain\?\.chainId\)\)/)
        expect(kod).not.toMatch(/networkStore|network\.currentNetwork/)
    })
})

// Genel Takas / Kopru SECICILERI xStocks'u LISTELEMEZ (spec 5.9, katman 1) -- ve baska hicbir
// seyi gizlemez (bStocks genel Takas'ta kalir; ayni adres katalogda olmayan zincirde engellenmez).
// Hisseler sekmesi xStocks'u imported_tokens'a yazacagi icin (Task 16) bu suzgecler o yazimdan ONCE
// gelir: aksi halde sahip olunan bir xStock Takas'in "Gonderilen" listesinde gorunurdu.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...a) => useTokenBalanceMock(...a) }))

const axiosPost = vi.fn()
const axiosGet = vi.fn()
vi.mock('axios', () => ({ default: { post: (...a) => axiosPost(...a), get: (...a) => axiosGet(...a) } }))

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { yorumsuz } from '../test-utils/kaynakTarama.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { balanceKey } from '../utils/tokenScope'
import SwapFrom from './swap/swapFrom.vue'
import SwapTo from './swap/swapTo.vue'
import BridgeFrom from './bridge/bridgeFrom.vue'
import BridgeTo from './bridge/bridgeTo.vue'
import supported_chains from '../data/supported_chains.json'
import { XSTOCKS } from '../data/xStocks'
import { BSTOCKS } from '../data/bStocks'

const ETH = supported_chains.find((c) => c.chainId === 1)
const BSC = supported_chains.find((c) => c.chainId === 56)
const POLYGON = supported_chains.find((c) => c.chainId === 137)
const TSLA = XSTOCKS.find((s) => s.symbol === 'TSLAx')
const CRCLB = BSTOCKS.find((s) => s.symbol === 'CRCLB')
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const img = { thumb: 't', small: 's', large: 'l' }
const ACCOUNT = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }

// depodaki (imported_tokens) satir: Hisseler sekmesinin yazdigi sekil
const storedRow = (t) => ({
    name: t.name, symbol: t.symbol, address: t.address, decimals: 18,
    coingecko_id: t.coingeckoId ?? t.coingecko_id, image: img,
})
// /getChainTokens satiri: adres kucuk harf, sunucu chainId damgalar
const serverRow = (t, chainId, chain) => ({ ...storedRow(t), address: t.address.toLowerCase(), chain, chainId })
const USDT_ROW = { name: 'Tether USD', symbol: 'USDT', address: USDT, decimals: 6, coingecko_id: 'tether', image: img }
const USDC_FIELDS = { name: 'USD Coin', symbol: 'USDC', address: USDC, coingeckoId: 'usd-coin' }

afterEach(() => {
    delete globalThis.chrome
    axiosPost.mockReset()
    axiosGet.mockReset()
    useTokenBalanceMock.mockClear()
})

async function mountPicker(Component, name, { chain, imported = {}, serverTokens = [], liFiTokens = {}, prepare = () => {} }) {
    installChromeStub({ currentNetwork: chain, active_account: ACCOUNT, imported_tokens: { acc1: imported } })
    axiosPost.mockImplementation(async (url) => {
        if (String(url).endsWith('/getChainTokens')) return { status: 200, data: { success: true, tokens: serverTokens } }
        if (String(url).endsWith('/getTokensDataById')) return { status: 200, data: { success: true, tokens: [] } }
        throw new Error('beklenmeyen url ' + url)
    })
    axiosGet.mockImplementation(async (url) => {
        if (String(url).includes('li.quest/v1/tokens')) return { status: 200, data: { tokens: liFiTokens } }
        throw new Error('beklenmeyen url ' + url)
    })

    const app = createApp(Component)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const network = networkStore()
    network.currentNetwork = chain
    network.rpc = chain.rpc[0].url
    prepare()

    const captured = captureInstance(app, name)
    const html = await render(app)
    return { state: captured.instance.setupState, html }
}

const anahtarlar = (liste) => liste.map((t) => balanceKey(t.chainId, t.address))

describe('swapFrom - Gonderilen listesi', () => {
    it('Review Focus 5: sahip olunan (imported) ve sunucu listesindeki xStock GORUNMEZ; siradan token kalir', async () => {
        const { state, html } = await mountPicker(SwapFrom, 'swapFrom', {
            chain: ETH,
            imported: { 1: [USDT_ROW, storedRow(TSLA)] },
            serverTokens: [serverRow(TSLA, 1, 'ethereum')],
        })
        const keys = anahtarlar(state.displayedTokens)
        expect(keys).toContain(balanceKey(1, USDT))
        expect(keys).not.toContain(balanceKey(1, TSLA.address))
        expect(html).not.toContain('TSLAx')
    })

    it('Review Focus 5: AYNI adres xStock OLMAYAN zincirde (Polygon) engellenmez', async () => {
        const { state } = await mountPicker(SwapFrom, 'swapFrom', {
            chain: POLYGON,
            imported: { 137: [storedRow(TSLA)] },
        })
        expect(anahtarlar(state.displayedTokens)).toContain(balanceKey(137, TSLA.address))
    })

    it('bStock genel Takas listesinde KALIR', async () => {
        const { state } = await mountPicker(SwapFrom, 'swapFrom', {
            chain: BSC,
            imported: { 56: [storedRow(CRCLB)] },
        })
        expect(anahtarlar(state.displayedTokens)).toContain(balanceKey(56, CRCLB.address))
    })
})

describe('swapTo - Alinan listesi', () => {
    it('xStock hem "Tokenlarim" (imported) hem "Tum tokenlar" (sunucu) listesinde GORUNMEZ', async () => {
        const { state, html } = await mountPicker(SwapTo, 'swapTo', {
            chain: ETH,
            imported: { 1: [USDT_ROW, storedRow(TSLA)] },
            serverTokens: [serverRow(TSLA, 1, 'ethereum'), serverRow(USDC_FIELDS, 1, 'ethereum')],
        })
        expect(state.importedTokens.map((t) => t.symbol)).toEqual(['USDT'])
        expect(state.displayedTokens.map((t) => t.symbol)).toEqual(['USDC'])
        expect(html).not.toContain('TSLAx')
    })

    it('Review Focus 5: AYNI adres xStock OLMAYAN zincirde (Polygon) engellenmez', async () => {
        const { state } = await mountPicker(SwapTo, 'swapTo', {
            chain: POLYGON,
            imported: { 137: [storedRow(TSLA)] },
        })
        expect(state.importedTokens.map((t) => t.symbol)).toEqual(['TSLAx'])
    })
})

describe('bridgeFrom - Kaynak listesi', () => {
    it('xStock ve bStock KAYNAK listesinde GORUNMEZ; siradan token kalir', async () => {
        const { state } = await mountPicker(BridgeFrom, 'bridgeFrom', {
            chain: ETH,
            imported: { 1: [USDT_ROW, storedRow(TSLA)], 56: [storedRow(CRCLB)] },
            liFiTokens: {
                1: [
                    { address: TSLA.address, symbol: 'TSLAx', name: 'Tesla xStock', decimals: 18 },
                    { address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
                ],
                56: [{ address: CRCLB.address, symbol: 'CRCLB', name: 'Circle', decimals: 18 }],
            },
        })
        const keys = anahtarlar(state.mergedTokens)
        expect(keys).toContain(balanceKey(1, USDT))
        expect(keys).toContain(balanceKey(1, USDC))
        expect(keys).not.toContain(balanceKey(1, TSLA.address))
        expect(keys).not.toContain(balanceKey(56, CRCLB.address))
    })
})

describe('bridgeTo - Hedef listesi', () => {
    const liFi = {
        1: [
            { address: TSLA.address, symbol: 'TSLAx', name: 'Tesla xStock', decimals: 18 },
            { address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
        ],
        56: [{ address: CRCLB.address, symbol: 'CRCLB', name: 'Circle', decimals: 18 }],
        137: [{ address: TSLA.address, symbol: 'TSLAx', name: 'Baska bir token', decimals: 18 }],
    }

    it('Review Focus 5: xStock HEDEF listesinde GORUNMEZ (LI.FI listesinden gelse bile)', async () => {
        const { state } = await mountPicker(BridgeTo, 'bridgeTo', {
            chain: BSC, liFiTokens: liFi, prepare: () => { cryptoStore().bridge.toChain = ETH },
        })
        const simgeler = state.mergedTokens.map((t) => t.symbol)
        expect(simgeler).toContain('USDC')
        expect(simgeler).not.toContain('TSLAx')
    })

    it('bStock hedef olarak ACIK kalir (Bridge.vue 2026-10-02 karari)', async () => {
        const { state } = await mountPicker(BridgeTo, 'bridgeTo', {
            chain: ETH, liFiTokens: liFi, prepare: () => { cryptoStore().bridge.toChain = BSC },
        })
        expect(state.mergedTokens.map((t) => t.symbol)).toContain('CRCLB')
    })

    it('Review Focus 5: AYNI adres xStock OLMAYAN zincirde (Polygon) hedef olarak engellenmez', async () => {
        const { state } = await mountPicker(BridgeTo, 'bridgeTo', {
            chain: ETH, liFiTokens: liFi, prepare: () => { cryptoStore().bridge.toChain = POLYGON },
        })
        expect(state.mergedTokens.map((t) => t.symbol)).toContain('TSLAx')
    })
})

// Kaynak kilidi: SSR cikti verisini olcer, kapinin cagrildigi YERI degil. Suzgec silinirse YA DA
// motor kapisina (Task 5) guvenilip kaldirilirsa buradaki iddia kirmizi yanar.
const here = dirname(fileURLToPath(import.meta.url))
const kod = (rel) => yorumsuz(readFileSync(join(here, rel), 'utf8'))

describe('seciciler kapiyi CAGIRIR (kaynak kilidi)', () => {
    it('swapFrom TOKENIN KENDI chainId si, swapTo AKTIF AG ile isGeneralSwapExcluded cagirir', () => {
        expect(kod('swap/swapFrom.vue')).toMatch(/isGeneralSwapExcluded\(token\.chainId, token\.address\)/)
        expect(kod('swap/swapTo.vue')).toMatch(/isGeneralSwapExcluded\(network\.currentNetwork\?\.chainId, token\.address\)/)
    })

    it('bridgeFrom isBridgeBlocked (iki ihracci), bridgeTo isBridgeTargetBlocked (yalniz xStocks) cagirir', () => {
        const from = kod('bridge/bridgeFrom.vue')
        expect(from).toMatch(/isBridgeBlocked\(token\.chainId, token\.address\)/)
        expect(from).not.toMatch(/\bisBStock\b/)
        expect(kod('bridge/bridgeTo.vue')).toMatch(/isBridgeTargetBlocked\(crypto\.bridge\.toChain\?\.chainId, token\.address\)/)
    })
})

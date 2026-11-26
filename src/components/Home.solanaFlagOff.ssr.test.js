// Home.vue (SSR) - Solana ozellik bayragi KAPALI (SOLANA_ENABLED false; Global Constraint 20, Review Focus 5, V19-1):
// Solana yoklamasi HIC calismaz. Hesapta hazir `solanaAddress` olsa bile useSolanaAssets (Solana RPC) cagrilmaz,
// SOLANA_GET_ADDRESS gonderilmez ve Solana'ya ozgu SPL hata bandi bayrak kapali kullaniciya cikmaz.
// Kontrol vakasi: bayrak ACIKken ayni kurulumda useSolanaAssets cagrilir ve bant cikar (kapi dogru yonde calisir).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// SOLANA_ENABLED bilesende ISLEM ANINDA okunur; bayrak-kapali vaka bu sahte ile uretilir (varsayilan ACIK).
const flags = vi.hoisted(() => ({ solana: true }))
vi.mock('../utils/featureFlags', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, get SOLANA_ENABLED() { return flags.solana } }
})

const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: async () => true }))

vi.mock('axios', () => ({
    default: {
        post: async () => ({ status: 200, data: { tokens: [] } }),
        get: async () => ({ status: 200, data: { news: [] } }),
    },
}))

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} } }
})

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { tokenScopeStore } from '../store/tokenScope'
import Home from './Home.vue'
import supported_chains from '../data/supported_chains.json'

const ETH = supported_chains.find((c) => c.chainId === 1)
const SOLANA_ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

const SOL_ROW = {
    chainId: 'solana-mainnet', address: 'native', symbol: 'SOL', name: 'Solana',
    decimals: 9, amount: 3, logoURI: null,
    image: { thumb: '', small: '', large: '' }, coingecko_id: 'solana',
}
const failedRows = () => {
    const out = [SOL_ROW]
    Object.defineProperty(out, 'splFailed', { value: true, enumerable: false })
    return out
}

beforeEach(() => {
    flags.solana = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    useSolanaAssetsMock.mockResolvedValue(failedRows())
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    useSolanaAssetsMock.mockReset()
    delete globalThis.chrome
})

const solanaSatirlari = (captured) => (captured.instance.setupState.currentTokens || [])
    .filter((t) => String(t.chainId) === 'solana-mainnet')
    .map((t) => `${t.chainId}|${t.address}`)

async function mountHome({ solanaAddress, sendMessage }) {
    const stub = installChromeStub({
        currentNetwork: ETH,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', solanaAddress, key: 'acc1' },
        imported_tokens: { acc1: {} },
        vaults: [],
    })
    if (sendMessage) stub.setSendMessage(sendMessage)
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    const network = networkStore()
    network.currentNetwork = ETH
    network.rpc = 'https://evm.example/rpc'
    tokenScopeStore().filter = 'all'
    const captured = captureInstance(app, 'Home')
    const html = await render(app)
    return { captured, html }
}

describe('Home -- Solana ozellik bayragi KAPALI (V19-1)', () => {
    it('hesapta hazir solanaAddress VARKEN useSolanaAssets cagrilmaz, bant cikmaz', async () => {
        flags.solana = false
        const sendSpy = vi.fn(async () => ({ result: { address: SOLANA_ADDRESS } }))
        const { captured, html } = await mountHome({ solanaAddress: SOLANA_ADDRESS, sendMessage: sendSpy })

        expect(useSolanaAssetsMock).not.toHaveBeenCalled()
        expect(html).not.toContain('data-spl-error-band')
        expect(captured.instance.setupState.solanaSplFailed).toBe(false)
    })

    // Birlesme hazirligi B5 -- MAGAZA SIZINTISI vakasi birebir: bayrak KAPALI + hesapta solanaAddress DOLU (TON ifadesiyle
    // ice aktarilmis hesap, hybridTonAccount.js) + kapsam 'Tum Aglar'. Solana kaynagi cagrilmaz, adres sorulmaz, /solana/*
    // istegi cikmaz ve Solana satiri listeye girmez.
    it("SIZINTI: bayrak KAPALI + solanaAddress DOLU + 'Tum Aglar': Solana kaynagi/adres sorgusu/istek YOK, Solana satiri listede YOK", async () => {
        flags.solana = false
        const fetchSpy = vi.fn(async () => ({ ok: false, status: 599, json: async () => ({}) }))
        vi.stubGlobal('fetch', fetchSpy)
        const sendSpy = vi.fn(async () => ({ result: { address: SOLANA_ADDRESS } }))
        const { captured } = await mountHome({ solanaAddress: SOLANA_ADDRESS, sendMessage: sendSpy })

        expect(tokenScopeStore().filter).toBe('all')
        expect(useSolanaAssetsMock).not.toHaveBeenCalled()
        expect(sendSpy).not.toHaveBeenCalledWith({ type: 'SOLANA_GET_ADDRESS' })
        expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes('/solana/'))).toEqual([])
        expect(solanaSatirlari(captured)).toEqual([])
        expect(captured.instance.setupState.solanaInScope).toBe(false)
    })

    it('hesapta hazir adres YOK: SOLANA_GET_ADDRESS gonderilmez, useSolanaAssets cagrilmaz', async () => {
        flags.solana = false
        const sendSpy = vi.fn(async () => ({ result: { address: SOLANA_ADDRESS } }))
        await mountHome({ solanaAddress: undefined, sendMessage: sendSpy })

        expect(sendSpy).not.toHaveBeenCalledWith({ type: 'SOLANA_GET_ADDRESS' })
        expect(useSolanaAssetsMock).not.toHaveBeenCalled()
    })

    it('KONTROL: bayrak ACIK + ayni kurulum: useSolanaAssets cagrilir, splFailed bandi cikar ve Solana satiri listeye girer', async () => {
        const sendSpy = vi.fn(async () => ({ result: { address: SOLANA_ADDRESS } }))
        const { captured, html } = await mountHome({ solanaAddress: SOLANA_ADDRESS, sendMessage: sendSpy })

        expect(useSolanaAssetsMock).toHaveBeenCalledWith(SOLANA_ADDRESS)
        expect(html).toContain('data-spl-error-band')
        // Sizinti testindeki "Solana satiri YOK" iddiasinin okuyucusu gercek satiri gorebiliyor (iddiasiz degil).
        expect(solanaSatirlari(captured)).toEqual(['solana-mainnet|native'])
    })
})

// Gorev 19 (E3 istemci arayuzu): SPL bakiye okumasi BASARISIZ olunca Home ve SelectAssets
// kucuk bir hata bandi + yeniden dene dugmesi gosterir.
//
// KOK NEDEN: Gorev 15'ten once SPL hatasi sessizce bos liste donuyordu -- kullanici "SPL tokenim
// yok" sanir, portfoy toplami EKSIK kalirdi. `useSolanaAssets` artik dizinin NUMARALANDIRILAMAZ
// `splFailed` ozelligini tasir (yeni export YOK). Bu dosya o isareti arayuze baglar.
//
// KILITLER:
//  - splFailed:true -> bant + dugme; false / tanimsiz (duz dizi, ~20 SSR testinin mock'u) -> bant YOK.
//  - dugme useSolanaAssets'i TEKRAR cagirir.
//  - `home.solana.splLoadError` 12 dilde bos degil, metne adres/mint gomulu degil (K17).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))

const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

const applyNetworkChangeMock = vi.fn(async () => true)
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: (...args) => applyNetworkChangeMock(...args) }))

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

// Home -> Header -> dappFunctions zinciri import aninda chrome.windows ister (bkz. Home.allNetworks.ssr.test.js).
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
import SelectAssets from './SelectAssets.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH = supported_chains.find((c) => c.chainId === 1)
const SOLANA_ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

const SOL_ROW = {
    chainId: 'solana-mainnet', address: 'native', symbol: 'SOL', name: 'Solana',
    decimals: 9, amount: 3, logoURI: null,
    image: { thumb: '', small: '', large: '' }, coingecko_id: 'solana',
}

/** useSolanaAssets'in gercek cikti sekli: satir dizisi + numaralandirilamaz splFailed (bkz. useSolanaAssets.js). */
const rowsWith = (rows, splFailed, solFailed) => {
    const out = [...rows]
    if (splFailed !== undefined) Object.defineProperty(out, 'splFailed', { value: splFailed, enumerable: false })
    if (solFailed !== undefined) Object.defineProperty(out, 'solFailed', { value: solFailed, enumerable: false })
    return out
}

const BAND = 'data-spl-error-band'
const RETRY = 'data-spl-retry'

beforeEach(() => {
    // Home'un SSR'daki bilinen gurultusu (kasa kilitli -> TON adresi turetilemez, varsayilan token yaniti bos): bu dosyanin konusu degil.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    useTokenBalanceMock.mockImplementation(async () => 0)
    axiosPostMock.mockResolvedValue({ status: 200, data: { tokens: [] } })
    useSolanaAssetsMock.mockResolvedValue(rowsWith([SOL_ROW], false))
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    useSolanaAssetsMock.mockReset()
    useTokenBalanceMock.mockReset()
    axiosPostMock.mockReset()
    applyNetworkChangeMock.mockClear()
    delete globalThis.chrome
})

const account = () => ({
    address: '0xAbCdEf0000000000000000000000000000000001',
    solanaAddress: SOLANA_ADDRESS,
    key: 'acc1',
})

async function mountSelectAssets() {
    installChromeStub({ currentNetwork: SOLANA, active_account: account(), imported_tokens: { acc1: {} } })
    const app = createApp(SelectAssets)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = SOLANA
    const captured = captureInstance(app, 'SelectAssets')
    const html = await render(app)
    return { captured, html }
}

async function mountHome() {
    installChromeStub({
        currentNetwork: ETH,
        active_account: account(),
        imported_tokens: { acc1: {} },
        vaults: [],
    })
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

const EN_TEXT = 'Token balances could not be loaded; the total may be incomplete.'

describe.each([
    ['SelectAssets', mountSelectAssets],
    ['Home', mountHome],
])('%s -- SPL hata bandi', (_name, mount) => {
    it('splFailed:true -> bant, metin ve yeniden dene dugmesi gorunur', async () => {
        useSolanaAssetsMock.mockResolvedValue(rowsWith([SOL_ROW], true))
        const { html } = await mount()

        expect(html).toContain(BAND)
        expect(html).toContain(RETRY)
        expect(html).toContain(EN_TEXT)
        expect(html).toContain('Try again')
        // Bant adres/mint tasimaz (K17: ceviri dizelerine adres gomulmez).
        expect(html).not.toContain(SOLANA_ADDRESS + ' ' + EN_TEXT)
    })

    // final cuzdan-istemci-1: native SOL okumasi (getBalance) dustu, SPL tarafi saglam => SOL satiri sessizce
    // kayboluyordu ve bant yoktu. solFailed da bandi acar.
    it('solFailed:true (splFailed false) -> bant, metin ve yeniden dene dugmesi gorunur', async () => {
        useSolanaAssetsMock.mockResolvedValue(rowsWith([], false, true))
        const { html } = await mount()

        expect(html).toContain(BAND)
        expect(html).toContain(RETRY)
        expect(html).toContain(EN_TEXT)
    })

    it('solFailed:false ve splFailed:false -> bant YOK', async () => {
        useSolanaAssetsMock.mockResolvedValue(rowsWith([SOL_ROW], false, false))
        const { html } = await mount()

        expect(html).not.toContain(BAND)
    })

    it('yeniden dene basari olunca solFailed bandi da kalkar', async () => {
        useSolanaAssetsMock.mockResolvedValue(rowsWith([], false, true))
        const { captured, html } = await mount()
        expect(html).toContain(BAND)

        useSolanaAssetsMock.mockResolvedValue(rowsWith([SOL_ROW], false, false))
        await captured.instance.setupState.retrySolanaAssets()

        expect(captured.instance.setupState.solanaSplFailed).toBe(false)
    })

    it('splFailed:false -> bant YOK', async () => {
        useSolanaAssetsMock.mockResolvedValue(rowsWith([SOL_ROW], false))
        const { html } = await mount()

        expect(html).not.toContain(BAND)
        expect(html).not.toContain(RETRY)
        expect(html).not.toContain(EN_TEXT)
    })

    it('duz dizi (splFailed tanimsiz; ~20 SSR testinin mock sekli) -> bant YOK, kirilmaz', async () => {
        useSolanaAssetsMock.mockResolvedValue([SOL_ROW])
        const { html } = await mount()

        expect(html).not.toContain(BAND)
    })

    it('yeniden dene useSolanaAssets i TEKRAR cagirir ve basari olunca bant kalkar', async () => {
        useSolanaAssetsMock.mockResolvedValue(rowsWith([SOL_ROW], true))
        const { captured, html } = await mount()
        expect(html).toContain(BAND)

        const callsBefore = useSolanaAssetsMock.mock.calls.length
        expect(callsBefore).toBeGreaterThan(0)

        useSolanaAssetsMock.mockResolvedValue(rowsWith([SOL_ROW], false))
        await captured.instance.setupState.retrySolanaAssets()

        expect(useSolanaAssetsMock.mock.calls.length).toBeGreaterThan(callsBefore)
        expect(captured.instance.setupState.solanaSplFailed).toBe(false)
    })
})

// final cuzdan-istemci-1 / cuzdan-istemci-D2: Home bandi KAPSAMA bagli. solanaSplFailed yalniz updateBalance sonunda
// yazilir ve scope.filter'i izleyen bir watch yoktur; kullanici "Tum Aglar"dan EVM'ye gecince bant bir yoklama
// boyunca BAYAT kaliyordu. SSR tek cizimdir: bayat durum, bilesenin kendi veri cekmesi baslamadan ONCE enjekte edilir
// ve `network.rpc` bos tutulur (updateBalance erken doner, bayrak yeniden yazilmaz) -- yani bantin kapsamsiz
// `v-if`i tam olarak bayat degerle cizilir.
describe('Home -- bant kapsama bagli (cuzdan-istemci-D2)', () => {
    async function mountHomeStale(filter) {
        installChromeStub({ currentNetwork: ETH, active_account: account(), imported_tokens: { acc1: {} }, vaults: [] })
        const app = createApp(Home, { props: { embedded: false } })
        app.use(createTestPinia())
        app.use(createTestI18n('en'))
        const network = networkStore()
        network.currentNetwork = ETH
        network.rpc = null
        tokenScopeStore().filter = filter
        captureInstance(app, 'Home', (instance) => {
            instance.setupState.solanaSplFailed = true
        })
        return render(app)
    }

    it('kapsam EVM (zincir 1) iken bayat solanaSplFailed bandi CIZMEZ', async () => {
        const html = await mountHomeStale(1)
        expect(html).not.toContain(BAND)
        expect(html).not.toContain(RETRY)
    })

    it('KONTROL: kapsam "Tum Aglar" iken ayni durumda bant gorunur', async () => {
        const html = await mountHomeStale('all')
        expect(html).toContain(BAND)
    })

    it('KONTROL: kapsam Solana iken bant gorunur', async () => {
        const html = await mountHomeStale('solana-mainnet')
        expect(html).toContain(BAND)
    })
})

describe('home.solana.splLoadError -- 12 dil', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const dir = join(here, '..', 'i18n', 'locales')
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    const EXPECTED = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'vi', 'zh-CN']

    it('12 dil dosyasi var', () => {
        expect(files.map((f) => f.replace('.json', '')).sort()).toEqual([...EXPECTED].sort())
    })

    it.each(EXPECTED)('%s: anahtar dolu, adres/yer tutucu icermez', (lang) => {
        const json = JSON.parse(readFileSync(join(dir, `${lang}.json`), 'utf8'))
        const text = json?.home?.solana?.splLoadError
        expect(typeof text).toBe('string')
        expect(text.trim().length).toBeGreaterThan(10)
        expect(text).not.toMatch(/\{[^}]*\}/)
        // yeniden dene metni mevcut ortak anahtardan gelir
        expect(json?.history?.list?.retry?.trim().length).toBeGreaterThan(0)
    })

    it('en metni plandaki anlamdadir', () => {
        const json = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8'))
        expect(json.home.solana.splLoadError).toBe(EN_TEXT)
    })
})

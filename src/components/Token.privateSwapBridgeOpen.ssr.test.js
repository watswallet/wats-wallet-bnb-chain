// Token.vue (SSR) -- VITE_PRIVATE_SWAP_BRIDGE ACIK iken gizli modda SilentSwap Takas/Kopru dugmeleri (data-testid private-swap / private-bridge).
// Kimlik (zincir, ADRES) ile belirlenir (privateSourceAssetOf), sembolle DEGIL: sahte "USDC" ve Polygon USDC.e dugme almaz, kucuk harfli katalog
// satiri kayit defteri adresinde dugme alir. Gorunurluk sabit uygunluk kuralidir (selfSwapTargets / selfBridgeTargets, FUND listesi): BSC'de Takas YOK.
// KLASIK Takas/Kopru dugmeleri gizli modda bayrak ACIKKEN de YOK (swapBridgeShown = !privacy.active); normal modda durur (KONTROL).
// Bayrak derleme sabitidir: vitest.config.js varsayilani 'true' verir AMA bu dosya ona GUVENMEZ; asagida modullerden ONCE acikca yazilir ve
// ilk test bunu olcer. Bayrak-kapali karsiti: Token.privateSwapBridgeClosed.ssr.test.js (o dosyaya bayrak-acik vaka EKLENMEZ).
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.hoisted(() => { process.env.VITE_PRIVATE_SWAP_BRIDGE = 'true' })

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
const axiosPostMock = vi.fn()
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))
// Aktif agi degistiren tek govde (applyNetworkChange) izlenir: Gizli Takas/Kopru dugmeleri ASLA ag degistirmez ("ensureChain YOK"), klasik Takas degistirir (KONTROL).
const applyNetworkChangeMock = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: (...args) => applyNetworkChangeMock(...args) }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 2 }))
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} },
        Contract: class { async decimals() { return 18n } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { butonlar, yorumsuzHtml } from '../test-utils/ssrHtmlYardimcilari.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import { popupStore } from '../store/popup'
import { privacyStore } from '../store/privacy'
import { PRIVATE_SWAP_BRIDGE } from '../utils/featureFlags'
import Token from './Token.vue'
import supported_chains from '../data/supported_chains.json'

const ME = '0xCcccCccc00000000000000000000000000000003'
// SilentSwap kayit defteri adresleri (@silentswap/sdk getAssetOnChain ile olculdu).
const BSC_USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
const ETH_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
const POLYGON_USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'
const SAHTE = '0x1212121212121212121212121212121212121212'

afterEach(() => { axiosPostMock.mockReset(); applyNetworkChangeMock.mockClear(); vi.unstubAllEnvs(); delete globalThis.chrome })

const zincir = (id) => supported_chains.find((c) => c.chainId === id)

const apiKaydi = () => ({
    name: 'USD Coin', symbol: 'usdc', coingecko_id: 'usd-coin',
    image: { thumb: 'https://cdn.example/usdc.png', large: 'https://cdn.example/usdc.png' }, address: '0x0',
    market_data: { priceUSD: 1.5, market_cap: 1000, volume: 500, circulating_supply: 1000, ath: 1.1, atl: 0.9, change: { h24: 0.1 }, sparkline: { d7: [] } },
})

// Gizli modda kayit SATIRDAN kurulur (loadTokenRecord -> rowTokenRecord): kimlik selected_token_ref'ten gelir, apiKaydi'ndan DEGIL.
// aktifAg: satirin zincirinden FARKLI olabilir (capraz zincir portfoy); kapi aktif aga degil satirin zincirine bakmalidir.
async function mountToken({ gizli = true, chainId, address, symbol, aktifAg = chainId }) {
    const aktif = zincir(aktifAg)
    axiosPostMock.mockResolvedValue({ status: 200, data: { token: apiKaydi() } })
    installChromeStub({ currentNetwork: aktif, active_account: { address: ME } })
    const app = createApp(Token, { props: { id: 'usd-coin' } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = aktif
    networkStore().rpc = aktif.rpc[0].url
    cryptoStore().selected_token_ref = { id: 'usd-coin', chainId, address, decimals: 18, symbol }
    cryptoStore().selected_token_id = 'usd-coin'
    privacyStore().active = gizli
    popupStore().token_data = true
    const yakalanan = captureInstance(app, 'Token')
    const html = await render(app)
    return { html, s: yakalanan.instance.setupState }
}

const ozel = (html, ad) => butonlar(html).filter((b) => b.nitelikler.includes(`data-testid="private-${ad}"`))
const klasik = (html, etiket) => butonlar(html).filter((b) => b.metin === etiket && !b.nitelikler.includes('data-testid="private-'))
// Olumsuz iddialarin olumlu kontrolu: sayfa gercekten cizildi (token.yourBalance kosulsuz basilir), yoksa "yok" iddialari bos gecerdi.
function hicDugmeYok(html) {
    expect(yorumsuzHtml(html)).toContain('Your Balance')
    expect(ozel(html, 'swap')).toHaveLength(0)
    expect(ozel(html, 'bridge')).toHaveLength(0)
    expect(klasik(html, 'Swap')).toHaveLength(0)
    expect(klasik(html, 'Bridge')).toHaveLength(0)
}

describe('Token.vue (SSR) -- PRIVATE_SWAP_BRIDGE acik: gizli mod SilentSwap Takas/Kopru dugmeleri', () => {
    it('ortam: bayrak bu dosyada gercekten acik', () => {
        expect(PRIVATE_SWAP_BRIDGE).toBe(true)
    })

    it('Ethereum USDC satiri (kayit defteri adresi): Takas ve Kopru ozel dugmeleri VAR, klasik dugme YOK', async () => {
        const { html, s } = await mountToken({ chainId: 1, address: ETH_USDC, symbol: 'USDC' })
        expect(ozel(html, 'swap')).toHaveLength(1)
        expect(ozel(html, 'swap')[0].metin).toBe('Swap')
        expect(ozel(html, 'bridge')).toHaveLength(1)
        expect(ozel(html, 'bridge')[0].metin).toBe('Bridge')
        expect(klasik(html, 'Swap')).toHaveLength(0)
        expect(klasik(html, 'Bridge')).toHaveLength(0)
        expect(s.privateSourceAsset).toBe('USDC')
        expect(s.privateSwapShown).toBe(true)
        expect(s.privateBridgeShown).toBe(true)
    })

    it('selectPrivateSwap(): privateSwapSource {chainId: 1, asset: "USDC"} yazar, token penceresini kapatir, private_swap a gider', async () => {
        const { s } = await mountToken({ chainId: 1, address: ETH_USDC, symbol: 'USDC' })
        // Olumlu kontrol: cagrilmadan once hicbir sey yazili degil.
        expect(pageStore().privateSwapSource).toBeNull()
        expect(pageStore().currentPage).not.toBe('private_swap')
        expect(popupStore().token_data).toBe(true)

        s.selectPrivateSwap()

        expect(pageStore().privateSwapSource).toEqual({ chainId: 1, asset: 'USDC' })
        expect(pageStore().currentPage).toBe('private_swap')
        expect(popupStore().token_data).toBe(false)
    })

    it('selectPrivateBridge(): privateSwapSource {chainId: 1, asset: "USDC"} yazar, token penceresini kapatir, private_bridge e gider', async () => {
        const { s } = await mountToken({ chainId: 1, address: ETH_USDC, symbol: 'USDC' })
        expect(pageStore().privateSwapSource).toBeNull()

        s.selectPrivateBridge()

        expect(pageStore().privateSwapSource).toEqual({ chainId: 1, asset: 'USDC' })
        expect(pageStore().currentPage).toBe('private_bridge')
        expect(popupStore().token_data).toBe(false)
    })

    it('BSC USDC satiri (kayit defteri adresi): yalniz Kopru VAR, Takas YOK (BSC de Takas yok); selectPrivateBridge() {56, "USDC"} yazar', async () => {
        const { html, s } = await mountToken({ chainId: 56, address: BSC_USDC, symbol: 'USDC' })
        expect(ozel(html, 'bridge')).toHaveLength(1)
        expect(ozel(html, 'swap')).toHaveLength(0)
        expect(klasik(html, 'Swap')).toHaveLength(0)
        expect(klasik(html, 'Bridge')).toHaveLength(0)
        // Kimlik cozuldu, Takas'i gizleyen sey UYGUNLUK (BSC'de hedef yok), kimlik degil.
        expect(s.privateSourceAsset).toBe('USDC')
        expect(s.privateSwapShown).toBe(false)
        expect(s.privateBridgeShown).toBe(true)

        s.selectPrivateBridge()
        expect(pageStore().privateSwapSource).toEqual({ chainId: 56, asset: 'USDC' })
        expect(pageStore().currentPage).toBe('private_bridge')
    })

    it('Polygon USDC satiri (kayit defteri adresi): Takas ve Kopru VAR (Takas hedefi USDT)', async () => {
        const { html, s } = await mountToken({ chainId: 137, address: POLYGON_USDC, symbol: 'USDC' })
        expect(ozel(html, 'swap')).toHaveLength(1)
        expect(ozel(html, 'bridge')).toHaveLength(1)
        s.selectPrivateSwap()
        expect(pageStore().privateSwapSource).toEqual({ chainId: 137, asset: 'USDC' })
    })

    it('sahte USDC (BSC, 0x1212...): hicbir dugme YOK; iki handler da NO-OP', async () => {
        const { html, s } = await mountToken({ chainId: 56, address: SAHTE, symbol: 'USDC' })
        hicDugmeYok(html)
        expect(s.privateSourceAsset).toBeNull()

        const onceki = pageStore().currentPage
        s.selectPrivateSwap()
        s.selectPrivateBridge()
        expect(pageStore().privateSwapSource).toBeNull()
        expect(pageStore().currentPage).toBe(onceki)
        expect(popupStore().token_data).toBe(true)
    })

    it('Polygon USDC.e (0x2791..., etiketi USDC): hicbir dugme YOK', async () => {
        const { html, s } = await mountToken({ chainId: 137, address: POLYGON_USDC_E, symbol: 'USDC' })
        hicDugmeYok(html)
        expect(s.privateSourceAsset).toBeNull()
    })

    it('kucuk harfli katalog satiri ("usdc", kayit defteri adresi kucuk harf): dugmeler VAR, on secime kayit defteri sembolu "USDC" yazilir', async () => {
        const { html, s } = await mountToken({ chainId: 1, address: ETH_USDC.toLowerCase(), symbol: 'usdc' })
        expect(ozel(html, 'swap')).toHaveLength(1)
        expect(ozel(html, 'bridge')).toHaveLength(1)
        s.selectPrivateSwap()
        expect(pageStore().privateSwapSource).toEqual({ chainId: 1, asset: 'USDC' })
        expect(pageStore().privateSwapSource.asset).not.toBe('usdc')
    })

    it('sembolsuz satir kayit defteri adresinde: dugmeler VAR', async () => {
        const { html } = await mountToken({ chainId: 1, address: ETH_USDC, symbol: undefined })
        expect(ozel(html, 'swap')).toHaveLength(1)
        expect(ozel(html, 'bridge')).toHaveLength(1)
    })

    it('yerel coin satiri (adres 0x0) Base da: Takas ve Kopru VAR, on secim asset "ETH"', async () => {
        const { html, s } = await mountToken({ chainId: 8453, address: '0x0', symbol: 'ETH' })
        expect(ozel(html, 'swap')).toHaveLength(1)
        expect(ozel(html, 'bridge')).toHaveLength(1)
        s.selectPrivateSwap()
        expect(pageStore().privateSwapSource).toEqual({ chainId: 8453, asset: 'ETH' })
    })

    it('Base da sifir olmayan adreste "ETH" etiketli ERC-20: hicbir dugme YOK', async () => {
        const { html, s } = await mountToken({ chainId: 8453, address: SAHTE, symbol: 'ETH' })
        hicDugmeYok(html)
        expect(s.privateSourceAsset).toBeNull()
    })

    it('adresi olmayan satir: hicbir dugme YOK (kimlik cozulemez)', async () => {
        const { html, s } = await mountToken({ chainId: 1, address: undefined, symbol: 'USDC' })
        hicDugmeYok(html)
        expect(s.privateSourceAsset).toBeNull()
    })

    it('aktif ag Ethereum degilken Ethereum USDC satiri: dugmeler satirin zincirine gore VAR, on secim chainId 1', async () => {
        const { html, s } = await mountToken({ chainId: 1, address: ETH_USDC, symbol: 'USDC', aktifAg: 56 })
        expect(ozel(html, 'swap')).toHaveLength(1)
        expect(ozel(html, 'bridge')).toHaveLength(1)
        s.selectPrivateSwap()
        expect(pageStore().privateSwapSource).toEqual({ chainId: 1, asset: 'USDC' })
        expect(pageStore().currentPage).toBe('private_swap')
        s.selectPrivateBridge()
        // Isleyiciler senkron; yine de bekleyen bir ag gecisi (ensureChain dizilimi) varsa kosulsun diye mikro-gorev ve zamanlayici bosaltilir.
        await new Promise((r) => setTimeout(r, 0))
        // "ensureChain YOK" sozlesmesi: Gizli Takas/Kopru dugmeleri aktif agi (56) DEGISTIRMEZ; ekran SilentSwap ile Gizli Hesap'tan calisir.
        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(networkStore().currentNetwork.chainId).toBe(56)
        expect(pageStore().currentPage).toBe('private_bridge')
    })

    it('KONTROL: normal modda ayni kurulumda (aktif ag 56, Ethereum USDC satiri) klasik Takas applyNetworkChange i CAGIRIR', async () => {
        const { s } = await mountToken({ gizli: false, chainId: 1, address: ETH_USDC, symbol: 'USDC', aktifAg: 56 })
        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        await s.selectSwap()
        expect(applyNetworkChangeMock).toHaveBeenCalledTimes(1)
    })

    it('FUND listesi bos (VITE_PRIVATE_FUND_CHAINS=""): kaynak satiri olsa da hicbir dugme YOK (uygunluk kurali)', async () => {
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '')
        const { html, s } = await mountToken({ chainId: 1, address: ETH_USDC, symbol: 'USDC' })
        hicDugmeYok(html)
        // Kimlik hala cozuluyor; dugmeleri gizleyen sey hedef yoklugu. Olumlu karsit: yukaridaki Ethereum USDC testi.
        expect(s.privateSourceAsset).toBe('USDC')
        expect(s.privateSwapShown).toBe(false)
        expect(s.privateBridgeShown).toBe(false)
    })

    it('gizli mod, kaynak olmayan token (BSC yerel BNB): klasik Takas/Kopru da YOK (bayrak acikken bile); zincir akisi tablosu yine izin verir', async () => {
        const { html, s } = await mountToken({ chainId: 56, address: '0x0', symbol: 'BNB' })
        // canSwap / canBridge BSC icin true: klasik dugmeleri gizleyen sey swapBridgeShown (= !privacy.active), akis tablosu degil.
        expect(s.canSwap).toBe(true)
        expect(s.canBridge).toBe(true)
        hicDugmeYok(html)
        expect(s.privateSourceAsset).toBeNull()
    })

    it('KONTROL: normal modda ayni Ethereum USDC satirinda klasik Takas ve Kopru dugmeleri durur, ozel dugme YOK', async () => {
        const { html } = await mountToken({ gizli: false, chainId: 1, address: ETH_USDC, symbol: 'USDC' })
        expect(klasik(html, 'Swap')).toHaveLength(1)
        expect(klasik(html, 'Bridge')).toHaveLength(1)
        expect(ozel(html, 'swap')).toHaveLength(0)
        expect(ozel(html, 'bridge')).toHaveLength(0)
    })
})

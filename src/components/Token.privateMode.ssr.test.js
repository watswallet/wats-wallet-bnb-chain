// Token.vue (SSR) -- GIZLI MOD (gizli-mod cok-ag spec 4.7 satir 3, E12): token ayrintisi AG ISTEGI ATMADAN satirdan kurulur.
//   - /getTokenByAddress (kimlik kurtarma) ve /getTokenDataById (kanonik kayit) HIC atilmaz: token kimligi/adresi ve IP
//     ana API'ye gitmez;
//   - kayit rowTokenRecord(secilen satir)'dir; bakiye AYNI kayitla satirin KENDI zincirinden okunur ve gorunur;
//   - fiyat, 24 sa degisimi, grafik, deger (USD) ve piyasa verisi bloklari CIZILMEZ; avatar yerel (data URI).
// Normal modda hepsi eskisi gibi: her iddianin bir KONTROL cifti vardir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosPostMock = vi.fn()
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))

const useTokenBalanceMock = vi.fn(async () => 2)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

// Adresli (native olmayan) satir ERC-20 decimals() okur: sahte saglayici aga cikmaz. `sahte.decimalsHata` acikken
// decimals() RPC dususu gibi reddedilir.
const sahte = vi.hoisted(() => ({ decimalsHata: false }))
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} },
        Contract: class { async decimals() { if (sahte.decimalsHata) throw new Error('rpc down'); return 18n } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { privacyStore } from '../store/privacy'
import Token from './Token.vue'
import supported_chains from '../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const ME = '0xCcccCccc00000000000000000000000000000003'
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'

const apiKaydi = () => ({
    name: 'USD Coin', symbol: 'usdc', coingecko_id: 'usd-coin',
    image: { thumb: 'https://cdn.example/usdc.png', large: 'https://cdn.example/usdc.png' }, address: '0x0',
    market_data: {
        priceUSD: 1.5, market_cap: 1000, volume: 500, circulating_supply: 1000,
        ath: 1.1, atl: 0.9, change: { h24: 0.1 }, sparkline: { d7: [] },
    },
})

afterEach(() => {
    axiosPostMock.mockReset()
    useTokenBalanceMock.mockClear()
    sahte.decimalsHata = false
    delete globalThis.chrome
})

const gorunurMetin = (html) => html.replace(/<[^>]*>/g, ' ')
const imgKaynaklari = (html) => [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1])

/** Satir kimligi `crypto.selected_token_ref` bicimindedir (Home.selectToken). `gizli`: privacyStore().active. */
async function mountToken({ gizli, id = null, address = '0x0', decimals = 18, symbol = 'BNB' }) {
    axiosPostMock.mockResolvedValue({ status: 200, data: { token: apiKaydi() } })
    installChromeStub({ currentNetwork: BSC, active_account: { address: ME } })
    const app = createApp(Token, { props: { id } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = BSC
    networkStore().rpc = BSC.rpc[0].url
    cryptoStore().selected_token_ref = { id, chainId: 56, address, decimals, symbol }
    cryptoStore().selected_token_id = id
    privacyStore().active = gizli
    const captured = captureInstance(app, 'Token')
    const html = await render(app)
    return { html, state: captured.instance.setupState }
}

describe('Token.vue (SSR) -- gizli modda ag istegi YOK (satir 3)', () => {
    it('KONTROL: normal modda kanonik kayit /getTokenDataById ile, grafik /getTokenPriceHistory ile istenir', async () => {
        await mountToken({ gizli: false, id: 'usd-coin', address: USDC_BSC, symbol: 'USDC' })
        const uclar = axiosPostMock.mock.calls.map(([url]) => String(url).split('/').pop()).sort()
        expect(uclar).toEqual(['getTokenDataById', 'getTokenPriceHistory'])
    })

    it('KONTROL: normal modda kimliksiz satir /getTokenByAddress ile kurtarilmaya calisilir', async () => {
        await mountToken({ gizli: false, id: null, address: USDC_BSC, symbol: 'USDC' })
        expect(axiosPostMock.mock.calls.map(([url]) => String(url).split('/').pop())).toContain('getTokenByAddress')
    })

    it('gizli modda (kimlikli satir) HICBIR axios istegi atilmaz', async () => {
        await mountToken({ gizli: true, id: 'usd-coin', address: USDC_BSC, symbol: 'USDC' })
        expect(axiosPostMock).not.toHaveBeenCalled()
    })

    it('gizli modda (kimliksiz satir) adresten kimlik kurtarma da atilmaz', async () => {
        await mountToken({ gizli: true, id: null, address: USDC_BSC, symbol: 'USDC' })
        expect(axiosPostMock).not.toHaveBeenCalled()
    })

    it('gizli modda kayit satirdan kurulur, bakiye satirin kendi zincirinden AYNI kayitla okunur ve gorunur', async () => {
        const { html, state } = await mountToken({ gizli: true, id: null, address: USDC_BSC, symbol: 'USDC' })

        expect(state.displayToken.symbol).toBe('USDC')
        expect(state.displayToken.address).toBe(USDC_BSC)
        expect(state.displayToken.coingecko_id).toBeNull()
        expect(useTokenBalanceMock).toHaveBeenCalledTimes(1)
        expect(useTokenBalanceMock).toHaveBeenCalledWith(ME, USDC_BSC, BSC.rpc[0].url, 56)
        expect(gorunurMetin(html)).toContain('2.000000')
        expect(state.balanceError).toBe(false)
        // ERC-20 decimals() zincirden okunur ve kayda yazilir.
        expect(state.decimals).toBe(18)
    })

    it('gizli modda yerel coin satiri (adres 0x0) da bakiyesini gosterir', async () => {
        const { html, state } = await mountToken({ gizli: true, id: null, address: '0x0', symbol: 'BNB' })

        expect(axiosPostMock).not.toHaveBeenCalled()
        expect(state.displayToken.symbol).toBe('BNB')
        expect(gorunurMetin(html)).toContain('2.000000')
    })

    it('bakiye okumasi dusarse (RPC hatasi) 0 DEGIL tire gosterir ve hicbir ag istegi atilmaz', async () => {
        const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {})
        useTokenBalanceMock.mockRejectedValueOnce(new Error('RPC down'))

        const { html, state } = await mountToken({ gizli: true, id: null, address: USDC_BSC, symbol: 'USDC' })

        expect(state.balanceError).toBe(true)
        expect(gorunurMetin(html)).not.toContain('0.000000')
        expect(gorunurMetin(html)).toContain('—')
        expect(axiosPostMock).not.toHaveBeenCalled()
        uyari.mockRestore()
    })

    // RPC dususunde ERC-20 `decimals()` da reddedilir ve Token.vue'nun yedegi 18'dir. Ozel modda kayit SATIRDAN kuruldu ve
    // satirin KENDI ondaligi var (USDC: 6): 18'e dusmek kaydi 10^12 kat yanlis yapar ve kayit oldugu gibi swap.inToken /
    // sendAsset'e tasinir. Normal modda satir ondaligi yoktur (kanonik kayit), orada yedek 18 degismez.
    it('RPC dusunce satirin kendi ondaligi (6) 18 ile EZILMEZ; bakiye tire', async () => {
        const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {})
        sahte.decimalsHata = true
        useTokenBalanceMock.mockRejectedValueOnce(new Error('RPC down'))

        const { state } = await mountToken({ gizli: true, id: null, address: USDC_BSC, symbol: 'USDC', decimals: 6 })

        expect(state.decimals).toBe(6)
        expect(state.displayToken.decimals).toBe(6)
        expect(state.balanceError).toBe(true)
        expect(axiosPostMock).not.toHaveBeenCalled()
        uyari.mockRestore()
    })

    it('satir kimligi yoksa (selected_token_ref bos) gizli modda da firlatmaz ve istek atmaz', async () => {
        installChromeStub({ currentNetwork: BSC, active_account: { address: ME } })
        const app = createApp(Token, { props: { id: null } })
        app.use(createTestPinia())
        app.use(createTestI18n('en'))
        networkStore().currentNetwork = BSC
        cryptoStore().selected_token_ref = null
        privacyStore().active = true
        const captured = captureInstance(app, 'Token')
        await expect(render(app)).resolves.toBeTypeOf('string')
        expect(axiosPostMock).not.toHaveBeenCalled()
        expect(captured.instance.setupState.token).toBeNull()
    })
})

describe('Token.vue (SSR) -- gizli modda fiyat, grafik ve piyasa verisi cizilmez', () => {
    it('KONTROL: normal modda fiyat, deger, grafik kabugu ve piyasa verisi cizilir', async () => {
        const { html } = await mountToken({ gizli: false, id: 'usd-coin', address: USDC_BSC, symbol: 'USDC' })
        const metin = gorunurMetin(html)
        expect(metin).toContain('$1.50')
        expect(metin).toContain('Market Data')
        expect(metin).toContain('Value')
        // Normal mod logo cozucusu PAKETLI dosyayi once dener (agin USDC'si /usdc.png); sunucu gorseli (cdn.example) onun ardindan, o yuklenemezse gelir.
        expect(imgKaynaklari(html)).toContain('/usdc.png')
    })

    it('gizli modda fiyat, 24 sa, deger, grafik ve piyasa verisi bloklari YOK', async () => {
        const { html } = await mountToken({ gizli: true, id: 'usd-coin', address: USDC_BSC, symbol: 'USDC' })
        const metin = gorunurMetin(html)

        expect(metin).not.toMatch(/\$\s?\d/)
        expect(metin).not.toContain('Market Data')
        expect(metin).not.toContain('Market Cap')
        expect(metin).not.toContain('Chart Loading')
        expect(metin).not.toContain('No price history')
        expect(metin).not.toMatch(/\bValue\b/)
        // Kimlik/ag/bakiye bilgisi KALIR.
        expect(metin).toContain('Your Balance')
        expect(metin).toContain('Token Info')
        expect(metin).toContain('BNB Smart Chain')
    })

    it('gizli modda avatar yerel (data URI): uzak <img> yok', async () => {
        const { html } = await mountToken({ gizli: true, id: 'usd-coin', address: USDC_BSC, symbol: 'USDC' })
        const kaynaklar = imgKaynaklari(html)

        expect(kaynaklar.length).toBeGreaterThan(0)
        expect(kaynaklar.filter((k) => /^(https?:)?\/\//.test(k))).toEqual([])
        expect(html).not.toContain('cdn.example')
    })
})

// Token.vue (SSR) - ozellik bayragi KAPALI (K1): xStock bu ekranda urun yuzeyi olarak DUZ token gibi gorunur;
// rozet / not / Kopru aciklamasi yok, Takas ve Kopru dugmeleri acik. FIYAT ise bayraktan BAGIMSIZ carpana
// bolunur (controller karari C-02/F1, Task 11: balanceOf zaten carpanli, bolmemek bayrak kapaliyken de
// yanlis deger gosterir; uc ekran ayni fiyati gosterir) ve carpan bilinmiyorsa tire. (Takas/Kopru MOTOR
// kapilari bayraktan bagimsiz yine korur: swap.xstockGate.test.js, bridgeXstocks.test.js.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

vi.mock('../utils/featureFlags', async (importOriginal) => ({ ...(await importOriginal()), XSTOCKS_ENABLED: false }))

const axiosPostMock = vi.fn()
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 2 }))

// Carpan testten degistirilir: bilinen (SPYx, spec Ek B.1) ya da bilinmeyen (null).
// `zincir` / `adres`: carpanin AIT oldugu (zincir, adres) cifti; beforeEach'te SPYx'e (Ethereum) ayarlanir.
const carpan = vi.hoisted(() => ({ deger: null, doldur: null, zincir: null, adres: null }))
vi.mock('../utils/stockBalances', async (importOriginal) => ({
    ...(await importOriginal()),
    ensureMultipliersFor: async (...args) => carpan.doldur(...args),
    // FIN-bilesen-2 (Review Focus 1): carpan yalniz DOGRU (zincir, adres) ciftine doner. Argumanlari yok sayan
    // `() => deger` mock'u, tuketicinin zinciri dusurmesini (ya da baska zincirle sormasini) yakalayamazdi.
    multiplierFor: (chainId, address) => (
        Number(chainId) === carpan.zincir && String(address).toLowerCase() === carpan.adres ? carpan.deger : null
    ),
}))
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} },
        // `decimals()` sahte 18 doner: gercek Contract sahte saglayicida duser ve her testte `Decimals fetch failed`
        // stack'i basardi (FIN-bilesen-9). 18 zaten dusme yolunun varsayilani, yani gorunen davranis ayni.
        Contract: class { async decimals() { return 18n } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { yorumsuzHtml, butonlar, devreDisi } from '../test-utils/ssrHtmlYardimcilari.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import Token from './Token.vue'
import { XSTOCKS } from '../data/xStocks'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SPY = XSTOCKS.find((s) => s.symbol === 'SPYx')
const SPY_M = 1005714560286254000n // Spec Ek B.1 olcumu
const TIRE = '\u2014'

// FIN-bilesen-9: tire iddialari govdeye bagli. Baslik fiyati <h1>, deger kutusu indigo <p>; bakiye kutusu ayri.
const govdeMetni = (html, desen) => {
    const eslesme = html.match(desen)
    return eslesme ? eslesme[1].replace(/\s+/g, ' ').trim() : null
}
const baslikFiyati = (html) => govdeMetni(html, /<h1[^>]*>([\s\S]*?)<\/h1>/)
const degerKutusu = (html) => govdeMetni(html, /<p[^>]*text-indigo-600[^>]*font-mono[^>]*>([\s\S]*?)<\/p>/)

beforeEach(() => {
    carpan.deger = SPY_M
    carpan.doldur = vi.fn(async () => {})
    carpan.zincir = 1
    carpan.adres = SPY.address.toLowerCase()
    axiosPostMock.mockResolvedValue({
        status: 200,
        data: { token: { name: 'SP500', symbol: 'spyx', coingecko_id: 'sp500-xstock', image: { thumb: '', large: '' }, address: '0x0', market_data: { priceUSD: 781.3, market_cap: 1, volume: 1, circulating_supply: 1, ath: 1, atl: 1, change: { h24: 0 }, sparkline: { d7: [] } } } },
    })
})

afterEach(() => {
    axiosPostMock.mockReset()
    delete globalThis.chrome
})

async function ac() {
    installChromeStub({ currentNetwork: ETH_CHAIN, active_account: { address: '0xAbCdEf0000000000000000000000000000000001' } })
    const app = createApp(Token, { props: { id: 'sp500-xstock' } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = ETH_CHAIN
    cryptoStore().selected_token_ref = { id: 'sp500-xstock', chainId: 1, address: SPY.address }
    const captured = captureInstance(app, 'Token')
    const html = await render(app)
    return { captured, html, govde: yorumsuzHtml(html) }
}

describe('Token.vue (SSR) - bayrak KAPALI: xStock urun yuzeyi duz token', () => {
    it('rozet, ihracci notu, Kopru aciklamasi yok; Takas ve Kopru acik', async () => {
        const { captured, html, govde } = await ac()

        expect(captured.instance.setupState.tokenIsXStock).toBeUndefined()
        expect(govde).not.toContain('Tokenized stock')
        expect(govde).not.toContain('tracker certificate')
        expect(govde).not.toContain('xStocks cannot be bridged')
        expect(butonlar(html).filter((b) => b.metin === 'Swap')).toHaveLength(1)
        expect(butonlar(html).filter((b) => b.metin === 'Buy / Sell')).toHaveLength(0)
        expect(html).not.toContain('data-xstock-trade')
        expect(govde).not.toContain('Buy / Sell')
        expect(devreDisi(butonlar(html).find((b) => b.metin === 'Bridge'))).toBe(false)
    })

    it('fiyat ve deger bayraktan BAGIMSIZ carpana bolunur: $776.86 ve 2 x 776,86 = $1,553.72', async () => {
        const { govde } = await ac()

        expect(govde).toContain('$776.86')
        expect(govde).toContain('$1,553.72')
        expect(govde).not.toContain('781.30')
    })

    it('carpan bayrak kapaliyken de onMounted ile doldurulur (yoksa fiyat hep tire kalirdi)', async () => {
        await ac()

        expect(carpan.doldur).toHaveBeenCalledTimes(1)
        expect(carpan.doldur.mock.calls[0][0]).toEqual([{ chainId: 1, address: SPY.address }])
    })

    it('carpan bilinmiyorsa (bayrak kapali da) baslik fiyati ve deger tire; ham fiyat ve $0.00 yok', async () => {
        carpan.deger = null
        const { captured, govde } = await ac()

        expect(captured.instance.setupState.xStockPriceUnknown).toBe(true)
        expect(govde).not.toContain('781.30')
        expect(govde).not.toContain('$0.00')
        expect(govde).toContain(TIRE)
        // Baslik fiyati VE deger kutusu: ikisi de yalniz tire yazar (kutu $0.00 degil; deger hucresi ayri iddia).
        expect(baslikFiyati(govde)).toBe(TIRE)
        expect(degerKutusu(govde)).toBe(TIRE)
    })
})

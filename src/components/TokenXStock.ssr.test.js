// Token.vue (SSR) - xStock satiri: urun yuzeyi YOK (T9: hisse ekrani), fiyat ve deger carpana
// bolunmus (spec 5.9 katman 3, 8.2). Kalip TokenBStock.ssr.test.js ile AYNI.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosPostMock = vi.fn()
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))

// Bakiye 2 token. Okuma cagrisi sayilabilir (FIN-bilesen-7: carpan doldurma bakiye okumasini bekletmez).
const bakiyeOku = vi.hoisted(() => vi.fn(async () => 2))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => bakiyeOku(...args) }))

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

// xStock adresleri NATIVE ('0x0') degil: ERC-20 decimals() dali calisir; sahte saglayici dusurur, kod 18'e duser.
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
import { yorumsuzHtml, butonlar, butonSayisi, devreDisi } from '../test-utils/ssrHtmlYardimcilari.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Token from './Token.vue'
import { XSTOCKS } from '../data/xStocks'
import supported_chains from '../data/supported_chains.json'

const chainOf = (id) => supported_chains.find((c) => c.chainId === id)
const ETH_CHAIN = chainOf(1)
const POLYGON_CHAIN = chainOf(137)
const SPY = XSTOCKS.find((s) => s.symbol === 'SPYx')
const SPY_M = 1005714560286254000n // Spec Ek B.1 olcumu
const TIRE = '\u2014'

// Gorunen metni TAM OLARAK rozet metni olan oge.
const rozetVar = (html) => />\s*Tokenized stock\s*</.test(yorumsuzHtml(html))
const etiketliButon = (html, etiket) => {
    const bulunan = butonlar(html).filter((b) => b.metin === etiket)
    expect(bulunan, `"${etiket}" butonu tam olarak bir kez render edilmeli`).toHaveLength(1)
    return bulunan[0]
}

// FIN-bilesen-9: tire iddialari govdeye bagli. Baslik fiyati <h1>, deger kutusu indigo <p>; bakiye kutusu ayri.
const govdeMetni = (html, desen) => {
    const eslesme = html.match(desen)
    return eslesme ? eslesme[1].replace(/\s+/g, ' ').trim() : null
}
const baslikFiyati = (html) => govdeMetni(html, /<h1[^>]*>([\s\S]*?)<\/h1>/)
const degerKutusu = (html) => govdeMetni(html, /<p[^>]*text-indigo-600[^>]*font-mono[^>]*>([\s\S]*?)<\/p>/)

const mockTokenRecord = (overrides = {}) => ({
    name: 'SP500',
    symbol: 'spyx',
    coingecko_id: 'sp500-xstock',
    image: { thumb: '', large: '' },
    address: '0x0',
    market_data: {
        priceUSD: 781.3,
        market_cap: 1000,
        volume: 500,
        circulating_supply: 1000,
        ath: 800,
        atl: 600,
        change: { h24: 0.1 },
        sparkline: { d7: [] },
    },
    ...overrides,
})

beforeEach(() => {
    bakiyeOku.mockClear()
    carpan.deger = null
    carpan.doldur = vi.fn(async () => {})
    carpan.zincir = 1
    carpan.adres = SPY.address.toLowerCase()
    axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord() } })
})

afterEach(() => {
    axiosPostMock.mockReset()
    delete globalThis.chrome
})

function setup({ chainRecord = ETH_CHAIN, address = SPY.address, tokenId = 'sp500-xstock' } = {}) {
    installChromeStub({
        currentNetwork: chainRecord,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001' },
    })

    const app = createApp(Token, { props: { id: tokenId } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = chainRecord

    // chainId SATIRIN zinciri (Home'un Hisseler satiri yazar).
    cryptoStore().selected_token_ref = { id: tokenId, chainId: chainRecord.chainId, address }
    return { app }
}

describe('Token.vue (SSR) - xStock detayi', () => {
    // T9: urun yuzeyi (rozet, ihracci notu, Kopru kilidi, Takas yerine Al / Sat) Token.vue'dan KALKTI; bayrak
    // aciksa xStock StockDetail'e yonlenir (stockRoute.js), bayrak kapaliysa duz token. Token.vue iki halde de duz.
    it('xStock satiri Token.vue da duz token: rozet, ihracci notu, Kopru aciklamasi, Al / Sat yok; Takas, Gonder, Kopru acik', async () => {
        const { app } = setup()
        const captured = captureInstance(app, 'Token')
        const html = await render(app)
        const govde = yorumsuzHtml(html)

        expect(captured.instance.setupState.tokenIsXStock).toBeUndefined()
        expect(rozetVar(html)).toBe(false)
        expect(govde).not.toContain('tracker certificate')
        expect(govde).not.toContain('xStocks cannot be bridged')
        expect(butonSayisi(html, 'Swap')).toBe(1)
        expect(butonSayisi(html, 'Send')).toBe(1)
        expect(butonSayisi(html, 'Buy / Sell')).toBe(0)
        expect(html).not.toContain('data-xstock-trade')
        expect(devreDisi(etiketliButon(html, 'Bridge'))).toBe(false)
    })

    it('Token.vue stock_trade sayfasina gitmez (kaynak taramasi)', () => {
        const kaynak = readFileSync(fileURLToPath(new URL('./Token.vue', import.meta.url)), 'utf8')
        expect(kaynak).not.toContain('selectStockTrade')
        expect(kaynak).not.toContain("'stock_trade'")
        expect(kaynak).not.toContain('noBridgeKey')
    })

    it('fiyat ve deger carpana bolunur: baslik $776.86, deger 2 x 776,86 = $1,553.72', async () => {
        carpan.deger = SPY_M
        const { app } = setup()
        const captured = captureInstance(app, 'Token')
        const html = yorumsuzHtml(await render(app))

        expect(captured.instance.setupState.xStockPriceUnknown).toBe(false)
        expect(captured.instance.setupState.displayToken.market_data.priceUSD).toBeCloseTo(776.86, 2)
        expect(html).toContain('$776.86')
        expect(html).toContain('$1,553.72')
        expect(html).not.toContain('781.30')
    })

    // Review Focus 2: carpan bilinmiyor -> fiyat ve deger tire; ham CoinGecko fiyati ve $0.00 yok.
    it('Review Focus 2: carpan bilinmiyorsa baslik fiyati ve deger tire; ham fiyat yazilmaz', async () => {
        carpan.deger = null
        const { app } = setup()
        const captured = captureInstance(app, 'Token')
        const html = yorumsuzHtml(await render(app))

        expect(captured.instance.setupState.xStockPriceUnknown).toBe(true)
        expect(html).not.toContain('781.30')
        expect(html).not.toContain('$0.00')
        expect(html).toContain(TIRE)
        // Baslik fiyati VE deger kutusu: ikisi de yalniz tire yazar (kutu $0.00 degil; deger hucresi ayri iddia).
        expect(baslikFiyati(html)).toBe(TIRE)
        expect(degerKutusu(html)).toBe(TIRE)
    })

    // Review Focus 1: ayni adres katalog DISI bir zincirde hisse sayilmaz.
    it('Review Focus 1: ayni SPYx adresi Polygon da duz token: Takas gorunur, Kopru acik, ham fiyat', async () => {
        carpan.deger = SPY_M
        const { app } = setup({ chainRecord: POLYGON_CHAIN })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.xStockPriceUnknown).toBe(false) // katalog disi: carpan yok, ham fiyat
        expect(rozetVar(html)).toBe(false)
        expect(butonSayisi(html, 'Swap')).toBe(1)
        expect(butonSayisi(html, 'Buy / Sell')).toBe(0)
        expect(html).not.toContain('data-xstock-trade')
        expect(devreDisi(etiketliButon(html, 'Bridge'))).toBe(false)
        expect(yorumsuzHtml(html)).toContain('$781.30')
    })

    // Fiyat bolme carpani onMounted'da TEK cagriyla doldurulur (onbellek bos acilista); aksi halde fiyat hep tire kalirdi.
    it('onMounted: eksik carpan SATIRIN (zincir, adres) ciftiyle ensureMultipliersFor ile doldurulur', async () => {
        const { app } = setup()
        await render(app)

        expect(carpan.doldur).toHaveBeenCalledTimes(1)
        expect(carpan.doldur.mock.calls[0][0]).toEqual([{ chainId: 1, address: SPY.address }])
    })

    // FIN-bilesen-7: carpan doldurma ONCE baslatilir, decimals ve bakiye okunur, en sonda beklenir. Eski sirada
    // (once bekle) 6 sn'ye kadar bakiye 0.000000 kalirdi. Doldurma HIC cozulmezken bakiye okumasi yine yapilmali.
    it('FIN-bilesen-7: ensureMultipliersFor hic cozulmezken bile bakiye okumasi yapilir (doldurma bekletmez)', async () => {
        let birak
        carpan.doldur = vi.fn(() => new Promise((resolve) => { birak = resolve }))
        const { app } = setup()
        const bitti = render(app)
        try {
            await vi.waitFor(() => expect(bakiyeOku).toHaveBeenCalled())
            expect(carpan.doldur).toHaveBeenCalledTimes(1) // doldurma baslamis ve hala asili
        } finally {
            birak?.()
            await bitti
        }
    })

    it('katalog disi zincirdeki ayni adres icin carpan doldurulmaz (duz token: ag istegi yok)', async () => {
        const { app } = setup({ chainRecord: POLYGON_CHAIN })
        await render(app)

        expect(carpan.doldur).not.toHaveBeenCalled()
    })

    it('Gonder: sendAsset xStock icin BOLUNMUS fiyati ve satirin zincirini tasir', async () => {
        carpan.deger = SPY_M
        const { app } = setup()
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSend()

        const asset = cryptoStore().sendAsset
        expect(asset.market.priceUSD).toBeCloseTo(776.86, 2)
        expect(asset.chainId).toBe(1)
        expect(asset.address).toBe(SPY.address)
    })
})

// Home.vue (SSR) - Hisseler sekmesi: bStocks + xStocks TEK listede, AGA GORE gruplu (spec 5.7).
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: async () => [] }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))

// Hisseler bakiyesi: zincir basina TEK Multicall3 (utils/stockBalances). Okuyucu testten kurulur.
const readStockBalancesMock = vi.fn()
vi.mock('../utils/stockBalances', async (importOriginal) => ({
    ...(await importOriginal()),
    readStockBalances: (...args) => readStockBalancesMock(...args),
    ensureMultipliersFor: async () => {},
}))

// Satira basinca ag gecisi (K3): gercek govde RPC hiz testi yapar; burada yalnizca "hangi zincirle cagrildi" olculur.
const applyNetworkChangeMock = vi.fn(async () => true)
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: (...args) => applyNetworkChangeMock(...args) }))

const axiosPostMock = vi.fn()
vi.mock('axios', () => ({
    default: {
        post: (...args) => axiosPostMock(...args),
        get: async () => ({ status: 200, data: { news: [] } }),
    },
}))

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import Home from './Home.vue'
import { chainLogo } from '../utils/chainLogo'
import { BSTOCKS } from '../data/bStocks'
import { XSTOCKS } from '../data/xStocks'
import { stockEntry, stockKey } from '../utils/tokenizedStocks'
import supported_chains from '../data/supported_chains.json'

const chainOf = (id) => supported_chains.find((c) => c.chainId === id)
const ETH_CHAIN = chainOf(1)
const BSC_CHAIN = chainOf(56)
const POLYGON_CHAIN = chainOf(137)
const HESAP = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }
const E18 = 10n ** 18n
const SPY_M = 1005714560286254000n // Spec Ek B.1 olcumu
const TSLA = XSTOCKS.find((s) => s.symbol === 'TSLAx')
const SPY = XSTOCKS.find((s) => s.symbol === 'SPYx')
const MSTR = XSTOCKS.find((s) => s.symbol === 'MSTRx') // Arbitrum'da katalogda yalniz MSTRx var (SPYx 2026-10-15 cikarildi)
const GOOGLB = BSTOCKS.find((s) => s.symbol === 'GOOGLB')
const TIRE = '—'

// Okuyucu tablosu: stockKey(zincir, adres) -> { balance, multiplier }. Tabloda olmayan satir: bakiye 0 ve
// xStock icin carpan 1,0 (bStock icin yok). `dusenZincirler`: Multicall3 cagrisinin KENDISI duser.
let tablo = {}
let dusenZincirler = new Set()
let fiyatlar = []
const okuyucu = async ({ chainId, entries }) => {
    if (dusenZincirler.has(chainId)) throw new Error('rpc dustu')
    return new Map(entries.map((e) => [
        e.address.toLowerCase(),
        tablo[stockKey(chainId, e.address)] ?? { balance: 0n, multiplier: e.issuer === 'xstocks' ? E18 : null },
    ]))
}

beforeEach(() => {
    tablo = {}
    dusenZincirler = new Set()
    fiyatlar = []
    readStockBalancesMock.mockReset()
    readStockBalancesMock.mockImplementation(okuyucu)
    applyNetworkChangeMock.mockReset()
    applyNetworkChangeMock.mockResolvedValue(true)
    axiosPostMock.mockReset()
    axiosPostMock.mockImplementation(async () => ({ status: 200, data: { tokens: fiyatlar } }))
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

/** Home.vue'yu activeTab ZATEN 'stocks' iken render eder (HomeBStocks.ssr.test.js ile ayni kalip). */
async function renderHome({ chain = ETH_CHAIN, locale = 'en', importedTokens = {}, account = HESAP, chip = 'all' } = {}) {
    const stub = installChromeStub({ currentNetwork: chain, active_account: account, imported_tokens: importedTokens, vaults: [] })

    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    const network = networkStore()
    network.currentNetwork = chain

    const captured = captureInstance(app, 'Home', (instance) => { instance.setupState.activeTab = 'stocks'; if (chip !== undefined) instance.setupState.stockChipChoice = chip })
    const html = await render(app)
    return { html, captured, stub }
}

// SSR ciktisi sablon yorumlarini tasir: metin aramadan once temizlenir.
const govdeOf = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
// Belirli bir sembolu iceren <button> satirlari, belge sirasiyla.
const satirlar = (html, sembol) => govdeOf(html).match(
    new RegExp(`<button[^>]*>(?:(?!<\\/button>)[\\s\\S])*?data-stock-ticker[^>]*>${sembol}<\\/span>[\\s\\S]*?<\\/button>`, 'g'),
) || []
// Satirin bakiye hucresinin metni (bosluklar sadelestirilmis); hucre yoksa null.
const bakiyeHucresi = (satir) => {
    const eslesme = satir.match(/<span[^>]*data-stock-balance[^>]*>([\s\S]*?)<\/span>/)
    return eslesme ? eslesme[1].replace(/&middot;/g, '·').replace(/\s+/g, ' ').trim() : null
}

describe('Home.vue (SSR) - Hisseler: ag gruplari', () => {
    // Review Focus 1: ayni adres uc zincirde. Her zincir KENDI grubunda AYRI satir.
    it('Review Focus 1: katalogdaki her hisse listelendigi her zincirde AYRI satir (zincir sayisi katalogdan)', async () => {
        const { html } = await renderHome()

        // T5/TK5: ayni sirket AG BASINA ayri satir; BSC'de bStock + xStock tek satir. Satir sayisi =
        // sirketin bulundugu ayri zincirler (xStocks zincirleri + bStocks varsa BSC).
        for (const stock of XSTOCKS) {
            const zincirler = new Set(stock.chains)
            if (BSTOCKS.some((b) => b.underlying === stock.underlying)) zincirler.add(56)
            expect(satirlar(html, stock.underlying), stock.underlying).toHaveLength(zincirler.size)
        }
    })

    it('22 bStock satiri BSC grubunda aynen durur (xStocks eklenmesi onlari degistirmez)', async () => {
        const { html } = await renderHome()

        // Sembol artik TSLAB degil TSLA (ticker). Ciftler BSC'de TEK satir; baska zincirlerdeki xStock
        // satirlari ayrica sayilir (yukaridaki test ile ayni kural).
        for (const stock of BSTOCKS) {
            const xZincir = XSTOCKS.find((x) => x.underlying === stock.underlying)?.chains.filter((c) => c !== 56) ?? []
            expect(satirlar(html, stock.underlying), stock.underlying).toHaveLength(1 + xZincir.length)
        }
    })

    it('ag basliklari adlariyla yazilir, grup basina bir tane', async () => {
        const { html, captured } = await renderHome()
        const govde = govdeOf(html)
        const basliklar = govde.match(/<div[^>]*data-stock-group-header[^>]*>[\s\S]*?<\/div>/g) || []

        expect(basliklar).toHaveLength(captured.instance.setupState.stockGroups.length)
        expect(govde).toContain('BNB Smart Chain')
        expect(govde).toContain('Arbitrum One')
    })

    it('her satirda kucuk ag logosu var (onayli tasarim: ihracci rozeti VE ag logosu)', async () => {
        const { html } = await renderHome()

        for (const sembol of ['TSLAx', 'GOOGLB']) {
            for (const satir of satirlar(html, sembol)) expect(satir, sembol).toContain('data-stock-chain-logo')
        }
    })

    it('ihracci rozeti HICBIR satirda yok (T5, K3); satir alt metni ticker', async () => {
        const { html } = await renderHome()
        const govde = govdeOf(html)

        expect(govde).not.toMatch(/>\s*xStocks\s*<\/span>/)
        expect(govde).not.toMatch(/>\s*bStocks\s*<\/span>/)
        // Eski sembol (TSLAB / TSLAx) satirda gorunmez, ticker gorunur.
        expect(govde).not.toMatch(/\bTSLA[bBxX]\b/)
        expect(satirlar(html, 'TSLA')[0]).toContain('data-stock-ticker>TSLA</span>')
    })

    it('BSC grubunda cift (TSLA) TEK satir: bStocks + xStocks ayni sirket satirinda', async () => {
        const { captured } = await renderHome({ chain: BSC_CHAIN, chip: 56 })
        const bsc = captured.instance.setupState.visibleStockGroups.find((g) => g.chainId === 56)

        expect(bsc.rows.filter((c) => c.underlying === 'TSLA')).toHaveLength(1)
        expect(bsc.rows.find((c) => c.underlying === 'TSLA').options.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks'])
    })

    it('aktif ag en ustte; aktif ag gruplardan biri degilse sabit sira (Ethereum, BSC, Arbitrum)', async () => {
        const eth = await renderHome({ chain: ETH_CHAIN })
        expect(eth.captured.instance.setupState.stockGroups.map((g) => g.chainId)).toEqual([1, 56, 42161])

        const bsc = await renderHome({ chain: BSC_CHAIN })
        expect(bsc.captured.instance.setupState.stockGroups.map((g) => g.chainId)).toEqual([56, 1, 42161])

        const polygon = await renderHome({ chain: POLYGON_CHAIN })
        expect(polygon.captured.instance.setupState.stockGroups.map((g) => g.chainId)).toEqual([1, 56, 42161])
    })

    it('uc zincirde de okuma yapilir: zincir basina TEK Multicall3 cagrisi', async () => {
        await renderHome()

        expect(readStockBalancesMock.mock.calls.map(([arg]) => arg.chainId).sort((a, b) => a - b)).toEqual([1, 56, 42161])
    })
})

describe('Home.vue (SSR) - Hisseler: fiyat ve bakiye', () => {
    const spyKaydi = { coingecko_id: 'sp500-xstock', market_data: { priceUSD: 781.3, change: { h24: 0.17 } } }

    it('Review Focus 1: xStock fiyati SATIRIN KENDI zincirinin carpaniyla bolunur', async () => {
        fiyatlar = [spyKaydi]
        tablo = {
            [stockKey(1, SPY.address)]: { balance: 0n, multiplier: SPY_M },
            [stockKey(56, SPY.address)]: { balance: 0n, multiplier: E18 },
            [stockKey(42161, SPY.address)]: { balance: 0n, multiplier: null }, // Arbitrum: carpan okunamadi
        }

        const { captured, html } = await renderHome()
        const st = captured.instance.setupState

        expect(st.bStockFiyatMetni(stockEntry(1, SPY.address))).toBe('$776.86')
        expect(st.bStockFiyatMetni(stockEntry(56, SPY.address))).toBe('$781.30')
        expect(st.bStockFiyatMetni(stockEntry(42161, SPY.address))).toBe(TIRE)
        // Sirket satiri fiyati TK6 temsilcisinden gelir: hicbir secenek tutulmuyorsa bStocks. Bu testte bStock
        // fiyat kaydi yok; Ethereum'da yalniz xStock oldugundan onun carpanli fiyati gorunur.
        expect(govdeOf(html)).toContain('$776.86')
    })

    // Review Focus 2: carpan hicbir zincirde okunamadiysa ham CoinGecko fiyati ASLA yazilmaz.
    it('Review Focus 2: carpan okunamadiysa xStock fiyati tire; ham fiyat ($781.30) yazilmaz', async () => {
        fiyatlar = [spyKaydi]
        tablo = Object.fromEntries(SPY.chains.map((c) => [stockKey(c, SPY.address), { balance: 0n, multiplier: null }]))

        const { captured, html } = await renderHome()
        const st = captured.instance.setupState

        for (const chainId of SPY.chains) expect(st.bStockFiyatMetni(stockEntry(chainId, SPY.address)), String(chainId)).toBe(TIRE)
        expect(govdeOf(html)).not.toContain('$781.30')
    })

    it('bStock fiyati eskisi gibi HAM ($231.45); carpan sorusu bStock fiyatini degistirmez', async () => {
        fiyatlar = [{ coingecko_id: GOOGLB.coingecko_id, market_data: { priceUSD: 231.45, change: { h24: -1.23 } } }]

        const { captured } = await renderHome()

        expect(captured.instance.setupState.bStockFiyatMetni(GOOGLB)).toBe('$231.45')
    })

    it('sahip olunan hissenin bakiyesi SATIRDA yazilir ve yalniz sahip oldugu zincirde', async () => {
        tablo = { [stockKey(1, TSLA.address)]: { balance: 2_500000000000000000n, multiplier: E18 } }

        const { html } = await renderHome()
        const tsla = satirlar(html, 'TSLA') // belge sirasi: katalogdaki chains sirasi (Ethereum, BSC)

        expect(tsla).toHaveLength(new Set([...TSLA.chains, 56]).size)
        expect(tsla[0]).toContain('2.5000')
        for (const satir of tsla.slice(1)) expect(satir).not.toContain('2.5000')
    })

    // Review Focus 2: okuma duserse bakiye 0 DEGIL tire; digerleri etkilenmez.
    it('Review Focus 2: bir zincirin okumasi dusunce YALNIZ o zincirin satirlari tire olur', async () => {
        dusenZincirler = new Set([42161])
        fiyatlar = [
            { coingecko_id: 'microstrategy-xstock', market_data: { priceUSD: 379.3, change: { h24: 1 } } },
            // BSC satirinin temsilcisi bStocks (hicbiri tutulmuyor): fiyat onun kaydindan gelir.
            { coingecko_id: BSTOCKS.find((x) => x.underlying === 'MSTR').coingecko_id, market_data: { priceUSD: 379.3, change: { h24: 1 } } },
        ]
        tablo = { [stockKey(1, MSTR.address)]: { balance: 2_500000000000000000n, multiplier: E18 } }
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})

        const { captured, html } = await renderHome()
        const bakiyeler = captured.instance.setupState.stockBalances
        const spy = satirlar(html, 'MSTR')

        expect(bakiyeler[stockKey(42161, MSTR.address)].status).toBe('error')
        expect(bakiyeler[stockKey(1, MSTR.address)].status).toBe('ok')
        expect(spy[0]).toContain('2.5000')
        expect(spy[1]).not.toContain(TIRE) // BSC: fiyat $379.30, bakiye sifir (bos)
        expect(spy[2]).toContain(TIRE) // Arbitrum: bakiye okunamadi

        // FIN-bilesen-4: tire BAKIYE HUCRESINDEN gelir (fiyat tiresi degil). Arbitrum'da fiyat da bilinmiyor
        // olabilir; hucre duzeyinde iddia durum -> etiket kablolamasini kilitler.
        expect(bakiyeHucresi(spy[2])).toBe(`· ${TIRE}`)
        expect(bakiyeHucresi(spy[0])).toContain('2.5000') // okumasi basarili satirda sayi
        expect(bakiyeHucresi(spy[0])).not.toContain(TIRE)
        expect(bakiyeHucresi(spy[1])).toBeNull() // okumasi basarili, bakiye sifir: etiket hic yok (tire DEGIL)
        hata.mockRestore()
    })

    it('footer: tek isimsiz sertifika notu cevirilerden gelir (EN ve TR); ihracci adi YOK (TK14)', async () => {
        const en = await renderHome({ locale: 'en' })
        expect(govdeOf(en.html)).toContain('certificates over shares')
        expect(govdeOf(en.html)).not.toContain('Backed Assets')
        expect(govdeOf(en.html)).not.toContain('BTech')

        const tr = await renderHome({ locale: 'tr' })
        expect(govdeOf(tr.html)).toContain('hisse üzerine sertifika')
        expect(govdeOf(tr.html)).not.toContain('Backed Assets')
        expect(govdeOf(tr.html)).not.toContain('BTech')
    })

    it('toplam bakiye: ayni zincirde iki secenek TOPLANIR (BSC TSLA: bStock + xStock)', async () => {
        const b = BSTOCKS.find((s) => s.underlying === 'TSLA')
        tablo = {
            [stockKey(56, b.address)]: { balance: E18, multiplier: null },
            [stockKey(56, TSLA.address)]: { balance: 2n * E18, multiplier: E18 },
        }
        const { html } = await renderHome()
        const bsc = satirlar(html, 'TSLA').find((r) => r.includes('3.0000'))

        expect(bsc).toBeDefined()
        expect(bakiyeHucresi(bsc)).toContain('3.0000')
    })
})

describe('Home.vue (SSR) - Hisseler: sahip olunanlar Varliklar a eklenir', () => {
    it('sahip olunan xStock ilgili zincirin kovasina CoinGecko logosuyla yazilir; baska zincire YAZILMAZ', async () => {
        fiyatlar = [{
            coingecko_id: 'microstrategy-xstock',
            image: { large: 'https://img.example/mstr-large.png' },
            market_data: { priceUSD: 379.3, change: { h24: 1 } },
        }]
        tablo = {
            [stockKey(1, MSTR.address)]: { balance: 2_500000000000000000n, multiplier: E18 },
            [stockKey(42161, MSTR.address)]: { balance: E18, multiplier: E18 },
        }

        // Saglikli kova ('1' ve '56' anahtarlari var): hasarli kovada tohum varsayilanlari BEKLER (bucketNeedsDefaults).
        const { stub } = await renderHome({ importedTokens: { acc1: { 1: [], 56: [] } } })
        const kova = stub.localStore.imported_tokens.acc1

        expect(kova['1'].map((t) => t.symbol)).toEqual(['MSTRx'])
        expect(kova['1'][0]).toMatchObject({
            coingecko_id: 'microstrategy-xstock',
            address: MSTR.address,
            decimals: 18,
            image: { large: 'https://img.example/mstr-large.png' },
        })
        expect(kova['42161'].map((t) => t.symbol)).toEqual(['MSTRx'])
        expect(kova['56']).toEqual([])
    })
})

describe('Home.vue (SSR) - Hisseler: satira basinca', () => {
    const tsla56 = () => stockEntry(56, TSLA.address)

    it('baska zincirdeki xStock: cuzdan agi DEGISMEZ, detay hissenin zinciriyle acilir (kullanici karari 2026-10-23)', async () => {
        const { captured } = await renderHome({ chain: ETH_CHAIN })

        await captured.instance.setupState.openStock(tsla56())

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(networkStore().currentNetwork.chainId).toBe(1) // cuzdan Ethereum'da kaldi
        expect(cryptoStore().selected_token_ref).toEqual({
            id: 'tesla-xstock', chainId: 56, address: TSLA.address, decimals: 18, symbol: 'TSLAx',
        })
        expect(cryptoStore().selected_token_id).toBe('tesla-xstock')
        expect(pageStore().currentPage).toBe('token')
    })

    it('sirket satirina basinca TK6 temsilcisi yazilir: xStock tutuluyorsa o, yoksa bStocks', async () => {
        tablo = { [stockKey(56, TSLA.address)]: { balance: E18, multiplier: E18 } }
        const { captured } = await renderHome({ chain: BSC_CHAIN })
        const st = captured.instance.setupState
        const bsc = st.visibleStockGroups.find((g) => g.chainId === 56)
        const tsla = bsc.rows.find((c) => c.underlying === 'TSLA')
        const nvda = bsc.rows.find((c) => c.underlying === 'NVDA')

        await st.openStock(tsla)
        expect(cryptoStore().selected_token_ref.address).toBe(TSLA.address) // xStock tutuluyor

        await st.openStock(nvda)
        expect(cryptoStore().selected_token_ref.address).toBe(BSTOCKS.find((b) => b.underlying === 'NVDA').address) // hicbiri tutulmuyor
    })

    it('satirin zinciri aktif agla AYNIYSA da ag gecisi TETIKLENMEZ', async () => {
        const { captured } = await renderHome({ chain: BSC_CHAIN })

        await captured.instance.setupState.openStock(tsla56())

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(pageStore().currentPage).toBe('token')
    })

    // Kullanici karari (2026-10-23): hisseye basmak cuzdanin aktif agini DEGISTIRMEZ; bayrak acik olsa da
    // (eski K3 gecisi kalkti), bStocks satiri da ayni sekilde.
    it('bayrak ACIK + Ethereum aktif + GOOGLB: ag gecisi YOK, BSC kaydi yazilir, cuzdan Ethereum da kalir', async () => {
        const { captured } = await renderHome({ chain: ETH_CHAIN })

        await captured.instance.setupState.openStock(GOOGLB)

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(networkStore().currentNetwork.chainId).toBe(1)
        expect(cryptoStore().selected_token_ref.chainId).toBe(56)
        expect(pageStore().currentPage).toBe('token')
    })

    it('bayrak ACIK + BSC aktif + GOOGLB: ag gecisi TETIKLENMEZ', async () => {
        const { captured } = await renderHome({ chain: BSC_CHAIN })

        await captured.instance.setupState.openStock(GOOGLB)

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(cryptoStore().selected_token_ref.chainId).toBe(56)
        expect(pageStore().currentPage).toBe('token')
    })

    it('ust uste dokunus: SON dokunulan satir secilir (ag beklemesi olmadigi icin yaris yok)', async () => {
        const { captured } = await renderHome({ chain: ETH_CHAIN })
        const st = captured.instance.setupState

        await st.openStock(tsla56())
        await st.openStock(stockEntry(42161, MSTR.address))

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(cryptoStore().selected_token_ref.chainId).toBe(42161)
        expect(cryptoStore().selected_token_ref.address).toBe(MSTR.address)
    })

    it('kaynak kilidi: openStock govdesinde applyNetworkChange YOK', async () => {
        const { readFileSync } = await import('node:fs')
        const { yorumsuz, blokGovdesi } = await import('../test-utils/kaynakTarama.js')
        const kaynak = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8')
        const govde = blokGovdesi(kaynak, /const openStock = \(stock\) =>/)

        expect(govde).not.toBeNull()
        expect(yorumsuz(govde)).not.toContain('applyNetworkChange')
    })

    it('satirin @click bagi openStock a gider (kaynak kilidi: grup satiri)', async () => {
        const { readFileSync } = await import('node:fs')
        const kaynak = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8')

        const satirBlogu = kaynak.match(/<button[^>]*?v-for="stock in group\.rows"[\s\S]*?>/)

        expect(satirBlogu).not.toBeNull()
        expect(satirBlogu[0]).toContain('@click="openStock(stock)"')
    })
})

// T16-GAP-5: hesap degisimi. Eski hesabin bakiye etiketleri ekranda KALMAZ, gorunen Hisseler sekmesi
// yeni hesabi hemen okur. SSR'da izleyici tetiklenmez; izleyicinin govdesi `onUserAddressChanged`
// dogrudan cagrilir ve izleyicinin ona bagli oldugu kaynak kilidiyle kanitlanir.
describe('Home.vue (SSR) - Hisseler: hesap degisimi (T16-GAP-5)', () => {
    const HESAP_B = { address: '0x00000000000000000000000000000000000000B2', key: 'acc2' }
    const tsla1 = () => stockKey(1, TSLA.address)

    // Sahip bazli okuyucu: A hesabi 2.5 TSLAx tutar, B hesabi hicbir sey tutmaz.
    const sahipBazli = (beklet = {}) => async (arg) => {
        const bekle = beklet[arg.owner]
        if (bekle) await bekle
        return new Map(arg.entries.map((e) => [
            e.address.toLowerCase(),
            {
                balance: arg.owner === HESAP.address && arg.chainId === 1 && e.address === TSLA.address ? 2_500000000000000000n : 0n,
                multiplier: e.issuer === 'xstocks' ? E18 : null,
            },
        ]))
    }
    const hesapDegistir = (stub) => { stub.localStore.active_account = HESAP_B }

    it('izleyici onUserAddressChanged a baglidir (kaynak kilidi)', async () => {
        const { readFileSync } = await import('node:fs')
        const kaynak = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8')

        expect(kaynak).toMatch(/watch\(\(\) => user\.address,\s*onUserAddressChanged\)/)
    })

    it('hesap degisince eski hesabin bakiyesi HEMEN silinir (yeni okuma bitmeden)', async () => {
        readStockBalancesMock.mockImplementation(sahipBazli())
        const { captured, stub } = await renderHome()
        const st = captured.instance.setupState
        expect(st.stockBalances[tsla1()].balance).toBe(2_500000000000000000n)

        // Yeni hesabin okumasi ASILI kalir: yalniz sifirlama gorunur.
        readStockBalancesMock.mockImplementation(() => new Promise(() => {}))
        hesapDegistir(stub)
        await st.onUserAddressChanged()

        expect(st.stockBalances).toEqual({})
    })

    it('Hisseler sekmesi gorunuyorsa yeni hesabin bakiyesi hemen okunur', async () => {
        readStockBalancesMock.mockImplementation(sahipBazli())
        const { captured, stub } = await renderHome()
        const st = captured.instance.setupState
        readStockBalancesMock.mockClear()

        hesapDegistir(stub)
        await st.onUserAddressChanged()
        await vi.waitFor(() => expect(st.stockBalances[tsla1()]?.balance).toBe(0n))

        const sahipler = readStockBalancesMock.mock.calls.map(([arg]) => arg.owner)
        expect(sahipler.length).toBeGreaterThan(0)
        for (const sahip of sahipler) expect(sahip).toBe(HESAP_B.address)
    })

    it('Hisseler sekmesi gorunmuyorsa okuma YAPILMAZ (sekme acilisi okur)', async () => {
        readStockBalancesMock.mockImplementation(sahipBazli())
        const { captured, stub } = await renderHome()
        const st = captured.instance.setupState
        st.activeTab = 'assets'
        readStockBalancesMock.mockClear()

        hesapDegistir(stub)
        await st.onUserAddressChanged()

        expect(readStockBalancesMock).not.toHaveBeenCalled()
        expect(st.stockBalances).toEqual({})
    })

    it('hesap degisiminden ONCE baslayan yavas okuma sonradan donse de eski bakiye ekrana yazilmaz', async () => {
        let birak
        const kapi = new Promise((resolve) => { birak = resolve })
        readStockBalancesMock.mockImplementation(sahipBazli())
        const { captured, stub } = await renderHome()
        const st = captured.instance.setupState

        // Eski hesabin (A) tazelemesi kapida bekler.
        readStockBalancesMock.mockImplementation(sahipBazli({ [HESAP.address]: kapi }))
        readStockBalancesMock.mockClear()
        const eski = st.refreshStocks()
        await vi.waitFor(() => expect(readStockBalancesMock.mock.calls.some(([arg]) => arg.owner === HESAP.address)).toBe(true))

        hesapDegistir(stub)
        await st.onUserAddressChanged()
        await vi.waitFor(() => expect(st.stockBalances[tsla1()]?.balance).toBe(0n))
        birak()
        await eski

        expect(st.stockBalances[tsla1()].balance).toBe(0n)
    })

    it('hesap degisiminden ONCE baslayan yukleme eski hesabin hissesini YENI hesabin kovasina tohumlamaz', async () => {
        let birak
        const kapi = new Promise((resolve) => { birak = resolve })
        readStockBalancesMock.mockImplementation(sahipBazli())
        const { captured, stub } = await renderHome({ importedTokens: { acc1: { 1: [], 56: [] }, acc2: { 1: [], 56: [] } } })
        const st = captured.instance.setupState

        // Eski hesabin (A, 2.5 TSLAx sahibi) tam yuklemesi kapida bekler.
        readStockBalancesMock.mockImplementation(sahipBazli({ [HESAP.address]: kapi }))
        readStockBalancesMock.mockClear()
        const eski = st.loadBStockData()
        await vi.waitFor(() => expect(readStockBalancesMock.mock.calls.some(([arg]) => arg.owner === HESAP.address)).toBe(true))

        hesapDegistir(stub)
        await st.onUserAddressChanged()
        birak()
        await eski

        expect(stub.localStore.imported_tokens.acc2['1']).toEqual([])
    })

    it('eski yukleme biterken YENI hesabin bekleyen yuklemesinin sozu silinmez (tekil kalir)', async () => {
        let birakA
        let birakB
        const kapiA = new Promise((resolve) => { birakA = resolve })
        const kapiB = new Promise((resolve) => { birakB = resolve })
        readStockBalancesMock.mockImplementation(sahipBazli())
        const { captured, stub } = await renderHome()
        const st = captured.instance.setupState

        readStockBalancesMock.mockImplementation(sahipBazli({ [HESAP.address]: kapiA, [HESAP_B.address]: kapiB }))
        readStockBalancesMock.mockClear()
        const eski = st.loadBStockData()
        await vi.waitFor(() => expect(readStockBalancesMock.mock.calls.some(([arg]) => arg.owner === HESAP.address)).toBe(true))

        hesapDegistir(stub)
        await st.onUserAddressChanged()
        await vi.waitFor(() => expect(readStockBalancesMock.mock.calls.some(([arg]) => arg.owner === HESAP_B.address)).toBe(true))
        const sayB = () => readStockBalancesMock.mock.calls.filter(([arg]) => arg.owner === HESAP_B.address).length
        const once = sayB()

        birakA()
        await eski
        void st.loadBStockData() // B yuklemesi hala bekliyor: yeni okuma BASLATMAMALI
        await new Promise((resolve) => setTimeout(resolve, 30))

        expect(sayB()).toBe(once)
        birakB()
    })
})

describe('Home.vue (SSR) - Hisseler: ag cipleri', () => {
    const cipler = (html) => (govdeOf(html).match(/<button[^>]*data-stock-chip[^>]*>[\s\S]*?<\/button>/g) || [])
    const cipMetni = (cip) => cip.replace(/<[^>]*>/g, '').trim()
    const basliklar = (html) => (govdeOf(html).match(/<div[^>]*data-stock-group-header[^>]*>[\s\S]*?<\/div>/g) || [])

    it('bayrak acik: Tumu + Ethereum, BSC, Arbitrum sirasiyla; button + aria-pressed', async () => {
        const { html } = await renderHome({ chain: POLYGON_CHAIN, chip: null })
        const hepsi = cipler(html)

        expect(hepsi.map(cipMetni)).toEqual(['All', 'Ethereum', 'BNB Smart Chain', 'Arbitrum One'])
        expect(hepsi.every((c) => c.startsWith('<button') && c.includes('aria-pressed') && c.includes('type="button"'))).toBe(true)
        expect(hepsi[0]).toContain('aria-pressed="true"') // Polygon hissesiz -> Tumu
        expect(hepsi.slice(1).every((c) => c.includes('aria-pressed="false"'))).toBe(true)
        expect(basliklar(html)).toHaveLength(3)
    })

    it('ag cipleri: her ag cipinde yuvarlak ag logosu (dogru src, alt = ag adi); Tumu cipinde logo yok', async () => {
        const { html } = await renderHome({ chain: POLYGON_CHAIN, chip: null })
        const hepsi = cipler(html)

        expect(hepsi[0]).not.toContain('<img')
        for (const [i, id] of [1, 56, 42161].entries()) {
            const cip = hepsi[i + 1]
            expect(cip.match(/<img/g)).toHaveLength(1)
            expect(cip).toContain(`src="${chainLogo(id)}"`)
            expect(cip).toMatch(/alt="[^"]+"/)
            expect(cip).toContain('w-4 h-4 rounded-full')
        }
    })

    it('Turkce: Tumu anahtari tr dilinde', async () => {
        const { html } = await renderHome({ chain: POLYGON_CHAIN, locale: 'tr', chip: null })

        expect(cipMetni(cipler(html)[0])).toBe('Tümü')
    })

    it('baslangic secimi aktif ag hisseliyse o ag: yalniz o agin bolumu', async () => {
        const { html } = await renderHome({ chain: BSC_CHAIN, chip: null })

        expect(cipler(html)[2]).toContain('aria-pressed="true"')
        expect(basliklar(html)).toHaveLength(1)
        expect(satirlar(html, 'GOOGL')).toHaveLength(1)
        expect(satirlar(html, 'MSTR')).toHaveLength(1) // yalniz BSC kopyasi
    })

    it('Tumu secili: tum bolumler, aktif ag hisseli olsa bile', async () => {
        const { html } = await renderHome({ chain: BSC_CHAIN, chip: 'all' })

        expect(basliklar(html)).toHaveLength(3)
        expect(cipler(html)[0]).toContain('aria-pressed="true"')
    })

    it('cip secimi listeyi suzer ama aktif agi DEGISTIRMEZ (ag gecisi cagrisi yok)', async () => {
        const { html } = await renderHome({ chain: ETH_CHAIN, chip: 42161 })

        expect(basliklar(html)).toHaveLength(1)
        expect(govdeOf(html)).toContain('Arbitrum One')
        expect(satirlar(html, 'GOOGL')).toHaveLength(0)
        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(networkStore().currentNetwork.chainId).toBe(1)
    })

    it('cip tiklamasi YALNIZ secimi yazar (kaynak kilidi: ag degistirme cagrisi yok)', () => {
        const kaynak = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8')
        const blok = kaynak.match(/<button[^>]*data-stock-chip[\s\S]*?>/)[0]

        expect(blok).toContain('@click="stockChipChoice = chip"')
    })

    it('satira basinca secim dondurulur: Tumu iken ag gecince filtre yeni aga KAYMAZ', async () => {
        const { captured } = await renderHome({ chain: POLYGON_CHAIN, chip: null })
        const st = captured.instance.setupState
        expect(st.stockChipSelected).toBe('all')

        await st.openStock(stockEntry(56, TSLA.address))

        expect(st.stockChipChoice).toBe('all')
    })
})

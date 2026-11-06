// Bayrak matrisi (T16, spec 9): `XSTOCKS_ENABLED` KAPALI ve ACIK iken hisse yuzeylerinin TAMAMI tek dosyada,
// ayni sorgularla. Tek tek yuzey testleri (HomeXStocks*, StockDetail*, StockTrade*, IssuerSwitch*) ayrintiyi
// kilitler; bu dosya "hangi bayrakta hangi yuzey nasil" TABLOSUNU kilitler: bir yuzeyin bayrak davranisi
// degisirse burasi kirilir.
//
// Bayrak `featureFlags` mock'unda CANLI bir getter'dir (`flag.on`): her kullanim anında okundugu icin ayni dosyada
// iki durum sirayla kosulur (modulleri yeniden yuklemeye gerek yok).
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const flag = vi.hoisted(() => ({ on: false }))
vi.mock('../../utils/featureFlags', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, get XSTOCKS_ENABLED() { return flag.on } }
})

vi.mock('../../composables/useSolanaAssets', () => ({ useSolanaAssets: async () => [] }))
vi.mock('../../composables/useTokenBalance', () => ({ useTokenBalance: async () => 1000 }))
vi.mock('../../utils/applyNetworkChange', () => ({ applyNetworkChange: async () => true }))

const readStockBalancesMock = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../../utils/stockBalances', async (importOriginal) => ({
    ...(await importOriginal()),
    readStockBalances: (...a) => readStockBalancesMock.fn(...a),
    ensureMultipliersFor: async () => {},
}))

const axiosMock = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({
    default: { post: (...a) => axiosMock.post(...a), get: async () => ({ status: 200, data: { news: [] } }) },
}))

// loadGroupBalances: detay testlerinde `override` ile kontrollu; yoksa GERCEK govde (Home da bunu kullanir).
const groupBalMock = vi.hoisted(() => ({ override: null }))
vi.mock('../../utils/stocksTab', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, loadGroupBalances: (...a) => (groupBalMock.override ? groupBalMock.override(...a) : actual.loadGroupBalances(...a)) }
})
vi.mock('../../utils/stocks/marketStatus', () => ({ fetchMarketStatus: async () => null }))

vi.mock('../CryptoChart.vue', async () => {
    const { h } = await import('vue')
    return { default: { name: 'CryptoChart', props: ['id', 'days', 'divisor'], setup: () => () => h('div', { 'data-chart': '' }) } }
})

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import { pageStore } from '../../store/pageStore'
import { ALL_CHAINS } from '../../data/chains'
import { BSTOCKS } from '../../data/bStocks'
import { XSTOCKS } from '../../data/xStocks'
import supported_chains from '../../data/supported_chains.json'
import {
    stockKey, isBridgeBlocked, isBridgeTargetBlocked, isGeneralSwapExcluded, stockImportIdentity,
} from '../../utils/tokenizedStocks'
import { stockEntryForRef } from '../../utils/stocks/stockRoute'
import { tradeEnabledFor } from '../../utils/stocks/engines'
import { companyRows, issuerOptions } from '../../utils/stocks/stockCompanies'
import Home from '../Home.vue'
import StockDetail from './StockDetail.vue'
import StockTrade from './StockTrade.vue'

const HERE = dirname(fileURLToPath(import.meta.url))
const HESAP = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }
const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const chainOf = (id) => supported_chains.find((c) => c.chainId === id)
const E18 = 10n ** 18n

// TSLA: iki ihracci da var (bStocks BSC, xStocks Ethereum/BSC...). Zincirleri katalogdan.
const B_TSLA = BSTOCKS.find((b) => b.underlying === 'TSLA')
const X_TSLA = XSTOCKS.find((x) => x.underlying === 'TSLA')
const X_CHAIN = X_TSLA.chains.includes(1) ? 1 : X_TSLA.chains[0]
// Cifti OLMAYAN bir sirket: yalniz bStocks'ta var.
const B_SOLO = BSTOCKS.find((b) => !XSTOCKS.some((x) => x.underlying === b.underlying))

const bRef = { id: B_TSLA.coingecko_id, chainId: 56, address: B_TSLA.address, decimals: B_TSLA.decimals, symbol: B_TSLA.symbol }
const xRef = { id: X_TSLA.coingecko_id, chainId: X_CHAIN, address: X_TSLA.address, decimals: X_TSLA.decimals, symbol: X_TSLA.symbol }

let tablo = {}
let kayitlar = []

beforeEach(() => {
    tablo = {}
    kayitlar = []
    readStockBalancesMock.fn.mockReset()
    readStockBalancesMock.fn.mockImplementation(async ({ chainId, entries }) => new Map(entries.map((e) => [
        e.address.toLowerCase(),
        tablo[stockKey(chainId, e.address)] ?? { balance: 0n, multiplier: e.issuer === 'xstocks' ? E18 : null },
    ])))
    groupBalMock.override = null
    axiosMock.post.mockReset()
    axiosMock.post.mockImplementation(async () => ({ status: 200, data: { tokens: kayitlar } }))
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    flag.on = false
    delete globalThis.chrome
})

// ---- yuzey yardimcilari -------------------------------------------------------------------------------------

async function homeStocks({ chain = chainOf(1), locale = 'en' } = {}) {
    installChromeStub({ currentNetwork: chain, active_account: HESAP, imported_tokens: {}, vaults: [] })
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    networkStore().currentNetwork = chain
    const captured = captureInstance(app, 'Home', (instance) => {
        instance.setupState.activeTab = 'stocks'
        instance.setupState.stockChipChoice = 'all'
    })
    const html = clean(await render(app))
    return { html, captured }
}

async function detail(ref, { locale = 'en' } = {}) {
    installChromeStub({ active_account: HESAP })
    const app = createApp(StockDetail)
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === ref.chainId)
    cryptoStore().selected_token_ref = ref
    pageStore().currentPage = 'token'
    return clean(await render(app))
}

async function trade(ref) {
    const { setSendMessage } = installChromeStub({ active_account: { ...HESAP, type: 'imported', key: 'a' } })
    const spy = vi.fn(async () => ({}))
    setSendMessage(spy)
    const app = createApp(StockTrade)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === ref.chainId)
    cryptoStore().selected_token_ref = ref
    return { html: clean(await render(app)), spy }
}

const tickers = (html) => html.match(/data-stock-ticker/g) ?? []
const rowsOf = (html, ticker) => html.match(
    new RegExp(`<button[^>]*>(?:(?!<\\/button>)[\\s\\S])*?data-stock-ticker[^>]*>${ticker}<\\/span>[\\s\\S]*?<\\/button>`, 'g'),
) ?? []

// ---- matris -------------------------------------------------------------------------------------------------

describe('Bayrak matrisi -- Hisseler sekmesi', () => {
    it('KAPALI: yalniz BSC grubu, 22 satir; chip, grup basligi, ag logosu, bakiye etiketi, xStock YOK', async () => {
        flag.on = false
        tablo[stockKey(56, B_TSLA.address)] = { balance: 3n * E18, multiplier: null }
        const { html, captured } = await homeStocks()

        expect(captured.instance.setupState.stockGroups.map((g) => g.chainId)).toEqual([56])
        expect(tickers(html)).toHaveLength(BSTOCKS.length)
        expect(html).not.toContain('data-stock-chip')
        expect(html).not.toContain('data-stock-group-header')
        expect(html).not.toContain('data-stock-chain-logo')
        expect(html).not.toContain('data-stock-balance')
        expect(html).not.toContain('xStocks')
        for (const x of XSTOCKS) expect(html, x.symbol).not.toContain(x.symbol)
        // Fiyat istegi yalniz bStocks kimlikleri
        const fiyat = axiosMock.post.mock.calls.find(([url, body]) => String(url).includes('/getTokensDataById') && body?.ids?.length)
        expect(fiyat[1].ids.some((id) => id.endsWith('-xstock'))).toBe(false)
    })

    it('ACIK: ag gruplari + chip + grup basligi + ag logosu + bakiye etiketi; BSC cifti TEK satir', async () => {
        flag.on = true
        tablo[stockKey(56, B_TSLA.address)] = { balance: 3n * E18, multiplier: null }
        const { html, captured } = await homeStocks()
        const gruplar = captured.instance.setupState.stockGroups

        expect(gruplar.length).toBeGreaterThan(1)
        expect(gruplar.map((g) => g.chainId)).toContain(56)
        expect(gruplar.map((g) => g.chainId)).toContain(1)
        expect(html).toContain('data-stock-chip')
        expect(html).toContain('data-stock-group-header')
        expect(html).toContain('data-stock-chain-logo')
        expect(html).toContain('data-stock-balance')

        const bsc = captured.instance.setupState.visibleStockGroups.find((g) => g.chainId === 56)
        const tsla = bsc.rows.filter((c) => c.underlying === 'TSLA')
        expect(tsla).toHaveLength(1)
        expect(tsla[0].options.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks'])
        // Ayni sirket ag basina ayri satir (S3): satir sayisi = sirketin ayri zincir sayisi
        const zincirler = new Set(X_TSLA.chains).add(56)
        expect(rowsOf(html, 'TSLA')).toHaveLength(zincirler.size)
    })

    for (const on of [false, true]) {
        it(`${on ? 'ACIK' : 'KAPALI'}: ihracci rozeti ve ihracci adli dipnotlar HICBIR satirda/dipnotta yok; isimsiz sertifika notu var`, async () => {
            flag.on = on
            kayitlar = [{ coingecko_id: B_TSLA.coingecko_id, image: { large: 'x' }, price_source: 'atlas', price_updated_at: new Date().toISOString(), market_data: { priceUSD: 250, change: { h24: 1 } } }]
            const { html } = await homeStocks()

            expect(html).not.toMatch(/>\s*(b|x)Stocks\s*<\/span>/)
            expect(html).not.toContain('data-issuer-badge')
            expect(html).not.toContain('BTech')
            expect(html).not.toContain('Backed')
            expect(html).not.toMatch(/\bTSLA[bBxX]\b/)
            expect(text(html)).toContain('certificates over shares')
            expect(text(html)).toContain('Atlas Oracle')
        })
    }

    it('KAPALI: satira basinca ag gecisi yok, detay bStock ile acilir; ACIK: temsilci secilir', async () => {
        flag.on = false
        const kapali = await homeStocks()
        await kapali.captured.instance.setupState.openStock(kapali.captured.instance.setupState.visibleStockGroups[0].rows.find((c) => c.underlying === 'TSLA'))
        expect(cryptoStore().selected_token_ref.chainId).toBe(56)
        expect(pageStore().currentPage).toBe('token')

        flag.on = true
        const acik = await homeStocks({ chain: chainOf(56) })
        const bsc = acik.captured.instance.setupState.visibleStockGroups.find((g) => g.chainId === 56)
        await acik.captured.instance.setupState.openStock(bsc.rows.find((c) => c.underlying === 'TSLA'))
        expect(cryptoStore().selected_token_ref.chainId).toBe(56)
        expect(pageStore().currentPage).toBe('token')
    })
})

describe('Bayrak matrisi -- hisse detayi ve yonlendirme', () => {
    it('yonlendirme: bStock HER ZAMAN StockDetail; xStock yalniz bayrak ACIKKEN (kapaliyken duz Token)', () => {
        flag.on = false
        expect(stockEntryForRef(bRef)?.issuer).toBe('bstocks')
        expect(stockEntryForRef(xRef)).toBeNull()
        flag.on = true
        expect(stockEntryForRef(bRef)?.issuer).toBe('bstocks')
        expect(stockEntryForRef(xRef)?.issuer).toBe('xstocks')
    })

    it('App.vue: token sayfasi isStockPage ile StockDetail/Token ayrilir; stock_trade bayraga bakmaz, yalniz gizli mod kapaliyken baglanir', () => {
        const src = yorumsuz(readFileSync(resolve(HERE, '../../popup/App.vue'), 'utf8'))
        expect(src).toMatch(/<StockDetail v-if="page\.currentPage === 'token' && isStockPage"/)
        expect(src).toMatch(/<Token v-if="page\.currentPage === 'token' && !isStockPage"/)
        expect(src).toMatch(/<StockTrade v-if="!privacy\.active && page\.currentPage === 'stock_trade'"/)
        expect(src).not.toContain('XSTOCKS_ENABLED')
    })

    for (const on of [false, true]) {
        it(`${on ? 'ACIK' : 'KAPALI'}: bStock detayi -- Al/Sat/Gonder/Yatir, Hisse bilgileri'nde ihracci adi, Kopru/Takas yok`, async () => {
            flag.on = on
            kayitlar = [{ coingecko_id: B_TSLA.coingecko_id, image: { large: 'x' }, market_data: { priceUSD: 250, change: { h24: 1 } } }]
            groupBalMock.override = async () => ({ [stockKey(56, B_TSLA.address)]: { status: 'ok', balance: E18, multiplier: null } })
            const html = await detail(bRef)
            const t = text(html)

            expect(html).toContain('data-stock-detail')
            for (const k of ['data-stock-buy', 'data-stock-sell', 'data-stock-send', 'data-stock-deposit']) expect(html, k).toContain(k)
            expect(t).toContain('Stock info')
            expect(t).toContain('Binance (bStocks)')
            expect(html).not.toContain('data-issuer-badge')
            for (const w of ['bridge', 'swap', 'köprü', 'takas']) expect(t.toLowerCase(), w).not.toContain(w)
        })
    }

    it('ACIK: xStock detayi StockDetail ile cizilir, ihracci adi (Backed) yalniz Hisse bilgileri kartinda', async () => {
        flag.on = true
        kayitlar = [{ coingecko_id: X_TSLA.coingecko_id, image: { large: 'x' }, market_data: { priceUSD: 250, change: { h24: 1 } } }]
        groupBalMock.override = async () => ({ [stockKey(X_CHAIN, X_TSLA.address)]: { status: 'ok', balance: E18, multiplier: E18 } })
        const html = await detail(xRef)

        expect(html).toContain('data-stock-detail')
        expect(html).toContain('data-stock-buy')
        expect(text(html)).toContain('Backed')
        expect(html).not.toContain('data-issuer-badge')
    })
})

describe('Bayrak matrisi -- Al/Sat ekrani (stock_trade)', () => {
    it('KAPALI: bStock ekrani ACIK (ana dugme var); xStock "kullanilamiyor", ana dugme ve mesaj yok', async () => {
        flag.on = false
        const b = await trade(bRef)
        expect(b.html).toContain('data-trade-primary')
        expect(b.html).not.toContain('not available')
        expect(b.html).toContain('data-pay-token="USDT"')

        const x = await trade(xRef)
        expect(x.html).toContain('not available')
        expect(x.html).not.toContain('data-trade-primary')
        expect(x.spy).not.toHaveBeenCalled()
    })

    it('ACIK: iki ihracci da acik (ana dugme var, "kullanilamiyor" yok)', async () => {
        flag.on = true
        for (const ref of [bRef, xRef]) {
            const r = await trade(ref)
            expect(r.html, ref.symbol).toContain('data-trade-primary')
            expect(r.html, ref.symbol).not.toContain('not available')
        }
    })

    it('tradeEnabledFor: bStocks her iki durumda acik, xStocks yalniz ACIKKEN', () => {
        flag.on = false
        expect(tradeEnabledFor(stockEntryForRef(bRef))).toBe(true)
        expect(tradeEnabledFor({ issuer: 'xstocks' })).toBe(false)
        flag.on = true
        expect(tradeEnabledFor(stockEntryForRef(bRef))).toBe(true)
        expect(tradeEnabledFor({ issuer: 'xstocks' })).toBe(true)
    })
})

describe('Bayrak matrisi -- ihracci secici', () => {
    it('KAPALI: cifti olan sirkette bile secici DOM da yok; secenek sayisi 1', async () => {
        flag.on = false
        expect(issuerOptions(stockEntryForRef(bRef))).toHaveLength(1)
        const { html } = await trade(bRef)
        expect(html).not.toContain('data-issuer-switch')
        expect(html).not.toContain('data-issuer-option')
    })

    it('ACIK: cift olan sirkette secici ve iki secenek; tek ihraccili sirkette yok', async () => {
        flag.on = true
        const { html } = await trade(bRef)
        expect(html).toContain('data-issuer-switch')
        expect(html).toContain('data-issuer-option="bstocks"')
        expect(html).toContain('data-issuer-option="xstocks"')

        expect(companyRows(B_SOLO.underlying)).toHaveLength(1)
        const solo = await trade({ id: B_SOLO.coingecko_id, chainId: 56, address: B_SOLO.address, decimals: B_SOLO.decimals, symbol: B_SOLO.symbol })
        expect(solo.html).not.toContain('data-issuer-switch')
    })
})

describe('Bayrak matrisi -- bayraktan bagimsiz koruyucu kapilar', () => {
    for (const on of [false, true]) {
        it(`${on ? 'ACIK' : 'KAPALI'}: kopru/takas dislamasi ve sahte hisse uyarisi ayni`, () => {
            flag.on = on
            // bStocks: kopru kaynagi kapali, hedef acik, genel Takas'ta kalir
            expect(isBridgeBlocked(56, B_TSLA.address)).toBe(true)
            expect(isBridgeTargetBlocked(56, B_TSLA.address)).toBe(false)
            expect(isGeneralSwapExcluded(56, B_TSLA.address)).toBe(false)
            // xStocks: her yonde kapali
            expect(isBridgeBlocked(X_CHAIN, X_TSLA.address)).toBe(true)
            expect(isBridgeTargetBlocked(X_CHAIN, X_TSLA.address)).toBe(true)
            expect(isGeneralSwapExcluded(X_CHAIN, X_TSLA.address)).toBe(true)
            // Katalog disi sahte xStock kontrati: kimlik VERILMEZ
            const sahte = stockImportIdentity({
                chainId: 8453, address: '0x0000000000000000000000000000000000000abc', symbol: 'TSLAx', name: 'Tesla xStock',
                backendToken: { image: 'i', chain: 'base', coingecko_id: 'tesla-xstock' },
            })
            expect(sahte.known).toBe(false)
            expect(sahte.coingecko_id).toBeNull()
        })
    }
})

describe('Bayrak matrisi -- uretim derlemesi: xStocks/Backed metni DOM da yok', () => {
    it('KAPALI: Hisseler sekmesi, bStock detayi ve bStock Al/Sat ekraninda "xStocks"/"Backed" gecmez (tr ve en)', async () => {
        flag.on = false
        kayitlar = [{ coingecko_id: B_TSLA.coingecko_id, image: { large: 'x' }, market_data: { priceUSD: 250, change: { h24: 1 } } }]
        for (const locale of ['en', 'tr']) {
            const home = (await homeStocks({ locale })).html
            const det = await detail(bRef, { locale })
            for (const [ad, html] of [['sekme', home], ['detay', det]]) {
                expect(html, `${ad}/${locale} xStocks`).not.toMatch(/xstocks?/i)
                expect(html, `${ad}/${locale} Backed`).not.toContain('Backed')
            }
        }
        const tr = (await trade(bRef)).html
        expect(tr).not.toMatch(/xstocks?/i)
        expect(tr).not.toContain('Backed')
    })

    it('ACIK: ayni ekranlarda xStocks gorunur (ters yon: test yanlis yesil vermiyor)', async () => {
        flag.on = true
        const tr = (await trade(bRef)).html
        expect(tr).toMatch(/xstocks/i)
    })
})

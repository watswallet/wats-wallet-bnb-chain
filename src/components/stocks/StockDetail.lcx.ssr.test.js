// StockDetail.vue -- LCX hisse satiri (Bolum 2, Gorev 11). LCX satiri CoinGecko kimligi tasimaz (coingeckoId null): grafik ve aralik secici
// YOK, fiyat satirin kendi priceUsd'si, kaynak "Chainlink (LCX)", guncelleme zamani satirin priceUpdatedAt'i, piyasa durumu satirin
// marketOpen'i (yalniz rozet: islem karari degil), ihracci adi `stockIssuer.<id>`. bStocks / xStocks detayi StockDetail.ssr.test.js'te DEGISMEDEN
// yesil kalir; burada yalniz LCX yolu ve statik yolun ortak noktalari olculur.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// LCX ve xStocks bayraklari bu dosyada ACIK (stockEntryForRef LCX satirini yalniz bayrak aciksa hisse ekranina verir).
vi.mock('../../utils/featureFlags', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, XSTOCKS_ENABLED: true, LCX_ENABLED: true }
})

const axiosMock = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({ default: { post: (...a) => axiosMock.post(...a) } }))

const balMock = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../../utils/stocksTab', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, loadGroupBalances: (...a) => balMock.fn(...a) }
})

// marketStatus GERCEK: LCX satirinin durumu satirdan okunur (ag yok); bStocks icin zaten null doner.
vi.mock('../CryptoChart.vue', async () => {
    const { h } = await import('vue')
    return {
        default: {
            name: 'CryptoChart',
            props: ['id', 'days', 'divisor'],
            setup: (p) => () => h('div', { 'data-chart': '', 'data-chart-id': p.id }),
        },
    }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { cryptoStore } from '../../store/crypto'
import { pageStore } from '../../store/pageStore'
import { networkStore } from '../../store/network'
import { stockKey, setLcxStockRows, lcxStockRows, _resetLcxStockRows } from '../../utils/tokenizedStocks'
import { ALL_CHAINS } from '../../data/chains'
import StockDetail from './StockDetail.vue'

const HERE = dirname(fileURLToPath(import.meta.url))
const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const OWNER = '0xAbCdEf0000000000000000000000000000000001'

// Sunucunun /lcx/stocks satir bicimi (tokenizedStocks.lcx.test.js ile ayni fikstur).
const TSLAC = {
    chainId: 8453, address: '0xb2000000000000000000001e800a7f5189430cD0', symbol: 'TSLAC', name: 'Tesla (Coinbase Tokenized Stocks)', decimals: 8,
    issuer: 'coinbase', underlying: 'TSLA', category: 'stocks', priceUsd: 388.61280861, priceSource: 'Chainlink Coinbase TSLA on Base',
    priceUpdatedAt: 1795071867, marketHours: 'us_equities', depthUsd: 252144.395038,
}
const GMEON = {
    chainId: 56, address: '0xdABb9afF4cf02f26D2014e4cA9f94aC6fe6572a3', symbol: 'GMEON', name: 'GameStop (Ondo Tokenized Stock)', decimals: 18,
    issuer: 'ondo', underlying: 'GME', category: 'stocks', priceUsd: 27.02, priceSource: 'Chainlink', priceUpdatedAt: 1795032524,
    marketHours: 'us_equities', depthUsd: 42234.2,
}
const OK = Object.freeze({ decision: 'OK', reason: 'OK', ipCountry: null })
// ssrRender'in varsayilan STOCK_GATE_STATUS yaniti yalniz bstocks / xstocks tasir; coinbase / ondo satiri icin tabloda da OLMALI.
const ELIGIBLE = Object.freeze({ bstocks: OK, xstocks: OK, coinbase: OK, ondo: OK })

function setup({ raw = TSLAC, usEquitiesOpen = true, balances = {}, locale = 'en' } = {}) {
    setLcxStockRows([raw], { usEquitiesOpen })
    const row = lcxStockRows()[0]
    installChromeStub({ active_account: { address: OWNER, key: 'acc1' } }, { eligibility: ELIGIBLE })
    axiosMock.post = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
    balMock.fn = vi.fn(async () => balances)
    const app = createApp(StockDetail)
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === row.chainId)
    cryptoStore().selected_token_ref = { id: null, chainId: row.chainId, address: row.address, decimals: row.decimals, symbol: row.symbol }
    pageStore().currentPage = 'token'
    return { app, row }
}
const mount = async (opts) => clean(await render(setup(opts).app))
const held = (row, units) => ({
    [stockKey(row.chainId, row.address)]: { status: 'ok', balance: BigInt(Math.round(units * 1e6)) * 10n ** BigInt(row.decimals - 6), multiplier: null },
})

afterEach(() => {
    delete globalThis.chrome
    _resetLcxStockRows()
})

describe('StockDetail.vue -- LCX satiri: grafik yok (Gorev 11, test 1)', () => {
    it('grafik blogu, aralik secici ve "fiyat gecmisi yok" / "yukleniyor" metni CIZILMEZ (Base, tek secenek)', async () => {
        const html = await mount()
        expect(html).toContain('data-stock-detail')
        expect(html).not.toContain('data-chart')
        expect(html).not.toMatch(/data-range=/)
        const t = text(html)
        expect(t).not.toContain('No price history')
        expect(t).not.toContain('Loading chart')
        for (const k of ['1W', '1M', '3M', '1Y']) expect(t).not.toContain(k)
    })

    it('ayni zincirde grafikli bir bStocks kardesi olsa da LCX satirinin ekraninda grafik yok (BSC GME: bStocks + Ondo)', async () => {
        const html = await mount({ raw: GMEON })
        expect(html).not.toContain('data-chart')
        expect(html).not.toMatch(/data-range=/)
        expect(text(html)).not.toContain('No price history')
    })

    it('kimlik tasimayan satir icin sunucuya kimlik istegi ATILMAZ (tek secenek)', async () => {
        const { app } = setup()
        await render(app)
        expect(axiosMock.post).not.toHaveBeenCalled()
    })
})

describe('StockDetail.vue -- LCX satiri: fiyat, kaynak, guncelleme zamani (test 2)', () => {
    it('fiyat satirdan; "Price: Chainlink (LCX)"; "Updated <zaman>" priceUpdatedAt ile', async () => {
        const html = await mount()
        const t = text(html)
        expect(t).toContain('$388.61')
        expect(html).toMatch(/data-stock-source[^>]*>[^<]*Price: Chainlink \(LCX\)/)
        const beklenen = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(1795071867 * 1000))
        expect(t).toContain(`Updated ${beklenen.replace(/\s+/g, ' ')}`)
        expect(html).toContain('data-stock-updated')
    })

    it('tr dilinde "Güncellendi: <zaman>" ve fiyat kaynagi', async () => {
        const html = await mount({ locale: 'tr' })
        const beklenen = new Intl.DateTimeFormat('tr', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(1795071867 * 1000))
        expect(text(html)).toContain(`Güncellendi: ${beklenen.replace(/\s+/g, ' ')}`)
        expect(text(html)).toContain('Chainlink (LCX)')
    })

    it('priceUpdatedAt yoksa guncelleme satiri YOK ama kaynak ve fiyat var', async () => {
        const html = await mount({ raw: { ...TSLAC, priceUpdatedAt: null } })
        expect(html).not.toContain('data-stock-updated')
        expect(text(html)).not.toContain('Updated')
        expect(text(html)).toContain('Price: Chainlink (LCX)')
        expect(text(html)).toContain('$388.61')
    })

    it('priceUpdatedAt Date araligini asan sonlu sayi (1e18): ekran COKMEZ, guncelleme satiri YOK, fiyat ve kaynak var', async () => {
        for (const priceUpdatedAt of [1e18, Number.MAX_VALUE]) {
            const html = await mount({ raw: { ...TSLAC, priceUpdatedAt } })
            expect(html, String(priceUpdatedAt)).not.toContain('data-stock-updated')
            expect(text(html)).not.toContain('Updated')
            expect(text(html)).toContain('Price: Chainlink (LCX)')
            expect(text(html)).toContain('$388.61')
        }
    })

    it('24s degisim rozeti yok (LCX satirinda degisim verisi yok)', async () => {
        expect(await mount()).not.toContain('data-stock-change')
    })

    it('tutulan LCX pozisyonu satir fiyatiyla degerlenir (tire degil): 2 adet -> $777.23', async () => {
        const { app, row } = setup()
        balMock.fn = vi.fn(async () => held(row, 2))
        const t = text(clean(await render(app)))
        expect(t).toContain('2.0000 shares')
        expect(t).toContain('$777.23')
    })
})

describe('StockDetail.vue -- LCX satiri: piyasa durumu rozeti (test 3)', () => {
    it('us_equities + ABD borsasi kapali -> "Market closed" rozeti', async () => {
        const html = await mount({ usEquitiesOpen: false })
        expect(html).toContain('data-stock-market')
        expect(text(html)).toContain('Market closed')
    })

    it('us_equities + acik -> "Market open"', async () => {
        const html = await mount({ usEquitiesOpen: true })
        expect(text(html)).toContain('Market open')
    })

    it('always (7/24) -> rozet YOK (ABD borsasi kapali olsa da)', async () => {
        for (const usEquitiesOpen of [false, true]) {
            const html = await mount({ raw: { ...TSLAC, marketHours: 'always' }, usEquitiesOpen })
            expect(html).not.toContain('data-stock-market')
            expect(text(html)).not.toContain('Market')
        }
    })
})

describe('StockDetail.vue -- LCX satiri: ihracci adi (test 4)', () => {
    it('bilgi kartinda ihracci "Coinbase" (stockIssuer.coinbase); bStocks / xStocks ihracci metni, ISIN ve kart baglantisi YOK', async () => {
        const html = await mount()
        const t = text(html)
        expect(t).toMatch(/Issuer Coinbase/)
        expect(t).not.toContain('Binance')
        expect(t).not.toContain('Backed')
        expect(t).not.toContain('ISIN')
        expect(html).not.toContain('data-stock-issuer-note')
        // Salt okunur kart yalniz bStocks / xStocks icin var; LCX blogunda olu baglanti cizilmez.
        expect(html).not.toContain('data-stock-card-open')
        expect(t).toContain('Base')
        expect(html).toContain('data-stock-copy')
    })

    it('Ondo (BSC): ihracci "Ondo"; bilgi kartinda tek blok (tutulan yok)', async () => {
        const html = await mount({ raw: GMEON })
        expect(text(html)).toMatch(/Issuer Ondo/)
        expect(html.match(/data-stock-copy/g)).toHaveLength(1)
    })

    it('tr dilinde de ihracci adi', async () => {
        expect(text(await mount({ locale: 'tr' }))).toMatch(/İhraççı Coinbase/)
    })

    it('Al / Sat alt cubugu cizilir (uygun ihracci varsa Al etkin); sertifika notu yerinde', async () => {
        const html = await mount()
        expect(html).toContain('data-stock-sell')
        expect(html).toContain('data-stock-cert')
    })
})

describe('StockDetail.vue -- kaynak kilitleri (test 7)', () => {
    const RAW = readFileSync(resolve(HERE, 'StockDetail.vue'), 'utf8')
    const src = yorumsuz(RAW)

    it('Vue dosyasinda ihracci kimligi karsilastirmasi yok; dallanma model yardimcilariyla (isLcxRow / hasChart)', () => {
        expect(src).not.toMatch(/\.issuer\s*[!=]==?\s*'/)
        expect(src).not.toMatch(/\.source\s*[!=]==?\s*'lcx'/)
        expect(src).toContain('hasChart(')
    })

    it('grafik ve aralik secici TEK <template v-if="chartShown"> icinde (ofsetler yorumsuz kaynakla ayni); LCX kaynak etiketi tablosu', () => {
        const bas = RAW.indexOf('<!-- 3-4. Grafik')
        const son = RAW.indexOf('<!-- 5. Pozisyon')
        expect(bas).toBeGreaterThan(0)
        expect(son).toBeGreaterThan(bas)
        const govde = src.slice(bas, son)
        expect(govde.match(/<template v-if="chartShown">/g)).toHaveLength(1)
        expect(govde.indexOf('<CryptoChart')).toBeGreaterThan(govde.indexOf('<template v-if="chartShown">'))
        expect(govde.indexOf('data-range')).toBeGreaterThan(govde.indexOf('<CryptoChart'))
        expect(govde.indexOf('</template>')).toBeGreaterThan(govde.indexOf('data-range'))
        expect(src).toContain('const chartShown = computed(() => hasChart(entry.value))')
        expect(src).toContain("lcx: 'Chainlink (LCX)'")
    })
})

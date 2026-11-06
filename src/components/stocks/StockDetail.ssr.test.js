// StockDetail.vue (T7): hisse detay UI'si (eylemsiz). Ekran hesap yapmaz; yalniz gosterir.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// xStock detayi bayrak arkasinda: testte acik.
vi.mock('../../utils/featureFlags', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, XSTOCKS_ENABLED: true }
})

const axiosMock = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({ default: { post: (...a) => axiosMock.post(...a) } }))

const balMock = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../../utils/stocksTab', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, loadGroupBalances: (...a) => balMock.fn(...a) }
})

const marketMock = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../../utils/stocks/marketStatus', () => ({ fetchMarketStatus: (...a) => marketMock.fn(...a) }))

vi.mock('../CryptoChart.vue', async () => {
    const { h } = await import('vue')
    return {
        default: {
            name: 'CryptoChart',
            props: ['id', 'days', 'divisor'],
            setup: (p) => () => h('div', {
                'data-chart': '',
                'data-chart-id': p.id,
                'data-chart-days': String(p.days),
                'data-chart-divisor': p.divisor === undefined ? 'undef' : String(p.divisor),
            }),
        },
    }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { cryptoStore } from '../../store/crypto'
import { pageStore } from '../../store/pageStore'
import { networkStore } from '../../store/network'
import { currencyStore } from '../../store/currency'
import { companyRows } from '../../utils/stocks/stockCompanies'
import { stockKey } from '../../utils/tokenizedStocks'
import { ALL_CHAINS } from '../../data/chains'
import StockDetail from './StockDetail.vue'

const HERE = dirname(fileURLToPath(import.meta.url))
const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const rows = companyRows('AAPL', { xstocksEnabled: true })
const BS = rows.find((r) => r.issuer === 'bstocks') // BSC 56
const XS = rows.find((r) => r.issuer === 'xstocks') // Ethereum 1
const OWNER = '0xAbCdEf0000000000000000000000000000000001'
const ONE = 10n ** 18n

const record = (row, priceUSD, h24 = 1.5, extra = {}) => ({
    coingecko_id: row.coingeckoId,
    image: { large: 'https://img.test/' + row.coingeckoId + '.png' },
    market_data: { priceUSD, change: { h24 } },
    ...extra,
})

function setup({ row = BS, records, balances = {}, market = null, locale = 'en', hazirla } = {}) {
    installChromeStub({ active_account: { address: OWNER, key: 'acc1' } })
    axiosMock.post = vi.fn(async () => ({ status: 200, data: { tokens: records ?? [record(row, 250)] } }))
    balMock.fn = vi.fn(async () => balances)
    marketMock.fn = vi.fn(async () => market)
    const app = createApp(StockDetail)
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    hazirla?.(currencyStore())
    networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === row.chainId)
    cryptoStore().selected_token_ref = { id: row.coingeckoId, chainId: row.chainId, address: row.address, decimals: row.decimals, symbol: row.symbol }
    pageStore().currentPage = 'token'
    return app
}
const mount = async (opts) => clean(await render(setup(opts)))
const held = (row, units, multiplier = null) => ({
    [stockKey(row.chainId, row.address)]: { status: 'ok', balance: BigInt(Math.round(units * 1e6)) * 10n ** 12n, multiplier },
})

afterEach(() => { delete globalThis.chrome })

describe('StockDetail.vue -- baslik ve fiyat', () => {
    it('sirket adi, ticker, logo ve fiyat/degisim rozeti', async () => {
        const html = await mount({ records: [record(BS, 248.31, 1.42)] })
        const t = text(html)
        expect(html).toContain('data-stock-detail')
        expect(t).toContain(BS.name)
        expect(t).toContain('AAPL')
        expect(t).toContain('$248.31')
        expect(t).toContain('1.42%')
        expect(html).toContain('data-stock-logo')
    })

    it('taze atlas kaynagi ozel ad olarak yazilir (atlas -> Atlas); bayat atlas ve coingecko etiketsiz (B2)', async () => {
        const atlas = await mount({ records: [record(BS, 100, 1, { price_source: 'atlas', price_updated_at: new Date().toISOString() })] })
        expect(text(atlas)).toContain('Price: Atlas')
        expect(text(atlas)).not.toContain('Price: atlas')
        const stale = await mount({ records: [record(BS, 100, 1, { price_source: 'atlas', price_updated_at: new Date(Date.now() - 6 * 3600000).toISOString() })] })
        expect(text(stale)).not.toContain('Price:')
        const cg = await mount({ records: [record(BS, 100, 1, { price_source: 'coingecko', price_updated_at: new Date().toISOString() })] })
        expect(text(cg)).not.toContain('Price:')
    })

    it('negatif degisim kirmizi rozet, pozitif yesil', async () => {
        const down = await mount({ records: [record(BS, 100, -2.5)] })
        expect(down).toMatch(/data-stock-change[^>]*rose/)
        expect(text(down)).toContain('2.50%')
        const up = await mount({ records: [record(BS, 100, 2.5)] })
        expect(up).toMatch(/data-stock-change[^>]*emerald/)
    })

    it('fiyat kaynagi etiketi varsa fiyatin altinda', async () => {
        const html = await mount({ records: [record(BS, 100, 1, { price_source: 'atlas', price_updated_at: new Date().toISOString() })] })
        expect(text(html)).toContain('Price: Atlas')
        const none = await mount({ records: [record(BS, 100, 1)] })
        expect(text(none)).not.toContain('Price:')
    })

    it('fiyat yok -> tire, $0.00 YAZILMAZ; Al/Sat acik kalir', async () => {
        const html = await mount({ records: [] })
        expect(text(html)).not.toContain('$0.00')
        expect(html).toMatch(/data-stock-price[^>]*>\s*(—|-)\s*</)
        expect(html).toContain('data-stock-buy')
        expect(html).not.toMatch(/<button[^>]*data-stock-buy[^>]*disabled/)
    })

    it('xStock fiyati carpana bolunur (ham fiyat gosterilmez)', async () => {
        const html = await mount({ row: XS, records: [record(XS, 400)], balances: held(XS, 1, 2n * ONE) })
        expect(text(html)).toContain('$200.00')
    })
})

// Para birimi (Plan B Gorev 12): fiyat 'price' stilinde, pozisyon degeri 'standard' stilinde, ikisi de secili birimde.
describe('StockDetail.vue -- para birimi', () => {
    // Bosluklu biciler dilde nbsp (U+00A0) / dar nbsp (U+202F) kullanir; SSR "<" isaretini &lt; yazar.
    const norm = (s) => s.replace(/[\u00a0\u202f]/g, ' ').replace(/&lt;/g, '<')
    const tazeKur = (rates) => {
        const now = Date.now()
        return { rates, currencies: [], updatedAt: now, stale: false, fetchedAt: now }
    }
    const tl = (store) => { store.code = 'try'; store.snapshot = tazeKur({ try: 40 }) }
    const kurYok = (store) => { store.code = 'try'; store.snapshot = null }
    const fiyatMetni = (html) => norm((html.match(/<h1[^>]*data-stock-price[^>]*>([^<]*)<\/h1>/) ?? [])[1] ?? 'YOK')
    const pozisyonMetni = (html) => norm((html.match(/<div[^>]*data-stock-position-usd[^>]*>([^<]*)<\/div>/) ?? [])[1] ?? 'YOK')

    it('varsayilan USD: fiyat "$250.00", pozisyon degeri "$312.50"', async () => {
        const html = await mount({ records: [record(BS, 250)], balances: held(BS, 1.25) })
        expect(fiyatMetni(html)).toBe('$250.00')
        expect(pozisyonMetni(html)).toBe('$312.50')
    })

    it('try / kur 40 / tr: fiyat "₺10.000,00", pozisyon "₺12.500,00", "$" yok', async () => {
        const html = await mount({ locale: 'tr', hazirla: tl, records: [record(BS, 250)], balances: held(BS, 1.25) })
        expect(fiyatMetni(html)).toBe('₺10.000,00')
        expect(pozisyonMetni(html)).toBe('₺12.500,00')
        expect(text(html)).not.toContain('$')
    })

    it('kur yok (secili try, tablo yok): "USD 250.00" kod etiketli, "₺" asla', async () => {
        const html = await mount({ hazirla: kurYok, records: [record(BS, 250)], balances: held(BS, 1.25) })
        expect(fiyatMetni(html)).toBe('USD 250.00')
        expect(pozisyonMetni(html)).toBe('USD 312.50')
        expect(html).not.toContain('₺')
    })

    it('fiyat "price" stili: kucuk fiyat sifira yuvarlanmaz ("$0.0042", "<$0.000001")', async () => {
        expect(fiyatMetni(await mount({ records: [record(BS, 0.0042)] }))).toBe('$0.0042')
        expect(fiyatMetni(await mount({ records: [record(BS, 0.0000005)] }))).toBe('<$0.000001')
    })

    it('fiyat yok: fiyat ve pozisyon degeri "—" kalir, "$0.00" / "₺0,00" / NaN yazilmaz', async () => {
        for (const opts of [{}, { hazirla: tl, locale: 'tr' }]) {
            const html = await mount({ records: [], balances: held(BS, 1), ...opts })
            expect(fiyatMetni(html)).toBe('—')
            expect(pozisyonMetni(html)).toBe('—')
            expect(text(html)).not.toMatch(/0[.,]00|NaN|undefined/)
        }
    })
})

describe('StockDetail.vue -- grafik ve aralik', () => {
    it('bStock: CryptoChart id + varsayilan 30 gun, bolen yok', async () => {
        const html = await mount()
        expect(html).toContain(`data-chart-id="${BS.coingeckoId}"`)
        expect(html).toContain('data-chart-days="30"')
        expect(html).toContain('data-chart-divisor="undef"')
    })

    it('aralik secici 1H/1A/3A/1Y (7/30/90/365); 1G/1S yok', async () => {
        const html = await mount()
        const t = text(html)
        for (const k of ['1W', '1M', '3M', '1Y']) expect(t).toContain(k)
        for (const d of [7, 30, 90, 365]) expect(html).toContain(`data-range="${d}"`)
        expect(html).not.toContain('data-range="1"')
    })

    it('xStock carpani biliniyorsa bolen verilir', async () => {
        const html = await mount({ row: XS, records: [record(XS, 400)], balances: held(XS, 1, 2n * ONE) })
        expect(html).toContain('data-chart-divisor="2"')
    })

    it('xStock carpani bilinmiyorsa grafik cizilmez, "fiyat gecmisi yok"', async () => {
        const html = await mount({ row: XS, records: [record(XS, 400)], balances: {} })
        expect(html).not.toContain('data-chart-id')
        expect(text(html)).toContain('No price history')
    })
})

describe('StockDetail.vue -- pozisyon', () => {
    it('pozisyon yok -> mesaj, Sat devre disi', async () => {
        const html = await mount({ balances: { [stockKey(BS.chainId, BS.address)]: { status: 'ok', balance: 0n, multiplier: null } } })
        expect(text(html)).toContain('You have no position yet')
        expect(html).toMatch(/<button[^>]*data-stock-sell[^>]*disabled/)
    })

    it('pozisyon var -> adet + USD, Sat acik', async () => {
        const html = await mount({ records: [record(BS, 250)], balances: held(BS, 1.25) })
        const t = text(html)
        expect(t).toContain('1.2500 shares')
        expect(t).toContain('$312.50')
        expect(html).not.toMatch(/<button[^>]*data-stock-sell[^>]*disabled/)
    })

    it('Gonder ve Yatir ikincil eylemleri var', async () => {
        const html = await mount({ balances: held(BS, 1) })
        expect(html).toContain('data-stock-send')
        expect(html).toContain('data-stock-deposit')
        const t = text(html)
        expect(t).toContain('Send')
        expect(t).toContain('Deposit')
    })

    it('bakiye okunamadi -> "pozisyonun yok" YAZILMAZ', async () => {
        const html = await mount({ balances: {} })
        expect(text(html)).not.toContain('You have no position yet')
    })
})

describe('StockDetail.vue -- bilgi karti', () => {
    it('ihracci adi, ISIN, ag, kisaltilmis kontrat ve kopyala', async () => {
        const html = await mount({ balances: held(BS, 1) })
        const t = text(html)
        expect(t).toContain('Stock info')
        expect(t).toContain('Issuer')
        expect(t).toContain(BS.isin)
        expect(t).toContain('BNB')
        expect(t).toContain(BS.address.slice(0, 6))
        expect(html).toContain('data-stock-copy')
    })

    it('ihracci metni kisa: bStock', async () => {
        const html = await mount({ balances: held(BS, 1) })
        const t = text(html)
        expect(t).toContain('Binance (bStocks)')
        expect(t).toContain('Issued by Binance, traded on BSC.')
        expect(t).not.toContain('ADGM')
        expect(t).not.toContain('tracker certificate')
    })

    it('ihracci metni kisa: xStock', async () => {
        const html = await mount({ row: XS, records: [record(XS, 400)], balances: held(XS, 1, ONE) })
        const t = text(html)
        expect(t).toContain('Backed (xStocks)')
        expect(t).toContain('Every token is backed by a real share.')
        expect(t).not.toContain('Jersey')
        expect(t).not.toContain('tracker certificate')
    })

    it('ISIN yoksa (xStock) ISIN satiri yok', async () => {
        const html = await mount({ row: XS, records: [record(XS, 400)], balances: held(XS, 1, ONE) })
        expect(text(html)).not.toContain('ISIN')
    })

    it('sertifika uyarisi bilgi kartinin altinda', async () => {
        const html = await mount()
        expect(text(html)).toContain('not a share; it is a tokenized certificate')
    })

    it('tr dilinde de render olur', async () => {
        const html = await mount({ locale: 'tr' })
        expect(text(html)).toContain('Pozisyonun')
    })
})

describe('StockDetail.vue -- piyasa durumu', () => {
    it('xStock + kaynak yaniti -> durum satiri', async () => {
        const open = await mount({ row: XS, records: [record(XS, 400)], balances: held(XS, 1, ONE), market: { state: 'open', nextChangeAt: null } })
        expect(text(open)).toContain('Market open')
        const closed = await mount({ row: XS, records: [record(XS, 400)], balances: held(XS, 1, ONE), market: { state: 'closed', nextChangeAt: null } })
        expect(text(closed)).toContain('Market closed')
    })

    it('kaynak yoksa satir da tire de yok', async () => {
        const html = await mount({ row: XS, records: [record(XS, 400)], balances: held(XS, 1, ONE), market: null })
        expect(text(html)).not.toContain('Market')
    })
})

describe('StockDetail.vue -- yasaklar ve alt cubuk', () => {
    it('Kopru/Takas yok, ihracci rozeti yok, piyasa verisi karti yok', async () => {
        const html = await mount({ balances: held(BS, 1) })
        const t = text(html).toLowerCase()
        for (const w of ['bridge', 'swap', 'köprü', 'takas', 'market cap', 'volume']) expect(t).not.toContain(w)
        expect(html).not.toContain('data-issuer-badge')
    })

    it('sabit alt cubukta Al (yesil) ve Sat (kirmizi)', async () => {
        const html = await mount({ balances: held(BS, 1) })
        expect(html).toMatch(/data-stock-buy[^>]*emerald|emerald[^>]*data-stock-buy/)
        expect(html).toMatch(/data-stock-sell[^>]*rose|rose[^>]*data-stock-sell/)
        expect(text(html)).toContain('Buy')
        expect(text(html)).toContain('Sell')
    })

    it('hisse olmayan ref -> bos (cokmez)', async () => {
        const app = setup()
        cryptoStore().selected_token_ref = { id: 'x', chainId: 56, address: '0x0000000000000000000000000000000000000001' }
        const html = await render(app)
        expect(html).not.toContain('data-stock-buy')
    })

    it('X dugmesi ana sayfaya doner (kaynak taramasi)', () => {
        const src = yorumsuz(readFileSync(resolve(HERE, 'StockDetail.vue'), 'utf8'))
        expect(src).toMatch(/page\.currentPage\s*=\s*'home'/)
    })

    it('360px: kaydirma kabugu overflow-x-hidden, sabit genis eleman yok', () => {
        const src = yorumsuz(readFileSync(resolve(HERE, 'StockDetail.vue'), 'utf8'))
        expect(src).toContain('overflow-x-hidden')
        expect(src).not.toMatch(/(?<![-\w])w-\[(3[6-9]\d|[4-9]\d\d)px\]/)
    })
})

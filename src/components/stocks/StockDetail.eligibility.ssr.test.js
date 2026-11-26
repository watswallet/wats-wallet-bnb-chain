// StockDetail.vue (SSR) -- Al dugmesi yalniz uygun ihracci varsa; tutulan hissede Sat acik; dondurma notu ve tarafsiz
// bos not (Ilk Alim Kapisi, Task 44; K22, K34, K35; spec 6.5, 6.8, 13.2 #37).
//
// KOK NEDEN: hisse sayfasi Hisseler, Varliklar ve Ice aktar'in TEK varis noktasi; Al'i gizlemenin yeri burasi. Bu
// dosyanin kapattigi hata siniflari:
//  (1) hicbir ihracci uygun degilken Al sunulur, ya da Sat (tutulan hisse) Al ile birlikte kaybolur (K35);
//  (2) yukleme sirasinda Al etkin cizilir ve sonradan kalkar (flas), ya da hic yer tutmaz (kayma);
//  (3) dondurma notu `position.held` (TUM ihracci toplami) ile hesaplanir: yalniz xStocks tutan kullanici bStocks notunu gorur;
//  (4) not xStocks ya da ihtiyat-yalniz / kill switch / ulke bilinmiyor / hata nedenlerinde cikar;
//  (5) bakiye bilinmeden (yukleniyor / okunamadi) "alim sunulmuyor" denir: tutulan hisse sahibi bir an bu notu gorur;
//  (6) `detail` henuz kurulmamisken (onMounted storage okumasi bekliyor) Al durumu yanlis hesaplanir ("Al yok" flasi);
//  (7) bilgi kutusu uygun olmayan tutulan ihracci blogunu dusurur.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
// useStockEligibility test-utils/useStockEligibilityMock.js ile surulur (senaryo reaktif).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const modu = vi.hoisted(() => ({ onMountedYok: false }))
vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    // onMountedYok: StockDetail'in onMounted'i (storage okuma -> detail kurulumu) hic calismaz: `detail` null KALIR
    // ("store ready ama detail henuz yok" penceresi, SSR'de baska turlu gozlenemez).
    return { ...actual, onMounted: (...a) => (modu.onMountedYok ? undefined : actual.onServerPrefetch(...a)) }
})

vi.mock('../../utils/featureFlags', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, XSTOCKS_ENABLED: true }
})

vi.mock('../../composables/useStockEligibility', async (importOriginal) =>
    (await import('../../test-utils/useStockEligibilityMock.js')).createUseStockEligibilityMock(await importOriginal()))

const axiosMock = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({ default: { post: (...a) => axiosMock.post(...a) } }))

const balMock = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../../utils/stocksTab', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, loadGroupBalances: (...a) => balMock.fn(...a) }
})

vi.mock('../../utils/stocks/marketStatus', () => ({ fetchMarketStatus: async () => null }))

vi.mock('../CryptoChart.vue', async () => {
    const { h } = await import('vue')
    return { default: { name: 'CryptoChart', props: ['id', 'days', 'divisor'], setup: () => () => h('div', { 'data-chart': '' }) } }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import {
    resetEligibilityMock, eligibilityMock, ELIGIBILITY_ALL, ELIGIBILITY_XSTOCKS_ONLY, ELIGIBILITY_NONE, ELIGIBILITY_LOADING,
} from '../../test-utils/useStockEligibilityMock.js'
import { cryptoStore } from '../../store/crypto'
import { pageStore } from '../../store/pageStore'
import { networkStore } from '../../store/network'
import { companyRows } from '../../utils/stocks/stockCompanies'
import { sameChainOptions } from '../../utils/stocks/stockDetailModel'
import { stockKey } from '../../utils/tokenizedStocks'
import { ALL_CHAINS } from '../../data/chains'
import en from '../../i18n/locales/en.json'
import StockDetail from './StockDetail.vue'

const OWNER = '0xAbCdEf0000000000000000000000000000000001'
const TSLA = companyRows('TSLA', { xstocksEnabled: true })
const TSLA_B = TSLA.find((r) => r.issuer === 'bstocks') // BSC 56
const TSLA_X_BSC = TSLA.find((r) => r.issuer === 'xstocks' && r.chainId === 56)
const TSLA_X_ETH = TSLA.find((r) => r.issuer === 'xstocks' && r.chainId === 1)
// Ayni zincirde xStocks kardesi OLMAYAN bStocks (AAPL xStocks yalniz Ethereum'da).
const AAPL_B = companyRows('AAPL', { xstocksEnabled: true }).find((r) => r.issuer === 'bstocks')

const verdict = (decision, reason, ipCountry = null) => ({ decision, reason, ipCountry })
const senaryo = (bstocks, xstocks) => ({ ready: true, verdicts: { bstocks, xstocks } })
const ISSUER_ENGEL = verdict('BLOCKED', 'IP_COUNTRY_ISSUER', 'TR')

const BIR = 10n ** 18n
const tutulan = (...satirlar) => Object.fromEntries(satirlar.map((row) => [
    stockKey(row.chainId, row.address),
    { status: 'ok', balance: 3n * BIR, multiplier: row.issuer === 'xstocks' ? BIR : null },
]))
const okunmus = (row, balance) => ({ [stockKey(row.chainId, row.address)]: { status: 'ok', balance, multiplier: row.issuer === 'xstocks' ? BIR : null } })
const hepsiSifir = (row) => Object.assign({}, ...sameChainOptions(row).map((r) => okunmus(r, 0n)))
const hepsiHata = (row) => Object.fromEntries(sameChainOptions(row).map((r) => [stockKey(r.chainId, r.address), { status: 'error', balance: null, multiplier: null }]))

beforeEach(() => {
    modu.onMountedYok = false
    resetEligibilityMock(ELIGIBILITY_ALL)
})
afterEach(() => { delete globalThis.chrome })

function setup({ row, balances = {} }) {
    installChromeStub({ active_account: { address: OWNER, key: 'acc1' } })
    axiosMock.post = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
    balMock.fn = vi.fn(async () => balances)
    const app = createApp(StockDetail)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === row.chainId)
    cryptoStore().selected_token_ref = { id: row.coingeckoId, chainId: row.chainId, address: row.address, decimals: row.decimals, symbol: row.symbol }
    pageStore().currentPage = 'token'
    return app
}
const mount = async (opts) => (await render(setup(opts))).replace(/<!--[\s\S]*?-->/g, '')
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const tag = (html, attr) => (html.match(new RegExp(`<button[^>]*${attr}[^>]*>`)) ?? [''])[0]
const bar = (html) => html.slice(html.indexOf('data-stock-bar'))
const barButtons = (html) => (bar(html).match(/<button/g) ?? []).length
const freezeNote = (html) => (html.match(/data-stock-freeze-note[^>]*>([^<]*)</) ?? [])[1]?.replace(/&#39;/g, "'") ?? null
const EMPTY_TEXT = en.stockGate.empty.detail
const FREEZE_TEXT = en.stockGate.band.freezeNote.bstocks

describe('StockDetail eligibility ssr: Al dugmesi yalniz uygun ihracci varsa (K34, K35)', () => {
    it('pozitif bekci: katalog satirlari gercek, AAPL bStocks ayni zincirde tek satir', () => {
        expect(TSLA_B && TSLA_X_BSC && TSLA_X_ETH && AAPL_B).toBeTruthy()
        expect(sameChainOptions(TSLA_B).map((r) => r.issuer)).toEqual(['bstocks', 'xstocks'])
        expect(sameChainOptions(AAPL_B).map((r) => r.issuer)).toEqual(['bstocks'])
        expect(EMPTY_TEXT).toBe('Purchases of this product are not offered right now.')
        expect(FREEZE_TEXT).toMatch(/^This check does not block selling or sending/)
    })

    it('StockDetail: hepsi uygun (kontrol) -> Al etkin ve Sat yan yana', async () => {
        const html = await mount({ row: AAPL_B, balances: tutulan(AAPL_B) })
        expect(tag(html, 'data-stock-buy')).not.toBe('')
        expect(tag(html, 'data-stock-buy')).not.toContain('disabled')
        expect(barButtons(html)).toBe(2)
        expect(html).not.toContain('data-stock-empty-detail')
        expect(html).not.toContain('data-stock-freeze-note')
    })

    it("StockDetail: buyOffered false (hicbiri uygun degil) -> Al dugmesi DOM'da yok ve Sat tam genislik (class flex-1, tek dugme)", async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        const html = await mount({ row: AAPL_B, balances: tutulan(AAPL_B) })
        expect(html).not.toContain('data-stock-buy')
        const sat = tag(html, 'data-stock-sell')
        expect(sat).toMatch(/class="[^"]*\bflex-1\b/)
        expect(sat).not.toContain('disabled')
        expect(barButtons(html)).toBe(1)
    })

    it('StockDetail: uygun kardes (xStocks) varsa Al gorunur; kardes baska zincirdeyse gorunmez', async () => {
        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        const kardesli = await mount({ row: TSLA_B, balances: tutulan(TSLA_B) })
        expect(tag(kardesli, 'data-stock-buy')).not.toBe('')
        expect(tag(kardesli, 'data-stock-buy')).not.toContain('disabled')
        expect(barButtons(kardesli)).toBe(2)
        // AAPL: xStocks yalniz Ethereum'da, bStocks sayfasi BSC: ayni zincirde uygun kardes yok.
        const kardessiz = await mount({ row: AAPL_B, balances: tutulan(AAPL_B) })
        expect(kardessiz).not.toContain('data-stock-buy')
    })

    it('StockDetail: yukleniyor -> Al dugmesi pasif iskelet (disabled) ve ayni yerde; ready + uygun -> etkin', async () => {
        resetEligibilityMock(ELIGIBILITY_LOADING)
        const yukleniyor = await mount({ row: AAPL_B, balances: tutulan(AAPL_B) })
        expect(tag(yukleniyor, 'data-stock-buy')).toMatch(/\bdisabled\b/)
        // ayni yerde: alt cubukta, Sat'tan ONCE (kayma yok)
        expect(bar(yukleniyor).indexOf('data-stock-buy')).toBeGreaterThan(-1)
        expect(bar(yukleniyor).indexOf('data-stock-buy')).toBeLessThan(bar(yukleniyor).indexOf('data-stock-sell'))
        expect(yukleniyor).not.toContain('data-stock-empty-detail')

        resetEligibilityMock(ELIGIBILITY_ALL)
        const hazir = await mount({ row: AAPL_B, balances: tutulan(AAPL_B) })
        expect(tag(hazir, 'data-stock-buy')).not.toContain('disabled')
        expect(bar(hazir).indexOf('data-stock-buy')).toBeLessThan(bar(hazir).indexOf('data-stock-sell'))
    })

    it('StockDetail: store ready ama detail henuz yok (onMounted storage okumasi bekliyor) -> Al durumu katalog seceneklerinden hesaplanir; uygun ihracci varsa Al etkin, "Al yok" flasi yok', async () => {
        modu.onMountedYok = true
        for (const [senaryoAdi, row] of [['hepsi', AAPL_B], ['xstocksOnly', TSLA_B]]) {
            resetEligibilityMock(senaryoAdi === 'hepsi' ? ELIGIBILITY_ALL : ELIGIBILITY_XSTOCKS_ONLY)
            const html = await mount({ row })
            // pozitif bekci: detail gercekten kurulmadi (bakiye okumasi hic baslamadi)
            expect(balMock.fn).not.toHaveBeenCalled()
            expect(tag(html, 'data-stock-buy'), senaryoAdi).not.toBe('')
            expect(tag(html, 'data-stock-buy'), senaryoAdi).not.toContain('disabled')
        }
        // uygun ihracci yoksa detail null iken de Al yok (katalog secenekleri uygunluga gore elenir)
        resetEligibilityMock(ELIGIBILITY_NONE)
        const yok = await mount({ row: AAPL_B })
        expect(yok).not.toContain('data-stock-buy')
    })
})

describe('StockDetail eligibility ssr: tutulan hissede Sat acik, dondurma notu (K22, K35, #37)', () => {
    it('StockDetail: tutulan uygun olmayan bStocks: Sat acik, Al yok, Turkiye (IP_COUNTRY_ISSUER) icin dondurma notu gorunur', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        const html = await mount({ row: AAPL_B, balances: tutulan(AAPL_B) })
        expect(html).not.toContain('data-stock-buy')
        expect(tag(html, 'data-stock-sell')).not.toContain('disabled')
        expect(freezeNote(html)).toBe(FREEZE_TEXT)
        // eylem dugmesi tasimaz: not bir dugme/baglanti icinde degil
        expect(html).not.toMatch(/<(button|a)[^>]*data-stock-freeze-note/)
        // not alt cubugun DISINDA (kayan alanda), Sat'in yaninda degil
        expect(bar(html)).not.toContain('data-stock-freeze-note')
    })

    it('StockDetail: tutulan xstocks + ayni neden (IP_COUNTRY_ISSUER) -> not YOK (Sat acik, Al yok)', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        const html = await mount({ row: TSLA_X_ETH, balances: tutulan(TSLA_X_ETH) })
        expect(html).not.toContain('data-stock-buy')
        expect(tag(html, 'data-stock-sell')).not.toContain('disabled')
        expect(html).not.toContain('data-stock-freeze-note')
        expect(text(html)).not.toContain(FREEZE_TEXT.slice(0, 30))
    })

    it('StockDetail: tutulan bstocks + IP_COUNTRY_PRECAUTION / KILL_SWITCH / COUNTRY_UNKNOWN / CHECK_FAILED -> not YOK; OK ve yukleniyor da YOK', async () => {
        const nedenler = [
            verdict('BLOCKED', 'IP_COUNTRY_PRECAUTION', 'TR'),
            verdict('BLOCKED', 'KILL_SWITCH'),
            verdict('BLOCKED', 'COUNTRY_UNKNOWN'),
            verdict('BLOCKED', 'CHECK_FAILED'),
        ]
        for (const v of nedenler) {
            resetEligibilityMock(senaryo(v, v))
            const html = await mount({ row: AAPL_B, balances: tutulan(AAPL_B) })
            expect(html, v.reason).not.toContain('data-stock-buy')
            expect(tag(html, 'data-stock-sell'), v.reason).not.toContain('disabled')
            expect(html, v.reason).not.toContain('data-stock-freeze-note')
        }
        resetEligibilityMock(ELIGIBILITY_ALL)
        expect(await mount({ row: AAPL_B, balances: tutulan(AAPL_B) })).not.toContain('data-stock-freeze-note')
        resetEligibilityMock(ELIGIBILITY_LOADING)
        expect(await mount({ row: AAPL_B, balances: tutulan(AAPL_B) })).not.toContain('data-stock-freeze-note')
    })

    it('StockDetail: yalniz xStocks tutuluyor + bStocks verdict BLOCKED/IP_COUNTRY_ISSUER -> data-stock-freeze-note YOK; bStocks tutuluyor + ayni verdict -> not VAR', async () => {
        // xStocks uygun, bStocks IP_COUNTRY_ISSUER: Al kardes xStocks ile gorunur; not yalniz bStocks ELDEYSE.
        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        const yalnizX = await mount({ row: TSLA_B, balances: tutulan(TSLA_X_BSC) })
        // pozitif bekci: tutulan var (Sat acik, position.held true), ama bStocks satiri tutulmuyor
        expect(tag(yalnizX, 'data-stock-sell')).not.toContain('disabled')
        expect(yalnizX).not.toContain('data-stock-freeze-note')

        const bstocksVar = await mount({ row: TSLA_B, balances: tutulan(TSLA_B) })
        expect(freezeNote(bstocksVar)).toBe(FREEZE_TEXT)

        // ikisi birden tutuluyor: bStocks satiri tutuldugu icin not VAR
        const ikisi = await mount({ row: TSLA_B, balances: tutulan(TSLA_B, TSLA_X_BSC) })
        expect(freezeNote(ikisi)).toBe(FREEZE_TEXT)
    })

    it('StockDetail: bStocks bakiyesi 0 okundu + xStocks tutuluyor -> not YOK (bakiye > 0 sarti)', async () => {
        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        const html = await mount({ row: TSLA_B, balances: { ...okunmus(TSLA_B, 0n), ...tutulan(TSLA_X_BSC) } })
        expect(html).not.toContain('data-stock-freeze-note')
    })

    it('StockDetail: infoBlocks uygun olmayan tutulan ihracci blogunu KORUR', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        const html = await mount({ row: AAPL_B, balances: tutulan(AAPL_B) })
        const bilgi = html.slice(html.indexOf('data-stock-info'))
        expect(bilgi).toContain(AAPL_B.isin)
        expect(bilgi).toContain('data-stock-issuer-note')
        expect(bilgi).toContain('data-stock-card-open-issuer="bstocks"')
        expect(text(bilgi)).toContain(en.stockDetail.infoIssuer)
    })
})

describe('StockDetail eligibility ssr: tarafsiz bos not (stockGate.empty.detail)', () => {
    it("StockDetail: tutulan YOK + Al yok -> stockGate.empty.detail ve bos cubuk yok", async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        const html = await mount({ row: AAPL_B, balances: hepsiSifir(AAPL_B) })
        const not = (html.match(/data-stock-empty-detail[^>]*>([^<]*)</) ?? [])[1]
        expect(not).toBe(EMPTY_TEXT)
        expect(html).not.toContain('data-stock-buy')
        expect(html).not.toContain('data-stock-sell')
        expect(barButtons(html)).toBe(0)
        expect(html).not.toContain('data-stock-freeze-note')
    })

    it('StockDetail: bakiye bilindi, 0 tutulan -> empty.detail VAR (iki ihracci satiri da okundu)', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        const html = await mount({ row: TSLA_B, balances: hepsiSifir(TSLA_B) })
        expect(Object.keys(hepsiSifir(TSLA_B))).toHaveLength(2)
        expect(html).toContain('data-stock-empty-detail')
        expect(html).not.toContain('data-stock-sell')
    })

    it('StockDetail: Al var (uygun ihracci) -> empty.detail YOK, 0 tutulan olsa da', async () => {
        const html = await mount({ row: AAPL_B, balances: hepsiSifir(AAPL_B) })
        expect(html).not.toContain('data-stock-empty-detail')
        expect(tag(html, 'data-stock-buy')).not.toBe('')
        // Sat pasif (tutulan yok) ama cubuk duruyor
        expect(tag(html, 'data-stock-sell')).toContain('disabled')
    })

    it('StockDetail: bakiye yukleniyor / okunamadi (position.unknown) + hicbiri uygun degil -> stockGate.empty.detail YOK ve alt cubuk (Sat) duruyor', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        // (a) bakiye okunamadi: balancesLoading false ama position.unknown true
        const okunamadi = await mount({ row: AAPL_B, balances: hepsiHata(AAPL_B) })
        expect(okunamadi).not.toContain('data-stock-empty-detail')
        expect(tag(okunamadi, 'data-stock-sell')).toContain('disabled')
        expect(okunamadi).not.toContain('data-stock-buy')
        // (b) bakiye yukleniyor: detail henuz yok (balancesLoading true)
        modu.onMountedYok = true
        const yukleniyor = await mount({ row: AAPL_B })
        expect(balMock.fn).not.toHaveBeenCalled()
        expect(yukleniyor).not.toContain('data-stock-empty-detail')
        expect(tag(yukleniyor, 'data-stock-sell')).toContain('disabled')
        expect(yukleniyor).not.toContain('data-stock-freeze-note')
    })

    it('StockDetail: uygunluk yukleniyor + bakiye 0 -> bos not YOK (ready olmadan not cizilmez)', async () => {
        resetEligibilityMock(ELIGIBILITY_LOADING)
        const html = await mount({ row: AAPL_B, balances: hepsiSifir(AAPL_B) })
        expect(html).not.toContain('data-stock-empty-detail')
        expect(eligibilityMock.scenario.ready).toBe(false)
    })
})

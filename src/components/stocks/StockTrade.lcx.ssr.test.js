// StockTrade.vue -- LCX hisse satiri (Bolum 2, Gorev 8): ekran motor KIMLIGINE degil motor ALANLARINA (usesAts, showsCowDisclosure ...) bakar.
// Olculen: odeme dugmeleri USDC / USDT / native (+ native logo), ATS karti `usesAts` ile, teklif `reference.usd` -> refPrice, bStocks Atlas yolu
// ayni, INSUFFICIENT_LIQUIDITY + errorInfo.max satiri, ATS ucret teklifi LCX koduyla reddedilince ATS engel karti YOK, native MAX tam bakiye.
// Pancake / CoW ekranlari baska dosyalarda DEGISMEDEN yesil kalir (StockTrade.bstocks / .eligibility / .stockGate / xStocks testleri).
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
// LCX bayragi bu dosyada ACIK; flags.lcx ile testte kapatilabilir (getter: tradeEnabledFor her cagrida okur).
const flags = vi.hoisted(() => ({ lcx: true }))
vi.mock('../../utils/featureFlags', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, get LCX_ENABLED() { return flags.lcx } }
})
// Ilk alim kapisi aynasi: bu dosyanin konusu kapi degil (StockTrade.stockGate.ssr.test.js). Ortak sahte kapiyi ACIK tutar.
vi.mock('../../composables/useStockGate', async (importOriginal) =>
    (await import('../../test-utils/useStockGateMock.js')).createUseStockGateMock(await importOriginal()))

// Teklif: durumu test doldurur (ag/zamanlayici yok).
vi.mock('../../composables/useCowQuote', async () => {
    const { reactive } = await import('vue')
    const __quote = reactive({
        state: 'idle', result: null, quoteId: null, expiresAt: null, errorCode: null, errorInfo: null, lockReason: null,
        refresh: vi.fn(), invalidate: vi.fn(),
    })
    const __quoteCalls = []
    return { useCowQuote: (opts) => { __quoteCalls.push(opts); return __quote }, __quote, __quoteCalls }
})

// Motor kapilari (ATS + fiyat etkisi): composable AYRI testlenir (useStockEngineGates.test.js); burada kontrollu govde.
vi.mock('../../composables/useStockEngineGates', async () => {
    const { reactive } = await import('vue')
    const __gates = reactive({
        ats: { atsFee: null, atsSymbol: 'ATS', loading: false, feeRefundable: false, prepaid: null, decision: null, nextSteps: [], insufficient: false, totalAtsCost: null, opCount: 1, errorCode: null, lcxCode: null, requiredAtsFor: () => null },
        atsQuoted: null, atsBlocked: false, atsBlock: null, extraBlock: null,
        acknowledged: false, priceImpactHigh: false, priceImpactUnmeasured: false,
        startOnboarding: vi.fn(),
    })
    return { useStockEngineGates: () => __gates, __gates }
})

const balanceMock = vi.hoisted(() => ({ fn: async () => 1000, calls: [] }))
vi.mock('../../composables/useTokenBalance', () => ({
    useTokenBalance: (...args) => {
        balanceMock.calls.push(args)
        return balanceMock.fn(...args)
    },
}))

vi.mock('../../utils/atsConfig', async (importOriginal) => {
    const actual = await importOriginal()
    const cfg = {
        paymaster: '0x1111111111111111111111111111111111111111',
        delegate: '0x2222222222222222222222222222222222222222',
        entryPoint: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
        token: { address: '0xAAA0000000000000000000000000000000000000', symbol: 'ATS', decimals: 18 },
    }
    return { ...actual, getAtsConfig: () => cfg }
})
vi.mock('../../composables/useAtsPurchase', () => ({ useAtsPurchase: () => ({ live: true, open: vi.fn(async () => true) }) }))

const axiosMock = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('axios', () => ({ default: { post: (...a) => axiosMock.post(...a) } }))
vi.mock('../../utils/applyNetworkChange', () => ({ applyNetworkChange: async () => true }))

import { createApp, render, installChromeStub, createTestPinia, createTestI18n, captureInstance } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { __quote, __quoteCalls } from '../../composables/useCowQuote'
import { __gates } from '../../composables/useStockEngineGates'
import { toValue } from 'vue'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import { pageStore } from '../../store/pageStore'
import { ALL_CHAINS } from '../../data/chains'
import { BSTOCKS } from '../../data/bStocks'
import { XSTOCKS } from '../../data/xStocks'
import { setLcxStockRows, _resetLcxStockRows } from '../../utils/tokenizedStocks'
import { createLcxEngine } from '../../utils/stocks/engines/lcxEngine'
import { toQuoteResponse } from '../../utils/stocks/engines/pancakeQuote'
import StockTrade from './StockTrade.vue'
import { resetGateMock } from '../../test-utils/useStockGateMock.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADDR = '0xAbCdEf0000000000000000000000000000000001'
const BSTOCK = BSTOCKS.find((b) => b.underlying === 'TSLA')

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
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
// Task 3: ssrRender'in varsayilan STOCK_GATE_STATUS yaniti yalniz bstocks / xstocks tasir; coinbase satiri icin tabloda coinbase da OLMALI.
const ELIGIBLE = Object.freeze({ bstocks: OK, xstocks: OK, coinbase: OK, ondo: OK })

const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const primaryTag = (html) => (html.match(/<button[^>]*data-trade-primary[^>]*>[\s\S]*?<\/button>/) ?? [''])[0]
const isDisabled = (tag) => / disabled(=|>| )/.test(tag.replace(/class="[^"]*"/, ''))
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const payButton = (html, symbol) => (html.match(new RegExp(`<button[^>]*data-pay-token="${symbol.replace('.', '\\.')}"[^>]*>[\\s\\S]*?<\\/button>`)) ?? [''])[0]
const payOrder = (html) => [...html.matchAll(/data-pay-token="([^"]+)"/g)].map((m) => m[1])
// SSR metni HTML-kacisli basar (apostrof &#39;): iddialar kacissiz metinle yapilir.
const plain = (s) => text(s).replace(/&#39;/g, "'")

const lcxRef = (row) => ({ id: null, chainId: row.chainId, address: row.address, decimals: row.decimals, symbol: row.symbol })

// Gercek lcxEngine.quote ile uretilen sonuc (ekran motorun ciktisini oldugu gibi tuketir): reference { usd, source }, native odemede
// unitPrice / gapPct null. Chrome sahtesi burada kurulur, build() kendi sahtesini sonra yeniden kurar.
async function lcxResult({ side = 'buy', payToken = BASE_USDC, amount = '2', referenceUsd = 388.61280861 } = {}) {
    const stub = installChromeStub({ active_account: { address: ADDR, type: 'imported', key: 'acc1' } })
    stub.setSendMessage(async ({ type }) => {
        if (type !== 'SWAP_QUOTE') return { error: 'beklenmeyen ' + type }
        return {
            success: true,
            data: {
                expectedOutput: '0.00513279', minimumReceived: '0.00510712', priceImpact: '0.02%', liquidityProviderFee: 'N/A', routerType: { name: 'lcx' },
                lcxQuote: {
                    kind: 'rwa', quoteId: 'q_abc123', chainId: 8453, expiresAt: Date.now() / 1000 + 120,
                    rwa: { issuer: 'coinbase', marketOpen: false, refDeviationBps: -26.66, referenceUsd, symbol: 'TSLAC', underlying: 'TSLA' },
                },
            },
        }
    })
    const engine = createLcxEngine()
    const request = engine.buildQuoteMessage({ side, chainId: 8453, stockAddress: TSLAC.address, payToken, amount })
    const result = await engine.quote(request)
    delete globalThis.chrome
    if (result.success !== true) throw new Error('lcx sonucu kurulamadi: ' + JSON.stringify(result))
    return result
}

const pancakeResult = () => ({
    ...toQuoteResponse(
        { expectedOutput: '0.1', minimumReceived: '0.099', priceImpact: '0.30%', liquidityProviderFee: '0.25%', routerType: { name: 'PancakeSwap', version: '3' } },
        { side: 'buy', amount: '25', referencePrice: 250, quoteId: 'ps_1' },
    ),
    request: { side: 'buy', chainId: 56, amount: '25', index: 'i', slippage: 0.5 },
})

function build({ selected = 'lcx', state = {}, amount = '', side = 'buy', locale = 'en', eligibility = ELIGIBLE, chainId = 8453, setup, onCapture } = {}) {
    const stub = installChromeStub({ active_account: { address: ADDR, type: 'imported', key: 'acc1' } }, { eligibility })
    const app = createApp(StockTrade)
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === chainId)
    const crypto = cryptoStore()
    if (selected === 'lcx') crypto.selected_token_ref = lcxRef(TSLAC)
    else if (selected === 'bstock') crypto.selected_token_ref = { id: 'b', chainId: 56, address: BSTOCK.address, decimals: BSTOCK.decimals, symbol: BSTOCK.symbol }
    else if (selected) crypto.selected_token_ref = selected
    pageStore().currentPage = 'stock_trade'
    Object.assign(__quote, state)
    const holder = captureInstance(app, 'StockTrade', (inst) => {
        onCapture?.(inst.setupState)
        if (side !== 'buy') inst.setupState.side = side
        if (amount) inst.setupState.amount = amount
        setup?.(inst.setupState)
    })
    return { app, holder, stub }
}

async function mount(opts) {
    const { app, holder, stub } = build(opts)
    const html = clean(await render(app))
    return { html, holder, stub }
}

beforeEach(() => {
    flags.lcx = true
    setLcxStockRows([TSLAC, GMEON], { usEquitiesOpen: true })
    resetGateMock()
    Object.assign(__quote, { state: 'idle', result: null, quoteId: null, expiresAt: null, errorCode: null, errorInfo: null, lockReason: null })
    Object.assign(__gates, { atsQuoted: null, atsBlocked: false, extraBlock: null, acknowledged: false, priceImpactHigh: false, priceImpactUnmeasured: false })
    Object.assign(__gates.ats, { atsFee: null, loading: false, decision: null, insufficient: false, totalAtsCost: null, opCount: 1, errorCode: null, lcxCode: null })
    balanceMock.fn = async () => 1000
    balanceMock.calls.length = 0
    axiosMock.post = vi.fn(async () => ({ status: 200, data: { tokens: [{ coingecko_id: BSTOCK.coingecko_id, image: null, market_data: { priceUSD: 250 } }] } }))
    __quote.refresh.mockClear()
    __quote.invalidate.mockClear()
    __quoteCalls.length = 0
})
afterEach(() => {
    delete globalThis.chrome
    _resetLcxStockRows()
})

describe('StockTrade.vue -- LCX satiri: ekran ve odeme tokenleri', () => {
    it('Base TSLAC: ekran acik (LCX motoru), Al ve Sat sekmeleri, ana dugme', async () => {
        const { html, holder } = await mount()
        expect(html).toContain('data-stock-trade')
        expect(html).not.toContain('not available')
        expect(holder.instance.setupState.engine.id).toBe('lcx')
        expect(html).toContain('data-trade-tab="buy"')
        expect(html).toContain('data-trade-tab="sell"')
        expect(isDisabled((html.match(/<button[^>]*data-trade-tab="buy"[^>]*>/) ?? [''])[0])).toBe(false) // coinbase tabloda: Al sunuluyor
        expect(text(primaryTag(html))).toBe('Enter amount')
        expect(html).toContain('TSLAC')
    })

    it('odeme dugmeleri sirayla USDC, USDT, ETH; ilk secili', async () => {
        const { html, holder } = await mount()
        expect(payOrder(html)).toEqual(['USDC', 'USDT', 'ETH'])
        expect(holder.instance.setupState.payToken.symbol).toBe('USDC')
        expect(text(html)).toContain('Amount (USDC)')
    })

    it('ETH dugmesinin logosu agin native logosu (bos degil): Ethereum logosu, L2 zincir logosu degil', async () => {
        const { html } = await mount()
        const eth = payButton(html, 'ETH')
        const src = eth.match(/<img[^>]*\ssrc="([^"]*)"/)?.[1] ?? ''
        expect(src).not.toBe('')
        expect(src).toBe('/chains/1.png')
        expect(src).not.toBe('/chains/8453.png')
        // stable dugmeleri de logolu (mevcut davranis): USDC paketli /usdc.png, USDT CoinGecko gorseli
        expect(payButton(html, 'USDC')).toMatch(/<img[^>]*\ssrc="\/usdc\.png"/)
        expect(payButton(html, 'USDT')).toMatch(/<img[^>]*\ssrc="https:\/\/coin-images\.coingecko\.com\//)
    })

    it('BSC Ondo satiri: native BNB dugmesi agin logosuyla', async () => {
        const { html } = await mount({ selected: lcxRef(GMEON), chainId: 56 })
        expect(payOrder(html)).toEqual(['USDC', 'USDT', 'BNB'])
        expect(payButton(html, 'BNB')).toMatch(/<img[^>]*\ssrc="\/chains\/56\.png"/)
    })

    it('stable odemede bakiye odeme tokeninden (Al) okunur; native secilince 0x0 ile', async () => {
        await mount()
        expect(balanceMock.calls.at(-1)[1]).toBe(BASE_USDC)
        balanceMock.calls.length = 0
        await mount({ onCapture: (s) => { s.payToken = s.payTokens[2] } })
        expect(balanceMock.calls.at(-1)[1]).toBe('0x0')
        expect(balanceMock.calls.at(-1)[3]).toBe(8453)
    })

    it('native MAX: ATS ucreti ATS tokeniyle odenir, native bakiyenin TAMAMI kullanilir (gaz payi dusulmez)', async () => {
        balanceMock.fn = async () => ({ balance: 1.5, atoms: 1500000000000000000n, decimals: 18 })
        const { holder } = await mount({ onCapture: (s) => { s.payToken = s.payTokens[2] } })
        const s = holder.instance.setupState
        s.setPercent(1)
        expect(s.amount).toBe('1.5')
        s.setPercent(0.5)
        expect(s.amount).toBe('0.75')
    })

    it('LCX bayragi kapaliyken ekran "mevcut degil" (kapi tradeEnabledFor)', async () => {
        flags.lcx = false
        const { html } = await mount()
        expect(html).toContain('Buy / Sell is not available for this stock right now')
        expect(html).not.toContain('data-pay-token')
    })
})

describe('StockTrade.vue -- LCX satiri: ATS karti usesAts ile', () => {
    it('hazir LCX teklifinde ATS karti (StockAtsFeeCard) gorunur; CoW metinleri ve onay adimi yok', async () => {
        const { html } = await mount({ amount: '2', state: { state: 'ready', result: await lcxResult(), quoteId: 'lc_1' } })
        expect(html).toContain('data-stock-ats-card')
        expect(html).not.toContain('data-trade-powered')
        expect(html).not.toContain('data-approve-step')
        expect(html).not.toContain('data-trade-network-fee')
        expect(text(html)).not.toMatch(/cow/i)
    })

    it('teklif yokken (idle / loading / error) ATS karti yok', async () => {
        for (const state of [{ state: 'idle' }, { state: 'loading' }, { state: 'error', errorCode: 'NO_ROUTE' }]) {
            const { html } = await mount({ amount: '2', state })
            expect(html, state.state).not.toContain('data-stock-ats-card')
        }
    })

    it('ucret yukluyse ATS dokum satirlari (ag / komisyon / toplam) ve dugme etkin "Buy"', async () => {
        Object.assign(__gates.ats, { atsFee: 0.4, totalAtsCost: 0.5, opCount: 1 })
        __gates.atsQuoted = { transferFee: 0.4, commissionFee: 0.1 }
        const { html } = await mount({ amount: '2', state: { state: 'ready', result: await lcxResult(), quoteId: 'lc_1' } })
        expect(html).toContain('data-trade-ats-fees')
        const bolum = text(html.slice(html.indexOf('data-trade-ats-fees'), html.indexOf('data-stock-ats-card')))
        expect(bolum).toContain('Network fee (ATS)')
        expect(bolum).toContain('Commission (ATS)')
        expect(bolum).toContain('Total fee (ATS)')
        expect(isDisabled(primaryTag(html))).toBe(false)
        expect(text(primaryTag(html))).toBe('Buy')
    })

    it('ATS yetersiz / engelli (LCX kodu olmadan): dugme kapali "ATS fee cannot be covered" (bugunku etiket)', async () => {
        for (const extra of ['ats-insufficient', 'ats-blocked']) {
            __gates.extraBlock = extra
            const { html } = await mount({ amount: '2', state: { state: 'ready', result: await lcxResult(), quoteId: 'lc_1' } })
            expect(isDisabled(primaryTag(html))).toBe(true)
            expect(text(primaryTag(html))).toBe('ATS fee cannot be covered')
        }
    })

    it('native odemede birim fiyat "-" (ETH / hisse USD ile yazilmaz), referans fiyat USD olarak gorunur, fark uyarisi yok', async () => {
        const result = await lcxResult({ payToken: '0x0', amount: '0.001' })
        expect(result.display.unitPrice).toBeNull()
        const { html } = await mount({ amount: '0.001', onCapture: (s) => { s.payToken = s.payTokens[2] }, state: { state: 'ready', result, quoteId: 'lc_1' } })
        expect(text(html)).toMatch(/Unit price - Reference price \$388\.61/)
        expect(html).not.toContain('data-trade-gap-warn')
    })
})

describe('StockTrade.vue -- LCX ATS ucret teklifi reddi: ATS engel karti YOK, islem yine engelli', () => {
    const ready = async () => ({ state: 'ready', result: await lcxResult(), quoteId: 'lc_1' })

    it('LCX_REFUSED (use_rwa): ATS karari yok, dugme kapali ve "Unavailable" (ATS sorunu DEMEZ), hisse metni ve Retry', async () => {
        Object.assign(__gates.ats, { errorCode: 'LCX_REFUSED', lcxCode: 'use_rwa', decision: null })
        __gates.extraBlock = 'ats-blocked'
        const { html } = await mount({ amount: '2', state: await ready() })
        expect(html).not.toContain('data-ats-decision')
        expect(isDisabled(primaryTag(html))).toBe(true)
        expect(text(primaryTag(html))).toBe('Unavailable')
        expect(text(html)).not.toContain('ATS fee cannot be covered')
        expect(html).toContain('data-trade-ats-lcx-error')
        expect(plain(html.match(/<div[^>]*data-trade-ats-lcx-error[^>]*>[\s\S]*?<\/div>/)[0])).toContain("This stock can't be traded right now.")
        expect(html.match(/<div[^>]*data-trade-ats-lcx-error[^>]*>[\s\S]*?<\/div>/)[0]).toContain('Retry')
    })

    it.each([
        ['LCX_UNAVAILABLE', undefined, 'Stock trading is temporarily unavailable'],
        ['LCX_REQUOTE', undefined, 'Price updated, please confirm again'],
        ['LCX_QUOTE_MISMATCH', undefined, 'Price updated, please confirm again'],
        ['LCX_TX_MISMATCH', undefined, "wasn't sent"],
        ['LCX_REFUSED', 'no_reference_price', 'no reference price'],
    ])('%s (%s): okunur metin, ATS etiketi yok', async (code, lcxCode, parca) => {
        Object.assign(__gates.ats, { errorCode: code, lcxCode: lcxCode ?? null, decision: null })
        __gates.extraBlock = 'ats-blocked'
        const { html } = await mount({ amount: '2', state: await ready() })
        const bant = html.match(/<div[^>]*data-trade-ats-lcx-error[^>]*>[\s\S]*?<\/div>/)?.[0] ?? ''
        expect(plain(bant)).toContain(parca)
        expect(text(primaryTag(html))).toBe('Unavailable')
        expect(text(html)).not.toContain('unexpected error')
    })

    it('ATS kodu LCX degil (STOCK_GATE ya da kodsuz): LCX bandi cizilmez (bugunku davranis)', async () => {
        for (const errorCode of ['STOCK_GATE', null, 'BASKA_KOD']) {
            Object.assign(__gates.ats, { errorCode, lcxCode: null })
            __gates.extraBlock = 'ats-blocked'
            const { html } = await mount({ amount: '2', state: await ready() })
            expect(html, String(errorCode)).not.toContain('data-trade-ats-lcx-error')
        }
    })

    it('bStocks (pancake) ekraninda ATS engeli bugunku gibi: LCX bandi yok, "ATS fee cannot be covered"', async () => {
        __gates.extraBlock = 'ats-blocked'
        const { html } = await mount({ selected: 'bstock', chainId: 56, amount: '25', state: { state: 'ready', result: pancakeResult(), quoteId: 'ps_1' } })
        expect(html).not.toContain('data-trade-ats-lcx-error')
        expect(text(primaryTag(html))).toBe('ATS fee cannot be covered')
    })
})

describe('StockTrade.vue -- LCX likidite tavani (INSUFFICIENT_LIQUIDITY + errorInfo.max)', () => {
    it('max var: hata metni ve "Up to 0.25 TSLAC can be traded." satiri', async () => {
        const { html } = await mount({ amount: '1', state: { state: 'error', errorCode: 'INSUFFICIENT_LIQUIDITY', errorInfo: { max: '0.25 TSLAC' } } })
        expect(text(html)).toContain('Not enough liquidity for this amount.')
        expect(html).toContain('data-trade-liquidity-max')
        expect(text(html.match(/<p[^>]*data-trade-liquidity-max[^>]*>[\s\S]*?<\/p>/)[0])).toBe('Up to 0.25 TSLAC can be traded.')
    })

    it('max yok (errorInfo null): yalniz hata metni, ikinci satir YOK', async () => {
        const { html } = await mount({ amount: '1', state: { state: 'error', errorCode: 'INSUFFICIENT_LIQUIDITY', errorInfo: null } })
        expect(text(html)).toContain('Not enough liquidity for this amount.')
        expect(html).not.toContain('data-trade-liquidity-max')
        expect(text(html)).not.toContain('can be traded')
    })

    it('baska hata kodunda errorInfo.max olsa bile satir cizilmez', async () => {
        const { html } = await mount({ amount: '1', state: { state: 'error', errorCode: 'NO_ROUTE', errorInfo: { max: '0.25 TSLAC' } } })
        expect(html).not.toContain('data-trade-liquidity-max')
    })

    it('Turkce metin ve Yeniden dene dugmesi (likidite hatasinda tutar degistirilerek tekrar denenir)', async () => {
        const { html } = await mount({ locale: 'tr', amount: '1', state: { state: 'error', errorCode: 'INSUFFICIENT_LIQUIDITY', errorInfo: { max: '0.25 TSLAC' } } })
        expect(html).toContain('data-trade-liquidity-max')
        expect(html).toContain('0.25 TSLAC')
        expect(html).toContain('Yeniden dene')
    })

    it.each([
        ['REF_PRICE_OFF', "more than 1% worse"],
        ['NO_REFERENCE_PRICE', 'no reference price'],
        ['RWA_EXCLUDED', "can't be traded"],
        ['ISSUER_MISMATCH', "didn't match"],
        ['LCX_UNAVAILABLE', 'temporarily unavailable'],
        ['LCX_TX_REJECTED', "safety check"],
    ])('%s -> okunur LCX metni (UNKNOWN degil), CoW demez', async (code, parca) => {
        const { html } = await mount({ amount: '1', state: { state: 'error', errorCode: code } })
        expect(plain(html)).toContain(parca)
        expect(text(html)).not.toContain('unexpected error')
        expect(text(html)).not.toMatch(/cow/i)
    })
})

describe('StockTrade.vue -- referans fiyat kaynagi (refPrice / refSettled)', () => {
    it('LCX satiri: referans TEKLIFTEN gelir (reference.usd); beklenecek sey yok, sunucu fiyati sorulmaz', async () => {
        const result = await lcxResult({ referenceUsd: 388.61 })
        const { holder } = await mount({ amount: '2', state: { state: 'ready', result, quoteId: 'lc_1' }, onCapture: (s) => { expect(s.refSettled).toBe(true) } })
        expect(holder.instance.setupState.refPrice).toBe(388.61)
        expect(holder.instance.setupState.refSettled).toBe(true)
        expect(axiosMock.post).not.toHaveBeenCalled() // LCX satirinin katalog kimligi (coingeckoId) yok
    })

    it('LCX: teklif yokken refPrice null; teklif hata iken de null', async () => {
        for (const state of [{ state: 'idle' }, { state: 'loading' }, { state: 'error', errorCode: 'NO_ROUTE' }]) {
            const { holder } = await mount({ amount: '2', state })
            expect(holder.instance.setupState.refPrice, state.state).toBeNull()
        }
    })

    it('LCX: gecersiz reference (usd null / 0 / sayi degil) refPrice u null yapar', async () => {
        const result = await lcxResult()
        for (const reference of [{ usd: null, source: 'lcx' }, { usd: 0, source: 'lcx' }, { usd: '388', source: 'lcx' }, 388.6, null]) {
            const { holder } = await mount({ amount: '2', state: { state: 'ready', result: { ...result, reference }, quoteId: 'lc_1' } })
            expect(holder.instance.setupState.refPrice, JSON.stringify(reference)).toBeNull()
        }
    })

    it('LCX: teklifin referansi istege GIRMEZ (motor kendi mesajini kurar; teklif anahtari referansla degismez)', async () => {
        const { holder } = await mount({ amount: '2', state: { state: 'ready', result: await lcxResult(), quoteId: 'lc_1' } })
        const req = toValue(__quoteCalls.at(-1).request)
        expect(req).not.toHaveProperty('referencePrice')
        expect(req).toMatchObject({ side: 'buy', chainId: 8453, stockAddress: TSLAC.address, payToken: BASE_USDC, amount: '2', lcxKind: 'rwa' })
        expect(holder.instance.setupState.refPrice).toBeGreaterThan(0)
    })

    it('bStocks satiri: bugunku Atlas yolu -- ilk teklif referans cevaplanana dek bekler, sunucu priceUSD i istege girer', async () => {
        let ilk = null
        const { holder } = await mount({ selected: 'bstock', chainId: 56, amount: '25', onCapture: (s) => { ilk = s.refSettled } })
        expect(ilk).toBe(false)
        expect(axiosMock.post).toHaveBeenCalled()
        expect(holder.instance.setupState.refSettled).toBe(true)
        expect(holder.instance.setupState.refPrice).toBe(250)
        expect(toValue(__quoteCalls.at(-1).request).referencePrice).toBe(250)
    })

    it('bStocks: teklifin sayi referansi refPrice i DEGISTIRMEZ (Atlas fiyati kalir)', async () => {
        const { holder } = await mount({ selected: 'bstock', chainId: 56, amount: '25', state: { state: 'ready', result: pancakeResult(), quoteId: 'ps_1' } })
        expect(holder.instance.setupState.refPrice).toBe(250)
    })

    it('xStocks satiri: referans ekranda yok (null), beklenecek sey yok', async () => {
        const x = XSTOCKS.find((s) => s.chains.includes(1))
        const { holder } = await mount({ selected: { id: x.coingecko_id, chainId: 1, address: x.address, decimals: x.decimals, symbol: x.symbol }, chainId: 1, onCapture: (s) => { expect(s.refSettled).toBe(true) } })
        expect(holder.instance.setupState.refPrice).toBeNull()
    })
})

// Brief testi 3: pancake (usesAts true) ve cow (usesAts false) ekranlari bugunku gibi. Tam kapsam mevcut dosyalarda degismeden yesil
// (StockTrade.bstocks / .ssr / .eligibility / .stockGate / .atsFlagOff); burada alan kararinin iki yonu yan yana sabitlenir.
describe('StockTrade.vue -- pancake ve cow ekranlari usesAts alaniyla bugunku gibi', () => {
    const X = XSTOCKS.find((s) => s.chains.includes(1))
    const cowRef = { id: X.coingecko_id, chainId: 1, address: X.address, decimals: X.decimals, symbol: X.symbol }
    const cowReady = {
        success: true, locked: false, lockReason: null, quoteId: 'q1',
        display: {
            sellAmount: '10000000', sellDecimals: 6, expectedBuy: '45000000000000000', buyDecimals: 18, minBuy: '44000000000000000',
            unitPrice: 222.2, referencePrice: 222, gapPct: 0.09, locked: false, fees: { networkUsd: 0.1, cowUsd: 0.05, watsUsd: 0.01, totalUsd: 0.16 },
        },
        approval: { mode: 'permit' }, notice: { state: 'open', nextChangeAt: null }, warnings: [],
    }

    it('bStocks (usesAts true): hazir teklifte ATS karti ve ATS ucret dokumu var, CoW metni yok', async () => {
        Object.assign(__gates.ats, { atsFee: 1.5, totalAtsCost: 1.7, opCount: 1 })
        __gates.atsQuoted = { transferFee: 1.5, commissionFee: 0.2 }
        const { html, holder } = await mount({ selected: 'bstock', chainId: 56, amount: '25', state: { state: 'ready', result: pancakeResult(), quoteId: 'ps_1' } })
        expect(holder.instance.setupState.engine.usesAts).toBe(true)
        expect(html).toContain('data-stock-ats-card')
        expect(html).toContain('data-trade-ats-fees')
        expect(html).not.toContain('data-trade-powered')
    })

    it('xStocks (cow, usesAts false): ATS karti ve ATS dokumu YOK; CoW ucret dokumu ve "Powered by CoW" var', async () => {
        const { html, holder } = await mount({ selected: cowRef, chainId: 1, amount: '10', state: { state: 'ready', result: cowReady, quoteId: 'q1' } })
        expect(holder.instance.setupState.engine.id).toBe('cow')
        expect(holder.instance.setupState.engine.usesAts).toBe(false)
        expect(html).not.toContain('data-stock-ats-card')
        expect(html).not.toContain('data-trade-ats-fees')
        expect(html).toContain('data-trade-powered')
        expect(text(html)).toContain('Network fee')
    })

    it('xStocks ekraninda odeme tokenleri yalniz USDC / USDT (native yok)', async () => {
        const { html } = await mount({ selected: cowRef, chainId: 1 })
        expect(payOrder(html)).toEqual(['USDC', 'USDT'])
    })
})

describe('StockTrade.vue -- kaynak taramasi (motor ALANLARI, kimlik degil)', () => {
    const src = yorumsuz(readFileSync(resolve(HERE, 'StockTrade.vue'), 'utf8'))

    it('motor kimligine (engine.id) ve ihracci dize sabitine (issuer === ...) bakilmaz', () => {
        expect(src).not.toMatch(/engine\.value\??\.id\b/)
        expect(src).not.toMatch(/\.id\s*[!=]==?\s*['"](?:pancake|cow|lcx)['"]/)
        expect(src).not.toMatch(/issuer\s*[!=]==?\s*['"]/)
    })

    it('ATS karti usesAts alanina baglidir; referans kaynagi modelden (referenceSourceOf)', () => {
        expect(src).toMatch(/engine\.value\?\.usesAts === true/)
        expect(src).toContain('referenceSourceOf(')
        expect(src).toContain('quoteReferenceUsd(')
    })

    it('odeme cipi logosu payTokenForAvatar ile (native logo tek yerden)', () => {
        expect(src).toMatch(/payTokenForAvatar\(p, stock\.chainId\)/)
    })
})

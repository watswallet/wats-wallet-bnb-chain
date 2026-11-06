// StockTrade.vue -- bStocks (pancake motoru) ve motor baglama (T14). Ekran hesap yapmaz, yalniz gosterir.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Teklif: durumu test doldurur (ag/zamanlayici yok).
vi.mock('../../composables/useCowQuote', async () => {
    const { reactive } = await import('vue')
    const __quote = reactive({
        state: 'idle', result: null, quoteId: null, expiresAt: null, errorCode: null, lockReason: null,
        refresh: vi.fn(), invalidate: vi.fn(),
    })
    const __quoteCalls = []
    return { useCowQuote: (opts) => { __quoteCalls.push(opts); return __quote }, __quote, __quoteCalls }
})

// Motor kapilari (ATS + fiyat etkisi): composable AYRI testlenir (useStockEngineGates.test.js); burada kontrollu govde.
vi.mock('../../composables/useStockEngineGates', async () => {
    const { reactive } = await import('vue')
    const __gates = reactive({
        ats: { atsFee: null, atsSymbol: 'ATS', loading: false, feeRefundable: false, prepaid: null, decision: null, nextSteps: [], insufficient: false, totalAtsCost: null, opCount: 1, requiredAtsFor: () => null },
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
import { toQuoteResponse } from '../../utils/stocks/engines/pancakeQuote'
import StockTrade from './StockTrade.vue'

const HERE = dirname(fileURLToPath(import.meta.url))
const BSTOCK = BSTOCKS.find((b) => b.underlying === 'TSLA')
const ADDR = '0xAbCdEf0000000000000000000000000000000001'
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'

const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const primaryTag = (html) => (html.match(/<button[^>]*data-trade-primary[^>]*>[\s\S]*?<\/button>/) ?? [''])[0]
const isDisabled = (tag) => / disabled(=|>| )/.test(tag.replace(/class="[^"]*"/, ''))
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

// Gercek pancakeQuote eslemesi: ekran, motorun ortak display'ini oldugu gibi tuketir.
const pancakeResult = (over = {}, extra = {}) => ({
    ...toQuoteResponse(
        { expectedOutput: '0.1', minimumReceived: '0.099', priceImpact: '0.30%', liquidityProviderFee: '0.25%', routerType: { name: 'PancakeSwap', version: '3' }, ...over },
        { side: 'buy', amount: '25', referencePrice: 250, quoteId: 'ps_1', ...extra },
    ),
    request: { side: 'buy', chainId: 56, amount: '25', index: 'i', slippage: 0.5 },
})

function build({ selected = 'bstock', state = {}, amount = '', side = 'buy', locale = 'en', setup, prep } = {}) {
    const stub = installChromeStub({ active_account: { address: ADDR, type: 'imported', key: 'acc1' } })
    const app = createApp(StockTrade)
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === 56)
    const crypto = cryptoStore()
    if (selected === 'bstock') {
        crypto.selected_token_ref = { id: 'b', chainId: 56, address: BSTOCK.address, decimals: BSTOCK.decimals, symbol: BSTOCK.symbol }
    } else if (selected) {
        crypto.selected_token_ref = selected
    }
    pageStore().currentPage = 'stock_trade'
    prep?.()
    Object.assign(__quote, state)
    const holder = captureInstance(app, 'StockTrade', (inst) => {
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
    Object.assign(__quote, { state: 'idle', result: null, quoteId: null, expiresAt: null, errorCode: null, lockReason: null })
    Object.assign(__gates, { atsQuoted: null, atsBlocked: false, extraBlock: null, acknowledged: false, priceImpactHigh: false, priceImpactUnmeasured: false })
    Object.assign(__gates.ats, { atsFee: null, loading: false, decision: null, insufficient: false, totalAtsCost: null, opCount: 1 })
    balanceMock.fn = async () => 1000
    balanceMock.calls.length = 0
    axiosMock.post = vi.fn(async () => ({ status: 200, data: { tokens: [{ coingecko_id: BSTOCK.coingecko_id, image: null, market_data: { priceUSD: 250 } }] } }))
    __quote.refresh.mockClear()
    __quote.invalidate.mockClear()
    __quoteCalls.length = 0
})
afterEach(() => {
    delete globalThis.chrome
})

describe('StockTrade.vue -- bStocks acik ekran', () => {
    it('katalog bStock: ekran acik, sekmeler, BSC odeme tokenleri, ana dugme', async () => {
        const { html } = await mount()
        expect(html).toContain('data-stock-trade')
        expect(html).not.toContain('not available')
        expect(html).toContain('data-trade-tab="buy"')
        expect(html).toContain('data-trade-tab="sell"')
        expect(html).toContain('data-pay-token="USDT"')
        expect(html).toContain('data-pay-token="USDC"')
        expect(text(primaryTag(html))).toBe('Enter amount')
        expect(html).toContain(BSTOCK.symbol)
    })

    it('Al/Sat ekraninda CoW a ozgu metin yok: Powered by CoW, 30 dk, partner ucreti, onay adimi', async () => {
        const { html } = await mount({ amount: '25', state: { state: 'ready', result: pancakeResult(), quoteId: 'ps_1' } })
        const gorunen = html.replace(/<[^>]+>/g, ' ')
        expect(gorunen).not.toMatch(/cow/i)
        expect(gorunen).not.toMatch(/30 min/i)
        expect(html).not.toContain('data-trade-powered')
        expect(html).not.toContain('data-approve-step')
        expect(html).not.toContain('data-trade-network-fee')
        expect(html).not.toContain('GPv2')
    })

    it('hazir teklif: miktar/en az/birim/referans satirlari, fiyat etkisi, dugme etkin "Buy"', async () => {
        const { html } = await mount({ amount: '25', state: { state: 'ready', result: pancakeResult(), quoteId: 'ps_1' } })
        expect(html).toContain('data-trade-fees')
        expect(html).toContain('0.1 ')
        expect(html).toContain('0.099')
        expect(html).toContain('$250.00') // birim fiyat ve referans: 25 / 0.1
        expect(html).toContain('data-trade-price-impact')
        expect(text(html.match(/<div[^>]*data-trade-price-impact[^>]*>[\s\S]*?<\/div>/)[0])).toContain('0.30%')
        expect(isDisabled(primaryTag(html))).toBe(false)
        expect(text(primaryTag(html))).toBe('Buy')
    })

    it('olculemeyen fiyat etkisi "Not measured" ve uyari satiri, dugme etkin', async () => {
        __gates.priceImpactUnmeasured = true
        const { html } = await mount({ amount: '25', state: { state: 'ready', result: pancakeResult({ priceImpact: 'N/A%' }), quoteId: 'ps_1' } })
        expect(text(html.match(/<div[^>]*data-trade-price-impact[^>]*>[\s\S]*?<\/div>/)[0])).toContain('Not measured')
        expect(html).toContain('data-trade-impact-unmeasured')
        expect(isDisabled(primaryTag(html))).toBe(false)
    })

    it('referans farki >= %2: sari uyari satiri, KILIT YOK (dugme etkin, kilit bandi yok)', async () => {
        // 25 / 0.1 = 250; referans 240 -> Al'da +%4.17 (kullanici kotu)
        const result = pancakeResult({}, { referencePrice: 240 })
        const { html } = await mount({ amount: '25', state: { state: 'ready', result, quoteId: 'ps_1' } })
        expect(html).toContain('data-trade-gap-warn')
        expect(text(html.match(/<p[^>]*data-trade-gap-warn[^>]*>[\s\S]*?<\/p>/)[0])).toContain('differs from the reference by +4.17%')
        expect(html).not.toContain('data-trade-lock')
        expect(isDisabled(primaryTag(html))).toBe(false)
    })

    it('referans farki < %2: bilgi satiri, uyari isareti yok', async () => {
        const { html } = await mount({ amount: '25', state: { state: 'ready', result: pancakeResult(), quoteId: 'ps_1' } })
        expect(html).not.toContain('data-trade-gap-warn')
    })

    it('Sat sekmesinde dugme "Sell"', async () => {
        const { html } = await mount({ amount: '1', side: 'sell', state: { state: 'ready', result: pancakeResult(), quoteId: 'ps_1' } })
        expect(text(primaryTag(html))).toBe('Sell')
    })

    it('Turkce: Al dugmesi', async () => {
        const { html } = await mount({ locale: 'tr', amount: '25', state: { state: 'ready', result: pancakeResult(), quoteId: 'ps_1' } })
        expect(text(primaryTag(html))).toBe('Al')
    })
})

describe('StockTrade.vue -- bStocks ATS ucreti ve fiyat etkisi kapilari', () => {
    const ready = () => ({ state: 'ready', result: pancakeResult(), quoteId: 'ps_1' })

    it('ucret yukluyse ATS dokum satirlari ve ATS karti ana ekranda', async () => {
        Object.assign(__gates.ats, { atsFee: 1.5, totalAtsCost: 1.7, opCount: 1 })
        __gates.atsQuoted = { transferFee: 1.5, commissionFee: 0.2 }
        const { html } = await mount({ amount: '25', state: ready() })
        expect(html).toContain('data-trade-ats-fees')
        const bolum = text(html.slice(html.indexOf('data-trade-ats-fees'), html.indexOf('data-stock-ats-card')))
        expect(bolum).toContain('Network fee (ATS)')
        expect(bolum).toContain('Commission (ATS)')
        expect(bolum).toContain('Total fee (ATS)')
        expect(html).toContain('data-stock-ats-card')
    })

    it('bootstrap op (opCount > 1): yalniz toplam satiri', async () => {
        Object.assign(__gates.ats, { atsFee: 1.5, totalAtsCost: 2.9, opCount: 2 })
        __gates.atsQuoted = { transferFee: 1.5, commissionFee: 0.2 }
        const { html } = await mount({ amount: '25', state: ready() })
        const gorunen = text(html)
        expect(gorunen).toContain('Total fee (ATS)')
        expect(gorunen).not.toContain('Network fee (ATS)')
    })

    it('ucret henuz yok: dokum yok, kart (yukleniyor) var, CoW ucret dokumu da yok', async () => {
        __gates.ats.loading = true
        __gates.extraBlock = 'ats-loading'
        const { html } = await mount({ amount: '25', state: ready() })
        expect(html).not.toContain('data-trade-ats-fees')
        expect(html).toContain('data-stock-ats-card')
        expect(text(html)).not.toContain('CoW fee')
        expect(isDisabled(primaryTag(html))).toBe(true)
        expect(text(primaryTag(html))).toBe('Getting quote...')
    })

    it('ATS yetersiz/engelli: dugme kapali, "ATS fee cannot be covered"', async () => {
        for (const extra of ['ats-insufficient', 'ats-blocked']) {
            __gates.extraBlock = extra
            const { html } = await mount({ amount: '25', state: ready() })
            expect(isDisabled(primaryTag(html))).toBe(true)
            expect(text(primaryTag(html))).toBe('ATS fee cannot be covered')
        }
    })

    it('fiyat etkisi > %5: onay kutusu gorunur, onay yokken dugme kapali "Confirm price impact"', async () => {
        __gates.priceImpactHigh = true
        __gates.extraBlock = 'price-impact'
        const { html } = await mount({ amount: '25', state: { state: 'ready', result: pancakeResult({ priceImpact: '7.50%' }), quoteId: 'ps_1' } })
        expect(html).toContain('data-trade-impact')
        expect(html).toContain('data-trade-impact-ack')
        expect(isDisabled(primaryTag(html))).toBe(true)
        expect(text(primaryTag(html))).toBe('Confirm price impact')
    })

    it('onay verilince (extraBlock null) dugme etkin', async () => {
        __gates.priceImpactHigh = true
        __gates.acknowledged = true
        const { html } = await mount({ amount: '25', state: { state: 'ready', result: pancakeResult({ priceImpact: '7.50%' }), quoteId: 'ps_1' } })
        expect(isDisabled(primaryTag(html))).toBe(false)
    })

    it('etki dusukken onay kutusu yok', async () => {
        const { html } = await mount({ amount: '25', state: ready() })
        expect(html).not.toContain('data-trade-impact')
    })

    it('ek kapi, temel kapiyi EZMEZ: tutar yokken "Enter amount"', async () => {
        __gates.extraBlock = 'price-impact'
        const { html } = await mount({ state: ready() })
        expect(text(primaryTag(html))).toBe('Enter amount')
    })

    it('ekran gates ciktilarini StockOrderConfirm a tasir (engine, atsQuoted, atsBlocked)', () => {
        const src = yorumsuz(readFileSync(resolve(HERE, 'StockTrade.vue'), 'utf8'))
        expect(src).toMatch(/<StockOrderConfirm[\s\S]*?:engine="engine"[\s\S]*?:ats-quoted="gates\.atsQuoted"[\s\S]*?:ats-blocked="gates\.atsBlocked"/)
    })
})

describe('StockTrade.vue -- bStocks hata kodlari', () => {
    it.each([
        ['NO_ROUTE', 'No suitable route'],
        ['MULTIPLIER_UNREADABLE', 'multiplier could not be read'],
        ['PRICE_IMPACT_HIGH', 'Price impact is too high'],
        ['ATS_BLOCKED', 'ATS fee could not be covered'],
        ['SWAP_FAILED', 'could not be sent'],
        ['CHAIN_UNSUPPORTED', 'not supported'],
    ])('%s -> okunur metin (UNKNOWN degil)', async (code, parca) => {
        const { html } = await mount({ amount: '25', state: { state: 'error', errorCode: code } })
        expect(html).toContain(parca)
        expect(html).not.toContain('unexpected error')
    })

    it('ag hatasi bStocks te CoW demez (NETWORK -> notr metin)', async () => {
        const { html } = await mount({ amount: '25', state: { state: 'error', errorCode: 'NETWORK' } })
        expect(html).toContain('cannot be reached')
        expect(text(html)).not.toMatch(/cow/i)
    })

    it('bilinmeyen kod UNKNOWN', async () => {
        const { html } = await mount({ amount: '25', state: { state: 'error', errorCode: '<b>x</b>' } })
        expect(html).toContain('An unexpected error occurred')
    })

    it('kucuk tutar ipucu bStocks ta cikmaz (CoW ag ucretine ozgu)', async () => {
        const { html } = await mount({ amount: '1', state: { state: 'error', errorCode: 'AMOUNT_TOO_SMALL' } })
        expect(html).not.toContain('data-trade-min-hint')
    })
})

describe('StockTrade.vue -- motor baglama', () => {
    it('useCowQuote: istek motordan, send motorun quote u; bStocks SWAP_QUOTE, tutar UI dizesi AYNEN', async () => {
        const { stub } = await mount({ amount: '25.5' })
        const opts = __quoteCalls.at(-1)
        const req = toValue(opts.request)
        expect(req).toMatchObject({ side: 'buy', chainId: 56, stockAddress: BSTOCK.address, payToken: USDT_BSC === req.payToken ? USDT_BSC : req.payToken, amount: '25.5' })
        expect(req.referencePrice).toBe(250)
        const sent = []
        stub.setSendMessage(async (m) => {
            sent.push(m)
            return { success: true, data: { expectedOutput: '0.1', minimumReceived: '0.099', priceImpact: '0.30%' } }
        })
        const res = await opts.send(req)
        expect(res.success).toBe(true)
        expect(sent).toHaveLength(1)
        expect(sent[0].type).toBe('SWAP_QUOTE')
        expect(sent[0].message.amount).toBe('25.5')
        expect(sent[0].message.chainId).toBe(56)
        expect(JSON.stringify(sent[0])).not.toContain('referencePrice')
    })

    it('referans fiyat gelmeden teklif istenmez; geldikten sonra acik (sunucu priceUSD)', async () => {
        const { holder } = await mount({ amount: '25' })
        const opts = __quoteCalls.at(-1)
        expect(holder.instance.setupState.refSettled).toBe(true)
        expect(toValue(opts.enabled)).toBe(true)
        holder.instance.setupState.refSettled = false
        expect(toValue(opts.enabled)).toBe(false)
    })

    it('referans fiyat okunamazsa (sunucu hata) teklif yine acilir, referans null', async () => {
        axiosMock.post = vi.fn(async () => { throw new Error('ag') })
        const { holder } = await mount({ amount: '25' })
        const opts = __quoteCalls.at(-1)
        expect(toValue(opts.enabled)).toBe(true)
        expect(toValue(opts.request).referencePrice).toBeNull()
        expect(holder.instance.setupState.refPrice).toBeNull()
    })

    it('odeme tokeni motorun listesinden (engine.payTokens[0]) ve secili', async () => {
        const { holder, html } = await mount()
        const s = holder.instance.setupState
        expect(s.payToken.address).toBe(s.engine.payTokens(56)[0].address)
        expect(html).toContain('data-pay-token')
    })

    it('xStocks hisse: send COW_QUOTE gonderir (cow motoru)', async () => {
        const x = XSTOCKS.find((s) => s.chains.includes(1))
        const { stub } = await mount({ selected: { id: 'x', chainId: 1, address: x.address, decimals: x.decimals, symbol: x.symbol } })
        const opts = __quoteCalls.at(-1)
        const sent = []
        stub.setSendMessage(async (m) => { sent.push(m); return { success: false, code: 'NO_LIQUIDITY' } })
        await opts.send({ side: 'buy', chainId: 1, stockAddress: x.address, payToken: USDT_BSC, amount: '5' })
        expect(sent[0].type).toBe('COW_QUOTE')
    })
})

describe('StockTrade.vue -- pageStore.tradeSide', () => {
    it('sell -> Sat sekmesi acilir ve tradeSide temizlenir', async () => {
        const { holder } = await mount({ prep: () => { pageStore().tradeSide = 'sell' } })
        expect(holder.instance.setupState.side).toBe('sell')
        expect(pageStore().tradeSide).toBeNull()
    })

    it('buy / null / gecersiz -> Al; tradeSide temizlenir', async () => {
        for (const v of ['buy', null, 'xyz']) {
            const { holder } = await mount({ prep: () => { pageStore().tradeSide = v } })
            expect(holder.instance.setupState.side).toBe('buy')
            expect(pageStore().tradeSide).toBeNull()
        }
    })

    it('Sat yonu bakiyeyi HISSE tokeninden okur', async () => {
        await mount({ prep: () => { pageStore().tradeSide = 'sell' } })
        expect(balanceMock.calls.at(-1)[1]).toBe(BSTOCK.address)
    })
})

describe('StockTrade.vue -- ihracci secici', () => {
    it('cift sirket (TSLA): secici iki secenekle gorunur', async () => {
        const { html } = await mount()
        expect(html).toContain('data-issuer-switch')
        expect(html).toContain('data-issuer-option="bstocks"')
        expect(html).toContain('data-issuer-option="xstocks"')
    })

    it('tek ihracci (bStocks only): secici DOM da yok', async () => {
        const only = BSTOCKS.find((b) => !XSTOCKS.some((x) => x.underlying === b.underlying))
        const { html } = await mount({ selected: { id: 'b', chainId: 56, address: only.address, decimals: only.decimals, symbol: only.symbol } })
        expect(html).not.toContain('data-issuer-switch')
        expect(html).toContain('data-trade-primary')
    })

    it('onIssuerSwitched: tutar, teklif, bant sifirlanir; odeme tokeni motor varsayilani', async () => {
        const { holder } = await mount({ amount: '25' })
        const s = holder.instance.setupState
        s.bannerKey = 'stockTrade.quote.updated'
        s.payToken = s.payTokens[1]
        s.onIssuerSwitched()
        expect(s.amount).toBe('')
        expect(s.bannerKey).toBeNull()
        expect(s.payToken.address).toBe(s.payTokens[0].address)
        expect(__quote.invalidate).toHaveBeenCalled()
    })

    it('secici olayi issuerSwitch.pick e baglidir (kaynak taramasi)', () => {
        const src = yorumsuz(readFileSync(resolve(HERE, 'StockTrade.vue'), 'utf8'))
        expect(src).toMatch(/<IssuerSwitch[^>]*@pick="issuerSwitch\.pick"/)
        expect(src).toMatch(/useIssuerSwitch\(\{ onSwitched: onIssuerSwitched/)
    })
})

describe('StockTrade.vue -- kaynak taramasi (motor sinirlari)', () => {
    const src = yorumsuz(readFileSync(resolve(HERE, 'StockTrade.vue'), 'utf8'))

    it('BIRIM SINIRI: carpan / ham birim cevrimi ekranda yok', () => {
        for (const yasak of ['toRawSpendAmount', 'uiMultiplier', 'readUiMultiplier', '1e18', 'parseUnits', 'formatUnits']) {
            expect(src).not.toContain(yasak)
        }
    })

    it('kapi tradeEnabledFor + engineFor ile; bayrak sabiti ekranda dogrudan okunmaz', () => {
        expect(src).toMatch(/tradeEnabledFor\(entry\)/)
        expect(src).toMatch(/engineFor\(stock\.value\)/)
        expect(src).not.toContain('XSTOCKS_ENABLED')
        expect(src).not.toMatch(/issuer === 'xstocks'/)
    })

    it('teklif, istek, odeme tokenleri, satirlar, birincil eylem motordan', () => {
        expect(src).toMatch(/send: \(message\) => engine\.value\.quote\(message\)/)
        expect(src).toMatch(/engine\.value\.buildQuoteMessage\(/)
        expect(src).toMatch(/engine\.value\.payTokens\(/)
        expect(src).toMatch(/engine\.value\.quoteRows\(/)
        expect(src).toMatch(/engine\.value\?\.primaryAction\(/)
        expect(src).not.toMatch(/(^|[^.\w])buildQuoteMessage\(/m) // dogrudan stockTrade.js cagrisi kalmadi
    })

    it('CoW metinleri engine.showsCowDisclosure ile kapili', () => {
        expect(src).toMatch(/v-if="engine\.showsCowDisclosure" data-trade-powered/)
        expect(src).toMatch(/!engine\.value\?\.showsCowDisclosure/)
    })

    it('kullanici girdisi baglari: ATS kurulum dugmesi ve fiyat etkisi onay kutusu', () => {
        expect(src).toMatch(/<StockAtsFeeCard[^>]*@onboard="gates\.startOnboarding"/)
        expect(src).toMatch(/v-model="gates\.acknowledged"/)
    })

    it('mount da tradeSide okunur ve temizlenir', () => {
        expect(src).toMatch(/page\.tradeSide === 'sell' \? 'sell' : 'buy'/)
        expect(src).toMatch(/page\.tradeSide = null/)
    })

    it('mesaj yasaklari: bStocks yolunda COW_PLACE_ORDER / SWAP dogrudan ekranda yok', () => {
        expect(src).not.toContain("type: 'SWAP'")
        expect(src).not.toContain("type: 'COW_PLACE_ORDER'")
        expect(src).not.toContain('SWAP_QUOTE')
    })
})

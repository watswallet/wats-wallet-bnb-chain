// StockTrade.vue -- ilk alim kapisi aynasi (Task 30, K29; spec 6.4). Ekran hesap yapmaz, kapi karari vermez: arka plan karar verir,
// burasi yalniz gosterir. 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
// KOK NEDEN / KAPATILAN HATA: bStocks ve xStocks Al/Sat TEK StockTrade ekranindan gecer; arka plan kapisi ciktiyi yakalar ama ekranda
// bant ve motor eslemesi yoktu: engelli kullanici cikmaza giriyor (teklifte UNKNOWN, yurutmede SWAP_FAILED), ihracci degisince
// bayat bant gorunuyordu. Iki ihracci icin TEK ayna: kaynak stock.issuer ve side'dan reaktif turer. K32: beyan yok; kapali kapida
// ana dugme HER ZAMAN pasif ve tiklama hicbir sey yapmaz. Senaryolar kararin GERCEKTEN urettigi nedenlerle kurulur.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Ortak sahte kapi (test-utils/useStockGateMock.js): senaryo gateMock.scenario ile surulur.
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
        ats: { atsFee: null, atsSymbol: 'ATS', loading: false, errorCode: null, feeRefundable: false, prepaid: null, decision: null, nextSteps: [], insufficient: false, totalAtsCost: null, opCount: 1, requiredAtsFor: () => null },
        atsQuoted: null, atsBlocked: false, atsBlock: null, extraBlock: null,
        acknowledged: false, priceImpactHigh: false, priceImpactUnmeasured: false,
        startOnboarding: vi.fn(),
    })
    return { useStockEngineGates: () => __gates, __gates }
})

const balanceMock = vi.hoisted(() => ({ fn: async () => 1000 }))
vi.mock('../../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => balanceMock.fn(...args) }))

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
vi.mock('axios', () => ({ default: { post: async () => ({ status: 200, data: { tokens: [] } }) } }))
vi.mock('../../utils/applyNetworkChange', () => ({ applyNetworkChange: async () => true }))

import { createApp, render, installChromeStub, createTestPinia, createTestI18n, captureInstance } from '../../test-utils/ssrRender.js'
import { yorumsuz, cagriGovdesi, blokGovdesi } from '../../test-utils/kaynakTarama.js'
import { butonlar, devreDisi } from '../../test-utils/ssrHtmlYardimcilari'
import {
    gateMock, resetGateMock, GATE_OK, GATE_WARN, GATE_CHECKING, gateBlocked,
} from '../../test-utils/useStockGateMock.js'
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
import { gateLockedReply, STOCK_GATE_REASONS } from '../../utils/stockGate/errors'
import en from '../../i18n/locales/en.json'
import StockTrade from './StockTrade.vue'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADDR = '0xAbCdEf0000000000000000000000000000000001'
const NEXT = '2026-10-19T13:30:00Z'

// G2: katalog icerigine sabitlenmez.
const X_STOCK = XSTOCKS.find((s) => s.chains.includes(1))
const B_STOCK = BSTOCKS[0]
const ISSUERS = [
    { issuer: 'xstocks', chainId: 1, stock: X_STOCK },
    { issuer: 'bstocks', chainId: 56, stock: B_STOCK },
]

// Kararin urettigi kilit nedenleri (decide.js); gateCta.js listesindeki olu adlar yalniz gateCta.test.js'te sinanir.
const CANLI_NEDENLER = ['KILL_SWITCH', 'IP_COUNTRY_ISSUER', 'IP_COUNTRY_PRECAUTION', 'COUNTRY_UNKNOWN']
const KILITLI_SENARYOLAR = [
    ['checking', GATE_CHECKING],
    ['IP_COUNTRY_ISSUER', gateBlocked('IP_COUNTRY_ISSUER', { ipCountry: 'TR' })],
    ['IP_COUNTRY_PRECAUTION', gateBlocked('IP_COUNTRY_PRECAUTION', { ipCountry: 'DE' })],
    ['COUNTRY_UNKNOWN', gateBlocked('COUNTRY_UNKNOWN')],
    ['KILL_SWITCH', gateBlocked('KILL_SWITCH')],
]

const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '') // G3
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const primaryTag = (html) => (html.match(/<button[^>]*data-trade-primary[^>]*>[\s\S]*?<\/button>/) ?? [''])[0]
const isDisabled = (tag) => / disabled(=|>| )/.test(tag.replace(/class="[^"]*"/, ''))
const amountTag = (html) => (html.match(/<input[^>]*data-trade-amount[^>]*>/) ?? [''])[0]
const chips = (html) => butonlar(html).filter((b) => b.nitelikler.includes('px-1.5 py-0.5'))
const lockText = (html) => text((html.match(/<[a-z]+[^>]*data-trade-lock[^>]*>[\s\S]*?<\/(?:div|p)>/) ?? [''])[0])
const KACIS = { '"': '&quot;', '&': '&amp;', "'": '&#39;', '<': '&lt;', '>': '&gt;' }
const esc = (s) => String(s).replace(/["&'<>]/g, (c) => KACIS[c])
const en_ = (key) => esc(key.split('.').reduce((o, k) => o?.[k], en)) // dil dosyasindan beklenen metin (sabit dize yok)
const ctaText = (html) => text(primaryTag(html))

const cowReady = (over = {}) => ({
    success: true, locked: false, lockReason: null, quoteId: 'q1',
    display: {
        sellAmount: '10000000', sellDecimals: 6, expectedBuy: '45000000000000000', buyDecimals: 18, minBuy: '44000000000000000',
        unitPrice: 222.2, referencePrice: 222, gapPct: 0.09, locked: false,
        fees: { networkUsd: 0.1, cowUsd: 0.05, watsUsd: 0.01, totalUsd: 0.16 },
    },
    approval: { mode: 'permit' }, notice: { state: 'open', nextChangeAt: null }, warnings: [],
    ...over,
})
const pancakeReady = () => ({
    ...toQuoteResponse(
        { expectedOutput: '0.1', minimumReceived: '0.099', priceImpact: '0.30%', liquidityProviderFee: '0.25%', routerType: { name: 'PancakeSwap', version: '3' } },
        { side: 'buy', amount: '25', referencePrice: 250, quoteId: 'ps_1' },
    ),
    request: { side: 'buy', chainId: 56, amount: '25', index: 'i', slippage: 0.5 },
})
const readyOf = (F, over) => (F.issuer === 'xstocks' ? cowReady(over) : pancakeReady())

function build(F, { state = {}, amount = '', side = 'buy', locale = 'en', selected = true, setup } = {}) {
    installChromeStub({ active_account: { address: ADDR, type: 'imported', key: 'acc1' } })
    const app = createApp(StockTrade)
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === F.chainId)
    if (selected) {
        cryptoStore().selected_token_ref = { id: F.issuer, chainId: F.chainId, address: F.stock.address, decimals: F.stock.decimals, symbol: F.stock.symbol }
    }
    pageStore().currentPage = 'stock_trade'
    Object.assign(__quote, state)
    const holder = captureInstance(app, 'StockTrade', (inst) => {
        if (side !== 'buy') inst.setupState.side = side
        if (amount) inst.setupState.amount = amount
        setup?.(inst.setupState)
    })
    return { app, holder }
}

async function mount(F, opts) {
    const { app, holder } = build(F, opts)
    const html = clean(await render(app))
    return { html, holder, st: () => holder.instance.setupState }
}
const quoteEnabled = () => toValue(__quoteCalls.at(-1).enabled)

beforeEach(() => {
    resetGateMock()
    Object.assign(__quote, { state: 'idle', result: null, quoteId: null, expiresAt: null, errorCode: null, errorInfo: null, lockReason: null })
    __quote.refresh.mockClear()
    __quote.invalidate.mockClear()
    __quoteCalls.length = 0
    Object.assign(__gates, { atsBlocked: false, atsBlock: null, extraBlock: null })
    __gates.ats.errorCode = null
    __gates.atsQuoted = null
    Object.assign(__gates.ats, { atsFee: null, totalAtsCost: null, opCount: 1 })
    // Atom bilinen bakiye: yuzde cipleri bakiye yuzunden degil, YALNIZ kapi yuzunden pasif olabilsin.
    balanceMock.fn = async () => ({ balance: 1000, atoms: 1000n * 10n ** 18n, decimals: 18 })
})
afterEach(() => {
    delete globalThis.chrome
})

describe.each(ISSUERS)('StockTrade.vue kapi aynasi -- $issuer', (F) => {
    it('kapi kaynagi stock.issuer ve side tan REAKTIF turer: Al -> ihracci, Sat -> null (sabit ihracci YOK)', async () => {
        const { st } = await mount(F)
        const kaynak = gateMock.getters.at(-1)
        expect(typeof kaynak).toBe('function')
        expect(kaynak()).toBe(F.issuer)
        st().side = 'sell'
        expect(kaynak()).toBeNull()
        st().side = 'buy'
        expect(kaynak()).toBe(F.issuer)
    })

    it('secili hisse yoksa kaynak null (kapi sorulmaz)', async () => {
        await mount(F, { selected: false })
        expect(gateMock.getters.at(-1)()).toBeNull()
    })

    it('engelli (IP_COUNTRY_ISSUER): bant engelli, teklif istenmez, tutar girdisi ve tum yuzde cipleri pasif', async () => {
        resetGateMock(gateBlocked('IP_COUNTRY_ISSUER', { ipCountry: 'TR' }))
        const { html } = await mount(F)
        expect(html).toContain('data-stock-gate="blocked"')
        expect(html).toContain('data-stock-gate-reason="IP_COUNTRY_ISSUER"')
        expect(quoteEnabled()).toBe(false)
        expect(isDisabled(amountTag(html))).toBe(true)
        const c = chips(html)
        expect(c.length).toBeGreaterThan(0)
        for (const b of c) expect(devreDisi(b)).toBe(true)
    })

    it('pozitif bekci: kapi ACIKKEN ayni ekranda teklif istenir, girdi ve cipler etkindir', async () => {
        const { html } = await mount(F)
        expect(quoteEnabled()).toBe(true)
        expect(isDisabled(amountTag(html))).toBe(false)
        const c = chips(html)
        expect(c.length).toBeGreaterThan(0)
        for (const b of c) expect(devreDisi(b)).toBe(false)
    })

    it('engelli: ana dugme PASIF, etiket nedeni soyler, blockReason stock-gate ve kirmizi kilit satiri YOK (PE5)', async () => {
        resetGateMock(gateBlocked('IP_COUNTRY_ISSUER', { ipCountry: 'TR' }))
        const { html, st } = await mount(F, { amount: '10' })
        expect(isDisabled(primaryTag(html))).toBe(true)
        expect(ctaText(html)).toBe(en_('stockGate.cta.IP_COUNTRY_ISSUER'))
        expect(st().blockReason).toBe('stock-gate')
        expect(html).not.toContain('data-trade-lock')
    })

    it.each(CANLI_NEDENLER)('pasif neden %s: dugme PASIF ve kisa etiket stockGate.cta.<neden>', async (reason) => {
        resetGateMock(gateBlocked(reason))
        const { html } = await mount(F, { amount: '10' })
        expect(isDisabled(primaryTag(html))).toBe(true)
        expect(ctaText(html)).toBe(en_(`stockGate.cta.${reason}`))
    })

    it('kontrol ediliyor (checking): dugme PASIF "Checking", teklif istenmez', async () => {
        resetGateMock(GATE_CHECKING)
        const { html } = await mount(F, { amount: '10' })
        expect(isDisabled(primaryTag(html))).toBe(true)
        expect(ctaText(html)).toBe(en_('stockGate.cta.checking'))
        expect(quoteEnabled()).toBe(false)
    })

    it.each(KILITLI_SENARYOLAR)('kapali kapida (%s) ana dugme PASIF; tiklama sayfa degistirmez, onay / teklif baslatmaz, veri yazmaz', async (_ad, senaryo) => {
        resetGateMock(senaryo)
        const { html, st } = await mount(F, { amount: '10', state: { state: 'ready', result: readyOf(F) } })
        expect(isDisabled(primaryTag(html))).toBe(true)
        expect(st().blockReason).toBe('stock-gate')
        expect(pageStore().currentPage).toBe('stock_trade')
        expect(pageStore().data).toBeNull()
        st().onPrimary()
        expect(pageStore().currentPage).toBe('stock_trade')
        expect(pageStore().data).toBeNull()
        expect(st().confirmOpen).toBe(false)
        expect(st().approveOpen).toBe(false)
        expect(__quote.refresh).not.toHaveBeenCalled()
        expect(gateMock.refreshCalls).toBe(0)
    })

    it('Sat: bant yok, kapi sorulmaz, teklif gider, dugme kapi etiketi tasimaz (engelli senaryoda bile)', async () => {
        resetGateMock(gateBlocked('IP_COUNTRY_ISSUER', { ipCountry: 'TR' }))
        const { html, st } = await mount(F, { side: 'sell', amount: '1', state: { state: 'ready', result: readyOf(F) } })
        expect(gateMock.getters.at(-1)()).toBeNull()
        expect(html).not.toContain('data-stock-gate')
        expect(quoteEnabled()).toBe(true)
        expect(st().blockReason).toBeNull()
        expect(isDisabled(primaryTag(html))).toBe(false)
        expect(ctaText(html)).toBe(en_('stockTrade.btn.sell'))
    })

    it('kapi ACIK (ok / warn): bant hatirlatma ya da uyari gosterir, dugme etkin "Buy" (bugunku davranis)', async () => {
        for (const senaryo of [GATE_OK, GATE_WARN]) {
            resetGateMock(senaryo)
            const { html, st } = await mount(F, { amount: '10', state: { state: 'ready', result: readyOf(F) } })
            expect(html).toContain(`data-stock-gate="${senaryo.state}"`)
            expect(st().blockReason).toBeNull()
            expect(isDisabled(primaryTag(html))).toBe(false)
            expect(ctaText(html)).toBe(en_('stockTrade.btn.buy'))
        }
    })

    it('Sat sekmesinde bant cizilmez (kapi idle)', async () => {
        resetGateMock(GATE_OK)
        const { html } = await mount(F, { side: 'sell' })
        expect(html).not.toContain('data-stock-gate')
    })

    it('yaris: kapi ACIK derken teklif STOCK_GATE kilidi dondururse genel yedek satir gorunur ve kapi yeniden sorulur', async () => {
        resetGateMock(GATE_OK)
        const { html, st } = await mount(F, {
            amount: '10',
            state: { state: 'locked', lockReason: 'STOCK_GATE', result: gateLockedReply('IP_COUNTRY_ISSUER') },
        })
        expect(lockText(html)).toBe(en_('stockTrade.lock.STOCK_GATE'))
        expect(gateMock.refreshCalls).toBeGreaterThanOrEqual(1)
        expect(st().blockReason).toBe('lock-STOCK_GATE')
        expect(isDisabled(primaryTag(html))).toBe(true)
    })

    it('yaris: ulke gerektirmeyen neden (KILL_SWITCH) kendi stockGate.lock metniyle gorunur', async () => {
        const { html } = await mount(F, {
            amount: '10',
            state: { state: 'locked', lockReason: 'STOCK_GATE', result: gateLockedReply('KILL_SWITCH') },
        })
        expect(lockText(html)).toBe(en_('stockGate.lock.KILL_SWITCH'))
    })

    it('kapi KAPALIYKEN gelen STOCK_GATE kilidi ikinci kez yazilmaz (bant nedeni soyler)', async () => {
        resetGateMock(gateBlocked('KILL_SWITCH'))
        const { html } = await mount(F, {
            amount: '10',
            state: { state: 'locked', lockReason: 'STOCK_GATE', result: gateLockedReply('KILL_SWITCH') },
        })
        expect(html).not.toContain('data-trade-lock')
    })

    it('onConfirmExpired({ code: STOCK_GATE }) katmani kapatir ve kapiyi yeniden sorar; baska kodda sormaz', async () => {
        const { st } = await mount(F, { amount: '10' })
        const once = gateMock.refreshCalls
        st().onConfirmExpired({ code: 'QUOTE_EXPIRED' })
        expect(gateMock.refreshCalls).toBe(once)
        st().onConfirmExpired({ code: 'STOCK_GATE' })
        expect(gateMock.refreshCalls).toBe(once + 1)
        expect(st().confirmOpen).toBe(false)
    })

    it('openApprove ve onPrimary kapi kapaliyken DOGRUDAN cagrilsa da onay adimi / katman acilmaz', async () => {
        resetGateMock(gateBlocked('IP_COUNTRY_ISSUER', { ipCountry: 'TR' }))
        const { st } = await mount(F, { amount: '10', state: { state: 'ready', result: readyOf(F, { approval: { mode: 'onchain' } }) } })
        await st().openApprove()
        st().onPrimary()
        expect(st().approveOpen).toBe(false)
        expect(st().confirmOpen).toBe(false)
    })

    it('render ve setup sonrasi sayfa ve veri degismez (kapali kapida ekrandan baska ekrana gidis yolu yok)', async () => {
        resetGateMock(gateBlocked('IP_COUNTRY_ISSUER', { ipCountry: 'TR' }))
        await mount(F, { amount: '10' })
        expect(pageStore().currentPage).toBe('stock_trade')
        expect(pageStore().data).toBeNull()
    })
})

describe('StockTrade.vue kapi aynasi -- ihraccidan bagimsiz davranislar', () => {
    const X = ISSUERS[0]
    const B = ISSUERS[1]

    it('ihracci gecisi: selected_token_ref baska ihracciya donunce kapi kaynagi yeni ihracciyi verir (bayat bant YOK)', async () => {
        await mount(X)
        const kaynak = gateMock.getters.at(-1)
        expect(kaynak()).toBe('xstocks')
        cryptoStore().selected_token_ref = { id: B.issuer, chainId: B.chainId, address: B.stock.address, decimals: B.stock.decimals, symbol: B.stock.symbol }
        expect(kaynak()).toBe('bstocks')
        cryptoStore().selected_token_ref = null
        expect(kaynak()).toBeNull()
    })

    it('ihracci gecisi: kapi ihracci BASINA farkli karar verince blockReason ve teklif YENI ihracciya gore degisir (bayat bant YOK)', async () => {
        gateMock.byIssuer = { xstocks: GATE_OK, bstocks: gateBlocked('IP_COUNTRY_ISSUER', { ipCountry: 'TR' }) }
        const { st } = await mount(X, { amount: '10', state: { state: 'ready', result: readyOf(X) } })
        expect(st().blockReason).toBeNull()
        expect(quoteEnabled()).toBe(true)
        const sec = (F) => { cryptoStore().selected_token_ref = { id: F.issuer, chainId: F.chainId, address: F.stock.address, decimals: F.stock.decimals, symbol: F.stock.symbol } }
        sec(B)
        expect(st().stockGate.state).toBe('blocked')
        expect(st().blockReason).toBe('stock-gate')
        expect(quoteEnabled()).toBe(false)
        sec(X)
        expect(st().stockGate.state).toBe('ok')
        expect(st().blockReason).toBeNull()
        expect(quoteEnabled()).toBe(true)
    })

    it.each([
        ['kapi hala ACIK gorunur (yenileme sonrasi da)', GATE_OK, 'stockGate.cta.checking'],
        ['kapi KAPALI (IP_COUNTRY_ISSUER)', gateBlocked('IP_COUNTRY_ISSUER', { ipCountry: 'TR' }), 'stockGate.cta.IP_COUNTRY_ISSUER'],
    ])('bStocks: ATS ucret teklifi STOCK_GATE ile reddedilince kapi yeniden sorulur ve dugme "ATS engeli" demez: %s', async (_ad, senaryo, etiketAnahtari) => {
        resetGateMock(senaryo)
        __gates.ats.errorCode = 'STOCK_GATE'
        __gates.atsBlocked = true
        __gates.atsBlock = 'ats-blocked'
        __gates.extraBlock = 'ats-blocked'
        const { html, st } = await mount(B, { amount: '10', state: { state: 'ready', result: readyOf(B) } })
        expect(gateMock.refreshCalls).toBeGreaterThanOrEqual(1)
        expect(isDisabled(primaryTag(html))).toBe(true)
        expect(ctaText(html)).toBe(en_(etiketAnahtari))
        expect(ctaText(html)).not.toBe(en_('stockTrade.btn.atsBlocked'))
        expect(st().blockReason).toBe(senaryo === GATE_OK ? 'ats-blocked' : 'stock-gate')
    })

    it('ATS hata kodu STOCK_GATE DEGILSE (baska ATS engeli) bugunku etiket korunur ve kapi yeniden sorulmaz', async () => {
        __gates.ats.errorCode = 'INSUFFICIENT_ATS'
        __gates.atsBlocked = true
        __gates.atsBlock = 'ats-blocked'
        __gates.extraBlock = 'ats-blocked'
        const { html } = await mount(B, { amount: '10', state: { state: 'ready', result: readyOf(B) } })
        expect(gateMock.refreshCalls).toBe(0)
        expect(ctaText(html)).toBe(en_('stockTrade.btn.atsBlocked'))
    })

    // UI-5: fiyat etkisi kutusunun kilitte gizliligi BURADA sinanmaz: useStockEngineGates sahtedir (priceImpactHigh sabit false), bir
    // `data-trade-impact` yoklugu iddiasi bos gecerdi. Kosul gercek kancadadir (gated = ... quote.state === 'ready') ve
    // useStockEngineGates.test.js'te 'teklif KILITLI iken priceImpactHigh false' testiyle kilitlidir.
    it('bStocks: STOCK_GATE kilidinde ATS ucret karti cikmaz (spec 6.4, U1); ATS ucreti yuklu olsa bile', async () => {
        resetGateMock(GATE_OK)
        Object.assign(__gates.ats, { atsFee: 1.5, totalAtsCost: 1.7, opCount: 1 })
        __gates.atsQuoted = { transferFee: 1.5, commissionFee: 0.2 }
        const { html, st } = await mount(B, {
            amount: '10',
            state: { state: 'locked', lockReason: 'STOCK_GATE', result: gateLockedReply('IP_COUNTRY_ISSUER') },
        })
        expect(st().engine.id).toBe('pancake')
        expect(st().quote.state).toBe('locked')
        expect(html).not.toContain('data-trade-ats-fees')
        expect(html).not.toContain('data-stock-ats-card')
        expect(html).toContain('data-trade-lock')
    })

    it('sebep sirasi (PE4): kapi ACIK + piyasa kapali -> lock-MARKET_CLOSED ve kirmizi kilit satiri GORUNUR (bugunku davranis; asagidaki not.toContain testinin pozitif bekcisi)', async () => {
        resetGateMock(GATE_OK)
        const { html, st } = await mount(X, { amount: '10', setup: (s) => { s.market = { state: 'closed', nextChangeAt: NEXT } } })
        expect(st().marketBlocked).toBe(true)
        expect(st().blockReason).toBe('lock-MARKET_CLOSED')
        expect(html).toContain('data-trade-lock')
    })

    it('sebep sirasi (PE4, PE5): kapi KAPALI + piyasa kapali -> stock-gate; "piyasa kapali" kirmizi satiri CIZILMEZ (cift metin YOK)', async () => {
        resetGateMock(gateBlocked('IP_COUNTRY_ISSUER', { ipCountry: 'TR' }))
        const { html, st } = await mount(X, { amount: '10', setup: (s) => { s.market = { state: 'closed', nextChangeAt: NEXT } } })
        expect(st().marketBlocked).toBe(true)
        expect(st().blockReason).toBe('stock-gate')
        expect(html).toContain('data-stock-gate="blocked"')
        expect(html).not.toContain('data-trade-lock')
    })

    it('hesap yokken once no-account (kapi hesapsiz kullaniciyi gizlemez)', async () => {
        resetGateMock(gateBlocked('IP_COUNTRY_ISSUER', { ipCountry: 'TR' }))
        const { app, holder } = build(X, { amount: '10' })
        installChromeStub({})
        const html = clean(await render(app))
        expect(holder.instance.setupState.blockReason).toBe('no-account')
        expect(isDisabled(primaryTag(html))).toBe(true)
    })

    it('5 nedenin HEPSI icin kapi kapaliyken blockReason stock-gate ve teklif kapali (kume tamlik bekcisi; kapali yon neden adina bakmaz)', async () => {
        expect(STOCK_GATE_REASONS).toHaveLength(5)
        for (const reason of STOCK_GATE_REASONS) {
            resetGateMock(gateBlocked(reason))
            const { st } = await mount(X, { amount: '10' })
            expect(st().blockReason, reason).toBe('stock-gate')
            expect(quoteEnabled(), reason).toBe(false)
        }
    })
})

describe('StockTrade.vue kapi aynasi -- kaynak taramasi', () => {
    const ham = readFileSync(resolve(HERE, 'StockTrade.vue'), 'utf8')
    const kod = yorumsuz(ham)

    it('useStockGate kaynagi stock.issuer ve side tan turer; argumanda ihracci dize sabiti YOK', () => {
        const arg = cagriGovdesi(ham, /\buseStockGate\(/)
        expect(arg, 'useStockGate( cagrisi yok').toBeTruthy()
        expect(arg).toContain("side.value === 'buy'")
        expect(arg).toContain('stock.value.issuer')
        expect(arg).not.toMatch(/['"](?:bstocks|xstocks)['"]/)
    })

    it('ana dugme: kapi kapaliyken (blockReason !== null) HER ZAMAN pasif; onPrimary blockReason kapali ise hicbir sey yapmaz', () => {
        expect(kod).toContain(':disabled="blockReason !== null"')
        expect(kod).not.toContain('gateActionCta')
        const govde = blokGovdesi(ham, /function onPrimary\(\)\s*/)
        expect(govde, 'onPrimary govdesi bulunamadi').toBeTruthy()
        expect(govde).toContain("if (quote.state !== 'ready' || blockReason.value !== null) return")
        expect(govde.indexOf("blockReason.value !== null) return")).toBeLessThan(govde.indexOf("primaryAction.value === 'approve'"))
    })

    it('kaynakta openGate|gateActionCta|leavingForGate|stock_gate yok; bant sayfa gecisi prop u tasimaz; currentPage yazimi yok', () => {
        expect(kod).toMatch(/<StockGateBand\b[^>]*:issuer="stock\.issuer"/) // pozitif bekci: tarama gercek kaynagi goruyor
        expect(kod).not.toMatch(/openGate|gateActionCta|leavingForGate|stock_gate|goToGate|return-page|returnPage/)
        expect(kod).not.toMatch(/currentPage\s*=/)
        expect(kod).not.toContain("mode === 'action'")
    })

    it('yaris izleyicileri: teklif STOCK_GATE kilidi ve onay adimi STOCK_GATE hatasi kapiyi yeniden sorar (immediate)', () => {
        expect(kod).toMatch(/watch\(\(\) => quote\.state === 'locked' && quote\.lockReason === 'STOCK_GATE'[^\n]*stockGate\.refresh\(\)[^\n]*immediate: true/)
        expect(kod).toMatch(/watch\(\(\) => approveStep\.errorCode === 'STOCK_GATE'[^\n]*stockGate\.refresh\(\)[^\n]*immediate: true/)
        expect(kod).toMatch(/watch\(\(\) => gates\.ats\.errorCode === 'STOCK_GATE'[^\n]*stockGate\.refresh\(\)[^\n]*immediate: true/)
    })

    it('ihracci ve zincir gecis bilesenleri kapiya baglanmaz (gecis dugmeleri kilitlenmez, yalniz Al CTA kapanir)', () => {
        expect(kod).toMatch(/<IssuerSwitch\b(?![^>]*stockGate)[^>]*>/)
        expect(kod).toMatch(/<StockChainPicker\b(?![^>]*stockGate)[^>]*>/)
    })
})

// Task 42 (K38): salt okunur "Ne sahip oluyorsun?" karti -- ihracci bilgisi yaninda baglanti + Al sekmesinde band hatirlatmasi.
describe.each(ISSUERS)('StockTrade.vue salt okunur kart girisi -- $issuer', (F) => {
    it('StockTrade ssr: ihracci bilgisi yaninda baglanti (basliktaki rozetin altinda) ve Al sekmesinde band hatirlatma dugmesi', async () => {
        resetGateMock(GATE_OK)
        const { html } = await mount(F)
        const dugmeler = butonlar(html).filter((b) => b.nitelikler.includes('data-stock-card-open'))
        expect(dugmeler).toHaveLength(2)
        // basliktaki baglanti yalniz etiket; bandin dugmesi hatirlatma metni + ayni etiket
        expect(dugmeler[0].metin).toBe(en_('stockGate.card.open'))
        expect(dugmeler[1].metin.endsWith(en_('stockGate.card.open'))).toBe(true)
        expect(dugmeler[1].metin).toContain(en_(`stockGate.reminder.${F.issuer}`))
        // ilk baglanti ihracci rozetinden SONRA, bandin hatirlatmasindan ONCE gelir
        expect(html.indexOf('data-stock-card-open')).toBeGreaterThan(html.indexOf(en_(F.issuer === 'xstocks' ? 'token.xStockBadge' : 'token.bStockBadge')))
        expect(html.indexOf('data-stock-card-open')).toBeLessThan(html.indexOf('data-stock-gate-reminder'))
    })

    it('Al sekmesinde band openable; Sat sekmesinde band hatirlatma dugmesi yok', async () => {
        resetGateMock(GATE_WARN)
        const buy = await mount(F)
        expect(butonlar(buy.html).filter((b) => b.nitelikler.includes('data-stock-card-open'))).toHaveLength(2)
        const sell = await mount(F, { side: 'sell' })
        expect(sell.html).not.toContain('data-stock-gate-reminder')
        expect(butonlar(sell.html).filter((b) => b.nitelikler.includes('data-stock-card-open'))).toHaveLength(1)
    })

    it('kilitli bant (blocked / checking) hatirlatma dugmesi tasimaz; ihracci baglantisi kalir (kart salt okunur, kilit onu kapatmaz)', async () => {
        for (const [ad, g] of KILITLI_SENARYOLAR) {
            resetGateMock(g)
            const { html } = await mount(F)
            expect(butonlar(html).filter((b) => b.nitelikler.includes('data-stock-card-open')), ad).toHaveLength(1)
            expect(html, ad).not.toContain('data-stock-gate-reminder')
        }
    })

    it('kart varsayilan KAPALI (render sirasinda acilmaz); cardOpen ihracciya ayarlaninca kart cizilir ve ekran korunur', async () => {
        resetGateMock(GATE_OK)
        const kapali = await mount(F, { amount: '25' })
        expect(kapali.st().cardOpen).toBeNull()
        expect(kapali.html).not.toContain('data-stock-card="')
        const acik = await mount(F, { amount: '25', setup: (s) => { s.cardOpen = F.issuer } })
        expect(acik.html).toContain(`data-stock-card="${F.issuer}"`)
        expect(acik.html).toContain('data-gate-attribution')
        // alttaki ekran oldugu gibi: tutar, sekme, bant
        expect(acik.st().amount).toBe('25')
        expect(acik.st().side).toBe('buy')
        expect(acik.html).toContain('data-trade-amount')
    })

    it('kaynak: cardOpen YALNIZ tiklamada yazilir (setup ta null); band olayi ve baglanti yalniz yerel ref e yazar', () => {
        const kod = yorumsuz(readFileSync(resolve(HERE, 'StockTrade.vue'), 'utf8'))
        expect(kod).toContain('const cardOpen = ref(null)')
        expect(kod).toContain('@open-card="cardOpen = $event"')
        expect(kod).toContain(':openable="side === \'buy\'"')
        expect(kod).toContain('@click="cardOpen = stock.issuer"')
        expect(kod).toContain('<StockCardSheet :issuer="cardOpen" :open="cardOpen !== null" @close="cardOpen = null" />')
        expect(kod.split('cardOpen.value')).toHaveLength(1)
    })
})

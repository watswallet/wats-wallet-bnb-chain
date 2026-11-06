// StockTrade.vue (Task 21): Al/Sat ana ekrani. Ekran hesap yapmaz, kilit vermez; yalniz gosterir.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// useCowQuote: sabit reaktif nesne (test durumunu doldurur). Ag/zamanlayici yok.
vi.mock('../../composables/useCowQuote', async () => {
    const { reactive } = await import('vue')
    const __quote = reactive({
        state: 'idle', result: null, quoteId: null, expiresAt: null, errorCode: null, errorInfo: null, lockReason: null,
        refresh: vi.fn(), invalidate: vi.fn(),
    })
    const __quoteCalls = []
    return { useCowQuote: (opts) => { __quoteCalls.push(opts); return __quote }, __quote, __quoteCalls }
})

const balanceMock = vi.hoisted(() => ({ fn: async () => 1000, calls: [] }))
vi.mock('../../composables/useTokenBalance', () => ({
    useTokenBalance: (...args) => {
        balanceMock.calls.push(args)
        return balanceMock.fn(...args)
    },
}))

// ATS ayari: gercek ATS_CHAINS ortam degiskenlerine bagli; onay adimi testleri sabit yapilandirma ister.
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

const atsBuyMock = vi.hoisted(() => ({ live: true, open: vi.fn(async () => true) }))
vi.mock('../../composables/useAtsPurchase', () => ({
    useAtsPurchase: () => ({ live: atsBuyMock.live, open: atsBuyMock.open }),
}))

// Hisse logosu: Hisseler listesiyle AYNI kaynak (/getTokensDataById -> image).
const axiosMock = vi.hoisted(() => ({ post: vi.fn(async () => ({ status: 200, data: { tokens: [] } })) }))
vi.mock('axios', () => ({ default: { post: (...a) => axiosMock.post(...a) } }))

const applyMock = vi.hoisted(() => ({ fn: async () => true }))
vi.mock('../../utils/applyNetworkChange', () => ({ applyNetworkChange: (...a) => applyMock.fn(...a) }))

import { createApp, render, installChromeStub, createTestPinia, createTestI18n, captureInstance } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { __quote, __quoteCalls } from '../../composables/useCowQuote'
import { toValue } from 'vue'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import { pageStore } from '../../store/pageStore'
import { ALL_CHAINS } from '../../data/chains'
import { XSTOCKS } from '../../data/xStocks'
import { formatLocalTime } from '../../utils/stockTrade'
import { rpcUrlsOf } from '../../utils/vm'
import StockTrade from './StockTrade.vue'

const HERE = dirname(fileURLToPath(import.meta.url))
const STOCK = XSTOCKS.find((s) => s.chains.includes(1)) // G2
const chain = (id) => ALL_CHAINS.find((c) => c.chainId === id)
const ADDR = '0xAbCdEf0000000000000000000000000000000001'
const NEXT = '2026-10-19T13:30:00Z'

const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '') // G3
const primaryTag = (html) => (html.match(/<button[^>]*data-trade-primary[^>]*>[\s\S]*?<\/button>/) ?? [''])[0]
const isDisabled = (tag) => / disabled(=|>| )/.test(tag.replace(/class="[^"]*"/, ''))
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const lockText = (html) => text((html.match(/<[a-z]+[^>]*data-trade-lock[^>]*>[\s\S]*?<\/(?:div|p)>/) ?? [''])[0])

const readyResult = (over = {}) => ({
    success: true,
    locked: false,
    lockReason: null,
    quoteId: 'q1',
    display: {
        sellAmount: '10000000', sellDecimals: 6, expectedBuy: '45000000000000000', buyDecimals: 18, minBuy: '44000000000000000',
        unitPrice: 222.2, referencePrice: 222, gapPct: 0.09, locked: false,
        fees: { networkUsd: 0.1, cowUsd: 0.05, watsUsd: 0.01, totalUsd: 0.16 },
    },
    approval: { mode: 'permit' },
    notice: { state: 'open', nextChangeAt: null },
    warnings: [],
    ...over,
})

function build({ chainId = 1, selected = 'stock', state = {}, amount = '', side = 'buy', locale = 'en', setup, prep } = {}) {
    const stub = installChromeStub({ active_account: { address: ADDR, key: 'acc1' } })
    const app = createApp(StockTrade)
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    networkStore().currentNetwork = chain(chainId)
    const crypto = cryptoStore()
    if (selected === 'stock') {
        crypto.selected_token_ref = { id: 'x', chainId: 1, address: STOCK.address, decimals: STOCK.decimals, symbol: STOCK.symbol }
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
    Object.assign(__quote, { state: 'idle', result: null, quoteId: null, expiresAt: null, errorCode: null, errorInfo: null, lockReason: null })
    balanceMock.fn = async () => 1000
    balanceMock.calls.length = 0
    applyMock.fn = vi.fn(async () => true)
    axiosMock.post = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
    __quote.refresh.mockClear()
    __quote.invalidate.mockClear()
    __quoteCalls.length = 0
})
afterEach(() => {
    delete globalThis.chrome
})

describe('StockTrade.vue -- bos ekran', () => {
    it('iki sekme, USDC secili + USDT, ana dugme kapali ve "Enter amount"', async () => {
        const { html } = await mount()
        expect(html).toContain('data-stock-trade')
        expect(html).toContain('data-trade-tab="buy"')
        expect(html).toContain('data-trade-tab="sell"')
        expect(html).toContain('data-pay-token="USDC"')
        expect(html).toContain('data-pay-token="USDT"')
        const tag = primaryTag(html)
        expect(tag).not.toBe('')
        expect(isDisabled(tag)).toBe(true)
        expect(text(tag)).toBe('Enter amount')
    })

    it('Turkce metin "Tutar gir"', async () => {
        const { html } = await mount({ locale: 'tr' })
        expect(text(primaryTag(html))).toBe('Tutar gir')
    })

    it('hisse sembolu gorunur', async () => {
        const { html } = await mount()
        expect(html).toContain(STOCK.symbol)
    })
})

describe('StockTrade.vue -- hazir teklif', () => {
    it('miktar/en az/birim/referans/ucret satirlari + Powered by, dugme etkin "Buy"', async () => {
        const { html } = await mount({ amount: '10', state: { state: 'ready', result: readyResult() } })
        expect(html).toContain('data-trade-fees')
        expect(html).toContain('0.045')
        expect(html).toContain('0.044')
        expect(html).toContain('$222.20')
        expect(html).toContain('$222.00')
        expect(html).toContain('$0.16')
        expect(html).toContain('Minimum')
        expect(html).toContain('Powered by CoW Protocol')
        expect(html).toContain('data-trade-powered')
        const tag = primaryTag(html)
        expect(isDisabled(tag)).toBe(false)
        expect(text(tag)).toBe('Buy')
    })

    it('Sat sekmesinde dugme "Sell"', async () => {
        const { html } = await mount({ amount: '1', side: 'sell', state: { state: 'ready', result: readyResult() } })
        expect(text(primaryTag(html))).toBe('Sell')
    })

    it('onchain onay modu -> "Approve first" ve primaryAction approve', async () => {
        const { html, holder } = await mount({
            amount: '10',
            state: { state: 'ready', result: readyResult({ approval: { mode: 'onchain' } }) },
        })
        expect(text(primaryTag(html))).toBe('Approve first')
        expect(holder.instance.setupState.primaryAction).toBe('approve')
    })

    it('teklif yuklenirken kart yok ve dugme kapali', async () => {
        const { html } = await mount({ amount: '10', state: { state: 'loading' } })
        expect(isDisabled(primaryTag(html))).toBe(true)
        expect(html).not.toContain('data-trade-powered')
    })
})

describe('StockTrade.vue -- kilitler', () => {
    it('MARKET_CLOSED: kilit satiri acilis saatini icerir, kart yok, dugme kapali', async () => {
        const { html } = await mount({
            amount: '10',
            state: { state: 'locked', lockReason: 'MARKET_CLOSED', result: readyResult({ locked: true, lockReason: 'MARKET_CLOSED', display: null, nextChangeAt: NEXT }) },
        })
        expect(lockText(html)).toContain(formatLocalTime(NEXT, 'en'))
        expect(html).not.toContain('data-trade-fees')
        expect(isDisabled(primaryTag(html))).toBe(true)
        expect(text(primaryTag(html))).toBe('Locked')
    })

    it('REFERENCE_MISSING hem Al hem Sat sekmesinde kilit', async () => {
        for (const side of ['buy', 'sell']) {
            const { html } = await mount({
                amount: '1', side,
                state: { state: 'locked', lockReason: 'REFERENCE_MISSING', result: readyResult({ locked: true, lockReason: 'REFERENCE_MISSING', display: null }) },
            })
            expect(lockText(html)).toContain('Price cannot be verified')
            expect(isDisabled(primaryTag(html))).toBe(true)
        }
    })

    it('PRICE_PROTECTION Al ve Sat icin farkli metin', async () => {
        const locked = { state: 'locked', lockReason: 'PRICE_PROTECTION', result: readyResult({ locked: true, lockReason: 'PRICE_PROTECTION' }) }
        locked.result.display.gapPct = 3.2
        const buy = lockText((await mount({ amount: '10', state: locked })).html)
        const sell = lockText((await mount({ amount: '1', side: 'sell', state: locked })).html)
        expect(buy).toContain('above the reference')
        expect(sell).toContain('below the reference')
        expect(buy).not.toBe(sell)
    })

    it('Sat + kapali piyasa (notice closed): bilgi satiri gorunur ve dugme ETKIN', async () => {
        const { html } = await mount({
            amount: '1', side: 'sell',
            state: { state: 'ready', result: readyResult({ notice: { state: 'closed', nextChangeAt: NEXT } }) },
        })
        expect(html).toContain('data-trade-notice')
        expect(html).not.toContain('data-trade-lock')
        expect(isDisabled(primaryTag(html))).toBe(false)
    })

    it('acik piyasada bilgi satiri yok', async () => {
        const { html } = await mount({ amount: '1', side: 'sell', state: { state: 'ready', result: readyResult() } })
        expect(html).not.toContain('data-trade-notice')
    })
})

describe('StockTrade.vue -- "Tutar cok kucuk" hatasi ipucu (CoW siniri)', () => {
    const dec = (s) => s.replace(/&#39;/g, "'")
    const hintText = (html) => dec(text((html.match(/<[a-z]+[^>]*data-trade-min-hint[^>]*>[\s\S]*?<\/(?:div|p)>/) ?? [''])[0]))
    const locked = (gap = 3.2) => {
        const r = readyResult({ locked: true, lockReason: 'PRICE_PROTECTION' })
        r.display.gapPct = gap
        return { state: 'locked', lockReason: 'PRICE_PROTECTION', result: r }
    }
    const tooSmall = { state: 'error', errorCode: 'AMOUNT_TOO_SMALL' }
    const bscStock = { id: 'x', chainId: 56, address: STOCK.address, decimals: STOCK.decimals, symbol: STOCK.symbol }
    it('PRICE_PROTECTION kilidinde ipucu YOK, kilit degismez', async () => {
        const { html } = await mount({ amount: '10', state: locked() })
        expect(html).toContain('data-trade-lock')
        expect(html).not.toContain('data-trade-min-hint')
        expect(isDisabled(primaryTag(html))).toBe(true)
    })
    it('AMOUNT_TOO_SMALL (Ethereum): yeni metin + BSC cumlesi (en)', async () => {
        const { html } = await mount({ amount: '10', state: tooSmall })
        expect(hintText(html)).toBe('The amount does not cover the network fee; on this network the amount must be higher than the network fee. On BSC the network fee is a few cents.')
    })
    it('AMOUNT_TOO_SMALL (BSC): yalniz ana metin, BSC cumlesi yok', async () => {
        const { html } = await mount({ chainId: 56, selected: bscStock, amount: '10', state: tooSmall })
        expect(hintText(html)).toBe('The amount does not cover the network fee; on this network the amount must be higher than the network fee.')
    })
    it('tutardan bagimsiz: buyuk tutarda da hata varsa ipucu cikar (sabit tablo yok)', async () => {
        const { html } = await mount({ amount: '100000', state: tooSmall })
        expect(html).toContain('data-trade-min-hint')
    })
    it('NO_LIQUIDITY ve baska kilit nedeni: ipucu yok', async () => {
        const nl = await mount({ amount: '10', state: { state: 'error', errorCode: 'NO_LIQUIDITY' } })
        expect(nl.html).not.toContain('data-trade-min-hint')
        const mc = await mount({ amount: '10', state: { state: 'locked', lockReason: 'MARKET_CLOSED', result: readyResult({ locked: true, lockReason: 'MARKET_CLOSED', display: null, nextChangeAt: NEXT }) } })
        expect(mc.html).not.toContain('data-trade-min-hint')
    })
    it('ipucu sirasi: hata mesajindan SONRA gelir', async () => {
        const err = await mount({ amount: '10', state: tooSmall })
        expect(err.html.indexOf('data-trade-min-hint')).toBeGreaterThan(err.html.indexOf('Retry'))
    })
    it('bayat alan ipucu uretmez: kilit durumunda eski errorCode', async () => {
        const a = await mount({ amount: '10', state: { state: 'error', errorCode: 'NETWORK', lockReason: 'PRICE_PROTECTION' } })
        expect(a.html).not.toContain('data-trade-min-hint')
        const b = await mount({ amount: '10', state: { ...locked(), errorCode: 'AMOUNT_TOO_SMALL' } })
        expect(b.html).not.toContain('data-trade-min-hint')
    })
    describe('ag ucreti, en az tutar ve eksik miktar', () => {
        const INFO = { feeDisplay: '1.41', feeUsd: '1.41', minAmountDisplay: '1.69', missingDisplay: '1.19' }
        const withInfo = (errorInfo = INFO) => ({ state: 'error', errorCode: 'AMOUNT_TOO_SMALL', errorInfo })
        it('Al (Ethereum, en): ucret, en az, eksik + BSC cumlesi; sembol odeme tokeni (USDC)', async () => {
            const { html } = await mount({ amount: '0.5', state: withInfo() })
            expect(hintText(html)).toBe('Network fee ~1.41 USDC (~1.41 $). Enter at least 1.69 USDC; 1.19 USDC short. On BSC the network fee is a few cents.')
            expect(html).toContain('data-trade-use-min')
        })
        it('Al + USDT secili: sembol USDT', async () => {
            const { html } = await mount({ amount: '0.5', state: withInfo(), setup: (st) => { st.payToken = st.payTokens.find((p) => p.symbol === 'USDT') } })
            expect(hintText(html)).toContain('~1.41 USDT')
            expect(hintText(html)).toContain('at least 1.69 USDT')
        })
        it('BSC: BSC cumlesi yok', async () => {
            const { html } = await mount({ chainId: 56, selected: bscStock, amount: '0.5', state: withInfo() })
            expect(hintText(html)).toBe('Network fee ~1.41 USDC (~1.41 $). Enter at least 1.69 USDC; 1.19 USDC short.')
        })
        it('Sat: sembol hisse sembolu, hisse sayilari', async () => {
            const { html } = await mount({
                amount: '0.001', side: 'sell',
                state: withInfo({ feeDisplay: '0.005', feeUsd: '1.90', minAmountDisplay: '0.006', missingDisplay: '0.005' }),
            })
            expect(hintText(html)).toBe(`Network fee ~0.005 ${STOCK.symbol} (~1.90 $). Enter at least 0.006 ${STOCK.symbol}; 0.005 ${STOCK.symbol} short. On BSC the network fee is a few cents.`)
        })
        it('Turkce metin ve virgullu ondalik', async () => {
            const { html } = await mount({ amount: '0.5', locale: 'tr', state: withInfo() })
            expect(hintText(html)).toBe("Ağ ücreti ~1,41 USDC (~1,41 $). En az 1,69 USDC girmelisin; 1,19 USDC eksik. BSC'de ağ ücreti birkaç sent.")
            expect(text((html.match(/<button[^>]*data-trade-use-min[^>]*>[\s\S]*?<\/button>/) ?? [''])[0])).toBe('En az tutarı gir')
        })
        it('feeUsd yoksa parantez yok', async () => {
            const { html } = await mount({ chainId: 56, selected: bscStock, amount: '0.5', state: withInfo({ ...INFO, feeUsd: undefined }) })
            expect(hintText(html)).toBe('Network fee ~1.41 USDC. Enter at least 1.69 USDC; 1.19 USDC short.')
        })
        it('ucret bilinmiyorsa (errorInfo yok) bugunku genel metin ve DUGME YOK', async () => {
            const { html } = await mount({ amount: '0.5', state: withInfo(null) })
            expect(hintText(html)).toBe('The amount does not cover the network fee; on this network the amount must be higher than the network fee. On BSC the network fee is a few cents.')
            expect(html).not.toContain('data-trade-use-min')
        })
        it('baska hata kodunda errorInfo kalsa bile ipucu yok', async () => {
            const { html } = await mount({ amount: '0.5', state: { state: 'error', errorCode: 'NO_LIQUIDITY', errorInfo: INFO } })
            expect(html).not.toContain('data-trade-min-hint')
            expect(html).not.toContain('data-trade-use-min')
        })
        it('"En az tutari gir" dugmesi tutar alanini en az tutarla doldurur (ham, noktali)', async () => {
            const { holder } = await mount({ amount: '0.5', state: withInfo() })
            expect(holder.instance.setupState.amount).toBe('0.5')
            holder.instance.setupState.useMinAmount()
            expect(holder.instance.setupState.amount).toBe('1.69')
        })
        it('dugme bilgi yokken tutari DEGISTIRMEZ', async () => {
            const { holder } = await mount({ amount: '0.5', state: withInfo(null) })
            holder.instance.setupState.useMinAmount()
            expect(holder.instance.setupState.amount).toBe('0.5')
        })
        it('dugme tiklamasi useMinAmount a bagli (sablon kaynagi)', () => {
            const src = yorumsuz(readFileSync(resolve(HERE, 'StockTrade.vue'), 'utf8'))
            expect(src).toMatch(/<button[^>]*data-trade-use-min[^>]*@click="useMinAmount"/)
        })
        it('dugme sonraki teklif istegini tetikler: istek tutari en az tutar olur', async () => {
            const { holder } = await mount({ amount: '0.5', state: withInfo() })
            holder.instance.setupState.useMinAmount()
            expect(holder.instance.setupState.request.amount).toBe('1.69')
        })
    })
    it('Turkce metin; eski "~100" ifadesi hicbir yerde yok', async () => {
        const { html } = await mount({ amount: '10', locale: 'tr', state: tooSmall })
        expect(hintText(html)).toBe("Tutar ağ ücretini karşılamıyor; bu ağda tutar ağ ücretinden yüksek olmalı. BSC'de ağ ücreti birkaç sent.")
        expect(html).not.toContain('~100')
        const bsc = await mount({ chainId: 56, selected: bscStock, amount: '10', locale: 'tr', state: tooSmall })
        expect(hintText(bsc.html)).toBe('Tutar ağ ücretini karşılamıyor; bu ağda tutar ağ ücretinden yüksek olmalı.')
    })
})

describe('StockTrade.vue -- ag ucreti ayri satir ve yuksek ucret uyarisi (kilit yok)', () => {
    const dec = (s) => s.replace(/&#39;/g, "'")
    const feeDisplay = { networkFeeUsd: 0.62, networkFeePct: 6.2 }
    const feeText = (html) => text((html.match(/<[a-z]+[^>]*data-trade-network-fee[^>]*>[\s\S]*?<\/(?:div|p)>/) ?? [''])[0])
    const warnText = (html) => dec(text((html.match(/<[a-z]+[^>]*data-trade-fee-warning[^>]*>[\s\S]*?<\/(?:div|p)>/) ?? [''])[0]))
    const base = readyResult().display
    const bscStock = { id: 'x', chainId: 56, address: STOCK.address, decimals: STOCK.decimals, symbol: STOCK.symbol }
    const high = { state: 'ready', result: readyResult({ display: { ...base, networkFeeUsd: 3.5, networkFeePct: 35, feeWarning: true } }) }
    it('hazir teklifte ana ekranda satir (en / tr)', async () => {
        const state = { state: 'ready', result: readyResult({ display: { ...base, ...feeDisplay } }) }
        expect(feeText((await mount({ amount: '10', state })).html)).toBe('Network fee: $0.62 (6.2%)')
        expect(feeText((await mount({ amount: '10', state, locale: 'tr' })).html)).toBe('Ağ ücreti: 0,62 $ (%6,2)')
    })
    it('ag ucreti verisi yoksa satir yok', async () => {
        const { html } = await mount({ amount: '10', state: { state: 'ready', result: readyResult() } })
        expect(html).not.toContain('data-trade-network-fee')
    })
    it('feeWarning yokken uyari satiri yok', async () => {
        const state = { state: 'ready', result: readyResult({ display: { ...base, ...feeDisplay } }) }
        expect((await mount({ amount: '10', state })).html).not.toContain('data-trade-fee-warning')
    })
    it('feeWarning varken Ethereum: uyari + BSC cumlesi (en / tr), islem dugmesi KILITLENMEZ', async () => {
        const en = await mount({ amount: '10', state: high })
        expect(warnText(en.html)).toBe('The network fee is 35.0% of the amount. It can be expensive on small amounts. On BSC the network fee is a few cents.')
        expect(isDisabled(primaryTag(en.html))).toBe(false)
        expect(en.html).not.toContain('data-trade-lock')
        const tr = await mount({ amount: '10', state: high, locale: 'tr' })
        expect(warnText(tr.html)).toBe("Ağ ücreti tutarın %35,0'i. Küçük tutarlarda pahalı olabilir. BSC'de ağ ücreti birkaç sent.")
    })
    it('feeWarning varken BSC: BSC cumlesi yok', async () => {
        const { html } = await mount({ chainId: 56, selected: bscStock, amount: '10', state: high })
        expect(warnText(html)).toBe('The network fee is 35.0% of the amount. It can be expensive on small amounts.')
    })
})

describe('StockTrade.vue -- ag, katalog, bakiye, hata', () => {
    // Kullanici karari (2026-10-23): hisse baska agdayken cuzdan agi degismez, ekran kilitlenmez; teklif,
    // bakiye ve emir hissenin zincirinden (selected_token_ref.chainId) calisir.
    it('hisse baska agda (cuzdan BSC, hisse Ethereum): ag uyarisi/dugmesi YOK, ana dugme etkin, ag degismez', async () => {
        const { html, holder } = await mount({ chainId: 56, amount: '10', state: { state: 'ready', result: readyResult() } })
        expect(html).not.toContain('This stock is on')
        expect(html).not.toContain('Switch network')
        expect(isDisabled(primaryTag(html))).toBe(false)
        expect(holder.instance.setupState.blockReason).toBeNull()
        expect(applyMock.fn).not.toHaveBeenCalled()
        expect(networkStore().currentNetwork.chainId).toBe(56)
    })

    it('hisse baska agda: teklif AKTIF ve istek HISSENIN zincirini tasir (cuzdan aginin degil)', async () => {
        const { holder } = await mount({ chainId: 56, amount: '10' })
        const opts = __quoteCalls.at(-1)
        expect(toValue(opts.enabled)).toBe(true)
        expect(toValue(opts.request)).toMatchObject({ chainId: 1, stockAddress: STOCK.address })
        expect(holder.instance.setupState.blockReason).not.toBe('wrong-network')
    })

    it('hisse baska agda: bakiye hissenin zincirinin RPC adresinden ve hissenin chainId degeriyle okunur', async () => {
        await mount({ chainId: 56 })
        expect(balanceMock.calls.length).toBeGreaterThan(0)
        const [, , rpc, chainId] = balanceMock.calls[0]
        expect(chainId).toBe(1)
        expect(rpc).toBe(rpcUrlsOf(chain(1))[0])
        expect(rpc).not.toBe(networkStore().rpc)
    })

    it('katalog disi kimlik -> kullanilamiyor, ana dugme yok, currentPage degismez', async () => {
        const { html } = await mount({ selected: { id: 'y', chainId: 1, address: '0x0000000000000000000000000000000000000009', decimals: 18, symbol: 'ZZZ' } })
        expect(html).toContain('not available')
        expect(html).not.toContain('data-trade-primary')
        expect(pageStore().currentPage).toBe('stock_trade')
    })

    // bStocks artik Al/Sat'ta ACIK (T14, K4/K6): ekran StockTrade.bstocks.ssr.test.js'te. Burada katalog DISI adres kapali kalir.
    it('katalog disi adres (hisse degil) -> kullanilamiyor', async () => {
        const { html } = await mount({ chainId: 56, selected: { id: 'b', chainId: 56, address: '0x0000000000000000000000000000000000000abc', decimals: 18, symbol: 'ZZZ' } })
        expect(html).not.toContain('data-trade-primary')
        expect(html).toContain('not available')
    })

    it('selected_token_ref yok -> ayni durum, cokme yok', async () => {
        const { html } = await mount({ selected: null })
        expect(html).not.toContain('data-trade-primary')
        expect(html).toContain('not available')
        expect(pageStore().currentPage).toBe('stock_trade')
    })

    it('yetersiz bakiye', async () => {
        balanceMock.fn = async () => 5
        const { html } = await mount({ amount: '10', state: { state: 'ready', result: readyResult() } })
        expect(text(primaryTag(html))).toBe('Insufficient balance')
        expect(isDisabled(primaryTag(html))).toBe(true)
    })

    it('bakiye yuklenirken ayri sebep (balance-loading)', async () => {
        let release
        balanceMock.fn = () => new Promise((r) => { release = r })
        const { app, holder } = build({ amount: '10', state: { state: 'ready', result: readyResult() } })
        const pending = render(app)
        for (let i = 0; i < 20 && balanceMock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5))
        expect(holder.instance.setupState.blockReason).toBe('balance-loading')
        release(1000)
        await pending
        expect(holder.instance.setupState.blockReason).toBeNull()
    })

    it('bakiye cagrisi hesap okunduktan SONRA, Al sekmesinde odeme tokeniyle', async () => {
        await mount()
        expect(balanceMock.calls.length).toBeGreaterThan(0)
        const [addr, token, , chainId] = balanceMock.calls[0]
        expect(addr).toBe(ADDR)
        expect(token.toLowerCase()).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
        expect(chainId).toBe(1)
    })

    it('hata durumu NO_LIQUIDITY metni ve Retry dugmesi', async () => {
        const { html } = await mount({ amount: '10', state: { state: 'error', errorCode: 'NO_LIQUIDITY' } })
        expect(html).toContain('This stock cannot be traded right now')
        expect(html).toContain('Retry')
    })

    it('setupState alanlari acik ve varsayilanlar dogru', async () => {
        const { holder } = await mount()
        const s = holder.instance.setupState
        expect(s.side).toBe('buy')
        expect(s.payToken.symbol).toBe('USDC')
        expect(s.confirmOpen).toBe(false)
        expect(s.approveOpen).toBe(false)
        expect(s.blockReason).toBe('enter-amount')
    })
})

describe('StockTrade.vue -- onay katmani (Task 22)', () => {
    const ready = () => ({ state: 'ready', result: readyResult(), quoteId: 'q1' })

    it('confirmOpen kapaliyken katman yok, acikken StockOrderConfirm cizilir', async () => {
        const closed = await mount({ amount: '10', state: ready() })
        expect(closed.html).not.toContain('data-order-confirm')
        const open = await mount({ amount: '10', state: ready(), setup: (st) => { st.confirmOpen = true } })
        expect(open.html).toContain('data-order-confirm')
        expect(open.html).toContain('data-confirm-sign')
    })

    it('confirmOpen iken useCowQuote visible getter i false, kapaliyken true (Task 19 degismez)', async () => {
        const { holder } = await mount({ amount: '10', state: ready() })
        const opts = __quoteCalls.at(-1)
        const s = holder.instance.setupState
        expect(s.confirmOpen).toBe(false)
        expect(toValue(opts.visible)).toBe(true)
        s.confirmOpen = true
        expect(toValue(opts.visible)).toBe(false)
        s.confirmOpen = false
        expect(toValue(opts.visible)).toBe(true)
    })

    it('onPrimary: trade -> confirmOpen, approve -> approveOpen (katman acilmaz)', async () => {
        const trade = await mount({ amount: '10', state: ready() })
        trade.holder.instance.setupState.onPrimary()
        expect(trade.holder.instance.setupState.confirmOpen).toBe(true)
        expect(trade.holder.instance.setupState.approveOpen).toBe(false)
        const approve = await mount({ amount: '10', state: { state: 'ready', result: readyResult({ approval: { mode: 'onchain' } }), quoteId: 'q1' } })
        approve.holder.instance.setupState.onPrimary()
        expect(approve.holder.instance.setupState.approveOpen).toBe(true)
        expect(approve.holder.instance.setupState.confirmOpen).toBe(false)
    })

    it('sure dolunca (code null) katman kapanir ve "Price updated" bandi gorunur', async () => {
        const { holder } = await mount({ amount: '10', state: ready() })
        const s = holder.instance.setupState
        s.confirmOpen = true
        s.onConfirmExpired({ code: null })
        expect(s.confirmOpen).toBe(false)
        expect(s.bannerKey).toBe('stockTrade.quote.updated')
        const html = clean(await render(build({ amount: '10', state: ready(), setup: (st) => { st.bannerKey = 'stockTrade.quote.updated' } }).app))
        expect(text(html.match(/<[a-z]+[^>]*data-trade-banner[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '')).toContain('Price updated, please confirm again')
    })

    it('hata koduyla kapanma: bant stockTrade.error.<KOD>; kod disi deger UNKNOWN a duser', async () => {
        const { holder } = await mount({ amount: '10', state: ready() })
        const s = holder.instance.setupState
        s.confirmOpen = true
        s.onConfirmExpired({ code: 'QUOTE_USED' })
        expect(s.bannerKey).toBe('stockTrade.error.QUOTE_USED')
        s.onConfirmExpired({ code: '<b>x</b>' })
        expect(s.bannerKey).toBe('stockTrade.error.UNKNOWN')
    })

    it('gonderim sonrasi Kapat: katman kapanir, teklif yenilenir ve bakiye yeniden okunur', async () => {
        const { holder } = await mount({ amount: '10', state: ready() })
        const s = holder.instance.setupState
        const before = balanceMock.calls.length
        s.confirmOpen = true
        s.onConfirmPlaced({ uid: '0x1' })
        s.onConfirmClose()
        expect(s.confirmOpen).toBe(false)
        expect(__quote.refresh).toHaveBeenCalledTimes(1)
        await new Promise((r) => setTimeout(r, 5))
        expect(balanceMock.calls.length).toBeGreaterThan(before)
    })

    it('imzalamadan Vazgec: teklif yenilenmez', async () => {
        const { holder } = await mount({ amount: '10', state: ready() })
        const s = holder.instance.setupState
        s.confirmOpen = true
        s.onConfirmClose()
        expect(s.confirmOpen).toBe(false)
        expect(__quote.refresh).not.toHaveBeenCalled()
    })

    it('Yeni islem: tutar sifirlanir, teklif gecersiz kilinir, katman kapanir', async () => {
        const { holder } = await mount({ amount: '10', state: ready() })
        const s = holder.instance.setupState
        s.confirmOpen = true
        s.onConfirmPlaced({ uid: '0x1' })
        s.onConfirmNew()
        expect(s.amount).toBe('')
        expect(s.confirmOpen).toBe(false)
        expect(__quote.invalidate).toHaveBeenCalledTimes(1)
        expect(__quote.refresh).not.toHaveBeenCalled()
    })

    it('bant tutar/sekme/odeme tokeni degisince temizlenir', async () => {
        const { holder } = await mount({ amount: '10', state: ready() })
        const s = holder.instance.setupState
        s.bannerKey = 'stockTrade.quote.updated'
        s.setSide('sell')
        expect(s.bannerKey).toBeNull()
        s.bannerKey = 'stockTrade.quote.updated'
        s.onAmountInput({ target: { value: '3' } })
        expect(s.bannerKey).toBeNull()
    })
})

describe('StockTrade.vue -- motor baglama (xStocks / cow, T14)', () => {
    it('useCowQuote send: cow motoru COW_QUOTE gonderir (istek stockTrade.js bicimi)', async () => {
        const { stub } = await mount({ amount: '10' })
        const opts = __quoteCalls.at(-1)
        const req = toValue(opts.request)
        expect(req).toEqual({ side: 'buy', chainId: 1, stockAddress: STOCK.address, payToken: expect.any(String), amount: '10' })
        const sent = []
        stub.setSendMessage(async (m) => { sent.push(m); return { success: false, code: 'NO_LIQUIDITY' } })
        await opts.send(req)
        expect(sent).toEqual([{ type: 'COW_QUOTE', message: req }])
    })

    it('xStocks teklif karti CoW ucret dokumu + Powered by CoW + referans kilidi bilgisi (bStocks satirlari yok)', async () => {
        const { html } = await mount({ amount: '10', state: { state: 'ready', result: readyResult() } })
        expect(html).toContain('data-trade-powered')
        expect(html).toContain('CoW fee')
        expect(html).not.toContain('data-trade-price-impact')
        expect(html).not.toContain('data-trade-ats-fees')
        expect(html).not.toContain('data-stock-ats-card')
        expect(html).not.toContain('data-trade-impact')
    })

    it('xStocks ag hatasi hala CoW metni (cow motorunun errorKey i degismedi)', async () => {
        const { html } = await mount({ amount: '10', state: { state: 'error', errorCode: 'NETWORK' } })
        expect(html).toContain('CoW is unreachable')
    })

    it('xStocks hisse: odeme tokeni motor listesinden (USDC varsayilan), referans fiyat gerekmez (teklif acik)', async () => {
        const { holder } = await mount({ amount: '10' })
        expect(holder.instance.setupState.payToken.symbol).toBe('USDC')
        expect(toValue(__quoteCalls.at(-1).enabled)).toBe(true)
    })

    it('pageStore.tradeSide=sell okunur ve temizlenir; baska deger Al', async () => {
        const sell = await mount({ amount: '1', prep: () => { pageStore().tradeSide = 'sell' } })
        expect(sell.holder.instance.setupState.side).toBe('sell')
        expect(pageStore().tradeSide).toBeNull()
        const buy = await mount({ amount: '1', prep: () => { pageStore().tradeSide = 'garip' } })
        expect(buy.holder.instance.setupState.side).toBe('buy')
        expect(pageStore().tradeSide).toBeNull()
    })
})

describe('StockTrade.vue -- kaynak taramasi', () => {
    const src = yorumsuz(readFileSync(resolve(HERE, 'StockTrade.vue'), 'utf8'))
    it('hesap/yerlestirme sozlesmesi icermez', () => {
        for (const yasak of ['computeAmounts', 'parseUnits', 'GPV2_', 'sellAmount:', "type: 'COW_PLACE_ORDER'", 'v-html']) {
            expect(src).not.toContain(yasak)
        }
    })
    it('currentPage yazimi yok (Back bileseni ve ag degisim isleyicisi disinda)', () => {
        expect(src).not.toMatch(/currentPage\s*=/)
    })
    it('ag degisimi YOK: applyNetworkChange, switchNetwork ve chainOk kilidi kaynakta bulunmaz (kullanici karari 2026-10-23)', () => {
        for (const yasak of ['applyNetworkChange', 'switchNetwork', 'chainOk', 'wrongNetwork']) {
            expect(src, yasak).not.toContain(yasak)
        }
    })
})

describe('StockTrade.vue -- zincir ustu approve adimi (Task 23)', () => {
    const onchain = () => ({ state: 'ready', result: readyResult({ approval: { mode: 'onchain' } }), quoteId: 'q1' })
    const ATS_QUOTE = { ready: true, mode: 'direct', transferFee: 1.25, atsBalance: 10, symbol: 'ATS', nextSteps: [], feeRefundable: false }
    const quoteOk = (over = {}) => ({ success: true, quote: { ...ATS_QUOTE, ...(over.quote ?? {}) }, resetFirst: over.resetFirst === true, approveUntil: 1, token: STOCK.address, chainId: 1 })
    const tick = () => new Promise((r) => setTimeout(r, 5))
    const runBtn = (html) => (html.match(/<button[^>]*data-approve-run[^>]*>[\s\S]*?<\/button>/) ?? [''])[0]

    // Mesaj yakalayici: gonderilen her mesaj JSON kopyasi olarak sent'e girer.
    async function flow({ quoteResp = quoteOk(), execResp = { success: true, confirmed: true, txHash: '0x1' } } = {}) {
        const m = await mount({ amount: '10', state: onchain() })
        const sent = []
        const responders = { COW_APPROVE_QUOTE: () => quoteResp, COW_APPROVE_EXECUTE: () => execResp, ATS_RUN_ONBOARDING: () => ({ success: true }) }
        m.stub.setSendMessage(async (msg) => {
            sent.push(JSON.parse(JSON.stringify(msg)))
            const r = responders[msg.type]
            return typeof r === 'function' ? r(msg) : { success: false, code: 'UNKNOWN' }
        })
        return { ...m, sent, responders, s: m.holder.instance.setupState }
    }
    const types = (sent) => sent.map((x) => x.type)

    describe('cizim', () => {
        const open = (extra = {}, step = {}) => ({
            amount: '10',
            state: onchain(),
            setup: (st) => {
                st.approveOpen = true
                st.atsFee = 1.25
                st.atsReady = true
                st.atsBalance = 10
                Object.assign(st.approveStep, { loading: false, quote: { ...ATS_QUOTE }, ...step })
                Object.assign(st, extra)
            },
        })

        it('kapaliyken adim yok; acikken data-approve-step, ATS karti ucreti gosterir, "unlimited" satiri her zaman var', async () => {
            const closed = await mount({ amount: '10', state: onchain() })
            expect(closed.html).not.toContain('data-approve-step')
            const { html } = await mount(open())
            expect(html).toContain('data-approve-step')
            const t = text(html)
            expect(t).toContain('Approve first')
            expect(t).toContain('1.25')
            expect(t).toContain('ATS')
            expect(html).toContain('data-approve-unlimited')
        })

        it('resetFirst iken sifirlama notu var, degilken yok', async () => {
            const withNote = await mount(open({}, { resetFirst: true }))
            expect(withNote.html).toContain('data-approve-reset-note')
            expect(text(withNote.html)).toContain('The existing allowance is reset first')
            const without = await mount(open({}, { resetFirst: false }))
            expect(without.html).not.toContain('data-approve-reset-note')
        })

        it('hazir ve bloklu degilken "Send approval" acik; blocked iken (ATS hazir degil) kapali', async () => {
            const ok = await mount(open())
            const btn = runBtn(ok.html)
            expect(btn).not.toBe('')
            expect(isDisabled(btn)).toBe(false)
            expect(text(btn)).toBe('Send approval')
            const blocked = await mount(open({ atsReady: false }))
            expect(isDisabled(runBtn(blocked.html))).toBe(true)
        })

        it('bakiye ucreti karsilamiyorsa (insufficient) dugme kapali', async () => {
            const { html } = await mount(open({ atsBalance: 0.5 }))
            expect(isDisabled(runBtn(html))).toBe(true)
        })

        it('teklif yokken (approveStep.quote null) dugme kapali', async () => {
            const { html } = await mount(open({}, { quote: null }))
            expect(isDisabled(runBtn(html))).toBe(true)
        })

        it('errorCode dolu: hata metni gorunur; done yoksa "Approved" bandi YOK', async () => {
            const { html } = await mount(open({}, { errorCode: 'APPROVAL_REQUIRED' }))
            expect(html).toContain('data-approve-error')
            expect(html).not.toContain('data-approve-done')
        })

        it('done iken (adim kapali) data-approve-done bandi "Approved" gosterir', async () => {
            const { html } = await mount({ amount: '10', state: { state: 'ready', result: readyResult(), quoteId: 'q2' }, setup: (st) => { st.approveStep.done = true } })
            expect(html).not.toContain('data-approve-step')
            expect(html).toContain('data-approve-done')
            expect(text(html.match(/<[a-z]+[^>]*data-approve-done[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '')).toContain('Approved')
        })
    })

    describe('ATS al dugmesi (Task 23b)', () => {
        const insufficient = { atsFee: 5, atsReady: true, atsBalance: 1 }
        const base = (extra = {}, step = {}) => ({
            amount: '10',
            state: onchain(),
            setup: (st) => {
                st.approveOpen = true
                Object.assign(st.approveStep, { loading: false, quote: { ...ATS_QUOTE }, ...step })
                Object.assign(st, extra)
            },
        })
        const buyBtn = (html) => (html.match(/<button[^>]*>\s*Buy ATS\s*<\/button>/) ?? [''])[0]
        beforeEach(() => { atsBuyMock.live = true; atsBuyMock.open.mockClear() })

        it('bakiye yetersizken dugme gorunur', async () => {
            const { html } = await mount(base(insufficient))
            expect(html).toContain('data-approve-step')
            expect(buyBtn(html)).not.toBe('')
        })

        it('eksik ATS karti: gereken, mevcut ve eksik miktar ATS cinsinden', async () => {
            const { html } = await mount(base(insufficient))
            expect(text(html)).toMatch(/Insufficient balance: [\d.]+ ATS needed, your wallet has 1 ATS \([\d.]+ ATS short\)/)
        })

        it('bakiye yeterliyken dugme yok', async () => {
            const { html } = await mount(base({ atsFee: 1.25, atsReady: true, atsBalance: 10 }))
            expect(html).toContain('data-approve-step')
            expect(buyBtn(html)).toBe('')
        })

        it('adim kapaliyken dugme yok', async () => {
            const { html } = await mount({ amount: '10', state: onchain(), setup: (st) => Object.assign(st, insufficient) })
            expect(buyBtn(html)).toBe('')
        })

        it('tiklama mevcut ATS alim yoluna (useAtsPurchase.open) gider ve adimi kapatir', async () => {
            const { holder } = await mount(base(insufficient))
            const s = holder.instance.setupState
            await s.buyAtsFromApprove()
            expect(atsBuyMock.open).toHaveBeenCalledTimes(1)
            expect(s.approveOpen).toBe(false)
        })

        it('donuste (adim yeniden acilinca) bakiye yeniden okunur ve kart guncellenir', async () => {
            const m = await flow()
            const s = m.s
            await s.openApprove()
            expect(s.atsInsufficient).toBe(false)
            m.responders.COW_APPROVE_QUOTE = () => quoteOk({ quote: { transferFee: 5, atsBalance: 1 } })
            await s.buyAtsFromApprove()
            await s.openApprove()
            expect(s.atsBalance).toBe(1)
            expect(s.atsInsufficient).toBe(true)
            m.responders.COW_APPROVE_QUOTE = () => quoteOk({ quote: { transferFee: 5, atsBalance: 20 } })
            await s.openApprove()
            expect(s.atsBalance).toBe(20)
            expect(s.atsInsufficient).toBe(false)
        })
    })

    describe('mesajlar ve akis', () => {
        it('onPrimary (approve) COW_APPROVE_QUOTE gonderir; govde YALNIZ quoteId', async () => {
            const { s, sent } = await flow()
            s.onPrimary()
            await tick()
            expect(types(sent)).toEqual(['COW_APPROVE_QUOTE'])
            expect(sent[0].message).toEqual({ quoteId: 'q1' })
            expect(Object.keys(sent[0].message)).toEqual(['quoteId'])
        })

        it('basarili teklif: kart verisi dolar, ATS_FEE_QUOTE KULLANILMAZ, resetFirst yansir', async () => {
            const { s, sent } = await flow({ quoteResp: quoteOk({ resetFirst: true, quote: { transferFee: 2.5 } }) })
            await s.openApprove()
            expect(types(sent)).not.toContain('ATS_FEE_QUOTE')
            expect(s.approveOpen).toBe(true)
            expect(s.approveStep.loading).toBe(false)
            expect(s.approveStep.resetFirst).toBe(true)
            expect(s.approveStep.quote.transferFee).toBe(2.5)
            expect(s.atsFee).toBe(2.5)
            expect(s.atsReady).toBe(true)
        })

        it('Onayi gonder: COW_APPROVE_EXECUTE govdesi YALNIZ [quoteId, quoted]; quoted = { transferFee }', async () => {
            const { s, sent } = await flow()
            await s.openApprove()
            await s.runApprove()
            const exec = sent.find((x) => x.type === 'COW_APPROVE_EXECUTE')
            expect(Object.keys(exec.message)).toEqual(['quoteId', 'quoted'])
            expect(exec.message.quoteId).toBe('q1')
            expect(exec.message.quoted).toEqual({ transferFee: 1.25 })
        })

        it('saldiri alanlari (spender, calls, token, amount, to, data) HICBIR mesajda yok', async () => {
            const { s, sent } = await flow()
            await s.openApprove()
            await s.runApprove()
            const json = JSON.stringify(sent)
            for (const yasak of ['spender', 'calls', 'token', 'amount', '"to"', '"data"', 'allowance']) {
                expect(json).not.toContain(yasak)
            }
        })

        it('basari (confirmed): adim kapanir, quote.invalidate cagrilir, "Approved" bandi, teklif yeniden istenir', async () => {
            const { s } = await flow()
            await s.openApprove()
            await s.runApprove()
            await tick()
            expect(s.approveOpen).toBe(false)
            expect(s.approveStep.done).toBe(true)
            expect(s.approveStep.running).toBe(false)
            expect(__quote.invalidate).toHaveBeenCalledTimes(1)
            // yeniden istek: teklif kapisi kapanip acilir (invalidate tek basina istek atmaz)
            expect(s.quoteGate).toBe(true)
        })

        it('skipped:true + confirmed:true da basaridir', async () => {
            const { s } = await flow({ execResp: { success: true, skipped: true, confirmed: true, txHash: null } })
            await s.openApprove()
            await s.runApprove()
            expect(s.approveOpen).toBe(false)
            expect(s.approveStep.done).toBe(true)
        })

        it('confirmed olmayan success BASARI SAYILMAZ (yalniz success alanina baglanmaz)', async () => {
            const { s } = await flow({ execResp: { success: true, confirmed: false } })
            await s.openApprove()
            await s.runApprove()
            expect(s.approveOpen).toBe(true)
            expect(s.approveStep.done).toBe(false)
            expect(__quote.invalidate).not.toHaveBeenCalled()
        })

        it('APPROVAL_REQUIRED "Approved" gostermez: adim acik, hata kodu yazilir, invalidate yok', async () => {
            const { s } = await flow({ execResp: { success: false, code: 'APPROVAL_REQUIRED' } })
            await s.openApprove()
            await s.runApprove()
            expect(s.approveOpen).toBe(true)
            expect(s.approveStep.done).toBe(false)
            expect(s.approveStep.errorCode).toBe('APPROVAL_REQUIRED')
            expect(s.approveStep.running).toBe(false)
            expect(__quote.invalidate).not.toHaveBeenCalled()
        })

        it('kapali kod kumesi disindaki deger UNKNOWN a duser (ic mesaj sizmaz)', async () => {
            const { s } = await flow({ execResp: { success: false, code: '<b>x</b>' } })
            await s.openApprove()
            await s.runApprove()
            expect(s.approveStep.errorCode).toBe('UNKNOWN')
        })

        it('ATS blokaji (atsCode) kart kararina yansir, sunucu hata kodu ayri tutulur', async () => {
            const { s } = await flow({ quoteResp: { success: false, code: 'UNKNOWN', atsCode: 'src-balance-missing' } })
            await s.openApprove()
            expect(s.approveStep.errorCode).toBe('UNKNOWN')
            expect(s.atsDecision.action).toBe('buy-ats')
            expect(s.approveStep.quote).toBeNull()
        })

        it('atsCode yoksa ATS karari olusmaz; yalniz errorCode metni gorunur', async () => {
            const { s } = await flow({ quoteResp: { success: false, code: 'QUOTE_NOT_FOUND' } })
            await s.openApprove()
            expect(s.approveStep.errorCode).toBe('QUOTE_NOT_FOUND')
            expect(s.atsDecision?.action).not.toBe('buy-ats')
            expect(s.atsFee).toBeNull()
        })

        it('blocked iken runApprove HICBIR sey gondermez', async () => {
            const { s, sent } = await flow({ quoteResp: quoteOk({ quote: { ready: false } }) })
            await s.openApprove()
            await s.runApprove()
            expect(types(sent)).toEqual(['COW_APPROVE_QUOTE'])
        })

        it('cift tik: iki eszamanli runApprove tek COW_APPROVE_EXECUTE uretir', async () => {
            const { s, sent, responders } = await flow()
            let release
            responders.COW_APPROVE_EXECUTE = () => new Promise((r) => { release = () => r({ success: true, confirmed: true }) })
            await s.openApprove()
            const a = s.runApprove()
            const b = s.runApprove()
            await tick()
            expect(sent.filter((x) => x.type === 'COW_APPROVE_EXECUTE')).toHaveLength(1)
            expect(s.approveStep.running).toBe(true)
            release()
            await Promise.all([a, b])
            expect(s.approveStep.running).toBe(false)
        })

        it('QUOTE_EXPIRED: adim kapanir, teklif yenilenir, bant QUOTE_EXPIRED metnini gosterir', async () => {
            const { s } = await flow({ execResp: { success: false, code: 'QUOTE_EXPIRED' } })
            await s.openApprove()
            await s.runApprove()
            expect(s.approveOpen).toBe(false)
            expect(s.approveStep.done).toBe(false)
            expect(__quote.refresh).toHaveBeenCalledTimes(1)
            expect(s.bannerKey).toBe('stockTrade.error.QUOTE_EXPIRED')
        })

        it('teklif alinirken QUOTE_EXPIRED gelirse de adim kapanir ve teklif yenilenir', async () => {
            const { s } = await flow({ quoteResp: { success: false, code: 'QUOTE_EXPIRED' } })
            await s.openApprove()
            expect(s.approveOpen).toBe(false)
            expect(__quote.refresh).toHaveBeenCalledTimes(1)
        })

        it('adim kapaninca gecikmis yanit YOKSAYILIR: basari islenmez, invalidate yok', async () => {
            const { s, responders } = await flow()
            let release
            responders.COW_APPROVE_EXECUTE = () => new Promise((r) => { release = () => r({ success: true, confirmed: true }) })
            await s.openApprove()
            const p = s.runApprove()
            await tick()
            s.closeApprove()
            expect(s.approveOpen).toBe(false)
            release()
            await p
            expect(s.approveStep.done).toBe(false)
            expect(__quote.invalidate).not.toHaveBeenCalled()
        })

        it('Kurulumu calistir: ATS_RUN_ONBOARDING sonrasi tazeleme COW_APPROVE_QUOTE ile (ATS_FEE_QUOTE ile degil)', async () => {
            const { s, sent } = await flow()
            await s.openApprove()
            await s.startApproveOnboarding()
            expect(types(sent)).toEqual(['COW_APPROVE_QUOTE', 'ATS_RUN_ONBOARDING', 'COW_APPROVE_QUOTE'])
            for (const x of sent.filter((y) => y.type === 'COW_APPROVE_QUOTE')) expect(x.message).toEqual({ quoteId: 'q1' })
        })

        it('teklif yenilemesi adim acikken durur (visible getter approveOpen iken false)', async () => {
            const { s } = await flow()
            const opts = __quoteCalls.at(-1)
            expect(toValue(opts.visible)).toBe(true)
            await s.openApprove()
            expect(toValue(opts.visible)).toBe(false)
            s.closeApprove()
            expect(toValue(opts.visible)).toBe(true)
        })

        it('teklif kimligi acilista SABITLENIR: ekran sonradan degisen quoteId ile onay gondermez', async () => {
            const { s, sent } = await flow()
            await s.openApprove()
            __quote.quoteId = 'q-baska'
            await s.runApprove()
            expect(sent.find((x) => x.type === 'COW_APPROVE_EXECUTE').message.quoteId).toBe('q1')
        })
    })

    describe('kaynak taramasi (Task 23)', () => {
        const src = yorumsuz(readFileSync(resolve(HERE, 'StockTrade.vue'), 'utf8'))
        it('approve( cagrisi, MaxUint256 ve VaultRelayer sabiti yok', () => {
            for (const yasak of ['approve(', 'MaxUint256', 'GPV2_VAULT_RELAYER', 'spender', 'COW_PLACE_ORDER']) {
                expect(src).not.toContain(yasak)
            }
        })
        it('hesap degisince adim kapanir (izleyici var)', () => {
            expect(src).toMatch(/watch\(\(\) => activeAccount\.value\?\.address[\s\S]*?closeApprove\(\)/)
        })
        it('basaridan sonra teklif yeniden istenir: kapi kapanir, bir tik beklenir, acilir (invalidate tek basina istek atmaz)', () => {
            expect(src).toMatch(/quote\.invalidate\(\)\s*quoteGate\.value = false\s*await nextTick\(\)\s*quoteGate\.value = true/)
        })
        it('teklif kapisi useCowQuote enabled girdisine baglidir', async () => {
            const { holder } = await mount({ amount: '10', state: onchain() })
            const opts = __quoteCalls.at(-1)
            expect(toValue(opts.enabled)).toBe(true)
            holder.instance.setupState.quoteGate = false
            expect(toValue(opts.enabled)).toBe(false)
        })
        it('mesaj govdeleri yalniz quoteId / quoted alanlarini kurar', () => {
            expect(src).toMatch(/type: 'COW_APPROVE_QUOTE', message: \{ quoteId \}/)
            expect(src).toMatch(/type: 'COW_APPROVE_EXECUTE', message: \{ quoteId, quoted \}/)
        })
    })
})

describe('StockTrade.vue -- logolar', () => {
    const IMG = { large: 'https://img.test/tsla-large.png', small: 'https://img.test/tsla-small.png', thumb: 'https://img.test/tsla-thumb.png' }
    const headerImg = (html) => (html.match(/<img[^>]*data-stock-logo[^>]*>/) ?? [''])[0]

    it('baslikta hisse logosu: sunucu image nesnesinden, listeyle ayni yardimci (large)', async () => {
        axiosMock.post = vi.fn(async () => ({ status: 200, data: { tokens: [{ coingecko_id: STOCK.coingeckoId, image: IMG }] } }))
        const { html } = await mount()
        const tag = headerImg(html)
        expect(tag).toContain('src="https://img.test/tsla-large.png"')
        expect(axiosMock.post.mock.calls[0][1]).toEqual({ ids: [STOCK.coingeckoId] })
    })

    it('image dize olarak gelirse de cozulur', async () => {
        axiosMock.post = vi.fn(async () => ({ status: 200, data: { tokens: [{ coingecko_id: STOCK.coingeckoId, image: 'https://img.test/s.png' }] } }))
        const { html } = await mount()
        expect(headerImg(html)).toContain('src="https://img.test/s.png"')
    })

    it('logo yoksa gri varsayilan resim DEGIL, bas harfli yer tutucu', async () => {
        const { html } = await mount()
        expect(headerImg(html)).toBe('')
        expect(html).not.toContain('/default-token.png')
        expect(html).toContain('data-stock-logo-placeholder')
        expect(text((html.match(/<span[^>]*data-stock-logo-placeholder[^>]*>[\s\S]*?<\/span>/) ?? [''])[0])).toBe(STOCK.symbol.charAt(0))
    })

    it('ag hatasinda ekran yine acilir, yer tutucu kalir', async () => {
        axiosMock.post = vi.fn(async () => { throw new Error('ag yok') })
        const { html } = await mount()
        expect(html).toContain('data-stock-logo-placeholder')
        expect(html).toContain('data-trade-tab="buy"')
    })

    it('hissenin ag rozeti Hisseler listesindeki gibi cizilir', async () => {
        const { html } = await mount()
        expect(html).toContain('data-stock-chain-logo')
    })

    it.each(['USDC', 'USDT'])('%s cipinde token logosu img var, alt sembol', async (sym) => {
        const { html } = await mount()
        const btn = (html.match(new RegExp(String.raw`<button[^>]*data-pay-token="${sym}"[^>]*>[\s\S]*?</button>`)) ?? [''])[0]
        const img = (btn.match(/<img[^>]*>/) ?? [''])[0]
        expect(img).toContain('src="https://coin-images.coingecko.com/')
        expect(img).toContain('alt="' + sym + '"')
        expect(text(btn)).toBe(sym)
    })
})

// --- Faz 3 (Task 14): ATS islem ucreti karti, ipucu, borc bildirimi ---
describe('StockTrade.vue -- Faz 3 ATS ucret karti', () => {
    const en = JSON.parse(readFileSync(resolve(HERE, '../../i18n/locales/en.json'), 'utf8'))
    const AF = en.stockTrade.atsFee
    const UP_TO = en.send.confirmTransaction.atsFeeUpTo
    const PREVIEW = { mode: 'ats', quotedAtsRaw: '1234500000000000000', decimals: 18, hint: false, lowNetworkFee: false }
    const NONE = { mode: 'none', quotedAtsRaw: null, decimals: null, hint: false, lowNetworkFee: false }
    const withPreview = (feePreview) => ({ state: 'ready', result: readyResult({ feePreview }), quoteId: 'q1' })
    // Kanca tasiyan elemanin icerigi: kart kapsayicisi ve ipucu satiri yaprak/dengeli bloklar.
    const hookEl = (html, name) => {
        const m = new RegExp('<([a-z0-9]+)\\b[^>]*' + name + '[^>]*>').exec(html)
        if (!m) return ''
        const re = new RegExp('<(/?)' + m[1] + '\\b[^>]*>', 'g')
        re.lastIndex = m.index + m[0].length
        let depth = 1
        let x
        while ((x = re.exec(html))) {
            depth += x[1] ? -1 : 1
            if (depth === 0) return html.slice(m.index, x.index + x[0].length)
        }
        return html.slice(m.index)
    }
    const cardOf = (html) => text(hookEl(html, 'data-trade-ats-fee')).replace(/&#39;/g, "'")
    const UID = '0x' + 'cd'.repeat(56)
    const feeView = (over = {}) => ({
        uid: UID, chainId: 1, state: 'owed', blocker: null, quotedAtsRaw: '1500000000000000000', freshFeeRaw: null,
        atsChargedRaw: null, paidTxHash: null, noServiceSince: null, refund: { state: 'none', atsRaw: null, txHash: null, code: null }, ...over,
    })
    // Arka plan yaniti sahte: yalniz mesaj turune gore.
    const backend = (impl) => {
        const calls = []
        return {
            calls,
            fn: async (msg) => {
                calls.push(msg)
                return (await impl(msg)) ?? { success: true }
            },
        }
    }
    const STATUS_OK = () => ({ success: true, fees: [], debt: false })
    async function mountWith(opts, impl = STATUS_OK) {
        const be = backend(impl)
        const ctx = build(opts)
        ctx.stub.setSendMessage(be.fn)
        const html = clean(await render(ctx.app))
        return { ...ctx, html, be }
    }

    it('mode ats: kart basligi + sub + when + refund, tutar quotedAtsRaw dan', async () => {
        const { html } = await mountWith({ amount: '10', state: withPreview(PREVIEW) })
        expect(html).toContain('data-trade-ats-fee')
        const c = cardOf(html)
        expect(c).toContain(AF.title)
        expect(c).toContain(AF.sub)
        expect(c).toContain(AF.when)
        expect(c).toContain(AF.refund)
        expect(c).toContain('1.23')
        expect(c).toContain('ATS')
    })
    it('kart "en fazla" niteleyicisini ve iade-yok satirini cizmez', async () => {
        const { html } = await mountWith({ amount: '10', state: withPreview(PREVIEW) })
        // sub metni kendi icinde 'up to' der; niteleyici AYRI bir span olarak cizilir.
        expect(hookEl(html, 'data-trade-ats-fee')).not.toMatch(new RegExp('>\s*' + UP_TO + '\s*<'))
        expect(cardOf(html)).not.toContain(en.send.confirmTransaction.atsFeeNoRefund)
    })
    it('kart detay kapsayicisinin hemen altinda (data-trade-powered sonrasi)', async () => {
        const { html } = await mountWith({ amount: '10', state: withPreview(PREVIEW) })
        expect(html.indexOf('data-trade-ats-fee')).toBeGreaterThan(html.indexOf('data-trade-powered'))
    })
    it('mode none: kart YOK, ipucu YOK (kalinti tutar/ondalik olsa bile)', async () => {
        const { html } = await mountWith({ amount: '10', state: withPreview({ ...NONE, quotedAtsRaw: '1000000000000000000', decimals: 18 }) })
        expect(html).not.toContain('data-trade-ats-fee')
        expect(html).not.toContain('data-trade-ats-hint')
        expect(html).not.toContain(AF.title)
    })
    it('mode none ciktisi feePreview hic yokken ile AYNI (Faz 2 ekrani birebir)', async () => {
        const a = await mountWith({ amount: '10', state: withPreview(NONE) })
        const b = await mountWith({ amount: '10', state: { state: 'ready', result: readyResult(), quoteId: 'q1' } })
        expect(a.html).toBe(b.html)
    })
    it('hint: tek satir ipucu, kart yok', async () => {
        const { html } = await mountWith({ amount: '10', state: withPreview({ ...NONE, hint: true }) })
        expect(html).toContain('data-trade-ats-hint')
        expect(text(hookEl(html, 'data-trade-ats-hint'))).toContain(AF.prepare)
        expect(html).not.toContain('data-trade-ats-fee')
    })
    it('lowNetworkFee true: netNote; false: yok', async () => {
        const on = await mountWith({ amount: '10', state: withPreview({ ...PREVIEW, lowNetworkFee: true }) })
        expect(cardOf(on.html)).toContain(AF.netNote)
        const off = await mountWith({ amount: '10', state: withPreview(PREVIEW) })
        expect(cardOf(off.html)).not.toContain(AF.netNote)
    })
    it('teklif kilitliyken (locked) kart cizilmez', async () => {
        const r = readyResult({ feePreview: PREVIEW, locked: true, lockReason: 'MARKET_CLOSED' })
        const { html } = await mountWith({ amount: '10', state: { state: 'locked', lockReason: 'MARKET_CLOSED', result: r } })
        expect(html).not.toContain('data-trade-ats-fee')
    })

    describe('borc kilidi', () => {
        const debtState = () => ({
            state: 'locked', lockReason: 'FEE_DEBT', quoteId: null,
            result: { success: true, locked: true, lockReason: 'FEE_DEBT', quoteId: null, display: null, approval: null, reference: null, notice: null, warnings: [], feeDebtUids: [UID] },
        })
        const debtStatus = () => ({ success: true, fees: [feeView()], debt: true })
        it('ana dugme kapali, metni payFirst; kilit satiri debtLock', async () => {
            const { html } = await mountWith({ amount: '10', state: debtState() }, debtStatus)
            const tag = primaryTag(html)
            expect(isDisabled(tag)).toBe(true)
            expect(text(tag)).toBe(AF.payFirst)
            expect(lockText(html)).toBe(AF.debtLock)
        })
        it('bildirim payNow dugmesiyle cizilir', async () => {
            const { html } = await mountWith({ amount: '10', state: debtState() }, debtStatus)
            expect(html).toContain('data-fee-notice')
            expect(html).toContain('data-fee-action="payNow"')
        })
        it('baska kilitte ana dugme metni payFirst degil', async () => {
            const r = readyResult({ locked: true, lockReason: 'MARKET_CLOSED' })
            const { html } = await mountWith({ amount: '10', state: { state: 'locked', lockReason: 'MARKET_CLOSED', result: r } })
            expect(text(primaryTag(html))).not.toBe(AF.payFirst)
        })
    })

    describe('bildirim ve eylemler', () => {
        const withFees = (fees) => () => ({ success: true, fees, debt: false })
        const ready = { amount: '10', state: withPreview(PREVIEW) }
        it('ekran acilisinda COW_FEE_STATUS bir kez okunur', async () => {
            const { be } = await mountWith(ready, withFees([feeView()]))
            expect(be.calls.filter((m) => m.type === 'COW_FEE_STATUS')).toHaveLength(1)
        })
        it('payNow -> COW_FEE_PAY, sonra gorunumler yeniden okunur', async () => {
            const { holder, be } = await mountWith(ready, withFees([feeView()]))
            be.calls.length = 0
            await holder.instance.setupState.onFeeAction({ name: 'payNow', uid: UID })
            expect(be.calls.map((m) => m.type)).toEqual(['COW_FEE_PAY', 'COW_FEE_STATUS'])
        })
        it('retry -> COW_FEE_PAY', async () => {
            const { holder, be } = await mountWith(ready, withFees([]))
            be.calls.length = 0
            await holder.instance.setupState.onFeeAction({ name: 'retry', uid: UID })
            expect(be.calls[0].type).toBe('COW_FEE_PAY')
        })
        it('approve -> COW_FEE_APPROVE_CHANGE {uid}; PENDING/APPROVED "onaylandi, ucret aliniyor" olarak islenir', async () => {
            const impl = (m) => (m.type === 'COW_FEE_APPROVE_CHANGE' ? { success: true, outcome: { outcome: 'PENDING', code: 'APPROVED' } } : STATUS_OK())
            const { holder, be } = await mountWith(ready, impl)
            be.calls.length = 0
            await holder.instance.setupState.onFeeAction({ name: 'approve', uid: UID })
            expect(be.calls[0]).toEqual({ type: 'COW_FEE_APPROVE_CHANGE', message: { uid: UID } })
            expect(holder.instance.setupState.feeApproved).toBe(true)
            expect(holder.instance.setupState.feeErrorCode).toBe(null)
        })
        it('approve basarisizsa onaylandi isaretlenmez, hata kodu ve kilit durumu gorunur', async () => {
            const impl = (m) => (m.type === 'COW_FEE_APPROVE_CHANGE' ? { success: false, code: 'WALLET_LOCKED' } : STATUS_OK())
            const { holder } = await mountWith(ready, impl)
            await holder.instance.setupState.onFeeAction({ name: 'approve', uid: UID })
            expect(holder.instance.setupState.feeApproved).toBe(false)
            expect(holder.instance.setupState.feeErrorCode).toBe('WALLET_LOCKED')
            expect(holder.instance.setupState.feeWalletLocked).toBe(true)
        })
        it('decline: mesaj YOK, yalniz bildirimi kapatir', async () => {
            const { holder, be } = await mountWith(ready, withFees([feeView({ state: 'blocked', blocker: 'FEE_CHANGED', freshFeeRaw: '2000000000000000000' })]))
            be.calls.length = 0
            await holder.instance.setupState.onFeeAction({ name: 'decline', uid: UID })
            expect(be.calls).toEqual([])
            expect(holder.instance.setupState.dismissedFees.includes(UID)).toBe(true)
        })
        it('buyAts -> mevcut ATS alim yolu (useAtsPurchase.open)', async () => {
            atsBuyMock.open.mockClear()
            const { holder } = await mountWith(ready, withFees([]))
            await holder.instance.setupState.onFeeAction({ name: 'buyAts', uid: UID })
            expect(atsBuyMock.open).toHaveBeenCalledTimes(1)
        })
        it('prepare -> ATS_RUN_ONBOARDING (BSC) ardindan COW_FEE_PAY', async () => {
            const impl = (m) => (m.type === 'ATS_RUN_ONBOARDING' ? { success: true } : STATUS_OK())
            const { holder, be } = await mountWith(ready, impl)
            be.calls.length = 0
            await holder.instance.setupState.onFeeAction({ name: 'prepare', uid: UID })
            const types = be.calls.map((m) => m.type)
            expect(types.indexOf('ATS_RUN_ONBOARDING')).toBeGreaterThanOrEqual(0)
            expect(types.indexOf('COW_FEE_PAY')).toBeGreaterThan(types.indexOf('ATS_RUN_ONBOARDING'))
            expect(be.calls.find((m) => m.type === 'ATS_RUN_ONBOARDING').message.chainId).toBe(56)
        })
        it('prepare basarisizsa COW_FEE_PAY gonderilmez', async () => {
            const impl = (m) => (m.type === 'ATS_RUN_ONBOARDING' ? { success: false, code: 'X' } : STATUS_OK())
            const { holder, be } = await mountWith(ready, impl)
            await holder.instance.setupState.onFeeAction({ name: 'prepare', uid: UID })
            expect(be.calls.some((m) => m.type === 'COW_FEE_PAY')).toBe(false)
        })
        it('bilinmeyen eylem adi hicbir mesaj gondermez', async () => {
            const { holder, be } = await mountWith(ready, withFees([]))
            be.calls.length = 0
            await holder.instance.setupState.onFeeAction({ name: 'drain', uid: UID })
            expect(be.calls).toEqual([])
        })
        it('uid bicimi gecersizse hicbir mesaj gonderilmez', async () => {
            const { holder, be } = await mountWith(ready, withFees([]))
            be.calls.length = 0
            await holder.instance.setupState.onFeeAction({ name: 'approve', uid: 'zz' })
            expect(be.calls).toEqual([])
        })
    })

    it('kaynak: Number( ile ucret tutari yok, ham error.message ve anahtar yok', () => {
        const kaynak = yorumsuz(readFileSync(resolve(HERE, 'StockTrade.vue'), 'utf8'))
        expect(kaynak).not.toMatch(/Number\(\s*[\w.]*quotedAtsRaw/)
        expect(kaynak).toContain('formatAmount(')
        expect(kaynak).not.toMatch(/privateKey|mnemonic|error\.message/)
    })
})

// StockOrderConfirm.vue (Task 22): imza oncesi katman + gonderim sonrasi durum paneli.
// Katman hesap yapmaz ve imzalanan yapiyi belirleyemez: yalniz { quoteId } gonderir (Review Focus 2).
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Yoklama: sabit reaktif nesne (test fazi doldurur). Zamanlayici/ag yok.
const watchOpts = vi.hoisted(() => ({ calls: [] }))
vi.mock('../../composables/useCowOrderWatch', async () => {
    const { reactive, toRef } = await import('vue')
    const __watch = reactive({ phase: 'submitting', apiStatus: null, txHash: null, executedBuy: null, executedSell: null, stillPending: false })
    return {
        useCowOrderWatch: (opts) => {
            watchOpts.calls.push(opts)
            return Object.fromEntries(Object.keys(__watch).map((k) => [k, toRef(__watch, k)]))
        },
        __watch,
    }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n, captureInstance } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { __watch } from '../../composables/useCowOrderWatch'
import { XSTOCKS } from '../../data/xStocks'
import { BSTOCKS } from '../../data/bStocks'
import { stockEntry } from '../../utils/tokenizedStocks'
import { cowEngine } from '../../utils/stocks/engines/cowEngine'
import { pancakeEngine } from '../../utils/stocks/engines/pancakeEngine'
import { pageStore } from '../../store/pageStore'
import { currencyStore } from '../../store/currency'
import { explorerTxUrl } from '../../utils/explorer'
import StockOrderConfirm from './StockOrderConfirm.vue'

const HERE = dirname(fileURLToPath(import.meta.url))
const STOCK = XSTOCKS.find((s) => s.chains.includes(1)) // G2
const STOCK_ENTRY = { ...STOCK, chainId: 1 }
const UID = `0x${'ab'.repeat(56)}`
const HASH = `0x${'12'.repeat(32)}`
const NOW = 1_800_000_000_000

const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '') // G3
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
// Kanca tasiyan elemanin TAMAMI (ayni etiket adina gore dengeli eslesme; ic ice ayni etiket olabilir).
const hook = (html, name) => {
    const m = new RegExp(`<([a-z0-9]+)\\b[^>]*${name}[^>]*>`).exec(html)
    if (!m) return ''
    const re = new RegExp(`<(/?)${m[1]}\\b[^>]*>`, 'g')
    re.lastIndex = m.index + m[0].length
    let depth = 1
    let x
    while ((x = re.exec(html))) {
        depth += x[1] ? -1 : 1
        if (depth === 0) return html.slice(m.index, x.index + x[0].length)
    }
    return html.slice(m.index)
}
const hookText = (html, name) => text(hook(html, name))
const isDisabled = (tag) => / disabled(=|>| )/.test(tag.replace(/class="[^"]*"/, ''))

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

const makeQuote = (over = {}) => ({
    state: 'ready', result: readyResult(), quoteId: 'q1', expiresAt: null, errorCode: null, lockReason: null,
    refresh: vi.fn(), invalidate: vi.fn(), ...over,
})

function build({ quote = makeQuote(), side = 'buy', locale = 'en', setup, chrome = {}, extra = {}, stock = STOCK_ENTRY, paySymbol = 'USDC', hazirla } = {}) {
    const stub = installChromeStub()
    if (chrome.send) stub.setSendMessage(chrome.send)
    const handlers = { onClose: vi.fn(), onExpired: vi.fn(), onPlaced: vi.fn(), onNew: vi.fn() }
    const app = createApp(StockOrderConfirm, {
        props: { quote, side, stock, paySymbol, locale, ...handlers, ...extra },
    })
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    hazirla?.(currencyStore())
    const holder = captureInstance(app, 'StockOrderConfirm', (inst) => setup?.(inst.setupState))
    return { app, holder, handlers, quote }
}

async function mount(opts) {
    const ctx = build(opts)
    const html = clean(await render(ctx.app))
    return { ...ctx, html }
}

const placedState = (over = {}) => ({ uid: UID, state: 'open', side: 'buy', symbol: STOCK.symbol, decimals: 18, paySymbol: 'USDC', payDecimals: 6, referencePrice: 222, placedAt: NOW, validTo: NOW + 1_800_000, chainId: 1, ...over })

beforeEach(() => {
    Object.assign(__watch, { phase: 'submitting', apiStatus: null, txHash: null, executedBuy: null, executedSell: null, stillPending: false })
    watchOpts.calls.length = 0
})
afterEach(() => {
    delete globalThis.chrome
    vi.useRealTimers()
})

describe('StockOrderConfirm.vue -- imza oncesi katman', () => {
    it('satirlar display dizeleriyle BIREBIR (Al): satilan, en az alinacak, ucret', async () => {
        const { html } = await mount()
        expect(html).toContain('data-order-confirm')
        expect(hookText(html, 'data-confirm-sell')).toBe('10 USDC')
        expect(hookText(html, 'data-confirm-min')).toBe(`0.044 ${STOCK.symbol}`)
        expect(hookText(html, 'data-confirm-fee')).toBe('$0.16')
        expect(text(html)).toContain('Confirm order')
    })

    it('ag ucreti satiri onay katmaninda (display varsa), yoksa yok', async () => {
        const quote = makeQuote({ result: readyResult({ display: { ...readyResult().display, networkFeeUsd: 0.62, networkFeePct: 6.2 } }) })
        const { html } = await mount({ quote })
        expect(hookText(html, 'data-confirm-network-fee')).toBe('Network fee: $0.62 (6.2%)')
        expect((await mount()).html).not.toContain('data-confirm-network-fee')
    })

    describe('secili para birimi (Plan B Gorev 12)', () => {
        const norm = (s) => s.replace(/[\u00a0\u202f]/g, ' ')
        const tazeKur = (rates) => {
            const now = Date.now()
            return { rates, currencies: [], updatedAt: now, stale: false, fetchedAt: now }
        }
        const tl = (store) => { store.code = 'try'; store.snapshot = tazeKur({ try: 40 }) }
        const kurYok = (store) => { store.code = 'try'; store.snapshot = null }
        const feeQuote = () => makeQuote({ result: readyResult({ display: { ...readyResult().display, networkFeeUsd: 0.62, networkFeePct: 6.2 } }) })

        it('try / kur 40 / tr: ucret "₺6,40", ag ucreti satiri "Ağ ücreti: ₺24,80 (%6,2)", "$" yok', async () => {
            const { html } = await mount({ quote: feeQuote(), locale: 'tr', hazirla: tl })
            expect(norm(hookText(html, 'data-confirm-fee'))).toBe('₺6,40')
            expect(norm(hookText(html, 'data-confirm-network-fee'))).toBe('Ağ ücreti: ₺24,80 (%6,2)')
            expect(text(html)).not.toContain('$')
        })

        it('kur yok (secili try, tablo yok): "USD 0.16" ve "Network fee: USD 0.62 (6.2%)", "₺" asla', async () => {
            const { html } = await mount({ quote: feeQuote(), hazirla: kurYok })
            expect(norm(hookText(html, 'data-confirm-fee'))).toBe('USD 0.16')
            expect(norm(hookText(html, 'data-confirm-network-fee'))).toBe('Network fee: USD 0.62 (6.2%)')
            expect(html).not.toContain('₺')
        })

        it('kaynak: quoteRows secili gorunumle cagrilir; yerel "display" (sign icinde) golgelenmez', () => {
            const kaynak = yorumsuz(readFileSync(resolve(HERE, 'StockOrderConfirm.vue'), 'utf8'))
            expect(kaynak).toMatch(/useMoney\(\)/)
            expect(kaynak).toMatch(/quoteRows\(\{[^}]*display: moneyDisplay\.value/)
        })
    })

    it('yuksek ag ucreti uyarisi onay katmaninda da gorunur (kilitsiz); yokken satir yok', async () => {
        const warn = makeQuote({ result: readyResult({ display: { ...readyResult().display, networkFeeUsd: 3.5, networkFeePct: 35, feeWarning: true } }) })
        const { html } = await mount({ quote: warn })
        expect(hookText(html, 'data-confirm-fee-warning').replace(/&#39;/g, "'")).toContain('The network fee is 35.0% of the amount. It can be expensive on small amounts.')
        expect(hookText(html, 'data-confirm-fee-warning').replace(/&#39;/g, "'")).toContain('On BSC the network fee is a few cents.')
        const bsc = await mount({ quote: warn, stock: { ...STOCK_ENTRY, chainId: 56 } })
        expect(hookText(bsc.html, 'data-confirm-fee-warning')).not.toContain('On BSC')
        expect((await mount()).html).not.toContain('data-confirm-fee-warning')
    })

    it('Sat: satilan hisse, en az alinacak odeme tokeni', async () => {
        const quote = makeQuote({
            result: readyResult({
                display: { ...readyResult().display, sellAmount: '2000000000000000000', sellDecimals: 18, minBuy: '438000000', buyDecimals: 6 },
            }),
        })
        const { html } = await mount({ side: 'sell', quote })
        expect(hookText(html, 'data-confirm-sell')).toBe(`2 ${STOCK.symbol}`)
        expect(hookText(html, 'data-confirm-min')).toBe('438 USDC')
    })

    it('gecerlilik: katmanin actigi an + 30 dk yerel saat', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(NOW)
        const { html } = await mount()
        const expected = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(NOW + 30 * 60 * 1000))
        expect(hookText(html, 'data-confirm-validity')).toBe(`Valid for 30 min, until ${expected}`)
    })

    it('permit modunda onay turu satiri (permit + sinirsiz izin notu); none modunda satir YOK', async () => {
        const permit = await mount()
        const row = hookText(permit.html, 'data-confirm-approval')
        expect(row).toContain('One-time permit signature (no gas)')
        expect(row).toContain('Unlimited allowance is granted to GPv2VaultRelayer')
        const none = await mount({ quote: makeQuote({ result: readyResult({ approval: { mode: 'none' } }) }) })
        expect(none.html).not.toContain('data-confirm-approval')
    })

    it('Turkce metin', async () => {
        const { html } = await mount({ locale: 'tr' })
        expect(text(hook(html, 'data-confirm-sign'))).toBe('İmzala ve gönder')
    })

    it('imza dugmesi etkin; signing iken kapali ve "Signing..."', async () => {
        const idle = await mount()
        expect(isDisabled(hook(idle.html, 'data-confirm-sign'))).toBe(false)
        const busy = await mount({ setup: (s) => { s.signing = true } })
        const tag = hook(busy.html, 'data-confirm-sign')
        expect(isDisabled(tag)).toBe(true)
        expect(text(tag)).toBe('Signing...')
    })

    it('teklif hazir degilse (loading) imza dugmesi kapali', async () => {
        const { html } = await mount({ quote: makeQuote({ state: 'loading' }) })
        expect(isDisabled(hook(html, 'data-confirm-sign'))).toBe(true)
    })

    it('katman acikken durum paneli yok', async () => {
        const { html } = await mount()
        expect(html).not.toContain('data-order-status')
    })
})

describe('StockOrderConfirm.vue -- gonderim', () => {
    it('mesaj BIREBIR { type: COW_PLACE_ORDER, message: { quoteId } }; ek alan YOK', async () => {
        const sent = []
        const send = async (m) => { sent.push(m); return { success: true, uid: UID, validTo: 1, state: 'open' } }
        const { holder } = await mount({ chrome: { send } })
        await holder.instance.setupState.sign()
        expect(sent).toHaveLength(1)
        expect(sent[0]).toEqual({ type: 'COW_PLACE_ORDER', message: { quoteId: 'q1' } })
        expect(Object.keys(sent[0])).toEqual(['type', 'message'])
        expect(Object.keys(sent[0].message)).toEqual(['quoteId'])
    })

    it('signing iken ikinci tik mesaj URETMEZ (cift tik yok)', async () => {
        const sent = []
        let release
        const send = (m) => { sent.push(m); return new Promise((r) => { release = r }) }
        const { holder } = await mount({ chrome: { send } })
        const s = holder.instance.setupState
        const first = s.sign()
        expect(s.signing).toBe(true)
        s.sign()
        s.sign()
        await Promise.resolve()
        expect(sent).toHaveLength(1)
        release({ success: true, uid: UID, validTo: 1, state: 'open' })
        await first
        expect(s.signing).toBe(false)
    })

    it('teklif hazir degilken ya da quoteId yokken mesaj yok', async () => {
        for (const over of [{ state: 'loading' }, { state: 'locked' }, { quoteId: null }, { result: readyResult({ approval: { mode: 'onchain' } }) }]) {
            const sent = []
            const { holder } = await mount({ quote: makeQuote(over), chrome: { send: async (m) => { sent.push(m); return { success: true } } } })
            await holder.instance.setupState.sign()
            expect(sent).toHaveLength(0)
        }
    })

    it('basari: placed + durum paneli kaydi (uid/state/yon/sembol/ondalik), placed olayi { uid }', async () => {
        const send = async () => ({ success: true, uid: UID, validTo: 1, state: 'submitting' })
        const { holder, handlers } = await mount({ chrome: { send } })
        const s = holder.instance.setupState
        await s.sign()
        expect(s.placed).toMatchObject({ uid: UID, state: 'submitting', side: 'buy', symbol: STOCK.symbol, decimals: 18 })
        expect(handlers.onPlaced).toHaveBeenCalledTimes(1)
        expect(handlers.onPlaced).toHaveBeenCalledWith({ uid: UID })
        expect(s.signing).toBe(false)
    })

    it('Sat tarafinda ondalik sellDecimals; yoklama uid getter ve zincir kimligiyle kurulur', async () => {
        const quote = makeQuote({ result: readyResult({ display: { ...readyResult().display, sellDecimals: 18 } }) })
        const { holder } = await mount({ side: 'sell', quote, chrome: { send: async () => ({ success: true, uid: UID, state: 'open' }) } })
        const s = holder.instance.setupState
        const opts = watchOpts.calls.at(-1)
        expect(opts.uid()).toBeNull()
        expect(opts.chainId).toBe(1)
        await s.sign()
        expect(opts.uid()).toBe(UID)
        expect(opts.initial()).toBe('pending')
        expect(s.placed.decimals).toBe(18)
    })

    it('state submitting -> yoklama "submitting" ile baslar', async () => {
        const { holder } = await mount({ chrome: { send: async () => ({ success: true, uid: UID, state: 'submitting' }) } })
        await holder.instance.setupState.sign()
        expect(watchOpts.calls.at(-1).initial()).toBe('submitting')
    })

    it('bozuk basari yaniti (uid yok) hata sayilir, panel acilmaz', async () => {
        const { holder, handlers } = await mount({ chrome: { send: async () => ({ success: true }) } })
        const s = holder.instance.setupState
        await s.sign()
        expect(s.placed).toBeNull()
        expect(s.errorCode).toBe('UNKNOWN')
        expect(handlers.onPlaced).not.toHaveBeenCalled()
    })
})

describe('StockOrderConfirm.vue -- hata esleme tablosu', () => {
    const CLOSING = ['QUOTE_EXPIRED', 'QUOTE_NOT_FOUND', 'QUOTE_USED', 'ACCOUNT_CHANGED', 'PERMIT_DOMAIN_MISMATCH', 'APPROVAL_REQUIRED']

    for (const code of CLOSING) {
        it(`${code}: katman KAPANIR (expired { code }), teklif yenilenir`, async () => {
            const { holder, handlers, quote } = await mount({ chrome: { send: async () => ({ success: false, code, detail: 'IC-AYRINTI' }) } })
            const s = holder.instance.setupState
            await s.sign()
            expect(handlers.onExpired).toHaveBeenCalledTimes(1)
            expect(handlers.onExpired).toHaveBeenCalledWith({ code })
            expect(quote.refresh).toHaveBeenCalledTimes(1)
            expect(handlers.onPlaced).not.toHaveBeenCalled()
            expect(s.signing).toBe(false)
        })
    }

    it('WALLET_LOCKED: katman ACIK kalir, kod metni gorunur', async () => {
        const { holder, handlers, quote } = await mount({ chrome: { send: async () => ({ success: false, code: 'WALLET_LOCKED' }) } })
        const s = holder.instance.setupState
        await s.sign()
        expect(s.errorCode).toBe('WALLET_LOCKED')
        expect(handlers.onExpired).not.toHaveBeenCalled()
        expect(handlers.onClose).not.toHaveBeenCalled()
        expect(quote.refresh).not.toHaveBeenCalled()
        const html = clean(await render((() => build({ setup: (st) => { st.errorCode = 'WALLET_LOCKED' } }).app)()))
        expect(text(hook(html, 'data-confirm-error'))).toContain('Wallet is locked, unlock it first')
        expect(html).toContain('data-order-confirm')
    })

    for (const code of ['FORBIDDEN', 'NETWORK', 'RATE_LIMITED', 'INVALID_ORDER', 'NOT_A_CODE']) {
        it(`${code}: katman acik kalir, hata metni stockTrade.error.<KOD>; ic ayrinti ASLA gosterilmez`, async () => {
            const send = async () => ({ success: false, code, detail: 'IC-AYRINTI-SIZINTISI', message: 'IC-MESAJ' })
            const { holder, handlers } = await mount({ chrome: { send } })
            const s = holder.instance.setupState
            await s.sign()
            expect(handlers.onExpired).not.toHaveBeenCalled()
            expect(s.errorCode).toBe(code === 'NOT_A_CODE' ? 'UNKNOWN' : code)
            const html = clean(await render(build({ setup: (st) => { st.errorCode = s.errorCode } }).app))
            const err = text(hook(html, 'data-confirm-error'))
            expect(err.length).toBeGreaterThan(0)
            expect(html).not.toContain('IC-AYRINTI')
            expect(html).not.toContain('IC-MESAJ')
        })
    }

    it('sendMessage reddi UNKNOWN olur, metin sizmaz', async () => {
        const { holder } = await mount({ chrome: { send: async () => { throw new Error('SIR-HATA-METNI') } } })
        const s = holder.instance.setupState
        await s.sign()
        expect(s.errorCode).toBe('UNKNOWN')
        expect(s.signing).toBe(false)
    })

    it('hata metni v-html DEGIL: kod metni kacislanir', async () => {
        const { html } = await mount({ setup: (s) => { s.errorCode = '<img src=x onerror=alert(1)>' } })
        expect(html).not.toContain('<img src=x')
    })
})

describe('StockOrderConfirm.vue -- teklif suresi', () => {
    it('sure dolunca katman KAPANIR: teklif yenilenir ve expired { code: null } (quote.updated bandi)', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(NOW)
        const quote = makeQuote({ expiresAt: NOW + 5000 })
        const { handlers } = await mount({ quote })
        vi.advanceTimersByTime(4999)
        expect(handlers.onExpired).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(handlers.onExpired).toHaveBeenCalledTimes(1)
        expect(handlers.onExpired).toHaveBeenCalledWith({ code: null })
        expect(quote.refresh).toHaveBeenCalledTimes(1)
    })

    it('suresi zaten gecmis teklif hemen kapanir', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(NOW)
        const quote = makeQuote({ expiresAt: NOW - 1 })
        const { handlers } = await mount({ quote })
        vi.advanceTimersByTime(0)
        expect(handlers.onExpired).toHaveBeenCalledTimes(1)
    })

    it('imzalama sirasinda ya da gonderim sonrasi sure olayi yok sayilir', async () => {
        const { holder, handlers, quote } = await mount({ setup: (s) => { s.signing = true } })
        holder.instance.setupState.onQuoteExpired()
        expect(handlers.onExpired).not.toHaveBeenCalled()
        const placed = await mount({ setup: (s) => { s.placed = placedState() } })
        placed.holder.instance.setupState.onQuoteExpired()
        expect(placed.handlers.onExpired).not.toHaveBeenCalled()
        expect(quote.refresh).not.toHaveBeenCalled()
    })
})

describe('StockOrderConfirm.vue -- durum paneli', () => {
    const panel = (phase, extra = {}, placed = placedState(), setupExtra = {}, mountExtra = {}) => {
        Object.assign(__watch, { phase }, extra)
        return mount({ setup: (s) => { s.placed = placed; Object.assign(s, setupExtra) }, ...mountExtra })
    }

    it('panel katmanin yerine gecer; faz data-order-status ile', async () => {
        const { html } = await panel('submitting')
        expect(hook(html, 'data-order-status')).toContain('data-order-status="submitting"')
        expect(html).not.toContain('data-confirm-sign')
        expect(text(html)).toContain('Submitting...')
    })

    it('beklerken: bes adimli ilerleme, o anki adim vurgulu; submitting -> "CoW\'a gonderildi"', async () => {
        const { html } = await panel('submitting')
        const items = html.match(/<li\b[^>]*data-order-step="[a-z]+"[^>]*>/g) ?? []
        expect(items).toHaveLength(5)
        const stateOf = (k) => /data-step-state="([a-z]+)"/.exec(items.find((i) => i.includes(`data-order-step="${k}"`)))[1]
        expect(['signed', 'sent', 'searching', 'settling', 'done'].map(stateOf)).toEqual(['done', 'current', 'upcoming', 'upcoming', 'upcoming'])
        const current = items.find((i) => i.includes('data-step-state="current"'))
        expect(current).toContain('aria-current="step"')
        expect(text(hook(html, 'data-order-steps'))).toContain('Order signed')
        expect(text(hook(html, 'data-order-steps'))).toContain('Sent to CoW')
    })

    it('pending: apiStatus adimi belirler (open/active -> fiyat aranıyor, solved/executing -> zincirde)', async () => {
        const cur = (html) => /data-order-step="([a-z]+)"[^>]*data-step-state="current"/.exec(html)?.[1]
        expect(cur((await panel('pending', { apiStatus: 'open' })).html)).toBe('searching')
        expect(cur((await panel('pending', { apiStatus: 'active' })).html)).toBe('searching')
        expect(cur((await panel('pending', { apiStatus: null })).html)).toBe('searching')
        expect(cur((await panel('pending', { apiStatus: 'solved' })).html)).toBe('settling')
        expect(cur((await panel('pending', { apiStatus: 'executing' })).html)).toBe('settling')
        const { html } = await panel('pending', { apiStatus: 'active' })
        expect(text(html)).toContain('Pending')
    })

    it('beklerken: gecen sure, "30 sn - 2 dk" notu, kapatabilirsin notu ve emir son gecerlilik saati', async () => {
        const { html } = await panel('pending', { apiStatus: 'active' }, placedState(), { nowMs: NOW + 65_000 })
        expect(hookText(html, 'data-order-elapsed')).toBe('Elapsed 1:05')
        expect(hookText(html, 'data-order-typical')).toBe('Usually takes 30 sec - 2 min')
        expect(hookText(html, 'data-order-hint')).toBe('You can close this window; the result will show in History.')
        const expected = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(NOW + 1_800_000))
        expect(hookText(html, 'data-order-valid-until')).toBe(`Order valid until ${expected}`)
    })

    it('durum degisimi aria-live="polite" bolgesinde duyurulur', async () => {
        const { html } = await panel('pending', { apiStatus: 'active' })
        expect(hook(html, 'data-order-live')).toContain('aria-live="polite"')
        expect(hook(html, 'data-order-live')).toContain('role="status"')
        const done = await panel('fulfilled', { txHash: HASH, executedBuy: '45000000000000000', executedSell: '10000000' })
        expect(hook(done.html, 'data-order-live')).toContain('aria-live="polite"')
    })

    it('stillPending ipucu yalniz bayrak aciksa', async () => {
        expect((await panel('pending', { stillPending: false })).html).not.toContain('data-order-still')
        const on = await panel('pending', { stillPending: true })
        expect(hookText(on.html, 'data-order-still')).toContain('Still pending')
    })

    it('secili para birimi: try / kur 40 / tr -> yaklasik tutar "≈ ₺399,60", ortalama fiyat "₺8.888,89", "$" yok', async () => {
        const norm = (v) => v.replace(/[  ]/g, ' ')
        const now = Date.now()
        const hazirla = (store) => { store.code = 'try'; store.snapshot = { rates: { try: 40 }, currencies: [], updatedAt: now, stale: false, fetchedAt: now } }
        const { html } = await panel('fulfilled', { txHash: HASH, executedBuy: '45000000000000000', executedSell: '10000000' }, placedState(), {}, { locale: 'tr', hazirla })
        expect(norm(hookText(html, 'data-order-usd'))).toBe('≈ ₺399,60')
        expect(norm(hookText(html, 'data-order-avg-price'))).toBe('₺8.888,89')
        expect(hook(html, 'data-order-usd')).not.toContain('$')
        expect(hook(html, 'data-order-avg-price')).not.toContain('$')
    })

    it('tamamlandi (Al): buyuk "alinan", odenen, yaklasik USD, ortalama fiyat, ag adi', async () => {
        const { html } = await panel('fulfilled', { txHash: HASH, executedBuy: '45000000000000000', executedSell: '10000000' })
        expect(hook(html, 'data-order-status')).toContain('data-order-status="fulfilled"')
        expect(text(html)).toContain('Completed')
        expect(hookText(html, 'data-order-received')).toBe(`0.045 ${STOCK.symbol}`)
        expect(hook(html, 'data-order-received')).toMatch(/text-(2xl|3xl)/)
        expect(hookText(html, 'data-order-paid')).toBe('10 USDC')
        expect(hookText(html, 'data-order-usd')).toBe(`≈ ${new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(0.045 * 222)}`)
        expect(hookText(html, 'data-order-avg-price')).toBe(new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(10 / 0.045))
        expect(hookText(html, 'data-order-network')).toContain('Ethereum')
        expect(html).toMatch(/<img\b[^>]*data-order-network-logo/)
        // adimlar tamamlandiktan sonra gosterilmez
        for (const yok of ['data-order-steps', 'data-order-typical', 'data-order-elapsed', 'data-order-hint']) expect(html).not.toContain(yok)
    })

    it('tamamlandi: referans fiyat yoksa USD satiri YOK; sayi uydurulmaz', async () => {
        const { html } = await panel('fulfilled', { txHash: HASH, executedBuy: '45000000000000000', executedSell: '10000000' }, placedState({ referencePrice: null }))
        expect(html).not.toContain('data-order-usd')
        expect(html).toContain('data-order-avg-price')
    })

    it('tamamlandi: kesilen ag ucreti kayitta yok -> satir YOK', async () => {
        const { html } = await panel('fulfilled', { txHash: HASH, executedBuy: '45000000000000000', executedSell: '10000000' })
        expect(html).not.toContain('data-order-fee')
    })

    it('tamamlandi: Turkce sayi bicimi (virgul ondalik, kucuk miktarda anlamli haneler)', async () => {
        Object.assign(__watch, { phase: 'fulfilled', txHash: HASH, executedBuy: '728000000000000', executedSell: '162000' })
        const { html } = await mount({ locale: 'tr', setup: (s) => { s.placed = placedState() } })
        expect(hookText(html, 'data-order-received')).toBe(`0,000728 ${STOCK.symbol}`)
        expect(hookText(html, 'data-order-paid')).toBe('0,162 USDC')
        expect(text(html)).toContain('Tamamlandı')
        expect(text(html)).toContain('Aldığın')
        expect(text(html)).toContain('Ödediğin')
        expect(text(html)).toContain('Ortalama fiyat')
    })

    it('tamamlandi (Sat): satilan hisse, alinan USDC; USD satiri YOK (alinan zaten dolar)', async () => {
        const { html } = await panel(
            'fulfilled',
            { txHash: HASH, executedBuy: '300000000', executedSell: '1500000000000000000' },
            placedState({ side: 'sell' }),
        )
        expect(hookText(html, 'data-order-received')).toBe('300 USDC')
        expect(hookText(html, 'data-order-paid')).toBe(`1.5 ${STOCK.symbol}`)
        expect(text(html)).toContain('You sold')
        expect(html).not.toContain('data-order-usd')
        expect(hookText(html, 'data-order-avg-price')).toBe(new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(200))
    })

    it('tamamlandi: gezgin baglantilari (islem hash + CoW Explorer emri), guvenli baglanti ozellikleri', async () => {
        const { html } = await panel('fulfilled', { txHash: HASH, executedBuy: '45000000000000000', executedSell: '10000000' })
        const tx = hook(html, 'data-order-explorer')
        expect(tx).toContain(`href="${explorerTxUrl(1, HASH)}"`)
        expect(tx).toContain('target="_blank"')
        expect(tx).toContain('noopener')
        expect(text(tx)).toBe('View transaction in explorer')
        const cow = hook(html, 'data-order-cow')
        expect(cow).toContain(`href="https://explorer.cow.fi/orders/${UID}"`)
        expect(cow).toContain('noopener')
        expect(text(cow)).toBe('View order in CoW Explorer')
    })

    it('tamamlandi ama txHash yok -> yalniz CoW Explorer baglantisi', async () => {
        const { html } = await panel('fulfilled', { txHash: null, executedBuy: '45000000000000000', executedSell: '10000000' })
        expect(html).not.toContain('data-order-explorer')
        expect(html).toContain('data-order-cow')
    })

    it('CoW Explorer ag yolu: BNB -> /bnb, Arbitrum -> /arb1', async () => {
        const bnb = await panel('fulfilled', { txHash: HASH, executedBuy: '1000', executedSell: '1000' }, placedState({ chainId: 56 }))
        expect(hook(bnb.html, 'data-order-cow')).toContain(`https://explorer.cow.fi/bnb/orders/${UID}`)
        const arb = await panel('fulfilled', { txHash: HASH, executedBuy: '1000', executedSell: '1000' }, placedState({ chainId: 42161 }))
        expect(hook(arb.html, 'data-order-cow')).toContain(`https://explorer.cow.fi/arb1/orders/${UID}`)
    })

    it('tamamlandi: Hisseyi goruntule, Yeni islem, Kapat (uc dugme)', async () => {
        const { html } = await panel('fulfilled', { txHash: HASH, executedBuy: '45000000000000000', executedSell: '10000000' })
        expect(html.match(/<button\b/g) ?? []).toHaveLength(3)
        expect(hookText(html, 'data-order-view-stock')).toBe('View stock')
        expect(hookText(html, 'data-order-new')).toBe('New trade')
        expect(hookText(html, 'data-order-close')).toBe('Close')
        expect(html).not.toContain('data-order-retry')
    })

    it('Hisseyi goruntule -> hisse detay sayfasi (token), klavyeyle erisilebilir gercek dugme', async () => {
        const { holder } = await panel('fulfilled', { txHash: HASH, executedBuy: '1000', executedSell: '1000' })
        holder.instance.setupState.viewStock()
        expect(pageStore().currentPage).toBe('token')
        const src = readFileSync(resolve(HERE, 'StockOrderConfirm.vue'), 'utf8')
        expect(src).toMatch(/<button[^>]*data-order-view-stock[^>]*@click="viewStock"/)
    })

    it('gerceklesmedi (expired): neden + guvence + Tekrar dene; nötr/amber, kirmizi DEGIL, adim/gezgin yok', async () => {
        const { html } = await panel('expired')
        expect(text(html)).toContain('Expired')
        expect(hookText(html, 'data-order-expired-desc')).toBe('The order expired; no solver matched it at this price.')
        expect(hookText(html, 'data-order-safe')).toBe('Your funds are still in your wallet; nothing was charged.')
        expect(hookText(html, 'data-order-retry')).toBe('Try again')
        expect(html).not.toMatch(/red-\d|rose-\d/)
        expect(html).toContain('amber')
        for (const yok of ['data-order-explorer', 'data-order-steps', 'data-order-received', 'data-order-view-stock']) expect(html).not.toContain(yok)
    })

    it('gerceklesmedi (cancelled): neden + guvence + Tekrar dene, kirmizi yok', async () => {
        const { html } = await panel('cancelled')
        expect(text(html)).toContain('Cancelled')
        expect(hookText(html, 'data-order-cancelled-desc')).toBe('The order was cancelled and not processed.')
        expect(hookText(html, 'data-order-safe')).toContain('nothing was charged')
        expect(html).toContain('data-order-retry')
        expect(html).not.toMatch(/red-\d|rose-\d/)
    })

    it('Tekrar dene -> close olayi (forma doner, tutar korunur); gercek dugme', async () => {
        const { holder, handlers } = await panel('expired')
        holder.instance.setupState.retry()
        expect(handlers.onClose).toHaveBeenCalledTimes(1)
        const src = readFileSync(resolve(HERE, 'StockOrderConfirm.vue'), 'utf8')
        expect(src).toMatch(/<button[^>]*data-order-retry[^>]*@click="retry"/)
    })

    it('guvence yalniz gerceklesmeyen durumda: beklerken ve tamamlaninca YOK', async () => {
        expect((await panel('pending')).html).not.toContain('data-order-safe')
        expect((await panel('fulfilled', { txHash: HASH, executedBuy: '1000', executedSell: '1000' })).html).not.toContain('data-order-safe')
    })

    for (const phase of ['submitting', 'pending', 'expired', 'cancelled']) {
        it(`${phase}: iptal dugmesi YOK; Kapat ve Yeni islem`, async () => {
            const { html } = await panel(phase)
            expect(html).not.toContain('data-confirm-cancel')
            expect(html).not.toContain('data-confirm-sign')
            expect(html).toContain('data-order-close')
            expect(html).toContain('data-order-new')
            const label = (name) => hookText(html, name)
            expect(label('data-order-close')).toBe('Close')
            expect(label('data-order-new')).toBe('New trade')
            expect(text(html)).not.toMatch(/cancel order|order cancel/i)
        })
    }

    it('beklerken Turkce: adimlar, sure notu, kapatabilirsin notu', async () => {
        Object.assign(__watch, { phase: 'pending', apiStatus: 'active' })
        const { html } = await mount({ locale: 'tr', setup: (s) => { s.placed = placedState() } })
        const t = text(html)
        for (const k of ['Emir imzalandı', "CoW'a gönderildi", 'En iyi fiyat aranıyor', 'Zincirde işleniyor', 'Tamamlandı', 'Genelde 30 sn - 2 dk sürer', 'Geçen süre 0:00', "Bu pencereyi kapatabilirsin; sonuç Geçmiş'te görünür."]) expect(t.replaceAll('&#39;', "'")).toContain(k)
    })

    it('Turkce durum metinleri', async () => {
        Object.assign(__watch, { phase: 'expired' })
        const { html } = await mount({ locale: 'tr', setup: (s) => { s.placed = placedState() } })
        expect(text(html)).toContain('Süresi doldu')
        expect(text(html)).toContain('Paran cüzdanında, bir şey kesilmedi.')
        expect(text(html)).toContain('Tekrar dene')
    })

    it('Kapat -> close, Yeni islem -> new olayi', async () => {
        const { holder, handlers } = await panel('fulfilled', { txHash: HASH })
        const s = holder.instance.setupState
        s.closePanel()
        expect(handlers.onClose).toHaveBeenCalledTimes(1)
        s.newTrade()
        expect(handlers.onNew).toHaveBeenCalledTimes(1)
    })

    it('katmandaki Vazgec -> close olayi', async () => {
        const { holder, handlers } = await mount()
        holder.instance.setupState.cancelLayer()
        expect(handlers.onClose).toHaveBeenCalledTimes(1)
    })

    it('imzalama sirasinda Vazgec kapali', async () => {
        const { html } = await mount({ setup: (s) => { s.signing = true } })
        expect(isDisabled(hook(html, 'data-confirm-cancel'))).toBe(true)
    })
})

// ---------------------------------------------------------------------------------------------
// bStocks (pancake) yolu: ayni katman, engine.place, "Islem gonderildi" paneli (T15, spec 5.4)
// ---------------------------------------------------------------------------------------------
const BSTOCK = stockEntry(56, BSTOCKS[0].address)
const BQ_REQUEST = {
    index: 3, chainId: 56, side: 'buy', slippage: 0.5,
    inTokenAddress: pancakeEngine.payTokens(56).find((p) => p.symbol === 'USDT').address,
    outTokenAddress: BSTOCK.address,
    amount: '10',
}
const bReady = (over = {}) => ({
    success: true, locked: false, lockReason: null, quoteId: 'ps_7', expiresAt: NOW + 30_000,
    request: BQ_REQUEST,
    display: {
        engine: 'pancake', sellAmount: '10000000000000000000', sellDecimals: 18, expectedBuy: '45000000000000000', buyDecimals: 18, minBuy: '44000000000000000',
        unitPrice: 222.2, referencePrice: 222, gapPct: 0.09, gapWarn: false, priceImpact: { pct: 0.31, high: false, unmeasured: false },
        fees: { kind: 'ats', transfer: '0.5', commission: '0.1', total: '0.6', lpFeePct: null },
    },
    approval: { mode: 'none' }, notice: null, warnings: [],
    ...over,
})
const bQuote = (over = {}) => makeQuote({ quoteId: 'ps_7', result: bReady(), expiresAt: null, ...over })
const ATS_QUOTED = { transferFee: 0.5, commissionFee: 0.1 }
const fakeEngine = (place) => ({ ...pancakeEngine, place })
async function bMount({ place = vi.fn(), side = 'buy', atsQuoted = ATS_QUOTED, atsBlocked = false, atsOpCount = 1, atsTotal = null, quote = bQuote(), ...rest } = {}) {
    const ctx = build({ quote, side, stock: BSTOCK, paySymbol: 'USDT', extra: { engine: fakeEngine(place), atsQuoted, atsBlocked, atsOpCount, atsTotal }, ...rest })
    const html = clean(await render(ctx.app))
    return { place, ...ctx, html }
}
const TX_OK = { ok: true, kind: 'tx', id: 'ps_7', hash: HASH, hashKind: 'userOp', submitted: true }
const txPlaced = (over = {}) => ({ kind: 'tx', side: 'buy', symbol: BSTOCK.symbol, hash: null, ...over })

describe('StockOrderConfirm.vue -- bStocks (pancake) imza oncesi katman', () => {
    it('satirlar motorun quoteRows undan: satilan, en az alinacak, fiyat etkisi, ATS ucreti; CoW ucreti/gecerlilik/izin satiri YOK', async () => {
        const { html } = await bMount()
        expect(hookText(html, 'data-confirm-sell')).toBe('10 USDT')
        expect(hookText(html, 'data-confirm-min')).toBe(`0.044 ${BSTOCK.symbol}`)
        expect(hookText(html, 'data-confirm-price-impact')).toContain('0.31%')
        expect(hookText(html, 'data-confirm-ats-network')).toContain('0.5')
        expect(hookText(html, 'data-confirm-ats-commission')).toContain('0.1')
        expect(html).not.toContain('data-confirm-fee')
        expect(html).not.toContain('data-confirm-validity')
        expect(html).not.toContain('data-confirm-approval')
        expect(html).not.toContain('data-confirm-network-fee')
    })

    it('A-3: tek op (opCount 1) -> Ag + Komisyon satirlari, toplam satiri YOK', async () => {
        const { html } = await bMount({ atsOpCount: 1, atsTotal: 0.6 })
        expect(html).toContain('data-confirm-ats-network')
        expect(html).toContain('data-confirm-ats-commission')
        expect(html).not.toContain('data-confirm-ats-total')
    })

    it('A-3: bootstrap op varsa (opCount 2) yalniz GERCEK toplam gosterilir; eksik Ag + Komisyon kalemleri YOK', async () => {
        // transferFee 0.5 + komisyon 0.1 + op1 0.3 = 0.9: kalemler toplami tutmaz, katman ana ekranla ayni toplami soylemeli.
        const { html } = await bMount({ atsQuoted: { transferFee: 0.5, commissionFee: 0.1 }, atsOpCount: 2, atsTotal: 0.9 })
        expect(hookText(html, 'data-confirm-ats-total')).toContain('0.9')
        expect(html).not.toContain('data-confirm-ats-network')
        expect(html).not.toContain('data-confirm-ats-commission')
    })

    it('A-3: StockTrade katmana op sayisi ve gercek toplami AKTARIR (kablolama)', () => {
        const src = readFileSync(join(HERE, 'StockTrade.vue'), 'utf8')
        expect(src).toMatch(/<StockOrderConfirm[\s\S]*?:ats-op-count="gates\.ats\.opCount"[\s\S]*?:ats-total="gates\.ats\.totalAtsCost"/)
    })

    it('A-3: opCount 2 ama toplam bilinmiyorsa imza dugmesi KAPALI (eksik tahsilat gosterilerek riza alinmaz)', async () => {
        const { html, holder, place } = await bMount({ atsOpCount: 2, atsTotal: null })
        expect(isDisabled(hook(html, 'data-confirm-sign'))).toBe(true)
        await holder.instance.setupState.sign()
        expect(place).not.toHaveBeenCalled()
    })

    it('fiyat etkisi olculemediyse "Olculemedi" metni, yoksa satir hic yok', async () => {
        const unmeasured = bQuote({ result: bReady({ display: { ...bReady().display, priceImpact: { pct: null, high: false, unmeasured: true } } }) })
        const a = await bMount({ quote: unmeasured })
        expect(hookText(a.html, 'data-confirm-price-impact')).toContain('Not measured')
        const none = bQuote({ result: bReady({ display: { ...bReady().display, priceImpact: undefined } }) })
        const b = await bMount({ quote: none })
        expect(b.html).not.toContain('data-confirm-price-impact')
    })

    it('imza dugmesi: atsQuoted yoksa ya da atsBlocked ise KAPALI ve place cagrilmaz', async () => {
        for (const o of [{ atsQuoted: null }, { atsBlocked: true }]) {
            const { html, holder, place } = await bMount(o)
            expect(isDisabled(hook(html, 'data-confirm-sign'))).toBe(true)
            await holder.instance.setupState.sign()
            expect(place).not.toHaveBeenCalled()
        }
        const ok = await bMount()
        expect(isDisabled(hook(ok.html, 'data-confirm-sign'))).toBe(false)
    })
})

describe('StockOrderConfirm.vue -- bStocks gonderim (engine.place)', () => {
    it('engine.place BIR kez, motorun bekledigi alanlarla; dogrudan chrome mesaji YOK', async () => {
        const sent = []
        const place = vi.fn().mockResolvedValue(TX_OK)
        const { holder } = await bMount({ place, chrome: { send: async (m) => { sent.push(m); return {} } } })
        await holder.instance.setupState.sign()
        expect(place).toHaveBeenCalledTimes(1)
        const a = place.mock.calls[0][0]
        expect(a.quote.quoteId).toBe('ps_7')
        expect(a.request).toEqual(BQ_REQUEST)
        expect(a.atsQuoted).toEqual(ATS_QUOTED)
        expect(a.atsBlocked).toBe(false)
        expect(a.accountIndex).toBe(3)
        expect(sent).toHaveLength(0)
    })

    it('gecmis karti kimligi: Al -> in = odeme tokeni, out = hisse; adresler ISTEKTEN', async () => {
        const place = vi.fn().mockResolvedValue(TX_OK)
        const { holder } = await bMount({ place })
        await holder.instance.setupState.sign()
        const a = place.mock.calls[0][0]
        expect(a.inTokenData).toEqual({ symbol: 'USDT', name: 'USDT', address: BQ_REQUEST.inTokenAddress })
        expect(a.outTokenData).toEqual({ symbol: BSTOCK.symbol, name: BSTOCK.name, address: BSTOCK.address })
    })

    it('gecmis karti kimligi: Sat -> in = hisse, out = odeme tokeni', async () => {
        const request = { ...BQ_REQUEST, side: 'sell', inTokenAddress: BSTOCK.address, outTokenAddress: BQ_REQUEST.inTokenAddress, amount: '1' }
        const place = vi.fn().mockResolvedValue(TX_OK)
        const { holder } = await bMount({ place, side: 'sell', quote: bQuote({ result: bReady({ request }) }) })
        await holder.instance.setupState.sign()
        const a = place.mock.calls[0][0]
        expect(a.inTokenData.symbol).toBe(BSTOCK.symbol)
        expect(a.inTokenData.address).toBe(BSTOCK.address)
        expect(a.outTokenData.symbol).toBe('USDT')
    })

    it('hisse adresi istekle eslesmezse kimlik YOLLANMAZ (QUOTE_MISMATCH riski yok)', async () => {
        const request = { ...BQ_REQUEST, inTokenAddress: '0x0000000000000000000000000000000000000abc', outTokenAddress: '0x0000000000000000000000000000000000000def' }
        const place = vi.fn().mockResolvedValue(TX_OK)
        const { holder } = await bMount({ place, quote: bQuote({ result: bReady({ request }) }) })
        await holder.instance.setupState.sign()
        const a = place.mock.calls[0][0]
        expect(a.inTokenData).toBeUndefined()
        expect(a.outTokenData).toBeUndefined()
    })

    it('signing iken ikinci tik place URETMEZ', async () => {
        let release
        const place = vi.fn(() => new Promise((r) => { release = r }))
        const { holder } = await bMount({ place })
        const s = holder.instance.setupState
        const first = s.sign()
        s.sign()
        s.sign()
        await Promise.resolve()
        expect(place).toHaveBeenCalledTimes(1)
        release(TX_OK)
        await first
    })

    it('basari: placed kind tx, placed olayi, emir yoklayicisi BASLAMAZ (uid null)', async () => {
        const place = vi.fn().mockResolvedValue(TX_OK)
        const { holder, handlers } = await bMount({ place })
        const s = holder.instance.setupState
        await s.sign()
        expect(s.placed).toMatchObject({ kind: 'tx', side: 'buy', symbol: BSTOCK.symbol })
        expect(handlers.onPlaced).toHaveBeenCalledTimes(1)
        expect(watchOpts.calls.at(-1).uid()).toBeNull()
    })

    it('panel: gonderildi + Gecmis baglantisi; kapat/yeni islem; expired/cancelled/gezgin/iptal/basari metni YOK', async () => {
        const { html } = await bMount({ setup: (s) => { s.placed = txPlaced({ hash: HASH }) } })
        expect(hook(html, 'data-order-status')).toContain('data-order-status="submitted"')
        expect(hookText(html, 'data-order-status')).toContain('Transaction submitted')
        expect(hookText(html, 'data-order-history')).toBe('Track in History')
        expect(html).toContain('data-order-close')
        expect(html).toContain('data-order-new')
        for (const yok of ['data-order-expired-desc', 'data-order-explorer', 'data-order-progress', 'data-order-still']) expect(html).not.toContain(yok)
        expect(text(html)).not.toMatch(/Expired|Cancelled|Done:|bought|sold/)
        expect(html).not.toContain('border-red')
        expect(html).not.toContain('data-confirm-sign')
    })

    it('A-2: unverified sonuc -> panel "gonderildi" kalir ama aciklama belirsizlik uyarisi (tekrar deneme) tasir', async () => {
        const place = vi.fn().mockResolvedValue({ ...TX_OK, unverified: true })
        const { holder } = await bMount({ place })
        const s = holder.instance.setupState
        await s.sign()
        expect(s.placed).toMatchObject({ kind: 'tx', unverified: true })
        const ctx = await bMount({ setup: (st) => { st.placed = txPlaced({ unverified: true }) } })
        expect(ctx.html).toContain('data-order-unverified')
        expect(hookText(ctx.html, 'data-order-unverified')).toMatch(/could not be confirmed/i)
        expect(hookText(ctx.html, 'data-order-unverified')).toMatch(/History/)
        expect(ctx.html).not.toContain('data-order-submitted-desc')
        const normal = await bMount({ setup: (st) => { st.placed = txPlaced() } })
        expect(normal.html).not.toContain('data-order-unverified')
    })

    it('Turkce panel metni', async () => {
        const { html } = await bMount({ locale: 'tr', setup: (s) => { s.placed = txPlaced() } })
        expect(hookText(html, 'data-order-status')).toContain('İşlem gönderildi')
        expect(hookText(html, 'data-order-history').replace('&#39;', "'")).toBe("Geçmiş'te takip et")
    })

    it('Gecmis baglantisi: ana ekran Etkinlik sekmesine gider', async () => {
        const ctx = await bMount({ setup: (s) => { s.placed = txPlaced() } })
        const page = pageStore()
        page.currentPage = 'token'
        page.homeTab = 'assets'
        ctx.holder.instance.setupState.openHistory()
        expect(page.currentPage).toBe('home')
        expect(page.homeTab).toBe('activity')
    })

    it('ATS_BLOCKED: katman ACIK kalir, hata kodu gorunur, panel acilmaz', async () => {
        const place = vi.fn().mockResolvedValue({ ok: false, code: 'ATS_BLOCKED' })
        const { holder, handlers } = await bMount({ place })
        const s = holder.instance.setupState
        await s.sign()
        expect(s.errorCode).toBe('ATS_BLOCKED')
        expect(s.placed).toBeNull()
        expect(handlers.onExpired).not.toHaveBeenCalled()
        expect(handlers.onPlaced).not.toHaveBeenCalled()
        expect(s.signing).toBe(false)
    })

    for (const code of ['QUOTE_EXPIRED', 'QUOTE_NOT_FOUND', 'QUOTE_USED', 'ACCOUNT_CHANGED']) {
        it(`${code}: katman KAPANIR (expired { code }) ve teklif yenilenir`, async () => {
            const place = vi.fn().mockResolvedValue({ ok: false, code })
            const { holder, handlers, quote } = await bMount({ place })
            await holder.instance.setupState.sign()
            expect(handlers.onExpired).toHaveBeenCalledWith({ code })
            expect(quote.refresh).toHaveBeenCalledTimes(1)
        })
    }

    it('kume disi kod, firlatan place ve bozuk sonuc UNKNOWN olur; ic ayrinti sizmaz', async () => {
        for (const place of [vi.fn().mockResolvedValue({ ok: false, code: 'garip' }), vi.fn().mockRejectedValue(new Error('ic ayrinti')), vi.fn().mockResolvedValue({ ok: true })]) {
            const { holder } = await bMount({ place })
            const s = holder.instance.setupState
            await s.sign()
            expect(s.errorCode).toBe('UNKNOWN')
            expect(s.placed).toBeNull()
        }
    })

    it('hata metni motorun errorKey inden: ag hatasi bStocks ta CoW metni DEGIL', async () => {
        const place = vi.fn().mockResolvedValue({ ok: false, code: 'NETWORK' })
        const { holder } = await bMount({ place, setup: (s) => { s.errorCode = 'NETWORK' } })
        const s = holder.instance.setupState
        expect(s.errorKeyOf('NETWORK')).toBe('stockTrade.error.NETWORK_GENERIC')
        expect(s.errorKeyOf('FORBIDDEN')).toBe('stockTrade.error.UNKNOWN')
    })

    it('teklif suresi dolunca katman kapanir (expiresAt)', async () => {
        vi.useFakeTimers()
        vi.setSystemTime(NOW)
        const ctx = await bMount({ quote: bQuote({ expiresAt: NOW + 5000 }) })
        vi.advanceTimersByTime(5001)
        expect(ctx.handlers.onExpired).toHaveBeenCalledWith({ code: null })
    })
})

describe('StockOrderConfirm.vue -- xStocks da engine.place uzerinden, AYNI davranis', () => {
    it('engine prop u yoksa cowEngine; verilirse de ayni: COW_PLACE_ORDER { quoteId }, placed.state engine sonucundan', async () => {
        const sent = []
        const send = async (m) => { sent.push(m); return { success: true, uid: UID, validTo: 1, state: 'open' } }
        const a = await mount({ chrome: { send } })
        await a.holder.instance.setupState.sign()
        expect(a.holder.instance.setupState.placed).toMatchObject({ uid: UID, state: 'open' })
        const b = build({ chrome: { send }, extra: { engine: cowEngine } })
        const html = clean(await render(b.app))
        expect(html).toContain('data-confirm-fee')
        expect(html).toContain('data-confirm-validity')
        await b.holder.instance.setupState.sign()
        expect(sent).toEqual([
            { type: 'COW_PLACE_ORDER', message: { quoteId: 'q1' } },
            { type: 'COW_PLACE_ORDER', message: { quoteId: 'q1' } },
        ])
        expect(b.holder.instance.setupState.placed).toMatchObject({ uid: UID, state: 'open' })
    })
})

describe('kaynak taramasi', () => {
    const src = yorumsuz(readFileSync(resolve(HERE, 'StockOrderConfirm.vue'), 'utf8'))
    it('hesap/yerlestirme/depolama sozlesmesi icermez', () => {
        for (const yasak of ['parseUnits', 'computeAmounts', 'GPV2_', 'sellAmount:', 'localStorage', 'v-html']) {
            expect(src).not.toContain(yasak)
        }
    })
    it('bStocks panelinin uc dugmesi fonksiyona bagli (SSR @click gormez): Gecmis, Kapat, Yeni islem', () => {
        expect(src).toMatch(/data-order-history[^>]*@click="openHistory"/)
        const kapat = src.match(/data-order-close[^>]*@click="closePanel"/g) || []
        const yeni = src.match(/data-order-new[^>]*@click="newTrade"/g) || []
        expect(kapat.length).toBeGreaterThanOrEqual(2) // bStocks paneli + CoW paneli
        expect(yeni.length).toBeGreaterThanOrEqual(2)
    })
    it('atsBlocked sabit degil, prop olarak motora aktarilir', () => {
        expect(src).toMatch(/atsBlocked:\s*props\.atsBlocked/)
    })
    it('COW_PLACE_ORDER hicbir .vue bilesende YOK: onay katmani mesaji kurmaz, engine.place cagirir (T15)', () => {
        const tara = (dir) =>
            readdirSync(dir).flatMap((ad) => {
                const yol = join(dir, ad)
                if (statSync(yol).isDirectory()) return tara(yol)
                return yol.endsWith('.vue') ? [yol] : []
            })
        const icerenler = tara(resolve(HERE, '..', '..'))
            .filter((yol) => yorumsuz(readFileSync(yol, 'utf8')).includes('COW_PLACE_ORDER'))
            .map((yol) => yol.replace(/\\/g, '/').split('/').pop())
        expect(icerenler).toEqual([])
        expect(src).toMatch(/\.place\(/)
    })
    it('mesaj govdesinde yalniz quoteId anahtari (cowEngine.js)', () => {
        const eng = yorumsuz(readFileSync(resolve(HERE, '../../utils/stocks/engines/cowEngine.js'), 'utf8'))
        expect(eng).toMatch(/type:\s*'COW_PLACE_ORDER',\s*message:\s*\{\s*quoteId[^,}]*\}/)
    })
    it('SWAP / birim cevrimi / ATS hesabi onay katmaninda YOK (motor yapar)', () => {
        for (const yasak of ["type: 'SWAP'", 'uiMultiplier', 'toRawSpendAmount', 'readUiMultiplier', 'parseUnits', '* 1e18', '/ 1e18']) {
            expect(src).not.toContain(yasak)
        }
    })
})

describe('StockOrderConfirm.vue -- Faz 3 ATS ucret satiri', () => {
    const quoteWith = (feePreview) => makeQuote({ result: readyResult(feePreview === undefined ? {} : { feePreview }) })
    const ATS_PREVIEW = { mode: 'ats', quotedAtsRaw: '1234500000000000000', decimals: 18, hint: false, lowNetworkFee: false }

    it('mode ats: data-confirm-ats-fee satiri, tutar quotedAtsRaw dan', async () => {
        const { html } = await mount({ quote: quoteWith(ATS_PREVIEW) })
        expect(html).toContain('data-confirm-ats-fee')
        expect(hookText(html, 'data-confirm-ats-fee')).toContain('1.23 ATS')
    })
    it('mode ats: satir genel ucret satirinin ALTINDA', async () => {
        const { html } = await mount({ quote: quoteWith(ATS_PREVIEW) })
        expect(html.indexOf('data-confirm-ats-fee')).toBeGreaterThan(html.indexOf('data-confirm-fee>'))
    })
    it('mode none: satir YOK (Faz 2 katmani)', async () => {
        const { html } = await mount({ quote: quoteWith({ mode: 'none', quotedAtsRaw: null, decimals: null, hint: false, lowNetworkFee: false }) })
        expect(html).not.toContain('data-confirm-ats-fee')
    })
    it('feePreview yok: satir YOK', async () => {
        const { html } = await mount({ quote: quoteWith(undefined) })
        expect(html).not.toContain('data-confirm-ats-fee')
    })
    it('kaynak: tutar formatAmount ile, Number( yok', () => {
        const kaynak = yorumsuz(readFileSync(resolve(HERE, 'StockOrderConfirm.vue'), 'utf8'))
        expect(kaynak).toContain('formatAmount(')
        expect(kaynak).not.toMatch(/Number\(\s*[\w.]*quotedAtsRaw/)
        expect(kaynak).not.toMatch(/privateKey|mnemonic|error\.message/)
    })
})

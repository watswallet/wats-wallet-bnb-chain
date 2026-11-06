// useStockEngineGates: bStocks Al/Sat ekraninin motor-bagimli kapilari (ATS ucreti + fiyat etkisi onayi).
// Vue bilesen testi yok (test-utils yok): composable bir effectScope icinde, chrome mesajlari sahte.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { useStockEngineGates } from './useStockEngineGates'
import { pancakeEngine } from '../utils/stocks/engines/pancakeEngine'
import { cowEngine } from '../utils/stocks/engines/cowEngine'

const REQUEST = Object.freeze({
    side: 'buy',
    chainId: 56,
    stockAddress: '0x0000000000000000000000000000000000000abc',
    payToken: '0x55d398326f99059fF775485246999027B3197955',
    inTokenAddress: '0x55d398326f99059fF775485246999027B3197955',
    outTokenAddress: '0x0000000000000000000000000000000000000abc',
    amount: '25',
    referencePrice: 250,
    index: "m/44'/60'/0'/0/0",
    slippage: 0.5,
})

const ATS_OK = { success: true, transferFee: 1.5, symbol: 'ATS', atsBalance: 10, opCount: 1, ready: true, commissionAts: '0', commissionAtsHuman: 0.2, nextSteps: [] }

const readyQuote = (over = {}) =>
    reactive({
        state: 'ready',
        quoteId: 'ps_1',
        result: { success: true, request: { ...REQUEST }, display: { priceImpact: { pct: 0.3, high: false, unmeasured: false } } },
        ...over,
    })

let sent
let reply
let scope

function setup({ engine = pancakeEngine, quote = readyQuote(), account = { address: '0xAbCdEf0000000000000000000000000000000001' } } = {}) {
    let api
    scope = effectScope()
    scope.run(() => {
        api = useStockEngineGates({ engine: ref(engine), quote, account: ref(account) })
    })
    return { api, quote }
}

const settle = async () => {
    for (let i = 0; i < 6; i += 1) await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    for (let i = 0; i < 3; i += 1) await nextTick()
}

beforeEach(() => {
    sent = []
    reply = async () => ({ ...ATS_OK })
    globalThis.chrome = {
        runtime: {
            sendMessage: vi.fn(async (m) => {
                sent.push(m)
                return reply(m)
            }),
        },
    }
})
afterEach(() => {
    scope?.stop()
    scope = null
    delete globalThis.chrome
})

describe('useStockEngineGates -- ATS ucreti (pancake)', () => {
    it('hazir teklifte ATS_SWAP_FEE_QUOTE motorun yukuyle istenir ve atsQuoted dolar', async () => {
        const { api } = setup()
        await settle()
        expect(sent).toHaveLength(1)
        expect(sent[0].type).toBe('ATS_SWAP_FEE_QUOTE')
        expect(sent[0].message).toEqual(pancakeEngine.atsPayload({ ...REQUEST }).payload)
        expect(api.atsQuoted.value).toEqual({ transferFee: 1.5, commissionFee: 0.2 })
        expect(api.extraBlock.value).toBeNull()
        expect(api.atsBlocked.value).toBe(false)
    })

    it('ucret gelene kadar ats-loading, atsQuoted null', async () => {
        let release
        reply = () => new Promise((r) => { release = () => r({ ...ATS_OK }) })
        const { api } = setup()
        await settle()
        expect(api.extraBlock.value).toBe('ats-loading')
        expect(api.atsQuoted.value).toBeNull()
        release()
        await settle()
        expect(api.extraBlock.value).toBeNull()
    })

    it('bakiye ucreti karsilamiyorsa ats-insufficient', async () => {
        reply = async () => ({ ...ATS_OK, atsBalance: 0.5 })
        const { api } = setup()
        await settle()
        expect(api.extraBlock.value).toBe('ats-insufficient')
        expect(api.atsBlocked.value).toBe(true)
    })

    it('arka plan hazir degil derse ats-blocked', async () => {
        reply = async () => ({ ...ATS_OK, ready: false })
        const { api } = setup()
        await settle()
        expect(api.extraBlock.value).toBe('ats-blocked')
    })

    it('ucret istegi hata donerse ats-blocked (fail-closed) ve atsQuoted null', async () => {
        reply = async () => ({ success: false, error: 'x', code: 'whatever' })
        const { api } = setup()
        await settle()
        expect(api.extraBlock.value).toBe('ats-blocked')
        expect(api.atsQuoted.value).toBeNull()
    })

    it('yeni teklif kimligi: ucret yeniden istenir ve eski ucret yeni teklife SAYILMAZ', async () => {
        const { api, quote } = setup()
        await settle()
        expect(api.extraBlock.value).toBeNull()
        let release
        reply = () => new Promise((r) => { release = () => r({ ...ATS_OK, transferFee: 2 }) })
        quote.state = 'loading'
        await settle()
        quote.quoteId = 'ps_2'
        quote.state = 'ready'
        await settle()
        expect(sent).toHaveLength(2)
        expect(api.extraBlock.value).toBe('ats-loading')
        expect(api.atsQuoted.value).toBeNull()
        release()
        await settle()
        expect(api.atsQuoted.value).toEqual({ transferFee: 2, commissionFee: 0.2 })
        expect(api.extraBlock.value).toBeNull()
    })

    it('yeni teklif gelir gelmez (izleyici calismadan) eski ucret SAYILMAZ: ats-loading, atsQuoted null', async () => {
        const { api, quote } = setup()
        await settle()
        expect(api.atsQuoted.value).not.toBeNull()
        quote.quoteId = 'ps_2' // await YOK: izleyici henuz kosmadi
        expect(api.extraBlock.value).toBe('ats-loading')
        expect(api.atsQuoted.value).toBeNull()
    })

    it('teklif yuklenirken (loading) ek kapi yok: dugmeyi quote-loading kapatir', async () => {
        const { api, quote } = setup()
        await settle()
        quote.state = 'loading'
        await settle()
        expect(api.extraBlock.value).toBeNull()
    })

    it('teklif idle/error olunca ucret durumu sifirlanir', async () => {
        const { api, quote } = setup()
        await settle()
        expect(api.ats.atsFee).toBe(1.5)
        quote.state = 'idle'
        quote.result = null
        await settle()
        expect(api.ats.atsFee).toBeNull()
        expect(api.atsQuoted.value).toBeNull()
    })

    it('startOnboarding: ATS_RUN_ONBOARDING ile ayni yuk, sonra ucret tazelenir', async () => {
        const { api } = setup()
        await settle()
        reply = async (m) => (m.type === 'ATS_RUN_ONBOARDING' ? { success: true } : { ...ATS_OK })
        const ok = await api.startOnboarding()
        expect(ok).toBe(true)
        const onboarding = sent.find((m) => m.type === 'ATS_RUN_ONBOARDING')
        expect(onboarding.message).toEqual({ chainId: 56, address: '0xAbCdEf0000000000000000000000000000000001', index: REQUEST.index })
        expect(sent.at(-1).type).toBe('ATS_SWAP_FEE_QUOTE')
    })
})

describe('useStockEngineGates -- cow motoru', () => {
    it('xStocks: ATS istegi HIC gitmez, ek kapi yok', async () => {
        const quote = readyQuote({ quoteId: 'q1' })
        quote.result.display.priceImpact = { pct: 50, high: true, unmeasured: false }
        const { api } = setup({ engine: cowEngine, quote })
        await settle()
        expect(sent).toHaveLength(0)
        expect(api.extraBlock.value).toBeNull()
        expect(api.atsQuoted.value).toBeNull()
        expect(api.priceImpactHigh.value).toBe(false)
    })
})

describe('useStockEngineGates -- fiyat etkisi onayi', () => {
    const highQuote = (id = 'ps_1') => {
        const q = readyQuote({ quoteId: id })
        q.result.display.priceImpact = { pct: 7.5, high: true, unmeasured: false }
        return q
    }

    it('etki > %5: onay verilene kadar price-impact; onayla acilir', async () => {
        const { api } = setup({ quote: highQuote() })
        await settle()
        expect(api.priceImpactHigh.value).toBe(true)
        expect(api.extraBlock.value).toBe('price-impact')
        api.acknowledged.value = true
        expect(api.extraBlock.value).toBeNull()
    })

    it('ats-loading price-impact ten once gelir (sira: ucret, sonra onay)', async () => {
        reply = () => new Promise(() => {})
        const { api } = setup({ quote: highQuote() })
        await settle()
        expect(api.extraBlock.value).toBe('ats-loading')
    })

    it('onay her yeni teklifte duser', async () => {
        const { api, quote } = setup({ quote: highQuote() })
        await settle()
        api.acknowledged.value = true
        quote.state = 'loading'
        await settle()
        quote.quoteId = 'ps_2'
        quote.state = 'ready'
        await settle()
        expect(api.acknowledged.value).toBe(false)
        expect(api.extraBlock.value === 'price-impact' || api.extraBlock.value === 'ats-loading').toBe(true)
    })

    it('olculemeyen etki (N/A) kilitlemez; uyari bayragi acik', async () => {
        const q = readyQuote()
        q.result.display.priceImpact = { pct: null, high: false, unmeasured: true }
        const { api } = setup({ quote: q })
        await settle()
        expect(api.priceImpactHigh.value).toBe(false)
        expect(api.priceImpactUnmeasured.value).toBe(true)
        expect(api.extraBlock.value).toBeNull()
    })

    it('etki dusukse kutu cikmaz', async () => {
        const { api } = setup()
        await settle()
        expect(api.priceImpactHigh.value).toBe(false)
    })
})

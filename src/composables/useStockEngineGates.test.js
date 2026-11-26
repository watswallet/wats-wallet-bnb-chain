// useStockEngineGates: bStocks Al/Sat ekraninin motor-bagimli kapilari (ATS ucreti + fiyat etkisi onayi).
// Vue bilesen testi yok (test-utils yok): composable bir effectScope icinde, chrome mesajlari sahte.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { useStockEngineGates } from './useStockEngineGates'
import { pancakeEngine } from '../utils/stocks/engines/pancakeEngine'
import { cowEngine } from '../utils/stocks/engines/cowEngine'
import { lcxEngine } from '../utils/stocks/engines/lcxEngine'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../test-utils/kaynakTarama'

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

    // UI-5: StockTrade.stockGate.ssr.test.js bu hook'u sahteyle (priceImpactHigh sabit false) surdugunden "kilitte fiyat etkisi
    // kutusu cikmaz" iddiasi orada bos geciyordu; gercek hook'ta kilit asil kosuldur (gated = ... quote.state === 'ready').
    it('teklif KILITLI (STOCK_GATE kilidi) iken etki yuksek olsa bile priceImpactHigh false, ek kapi YOK; ready olunca kutu gelir', async () => {
        const q = highQuote('ps_locked')
        q.state = 'locked'
        const { api } = setup({ quote: q })
        await settle()
        expect(api.priceImpactHigh.value).toBe(false)
        expect(api.priceImpactUnmeasured.value).toBe(false)
        expect(api.extraBlock.value).toBeNull()

        // pozitif es: ayni teklif 'ready' olunca kutu gelir (kilit kosulu gercekten belirleyici)
        q.state = 'ready'
        await settle()
        expect(api.priceImpactHigh.value).toBe(true)
        expect(api.extraBlock.value).not.toBeNull()
    })

    it('etki dusukse kutu cikmaz', async () => {
        const { api } = setup()
        await settle()
        expect(api.priceImpactHigh.value).toBe(false)
    })
})

// Gorev 8: ATS ucreti MOTOR ALANINA (usesAts) bakar, motor kimligine degil. usesAts true olan her motorda ATS ucret teklifi istenir ve
// atsQuoted ZORUNLUDUR (yoksa place ATS_BLOCKED der); false olan motorda hicbir sey istenmez.
const TSLAC = '0xb2000000000000000000001e800a7f5189430cD0'
const LCX_REQUEST = Object.freeze({
    side: 'buy',
    chainId: 8453,
    stockAddress: TSLAC,
    payToken: '0x0',
    inTokenAddress: '0x0',
    outTokenAddress: TSLAC,
    amount: '0.5',
    lcxKind: 'rwa',
    index: "m/44'/60'/0'/0/0",
    slippage: 0.5,
    lcxQuote: { kind: 'rwa', quoteId: 'q_abc', expiresAt: 1_800_000_120, rwa: { issuer: 'coinbase', marketOpen: true, refDeviationBps: -12, referenceUsd: 388.6, symbol: 'TSLAC', underlying: 'TSLA' } },
})
const lcxQuote = (over = {}) =>
    reactive({
        state: 'ready',
        quoteId: 'lc_1',
        result: { success: true, request: { ...LCX_REQUEST }, display: { priceImpact: null } },
        ...over,
    })
// Kimligi motor tablosunda OLMAYAN (ya da yanlis eslesen) sahte motorlar: karar yalniz `usesAts` alaninda.
const fakeEngine = (over = {}) => ({
    id: 'baska',
    usesAts: true,
    hasPriceImpactGate: false,
    atsPayload: (request) => ({ kind: 'swap', payload: { index: request.index, chainId: request.chainId, amount: request.amount } }),
    ...over,
})

describe('useStockEngineGates -- usesAts motor alani (Gorev 8)', () => {
    it('LCX: hazir teklifte ATS_SWAP_FEE_QUOTE motorun yukuyle (lcxQuote, side dahil) istenir; atsQuoted dolar, ek kapi yok', async () => {
        const { api } = setup({ engine: lcxEngine, quote: lcxQuote() })
        await settle()
        expect(sent).toHaveLength(1)
        expect(sent[0].type).toBe('ATS_SWAP_FEE_QUOTE')
        expect(sent[0].message).toEqual(lcxEngine.atsPayload({ ...LCX_REQUEST }).payload)
        expect(sent[0].message).toMatchObject({ lcxKind: 'rwa', side: 'buy' })
        expect(api.atsQuoted.value).toEqual({ transferFee: 1.5, commissionFee: 0.2 })
        expect(api.extraBlock.value).toBeNull()
        expect(api.atsBlocked.value).toBe(false)
        expect(api.priceImpactHigh.value).toBe(false) // LCX'te fiyat etkisi onayi yok (hasPriceImpactGate false)
    })

    it('LCX: ucret gelene kadar ats-loading ve atsQuoted null (place ATS_BLOCKED der)', async () => {
        let release
        reply = () => new Promise((r) => { release = () => r({ ...ATS_OK }) })
        const { api } = setup({ engine: lcxEngine, quote: lcxQuote() })
        await settle()
        expect(api.extraBlock.value).toBe('ats-loading')
        expect(api.atsQuoted.value).toBeNull()
        release()
        await settle()
        expect(api.extraBlock.value).toBeNull()
        expect(api.atsQuoted.value).not.toBeNull()
    })

    it('LCX: ucret istegi hata donerse ats-blocked (fail-closed), atsQuoted null', async () => {
        reply = async () => ({ success: false, error: 'x', code: 'whatever' })
        const { api } = setup({ engine: lcxEngine, quote: lcxQuote() })
        await settle()
        expect(api.extraBlock.value).toBe('ats-blocked')
        expect(api.atsQuoted.value).toBeNull()
    })

    it('LCX_REFUSED (use_rwa): islem ENGELLI kalir (ats-blocked) ama ATS engel karari YOK; kod ve lcxCode disari verilir', async () => {
        reply = async () => ({ success: false, error: 'use_rwa', code: 'LCX_REFUSED', lcxCode: 'use_rwa' })
        const { api } = setup({ engine: lcxEngine, quote: lcxQuote() })
        await settle()
        expect(api.extraBlock.value).toBe('ats-blocked')
        expect(api.atsBlocked.value).toBe(true)
        expect(api.atsQuoted.value).toBeNull()
        expect(api.ats.decision).toBeNull()
        expect(api.ats.errorCode).toBe('LCX_REFUSED')
        expect(api.ats.lcxCode).toBe('use_rwa')
    })

    it('LCX teklifi yoksa (atsPayload null) hicbir sey istenmez', async () => {
        const q = lcxQuote()
        q.result.request = { ...LCX_REQUEST, lcxQuote: undefined }
        setup({ engine: lcxEngine, quote: q })
        await settle()
        expect(sent).toHaveLength(0)
    })

    it('usesAts true olan HER motorda ATS istenir ve atsQuoted zorunlu (kimligi pancake DEGIL)', async () => {
        const { api } = setup({ engine: fakeEngine(), quote: readyQuote({ quoteId: 'x_1' }) })
        await settle()
        expect(sent).toHaveLength(1)
        expect(sent[0].type).toBe('ATS_SWAP_FEE_QUOTE')
        expect(api.atsQuoted.value).toEqual({ transferFee: 1.5, commissionFee: 0.2 })
        expect(api.extraBlock.value).toBeNull()
    })

    it('usesAts true + ucret alinamadi: ats-blocked ve atsQuoted null; hazir degil: ats-blocked', async () => {
        reply = async () => ({ success: false, error: 'x', code: 'whatever' })
        const { api } = setup({ engine: fakeEngine(), quote: readyQuote({ quoteId: 'x_1' }) })
        await settle()
        expect(api.extraBlock.value).toBe('ats-blocked')
        expect(api.atsQuoted.value).toBeNull()
        scope.stop()

        reply = async () => ({ ...ATS_OK, ready: false })
        const second = setup({ engine: fakeEngine(), quote: readyQuote({ quoteId: 'x_2' }) })
        await settle()
        expect(second.api.extraBlock.value).toBe('ats-blocked')
    })

    it('usesAts false olan motor kimligi pancake olsa bile ATS istemez (karar kimlikle degil alanla)', async () => {
        const { api } = setup({ engine: fakeEngine({ id: 'pancake', usesAts: false }), quote: readyQuote() })
        await settle()
        expect(sent).toHaveLength(0)
        expect(api.extraBlock.value).toBeNull()
        expect(api.atsQuoted.value).toBeNull()
    })

    it('usesAts alani yok / true degil ise (undefined, 1, "true", null) ATS istenmez', async () => {
        for (const usesAts of [undefined, 1, 'true', null]) {
            sent = []
            const { api } = setup({ engine: fakeEngine({ usesAts }), quote: readyQuote() })
            await settle()
            expect(sent, String(usesAts)).toHaveLength(0)
            expect(api.extraBlock.value, String(usesAts)).toBeNull()
            scope.stop()
        }
    })

    it('motor degisince (pancake -> LCX) eski motorun ucreti yeni motora SAYILMAZ; yeni yuk istenir', async () => {
        const engineRef = ref(pancakeEngine)
        const quote = readyQuote()
        let api
        scope = effectScope()
        scope.run(() => { api = useStockEngineGates({ engine: engineRef, quote, account: ref({ address: '0xAbCdEf0000000000000000000000000000000001' }) }) })
        await settle()
        expect(api.atsQuoted.value).not.toBeNull()
        expect(sent).toHaveLength(1)

        // ekran motor degisiminde teklifi once gecersiz kilar, sonra yenisini alir
        quote.state = 'idle'
        quote.result = null
        quote.quoteId = null
        engineRef.value = lcxEngine
        await settle()
        expect(api.atsQuoted.value).toBeNull()
        Object.assign(quote, { state: 'ready', quoteId: 'lc_1', result: { success: true, request: { ...LCX_REQUEST }, display: {} } })
        await settle()
        expect(sent).toHaveLength(2)
        expect(sent[1].message).toMatchObject({ chainId: 8453, lcxKind: 'rwa' })
        expect(api.atsQuoted.value).toEqual({ transferFee: 1.5, commissionFee: 0.2 })
    })
})

describe('useStockEngineGates -- kaynak taramasi (Gorev 8)', () => {
    it('motor kimligine (engine.id === ...) bakilmaz; usesAts alanina bakilir', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./useStockEngineGates.js', import.meta.url)), 'utf8'))
        expect(kaynak).not.toMatch(/\.id\s*[!=]==?\s*['"]/)
        expect(kaynak).not.toMatch(/['"](?:pancake|cow|lcx)['"]/)
        expect(kaynak).toMatch(/usesAts\s*===\s*true/)
    })
})

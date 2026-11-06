// Send.vue'nun "secili birimle tutar girisi" davranisi (Para birimi Bolum B, Gorev 9).
//
// Kaynak kilitleri (sendAmountWiring / sendDraftWiring) cagrilarin YERINDE oldugunu
// olcer; bu dosya GERCEK render ile sonucu olcer: etiket, karsi deger, taslak geri
// yukleme. Review Focus 4: baska birimle yazilmis fiat taslagi sessizce baska paraya
// donusmez. (Birim aniden degisince calisan watch SSR'da calismaz; o yol saf
// reconcileFiatMode testi + kaynak kilidiyle korunur.)
//
// 'vue' mock'u BURADA olmak ZORUNDA (bkz. src/test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bakiye ve gecmis (karsi taraf) aglari bu dosyanin konusu degil: ag cagrisi yapilmaz.
vi.mock('axios', () => ({ default: { post: async () => ({ status: 200, data: {} }), get: async () => ({ status: 200, data: {} }) } }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 1000 }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { currencyStore } from '../store/currency'
import { captureSendDraft } from '../utils/sendDraft'
import Send from './Send.vue'
import supported_chains from '../data/supported_chains.json'

const ETH = supported_chains.find((c) => c.chainId === 1)
const NOW = Date.now()

// Boslukli biciler nbsp (U+00A0) / dar nbsp (U+202F) kullanabilir.
const norm = (s) => String(s).replace(/[  ]/g, ' ')

afterEach(() => {
    delete globalThis.chrome
})

// 1 token = 2 USD; secili birim TRY, kur 40 -> birim fiyat 80 TRY.
async function mountSend({ code = 'try', rates = { try: 40 }, asset, draft } = {}) {
    installChromeStub({ active_account: { address: '0xAbCdEf0000000000000000000000000000000001' } })
    const pinia = createTestPinia()
    const store = currencyStore()
    store.code = code
    store.snapshot = { rates, currencies: [], updatedAt: NOW, stale: false, fetchedAt: NOW }

    networkStore().currentNetwork = ETH
    const crypto = cryptoStore()
    crypto.sendAsset = asset ?? {
        symbol: 'abc',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        decimals: 6,
        market: { priceUSD: 2 },
    }
    if (draft) {
        crypto.sendDraft = captureSendDraft({
            asset: crypto.sendAsset,
            chainId: ETH.chainId,
            to: '0x0000000000000000000000000000000000000002',
            tonComment: '',
            ...draft,
        })
    }

    const app = createApp(Send, { use: [pinia, createTestI18n('en')] })
    const holder = captureInstance(app, 'Send')
    const html = await render(app)
    return { html, state: holder.instance.setupState }
}

describe('Send.vue (SSR) -- secili birimle tutar girisi', () => {
    it('token modunda karsi deger secili birimde yazilir (5 token x 2 USD x 40 = 400 TRY)', async () => {
        const { state } = await mountSend({ draft: { amount: '5', mode: 'token', currency: 'try' } })

        expect(state.inputMode).toBe('token')
        expect(state.unitLabel).toBe('ABC')
        expect(norm(state.counterValue)).toBe('TRY 400.00')
    })

    it('fiat modu ayni birimde geri yuklenir: etiket TRY, 100 TRY = 1.25 token', async () => {
        const { state } = await mountSend({ draft: { amount: '100', mode: 'usd', currency: 'try' } })

        expect(state.inputMode).toBe('usd')
        expect(state.unitLabel).toBe('TRY')
        expect(state.rawInput).toBe('100')
        // 100 / (2 x 40) = 1.25: gonderilen miktar HER ZAMAN token cinsinden.
        expect(state.amount).toBe('1.25')
        expect(state.counterValue).toBe('1.25 ABC')
    })

    // Review Focus 4: taslak baska birimle yazildiysa "100" sessizce 100 EUR olmaz.
    it('fiat taslagi baska birimle gelirse token moduna doner ve alan bos kalir', async () => {
        const { state } = await mountSend({ draft: { amount: '100', mode: 'usd', currency: 'eur' } })

        expect(state.inputMode).toBe('token')
        expect(state.rawInput).toBe('')
        expect(state.amount).toBe('')
    })

    it('currency alani olmayan eski fiat taslagi da token + bos alan olur', async () => {
        const { state } = await mountSend({ draft: { amount: '100', mode: 'usd' } })

        expect(state.inputMode).toBe('token')
        expect(state.rawInput).toBe('')
    })

    it('token taslagi birim farki olsa da korunur (yazilan sayi zaten token miktari)', async () => {
        const { state } = await mountSend({ draft: { amount: '5', mode: 'token', currency: 'eur' } })

        expect(state.inputMode).toBe('token')
        expect(state.rawInput).toBe('5')
        expect(state.amount).toBe('5')
    })

    it('kur yoksa gorunum USD\'ye duser: etiket "USD", fiat girisi USD ile calisir', async () => {
        // Secili birim TRY ama tabloda kur yok -> ekran USD (fellBack).
        const { state } = await mountSend({
            code: 'try', rates: {}, draft: { amount: '100', mode: 'usd', currency: 'usd' },
        })

        expect(state.display.code).toBe('usd')
        expect(state.unitLabel).toBe('USD')
        expect(state.inputMode).toBe('usd')
        expect(state.amount).toBe('50')
    })

    it('birim dugmesi basligi birimden bagimsiz metni okur', async () => {
        const { html } = await mountSend({})

        expect(html).toContain('Switch between token and currency')
        expect(html).not.toMatch(/Switch between token and USD/)
    })

    it('fiyat bilinmiyorsa fiat girisi kapali ve karsi deger null (fiyat bilinmiyor gosterilir)', async () => {
        const { html, state } = await mountSend({
            asset: { symbol: 'abc', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
            draft: { amount: '100', mode: 'usd', currency: 'try' },
        })

        expect(state.hasPrice).toBe(false)
        // Fiat modu acilamaz; metin token miktari olarak okunmaz.
        expect(state.inputMode).toBe('token')
        expect(state.rawInput).toBe('')
        expect(state.counterValue).toBeNull()
        expect(html).toContain('Price unavailable')
    })
})

describe('Send.vue (SSR) -- tutar kutusu ondalik ayiraci', () => {
    // Kutu type="number" iken ondalik ayiraci TARAYICI diline baglidir: Ingilizce
    // Chrome + TRY kullanicisinda "100,50" DOM'da '' olurdu ve dugme sessizce kapanirdi.
    const type = (state, text) => {
        const target = { value: text }
        state.onAmountInput({ target })
        return target
    }

    it('kutu duz metin ve ondalik klavyeli (type=number DEGIL)', async () => {
        const { html } = await mountSend({})

        expect(html).toMatch(/<input[^>]*type="text"[^>]*inputmode="decimal"/)
        expect(html).not.toContain('type="number"')
    })

    it("TRY fiat modunda '100,50' yazilinca ham metin '100.50' olur ve miktar token'a cevrilir", async () => {
        const { state } = await mountSend({ draft: { amount: '', mode: 'usd', currency: 'try' } })
        expect(state.inputMode).toBe('usd')

        const target = type(state, '100,50')

        expect(state.rawInput).toBe('100.50')
        expect(target.value).toBe('100.50')
        // 100.50 / (2 x 40) = 1.25625: onizleme dugmesini acan miktar bos DEGIL.
        expect(state.amount).toBe('1.25625')
        expect(state.isValidAmount).toBe(true)
    })

    it("token modunda da '2,5' -> '2.5'", async () => {
        const { state } = await mountSend({})
        expect(state.inputMode).toBe('token')

        type(state, '2,5')

        expect(state.rawInput).toBe('2.5')
        expect(state.amount).toBe('2.5')
    })

    it('gecersiz karakter dusurulur: alan son gecerli degerde kalir ve kutuya geri yazilir', async () => {
        const { state } = await mountSend({})

        type(state, '12')
        const target = type(state, '12a')
        expect(state.rawInput).toBe('12')
        expect(target.value).toBe('12')

        type(state, '1,2')
        expect(type(state, '1,2,3').value).toBe('1.2')
        expect(state.rawInput).toBe('1.2')
        expect(type(state, '-5').value).toBe('1.2')
    })

    it("yazim sirasindaki '5,' ham metinde kalir ama gonderilecek miktar '5' olur", async () => {
        const { state } = await mountSend({})

        type(state, '5,')

        expect(state.rawInput).toBe('5.')
        expect(state.amount).toBe('5')
    })
})

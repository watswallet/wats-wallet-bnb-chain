// StockTrade.vue -- MAX/yuzde cipleri tam atom bakiyesinden, 'Bakiye yetersiz' karti gereken/mevcut/eksik.
// Iskelet StockTrade.ssr.test.js ile ayni (vue/useCowQuote/useTokenBalance mock'lari bu dosyada yazilmak ZORUNDA).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
import { __quote, __quoteCalls } from '../../composables/useCowQuote'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import { pageStore } from '../../store/pageStore'
import { ALL_CHAINS } from '../../data/chains'
import { XSTOCKS } from '../../data/xStocks'
import StockTrade from './StockTrade.vue'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const STOCK = XSTOCKS.find((s) => s.chains.includes(1))
const chain = (id) => ALL_CHAINS.find((c) => c.chainId === id)
const ADDR = '0xAbCdEf0000000000000000000000000000000001'
const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const dec = (s) => s.replace(/&#39;/g, "'")

const ATOM_18 = 188405789675366912n // 0.188405789675366912 (BSC USDC, 18 ondalik)
const bscStock = { id: 'x', chainId: 56, address: STOCK.address, decimals: STOCK.decimals, symbol: STOCK.symbol }

async function mount({ chainId = 1, selected = 'stock', state = {}, amount = '', side = 'buy', locale = 'en', balance } = {}) {
    installChromeStub({ active_account: { address: ADDR, key: 'acc1' } })
    const app = createApp(StockTrade)
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    networkStore().currentNetwork = chain(chainId)
    const crypto = cryptoStore()
    crypto.selected_token_ref = selected === 'stock'
        ? { id: 'x', chainId: 1, address: STOCK.address, decimals: STOCK.decimals, symbol: STOCK.symbol }
        : selected
    pageStore().currentPage = 'stock_trade'
    if (balance !== undefined) balanceMock.fn = async () => balance
    Object.assign(__quote, state)
    const holder = captureInstance(app, 'StockTrade', (inst) => {
        if (side !== 'buy') inst.setupState.side = side
        if (amount) inst.setupState.amount = amount
    })
    const html = clean(await render(app))
    return { html, holder, st: () => holder.instance.setupState }
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

const exactBal = (atoms, decimals, balance = Number(atoms) / 10 ** decimals) => ({ balance, atoms, decimals })

describe('StockTrade.vue -- MAX ve yuzde cipleri tam atom bakiyesinden', () => {
    it('bakiye okuma tam atom istenir ({ exact: true })', async () => {
        await mount({ chainId: 56, selected: bscStock, balance: exactBal(ATOM_18, 18) })
        expect(balanceMock.calls[0][4]).toEqual({ exact: true })
    })

    it('MAX: emir tutari TAM atom degeri, bakiyeyi asmaz (18 ondalikli BSC USDC)', async () => {
        const { st } = await mount({ chainId: 56, selected: bscStock, balance: exactBal(ATOM_18, 18) })
        st().setPercent(1)
        expect(st().amount).toBe('0.188405789675366912')
        expect(st().request.amount).toBe('0.188405789675366912')
    })

    it('MAX: giris alaninda ve Kullanilabilir satirinda gosterim asagi kirpilir (0.188405, 0.188406 DEGIL)', async () => {
        const { st } = await mount({ chainId: 56, selected: bscStock, balance: exactBal(ATOM_18, 18) })
        st().setPercent(1)
        expect(st().amountShown).toBe('0.188405')
        const r = await mount({ chainId: 56, selected: bscStock, balance: exactBal(ATOM_18, 18, 0.188406) })
        expect(text(r.html)).toContain('Available: 0.188405 USDC')
        expect(text(r.html)).not.toContain('0.188406')
    })

    it('girdi alani gosterimi: MAX sonrasi kirpilmis deger; elle yazinca yazilan deger', async () => {
        const { st } = await mount({ chainId: 56, selected: bscStock, balance: exactBal(ATOM_18, 18) })
        st().setPercent(1)
        expect(st().amountShown).toBe('0.188405')
        st().onAmountInput({ target: { value: '0.1' } })
        expect(st().amount).toBe('0.1')
        expect(st().amountShown).toBe('0.1')
    })

    it('yuzde cipleri asagi yuvarlar ve bakiyeyi asmaz', async () => {
        const { st } = await mount({ chainId: 56, selected: bscStock, balance: exactBal(ATOM_18, 18) })
        for (const p of [0.25, 0.5, 0.75, 1]) {
            st().setPercent(p)
            const atoms = BigInt(st().amount.replace('.', '').padEnd(19, '0')) // '0.' + 18 hane
            expect(atoms <= ATOM_18).toBe(true)
        }
        st().setPercent(0.25)
        expect(st().amount).toBe('0.047101447418841728')
    })

    it('Sat: hisse 18 ondalik, MAX tam atom', async () => {
        const hisse = 123456789012345678n
        const { st } = await mount({ side: 'sell', balance: exactBal(hisse, 18) })
        st().setPercent(1)
        expect(st().amount).toBe('0.123456789012345678')
        expect(st().amountShown).toBe('0.123456')
    })

    it('Number bakiye atomdan YUKARI yuvarlansa da MAX atomu kullanir', async () => {
        const { st } = await mount({ chainId: 56, selected: bscStock, balance: exactBal(ATOM_18, 18, 0.188406) })
        st().setPercent(1)
        expect(st().amount).toBe('0.188405789675366912')
    })

    it('atom bilinmiyorsa (okuma hatasi ya da eski bicim) cipler tutar YAZMAZ', async () => {
        const { st } = await mount({ chainId: 56, selected: bscStock, balance: 0.188405789675366912 })
        st().setPercent(1)
        expect(st().amount).toBe('')
    })

    it('cip dugmeleri: atom biliniyorsa aktif, bilinmiyorsa pasif', async () => {
        const chip = (html) => (html.match(/<button[^>]*>\s*MAX\s*<\/button>/) ?? [''])[0]
        const off = (tag) => / disabled(=|>| )/.test(tag.replace(/class="[^"]*"/, ''))
        const ok = await mount({ chainId: 56, selected: bscStock, balance: exactBal(ATOM_18, 18) })
        expect(chip(ok.html)).not.toBe('')
        expect(off(chip(ok.html))).toBe(false)
        const unknown = await mount({ chainId: 56, selected: bscStock, balance: 1000 })
        expect(off(chip(unknown.html))).toBe(true)
    })

    it('tam atomu 1 fazla tutar yetersiz kilidi verir (Number esit gorunse de)', async () => {
        const { st } = await mount({ chainId: 56, selected: bscStock, amount: '0.188405789675366913', balance: exactBal(ATOM_18, 18) })
        expect(st().blockReason).toBe('insufficient-balance')
    })
})

describe('StockTrade.vue -- Bakiye yetersiz karti', () => {
    const hata = (errorInfo) => ({ state: 'error', errorCode: 'INSUFFICIENT_BALANCE', errorInfo })
    const kartMetni = (html) => dec(text((html.match(/<[a-z]+[^>]*data-trade-insufficient[^>]*>[\s\S]*?<\/div>/) ?? [''])[0]))

    it('tr: USDC 6 ondalik, gereken / mevcut / eksik + dugme, Yeniden dene YOK', async () => {
        const { html } = await mount({ locale: 'tr', amount: '2.5', state: hata({ requiredAtoms: '2500000', availableAtoms: '1000000', decimals: 6 }) })
        expect(kartMetni(html)).toBe('Bakiye yetersiz: 2,5 USDC gerekiyor, cüzdanında 1 USDC var (1,5 USDC eksik). Tutarı bakiyeye eşitle')
        expect(html).toContain('data-trade-use-balance')
        expect(html).not.toContain('Yeniden dene')
    })

    it('en metni', async () => {
        const { html } = await mount({ amount: '2.5', state: hata({ requiredAtoms: '2500000', availableAtoms: '1000000', decimals: 6 }) })
        expect(kartMetni(html)).toBe('Insufficient balance: 2.5 USDC needed, your wallet has 1 USDC (1.5 USDC short). Use full balance')
    })

    it('USDC 18 ondalik (BSC): mevcut asagi, gereken ve eksik yukari', async () => {
        const { html } = await mount({ chainId: 56, selected: bscStock, locale: 'tr', amount: '0.2', state: hata({ requiredAtoms: '188405789675366913', availableAtoms: '188405789675366912', decimals: 18 }) })
        expect(kartMetni(html)).toContain('0,188406 USDC gerekiyor, cüzdanında 0,188405 USDC var (0,000001 USDC eksik)')
    })

    it('Sat: sembol HISSE, 18 ondalik', async () => {
        const { html } = await mount({ side: 'sell', locale: 'tr', amount: '3', state: hata({ requiredAtoms: String(3n * 10n ** 18n), availableAtoms: String(5n * 10n ** 17n), decimals: 18 }) })
        expect(kartMetni(html)).toContain(`3 ${STOCK.symbol} gerekiyor, cüzdanında 0,5 ${STOCK.symbol} var (2,5 ${STOCK.symbol} eksik)`)
    })

    it('mevcut 0: dugme yok (esitlenecek bakiye yok)', async () => {
        const { html } = await mount({ amount: '3', state: hata({ requiredAtoms: '3000000', availableAtoms: '0', decimals: 6 }) })
        expect(html).toContain('data-trade-insufficient')
        expect(html).not.toContain('data-trade-use-balance')
    })

    it('Tutari bakiyeye esitle: tutar tam kullanilabilir atom, gosterim kirpik', async () => {
        const { st } = await mount({ chainId: 56, selected: bscStock, amount: '0.5', state: hata({ requiredAtoms: '500000000000000000', availableAtoms: '188405789675366912', decimals: 18 }) })
        st().useFullBalance()
        expect(st().amount).toBe('0.188405789675366912')
        expect(st().amountShown).toBe('0.188405')
    })

    it('errorInfo yoksa ekranin kendi tam bakiyesi ve tutariyla kurulur', async () => {
        const { html } = await mount({ locale: 'tr', amount: '2.5', balance: exactBal(1_000_000n, 6), state: hata(null) })
        expect(kartMetni(html)).toContain('2,5 USDC gerekiyor, cüzdanında 1 USDC var (1,5 USDC eksik)')
    })

    it('hic sayi yoksa genel metin, Yeniden dene yok (anlamsiz)', async () => {
        const { html } = await mount({ locale: 'tr', amount: '2.5', state: hata(null) })
        expect(html).not.toContain('data-trade-insufficient')
        expect(html).toContain('Bakiye yetersiz')
        expect(html).not.toContain('Yeniden dene')
    })

    it('baska hatalarda Yeniden dene durur, bakiye karti yok', async () => {
        const { html } = await mount({ locale: 'tr', amount: '2.5', state: { state: 'error', errorCode: 'NETWORK' } })
        expect(html).toContain('Yeniden dene')
        expect(html).not.toContain('data-trade-insufficient')
    })
})

describe('StockTrade.vue -- kablolama', () => {
    it('girdi alani kirpilmis gosterimi (amountShown) baglar; emir tutari amount kalir', () => {
        const SRC = readFileSync(fileURLToPath(new URL('./StockTrade.vue', import.meta.url)), 'utf8')
        expect(SRC).toContain(':value="amountShown"')
        expect(SRC).toMatch(/amount: amount\.value,\s*referencePrice/)
    })
})

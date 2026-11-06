// Yakit hapindaki "ATS Al" (spec §6.4): satis aciksa satin alma ekranini acar ve MEXC kucuk bir
// "Borsadan al" satirinda kalir; satis kapaliyken BUGUNKU gibi MEXC'yi acar.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const satis = vi.hoisted(() => ({ acik: false }))
const acilis = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../composables/useAtsPurchase', () => ({
    useAtsPurchase: () => ({ live: satis.acik, open: acilis }),
}))

// ATS fiyati saplanir (panel acilinca istenen gercek fiyat sorgusu agsiz testte gelmez).
const FIYAT = vi.hoisted(() => ({ ats: 0.05 }))
vi.mock('../composables/useUsdPrice', async () => {
    const { ref } = await import('vue')
    return { useUsdPrice: () => ({ price: ref(FIYAT.ats), loadNative: async () => {}, loadById: async () => {} }) }
})

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { currencyStore } from '../store/currency'
import AtsFuelPill from './AtsFuelPill.vue'
import supported_chains from '../data/supported_chains.json'
import { ATS_BUY_URL } from '../utils/atsFuel'

const BSC = supported_chains.find((c) => c.chainId === 56)
const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
    satis.acik = false
    FIYAT.ats = 0.05
    acilis.mockClear()
})

async function ciz({ bakiye = '0', locale = 'en', hazirla, onBakiye } = {}) {
    const ADRES = '0xAbCdEf0000000000000000000000000000000001'
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    // `onBakiye`: bakiye yakit onbelleginden gelir (load() ilk cizimden ONCE okur); aksi halde bilesenin
    // zincir yuklemesi render'dan sonra biter ve panel '—' basar.
    const stub = installChromeStub(onBakiye === undefined ? {} : { ats_fuel_cache: { [ADRES.toLowerCase()]: { balance: onBakiye, at: Date.now() } } })
    stub.setSendMessage(async (m) => (m?.type === 'ATS_FUEL_BALANCE' ? { success: true, balance: onBakiye ?? bakiye, symbol: 'ATS' } : {}))
    const app = createApp(AtsFuelPill, { props: { address: ADRES } })
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    hazirla?.(currencyStore())
    networkStore().currentNetwork = BSC
    // Panel acik cizilsin: dugme panelin icinde.
    const holder = captureInstance(app, 'AtsFuelPill', (instance) => { instance.setupState.open = true })
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState }
}

describe('AtsFuelPill (SSR) -- ATS Al', () => {
    it('satis KAPALI: dugme bugunku gibi MEXC yi acar, "Borsadan al" satiri YOK', async () => {
        const { html, state } = await ciz()
        expect(html).toContain('Get ATS')
        expect(html).not.toContain('Buy on exchange')
        const acilan = vi.fn()
        vi.stubGlobal('window', { open: acilan })
        await state.buyAts()
        expect(acilan).toHaveBeenCalledWith(ATS_BUY_URL, '_blank')
        expect(acilis).not.toHaveBeenCalled()
        expect(state.open).toBe(false)
    })

    it('satis ACIK: "ATS Al" satin alma ekranini acar; "Borsadan al" satiri YOK', async () => {
        satis.acik = true
        const { html, state } = await ciz()
        expect(html).toContain('Get ATS')
        expect(html).not.toContain('Buy on exchange')
        const acilan = vi.fn()
        vi.stubGlobal('window', { open: acilan })
        await state.buyAts()
        expect(acilis).toHaveBeenCalledTimes(1)
        expect(acilan).not.toHaveBeenCalled()
        expect(state.open).toBe(false)
    })
})

// PARA BIRIMI (Plan B Gorev 11): bakiyenin karsiligi SECILI BIRIMDE ("≈ $5.00", "≈ ₺200,00", kur yokken "≈ USD 5.00").
describe('AtsFuelPill (SSR) -- bakiye karsiligi secili birimde', () => {
    const tazeKur = (rates) => {
        const now = Date.now()
        return { rates, currencies: [], updatedAt: now, stale: false, fetchedAt: now }
    }
    const norm = (s) => s.replace(/[\u00a0\u202f]/g, ' ')
    // "≈ " ile baslayan tek span'in metni; satir yoksa null.
    const karsilik = (html) => {
        const m = html.match(/<span[^>]*>≈ ([^<]*)<\/span>/)
        return m ? norm(m[1].trim()) : null
    }

    it('varsayilan USD: 100 ATS x 0.05 = "≈ $5.00"', async () => {
        expect(karsilik((await ciz({ onBakiye: '100' })).html)).toBe('$5.00')
    })

    it('try / kur 40 / tr dili: "≈ ₺200,00" ("$" yok)', async () => {
        const { html } = await ciz({
            onBakiye: '100', locale: 'tr',
            hazirla: (store) => { store.code = 'try'; store.snapshot = tazeKur({ try: 40 }) },
        })
        expect(karsilik(html)).toBe('₺200,00')
        expect(html).not.toContain('≈ $')
    })

    it('kur yok (secili try, tablo yok): "≈ USD 5.00" kod etiketli, "₺" asla', async () => {
        const { html } = await ciz({ onBakiye: '100', hazirla: (store) => { store.code = 'try'; store.snapshot = null } })
        expect(karsilik(html)).toBe('USD 5.00')
        expect(html).not.toContain('₺')
    })

    it('fiyat YOK: karsilik satiri hic cizilmez ("≈ $0.00" yok)', async () => {
        FIYAT.ats = null
        const { html } = await ciz({ onBakiye: '100' })
        // Pozitif kontrol: bakiye panelde var, yalniz karsilik satiri yok.
        expect(html).toContain('>100</span>')
        expect(karsilik(html)).toBeNull()
        expect(html).not.toMatch(/≈ \$?0\.00/)
    })
})

// Takas ve kopru token secicilerinin (swapFrom, swapTo, bridgeFrom, bridgeTo) satir degerleri ile Bridge.vue
// "Toplam Ucret" satiri (Plan B Gorev 10): tutar secili birimde yazilir; elle `${{ ...toFixed(2) }}` kalibi kalmaz.
//
// Satir degeri = bakiye x token.market.priceUSD (standart tutar). Fiyati olmayan tokenin deger satiri HIC cizilmez
// (v-if korunur). Kopru listelerinde 0.01 altindaki tutar "<$0.01" yazilir (eski yerel formatPrice "$< 0.01" basardi).
// Kalip swapFrom.atsSale.ssr.test.js / TokenMoney.ssr.test.js ile AYNI (gercek SSR render).
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosPost = vi.fn()
const axiosGet = vi.fn()
vi.mock('axios', () => ({ default: { post: (...a) => axiosPost(...a), get: (...a) => axiosGet(...a) } }))

// Bakiye adrese gore (kucuk harf) tablodan okunur.
const BAKIYE = vi.hoisted(() => ({}))
vi.mock('../../composables/useTokenBalance', () => ({
    useTokenBalance: async (_w, adres) => BAKIYE[String(adres).toLowerCase()] ?? 0,
}))

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { yorumsuzHtml } from '../../test-utils/ssrHtmlYardimcilari.js'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import { pageStore } from '../../store/pageStore'
import { currencyStore } from '../../store/currency'
import SwapFrom from './swapFrom.vue'
import SwapTo from './swapTo.vue'
import BridgeFrom from '../bridge/bridgeFrom.vue'
import BridgeTo from '../bridge/bridgeTo.vue'
import Bridge from '../Bridge.vue'
import supported_chains from '../../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const HESAP = '0xAbCdEf0000000000000000000000000000000001'
const img = { thumb: 't', small: 's', large: 'l' }
const TIRE = '—'

// Bosluklu biciler dilde nbsp (U+00A0) / dar nbsp (U+202F) kullanir: duz bosluga indirilip karsilastirilir.
// SSR cikti "<" isaretini `&lt;` yazar ("<$0.01"): metin hali karsilastirilir.
const norm = (s) => (typeof s === 'string' ? s.replace(/[  ]/g, ' ').replace(/&lt;/g, '<') : s)

// Adresler 0x + 40 hane; fiyati kimlikten (coingecko_id) gelir.
const ADRES = {
    FIYATLI: '0x1111111111111111111111111111111111111111',
    FIYATSIZ: '0x2222222222222222222222222222222222222222',
    TOZ: '0x3333333333333333333333333333333333333333',
}
const KAYITLAR = () => [
    { name: 'Priced Token', symbol: 'PRC', address: ADRES.FIYATLI, decimals: 18, coingecko_id: 'priced', image: img },
    { name: 'Unpriced Token', symbol: 'NOP', address: ADRES.FIYATSIZ, decimals: 18, coingecko_id: 'unpriced', image: img },
    { name: 'Dust Token', symbol: 'DST', address: ADRES.TOZ, decimals: 18, coingecko_id: 'dust', image: img },
]
// 'unpriced' sunucu cevabinda YOKTUR (kayitsiz token): deger satiri cizilmemeli.
const FIYAT = { priced: 1.25, dust: 0.002 }

const tazeKur = (rates) => {
    const now = Date.now()
    return { rates, currencies: [], updatedAt: now, stale: false, fetchedAt: now }
}

afterEach(() => {
    delete globalThis.chrome
    axiosPost.mockReset()
    axiosGet.mockReset()
    for (const k of Object.keys(BAKIYE)) delete BAKIYE[k]
})

// Ortak kurulum: BSC aktif, hesapta uc ice aktarilmis token, bakiye 2 / 3 / 2, sunucu fiyat cevabi.
// `hazirla(store)`: secili birim (currencyStore). `locale`: uygulama dili.
function kur(Component, { hazirla, locale = 'en' } = {}) {
    BAKIYE[ADRES.FIYATLI] = 2
    BAKIYE[ADRES.FIYATSIZ] = 3
    BAKIYE[ADRES.TOZ] = 2 // 2 x 0.002 = 0.004

    installChromeStub({
        currentNetwork: BSC,
        active_account: { address: HESAP, key: 'acc1' },
        imported_tokens: { acc1: { 56: KAYITLAR() } },
    })
    axiosPost.mockImplementation(async (url, body) => {
        if (url.endsWith('/getChainTokens')) return { status: 200, data: { success: true, tokens: [] } }
        if (url.endsWith('/getTokensDataById')) {
            return {
                status: 200,
                data: {
                    success: true,
                    tokens: (body.ids || []).filter((id) => id in FIYAT).map((id) => ({ coingecko_id: id, market_data: { priceUSD: FIYAT[id] } })),
                },
            }
        }
        throw new Error('beklenmeyen url ' + url)
    })
    // li.quest: kopru listeleri bos zincir cevabi alir (yalniz ice aktarilanlar gorunur).
    axiosGet.mockResolvedValue({ status: 200, data: { tokens: {} } })

    const app = createApp(Component)
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    const network = networkStore()
    network.currentNetwork = BSC
    network.rpc = BSC.rpc[0].url
    cryptoStore().bridge.toChain = BSC
    hazirla?.(currencyStore())
    // NOT: bakiye bilesen ornegine ENJEKTE EDILMEZ. Eskiden bridgeFrom yukleyicisi bakiyeyi ham adrese
    // yazdigi icin burada dogru anahtarla enjekte ediliyordu ve bu, hatayi (Kopru kaynak listesinde her
    // satir "0.00") testten gizliyordu. Artik her liste bakiyesini KENDI yukleyicisinden alir.
    return app
}

// Satirin sag sutunundaki ikinci hucre (deger satiri). Satir yoksa 'SATIR_YOK', deger satiri cizilmediyse null.
const degerMetni = (html, sembol) => {
    const satir = yorumsuzHtml(html).split('<button').find((parca) => parca.includes('>' + sembol + '</p>'))
    if (!satir) return 'SATIR_YOK'
    const m = satir.match(/pl-2"?[^>]*><p class="[^"]*"[^>]*>[^<]*<\/p><p class="[^"]*"[^>]*>\s*([^<]*?)\s*<\/p>/)
        || satir.match(/items-end"?[^>]*><p class="[^"]*"[^>]*>[^<]*<\/p><p class="[^"]*"[^>]*>\s*([^<]*?)\s*<\/p>/)
    return m ? norm(m[1]) : null
}

const LISTELER = [
    ['swapFrom', SwapFrom],
    ['swapTo', SwapTo],
    ['bridgeFrom', BridgeFrom],
    ['bridgeTo', BridgeTo],
]

describe.each(LISTELER)('%s: satir degeri secili birimde', (_ad, Component) => {
    it('varsayilan USD: bakiye 2 x fiyat 1.25 -> $2.50', async () => {
        const html = await render(kur(Component))
        expect(degerMetni(html, 'PRC')).toBe('$2.50')
    })

    it('try / kur 40 / tr dili: ayni satir TL (2 x 1.25 x 40 = 100)', async () => {
        const html = await render(kur(Component, {
            locale: 'tr',
            hazirla: (store) => { store.code = 'try'; store.snapshot = tazeKur({ try: 40 }) },
        }))
        expect(degerMetni(html, 'PRC')).toBe('₺100,00')
    })

    it('kur yok: USD etiketli yazilir, "₺" asla (eski/yanlis kurla basilmaz)', async () => {
        const html = await render(kur(Component, {
            locale: 'tr',
            hazirla: (store) => { store.code = 'try'; store.snapshot = null },
        }))
        const metin = degerMetni(html, 'PRC')
        expect(metin).toMatch(/USD/)
        expect(metin).not.toContain('₺')
        expect(metin).toContain('2,50')
    })

    it('fiyatsiz tokenda deger satiri HIC cizilmez (satirin kendisi var)', async () => {
        const html = await render(kur(Component))
        expect(degerMetni(html, 'NOP')).toBeNull()
    })

    it('hicbir deger satirinda "NaN" ya da "undefined" yazmaz', async () => {
        const html = await render(kur(Component))
        for (const sembol of ['PRC', 'NOP', 'DST']) {
            expect(degerMetni(html, sembol) ?? '', sembol).not.toMatch(/NaN|undefined/)
        }
    })
})

describe.each([
    ['bridgeFrom', BridgeFrom],
    ['bridgeTo', BridgeTo],
])('%s: toz tutar', (_ad, Component) => {
    it('2 x 0.002 = 0.004 -> "<$0.01" ("$< 0.01" degil)', async () => {
        const html = await render(kur(Component))
        expect(degerMetni(html, 'DST')).toBe('<$0.01')
    })
})

describe.each([
    ['swapFrom', SwapFrom],
    ['swapTo', SwapTo],
])('%s: toz tutar', (_ad, Component) => {
    it('2 x 0.002 = 0.004 -> "<$0.01" ("$0.00" degil: sifir olmayan deger sifir gorunmez)', async () => {
        const html = await render(kur(Component))
        expect(degerMetni(html, 'DST')).toBe('<$0.01')
    })
})

// Satirin sag sutunundaki ILK hucre (bakiye metni). Satir yoksa 'SATIR_YOK'.
const bakiyeMetni = (html, sembol) => {
    const satir = yorumsuzHtml(html).split('<button').find((parca) => parca.includes('>' + sembol + '</p>'))
    if (!satir) return 'SATIR_YOK'
    const m = satir.match(/items-end"?[^>]*><p class="[^"]*"[^>]*>\s*([^<]*?)\s*<\/p>/)
    return m ? m[1] : null
}

// Kopru kaynak listesi: yukleyici bakiyeyi satirin OKUDUGU anahtara (balanceKey(zincir, adres)) yazar.
// Eskiden ham adrese yaziliyordu ve her satir "0.00" gosteriyordu; bu test bakiyeyi bilesen ornegine
// ENJEKTE ETMEZ, yalniz gercek yukleyiciden gelen degeri olcer.
describe('bridgeFrom: bakiye yukleyicisi ile satir okuyucusu ayni anahtari kullanir', () => {
    it('bakiyesi olan tokenler gercek bakiyesini yazar ("0.00" degil)', async () => {
        const html = await render(kur(BridgeFrom))
        expect(bakiyeMetni(html, 'PRC')).toBe('2.000000')
        expect(bakiyeMetni(html, 'NOP')).toBe('3.000000')
        expect(bakiyeMetni(html, 'DST')).toBe('2.000000')
    })

    it('bakiyesi olmayan token "0.00" yazar, digerleri etkilenmez', async () => {
        const app = kur(BridgeFrom)
        delete BAKIYE[ADRES.FIYATSIZ] // kur() uc tokene bakiye verir; yukleyici render sirasinda okur
        const html = await render(app)
        expect(bakiyeMetni(html, 'NOP')).toBe('0.00')
        expect(bakiyeMetni(html, 'PRC')).toBe('2.000000')
    })
})

describe('Bridge.vue: Toplam Ucret satiri', () => {
    // Sonuc karti `bridgeData` varken cizilir: BridgeAtsBuy.ssr.test.js ile ayni yakalama.
    async function ciz({ totalCost, hazirla, locale = 'en' } = {}) {
        installChromeStub({
            currentNetwork: BSC,
            active_account: { address: HESAP, key: 'acc1' },
        })
        axiosGet.mockResolvedValue({ status: 200, data: { tokens: {} } })
        // ATS fiyat okumasi (useUsdPrice) bos ama gecerli cevap alir: konsola "Fiyat okunamadi" yazilmaz.
        axiosPost.mockResolvedValue({ status: 200, data: { success: true, tokens: [] } })
        const app = createApp(Bridge)
        app.use(createTestPinia())
        app.use(createTestI18n(locale))
        networkStore().currentNetwork = BSC
        pageStore().currentPage = 'bridge'
        hazirla?.(currencyStore())
        captureInstance(app, 'Bridge', (instance) => {
            instance.setupState.bridgeData = {
                estimate: { toAmount: '5000000000000000000', executionDuration: 30, feeCosts: [], gasCosts: [] },
                action: { fromChainId: 56, toChainId: 56, fromToken: { decimals: 18 }, toToken: { decimals: 18 }, fromAmount: '5000000000000000000' },
                transactionRequest: { to: '0x1111111111111111111111111111111111111111', data: '0x', value: '0' },
            }
            instance.setupState.totalCost = totalCost
        })
        return yorumsuzHtml(await render(app))
    }

    // "Total Cost" etiketinden hemen sonraki deger hucresi.
    const toplamMetni = (html) => {
        const m = html.match(/Total Cost<\/span>\s*<span[^>]*>\s*([^<]*?)\s*<\/span>/)
            || html.match(/Toplam Ücret<\/span>\s*<span[^>]*>\s*([^<]*?)\s*<\/span>/)
        return m ? norm(m[1]) : null
    }

    it('12.5 -> $12.50', async () => {
        expect(toplamMetni(await ciz({ totalCost: 12.5 }))).toBe('$12.50')
    })

    it('try / kur 40 / tr dili: 12.5 -> ₺500,00', async () => {
        const html = await ciz({
            totalCost: 12.5,
            locale: 'tr',
            hazirla: (store) => { store.code = 'try'; store.snapshot = tazeKur({ try: 40 }) },
        })
        expect(toplamMetni(html)).toBe('₺500,00')
    })

    it('toplam 0.004 -> "<$0.01" (sifira yuvarlanmaz)', async () => {
        expect(toplamMetni(await ciz({ totalCost: 0.004 }))).toBe('<$0.01')
    })

    it('toplam bilinmiyorsa (NaN) "NaN" ya da bos yazilmaz, tire yazilir', async () => {
        const html = await ciz({ totalCost: Number.NaN })
        expect(toplamMetni(html)).toBe(TIRE)
        expect(html).not.toContain('NaN')
    })
})

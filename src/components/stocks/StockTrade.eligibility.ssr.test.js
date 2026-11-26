// StockTrade.vue (SSR) -- Al'da yalniz uygun ihracci, Sat'ta hepsi; Al sunulamiyorsa Sat'a dusus; giris uzlastirmasi
// (reconcileBuyEntry / pickBuyRow) (Ilk Alim Kapisi, Task 45; K34, K35, K29; spec 6.8; PE21).
//
// KOK NEDEN: ortak Al/Sat ekraninda uygun olmayan ihracci Al'da secili kalirsa kullanici bant + kilit gorur, oysa ayni zincirde
// uygun bir kardes (xStocks) varken ona gecmek gerekir; tutulan uygun olmayan hisse ise Sat'ta KAYBOLMAMALI. Bu dosyanin
// kapattigi hata siniflari:
//  (1) Al'da uygun olmayan ihracci secenek olarak sunulur, Sat'ta ise elenir (K34, K35);
//  (2) StockDetail Al'i DOGRUDAN side='buy' ile acar: giris uzlastirmasi yoksa secili satir uygun olmayan bStocks'ta takilir;
//  (3) Al sunulamiyorsa ekran olu uc olur (Al sekmesi yok ama side hala 'buy');
//  (4) uzlastirma her ready / buyOffered degisiminde tekrarlanir: ulke ekran acikken degisince kullanici ekrandan atilir;
//  (5) yukleme sirasinda Al sekmesi ETKIN cizilir (flas) ya da DOM'dan kalkar (kayma);
//  (6) 'stock' computed'una uygunluk girer: Sat ekrani "mevcut degil" olur.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
// SSR'da watch calismaz: ref kaynakli watch geri cagrilari yakalanir ve onMounted SONRASI test tarafindan cagrilir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const modu = vi.hoisted(() => ({ afterMount: null, cbs: [] }))
vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        // afterMount: StockTrade'in onMounted'i BITTIKTEN sonra, render'dan ONCE bir kez calisir (ulke "ekran acikken" degisir).
        onMounted: (fn) => actual.onServerPrefetch(async () => {
            await fn()
            const sonra = modu.afterMount
            modu.afterMount = null
            sonra?.()
        }),
        watch: (source, cb, options) => {
            if (cb && actual.isRef(source) && actual.getCurrentInstance()?.type?.__name === 'StockTrade') modu.cbs.push({ source, cb })
            return actual.watch(source, cb, options)
        },
    }
})

vi.mock('../../utils/featureFlags', async (importOriginal) => ({ ...(await importOriginal()), XSTOCKS_ENABLED: true }))

// Uygunluk senaryosu surulur; GERCEK useStockGate bu sahteyle calisir (kapi aynasi ayni kaynaktan beslenir, K29).
vi.mock('../../composables/useStockEligibility', async (importOriginal) =>
    (await import('../../test-utils/useStockEligibilityMock.js')).createUseStockEligibilityMock(await importOriginal()))

vi.mock('../../composables/useCowQuote', async () => {
    const { reactive } = await import('vue')
    const __quote = reactive({
        state: 'idle', result: null, quoteId: null, expiresAt: null, errorCode: null, errorInfo: null, lockReason: null,
        refresh: vi.fn(), invalidate: vi.fn(),
    })
    const __quoteCalls = []
    return { useCowQuote: (opts) => { __quoteCalls.push(opts); return __quote }, __quote, __quoteCalls }
})

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

vi.mock('../../composables/useTokenBalance', () => ({ useTokenBalance: async () => ({ balance: 1000, atoms: 1000n * 10n ** 18n, decimals: 18 }) }))
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
const agDegisimi = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../../utils/applyNetworkChange', () => ({ applyNetworkChange: (...a) => agDegisimi(...a) }))
vi.mock('../../utils/stocks/marketStatus', () => ({ fetchMarketStatus: async () => null }))

import { createApp, render, installChromeStub, createTestPinia, createTestI18n, captureInstance } from '../../test-utils/ssrRender.js'
import { yorumsuz, blokGovdesi } from '../../test-utils/kaynakTarama.js'
import {
    resetEligibilityMock, eligibilityMock, ELIGIBILITY_ALL, ELIGIBILITY_XSTOCKS_ONLY, ELIGIBILITY_NONE, ELIGIBILITY_LOADING,
} from '../../test-utils/useStockEligibilityMock.js'
import { __quote } from '../../composables/useCowQuote'
import { refOfRow } from '../../composables/useIssuerSwitch'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import { pageStore } from '../../store/pageStore'
import { ALL_CHAINS } from '../../data/chains'
import { companyRows } from '../../utils/stocks/stockCompanies'
import { defaultPayToken } from '../../utils/stockTrade'
import en from '../../i18n/locales/en.json'
import StockTrade from './StockTrade.vue'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADDR = '0xAbCdEf0000000000000000000000000000000001'
const TSLA = companyRows('TSLA', { xstocksEnabled: true })
const TSLA_B = TSLA.find((r) => r.issuer === 'bstocks') // BSC 56
const TSLA_X_BSC = TSLA.find((r) => r.issuer === 'xstocks' && r.chainId === 56)
const TSLA_X_ETH = TSLA.find((r) => r.issuer === 'xstocks' && r.chainId === 1)
// Ayni zincirde xStocks kardesi OLMAYAN bStocks (AAPL xStocks yalniz Ethereum'da).
const AAPL_B = companyRows('AAPL', { xstocksEnabled: true }).find((r) => r.issuer === 'bstocks')

const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const tabTag = (html, tab) => (html.match(new RegExp(`<button[^>]*data-trade-tab="${tab}"[^>]*>`)) ?? [''])[0]
const isDisabled = (tag) => / disabled(=|>| )/.test(tag.replace(/class="[^"]*"/, ''))
const tabsTag = (html) => (html.match(/<div[^>]*data-trade-tabs[^>]*>/) ?? [''])[0]
const issuerOptionsIn = (html) => [...html.matchAll(/data-issuer-option="(\w+)"/g)].map((m) => m[1])

function build(row, { side = null, setup } = {}) {
    installChromeStub({ active_account: { address: ADDR, type: 'imported', key: 'acc1' } })
    const app = createApp(StockTrade)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = ALL_CHAINS.find((c) => c.chainId === row.chainId)
    cryptoStore().selected_token_ref = refOfRow(row)
    pageStore().currentPage = 'stock_trade'
    pageStore().tradeSide = side
    const holder = captureInstance(app, 'StockTrade', (inst) => { setup?.(inst.setupState) })
    return { app, holder }
}
async function mount(row, opts) {
    const { app, holder } = build(row, opts)
    const html = clean(await render(app))
    return { html, st: () => holder.instance.setupState }
}
// Gercek tarayicida `watch(ready)` bunu kendisi yapar; SSR'da yakalanan geri cagrilar burada elle surulur.
const izleyicileriSur = (yeni, eski) => { for (const { cb } of modu.cbs) cb(yeni, eski) }

beforeEach(() => {
    resetEligibilityMock(ELIGIBILITY_ALL)
    modu.afterMount = null
    modu.cbs.length = 0
    agDegisimi.mockClear()
    Object.assign(__quote, { state: 'idle', result: null, quoteId: null, expiresAt: null, errorCode: null, errorInfo: null, lockReason: null })
    __quote.refresh.mockClear()
    __quote.invalidate.mockClear()
})
afterEach(() => { delete globalThis.chrome })

describe('StockTrade eligibility ssr: ihracci secici (K34, K35)', () => {
    it('pozitif bekci: katalog satirlari gercek, AAPL bStocks ayni zincirde tek satir', () => {
        expect(TSLA_B && TSLA_X_BSC && TSLA_X_ETH && AAPL_B).toBeTruthy()
        expect(AAPL_B.chainId).toBe(56)
        expect(companyRows('AAPL', { xstocksEnabled: true }).some((r) => r.issuer === 'xstocks' && r.chainId === 56)).toBe(false)
    })

    it("StockTrade: Al'da ihracci secici yalniz uygun ihraccilari sunar; Sat'ta ikisini de", async () => {
        // Hepsi uygun: Al'da da Sat'ta da iki secenek (kontrol).
        const tum = await mount(TSLA_B, { side: 'buy' })
        expect(issuerOptionsIn(tum.html)).toEqual(['bstocks', 'xstocks'])
        // bStocks uygun degil + xStocks uygun: Sat'ta ikisi, Al'da yalniz xStocks.
        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        const sat = await mount(TSLA_B, { side: 'sell' })
        expect(sat.st().side).toBe('sell')
        expect(issuerOptionsIn(sat.html)).toEqual(['bstocks', 'xstocks'])
        expect(sat.st().issuerSwitch.options.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks'])
        const al = await mount(TSLA_B, { side: 'buy' })
        expect(al.st().side).toBe('buy')
        expect(al.st().issuerSwitch.options.map((o) => o.issuer)).toEqual(['xstocks'])
    })

    it('StockTrade: tek uygun ihracci kalinca secici ve "Fark ne" baglantisi DOM\'da yok', async () => {
        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        const { html, st } = await mount(TSLA_B, { side: 'buy' })
        expect(st().issuerSwitch.options).toHaveLength(1)
        expect(html).not.toContain('data-issuer-switch')
        expect(html).not.toContain('data-issuer-diff-link')
        // kontrol: iki secenek varken ikisi de DOM'da
        resetEligibilityMock(ELIGIBILITY_ALL)
        const iki = await mount(TSLA_B, { side: 'buy' })
        expect(iki.html).toContain('data-issuer-switch')
        expect(iki.html).toContain('data-issuer-diff-link')
    })
})

describe('StockTrade eligibility ssr: Al sunulamiyorsa Sat, sekmeler (K34, PE21)', () => {
    it("StockTrade: mount'ta side=buy, store ready, Al sunulamiyor -> side sell, Sat sekmesi etkin, Al sekmesi DOM'da yok ve sekme cubugu tek sutun", async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        const { html, st } = await mount(TSLA_B, { side: 'buy' })
        expect(st().side).toBe('sell')
        expect(html).not.toContain('data-trade-tab="buy"')
        const sat = tabTag(html, 'sell')
        expect(sat).not.toBe('')
        expect(isDisabled(sat)).toBe(false)
        expect(sat).toContain('shadow-sm') // secili (etkin) sekme gorunumu
        expect(tabsTag(html)).toContain('grid-cols-1')
        expect(tabsTag(html)).not.toContain('grid-cols-2')
        // secili satir DEGISMEZ (kardes yok; Sat'ta hisse okunabilir kalir)
        expect(cryptoStore().selected_token_ref).toEqual(refOfRow(TSLA_B))
        expect(html).not.toContain(en.stockTrade.unavailable)
    })

    it('StockTrade: store mount\'tan SONRA ready olur (loading -> ready) -> ayni sonuc (izleme, yalniz mount degil)', async () => {
        resetEligibilityMock(ELIGIBILITY_LOADING)
        modu.afterMount = () => {
            // mount'ta store hazir DEGILDI: uzlastirma henuz calismadi
            expect(modu.cbs.length).toBeGreaterThan(0)
            eligibilityMock.scenario = ELIGIBILITY_NONE
            izleyicileriSur(true, false)
        }
        const { html, st } = await mount(TSLA_B, { side: 'buy' })
        expect(st().side).toBe('sell')
        expect(st().showBuyTab).toBe(false)
        expect(html).not.toContain('data-trade-tab="buy"')
        expect(tabsTag(html)).toContain('grid-cols-1')
    })

    it('StockTrade: yukleniyor -> Al sekmesi AYNI YERDE pasif (DOM\'da var, disabled), teklif gitmez; ready + uygun sonrasi etkin; ready + uygun degil sonrasi kalkar', async () => {
        resetEligibilityMock(ELIGIBILITY_LOADING)
        const yukleniyor = await mount(TSLA_B, { side: 'buy' })
        const al = tabTag(yukleniyor.html, 'buy')
        expect(al).not.toBe('')
        expect(isDisabled(al)).toBe(true) // flas: uygun olmayan ihracci yukleme sirasinda bir an bile ETKIN cizilmez
        // ayni yerde: sekme cubugunda Sat'tan ONCE
        expect(yukleniyor.html.indexOf('data-trade-tab="buy"')).toBeLessThan(yukleniyor.html.indexOf('data-trade-tab="sell"'))
        expect(tabsTag(yukleniyor.html)).toContain('grid-cols-2')
        expect(yukleniyor.st().side).toBe('buy') // uzlastirma yalniz ready olunca
        expect(yukleniyor.st().quoteEnabled).toBe(false) // teklif gitmez (kapi kontrol ediyor)
        expect(cryptoStore().selected_token_ref).toEqual(refOfRow(TSLA_B))

        resetEligibilityMock(ELIGIBILITY_ALL)
        const hazir = await mount(TSLA_B, { side: 'buy' })
        expect(isDisabled(tabTag(hazir.html, 'buy'))).toBe(false)
        expect(hazir.html.indexOf('data-trade-tab="buy"')).toBeLessThan(hazir.html.indexOf('data-trade-tab="sell"'))

        resetEligibilityMock(ELIGIBILITY_NONE)
        const yok = await mount(TSLA_B, { side: 'buy' })
        expect(yok.html).not.toContain('data-trade-tab="buy"')
    })

    it('StockTrade: Sat sekmesi HER ZAMAN (yukleniyor, hepsi uygun, hicbiri uygun degil) ve etkin', async () => {
        for (const senaryo of [ELIGIBILITY_LOADING, ELIGIBILITY_ALL, ELIGIBILITY_XSTOCKS_ONLY, ELIGIBILITY_NONE]) {
            resetEligibilityMock(senaryo)
            const { html } = await mount(TSLA_B, { side: 'buy' })
            expect(tabTag(html, 'sell'), String(senaryo.ready)).not.toBe('')
            expect(isDisabled(tabTag(html, 'sell'))).toBe(false)
        }
    })

    it('StockTrade: useStockEligibility abonesi ekranda TEK (kapi aynasi useStockGate ayni kaynagi kullanir)', async () => {
        await mount(TSLA_B, { side: 'buy' })
        const dogrudan = eligibilityMock.options.filter((o) => !('enabled' in o))
        expect(dogrudan).toHaveLength(1)
    })
})

describe('StockTrade eligibility ssr: giris uzlastirmasi pickBuyRow (PE21)', () => {
    it("StockTrade: StockDetail'den DOGRUDAN Al (tradeSide 'buy') ile uygun olmayan bStocks satiri secili acilir + uygun xStocks kardes var -> ilk ready'de reconcileBuyEntry xStocks'a gecer (selected_token_ref guncellenir, aktif ag DEGISMEZ, teklif sifirlanir); ihracci secici tek secenek oldugundan gorunmez", async () => {
        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        const { html, st } = await mount(TSLA_B, { side: 'buy' })
        expect(cryptoStore().selected_token_ref).toEqual(refOfRow(TSLA_X_BSC))
        expect(cryptoStore().selected_token_id).toBe(TSLA_X_BSC.coingeckoId)
        expect(st().stock.issuer).toBe('xstocks')
        expect(st().side).toBe('buy')
        expect(networkStore().currentNetwork.chainId).toBe(56) // cuzdanin aktif agi DEGISMEZ
        expect(agDegisimi).not.toHaveBeenCalled()
        expect(__quote.invalidate).toHaveBeenCalled() // teklif sifirlandi
        expect(st().amount).toBe('')
        expect(st().payToken).toEqual(defaultPayToken(56))
        expect(html).not.toContain('data-issuer-switch')
        expect(html).toContain('data-trade-tab="buy"')
        expect(isDisabled(tabTag(html, 'buy'))).toBe(false)
        // kontrol: hepsi uygunken secili satir DEGISMEZ ve teklif sifirlanmaz
        resetEligibilityMock(ELIGIBILITY_ALL)
        __quote.invalidate.mockClear()
        await mount(TSLA_B, { side: 'buy' })
        expect(cryptoStore().selected_token_ref).toEqual(refOfRow(TSLA_B))
        expect(__quote.invalidate).not.toHaveBeenCalled()
    })

    it("StockTrade: Sat'tan Al'a basis (setSide) ayni gecisi yapar", async () => {
        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        const { st } = await mount(TSLA_B, { side: 'sell' })
        // Sat'ta uzlastirma YOK: satir bStocks kalir
        expect(st().side).toBe('sell')
        expect(cryptoStore().selected_token_ref).toEqual(refOfRow(TSLA_B))
        st().setSide('buy')
        expect(st().side).toBe('buy')
        expect(cryptoStore().selected_token_ref).toEqual(refOfRow(TSLA_X_BSC))
        expect(agDegisimi).not.toHaveBeenCalled()
        expect(networkStore().currentNetwork.chainId).toBe(56)
    })

    it('StockTrade: kardes yoksa side sell (olu uc yok); secili satir degismez', async () => {
        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        const { html, st } = await mount(AAPL_B, { side: 'buy' })
        expect(st().side).toBe('sell')
        expect(cryptoStore().selected_token_ref).toEqual(refOfRow(AAPL_B))
        expect(html).not.toContain('data-trade-tab="buy"')
        // Sat'tan Al'a basis da ayni sonuc: kardes yok -> Sat'ta kalir
        const { st: st2 } = await mount(AAPL_B, { side: 'sell' })
        st2().setSide('buy')
        expect(st2().side).toBe('sell')
        expect(cryptoStore().selected_token_ref).toEqual(refOfRow(AAPL_B))
    })

    it('StockTrade: uygun satir (xStocks, baska zincir kardesi uygun degil) Al\'da KALIR: uzlastirma uygun satira dokunmaz', async () => {
        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        const { st } = await mount(TSLA_X_ETH, { side: 'buy' })
        expect(st().side).toBe('buy')
        expect(cryptoStore().selected_token_ref).toEqual(refOfRow(TSLA_X_ETH))
        expect(__quote.invalidate).not.toHaveBeenCalled()
    })

    it('StockTrade: ulke ekran acikken degisti (ready sonrasi uygun -> uygun degil): uzlastirma TEKRARLANMAZ, Al sekmesi pasif kalir, bant + kilit gorunur, Sat acik, side degismez', async () => {
        resetEligibilityMock(ELIGIBILITY_ALL)
        modu.afterMount = () => {
            // Ekran acildiktan SONRA ulke degisti: ready kalir, yalniz uygunluk duser; izleyiciler yeniden tetiklense bile uzlastirma yok.
            eligibilityMock.scenario = ELIGIBILITY_NONE
            izleyicileriSur(true, true)
            // ready bir an dalgalanir (loading -> ready): tek seferlik uzlastirma YENIDEN calismaz
            izleyicileriSur(false, true)
            izleyicileriSur(true, false)
        }
        const { html, st } = await mount(TSLA_B, { side: 'buy' })
        expect(st().side).toBe('buy')
        expect(cryptoStore().selected_token_ref).toEqual(refOfRow(TSLA_B))
        const al = tabTag(html, 'buy')
        expect(al).not.toBe('')
        expect(isDisabled(al)).toBe(true) // yerinde PASIF
        expect(isDisabled(tabTag(html, 'sell'))).toBe(false)
        expect(tabsTag(html)).toContain('grid-cols-2')
        expect(html).toContain('data-stock-gate="blocked"')
        expect(html).toContain('data-stock-gate-reason="IP_COUNTRY_ISSUER"')
        expect(st().blockReason).toBe('stock-gate')
        expect(__quote.invalidate).not.toHaveBeenCalled()
    })

    it("StockTrade: uzlastirma ready degilken calismaz (uygunluk bilinmeden satir degismez)", async () => {
        resetEligibilityMock(ELIGIBILITY_LOADING)
        const { st } = await mount(TSLA_B, { side: 'buy' })
        expect(st().side).toBe('buy')
        expect(cryptoStore().selected_token_ref).toEqual(refOfRow(TSLA_B))
        expect(__quote.invalidate).not.toHaveBeenCalled()
    })
})

describe('StockTrade eligibility ssr: stock computed uygunluk icermez (K35)', () => {
    const kod = () => yorumsuz(readFileSync(resolve(HERE, 'StockTrade.vue'), 'utf8'))

    it("StockTrade: stock computed'u uygunluk icermez: uygun olmayan ihracci Sat'ta ekran \"mevcut degil\" OLMAZ ve Sat teklifi gider", async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        const { html, st } = await mount(TSLA_B, { side: 'sell', setup: (s) => { s.amount = '1' } })
        expect(st().stock).toBeTruthy()
        expect(st().available).toBe(true)
        expect(html).toContain('data-trade-tab="sell"')
        expect(html).toContain('data-trade-amount')
        expect(html).not.toContain(en.stockTrade.unavailable)
        // Sat teklifi gider: kapi kaynagi null (idle), teklif etkin
        expect(st().quoteEnabled).toBe(true)
        expect(st().request.side).toBe('sell')
        // kaynak: stock computed'u uygunluk okumaz
        const govde = blokGovdesi(kod(), /const stock = computed\(\(\) =>\s*/)
        expect(govde, 'stock computed govdesi bulunamadi').toBeTruthy()
        expect(govde).not.toMatch(/isAvailable|eligib|buyOffered|issuerAvailable/i)
        expect(govde).toContain('tradeEnabledFor(entry)')
    })

    it("StockTrade: reconcileBuyEntry pickBuyRow'u kullanir (secili satir useIssuerSwitch.commit ile yazilir; ekranda dogrudan ref yazimi yok); yalniz girisle cagrilir", () => {
        const k = kod()
        const govde = blokGovdesi(k, /function reconcileBuyEntry\(\)\s*/)
        expect(govde, 'reconcileBuyEntry govdesi bulunamadi').toBeTruthy()
        expect(govde).toContain('issuerSwitch.pickBuyRow(')
        expect(govde).toContain('buyRowFor(')
        expect(k).not.toMatch(/selected_token_ref\s*=/)
        // cagri yerleri: setSide('buy') ve tek seferlik giris (onMounted + ready izleyicisi)
        expect(blokGovdesi(k, /function setSide\(next\)\s*/)).toContain('reconcileBuyEntry()')
        expect(k).toMatch(/watch\(eligibilityReady,/)
        // izleyici tek seferlik uzlastirma kapisindan gecer, dogrudan reconcileBuyEntry degil
        expect(k).not.toMatch(/watch\((?:eligibilityReady|buyOffered)[^\n]*reconcileBuyEntry\(\)/)
    })
})

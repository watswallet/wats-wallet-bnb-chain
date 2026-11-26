// Home.vue (SSR) -- Hisseler LISTESI ihracci uygunluguna gore suzulur (Ilk Alim Kapisi, Task 43; K34, K35; spec 6.8, 13.2 #42).
//
// KOK NEDEN: bStocks Turkiye'de uygun degil ama Hisseler sekmesi hala sunuyordu; suzgec katalog fonksiyonlarina
// konsaydi TUTULAN hisse okunamaz olurdu (K35). Bu dosyanin kapattigi hata siniflari:
//  (1) uygun olmayan ihraccinin satiri listede kalir ya da TUTULAN satir listeden duser;
//  (2) yukleme sirasinda (yanit gelmeden) liste dolar ya da bos durum cizilir ("yukleniyor = gizli");
//  (3) bakiye gelmeden "hisse yok" denir (sonradan gelen tutulan hisse bos ekranin ardindan belirir);
//  (4) uygun olmayan bStocks sirket satirinin temsilcisi olur (satira basinca kilitli ihraccinin detayi acilir);
//  (5) Varliklar tohumu suzulmus listeden beslenir (K35);
//  (6) uygunluk aboneligi gorunmeyen bir yuzey icin STOCK_GATE_STATUS (ve /eligibility IP sorgusu) uretir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu). useStockEligibility
// test-utils/useStockEligibilityMock.js ile surulur; yalniz "abonelik sayisi" testleri GERCEK kancayi kullanir (modu.gercek).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const modu = vi.hoisted(() => ({ gercek: false }))
vi.mock('../composables/useStockEligibility', async (importOriginal) => {
    const actual = await importOriginal()
    const { createUseStockEligibilityMock } = await import('../test-utils/useStockEligibilityMock.js')
    const sahte = createUseStockEligibilityMock(actual)
    return { ...sahte, useStockEligibility: (options) => (modu.gercek ? actual.useStockEligibility(options) : sahte.useStockEligibility(options)) }
})

const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))

const readStockBalancesMock = vi.fn()
vi.mock('../utils/stockBalances', async (importOriginal) => ({
    ...(await importOriginal()),
    readStockBalances: (...args) => readStockBalancesMock(...args),
    ensureMultipliersFor: async () => {},
}))

vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: async () => true }))
vi.mock('axios', () => ({
    default: {
        post: async () => ({ status: 200, data: { tokens: [] } }),
        get: async () => ({ status: 200, data: { news: [] } }),
    },
}))

// Home.vue <Header> -> utils/dappFunctions.js modul ustunde chrome.windows.onRemoved.addListener cagirir (HomeBStocks ile ayni tuzak).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { yorumsuz } from '../test-utils/kaynakTarama.js'
import {
    resetEligibilityMock, ELIGIBILITY_ALL, ELIGIBILITY_XSTOCKS_ONLY, ELIGIBILITY_NONE,
    ELIGIBILITY_UNKNOWN, ELIGIBILITY_LOADING,
} from '../test-utils/useStockEligibilityMock.js'
import { disposeStockEligibilityStore } from '../composables/useStockEligibility'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { userStore } from '../store/user'
import { companyRows } from '../utils/stocks/stockCompanies'
import Home from './Home.vue'
import { BSTOCKS } from '../data/bStocks'
import supported_chains from '../data/supported_chains.json'
import en from '../i18n/locales/en.json'

const here = dirname(fileURLToPath(import.meta.url))
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const VARSAYILAN_HESAP = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }
const TON_HESABI = { address: 'UQTest000000000000000000000000000000000000000', key: 'acc-ton', type: 'ton' }
const BIR = 10n ** 18n

const TSLA = companyRows('TSLA', { xstocksEnabled: true })
const TSLA_B = TSLA.find((r) => r.issuer === 'bstocks')
const TSLA_X_BSC = TSLA.find((r) => r.issuer === 'xstocks' && r.chainId === 56)
// Yalniz bStocks'ta olan dayanaklar (xStocks karsiligi yok): uygun olmayan ihracci satirlari listeden TAM olarak buradan gorunur.
const BSTOCK_ONLY = BSTOCKS
    .filter((b) => !companyRows(b.underlying, { xstocksEnabled: true }).some((r) => r.issuer === 'xstocks'))
    .map((b) => companyRows(b.underlying, { xstocksEnabled: true }).find((r) => r.issuer === 'bstocks'))

const verdict = (decision, reason, ipCountry = null) => ({ decision, reason, ipCountry })
const ELIGIBILITY_BSTOCKS_ONLY = { ready: true, verdicts: { bstocks: verdict('OK', 'OK'), xstocks: verdict('BLOCKED', 'IP_COUNTRY_ISSUER', 'TR') } }
const ELIGIBILITY_CHECK_FAILED = { ready: true, verdicts: { bstocks: verdict('BLOCKED', 'CHECK_FAILED'), xstocks: verdict('BLOCKED', 'CHECK_FAILED') } }

// Elde tutulan satirlar (adres, kucuk harf): readStockBalances yalniz bunlara pozitif bakiye doner.
let tutulanAdresler = new Set()
const bakiyeSatirlari = async ({ entries }) => new Map(entries.map((entry) => [
    entry.address.toLowerCase(),
    {
        balance: tutulanAdresler.has(entry.address.toLowerCase()) ? 5n * BIR : 0n,
        multiplier: entry.issuer === 'xstocks' ? BIR : null,
    },
]))
const tut = (...satirlar) => { tutulanAdresler = new Set(satirlar.map((r) => r.address.toLowerCase())) }

beforeEach(() => {
    modu.gercek = false
    resetEligibilityMock(ELIGIBILITY_ALL)
    tutulanAdresler = new Set()
    readStockBalancesMock.mockImplementation(bakiyeSatirlari)
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    readStockBalancesMock.mockReset()
    useSolanaAssetsMock.mockClear()
    disposeStockEligibilityStore()
    modu.gercek = false
    delete globalThis.chrome
})

const temiz = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const satirda = (html, underlying) => temiz(html).includes(`data-stock-ticker>${underlying}<`)

/** Home.vue'yu 'stocks' sekmesi hatirlanmis halde render eder (HomeBStocks.renderHome kalibi). */
async function renderHome({ account = VARSAYILAN_HESAP, sekme = 'stocks', importedTokens = {}, stubOpts, bilinenHesap = false } = {}) {
    const stub = installChromeStub({
        currentNetwork: ETH_CHAIN, active_account: account, imported_tokens: importedTokens, vaults: [],
    }, stubOpts)
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    // Hatirlanan sekmeyle Home'a DONUS: Header hesabi pinia'ya coktan yazmistir (userStore.activeAccount).
    if (bilinenHesap) userStore().activeAccount = account
    networkStore().currentNetwork = ETH_CHAIN
    const captured = captureInstance(app, 'Home', (instance) => {
        if (sekme !== null) instance.setupState.activeTab = sekme
        instance.setupState.stockChipChoice = 'all' // ag cipi bu dosyanin konusu degil (chip testi haric)
    })
    const html = await render(app)
    return { html, captured, stub, st: captured.instance.setupState }
}

const listedIssuers = (st) => st.visibleStockGroups.flatMap((g) => g.rows.flatMap((c) => c.options.map((o) => o.issuer)))

describe('Home ssr: Hisseler listesi ihracci uygunluguna gore suzulur (K34, K35)', () => {
    it('pozitif bekci: yalniz-bStocks dayanaklari var ve katalog satirlari gercek', () => {
        expect(BSTOCK_ONLY.length).toBeGreaterThan(3)
        expect(BSTOCK_ONLY.every(Boolean)).toBe(true)
        expect(TSLA_B).toBeDefined()
        expect(TSLA_X_BSC).toBeDefined()
    })

    it('hepsi uygun: bStocks ve xStocks satirlari birlikte (kontrol)', async () => {
        const { html, st } = await renderHome()
        expect(new Set(listedIssuers(st))).toEqual(new Set(['bstocks', 'xstocks']))
        for (const row of BSTOCK_ONLY) expect(satirda(html, row.underlying), row.underlying).toBe(true)
    })

    it('bstocks uygun degil + xstocks uygun -> yalniz xStocks satirlari; tutulan bStocks satiri bakiye gelince eklenir', async () => {
        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        const bos = await renderHome()
        expect(new Set(listedIssuers(bos.st))).toEqual(new Set(['xstocks']))
        expect(listedIssuers(bos.st).length).toBeGreaterThan(0)
        for (const row of BSTOCK_ONLY) expect(satirda(bos.html, row.underlying), row.underlying).toBe(false)

        // Tutulan uygun olmayan satir KORUNUR (K35): yalniz o satir eklenir, diger bStocks satirlari yine yok.
        const [tutulan, ...digerleri] = BSTOCK_ONLY
        tut(tutulan)
        const dolu = await renderHome()
        expect(satirda(dolu.html, tutulan.underlying)).toBe(true)
        for (const row of digerleri) expect(satirda(dolu.html, row.underlying), row.underlying).toBe(false)

        // Bakiye gelmeden (stockBalances bos) satir YOK; bakiye gelince eklenir (reaktif).
        const okunmus = dolu.st.stockBalances
        const listede = () => dolu.st.listedGroups.flatMap((g) => g.rows).some((r) => r.address === tutulan.address)
        expect(listede()).toBe(true)
        dolu.st.stockBalances = {}
        expect(listede()).toBe(false)
        dolu.st.stockBalances = okunmus
        expect(listede()).toBe(true)
    })

    it('xstocks uygun degil: yalniz BSC grubu; bos grup basligi cizilmez ve cipler yalniz uygun aglari tasir', async () => {
        resetEligibilityMock(ELIGIBILITY_BSTOCKS_ONLY)
        const { html, st } = await renderHome()
        expect(st.listedGroups.map((g) => g.chainId)).toEqual([56])
        expect(temiz(html).match(/data-stock-group-header/g)).toHaveLength(1)
        expect(st.stockChips).toEqual(['all', 56])
        expect(new Set(listedIssuers(st))).toEqual(new Set(['bstocks']))
    })

    it('Home ssr: yukleniyor (ELIGIBILITY_LOADING) -> liste bos ve bos durum YOK', async () => {
        resetEligibilityMock(ELIGIBILITY_LOADING)
        const { html, st } = await renderHome()
        // pozitif bekci: bakiye YUKLENDI, yani bos durumu bastiran tek sey uygunluk yuklemesidir
        expect(st.balancesLoaded).toBe(true)
        expect(st.listedGroups).toEqual([])
        expect(listedIssuers(st)).toEqual([])
        const govde = temiz(html)
        expect(govde).toContain('data-stock-skeleton')
        expect(govde).not.toContain('data-stock-empty')
        expect(govde).not.toContain(en.stockGate.empty.list)
        expect(govde).not.toContain(en.stockGate.empty.unknown)
        expect(govde).not.toContain(en.home.stocksEmpty)
    })

    it('Home ssr: hicbiri uygun degil + hisse yok + balancesLoaded -> stockGate.empty.list; COUNTRY_UNKNOWN -> stockGate.empty.unknown; home.stocksEmpty ayri kalir', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        const liste = await renderHome()
        expect(liste.st.balancesLoaded).toBe(true)
        expect(liste.st.listedGroups).toEqual([])
        const govdeListe = temiz(liste.html)
        expect(govdeListe).toContain('data-stock-empty-list')
        expect(govdeListe).toContain(en.stockGate.empty.list)
        expect(govdeListe).not.toContain(en.stockGate.empty.unknown)
        expect(govdeListe).not.toContain(en.home.stocksEmpty)
        expect(govdeListe).not.toContain('data-stock-skeleton')

        for (const senaryo of [ELIGIBILITY_UNKNOWN, ELIGIBILITY_CHECK_FAILED]) {
            resetEligibilityMock(senaryo)
            const bilinmeyen = await renderHome()
            const govde = temiz(bilinmeyen.html)
            expect(govde).toContain('data-stock-empty-unknown')
            expect(govde).toContain(en.stockGate.empty.unknown)
            expect(govde).not.toContain(en.stockGate.empty.list)
            expect(govde).not.toContain(en.home.stocksEmpty)
        }
    })

    it('hicbiri uygun degil ama bir hisse TUTULUYOR -> liste bos degil, bos durum YOK', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        tut(BSTOCK_ONLY[0])
        const { html, st } = await renderHome()
        expect(st.listedGroups.length).toBeGreaterThan(0)
        expect(satirda(html, BSTOCK_ONLY[0].underlying)).toBe(true)
        expect(temiz(html)).not.toContain('data-stock-empty')
    })

    it('Home ssr: bakiye yuklenmeden bos durum YOK', async () => {
        resetEligibilityMock(ELIGIBILITY_NONE)
        const salinacaklar = []
        readStockBalancesMock.mockImplementation((args) => new Promise((coz) => { salinacaklar.push(() => coz(bakiyeSatirlari(args))) }))
        const { html, st } = await renderHome()
        try {
            expect(st.balancesLoaded).toBe(false)
            expect(st.listedGroups).toEqual([])
            expect(temiz(html)).not.toContain('data-stock-empty')
            expect(temiz(html)).not.toContain(en.stockGate.empty.list)
        } finally {
            // Bakiye gelir: bayrak acilir (pozitif bekci: yukaridaki bos durum yoklugu "hic bakiye gelmedigi" icin degil)
            for (const salin of salinacaklar) salin()
        }
        await vi.waitFor(() => expect(st.balancesLoaded).toBe(true))
        expect(st.stockListEmpty).toBe(true)
    })

    it('Home ssr: Hisseler sekme dugmesi ihracci uygunluguna bagli degil', async () => {
        for (const senaryo of [ELIGIBILITY_NONE, ELIGIBILITY_LOADING, ELIGIBILITY_UNKNOWN]) {
            resetEligibilityMock(senaryo)
            const { html, st } = await renderHome()
            expect(st.stocksAvailable).toBe(true)
            expect(st.gorunenSekme).toBe('stocks')
            expect(temiz(html)).toMatch(new RegExp(`<button class="[^"]*text-indigo-600 dark:text-white[^"]*">\\s*${en.home.stocks}\\s*</button>`))
        }
    })

    it('Home ssr: temsilci secimi suzulmus options uzerinden (uygun olmayan bStocks temsilci olmaz)', async () => {
        // kontrol: hepsi uygunken bStocks temsilcidir (TK6 varsayilani)
        const tumu = await renderHome()
        const tumuSirket = tumu.st.visibleStockGroups.find((g) => g.chainId === 56).rows.find((c) => c.underlying === 'TSLA')
        expect(tumu.st.companyRepresentative(tumuSirket).issuer).toBe('bstocks')

        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        const { st } = await renderHome()
        const sirket = st.visibleStockGroups.find((g) => g.chainId === 56).rows.find((c) => c.underlying === 'TSLA')
        expect(sirket.options.map((o) => o.issuer)).toEqual(['xstocks'])
        expect(st.companyRepresentative(sirket).issuer).toBe('xstocks')
        expect(st.companyRepresentative(sirket).address).toBe(TSLA_X_BSC.address)

        // satira basinca da uygun olmayan ihraccinin hissesi ACILMAZ: yazilan kimlik temsilcinin (xStocks) kimligidir
        await st.openStock(sirket)
        expect(cryptoStore().selected_token_ref.address).toBe(TSLA_X_BSC.address)
        expect(cryptoStore().selected_token_ref.address).not.toBe(TSLA_B.address)
    })

    it('tutulan uygun olmayan bStocks, uygun xStocks ile ayni sirkette: tutulan secenek temsilci olur (K35, TK6)', async () => {
        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        tut(TSLA_B)
        const { st } = await renderHome()
        const sirket = st.visibleStockGroups.find((g) => g.chainId === 56).rows.find((c) => c.underlying === 'TSLA')
        expect(sirket.options.map((o) => o.issuer).sort()).toEqual(['bstocks', 'xstocks'])
        expect(st.companyRepresentative(sirket).issuer).toBe('bstocks')
    })

    it('Home: seedOwnedStocks tam katalogdan beslenir (uygun olmayan ihraccinin tutulan hissesi Varliklar\'a eklenir)', async () => {
        resetEligibilityMock(ELIGIBILITY_XSTOCKS_ONLY)
        const tutulan = BSTOCK_ONLY[0]
        tut(tutulan)
        const { stub } = await renderHome({ importedTokens: { acc1: { 1: [], 56: [] } } })
        const kova = stub.localStore.imported_tokens?.acc1?.['56'] ?? []
        expect(kova.some((t) => t.address.toLowerCase() === tutulan.address.toLowerCase())).toBe(true)
        expect(kova).toHaveLength(1)

        // Kaynak kilidi: tohum TAM katalogdan (stockGroups), suzulmus listeden (listedGroups) DEGIL (K35)
        const kaynak = yorumsuz(readFileSync(join(here, 'Home.vue'), 'utf8'))
        expect(kaynak).toContain('seedOwnedStocks(ownedRows(stockGroups.value, balances))')
        expect(kaynak).not.toMatch(/seedOwnedStocks\(ownedRows\(listedGroups/)
        // fiyat ve bakiye de katalogdan
        expect(kaynak).toContain('collectStockIds(stockGroups.value)')
        expect(kaynak).toMatch(/loadGroupBalances\(\{ owner, groups: stockGroups\.value/)
    })
})

describe('Home ssr: uygunluk aboneligi yalniz gorunen Hisseler sekmesinde (PE15; GERCEK kanca)', () => {
    const durumMesajlari = []
    const yanit = (mesaj) => { durumMesajlari.push(mesaj); return { bstocks: verdict('OK', 'OK'), xstocks: verdict('OK', 'OK') } }

    beforeEach(() => {
        durumMesajlari.length = 0
        modu.gercek = true
        disposeStockEligibilityStore()
    })

    it('Home ssr: hatirlanan sekme \'stocks\' ama hesap hicbir hisse zincirini tutamiyor (TON-only hesap) -> store acquire etmez, STOCK_GATE_STATUS mesaji GITMEZ (gorunenSekme olcutu)', async () => {
        const { st } = await renderHome({ account: TON_HESABI, bilinenHesap: true, stubOpts: { eligibility: yanit } })
        // pozitif bekci: hatirlanan sekme 'stocks', gorunen sekme 'assets' (panel cizilmiyor)
        expect(st.activeTab).toBe('stocks')
        expect(st.stocksAvailable).toBe(false)
        expect(st.gorunenSekme).toBe('assets')
        expect(durumMesajlari).toEqual([])
    })

    it('Home ssr: hisse sekmesi gorunurken ilk acquire tek mesaj', async () => {
        const { st, html } = await renderHome({ stubOpts: { eligibility: yanit } })
        expect(st.gorunenSekme).toBe('stocks')
        expect(durumMesajlari).toHaveLength(1)
        expect(durumMesajlari[0]).toEqual({ type: 'STOCK_GATE_STATUS' })
        // gercek kanca varsayilan "tumu uygun" yanitla listeyi doldurur
        expect(satirda(html, BSTOCK_ONLY[0].underlying)).toBe(true)
    })

    it('Hisseler sekmesi gorunmuyorken (Varliklar) mesaj yok', async () => {
        const { st } = await renderHome({ sekme: 'assets', stubOpts: { eligibility: yanit } })
        expect(st.gorunenSekme).toBe('assets')
        expect(durumMesajlari).toEqual([])
    })

    // UI-1: kapinin ic nedenleri (RULES_INVALID: kural tablosu gecersiz, ISSUER_UNKNOWN) kullaniciya yazilan bir neden degil,
    // karar verilemedi demektir. Eskiden store bu nedeni HAM tasidigindan Home bos durumu "bu bolgede urun yok" (hatali ulke
    // iddiasi) derdi; artik BLOCKED nedeni kapali kumeye (CHECK_FAILED) iner ve "bolgen belirlenemedi" cikar.
    it.each([
        ['RULES_INVALID', 'ISSUER_UNKNOWN'],
        ['bogus', '__proto__'],
    ])('Home ssr: kume disi BLOCKED nedeni (%s / %s) bos durumda "bolgen belirlenemedi" der, "bu bolgede urun yok" DEGIL (GERCEK kanca)', async (b, x) => {
        const hamYanit = () => ({ bstocks: verdict('BLOCKED', b), xstocks: verdict('BLOCKED', x) })
        const { st, html } = await renderHome({ stubOpts: { eligibility: hamYanit } })
        expect(st.balancesLoaded).toBe(true)
        expect(st.listedGroups).toEqual([])
        const govde = temiz(html)
        expect(govde).toContain('data-stock-empty-unknown')
        expect(govde).toContain(en.stockGate.empty.unknown)
        expect(govde).not.toContain('data-stock-empty-list')
        expect(govde).not.toContain(en.stockGate.empty.list)
    })

    it('kaynak: abonelik olcutu gorunenSekme (activeTab DEGIL)', () => {
        const kaynak = yorumsuz(readFileSync(join(here, 'Home.vue'), 'utf8'))
        expect(kaynak).toMatch(/useStockEligibility\(\{\s*enabled:\s*\(\)\s*=>\s*gorunenSekme\.value === 'stocks'/)
    })
})

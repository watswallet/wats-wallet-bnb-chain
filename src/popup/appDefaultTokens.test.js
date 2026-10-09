// App.vue ACILIS tohumu -- varsayilan tokenlar tek kural ve tek yazici uzerinden.
//
// App.vue GERCEKTEN render edilir (bkz. alertSurface.test.js / dappApprovalSurface.test.js,
// ayni harness) ve `onMounted` GERCEKTEN kosar. Cuzdan KILITLI acilir: Home mount olmaz,
// yani olculen sey YALNIZ App'in kendi tohum blogudur (Home'unki: Home.defaultTokens.ssr.test.js).
//
// KAPATILAN HATALAR (kullanici raporu: "yeni import edilen cuzdanda hicbir token gelmiyor"):
//   1) Eski kapi `!imported_tokens[hesap]` KOVANIN VARLIGINA bakiyordu. Home'un TON tohumu
//      (ensureTonNativeToken) bos kovayi `{'-239':[GRAM]}` olarak yaratinca kapi kalici
//      kapaniyor, varsayilanlar bir daha gelmiyordu.
//   2) Eski blok acilista okunan anlik goruntuden TUM `imported_tokens` haritasini geri
//      yaziyordu: ag istegi suresince baska bir baglamda yapilan yazimlar sessizce ezilirdi.
//   3) Sunucu ulasilamazsa eski blok `{[hesap]: undefined}` yaziyordu.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// App.vue -> utils/dappFunctions.js zinciri MODUL UST DUZEYINDE
// chrome.windows.onRemoved.addListener cagirir (bkz. dappApprovalSurface.test.js).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

const axiosGetMock = vi.fn()
vi.mock('axios', () => ({
    default: {
        get: (...args) => axiosGetMock(...args),
        post: async () => ({ status: 200, data: {} }),
    },
}))

const POPUP_YOLU = '/src/popup/index.html'
const EVM_AG = { chainId: 1, name: 'Ethereum', rpc: [{ url: 'https://rpc.example' }] }
const HESAP = { address: '0xAbC0000000000000000000000000000000000001', key: 'k1', type: 'hd' }

const img = { thumb: 't', small: 's', large: 'l' }
const ZERO = '0x0000000000000000000000000000000000000000'
const ETH = { _id: 'e1', name: 'Ethereum', symbol: 'eth', address: ZERO, chain: 'ethereum', decimals: 18, coingecko_id: 'ethereum', image: img }
const USDT = { _id: 'e2', name: 'Tether', symbol: 'usdt', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', chain: 'ethereum', decimals: 6, coingecko_id: 'tether', image: img }
const ATS = { _id: 'b1', name: 'Alltoscan', symbol: 'ats', address: '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d', chain: 'binance-smart-chain', decimals: 18, coingecko_id: 'alltoscan', image: img }
const BNB = { _id: 'b2', name: 'BNB', symbol: 'bnb', address: ZERO, chain: 'binance-smart-chain', decimals: 18, coingecko_id: 'binancecoin', image: img }
const SERVER_DEFAULTS = { 1: [ETH, USDT], 56: [ATS, BNB] }
const GRAM = { name: 'GRAM', symbol: 'GRAM', address: '0x0', decimals: 9, coingecko_id: 'the-open-network', id: 'the-open-network' }

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

// App baska anahtarlari da yazar (orn. currentNetwork): olculen yalniz `imported_tokens` yazimlari.
const tokenYazimlari = (yazimlar) => yazimlar.filter((obj) => 'imported_tokens' in obj)

/**
 * App.vue'yu KILITLI cuzdanla render eder. `imported_tokens` verilmezse depoda HIC olmaz.
 * Depo GERCEK chrome.storage gibi derin kopya verir/alir: bayat anlik goruntu GERCEKTEN bayat.
 */
async function uygulamayiAc({ imported_tokens, izle = { degisim: [], mesaj: [], belge: [], aralik: 0 } }) {
    vi.resetModules()

    const depo = {
        vaults: [{ accounts: [HESAP] }],
        active_account: HESAP,
        currentNetwork: EVM_AG,
    }
    if (imported_tokens !== undefined) depo.imported_tokens = imported_tokens
    const yazimlar = []

    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const istenen = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(istenen.filter((k) => k in depo).map((k) => [k, clone(depo[k])]))
                },
                set: async (obj) => { yazimlar.push(clone(obj)); Object.assign(depo, clone(obj)) },
                remove: async (k) => { delete depo[k] },
            },
            onChanged: { addListener: (fn) => izle.degisim.push(fn), removeListener: () => {} },
        },
        runtime: {
            sendMessage: async (msg) => (msg?.type === 'CHECK_UNLOCK' ? { unlocked: false } : {}),
            onMessage: { addListener: (fn) => izle.mesaj.push(fn), removeListener: () => {} },
            getURL: (p) => `chrome-extension://wats/${p}`,
        },
        tabs: { create: () => {}, query: async () => [] },
        windows: { onRemoved: { addListener: () => {} }, getCurrent: async () => ({ id: 1 }) },
    }

    const sahteBelge = {
        addEventListener: (ad) => izle.belge.push(ad),
        removeEventListener: () => {},
        createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
        querySelector: () => null,
        documentElement: { classList: { add: () => {}, remove: () => {}, contains: () => false } },
        visibilityState: 'hidden',
    }
    vi.stubGlobal('window', {
        location: { pathname: POPUP_YOLU, hash: '' },
        document: sahteBelge,
        addEventListener: () => {},
        removeEventListener: () => {},
        matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
        performance: { now: () => Date.now() },
    })
    vi.stubGlobal('document', sahteBelge)
    // Baglanti izleyicisinin 5 sn'lik dongusu: kurulup kurulmadigi sayilir.
    vi.stubGlobal('setInterval', (_fn, ms) => { if (ms === 5000) izle.aralik += 1; return 1 })
    vi.stubGlobal('fetch', async () => ({ ok: true }))

    const { createApp, render, createTestPinia, createTestI18n } = await import('../test-utils/ssrRender.js')
    const { pageStore } = await import('../store/pageStore')
    const App = (await import('./App.vue')).default

    const app = createApp(App)
    app.use(createTestPinia())
    app.use(createTestI18n())
    izle.page = pageStore()
    await render(app)

    return { depo, yazimlar }
}

const sunucuTamam = () => axiosGetMock.mockResolvedValue({ status: 200, data: { success: true, importedTokens: SERVER_DEFAULTS } })

// Tohum App acilisini BEKLETMEZ (atesle-ve-unut): render bittiginde sonuc henuz yazilmamis olabilir.
const bekle = (kosul) => vi.waitFor(kosul, { timeout: 10000, interval: 20 })
// "Hicbir sey yazilmaz/istenmez" iddialari icin: yardimci kuyrugu bosaltmasi icin kisa gercek bekleme.
const yerles = () => new Promise((resolve) => setTimeout(resolve, 100))

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    axiosGetMock.mockReset()
    delete globalThis.chrome
})

describe('App.vue acilis tohumu -- tek kural, tek yazici', () => {
    // Eski kapi kovanin VARLIGINA bakiyordu: `{'-239':[GRAM]}` "var" sayilir, tohum hic gelmezdi.
    it("hasarli kova ({'-239':[GRAM]}) acilista iyilesir ve GRAM KORUNUR", async () => {
        sunucuTamam()

        const { depo } = await uygulamayiAc({ imported_tokens: { k1: { '-239': [GRAM] } } })

        await bekle(() => expect(depo.imported_tokens.k1).toEqual({ ...SERVER_DEFAULTS, '-239': [GRAM] }))
        expect(axiosGetMock).toHaveBeenCalledTimes(1)
    }, 60000)

    it('depoda imported_tokens HIC yoksa (sifirlama sonrasi) tohumlar', async () => {
        sunucuTamam()

        const { depo } = await uygulamayiAc({})

        await bekle(() => expect(depo.imported_tokens).toEqual({ k1: SERVER_DEFAULTS }))
    }, 60000)

    // Eski blok acilista okunan anlik goruntuden TUM haritayi geri yaziyordu.
    it('istek suresince degisen BASKA hesabin kovasi EZILMEZ (yalniz aktif hesabin kovasi yazilir)', async () => {
        const kullaniciSatiri = { name: 'USD Coin', symbol: 'usdc', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, coingecko_id: 'usd-coin', image: img }
        axiosGetMock.mockImplementation(async () => {
            // Baska bir baglam (ImportToken / baska bir pencere) ISTEK SIRASINDA k2'ye token
            // ekledi: depoya, App'in kullandigi AYNI chrome.storage uzerinden yazilir.
            const { imported_tokens } = await globalThis.chrome.storage.local.get('imported_tokens')
            await globalThis.chrome.storage.local.set({
                imported_tokens: { ...imported_tokens, k2: { 1: [ETH, kullaniciSatiri] } },
            })
            return { status: 200, data: { success: true, importedTokens: SERVER_DEFAULTS } }
        })

        const { depo } = await uygulamayiAc({ imported_tokens: { k2: { 1: [ETH] } } })

        await bekle(() => expect(depo.imported_tokens.k1).toEqual(SERVER_DEFAULTS))
        expect(depo.imported_tokens.k2).toEqual({ 1: [ETH, kullaniciSatiri] })
    }, 60000)

    it('sunucu ulasilamazsa HICBIR sey yazilmaz ve uygulama yine acilir', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        axiosGetMock.mockRejectedValue(new Error('Network Error'))

        const { depo, yazimlar } = await uygulamayiAc({})

        await bekle(() => expect(axiosGetMock).toHaveBeenCalledTimes(1))
        await yerles()
        expect(tokenYazimlari(yazimlar)).toEqual([])
        expect('imported_tokens' in depo).toBe(false)
    }, 60000)

    it("saglikli kova ('1' ve '56' anahtarlari var, bos) icin AG ISTEGI YOK", async () => {
        const { depo, yazimlar } = await uygulamayiAc({ imported_tokens: { k1: { 1: [], 56: [] } } })

        await yerles()
        expect(axiosGetMock).not.toHaveBeenCalled()
        expect(tokenYazimlari(yazimlar)).toEqual([])
        expect(depo.imported_tokens.k1).toEqual({ 1: [], 56: [] })
    }, 60000)

    // Tohum istegi 8 sn'ye kadar asili kalabilir. App acilisini BEKLETMEMELI: kilitlenme
    // dinleyicisi (SESSION_EXPIRED), `current_request` canli yazim dinleyicisi ve baglanti
    // izleyicisi tohumdan SONRA kuruluyordu; yani o sure boyunca panel oturum kilidini bile
    // duymazdi. Home ayni cagriyi yapar ve devam eden isi paylasir (ayri istek yok).
    it('tohum istegi ASILIYKEN dinleyiciler ve baglanti izleyicisi yine de kurulur (await YOK)', async () => {
        let sunucuyuSerbestBirak
        axiosGetMock.mockImplementation(() => new Promise((resolve) => {
            sunucuyuSerbestBirak = () => resolve({ status: 200, data: { success: true, importedTokens: SERVER_DEFAULTS } })
        }))
        const izle = { degisim: [], mesaj: [], belge: [], aralik: 0 }

        const acilis = uygulamayiAc({ imported_tokens: {}, izle })
        await vi.waitFor(() => expect(axiosGetMock).toHaveBeenCalledTimes(1), { timeout: 60000, interval: 20 })

        let sonuc
        try {
            // GET hala asili: asagidakilerin HEPSI zaten kurulu olmali.
            expect(izle.mesaj).toHaveLength(1)                    // runtime.onMessage (SESSION_EXPIRED)

            // storage.onChanged: store/transaction.js de bir dinleyici kurar, sayi bir sey soylemez;
            // App'inki DAVRANISLA olculur -- `current_request` silinince onay ekranindan home'a doner.
            izle.page.currentPage = 'dapp_connect'
            for (const fn of izle.degisim) await fn({ current_request: { newValue: undefined } }, 'local')
            expect(izle.page.currentPage).toBe('home')

            expect(izle.belge).toContain('visibilitychange')      // baglanti izleyicisinin gorunurluk dinleyicisi
            await bekle(() => expect(izle.aralik).toBe(1))        // baglanti izleyicisinin 5 sn'lik dongusu
        } finally {
            // Basarisiz iddia durumunda bile acilis bitirilir (askida kalan is testten sonra sizmasin).
            sunucuyuSerbestBirak?.()
            sonuc = await acilis
        }

        // Atesle-ve-unut tohum yine de TAMAMLANIR.
        await bekle(() => expect(sonuc.depo.imported_tokens).toEqual({ k1: SERVER_DEFAULTS }))
    }, 60000)
})

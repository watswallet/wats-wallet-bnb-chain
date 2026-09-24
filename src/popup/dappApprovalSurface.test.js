// S7.1 -- DAPP ONAY EKRANLARI YAN PANELE GIRMEZ.
//
// Bu dosya KAYNAK KILIDI DEGIL: App.vue GERCEKTEN render edilir (SSR harness,
// bkz. src/test-utils/ssrRender.js), `onMounted` GERCEKTEN kosar ve
// `chrome.storage.onChanged` dinleyicisi GERCEKTEN cagrilir. Olculen sey
// `page.currentPage`in kendisidir.
//
// KAPATILAN HATA: `current_request` diske yazildigi anda (dappFunctions.js AYRI
// bir onay penceresi acarken) `chrome.storage.onChanged` HER uzanti baglaminda
// tetiklenir. Popup bu yolu pratikte gormuyordu -- odak onay penceresine
// gecince KAPANIYORDU. Panel kapanmaz ve N pencerede acik olabilir: ayni
// "Onayla" dugmesi iki (ya da N+1) yuzeyde birden durur. Dapp.vue onayi
// dogrudan `SEND_TRANSACTION` ile arka plana gonderir -- `resolvePendingRequest`
// yolundan GECMEZ -- yani dapp'e yanit gitmese bile IKINCI bir imza uretilip
// YAYINLANABILIR.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Header.vue -> utils/dappFunctions.js zinciri MODUL UST DUZEYINDE
// chrome.windows.onRemoved.addListener cagirir; o satir import ANINDA calisir.
// (Ayni tuzak: Header.ssr.test.js, ConnectDapp.ssr.test.js.)
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

const PANEL_YOLU = '/src/sidepanel/index.html'
const POPUP_YOLU = '/src/popup/index.html'

const EVM_AG = { chainId: 1, name: 'Ethereum', rpc: [{ url: 'https://rpc.example' }] }
const HESAP = { address: '0xAbC0000000000000000000000000000000000001', key: 'k1', type: 'hd' }

/**
 * App.vue'yu VERILEN YUZEYDE gercekten render eder ve `storage.onChanged`
 * dinleyicilerini yakalar.
 *
 * `vi.resetModules()` SART: utils/uiSurface.js yuzeyi MODUL KAPSAMINDA bir kez
 * hesaplayip ONBELLEKLER ("Yuzey sayfa omru boyunca DEGISMEZ"). Ayni dosyada
 * iki farkli yuzeyi olcebilmenin tek yolu modul kaydini sifirlayip App.vue'yu
 * o yuzeyin `window.location`i KURULDUKTAN SONRA yeniden ice aktarmaktir.
 */
async function panelVeyaPopupAc({ pathname, currentRequest = null, unlocked = false }) {
    vi.resetModules()

    const degisimDinleyicileri = []
    const depo = {
        vaults: [{ accounts: [HESAP] }],
        active_account: HESAP,
        // Dolu birakilir: bos olsaydi App.vue getImportedTokens() ile GERCEK
        // bir HTTP istegine cikardi.
        imported_tokens: { [HESAP.key]: [] },
        currentNetwork: EVM_AG,
        current_request: currentRequest,
    }

    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const istenen = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(istenen.map((k) => [k, depo[k]]))
                },
                set: async (obj) => { Object.assign(depo, obj) },
                remove: async (k) => { delete depo[k] },
            },
            onChanged: {
                addListener: (fn) => degisimDinleyicileri.push(fn),
                removeListener: () => {},
            },
        },
        runtime: {
            sendMessage: async (msg) => (msg?.type === 'CHECK_UNLOCK' ? { unlocked } : {}),
            onMessage: { addListener: () => {}, removeListener: () => {} },
            getURL: (p) => `chrome-extension://wats/${p}`,
        },
        tabs: { create: () => {}, query: async () => [] },
        windows: { onRemoved: { addListener: () => {} }, getCurrent: async () => ({ id: 1 }) },
    }

    // `createElement` SART: `vi.resetModules()` sonrasi @vue/runtime-dom modul
    // ust duzeyinde `doc.createElement('template')` cagirir; eksik olursa
    // 'vue' ice aktarimi TypeError ile duser. `querySelector` ise App.vue'nun
    // `useDark({ selector: 'html' })` cagrisi icin (@vueuse/core).
    const sahteBelge = {
        addEventListener: () => {},
        removeEventListener: () => {},
        createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
        querySelector: () => null,
        documentElement: { classList: { add: () => {}, remove: () => {}, contains: () => false } },
        visibilityState: 'hidden',
    }
    // YUZEYIN KENDISI: uiSurface.js yalnizca `window.location.pathname`e bakar.
    vi.stubGlobal('window', {
        location: { pathname, hash: '' },
        document: sahteBelge,
        addEventListener: () => {},
        removeEventListener: () => {},
        matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
        // vue-i18n (@intlify) `window` varsa `window.performance.now()` okur.
        performance: { now: () => Date.now() },
    })
    vi.stubGlobal('document', sahteBelge)
    // Baglanti izleyicisi: gercek zamanlayici da gercek ag da istemiyoruz.
    vi.stubGlobal('setInterval', () => 1)
    vi.stubGlobal('fetch', async () => ({ ok: true }))

    const { createApp, render, createTestPinia, createTestI18n } = await import('../test-utils/ssrRender.js')
    const { pageStore } = await import('../store/pageStore')
    const App = (await import('./App.vue')).default

    const app = createApp(App)
    app.use(createTestPinia())
    app.use(createTestI18n())
    await render(app)

    const page = pageStore()
    // Dinleyicilerin HEPSI cagrilir: biri store/transaction.js'in
    // `current_transactions` izleyicisidir ve bizim degisimimizi yok sayar.
    const depoyaYaz = async (changes) => {
        for (const fn of degisimDinleyicileri) await fn(changes, 'local')
    }

    return { page, depoyaYaz, depo }
}

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

describe('S7.1 -- canli `current_request` yazimi (storage.onChanged)', () => {
    it('PANEL onay ekranina GECMEZ', async () => {
        const { page, depoyaYaz } = await panelVeyaPopupAc({ pathname: PANEL_YOLU })
        page.currentPage = 'home'

        await depoyaYaz({ current_request: { newValue: { type: 'SEND_TX', origin: 'https://dapp.example' } } })

        expect(page.currentPage).not.toBe('dapp_router')
        expect(page.currentPage).toBe('home')
    }, 60000)

    it('POPUP onay ekranina GECER (kontrol -- kapi yuzeye ozel)', async () => {
        const { page, depoyaYaz } = await panelVeyaPopupAc({ pathname: POPUP_YOLU })
        page.currentPage = 'home'

        await depoyaYaz({ current_request: { newValue: { type: 'SEND_TX', origin: 'https://dapp.example' } } })

        expect(page.currentPage).toBe('dapp_router')
    }, 60000)

    it('PANEL imza ekranina da GECMEZ (tip basina degil, dalin TAMAMI kapali)', async () => {
        const { page, depoyaYaz } = await panelVeyaPopupAc({ pathname: PANEL_YOLU })
        page.currentPage = 'home'

        await depoyaYaz({ current_request: { newValue: { type: 'SIGN_MESSAGE' } } })

        expect(page.currentPage).toBe('home')
    }, 60000)

    // KURTARMA YOLU KAPIDAN MUAF: istek COZULUNCE (kayit silinir) bir sekilde
    // onay ekraninda kalmis bir panel `home`a DONEBILMELI.
    it('PANEL istek cozulunce onay ekranindan home a doner', async () => {
        const { page, depoyaYaz } = await panelVeyaPopupAc({ pathname: PANEL_YOLU })
        page.currentPage = 'dapp_router'

        await depoyaYaz({ current_request: { newValue: undefined, oldValue: { type: 'SEND_TX' } } })

        expect(page.currentPage).toBe('home')
    }, 60000)
})

describe('S7.1 -- panel ACILIRKEN diskte bekleyen istek', () => {
    it('KILITSIZ panel onay ekranina DEGIL home a acilir', async () => {
        const { page } = await panelVeyaPopupAc({
            pathname: PANEL_YOLU,
            currentRequest: { type: 'SEND_TX' },
            unlocked: true,
        })

        expect(page.currentPage).not.toBe('dapp_router')
        expect(page.currentPage).toBe('home')
    }, 60000)

    // KILITLI dal AYRI bir alan yazar (`page.redirect`): kasa acilir acilmaz
    // ayni onay ekranina goturur, yani kapi konmazsa ayni ikinci imza yuzeyi
    // GECIKMELI olarak acilirdi.
    it('KILITLI panel `page.redirect` kurmaz', async () => {
        const { page } = await panelVeyaPopupAc({
            pathname: PANEL_YOLU,
            currentRequest: { type: 'SEND_TX' },
            unlocked: false,
        })

        expect(page.currentPage).toBe('welcome')
        expect(page.redirect).not.toBe('dapp_router')
    }, 60000)

    it('KILITLI popup `page.redirect` kurar (kontrol)', async () => {
        const { page } = await panelVeyaPopupAc({
            pathname: POPUP_YOLU,
            currentRequest: { type: 'SEND_TX' },
            unlocked: false,
        })

        expect(page.currentPage).toBe('welcome')
        expect(page.redirect).toBe('dapp_router')
    }, 60000)
})

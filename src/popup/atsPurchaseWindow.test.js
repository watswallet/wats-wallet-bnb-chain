// SATIN ALMA PENCERESI -- App.vue onu dapp onay ekranina HIC tasimaz (spec §6.4; Review Focus 5).
//
// Dapp onay penceresindeki "ATS Al" satin almayi `src/popup/index.html?ats-purchase=1#window`
// adresinde AYRI bir pencerede acar. Bu pencere acilista ag degistirir (BSC); ayni pencere bir dapp
// onay ekranina gecerse ag degisimi o ekrana yayilir ve dapp'in cagrisi yanlis zincirde imzalanabilir.
// Kapi S7.1'deki yan panel kapisiyla AYNI uc noktada durur: kilitsiz acilis, kilitli acilis
// (`page.redirect`) ve canli `current_request` yazimi.
//
// App.vue GERCEKTEN render edilir (dappApprovalSurface.test.js ile ayni harness); yalniz
// `useAtsPurchase` sabitlenir.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Header.vue -> utils/dappFunctions.js zinciri MODUL UST DUZEYINDE
// chrome.windows.onRemoved.addListener cagirir; o satir import ANINDA calisir.
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

const satis = vi.hoisted(() => ({ acik: true, acildi: true }))
const acilis = vi.hoisted(() => vi.fn(async () => satis.acildi))
vi.mock('../composables/useAtsPurchase', async (importOriginal) => ({
    ...(await importOriginal()),
    useAtsPurchase: () => ({ live: satis.acik, open: acilis }),
}))

const POPUP_YOLU = '/src/popup/index.html'
const EVM_AG = { chainId: 1, name: 'Ethereum', rpc: [{ url: 'https://rpc.example' }] }
const HESAP = { address: '0xAbC0000000000000000000000000000000000001', key: 'k1', type: 'hd' }
const ISTEK = { type: 'SEND_TX', origin: 'https://dapp.example' }

/** App.vue'yu VERILEN adreste render eder; `vi.resetModules()` gerekcesi dappApprovalSurface.test.js'te. */
async function pencereAc({ search = '?ats-purchase=1', currentRequest = null, unlocked = true } = {}) {
    vi.resetModules()

    const degisimDinleyicileri = []
    const depo = {
        vaults: [{ accounts: [HESAP] }],
        active_account: HESAP,
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

    const sahteBelge = {
        addEventListener: () => {},
        removeEventListener: () => {},
        createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
        querySelector: () => null,
        documentElement: { classList: { add: () => {}, remove: () => {}, contains: () => false } },
        visibilityState: 'hidden',
    }
    vi.stubGlobal('window', {
        location: { pathname: POPUP_YOLU, hash: '#window', search },
        document: sahteBelge,
        addEventListener: () => {},
        removeEventListener: () => {},
        matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
        performance: { now: () => Date.now() },
    })
    vi.stubGlobal('document', sahteBelge)
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
    const depoyaYaz = async (changes) => {
        for (const fn of degisimDinleyicileri) await fn(changes, 'local')
    }
    return { page, depoyaYaz }
}

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
    acilis.mockClear()
    satis.acik = true
    satis.acildi = true
})

describe('satin alma penceresi (?ats-purchase=1) -- satis ACIK', () => {
    it('acilista satin almayi acar; diskte bekleyen SEND_TX onay ekranina GECIRMEZ', async () => {
        const { page } = await pencereAc({ currentRequest: ISTEK })
        expect(acilis).toHaveBeenCalledTimes(1)
        expect(page.currentPage).not.toBe('dapp_router')
    }, 60000)

    it('canli current_request yazimi pencereyi onay ekranina TASIMAZ', async () => {
        const { page, depoyaYaz } = await pencereAc()
        page.currentPage = 'swap'
        await depoyaYaz({ current_request: { newValue: ISTEK } })
        expect(page.currentPage).toBe('swap')
    }, 60000)

    it('ag gecisi reddedilirse (satin alma acilamadi) ana ekran', async () => {
        satis.acildi = false
        const { page } = await pencereAc()
        expect(acilis).toHaveBeenCalledTimes(1)
        expect(page.currentPage).toBe('home')
    }, 60000)

    it('KILITLI pencere `page.redirect` kurmaz', async () => {
        const { page } = await pencereAc({ currentRequest: ISTEK, unlocked: false })
        expect(page.currentPage).toBe('welcome')
        expect(page.redirect).not.toBe('dapp_router')
        expect(acilis).not.toHaveBeenCalled()
    }, 60000)
})

describe('kontroller -- kapi yalniz satis penceresinde', () => {
    it('satis KAPALIYKEN ayni adres bugunku popup gibi: onay ekranina gecer, satin alma calismaz', async () => {
        satis.acik = false
        const { page, depoyaYaz } = await pencereAc({ currentRequest: ISTEK })
        expect(acilis).not.toHaveBeenCalled()
        expect(page.currentPage).toBe('dapp_router')
        page.currentPage = 'home'
        await depoyaYaz({ current_request: { newValue: ISTEK } })
        expect(page.currentPage).toBe('dapp_router')
    }, 60000)

    it('satis ACIK ama adres ?ats-purchase=1 DEGIL: bugunku popup', async () => {
        const { page } = await pencereAc({ search: '', currentRequest: ISTEK })
        expect(acilis).not.toHaveBeenCalled()
        expect(page.currentPage).toBe('dapp_router')
    }, 60000)
})

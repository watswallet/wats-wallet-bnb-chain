// W-1 -- DAPP ONAY PENCERESINDE ONCEKI ISLEMIN DURUM KATMANI IMZA EKRANINI ORTMEZ.
//
// KOK NEDEN (canli QA kosusunda olculdu, 6230/6014 ms): `current_transactions`
// chrome.storage'ta PAYLASILIR. "Gonder, sonra hemen imzala" akisinda yeni acilan
// onay penceresi depodan onceki islemin 'success' kaydini okur ve App.vue'deki
// <TransactionStatus> (tam ekran, z-50) Imzala/Reddet dugmelerini SUCCESS_TTL_MS
// (6 sn) boyunca ortuyordu. Bir WalletConnect incelemecisi imza dugmesini
// goremiyordu.
//
// App.vue GERCEKTEN render edilir (dappApprovalSurface.test.js ile ayni SSR
// harness'i); olculen sey cizilen HTML'in kendisidir.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

const POPUP_YOLU = '/src/popup/index.html'
const EVM_AG = { chainId: 1, name: 'Ethereum', rpc: [{ url: 'https://rpc.example' }] }
const HESAP = { address: '0xAbC0000000000000000000000000000000000001', key: 'k1', type: 'hd' }

// TransactionStatus.vue'nin tam ekran kok katmaninin AYIRT EDICI sinif dizisi.
const DURUM_KATMANI = 'backdrop-blur-2xl'

const ESKI_ISLEM = [{
    id: 'eski', status: 'success', timestamp: 1,
    meta: { chainId: 1, amount: '1', symbol: 'ETH', type: 'Transaction' },
}]

async function appRender({ currentRequest = null }) {
    vi.resetModules()

    const depo = {
        vaults: [{ accounts: [HESAP] }],
        active_account: HESAP,
        imported_tokens: { [HESAP.key]: { 1: [], 56: [] } },
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
            onChanged: { addListener: () => {}, removeListener: () => {} },
        },
        runtime: {
            sendMessage: async (msg) => (msg?.type === 'CHECK_UNLOCK' ? { unlocked: true } : {}),
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
        location: { pathname: POPUP_YOLU, hash: '#window' },
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
    const { useTransactionStore } = await import('../store/transaction')
    const App = (await import('./App.vue')).default

    const app = createApp(App)
    app.use(createTestPinia())
    app.use(createTestI18n())
    // Onceki islemin kaydi: depodan okunmus gibi, render'dan ONCE.
    useTransactionStore().transactions = ESKI_ISLEM
    const html = await render(app)

    return { html, page: pageStore() }
}

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

describe('W-1 -- onay ekraninda eski islem durum katmani', () => {
    it.each([
        ['CONNECT', 'dapp_connect'],
        ['SEND_TX', 'dapp_router'],
        ['SIGN_MESSAGE', 'sign_message'],
        ['SIGN_TYPED_DATA', 'sign_typed_data'],
    ])('%s onayi bekliyorken durum katmani CIZILMEZ', async (type, sayfa) => {
        const { html, page } = await appRender({ currentRequest: { type, origin: 'https://dapp.example' } })

        expect(page.currentPage).toBe(sayfa)
        expect(html, 'eski islemin tam ekran katmani onay ekranini ortuyor').not.toContain(DURUM_KATMANI)
    }, 60000)

    it('KONTROL: onay yokken ayni kayit icin durum katmani CIZILIR (normal akis degismedi)', async () => {
        const { html, page } = await appRender({ currentRequest: null })

        expect(page.currentPage).toBe('home')
        expect(html).toContain(DURUM_KATMANI)
    }, 60000)
})

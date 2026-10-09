// B2 -- TonConnect UYARI penceresi ('#alert') App.vue'de.
//
// App.vue GERCEKTEN render edilir (bkz. dappApprovalSurface.test.js, ayni
// harness). Uyari penceresi YALNIZ uyariyi gosterir:
//  - cuzdan kilitliyken de gorunur (kilit ekranina dusmez, CHECK_UNLOCK yok),
//  - yeni bir dapp istegi onu IKINCI bir onay yuzeyine ceviremez,
//  - HEARTBEAT gondermez (kullanici etkinligi sayilir ve oturumu canli tutar).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// App.vue -> utils/dappFunctions.js zinciri MODUL UST DUZEYINDE
// chrome.windows.onRemoved.addListener cagirir (dappApprovalSurface.test.js).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import en from '../i18n/locales/en.json'

const POPUP_YOLU = '/src/popup/index.html'
const EVM_AG = { chainId: 1, name: 'Ethereum', rpc: [{ url: 'https://rpc.example' }] }
const HESAP = { address: '0xAbC0000000000000000000000000000000000001', key: 'k1', type: 'hd' }
const UYARI = {
    id: 'u-1', kind: 'network', hostname: 'app.dedust.io', appName: 'DeDust',
    requested: '-3', expected: '-239', network: '-239', createdAt: 1000, windowId: 9,
}
const KALP_ATISI_OLAYLARI = ['mousemove', 'click', 'keydown']

async function uygulamayiAc({ hash, unlocked = false }) {
    vi.resetModules()

    const degisimDinleyicileri = []
    const mesajlar = []
    const pencereOlaylari = []
    const depo = {
        vaults: [{ accounts: [HESAP] }],
        active_account: HESAP,
        imported_tokens: { [HESAP.key]: { 1: [], 56: [] } },
        currentNetwork: EVM_AG,
        ton_alert: UYARI,
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
            sendMessage: async (msg) => {
                mesajlar.push(msg)
                return msg?.type === 'CHECK_UNLOCK' ? { unlocked } : {}
            },
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
        location: { pathname: POPUP_YOLU, hash },
        document: sahteBelge,
        addEventListener: (ad) => pencereOlaylari.push(ad),
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
    // Suren bir islem: TransactionStatus cizilseydi uyarinin ustune balon binerdi.
    const tx = useTransactionStore()
    tx.transactions = [{ id: 'tx-1', status: 'processing', meta: { type: 'TonConnect', chainId: -239 } }]
    tx.isMinimized = true

    const html = await render(app)
    const page = pageStore()
    const depoyaYaz = async (changes) => {
        for (const fn of degisimDinleyicileri) await fn(changes, 'local')
    }
    return { page, html, mesajlar, pencereOlaylari, depoyaYaz }
}

const gorunur = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const dugmeSayisi = (html) => (gorunur(html).match(/<button\b/g) || []).length

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

describe("B2 -- '#alert' penceresi YALNIZ uyariyi gosterir", () => {
    it('kilitli cuzdanda da uyari ekranina acilir; CHECK_UNLOCK ve HEARTBEAT yok', async () => {
        const { page, html, mesajlar, pencereOlaylari } = await uygulamayiAc({ hash: '#alert', unlocked: false })

        expect(page.currentPage).toBe('ton_alert')
        expect(html).toContain(en.dapps.tonConnect.alert_title)
        expect(html).toContain(en.dapps.tonConnect.alert_network_title)
        expect(mesajlar.map((m) => m?.type)).not.toContain('CHECK_UNLOCK')
        for (const olay of KALP_ATISI_OLAYLARI) expect(pencereOlaylari).not.toContain(olay)
    }, 60000)

    it('uzerine islem durumu balonu binmez: tek dugme Kapat', async () => {
        const { html } = await uygulamayiAc({ hash: '#alert' })

        expect(dugmeSayisi(html)).toBe(1)
        expect(gorunur(html)).toContain(en.dapps.tonConnect.btn_close)
    }, 60000)

    it('yeni bir dapp istegi uyari penceresini onay ekranina CEVIREMEZ', async () => {
        const { page, depoyaYaz } = await uygulamayiAc({ hash: '#alert', unlocked: true })

        await depoyaYaz({ current_request: { newValue: { type: 'TON_SEND_TX', id: 'r-1' } } })

        expect(page.currentPage).toBe('ton_alert')
    }, 60000)

    // KONTROL: ayni harness onay penceresinde ('#window') eski akisi yurutur.
    it("'#window' penceresi kilit kontrolunu ve kalp atisini kurar (kontrol)", async () => {
        const { page, mesajlar, pencereOlaylari } = await uygulamayiAc({ hash: '#window', unlocked: false })

        expect(page.currentPage).toBe('welcome')
        expect(mesajlar.map((m) => m?.type)).toContain('CHECK_UNLOCK')
        for (const olay of KALP_ATISI_OLAYLARI) expect(pencereOlaylari).toContain(olay)
    }, 60000)
})

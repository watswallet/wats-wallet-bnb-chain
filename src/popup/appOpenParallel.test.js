// ACILIS YOLU PARALELLESTIRME KILIDI (hiz isi, 2026-11-07).
// Taban: App.vue onMounted dort bagimsiz beklemeyi SIRAYLA yapiyordu (storage.get vaults -> storage.get currentNetwork
// -> storage.get active_account -> CHECK_UNLOCK). Simdi kilit sorusu (arka plan uykudaysa uyandirma gerekir, en yavas
// halka) ve TEK bir depo okumasi birlikte baslar.
// DEGISMEYEN: yonlendirme (welcome / home / dapp) kilit sorusunun CEVABINDAN sonra verilir.
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
vi.mock('axios', () => ({ default: { get: async () => ({ status: 200, data: {} }), post: async () => ({ status: 200, data: {} }) } }))

const EVM_AG = { chainId: 1, name: 'Ethereum', rpc: [{ url: 'https://rpc.example' }] }
const HESAP = { address: '0xAbC0000000000000000000000000000000000001', key: 'k1', type: 'hd' }

async function hazirla({ vaults = [{ accounts: [HESAP] }], unlockCevabi }) {
    vi.resetModules()
    const olaylar = []
    const depo = { vaults, active_account: HESAP, currentNetwork: EVM_AG }
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const istenen = Array.isArray(keys) ? keys : [keys]
                    olaylar.push(`get:${istenen.join(',')}`)
                    await Promise.resolve()
                    olaylar.push(`get-bitti:${istenen.join(',')}`)
                    return Object.fromEntries(istenen.filter((k) => k in depo).map((k) => [k, depo[k]]))
                },
                set: async () => {},
                remove: async () => {},
            },
            onChanged: { addListener: () => {}, removeListener: () => {} },
        },
        runtime: {
            sendMessage: (msg) => {
                if (msg?.type !== 'CHECK_UNLOCK') return Promise.resolve({})
                olaylar.push('send:CHECK_UNLOCK')
                return unlockCevabi()
            },
            onMessage: { addListener: () => {}, removeListener: () => {} },
            getURL: (p) => p,
        },
        tabs: { create: () => {}, query: async () => [] },
        windows: { onRemoved: { addListener: () => {} }, getCurrent: async () => ({ id: 1 }) },
    }
    const belge = {
        addEventListener: () => {}, removeEventListener: () => {},
        createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
        querySelector: () => null,
        documentElement: { classList: { add: () => {}, remove: () => {}, contains: () => false } },
        visibilityState: 'hidden',
    }
    vi.stubGlobal('window', {
        location: { pathname: '/src/popup/index.html', hash: '' }, document: belge,
        addEventListener: () => {}, removeEventListener: () => {},
        matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
        performance: { now: () => Date.now() }, close: () => {},
    })
    vi.stubGlobal('document', belge)
    vi.stubGlobal('setInterval', () => 1)
    vi.stubGlobal('fetch', async () => ({ ok: true }))

    const { createApp, render, createTestPinia, createTestI18n } = await import('../test-utils/ssrRender.js')
    const { pageStore } = await import('../store/pageStore')
    const App = (await import('./App.vue')).default
    const app = createApp(App)
    app.use(createTestPinia())
    app.use(createTestI18n())
    return { olaylar, page: pageStore(), render: () => render(app) }
}

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

describe('App.vue acilis yolu', () => {
    it('kilit sorusu, depo okumasi BITMEDEN gonderilir ve depo uc ayri degil TEK okumayla yapilir', async () => {
        const { olaylar, render } = await hazirla({ unlockCevabi: async () => ({ unlocked: false }) })
        await render()

        const kasaBitti = olaylar.indexOf('get-bitti:vaults,currentNetwork,active_account')
        expect(kasaBitti).toBeGreaterThan(-1)
        expect(olaylar.indexOf('send:CHECK_UNLOCK')).toBeGreaterThan(-1)
        expect(olaylar.indexOf('send:CHECK_UNLOCK')).toBeLessThan(kasaBitti)
        const kasaOkumalari = olaylar.filter((o) => o.startsWith('get:') && o.includes('vaults'))
        expect(kasaOkumalari).toEqual(['get:vaults,currentNetwork,active_account'])
    }, 60000)

    it('yonlendirme kilit sorusunun cevabindan ONCE verilmez, sonra verilir (kilitli -> welcome)', async () => {
        let ac
        const cevap = new Promise((r) => { ac = () => r({ unlocked: false }) })
        const { page, render } = await hazirla({ unlockCevabi: () => cevap })
        const bitti = render()

        await new Promise((r) => setTimeout(r, 50))
        expect(page.currentPage).toBe('')

        ac()
        await bitti
        expect(page.currentPage).toBe('welcome')
    }, 60000)

    it('kasa yokken (onboarding) kilit cevabi beklenmez ve yetim red patlatmaz', async () => {
        const create = vi.fn()
        const { olaylar, page, render } = await hazirla({ vaults: [], unlockCevabi: () => Promise.reject(new Error('sw yok')) })
        globalThis.chrome.tabs.create = create
        await render()
        expect(create).toHaveBeenCalled()
        expect(page.currentPage).not.toBe('home')
        expect(olaylar).toContain('send:CHECK_UNLOCK')
    }, 60000)
})

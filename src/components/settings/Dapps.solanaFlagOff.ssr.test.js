// Bayrak KAPALIYKEN ayarlardaki Solana bolumu HIC cizilmez.
//
// Bu bolum zincir kaydina BAKMAZ: oturumlari dogrudan `chrome.storage.local`
// icindeki `solana_dapps`tan okur. Yani data/supportedChains filtresi burayi
// KAPATMAZ -- bayrak flip edildiginde eskiden kalma oturumlari olan bir
// kullanici bolumu gormeye devam eder ve "Baglantiyi kes" dugmesi arka plan
// kapisina carpip SESSIZCE hicbir sey yapmaz.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const ACCOUNT = { key: 'acc-1', address: '0xAaaa000000000000000000000000000000000001', name: 'Hesap A', type: 'hd' }
const SOLANA_SESSION = {
    address: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK',
    publicKey: '5f0e1a', accountKey: 'acc-1', cluster: 'solana:mainnet',
    appMeta: { name: 'Jupiter', icon: null },
    connectedAt: 1756700000,
}
const TON_SESSION = {
    address: '0:1111111111111111111111111111111111111111111111111111111111111111',
    publicKey: 'ab12', accountKey: 'acc-1', chain: '-239',
    manifest: { name: 'DeDust', url: 'https://app.dedust.io', iconUrl: null, manifestUrl: 'https://app.dedust.io/m.json', sameOrigin: true },
    connectedAt: 1756000000,
}

// Bayrak modul yuklenirken sabitlenir -> her senaryo resetModules + taze import.
async function ciz(bayrak, { solanaDapps = {}, tonDapps = {} } = {}) {
    vi.resetModules()
    vi.stubEnv('VITE_SOLANA_ENABLED', bayrak)
    const { createApp, render, installChromeStub, createTestPinia, createTestI18n } =
        await import('../../test-utils/ssrRender.js')
    const { pageStore } = await import('../../store/pageStore')
    const { default: Dapps } = await import('./Dapps.vue')

    // Global stub'lar import'lardan SONRA: @vue/runtime-dom modul kapsaminda
    // `document.createElement('template')` cagirir ve resetModules onu yeniden
    // yukler. Sahte document onceden kurulursa o satir coker; node ortaminda
    // `document` tanimsizken runtime-dom kendi null yoluna duser.
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })

    const stub = installChromeStub({
        active_account: ACCOUNT,
        dapps: {},
        ton_dapps: tonDapps,
        solana_dapps: solanaDapps,
        current_request: undefined,
    })
    stub.setSendMessage(async () => ({ success: true }))

    const app = createApp(Dapps)
    app.use(createTestPinia())
    app.use(createTestI18n())
    pageStore().currentPage = 'settings_dapps'
    return render(app)
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
    delete globalThis.chrome
})

describe('Dapps.vue (SSR) -- SOLANA_ENABLED kapali', () => {
    it('depoda Solana oturumu OLSA BILE bolum cizilmez', async () => {
        const html = await ciz('false', { solanaDapps: { 'https://jup.ag': SOLANA_SESSION } })
        expect(html).not.toContain('Solana Connections')
        expect(html).not.toContain('https://jup.ag')
    })

    it('TON oturumlari AYNEN cizilmeye devam eder -- kapi yalniz Solana bolumunu keser', async () => {
        const html = await ciz('false', { tonDapps: { 'app.dedust.io': TON_SESSION } })
        expect(html).toContain('app.dedust.io')
    })

    it('SADECE Solana oturumu varken ekran BOS DURUM gosterir -- yarim liste degil', async () => {
        const html = await ciz('false', { solanaDapps: { 'https://jup.ag': SOLANA_SESSION } })
        expect(html).not.toContain('https://jup.ag')
        // Bos durum metni bolumun gercekten dustugunu kanitlar: sayac Solana'yi
        // saymaya devam etseydi ekran "bagli site var" haliyle bos kalirdi.
        expect(html).toContain('No Connections')
    })

    it('bayrak ACIKKEN ayni oturum cizilir -- kapinin bayraga bagli oldugunu kanitlar', async () => {
        const html = await ciz('true', { solanaDapps: { 'https://jup.ag': SOLANA_SESSION } })
        expect(html).toContain('https://jup.ag')
    })
})

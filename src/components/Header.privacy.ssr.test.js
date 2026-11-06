// Gizli mod: Header baglantilari (kilit dugmesi, rozet, cekmece).
// Ayri dosya: PRIVACY_ENABLED derleme zamani sabiti, burada modul mock'uyla
// (degistirilebilir bir hoisted nesneyle) iki durumda da sinanir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const flags = vi.hoisted(() => ({ PRIVACY_ENABLED: true }))
vi.mock('../utils/featureFlags', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, get PRIVACY_ENABLED() { return flags.PRIVACY_ENABLED } }
})

// Header.vue -> utils/dappFunctions.js zinciri modul ust duzeyinde chrome.windows
// kullanir (ayni tuzak: Header.ssr.test.js).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { privacyStore } from '../store/privacy'
import Header from './Header.vue'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
// Rozet basligi uzun tire (U+2014) ile yazilir; kaynak ASCII kalsin diye kodla uretilir.
const DASH = String.fromCharCode(0x2014)

const NORMAL_A = { address: '0xAaaaAaaa00000000000000000000000000000001', key: 'a', name: 'Hesap A', type: 'hd', fingerprint: 'F1' }
const NORMAL_B = { address: '0xBbbbBbbb00000000000000000000000000000002', key: 'b', name: 'Hesap B', type: 'hd', fingerprint: 'F2' }
const GIZLI = { address: '0xCcccCccc00000000000000000000000000000003', key: 'p', name: 'Gizli Hesap', type: 'hd', fingerprint: 'F1', private: true }

beforeEach(() => {
    flags.PRIVACY_ENABLED = true
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup({ activeAccount, privateActive = false, vaults = [], chain = ETH_CHAIN, dapps = {} }) {
    const stub = installChromeStub({
        currentNetwork: chain,
        active_account: activeAccount,
        user: { username: 'tester' },
        vaults,
        dapps,
        ton_dapps: {},
        solana_dapps: {},
    })
    globalThis.chrome.tabs = { query: async () => [{ url: 'https://example.com' }] }
    const app = createApp(Header, { props: { dappMode: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    networkStore().currentNetwork = chain
    privacyStore().active = privateActive
    return { app, stub, captured: captureInstance(app, 'Header') }
}

describe('Header.vue (SSR) -- gizli mod', () => {
    it('bayrak aciksa kilit dugmesi GORUNUR (aria-pressed ile)', async () => {
        const { app } = setup({ activeAccount: NORMAL_A })
        const html = await render(app)
        expect(html).toContain('aria-pressed="false"')
        expect(html).toContain('Switch to private mode')
    })

    it('bayrak kapaliysa kilit dugmesi YOK', async () => {
        flags.PRIVACY_ENABLED = false
        const { app } = setup({ activeAccount: NORMAL_A })
        const html = await render(app)
        expect(html).not.toContain('aria-pressed')
        expect(html).not.toContain('Switch to private mode')
    })

    // Rozet 2026-10-09'da kaldirildi: mod hayalet ikonu + ton kaymasiyla belli olur.
    it('GIZLI rozeti iki modda da cizilmez', async () => {
        const gizli = await render(setup({ activeAccount: GIZLI, privateActive: true }).app)
        expect(gizli).not.toContain('>Private<')
        const normal = await render(setup({ activeAccount: NORMAL_A }).app)
        expect(normal).not.toContain('>Private<')
    })

    it('gizli modda cekmece YALNIZ aktif Gizli Hesap i listeler', async () => {
        const vaults = [{ fingerprint: 'F1', accounts: [NORMAL_A, GIZLI] }, { fingerprint: 'F2', accounts: [NORMAL_B] }]
        const { app, captured } = setup({ activeAccount: GIZLI, privateActive: true, vaults })
        await render(app)
        captured.instance.setupState.accounts = [NORMAL_A, GIZLI, NORMAL_B]
        const groups = captured.instance.setupState.groupedAccounts
        expect(groups).toHaveLength(1)
        expect(groups[0].accounts).toEqual([GIZLI])
    })

    it('gizli modda aktif hesap henuz yuklenmediyse cekmece BOS kalir, normal hesaplara dusmez', async () => {
        const { app, captured } = setup({ activeAccount: GIZLI, privateActive: true })
        await render(app)
        captured.instance.setupState.accounts = [NORMAL_A, NORMAL_B]
        captured.instance.setupState.activeAccount = null
        expect(captured.instance.setupState.groupedAccounts).toEqual([])
    })

    // Cekmecenin "Cuzdan ekle" / "Hesaplari yonet" dugmeleri gizli modda yeni hesap turetmeye ve normal hesap
    // listesine cikar; yeni hesap aktif olunca mod sessizce kapanir ve giris oncesi ag geri yuklenmez.
    it('gizli modda Cuzdan ekle ve Hesaplari yonet dugmeleri CIZILMEZ', async () => {
        const html = await render(setup({ activeAccount: GIZLI, privateActive: true }).app)
        expect(html).not.toContain('title="Add Wallet"')
        expect(html).not.toContain('title="Manage Accounts"')
    })

    it('normal modda Cuzdan ekle ve Hesaplari yonet dugmeleri cizilir (regresyon)', async () => {
        const html = await render(setup({ activeAccount: NORMAL_A }).app)
        expect(html).toContain('title="Add Wallet"')
        expect(html).toContain('title="Manage Accounts"')
    })

    it('normal modda cekmece tum hesap gruplarini listeler (regresyon)', async () => {
        const { app, captured } = setup({ activeAccount: NORMAL_A })
        await render(app)
        captured.instance.setupState.accounts = [NORMAL_A, NORMAL_B]
        const groups = captured.instance.setupState.groupedAccounts
        expect(groups.flatMap((g) => g.accounts.map((a) => a.key)).sort()).toEqual(['a', 'b'])
    })
})

// Cekmecede aktif hesabin avatar halkasi (grafit karari, kullanici 2026-10-26): indigo dolgu + kenar gizli modda notr
// rampaya eslenince acik temada kalin, kirli gri bir halka oluyordu. Gizli modda dolgusuz ince notr kenar; normal mod AYNI.
describe('Header.vue (SSR) -- cekmecede aktif hesap halkasi', () => {
    // Halkanin dinamik siniflari. Statik siniflar Header'da yalniz bu ogede var; SSR dinamik siniflari ONE yazdigi
    // icin sira varsayilmaz, statik kisim cikarilir.
    const STATIK = 'rounded-full transition-all duration-300 flex items-center justify-center'
    const halkalar = (html) =>
        [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1]).filter((c) => c.includes(STATIK)).map((c) => c.replace(STATIK, '').trim())

    it('KONTROL: normal modda aktif halka indigo dolgu + kenar, pasif hesap seffaf kenar (siniflar DEGISMEZ)', async () => {
        const vaults = [{ fingerprint: 'F1', accounts: [NORMAL_A] }, { fingerprint: 'F2', accounts: [NORMAL_B] }]
        const html = await render(setup({ activeAccount: NORMAL_A, vaults }).app)
        expect(halkalar(html)).toEqual([
            'p-0.75 bg-indigo-500/10 dark:bg-indigo-400/10 border border-indigo-500/30 dark:border-indigo-400/30',
            'p-0 border border-transparent',
        ])
    })

    it('gizli modda aktif halka dolgusuz ince notr kenar, indigo yok', async () => {
        const vaults = [{ fingerprint: 'F1', accounts: [NORMAL_A, NORMAL_B], privateAccount: GIZLI }]
        const html = await render(setup({ activeAccount: GIZLI, privateActive: true, vaults }).app)
        expect(halkalar(html)).toEqual(['p-0.75 border border-zinc-950/15 dark:border-white/20'])
    })
})

// C-M2: spec 4.2.1 Solana'yi giris agi sayar; kilit dugmesi ag kapisinin DISINDA.
describe('Header.vue (SSR) -- Solana agi', () => {
    it('Solana aktifken de kilit dugmesi GORUNUR', async () => {
        const { app } = setup({ activeAccount: NORMAL_A, chain: SOLANA_CHAIN })
        const html = await render(app)
        expect(html).toContain('aria-pressed="false"')
    })

    it('kontrol: Solana da dapp pill i hala gizli (yalniz kilit tasindi)', async () => {
        const { app } = setup({ activeAccount: NORMAL_A, chain: SOLANA_CHAIN })
        const html = await render(app)
        expect(html).not.toContain('Not Connected')
    })
})

// C-M1: gizli modda baglanti yuzeyi normal hesabin dapp oturumlarini gostermez/duzenlemez.
describe('Header.vue (SSR) -- gizli modda dapp baglanti yuzeyi', () => {
    const dapps = () => ({ 'example.com': { accounts: [NORMAL_A.address], allowedChains: [1], favicon: null } })

    it('kontrol: normal modda normal oturumlu site BAGLI gorunur', async () => {
        const { app, captured } = setup({ activeAccount: NORMAL_A, dapps: dapps() })
        const html = await render(app)
        expect(captured.instance.setupState.isConnected).toBe(true)
        expect(captured.instance.setupState.evmConnected).toBe(true)
        expect(html).toContain(DASH + ' Connected"')
    })

    it('gizli modda ayni site BAGLI DEGIL gorunur, izin duzenleyici ve baglantiyi kes calismaz', async () => {
        const { app, captured, stub } = setup({ activeAccount: GIZLI, privateActive: true, dapps: dapps() })
        const html = await render(app)
        const state = captured.instance.setupState
        expect(state.isConnected).toBe(false)
        expect(state.evmConnected).toBe(false)
        expect(html).not.toContain(DASH + ' Connected"')
        expect(html).toContain(DASH + ' Not Connected"')

        // Yazma yollari da bos haritayla kapali: normal sitenin kaydi DEGISMEZ.
        await state.savePermissions()
        await state.disconnectDapp()
        expect(stub.localStore.dapps).toEqual(dapps())
    })

    it('gizli modda otomatik allowedChains yazimi normal sitenin kaydina dokunmaz', async () => {
        const kayit = { 'example.com': { accounts: [NORMAL_A.address], allowedChains: [137], favicon: null } }
        const { app, stub } = setup({ activeAccount: GIZLI, privateActive: true, dapps: kayit })
        await render(app)
        // Aktif ag (1) allowedChains'te yok: normal modda otomatik eklenirdi.
        expect(stub.localStore.dapps['example.com'].allowedChains).toEqual([137])
    })
})

// Hesap menusundeki kopyala ikonu (son inceleme, 2026-10-27): gizli + koyu temada group-hover/copy:text-indigo-500 notr-500'e
// eslenip bostaki zinc-500 ile neredeyse ayni kaliyordu; kopyalama satirinin hover geri bildirimi kayboluyordu. Gizli modda
// koyu tema hover'i acik murekkep. Normal modda sinif eklenmez (koyu temada indigo hover aynen).
describe('Header.vue (SSR) -- hesap menusunde kopyala ikonu hover', () => {
    // SSR dinamik siniflari ONE yazar: sira varsayilmaz, ikon statik siniflarinin hepsini tasiyan ogedir.
    const IKON = ['shrink-0', 'text-slate-400', 'dark:text-zinc-500', 'group-hover/copy:text-indigo-500', 'transition-colors']
    const ikonlar = (html) => [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1].split(/\s+/).filter(Boolean)).filter((s) => IKON.every((k) => s.includes(k))).map((s) => s.sort())

    it('KONTROL: normal modda ikon siniflari aynen', async () => {
        const vaults = [{ fingerprint: 'F1', accounts: [NORMAL_A] }]
        const k = ikonlar(await render(setup({ activeAccount: NORMAL_A, vaults }).app))
        expect(k.length).toBeGreaterThan(0)
        for (const s of k) expect(s).toEqual([...IKON].sort())
    })

    it('gizli modda koyu tema hover acik murekkep', async () => {
        const vaults = [{ fingerprint: 'F1', accounts: [NORMAL_A, NORMAL_B], privateAccount: GIZLI }]
        const k = ikonlar(await render(setup({ activeAccount: GIZLI, privateActive: true, vaults }).app))
        expect(k.length).toBeGreaterThan(0)
        for (const s of k) expect(s).toEqual([...IKON, 'dark:group-hover/copy:text-zinc-100'].sort())
    })
})

// Gizli Takas / Kopru (kendine, SilentSwap) sayfalari: bayrak ACIKKEN App.vue private_swap ve private_bridge sayfalarini
// PrivateTransfer'a dogru mode ile baglar. Bayrak derleme sabitidir; vitest.config.js varsayilan olarak 'true' verir AMA bu
// dosya ona GUVENMEZ: asagida modullerden ONCE acikca 'true' yazilir ve ilk test bunu olcer (privateSwapBridgeClosure.test.js'in
// bayrak-kapali karsiti). PrivateTransfer, Swap ve Bridge mock'tur: ekran icerigi degil, HANGI ekranin baglandigi olculur.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.hoisted(() => {
    process.env.VITE_PRIVATE_SWAP_BRIDGE = 'true'
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        runtime: { onMessage: { addListener: () => {} }, sendMessage: async () => ({}) },
        storage: {
            local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
            onChanged: { addListener: () => {} },
        },
    }
})

vi.mock('../components/Swap.vue', async () => {
    const { h } = await import('vue')
    return { default: { name: 'Swap', render: () => h('div', { 'data-swap-screen': '' }) } }
})
vi.mock('../components/Bridge.vue', async () => {
    const { h } = await import('vue')
    return { default: { name: 'Bridge', render: () => h('div', { 'data-bridge-screen': '' }) } }
})
vi.mock('../components/privacy/PrivateTransfer.vue', async () => {
    const { h } = await import('vue')
    return {
        default: {
            name: 'PrivateTransfer',
            props: ['mode'],
            setup: (props) => () => h('div', { 'data-private-transfer-mode': props.mode }),
        },
    }
})

// PRIVATE_ATS_SALE derleme sabitidir; bu dosyada getter ile acilip kapatilir (privateSwapBridgeClosure.test.js deseni).
const bayrak = vi.hoisted(() => ({ privateAtsSale: true, satisCanli: true }))
vi.mock('../utils/featureFlags', async (importOriginal) => ({
    ...(await importOriginal()),
    get PRIVATE_ATS_SALE() { return bayrak.privateAtsSale },
}))
vi.mock('../utils/atsSaleConfig', async (importOriginal) => ({
    ...(await importOriginal()),
    isAtsSaleLive: () => bayrak.satisCanli,
}))

import { createApp, render, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { pageStore } from '../store/pageStore'
import { privacyStore } from '../store/privacy'
import { PRIVATE_SWAP_BRIDGE } from '../utils/featureFlags'
import App from './App.vue'

function renderApp({ sayfa, gizli }) {
    const pinia = createTestPinia()
    pageStore().currentPage = sayfa
    pageStore().firstLoadDone = true
    privacyStore().active = gizli
    const app = createApp(App)
    app.use(pinia)
    app.use(createTestI18n())
    return render(app)
}

afterEach(() => { bayrak.privateAtsSale = true; bayrak.satisCanli = true })

describe('Gizli Takas / Kopru sayfa kayitlari (bayrak ACIK, gizli mod)', () => {
    it('ortam: bayrak bu dosyada gercekten acik', () => {
        expect(PRIVATE_SWAP_BRIDGE).toBe(true)
    })

    it('private_swap sayfasi, gizli mod, bayrak ACIK: PrivateTransfer mode=swap baglanir', async () => {
        const html = await renderApp({ sayfa: 'private_swap', gizli: true })
        expect(html).toContain('data-private-transfer-mode="swap"')
        expect(html).not.toContain('data-private-transfer-mode="bridge"')
    })

    it('private_bridge sayfasi, gizli mod, bayrak ACIK: PrivateTransfer mode=bridge baglanir', async () => {
        const html = await renderApp({ sayfa: 'private_bridge', gizli: true })
        expect(html).toContain('data-private-transfer-mode="bridge"')
        expect(html).not.toContain('data-private-transfer-mode="swap"')
    })

    it('bu iki sayfada klasik Takas ve Kopru ekranlari BAGLANMAZ (kontrol: klasik bridge sayfasi normal modda mock\'u cizer)', async () => {
        for (const sayfa of ['private_swap', 'private_bridge']) {
            const html = await renderApp({ sayfa, gizli: true })
            expect(html, sayfa).not.toContain('data-swap-screen')
            expect(html, sayfa).not.toContain('data-bridge-screen')
        }
        // Pozitif kontrol: ayni kurulum klasik 'bridge' sayfasini normal modda baglar, yani "yok" iddialari bos degil.
        expect(await renderApp({ sayfa: 'bridge', gizli: false })).toContain('data-bridge-screen')
    })

    it('KONTROL: private_send sayfasi ayni mock ile mode=send baglar (isaretleyici calisiyor)', async () => {
        expect(await renderApp({ sayfa: 'private_send', gizli: true })).toContain('data-private-transfer-mode="send"')
    })
})

describe('Klasik Takas / Kopru, gizli mod, bayrak ACIK: bayrak klasik ekrani ACMAZ (Task 12)', () => {
    it('bridge sayfasi, gizli mod, bayrak ACIK: Kopru ekrani YOK (alim acik de olsa, kapali da olsa)', async () => {
        expect(await renderApp({ sayfa: 'bridge', gizli: true })).not.toContain('data-bridge-screen')
        bayrak.privateAtsSale = false
        expect(await renderApp({ sayfa: 'bridge', gizli: true })).not.toContain('data-bridge-screen')
    })

    it('swap sayfasi, gizli mod, bayrak ACIK, ATS alimi KAPALI (PRIVATE_ATS_SALE=false, uretim): Takas ekrani YOK', async () => {
        bayrak.privateAtsSale = false
        expect(await renderApp({ sayfa: 'swap', gizli: true })).not.toContain('data-swap-screen')
    })

    it('swap sayfasi, gizli mod, bayrak ACIK, alim acik AMA satis canli degil: Takas ekrani YOK', async () => {
        bayrak.satisCanli = false
        expect(await renderApp({ sayfa: 'swap', gizli: true })).not.toContain('data-swap-screen')
    })

    it('swap sayfasi, gizli mod, bayrak ACIK, alim acik + satis canli: Takas ekrani baglanir (Swap mock; tam takas mi yalniz satis mi: SwapPrivateSaleOnly.ssr.test.js)', async () => {
        expect(await renderApp({ sayfa: 'swap', gizli: true })).toContain('data-swap-screen')
    })

    it('KONTROL: normal mod, bayrak ACIK: Takas ve Kopru ekranlari baglanir', async () => {
        expect(await renderApp({ sayfa: 'swap', gizli: false })).toContain('data-swap-screen')
        expect(await renderApp({ sayfa: 'bridge', gizli: false })).toContain('data-bridge-screen')
    })
})

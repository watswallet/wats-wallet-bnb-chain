// KLASIK TAKAS / KOPRU KILIDI: gizli modda klasik Takas (swap) ve Kopru (bridge) ekranlari VITE_PRIVATE_SWAP_BRIDGE'nin DEGERINDEN
// BAGIMSIZ kapalidir (App.vue swapBridgeShown = !privacy.active, Swap.vue saleOnlyMode = privacy.active). Bayrak artik yalniz kendine
// Takas/Kopru (SilentSwap) sayfalarini (private_swap, private_bridge) ve kapidaki dar SAME_ADDRESS istisnasini acar; klasik ekranlari ACMAZ.
// Bu dosya bayrak KAPALI (uretim degeri) kosar; bayrak ACIK karsiti ve klasik ekranlarin yine kapali kaldigi kilit: privateSwapBridgeFlagOn.test.js.
// ISTISNA (2026-10-31, "ATS al bos ekran"): gizli modda Gonder -> "ATS al" Takas ekranini acar (satin alma ekrani Takas'in KENDISIDIR).
// Gizli Hesap kendi ATS alimini yapabildigi surece (PRIVATE_ATS_SALE acik VE satis canli) 'swap' sayfasi Takas'i "yalniz ATS satin alma"
// kipinde baglar (Swap.vue saleOnlyMode); Kopru HER ZAMAN kapali kalir. Satis kapaliysa (uretim bugun) Takas yine YOK.
// Dugme kapisi (Home / Token / PrivateTransfer) yetmez: bir sayfa gecisi ya da eski durum ekrani baglamasin diye EKRAN seviyesinde de
// kapali (StockTrade ile ayni desen, bkz. privateStockClosure.test.js). Uc katman:
//   (a) KAYNAK: App.vue sablonu klasik ekranlari yalniz gizli mod kosuluyla baglar, Swap.vue kipi gizli moda baglar; ikisi de bayrak sabitine BAKMAZ;
//   (b) CALISMA: bayrak kapaliyken gizli modda 'swap' / 'bridge' sayfasi hicbir sey baglamaz;
//   (c) KONTROL: ayni kurulum normal modda ekrani baglar (yoksa "yok" iddiasi bos gecerdi).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz, saltKod } from '../test-utils/kaynakTarama'

vi.hoisted(() => {
    // Bayrak derleme sabitidir; vitest.config.js testlerde 'true' verir, burada modullerden ONCE kapatilir.
    process.env.VITE_PRIVATE_SWAP_BRIDGE = 'false'
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        runtime: { onMessage: { addListener: () => {} }, sendMessage: async () => ({}) },
        storage: {
            local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
            onChanged: { addListener: () => {} },
        },
    }
})

// PRIVATE_ATS_SALE derleme sabitidir; bu dosyada getter ile acilip kapatilir (SwapAtsSale.ssr.test.js deseni).
const bayrak = vi.hoisted(() => ({ privateAtsSale: true, satisCanli: true }))
vi.mock('../utils/featureFlags', async (importOriginal) => ({
    ...(await importOriginal()),
    get PRIVATE_ATS_SALE() { return bayrak.privateAtsSale },
}))
vi.mock('../utils/atsSaleConfig', async (importOriginal) => ({
    ...(await importOriginal()),
    isAtsSaleLive: () => bayrak.satisCanli,
}))

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

import { createApp, render, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { pageStore } from '../store/pageStore'
import { privacyStore } from '../store/privacy'
import { PRIVATE_SWAP_BRIDGE } from '../utils/featureFlags'
import App from './App.vue'

const SRC = fileURLToPath(new URL('../', import.meta.url))
const oku = (yol) => yorumsuz(readFileSync(SRC + yol, 'utf8'))

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

afterEach(() => { vi.unstubAllGlobals(); bayrak.privateAtsSale = true; bayrak.satisCanli = true })

describe('1.10 (a): kaynak -- klasik Takas / Kopru gizli modda bayraktan bagimsiz kapali; private_swap / private_bridge ayri sayfalardir', () => {
    it('App.vue sablonu klasik Swap ve Bridge\'i yalniz gizli mod kosuluyla baglar (bayrak sabitine bakmaz)', () => {
        const sablon = oku('popup/App.vue').split('<script')[0]
        expect(sablon).toMatch(/<Swap v-if="swapShown && page\.currentPage === 'swap'"/)
        expect(sablon).toMatch(/<Bridge v-if="swapBridgeShown && page\.currentPage === 'bridge'"/)
        expect(oku('popup/App.vue')).toMatch(/const swapBridgeShown = computed\(\(\) => !privacy\.active\)/)
        // Satir kapsamli olumsuz kilit (bilerek): sablondaki private_swap / private_bridge v-if'leri PRIVATE_SWAP_BRIDGE'yi baska yerde okur.
        expect(oku('popup/App.vue')).not.toMatch(/const swap(?:Bridge)?Shown = computed\([^\n]*PRIVATE_SWAP_BRIDGE/)
        // Takas ayrica "yalniz ATS satin alma" kapisiyla da baglanir (gizli mod + alim acik + satis canli); Kopru bu kapiya BAKMAZ.
        expect(oku('popup/App.vue')).toMatch(/const swapShown = computed\([^\n]*swapBridgeShown\.value[^\n]*privacy\.active[^\n]*atsPurchaseBlocked\(privacy\)[^\n]*isAtsSaleLive\(\)/)
    })

    it('Swap.vue "yalniz ATS satin alma" kipi gizli moda baglidir ve bayrak sabitini HIC okumaz', () => {
        const kod = saltKod(readFileSync(SRC + 'components/Swap.vue', 'utf8'))
        expect(kod).toMatch(/const saleOnlyMode = computed\(\(\) => privacy\.active\)/)
        expect(kod).not.toContain('PRIVATE_SWAP_BRIDGE')
        // Pozitif kontrol: tarama script'i gercekten gordu (yoksa "icermez" iddiasi bos gecerdi).
        expect(kod).toContain('PRIVATE_ATS_SALE')
    })

    it('App.vue sablonu private_swap ve private_bridge sayfalarini YALNIZ bayrak kosuluyla baglar (privacy.active kosulu yok: koruma PRIVATE_PAGES)', () => {
        const sablon = oku('popup/App.vue').split('<script')[0]
        expect(sablon).toMatch(/<PrivateTransfer v-if="PRIVATE_SWAP_BRIDGE && page\.currentPage === 'private_swap'" mode="swap"><\/PrivateTransfer>/)
        expect(sablon).toMatch(/<PrivateTransfer v-if="PRIVATE_SWAP_BRIDGE && page\.currentPage === 'private_bridge'" mode="bridge"><\/PrivateTransfer>/)
        const satirlar = sablon.split(/\r?\n/).filter((s) => s.includes("'private_swap'") || s.includes("'private_bridge'"))
        expect(satirlar).toHaveLength(2)
        for (const satir of satirlar) expect(satir).not.toContain('privacy.active')
    })

    it('gizli modda Takas/Kopru\'ye goturen iki yer bayrak sabitini okur: Home, Token', () => {
        for (const yol of ['components/Home.vue', 'components/Token.vue']) {
            expect(oku(yol), yol).toContain("import { ")
            expect(oku(yol), yol).toMatch(/PRIVATE_SWAP_BRIDGE[^\n]*from '(?:\.\.\/)+utils\/featureFlags'/)
        }
    })

    it('Token.vue: KLASIK Takas/Kopru dugmeleri gizli modda bayraktan bagimsiz kapali (swapBridgeShown = !privacy.active)', () => {
        const token = oku('components/Token.vue')
        // Buyuk/kucuk harfe duyarli: privateSwapShown / privateBridgeShown / privateSourceAsset bu kalibi ESLESTIRMEZ.
        expect(token).toMatch(/const swapBridgeShown = computed\(\(\) => !privacy\.active\)/)
        expect(token).not.toMatch(/const swapBridgeShown = computed\([^\n]*PRIVATE_SWAP_BRIDGE/)
    })

    it('uretimde bayrak acik: .env.production true (1.10, sahip karari 2026-11-06; satir silinirse kilit kirmizi olur)', () => {
        const ham = readFileSync(SRC + '../.env.production', 'utf8')
        expect(ham).toMatch(/^VITE_PRIVATE_SWAP_BRIDGE=true\r?$/m)
    })

    it('gelistirmede bayrak acik: .env.development true (sahip Takas/Kopru akisini deneyebilsin)', () => {
        const ham = readFileSync(SRC + '../.env.development', 'utf8')
        expect(ham).toMatch(/^VITE_PRIVATE_SWAP_BRIDGE=true\r?$/m)
    })
})

describe('1.10 (b): bayrak kapali, gizli mod -- Takas ve Kopru ekranlari baglanmaz', () => {
    it('onkosul: bu dosyada bayrak gercekten kapali', () => {
        expect(PRIVATE_SWAP_BRIDGE).toBe(false)
    })

    it('swap sayfasi, gizli mod, ATS alimi KAPALI (PRIVATE_ATS_SALE=false, uretim): Takas ekrani YOK', async () => {
        bayrak.privateAtsSale = false
        expect(await renderApp({ sayfa: 'swap', gizli: true })).not.toContain('data-swap-screen')
    })

    it('swap sayfasi, gizli mod, alim acik AMA satis canli degil: Takas ekrani YOK', async () => {
        bayrak.satisCanli = false
        expect(await renderApp({ sayfa: 'swap', gizli: true })).not.toContain('data-swap-screen')
    })

    it('bridge sayfasi, gizli mod: Kopru ekrani YOK (alim acik de olsa)', async () => {
        expect(await renderApp({ sayfa: 'bridge', gizli: true })).not.toContain('data-bridge-screen')
        bayrak.privateAtsSale = false
        expect(await renderApp({ sayfa: 'bridge', gizli: true })).not.toContain('data-bridge-screen')
    })
})

describe('Gizli Takas / Kopru sayfalari (private_swap, private_bridge): bayrak KAPALI, gizli mod -- hicbir sey baglanmaz', () => {
    it('onkosul: bu dosyada bayrak gercekten kapali', () => {
        expect(PRIVATE_SWAP_BRIDGE).toBe(false)
    })

    it('private_swap ve private_bridge sayfalari, gizli mod, bayrak KAPALI: PrivateTransfer baglanmaz', async () => {
        for (const sayfa of ['private_swap', 'private_bridge']) {
            expect(await renderApp({ sayfa, gizli: true }), sayfa).not.toContain('data-private-transfer-mode')
        }
    })

    it('KONTROL: private_send sayfasi ayni mock ile mode=send baglar (yok iddiasi bos degil)', async () => {
        expect(await renderApp({ sayfa: 'private_send', gizli: true })).toContain('data-private-transfer-mode="send"')
    })
})

describe('2026-10-31: gizli modda "ATS al" -- alim acik + satis canli iken Takas (yalniz ATS satin alma) BAGLANIR', () => {
    it('swap sayfasi, gizli mod, alim acik + satis canli: Takas ekrani VAR (bos ekran hatasi)', async () => {
        expect(await renderApp({ sayfa: 'swap', gizli: true })).toContain('data-swap-screen')
    })
})

describe('1.10 (c): KONTROL -- normal modda Takas ve Kopru ekranlari baglanir', () => {
    it('swap sayfasi, normal mod: Takas ekrani var', async () => {
        expect(await renderApp({ sayfa: 'swap', gizli: false })).toContain('data-swap-screen')
    })

    it('bridge sayfasi, normal mod: Kopru ekrani var', async () => {
        expect(await renderApp({ sayfa: 'bridge', gizli: false })).toContain('data-bridge-screen')
    })
})

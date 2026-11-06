// Home.vue (SSR) -- 1.10: VITE_PRIVATE_SWAP_BRIDGE ACIK iken gizli eylem satiri Takas ve Kopru dugmelerini STATIK kullanilabilirlik
// kosullariyla gosterir (selfSwapSourceChains / selfBridgeTargets, FUND listesi); etkin aga ve canSwap / bridgeActionVisible'a
// BAKMAZ. Dugmeler klasik ekrani degil private_swap / private_bridge ekranlarini acar. Bayrak kapaliyken kilit
// Home.privateSwapBridgeClosed.ssr.test.js dosyasindadir.
// Bayrak derleme sabitidir: vi.hoisted ile modullerden ONCE acilir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.hoisted(() => {
    // Bayrak derleme sabitidir; vitest.config.js testlerde zaten 'true' verir, bu dosya ona BAGLI DEGILDIR
    // ve bayragi modullerden ONCE acikca acar. (import.meta.env burada kullanilamaz: yalniz process.env.)
    process.env.VITE_PRIVATE_SWAP_BRIDGE = 'true'
})

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: async () => [] }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))
vi.mock('axios', () => ({
    default: {
        post: async () => ({ status: 200, data: { tokens: [] } }),
        get: async () => ({ status: 200, data: { news: [] } }),
    },
}))
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, JsonRpcProvider: class { destroy() {} } }
})
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: async () => true }))
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { yorumsuz } from '../test-utils/kaynakTarama'
import { networkStore } from '../store/network'
import { privacyStore } from '../store/privacy'
import { tokenScopeStore } from '../store/tokenScope'
import { setLocalLogosOnly } from '../utils/tokenLogo'
import { PRIVATE_SWAP_BRIDGE } from '../utils/featureFlags'
import Home from './Home.vue'
import supported_chains from '../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const SOLANA = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const SOLANA_ADRESI = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const NORMAL = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', type: 'hd', name: 'Hesap 1' }
const GIZLI = { address: '0xCcccCccc00000000000000000000000000000003', key: 'private-0xcccccccc00000000000000000000000000000003', type: 'hd', private: true, name: 'Gizli Hesap' }

beforeEach(() => { vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} }) })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); setLocalLogosOnly(false); delete globalThis.chrome })

async function mountHome({ gizli, ag = BSC, solanaAdresi } = {}) {
    const hesap = gizli ? GIZLI : { ...NORMAL, ...(solanaAdresi ? { solanaAddress: solanaAdresi } : {}) }
    installChromeStub({ currentNetwork: ag, active_account: hesap, imported_tokens: { [hesap.key]: {} }, vaults: [{ accounts: [NORMAL], privateAccount: GIZLI }] })
        .setSendMessage(async () => ({}))
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = ag
    networkStore().rpc = ag.rpc?.[0]?.url
    privacyStore().active = gizli
    tokenScopeStore().filter = 'all'
    setLocalLogosOnly(gizli)
    const captured = captureInstance(app, 'Home')
    const html = await render(app)
    return { html, state: captured.instance.setupState }
}

const sekmeCubugu = (html) => html.indexOf('pt-5 pb-0 border-b')
const altSira = (html) => html.match(/<div[^>]*data-private-secondary[^>]*>/)?.[0] ?? ''
const kutular = (html) => html.slice(html.indexOf('data-private-actions'), sekmeCubugu(html))
const homeKaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./Home.vue', import.meta.url)), 'utf8'))

// Teslimat listeleri cagri aninda okunur: vi.resetModules / modul mock'u gerekmez.
function aglariAc(liste) {
    vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', liste)
    vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', liste)
}

describe('Home.vue (SSR) -- PRIVATE_SWAP_BRIDGE acik: Takas ve Kopru gizli ekranlara gider', () => {
    it('ortam: bayrak bu dosyada gercekten acik', () => {
        expect(PRIVATE_SWAP_BRIDGE).toBe(true)
    })

    it('gizli modda, varsayilan ag listeleriyle: Takas ve Kopru dugmeleri gorunur; Gonder, Al, Para yukle de durur; alt sira 3 sutun', async () => {
        const { html, state } = await mountHome({ gizli: true })
        for (const metin of ['>Send<', '>Receive<', '>Add funds<', '>Swap<', '>Bridge<']) expect(kutular(html)).toContain(metin)
        expect(altSira(html)).toMatch(/\bgrid-cols-3\b/)
        expect(altSira(html)).not.toMatch(/\bgrid-cols-1\b/)
        expect(state.privateSwapVisible).toBe(true)
        expect(state.privateBridgeVisible).toBe(true)
        expect(state.privateActionRowClass).toBe('grid-cols-3')
    })

    it('dugmelerin tiklama hedefi private_swap ve private_bridge; klasik ekrana ve goToBridge e gitmez (kaynak kilidi)', () => {
        const bolum = homeKaynak.slice(homeKaynak.indexOf('data-private-actions'), homeKaynak.indexOf('pt-5 pb-0 border-b'))
        // Pozitif kontroller: bolum bos degil ve Para yukle dugmesi icinde.
        expect(bolum.length).toBeGreaterThan(0)
        expect(bolum).toContain(`page.currentPage = 'private_fund'`)
        expect(bolum).toMatch(/v-if="privateSwapVisible"[^>]*@click="page\.currentPage = 'private_swap'"/)
        expect(bolum).toMatch(/v-if="privateBridgeVisible"[^>]*@click="page\.currentPage = 'private_bridge'"/)
        expect(bolum).not.toMatch(/currentPage = '(swap|bridge)'/)
        expect(bolum).not.toContain('goToBridge')
        // Ikinci kontrol: normal satir degismedi, yukaridaki yokluk bos gecmiyor.
        expect(homeKaynak).toContain('@click="goToBridge"')
        expect(homeKaynak).toContain('v-if="canSwap"')
    })

    it('gizli modda dugmeler etkin aga, canSwap a ve bridgeActionVisible a BAKMAZ (Solana aktif)', async () => {
        const { html, state } = await mountHome({ gizli: true, ag: SOLANA })
        expect(state.canSwap).toBe(false)
        expect(state.bridgeActionVisible).toBe(false)
        expect(state.privateSwapVisible).toBe(true)
        expect(state.privateBridgeVisible).toBe(true)
        expect(kutular(html)).toContain('>Swap<')
        expect(kutular(html)).toContain('>Bridge<')
        expect(altSira(html)).toMatch(/\bgrid-cols-3\b/)
        // KONTROL: klasik kapilar Solana'da gercekten kapali, yukaridaki dugmeler onlardan gelmiyor.
        const normal = await mountHome({ gizli: false, ag: SOLANA, solanaAdresi: SOLANA_ADRESI })
        expect(normal.html).not.toContain('>Swap<')
        expect(normal.html).not.toContain('>Bridge<')
    })

    it('FUND listesi yalniz 56: Takas YOK (tek varlikli ag), Kopru VAR (baska kaynaktan BSC ye); alt sira 2 sutun', async () => {
        aglariAc('56')
        const { html, state } = await mountHome({ gizli: true })
        expect(state.privateSwapVisible).toBe(false)
        expect(state.privateBridgeVisible).toBe(true)
        expect(kutular(html)).toContain('>Bridge<')
        expect(kutular(html)).toContain('>Add funds<')
        expect(kutular(html)).not.toContain('>Swap<')
        expect(altSira(html)).toMatch(/\bgrid-cols-2\b/)
    })

    it('FUND listesi bos: Takas YOK, Kopru YOK; alt sira 1 sutun, Para yukle kalir', async () => {
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '')
        const { html, state } = await mountHome({ gizli: true })
        expect(state.privateSwapVisible).toBe(false)
        expect(state.privateBridgeVisible).toBe(false)
        for (const metin of ['>Send<', '>Receive<', '>Add funds<']) expect(kutular(html)).toContain(metin)
        expect(kutular(html)).not.toContain('>Swap<')
        expect(kutular(html)).not.toContain('>Bridge<')
        expect(altSira(html)).toMatch(/\bgrid-cols-1\b/)
        expect(altSira(html)).not.toMatch(/\bgrid-cols-[2-5]\b/)
    })

    it('FUND listesi 56 ve 1: Takas geri gelir (Ethereum cok varlikli), Kopru durur; alt sira 3 sutun', async () => {
        aglariAc('56,1')
        const { html, state } = await mountHome({ gizli: true })
        expect(state.privateSwapVisible).toBe(true)
        expect(state.privateBridgeVisible).toBe(true)
        expect(kutular(html)).toContain('>Swap<')
        expect(kutular(html)).toContain('>Bridge<')
        expect(altSira(html)).toMatch(/\bgrid-cols-3\b/)
    })

    it('KONTROL: normal modda Takas ve Kopru eski kapilarla durur (4 sutun); FUND listesi bos olsa da degismez', async () => {
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '')
        const { html } = await mountHome({ gizli: false })
        expect(html).toContain('class="grid-cols-4 grid gap-3 px-6 pb-8"')
        expect(html).toContain('>Swap<')
        expect(html).toContain('>Bridge<')
        expect(html).not.toContain('data-private-actions')
    })
})

// Home.vue (SSR) -- 1.10: VITE_PRIVATE_SWAP_BRIDGE KAPALI iken gizli modda Takas ve Kopru dugmeleri CIZILMEZ (Gonder, Al, Para yukle
// kalir; alt sira 1 sutun). NORMAL MOD ETKILENMEZ: eylem satirinda Takas ve Kopru durur (4 sutun).
// Bayrak derleme sabitidir: vi.hoisted ile modullerden ONCE kapatilir (vitest.config.js testlerde 'true' verir).
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.hoisted(() => {
    // Bayrak derleme sabitidir; vitest.config.js testlerde 'true' verir, burada modullerden ONCE kapatilir.
    // (import.meta.env burada kullanilamaz: yalniz process.env ile ayni degeri vi.stubEnv verir.)
    process.env.VITE_PRIVATE_SWAP_BRIDGE = 'false'
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

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { privacyStore } from '../store/privacy'
import { tokenScopeStore } from '../store/tokenScope'
import { setLocalLogosOnly } from '../utils/tokenLogo'
import { PRIVATE_SWAP_BRIDGE } from '../utils/featureFlags'
import Home from './Home.vue'
import supported_chains from '../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const NORMAL = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', type: 'hd', name: 'Hesap 1' }
const GIZLI = { address: '0xCcccCccc00000000000000000000000000000003', key: 'private-0xcccccccc00000000000000000000000000000003', type: 'hd', private: true, name: 'Gizli Hesap' }

beforeEach(() => { vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} }) })
afterEach(() => { vi.unstubAllGlobals(); setLocalLogosOnly(false); delete globalThis.chrome })

async function mountHome({ gizli }) {
    const hesap = gizli ? GIZLI : NORMAL
    installChromeStub({ currentNetwork: BSC, active_account: hesap, imported_tokens: { [hesap.key]: {} }, vaults: [{ accounts: [NORMAL], privateAccount: GIZLI }] })
        .setSendMessage(async () => ({}))
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = BSC
    networkStore().rpc = BSC.rpc[0].url
    privacyStore().active = gizli
    tokenScopeStore().filter = 'all'
    setLocalLogosOnly(gizli)
    return render(app)
}

const sekmeCubugu = (html) => html.indexOf('pt-5 pb-0 border-b')
const altSira = (html) => html.match(/<div[^>]*data-private-secondary[^>]*>/)?.[0] ?? ''

describe('Home.vue (SSR) -- PRIVATE_SWAP_BRIDGE kapali (1.10)', () => {
    it('ortam: bayrak bu dosyada gercekten kapali (aksi halde asagidaki iddialar bos gecer)', () => {
        expect(PRIVATE_SWAP_BRIDGE).toBe(false)
    })

    it('gizli modda Takas ve Kopru dugmeleri YOK; Gonder, Al, Para yukle kalir; alt sira 1 sutun', async () => {
        const html = await mountHome({ gizli: true })
        const kutular = html.slice(html.indexOf('data-private-actions'), sekmeCubugu(html))
        expect(kutular).not.toContain('>Swap<')
        expect(kutular).not.toContain('>Bridge<')
        for (const metin of ['>Send<', '>Receive<', '>Add funds<']) expect(kutular).toContain(metin)
        expect(altSira(html)).toMatch(/\bgrid-cols-1\b/)
        expect(altSira(html)).not.toMatch(/\bgrid-cols-[2-5]\b/)
    })

    it('KONTROL: normal modda Takas ve Kopru dugmeleri durur, eylem satiri 4 sutun', async () => {
        const html = await mountHome({ gizli: false })
        expect(html).toContain('class="grid-cols-4 grid gap-3 px-6 pb-8"')
        expect(html).toContain('>Swap<')
        expect(html).toContain('>Bridge<')
    })
})

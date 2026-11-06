// bridgeFrom.vue (SSR) -- GIZLI MOD arama vurgusu (grafit dili, kullanici karari 2026-10-26: gizli modda hicbir sey
// mor gorunmez). style.css gizli modda indigo'yu notr griye esler; indigo vurgulu harfler bu yuzden cevredeki yazidan
// SONUK kaliyordu. Gizli modda vurgu renkle degil kalinlik + alt cizgiyle yapilir; arama metninin regex kacisi aynen kalir.
// Normal modda vurgu BIREBIR eskisi gibi: her iddianin bir KONTROL cifti vardir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../../composables/useTokenBalance', () => ({ useTokenBalance: (...a) => useTokenBalanceMock(...a) }))

// Kaynak listesi LI.FI'den (axios.get) gelir ve testten verilir; fiyat ucu (axios.post) bos doner.
const { lifiListesi } = vi.hoisted(() => ({ lifiListesi: { tokens: {} } }))
vi.mock('axios', () => ({
    default: {
        get: vi.fn(async () => ({ status: 200, data: lifiListesi })),
        post: vi.fn(async () => ({ status: 200, data: { tokens: [] } })),
    },
}))

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { networkStore } from '../../store/network'
import { privacyStore } from '../../store/privacy'
import BridgeFrom from './bridgeFrom.vue'
import supported_chains from '../../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const HESAP = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }
const USDT_BSC = { name: 'Tether USD', symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 }

// Normal modun degisiklikten ONCEKI vurgusu, harfi harfine.
const NORMAL_VURGU = '<span class="text-indigo-400 font-bold bg-indigo-500/10 px-0.5 rounded">'
const GIZLI_VURGU = '<span class="font-bold text-zinc-950 dark:text-white underline decoration-zinc-400 dark:decoration-zinc-500 underline-offset-2">'
const MOR = /\b(violet|purple|indigo|fuchsia)-\d/

// Sablon yorumlari SSR ciktisina girer; iddialar yorumsuz HTML uzerinde kurulur.
const yorumsuz = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
// "USD" eslesmesini saran span'lerin siniflari (ad ve sembol satirlari).
const usdVurgulari = (html) => [...yorumsuz(html).matchAll(/<span class="([^"]*)">USD<\/span>/g)].map((m) => m[1])

afterEach(() => {
    lifiListesi.tokens = {}
    useTokenBalanceMock.mockClear()
    delete globalThis.chrome
})

/** `gizli`: privacyStore().active (installPrivacySync'in yaptigi gibi). `arama`: arama kutusu, render'dan ONCE yazilir. */
async function kur({ gizli, arama = '' }) {
    installChromeStub({ currentNetwork: BSC, active_account: HESAP })
    lifiListesi.tokens = { 56: [USDT_BSC] }
    const app = createApp(BridgeFrom)
    app.use(createTestPinia())
    app.use(createTestI18n())
    networkStore().currentNetwork = BSC
    networkStore().rpc = BSC.rpc[0].url
    privacyStore().active = gizli
    const holder = captureInstance(app, 'bridgeFrom', (instance) => {
        instance.setupState.searchQuery = arama
    })
    const html = await render(app)
    return { html, state: holder.instance.setupState }
}

describe('bridgeFrom.vue (SSR) -- gizli modda arama vurgusu renk degil kalinlik + alt cizgi', () => {
    it('KONTROL: normal modda ad ve sembol satirinda vurgu indigo, span BIREBIR eskisi gibi', async () => {
        const { html } = await kur({ gizli: false, arama: 'usd' })
        const temiz = yorumsuz(html)
        expect(temiz).toContain('>Tether ' + NORMAL_VURGU + 'USD</span></p>')
        expect(temiz).toContain('>' + NORMAL_VURGU + 'USD</span>T</p>')
    })

    it('gizli modda ad ve sembol satirinda vurgu murekkep + kalin + alt cizgili; vurguda mor/indigo YOK', async () => {
        const { html } = await kur({ gizli: true, arama: 'usd' })
        const temiz = yorumsuz(html)
        expect(temiz).toContain('>Tether ' + GIZLI_VURGU + 'USD</span></p>')
        expect(temiz).toContain('>' + GIZLI_VURGU + 'USD</span>T</p>')
        expect(temiz).not.toContain(NORMAL_VURGU)
        const vurgular = usdVurgulari(html)
        expect(vurgular).toHaveLength(2)
        for (const s of vurgular) expect(s).not.toMatch(MOR)
    })

    it('gizli modda da arama duz metindir: regex ozel karakteri firlatmaz, harfi harfine vurgulanir', async () => {
        const { state } = await kur({ gizli: true })
        state.searchQuery = 'usd ('
        let out
        expect(() => { out = state.highlightMatch('Tether USD (BSC)') }).not.toThrow()
        expect(out).toBe('Tether ' + GIZLI_VURGU + 'USD (</span>BSC)')
    })

    it('KONTROL: normal modda highlightMatch eski span i dondurur; tek harflik arama iki modda da vurgulanmaz', async () => {
        const { state } = await kur({ gizli: false })
        state.searchQuery = 'usd'
        expect(state.highlightMatch('Tether USD')).toBe('Tether ' + NORMAL_VURGU + 'USD</span>')
        state.searchQuery = 'u'
        expect(state.highlightMatch('Tether USD')).toBe('Tether USD')
        privacyStore().active = true
        expect(state.highlightMatch('Tether USD')).toBe('Tether USD')
    })
})

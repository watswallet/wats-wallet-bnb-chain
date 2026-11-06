// swapFrom "Select Token" aramasi: highlightMatch ham arama metnini RegExp'e vermemeli.
//
// "usdt (" gibi bir arama (kullanici "USDT (Wormhole)" yazmaya basladi) kapanmamis grup nedeniyle
// `new RegExp('(usdt ()')` -> "Unterminated group" firlatiyordu; highlightMatch sablonda
// (v-html) cagrildigi icin render dusuyor ve token listesi bosaliyordu.
//
// highlightMatch <script setup> icinde ozel; bilesen ornegi captureInstance ile yakalanir ve
// setupState uzerinden cagrilir (arama kutusu = searchQuery ref'i).
import { describe, it, expect, vi, afterEach } from 'vitest'

// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const useTokenBalanceMock = vi.fn()
vi.mock('../../composables/useTokenBalance', () => ({
    useTokenBalance: (...a) => useTokenBalanceMock(...a),
}))
const axiosPost = vi.fn()
vi.mock('axios', () => ({ default: { post: (...a) => axiosPost(...a), get: vi.fn() } }))

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { networkStore } from '../../store/network'
import { privacyStore } from '../../store/privacy'
import SwapFrom from './swapFrom.vue'
import supported_chains from '../../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const SPAN_OPEN = '<span class="text-indigo-400 font-bold bg-indigo-500/10 px-0.5 rounded">'

afterEach(() => {
    delete globalThis.chrome
    useTokenBalanceMock.mockReset()
    axiosPost.mockReset()
})

async function mountAndGetHighlight({ gizli = false } = {}) {
    installChromeStub({
        currentNetwork: BSC,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
        imported_tokens: { acc1: { 56: [] } },
    })
    useTokenBalanceMock.mockResolvedValue(0)
    axiosPost.mockImplementation(async (url) => {
        if (url.endsWith('/getChainTokens')) return { status: 200, data: { success: true, tokens: [] } }
        if (url.endsWith('/getTokensDataById')) return { status: 200, data: { success: true, tokens: [] } }
        throw new Error('beklenmeyen url ' + url)
    })

    const app = createApp(SwapFrom)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const network = networkStore()
    network.currentNetwork = BSC
    network.rpc = BSC.rpc[0].url
    privacyStore().active = gizli

    const holder = captureInstance(app, 'swapFrom')
    await render(app)
    const state = holder.instance.setupState
    return (query, text) => {
        state.searchQuery = query
        return state.highlightMatch(text)
    }
}

describe('swapFrom: highlightMatch', () => {
    it('regex ozel karakterli arama ("usdt (") firlatmaz, harfi harfine vurgular', async () => {
        const highlight = await mountAndGetHighlight()
        let out
        expect(() => { out = highlight('usdt (', 'USDT (Wormhole)') }).not.toThrow()
        expect(out).toBe(SPAN_OPEN + 'USDT (</span>Wormhole)')
    })

    it('diger metakarakterler da duz metin sayilir', async () => {
        const highlight = await mountAndGetHighlight()
        expect(highlight('a.b', 'A.B axb')).toBe(SPAN_OPEN + 'A.B</span> axb')
        expect(highlight('[x]', 'Tok [X] en')).toBe('Tok ' + SPAN_OPEN + '[X]</span> en')
        expect(highlight('c++', 'C++ lang')).toBe(SPAN_OPEN + 'C++</span> lang')
    })

    it('normal arama eskisi gibi buyuk/kucuk harfe bakmadan vurgular', async () => {
        const highlight = await mountAndGetHighlight()
        expect(highlight('usdt', 'USDT (Wormhole)')).toBe(SPAN_OPEN + 'USDT</span> (Wormhole)')
        expect(highlight('worm', 'USDT (Wormhole)')).toBe('USDT (' + SPAN_OPEN + 'Worm</span>hole)')
    })

    it('tek karakterlik veya bos aramada metni oldugu gibi dondurur', async () => {
        const highlight = await mountAndGetHighlight()
        expect(highlight('u', 'USDT')).toBe('USDT')
        expect(highlight('', 'USDT')).toBe('USDT')
    })
})

// Grafit karari (kullanici, 2026-10-26): gizli modda style.css indigo'yu notr griye esler ve indigo vurgulu harfler
// cevredeki yazidan SONUK kalirdi. Gizli modda vurgu renkle degil kalinlik + alt cizgiyle; Kopru secicileriyle ayni.
describe('swapFrom: highlightMatch gizli modda', () => {
    const GIZLI_SPAN = '<span class="font-bold text-zinc-950 dark:text-white underline decoration-zinc-400 dark:decoration-zinc-500 underline-offset-2">'

    it('gizli modda vurgu kalinlik + alt cizgi, mor yok; arama yine duz metin', async () => {
        const highlight = await mountAndGetHighlight({ gizli: true })
        const out = highlight('usdt (', 'USDT (Wormhole)')
        expect(out).toBe(GIZLI_SPAN + 'USDT (</span>Wormhole)')
        expect(out).not.toMatch(/\b(violet|purple|indigo|fuchsia)-\d/)
    })

    it('KONTROL: normal modda vurgu eski indigo span', async () => {
        const highlight = await mountAndGetHighlight({ gizli: false })
        expect(highlight('usdt', 'USDT')).toBe(SPAN_OPEN + 'USDT</span>')
    })
})

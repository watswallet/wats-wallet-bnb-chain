// SearchTokens.vue (SSR) -- gizli modda "Ekle" cipi (son inceleme, 2026-10-27).
// Cipin uzerine gelince zemin zumrut doluyordu; zumrut gizli modda yalniz "bir koruma acik" demek (grafit karari,
// kullanici 2026-10-26). Gizli modda hover murekkep: style.css'teki dolu dugme murekkebiyle ayni aile. KONTROL: normal
// modda siniflar AYNEN kalir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosPost = vi.fn()
vi.mock('axios', () => ({ default: { post: (...a) => axiosPost(...a), get: vi.fn() } }))

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { privacyStore } from '../store/privacy'
import { tokenScopeStore } from '../store/tokenScope'
import SearchTokens from './SearchTokens.vue'
import supported_chains from '../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const USDT = { name: 'Tether', symbol: 'usdt', address: '0x55d398326f99059fF775485246999027B3197955', chainId: 56 }

afterEach(() => {
    delete globalThis.chrome
    axiosPost.mockReset()
})

async function ciz({ gizli }) {
    installChromeStub({
        currentNetwork: BSC,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
        imported_tokens: {},
    })
    axiosPost.mockImplementation(async (url) => {
        if (url.endsWith('/getChainTokens')) return { status: 200, data: { success: true, tokens: [USDT] } }
        throw new Error('beklenmeyen url ' + url)
    })
    const app = createApp(SearchTokens)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = BSC
    tokenScopeStore().setFilter(56)
    privacyStore().active = gizli
    return render(app)
}

// "Ekle" cipinin (tek satir: USDT) siniflari, sirali. SSR dinamik siniflari ONE yazar; sira gorunumu degistirmez.
const cip = (html) => {
    expect(html, 'token listesi cizilmedi').toContain('Tether')
    const cipler = [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)]
        .map((m) => ({ siniflar: m[1].split(/\s+/).filter(Boolean), icerik: m[2] }))
        .filter((b) => ['shrink-0', 'px-3', 'py-1.5'].every((s) => b.siniflar.includes(s)) && /\bAdd\b/.test(b.icerik))
    expect(cipler, 'Ekle cipi cizilmedi').toHaveLength(1)
    return cipler[0].siniflar.sort()
}

const ORTAK = ['shrink-0', 'px-3', 'py-1.5', 'rounded-lg', 'bg-slate-200', 'dark:bg-zinc-800', 'text-xs', 'font-bold', 'text-slate-600', 'hover:text-white', 'dark:text-zinc-400', 'transition-all', 'duration-300', 'flex', 'items-center', 'gap-1', 'cursor-pointer']

describe('SearchTokens.vue (SSR) -- gizli modda Ekle cipi murekkep, zumrut yok', () => {
    it('KONTROL: normal modda hover zumrut (siniflar aynen)', async () => {
        expect(cip(await ciz({ gizli: false }))).toEqual([...ORTAK, 'hover:bg-emerald-500', 'dark:hover:bg-emerald-600', 'dark:hover:text-white'].sort())
    })

    it('gizli modda hover murekkep: acikta zinc-950 + beyaz, koyuda zinc-200 + koyu yazi', async () => {
        const html = await ciz({ gizli: true })
        expect(cip(html)).toEqual([...ORTAK, 'hover:bg-zinc-950', 'dark:hover:bg-zinc-200', 'dark:hover:text-zinc-950'].sort())
        expect(html).not.toContain('emerald')
    })
})

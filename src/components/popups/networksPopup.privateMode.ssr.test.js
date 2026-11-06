// networksPopup.vue (SSR) -- GIZLI MOD grafit dili (kullanici karari 2026-10-26: gizli modda hicbir sey mor
// gorunmez; yesil yalniz "bir koruma acik" demektir):
//   1) secili agin isareti gizli modda yesil dolgu + yesil parlama DEGIL: murekkep (acikta zinc-950 + beyaz,
//      koyuda zinc-100 + zinc-950) ve parlamasiz;
//   2) arama vurgusu gizli modda renkle degil kalinlik + alt cizgiyle yapilir. style.css gizli modda indigo'yu
//      notr griye esledigi icin indigo vurgulu harfler cevredeki yazidan SONUK kaliyordu.
// Normal modda ikisi de eskisi gibi: her iddianin bir KONTROL cifti vardir ve normal mod siniflari BIREBIR aranir.
// Normal mod vurgusunun regex kacisi ayrica networksPopup.highlight.ssr.test.js'te kilitli.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { networkStore } from '../../store/network'
import { popupStore } from '../../store/popup'
import { privacyStore } from '../../store/privacy'
import NetworksPopup from './networksPopup.vue'
import supported_chains from '../../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

// Normal modun degisiklikten ONCEKI siniflari, harfi harfine.
const NORMAL_ISARET = 'w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-[0_0_10px_rgba(16,185,129,0.2)] dark:shadow-[0_0_10px_rgba(16,185,129,0.4)] transition-colors duration-300'
const NORMAL_IKON = 'w-3 h-3 text-white dark:text-black font-bold'
const NORMAL_VURGU = '<span class="text-indigo-400 font-bold bg-indigo-500/10 px-0.5 rounded">'
const GIZLI_VURGU = '<span class="font-bold text-zinc-950 dark:text-white underline decoration-zinc-400 dark:decoration-zinc-500 underline-offset-2">'
const MOR = /\b(violet|purple|indigo|fuchsia)-\d/

// Sablon yorumlari SSR ciktisina girer; iddialar yorumsuz HTML uzerinde kurulur.
const yorumsuz = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
// Secili satirin isareti: onay ikonu (svg) YALNIZ secili satirin isaret kutusunda vardir, digerleri bos halkadir.
const isaret = (html) => yorumsuz(html).match(/<div class="shrink-0 pl-2"><div class="([^"]*)"><svg class="([^"]*)"/)
const siniflar = (s) => s.split(/\s+/).filter(Boolean)

afterEach(() => {
    delete globalThis.chrome
})

/** `gizli`: privacyStore().active (installPrivacySync'in yaptigi gibi). `arama`: arama kutusu, render'dan ONCE yazilir. */
async function kur({ gizli, arama = '' }) {
    installChromeStub({ currentNetwork: ETH_CHAIN })
    const app = createApp(NetworksPopup)
    app.use(createTestPinia())
    app.use(createTestI18n())
    networkStore().currentNetwork = ETH_CHAIN
    // Liste ancak bu bayrakla render edilir; kapaliyken popup govdesi hic olusmaz.
    popupStore().network_popup = true
    privacyStore().active = gizli
    const holder = captureInstance(app, 'networksPopup', (instance) => {
        instance.setupState.searchQuery = arama
    })
    const html = await render(app)
    return { html, state: holder.instance.setupState }
}

describe('networksPopup.vue (SSR) -- gizli modda secili ag isareti murekkep, parlamasiz', () => {
    it('KONTROL: normal modda isaret yesil dolgu + yesil parlama; isaret ve ikon siniflari BIREBIR eskisi gibi', async () => {
        const { html } = await kur({ gizli: false })
        const m = isaret(html)
        expect(m, 'secili satirin isareti bulunamadi').not.toBeNull()
        expect(m[1]).toBe(NORMAL_ISARET)
        expect(m[2]).toBe(NORMAL_IKON)
    })

    it('gizli modda isaret murekkep: acikta zinc-950 + beyaz, koyuda zinc-100 + zinc-950', async () => {
        const { html } = await kur({ gizli: true })
        const m = isaret(html)
        expect(m, 'secili satirin isareti bulunamadi').not.toBeNull()
        expect(siniflar(m[1])).toEqual(expect.arrayContaining(['bg-zinc-950', 'text-white', 'dark:bg-zinc-100', 'dark:text-zinc-950']))
        // Onay ikonu murekkep zeminde okunur kalir: acikta beyaz, koyuda koyu.
        expect(m[2]).toMatch(/(^|\s)text-white(\s|$)/)
        expect(m[2]).toMatch(/(^|\s)dark:text-(black|zinc-950)(\s|$)/)
    })

    it('gizli modda isarette yesil ve parlama YOK; popup un hicbir yerinde yesil kalmaz', async () => {
        const { html } = await kur({ gizli: true })
        const m = isaret(html)
        expect(m, 'secili satirin isareti bulunamadi').not.toBeNull()
        expect(m[1]).not.toMatch(/emerald|shadow/)
        expect(yorumsuz(html)).not.toMatch(/emerald|rgba\(16,\s*185,\s*129/)
    })
})

describe('networksPopup.vue (SSR) -- gizli modda arama vurgusu renk degil kalinlik + alt cizgi', () => {
    it('KONTROL: normal modda listede vurgu indigo, span BIREBIR eskisi gibi', async () => {
        const { html } = await kur({ gizli: false, arama: 'eth' })
        expect(yorumsuz(html)).toContain('>' + NORMAL_VURGU + 'Eth</span>ereum</p>')
    })

    it('gizli modda listede vurgu murekkep + kalin + alt cizgili; vurgu span inda mor/indigo YOK', async () => {
        const { html } = await kur({ gizli: true, arama: 'eth' })
        const temiz = yorumsuz(html)
        expect(temiz).toContain('>' + GIZLI_VURGU + 'Eth</span>ereum</p>')
        expect(temiz).not.toContain(NORMAL_VURGU)
        const vurgular = [...temiz.matchAll(/<span class="([^"]*)">Eth<\/span>/g)].map((x) => x[1])
        expect(vurgular).toHaveLength(1)
        expect(vurgular[0]).not.toMatch(MOR)
    })

    it('gizli modda da arama duz metindir: regex ozel karakteri firlatmaz, harfi harfine vurgulanir', async () => {
        const { state } = await kur({ gizli: true })
        state.searchQuery = '(mainnet)'
        let out
        expect(() => { out = state.highlightMatch('Ethereum (Mainnet)') }).not.toThrow()
        expect(out).toBe('Ethereum ' + GIZLI_VURGU + '(Mainnet)</span>')
        state.searchQuery = 'a.b'
        expect(state.highlightMatch('A.B axb')).toBe(GIZLI_VURGU + 'A.B</span> axb')
    })

    it('KONTROL: normal modda highlightMatch eski span i dondurur', async () => {
        const { state } = await kur({ gizli: false })
        state.searchQuery = 'eth'
        expect(state.highlightMatch('Ethereum')).toBe(NORMAL_VURGU + 'Eth</span>ereum')
    })
})

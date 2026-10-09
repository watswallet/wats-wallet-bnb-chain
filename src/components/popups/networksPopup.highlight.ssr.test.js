// networksPopup ag aramasi: highlightMatch ham arama metnini RegExp'e vermemeli.
//
// Arama kutusuna yazilan metin `new RegExp('(eth ()', 'gi')` olarak derleniyordu ->
// "Unterminated group" firlatiyordu; highlightMatch sablonda (v-html), aramayla eslesen her
// satir icin cagrildigi icin render dusuyor ve ag listesi bosaliyordu. "." ise joker gibi
// davranip "a.b" aramasinin "axb"yi de vurguluyordu. Ayni hata swapFrom.vue'daydi
// (bkz. swapFrom.highlight.ssr.test.js); bridgeFrom.vue ve bridgeTo.vue ayni kacisi zaten yapiyor.
//
// highlightMatch <script setup> icinde ozel; bilesen ornegi captureInstance ile yakalanir ve
// setupState uzerinden cagrilir (arama kutusu = searchQuery ref'i).
//
// KISA ARAMA: swapFrom'un aksine burada "en az 2 karakter" siniri YOK; tek kapi bos/yalniz
// bosluktan olusan aramadir. Tek karakterlik arama bugun de vurgulanir ve bu test onu oldugu
// gibi kilitler (davranis degistirilmedi, yalnizca arama metni kacirildi).
import { describe, it, expect, vi, afterEach } from 'vitest'

// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { networkStore } from '../../store/network'
import { popupStore } from '../../store/popup'
import NetworksPopup from './networksPopup.vue'
import supported_chains from '../../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SPAN_OPEN = '<span class="text-indigo-400 font-bold bg-indigo-500/10 px-0.5 rounded">'

afterEach(() => {
    delete globalThis.chrome
})

async function mountAndGetHighlight() {
    installChromeStub({ currentNetwork: ETH_CHAIN })

    const app = createApp(NetworksPopup)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const network = networkStore()
    network.currentNetwork = ETH_CHAIN
    // Liste ancak bu bayrakla render edilir; kapaliyken popup govdesi hic olusmaz.
    popupStore().network_popup = true

    const holder = captureInstance(app, 'networksPopup')
    await render(app)
    const state = holder.instance.setupState
    return (query, text) => {
        state.searchQuery = query
        return state.highlightMatch(text)
    }
}

describe('networksPopup: highlightMatch', () => {
    it('regex ozel karakterli arama ("eth (") firlatmaz', async () => {
        const highlight = await mountAndGetHighlight()
        let out
        expect(() => { out = highlight('eth (', 'Ethereum (Mainnet)') }).not.toThrow()
        // "eth (" bu adin icinde duz metin olarak GECMEZ: vurgulanacak bir sey yok, metin oldugu gibi doner.
        expect(out).toBe('Ethereum (Mainnet)')
    })

    it('parantezli aramayi harfi harfine vurgular', async () => {
        const highlight = await mountAndGetHighlight()
        // Kullanici "Ethereum (Mainnet)" yazmaya basladi ve parantezi acti.
        expect(highlight('ethereum (', 'Ethereum (Mainnet)')).toBe(SPAN_OPEN + 'Ethereum (</span>Mainnet)')
        expect(highlight('mainnet)', 'Ethereum (Mainnet)')).toBe('Ethereum (' + SPAN_OPEN + 'Mainnet)</span>')
    })

    it('dengeli parantez "yakalama grubu" sayilmaz: parantezlerin kendisi de vurgulanir', async () => {
        const highlight = await mountAndGetHighlight()
        // Eskiden firlatmaz, ama SESSIZCE yanlis vurgulardi: "(mainnet)" -> yalnizca "Mainnet".
        expect(highlight('(mainnet)', 'Ethereum (Mainnet)')).toBe('Ethereum ' + SPAN_OPEN + '(Mainnet)</span>')
    })

    it('"." joker karakter degildir: "a.b" aramasi "axb"yi vurgulamaz', async () => {
        const highlight = await mountAndGetHighlight()
        expect(highlight('a.b', 'A.B axb')).toBe(SPAN_OPEN + 'A.B</span> axb')
    })

    // Kacis sinifinin TAMAMI: biri sinifa eklenmeden cikarilirsa o karakter burada duser.
    const META_CHARS = ['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']
    it.each(META_CHARS)('metakarakter %s duz metin sayilir', async (ch) => {
        const highlight = await mountAndGetHighlight()
        let out
        expect(() => { out = highlight(ch, 'x' + ch + 'y') }).not.toThrow()
        expect(out).toBe('x' + SPAN_OPEN + ch + '</span>y')
    })

    it('normal arama eskisi gibi buyuk/kucuk harfe bakmadan vurgular, bastan/sondan kirpar', async () => {
        const highlight = await mountAndGetHighlight()
        expect(highlight('eth', 'Ethereum')).toBe(SPAN_OPEN + 'Eth</span>ereum')
        expect(highlight('MAIN', 'Ethereum (Mainnet)')).toBe('Ethereum (' + SPAN_OPEN + 'Main</span>net)')
        expect(highlight('  eth  ', 'Ethereum')).toBe(SPAN_OPEN + 'Eth</span>ereum')
    })

    it('bos veya yalniz bosluktan olusan aramada metni oldugu gibi dondurur', async () => {
        const highlight = await mountAndGetHighlight()
        expect(highlight('', 'Ethereum')).toBe('Ethereum')
        expect(highlight('   ', 'Ethereum')).toBe('Ethereum')
    })

    it('tek karakterlik arama (swapFrom un aksine) vurgulanir ve TUM gecisleri kapsar', async () => {
        const highlight = await mountAndGetHighlight()
        expect(highlight('e', 'Ethereum')).toBe(
            SPAN_OPEN + 'E</span>th' + SPAN_OPEN + 'e</span>r' + SPAN_OPEN + 'e</span>um',
        )
    })
})

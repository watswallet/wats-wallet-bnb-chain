// Kopru ekraninda TOKENIZE HISSE ROZETI -- yalniz HEDEF (alinacak) taraf.
//
// KOPRUNUN HEDEF TARAFI BILEREK ACIK. Kaynak tarafi kapali (bridgeBstocks.test.js:
// harcama yolu ham birimde, gosterim UI biriminde). Hedefte harcama yok ve
// 2026-10-02'de olculdu: LI.FI GOOGLB'yi taniyor ve 100 USDC (Ethereum) ->
// GOOGLB (BSC) icin gercek bir teklif veriyor; 22 hissenin 20'si LI.FI'nin BSC
// token listesinde, yani hedef secicide HERKESE gorunuyor. Kullanici kopruden
// bir hisse SERTIFIKASI aldigini bilmeli: takas ekranindaki rozet buraya da gelir.
//
// ROZETIN ZINCIR KAYNAGI HEDEF ZINCIR (crypto.bridge.toChain), aktif ag DEGIL.
// Takastan farki bu: kopruda alinan token BASKA bir zincirde. Aktif agi kullanmak
// Ethereum'dan BSC'ye hisse alirken rozeti HIC gostermez, BSC'den Ethereum'a
// giderken de ayni adresi tasiyan alakasiz bir tokeni hisse gibi etiketlerdi.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

// bridgeTo.vue listeyi LI.FI'den (axios.get) ve fiyatlari bizim sunucudan
// (axios.post) okur. Iki ag da saplanir; LI.FI listesi testten verilir.
const { lifiListesi } = vi.hoisted(() => ({ lifiListesi: { tokens: {} } }))
vi.mock('axios', () => ({
    default: {
        get: vi.fn(async () => ({ status: 200, data: lifiListesi })),
        post: vi.fn(async () => ({ status: 200, data: { tokens: [] } })),
    },
}))

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import Bridge from './Bridge.vue'
import BridgeTo from './bridge/bridgeTo.vue'
import supported_chains from '../data/supported_chains.json'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === BSTOCKS_CHAIN_ID)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

const GOOGLB = BSTOCKS.find((t) => t.symbol === 'GOOGLB')
const AAPLB = BSTOCKS.find((t) => t.symbol === 'AAPLB')
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'

// ROZETIN BIREBIR IZI: `title` VE GORUNEN ETIKET birlikte (SwapBStock.ssr.test.js
// ile ayni marker; govdesi bosaltilmis gorunmez bir rozet sayilmaz).
const ROZET_RE = /title="Tokenized stock"[^>]*>Stock<\/span>/g
// `.test()` icin /g'siz kopya: /g'li regex lastIndex tasir ve ardisik cagrilarda
// yanlis negatif verir.
const ROZET_TEK = /title="Tokenized stock"[^>]*>Stock<\/span>/
const yorumsuzHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const rozetSayisi = (html) => (yorumsuzHtml(html).match(ROZET_RE) || []).length

// Render edilmis butonlarin HAM govdeleri (yorumlar silinmis).
const butonGovdeleri = (html) => [...yorumsuzHtml(html).matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1])

const token = (kayit, over = {}) => ({
    name: kayit.name,
    symbol: kayit.symbol.toLowerCase(),
    address: kayit.address,
    decimals: 18,
    image: { thumb: '', large: '' },
    ...over,
})

afterEach(() => {
    useTokenBalanceMock.mockClear()
    lifiListesi.tokens = {}
    delete globalThis.chrome
})

function kopruEkrani(aktifAg, { toChain, outToken }) {
    installChromeStub({
        currentNetwork: aktifAg,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
    })
    const app = createApp(Bridge)
    app.use(createTestPinia())
    app.use(createTestI18n())

    networkStore().currentNetwork = aktifAg
    pageStore().currentPage = 'bridge'
    const crypto = cryptoStore()
    crypto.bridge.toChain = toChain
    crypto.bridge.outToken = outToken
    return app
}

describe('Bridge.vue (SSR) -- alinacak tarafta hisse rozeti', () => {
    it('BSC ye alinan hisse rozet alir', async () => {
        const app = kopruEkrani(BSC_CHAIN, { toChain: BSC_CHAIN, outToken: token(GOOGLB) })
        const holder = captureInstance(app, 'Bridge')
        const html = await render(app)

        expect(holder.instance.setupState.outTokenIsBStock).toBe(true)
        expect(rozetSayisi(html)).toBe(1)
    })

    it('Ethereum AKTIFKEN BSC ye alinan hisse de rozet alir (kaynak hedef zincir)', async () => {
        const app = kopruEkrani(ETH_CHAIN, { toChain: BSC_CHAIN, outToken: token(GOOGLB) })
        const holder = captureInstance(app, 'Bridge')
        const html = await render(app)

        expect(holder.instance.setupState.outTokenIsBStock).toBe(true)
        expect(rozetSayisi(html)).toBe(1)
    })

    it('AYNI adres hedef Ethereum iken rozet ALMAZ (BSC aktif olsa bile)', async () => {
        const app = kopruEkrani(BSC_CHAIN, { toChain: ETH_CHAIN, outToken: token(GOOGLB) })
        const holder = captureInstance(app, 'Bridge')
        const html = await render(app)

        expect(holder.instance.setupState.outTokenIsBStock).toBe(false)
        expect(rozetSayisi(html)).toBe(0)
    })

    it('hisse OLMAYAN BSC tokeninde rozet YOK', async () => {
        const app = kopruEkrani(BSC_CHAIN, {
            toChain: BSC_CHAIN,
            outToken: { name: 'Tether USD', symbol: 'usdt', address: USDT_BSC, decimals: 18, image: { thumb: '', large: '' } },
        })
        const holder = captureInstance(app, 'Bridge')
        const html = await render(app)

        expect(holder.instance.setupState.outTokenIsBStock).toBe(false)
        expect(rozetSayisi(html)).toBe(0)
    })

    // YERLESIM: secici buton `shrink-0` ve miktar alaniyla ayni satiri paylasiyor
    // (takas ekraninda olculen tuzak, bkz. SwapBStock.ssr.test.js). Rozet ETIKET
    // satirinda, "Receiver Chain" etiketinin hemen yaninda durur.
    it('rozet secici butonun ICINDE degil, alici etiketinin yaninda', async () => {
        const app = kopruEkrani(BSC_CHAIN, { toChain: BSC_CHAIN, outToken: token(GOOGLB) })
        const html = await render(app)

        expect(butonGovdeleri(html).filter((g) => ROZET_TEK.test(g) || />Stock<\/span>/.test(g))).toHaveLength(0)
        expect(yorumsuzHtml(html)).toMatch(/>Receiver Chain<\/span>\s*<span[^>]*title="Tokenized stock"[^>]*>Stock<\/span>/)
    })
})

function hedefListesi(toChain, { iceAktarilan = [], lifi = [] }) {
    installChromeStub({
        currentNetwork: BSC_CHAIN,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
        imported_tokens: { acc1: { [toChain.chainId]: iceAktarilan } },
    })
    lifiListesi.tokens = { [toChain.chainId]: lifi }

    const app = createApp(BridgeTo)
    app.use(createTestPinia())
    app.use(createTestI18n())
    networkStore().currentNetwork = BSC_CHAIN
    cryptoStore().bridge.toChain = toChain
    return app
}

// Satirin gorunen metni (etiketler silinmis) -> o satirda rozet var mi.
const satirRozetleri = (html) => Object.fromEntries(butonGovdeleri(html).map((g) => [
    g.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    ROZET_TEK.test(g),
]))

describe('bridgeTo.vue (SSR) -- hedef listesinde hisse rozeti', () => {
    it('ice aktarilan VE LI.FI listesinden gelen hisse satirlari rozet alir, digerleri almaz', async () => {
        const app = hedefListesi(BSC_CHAIN, {
            iceAktarilan: [token(GOOGLB)],
            lifi: [token(AAPLB), { name: 'Tether USD', symbol: 'USDT', address: USDT_BSC, decimals: 18 }],
        })
        const html = await render(app)

        expect(rozetSayisi(html)).toBe(2)
        const satirlar = satirRozetleri(html)
        const rozetli = (sembol) => Object.entries(satirlar).find(([metin]) => metin.includes(sembol))?.[1]
        expect(rozetli('GOOGLB')).toBe(true)
        expect(rozetli('AAPLB')).toBe(true)
        expect(rozetli('USDT')).toBe(false)
    })

    it('hedef Ethereum iken AYNI adres rozet ALMAZ (aktif ag BSC olsa bile)', async () => {
        const app = hedefListesi(ETH_CHAIN, { lifi: [token(GOOGLB)] })
        const html = await render(app)

        expect(html).toContain('GOOGLB')
        expect(rozetSayisi(html)).toBe(0)
    })
})

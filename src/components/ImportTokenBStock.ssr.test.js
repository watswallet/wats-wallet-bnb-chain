// ImportToken.vue -- SAHTE HISSE KIMLIGI, bilesen teli.
//
// Karar mantigi (bStockImportIdentity) utils/bstocks.test.js'te ayrintili test
// ediliyor. Burasi BILESENIN o karari GERCEKTEN cagirdigini ve dogru zinciri
// (tokenin yazilacagi kova = network.currentNetwork.chainId) verdigini kilitler.
// Zincir (ethers) ve sunucu (axios) saplanir.
//
// Iki kip var:
//  - SSR: validateTokenContract dogrudan cagrilir (donus degeri).
//  - ISTEMCI: `watch(ca, ...)` SSR'da CALISMAZ (bkz. ImportToken.ssr.test.js basi).
//    `known.value = tokenInfo.known` telini kilitlemek icin bilesen DOM'suz bir
//    ozel renderer'la (createRenderer + en kucuk nodeOps) GERCEKTEN mount edilir;
//    watch calisir, debounce sahte zamanlayiciyla gecilir. Tel koparsa sahte
//    hisse logosuz kalir ama yesil "Dogrulandi" rozeti GERI GELIR.
import { describe, it, expect, vi, afterEach } from 'vitest'

const { KONTRATLAR, axiosPostMock } = vi.hoisted(() => ({
    KONTRATLAR: new Map(),
    axiosPostMock: vi.fn(),
}))

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class JsonRpcProvider {
        async getCode() { return '0x6080' }
    }
    class Contract {
        constructor(address) {
            const k = KONTRATLAR.get(address.toLowerCase())
            this.name = async () => k.name
            this.symbol = async () => k.symbol
            this.decimals = async () => 18n
        }
    }
    return { ...actual, JsonRpcProvider, Contract }
})

vi.mock('axios', () => ({ default: { post: (...a) => axiosPostMock(...a), get: vi.fn() } }))

import { createRenderer, nextTick, ssrContextKey } from 'vue'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import ImportToken from './ImportToken.vue'
import supported_chains from '../data/supported_chains.json'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

const GERCEK_GOOGLB = '0x3F53De71c126BdaBAe20f9cD64848d317f6C3238'
const SAHTE_GOOGLB = '0x3f46948c00000000000000000000000000000000'

// Sunucunun /getTokenByName'den dondurdugu GERCEK hisse kaydi: AD + SEMBOL
// eslestigi icin sahte kontrata da ayni kayit doner.
const SUNUCU_GOOGLB = {
    coingecko_id: 'alphabet-bstocks-tokenized-stock',
    image: { large: 'https://sunucu/large.png', small: 'https://sunucu/small.png', thumb: 'https://sunucu/thumb.png' },
    chain: 'binance-smart-chain',
}

afterEach(() => {
    delete globalThis.chrome
    KONTRATLAR.clear()
    axiosPostMock.mockReset()
})

async function dogrula(chainRecord, address) {
    installChromeStub({ active_account: { key: 'acc-1' } })
    const app = createApp(ImportToken)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord
    network.rpc = 'https://rpc.example'

    const captured = captureInstance(app, 'ImportToken')
    await render(app)
    return captured.instance.setupState.validateTokenContract(address)
}

describe('ImportToken.vue (SSR) -- hisse taklitcisi kimlik miras almaz', () => {
    it('BSC de gercek hissenin adini/sembolunu tasiyan SAHTE kontrat logo/fiyat almaz, dogrulanmamis sayilir', async () => {
        KONTRATLAR.set(SAHTE_GOOGLB, { name: 'Alphabet', symbol: 'GOOGLB' })
        axiosPostMock.mockResolvedValue({ data: { token: SUNUCU_GOOGLB } })

        const sonuc = await dogrula(BSC_CHAIN, SAHTE_GOOGLB)

        expect(sonuc).toMatchObject({ name: 'Alphabet', symbol: 'GOOGLB', image: null, chain: null, coingecko_id: null, known: false })
    })

    it('BSC de GERCEK hisse adresi kimligini katalogdan alir ve dogrulanmis sayilir', async () => {
        KONTRATLAR.set(GERCEK_GOOGLB.toLowerCase(), { name: 'Alphabet', symbol: 'GOOGLB' })
        axiosPostMock.mockResolvedValue({ data: { token: SUNUCU_GOOGLB } })

        const sonuc = await dogrula(BSC_CHAIN, GERCEK_GOOGLB)

        // image KATALOGDAN (sunucununki 'https://sunucu/large.png'): kaynagi ayirt eden alan.
        expect(sonuc).toMatchObject({
            image: { large: 'https://coin-images.coingecko.com/coins/images/102174363/large/googlb-bstocks.png?1783451303' },
            coingecko_id: 'alphabet-bstocks-tokenized-stock',
            chain: 'binance-smart-chain',
            known: true,
        })
    })

    it('sunucu eslesmese de (404) hisse SEMBOLU tasiyan sahte kontrat dogrulanmamis sayilir', async () => {
        // Ad sunucudakinden farkli: /getTokenByName 404 doner, karar yalniz SEMBOLDEN cikar.
        KONTRATLAR.set(SAHTE_GOOGLB, { name: 'Alphabet Inc', symbol: 'GOOGLB' })
        axiosPostMock.mockRejectedValue(new Error('Request failed with status code 404'))

        const sonuc = await dogrula(BSC_CHAIN, SAHTE_GOOGLB)

        expect(sonuc).toMatchObject({ image: null, coingecko_id: null, known: false })
    })

    it('ayni adres ETHEREUM kovasina eklenirken hisse sayilmaz (karar aktif agin zinciriyle verilir)', async () => {
        KONTRATLAR.set(GERCEK_GOOGLB.toLowerCase(), { name: 'Alphabet', symbol: 'GOOGLB' })
        axiosPostMock.mockResolvedValue({ data: { token: SUNUCU_GOOGLB } })

        const sonuc = await dogrula(ETH_CHAIN, GERCEK_GOOGLB)

        expect(sonuc).toMatchObject({ coingecko_id: null, known: false })
    })

    it('hisse OLMAYAN token sunucunun kimligini eskisi gibi alir', async () => {
        const USDT = '0x55d398326f99059fF775485246999027B3197955'
        KONTRATLAR.set(USDT.toLowerCase(), { name: 'Tether USD', symbol: 'USDT' })
        axiosPostMock.mockResolvedValue({ data: { token: { coingecko_id: 'tether', image: { large: 'u' }, chain: 'binance-smart-chain' } } })

        const sonuc = await dogrula(BSC_CHAIN, USDT)

        expect(sonuc).toMatchObject({ coingecko_id: 'tether', image: { large: 'u' }, chain: 'binance-smart-chain', known: true })
    })
})

// ISTEMCI KIPI: DOM'suz renderer. Dugumler duz nesne; bilesen gercekten mount
// edilir, `watch(ca, ...)` ve debounce zamanlayicisi GERCEKTEN calisir.
const dugum = (tag) => ({ tag, children: [], parent: null, addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, style: {}, value: '' })
const { createApp: createClientApp } = createRenderer({
    createElement: (t) => dugum(t),
    createText: (t) => ({ ...dugum('#text'), text: t }),
    createComment: (t) => ({ ...dugum('#comment'), text: t }),
    setText: (n, t) => { n.text = t },
    setElementText: (n, t) => { n.text = t },
    insert: (c, p, a) => { c.parent = p; const i = a ? p.children.indexOf(a) : -1; i >= 0 ? p.children.splice(i, 0, c) : p.children.push(c) },
    remove: (c) => { const p = c.parent; if (p) p.children.splice(p.children.indexOf(c), 1) },
    parentNode: (n) => n.parent,
    nextSibling: (n) => { const p = n.parent; return p ? p.children[p.children.indexOf(n) + 1] ?? null : null },
    patchProp: () => {},
})

describe('ImportToken.vue (istemci) -- adres yapistirilinca rozet durumu', () => {
    afterEach(() => {
        vi.useRealTimers()
        delete globalThis.document
        delete globalThis.requestAnimationFrame
    })

    async function mountEt() {
        vi.useFakeTimers()
        globalThis.document = { activeElement: null }
        globalThis.requestAnimationFrame = () => 0
        installChromeStub({ active_account: { key: 'acc-1' } })

        const app = createClientApp(ImportToken)
        app.use(createTestPinia())
        app.use(createTestI18n())
        // Vitest bileseni SSR icin derliyor; derlenmis setup useSSRContext().modules
        // okuyor. Bos bir baglam vermezsek mount "reading modules" ile duser.
        app.provide(ssrContextKey, {})
        const network = networkStore()
        network.currentNetwork = BSC_CHAIN
        network.rpc = 'https://rpc.example'

        let instance = null
        app.mixin({ created() { if (this.$.type.__name === 'ImportToken') instance = this.$ } })
        app.mount(dugum('root'))
        return instance.setupState
    }

    // debounce (600 ms) + zincir/sunucu okumalarinin mikro gorevleri
    async function yapistir(state, address) {
        state.ca = address
        await nextTick()
        await vi.advanceTimersByTimeAsync(700)
        await vi.runAllTimersAsync()
    }

    it('sahte hisse yapistirilinca rozet "dogrulanmamis"a doner; ardindan siradan token yine "dogrulanmis"', async () => {
        const USDT = '0x55d398326f99059fF775485246999027B3197955'
        KONTRATLAR.set(SAHTE_GOOGLB, { name: 'Alphabet', symbol: 'GOOGLB' })
        KONTRATLAR.set(USDT.toLowerCase(), { name: 'Tether USD', symbol: 'USDT' })
        axiosPostMock.mockImplementation(async (_url, body) => ({
            data: { token: body.symbol === 'GOOGLB' ? SUNUCU_GOOGLB : { coingecko_id: 'tether', image: null, chain: 'binance-smart-chain' } },
        }))

        const state = await mountEt()
        expect(state.known).toBe(true)

        await yapistir(state, SAHTE_GOOGLB)
        expect(state.isValid).toBe(true)
        expect(state.symbol).toBe('GOOGLB')
        expect(state.id).toBe(null)
        expect(state.known).toBe(false)

        await yapistir(state, USDT)
        expect(state.id).toBe('tether')
        expect(state.known).toBe(true)
    })
})

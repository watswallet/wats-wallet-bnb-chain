// NORMAL MODDA LOGOSUZ TOKEN KALMAZ (sahip karari 2026-11-03: "logosuz hicbir yer gormek istemiyorum, her seyin logosu tam olacak").
//   - MALVARLIGI (Home): logosuz VE bakiyesi KESIN sifir olan satir gizlenir; bakiyesi olan / okunamayan / yuklenmemis logosuz satir GORUNUR (notr monogram).
//   - SECICI ve ARAMA listeleri: logosuz token gizlenir (cuzdanda bakiyesi olan istisna; kullanicinin kendi ice aktardigi token ASLA gizlenmez).
//   - Gizli mod: ortak ekranlarin satir kumesi DEGISMEZ (gizli modun kurallari kendi dosyalarinda).
// "Logosuz" = hicbir kaynak adayi yok ya da tum kaynaklar yuklenemedi. Ikincisi tarayicida <img>.onerror ile olusur; SSR'de onerror calismaz, bu yuzden
// ayni durum tokenLogoState API'siyle (TokenAvatar'in gercekte cagirdigi) onceden kurulur.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { heavyBackgroundTimeouts } from '../test-utils/heavyBackgroundTimeouts.js'

heavyBackgroundTimeouts()

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const kayit = vi.hoisted(() => ({ zincirTokenleri: [], bakiyeler: {}, hatali: new Set() }))

vi.mock('axios', () => {
    const yanit = (yol) => {
        if (yol.endsWith('/getChainTokens')) return { status: 200, data: { success: true, tokens: kayit.zincirTokenleri } }
        if (yol.endsWith('/news')) return { status: 200, data: { news: [] } }
        if (yol.includes('li.quest')) return { status: 200, data: { tokens: { 56: kayit.zincirTokenleri } } }
        return { status: 200, data: { tokens: [], success: true } }
    }
    const yolu = (url) => (String(url).includes('li.quest') ? String(url) : String(url).replace(/^https?:\/\/[^/]+/, ''))
    return { default: { post: async (url) => yanit(yolu(url)), get: async (url) => yanit(yolu(url)) } }
})

vi.mock('../composables/useTokenBalance', () => ({
    useTokenBalance: async (_owner, tokenAddress) => {
        const a = String(tokenAddress).toLowerCase()
        if (kayit.hatali.has(a)) throw new Error('rpc yok')
        return kayit.bakiyeler[a] ?? 0
    },
}))
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: async () => [] }))

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SahteSaglayici {
        destroy() {}
        async getBalance() { return 0n }
        async getNetwork() { return { chainId: 56n } }
    }
    return { ...actual, JsonRpcProvider: SahteSaglayici, ethers: { ...actual.ethers, JsonRpcProvider: SahteSaglayici } }
})

vi.mock('../utils/stockBalances', async (importOriginal) => {
    const gercek = await importOriginal()
    return { ...gercek, ensureMultipliersFor: async () => {} }
})

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { privacyStore } from '../store/privacy'
import { cryptoStore } from '../store/crypto'
import { tokenScopeStore } from '../store/tokenScope'
import { setLocalLogosOnly } from '../utils/tokenLogo'
import { reportLogoLoaded, reportLogoExhausted, resetLogoState } from '../utils/tokenLogoState'
import Home from './Home.vue'
import TxIdentityLine from './TxIdentityLine.vue'
import History from './History.vue'
import SwapFrom from './swap/swapFrom.vue'
import SwapTo from './swap/swapTo.vue'
import BridgeTo from './bridge/bridgeTo.vue'
import SearchTokens from './SearchTokens.vue'
import SelectAssets from './SelectAssets.vue'
import supported_chains from '../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const HESAP = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', type: 'hd', name: 'Hesap 1' }
const GIZLI = { address: '0xCcccCccc00000000000000000000000000000003', key: 'private-0xcccccccc00000000000000000000000000000003', type: 'hd', private: true, name: 'Gizli Hesap' }

const adres = (b) => '0x' + b.repeat(20)
const GORSEL = { thumb: 'https://cdn.example/ok-t.png', small: 'https://cdn.example/ok-s.png', large: 'https://cdn.example/ok-l.png' }
// Paketli (public/tokens/56/..) CAKE: sunucu gorseli OLMADAN da logolu.
const CAKE = { name: 'PancakeSwap', symbol: 'CAKE', address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', decimals: 18, coingecko_id: null }
const UZAK = { name: 'Okay Coin', symbol: 'OKAY', address: adres('a1'), decimals: 18, coingecko_id: null, image: GORSEL }
const HAYALET = { name: 'Ghost Coin', symbol: 'GHOST', address: adres('b2'), decimals: 18, coingecko_id: null }
const HAYALET_BAKIYELI = { name: 'Held Ghost', symbol: 'HELDG', address: adres('c3'), decimals: 18, coingecko_id: null }
const HAYALET_OKUNAMAYAN = { name: 'Unread Ghost', symbol: 'UNRDG', address: adres('e5'), decimals: 18, coingecko_id: null }
const HAYALET_SIFIR = { name: 'Zero Ghost', symbol: 'ZEROG', address: adres('d4'), decimals: 18, coingecko_id: null }
const DEPO_HAYALETI = { name: 'Stored Ghost', symbol: 'STORG', address: adres('f6'), decimals: 18, coingecko_id: null }

// Depo kaydi (imported_tokens) `chain` slug'i tasir; sunucu satiri `chainId` damgali gelir.
const kayitli = (t) => ({ ...t, chain: 'binance-smart-chain' })
const sunucu = (t) => ({ ...t, chainId: 56 })

/** Tum kaynaklari yuklenemeyen token: TokenAvatar'in tarayicida onerror zincirinin sonunda yaptigi cagri (ag kaniti VAR). */
function logosuzIsaretle(...tokenler) {
    reportLogoLoaded('https://cdn.example/ag-canli.png')
    for (const t of tokenler) reportLogoExhausted({ ...t, chainId: 56 }, { chainId: 56, triedRemote: true })
}

beforeEach(() => {
    resetLogoState()
    kayit.zincirTokenleri = []
    kayit.bakiyeler = {}
    kayit.hatali.clear()
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    setLocalLogosOnly(false)
    delete globalThis.chrome
})

async function ekranKur(Bilesen, ad, { gizli = false, depo = {}, props = {}, hazirla } = {}) {
    const hesap = gizli ? GIZLI : HESAP
    installChromeStub({
        currentNetwork: BSC,
        active_account: hesap,
        imported_tokens: depo.imported_tokens ?? {},
        vaults: [{ accounts: [HESAP], privateAccount: GIZLI }],
    })
    const app = createApp(Bilesen, { props })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = BSC
    networkStore().rpc = BSC.rpc[0].url
    privacyStore().active = gizli
    tokenScopeStore().filter = 'all'
    setLocalLogosOnly(gizli)
    hazirla?.()
    const captured = captureInstance(app, ad)
    const html = await render(app)
    return { html, state: captured.instance?.setupState }
}

const satirlar = (html, ...semboller) => semboller.map((s) => [s, html.includes('>' + s + '<') || html.includes('>' + s.toLowerCase() + '<')])
const metin = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const gorunur = (html, sembol) => new RegExp('>\\s*' + sembol + '\\s*<', 'i').test(html)

describe('Home (normal mod) -- logosuz satir kurali: yalniz KESIN sifir bakiyeli gizlenir', () => {
    const KOVA = {
        56: [kayitli(CAKE), kayitli(UZAK), kayitli(HAYALET), kayitli(HAYALET_BAKIYELI), kayitli(HAYALET_OKUNAMAYAN), kayitli(HAYALET_SIFIR)],
    }
    const kur = async () => {
        kayit.bakiyeler = { [HAYALET_BAKIYELI.address.toLowerCase()]: 5 }
        kayit.hatali.add(HAYALET_OKUNAMAYAN.address.toLowerCase())
        logosuzIsaretle(HAYALET, HAYALET_BAKIYELI, HAYALET_OKUNAMAYAN, HAYALET_SIFIR)
        return ekranKur(Home, 'Home', { depo: { imported_tokens: { acc1: KOVA } } })
    }

    it('logosuz + sifir bakiye GIZLENIR; logosuz + bakiyeli ve logosuz + okunamayan GORUNUR; logolu sifir bakiyeli GORUNUR', async () => {
        const { state } = await kur()
        const semboller = state.displayedTokens.map((t) => t.symbol)
        expect(semboller).toEqual(expect.arrayContaining(['CAKE', 'OKAY', 'HELDG', 'UNRDG']))
        expect(semboller).not.toContain('GHOST')
        expect(semboller).not.toContain('ZEROG')
    })

    it('kaynaklar: paketli dosya, yalniz sunucu gorseli ve bakiyeli logosuz token icin notr monogram', async () => {
        const { html } = await kur()
        expect(html).toContain('src="/tokens/56/0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82.png"')
        expect(html).toContain('src="https://cdn.example/ok-l.png"')
        const monogramlar = [...html.matchAll(/<svg[^>]*data-token-monogram[^>]*>[\s\S]*?<\/svg>/g)].map((m) => m[0])
        expect(monogramlar.length).toBeGreaterThanOrEqual(2)
        // Bakiyeli logosuz token (HELDG) "H" harfiyle gorunur; satirin adi ve bakiyesi de yazili.
        expect(monogramlar.some((m) => />H<\/text>/.test(m))).toBe(true)
        expect(html).toMatch(/5\.0000 HELDG/)
        expect(html).not.toContain('default-token')
    })

    it('monogram notr: gradyan / parlama / renkli palet yok', async () => {
        const { html } = await kur()
        for (const m of html.matchAll(/<svg[^>]*data-token-monogram[^>]*>[\s\S]*?<\/svg>/g)) {
            expect(m[0]).not.toMatch(/gradient|blur|shadow|from-|via-/)
            expect(m[0]).not.toMatch(/(bg|text|fill)-(blue|violet|amber|rose|cyan|indigo|teal|fuchsia|emerald|red|green|purple)-/)
        }
    })

    it('KONTROL: ayni token logosu ISARETLENMEZSE sifir bakiyeyle de gorunur (gizleme gercekten logosuzluktan)', async () => {
        resetLogoState()
        const { state } = await ekranKur(Home, 'Home', { depo: { imported_tokens: { acc1: KOVA } } })
        const semboller = state.displayedTokens.map((t) => t.symbol)
        expect(semboller).toEqual(expect.arrayContaining(['GHOST', 'ZEROG']))
    })

    it('gizli modda Home satiri gizli modun KENDI cozucusunu kullanir: TokenAvatar / monogram cizilmez, uzak adres yok', async () => {
        const { html } = await ekranKur(Home, 'Home', { gizli: true, depo: { imported_tokens: { [GIZLI.key]: { 56: [kayitli(UZAK), kayitli(CAKE)] } } } })
        // CAKE paketli, UZAK paketlisiz+bakiyesiz -> gizli modun kurali gizler; satir logolari <img> (privateTokenLogo), TokenAvatar monogrami degil.
        expect(html).toContain('src="/tokens/56/0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82.png"')
        expect(html).not.toContain('data-token-monogram')
        expect(html).not.toMatch(/cdn\.example|raw\.githubusercontent/)
    })
})

describe('Secici ve arama listeleri -- logosuz token gizlenir', () => {
    it('swapTo (alinacak token): sunucu listesinde logosuz gizlenir, logolu kalir; ice aktarilan ("Tokenlarim") ASLA gizlenmez', async () => {
        kayit.zincirTokenleri = [sunucu(UZAK), sunucu(HAYALET), sunucu(CAKE)]
        logosuzIsaretle(HAYALET, DEPO_HAYALETI)
        const { html } = await ekranKur(SwapTo, 'swapTo', { depo: { imported_tokens: { acc1: { 56: [kayitli(DEPO_HAYALETI)] } } } })
        expect(gorunur(html, 'OKAY')).toBe(true)
        expect(gorunur(html, 'CAKE')).toBe(true)
        expect(gorunur(html, 'GHOST')).toBe(false)
        // Kullanicinin kendi tokeni logosuz da listede, monogramla.
        expect(gorunur(html, 'STORG')).toBe(true)
        expect(html).toContain('data-token-monogram')
        expect(html).not.toContain('default-token')
    })

    it('bridgeTo: sunucu listesinde logosuz gizlenir', async () => {
        kayit.zincirTokenleri = [sunucu(UZAK), sunucu(HAYALET)]
        logosuzIsaretle(HAYALET)
        const { html } = await ekranKur(BridgeTo, 'bridgeTo', { hazirla: () => { cryptoStore().bridge = { inToken: null, outToken: null, toChain: BSC, amount: 0 } } })
        expect(gorunur(html, 'OKAY'), metin(html)).toBe(true)
        expect(gorunur(html, 'GHOST')).toBe(false)
    })

    it('SearchTokens: arama/populer sonuclarinda logosuz gizlenir; "Eklenenler" listesi (Kaldir dugmeli) ASLA gizlenmez', async () => {
        kayit.zincirTokenleri = [sunucu(UZAK), sunucu(HAYALET)]
        logosuzIsaretle(HAYALET, DEPO_HAYALETI)
        const { html } = await ekranKur(SearchTokens, 'SearchTokens', { depo: { imported_tokens: { acc1: { 56: [kayitli(DEPO_HAYALETI)] } } } })
        expect(gorunur(html, 'OKAY')).toBe(true)
        expect(gorunur(html, 'GHOST')).toBe(false)
        expect(gorunur(html, 'STORG')).toBe(true)
        expect(html).toContain('data-token-monogram')
    })

    it('swapFrom (bakiyeli secici): bakiyesi okunan (cuzdandaki) logosuz token kalir (monogramla); bakiyesiz ve sunucu listesindeki logosuz gizlenir', async () => {
        // Cuzdandaki tokenler ice aktarilanlardir (bakiyesi okunur); sunucu listesi kesif icindir ve bakiye bilgisi tasimaz.
        kayit.zincirTokenleri = [sunucu(UZAK), sunucu(HAYALET)]
        kayit.bakiyeler = { [HAYALET_BAKIYELI.address.toLowerCase()]: 3 }
        logosuzIsaretle(HAYALET, HAYALET_BAKIYELI, HAYALET_SIFIR)
        const { html } = await ekranKur(SwapFrom, 'swapFrom', { depo: { imported_tokens: { acc1: { 56: [kayitli(HAYALET_BAKIYELI), kayitli(HAYALET_SIFIR)] } } } })
        expect(gorunur(html, 'OKAY'), metin(html)).toBe(true)
        expect(gorunur(html, 'HELDG'), metin(html)).toBe(true)
        expect(gorunur(html, 'ZEROG')).toBe(false)
        expect(gorunur(html, 'GHOST')).toBe(false)
        expect(html).toContain('data-token-monogram')
    })

    it('SelectAssets (Gonder): kayitli logosuz token bakiyesi varsa kalir, sifirsa gizlenir', async () => {
        kayit.bakiyeler = { [HAYALET_BAKIYELI.address.toLowerCase()]: 2 }
        logosuzIsaretle(HAYALET_BAKIYELI, HAYALET_SIFIR)
        const { html } = await ekranKur(SelectAssets, 'SelectAssets', {
            depo: { imported_tokens: { acc1: { 56: [kayitli(UZAK), kayitli(HAYALET_BAKIYELI), kayitli(HAYALET_SIFIR)] } } },
        })
        expect(gorunur(html, 'OKAY')).toBe(true)
        expect(gorunur(html, 'HELDG')).toBe(true)
        expect(gorunur(html, 'ZEROG')).toBe(false)
    })

    it('KONTROL: isaretlenmeyen ayni token listede KALIR (gizleme logosuzluktan, listeden degil)', async () => {
        kayit.zincirTokenleri = [sunucu(UZAK), sunucu(HAYALET)]
        const { html } = await ekranKur(SwapTo, 'swapTo')
        expect(gorunur(html, 'GHOST')).toBe(true)
    })

    it('gizli modda ortak seciciler satir kumesini degistirmez: logosuz sunucu satiri yine listelenir (yer tutucu monogram)', async () => {
        kayit.zincirTokenleri = [sunucu(UZAK), sunucu(HAYALET)]
        logosuzIsaretle(HAYALET)
        const { html } = await ekranKur(SwapTo, 'swapTo', { gizli: true })
        expect(gorunur(html, 'GHOST')).toBe(true)
        expect(html).not.toContain('cdn.example')
    })
})

describe('Gecmis / islem kayitlari -- kayit ASLA gizlenmez, logosuz token notr monogramla gorunur', () => {
    const ALICI = '0x80B0fa700545984aF65dF8116aD329aF7952E73F'
    async function satir(meta) {
        const app = createApp(TxIdentityLine, { props: { meta } })
        app.use(createTestPinia())
        app.use(createTestI18n('en'))
        return render(app)
    }

    it('islem kimlik satiri: tokenLogo YOKKEN bile token sembolunun monogrami cizilir (eskiden logo hic cizilmezdi)', async () => {
        const html = await satir({ type: 'Transaction', chainId: 56, symbol: 'MYST', tokenName: 'Mystery Token', recipient: ALICI })
        expect(html).toContain('data-token-monogram')
        expect(html).toMatch(/<text[^>]*>M<\/text>/)
        expect(html).not.toContain('default-token')
    })

    it('islem kimlik satiri: logo URL i varsa logo cizilir, monogram cizilmez', async () => {
        const html = await satir({ type: 'Transaction', chainId: 56, symbol: 'CAKE', tokenName: 'PancakeSwap', tokenLogo: '/tokens/56/0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82.png', recipient: ALICI })
        expect(html).toContain('<img src="/tokens/56/0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82.png"')
        expect(html).not.toContain('data-token-monogram')
    })

    it('takas satirinda logosu olmayan taraf monogramla cizilir, logolu taraf logosuyla', async () => {
        const html = await satir({ type: 'Swap', chainId: 56, fromSymbol: 'CAKE', fromLogo: '/usdc.png', toSymbol: 'MYST', toLogo: '' })
        expect(html).toContain('<img src="/usdc.png"')
        expect(html.match(/data-token-monogram/g)).toHaveLength(1)
        expect(html).toMatch(/<text[^>]*>M<\/text>/)
    })

    it('Gecmis detayi (takas): logosuz transfer gizlenmez, token sembolunun monogramini alir', async () => {
        const row = {
            hash: '0x' + 'ab'.repeat(32), chainId: 56, from_address: HESAP.address, to_address: '0x' + '11'.repeat(20), category: 'token swap',
            receipt_status: '1', block_timestamp: new Date().toISOString(), native_transfers: [],
            erc20_transfers: [
                { direction: 'send', token_symbol: 'CAKE', token_address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', token_logo: '', value_formatted: '12.5', log_index: 1 },
                { direction: 'receive', token_symbol: 'MYST', token_logo: '', value_formatted: '300', log_index: 2 },
            ],
        }
        installChromeStub({ currentNetwork: BSC, active_account: HESAP, pending_transactions: [row] })
        const app = createApp(History, { props: { embedded: true } })
        app.use(createTestPinia())
        app.use(createTestI18n('en'))
        networkStore().currentNetwork = BSC
        captureInstance(app, 'History', (i) => { i.setupState.selectedTx = row })
        const html = await render(app)
        expect(html).toContain('-12.5000 CAKE')
        expect(html).toContain('+300.0000 MYST')
        // CAKE: (ag, adres) paketli logo; MYST: kaynak yok -> monogram
        expect(html).toContain('src="/tokens/56/0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82.png"')
        expect(html).toMatch(/<text[^>]*>M<\/text>/)
        expect(html).not.toContain('default-token')
    })
})

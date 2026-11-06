// Home.vue (SSR) -- GIZLI MOD (Private Account) ve varsayilan token tohumu.
//
// KOK NEDEN (merge inceleme turu 1, islev:I1): main'in `ensureDefaultTokens` cagrisi
// (GET /getImportedTokens, en fazla 8 sn) loadCurrentTokens'te listenin kurulmasindan ve
// onceki hesabin bakiye sozlugunun/toplaminin silinmesinden ONCE bekleniyordu. Hedef hesabin
// kovasi tohum gerektirirken Home, bekleme boyunca ONCEKI hesabin satirlarini, bakiyelerini
// ve toplamini YENI hesabin kabugu altinda gosteriyordu. Bu, gizli modda bir gizlilik
// kusurudur: Normal -> Gizli girisinde genel hesabin varliklari gizli ekranda, Gizli -> Normal
// cikisinda Gizli Hesabin satirlari ve toplami HERKESE ACIK ana ekranda gorunurdu.
//
// DUZELTME: bayat durum sifirlamasi (hesap anahtari degistiyse satirlar/sozluk/toplam) bekleme
// oncesine de kondu. Bu dosya: (1) Gizli Hesap tohumu, (2) iki yonde "bekleme sirasinda diger
// tarafin verisi GORUNMEZ" degismezi, (3) ilk gizli giriste sunucu kapaliyken davranis.
//
// DILIM D (gizli-mod cok-ag spec 4.7, P12): Gizli Hesap'in tohumu artik YEREL ({'56': [BNB, USDC, ATS]}, utils/privacy/
// privateDefaultTokens.js) -- (a) ve (c) bu yuzden "sunucu tohumu" yerine "sunucuya HIC gidilmez" der. Genel hesabin
// tohumu (b) sunucudan gelmeye devam eder; (a)'daki bekleme degismezi YEREL yazimi tutan kapiyla (`seedGate`) olculur.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Hermetik saplamalar (Home.defaultTokens.ssr.test.js ile ayni gerekce).
const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))

const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} } }
})

// Gizli Hesap'in YEREL tohum yazimi bu kapiyla TUTULABILIR: `hold` iken ensurePrivateDefaultTokens `release()` cagrilana
// dek bekler. Fabrika kapiya yalniz CAGRI ANINDA dokunur (vi.mock hoisted; const'lar fabrika kosarken henuz tanimsiz).
const seedGate = { hold: false, release: null }
vi.mock('../utils/privacy/privateDefaultTokens', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        ensurePrivateDefaultTokens: async (...args) => {
            if (seedGate.hold) await new Promise((resolve) => { seedGate.release = resolve })
            return actual.ensurePrivateDefaultTokens(...args)
        },
    }
})

const axiosPostMock = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
const axiosGetMock = vi.fn()
vi.mock('axios', () => ({
    default: {
        post: (...args) => axiosPostMock(...args),
        get: (...args) => axiosGetMock(...args),
    },
}))

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { tokenScopeStore } from '../store/tokenScope'
import { privacyStore } from '../store/privacy'
import Home from './Home.vue'
import { resetDefaultTokenSeed } from '../utils/defaultTokenSeed'
import { privateSeedRows } from '../utils/privacy/privateDefaultTokens'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

const img = { thumb: 't', small: 's', large: 'l' }
const ZERO = '0x0000000000000000000000000000000000000000'
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const ATS_ADDRESS = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'

const ETH = { _id: 'e1', name: 'Ethereum', symbol: 'eth', address: ZERO, chain: 'ethereum', decimals: 18, coingecko_id: 'ethereum', image: img }
const USDT = { _id: 'e2', name: 'Tether', symbol: 'usdt', address: USDT_ADDRESS, chain: 'ethereum', decimals: 6, coingecko_id: 'tether', image: img }
const ATS = { _id: 'b1', name: 'Alltoscan', symbol: 'ats', address: ATS_ADDRESS, chain: 'binance-smart-chain', decimals: 18, coingecko_id: 'alltoscan', image: img }
const BNB = { _id: 'b2', name: 'BNB', symbol: 'bnb', address: ZERO, chain: 'binance-smart-chain', decimals: 18, coingecko_id: 'binancecoin', image: img }
const SERVER_DEFAULTS = { 1: [ETH, USDT], 56: [ATS, BNB] }

const GRAM_KEY = '-239|0x0'
const GRAM_ROW = { name: 'GRAM', symbol: 'GRAM', address: '0x0', decimals: 9, coingecko_id: 'the-open-network', id: 'the-open-network' }
const DEFAULT_KEYS = [`1|${ZERO}`, `1|${USDT_ADDRESS}`, `56|${ATS_ADDRESS}`, `56|${ZERO}`]

const PRIVATE_KEY = 'private-0xcccccccc00000000000000000000000000000003'
const PUBLIC_ACCOUNT = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', type: 'hd', name: 'Hesap 1' }
// Gizli Hesap: type 'hd' ama private:true => YALNIZ EVM (utils/accountKind.js).
const PRIVATE_ACCOUNT = { address: '0xCcccCccc00000000000000000000000000000003', key: PRIVATE_KEY, type: 'hd', private: true, name: 'Gizli Hesap' }

const defaultsCalls = () => axiosGetMock.mock.calls.filter(([url]) => String(url).endsWith('/getImportedTokens'))

const answers = () => {
    axiosGetMock.mockImplementation(async (url) => {
        if (String(url).endsWith('/getImportedTokens')) {
            return { status: 200, data: { success: true, importedTokens: SERVER_DEFAULTS } }
        }
        return { status: 200, data: { news: [] } }
    })
}

/** /getImportedTokens'i TUTAR: `release()` cagrilana dek yanit vermez. */
function holdSeedRequest() {
    const held = { release: null }
    axiosGetMock.mockImplementation(async (url) => {
        if (String(url).endsWith('/getImportedTokens')) {
            await new Promise((resolve) => { held.release = resolve })
            return { status: 200, data: { success: true, importedTokens: SERVER_DEFAULTS } }
        }
        return { status: 200, data: { news: [] } }
    })
    return held
}

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    resetDefaultTokenSeed()
    answers()
})

afterEach(() => {
    seedGate.hold = false
    seedGate.release = null
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    axiosGetMock.mockReset()
    axiosPostMock.mockClear()
    useSolanaAssetsMock.mockClear()
    useTokenBalanceMock.mockReset()
    useTokenBalanceMock.mockImplementation(async () => 0)
    delete globalThis.chrome
})

function installStore(initial) {
    return installChromeStub({ currentNetwork: ETH_CHAIN, vaults: [], ...initial })
}

/** `gizli`: Home gizli modda KURULUR (privacy.active, installPrivacySync'in yaptigi gibi). */
async function mountHome({ gizli = false } = {}) {
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    const network = networkStore()
    network.currentNetwork = ETH_CHAIN
    network.rpc = 'https://evm.example/rpc'
    tokenScopeStore().filter = 'all'
    privacyStore().active = gizli
    const captured = captureInstance(app, 'Home')
    await render(app)
    return captured
}

const rowKeys = (captured) => captured.instance.setupState.currentTokens.map((t) => `${t.chainId}|${t.address}`)

/** Bekleme SIRASINDA diger tarafin verisi gorunmemeli: satirlar, bakiyeler, toplam, aktif hesap. */
function expectNothingFromOtherSide(captured, expectedAccountKey) {
    const state = captured.instance.setupState
    expect(state.currentTokens).toEqual([])
    expect(state.evmImportedTokens).toEqual([])
    expect(state.user.tokenBalances).toEqual({})
    expect(state.user.usd).toBe(0)
    expect(state.user.percentage).toBe(0)
    expect(state.user.percentageUSD).toBe(0)
    expect(state.activeAccount.key).toBe(expectedAccountKey)
    expect(state.user.balancesAccountKey).toBe(expectedAccountKey)
}

/** Diger tarafin ekranda GORUNEN verisini taklit eder (guncel bakiye turunun biraktigi durum). */
function paintOtherSide(captured, usd) {
    const state = captured.instance.setupState
    state.user.tokenBalances = { [`1|${ZERO}`]: 1.5 }
    state.user.usd = usd
    state.user.percentage = 2
    state.user.percentageUSD = 1
}

describe('Home.vue (SSR) -- gizli mod: varsayilan token tohumu', () => {
    // (a) NORMAL -> GIZLI GIRIS, gizli kova tohum gerektirir. Tohum YEREL yazilir (P12): sunucu istegi YOK.
    it('normalden gizliye gecis: yerel tohum beklenirken genel hesabin satirlari/bakiyesi GORUNMEZ; sonra gizli kova YEREL tohumlanir', async () => {
        const normalBucket = { 1: [USDT], '-239': [GRAM_ROW] }
        const { localStore } = installStore({
            active_account: PUBLIC_ACCOUNT,
            imported_tokens: { acc1: normalBucket },
        })
        const captured = await mountHome()
        expect(rowKeys(captured)).toEqual([`1|${USDT_ADDRESS}`, GRAM_KEY])
        expect(captured.instance.setupState.user.balancesAccountKey).toBe('acc1')

        // Genel hesabin ekrandaki durumu, sonra Gizli Hesaba gecis (arka plan aktif hesabi degistirdi).
        paintOtherSide(captured, 28)
        captured.instance.setupState.privacy.active = true
        localStore.active_account = PRIVATE_ACCOUNT
        const callsBefore = defaultsCalls().length
        seedGate.hold = true

        const loading = captured.instance.setupState.loadCurrentTokens()
        await vi.waitFor(() => expect(seedGate.release).toBeTypeOf('function'))

        // YEREL YAZIM ASILIYKEN: genel hesaptan hicbir sey gorunmez.
        expectNothingFromOtherSide(captured, PRIVATE_KEY)

        seedGate.release()
        await loading

        // Gizli Hesap EVM-only: yerel tohum (BSC: BNB, USDC, ATS) + S (etkin ag Ethereum) icin uretilen yerel coin satiri;
        // GRAM satiri suzulur. Ethereum tohumu YOK (sunucu tohumu {1: [ETH, USDT]} gizli kovaya girmez).
        const tohum = privateSeedRows()
        expect(rowKeys(captured)).toEqual([...tohum.map((r) => `56|${r.address}`), '1|0x0'])
        expect(captured.instance.setupState.activeAccount.key).toBe(PRIVATE_KEY)

        // Tohum icin SUNUCUYA HIC GIDILMEDI (ne adresli ne adressiz).
        expect(defaultsCalls().slice(callsBefore)).toEqual([])

        // YALNIZ gizli hesabin kovasi yazildi ve yalniz '56' anahtari var; genel kova OLDUGU GIBI.
        expect(Object.keys(localStore.imported_tokens).sort()).toEqual(['acc1', PRIVATE_KEY].sort())
        expect(localStore.imported_tokens.acc1).toEqual(normalBucket)
        expect(Object.keys(localStore.imported_tokens[PRIVATE_KEY])).toEqual(['56'])
        expect(localStore.imported_tokens[PRIVATE_KEY][56]).toEqual(tohum)
    })

    // (b) GIZLI -> NORMAL CIKIS, genel kova hasarli ({'-239':[GRAM]}: main'in duzeltmesinden once import edilmis cuzdan).
    it('gizliden normale cikis (hasarli genel kova): tohum beklenirken Gizli Hesabin satirlari/bakiyesi/toplami GORUNMEZ', async () => {
        const privateBucket = { 1: [ETH, USDT], 56: [ATS, BNB], '-239': [GRAM_ROW] }
        const { localStore } = installStore({
            active_account: PRIVATE_ACCOUNT,
            imported_tokens: { acc1: { '-239': [GRAM_ROW] }, [PRIVATE_KEY]: privateBucket },
        })
        const captured = await mountHome({ gizli: true })
        expect(rowKeys(captured)).toEqual(DEFAULT_KEYS)
        expect(captured.instance.setupState.user.balancesAccountKey).toBe(PRIVATE_KEY)

        paintOtherSide(captured, 56)
        captured.instance.setupState.privacy.active = false
        localStore.active_account = PUBLIC_ACCOUNT
        const held = holdSeedRequest()

        const loading = captured.instance.setupState.loadCurrentTokens()
        await vi.waitFor(() => expect(held.release).toBeTypeOf('function'))

        // ISTEK ASILIYKEN: genel (herkese acik) ana ekranda Gizli Hesaptan hicbir sey gorunmez.
        expectNothingFromOtherSide(captured, 'acc1')

        held.release()
        await loading

        expect(rowKeys(captured)).toEqual([...DEFAULT_KEYS, GRAM_KEY])
        expect(captured.instance.setupState.activeAccount.key).toBe('acc1')
        // Gizli kova dokunulmadi.
        expect(localStore.imported_tokens[PRIVATE_KEY]).toEqual(privateBucket)
        expect(localStore.imported_tokens.acc1[1]).toEqual([ETH, USDT])
    })

    // (c) Ilk gizli giriste sunucu ulasilamaz OLSA DA: Gizli Hesap tohumu YEREL oldugu icin sunucuya hic gidilmez,
    // yani "sunucu kapali" ariza yolu YOKTUR; tohum yazilir, liste S'ye gore dolar.
    it('ilk gizli giriste sunucu hic cagrilmaz (kapali olsa bile firlatmaz); yalniz BSC yerel tohumu yazilir, TON tohumu yazilmaz', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        axiosGetMock.mockImplementation(async (url) => {
            if (String(url).endsWith('/getImportedTokens')) throw new Error('Network Error')
            return { status: 200, data: { news: [] } }
        })
        const { localStore } = installStore({
            active_account: PRIVATE_ACCOUNT,
            imported_tokens: { acc1: { 1: [USDT] } },
        })

        const captured = await mountHome({ gizli: true })

        const loadErrors = errorSpy.mock.calls.filter(([message]) => String(message).includes('Token y'))
        expect(loadErrors).toEqual([])
        expect(defaultsCalls()).toEqual([])
        const tohum = privateSeedRows()
        expect(rowKeys(captured)).toEqual([...tohum.map((r) => `56|${r.address}`), '1|0x0'])
        // Gizli kovada yalniz '56' var ('-239' TON tohumu yazilmaz: Gizli Hesap EVM-yalnizdir); genel kova dokunulmadi.
        expect(Object.keys(localStore.imported_tokens[PRIVATE_KEY])).toEqual(['56'])
        expect(localStore.imported_tokens.acc1).toEqual({ 1: [USDT] })
    })
})

// PF-DD2 (kontrolcu karari): Gizli tohum karari DEPODAKI (taze okunan) aktif hesaptan verilir, `privacy.active`ten DEGIL:
// spec 4.7 P12 hesap tabanlidir ve store, `user.address` izleyicisinin gerisinde kalabilir (gizlilik senkronu ayri bir
// `storage.onChanged` dinleyicisidir). Bu iki test store ile hesabin ANLASAMADIGI yonleri olcer.
describe('Home.vue (SSR) -- tohum karari depodaki hesaptan verilir (store geride kalabilir)', () => {
    it('GIRIS: store hala genel, depodaki hesap Gizli: sunucu tohumu ve TON tohumu YOK, yerel BSC tohumu yazilir', async () => {
        const { localStore } = installStore({
            active_account: PUBLIC_ACCOUNT,
            imported_tokens: { acc1: { 1: [USDT] } },
        })
        const captured = await mountHome({ gizli: false })
        const callsBefore = defaultsCalls().length
        const genelOnce = structuredClone(localStore.imported_tokens.acc1)

        // Arka plan Gizli Hesaba gecti; popup'in gizlilik store'u henuz guncellenmedi (privacy.active false).
        localStore.active_account = PRIVATE_ACCOUNT
        expect(privacyStore().active).toBe(false)
        await captured.instance.setupState.loadCurrentTokens()

        expect(defaultsCalls().slice(callsBefore)).toEqual([])
        const tohum = privateSeedRows()
        expect(Object.keys(localStore.imported_tokens[PRIVATE_KEY])).toEqual(['56'])
        expect(localStore.imported_tokens[PRIVATE_KEY][56]).toEqual(tohum)
        expect(Object.keys(localStore.imported_tokens[PRIVATE_KEY])).not.toContain('-239')
        expect(rowKeys(captured)).toEqual(expect.arrayContaining(tohum.map((r) => `56|${r.address}`)))
        expect(rowKeys(captured)).not.toContain(GRAM_KEY)
        // Genel hesabin kovasi dokunulmadi (ilk normal yukleme onu zaten tohumlamisti).
        expect(localStore.imported_tokens.acc1).toEqual(genelOnce)
    })

    it('CIKIS: store hala Gizli, depodaki hesap normal: kovasina yerel BSC tohumu YAZILMAZ, normal tohum (sunucu + TON) calisir', async () => {
        const { localStore } = installStore({
            active_account: PRIVATE_ACCOUNT,
            imported_tokens: {},
        })
        const captured = await mountHome({ gizli: true })
        const callsBefore = defaultsCalls().length
        expect(privacyStore().active).toBe(true)

        // Arka plan genel hesaba dondu; popup'in gizlilik store'u henuz guncellenmedi (privacy.active hala true).
        localStore.active_account = PUBLIC_ACCOUNT
        localStore.imported_tokens = { ...localStore.imported_tokens, acc1: {} }
        await captured.instance.setupState.loadCurrentTokens()

        expect(defaultsCalls().slice(callsBefore)).toHaveLength(1)
        const normal = localStore.imported_tokens.acc1
        expect(normal[1]).toEqual([ETH, USDT])
        expect(normal[56]).toEqual([ATS, BNB])
        expect(normal[56].map((r) => r.symbol)).not.toContain('USDC')
        expect(Object.keys(normal)).toContain('-239')
    })
})

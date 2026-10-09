// CreateAccount.vue (SSR) -- yeni hesabin varsayilan tokenlari tek kural ve tek yazici uzerinden.
//
// `create()` GERCEKTEN calistirilir (captureInstance ile setupState.create); kasa acma ve
// oturum anahtari saplanir, HD turetme (ethers) ve depo GERCEK. Olculen sey `imported_tokens`.
//
// KAPATILAN HATALAR:
//   1) Eski kod islemin BASINDA okunan anlik goruntuden TUM `imported_tokens` haritasini
//      geri yaziyordu: sifre cozme/turetme/ag istegi suresince baska bir baglamda yapilan
//      yazimlar sessizce ezilirdi.
//   2) Sunucu ulasilamazsa eski kod hesabin kovasini `[]` (DIZI) olarak yaziyordu. Bos dizi
//      "kova var" sayildigi icin varsayilanlar kalici kapaniyordu.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosGetMock = vi.fn()
vi.mock('axios', () => ({ default: { get: (...args) => axiosGetMock(...args) } }))

// Bu dosyanin konusu kasa sifirlama/sifre cozme DEGIL.
vi.mock('../../utils/masterKey', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, requireSessionMasterKey: async () => 'master-key' }
})
vi.mock('../../utils/crypto-utils', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, unlockVault: async () => 'test test test test test test test test test test test junk' }
})
vi.mock('../../utils/ton/newAccountTonAddress', () => ({ tonFieldsForNewAccount: async () => ({}) }))

import { createApp, captureInstance, render, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import CreateAccount from './CreateAccount.vue'

const img = { thumb: 't', small: 's', large: 'l' }
const ZERO = '0x0000000000000000000000000000000000000000'
const ETH = { _id: 'e1', name: 'Ethereum', symbol: 'eth', address: ZERO, chain: 'ethereum', decimals: 18, coingecko_id: 'ethereum', image: img }
const USDT = { _id: 'e2', name: 'Tether', symbol: 'usdt', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', chain: 'ethereum', decimals: 6, coingecko_id: 'tether', image: img }
const ATS = { _id: 'b1', name: 'Alltoscan', symbol: 'ats', address: '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d', chain: 'binance-smart-chain', decimals: 18, coingecko_id: 'alltoscan', image: img }
const BNB = { _id: 'b2', name: 'BNB', symbol: 'bnb', address: ZERO, chain: 'binance-smart-chain', decimals: 18, coingecko_id: 'binancecoin', image: img }
const SERVER_DEFAULTS = { 1: [ETH, USDT], 56: [ATS, BNB] }

const ILK_HESAP = {
    address: '0xAbC0000000000000000000000000000000000001',
    key: 'ilk-hesap', type: 'hd', index: 0, fingerprint: 'fp1', name: 'Hesap 1',
}

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

/** Gercek chrome.storage gibi: get/set derin kopya (bayat anlik goruntu GERCEKTEN bayat). */
function installStorage(initial) {
    const store = clone(initial)
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const wanted = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(wanted.filter((k) => k in store).map((k) => [k, clone(store[k])]))
                },
                set: async (obj) => { Object.assign(store, clone(obj)) },
            },
        },
    }
    return store
}

/** Ekrani acar (onMounted bitene dek) ve `create`i dondurur. */
async function openScreen({ imported_tokens }) {
    const store = installStorage({
        vaults: [{ id: 'v1', type: 'hd', fingerprint: 'fp1', accounts: [ILK_HESAP] }],
        active_account: ILK_HESAP,
        ...(imported_tokens === undefined ? {} : { imported_tokens }),
    })

    const app = createApp(CreateAccount)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const captured = captureInstance(app, 'CreateAccount')
    await render(app)

    return { store, create: captured.instance.setupState.create, page: pageStore() }
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    axiosGetMock.mockReset()
    delete globalThis.chrome
})

describe('CreateAccount.vue -- yeni hesabin varsayilan tokenlari', () => {
    it('yeni hesap varsayilan tokenlarla acilir ve ana ekrana gidilir', async () => {
        const alertSpy = vi.fn()
        vi.stubGlobal('alert', alertSpy)
        axiosGetMock.mockResolvedValue({ status: 200, data: { success: true, importedTokens: SERVER_DEFAULTS } })
        const { store, create, page } = await openScreen({ imported_tokens: { 'ilk-hesap': { 1: [ETH] } } })

        await create()

        expect(alertSpy).not.toHaveBeenCalled()
        const yeniKey = store.active_account.key
        expect(yeniKey).not.toBe('ilk-hesap')
        expect(store.imported_tokens[yeniKey]).toEqual(SERVER_DEFAULTS)
        expect(page.currentPage).toBe('home')
    })

    // Eski kod islemin basinda okudugu anlik goruntuden TUM haritayi geri yaziyordu.
    it('istek suresince degisen BASKA hesabin kovasi EZILMEZ (yalniz yeni hesabin kovasi yazilir)', async () => {
        vi.stubGlobal('alert', vi.fn())
        const kullaniciSatiri = { name: 'USD Coin', symbol: 'usdc', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, coingecko_id: 'usd-coin', image: img }
        axiosGetMock.mockImplementation(async () => {
            // Baska bir baglam ISTEK SIRASINDA ilk hesabin kovasina token ekledi.
            const { imported_tokens } = await globalThis.chrome.storage.local.get('imported_tokens')
            await globalThis.chrome.storage.local.set({
                imported_tokens: { ...imported_tokens, 'ilk-hesap': { 1: [ETH, kullaniciSatiri] } },
            })
            return { status: 200, data: { success: true, importedTokens: SERVER_DEFAULTS } }
        })
        const { store, create } = await openScreen({ imported_tokens: { 'ilk-hesap': { 1: [ETH] } } })

        await create()

        expect(store.imported_tokens['ilk-hesap']).toEqual({ 1: [ETH, kullaniciSatiri] })
        expect(store.imported_tokens[store.active_account.key]).toEqual(SERVER_DEFAULTS)
    })

    // Eski kod burada `[]` (DIZI) yaziyordu: "kova var" sayilip varsayilanlar kalici kapaniyordu.
    it('sunucu ulasilamazsa yeni hesabin kovasi YAZILMAZ ([] dizisi degil) ve ana ekrana gidilir', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const alertSpy = vi.fn()
        vi.stubGlobal('alert', alertSpy)
        axiosGetMock.mockRejectedValue(new Error('Network Error'))
        const { store, create, page } = await openScreen({ imported_tokens: { 'ilk-hesap': { 1: [ETH] } } })

        await create()

        expect(alertSpy).not.toHaveBeenCalled()
        expect(page.currentPage).toBe('home')
        expect(store.imported_tokens[store.active_account.key]).toBeUndefined()
        expect(store.imported_tokens['ilk-hesap']).toEqual({ 1: [ETH] })
    })

    it('depoda imported_tokens HIC yokken de yeni hesabi tohumlar', async () => {
        vi.stubGlobal('alert', vi.fn())
        axiosGetMock.mockResolvedValue({ status: 200, data: { success: true, importedTokens: SERVER_DEFAULTS } })
        const { store, create } = await openScreen({})

        await create()

        expect(store.imported_tokens).toEqual({ [store.active_account.key]: SERVER_DEFAULTS })
    })
})

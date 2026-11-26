// ANA EKRAN BAKIYESI: SON BILINEN DEGER ILK BOYAMADA GORUNUR (oturum onbellegi).
//
// Kurallar (hepsi burada kilitli):
//  - onbellek YALNIZ chrome.storage.session, hesap + ag + para birimi anahtarli
//  - onbellek varken ilk yukleme kapisi canli turu BEKLEMEDEN acilir; yoksa mevcut davranis
//  - GIZLI modda ne okunur ne yazilir
//  - yarim tur yazilmaz
//  - baska hesabin degeri gorunmez
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const sira = vi.hoisted(() => ({ olaylar: [], firlat: false }))

// Kapi: acilis ani ile ilk zincir okumasi arasindaki SIRA olculur.
vi.mock('../utils/firstLoadGate', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        createFirstLoadGate: (opts) => {
            const gercek = actual.createFirstLoadGate(opts)
            return { ...gercek, open: () => { sira.olaylar.push('kapi-acildi'); gercek.open() } }
        },
    }
})

vi.mock('../composables/useTokenBalance', () => ({
    useTokenBalance: async () => {
        sira.olaylar.push('zincir-okuma')
        if (sira.firlat) throw new Error('could not detect network')
        return 2
    },
}))
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: async () => [] }))

const sparkline = Array.from({ length: 144 }, (_, i) => (i === 143 ? 1900 : 2000))
vi.mock('axios', () => ({
    default: {
        post: async () => ({
            status: 200,
            data: { tokens: [{ coingecko_id: 'ethereum', market_data: { priceUSD: 2000, change: { h24: 5 }, sparkline: { d7: sparkline } } }] },
        }),
        get: async () => ({ status: 200, data: { news: [] } }),
    },
}))

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { userStore } from '../store/user'
import { pageStore } from '../store/pageStore'
import { privacyStore } from '../store/privacy'
import Home from './Home.vue'
import { BALANCE_SNAPSHOT_KEY } from '../utils/sessionBalanceCache'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const HESAP = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', type: 'imported' }
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const ROW = `1_${WETH}`

const yerel = (hesap = HESAP) => ({
    currentNetwork: ETH_CHAIN,
    active_account: hesap,
    imported_tokens: { [hesap.key]: { 1: [{ coingecko_id: 'ethereum', address: WETH, decimals: 18, symbol: 'WETH' }] } },
    vaults: [],
})
const kayit = (usd, key = 'acc1|1|usd') => ({
    [BALANCE_SNAPSHOT_KEY]: {
        [key]: { tokenBalances: { [ROW]: { amount: 7, price: 111, value: usd, nowValue: usd, oldValue: usd, change: 1 } }, usd, percentage: 0, percentageUSD: 0, at: 1 },
    },
})

beforeEach(() => {
    sira.olaylar = []
    sira.firlat = false
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})
afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

async function ac({ yerelDepo = yerel(), oturum = {}, gizli = false } = {}) {
    const stub = installChromeStub(yerelDepo, { session: oturum })
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    const network = networkStore()
    network.currentNetwork = ETH_CHAIN
    network.setRpc(ETH_CHAIN.rpc[0].url, ETH_CHAIN.chainId)
    privacyStore().active = gizli
    await render(app)
    return { stub, user: userStore(), page: pageStore() }
}

describe('Home.vue -- bakiye oturum onbellegi', () => {
    it('onbellek varken kapi ILK ZINCIR OKUMASINDAN ONCE acilir ve deger gorunur', async () => {
        sira.firlat = true // canli tur hicbir sey yazamasin: gorunen deger onbellekten
        const { user, page } = await ac({ oturum: kayit(777) })
        expect(user.usd).toBe(777)
        expect(user.tokenBalances[ROW].amount).toBe(7)
        expect(page.firstLoadDone).toBe(true)
        expect(sira.olaylar.indexOf('kapi-acildi')).toBeGreaterThan(-1)
        expect(sira.olaylar.indexOf('kapi-acildi')).toBeLessThan(sira.olaylar.indexOf('zincir-okuma'))
    })

    it('onbellek YOKKEN kapi eskisi gibi canli turdan SONRA acilir', async () => {
        await ac()
        expect(sira.olaylar.indexOf('zincir-okuma')).toBeGreaterThan(-1)
        expect(sira.olaylar.indexOf('kapi-acildi')).toBeGreaterThan(sira.olaylar.indexOf('zincir-okuma'))
    })

    it('canli deger geldiginde onbellek degeri ezilir', async () => {
        const { user } = await ac({ oturum: kayit(777) })
        expect(user.usd).toBe(4000)
        expect(user.tokenBalances[ROW].amount).toBe(2)
    })

    it('tam tur oturum deposuna yazilir, DISKE (local) yazilmaz', async () => {
        const { stub } = await ac()
        const kaydi = stub.sessionStore[BALANCE_SNAPSHOT_KEY]['acc1|1|usd']
        expect(kaydi.usd).toBe(4000)
        expect(kaydi.tokenBalances[ROW].amount).toBe(2)
        expect(stub.localStore[BALANCE_SNAPSHOT_KEY]).toBeUndefined()
    })

    it('YARIM / hatali tur onbellege YAZILMAZ', async () => {
        sira.firlat = true
        const { stub } = await ac()
        expect(stub.sessionStore[BALANCE_SNAPSHOT_KEY]).toBeUndefined()
    })

    it('BASKA hesabin onbellegi gorunmez', async () => {
        sira.firlat = true
        const { user } = await ac({ oturum: kayit(555, 'baska|1|usd') })
        expect(user.usd).toBe(0)
        expect(user.tokenBalances[ROW]?.amount).toBeUndefined()
    })

    it('BASKA agin / para biriminin onbellegi gorunmez', async () => {
        sira.firlat = true
        const a = await ac({ oturum: kayit(555, 'acc1|56|usd') })
        expect(a.user.usd).toBe(0)
        const b = await ac({ oturum: kayit(555, 'acc1|1|try') })
        expect(b.user.usd).toBe(0)
    })

    it('GIZLI hesapta onbellek ne okunur ne yazilir', async () => {
        const gizliHesap = { ...HESAP, key: 'gizli1', private: true }
        const { user, stub } = await ac({
            yerelDepo: yerel(gizliHesap),
            oturum: kayit(555, 'gizli1|1|usd'),
            gizli: true,
        })
        expect(user.usd).not.toBe(555)
        const yazilan = stub.sessionStore[BALANCE_SNAPSHOT_KEY] || {}
        expect(Object.keys(yazilan).filter((k) => k.startsWith('gizli1'))).toEqual(['gizli1|1|usd'])
        expect(yazilan['gizli1|1|usd'].usd).toBe(555) // yalniz tohum olarak koydugumuz kayit; Home DEGISTIRMEDI
    })
})

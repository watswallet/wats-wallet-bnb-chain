// ANA SAYFA, ILK BAKIYE TURU BITMEDEN GOSTERILMEZ (kullanici karari, 2026-09-15).
//
// Kok neden: Home.vue mount olur olmaz ciziliyordu; bakiyeler ise onMounted ->
// startBalanceUpdates icinde ASENKRON geliyordu. Kullanici ilk saniyelerde
// "0.00" portfoy toplamini ve bakiyesiz satirlari goruyordu -- yani cuzdanini
// BOS gibi.
//
// ISBOLUMU: yukleme ekranini App.vue CIZER (gerekcesi orada -- .25s'lik out-in
// gecisi), Home yalnizca kapiyi ACAR. Aralarindaki tek bag `page.firstLoadDone`
// bayragidir; bu dosya Home tarafini, popup/appSplash.ssr.test.js App tarafini
// kilitler.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// KAPIYI ACIK TUTMA ANAHTARI.
//
// SSR'da `onMounted` bittikten SONRA render edilir (bkz. ssrRender.js), yani
// kapi render aninda ZATEN acilmistir -- "tur bitmedi" hali bilesenin ustunden
// dogal yoldan OLCULEMEZ. Bu bayrak, kapiyi hic acilmayacak sahte bir kapiyla
// degistirerek o ani dondurur.
const kapi = vi.hoisted(() => ({ acilmasin: false }))

vi.mock('../utils/firstLoadGate', async (importOriginal) => {
    const actual = await importOriginal()
    const { ref } = await import('vue')
    return {
        ...actual,
        createFirstLoadGate: (...args) => kapi.acilmasin
            ? { ready: ref(false), open: () => {}, dispose: () => {} }
            : actual.createFirstLoadGate(...args),
    }
})

const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))

const axiosPostMock = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
vi.mock('axios', () => ({
    default: {
        post: (...args) => axiosPostMock(...args),
        get: async () => ({ status: 200, data: { news: [] } }),
    },
}))

// Header.vue -> utils/dappFunctions.js zinciri MODUL UST DUZEYINDE
// chrome.windows.onRemoved.addListener cagirir (import ANINDA) -- Home.ssr.test.js
// ile AYNI tuzak, AYNI cozum.
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import Home from './Home.vue'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const HESAP = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    kapi.acilmasin = false
    vi.unstubAllGlobals()
    axiosPostMock.mockClear()
    useSolanaAssetsMock.mockClear()
    delete globalThis.chrome
})

function setup() {
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    networkStore().currentNetwork = ETH_CHAIN
    const page = pageStore()
    return { app, page }
}

describe('Home.vue -- ilk yukleme kapisi', () => {
    it('kapi KAPALIYKEN paylasilan bayrak ACILMAZ', async () => {
        kapi.acilmasin = true
        installChromeStub({ currentNetwork: ETH_CHAIN, active_account: HESAP, imported_tokens: {}, vaults: [] })

        const { app, page } = setup()
        await render(app)

        expect(page.firstLoadDone).toBe(false)
    })

    it('kapi KAPALIYKEN de bakiye yuklemesi KOSAR -- ekran ortulur, SOKULMEZ', async () => {
        // Kilidin asil konusu bu. Yukleme ekrani ana sayfanin YERINE konsaydi
        // Home un icerigi hic kurulmaz, bakiyeleri ceken onMounted hic calismaz
        // ve kapi SONSUZA KADAR kapali kalirdi -- klasik kilitlenme. Ekran bu
        // yuzden bir ORTUDUR: icerik DOM da, ustune biner.
        kapi.acilmasin = true
        installChromeStub({ currentNetwork: ETH_CHAIN, active_account: HESAP, imported_tokens: {}, vaults: [] })

        const { app } = setup()
        const captured = captureInstance(app, 'Home')
        const html = await render(app)

        expect(html, 'ana sayfa icerigi DOM da kalmali').toContain('>Send<')
        // `currentTokens` `null` baslar; ancak loadCurrentTokens kosarsa diziye
        // doner. Yani bu, bakiye boru hattinin kapi KAPALIYKEN de calistiginin
        // dogrudan kanitidir.
        expect(captured.instance.setupState.currentTokens).not.toBeNull()
    })

    it('yukleme ekranini KENDISI cizmez -- ortu tek yerde (App.vue)', async () => {
        // GERILEME KILIDI. Ekran Home a geri tasinirsa .25s lik out-in gecisi
        // boyunca (sayfa artik 'home', Home henuz mount olmamis) BOS bir kare
        // geri gelir -- bkz. popup/appSplash.ssr.test.js bas yorumu.
        kapi.acilmasin = true
        installChromeStub({ currentNetwork: ETH_CHAIN, active_account: HESAP, imported_tokens: {}, vaults: [] })

        const { app } = setup()
        const html = await render(app)

        expect(html).not.toContain('data-splash')
    })

    it('ilk tur bitince paylasilan bayrak ACILIR', async () => {
        installChromeStub({ currentNetwork: ETH_CHAIN, active_account: HESAP, imported_tokens: {}, vaults: [] })

        const { app, page } = setup()
        const html = await render(app)

        expect(page.firstLoadDone).toBe(true)
        expect(html).toContain('>Send<')
    })

    it('ilk tur HATA verse bile bayrak ACILIR -- kullanici cuzdanindan kilitlenmez', async () => {
        // `onMounted`in try blogu her seyi sarar; kapi `finally`de acilmali.
        // Acilmazsa RPC/arka uc bir aksiligi butun cuzdani erisilmez yapardi.
        installChromeStub({ currentNetwork: ETH_CHAIN, active_account: HESAP, imported_tokens: {}, vaults: [] })
        const gercekGet = globalThis.chrome.storage.local.get
        globalThis.chrome.storage.local.get = async (keys) => {
            const istenen = Array.isArray(keys) ? keys : [keys]
            // YALNIZ Home'un kendi ilk okumasi patlar: Header/NewsStrip gibi alt
            // bilesenlerin okumalari bozulursa test baska bir seyi olcmus olurdu.
            if (istenen.includes('isBalanceVisible')) throw new Error('storage patladi')
            return gercekGet(keys)
        }

        const { app, page } = setup()
        await render(app)

        expect(page.firstLoadDone).toBe(true)
    })
})

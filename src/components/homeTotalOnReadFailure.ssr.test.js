// PORTFOY TOPLAMI, OKUNAMAYAN BIR TURDA SIFIRLANMAZ.
//
// KOK NEDEN (kullanici bildirimi, 2026-09-15): konsolda "Connect disconnected!
// Reconnecting..." her ciktiginda ana sayfadaki toplam USD ve gunluk yuzde
// degisim SIFIRA dusuyordu.
//
// Zincir su: o mesaj RPC'nin O ANDA cevap vermedigi anlamina gelir. Ayni anda
// Home'un 10 saniyelik turu (ve reconnect sonrasi `network.rpc` degisiminin
// tetikledigi tur) `updateBalance`i kosturur; her satirin zincirden okumasi
// FIRLATIR, satir basina `catch` satiri dogru bicimde `error` isaretler
// (`amount` yazilmaz, ekranda "—" gorunur) -- ama `nowValue/oldValue/value` HIC
// yazilmadigi icin turun sonundaki toplam 0 cikar ve KOSULSUZ olarak
// `user.usd`/`user.percentage`in uzerine yazilirdi.
//
// Deponun satirlar icin acikca yazdigi kural -- "basarisiz okuma sifira
// CEVRILMEZ: kullanici bakiyesinin sifira dustugunu sanir" -- TOPLAM icin
// uygulanmiyordu. Ekran kendini yalanliyordu: her satir "—", toplam "$0.00".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Zincirden okuma: once calisir, sonra (RPC dustugunde) FIRLATIR.
const okuma = vi.hoisted(() => ({ firlat: false }))
vi.mock('../composables/useTokenBalance', () => ({
    useTokenBalance: async () => {
        if (okuma.firlat) throw new Error('could not detect network')
        return 2
    },
}))

vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: async () => [] }))

const FIYAT = 2000
const ESKI_FIYAT = 1900
const sparkline = Array.from({ length: 144 }, (_, i) => (i === 143 ? ESKI_FIYAT : FIYAT))

vi.mock('axios', () => ({
    default: {
        post: async () => ({
            status: 200,
            data: {
                tokens: [{
                    coingecko_id: 'ethereum',
                    market_data: { priceUSD: FIYAT, change: { h24: 5 }, sparkline: { d7: sparkline } },
                }],
            },
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

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { userStore } from '../store/user'
import { tokenScopeStore } from '../store/tokenScope'
import Home from './Home.vue'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const HESAP = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

beforeEach(() => {
    okuma.firlat = false
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

async function acilisTuru() {
    const stub = installChromeStub({
        currentNetwork: ETH_CHAIN,
        active_account: HESAP,
        imported_tokens: {
            acc1: { 1: [{ coingecko_id: 'ethereum', address: WETH, decimals: 18, symbol: 'WETH' }] },
        },
        vaults: [],
    })

    const pinia = createTestPinia()
    const app = createApp(Home, { props: { embedded: false } })
    app.use(pinia)
    app.use(createTestI18n())
    const network = networkStore()
    network.currentNetwork = ETH_CHAIN
    // RPC KAPISI (updateBalance basi): `network.rpc` yoksa tur HIC kosmaz.
    // Gercek uygulamada bu ucu findFastestRPC/initializeCurrentNetwork doldurur.
    network.setRpc(ETH_CHAIN.rpc[0].url, ETH_CHAIN.chainId)

    const captured = captureInstance(app, 'Home')
    await render(app)
    return { captured, user: userStore(), stub, pinia }
}

describe('Home.vue -- RPC dustugunde portfoy toplami', () => {
    it('ilk tur okunabildiginde toplam ve yuzde yazilir (kontrol)', async () => {
        const { user } = await acilisTuru()
        expect(user.usd).toBe(2 * FIYAT)
        expect(user.percentageUSD).toBe(2 * FIYAT - 2 * ESKI_FIYAT)
    })

    it('HICBIR satir okunamayan turda toplam SIFIRLANMAZ', async () => {
        const { captured, user } = await acilisTuru()
        const oncekiUsd = user.usd
        const oncekiYuzdeUsd = user.percentageUSD

        // RPC dustu: "Connect disconnected! Reconnecting..." aninin ta kendisi.
        okuma.firlat = true
        await captured.instance.setupState.updateBalance()

        expect(user.usd, 'toplam sifirlandi').toBe(oncekiUsd)
        expect(user.percentageUSD, 'gunluk degisim sifirlandi').toBe(oncekiYuzdeUsd)
    })

    it('okunamayan turda satir yine de "okunamadi" isaretlenir', async () => {
        // Toplami korumak, satirin YALAN soylemesine izin vermek DEGIL: satir
        // hala "—" gosterir (deponun mevcut kurali), yalnizca toplam bayat kalir.
        const { captured, user } = await acilisTuru()
        okuma.firlat = true
        await captured.instance.setupState.updateBalance()

        expect(user.tokenBalances[`1_${WETH}`].error).toBe(true)
    })

    // IKINCI YOL: ag filtresi secili oldugunda ekrandaki toplam `user.usd`den
    // DEGIL, `user.tokenBalances` sozlugunden toplanir (filteredUsd/
    // filteredPercentageInfo). O sozlugu `loadCurrentTokens` HER turda siliyor
    // -- ve reconnect `network.rpc`yi degistirdigi icin tam o anda bir tur
    // baslar. Yani ayni semptom ikinci bir kapidan daha girebiliyor.
    it('ag filtresi seciliyken de toplam SIFIRLANMAZ', async () => {
        const { captured, user } = await acilisTuru()
        tokenScopeStore().setFilter(1)
        const oncekiFiltreli = captured.instance.setupState.filteredUsd
        expect(oncekiFiltreli, 'kontrol: filtreli toplam dolu olmali').toBe(2 * FIYAT)

        // reconnect: rpc degisti -> startBalanceUpdates -> loadCurrentTokens (silme)
        // -> updateBalance (RPC dustugu icin her satir firlar).
        okuma.firlat = true
        await captured.instance.setupState.startBalanceUpdates()

        expect(captured.instance.setupState.filteredUsd, 'filtreli toplam sifirlandi').toBe(oncekiFiltreli)
        expect(user.usd, 'genel toplam sifirlandi').toBe(2 * FIYAT)
    })

    // Toplami korumanin KARSI TEHLIKESI: bayat deger BASKA BIR HESABA aitse
    // kullaniciya bir baskasinin (kendi ikinci cuzdaninin) parasi gosterilirdi.
    // Koruma "ayni hesap, gecici ag arizasi" icindir; hesap degisimi icin DEGIL.
    it('hesap degisince onceki hesabin toplami TASINMAZ', async () => {
        const { captured, user, stub } = await acilisTuru()
        expect(user.usd).toBe(2 * FIYAT)

        stub.localStore.active_account = { address: '0xBBBb000000000000000000000000000000000002', key: 'acc2' }
        stub.localStore.imported_tokens = {
            acc2: { 1: [{ coingecko_id: 'ethereum', address: WETH, decimals: 18, symbol: 'WETH' }] },
        }
        // Yeni hesabin turu de basarisiz olsun: en kotu durum.
        okuma.firlat = true
        await captured.instance.setupState.startBalanceUpdates()

        expect(user.usd, 'acc1 in toplami acc2 de gorunuyor').toBe(0)
        expect(user.percentageUSD).toBe(0)
    })

    // home -> token -> home dolasiminda Home SOKULUP yeniden kurulur (App.vue
    // ekranlari `v-if` ile tutuyor). Hesap degisimini olcen hafiza bilesenin
    // ICINDE yasarsa her yeniden kurulumda "hesap degisti" sanilir ve sozluk
    // bosaltilir -- kullanicinin bildirdigi sifirlanma, bu kez gezinmeyle.
    it('Home yeniden mount olunca toplam SIFIRLANMAZ', async () => {
        const { user, pinia } = await acilisTuru()
        expect(user.usd).toBe(2 * FIYAT)

        // Ayni oturum, ayni hesap: SADECE bilesen yeniden kuruluyor.
        okuma.firlat = true
        const app2 = createApp(Home, { props: { embedded: false } })
        app2.use(pinia)
        app2.use(createTestI18n())
        await render(app2)

        expect(user.usd, 'yeniden mount toplami sifirladi').toBe(2 * FIYAT)
    })

    it('RPC geri gelince toplam TAZE degerle guncellenir', async () => {
        const { captured, user } = await acilisTuru()
        okuma.firlat = true
        await captured.instance.setupState.updateBalance()
        okuma.firlat = false
        await captured.instance.setupState.updateBalance()

        expect(user.usd).toBe(2 * FIYAT)
        expect(user.tokenBalances[`1_${WETH}`].error).toBe(false)
    })
})

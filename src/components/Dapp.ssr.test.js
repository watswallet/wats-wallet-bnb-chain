// Dapp.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (F5, kod incelemesi -- 2. tur): bu ekran TAMAMEN EVM'e ozel ve
// `currentNetwork.rpc[0].url`i GUARD'SIZ okuyordu. Solana kaydinda `rpc` alani
// BILEREK yoktur (bkz. vm.js), yani bayat bir `current_request` popup'i buraya
// dusurdugunde bu satir TypeError atardi -- dapp ONAY ekraninin TAM ORTASINDA.
//
// Bu dosyanin VAROLMA SEBEBI bir mutasyon olcumudur: guard kaldirilip
// `rpc.value = currentNetwork.rpc[0].url`e geri donuldugunde 110 dosya / 1547
// testlik paketin TAMAMI YESIL kaliyordu (olculdu). Kaynak-tarama testleri de
// (appDappRoutingWiring.test.js) yalniz App.vue'nun YONLENDIRME kararini
// kilitliyor, Dapp.vue'nun KENDI savunmasini DEGIL.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// EVM regresyon testi guard'i GECER ve ekranin geri kalani (saglayici kurulumu,
// gas/bakiye hesabi) calisir. GERCEK bir RPC'ye cikmamak icin JsonRpcProvider
// saplanir; `ethers`in geri kalani (formatEther, Interface, isAddress...) GERCEK
// kalir -- bu dosyanin konusu ag cagrilari degil, guard'in KENDISI.
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SahteSaglayici {
        constructor(url) { this.url = url }
        async getBalance() { return 10n ** 18n }
        async getTransactionCount() { return 0 }
        async estimateGas() { return 21000n }
        async getFeeData() { return { maxFeePerGas: 1n, gasPrice: 1n } }
        async call() { return '0x' }
        async getNetwork() { return { chainId: 1n } }
    }
    return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: SahteSaglayici } }
})

const axiosPostMock = vi.fn(async () => ({ status: 200, data: {} }))
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args), get: vi.fn(async () => ({ data: {} })) } }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import Dapp from './Dapp.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    axiosPostMock.mockClear()
    delete globalThis.chrome
})

/**
 * installChromeStub `storage.local.remove`i TASIMIYOR (bugune kadar hicbir
 * tuketicisi kullanmadi); Dapp.vue guard yolunda bayat kaydi SILIYOR. Saplama
 * BURADA genisletilir -- paylasilan harness'e dokunmadan.
 */
function setup(chainRecord, currentRequest) {
    const stub = installChromeStub({
        currentNetwork: chainRecord,
        current_request: currentRequest,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', name: 'Hesap 1' },
        vaults: [],
        dapps: {},
    })
    const gonderilenMesajlar = []
    stub.setSendMessage(async (msg) => { gonderilenMesajlar.push(msg); return {} })
    globalThis.chrome.storage.local.remove = async (key) => { delete stub.localStore[key] }

    const app = createApp(Dapp)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord

    const page = pageStore()
    // Kullanici bu ekrandayken baslar; guard tetiklenirse 'home'a DUSMELI.
    page.currentPage = 'dapp'

    return { app, page, stub, gonderilenMesajlar }
}

describe('Dapp.vue (SSR) -- EVM olmayan aktif agda RPC okumasi COKMEZ (Task 15 F5)', () => {
    it('Solana aktif + bayat SEND_TX istegi: cokme yok, Home a donulur, kayit SILINIR, dapp e 4901 bildirilir', async () => {
        const { app, page, stub, gonderilenMesajlar } = setup(SOLANA_CHAIN, {
            type: 'SEND_TX',
            id: 'req-1',
            origin: 'https://dapp.example',
            favicon: '',
            txData: { from: '0xAbCdEf0000000000000000000000000000000001', to: '0x0000000000000000000000000000000000000002', amount: '0x0', data: '0x' },
        })
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        expect(page.currentPage).toBe('home')
        expect(stub.localStore.current_request).toBeUndefined()
        // `rpc` HIC ayarlanmadi: guard'in ONCE geldiginin kaniti.
        expect(captured.instance.setupState.rpc).toBeNull()
        expect(gonderilenMesajlar).toContainEqual(expect.objectContaining({
            type: 'SEND_TX_REJECTED',
            requestId: 'req-1',
            error: expect.objectContaining({ code: 4901 }),
        }))
    })

    it('Solana aktif + bayat CONNECT istegi: Home a donulur ama SEND_TX_REJECTED GONDERILMEZ', async () => {
        const { app, page, stub, gonderilenMesajlar } = setup(SOLANA_CHAIN, { type: 'CONNECT', id: 'req-2' })
        captureInstance(app, 'Dapp')
        await render(app)

        expect(page.currentPage).toBe('home')
        expect(stub.localStore.current_request).toBeUndefined()
        expect(gonderilenMesajlar.some((m) => m.type === 'SEND_TX_REJECTED')).toBe(false)
    })

    // REGRESYON: EVM'de HICBIR SEY degismemeli -- guard sessizce "her zaman
    // kapali" hale gelirse (orn. rpcUrlsOf yanlis alana bakarsa) bu test duser.
    it('EVM aktif: guard TETIKLENMEZ, rpc zincirin ilk ucuna ayarlanir, ekranda KALINIR', async () => {
        const { app, page, stub } = setup(ETH_CHAIN, { type: 'CONNECT', id: 'req-3' })
        const captured = captureInstance(app, 'Dapp')
        await render(app)

        expect(captured.instance.setupState.rpc).toBe(ETH_CHAIN.rpc[0].url)
        expect(page.currentPage).toBe('dapp')
        // Bekleyen istek EVM'de SILINMEZ: guard'in yalniz EVM OLMAYAN zincirde
        // calistiginin kaniti (yoksa her dapp istegi sessizce dusurulurdu).
        expect(stub.localStore.current_request).toEqual({ type: 'CONNECT', id: 'req-3' })
    })
})

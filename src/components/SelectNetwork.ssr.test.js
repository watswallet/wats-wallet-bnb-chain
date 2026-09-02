// SelectNetwork.vue -- Solana secilince "Ag Sec" ekraninda TAKILIP KALINMAZ.
//
// KOK NEDEN: `selectNetwork` `chain.rpc.map(r => r.url)` okuyordu. Solana kaydinda
// `rpc` alani BILEREK yok (vm.js): tiklama TypeError atiyor, fonksiyonun kendi
// try/catch'i onu yutuyor ve `pageStore().currentPage = 'import_token'` satirina
// HIC ULASILMIYORDU -- kullanici ekranda sessizce kaliyordu.
//
// BU DOSYA NEDEN VAR (nihai inceleme, ek bulgu): onceki test
// (utils/selectNetworkWiring.test.js) KAYNAK METNINE bakiyordu -- `rpcUrlsOf(chain)`
// gecen ve `chain.rpc.map` gecmeyen bir fonksiyon govdesi ariyordu. Bu, kendi
// basligindaki iddiayi SAVUNMUYORDU: `const rpc = await findFastestRPC(...)`
// satirindan SONRA tek bir `if (!rpc) return` eklemek, tarif ettigi cikmazi
// BIREBIR geri getiriyor (Solana'da rpcUrlsOf bostur -> findFastestRPC null doner
// -> erken donus -> 'import_token'a hic gecilmez) ve test 1/1 YESIL kaliyordu.
// Olcum yapildi. Artik ekran GERCEKTEN render edilip fonksiyon GERCEKTEN
// calistiriliyor ve VARILAN SAYFA dogrulaniyor.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// findFastestRPC'nin SOZLESMESI taklit edilir, davranisi degil: uc listesi BOSSA
// null, doluysa bir uc. Gercek uygulama bos listede zaten aninda null doner
// (testRPC.js) ve dolu listede AG'A CIKAR -- testte olmasi gereken sey degil.
const findFastestRPCMock = vi.fn(async (urls) =>
    (Array.isArray(urls) && urls.length > 0 ? { url: urls[0], ok: true, ms: 1 } : null))
vi.mock('../utils/testRPC', () => ({ findFastestRPC: (...args) => findFastestRPCMock(...args) }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { rpcUrlsOf } from '../utils/vm'
import SelectNetwork from './SelectNetwork.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    installChromeStub({ currentNetwork: ETH_CHAIN, active_account: { address: '0x1', key: 'acc1' }, vaults: [] })
})

afterEach(() => {
    vi.unstubAllGlobals()
    findFastestRPCMock.mockClear()
    delete globalThis.chrome
})

async function mount() {
    const app = createApp(SelectNetwork)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const captured = captureInstance(app, 'SelectNetwork')
    await render(app)
    return captured
}

describe('SelectNetwork.vue (SSR)', () => {
    it('Solana secilince ice aktarma ekranina GECILIR (uc bulunamasa bile)', async () => {
        const captured = await mount()

        await captured.instance.setupState.selectNetwork(SOLANA_CHAIN)

        // Bu satir, kaynak taramasinin savunamadigi iddianin ta kendisi.
        expect(pageStore().currentPage).toBe('import_token')

        const network = networkStore()
        expect(network.currentNetwork.chainId).toBe('solana-mainnet')
        // Solana kaydinda uc YOK: findFastestRPC BOS liste ile cagrilir ve null doner.
        expect(findFastestRPCMock).toHaveBeenCalledWith([])
        // Yukleme gostergesi kapatilir (finally): aksi halde ekran siyah bir
        // katmanin altinda kalirdi.
        expect(captured.instance.setupState.loading).toBe(false)
    })

    // EVM REGRESYONU: ayni yol degismedi -- uc bulunur ve rpc'ye YAZILIR.
    it('EVM zinciri secilince en hizli uc secilir ve ayni ekrana gecilir', async () => {
        const captured = await mount()

        await captured.instance.setupState.selectNetwork(ETH_CHAIN)

        expect(pageStore().currentPage).toBe('import_token')
        const network = networkStore()
        expect(network.currentNetwork.chainId).toBe(1)
        // Mock, listenin ILK ucunu doner; setRpc'ye giden deger bu olmali.
        expect(network.rpc).toBe(rpcUrlsOf(ETH_CHAIN)[0])
        expect(findFastestRPCMock.mock.calls[0][0].length).toBeGreaterThan(0)
    })

    // Bir uc bulunamamasi (ag arizasi) da EVM'de ekranda TAKILMAYA yol acmamali:
    // kullanici zinciri sectiyse o zincire GECMIS olmali.
    it('EVM zincirinde hicbir uc cevap vermese de ekran degisir', async () => {
        findFastestRPCMock.mockResolvedValueOnce(null)
        const captured = await mount()

        await captured.instance.setupState.selectNetwork(ETH_CHAIN)

        expect(pageStore().currentPage).toBe('import_token')
        expect(captured.instance.setupState.loading).toBe(false)
    })
})

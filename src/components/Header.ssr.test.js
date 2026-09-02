// Header.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN: Task 15 oncesi ATS yakit hapi ve dapp baglanti girisi (EIP-1193)
// Solana aktifken de KOSULSUZ render ediliyor, ustelik `loadConnectionState`
// (dugme gizli olsa bile HER ag degisiminde calisan bir fonksiyon) Solana'nin
// METIN chainId'sini `Number()`e sokup NaN'i bagli dapp'in `allowedChains`
// listesine YAZIYOR ve anlamsiz bir "ag etkinlestirildi" banner'i tetikliyordu.
// Bu dosya davranisa bakar: hem GORUNURLUK hem de bu ikinci (gorunmez) yan etki.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import Header from './Header.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const POLYGON_CHAIN = supported_chains.find((c) => c.chainId === 137)

// document.addEventListener (disari tiklama) bu SSR ortaminda (DOM yok) yoksa
// crash eder -- konumuzun disinda, zararsiz sahte ile atlanir.
beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

/**
 * `chrome.tabs.query` (installChromeStub'ta YOK) burada elle eklenir ki
 * `currentTabHostname` cozulebilsin. `dapps` zaten baglanmis bir dapp'i temsil eder.
 */
function setup(chainRecord, { hostname = 'example.com', dapps = {}, activeAccount, sendMessageImpl } = {}) {
    // Stub ONCE (networkStore()'dan) once kurulur: store olusunca fire-and-forget
    // baslattigi initializeCurrentNetwork() `chrome.storage`i hemen okumaya calisir --
    // stub yoksa bu bir ReferenceError (yakalanip loglanir, zararsiz ama gurultulu).
    const stub = installChromeStub({
        currentNetwork: chainRecord,
        active_account: activeAccount || { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
        user: { username: 'tester' },
        vaults: [],
        dapps,
    })
    globalThis.chrome.tabs = { query: async () => [{ url: `https://${hostname}` }] }
    if (sendMessageImpl) stub.setSendMessage(sendMessageImpl)

    const app = createApp(Header, { props: { dappMode: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord

    return { app, network, stub }
}

describe('Header.vue (SSR) -- ATS hapi Solana da GORUNMEZ (Task 15)', () => {
    it('EVM aktifken ATS yakit hapi GORUNUR', async () => {
        const { app } = setup(ETH_CHAIN)
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(html).toContain('ats.png')
        expect(captured.instance.setupState.features.ats).toBe(true)
    })

    it('Solana aktifken ATS yakit hapi GORUNMEZ', async () => {
        const { app } = setup(SOLANA_CHAIN)
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(html).not.toContain('ats.png')
        expect(captured.instance.setupState.features.ats).toBe(false)
    })
})

describe('Header.vue (SSR) -- dapp baglanti girisi Solana da GORUNMEZ (Task 15)', () => {
    it('EVM aktifken baglanti dugmesi GORUNUR (title: hostname + baglanti durumu)', async () => {
        const { app } = setup(ETH_CHAIN, { hostname: 'example.com', dapps: {} })
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(html).toContain('Not Connected')
        expect(captured.instance.setupState.features.dapp).toBe(true)
    })

    it('Solana aktifken baglanti dugmesi GORUNMEZ (currentTabHostname cozulse bile)', async () => {
        const { app } = setup(SOLANA_CHAIN, { hostname: 'example.com', dapps: {} })
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(html).not.toContain('Not Connected')
        expect(captured.instance.setupState.features.dapp).toBe(false)
        // Hostname yine de cozulmus olmali (baska bir kod yolu bunu kullanir);
        // yalniz dugme GIZLI.
        expect(captured.instance.setupState.currentTabHostname).toBe('example.com')
    })
})

// IKINCI (GORUNMEZ) YAN ETKI: loadConnectionState dugme gizli olsa bile HER
// ag degisiminde calisir ve onceden Solana'da NaN'i `allowedChains`'e yaziyordu.
describe('Header.vue (SSR) -- loadConnectionState EVM-disi chainId yi allowedChains e YAZMAZ', () => {
    it('EVM (regresyon): baglanmamis zincir allowedChains e EKLENIR, banner tetiklenir', async () => {
        const dapps = { 'example.com': { accounts: ['0xAbCdEf0000000000000000000000000000000001'], allowedChains: [1] } }
        const { app, stub } = setup(POLYGON_CHAIN, { hostname: 'example.com', dapps })
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.editableChains).toEqual([1, 137])
        expect(captured.instance.setupState.dappNetworkActivated).toBe(true)
        expect(stub.localStore.dapps['example.com'].allowedChains).toEqual([1, 137])
    })

    it('Solana: allowedChains DEGISMEZ (NaN yazilmaz), banner tetiklenmez', async () => {
        const dapps = { 'example.com': { accounts: ['0xAbCdEf0000000000000000000000000000000001'], allowedChains: [1, 137] } }
        const { app, stub } = setup(SOLANA_CHAIN, { hostname: 'example.com', dapps })
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.editableChains).toEqual([1, 137])
        expect(captured.instance.setupState.editableChains).not.toContain(NaN)
        expect(captured.instance.setupState.dappNetworkActivated).toBe(false)
        // Depoya YAZILMADI: orijinal dizi degismeden kaldi.
        expect(stub.localStore.dapps['example.com'].allowedChains).toEqual([1, 137])
    })
})

// TASK 16b: Header aktif hesabin adresini gosterir; Solana'da bu `solanaAddress`
// olmali, `activeAccount.address` (HER ZAMAN EVM) DEGIL -- aksi halde kopyalama
// dugmesi kullanicinin kontrol ETMEDIGI bir adresi "senin adresin" gibi sunardi.
describe('Header.vue (SSR) -- aktif adres gosterimi Solana da solanaAddress (Task 16b)', () => {
    it('EVM REGRESYONU: EVM aktifken headerAddress activeAccount.address kalir, "EVM" etiketi gorunur', async () => {
        const { app } = setup(ETH_CHAIN)
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(captured.instance.setupState.headerAddress).toBe('0xAbCdEf0000000000000000000000000000000001')
        expect(html).toContain('EVM')
        expect(html).not.toContain('>Solana<')
    })

    it('Solana: active_account.solanaAddress HAZIRSA dogrudan kullanilir, "Solana" etiketi gorunur', async () => {
        const SOL_ADDR = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        const { app } = setup(SOLANA_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001', solanaAddress: SOL_ADDR, key: 'acc1' },
        })
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(captured.instance.setupState.headerAddress).toBe(SOL_ADDR)
        expect(html).toContain(SOL_ADDR.slice(0, 6))
        expect(html).not.toContain('0xAbCdEf0000000000000000000000000000000001')
    })

    it('Solana: solanaAddress YOKSA SOLANA_GET_ADDRESS ile cozulur', async () => {
        const SOL_ADDR = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
        const { app } = setup(SOLANA_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
            sendMessageImpl: async (msg) => (msg?.type === 'SOLANA_GET_ADDRESS' ? { result: { address: SOL_ADDR } } : { error: 'unexpected' }),
        })
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.headerAddress).toBe(SOL_ADDR)
    })

    // COZUM BASARISIZ: EVM adresine SESSIZCE DUSMEK, kullaniciya kontrol
    // ETMEDIGI bir adresi kendi adresiymis gibi gosterir. (Ustteki identicon
    // SEED'i kozmetik amacli EVM adresine duser -- bkz. sablondaki yorum --
    // bu yuzden burada KOPYALAMA metnini/degerini kontrol ederiz, TUM html'i
    // degil.)
    it('Solana: cozum basarisiz olursa headerAddress null kalir, EVM adresine DUSULMEZ', async () => {
        const { app } = setup(SOLANA_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
            sendMessageImpl: async () => { throw new Error('kasa kilitli') },
        })
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(captured.instance.setupState.headerAddress).toBe(null)
        // Kopyalama satiri '...' gosterir (bkz. sablon: `headerAddress ? shortenAddress(...) : '...'`).
        expect(html).toContain('font-mono tracking-wide">...</span>')
        expect(html).not.toContain('AbCdEf0000000000000000000000000000000001<')
    })

    it('hesap degistirilince YENI hesabin Solana adresi cozulur, ESKISI sizmaz', async () => {
        const OLD_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        const NEW_SOL = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
        const newAccount = { address: '0xffffffffffffffffffffffffffffffffffffffff', solanaAddress: NEW_SOL, key: 'acc2', fingerprint: 'fp2' }

        const { app, stub } = setup(SOLANA_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001', solanaAddress: OLD_SOL, key: 'acc1' },
        })
        stub.localStore.vaults = [{ fingerprint: 'fp2', accounts: [newAccount] }]
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.headerAddress).toBe(OLD_SOL)

        await captured.instance.setupState.changeAccount(newAccount)

        expect(captured.instance.setupState.headerAddress).toBe(NEW_SOL)
    })
})

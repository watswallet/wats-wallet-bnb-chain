// Bayrak KAPALIYKEN baslik bir Solana oturumunu BAGLI SAYMAZ.
//
// KOK NEDEN: baslik bu turda `solana_dapps` kaydini okumaya BASLADI ama
// `SOLANA_ENABLED` bayragini SORMUYORDU. Kardes bilesen (settings/Dapps.vue)
// tam bu tehlike icin acik bir kapi tasiyor ve gerekcesini de yaziyor:
// "Baglantiyi kes dugmesi arka plan kapisina (DISCONNECT_SOLANA_DAPP) carpip
// SESSIZCE hicbir sey yapmazdi."
//
// Somut zarar: yayin derlemesinde bayrak KAPALI (client/.env.production). Diskte
// eskiden kalma bir `solana_dapps` kaydi olan kullanici o siteye girer; baslik
// YESIL "Bagli" der, kullanici "Baglantiyi Kes"e basar, background.js'in
// `if (!SOLANA_ENABLED && isSolanaAction(action))` kapisi istegi reddeder ve
// HICBIR SEY olmaz. Kullanici icin cuzdan "kesmiyor".
//
// AYRI DOSYA ZORUNLU: `SOLANA_ENABLED` derleme zamani sabiti (featureFlags.js) ve
// vitest.config.js butun takimi `VITE_SOLANA_ENABLED: 'true'` ile kosturuyor.
// Bayragin KAPALI hali ancak modul mock'uyla ve dosya basinda sinanabilir --
// depodaki `*solanaFlagOff*` dosyalarinin hepsi ayni sebeple ayri duruyor.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bayrak KAPALI: bu dosyanin TEK konusu.
vi.mock('../utils/featureFlags', () => ({ SOLANA_ENABLED: false }))

// Header.vue -> utils/dappFunctions.js zinciri MODUL UST DUZEYINDE
// chrome.windows.onRemoved.addListener cagirir (ayni tuzak: Header.ssr.test.js).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import Header from './Header.vue'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SOLANA_OTURUM = { address: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK', accountKey: 'acc1' }
const TON_OTURUM = { address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG', accountKey: 'acc1' }

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup({ hostname = 'jup.ag', dapps = {}, ton_dapps = {}, solana_dapps = {}, sendMessageImpl } = {}) {
    const stub = installChromeStub({
        currentNetwork: ETH_CHAIN,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', type: 'hd' },
        user: { username: 'tester' },
        vaults: [],
        dapps,
        ton_dapps,
        solana_dapps,
    })
    globalThis.chrome.tabs = { query: async () => [{ url: `https://${hostname}` }] }
    if (sendMessageImpl) stub.setSendMessage(sendMessageImpl)

    const app = createApp(Header, { props: { dappMode: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    networkStore().currentNetwork = ETH_CHAIN

    return { app, stub }
}

describe('Header.vue (SSR) -- SOLANA_ENABLED kapaliyken Solana oturumu YOK SAYILIR', () => {
    it('diskte solana_dapps kaydi OLSA BILE site BAGLI gorunmez', async () => {
        const { app } = setup({ solana_dapps: { 'https://jup.ag': SOLANA_OTURUM } })
        const captured = captureInstance(app, 'Header')
        const html = await render(app)

        expect(captured.instance.setupState.solanaConnected).toBe(false)
        expect(captured.instance.setupState.isConnected).toBe(false)
        expect(html).toContain('Not Connected')
    })

    // Kesme mesaji da SUSMALI: arka plan kapisi onu zaten reddediyor
    // (background.js SOLANA_DISABLED) ve gonderilmesi kullaniciya "bir sey
    // yapildi" izlenimi verirdi.
    it('baglantiyi kes DISCONNECT_SOLANA_DAPP GONDERMEZ', async () => {
        const gonderilen = []
        const { app } = setup({
            solana_dapps: { 'https://jup.ag': SOLANA_OTURUM },
            ton_dapps: { 'jup.ag': TON_OTURUM },
            sendMessageImpl: async (m) => { gonderilen.push(m); return { success: true } },
        })
        const captured = captureInstance(app, 'Header')
        await render(app)

        await captured.instance.setupState.disconnectDapp()

        expect(gonderilen.find((m) => m.type === 'DISCONNECT_SOLANA_DAPP')).toBeUndefined()
        // TON dali bayraktan ETKILENMEZ: ayni cagride o mesaj AYNEN gider.
        expect(gonderilen).toContainEqual({ type: 'DISCONNECT_TON_DAPP', hostname: 'jup.ag' })
    })

    // BAYRAK EVM VE TON'A DOKUNMAZ. Kapiyi cok genis yazan bir surum (or.
    // `isConnected`i tumden bayraga baglamak) yayin derlemesinde EVM dapp
    // baglantisini de olduruderdi.
    it('EVM oturumu bayraktan ETKILENMEZ', async () => {
        const dapps = { 'jup.ag': { accounts: ['0xAbCdEf0000000000000000000000000000000001'], allowedChains: [1] } }
        const { app } = setup({ dapps })
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.evmConnected).toBe(true)
        expect(captured.instance.setupState.isConnected).toBe(true)
    })

    it('TON oturumu bayraktan ETKILENMEZ', async () => {
        const { app } = setup({ ton_dapps: { 'jup.ag': TON_OTURUM } })
        const captured = captureInstance(app, 'Header')
        await render(app)

        expect(captured.instance.setupState.tonConnected).toBe(true)
        expect(captured.instance.setupState.isConnected).toBe(true)
    })
})

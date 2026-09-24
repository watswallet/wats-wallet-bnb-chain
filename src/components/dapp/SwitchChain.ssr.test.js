// SwitchChain.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// NEDEN GEREKLI: bu ekranin dort yonlendirme noktasi ve sablon v-if'i METIN
// TARAMASIYLA kilitli (appDappRoutingWiring.test.js) -- yani "adi dogru yere
// yazilmis mi" sorusu cevaplaniyor, "kullanici ne goruyor" sorusu DEGIL.
// Metin taramasi gecen bir ekran yine de bos cizebilir, yanlis zinciri
// gosterebilir ya da onaylandiginda dapp'e YANLIS ZARF gonderebilir.
//
// EN KRITIK IDDIA: basari zarfinda `data: { result: null }` BULUNMASI.
// `data` eksik olsaydi resolvePendingRequest (dappFunctions.js) `data.result`
// okurken TypeError atardi; cagri await'siz/catch'siz oldugu icin bu yakalanmayan
// bir promise reddi olur, `sendResponse` HIC cagrilmaz, `current_request` diskten
// HIC silinmez ve dapp'in await'i SONSUZA asili kalirdi. Testler bunu `toEqual`
// ile degil alan alan sorar ki `null` ile `undefined` ayrimi kaybolmasin.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// SwitchChain.vue -> utils/dappFunctions.js zinciri (applyNetworkChange uzerinden
// degil, switchChainRequest uzerinden gelse de test-utils zinciri) MODUL UST
// DUZEYINDE chrome'a dokunabiliyor; ConnectDapp.ssr.test.js'teki AYNI tuzak.
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

// Ag degistirmenin GERCEK govdesi pinia store'lari ve ag erisimi ister; burada
// olculen sey EKRANIN SOZLESMESI, applyNetworkChange'in kendisi degil (onun
// kendi testleri var). Sahte govde, cagrildiginda diski gercekten gunceller --
// ekranin "gercekten gecildi mi" kontrolu bu yuzden anlamli kalir.
const networkChangeCalls = []
vi.mock('../../utils/applyNetworkChange', () => ({
    applyNetworkChange: vi.fn(async (chain) => {
        networkChangeCalls.push(chain)
        if (globalThis.__switchBasarisiz) return false
        await chrome.storage.local.set({ currentNetwork: chain })
        return true
    }),
}))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import SwitchChain from './SwitchChain.vue'

const EVM_ADRES = '0xAaaa000000000000000000000000000000000001'
const EVM_HESAP = { key: 'acc-evm', type: 'hd', name: 'Hesap A', address: EVM_ADRES }
const TON_HESAP = { key: 'acc-ton', type: 'ton', name: 'TON 1', address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG' }

const ETH_AGI = { chainId: 1, name: 'Ethereum' }
const TON_AGI = { chainId: -239, kind: 'ton', name: 'TON' }

const ISTEK = {
    type: 'SWITCH_CHAIN',
    id: 'req-switch-1',
    origin: 'https://app.dedust.io',
    requestedChainId: 56,
    requestedChainName: 'BNB Smart Chain',
}

beforeEach(() => {
    networkChangeCalls.length = 0
    delete globalThis.__switchBasarisiz
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup({ account = EVM_HESAP, currentNetwork = ETH_AGI, istek = ISTEK } = {}) {
    const stub = installChromeStub({
        current_request: istek,
        active_account: account,
        currentNetwork,
    })
    const gonderilen = []
    stub.setSendMessage(async (m) => { gonderilen.push(m); return {} })

    const app = createApp(SwitchChain)
    app.use(createTestPinia())
    app.use(createTestI18n())
    pageStore().currentPage = 'switch_chain'

    return { app, stub, gonderilen }
}

describe('SwitchChain.vue (SSR) -- ne ciziliyor', () => {
    it('mevcut ve hedef agin ADLARI ekranda gorunur', async () => {
        const { app } = setup()
        const html = await render(app)

        expect(html).toContain('Ethereum')
        expect(html).toContain('BNB Smart Chain')
    })

    it('istegi yapan sitenin hostname i gorunur', async () => {
        const { app } = setup()
        const html = await render(app)

        expect(html).toContain('app.dedust.io')
    })

    // FAIL-CLOSED hesap kapisi: EVM oldugu KANITLANAMAYAN hesapta gecis
    // dugmesi HIC cizilmez -- soluk/kilitli birakilmaz (ConnectDapp.vue ile
    // ayni gorsel dil).
    it('EVM adresi olmayan hesapta onay dugmesi CIZILMEZ', async () => {
        const { app } = setup({ account: TON_HESAP })
        const html = await render(app)

        expect(html).not.toContain('evm-switch-chain-approve')
    })

    it('EVM hesabinda onay dugmesi CIZILIR', async () => {
        const { app } = setup()
        const html = await render(app)

        expect(html).toContain('evm-switch-chain-approve')
    })

    // Metodun VAR OLMA SEBEBI: EVM disi agdayken de ekran calisir olmali.
    it('aktif ag TON iken de ekran cizilir ve onay dugmesi durur', async () => {
        const { app } = setup({ currentNetwork: TON_AGI })
        const html = await render(app)

        expect(html).toContain('BNB Smart Chain')
        expect(html).toContain('evm-switch-chain-approve')
    })
})

describe('SwitchChain.vue (SSR) -- dapp e donen zarf', () => {
    it('ONAY: agi degistirir ve data.result NULL olan basari zarfi gonderir', async () => {
        const { app, gonderilen } = setup()
        const holder = captureInstance(app, 'SwitchChain')
        await render(app)

        await holder.instance.setupState.approve()

        expect(networkChangeCalls).toHaveLength(1)
        expect(networkChangeCalls[0].chainId).toBe(56)

        const zarf = gonderilen.at(-1)
        expect(zarf.type).toBe('CONNECT_WALLET_SUCCESS')
        expect(zarf.status).toBe('success')
        expect(zarf.requestId).toBe('req-switch-1')
        // `data` VAR ve `result` alani ACIKCA null -- `undefined` DEGIL.
        expect(zarf.data).toBeTruthy()
        expect('result' in zarf.data).toBe(true)
        expect(zarf.data.result).toBeNull()
    })

    it('RED: 4001 kodlu NESNE hata gonderir ve agi DEGISTIRMEZ', async () => {
        const { app, gonderilen } = setup()
        const holder = captureInstance(app, 'SwitchChain')
        await render(app)

        await holder.instance.setupState.cancel()

        expect(networkChangeCalls).toHaveLength(0)
        const zarf = gonderilen.at(-1)
        expect(zarf.type).toBe('CONNECT_WALLET_REJECTED')
        expect(zarf.error).toEqual({ code: 4001, message: expect.any(String) })
    })

    // applyNetworkChange "ag degisti mi" DEGIL "RPC erisilebilir mi" doner ve
    // desteklenmeyen bir zincirde setCurrentNetwork SESSIZCE reddeder. Ekran
    // basariyi onun donusunden TUREMEZ, DISKTEN dogrular -- aksi halde dapp ile
    // cuzdan ayrisir: dapp "gectim" sanir, cuzdan eski agda kalir.
    it('ag GERCEKTEN degismediyse basari DEGIL hata gonderir', async () => {
        globalThis.__switchBasarisiz = true
        const { app, gonderilen } = setup()
        const holder = captureInstance(app, 'SwitchChain')
        await render(app)

        await holder.instance.setupState.approve()

        const zarf = gonderilen.at(-1)
        expect(zarf.type).toBe('CONNECT_WALLET_REJECTED')
        expect(zarf.error.code).toBe(4901)
    })

    // Kullanici onay ekrani acikken ana popup'tan baska bir hesaba gecmis
    // olabilir; sablondaki v-if yalnizca ARAYUZ durumudur, GARANTI degil
    // (ConnectDapp.vue'daki FIX 6 ile ayni gerekce).
    it('onay aninda hesap EVM siz olmussa 4100 doner, ag DEGISMEZ', async () => {
        const { app, stub, gonderilen } = setup()
        const holder = captureInstance(app, 'SwitchChain')
        await render(app)

        await chrome.storage.local.set({ active_account: TON_HESAP })
        await holder.instance.setupState.approve()

        expect(networkChangeCalls).toHaveLength(0)
        expect(gonderilen.at(-1).error.code).toBe(4100)
        expect(stub).toBeTruthy()
    })

    it('onay aninda zaten hedef agdaysak gecis DENENMEZ, null basari doner', async () => {
        const { app, gonderilen } = setup()
        const holder = captureInstance(app, 'SwitchChain')
        await render(app)

        await chrome.storage.local.set({ currentNetwork: { chainId: 56, name: 'BNB Smart Chain' } })
        await holder.instance.setupState.approve()

        expect(networkChangeCalls).toHaveLength(0)
        expect(gonderilen.at(-1).type).toBe('CONNECT_WALLET_SUCCESS')
        expect(gonderilen.at(-1).data.result).toBeNull()
    })
})

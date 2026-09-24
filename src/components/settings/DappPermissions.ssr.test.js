// DappPermissions.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (§8 R4c): bu ekran Header'dan BAGIMSIZ IKINCI bir yazicidir --
// vaults duzlestirmesi Header.vue:863 ile bayt-es, ve savePermissions ayni
// `dapps[host].accounts` anahtarina yaziyor. Yalnizca Header kapatilirsa R4
// Ayarlar -> Dapp'ler -> Izinler yolundan ACIK KALIR.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// DappPermissions.vue -> utils/dappFunctions.js zinciri (FIX 5, isEvmDappAddress
// ithali) MODUL UST DUZEYINDE chrome.windows.onRemoved.addListener cagirir; o
// satir import ANINDA calisir, installChromeStub ise ancak test govdesinde.
// vi.hoisted olmadan asagidaki `import DappPermissions from './DappPermissions.vue'`
// "chrome is not defined" ile patlar (ayni tuzak: ConnectDapp.ssr.test.js,
// dappFunctions.tonGate.test.js).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import DappPermissions from './DappPermissions.vue'

const EVM_ADRES = '0xAaaa000000000000000000000000000000000001'
const TON_UQ = 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG'

const EVM_HESAP = { key: 'acc-evm', type: 'hd', name: 'Hesap A', address: EVM_ADRES }
const TON_HESAP = { key: 'acc-ton', type: 'ton', name: 'TON 1', address: TON_UQ, tonAddress: TON_UQ }

const EVM_KASA = { fingerprint: 'f-evm', type: 'hd', accounts: [EVM_HESAP] }
const TON_KASA = { fingerprint: 'f-ton', type: 'tonMnemonic', accounts: [TON_HESAP] }

const HOST = 'uniswap.org'

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup({ accounts = [EVM_ADRES] } = {}) {
    const stub = installChromeStub({
        vaults: [EVM_KASA, TON_KASA],
        dapps: { [HOST]: { accounts, allowedChains: [1], favicon: '', chainId: '0x1' } },
    })

    const app = createApp(DappPermissions, { props: { dapp: HOST } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    return { app, stub }
}

describe('DappPermissions.vue (SSR) -- hesap listesi', () => {
    it('TON hesabi listede HIC CIZILMEZ', async () => {
        const { app } = setup()
        const html = await render(app)

        // TAM adres identicon'un seed parametresinde geciyor
        // (`?seed=${acc.address}`), yani satir cizilseydi burada gorunurdu.
        expect(html).not.toContain(TON_UQ)
        expect(html).not.toContain('TON 1')
    })

    it('EVM hesabi listede DURUR (kapi genel bir kapatma degil)', async () => {
        const { app } = setup()
        const html = await render(app)
        expect(html).toContain(EVM_ADRES)
        expect(html).toContain('Hesap A')
    })
})

describe('DappPermissions.vue (SSR) -- kayda yazim', () => {
    // Listeyi suzmek TEK BASINA YETMEZ: editableAccounts DISKTEN yukleniyor
    // (:193) ve onceden yazilmis bir `UQ...` kaydi orada duruyor olabilir.
    // Yalniz listeyi suzen bir uygulama bu testi GECEMEZ.
    it('diskteki eski UQ kaydi savePermissions ile GERI YAZILMAZ', async () => {
        const { app, stub } = setup({ accounts: [EVM_ADRES, TON_UQ] })
        const holder = captureInstance(app, 'DappPermissions')
        await render(app)

        await holder.instance.setupState.savePermissions()

        expect(stub.localStore.dapps[HOST].accounts).toEqual([EVM_ADRES])
    })

    it('yalniz EVM adresi olan kayit degismeden yazilir', async () => {
        const { app, stub } = setup({ accounts: [EVM_ADRES] })
        const holder = captureInstance(app, 'DappPermissions')
        await render(app)

        await holder.instance.setupState.savePermissions()

        expect(stub.localStore.dapps[HOST].accounts).toEqual([EVM_ADRES])
        expect(stub.localStore.dapps[HOST].allowedChains).toEqual([1])
    })
})

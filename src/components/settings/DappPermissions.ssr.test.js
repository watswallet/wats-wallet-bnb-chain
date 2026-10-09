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
import { pageStore } from '../../store/pageStore'
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




// ---------------------------------------------------------------------------
// T13 (WalletConnect QA, G3/G4): yazimlar dappsStore.updateDapps (navigator.locks
// altinda) uzerinden; elle hesap duzenleme kurali applyManualAccountEdit'ten
// (Header modaliyla ORTAK).
// ---------------------------------------------------------------------------
const EVM_ADRES_2 = '0xBbbb000000000000000000000000000000000002'

// Sahte navigator.locks: kilit adlarini kaydeder, ayni adli istekleri FIFO seri yapar.
function kilitKur() {
    const adlar = []
    const kuyruklar = new Map()
    vi.stubGlobal('navigator', {
        locks: {
            request: (ad, geriCagri) => {
                adlar.push(ad)
                const kosu = (kuyruklar.get(ad) || Promise.resolve()).then(() => geriCagri({ name: ad }))
                kuyruklar.set(ad, kosu.catch(() => {}))
                return kosu
            },
        },
    })
    return adlar
}

function setupKayit(kayit, ekstraDapps = {}) {
    const stub = installChromeStub({
        vaults: [EVM_KASA, TON_KASA],
        dapps: { [HOST]: kayit, ...ekstraDapps },
    })
    const gonderilen = []
    stub.setSendMessage(async (m) => { gonderilen.push(m); return {} })

    const app = createApp(DappPermissions, { props: { dapp: HOST } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    pageStore().currentPage = 'settings_dapp_permissions'

    return { app, stub, gonderilen }
}

describe('DappPermissions.vue (SSR) -- yazim dappsStore uzerinden (T13)', () => {
    it('savePermissions dapps yazimini wats-dapps kilidi altinda yapar ve sayfayi kapatir', async () => {
        const { app, stub } = setupKayit({ accounts: [EVM_ADRES], allowedChains: [1], favicon: '', chainId: '0x1' })
        const adlar = kilitKur()
        const holder = captureInstance(app, 'DappPermissions')
        await render(app)

        holder.instance.setupState.editableChains = [1, 56]
        await holder.instance.setupState.savePermissions()

        expect(adlar).toEqual(['wats-dapps'])
        expect(stub.localStore.dapps[HOST].allowedChains).toEqual([1, 56])
        expect(pageStore().currentPage).toBe('settings_dapps')
    })

    it('hesap KUMESI degisirse followActive false olur; origin, favicon, chainId korunur', async () => {
        const { app, stub } = setupKayit({
            accounts: [EVM_ADRES], allowedChains: [1], favicon: 'f.ico', chainId: '0x1',
            followActive: true, origin: 'https://uniswap.org',
        })
        kilitKur()
        const holder = captureInstance(app, 'DappPermissions')
        await render(app)

        holder.instance.setupState.editableAccounts = [EVM_ADRES, EVM_ADRES_2]
        await holder.instance.setupState.savePermissions()

        expect(stub.localStore.dapps[HOST]).toEqual({
            accounts: [EVM_ADRES, EVM_ADRES_2], allowedChains: [1], favicon: 'f.ico', chainId: '0x1',
            followActive: false, origin: 'https://uniswap.org', gasless: false,
        })
    })

    it('bayrak YOKKEN de hesap kumesi degisince followActive false yazilir', async () => {
        const { app, stub } = setupKayit({ accounts: [EVM_ADRES], allowedChains: [1] })
        kilitKur()
        const holder = captureInstance(app, 'DappPermissions')
        await render(app)

        holder.instance.setupState.editableAccounts = [EVM_ADRES_2]
        await holder.instance.setupState.savePermissions()

        expect(stub.localStore.dapps[HOST].followActive).toBe(false)
        expect(stub.localStore.dapps[HOST].accounts).toEqual([EVM_ADRES_2])
    })

    it('hesap kumesi AYNI kalirsa (yalniz zincir ve gasless) followActive KORUNUR', async () => {
        const { app, stub } = setupKayit({ accounts: [EVM_ADRES], allowedChains: [1], followActive: true })
        kilitKur()
        const holder = captureInstance(app, 'DappPermissions')
        await render(app)

        holder.instance.setupState.editableChains = [1, 137]
        holder.instance.setupState.editableGasless = true
        await holder.instance.setupState.savePermissions()

        const kayit = stub.localStore.dapps[HOST]
        expect(kayit.followActive).toBe(true)
        expect(kayit.accounts).toEqual([EVM_ADRES])
        expect(kayit.allowedChains).toEqual([1, 137])
        expect(kayit.gasless).toBe(true)
    })

    it('kayit bu arada silindiyse (revoke) savePermissions onu DIRILTMAZ ve sayfada kalinir', async () => {
        const { app, stub } = setupKayit({ accounts: [EVM_ADRES], allowedChains: [1] })
        kilitKur()
        const holder = captureInstance(app, 'DappPermissions')
        await render(app)

        delete stub.localStore.dapps[HOST]
        await holder.instance.setupState.savePermissions()

        expect(stub.localStore.dapps[HOST]).toBeUndefined()
        expect(pageStore().currentPage).toBe('settings_dapp_permissions')
    })

    it('savePermissions diskteki BASKA sitenin guncel kaydini ezmez', async () => {
        const { app, stub } = setupKayit(
            { accounts: [EVM_ADRES], allowedChains: [1] },
            { 'baska.io': { accounts: [EVM_ADRES], chainId: '0x1' } },
        )
        kilitKur()
        const holder = captureInstance(app, 'DappPermissions')
        await render(app)

        // Sayfa acikken arka plan baska sitenin kaydini guncelledi.
        stub.localStore.dapps['baska.io'].chainId = '0x89'
        await holder.instance.setupState.savePermissions()

        expect(stub.localStore.dapps['baska.io'].chainId).toBe('0x89')
    })

    it('disconnectDapp YALNIZ kendi anahtarini siler, DISCONNECT_DAPP yollar, kilit altinda calisir', async () => {
        const { app, stub, gonderilen } = setupKayit(
            { accounts: [EVM_ADRES], allowedChains: [1] },
            { 'baska.io': { accounts: [EVM_ADRES], chainId: '0x1' } },
        )
        const adlar = kilitKur()
        const holder = captureInstance(app, 'DappPermissions')
        await render(app)

        stub.localStore.dapps['baska.io'].chainId = '0x89'
        await holder.instance.setupState.disconnectDapp()

        expect(stub.localStore.dapps[HOST]).toBeUndefined()
        expect(stub.localStore.dapps['baska.io'].chainId).toBe('0x89')
        expect(adlar).toEqual(['wats-dapps'])
        expect(gonderilen).toContainEqual({ type: 'DISCONNECT_DAPP', hostname: HOST })
        expect(pageStore().currentPage).toBe('settings_dapps')
    })

    it('kayit zaten yoksa disconnectDapp mesaj YOLLAMAZ', async () => {
        const { app, stub, gonderilen } = setupKayit({ accounts: [EVM_ADRES], allowedChains: [1] })
        kilitKur()
        const holder = captureInstance(app, 'DappPermissions')
        await render(app)

        delete stub.localStore.dapps[HOST]
        await holder.instance.setupState.disconnectDapp()

        expect(gonderilen.find((m) => m.type === 'DISCONNECT_DAPP')).toBeUndefined()
    })
})

// Ayarlar > Dapp izinleri gizli modda (gizli-mod spec 23.9): genel sitenin hibesi GORUNMEZ,
// duzenlenemez ve kesilemez; kaydet / kes yazimi ve DISCONNECT_DAPP olayi gitmez.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// `watch`: SSR'da sync OLMAYAN watcher hic kurulmaz (Vue SSR kurali) ve kurulanlar renderToString bitince
// durdurulur. Ekranin GERCEK `watch(() => privacy.active, ...)` baglantisini sinamak icin watcher sync zorlanir ve
// mod render SIRASINDA (asagidaki modDegisimi) cevrilir.
vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        onMounted: actual.onServerPrefetch,
        watch: (source, cb, options) => actual.watch(source, cb, { ...options, flush: 'sync' }),
    }
})

// DappPermissions.vue -> dappFunctions.js zinciri import aninda chrome.windows.onRemoved ister.
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import { privacyStore } from '../../store/privacy'
import { modDegisimi, ilkOkumayiTut } from '../../test-utils/privateModeScreen.js'
import DappPermissions from './DappPermissions.vue'

const ADRES = '0xAaaa000000000000000000000000000000000001'
const HESAP = { key: 'acc-evm', type: 'hd', name: 'Hesap A', address: ADRES }
const HOST = 'uniswap.org'
const NOT = 'Connections are hidden in private mode.'

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function kur({ gizli }) {
    const stub = installChromeStub({
        vaults: [{ fingerprint: 'f', type: 'hd', accounts: [HESAP] }],
        dapps: { [HOST]: { accounts: [ADRES], allowedChains: [1], favicon: '', chainId: '0x1' } },
    })
    const gonderilen = []
    stub.setSendMessage(async (m) => { gonderilen.push(m); return { success: true } })
    const app = createApp(DappPermissions, { props: { dapp: HOST } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    pageStore().currentPage = 'settings_dapp_permissions'
    privacyStore().active = gizli
    return { app, stub, gonderilen }
}

describe('DappPermissions.vue (SSR) -- gizli mod', () => {
    it('gizli modda site, hesap listesi, zincirler, kaydet ve kes CIZILMEZ; kisa not cizilir', async () => {
        const { app } = kur({ gizli: true })
        const holder = captureInstance(app, 'DappPermissions')
        const html = await render(app)
        expect(html).toContain(NOT)
        expect(html).not.toContain(HOST)
        expect(html).not.toContain('Hesap A')
        expect(html).not.toContain('Save Changes')
        expect(html).not.toContain('Disconnect')
        expect(holder.instance.setupState.accounts).toEqual([])
        expect(holder.instance.setupState.dappInfo).toBeNull()
        expect(holder.instance.setupState.editableAccounts).toEqual([])
    })

    it('gizli modda savePermissions / disconnectDapp: depoya YAZMAZ, DISCONNECT_DAPP YOLLAMAZ, sayfa degismez', async () => {
        const { app, stub, gonderilen } = kur({ gizli: true })
        const holder = captureInstance(app, 'DappPermissions')
        await render(app)
        const onceki = JSON.stringify(stub.localStore)
        await holder.instance.setupState.savePermissions()
        await holder.instance.setupState.disconnectDapp()
        expect(gonderilen).toEqual([])
        expect(JSON.stringify(stub.localStore)).toBe(onceki)
        expect(pageStore().currentPage).toBe('settings_dapp_permissions')
    })

    it('pozitif kontrol: genel modda ayni ekran siteyi, hesabi ve butonlari cizer, not cizmez', async () => {
        const { app } = kur({ gizli: false })
        const html = await render(app)
        expect(html).toContain(HOST)
        expect(html).toContain('Hesap A')
        expect(html).toContain('Save Changes')
        expect(html).not.toContain(NOT)
    })

    // T28 M7: mod ekran ACIKKEN degisir (gercek watch baglantisi). Burada ilk okuma modun degismesinden ONCE bitmistir.
    it('ilk okuma BITTIKTEN sonra gizli moda GIRILIRSE: hibe, hesaplar ve duzenleme kopyasi bosalir, not cikar', async () => {
        const { app } = kur({ gizli: false })
        const holder = captureInstance(app, 'DappPermissions')
        modDegisimi(app, true)
        const html = await render(app)
        expect(privacyStore().active).toBe(true)
        expect(html).toContain(NOT)
        expect(html).not.toContain('Hesap A')
        expect(html).not.toContain('Save Changes')
        expect(holder.instance.setupState.accounts).toEqual([])
        expect(holder.instance.setupState.dappInfo).toBeNull()
        expect(holder.instance.setupState.editableAccounts).toEqual([])
    })

    // T29 (T28 M7): okuma SURERKEN moda girilirse gecikmis sonuc, watcher'in bosalttigi durumu geri doldurmaz.
    it('okuma SURERKEN gizli moda girilirse: gecikmis okuma sonucu hibeyi ve hesaplari geri DOLDURMAZ', async () => {
        const { app } = kur({ gizli: false })
        const holder = captureInstance(app, 'DappPermissions')
        const tutulan = ilkOkumayiTut()
        modDegisimi(app, true, { flipSonrasi: () => tutulan.birak() })
        const html = await render(app)
        // Okuma gercekten tutuldu mu? (tutulmadiysa test korumayi sinamaz; Vue serverPrefetch firlatmasini yutar.)
        expect(tutulan.tutuldu).toBe(true)
        expect(privacyStore().active).toBe(true)
        expect(html).toContain(NOT)
        expect(html).not.toContain(HOST)
        expect(html).not.toContain('Hesap A')
        expect(html).not.toContain('Save Changes')
        expect(holder.instance.setupState.accounts).toEqual([])
        expect(holder.instance.setupState.dappInfo).toBeNull()
        expect(holder.instance.setupState.editableAccounts).toEqual([])
    })

    it('ekran gizli modda acikken genel moda DONULURSE: izinler yeniden okunur, hesap ve butonlar gelir, not kalkar', async () => {
        const { app } = kur({ gizli: true })
        const holder = captureInstance(app, 'DappPermissions')
        modDegisimi(app, false)
        const html = await render(app)
        expect(privacyStore().active).toBe(false)
        expect(html).not.toContain(NOT)
        expect(html).toContain('Hesap A')
        expect(html).toContain('Save Changes')
        expect(holder.instance.setupState.editableAccounts).toEqual([ADRES])
    })
})

// TON oturumlari da bu ekranda: kullanicinin ne ile baglantisi oldugunu
// gorebilecegi TEK yer burasi. Listelenmezlerse kullanici bir TON dapp'iyle
// baglantisini ASLA goremez ve kesemez.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import Dapps from './Dapps.vue'

const ACCOUNT = { key: 'acc-1', address: '0xAaaa000000000000000000000000000000000001', name: 'Hesap A', type: 'hd' }
const TON_SESSION = {
    address: '0:1111111111111111111111111111111111111111111111111111111111111111',
    publicKey: 'ab12', accountKey: 'acc-1', chain: '-239',
    manifest: { name: 'DeDust', url: 'https://app.dedust.io', iconUrl: null, manifestUrl: 'https://app.dedust.io/m.json', sameOrigin: true },
    connectedAt: 1756000000,
}
const EVM_DAPP = { accounts: [ACCOUNT.address], chainId: '0x1' }

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup({ tonDapps = {}, dapps = {} } = {}) {
    const stub = installChromeStub({
        active_account: ACCOUNT,
        dapps,
        ton_dapps: tonDapps,
        current_request: undefined,
    })
    const gonderilen = []
    stub.setSendMessage(async (m) => { gonderilen.push(m); return { success: true } })

    const app = createApp(Dapps)
    app.use(createTestPinia())
    app.use(createTestI18n())
    pageStore().currentPage = 'settings_dapps'

    return { app, stub, gonderilen }
}

describe('Dapps.vue (SSR) -- TON oturumlari', () => {
    it('ton_dapps kayitlari listelenir', async () => {
        const { app } = setup({ tonDapps: { 'app.dedust.io': TON_SESSION } })
        const html = await render(app)
        expect(html).toContain('app.dedust.io')
    })

    it('EVM ve TON oturumlari AYRI listelenir', async () => {
        const { app } = setup({
            tonDapps: { 'app.dedust.io': TON_SESSION },
            dapps: { 'uniswap.org': EVM_DAPP },
        })
        const holder = captureInstance(app, 'Dapps')
        const html = await render(app)
        expect(holder.instance.setupState.tonOturumlari.length).toBe(1)
        expect(html).toContain('app.dedust.io')
        expect(html).toContain('uniswap.org')
    })

    it('ton_dapps bos ise TON bolumu cizilmez', async () => {
        const { app } = setup({ dapps: { 'uniswap.org': EVM_DAPP } })
        const holder = captureInstance(app, 'Dapps')
        await render(app)
        expect(holder.instance.setupState.tonOturumlari.length).toBe(0)
    })

    // Iki liste de bossa eski "Baglanti Yok" bos-durumu HALA gorunmeli --
    // yalniz `dapps_list`e bakan eski kosul, TON baglantisi varken EVM'i
    // yokken yanlislikla "Baglanti Yok" gosterirdi (asagidaki test bunu olcuyor);
    // burada TERS yonu kilitliyoruz: gercekten hicbir baglanti yoksa bos-durum
    // metni hala cizilmeli.
    it('HICBIR baglanti yoksa bos-durum metni cizilir', async () => {
        const { app } = setup({})
        const html = await render(app)
        expect(html).toContain('No Connections')
    })

    // Yalniz TON baglantisi varken (EVM yok) eski kosul yanlislikla bos-durumu
    // gosterirdi -- TON listesi hicbir zaman GORUNMEZDI.
    it('yalniz TON baglantisi varken bos-durum GORUNMEZ, TON listesi cizilir', async () => {
        const { app } = setup({ tonDapps: { 'app.dedust.io': TON_SESSION } })
        const html = await render(app)
        expect(html).not.toContain('No Connections')
        expect(html).toContain('app.dedust.io')
    })

    // Kesme EVM yolundan GECMEZ: DISCONNECT_DAPP `dapps` kaydini temizler ve
    // EIP-1193 accountsChanged yayinlar -- TON oturumuna hic dokunmaz.
    it('TON oturumu kesme DISCONNECT_TON_DAPP gonderir', async () => {
        const { app, gonderilen } = setup({ tonDapps: { 'app.dedust.io': TON_SESSION } })
        const holder = captureInstance(app, 'Dapps')
        await render(app)

        await holder.instance.setupState.tonBaglantisiniKes('app.dedust.io')

        const msg = gonderilen.find((m) => m.type === 'DISCONNECT_TON_DAPP')
        expect(msg.hostname).toBe('app.dedust.io')
        expect(gonderilen.find((m) => m.type === 'DISCONNECT_DAPP')).toBeUndefined()
    })

    // Silme ARKA PLANDA yapilir (DISCONNECT_TON_DAPP isleyicisi zaten ton_dapps'tan
    // siliyor) -- bilesen STORAGE'A YAZMAZ, yalniz mesaj gonderip listeyi TAZELER.
    // Iki yerde silmek (bilesen + arka plan) biri basarisiz oldugunda ekranla disk
    // arasinda kalici bir ayrisma birakirdi (Gorev 14 kontrolor karari).
    it('kesme SIRASINDA bilesen ton_dapps a YAZMAZ (silme tek yerde)', async () => {
        const { app, stub } = setup({ tonDapps: { 'app.dedust.io': TON_SESSION } })
        const holder = captureInstance(app, 'Dapps')
        await render(app)

        await holder.instance.setupState.tonBaglantisiniKes('app.dedust.io')

        // Stub'daki sendMessage arka plani TAKLIT ETMEZ (gercek silme olmaz),
        // bu yuzden depo DEGISMEDEN kalmali -- bilesen kendisi silmedigini kanitlar.
        expect(stub.localStore.ton_dapps).toEqual({ 'app.dedust.io': TON_SESSION })
    })
})

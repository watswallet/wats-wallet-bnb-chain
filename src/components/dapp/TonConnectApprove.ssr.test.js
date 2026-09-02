// TonConnectApprove.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (K5): manifest'ten gelen ad ve ikon SAYFANIN KENDI KIMLIGI DEGILDIR.
// Manifest baska bir origin'de olabilir; evil.com meshur bir dapp'in manifest'ini
// gostererek onay ekraninda tanidik bir isim yazdirabilir. Gercek origin ekranda
// BASKIN olmali ve uyusmazlik ACIKCA soylenmeli.
//
// DUZELTME (kontrolor karari): plandaki taslak `ton_addresses` depo anahtarini
// varsayiyordu -- boyle bir anahtar YOK. Gercek kimlik kaynagi background.js'in
// TON_CONNECT_IDENTITY aksiyonu (RAW adres + hex publicKey + walletStateInit,
// tonIdentity.js'in FRIENDLY/UQ-EQ akisindan TAMAMEN AYRI). Bu yuzden TON adresi
// burada `installChromeStub`in baslangic deposundan DEGIL, `stub.setSendMessage`
// ile sahtelenen TON_CONNECT_IDENTITY yanitindan gelir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import TonConnectApprove from './TonConnectApprove.vue'

const ACCOUNT = { key: 'acc-1', address: '0xAaaa000000000000000000000000000000000001', name: 'Hesap A', type: 'hd' }
const TON_ADDRESS = '0:1111111111111111111111111111111111111111111111111111111111111111'
const TON_PUBLIC_KEY = 'aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44'
const TON_STATE_INIT = 'te6cckEBAQEAAgAAAEysuc0='

const MANIFEST_AYNI = { url: 'https://app.dedust.io', name: 'DeDust', iconUrl: null, manifestUrl: 'https://app.dedust.io/m.json', sameOrigin: true }
const MANIFEST_FARKLI = { ...MANIFEST_AYNI, manifestUrl: 'https://cdn.example.com/m.json', sameOrigin: false }

const ISTEK = {
    type: 'TON_CONNECT',
    id: 'req-ton-1',
    origin: 'https://app.dedust.io',
    hostname: 'app.dedust.io',
    manifest: MANIFEST_AYNI,
    proofPayload: null,
    network: '-239',
}

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup(currentRequest, { identity = { success: true, address: TON_ADDRESS, publicKey: TON_PUBLIC_KEY, walletStateInit: TON_STATE_INIT } } = {}) {
    const stub = installChromeStub({
        current_request: currentRequest,
        active_account: ACCOUNT,
        ton_dapps: {},
    })
    const gonderilen = []
    stub.setSendMessage(async (msg) => {
        gonderilen.push(msg)
        if (msg.type === 'TON_CONNECT_IDENTITY') return identity
        if (msg.type === 'TON_DAPP_SIGN') return { success: true, signature: 'c2ln', timestamp: 1756000000 }
        return {}
    })

    const app = createApp(TonConnectApprove)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const page = pageStore()
    page.currentPage = 'ton_connect'

    return { app, page, stub, gonderilen }
}

describe('TonConnectApprove.vue (SSR) -- kimlik gosterimi', () => {
    it('GERCEK origin ve manifest adi BIRLIKTE cizilir', async () => {
        const { app } = setup(ISTEK)
        const html = await render(app)
        expect(html).toContain('app.dedust.io')
        expect(html).toContain('DeDust')
    })

    it('sameOrigin false ise uyusmazlik uyarisi cizilir, GERCEK origin GENE de gosterilir', async () => {
        // TUZAK (task-11-brief notu): manifestUrl sender origin'iyle AYNI string
        // olsaydi bu test bilesenin origin yerine yanlislikla manifest.url
        // gosterip gostermedigini AYIRT EDEMEZDI. Burada iki host KASITLI olarak
        // FARKLI: app.dedust.io (gercek origin) vs cdn.example.com (manifest).
        const { app } = setup({ ...ISTEK, manifest: MANIFEST_FARKLI })
        const holder = captureInstance(app, 'TonConnectApprove')
        const html = await render(app)
        expect(holder.instance.setupState.manifestUyusmuyor).toBe(true)
        expect(html).toContain('cdn.example.com')
        // Uyari gosterilirken bile ekranin BASKIN elemani hala gercek origin.
        expect(html).toContain('app.dedust.io')
    })

    it('sameOrigin true ise uyari CIZILMEZ', async () => {
        const { app } = setup(ISTEK)
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)
        expect(holder.instance.setupState.manifestUyusmuyor).toBe(false)
    })

    it('baglanacak TON adresi TON_CONNECT_IDENTITY yanitindan okunur (ton_addresses YOK)', async () => {
        const { app, gonderilen } = setup(ISTEK)
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)
        expect(holder.instance.setupState.tonAddress).toBe(TON_ADDRESS)

        const identityMsg = gonderilen.find((m) => m.type === 'TON_CONNECT_IDENTITY')
        expect(identityMsg).toBeDefined()
        expect(identityMsg.message.chainId).toBe(-239)
        expect(identityMsg.message.account).toEqual(ACCOUNT)
    })

    // Kullanici yalnizca ADRES mi paylastigini, yoksa IMZA mi attigini bilmeli.
    it('proofPayload varsa kimlik dogrulama istegi gosterilir', async () => {
        const { app } = setup({ ...ISTEK, proofPayload: 'nonce-1' })
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)
        expect(holder.instance.setupState.proofIsteniyor).toBe(true)
    })

    it('proofPayload null ise gosterilmez', async () => {
        const { app } = setup(ISTEK)
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)
        expect(holder.instance.setupState.proofIsteniyor).toBe(false)
    })
})

// FIX ROUND 1 (kod incelemesi): identityError onceden hicbir yerde OKUNMUYORDU
// -- kimlik cozulemediginde (orn. bu hesabin TON kasasi bulunamadi, tipki
// TON_FEE_IDENTITY'nin evmCapable ile korudugu durum) kullanici sessizce
// '...' yer tutucusuyla ve kalici KAPALI bir Baglan dugmesiyle bas basa
// kalirdi -- NEDEN baglanamadigini gosteren hicbir sey yoktu.
describe('TonConnectApprove.vue (SSR) -- kimlik cozulemedi', () => {
    it('TON_CONNECT_IDENTITY basarisiz olursa ekranda SABIT/cevrilmis bir hata gosterilir, ham hata DEGIL', async () => {
        const { app } = setup(ISTEK, { identity: { success: false, error: 'ACCOUNT_VAULT_NOT_FOUND' } })
        const holder = captureInstance(app, 'TonConnectApprove')
        const html = await render(app)

        expect(holder.instance.setupState.identityError).toBeTruthy()
        expect(holder.instance.setupState.tonAddress).toBe('')
        // Kullaniciya gosterilen $t('dapps.tonConnect.identity_error') SABIT bir
        // mesaj -- ham hata kodu ekrana SIZMAZ.
        expect(html).toContain('Could not prepare a TON address for this account')
        expect(html).not.toContain('ACCOUNT_VAULT_NOT_FOUND')
    })

    // Devre disi buton bir ARAYUZ durumudur, GARANTI degil -- pinlenmesi
    // gereken asil degismez, kimlik yokken diske HICBIR SEYIN yazilmamasi.
    it('kimlik cozulemezse baglan() cagrilsa bile oturum YAZILMAZ ve dapp yanitlanmaz', async () => {
        const { app, stub, gonderilen } = setup(ISTEK, { identity: { success: false, error: 'ACCOUNT_VAULT_NOT_FOUND' } })
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)

        await holder.instance.setupState.baglan()

        expect(stub.localStore.ton_dapps['app.dedust.io']).toBeUndefined()
        expect(gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')).toBeUndefined()
    })
})

describe('TonConnectApprove.vue (SSR) -- onay', () => {
    it('ton_proof istendiyse TON_DAPP_SIGN cagrilir ve proof yanita girer', async () => {
        const { app, stub, gonderilen } = setup({ ...ISTEK, proofPayload: 'nonce-1' })
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)

        await holder.instance.setupState.baglan()

        const signMsg = gonderilen.find((m) => m.type === 'TON_DAPP_SIGN')
        expect(signMsg.message.mode).toBe('proof')
        expect(signMsg.message.domain).toBe('app.dedust.io')
        expect(signMsg.message.proofPayload).toBe('nonce-1')
        // KAPSAM GENISLEMESI (kontrolor karari, gorev 13): background.js'in
        // tonDappSign'i artik `from` VERILMISSE cozulen adresle karsilastirir
        // (TonSendTx.vue'nun tonDappSend'i icin ZATEN yaptigi AYNI kilit).
        // `from` gonderilmezse bu ekran hicbir korumadan GECMEZ.
        expect(signMsg.message.from).toBe(TON_ADDRESS)

        const ok = gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')
        expect(ok.requestId).toBe('req-ton-1')
        expect(ok.status).toBe('success')
        expect(ok.data.result.event).toBe('connect')
        const items = ok.data.result.payload.items
        const addrItem = items.find((i) => i.name === 'ton_addr')
        expect(addrItem.address).toBe(TON_ADDRESS)
        expect(addrItem.publicKey).toBe(TON_PUBLIC_KEY)
        expect(addrItem.walletStateInit).toBe(TON_STATE_INIT)
        expect(addrItem.network).toBe('-239')
        const proof = items.find((i) => i.name === 'ton_proof')
        expect(proof.proof.signature).toBe('c2ln')
        // Dapp dogrulamak icin AYNI damgayla mesaji yeniden kurar; damga
        // donmezse dogrulama her zaman basarisiz olur.
        expect(proof.proof.timestamp).toBe(1756000000)
        expect(proof.proof.domain.value).toBe('app.dedust.io')
        expect(proof.proof.payload).toBe('nonce-1')

        // Yazilan oturumun TUM alanlari kontrol edilir -- "bir sey yazildi"
        // degil, DOGRU sey yazildi (task-11-brief mutasyon notu).
        const session = stub.localStore.ton_dapps['app.dedust.io']
        expect(session.address).toBe(TON_ADDRESS)
        expect(session.publicKey).toBe(TON_PUBLIC_KEY)
        expect(session.walletStateInit).toBe(TON_STATE_INIT)
        expect(session.accountKey).toBe('acc-1')
        expect(session.chain).toBe('-239')
        expect(session.manifest).toEqual(MANIFEST_AYNI)
        expect(typeof session.connectedAt).toBe('number')
    })

    it('ton_proof istenmemisse TON_DAPP_SIGN CAGRILMAZ', async () => {
        const { app, gonderilen } = setup(ISTEK)
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)

        await holder.instance.setupState.baglan()

        expect(gonderilen.find((m) => m.type === 'TON_DAPP_SIGN')).toBeUndefined()
        const ok = gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')
        expect(ok.data.result.payload.items.find((i) => i.name === 'ton_proof')).toBeUndefined()
    })

    // SIRA ONEMLI: imza ONCE, oturum SONRA. Ters olsaydi imza basarisiz olsa
    // bile diskte "bagli" bir oturum kalir ve dapp bunu asla kullanamazdi.
    it('imza basarisizsa oturum YAZILMAZ', async () => {
        const { app, stub, gonderilen } = setup({ ...ISTEK, proofPayload: 'nonce-1' })
        stub.setSendMessage(async (msg) => {
            gonderilen.push(msg)
            if (msg.type === 'TON_CONNECT_IDENTITY') return { success: true, address: TON_ADDRESS, publicKey: TON_PUBLIC_KEY, walletStateInit: TON_STATE_INIT }
            if (msg.type === 'TON_DAPP_SIGN') return { success: false, error: 'Wallet locked' }
            return {}
        })
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)

        await holder.instance.setupState.baglan()

        expect(stub.localStore.ton_dapps['app.dedust.io']).toBeUndefined()
        expect(gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')).toBeUndefined()
    })
})

describe('TonConnectApprove.vue (SSR) -- red', () => {
    // TonConnect'te RED DE BIR YANITTIR (connect_error, kod 300). `status: 'error'`
    // yolundan gonderilseydi resolvePendingRequest onu `{ error: {...} }` seklinde
    // dondururdu ve dapp'in kutuphanesi bu bicimi TANIMAZDI.
    it('connect_error kod 300 ile yanitlanir, oturum yazilmaz', async () => {
        const { app, stub, gonderilen } = setup(ISTEK)
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)

        await holder.instance.setupState.reddet()

        const yanit = gonderilen.find((m) => m.requestId === 'req-ton-1' && m.type === 'CONNECT_WALLET_SUCCESS')
        expect(yanit.status).toBe('success')
        expect(yanit.data.result.event).toBe('connect_error')
        expect(yanit.data.result.payload.code).toBe(300)
        expect(stub.localStore.ton_dapps['app.dedust.io']).toBeUndefined()
    })
})

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
import en from '../../i18n/locales/en.json'
import tr from '../../i18n/locales/tr.json'

// Gorev 5: bu ekran artik hesap kapisi tasiyor. Fikstur MESRU bir TON
// hesabidir; kapinin kendisi asagidaki "desteklenmeyen hesap" blogunda olculur.
const ACCOUNT = { key: 'acc-1', type: 'ton', name: 'TON 1', address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG', fingerprint: 'f-ton' }

// Kapi artik TURE degil YETENEGE bakiyor (`tonSignerReady`, 2026-09-11), yani
// fikstur KASAYI da tasimak zorunda: eski hali yalnizca `type` bakiyordu ve
// hicbir kasa gerekmiyordu. Yetenegin GERCEK tanimi "TON kasasi cozuluyor mu".
const TON_KASA = { fingerprint: 'f-ton', type: 'tonMnemonic', accounts: [ACCOUNT] }

// TON imzalayamayan hesap: ozel anahtardan ice aktarilmis (tek secp256k1
// anahtarindan ed25519 TURETILEMEZ). Eskiden burada `type:'hd'` bir hesap
// vardi ve o populasyon artik TON imzalayabiliyor (R6 + Gorev 2), yani kapiyi
// olcmuyordu.
const EVM_HESAP = { key: 'acc-evm', type: 'privateKey', name: 'Hesap A', address: '0xAaaa000000000000000000000000000000000001', fingerprint: 'f-ozel' }
const OZEL_KASA = { fingerprint: 'f-ozel', type: 'privateKey', accounts: [EVM_HESAP] }
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

function setup(currentRequest, { identity = { success: true, address: TON_ADDRESS, publicKey: TON_PUBLIC_KEY, walletStateInit: TON_STATE_INIT }, account = ACCOUNT, locale = 'en' } = {}) {
    const stub = installChromeStub({
        current_request: currentRequest,
        vaults: account === EVM_HESAP ? [OZEL_KASA] : [TON_KASA],
        active_account: account,
        ton_dapps: {},
    })
    const gonderilen = []
    stub.setSendMessage(async (msg) => {
        gonderilen.push(msg)
        if (msg.type === 'TON_CONNECT_IDENTITY') return identity
        if (msg.type === 'TON_DAPP_SIGN') return { success: true, signature: 'c2ln', timestamp: 1756000000 }
        // Kapat-yalniz cikisin sorusu: varsayilan "arka planda kayit yok".
        if (msg.type === 'TON_DAPP_REQUEST_STATE') return { state: 'gone' }
        return {}
    })

    const app = createApp(TonConnectApprove)
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    const page = pageStore()
    page.currentPage = 'ton_connect'

    return { app, page, stub, gonderilen }
}

// task-59: EVM ConnectDapp'teki izin kartinin gorsel dilini paylasan 3
// satirlik bir kart -- goz (adres/bakiye), kalem (islem onerme) ve kalkan
// (otomatik islem YAPAMAZ).
describe('TonConnectApprove.vue (SSR) -- izin karti', () => {
    it('3 izin satiri da cizilir', async () => {
        const { app } = setup(ISTEK)
        const html = await render(app)
        expect(html).toContain('See your address and balance')
        expect(html).toContain('Propose transactions')
        expect(html).toContain('Cannot act on your behalf')
    })
})

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
        // B1.5: istek artik beklemiyorsa arka plan imzalamaz; hata olursa
        // connect_error'u KENDISI verir (connect'in AppRequest id'si yok).
        expect(signMsg.message.requestId).toBe('req-ton-1')

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

// B1.5: ton_proof imzasi yerel; basarisizsa dapp connect_error'u arka plandan
// HEMEN alir (terminal). Ekran ikinci bir yanit gondermez, oturum yazmaz ve
// alt bilgi tek bir Kapat'a doner.
describe('TonConnectApprove.vue (SSR) -- B1.5: proof hatasi', () => {
    const altBilgi = (html) => html.slice(html.indexOf('<footer'))
    const dugmeSayisi = (html) => (altBilgi(html).match(/<button/g) || []).length

    function proofHatasiKur(signSonuc) {
        const kurulum = setup({ ...ISTEK, proofPayload: 'nonce-1' })
        kurulum.stub.setSendMessage(async (msg) => {
            kurulum.gonderilen.push(msg)
            if (msg.type === 'TON_CONNECT_IDENTITY') return { success: true, address: TON_ADDRESS, publicKey: TON_PUBLIC_KEY, walletStateInit: TON_STATE_INIT }
            if (msg.type === 'TON_DAPP_SIGN') return signSonuc
            if (msg.type === 'TON_DAPP_REQUEST_STATE') return { state: 'gone' }
            return {}
        })
        return kurulum
    }

    it('terminal hata: yanitlandi; Baglan/Reddet IKINCI yanit gondermez, oturum yazilmaz', async () => {
        const { app, stub, gonderilen } = proofHatasiKur({ success: false, error: 'Wallet locked. Please enter your password.', terminal: true, code: 0 })
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)
        const s = holder.instance.setupState

        await s.baglan()
        expect(s.yanitlandi).toBe(true)
        expect(s.signError).toBeTruthy()

        await s.reddet()
        await s.baglan()

        expect(gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')).toBeUndefined()
        expect(gonderilen.filter((m) => m.type === 'TON_DAPP_SIGN')).toHaveLength(1)
        expect(stub.localStore.ton_dapps['app.dedust.io']).toBeUndefined()
    })

    it('terminal olmayan hata (yanit yok): Reddet hala 300 verir', async () => {
        const { app, gonderilen } = proofHatasiKur(null)
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)
        const s = holder.instance.setupState

        await s.baglan()
        expect(s.signError).toBeTruthy()
        expect(s.yanitlandi).toBe(false)

        await s.reddet()
        expect(gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS').data.result.payload.code).toBe(300)
    })

    it('Kapat-yalniz alt bilgi: TEK dugme, Kapat', async () => {
        const { app } = setup(ISTEK)
        captureInstance(app, 'TonConnectApprove', (inst) => { inst.setupState.yanitlandi = true })
        const html = await render(app)

        expect(dugmeSayisi(html)).toBe(1)
        expect(altBilgi(html)).toContain(en.dapps.tonConnect.btn_close)
        expect(html).not.toContain('id="ton-connect-approve"')
    })

    // Hesap engeli varyanti da Kapat-yalniza YOL VERIR (tek Reddet kalsaydi
    // yanitlanmis istege 300 gonderirdi).
    it('Kapat-yalniz, engelli hesap varyantindan da ONCE gelir', async () => {
        const { app } = setup(ISTEK, { account: EVM_HESAP })
        captureInstance(app, 'TonConnectApprove', (inst) => { inst.setupState.yanitlandi = true })
        const html = await render(app)

        expect(dugmeSayisi(html)).toBe(1)
        expect(altBilgi(html)).toContain(en.dapps.tonConnect.btn_close)
        expect(altBilgi(html)).not.toContain(en.dapps.tonConnect.btn_reject)
    })

    // Arka plana giden TEK mesaj durum sorusu; dapp'e yanit veren hicbir tur
    // (CONNECT_WALLET_*) gitmez.
    it('kapat(): kayit arka planda YOKSA bu istegin current_request i silinir, dapp e hicbir sey gitmez', async () => {
        const { app, stub, gonderilen } = proofHatasiKur({ success: false, error: 'TON_DAPP_REQUEST_GONE', terminal: true, code: null })
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)
        await holder.instance.setupState.baglan()
        const once = gonderilen.length

        await holder.instance.setupState.kapat()

        expect(stub.localStore.current_request).toBeUndefined()
        expect(gonderilen.slice(once)).toEqual([{ type: 'TON_DAPP_REQUEST_STATE', requestId: 'req-ton-1' }])
    })

    // Ikinci yuzeyin Kapat'i onay penceresinin metnini silmemeli.
    it('kapat(): kayit arka planda hala duruyorsa current_request SILINMEZ', async () => {
        const { app, stub } = proofHatasiKur({ success: false, error: 'TON_DAPP_FROM_MISMATCH', terminal: true, code: 1 })
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)
        await holder.instance.setupState.baglan()
        stub.setSendMessage(async (m) => (m.type === 'TON_DAPP_REQUEST_STATE' ? { state: 'answered' } : {}))

        await holder.instance.setupState.kapat()

        expect(stub.localStore.current_request).toEqual({ ...ISTEK, proofPayload: 'nonce-1' })
    })

    // Arka plan sonucu current_request'e yazdi: bu istegi sonradan acan ekran
    // Giris/Reddet ile degil, Kapat-yalniz ve gercek metinle acilir; kasayi acan
    // kimlik istegi (TON_CONNECT_IDENTITY) yapilmaz.
    it('current_request.answered ile acilan ekran dogrudan Kapat-yalniz; kimlik istenmez', async () => {
        const { app, gonderilen } = setup({ ...ISTEK, proofPayload: 'nonce-1', answered: { error: 'Wallet locked. Please enter your password.', code: 0 } })
        const holder = captureInstance(app, 'TonConnectApprove')
        const html = await render(app)
        const s = holder.instance.setupState

        expect(s.yanitlandi).toBe(true)
        expect(s.signError).toBe(en.send.tonErrors.walletLocked)
        expect(dugmeSayisi(html)).toBe(1)
        expect(altBilgi(html)).toContain(en.dapps.tonConnect.btn_close)
        expect(gonderilen.find((m) => m.type === 'TON_CONNECT_IDENTITY')).toBeUndefined()

        await s.baglan()
        await s.reddet()
        expect(gonderilen.find((m) => m.type === 'TON_DAPP_SIGN')).toBeUndefined()
        expect(gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// B4 (wallet-guidelines.md:21-30): ton_proof istemi bir GIRIS istemidir, transfer
// onayi DEGIL. Eylem etiketi 'Sign in'; zincir disi imza oldugu (islem yok, ucret
// yok); IMZALANAN alan adi (TON_DAPP_SIGN'e giden `domain`) ve yukun okunur kisa
// hali (ilk 8 + ... + son 8; 20 karaktere kadar tam). Yuk dapp'ten gelir: yalniz
// metin enterpolasyonu.
// ---------------------------------------------------------------------------
describe('TonConnectApprove.vue (SSR) -- B4: ton_proof istemi', () => {
    const tc = en.dapps.tonConnect
    const UC_NOKTA = '\u2026'
    // Baslik ('TON Connect Request') de 'Connect' icerir: etiket dugmenin
    // KENDI metninden okunur.
    const onayDugmesi = (html) => {
        const bas = html.indexOf('id="ton-connect-approve"')
        return bas === -1 ? '' : html.slice(bas, html.indexOf('</button>', bas))
    }

    async function proofCiz(proofPayload, secenek) {
        const { app } = setup({ ...ISTEK, proofPayload }, secenek)
        return render(app)
    }

    it('proof isteminde Giris etiketi, zincir disi notu, Alan adi ve yuk cizilir', async () => {
        const html = await proofCiz('nonce-1')

        expect(onayDugmesi(html)).toContain('Sign in')
        expect(onayDugmesi(html)).not.toContain(tc.btn_connect)
        expect(html).toContain(tc.proof_notice)
        expect(html).toContain(tc.proof_offchain)
        expect(html).toContain('Domain: app.dedust.io')
        expect(html).toContain('Payload: nonce-1')
        // MUST NOT (wallet-guidelines.md:30): transfer basligi ya da ucret satiri yok.
        expect(html).not.toContain(tc.sendTitle)
        expect(html).not.toContain(tc.estimatedFeeLabel)
    })

    it('proof yoksa bugunku metinler: dugme Baglan, proof satirlari YOK', async () => {
        const { app } = setup(ISTEK)
        const html = await render(app)

        expect(onayDugmesi(html)).toContain(tc.btn_connect)
        expect(onayDugmesi(html)).not.toContain('Sign in')
        expect(html).toContain(tc.perm_view_title)
        expect(html).not.toContain(tc.proof_notice)
        expect(html).not.toContain('Off-chain signature')
        expect(html).not.toContain('Domain:')
        expect(html).not.toContain('Payload:')
    })

    it('gosterilen Alan adi IMZALANAN alan adidir (manifest hostu DEGIL)', async () => {
        const { app, gonderilen } = setup({ ...ISTEK, manifest: MANIFEST_FARKLI, proofPayload: 'nonce-1' })
        const holder = captureInstance(app, 'TonConnectApprove')
        const html = await render(app)
        expect(html).not.toContain('Domain: cdn.example.com')

        await holder.instance.setupState.baglan()
        const signMsg = gonderilen.find((m) => m.type === 'TON_DAPP_SIGN')
        expect(signMsg.message.domain).toBe('app.dedust.io')
        expect(html).toContain('Domain: ' + signMsg.message.domain)
    })

    it('20 karakterlik yuk TAM gosterilir', async () => {
        const yuk = 'abcdefghij0123456789'
        expect(yuk).toHaveLength(20)
        const html = await proofCiz(yuk)

        expect(html).toContain('Payload: ' + yuk)
        expect(html).not.toContain('Payload: abcdefgh' + UC_NOKTA)
    })

    it('21 karakterlik yuk ilk 8 + ... + son 8 olarak kisaltilir', async () => {
        const yuk = 'abcdefghij0123456789X'
        expect(yuk).toHaveLength(21)
        const html = await proofCiz(yuk)

        expect(html).toContain('Payload: abcdefgh' + UC_NOKTA + '3456789X')
        expect(html).not.toContain(yuk)
    })

    // handleTonConnect bos yuku '' olarak saklar: proof yine istenir, yuk satiri yok.
    it('bos yuk: yuk satiri cizilmez, Giris etiketi ve Alan adi kalir', async () => {
        const html = await proofCiz('')

        expect(onayDugmesi(html)).toContain('Sign in')
        expect(html).toContain('Domain: app.dedust.io')
        expect(html).not.toContain('Payload:')
    })

    it('yuk HTML olarak yorumlanmaz, kacirilir', async () => {
        const html = await proofCiz('<b>x</b>')

        expect(html).toContain('Payload: &lt;b&gt;x&lt;/b&gt;')
        expect(html).not.toContain('<b>x</b>')
    })

    it('TR: ayni satirlar Turkce cizilir', async () => {
        const ttc = tr.dapps.tonConnect
        const html = await proofCiz('nonce-1', { locale: 'tr' })

        expect(ttc.btn_sign_in).toBeTruthy()
        expect(onayDugmesi(html)).toContain(ttc.btn_sign_in)
        expect(html).toContain(ttc.proof_offchain)
        expect(html).toContain(ttc.proof_domain.replace('{domain}', 'app.dedust.io'))
        expect(html).toContain(ttc.proof_payload.replace('{payload}', 'nonce-1'))
    })

    it('yeni anahtarlar iki dilde dolu ve yer tutuculari korunur', () => {
        for (const k of ['btn_sign_in', 'proof_offchain', 'proof_domain', 'proof_payload']) {
            expect(en.dapps.tonConnect[k], k).toBeTruthy()
            expect(tr.dapps.tonConnect[k], k).toBeTruthy()
        }
        for (const dil of [en, tr]) {
            expect(dil.dapps.tonConnect.proof_domain).toContain('{domain}')
            expect(dil.dapps.tonConnect.proof_payload).toContain('{payload}')
        }
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

// SolanaConnectApprove.vue'nun aynasi (§8 R4c): soluk/kilitli bir dugme
// birakilmaz, dugme TUMDEN kaldirilir ve NEDENI yazilir.
//
// "Arka plan kapisi zaten reddediyor, bu neden gerekli?" -- cunku
// `current_request` DISKTE duruyor: arka plan kapisindan gecmis (o an TON
// hesabi aktifken acilmis) bir istek, kullanici Header'dan EVM hesabina
// gectikten sonra popup'in bir sonraki acilisinda bu ekrana geri doner.
describe('TonConnectApprove.vue (SSR) -- desteklenmeyen hesap', () => {
    it('onay dugmesi devre disi DEGIL, HIC YOK; kimlik SORULMAZ', async () => {
        const { app, gonderilen } = setup(ISTEK, { account: EVM_HESAP })
        const holder = captureInstance(app, 'TonConnectApprove')
        const html = await render(app)

        expect(holder.instance.setupState.baglantiEngelli).toBe(true)
        expect(html).not.toContain('id="ton-connect-approve"')
        expect(html).toContain('This account cannot sign TON transactions')
        // TON_CONNECT_IDENTITY anahtar turetir, yani kasa acmayi gerektirir --
        // sonucu zaten reddedilecek bir istek icin bu SORULMAZ.
        expect(gonderilen.find((m) => m.type === 'TON_CONNECT_IDENTITY')).toBeUndefined()
    })

    it('baglan() elle cagrilsa bile oturum YAZILMAZ ve dapp yanitlanmaz', async () => {
        const { app, stub, gonderilen } = setup(ISTEK, { account: EVM_HESAP })
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)

        await holder.instance.setupState.baglan()

        expect(stub.localStore.ton_dapps['app.dedust.io']).toBeUndefined()
        expect(gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')).toBeUndefined()
    })

    it('TON hesabinda dugme ve kimlik istegi YERINDE durur', async () => {
        const { app, gonderilen } = setup(ISTEK)
        const holder = captureInstance(app, 'TonConnectApprove')
        const html = await render(app)

        expect(holder.instance.setupState.baglantiEngelli).toBe(false)
        expect(html).toContain('id="ton-connect-approve"')
        expect(gonderilen.find((m) => m.type === 'TON_CONNECT_IDENTITY')).toBeDefined()
    })
})

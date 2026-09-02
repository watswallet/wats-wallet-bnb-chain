// TonSignData.vue'yu GERCEKTEN render eden testler.
//
// KOK NEDEN: uc yuk tipinden IKISI (binary, cell) okunabilir degil. Ekranin
// bunlar icin uydurma bir ozet uretmesi, kullaniciyi gercekte gormedigi bir
// seye onay verdirmek olurdu; dogru davranis "cozemiyoruz" demek.
//
// KAPSAM GENISLEMESI (kontrolor karari, gorev 13): imza yolunun onceden
// hicbir `from` kilidi YOKTU -- tonDappSign COZULEN hesaptan imzalar ve o
// adresi dapp'e "address" olarak bildirir, ama hangi hesabin cozulecegi
// current_request.accountKey'e BAGLIYDI ve handleTonSignData bu alani HIC
// YAZMIYORDU. Asagidaki testler hem GORUNUMU hem bu YENI kilidi (accountKey
// -> vaults -> account, `from` TON_DAPP_SIGN'e GIDER) dogrular.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import TonSignData from './TonSignData.vue'

const ACCOUNT = { key: 'acc-1', address: '0xAaaa000000000000000000000000000000000001', name: 'Hesap A', type: 'hd' }
const VAULT_ACCOUNT_B = { key: 'acc-2', address: '0xBbbb000000000000000000000000000000000002', name: 'Hesap B', type: 'hd' }
const VAULTS = [{ accounts: [ACCOUNT, VAULT_ACCOUNT_B] }]
const FROM = '0:1111111111111111111111111111111111111111111111111111111111111111'

// manifestUrl BILEREK farkli bir host'ta (cdn.example.com): sender origin'iyle
// (app.dedust.io) AYNI olsaydi "html.toContain('app.dedust.io')" testi ekranin
// GERCEK origin'i mi yoksa manifest'in KENDI iddiasini mi gosterdigini ayirt
// edemezdi -- TonConnectApprove.ssr.test.js/TonSendTx.ssr.test.js'teki AYNI
// tuzak notu.
const MANIFEST = { url: 'https://cdn.example.com', name: 'DeDust', iconUrl: null, manifestUrl: 'https://cdn.example.com/m.json', sameOrigin: false }

const GIZLI_METIN = 'GIZLI-ICERIK-XYZ'
const YUKLER = {
    text: { type: 'text', text: 'Merhaba dunya' },
    binary: { type: 'binary', bytes: btoa(GIZLI_METIN) },
    cell: { type: 'cell', schema: 'transfer#0f8a7ea5', cell: btoa(GIZLI_METIN) },
}

const istek = (payload, extra = {}) => ({
    type: 'TON_SIGN_DATA',
    id: 'req-sign-1',
    origin: 'https://app.dedust.io',
    hostname: 'app.dedust.io',
    manifest: MANIFEST,
    from: FROM,
    // accountKey: handleTonSignData (background.js, gorev 13 kapsam genislemesi)
    // bunu session.accountKey'den yazar -- ONAYLANAN hesaba kilit icin.
    accountKey: 'acc-1',
    payload,
    appRequestId: 'app-9',
    ...extra,
})

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup(currentRequest, { signSonuc = { success: true, signature: 'c2ln', timestamp: 1756000000 }, vaults = VAULTS } = {}) {
    const stub = installChromeStub({ current_request: currentRequest, active_account: ACCOUNT, vaults })
    const gonderilen = []
    stub.setSendMessage(async (m) => {
        gonderilen.push(m)
        if (m.type === 'TON_DAPP_SIGN') return signSonuc
        return {}
    })

    const app = createApp(TonSignData)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const page = pageStore()
    page.currentPage = 'ton_sign_data'

    return { app, page, stub, gonderilen }
}

describe('TonSignData.vue (SSR) -- gosterim', () => {
    it('text yukunde metin DUZ cizilir', async () => {
        const { app } = setup(istek(YUKLER.text))
        const html = await render(app)
        expect(html).toContain('Merhaba dunya')
    })

    it.each(['binary', 'cell'])('%s yukunde icerik okunamiyor isaretlenir', async (tip) => {
        const { app } = setup(istek(YUKLER[tip]))
        const holder = captureInstance(app, 'TonSignData')
        await render(app)
        expect(holder.instance.setupState.icerikOkunabilir).toBe(false)
    })

    it('text yukunde icerik OKUNABILIR isaretlenir', async () => {
        const { app } = setup(istek(YUKLER.text))
        const holder = captureInstance(app, 'TonSignData')
        await render(app)
        expect(holder.instance.setupState.icerikOkunabilir).toBe(true)
    })

    // Ham base64'u ekrana dokmek, kullaniciya anlamadigi bir metni "okudugu"
    // izlenimi verir. Yerine hash gosterilir: dogrulanabilir ama yaniltmaz.
    it.each(['binary', 'cell'])('%s yukunde ham icerik ekranda GOSTERILMEZ', async (tip) => {
        const { app } = setup(istek(YUKLER[tip]))
        const html = await render(app)
        expect(html).not.toContain(YUKLER[tip].bytes ?? YUKLER[tip].cell)
    })

    // FIX ROUND 1 (kontrolor incelemesi): ekran `current_request.hostname`i
    // gosterir, `origin`i DEGIL -- TonConnectApprove.vue/TonSendTx.vue ile
    // AYNI cipl (sema'siz) gorsel guven deseni; sema (scheme) gorunurlugu
    // UC ekrana BIRDEN eklenecek ayri bir karardir, tek ekrana SESSIZCE degil.
    it('GERCEK origin (cipl hostname) ekranda, ne sema ne manifest in KENDI iddiasi', async () => {
        const { app } = setup(istek(YUKLER.text))
        const html = await render(app)
        expect(html).toContain('app.dedust.io')
        // `origin` ('https://app.dedust.io') `hostname`i ('app.dedust.io') ALT-DIZE
        // olarak icerir -- yalniz 'app.dedust.io' aramak HANGI alanin gosterildigini
        // AYIRT ETMEZ (biri digerini basarisiz kilmadan gecerdi). Sema'li TAM
        // origin dizesinin YOK oldugunu da dogrulamak, `hostname` mi `origin` mi
        // render edildigini GERCEKTEN ayirt eder.
        expect(html).not.toContain('https://app.dedust.io')
        // MANIFEST.url/manifestUrl KASITLI olarak farkli bir host (cdn.example.com):
        // bu satir olmadan yukaridaki assertion "origin mi, manifest mi gosterildi"
        // sorusuna hicbir sey soylemezdi (ikisi de ayni metni tasiyabilirdi).
        expect(html).not.toContain('cdn.example.com')
    })
})

describe('TonSignData.vue (SSR) -- onay', () => {
    it('TON_DAPP_SIGN mode signData ile, onaylanan hesabin adresiyle (from) cagrilir', async () => {
        const { app, gonderilen } = setup(istek(YUKLER.text))
        const holder = captureInstance(app, 'TonSignData')
        await render(app)

        await holder.instance.setupState.onayla()

        const signMsg = gonderilen.find((m) => m.type === 'TON_DAPP_SIGN')
        expect(signMsg.message.mode).toBe('signData')
        expect(signMsg.message.domain).toBe('app.dedust.io')
        expect(signMsg.message.payload).toEqual(YUKLER.text)
        // KAPSAM GENISLEMESI: `from` gonderilmezse background.js imzalayan
        // hesabi onaylanan hesapla ASLA karsilastiramaz -- kilit sessizce
        // devre disi kalir.
        expect(signMsg.message.from).toBe(FROM)
    })

    // KAPSAM GENISLEMESI: hesap current_request.accountKey uzerinden (vaults
    // icinde) COZULMELI, aktif hesaba SESSIZCE dusulmemeli -- ikisi burada
    // KASITLI FARKLI (acc-1 aktif, acc-2 onaylanan) ki yanlis dala duserse
    // test YAKALASIN.
    it('hesap current_request.accountKey uzerinden vaults tan cozulur, aktif hesaba DUSULMEZ', async () => {
        const { app, gonderilen } = setup(istek(YUKLER.text, { accountKey: 'acc-2' }))
        const holder = captureInstance(app, 'TonSignData')
        await render(app)

        await holder.instance.setupState.onayla()

        const signMsg = gonderilen.find((m) => m.type === 'TON_DAPP_SIGN')
        expect(signMsg.message.account?.key).toBe('acc-2')
    })

    // Dapp dogrulamak icin DORDUNU birden ister: imza tek basina anlamsizdir,
    // cunku imzalanan mesaj domain + timestamp + adres ile kurulmustu.
    it('yanit signature, timestamp, domain ve address tasir', async () => {
        const { app, gonderilen } = setup(istek(YUKLER.text))
        const holder = captureInstance(app, 'TonSignData')
        await render(app)

        await holder.instance.setupState.onayla()

        const ok = gonderilen.find((m) => m.type === 'SIGN_MESSAGE_SUCCESS')
        expect(ok.requestId).toBe('req-sign-1')
        const r = ok.data.result.result
        expect(r.signature).toBe('c2ln')
        expect(r.timestamp).toBe(1756000000)
        expect(r.address).toBe(FROM)
        // domain DUZ BIR DIZE (final inceleme K2): TonConnect'in SignDataResult
        // sozlesmesi boyle tanimlar. { lengthBytes, value } sekli ton_proof'un
        // (TonConnectApprove.vue) kanit-onizleme formatidir, SignData'nin domain'i
        // DEGIL -- bu ikisi ONCEDEN karistirilmisti (bu dosya nesne sekli
        // bekliyordu) ve referans dogrulayici String(result.domain) ile
        // onizlemeyi yeniden kurunca "[object Object]" uretip ed25519
        // dogrulamasini SESSIZCE dusuruyordu.
        expect(r.domain).toBe('app.dedust.io')
        expect(r.payload).toEqual(YUKLER.text)
        expect(ok.data.result.id).toBe('app-9')
    })

    // Coklu-bayt bir hostname domain'in OLDUGU GIBI (kodlanmadan/kesilmeden)
    // gectigini dogrular -- ton_proof'taki domain UTF-8 BAYT uzunlugu tasirken
    // (tonProofMessage.js) buradaki domain duz JS dizesidir, ikisi ayni deger
    // OLMAK ZORUNDA DEGIL.
    it('domain coklu-bayt hostname icin de DUZ DIZE olarak, degismeden gecer', async () => {
        const COK_BAYTLI_HOST = 'münchen.example'
        const req = istek(YUKLER.text, { hostname: COK_BAYTLI_HOST, origin: 'https://' + COK_BAYTLI_HOST })
        const { app, gonderilen } = setup(req)
        const holder = captureInstance(app, 'TonSignData')
        await render(app)

        await holder.instance.setupState.onayla()

        const ok = gonderilen.find((m) => m.type === 'SIGN_MESSAGE_SUCCESS')
        expect(ok.data.result.result.domain).toBe(COK_BAYTLI_HOST)
    })

    it('imza basarisizsa dapp e basarili BILDIRILMEZ', async () => {
        const { app, gonderilen } = setup(istek(YUKLER.text), { signSonuc: { success: false, error: 'Wallet locked' } })
        const holder = captureInstance(app, 'TonSignData')
        await render(app)

        await holder.instance.setupState.onayla()

        expect(holder.instance.setupState.hata).toBeTruthy()
        expect(gonderilen.find((m) => m.type === 'SIGN_MESSAGE_SUCCESS')).toBeUndefined()
    })
})

describe('TonSignData.vue (SSR) -- red', () => {
    it('kod 300 hata govdesi gonderilir', async () => {
        const { app, gonderilen } = setup(istek(YUKLER.text))
        const holder = captureInstance(app, 'TonSignData')
        await render(app)

        await holder.instance.setupState.reddet()

        const yanit = gonderilen.find((m) => m.requestId === 'req-sign-1')
        expect(yanit.data.result.error.code).toBe(300)
        expect(yanit.data.result.id).toBe('app-9')
        expect(gonderilen.find((m) => m.type === 'TON_DAPP_SIGN')).toBeUndefined()
    })
})

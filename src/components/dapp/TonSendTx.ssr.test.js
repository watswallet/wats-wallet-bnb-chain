// TonSendTx.vue'yu GERCEKTEN render eden testler.
//
// KOK NEDEN: TonConnect tek istekte 4'e kadar mesaj tasiyor. Ekran bunlari tek
// satirda toplarsa kullanici NEYI onayladigini goremez -- dort ayri alici ve
// dort ayri miktar, tek bir "toplam"in arkasinda kaybolur.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import TonSendTx from './TonSendTx.vue'

const ACCOUNT = { key: 'acc-1', address: '0xAaaa000000000000000000000000000000000001', name: 'Hesap A', type: 'hd' }
const FROM = '0:1111111111111111111111111111111111111111111111111111111111111111'
// manifestUrl BILEREK farkli bir host'ta (cdn.example.com): sender origin'iyle
// (app.dedust.io) AYNI olsaydi "html.toContain('app.dedust.io')" testi ekranin
// GERCEK origin'i mi yoksa manifest'in KENDI iddiasini mi gosterdigini ayirt
// edemezdi -- TonConnectApprove.ssr.test.js'teki (sibling ekran) AYNI tuzak notu.
const MANIFEST = { url: 'https://cdn.example.com', name: 'DeDust', iconUrl: null, manifestUrl: 'https://cdn.example.com/m.json', sameOrigin: false }

const msg = (n, extra = {}) => ({
    address: '0:' + String(n).repeat(64).slice(0, 64),
    amountNano: '1000000000',
    payload: null,
    stateInit: null,
    ...extra,
})

const ISTEK = {
    type: 'TON_SEND_TX',
    id: 'req-tx-1',
    origin: 'https://app.dedust.io',
    hostname: 'app.dedust.io',
    manifest: MANIFEST,
    from: FROM,
    network: '-239',
    validUntil: null,
    messages: [msg(2)],
    appRequestId: 'app-7',
}

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup(currentRequest, { sendSonuc = { success: true, boc: 'te6ccgEBAQ' } } = {}) {
    const stub = installChromeStub({ current_request: currentRequest, active_account: ACCOUNT })
    const gonderilen = []
    stub.setSendMessage(async (m) => {
        gonderilen.push(m)
        if (m.type === 'TON_DAPP_SEND') return sendSonuc
        return {}
    })

    const app = createApp(TonSendTx)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const page = pageStore()
    page.currentPage = 'ton_send_tx'

    return { app, page, stub, gonderilen }
}

describe('TonSendTx.vue (SSR) -- gosterim', () => {
    it('dort mesajin DORDU de ayri ayri cizilir', async () => {
        const mesajlar = [msg(2), msg(3), msg(4), msg(5)]
        const { app } = setup({ ...ISTEK, messages: mesajlar })
        const html = await render(app)
        for (const m of mesajlar) {
            // Adres kisaltilmis cizilebilir; bas ve son parcalar HTML'de olmali.
            expect(html).toContain(m.address.slice(2, 8))
        }
    })

    it('toplam miktar hesaplanir', async () => {
        const { app } = setup({ ...ISTEK, messages: [msg(2), msg(3)] })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.toplamNano).toBe('2000000000')
    })

    // Cuzdan BOC'u COZEMEZ. Cozebiliyormus gibi bir ozet gostermek, kullaniciyi
    // gercekte onaylamadigi bir seye ikna etmek olurdu.
    it('payload tasiyan mesajda veri uyarisi cizilir', async () => {
        const { app } = setup({ ...ISTEK, messages: [msg(2, { payload: 'te6ccgEB' })] })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.veriTasiyanMesajVar).toBe(true)
    })

    it('payload yoksa uyari cizilmez', async () => {
        const { app } = setup(ISTEK)
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.veriTasiyanMesajVar).toBe(false)
    })

    it('GERCEK origin ekranda, manifest in KENDI iddiasi DEGIL', async () => {
        const { app } = setup(ISTEK)
        const html = await render(app)
        expect(html).toContain('app.dedust.io')
        // MANIFEST.url/manifestUrl KASITLI olarak farkli bir host (cdn.example.com):
        // bu satir olmadan yukaridaki assertion "origin mi, manifest mi gosterildi"
        // sorusuna hicbir sey soylemezdi (ikisi de ayni metni tasiyabilirdi).
        expect(html).not.toContain('cdn.example.com')
    })
})

describe('TonSendTx.vue (SSR) -- onay', () => {
    it('TON_DAPP_SEND cagrilir ve BOC dapp e doner', async () => {
        const { app, gonderilen } = setup(ISTEK)
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)

        await holder.instance.setupState.onayla()

        const sendMsg = gonderilen.find((m) => m.type === 'TON_DAPP_SEND')
        expect(sendMsg.message.messages).toEqual(ISTEK.messages)
        expect(sendMsg.message.account?.key).toBe('acc-1')

        const ok = gonderilen.find((m) => m.type === 'SEND_TX_SUCCESS')
        expect(ok.requestId).toBe('req-tx-1')
        // Dapp BOC bekliyor, islem hash'i DEGIL (§3.1). Hash dondurmek dapp'in
        // yaniti ayristirmasini bozar.
        expect(ok.data.result.result).toBe('te6ccgEBAQ')
        expect(ok.data.result.id).toBe('app-7')
    })

    // GERCEK sozlesme: TON_DAPP_SEND'in basarisiz yaniti background.js'te HER ZAMAN
    // tonSendUserMessage'dan gecer (bkz. background.js:1977 -- tum hata yollari
    // `reject({ success: false, error: userMessage })` ile, ham kod DEGIL, BITMIS
    // bir metinle doner). Ekran ikinci bir kod->metin haritasi TUTMAZ (unreachable
    // kod incelemesi bulgusu) -- gelen metni OLDUGU GIBI gosterir. Burada background'un
    // TON_SEND_ERROR_MESSAGES sozlugundeki AYNI metin kullanilir (TON_TX_ALREADY_PENDING
    // karsiligi), ham bir kod DEGIL -- aksi halde bu test hicbir zaman calismayan
    // (unreachable) bir kod yoluna karsi gecerdi.
    it('arka plandan gelen BITMIS mesaj (tonSendUserMessage) dogrudan ekranda gosterilir', async () => {
        const { app, gonderilen } = setup(ISTEK, { sendSonuc: { success: false, error: 'Bekleyen bir TON islemi var.' } })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)

        await holder.instance.setupState.onayla()

        expect(holder.instance.setupState.hata).toBe('Bekleyen bir TON islemi var.')
        // Basarisiz gonderim dapp'e "basarili" olarak BILDIRILMEZ.
        expect(gonderilen.find((m) => m.type === 'SEND_TX_SUCCESS')).toBeUndefined()
    })

    // `error` alani BOS/eksik gelirse (beklenmeyen bir dal) genel bir yedek
    // mesaja duser -- bos bir kutu GOSTERILMEZ.
    it('error alani BOSSA genel bir yedek mesaj gosterilir', async () => {
        const { app, gonderilen } = setup(ISTEK, { sendSonuc: { success: false, error: '' } })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)

        await holder.instance.setupState.onayla()

        expect(holder.instance.setupState.hata).toBeTruthy()
        expect(gonderilen.find((m) => m.type === 'SEND_TX_SUCCESS')).toBeUndefined()
    })
})

describe('TonSendTx.vue (SSR) -- red', () => {
    // `send` yanitlari `connect`ten FARKLI tasinir: hata govdesi `{ error: { code } }`
    // seklinde, `id` ile birlikte (§3.1).
    it('kod 300 hata govdesi gonderilir', async () => {
        const { app, gonderilen } = setup(ISTEK)
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)

        await holder.instance.setupState.reddet()

        const yanit = gonderilen.find((m) => m.requestId === 'req-tx-1')
        expect(yanit.status).toBe('success')
        expect(yanit.data.result.error.code).toBe(300)
        expect(yanit.data.result.id).toBe('app-7')
        expect(gonderilen.find((m) => m.type === 'TON_DAPP_SEND')).toBeUndefined()
    })
})

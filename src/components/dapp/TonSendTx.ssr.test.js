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

// ATS onizlemesi SAHTE: bu dosyanin konusu EKRANIN KARARI, teklif mantigi degil
// (o useTonFee'nin kendi testlerinde olculuyor). Sahte olmasaydi her render aga
// cikardi. Degerler render'dan ONCE yazilir - useTonFee() setup'ta BIR KEZ
// cagriliyor ve o anki nesneyi yakaliyor.
const { atsDurum, routerDurum } = vi.hoisted(() => ({
    // `yuklemeler` = tonFee.load()'a gecen argumanlar. Teklifin ISTENIP
    // ISTENMEDIGINI olcmenin tek yolu: sahte composable her cagrida YENI bir
    // nesne donduruyor, disaridan vi.fn()'e tutunulamiyor.
    atsDurum: { atsMaxFee: null, relayActive: false, quote: null, yuklemeler: [], decision: null, loading: false },
    routerDurum: { liste: null },
}))

vi.mock('../../composables/useTonFee', () => ({
    useTonFee: () => ({
        atsMaxFee: { value: atsDurum.atsMaxFee },
        relayActive: { value: atsDurum.relayActive },
        quote: { value: atsDurum.quote },
        ready: { value: false }, decision: { value: atsDurum.decision }, statusUnreadable: { value: false },
        budget: { value: null }, loading: { value: atsDurum.loading }, onboarding: { value: false }, error: { value: null },
        load: async (args) => { atsDurum.yuklemeler.push(args) }, stop: vi.fn(), runOnboarding: vi.fn(),
    }),
}))

vi.mock('../../utils/ton/tonRouters', async (importOriginal) => {
    const actual = await importOriginal()
    // `rawAdres` GERCEK kalir: adres indirgemesi bu ekranin uygunluk kararinin
    // parcasi ve sahte bir surum onu olcusuz birakirdi.
    return { ...actual, tonRouterListesi: async () => (routerDurum.liste ? { routers: routerDurum.liste } : null) }
})

// ZINCIR BAKIYESI SAHTE: bu dosyanin konusu EKRANIN KARARI, RPC degil. Hata
// dali da buradan kurulur -- fail-closed davranis olculmeden kalamaz.
// VARSAYILAN BOL: bu dosyadaki diger testlerin konusu bakiye DEGIL (gosterim,
// uygunluk, onay govdesi). Varsayilani 0 birakmak, hepsini bakiye kapisinda
// kilitleyip olctukleri seyi olcemez hale getirirdi. Bakiyeyi olcen testler
// degeri KENDILERI yazar.
const { bakiyeDurum } = vi.hoisted(() => ({ bakiyeDurum: { ton: 1000, hata: null } }))

vi.mock('../../utils/ton/tonClient', () => ({ getTonClient: () => ({}) }))
vi.mock('../../utils/ton/tonBalance', () => ({
    getTonBalance: async () => {
        if (bakiyeDurum.hata) throw new Error(bakiyeDurum.hata)
        return bakiyeDurum.ton
    },
}))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import TonSendTx from './TonSendTx.vue'
// Metinler CEVIRI DOSYASINDAN okunur, buraya ELLE kopyalanmaz: kopyalansaydi bu
// dosya bir gun ceviriyle sessizce ayrisir ve "ekranda uyari var" derken aslinda
// artik hicbir yerde olmayan bir dizeyi ararak GECERDI. createTestI18n varsayilan
// olarak 'en' kurar (bkz. ssrRender.js), o yuzden karsilastirma da 'en' uzerinden.
import en from '../../i18n/locales/en.json'

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
    // Bakiye kapisini olcen blok kendi beforeEach'inde bunu EZER (ic beforeEach
    // distakinden SONRA kosar); buradaki sifirlama o blogun degerlerinin sonraki
    // dosya/bloklara SIZMASINI engeller.
    bakiyeDurum.ton = 1000
    bakiyeDurum.hata = null
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup(currentRequest, { sendSonuc = { success: true, boc: 'te6ccgEBAQ' }, evmCapable = false } = {}) {
    const stub = installChromeStub({ current_request: currentRequest, active_account: ACCOUNT })
    const gonderilen = []
    stub.setSendMessage(async (m) => {
        gonderilen.push(m)
        if (m.type === 'TON_DAPP_SEND') return sendSonuc
        if (m.type === 'TON_FEE_IDENTITY') return { success: true, tonPublicKey: '0xabcd', evmCapable }
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

    it('stateInit tasiyan mesajda -- payload OLMASA BILE -- uyari cizilir', async () => {
        const { app } = setup({ ...ISTEK, messages: [msg(2, { stateInit: 'te6STATEINIT' })] })
        const html = await render(app)
        expect(html).toContain(en.dapps.tonConnect.stateInitWarningTitle)
        expect(html).toContain(en.dapps.tonConnect.stateInitWarning)
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

// KOK NEDEN (2026-09-14 olculdu): `payload` ve `stateInit` tonConnectMessages.js'te
// BAGIMSIZ normalize ediliyor ve background.js ikisini AYRI kullaniyor
// (payload -> `body`, stateInit -> `init`). Ekran ise YALNIZ `payload`a bakiyordu.
// Sonuc: stateInit tasiyan ama payload TASIMAYAN bir mesaj -- yani alici adreste
// KONTRAT KURAN bir mesaj -- onay ekraninda duz bir transferden ayirt edilemiyordu:
// ne ust ozet uyarisi ne de kart ici kutu ciziliyordu.
//
// Bu testler GEREKSINIMI yazar, mevcut kodu TARIF ETMEZ: "kontrat kuran bir mesaj
// duz transferden ayirt edilebilir olmali" ve "iki alan BIRBIRINE BAGLANMAMALI".
// Ikinci cumle onemli -- iki bayragi tek bir `v-if`e katmak, payload'siz vakayi
// yine gorunmez birakirdi.
describe('TonSendTx.vue (SSR) -- stateInit payload DAN BAGIMSIZ', () => {
    const INIT_BOC = 'te6ccgEBAQEAAgAAAA=='
    const SADECE_INIT = (extra = {}) => ({ ...ISTEK, messages: [msg(2, { stateInit: INIT_BOC, ...extra })] })

    it('iki bayrak AYRI sorulari yanitlar -- biri otekini TETIKLEMEZ', async () => {
        const { app } = setup(SADECE_INIT())
        const holder = captureInstance(app, 'TonSendTx')
        const html = await render(app)

        expect(holder.instance.setupState.kontratKuranMesajVar).toBe(true)
        // payload YOK: veri uyarisi cizilMEmeli. Bu satir olmadan yukaridaki
        // assertion "iki uyari da her zaman ciziliyor" hatasini yakalayamazdi.
        expect(holder.instance.setupState.veriTasiyanMesajVar).toBe(false)
        expect(html).not.toContain(en.dapps.tonConnect.dataWarningTitle)
    })

    it('ham stateInit KAPALI baslar -- cuzdan BOC u cozemez, ozet UYDURMAZ', async () => {
        const { app } = setup(SADECE_INIT())
        const html = await render(app)
        // Disclosure'in KENDISI gorunur (kullanici bakabilmeli)...
        expect(html).toContain(en.dapps.tonConnect.rawStateInit)
        // ...ama ham deger ACILMADAN basilmaz.
        expect(html).not.toContain(INIT_BOC)
    })

    it('stateInit acilisi payload satirini ACMAZ', async () => {
        const { app } = setup(SADECE_INIT({ payload: 'te6PAYLOAD' }))
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)

        holder.instance.setupState.toggleInit(0)

        expect(holder.instance.setupState.openInit[0]).toBe(true)
        // Tek bir paylasilan bayrak kullanilsaydi kullanici istemedigi ikinci bir
        // ham BOC duvarina bakardi.
        expect(holder.instance.setupState.openRaw[0]).toBeFalsy()
    })

    it('iki alan da varsa IKI uyari da cizilir', async () => {
        const { app } = setup(SADECE_INIT({ payload: 'te6PAYLOAD' }))
        const html = await render(app)
        expect(html).toContain(en.dapps.tonConnect.dataWarningTitle)
        expect(html).toContain(en.dapps.tonConnect.stateInitWarningTitle)
    })

    it('ikisi de yoksa HICBIR uyari cizilmez', async () => {
        const { app } = setup(ISTEK)
        const html = await render(app)
        expect(html).not.toContain(en.dapps.tonConnect.dataWarningTitle)
        expect(html).not.toContain(en.dapps.tonConnect.stateInitWarningTitle)
    })

    it('onaya giden govde DEGISMEDI -- bu bir GOSTERIM duzeltmesi', async () => {
        // Uyari eklemek gonderilen mesaji degistirmemeli: stateInit background'a
        // AYNEN gitmeye devam eder (orada `init` olarak kullaniliyor). Aksi halde
        // mesru bir deploy akisi sessizce kirilirdi.
        const istek = SADECE_INIT()
        const { app, gonderilen } = setup(istek)
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)

        await holder.instance.setupState.onayla()

        const sendMsg = gonderilen.find((m) => m.type === 'TON_DAPP_SEND')
        expect(sendMsg.message.messages).toEqual(istek.messages)
        expect(sendMsg.message.messages[0].stateInit).toBe(INIT_BOC)
    })
})

// ---------------------------------------------------------------------------
// ATS ILE ODEME. Bu ekranda relay/self-pay ANAHTARI YOKTUR - mod karardan turer.
// Yani "gonderim aninda anlariz" secenegi yok: kullaniciya odeyemeyecegi bir ucret
// gostermek, donebilecegi hicbir secenegi olmayan bir cikmazdir. Karar bu yuzden
// KART CIZILMEDEN once verilmeli ve asagidaki testler tam olarak o karari olcer.
// ---------------------------------------------------------------------------
describe('TonSendTx.vue (SSR) -- ATS uygunlugu', () => {
    const ROUTER = '0:779dcc815138d9500e449c5291e7f12738c23d575b5310000f6a253bd607384e'

    beforeEach(() => {
        atsDurum.atsMaxFee = null
        atsDurum.relayActive = false
        atsDurum.quote = null
        atsDurum.yuklemeler = []
        routerDurum.liste = null
    })

    const hazirTeklif = () => {
        atsDurum.atsMaxFee = '18.4'
        atsDurum.relayActive = true
        atsDurum.quote = { sign: { feeAuth: { atsMaxFee: '18400000000000000000' } } }
    }

    it('yuksuz mesajda ATS karti cizilir ve TON ihtiyat satiri GIZLENIR', async () => {
        hazirTeklif()
        const { app } = setup(ISTEK, { evmCapable: true })
        const html = await render(app)
        expect(html).toContain('18.4')
        // IKI UCRET AYNI ANDA GOSTERILMEZ: hangisini odedigini soylemez.
        expect(html).not.toContain('≈ 0.01 GRAM')
    })

    it('EVM kasasi yoksa ATS YOK -- TON ihtiyat satiri kalir', async () => {
        hazirTeklif()
        const { app } = setup(ISTEK, { evmCapable: false })
        const html = await render(app)
        expect(html).toContain('≈ 0.01 GRAM')
        expect(html).not.toContain('18.4')
    })

    // Teklif cozulemediyse (ag kesintisi, bakiye yetmedi) kart CIZILMEZ ama gonderim
    // self-pay'e duser. Ihtiyat satiri GORUNMELI - yoksa kullanici odedigi TON
    // ucretini HICBIR YERDE gormez.
    it('teklif cozulemediyse kart YOK, ihtiyat satiri VAR', async () => {
        atsDurum.relayActive = true  // bolge acik...
        atsDurum.atsMaxFee = null    // ...ama fiyat yok
        const { app } = setup(ISTEK, { evmCapable: true })
        const html = await render(app)
        expect(html).toContain('≈ 0.01 GRAM')
    })

    it('stateInit tasiyan mesaj ASLA uygun degildir', async () => {
        hazirTeklif()
        routerDurum.liste = new Set([ROUTER])
        const { app } = setup({ ...ISTEK, messages: [msg(2, { stateInit: 'te6INIT' })] }, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        const html = await render(app)
        expect(holder.instance.setupState.relayEligible).toBe(false)
        expect(html).toContain('≈ 0.01 GRAM')
    })

    it('yuklu mesaj: hedef beyaz listede DEGILSE uygun degildir', async () => {
        hazirTeklif()
        routerDurum.liste = new Set([ROUTER])
        const { app } = setup({ ...ISTEK, messages: [msg(2, { payload: 'te6YUK' })] }, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.relayEligible).toBe(false)
    })

    it('yuklu mesaj: hedef beyaz listedeyse uygundur', async () => {
        hazirTeklif()
        routerDurum.liste = new Set([ROUTER])
        const { app } = setup({
            ...ISTEK,
            messages: [{ address: ROUTER, amountNano: '50000000', payload: 'te6YUK', stateInit: null }],
        }, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.relayEligible).toBe(true)
    })

    // ESKI SUNUCU (uc 404 -> liste null). "Bilinmiyor"u "bos" saymak, liste gelmeden
    // yuklu bir gonderimi UYGUN gostermek olurdu.
    it('router listesi OKUNAMADIYSA yuklu mesaj uygun degildir', async () => {
        hazirTeklif()
        routerDurum.liste = null
        const { app } = setup({
            ...ISTEK,
            messages: [{ address: ROUTER, amountNano: '50000000', payload: 'te6YUK', stateInit: null }],
        }, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.relayEligible).toBe(false)
    })

    // YUK VARSA `amount` HEDEF KONTRATIN GAZIDIR (relayer fonlar) -> gasTonNano.
    // YUK YOKSA kullanicinin KENDI parasidir -> amountNano. Yanlis alana yazmak ya
    // aliciya sifir gonderir ya da roleciye kullanicinin transferini odetir.
    it('eylem eslemesi: yuk varsa gasTonNano, yoksa amountNano', async () => {
        hazirTeklif()
        routerDurum.liste = new Set([ROUTER])
        const { app } = setup({
            ...ISTEK,
            messages: [
                { address: ROUTER, amountNano: '50000000', payload: 'te6YUK', stateInit: null },
                msg(3, { payload: null }),
            ],
        }, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)

        const [yuklu, duz] = holder.instance.setupState.tonFeeActions
        expect(yuklu).toMatchObject({ kind: 'raw', amountNano: '0', gasTonNano: '50000000', payloadBoc: 'te6YUK', bounce: true })
        expect(duz).toMatchObject({ kind: 'raw', amountNano: '1000000000', bounce: false })
        expect(duz).not.toHaveProperty('gasTonNano')
    })

    it('onay: gorulen tutar ve relay bayragi arka plana GIDER', async () => {
        hazirTeklif()
        const { app, gonderilen } = setup(ISTEK, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)

        await holder.instance.setupState.onayla()

        const sendMsg = gonderilen.find((m) => m.type === 'TON_DAPP_SEND')
        expect(sendMsg.message.payWithTonFee).toBe(true)
        // V10'un girdisi: sunucu daha yuksek bir ucret kurarsa gonderim DUSER.
        expect(sendMsg.message.approvedAtsFee).toBe('18400000000000000000')
    })

    it('uygun degilken bayrak GONDERILMEZ (self-pay)', async () => {
        const { app, gonderilen } = setup(ISTEK, { evmCapable: false })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)

        await holder.instance.setupState.onayla()

        const sendMsg = gonderilen.find((m) => m.type === 'TON_DAPP_SEND')
        expect(sendMsg.message.payWithTonFee).toBe(false)
        expect(sendMsg.message.approvedAtsFee).toBe(null)
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

// ---------------------------------------------------------------------------
// HICBIR SEY YAPMAYAN ISLEM.
//
// OLCULDU 2026-09-14 (canli paymaster): 0 nanoton tasiyan, govdesiz bir eylem
// /quote'tan 400 ile doner -- "actions[0] does nothing". Sunucu fiyatlandirmiyor,
// cuzdan da IMZALAMAMALI: boyle bir mesaj hedefte hicbir sey yapmaz, geriye
// yalniz kullanicinin odedigi ag ucreti kalir.
//
// KAPSAM KARARI: mesajlardan HERHANGI BIRI bossa TUM istek reddedilir. Karisik
// bir istegi (bir bos + bir gercek) gecirmek, kullaniciya bos mesajin ucretini
// odetmek olurdu; dahasi o istek zaten ATS teklifi ALAMIYOR.
//
// RED KULLANICININ ELINDE KALIR: ekran acilir ve dapp'in NE ISTEDIGI gorunur,
// yalnizca "Onayla" kapanir. Ekrani hic acmamak kullaniciya dappte neden hicbir
// sey olmadigini SOYLEMEZDI.
// ---------------------------------------------------------------------------
describe('TonSendTx.vue (SSR) -- hicbir sey yapmayan islem', () => {
    const bos = (n = 2) => msg(n, { amountNano: '0' })

    beforeEach(() => {
        atsDurum.atsMaxFee = null
        atsDurum.relayActive = false
        atsDurum.quote = null
        atsDurum.yuklemeler = []
        routerDurum.liste = null
    })

    it('0 TON + govde YOK -> bos mesaj olarak isaretlenir', async () => {
        const { app } = setup({ ...ISTEK, messages: [bos()] })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.bosMesajVar).toBe(true)
    })

    it('0 TON ama GOVDE varsa bos DEGILDIR (dapp islemlerinin yaygin sekli)', async () => {
        const { app } = setup({ ...ISTEK, messages: [msg(2, { amountNano: '0', payload: 'te6YUK' })] })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.bosMesajVar).toBe(false)
    })

    it('mesajlardan BIRI bossa tum istek isaretlenir', async () => {
        const { app } = setup({ ...ISTEK, messages: [msg(3), bos(4)] })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.bosMesajVar).toBe(true)
    })

    it('sebebi soyleyen kart CIZILIR', async () => {
        const { app } = setup({ ...ISTEK, messages: [bos()] })
        const html = await render(app)
        // Ceviri anahtari GERCEKTEN var mi: yoksa asagidaki toContain(undefined)
        // anlamsiz bir TypeError'a duserdi.
        expect(en.dapps.tonConnect.noopWarningTitle).toBeTruthy()
        expect(en.dapps.tonConnect.noopWarning).toBeTruthy()
        expect(html).toContain(en.dapps.tonConnect.noopWarningTitle)
        expect(html).toContain(en.dapps.tonConnect.noopWarning)
    })

    it('Onayla butonu KAPANIR, Reddet ACIK kalir', async () => {
        const { app } = setup({ ...ISTEK, messages: [bos()] })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.onayKapali).toBe(true)
        // Kullanicinin cikis yolu KALMALI: iki buton da kapanirsa dapp yanitsiz
        // asili kalir ve pencere ancak kapatilarak terk edilir.
        expect(holder.instance.setupState.loading).toBe(false)
    })

    it('onayla() cagrilsa BILE hicbir sey gonderilmez', async () => {
        const { app, gonderilen } = setup({ ...ISTEK, messages: [bos()] })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)

        await holder.instance.setupState.onayla()

        expect(gonderilen.find((m) => m.type === 'TON_DAPP_SEND')).toBeUndefined()
        expect(gonderilen.find((m) => m.type === 'SEND_TX_SUCCESS')).toBeUndefined()
    })

    it('Reddet CALISMAYA devam eder -- dapp yanitsiz kalmaz', async () => {
        const { app, gonderilen } = setup({ ...ISTEK, messages: [bos()] })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)

        await holder.instance.setupState.reddet()

        const yanit = gonderilen.find((m) => m.type === 'SEND_TX_SUCCESS')
        expect(yanit.data.result.error.code).toBe(300)
        expect(yanit.data.result.id).toBe('app-7')
    })

    // Teklif her acilista 400 aliyordu. Uygunluk kapisina tasinarak hem bos bir
    // cagri kalkar hem de fiyatsiz bir ucret kartinin kazara acilmasi imkansizlasir.
    it('ATS teklifi HIC ISTENMEZ', async () => {
        const { app } = setup({ ...ISTEK, messages: [bos()] }, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.relayEligible).toBe(false)
        expect(atsDurum.yuklemeler).toHaveLength(0)
    })

    // Karsit kanit: AYNI kurulumda dolu bir mesaj teklifi ISTIYOR. Olmasaydi
    // yukaridaki test her zaman gecerdi ve hicbir sey kanitlamazdi.
    it('dolu mesajda teklif ISTENIR (karsit kanit)', async () => {
        const { app } = setup(ISTEK, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.relayEligible).toBe(true)
        expect(atsDurum.yuklemeler).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// UCRET ENGELI KARARI -- SESSIZ DUSUS BITTI.
//
// OLCULEN HATA: useTonFee /status ya da /quote dustugunde bir `decision`
// URETIYOR, ama bu ekran onu HIC cizmiyordu (ConfirmTransaction.vue 7 yerde
// ciziyor). Sonuc: her acilista alinan 400/500 kullaniciya HICBIR SEY soylemeden
// self-pay'e dusuyor ve "ATS ucret karti neden yok" sorusunun gorunur bir cevabi
// olmuyordu.
//
// KART GONDERIMI ENGELLEMEZ. ConfirmTransaction.vue'da kullanici ATS'yi SECIYOR,
// orada `feeBlocked` gonderimi kapatir. BURADA secim yok: teklif dusse de
// self-pay CALISIR. Calisan bir gonderimi kapatmak sessiz dususten daha kotudur.
// ---------------------------------------------------------------------------
describe('TonSendTx.vue (SSR) -- ucret engeli karari', () => {
    const KARAR = { severity: 'transient', action: 'retry-later', i18nKey: 'send.confirmTransaction.tonQuoteUnavailable' }

    beforeEach(() => {
        atsDurum.atsMaxFee = null
        atsDurum.relayActive = false
        atsDurum.quote = null
        atsDurum.yuklemeler = []
        atsDurum.decision = null
        atsDurum.loading = false
        routerDurum.liste = null
    })

    it('karar varken SEBEP cizilir', async () => {
        atsDurum.decision = KARAR
        const { app } = setup(ISTEK, { evmCapable: true })
        const html = await render(app)
        expect(en.send.confirmTransaction.tonQuoteUnavailable).toBeTruthy()
        expect(html).toContain(en.send.confirmTransaction.tonQuoteUnavailable)
    })

    // Kartin ASIL isi bu satir: kullanici bir uyari gorup gonderimin DURDUGUNU
    // sanmamali.
    it('islemin TON ile gidecegi ACIKCA yazar', async () => {
        atsDurum.decision = KARAR
        const { app } = setup(ISTEK, { evmCapable: true })
        const html = await render(app)
        expect(en.dapps.tonConnect.feeFallbackSelfPay).toBeTruthy()
        expect(html).toContain(en.dapps.tonConnect.feeFallbackSelfPay)
    })

    // "istemci/akis hatasi; kod duzeltir, suclan(m)az" -- tonFeeBlocker.js.
    // ConfirmTransaction.vue ile AYNI suzgec.
    it('severity internal CIZILMEZ', async () => {
        atsDurum.decision = { severity: 'internal', action: 'fresh-quote', i18nKey: 'send.confirmTransaction.tonFreshQuoteNeeded' }
        const { app } = setup(ISTEK, { evmCapable: true })
        const html = await render(app)
        expect(html).not.toContain(en.send.confirmTransaction.tonFreshQuoteNeeded)
    })

    // ATS hic masada degilse ATS hakkinda alarm verme.
    it('relay uygun DEGILKEN cizilmez', async () => {
        atsDurum.decision = KARAR
        const { app } = setup(ISTEK, { evmCapable: false })
        const holder = captureInstance(app, 'TonSendTx')
        const html = await render(app)
        expect(holder.instance.setupState.relayEligible).toBe(false)
        expect(html).not.toContain(en.send.confirmTransaction.tonQuoteUnavailable)
    })

    // EN ONEMLI TEST. Kart bir UYARIDIR, bir engel DEGIL.
    it('gonderim ACIK kalir -- kart Onayla dugmesini KAPATMAZ', async () => {
        atsDurum.decision = { ...KARAR, severity: 'blocked', action: 'abort-unsafe' }
        const { app, gonderilen } = setup(ISTEK, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)

        expect(holder.instance.setupState.onayKapali).toBe(false)
        await holder.instance.setupState.onayla()
        expect(gonderilen.find((m) => m.type === 'TON_DAPP_SEND')).toBeDefined()
    })

    it('retry-later kararinda tekrar deneme teklifi YENIDEN ister', async () => {
        atsDurum.decision = KARAR
        const { app } = setup(ISTEK, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)

        const onceki = atsDurum.yuklemeler.length
        expect(onceki).toBeGreaterThan(0)
        await holder.instance.setupState.feeTekrarDene()
        expect(atsDurum.yuklemeler.length).toBe(onceki + 1)
        // AYNI argumanlarla: farkli bir niyet icin fiyatlanan teklif, kullanicinin
        // fiyatini GORDUGU gonderimde dogrulamayi dusururdu.
        const [ilk, son] = [atsDurum.yuklemeler[onceki - 1], atsDurum.yuklemeler[onceki]]
        expect(son.actions).toEqual(ilk.actions)
        expect(son.tonWallet).toBe(ilk.tonWallet)
    })

    // Yeniden denemenin ANLAMLI oldugu tek durumlar retry-later/refresh-status.
    // abort-unsafe bir GUVENLIK reddidir: ayni yanit yine gelir ve kullaniciyi
    // donguye sokar (ConfirmTransaction.vue:418'deki AYNI kural).
    it('abort-unsafe kararinda tekrar dene dugmesi YOK', async () => {
        atsDurum.decision = { severity: 'blocked', action: 'abort-unsafe', i18nKey: 'send.confirmTransaction.tonUnsafeQuote' }
        const { app } = setup(ISTEK, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.feeTekrarDenebilir).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// GONDERILEN TUTAR ROLE MODUNDA DA KULLANICIDAN CIKAR.
//
// Paymaster ekibinin 2026-09-14 cevabi (docs/backend-istek-2026-09-14c-uninit-
// cuzdan-role.md, bolum 5): `amountNano` HICBIR ZAMAN sponsorlanmaz; rolecinin
// ilistirdigi TON (`gasTonNano`) yalniz HEDEF kontratin gazini fonlar. Bu ekranda
// HICBIR bakiye kontrolu yoktu -- yani yetersiz bakiyeli bir dapp gonderiminde
// ATS TAHSIL EDILIR, islem zincirde duser ve kullanici karsiliginda hicbir sey
// almaz. Sunucu tarafi da kullanicinin TON bakiyesini OKUMUYOR (ayni belge).
// ---------------------------------------------------------------------------
describe('TonSendTx.vue (SSR) -- TON bakiye kapisi', () => {
    const ROUTER = '0:779dcc815138d9500e449c5291e7f12738c23d575b5310000f6a253bd607384e'
    const BIR_TON = '1000000000'

    beforeEach(() => {
        atsDurum.atsMaxFee = null
        atsDurum.relayActive = false
        atsDurum.quote = null
        atsDurum.yuklemeler = []
        atsDurum.decision = null
        routerDurum.liste = null
        bakiyeDurum.ton = 0
        bakiyeDurum.hata = null
    })

    const hazirTeklif = () => {
        atsDurum.atsMaxFee = '18.4'
        atsDurum.relayActive = true
        atsDurum.quote = { sign: { feeAuth: { atsMaxFee: '18400000000000000000' } } }
    }

    it('role ACIK + bakiye TUTARDAN AZ -> onay KAPALI', async () => {
        hazirTeklif()
        bakiyeDurum.ton = 0.5
        const { app } = setup({ ...ISTEK, messages: [msg(2, { amountNano: BIR_TON })] }, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.yetersizTonBakiyesi).toBe(true)
        expect(holder.instance.setupState.onayKapali).toBe(true)
    })

    // Role modunda AG UCRETI rolecinin -- ihtiyat payi ISTENMEZ. Ekran zaten o
    // modda "≈ 0.01 GRAM" satirini GIZLIYOR; kontrolun yine de istemesi, ekranin
    // soyledigi ile butonun yaptigini ayirirdi.
    it('role ACIK + bakiye tam TUTARA esit -> onay ACIK', async () => {
        hazirTeklif()
        bakiyeDurum.ton = 1
        const { app } = setup({ ...ISTEK, messages: [msg(2, { amountNano: BIR_TON })] }, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.yetersizTonBakiyesi).toBe(false)
        expect(holder.instance.setupState.onayKapali).toBe(false)
    })

    // YUKLU mesajda tutar `gasTonNano`ya gider: roleci fonlar, kullanicidan
    // CIKMAZ. Bu yuzden sifir bakiye bile ENGEL DEGIL.
    it('role ACIK + YUKLU mesaj + SIFIR bakiye -> onay ACIK (roleci fonluyor)', async () => {
        hazirTeklif()
        routerDurum.liste = new Set([ROUTER])
        bakiyeDurum.ton = 0
        const { app } = setup({
            ...ISTEK,
            messages: [{ address: ROUTER, amountNano: BIR_TON, payload: 'te6YUK', stateInit: null }],
        }, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.relayEligible).toBe(true)
        expect(holder.instance.setupState.yetersizTonBakiyesi).toBe(false)
    })

    // SELF-PAY'de ag ucreti kullanicidan cikar: ekranin gosterdigi ihtiyat payi
    // (TON_FEE_RESERVE) bakiyede AYRICA bulunmali.
    it('role KAPALI + bakiye tam TUTARA esit -> onay KAPALI (ihtiyat payi gerekli)', async () => {
        bakiyeDurum.ton = 1
        const { app } = setup({ ...ISTEK, messages: [msg(2, { amountNano: BIR_TON })] })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.yetersizTonBakiyesi).toBe(true)
    })

    // SELF-PAY'DE YUK, TUTARIN KIMDEN CIKTIGINI DEGISTIRMEZ. Role modundaki
    // "yuklu mesajin tutarini sayma" kurali self-pay'e SIZARSA, kullanicinin
    // gercekten odeyecegi tutar hic olculmemis olur -- ve bu kacak yalniz
    // YUKLU bir mesajla gorunur (yuksuz mesajda iki dal ayni sonucu verir).
    it('role KAPALI + YUKLU mesaj: tutar yine kullanicidan cikar', async () => {
        bakiyeDurum.ton = 0.5
        const { app } = setup({
            ...ISTEK,
            messages: [{ address: ROUTER, amountNano: BIR_TON, payload: 'te6YUK', stateInit: null }],
        })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.sendWithTonRelay).toBe(false)
        expect(holder.instance.setupState.yetersizTonBakiyesi).toBe(true)
    })

    it('role KAPALI + bakiye tutar + ihtiyat payini KARSILIYOR -> onay ACIK', async () => {
        bakiyeDurum.ton = 1.02
        const { app } = setup({ ...ISTEK, messages: [msg(2, { amountNano: BIR_TON })] })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.yetersizTonBakiyesi).toBe(false)
    })

    // FAIL-CLOSED: bakiye okunamadiysa yettigini BILMIYORUZ. ConfirmTransaction.vue
    // bu ekranin ikizinde AYNI karari veriyor.
    it('bakiye OKUNAMAZSA onay KAPALI', async () => {
        hazirTeklif()
        bakiyeDurum.hata = 'proxy dustu'
        const { app } = setup({ ...ISTEK, messages: [msg(2, { amountNano: BIR_TON })] }, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.yetersizTonBakiyesi).toBe(true)
    })

    // Cok mesajli istekte toplam olculur -- tek tek bakmak, ikisi ayri ayri
    // sigarken TOPLAMI sigmayan istegi gecirirdi.
    it('cok mesajli istekte TOPLAM olculur', async () => {
        hazirTeklif()
        bakiyeDurum.ton = 1.5
        const { app } = setup({
            ...ISTEK,
            messages: [msg(2, { amountNano: BIR_TON }), msg(3, { amountNano: BIR_TON })],
        }, { evmCapable: true })
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        expect(holder.instance.setupState.yetersizTonBakiyesi).toBe(true)
    })

    it('yetersiz bakiyede kirmizi kart CIZILIR', async () => {
        hazirTeklif()
        bakiyeDurum.ton = 0
        const { app } = setup({ ...ISTEK, messages: [msg(2, { amountNano: BIR_TON })] }, { evmCapable: true })
        const html = await render(app)
        expect(html).toContain(en.dapps.tonConnect.insufficientTonTitle)
    })
})

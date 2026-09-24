// TonConnect PROTOKOL UYUMLULUK testleri -- dapp'in TELDEN GERCEKTEN aldigi
// govdeyi (ConnectEvent, WalletResponse, disconnect olayi) TonConnect
// semasina karsi kilitler.
//
// NEDEN BU DOSYA VAR (final inceleme -- sistemik cozum): bu ozellikte HER
// sinir iki taraftan da test edilmisti -- SSR testleri ekranin chrome.runtime.
// sendMessage'a NE GONDERDIGINI, arka plan testleri handler'in NE YAPTIGINI
// dogruluyordu. Ama protokol SOZLESMESININ KENDISI -- dapp'in @tonconnect/sdk'sinin
// GERCEKTEN okudugu govde -- HICBIR YERDE dogrulanmiyordu. Ucu ayri bulgu
// (device.features BOS, signData.domain YANLIS SEKILDE, 4001 UNKNOWN_ERROR'a
// dusuyor) tam bu bosluktan sizdi -- ustelik biri (TonSignData.ssr.test.js)
// SANATLI BICIMDE defekti KILITLIYORDU (domain.lengthBytes bekliyordu, oysa
// TonConnect domain'i DUZ DIZE ister).
//
// Asagidaki testler govdeleri MUMKUN OLDUGUNCA GERCEK KOD YOLUNDAN gecirerek
// kurar (handleTonConnect/handleTonRestore/handleTonSend -- tonDappFunctions.js;
// resolvePendingRequest -- dappFunctions.js; TonConnectApprove.vue/TonSendTx.vue/
// TonSignData.vue -- GERCEKTEN render edilip GERCEK onayla()/reddet() cagrilir;
// tonInjected.js -- GERCEKTEN import edilip sahte bir `window` uzerinde
// calistirilir). Sema DOGRUDAN literal olarak YENIDEN YAZILMAZ: anahtar
// kumesi (Object.keys) ve deger TIPI kontrol edilir, degerin KENDISI degil --
// aksi halde bu dosya da tasarim belgesindeki tabloyu (SS3, SS3.1, SS3.2)
// birebir kopyalayip "gecen" bir kopya inceleme olurdu.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// TON BAKIYESI SAPLANIR, BOL BIR DEGERLE. TonSendTx artik gonderim oncesi
// bakiyeyi zincirden okuyor ve okuyamazsa FAIL-CLOSED davraniyor (`onayla()`
// hicbir sey yapmadan doner) -- paymaster'in 2026-09-14 cevabi, bolum 5:
// `amountNano` sponsorlanmaz, yetersiz bakiyede ucret alinir ve islem duser.
// Bu dosyanin konusu PROTOKOL GOVDESI, bakiye kapisi DEGIL (o
// TonSendTx.ssr.test.js'te olculuyor); saplama olmadan burada olculen sey
// sessizce "bakiye okunamadi" dalina kayardi.
vi.mock('./utils/ton/tonClient', () => ({ getTonClient: () => ({}) }))
vi.mock('./utils/ton/tonBalance', () => ({ getTonBalance: async () => 1000 }))

import { createApp, captureInstance, render, createTestPinia, createTestI18n } from './test-utils/ssrRender.js'
import { pageStore } from './store/pageStore'
import TonConnectApprove from './components/dapp/TonConnectApprove.vue'
import TonSendTx from './components/dapp/TonSendTx.vue'
import TonSignData from './components/dapp/TonSignData.vue'

const SENDER = { origin: 'https://app.dedust.io', tab: { id: 7, favIconUrl: 'https://app.dedust.io/f.ico' } }
// Gorev 5: handleTonConnect/handleTonRestore/handleTonSend artik hesap
// kapisi tasiyor (accountHasTon) -- eski hibrit fikstur ('hd') bu kapida
// FAIL-CLOSED reddedilir. Bu dosyanin konusu protokol GOVDESI, hesap kapisi
// DEGIL (o tonDappAccountGate.test.js'te olculuyor), o yuzden fikstur mesru
// bir TON hesabina cevrildi -- akisin gerisi (device semasi, BOC/domain
// bicimi, K3 kod eslemesi) degismedi.
const ACCOUNT = { key: 'acc-1', address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG', name: 'Hesap A', type: 'ton' }
// handleTonRestore/handleTonSend oturumun sahibi hesabi `active_account`
// DEGIL vaults'ta arar (tonImzalayanHesap) -- ACCOUNT'un tek basina var
// olmasi yetmez, bir kasa icinde de durmasi gerekir.
const TON_VAULT = { fingerprint: 'f-ton', type: 'tonMnemonic', accounts: [ACCOUNT] }
const TON_ADDRESS_RAW = '0:1111111111111111111111111111111111111111111111111111111111111111'
const MANIFEST = { name: 'DeDust', url: 'https://app.dedust.io', iconUrl: null, manifestUrl: 'https://app.dedust.io/m.json', sameOrigin: true }

/**
 * Depoda tekrarlanan chrome.storage/windows/tabs/runtime sahte uygulamasi --
 * tonDappFunctions.*.test.js dosyalarindaki AYNI kalip, BURAYA KASITLI
 * KOPYALANDI (dosyalar birbirinden BAGIMSIZ kalmali -- bkz. sendTx.test.js
 * basindaki ayni gerekce). `windows.onRemoved` GERCEKTEN yakalanir (`pencereyiKapat`)
 * ve `runtime.sendMessage` sonradan degistirilebilir (`setSendMessage`) --
 * boylece AYNI sahte chrome hem arka plan cagrilarini (handleTonConnect/
 * handleTonSend) HEM DE SSR ile render edilen onay ekranlarini besleyebilir.
 */
function kurChrome(local = {}) {
    const store = { ...local }
    const acilanPencereler = []
    let onRemovedHandler = null
    let sendMessageImpl = async () => ({})
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const w = keys === undefined ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys])
                    return Object.fromEntries(w.map((k) => [k, store[k]]))
                },
                set: async (obj) => { Object.assign(store, obj) },
                remove: async (k) => { delete store[k] },
            },
        },
        windows: {
            create: async (opts) => { acilanPencereler.push(opts); return { id: acilanPencereler.length } },
            remove: async () => {},
            get: async () => ({}),
            getLastFocused: async () => ({ width: 1200, left: 0, top: 0 }),
            onRemoved: { addListener: (fn) => { onRemovedHandler = fn } },
        },
        tabs: {
            query: async () => [{ id: 3 }],
            sendMessage: async () => {},
        },
        runtime: {
            getURL: (p) => 'chrome-extension://x/' + p,
            sendMessage: (...args) => sendMessageImpl(...args),
        },
    }
    return {
        store,
        acilanPencereler,
        setSendMessage: (fn) => { sendMessageImpl = fn },
        pencereyiKapat: (windowId) => onRemovedHandler?.(windowId),
    }
}

/** tonInjected.js'in SAYFA dunyasinda beklegi sahte `window` -- tonInjected.test.js'teki AYNI yardimci. */
function kurWindow() {
    const dinleyiciler = []
    const gonderilen = []
    globalThis.window = {
        addEventListener: (tip, fn) => { if (tip === 'message') dinleyiciler.push(fn) },
        removeEventListener: () => {},
        postMessage: (data) => { gonderilen.push(data) },
        dispatchEvent: () => {},
    }
    globalThis.window.self = globalThis.window
    return { dinleyiciler, gonderilen }
}

const anahtarSeti = (nesne) => Object.keys(nesne).sort()

/**
 * ConnectEvent'in `device` alani icin TEK sema kontrolu -- hem restoreConnection
 * hem connect() onay ekrani BUNU cagirir. Iki ayri cagiri noktasinin AYNI semaya
 * uydugunu kanitlamak, tam olarak K1'in kok nedenini (uc kopyadan ikisi
 * `features: []` ile SESSIZCE kalmisti) kapatan iddia.
 */
function deviceSemasiniDogrula(device) {
    expect(anahtarSeti(device)).toEqual(['appName', 'appVersion', 'features', 'maxProtocolVersion', 'platform'])
    expect(typeof device.platform).toBe('string')
    expect(typeof device.appName).toBe('string')
    expect(typeof device.appVersion).toBe('string')
    expect(typeof device.maxProtocolVersion).toBe('number')
    // K1'IN TAM KENDISI: features BOS DEGIL. Bos olsaydi @tonconnect/sdk
    // checkSendTransactionSupport/checkSignDataSupport istegi bize hic
    // ULASMADAN WalletNotSupportFeatureError firlatirdi.
    expect(Array.isArray(device.features)).toBe(true)
    const sendFeature = device.features.find((f) => f?.name === 'SendTransaction')
    const signFeature = device.features.find((f) => f?.name === 'SignData')
    expect(sendFeature, 'SendTransaction feature bildirilmeli').toBeTruthy()
    expect(signFeature, 'SignData feature bildirilmeli').toBeTruthy()
    expect(anahtarSeti(sendFeature)).toEqual(['extraCurrencySupported', 'maxMessages', 'name'])
    expect(typeof sendFeature.maxMessages).toBe('number')
    // request validation (tonConnectMessages.js) AYNI sayiyi zorluyor -- burasi
    // o sayidan kopmemeli.
    expect(sendFeature.maxMessages).toBe(4)
    expect(typeof sendFeature.extraCurrencySupported).toBe('boolean')
    expect(anahtarSeti(signFeature)).toEqual(['name', 'types'])
    expect(Array.isArray(signFeature.types)).toBe(true)
    expect(signFeature.types).toEqual(['text', 'binary', 'cell'])
}

beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
    delete globalThis.window
})

describe('ConnectEvent -- dapp in connect()/restoreConnection() dan aldigi govde', () => {
    const RESTORE_SESSION = {
        address: TON_ADDRESS_RAW, publicKey: 'ab12cd34', accountKey: 'acc-1', chain: '-239',
        walletStateInit: 'te6cckEBAQEAAgAAAEysuc0=', manifest: MANIFEST, connectedAt: 1,
    }

    it('restoreConnection basarili govde: anahtar/tip semasi VE device semasi (K1)', async () => {
        kurChrome({ ton_dapps: { 'app.dedust.io': RESTORE_SESSION }, active_account: ACCOUNT, vaults: [TON_VAULT] })
        const { handleTonRestore } = await import('./utils/tonDappFunctions.js')
        const yanitlar = []
        await handleTonRestore({}, SENDER, (r) => yanitlar.push(r))

        const body = yanitlar[0].result
        expect(anahtarSeti(body)).toEqual(['event', 'id', 'payload'])
        expect(body.event).toBe('connect')
        expect(typeof body.id).toBe('number')
        expect(anahtarSeti(body.payload)).toEqual(['device', 'items'])
        deviceSemasiniDogrula(body.payload.device)

        expect(Array.isArray(body.payload.items)).toBe(true)
        const addrItem = body.payload.items.find((i) => i.name === 'ton_addr')
        expect(anahtarSeti(addrItem)).toEqual(['address', 'name', 'network', 'publicKey', 'walletStateInit'])
        for (const k of ['address', 'name', 'network', 'publicKey', 'walletStateInit']) {
            expect(typeof addrItem[k]).toBe('string')
        }
    })

    it('kayitli oturum yoksa connect_error govdesi {code,message} semasindadir', async () => {
        kurChrome({ ton_dapps: {} })
        const { handleTonRestore } = await import('./utils/tonDappFunctions.js')
        const yanitlar = []
        await handleTonRestore({}, SENDER, (r) => yanitlar.push(r))

        const body = yanitlar[0].result
        expect(anahtarSeti(body)).toEqual(['event', 'id', 'payload'])
        expect(body.event).toBe('connect_error')
        expect(anahtarSeti(body.payload)).toEqual(['code', 'message'])
        expect(typeof body.payload.code).toBe('number')
        expect(typeof body.payload.message).toBe('string')
    })

    it('connect() onay ekranindan gecen basarili govde AYNI device semasini tasir (uc SITENIN tek kaynagi paylastigini kanitlar)', async () => {
        const chrome = kurChrome({
            current_request: { type: 'TON_CONNECT', id: 'req-ton-1', origin: 'https://app.dedust.io', hostname: 'app.dedust.io', manifest: MANIFEST, proofPayload: null, network: '-239' },
            active_account: ACCOUNT, vaults: [TON_VAULT], ton_dapps: {},
        })
        const gonderilen = []
        chrome.setSendMessage(async (msg) => {
            gonderilen.push(msg)
            if (msg.type === 'TON_CONNECT_IDENTITY') {
                return { success: true, address: TON_ADDRESS_RAW, publicKey: 'ab12cd34', walletStateInit: 'te6cckEBAQEAAgAAAEysuc0=' }
            }
            return {}
        })

        const app = createApp(TonConnectApprove)
        app.use(createTestPinia())
        app.use(createTestI18n())
        pageStore().currentPage = 'ton_connect'
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)
        await holder.instance.setupState.baglan()

        const ok = gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')
        const body = ok.data.result
        expect(anahtarSeti(body)).toEqual(['event', 'id', 'payload'])
        expect(anahtarSeti(body.payload)).toEqual(['device', 'items'])
        deviceSemasiniDogrula(body.payload.device)
    })

    it('connect() reddedilirse govde {event:connect_error, payload:{code:300,message}} semasindadir', async () => {
        const chrome = kurChrome({
            current_request: { type: 'TON_CONNECT', id: 'req-ton-2', origin: 'https://app.dedust.io', hostname: 'app.dedust.io', manifest: MANIFEST, proofPayload: null, network: '-239' },
            active_account: ACCOUNT, vaults: [TON_VAULT], ton_dapps: {},
        })
        const gonderilen = []
        chrome.setSendMessage(async (msg) => { gonderilen.push(msg); return {} })

        const app = createApp(TonConnectApprove)
        app.use(createTestPinia())
        app.use(createTestI18n())
        pageStore().currentPage = 'ton_connect'
        const holder = captureInstance(app, 'TonConnectApprove')
        await render(app)
        await holder.instance.setupState.reddet()

        const ok = gonderilen.find((m) => m.type === 'CONNECT_WALLET_SUCCESS')
        const body = ok.data.result
        expect(anahtarSeti(body)).toEqual(['event', 'id', 'payload'])
        expect(body.event).toBe('connect_error')
        expect(anahtarSeti(body.payload)).toEqual(['code', 'message'])
        expect(body.payload.code).toBe(300)
    })
})

describe('SendTransaction -- dapp in send() dan aldigi govde', () => {
    const SESSION = { address: TON_ADDRESS_RAW, publicKey: 'ab12cd34', accountKey: 'acc-1', chain: '-239', manifest: MANIFEST, connectedAt: 1 }
    const istekGovdesi = () => ({ valid_until: Math.floor(Date.now() / 1000) + 300, messages: [{ address: TON_ADDRESS_RAW, amount: '1000000000' }] })

    it('basarili: handleTonSend -> TonSendTx.vue -> resolvePendingRequest UCTAN UCA, govde tam olarak {result,id}', async () => {
        const chrome = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION }, vaults: [TON_VAULT] })
        const { handleTonSend } = await import('./utils/tonDappFunctions.js')
        const { resolvePendingRequest } = await import('./utils/dappFunctions.js')

        const yanitlar = []
        await handleTonSend({ params: [{ method: 'sendTransaction', params: [JSON.stringify(istekGovdesi())], id: 'app-7' }] }, SENDER, (r) => yanitlar.push(r))
        expect(chrome.acilanPencereler.length).toBe(1)

        chrome.setSendMessage(async (msg) => {
            if (msg.type === 'TON_DAPP_SEND') return { success: true, boc: 'te6ccgEBAQ' }
            // background.js'in GERCEK yonlendirmesi (SEND_TX_SUCCESS -> resolvePendingRequest):
            // bkz. background.js'teki mesaj tipi listesi.
            if (msg.type === 'SEND_TX_SUCCESS') { await resolvePendingRequest(msg); return {} }
            return {}
        })

        const app = createApp(TonSendTx)
        app.use(createTestPinia())
        app.use(createTestI18n())
        pageStore().currentPage = 'ton_send_tx'
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        await holder.instance.setupState.onayla()

        expect(yanitlar.length).toBe(1)
        const body = yanitlar[0].result
        // Dapp BOC bekler, islem hash i DEGIL (tasarim belgesi SS3.1) -- burada
        // anahtar kumesi VE tip kontrolu bunu semaya baglar.
        expect(anahtarSeti(body)).toEqual(['id', 'result'])
        expect(typeof body.result).toBe('string')
        expect(typeof body.id).toBe('string')
        expect(body.id).toBe('app-7')
    })

    it('reddedilirse govde tam olarak {error:{code,message}, id}, kod 300', async () => {
        const chrome = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION }, vaults: [TON_VAULT] })
        const { handleTonSend } = await import('./utils/tonDappFunctions.js')
        const { resolvePendingRequest } = await import('./utils/dappFunctions.js')

        const yanitlar = []
        await handleTonSend({ params: [{ method: 'sendTransaction', params: [JSON.stringify(istekGovdesi())], id: 'app-8' }] }, SENDER, (r) => yanitlar.push(r))

        chrome.setSendMessage(async (msg) => {
            if (msg.type === 'SEND_TX_SUCCESS') { await resolvePendingRequest(msg); return {} }
            return {}
        })

        const app = createApp(TonSendTx)
        app.use(createTestPinia())
        app.use(createTestI18n())
        pageStore().currentPage = 'ton_send_tx'
        const holder = captureInstance(app, 'TonSendTx')
        await render(app)
        await holder.instance.setupState.reddet()

        const body = yanitlar[0].result
        expect(anahtarSeti(body)).toEqual(['error', 'id'])
        expect(anahtarSeti(body.error)).toEqual(['code', 'message'])
        expect(body.error.code).toBe(300)
        expect(body.id).toBe('app-8')
    })
})

describe('SignData -- dapp in signData() dan aldigi govde', () => {
    const SESSION = { address: TON_ADDRESS_RAW, publicKey: 'ab12cd34', accountKey: 'acc-1', chain: '-239', manifest: MANIFEST, connectedAt: 1 }

    it('basarili: ekran -> resolvePendingRequest UCTAN UCA, domain DUZ DIZE gelir (K2)', async () => {
        const chrome = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION }, active_account: ACCOUNT, vaults: [TON_VAULT] })
        const { handleTonSend } = await import('./utils/tonDappFunctions.js')
        const { resolvePendingRequest } = await import('./utils/dappFunctions.js')

        const yanitlar = []
        await handleTonSend({ params: [{ method: 'signData', params: [{ type: 'text', text: 'Merhaba dunya' }], id: 'app-9' }] }, SENDER, (r) => yanitlar.push(r))
        expect(chrome.acilanPencereler.length).toBe(1)

        chrome.setSendMessage(async (msg) => {
            if (msg.type === 'TON_DAPP_SIGN') return { success: true, signature: 'c2ln', timestamp: 1756000000 }
            if (msg.type === 'SIGN_MESSAGE_SUCCESS') { await resolvePendingRequest(msg); return {} }
            return {}
        })

        const app = createApp(TonSignData)
        app.use(createTestPinia())
        app.use(createTestI18n())
        pageStore().currentPage = 'ton_sign_data'
        const holder = captureInstance(app, 'TonSignData')
        await render(app)
        await holder.instance.setupState.onayla()

        expect(yanitlar.length).toBe(1)
        const body = yanitlar[0].result
        expect(anahtarSeti(body)).toEqual(['id', 'result'])
        expect(body.id).toBe('app-9')

        const r = body.result
        expect(anahtarSeti(r)).toEqual(['address', 'domain', 'payload', 'signature', 'timestamp'])
        // K2'NIN TAM KENDISI: domain DUZ BIR DIZE olmali. { lengthBytes, value }
        // sekli ton_proof'a (TonConnectApprove.vue) ait, SignDataResult'a DEGIL --
        // bu sema kontrolu tam bu ikisinin karistirilmasini yakalar.
        expect(typeof r.domain).toBe('string')
        expect(r.domain).toBe('app.dedust.io')
        expect(typeof r.signature).toBe('string')
        expect(typeof r.address).toBe('string')
        expect(typeof r.timestamp).toBe('number')
        expect(anahtarSeti(r.payload)).toEqual(['text', 'type'])
    })

    it('reddedilirse govde tam olarak {error:{code,message}, id}, kod 300', async () => {
        const chrome = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION }, active_account: ACCOUNT, vaults: [TON_VAULT] })
        const { handleTonSend } = await import('./utils/tonDappFunctions.js')
        const { resolvePendingRequest } = await import('./utils/dappFunctions.js')

        const yanitlar = []
        await handleTonSend({ params: [{ method: 'signData', params: [{ type: 'text', text: 'Merhaba' }], id: 'app-10' }] }, SENDER, (r) => yanitlar.push(r))

        chrome.setSendMessage(async (msg) => {
            if (msg.type === 'SIGN_MESSAGE_SUCCESS') { await resolvePendingRequest(msg); return {} }
            return {}
        })

        const app = createApp(TonSignData)
        app.use(createTestPinia())
        app.use(createTestI18n())
        pageStore().currentPage = 'ton_sign_data'
        const holder = captureInstance(app, 'TonSignData')
        await render(app)
        await holder.instance.setupState.reddet()

        const body = yanitlar[0].result
        expect(anahtarSeti(body)).toEqual(['error', 'id'])
        expect(body.error.code).toBe(300)
        expect(body.id).toBe('app-10')
    })
})

describe('disconnect', () => {
    it('dapp baslatilan disconnect (send metodu) govdesi tam olarak {result:{}, id}', async () => {
        kurChrome({ ton_dapps: { 'app.dedust.io': { address: TON_ADDRESS_RAW, accountKey: 'acc-1' } } })
        const { handleTonSend } = await import('./utils/tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend({ params: [{ method: 'disconnect', params: [], id: 'app-99' }] }, SENDER, (r) => yanitlar.push(r))

        const body = yanitlar[0].result
        expect(anahtarSeti(body)).toEqual(['id', 'result'])
        expect(anahtarSeti(body.result)).toEqual([])
        expect(body.id).toBe('app-99')
    })

    // Cuzdan-baslatilan disconnect bir YANIT DEGIL, bir OLAYDIR (id TASIMAZ) --
    // tonDappFunctions.js'teki notifyTonDapp'in basindaki AYNI ayrim. Govde
    // once GERCEK notifyTonDapp ile kurulur, sonra tonInjected.js'in GERCEK
    // listen() mekanizmasindan gecirilir: content.js'in ilettigi olay nesnesi
    // dapp'in kaydettigi callback'e DEGISMEDEN ulasmali.
    it('cuzdan baslatilan disconnect OLAYI dapp in listen() ile aldigi govde: {event,id,payload}, DEGISMEDEN', async () => {
        kurChrome({})
        const gonderilenSekmeler = []
        globalThis.chrome.tabs.sendMessage = async (tabId, msg) => { gonderilenSekmeler.push({ tabId, msg }) }

        const { notifyTonDapp } = await import('./utils/tonDappFunctions.js')
        await notifyTonDapp('app.dedust.io', { event: 'disconnect', id: 123, payload: {} })

        expect(gonderilenSekmeler.length).toBe(1)
        const gonderilenOlay = gonderilenSekmeler[0].msg.event
        expect(anahtarSeti(gonderilenOlay)).toEqual(['event', 'id', 'payload'])
        expect(gonderilenOlay.event).toBe('disconnect')
        expect(typeof gonderilenOlay.id).toBe('number')
        expect(anahtarSeti(gonderilenOlay.payload)).toEqual([])

        const win = kurWindow()
        await import('./tonInjected.js')
        const alinanlar = []
        globalThis.window.wats.tonconnect.listen((e) => alinanlar.push(e))
        for (const fn of win.dinleyiciler) {
            fn({ source: globalThis.window, data: { target: 'wats_ton_inpage', hostname: 'app.dedust.io', event: gonderilenOlay } })
        }
        expect(alinanlar).toEqual([gonderilenOlay])
    })
})

// K3 UCTAN UCA: bu blok tek basina inceleme bulgusunun UCUNU (K1 device'i
// TASIYAN bir ConnectEvent, K3'un dogru kod eslemesi) ZINCIRLEME dogrular --
// arka planin GERCEK pencere-kapanma dinleyicisinden (dappFunctions.js) baslar,
// tonInjected.js'in GERCEK tasima-hatasi bicimlendirmesinden gecer.
describe('K3 uctan uca: onay penceresi kapanirsa dapp connect_error kod 300 gorur, 0 DEGIL', () => {
    it('handleTonConnect ile acilan pencere KAPANINCA (kullanici X e basar), dapp a ulasan govde kod 300 tasir', async () => {
        const chrome = kurChrome({ active_account: ACCOUNT, vaults: [TON_VAULT] })
        vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ url: 'https://app.dedust.io', name: 'DeDust', iconUrl: null }) }))
        const { handleTonConnect } = await import('./utils/tonDappFunctions.js')

        const yanitlar = []
        await handleTonConnect({ params: [{ manifestUrl: 'https://app.dedust.io/m.json', items: [{ name: 'ton_addr' }] }] }, SENDER, (r) => yanitlar.push(r))
        expect(chrome.acilanPencereler.length).toBe(1)
        expect(yanitlar.length).toBe(0)

        // Kullanici pencereyi KAPATIR -- dappFunctions.js'in GERCEK
        // chrome.windows.onRemoved dinleyicisi bunu yakalar ve 4001 gonderir.
        chrome.pencereyiKapat(1)
        expect(yanitlar.length).toBe(1)
        expect(yanitlar[0].error.code).toBe(4001)

        // Bu {error:{code:4001}} govdesi content.js'ten tonInjected.js'e AYNI
        // sekilde ulasir (bkz. tonInjected.js'teki tasimaHatasiniBicimlendir
        // basindaki not: content.js'in 4200 engeli, lastError dali VE arka
        // planin dondugu response.error AYNI govde seklini paylasir).
        // tonInjected.js'i GERCEKTEN calistirip bu govdeyi oradan GECIRMEK,
        // K3 duzeltmesinin (4001 -> 300) dapp'e GERCEKTEN ulastigini kanitlar.
        const win = kurWindow()
        await import('./tonInjected.js')
        const p = globalThis.window.wats.tonconnect.restoreConnection()
        const gonderi = win.gonderilen[0]
        for (const fn of win.dinleyiciler) {
            fn({ source: globalThis.window, data: { target: 'wats_ton_inpage', id: gonderi.id, error: yanitlar[0].error } })
        }
        const dappGovdesi = await p

        expect(anahtarSeti(dappGovdesi)).toEqual(['event', 'id', 'payload'])
        expect(dappGovdesi.event).toBe('connect_error')
        expect(anahtarSeti(dappGovdesi.payload)).toEqual(['code', 'message'])
        expect(dappGovdesi.payload.code).toBe(300)
    })
})

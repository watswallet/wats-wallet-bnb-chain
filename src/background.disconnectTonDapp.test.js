import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * DISCONNECT_TON_DAPP (background.js) - dogrudan testler (Gorev 14, fix round 1).
 *
 * KOK NEDEN (inceleme bulgusu): Dapps.tonSessions.ssr.test.js `sendMessage`i
 * TAKLIT EDIYOR -- bilesenin DOGRU mesaji YOLLADIGINI kanitliyor, ama arka
 * plandaki isleyicinin GERCEKTEN storage'dan silip notifyTonDapp'i cagirdigini
 * HICBIR test kanitlamiyordu. Silme TEK yerde (arka planda) yapildigi icin
 * (bilesen yalniz listeyi tazeler, kendisi silmez) bu isleyici TEK silme
 * noktasidir -- yanlis bir storage anahtari, atlanmis bir `await`, ya da
 * unutulmus bir notifyTonDapp cagrisi bu diff'teki HICBIR testi kirmazdi.
 *
 * background.js bir service worker GIRIS dosyasi: hicbir sey disari vermiyor
 * ve modul kapsaminda chrome.* dinleyicileri kaydediyor. Tek ulasma yolu,
 * chrome API'sini taklit edip modulu import etmek ve kaydettigi onMessage
 * dinleyicisini yakalamak. Harness background.evmGates.test.js /
 * background.tonDappSend.test.js'ten alindi.
 */

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'

let messageListener
let localStore
let sentTabMessages

const SESSION_A = {
    address: '0:1111111111111111111111111111111111111111111111111111111111111111',
    publicKey: 'ab12', accountKey: 'acc-1', chain: '-239',
    manifest: { name: 'DeDust', url: 'https://app.dedust.io', iconUrl: null, manifestUrl: 'https://app.dedust.io/m.json', sameOrigin: true },
    connectedAt: 1756000000,
}
const SESSION_B = {
    address: '0:2222222222222222222222222222222222222222222222222222222222222222',
    publicKey: 'cd34', accountKey: 'acc-2', chain: '-239',
    manifest: { name: 'STON.fi', url: 'https://ston.fi', iconUrl: null, manifestUrl: 'https://ston.fi/m.json', sameOrigin: true },
    connectedAt: 1756000001,
}

function installChromeStub() {
    const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })

    const setSpy = vi.fn(async (obj) => { Object.assign(localStore, obj) })
    sentTabMessages = []

    globalThis.chrome = {
        alarms: { create: vi.fn(), onAlarm: add('onAlarm') },
        runtime: {
            getURL: () => EXTENSION_ORIGIN,
            onConnect: add('onConnect'),
            onStartup: add('onStartup'),
            onInstalled: add('onInstalled'),
            onMessage: add('onMessage'),
            sendMessage: vi.fn(() => Promise.resolve()),
            lastError: null,
        },
        storage: {
            local: {
                get: vi.fn(async (keys) => {
                    const wanted = keys === undefined ? Object.keys(localStore)
                        : (Array.isArray(keys) ? keys : [keys])
                    return Object.fromEntries(wanted.map(k => [k, localStore[k]]))
                }),
                set: setSpy,
                remove: vi.fn(async () => {}),
            },
            session: {
                get: vi.fn(async () => ({ sessionMasterKeyJwk: { kty: 'oct', k: 'x' } })),
                set: vi.fn(async () => {}),
                remove: vi.fn(async () => {}),
            },
        },
        tabs: {
            // Gorev 14 duzeltmesinden SONRA notifyTonDapp TUM sekmelere yollar
            // (tab.url ile suzmez) -- tek bir sekme yeterli, id'si olmasi yeter.
            query: vi.fn(async () => [{ id: 7, url: 'https://herhangi-bir-sekme.example/' }]),
            sendMessage: vi.fn((tabId, msg) => { sentTabMessages.push({ tabId, msg }); return Promise.resolve() }),
            create: vi.fn(),
        },
        windows: { create: vi.fn(), onRemoved: add('onConnect'), remove: vi.fn() },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    }
    return { listeners, setSpy }
}

function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
    return new Promise((resolve) => {
        const returned = messageListener(message, sender, resolve)
        if (returned !== true) resolve(undefined)
    })
}

let setSpy

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    localStore = { ton_dapps: { 'app.dedust.io': SESSION_A, 'ston.fi': SESSION_B } }
    const stub = installChromeStub()
    setSpy = stub.setSpy
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = stub.listeners.onMessage[0]
})

describe('DISCONNECT_TON_DAPP', () => {
    it('hedef hostname i ton_dapps depodan SILER', async () => {
        const res = await callHandler({ type: 'DISCONNECT_TON_DAPP', hostname: 'app.dedust.io' })

        expect(res.success).toBe(true)
        expect(localStore.ton_dapps['app.dedust.io']).toBeUndefined()
    })

    it('notifyTonDapp DOGRU hostname ve disconnect olayiyla cagrilir', async () => {
        await callHandler({ type: 'DISCONNECT_TON_DAPP', hostname: 'app.dedust.io' })

        expect(sentTabMessages.length).toBeGreaterThan(0)
        const msg = sentTabMessages[0].msg
        expect(msg.target).toBe('wats_ton_inpage')
        expect(msg.hostname).toBe('app.dedust.io')
        expect(msg.event.event).toBe('disconnect')
    })

    // TEK bir hostname'in kesilmesi BASKA origin'lerin oturumlarina DOKUNMAMALI --
    // yanlis bir storage anahtari (or. TUM ton_dapps'i sifirlamak) burada
    // yakalanirdi.
    it('BASKA origin lerin oturumlarina DOKUNMAZ', async () => {
        await callHandler({ type: 'DISCONNECT_TON_DAPP', hostname: 'app.dedust.io' })

        expect(localStore.ton_dapps['ston.fi']).toEqual(SESSION_B)
    })

    // OKU-DEGISTIR-YAZ yalnizca SILINECEK bir oturum GERCEKTEN VARSA yapilir
    // (bkz. background.js'teki gerekce: kayip-guncelleme yarisini onlemek icin).
    // Var olmayan bir hostname icin cagrilmasi ne FIRLAMALI ne de storage'a
    // gereksiz bir yazim yapmali.
    it('oturumu OLMAYAN bir hostname icin cagrilirsa FIRLAMAZ ve ton_dapps a YAZMAZ', async () => {
        const res = await callHandler({ type: 'DISCONNECT_TON_DAPP', hostname: 'hic-baglanmamis.io' })

        expect(res.success).toBe(true)
        const tonDappsYazimlari = setSpy.mock.calls.filter((call) => 'ton_dapps' in (call[0] || {}))
        expect(tonDappsYazimlari).toEqual([])
        // Var olan oturumlar da DEGISMEDEN kalir.
        expect(localStore.ton_dapps).toEqual({ 'app.dedust.io': SESSION_A, 'ston.fi': SESSION_B })
    })

    // Var olmayan bir hostname icin bile bildirim ZARARSIZ (idempotent) --
    // dapp zaten baglanti gormuyordur, ama isleyici bunun icin ozel bir dal
    // ACMAZ (basitlik). Bu test o davranisi kayit altina alir.
    it('oturumu OLMAYAN bir hostname icin de notifyTonDapp yine cagrilir (idempotent)', async () => {
        await callHandler({ type: 'DISCONNECT_TON_DAPP', hostname: 'hic-baglanmamis.io' })

        expect(sentTabMessages.some((m) => m.msg.hostname === 'hic-baglanmamis.io')).toBe(true)
    })

    // Cuzdan ARAYUZU DISINDAN (sayfadan) gelirse messageGate reddetmeli --
    // DISCONNECT_TON_DAPP INTERNAL_ACTIONS'ta, keyfi bir hostname alip BASKA
    // origin'lerin oturumunu silebiliyor.
    it('sayfa kokenli sender ile cagrilirsa REDDEDILIR, silme YAPILMAZ', async () => {
        const res = await callHandler(
            { type: 'DISCONNECT_TON_DAPP', hostname: 'app.dedust.io' },
            { url: 'https://evil.example/', tab: { id: 99 } }
        )

        expect(localStore.ton_dapps['app.dedust.io']).toEqual(SESSION_A)
        expect(res?.success).not.toBe(true)
    })
})

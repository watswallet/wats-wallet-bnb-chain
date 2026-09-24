import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'

let connectListener
let localStore
let sessionStore

function installChromeStub() {
    const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })

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
                    const wanted = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(wanted.map(k => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async () => {}),
            },
            session: {
                get: vi.fn(async () => sessionStore),
                set: vi.fn(async (obj) => { Object.assign(sessionStore, obj) }),
                remove: vi.fn(async (k) => { delete sessionStore[k] }),
            },
        },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}), create: vi.fn() },
        windows: {
            create: vi.fn(async () => ({ id: 1 })),
            getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
            get: vi.fn(async () => ({ id: 1 })),
            getCurrent: vi.fn(async () => ({ id: 1 })),
            onRemoved: { addListener: vi.fn() },
            remove: vi.fn(),
        },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setPopup: vi.fn(async () => {}) },
    }
    return listeners
}

// `sender` de tasinir: kayit defterine giris ARTIK ada VE kokene bakiyor.
// Varsayilan, uzantinin kendi sayfasindan gelen mesru bir arayuz portudur.
function makePort(name, sender = { url: EXTENSION_ORIGIN + 'index.html' }) {
    const dcs = []
    return {
        name,
        sender,
        onDisconnect: { addListener: (fn) => dcs.push(fn) },
        disconnect: () => dcs.forEach((fn) => fn()),
    }
}

// Kayit defterinin bekleme penceresi + lockWallet'in await zinciri:
// sahte zamanlayiciyi ilerlettikten sonra mikro-gorevleri bosaltmak gerekir.
const bosalt = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = { session_active: true, lock_timer: 0, vaults: [], dapps: {} }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    connectListener = listeners.onConnect[0]
})

afterEach(() => {
    vi.useRealTimers()
    delete globalThis.chrome
})

// SW ACILIS KONTROLU -- "Hemen" kilidinin YEDEGI.
//
// `onDisconnect` yalnizca SW YASIYORSA calisir. Senaryo: cuzdan kilitsiz, panel
// acik; SW 30 sn atalette olur (T) ve port kopar, arayuz T+250 ms icin yeniden
// baglanma planlar. Kullanici T+100 ms'de paneli KAPATIR -- belge yok olur,
// zamanlayici da onunla. SW olu oldugu icin `onDisconnect` HIC calismamistir:
// `session_active` true ve `sessionMasterKeyJwk` yerinde kalir, yani cuzdan
// SURESIZ kilitsizdir. Ayni bosluk uzanti guncellemesinde / runtime.reload()'ta
// da acilir. Acilis kontrolu bu boslugu kapatir: kayit defteri BOS dogar,
// gercekten acik bir arayuz varsa bekleme icinde baglanir ve karar duser.
describe('background -- SW acilis kontrolu ("Hemen" yedegi)', () => {
    it('hic port baglanmadan bekleme dolunca kilitler', async () => {
        vi.advanceTimersByTime(2999)
        await bosalt()
        expect(localStore.session_active).toBe(true)

        vi.advanceTimersByTime(1)
        await bosalt()
        expect(localStore.session_active).toBe(false)
        expect(sessionStore.sessionMasterKeyJwk).toBeUndefined()
    })

    it('bekleme icinde bir arayuz baglanirsa KILITLEMEZ', async () => {
        vi.advanceTimersByTime(1500)
        connectListener(makePort('wats_ui:a'))

        vi.advanceTimersByTime(10000)
        await bosalt()
        expect(localStore.session_active).toBe(true)
        expect(sessionStore.sessionMasterKeyJwk).toBeDefined()
    })

    it('lock_timer "Hemen" DEGILSE acilis kontrolu kilitlemez', async () => {
        localStore.lock_timer = 5

        vi.advanceTimersByTime(10000)
        await bosalt()
        expect(localStore.session_active).toBe(true)
    })

    it('oturum zaten kapaliysa acilis kontrolu kilit cagirmaz', async () => {
        localStore.session_active = false

        vi.advanceTimersByTime(10000)
        await bosalt()
        expect(sessionStore.sessionMasterKeyJwk).toBeDefined()
    })
})

describe('background -- arayuz kayit defteri ("Hemen" kilidi)', () => {
    it('son arayuz kapanip bekleme dolunca kilitler', async () => {
        const p = makePort('wats_ui:a')
        connectListener(p)
        p.disconnect()

        vi.advanceTimersByTime(2999)
        await bosalt()
        expect(localStore.session_active).toBe(true)

        vi.advanceTimersByTime(1)
        await bosalt()
        expect(localStore.session_active).toBe(false)
        expect(sessionStore.sessionMasterKeyJwk).toBeUndefined()
    })

    it('iki arayuzden biri kapaninca KILITLEMEZ', async () => {
        const a = makePort('wats_ui:a')
        const b = makePort('wats_ui:b')
        connectListener(a)
        connectListener(b)

        a.disconnect()
        vi.advanceTimersByTime(10000)
        await bosalt()
        expect(localStore.session_active).toBe(true)
    })

    it('bekleme icinde yeniden baglanan arayuz kilidi IPTAL eder', async () => {
        const a = makePort('wats_ui:a')
        connectListener(a)
        a.disconnect()

        vi.advanceTimersByTime(1500)
        connectListener(makePort('wats_ui:b'))
        vi.advanceTimersByTime(10000)
        await bosalt()
        expect(localStore.session_active).toBe(true)
    })

    it('lock_timer "Hemen" DEGILSE port kopmasi kilit uretmez', async () => {
        localStore.lock_timer = 5
        const p = makePort('wats_ui:a')
        connectListener(p)
        p.disconnect()

        vi.advanceTimersByTime(10000)
        await bosalt()
        expect(localStore.session_active).toBe(true)
    })

    it('oturum zaten kapaliysa kilit cagrilmaz', async () => {
        localStore.session_active = false
        const p = makePort('wats_ui:a')
        connectListener(p)
        p.disconnect()

        vi.advanceTimersByTime(10000)
        await bosalt()
        expect(sessionStore.sessionMasterKeyJwk).toBeDefined()
    })

    // Asagidaki iki test AYNI kalibi kullanir: once MESRU bir port baglanir
    // (bu, acilis kontrolunu iptal eder), sonra reddedilmesi gereken port
    // baglanir, sonra mesru port kapanir. Reddedilen port kumeye GIRMIS OLSAYDI
    // kume bosalmaz ve kilit HIC gelmezdi -- yani `session_active === false`
    // beklentisi tam olarak "o port sayilmadi" demektir.
    it('yabanci port ADI kayit defterine girmez', async () => {
        const yerli = makePort('wats_ui:a')
        connectListener(yerli)
        connectListener(makePort('cs'))

        yerli.disconnect()
        vi.advanceTimersByTime(3000)
        await bosalt()
        expect(localStore.session_active).toBe(false)
    })

    // I7: port ADI baglanan tarafin sectigi bir dizgedir. Mesaj dagiticisi
    // kokeni `isWalletUiMessage(sender)` ile kontrol ediyor; kayit defteri
    // artik "Hemen" kilidinin TEK sinyali oldugu icin AYNI siniri kullanmali.
    it('yabanci GONDERICILI port, adi dogru olsa bile kayit defterine girmez', async () => {
        const yerli = makePort('wats_ui:a')
        connectListener(yerli)
        connectListener(makePort('wats_ui:sahte', { url: 'https://kotu.example/x', tab: { id: 7 } }))

        yerli.disconnect()
        vi.advanceTimersByTime(3000)
        await bosalt()
        expect(localStore.session_active).toBe(false)
    })

    it('uzanti kokenli gondericili port SAYILIR', async () => {
        const a = makePort('wats_ui:a', { url: EXTENSION_ORIGIN + 'popup.html' })
        const b = makePort('wats_ui:b', { url: EXTENSION_ORIGIN + 'onboarding.html' })
        connectListener(a)
        connectListener(b)

        a.disconnect()
        vi.advanceTimersByTime(10000)
        await bosalt()
        expect(localStore.session_active).toBe(true)
    })
})

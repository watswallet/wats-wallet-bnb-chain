import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ZAMAN ASIMI KILIDININ TELI: alarm kurulumu + alarm -> lockWallet.
//
// Iki ayri bosluk kapatiliyor:
//
// 1) ALARM HER SW DOGUSUNDA SIFIRLANIYORDU. `chrome.alarms.create` ayni adla
//    cagrildiginda mevcut alarmi iptal edip yerine yenisini kurar; ilk tetikleme
//    "simdi + 1 dakika"ya kayar. Bu satir modul ust seviyesinde, yani SW'nin HER
//    dogusunda calisiyor -- ve bu dalda arayuz kopmada yeniden baglaniyor
//    (utils/popupPort.js), `chrome.runtime.connect()` de SW'yi UYANDIRIYOR.
//    Sonuc: ~30 sn'lik atalet olumu + ~250 ms'lik yeniden baglanma dongusu
//    alarmi sonsuza dek 60 saniyeye geri sariyor, vade HIC dolmuyordu.
//
// 2) Alarm -> `shouldLock` -> `lockWallet` telinin HIC testi yoktu. Kurulum
//    duzeltilse bile bu telin kopmasi sessiz kalirdi.
//
// `alarms` stub'i BILEREK GERCEK bir alarm DEPOSU tasir: alarmlar Chrome'da
// yasar, service worker'da DEGIL -- yani SW yeniden dogdugunda depo AYNI kalir.
// `vi.resetModules()` + ikinci `import` tam olarak "SW ikinci kez dogdu"dur.

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const ALARM_NAME = 'checkInactivity'

let localStore
let sessionStore
let alarmStore
let alarmsGet
let alarmsCreate
let listeners

function installChromeStub() {
    listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })

    alarmsGet = vi.fn(async (name) => alarmStore[name])
    alarmsCreate = vi.fn((name, opts) => {
        alarmStore[name] = { name, periodInMinutes: opts?.periodInMinutes, scheduledTime: Date.now() + 60000 }
    })

    globalThis.chrome = {
        alarms: { get: alarmsGet, create: alarmsCreate, onAlarm: add('onAlarm') },
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
}

// Alarm kurulumu bir soz zinciri (`alarms.get(...).then(...)`); import donduginde
// henuz calismamis olabilir. lockWallet'in await zinciri icin de gerekir.
const bosalt = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    alarmStore = {}
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    // lock_timer 15: bu dosyanin ilgilendigi sey ZAMAN ASIMI kilidi. "Hemen" (0)
    // olsaydi kayit defterinin acilis kontrolu de tetiklenir ve olcum bulanirdi.
    localStore = { session_active: true, lock_timer: 15, lastActiveTime: Date.now(), vaults: [], dapps: {} }
    installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    await bosalt()
})

afterEach(() => {
    vi.useRealTimers()
    delete globalThis.chrome
})

describe('background -- ataletsizlik alarminin kurulumu', () => {
    it('alarm YOKSA kurulur', () => {
        expect(alarmsGet).toHaveBeenCalledWith(ALARM_NAME)
        expect(alarmsCreate).toHaveBeenCalledTimes(1)
        expect(alarmsCreate).toHaveBeenCalledWith(ALARM_NAME, { periodInMinutes: 1 })
    })

    it('ikinci SW dogusunda mevcut alarm YENIDEN KURULMAZ', async () => {
        // SW oldu, arayuz yeniden baglandi, SW yeniden dogdu. Alarm deposu
        // Chrome'da yasadigi icin AYNI kalir.
        vi.resetModules()
        await import('./background.js')
        await bosalt()

        expect(alarmsGet).toHaveBeenCalledTimes(2)
        // `create` IKINCI KEZ cagrilirsa vade "simdi + 1 dakika"ya kayar ve
        // yeniden baglanma dongusunde alarm HIC olgunlasmaz.
        expect(alarmsCreate).toHaveBeenCalledTimes(1)
        expect(alarmStore[ALARM_NAME].scheduledTime).toBeDefined()
    })

    it('ucuncu, dorduncu dogus da alarma dokunmaz', async () => {
        for (let i = 0; i < 3; i++) {
            vi.resetModules()
            await import('./background.js')
            await bosalt()
        }
        expect(alarmsCreate).toHaveBeenCalledTimes(1)
    })

    it('alarms.get tanimli olmayan bir ortamda modul PATLAMAZ', async () => {
        // Savunmaci `?.` zinciri: background.js'i import eden yedi arka plan
        // takiminin stub'inda `alarms.get` yok. Ciplak bir cagri modul
        // kapsaminda TypeError atip hepsini kirardi.
        delete globalThis.chrome.alarms.get
        vi.resetModules()
        await expect(import('./background.js')).resolves.toBeDefined()
    })
})

describe('background -- alarm vadesi dolunca kilitler', () => {
    const alarmiTetikle = async () => {
        const onAlarm = listeners.onAlarm[0]
        expect(onAlarm).toBeTypeOf('function')
        await onAlarm({ name: ALARM_NAME })
        await bosalt()
    }

    it('lock_timer=1 ve eski lastActiveTime ile oturum kapatilir', async () => {
        localStore.lock_timer = 1
        localStore.lastActiveTime = Date.now() - 5 * 60 * 1000

        await alarmiTetikle()

        expect(localStore.session_active).toBe(false)
        expect(sessionStore.sessionMasterKeyJwk).toBeUndefined()
    })

    it('sure DOLMADIYSA kilitlemez', async () => {
        localStore.lock_timer = 60
        localStore.lastActiveTime = Date.now() - 5 * 60 * 1000

        await alarmiTetikle()

        expect(localStore.session_active).toBe(true)
        expect(sessionStore.sessionMasterKeyJwk).toBeDefined()
    })

    it('"Asla" (-1) secildiyse kilitlemez', async () => {
        localStore.lock_timer = -1
        localStore.lastActiveTime = 1

        await alarmiTetikle()

        expect(localStore.session_active).toBe(true)
    })

    it('"Hemen" (0) alarmdan KILITLENMEZ -- karar kayit defterinindir', async () => {
        localStore.lock_timer = 0
        localStore.lastActiveTime = 1

        await alarmiTetikle()

        expect(localStore.session_active).toBe(true)
    })

    it('oturum zaten kapaliysa hicbir sey yapmaz', async () => {
        localStore.session_active = false
        localStore.lock_timer = 1
        localStore.lastActiveTime = 1

        await alarmiTetikle()

        expect(sessionStore.sessionMasterKeyJwk).toBeDefined()
    })

    it('baska adli bir alarm kilit karari uretmez', async () => {
        localStore.lock_timer = 1
        localStore.lastActiveTime = 1

        await listeners.onAlarm[0]({ name: 'baskaBirAlarm' })
        await bosalt()

        expect(localStore.session_active).toBe(true)
    })
})

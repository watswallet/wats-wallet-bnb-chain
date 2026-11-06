import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import axios from 'axios'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// GUNLUK PING + GIZLI MOD (gizli-mod cok-ag spec 4.7 satir 27; Dilim 0b'nin ertelenen karari 0b-M).
//
// Ping kapisi eskiden yalniz `active_account.private === true` bayragina bakiyordu. Arka plan artik karari KIMLIKLE
// verir (isPrivateIdentity: bayrak YA DA kasadaki Gizli Hesap kaydiyla ayni adres / key / turetme yolu) ve
// `runAnalyticsPing`e `privateMode` olarak iletir: bayragi dusmus eski bir Gizli Hesap kaydi da ping'i durdurur.
// Burada alarm tiki GERCEKTEN calistirilir (background.cowAlarm.test.js ile ayni kalip); ag `axios.post` casusuyla
// taklit edilir (axios GERCEK kalir: utils/bridge.js `axios.create` cagirir, tam mock modulu yuklenemez hale getirirdi).
let postMock

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const ALARM_NAME = 'checkInactivity'
const ID = '3f2b8c1e-5a7d-4e9a-8b6c-1d2e3f4a5b6c'
const GENEL = { key: 'acc1', address: '0xAbCdEf0000000000000000000000000000000001', type: 'hd', name: 'Hesap 1' }
const GIZLI = { key: 'private-0xcccccccc00000000000000000000000000000003', address: '0xCcccCccc00000000000000000000000000000003', type: 'hd', private: true, name: 'Gizli Hesap', derivationPath: "m/44'/60'/0'/1/0" }

let localStore
let listeners

function installChromeStub() {
    listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })
    globalThis.chrome = {
        alarms: { get: vi.fn(async () => ({ name: ALARM_NAME })), create: vi.fn(), onAlarm: add('onAlarm') },
        runtime: {
            getURL: () => EXTENSION_ORIGIN,
            getManifest: () => ({ version: '1.9.1' }),
            onConnect: add('onConnect'),
            onStartup: add('onStartup'),
            onInstalled: add('onInstalled'),
            onMessage: add('onMessage'),
            sendMessage: vi.fn(() => Promise.resolve()),
            lastError: null,
        },
        i18n: { getUILanguage: () => 'en' },
        storage: {
            local: {
                get: vi.fn(async (keys) => {
                    const wanted = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(wanted.map((k) => [k, structuredClone(localStore[k])]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, structuredClone(obj)) }),
                remove: vi.fn(async (k) => { for (const key of [].concat(k)) delete localStore[key] }),
            },
            session: {
                get: vi.fn(async () => ({})),
                set: vi.fn(async () => {}),
                remove: vi.fn(async () => {}),
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

const bosalt = async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }

// Ping dinleyicisi kilit dinleyicisinden SONRA kayitlidir: TUM onAlarm dinleyicileri cagrilir.
async function tikle() {
    expect(listeners.onAlarm.length).toBeGreaterThan(1)
    for (const fn of listeners.onAlarm) await fn({ name: ALARM_NAME })
    await bosalt()
}

async function dogur() {
    vi.resetModules()
    await import('./background.js')
    await bosalt()
}

const pingIstekleri = () => postMock.mock.calls.filter(([url]) => String(url).endsWith('/analytics/ping'))

beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    // Gizlilik ozelligi ACIK derleme: kapali derlemede arka plan acilista Gizli Hesap'i geri alir
    // (rollbackPrivateAccountOnStart) ve aktif hesap testin ortasinda degisirdi.
    vi.stubEnv('VITE_PRIVACY_ENABLED', 'true')
    localStore = { lock_timer: 15, lastActiveTime: Date.now(), vaults: [], dapps: {} }
    installChromeStub()
    postMock = vi.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: {} })
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(ID)
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    delete globalThis.chrome
})

describe('background -- gunluk ping gizli mod kapisi KIMLIKLE (0b-M)', () => {
    it('KONTROL: genel hesap aktif: alarm tiki /analytics/ping istegini TEK govdeyle atar', async () => {
        localStore.active_account = GENEL
        await dogur()

        await tikle()

        const istekler = pingIstekleri()
        expect(istekler).toHaveLength(1)
        expect(istekler[0][1]).toEqual({ installId: ID, version: '1.9.1', locale: 'en' })
        expect(localStore.analytics_state.installId).toBe(ID)
    })

    it('`private` bayragi OLAN Gizli Hesap aktif: istek yok, kimlik uretilmez', async () => {
        localStore.active_account = GIZLI
        await dogur()

        await tikle()

        expect(pingIstekleri()).toEqual([])
        expect(localStore.analytics_state).toBeUndefined()
    })

    it('bayragi DUSMUS eski Gizli Hesap kaydi (kasadaki kayitla ayni adres): istek yok, kimlik uretilmez', async () => {
        const bayraksiz = { ...GIZLI }
        delete bayraksiz.private
        localStore.vaults = [{ accounts: [GENEL], privateAccount: GIZLI }]
        localStore.active_account = bayraksiz
        await dogur()

        await tikle()

        expect(pingIstekleri()).toEqual([])
        expect(localStore.analytics_state).toBeUndefined()
    })

    it('bayragi dusmus kayit YALNIZ turetme yoluyla eslesirse de (adres farkli) Gizli sayilir', async () => {
        const bayraksiz = { key: 'baska-anahtar', address: '0x' + 'ab'.repeat(20), type: 'hd', derivationPath: GIZLI.derivationPath }
        localStore.vaults = [{ accounts: [GENEL], privateAccount: GIZLI }]
        localStore.active_account = bayraksiz
        await dogur()

        await tikle()

        expect(pingIstekleri()).toEqual([])
    })

    it('mod okunamazsa (depo hatasi) ping GITMEZ: fail-closed, alarm isleyicisi firlatmaz', async () => {
        localStore.active_account = GENEL
        await dogur()
        const gercekGet = globalThis.chrome.storage.local.get
        // Yalniz modun KENDI okumasi (active_account + vaults) basarisiz olur; ping modulunun kendi okumasi
        // (kasa anahtari tasimaz) calisir: test, fail-closed davranisini modul bayragindan AYRI olcer.
        globalThis.chrome.storage.local.get = vi.fn(async (keys) => {
            if (Array.isArray(keys) && keys.includes('vaults')) throw new Error('depo okunamadi')
            return gercekGet(keys)
        })

        await expect(tikle()).resolves.toBeUndefined()

        expect(pingIstekleri()).toEqual([])
    })

    it('mod her tikte OKUNUR: Gizli Hesap iken atlanan ping genel moda donunce SONRAKI tikte gider', async () => {
        localStore.active_account = GIZLI
        await dogur()

        await tikle()
        expect(pingIstekleri()).toEqual([])

        localStore.active_account = GENEL
        await tikle()

        expect(pingIstekleri()).toHaveLength(1)
    })
})

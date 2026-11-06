import { vi } from 'vitest'

// Arka plan (background.js) testleri icin ORTAK chrome stub'i + dagitici cagrisi.
// Gizli mod bayragi her boot'ta modul yeniden yuklenerek acilir/kapanir
// (featureFlags derleme zamani sabitidir; vi.stubEnv + vi.resetModules sart).
export const EXTENSION_ORIGIN = 'chrome-extension://test-id/'

// background.js modul yuklenirken GERCEK zamanlayicilar kurar (uiRegistry.bootCheck:
// 3 sn'lik kilit bekleme penceresi). Harness bunlarin SAHIBIDIR: import sirasinda
// kurulanlar kaydedilir ve teardown'da iptal edilir. Aksi halde teardown chrome'u
// silerken bekleyen zamanlayici sonradan atesler ("chrome is not defined") ya da
// SONRAKI testin chrome stub'ina dokunup cagri sayilarini bozar.
let moduleLoadTimers = []

function clearModuleLoadTimers() {
    for (const handle of moduleLoadTimers) clearTimeout(handle)
    moduleLoadTimers = []
}

// `storageLocalGet: false` chrome.storage.local.get'i HIC koymaz (kismen taklit edilmis chrome).
// `emitStorageChanges: true` chrome.storage.local.set/remove sonrasi gercek chrome gibi
// onChanged dinleyicilerini ({ [anahtar]: { oldValue, newValue } }, 'local') cagirir. VARSAYILAN
// KAPALI: yazimlari kendisi onChanged'e ceviren testler (privacyHeal) cift tetiklenmesin.
// Hesap degisiminin EVM yayini (WalletConnect 1.8.3 birlesmesi) YALNIZ onChanged'ten gittigi icin
// "PRIVACY_MODE_SET / acilis geri almasi sitelere accountsChanged ulastirir" testleri bunu acar.
export async function bootBackground({ privacyFlag = 'true', localStore = {}, sessionStore = {}, tabs = [{ id: 7 }], storageLocalGet = true, emitStorageChanges = false } = {}) {
    clearModuleLoadTimers()
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('VITE_PRIVACY_ENABLED', privacyFlag)

    const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [], onRemoved: [], onChanged: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })
    // chrome.storage gibi KOPYA doner: okunan nesneyi degistirmek depoyu degistirmez.
    const getFrom = (store) => vi.fn(async (keys) => {
        if (keys === undefined || keys === null) return structuredClone({ ...store })
        const wanted = Array.isArray(keys) ? keys : [keys]
        return structuredClone(Object.fromEntries(wanted.map((k) => [k, store[k]])))
    })

    // Gercek chrome gibi yazimdan SONRA, eszamansiz: dinleyiciler yazan cagrinin icinde calismaz.
    const emitChanged = (changes) => {
        if (!emitStorageChanges || Object.keys(changes).length === 0) return
        queueMicrotask(() => { for (const fn of listeners.onChanged) fn(changes, 'local') })
    }

    globalThis.chrome = {
        alarms: { create: vi.fn(), clear: vi.fn(async () => true), get: vi.fn(async () => null), onAlarm: add('onAlarm') },
        runtime: {
            getURL: () => EXTENSION_ORIGIN, onConnect: add('onConnect'), onStartup: add('onStartup'),
            onInstalled: add('onInstalled'), onMessage: add('onMessage'),
            sendMessage: vi.fn(() => Promise.resolve()), lastError: null,
        },
        storage: {
            local: {
                get: getFrom(localStore),
                set: vi.fn(async (obj) => {
                    const changes = {}
                    for (const k of Object.keys(obj)) changes[k] = { oldValue: structuredClone(localStore[k]), newValue: structuredClone(obj[k]) }
                    Object.assign(localStore, structuredClone(obj))
                    emitChanged(changes)
                }),
                remove: vi.fn(async (keys) => {
                    const changes = {}
                    for (const k of [].concat(keys)) { changes[k] = { oldValue: structuredClone(localStore[k]) }; delete localStore[k] }
                    emitChanged(changes)
                }),
            },
            session: {
                get: getFrom(sessionStore),
                set: vi.fn(async (obj) => { Object.assign(sessionStore, structuredClone(obj)) }),
                remove: vi.fn(async (keys) => { for (const k of [].concat(keys)) delete sessionStore[k] }),
            },
            onChanged: add('onChanged'),
        },
        tabs: { query: vi.fn(async () => tabs), sendMessage: vi.fn(async () => {}), create: vi.fn() },
        windows: {
            create: vi.fn(async () => ({ id: 1 })), getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
            get: vi.fn(async () => ({ id: 1 })), onRemoved: add('onRemoved'), remove: vi.fn(async () => {}),
        },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    }

    if (!storageLocalGet) delete globalThis.chrome.storage.local.get

    // Yalniz import suresince setTimeout'u sar: modul yukleme zamanlayicilari kaydedilir.
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = (...args) => {
        const handle = realSetTimeout(...args)
        moduleLoadTimers.push(handle)
        return handle
    }
    try {
        await import('../background.js')
    } finally {
        globalThis.setTimeout = realSetTimeout
    }
    const listener = listeners.onMessage[0]
    const call = (message, sender = { url: EXTENSION_ORIGIN }) => new Promise((resolve) => {
        const returned = listener(message, sender, resolve)
        if (returned !== true) resolve(undefined)
    })
    return { call, listeners, chrome: globalThis.chrome, localStore, sessionStore }
}

export function teardownBackground() {
    clearModuleLoadTimers()
    vi.unstubAllEnvs()
    delete globalThis.chrome
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'

let messageListener
let localStore

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
                get: vi.fn(async () => ({ sessionMasterKeyJwk: { kty: 'oct', k: 'x' } })),
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
    return listeners
}

// Dinleyiciyi cagir ve YANIT BEKLEME: olctugumuz sey damganin yazilip
// yazilmadigi, handler'in yaniti degil. SWAP_QUOTE/BRIDGE_QUOTE gercek
// handler'lari canli ag zincirine giriyor ve sendResponse hic gelmeyebilir.
function fire(message, sender = { url: EXTENSION_ORIGIN }) {
    messageListener(message, sender, () => {})
}

// refreshSession() dagiticida AWAIT EDILMEDEN cagriliyor (yuzen soz).
// Iddiadan once mikro-gorevleri bosalt.
const bosalt = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    localStore = {
        active_account: { key: 'k1', type: 'hd', index: 0, address: '0xabc' },
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: '0xabc' }] }],
        dapps: {},
        session_active: true,
    }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
})

afterEach(() => {
    delete globalThis.chrome
})

describe('background -- etkinlik damgasi yalniz gercek kullanici hareketinde tazelenir', () => {
    it('HEARTBEAT lastActiveTime yazar', async () => {
        delete localStore.lastActiveTime
        fire({ type: 'HEARTBEAT' })
        await bosalt()
        expect(typeof localStore.lastActiveTime).toBe('number')
    })

    // KAPATILAN ACIK: panelde saatlerce donen kotasyon dongusu artik
    // "kullanici basinda" anlamina GELMEZ.
    it('SWAP_QUOTE lastActiveTime YAZMAZ', async () => {
        delete localStore.lastActiveTime
        fire({ type: 'SWAP_QUOTE', message: {} })
        await bosalt()
        expect(localStore.lastActiveTime).toBeUndefined()
    })

    it('BRIDGE_QUOTE lastActiveTime YAZMAZ', async () => {
        delete localStore.lastActiveTime
        fire({ type: 'BRIDGE_QUOTE', message: {} })
        await bosalt()
        expect(localStore.lastActiveTime).toBeUndefined()
    })

    it('yoklama damgayi ESKI degerinde birakir (uzerine yazmaz)', async () => {
        localStore.lastActiveTime = 1000
        fire({ type: 'CHECK_TX_STATUS', message: {} })
        await bosalt()
        expect(localStore.lastActiveTime).toBe(1000)
    })

    it('dapp kokenli mesaj (sender.tab dolu) hicbir kosulda damga yazmaz', async () => {
        delete localStore.lastActiveTime
        fire({ type: 'HEARTBEAT' }, { url: 'https://evil.example', tab: { id: 7 } })
        await bosalt()
        expect(localStore.lastActiveTime).toBeUndefined()
    })
})

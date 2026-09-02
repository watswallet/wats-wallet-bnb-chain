import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Solana dapp case'lerinin BAGLANMASI.
 *
 * background.js bir service worker GIRIS dosyasi: hicbir sey disari vermiyor ve
 * modul kapsaminda chrome.* dinleyicileri kaydediyor. Bu yuzden dagiticiya tek
 * ulasma yolu, chrome API'sini taklit edip modulu import etmek ve kaydettigi
 * onMessage dinleyicisini yakalamak. Harness background.solanaSend.test.js'ten
 * BIREBIR alindi.
 */

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const PAGE_SENDER = { origin: 'https://app.jup.ag', url: 'https://app.jup.ag/swap', tab: { id: 3 } }
const UI_SENDER = { url: EXTENSION_ORIGIN + 'src/popup/index.html' }

let messageListener
let sessionStore
let localStore

const handleSolanaConnect = vi.fn()
const handleSolanaDisconnect = vi.fn()
const handleSolanaConnectIdentity = vi.fn()
const handleDisconnectSolanaDapp = vi.fn()
vi.mock('./utils/solanaDappFunctions', () => ({
    handleSolanaConnect: (...a) => handleSolanaConnect(...a),
    handleSolanaDisconnect: (...a) => handleSolanaDisconnect(...a),
    handleSolanaConnectIdentity: (...a) => handleSolanaConnectIdentity(...a),
    handleDisconnectSolanaDapp: (...a) => handleDisconnectSolanaDapp(...a),
}))

vi.mock('./utils/solana/derive', () => ({ deriveSolanaKeypair: vi.fn(), deriveSolanaAddress: vi.fn() }))
vi.mock('./utils/solana/send', () => ({ prepareTransferContext: vi.fn(), broadcastSignedTransaction: vi.fn() }))
vi.mock('./utils/crypto-utils', () => ({ unlockVault: vi.fn(), decryptSecret: vi.fn() }))
vi.mock('./utils/solana/client', () => ({
    solanaRpc: vi.fn(async () => ({ value: [null] })),
    SOLANA_API_BASE: 'https://api.test',
}))

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
                remove: vi.fn(async () => {}),
            },
        },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}), create: vi.fn() },
        windows: { create: vi.fn(), onRemoved: add('onConnect'), remove: vi.fn() },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    }
    return listeners
}

// Dagiticinin DONUS DEGERI olculur: `return true` olmadan Chrome mesaj portunu
// sendResponse cagrilmadan KAPATIR ve asenkron isleyicinin yaniti dapp'e hic
// ulasmaz -- promise sonsuza kadar askida kalir.
function dispatch(message, sender) {
    const yanitlar = []
    const returned = messageListener(message, sender, (r) => yanitlar.push(r))
    return { returned, yanitlar }
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: { key: 'k1', type: 'hd', index: 0, address: '0xabc' },
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: '0xabc' }] }],
        pending_transactions: [],
    }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
})

describe('Solana dapp metotlari sayfadan gecer ve isleyicisine iner', () => {
    it('solana_connect handleSolanaConnect e (message, sender, sendResponse) ile iner', () => {
        const message = { method: 'solana_connect', params: [{ silent: false }] }
        const { returned } = dispatch(message, PAGE_SENDER)
        expect(returned).toBe(true)
        expect(handleSolanaConnect).toHaveBeenCalledOnce()
        const [m, s, cb] = handleSolanaConnect.mock.calls[0]
        expect(m).toBe(message)
        expect(s).toBe(PAGE_SENDER)
        expect(typeof cb).toBe('function')
    })

    it('solana_disconnect handleSolanaDisconnect e iner', () => {
        const { returned } = dispatch({ method: 'solana_disconnect' }, PAGE_SENDER)
        expect(returned).toBe(true)
        expect(handleSolanaDisconnect).toHaveBeenCalledOnce()
        expect(handleSolanaDisconnect.mock.calls[0][1]).toBe(PAGE_SENDER)
    })
})

describe('Ic Solana aksiyonlari yalniz cuzdan arayuzunden', () => {
    it('SOLANA_CONNECT_IDENTITY arayuzden gecer', () => {
        // Yuk NESTED (`message: {...}`) -- deponun ic aksiyon sekli (Gorev 11).
        // Dagitici yalnizca `type`e bakar, ama sekli burada da dogru tutmak
        // isleyicinin sozlesmesini okuyan gelistiriciyi yaniltmaz.
        const { returned } = dispatch({ type: 'SOLANA_CONNECT_IDENTITY', message: { accountKey: 'k1' } }, UI_SENDER)
        expect(returned).toBe(true)
        expect(handleSolanaConnectIdentity).toHaveBeenCalledOnce()
    })

    it('DISCONNECT_SOLANA_DAPP arayuzden gecer', () => {
        const { returned } = dispatch({ type: 'DISCONNECT_SOLANA_DAPP', origin: 'https://app.jup.ag' }, UI_SENDER)
        expect(returned).toBe(true)
        expect(handleDisconnectSolanaDapp).toHaveBeenCalledOnce()
    })

    // Kapi switch'ten ONCE calisir: isleyici HIC cagrilmamali. Cagrilsaydi bir web
    // sayfasi gorunmeyen bir parola istemi tetikleyebilirdi.
    it('SOLANA_CONNECT_IDENTITY sayfadan gelirse FORBIDDEN_ORIGIN, isleyici cagrilmaz', () => {
        const { returned, yanitlar } = dispatch({ type: 'SOLANA_CONNECT_IDENTITY', message: { accountKey: 'k1' } }, PAGE_SENDER)
        expect(returned).toBe(false)
        expect(handleSolanaConnectIdentity).not.toHaveBeenCalled()
        expect(yanitlar[0]).toEqual({ error: 'FORBIDDEN_ORIGIN' })
    })

    // DISCONNECT_SOLANA_DAPP adi 'SOLANA_' ile BASLAMAZ: kapinin sekil secimi ada
    // bakiyor, bu yuzden reddi EIP-1193 seklinde (4100) doner. Ikisi ayni kapidan
    // gecer ama AYNI SEKILDE gorunmez -- bu fark bilerek kilitlenir.
    it('DISCONNECT_SOLANA_DAPP sayfadan gelirse 4100, isleyici cagrilmaz', () => {
        const { returned, yanitlar } = dispatch({ type: 'DISCONNECT_SOLANA_DAPP', origin: 'https://kurban.example' }, PAGE_SENDER)
        expect(returned).toBe(false)
        expect(handleDisconnectSolanaDapp).not.toHaveBeenCalled()
        expect(yanitlar[0]).toEqual({ error: { code: 4100, message: 'Unauthorized' } })
    })
})

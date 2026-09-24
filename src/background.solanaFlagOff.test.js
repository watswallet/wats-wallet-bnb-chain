import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * SOLANA_ENABLED KAPALIYKEN dagiticinin Solana aksiyonlarini REDDETTIGI.
 *
 * Bu kapi "arayuz zaten gostermiyor" ile YETINMEZ: arka plana mesaj arayuzden
 * DEGIL, acik bir sayfadan (content.js) ya da eski bir popup'tan da gelebilir.
 * Zincir kaydini listeden dusurmek (data/supportedChains) yalnizca EKRANLARI
 * kapatir -- isleyiciler oldugu yerde durur ve cagrilabilir kalirdi.
 *
 * Harness background.solanaDapp.test.js'ten alindi; TEK FARK: modul import
 * edilmeden ONCE bayrak 'false' yapilir (bayrak modul yuklenirken sabitlenir).
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
const handleSolanaSignMessage = vi.fn()
const handleSolanaSignIn = vi.fn()
const handleSolanaDappSignMessage = vi.fn()
const handleSolanaSignTransaction = vi.fn()
const handleSolanaSignAndSend = vi.fn()
const handleSolanaDappSignTx = vi.fn()
vi.mock('./utils/solanaDappFunctions', () => ({
    handleSolanaConnect: (...a) => handleSolanaConnect(...a),
    handleSolanaDisconnect: (...a) => handleSolanaDisconnect(...a),
    handleSolanaConnectIdentity: (...a) => handleSolanaConnectIdentity(...a),
    handleDisconnectSolanaDapp: (...a) => handleDisconnectSolanaDapp(...a),
    handleSolanaSignMessage: (...a) => handleSolanaSignMessage(...a),
    handleSolanaSignIn: (...a) => handleSolanaSignIn(...a),
    handleSolanaDappSignMessage: (...a) => handleSolanaDappSignMessage(...a),
    handleSolanaSignTransaction: (...a) => handleSolanaSignTransaction(...a),
    handleSolanaSignAndSend: (...a) => handleSolanaSignAndSend(...a),
    handleSolanaDappSignTx: (...a) => handleSolanaDappSignTx(...a),
    notifySolanaDapp: vi.fn(),
    disconnectOrphanedSolanaSessions: vi.fn(async () => {}),
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

function dispatch(message, sender) {
    const yanitlar = []
    const returned = messageListener(message, sender, (r) => yanitlar.push(r))
    return { returned, yanitlar }
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('VITE_SOLANA_ENABLED', 'false')
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

afterEach(() => { vi.unstubAllEnvs() })

// Sayfadan gelebilen Wallet Standard seridi.
const SAYFA_METOTLARI = [
    ['solana_connect', () => handleSolanaConnect],
    ['solana_disconnect', () => handleSolanaDisconnect],
    ['solana_signMessage', () => handleSolanaSignMessage],
    ['solana_signIn', () => handleSolanaSignIn],
    ['solana_signTransaction', () => handleSolanaSignTransaction],
    ['solana_signAndSendTransaction', () => handleSolanaSignAndSend],
]

// Yalnizca cuzdan arayuzunden gelebilen ic aksiyonlar (kasayi ACARLAR).
const IC_AKSIYONLAR = [
    ['SOLANA_CONNECT_IDENTITY', () => handleSolanaConnectIdentity],
    ['DISCONNECT_SOLANA_DAPP', () => handleDisconnectSolanaDapp],
    ['SOLANA_DAPP_SIGN_MESSAGE', () => handleSolanaDappSignMessage],
    ['SOLANA_DAPP_SIGN_TX', () => handleSolanaDappSignTx],
]

describe('bayrak kapaliyken sayfadan gelen Solana metotlari isleyiciye INMEZ', () => {
    for (const [metot, isleyici] of SAYFA_METOTLARI) {
        it(`${metot} reddedilir ve isleyicisi HIC cagrilmaz`, () => {
            const { yanitlar } = dispatch({ method: metot, params: [{}] }, PAGE_SENDER)
            expect(isleyici()).not.toHaveBeenCalled()
            expect(yanitlar).toHaveLength(1)
            expect(yanitlar[0]?.error).toBeTruthy()
        })
    }
})

describe('bayrak kapaliyken ic Solana aksiyonlari arayuzden de INMEZ', () => {
    for (const [aksiyon, isleyici] of IC_AKSIYONLAR) {
        it(`${aksiyon} reddedilir -- eski bir popup kasayi acamaz`, () => {
            const { yanitlar } = dispatch({ type: aksiyon, message: {} }, UI_SENDER)
            expect(isleyici()).not.toHaveBeenCalled()
            expect(yanitlar).toHaveLength(1)
            expect(yanitlar[0]?.error).toBeTruthy()
        })
    }

    it('SOLANA_GET_ADDRESS ve SOLANA_SEND de reddedilir -- turetme/gonderim yolu kapalidir', () => {
        for (const type of ['SOLANA_GET_ADDRESS', 'SOLANA_SEND']) {
            const { yanitlar } = dispatch({ type, message: {} }, UI_SENDER)
            expect(yanitlar[0]?.error, type).toBeTruthy()
        }
    })
})

describe('kapi YALNIZCA Solana aksiyonlarini keser', () => {
    it('EVM/TON aksiyonlari bayrak kapaliyken de gecmeye devam eder', () => {
        const { yanitlar } = dispatch({ type: 'GET_STATE', message: {} }, UI_SENDER)
        expect(yanitlar[0]?.error).not.toBe('SOLANA_DISABLED')
    })
})

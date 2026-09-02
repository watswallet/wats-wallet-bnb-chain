import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * SOLANA_GET_ADDRESS handler'i.
 *
 * background.js bir service worker GIRIS dosyasi: hicbir sey disari vermiyor ve
 * modul kapsaminda chrome.* dinleyicileri kaydediyor. Bu yuzden handler'a tek
 * ulasma yolu, chrome API'sini taklit edip modulu import etmek ve kaydettigi
 * onMessage dinleyicisini yakalamak.
 */

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const DERIVED = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk'
const DERIVED_PUBKEY = 'ee'.repeat(32)

let messageListener
let sessionStore
let localStore

const deriveSolanaAddress = vi.fn()
vi.mock('./utils/solana/derive', () => ({
    deriveSolanaAddress: (...a) => deriveSolanaAddress(...a)
}))

const unlockVault = vi.fn()
vi.mock('./utils/crypto-utils', () => ({
    unlockVault: (...a) => unlockVault(...a),
    decryptSecret: vi.fn(),
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

// Handler sendResponse'u ASENKRON cagiriyor (return true). Sozle sarmalanir.
function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
    return new Promise((resolve) => {
        const returned = messageListener(message, sender, resolve)
        if (returned !== true) resolve(undefined)
    })
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: { key: 'k1', type: 'hd', index: 0, address: '0xabc' },
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: '0xabc' }] }],
    }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
    unlockVault.mockResolvedValue('abandon abandon abandon about')
    deriveSolanaAddress.mockResolvedValue({ address: DERIVED, publicKey: DERIVED_PUBKEY })
})

describe('SOLANA_GET_ADDRESS', () => {
    it('adresi turetir ve hesap kaydina yazar', async () => {
        const res = await callHandler({ type: 'SOLANA_GET_ADDRESS' })

        expect(res).toEqual({ result: { address: DERIVED, publicKey: DERIVED_PUBKEY } })
        expect(localStore.active_account.solanaAddress).toBe(DERIVED)
        expect(localStore.active_account.solanaPublicKey).toBe(DERIVED_PUBKEY)
        expect(localStore.vaults[0].accounts[0].solanaAddress).toBe(DERIVED)
    })

    // EVM adresi Solana adresiyle EZILMEMELI: kod tabaninda address.toLowerCase()
    // ile eslesen onlarca cagri noktasi var ve base58 orada bozulur.
    it('account.address DOKUNULMADAN kalir', async () => {
        await callHandler({ type: 'SOLANA_GET_ADDRESS' })

        // Turetmenin GERCEKTEN calistigini once dogrula - aksi halde bu test
        // hicbir sey yapmayan (henuz implemente edilmemis) bir handler'a
        // karsi da GECERDI, cunku address zaten hic degismezdi.
        expect(localStore.active_account.solanaAddress).toBe(DERIVED)
        expect(localStore.active_account.address).toBe('0xabc')
    })

    // Kod incelemesinde yakalanan bug: vault-yazma eslestiricisi `!!` korumasi
    // OLMADAN `a.key === active_account.key` kullaniyordu. active_account.key
    // FALSY oldugunda bu "undefined === undefined" ile HER key'siz kaydi
    // eslestirip turetilen adresi ILGISIZ hesaplara da yaziyordu.
    it('birden fazla kasa ve hesap arasinda YALNIZCA hedef hesap guncellenir, digerleri ALAN BAZINDA da degismez', async () => {
        localStore.vaults = [
            { id: 'v1', type: 'mnemonic', accounts: [
                { key: 'k1', address: '0xabc', label: 'Ana Hesap' },
                { key: 'k3', address: '0xdead', label: 'Ikinci HD Hesap' },
            ] },
            { id: 'v2', type: 'privateKey', accounts: [
                { key: 'k4', address: '0xbeef', label: 'Ice Aktarilan' },
            ] },
        ]

        const res = await callHandler({ type: 'SOLANA_GET_ADDRESS' })

        expect(res).toEqual({ result: { address: DERIVED, publicKey: DERIVED_PUBKEY } })

        const [vault1, vault2] = localStore.vaults
        expect(vault1.accounts[0]).toEqual({
            key: 'k1', address: '0xabc', label: 'Ana Hesap',
            solanaAddress: DERIVED, solanaPublicKey: DERIVED_PUBKEY,
        })
        // Ayni kasadaki ILGISIZ hesap DEGISMEDEN kalir.
        expect(vault1.accounts[1]).toEqual({ key: 'k3', address: '0xdead', label: 'Ikinci HD Hesap' })
        // Baska bir kasadaki hesap da DEGISMEDEN kalir.
        expect(vault2.accounts[0]).toEqual({ key: 'k4', address: '0xbeef', label: 'Ice Aktarilan' })
    })

    // active_account.key eksikse (bozuk/eski veri) karar: key GUVENLI DEGILSE
    // (biri/ikisi de key'siz) adrese DUS - findVaultForAccount ile AYNI oncelik.
    // Boylece dogru kayit yine tek basina bulunur; "key'i olmayan HERHANGI bir
    // kayit" DEGIL.
    it('active_account key tasimiyorsa adrese GORE eslesen TEK kayit guncellenir', async () => {
        delete localStore.active_account.key
        localStore.vaults = [
            { id: 'v1', type: 'mnemonic', accounts: [
                { key: 'k1', address: '0xabc' },
                { address: '0xdead' }, // baska bir key'siz kayit - eslesMEMELI
            ] },
        ]

        const res = await callHandler({ type: 'SOLANA_GET_ADDRESS' })

        expect(res).toEqual({ result: { address: DERIVED, publicKey: DERIVED_PUBKEY } })
        expect(localStore.vaults[0].accounts[0].solanaAddress).toBe(DERIVED)
        expect(localStore.vaults[0].accounts[1].solanaAddress).toBeUndefined()
    })

    it('zaten turetilmisse yeniden turetmez', async () => {
        localStore.active_account.solanaAddress = DERIVED
        localStore.active_account.solanaPublicKey = DERIVED_PUBKEY

        const res = await callHandler({ type: 'SOLANA_GET_ADDRESS' })

        expect(res).toEqual({ result: { address: DERIVED, publicKey: DERIVED_PUBKEY } })
        expect(deriveSolanaAddress).not.toHaveBeenCalled()
        expect(unlockVault).not.toHaveBeenCalled()
    })

    // Kayitli adres ile turetilen adres ayrilirsa BASKA bir hesabin anahtari
    // kullaniliyordur; sessizce ustune yazmak kullaniciyi yanlis adrese baglar.
    it('kayitli adres turetilenden farkliysa DERIVED_ADDRESS_MISMATCH', async () => {
        localStore.active_account.solanaAddress = 'BaskaBirAdres11111111111111111111111111111'
        localStore.active_account.solanaPublicKey = null

        const res = await callHandler({ type: 'SOLANA_GET_ADDRESS' })

        expect(res.error).toBe('DERIVED_ADDRESS_MISMATCH')
        expect(localStore.active_account.solanaAddress).toBe('BaskaBirAdres11111111111111111111111111111')
    })

    it('ice aktarilmis hesap SOLANA_UNSUPPORTED_ACCOUNT ile reddedilir', async () => {
        localStore.active_account = { key: 'k2', type: 'imported', address: '0xdef' }

        const res = await callHandler({ type: 'SOLANA_GET_ADDRESS' })

        expect(res.error).toBe('SOLANA_UNSUPPORTED_ACCOUNT')
        expect(unlockVault).not.toHaveBeenCalled()
    })

    it('kasa kilitliyse WALLET_LOCKED — turetme HIC baslamaz', async () => {
        sessionStore = {}

        const res = await callHandler({ type: 'SOLANA_GET_ADDRESS' })

        expect(res.error).toBe('WALLET_LOCKED')
        expect(deriveSolanaAddress).not.toHaveBeenCalled()
    })

    // Uzanti disindan gelen mesaj kasa acmamali.
    it('uzanti disi kokenden gelen istek reddedilir', async () => {
        const res = await callHandler({ type: 'SOLANA_GET_ADDRESS' }, { url: 'https://kotu.example/' })

        // OZEL red kodu: FORBIDDEN_ORIGIN. Genel "Unknown message type" ile
        // KARISTIRILMAMALI, aksi halde bu test hic implemente edilmemis bir
        // handler'a karsi da GECERDI.
        expect(res?.error).toBe('FORBIDDEN_ORIGIN')
        expect(unlockVault).not.toHaveBeenCalled()
    })
})

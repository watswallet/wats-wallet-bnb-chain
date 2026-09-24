import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * ACCOUNT_CHANGED -- Solana serididi (spec 7.3.1 / K10).
 *
 * KOK NEDEN: oturum baglandigi HESABA SABITTIR. Kullanici hesap degistirdiginde
 * dapp'e haber verilmezse dapp eski hesabi bagli sanar, islemlerini o hesap icin
 * hazirlar ve her imza istegi kapida 4100 yiyerek "cuzdan bozuk" gibi gorunur.
 * TERS yon de en az onun kadar tehlikelidir: kaydi yeni hesaba TASIMAK, origin'e
 * kullanicinin AYRI bir onayi OLMADAN baska bir hesap uzerinde yetki verirdi --
 * bu yuzden asagida "solana_dapps'e HIC yazilmadigi" AYRICA kilitleniyor.
 *
 * Harness background.disconnectTonDapp.test.js'ten alindi.
 */

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'

let messageListener
let localStore
let sentTabMessages
let setSpy

const SESSION_A = {
    address: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK',
    publicKey: '5f0e1a', accountKey: 'acc-1', cluster: 'solana:mainnet',
    appMeta: { name: 'Jupiter', icon: null }, connectedAt: 1756700000,
}
const SESSION_B = {
    address: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
    publicKey: 'c31d02', accountKey: 'acc-1', cluster: 'solana:mainnet',
    appMeta: { name: 'Tensor', icon: null }, connectedAt: 1756700001,
}

// K2(a): tabs.sendMessage ilk cagrida reddederse -- kalan sekmelerin bildirimini
// KESMEMELI (notifySolanaDapp'teki .catch(() => {}) tam bunun icin var).
function installChromeStub({ failFirstSolanaSend = false, failSolanaDappsGet = false } = {}) {
    const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [], onChanged: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })

    setSpy = vi.fn(async (obj) => { Object.assign(localStore, obj) })
    sentTabMessages = []
    let solanaSendCagrisi = 0

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
                    if (failSolanaDappsGet && keys === 'solana_dapps') {
                        throw new Error('depo okuma hatasi')
                    }
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
            onChanged: add('onChanged'),
        },
        tabs: {
            // ERTELENMIS tikle cozulur (senkron degil): background.js'teki
            // Solana dongusunun `await notifySolanaDapp(...)` cagirdigini
            // KANITLAR. Senkron cozunurse `await` dusse bile sendMessage
            // sendResponse'tan ONCE zaten cagrilmis olurdu ve mutant testten
            // KACARDI -- setTimeout(0) bunu bir makro-gorev'e iterek
            // sendResponse'un await'siz dongude sendMessage'lardan ONCE
            // tetiklenmesini SAGLAR.
            query: vi.fn(() => new Promise((resolve) => {
                setTimeout(() => resolve([{ id: 7, url: 'https://uniswap.org/' }]), 0)
            })),
            sendMessage: vi.fn((tabId, msg) => {
                sentTabMessages.push({ tabId, msg })
                if (failFirstSolanaSend && msg.target === 'wats_solana_inpage') {
                    solanaSendCagrisi += 1
                    if (solanaSendCagrisi === 1) return Promise.reject(new Error('sekme kapali'))
                }
                return Promise.resolve()
            }),
            create: vi.fn(),
        },
        windows: { create: vi.fn(), onRemoved: add('onConnect'), remove: vi.fn() },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    }
    return { listeners }
}

function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
    return new Promise((resolve) => {
        const returned = messageListener(message, sender, resolve)
        if (returned !== true) resolve(undefined)
    })
}

const solanaMesajlari = () => sentTabMessages.filter((m) => m.msg.target === 'wats_solana_inpage')

async function kur(stubOpts) {
    vi.resetModules()
    vi.clearAllMocks()
    localStore = {
        dapps: { 'uniswap.org': { accounts: ['0xAaaa'], chainId: '0x1' } },
        solana_dapps: { 'https://jup.ag': SESSION_A, 'https://tensor.trade': SESSION_B },
    }
    const stub = installChromeStub(stubOpts)
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = stub.listeners.onMessage[0]
}

beforeEach(async () => {
    await kur()
})

describe('ACCOUNT_CHANGED -- Solana oturumlari', () => {
    it('BAGLI HER origin e change / {accounts: []} gonderilir', async () => {
        const res = await callHandler({ type: 'ACCOUNT_CHANGED', address: '0xBbbb000000000000000000000000000000000002' })

        expect(res.success).toBe(true)
        const solana = solanaMesajlari()
        expect(solana.map((m) => m.msg.origin).sort()).toEqual(['https://jup.ag', 'https://tensor.trade'])
        for (const m of solana) {
            expect(m.msg.event.event).toBe('change')
            expect(m.msg.event.payload.accounts).toEqual([])
        }
    })

    // 7.3.1 madde 1: kayit OLDUGU GIBI kalir. Kullanici eski hesaba donerse
    // oturum kendiliginden yeniden gecerli olur; adres hic degismedigi icin
    // SOLANA_DAPP_FROM_MISMATCH yalnizca GERCEK bir uyusmazlikta cikar.
    it('solana_dapps DEGISTIRILMEZ -- ne silinir ne yeni hesaba TASINIR', async () => {
        await callHandler({ type: 'ACCOUNT_CHANGED', address: '0xBbbb000000000000000000000000000000000002' })

        expect(localStore.solana_dapps).toEqual({ 'https://jup.ag': SESSION_A, 'https://tensor.trade': SESSION_B })
        const solanaYazimlari = setSpy.mock.calls.filter((call) => 'solana_dapps' in (call[0] || {}))
        expect(solanaYazimlari).toEqual([])
    })

    // EVM seridi AYNEN kalir: Solana yayini onun YERINE degil, YANINA eklendi.
    it('EVM accountsChanged yayini BOZULMAZ', async () => {
        await callHandler({ type: 'ACCOUNT_CHANGED', address: '0xBbbb000000000000000000000000000000000002' })

        const evm = sentTabMessages.find((m) => m.msg.target === 'wats_inpage')
        expect(evm.msg.method).toBe('accountsChanged')
        expect(evm.msg.result).toEqual(['0xBbbb000000000000000000000000000000000002'])
    })

    // Hesap TAMAMEN kaldirildiginda (address null) da ayni sey olur: Wallet
    // Standard'da "adres yok" diye bir ara durum yoktur, accounts BOS DIZIDIR.
    it('address null gelse de Solana yayini yine change / bos accounts', async () => {
        await callHandler({ type: 'ACCOUNT_CHANGED', address: null })

        const solana = solanaMesajlari()
        expect(solana.length).toBe(2)
        expect(solana[0].msg.event.payload.accounts).toEqual([])
    })

    it('solana_dapps bos ise HICBIR Solana mesaji gonderilmez', async () => {
        localStore.solana_dapps = {}
        const res = await callHandler({ type: 'ACCOUNT_CHANGED', address: '0xBbbb000000000000000000000000000000000002' })

        expect(res.success).toBe(true)
        expect(solanaMesajlari()).toEqual([])
    })
})

describe('ACCOUNT_CHANGED -- Solana yayini izole hatalar (K1)', () => {
    it('bir sekmenin tabs.sendMessage reddi digerini ENGELLEMEZ, EVM yine gider', async () => {
        await kur({ failFirstSolanaSend: true })

        const res = await callHandler({ type: 'ACCOUNT_CHANGED', address: '0xBbbb000000000000000000000000000000000002' })

        expect(res.success).toBe(true)
        const evm = sentTabMessages.find((m) => m.msg.target === 'wats_inpage')
        expect(evm.msg.method).toBe('accountsChanged')
        const solanaCagrilari = globalThis.chrome.tabs.sendMessage.mock.calls
            .filter((call) => call[1] && call[1].target === 'wats_solana_inpage')
        expect(solanaCagrilari.length).toBe(2)
    })

    it('chrome.storage.local.get(solana_dapps) reddederse Solana yayini basarisiz olur ama EVM ve success:true KORUNUR', async () => {
        await kur({ failSolanaDappsGet: true })

        const res = await callHandler({ type: 'ACCOUNT_CHANGED', address: '0xBbbb000000000000000000000000000000000002' })

        expect(res.success).toBe(true)
        const evm = sentTabMessages.find((m) => m.msg.target === 'wats_inpage')
        expect(evm.msg.method).toBe('accountsChanged')
        // G3 (Task 55 fix turu 1): Solana yayininin GERCEKTEN BASTIRILDIGINI
        // kanitla -- yol calisip HICBIR mesaj gondermeden basarili donmus
        // olabilirdi, bunu ayirt etmek icin.
        expect(solanaMesajlari()).toEqual([])
    })
})

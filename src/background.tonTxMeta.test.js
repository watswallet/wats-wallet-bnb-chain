import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Gecmis kartinin OKUYACAGI meta alanlari - TON yollari (native gonderim,
 * jetton, TonConnect dapp gonderimi).
 *
 * Harness background.tonDappSend.test.js'ten alindi: tonClient ve tonIdentity
 * TAM MOCKLANIR, boylece hicbir test aga cikmaz. Uc yolun da 'queued' yazmasi
 * kuyruga girmeden ONCE iner; bu dosya yaniti BEKLEMEZ, deponun kendisini
 * yoklar - islemin imza/yayin sonucu buranin konusu degil.
 *
 * SEMBOL TUZAGI: TON'un yerel para sembolu bu depoda GRAM (supported_chains.json
 * nativeCurrency.symbol, Home.vue, ConfirmTransaction.vue, TonSendTx.vue hepsi
 * boyle yaziyor). Karta 'TON' yazmak ekranin geri kalaniyla celisirdi.
 */

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const TON_MAINNET = -239
const TON_RECIPIENT = '0:2222222222222222222222222222222222222222222222222222222222222222'
const TON_RECIPIENT_2 = '0:3333333333333333333333333333333333333333333333333333333333333333'
const JETTON_MASTER = '0:4444444444444444444444444444444444444444444444444444444444444444'

const USDT_JETTON = {
    address: JETTON_MASTER,
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    // TON jettonlarinda API `image`i DIZE donduruyor (bkz. utils/tokenLogo.js
    // basindaki olcum). `.large` okumak burada undefined verir; tokenLogo cozer.
    image: 'https://tether.to/usdt.png',
}

let sessionStore
let localStore
let messageListener

vi.mock('./utils/ton/tonIdentity', () => ({
    tonIdentityForAccount: vi.fn(async () => { throw new Error('TEST_NO_IDENTITY') }),
}))

// Gercek TonClient aga cikar. Kart alanlari kuyruktan ONCE yazildigi icin
// burada yalnizca "ag yok" garantisi gerekiyor.
vi.mock('./utils/ton/tonClient', () => ({
    getTonClient: vi.fn(() => { throw new Error('TEST_NO_CLIENT') }),
}))

vi.mock('./utils/ton/tonFeeSettlement', () => ({
    loadAllTonSettlements: vi.fn(async () => []),
    hasUnsettledTonFee: vi.fn(() => false),
    clearTonSettlement: vi.fn(async () => {}),
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
                    const wanted = keys === undefined ? Object.keys(localStore)
                        : (Array.isArray(keys) ? keys : [keys])
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
        windows: {
            create: vi.fn(async () => ({ id: 1 })),
            getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
            get: vi.fn(async () => ({ id: 1 })),
            onRemoved: add('onConnect'),
            remove: vi.fn(),
        },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    }
    return listeners
}

function fire(message, sender = { url: EXTENSION_ORIGIN }) {
    messageListener(message, sender, () => {})
}

// updateTxStatus await EDILMEDEN cagriliyor (bilerek). Sabit sayida microtask
// beklemek kirilgan olurdu - kayit gorunene kadar yoklanir.
async function waitForRecord(predicate, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
        const found = (localStore.current_transactions || []).find(predicate)
        if (found) return found
        if (Date.now() > deadline) return null
        await new Promise((r) => setTimeout(r, 5))
    }
}

const byType = (type) => (t) => t?.meta?.type === type

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: { key: 'acc-1', address: '0xabc' },
        vaults: [{ id: 'v1', type: 'hd', accounts: [{ key: 'acc-1', address: '0xabc' }] }],
        currentNetwork: { chainId: TON_MAINNET },
        current_transactions: [],
        dapps: {},
    }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
})

describe('TON native gonderimi', () => {
    it('alici adresi recipient olarak yazilir', async () => {
        fire({
            type: 'SEND_TON_TRANSACTION',
            message: {
                chainId: TON_MAINNET,
                amount: '1.5',
                to: TON_RECIPIENT,
                comment: '',
                apiBase: 'https://api.test',
            },
        })

        const rec = await waitForRecord(byType('Transaction'))
        expect(rec).toBeTruthy()
        expect(rec.meta.recipient).toBe(TON_RECIPIENT)
    })

    // 'TON' DEGIL: ekranin geri kalani GRAM yaziyor, kartin farkli yazmasi
    // kullaniciya iki ayri varlik varmis gibi gorunur.
    it('yerel para sembolu GRAM olarak yazilir', async () => {
        fire({
            type: 'SEND_TON_TRANSACTION',
            message: { chainId: TON_MAINNET, amount: '1.5', to: TON_RECIPIENT, comment: '', apiBase: 'https://api.test' },
        })

        const rec = await waitForRecord(byType('Transaction'))
        expect(rec).toBeTruthy()
        expect(rec.meta.symbol).toBe('GRAM')
    })

    // Relay bayragi ve tip alanlari yerinde kalmali: yeni alanlar eklenirken
    // tonTxMeta'nin uretimi yeniden kurgulanacak, eski anahtarlar dusmemeli.
    it('chainId ve type alanlari bozulmadan kalir', async () => {
        fire({
            type: 'SEND_TON_TRANSACTION',
            message: { chainId: TON_MAINNET, amount: '1.5', to: TON_RECIPIENT, comment: '', apiBase: 'https://api.test' },
        })

        const rec = await waitForRecord(byType('Transaction'))
        expect(rec.meta.chainId).toBe(TON_MAINNET)
        expect(rec.meta.amount).toBe('1.5')
    })
})

describe('Jetton gonderimi', () => {
    it('alici ve token logosu meta ya yazilir', async () => {
        fire({
            type: 'SEND_TON_JETTON',
            message: {
                chainId: TON_MAINNET,
                amount: '20',
                to: TON_RECIPIENT,
                master: JETTON_MASTER,
                decimals: 6,
                symbol: 'USDT',
                assetData: USDT_JETTON,
                comment: '',
                apiBase: 'https://api.test',
            },
        })

        const rec = await waitForRecord(byType('Jetton'))
        expect(rec).toBeTruthy()
        expect(rec.meta.recipient).toBe(TON_RECIPIENT)
        expect(rec.meta.tokenLogo).toBe('https://tether.to/usdt.png')
    })

    // Sembol ZATEN yaziliyordu; yeni alanlar eklenirken kaybolmamali.
    it('sembol ve tam ad birlikte durur', async () => {
        fire({
            type: 'SEND_TON_JETTON',
            message: {
                chainId: TON_MAINNET, amount: '20', to: TON_RECIPIENT, master: JETTON_MASTER,
                decimals: 6, symbol: 'USDT', assetData: USDT_JETTON, comment: '', apiBase: 'https://api.test',
            },
        })

        const rec = await waitForRecord(byType('Jetton'))
        expect(rec.meta.symbol).toBe('USDT')
        expect(rec.meta.tokenName).toBe('Tether USD')
    })

    // ISTEGE BAGLI: assetData gondermeyen eski cagiranlar patlamamali.
    it('assetData yoksa jetton kaydi YINE olusur', async () => {
        fire({
            type: 'SEND_TON_JETTON',
            message: {
                chainId: TON_MAINNET, amount: '20', to: TON_RECIPIENT, master: JETTON_MASTER,
                decimals: 6, symbol: 'USDT', comment: '', apiBase: 'https://api.test',
            },
        })

        const rec = await waitForRecord(byType('Jetton'))
        expect(rec).toBeTruthy()
        expect(rec.meta.symbol).toBe('USDT')
    })
})

describe('TonConnect dapp gonderimi', () => {
    // ALICI IDDIASI YALNIZ KANITLANABILDIGI YERDE. `messages[0].address` cogu
    // dapp isleminde alici DEGILDIR: jetton transferinde kullanicinin KENDI jetton
    // cuzdanidir (bir sozlesme), gercek alici payload BOC'unun icinde durur. EVM
    // tarafinda taninmayan cagrilar icin ayni kural zaten kapatildi (evmRecipient);
    // TON'da da ayni olmali. Toplu gonderimde de tek adres gostermek, geri kalan
    // mesajlari SAKLAYIP birini "alici" diye one cikarmak olurdu.
    it('TEK mesajli, payload TASIMAYAN gonderimde alici yazilir', async () => {
        fire({
            type: 'TON_DAPP_SEND',
            message: {
                messages: [{ address: TON_RECIPIENT, amountNano: '1000000000', payload: null, stateInit: null }],
                validUntil: Math.floor(Date.now() / 1000) + 300,
                apiBase: 'https://api.test',
                from: '0:1111111111111111111111111111111111111111111111111111111111111111',
                dappHost: 'app.ston.fi',
            },
        })

        const rec = await waitForRecord(byType('TonConnect'))
        expect(rec.meta.recipient).toBe(TON_RECIPIENT)
    })

    it('payload TASIYAN mesajda alici YAZILMAZ -- adres bir sozlesme olabilir', async () => {
        fire({
            type: 'TON_DAPP_SEND',
            message: {
                messages: [{ address: TON_RECIPIENT, amountNano: '1000000000', payload: 'te6ccgEB', stateInit: null }],
                validUntil: Math.floor(Date.now() / 1000) + 300,
                apiBase: 'https://api.test',
                from: '0:1111111111111111111111111111111111111111111111111111111111111111',
                dappHost: 'app.ston.fi',
            },
        })

        const rec = await waitForRecord(byType('TonConnect'))
        expect('recipient' in rec.meta, 'payload varken sozlesme adresi alici diye yazilmis').toBe(false)
        expect(rec.meta.dappHost).toBe('app.ston.fi')
    })

    it('TOPLU gonderimde alici YAZILMAZ, yalniz msgCount', async () => {
        fire({
            type: 'TON_DAPP_SEND',
            message: {
                messages: [
                    { address: TON_RECIPIENT, amountNano: '1000000000', payload: null, stateInit: null },
                    { address: TON_RECIPIENT_2, amountNano: '2000000000', payload: null, stateInit: null },
                ],
                validUntil: Math.floor(Date.now() / 1000) + 300,
                apiBase: 'https://api.test',
                from: '0:1111111111111111111111111111111111111111111111111111111111111111',
                dappHost: 'app.ston.fi',
            },
        })

        const rec = await waitForRecord(byType('TonConnect'))
        expect(rec).toBeTruthy()
        expect('recipient' in rec.meta).toBe(false)
        expect(rec.meta.msgCount).toBe(2)
    })

    it('dapp alan adi dappHost olarak yazilir', async () => {
        fire({
            type: 'TON_DAPP_SEND',
            message: {
                messages: [{ address: TON_RECIPIENT, amountNano: '1000000000', payload: null, stateInit: null }],
                validUntil: Math.floor(Date.now() / 1000) + 300,
                apiBase: 'https://api.test',
                from: '0:1111111111111111111111111111111111111111111111111111111111111111',
                dappHost: 'app.ston.fi',
            },
        })

        const rec = await waitForRecord(byType('TonConnect'))
        expect(rec).toBeTruthy()
        expect(rec.meta.dappHost).toBe('app.ston.fi')
        expect(rec.meta.symbol).toBe('GRAM')
    })

    // Tek mesajli gonderimde de sayac YAZILIR: gorunum tarafi ">1 ise toplu"
    // kuralini kurabilsin diye. Alan yoksa kart "1 mi 5 mi" ayrimini yapamaz.
    it('tek mesajli gonderimde msgCount 1 dir', async () => {
        fire({
            type: 'TON_DAPP_SEND',
            message: {
                messages: [{ address: TON_RECIPIENT, amountNano: '1000000000', payload: null, stateInit: null }],
                validUntil: Math.floor(Date.now() / 1000) + 300,
                apiBase: 'https://api.test',
                from: '0:1111111111111111111111111111111111111111111111111111111111111111',
            },
        })

        const rec = await waitForRecord(byType('TonConnect'))
        expect(rec.meta.msgCount).toBe(1)
    })

    // Birlestirme sozlesmesinin TON tarafi: 'queued' disindaki yazimlar
    // (processing/error) meta'yi YAYARAK guncelliyor, alanlar dusmemeli.
    it('sonraki durum yazimlarindan sonra da alanlar duruyor', async () => {
        fire({
            type: 'TON_DAPP_SEND',
            message: {
                messages: [{ address: TON_RECIPIENT, amountNano: '1000000000', payload: null, stateInit: null }],
                validUntil: Math.floor(Date.now() / 1000) + 300,
                apiBase: 'https://api.test',
                from: '0:1111111111111111111111111111111111111111111111111111111111111111',
                dappHost: 'app.ston.fi',
            },
        })

        const rec = await waitForRecord((t) => t?.meta?.type === 'TonConnect' && t.status !== 'queued')
        expect(rec).toBeTruthy()
        expect(rec.meta.recipient).toBe(TON_RECIPIENT)
        expect(rec.meta.dappHost).toBe('app.ston.fi')
        expect(rec.meta.msgCount).toBe(1)
    })
})

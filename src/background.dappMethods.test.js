import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ethers } from 'ethers'
import supported_chains from './data/supported_chains.json'
import { rpcUrlsOf } from './utils/vm'
import { unsupportedMethodError as policyUnsupportedMethodError } from './utils/evmRpcPolicy'
import { parseTypedDataParams } from './utils/eip712/parse'
import { hashTypedDataDigest } from './utils/eip712/digest'

/**
 * Arka plan dagiticisinin EVM dapp yuzeyi (T14a): eth_signTypedData_v4,
 * SIGN_TYPED_DATA_CONFIRM ve `default:` -> 4200.
 *
 * Harness background.evmGates.test.js'ten alindi: background.js hicbir sey disari
 * vermiyor, chrome.* taklidiyle import edilip kaydettigi onMessage dinleyicisi
 * yakalaniyor. `navigator.locks` taklidi `dappsStore.updateDapps` icin (Node'da
 * `locks` yok).
 *
 * Uc blok: (1) yonlendirme -- T9 modulu SAHTE, yalniz kablolama olculur;
 * (2) `default:` 4200 hijyeni; (3) SIGN_TYPED_DATA_CONFIRM GERCEK T9 + T1 ile
 * uctan uca (imza ethers `verifyTypedData` ile dogrulanir).
 */

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const PAGE = {
    origin: 'https://dapp.example',
    url: 'https://dapp.example/app',
    tab: { id: 7, url: 'https://dapp.example/app' },
}
const WALLET_UI = { url: `${EXTENSION_ORIGIN}src/popup/index.html#window` }
const ETHEREUM = supported_chains.find((c) => c.chainId === 1)

// Kontrol (Cc) ve gorunmez bicim (Cf) karakterleri: kaynakta GORUNMEZ kalmasin diye kodla uretilir.
const NUL = String.fromCharCode(0)
const BIDI_ESLEME = String.fromCharCode(0x202e)
const SIFIR_GENISLIK = String.fromCharCode(0x200b)

let messageListener
let localStore
let sessionStore
let fetchSpy
let sentTabMessages

function installChromeStub() {
    const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [], onChanged: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })
    sentTabMessages = []

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
                    return Object.fromEntries(wanted.map((k) => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async (keys) => { for (const k of [].concat(keys)) delete localStore[k] }),
            },
            session: {
                get: vi.fn(async () => sessionStore),
                set: vi.fn(async (obj) => { Object.assign(sessionStore, obj) }),
                remove: vi.fn(async () => {}),
            },
            onChanged: add('onChanged'),
        },
        tabs: {
            query: vi.fn(async () => [{ id: 7, url: 'https://dapp.example/app' }]),
            sendMessage: vi.fn((tabId, msg) => { sentTabMessages.push({ tabId, msg }); return Promise.resolve() }),
            create: vi.fn(),
        },
        windows: {
            create: vi.fn(async () => ({ id: 1 })),
            getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
            get: vi.fn(async () => ({ id: 1 })),
            onRemoved: add('onConnect'),
            remove: vi.fn(async () => {}),
        },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    }
    return listeners
}

// Gercek `navigator.locks` gibi SIRALI: ikinci istek birincinin bitmesini bekler.
function makeLocks() {
    let kuyruk = Promise.resolve()
    return {
        request: vi.fn((ad, a, b) => {
            const cb = typeof a === 'function' ? a : b
            const calisan = kuyruk.then(() => cb({ name: ad }))
            kuyruk = calisan.catch(() => {})
            return calisan
        }),
    }
}

// Mevcut navigator nesnesine YALNIZ `locks` eklenir (navigator'in tamamini degistirmek
// arka plan modullerinin yukledigi kutuphanelerin ortam sezgisini bozabilir).
function installLocks() {
    Object.defineProperty(globalThis.navigator, 'locks', { value: makeLocks(), configurable: true, writable: true })
}

// `typedDataMock` verilirse utils/dappTypedData SAHTELENIR; `signingKey` verilirse
// kasa cozumunun sonundaki decryptSecret bu ozel anahtari doner (test icinde
// URETILEN rastgele anahtar -- depoda gercek anahtar YOKTUR).
async function kur({ typedDataMock, permissionsMock, signingKey } = {}) {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    vi.doUnmock('./utils/dappTypedData')
    vi.doUnmock('./utils/dappPermissionsHandlers')
    vi.doUnmock('./utils/crypto-utils')
    if (typedDataMock) vi.doMock('./utils/dappTypedData', () => typedDataMock)
    if (permissionsMock) vi.doMock('./utils/dappPermissionsHandlers', () => permissionsMock)
    if (signingKey) {
        vi.doMock('./utils/crypto-utils', async (importOriginal) => ({
            ...(await importOriginal()),
            decryptSecret: vi.fn(async () => signingKey),
        }))
    }

    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: { key: 'k1', type: 'hd', index: 0, address: '0xabc' },
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: '0xabc' }] }],
        currentNetwork: ETHEREUM,
        dapps: {},
    }
    const listeners = installChromeStub()
    installLocks()
    fetchSpy = vi.fn(async () => { throw new Error('fetch cagrilmamaliydi') })
    vi.stubGlobal('fetch', fetchSpy)
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))

    await import('./background.js')
    messageListener = listeners.onMessage[0]
    return listeners
}

// Handler sendResponse'u ASENKRON cagirabiliyor (return true). Sozle sarmalanir.
function callHandler(message, sender = WALLET_UI) {
    return new Promise((resolve) => {
        const returned = messageListener(message, sender, resolve)
        if (returned !== true) resolve(undefined)
    })
}

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.navigator.locks
})

describe('eth_signTypedData_v4 ve SIGN_TYPED_DATA_CONFIRM yonlendirmesi (T9 SAHTE)', () => {
    const typedData = { signTypedDataDapp: vi.fn(), confirmStoredTypedData: vi.fn() }

    beforeEach(async () => {
        typedData.signTypedDataDapp.mockReset().mockImplementation(
            async (_message, _sender, sendResponse) => { sendResponse({ result: '0xsig-dapp' }) }
        )
        typedData.confirmStoredTypedData.mockReset().mockResolvedValue(
            { success: true, signature: '0xsig-confirm' }
        )
        await kur({ typedDataMock: typedData })
    })

    it('eth_signTypedData_v4 sayfadan gelince signTypedDataDapp e gider, yaniti aynen iletir', async () => {
        const message = { method: 'eth_signTypedData_v4', params: ['0xabc', '{}'] }

        const res = await callHandler(message, PAGE)

        expect(res).toEqual({ result: '0xsig-dapp' })
        expect(typedData.signTypedDataDapp).toHaveBeenCalledTimes(1)
        const [m, s, cb, ...fazla] = typedData.signTypedDataDapp.mock.calls[0]
        expect(m).toBe(message)
        expect(s).toBe(PAGE)
        expect(typeof cb).toBe('function')
        // 4. parametre (openWindow) VERILMEZ: varsayilan openApprovalWindow kullanilir.
        expect(fazla).toEqual([])
    })

    it.each([
        ['type', { type: 'SIGN_TYPED_DATA_CONFIRM', message: { requestId: 'r1' } }],
        ['method', { method: 'SIGN_TYPED_DATA_CONFIRM', message: { requestId: 'r1' } }],
    ])('SIGN_TYPED_DATA_CONFIRM sayfadan (%s alani) gelirse 4100, islenmez', async (_alan, message) => {
        const res = await callHandler(message, PAGE)

        expect(res.error.code).toBe(4100)
        expect(typedData.confirmStoredTypedData).not.toHaveBeenCalled()
    })

    it('SIGN_TYPED_DATA_CONFIRM cuzdan arayuzunden gelirse confirmStoredTypedData e gider', async () => {
        const message = {
            type: 'SIGN_TYPED_DATA_CONFIRM',
            message: { requestId: 'r1', expectedDigest: '0x' + '11'.repeat(32) },
        }

        const res = await callHandler(message, WALLET_UI)

        expect(res).toEqual({ success: true, signature: '0xsig-confirm' })
        expect(typedData.confirmStoredTypedData).toHaveBeenCalledTimes(1)
        const arg = typedData.confirmStoredTypedData.mock.calls[0][0]
        expect(arg.message).toBe(message)
        expect(arg.sender).toBe(WALLET_UI)
        // T8 sozlesmesi (spec 7.2): hasPendingRequest GERCEK pendingRequests e bagli.
        expect(typeof arg.deps.hasPendingRequest).toBe('function')
        expect(arg.deps.hasPendingRequest('olmayan-istek')).toBe(false)
    })

    it('confirmStoredTypedData firlatirsa ekran SAYISAL kodlu hata alir (kapali-basarisiz, askida kalmaz)', async () => {
        typedData.confirmStoredTypedData.mockRejectedValue(new Error('ic ayrinti: sizmamali'))

        const res = await callHandler(
            { type: 'SIGN_TYPED_DATA_CONFIRM', message: { requestId: 'r1' } },
            WALLET_UI
        )

        expect(res.success).toBe(false)
        expect(res.error.code).toBe(-32603)
        expect(res.error.message).not.toContain('sizmamali')
        expect(res.signature).toBeUndefined()
    })
})

describe('default: -> 4200 (spec 6 G5/N2)', () => {
    beforeEach(() => kur())

    // wallet_getPermissions / wallet_revokePermissions BURADA YOK: T14b onlari
    // `case` ile uygular. eth_call gibi okumalar da YOK: T4b yapilirsa iletilir.
    it.each([
        'wallet_getCapabilities',
        'wallet_sendCalls',
        'wallet_getCallsStatus',
        'wallet_getAssets',
        'wallet_requestPermissions',
        'eth_signTypedData_v3',
        'eth_signTypedData',
        'eth_sign',
        'eth_signTransaction',
        'eth_sendRawTransaction',
        'personal_ecRecover',
        'constructor',
        '__proto__',
    ])('%s -> 4200, fetch HIC cagrilmaz', async (ad) => {
        const res = await callHandler({ method: ad, params: [] }, PAGE)

        expect(res).toEqual({
            error: { code: 4200, message: `The method ${ad} is not supported by this wallet.` },
        })
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('eski kodsuz dizge hatasi ARTIK donmez; yanit senkron ve kanal kapali (return false)', () => {
        const sendResponse = vi.fn()

        const returned = messageListener({ method: 'wallet_getCapabilities', params: [] }, PAGE, sendResponse)

        expect(returned).toBe(false)
        expect(sendResponse).toHaveBeenCalledTimes(1)
        const [govde] = sendResponse.mock.calls[0]
        expect(typeof govde.error).toBe('object')
        expect(typeof govde.error.code).toBe('number')
    })

    it('`type` ile gelen bilinmeyen ad (cuzdan arayuzu dahil) da kodlu hata alir', async () => {
        const res = await callHandler({ type: 'BOYLE_BIR_ISLEM_YOK' }, WALLET_UI)

        expect(res.error.code).toBe(4200)
    })

    it('sayfa adi en cok 64 karakter yansir', async () => {
        const res = await callHandler({ method: 'x'.repeat(500) }, PAGE)

        expect(res.error.code).toBe(4200)
        expect(res.error.message).toBe(`The method ${'x'.repeat(64)} is not supported by this wallet.`)
    })

    it('kontrol ve gorunmez bicim karakterleri atilir, sonra 64 sinir uygulanir', async () => {
        const kirli = 'eth_' + NUL + 'sign\r\n' + BIDI_ESLEME + 'x' + SIFIR_GENISLIK
        const res = await callHandler({ method: kirli }, PAGE)
        expect(res.error.message).toBe('The method eth_signx is not supported by this wallet.')

        // Once atma, sonra kesme: 40 + 40 kontrol + 40 -> 80 temiz karakter -> 64.
        const uzun = 'x'.repeat(40) + NUL.repeat(40) + 'y'.repeat(40)
        const res2 = await callHandler({ method: uzun }, PAGE)
        expect(res2.error.message).toBe(`The method ${'x'.repeat(40)}${'y'.repeat(24)} is not supported by this wallet.`)
    })

    // Kesme kod noktasi birimiyle: UTF-16 `slice(0, 64)` 100 emojiyi 32 emojide keser
    // (her emoji 2 birim) ya da tek-sayili sinirda yalniz surrogate birakirdi.
    it('emoji gibi cift kodlu karakter ortadan BOLUNMEZ; sinir kod noktasi sayar', async () => {
        const emoji = String.fromCodePoint(0x1F600)
        const res = await callHandler({ method: emoji.repeat(100) }, PAGE)
        expect(res.error.message).toBe(`The method ${emoji.repeat(64)} is not supported by this wallet.`)

        // 63 ASCII + emoji + 'zzz': 64. kod noktasi emojidir, tam kalir; yalniz-surrogate YOK.
        const sinirda = await callHandler({ method: 'a'.repeat(63) + emoji + 'zzz' }, PAGE)
        expect(sinirda.error.message).toBe(`The method ${'a'.repeat(63)}${emoji} is not supported by this wallet.`)
        expect(sinirda.error.message.isWellFormed()).toBe(true)
    })

    it.each([{ method: 42 }, { method: { a: 1 } }, {}])('dizge olmayan/eksik ad %j -> 4200, ad "unknown"', async (message) => {
        const res = await callHandler(message, PAGE)

        expect(res).toEqual({
            error: { code: 4200, message: 'The method unknown is not supported by this wallet.' },
        })
    })

    // AppKit "kullanici reddi"ni mesajdaki ifadeden de anlar (spec 6 G5): sayfa kendi
    // sectigi bir adla BU cuzdanin hatasini kullanici reddi gibi gosterememeli.
    it.each(['user rejected', 'User Rejected the request', 'user_cancelled', 'user-canceled', 'usercancelled', 'user denied'])(
        'ad %j "kullanici reddi" ifadesi tasiyorsa mesaja YANSITILMAZ',
        async (ad) => {
            const res = await callHandler({ method: ad }, PAGE)

            expect(res.error.code).toBe(4200)
            expect(res.error.message).toBe('The method unknown is not supported by this wallet.')
        }
    )
})

describe('SIGN_TYPED_DATA_CONFIRM -- GERCEK T9 + T1 ile uctan uca (spec 7.4 A madde 6)', () => {
    // Spec Ek B: Lab'in typed data yuku, birebir.
    const LAB_TYPED_DATA = {
        domain: { name: 'Ether Mail', version: '1', chainId: 1, verifyingContract: '0xcccccccccccccccccccccccccccccccccccccccc' },
        message: {
            from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
            to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
            contents: 'Hello, Bob!',
        },
        primaryType: 'Mail',
        types: {
            EIP712Domain: [
                { name: 'name', type: 'string' },
                { name: 'version', type: 'string' },
                { name: 'chainId', type: 'uint256' },
                { name: 'verifyingContract', type: 'address' },
            ],
            Person: [{ name: 'name', type: 'string' }, { name: 'wallet', type: 'address' }],
            Mail: [{ name: 'from', type: 'Person' }, { name: 'to', type: 'Person' }, { name: 'contents', type: 'string' }],
        },
    }
    const REQUEST_ID = 'req-typed-1'

    let signer
    let digest
    let parsed
    let pendingRequests

    // Rastgele, tek kullanimlik anahtar: depoda/fixture'da GERCEK anahtar YOK.
    beforeEach(async () => {
        signer = ethers.Wallet.createRandom()
        await kur({ signingKey: signer.privateKey })

        const account = {
            key: 'k-real', type: 'imported', name: 'Imported 1',
            address: signer.address, importedSecret: 'sifreli-sir-sahte',
        }
        localStore.active_account = account
        localStore.vaults = [{ id: 'v-real', type: 'privateKey', accounts: [account] }]
        localStore.dapps = {
            'dapp.example': { accounts: [signer.address.toLowerCase()], chainId: '0x1', origin: 'https://dapp.example' },
        }

        parsed = parseTypedDataParams([signer.address, JSON.stringify(LAB_TYPED_DATA)], { activeChainId: 1 })
        expect(parsed.ok).toBe(true)
        digest = hashTypedDataDigest(parsed.value.typedData).digest

        localStore.current_request = {
            type: 'SIGN_TYPED_DATA',
            id: REQUEST_ID,
            origin: 'https://dapp.example',
            signWith: parsed.value.signWith,
            typedData: parsed.value.typedData,
            digest,
            chainCheck: parsed.value.chainCheck,
            createdAt: Date.now(),
        }
        ;({ pendingRequests } = await import('./utils/dappFunctions'))
        pendingRequests.set(REQUEST_ID, { sendResponse: vi.fn(), windowId: 1 })
    })

    const confirm = (extra = {}, sender = WALLET_UI) => callHandler({
        type: 'SIGN_TYPED_DATA_CONFIRM',
        message: { requestId: REQUEST_ID, expectedDigest: digest, ...extra },
    }, sender)

    it('imza uretilir ve verifyTypedData ile hesap adresine cikar; anahtar disari cikmaz', async () => {
        const res = await confirm()

        expect(res.success).toBe(true)
        expect(res.signature).toMatch(/^0x[0-9a-f]{130}$/i)
        const { EIP712Domain, ...types } = LAB_TYPED_DATA.types
        expect(ethers.verifyTypedData(LAB_TYPED_DATA.domain, types, LAB_TYPED_DATA.message, res.signature))
            .toBe(signer.address)
        expect(JSON.stringify(res)).not.toContain(signer.privateKey.slice(2))
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('sayfadan gelen ayni mesaj imza URETMEZ (kapi)', async () => {
        const res = await confirm({}, PAGE)

        expect(res.error.code).toBe(4100)
        expect(res.signature).toBeUndefined()
    })

    it('bekleyen istek yoksa (SW yeniden basladi) kapali-basarisiz: imza yok, sayisal kod', async () => {
        pendingRequests.delete(REQUEST_ID)

        const res = await confirm()

        expect(res.success).toBe(false)
        expect(typeof res.error.code).toBe('number')
        expect(res.signature).toBeUndefined()
    })

    it('expectedDigest saklanan kayitla uyusmazsa imza URETILMEZ', async () => {
        const res = await confirm({ expectedDigest: '0x' + '00'.repeat(32) })

        expect(res.success).toBe(false)
        expect(typeof res.error.code).toBe('number')
        expect(res.signature).toBeUndefined()
    })

    it('izin onay beklerken kalktiysa 4100 (hibe DISKTEN yeniden okunur)', async () => {
        localStore.dapps = {}

        const res = await confirm()

        expect(res.success).toBe(false)
        expect(res.error.code).toBe(4100)
        expect(res.signature).toBeUndefined()
    })

    it('istek TTL i (5 dk) astiysa -32603 Request expired', async () => {
        localStore.current_request.createdAt = Date.now() - 6 * 60 * 1000

        const res = await confirm()

        expect(res.success).toBe(false)
        expect(res.error).toEqual({ code: -32603, message: 'Request expired' })
        expect(res.signature).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// T14b: wallet_getPermissions / wallet_revokePermissions (spec 6 G3, 7.4 B)
// ---------------------------------------------------------------------------

const GRANT_A = '0x' + 'a1'.repeat(20)
const GRANT_B = '0x' + 'b2'.repeat(20)
const PAGE_HTTP = {
    origin: 'http://dapp.example',
    url: 'http://dapp.example/app',
    tab: { id: 7, url: 'http://dapp.example/app' },
}
const REVOKE = { method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }
const GET_PERMISSIONS = { method: 'wallet_getPermissions', params: [] }

const olaylar = () => sentTabMessages.filter((m) => m.msg.target === 'wats_inpage')

describe('wallet_getPermissions / wallet_revokePermissions yonlendirmesi (T10 SAHTE)', () => {
    const permissions = { getPermissionsDapp: vi.fn(), revokePermissionsDapp: vi.fn() }

    beforeEach(async () => {
        permissions.getPermissionsDapp.mockReset().mockImplementation(
            async (_message, _sender, sendResponse) => { sendResponse({ result: ['izinler'] }) }
        )
        permissions.revokePermissionsDapp.mockReset().mockImplementation(
            async (_message, _sender, sendResponse) => { sendResponse({ result: null }) }
        )
        await kur({ permissionsMock: permissions })
    })

    it('wallet_getPermissions sayfadan gelince getPermissionsDapp e gider, yaniti aynen iletir', async () => {
        const res = await callHandler(GET_PERMISSIONS, PAGE)

        expect(res).toEqual({ result: ['izinler'] })
        expect(permissions.getPermissionsDapp).toHaveBeenCalledTimes(1)
        const [m, s, cb, ...fazla] = permissions.getPermissionsDapp.mock.calls[0]
        expect(m).toBe(GET_PERMISSIONS)
        expect(s).toBe(PAGE)
        expect(typeof cb).toBe('function')
        expect(fazla).toEqual([])
    })

    it('wallet_revokePermissions revokePermissionsDapp e gider; deps: notify (notifyDappTab) + rejectPendingForOrigin', async () => {
        const res = await callHandler(REVOKE, PAGE)

        expect(res).toEqual({ result: null })
        expect(permissions.revokePermissionsDapp).toHaveBeenCalledTimes(1)
        const [m, s, cb, deps, ...fazla] = permissions.revokePermissionsDapp.mock.calls[0]
        expect(m).toBe(REVOKE)
        expect(s).toBe(PAGE)
        expect(typeof cb).toBe('function')
        expect(typeof deps.rejectPendingForOrigin).toBe('function')
        expect(fazla).toEqual([])

        // notify arka plandaki notifyDappTab e BAGLI: hedef hostname + accountsChanged([]).
        await deps.notify('dapp.example', 'accountsChanged', [])
        expect(olaylar()).toHaveLength(1)
        expect(olaylar()[0].tabId).toBe(7)
        expect(olaylar()[0].msg).toEqual(expect.objectContaining({
            hostnames: ['dapp.example'],
            method: 'accountsChanged',
            result: [],
        }))
    })

    // G3 karari: wagmi requestPermissions hatasini yutup eth_requestAccounts a gecer;
    // baglanma yoluna dokunulmaz, bu yontem `case` siz kalir.
    it('wallet_requestPermissions HALA case siz: 4200, izin islevleri CAGRILMAZ', async () => {
        const res = await callHandler({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] }, PAGE)

        expect(res.error.code).toBe(4200)
        expect(permissions.getPermissionsDapp).not.toHaveBeenCalled()
        expect(permissions.revokePermissionsDapp).not.toHaveBeenCalled()
    })
})

describe('wallet_getPermissions / wallet_revokePermissions -- GERCEK T10 + T8 + T3 ile uctan uca', () => {
    const KAYIT = {
        accounts: [GRANT_A, GRANT_B],
        chainId: '0x1',
        origin: 'https://dapp.example',
        connectedAt: 1756700000000,
        followActive: true,
    }
    const TON_OTURUMU = { 'dapp.example': { address: 'UQ-ton', connectedAt: 1 } }
    const SOLANA_OTURUMU = { 'https://dapp.example': { address: 'sol-adres', connectedAt: 2 } }

    beforeEach(async () => {
        await kur()
        localStore.active_account = { key: 'k-b', type: 'hd', address: GRANT_B }
        localStore.dapps = { 'dapp.example': { ...KAYIT }, 'baska.example': { accounts: [GRANT_A], chainId: '0x1' } }
        localStore.ton_dapps = JSON.parse(JSON.stringify(TON_OTURUMU))
        localStore.solana_dapps = JSON.parse(JSON.stringify(SOLANA_OTURUMU))
    })

    describe('wallet_getPermissions', () => {
        it('EIP-2255 sekli: invoker gonderen origin, caveat sirali hesaplar (aktif basta), date connectedAt', async () => {
            const res = await callHandler(GET_PERMISSIONS, PAGE)

            expect(res).toEqual({
                result: [{
                    invoker: 'https://dapp.example',
                    parentCapability: 'eth_accounts',
                    caveats: [{ type: 'restrictReturnedAccounts', value: [GRANT_B, GRANT_A] }],
                    date: 1756700000000,
                }],
            })
            expect(globalThis.chrome.windows.create).not.toHaveBeenCalled()
        })

        it('allowedChains/gasless izin olarak ACILMAZ', async () => {
            localStore.dapps['dapp.example'] = { ...KAYIT, allowedChains: [1, 137], gasless: true }

            const res = await callHandler(GET_PERMISSIONS, PAGE)

            expect(JSON.stringify(res)).not.toContain('allowedChains')
            expect(JSON.stringify(res)).not.toContain('gasless')
        })

        it('bagli olmayan origin icin [] (hata DEGIL)', async () => {
            localStore.dapps = {}

            expect(await callHandler(GET_PERMISSIONS, PAGE)).toEqual({ result: [] })
        })

        it('saklanan TAM origin gonderenle eslesmiyorsa (http / https) []', async () => {
            expect(await callHandler(GET_PERMISSIONS, PAGE_HTTP)).toEqual({ result: [] })
        })

        it('aktif ag EVM degilse []', async () => {
            localStore.currentNetwork = supported_chains.find((c) => c.chainId === 'solana-mainnet')

            expect(await callHandler(GET_PERMISSIONS, PAGE)).toEqual({ result: [] })
        })
    })

    describe('wallet_revokePermissions', () => {
        it('kayit SILINIR, sonuc null, o hostname e accountsChanged([]) gider, pencere ACILMAZ', async () => {
            const res = await callHandler(REVOKE, PAGE)

            expect(res).toEqual({ result: null })
            expect(localStore.dapps['dapp.example']).toBeUndefined()
            // Diger siteler korunur (tek-anahtar silme).
            expect(localStore.dapps['baska.example']).toEqual({ accounts: [GRANT_A], chainId: '0x1' })
            const bildirimler = olaylar().filter((m) => m.msg.method === 'accountsChanged')
            expect(bildirimler).toHaveLength(1)
            expect(bildirimler[0].msg.hostnames).toEqual(['dapp.example'])
            expect(bildirimler[0].msg.result).toEqual([])
            expect(globalThis.chrome.windows.create).not.toHaveBeenCalled()
        })

        it('sonrasinda eth_accounts [] doner', async () => {
            await callHandler(REVOKE, PAGE)

            expect(await callHandler({ method: 'eth_accounts', params: [] }, PAGE)).toEqual({ result: [] })
        })

        it('ton_dapps ve solana_dapps a DOKUNMAZ', async () => {
            await callHandler(REVOKE, PAGE)

            expect(localStore.ton_dapps).toEqual(TON_OTURUMU)
            expect(localStore.solana_dapps).toEqual(SOLANA_OTURUMU)
            const yazilanAnahtarlar = globalThis.chrome.storage.local.set.mock.calls.flatMap((c) => Object.keys(c[0]))
            expect(yazilanAnahtarlar).not.toContain('ton_dapps')
            expect(yazilanAnahtarlar).not.toContain('solana_dapps')
        })

        it('eski kayit (origin alani YOK): hostname e dusulur, silinir', async () => {
            localStore.dapps['dapp.example'] = { accounts: [GRANT_A], chainId: '0x1' }

            const res = await callHandler(REVOKE, PAGE)

            expect(res).toEqual({ result: null })
            expect(localStore.dapps['dapp.example']).toBeUndefined()
        })

        it('saklanan TAM origin gonderenle eslesmiyorsa (http / https) kayit KORUNUR, bildirim YOK', async () => {
            const res = await callHandler(REVOKE, PAGE_HTTP)

            expect(localStore.dapps['dapp.example']).toEqual(KAYIT)
            expect(olaylar()).toEqual([])
            if (res && res.error) expect(typeof res.error.code).toBe('number')
        })

        const GECERSIZ = [[], [null], ['eth_accounts'], [{}], [[]], [42]]
        it.each(GECERSIZ.map((params) => [JSON.stringify(params), params]))(
            'params %s -> -32602, kayit KORUNUR',
            async (_ad, params) => {
                const res = await callHandler({ method: 'wallet_revokePermissions', params }, PAGE)

                expect(res.error.code).toBe(-32602)
                expect(localStore.dapps['dapp.example']).toEqual(KAYIT)
                expect(olaylar()).toEqual([])
            }
        )

        it('eth_accounts anahtari YOKSA diger anahtarlar yok sayilir: sonuc null, kayit KORUNUR, bildirim YOK', async () => {
            const res = await callHandler({ method: 'wallet_revokePermissions', params: [{ baska_izin: {} }] }, PAGE)

            expect(res).toEqual({ result: null })
            expect(localStore.dapps['dapp.example']).toEqual(KAYIT)
            expect(olaylar()).toEqual([])
        })

        // wagmi disconnect'te bunu 100 ms zaman asimiyla cagirir: yol zamanlayiciya
        // ve pencereye DAYANMAMALI. Sahte zamanlayicida ilerletme yapilmaz; zamanlayiciya
        // dayanan bir yol burada asili kalir ve test zaman asimiyla kirmizi olur.
        it('yanit zamanlayiciya dayanmadan doner (wagmi 100 ms sinirina sigar)', async () => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
            try {
                const res = await callHandler(REVOKE, PAGE)

                expect(res).toEqual({ result: null })
            } finally {
                vi.useRealTimers()
            }
            expect(globalThis.chrome.windows.create).not.toHaveBeenCalled()
        })

        // spec 6 G3: izni kaybeden origin in BEKLEYEN onay istekleri 4100 ile reddedilir
        // ve pencere kapanir (rejectPendingForOrigin, T8). Gercek akis: eth_sendTransaction
        // onay penceresi acar, sonra ayni origin izni geri ceker.
        it('o origin in bekleyen onay istegi 4100 ile reddedilir ve pencere kapanir', async () => {
            const bekleyen = vi.fn()
            messageListener(
                { method: 'eth_sendTransaction', params: [{ from: GRANT_B, to: GRANT_A, value: '0x1' }] },
                PAGE,
                bekleyen
            )
            const { pendingRequests } = await import('./utils/dappFunctions')
            await vi.waitFor(() => expect(pendingRequests.size).toBe(1))
            expect(globalThis.chrome.windows.create).toHaveBeenCalledTimes(1)

            const res = await callHandler(REVOKE, PAGE)

            expect(res).toEqual({ result: null })
            await vi.waitFor(() => expect(bekleyen).toHaveBeenCalledTimes(1))
            expect(bekleyen.mock.calls[0][0].error.code).toBe(4100)
            expect(pendingRequests.size).toBe(0)
            expect(globalThis.chrome.windows.remove).toHaveBeenCalledWith(1)
        })
    })
})

// ---------------------------------------------------------------------------
// T14b (HER DAL): net_version yerelde cevaplanir (boss karari; T4b den BAGIMSIZ)
// ---------------------------------------------------------------------------

describe('net_version yerelde cevaplanir (default: dali, fetch YOK)', () => {
    beforeEach(() => kur())

    it('aktif zincirin ondalik kimligi (metin) doner', async () => {
        const res = await callHandler({ method: 'net_version', params: [] }, PAGE)

        expect(res).toEqual({ result: '1' })
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('BSC secili iken "56" doner', async () => {
        localStore.currentNetwork = supported_chains.find((c) => c.chainId === 56)

        expect(await callHandler({ method: 'net_version', params: [] }, PAGE)).toEqual({ result: '56' })
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('currentNetwork kaydi YOKSA varsayilan Ethereum: "1"', async () => {
        delete localStore.currentNetwork

        expect(await callHandler({ method: 'net_version', params: [] }, PAGE)).toEqual({ result: '1' })
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    // 1.8.2 birlesimi sonrasi eth_chainId (handleGetChainId) `hexChainIdFor(currentNetwork)` uzerinden
    // yanit veriyor; net_version AYNI zincir kimliginin ondaligi olmak ZORUNDA (iki yontem birbirini
    // yalanlamamali). Kayit varken ve kayit yokken ikisi birlikte kontrol edilir.
    it('net_version, eth_chainId ile AYNI kimligin ondaligi (kayit var ve kayit yok)', async () => {
        for (const kayit of [supported_chains.find((c) => c.chainId === 56), undefined]) {
            if (kayit) localStore.currentNetwork = kayit
            else delete localStore.currentNetwork

            const hex = (await callHandler({ method: 'eth_chainId', params: [] }, PAGE)).result
            const net = (await callHandler({ method: 'net_version', params: [] }, PAGE)).result

            expect(net).toBe(String(parseInt(hex, 16)))
        }
    })

    it('aktif ag EVM degilse 4901, fetch YOK', async () => {
        localStore.currentNetwork = supported_chains.find((c) => c.chainId === 'solana-mainnet')

        const res = await callHandler({ method: 'net_version', params: [] }, PAGE)

        expect(res.error.code).toBe(4901)
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('params ne olursa olsun sonuc degismez ve pencere acilmaz', async () => {
        const res = await callHandler({ method: 'net_version', params: ['x', { a: 1 }] }, PAGE)

        expect(res).toEqual({ result: '1' })
        expect(globalThis.chrome.windows.create).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------
// T14b (YALNIZ T4b yapildiysa): `default:` salt-okuma gecidi (spec 6 G2, 7.4 D)
// ---------------------------------------------------------------------------

const rpcCevap = (govde, status = 200) =>
    new Response(JSON.stringify(govde), { status, headers: { 'content-type': 'application/json' } })

describe('default: salt-okuma gecidi (T4b baglantisi)', () => {
    beforeEach(() => kur())

    it('eth_blockNumber PAKETLI zincir verisinin ilk RPC URL ine gider ve sonucu doner', async () => {
        fetchSpy.mockImplementation(async () => rpcCevap({ jsonrpc: '2.0', id: 1, result: '0x10' }))

        const res = await callHandler({ method: 'eth_blockNumber', params: [] }, PAGE)

        expect(res).toEqual({ result: '0x10' })
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        expect(fetchSpy.mock.calls[0][0]).toBe(rpcUrlsOf(ETHEREUM)[0])
        expect(JSON.parse(fetchSpy.mock.calls[0][1].body).method).toBe('eth_blockNumber')
    })

    it('currentNetwork kaydi YOKSA varsayilan Ethereum kullanilir (eth_chainId ile ayni varsayim)', async () => {
        delete localStore.currentNetwork
        fetchSpy.mockImplementation(async () => rpcCevap({ jsonrpc: '2.0', id: 1, result: '0x7' }))

        const res = await callHandler({ method: 'eth_blockNumber', params: [] }, PAGE)

        expect(res).toEqual({ result: '0x7' })
        expect(fetchSpy.mock.calls[0][0]).toBe(rpcUrlsOf(ETHEREUM)[0])
    })

    // net_version bu blokta YOK: Task 2 (HER DAL) yerelde cevaplar ve orada test edilir.

    it.each([
        'eth_sendRawTransaction', 'eth_sign', 'eth_signTransaction', 'personal_ecRecover',
        'eth_coinbase', 'eth_subscribe', 'eth_newFilter', 'eth_getFilterChanges',
        'debug_traceTransaction', 'txpool_content', 'admin_peers',
        'wallet_getCapabilities', 'constructor', '__proto__',
    ])('%s -> 4200, fetch HIC cagrilmaz', async (ad) => {
        const res = await callHandler({ method: ad, params: [] }, PAGE)

        expect(res.error.code).toBe(4200)
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('aktif ag EVM degilse 4901 (okuma yapilmaz)', async () => {
        localStore.currentNetwork = supported_chains.find((c) => c.chainId === 'solana-mainnet')

        const res = await callHandler({ method: 'eth_blockNumber', params: [] }, PAGE)

        expect(res.error.code).toBe(4901)
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    // Cuzdan karari (4001) RPC tarafindan TAKLIT edilemez; "user rejected" ifadesi yalniz
    // gercek kullanici reddinde (spec 9 madde 15).
    it('upstream in 4001 / "User rejected" hatasi suzulur: -32603, ifade yok', async () => {
        fetchSpy.mockImplementation(async () => rpcCevap({
            jsonrpc: '2.0', id: 1, error: { code: 4001, message: 'User rejected the request.' },
        }))

        const res = await callHandler({ method: 'eth_call', params: [{}, 'latest'] }, PAGE)

        expect(res.error.code).toBe(-32603)
        expect(res.error.message).not.toMatch(/user (rejected|denied|cancel)/i)
    })

    it('tum uclar cokerse -32603; hata govdesinde RPC URL i / ana makine adi YOK', async () => {
        fetchSpy.mockRejectedValue(new Error('ECONNRESET https://gizli-rpc.example/anahtar123'))

        const res = await callHandler({ method: 'eth_blockNumber', params: [] }, PAGE)

        expect(res.error.code).toBe(-32603)
        const metin = JSON.stringify(res)
        expect(metin).not.toContain('gizli-rpc.example')
        expect(metin).not.toContain('anahtar123')
        for (const url of rpcUrlsOf(ETHEREUM)) expect(metin).not.toContain(url)
    })

    // W6 / cross bulgu 5: iki 4200 govdesi (background.js T14a ozel islevi ve T4b evmRpcPolicy)
    // DAVRANIS-OZDESTIR ve patron karariyla IKI KOPYA olarak KABUL EDILDI (capraz ice aktarma YOK).
    // T4b kesilebilir ve T14a dan sonra indigi icin iki kopya tutulur; bu test ayni PAYLASILAN
    // vektorlerle (sifir-genislik, bidi, user-rejected cesitleri, metin olmayan ad, emoji) ikisini
    // yan yana kosturur (bu blok yalniz T4b KAPANDI iken, yani Dal A da vardir). Biri degisirse
    // digeri de degismeli: fark burada kirmizi olur.
    it.each([
        'wallet_getCapabilities',
        'x'.repeat(500),
        'eth_' + NUL + 'sign' + String.fromCharCode(13, 10) + BIDI_ESLEME + 'x' + SIFIR_GENISLIK,
        'x'.repeat(40) + NUL.repeat(40) + 'y'.repeat(40),
        SIFIR_GENISLIK + SIFIR_GENISLIK,
        'user rejected', 'User_Denied', 'user-cancelled', 'x User Rejected y',
        'user' + SIFIR_GENISLIK + ' rejected',
        'user_getInfo',
        String.fromCodePoint(0x1F600).repeat(100),
        'a'.repeat(63) + String.fromCodePoint(0x1F600) + 'zzz',
        42, { a: 1 }, '',
    ])('4200 govdesi T4b evmRpcPolicy ile BIREBIR ayni: %j', async (ad) => {
        const res = await callHandler({ method: ad, params: [] }, PAGE)

        expect(res).toEqual({ error: policyUnsupportedMethodError(ad) })
        expect(fetchSpy).not.toHaveBeenCalled()
    })
})

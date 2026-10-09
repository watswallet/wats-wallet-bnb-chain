import { describe, it, expect, vi, beforeEach } from 'vitest'
import supported_chains from '../data/supported_chains.json'

/**
 * `rejectPendingForOrigin(origin, {code, message}) -> Promise<number>` (spec 7.2
 * "T8 cikti sozlesmesi"; T9/T10/T3 bunu `deps.rejectPendingForOrigin` ile alir).
 *
 * Izni kaybeden origin'in bekleyen onay isteklerini kodlu hatayla reddeder,
 * `current_request` kaydini temizler, ilgili onay penceresini kapatir ve
 * reddedilen kayit sayisini doner (hic yoksa 0). ASLA firlatmaz.
 */

vi.mock('./approvalThrottle', () => ({ checkApprovalThrottle: vi.fn(() => ({ ok: true })), noteApprovalRejected: vi.fn() }))

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const GRANTED = '0xAbCdEf0000000000000000000000000000000001'
const REVOKED = { code: 4100, message: 'The requested account and/or method has not been authorized by the user.' }

let localStore
let dapp

function installChromeStub() {
    globalThis.chrome = {
        windows: {
            onRemoved: { addListener: () => {} },
            create: vi.fn(async () => ({ id: 7 })),
            getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
            get: vi.fn(async () => ({ id: 7 })),
            remove: vi.fn(async () => {}),
        },
        storage: {
            local: {
                get: vi.fn(async (keys) => {
                    const wanted = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(wanted.map(k => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async (k) => { delete localStore[k] }),
            },
        },
        runtime: { getURL: (p) => 'chrome-extension://wats/' + p },
    }
}

const senderFor = (origin) => ({ origin, url: origin + '/app', tab: { url: origin + '/app', favIconUrl: '' } })
const sender = senderFor('https://dapp.example')

beforeEach(async () => {
    vi.resetModules()
    localStore = {
        currentNetwork: ETH_CHAIN,
        active_account: { key: 'k1', address: GRANTED, name: 'Hesap 1' },
        dapps: { 'dapp.example': { accounts: [GRANTED], chainId: '0x1' } },
    }
    installChromeStub()
    dapp = await import('./dappFunctions')
})

// Gercek akisla bekleyen bir imza istegi kurar (Map kaydi `origin`/`type` tasir).
async function bekleyenImza() {
    const respond = vi.fn()
    await dapp.signMessageDapp({ params: ['msg', GRANTED] }, sender, respond)
    return { respond, id: localStore.current_request.id }
}

describe('rejectPendingForOrigin: eslesen kayitlar', () => {
    it('TAM origin ile: istek kodlu hatayla reddedilir, kayit/`current_request` temizlenir, pencere kapanir', async () => {
        const { respond, id } = await bekleyenImza()

        const sayi = await dapp.rejectPendingForOrigin('https://dapp.example', REVOKED)

        expect(sayi).toBe(1)
        expect(respond).toHaveBeenCalledOnce()
        expect(respond).toHaveBeenCalledWith({ error: { code: 4100, message: REVOKED.message } })
        expect(dapp.hasPendingRequest(id)).toBe(false)
        expect(localStore.current_request).toBeUndefined()
        expect(chrome.windows.remove).toHaveBeenCalledWith(7)
    })

    it('HOSTNAME ile de eslesir (dapps kayitlari hostname anahtarlidir) ve farkli portlu origin\'i de kapsar', async () => {
        const respond = vi.fn()
        await dapp.signMessageDapp({ params: ['msg', GRANTED] }, senderFor('http://dapp.example:8080'), respond)
        localStore.dapps['dapp.example'].accounts = [GRANTED]

        expect(await dapp.rejectPendingForOrigin('dapp.example', REVOKED)).toBe(1)
        expect(respond).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4100 }) })
    })

    it('verilen kod/mesaj AYNEN iletilir (4100 disinda da)', async () => {
        const { respond } = await bekleyenImza()
        await dapp.rejectPendingForOrigin('https://dapp.example', { code: -32603, message: 'Request expired' })

        expect(respond).toHaveBeenCalledWith({ error: { code: -32603, message: 'Request expired' } })
    })

    it('kod/mesaj eksik ya da gecersizse 4100 UNAUTHORIZED\'a duser (dapp\'e HER ZAMAN sayisal kod)', async () => {
        const { respond } = await bekleyenImza()
        await dapp.rejectPendingForOrigin('https://dapp.example', { code: 'x' })

        expect(respond).toHaveBeenCalledWith({ error: { code: 4100, message: REVOKED.message } })
    })

    it('onRemoved sonradan ayni kaydi ikinci kez YANITLAMAZ (kayit once silinir)', async () => {
        const removed = []
        chrome.windows.onRemoved = { addListener: (fn) => removed.push(fn) }
        vi.resetModules()
        dapp = await import('./dappFunctions')
        const respond = vi.fn()
        await dapp.signMessageDapp({ params: ['msg', GRANTED] }, sender, respond)

        await dapp.rejectPendingForOrigin('https://dapp.example', REVOKED)
        for (const fn of removed) fn(7)

        expect(respond).toHaveBeenCalledOnce()
    })

    it('ayni origin\'in HER bekleyen kaydi reddedilir ve sayi dogru doner', async () => {
        const r1 = vi.fn()
        const r2 = vi.fn()
        dapp.pendingRequests.set('a', { sendResponse: r1, windowId: 7, origin: 'https://dapp.example', type: 'SEND_TX' })
        dapp.pendingRequests.set('b', { sendResponse: r2, windowId: 7, origin: 'https://dapp.example', type: 'SIGN_TYPED_DATA' })

        expect(await dapp.rejectPendingForOrigin('https://dapp.example', REVOKED)).toBe(2)
        expect(r1).toHaveBeenCalledOnce()
        expect(r2).toHaveBeenCalledOnce()
        expect(dapp.pendingRequests.size).toBe(0)
        expect(chrome.windows.remove).toHaveBeenCalledTimes(1)
    })

    // 1.8.2 birlesimi (B1): `windowId: null` kayit "penceresiz yasayan" kayittir (committed iken
    // pencere kapandi ya da degisti). Kapatilacak bir pencere yoktur: `remove(null)` cagrilmaz.
    it('penceresiz kayit (windowId null): reddedilir ama chrome.windows.remove(null) CAGRILMAZ', async () => {
        const respond = vi.fn()
        dapp.pendingRequests.set('p', { sendResponse: respond, windowId: null, origin: 'https://dapp.example', type: 'SEND_TX' })

        expect(await dapp.rejectPendingForOrigin('https://dapp.example', REVOKED)).toBe(1)
        expect(respond).toHaveBeenCalledWith({ error: { code: 4100, message: REVOKED.message } })
        expect(dapp.hasPendingRequest('p')).toBe(false)
        expect(chrome.windows.remove).not.toHaveBeenCalled()
    })
})

describe('rejectPendingForOrigin: DOKUNULMAYANLAR', () => {
    it('baska origin\'in bekleyen istegi yasar; pencere KAPANMAZ; `current_request` KALIR', async () => {
        const { respond, id } = await bekleyenImza()

        expect(await dapp.rejectPendingForOrigin('https://other.example', REVOKED)).toBe(0)

        expect(respond).not.toHaveBeenCalled()
        expect(dapp.hasPendingRequest(id)).toBe(true)
        expect(localStore.current_request.id).toBe(id)
        expect(chrome.windows.remove).not.toHaveBeenCalled()
    })

    it('hostname eslesmesi alt alan adini KAPSAMAZ (evil-dapp.example != dapp.example)', async () => {
        const respond = vi.fn()
        dapp.pendingRequests.set('x', { sendResponse: respond, windowId: 7, origin: 'https://evil-dapp.example', type: 'SEND_TX' })

        expect(await dapp.rejectPendingForOrigin('dapp.example', REVOKED)).toBe(0)
        expect(respond).not.toHaveBeenCalled()
    })

    it('TON ve Solana istekleri EVM izin kaybindan ETKILENMEZ', async () => {
        const rTon = vi.fn()
        const rSol = vi.fn()
        dapp.pendingRequests.set('t', { sendResponse: rTon, windowId: 8, origin: 'https://dapp.example', type: 'TON_SEND_TX' })
        dapp.pendingRequests.set('s', { sendResponse: rSol, windowId: 9, origin: 'https://dapp.example', type: 'SOLANA_SIGN_TX' })

        expect(await dapp.rejectPendingForOrigin('https://dapp.example', REVOKED)).toBe(0)
        expect(rTon).not.toHaveBeenCalled()
        expect(rSol).not.toHaveBeenCalled()
        expect(dapp.pendingRequests.size).toBe(2)
    })

    // 1.8.2 birlesimi (B1): isleme baglanan TON kaydi penceresizdir (windowId null) ve yaniti
    // arka plan verir; izin kaybi reddi ona DOKUNMAZ (TON_ tipi atlanir) ve pencereye de gitmez.
    it('isleme baglanan (committed, windowId null) TON kaydi dokunulmaz', async () => {
        const rTon = vi.fn()
        dapp.pendingRequests.set('t', { sendResponse: rTon, windowId: null, committed: true, origin: 'https://dapp.example', type: 'TON_SEND_TX' })

        expect(await dapp.rejectPendingForOrigin('https://dapp.example', REVOKED)).toBe(0)
        expect(rTon).not.toHaveBeenCalled()
        expect(dapp.hasPendingRequest('t')).toBe(true)
        expect(chrome.windows.remove).not.toHaveBeenCalled()
    })

    it('`origin` alani olmayan eski/yabanci kayit dokunulmaz', async () => {
        const respond = vi.fn()
        dapp.pendingRequests.set('legacy', { sendResponse: respond, windowId: 3 })

        expect(await dapp.rejectPendingForOrigin('https://dapp.example', REVOKED)).toBe(0)
        expect(respond).not.toHaveBeenCalled()
        expect(dapp.hasPendingRequest('legacy')).toBe(true)
    })

    it('reddedilen kaydin `current_request`i degilse (baska guncel kayit) o SILINMEZ', async () => {
        const respond = vi.fn()
        dapp.pendingRequests.set('old', { sendResponse: respond, windowId: 7, origin: 'https://dapp.example', type: 'SEND_TX' })
        localStore.current_request = { type: 'CONNECT', id: 'baska-guncel', origin: 'https://other.example' }

        expect(await dapp.rejectPendingForOrigin('https://dapp.example', REVOKED)).toBe(1)
        expect(localStore.current_request.id).toBe('baska-guncel')
    })
})

describe('rejectPendingForOrigin: hic yoksa ve hata durumunda ASLA firlatmaz', () => {
    it('hic bekleyen yoksa 0 doner; depoya ve pencereye dokunmaz', async () => {
        expect(await dapp.rejectPendingForOrigin('https://dapp.example', REVOKED)).toBe(0)
        expect(chrome.storage.local.get).not.toHaveBeenCalled()
        expect(chrome.windows.remove).not.toHaveBeenCalled()
    })

    it.each([[undefined], [null], [''], [42], [{}]])('gecersiz origin %j -> 0', async (origin) => {
        const { respond } = await bekleyenImza()
        expect(await dapp.rejectPendingForOrigin(origin, REVOKED)).toBe(0)
        expect(respond).not.toHaveBeenCalled()
    })

    it('sendResponse firlatirsa da kalan kayitlar reddedilir, sayi dogru, firlatmaz', async () => {
        const kotu = vi.fn(() => { throw new Error('port closed') })
        const iyi = vi.fn()
        dapp.pendingRequests.set('k', { sendResponse: kotu, windowId: 7, origin: 'https://dapp.example', type: 'SEND_TX' })
        dapp.pendingRequests.set('i', { sendResponse: iyi, windowId: 7, origin: 'https://dapp.example', type: 'SIGN_MESSAGE' })

        await expect(dapp.rejectPendingForOrigin('https://dapp.example', REVOKED)).resolves.toBe(2)
        expect(iyi).toHaveBeenCalledOnce()
    })

    it('depo ve pencere hatalari yutulur; yine de reddedilen sayi doner', async () => {
        const { respond } = await bekleyenImza()
        chrome.storage.local.get = vi.fn(async () => { throw new Error('storage down') })
        chrome.windows.remove = vi.fn(async () => { throw new Error('window gone') })
        vi.spyOn(console, 'error').mockImplementation(() => {})

        await expect(dapp.rejectPendingForOrigin('https://dapp.example', REVOKED)).resolves.toBe(1)
        expect(respond).toHaveBeenCalledOnce()
    })

    it('pencere kapaninca "aktif pencere" izi sifirlanir: sonraki istek yeni pencere acar, eskisini kapatmaya CALISMAZ', async () => {
        await bekleyenImza()
        await dapp.rejectPendingForOrigin('https://dapp.example', REVOKED)
        chrome.windows.remove.mockClear()

        await dapp.signMessageDapp({ params: ['msg2', GRANTED] }, sender, vi.fn())

        expect(chrome.windows.create).toHaveBeenCalledTimes(2)
        expect(chrome.windows.remove).not.toHaveBeenCalled()
    })
})

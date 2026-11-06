import { describe, it, expect, vi, beforeEach } from 'vitest'

// approvalThrottle gercek zamandan bagimsiz (pendingLifecycle ile AYNI kural).
vi.mock('./approvalThrottle', () => ({ checkApprovalThrottle: vi.fn(() => ({ ok: true })), noteApprovalRejected: vi.fn() }))

/**
 * cancelPendingApprovals (gizli mod gecisi, spec 23.5 / WalletConnect devir notu davranis 2):
 * "cift iptal ve cift accountsChanged" kilidi. Uc kayit turu:
 *   - bekleyen (acik)  -> sayfa TAM BIR KEZ 4001 "User closed the window." alir, kayit silinir
 *   - committed (TON)  -> kayit KORUNUR (windowId=null, ertelenen=KAPANDI), cevabi arka plan verir
 *   - answered         -> kayit silinir ama ikinci bir cevap GITMEZ
 */

const KAPANDI = { code: 4001, message: 'User closed the window.' }
let localStore
let dapp

beforeEach(async () => {
    vi.resetModules()
    localStore = { current_request: { id: 'x', type: 'CONNECT' } }
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
                get: vi.fn(async (keys) => Object.fromEntries([].concat(keys).map((k) => [k, localStore[k]]))),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async (k) => { for (const key of [].concat(k)) delete localStore[key] }),
            },
        },
        runtime: { getURL: (p) => 'chrome-extension://wats/' + p },
    }
    dapp = await import('./dappFunctions')
})

describe('cancelPendingApprovals', () => {
    it('bekleyen kayit: sayfa tam bir kez KAPANDI alir, kayit silinir, ikinci iptal yeniden cevaplamaz', async () => {
        const respond = vi.fn()
        dapp.pendingRequests.set('r1', { sendResponse: respond, windowId: 7 })
        await dapp.cancelPendingApprovals()
        expect(respond).toHaveBeenCalledTimes(1)
        expect(respond).toHaveBeenCalledWith({ error: KAPANDI })
        expect(dapp.pendingRequests.has('r1')).toBe(false)
        expect(localStore.current_request).toBeUndefined()

        // Ikinci iptal (ornegin heal yolu) ayni kaydi bir daha YANITLAMAZ.
        await dapp.cancelPendingApprovals()
        expect(respond).toHaveBeenCalledTimes(1)
    })

    it('committed kayit KORUNUR (windowId=null, ertelenen=KAPANDI) ve sayfaya hemen cevap gitmez; arka plan cevabi tam bir kez verir', async () => {
        const respond = vi.fn()
        dapp.pendingRequests.set('r2', { sendResponse: respond, windowId: 7, committed: true })
        await dapp.cancelPendingApprovals()

        const kayit = dapp.pendingRequests.get('r2')
        expect(kayit).toBeDefined()
        expect(kayit.windowId).toBeNull()
        expect(kayit.ertelenen).toEqual(KAPANDI)
        expect(kayit.committed).toBe(true)
        expect(respond).not.toHaveBeenCalled()

        // Arka planin kendi cevabi (TON imzali gonderim sonucu) tek cevaptir.
        expect(await dapp.answerPendingRequest('r2', 'boc-sonuc')).toBe(true)
        expect(respond).toHaveBeenCalledTimes(1)
        expect(respond).toHaveBeenCalledWith({ result: 'boc-sonuc' })
        expect(dapp.pendingRequests.has('r2')).toBe(false)
        // Ikinci cevap yok.
        expect(await dapp.answerPendingRequest('r2', 'boc-sonuc')).toBe(false)
        expect(respond).toHaveBeenCalledTimes(1)
    })

    it('committed kayit imza dusunce releasePendingRequest ertelenen KAPANDI cevabini tam bir kez verir', async () => {
        const respond = vi.fn()
        dapp.pendingRequests.set('r3', { sendResponse: respond, windowId: 7, committed: true })
        await dapp.cancelPendingApprovals()
        dapp.releasePendingRequest('r3')
        expect(respond).toHaveBeenCalledTimes(1)
        expect(respond).toHaveBeenCalledWith({ error: KAPANDI })
        expect(dapp.pendingRequests.has('r3')).toBe(false)
    })

    it('answered kayit: silinir, ikinci sendResponse GITMEZ', async () => {
        const respond = vi.fn()
        dapp.pendingRequests.set('r4', { sendResponse: respond, windowId: 7, answered: true })
        await dapp.cancelPendingApprovals()
        expect(respond).not.toHaveBeenCalled()
        expect(dapp.pendingRequests.has('r4')).toBe(false)
    })

    it('sayfa cevabi artik alamiyorsa (sendResponse firlatir) diger istekler yine iptal edilir', async () => {
        const bozuk = vi.fn(() => { throw new Error('sekme kapandi') })
        const saglam = vi.fn()
        dapp.pendingRequests.set('r5', { sendResponse: bozuk, windowId: 7 })
        dapp.pendingRequests.set('r6', { sendResponse: saglam, windowId: 7 })
        await dapp.cancelPendingApprovals()
        expect(saglam).toHaveBeenCalledWith({ error: KAPANDI })
        expect(dapp.pendingRequests.size).toBe(0)
    })
})

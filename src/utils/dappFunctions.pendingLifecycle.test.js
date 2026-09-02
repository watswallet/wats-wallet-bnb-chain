import { describe, it, expect, vi, beforeEach } from 'vitest'
import supported_chains from '../data/supported_chains.json'

/**
 * Bekleyen dapp isteginin yasam dongusu (guvenlik taramasi duzeltmeleri):
 *
 * 1) YARIS: current_request, onay penceresi mutex'i (isOpeningWindow)
 *    alinmadan ONCE diske yaziliyordu. Pencere acilirken gelen ikinci istek
 *    ilkinin kaydini eziyor ama kendisi reddediliyordu: acilan pencere B'nin
 *    verisini gosterip A'nin id'siyle eslesmeyen bir istek yurutuyordu.
 *
 * 2) OLU KAYIT: resolvePendingRequest yalniz bellek ici pendingRequests
 *    Map'inde olan id'ler icin temizlik yapiyordu. MV3 service worker her
 *    yeniden basladiginda Map BOSALIR ama diskteki current_request kalir;
 *    kullanicinin Reddet'i hicbir sey silmiyor ve popup sonsuza dek ayni olu
 *    onay ekranina aciliyordu.
 */

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const GRANTED = '0xAbCdEf0000000000000000000000000000000001'

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

const sender = {
    origin: 'https://dapp.example',
    url: 'https://dapp.example/app',
    tab: { url: 'https://dapp.example/app', favIconUrl: '' },
}

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

describe('yaris: pencere acilirken gelen ikinci istek ILKININ kaydini EZEMEZ', () => {
    it('B reddedilir ve diskte A\'nin istegi kalir; acilan pencere A\'yi gosterir', async () => {
        // Pencere olusumu elle serbest birakilana kadar ASKIDA tutulur.
        let releaseCreate
        chrome.windows.create = vi.fn(() => new Promise((res) => { releaseCreate = res }))

        const respA = vi.fn()
        const respB = vi.fn()

        const pA = dapp.signMessageDapp({ params: ['msgA', GRANTED] }, sender, respA)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalled())

        // A pencereyi acarken B gelir: mutex onu reddetmeli VE diske dokundurtmamali.
        await dapp.signMessageDapp({ params: ['msgB', GRANTED] }, sender, respB)

        expect(respB).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4001 }) })
        expect(localStore.current_request.messageToSign).toBe('msgA')

        releaseCreate({ id: 7 })
        await pA

        // Tutarlilik: diskteki kayit, bekleyen istekle AYNI id'yi tasir.
        expect(respA).not.toHaveBeenCalled()
        expect(dapp.pendingRequests.has(localStore.current_request.id)).toBe(true)
    })
})

describe('olu kayit: service worker yeniden basladiktan sonra Reddet kaydi TEMIZLER', () => {
    it('id Map\'te olmasa da diskteki AYNI id\'li current_request silinir', async () => {
        // SW yeniden basladi: Map bos, diskte kayit duruyor.
        localStore.current_request = { type: 'SEND_TX', id: 'ghost-1' }

        await dapp.resolvePendingRequest({ requestId: 'ghost-1', status: 'error', error: { code: 4001, message: 'Transaction cancelled by user.' } })

        expect(localStore.current_request).toBeUndefined()
    })

    it('FARKLI id\'li guncel kayit ise DOKUNULMAZ', async () => {
        localStore.current_request = { type: 'SEND_TX', id: 'guncel-2' }

        await dapp.resolvePendingRequest({ requestId: 'ghost-1', status: 'error' })

        expect(localStore.current_request).toEqual({ type: 'SEND_TX', id: 'guncel-2' })
    })

    it('normal yol degismedi: Map\'teki istek yanitlanir, kayit silinir (regresyon)', async () => {
        const respond = vi.fn()
        dapp.pendingRequests.set('id-1', { sendResponse: respond, windowId: 3 })
        localStore.current_request = { type: 'SIGN_MESSAGE', id: 'id-1' }

        await dapp.resolvePendingRequest({ requestId: 'id-1', status: 'success', data: { result: '0xsig' } })

        expect(respond).toHaveBeenCalledWith({ result: '0xsig' })
        expect(dapp.pendingRequests.size).toBe(0)
        expect(localStore.current_request).toBeUndefined()
    })
})

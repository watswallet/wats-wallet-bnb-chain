import { describe, it, expect, vi, beforeEach } from 'vitest'
import supported_chains from '../data/supported_chains.json'

/**
 * N3: onay penceresi konum yedegi (`openApprovalWindow`).
 *
 * Pencere son odakli pencerenin sag ustune acilir (`left/top`). Chrome bu
 * sinirlari reddederse (ekran disinda kalan konum; simge durumundaki pencere
 * Windows'ta `left ~ -32000` bildirebilir -- tetikleyici DOGRULANMADI) dapp
 * eskiden `-32603 Failed to open approval window.` aliyor ve her onay vakasi
 * oluyordu. Secilen: `create` reddedilirse `left/top` OLMADAN BIR KEZ daha dene;
 * son odakli pencere `minimized` ise sinirlari hic hesaplama.
 *
 * Yeniden deneme mevcut sonlandirma akisini DEGISTIRMEZ: mutex salinir,
 * `pendingRequests` kaydi yazilir, hata yolunda `current_request` silinir.
 */

vi.mock('./approvalThrottle', () => ({ checkApprovalThrottle: vi.fn(() => ({ ok: true })), noteApprovalRejected: vi.fn() }))

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const GRANTED = '0xAbCdEf0000000000000000000000000000000001'

let localStore
let dapp

function installChromeStub() {
    globalThis.chrome = {
        windows: {
            onRemoved: { addListener: () => {} },
            create: vi.fn(async () => ({ id: 7 })),
            getLastFocused: vi.fn(async () => ({ width: 1000, left: 100, top: 40, state: 'normal' })),
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

const istek = () => dapp.signMessageDapp({ params: ['0xdeadbeef', GRANTED] }, sender, respond)
let respond

beforeEach(async () => {
    vi.resetModules()
    localStore = {
        currentNetwork: ETH_CHAIN,
        active_account: { key: 'k1', address: GRANTED, name: 'Hesap 1' },
        dapps: { 'dapp.example': { accounts: [GRANTED], chainId: '0x1' } },
    }
    installChromeStub()
    respond = vi.fn()
    dapp = await import('./dappFunctions')
})

describe('pencere konumu: normal yol (regresyon)', () => {
    it('son odakli pencerenin sag ustune acilir: left = left + width - 360, top = top', async () => {
        await istek()

        expect(chrome.windows.create).toHaveBeenCalledOnce()
        expect(chrome.windows.create).toHaveBeenCalledWith({
            url: 'chrome-extension://wats/src/popup/index.html#window',
            type: 'popup',
            width: 360,
            height: 600,
            left: 100 + 1000 - 360,
            top: 40,
            focused: true,
        })
        expect(respond).not.toHaveBeenCalled()
    })
})

describe('create sinirlari reddederse: left/top OLMADAN bir kez daha dene', () => {
    it('ilk create reddedilir, ikincisi sinirsiz basarir; istek normal bekler', async () => {
        chrome.windows.create = vi.fn()
            .mockRejectedValueOnce(new Error('Invalid value for bounds. Bounds must be at least 50% within visible screen space.'))
            .mockResolvedValueOnce({ id: 9 })

        await istek()

        expect(chrome.windows.create).toHaveBeenCalledTimes(2)
        const [ilk, ikinci] = chrome.windows.create.mock.calls.map((c) => c[0])
        expect(ilk).toMatchObject({ left: 100 + 1000 - 360, top: 40 })
        expect(ikinci).not.toHaveProperty('left')
        expect(ikinci).not.toHaveProperty('top')
        expect(ikinci).toMatchObject({ url: 'chrome-extension://wats/src/popup/index.html#window', type: 'popup', width: 360, height: 600, focused: true })

        // Sonlandirma akisi DEGISMEDI: kayit pencere kimligiyle bekler, dapp'e hata gitmez.
        expect(respond).not.toHaveBeenCalled()
        const id = localStore.current_request.id
        expect(dapp.pendingRequests.get(id)).toMatchObject({ windowId: 9 })
    })

    it('yedek de reddedilirse -32603 doner ve current_request SILINIR (eski davranis)', async () => {
        chrome.windows.create = vi.fn().mockRejectedValue(new Error('boom'))

        await istek()

        expect(chrome.windows.create).toHaveBeenCalledTimes(2)
        expect(respond).toHaveBeenCalledWith({ error: { code: -32603, message: 'Failed to open approval window.' } })
        expect(localStore.current_request).toBeUndefined()
        expect(dapp.pendingRequests.size).toBe(0)
    })

    it('yeniden denemeden sonra mutex SERBEST: sonraki istek pencere acabilir', async () => {
        chrome.windows.create = vi.fn()
            .mockRejectedValueOnce(new Error('bounds'))
            .mockResolvedValue({ id: 9 })
        await istek()

        const respond2 = vi.fn()
        await dapp.signMessageDapp({ params: ['0xbeef', GRANTED] }, sender, respond2)

        expect(respond2).not.toHaveBeenCalledWith({ error: expect.objectContaining({ message: 'Another request is being processed.' }) })
    })
})

describe('sinir HIC hesaplanmayan durumlar: yeniden deneme ANLAMSIZ, ilk hata aynen yukari', () => {
    it('son odakli pencere simge durumunda: create sinirsiz TEK cagrilir', async () => {
        chrome.windows.getLastFocused = vi.fn(async () => ({ width: 1000, left: -32000, top: -32000, state: 'minimized' }))

        await istek()

        expect(chrome.windows.create).toHaveBeenCalledOnce()
        const arg = chrome.windows.create.mock.calls[0][0]
        expect(arg).not.toHaveProperty('left')
        expect(arg).not.toHaveProperty('top')
        expect(respond).not.toHaveBeenCalled()
    })

    it('getLastFocused firlatirsa sinir yok: create sinirsiz TEK cagrilir', async () => {
        chrome.windows.getLastFocused = vi.fn(async () => { throw new Error('no window') })

        await istek()

        expect(chrome.windows.create).toHaveBeenCalledOnce()
        expect(chrome.windows.create.mock.calls[0][0]).not.toHaveProperty('left')
        expect(respond).not.toHaveBeenCalled()
    })

    it('sinir yokken create reddedilirse ikinci (anlamsiz) deneme YAPILMAZ: -32603', async () => {
        chrome.windows.getLastFocused = vi.fn(async () => ({ width: 1000, left: 0, top: 0, state: 'minimized' }))
        chrome.windows.create = vi.fn().mockRejectedValue(new Error('boom'))

        await istek()

        expect(chrome.windows.create).toHaveBeenCalledOnce()
        expect(respond).toHaveBeenCalledWith({ error: { code: -32603, message: 'Failed to open approval window.' } })
    })

    it('`state` alani hic yoksa (eski Chrome / test taklidi) sinir YINE hesaplanir', async () => {
        chrome.windows.getLastFocused = vi.fn(async () => ({ width: 800, left: 10, top: 20 }))

        await istek()

        expect(chrome.windows.create.mock.calls[0][0]).toMatchObject({ left: 10 + 800 - 360, top: 20 })
    })
})

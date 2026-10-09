import { describe, it, expect, vi, beforeEach } from 'vitest'
import supported_chains from '../data/supported_chains.json'

/**
 * `wallet_getPermissions` / `wallet_revokePermissions` isleyicileri (chrome taklidi).
 *
 * `dappFunctions.js` (resolveSenderOrigin, isEvmDappAddress; `handleGetAccounts` yalniz iptal sonrasi `[]` testinde)
 * GERCEK modulle yuklenir; T8'in `rejectPendingForOrigin`i ve arka plan
 * `notify`i `deps` ile SAHTE verilir (T14b gercekleri baglar).
 */

vi.mock('./approvalThrottle', () => ({ checkApprovalThrottle: vi.fn(() => ({ ok: true })), noteApprovalRejected: vi.fn() }))

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')

const A = '0xAaaaaa0000000000000000000000000000000001'
const B = '0xBbbbbb0000000000000000000000000000000002'
const TON_UQ = 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG'
const ORIGIN = 'https://dapp.example'
const UNAUTHORIZED_MESSAGE = 'The requested account and/or method has not been authorized by the user.'

let localStore
let handlers
let dappFunctions

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
                    return Object.fromEntries(wanted.map((k) => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async (k) => { delete localStore[k] }),
            },
        },
        runtime: { getURL: (p) => 'chrome-extension://wats/' + p },
    }
}

const senderFor = (origin) => ({ origin, url: origin + '/app', tab: { url: origin + '/app', favIconUrl: '' } })
const dappSender = senderFor(ORIGIN)

beforeEach(async () => {
    vi.resetModules()
    localStore = {
        currentNetwork: ETH_CHAIN,
        active_account: { key: 'k-a', address: A, name: 'Hesap A', type: 'hd' },
        dapps: {
            'dapp.example': { accounts: [B, A], chainId: '0x1', origin: ORIGIN, connectedAt: 1_700_000_000_000, allowedChains: [1, 10] },
            'other.example': { accounts: [A], chainId: '0x1', origin: 'https://other.example', connectedAt: 1_700_000_000_001 },
        },
        ton_dapps: { 'ton.example': { address: 'x' } },
        solana_dapps: { 'sol.example': { accounts: ['y'] } },
    }
    installChromeStub()
    dappFunctions = await import('./dappFunctions')
    handlers = await import('./dappPermissionsHandlers')
})

async function getPermissions(sender = dappSender) {
    const sendResponse = vi.fn()
    await handlers.getPermissionsDapp({ method: 'wallet_getPermissions' }, sender, sendResponse)
    expect(sendResponse).toHaveBeenCalledOnce()
    return sendResponse.mock.calls[0][0]
}

describe('getPermissionsDapp', () => {
    it('bagli site: TEK izin; invoker = gonderen origin; hesaplar SIRALI (aktif hesap basta); date = connectedAt', async () => {
        expect(await getPermissions()).toEqual({
            result: [{
                invoker: ORIGIN,
                parentCapability: 'eth_accounts',
                caveats: [{ type: 'restrictReturnedAccounts', value: expect.any(Array) }],
                date: 1_700_000_000_000,
            }],
        })
        const { result } = await getPermissions()
        expect(result[0].caveats[0].value.map((a) => a.toLowerCase())).toEqual([A.toLowerCase(), B.toLowerCase()])
    })

    it('aktif hesap saklanan listede ikinci ise basa alinir, kalan saklanan sirayla (orderGrantedAccounts)', async () => {
        // ONEMLI: `handleGetAccounts` ile esitlik BURADA denenmez (o T8'in is alani; esitlik T14b/T15'te).
        // Bu test yalniz kendi modulunun siralamasini sabitler; dappFunctions.js'e bagimli DEGILDIR.
        localStore.dapps['dapp.example'].accounts = [A, B]
        localStore.active_account = { key: 'k-b', address: B, name: 'Hesap B', type: 'hd' }

        const { result } = await getPermissions()

        expect(result[0].caveats[0].value.map((a) => a.toLowerCase())).toEqual([B.toLowerCase(), A.toLowerCase()])
    })

    it('`allowedChains` ve diger ic kayit alanlari izin olarak ACILMAZ', async () => {
        expect(JSON.stringify(await getPermissions())).not.toContain('allowedChains')
    })

    it('invoker kayit ANAHTARI (hostname) degil gonderen cercevenin TAM origin\'idir; eski kayit (origin yok) da calisir', async () => {
        delete localStore.dapps['dapp.example'].origin
        const { result } = await getPermissions()

        expect(result[0].invoker).toBe('https://dapp.example')
    })

    it('eski kayitta connectedAt yoksa `date` alani yoktur', async () => {
        delete localStore.dapps['dapp.example'].connectedAt
        const { result } = await getPermissions()

        expect(result).toHaveLength(1)
        expect(result[0]).not.toHaveProperty('date')
    })

    it('bagli olmayan origin -> []', async () => {
        expect(await getPermissions(senderFor('https://baska.example'))).toEqual({ result: [] })
    })

    it('kayitli TAM origin gonderenle ESIT degilse (ayni hostname, baska baglanti noktasi) -> []', async () => {
        expect(await getPermissions(senderFor('https://dapp.example:8443'))).toEqual({ result: [] })
    })

    it('iframe: izin GONDEREN cercevenin origin\'inden okunur, ust sekmeden degil', async () => {
        localStore.dapps['widget.example'] = { accounts: [A], origin: 'https://widget.example', connectedAt: 5 }
        const iframeSender = { origin: 'https://widget.example', url: 'https://widget.example/embed', tab: { url: 'https://trusted.example/news' } }
        const { result } = await getPermissions(iframeSender)

        expect(result[0].invoker).toBe('https://widget.example')
        expect(await getPermissions(senderFor('https://trusted.example'))).toEqual({ result: [] })
    })

    it('aktif ag EVM degilse -> []', async () => {
        localStore.currentNetwork = SOLANA_CHAIN
        expect(await getPermissions()).toEqual({ result: [] })
    })

    it('aktif hesabin EVM adresi yoksa (eski TON hesabi) -> [] (eth_accounts [] ile tutarli); kayit DEGISMEZ', async () => {
        localStore.active_account = { key: 'k-ton', type: 'ton', address: TON_UQ }
        expect(await getPermissions()).toEqual({ result: [] })
        expect(chrome.storage.local.set).not.toHaveBeenCalled()
    })

    it('`0x` onekli olmayan kayitlar listeden duser; yalniz onlar varsa izin YOK', async () => {
        localStore.dapps['dapp.example'].accounts = [TON_UQ, A]
        expect((await getPermissions()).result[0].caveats[0].value).toEqual([A])

        localStore.dapps['dapp.example'].accounts = [TON_UQ]
        expect(await getPermissions()).toEqual({ result: [] })
    })

    it('depo okuma hatasinda HATA DEGIL [] doner (sessiz sorgu)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        chrome.storage.local.get = vi.fn(async () => { throw new Error('storage down') })

        expect(await getPermissions()).toEqual({ result: [] })
    })

    it('onay penceresi ACMAZ ve diske YAZMAZ', async () => {
        await getPermissions()
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(chrome.storage.local.set).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------

// `dappsStore.updateDapps` (T3) sozlesmesini yansitan sahte: mutator haritanin DERIN KOPYASINI
// alir, yerinde degistirebilir ya da duz nesne dondurebilir; degismediyse YAZMAZ.
function fakeUpdateDapps(log) {
    return vi.fn(async (mutator) => {
        const { dapps = {} } = await chrome.storage.local.get('dapps')
        const draft = JSON.parse(JSON.stringify(dapps))
        const returned = await mutator(draft)
        const next = returned !== null && typeof returned === 'object' && !Array.isArray(returned) ? returned : draft
        if (JSON.stringify(next) === JSON.stringify(dapps)) return dapps
        log?.push('write')
        await chrome.storage.local.set({ dapps: next })
        return next
    })
}

function makeRevokeDeps(overrides = {}) {
    const log = []
    const deps = {
        notify: vi.fn(async () => { log.push('notify') }),
        rejectPendingForOrigin: vi.fn(async () => { log.push('reject'); return 1 }),
        updateDapps: fakeUpdateDapps(log),
        ...overrides,
    }
    return { deps, log }
}

async function revoke(params, { sender = dappSender, deps } = {}) {
    const made = makeRevokeDeps(deps)
    const sendResponse = vi.fn()
    await handlers.revokePermissionsDapp({ method: 'wallet_revokePermissions', params }, sender, sendResponse, made.deps)
    expect(sendResponse).toHaveBeenCalledOnce()
    return { response: sendResponse.mock.calls[0][0], ...made }
}

describe('revokePermissionsDapp: mutlu yol', () => {
    it('kayit SILINIR, sonuc null; baska siteler ve ton_dapps/solana_dapps DOKUNULMAZ', async () => {
        const { response } = await revoke([{ eth_accounts: {} }])

        expect(response).toEqual({ result: null })
        expect(localStore.dapps['dapp.example']).toBeUndefined()
        expect(localStore.dapps['other.example']).toEqual({ accounts: [A], chainId: '0x1', origin: 'https://other.example', connectedAt: 1_700_000_000_001 })
        expect(localStore.ton_dapps).toEqual({ 'ton.example': { address: 'x' } })
        expect(localStore.solana_dapps).toEqual({ 'sol.example': { accounts: ['y'] } })
    })

    it('SIRA: ONCE yaz, SONRA bekleyenleri reddet, SONRA bildir', async () => {
        const { log } = await revoke([{ eth_accounts: {} }])
        expect(log).toEqual(['write', 'reject', 'notify'])
    })

    it('bekleyen istekler HOSTNAME icin 4100 UNAUTHORIZED ile reddedilir', async () => {
        const { deps } = await revoke([{ eth_accounts: {} }])
        expect(deps.rejectPendingForOrigin).toHaveBeenCalledOnce()
        expect(deps.rejectPendingForOrigin).toHaveBeenCalledWith('dapp.example', { code: 4100, message: UNAUTHORIZED_MESSAGE })
    })

    it('dapp\'e accountsChanged([]) bildirilir (hostname, yontem, bos liste)', async () => {
        const { deps } = await revoke([{ eth_accounts: {} }])
        expect(deps.notify).toHaveBeenCalledOnce()
        expect(deps.notify).toHaveBeenCalledWith('dapp.example', 'accountsChanged', [])
    })

    it('iptalden sonra eth_accounts [] doner ve getPermissions [] doner (Lab "disconnected" akisi)', async () => {
        await revoke([{ eth_accounts: {} }])

        const accounts = vi.fn()
        await dappFunctions.handleGetAccounts({}, dappSender, accounts)
        expect(accounts).toHaveBeenCalledWith({ result: [] })
        expect(await getPermissions()).toEqual({ result: [] })
    })

    it('eth_accounts + baska anahtar birlikte: eth_accounts yine iptal edilir', async () => {
        const { response } = await revoke([{ eth_accounts: {}, eth_chainId: {} }])
        expect(response).toEqual({ result: null })
        expect(localStore.dapps['dapp.example']).toBeUndefined()
    })

    it('ESKI kayit (origin alani yok) hostname\'e duser ve silinir', async () => {
        delete localStore.dapps['dapp.example'].origin
        const { response } = await revoke([{ eth_accounts: {} }])
        expect(response).toEqual({ result: null })
        expect(localStore.dapps['dapp.example']).toBeUndefined()
    })

    it('VARSAYILAN updateDapps (GERCEK dappsStore) ile de calisir: kayit silinir, digerleri kalir', async () => {
        const sendResponse = vi.fn()
        const notify = vi.fn(async () => {})
        const rejectPendingForOrigin = vi.fn(async () => 0)
        await handlers.revokePermissionsDapp({ params: [{ eth_accounts: {} }] }, dappSender, sendResponse, { notify, rejectPendingForOrigin })

        expect(sendResponse).toHaveBeenCalledWith({ result: null })
        expect(Object.keys(localStore.dapps)).toEqual(['other.example'])
        expect(notify).toHaveBeenCalledWith('dapp.example', 'accountsChanged', [])
    })

    it('onay penceresi ACMAZ', async () => {
        await revoke([{ eth_accounts: {} }])
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('iframe: iptal GONDEREN cercevenin kaydini siler, ust sekmeninkini degil', async () => {
        localStore.dapps['widget.example'] = { accounts: [A], origin: 'https://widget.example' }
        const iframeSender = { origin: 'https://widget.example', url: 'https://widget.example/embed', tab: { url: 'https://dapp.example/news' } }
        const { deps } = await revoke([{ eth_accounts: {} }], { sender: iframeSender })

        expect(localStore.dapps['widget.example']).toBeUndefined()
        expect(localStore.dapps['dapp.example']).toBeDefined()
        expect(deps.notify).toHaveBeenCalledWith('widget.example', 'accountsChanged', [])
    })
})

describe('revokePermissionsDapp: SILMEYEN ve kodlu reddeden yollar', () => {
    it('bagli olmayan origin: sonuc null, yazma/ret/bildirim YOK', async () => {
        const { response, deps, log } = await revoke([{ eth_accounts: {} }], { sender: senderFor('https://baska.example') })

        expect(response).toEqual({ result: null })
        expect(log).toEqual([])
        expect(deps.rejectPendingForOrigin).not.toHaveBeenCalled()
        expect(deps.notify).not.toHaveBeenCalled()
        expect(Object.keys(localStore.dapps)).toEqual(['dapp.example', 'other.example'])
    })

    it('kayitli TAM origin gonderenle ESIT degilse baskasinin hibesi SILINEMEZ (baglanti noktasi / sema farki)', async () => {
        for (const origin of ['https://dapp.example:8443', 'http://dapp.example']) {
            const { response, log } = await revoke([{ eth_accounts: {} }], { sender: senderFor(origin) })
            expect(response).toEqual({ result: null })
            expect(log).toEqual([])
        }
        expect(localStore.dapps['dapp.example']).toBeDefined()
    })

    it('yalniz BASKA izin adi: sonuc null, kayit DURUR (yok sayilir)', async () => {
        const { response, log } = await revoke([{ eth_chainId: {} }])

        expect(response).toEqual({ result: null })
        expect(log).toEqual([])
        expect(localStore.dapps['dapp.example']).toBeDefined()
    })

    it.each([
        ['params yok', undefined],
        ['bos dizi', []],
        ['null', [null]],
        ['bos nesne', [{}]],
        ['dizi', [[]]],
        ['metin', ['eth_accounts']],
    ])('bozuk parametre (%s) -> -32602; hicbir sey yazilmaz ya da bildirilmez', async (_ad, params) => {
        const { response, log, deps } = await revoke(params)

        expect(response).toEqual({ error: { code: -32602, message: expect.any(String) } })
        expect(log).toEqual([])
        expect(deps.notify).not.toHaveBeenCalled()
        expect(localStore.dapps['dapp.example']).toBeDefined()
    })

    it('mesajin kendisi bos olsa da firlatmaz: -32602', async () => {
        const made = makeRevokeDeps()
        const sendResponse = vi.fn()
        await handlers.revokePermissionsDapp(undefined, dappSender, sendResponse, made.deps)

        expect(sendResponse).toHaveBeenCalledWith({ error: { code: -32602, message: expect.any(String) } })
    })

    it('deps eksikse (kablolama hatasi) SESSIZCE gecmez: -32603, kayit SILINMEZ', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const sendResponse = vi.fn()
        await handlers.revokePermissionsDapp({ params: [{ eth_accounts: {} }] }, dappSender, sendResponse, { updateDapps: fakeUpdateDapps() })

        expect(sendResponse).toHaveBeenCalledWith({ error: { code: -32603, message: 'Internal Error' } })
        expect(localStore.dapps['dapp.example']).toBeDefined()
    })

    it('hic deps verilmezse de firlatmaz: -32603', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const sendResponse = vi.fn()
        await handlers.revokePermissionsDapp({ params: [{ eth_accounts: {} }] }, dappSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ error: { code: -32603, message: 'Internal Error' } })
    })

    it('yazma basarisiz olursa -32603 doner, bekleyenler REDDEDILMEZ, dapp\'e bildirim GITMEZ (hibe hala duruyor)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const { response, deps } = await revoke([{ eth_accounts: {} }], { deps: { updateDapps: vi.fn(async () => { throw new Error('locks unavailable') }) } })

        expect(response).toEqual({ error: { code: -32603, message: 'Internal Error' } })
        expect(deps.rejectPendingForOrigin).not.toHaveBeenCalled()
        expect(deps.notify).not.toHaveBeenCalled()
    })

    it('bekleyenleri reddetme hata verirse kayit ZATEN silindi: bildirim YINE gider, sonuc null', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const { response, deps } = await revoke([{ eth_accounts: {} }], { deps: { rejectPendingForOrigin: vi.fn(async () => { throw new Error('window gone') }) } })

        expect(response).toEqual({ result: null })
        expect(deps.notify).toHaveBeenCalledWith('dapp.example', 'accountsChanged', [])
        expect(localStore.dapps['dapp.example']).toBeUndefined()
    })

    it('JSON `__proto__` anahtarli parametre: eth_accounts degil, kayit DURUR, prototip KIRLENMEZ', async () => {
        const { response } = await revoke([JSON.parse('{"__proto__":{"eth_accounts":{}}}')])

        expect(response).toEqual({ result: null })
        expect(localStore.dapps['dapp.example']).toBeDefined()
        expect({}.eth_accounts).toBeUndefined()
    })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import supported_chains from '../data/supported_chains.json'

/**
 * G4 ortak gereksinim (a) + EVM'siz aktif hesap:
 *
 * - `eth_accounts` ve `eth_requestAccounts` HIZLI YOLU, AKTIF hesabi basa alarak
 *   AYNI sirali listeyi doner (`orderGrantedAccounts`, T3). Dapp'in
 *   `accountsChanged` olayindaki liste ile `eth_accounts` bu yuzden tutarlidir;
 *   wagmi `connection.accounts[0]`'i bu siradan alir.
 * - Aktif hesabin EVM adresi YOKSA (ornegin eski TON hesabi) `eth_accounts` HER
 *   site icin `[]` doner; hibe kaydi DEGISMEZ ve diske YAZILMAZ (okuma aninda
 *   `active_account`'tan turetilir).
 */

vi.mock('./approvalThrottle', () => ({ checkApprovalThrottle: vi.fn(() => ({ ok: true })), noteApprovalRejected: vi.fn() }))

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')

const A = '0xAaaaaa0000000000000000000000000000000001'
const B = '0xBbbbbb0000000000000000000000000000000002'
const C = '0xCccccc0000000000000000000000000000000003'
const TON_UQ = 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG'

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

const lower = (list) => list.map((a) => a.toLowerCase())

async function ethAccounts() {
    const sendResponse = vi.fn()
    await dapp.handleGetAccounts({}, sender, sendResponse)
    expect(sendResponse).toHaveBeenCalledOnce()
    return sendResponse.mock.calls[0][0].result
}

async function requestAccountsFastPath() {
    const sendResponse = vi.fn()
    await dapp.handleConnectWallet({}, sender, sendResponse)
    return sendResponse
}

beforeEach(async () => {
    vi.resetModules()
    localStore = {
        currentNetwork: ETH_CHAIN,
        active_account: { key: 'k-a', address: A, name: 'Hesap A', type: 'hd' },
        dapps: { 'dapp.example': { accounts: [B, A], chainId: '0x1' } },
    }
    installChromeStub()
    dapp = await import('./dappFunctions')
})

describe('eth_accounts: aktif hesap BASA alinir', () => {
    it('kayit [B, A], aktif A -> [A, B]', async () => {
        expect(lower(await ethAccounts())).toEqual(lower([A, B]))
    })

    it('aktif hesap izinli degilse kayitli sira DEGISMEZ', async () => {
        localStore.dapps['dapp.example'].accounts = [B, C]
        expect(lower(await ethAccounts())).toEqual(lower([B, C]))
    })

    it('aktif hesap zaten ilkse liste ayni kalir', async () => {
        localStore.dapps['dapp.example'].accounts = [A, B, C]
        expect(lower(await ethAccounts())).toEqual(lower([A, B, C]))
    })

    it('adres karsilastirmasi HARF DUYARSIZ ve ayni hesap IKI KEZ listelenmez', async () => {
        localStore.dapps['dapp.example'].accounts = [B, A.toLowerCase()]
        const sonuc = await ethAccounts()

        expect(lower(sonuc)).toEqual(lower([A, B]))
        expect(sonuc).toHaveLength(2)
    })

    it('0x onekli OLMAYAN kayitlar sirali listeden de DUSER', async () => {
        localStore.dapps['dapp.example'].accounts = [TON_UQ, B, A]
        expect(lower(await ethAccounts())).toEqual(lower([A, B]))
    })

    it('aktif hesap hic okunamazsa (kayit yok) kayitli sirayla doner', async () => {
        delete localStore.active_account
        expect(lower(await ethAccounts())).toEqual(lower([B, A]))
    })

    it('bagli olmayan origin HALA bos liste alir', async () => {
        localStore.dapps = {}
        expect(await ethAccounts()).toEqual([])
    })

    it('okuma YAZMAZ: izin kaydina dokunulmaz', async () => {
        await ethAccounts()
        expect(chrome.storage.local.set).not.toHaveBeenCalled()
        expect(localStore.dapps['dapp.example'].accounts).toEqual([B, A])
    })
})

describe('eth_requestAccounts hizli yolu: eth_accounts ile AYNI sirali liste', () => {
    it('kayit [B, A], aktif A -> [A, B]; pencere ACILMAZ', async () => {
        const sendResponse = await requestAccountsFastPath()

        expect(sendResponse).toHaveBeenCalledOnce()
        expect(lower(sendResponse.mock.calls[0][0].result)).toEqual(lower([A, B]))
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('iki yol BIREBIR ayni diziyi doner (olay/eth_accounts tutarliligi)', async () => {
        const sendResponse = await requestAccountsFastPath()
        expect(sendResponse.mock.calls[0][0].result).toEqual(await ethAccounts())
    })

    it('aktif hesap izinli degilse hizli yol KAPALI: onay penceresi acilir', async () => {
        localStore.dapps['dapp.example'].accounts = [B, C]
        const sendResponse = await requestAccountsFastPath()

        expect(sendResponse).not.toHaveBeenCalled()
        expect(chrome.windows.create).toHaveBeenCalledOnce()
        expect(localStore.current_request.type).toBe('CONNECT')
    })

    it('0x onekli olmayan kayit hizli yoldan SIZMAZ', async () => {
        localStore.dapps['dapp.example'].accounts = [TON_UQ, A]
        const sendResponse = await requestAccountsFastPath()

        expect(sendResponse.mock.calls[0][0].result).toEqual([A])
    })
})

describe('EVM adresi OLMAYAN aktif hesap: eth_accounts HER site icin []', () => {
    const TON_HESAP = { key: 'k-ton', type: 'ton', name: 'TON 1', address: TON_UQ, tonAddress: TON_UQ }

    it('eski TON hesabi aktifken izinli site bile [] alir', async () => {
        localStore.active_account = TON_HESAP
        expect(await ethAccounts()).toEqual([])
    })

    it('turu bilinmeyen ama 0x ONEKSIZ adresli aktif hesap da [] (kapali-basarisiz)', async () => {
        localStore.active_account = { key: 'k-x', address: 'bilinmeyen-adres', name: 'X' }
        expect(await ethAccounts()).toEqual([])
    })

    it('hibe kaydina DOKUNULMAZ ve diske YAZILMAZ; EVM hesaba donulunce liste geri gelir', async () => {
        localStore.active_account = TON_HESAP
        await ethAccounts()
        expect(chrome.storage.local.set).not.toHaveBeenCalled()
        expect(localStore.dapps['dapp.example'].accounts).toEqual([B, A])

        localStore.active_account = { key: 'k-a', address: A, name: 'Hesap A', type: 'hd' }
        expect(lower(await ethAccounts())).toEqual(lower([A, B]))
    })

    it('EVM disi AG kurali bozulmadi: Solana aginda [] (eski davranis)', async () => {
        localStore.currentNetwork = SOLANA_CHAIN
        expect(await ethAccounts()).toEqual([])
    })
})

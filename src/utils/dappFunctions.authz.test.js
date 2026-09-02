import { describe, it, expect, vi, beforeEach } from 'vitest'
import supported_chains from '../data/supported_chains.json'

/**
 * Dapp istek kapilari (guvenlik taramasi duzeltmeleri):
 *
 * 1) KIMLIK: istegin origin'i GONDEREN CERCEVEDEN (sender.origin/sender.url)
 *    turetilmeli, ust sekmenin URL'sinden (sender.tab.url) DEGIL. Content
 *    script all_frames:true ile calisiyor: iframe'deki bir dapp'in istegi
 *    ust sayfaya atfedilirse onay ekrani GUVENILIR sitenin adini gosterir,
 *    yanit ise iframe'e gider.
 *
 * 2) YETKI: eth_sendTransaction / personal_sign yalniz BAGLI (connected)
 *    origin'lerden ve o origin'e VERILMIS hesaplar icin kabul edilmeli.
 *    Aksi halde cuzdana hic baglanmamis herhangi bir sayfa imza penceresi
 *    actirabilir ve bagli bir dapp kullanicinin BASKA hesabindan islem
 *    hazirlatabilir. Reddin EIP-1193 kodu 4100'dur.
 *
 * 3) personal_sign'in ADRES parametresi (params[1]) saklanmali (signWith)
 *    ki imza istenen hesapla atilsin, o anki aktif hesapla degil. Ayrica
 *    karde$ handler'lardaki requireEvmVm kapisi burada da olmali.
 */

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

const GRANTED = '0xAbCdEf0000000000000000000000000000000001'
const OTHER_ACCOUNT = '0x9999990000000000000000000000000000000009'

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

// Iframe'den gelen gercekci sender: origin/url GONDEREN cerceveyi, tab.url
// UST sayfayi gosterir.
const iframeSender = {
    origin: 'https://widget.example',
    url: 'https://widget.example/embed/frame.html',
    tab: { url: 'https://trusted.example/news', favIconUrl: 'https://trusted.example/fav.ico' },
}

const topSender = {
    origin: 'https://dapp.example',
    url: 'https://dapp.example/app',
    tab: { url: 'https://dapp.example/app', favIconUrl: '' },
}

beforeEach(async () => {
    vi.resetModules()
    localStore = {
        currentNetwork: ETH_CHAIN,
        active_account: { key: 'k1', address: GRANTED, name: 'Hesap 1' },
        dapps: {
            'dapp.example': { accounts: [GRANTED], chainId: '0x1' },
            'widget.example': { accounts: [GRANTED], chainId: '0x1' },
        },
    }
    installChromeStub()
    dapp = await import('./dappFunctions')
})

describe('istek kimligi: origin gonderen cerceveden turetilir (iframe atfi)', () => {
    it('sendTxDapp: iframe istegi iframe origin\'iyle kaydedilir, ust sayfayla degil', async () => {
        await dapp.sendTxDapp({ params: [{ from: GRANTED, to: OTHER_ACCOUNT, value: '0x0' }] }, iframeSender, vi.fn())
        expect(localStore.current_request.origin).toBe('https://widget.example')
    })

    it('signMessageDapp: iframe istegi iframe origin\'iyle kaydedilir', async () => {
        await dapp.signMessageDapp({ params: ['0xdeadbeef', GRANTED] }, iframeSender, vi.fn())
        expect(localStore.current_request.origin).toBe('https://widget.example')
    })

    it('handleConnectWallet: baglanti onayi iframe origin\'i icin acilir', async () => {
        localStore.dapps = {}
        await dapp.handleConnectWallet({}, iframeSender, vi.fn())
        expect(localStore.current_request.origin).toBe('https://widget.example')
    })

    it('handleConnectWallet: zaten bagli kontrolu HARF DUYARSIZDIR (pencere acilmaz)', async () => {
        // Kayit kucuk harfle tutulmus, aktif hesap checksum'lu: ayni adres.
        localStore.dapps = { 'dapp.example': { accounts: [GRANTED.toLowerCase()], chainId: '0x1' } }
        const sendResponse = vi.fn()
        await dapp.handleConnectWallet({}, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ result: [GRANTED] })
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })
})

describe('yetki kapisi: sendTxDapp', () => {
    it('bagli olmayan origin 4100 ile reddedilir; pencere ACILMAZ, kayit YAZILMAZ', async () => {
        localStore.dapps = {}
        const sendResponse = vi.fn()
        await dapp.sendTxDapp({ params: [{ from: GRANTED, to: OTHER_ACCOUNT, value: '0x0' }] }, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4100 }) })
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(localStore.current_request).toBeUndefined()
    })

    it('bagli dapp, VERILMEMIS `from` adresi isterse 4100 ile reddedilir', async () => {
        const sendResponse = vi.fn()
        await dapp.sendTxDapp({ params: [{ from: OTHER_ACCOUNT, to: GRANTED, value: '0x0' }] }, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4100 }) })
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(localStore.current_request).toBeUndefined()
    })

    it('verilmis `from` (farkli harf buyuklugunde) kabul edilir ve pencere acilir', async () => {
        const sendResponse = vi.fn()
        await dapp.sendTxDapp({ params: [{ from: GRANTED.toLowerCase(), to: OTHER_ACCOUNT, value: '0x0' }] }, topSender, sendResponse)

        expect(sendResponse).not.toHaveBeenCalled()
        expect(chrome.windows.create).toHaveBeenCalled()
        expect(localStore.current_request.txData.from).toBe(GRANTED.toLowerCase())
    })

    it('`from` verilmemisse dapp\'e verilmis ILK hesap kullanilir (aktif hesaba dusulmez)', async () => {
        const sendResponse = vi.fn()
        await dapp.sendTxDapp({ params: [{ to: OTHER_ACCOUNT, value: '0x0' }] }, topSender, sendResponse)

        expect(sendResponse).not.toHaveBeenCalled()
        expect(localStore.current_request.txData.from).toBe(GRANTED)
    })

    it('dapp\'in bildirdigi gas limiti (`gas`) kayda TASINIR (tahmin basarisizliginda tek guvenli yedek)', async () => {
        const sendResponse = vi.fn()
        await dapp.sendTxDapp({ params: [{ from: GRANTED, to: OTHER_ACCOUNT, value: '0x0', gas: '0x30d40' }] }, topSender, sendResponse)

        expect(localStore.current_request.txData.gas).toBe('0x30d40')
    })
})

describe('yetki kapisi + adres parametresi: signMessageDapp', () => {
    it('bagli olmayan origin 4100 ile reddedilir; pencere ACILMAZ', async () => {
        localStore.dapps = {}
        const sendResponse = vi.fn()
        await dapp.signMessageDapp({ params: ['0xdeadbeef', GRANTED] }, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4100 }) })
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(localStore.current_request).toBeUndefined()
    })

    it('verilmemis adres icin imza istenirse 4100 ile reddedilir', async () => {
        const sendResponse = vi.fn()
        await dapp.signMessageDapp({ params: ['0xdeadbeef', OTHER_ACCOUNT] }, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 4100 }) })
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('istenen adres (params[1]) signWith olarak SAKLANIR; mesaj da saklanir', async () => {
        const sendResponse = vi.fn()
        await dapp.signMessageDapp({ params: ['0xdeadbeef', GRANTED.toLowerCase()] }, topSender, sendResponse)

        expect(sendResponse).not.toHaveBeenCalled()
        expect(localStore.current_request.type).toBe('SIGN_MESSAGE')
        expect(localStore.current_request.messageToSign).toBe('0xdeadbeef')
        // Verilen hesap listesindeki KANONIK yazimla saklanir.
        expect(localStore.current_request.signWith).toBe(GRANTED)
    })

    it('adres verilmemisse dapp\'e verilmis ILK hesap signWith olur', async () => {
        const sendResponse = vi.fn()
        await dapp.signMessageDapp({ params: ['0xdeadbeef'] }, topSender, sendResponse)

        expect(sendResponse).not.toHaveBeenCalled()
        expect(localStore.current_request.signWith).toBe(GRANTED)
    })

    it('EVM disi ag aktifken (Solana) pencere ACILMAZ, CHAIN_NOT_EVM doner (karde$ kapilarla ayni)', async () => {
        localStore.currentNetwork = SOLANA_CHAIN
        const sendResponse = vi.fn()
        await dapp.signMessageDapp({ params: ['0xdeadbeef', GRANTED] }, topSender, sendResponse)

        // JSON-RPC "internal error" kodu NEGATIFTIR (-32603); pozitif 32603'u
        // hicbir istemci kutuphanesi tanimaz.
        expect(sendResponse).toHaveBeenCalledWith({ error: { code: -32603, message: 'CHAIN_NOT_EVM' } })
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(localStore.current_request).toBeUndefined()
    })
})

describe('eth_accounts: sessiz baglanti sorgusu', () => {
    it('bagli origin verilen hesap listesini alir', async () => {
        const sendResponse = vi.fn()
        await dapp.handleGetAccounts({}, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ result: [GRANTED] })
    })

    it('bagli olmayan origin HATA DEGIL bos liste alir (autoconnect kirilmasin)', async () => {
        localStore.dapps = {}
        const sendResponse = vi.fn()
        await dapp.handleGetAccounts({}, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ result: [] })
    })

    it('EVM disi ag aktifken bos liste doner', async () => {
        localStore.currentNetwork = SOLANA_CHAIN
        const sendResponse = vi.fn()
        await dapp.handleGetAccounts({}, topSender, sendResponse)

        expect(sendResponse).toHaveBeenCalledWith({ result: [] })
    })
})

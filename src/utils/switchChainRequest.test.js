// wallet_switchEthereumChain (EIP-3326) -- karar katmani + istek isleyicisi.
//
// KOK NEDEN: bu metot hic yazilmamisti. Bir dapp "BSC'ye gec" dediginde istek
// dagiticinin `default:` dalina dusuyor ve `{ error: 'Unknown message type' }`
// donuyordu (2026-09-11, gercek Chromium + gercek dist ile olculdu). Metin DUZ
// oldugu icin injected.js `err.code`u kopyalayamiyordu: dapp ne 4902 ne 4200
// goruyordu, kullaniciya yalnizca "ag degistirilemedi" diyebiliyordu.
//
// BU DOSYANIN OLCTUGU SEY: iki BAYAT testin olcmedigi sey. `network.test.js`in
// "desteklenmeyen aga GECILEMEZ (dapp switchEthereumChain dahil)" testi yalnizca
// store'u cagirir ve ozellik HIC YOKKEN de yesildi; `messageGate.test.js`in adi
// anan testi ise sadece "kapi bu adi engellemiyor" der. Ikisi de isleyici hakkinda
// hicbir sey kanitlamaz.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import supported_chains from '../data/supported_chains.json'
import { alreadyOnChain, findSwitchTarget, parseRequestedChainId, SWITCH_CHAIN_TYPE } from './switchChainRequest'

const ETH = supported_chains.find((c) => c.chainId === 1)
const BSC = supported_chains.find((c) => c.chainId === 56)
const TON = supported_chains.find((c) => Number(c.chainId) === -239)
const EVM_HESAP = '0xAbCdEf0000000000000000000000000000000001'

describe('parseRequestedChainId -- EIP-3326 parametre bicimi', () => {
    it('0x onekli hex kabul edilir', () => {
        expect(parseRequestedChainId([{ chainId: '0x38' }])).toBe(56)
        expect(parseRequestedChainId([{ chainId: '0x1' }])).toBe(1)
    })

    it('buyuk harfli hex de kabul edilir', () => {
        expect(parseRequestedChainId([{ chainId: '0xA4B1' }])).toBe(42161)
    })

    // BELIRSIZLIK SESSIZCE COZULMEZ. '56' metnini kabul etseydik hangisini
    // istedigini bilemezdik: onaltilik 0x56 (86) mi, ondalik 56 (BSC) mi?
    // `Number('56')` ikincisini secerdi ve dapp bambaska bir aga gecerdi.
    it("0x'siz ondalik metin REDDEDILIR (hex mi ondalik mi belirsiz)", () => {
        expect(parseRequestedChainId([{ chainId: '56' }])).toBeNull()
    })

    it('bozuk/eksik bicimler null doner', () => {
        expect(parseRequestedChainId([{ chainId: '0x' }])).toBeNull()
        expect(parseRequestedChainId([{ chainId: '0xzz' }])).toBeNull()
        expect(parseRequestedChainId([{ chainId: 56 }])).toBeNull()
        expect(parseRequestedChainId([{}])).toBeNull()
        expect(parseRequestedChainId([])).toBeNull()
        expect(parseRequestedChainId(undefined)).toBeNull()
        expect(parseRequestedChainId('0x38')).toBeNull()
        expect(parseRequestedChainId([{ chainId: '0x0' }])).toBeNull()
    })
})

describe('findSwitchTarget -- IKI soru birden sorulur', () => {
    it('desteklenen EVM zinciri kaydini doner', () => {
        expect(findSwitchTarget(56)?.name).toBe(BSC.name)
    })

    // EN KRITIK DAL. `isSupportedChain` (store/network.js) BIR EVM KAPISI
    // DEGILDIR: TON icin de `true` doner. Yalnizca ona dayanan bir uygulama,
    // bir web sayfasinin `wallet_switchEthereumChain` ile cuzdani TON'a
    // surukleyebilmesi demekti.
    it('TON DESTEKLENIR ama EVM DEGILDIR -- yine de reddedilir', () => {
        expect(supported_chains.some((c) => Number(c.chainId) === Number(TON.chainId))).toBe(true)
        expect(findSwitchTarget(Number(TON.chainId))).toBeNull()
    })

    // `isEvm` tek basina "destekleniyor mu" sorusunu SORMAZ: chainKind.js
    // bilinmeyen POZITIF bir sayiyi 'evm' sayar.
    it('listede olmayan EVM zinciri (Avalanche 43114) reddedilir', () => {
        expect(findSwitchTarget(43114)).toBeNull()
    })

    it('null/undefined guvenli', () => {
        expect(findSwitchTarget(null)).toBeNull()
        expect(findSwitchTarget(undefined)).toBeNull()
    })
})

describe('alreadyOnChain', () => {
    it('metin/sayi farki gozetmez', () => {
        expect(alreadyOnChain({ chainId: '56' }, 56)).toBe(true)
        expect(alreadyOnChain({ chainId: 56 }, 56)).toBe(true)
    })

    it('kayit yoksa false (taze kurulum: normal onay yolu islesin)', () => {
        expect(alreadyOnChain(undefined, 56)).toBe(false)
        expect(alreadyOnChain({}, 56)).toBe(false)
    })
})

// ---------------------------------------------------------------------------

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
                    return Object.fromEntries(wanted.map((k) => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async (k) => { delete localStore[k] }),
            },
        },
        runtime: { getURL: (p) => 'chrome-extension://wats/' + p },
    }
}

const sender = { origin: 'https://dapp.example', url: 'https://dapp.example/app', tab: { url: 'https://dapp.example/app', favIconUrl: 'https://dapp.example/fav.ico' } }

beforeEach(async () => {
    vi.resetModules()
    localStore = {
        currentNetwork: ETH,
        active_account: { key: 'k1', address: EVM_HESAP, name: 'Hesap 1', type: 'hd' },
        dapps: {},
    }
    installChromeStub()
    dapp = await import('./dappFunctions')
})

describe('handleSwitchChain -- onay penceresi ACILMADAN once biten dallar', () => {
    it('bozuk parametre -32602 doner ve PENCERE ACMAZ', async () => {
        const yanit = vi.fn()
        await dapp.handleSwitchChain({ params: [{ chainId: '56' }] }, sender, yanit)

        expect(yanit).toHaveBeenCalledWith({ error: { code: -32602, message: expect.any(String) } })
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(localStore.current_request).toBeUndefined()
    })

    it('desteklenmeyen zincir 4902 doner ve PENCERE ACMAZ', async () => {
        const yanit = vi.fn()
        await dapp.handleSwitchChain({ params: [{ chainId: '0xa86a' }] }, sender, yanit) // 43114

        expect(yanit.mock.calls[0][0].error.code).toBe(4902)
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    // Hata NESNE olmak zorunda: injected.js yalnizca `typeof error === 'object'`
    // oldugunda `err.code`u kopyalar. Duz metin donmek 4902'yi yok eder ve
    // dapp'in EIP-3326 dali hic calismaz -- bugunku `default:` dalinin hatasi.
    it('hata DUZ METIN degil NESNE olarak doner (kod kaybolmasin)', async () => {
        const yanit = vi.fn()
        await dapp.handleSwitchChain({ params: [{ chainId: '0xa86a' }] }, sender, yanit)

        const govde = yanit.mock.calls[0][0]
        expect(typeof govde.error).toBe('object')
        expect(typeof govde.error.code).toBe('number')
    })

    it('zaten o agdaysak null doner ve PENCERE ACMAZ', async () => {
        const yanit = vi.fn()
        await dapp.handleSwitchChain({ params: [{ chainId: '0x1' }] }, sender, yanit)

        expect(yanit).toHaveBeenCalledWith({ result: null })
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    // Onaylansa bile applyNetworkChange hesap kapisinda duracakti; dapp'e
    // "degisti" demek YALAN olurdu. Soru onay ekranindan ONCE sorulur.
    it('EVM adresi olmayan hesapta 4100 doner ve PENCERE ACMAZ', async () => {
        localStore.active_account = { key: 'k2', address: 'UQabc', name: 'TON', type: 'ton' }
        const yanit = vi.fn()
        await dapp.handleSwitchChain({ params: [{ chainId: '0x38' }] }, sender, yanit)

        expect(yanit.mock.calls[0][0].error.code).toBe(4100)
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })
})

describe('handleSwitchChain -- onay penceresi acilan yol', () => {
    // `callHandler` benzeri bir sarmalayici KULLANILMAZ: basarili yol
    // `sendResponse`u HEMEN cagirmaz, istegi `pendingRequests`e koyup
    // kullanicinin onay penceresinde bir sey yapmasini bekler (ayni uyari
    // background.evmGates.test.js:289'da yazili). Beklenen sey PENCERENIN
    // ACILMASIDIR.
    it('gecerli baska bir zincir icin onay penceresi acar', async () => {
        const yanit = vi.fn()
        dapp.handleSwitchChain({ params: [{ chainId: '0x38' }] }, sender, yanit)

        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        expect(yanit).not.toHaveBeenCalled()
    })

    it('diske yazilan kayit dogru tip ve ISTENEN zinciri tasir', async () => {
        dapp.handleSwitchChain({ params: [{ chainId: '0x38' }] }, sender, vi.fn())
        await vi.waitFor(() => expect(localStore.current_request).toBeTruthy())

        const kayit = localStore.current_request
        expect(kayit.type).toBe(SWITCH_CHAIN_TYPE)
        expect(kayit.requestedChainId).toBe(56)
        expect(kayit.requestedChainName).toBe(BSC.name)
        expect(kayit.origin).toBe('https://dapp.example')
    })

    // ALAN ADI BAGLAYICI: `chainId` yazilsaydi Header.vue:942 dapp modunda
    // (`current_request?.chainId || currentNetwork?.chainId`) HENUZ GECILMEMIS
    // agi aktif gibi cizerdi. O blok bugun olu ama biri `:dapp-mode="true"`
    // yazdigi gun canlanir.
    it("kayit `chainId` alani ACMAZ (baslik yanlis agi gostermesin)", async () => {
        dapp.handleSwitchChain({ params: [{ chainId: '0x38' }] }, sender, vi.fn())
        await vi.waitFor(() => expect(localStore.current_request).toBeTruthy())

        expect(localStore.current_request.chainId).toBeUndefined()
    })

    // BU METODUN VAR OLMA SEBEBI. Kardes isleyicilerdeki
    // `if (currentNetwork) requireEvmVm(currentNetwork)` satirini buraya
    // kopyalamak, "Solana/TON'dasin, EVM'e gec" istegini -- yani metodun en cok
    // gerektigi durumu -- CHAIN_NOT_EVM ile reddederdi.
    it('aktif ag TON iken bile EVM zincirine gecis istegi KABUL edilir', async () => {
        localStore.currentNetwork = TON
        dapp.handleSwitchChain({ params: [{ chainId: '0x38' }] }, sender, vi.fn())

        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        expect(localStore.current_request.type).toBe(SWITCH_CHAIN_TYPE)
    })
})

describe('handleAddChain -- bilerek desteklenmiyor', () => {
    it('4200 doner (4902 DEGIL: 4902 dapp i sonsuz switch/add dongusune sokar)', () => {
        const yanit = vi.fn()
        dapp.handleAddChain(yanit)

        expect(yanit).toHaveBeenCalledWith({ error: { code: 4200, message: expect.any(String) } })
    })
})

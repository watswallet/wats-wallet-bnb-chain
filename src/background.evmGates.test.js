import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import supported_chains from './data/supported_chains.json'

/**
 * Arka planin EVM'e ozel kapilari (Task 15).
 *
 * background.js bir service worker GIRIS dosyasi: hicbir sey disari vermiyor ve
 * modul kapsaminda chrome.* dinleyicileri kaydediyor. Tek ulasma yolu, chrome
 * API'sini taklit edip modulu import etmek ve kaydettigi onMessage dinleyicisini
 * yakalamak. Harness background.solanaSend.test.js'ten alindi.
 *
 * Bu dosyadaki HICBIR test resolveAccount/createWalletInstance/ethers'a
 * ULASMAZ: `requireEvmChain` her handler'in GIRISINDE, provider olusturulmadan
 * ONCE cagriliyor -- Solana'nin METIN chainId'sini gonderen bir test, gercek
 * bagimliliklarin hicbirini taklit etmeden BURADA durmali. Eger bir refactor bu
 * gate'i silerse (ya da yanlis degiskene, orn. chainId yerine `found`,
 * baglarsa) asagidaki testler `found.rpc[0]` TypeError'ina ya da baska bir
 * kod yoluna duser ve donen hata mesaji ARTIK 'CHAIN_NOT_EVM' OLMAZ.
 */

const SOLANA_CHAIN_ID = 'solana-mainnet'
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === SOLANA_CHAIN_ID)
const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'

let messageListener
let sessionStore
let localStore

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
                    const wanted = Array.isArray(keys) ? keys : [keys]
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
            // openApprovalWindow (dappFunctions.js) `window.id`i OKUR -- gercekci bir
            // donus degeri olmadan (undefined) bu TypeError'a duser ve HER onay
            // penceresi "acilamadi" testi yanlislikla YESIL kalirdi.
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

// Handler sendResponse'u ASENKRON cagirabiliyor (return true). Sozle sarmalanir.
function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
    return new Promise((resolve) => {
        const returned = messageListener(message, sender, resolve)
        if (returned !== true) resolve(undefined)
    })
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: { key: 'k1', type: 'hd', index: 0, address: '0xabc' },
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: '0xabc' }] }],
        currentNetwork: SOLANA_CHAIN,
        dapps: {},
    }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
})

describe('background.js -- swap/bridge/gonderim/durum kapilari (requireEvmChain)', () => {
    it.each([
        ['SWAP', { type: 'SWAP', message: { chainId: SOLANA_CHAIN_ID, inTokenAddress: 'a', outTokenAddress: 'b', amount: '1', slippage: 1 } }],
        ['SWAP_QUOTE', { type: 'SWAP_QUOTE', message: { chainId: SOLANA_CHAIN_ID, inTokenAddress: 'a', outTokenAddress: 'b', amount: '1', slippage: 1 } }],
        ['BRIDGE', { type: 'BRIDGE', message: { chain: SOLANA_CHAIN_ID, to: 'a', from: 'b', data: '0x', value: '0', amount: '1', amount_raw: '1' } }],
        ['BRIDGE_QUOTE', { type: 'BRIDGE_QUOTE', message: { fromChain: SOLANA_CHAIN_ID, toChain: 1, inToken: 'a', outToken: 'b', amount: '1' } }],
        ['SEND_TRANSACTION', { type: 'SEND_TRANSACTION', message: { chainId: SOLANA_CHAIN_ID, amount: '1', tx: { to: 'a', value: '0' } } }],
        ['CHECK_TX_STATUS', { type: 'CHECK_TX_STATUS', message: { chainId: SOLANA_CHAIN_ID, hash: '0xdead' } }],
        ['REVOKE_DELEGATION', { type: 'REVOKE_DELEGATION', message: { chainId: SOLANA_CHAIN_ID } }],
    ])('%s: Solana chainId GIRISTE acik CHAIN_NOT_EVM ile reddedilir', async (_ad, message) => {
        const res = await callHandler(message)
        expect(res.error).toBe('CHAIN_NOT_EVM')
    })

    // GASLESS_TOKEN_OPTIONS AYRI: `found` orada `Number(c.chainId) === Number(chainId)`
    // ile araniyor. `Number('solana-mainnet')` NaN'dir ve NaN === NaN false oldugu
    // icin Solana kaydi KENDINE BILE eslesmez -- `found` hicbir zaman Solana olamaz,
    // bu yuzden `requireEvmChain`e HIC ULASMADAN mevcut "Unsupported chain" kontrolune
    // takilir. Sonuc AYNI DERECEDE guvenli (found.rpc[0] asla okunmaz) ama mesaj
    // farkli -- bu KASITLI, `requireEvmChain(found)` burada halihazirda ERISILEMEZ
    // kod (bkz. background.js'teki yorum). Ayri tutulmasinin nedeni budur.
    it('GASLESS_TOKEN_OPTIONS: Solana chainId zaten "Unsupported chain" kontrolune takilir', async () => {
        const res = await callHandler({ type: 'GASLESS_TOKEN_OPTIONS', message: { chainId: SOLANA_CHAIN_ID, address: 'a' } })
        expect(res.error).toBe('Unsupported chain')
    })

    // F2'nin IKINCI KATMANI (kod incelemesi -- 2. tur). Yukaridaki BRIDGE_QUOTE
    // vakasi yalniz KAYNAK zinciri (fromChain) Solana oldugunda kapiyi olcuyor;
    // oysa F2'nin ta kendisi HEDEF alanidir: aktif ag (ve dolayisiyla fromChain)
    // HER ZAMAN EVM oldugu icin kaynak kapisi bu senaryoda ASLA kapanmaz.
    // Olculdu: `requireEvmChain(toFound)` background.js'ten SILINDIGINDE 110
    // dosya / 1547 testlik paketin TAMAMI YESIL kaliyordu.
    it('BRIDGE_QUOTE: kaynak EVM ama HEDEF Solana ise CHAIN_NOT_EVM ile reddedilir (F2)', async () => {
        const res = await callHandler({
            type: 'BRIDGE_QUOTE',
            message: { fromChain: 1, toChain: SOLANA_CHAIN_ID, inToken: '0xa', outToken: 'So11111111111111111111111111111111111111112', amount: '1' },
        })
        expect(res.success).toBe(false)
        expect(res.error).toBe('CHAIN_NOT_EVM')
    })

    // COZULEMEYEN bir hedef de KAPALI tarafa duser (requireEvmChain(undefined)):
    // "bilinmeyen zincire kopru kur" istegi de gecerli degil.
    it('BRIDGE_QUOTE: COZULEMEYEN hedef zincir de reddedilir', async () => {
        const res = await callHandler({
            type: 'BRIDGE_QUOTE',
            message: { fromChain: 1, toChain: 987654, inToken: '0xa', outToken: '0xb', amount: '1' },
        })
        expect(res.success).toBe(false)
        expect(res.error).toBe('CHAIN_NOT_EVM')
    })
})

// F9b'nin DIGER UCU (kod incelemesi -- 2. tur): background 'disconnect' YAYINLASA
// bile, sayfa icine enjekte edilen saglayici (src/injected.js) o metodu
// EIP-1193 olayina CEVIRMEZSE dapp hicbir sey duymaz -- ve arada test edilebilir
// bir modul YOK (injected.js bir <script> dosyasi, disari hicbir sey vermiyor,
// modul kapsaminda `window`a dokunuyor). Bu yuzden burada KAYNAK taranir: iki
// ucun BIRLIKTE ayakta durdugunu kilitlemenin tek yolu bu.
describe('src/injected.js -- disconnect/connect olaylari sayfaya AKTARILIR (F9b + Task 16a)', () => {
    const kaynak = () => readFileSync(new URL('./injected.js', import.meta.url), 'utf8')

    it('olay gecis listesi disconnect VE connect i ICERIR', () => {
        const satir = kaynak().split(String.fromCharCode(10)).find((l) => l.includes("method === 'accountsChanged'"))
        expect(satir).toBeDefined()
        expect(satir).toContain("method === 'disconnect'")
        // Task 16a: 'connect' allowlist'te YOKSA background yayinlasa bile sayfa
        // hicbir sey duymaz -- disconnect'in TERS ucu sessizce olu kalirdi.
        expect(satir).toContain("method === 'connect'")
    })

    // AYNI YUZEYIN IKINCI YARISI: isConnected() sabit `return true` idi. Olay
    // "baglanti kesildi" derken sorgunun "bagliyim" demesi, dapp'e CELISKILI iki
    // cevap vermekti.
    it('isConnected() sabit true DEGIL, izlenen duruma bakar', () => {
        const src = kaynak()
        expect(src).toMatch(/isConnected\(\)\s*\{\s*return this\._connected\s*\}/)
        expect(src).toContain('this._connected = true')
        expect(src).toContain("if (method === 'disconnect') this._connected = false")
        expect(src).toContain("if (method === 'connect') this._connected = true")
    })
})

// TASK 16a: DONUS GECISI (Solana -> EVM). `disconnect` (4901) Task 15'te eklendi
// ama karsiligi yoktu; `chainChanged` TEK BASINA yetmez -- wagmi/viem'in injected
// connector'u onDisconnect'te durumunu temizler ve onChainChanged yalnizca HALA
// BAGLIYSA is yapar, yani dapp "baglanti kesildi"de asili kalirdi.
describe('background.js -- EVM e DONUSTE connect yayilir (Task 16a)', () => {
    const TABS = [{ id: 7, url: 'https://example.com/app' }]

    const gonderilenler = () => globalThis.chrome.tabs.sendMessage.mock.calls.map(([, msg]) => msg.method)

    beforeEach(() => {
        localStore.dapps = { 'example.com': { accounts: ['0xabc'], allowedChains: [1], chainId: '0x1' } }
        globalThis.chrome.tabs.query = vi.fn(async () => TABS)
    })

    it('Solana ya gecip EVM e donunce connect + chainChanged gider (bu SIRAYLA)', async () => {
        await callHandler({ type: 'CHAIN_CHANGED', chainId: SOLANA_CHAIN_ID })
        expect(gonderilenler()).toEqual(['disconnect'])

        globalThis.chrome.tabs.sendMessage.mockClear()
        const res = await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })

        expect(res.success).toBe(true)
        // connect ONCE: connector'un durumu geri gelsin ki chainChanged bir seye
        // dokunabilsin.
        expect(gonderilenler()).toEqual(['connect', 'chainChanged'])
        expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({
            method: 'connect',
            // EIP-1193 ProviderConnectInfo: tek zorunlu alan hex chainId.
            result: { chainId: '0x89' },
        }))
    })

    // EVM DAVRANISI DEGISMEDI: normal bir zincir degisiminde connect YAYILMAZ.
    // Kosulsuz yaymak connector'lari her geciste yeniden baglatirdi.
    it('EVM -> EVM geciste connect YAYILMAZ (regresyon)', async () => {
        const res = await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })

        expect(res.success).toBe(true)
        expect(gonderilenler()).toEqual(['chainChanged'])
    })

    it('donusten SONRAKI gecislerde connect TEKRAR yayilmaz (bayrak temizlenir)', async () => {
        await callHandler({ type: 'CHAIN_CHANGED', chainId: SOLANA_CHAIN_ID })
        await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })

        globalThis.chrome.tabs.sendMessage.mockClear()
        await callHandler({ type: 'CHAIN_CHANGED', chainId: 1 })

        expect(gonderilenler()).toEqual(['chainChanged'])
    })

    // Bayrak DISKTE (chrome.storage.session) tutulur: MV3 service worker iki gecis
    // ARASINDA uyuyabilir ve modul kapsamindaki bir degisken kaybolurdu.
    it('bayrak storage.session e yazilir (service worker uykusundan sag cikar)', async () => {
        await callHandler({ type: 'CHAIN_CHANGED', chainId: SOLANA_CHAIN_ID })
        expect(sessionStore.evmProviderDisconnected).toBe(true)

        await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })
        expect(sessionStore.evmProviderDisconnected).toBe(false)
    })

    // storage.session eski Chrome surumlerinde yok. Bayrak okunamazsa davranis
    // Task 16a oncesine (yalniz chainChanged) DUSER, ariza uretmez.
    it('storage.session patlarsa chainChanged YINE gider', async () => {
        const hataKaydi = vi.spyOn(console, 'error').mockImplementation(() => {})
        globalThis.chrome.storage.session.get = vi.fn(async () => { throw new Error('no session storage') })
        globalThis.chrome.storage.session.set = vi.fn(async () => { throw new Error('no session storage') })

        await callHandler({ type: 'CHAIN_CHANGED', chainId: SOLANA_CHAIN_ID })
        globalThis.chrome.tabs.sendMessage.mockClear()
        const res = await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })

        expect(res.success).toBe(true)
        expect(gonderilenler()).toEqual(['chainChanged'])
        hataKaydi.mockRestore()
    })
})

describe('background.js -- dapp fonksiyonlari currentNetwork HENUZ DISKTE YOKKEN self-heal eder (F1)', () => {
    // KOK NEDEN (F1, kod incelemesi): App.vue yalniz ILK popup acilisinda 'eth'
    // varsayilanini DISKE yazar. Kullanici onboarding'i bitirip popup'i HIC
    // ACMADAN dogrudan bir dapp'e giderse `currentNetwork` DISKTE hic yok --
    // `requireEvmChain(undefined)` kosulsuz cagrilirsa taze bir cuzdan (hala
    // varsayilan Ethereum'da) HER dapp cagrisina CHAIN_NOT_EVM donerdi ve
    // kurtarma "popup'i bir kez ac" tahminini gerektirirdi.
    // NOT: burada callHandler KULLANILMAZ. Basarili yol sendResponse'u HEMEN
    // cagirmaz -- openApprovalWindow istegi `pendingRequests`e KOYAR ve kullanicinin
    // onay penceresinde bir sey yapmasini bekler (bkz. resolvePendingRequest).
    // callHandler'in Promise'i bu yuzden hic cozulmez; burada yalniz KAPININ
    // ACIK oldugu (pencere acmaya calisildigi ve `sendResponse`in bir HATAYLA
    // HEMEN cagrilmadigi) dogrulanir.
    it('eth_requestAccounts: currentNetwork DISKTE YOKKEN dapp normal baglanir (onay penceresi ACILIR)', async () => {
        delete localStore.currentNetwork
        let immediateResponse
        messageListener(
            { type: 'eth_requestAccounts', message: {} },
            { tab: { url: 'https://dapp.example/', favIconUrl: '' } },
            (r) => { immediateResponse = r },
        )

        await vi.waitFor(() => { expect(globalThis.chrome.windows.create).toHaveBeenCalledOnce() })
        expect(immediateResponse?.error).toBeUndefined()
    })

    it('eth_sendTransaction: currentNetwork DISKTE YOKKEN onay penceresi normal ACILIR', async () => {
        delete localStore.currentNetwork
        // Yetki kapisi (dappFunctions.authz.test.js): pencere yalniz BAGLI
        // origin'lere acilir; bu testin konusu zincir kapisi, baglanti kurulu verilir.
        localStore.dapps = { 'dapp.example': { accounts: ['0xabc'], allowedChains: [1], chainId: '0x1' } }
        let immediateResponse
        messageListener(
            { type: 'eth_sendTransaction', params: [{ from: '0xabc', to: '0xdef', value: '0x0' }] },
            { tab: { url: 'https://dapp.example/', favIconUrl: '' } },
            (r) => { immediateResponse = r },
        )

        await vi.waitFor(() => { expect(globalThis.chrome.windows.create).toHaveBeenCalledOnce() })
        expect(immediateResponse?.error).toBeUndefined()
    })

    it('eth_chainId: currentNetwork DISKTE YOKKEN varsayilan "0x1" doner (CHAIN_NOT_EVM DEGIL)', async () => {
        delete localStore.currentNetwork

        const res = await callHandler({ type: 'eth_chainId' })

        expect(res.error).toBeUndefined()
        expect(res.result).toBe('0x1')
    })
})

describe('background.js -- eth_requestAccounts/eth_sendTransaction/eth_chainId (dappFunctions)', () => {
    it('eth_requestAccounts: aktif ag Solana ise dapp CHAIN_NOT_EVM alir, onay penceresi ACILMAZ', async () => {
        const res = await callHandler(
            { type: 'eth_requestAccounts', message: {} },
            { tab: { url: 'https://dapp.example/', favIconUrl: '' } },
        )
        expect(res.error.message).toBe('CHAIN_NOT_EVM')
        expect(globalThis.chrome.windows.create).not.toHaveBeenCalled()
    })

    it('eth_sendTransaction: aktif ag Solana ise dapp CHAIN_NOT_EVM alir, onay penceresi ACILMAZ', async () => {
        const res = await callHandler(
            { type: 'eth_sendTransaction', params: [{ from: '0xabc', to: '0xdef', value: '0x0' }] },
            { tab: { url: 'https://dapp.example/', favIconUrl: '' } },
        )
        expect(res.error.message).toBe('CHAIN_NOT_EVM')
        expect(globalThis.chrome.windows.create).not.toHaveBeenCalled()
    })

    it('eth_chainId: aktif ag Solana ise GECERSIZ hex (0xsolana-mainnet) YERINE acik hata doner', async () => {
        const res = await callHandler({ type: 'eth_chainId' })
        expect(res.error.message).toBe('CHAIN_NOT_EVM')
        expect(res.result).toBeUndefined()
    })

    it('eth_chainId: EVM aktifken degismedi (regresyon)', async () => {
        localStore.currentNetwork = { chainId: 137, name: 'Polygon', rpc: [{ url: 'https://polygon-rpc.com' }] }
        const res = await callHandler({ type: 'eth_chainId' })
        expect(res.result).toBe('0x' + (137).toString(16))
    })

    // eth_accounts: her dapp sayfa yuklenirken sessiz baglanti sorgusu yapar.
    // Switch'te karsiligi yokken 'Unknown message type' donuyor ve wagmi/ethers
    // autoconnect'i saglayiciyi arizali sayip iptal ediyordu.
    it('eth_accounts: bagli olmayan origin icin HATA DEGIL bos liste doner', async () => {
        const res = await callHandler({ type: 'eth_accounts' }, { origin: 'https://dapp.example', url: 'https://dapp.example/', tab: { url: 'https://dapp.example/' } })
        expect(res.error).toBeUndefined()
        expect(res.result).toEqual([])
    })

    it('eth_accounts: bagli origin verilen hesaplari alir', async () => {
        localStore.currentNetwork = { chainId: 137, name: 'Polygon', rpc: [{ url: 'https://polygon-rpc.com' }] }
        localStore.dapps = { 'dapp.example': { accounts: ['0xabc'], allowedChains: [137], chainId: '0x89' } }
        const res = await callHandler({ type: 'eth_accounts' }, { origin: 'https://dapp.example', url: 'https://dapp.example/', tab: { url: 'https://dapp.example/' } })
        expect(res.result).toEqual(['0xabc'])
    })

    // GLOBAL KISIT (kod incelemesi -- 2. tur): F1 bu gorevin GERCEK riskinin
    // "EVM yolunu bozmak" oldugunu KANITLADI. Solana ve bos-depo dallari
    // yukarida kilitli; NORMAL bir EVM zincirinde dapp yolunun HALA acildigi
    // ayrica olculur -- kapi yanlislikla "her zaman kapali"ya donerse
    // (orn. requireEvmChain'in kosulu tersine cevrilirse) bu iki test duser.
    // callHandler KULLANILMAZ: basarili yol sendResponse'u HEMEN cagirmaz
    // (bkz. F1 blogundaki not), istek pendingRequests'e KONUR.
    it('eth_requestAccounts: NORMAL bir EVM zincirinde onay penceresi ACILIR (regresyon)', async () => {
        localStore.currentNetwork = { chainId: 137, name: 'Polygon', rpc: [{ url: 'https://polygon-rpc.com' }] }
        let immediateResponse
        messageListener(
            { type: 'eth_requestAccounts', message: {} },
            { tab: { url: 'https://dapp.example/', favIconUrl: '' } },
            (r) => { immediateResponse = r },
        )

        await vi.waitFor(() => { expect(globalThis.chrome.windows.create).toHaveBeenCalledOnce() })
        expect(immediateResponse?.error).toBeUndefined()
    })

    it('eth_sendTransaction: NORMAL bir EVM zincirinde onay penceresi ACILIR (regresyon)', async () => {
        localStore.currentNetwork = { chainId: 137, name: 'Polygon', rpc: [{ url: 'https://polygon-rpc.com' }] }
        // Yetki kapisi: pencere yalniz BAGLI origin'lere acilir (konu zincir kapisi).
        localStore.dapps = { 'dapp.example': { accounts: ['0xabc'], allowedChains: [137], chainId: '0x89' } }
        let immediateResponse
        messageListener(
            { type: 'eth_sendTransaction', params: [{ from: '0xabc', to: '0xdef', value: '0x0' }] },
            { tab: { url: 'https://dapp.example/', favIconUrl: '' } },
            (r) => { immediateResponse = r },
        )

        await vi.waitFor(() => { expect(globalThis.chrome.windows.create).toHaveBeenCalledOnce() })
        expect(immediateResponse?.error).toBeUndefined()
    })
})

// KOD INCELEMESI (turu 2, A): `rpc` dizisi BOS olan GERCEK bir EVM kaydi.
// Task 15 ONCESINDE bu kayitla uc dapp giris noktasi da NORMAL calisiyordu;
// requireEvmChain (uc noktasi da ister) kullanilinca UCU DE CHAIN_NOT_EVM
// donmeye baslamisti -- olculebilir bir EVM davranis degisimi ve evmGates.js'in
// kendi tasarimiyla (dapp/buy/ats RPC'den BAGIMSIZ) dogrudan CELISKI. Kapi artik
// requireEvmVm; asagidakiler o kaydin yeniden calistigini kilitler.
describe('background.js -- RPC ucu OLMAYAN EVM kaydinda dapp yolu CALISIR (A)', () => {
    const RPCSIZ_EVM = { chainId: 137, name: 'Polygon', rpc: [] }

    it('eth_chainId: CHAIN_NOT_EVM DEGIL, dogru hex (0x89) doner', async () => {
        localStore.currentNetwork = RPCSIZ_EVM

        const res = await callHandler({ type: 'eth_chainId' })

        expect(res.error).toBeUndefined()
        expect(res.result).toBe('0x89')
    })

    it('eth_requestAccounts: onay penceresi ACILIR', async () => {
        localStore.currentNetwork = RPCSIZ_EVM
        let immediateResponse
        messageListener(
            { type: 'eth_requestAccounts', message: {} },
            { tab: { url: 'https://dapp.example/', favIconUrl: '' } },
            (r) => { immediateResponse = r },
        )

        await vi.waitFor(() => { expect(globalThis.chrome.windows.create).toHaveBeenCalledOnce() })
        expect(immediateResponse?.error).toBeUndefined()
    })

    it('eth_requestAccounts: ZATEN BAGLIYSA hesabi HEMEN doner (pencere acilmaz)', async () => {
        localStore.currentNetwork = RPCSIZ_EVM
        localStore.dapps = { 'dapp.example': { accounts: ['0xabc'], allowedChains: [137], chainId: '0x89' } }

        const res = await callHandler(
            { type: 'eth_requestAccounts', message: {} },
            { tab: { url: 'https://dapp.example/', favIconUrl: '' } },
        )

        expect(res.error).toBeUndefined()
        expect(res.result).toEqual(['0xabc'])
        expect(globalThis.chrome.windows.create).not.toHaveBeenCalled()
    })

    it('eth_sendTransaction: onay penceresi ACILIR', async () => {
        localStore.currentNetwork = RPCSIZ_EVM
        // Yetki kapisi: pencere yalniz BAGLI origin'lere acilir (konu zincir kapisi).
        localStore.dapps = { 'dapp.example': { accounts: ['0xabc'], allowedChains: [137], chainId: '0x89' } }
        let immediateResponse
        messageListener(
            { type: 'eth_sendTransaction', params: [{ from: '0xabc', to: '0xdef', value: '0x0' }] },
            { tab: { url: 'https://dapp.example/', favIconUrl: '' } },
            (r) => { immediateResponse = r },
        )

        await vi.waitFor(() => { expect(globalThis.chrome.windows.create).toHaveBeenCalledOnce() })
        expect(immediateResponse?.error).toBeUndefined()
    })

})

describe('background.js -- CHAIN_CHANGED Solana ya gecince chainChanged YAYMAZ, disconnect YAYAR (F9)', () => {
    it('Solana ya gecis: gecersiz hex chainChanged olarak YAYILMAZ, dapps kaydi bozulmaz, disconnect gider', async () => {
        localStore.dapps = { 'example.com': { accounts: ['0xabc'], allowedChains: [1], chainId: '0x1' } }
        globalThis.chrome.tabs.query = vi.fn(async () => [{ id: 7, url: 'https://example.com/app' }])

        const res = await callHandler({ type: 'CHAIN_CHANGED', chainId: SOLANA_CHAIN_ID })

        expect(res.success).toBe(true)
        // dapps[hostname].chainId GECERSIZ bir hex'e ('0xsolana-mainnet') YAZILMADI.
        expect(localStore.dapps['example.com'].chainId).toBe('0x1')
        // F9b: "hicbir sey yapma" yerine EIP-1193 disconnect (4901) yayilir --
        // aksi halde dapp "Connected — BNB Smart Chain" gosterirken eth_chainId
        // ARTIK CHAIN_NOT_EVM donuyor olurdu.
        expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({
            method: 'disconnect',
            result: expect.objectContaining({ code: 4901 }),
        }))
        expect(globalThis.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(7, expect.objectContaining({ method: 'chainChanged' }))
    })

    it('EVM zincir degisimi HALA calisir (regresyon)', async () => {
        localStore.dapps = { 'example.com': { accounts: ['0xabc'], allowedChains: [1], chainId: '0x1' } }

        const res = await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })

        expect(res.success).toBe(true)
        expect(localStore.dapps['example.com'].chainId).toBe('0x' + (137).toString(16))
    })

    // KOD INCELEMESI (turu 2, B): F9a'nin `===` -> isSameChainId GENISLEMESI
    // olculdugunde HICBIR test tarafindan korunmuyordu (kati esitlige geri
    // dondurmek 23/23 YESIL kaliyordu). METIN bir EVM kimligi TAM OLARAK bu
    // genislemenin var olma sebebi: kati esitlikle '137' hicbir kayda eslesmez,
    // `found` undefined kalir ve yayin SESSIZCE atlanirdi.
    //
    // AYNI test hex'in KAYNAGINI da kilitler: '137'.toString(16) -- radix
    // YOKSAYILIR -- '0x137' uretirdi; dogru cevap '0x89'. Bu yuzden hex artik
    // ham mesajdan degil COZULEN KAYITTAN uretiliyor.
    it('METIN bir EVM chainId ("137") cozulur ve DOGRU hex (0x89) yayilir', async () => {
        localStore.dapps = { 'example.com': { accounts: ['0xabc'], allowedChains: [1], chainId: '0x1' } }
        globalThis.chrome.tabs.query = vi.fn(async () => [{ id: 7, url: 'https://example.com/app' }])

        const res = await callHandler({ type: 'CHAIN_CHANGED', chainId: '137' })

        expect(res.success).toBe(true)
        expect(localStore.dapps['example.com'].chainId).toBe('0x89')
        expect(globalThis.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({
            method: 'chainChanged',
            result: '0x89',
        }))
    })

    it('cozulemeyen bir chainId sessizce basari SAYILMAZ (loglanir, success:false)', async () => {
        const hataKaydi = vi.spyOn(console, 'error').mockImplementation(() => {})

        const res = await callHandler({ type: 'CHAIN_CHANGED', chainId: 999999 })

        expect(res.success).toBe(false)
        expect(hataKaydi).toHaveBeenCalled()
        hataKaydi.mockRestore()
    })
})

// EVM dapp PROTOKOL UYUMLULUK testleri -- dapp'in TELDEN GERCEKTEN gordugu sey
// (sonuc, hata KODU, olay) ile arka planin/ekranin gercek davranisi arasindaki
// dikisi kilitler.
//
// NEDEN BU DOSYA VAR: ekran testleri ekranin NE GONDERDIGINI, arka plan testleri
// isleyicinin NE YAPTIGINI olcer; ikisinin BIRBIRINE baktigi dikis (ekranin
// gonderdigi mesaj ile isleyicinin bekledigi mesaj) hicbir yerde olculmuyordu --
// TON'da ayni bosluk uc hata sizdirdi (bkz. tonConnectProtocolConformance.test.js).
// Bu dosya zinciri BIR surecte GERCEKTEN kurar (bkz. test-utils/dappProtocolHarness.js):
// GERCEK injected.js -> GERCEK content.js -> GERCEK background.js -> GERCEK onay ekrani
// (Sign.vue / SignTypedData.vue SSR), hepsi AYNI chrome taklidini okur.
//
// ETIKETLER (test basliklarinda): bu dosya bagimlilik sirasina gore yesile doner.
//   (etiketsiz)  T5 + T11 ile yesil olur
//   [T8]         T8 (dappFunctions parametre korumasi, sirali hesaplar) gerekir
//   [T14a][T8]   IKISI BIRDEN gerekir (EVM'siz TON hesabi: accountsChanged([]) T14a, eth_accounts [] T8)
//   [T14a]       T14a (typed data case'i, default: 4200, active_account kapisi) gerekir
//   [T14b]       T14b (wallet_getPermissions / wallet_revokePermissions) gerekir
// Siralamayi `npx vitest run src/evmDappProtocolConformance.test.js -t "<etiket>"` ile sec.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Ekran bilesenleri zincirinde modul ust duzeyinde `chrome.windows.onRemoved.addListener`
// cagiran dosyalar olabilir; import ANINDA calisir (bkz. ConnectDapp.ssr.test.js).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createWalletClient, custom, hashTypedData, recoverMessageAddress, recoverTypedDataAddress } from 'viem'
import { TypedDataEncoder, verifyMessage as ethersVerifyMessage, verifyTypedData as ethersVerifyTypedData } from 'ethers'
import supported_chains from './data/supported_chains.json'
import { createDappEnv } from './test-utils/dappProtocolHarness.js'
import Sign from './components/dapp/Sign.vue'
import SignTypedData from './components/dapp/SignTypedData.vue'

const SCREENS = {
    SIGN_MESSAGE: { component: Sign, name: 'Sign', page: 'sign_message' },
    SIGN_TYPED_DATA: { component: SignTypedData, name: 'SignTypedData', page: 'sign_typed_data' },
}

// Spec Ek B: Lab'in typed data yuku, BIREBIR (ikinci arguman JSON STRING, EIP712Domain
// `types` icinde GELIYOR, domain.chainId sayi).
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
const { EIP712Domain: _domainTypes, ...LAB_TYPES_WITHOUT_DOMAIN } = LAB_TYPED_DATA.types

// DAI tipi permit: `allowed` bool olmali. JSON string "false" ethers'in bool
// kodlayicisinda DOGRU olarak kodlanir (spec G1/2, BLOCKER): siki yaprak gecisi
// bunu pencere ACILMADAN -32602 ile reddetmeli.
const daiPermit = (holder, overrides = {}) => ({
    domain: { name: 'Dai Stablecoin', version: '1', chainId: 1, verifyingContract: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
    types: {
        EIP712Domain: LAB_TYPED_DATA.types.EIP712Domain,
        Permit: [
            { name: 'holder', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'expiry', type: 'uint256' },
            { name: 'allowed', type: 'bool' },
        ],
    },
    primaryType: 'Permit',
    message: { holder, spender: '0x1111111111111111111111111111111111111111', nonce: 0, expiry: 0, allowed: true, ...overrides },
})

const TON_ACCOUNT = { key: 'acc-ton', type: 'ton', address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG', name: 'TON 1' }
const TON_CHAIN = supported_chains.find((c) => c.kind === 'ton' && c.chainId === -239)

// ---------------------------------------------------------------------------
// yardimcilar
// ---------------------------------------------------------------------------
let env

async function setup(options = {}) {
    env = await createDappEnv({ screens: SCREENS, ...options })
    return env
}

// Ilk ortam kurulumu SOGUKTUR (PBKDF2 + background.js'in tum bagimlilik zincirinin ilk
// donusumu: ~10 sn). Isinma, ilk testin 15 sn sinirina carpmasini onler.
beforeAll(async () => {
    const warm = await createDappEnv({ screens: SCREENS })
    warm.dispose()
}, 60_000)

afterEach(() => {
    try {
        // HERMETIK: hicbir test gercek aga (RPC, uretim sunucusu) cikmamali.
        if (env) expect(env.fetchSpy, 'testler hermetik olmali: fetch cagrilmamali').not.toHaveBeenCalled()
    } finally {
        env?.dispose()
        env = undefined
        vi.useRealTimers()
    }
})

/** Her hata nesnesinde SAYISAL kod: viem kodsuz hatayi UnknownRpcError (-1) sayip yeniden dener. */
function expectRpcError(error, code) {
    expect(error, 'hata nesnesi').toBeInstanceOf(Error)
    expect(Number.isInteger(error.code), `sayisal code bekleniyordu, gelen: ${error.code} (${error.message})`).toBe(true)
    if (code !== undefined) expect(error.code).toBe(code)
}

const viemClient = (retryCount = 0) => createWalletClient({ transport: custom(env.provider, { retryCount }) })

/**
 * Pencere ACILMADAN reddedilmesi gereken istek. Pencere acilirsa (kapi eksik) 15 sn
 * beklemeden HEMEN patlar: acilan pencere istegi sonsuza kadar askida tutardi.
 */
async function expectRejectedWithoutWindow(method, params, code) {
    const outcome = env.request(method, params).then(() => ({ resolved: true }), (error) => ({ error }))
    await env.settle(40)
    expect(env.windowsCreated, `${method}: onay penceresi ACILMAMALIYDI`).toEqual([])
    const result = await outcome
    expect(result.error, `${method} reddedilmeliydi`).toBeDefined()
    expectRpcError(result.error, code)
    expect(env.currentRequest(), 'current_request yazilmamali').toBeUndefined()
    return result.error
}

/** Hicbir onay penceresi acilmadi, diskte onay kaydi yok. */
function expectNoApproval() {
    expect(env.windowsCreated, 'onay penceresi acilmamali').toEqual([])
    expect(env.currentRequest(), 'current_request yazilmamali').toBeUndefined()
}

// SignTypedData "Imzala" dugmesi mount sonrasi ~700 ms kilitlidir (spec N7/1, T11).
// Kilit atlatilmaz: test SAHTE zamanlayici (useFakeTimers) kurar ve zamani ILERLETIR.
const SIGN_LOCK_MS = 700
async function approve(screen) {
    await vi.advanceTimersByTimeAsync(SIGN_LOCK_MS + 100)
    return screen.state.sign()
}

// ---------------------------------------------------------------------------
// Ek A -- Lab'in cagri dizileri (T5 + T11 ile yesil)
// ---------------------------------------------------------------------------
describe('Ek A -- yukleme, baglanma, personal_sign (GERCEK ekran, GERCEK arka plan)', () => {
    it('A1 yukleme: eth_accounts iki kez [] doner, eth_chainId 0x1', async () => {
        await setup({ connected: false })

        expect(await env.request('eth_accounts')).toEqual([])
        expect(await env.request('eth_accounts')).toEqual([])
        expect(await env.request('eth_chainId')).toBe('0x1')
        expect(env.hanging()).toEqual([])
    })

    it('A2 baglan: eth_requestAccounts onay penceresi acar, onay sonrasi hesap + tam origin kaydi', async () => {
        await setup({ connected: false })

        const accounts = env.request('eth_requestAccounts')
        await env.simulateConnectApproval([env.accountA.address])

        expect(await accounts).toEqual([env.accountA.address])
        expect(env.store.dapps['app.example'].accounts).toEqual([env.accountA.address])
        expect(env.store.dapps['app.example'].origin).toBe('https://app.example')
        expect(await env.request('eth_accounts')).toEqual([env.accountA.address])
        expect(await env.request('eth_chainId')).toBe('0x1')
        expect(env.hanging()).toEqual([])
    })

    it('A3 personal_sign: viem signMessage -> GERCEK Sign ekrani -> imza HESABA ait; dikis kilitli', async () => {
        await setup()
        const signing = viemClient().signMessage({ account: env.accountA.address, message: 'Hello AppKit!' })
        signing.catch(() => {})
        await env.waitForApproval('SIGN_MESSAGE')
        const requestId = env.currentRequest().id

        const screen = await env.openApprovalScreen()
        await screen.state.sign()
        const signature = await signing

        expect(ethersVerifyMessage('Hello AppKit!', signature)).toBe(env.accountA.address)
        expect(await recoverMessageAddress({ message: 'Hello AppKit!', signature })).toBe(env.accountA.address)

        // DIKIS: ekranin gonderdigi ile islemcinin bekledigi.
        const [signMsg] = env.uiMessages('SIGN')
        expect(signMsg.message.message.account.address).toBe(env.accountA.address)
        const [success] = env.uiMessages('SIGN_MESSAGE_SUCCESS')
        expect(success.message.requestId).toBe(requestId)
        expect(success.message.data.result).toBe(signature)

        expect(env.currentRequest(), 'cevaplanan istegin kaydi temizlenmeli').toBeUndefined()
        expect(screen.page.currentPage).toBe('home')
        expect(env.hanging()).toEqual([])
    })

    it('A3b personal_sign Reddet: 4001 + mevcut ret metni; imza HIC istenmez', async () => {
        await setup()
        const pending = env.requestError('personal_sign', ['0x48656c6c6f', env.accountA.address])
        await env.waitForApproval('SIGN_MESSAGE')

        const screen = await env.openApprovalScreen()
        await screen.state.cancel()
        const error = await pending

        expectRpcError(error, 4001)
        expect(error.message).toBe('Sign Request cancelled by user.')
        expect(env.uiMessages('SIGN')).toEqual([])
        expect(env.hanging()).toEqual([])
    })

    it('A3c personal_sign imza HATASI (onay aninda cuzdan kilitlendi): -32603, kullanici reddi (4001) DEGIL [T5]', async () => {
        await setup()
        const pending = env.requestError('personal_sign', ['0x48656c6c6f', env.accountA.address])
        await env.waitForApproval('SIGN_MESSAGE')
        const screen = await env.openApprovalScreen()

        env.lock()
        await screen.state.sign()
        const error = await pending

        expectRpcError(error, -32603)
        expect(error.message).not.toMatch(/reject|cancel|denied/i)
        expect(env.hanging()).toEqual([])
    })

    it('A3d personal_sign: onay penceresi KAPATILIRSA 4001 "User closed the window."', async () => {
        await setup()
        const pending = env.requestError('personal_sign', ['0x48656c6c6f', env.accountA.address])
        await env.waitForApproval('SIGN_MESSAGE')

        await env.closeApprovalWindow()
        const error = await pending

        expectRpcError(error, 4001)
        expect(error.message).toBe('User closed the window.')
        expect(env.currentRequest()).toBeUndefined()
        expect(env.hanging()).toEqual([])
    })

    it('A3e personal_sign: dapp\'e VERILMEMIS hesap icin 4100, pencere ACILMAZ', async () => {
        await setup()

        const error = await env.requestError('personal_sign', ['0x48656c6c6f', env.accountB.address])

        expectRpcError(error, 4100)
        expectNoApproval()
    })

    it('A4 eth_sendTransaction: bagli olmayan sayfa 4100, pencere ACILMAZ', async () => {
        await setup({ connected: false })

        const error = await env.requestError('eth_sendTransaction', [{ from: env.accountA.address, to: env.accountB.address, value: '0xf4240', gas: '0x5208' }])

        expectRpcError(error, 4100)
        expectNoApproval()
    })

    it('A5 aktif ag EVM degilken (TON): eth_chainId, personal_sign, eth_sendTransaction 4901', async () => {
        await setup()
        env.seed({ currentNetwork: TON_CHAIN })

        expectRpcError(await env.requestError('eth_chainId'), 4901)
        expectRpcError(await env.requestError('personal_sign', ['0x48656c6c6f', env.accountA.address]), 4901)
        expectRpcError(await env.requestError('eth_sendTransaction', [{ from: env.accountA.address, to: env.accountB.address, value: '0x1' }]), 4901)
        expectNoApproval()
    })
})

describe('Ek A -- zincir gecisi (dapp tarafi ve cuzdan tarafi)', () => {
    it('A6 dapp tarafi: desteklenmeyen zincir 4902, wallet_addEthereumChain 4200 (wagmi bunu "Switch declined" yapar)', async () => {
        await setup()

        expectRpcError(await env.requestError('wallet_switchEthereumChain', [{ chainId: '0x144' }]), 4902)
        expectRpcError(await env.requestError('wallet_addEthereumChain', [{ chainId: '0x144' }]), 4200)
        expectNoApproval()
    })

    it('A6b wallet_switchEthereumChain: bozuk parametre -32602, zaten o zincirdeyken null', async () => {
        await setup()

        expectRpcError(await env.requestError('wallet_switchEthereumChain', [{}]), -32602)
        expect(await env.request('wallet_switchEthereumChain', [{ chainId: '0x1' }])).toBeNull()
        expectNoApproval()
    })

    it('A6c viem switchChain({id: 324}): desteklenmeyen zincir SwitchChainError, code 4902 KORUNUR (wagmi/AppKit bunu "ag yok" diye okur); pencere ACILMAZ', async () => {
        await setup()

        const error = await viemClient().switchChain({ id: 324 }).then(() => null, (e) => e)

        expect(error, 'switchChain reddedilmeliydi').not.toBeNull()
        expectRpcError(error, 4902)
        expect(error.name).toBe('SwitchChainError')
        expectNoApproval()
        expect(env.hanging()).toEqual([])
    })

    it('A7 cuzdan tarafi gecis (OP -> Polygon): chainChanged hex olayi dapp\'e ulasir, eth_chainId tutarli', async () => {
        await setup()

        await env.switchNetworkFromUi(137)

        expect(env.eventsOf('chainChanged')).toEqual(['0x89'])
        expect(await env.request('eth_chainId')).toBe('0x89')
        expect(env.store.dapps['app.example'].chainId).toBe('0x89')
    })

    it('A7b EVM-disi aga gecis: 4901\'li disconnect; donuste connect + chainChanged (bu SIRAYLA)', async () => {
        await setup()

        await env.switchNetworkFromUi(-239)
        expect(env.providerEvents.map((e) => e.event)).toEqual(['disconnect'])
        expect(env.providerEvents[0].detail).toEqual({ code: 4901, message: 'Chain Disconnected' })
        expect(env.provider.isConnected()).toBe(false)
        expectRpcError(await env.requestError('eth_chainId'), 4901)

        await env.switchNetworkFromUi(137)
        expect(env.providerEvents.map((e) => e.event)).toEqual(['disconnect', 'connect', 'chainChanged'])
        expect(env.provider.isConnected()).toBe(true)
        expect(await env.request('eth_chainId')).toBe('0x89')
    })
})

describe('Ek A -- hata kodu hijyeni ve askida kalan istek YOK', () => {
    it('A4b viem sendTransaction: bagli olmayan sayfa 4100; viem hatayi TransactionExecutionError ile SARAR, kod cause zincirinde; pencere ACILMAZ', async () => {
        await setup({ connected: false })

        const error = await viemClient()
            .sendTransaction({ account: env.accountA.address, to: env.accountB.address, value: 1n, chain: null })
            .then(() => null, (e) => e)

        expect(error, 'sendTransaction reddedilmeliydi').not.toBeNull()
        // viem sayisal kodu SARMALAYICIDA degil, nedende (UnauthorizedProviderError) tasir:
        // wagmi/AppKit `error.walk()` ile ayni zincire bakar.
        expectRpcError(error.walk((e) => Number.isInteger(e.code)), 4100)
        expectNoApproval()
        expect(env.hanging()).toEqual([])
    })

    it('A3f cuzdan KILITLI baslarsa (F14 yerel; spec bolum 8 duzeltilmis satiri): onay penceresi YINE acilir, istek bekler, 4100 YOK; Login sonrasi imza tamamlanir', async () => {
        await setup({ unlocked: false })
        const signing = env.request('personal_sign', ['0x48656c6c6f', env.accountA.address])
        signing.catch(() => {})

        // Kod okumasi: signMessageDapp kilit denetimi YAPMAZ; popup App.vue kilitli dalda
        // current_request'i okur ve Login'den sonra page.redirect ile ayni ekrana gider.
        await env.waitForApproval('SIGN_MESSAGE')
        // Karar (spec bolum 8): kilitli baslangicta dapp'e 4100 ('Wallet is locked.') GITMEZ; istek yalniz bekler.
        // 4100 'Wallet is locked.' yalniz typed data onay-ani yeniden dogrulamasindadir (T9; burada degil).
        expect(env.hanging()).toEqual(['personal_sign'])

        env.unlock() // popup'ta Login: oturum anahtari yazilir
        const screen = await env.openApprovalScreen()
        await screen.state.sign()
        const signature = await signing

        expect(ethersVerifyMessage('Hello', signature)).toBe(env.accountA.address)
        expect(env.currentRequest()).toBeUndefined()
        expect(env.hanging()).toEqual([])
    })

    it('SW yeniden baslarsa bekleyen personal_sign -32603 alir (kodsuz DEGIL) [T5]', async () => {
        await setup()
        const pending = env.requestError('personal_sign', ['0x48656c6c6f', env.accountA.address])
        await env.waitForApproval('SIGN_MESSAGE')

        await env.restartServiceWorker()
        const error = await pending

        expectRpcError(error, -32603)
        expect(error.message).toMatch(/communication with the wallet/)
        expect(env.hanging()).toEqual([])
    })

    it('SW yeniden basladiktan SONRA gelen eski onay: dapp ikinci kez cevaplanmaz, olu kayit temizlenir', async () => {
        await setup()
        const pending = env.requestError('personal_sign', ['0x48656c6c6f', env.accountA.address])
        await env.waitForApproval('SIGN_MESSAGE')
        const screen = await env.openApprovalScreen()
        await env.restartServiceWorker()
        await pending

        // Kullanici olu ekranda Imzala'ya basar: arka plan (yeni SW) istegi tanimaz.
        await screen.state.sign()
        await env.settle()

        expect(env.currentRequest(), 'olu current_request diskte KALMAMALI').toBeUndefined()
        expect(env.hanging()).toEqual([])
    })

    it('[T8] N3: windows.create sinir hatasi verirse bounds\'suz yeniden denenir, dapp -32603 ALMAZ', async () => {
        await setup()
        env.failWindowBounds()

        const outcome = env.request('personal_sign', ['0x48656c6c6f', env.accountA.address]).then(() => ({}), (error) => ({ error }))
        await env.settle(40)

        expect(env.windowsCreated, 'ikinci deneme (left/top OLMADAN) bir pencere acmaliydi').toHaveLength(1)
        expect(env.windowsCreated[0].left).toBeUndefined()
        expect(env.hanging()).toEqual(['personal_sign'])

        await env.closeApprovalWindow()
        expectRpcError((await outcome).error, 4001)
    })

    it('[T8] N7: bekleyen imza istegini FARKLI origin\'in hibesiz istegi EZEMEZ (-32002)', async () => {
        await setup()
        const sign = env.request('personal_sign', ['0x48656c6c6f', env.accountA.address]).then(() => ({}), (error) => ({ error }))
        await env.waitForApproval('SIGN_MESSAGE')
        const first = env.currentRequest()

        env.navigate('https://baska.example/')
        const intruder = env.request('eth_requestAccounts').then(() => ({}), (error) => ({ error }))
        await env.settle(40)

        expect(env.currentRequest()?.id, 'bekleyen imza istegi EZILMEMELI').toBe(first.id)
        expect(env.hanging()).toEqual(['personal_sign'])
        const rejected = (await intruder).error
        expectRpcError(rejected, -32002)
        expect(rejected.message).toBe('Request already pending')

        env.navigate('https://app.example/swap')
        await env.closeApprovalWindow()
        expectRpcError((await sign).error, 4001)
    })

    it('SIGN gibi ic aksiyon adlari sayfadan 4200 alir ve arka plana HIC ulasmaz', async () => {
        await setup()

        const error = await env.requestError('SIGN', [{}])

        expectRpcError(error, 4200)
        expect(env.pageCalls('SIGN')).toEqual([])
    })

    it('[T8] parametre korumasi: eksik/bozuk params sayisal -32602, pencere ACILMAZ', async () => {
        await setup()

        await expectRejectedWithoutWindow('personal_sign', [], -32602)
        await expectRejectedWithoutWindow('eth_sendTransaction', [], -32602)
        await expectRejectedWithoutWindow('eth_sendTransaction', [null], -32602)
    })
})

// ---------------------------------------------------------------------------
// G5 / N2 -- bilinmeyen yontem 4200 (T14a)
// ---------------------------------------------------------------------------
describe('[T14a] G5 -- bilinmeyen/yasak her yontem 4200, sayisal kod, fetch YOK', () => {
    const FORBIDDEN = [
        'wallet_getCapabilities', 'wallet_sendCalls', 'wallet_getCallsStatus', 'wallet_getAssets',
        'wallet_requestPermissions', 'wallet_watchAsset', 'eth_signTypedData_v3', 'eth_signTypedData',
        'eth_sign', 'eth_signTransaction', 'eth_sendRawTransaction', 'personal_ecRecover',
        'eth_subscribe', 'eth_newFilter', 'eth_coinbase', 'debug_traceCall', 'txpool_content', 'admin_peers',
        'constructor', '__proto__',
    ]

    it.each(FORBIDDEN)('%s -> 4200 + "The method <ad> is not supported by this wallet."', async (method) => {
        await setup()

        const error = await env.requestError(method, [])

        expectRpcError(error, 4200)
        expect(error.message).toBe(`The method ${method} is not supported by this wallet.`)
        expectNoApproval()
        // fetch YOKLUGU afterEach'te her test icin ayrica kilitli.
    })

    it('wallet_getCapabilities Ek A parametreleriyle (adres + zincir listesi) -> 4200', async () => {
        await setup()

        const error = await env.requestError('wallet_getCapabilities', [env.accountA.address, ['0x1']])

        expectRpcError(error, 4200)
    })

    it('viem 4200\'u YENIDEN DENEMEZ: kodsuz hata 4 kez denenirdi, 4200 TEK kez', async () => {
        await setup()

        const outcome = await viemClient(3).request({ method: 'wallet_getCapabilities', params: [env.accountA.address] }).catch((e) => e)

        expect(outcome).toBeInstanceOf(Error)
        expect(outcome.code).toBe(4200)
        expect(env.pageCalls('wallet_getCapabilities')).toHaveLength(1)
    })

    it('sayfa adi YANSIMASI sinirli: 64 karakter, kontrol karakteri atilmis', async () => {
        await setup()
        const hostile = 'x_' + '\u0000\u0007\n'.repeat(5) + 'a'.repeat(200)

        const error = await env.requestError(hostile, [])

        expectRpcError(error, 4200)
        expect(error.message).not.toMatch(/[\u0000-\u001f]/)
        const adi = error.message.replace(/^The method /, '').replace(/ is not supported by this wallet\.$/, '')
        expect(adi.length).toBeLessThanOrEqual(64)
    })

    it('ic aksiyon adi SIGN_TYPED_DATA_CONFIRM sayfadan 4200 alir, arka plana ulasmaz (kirmizi liste)', async () => {
        await setup()

        const error = await env.requestError('SIGN_TYPED_DATA_CONFIRM', [{ message: { requestId: 'x', expectedDigest: '0x', account: env.accountA.address } }])

        expectRpcError(error, 4200)
        expect(env.pageCalls('SIGN_TYPED_DATA_CONFIRM')).toEqual([])
    })

    it('karisik istek firtinasi: HICBIRI askida kalmaz, her hata sayisal kodlu', async () => {
        await setup()
        const calls = [
            ['eth_accounts'], ['eth_chainId'], ['net_version'], ['wallet_getCapabilities', [env.accountA.address]],
            ['wallet_addEthereumChain', [{}]], ['wallet_switchEthereumChain', [{ chainId: '0x144' }]],
            ['eth_sendRawTransaction', ['0x00']], ['eth_signTypedData_v3', [env.accountA.address, '{}']],
            ['personal_ecRecover', []], ['eth_subscribe', ['newHeads']], ['wallet_requestPermissions', [{ eth_accounts: {} }]],
            ['eth_signTypedData_v4', [env.accountB.address, JSON.stringify(LAB_TYPED_DATA)]],
        ]

        // Sahte zamanlayici: 10 sn SAHTE zaman ilerletilir; hala cozulmemis istek varsa askida kalmistir.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const all = Promise.allSettled(calls.map(([method, params]) => env.request(method, params)))
        await env.settle(60)
        await vi.advanceTimersByTimeAsync(10_000)

        expect(env.hanging(), 'askida kalan istek').toEqual([])
        for (const result of await all) {
            if (result.status === 'rejected') expectRpcError(result.reason)
        }
    })
})

// ---------------------------------------------------------------------------
// G1 -- eth_signTypedData_v4 (T11 ekrani + T14a kablolamasi)
// ---------------------------------------------------------------------------
describe('[T14a] G1 -- eth_signTypedData_v4: GERCEK SignTypedData ekrani + GERCEK arka plan', () => {
    // Imzala dugmesinin ~700 ms kilidi ve 5 dk TTL icin Date + setTimeout SAHTE; setImmediate
    // (harness bekleme dongusu) ve queueMicrotask GERCEK kalir.
    const useFakeTime = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

    it('Lab yuku (Ek B, JSON string): imza verifyTypedData ile ESLESIR; ozet viem + ethers ile AYNI; dikis kilitli', async () => {
        await setup()
        useFakeTime()

        const pending = env.request('eth_signTypedData_v4', [env.accountA.address, JSON.stringify(LAB_TYPED_DATA)])
        pending.catch(() => {})
        await env.waitForApproval('SIGN_TYPED_DATA')
        const request = env.currentRequest()

        // Arka planin kendi kaydi: ozet iki bagimsiz kutuphaneyle AYNI.
        const oracleDigest = hashTypedData({ domain: LAB_TYPED_DATA.domain, types: LAB_TYPES_WITHOUT_DOMAIN, primaryType: 'Mail', message: LAB_TYPED_DATA.message })
        expect(request.digest).toBe(oracleDigest)
        expect(request.digest).toBe(TypedDataEncoder.hash(LAB_TYPED_DATA.domain, LAB_TYPES_WITHOUT_DOMAIN, LAB_TYPED_DATA.message))
        expect(request.signWith.toLowerCase()).toBe(env.accountA.address.toLowerCase())
        expect(request.chainCheck).toBe('match')

        const screen = await env.openApprovalScreen()
        await approve(screen)
        const signature = await pending

        expect(ethersVerifyTypedData(LAB_TYPED_DATA.domain, LAB_TYPES_WITHOUT_DOMAIN, LAB_TYPED_DATA.message, signature)).toBe(env.accountA.address)
        expect(await recoverTypedDataAddress({ domain: LAB_TYPED_DATA.domain, types: LAB_TYPES_WITHOUT_DOMAIN, primaryType: 'Mail', message: LAB_TYPED_DATA.message, signature })).toBe(env.accountA.address)

        // DIKIS: ekranin gonderdigi CONFIRM, islemcinin bekledigi sekilde.
        const [confirm] = env.uiMessages('SIGN_TYPED_DATA_CONFIRM')
        expect(Object.keys(confirm.message.message).sort()).toEqual(['account', 'expectedDigest', 'requestId'])
        expect(confirm.message.message.requestId).toBe(request.id)
        expect(confirm.message.message.expectedDigest).toBe(oracleDigest)
        expect(String(confirm.message.message.account?.address ?? confirm.message.message.account).toLowerCase()).toBe(env.accountA.address.toLowerCase())
        expect(confirm.response).toEqual({ success: true, signature })
        const [success] = env.uiMessages('SIGN_MESSAGE_SUCCESS')
        expect(success.message.requestId).toBe(request.id)
        expect(success.message.data.result).toBe(signature)

        expect(env.currentRequest()).toBeUndefined()
        expect(env.hanging()).toEqual([])
    })

    it('viem signTypedData (types.EIP712Domain viem eklenir): ayni imza dogrulamasi, SIRA [adres, JSON] teldedir', async () => {
        await setup()
        useFakeTime()

        const signing = viemClient().signTypedData({
            account: env.accountA.address,
            domain: LAB_TYPED_DATA.domain,
            types: LAB_TYPES_WITHOUT_DOMAIN,
            primaryType: 'Mail',
            message: LAB_TYPED_DATA.message,
        })
        signing.catch(() => {})
        await env.waitForApproval('SIGN_TYPED_DATA')
        const [wire] = env.pageCalls('eth_signTypedData_v4')
        expect(wire.params[0]).toBe(env.accountA.address)
        expect(typeof wire.params[1]).toBe('string')

        const screen = await env.openApprovalScreen()
        await approve(screen)
        const signature = await signing

        expect(ethersVerifyTypedData(LAB_TYPED_DATA.domain, LAB_TYPES_WITHOUT_DOMAIN, LAB_TYPED_DATA.message, signature)).toBe(env.accountA.address)
    })

    it('ikinci zincirde (OP, chainId 10) de calisir ve imza O zincirin alanina baglidir', async () => {
        await setup({ chainId: 10 })
        useFakeTime()
        const domain = { ...LAB_TYPED_DATA.domain, chainId: 10 }
        const typed = { ...LAB_TYPED_DATA, domain }

        const pending = env.request('eth_signTypedData_v4', [env.accountA.address, JSON.stringify(typed)])
        pending.catch(() => {})
        await env.waitForApproval('SIGN_TYPED_DATA')
        const screen = await env.openApprovalScreen()
        await approve(screen)
        const signature = await pending

        expect(ethersVerifyTypedData(domain, LAB_TYPES_WITHOUT_DOMAIN, LAB_TYPED_DATA.message, signature)).toBe(env.accountA.address)
        expect(ethersVerifyTypedData(LAB_TYPED_DATA.domain, LAB_TYPES_WITHOUT_DOMAIN, LAB_TYPED_DATA.message, signature)).not.toBe(env.accountA.address)
    })

    it('Reddet: 4001 + "User rejected the request."; imza HIC uretilmez', async () => {
        await setup()
        useFakeTime()
        const pending = env.requestError('eth_signTypedData_v4', [env.accountA.address, JSON.stringify(LAB_TYPED_DATA)])
        await env.waitForApproval('SIGN_TYPED_DATA')

        const screen = await env.openApprovalScreen()
        await vi.advanceTimersByTimeAsync(SIGN_LOCK_MS + 100)
        await screen.state.cancel()
        const error = await pending

        expectRpcError(error, 4001)
        expect(error.message).toBe('User rejected the request.')
        expect(env.uiMessages('SIGN_TYPED_DATA_CONFIRM')).toEqual([])
        expect(env.hanging()).toEqual([])
    })

    it('onay penceresi kapatilirsa 4001 "User closed the window."', async () => {
        await setup()
        const pending = env.requestError('eth_signTypedData_v4', [env.accountA.address, JSON.stringify(LAB_TYPED_DATA)])
        await env.waitForApproval('SIGN_TYPED_DATA')

        await env.closeApprovalWindow()
        const error = await pending

        expectRpcError(error, 4001)
        expect(error.message).toBe('User closed the window.')
        expect(env.hanging()).toEqual([])
    })

    it('ekran SAHTE ozetle onay gonderirse arka plan IMZALAMAZ (expectedDigest kilidi)', async () => {
        await setup()
        useFakeTime()
        const pending = env.requestError('eth_signTypedData_v4', [env.accountA.address, JSON.stringify(LAB_TYPED_DATA)])
        await env.waitForApproval('SIGN_TYPED_DATA')
        const request = env.currentRequest()

        const tampered = await env.chrome.runtime.sendMessage({
            type: 'SIGN_TYPED_DATA_CONFIRM',
            message: { account: env.accountA.address, requestId: request.id, expectedDigest: '0x' + '11'.repeat(32) },
        })

        expect(tampered.success).toBe(false)
        expectRpcError(Object.assign(new Error(tampered.error.message), { code: tampered.error.code }))
        expect(tampered.signature).toBeUndefined()

        // Dapp'in istegi hala bekliyor: gercek ekran temizce reddeder.
        const screen = await env.openApprovalScreen()
        await screen.state.cancel()
        expectRpcError(await pending, 4001)
    })

    it('bilinmeyen requestId ile onay: kapali-basarisiz {success:false, error:{code}} (imza YOK)', async () => {
        await setup()

        const response = await env.chrome.runtime.sendMessage({
            type: 'SIGN_TYPED_DATA_CONFIRM',
            message: { account: env.accountA.address, requestId: 'yok-boyle-bir-istek', expectedDigest: '0x' + '22'.repeat(32) },
        })

        expect(response.success).toBe(false)
        expect(Number.isInteger(response.error.code)).toBe(true)
        expect(response.signature).toBeUndefined()
    })

    it('5 dakikalik TTL: eski istek imzalanmaz, dapp -32603 "Request expired" alir, ekran "expired" gosterir', async () => {
        await setup()
        useFakeTime()
        const pending = env.requestError('eth_signTypedData_v4', [env.accountA.address, JSON.stringify(LAB_TYPED_DATA)])
        await env.waitForApproval('SIGN_TYPED_DATA')
        const screen = await env.openApprovalScreen()

        await vi.advanceTimersByTimeAsync(6 * 60 * 1000)
        await screen.state.sign()
        const error = await pending

        // Arka plan kapali-basarisiz doner; ekran (T11) kodu ve mesaji AYNEN dapp'e iletir.
        expect(env.uiMessages('SIGN_TYPED_DATA_CONFIRM')[0].response).toEqual({ success: false, error: { code: -32603, message: 'Request expired' } })
        expectRpcError(error, -32603)
        expect(error.message).toBe('Request expired')
        expect(screen.state.failure).toBe('expired')
        expect(env.hanging()).toEqual([])
    })

    it('SW onay beklerken olurse: dapp -32603 alir; olu ekranin onayi imza URETMEZ', async () => {
        await setup()
        useFakeTime()
        const pending = env.requestError('eth_signTypedData_v4', [env.accountA.address, JSON.stringify(LAB_TYPED_DATA)])
        await env.waitForApproval('SIGN_TYPED_DATA')
        const screen = await env.openApprovalScreen()

        await env.restartServiceWorker()
        expectRpcError(await pending, -32603)

        await approve(screen)
        await env.settle()
        expect(env.uiMessages('SIGN_TYPED_DATA_CONFIRM')[0].response.success).toBe(false)
        expect(env.currentRequest(), 'olu kayit temizlenmeli').toBeUndefined()
    })

    describe('pencere ACILMADAN reddedilenler (siki kapi)', () => {
        it('bildirilmis domain.chainId aktif zincire esit degil -> -32602', async () => {
            await setup()
            const typed = { ...LAB_TYPED_DATA, domain: { ...LAB_TYPED_DATA.domain, chainId: 137 } }

            await expectRejectedWithoutWindow('eth_signTypedData_v4', [env.accountA.address, JSON.stringify(typed)], -32602)
        })

        it('DAI permit allowed:"false" (JSON string) yaprak turu uyusmazligi -> -32602', async () => {
            await setup()
            const typed = daiPermit(env.accountA.address, { allowed: 'false' })

            await expectRejectedWithoutWindow('eth_signTypedData_v4', [env.accountA.address, JSON.stringify(typed)], -32602)
        })

        it('dapp\'e verilmemis hesap -> 4100', async () => {
            await setup()

            await expectRejectedWithoutWindow('eth_signTypedData_v4', [env.accountB.address, JSON.stringify(LAB_TYPED_DATA)], 4100)
        })

        it('aktif ag EVM degil (TON) -> 4901', async () => {
            await setup()
            env.seed({ currentNetwork: TON_CHAIN })

            await expectRejectedWithoutWindow('eth_signTypedData_v4', [env.accountA.address, JSON.stringify(LAB_TYPED_DATA)], 4901)
        })

        it('bagli olmayan sayfa imza penceresi ACTIRAMAZ -> 4100', async () => {
            await setup({ connected: false })

            await expectRejectedWithoutWindow('eth_signTypedData_v4', [env.accountA.address, JSON.stringify(LAB_TYPED_DATA)], 4100)
        })

        it('bozuk parametreler (eksik, JSON degil, dizi degil) -> -32602', async () => {
            await setup()

            await expectRejectedWithoutWindow('eth_signTypedData_v4', [], -32602)
            await expectRejectedWithoutWindow('eth_signTypedData_v4', [env.accountA.address, '{bozuk json'], -32602)
            await expectRejectedWithoutWindow('eth_signTypedData_v4', [env.accountA.address], -32602)
        })

        it('256 KiB uzeri yuk -> -32602', async () => {
            await setup()
            const huge = { ...LAB_TYPED_DATA, message: { ...LAB_TYPED_DATA.message, contents: 'a'.repeat(300 * 1024) } }

            await expectRejectedWithoutWindow('eth_signTypedData_v4', [env.accountA.address, JSON.stringify(huge)], -32602)
        })

        // Spec 9 madde 4 (satir tavani 500, T9 V11 / T2 `overLimit`): GERCEK T2 gorunumu ~600 satirlik
        // istegi GERCEK arka plan isleyicisinden gecirir; pencere ACILMADAN -32602 doner.
        // Yuk kucuk (256 KiB altinda): ham boyut kapisi degil, SATIR tavani devreye girer.
        it('satir tavani (~600 dizi elemani) asildi -> -32602 "Typed data is too large to display."', async () => {
            await setup()
            const td = {
                domain: { name: 'Big List', chainId: '1' },
                types: {
                    EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }],
                    Thing: [{ name: 'v', type: 'uint16[]' }],
                },
                primaryType: 'Thing',
                message: { v: Array.from({ length: 600 }, (_, i) => String(i)) },
            }
            expect(JSON.stringify(td).length, 'on kosul: yuk 256 KiB altinda').toBeLessThan(256 * 1024)

            const error = await expectRejectedWithoutWindow('eth_signTypedData_v4', [env.accountA.address, JSON.stringify(td)], -32602)

            expect(error.message).toBe('Typed data is too large to display.')
        })
    })
})

// ---------------------------------------------------------------------------
// G4 -- hesap degisimi (T14a: TEK tetikleyici storage.onChanged active_account)
// ---------------------------------------------------------------------------
describe('[T14a] G4 -- hesap degisimi: dapp\'in gordugu olay ile eth_accounts TUTARLI', () => {
    it('sessiz yazici (yalniz active_account yazimi): TAM BIR accountsChanged, eth_accounts ve imza yeni hesapla', async () => {
        await setup()

        await env.writeActiveAccount(env.accountB)

        expect(env.eventsOf('accountsChanged')).toEqual([[env.accountB.address]])
        expect(await env.request('eth_accounts')).toEqual([env.accountB.address])
        expect(env.store.dapps['app.example'].accounts).toEqual([env.accountB.address])
    })

    it('Header yolu (active_account yazimi + ACCOUNT_CHANGED): TOPLAMDA tam BIR accountsChanged', async () => {
        await setup()

        await env.writeActiveAccount(env.accountB)
        await env.announceAccountChanged(env.accountB)

        expect(env.eventsOf('accountsChanged')).toEqual([[env.accountB.address]])
    })

    it('ayni onChanged olayinin IKINCI teslimi (cift onChanged) ikinci kez bildirmez', async () => {
        await setup()

        await env.writeActiveAccount(env.accountB)
        env.redeliverLastStorageChange()
        await env.settle()

        expect(env.eventsOf('accountsChanged')).toEqual([[env.accountB.address]])
    })

    it('hesap degisiminden SONRA yeni hesapla personal_sign BASARILI (eskiden 4100)', async () => {
        await setup()
        await env.writeActiveAccount(env.accountB)

        const signing = viemClient().signMessage({ account: env.accountB.address, message: 'Hello AppKit!' })
        signing.catch(() => {})
        await env.waitForApproval('SIGN_MESSAGE')
        const screen = await env.openApprovalScreen()
        await screen.state.sign()

        expect(ethersVerifyMessage('Hello AppKit!', await signing)).toBe(env.accountB.address)
    })

    it('acik sekmesi OLMAYAN (uyuyan) site: kaydina DOKUNULMAZ, olay gonderilmez', async () => {
        await setup()
        env.closeTab()

        await env.writeActiveAccount(env.accountB)

        expect(env.eventsOf('accountsChanged')).toEqual([])
        expect(env.store.dapps['app.example'].accounts).toEqual([env.accountA.address])
    })

    it('[T14a][T8] yeni aktif hesap EVM\'siz (TON): izin degismez, accountsChanged([]) gider (T14a), eth_accounts [] (T8)', async () => {
        await setup()

        await env.writeActiveAccount(TON_ACCOUNT)

        expect(env.eventsOf('accountsChanged')).toEqual([[]])
        expect(env.store.dapps['app.example'].accounts).toEqual([env.accountA.address])
        expect(await env.request('eth_accounts')).toEqual([])
    })
})

// ---------------------------------------------------------------------------
// G3 -- izinler (T14b)
// ---------------------------------------------------------------------------
describe('[T14b] G3 -- wallet_getPermissions / wallet_revokePermissions', () => {
    it('baglayken getPermissions EIP-2255 sekli (wagmi permissions[0].caveats[0].value bekler)', async () => {
        await setup()

        const permissions = await env.request('wallet_getPermissions')

        expect(permissions).toEqual([{
            invoker: 'https://app.example',
            parentCapability: 'eth_accounts',
            caveats: [{ type: 'restrictReturnedAccounts', value: [env.accountA.address] }],
            date: env.store.dapps['app.example'].connectedAt,
        }])
    })

    it('bagli degilken getPermissions []', async () => {
        await setup({ connected: false })

        expect(await env.request('wallet_getPermissions')).toEqual([])
    })

    it('wallet_revokePermissions [{eth_accounts:{}}]: null, kayit SILINIR, accountsChanged([]), eth_accounts [], getPermissions []', async () => {
        await setup()

        const result = await env.request('wallet_revokePermissions', [{ eth_accounts: {} }])
        await env.settle()

        expect(result).toBeNull()
        expect(env.store.dapps['app.example']).toBeUndefined()
        expect(env.eventsOf('accountsChanged')).toEqual([[]])
        expect(await env.request('eth_accounts')).toEqual([])
        expect(await env.request('wallet_getPermissions')).toEqual([])
    })

    it('bozuk revoke parametreleri -32602, kayit KORUNUR', async () => {
        await setup()

        for (const params of [[], [{}], ['eth_accounts'], [null], undefined]) {
            expectRpcError(await env.requestError('wallet_revokePermissions', params), -32602)
        }
        expect(env.store.dapps['app.example'].accounts).toEqual([env.accountA.address])
    })

    it('eth_accounts anahtari OLMAYAN revoke kaydi silmez', async () => {
        await setup()

        await env.request('wallet_revokePermissions', [{ baska_izin: {} }])

        expect(env.store.dapps['app.example'].accounts).toEqual([env.accountA.address])
    })

    it('AYNI hostname FARKLI sema (http): tam-origin esitligi yok -> getPermissions [], revoke kaydi SILMEZ', async () => {
        await setup()
        env.navigate('http://app.example/swap')

        expect(await env.request('wallet_getPermissions')).toEqual([])
        await env.request('wallet_revokePermissions', [{ eth_accounts: {} }]).catch(() => {})
        await env.settle()

        expect(env.store.dapps['app.example'].accounts).toEqual([env.accountA.address])
    })

    it('revoke, o origin\'in BEKLEYEN imza istegini 4100 ile reddeder ve pencereyi kapatir', async () => {
        await setup()
        const sign = env.requestError('personal_sign', ['0x48656c6c6f', env.accountA.address])
        await env.waitForApproval('SIGN_MESSAGE')

        await env.request('wallet_revokePermissions', [{ eth_accounts: {} }])
        const error = await sign

        expectRpcError(error, 4100)
        expect(env.hanging()).toEqual([])
    })
})

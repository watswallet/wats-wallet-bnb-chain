// SignTypedData.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js,
// sablon: Sign.ssr.test.js).
//
// Kapsam (spec bolum 6 G1/6, N7, 7.4 A, 11/3):
//   - imzalayan hesap istekteki signWith'ten cozulur, aktif hesaptan DEGIL
//   - gosterilen = imzalanan: ekran NORMALLESMIS kaydi cizer, ozeti kendi hesaplar
//   - Imzala ~700 ms kilitli; kisaltma varken "tumunu goster"e kadar kilitli
//   - risk bandi (permit / Seaport / yorumlanamayan) ve alan isaretleri
//   - onay akisi: SIGN_TYPED_DATA_CONFIRM -> SIGN_MESSAGE_SUCCESS; ret 4001/4100/-32603
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import { parseTypedDataParams } from '../../utils/eip712/parse'
import { hashTypedDataDigest } from '../../utils/eip712/digest'
import { TYPED_DATA_USER_REJECT_MESSAGE } from '../../utils/eip712/errors'
import { DEFAULT_VIEW_LIMITS } from '../../utils/eip712/view'
import en from '../../i18n/locales/en.json'
import SignTypedData from './SignTypedData.vue'

const T = en.dapps.signTypedData

// Gecerli EIP-55 adresler (parse siki yaprak gecisi saglama toplamini ister).
const COW = '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826'
const BOB = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
const DEAD = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF'
const CONTRACT = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const SEAPORT = '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC'
const NFT = '0x2222222222222222222222222222222222222222'
const ZERO = '0x0000000000000000000000000000000000000000'
const ZERO32 = '0x' + '00'.repeat(32)
const MAX_UINT256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
const SIGNATURE = '0x' + 'ab'.repeat(65)

const ACCOUNT_A = { key: 'ka', address: '0x1111111111111111111111111111111111111111', name: 'Hesap A', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" }
const ACCOUNT_B = { key: 'kb', address: COW, name: 'Hesap B', type: 'hd', derivationPath: "m/44'/60'/0'/0/1" }

const DOMAIN_FULL = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
]

// --- fixture'lar: dapp'in gonderdigi typedData (parse bunlari normallestirir) ---
function mailTypedData({ contents = 'Hello, Bob!', domainName = 'Ether Mail' } = {}) {
    return {
        types: {
            EIP712Domain: DOMAIN_FULL,
            Person: [{ name: 'name', type: 'string' }, { name: 'wallets', type: 'address[]' }],
            Mail: [{ name: 'from', type: 'Person' }, { name: 'to', type: 'Person[]' }, { name: 'contents', type: 'string' }],
        },
        primaryType: 'Mail',
        domain: { name: domainName, version: '1', chainId: 1, verifyingContract: CONTRACT },
        message: {
            from: { name: 'Cow', wallets: [COW, DEAD] },
            to: [{ name: 'Bob', wallets: [BOB] }],
            contents,
        },
    }
}

function batchTypedData(count) {
    return {
        types: {
            EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }],
            Batch: [{ name: 'values', type: 'uint256[]' }],
        },
        primaryType: 'Batch',
        domain: { name: 'Batch', chainId: 1 },
        message: { values: Array.from({ length: count }, (_, i) => String(i + 1)) },
    }
}

function daiPermitTypedData() {
    return {
        types: {
            EIP712Domain: DOMAIN_FULL,
            Permit: [
                { name: 'holder', type: 'address' }, { name: 'spender', type: 'address' },
                { name: 'nonce', type: 'uint256' }, { name: 'expiry', type: 'uint256' },
                { name: 'allowed', type: 'bool' },
            ],
        },
        primaryType: 'Permit',
        domain: { name: 'Dai Stablecoin', version: '1', chainId: 1, verifyingContract: DAI },
        message: { holder: COW, spender: BOB, nonce: 0, expiry: 0, allowed: true },
    }
}

const ERC2612_FIELDS = [
    { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
]

function erc2612TypedData({ withChain = true } = {}) {
    return {
        types: {
            EIP712Domain: withChain
                ? DOMAIN_FULL
                : [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'verifyingContract', type: 'address' }],
            Permit: ERC2612_FIELDS,
        },
        primaryType: 'Permit',
        domain: withChain
            ? { name: 'USD Coin', version: '2', chainId: 1, verifyingContract: USDC }
            : { name: 'USD Coin', version: '2', verifyingContract: USDC },
        message: { owner: COW, spender: BOB, value: MAX_UINT256, nonce: 0, deadline: 1999999999 },
    }
}

function unknownPermitTypedData() {
    return {
        types: {
            EIP712Domain: DOMAIN_FULL,
            // Kanonik EIP-2612 dizgisi DEGIL (nonce/deadline yok) ama permit benzeri.
            Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }],
        },
        primaryType: 'Permit',
        domain: { name: 'Odd Token', version: '1', chainId: 1, verifyingContract: USDC },
        message: { owner: COW, spender: BOB, value: '5' },
    }
}

// Seaport 1.5 OrderComponents; consideration alicisi BOB (imzalayan COW hicbir sey almaz).
function seaportZeroReturnTypedData() {
    return {
        types: {
            EIP712Domain: DOMAIN_FULL,
            OrderComponents: [
                { name: 'offerer', type: 'address' }, { name: 'zone', type: 'address' },
                { name: 'offer', type: 'OfferItem[]' }, { name: 'consideration', type: 'ConsiderationItem[]' },
                { name: 'orderType', type: 'uint8' }, { name: 'startTime', type: 'uint256' },
                { name: 'endTime', type: 'uint256' }, { name: 'zoneHash', type: 'bytes32' },
                { name: 'salt', type: 'uint256' }, { name: 'conduitKey', type: 'bytes32' },
                { name: 'counter', type: 'uint256' },
            ],
            OfferItem: [
                { name: 'itemType', type: 'uint8' }, { name: 'token', type: 'address' },
                { name: 'identifierOrCriteria', type: 'uint256' }, { name: 'startAmount', type: 'uint256' },
                { name: 'endAmount', type: 'uint256' },
            ],
            ConsiderationItem: [
                { name: 'itemType', type: 'uint8' }, { name: 'token', type: 'address' },
                { name: 'identifierOrCriteria', type: 'uint256' }, { name: 'startAmount', type: 'uint256' },
                { name: 'endAmount', type: 'uint256' }, { name: 'recipient', type: 'address' },
            ],
        },
        primaryType: 'OrderComponents',
        domain: { name: 'Seaport', version: '1.5', chainId: 1, verifyingContract: SEAPORT },
        message: {
            offerer: COW,
            zone: ZERO,
            offer: [{ itemType: 2, token: NFT, identifierOrCriteria: '1', startAmount: '1', endAmount: '1' }],
            consideration: [{ itemType: 0, token: ZERO, identifierOrCriteria: '0', startAmount: '1', endAmount: '1', recipient: BOB }],
            orderType: 0,
            startTime: '0',
            endTime: '2000000000',
            zoneHash: ZERO32,
            salt: '1',
            conduitKey: ZERO32,
            counter: '0',
        },
    }
}

/**
 * Arka planin (T9 signTypedDataDapp) `current_request`e yazacagi kaydi GERCEK
 * parse + ozet modulleriyle uretir: ekran testi ayni sozlesmeyi sinar.
 */
function buildRequest(typedData, { signer = ACCOUNT_B.address, id = 'req-td-1', chainId = 1, ...extra } = {}) {
    const parsed = parseTypedDataParams([signer, JSON.stringify(typedData)], { activeChainId: chainId })
    if (!parsed.ok) throw new Error('fixture gecersiz: ' + JSON.stringify(parsed.error))
    return {
        type: 'SIGN_TYPED_DATA',
        id,
        origin: 'https://dapp.example',
        favicon: '',
        signWith: parsed.value.signWith,
        typedData: parsed.value.typedData,
        digest: hashTypedDataDigest(parsed.value.typedData).digest,
        chainCheck: parsed.value.chainCheck,
        createdAt: Date.now(),
        ...extra,
    }
}

let focusHandlers

beforeEach(() => {
    // Yalniz setTimeout/clearTimeout sahte: 700 ms kilidi ileri sarilarak olculur.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    focusHandlers = []
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })
    vi.stubGlobal('addEventListener', (type, fn) => { if (type === 'focus') focusHandlers.push(fn) })
    vi.stubGlobal('removeEventListener', () => {})
    // Beklenen hata yollari console.error yazar; test ciktisi gurultulenmesin.
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup(currentRequest, { confirmResponse, onCapture } = {}) {
    const stub = installChromeStub({
        current_request: currentRequest,
        active_account: ACCOUNT_A,
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [ACCOUNT_A, ACCOUNT_B] }],
    })
    const sent = []
    stub.setSendMessage(async (msg) => {
        sent.push(msg)
        if (msg.type === 'SIGN_TYPED_DATA_CONFIRM') {
            if (typeof confirmResponse === 'function') return confirmResponse(msg)
            return { success: true, signature: SIGNATURE }
        }
        return {}
    })
    const storageListeners = []
    globalThis.chrome.storage.onChanged = {
        addListener: (fn) => storageListeners.push(fn),
        removeListener: () => {},
    }

    const app = createApp(SignTypedData)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const page = pageStore()
    page.currentPage = 'sign_typed_data'
    const holder = captureInstance(app, 'SignTypedData', onCapture)

    return { app, page, stub, sent, storageListeners, holder }
}

const confirmMessages = (sent) => sent.filter((m) => m.type === 'SIGN_TYPED_DATA_CONFIRM')

// Imzala dugmesi her zaman altbilgideki SON dugmedir.
const signButtonHtml = (html) => html.slice(html.lastIndexOf('<button'))

describe('SignTypedData.vue (SSR) -- gosterim ve imzalayan hesap', () => {
    it('imzalayan hesap istekteki signWith adresinden cozulur, AKTIF hesap degil', async () => {
        const { app, holder } = setup(buildRequest(mailTypedData()))
        const html = await render(app)

        expect(holder.setupStateEmptyError).toBeUndefined()
        expect(holder.instance.setupState.activeAccountAddress).toBe(ACCOUNT_B.address)
        expect(holder.instance.setupState.activeAccountName).toBe('Hesap B')
        expect(html).toContain('Hesap B')
        expect(html).not.toContain('Hesap A')
    })

    it('origin hostname olarak gosterilir ve baslik ceviri anahtarindan gelir', async () => {
        const { app } = setup(buildRequest(mailTypedData()))
        const html = await render(app)

        expect(html).toContain('dapp.example')
        expect(html).toContain(T.title)
    })

    it('mesaj degerleri NORMALLESMIS haliyle gorunur (Ether Mail)', async () => {
        const { app } = setup(buildRequest(mailTypedData()))
        const html = await render(app)

        expect(html).toContain('Hello, Bob!')
        expect(html).toContain('Cow')
        expect(html).toContain('Bob')
        expect(html).toContain(BOB)
        expect(html).toContain(DEAD)
    })

    // Fixture'larin tamami zaten kanonik; bu test ekranin NORMALLESMIS kaydi cizdigini (dapp'in
    // gonderdigi ham metni DEGIL) kanitlar: kucuk harfli adres EIP-55, hex uint ondalik gorunur.
    it('dapp kucuk harfli adres ve hex uint gonderirse ekran NORMALLESMIS (EIP-55, ondalik) degeri cizer', async () => {
        const typedData = batchTypedData(1)
        typedData.types.Batch = [{ name: 'values', type: 'uint256[]' }, { name: 'who', type: 'address' }]
        typedData.message = { values: ['0x10'], who: COW.toLowerCase() }
        const { app } = setup(buildRequest(typedData), { onCapture: (inst) => { inst.setupState.showTechnical = true } })
        const html = await render(app)

        expect(html).toContain(COW)
        expect(html).not.toContain(COW.toLowerCase())
        expect(html).toContain('>16<')
    })

    it('domain "kendi beyani" basligi altinda; dogrulayan sozlesme KISALTILMADAN', async () => {
        const { app } = setup(buildRequest(mailTypedData()))
        const html = await render(app)

        expect(html).toContain(T.label_domain)
        expect(html).toContain('Ether Mail')
        expect(html).toContain(T.domain_contract)
        expect(html).toContain(CONTRACT)
    })

    it('bildirilmis chainId varsa "ag belirtilmiyor" notu YOK', async () => {
        const { app } = setup(buildRequest(mailTypedData()))
        const html = await render(app)

        expect(html).not.toContain(T.chain_missing)
    })

    it('imzaya GIRMEYEN (bildirilmemis) domain alani gosterilmez; "imzalanmayan alan" notu cikar', async () => {
        const typedData = mailTypedData()
        typedData.types.EIP712Domain = [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }]
        typedData.domain = { name: 'Ether Mail', version: '1', chainId: 424242424 }
        const { app } = setup(buildRequest(typedData))
        const html = await render(app)

        expect(html).toContain(T.chain_missing)
        expect(html).toContain(T.unsigned_fields)
        expect(html).not.toContain('424242424')
    })

    it('ozel (taninmayan) domain alani "diger domain alanlari" altinda adi ve degeriyle gorunur', async () => {
        const typedData = mailTypedData()
        typedData.types.EIP712Domain = [...DOMAIN_FULL, { name: 'region', type: 'string' }]
        typedData.domain = { ...typedData.domain, region: 'eu-west-extra' }
        const { app } = setup(buildRequest(typedData))
        const html = await render(app)

        expect(html).toContain(T.domain_extra_fields)
        expect(html).toContain('region')
        expect(html).toContain('eu-west-extra')
    })

    it('teknik ayrintilar varsayilan KAPALI: ozet ve ham JSON HTML te yok', async () => {
        const request = buildRequest(mailTypedData())
        const { app } = setup(request)
        const html = await render(app)

        expect(html).toContain(T.technical_details)
        expect(html).not.toContain(request.digest)
        expect(html).not.toContain(T.raw_label)
    })

    it('teknik ayrintilar ACIKKEN ozet ve yeniden serilestirilmis ham JSON gorunur', async () => {
        const request = buildRequest(mailTypedData())
        const { app } = setup(request, { onCapture: (inst) => { inst.setupState.showTechnical = true } })
        const html = await render(app)

        expect(html).toContain(T.digest_label)
        expect(html).toContain(request.digest)
        expect(html).toContain(T.raw_label)
        expect(html).toContain(T.btn_copy_json)
    })

    it('dapp metni HTML olarak BASILMAZ (kacirilir), baslangicta gizli karakter notu yok', async () => {
        const { app } = setup(buildRequest(mailTypedData({ domainName: '<img src=x onerror=alert(1)>' })))
        const html = await render(app)

        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
        expect(html).not.toContain('<img src=x')
        expect(html).not.toContain(T.hidden_chars)
    })

    it('mesaj degeri de HTML olarak BASILMAZ (kacirilir)', async () => {
        const { app } = setup(buildRequest(mailTypedData({ contents: '<b onmouseover=alert(1)>x</b>' })))
        const html = await render(app)

        expect(html).toContain('&lt;b onmouseover=alert(1)&gt;x&lt;/b&gt;')
        expect(html).not.toContain('<b onmouseover')
    })

    // Gorunmez / yon degistiren karakterler domain adinda ISARETLENIR ve uyari gorunur
    // (U+202E "sag-sol gecersiz kilma" metni gorsel olarak ters cevirir).
    it.each([
        ['sifir genislikli bosluk', String.fromCodePoint(0x200B), '[U+200B]'],
        ['sag-sol gecersiz kilma', String.fromCodePoint(0x202E), '[U+202E]'],
        ['yon izolasyonu', String.fromCodePoint(0x2066), '[U+2066]'],
    ])('gizli karakter (%s) domain adinda ISARETLENIR ve uyari gorunur', async (_ad, karakter, isaret) => {
        const { app } = setup(buildRequest(mailTypedData({ domainName: 'Ether' + karakter + 'Mail' })))
        const html = await render(app)

        expect(html).toContain(isaret)
        expect(html).toContain(T.hidden_chars)
    })

    it('mesajdaki benzer gorunen (Kiril) karakter ISARETLENIR ve uyari gorunur', async () => {
        const { app } = setup(buildRequest(mailTypedData({ contents: 'H' + String.fromCodePoint(0x0435) + 'llo' })))
        const html = await render(app)

        expect(html).toContain('[U+0435]')
        expect(html).toContain(T.hidden_chars)
    })

    // Satir sonu daraltmasi T2'nin gorunum modelindedir (kendi isaretiyle); ekran ham satir sonunu geri GETIRMEZ.
    it('yeni satir iceren deger TEK satirda, bir isaretle cizilir', async () => {
        const { app } = setup(buildRequest(mailTypedData({ contents: 'line1\nline2' })))
        const html = await render(app)

        expect(html).toMatch(/line1 \S line2/)
        expect(html).not.toContain('line1\nline2')
    })

    it('risk bandi YOK: Ether Mail genel agac olarak cizilir', async () => {
        const { app, holder } = setup(buildRequest(mailTypedData()))
        const html = await render(app)

        expect(holder.instance.setupState.risk).toBeNull()
        expect(html).not.toContain(T.permit_title)
        expect(html).not.toContain(T.permit_unknown_title)
    })
})

describe('SignTypedData.vue (SSR) -- Imzala 700 ms kilidi (N7)', () => {
    it('mount sonrasi Imzala kilitli: dugme devre disi ve sign() HICBIR sey gondermez', async () => {
        const { app, holder, sent } = setup(buildRequest(mailTypedData()))
        const html = await render(app)
        const state = holder.instance.setupState

        expect(state.locked).toBe(true)
        expect(state.signDisabled).toBe(true)
        expect(signButtonHtml(html)).toMatch(/\sdisabled/)

        await state.sign()
        expect(confirmMessages(sent)).toHaveLength(0)
    })

    it('699 ms hala kilitli, 700 ms de acilir', async () => {
        const { app, holder } = setup(buildRequest(mailTypedData()))
        await render(app)
        const state = holder.instance.setupState

        vi.advanceTimersByTime(699)
        expect(state.signDisabled).toBe(true)
        vi.advanceTimersByTime(1)
        expect(state.locked).toBe(false)
        expect(state.signDisabled).toBe(false)
    })

    it('pencere odagi donunce kilit YENIDEN kurulur', async () => {
        const { app, holder } = setup(buildRequest(mailTypedData()))
        await render(app)
        const state = holder.instance.setupState
        vi.advanceTimersByTime(700)
        expect(state.locked).toBe(false)

        expect(focusHandlers.length).toBeGreaterThan(0)
        focusHandlers.forEach((fn) => fn())
        expect(state.locked).toBe(true)
        expect(state.signDisabled).toBe(true)

        vi.advanceTimersByTime(700)
        expect(state.signDisabled).toBe(false)
    })

    it('current_request.id degisince ekran yeni istegi yukler ve kilit YENIDEN kurulur', async () => {
        const { app, holder, stub, storageListeners } = setup(buildRequest(mailTypedData(), { id: 'req-td-1' }))
        await render(app)
        const state = holder.instance.setupState
        vi.advanceTimersByTime(700)
        expect(state.signDisabled).toBe(false)

        const next = buildRequest(mailTypedData({ contents: 'Second' }), { id: 'req-td-2' })
        stub.localStore.current_request = next
        expect(storageListeners).toHaveLength(1)
        await Promise.all(storageListeners.map((fn) => fn({ current_request: { newValue: next } }, 'local')))

        expect(state.request.id).toBe('req-td-2')
        expect(state.locked).toBe(true)
        expect(state.signDisabled).toBe(true)
    })

    it('basarisizlik penceresinde yeni istek gelirse home a donus IPTAL edilir', async () => {
        const stranger = '0x3333333333333333333333333333333333333333'
        const { app, holder, page, stub, storageListeners } = setup(buildRequest(mailTypedData(), { signer: stranger, id: 'req-td-1' }))
        await render(app)
        expect(holder.instance.setupState.failure).toBe('invalid')

        const next = buildRequest(mailTypedData({ contents: 'Second' }), { id: 'req-td-2' })
        stub.localStore.current_request = next
        await Promise.all(storageListeners.map((fn) => fn({ current_request: { newValue: next } }, 'local')))
        vi.advanceTimersByTime(5000)

        expect(holder.instance.setupState.request.id).toBe('req-td-2')
        expect(holder.instance.setupState.failure).toBe('')
        expect(page.currentPage).toBe('sign_typed_data')
    })

    it('ayni id ile gelen yazim (yeniden yukleme) YOK sayilir', async () => {
        const request = buildRequest(mailTypedData(), { id: 'req-td-1' })
        const { app, holder, storageListeners } = setup(request)
        await render(app)
        vi.advanceTimersByTime(700)

        await Promise.all(storageListeners.map((fn) => fn({ current_request: { newValue: request } }, 'local')))
        expect(holder.instance.setupState.locked).toBe(false)
    })

    it('Reddet kilitliyken de CALISIR: 4001 + sabit metin', async () => {
        const { app, holder, page, sent } = setup(buildRequest(mailTypedData()))
        await render(app)

        await holder.instance.setupState.cancel()

        const rejected = sent.find((m) => m.type === 'SIGN_MESSAGE_REJECTED')
        expect(rejected).toEqual({
            type: 'SIGN_MESSAGE_REJECTED',
            requestId: 'req-td-1',
            status: 'error',
            error: { code: 4001, message: TYPED_DATA_USER_REJECT_MESSAGE },
        })
        expect(confirmMessages(sent)).toHaveLength(0)
        expect(page.currentPage).toBe('home')
    })
})

describe('SignTypedData.vue (SSR) -- kisaltma varken "tumunu goster" (G1/6)', () => {
    // Esikler T2'nin gorunum modelinden gelir (DEFAULT_VIEW_LIMITS): ekran kendi sayisini uydurmaz.
    const MAX_CHARS = DEFAULT_VIEW_LIMITS.maxStringChars
    const LONG = 'A'.repeat(MAX_CHARS + 100)
    const MANY = DEFAULT_VIEW_LIMITS.previewRows + 20

    it('uzun dize kisaltilir ve Imzala "tumunu goster"e KADAR kilitli kalir', async () => {
        const { app, holder } = setup(buildRequest(mailTypedData({ contents: LONG })))
        const html = await render(app)
        const state = holder.instance.setupState

        expect(state.needsExpand).toBe(true)
        expect(html).toContain('A'.repeat(MAX_CHARS))
        expect(html).not.toContain('A'.repeat(MAX_CHARS + 1))
        expect(html).toContain(T.truncated)
        expect(html).toContain(T.show_all)

        vi.advanceTimersByTime(700)
        expect(state.locked).toBe(false)
        expect(state.signDisabled).toBe(true)
    })

    it('tumunu goster acilinca TAM deger gorunur ve Imzala (kilit bitince) acilir', async () => {
        const { app, holder } = setup(buildRequest(mailTypedData({ contents: LONG })), {
            onCapture: (inst) => { inst.setupState.showAll = true },
        })
        const html = await render(app)
        const state = holder.instance.setupState

        expect(html).toContain(LONG)
        expect(html).toContain(T.show_less)
        expect(html).not.toContain(T.truncated)
        vi.advanceTimersByTime(700)
        expect(state.signDisabled).toBe(false)
    })

    it('onizleme satir sinirini asan istekte fazla satirlar GIZLENIR (silinmez), Imzala kilitli', async () => {
        const { app, holder } = setup(buildRequest(batchTypedData(MANY)))
        await render(app)
        const state = holder.instance.setupState

        expect(state.needsExpand).toBe(true)
        // 'values' grup satiri + MANY deger satirinin tamami DEGIL, yalniz onizleme kadari gorunur.
        expect(state.messageRows.length).toBeLessThan(MANY + 1)
        vi.advanceTimersByTime(700)
        expect(state.signDisabled).toBe(true)
    })

    it('tumunu goster acikken HICBIR satir gizlenmez', async () => {
        const { app, holder } = setup(buildRequest(batchTypedData(MANY)), {
            onCapture: (inst) => { inst.setupState.showAll = true },
        })
        await render(app)
        const state = holder.instance.setupState

        expect(state.messageRows).toHaveLength(MANY + 1)
        vi.advanceTimersByTime(700)
        expect(state.signDisabled).toBe(false)
    })

    it('satir tavani (overLimit) asilirsa ekran istegi -32602 ile reddeder, imza ISTENMEZ', async () => {
        const { app, page, sent } = setup(buildRequest(batchTypedData(DEFAULT_VIEW_LIMITS.maxRows + 10)))
        await render(app)
        vi.advanceTimersByTime(700)

        const rejected = sent.find((m) => m.type === 'SIGN_MESSAGE_REJECTED')
        expect(rejected.error.code).toBe(-32602)
        expect(confirmMessages(sent)).toHaveLength(0)
        // Neden metni gorunur kalir; home'a donus FAILURE_CLOSE_MS sonra.
        expect(page.currentPage).toBe('sign_typed_data')
        vi.advanceTimersByTime(1500)
        expect(page.currentPage).toBe('home')
    })

    it('kisaltma GEREKMEYEN istekte "tumunu goster" dugmesi ve uyari yok', async () => {
        const { app, holder } = setup(buildRequest(mailTypedData()))
        const html = await render(app)

        expect(holder.instance.setupState.needsExpand).toBe(false)
        expect(html).not.toContain(T.show_all)
        expect(html).not.toContain(T.truncated)
    })
})

describe('SignTypedData.vue (SSR) -- risk bandi (D4 Faz 1)', () => {
    it('DAI tipi permit: baslik, tur, SINIRSIZ bayragi ve harcayici TAM adres', async () => {
        const { app } = setup(buildRequest(daiPermitTypedData()))
        const html = await render(app)

        expect(html).toContain(T.permit_title)
        expect(html).toContain(T.kind_dai)
        expect(html).toContain(T.flag_unlimited)
        expect(html).toContain(BOB)
    })

    it('EIP-2612 permit MaxUint256: ham birim, "ondalik bilinmiyor" ve sinirsiz bayragi', async () => {
        const { app } = setup(buildRequest(erc2612TypedData()))
        const html = await render(app)

        expect(html).toContain(T.kind_erc2612)
        expect(html).toContain(MAX_UINT256)
        expect(html).toContain(T.units_unknown)
        expect(html).toMatch(new RegExp(T.flag_unlimited + '|' + T.flag_practically_unlimited))
    })

    it('chainId bildirmeyen permit: "ag belirtmiyor" notu + "her agda gecerli" UYARISI', async () => {
        const { app } = setup(buildRequest(erc2612TypedData({ withChain: false })))
        const html = await render(app)

        expect(html).toContain(T.chain_missing)
        expect(html).toContain(T.chain_missing_warning)
    })

    it('chainId bildirmeyen ama permit OLMAYAN istekte yalniz notr not var, uyari yok', async () => {
        const typedData = mailTypedData()
        typedData.types.EIP712Domain = [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }]
        delete typedData.domain.chainId
        delete typedData.domain.verifyingContract
        const { app } = setup(buildRequest(typedData))
        const html = await render(app)

        expect(html).toContain(T.chain_missing)
        expect(html).not.toContain(T.chain_missing_warning)
    })

    it('Seaport emri: "hicbir sey ALMIYORSUNUZ" bayragi ve verilen kalem listelenir', async () => {
        const { app } = setup(buildRequest(seaportZeroReturnTypedData()))
        const html = await render(app)

        expect(html).toContain(T.kind_seaport)
        // Seaport ilani token HARCAMA izni degil: sahte "tokenlarinizi harcayabilir" basligi YOK.
        expect(html).not.toContain(T.permit_title)
        expect(html).toContain(T.seaport_nothing)
        expect(html).toContain(T.seaport_give)
        expect(html).toContain(NFT)
    })

    it('kanonik olmayan permit benzeri istek: guclu "yorumlanamiyor" bandi', async () => {
        const { app } = setup(buildRequest(unknownPermitTypedData()))
        const html = await render(app)

        expect(html).toContain(T.permit_unknown_title)
        expect(html).not.toContain(T.kind_erc2612)
    })
})

describe('SignTypedData.vue (SSR) -- onay akisi (7.4 A, adim 6-7)', () => {
    async function unlocked(currentRequest, options) {
        const ctx = setup(currentRequest, options)
        await render(ctx.app)
        vi.advanceTimersByTime(700)
        return ctx
    }

    it('sign(): CONFIRM yalniz {account, requestId, expectedDigest} tasir, ardindan SIGN_MESSAGE_SUCCESS', async () => {
        const request = buildRequest(mailTypedData())
        const { holder, page, sent } = await unlocked(request)

        await holder.instance.setupState.sign()

        const confirm = confirmMessages(sent)
        expect(confirm).toHaveLength(1)
        expect(Object.keys(confirm[0].message).sort()).toEqual(['account', 'expectedDigest', 'requestId'])
        expect(confirm[0].message.account.address).toBe(ACCOUNT_B.address)
        expect(confirm[0].message.requestId).toBe('req-td-1')
        expect(confirm[0].message.expectedDigest).toBe(request.digest)

        const order = sent.map((m) => m.type)
        expect(order).toEqual(['SIGN_TYPED_DATA_CONFIRM', 'SIGN_MESSAGE_SUCCESS'])
        expect(sent[1]).toEqual({
            type: 'SIGN_MESSAGE_SUCCESS',
            requestId: 'req-td-1',
            status: 'success',
            data: { result: SIGNATURE },
        })
        expect(page.currentPage).toBe('home')
    })

    it('ikinci sign() cagrisi (cift tik) ikinci CONFIRM gondermez', async () => {
        const { holder, sent } = await unlocked(buildRequest(mailTypedData()), {
            confirmResponse: () => new Promise(() => {}), // yanit gelmez: loading kalir
        })
        const state = holder.instance.setupState

        state.sign()
        await state.sign()
        // Bekleyen mikro gorevlerin bitmesi icin bir makro tur (setImmediate sahte DEGIL).
        await new Promise((resolve) => setImmediate(resolve))

        expect(state.loading).toBe(true)
        expect(confirmMessages(sent)).toHaveLength(1)
    })

    it('arka plan 4100 donerse: ret 4100 ile iletilir, "izin kalkti" gosterilir, ekran temizlenir', async () => {
        const { holder, page, sent } = await unlocked(buildRequest(mailTypedData()), {
            confirmResponse: () => ({ success: false, error: { code: 4100, message: 'The requested account and/or method has not been authorized by the user.' } }),
        })

        await holder.instance.setupState.sign()

        expect(holder.instance.setupState.failure).toBe('revoked')
        expect(sent.find((m) => m.type === 'SIGN_MESSAGE_REJECTED').error.code).toBe(4100)
        expect(sent.find((m) => m.type === 'SIGN_MESSAGE_SUCCESS')).toBeUndefined()
        // "izin kalkti" metni gorunur kalir; home'a donus 1500 ms sonra.
        expect(page.currentPage).toBe('sign_typed_data')
        vi.advanceTimersByTime(1500)
        expect(page.currentPage).toBe('home')
    })

    it('basarisizlik metni home a donmeden ONCE gorunur: izin kalkti 1499 ms ekranda, sonra temizlenir', async () => {
        const { app, holder, page } = setup(buildRequest(mailTypedData()), {
            confirmResponse: () => ({ success: false, error: { code: 4100, message: 'x' } }),
        })
        await render(app)
        vi.advanceTimersByTime(700)

        await holder.instance.setupState.sign()
        expect(holder.instance.setupState.failure).toBe('revoked')
        expect(holder.instance.setupState.signDisabled).toBe(true)

        vi.advanceTimersByTime(1499)
        expect(page.currentPage).toBe('sign_typed_data')
        vi.advanceTimersByTime(1)
        expect(page.currentPage).toBe('home')
    })

    it('basarisizlik sonrasi Reddet ikinci bir ret GONDERMEZ ve zamanlayiciyi iptal eder', async () => {
        const { app, holder, page, sent } = setup(buildRequest(mailTypedData()), {
            confirmResponse: () => ({ success: false, error: { code: 4100, message: 'x' } }),
        })
        await render(app)
        vi.advanceTimersByTime(700)
        await holder.instance.setupState.sign()
        expect(sent.filter((m) => m.type === 'SIGN_MESSAGE_REJECTED')).toHaveLength(1)

        await holder.instance.setupState.cancel()

        expect(sent.filter((m) => m.type === 'SIGN_MESSAGE_REJECTED')).toHaveLength(1)
        expect(page.currentPage).toBe('home')
    })

    it('arka plan "Request expired" (-32603) donerse: "istek suresi doldu" gosterilir', async () => {
        const { holder, sent } = await unlocked(buildRequest(mailTypedData()), {
            confirmResponse: () => ({ success: false, error: { code: -32603, message: 'Request expired' } }),
        })

        await holder.instance.setupState.sign()

        expect(holder.instance.setupState.failure).toBe('expired')
        const rejected = sent.find((m) => m.type === 'SIGN_MESSAGE_REJECTED')
        expect(rejected.error).toEqual({ code: -32603, message: 'Request expired' })
    })

    it('kodsuz arka plan hatasi SAYISAL kodla (-32603) iletilir', async () => {
        const { holder, sent } = await unlocked(buildRequest(mailTypedData()), {
            confirmResponse: () => ({ success: false }),
        })

        await holder.instance.setupState.sign()

        const rejected = sent.find((m) => m.type === 'SIGN_MESSAGE_REJECTED')
        expect(Number.isInteger(rejected.error.code)).toBe(true)
        expect(rejected.error.code).toBe(-32603)
        expect(holder.instance.setupState.failure).toBe('invalid')
    })

    it('imzasiz "basarili" yanit imza SAYILMAZ: SUCCESS gonderilmez', async () => {
        const { holder, sent } = await unlocked(buildRequest(mailTypedData()), {
            confirmResponse: () => ({ success: true }),
        })

        await holder.instance.setupState.sign()

        expect(sent.find((m) => m.type === 'SIGN_MESSAGE_SUCCESS')).toBeUndefined()
        expect(sent.find((m) => m.type === 'SIGN_MESSAGE_REJECTED').error.code).toBe(-32603)
    })

    it('sendMessage firlatirsa -32603 ile reddedilir, ekran 1500 ms sonra home a doner', async () => {
        const { holder, page, sent } = await unlocked(buildRequest(mailTypedData()), {
            confirmResponse: () => { throw new Error('Extension context invalidated') },
        })

        await holder.instance.setupState.sign()

        expect(sent.find((m) => m.type === 'SIGN_MESSAGE_REJECTED').error.code).toBe(-32603)
        expect(page.currentPage).toBe('sign_typed_data')
        vi.advanceTimersByTime(1500)
        expect(page.currentPage).toBe('home')
        expect(holder.instance.setupState.loading).toBe(false)
    })

    it('gosterilen istek diskte baska bir istekle degismisse CONFIRM GONDERILMEZ, yenisi yuklenir', async () => {
        const { holder, stub, sent } = await unlocked(buildRequest(mailTypedData(), { id: 'req-td-1' }))
        const replacement = buildRequest(mailTypedData({ contents: 'Second' }), { id: 'req-td-2' })
        stub.localStore.current_request = replacement

        await holder.instance.setupState.sign()

        expect(confirmMessages(sent)).toHaveLength(0)
        expect(holder.instance.setupState.request.id).toBe('req-td-2')
        expect(holder.instance.setupState.signDisabled).toBe(true)
    })
})

describe('SignTypedData.vue (SSR) -- bozuk / eksik kayit (kapali-basarisiz)', () => {
    it('signWith hicbir kasada yoksa ret 4100, imza ISTENMEZ, ekran 1500 ms sonra home a doner', async () => {
        const stranger = '0x3333333333333333333333333333333333333333'
        const { app, page, sent } = setup(buildRequest(mailTypedData(), { signer: stranger }))
        await render(app)

        const rejected = sent.find((m) => m.type === 'SIGN_MESSAGE_REJECTED')
        expect(rejected.requestId).toBe('req-td-1')
        expect(rejected.error.code).toBe(4100)
        expect(confirmMessages(sent)).toHaveLength(0)
        expect(page.currentPage).toBe('sign_typed_data')
        vi.advanceTimersByTime(1500)
        expect(page.currentPage).toBe('home')
    })

    it('saklanan ozet gosterilen veriyle uyusmuyorsa ret -32603, imza ISTENMEZ', async () => {
        const request = buildRequest(mailTypedData())
        request.digest = '0x' + '11'.repeat(32)
        const { app, page, sent, holder } = setup(request)
        await render(app)
        vi.advanceTimersByTime(700)

        const rejected = sent.find((m) => m.type === 'SIGN_MESSAGE_REJECTED')
        expect(rejected.error.code).toBe(-32603)
        expect(confirmMessages(sent)).toHaveLength(0)
        expect(page.currentPage).toBe('sign_typed_data')
        vi.advanceTimersByTime(1500)
        expect(page.currentPage).toBe('home')
        expect(holder.instance.setupState.signDisabled).toBe(true)
    })

    it('current_request yok / baska tip: "istek suresi doldu", Imzala kalici kilitli, mesaj YOK', async () => {
        const { app, holder, sent } = setup(undefined)
        const html = await render(app)
        vi.advanceTimersByTime(700)

        expect(html).toContain(T.request_expired)
        expect(holder.instance.setupState.signDisabled).toBe(true)
        expect(sent).toHaveLength(0)
    })

    it('baska tipte (SIGN_MESSAGE) kayit bu ekranda imzalanamaz', async () => {
        const { app, holder, sent } = setup({ type: 'SIGN_MESSAGE', id: 'x', origin: 'https://dapp.example' })
        await render(app)
        vi.advanceTimersByTime(700)

        expect(holder.instance.setupState.signDisabled).toBe(true)
        expect(sent).toHaveLength(0)
    })
})

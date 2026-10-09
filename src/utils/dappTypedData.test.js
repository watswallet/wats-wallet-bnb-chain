import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Wallet, verifyTypedData } from 'ethers'
import { hashTypedData } from 'viem'
import supported_chains from '../data/supported_chains.json'
import { buildTypedDataView } from './eip712/view'

/**
 * eth_signTypedData_v4: istek kapisi (`signTypedDataDapp`) ve onay ani yeniden
 * dogrulama (`confirmStoredTypedData`).
 *
 * Gercek EIP-712 modulleri (T1) ve gercek `dappFunctions.js` (yalniz chrome ve
 * `approvalThrottle` taklit) kullanilir; imza gercek bir rastgele cuzdanla atilir
 * ve `ethers.verifyTypedData` / viem `hashTypedData` ile BAGIMSIZ dogrulanir.
 * Hicbir sabit anahtar/tohum yok: cuzdan her kosuda rastgele uretilir.
 */

vi.mock('./approvalThrottle', () => ({ checkApprovalThrottle: vi.fn(() => ({ ok: true })), noteApprovalRejected: vi.fn() }))

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const OP_CHAIN = supported_chains.find((c) => c.chainId === 10)
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')

// Ek B: Lab'in typed data yuku (spec bolum "Ek B", BIREBIR).
const MAIL = {"domain":{"name":"Ether Mail","version":"1","chainId":1,"verifyingContract":"0xcccccccccccccccccccccccccccccccccccccccc"},"message":{"from":{"name":"Cow","wallet":"0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826"},"to":{"name":"Bob","wallet":"0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"},"contents":"Hello, Bob!"},"primaryType":"Mail","types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],"Person":[{"name":"name","type":"string"},{"name":"wallet","type":"address"}],"Mail":[{"name":"from","type":"Person"},{"name":"to","type":"Person"},{"name":"contents","type":"string"}]}}

// Ayni yuk, EIP712Domain'de chainId BILDIRILMEDEN (chainCheck = 'missing').
const NO_CHAIN = {
    domain: { name: 'Ether Mail', version: '1' },
    types: {
        EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }],
        Person: MAIL.types.Person,
        Mail: MAIL.types.Mail,
    },
    primaryType: 'Mail',
    message: MAIL.message,
}

// DAI tipi permit; `allowed` JSON STRING "false" (sikiyaprak gecisi bunu reddetmeli).
const DAI_BAD_LEAF = {
    domain: { name: 'Dai Stablecoin', version: '1', chainId: 1, verifyingContract: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
    types: {
        EIP712Domain: MAIL.types.EIP712Domain,
        Permit: [
            { name: 'holder', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'nonce', type: 'uint256' },
            { name: 'expiry', type: 'uint256' }, { name: 'allowed', type: 'bool' },
        ],
    },
    primaryType: 'Permit',
    message: { holder: '0x1111111111111111111111111111111111111111', spender: '0x2222222222222222222222222222222222222222', nonce: 0, expiry: 0, allowed: 'false' },
}

// Satir tavani (spec 9 madde 4): `uint16[]` dizisi; domain 2 satir (name, chainId) + grup 1 satir
// + N eleman satiri. N = 497 TAM 500 satir (gecer), N = 600 tavani asar (-32602).
// Satir sayisi T2'nin gercek `buildTypedDataView`'i ile test icinde de dogrulanir (varsayim degil, olcum).
const listPayload = (count) => ({
    domain: { name: 'Big List', chainId: '1' },
    types: {
        EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }],
        Thing: [{ name: 'v', type: 'uint16[]' }],
    },
    primaryType: 'Thing',
    message: { v: Array.from({ length: count }, (_, i) => String(i)) },
})

const wallet = Wallet.createRandom()
const ADDR = wallet.address
const ORIGIN = 'https://dapp.example'

let localStore
let mod
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

const senderFor = (origin) => ({ origin, url: origin + '/app', tab: { url: origin + '/app', favIconUrl: origin + '/fav.ico' } })
const dappSender = senderFor(ORIGIN)
const walletUiSender = { url: 'chrome-extension://wats/src/popup/index.html#window' }
const isWalletUiMessage = (sender) => typeof sender?.url === 'string' && sender.url.startsWith('chrome-extension://wats/')

// viem, EIP712Domain'i tipler arasinda ISTEMEZ; oracle ozeti buradan.
function oracleDigest(td) {
    const { EIP712Domain, ...types } = td.types
    return hashTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message })
}

beforeEach(async () => {
    vi.resetModules()
    localStore = {
        currentNetwork: ETH_CHAIN,
        active_account: { key: 'k1', address: ADDR, name: 'Hesap 1', type: 'hd' },
        dapps: { 'dapp.example': { accounts: [ADDR], chainId: '0x1', origin: ORIGIN } },
        vaults: [{ id: 'v1', accounts: [{ key: 'k1', address: ADDR, name: 'Hesap 1', type: 'hd' }] }],
    }
    installChromeStub()
    dappFunctions = await import('./dappFunctions')
    mod = await import('./dappTypedData')
})

async function sign({ params, sender = dappSender, openWindow } = {}) {
    const sendResponse = vi.fn()
    const open = openWindow ?? vi.fn(async () => {})
    await mod.signTypedDataDapp({ method: 'eth_signTypedData_v4', params }, sender, sendResponse, open)
    return { sendResponse, open }
}

// ---------------------------------------------------------------------------
// signTypedDataDapp
// ---------------------------------------------------------------------------

describe('signTypedDataDapp: mutlu yol', () => {
    it('onay penceresini DOGRU kayitla acar; dapp\'e hemen yanit GITMEZ', async () => {
        const { sendResponse, open } = await sign({ params: [ADDR, JSON.stringify(MAIL)] })

        expect(sendResponse).not.toHaveBeenCalled()
        expect(open).toHaveBeenCalledOnce()
        const [requestId, respond, currentRequest] = open.mock.calls[0]
        expect(respond).toBe(sendResponse)
        expect(currentRequest).toMatchObject({
            type: 'SIGN_TYPED_DATA',
            id: requestId,
            origin: ORIGIN,
            favicon: ORIGIN + '/fav.ico',
            signWith: ADDR,
            chainCheck: 'match',
        })
        expect(typeof currentRequest.createdAt).toBe('number')
        expect(Math.abs(currentRequest.createdAt - Date.now())).toBeLessThan(5000)
        expect(currentRequest.typedData.primaryType).toBe('Mail')
        expect(currentRequest.typedData.domain.name).toBe('Ether Mail')
        expect(Object.keys(currentRequest.typedData).sort()).toEqual(['domain', 'message', 'primaryType', 'types'])
    })

    it('`digest` BAGIMSIZ viem oracle\'i ile BIREBIR ayni (Ether Mail)', async () => {
        const { open } = await sign({ params: [ADDR, JSON.stringify(MAIL)] })
        expect(open.mock.calls[0][2].digest).toBe(oracleDigest(MAIL))
    })

    it('typedData nesne olarak da gelebilir; ozet ayni', async () => {
        const { open } = await sign({ params: [ADDR, MAIL] })
        expect(open.mock.calls[0][2].digest).toBe(oracleDigest(MAIL))
    })

    it('adres farkli harf buyuklugunde gelse de kabul edilir; `signWith` SAKLI yazimdir', async () => {
        const { sendResponse, open } = await sign({ params: [ADDR.toLowerCase(), JSON.stringify(MAIL)] })

        expect(sendResponse).not.toHaveBeenCalled()
        expect(open.mock.calls[0][2].signWith).toBe(ADDR)
    })

    it('chainId BILDIRILMEMIS yuk reddedilmez; chainCheck = "missing"', async () => {
        const { sendResponse, open } = await sign({ params: [ADDR, JSON.stringify(NO_CHAIN)] })

        expect(sendResponse).not.toHaveBeenCalled()
        expect(open.mock.calls[0][2].chainCheck).toBe('missing')
    })

    it('her istek BENZERSIZ requestId alir', async () => {
        const a = await sign({ params: [ADDR, JSON.stringify(MAIL)] })
        const b = await sign({ params: [ADDR, JSON.stringify(MAIL)] })

        expect(a.open.mock.calls[0][0]).not.toBe(b.open.mock.calls[0][0])
    })

    it('`openWindow` verilmezse GERCEK openApprovalWindow kullanilir: current_request yazilir, istek Map\'e girer', async () => {
        const sendResponse = vi.fn()
        await mod.signTypedDataDapp({ method: 'eth_signTypedData_v4', params: [ADDR, JSON.stringify(MAIL)] }, dappSender, sendResponse)

        expect(chrome.windows.create).toHaveBeenCalledOnce()
        expect(localStore.current_request).toMatchObject({ type: 'SIGN_TYPED_DATA', origin: ORIGIN, signWith: ADDR })
        expect(dappFunctions.pendingRequests.has(localStore.current_request.id)).toBe(true)
        expect(sendResponse).not.toHaveBeenCalled()
    })
})

describe('signTypedDataDapp: pencere ACILMADAN reddedilenler', () => {
    async function reddedildi(params, kod, extra = {}) {
        const { sendResponse, open } = await sign({ params, ...extra })
        expect(open).not.toHaveBeenCalled()
        expect(sendResponse).toHaveBeenCalledOnce()
        const { error } = sendResponse.mock.calls[0][0]
        expect(error.code).toBe(kod)
        expect(typeof error.message).toBe('string')
        expect(localStore.current_request).toBeUndefined()
        return error
    }

    it('kisit dolduysa -32005; depoya HIC dokunulmaz (ayristirmadan ONCE)', async () => {
        const { checkApprovalThrottle } = await import('./approvalThrottle')
        checkApprovalThrottle.mockReturnValueOnce({ ok: false, retryAfterMs: 4000 })

        const error = await reddedildi([ADDR, JSON.stringify(MAIL)], -32005)

        expect(error.message).toBe('Rate limited')
        expect(checkApprovalThrottle).toHaveBeenCalledWith(ORIGIN)
        expect(chrome.storage.local.get).not.toHaveBeenCalled()
    })

    it('EVM disi ag aktifken 4901 (CHAIN_NOT_EVM)', async () => {
        localStore.currentNetwork = SOLANA_CHAIN
        const error = await reddedildi([ADDR, JSON.stringify(MAIL)], 4901)
        expect(error.message).toBe('CHAIN_NOT_EVM')
    })

    it.each([
        ['params yok', undefined],
        ['yalniz adres', [ADDR]],
        ['bozuk JSON', [ADDR, '{not json']],
        ['bos nesne', [ADDR, {}]],
        ['adres bozuk', ['0x123', JSON.stringify(MAIL)]],
    ])('bozuk parametre (%s) -> -32602', async (_ad, params) => {
        await reddedildi(params, -32602)
    })

    it('sikiyaprak gecisi: `allowed: "false"` (JSON string) -32602 ile reddedilir (DAI permit tuzagi)', async () => {
        await reddedildi([ADDR, JSON.stringify(DAI_BAD_LEAF)], -32602)
    })

    it('bildirilmis chainId aktif zincirle UYUSMUYORSA -32602 ("must match the active chainId")', async () => {
        localStore.currentNetwork = OP_CHAIN
        const error = await reddedildi([ADDR, JSON.stringify(MAIL)], -32602)
        expect(error.message).toContain('must match the active chainId')
    })

    it('baglanmamis origin -> 4100', async () => {
        localStore.dapps = {}
        await reddedildi([ADDR, JSON.stringify(MAIL)], 4100)
    })

    it('baglanmis ama istenen adres VERILMEMIS -> 4100', async () => {
        localStore.dapps['dapp.example'].accounts = ['0x9999990000000000000000000000000000000009']
        await reddedildi([ADDR, JSON.stringify(MAIL)], 4100)
    })

    it('saklanan TAM origin gonderenle ESIT degilse (ayni hostname, farkli baglanti noktasi) -> 4100', async () => {
        await reddedildi([ADDR, JSON.stringify(MAIL)], 4100, { sender: senderFor('https://dapp.example:8443') })
    })

    it('ESKI kayit (`origin` alani yok) hostname\'e duser: https gonderen kabul edilir', async () => {
        delete localStore.dapps['dapp.example'].origin
        const { sendResponse, open } = await sign({ params: [ADDR, JSON.stringify(MAIL)] })

        expect(sendResponse).not.toHaveBeenCalled()
        expect(open).toHaveBeenCalledOnce()
    })

    it('duz http yalniz localhost/127.0.0.1 icin kabul; baska alan adi 4100 (kayit olsa bile)', async () => {
        delete localStore.dapps['dapp.example'].origin
        await reddedildi([ADDR, JSON.stringify(MAIL)], 4100, { sender: senderFor('http://dapp.example') })
    })

    it.each(['http://localhost:5173', 'http://127.0.0.1:3000'])('%s kabul edilir (yerel gelistirme)', async (origin) => {
        const host = new URL(origin).hostname
        localStore.dapps = { [host]: { accounts: [ADDR], chainId: '0x1', origin } }
        const { sendResponse, open } = await sign({ params: [ADDR, JSON.stringify(MAIL)], sender: senderFor(origin) })

        expect(sendResponse).not.toHaveBeenCalled()
        expect(open).toHaveBeenCalledOnce()
    })

    it('4100 mesaji dappFunctions.js\'teki UNAUTHORIZED ile AYNI metin (kardes kapilar)', async () => {
        const typed = await reddedildi([ADDR, JSON.stringify(MAIL)], 4100, { sender: senderFor('https://baska.example') })

        const sendResponse = vi.fn()
        await dappFunctions.sendTxDapp({ params: [{ from: ADDR, to: ADDR, value: '0x0' }] }, senderFor('https://baska.example'), sendResponse)
        expect(typed.message).toBe(sendResponse.mock.calls[0][0].error.message)
    })

    // Spec 9 (4): boyut siniri asilirsa pencere ACILMADAN reddedilir (T1 `parse.js` 256 KiB ustunu -32602 ile reddeder; kapi bunu pencere acmadan once uygular).
    it('boyut siniri asildi (300 KiB ham JSON) -> -32602; pencere ACILMAZ', async () => {
        const huge = JSON.stringify({ ...MAIL, message: { ...MAIL.message, contents: 'x'.repeat(300 * 1024) } })
        await reddedildi([ADDR, huge], -32602)
    })

    // Spec 9 (4) ve 6 G1/6: satir tavani (500) asilirsa pencere ACILMADAN -32602 (karari bu kapi verir; T2 `overLimit` sinyalini uretir).
    it('satir tavani asildi (600 eleman) -> -32602 "Typed data is too large to display."; pencere ACILMAZ, current_request YAZILMAZ', async () => {
        const td = listPayload(600)
        expect(buildTypedDataView(td).overLimit).toBe(true) // on kosul: fixture gercekten tavani asiyor
        const error = await reddedildi([ADDR, JSON.stringify(td)], -32602)
        expect(error.message).toBe('Typed data is too large to display.')
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('TAM tavandaki yuk (500 satir) GECER: overLimit DEGILDIR, pencere acilir', async () => {
        const td = listPayload(497)
        const view = buildTypedDataView(td)
        expect(view.rows).toHaveLength(500) // on kosul: fixture TAM tavanda
        expect(view.overLimit).toBe(false)

        const { sendResponse, open } = await sign({ params: [ADDR, JSON.stringify(td)] })
        expect(sendResponse).not.toHaveBeenCalled()
        expect(open).toHaveBeenCalledOnce()
        expect(open.mock.calls[0][2].typedData.primaryType).toBe('Thing')
    })

    it('baglanmamis origin + tavani asan yuk -> 4100 (yetkisiz site boyut sinirindan once reddedilir)', async () => {
        localStore.dapps = {}
        await reddedildi([ADDR, JSON.stringify(listPayload(600))], 4100)
    })

    // Spec 11 (2): origin, ust sekmeden DEGIL gonderen cerceveden (resolveSenderOrigin) gelir.
    it('iframe: gonderen cerceve (evil.example) hibeli DEGIL -> 4100, ust sekmenin (hibeli) host\'u sayilmaz', async () => {
        const iframeSender = { origin: 'https://evil.example', url: 'https://evil.example/embed', tab: { url: ORIGIN + '/app', favIconUrl: '' } }
        await reddedildi([ADDR, JSON.stringify(MAIL)], 4100, { sender: iframeSender })
    })

    it('iframe: gonderen cerceve (widget.example) hibeli ise ust sekme baska site olsa da KABUL; pencere kaydi cerceve origin\'i tasir', async () => {
        localStore.dapps['widget.example'] = { accounts: [ADDR], chainId: '0x1', origin: 'https://widget.example' }
        const iframeSender = { origin: 'https://widget.example', url: 'https://widget.example/embed', tab: { url: 'https://trusted.example/news', favIconUrl: '' } }
        const { sendResponse, open } = await sign({ params: [ADDR, JSON.stringify(MAIL)], sender: iframeSender })

        expect(sendResponse).not.toHaveBeenCalled()
        expect(open).toHaveBeenCalledOnce()
        expect(open.mock.calls[0][2].origin).toBe('https://widget.example')
    })
})

describe('signTypedDataDapp: beklenmedik hata', () => {
    it('openWindow firlatirsa dapp\'e -32603 "Internal Error" gider; ic ayrinti SIZMAZ', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const openWindow = vi.fn(async () => { throw new Error('secret internal detail') })
        const { sendResponse } = await sign({ params: [ADDR, JSON.stringify(MAIL)], openWindow })

        expect(sendResponse).toHaveBeenCalledWith({ error: { code: -32603, message: 'Internal Error' } })
    })
})

// ---------------------------------------------------------------------------
// confirmStoredTypedData
// ---------------------------------------------------------------------------

// Imzayi BAGIMSIZ dogrular: ethers.verifyTypedData imzalayan adresi verir.
function oracleVerify(td, signature) {
    const { EIP712Domain, ...types } = td.types
    return verifyTypedData(td.domain, types, td.message, signature)
}

// Gercek akisla bir istek kurar: signTypedDataDapp -> (enjekte) openWindow yakalar,
// diske `current_request` yazar ve Map'e koyar (gercek openApprovalWindow ayni isi yapar).
async function pendingTypedRequest(td = MAIL, params = [ADDR, JSON.stringify(td)]) {
    const { sendResponse, open } = await sign({ params })
    expect(sendResponse).not.toHaveBeenCalled()
    const currentRequest = open.mock.calls[0][2]
    localStore.current_request = currentRequest
    pending.add(currentRequest.id)
    return currentRequest
}

let pending
beforeEach(() => { pending = new Set() })

function makeDeps(overrides = {}) {
    const createSigner = vi.fn(async () => ({ signDigest: (hex) => wallet.signingKey.sign(hex).serialized }))
    return {
        deps: {
            isWalletUiMessage,
            hasPendingRequest: (id) => pending.has(id),
            createSigner,
            // Varsayilan saat: istegin olusumundan 1 sn SONRA (TTL icinde).
            now: () => (localStore.current_request?.createdAt ?? Date.now()) + 1000,
            ...overrides,
        },
        createSigner,
    }
}

async function confirm(currentRequest, { payload, sender = walletUiSender, deps } = {}) {
    const made = makeDeps(deps)
    const result = await mod.confirmStoredTypedData({
        message: { type: 'SIGN_TYPED_DATA_CONFIRM', message: { requestId: currentRequest.id, expectedDigest: currentRequest.digest, ...payload } },
        sender,
        deps: made.deps,
    })
    return { result, createSigner: made.createSigner }
}

describe('confirmStoredTypedData: mutlu yol', () => {
    it('imza BAGIMSIZ olarak dogrulanir: ethers.verifyTypedData imzalayan adresi verir', async () => {
        const req = await pendingTypedRequest()
        const { result } = await confirm(req)

        expect(result.success).toBe(true)
        expect(oracleVerify(MAIL, result.signature)).toBe(ADDR)
    })

    it('popup `account` (dizge ya da nesne, farkli harf) gonderirse ve imzacinin AYNISIYSA kabul edilir', async () => {
        const req = await pendingTypedRequest()

        expect((await confirm(req, { payload: { account: ADDR.toLowerCase() } })).result.success).toBe(true)
        expect((await confirm(req, { payload: { account: { address: ADDR, key: 'k1' } } })).result.success).toBe(true)
    })

    it('chainId bildirilmemis yuk: ag sonradan degisse de imza uretilir (ozet zincire bagli DEGIL)', async () => {
        const req = await pendingTypedRequest(NO_CHAIN)
        expect(req.chainCheck).toBe('missing')
        localStore.currentNetwork = OP_CHAIN

        const { result } = await confirm(req)

        expect(result.success).toBe(true)
        expect(oracleVerify(NO_CHAIN, result.signature)).toBe(ADDR)
    })

    it('popup\'in gonderdigi ek `typedData` YOK SAYILIR: imza diskteki KAYDA aittir', async () => {
        const req = await pendingTypedRequest()
        const tampered = { ...MAIL, message: { ...MAIL.message, contents: 'Send me all your money' } }
        const { result } = await confirm(req, { payload: { typedData: tampered, digest: oracleDigest(tampered) } })

        expect(result.success).toBe(true)
        expect(oracleVerify(MAIL, result.signature)).toBe(ADDR)
        expect(oracleVerify(tampered, result.signature)).not.toBe(ADDR)
    })
})

describe('confirmStoredTypedData: KAPALI-BASARISIZ (imza uretilmez, imzalayici HIC kurulmaz)', () => {
    async function reddedildi(req, kod, opts) {
        const { result, createSigner } = await confirm(req, opts)
        expect(result.success).toBe(false)
        expect(result.error.code).toBe(kod)
        expect(typeof result.error.message).toBe('string')
        expect(result.signature).toBeUndefined()
        expect(createSigner).not.toHaveBeenCalled()
        return result.error
    }

    it('(f) gonderen cuzdan arayuzu degilse (sayfa/icerik betigi) 4100', async () => {
        const req = await pendingTypedRequest()
        await reddedildi(req, 4100, { sender: dappSender })
    })

    it('requestId yok / bos -> -32602', async () => {
        const req = await pendingTypedRequest()
        const { deps, createSigner } = makeDeps()
        for (const requestId of [undefined, '', 42]) {
            const result = await mod.confirmStoredTypedData({
                message: { message: { requestId, expectedDigest: req.digest } },
                sender: walletUiSender,
                deps,
            })
            expect(result).toEqual({ success: false, error: { code: -32602, message: expect.any(String) } })
        }
        expect(createSigner).not.toHaveBeenCalled()
    })

    it('expectedDigest yok -> -32602', async () => {
        const req = await pendingTypedRequest()
        const { deps } = makeDeps()
        const result = await mod.confirmStoredTypedData({ message: { message: { requestId: req.id } }, sender: walletUiSender, deps })
        expect(result).toEqual({ success: false, error: { code: -32602, message: expect.any(String) } })
    })

    it('mesajin kendisi bos -> -32602 (firlatmaz)', async () => {
        const { deps } = makeDeps()
        const result = await mod.confirmStoredTypedData({ message: undefined, sender: walletUiSender, deps })
        expect(result.success).toBe(false)
        expect(result.error.code).toBe(-32602)
    })

    it('(a) bekleyen istek Map\'te YOK (SW yeniden basladi) -> -32603 "Request expired"', async () => {
        const req = await pendingTypedRequest()
        pending.clear()
        const error = await reddedildi(req, -32603)
        expect(error.message).toBe('Request expired')
    })

    it('(a) diskteki current_request BASKA bir istek -> -32603', async () => {
        const req = await pendingTypedRequest()
        localStore.current_request = { ...req, id: 'baska-id' }
        await reddedildi(req, -32603)
    })

    it('(a) diskteki kayit baska TIPTE (personal_sign) -> -32603', async () => {
        const req = await pendingTypedRequest()
        localStore.current_request = { type: 'SIGN_MESSAGE', id: req.id, origin: ORIGIN, signWith: ADDR }
        await reddedildi(req, -32603)
    })

    it('(a) diskte current_request hic yok -> -32603', async () => {
        const req = await pendingTypedRequest()
        delete localStore.current_request
        await reddedildi(req, -32603)
    })

    it('(d) TTL: tam 5 dk GECERLI, 5 dk + 1 ms SURESI DOLMUS -> -32603', async () => {
        const req = await pendingTypedRequest()
        const { result: ok } = await confirm(req, { deps: { now: () => req.createdAt + mod.TYPED_DATA_REQUEST_TTL_MS } })
        expect(ok.success).toBe(true)

        const error = await reddedildi(req, -32603, { deps: { now: () => req.createdAt + mod.TYPED_DATA_REQUEST_TTL_MS + 1 } })
        expect(error.message).toBe('Request expired')
    })

    it('(d) createdAt yok / sayi degil -> -32603', async () => {
        const req = await pendingTypedRequest()
        localStore.current_request = { ...req, createdAt: undefined }
        await reddedildi(req, -32603)
        localStore.current_request = { ...req, createdAt: 'dun' }
        await reddedildi(req, -32603)
    })

    it('TTL sabiti 5 dakikadir', () => {
        expect(mod.TYPED_DATA_REQUEST_TTL_MS).toBe(5 * 60 * 1000)
    })

    it('(b) pencere acikken izin KALKTI (kayit silindi) -> 4100', async () => {
        const req = await pendingTypedRequest()
        localStore.dapps = {}
        await reddedildi(req, 4100)
    })

    it('(b) imzalayan hesap izin listesinden CIKARILDI -> 4100', async () => {
        const req = await pendingTypedRequest()
        localStore.dapps['dapp.example'].accounts = ['0x9999990000000000000000000000000000000009']
        await reddedildi(req, 4100)
    })

    it('(b) kayitli TAM origin degisti -> 4100', async () => {
        const req = await pendingTypedRequest()
        localStore.dapps['dapp.example'].origin = 'https://dapp.example:8443'
        await reddedildi(req, 4100)
    })

    it('(b) kayittaki `signWith` bos/eksikse hibe ILK hesaba DUSMEZ: 4100', async () => {
        const req = await pendingTypedRequest()
        for (const signWith of ['', undefined, null]) {
            localStore.current_request = { ...req, signWith }
            await reddedildi(req, 4100)
        }
    })

    it('(c) bildirilmis chainId vardi, ag SONRADAN degisti -> -32602', async () => {
        const req = await pendingTypedRequest()
        expect(req.chainCheck).toBe('match')
        localStore.currentNetwork = OP_CHAIN
        const error = await reddedildi(req, -32602)
        expect(error.message).toContain('must match the active chainId')
    })

    it('(c) ag EVM disina gecti -> 4901', async () => {
        const req = await pendingTypedRequest()
        localStore.currentNetwork = SOLANA_CHAIN
        await reddedildi(req, 4901)
    })

    it('(e) popup baska bir `account` gonderirse -> 4100', async () => {
        const req = await pendingTypedRequest()
        await reddedildi(req, 4100, { payload: { account: '0x9999990000000000000000000000000000000009' } })
        await reddedildi(req, 4100, { payload: { account: { address: '0x9999990000000000000000000000000000000009' } } })
        await reddedildi(req, 4100, { payload: { account: {} } })
    })

    it('imzalayan hesap kasalarda YOK -> 4100', async () => {
        const req = await pendingTypedRequest()
        localStore.vaults = [{ id: 'v1', accounts: [] }]
        await reddedildi(req, 4100)
    })

    it('cuzdan KILITLI (createSigner "Wallet locked" firlatir) -> 4100 "Wallet is locked."', async () => {
        const req = await pendingTypedRequest()
        const { result } = await confirm(req, { deps: { createSigner: vi.fn(async () => { throw new Error('Wallet locked. Please enter your password.') }) } })

        expect(result).toEqual({ success: false, error: { code: 4100, message: 'Wallet is locked.' } })
    })

    it('createSigner baska bir hatayla coker -> -32603 "Internal Error" (ic ayrinti SIZMAZ)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const req = await pendingTypedRequest()
        const { result } = await confirm(req, { deps: { createSigner: vi.fn(async () => { throw new Error('vault decrypt failed: secret') }) } })

        expect(result).toEqual({ success: false, error: { code: -32603, message: 'Internal Error' } })
    })

    it('popup\'in gonderdigi ozet kayittan FARKLIYSA imza URETILMEZ (ekran/kayit bolunmesi)', async () => {
        const req = await pendingTypedRequest()
        const { result } = await confirm(req, { payload: { expectedDigest: oracleDigest({ ...MAIL, message: { ...MAIL.message, contents: 'x' } }) } })

        expect(result.success).toBe(false)
        expect(result.signature).toBeUndefined()
        expect(typeof result.error.code).toBe('number')
    })

    it('diskteki kayit ONAYDAN ONCE degistirilirse (mesaj icerigi) eski ozetle imza URETILMEZ', async () => {
        const req = await pendingTypedRequest()
        localStore.current_request = {
            ...req,
            typedData: { ...req.typedData, message: { ...req.typedData.message, contents: 'Tampered on disk' } },
        }
        const { result } = await confirm(req)

        expect(result.success).toBe(false)
        expect(result.signature).toBeUndefined()
    })

    it('hata dalinda `signature` ALANI HIC yoktur (yanit sekli: yalniz success + error)', async () => {
        const req = await pendingTypedRequest()
        pending.clear()
        const { result } = await confirm(req)

        expect(Object.keys(result).sort()).toEqual(['error', 'success'])
    })
})

describe('confirmStoredTypedData: deps eksik / bozuk (kapali-basarisiz)', () => {
    it('deps.hasPendingRequest yoksa firlatmaz; -32603 doner', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const req = await pendingTypedRequest()
        const result = await mod.confirmStoredTypedData({
            message: { message: { requestId: req.id, expectedDigest: req.digest } },
            sender: walletUiSender,
            deps: { isWalletUiMessage, createSigner: vi.fn(), now: () => req.createdAt + 1000 },
        })

        expect(result.success).toBe(false)
        expect(result.error.code).toBe(-32603)
    })
})

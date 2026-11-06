import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { getAddress, HDNodeWallet, JsonRpcProvider, Wallet, AbiCoder, Interface, id as keccakId, zeroPadValue, keccak256 } from 'ethers'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { createVault, deriveMasterKey, randBytes } from './utils/crypto-utils'
import { derivePrivateAccount } from './utils/privacy/privateAccount'
import { getAtsConfig } from './utils/atsConfig'
import { CANONICAL_GATEWAY } from './utils/privacy/silentswap'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya (test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// ATS ILE IADE (sahip karari 2026-10-30: gizli modda ag ucreti ASLA native coin ile odenmez). PRIVATE_ORDER_ATS burada UYGULANMAZ
// (silentswapConfig taklit edilmez): uretimdeki varsayilan (true) sinanir. Yalniz bundler/paymaster sinirlari taklit edilir:
// quoteAtsTransfer + executeAtsTransfer; izin RPC okumasi ve getNetwork da sahte, hicbir test ag'a gitmez.
const getOrderMock = vi.fn()
const quoteMock = vi.fn()
const atsMock = vi.fn()
const sendRefundNativeMock = vi.fn()

vi.mock('@silentswap/sdk', async (importOriginal) => ({
    ...(await importOriginal()),
    createSilentSwapClient: () => ({ quote: vi.fn(), getOrder: (...a) => getOrderMock(...a), reportDepositTransaction: vi.fn(async () => {}) }),
}))
vi.mock('./utils/privacy/privateOrderExec', async (importOriginal) => ({
    ...(await importOriginal()),
    // Native iade cagrilirsa TEST patlar (ATS acikken native kol ULASILMAZ olmali).
    sendRefund: (...a) => sendRefundNativeMock(...a),
}))
vi.mock('./utils/atsPaymaster', async (importOriginal) => ({
    ...(await importOriginal()),
    quoteAtsTransfer: (...a) => quoteMock(...a),
    executeAtsTransfer: (...a) => atsMock(...a),
}))

const MNEMONIC = 'test test test test test test test test test test test junk'
const T = '0x' + '01'.repeat(32)
// Iade hedefi KANONIK gateway'e esit olmak zorunda (gercek sendRefundAts calisir, hedef dogrulanir).
const GATEWAY = CANONICAL_GATEWAY
const nowSec = () => Math.floor(Date.now() / 1000)
const CREATED = Date.now() - 60 * 1000
const REFUND_TX = '0x' + 'ab'.repeat(32)
const USEROP = '0x' + 'cd'.repeat(32)
const ENTRY_POINT = getAtsConfig(56).entryPoint
const REFUND_IFACE = new Interface(['function refund(bytes32 ticket)'])

let A, GIZLI, vault, jwk, A_KEY, GIZLI_KEY
beforeAll(async () => {
    const masterKey = await deriveMasterKey('parola-123456', randBytes(32))
    const path = "m/44'/60'/0'/0/0"
    const root = HDNodeWallet.fromPhrase(MNEMONIC, null, 'm')
    const addr = root.derivePath(path).address
    A_KEY = root.derivePath(path).privateKey
    A = { key: 'a-1', name: 'Hesap 1', type: 'hd', index: 0, derivationPath: path, address: addr }
    vault = await createVault(masterKey, MNEMONIC, A)
    GIZLI = derivePrivateAccount(MNEMONIC, vault, { name: 'Gizli Hesap' })
    GIZLI_KEY = root.derivePath(GIZLI.derivationPath).privateKey
    vault.privateAccount = GIZLI
    jwk = await crypto.subtle.exportKey('jwk', masterKey)
}, 60000)

// Para yukle siparisi: kaynak NORMAL hesap (a-1). Gonder siparisi: kaynak Gizli Hesap.
const fundOrder = (over) => ({
    ticket: T, accessToken: 'tok', sourceAccountKey: 'a-1', sourceChainId: 56, outputAddress: GIZLI.address,
    summary: { payoutUsdc: '25.0' }, depositTxHash: '0xh', status: 'FAILED', state: failedState(A.address), refundTxHash: null, createdAt: CREATED, ...over,
})
const sendOrder = (over) => fundOrder({ sourceAccountKey: GIZLI.key, outputAddress: '0x' + '22'.repeat(20), state: failedState(GIZLI.address), ...over })
const failedState = (signer, over) => ({
    status: 'FAILED', signer, gateway: GATEWAY, expirationUnix: nowSec() - 10, recipients: [{ status: 'FAILED', recipientTxHash: null }], ...over,
})
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)) }
const goodQuote = (over = {}) => ({
    ready: true, mode: 'normal', decision: null, atsBalance: 500, transferFee: 24.87, bootstrapFee: 11.24, opCount: 1, ...over,
})

let bg
async function boot({ active = GIZLI, orders = [fundOrder()], unlocked = true } = {}) {
    getOrderMock.mockReset()
    bg = await bootBackground({
        localStore: { active_account: active, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {}, private_orders: orders },
        sessionStore: unlocked ? { sessionMasterKeyJwk: jwk } : {},
    })
    await flush()
}
const stored = () => bg.localStore.private_orders[0]
const refund = () => bg.call({ type: 'PRIVATE_REFUND', message: { ticket: T } })
const list = async () => (await bg.call({ type: 'PRIVATE_ORDERS' })).orders

// Zincirde bir UserOperationEvent kaydi (EntryPoint v0.8): [topic0, userOpHash, sender, paymaster], data = nonce, success, cost, gas.
const opEventLog = (sender, success, userOpHash = USEROP) => ({
    address: ENTRY_POINT,
    topics: [keccakId('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)'), userOpHash, zeroPadValue(sender, 32), zeroPadValue('0x' + '33'.repeat(20), 32)],
    data: AbiCoder.defaultAbiCoder().encode(['uint256', 'bool', 'uint256', 'uint256'], [1n, success, 0n, 0n]),
})

let signSpy
let broadcastSpy
let balanceSpy
beforeEach(() => {
    quoteMock.mockReset()
    atsMock.mockReset()
    sendRefundNativeMock.mockReset()
    quoteMock.mockImplementation(async () => goodQuote())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(JsonRpcProvider.prototype, 'getNetwork').mockResolvedValue({ chainId: 56n })
    vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockResolvedValue(null)
    // Hicbir native yol (imza, yayin, BNB bakiyesi okuma) calismamali.
    signSpy = vi.spyOn(Wallet.prototype, 'signTransaction')
    broadcastSpy = vi.spyOn(JsonRpcProvider.prototype, 'broadcastTransaction').mockResolvedValue({})
    balanceSpy = vi.spyOn(JsonRpcProvider.prototype, 'getBalance').mockResolvedValue(0n)
})
afterEach(async () => {
    await flush()
    teardownBackground()
    vi.restoreAllMocks()
})

const noNativeSigning = () => {
    expect(sendRefundNativeMock).not.toHaveBeenCalled()
    expect(signSpy).not.toHaveBeenCalled()
    expect(balanceSpy).not.toHaveBeenCalled()
}

describe('PRIVATE_REFUND ATS ile (native yok)', () => {
    it('op yalniz refund(ticket) cagrisi + ATS ucretidir; KAYNAK hesaptan gider; marker op oncesi yazilir; native imza yok', async () => {
        await boot()
        getOrderMock.mockResolvedValueOnce(failedState(A.address))
        let markerAtSend = null
        atsMock.mockImplementation(async ({ onRelayed }) => {
            markerAtSend = stored().refundAtsPendingAt
            onRelayed({ txHash: REFUND_TX, kind: 'transfer' })
            return { hash: USEROP, txHash: REFUND_TX }
        })
        expect(await refund()).toEqual({ success: true, hash: REFUND_TX })

        const expectedCall = { to: GATEWAY, data: REFUND_IFACE.encodeFunctionData('refund', [T]), value: 0n }
        // Fiyat teklifi ve op AYNI tek cagriyla, AYNI kaynak hesap icin, 'private' op turuyle (komisyon yok).
        expect(quoteMock).toHaveBeenCalledTimes(1)
        expect(quoteMock.mock.calls[0][0]).toMatchObject({ chainId: 56, address: A.address, calls: [expectedCall], opKind: 'private' })
        expect(atsMock).toHaveBeenCalledTimes(1)
        const args = atsMock.mock.calls[0][0]
        expect(args.calls).toEqual([expectedCall])
        expect(args.chainId).toBe(56)
        expect(args.opKind).toBe('private')
        expect(args.privateKey).toBe(A_KEY)
        expect(new Wallet(args.privateKey).address).toBe(A.address)
        // Op'a verilen teklif, onceden alinan ucret teklifidir (ust sinir olarak uygulanir).
        expect(args.quoted.transferFee).toBe(24.87)
        // Kalici "iade suruyor" isareti op'tan ONCE yazildi; basari sonrasi kalkti.
        expect(typeof markerAtSend).toBe('number')
        expect(stored()).toMatchObject({ refundTxHash: REFUND_TX, refundVia: 'ats', refundSender: A.address, refundConfirmed: true, refundAtsPendingAt: null, rawRefundTx: null })
        noNativeSigning()
        expect(broadcastSpy).not.toHaveBeenCalled()
    })

    it('Gonder siparisi (kaynak Gizli Hesap): op Gizli Hesap anahtariyla gider', async () => {
        await boot({ orders: [sendOrder()] })
        getOrderMock.mockResolvedValueOnce(failedState(GIZLI.address))
        atsMock.mockImplementation(async ({ onRelayed }) => { onRelayed({ txHash: REFUND_TX, kind: 'transfer' }); return { txHash: REFUND_TX } })
        expect(await refund()).toEqual({ success: true, hash: REFUND_TX })
        expect(quoteMock.mock.calls[0][0].address).toBe(GIZLI.address)
        expect(atsMock.mock.calls[0][0].privateKey).toBe(GIZLI_KEY)
        noNativeSigning()
    })

    it('kurulum modu (2 op): gereken = iade ucreti + kurulum ucreti', async () => {
        await boot()
        getOrderMock.mockResolvedValueOnce(failedState(A.address))
        quoteMock.mockImplementation(async () => goodQuote({ mode: 'bootstrap', opCount: 2, atsBalance: 30 }))
        const res = await refund()
        expect(res).toMatchObject({ success: false, error: 'PRIVATE_INSUFFICIENT_ATS', atsBalance: 30 })
        expect(res.atsNeeded).toBeCloseTo(24.87 + 11.24, 6)
        expect(atsMock).not.toHaveBeenCalled()
    })

    describe('ATS yetersiz', () => {
        it('Para yukle iadesi: gereken ve bakiye doner, payerPrivate false, HICBIR sey kaydedilmez, siparis iade edilebilir KALIR', async () => {
            await boot()
            getOrderMock.mockResolvedValue(failedState(A.address))
            quoteMock.mockImplementation(async () => goodQuote({ atsBalance: 3 }))
            expect(await refund()).toEqual({ success: false, error: 'PRIVATE_INSUFFICIENT_ATS', atsNeeded: 24.87, atsBalance: 3, payerPrivate: false })
            expect(atsMock).not.toHaveBeenCalled()
            expect(stored().refundAtsPendingAt).toBeUndefined()
            expect(stored().refundTxHash).toBeNull()
            noNativeSigning()
            expect((await list())[0]).toMatchObject({ refundable: true, refundPending: false })

            // ATS yuklenince AYNI siparis iade edilir.
            quoteMock.mockImplementation(async () => goodQuote({ atsBalance: 100 }))
            atsMock.mockImplementation(async ({ onRelayed }) => { onRelayed({ txHash: REFUND_TX, kind: 'transfer' }); return { txHash: REFUND_TX } })
            expect(await refund()).toEqual({ success: true, hash: REFUND_TX })
        })

        it('Gonder iadesi (ucreti Gizli Hesap oder): payerPrivate true', async () => {
            await boot({ orders: [sendOrder()] })
            getOrderMock.mockResolvedValue(failedState(GIZLI.address))
            quoteMock.mockImplementation(async () => goodQuote({ atsBalance: 0 }))
            expect(await refund()).toMatchObject({ success: false, error: 'PRIVATE_INSUFFICIENT_ATS', payerPrivate: true })
        })

        it('sunucu "ATS al" karari (balance-missing) ve op oncesi ret de ayni kod; marker geri alinir, siparis iade edilebilir', async () => {
            await boot()
            getOrderMock.mockResolvedValue(failedState(A.address))
            atsMock.mockRejectedValue(Object.assign(new Error('bakiye yok'), { code: 'balance-missing' }))
            const res = await refund()
            expect(res).toMatchObject({ success: false, error: 'PRIVATE_INSUFFICIENT_ATS', payerPrivate: false })
            expect(atsMock).toHaveBeenCalledTimes(1)
            expect(stored().refundAtsPendingAt).toBeNull()
            expect((await list())[0]).toMatchObject({ refundable: true, refundPending: false })
            noNativeSigning()
        })
    })

    it('ATS su an kullanilamiyor (ucret teklifi hazir degil): PRIVATE_ATS_UNAVAILABLE, hicbir sey gonderilmez, native imza yok', async () => {
        await boot()
        getOrderMock.mockResolvedValueOnce(failedState(A.address))
        quoteMock.mockImplementation(async () => goodQuote({ ready: false, decision: { action: 'run-onboarding', severity: 'user' } }))
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_ATS_UNAVAILABLE' })
        expect(atsMock).not.toHaveBeenCalled()
        expect(stored().refundAtsPendingAt).toBeUndefined()
        noNativeSigning()
    })

    it('op relay edilmeden reddedildi (paymaster duraklatildi): marker geri alinir, PRIVATE_ATS_UNAVAILABLE, yeniden iade edilebilir', async () => {
        await boot()
        getOrderMock.mockResolvedValue(failedState(A.address))
        atsMock.mockRejectedValue(Object.assign(new Error('paymaster-paused'), { code: 'paymaster-paused' }))
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_ATS_UNAVAILABLE' })
        expect(stored().refundAtsPendingAt).toBeNull()
        expect((await list())[0]).toMatchObject({ refundable: true })
        noNativeSigning()
    })

    it('hedef gateway dogrulanir: bilinmeyen gateway NOT_ALLOWED, ATS cagrisi ve kayit YOK', async () => {
        await boot()
        getOrderMock.mockResolvedValueOnce(failedState(A.address, { gateway: '0x' + '99'.repeat(20) }))
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
        expect(quoteMock).not.toHaveBeenCalled()
        expect(atsMock).not.toHaveBeenCalled()
        expect(stored().refundAtsPendingAt).toBeUndefined()
    })

    describe('belirsiz sonuc: ayni ticket otomatik tekrar gonderilmez', () => {
        it('hash YOK ama op calismis olabilir (nonce ilerledi): UNCONFIRMED, marker KALICI, siparis iade edilebilir gorunmez, ikinci iade reddedilir', async () => {
            await boot()
            getOrderMock.mockResolvedValue(failedState(A.address))
            atsMock.mockRejectedValue(Object.assign(new Error('islem sonucu dogrulanamadi'), { opMayHaveRun: true }))
            expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_UNCONFIRMED' })
            expect(typeof stored().refundAtsPendingAt).toBe('number')
            expect(stored().refundTxHash).toBeNull()
            expect((await list())[0]).toMatchObject({ refundable: false, refundPending: true, refundStatusUnknown: false })

            expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
            expect(atsMock).toHaveBeenCalledTimes(1)
            noNativeSigning()
        })

        it('servis calisani yeniden basladiktan sonra da (bellek isareti yok) marker siparisi kilitli tutar', async () => {
            await boot({ orders: [fundOrder({ refundAtsPendingAt: Date.now() - 1000, refundVia: 'ats', refundSender: A.address })] })
            getOrderMock.mockResolvedValue(failedState(A.address))
            expect((await list())[0]).toMatchObject({ refundable: false, refundPending: true })
            expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
            expect(atsMock).not.toHaveBeenCalled()
        })

        it('relay edildi (hash var) ama sonuc dogrulanamadi: hash kaydedilir, UNCONFIRMED + txHash, tekrar gonderilmez', async () => {
            await boot()
            getOrderMock.mockResolvedValue(failedState(A.address))
            atsMock.mockImplementation(async ({ onRelayed }) => {
                onRelayed({ txHash: REFUND_TX, kind: 'transfer' })
                throw Object.assign(new Error('transfer islemi basarisiz veya sonucu dogrulanamadi'), { opSuccess: null })
            })
            expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_UNCONFIRMED', txHash: REFUND_TX })
            expect(stored()).toMatchObject({ refundTxHash: REFUND_TX, refundVia: 'ats', refundConfirmed: false, refundAtsPendingAt: null, rawRefundTx: null })
            expect((await list())[0]).toMatchObject({ refundable: false, refundPending: true, phase: 'refunded' })
            expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
            expect(atsMock).toHaveBeenCalledTimes(1)
        })

        it('op zincirde BASARISIZ (opSuccess false): iade OLMADI, kayit temizlenir, siparis tekrar iade edilebilir, PRIVATE_FAILED', async () => {
            await boot()
            getOrderMock.mockResolvedValue(failedState(A.address))
            atsMock.mockImplementation(async ({ onRelayed }) => {
                onRelayed({ txHash: REFUND_TX, kind: 'transfer' })
                throw Object.assign(new Error('transfer islemi basarisiz veya sonucu dogrulanamadi'), { opSuccess: false })
            })
            expect(await refund()).toEqual({ success: false, error: 'PRIVATE_FAILED' })
            expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true, refundAtsPendingAt: null })
            expect((await list())[0]).toMatchObject({ refundable: true, refundFailed: true })
        })
    })

    describe('uzlastirma', () => {
        const pendingAts = (over = {}) => fundOrder({ refundTxHash: REFUND_TX, refundVia: 'ats', refundSender: A.address, refundConfirmed: false, refundSentAt: Date.now() - 5 * 60 * 1000, updatedAt: Date.now() - 5 * 60 * 1000, ...over })
        const bootFresh = async (orders) => {
            getOrderMock.mockReset()
            bg = await bootBackground({
                localStore: { active_account: GIZLI, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {}, private_orders: orders },
                sessionStore: { sessionMasterKeyJwk: jwk },
            })
            await flush()
        }

        it('ATS iadesi: paket tx status 1 + UserOperationEvent success=true -> onaylandi', async () => {
            vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockResolvedValue({ status: 1, logs: [opEventLog(A.address, true)] })
            await bootFresh([pendingAts()])
            expect(stored()).toMatchObject({ refundTxHash: REFUND_TX, refundConfirmed: true })
        })

        it('paket tx status 1 ama op BASARISIZ: iade OLMADI sayilir (kayit temizlenir, Iade geri gelir)', async () => {
            vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockResolvedValue({ status: 1, logs: [opEventLog(A.address, false)] })
            await bootFresh([pendingAts()])
            expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true })
            expect((await list())[0]).toMatchObject({ refundable: true })
        })

        it('baska kullanicinin op olayi sayilmaz: kaynak hesabin olayi yoksa belirsiz kalir', async () => {
            const other = '0x' + '44'.repeat(20)
            vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockResolvedValue({ status: 1, logs: [opEventLog(getAddress(other), true)] })
            await bootFresh([pendingAts()])
            expect(stored()).toMatchObject({ refundTxHash: REFUND_TX, refundConfirmed: false })
            expect(stored().refundFailed).not.toBe(true)
        })

        it('makbuz yok: kayit oldugu gibi kalir, yeniden yayin YOK (ATS iadesinin ham bayti olmaz)', async () => {
            await bootFresh([pendingAts()])
            expect(stored()).toMatchObject({ refundTxHash: REFUND_TX, refundConfirmed: false })
            expect(broadcastSpy).not.toHaveBeenCalled()
        })

        it('hash\'siz marker: sunucu durumu iade hash\'i verirse kayit o hash\'e gecer ve marker kalkar', async () => {
            const marked = fundOrder({ refundAtsPendingAt: Date.now() - 5 * 60 * 1000, refundVia: 'ats', refundSender: A.address, updatedAt: Date.now() - 5 * 60 * 1000 })
            getOrderMock.mockReset()
            getOrderMock.mockResolvedValue({ ...failedState(A.address), refundTxHash: REFUND_TX })
            bg = await bootBackground({
                localStore: { active_account: GIZLI, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {}, private_orders: [marked] },
                sessionStore: { sessionMasterKeyJwk: jwk },
            })
            await flush()
            await list()
            expect(stored()).toMatchObject({ refundTxHash: REFUND_TX, refundVia: 'ats', refundAtsPendingAt: null, refundConfirmed: false })
            expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
        })

        it('hash\'siz marker: sunucu hala iade gormuyorsa marker KALIR (otomatik yeniden gonderim yok)', async () => {
            const marked = fundOrder({ refundAtsPendingAt: Date.now() - 5 * 60 * 1000, refundVia: 'ats', refundSender: A.address, updatedAt: Date.now() - 5 * 60 * 1000 })
            getOrderMock.mockReset()
            getOrderMock.mockResolvedValue(failedState(A.address))
            bg = await bootBackground({
                localStore: { active_account: GIZLI, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {}, private_orders: [marked] },
                sessionStore: { sessionMasterKeyJwk: jwk },
            })
            await flush()
            await list()
            expect(typeof stored().refundAtsPendingAt).toBe('number')
            expect(stored().refundTxHash).toBeNull()
            expect(atsMock).not.toHaveBeenCalled()
        })

        it('24 saati asan hash\'siz marker: ekran "durumu bilinmiyor" der, sunucuya sorulmaz', async () => {
            const old = Date.now() - 25 * 60 * 60 * 1000
            const marked = fundOrder({ refundAtsPendingAt: old, refundVia: 'ats', refundSender: A.address, updatedAt: old, createdAt: old })
            await bootFresh([marked])
            const o = (await list())[0]
            expect(o).toMatchObject({ refundable: false, refundPending: true, refundStatusUnknown: true })
            expect(getOrderMock).not.toHaveBeenCalled()
        })

        it('ESKI native iade kaydi (refundVia yok, ham bayt var): makbuz yoksa ham bayt yeniden yayinlanir, makbuz status 1 ise onaylanir', async () => {
            const raw = '0x' + 'f1'.repeat(60)
            const hash = keccak256(raw)
            const legacy = (over = {}) => fundOrder({ refundTxHash: hash, rawRefundTx: raw, refundConfirmed: false, refundSentAt: Date.now() - 5 * 60 * 1000, updatedAt: Date.now() - 5 * 60 * 1000, ...over })
            await bootFresh([legacy()])
            expect(broadcastSpy).toHaveBeenCalledWith(raw)
            expect(stored()).toMatchObject({ refundTxHash: hash, refundConfirmed: false })

            vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockResolvedValue({ status: 1 })
            await bootFresh([legacy()])
            expect(stored()).toMatchObject({ refundTxHash: hash, refundConfirmed: true, rawRefundTx: null })
        })
    })
})

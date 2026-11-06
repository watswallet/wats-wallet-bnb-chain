// GIZLI MODDA KURTARMA ISCILERI DURUR (yayin 1.10, Gorev C).
//
// Sizinti: recoverTonFees() (alarm tiki, HEARTBEAT, onStartup, onInstalled) ve checkAndRecoverPendingTxs()
// (HEARTBEAT, onStartup, onInstalled) gizli mod kapisi olmadan calisiyordu. Normal modda yarim kalmis bir TON ucreti ya da
// bekleyen bir Solana/EVM islemi varsa, kullanici Gizli Hesaba gecince NORMAL hesap adina /ton/rpc, /solana/rpc ve zincir RPC
// istekleri gidiyordu. Kapi iki iscinin KENDI icinde (activeIsPrivate, fail-closed): hangi yoldan tetiklenirse tetiklensin
// gizli modda hicbir ag istegi atilmaz; gizli moddan cikinca sonraki tik/HEARTBEAT kaldigi yerden surer (kayitlar kalicidir).
// Emsal: pollCowOrdersSafe / claimRefundsSafe (background.cowPrivacy.test.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'
import { blokGovdesi } from './test-utils/kaynakTarama'

heavyBackgroundTimeouts()

const SOL_SIG = '5wHu1qwD4kLwYqLnJp7iHKGaTZKhcJPvBrfLGgAv1LcjJGLzL8pTDNe6Q7Zvg1cKp8oFJqPvzxTnGaVKhWnZbUqR'
const EVM_HASH = '0x' + 'ab'.repeat(32)

// Zincire/aga cikan her yol casuslu sahte: gizli modda HICBIRI cagrilmamali.
const recoverTon = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./utils/ton/tonFeeRecovery', async (importOriginal) => ({
    ...(await importOriginal()),
    recoverTonSettlements: (...a) => recoverTon(...a),
}))
const solanaRpc = vi.hoisted(() => vi.fn(async () => ({ value: [null] })))
vi.mock('./utils/solana/client', async (importOriginal) => ({
    ...(await importOriginal()),
    solanaRpc: (...a) => solanaRpc(...a),
}))
const providerCtor = vi.hoisted(() => vi.fn())
const getReceipt = vi.hoisted(() => vi.fn(async () => null))
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SpyProvider {
        constructor(...args) { providerCtor(...args) }
        getTransactionReceipt(...args) { return getReceipt(...args) }
    }
    return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: SpyProvider } }
})

const GIZLI = { key: 'g-1', address: '0x' + 'cd'.repeat(20), type: 'hd', private: true, derivationPath: "m/44'/60'/0'/1/0" }
const A = { key: 'a-1', address: '0x' + 'ab'.repeat(20), type: 'hd', index: 0, derivationPath: "m/44'/60'/0'/0/0" }

const kayitlar = () => ({
    // Normal modda yarim kalmis: bir Solana imzasi, bir EVM hash'i ve 'processing' bir arayuz islemi.
    pending_transactions: [
        { hash: SOL_SIG, chainId: 'solana-mainnet', receipt_status: 'pending', block_timestamp: new Date().toISOString() },
        { hash: EVM_HASH, receipt_status: 'pending', block_timestamp: new Date().toISOString() },
    ],
    current_transactions: [
        { id: 'c1', status: 'processing', meta: { txHash: EVM_HASH, chainId: 56 } },
    ],
})

let bg
let fetchSpy

const bosalt = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)) }

async function boot({ active, storageLocalGet = true }) {
    bg = await bootBackground({
        localStore: {
            active_account: active,
            vaults: [{ type: 'hd', accounts: [A], privateAccount: GIZLI }],
            currentNetwork: { chainId: 56, name: 'BNB Smart Chain' },
            dapps: {},
            ...kayitlar(),
        },
        sessionStore: { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } },
        storageLocalGet,
    })
    await bosalt()
    recoverTon.mockClear()
    solanaRpc.mockClear()
    providerCtor.mockClear()
    getReceipt.mockClear()
    fetchSpy.mockClear()
}

const aga = () => ({
    ton: recoverTon.mock.calls.length,
    solana: solanaRpc.mock.calls.length,
    evm: providerCtor.mock.calls.length + getReceipt.mock.calls.length,
    fetch: fetchSpy.mock.calls.length,
})
const SIFIR = { ton: 0, solana: 0, evm: 0, fetch: 0 }

// Dort tetikleyici yol.
const YOLLAR = {
    HEARTBEAT: async () => { await bg.call({ type: 'HEARTBEAT' }); await bosalt() },
    onStartup: async () => { for (const fn of bg.listeners.onStartup) await fn(); await bosalt() },
    onInstalled: async () => { for (const fn of bg.listeners.onInstalled) await fn({ reason: 'update' }); await bosalt() },
    'alarm tiki': async () => { await bg.listeners.onAlarm[0]({ name: 'checkInactivity' }); await bosalt() },
}

beforeEach(() => {
    fetchSpy = vi.fn(async () => { throw new Error('ag kapali') })
    vi.stubGlobal('fetch', fetchSpy)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
    await bosalt()
    teardownBackground()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('kurtarma iscileri -- gizli mod (Gizli Hesap aktif)', () => {
    beforeEach(() => boot({ active: GIZLI }))

    it.each(Object.keys(YOLLAR))('%s: TON ucret kurtarmasi, Solana ve EVM kurtarmasi hicbir ag istegi atmaz', async (yol) => {
        await YOLLAR[yol]()
        expect(aga()).toEqual(SIFIR)
    })

    it('bekleyen kayitlar korunur (silinmez, cozulmez)', async () => {
        const once = structuredClone(bg.localStore.pending_transactions)
        const ctxOnce = structuredClone(bg.localStore.current_transactions)
        await YOLLAR.HEARTBEAT()
        await YOLLAR.onStartup()
        expect(bg.localStore.pending_transactions).toEqual(once)
        expect(bg.localStore.current_transactions).toEqual(ctxOnce)
    })

    it('gizli moddan cikinca (sonraki HEARTBEAT) ayni kayitlar icin kurtarma kaldigi yerden surer', async () => {
        await YOLLAR.HEARTBEAT()
        expect(aga()).toEqual(SIFIR)

        bg.localStore.active_account = A // mod her cagrida OKUNUR
        await YOLLAR.HEARTBEAT()

        await vi.waitFor(() => {
            expect(recoverTon).toHaveBeenCalled()
            expect(solanaRpc).toHaveBeenCalled()
            expect(getReceipt).toHaveBeenCalled()
        })
    })
})

describe('kurtarma iscileri -- depo okunamazsa FAIL-CLOSED (gizli say)', () => {
    beforeEach(() => boot({ active: A, storageLocalGet: false }))

    it('chrome.storage.local.get yokken (okunamayan mod) iki isci de ag istegi atmaz', async () => {
        await YOLLAR.HEARTBEAT()
        await YOLLAR.onStartup()
        expect(aga()).toEqual(SIFIR)
    })
})

describe('kurtarma iscileri -- normal mod (kapi araya girmez)', () => {
    beforeEach(() => boot({ active: A }))

    it.each(Object.keys(YOLLAR))('%s: kurtarma calisir (TON ucret kurtarmasi cagrilir)', async (yol) => {
        await YOLLAR[yol]()
        await vi.waitFor(() => expect(recoverTon).toHaveBeenCalled())
    })

    it('HEARTBEAT: bekleyen Solana imzasi ve EVM hash i zincirden sorulur', async () => {
        await YOLLAR.HEARTBEAT()
        await vi.waitFor(() => {
            expect(solanaRpc).toHaveBeenCalledWith('getSignatureStatuses', expect.anything())
            expect(getReceipt).toHaveBeenCalledWith(EVM_HASH)
        })
    })
})

// Kaynak kilidi: kapi iki iscinin KENDI govdesinde ve ilk ag/depo isinden ONCE olmali (cagiran yollara bagimli degil).
describe('background.js -- kurtarma iscilerinin kapisi (kaynak)', () => {
    const kaynak = readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8')

    it.each([
        ['async function recoverTonFees(', 'recoverTonSettlements('],
        ['async function runPendingRecovery(', 'chrome.storage.local.get'],
    ])('%s govdesi activeIsPrivate() ile baslar, ilk ag/depo isinden ONCE', (imza, ilkIs) => {
        const govde = blokGovdesi(kaynak, imza)
        expect(govde).not.toBeNull()
        const kapi = govde.indexOf('activeIsPrivate()')
        const is = govde.indexOf(ilkIs)
        expect(kapi).toBeGreaterThan(-1)
        expect(is).toBeGreaterThan(-1)
        expect(kapi).toBeLessThan(is)
    })
})

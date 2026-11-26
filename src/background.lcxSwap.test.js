import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { HDNodeWallet, Interface, AbiCoder, MaxUint256, getAddress, formatUnits, parseUnits } from 'ethers'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { createVault, deriveMasterKey, randBytes } from './utils/crypto-utils'
import { derivePrivateAccount } from './utils/privacy/privateAccount'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'
import { LcxUnavailableError, LcxRefusalError } from './utils/lcx/client'
import { LCX_ROUTERS } from './utils/lcx/routerGuard'
import { resolveTxError } from './utils/txErrors'
import { BSTOCKS } from './data/bStocks'
import { RETIRED_BSTOCKS } from './data/bStocksRetired'
import { XSTOCKS } from './data/xStocks'
import { RETIRED_XSTOCKS } from './data/xStocksRetired'
import { ATS_SALE_ATS } from './utils/atsSaleConfig'
import stableQuote from './utils/lcx/fixtures/stable-quote-base-usdc-usdt.json'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// SWAP ve ATS_SWAP_FEE_QUOTE LCX DALI (Bolum 1, Gorev 7). Imza yolu: her ret / uyusmazlik yolunda HICBIR imza ya da
// gonderim fonksiyonu (executeAtsTransfer, executeSponsored, cuzdanin sendTransaction'i, bundler token imzasi) cagrilmaz
// ve bugunku motor (buildSwapCalls / executeSwap) YEDEK olarak calismaz.
//
// Ag yoktur: LCX istemcisinin build ucu, ATS / gazsiz yurutuculer, saglayici (yalniz izin okumasi) ve cuzdanin gonderimi
// taklit edilir. Teklif eslemesi (calls.js), build dogrulamasi (routerGuard.js), cagri listesi ve arka plan akisi
// GERCEKTIR. Hata siniflari GERCEK siniflardir: istemci bir kez alinip saklanir (bkz. background.lcxQuote.test.js).
const flag = vi.hoisted(() => ({ on: true }))
const keep = vi.hoisted(() => ({ client: null }))
const h = vi.hoisted(() => ({
    buildMock: vi.fn(),        // utils/lcx/client fetchLcxBuild
    quoteMock: vi.fn(),        // utils/lcx/client fetchLcxQuote (yurutmede ASLA cagrilmamali)
    stablesMock: vi.fn(),      // utils/lcx/client fetchLcxStablecoins (yurutmede ASLA cagrilmamali)
    decimals: vi.fn(),         // MultiChainSwapManager#getTokenDecimals
    buildSwapCalls: vi.fn(),   // bugunku motor (ATS / gazsiz)
    executeSwap: vi.fn(),      // bugunku motor (normal)
    executeAts: vi.fn(),
    quoteAts: vi.fn(),
    executeSponsored: vi.fn(),
    bundlerToken: vi.fn(),
    sendTx: vi.fn(),           // HDNodeWallet / Wallet #sendTransaction
    providerCall: vi.fn(),     // JsonRpcProvider#call (allowance okumasi)
    balance: vi.fn(),          // MultiChainSwapManager#getTokenBalance (bakiye kapisi + MAX artigi)
    gate: vi.fn(),
    saleQuote: vi.fn(),        // utils/atsSale fetchAtsSaleQuote (satis motoru)
    saleExec: vi.fn(),         // utils/atsSale executeAtsSale (satis motoru)
}))

vi.mock('ethers', async (importOriginal) => {
    const real = await importOriginal()
    real.HDNodeWallet.prototype.sendTransaction = function (...a) { return h.sendTx(...a) }
    real.Wallet.prototype.sendTransaction = function (...a) { return h.sendTx(...a) }
    class FakeProvider {
        constructor(url) { this.url = url }
        call(tx) { return h.providerCall(tx) }
    }
    return { ...real, JsonRpcProvider: FakeProvider, ethers: { ...real.ethers, JsonRpcProvider: FakeProvider } }
})
vi.mock('./utils/lcx/client', async (importOriginal) => {
    keep.client ??= await importOriginal()
    return {
        ...keep.client,
        fetchLcxBuild: (...a) => h.buildMock(...a),
        fetchLcxQuote: (...a) => h.quoteMock(...a),
        fetchLcxStablecoins: (...a) => h.stablesMock(...a),
    }
})
vi.mock('./utils/swap', async (importOriginal) => ({
    ...(await importOriginal()),
    MultiChainSwapManager: class {
        getTokenDecimals(address) { return h.decimals(address) }
        getTokenBalance(...a) { return h.balance(...a) }
        buildSwapCalls(...a) { return h.buildSwapCalls(...a) }
        executeSwap(...a) { return h.executeSwap(...a) }
    },
}))
vi.mock('./utils/atsSale', async (importOriginal) => ({
    ...(await importOriginal()),
    fetchAtsSaleQuote: (...a) => h.saleQuote(...a),
    executeAtsSale: (...a) => h.saleExec(...a),
    saleGaslessClient: () => ({ sahte: true }),
}))
vi.mock('./utils/atsPaymaster', async (importOriginal) => ({
    ...(await importOriginal()),
    executeAtsTransfer: (...a) => h.executeAts(...a),
    quoteAtsTransfer: (...a) => h.quoteAts(...a),
}))
vi.mock('./utils/smartAccount', async (importOriginal) => ({
    ...(await importOriginal()),
    executeSponsored: (...a) => h.executeSponsored(...a),
}))
vi.mock('./utils/bundlerAuth', async (importOriginal) => ({
    ...(await importOriginal()),
    getBundlerToken: (...a) => h.bundlerToken(...a),
}))
// Ilk alim kapisi agdan okunan kural tablosuna baglidir; bu dosya LCX dalini olcer: kapi her zaman ok.
vi.mock('./utils/stockGate/gate', async (importOriginal) => ({
    ...(await importOriginal()),
    createStockGate: () => ({
        evaluate: (...a) => h.gate(...a),
        evaluateBridgeTarget: async () => ({ ok: true }),
        status: async () => ({ ok: true }),
    }),
}))

const MNEMONIC = 'test test test test test test test test test test test junk'
let A, GIZLI, vault, jwk
beforeAll(async () => {
    const masterKey = await deriveMasterKey('parola-123456', randBytes(32))
    const hd = HDNodeWallet.fromPhrase(MNEMONIC, null, 'm')
    const path1 = "m/44'/60'/0'/0/0"
    A = { key: 'a-1', name: 'Hesap 1', type: 'hd', index: 0, derivationPath: path1, address: hd.derivePath(path1).address }
    vault = await createVault(masterKey, MNEMONIC, A)
    GIZLI = derivePrivateAccount(MNEMONIC, vault, { name: 'Gizli Hesap' })
    vault.privateAccount = GIZLI
    jwk = await crypto.subtle.exportKey('jwk', masterKey)
}, 60000)

let bg
async function boot(signer = A, { privacyFlag } = {}) {
    // privacyFlag 'false': arka plan acilista Gizli Hesap'i genel hesaba geri alir; imzaci acilistan SONRA yazilir
    // (bkz. background.lcxQuote.test.js).
    const acilis = privacyFlag === 'false' ? A : signer
    vi.stubEnv('VITE_LCX_ENABLED', flag.on ? 'true' : 'false')
    bg = await bootBackground({
        privacyFlag,
        localStore: { active_account: acilis, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {} },
        sessionStore: { sessionMasterKeyJwk: jwk },
    })
    if (acilis !== signer) {
        for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
        bg.localStore.active_account = structuredClone(signer)
    }
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)) }

// --- Sabitler ve sentetik LCX verisi --------------------------------------------------------------------------------
const ROUTER_A = '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0'
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const NATIVE = '0x0000000000000000000000000000000000000000'
const BASE_USDC = getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
const BASE_WETH = getAddress('0x4200000000000000000000000000000000000006')
const ETH_USDT = getAddress('0xdac17f958d2ee523a2206206994597c13d831ec7')
const ETH_USDC = getAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955'
const POOL = getAddress('0x2222222222222222222222222222222222222222')
const OTHER = getAddress('0x4444444444444444444444444444444444444444')
const MAX_HEX = MaxUint256.toString(16)

const SWAP_SPLIT_ABI =
    'function swapSplit(address tokenIn, address tokenOut, uint256 totalIn, uint256 minAmountOut, address recipient, uint256 deadline, (uint256 amountIn, (uint8 family, address pool, address tokenIn, address tokenOut, uint256 aux)[] hops)[] legs) payable returns (uint256 amountOut)'
const router = new Interface([SWAP_SPLIT_ABI])
const erc20 = new Interface(['function approve(address spender, uint256 amount) returns (bool)'])
const approveData = (spender, amount) => erc20.encodeFunctionData('approve', [spender, amount])
const allowanceReply = (v) => AbiCoder.defaultAbiCoder().encode(['uint256'], [v])
const nowSec = () => Math.floor(Date.now() / 1000)

// Base: 2 USDC -> WETH. amountIn = 2 * 10^6 (USDC 6 ondalik). Fikstur (quote-base-usdc-weth): MIN_OUT = floor(AMOUNT_OUT * 0.995).
const AMOUNT_IN = 2_000_000n
const AMOUNT_OUT = 1_109_639_748_685_926n
const MIN_OUT = 1_104_091_549_942_496n

function swapCalldata(over = {}) {
    const a = {
        tokenIn: BASE_USDC, tokenOut: BASE_WETH, totalIn: AMOUNT_IN, minAmountOut: MIN_OUT,
        recipient: A.address, deadline: BigInt(nowSec() + 300), ...over,
    }
    const legs = [{ amountIn: a.totalIn, hops: [{ family: 2, pool: POOL, tokenIn: a.tokenIn, tokenOut: a.tokenOut, aux: 0n }] }]
    return router.encodeFunctionData('swapSplit', [a.tokenIn, a.tokenOut, a.totalIn, a.minAmountOut, a.recipient, a.deadline, legs])
}
const build = ({ to = ROUTER_A, value = '0', approval = { target: ROUTER_A }, ...over } = {}) => ({
    tx: { to, data: swapCalldata(over), value },
    approval,
})
const lcxQuote = (over = {}) => ({
    kind: 'swap', quoteId: 'q_test_1', chainId: 8453, tokenIn: BASE_USDC, tokenOut: BASE_WETH,
    amountIn: AMOUNT_IN.toString(), amountOut: AMOUNT_OUT.toString(), minOut: MIN_OUT.toString(), slippageBps: 50,
    expiresAt: nowSec() + 60, spender: ROUTER_A, ...over,
})
const ATS_QUOTED = { transferFee: '1000', commissionFee: '10' }
const swapMsg = ({ mode = 'normal', ...over } = {}) => ({
    type: 'SWAP',
    message: {
        index: 0, chainId: 8453, inTokenAddress: BASE_USDC, outTokenAddress: BASE_WETH, amount: '2', slippage: 0.5,
        lcxQuote: lcxQuote(), ...(mode === 'ats' ? { atsSwap: true, atsQuoted: ATS_QUOTED } : {}),
        ...(mode === 'gasless' ? { gasToken: BASE_USDC, bundlerBase: 'https://bundler.test' } : {}),
        ...over,
    },
})
const feeMsg = (over = {}) => ({ type: 'ATS_SWAP_FEE_QUOTE', message: { ...swapMsg().message, atsSwap: true, ...over } })
const MODES = ['ats', 'gasless', 'normal']

const LEGACY_CALLS = [{ to: OTHER, value: 0n, data: '0x1234' }]

// Normal yol gonderimi: her gonderim siraya yazilir, makbuz beklemesi de.
let order
function txResponse(hash, receipt = { status: 1 }) {
    return { hash, wait: vi.fn(async () => { order.push(`wait:${hash}`); return receipt }) }
}

beforeEach(() => {
    for (const m of Object.values(h)) m.mockReset()
    flag.on = true
    order = []
    h.gate.mockResolvedValue({ ok: true })
    h.decimals.mockImplementation(async (address) => {
        const a = String(address).toLowerCase()
        return [BASE_USDC, ETH_USDT, ETH_USDC, BSC_USDT].some((t) => t.toLowerCase() === a) ? 6 : 18
    })
    h.buildMock.mockImplementation(async () => build())
    h.providerCall.mockImplementation(async () => allowanceReply(0n))
    h.executeAts.mockResolvedValue({ hash: '0xuserop', txHash: '0xatstx' })
    h.quoteAts.mockResolvedValue({ transferFee: '1000', commissionFee: '10' })
    h.executeSponsored.mockResolvedValue({ hash: '0xsponsored', waitPromise: Promise.resolve({ receipt: { status: 'success', transactionHash: '0xsptx' } }) })
    h.bundlerToken.mockResolvedValue('bundler-token')
    h.buildSwapCalls.mockResolvedValue({ calls: LEGACY_CALLS, meta: {} })
    h.executeSwap.mockResolvedValue({ hash: '0xlegacy', waitPromise: Promise.resolve({ status: 1 }) })
    // Varsayilan: bol bakiye (kapi gecer, MAX artigi kirpmasi devreye girmez).
    h.balance.mockResolvedValue(10n ** 30n)
    h.saleQuote.mockRejectedValue(new Error('sale quote down'))
    let n = 0
    h.sendTx.mockImplementation(async (req) => {
        n += 1
        const hash = `0xsent${n}`
        order.push(`send:${hash}`)
        return txResponse(hash)
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
    await settle()
    teardownBackground()
    vi.restoreAllMocks()
})

// Hicbir imza / gonderim yapilmadi ve bugunku motor yedek olarak calismadi.
function expectNothingSigned() {
    expect(h.executeAts).not.toHaveBeenCalled()
    expect(h.executeSponsored).not.toHaveBeenCalled()
    expect(h.sendTx).not.toHaveBeenCalled()
    expect(h.bundlerToken).not.toHaveBeenCalled()
    expect(h.buildSwapCalls).not.toHaveBeenCalled()
    expect(h.executeSwap).not.toHaveBeenCalled()
    expect(h.saleExec).not.toHaveBeenCalled()
}
const cards = () => bg.localStore.current_transactions || []

describe('SWAP: LCX dali uc yurutme yolu', () => {
    it('1. lcxQuote + atsSwap: build {kind, quoteId, recipient, slippageBps}; executeAtsTransfer [approve(router, amountIn), takas] opKind swap', async () => {
        await boot()

        const res = await bg.call(swapMsg({ mode: 'ats' }))

        expect(res).toEqual({ success: true, hash: '0xuserop' })
        expect(h.buildMock).toHaveBeenCalledTimes(1)
        expect(h.buildMock).toHaveBeenCalledWith({ kind: 'swap', quoteId: 'q_test_1', recipient: A.address, slippageBps: 50 })
        expect(h.executeAts).toHaveBeenCalledTimes(1)
        const arg = h.executeAts.mock.calls[0][0]
        const b = await h.buildMock.mock.results[0].value
        expect(arg.calls).toEqual([
            { to: BASE_USDC, value: 0n, data: approveData(ROUTER_A, AMOUNT_IN) },
            { to: ROUTER_A, value: 0n, data: b.tx.data },
        ])
        expect(arg.opKind).toBe('swap')
        expect(arg.chainId).toBe(8453)
        expect(arg.quoted).toEqual(ATS_QUOTED)
        expect(typeof arg.privateKey).toBe('string')
        expect(typeof arg.rpcUrl).toBe('string')
        for (const cb of ['onProgress', 'onUserOp', 'onRelayed']) expect(typeof arg[cb], cb).toBe('function')
        // Izin zincirden, hesap adresi + router icin okundu.
        expect(h.providerCall).toHaveBeenCalledTimes(1)
        expect(getAddress(h.providerCall.mock.calls[0][0].to)).toBe(BASE_USDC)
        // Bugunku motor ve diger yollar calismadi.
        expect(h.buildSwapCalls).not.toHaveBeenCalled()
        expect(h.executeSwap).not.toHaveBeenCalled()
        expect(h.executeSponsored).not.toHaveBeenCalled()
        expect(h.sendTx).not.toHaveBeenCalled()
        expect(h.quoteMock).not.toHaveBeenCalled()
        await settle()
        expect(cards()[0].status).toBe('success')
    })

    it('1b. imzalanan takas cagrisi build in calldata sini aynen, adresini ise SABIT router dan alir (tx.to yansitilmaz)', async () => {
        const b = build({ to: ROUTER_A.toLowerCase() })
        h.buildMock.mockResolvedValue(b)
        await boot()

        await bg.call(swapMsg({ mode: 'ats' }))

        const swapCall = h.executeAts.mock.calls[0][0].calls.at(-1)
        expect(swapCall).toEqual({ to: LCX_ROUTERS[8453], value: 0n, data: b.tx.data })
        expect(swapCall.to).toBe(ROUTER_A)
        for (const c of h.executeAts.mock.calls[0][0].calls) expect(c.data.toLowerCase()).not.toContain(MAX_HEX)
    })

    it('2. gazsiz (gasToken): executeSponsored ayni calls ile; bundler token bugunku gibi', async () => {
        await boot()

        const res = await bg.call(swapMsg({ mode: 'gasless' }))

        expect(res).toEqual({ success: true, hash: '0xsponsored' })
        expect(h.executeSponsored).toHaveBeenCalledTimes(1)
        const arg = h.executeSponsored.mock.calls[0][0]
        const b = await h.buildMock.mock.results[0].value
        expect(arg.calls).toEqual([
            { to: BASE_USDC, value: 0n, data: approveData(ROUTER_A, AMOUNT_IN) },
            { to: ROUTER_A, value: 0n, data: b.tx.data },
        ])
        expect(arg).toMatchObject({ chainId: 8453, gasToken: BASE_USDC, bundlerBase: 'https://bundler.test', bundlerToken: 'bundler-token' })
        expect(h.bundlerToken).toHaveBeenCalledTimes(1)
        expect(h.executeAts).not.toHaveBeenCalled()
        expect(h.sendTx).not.toHaveBeenCalled()
        expect(h.buildSwapCalls).not.toHaveBeenCalled()
        await settle()
        expect(cards()[0].status).toBe('success')
    })

    it('3. normal yol: once onay gonderilir ve makbuzu beklenir, sonra takas {to, data, value}; kart processing -> success', async () => {
        await boot()

        const res = await bg.call(swapMsg())

        expect(res).toEqual({ success: true, hash: '0xsent2' })
        const b = await h.buildMock.mock.results[0].value
        expect(h.sendTx).toHaveBeenCalledTimes(2)
        expect(h.sendTx.mock.calls[0][0]).toEqual({ to: BASE_USDC, value: 0n, data: approveData(ROUTER_A, AMOUNT_IN) })
        expect(h.sendTx.mock.calls[1][0]).toEqual({ to: ROUTER_A, value: 0n, data: b.tx.data })
        // Onayin makbuzu takas gonderilmeden ONCE beklendi.
        expect(order.slice(0, 3)).toEqual(['send:0xsent1', 'wait:0xsent1', 'send:0xsent2'])
        expect(h.executeSwap).not.toHaveBeenCalled()
        expect(h.executeAts).not.toHaveBeenCalled()
        expect(h.executeSponsored).not.toHaveBeenCalled()

        await settle()
        const statuses = bg.chrome.storage.local.set.mock.calls
            .map(([o]) => o.current_transactions?.[0])
            .filter(Boolean)
            .map((c) => c.status)
        const i = statuses.indexOf('processing')
        expect(i).toBeGreaterThan(-1)
        expect(statuses.lastIndexOf('success')).toBeGreaterThan(i)
        expect(cards()[0]).toMatchObject({ status: 'success', meta: { txHash: '0xsent2', type: 'Swap', chainId: 8453 } })
    })

    it('3b. normal yol: takas zincirde revert (CALL_EXCEPTION + makbuz) -> kart ONCHAIN_FAILED', async () => {
        let n = 0
        h.sendTx.mockImplementation(async () => {
            n += 1
            if (n === 1) return txResponse('0xapprove')
            return {
                hash: '0xswap',
                wait: async () => { throw Object.assign(new Error('reverted'), { code: 'CALL_EXCEPTION', receipt: { status: 0 } }) },
            }
        })
        await boot()

        const res = await bg.call(swapMsg())

        expect(res).toEqual({ success: true, hash: '0xswap' })
        await settle()
        expect(cards()[0]).toMatchObject({ status: 'error', meta: { errorCode: 'ONCHAIN_FAILED' } })
    })

    it('3c. normal yol: onay zincirde dustu (makbuz status 0) -> takas GONDERILMEZ, ONCHAIN_FAILED (yanit + kart)', async () => {
        h.sendTx.mockImplementation(async () => txResponse('0xapprove', { status: 0 }))
        await boot()

        const res = await bg.call(swapMsg())

        expect(res).toEqual({ error: 'ONCHAIN_FAILED', code: 'ONCHAIN_FAILED' })
        expect(h.sendTx).toHaveBeenCalledTimes(1)
        await settle()
        expect(cards()[0]).toMatchObject({ status: 'error', meta: { errorCode: 'ONCHAIN_FAILED' } })
    })

    it('3d. normal yol: onay revert i ethers biciminde (CALL_EXCEPTION + makbuz firlatir) -> ayni ONCHAIN_FAILED, takas yok', async () => {
        h.sendTx.mockImplementation(async () => ({
            hash: '0xapprove',
            wait: async () => { throw Object.assign(new Error('reverted'), { code: 'CALL_EXCEPTION', receipt: { status: 0 } }) },
        }))
        await boot()

        const res = await bg.call(swapMsg())

        expect(res).toEqual({ error: 'ONCHAIN_FAILED', code: 'ONCHAIN_FAILED' })
        expect(h.sendTx).toHaveBeenCalledTimes(1)
    })

    it('R25a. normal yol, Ethereum USDT, izin 1: approve(0) -> bekle -> approve(amountIn) -> bekle -> takas, bu sirayla', async () => {
        const amountIn = 5_000_000n
        const b = build({ tokenIn: ETH_USDT, tokenOut: ETH_USDC, totalIn: amountIn, minAmountOut: 4_900_000n })
        h.buildMock.mockResolvedValue(b)
        h.providerCall.mockResolvedValue(allowanceReply(1n))
        await boot()

        const res = await bg.call(swapMsg({
            chainId: 1, inTokenAddress: ETH_USDT, outTokenAddress: ETH_USDC, amount: '5',
            lcxQuote: lcxQuote({ chainId: 1, tokenIn: ETH_USDT, tokenOut: ETH_USDC, amountIn: amountIn.toString(), amountOut: '4924000', minOut: '4900000' }),
        }))

        expect(res).toEqual({ success: true, hash: '0xsent3' })
        expect(h.sendTx.mock.calls.map(([req]) => req)).toEqual([
            { to: ETH_USDT, value: 0n, data: approveData(LCX_ROUTERS[1], 0n) },
            { to: ETH_USDT, value: 0n, data: approveData(LCX_ROUTERS[1], amountIn) },
            { to: LCX_ROUTERS[1], value: 0n, data: b.tx.data },
        ])
        expect(order.slice(0, 5)).toEqual(['send:0xsent1', 'wait:0xsent1', 'send:0xsent2', 'wait:0xsent2', 'send:0xsent3'])
        expect(h.executeAts).not.toHaveBeenCalled()
        expect(h.executeSponsored).not.toHaveBeenCalled()
    })

    it('native girdi (Base ETH -> USDC): onay yok, izin okunmaz, takas value === amountIn', async () => {
        const amountIn = 1_000_000_000_000_000n
        h.buildMock.mockResolvedValue(build({ tokenIn: NATIVE, tokenOut: BASE_USDC, totalIn: amountIn, minAmountOut: 1_000n, value: amountIn.toString(), approval: null }))
        await boot()

        const res = await bg.call(swapMsg({
            inTokenAddress: '0x0', outTokenAddress: BASE_USDC, amount: '0.001',
            lcxQuote: lcxQuote({ tokenIn: NATIVE, tokenOut: BASE_USDC, amountIn: amountIn.toString(), amountOut: '1005', minOut: '1000', spender: NATIVE }),
        }))

        expect(res).toEqual({ success: true, hash: '0xsent1' })
        expect(h.providerCall).not.toHaveBeenCalled()
        expect(h.sendTx).toHaveBeenCalledTimes(1)
        expect(h.sendTx.mock.calls[0][0].value).toBe(amountIn)
        expect(h.sendTx.mock.calls[0][0].to).toBe(ROUTER_A)
        // Native bakiye motorun native bicimiyle (ZeroAddress -> provider.getBalance) ve hesap adresiyle okundu.
        expect(h.balance).toHaveBeenCalledWith(NATIVE, A.address)
    })
})

describe('SWAP: LCX ret / uyusmazlik yollarinda hicbir sey imzalanmaz', () => {
    it.each(MODES)('4. build alicisi farkli -> LCX_TX_MISMATCH field recipient (%s)', async (mode) => {
        h.buildMock.mockResolvedValue(build({ recipient: OTHER }))
        await boot()

        const res = await bg.call(swapMsg({ mode }))

        expect(res).toEqual({ error: 'LCX_TX_MISMATCH', code: 'LCX_TX_MISMATCH', field: 'recipient' })
        expectNothingSigned()
        expect(h.providerCall).not.toHaveBeenCalled()
        await settle()
        expect(cards()[0]).toMatchObject({ status: 'error', meta: { errorCode: 'LCX_TX_MISMATCH' } })
        expect(resolveTxError(cards()[0].meta.errorCode)).not.toBe('transactionStatus.errors.generic')
    })

    it.each(MODES)('5. build onay hedefi Permit2 -> LCX_TX_MISMATCH field approval (%s)', async (mode) => {
        h.buildMock.mockResolvedValue(build({ approval: { target: PERMIT2 } }))
        await boot()

        const res = await bg.call(swapMsg({ mode }))

        expect(res).toEqual({ error: 'LCX_TX_MISMATCH', code: 'LCX_TX_MISMATCH', field: 'approval' })
        expectNothingSigned()
    })

    it.each(MODES)('5b. build tx i baska bir adrese gidiyor -> LCX_TX_MISMATCH field to (%s)', async (mode) => {
        h.buildMock.mockResolvedValue(build({ to: OTHER }))
        await boot()

        const res = await bg.call(swapMsg({ mode }))

        expect(res).toEqual({ error: 'LCX_TX_MISMATCH', code: 'LCX_TX_MISMATCH', field: 'to' })
        expectNothingSigned()
    })

    it.each(['QUOTE_EXPIRED', 'price_moved', 'stale', 'store_unavailable'])('6. fetchLcxBuild LcxRefusalError(%s) -> LCX_REQUOTE, gonderim yok, yedek yok', async (code) => {
        h.buildMock.mockRejectedValue(new LcxRefusalError(code))
        await boot()

        for (const mode of MODES) {
            const res = await bg.call(swapMsg({ mode }))
            expect(res, mode).toEqual({ error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' })
        }
        expectNothingSigned()
        await settle()
        expect(cards()[0].meta.errorCode).toBe('LCX_REQUOTE')
    })

    it('6b. baska LCX reddi -> LCX_UNAVAILABLE + lcxCode; LcxUnavailableError -> LCX_UNAVAILABLE; ikisinde de YEDEK yok', async () => {
        await boot()

        h.buildMock.mockRejectedValue(new LcxRefusalError('use_rwa'))
        expect(await bg.call(swapMsg({ mode: 'ats' }))).toEqual({ error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE', lcxCode: 'use_rwa' })
        h.buildMock.mockRejectedValue(new LcxUnavailableError('timeout'))
        expect(await bg.call(swapMsg())).toEqual({ error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE' })
        expect(await bg.call(swapMsg({ mode: 'gasless' }))).toEqual({ error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE' })
        expectNothingSigned()
    })

    it.each(MODES)('7. mesajin tutari lcxQuote.amountIn den farkli -> LCX_QUOTE_MISMATCH, fetchLcxBuild cagrilmaz (%s)', async (mode) => {
        await boot()

        const res = await bg.call(swapMsg({ mode, amount: '3' }))

        expect(res).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    it('7b. token / zincir / kayma farki da LCX_QUOTE_MISMATCH; build cagrilmaz', async () => {
        await boot()

        for (const over of [{ outTokenAddress: BASE_USDC, inTokenAddress: BASE_WETH }, { slippage: 0.3 }, { lcxQuote: lcxQuote({ chainId: 1 }) }, { lcxQuote: 'q' }]) {
            const res = await bg.call(swapMsg({ mode: 'ats', ...over }))
            expect(res.code, JSON.stringify(over)).toBe('LCX_QUOTE_MISMATCH')
        }
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    it('7c. teklifin suresi dolmus (expiresAt gecmis) -> LCX_REQUOTE, build cagrilmaz', async () => {
        await boot()

        const res = await bg.call(swapMsg({ mode: 'ats', lcxQuote: lcxQuote({ expiresAt: nowSec() - 1 }) }))

        expect(res).toEqual({ error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    it('7d. LCX bayragi kapali + lcxQuote -> LCX_UNAVAILABLE, build cagrilmaz, bugunku motor da calismaz', async () => {
        flag.on = false
        await boot()

        const res = await bg.call(swapMsg({ mode: 'ats' }))

        expect(res).toEqual({ error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    it('7e. katalog hissesi (bStock satis) ve emekli bStock + lcxQuote -> LCX_QUOTE_MISMATCH, build cagrilmaz', async () => {
        await boot()

        for (const stock of [BSTOCKS[0].address, RETIRED_BSTOCKS[0].address]) {
            const res = await bg.call(swapMsg({
                mode: 'ats', chainId: 56, inTokenAddress: stock, outTokenAddress: BSC_USDT, amount: '1', slippage: 1,
                lcxQuote: lcxQuote({ chainId: 56, tokenIn: getAddress(stock), tokenOut: BSC_USDT, amountIn: '1000000000000000000', slippageBps: 100 }),
            }))
            expect(res).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH' })
        }
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    it('7f. TON agi + lcxQuote -> LCX_QUOTE_MISMATCH (TON takas motoruna gidilmez)', async () => {
        await boot()

        const res = await bg.call(swapMsg({ chainId: -239 }))

        expect(res).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    it('izin okunamadi: hicbir sey imzalanmaz, yedek yok', async () => {
        h.providerCall.mockRejectedValue(new Error('rpc down'))
        await boot()

        for (const mode of MODES) {
            const res = await bg.call(swapMsg({ mode }))
            expect(res.error, mode).toBeTruthy()
        }
        expectNothingSigned()
    })

    it('11. Gizli Hesap imzacisi + lcxQuote -> fetchLcxBuild cagrilmaz, LCX_UNAVAILABLE', async () => {
        await boot(GIZLI, { privacyFlag: 'false' })
        expect(bg.localStore.active_account.key).toBe(GIZLI.key)

        for (const mode of MODES) {
            const res = await bg.call(swapMsg({ mode }))
            expect(res, mode).toEqual({ error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE' })
        }
        expect(bg.localStore.active_account.key).toBe(GIZLI.key)
        expect(h.buildMock).not.toHaveBeenCalled()
        expect(h.quoteMock).not.toHaveBeenCalled()
        expect(h.stablesMock).not.toHaveBeenCalled()
        expect(h.providerCall).not.toHaveBeenCalled()
        expectNothingSigned()
    })
})

describe('SWAP: Review Focus', () => {
    it('8. _resetLcxCaches sonrasi (servis iscisi yeniden baslamis gibi) mesajdaki lcxQuote ile yurutme basarili; build bir kez', async () => {
        await boot()
        keep.client._resetLcxCaches()

        const res = await bg.call(swapMsg({ mode: 'ats' }))

        expect(res).toEqual({ success: true, hash: '0xuserop' })
        expect(h.buildMock).toHaveBeenCalledTimes(1)
        expect(h.quoteMock).not.toHaveBeenCalled()
        expect(h.stablesMock).not.toHaveBeenCalled()
    })

    it('9. Ethereum, USDT girdisi, izin 1 -> calls uc oge: approve 0, approve amountIn, takas', async () => {
        const amountIn = 5_000_000n
        const b = build({ tokenIn: ETH_USDT, tokenOut: ETH_USDC, totalIn: amountIn, minAmountOut: 4_900_000n })
        h.buildMock.mockResolvedValue(b)
        h.providerCall.mockResolvedValue(allowanceReply(1n))
        await boot()

        const res = await bg.call(swapMsg({
            mode: 'ats', chainId: 1, inTokenAddress: ETH_USDT, outTokenAddress: ETH_USDC, amount: '5',
            lcxQuote: lcxQuote({ chainId: 1, tokenIn: ETH_USDT, tokenOut: ETH_USDC, amountIn: amountIn.toString(), amountOut: '4924000', minOut: '4900000', kind: 'stable' }),
        }))

        expect(res).toEqual({ success: true, hash: '0xuserop' })
        expect(h.buildMock).toHaveBeenCalledWith({ kind: 'stable', quoteId: 'q_test_1', recipient: A.address, slippageBps: 50 })
        expect(h.executeAts.mock.calls[0][0].calls).toEqual([
            { to: ETH_USDT, value: 0n, data: approveData(LCX_ROUTERS[1], 0n) },
            { to: ETH_USDT, value: 0n, data: approveData(LCX_ROUTERS[1], amountIn) },
            { to: LCX_ROUTERS[1], value: 0n, data: b.tx.data },
        ])
        expect(h.executeAts.mock.calls[0][0].chainId).toBe(1)
    })
})

// C1 + I1: imzalanacak alt sinir kullanicinin kaymasina bagli, kayma kurali teklif ve yurutmede AYNI.
describe('SWAP: alt sinir ve kayma kurali (C1, I1)', () => {
    it.each(MODES)('C1. lcxQuote gevsek alt sinir tasiyor (minOut 1; build calldata si da 1) -> LCX_QUOTE_MISMATCH, build yok, imza yok (%s)', async (mode) => {
        // routerGuard calldata'yi yalniz lcxQuote.minOut'a karsi denetler: o 1 olsaydi minAmountOut 1 gecerdi.
        h.buildMock.mockResolvedValue(build({ minAmountOut: 1n }))
        await boot()

        const res = await bg.call(swapMsg({ mode, lcxQuote: lcxQuote({ minOut: '1' }) }))

        expect(res).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    it('C1. rwa teklifi de: minOut 1 -> LCX_QUOTE_MISMATCH; amountOut yoksa da', async () => {
        await boot()

        expect(await bg.call(swapMsg({ lcxQuote: lcxQuote({ kind: 'rwa', minOut: '1' }) }))).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH' })
        expect(await bg.call(swapMsg({ lcxQuote: lcxQuote({ amountOut: undefined }) }))).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    it('I1. SWAP_QUOTE -> SWAP gidis-donus, GERCEK stable fiksturu: LCX 30 bps uyguladi, kullanici 50 istedi -> teklif gosterilir, yurutme build i 30 ile ister ve imzalar (uyusmazlik / yeniden teklif dongusu yok)', async () => {
        const BASE_USDT = getAddress(stableQuote.data.quote.output.token)
        h.decimals.mockImplementation(async (address) => {
            const a = String(address).toLowerCase()
            return [BASE_USDC, BASE_USDT].some((t) => t.toLowerCase() === a) ? 6 : 18
        })
        h.stablesMock.mockResolvedValue(new Map([[8453, new Set([BASE_USDC.toLowerCase(), BASE_USDT.toLowerCase()])]]))
        h.quoteMock.mockImplementation(async () => {
            const d = JSON.parse(JSON.stringify(stableQuote.data))
            d.quote.expiresAt = nowSec() + 60 // fikstur zamani gecmiste: yalniz sure tazelenir, baska alan degismez
            return d
        })
        await boot()

        const pair = { inTokenAddress: BASE_USDC, outTokenAddress: BASE_USDT, amount: '2', slippage: 0.5 }
        const { lcxQuote: _yok, ...quoteMessage } = swapMsg(pair).message
        const quoted = await bg.call({ type: 'SWAP_QUOTE', message: quoteMessage })

        expect(h.quoteMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'stable', slippageBps: 50, amountIn: '2000000' }))
        expect(quoted.success).toBe(true)
        expect(quoted.data.routerType.name).toBe('lcx')
        const q = quoted.data.lcxQuote
        expect(q).toMatchObject({ kind: 'stable', slippageBps: 30, amountIn: '2000000', amountOut: '2002348', minOut: '1996340' })

        const b = build({ tokenIn: BASE_USDC, tokenOut: BASE_USDT, totalIn: 2_000_000n, minAmountOut: 1_996_340n })
        h.buildMock.mockResolvedValue(b)
        const res = await bg.call(swapMsg({ ...pair, lcxQuote: q }))

        expect(res).toEqual({ success: true, hash: '0xsent2' })
        expect(h.buildMock).toHaveBeenCalledTimes(1)
        expect(h.buildMock).toHaveBeenCalledWith({ kind: 'stable', quoteId: stableQuote.data.quote.quoteId, recipient: A.address, slippageBps: 30 })
        expect(h.sendTx.mock.calls.map(([req]) => req)).toEqual([
            { to: BASE_USDC, value: 0n, data: approveData(ROUTER_A, 2_000_000n) },
            { to: ROUTER_A, value: 0n, data: b.tx.data },
        ])
        // Yeniden teklif istenmedi (dongu yok).
        expect(h.quoteMock).toHaveBeenCalledTimes(1)
    })

    it('I1. teklifin kaymasi kullanicinin YURUTME ANINDAKI kaymasindan genis -> LCX_QUOTE_MISMATCH (her tur)', async () => {
        await boot()

        for (const kind of ['swap', 'stable', 'rwa']) {
            // Kullanici 0.3% (30 bps) ile onayladi, teklif 50 uyguluyor.
            const res = await bg.call(swapMsg({ slippage: 0.3, lcxQuote: lcxQuote({ kind }) }))
            expect(res, kind).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH' })
        }
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })
})

describe('SWAP: lcxQuote yoksa bugunku yol degismez', () => {
    it('ATS, gazsiz ve normal: bugunku motor, LCX e hic istek yok', async () => {
        await boot()

        const ats = await bg.call(swapMsg({ mode: 'ats', lcxQuote: undefined }))
        expect(ats).toEqual({ success: true, hash: '0xuserop' })
        expect(h.buildSwapCalls).toHaveBeenCalledWith(BASE_USDC, BASE_WETH, '2', 0.5)
        expect(h.executeAts.mock.calls[0][0].calls).toBe(LEGACY_CALLS)

        const gasless = await bg.call(swapMsg({ mode: 'gasless', lcxQuote: null }))
        expect(gasless).toEqual({ success: true, hash: '0xsponsored' })
        expect(h.executeSponsored.mock.calls[0][0].calls).toBe(LEGACY_CALLS)

        const normal = await bg.call(swapMsg({ lcxQuote: undefined }))
        expect(normal).toEqual({ success: true, hash: '0xlegacy' })
        expect(h.executeSwap).toHaveBeenCalledWith(BASE_USDC, BASE_WETH, '2', 0.5)

        expect(h.buildMock).not.toHaveBeenCalled()
        expect(h.providerCall).not.toHaveBeenCalled()
        expect(h.balance).not.toHaveBeenCalled()
        expect(h.sendTx).not.toHaveBeenCalled()
    })
})

// R25b / R25c: hisse ve satis cifti teklifleri baska bir motora gitmez.
describe('SWAP: xStocks ve ATS satis cifti + lcxQuote', () => {
    const XSTOCK_ETH = XSTOCKS.find((t) => t.chains.includes(1)).address
    const RETIRED_X_ETH = RETIRED_XSTOCKS.find((r) => r.chains.includes(1)).address

    it('R25b. xStock satisi ve emekli xStock alimi (Ethereum) + lcxQuote -> LCX_QUOTE_MISMATCH, build yok, imza yok', async () => {
        await boot()

        const cases = [
            { inTokenAddress: XSTOCK_ETH, outTokenAddress: ETH_USDC },
            { inTokenAddress: ETH_USDC, outTokenAddress: RETIRED_X_ETH },
        ]
        for (const pair of cases) {
            for (const mode of MODES) {
                const res = await bg.call(swapMsg({
                    mode, chainId: 1, amount: '1', ...pair,
                    lcxQuote: lcxQuote({ chainId: 1, tokenIn: getAddress(pair.inTokenAddress), tokenOut: getAddress(pair.outTokenAddress) }),
                }))
                expect(res, `${pair.inTokenAddress}->${pair.outTokenAddress} ${mode}`).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH' })
            }
        }
        expect(h.buildMock).not.toHaveBeenCalled()
        expect(h.balance).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    // I2: urun kapsami (`chains`) DISINDA ama xStock'un var oldugu LCX aglari (Optimism 10, Arbitrum 42161). Katalog satiri yok
    // (stockEntry null); bugunku motor assertNotXStock ile reddeder, LCX yurutmesi de ayni yardimciyla (deriveLcxRequest) reddeder.
    const XSTOCK_OFF_CHAIN = XSTOCKS.find((t) => !t.chains.includes(10) && !t.chains.includes(42161)).address
    const L2_USDC = { 10: getAddress('0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'), 42161: getAddress('0xaf88d065e77c8cC2239327C5EDb3A432268e5831') }
    for (const chainId of [10, 42161]) {
        it(`I2. xStock (urun kapsami disi, zincir ${chainId}) ALIM ve SATIS + lcxQuote -> LCX_QUOTE_MISMATCH; build, bakiye okumasi ve imza yok`, async () => {
            await boot()

            const x = getAddress(XSTOCK_OFF_CHAIN)
            for (const pair of [{ inTokenAddress: L2_USDC[chainId], outTokenAddress: x }, { inTokenAddress: x, outTokenAddress: L2_USDC[chainId] }]) {
                for (const mode of MODES) {
                    const res = await bg.call(swapMsg({
                        mode, chainId, amount: '1', ...pair,
                        lcxQuote: lcxQuote({ chainId, tokenIn: pair.inTokenAddress, tokenOut: pair.outTokenAddress, amountIn: '1000000' }),
                    }))
                    expect(res, `${chainId} ${pair.inTokenAddress}->${pair.outTokenAddress} ${mode}`).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH' })
                }
            }
            expect(h.buildMock).not.toHaveBeenCalled()
            expect(h.balance).not.toHaveBeenCalled()
            expectNothingSigned()
        })
    }

    it('R25c. ATS satis cifti (BSC USDT -> ATS) + lcxQuote -> LCX_QUOTE_MISMATCH; satis motoru, kart ve imza yok', async () => {
        await boot()
        const sale = { chainId: 56, inTokenAddress: BSC_USDT, outTokenAddress: ATS_SALE_ATS, amount: '5', slippage: 1 }

        const res = await bg.call(swapMsg({ mode: 'ats', ...sale, lcxQuote: lcxQuote({ chainId: 56, tokenIn: BSC_USDT, tokenOut: ATS_SALE_ATS }) }))

        expect(res).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH' })
        await settle()
        expect(h.saleQuote).not.toHaveBeenCalled()
        expect(h.saleExec).not.toHaveBeenCalled()
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
        expect(cards()).toEqual([])

        // POZITIF BEKCI: ayni cift lcxQuote olmadan satis motoruna gider (satis yolu bu ortamda acik).
        await bg.call(swapMsg({ mode: 'ats', ...sale, lcxQuote: undefined }))
        expect(h.saleQuote).toHaveBeenCalledTimes(1)
        expect(h.buildMock).not.toHaveBeenCalled()
    })
})

// R24 / R25d: bakiye kapisi ve MAX artigi. Teklif ve yurutme ayni turetmeden (deriveLcxRequest) gecer.
describe('SWAP: bakiye kapisi ve MAX artigi (R24)', () => {
    // 18 ondalikli ERC-20 girdi (Base WETH -> USDC): Number yuvarlamasi ham bakiyeyi gurultu kadar asabilir.
    const BAL = 1_234_567_890_123_456_789n
    const MAX_TEXT = '1.2345678901234568' // ekrandaki Number(BAL / 1e18): ham 1234567890123456800 = BAL + 11
    const wethMsg = (over = {}) => swapMsg({ inTokenAddress: BASE_WETH, outTokenAddress: BASE_USDC, ...over })
    const wethQuote = (amountIn, over = {}) => lcxQuote({ tokenIn: BASE_WETH, tokenOut: BASE_USDC, amountIn: amountIn.toString(), amountOut: '3000000', minOut: '2985000', ...over })
    const quoteData = (sent) => ({
        quote: {
            quoteId: 'q_dust', chainId: sent.chainId,
            input: { token: sent.tokenIn, amount: sent.amountIn, decimals: 18 },
            output: { token: sent.tokenOut, amount: '3000000', minimumAmount: '2985000', decimals: 6 },
            slippageBps: sent.slippageBps, expiresAt: nowSec() + 60, spender: ROUTER_A,
        },
    })

    it.each(MODES)('R25d. ERC-20 bakiye < amountIn -> INSUFFICIENT_BALANCE; build yok, izin okunmaz, imza yok (%s)', async (mode) => {
        h.balance.mockResolvedValue(AMOUNT_IN - 1n) // USDC: 1 birim eksik (gurultu degil, gercek eksik)
        await boot()

        const res = await bg.call(swapMsg({ mode }))

        expect(res).toEqual({ error: 'INSUFFICIENT_BALANCE', code: 'INSUFFICIENT_BALANCE' })
        expect(h.balance).toHaveBeenCalledWith(BASE_USDC, A.address)
        expect(h.buildMock).not.toHaveBeenCalled()
        expect(h.providerCall).not.toHaveBeenCalled()
        expectNothingSigned()
        await settle()
        expect(cards()[0]).toMatchObject({ status: 'error', meta: { errorCode: 'INSUFFICIENT_BALANCE' } })
    })

    it('R25d. native bakiye < amountIn (gaz haric) -> INSUFFICIENT_BALANCE; native bakiye = amountIn gecer', async () => {
        const amountIn = 1_000_000_000_000_000n
        const nativeMsg = (mode) => swapMsg({
            mode, inTokenAddress: '0x0', outTokenAddress: BASE_USDC, amount: '0.001',
            lcxQuote: lcxQuote({ tokenIn: NATIVE, tokenOut: BASE_USDC, amountIn: amountIn.toString(), amountOut: '1005', minOut: '1000', spender: NATIVE }),
        })
        h.buildMock.mockResolvedValue(build({ tokenIn: NATIVE, tokenOut: BASE_USDC, totalIn: amountIn, minAmountOut: 1_000n, value: amountIn.toString(), approval: null }))
        h.balance.mockResolvedValue(amountIn - 1n)
        await boot()

        expect(await bg.call(nativeMsg('ats'))).toEqual({ error: 'INSUFFICIENT_BALANCE', code: 'INSUFFICIENT_BALANCE' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()

        // Native tutar KIRPILMAZ ve gaz kapiya katilmaz: tam amountIn kadar bakiye yeter.
        h.balance.mockResolvedValue(amountIn)
        expect(await bg.call(nativeMsg('ats'))).toEqual({ success: true, hash: '0xuserop' })
        expect(h.executeAts.mock.calls[0][0].calls.at(-1).value).toBe(amountIn)
    })

    it.each(MODES)('R25d. bakiye yurutmede okunamadi -> LCX_UNAVAILABLE; build yok, imza yok (%s)', async (mode) => {
        h.balance.mockRejectedValue(new Error('rpc down'))
        await boot()

        const res = await bg.call(swapMsg({ mode }))

        expect(res).toEqual({ error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    it('R25d. MAX artigi (amountIn = bakiye + gurultu): teklif VE yurutme bakiyeye kirpar, takas yurur', async () => {
        // Ornek gercekten gurultu: ekran metni ham bakiyeyi asiyor (kirpma olmasa teklif / onay BAL + 11 olurdu).
        expect(parseUnits(MAX_TEXT, 18)).toBe(BAL + 11n)
        h.balance.mockResolvedValue(BAL)
        h.stablesMock.mockResolvedValue(new Map())
        h.quoteMock.mockImplementation(async (sent) => quoteData(sent))
        await boot()

        // Teklif: LCX'e giden ham tutar bakiyedir (BAL + 11 degil).
        const quoted = await bg.call({ type: 'SWAP_QUOTE', message: wethMsg({ amount: MAX_TEXT }).message })
        expect(h.quoteMock).toHaveBeenCalledTimes(1)
        expect(h.quoteMock.mock.calls[0][0].amountIn).toBe(BAL.toString())
        expect(quoted.success).toBe(true)
        const q = quoted.data.lcxQuote
        expect(q.amountIn).toBe(BAL.toString())

        // Yurutme: ayni metin ve teklifin kendisi -> ayni kirpma, eslesir; onay ve takas bakiye kadar.
        const b = build({ tokenIn: BASE_WETH, tokenOut: BASE_USDC, totalIn: BAL, minAmountOut: BigInt(q.minOut) })
        h.buildMock.mockResolvedValue(b)
        const res = await bg.call(wethMsg({ mode: 'ats', amount: MAX_TEXT, lcxQuote: q }))

        expect(res).toEqual({ success: true, hash: '0xuserop' })
        expect(h.buildMock).toHaveBeenCalledWith({ kind: 'swap', quoteId: 'q_dust', recipient: A.address, slippageBps: 50 })
        expect(h.executeAts.mock.calls[0][0].calls).toEqual([
            { to: BASE_WETH, value: 0n, data: approveData(ROUTER_A, BAL) },
            { to: ROUTER_A, value: 0n, data: b.tx.data },
        ])
        expect(h.balance).toHaveBeenCalledWith(BASE_WETH, A.address)
    })

    it('R25d. gercek fazla (gurultuden buyuk) kirpilmaz: teklif o tutarla eslesse de yurutme INSUFFICIENT_BALANCE', async () => {
        const over = BAL + BAL / 1000n // binde bir fazla
        h.balance.mockResolvedValue(BAL)
        await boot()

        const res = await bg.call(wethMsg({ mode: 'ats', amount: formatUnits(over, 18), lcxQuote: wethQuote(over) }))

        expect(res).toEqual({ error: 'INSUFFICIENT_BALANCE', code: 'INSUFFICIENT_BALANCE' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    it('R25d. ATS ucret teklifi de ayni kapidan gecer: { success:false, code: INSUFFICIENT_BALANCE }, quoteAtsTransfer yok', async () => {
        h.balance.mockResolvedValue(AMOUNT_IN - 1n)
        await boot()

        expect(await bg.call(feeMsg())).toEqual({ success: false, error: 'INSUFFICIENT_BALANCE', code: 'INSUFFICIENT_BALANCE' })
        expect(h.quoteAts).not.toHaveBeenCalled()
        expect(h.buildMock).not.toHaveBeenCalled()
    })
})

// R27: LCX_REQUOTE alinca ekran yeni SWAP_QUOTE ister; teklif 18 sn'lik istemci onbelleginden (ayni quoteId) gelirse kullanici
// "fiyat degisti" mesajini tekrar tekrar gorur. Bu blokta GERCEK fetchLcxQuote (ve onbellegi) calisir, yalniz HTTP sahtedir;
// sunucuya kac kez gidildigi sayilir.
describe('SWAP: yeniden teklifte teklif onbellegi temizlenir (R27)', () => {
    const quoteBody = (sent) => ({
        quote: {
            quoteId: 'q_r27', chainId: sent.chainId,
            input: { token: sent.tokenIn, amount: sent.amountIn, decimals: 6 },
            output: { token: sent.tokenOut, amount: MIN_OUT.toString(), minimumAmount: MIN_OUT.toString(), decimals: 18 },
            slippageBps: sent.slippageBps, expiresAt: nowSec() + 60, spender: ROUTER_A,
        },
    })
    // Ayni parametreli teklif istegi: swapMsg ile ayni istek (lcxQuote olmadan).
    const quoteReq = () => {
        const { lcxQuote: _q, ...rest } = swapMsg().message
        return { type: 'SWAP_QUOTE', message: rest }
    }
    let server
    async function bootWithRealCache() {
        keep.client._resetLcxCaches()
        server = vi.fn(async (url, init) => {
            const sent = JSON.parse(init.body)
            return { status: 200, json: async () => ({ success: true, kind: sent.kind, data: quoteBody(sent) }) }
        })
        h.stablesMock.mockResolvedValue(new Map())
        h.quoteMock.mockImplementation((sent) => keep.client.fetchLcxQuote(sent, { fetchImpl: server }))
        await boot()
        const first = await bg.call(quoteReq())
        expect(first.success).toBe(true)
        expect(server).toHaveBeenCalledTimes(1)
        // Pozitif kontrol: ayni istek onbellekten gelir, sunucuya gitmez.
        await bg.call(quoteReq())
        expect(server).toHaveBeenCalledTimes(1)
        return first.data.lcxQuote
    }

    const REQUOTE_YOLLARI = [
        ['SWAP, build teklif suresi doldu dedi (QUOTE_EXPIRED)', 'swap', (q) => swapMsg({ mode: 'ats', lcxQuote: q }), () => h.buildMock.mockRejectedValue(new LcxRefusalError('QUOTE_EXPIRED')), { error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' }],
        ['SWAP, build fiyat kaydi dedi (price_moved)', 'swap', (q) => swapMsg({ mode: 'normal', lcxQuote: q }), () => h.buildMock.mockRejectedValue(new LcxRefusalError('price_moved')), { error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' }],
        ['SWAP, mesajdaki teklifin suresi gecmis (build istenmeden)', 'swap', (q) => swapMsg({ mode: 'ats', lcxQuote: { ...q, expiresAt: nowSec() - 1 } }), () => {}, { error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' }],
        ['ATS_SWAP_FEE_QUOTE, build QUOTE_EXPIRED dedi', 'fee', (q) => feeMsg({ lcxQuote: q }), () => h.buildMock.mockRejectedValue(new LcxRefusalError('QUOTE_EXPIRED')), { success: false, error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' }],
        ['ATS_SWAP_FEE_QUOTE, mesajdaki teklifin suresi gecmis', 'fee', (q) => feeMsg({ lcxQuote: { ...q, expiresAt: nowSec() - 1 } }), () => {}, { success: false, error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' }],
    ]
    it.each(REQUOTE_YOLLARI)('%s: sonraki SWAP_QUOTE sunucuya YENIDEN gider (onbellekten gelmez)', async (_ad, _yol, msgOf, arrange, expected) => {
        const q = await bootWithRealCache()
        arrange()

        expect(await bg.call(msgOf(q))).toEqual(expected)
        expectNothingSigned()

        const again = await bg.call(quoteReq())
        expect(again.success).toBe(true)
        expect(server).toHaveBeenCalledTimes(2)
    })

    it('LCX_REQUOTE DISI retler onbellegi temizlemez (LCX_UNAVAILABLE / LCX_QUOTE_MISMATCH): sonraki teklif onbellekten', async () => {
        const q = await bootWithRealCache()

        h.buildMock.mockRejectedValue(new LcxRefusalError('off_peg')) // baska red -> LCX_UNAVAILABLE
        expect(await bg.call(swapMsg({ mode: 'ats', lcxQuote: q }))).toMatchObject({ code: 'LCX_UNAVAILABLE' })
        // Teklif talep edilenle eslesmiyor -> LCX_QUOTE_MISMATCH (token farki).
        expect(await bg.call(swapMsg({ mode: 'ats', lcxQuote: { ...q, tokenOut: OTHER } }))).toMatchObject({ code: 'LCX_QUOTE_MISMATCH' })

        await bg.call(quoteReq())
        expect(server).toHaveBeenCalledTimes(1)
    })

    it('onbellek yalniz o istegin anahtarini siler: baska tutarin teklifi onbellekte kalir', async () => {
        const q = await bootWithRealCache()
        const baska = { type: 'SWAP_QUOTE', message: { ...quoteReq().message, amount: '3' } }
        await bg.call(baska)
        expect(server).toHaveBeenCalledTimes(2)

        h.buildMock.mockRejectedValue(new LcxRefusalError('QUOTE_EXPIRED'))
        expect(await bg.call(swapMsg({ mode: 'ats', lcxQuote: q }))).toMatchObject({ code: 'LCX_REQUOTE' })

        await bg.call(baska)
        expect(server).toHaveBeenCalledTimes(2) // 3 USDC teklifi hala onbellekte
        await bg.call(quoteReq())
        expect(server).toHaveBeenCalledTimes(3) // 2 USDC teklifi silinmisti
    })
})

describe('ATS_SWAP_FEE_QUOTE: LCX dali', () => {
    it('10. lcxQuote varsa buildSwapCalls cagrilmaz; quoteAtsTransfer prepareLcxSwap in calls iyla', async () => {
        await boot()

        const res = await bg.call(feeMsg())

        expect(res).toMatchObject({ success: true, transferFee: '1000' })
        expect(h.buildSwapCalls).not.toHaveBeenCalled()
        expect(h.buildMock).toHaveBeenCalledWith({ kind: 'swap', quoteId: 'q_test_1', recipient: A.address, slippageBps: 50 })
        expect(h.quoteAts).toHaveBeenCalledTimes(1)
        const arg = h.quoteAts.mock.calls[0][0]
        const b = await h.buildMock.mock.results[0].value
        expect(arg).toMatchObject({ chainId: 8453, address: A.address, opKind: 'swap' })
        expect(arg.calls).toEqual([
            { to: BASE_USDC, value: 0n, data: approveData(ROUTER_A, AMOUNT_IN) },
            { to: ROUTER_A, value: 0n, data: b.tx.data },
        ])
        expectNothingSigned()
    })

    it('10b. lcxQuote yoksa bugunku yol (degismedi)', async () => {
        await boot()

        const res = await bg.call(feeMsg({ lcxQuote: undefined }))

        expect(res).toMatchObject({ success: true })
        expect(h.buildSwapCalls).toHaveBeenCalledWith(BASE_USDC, BASE_WETH, '2', 0.5)
        expect(h.quoteAts.mock.calls[0][0].calls).toBe(LEGACY_CALLS)
        expect(h.buildMock).not.toHaveBeenCalled()
    })

    it('10c. ayni kodlar { success:false, code } bicimiyle; quoteAtsTransfer cagrilmaz', async () => {
        await boot()

        h.buildMock.mockRejectedValue(new LcxRefusalError('QUOTE_EXPIRED'))
        expect(await bg.call(feeMsg())).toEqual({ success: false, error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' })

        h.buildMock.mockResolvedValue(build({ recipient: OTHER }))
        expect(await bg.call(feeMsg())).toEqual({ success: false, error: 'LCX_TX_MISMATCH', code: 'LCX_TX_MISMATCH', field: 'recipient' })

        h.buildMock.mockRejectedValue(new LcxRefusalError('use_rwa'))
        expect(await bg.call(feeMsg())).toEqual({ success: false, error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE', lcxCode: 'use_rwa' })

        h.buildMock.mockClear()
        expect(await bg.call(feeMsg({ amount: '3' }))).toEqual({ success: false, error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH' })
        expect(h.buildMock).not.toHaveBeenCalled()

        expect(h.quoteAts).not.toHaveBeenCalled()
        expect(h.buildSwapCalls).not.toHaveBeenCalled()
    })

    it('11b. Gizli Hesap imzacisi: fetchLcxBuild cagrilmaz, { success:false, code: LCX_UNAVAILABLE }', async () => {
        await boot(GIZLI, { privacyFlag: 'false' })

        const res = await bg.call(feeMsg())

        expect(res).toEqual({ success: false, error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expect(h.quoteAts).not.toHaveBeenCalled()
        expect(h.buildSwapCalls).not.toHaveBeenCalled()
    })
})

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { HDNodeWallet, Interface, AbiCoder, MaxUint256, getAddress } from 'ethers'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { createVault, deriveMasterKey, randBytes } from './utils/crypto-utils'
import { derivePrivateAccount } from './utils/privacy/privateAccount'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'
import { LCX_STOCK_ROWS_KEY } from './utils/lcx/stockRows'
import { BSTOCKS } from './data/bStocks'
import rwaBuyFx from './utils/lcx/fixtures/rwa-quote-base.json'
import rwaNativeBuyFx from './utils/lcx/fixtures/rwa-quote-base-native-buy.json'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// SWAP ve ATS_SWAP_FEE_QUOTE RWA DALI (Bolum 2, Gorev 6; `lcxKind: 'rwa'` + `lcxQuote`). Para gonderen adim: hicbir ret / uyusmazlik
// yolunda imza ya da gonderim yok ve bugunku motor (buildSwapCalls / executeSwap) YEDEK olarak calismaz. Ag yoktur: LCX istemcisinin
// teklif / build / hisse listesi uclari, ATS / gazsiz yurutuculer, saglayici (yalniz izin okumasi), cuzdanin gonderimi ve kapi taklit
// edilir. Teklif eslemesi (mapQuote, calls.js), build dogrulamasi (routerGuard.js: GERCEK swapSplit calldata), cagri listesi, satir
// katmani, teklif kaydi ve arka plan akisi GERCEKTIR (background.lcxSwap.test.js deseni).
const flag = vi.hoisted(() => ({ on: true }))
const keep = vi.hoisted(() => ({ client: null }))
const h = vi.hoisted(() => ({
    buildMock: vi.fn(),        // utils/lcx/client fetchLcxBuild
    quoteMock: vi.fn(),        // utils/lcx/client fetchLcxQuote (yalniz SWAP_QUOTE gidis-donus testlerinde)
    stocksMock: vi.fn(),       // utils/lcx/client fetchLcxStocks (yurutmede ASLA cagrilmamali)
    stablesMock: vi.fn(),      // utils/lcx/client fetchLcxStablecoins
    decimals: vi.fn(),         // MultiChainSwapManager#getTokenDecimals (RWA yolu ZINCIRDEN ondalik OKUMAZ)
    buildSwapCalls: vi.fn(),   // bugunku motor (ATS / gazsiz)
    executeSwap: vi.fn(),      // bugunku motor (normal)
    executeAts: vi.fn(),
    quoteAts: vi.fn(),
    executeSponsored: vi.fn(),
    bundlerToken: vi.fn(),
    sendTx: vi.fn(),           // HDNodeWallet / Wallet #sendTransaction
    providerCall: vi.fn(),     // JsonRpcProvider#call (allowance okumasi)
    balance: vi.fn(),          // MultiChainSwapManager#getTokenBalance (bakiye kapisi)
    gate: vi.fn(),             // ilk alim kapisi, katalog yolu: evaluate({ chainId, outAddress })
    issuerGate: vi.fn(),       // ilk alim kapisi, ihracci yolu: evaluateIssuer({ issuer })
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
        fetchLcxStocks: (...a) => h.stocksMock(...a),
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
vi.mock('./utils/stockGate/gate', async (importOriginal) => ({
    ...(await importOriginal()),
    createStockGate: () => ({
        evaluate: (...a) => h.gate(...a),
        evaluateIssuer: (...a) => h.issuerGate(...a),
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

// --- Sabitler -------------------------------------------------------------------------------------------------------------
const ROUTER_A = '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0'
const NATIVE = '0x0000000000000000000000000000000000000000'
const USDC = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
const WETH = getAddress('0x4200000000000000000000000000000000000006')
const TSLAC = getAddress('0xb2000000000000000000001e800a7f5189430cD0')
const POOL = getAddress('0x2222222222222222222222222222222222222222')
const OTHER = getAddress('0x4444444444444444444444444444444444444444')
const OTHER_STOCK = getAddress('0x5555555555555555555555555555555555555555')
const MAX_HEX = MaxUint256.toString(16)
const ATS_QUOTED = { transferFee: '1000', commissionFee: '10' }

// Sunucunun /lcx/stocks satir bicimi: Base TSLAC, Coinbase hissesi, 8 ondalik (background.lcxRwaQuote.test.js ile ayni).
const TSLAC_ROW = {
    chainId: 8453, address: TSLAC, symbol: 'TSLAC', name: 'Tesla (Coinbase Tokenized Stocks)', decimals: 8, issuer: 'coinbase',
    underlying: 'TSLA', category: 'stocks', priceUsd: 388.61280861, priceSource: 'Chainlink Coinbase TSLA on Base',
    priceUpdatedAt: 1795071867, marketHours: 'us_equities', depthUsd: 252144.395038,
}
// Zamanlar KULLANILDIGI ANDA hesaplanir (modul yuklenirken degil): agir bir acilis tazeligi cevirmesin.
const storedRows = () => ({ fetchedAt: Date.now() - 30_000, asOf: Date.now() - 40_000, usEquitiesOpen: false, rows: [TSLAC_ROW] })
const nowSec = () => Math.floor(Date.now() / 1000)
const clone = (x) => JSON.parse(JSON.stringify(x))

const SWAP_SPLIT_ABI =
    'function swapSplit(address tokenIn, address tokenOut, uint256 totalIn, uint256 minAmountOut, address recipient, uint256 deadline, (uint256 amountIn, (uint8 family, address pool, address tokenIn, address tokenOut, uint256 aux)[] hops)[] legs) payable returns (uint256 amountOut)'
const router = new Interface([SWAP_SPLIT_ABI])
const erc20 = new Interface(['function approve(address spender, uint256 amount) returns (bool)'])
const approveData = (spender, amount) => erc20.encodeFunctionData('approve', [spender, amount])
const allowanceReply = (v) => AbiCoder.defaultAbiCoder().encode(['uint256'], [v])

// GERCEK swapSplit calldata (R2): alici, son tarih ve alt sinir teste gore kurulur (kayitli probe calldata'si baska alicili ve
// suresi dolmustur).
function swapCalldata({ tokenIn, tokenOut, totalIn, minAmountOut, recipient = A.address, deadline = BigInt(nowSec() + 300) }) {
    const legs = [{ amountIn: totalIn, hops: [{ family: 2, pool: POOL, tokenIn, tokenOut, aux: 0n }] }]
    return router.encodeFunctionData('swapSplit', [tokenIn, tokenOut, totalIn, minAmountOut, recipient, deadline, legs])
}
// fetchLcxBuild'in dondurdugu { tx, approval }: calldata teklifteki tutarlarla kurulur; `over` calldata alanlarini ezer.
const buildFor = (q, { to = ROUTER_A, value, approval = { target: ROUTER_A }, ...over } = {}) => ({
    tx: {
        to,
        data: swapCalldata({ tokenIn: q.tokenIn, tokenOut: q.tokenOut, totalIn: BigInt(q.amountIn), minAmountOut: BigInt(q.minOut), ...over }),
        value: value ?? (q.tokenIn === NATIVE ? q.amountIn : '0'),
    },
    approval: q.tokenIn === NATIVE ? null : approval,
})

// Yonler: mesaj yuku + o yonun (tokenIn, tokenOut, tutarlar) teklif iskeleti. minOut = floor(amountOut * 9950 / 10000) (kayma 0.5).
const DIRS = {
    buy: { in: USDC, out: TSLAC, amount: '2', side: 'buy', q: { tokenIn: USDC, tokenOut: TSLAC, amountIn: '2000000', amountOut: '513279', minOut: '510712' } },
    sell: { in: TSLAC, out: USDC, amount: '0.005', side: 'sell', q: { tokenIn: TSLAC, tokenOut: USDC, amountIn: '500000', amountOut: '1741646', minOut: '1732937' } },
    sellNative: { in: TSLAC, out: '0x0', amount: '0.005', side: 'sell', q: { tokenIn: TSLAC, tokenOut: NATIVE, amountIn: '500000', amountOut: '1000000000000000', minOut: '995000000000000' } },
    nativeBuy: { in: '0x0', out: TSLAC, amount: '0.0006', side: 'buy', q: { tokenIn: NATIVE, tokenOut: TSLAC, amountIn: '600000000000000', amountOut: '275723', minOut: '274344' } },
}
const rwaQuote = (dir, over = {}) => ({
    kind: 'rwa', quoteId: `q_rwa_${dir}`, chainId: 8453, ...DIRS[dir].q, slippageBps: 50,
    expiresAt: nowSec() + 60, spender: ROUTER_A, ...over,
})
const MODE_FIELDS = { ats: { atsSwap: true, atsQuoted: ATS_QUOTED }, normal: {} }
const swapMsg = ({ dir = 'buy', mode = 'normal', lcxQuote, ...over } = {}) => ({
    type: 'SWAP',
    message: {
        index: 0, chainId: 8453, inTokenAddress: DIRS[dir].in, outTokenAddress: DIRS[dir].out, amount: DIRS[dir].amount,
        slippage: 0.5, lcxKind: 'rwa', side: DIRS[dir].side, lcxQuote, ...MODE_FIELDS[mode], ...over,
    },
})
const feeMsg = (over = {}) => {
    const m = swapMsg(over)
    return { type: 'ATS_SWAP_FEE_QUOTE', message: { ...m.message, atsSwap: true } }
}
const quoteMsg = (dir) => ({
    type: 'SWAP_QUOTE',
    message: { chainId: 8453, inTokenAddress: DIRS[dir].in, outTokenAddress: DIRS[dir].out, amount: DIRS[dir].amount, slippage: 0.5, lcxKind: 'rwa', side: DIRS[dir].side },
})
// Genel takas: lcxKind yok.
const generalMsg = ({ dir = 'buy', mode = 'normal', ...over } = {}) => {
    const m = swapMsg({ dir, mode, ...over })
    delete m.message.lcxKind
    delete m.message.side
    return m
}

let bg
// `rows`: depodaki satirlar (null: depo bos). Satirlar BELLEKTE degildir (servis isci yeni kalkmis gibi): arka plan SWAP aninda
// depodan yukler (R7).
async function boot(signer = A, { privacyFlag, rows = storedRows() } = {}) {
    const acilis = privacyFlag === 'false' ? A : signer
    vi.stubEnv('VITE_LCX_ENABLED', flag.on ? 'true' : 'false')
    bg = await bootBackground({
        privacyFlag,
        localStore: {
            active_account: acilis, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {},
            ...(rows ? { [LCX_STOCK_ROWS_KEY]: rows } : {}),
        },
        sessionStore: { sessionMasterKeyJwk: jwk },
    })
    if (acilis !== signer) {
        for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
        bg.localStore.active_account = structuredClone(signer)
    }
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)) }
// Servis iscisinin teklif kaydi (bellek): background'un kullandigi modul ornegi boot'tan SONRA alinir (vi.resetModules).
const remember = async (quoteId, info, now) => (await import('./utils/lcx/rwaQuoteMemory')).rememberRwaQuote(quoteId, info, now)
const rowReads = () => bg.chrome.storage.local.get.mock.calls.filter((c) => c[0] === LCX_STOCK_ROWS_KEY)

// Teklifi kaydeder (varsayilan: ihracci coinbase, yonun hissesi, yonun tarafi) ve build'i o teklife gore calldata'li yapar.
const SIDE = { buy: 'buy', nativeBuy: 'buy', sell: 'sell', sellNative: 'sell' }
async function seeded(dir, { record = {}, quote = {}, skipRecord = false, build = {} } = {}) {
    const q = rwaQuote(dir, quote)
    if (!skipRecord) await remember(q.quoteId, { issuer: 'coinbase', chainId: 8453, stock: TSLAC, side: SIDE[dir], ...record })
    h.buildMock.mockImplementation(async () => buildFor(q, build))
    return q
}

let order
function txResponse(hash, receipt = { status: 1 }) {
    return { hash, wait: vi.fn(async () => { order.push(`wait:${hash}`); return receipt }) }
}

beforeEach(() => {
    for (const m of Object.values(h)) m.mockReset()
    flag.on = true
    order = []
    h.gate.mockResolvedValue({ ok: true })
    h.issuerGate.mockResolvedValue({ ok: true })
    h.decimals.mockResolvedValue(18)
    h.stocksMock.mockRejectedValue(new Error('network must not be used'))
    h.stablesMock.mockResolvedValue(new Map())
    h.providerCall.mockImplementation(async () => allowanceReply(0n))
    h.executeAts.mockResolvedValue({ hash: '0xuserop', txHash: '0xatstx' })
    h.quoteAts.mockResolvedValue({ transferFee: '1000', commissionFee: '10' })
    h.executeSponsored.mockResolvedValue({ hash: '0xsponsored', waitPromise: Promise.resolve({ receipt: { status: 'success', transactionHash: '0xsptx' } }) })
    h.bundlerToken.mockResolvedValue('bundler-token')
    h.buildSwapCalls.mockResolvedValue({ calls: [{ to: OTHER, value: 0n, data: '0x1234' }], meta: {} })
    h.executeSwap.mockResolvedValue({ hash: '0xlegacy', waitPromise: Promise.resolve({ status: 1 }) })
    h.balance.mockResolvedValue(10n ** 30n) // bol bakiye: bakiye kapisi gecer
    let n = 0
    h.sendTx.mockImplementation(async () => {
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
}
// Imzadan once durdu: ne build ne kapi (iki yol da) cagrildi, imza yok.
function expectStoppedBeforeBuildAndGate() {
    expect(h.buildMock).not.toHaveBeenCalled()
    expect(h.gate).not.toHaveBeenCalled()
    expect(h.issuerGate).not.toHaveBeenCalled()
    expectNothingSigned()
}
const cards = () => bg.localStore.current_transactions || []
const noMaxApproval = (calls) => { for (const c of calls) expect(c.data.toLowerCase()).not.toContain(MAX_HEX) }

describe('SWAP RWA: alim (ATS yolu)', () => {
    it('1. SWAP_QUOTE -> SWAP gidis-donus: kayit var, kapi acik -> build {kind rwa} ile; executeAtsTransfer [approve(router, amountIn), swapSplit], onay TAM tutar', async () => {
        h.quoteMock.mockImplementation(async () => {
            const d = clone(rwaBuyFx.data)
            d.quote.expiresAt = nowSec() + 100 // fikstur kaydi eski: bitis ANINDA hesaplanir
            return d
        })
        await boot()
        const quoted = await bg.call(quoteMsg('buy'))
        expect(quoted.success).toBe(true)
        const lcxQuote = quoted.data.lcxQuote
        expect(lcxQuote.kind).toBe('rwa')
        expect(lcxQuote.amountIn).toBe('2000000')
        h.buildMock.mockImplementation(async () => buildFor(lcxQuote))
        h.gate.mockClear()
        h.issuerGate.mockClear()

        const res = await bg.call(swapMsg({ mode: 'ats', lcxQuote }))

        expect(res).toEqual({ success: true, hash: '0xuserop' })
        expect(h.buildMock).toHaveBeenCalledTimes(1)
        expect(h.buildMock).toHaveBeenCalledWith({ kind: 'rwa', quoteId: lcxQuote.quoteId, recipient: A.address, slippageBps: lcxQuote.slippageBps })
        expect(h.executeAts).toHaveBeenCalledTimes(1)
        const arg = h.executeAts.mock.calls[0][0]
        const b = await h.buildMock.mock.results[0].value
        expect(arg.calls).toEqual([
            { to: USDC, value: 0n, data: approveData(ROUTER_A, 2_000_000n) },
            { to: ROUTER_A, value: 0n, data: b.tx.data },
        ])
        noMaxApproval(arg.calls)
        expect(arg.opKind).toBe('swap')
        expect(arg.chainId).toBe(8453)
        expect(arg.quoted).toEqual(ATS_QUOTED)
        // Kapi ihracci kimligiyle (kayittaki) ve build'den ONCE soruldu; katalog kapisi da (ikinci koruma).
        expect(h.issuerGate).toHaveBeenCalledTimes(1)
        expect(h.issuerGate).toHaveBeenCalledWith({ issuer: 'coinbase' })
        expect(h.issuerGate.mock.invocationCallOrder[0]).toBeLessThan(h.buildMock.mock.invocationCallOrder[0])
        expect(h.gate).toHaveBeenCalledTimes(1)
        // Teklif yalniz SWAP_QUOTE'ta alindi; yurutme yeni teklif istemez, bugunku motora ve zincirden ondalik okumaya gitmez.
        expect(h.quoteMock).toHaveBeenCalledTimes(1)
        expect(h.buildSwapCalls).not.toHaveBeenCalled()
        expect(h.executeSwap).not.toHaveBeenCalled()
        expect(h.decimals).not.toHaveBeenCalled()
        expect(h.stocksMock).not.toHaveBeenCalled()
        await settle()
        expect(cards()[0].status).toBe('success')
    })

    it('1b. normal (EOA) yol: once onay (tam tutar) gonderilir ve makbuzu beklenir, sonra swapSplit', async () => {
        await boot()
        const q = await seeded('buy')

        const res = await bg.call(swapMsg({ lcxQuote: q }))

        expect(res).toEqual({ success: true, hash: '0xsent2' })
        const b = await h.buildMock.mock.results[0].value
        expect(h.sendTx.mock.calls.map(([req]) => req)).toEqual([
            { to: USDC, value: 0n, data: approveData(ROUTER_A, 2_000_000n) },
            { to: ROUTER_A, value: 0n, data: b.tx.data },
        ])
        noMaxApproval(h.sendTx.mock.calls.map(([req]) => req))
        expect(order.slice(0, 3)).toEqual(['send:0xsent1', 'wait:0xsent1', 'send:0xsent2'])
        expect(h.issuerGate).toHaveBeenCalledWith({ issuer: 'coinbase' })
        expect(h.executeSwap).not.toHaveBeenCalled()
    })
})

describe('SWAP RWA: satis ve native', () => {
    it.each(['ats', 'normal'])('2. satis, native cikti (TSLAC -> ETH, %s): onay hisse tokenine ve TAM tutar; kapi (iki yol) cagrilmaz', async (mode) => {
        h.balance.mockResolvedValue(500_000n) // MAX satis: bakiyenin tamami, kirpma / artik yok
        await boot()
        const q = await seeded('sellNative')

        const res = await bg.call(swapMsg({ dir: 'sellNative', mode, lcxQuote: q }))

        expect(res.success).toBe(true)
        const calls = mode === 'ats' ? h.executeAts.mock.calls[0][0].calls : h.sendTx.mock.calls.map(([req]) => req)
        const b = await h.buildMock.mock.results[0].value
        expect(calls).toEqual([
            { to: TSLAC, value: 0n, data: approveData(ROUTER_A, 500_000n) },
            { to: ROUTER_A, value: 0n, data: b.tx.data },
        ])
        noMaxApproval(calls)
        expect(h.buildMock).toHaveBeenCalledWith({ kind: 'rwa', quoteId: q.quoteId, recipient: A.address, slippageBps: 50 })
        expect(getAddress(h.providerCall.mock.calls[0][0].to)).toBe(TSLAC) // izin hisse tokeninden okundu
        expect(h.balance).toHaveBeenCalledWith(TSLAC, A.address)
        expect(h.gate).not.toHaveBeenCalled()
        expect(h.issuerGate).not.toHaveBeenCalled()
        expect(h.buildSwapCalls).not.toHaveBeenCalled()
        expect(h.executeSwap).not.toHaveBeenCalled()
        expect(h.decimals).not.toHaveBeenCalled()
    })

    it('3. native alim (Task 1 fiksturu, ETH -> TSLAC): onay YOK, izin okunmaz, takas value === amountIn', async () => {
        h.quoteMock.mockImplementation(async () => {
            const d = clone(rwaNativeBuyFx.data)
            d.quote.expiresAt = nowSec() + 100
            return d
        })
        await boot()
        const quoted = await bg.call(quoteMsg('nativeBuy'))
        expect(quoted.success).toBe(true)
        const lcxQuote = quoted.data.lcxQuote
        expect(lcxQuote.tokenIn).toBe(NATIVE)
        expect(lcxQuote.amountIn).toBe('600000000000000')
        h.buildMock.mockImplementation(async () => buildFor(lcxQuote))
        h.issuerGate.mockClear()

        const res = await bg.call(swapMsg({ dir: 'nativeBuy', mode: 'ats', lcxQuote }))

        expect(res).toEqual({ success: true, hash: '0xuserop' })
        const b = await h.buildMock.mock.results[0].value
        expect(b.tx.value).toBe('600000000000000')
        expect(h.executeAts.mock.calls[0][0].calls).toEqual([{ to: ROUTER_A, value: 600_000_000_000_000n, data: b.tx.data }])
        expect(h.providerCall).not.toHaveBeenCalled()
        expect(h.balance).toHaveBeenCalledWith(NATIVE, A.address)
        expect(h.issuerGate).toHaveBeenCalledWith({ issuer: 'coinbase' }) // alim: kapi sorulur
    })
})

describe('SWAP RWA: teklif kaydi', () => {
    it.each(['buy', 'sell'])('4. kayit yok (servis isci yeniden basladi, %s) -> LCX_REQUOTE; ne build ne kapi, kart yok', async (dir) => {
        await boot()
        const q = await seeded(dir, { skipRecord: true })

        const res = await bg.call(swapMsg({ dir, lcxQuote: q }))

        expect(res).toEqual({ error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' })
        expectStoppedBeforeBuildAndGate()
        await settle()
        expect(cards()).toHaveLength(0)
    })

    it('4b. kaydin omru dolmus (130 sn asildi) -> LCX_REQUOTE; kapi ATLANMAZ, build yok', async () => {
        await boot()
        const q = await seeded('buy', { skipRecord: true })
        await remember(q.quoteId, { issuer: 'coinbase', chainId: 8453, stock: TSLAC, side: 'buy' }, Date.now() - 131_000)

        const res = await bg.call(swapMsg({ lcxQuote: q }))

        expect(res).toEqual({ error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' })
        expectStoppedBeforeBuildAndGate()
    })

    it.each([
        ['stock', { stock: OTHER_STOCK }],
        ['chainId', { chainId: 1 }],
        ['side', { side: 'sell' }],
    ])('5. kayittaki %s mesajla farkli -> LCX_QUOTE_MISMATCH (field %s); ne build ne kapi', async (field, record) => {
        await boot()
        const q = await seeded('buy', { record })

        const res = await bg.call(swapMsg({ lcxQuote: q }))

        expect(res).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH', field })
        expectStoppedBeforeBuildAndGate()
    })

    it('5b. mesajdaki side konumdan turetilenle ayni degil (R1) -> LCX_QUOTE_MISMATCH field side; ne build ne kapi', async () => {
        await boot()
        const q = await seeded('buy')

        const res = await bg.call(swapMsg({ lcxQuote: q, side: 'sell' }))

        expect(res).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH', field: 'side' })
        expectStoppedBeforeBuildAndGate()
    })

    it('5c. side alani yoksa turetilen kullanilir: alim yine kapidan gecer ve basarili olur', async () => {
        await boot()
        const q = await seeded('buy')
        const m = swapMsg({ mode: 'ats', lcxQuote: q })
        delete m.message.side

        const res = await bg.call(m)

        expect(res.success).toBe(true)
        expect(h.issuerGate).toHaveBeenCalledWith({ issuer: 'coinbase' })
    })
})

describe('SWAP RWA: alimda kapi', () => {
    it.each(['ats', 'normal'])('6. kapi kapali (evaluateIssuer ok:false, %s) -> { error: STOCK_GATE:<neden> }; build yok, imza yok, kart yok', async (mode) => {
        h.issuerGate.mockResolvedValue({ ok: false, reason: 'IP_COUNTRY_ISSUER' })
        await boot()
        const q = await seeded('buy')

        const res = await bg.call(swapMsg({ mode, lcxQuote: q }))

        expect(res).toEqual({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        expect(h.issuerGate).toHaveBeenCalledWith({ issuer: 'coinbase' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
        await settle()
        expect(cards()).toHaveLength(0)
    })

    it('6a. kapi cevabi bozuk ya da firlatir: KAPALI (CHECK_FAILED); build yok', async () => {
        await boot()
        const q = await seeded('buy')
        for (const make of [
            () => Promise.reject(new Error('boom')),
            () => Promise.resolve({ ok: 'true' }),
            () => Promise.resolve(undefined),
            () => Promise.resolve({ reason: 'COUNTRY_UNKNOWN' }),
        ]) {
            h.issuerGate.mockReset()
            h.issuerGate.mockImplementation(make)
            const res = await bg.call(swapMsg({ lcxQuote: q }))
            expect(res.error, String(make)).toMatch(/^STOCK_GATE:/)
            expect(res.success).toBeUndefined()
        }
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    it('6b. tablo disi ihracci (kayit: foo) -> kapi CHECK_FAILED, alim durur; AYNI ihraccili kayitla satis serbest', async () => {
        // Sunucu suzgecine yeni ihracci eklendi, uygunluk tablosuna satiri eklenmedi: kapi (ISSUER_UNKNOWN -> CHECK_FAILED) alimi
        // kapatir, satis acik kalir (eldeki hisse satilabilmeli).
        h.issuerGate.mockImplementation(async ({ issuer }) => (issuer === 'foo'
            ? { ok: false, stock: true, issuer: 'foo', decision: 'BLOCK', reason: 'ISSUER_UNKNOWN' }
            : { ok: true, stock: true, issuer }))
        await boot()

        const buy = await seeded('buy', { record: { issuer: 'foo' } })
        const refused = await bg.call(swapMsg({ lcxQuote: buy }))

        expect(refused).toEqual({ error: 'STOCK_GATE:CHECK_FAILED' })
        expect(h.issuerGate).toHaveBeenCalledWith({ issuer: 'foo' }) // kapi KAYITTAKI ihraccidan sorulur (satirdan degil)
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()

        h.issuerGate.mockClear()
        const sell = await seeded('sell', { record: { issuer: 'foo' } })
        const sold = await bg.call(swapMsg({ dir: 'sell', mode: 'ats', lcxQuote: sell }))

        expect(sold.success).toBe(true)
        expect(h.issuerGate).not.toHaveBeenCalled()
        expect(h.buildMock).toHaveBeenCalledTimes(1)
        expect(h.executeAts).toHaveBeenCalledTimes(1)
    })

    it('6c. katalog kapisi (evaluate) da alimda sorulur; reddi build den once durdurur (ikinci koruma)', async () => {
        h.gate.mockResolvedValue({ ok: false, reason: 'KILL_SWITCH' })
        await boot()
        const q = await seeded('buy')

        const res = await bg.call(swapMsg({ lcxQuote: q }))

        expect(res).toEqual({ error: 'STOCK_GATE:KILL_SWITCH' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })
})

describe('ATS_SWAP_FEE_QUOTE RWA', () => {
    it('7. lcxKind rwa: ayni kayit + kapi + prepareLcxSwap yolundan quoteAtsTransfer a [approve, swapSplit] gider', async () => {
        await boot()
        const q = await seeded('buy')

        const res = await bg.call(feeMsg({ lcxQuote: q }))

        expect(res).toMatchObject({ success: true, transferFee: '1000' })
        expect(h.issuerGate).toHaveBeenCalledWith({ issuer: 'coinbase' })
        expect(h.buildMock).toHaveBeenCalledWith({ kind: 'rwa', quoteId: q.quoteId, recipient: A.address, slippageBps: 50 })
        expect(h.quoteAts).toHaveBeenCalledTimes(1)
        const arg = h.quoteAts.mock.calls[0][0]
        const b = await h.buildMock.mock.results[0].value
        expect(arg).toMatchObject({ chainId: 8453, address: A.address, opKind: 'swap' })
        expect(arg.calls).toEqual([
            { to: USDC, value: 0n, data: approveData(ROUTER_A, 2_000_000n) },
            { to: ROUTER_A, value: 0n, data: b.tx.data },
        ])
        noMaxApproval(arg.calls)
        expect(h.buildSwapCalls).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    it('7a. satis: kapi cagrilmaz; calls [hisse onayi, swapSplit]', async () => {
        await boot()
        const q = await seeded('sell')

        const res = await bg.call(feeMsg({ dir: 'sell', lcxQuote: q }))

        expect(res.success).toBe(true)
        expect(h.issuerGate).not.toHaveBeenCalled()
        expect(h.gate).not.toHaveBeenCalled()
        const b = await h.buildMock.mock.results[0].value
        expect(h.quoteAts.mock.calls[0][0].calls).toEqual([
            { to: TSLAC, value: 0n, data: approveData(ROUTER_A, 500_000n) },
            { to: ROUTER_A, value: 0n, data: b.tx.data },
        ])
    })

    it('7b. kayit yok -> { success:false, ...lcxErrorBody(LCX_REQUOTE) }; build, kapi ve quoteAtsTransfer cagrilmaz', async () => {
        await boot()
        const q = await seeded('buy', { skipRecord: true })

        const res = await bg.call(feeMsg({ lcxQuote: q }))

        expect(res).toEqual({ success: false, error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' })
        expectStoppedBeforeBuildAndGate()
        expect(h.quoteAts).not.toHaveBeenCalled()
    })

    it('7c. kapi kapali -> { success:false, error: STOCK_GATE:<neden>, code: STOCK_GATE } (arayuz bunu ATS engeli saymaz); build ve quoteAtsTransfer yok', async () => {
        h.issuerGate.mockResolvedValue({ ok: false, reason: 'IP_COUNTRY_ISSUER' })
        await boot()
        const q = await seeded('buy')

        const res = await bg.call(feeMsg({ lcxQuote: q }))

        expect(res).toEqual({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER', code: 'STOCK_GATE' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expect(h.quoteAts).not.toHaveBeenCalled()
        expect(h.buildSwapCalls).not.toHaveBeenCalled()
    })

    it('7d. kayit uyusmazligi alan adini tasir: { success:false, code: LCX_QUOTE_MISMATCH, field }', async () => {
        await boot()
        const q = await seeded('buy', { record: { chainId: 1 } })

        const res = await bg.call(feeMsg({ lcxQuote: q }))

        expect(res).toEqual({ success: false, error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH', field: 'chainId' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expect(h.quoteAts).not.toHaveBeenCalled()
    })

    it('7e. genel (lcxKind yok) ucret teklifi + LCX hissesi -> LCX_REFUSED use_rwa; bugunku motor ve quoteAtsTransfer yok', async () => {
        await boot()

        const res = await bg.call(feeMsg({ lcxQuote: undefined, lcxKind: undefined }))

        expect(res).toMatchObject({ success: false, error: expect.any(String), code: 'LCX_REFUSED', lcxCode: 'use_rwa' })
        expect(h.buildSwapCalls).not.toHaveBeenCalled()
        expect(h.quoteAts).not.toHaveBeenCalled()
        expect(h.buildMock).not.toHaveBeenCalled()
    })
})

describe('SWAP RWA: build guvenligi', () => {
    it.each(['ats', 'normal'])('8. build in to su baska bir adres -> LCX_TX_MISMATCH field to; gonderim yok (%s)', async (mode) => {
        await boot()
        const q = await seeded('buy', { build: { to: OTHER } })

        const res = await bg.call(swapMsg({ mode, lcxQuote: q }))

        expect(res).toEqual({ error: 'LCX_TX_MISMATCH', code: 'LCX_TX_MISMATCH', field: 'to' })
        expect(h.buildMock).toHaveBeenCalledTimes(1)
        expectNothingSigned()
        await settle()
        expect(cards()[0]).toMatchObject({ status: 'error', meta: { errorCode: 'LCX_TX_MISMATCH' } })
    })

    it('8b. build calldata si baska bir hisse tokeni aliyor (tokenOut) -> LCX_TX_MISMATCH field tokenOut; gonderim yok', async () => {
        await boot()
        const q = await seeded('buy', { build: { tokenOut: OTHER_STOCK } })

        const res = await bg.call(swapMsg({ mode: 'ats', lcxQuote: q }))

        expect(res).toEqual({ error: 'LCX_TX_MISMATCH', code: 'LCX_TX_MISMATCH', field: 'tokenOut' })
        expectNothingSigned()
    })

    it('8c. teklifin suresi dolmus (kayit var) -> LCX_REQUOTE; build cagrilmaz', async () => {
        await boot()
        const q = await seeded('buy', { quote: { expiresAt: nowSec() - 5 } })

        const res = await bg.call(swapMsg({ lcxQuote: q }))

        expect(res).toEqual({ error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' })
        expect(h.buildMock).not.toHaveBeenCalled()
        expectNothingSigned()
    })

    it('8d. hisse satisinda bakiye < amountIn -> INSUFFICIENT_BALANCE; okunamazsa LCX_UNAVAILABLE; ikisinde de build ve imza yok', async () => {
        await boot()
        const q = await seeded('sell')

        h.balance.mockResolvedValue(499_999n)
        expect(await bg.call(swapMsg({ dir: 'sell', lcxQuote: q }))).toEqual({ error: 'INSUFFICIENT_BALANCE', code: 'INSUFFICIENT_BALANCE' })
        h.balance.mockRejectedValue(new Error('rpc down'))
        expect(await bg.call(swapMsg({ dir: 'sell', lcxQuote: q }))).toEqual({ error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE' })

        expect(h.buildMock).not.toHaveBeenCalled()
        expect(h.providerCall).not.toHaveBeenCalled()
        expectNothingSigned()
    })
})

describe('SWAP RWA: kapali basarisizlik', () => {
    it('9. Gizli Hesap imzacisi -> LCX_UNAVAILABLE; ne kapi ne build, imza yok', async () => {
        await boot(GIZLI, { privacyFlag: 'false' })
        expect(bg.localStore.active_account.key).toBe(GIZLI.key)
        const q = await seeded('buy')

        const res = await bg.call(swapMsg({ lcxQuote: q }))

        expect(res).toEqual({ error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE' })
        expectStoppedBeforeBuildAndGate()
        expect(h.stocksMock).not.toHaveBeenCalled()
    })

    it('9b. bayrak kapali + lcxKind rwa -> LCX_UNAVAILABLE; bugunku motor, build, depo okumasi ve kapi yok', async () => {
        flag.on = false
        await boot()
        const q = rwaQuote('buy')

        const res = await bg.call(swapMsg({ lcxQuote: q }))

        expect(res).toEqual({ error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE' })
        expectStoppedBeforeBuildAndGate()
        expect(rowReads()).toHaveLength(0)
    })

    it('9c. lcxKind rwa ama lcxQuote yok / teklifin kind i rwa degil -> LCX_QUOTE_MISMATCH; bugunku yola DUSMEZ', async () => {
        await boot()

        const none = await bg.call(swapMsg({ lcxQuote: undefined }))
        const wrongKind = await bg.call(swapMsg({ lcxQuote: rwaQuote('buy', { kind: 'swap' }) }))

        expect(none).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH', field: 'lcxQuote' })
        expect(wrongKind).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH', field: 'kind' })
        expectStoppedBeforeBuildAndGate()
    })

    it('9d. statik katalog satiri (bStocks, BSC) RWA yoluna GIREMEZ: lcxKind rwa -> LCX_QUOTE_MISMATCH field stock', async () => {
        await boot()
        const bstock = getAddress(BSTOCKS[0].address)
        const BSC_USDT = getAddress('0x55d398326f99059fF775485246999027B3197955')

        const buy = await bg.call(swapMsg({
            chainId: 56, inTokenAddress: BSC_USDT, outTokenAddress: bstock, amount: '1',
            lcxQuote: rwaQuote('buy', { chainId: 56, tokenIn: BSC_USDT, tokenOut: bstock, amountIn: '1000000000000000000' }),
        }))
        const sell = await bg.call(swapMsg({
            chainId: 56, inTokenAddress: bstock, outTokenAddress: BSC_USDT, side: 'sell', amount: '1',
            lcxQuote: rwaQuote('sell', { chainId: 56, tokenIn: bstock, tokenOut: BSC_USDT, amountIn: '1000000000000000000' }),
        }))

        expect(buy).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH', field: 'stock' })
        expect(sell).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH', field: 'stock' })
        expectStoppedBeforeBuildAndGate()
    })

    it('9e. hisse disi cift (USDC -> WETH) lcxKind rwa ile -> LCX_QUOTE_MISMATCH field stock; build yok', async () => {
        await boot()

        const res = await bg.call(swapMsg({
            inTokenAddress: USDC, outTokenAddress: WETH,
            lcxQuote: rwaQuote('buy', { tokenOut: WETH }),
        }))

        expect(res).toEqual({ error: 'LCX_QUOTE_MISMATCH', code: 'LCX_QUOTE_MISMATCH', field: 'stock' })
        expectStoppedBeforeBuildAndGate()
    })
})

describe('SWAP: genel takasta LCX hissesi (R7)', () => {
    it('R7a. lcxKind yok + cikti LCX hissesi, servis isci yeni kalkmis (satirlar yalniz depoda) -> LCX_REFUSED use_rwa; hicbir sey yurutulmez', async () => {
        await boot()

        const res = await bg.call(generalMsg({ dir: 'buy', lcxQuote: undefined }))

        expect(res).toMatchObject({ error: expect.any(String), code: 'LCX_REFUSED', lcxCode: 'use_rwa' })
        expect(rowReads().length).toBeGreaterThan(0) // satirlar SWAP aninda depodan yuklendi
        expectStoppedBeforeBuildAndGate()
        expect(h.stocksMock).not.toHaveBeenCalled()
        expect(h.quoteMock).not.toHaveBeenCalled()
        expect(h.decimals).not.toHaveBeenCalled()
        await settle()
        expect(cards()).toHaveLength(0)
    })

    it.each(['ats', 'normal'])('R7b. lcxKind yok + girdi LCX hissesi (satis), Bolum 1 tipi lcxQuote ile de (%s) -> LCX_REFUSED use_rwa; build ve motor yok', async (mode) => {
        await boot()

        const res = await bg.call(generalMsg({ dir: 'sell', mode, lcxQuote: rwaQuote('sell', { kind: 'swap' }) }))

        expect(res).toMatchObject({ code: 'LCX_REFUSED', lcxCode: 'use_rwa' })
        expectStoppedBeforeBuildAndGate()
        await settle()
        expect(cards()).toHaveLength(0)
    })

    it('R7c. bayrak kapali: genel takas bugunku gibi (depo okunmaz, hisse reddi yok, motor calisir)', async () => {
        flag.on = false
        await boot()

        const res = await bg.call(generalMsg({ dir: 'sell', lcxQuote: undefined }))

        expect(res).toEqual({ success: true, hash: '0xlegacy' })
        expect(h.executeSwap).toHaveBeenCalledTimes(1)
        expect(rowReads()).toHaveLength(0)
        expect(h.buildMock).not.toHaveBeenCalled()
    })

    it('R7d. LCX hissesi olmayan genel takas (USDC -> WETH) etkilenmez: bugunku motor calisir', async () => {
        await boot()

        const res = await bg.call(generalMsg({ inTokenAddress: USDC, outTokenAddress: WETH, lcxQuote: undefined }))

        expect(res).toEqual({ success: true, hash: '0xlegacy' })
        expect(h.executeSwap).toHaveBeenCalledTimes(1)
        expect(h.buildMock).not.toHaveBeenCalled()
    })
})

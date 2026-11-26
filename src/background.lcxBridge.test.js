import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { HDNodeWallet, getAddress } from 'ethers'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { createVault, deriveMasterKey, randBytes } from './utils/crypto-utils'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'
import { LCX_STOCK_ROWS_KEY } from './utils/lcx/stockRows'
import { BRIDGE_QUOTES_KEY } from './utils/bridgeQuoteGuard'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// KOPRU ve LCX HISSELERI (Bolum 2, nihai inceleme: sartname madde 9). LCX hissesi koprude ne KAYNAK ne HEDEF olabilir ve bu karar
// servis isci bosta yeniden basladiktan sonra da gecerli kalmali: dinamik satirlar o zaman bellekte yoktur, yalniz depodadir.
// Uc isleyici (BRIDGE_QUOTE, BRIDGE, ATS_BRIDGE_FEE_QUOTE) satirlari kendisi depodan yuklemelidir (ensureLcxStockRows).
// GERCEK: utils/bridge.js varsayilan ihraci (kaynak / hedef kapilari) ve satir katmani. SAHTE: ag (LI.FI istegi), saglayici, ATS /
// yurutme ve ilk alim kapisi.
const flag = vi.hoisted(() => ({ on: true }))
const h = vi.hoisted(() => ({
    quote: vi.fn(),          // utils/bridge varsayilan ihraci (varsayilan: GERCEK ihrac)
    realQuote: null,         // her boot'ta yeni modul orneginin gercek ihraci (vi.resetModules sonrasi tokenizedStocks ayni ornek olsun diye)
    cross: vi.fn(),          // crossChainSwap
    calls: vi.fn(),          // buildBridgeCalls
    executeAts: vi.fn(),
    quoteAts: vi.fn(),
    lifiRequest: vi.fn(),    // LI.FI'ye giden istek (axios adaptoru): hicbir yolda GERCEK ag yok
    gate: vi.fn(),           // ilk alim kapisi, katalog yolu
    bridgeGate: vi.fn(),     // ilk alim kapisi, kopru hedefi yolu
}))

vi.mock('ethers', async (importOriginal) => {
    const real = await importOriginal()
    class FakeProvider {
        constructor(url) { this.url = url }
        call() { throw new Error('rpc offline') }
    }
    return { ...real, JsonRpcProvider: FakeProvider, ethers: { ...real.ethers, JsonRpcProvider: FakeProvider } }
})
vi.mock('axios', async (importOriginal) => {
    const real = await importOriginal()
    // axios.create() varsayilanlari bu kopyadan alir: bridge.js'in LI.FI istemcisi da cevrimdisi olur.
    real.default.defaults.adapter = async (config) => {
        h.lifiRequest(config.url)
        throw new Error('offline test')
    }
    return real
})
vi.mock('./utils/bridge', async (importOriginal) => {
    const real = await importOriginal()
    h.realQuote = real.default
    return {
        ...real,
        default: (...a) => h.quote(...a),
        crossChainSwap: (...a) => h.cross(...a),
        buildBridgeCalls: (...a) => h.calls(...a),
    }
})
vi.mock('./utils/atsPaymaster', async (importOriginal) => ({
    ...(await importOriginal()),
    executeAtsTransfer: (...a) => h.executeAts(...a),
    quoteAtsTransfer: (...a) => h.quoteAts(...a),
}))
vi.mock('./utils/stockGate/gate', async (importOriginal) => ({
    ...(await importOriginal()),
    createStockGate: () => ({
        evaluate: (...a) => h.gate(...a),
        evaluateIssuer: async () => ({ ok: true }),
        evaluateBridgeTarget: (...a) => h.bridgeGate(...a),
        status: async () => ({ ok: true }),
    }),
}))

const MNEMONIC = 'test test test test test test test test test test test junk'
let A, vault, jwk
beforeAll(async () => {
    const masterKey = await deriveMasterKey('parola-123456', randBytes(32))
    const hd = HDNodeWallet.fromPhrase(MNEMONIC, null, 'm')
    const path1 = "m/44'/60'/0'/0/0"
    A = { key: 'a-1', name: 'Hesap 1', type: 'hd', index: 0, derivationPath: path1, address: hd.derivePath(path1).address }
    vault = await createVault(masterKey, MNEMONIC, A)
    jwk = await crypto.subtle.exportKey('jwk', masterKey)
}, 60000)

const NATIVE = '0x0000000000000000000000000000000000000000'
const USDC_ETH = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const ROUTER = getAddress('0x' + '5a'.repeat(20))
const SPENDER = getAddress('0x' + '6b'.repeat(20))
const CALLDATA = '0x' + 'ab'.repeat(68)
const TSLAC = getAddress('0xb2000000000000000000001e800a7f5189430cD0')
const NOT_BRIDGEABLE = 'Tokenized stocks cannot be bridged'

// Sunucunun /lcx/stocks satir bicimi: Base TSLAC, Coinbase hissesi (background.lcxRwaSwap.test.js ile ayni).
const TSLAC_ROW = {
    chainId: 8453, address: TSLAC, symbol: 'TSLAC', name: 'Tesla (Coinbase Tokenized Stocks)', decimals: 8, issuer: 'coinbase',
    underlying: 'TSLA', category: 'stocks', priceUsd: 388.61280861, priceSource: 'Chainlink Coinbase TSLA on Base',
    priceUpdatedAt: 1795071867, marketHours: 'us_equities', depthUsd: 252144.395038,
}
// Zamanlar KULLANILDIGI ANDA hesaplanir (modul yuklenirken degil).
const storedRows = () => ({ fetchedAt: Date.now() - 30_000, asOf: Date.now() - 40_000, usEquitiesOpen: false, rows: [TSLAC_ROW] })

let bg
// `rows`: depodaki satirlar (null: depo bos). Satirlar BELLEKTE degildir (servis isci yeni kalkmis gibi): isleyici depodan yukler.
async function boot({ rows = storedRows() } = {}) {
    vi.stubEnv('VITE_LCX_ENABLED', flag.on ? 'true' : 'false')
    bg = await bootBackground({
        localStore: {
            active_account: A, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {},
            ...(rows ? { [LCX_STOCK_ROWS_KEY]: rows } : {}),
        },
        sessionStore: { sessionMasterKeyJwk: jwk },
    })
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)) }
const rowReads = () => bg.chrome.storage.local.get.mock.calls.filter((c) => c[0] === LCX_STOCK_ROWS_KEY)
const cards = () => bg.localStore.current_transactions || []

// LI.FI /quote yaniti (alici = imzaci: rememberBridgeQuote reddetmesin).
const lifiQuote = (signer) => ({
    id: 'q1',
    action: { fromChainId: 1, toChainId: 56, fromAddress: signer, toAddress: signer, fromAmount: '1000000', fromToken: { address: USDC_ETH, decimals: 6, symbol: 'USDC' } },
    estimate: { approvalAddress: SPENDER, toAmount: '990000', executionDuration: 60 },
    transactionRequest: { from: signer, to: ROUTER, chainId: 1, data: CALLDATA, value: '0x0' },
})

const quoteMsg = (over = {}) => ({
    type: 'BRIDGE_QUOTE',
    message: {
        fromChain: 1, toChain: 8453, inToken: { address: NATIVE, decimals: 18 }, outToken: { address: TSLAC, decimals: 8 },
        amount: '1', filter: 'CHEAPEST', slippage: 0.5, ...over,
    },
})
const bridgeMsg = (over = {}) => ({
    type: 'BRIDGE',
    message: {
        from: USDC_ETH, to: ROUTER, data: CALLDATA, value: '0x0', chain: 1, amount: 1, amount_raw: '1000000',
        toChain: 8453, toTokenAddress: TSLAC, fromTokenData: { symbol: 'USDC' }, ...over,
    },
})
const feeMsg = (over = {}) => ({
    type: 'ATS_BRIDGE_FEE_QUOTE',
    message: {
        chainId: 1, to: ROUTER, data: CALLDATA, value: '0x0', fromTokenAddress: USDC_ETH, amount_raw: '1000000',
        approvalAddress: SPENDER, toChain: 8453, toTokenAddress: TSLAC, ...over,
    },
})

beforeEach(() => {
    for (const m of Object.values(h)) if (typeof m === 'function' && m.mockReset) m.mockReset()
    flag.on = true
    // Varsayilan: GERCEK ihrac (kaynak / hedef kapilari gercek); LI.FI istegi cevrimdisi.
    h.quote.mockImplementation((...a) => h.realQuote(...a))
    h.gate.mockResolvedValue({ ok: true })
    h.bridgeGate.mockResolvedValue({ ok: true })
    h.calls.mockResolvedValue([{ to: ROUTER, value: 0n, data: CALLDATA }])
    h.quoteAts.mockResolvedValue({ transferFee: '1000', commissionFee: '10' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
    await settle()
    teardownBackground()
    vi.restoreAllMocks()
})

// Hicbir ag / imza / yurutme yapilmadi.
function expectNothingExecuted() {
    expect(h.lifiRequest).not.toHaveBeenCalled()
    expect(h.cross).not.toHaveBeenCalled()
    expect(h.calls).not.toHaveBeenCalled()
    expect(h.executeAts).not.toHaveBeenCalled()
    expect(h.quoteAts).not.toHaveBeenCalled()
}

describe('BRIDGE_QUOTE: LCX hissesi Kopru kaynagi da hedefi de olamaz (servis isci yeniden basladiktan sonra da)', () => {
    it('1. HEDEF LCX hissesi (satirlar yalniz depoda): kapi acik olsa da gercek ihrac reddeder; LI.FI istegi yok', async () => {
        await boot()

        const res = await bg.call(quoteMsg())

        expect(res).toEqual({ success: false, error: `${NOT_BRIDGEABLE}: ${TSLAC}` })
        expect(rowReads().length).toBeGreaterThan(0) // satirlar isleyicide depodan yuklendi
        expect(h.gate).toHaveBeenCalledTimes(1) // hedef LCX hissesi olarak taninip ilk alim kapisina girdi
        expectNothingExecuted()
        expect(bg.sessionStore[BRIDGE_QUOTES_KEY]).toBeUndefined()
    })

    it('2. KAYNAK LCX hissesi (satirlar yalniz depoda): gercek ihrac reddeder; LI.FI istegi yok', async () => {
        await boot()

        const res = await bg.call(quoteMsg({
            fromChain: 8453, toChain: 1, inToken: { address: TSLAC, decimals: 8 }, outToken: { address: USDC_ETH, decimals: 6 },
        }))

        expect(res).toEqual({ success: false, error: `${NOT_BRIDGEABLE}: ${TSLAC}` })
        expect(rowReads().length).toBeGreaterThan(0)
        expectNothingExecuted()
    })

    it('3. hisse olmayan kopru (ETH -> BSC) bugunku gibi gecer: satirlar yuklenir ama hicbir sey fazladan reddedilmez', async () => {
        await boot()
        h.quote.mockResolvedValueOnce(lifiQuote(A.address))

        const res = await bg.call(quoteMsg({ toChain: 56, outToken: { address: NATIVE, decimals: 18 } }))

        expect(res.success).toBe(true)
        expect(h.quote).toHaveBeenCalledTimes(1)
        expect(h.gate).not.toHaveBeenCalled()
    })

    it('4. bayrak kapali: depo okunmaz, dinamik satir yok (bugunku davranis)', async () => {
        flag.on = false
        await boot()
        h.quote.mockResolvedValueOnce(lifiQuote(A.address))

        const res = await bg.call(quoteMsg({ toChain: 56, outToken: { address: NATIVE, decimals: 18 } }))

        expect(res.success).toBe(true)
        expect(rowReads()).toHaveLength(0)
        expect(h.gate).not.toHaveBeenCalled()
    })
})

describe('BRIDGE: LCX hedefi servis isci yeniden basladiktan sonra da ilk alim kapisina girer', () => {
    it('5. hedef LCX hissesi (satirlar yalniz depoda): kopru hedefi kapisina sorulur, ret STOCK_GATE hatasi; kayit, ag ve yurutme yok', async () => {
        await boot()
        h.bridgeGate.mockResolvedValue({ ok: false, reason: 'BLOCKED' })

        const res = await bg.call(bridgeMsg())

        expect(res.success).toBe(false)
        expect(res.error).toMatch(/^STOCK_GATE:/)
        expect(h.bridgeGate).toHaveBeenCalledTimes(1)
        expect(h.bridgeGate).toHaveBeenCalledWith({ toChain: 8453, toTokenAddress: TSLAC })
        expect(rowReads().length).toBeGreaterThan(0)
        await settle()
        expect(cards()).toEqual([])
        expectNothingExecuted()
    })

    it('6. bayrak kapali: depo okunmaz; LCX adresi bugunku gibi kapiya girmez', async () => {
        flag.on = false
        await boot()

        await bg.call(bridgeMsg())

        expect(rowReads()).toHaveLength(0)
        expect(h.bridgeGate).not.toHaveBeenCalled()
    })
})

describe('ATS_BRIDGE_FEE_QUOTE: LCX hedefi servis isci yeniden basladiktan sonra da ilk alim kapisina girer', () => {
    it('7. hedef LCX hissesi (satirlar yalniz depoda): kapi reddi STOCK_GATE kodlu hata; ucret teklifi ve ag yok', async () => {
        await boot()
        h.bridgeGate.mockResolvedValue({ ok: false, reason: 'BLOCKED' })

        const res = await bg.call(feeMsg())

        expect(res.success).toBe(false)
        expect(res.code).toBe('STOCK_GATE')
        expect(res.error).toMatch(/^STOCK_GATE:/)
        expect(h.bridgeGate).toHaveBeenCalledTimes(1)
        expect(h.bridgeGate).toHaveBeenCalledWith({ toChain: 8453, toTokenAddress: TSLAC })
        expect(rowReads().length).toBeGreaterThan(0)
        expectNothingExecuted()
    })

    it('8. bayrak kapali: depo okunmaz; LCX adresi bugunku gibi kapiya girmez', async () => {
        flag.on = false
        await boot()

        await bg.call(feeMsg())

        expect(rowReads()).toHaveLength(0)
        expect(h.bridgeGate).not.toHaveBeenCalled()
    })
})

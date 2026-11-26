import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { HDNodeWallet, getAddress } from 'ethers'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { createVault, deriveMasterKey, randBytes } from './utils/crypto-utils'
import { derivePrivateAccount } from './utils/privacy/privateAccount'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'
import { LcxUnavailableError, LcxRefusalError } from './utils/lcx/client'
import { LCX_STOCK_ROWS_KEY } from './utils/lcx/stockRows'
import rwaBuy from './utils/lcx/fixtures/rwa-quote-base.json'
import rwaSell from './utils/lcx/fixtures/rwa-quote-base-sell.json'
import rwaNativeBuy from './utils/lcx/fixtures/rwa-quote-base-native-buy.json'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// SWAP_QUOTE RWA DALI (Bolum 2, Gorev 5): `lcxKind: 'rwa'` + `side`. Ag yoktur: LCX istemcisi (fetchLcxQuote, fetchLcxStocks,
// fetchLcxStablecoins), takas motoru ve kapi taklit edilir; satir katmani (tokenizedStocks), yukleyici (stockRows), odeme tokeni
// tablosu, teklif eslemesi (mapQuote) ve arka plan akisi GERCEKTIR. Hata siniflari GERCEK siniflardir (bkz. background.lcxQuote.test.js).
const flag = vi.hoisted(() => ({ on: true }))
const keep = vi.hoisted(() => ({ client: null, select: null }))

const quoteMock = vi.fn()        // utils/lcx/client fetchLcxQuote
const stocksMock = vi.fn()       // utils/lcx/client fetchLcxStocks
const stablesMock = vi.fn()      // utils/lcx/client fetchLcxStablecoins
const expectedMock = vi.fn()     // bugunku (yedek) yol: MultiChainSwapManager#getExpectedOutput
const decimalsMock = vi.fn()     // MultiChainSwapManager#getTokenDecimals (RWA yolu ZINCIR OKUMAZ: hic cagrilmamali)
const gateMock = vi.fn()         // ilk alim kapisi, katalog yolu: evaluate({ chainId, outAddress })
const issuerGateMock = vi.fn()   // ilk alim kapisi, ihracci yolu: evaluateIssuer({ issuer })
const order = []                 // cagri sirasi: 'quote' | 'issuerGate'

vi.mock('./utils/lcx/client', async (importOriginal) => {
    keep.client ??= await importOriginal()
    return {
        ...keep.client,
        fetchLcxQuote: (...a) => (order.push('quote'), quoteMock(...a)),
        fetchLcxStocks: (...a) => stocksMock(...a),
        fetchLcxStablecoins: (...a) => stablesMock(...a),
    }
})
vi.mock('./utils/stockGate/gate', async (importOriginal) => ({
    ...(await importOriginal()),
    createStockGate: () => ({
        evaluate: (...a) => gateMock(...a),
        evaluateIssuer: (...a) => (order.push('issuerGate'), issuerGateMock(...a)),
        evaluateBridgeTarget: async () => ({ ok: true }),
        status: async () => ({ ok: true }),
    }),
}))
vi.mock('./utils/swap', async (importOriginal) => ({
    ...(await importOriginal()),
    MultiChainSwapManager: class {
        getExpectedOutput(...args) { return expectedMock(...args) }
        getTokenDecimals(address) { return decimalsMock(address) }
    },
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

const NATIVE = '0x0000000000000000000000000000000000000000'
const USDC = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
const WETH = getAddress('0x4200000000000000000000000000000000000006')
const TSLAC = getAddress('0xb2000000000000000000001e800a7f5189430cD0')
const clone = (x) => JSON.parse(JSON.stringify(x))
const LEGACY = { expectedOutput: '7', estimatedGasFee: { totalCost: '0.001', totalCostUSD: null } }
const NOW = Date.now()

// Sunucunun /lcx/stocks satir bicimi (stockRows.test.js ile ayni): Base TSLAC, Coinbase hissesi, 8 ondalik.
const TSLAC_ROW = {
    chainId: 8453, address: TSLAC, symbol: 'TSLAC', name: 'Tesla (Coinbase Tokenized Stocks)', decimals: 8, issuer: 'coinbase',
    underlying: 'TSLA', category: 'stocks', priceUsd: 388.61280861, priceSource: 'Chainlink Coinbase TSLA on Base',
    priceUpdatedAt: 1795071867, marketHours: 'us_equities', depthUsd: 252144.395038,
}
// Zamanlar KULLANILDIGI ANDA hesaplanir (modul yuklenirken degil): agir bir acilis tazelik / rozet sinirini cevirmesin.
const storedRows = (rows = [TSLAC_ROW]) => ({ fetchedAt: Date.now() - 30_000, asOf: Date.now() - 40_000, usEquitiesOpen: false, rows })

let bg
// `rows`: depodaki satirlar (null: depo bos). Satirlar BELLEKTE degildir: servis isci yeni kalkmis gibi, arka plan teklif aninda
// depodan yukler (test 10).
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
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)) }

// Mesaj: Base, USDC -> TSLAC, "2" USDC (alim).
const buyMsg = (over = {}) => ({
    type: 'SWAP_QUOTE',
    message: { chainId: 8453, inTokenAddress: USDC, outTokenAddress: TSLAC, amount: '2', slippage: 0.5, lcxKind: 'rwa', side: 'buy', ...over },
})
// TSLAC -> USDC (satis).
const sellMsg = (over = {}) => buyMsg({ inTokenAddress: TSLAC, outTokenAddress: USDC, amount: '0.005', side: 'sell', ...over })
// Genel takas: lcxKind yok.
const generalMsg = (over = {}) => {
    const m = buyMsg(over)
    delete m.message.lcxKind
    delete m.message.side
    return m
}

// Depo okumalari: hydrateLcxStockRows ve refreshLcxStockRows (readRecord) ikisi de chrome.storage.local.get('lcx_stock_rows') okur;
// satirlar GERCEK yukleyiciyle yuklenir (yukleyici taklit EDILMEZ: vitest importOriginal ayri bir tokenizedStocks ornegi kurar).
const rowReads = () => bg.chrome.storage.local.get.mock.calls.filter((c) => c[0] === LCX_STOCK_ROWS_KEY)
const rowWrites = () => bg.chrome.storage.local.set.mock.calls.filter((c) => Object.hasOwn(c[0] ?? {}, LCX_STOCK_ROWS_KEY))
const recall = async (quoteId) => (await import('./utils/lcx/rwaQuoteMemory')).recallRwaQuote(quoteId)
const noLcxNoLegacy = () => {
    expect(quoteMock).not.toHaveBeenCalled()
    expect(stocksMock).not.toHaveBeenCalled()
    expect(stablesMock).not.toHaveBeenCalled()
    expect(expectedMock).not.toHaveBeenCalled()
}

beforeEach(() => {
    for (const m of [quoteMock, stocksMock, stablesMock, expectedMock, decimalsMock, gateMock, issuerGateMock]) m.mockReset()
    order.length = 0
    flag.on = true
    gateMock.mockResolvedValue({ ok: true })
    issuerGateMock.mockResolvedValue({ ok: true })
    expectedMock.mockResolvedValue(LEGACY)
    decimalsMock.mockResolvedValue(18)
    stablesMock.mockResolvedValue(new Map())
    stocksMock.mockResolvedValue({ usEquitiesOpen: false, asOf: NOW - 1000, rows: [TSLAC_ROW] })
    quoteMock.mockImplementation(async () => clone(rwaBuy.data))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
    await settle()
    teardownBackground()
    vi.restoreAllMocks()
})

describe('SWAP_QUOTE RWA: bayrak ve gizli mod', () => {
    it('1. bayrak kapali: lcxKind rwa -> LCX_UNAVAILABLE; hicbir fetch, hicbir yukleme, kapi yok', async () => {
        flag.on = false
        await boot()

        const res = await bg.call(buyMsg())

        expect(res.code).toBe('LCX_UNAVAILABLE')
        expect(typeof res.error).toBe('string')
        expect(res.success).toBeUndefined()
        noLcxNoLegacy()
        expect(rowReads()).toHaveLength(0) // ne yukleme ne tazeleme: depoya bile dokunulmaz
        expect(rowWrites()).toHaveLength(0)
        expect(gateMock).not.toHaveBeenCalled()
        expect(issuerGateMock).not.toHaveBeenCalled()
    })

    it('1b. bayrak kapali, lcxKind yok: bugunku yol aynen (dinamik satir yok, depo okunmaz)', async () => {
        flag.on = false
        await boot()

        const res = await bg.call(generalMsg())

        expect(res).toEqual({ success: true, data: LEGACY })
        expect(expectedMock).toHaveBeenCalledTimes(1)
        expect(rowReads()).toHaveLength(0)
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('2. Gizli Hesap imzacisi: LCX_UNAVAILABLE; fetchLcxQuote / fetchLcxStocks / fetchLcxStablecoins HIC cagrilmaz', async () => {
        await boot(GIZLI, { privacyFlag: 'false' })
        expect(bg.localStore.active_account.key).toBe(GIZLI.key)

        for (const m of [buyMsg(), sellMsg()]) {
            const res = await bg.call(m)
            expect(res.code).toBe('LCX_UNAVAILABLE')
        }

        expect(bg.localStore.active_account.key).toBe(GIZLI.key)
        noLcxNoLegacy()
        expect(rowWrites()).toHaveLength(0) // tazeleme (ag + yazim) yok; depodan okuma serbest
        expect(issuerGateMock).not.toHaveBeenCalled()
    })

    it('2b. Gizli Hesap imzacisi, genel takasta hisse: bugunku yola DUSMEZ (use_rwa reddi), LCX a istek yok', async () => {
        await boot(GIZLI, { privacyFlag: 'false' })

        const res = await bg.call(generalMsg())

        expect(res.code).toBe('LCX_REFUSED')
        expect(res.lcxCode).toBe('use_rwa')
        noLcxNoLegacy()
    })

    it('2c. bayrak acik ama LCX agi olmayan zincir (Celo) ya da kayma araligi disi: LCX_UNAVAILABLE, fetch yok', async () => {
        await boot()

        const celo = await bg.call(buyMsg({ chainId: 42220 }))
        const wide = await bg.call(buyMsg({ slippage: 50 }))

        expect(celo.code).toBe('LCX_UNAVAILABLE')
        expect(wide.code).toBe('LCX_UNAVAILABLE')
        noLcxNoLegacy()
    })
})

describe('SWAP_QUOTE RWA: alim', () => {
    it('3. Base USDC -> TSLAC, "2" USDC: LCX e kind rwa ile gider, kapi ihracciyla sorulur, quoteId kaydedilir', async () => {
        await boot()

        const res = await bg.call(buyMsg())

        expect(quoteMock).toHaveBeenCalledTimes(1)
        expect(quoteMock).toHaveBeenCalledWith({
            kind: 'rwa', chainId: 8453, tokenIn: USDC, tokenOut: TSLAC, amountIn: '2000000', slippageBps: 50,
        })
        expect(issuerGateMock).toHaveBeenCalledTimes(1)
        expect(issuerGateMock).toHaveBeenCalledWith({ issuer: 'coinbase' })
        // KAPI AG CAGRISINDAN ONCE: LCX a hicbir sey gitmeden karar verilmis olmali.
        expect(order.indexOf('issuerGate')).toBeGreaterThan(-1)
        expect(order.indexOf('issuerGate')).toBeLessThan(order.indexOf('quote'))
        expect(issuerGateMock.mock.invocationCallOrder[0]).toBeLessThan(quoteMock.mock.invocationCallOrder[0])

        expect(res.success).toBe(true)
        expect(res.data.routerType.name).toBe('lcx')
        expect(res.data.lcxQuote.kind).toBe('rwa')
        expect(res.data.lcxQuote.rwa.issuer).toBe('coinbase')
        expect(res.data.lcxQuote.rwa).toMatchObject({ symbol: 'TSLAC', underlying: 'TSLA', marketOpen: false })
        expect(res.data.expectedOutput).toBe('0.00513279')
        expect(res.data.lcxQuote.amountIn).toBe('2000000')

        // Odeme ve hisse ondaliklari TABLODAN / SATIRDAN: zincir okumasi yok, bugunku yol yok.
        expect(decimalsMock).not.toHaveBeenCalled()
        expect(expectedMock).not.toHaveBeenCalled()
        expect(stablesMock).not.toHaveBeenCalled()
        expect(stocksMock).not.toHaveBeenCalled()

        const kept = await recall(res.data.lcxQuote.quoteId)
        expect(kept).toEqual({ issuer: 'coinbase', chainId: 8453, stock: TSLAC, side: 'buy' })
    })

    it('3b. native alim (ETH -> TSLAC, "0.0006" ETH): tokenIn LCX native adresi, ham tutar 18 ondalikli', async () => {
        quoteMock.mockImplementation(async () => clone(rwaNativeBuy.data))
        await boot()

        const res = await bg.call(buyMsg({ inTokenAddress: '0x0', amount: '0.0006' }))

        expect(quoteMock).toHaveBeenCalledWith({
            kind: 'rwa', chainId: 8453, tokenIn: NATIVE, tokenOut: TSLAC, amountIn: '600000000000000', slippageBps: 50,
        })
        expect(res.success).toBe(true)
        expect(res.data.lcxQuote.tokenIn).toBe(NATIVE)
        expect(issuerGateMock).toHaveBeenCalledWith({ issuer: 'coinbase' })
        expect(decimalsMock).not.toHaveBeenCalled()
    })

    it('3c. kapi reddi: { error: STOCK_GATE:<neden> }; LCX e istek yok, kayit yok', async () => {
        issuerGateMock.mockResolvedValue({ ok: false, reason: 'IP_COUNTRY_ISSUER' })
        await boot()

        const res = await bg.call(buyMsg())

        expect(res).toEqual({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        noLcxNoLegacy()
    })

    it('3d. kapi cevabi bozuk ya da firlatir: KAPALI (CHECK_FAILED); LCX e istek yok', async () => {
        await boot()
        for (const make of [
            () => Promise.reject(new Error('boom')),
            () => Promise.resolve({ ok: 'true' }),
            () => Promise.resolve(undefined),
            () => Promise.resolve({ reason: 'COUNTRY_UNKNOWN' }),
        ]) {
            issuerGateMock.mockReset()
            issuerGateMock.mockImplementation(make)
            const res = await bg.call(buyMsg())
            expect(res.error, String(make)).toMatch(/^STOCK_GATE:/)
            expect(res.success).toBeUndefined()
        }
        noLcxNoLegacy()
    })

    it('3e. katalog kapisi (evaluate) da alimda sorulur ve reddi LCX e gitmeden durdurur (ikinci koruma)', async () => {
        gateMock.mockResolvedValue({ ok: false, reason: 'KILL_SWITCH' })
        await boot()

        const res = await bg.call(buyMsg())

        expect(res).toEqual({ error: 'STOCK_GATE:KILL_SWITCH' })
        noLcxNoLegacy()
    })
})

describe('SWAP_QUOTE RWA: satis', () => {
    it('4. TSLAC -> USDC: kapi (iki yolu da) CAGRILMAZ, yanit basarili; kayit yazilir', async () => {
        quoteMock.mockImplementation(async () => clone(rwaSell.data))
        await boot()

        const res = await bg.call(sellMsg())

        expect(gateMock).not.toHaveBeenCalled()
        expect(issuerGateMock).not.toHaveBeenCalled()
        expect(quoteMock).toHaveBeenCalledWith({
            kind: 'rwa', chainId: 8453, tokenIn: TSLAC, tokenOut: USDC, amountIn: '500000', slippageBps: 50,
        })
        expect(res.success).toBe(true)
        expect(res.data.lcxQuote.kind).toBe('rwa')
        expect(res.data.lcxQuote.rwa.issuer).toBe('coinbase')
        expect(res.data.lcxQuote.rwa.referenceUsd).toBe(346.905)
        expect(expectedMock).not.toHaveBeenCalled()
        expect(await recall(res.data.lcxQuote.quoteId)).toEqual({ issuer: 'coinbase', chainId: 8453, stock: TSLAC, side: 'sell' })
    })

    it('7. MAX satis: 8 ondalikli hisse, "0.00500001" -> amountIn 500001 (artik yok); 8 ondaligi asan hane KESILIR', async () => {
        quoteMock.mockImplementation(async (sent) => {
            const d = clone(rwaSell.data)
            d.quote.input.amount = sent.amountIn
            return d
        })
        await boot()

        const exact = await bg.call(sellMsg({ amount: '0.00500001' }))
        expect(quoteMock.mock.calls[0][0].amountIn).toBe('500001')
        expect(exact.success).toBe(true)
        expect(exact.data.lcxQuote.amountIn).toBe('500001')

        // 9. hane (kayan nokta artigi) yuvarlanmaz, kesilir: yukari yuvarlama bakiyeyi asardi.
        const dust = await bg.call(sellMsg({ amount: '0.005000019' }))
        expect(quoteMock.mock.calls[1][0].amountIn).toBe('500001')
        expect(dust.success).toBe(true)

        // Tam sayi tutar.
        await bg.call(sellMsg({ amount: '3' }))
        expect(quoteMock.mock.calls[2][0].amountIn).toBe('300000000')
    })
})

describe('SWAP_QUOTE RWA: ihracci eslesmesi', () => {
    it('5. teklifteki rwa.asset.issuer Ondo ama katalog satiri coinbase: LCX_REFUSED issuer_mismatch; kayit tutulmaz', async () => {
        const wrong = clone(rwaBuy.data)
        wrong.rwa.asset.issuer = 'Ondo'
        quoteMock.mockImplementation(async () => wrong)
        await boot()

        const res = await bg.call(buyMsg())

        expect(res.code).toBe('LCX_REFUSED')
        expect(res.lcxCode).toBe('issuer_mismatch')
        expect(res.success).toBeUndefined()
        expect(expectedMock).not.toHaveBeenCalled()
        expect(await recall(wrong.quote.quoteId)).toBeNull()
    })

    it('5b. ihracci alani yok / normallestirilemez: ayni ret; satis da dahil (ihracci her iki yonde dogrulanir)', async () => {
        await boot()
        for (const mutate of [(d) => delete d.rwa.asset.issuer, (d) => (d.rwa.asset.issuer = 5), (d) => (d.rwa.asset.issuer = '--')]) {
            const d = clone(rwaBuy.data)
            mutate(d)
            quoteMock.mockImplementation(async () => d)
            const res = await bg.call(buyMsg())
            expect(res.lcxCode).toBe('issuer_mismatch')
            expect(await recall(d.quote.quoteId)).toBeNull()
        }
        const sell = clone(rwaSell.data)
        sell.rwa.asset.issuer = 'Robinhood'
        quoteMock.mockImplementation(async () => sell)
        const res = await bg.call(sellMsg())
        expect(res.code).toBe('LCX_REFUSED')
        expect(res.lcxCode).toBe('issuer_mismatch')
        expect(await recall(sell.quote.quoteId)).toBeNull()
    })

    it('5c. ihracci adi yazim farkiyla gelse de (Coinbase / COINBASE) eslesir', async () => {
        const d = clone(rwaBuy.data)
        d.rwa.asset.issuer = 'COINBASE'
        quoteMock.mockImplementation(async () => d)
        await boot()

        const res = await bg.call(buyMsg())

        expect(res.success).toBe(true)
        expect(res.data.lcxQuote.rwa.issuer).toBe('coinbase')
    })
})

describe('SWAP_QUOTE RWA: mesaj tutarliligi (R1)', () => {
    const mismatch = (res, field) => {
        expect(res.code).toBe('LCX_QUOTE_MISMATCH')
        expect(res.field).toBe(field)
        expect(typeof res.error).toBe('string')
        expect(res.success).toBeUndefined()
    }

    it('6. iki token da LCX hissesi degil: LCX_QUOTE_MISMATCH field stock, fetch yok', async () => {
        await boot()

        const res = await bg.call(buyMsg({ outTokenAddress: WETH }))

        mismatch(res, 'stock')
        noLcxNoLegacy()
    })

    it('6b. iki token da LCX hissesi: field stock', async () => {
        const other = { ...TSLAC_ROW, address: getAddress('0xb2000000000000000000002D0BA3164cc74f58B7'), symbol: 'AAPLC', underlying: 'AAPL' }
        await boot(A, { rows: storedRows([TSLAC_ROW, other]) })

        const res = await bg.call(buyMsg({ inTokenAddress: other.address }))

        mismatch(res, 'stock')
        noLcxNoLegacy()
    })

    it('6c. diger taraf odeme tokeni degil (WETH -> TSLAC; baska agin USDC si): field payToken, fetch yok', async () => {
        await boot()

        mismatch(await bg.call(buyMsg({ inTokenAddress: WETH })), 'payToken')
        mismatch(await bg.call(buyMsg({ inTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' })), 'payToken') // Ethereum USDC
        mismatch(await bg.call(sellMsg({ outTokenAddress: WETH })), 'payToken')
        noLcxNoLegacy()
    })

    it('6d. side konumla celisiyor (cikti hisse iken side sell; girdi hisse iken side buy): field side, fetch yok', async () => {
        await boot()

        mismatch(await bg.call(buyMsg({ side: 'sell' })), 'side')
        mismatch(await bg.call(sellMsg({ side: 'buy' })), 'side')
        // Gecersiz / dize olmayan side de "mesajda var ama esit degil": reddedilir.
        for (const bad of ['BUY', 'hold', '', null, 1, {}]) mismatch(await bg.call(buyMsg({ side: bad })), 'side')
        noLcxNoLegacy()
    })

    it('6e. side yoksa konumdan turetilir: alim ve satis, kayitta turetilen side', async () => {
        await boot()

        const buyRes = await bg.call((() => { const m = buyMsg(); delete m.message.side; return m })())
        expect(buyRes.success).toBe(true)
        expect((await recall(buyRes.data.lcxQuote.quoteId)).side).toBe('buy')
        expect(issuerGateMock).toHaveBeenCalledTimes(1) // turetilen side alim: kapi sorulur

        issuerGateMock.mockClear()
        quoteMock.mockImplementation(async () => clone(rwaSell.data))
        const sellRes = await bg.call((() => { const m = sellMsg(); delete m.message.side; return m })())
        expect(sellRes.success).toBe(true)
        expect((await recall(sellRes.data.lcxQuote.quoteId)).side).toBe('sell')
        expect(issuerGateMock).not.toHaveBeenCalled()
    })

    it('6f. tutar gecersiz / sifir / sayi degil: field amount, fetch yok', async () => {
        await boot()

        for (const amount of ['0', '0.0', '', 'abc', undefined, null, '-1', '1e400x']) {
            mismatch(await bg.call(buyMsg({ amount })), 'amount')
        }
        noLcxNoLegacy()
    })

    it('6g. hisse adresi kucuk harfle gelse de ayni hisse; LCX e giden adres checksum', async () => {
        await boot()

        const res = await bg.call(buyMsg({ outTokenAddress: TSLAC.toLowerCase(), inTokenAddress: USDC.toLowerCase() }))

        expect(res.success).toBe(true)
        expect(quoteMock.mock.calls[0][0]).toMatchObject({ tokenIn: USDC, tokenOut: TSLAC })
    })

    it('6h. satirlar hic yokken (depo bos) rwa istegi: field stock, LCX e istek yok', async () => {
        await boot(A, { rows: null })

        const res = await bg.call(buyMsg())

        mismatch(res, 'stock')
        noLcxNoLegacy()
    })
})

describe('SWAP_QUOTE RWA: red ve ulasilamazlik (yedek yok)', () => {
    it('8. LcxRefusalError below_tolerance: LCX_REFUSED + lcxCode + lcxDetails; bugunku yol CAGRILMAZ', async () => {
        quoteMock.mockRejectedValue(new LcxRefusalError('below_tolerance', { refDeviationBps: -130 }))
        await boot()

        const res = await bg.call(buyMsg())

        expect(res.code).toBe('LCX_REFUSED')
        expect(res.lcxCode).toBe('below_tolerance')
        expect(res.lcxDetails).toEqual({ refDeviationBps: -130 })
        expect(typeof res.error).toBe('string')
        expect(res.success).toBeUndefined()
        expect(expectedMock).not.toHaveBeenCalled()
        expect(decimalsMock).not.toHaveBeenCalled()
    })

    it('8b. no_route ve use_rwa dahil HER red LCX_REFUSED (genel takastaki no_route yedegi RWA da YOK)', async () => {
        await boot()
        for (const code of ['no_route', 'use_rwa', 'off_reference', 'unreferenced', 'market_closed']) {
            quoteMock.mockReset()
            quoteMock.mockRejectedValue(new LcxRefusalError(code))
            const res = await bg.call(buyMsg())
            expect(res.code, code).toBe('LCX_REFUSED')
            expect(res.lcxCode, code).toBe(code)
        }
        expect(expectedMock).not.toHaveBeenCalled()
    })

    it('8c. LcxUnavailableError (timeout, quota_exceeded, bad_quote): LCX_UNAVAILABLE; bugunku yol CAGRILMAZ; yalniz sabit etiket loglanir', async () => {
        await boot()
        for (const reason of ['timeout', 'quota_exceeded', 'upstream_5xx']) {
            quoteMock.mockReset()
            quoteMock.mockRejectedValue(new LcxUnavailableError(reason))
            console.warn.mockClear()

            const res = await bg.call(buyMsg())

            expect(res.code, reason).toBe('LCX_UNAVAILABLE')
            expect(typeof res.error).toBe('string')
            expect(res.success).toBeUndefined()
            expect(console.warn).toHaveBeenCalledWith('lcx rwa quote unavailable', reason, '')
        }
        expect(expectedMock).not.toHaveBeenCalled()
    })

    it('8d. bozuk teklif (tutar uyusmuyor) ve beklenmeyen hata: LCX_UNAVAILABLE, yedek yok, adres / tutar loglanmaz', async () => {
        await boot()

        const wrong = clone(rwaBuy.data)
        wrong.quote.input.amount = '2000001'
        quoteMock.mockImplementation(async () => wrong)
        const bad = await bg.call(buyMsg())
        expect(bad.code).toBe('LCX_UNAVAILABLE')
        expect(console.warn).toHaveBeenCalledWith('lcx rwa quote unavailable', 'bad_quote', 'input.amount')

        quoteMock.mockReset()
        quoteMock.mockRejectedValue(new Error(`boom ${USDC} 2000000`))
        const boom = await bg.call(buyMsg())
        expect(boom.code).toBe('LCX_UNAVAILABLE')

        expect(expectedMock).not.toHaveBeenCalled()
        const logged = JSON.stringify(console.warn.mock.calls) + JSON.stringify(console.error.mock.calls)
        expect(logged).not.toContain(USDC)
        expect(logged).not.toContain('2000000')
    })

    it('8e. ret ve ulasilamazlikta quoteId kaydi tutulmaz', async () => {
        await boot()
        quoteMock.mockRejectedValue(new LcxRefusalError('below_tolerance'))
        await bg.call(buyMsg())
        quoteMock.mockRejectedValue(new LcxUnavailableError('timeout'))
        await bg.call(buyMsg())

        expect(await recall(rwaBuy.data.quote.quoteId)).toBeNull()
    })
})

describe('SWAP_QUOTE: genel takasta LCX hissesi', () => {
    it('9. lcxKind yok, USDC -> TSLAC (katalog dolu): LCX_REFUSED use_rwa; ne LCX ne bugunku yol cagrilir', async () => {
        await boot()

        const res = await bg.call(generalMsg())

        expect(res.code).toBe('LCX_REFUSED')
        expect(res.lcxCode).toBe('use_rwa')
        expect(typeof res.error).toBe('string')
        expect(res.success).toBeUndefined()
        noLcxNoLegacy()
        expect(issuerGateMock).not.toHaveBeenCalled()
    })

    it('9b. satis yonu (TSLAC -> USDC) ve native cift da use_rwa', async () => {
        await boot()

        const sell = await bg.call(generalMsg({ inTokenAddress: TSLAC, outTokenAddress: USDC, amount: '0.005' }))
        const native = await bg.call(generalMsg({ inTokenAddress: '0x0', amount: '0.0006' }))

        for (const res of [sell, native]) {
            expect(res.code).toBe('LCX_REFUSED')
            expect(res.lcxCode).toBe('use_rwa')
        }
        noLcxNoLegacy()
    })

    it('9c. hisse olmayan genel takas Part 1 yolunda KALIR (rows yuklu iken bile): LCX e kind swap ile gider', async () => {
        quoteMock.mockImplementation(async () => { throw new LcxUnavailableError('timeout') })
        await boot()

        const res = await bg.call(generalMsg({ inTokenAddress: NATIVE, outTokenAddress: USDC, amount: '0.001' }))

        expect(res).toEqual({ success: true, data: LEGACY })
        expect(quoteMock.mock.calls[0][0].kind).toBe('swap')
    })
})

describe('SWAP_QUOTE RWA: satirlar bellekte yok, depoda var (servis isci yeni)', () => {
    it('10. teklif oncesi satirlar depodan yuklenir (hydrateLcxStockRows), ag istegi yok; bellek doluyken depo yine okunur (yalniz daha yeni kayit uygulanir)', async () => {
        await boot()
        bg.chrome.storage.local.get.mockClear()
        expect(rowReads()).toHaveLength(0) // acilista degil, ihtiyac aninda

        const res = await bg.call(buyMsg())

        expect(res.success).toBe(true) // satirlar yuklendi: hisse taninip teklif kuruldu
        expect(rowReads()).toHaveLength(1)
        const get = bg.chrome.storage.local.get.mock
        const readAt = get.invocationCallOrder[get.calls.findIndex((c) => c[0] === LCX_STOCK_ROWS_KEY)]
        expect(readAt).toBeLessThan(quoteMock.mock.invocationCallOrder[0]) // yukleme LCX teklifinden ONCE
        expect(stocksMock).not.toHaveBeenCalled() // /lcx/stocks a ag istegi yok
        expect(rowWrites()).toHaveLength(0)

        await bg.call(buyMsg({ amount: '3' }))
        expect(rowReads()).toHaveLength(2) // ucuz depo okumasi: servis isci acikken gelen DAHA YENI kayit gorulsun (test 12)
        expect(stocksMock).not.toHaveBeenCalled()
        expect(rowWrites()).toHaveLength(0)
    })

    it('10b. genel takasta da (lcxKind yok) satirlar once yuklenir: yoksa hisse bugunku motora dusebilirdi', async () => {
        await boot()
        bg.chrome.storage.local.get.mockClear()

        const res = await bg.call(generalMsg())

        expect(rowReads()).toHaveLength(1)
        expect(res.lcxCode).toBe('use_rwa')
        expect(expectedMock).not.toHaveBeenCalled()
    })

    it('10c. depo bozuk: yukleme sessizce hicbir sey kurmaz (hisse taninmaz: field stock), ag istegi yine yok', async () => {
        await boot(A, { rows: { fetchedAt: 'dun', rows: 'x', usEquitiesOpen: 1 } })

        const res = await bg.call(buyMsg())

        expect(res.code).toBe('LCX_QUOTE_MISMATCH')
        expect(res.field).toBe('stock')
        expect(stocksMock).not.toHaveBeenCalled()
    })
})

// Servis isci acik kaldikca bellekteki liste eskir: popup depoyu 60 sn'de bir tazeler ve yeni listelenen hisse depoya yazilir. Isleyiciler
// depodaki DAHA YENI kaydi uygular (yoksa yeni hisse LCX_QUOTE_MISMATCH(stock) alirdi); daha ESKI kayit bellek satirlarini ezmez.
describe('SWAP_QUOTE RWA: servis isci acikken depodaki daha yeni liste (test 12)', () => {
    const NVDAC = getAddress('0x' + '7c'.repeat(20))
    const NVDAC_ROW = { ...TSLAC_ROW, address: NVDAC, symbol: 'NVDAC', name: 'NVIDIA (Coinbase Tokenized Stocks)', underlying: 'NVDA' }
    // Fikstur teklifi NVDAC icin: TSLAC adresi (buyuk / kucuk harf) NVDAC ile degisir.
    const nvdaQuote = () => JSON.parse(JSON.stringify(rwaBuy.data).replace(/0xb2000000000000000000001e800a7f5189430cD0/gi, NVDAC))
    const record = (rows, ageMs) => ({ fetchedAt: Date.now() - ageMs, asOf: Date.now() - ageMs, usEquitiesOpen: false, rows })

    it('12. TSLAC yuklu; depoya yeni hisse (NVDAC) iceren DAHA YENI kayit yazilir -> sonraki teklif yeni hisseyi gorur (LCX_QUOTE_MISMATCH degil)', async () => {
        await boot(A, { rows: record([TSLAC_ROW], 30_000) })
        expect((await bg.call(buyMsg())).success).toBe(true) // satirlar bellekte

        bg.localStore[LCX_STOCK_ROWS_KEY] = record([TSLAC_ROW, NVDAC_ROW], 1_000)
        quoteMock.mockImplementation(async () => nvdaQuote())
        const res = await bg.call(buyMsg({ outTokenAddress: NVDAC }))

        expect(res.success, JSON.stringify(res)).toBe(true)
        expect(quoteMock).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'rwa', tokenOut: NVDAC }))
        expect(stocksMock).not.toHaveBeenCalled() // yalniz depo okundu, ag yok
    })

    it('12b. kontrol: depo guncellenmedikce yeni hisse tanimlanmaz (field stock); once guncel olan hisse etkilenmez', async () => {
        await boot(A, { rows: record([TSLAC_ROW], 30_000) })

        const unknown = await bg.call(buyMsg({ outTokenAddress: NVDAC }))

        expect(unknown.code).toBe('LCX_QUOTE_MISMATCH')
        expect(unknown.field).toBe('stock')
        expect((await bg.call(buyMsg())).success).toBe(true)
    })

    it('12c. depoya DAHA ESKI bir kayit gelirse bellekteki yeni satirlar KORUNUR (eski kayit ezmez)', async () => {
        await boot(A, { rows: record([TSLAC_ROW, NVDAC_ROW], 1_000) })
        quoteMock.mockImplementation(async () => nvdaQuote())
        expect((await bg.call(buyMsg({ outTokenAddress: NVDAC }))).success).toBe(true)

        bg.localStore[LCX_STOCK_ROWS_KEY] = record([TSLAC_ROW], 600_000)
        const res = await bg.call(buyMsg({ outTokenAddress: NVDAC }))

        expect(res.success, JSON.stringify(res)).toBe(true)
    })

    it('12d. bayrak kapali: depo hic okunmaz (daha yeni kayit aramasi da yok)', async () => {
        flag.on = false
        await boot(A, { rows: record([TSLAC_ROW], 30_000) })

        await bg.call(buyMsg())
        await bg.call(generalMsg())

        expect(rowReads()).toHaveLength(0)
    })
})

describe('Acilis: LCX hisse satirlarinin yuklenmesi ve tazelenmesi', () => {
    // Dinleyicilerin hepsi cagrilir (acilis zinciri + LCX dinleyicisi); LCX dinleyicisi kendi hatasini yutar.
    const fire = async (event) => {
        await Promise.allSettled(bg.listeners[event].map((fn) => fn({ reason: 'update' })))
        await settle()
    }
    const aged = (ms) => ({ ...storedRows(), fetchedAt: Date.now() - ms })
    // Yas, acilis (agir modul yukleme) BITTIKTEN SONRA damgalanir: boot() suresi tazelik sinirini (1 dk pay) asamaz.
    const ageAfterBoot = (ms) => { bg.localStore[LCX_STOCK_ROWS_KEY] = aged(ms) }

    it('11. bayrak acik, gizli degil: once depodan yuklenir, sonra refreshLcxStockRows({ maxAgeMs: 3600000 }) ag istegi atar; satirlar ag cevabiyla degisir', async () => {
        // Eski depo (2 saat). Tazeleme sirasinda bellekte DEPODAKI satirlar olmali (yukleme tazelemeden ONCE).
        const old = aged(7_200_000)
        let rowsAtFetch = null
        stocksMock.mockImplementation(async () => {
            rowsAtFetch = (await import('./utils/tokenizedStocks')).lcxStockRows().length
            return { usEquitiesOpen: true, asOf: NOW, rows: [TSLAC_ROW] }
        })
        await boot(A, { rows: old })

        await fire('onStartup')

        expect(stocksMock).toHaveBeenCalledTimes(1)
        expect(rowsAtFetch).toBe(1) // hydrate -> refresh sirasi
        expect(rowWrites()).toHaveLength(1) // taze liste depoya yazildi
        expect(bg.localStore[LCX_STOCK_ROWS_KEY].usEquitiesOpen).toBe(true)
        expect(bg.localStore[LCX_STOCK_ROWS_KEY].fetchedAt).toBeGreaterThan(old.fetchedAt)
    })

    it('11b. maxAgeMs 3600000 siniri: 59 dk yasindaki depo taze (ag yok), 61 dk yasindaki bayat (ag istegi)', async () => {
        await boot(A, { rows: null })
        ageAfterBoot(3_590_000)
        await fire('onStartup')
        expect(stocksMock).not.toHaveBeenCalled()
        expect(rowWrites()).toHaveLength(0)
        teardownBackground()

        await boot(A, { rows: null })
        ageAfterBoot(3_610_000)
        await fire('onStartup')
        expect(stocksMock).toHaveBeenCalledTimes(1)
        expect(rowWrites()).toHaveLength(1)
    })

    it('11c. depo bos (ilk acilis): ag istegi atilir ve satirlar depoya yazilir', async () => {
        await boot(A, { rows: null })

        await fire('onStartup')

        expect(stocksMock).toHaveBeenCalledTimes(1)
        expect(bg.localStore[LCX_STOCK_ROWS_KEY].rows).toHaveLength(1)
    })

    it('11d. onInstalled de ayni yolu izler', async () => {
        await boot(A, { rows: null })

        await fire('onInstalled')

        expect(stocksMock).toHaveBeenCalledTimes(1)
        expect(rowWrites()).toHaveLength(1)
    })

    it('11e. activeIsPrivate() true: tazeleme CAGRILMAZ, /lcx/stocks a istek ve depo yazimi yok (depodan okuma serbest)', async () => {
        await boot(GIZLI, { privacyFlag: 'false', rows: aged(7_200_000) })
        expect(bg.localStore.active_account.key).toBe(GIZLI.key)

        await fire('onStartup')
        await fire('onInstalled')

        expect(stocksMock).not.toHaveBeenCalled()
        expect(quoteMock).not.toHaveBeenCalled()
        expect(rowWrites()).toHaveLength(0)
    })

    it('11f. bayrak kapali: ne yukleme ne tazeleme (depoya dokunulmaz)', async () => {
        flag.on = false
        await boot(A, { rows: aged(7_200_000) })

        await fire('onStartup')
        await fire('onInstalled')

        expect(rowReads()).toHaveLength(0)
        expect(stocksMock).not.toHaveBeenCalled()
        expect(rowWrites()).toHaveLength(0)
    })

    it('11g. /lcx/stocks a ulasilamaz: dinleyici firlatmaz, eldeki (depodaki) satirlar korunur ve teklif yine calisir', async () => {
        stocksMock.mockRejectedValue(new LcxUnavailableError('timeout'))
        await boot(A, { rows: aged(7_200_000) })

        await fire('onStartup')

        expect(stocksMock).toHaveBeenCalledTimes(1)
        expect(rowWrites()).toHaveLength(0) // basarisiz tazeleme eski kaydi silmez
        const res = await bg.call(buyMsg())
        expect(res.success).toBe(true) // satirlar acilista depodan yuklenmisti
    })
})

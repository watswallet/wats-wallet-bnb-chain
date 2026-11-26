import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { HDNodeWallet, getAddress } from 'ethers'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { createVault, deriveMasterKey, randBytes } from './utils/crypto-utils'
import { derivePrivateAccount } from './utils/privacy/privateAccount'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'
import { LcxUnavailableError, LcxRefusalError } from './utils/lcx/client'
import { toLcxToken } from './utils/lcx/select'
import { BSTOCKS } from './data/bStocks'
import { XSTOCKS } from './data/xStocks'
import { RETIRED_BSTOCKS } from './data/bStocksRetired'
import { RETIRED_XSTOCKS } from './data/xStocksRetired'
import { stockEntry, isGeneralSwapExcluded, isGeneralSwapOutputExcluded } from './utils/tokenizedStocks'
import ethUsdc from './utils/lcx/fixtures/quote-base-eth-usdc.json'
import stableQuote from './utils/lcx/fixtures/stable-quote-base-usdc-usdt.json'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// SWAP_QUOTE LCX DALI (Bolum 1, Gorev 6). Ag yoktur: LCX istemcisi (fetchLcxQuote, fetchLcxStablecoins) ve takas motoru
// taklit edilir; yol secimi (select.js), teklif eslemesi (mapQuote.js) ve arka plan akisi GERCEKTIR. Hata siniflari
// GERCEK sinifladir (arka plan `instanceof` ile ayirir): modul her boot'ta vi.resetModules ile yeniden yuklendigi icin
// gercek istemci bir kez alinip saklanir, yoksa testin ve arka planin sinif kimlikleri ayrilirdi.
const flag = vi.hoisted(() => ({ on: true }))
const keep = vi.hoisted(() => ({ client: null, select: null }))

const quoteMock = vi.fn()     // utils/lcx/client fetchLcxQuote
const stablesMock = vi.fn()   // utils/lcx/client fetchLcxStablecoins
const expectedMock = vi.fn()  // bugunku (yedek) yol: MultiChainSwapManager#getExpectedOutput
const decimalsMock = vi.fn()  // MultiChainSwapManager#getTokenDecimals
const eligibleSpy = vi.fn()   // utils/lcx/select lcxEligible (gercek mantik, yalniz cagri izlenir)
const gateMock = vi.fn()      // ilk alim kapisi: hisse CIKTILI teklif once kapidan gecer (stockGate/gate evaluate)

vi.mock('./utils/lcx/client', async (importOriginal) => {
    keep.client ??= await importOriginal()
    return {
        ...keep.client,
        fetchLcxQuote: (...a) => quoteMock(...a),
        fetchLcxStablecoins: (...a) => stablesMock(...a),
    }
})
vi.mock('./utils/lcx/select', async (importOriginal) => {
    keep.select ??= await importOriginal()
    return { ...keep.select, lcxEligible: (...a) => (eligibleSpy(...a), keep.select.lcxEligible(...a)) }
})
// Katalog hissesi alimi (swapQuote basindaki ilk alim kapisi) agdan okunan kural tablosuna baglidir; bu dosya LCX dalini
// olcer, kapiyi degil: kapi taklit edilir (karar her zaman ok) ve CAGRILDIGI da sayilir (dal kapidan SONRA gelir).
vi.mock('./utils/stockGate/gate', async (importOriginal) => ({
    ...(await importOriginal()),
    createStockGate: () => ({
        evaluate: (...a) => gateMock(...a),
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

let bg
async function boot(signer = A, { privacyFlag } = {}) {
    // privacyFlag 'false' iken arka plan acilista depoda kalan Gizli Hesap'i genel hesaba GERI ALIR; bu yuzden genel
    // hesapla acilir, acilis oturduktan SONRA imzaci depoya yazilir (bkz. background.swapQuotePrivacy.test.js).
    const acilis = privacyFlag === 'false' ? A : signer
    // LCX bayragi derleme sabitidir (featureFlags.js): her boot'ta modul yeniden yuklenirken vi.stubEnv ile belirlenir
    // (teardown vi.unstubAllEnvs ile temizler). Bayrak dosyasi taklit EDILMEZ: gercek bayrak okunur.
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

const NATIVE = '0x0000000000000000000000000000000000000000'
const USDC = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
const USDT = getAddress('0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2')
const clone = (x) => JSON.parse(JSON.stringify(x))
const STABLES = () => new Map([[8453, new Set([USDC.toLowerCase(), USDT.toLowerCase()])]])
const LEGACY = { expectedOutput: '7', estimatedGasFee: { totalCost: '0.001', totalCostUSD: null } }

const msg = (over = {}) => ({
    type: 'SWAP_QUOTE',
    message: { chainId: 8453, inTokenAddress: '0x0', outTokenAddress: USDC, amount: '0.001', slippage: 0.5, ...over },
})
// 2 USDC -> USDT (stable).
const stableMsg = (over = {}) => msg({ inTokenAddress: USDC, outTokenAddress: USDT, amount: '2', ...over })

beforeEach(() => {
    for (const m of [quoteMock, stablesMock, expectedMock, decimalsMock, eligibleSpy, gateMock]) m.mockReset()
    flag.on = true
    gateMock.mockResolvedValue({ ok: true })
    expectedMock.mockResolvedValue(LEGACY)
    stablesMock.mockImplementation(async () => STABLES())
    // Zincir okumasi yok: bilinen ondalikli token tablosu.
    decimalsMock.mockImplementation(async (address) => {
        const a = String(address).toLowerCase()
        return a === USDC.toLowerCase() || a === USDT.toLowerCase() ? 6 : 18
    })
    quoteMock.mockImplementation(async () => clone(ethUsdc.data))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
    teardownBackground()
    vi.restoreAllMocks()
})

describe('SWAP_QUOTE: LCX yolu secimi', () => {
    it('1. bayrak kapali: fetchLcxQuote cagrilmaz, bugunku yol cagrilir', async () => {
        flag.on = false
        await boot()

        const res = await bg.call(msg())

        expect(res).toEqual({ success: true, data: LEGACY })
        expect(quoteMock).not.toHaveBeenCalled()
        expect(stablesMock).not.toHaveBeenCalled()
        expect(expectedMock).toHaveBeenCalledTimes(1)
    })

    it('2. bayrak acik, Base, ETH -> USDC, kayma 0.5: LCX teklifi istenir; yanit lcx, bugunku yol cagrilmaz', async () => {
        await boot()

        const res = await bg.call(msg())

        expect(quoteMock).toHaveBeenCalledTimes(1)
        expect(quoteMock).toHaveBeenCalledWith({
            kind: 'swap', chainId: 8453, tokenIn: NATIVE, tokenOut: USDC, amountIn: '1000000000000000', slippageBps: 50,
        })
        expect(res.success).toBe(true)
        expect(res.data.routerType.name).toBe('lcx')
        expect(res.data.lcxQuote.quoteId).toBeTruthy()
        expect(res.data.lcxQuote.amountIn).toBe('1000000000000000')
        expect(res.data.expectedOutput).toBe('1.803908')
        expect(expectedMock).not.toHaveBeenCalled()
    })

    it('3. iki taraf da stablecoin kumesinde (USDC, USDT): kind stable', async () => {
        quoteMock.mockImplementation(async () => clone(stableQuote.data))
        await boot()

        const res = await bg.call(stableMsg())

        expect(quoteMock).toHaveBeenCalledWith({
            kind: 'stable', chainId: 8453, tokenIn: USDC, tokenOut: USDT, amountIn: '2000000', slippageBps: 50,
        })
        expect(res.success).toBe(true)
        expect(res.data.routerType.name).toBe('lcx')
        expect(res.data.lcxQuote.kind).toBe('stable')
        expect(expectedMock).not.toHaveBeenCalled()
    })

    it('3b. kume bos (stablecoin ucu cevap vermedi): ayni cift genel takas (swap) olarak istenir', async () => {
        stablesMock.mockImplementation(async () => new Map())
        quoteMock.mockImplementation(async () => clone(stableQuote.data))
        await boot()

        const res = await bg.call(stableMsg())

        expect(quoteMock.mock.calls[0][0].kind).toBe('swap')
        // stable fixture'i kind'dan bagimsiz eslenir; amac yalniz kind secimidir.
        expect(res.success).toBe(true)
    })

    it('4. LcxUnavailableError (quota_exceeded, timeout): bugunku yol, yanit onun verisi, kullaniciya hata yok', async () => {
        await boot()
        for (const reason of ['quota_exceeded', 'timeout']) {
            expectedMock.mockClear()
            quoteMock.mockReset()
            quoteMock.mockRejectedValue(new LcxUnavailableError(reason))

            const res = await bg.call(msg())

            expect(res).toEqual({ success: true, data: LEGACY })
            expect(res.error).toBeUndefined()
            expect(expectedMock).toHaveBeenCalledTimes(1)
            expect(expectedMock.mock.calls[0]).toEqual(['0x0', USDC, '0.001', 0.5, { skipPrice: false }])
            // R21: ulasilamazlikta yalniz sebep (ve alan) yazilir; adres / tutar yok.
            expect(console.warn).toHaveBeenCalledTimes(1)
            expect(console.warn).toHaveBeenLastCalledWith('lcx quote fallback', reason, '')
            console.warn.mockClear()
        }
    })

    it('4b. bozuk ya da istekle uyusmayan LCX yaniti (bad_quote): bugunku yol', async () => {
        const wrong = clone(ethUsdc.data)
        wrong.quote.input.amount = '1000000000000001' // gonderilen tutardan farkli
        quoteMock.mockImplementation(async () => wrong)
        await boot()

        const res = await bg.call(msg())

        expect(res).toEqual({ success: true, data: LEGACY })
        expect(expectedMock).toHaveBeenCalledTimes(1)
        // R21: sebep ve hangi alan uyusmadi; yalniz sabit etiketler.
        expect(console.warn).toHaveBeenCalledTimes(1)
        expect(console.warn).toHaveBeenCalledWith('lcx quote fallback', 'bad_quote', 'input.amount')
        const logged = JSON.stringify(console.warn.mock.calls)
        expect(logged).not.toContain(USDC)
        expect(logged).not.toContain('1000000000000')
    })

    it('4b-2. C1/I1: gevsek alt sinir (minimumAmount 1) ya da kullanicininkinden GENIS LCX kaymasi: bad_quote -> bugunku yol', async () => {
        await boot()
        const cases = [
            ['minOut', (d) => (d.quote.output.minimumAmount = '1')],
            // Kullanici 0.5% (50 bps) istedi; LCX 51 uyguladigini soyluyor.
            ['slippageBps', (d) => (d.quote.slippageBps = 51)],
        ]
        for (const [field, mutate] of cases) {
            expectedMock.mockClear()
            console.warn.mockClear()
            quoteMock.mockImplementation(async () => {
                const d = clone(ethUsdc.data)
                mutate(d)
                return d
            })

            const res = await bg.call(msg())

            expect(res, field).toEqual({ success: true, data: LEGACY })
            expect(expectedMock).toHaveBeenCalledTimes(1)
            expect(console.warn).toHaveBeenCalledWith('lcx quote fallback', 'bad_quote', field)
        }
    })

    it('4b-3. I1: stable teklifte LCX in kaymasi (30) kullanicininkinden (50) SIKI: teklif gosterilir, lcxQuote LCX in 30 unu tasir', async () => {
        quoteMock.mockImplementation(async () => clone(stableQuote.data))
        await boot()

        const res = await bg.call(stableMsg())

        expect(quoteMock.mock.calls[0][0].slippageBps).toBe(50)
        expect(res.success).toBe(true)
        expect(res.data.lcxQuote).toMatchObject({ kind: 'stable', slippageBps: 30, amountOut: '2002348', minOut: '1996340' })
        expect(expectedMock).not.toHaveBeenCalled()
    })

    it('4c. beklenmeyen hata: bugunku yol; yalniz hata ADI yazilir (adres / tutar yok)', async () => {
        quoteMock.mockRejectedValue(new Error(`boom ${USDC} 1000000000000000`))
        await boot()

        const res = await bg.call(msg())

        expect(res).toEqual({ success: true, data: LEGACY })
        expect(expectedMock).toHaveBeenCalledTimes(1)
        expect(console.warn).toHaveBeenCalledWith('lcx quote fallback', 'Error')
        const logged = JSON.stringify(console.warn.mock.calls) + JSON.stringify(console.error.mock.calls)
        expect(logged).not.toContain(USDC)
        expect(logged).not.toContain('1000000000000000')
    })

    it('4d. token ondaligi okunamadi: LCX a sorulmaz, bugunku yol', async () => {
        decimalsMock.mockRejectedValue(new Error('rpc down'))
        await boot()

        const res = await bg.call(msg())

        expect(res).toEqual({ success: true, data: LEGACY })
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('4e. getTokenDecimals 6 ondalikli token icin 18 dondurdu (sessiz yedek): LCX ondaligi uyusmaz -> bugunku yol, LCX_REFUSED yok', async () => {
        // Cikis tokeni USDC (fikstur output.decimals 6) ama ondalik okumasi 18'e dustu.
        decimalsMock.mockImplementation(async () => 18)
        await boot()

        const res = await bg.call(msg())

        expect(quoteMock).toHaveBeenCalledTimes(1)
        expect(res).toEqual({ success: true, data: LEGACY })
        expect(res.code).toBeUndefined()
        expect(expectedMock).toHaveBeenCalledTimes(1)
    })

    it('4f. 6 ondalikli GIRDI tokeni icin 18 okundu: amountIn 10^12 kat buyur ve sunucu onu aynen yansitsa da (input.amount eslesir) imzalanacak teklif kurulmaz', async () => {
        decimalsMock.mockImplementation(async () => 18)
        // Sunucu istegi sadik yansitir: input.amount = gonderilen ham tutar; input.decimals = 6 (USDC'nin gercek ondaligi).
        quoteMock.mockImplementation(async (sent) => {
            const d = clone(stableQuote.data)
            d.quote.input.amount = sent.amountIn
            return d
        })
        await boot()

        const res = await bg.call(stableMsg())

        expect(quoteMock).toHaveBeenCalledTimes(1)
        expect(quoteMock.mock.calls[0][0].amountIn).toBe('2000000000000000000') // yanlis (2 USDC = 2000000)
        expect(res).toEqual({ success: true, data: LEGACY })
        expect(res.code).toBeUndefined()
        expect(expectedMock).toHaveBeenCalledTimes(1)
    })

    it('5. LcxRefusalError off_peg (stable): LCX_REFUSED, bugunku yol CAGRILMAZ', async () => {
        quoteMock.mockRejectedValue(new LcxRefusalError('off_peg', { pair: 'USDC/USDT' }))
        await boot()

        const res = await bg.call(stableMsg())

        expect(res.code).toBe('LCX_REFUSED')
        expect(res.lcxCode).toBe('off_peg')
        expect(res.lcxDetails).toEqual({ pair: 'USDC/USDT' })
        expect(typeof res.error).toBe('string')
        expect(res.success).toBeUndefined()
        expect(expectedMock).not.toHaveBeenCalled()
    })

    it('6. LcxRefusalError use_rwa: LCX_REFUSED, bugunku yol CAGRILMAZ', async () => {
        quoteMock.mockRejectedValue(new LcxRefusalError('use_rwa'))
        await boot()

        const res = await bg.call(msg())

        expect(res.code).toBe('LCX_REFUSED')
        expect(res.lcxCode).toBe('use_rwa')
        expect(expectedMock).not.toHaveBeenCalled()
    })

    it('7. no_route: genel takasta (swap) bugunku yol; stable teklifte LCX_REFUSED', async () => {
        quoteMock.mockRejectedValue(new LcxRefusalError('no_route'))
        await boot()

        const swapRes = await bg.call(msg())
        expect(quoteMock.mock.calls[0][0].kind).toBe('swap')
        expect(swapRes).toEqual({ success: true, data: LEGACY })
        expect(expectedMock).toHaveBeenCalledTimes(1)

        expectedMock.mockClear()
        quoteMock.mockClear()
        const stableRes = await bg.call(stableMsg())
        expect(quoteMock.mock.calls[0][0].kind).toBe('stable')
        expect(stableRes.code).toBe('LCX_REFUSED')
        expect(stableRes.lcxCode).toBe('no_route')
        expect(expectedMock).not.toHaveBeenCalled()
    })

    it('8. Gizli Hesap imzacisi: fetchLcxQuote ve fetchLcxStablecoins HIC cagrilmaz', async () => {
        await boot(GIZLI, { privacyFlag: 'false' })
        expect(bg.localStore.active_account.key).toBe(GIZLI.key)

        const res = await bg.call(msg())

        // Istek boyunca Gizli Hesap aktifti (acilis geri almasi imzaciyi cevirmedi).
        expect(bg.localStore.active_account.key).toBe(GIZLI.key)
        expect(res).toEqual({ success: true, data: LEGACY })
        expect(quoteMock).not.toHaveBeenCalled()
        expect(stablesMock).not.toHaveBeenCalled()
        expect(expectedMock.mock.calls[0][4]).toEqual({ skipPrice: true })
    })

    it('9. Celo (42220): fetchLcxQuote cagrilmaz', async () => {
        await boot()

        const res = await bg.call(msg({ chainId: 42220 }))

        expect(res).toEqual({ success: true, data: LEGACY })
        expect(quoteMock).not.toHaveBeenCalled()
        expect(stablesMock).not.toHaveBeenCalled()
    })

    it('9b. kayma 50 (yuzde 50 -> 5000 bps, aralik disi): fetchLcxQuote cagrilmaz, bugunku yol calisir', async () => {
        await boot()

        const res = await bg.call(msg({ slippage: 50 }))

        expect(res).toEqual({ success: true, data: LEGACY })
        expect(quoteMock).not.toHaveBeenCalled()
        expect(expectedMock).toHaveBeenCalledTimes(1)
    })

    it('9c. sifir tutar: LCX\'e sorulmaz (LCX reddederdi), bugunku yol davranisi degismez', async () => {
        await boot()

        const res = await bg.call(msg({ amount: '0' }))

        expect(res).toEqual({ success: true, data: LEGACY })
        expect(quoteMock).not.toHaveBeenCalled()
        expect(expectedMock).toHaveBeenCalledTimes(1)
    })
})

// R19 (spec 5): katalog hisseleri (bStocks + xStocks) bugunku yolda (Pancake motoru / Hisseler sekmesi) kalir. Sunucunun use_rwa
// korumasi tum RWA kayitlarina bakar; BSC LCX agidir, yani onleyici dal olmasa hisse teklifi LCX_REFUSED(use_rwa) ile bitip
// yedege dusmezdi. Dal lcxEligible'dan sonra, HICBIR istekten once gelir.
describe('SWAP_QUOTE: katalog hissesi LCX a gitmez (R19)', () => {
    const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955'
    const BSTOCK = BSTOCKS[0].address
    const XSTOCK_ETH = XSTOCKS.find((t) => t.chains.includes(1)).address
    const ETH_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const noLcx = () => {
        expect(quoteMock).not.toHaveBeenCalled()
        expect(stablesMock).not.toHaveBeenCalled()
    }

    it('BSC bStocks ALIM (USDT -> bStock): ilk alim kapisi sorulur, LCX a HIC istek yok, bugunku yol', async () => {
        await boot()

        const res = await bg.call(msg({ chainId: 56, inTokenAddress: BSC_USDT, outTokenAddress: BSTOCK, amount: '5', slippage: 1 }))

        expect(res).toEqual({ success: true, data: LEGACY })
        expect(gateMock).toHaveBeenCalledTimes(1) // dal kapidan SONRA: kapi bu yolda da calisir
        noLcx()
        expect(expectedMock).toHaveBeenCalledTimes(1)
        expect(expectedMock.mock.calls[0]).toEqual([BSC_USDT, BSTOCK, '5', 1, { skipPrice: false }])
    })

    it('BSC bStocks SATIS (bStock -> USDT): LCX a HIC istek yok, bugunku yol', async () => {
        await boot()

        const res = await bg.call(msg({ chainId: 56, inTokenAddress: BSTOCK, outTokenAddress: BSC_USDT, amount: '1', slippage: 1 }))

        expect(res).toEqual({ success: true, data: LEGACY })
        noLcx()
        expect(expectedMock).toHaveBeenCalledTimes(1)
        expect(expectedMock.mock.calls[0]).toEqual([BSTOCK, BSC_USDT, '1', 1, { skipPrice: false }])
    })

    it('bStocks adresi kucuk harfle gelse de (adres yazimi) hisse sayilir', async () => {
        await boot()

        const res = await bg.call(msg({ chainId: 56, inTokenAddress: BSC_USDT, outTokenAddress: BSTOCK.toLowerCase(), amount: '5', slippage: 1 }))

        expect(res).toEqual({ success: true, data: LEGACY })
        noLcx()
    })

    it('Ethereum xStocks ALIM ve SATIS: LCX a HIC istek yok, bugunku yol', async () => {
        await boot()

        const buy = await bg.call(msg({ chainId: 1, inTokenAddress: ETH_USDC, outTokenAddress: XSTOCK_ETH, amount: '5', slippage: 1 }))
        expect(buy).toEqual({ success: true, data: LEGACY })
        noLcx()
        expect(expectedMock).toHaveBeenCalledTimes(1)

        const sell = await bg.call(msg({ chainId: 1, inTokenAddress: XSTOCK_ETH, outTokenAddress: ETH_USDC, amount: '1', slippage: 1 }))
        expect(sell).toEqual({ success: true, data: LEGACY })
        noLcx()
        expect(expectedMock).toHaveBeenCalledTimes(2)
    })

    // R22: emekli adresler (data/bStocksRetired.js, data/xStocksRetired.js) katalog DEGILDIR (stockEntry gormez) ama ayni sebeple
    // LCX'e gitmez: eldeki artik pozisyonu satmak isteyen kullanici use_rwa reddiyle yedeksiz kalmasin.
    it('R22: emekli bStocks SATIS (BSC) ve ALIM: LCX a HIC istek yok, bugunku yol', async () => {
        const retired = RETIRED_BSTOCKS[0].address
        expect(RETIRED_BSTOCKS[0].chains).toContain(56)
        await boot()

        const sell = await bg.call(msg({ chainId: 56, inTokenAddress: retired, outTokenAddress: BSC_USDT, amount: '1', slippage: 1 }))
        expect(sell).toEqual({ success: true, data: LEGACY })
        noLcx()
        expect(expectedMock).toHaveBeenCalledTimes(1)
        expect(expectedMock.mock.calls[0]).toEqual([retired, BSC_USDT, '1', 1, { skipPrice: false }])

        // Alim (cikti emekli bStock): ilk alim kapisi tanir ve sorulur; LCX yine yok.
        const buy = await bg.call(msg({ chainId: 56, inTokenAddress: BSC_USDT, outTokenAddress: retired.toLowerCase(), amount: '5', slippage: 1 }))
        expect(buy).toEqual({ success: true, data: LEGACY })
        noLcx()
        expect(expectedMock).toHaveBeenCalledTimes(2)
    })

    it('R22: emekli xStocks SATIS (Ethereum): LCX a HIC istek yok, bugunku yol', async () => {
        const retired = RETIRED_XSTOCKS.find((r) => r.chains.includes(1)).address
        await boot()

        const sell = await bg.call(msg({ chainId: 1, inTokenAddress: retired, outTokenAddress: ETH_USDC, amount: '1', slippage: 1 }))

        expect(sell).toEqual({ success: true, data: LEGACY })
        noLcx()
        expect(expectedMock).toHaveBeenCalledTimes(1)
        expect(expectedMock.mock.calls[0]).toEqual([retired, ETH_USDC, '1', 1, { skipPrice: false }])
    })

    // I2: xStocks adresi URUN kapsaminda (`chains`) olmayan ama VAR OLDUGU zincirlerde (Optimism 10, Arbitrum 42161; ikisi de LCX
    // agi) katalog satiri yoktur (stockEntry null). Bugunku motor onlari assertNotXStock ile reddeder (isGeneralSwapExcluded /
    // isGeneralSwapOutputExcluded); LCX dali da bu ciftleri LCX'e GONDERMEZ, bugunku yola birakir (orada main'deki gibi reddedilir).
    const XSTOCK_OFF_CHAIN = XSTOCKS.find((t) => !t.chains.includes(10) && !t.chains.includes(42161)).address
    const L2_USDC = { 10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' }
    for (const chainId of [10, 42161]) {
        it(`I2: xStock (urun kapsami DISI, var oldugu zincir ${chainId}) ALIM ve SATIS: LCX a HIC istek yok, bugunku yol`, async () => {
            // Onkosul: katalog satiri yok (eski dal yakalamazdi) ama genel takas dislamasi var.
            expect(stockEntry(chainId, XSTOCK_OFF_CHAIN)).toBeNull()
            expect(isGeneralSwapExcluded(chainId, XSTOCK_OFF_CHAIN)).toBe(true)
            await boot()

            const buy = await bg.call(msg({ chainId, inTokenAddress: L2_USDC[chainId], outTokenAddress: XSTOCK_OFF_CHAIN, amount: '5', slippage: 1 }))
            expect(buy).toEqual({ success: true, data: LEGACY })
            noLcx()

            const sell = await bg.call(msg({ chainId, inTokenAddress: XSTOCK_OFF_CHAIN.toLowerCase(), outTokenAddress: L2_USDC[chainId], amount: '1', slippage: 1 }))
            expect(sell).toEqual({ success: true, data: LEGACY })
            noLcx()
            expect(expectedMock).toHaveBeenCalledTimes(2)
        })
    }

    it('I2: emekli xStock ALIMI Arbitrum da (urun kapsami disi): LCX a HIC istek yok', async () => {
        const retired = RETIRED_XSTOCKS[0].address
        expect(isGeneralSwapOutputExcluded(42161, retired)).toBe(true)
        await boot()

        const buy = await bg.call(msg({ chainId: 42161, inTokenAddress: L2_USDC[42161], outTokenAddress: retired, amount: '5', slippage: 1 }))

        expect(buy).toEqual({ success: true, data: LEGACY })
        noLcx()
    })

    it('POZITIF BEKCI: hisse olmayan BSC cifti LCX a gider (dal BSC yi topyekun disarida birakmaz)', async () => {
        await boot()

        await bg.call(msg({ chainId: 56, inTokenAddress: '0x0', outTokenAddress: BSC_USDT, amount: '0.01', slippage: 0.5 }))

        // Yanit fiksturu Base'e ait: eslesmez ve yedege duser; burada olculen yalniz LCX'in SORULMUS olmasi.
        expect(quoteMock).toHaveBeenCalledTimes(1)
        expect(quoteMock.mock.calls[0][0]).toMatchObject({ chainId: 56, tokenIn: NATIVE, tokenOut: BSC_USDT, kind: 'swap' })
    })
})

// R20: iki taraftan biri native ise kume hicbir zaman 'stable' dondurmez (lcxKindFor), bu yuzden stablecoin listesi istenmez.
describe('SWAP_QUOTE: native ciftte stablecoin listesi istenmez (R20)', () => {
    it('native -> USDC: fetchLcxStablecoins cagrilmaz; USDC -> native de; USDC -> USDT cagrilir', async () => {
        await boot()

        await bg.call(msg())
        expect(quoteMock).toHaveBeenCalledTimes(1)
        expect(stablesMock).not.toHaveBeenCalled()

        quoteMock.mockClear()
        await bg.call(msg({ inTokenAddress: USDC, outTokenAddress: NATIVE, amount: '2' }))
        expect(quoteMock).toHaveBeenCalledTimes(1)
        expect(quoteMock.mock.calls[0][0].kind).toBe('swap')
        expect(stablesMock).not.toHaveBeenCalled()

        quoteMock.mockClear()
        quoteMock.mockImplementation(async () => clone(stableQuote.data))
        await bg.call(stableMsg())
        expect(stablesMock).toHaveBeenCalledTimes(1)
        expect(quoteMock.mock.calls[0][0].kind).toBe('stable')
    })

    it('0xEeee... native isaretcisi de native sayilir', async () => {
        await boot()

        await bg.call(msg({ inTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' }))

        expect(quoteMock).toHaveBeenCalledTimes(1)
        expect(quoteMock.mock.calls[0][0].tokenIn).toBe(NATIVE)
        expect(stablesMock).not.toHaveBeenCalled()
    })
})

describe('SWAP_QUOTE: LCX cagri yeri sozlesmesi', () => {
    it('normal imzaci: lcxEligible privateSigner FALSE (gercek boolean), LCX\'e giden degerler LCX bicimi', async () => {
        await boot()

        await bg.call(msg())

        expect(eligibleSpy).toHaveBeenCalledTimes(1)
        const arg = eligibleSpy.mock.calls[0][0]
        expect(arg.privateSigner).toBe(false)
        expect(arg).toEqual({ enabled: true, privateSigner: false, chainId: 8453, slippageBps: 50 })

        const sent = quoteMock.mock.calls[0][0]
        expect(sent.tokenIn).toBe(toLcxToken('0x0'))
        expect(sent.tokenIn).toBe(NATIVE)
        expect(sent.tokenOut).toBe(toLcxToken(USDC))
        expect(typeof sent.amountIn).toBe('string')
        expect(sent.amountIn).toMatch(/^\d+$/)
        expect(typeof sent.chainId).toBe('number')
        expect(sent.chainId).toBe(8453)
        expect(typeof sent.slippageBps).toBe('number')
    })

    it('kucuk harfli ERC-20 adresi checksum\'lanarak gonderilir', async () => {
        await boot()

        await bg.call(msg({ outTokenAddress: USDC.toLowerCase() }))

        expect(quoteMock.mock.calls[0][0].tokenOut).toBe(USDC)
    })

    it('Gizli Hesap imzacisi: lcxEligible privateSigner TRUE (gercek boolean) ile sorulur', async () => {
        await boot(GIZLI, { privacyFlag: 'false' })

        await bg.call(msg())

        expect(eligibleSpy).toHaveBeenCalledTimes(1)
        expect(eligibleSpy.mock.calls[0][0].privateSigner).toBe(true)
    })

    it('18 ondalikten fazla kullanici tutari ondaliga KESILEREK ham tutara cevrilir', async () => {
        await boot()

        await bg.call(msg({ amount: '0.0010000000000000009' }))

        expect(quoteMock.mock.calls[0][0].amountIn).toBe('1000000000000000')
    })
})

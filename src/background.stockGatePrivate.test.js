// KOK NEDEN / KAPATILAN HATA (main senkronu 22f4f686 denetimi, madde A ve B): v1.10.0 ile gelen GIZLI MOD uc yeni edinim ailesi getirdi
// (klasik Takas / Kopru kapisi, SilentSwap teslimi, ATS satin alma). Ilk alim kapisi bunlari su sekilde kapsar:
//  (1) klasik SWAP / SWAP_QUOTE / BRIDGE / BRIDGE_QUOTE / ATS_*_FEE_QUOTE: gizli kimlikte main'in gizlilik kapisi bayraktan bagimsiz
//      keser (PRIVATE_SWAP_BRIDGE_CLOSED); hisse ciktili mesaj ne kuyruga ne aga ne /eligibility'ye varir;
//  (2) SilentSwap teslimi (PRIVATE_QUOTE / PRIVATE_ORDER): hisse teslimi YASAK; emekli hisseler dahil
//      (background.stockGatePrivateDelivery.test.js, utils/privacy/stockDeliveryRetired.test.js);
//  (3) ATS satin alma: cikti yalniz ATS'dir (saleRequestFor ATS disi her cikti icin null); hisse ciktili cift satis istegi olamaz;
//  (4) STOCK_GATE_STATUS (kapinin ulke sorusu): gizli kimlikte BLOCKED_IN_PRIVATE; /eligibility istegi hic cikmaz (gizlilik; gizli
//      hesapta hisse alimi zaten imkansizdir, kapi yine KAPALI-BASARISIZ kalir). Eskiden mesaj hicbir gizlilik kumesinde degildi
//      (privacyGate siniflandirma kilidi kirmiziydi). Normal modda ayni mesaj /eligibility sorar (pozitif bekci: "istek cikmadi"
//      iddiasi harness'in sessizligi degil kapinin kararidir).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { getAddress } from 'ethers'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { heavyBackgroundTimeouts, HEAVY_BACKGROUND_HOOK_TIMEOUT_MS } from './test-utils/heavyBackgroundTimeouts.js'
import { BSTOCKS } from './data/bStocks'
import { XSTOCKS } from './data/xStocks'
import { RETIRED_BSTOCKS } from './data/bStocksRetired'
import { RETIRED_XSTOCKS } from './data/xStocksRetired'
import { stockOutputIssuer } from './utils/tokenizedStocks'
import { saleRequestFor } from './utils/atsSaleRoute'
import { ATS_SALE_ATS, ATS_SALE_CHAIN_ID, ATS_SALE_PAY_TOKENS } from './utils/atsSaleConfig'
import { BLOCKED_IN_PRIVATE, ALWAYS_ALLOWED, CONDITIONAL } from './utils/privacy/privacyGate'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

const fetchSpy = vi.fn()

const GIZLI = { key: 'g-1', address: getAddress('0x' + 'cd'.repeat(20)), type: 'hd', private: true }
const A = { key: 'a-1', address: getAddress('0x' + 'ab'.repeat(20)), type: 'hd' }
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'
const USDT_ETH = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const ROUTER = '0x5555555555555555555555555555555555555555'

const BSTOCK = BSTOCKS[0]
const XSTOCK = XSTOCKS[0]
const BMNRB = RETIRED_BSTOCKS.find((r) => r.symbol === 'BMNRB')
const FLNCB = RETIRED_BSTOCKS.find((r) => r.symbol === 'FLNCB')
const PYPLX = RETIRED_XSTOCKS.find((r) => r.symbol === 'PYPLx')

// Tum hisse cikti kumesi: katalog ve emekli, her biri kendi zincirinde.
const HISSELER = [
    ['katalog bStock', 56, BSTOCK],
    ['katalog xStock', 1, XSTOCK],
    ['emekli bStock BMNRB', 56, BMNRB],
    ['emekli bStock FLNCB', 56, FLNCB],
    ['emekli xStock PYPLx (BSC)', 56, PYPLX],
    ['emekli xStock PYPLx (Ethereum)', 1, PYPLX],
]

let bg
async function boot(active = GIZLI) {
    bg = await bootBackground({
        localStore: { active_account: active, vaults: [{ type: 'hd', accounts: [A], privateAccount: GIZLI }], dapps: {}, solana_dapps: {}, current_transactions: [] },
    })
}

// SOGUK BASLANGIC (main senkron A-MF-2): dosyadaki ILK boot(), background.js'in tum bagimlilik agacini donusturur ve yukler (olculen ~12 sn,
// sonraki bootlar < 1 sn). Bu bedel ilk testin 30 sn'lik test butcesine biniyor ve yuk altinda (60 kadar arka plan dosyasi yan yana)
// zaman asimina dusuyordu; burada bir kez, 60 sn'lik kanca butcesinde, test disinda odenir. Ag cagrisi cikmasin diye fetch sahte (503) ve
// teardown afterEach ile ayni.
beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => '', json: async () => ({}) })))
    await boot()
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
    teardownBackground()
    vi.unstubAllGlobals()
}, HEAVY_BACKGROUND_HOOK_TIMEOUT_MS)

beforeEach(() => {
    fetchSpy.mockReset()
    fetchSpy.mockImplementation(async () => ({ ok: false, status: 503, text: async () => '', json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchSpy)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r))
    teardownBackground()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('gizli kimlik: klasik Takas / Kopru aksiyonlari hisse ciktisinda kapida kesilir (main kapisi, bayraktan bagimsiz)', () => {
    it('pozitif bekci: fikstur hisseleri cikti tarafinda GERCEKTEN hisse (katalog ve emekli)', () => {
        for (const [ad, zincir, t] of HISSELER) expect(stockOutputIssuer(zincir, t.address), ad).not.toBeNull()
    })

    const mesajlar = (zincir, t) => [
        ['SWAP_QUOTE', { chainId: zincir, inTokenAddress: USDT_BSC, outTokenAddress: t.address, amount: '5', slippage: 1 }],
        ['SWAP', { chainId: zincir, inTokenAddress: USDT_BSC, outTokenAddress: t.address, amount: '5', slippage: 1, inTokenData: { symbol: 'USDT' }, outTokenData: { symbol: t.symbol } }],
        ['BRIDGE_QUOTE', { fromChain: 1, toChain: zincir, inToken: { address: USDT_ETH, decimals: 6 }, outToken: { address: t.address, decimals: 18 }, amount: '12', filter: 'RECOMMENDED', slippage: 0.5 }],
        ['BRIDGE', { chain: 1, toChain: zincir, toTokenAddress: t.address, to: ROUTER, from: USDT_ETH, data: '0x', value: '0', amount: 12, amount_raw: '12000000', fromTokenData: { symbol: 'USDT' } }],
        ['ATS_SWAP_FEE_QUOTE', { chainId: 56, inTokenAddress: USDT_BSC, outTokenAddress: t.address, amount: '5', slippage: 1 }],
        ['ATS_BRIDGE_FEE_QUOTE', { chainId: 56, to: ROUTER, data: '0x', value: '0', fromTokenAddress: USDT_BSC, amount_raw: '5000000', approvalAddress: ROUTER, toChain: zincir, toTokenAddress: t.address }],
    ]

    it.each(HISSELER)('%s: alti klasik aksiyonun hicbiri kuyruga, aga ya da /eligibility e varmaz (PRIVATE_SWAP_BRIDGE_CLOSED)', async (_ad, zincir, t) => {
        await boot()
        for (const [tip, message] of mesajlar(zincir, t)) {
            const res = await bg.call({ type: tip, message })
            expect(res, tip).toMatchObject({ error: 'PRIVATE_SWAP_BRIDGE_CLOSED' })
        }
        await new Promise((r) => setTimeout(r, 30))
        expect(bg.localStore.current_transactions).toEqual([])
        expect(fetchSpy).not.toHaveBeenCalled()
    })
})

describe('ATS satin alma: cikti yalniz ATS; hisse ciktili cift satis istegi OLAMAZ (saleRequestFor)', () => {
    const USDT_SALE = ATS_SALE_PAY_TOKENS.find((t) => t.symbol === 'USDT')

    it('pozitif bekci: ATS ciktisi ve odeme tokeni (USDT, BNB) satis istegi uretir', () => {
        expect(saleRequestFor({ chainId: ATS_SALE_CHAIN_ID, inTokenAddress: USDT_SALE.address, outTokenAddress: ATS_SALE_ATS })).not.toBeNull()
        expect(saleRequestFor({ chainId: ATS_SALE_CHAIN_ID, inTokenAddress: '0x0', outTokenAddress: ATS_SALE_ATS })).not.toBeNull()
    })

    it.each(HISSELER)('%s ciktisi: odeme tokeni ne olursa olsun satis istegi null (cift klasik yola / kapiya dusar)', (_ad, zincir, t) => {
        for (const inTokenAddress of [USDT_SALE.address, '0x0', ...ATS_SALE_PAY_TOKENS.map((p) => p.address)]) {
            for (const chainId of [zincir, ATS_SALE_CHAIN_ID]) {
                expect(saleRequestFor({ chainId, inTokenAddress, outTokenAddress: t.address }), `${chainId} ${inTokenAddress}`).toBeNull()
            }
        }
    })
})

describe('STOCK_GATE_STATUS (kapinin ulke sorusu): gizli kimlikte /eligibility istegi HIC cikmaz', () => {
    const sor = () => bg.call({ type: 'STOCK_GATE_STATUS' })
    const eligibilityIstekleri = () => fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/eligibility'))

    it('siniflandirma: STOCK_GATE_STATUS tam bir kumede ve o kume BLOCKED_IN_PRIVATE', () => {
        expect(BLOCKED_IN_PRIVATE.has('STOCK_GATE_STATUS')).toBe(true)
        expect(ALWAYS_ALLOWED.has('STOCK_GATE_STATUS')).toBe(false)
        expect(CONDITIONAL.has('STOCK_GATE_STATUS')).toBe(false)
    })

    it('pozitif bekci: NORMAL modda ayni mesaj /eligibility sorar ve iki ihracci karari doner', async () => {
        await boot(A)
        const res = await sor()
        expect(Object.keys(res).sort()).toEqual(['bstocks', 'xstocks'])
        expect(eligibilityIstekleri().length).toBeGreaterThan(0)
    })

    it('gizli kimlik: mesaj kapida kesilir (BLOCKED_IN_PRIVATE), isleyiciye ulasmaz, /eligibility istegi YOK', async () => {
        await boot()
        const res = await sor()
        expect(res).toEqual({ success: false, error: 'PRIVATE_EVM_ONLY' })
        await new Promise((r) => setTimeout(r, 30))
        expect(eligibilityIstekleri()).toEqual([])
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('gizli kimlik: kesilen yanit arayuzde KAPALI-BASARISIZ okunur (iki ihracci da BLOCKED / CHECK_FAILED, ham hata dizgesi sizmaz)', async () => {
        await boot()
        const res = await sor()
        const { createStockEligibilityStore } = await import('./composables/useStockEligibility')
        const store = createStockEligibilityStore({ send: async () => res, subscribe: () => () => {} })
        store.acquire()
        for (let i = 0; i < 20; i++) await Promise.resolve()
        const { verdicts } = store.snapshot()
        store.dispose()
        for (const ihracci of ['bstocks', 'xstocks']) {
            expect(verdicts[ihracci], ihracci).toEqual({ decision: 'BLOCKED', reason: 'CHECK_FAILED', ipCountry: null })
        }
    })
})

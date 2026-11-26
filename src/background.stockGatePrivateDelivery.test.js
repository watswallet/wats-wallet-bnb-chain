// KOK NEDEN / KAPATILAN HATA (K28, K42; main senkronu 22f4f686 denetimi, madde A): gizli modda tokenlastirilmis hisse teslimi YASAKTIR
// (sahip karari 2026-10-23) ve arka plan bunu `isStockDeliveryToken` ile hem teklif (PRIVATE_QUOTE) hem siparis (PRIVATE_ORDER) ANINDA
// reddeder. Eski tanim yalniz katalogu, xStocks dislama kumesini ve teslim-ozel listeyi sorardi: katalogdan CIKMIS (emekli) hisseler --
// bStocks BMNRB / FLNCB ve xStocks ADBEx / PYPLx / STRCx -- hisse sayilmazdi; gizli Gonder / Takas / Kopru teslimi onlari saglayiciya
// kadar goturebilirdi. Bu dosya emekli adreslerin de (katalog hisseleriyle birlikte) saglayici durumu okumasi, SDK teklifi, kayit,
// siparis ve yurutucuden ONCE reddedildigini kilitler (saf fonksiyon: utils/privacy/stockDeliveryRetired.test.js).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { getAddress } from 'ethers'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { heavyBackgroundTimeouts, HEAVY_BACKGROUND_HOOK_TIMEOUT_MS } from './test-utils/heavyBackgroundTimeouts.js'
import { quoteFixture } from './test-utils/silentswapFixtures'
import { BSTOCKS } from './data/bStocks'
import { XSTOCKS } from './data/xStocks'
import { RETIRED_BSTOCKS } from './data/bStocksRetired'
import { RETIRED_XSTOCKS } from './data/xStocksRetired'
import { stockOutputIssuer } from './utils/tokenizedStocks'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

const quoteMock = vi.fn()
vi.mock('@silentswap/sdk', async (importOriginal) => ({
    ...(await importOriginal()),
    createSilentSwapClient: () => ({ quote: (...a) => quoteMock(...a), getOrder: vi.fn(), reportDepositTransaction: vi.fn(async () => {}) }),
}))

const fetchSpy = vi.fn()

const GIZLI = { key: 'g-1', address: getAddress('0x' + 'cd'.repeat(20)), type: 'hd', private: true }
const A = { key: 'a-1', address: getAddress('0x' + 'ab'.repeat(20)), type: 'hd' }
const YABANCI = '0x' + '12'.repeat(20)

const BSTOCK = BSTOCKS[0]
const XSTOCK = XSTOCKS[0]
const BMNRB = RETIRED_BSTOCKS.find((r) => r.symbol === 'BMNRB')
const FLNCB = RETIRED_BSTOCKS.find((r) => r.symbol === 'FLNCB')
const PYPLX = RETIRED_XSTOCKS.find((r) => r.symbol === 'PYPLx')
const token = (chainId, t) => ({ chainId, address: t.address, symbol: t.symbol, decimals: 18 })

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
async function boot() {
    bg = await bootBackground({
        localStore: { active_account: GIZLI, vaults: [{ type: 'hd', accounts: [A], privateAccount: GIZLI }], dapps: {}, solana_dapps: {}, current_transactions: [] },
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
    quoteMock.mockReset()
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

describe('gizli kimlik: SilentSwap teslimi (PRIVATE_QUOTE / PRIVATE_ORDER) hisse tokenini -- katalog VE emekli -- reddeder', () => {
    it('pozitif bekci: fikstur hisseleri cikti tarafinda GERCEKTEN hisse (katalog ve emekli)', () => {
        for (const [ad, zincir, t] of HISSELER) expect(stockOutputIssuer(zincir, t.address), ad).not.toBeNull()
    })

    // Gonder yonu: kaynak Gizli Hesap, alici yabanci adres. (Para yukle yonunde teslim zaten yalniz Gonder kaynagi varliklaridir.)
    const gonder = (outputToken) => ({
        type: 'PRIVATE_QUOTE',
        message: { sourceAccountKey: GIZLI.key, sourceChainId: 56, sourceAsset: 'USDC', outputAddress: YABANCI, payoutUsdc: '15', outputToken },
    })

    it.each(HISSELER)('PRIVATE_QUOTE teslim tokeni %s: PRIVATE_UNSUPPORTED; SDK, saglayici durumu (fetch) ve teklif kaydi YOK', async (_ad, zincir, t) => {
        await boot()
        expect(await bg.call(gonder(token(zincir, t)))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(quoteMock).not.toHaveBeenCalled()
        expect(fetchSpy).not.toHaveBeenCalled()
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    const kayit = (outputToken) => ({
        createdAt: Date.now(),
        quote: quoteFixture({
            inputAddress: GIZLI.address,
            recipient: { chainId: 56, address: YABANCI },
            recipients: [{ splitIndex: 0, address: YABANCI, chainId: 56, payoutAmount: '14850000000000000000' }],
        }),
        sourceAccountKey: GIZLI.key, sourceChainId: 56, sourceAsset: 'USDC', payoutUsdc: '15', outputToken, deliveryVersion: 2, outputAddress: YABANCI,
    })

    it.each(HISSELER)('PRIVATE_ORDER teslim kaydi %s: PRIVATE_UNSUPPORTED; siparis, kuyruk ve ag YOK (eski / elle yazilmis kayit da)', async (_ad, zincir, t) => {
        await boot()
        bg.sessionStore.private_quotes = { [quoteFixture().ticket]: kayit(token(zincir, t)) }
        expect(await bg.call({ type: 'PRIVATE_ORDER', message: { ticket: quoteFixture().ticket } })).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        await new Promise((r) => setTimeout(r, 30))
        expect(bg.localStore.private_orders).toBeUndefined()
        expect(bg.localStore.current_transactions).toEqual([])
        expect(quoteMock).not.toHaveBeenCalled()
        expect(fetchSpy).not.toHaveBeenCalled()
    })
})

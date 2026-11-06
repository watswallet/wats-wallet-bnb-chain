// xStocks (CoW Al/Sat) gizli modda KAPALI -- GERCEK dagitici uzerinden (sahip karari 2026-10-16).
//
// Gerekce: CoW emri Gizli adresi CoW'a IP ile gosterir, gizli modda fiyat istekleri kapali ve xStocks "fiyat yoksa
// kilit" der. Sekiz COW_* mesaji (bes Faz 2 + uc Faz 3 ucret) da BLOCKED_IN_PRIVATE'tadir: gizli modda isleyiciye HIC ulasmaz (bu mesaj yolundan
// CoW calisma zamani kurulmaz; alarm yoklayicisi ayridir, Dilim D), normal modda kapidan gecer. Arayuz girislerinin
// gizlenmesi KAPI DEGILDIR (eski bir popup mesaj atabilir); bu dosya kapinin kendisini sinar. Birim karar tablosu
// privacyGate.test.js'tedir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'
import { PRIVATE_GATE_CODES } from './utils/privacy/privacyGate'

heavyBackgroundTimeouts()

// Servis / onay / yoklayici fabrikalari casusla degistirilir (background.cow.test.js ile ayni kalip): burada sinanan
// DAGITIM katmanidir; fabrikalarin cagrilmamasi "bu mesaj yolu CoW calisma zamanini kurmadi" demektir.
const svc = vi.hoisted(() => ({ quote: vi.fn(), placeOrder: vi.fn() }))
const appr = vi.hoisted(() => ({ quote: vi.fn(), execute: vi.fn() }))
const poll = vi.hoisted(() => ({ pollCowOrders: vi.fn() }))
const feeRt = vi.hoisted(() => ({
    statusFor: vi.fn(),
    settleCowFees: vi.fn(),
    approveFeeChange: vi.fn(),
    claimRefunds: vi.fn(),
}))
const fabrika = vi.hoisted(() => ({ service: vi.fn(), approve: vi.fn(), poller: vi.fn(), fee: vi.fn() }))
// Faz 3 ucret calisma zamani: casuslu sahte (gercek ag/kasa yok); fabrikanin cagrilmamasi 'ucret yolu kurulmadi' demektir.
vi.mock('./utils/cow/feeRuntime', async (importOriginal) => ({
    ...(await importOriginal()),
    createFeeRuntime: (...a) => {
        fabrika.fee(...a)
        return {
            statusFor: feeRt.statusFor,
            settler: { settleCowFees: feeRt.settleCowFees, approveFeeChange: feeRt.approveFeeChange },
            claimer: { claimRefunds: feeRt.claimRefunds },
        }
    },
}))
vi.mock('./utils/cow/service', () => ({
    createCowService: (...a) => {
        fabrika.service(...a)
        return svc
    },
}))
vi.mock('./utils/cow/approve', async (importOriginal) => ({
    ...(await importOriginal()),
    createCowApprove: (...a) => {
        fabrika.approve(...a)
        return appr
    },
}))
vi.mock('./utils/cow/poller', async (importOriginal) => ({
    ...(await importOriginal()),
    createCowPoller: (...a) => {
        fabrika.poller(...a)
        return poll
    },
}))

const GIZLI = { key: 'g-1', address: '0x' + 'cd'.repeat(20), type: 'hd', private: true, derivationPath: "m/44'/60'/0'/1/0" }
const A = { key: 'a-1', address: '0x' + 'ab'.repeat(20), type: 'hd', index: 0, derivationPath: "m/44'/60'/0'/0/0" }
const QID = 'ab'.repeat(16)
const HISSE = '0x' + '12'.repeat(20)

// Sekiz mesaj: ad, govde ve normal modda cagrilmasi beklenen casus.
const MESAJLAR = [
    ['COW_QUOTE', { side: 'buy', chainId: 56, stockAddress: HISSE, payToken: 'USDC', amount: '10' }, () => svc.quote],
    ['COW_PLACE_ORDER', { quoteId: QID }, () => svc.placeOrder],
    ['COW_ORDERS_REFRESH', {}, () => poll.pollCowOrders],
    ['COW_APPROVE_QUOTE', { quoteId: QID }, () => appr.quote],
    ['COW_APPROVE_EXECUTE', { quoteId: QID, quoted: {} }, () => appr.execute],
    // Faz 3 ATS ucreti (bayrak testte acik): normal modda isleyiciye ulasir ve ucret calisma zamani kurulur.
    ['COW_FEE_STATUS', {}, () => feeRt.statusFor],
    ['COW_FEE_PAY', {}, () => feeRt.settleCowFees],
    ['COW_FEE_APPROVE_CHANGE', { uid: '0x' + 'ab'.repeat(56) }, () => feeRt.approveFeeChange],
]

let bg

async function boot({ active }) {
    bg = await bootBackground({
        localStore: {
            active_account: active,
            vaults: [{ type: 'hd', accounts: [A], privateAccount: GIZLI }],
            currentNetwork: { chainId: 56, name: 'BNB Smart Chain' },
            dapps: {},
            cow_orders: [],
        },
        sessionStore: { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } },
    })
    // Acilis yazimlari testin "islem yapilmadi" olcumune karismasin.
    await new Promise((resolve) => setImmediate(resolve))
    chrome.storage.local.set.mockClear()
}

beforeEach(() => {
    // Hicbir test gercek aga cikmaz.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ag kapali') }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    svc.quote.mockResolvedValue({ success: true })
    svc.placeOrder.mockResolvedValue({ success: true })
    appr.quote.mockResolvedValue({ success: true })
    appr.execute.mockResolvedValue({ success: true })
    feeRt.statusFor.mockResolvedValue({ fees: [], debt: null })
    feeRt.settleCowFees.mockResolvedValue({ outcome: 'NONE' })
    feeRt.approveFeeChange.mockResolvedValue({ outcome: 'NONE' })
    poll.pollCowOrders.mockResolvedValue(undefined)
})

afterEach(async () => {
    await new Promise((resolve) => setImmediate(resolve))
    teardownBackground()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('COW_* -- gizli mod (Gizli Hesap aktif)', () => {
    beforeEach(() => boot({ active: GIZLI }))

    it.each(MESAJLAR)('%s: PRIVATE_EVM_ONLY ile reddedilir; COW_* mesaj yolu CoW calisma zamanini kurmaz, ag ve depo yazimi yok', async (ad, govde, casus) => {
        const yanit = await bg.call({ type: ad, message: govde })

        expect(yanit).toEqual({ success: false, error: PRIVATE_GATE_CODES.EVM_ONLY })
        expect(casus()).not.toHaveBeenCalled()
        expect(fabrika.service).not.toHaveBeenCalled()
        expect(fabrika.approve).not.toHaveBeenCalled()
        expect(fabrika.poller).not.toHaveBeenCalled()
        expect(fabrika.fee).not.toHaveBeenCalled()
        expect(globalThis.fetch).not.toHaveBeenCalled()
        expect(chrome.storage.local.set).not.toHaveBeenCalled()
    })
})

describe('COW_* -- normal mod (kapi araya girmez)', () => {
    beforeEach(() => boot({ active: A }))

    it.each(MESAJLAR)('%s: kapidan gecer ve isleyicisine ulasir', async (ad, govde, casus) => {
        const yanit = await bg.call({ type: ad, message: govde })

        expect(typeof yanit?.error === 'string' ? yanit.error : '').not.toMatch(/^PRIVATE_/)
        expect(casus()).toHaveBeenCalledTimes(1)
    })
})

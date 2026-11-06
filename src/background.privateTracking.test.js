import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { getAddress, HDNodeWallet, JsonRpcProvider, keccak256 } from 'ethers'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { createVault, deriveMasterKey, randBytes } from './utils/crypto-utils'
import { derivePrivateAccount } from './utils/privacy/privateAccount'
import supported_chains from './data/supported_chains.json'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'
import { oklchHex, morMu } from './test-utils/morRenk'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

const getOrderMock = vi.fn()
const refundMock = vi.fn()
// Bu dosyanin iade testleri NATIVE (BNB gazli) kolu sinar: uretimde PRIVATE_ORDER_ATS true'dur ve iade ATS ile gider (sahip karari
// 2026-10-30); ATS iadesi background.privateRefundAts.test.js'te. Bayrak burada kasitli olarak false (native kol surum guvenligi).
const flags = vi.hoisted(() => ({ ats: false }))
// "Zincire yayin" sahtesi: yalniz KAYIT yazildiktan sonra cagrilir (kayit yazilamazsa yayin olmaz).
const broadcastSpy = vi.fn()
// SilentSwap'e yatirma hash'i bildirimi (reportDepositTransaction): uzlastirmanin bildirimi gozlenebilsin.
const reportMock = vi.fn(async () => {})
const RAW_REFUND = '0x' + 'f1'.repeat(60)
// refundMock icin sirayi kendisi yurutur: onSubmitted (kayit) -> yayin -> sonuc ya da hash'li hata. fail:
// { message, definitive } ise yayin hata verir (gercek sendRefund'un broadcastError sekli).
// T29 M3: destroy casuslari JsonRpcProvider.prototype uzerindedir (tum ornekleri gorur); yuk altinda baska bir
// saglayicinin (onceki testten kalan etkinlik) destroy'u sayimi bozuyordu. Sayim yalniz TEST KODUNUN YAKALADIGI
// (kodun kurup kullandigi) ornekler icin yapilir.
const destroyEdilen = (spy, saglayicilar) => spy.mock.contexts.filter((c) => saglayicilar.includes(c))
const recordingRefund = (hash, { wait = async () => ({ status: 1 }), fail = null } = {}) => async (args) => {
    await args.onSubmitted(hash, RAW_REFUND)
    broadcastSpy(hash)
    if (fail) throw Object.assign(new Error(fail.message), { hash, definitive: fail.definitive === true })
    return { hash, recorded: true, wait }
}

vi.mock('@silentswap/sdk', async (importOriginal) => ({
    ...(await importOriginal()),
    createSilentSwapClient: () => ({ quote: vi.fn(), getOrder: (...a) => getOrderMock(...a), reportDepositTransaction: (...a) => reportMock(...a) }),
}))
vi.mock('./utils/privacy/silentswapConfig', async (importOriginal) => ({
    ...(await importOriginal()),
    get PRIVATE_ORDER_ATS() { return flags.ats },
}))
vi.mock('./utils/privacy/privateOrderExec', async (importOriginal) => ({
    ...(await importOriginal()),
    // Gercek sendRefund imzala-kaydet-yayinla yurutur (T25): yayindan ONCE onSubmitted(hash, ham bayt) ile kaydi
    // yazdirir. Sahte, `refundMock` sonucunu DONDURMEDEN once ayni geri cagriyi cagirir, boylece kayit/bellek isareti
    // gercek yoldan gecer. Sirayi (kayit -> yayin) ya da kayittan sonraki hatayi sinayan testler refundMock'u
    // KENDILERI onSubmitted'i cagiracak sekilde kurar ve sonuca `recorded: true` koyar (burada tekrar yazilmaz).
    sendRefund: async (args) => {
        const r = await refundMock(args)
        if (r && r.hash && !r.recorded && typeof args.onSubmitted === 'function') await args.onSubmitted(r.hash, RAW_REFUND)
        return r
    },
}))

const MNEMONIC = 'test test test test test test test test test test test junk'
const SAYFA = { url: 'https://site.example/', tab: { id: 3, url: 'https://site.example/' } }
const T = '0x' + '01'.repeat(32)
const GATEWAY = getAddress('0x' + '11'.repeat(20))
// Iade ve yatirma uzlastirmasi gateway/kaynak zincirde (56) calisir; teslim agi (Base...) bunlari hic etkilemez (spec 4.3 Degismeyenler).
const BSC_RPC = supported_chains.find((c) => Number(c.chainId) === 56).rpc[0].url
const BASE_DEST = { chainId: 8453, asset: 'USDC', decimals: 6, expectedDestAmount: '14787310', minDestAmount: '14346647', quoteUsd: null }
const nowSec = () => Math.floor(Date.now() / 1000)
// Siparis ufku 72 saattir: sabit "1" gibi eski bir createdAt siparisi 'problem'e kapatirdi.
const CREATED = Date.now() - 60 * 1000

let A, B, GIZLI, vault, jwk
beforeAll(async () => {
    const masterKey = await deriveMasterKey('parola-123456', randBytes(32))
    const path = "m/44'/60'/0'/0/0"
    const addr = HDNodeWallet.fromPhrase(MNEMONIC, null, 'm').derivePath(path).address
    A = { key: 'a-1', name: 'Hesap 1', type: 'hd', index: 0, derivationPath: path, address: addr }
    B = { key: 'b-1', name: 'Hesap 2', type: 'hd', index: 1, derivationPath: "m/44'/60'/0'/0/1", address: getAddress('0x' + 'ee'.repeat(20)) }
    vault = await createVault(masterKey, MNEMONIC, A)
    GIZLI = derivePrivateAccount(MNEMONIC, vault, { name: 'Gizli Hesap' })
    vault.privateAccount = GIZLI
    jwk = await crypto.subtle.exportKey('jwk', masterKey)
}, 60000)

const order = (over) => ({
    ticket: T, accessToken: 'tok', sourceAccountKey: 'a-1', sourceChainId: 56, outputAddress: GIZLI.address,
    summary: { payoutUsdc: '25.0' }, depositTxHash: '0xh', status: 'AWAITING_DEPOSIT', state: null, refundTxHash: null, createdAt: CREATED, ...over,
})
const failedState = (over) => ({
    status: 'FAILED', signer: A.address, gateway: GATEWAY, expirationUnix: nowSec() - 10, recipients: [{ status: 'FAILED', recipientTxHash: null }], ...over,
})
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)) }

let bg
async function boot({ active = GIZLI, orders = [order()], unlocked = true, privacyFlag, vaults } = {}) {
    getOrderMock.mockReset()
    refundMock.mockReset()
    broadcastSpy.mockReset()
    reportMock.mockClear()
    bg = await bootBackground({
        privacyFlag,
        localStore: { active_account: active, vaults: vaults ?? [structuredClone(vault)], dapps: {}, solana_dapps: {}, private_orders: orders },
        sessionStore: unlocked ? { sessionMasterKeyJwk: jwk } : {},
    })
    // Servis calisani acilisindaki arka plan isleri (alarm yeniden kurma) bitsin; sayaclar sifirlansin.
    await flush()
    bg.chrome.alarms.create.mockClear()
    bg.chrome.alarms.get.mockClear()
    bg.chrome.action.setBadgeText.mockClear()
}
const fireAlarm = async (name = 'private_orders') => {
    for (const fn of bg.listeners.onAlarm) await fn({ name })
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Hermetik: hicbir test gercek RPC'ye gitmez; uzlastirma testleri bunu kendi makbuzuyla ezer.
    vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockResolvedValue(null)
    // Uzlastirma makbuzsuz iadenin ham baytini yeniden yayinlar: o da hermetik olmali.
    vi.spyOn(JsonRpcProvider.prototype, 'broadcastTransaction').mockResolvedValue({})
    reportMock.mockReset()
    reportMock.mockImplementation(async () => {})
})
afterEach(async () => {
    await flush()
    teardownBackground()
    vi.restoreAllMocks()
})

describe('PRIVATE_ORDERS', () => {
    it('acik siparisi yoklar, faz ve iade uygunlugunu doner', async () => {
        await boot()
        getOrderMock.mockResolvedValueOnce({ status: 'COMPLETED', signer: A.address, recipients: [{ status: 'FULFILLED', recipientTxHash: '0xp' }] })
        const res = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(res.success).toBe(true)
        expect(res.orders[0]).toMatchObject({ ticket: T, phase: 'done', payoutUsdc: '25.0', refundable: false })
    })

    it('liste USDC teslimi icin varlik ve beklenen tutari tasir', async () => {
        await boot()
        getOrderMock.mockResolvedValueOnce({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        // dest'siz ESKI kayit (2026-10-10 oncesi dogrudan USDC): tutar kesin, tahmin degil.
        // Surumsuz (ESKI) kayit: ACIK eski-kayit yolu, teslim agi 56.
        expect(orders[0]).toMatchObject({ outputAsset: 'USDC', expectedAmount: '25.0', estimated: false, deliveryChainId: 56, outputAddress: GIZLI.address, sourceChainId: 56, createdAt: CREATED })
        // Yatirma verisi ve erisim anahtari arayuze CIKMAZ.
        expect(JSON.stringify(orders)).not.toContain('tok')
        // Islem turu alanlari (kind, sourceAsset, counterpartName, counterpartAddress) bilincli eklendi: satir artik "ne islemdi" de soyler.
        // Bu eski kayitta cikti Gizli Hesap, kaynak Hesap 1 (normal): tur 'fund'; ozet sourceInput tasimadigi icin kaynak varlik null.
        expect(Object.keys(orders[0]).sort()).toEqual(['counterpartAddress', 'counterpartName', 'createdAt', 'deliveryChainId', 'depositFailed', 'estimated', 'expectedAmount', 'kind', 'outputAddress', 'outputAsset', 'payoutUsdc', 'phase', 'refundFailed', 'refundOpensLater', 'refundPending', 'refundStatusUnknown', 'refundable', 'sourceAsset', 'sourceChainId', 'ticket'])
        expect(orders[0]).toMatchObject({ kind: 'fund', sourceAsset: null, counterpartName: 'Hesap 1', counterpartAddress: A.address })
    })

    it('liste BNB teslimi icin varlik ve beklenen BNB tutarini tasir (18 ondalik)', async () => {
        const o = order({ summary: { payoutUsdc: '25.0', dest: { expectedDestAmount: '40000000000000000', minDestAmount: '39000000000000000' } } })
        await boot({ orders: [o] })
        getOrderMock.mockResolvedValueOnce({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        // dest.asset'siz ESKI kayit: o tarihten once dest yalniz BNB'de gonderiliyordu.
        expect(orders[0]).toMatchObject({ outputAsset: 'BNB', expectedAmount: '0.04', payoutUsdc: '25.0', estimated: true, deliveryChainId: 56 })
    })

    // Surum 2 kayit (gizli-mod cok-ag spec 4.3): ag, sembol ve ondalik SECIMDEN yazilmistir; satir teslim agini tasir, odeme ve
    // yatirma zinciri (sourceChainId) 56 kalir.
    it('liste surum 2 kayitta teslim agini ve secimden yazilan sembol/ondaligi tasir (Base USDC 6, Arbitrum ETH 18, BSC CAKE 18)', async () => {
        const dest = (chainId, asset, decimals, expectedDestAmount) => ({ chainId, asset, decimals, expectedDestAmount, minDestAmount: '1', quoteUsd: null })
        const base = order({ ticket: '0xbase', deliveryVersion: 2, summary: { payoutUsdc: '14.85', dest: dest(8453, 'USDC', 6, '14787310') } })
        const arb = order({ ticket: '0xarb', deliveryVersion: 2, summary: { payoutUsdc: '14.85', dest: dest(42161, 'ETH', 18, '6153854783951967') } })
        const cake = order({ ticket: '0xcake', deliveryVersion: 2, summary: { payoutUsdc: '14.85', dest: dest(56, 'CAKE', 18, '6555238737484223626') } })
        await boot({ orders: [base, arb, cake] })
        getOrderMock.mockResolvedValue({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        const row = (t) => orders.find((o) => o.ticket === t)
        expect(row('0xbase')).toMatchObject({ deliveryChainId: 8453, outputAsset: 'USDC', expectedAmount: '14.78731', estimated: true, sourceChainId: 56 })
        expect(row('0xarb')).toMatchObject({ deliveryChainId: 42161, outputAsset: 'ETH', expectedAmount: '0.006153854783951967', estimated: true, sourceChainId: 56 })
        expect(row('0xcake')).toMatchObject({ deliveryChainId: 56, outputAsset: 'CAKE', expectedAmount: '6.555238737484223626', estimated: true })
    })

    // D5: bozuk ag satiri asla 56'ya dusmez ("USDC Base'e gitti" yerine "BSC'ye gitti" gostermek yanlis aga gitmis gibi gorunmek
    // demektir); eksik asset/decimals "BNB" ya da "USDC" yedegi uretmez; bilinmeyen surum hicbir alan uydurmaz.
    it('liste surum 2 bozuk kayitta teslim agi null olur ve ASLA 56ya dusmez; eksik asset/decimals sembol ve tutari gostermez; bilinmeyen surum null', async () => {
        const ok = { asset: 'USDC', decimals: 6, expectedDestAmount: '14787310', minDestAmount: '1' }
        const v2 = (ticket, dest) => order({ ticket, deliveryVersion: 2, summary: { payoutUsdc: '14.85', dest } })
        await boot({ orders: [
            v2('0xbozuk', { ...ok, chainId: 99999 }),
            v2('0xzincirsiz', { ...ok }),
            v2('0xvarliksiz', { chainId: 8453, decimals: 6, expectedDestAmount: '14787310', minDestAmount: '1' }),
            v2('0xondaliksiz', { chainId: 8453, asset: 'USDC', expectedDestAmount: '14787310', minDestAmount: '1' }),
            order({ ticket: '0xyeni', deliveryVersion: 3, summary: { payoutUsdc: '14.85', dest: { ...ok, chainId: 8453 } } }),
        ] })
        getOrderMock.mockResolvedValue({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        const row = (t) => orders.find((o) => o.ticket === t)
        expect(row('0xbozuk')).toMatchObject({ deliveryChainId: null, outputAsset: 'USDC', expectedAmount: '14.78731' })
        expect(row('0xzincirsiz')).toMatchObject({ deliveryChainId: null, outputAsset: 'USDC', expectedAmount: '14.78731' })
        expect(row('0xvarliksiz')).toMatchObject({ deliveryChainId: 8453, outputAsset: null, expectedAmount: null })
        expect(row('0xondaliksiz')).toMatchObject({ deliveryChainId: 8453, outputAsset: null, expectedAmount: null })
        expect(row('0xyeni')).toMatchObject({ deliveryChainId: null, outputAsset: null, expectedAmount: null })
        for (const o of orders) expect(o.deliveryChainId, o.ticket).not.toBe(56)
    })

    // 2026-10-10'dan beri USDC teslimi de dest tasir: varlik ozetin dest.asset'i, tutar beklenen teslim (tahmin).
    it('liste dest li USDC teslimi icin USDC ve beklenen USDC tutarini tahmin olarak tasir', async () => {
        const o = order({ summary: { payoutUsdc: '24.75', dest: { asset: 'USDC', decimals: 18, expectedDestAmount: '24650000000000000000', minDestAmount: '24000000000000000000' } } })
        await boot({ orders: [o] })
        getOrderMock.mockResolvedValueOnce({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders[0]).toMatchObject({ outputAsset: 'USDC', expectedAmount: '24.65', estimated: true })
    })

    it('liste secilen tokenin sembolu ve ondaligiyla tahmini teslimi tasir (CAKE 18, 6 ondalikli token)', async () => {
        const cake = order({ summary: { payoutUsdc: '14.85', dest: { asset: 'CAKE', decimals: 18, expectedDestAmount: '6555238737484223626', minDestAmount: '6000000000000000000' } } })
        const alti = order({ ticket: '0xalti', summary: { payoutUsdc: '14.85', dest: { asset: 'XYZ', decimals: 6, expectedDestAmount: '1500000', minDestAmount: '1400000' } } })
        await boot({ orders: [cake, alti] })
        getOrderMock.mockResolvedValue({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders.find((o) => o.ticket === T)).toMatchObject({ outputAsset: 'CAKE', expectedAmount: '6.555238737484223626', estimated: true })
        expect(orders.find((o) => o.ticket === '0xalti')).toMatchObject({ outputAsset: 'XYZ', expectedAmount: '1.5', estimated: true })
    })

    // FA3: ondalik sinirlari (0 ve 36) liste satirinda dogru bicimlenir.
    it('liste ondalik sinirlarini bicimler: 0 ondalikli token ham "6" -> "6", 36 ondalikli token 1.5e36 -> "1.5"', async () => {
        const sifir = order({ ticket: '0xsifir', summary: { payoutUsdc: '14.85', dest: { asset: 'ZRO', decimals: 0, expectedDestAmount: '6', minDestAmount: '5' } } })
        const otuzalti = order({ ticket: '0xotuzalti', summary: { payoutUsdc: '14.85', dest: { asset: 'BIG', decimals: 36, expectedDestAmount: '1500000000000000000000000000000000000', minDestAmount: '1400000000000000000000000000000000000' } } })
        await boot({ orders: [sifir, otuzalti] })
        getOrderMock.mockResolvedValue({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders.find((o) => o.ticket === '0xsifir')).toMatchObject({ outputAsset: 'ZRO', expectedAmount: '6', estimated: true })
        expect(orders.find((o) => o.ticket === '0xotuzalti')).toMatchObject({ outputAsset: 'BIG', expectedAmount: '1.5', estimated: true })
    })

    it('liste depositFailed isaretini tasir (arayuz "gonderilmedi" ipucunu bundan yazar)', async () => {
        await boot({ orders: [order({ depositFailed: true, status: 'ABORTED' }), order({ ticket: '0xikinci' })] })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders.find((o) => o.ticket === T)).toMatchObject({ phase: 'problem', depositFailed: true, refundable: false })
        expect(orders.find((o) => o.ticket === '0xikinci').depositFailed).toBe(false)
    })

    // T18 M6: ekranin "iade sure dolunca acilir" vaadi yalniz gercekten acilacak siparislere yazilir.
    it.each([
        ['FAILED, suresi ILERIDE: iade sure dolunca acilir', () => order({ status: 'FAILED', state: failedState({ expirationUnix: nowSec() + 3600 }) }), { phase: 'problem', refundable: false, refundOpensLater: true }],
        ['FAILED, suresi gecmis: iade ZATEN acik', () => order({ status: 'FAILED', state: failedState({ expirationUnix: nowSec() - 10 }) }), { phase: 'problem', refundable: true, refundOpensLater: false }],
        ['ABORTED (durum goruntusu ABORTED): iade hic acilmaz', () => order({ status: 'ABORTED', state: failedState({ status: 'ABORTED', expirationUnix: nowSec() + 3600 }) }), { phase: 'problem', refundable: false, refundOpensLater: false }],
        ['kayitli durum goruntusu yok', () => order({ status: 'FAILED', state: null }), { phase: 'problem', refundable: false, refundOpensLater: false }],
        ['imzaci kaynak hesap degil', () => order({ status: 'FAILED', state: failedState({ expirationUnix: nowSec() + 3600, signer: '0x' + '77'.repeat(20) }) }), { refundable: false, refundOpensLater: false }],
        ['iadesi zaten gonderilmis', () => order({ status: 'FAILED', refundTxHash: '0x' + 'ab'.repeat(32), refundConfirmed: true, state: failedState({ expirationUnix: nowSec() + 3600 }) }), { phase: 'refunded', refundable: false, refundOpensLater: false }],
        ['72 saati asan siparis (ufukla kapandi)', () => order({ status: 'AWAITING_DEPOSIT', createdAt: Date.now() - 73 * 3600 * 1000, state: null }), { phase: 'problem', refundable: false, refundOpensLater: false }],
    ])('liste refundOpensLater: %s', async (_ad, make, expected) => {
        await boot({ orders: [make()] })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders[0]).toMatchObject(expected)
    })

    it('iade uygunsa (taze durum) refundable true', async () => {
        await boot({ orders: [order({ status: 'FAILED', state: failedState() })] })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders[0]).toMatchObject({ phase: 'problem', refundable: true })
        expect(getOrderMock).not.toHaveBeenCalled() // FAILED terminal: yoklanmaz
    })

    it('kilitli cuzdanda da calisir (anahtar gerekmez)', async () => {
        await boot({ unlocked: false })
        getOrderMock.mockResolvedValueOnce({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        const res = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(res.success).toBe(true)
        expect(res.orders).toHaveLength(1)
    })

    it('normal modda PRIVACY_MODE_OFF ve sunucuya gidilmez', async () => {
        await boot({ active: A })
        expect(await bg.call({ type: 'PRIVATE_ORDERS' })).toEqual({ success: false, error: 'PRIVACY_MODE_OFF' })
        expect(getOrderMock).not.toHaveBeenCalled()
    })

    it('bayrak kapaliyken PRIVACY_DISABLED, sunucuya gidilmez', async () => {
        await boot({ privacyFlag: 'false' })
        expect(await bg.call({ type: 'PRIVATE_ORDERS' })).toEqual({ success: false, error: 'PRIVACY_DISABLED' })
        expect(getOrderMock).not.toHaveBeenCalled()
    })

    it('web sayfasi kokeni iki bicimde de reddedilir', async () => {
        await boot()
        const expected = { error: { code: 4100, message: 'Unauthorized' } }
        for (const type of ['PRIVATE_ORDERS', 'PRIVATE_REFUND']) {
            expect(await bg.call({ type, message: { ticket: T } }, SAYFA)).toEqual(expected)
            expect(await bg.call({ method: type, params: [{ ticket: T }] }, SAYFA)).toEqual(expected)
        }
        expect(getOrderMock).not.toHaveBeenCalled()
        expect(refundMock).not.toHaveBeenCalled()
    })
})

// Islem turu ve yonu (orderKind.js, arka plan satira koyar): Gonder / Para yukle / Takas / Kopru, kayittaki adreslerden ve kasadaki kayitli
// Gizli Hesap'tan. Okunamayan veri null verir (arayuz eski karti cizer). Ad YALNIZ kullanicinin kendi hesaplarindan gelir.
describe('PRIVATE_ORDERS islem turu (kind)', () => {
    const YABANCI = '0x' + '77'.repeat(20)
    // Gizli Hesap'tan Gonder'in kaynagi Gizli Hesap'tir; Para yukle'ninki normal hesap (Hesap 1).
    const dest = (chainId) => ({ chainId, asset: 'USDC', decimals: 6, expectedDestAmount: '14787310', minDestAmount: '1', quoteUsd: null })
    const sade = (ticket, over) => order({ ticket, ...over })
    // Surum 2 kayit: teslim agi SECIMDEN (summary.dest.chainId); kaynak varlik/zincir summary.sourceInput'tan.
    const v2 = (ticket, { sourceKey, output, sourceChainId = 56, deliveryChainId = 56, sourceAsset = 'USDC' }, over) => order({
        ticket, sourceAccountKey: sourceKey, outputAddress: output, sourceChainId, deliveryVersion: 2,
        summary: { payoutUsdc: '14.85', sourceInput: { amount: '14850000', asset: sourceAsset, decimals: 6, chainId: sourceChainId }, dest: dest(deliveryChainId) },
        ...over,
    })
    // B (Hesap 2) kasada NORMAL bir hesap olarak durur; kendi hesabi olmayan adresler (YABANCI) kasada yoktur.
    const kasaB = () => { const v = structuredClone(vault); v.accounts.push(B); return [v] }
    const satirlar = async (orders, opts = {}) => {
        await boot({ orders, vaults: kasaB(), ...opts })
        getOrderMock.mockResolvedValue({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        const { orders: rows } = await bg.call({ type: 'PRIVATE_ORDERS' })
        return (ticket) => rows.find((r) => r.ticket === ticket)
    }

    it('Gonder: cikti Gizli Hesap degilse tur send; alici kendi hesabiysa adi, yabanci adrese ad YOK', async () => {
        const row = await satirlar([
            v2('0xkendi', { sourceKey: GIZLI.key, output: B.address }),
            v2('0xyabanci', { sourceKey: GIZLI.key, output: YABANCI }),
        ])
        expect(row('0xkendi')).toMatchObject({ kind: 'send', sourceAsset: 'USDC', counterpartName: 'Hesap 2', counterpartAddress: B.address, outputAddress: B.address })
        expect(row('0xyabanci')).toMatchObject({ kind: 'send', counterpartName: null, counterpartAddress: YABANCI })
        // Yabanci satirda hicbir hesap adi (Gizli Hesap'inki dahil) sizmaz.
        expect(JSON.stringify(row('0xyabanci'))).not.toMatch(/Hesap/)
    })

    it('Gonder: adres harf boyutu ve 0x oneki duyarsiz eslesir (alici adi bulunur, Gizli Hesap adresi send sayilmaz)', async () => {
        const kucuk = B.address.toLowerCase()
        const buyuk = '0x' + B.address.slice(2).toUpperCase()
        const oneksiz = B.address.slice(2)
        const row = await satirlar([
            v2('0xkucuk', { sourceKey: GIZLI.key, output: kucuk }),
            v2('0xbuyuk', { sourceKey: GIZLI.key, output: buyuk }),
            v2('0xoneksiz', { sourceKey: GIZLI.key, output: oneksiz }),
        ])
        for (const t of ['0xkucuk', '0xbuyuk', '0xoneksiz']) expect(row(t), t).toMatchObject({ kind: 'send', counterpartName: 'Hesap 2' })
    })

    it('Para yukle: cikti Gizli Hesap, kaynak normal hesap -> tur fund; karsi taraf kaynak hesabin adi ve adresi (harf boyutu duyarsiz)', async () => {
        const row = await satirlar([
            v2('0xfund', { sourceKey: A.key, output: GIZLI.address }),
            v2('0xfundkucuk', { sourceKey: A.key, output: GIZLI.address.toLowerCase() }),
            v2('0xfundbuyuk', { sourceKey: B.key, output: '0X' + GIZLI.address.slice(2).toUpperCase() }),
        ])
        expect(row('0xfund')).toMatchObject({ kind: 'fund', sourceAsset: 'USDC', counterpartName: 'Hesap 1', counterpartAddress: A.address })
        expect(row('0xfundkucuk')).toMatchObject({ kind: 'fund', counterpartName: 'Hesap 1' })
        expect(row('0xfundbuyuk')).toMatchObject({ kind: 'fund', counterpartName: 'Hesap 2', counterpartAddress: B.address })
    })

    it('Takas: kaynak ve cikti Gizli Hesap, kaynak zinciri = teslim zinciri -> swap; Kopru: zincirler farkli -> bridge; karsi taraf yok', async () => {
        const row = await satirlar([
            v2('0xswap', { sourceKey: GIZLI.key, output: GIZLI.address.toLowerCase(), sourceChainId: 56, deliveryChainId: 56, sourceAsset: 'USDT' }),
            v2('0xbridge', { sourceKey: GIZLI.key, output: GIZLI.address, sourceChainId: 1, deliveryChainId: 8453, sourceAsset: 'ETH' }),
            v2('0xbridge56', { sourceKey: GIZLI.key, output: GIZLI.address, sourceChainId: 8453, deliveryChainId: 56 }),
        ])
        expect(row('0xswap')).toMatchObject({ kind: 'swap', sourceAsset: 'USDT', counterpartName: null, counterpartAddress: null, sourceChainId: 56, deliveryChainId: 56 })
        expect(row('0xbridge')).toMatchObject({ kind: 'bridge', sourceAsset: 'ETH', counterpartName: null, counterpartAddress: null, sourceChainId: 1, deliveryChainId: 8453 })
        expect(row('0xbridge56')).toMatchObject({ kind: 'bridge', sourceChainId: 8453, deliveryChainId: 56 })
    })

    it('eski kayit (surumsuz, sourceInput yok): tur adreslerden turetilir, kaynak varlik null', async () => {
        const row = await satirlar([
            sade('0xeskisend', { sourceAccountKey: GIZLI.key, outputAddress: YABANCI }),
            sade('0xeskifund', { sourceAccountKey: A.key, outputAddress: GIZLI.address }),
            sade('0xeskiswap', { sourceAccountKey: GIZLI.key, outputAddress: GIZLI.address }),
        ])
        expect(row('0xeskisend')).toMatchObject({ kind: 'send', sourceAsset: null, counterpartName: null })
        expect(row('0xeskifund')).toMatchObject({ kind: 'fund', sourceAsset: null, counterpartName: 'Hesap 1' })
        // Eski kaydin teslim agi acik eski-kayit yoluyla 56'dir: 56 kaynakli kendine teslim swap sayilir.
        expect(row('0xeskiswap')).toMatchObject({ kind: 'swap', deliveryChainId: 56, sourceChainId: 56 })
    })

    it('okunamayan veri null verir: eksik ya da bozuk cikti adresi, kaynak hesap kasada yok, zincir okunamiyor; satir yine listelenir', async () => {
        const kendine = { sourceKey: GIZLI.key, output: GIZLI.address }
        const row = await satirlar([
            v2('0xciktisiz', { sourceKey: GIZLI.key, output: undefined }),
            v2('0xbozuk', { sourceKey: GIZLI.key, output: '0xabc' }),
            v2('0xmetin', { sourceKey: GIZLI.key, output: 'bir adres degil' }),
            v2('0xkaynaksiz', { sourceKey: 'silinmis-hesap', output: GIZLI.address }),
            v2('0xanahtarsiz', { sourceKey: undefined, output: GIZLI.address }),
            v2('0xtesliman', { ...kendine, deliveryChainId: 99999 }),
            v2('0xkaynakzincir', { ...kendine, sourceChainId: 'abc' }),
            sade('0xyenisurum', { sourceAccountKey: GIZLI.key, outputAddress: GIZLI.address, deliveryVersion: 3 }),
        ])
        for (const t of ['0xciktisiz', '0xbozuk', '0xmetin', '0xkaynaksiz', '0xanahtarsiz', '0xtesliman', '0xkaynakzincir', '0xyenisurum']) {
            expect(row(t), t).toMatchObject({ ticket: t, phase: 'processing', kind: null, counterpartName: null, counterpartAddress: null })
        }
    })

    it('kasada kayitli Gizli Hesap yoksa tur ayirt edilemez: hicbir satir kind tasimaz (send dahil), ad sizmaz', async () => {
        const kasa = structuredClone(vault)
        kasa.accounts.push(B)
        delete kasa.privateAccount
        const row = await satirlar([
            v2('0xa', { sourceKey: GIZLI.key, output: B.address }),
            v2('0xb', { sourceKey: A.key, output: GIZLI.address }),
        ], { vaults: [kasa] })
        for (const t of ['0xa', '0xb']) expect(row(t), t).toMatchObject({ kind: null, counterpartName: null, counterpartAddress: null })
    })

    it('kaynak varlik yalniz kayittaki ozetten (sourceInput.asset) gelir; bozuk deger null', async () => {
        const row = await satirlar([
            v2('0xusdt', { sourceKey: A.key, output: GIZLI.address, sourceAsset: 'USDT' }),
            v2('0xbozukvarlik', { sourceKey: A.key, output: GIZLI.address, sourceAsset: '<b>x</b>' }),
            v2('0xbosvarlik', { sourceKey: A.key, output: GIZLI.address, sourceAsset: '' }),
        ])
        expect(row('0xusdt').sourceAsset).toBe('USDT')
        expect(row('0xbozukvarlik')).toMatchObject({ sourceAsset: null, kind: 'fund' })
        expect(row('0xbosvarlik')).toMatchObject({ sourceAsset: null, kind: 'fund' })
    })
})

describe('alarm ve rozet', () => {
    it('acik siparis kalmayinca alarm temizlenir ve rozet bosalir', async () => {
        await boot()
        getOrderMock.mockResolvedValueOnce({ status: 'COMPLETED', recipients: [] })
        await fireAlarm()
        expect(chrome.alarms.clear).toHaveBeenCalledWith('private_orders')
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
    })

    it('acik siparis surerse rozet sayiyi gosterir, alarm temizlenmez', async () => {
        await boot()
        getOrderMock.mockResolvedValueOnce({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        await fireAlarm()
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
        expect(chrome.alarms.clear).not.toHaveBeenCalledWith('private_orders')
    })

    it('acik siparis surerken alarm yeniden kurulur (get-sonra-create), mevcutsa kurulmaz', async () => {
        await boot()
        getOrderMock.mockResolvedValue({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        await fireAlarm()
        expect(chrome.alarms.create).toHaveBeenCalledWith('private_orders', { periodInMinutes: 1 })
        chrome.alarms.create.mockClear()
        chrome.alarms.get.mockResolvedValue({ name: 'private_orders' })
        await fireAlarm()
        expect(chrome.alarms.create).not.toHaveBeenCalled()
    })

    it('tanimsiz alarm adi hicbir sey yapmaz', async () => {
        await boot()
        await fireAlarm('baska_alarm')
        expect(getOrderMock).not.toHaveBeenCalled()
        expect(chrome.alarms.clear).not.toHaveBeenCalledWith('private_orders')
    })

    it('alarm ile PRIVATE_ORDERS ayni anda gelirse sunucuya TEK getOrder gider', async () => {
        await boot()
        let release
        getOrderMock.mockImplementation(() => new Promise((r) => { release = () => r({ status: 'OPEN', recipients: [{ status: 'PENDING' }] }) }))
        const a = fireAlarm()
        const b = bg.call({ type: 'PRIVATE_ORDERS' })
        await flush()
        release()
        await Promise.all([a, b])
        expect(getOrderMock).toHaveBeenCalledTimes(1)
    })

    it('yoklama hatasi alarmi dusurmez, kayit oldugu gibi kalir', async () => {
        await boot()
        getOrderMock.mockRejectedValueOnce(new Error('ag'))
        await expect(fireAlarm()).resolves.toBeUndefined()
        expect(bg.localStore.private_orders[0].status).toBe('AWAITING_DEPOSIT')
    })

    // T8-M7: takili getOrder pollInFlight'i sonsuza dek tutmaz.
    it('takili getOrder 20 sn sonra birakilir ve sonraki yoklama yeniden sunucuya gider', async () => {
        await boot()
        getOrderMock.mockImplementation(() => new Promise(() => {}))
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            const p = bg.call({ type: 'PRIVATE_ORDERS' })
            await flush()
            await vi.advanceTimersByTimeAsync(20001)
            const res = await p
            expect(res.success).toBe(true)
            expect(res.orders).toHaveLength(1)
            const p2 = bg.call({ type: 'PRIVATE_ORDERS' })
            await flush()
            await vi.advanceTimersByTimeAsync(20001)
            await p2
        } finally {
            vi.useRealTimers()
        }
        expect(getOrderMock).toHaveBeenCalledTimes(2)
        expect(bg.localStore.private_orders[0].status).toBe('AWAITING_DEPOSIT')
    })

    it('bayrak kapaliyken alarm gelse de sunucuya ve siparis deposuna gidilmez, artik alarm temizlenir', async () => {
        await boot({ privacyFlag: 'false' })
        bg.chrome.storage.local.get.mockClear()
        await fireAlarm()
        expect(getOrderMock).not.toHaveBeenCalled()
        expect(bg.chrome.storage.local.get.mock.calls.some((c) => c[0] === 'private_orders')).toBe(false)
        expect(chrome.alarms.create).not.toHaveBeenCalledWith('private_orders', expect.anything())
        expect(chrome.alarms.clear).toHaveBeenCalledWith('private_orders')
        expect(chrome.action.setBadgeText).not.toHaveBeenCalled()
    })

    it('alarms.get reddederse (alarm kurma) yoklama atmaz ve rozet yine yazilir', async () => {
        await boot()
        getOrderMock.mockResolvedValue({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        chrome.alarms.get.mockRejectedValue(new Error('alarms yok'))
        await expect(fireAlarm()).resolves.toBeUndefined()
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
        expect(chrome.alarms.create).not.toHaveBeenCalled()
    })
})

describe('P2-ALARM-REARM: servis calisani acilisi', () => {
    const bootFresh = async (orders, flag, unlocked = true) => {
        getOrderMock.mockReset()
        bg = await bootBackground({
            privacyFlag: flag,
            localStore: { active_account: GIZLI, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {}, private_orders: orders },
            sessionStore: unlocked ? { sessionMasterKeyJwk: jwk } : {},
        })
        await flush()
    }
    const privateCalls = (spy) => spy.mock.calls.filter((c) => c[0] === 'private_orders')

    it('acik siparis varsa acilista alarm kurulur ve rozet gosterilir, sunucuya gidilmez', async () => {
        await bootFresh([order()])
        expect(bg.chrome.alarms.create).toHaveBeenCalledWith('private_orders', { periodInMinutes: 1 })
        expect(bg.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
        expect(getOrderMock).not.toHaveBeenCalled()
    })

    it('acik siparis yoksa (bos ya da yalniz tamamlanmis) alarm.get/create hic cagrilmaz', async () => {
        await bootFresh([])
        expect(privateCalls(bg.chrome.alarms.get)).toHaveLength(0)
        expect(privateCalls(bg.chrome.alarms.create)).toHaveLength(0)
        await bootFresh([order({ status: 'COMPLETED' })])
        expect(privateCalls(bg.chrome.alarms.get)).toHaveLength(0)
        expect(privateCalls(bg.chrome.alarms.create)).toHaveLength(0)
    })

    it('bayrak kapaliyken eski acik siparis alarm kurmaz', async () => {
        await bootFresh([order()], 'false')
        expect(privateCalls(bg.chrome.alarms.get)).toHaveLength(0)
        expect(privateCalls(bg.chrome.alarms.create)).toHaveLength(0)
    })

    // T21 M3: acilista acik siparis olmasa da bekleyen iade makbuzu uzlastirilir ve iade rozeti alarmi kurulur.
    describe('acik siparis yokken acilis (T21 M3)', () => {
        const REFUND_HASH = '0x' + 'ab'.repeat(32)
        const pendingRefund = (over = {}) => order({ status: 'FAILED', state: failedState(), refundTxHash: REFUND_HASH, refundConfirmed: false, ...over })
        const badgeCalls = () => bg.chrome.alarms.create.mock.calls.filter((c) => c[0] === 'private_orders_badge')

        it('bekleyen iade makbuzu acilista sorgulanir ve kayda islenir; yoklama alarmi kurulmaz, sunucuya gidilmez', async () => {
            const receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockResolvedValue({ status: 1 })
            await bootFresh([pendingRefund()])
            expect(receiptSpy).toHaveBeenCalledWith(REFUND_HASH)
            expect(bg.localStore.private_orders[0]).toMatchObject({ refundTxHash: REFUND_HASH, refundConfirmed: true })
            expect(privateCalls(bg.chrome.alarms.create)).toHaveLength(0)
            expect(getOrderMock).not.toHaveBeenCalled()
        })

        it('status 0 makbuzu acilista iadeyi temizler ve rozet Iade ile sayar', async () => {
            vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockResolvedValue({ status: 0 })
            await bootFresh([pendingRefund()])
            expect(bg.localStore.private_orders[0]).toMatchObject({ refundTxHash: null, refundFailed: true })
            expect(bg.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
        })

        it('onStartup da ayni yolu kullanir', async () => {
            await bootFresh([pendingRefund()])
            const receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockResolvedValue({ status: 1 })
            await Promise.allSettled(bg.listeners.onStartup.map((fn) => fn()))
            await flush()
            expect(receiptSpy).toHaveBeenCalledTimes(1)
        })

        it('suresi ILERIDE olan FAILED siparis icin acilista tek seferlik rozet alarmi kurulur', async () => {
            const exp = nowSec() + 3600
            await bootFresh([order({ status: 'FAILED', state: failedState({ expirationUnix: exp }) })])
            expect(badgeCalls()).toEqual([['private_orders_badge', { when: exp * 1000 + 60000 }]])
            expect(privateCalls(bg.chrome.alarms.create)).toHaveLength(0)
        })

        it('acik siparis varsa rozet alarmi kurulmaz (yoklama alarmi suruyor)', async () => {
            await bootFresh([order(), order({ ticket: '0x' + '02'.repeat(32), status: 'FAILED', state: failedState({ expirationUnix: nowSec() + 3600 }) })])
            expect(badgeCalls()).toEqual([])
        })

        it('bayrak kapaliyken makbuz sorgulanmaz ve alarm kurulmaz', async () => {
            const receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockResolvedValue({ status: 1 })
            await bootFresh([pendingRefund(), order({ ticket: '0x' + '02'.repeat(32), status: 'FAILED', state: failedState({ expirationUnix: nowSec() + 3600 }) })], 'false')
            expect(receiptSpy).not.toHaveBeenCalled()
            expect(badgeCalls()).toEqual([])
        })
    })

    it('onStartup: alarm yoksa kurulur, varsa kurulmaz', async () => {
        await bootFresh([order()])
        bg.chrome.alarms.create.mockClear()
        bg.chrome.alarms.get.mockResolvedValue({ name: 'private_orders' })
        await Promise.allSettled(bg.listeners.onStartup.map((fn) => fn()))
        await flush()
        expect(privateCalls(bg.chrome.alarms.create)).toHaveLength(0)

        bg.chrome.alarms.get.mockResolvedValue(undefined)
        await Promise.allSettled(bg.listeners.onStartup.map((fn) => fn()))
        await flush()
        expect(bg.chrome.alarms.create).toHaveBeenCalledWith('private_orders', { periodInMinutes: 1 })
    })

    it('depo get tanimsizsa acilis atmaz ve alarm kurulmaz', async () => {
        getOrderMock.mockReset()
        bg = await bootBackground({ localStore: { active_account: GIZLI, vaults: [structuredClone(vault)] }, storageLocalGet: false })
        await flush()
        expect(privateCalls(bg.chrome.alarms.create ?? { mock: { calls: [] } })).toHaveLength(0)
    })

    // T8 M5: depo OKUMASI reddedilince (get reject) rearm'in catch'i calisir; acilis atmaz, alarm kurulmaz.
    it('depo okumasi reddedilirse acilis atmaz, hata loglanir, alarm ve rozet kurulmaz', async () => {
        getOrderMock.mockReset()
        bg = await bootBackground({
            localStore: { active_account: GIZLI, vaults: [structuredClone(vault)], private_orders: [order()] },
            sessionStore: { sessionMasterKeyJwk: jwk },
        })
        await flush()
        bg.chrome.alarms.create.mockClear()
        bg.chrome.action.setBadgeText.mockClear()
        console.error.mockClear()
        const realGet = bg.chrome.storage.local.get.getMockImplementation()
        bg.chrome.storage.local.get.mockImplementation(async (keys) => {
            if (keys === 'private_orders') throw new Error('depo okunamadi')
            return realGet(keys)
        })
        await Promise.allSettled(bg.listeners.onStartup.map((fn) => fn()))
        await flush()
        expect(console.error).toHaveBeenCalledWith('[private] siparis alarmi yeniden kurulamadi:', expect.any(Error))
        expect(privateCalls(bg.chrome.alarms.create)).toHaveLength(0)
        expect(bg.chrome.action.setBadgeText).not.toHaveBeenCalled()
    })

    it('kilitli cuzdanda acilis alarmi kurar ama rozet bos kalir (A:M-3)', async () => {
        await bootFresh([order()], undefined, false)
        expect(bg.chrome.alarms.create).toHaveBeenCalledWith('private_orders', { periodInMinutes: 1 })
        expect(bg.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
    })

    // A:M-5: bayrak kapaliyken siparis deposuna hic dokunulmaz, alarm ve rozet cagrisi olmaz.
    it('bayrak kapaliyken acilista private_orders okunmaz, alarm ve rozet cagrilmaz', async () => {
        await bootFresh([order()], 'false')
        expect(bg.chrome.storage.local.get.mock.calls.some((c) => c[0] === 'private_orders')).toBe(false)
        expect(privateCalls(bg.chrome.alarms.get)).toHaveLength(0)
        expect(privateCalls(bg.chrome.alarms.create)).toHaveLength(0)
        expect(bg.chrome.action.setBadgeText).not.toHaveBeenCalled()
        expect(bg.chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalled()
    })
})

// T16 M5: iade uygunlugu zamanla dogar; yoklama alarmi kapaninca sure dolunca rozeti yenileyen tek seferlik alarm.
describe('iade rozeti icin tek seferlik alarm (T16 M5)', () => {
    const BADGE_ALARM = 'private_orders_badge'
    const badgeAlarmCalls = () => chrome.alarms.create.mock.calls.filter(([n]) => n === BADGE_ALARM)
    const futureExp = () => nowSec() + 3600

    it('acik siparis kalmayinca, suresi ILERIDE olan FAILED siparis icin sure + 60 sn sonraya kendi adli alarm kurulur', async () => {
        const exp = futureExp()
        await boot({ orders: [order({ status: 'FAILED', state: failedState({ expirationUnix: exp }) })] })
        await fireAlarm()
        expect(chrome.alarms.clear).toHaveBeenCalledWith('private_orders')
        expect(badgeAlarmCalls()).toEqual([[BADGE_ALARM, { when: exp * 1000 + 60000 }]])
    })

    it('birden cok siparis: en yakin sure secilir', async () => {
        const T2 = '0x' + '02'.repeat(32)
        const near = nowSec() + 600
        await boot({ orders: [
            order({ status: 'FAILED', state: failedState({ expirationUnix: futureExp() }) }),
            order({ ticket: T2, status: 'FAILED', state: failedState({ expirationUnix: near }) }),
        ] })
        await fireAlarm()
        expect(badgeAlarmCalls()).toEqual([[BADGE_ALARM, { when: near * 1000 + 60000 }]])
    })

    it.each([
        ['sure zaten gecmis (rozet zaten sayiyor)', () => order({ status: 'FAILED', state: failedState({ expirationUnix: nowSec() - 10 }) })],
        ['iadesi gonderilmis', () => order({ status: 'FAILED', state: failedState({ expirationUnix: futureExp() }), refundTxHash: '0xr' })],
        ['FAILED degil (COMPLETED)', () => order({ status: 'COMPLETED', state: failedState({ status: 'COMPLETED', expirationUnix: futureExp() }) })],
        ['durum goruntusu yok', () => order({ status: 'FAILED', state: null })],
    ])('kurulmaz: %s', async (_ad, make) => {
        await boot({ orders: [make()] })
        await fireAlarm()
        expect(badgeAlarmCalls()).toEqual([])
    })

    it('acik siparis surerken (yoklama alarmi suruyor) rozet alarmi kurulmaz', async () => {
        await boot({ orders: [order({ ticket: '0x' + '02'.repeat(32), status: 'OPEN', state: failedState({ status: 'OPEN' }) }), order({ status: 'FAILED', state: failedState({ expirationUnix: futureExp() }) })] })
        getOrderMock.mockResolvedValue({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        await fireAlarm()
        expect(badgeAlarmCalls()).toEqual([])
    })

    it('alarm tetiklenince rozet yenilenir: sure dolmus siparis rozete sayilir (gizli mod, kilit acik)', async () => {
        await boot({ orders: [order({ status: 'FAILED', state: failedState({ expirationUnix: nowSec() - 10 }) })] })
        await fireAlarm(BADGE_ALARM)
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
        // Sunucuya gidilmez.
        expect(getOrderMock).not.toHaveBeenCalled()
    })

    it('alarm tetiklenince bir sonraki siparis icin yeniden kurulur', async () => {
        const next = nowSec() + 900
        await boot({ orders: [order({ status: 'FAILED', state: failedState({ expirationUnix: nowSec() - 10 }) }), order({ ticket: '0x' + '02'.repeat(32), status: 'FAILED', state: failedState({ expirationUnix: next }) })] })
        await fireAlarm(BADGE_ALARM)
        expect(badgeAlarmCalls()).toEqual([[BADGE_ALARM, { when: next * 1000 + 60000 }]])
    })

    it('mod ve kilit farkindadir: normal modda ya da kilitliyken rozet bos kalir', async () => {
        await boot({ active: A, orders: [order({ status: 'FAILED', state: failedState({ expirationUnix: nowSec() - 10 }) })] })
        await fireAlarm(BADGE_ALARM)
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
        await boot({ unlocked: false, orders: [order({ status: 'FAILED', state: failedState({ expirationUnix: nowSec() - 10 }) })] })
        await fireAlarm(BADGE_ALARM)
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
    })

    // T21 M7a: siparisin suresi ILERIDE: bayrak kapisi olmasa alarm kurulurdu. Depo okumasi da olmamali.
    it('bayrak kapaliyken: alarm temizlenir, depo OKUNMAZ, rozete dokunulmaz, alarm kurulmaz', async () => {
        await boot({ privacyFlag: 'false', orders: [order({ status: 'FAILED', state: failedState({ expirationUnix: futureExp() }) })] })
        chrome.storage.local.get.mockClear()
        await fireAlarm(BADGE_ALARM)
        expect(chrome.alarms.clear).toHaveBeenCalledWith(BADGE_ALARM)
        expect(chrome.storage.local.get).not.toHaveBeenCalled()
        expect(chrome.action.setBadgeText).not.toHaveBeenCalled()
        expect(badgeAlarmCalls()).toEqual([])
    })

    // T21 M4 -> T24 M1-m6 (denetci karari): uygunluk rozetin kendi kuralindan turer (refundEligibility +
    // isPrivateOrderRefundable). Yatirmasi basarisiz siparis ASLA iade edilebilir degildir (gateway'e hicbir sey
    // ulasmadi): rozet saymaz, bu yuzden alarm da kurulmaz. (T21 M4'te bu test tersini bekliyordu.)
    it('depositFailed isaretli siparis durum goruntusu FAILED+ileri sure olsa da iade edilebilir sayilmaz: alarm kurulmaz', async () => {
        const exp = futureExp()
        await boot({ orders: [order({ status: 'ABORTED', depositFailed: true, state: failedState({ expirationUnix: exp }) })] })
        await fireAlarm()
        expect(badgeAlarmCalls()).toEqual([])
    })

    it('depositFailed + SURESI DOLMUS FAILED durum: rozette sayilmaz, listede refundable false, Iade reddedilir', async () => {
        await boot({ orders: [order({ status: 'ABORTED', depositFailed: true, state: failedState() })] })
        await fireAlarm()
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
        getOrderMock.mockResolvedValue(failedState())
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders[0]).toMatchObject({ depositFailed: true, refundable: false })
    })

    it.each([
        ['imzaci kaynak hesap degil (rozet sayamaz)', () => failedState({ expirationUnix: futureExp(), signer: '0x' + '77'.repeat(20) })],
        ['alicilardan biri yolda (recipient-in-flight)', () => failedState({ expirationUnix: futureExp(), recipients: [{ status: 'FULFILLED', recipientTxHash: '0xp' }] })],
        ['gateway yok', () => failedState({ expirationUnix: futureExp(), gateway: null })],
    ])('rozetin sayamayacagi siparis icin alarm kurulmaz: %s', async (_ad, makeState) => {
        await boot({ orders: [order({ status: 'FAILED', state: makeState() })] })
        await fireAlarm()
        expect(badgeAlarmCalls()).toEqual([])
    })
})

describe('rozet yalniz gizli modda', () => {
    it('normal modda acik siparis olsa da rozet bos, alarm kurulu kalir', async () => {
        await boot({ active: A })
        getOrderMock.mockResolvedValueOnce({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        await fireAlarm()
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
        expect(chrome.alarms.clear).not.toHaveBeenCalledWith('private_orders')
        expect(chrome.alarms.create).toHaveBeenCalledWith('private_orders', { periodInMinutes: 1 })
    })

    it('aktif hesap degisince rozet yeniden hesaplanir', async () => {
        await boot({ active: A })
        const change = async (account) => {
            bg.localStore.active_account = account
            for (const fn of bg.listeners.onChanged) fn({ active_account: { newValue: account } }, 'local')
            await flush()
        }
        await change(GIZLI)
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
        await change(A)
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
    })
})

describe('rozet: bayrak ve yaris (T8-M1, T8-M2)', () => {
    const change = async (account) => {
        bg.localStore.active_account = account
        for (const fn of bg.listeners.onChanged) fn({ active_account: { newValue: account } }, 'local')
        await flush()
    }

    it('bayrak kapaliyken aktif hesap degisince rozete dokunulmaz ve siparis deposu okunmaz', async () => {
        await boot({ privacyFlag: 'false', active: A })
        bg.chrome.storage.local.get.mockClear()
        await change(GIZLI)
        await change(A)
        expect(chrome.action.setBadgeText).not.toHaveBeenCalled()
        expect(chrome.storage.local.get.mock.calls.some((c) => c[0] === 'private_orders')).toBe(false)
    })

    it('gizliden normale hizli gecis: son rozet yazimi guncel moda uyar (bayat sayi kalmaz)', async () => {
        await boot({ active: A })
        // Gizli moda gecis okumasi (private_orders) takili kalirken kullanici normal moda doner.
        const realGet = chrome.storage.local.get.getMockImplementation()
        let release
        const gate = new Promise((r) => { release = r })
        chrome.storage.local.get.mockImplementation(async (keys) => {
            if (keys === 'private_orders') await gate
            return realGet(keys)
        })
        await change(GIZLI)
        await change(A)
        release()
        await flush()
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
    })
})

describe('PRIVATE_REFUND', () => {
    const refund = (extra = {}) => bg.call({ type: 'PRIVATE_REFUND', message: { ticket: T, ...extra } })

    it('taze durum uygun degilse PRIVATE_REFUND_NOT_ALLOWED ve islem gonderilmez', async () => {
        await boot({ orders: [order({ status: 'FAILED' })] })
        getOrderMock.mockResolvedValueOnce(failedState({ expirationUnix: nowSec() + 3600 }))
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
        expect(refundMock).not.toHaveBeenCalled()
        expect(bg.localStore.private_orders[0].refundTxHash).toBeNull()
    })

    it('basari: KAYNAK hesaptan, taze getOrder gateway adresine gonderilir; mesaj alanlari yok sayilir', async () => {
        await boot({ orders: [order({ status: 'FAILED' })] })
        getOrderMock.mockResolvedValueOnce(failedState())
        refundMock.mockResolvedValue({ hash: '0xrefund', wait: async () => ({ status: 1 }) })
        const res = await refund({ gateway: '0xevil', to: '0xevil', wallet: 'x' })
        expect(res).toEqual({ success: true, hash: '0xrefund' })

        expect(refundMock).toHaveBeenCalledTimes(1)
        const args = refundMock.mock.calls[0][0]
        expect(args.gateway).toBe(GATEWAY)
        expect(args.ticket).toBe(T)
        expect(args.wallet.address).toBe(A.address)
        expect(getOrderMock).toHaveBeenCalledWith({ id: T, privacy: true, accessToken: 'tok' })

        expect(bg.localStore.private_orders[0]).toMatchObject({ ticket: T, refundTxHash: '0xrefund' })
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
        expect(() => JSON.stringify(bg.localStore.private_orders)).not.toThrow()
    })

    it('Base teslimli siparis (surum 2): iade gateway zincirinde (56) imzalanir, teslim agi RPC si kurulmaz', async () => {
        await boot({ orders: [order({ status: 'FAILED', deliveryVersion: 2, summary: { payoutUsdc: '14.85', dest: BASE_DEST } })] })
        getOrderMock.mockResolvedValueOnce(failedState())
        refundMock.mockResolvedValue({ hash: '0xrefund', wait: async () => ({ status: 1 }) })
        expect(await refund()).toEqual({ success: true, hash: '0xrefund' })
        const args = refundMock.mock.calls[0][0]
        expect(args.gateway).toBe(GATEWAY)
        expect(args.wallet.provider._getConnection().url).toBe(BSC_RPC)
    })

    it('imzaci siparisin imzacisi degilse NOT_ALLOWED, islem gonderilmez', async () => {
        await boot({ orders: [order({ status: 'FAILED' })] })
        getOrderMock.mockResolvedValueOnce(failedState({ signer: B.address }))
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
        expect(refundMock).not.toHaveBeenCalled()
    })

    it('normal modda PRIVACY_MODE_OFF, ne getOrder ne iade cagrilir', async () => {
        await boot({ active: A, orders: [order({ status: 'FAILED' })] })
        expect(await refund()).toEqual({ success: false, error: 'PRIVACY_MODE_OFF' })
        expect(getOrderMock).not.toHaveBeenCalled()
        expect(refundMock).not.toHaveBeenCalled()
    })

    it('bayrak kapaliyken PRIVACY_DISABLED, islem gonderilmez', async () => {
        await boot({ privacyFlag: 'false', orders: [order({ status: 'FAILED' })] })
        expect(await refund()).toEqual({ success: false, error: 'PRIVACY_DISABLED' })
        expect(getOrderMock).not.toHaveBeenCalled()
        expect(refundMock).not.toHaveBeenCalled()
    })

    it('kilitli cuzdanda WALLET_LOCKED, islem gonderilmez', async () => {
        await boot({ unlocked: false, orders: [order({ status: 'FAILED' })] })
        getOrderMock.mockResolvedValueOnce(failedState())
        expect(await refund()).toEqual({ success: false, error: 'WALLET_LOCKED' })
        expect(refundMock).not.toHaveBeenCalled()
    })

    it('bilinmeyen ticket PRIVATE_UNSUPPORTED', async () => {
        await boot()
        expect(await bg.call({ type: 'PRIVATE_REFUND', message: { ticket: '0xyok' } })).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(getOrderMock).not.toHaveBeenCalled()
        expect(refundMock).not.toHaveBeenCalled()
    })

    it('kaynak hesap kasada yoksa PRIVATE_UNSUPPORTED', async () => {
        await boot({ orders: [order({ status: 'FAILED', sourceAccountKey: 'yok' })] })
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(refundMock).not.toHaveBeenCalled()
    })

    it('iade kaydi olan siparis tekrar iade edilmez (cift iade yok)', async () => {
        await boot({ orders: [order({ status: 'FAILED', refundTxHash: '0xold' })] })
        getOrderMock.mockResolvedValue(failedState())
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
        expect(refundMock).not.toHaveBeenCalled()
    })

    it('ayni anda iki iade cagrisi islem kuyrugunda siralanir, zincire TEK iade gider', async () => {
        await boot({ orders: [order({ status: 'FAILED' })] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 20))
            return { hash: '0xrefund', wait: async () => ({ status: 1 }) }
        })
        const [r1, r2] = await Promise.all([refund(), refund()])
        expect([r1, r2].filter((r) => r.success)).toHaveLength(1)
        expect([r1, r2].find((r) => !r.success)).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
        expect(refundMock).toHaveBeenCalledTimes(1)
    })

    it('iade gonderildikten sonra rozet hatasi basariyi bozmaz', async () => {
        await boot({ orders: [order({ status: 'FAILED' })] })
        getOrderMock.mockResolvedValueOnce(failedState())
        refundMock.mockResolvedValue({ hash: '0xrefund', wait: async () => ({ status: 1 }) })
        chrome.action.setBadgeText.mockImplementation(() => { throw new Error('boom') })
        expect(await refund()).toEqual({ success: true, hash: '0xrefund' })
    })

    // T8 M9: iade yalniz native gazla gider; gaz yoksa genel hata degil gaz uyarisi cikar.
    it('gaz yetmezligi PRIVATE_INSUFFICIENT_GAS, kayit degismez', async () => {
        await boot({ orders: [order({ status: 'FAILED' })] })
        getOrderMock.mockResolvedValueOnce(failedState())
        refundMock.mockRejectedValue(new Error('insufficient funds'))
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_INSUFFICIENT_GAS' })
        expect(bg.localStore.private_orders[0].refundTxHash).toBeNull()
    })

    it('baska gonderim hatasi PRIVATE_FAILED, kayit degismez', async () => {
        await boot({ orders: [order({ status: 'FAILED' })] })
        getOrderMock.mockResolvedValueOnce(failedState())
        refundMock.mockRejectedValue(new Error('nonce too low'))
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        expect(bg.localStore.private_orders[0].refundTxHash).toBeNull()
    })

    // I1: iade sonrasi liste bayat on-iade durumundan "iade edilebilir" demeye devam etmez.
    it('basarili iadeden sonra PRIVATE_ORDERS phase refunded ve refundable false doner', async () => {
        await boot({ orders: [order({ status: 'FAILED', state: failedState() })] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockResolvedValue({ hash: '0xrefund', wait: async () => ({ status: 1 }) })
        expect(await refund()).toEqual({ success: true, hash: '0xrefund' })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders[0]).toMatchObject({ ticket: T, phase: 'refunded', refundable: false })
    })

    // T8-M3: iade zincirde, kayit yazimi bir kez yeniden denenir; yine olmazsa bellekte isaretlenir.
    const failWrites = (times) => {
        const realSet = chrome.storage.local.set.getMockImplementation()
        let left = times
        chrome.storage.local.set.mockImplementation(async (obj) => {
            if ('private_orders' in obj && left > 0) { left--; throw new Error('depo yazilamadi') }
            return realSet(obj)
        })
    }

    it('kayit yazimi bir kez basarisiz olursa yeniden denenir ve refundTxHash yazilir', async () => {
        await boot({ orders: [order({ status: 'FAILED' })] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockResolvedValue({ hash: '0xrefund', wait: async () => ({ status: 1 }) })
        failWrites(1)
        expect(await refund()).toEqual({ success: true, hash: '0xrefund' })
        expect(bg.localStore.private_orders[0].refundTxHash).toBe('0xrefund')
    })

    // T25 M2-I3: kayit YAYINDAN ONCE yazilir. Iki yazim da basarisizsa hicbir sey yayinlanmaz (cevap
    // PRIVATE_FAILED) ve bellek isareti KONMAZ: yayinlanmamis iade yuzunden siparis kalici iade edilemez kalmaz.
    it('kayit iki yazimda da basarisiz olursa PRIVATE_FAILED: YAYIN YOK, isaret yok, siparis sonra yeniden iade edilebilir', async () => {
        await boot({ orders: [order({ status: 'FAILED' })] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockImplementation(recordingRefund('0xrefund'))
        failWrites(2)
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        expect(broadcastSpy).not.toHaveBeenCalled()
        expect(bg.localStore.private_orders[0].refundTxHash).toBeNull()
        // Depo duzeldi: ayni siparis yeniden iade edilebilir (bellek isareti konmamisti).
        expect(await refund()).toEqual({ success: true, hash: '0xrefund' })
        expect(broadcastSpy).toHaveBeenCalledTimes(1)
        expect(bg.localStore.private_orders[0].refundTxHash).toBe('0xrefund')
    })

    // T8-M7: SDK duz fetch kullanir; takili getOrder iadeyi ve kuyrugu sonsuza dek tutmaz.
    it('takili getOrder zaman asimina ugrar: iade gonderilmez, kuyruk serbest kalir', async () => {
        await boot({ orders: [order({ status: 'FAILED' })] })
        getOrderMock.mockImplementationOnce(() => new Promise(() => {}))
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            const p = refund()
            await flush()
            await vi.advanceTimersByTimeAsync(20001)
            expect(await p).toEqual({ success: false, error: 'PRIVATE_PROVIDER_DOWN' })
        } finally {
            vi.useRealTimers()
        }
        expect(refundMock).not.toHaveBeenCalled()
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockResolvedValue({ hash: '0xrefund', wait: async () => ({ status: 1 }) })
        expect(await refund()).toEqual({ success: true, hash: '0xrefund' })
    })

    it('bayat bir yoklama kayitli refundTxHash degerini silemez', async () => {
        const { upsertOrder } = await import('./utils/privacy/privateOrderStore')
        await boot({ orders: [order({ status: 'FAILED', refundTxHash: '0xrefund' })] })
        await upsertOrder({ ticket: T, refundTxHash: null, status: 'FAILED' })
        expect(bg.localStore.private_orders[0].refundTxHash).toBe('0xrefund')
    })
})

describe('rozet: acik + iade edilebilir, kilit farkindaligi (B:M9, A:M-3)', () => {
    const badgeText = () => chrome.action.setBadgeText.mock.calls.at(-1)?.[0]

    it('FAILED ama iade edilebilir siparis rozete sayilir; iade uygun degilse sayilmaz', async () => {
        await boot({ orders: [order({ status: 'FAILED', state: failedState() })] })
        await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(badgeText()).toEqual({ text: '1' })

        await boot({ orders: [order({ status: 'FAILED', state: failedState({ expirationUnix: nowSec() + 3600 }) })] })
        await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(badgeText()).toEqual({ text: '' })
    })

    it('acik + iade edilebilir ayri siparisler toplanir, ayni siparis iki kez sayilmaz', async () => {
        const T2 = '0x' + '02'.repeat(32)
        const T3 = '0x' + '03'.repeat(32)
        await boot({
            orders: [
                order({ ticket: T, status: 'FAILED', state: failedState() }),
                order({ ticket: T2, status: 'OPEN', state: failedState({ status: 'OPEN' }) }),
                order({ ticket: T3, status: 'COMPLETED' }),
            ],
        })
        getOrderMock.mockResolvedValue({ status: 'OPEN', signer: A.address, gateway: GATEWAY, expirationUnix: nowSec() - 10, recipients: [{ status: 'PENDING' }] })
        await fireAlarm()
        // T2 hem acik hem (suresi dolmus OPEN) iade edilebilir: bir kez sayilir.
        expect(badgeText()).toEqual({ text: '2' })
    })

    it('iadesi gonderilmis (refundTxHash) siparis sayilmaz', async () => {
        await boot({ orders: [order({ status: 'FAILED', state: failedState(), refundTxHash: '0xr' })] })
        await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(badgeText()).toEqual({ text: '' })
    })

    it('kilitlenince rozet bosalir, kilit acilinca yeniden gorunur', async () => {
        await boot()
        getOrderMock.mockResolvedValue({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        await fireAlarm()
        expect(badgeText()).toEqual({ text: '1' })

        expect(await bg.call({ type: 'LOCK' })).toEqual({ success: true })
        // Rozet yenilemesi kilidi BEKLETMEZ (T16 M1): kilit cevabindan sonra arkada biter.
        await flush()
        expect(badgeText()).toEqual({ text: '' })

        expect(await bg.call({ type: 'UNLOCK_WALLET', masterKeyJwk: jwk })).toEqual({ success: true })
        expect(badgeText()).toEqual({ text: '1' })
    })

    // T16 M1: sirlar ve kilit bayragi ONCE, rozet SONRA; takili rozet yenilemesi kilidi geciktirmez/bozmaz.
    it('kilit: oturum anahtari, bundler tokenlari ve session_active ONCE yazilir, rozet SONRA yenilenir', async () => {
        await boot()
        getOrderMock.mockResolvedValue({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        await fireAlarm()
        expect(badgeText()).toEqual({ text: '1' })
        bg.chrome.storage.session.remove.mockClear()
        bg.chrome.storage.local.set.mockClear()
        bg.chrome.action.setBadgeText.mockClear()

        expect(await bg.call({ type: 'LOCK' })).toEqual({ success: true })
        await flush()
        const removeCalls = bg.chrome.storage.session.remove.mock.calls.map((c) => c[0])
        expect(removeCalls).toEqual(['sessionMasterKeyJwk', 'bundlerTokens'])
        const orderOf = (fn, i) => fn.mock.invocationCallOrder[i]
        const lockSetIdx = bg.chrome.storage.local.set.mock.calls.findIndex(([o]) => o?.session_active === false)
        expect(lockSetIdx).toBeGreaterThanOrEqual(0)
        const lastSecretRemove = orderOf(bg.chrome.storage.session.remove, 1)
        const lockSet = orderOf(bg.chrome.storage.local.set, lockSetIdx)
        const badgeWrite = orderOf(bg.chrome.action.setBadgeText, 0)
        expect(lastSecretRemove).toBeLessThan(lockSet)
        expect(lockSet).toBeLessThan(badgeWrite)
        expect(badgeText()).toEqual({ text: '' })
    })

    it('kilit: rozet yenilemesi takilirsa kilit yine de tamamlanir (sirlar silinir, session_active false, cevap gelir)', async () => {
        await boot()
        // Rozetin okudugu mod gorunumu (active_account + vaults + currentNetwork) HIC donmez.
        const realGet = bg.chrome.storage.local.get
        bg.chrome.storage.local.get = vi.fn((keys) => (Array.isArray(keys) && keys.includes('currentNetwork') ? new Promise(() => {}) : realGet(keys)))
        const lockResponse = await bg.call({ type: 'LOCK' })
        expect(lockResponse).toEqual({ success: true })
        expect(bg.sessionStore.sessionMasterKeyJwk).toBeUndefined()
        expect(bg.localStore.session_active).toBe(false)
        expect(bg.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'SESSION_EXPIRED' })
    })

    it('kilitliyken yoklama rozeti bos birakir; bayrak kapaliyken kilit/acma rozete dokunmaz', async () => {
        await boot({ unlocked: false })
        getOrderMock.mockResolvedValue({ status: 'OPEN', recipients: [{ status: 'PENDING' }] })
        await fireAlarm()
        expect(badgeText()).toEqual({ text: '' })

        await boot({ privacyFlag: 'false' })
        await bg.call({ type: 'LOCK' })
        await bg.call({ type: 'UNLOCK_WALLET', masterKeyJwk: jwk })
        expect(chrome.action.setBadgeText).not.toHaveBeenCalled()
    })

    it('normal modda kilit acilsa da rozet bos kalir', async () => {
        await boot({ active: A })
        await bg.call({ type: 'UNLOCK_WALLET', masterKeyJwk: jwk })
        expect(badgeText()).toEqual({ text: '' })
    })
})

describe('liste: 3 sn sinirli yoklama, ufuk, bozuk girdi (A:M-2, A:I-3, B:M5)', () => {
    it('yoklama 3 sn icinde bitmezse liste saklanan goruntuyle doner, yoklama arkada surer', async () => {
        await boot()
        let release
        getOrderMock.mockImplementation(() => new Promise((r) => { release = () => r({ status: 'COMPLETED', recipients: [] }) }))
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        let res
        try {
            const p = bg.call({ type: 'PRIVATE_ORDERS' })
            await flush()
            await vi.advanceTimersByTimeAsync(2999)
            let settled = false
            p.then(() => { settled = true })
            await flush()
            expect(settled).toBe(false)
            await vi.advanceTimersByTimeAsync(2)
            res = await p
        } finally {
            vi.useRealTimers()
        }
        expect(res.success).toBe(true)
        expect(res.orders[0]).toMatchObject({ ticket: T, phase: 'pending' }) // saklanan (yoklanmamis) durum
        // Arkadaki yoklama bitince depo guncellenir; tek ucus oldugu icin yeni getOrder yok.
        release()
        await flush()
        expect(bg.localStore.private_orders[0].status).toBe('COMPLETED')
        expect(getOrderMock).toHaveBeenCalledTimes(1)
    })

    it('72 saati asan acik siparis listede problem olur ve yoklanmaz', async () => {
        await boot({ orders: [order({ createdAt: Date.now() - 73 * 3600 * 1000 })] })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders[0].phase).toBe('problem')
        expect(getOrderMock).not.toHaveBeenCalled()
        await fireAlarm()
        expect(getOrderMock).not.toHaveBeenCalled()
        expect(chrome.alarms.clear).toHaveBeenCalledWith('private_orders')
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
    })

    // T14 M2 / I2: basarisiz yatirma terminal; arada donen bir yoklama onu geri acmaz.
    it('depositFailed siparis terminal: yoklanmaz, rozette yok, liste problem der', async () => {
        await boot({ orders: [order({ status: 'ABORTED', depositFailed: true })] })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders[0]).toMatchObject({ phase: 'problem', refundable: false })
        expect(getOrderMock).not.toHaveBeenCalled()
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
    })

    it('bozuk depo girdileri liste, rozet ve iadeyi bozmaz', async () => {
        await boot({ orders: [null, 5, 'x', { status: 'OPEN' }, order({ status: 'FAILED', state: failedState() })] })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders).toHaveLength(1)
        expect(orders[0]).toMatchObject({ ticket: T, refundable: true })
        getOrderMock.mockResolvedValueOnce(failedState())
        refundMock.mockResolvedValue({ hash: '0xrefund', wait: async () => ({ status: 1 }) })
        expect(await bg.call({ type: 'PRIVATE_REFUND', message: { ticket: T } })).toEqual({ success: true, hash: '0xrefund' })
    })

    it('BNB siparisinde bos ya da bozuk expectedDestAmount bilinmeyen (null) doner', async () => {
        for (const expectedDestAmount of ['', '  ', 'abc', undefined, null]) {
            await boot({ orders: [order({ status: 'COMPLETED', summary: { payoutUsdc: '25.0', dest: { expectedDestAmount } } })] })
            const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(orders[0], String(expectedDestAmount)).toMatchObject({ outputAsset: 'BNB', expectedAmount: null })
        }
    })
})

describe('PRIVATE_REFUND: makbuz sonucu (B:M3, T8 M4, R1-N2)', () => {
    const refund = () => bg.call({ type: 'PRIVATE_REFUND', message: { ticket: T } })
    const failedOrder = () => order({ status: 'FAILED', state: failedState() })
    const stored = () => bg.localStore.private_orders[0]

    it('makbuz status 1: refundConfirmed true, kayit ve faz refunded kalir', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockResolvedValue({ hash: '0xrefund', wait: async () => ({ status: 1 }) })
        expect(await refund()).toEqual({ success: true, hash: '0xrefund' })
        await flush()
        expect(stored()).toMatchObject({ refundTxHash: '0xrefund', refundConfirmed: true })
        expect(stored().refundFailed).not.toBe(true)
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders[0]).toMatchObject({ phase: 'refunded', refundable: false })
    })

    it('makbuz status 0: refundTxHash temizlenir, refundFailed true, Iade tekrar gorunur ve yeniden gonderilebilir', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockResolvedValueOnce({ hash: '0xrefund', wait: async () => ({ status: 0 }) })
        expect(await refund()).toEqual({ success: true, hash: '0xrefund' })
        await flush()
        expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true })
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders[0]).toMatchObject({ phase: 'problem', refundable: true })

        // Bellek isareti de kalktigi icin ikinci iade gonderilebilir; yeni kayit refundFailed'i sifirlar.
        refundMock.mockResolvedValueOnce({ hash: '0xrefund2', wait: async () => ({ status: 1 }) })
        expect(await refund()).toEqual({ success: true, hash: '0xrefund2' })
        await flush()
        expect(stored()).toMatchObject({ refundTxHash: '0xrefund2', refundFailed: false, refundConfirmed: true })
        expect(refundMock).toHaveBeenCalledTimes(2)
    })

    it('status 0 makbuzu tasiyan ret (CALL_EXCEPTION) ayni sekilde temizler', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockResolvedValue({
            hash: '0xrefund',
            wait: async () => { throw Object.assign(new Error('reverted'), { code: 'CALL_EXCEPTION', receipt: { status: 0 } }) },
        })
        await refund()
        await flush()
        expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true })
    })

    it('makbuzsuz ret (ag, zaman asimi) kaydi degistirmez: iade hash i kalir', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockResolvedValue({ hash: '0xrefund', wait: async () => { throw new Error('ag') } })
        await refund()
        await flush()
        expect(stored()).toMatchObject({ refundTxHash: '0xrefund' })
        expect(stored().refundFailed).not.toBe(true)
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
    })

    it('wait olmayan sonuc (undefined) hata atmaz', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockResolvedValue({ hash: '0xrefund' })
        expect(await refund()).toEqual({ success: true, hash: '0xrefund' })
        await flush()
        expect(stored()).toMatchObject({ refundTxHash: '0xrefund' })
    })

    it('TRANSACTION_REPLACED: iptal/yerine gecme iadeyi temizler; repriced yeni hash i yazar ve makbuza gore karar verir', async () => {
        const replaced = (reason, extra = {}) => async () => {
            throw Object.assign(new Error('replaced'), { code: 'TRANSACTION_REPLACED', reason, ...extra })
        }
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockResolvedValueOnce({ hash: '0xrefund', wait: replaced('cancelled', { receipt: { status: 1 } }) })
        await refund()
        await flush()
        expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true })

        const NEW = '0x' + 'cd'.repeat(32)
        refundMock.mockResolvedValueOnce({ hash: '0xrefund2', wait: replaced('repriced', { replacement: { hash: NEW }, receipt: { status: 1 } }) })
        await refund()
        await flush()
        expect(stored()).toMatchObject({ refundTxHash: NEW, refundConfirmed: true })
    })

    // T16 M3: TRANSACTION_REPLACED ortak karar agaci (iade kolu). Gercek ethers hata sekli: makbuz
    // DEGISTIREN islemin makbuzudur, karar NEDENE gore verilir.
    describe('TRANSACTION_REPLACED karar agaci (T16 M3)', () => {
        const NEW = '0x' + 'cd'.repeat(32)
        const replacedErr = (reason, extra = {}) => Object.assign(new Error('replaced'), { code: 'TRANSACTION_REPLACED', reason, ...extra })
        const sendWith = async (wait) => {
            await boot({ orders: [failedOrder()] })
            getOrderMock.mockResolvedValue(failedState())
            refundMock.mockResolvedValueOnce({ hash: '0xrefund', wait })
            expect(await refund()).toEqual({ success: true, hash: '0xrefund' })
            await flush()
        }

        it('replaced (degistiren makbuz status 1): iade OLMADI, kayit temizlenir', async () => {
            await sendWith(async () => { throw replacedErr('replaced', { receipt: { status: 1 }, replacement: { hash: NEW } }) })
            expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true, lastFailedRefundTxHash: '0xrefund' })
        })

        it('repriced + status 0 makbuz: yeni hash yazilir, sonra iade basarisiz sayilip temizlenir (hash tanilama icin kalir)', async () => {
            await sendWith(async () => { throw replacedErr('repriced', { replacement: { hash: NEW }, receipt: { status: 0 } }) })
            expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true, lastFailedRefundTxHash: NEW })
            expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
        })

        it('bilinmeyen neden: kayit oldugu gibi kalir', async () => {
            await sendWith(async () => { throw replacedErr('gizemli', { replacement: { hash: NEW }, receipt: { status: 0 } }) })
            expect(stored()).toMatchObject({ refundTxHash: '0xrefund', refundConfirmed: false })
            expect(stored().refundFailed).not.toBe(true)
        })

        it('repriced ama gecerli yeni hash yok: kayit oldugu gibi kalir', async () => {
            await sendWith(async () => { throw replacedErr('repriced', { replacement: { hash: 'bozuk' }, hash: 'bozuk', receipt: { status: 1 } }) })
            expect(stored()).toMatchObject({ refundTxHash: '0xrefund', refundConfirmed: false })
        })

        it('repriced ama makbuz yok: yeni hash kayda islenir, onay/basarisizlik YAZILMAZ', async () => {
            await sendWith(async () => { throw replacedErr('repriced', { replacement: { hash: NEW } }) })
            expect(stored()).toMatchObject({ refundTxHash: NEW, refundConfirmed: false })
            expect(stored().refundFailed).not.toBe(true)
        })

        it('repriced dalinda updateOrder basarisiz: loglanir, makbuza gore yine karar verilir (status 1 -> onay denenir)', async () => {
            await boot({ orders: [failedOrder()] })
            getOrderMock.mockResolvedValue(failedState())
            const realSet = chrome.storage.local.set.getMockImplementation()
            let armed = false
            chrome.storage.local.set.mockImplementation(async (obj) => {
                if (armed && 'private_orders' in obj) throw new Error('depo yazilamadi')
                return realSet(obj)
            })
            refundMock.mockResolvedValueOnce({
                hash: '0xrefund',
                wait: async () => { armed = true; throw replacedErr('repriced', { replacement: { hash: NEW }, receipt: { status: 1 } }) },
            })
            expect(await refund()).toEqual({ success: true, hash: '0xrefund' })
            await flush()
            expect(console.error).toHaveBeenCalledWith('[private] yeni iade hash i kaydedilemedi:', expect.any(Error))
            expect(console.error).toHaveBeenCalledWith('[private] iade onayi kaydedilemedi:', expect.any(Error))
            expect(stored()).toMatchObject({ refundTxHash: '0xrefund', refundConfirmed: false })
        })
    })

    // T16 M4: temizleme yazimi gecici hatada bir kez daha denenir.
    it('iade basarisizligi temizleme yazimi ilk seferde duserse bir kez yeniden denenir: kayit temizlenir, isaret kalkar', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockResolvedValueOnce({ hash: '0xrefund', wait: async () => ({ status: 0 }) })
        const realSet = chrome.storage.local.set.getMockImplementation()
        let calls = 0
        chrome.storage.local.set.mockImplementation(async (obj) => {
            // 1. yazim iade kaydi, 2. yazim ILK temizleme denemesi (duser), 3. yazim yeniden deneme.
            if ('private_orders' in obj && ++calls === 2) throw new Error('gecici depo hatasi')
            return realSet(obj)
        })
        await refund()
        await flush()
        expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true })
        // Isaret kalkti: Iade yeniden gonderilebilir.
        refundMock.mockResolvedValueOnce({ hash: '0xrefund2', wait: async () => ({ status: 1 }) })
        expect(await refund()).toEqual({ success: true, hash: '0xrefund2' })
    })

    // T16 M4: SW yeniden basladiktan sonra bellek ici makbuz beklemesi kayboldu; yoklama uzlastirir.
    describe('bekleyen iade makbuzu uzlastirma (SW yeniden basladi)', () => {
        let receiptSpy
        const pendingRefund = (over = {}) => order({ status: 'FAILED', state: failedState(), refundTxHash: '0x' + 'ab'.repeat(32), refundConfirmed: false, ...over })
        const mockReceipt = (r) => { receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(async () => r) }

        it('status 1 -> refundConfirmed true; her yoklamada makbuz BIR kez sorgulanir', async () => {
            await boot({ orders: [pendingRefund()] })
            mockReceipt({ status: 1 })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(receiptSpy).toHaveBeenCalledTimes(1)
            expect(receiptSpy).toHaveBeenCalledWith('0x' + 'ab'.repeat(32))
            expect(bg.localStore.private_orders[0]).toMatchObject({ refundTxHash: '0x' + 'ab'.repeat(32), refundConfirmed: true })
            // Onaylanmis kayit bir daha sorgulanmaz.
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(receiptSpy).toHaveBeenCalledTimes(1)
        })

        it('status 0 -> canli status-0 makbuzuyla ayni isleme: temizlenir, refundFailed, Iade tekrar gorunur', async () => {
            await boot({ orders: [pendingRefund()] })
            mockReceipt({ status: 0 })
            const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(bg.localStore.private_orders[0]).toMatchObject({ refundTxHash: null, refundFailed: true, lastFailedRefundTxHash: '0x' + 'ab'.repeat(32) })
            expect(orders[0]).toMatchObject({ phase: 'problem', refundable: true })
            expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' })
        })

        it('makbuz yok ya da sorgu hatasi -> kayit DEGISMEZ', async () => {
            await boot({ orders: [pendingRefund()] })
            mockReceipt(null)
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(bg.localStore.private_orders[0]).toMatchObject({ refundTxHash: '0x' + 'ab'.repeat(32), refundConfirmed: false })
            receiptSpy.mockImplementation(async () => { throw new Error('rpc down') })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(bg.localStore.private_orders[0]).toMatchObject({ refundTxHash: '0x' + 'ab'.repeat(32), refundConfirmed: false })
            expect(bg.localStore.private_orders[0].refundFailed).not.toBe(true)
        })

        // T21 M1: uzlastirma bayat goruntuyle calisir; makbuz beklerken canli yol H1'i temizleyip kullanici H2'yi
        // gonderebilir. Gec gelen H1 sonucu H2'yi, refundFailed bayragini ya da bellek isaretini EZMEMELI.
        describe('gec gelen uzlastirma yeni iadeyi ezmez (T21 M1)', () => {
            const H1 = '0x' + 'ab'.repeat(32)
            const H2 = '0x' + 'cd'.repeat(32)
            const stored = () => bg.localStore.private_orders[0]

            // H1 iadesi gonderilir (canli bekleme kapida), yoklama H1 makbuzunu bekler (kapida), canli yol H1'i
            // status 0 ile temizler; donus: gec makbuzu serbest birakan fonksiyon + yoklama sozu.
            async function setup() {
                await boot({ orders: [order({ status: 'FAILED', state: failedState() })] })
                getOrderMock.mockResolvedValue(failedState())
                let releaseLive
                const liveGate = new Promise((r) => { releaseLive = r })
                refundMock.mockResolvedValueOnce({ hash: H1, wait: async () => { await liveGate; return { status: 0 } } })
                expect(await bg.call({ type: 'PRIVATE_REFUND', message: { ticket: T } })).toEqual({ success: true, hash: H1 })

                let releaseReceipt
                const receiptGate = new Promise((r) => { releaseReceipt = r })
                receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(() => receiptGate)
                const listed = bg.call({ type: 'PRIVATE_ORDERS' })
                await flush()
                expect(receiptSpy).toHaveBeenCalledTimes(1)
                expect(receiptSpy).toHaveBeenCalledWith(H1)

                releaseLive()
                await flush()
                expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true })
                return { releaseReceipt: (r) => releaseReceipt(r), listed }
            }

            it('H2 kayitli: gec H1 status 0 sonucu H2 kaydini ve refundFailed:false i korur', async () => {
                const { releaseReceipt, listed } = await setup()
                refundMock.mockResolvedValueOnce({ hash: H2, wait: () => new Promise(() => {}) })
                expect(await bg.call({ type: 'PRIVATE_REFUND', message: { ticket: T } })).toEqual({ success: true, hash: H2 })
                expect(stored()).toMatchObject({ refundTxHash: H2, refundFailed: false })

                releaseReceipt({ status: 0 })
                await listed
                await flush()
                expect(stored()).toMatchObject({ refundTxHash: H2, refundFailed: false })
                expect(await bg.call({ type: 'PRIVATE_REFUND', message: { ticket: T } })).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
                expect(refundMock).toHaveBeenCalledTimes(2)
            })

            it('H2 kaydi yazilamadi: H2 YAYINLANMAZ (PRIVATE_FAILED); gec H1 sonucu kaydi bozmaz ve H3 sonra gonderilebilir', async () => {
                const { releaseReceipt, listed } = await setup()
                const realSet = chrome.storage.local.set.getMockImplementation()
                chrome.storage.local.set.mockImplementation(async (obj) => {
                    if ('private_orders' in obj) throw new Error('depo yazilamadi')
                    return realSet(obj)
                })
                broadcastSpy.mockClear()
                refundMock.mockImplementationOnce(recordingRefund(H2, { wait: () => new Promise(() => {}) }))
                expect(await bg.call({ type: 'PRIVATE_REFUND', message: { ticket: T } })).toEqual({ success: false, error: 'PRIVATE_FAILED' })
                expect(broadcastSpy).not.toHaveBeenCalled()
                chrome.storage.local.set.mockImplementation(realSet)

                releaseReceipt({ status: 0 })
                await listed
                await flush()
                // H2 hic kaydedilmedi/yayinlanmadi; gec H1 sonucu kaydi (H1 zaten temizlenmisti) degistirmez.
                expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true })
                const H3 = '0x' + 'ef'.repeat(32)
                refundMock.mockImplementationOnce(recordingRefund(H3))
                expect(await bg.call({ type: 'PRIVATE_REFUND', message: { ticket: T } })).toEqual({ success: true, hash: H3 })
                expect(stored()).toMatchObject({ refundTxHash: H3, refundFailed: false })
            })
        })

        // T21 M2: uzlastirma yoklama basina TEK saglayici kurar ve hepsini destroy eder (ethers ag acilis dongusu kalmaz).
        it('birden cok bekleyen kayitta TEK saglayici kullanilir ve destroy edilir (T21 M2)', async () => {
            const T2 = '0x' + '02'.repeat(32)
            await boot({ orders: [pendingRefund(), pendingRefund({ ticket: T2, refundTxHash: '0x' + 'cd'.repeat(32) })] })
            const providers = []
            receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(async function () { providers.push(this); return { status: 1 } })
            const destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(receiptSpy).toHaveBeenCalledTimes(2)
            expect(providers[0]).toBe(providers[1])
            expect(destroyEdilen(destroySpy, providers)).toEqual([providers[0]])
        })

        it('makbuz sorgusu hata verse de saglayici destroy edilir; bekleyen kayit yoksa saglayici hic kurulmaz (T21 M2)', async () => {
            await boot({ orders: [pendingRefund()] })
            const providers = []
            receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(async function () { providers.push(this); throw new Error('rpc down') })
            const destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(providers).toHaveLength(1)
            expect(destroyEdilen(destroySpy, providers)).toEqual([providers[0]])

            // Bekleyen kayit yok: hicbir saglayici KULLANILMAZ (makbuz sorgusu yok) ve onceki ornek bir daha destroy edilmez.
            // (Yalniz kurulup hic kullanilmayan saglayici burada gorunmez: kurulus gozlenemez, baska ornekler ise sayimi bozar.)
            await boot({ orders: [pendingRefund({ refundConfirmed: true })] })
            receiptSpy.mockClear()
            destroySpy.mockClear()
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(receiptSpy).not.toHaveBeenCalled()
            expect(destroyEdilen(destroySpy, providers)).toEqual([])
        })

        it('zaten onayli ya da basarisiz isaretli kayitlar sorgulanmaz', async () => {
            await boot({ orders: [pendingRefund({ refundConfirmed: true }), pendingRefund({ ticket: '0x' + '02'.repeat(32), refundFailed: true })] })
            mockReceipt({ status: 1 })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(receiptSpy).not.toHaveBeenCalled()
        })

        it('bicimi bozuk refundTxHash RPC sorgusu tetiklemez (I1)', async () => {
            await boot({ orders: [pendingRefund({ refundTxHash: '0xr' })] })
            mockReceipt({ status: 1 })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(receiptSpy).not.toHaveBeenCalled()
            expect(bg.localStore.private_orders[0]).toMatchObject({ refundTxHash: '0xr', refundConfirmed: false })
        })

        it('kilitli cuzdanda da uzlastirir (anahtar gerekmez)', async () => {
            await boot({ orders: [pendingRefund()], unlocked: false })
            mockReceipt({ status: 1 })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(bg.localStore.private_orders[0].refundConfirmed).toBe(true)
        })
    })

    it('iki kayit yazimi da basarisiz: iade yayinlanmadi, liste refundable true kalir (bellek isareti konmaz)', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockImplementation(recordingRefund('0xrefund'))
        const realSet = chrome.storage.local.set.getMockImplementation()
        chrome.storage.local.set.mockImplementation(async (obj) => {
            if ('private_orders' in obj) throw new Error('depo yazilamadi')
            return realSet(obj)
        })
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        await flush()
        expect(broadcastSpy).not.toHaveBeenCalled()
        expect(stored().refundTxHash).toBeNull()
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders[0]).toMatchObject({ refundable: true, refundPending: false })
    })

    it('iade temizleme yazimi basarisiz olursa bellek isareti kalir (cift iade yok)', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockResolvedValue({ hash: '0xrefund', wait: async () => ({ status: 0 }) })
        const realSet = chrome.storage.local.set.getMockImplementation()
        let calls = 0
        chrome.storage.local.set.mockImplementation(async (obj) => {
            // Ilk yazim (iade kaydi) gecer, temizleme yazimi duser.
            if ('private_orders' in obj && ++calls > 1) throw new Error('depo yazilamadi')
            return realSet(obj)
        })
        await refund()
        await flush()
        expect(stored().refundTxHash).toBe('0xrefund')
        // T21 M7c: temizleme IKI kez de basarisiz oldu (ilk deneme + yeniden deneme): hata loglanir, isaret kalir.
        expect(console.error).toHaveBeenCalledWith('[private] iade basarisizligi kaydedilemedi:', expect.any(Error))
        expect(chrome.storage.local.set.mock.calls.filter(([o]) => 'private_orders' in o)).toHaveLength(3)
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
        expect(refundMock).toHaveBeenCalledTimes(1)
    })
})

// ---------------------------------------------------------------------------------------------
// T24: yatirma uzlastirma, sinirli RPC, acilis duzeni, iade koruma testleri
// ---------------------------------------------------------------------------------------------
describe('yatirma uzlastirma (T24 M2-I1, M1-m3)', () => {
    // Yeniden yayin yalniz keccak256(ham bayt) === kayitli hash iken yapilir (T24 M2): fixture tutarli olmali.
    const RAW = '0x02' + 'ab'.repeat(40)
    const D = keccak256(RAW)
    const CARD = 'card-dep-1'
    const deposit = (over = {}) => order({
        depositTxHash: D, rawDepositTx: RAW, cardTxId: CARD, cardSide: GIZLI.key,
        summary: { payoutUsdc: '25.0', expiresAtMs: Date.now() + 3600 * 1000 }, ...over,
    })
    let receiptSpy
    let broadcastSpy
    const mockReceipt = (r) => { receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(async () => r) }
    const stored = () => bg.localStore.private_orders[0]
    const poll = async () => { await bg.call({ type: 'PRIVATE_ORDERS' }); await flush() }
    const withCard = () => { bg.localStore.current_transactions = [{ id: CARD, status: 'processing', meta: { txHash: D, chainId: 56 }, accountKey: GIZLI.key }] }

    beforeEach(() => {
        broadcastSpy = vi.spyOn(JsonRpcProvider.prototype, 'broadcastTransaction').mockResolvedValue({})
    })
    // Acilistaki uzlastirma turu (makbuz: null) bir kez yeniden yayin yapmis olabilir: sayac sifirlanir.
    const bootDep = async (opts) => { await boot(opts); broadcastSpy.mockClear() }
    // Acilis turu da uzlastirir: bildirim/yayin/log davranisi, mock'lar ONCE kurulup bootDep'ten SONRA denetlenir.
    const rebroadcastLogs = () => console.error.mock.calls.filter((c) => String(c[0]).includes('yeniden yayinlanamadi'))

    it('status 1: depositConfirmed, ham bayt silinir, siparis ACIK kalir, bir daha sorgulanmaz', async () => {
        await bootDep({ orders: [deposit()] })
        mockReceipt({ status: 1 })
        await poll()
        expect(stored()).toMatchObject({ depositConfirmed: true, rawDepositTx: null, status: 'AWAITING_DEPOSIT' })
        expect(stored().depositFailed).not.toBe(true)
        expect(receiptSpy).toHaveBeenCalledWith(D)
        expect(broadcastSpy).not.toHaveBeenCalled()
        await poll()
        expect(receiptSpy).toHaveBeenCalledTimes(1)
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders[0].phase).toBe('pending')
    })

    it('status 0: depositFailed + ABORTED, ham bayt silinir, kart varsa ONCHAIN_FAILED, rozet bosalir', async () => {
        await bootDep({ orders: [deposit()] })
        withCard()
        mockReceipt({ status: 0 })
        await poll()
        expect(stored()).toMatchObject({ depositFailed: true, status: 'ABORTED', rawDepositTx: null })
        expect(bg.localStore.current_transactions[0]).toMatchObject({ id: CARD, status: 'error', meta: { errorCode: 'ONCHAIN_FAILED', txHash: D, chainId: 56 } })
        expect(broadcastSpy).not.toHaveBeenCalled()
        expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders[0]).toMatchObject({ phase: 'problem', depositFailed: true })
    })

    it('status 0 ama kart kaydi YOK (gecmis temizlenmis ya da eski kayit): yeni kart yaratilmaz, kayit yine terminal', async () => {
        await bootDep({ orders: [deposit()] })
        mockReceipt({ status: 0 })
        await poll()
        expect(stored()).toMatchObject({ depositFailed: true, status: 'ABORTED' })
        expect(bg.localStore.current_transactions).toBeUndefined()
        // cardTxId'siz eski kayit da ayni sekilde calisir.
        await bootDep({ orders: [deposit({ cardTxId: undefined, cardSide: undefined })] })
        mockReceipt({ status: 0 })
        await poll()
        expect(stored()).toMatchObject({ depositFailed: true, status: 'ABORTED' })
        expect(bg.localStore.current_transactions).toBeUndefined()
    })

    it('makbuz yok + ham bayt + teklif suresi dolmadi: AYNI bayt yeniden yayinlanir (tur basina BIR kez), "already known" zararsiz', async () => {
        await bootDep({ orders: [deposit()] })
        mockReceipt(null)
        await poll()
        expect(broadcastSpy).toHaveBeenCalledTimes(1)
        expect(broadcastSpy).toHaveBeenCalledWith(RAW)
        broadcastSpy.mockRejectedValue(Object.assign(new Error('already known'), { code: 'UNKNOWN_ERROR' }))
        await poll()
        expect(broadcastSpy).toHaveBeenCalledTimes(2)
        // Ham bayt, siparis ve durum degismedi.
        expect(stored()).toMatchObject({ rawDepositTx: RAW, status: 'AWAITING_DEPOSIT' })
        expect(stored().depositFailed).not.toBe(true)
    })

    it('makbuz yok + teklif suresi DOLDU: ham bayt silinir, yayin yok, siparis acik kalir (72 saatlik ufuk kapatir)', async () => {
        await bootDep({ orders: [deposit({ summary: { payoutUsdc: '25.0', expiresAtMs: Date.now() - 1000 } })] })
        mockReceipt(null)
        await poll()
        expect(broadcastSpy).not.toHaveBeenCalled()
        expect(stored().rawDepositTx).toBeNull()
        expect(stored()).toMatchObject({ status: 'AWAITING_DEPOSIT' })
        const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
        expect(orders[0].phase).toBe('pending')
    })

    it('teklif suresi bilinmiyorsa (kayitta yok) yeniden yayin YOK, ham bayt silinir (fail-closed)', async () => {
        await bootDep({ orders: [deposit({ summary: { payoutUsdc: '25.0' } })] })
        mockReceipt(null)
        await poll()
        expect(broadcastSpy).not.toHaveBeenCalled()
        expect(stored().rawDepositTx).toBeNull()
    })

    it('makbuz yok ve ham bayt da yok (ATS ya da silinmis): hicbir sey yayinlanmaz, kayit degismez', async () => {
        await bootDep({ orders: [deposit({ rawDepositTx: null })] })
        mockReceipt(null)
        await poll()
        expect(broadcastSpy).not.toHaveBeenCalled()
        expect(stored()).toMatchObject({ status: 'AWAITING_DEPOSIT', depositTxHash: D })
    })

    it('makbuz sorgusu hata verirse kayit ve ham bayt DEGISMEZ, yayin yok', async () => {
        await bootDep({ orders: [deposit()] })
        receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockRejectedValue(new Error('rpc down'))
        await poll()
        expect(stored()).toMatchObject({ rawDepositTx: RAW, status: 'AWAITING_DEPOSIT' })
        expect(broadcastSpy).not.toHaveBeenCalled()
    })

    it('atlananlar: bicimi bozuk hash, onayli, basarisiz isaretli, 30 sn\'den genc kayit (RPC sorgusu YOK)', async () => {
        await bootDep({ orders: [
            deposit({ depositTxHash: '0xdep' }),
            deposit({ ticket: '0x' + '02'.repeat(32), depositConfirmed: true, rawDepositTx: null }),
            deposit({ ticket: '0x' + '03'.repeat(32), createdAt: Date.now() - 5000 }),
        ] })
        mockReceipt({ status: 1 })
        await poll()
        expect(receiptSpy).not.toHaveBeenCalled()
        expect(broadcastSpy).not.toHaveBeenCalled()
    })

    it('terminal / onayli / basarisiz siparisin kalan ham bayti RPC olmadan silinir', async () => {
        await bootDep({ orders: [
            deposit({ status: 'COMPLETED' }),
            deposit({ ticket: '0x' + '02'.repeat(32), depositConfirmed: true }),
            deposit({ ticket: '0x' + '03'.repeat(32), depositFailed: true, status: 'ABORTED' }),
        ] })
        mockReceipt(null)
        await poll()
        expect(bg.localStore.private_orders.map((o) => o.rawDepositTx)).toEqual([null, null, null])
        expect(receiptSpy).not.toHaveBeenCalled()
    })

    it('ayni zincirdeki birden cok yatirma icin TEK saglayici kurulur ve destroy edilir; bekleyen yoksa saglayici kurulmaz', async () => {
        await bootDep({ orders: [deposit(), deposit({ ticket: '0x' + '02'.repeat(32), depositTxHash: '0x' + 'ee'.repeat(32) })] })
        const providers = []
        receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(async function () { providers.push(this); return { status: 1 } })
        const destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
        await poll()
        expect(receiptSpy).toHaveBeenCalledTimes(2)
        expect(providers[0]).toBe(providers[1])
        expect(destroyEdilen(destroySpy, providers)).toEqual([providers[0]])
        // Hepsi onayli: ikinci tur makbuz sorgusu YAPMAZ (saglayici kullanmaz) ve onceki ornegi bir daha destroy etmez.
        receiptSpy.mockClear()
        destroySpy.mockClear()
        await poll()
        expect(receiptSpy).not.toHaveBeenCalled()
        expect(destroyEdilen(destroySpy, providers)).toEqual([])
    })

    it('saglayici istek zaman asimi 15 sn (FetchRequest) ile kurulur', async () => {
        await bootDep({ orders: [deposit()] })
        const timeouts = []
        receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(async function () {
            timeouts.push(this._getConnection().timeout)
            return null
        })
        await poll()
        expect(timeouts).toEqual([15000])
    })

    it('acilista da calisir (kilitli cuzdanda bile, 30 sn\'den eski kayit)', async () => {
        receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(async () => ({ status: 1 }))
        await bootDep({ orders: [deposit()], unlocked: false })
        expect(receiptSpy).toHaveBeenCalledWith(D)
        expect(stored()).toMatchObject({ depositConfirmed: true, rawDepositTx: null })
    })

    it('Base teslimli siparis (surum 2): makbuz sorgusu kaynak zincirin (56) saglayicisiyla yapilir, teslim agi RPC si kurulmaz', async () => {
        await bootDep({ orders: [deposit({ deliveryVersion: 2, summary: { payoutUsdc: '14.85', expiresAtMs: Date.now() + 3600 * 1000, dest: BASE_DEST } })] })
        const urls = []
        receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(async function () { urls.push(this._getConnection().url); return { status: 1 } })
        await poll()
        expect(urls).toEqual([BSC_RPC])
        expect(stored()).toMatchObject({ depositConfirmed: true, deliveryVersion: 2 })
    })

    it('iki FARKLI kaynak zincir icin IKI saglayici kurulur (zincir basina bir), ikisi de destroy edilir', async () => {
        await bootDep({ orders: [
            deposit(),
            deposit({ ticket: '0x' + '02'.repeat(32), sourceChainId: 1, depositTxHash: keccak256('0x02' + 'cd'.repeat(40)), rawDepositTx: '0x02' + 'cd'.repeat(40) }),
        ] })
        const providers = []
        receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(async function () { providers.push(this); return { status: 1 } })
        const destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
        await poll()
        expect(receiptSpy).toHaveBeenCalledTimes(2)
        expect(new Set(providers).size).toBe(2)
        expect(destroyEdilen(destroySpy, providers)).toHaveLength(2)
        expect(new Set(destroyEdilen(destroySpy, providers))).toEqual(new Set(providers))
    })

    describe('sunucuya bildirim (T24 M3)', () => {
        const lastReportArgs = () => reportMock.mock.calls.at(-1)

        it('status 1: yatirma hash i erisim anahtariyla SilentSwap e bildirilir; sonraki turlar tekrar bildirmez (artik sorgulanmaz)', async () => {
            mockReceipt({ status: 1 })
            await bootDep({ orders: [deposit()] })
            expect(reportMock).toHaveBeenCalledTimes(1)
            expect(lastReportArgs()).toEqual([{ id: T, privacy: true, accessToken: 'tok' }, D])
            await poll()
            expect(reportMock).toHaveBeenCalledTimes(1)
        })

        it('basarili yeniden yayindan sonra bildirilir', async () => {
            mockReceipt(null)
            await bootDep({ orders: [deposit()] })
            expect(broadcastSpy).not.toHaveBeenCalled() // bootDep sayaci sifirladi; asagidaki tur yayinlar
            reportMock.mockClear()
            await poll()
            expect(broadcastSpy).toHaveBeenCalledWith(RAW)
            expect(lastReportArgs()).toEqual([{ id: T, privacy: true, accessToken: 'tok' }, D])
        })

        it('"already known" da bildirilir (islem agda) ama LOGLANMAZ', async () => {
            mockReceipt(null)
            broadcastSpy.mockRejectedValue(Object.assign(new Error('already known'), { code: 'UNKNOWN_ERROR' }))
            await bootDep({ orders: [deposit()] })
            expect(reportMock).toHaveBeenCalledTimes(1)
            expect(rebroadcastLogs()).toEqual([])
        })

        it('yayin reddedilirse (yetersiz bakiye) bildirilmez ve HATA LOGLANIR; ham bayt korunur', async () => {
            mockReceipt(null)
            broadcastSpy.mockRejectedValue(new Error('insufficient funds for gas * price + value'))
            await bootDep({ orders: [deposit()] })
            expect(reportMock).not.toHaveBeenCalled()
            expect(rebroadcastLogs()).toHaveLength(1)
            expect(rebroadcastLogs()[0][1]).toBeInstanceOf(Error)
            expect(stored()).toMatchObject({ rawDepositTx: RAW, status: 'AWAITING_DEPOSIT' })
        })

        it('bildirim hatasi (senkron firlatma ya da ret) yutulur: kayit yine islenir', async () => {
            mockReceipt({ status: 1 })
            reportMock.mockImplementation(() => { throw new Error('sync boom') })
            await bootDep({ orders: [deposit()] })
            expect(reportMock).toHaveBeenCalledTimes(1)
            expect(stored()).toMatchObject({ depositConfirmed: true, rawDepositTx: null })
            reportMock.mockReset()
            reportMock.mockRejectedValue(new Error('async boom'))
            await bootDep({ orders: [deposit()] })
            expect(reportMock).toHaveBeenCalledTimes(1)
            expect(stored()).toMatchObject({ depositConfirmed: true, rawDepositTx: null })
        })

        it('status 0: bildirilmez (yatirma zincirde dustu)', async () => {
            mockReceipt({ status: 0 })
            await bootDep({ orders: [deposit()] })
            expect(stored()).toMatchObject({ depositFailed: true })
            expect(reportMock).not.toHaveBeenCalled()
        })
    })

    describe('ham baytin yeniden yayini: dogrulama ve sonuc isleme (T24 M1, M2)', () => {
        it('keccak256(ham bayt) kayitli hash ile ESIT DEGILSE: yayin YOK, bayt silinir, hata loglanir, bildirim yok', async () => {
            mockReceipt(null)
            await bootDep({ orders: [deposit({ rawDepositTx: '0x02' + 'cd'.repeat(40) })] })
            expect(broadcastSpy).not.toHaveBeenCalled()
            expect(reportMock).not.toHaveBeenCalled()
            expect(stored().rawDepositTx).toBeNull()
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining('hash ile uyusmuyor'))
        })

        it('hash karsilastirmasi buyuk/kucuk harfe bakmaz (buyuk harfli hash kaydi da yayinlanir)', async () => {
            mockReceipt(null)
            await bootDep({ orders: [deposit({ depositTxHash: '0x' + D.slice(2).toUpperCase() })] })
            await poll()
            expect(broadcastSpy).toHaveBeenCalledWith(RAW)
        })

        it('"nonce too low" ve makbuz hala yok: bayt silinir (o nonce kullanildi, bu bayt asla madenlenemez), loglanir, bildirilmez', async () => {
            mockReceipt(null)
            broadcastSpy.mockRejectedValue(new Error('nonce too low: next nonce 8'))
            await bootDep({ orders: [deposit()] })
            expect(stored().rawDepositTx).toBeNull()
            expect(stored()).toMatchObject({ status: 'AWAITING_DEPOSIT', depositTxHash: D })
            expect(stored().depositFailed).not.toBe(true)
            expect(reportMock).not.toHaveBeenCalled()
            expect(rebroadcastLogs()).toHaveLength(1)
        })

        it('ethers NONCE_EXPIRED kodu da ayni sekilde bayti siler', async () => {
            mockReceipt(null)
            broadcastSpy.mockRejectedValue(Object.assign(new Error('x'), { code: 'NONCE_EXPIRED' }))
            await bootDep({ orders: [deposit()] })
            expect(stored().rawDepositTx).toBeNull()
        })

        it('diger hatalar (underpriced, ag) bayti SILMEZ ve her turda loglanir: sonraki tur yeniden dener', async () => {
            mockReceipt(null)
            broadcastSpy.mockRejectedValue(new Error('transaction underpriced'))
            await bootDep({ orders: [deposit()] })
            expect(rebroadcastLogs()).toHaveLength(1)
            broadcastSpy.mockRejectedValue(new Error('socket hang up'))
            await poll()
            expect(stored().rawDepositTx).toBe(RAW)
            expect(rebroadcastLogs()).toHaveLength(2)
        })
    })

    describe('makbuz sorgu ufku: teklif suresinden 1 saat sonra durur (T24 M4)', () => {
        const expiredAgo = (ms) => deposit({ summary: { payoutUsdc: '25.0', expiresAtMs: Date.now() - ms } })

        it('teklif suresi 59 dk once dolduysa hala sorgulanir; 61 dk once dolduysa SORGULANMAZ (acilis ve yoklama)', async () => {
            await bootDep({ orders: [expiredAgo(59 * 60 * 1000)] })
            mockReceipt(null)
            await poll()
            expect(receiptSpy).toHaveBeenCalledTimes(1)

            receiptSpy.mockClear()
            await bootDep({ orders: [expiredAgo(61 * 60 * 1000)] })
            mockReceipt(null)
            await poll()
            await poll()
            await Promise.allSettled(bg.listeners.onStartup.map((fn) => fn()))
            await flush()
            expect(receiptSpy).not.toHaveBeenCalled()
            expect(stored()).toMatchObject({ status: 'AWAITING_DEPOSIT', depositTxHash: D })
        })

        it('sorgu ufkunu asmis (2 saat once dolan) teklifin kalan ham bayti RPC olmadan silinir ve yayinlanmaz', async () => {
            mockReceipt(null)
            await bootDep({ orders: [expiredAgo(2 * 3600 * 1000)] })
            expect(receiptSpy).not.toHaveBeenCalled()
            expect(broadcastSpy).not.toHaveBeenCalled()
            expect(stored().rawDepositTx).toBeNull()
            expect(stored()).toMatchObject({ status: 'AWAITING_DEPOSIT', depositTxHash: D })
        })

        it('suresi dolmus teklifin ham bayti 59 dk icinde silinir ve yayinlanmaz', async () => {
            await bootDep({ orders: [expiredAgo(30 * 60 * 1000)] })
            mockReceipt(null)
            await poll()
            expect(broadcastSpy).not.toHaveBeenCalled()
            expect(stored().rawDepositTx).toBeNull()
        })
    })
})

describe('sinirli uzlastirma ve acilis duzeni (T24 M1-m2)', () => {
    const R1 = '0x' + 'ab'.repeat(32)
    const R2 = '0x' + 'bc'.repeat(32)
    const R3 = '0x' + 'cd'.repeat(32)
    const pendingRefund = (over = {}) => order({ status: 'FAILED', state: failedState(), refundTxHash: R1, refundConfirmed: false, ...over })
    const hang = () => new Promise(() => {})
    let receiptSpy

    it('alarmlar ve rozet SAKLANAN listeden, takili makbuz uzlastirmasi BITMEDEN kurulur', async () => {
        getOrderMock.mockReset()
        receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(hang)
        bg = await bootBackground({
            localStore: { active_account: GIZLI, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {}, private_orders: [order(), pendingRefund({ ticket: '0x' + '02'.repeat(32) })] },
            sessionStore: { sessionMasterKeyJwk: jwk },
        })
        await flush()
        // Makbuz sorgusu takili (yayinda), ama alarm ve rozet cikti.
        expect(receiptSpy).toHaveBeenCalled()
        expect(bg.chrome.alarms.create).toHaveBeenCalledWith('private_orders', { periodInMinutes: 1 })
        expect(bg.chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '1' })
    })

    // Grafit karari (kullanici, 2026-10-26): rozet yalniz gizli modda gorunur; mor degil, notr.
    it('gizli islem rozetinin rengi mor degil', async () => {
        getOrderMock.mockReset()
        receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(hang)
        bg = await bootBackground({
            localStore: { active_account: GIZLI, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {}, private_orders: [order(), pendingRefund({ ticket: '0x' + '02'.repeat(32) })] },
            sessionStore: { sessionMasterKeyJwk: jwk },
        })
        await flush()
        const renkler = bg.chrome.action.setBadgeBackgroundColor.mock.calls.map(([arg]) => arg.color)
        expect(renkler.length).toBeGreaterThan(0)
        for (const renk of renkler) expect(morMu(oklchHex(renk)), renk).toBe(false)
    })

    it('tek ucus: acilis ve onStartup ust uste binerse makbuz BIR kez sorgulanir', async () => {
        getOrderMock.mockReset()
        receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(hang)
        bg = await bootBackground({
            localStore: { active_account: GIZLI, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {}, private_orders: [pendingRefund()] },
            sessionStore: { sessionMasterKeyJwk: jwk },
        })
        await flush()
        expect(receiptSpy).toHaveBeenCalledTimes(1)
        await Promise.allSettled(bg.listeners.onStartup.map((fn) => fn()))
        await flush()
        expect(receiptSpy).toHaveBeenCalledTimes(1)
    })

    describe('sahte zamanlayici: hic cevap vermeyen makbuz', () => {
        const startup = async () => { await Promise.allSettled(bg.listeners.onStartup.map((fn) => fn())) }
        const advance = (ms) => vi.advanceTimersByTimeAsync(ms)
        afterEach(() => { vi.useRealTimers() })

        it('her sorgu 15 sn ile sinirli; acilis uzlastirmasi TOPLAM 25 sn sonra birakilir (sonraki acilis yeniden dener); uclu kayitta ucuncusu hic baslamaz', async () => {
            await boot({ orders: [
                pendingRefund(), pendingRefund({ ticket: '0x' + '02'.repeat(32), refundTxHash: R2 }), pendingRefund({ ticket: '0x' + '03'.repeat(32), refundTxHash: R3 }),
            ] })
            receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(hang)
            const destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
            await startup()
            await advance(0)
            expect(receiptSpy).toHaveBeenCalledTimes(1)
            await advance(14999)
            expect(receiptSpy).toHaveBeenCalledTimes(1)
            await advance(1)
            // 15. sn: ilk sorgu zaman asimina ugradi, ikincisi basladi.
            expect(receiptSpy).toHaveBeenCalledTimes(2)
            await advance(9000)
            // 24. sn: hala TEK ucus, yeni acilis yeni is baslatmaz.
            await startup()
            expect(receiptSpy).toHaveBeenCalledTimes(2)
            await advance(1000)
            // 25. sn: toplam sure doldu, bekleme birakildi.
            await startup()
            await advance(0)
            expect(receiptSpy).toHaveBeenCalledTimes(3)
            // Ucuncu kayit ilk turda hic sorgulanmadi (sure `until`i astiktan sonra dongu durdu): 3. cagri YENI turun 1. sorgusu.
            expect(receiptSpy.mock.calls.map((c) => c[0])).toEqual([R1, R2, R1])
            await advance(60000)
            expect(destroySpy).toHaveBeenCalled()
        })

        it('makbuz sorgusu 15 sn sonra birakilir: kayit degismez, saglayici destroy edilir (yoklama yolu)', async () => {
            await boot({ orders: [pendingRefund()] })
            receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(hang)
            const destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
            const listed = bg.call({ type: 'PRIVATE_ORDERS' })
            await advance(3000)
            // Liste 3 sn'de saklanan goruntuyle cevap verir; sorgu arkada surer.
            const { orders } = await listed
            expect(orders).toHaveLength(1)
            expect(destroySpy).not.toHaveBeenCalled()
            await advance(11999)
            expect(destroySpy).not.toHaveBeenCalled()
            await advance(1)
            await advance(0)
            expect(destroySpy).toHaveBeenCalledTimes(1)
            expect(bg.localStore.private_orders[0]).toMatchObject({ refundTxHash: R1, refundConfirmed: false })
        })
    })

    describe('yas kurallari: 30 sn alti atlanir (acilis), 24 saat sonra sorgu durur', () => {
        const refundAt = (ms) => pendingRefund({ updatedAt: Date.now() - ms })

        it('acilista 30 sn\'den genc iade sorgulanmaz; yoklama yolunda (canli bekleme kaybolduysa) sorgulanir', async () => {
            getOrderMock.mockReset()
            receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(async () => ({ status: 1 }))
            bg = await bootBackground({
                localStore: { active_account: GIZLI, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {}, private_orders: [refundAt(5000)] },
                sessionStore: { sessionMasterKeyJwk: jwk },
            })
            await flush()
            expect(receiptSpy).not.toHaveBeenCalled()
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(receiptSpy).toHaveBeenCalledTimes(1)
        })

        it('30 sn\'den eski iade acilista sorgulanir', async () => {
            getOrderMock.mockReset()
            receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(async () => ({ status: 1 }))
            bg = await bootBackground({
                localStore: { active_account: GIZLI, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {}, private_orders: [refundAt(31000)] },
                sessionStore: { sessionMasterKeyJwk: jwk },
            })
            await flush()
            expect(receiptSpy).toHaveBeenCalledTimes(1)
        })

        // T24 M5: 24 saat duvar saati yasidir; tarayici o sure kapaliyken iade ufku asar. Ufku asmis makbuzsuz iade
        // tarayici OTURUMU basina BIR KEZ sorgulanir (acilista), sonra yoklama ve acilis onu tekrar sorgulamaz.
        const bootOld = async ({ receipt, ageMs = 25 * 3600 * 1000, sessionStore = {} } = {}) => {
            getOrderMock.mockReset()
            receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(async () => receipt)
            bg = await bootBackground({
                localStore: { active_account: GIZLI, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {}, private_orders: [refundAt(ageMs)] },
                sessionStore: { sessionMasterKeyJwk: jwk, ...sessionStore },
            })
            await flush()
        }

        it('24 saatten eski, makbuzsuz iade acilista TAM BIR KEZ sorgulanir; yoklama ve onStartup tekrar sorgulamaz, kayit oldugu gibi kalir', async () => {
            await bootOld({ receipt: null })
            expect(receiptSpy).toHaveBeenCalledTimes(1)
            expect(receiptSpy).toHaveBeenCalledWith(R1)
            await bg.call({ type: 'PRIVATE_ORDERS' })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            await Promise.allSettled(bg.listeners.onStartup.map((fn) => fn()))
            await flush()
            expect(receiptSpy).toHaveBeenCalledTimes(1)
            expect(bg.localStore.private_orders[0]).toMatchObject({ refundTxHash: R1, refundConfirmed: false })
            // Oturum deposu sorgulanan ticket'i tutar (servis calisani yeniden baslasa da silinmez).
            expect(bg.sessionStore.private_refund_queried).toEqual([T])
        })

        it('24 saatten eski iade zincirde REVERT ettiyse (tarayici kapaliyken) acilistaki tek sorgu bunu yakalar: Iade geri gelir', async () => {
            await bootOld({ receipt: { status: 0 } })
            expect(receiptSpy).toHaveBeenCalledTimes(1)
            expect(bg.localStore.private_orders[0]).toMatchObject({ refundTxHash: null, refundFailed: true })
            const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(orders[0]).toMatchObject({ refundFailed: true, refundPending: false })
        })

        it('24 saatten eski iade makbuzu status 1 ise onaylanir', async () => {
            await bootOld({ receipt: { status: 1 } })
            expect(bg.localStore.private_orders[0]).toMatchObject({ refundConfirmed: true })
        })

        it('yeni tarayici oturumunda (oturum deposu bos) ufku asmis iade yeniden bir kez sorgulanir; ayni oturumda sorgulanmis ticket atlanir', async () => {
            await bootOld({ receipt: null, sessionStore: { private_refund_queried: [T] } })
            expect(receiptSpy).not.toHaveBeenCalled()
            await bootOld({ receipt: null })
            expect(receiptSpy).toHaveBeenCalledTimes(1)
        })

        it('oturum deposu okunamazsa ufku asmis iade sorgulanmaz (dakikalik sorgu firtinasindan kacinmak fail-safe)', async () => {
            getOrderMock.mockReset()
            receiptSpy = vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockImplementation(async () => null)
            bg = await bootBackground({
                localStore: { active_account: GIZLI, vaults: [structuredClone(vault)], dapps: {}, solana_dapps: {}, private_orders: [refundAt(25 * 3600 * 1000)] },
                sessionStore: { sessionMasterKeyJwk: jwk },
            })
            await flush()
            // Acilistaki sorgu isareti silinir: okuma calissaydi iade yeniden sorgulanirdi (testin gucu).
            delete bg.sessionStore.private_refund_queried
            receiptSpy.mockClear()
            bg.chrome.storage.session.get.mockImplementation(async (k) => {
                if (k === 'private_refund_queried') throw new Error('session store down')
                return {}
            })
            console.error.mockClear()
            await bg.call({ type: 'PRIVATE_ORDERS' })
            await flush()
            expect(receiptSpy).not.toHaveBeenCalled()
            // T26 M2: okuma hatasi sessiz gecmez, nedeni loglanir.
            expect(console.error).toHaveBeenCalledWith(
                '[private] iade sorgu isaretleri okunamadi, ufku asmis iade ek sorgulanmayacak:',
                expect.objectContaining({ message: 'session store down' }),
            )
        })

        it('liste: makbuzsuz iade ufku astiysa refundStatusUnknown true; ufuk icindeyse false', async () => {
            await bootOld({ receipt: null })
            expect((await bg.call({ type: 'PRIVATE_ORDERS' })).orders[0]).toMatchObject({ refundPending: true, refundStatusUnknown: true })
            await bootOld({ receipt: null, ageMs: 23 * 3600 * 1000 })
            expect((await bg.call({ type: 'PRIVATE_ORDERS' })).orders[0]).toMatchObject({ refundPending: true, refundStatusUnknown: false })
        })

        it('23 saatlik iade her yoklamada sorgulanir (ufuk icinde, oturum isareti yazilmaz)', async () => {
            await bootOld({ receipt: null, ageMs: 23 * 3600 * 1000 })
            receiptSpy.mockClear()
            await bg.call({ type: 'PRIVATE_ORDERS' })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(receiptSpy).toHaveBeenCalledTimes(2)
            expect(bg.sessionStore.private_refund_queried).toBeUndefined()
        })
    })
})

describe('iade korumasi: sayilan yazim hatalari ve makbuz siniri (T24 M1-m7)', () => {
    const refund = () => bg.call({ type: 'PRIVATE_REFUND', message: { ticket: T } })
    const failedOrder = () => order({ status: 'FAILED', state: failedState() })
    const stored = () => bg.localStore.private_orders[0]
    // Yalniz private_orders yazimlarini sayar: `shouldFail(n)` n. yazim (1 tabanli) icin true ise duser.
    const failWrites = (shouldFail) => {
        const realSet = chrome.storage.local.set.getMockImplementation()
        let n = 0
        chrome.storage.local.set.mockImplementation(async (obj) => {
            if ('private_orders' in obj && shouldFail(++n)) throw new Error('depo yazilamadi')
            return realSet(obj)
        })
        return () => n
    }

    it('kayit yazimlari dusse (2 deneme): iade YAYINLANMAZ, hata loglanir, kayitta hash YOK ve isaret konmaz (T25)', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockImplementation(recordingRefund('0xrefund', { wait: async () => ({ status: 0 }) }))
        const writes = failWrites(() => true)
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        await flush()
        expect(writes()).toBe(2)
        expect(broadcastSpy).not.toHaveBeenCalled()
        expect(stored().refundTxHash).toBeNull()
        expect(console.error).toHaveBeenCalledWith('[private] iade kaydi yazilamadi:', expect.any(Error))
        // Isaret yok: yeni tiklama yeniden denenir (yazim hala dusuyor, yine yayin yok).
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        expect(broadcastSpy).not.toHaveBeenCalled()
    })

    it('ilk iki yazim (kayit) dusup sonrakiler basarili olursa: ilk tiklama PRIVATE_FAILED, ikincisi gider ve onaylanir', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockImplementationOnce(recordingRefund('0xrefund'))
        failWrites((n) => n <= 2)
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        expect(stored().refundTxHash).toBeNull()
        refundMock.mockImplementationOnce(recordingRefund('0xrefund2'))
        expect(await refund()).toEqual({ success: true, hash: '0xrefund2' })
        await flush()
        expect(broadcastSpy).toHaveBeenCalledTimes(1)
        expect(stored()).toMatchObject({ refundTxHash: '0xrefund2', refundConfirmed: true })
    })

    it('iade saglayicisi 15 sn istek zaman asimiyla kurulur ve makbuz beklemesi bitince destroy edilir', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        const destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
        const providers = []
        let release
        const gate = new Promise((r) => { release = r })
        refundMock.mockImplementation(async ({ wallet }) => {
            providers.push(wallet.provider)
            expect(wallet.provider._getConnection().timeout).toBe(15000)
            return { hash: '0xrefund', wait: async () => { await gate; return { status: 1 } } }
        })
        expect(await refund()).toEqual({ success: true, hash: '0xrefund' })
        await flush()
        expect(providers).toHaveLength(1)
        expect(destroyEdilen(destroySpy, providers)).toEqual([])
        release()
        await flush()
        expect(destroyEdilen(destroySpy, providers)).toEqual([providers[0]])
    })

    it('iade gonderimi basarisiz olursa saglayici yine destroy edilir', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        const destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
        const providers = []
        refundMock.mockImplementation(async ({ wallet }) => { providers.push(wallet.provider); throw new Error('gonderilemedi') })
        expect(await refund()).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        expect(providers).toHaveLength(1)
        expect(destroyEdilen(destroySpy, providers)).toEqual([providers[0]])
    })

    it('settle hatasi loglanir (iade): son kayit yazimi atarsa iz kalir', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        // wait atar: settle karar agacina girer, 'failed' dalinda temizleme kendi hatalarini yutar; bu yuzden
        // settle'in KENDISINI atan bir wait ile (makbuz nesnesi okunurken) dogrudan sarmalayici yakalar.
        const hostile = Object.assign(new Error('beklenmeyen'), { code: 'TRANSACTION_REPLACED', reason: 'repriced', replacement: { hash: '0x' + 'ff'.repeat(32) } })
        Object.defineProperty(hostile, 'receipt', { get() { throw new Error('makbuz okunamadi') } })
        refundMock.mockResolvedValue({ hash: '0xrefund', wait: () => { throw hostile } })
        expect(await refund()).toEqual({ success: true, hash: '0xrefund' })
        await flush()
        expect(console.error).toHaveBeenCalledWith('[private] iade sonucu islenemedi:', expect.any(Error))
    })
})

// T25 M2-I3 / M1-m4 / U:I-1 / U:M-7: iade yatirmayla ayni protokolu izler (imzala -> kaydet -> yayinla).
describe('PRIVATE_REFUND -- imzala, kaydet, yayinla (T25)', () => {
    const refund = () => bg.call({ type: 'PRIVATE_REFUND', message: { ticket: T } })
    const failedOrder = (over = {}) => order({ status: 'FAILED', state: failedState(), ...over })
    const stored = () => bg.localStore.private_orders[0]
    const H = '0x' + 'ab'.repeat(32)
    const H2 = '0x' + 'cd'.repeat(32)
    const never = () => new Promise(() => {})

    it('kayit YAYINDAN ONCE yazilir: refundTxHash + ham imzali bayt + gonderim zamani, refundConfirmed false', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        let recordAtBroadcast = null
        refundMock.mockImplementation(async (args) => {
            await args.onSubmitted(H, RAW_REFUND)
            recordAtBroadcast = { ...bg.localStore.private_orders[0] }
            broadcastSpy(H)
            return { hash: H, recorded: true, wait: never }
        })
        const t0 = Date.now()
        expect(await refund()).toEqual({ success: true, hash: H })
        expect(recordAtBroadcast).toMatchObject({ refundTxHash: H, rawRefundTx: RAW_REFUND, refundConfirmed: false, refundFailed: false })
        expect(recordAtBroadcast.refundSentAt).toBeGreaterThanOrEqual(t0)
        expect(() => JSON.stringify(bg.localStore.private_orders)).not.toThrow()
    })

    it('makbuz status 1: refundConfirmed true ve ham bayt SILINIR', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockImplementation(recordingRefund(H, { wait: async () => ({ status: 1 }) }))
        await refund()
        await flush()
        expect(stored()).toMatchObject({ refundTxHash: H, refundConfirmed: true, rawRefundTx: null })
    })

    it('makbuz status 0: kayit temizlenir, ham bayt SILINIR, hash lastFailedRefundTxHash te kalir', async () => {
        await boot({ orders: [failedOrder()] })
        getOrderMock.mockResolvedValue(failedState())
        refundMock.mockImplementation(recordingRefund(H, { wait: async () => ({ status: 0 }) }))
        await refund()
        await flush()
        expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true, rawRefundTx: null, lastFailedRefundTxHash: H })
    })

    describe('belirsiz yayin (PRIVATE_REFUND_UNCONFIRMED)', () => {
        const unconfirmed = { message: 'PRIVATE_REFUND_UNCONFIRMED', definitive: false }

        it('cevap hata + hash; kayit hash ve ham bayti TASIR; siparis artik iade edilebilir gorunmez', async () => {
            await boot({ orders: [failedOrder()] })
            getOrderMock.mockResolvedValue(failedState())
            refundMock.mockImplementation(recordingRefund(H, { fail: unconfirmed }))
            expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_UNCONFIRMED', txHash: H })
            expect(stored()).toMatchObject({ refundTxHash: H, rawRefundTx: RAW_REFUND, refundConfirmed: false, refundFailed: false })
            const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(orders[0]).toMatchObject({ ticket: T, phase: 'refunded', refundable: false, refundPending: true, refundFailed: false })
            expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' })
        })

        it('ikinci iade tiklamasi reddedilir (ayni siparis iki kez gonderilmez), yayin bir kez', async () => {
            await boot({ orders: [failedOrder()] })
            getOrderMock.mockResolvedValue(failedState())
            refundMock.mockImplementation(recordingRefund(H, { fail: unconfirmed }))
            await refund()
            expect(await refund()).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
            expect(broadcastSpy).toHaveBeenCalledTimes(1)
            expect(refundMock).toHaveBeenCalledTimes(1)
        })

        it('saglayici yine destroy edilir (belirsiz yolda da)', async () => {
            await boot({ orders: [failedOrder()] })
            getOrderMock.mockResolvedValue(failedState())
            const destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
            refundMock.mockImplementation(recordingRefund(H, { fail: unconfirmed }))
            await refund()
            expect(destroySpy).toHaveBeenCalledTimes(1)
        })

        it('kayit hash tasimadan gelen hata (imza oncesi) belirsiz SAYILMAZ: siparis iade edilebilir kalir', async () => {
            await boot({ orders: [failedOrder()] })
            getOrderMock.mockResolvedValue(failedState())
            refundMock.mockRejectedValue(new Error('PRIVATE_PROVIDER_DOWN'))
            expect(await refund()).toEqual({ success: false, error: 'PRIVATE_PROVIDER_DOWN' })
            expect(stored().refundTxHash).toBeNull()
            const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(orders[0]).toMatchObject({ refundable: true, refundPending: false })
        })
    })

    describe('kesin ret (dugum islemi kabul etmedi): status-0 makbuzuyla ayni isleme', () => {
        it('PRIVATE_FAILED: kayit temizlenir, Iade geri gelir, ham bayt silinir, ayni siparis yeniden gonderilebilir', async () => {
            await boot({ orders: [failedOrder()] })
            getOrderMock.mockResolvedValue(failedState())
            refundMock.mockImplementationOnce(recordingRefund(H, { fail: { message: 'PRIVATE_FAILED', definitive: true } }))
            expect(await refund()).toEqual({ success: false, error: 'PRIVATE_FAILED' })
            expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true, rawRefundTx: null, lastFailedRefundTxHash: H })
            const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(orders[0]).toMatchObject({ phase: 'problem', refundable: true, refundFailed: true, refundPending: false })
            refundMock.mockImplementationOnce(recordingRefund(H2))
            expect(await refund()).toEqual({ success: true, hash: H2 })
            expect(stored()).toMatchObject({ refundTxHash: H2, refundFailed: false })
        })

        it('PRIVATE_INSUFFICIENT_GAS kodu korunur', async () => {
            await boot({ orders: [failedOrder()] })
            getOrderMock.mockResolvedValue(failedState())
            refundMock.mockImplementationOnce(recordingRefund(H, { fail: { message: 'PRIVATE_INSUFFICIENT_GAS', definitive: true } }))
            expect(await refund()).toEqual({ success: false, error: 'PRIVATE_INSUFFICIENT_GAS' })
            expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true })
        })
    })

    describe('projeksiyon: refundPending / refundFailed (U:M-7)', () => {
        const project = async (over) => {
            await boot({ orders: [failedOrder(over)] })
            const { orders } = await bg.call({ type: 'PRIVATE_ORDERS' })
            return orders[0]
        }

        it('hash kayitli, makbuz yok -> refundPending true', async () => {
            expect(await project({ refundTxHash: H, refundConfirmed: false })).toMatchObject({ phase: 'refunded', refundPending: true, refundFailed: false, refundable: false })
        })

        it('onayli iade -> refundPending false', async () => {
            expect(await project({ refundTxHash: H, refundConfirmed: true })).toMatchObject({ phase: 'refunded', refundPending: false, refundFailed: false })
        })

        it('son iade basarisiz (temizlenmis kayit) -> refundFailed true, Iade acik', async () => {
            expect(await project({ refundTxHash: null, refundFailed: true, lastFailedRefundTxHash: H })).toMatchObject({ phase: 'problem', refundPending: false, refundFailed: true, refundable: true })
        })

        it('hic iade yok -> ikisi de false', async () => {
            expect(await project({})).toMatchObject({ refundPending: false, refundFailed: false })
        })

        it('bozuk bicimli hash bekleyen sayilmaz (RPC e gitmeyen kayit "onay bekleniyor" demez)', async () => {
            expect(await project({ refundTxHash: '0xr', refundConfirmed: false })).toMatchObject({ refundPending: false })
        })
    })

    describe('uzlastirma: makbuzsuz iadenin ham baytini yeniden yayinlar (en cok 1 saat)', () => {
        // Yeniden yayin yalniz keccak256(ham bayt) === kayitli hash iken yapilir (T24 M2): fixture tutarli olmali.
        const HR = keccak256(RAW_REFUND)
        const pending = (over = {}) => failedOrder({ refundTxHash: HR, refundConfirmed: false, rawRefundTx: RAW_REFUND, refundSentAt: Date.now() - 10 * 60 * 1000, ...over })
        let broadcast
        beforeEach(() => { broadcast = vi.spyOn(JsonRpcProvider.prototype, 'broadcastTransaction').mockResolvedValue({}) })

        // SW acilisi da ayni uzlastirmayi calistirir (30 sn'den eski kayitlar icin): boot turu sayilir, sonra sifirlanir.
        it('SW acilisinda da ayni bayt yayinlanir (30 sn den genc iade canli akisa birakilir)', async () => {
            await boot({ orders: [pending()] })
            expect(broadcast).toHaveBeenCalledTimes(1)
            expect(broadcast).toHaveBeenCalledWith(RAW_REFUND)
            broadcast.mockClear()
            await boot({ orders: [pending({ updatedAt: Date.now() - 5000, createdAt: Date.now() - 5000 })] })
            expect(broadcast).not.toHaveBeenCalled()
        })

        it('makbuz yok, 1 saatten genc: AYNI bayt yayinlanir, kayit degismez', async () => {
            await boot({ orders: [pending()] })
            broadcast.mockClear()
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(broadcast).toHaveBeenCalledTimes(1)
            expect(broadcast).toHaveBeenCalledWith(RAW_REFUND)
            expect(stored()).toMatchObject({ refundTxHash: HR, rawRefundTx: RAW_REFUND, refundConfirmed: false })
        })

        it('her yoklamada bir kez daha yayinlanir (tur basina bir)', async () => {
            await boot({ orders: [pending()] })
            broadcast.mockClear()
            await bg.call({ type: 'PRIVATE_ORDERS' })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(broadcast).toHaveBeenCalledTimes(2)
        })

        it('yayin hatasi (ag, already known) yutulur: kayit degismez, hata disari cikmaz', async () => {
            await boot({ orders: [pending()] })
            broadcast.mockRejectedValue(new Error('already known'))
            const res = await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(res.success).toBe(true)
            expect(stored()).toMatchObject({ refundTxHash: HR, rawRefundTx: RAW_REFUND })
        })

        it('1 saati asan iadenin ham bayti SILINIR ve yayinlanmaz; hash kayitli kalir', async () => {
            await boot({ orders: [pending({ refundSentAt: Date.now() - 61 * 60 * 1000 })] })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(broadcast).not.toHaveBeenCalled()
            expect(stored()).toMatchObject({ refundTxHash: HR, rawRefundTx: null, refundConfirmed: false })
        })

        it('gonderim zamani bilinmiyorsa (fail-closed) bayt silinir ve yayinlanmaz', async () => {
            await boot({ orders: [pending({ refundSentAt: undefined })] })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(broadcast).not.toHaveBeenCalled()
            expect(stored().rawRefundTx).toBeNull()
        })

        it('makbuz status 1: onaylanir, bayt silinir, yayin YOK', async () => {
            vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockResolvedValue({ status: 1 })
            await boot({ orders: [pending()] })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(broadcast).not.toHaveBeenCalled()
            expect(stored()).toMatchObject({ refundConfirmed: true, rawRefundTx: null })
        })

        it('makbuz status 0: kayit temizlenir, bayt silinir, yayin YOK', async () => {
            vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockResolvedValue({ status: 0 })
            await boot({ orders: [pending()] })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(broadcast).not.toHaveBeenCalled()
            expect(stored()).toMatchObject({ refundTxHash: null, refundFailed: true, rawRefundTx: null })
        })

        it('makbuz sorgusu hata verirse yayin denenmez (durum bilinmiyor), kayit degismez', async () => {
            vi.spyOn(JsonRpcProvider.prototype, 'getTransactionReceipt').mockRejectedValue(new Error('rpc down'))
            await boot({ orders: [pending()] })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(broadcast).not.toHaveBeenCalled()
            expect(stored()).toMatchObject({ rawRefundTx: RAW_REFUND })
        })

        it('ham bayti olmayan (eski) bekleyen iade yalniz makbuz sorgusu alir, yayin olmaz', async () => {
            await boot({ orders: [pending({ rawRefundTx: undefined })] })
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(broadcast).not.toHaveBeenCalled()
        })

        const rebroadcastLogs = () => console.error.mock.calls.filter((c) => String(c[0]).includes('yeniden yayinlanamadi'))

        // Yatirmayla ayni dogrulama ve sonuc isleme (T24 M1, M2; iade ikizi).
        it('keccak256(ham bayt) kayitli hash ile ESIT DEGILSE: yayin YOK, bayt silinir, hata loglanir', async () => {
            await boot({ orders: [pending({ rawRefundTx: '0x' + 'f2'.repeat(60) })] })
            expect(broadcast).not.toHaveBeenCalled()
            expect(stored()).toMatchObject({ refundTxHash: HR, rawRefundTx: null, refundConfirmed: false })
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining('hash ile uyusmuyor'))
        })

        it('"nonce too low" ve makbuz hala yok: bayt silinir (asla madenlenemez), hash kayitli kalir, hata loglanir', async () => {
            broadcast.mockRejectedValue(new Error('nonce too low: next nonce 4'))
            await boot({ orders: [pending()] })
            expect(stored()).toMatchObject({ refundTxHash: HR, rawRefundTx: null, refundConfirmed: false })
            expect(rebroadcastLogs()).toHaveLength(1)
        })

        it('"already known" LOGLANMAZ; diger hata (ag) loglanir ve bayti SILMEZ', async () => {
            broadcast.mockRejectedValue(new Error('already known'))
            await boot({ orders: [pending()] })
            expect(rebroadcastLogs()).toEqual([])
            expect(stored().rawRefundTx).toBe(RAW_REFUND)
            broadcast.mockRejectedValue(new Error('socket hang up'))
            await bg.call({ type: 'PRIVATE_ORDERS' })
            expect(rebroadcastLogs()).toHaveLength(1)
            expect(stored().rawRefundTx).toBe(RAW_REFUND)
        })

        // T25 M4: ham iade baytlari, yatirmadaki hasStaleRawDeposit gibi, kimse yoklamamis olsa da supurulur.
        describe('eski ham iade baytlari supurulur (T25 M4)', () => {
            const receiptNotQueried = () => expect(JsonRpcProvider.prototype.getTransactionReceipt).not.toHaveBeenCalled()

            it('onayli iadenin kalan bayti RPC olmadan silinir', async () => {
                await boot({ orders: [pending({ refundConfirmed: true })] })
                expect(stored()).toMatchObject({ refundConfirmed: true, rawRefundTx: null })
                receiptNotQueried()
                expect(broadcast).not.toHaveBeenCalled()
            })

            it('basarisiz isaretli / hash i temizlenmis iadenin kalan bayti silinir', async () => {
                await boot({ orders: [pending({ refundFailed: true, refundTxHash: null })] })
                expect(stored()).toMatchObject({ refundTxHash: null, rawRefundTx: null })
                receiptNotQueried()
            })

            it('1 saatlik pencere dolmus ama 24 saat sorgu ufku da asilmis (hic yoklanmamis) kaydin bayti silinir, yayin olmaz', async () => {
                await boot({ orders: [pending({ refundSentAt: Date.now() - 3 * 3600 * 1000, updatedAt: Date.now() - 30 * 3600 * 1000 })] })
                expect(broadcast).not.toHaveBeenCalled()
                expect(stored()).toMatchObject({ refundTxHash: HR, rawRefundTx: null, refundConfirmed: false })
            })

            it('pencere icindeki bekleyen iadenin bayti KORUNUR', async () => {
                await boot({ orders: [pending({ refundSentAt: Date.now() - 30 * 60 * 1000 })] })
                expect(stored().rawRefundTx).toBe(RAW_REFUND)
            })

            it('supurme acik siparis alarmi olmadan da calisir: yoklama (PRIVATE_ORDERS) yolunda silinir', async () => {
                await boot({ orders: [pending()] })
                // Boot sonrasi: kaydi disaridan eskit (onayli yap), liste istegi supurur.
                bg.localStore.private_orders[0] = { ...bg.localStore.private_orders[0], refundConfirmed: true, rawRefundTx: RAW_REFUND }
                await bg.call({ type: 'PRIVATE_ORDERS' })
                expect(stored().rawRefundTx).toBeNull()
            })
        })
    })
})

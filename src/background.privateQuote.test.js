import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getAddress, JsonRpcProvider, AbiCoder, Interface } from 'ethers'
import { parseUsdc, HttpError } from '@silentswap/sdk'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import {
    quoteFixture, orderStateFixture, USDC_BSC_DEST, NATIVE_BNB_DEST, BASE_USDC,
    baseUsdcQuoteFixture, arbitrumNativeQuoteFixture, bridgedErc20QuoteFixture, bridgedNativeQuoteFixture, RELAY_ERC20_ROUTER,
} from './test-utils/silentswapFixtures'
import { DEPOSIT_EXECUTION_PROBE_GAS_CAP } from '@silentswap/chains'
import { PRIVATE_RPC_TIMEOUT_MS } from './utils/privacy/privateOrderExec'
import { usdcTokenOf, nativeTokenOf } from './utils/privacy/deliveryTokens'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'
import supportedChains from './data/supported_chains.json'
import { providerGuard } from './utils/privacy/providerGuard'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

const quoteMock = vi.fn()
// Siparis kaydi (GET /order): varsayilan olarak SON teklif istegi ve teklifinden DOGRU kayit uretir
// (hedef = istenen alici, varlik = istenen dest, imzaci = istek inputAddress). Ret testleri ezer.
const getOrderMock = vi.fn()
async function stateFromLastQuote() {
    const req = quoteMock.mock.calls.at(-1)?.[0]
    const q = await quoteMock.mock.results.at(-1)?.value
    if (!req || !q) return null
    const out = req.outputs[0]
    return orderStateFixture({ ticket: q.ticket, amount: q.amount, signer: req.inputAddress, sourceAsset: req.sourceAsset }, {
        // KAYITTA recipients[0].chainId 56 sabittir (fixture varsayilani); teslim agi yalniz destChainId'dedir (spec 4.4).
        destAddress: out.address, destChainId: out.dest.chainId, destAssetId: out.dest.assetId, destAssetSymbol: out.dest.assetSymbol,
        destAssetDecimals: out.dest.assetDecimals, payoutAmount: q.payoutAmount,
        minDestAmount: q.dest.minDestAmount, expectedDestAmount: q.dest.expectedDestAmount,
    })
}
// ATS bayragi canli sabittir (S2 gecmeden false); ATS teklif testleri bayragi acik varsayar.
const flags = vi.hoisted(() => ({ ats: true, native: true }))
vi.mock('./utils/privacy/silentswapConfig', async (importOriginal) => ({
    ...(await importOriginal()),
    get PRIVATE_ORDER_ATS() { return flags.ats },
    // S3 2026-10-10 gecti: uretimde ACIK. Kapali dal ayri testte sinanir.
    get PRIVATE_DEST_NATIVE() { return flags.native },
}))
vi.mock('@silentswap/sdk', async (importOriginal) => ({
    ...(await importOriginal()),
    createSilentSwapClient: () => ({ quote: (...a) => quoteMock(...a), getOrder: (...a) => getOrderMock(...a), reportDepositTransaction: vi.fn(async () => {}) }),
}))

// SilentSwap durum okumasi (GET /dest-assets, providerGuard) bu dosyada SAHTE bir fetch'ten gelir: gercek aga cikilmaz ve saglayici
// durumu testin icinde belirlenir. Guard'in saati de testin elindedir: durum onbellegi 60 sn, teklif penceresi 60 sn kayar.
const statusFetch = vi.fn()
const guardClock = { t: 1_800_000_000_000 }
const STATUS_OK = { enabled: true, maintenanceMode: false, directEvmPayoutEnabled: false, limits: { minUsdc: 12, maxUsdc: 20010 }, feeBps: 100 }
// Saglayici durumunu degistirir ve saati onbellegin suresini asacak kadar ilerletir (sonraki cagri yeniden okur).
const sagla = (body) => { statusFetch.mockImplementation(async () => ({ ok: true, json: async () => body })); guardClock.t += 61000 }
vi.mock('./utils/privacy/providerGuard', async (importOriginal) => {
    const real = await importOriginal()
    return { ...real, providerGuard: real.createProviderGuard({ fetchImpl: (...a) => statusFetch(...a), now: () => guardClock.t }) }
})

// Gizli siparis ATS teklifi testleri icin: yalniz quoteAtsTransfer taklit edilir (ag cagrisi yok).
const atsQuoteMock = vi.fn()
vi.mock('./utils/atsPaymaster', async (importOriginal) => ({
    ...(await importOriginal()),
    quoteAtsTransfer: (...a) => atsQuoteMock(...a),
}))

const ERC20_IFACE = new Interface(['function approve(address spender, uint256 amount)'])
const GIZLI = { key: 'g-1', address: getAddress('0x' + 'cd'.repeat(20)), type: 'hd', private: true }
const A = { key: 'a-1', address: getAddress('0x' + 'ab'.repeat(20)), type: 'hd' }
const TON_ESKI = { key: 't-1', address: 'UQ' + 'A'.repeat(46), type: 'ton' }
const YABANCI = '0x' + '12'.repeat(20)
const CAKE = { chainId: 56, address: getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'), symbol: 'CAKE', decimals: 18 }
const USDC_TOKEN = usdcTokenOf(56)
const BNB_TOKEN = nativeTokenOf(56)
const CAKE_DEST = { kind: 'evm', chainId: 56, assetId: CAKE.address, assetSymbol: 'CAKE', assetDecimals: 18, minDestAmount: '6000000000000000000', expectedDestAmount: '6500000000000000000' }
const SAYFA = { url: 'https://site.example/', tab: { id: 3, url: 'https://site.example/' } }

let bg
async function boot(active = GIZLI, extra = {}) {
    bg = await bootBackground({
        localStore: { active_account: active, vaults: [{ type: 'hd', accounts: [A, TON_ESKI], privateAccount: GIZLI }], dapps: {}, solana_dapps: {} },
        ...extra,
    })
}
afterEach(teardownBackground)

// outputToken ZORUNLUDUR (chainId dahil, K4): varsayilan BSC USDC'dir ama mesajda ACIKCA tasinir; "alan yok" davranisi ayri sinanir.
const msg = (over) => ({ type: 'PRIVATE_QUOTE', message: { sourceAccountKey: 'a-1', sourceChainId: 56, sourceAsset: 'USDC', outputAddress: GIZLI.address, payoutUsdc: '25', outputToken: USDC_TOKEN, ...over } })
// Gonder (kaynak Gizli Hesap, yabanci alici) mesaji ve onun teklifi: 15 USDC brut, canli Base / Arbitrum olcumu biciminde.
const gonder = (over) => msg({ sourceAccountKey: GIZLI.key, outputAddress: YABANCI, payoutUsdc: '15', ...over })
const kendine = (over) => msg({ sourceAccountKey: GIZLI.key, outputAddress: GIZLI.address, payoutUsdc: '15', ...over })
// GIZLI.address'ten TEK onaltilik hane farkli, kucuk harfli (gecerli) adres: kendine sayilmamali.
const BIR_HANE_FARKLI = (() => { const k = GIZLI.address.toLowerCase(); return k.slice(0, -1) + (k.endsWith('0') ? '1' : '0') })()
const gizliTeklif = (fixture, chainId) => fixture({
    inputAddress: GIZLI.address,
    recipient: { chainId, address: YABANCI },
    recipients: [{ splitIndex: 0, address: YABANCI, chainId, payoutAmount: '14850000000000000000' }],
})

describe('PRIVATE_QUOTE', () => {
    beforeEach(() => {
        quoteMock.mockReset(); getOrderMock.mockReset(); getOrderMock.mockImplementation(stateFromLastQuote); flags.native = true
        statusFetch.mockReset(); sagla(STATUS_OK)
    })

    it('normal modda PRIVACY_MODE_OFF', async () => {
        await boot(A)
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVACY_MODE_OFF' })
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('normal hesaptan Gizli Hesap\'a teklif: ozet doner, teklif oturum deposuna yazilir', async () => {
        await boot()
        quoteMock.mockResolvedValueOnce(quoteFixture())
        const res = await bg.call(msg())
        expect(res.success).toBe(true)
        expect(res.quote).toMatchObject({ ticket: quoteFixture().ticket, payoutUsdc: expect.any(String) })
        const req = quoteMock.mock.calls[0][0]
        expect(req).toMatchObject({ privacy: true, sourceChainId: 56, sourceAsset: 'USDC', inputAddress: A.address })
        // T5 M1: cikti (alici, BSC, brut tutar), USDC dest (canli: dest'siz istek 400), saklanan kayit govdesi.
        expect(req.outputs).toEqual([{ address: GIZLI.address, chainId: 56, amount: parseUsdc('25'), dest: USDC_BSC_DEST }])
        expect('amount' in req).toBe(false)
        const rec = bg.sessionStore.private_quotes[quoteFixture().ticket]
        expect(rec).toMatchObject({
            sourceAccountKey: 'a-1', outputAddress: GIZLI.address, sourceChainId: 56,
            sourceAsset: 'USDC', payoutUsdc: '25', outputToken: USDC_TOKEN, deliveryVersion: 2,
        })
        // Ozet dest agi, sembolu ve ondaligi SECIMDEN gelir (K6); sunucu yankisinda quoteUsd yoksa null.
        expect(res.quote.dest).toEqual({ chainId: 56, asset: 'USDC', decimals: 18, expectedDestAmount: '24650000000000000000', minDestAmount: '24000000000000000000', quoteUsd: null })
        expect(rec.quote.deposit).toMatchObject({ to: quoteFixture().gateway, chainId: 56 })
        expect(rec.quote.ticket).toBe(quoteFixture().ticket)
        expect(typeof rec.createdAt).toBe('number')
        // Gercek chrome.storage JSON tabanlidir: BigInt yazilamaz.
        expect(() => JSON.stringify(bg.sessionStore.private_quotes)).not.toThrow()
        expect(() => JSON.stringify(res)).not.toThrow()
    })

    // A:I-5: ana gonderme girisi. Kaynak Gizli Hesap, alici yabanci adres: istek ve kayit Gizli Hesap adina kurulur.
    it('GONDERME yonu: Gizli Hesap kaynak, yabanci alici: istek inputAddress Gizli Hesap, kayit sourceAccountKey Gizli Hesap', async () => {
        await boot()
        quoteMock.mockResolvedValueOnce(quoteFixture({
            inputAddress: GIZLI.address,
            recipient: { chainId: 56, address: YABANCI },
            recipients: [{ splitIndex: 0, address: YABANCI, chainId: 56, payoutAmount: '25000000000000000000' }],
        }))
        const res = await bg.call(msg({ sourceAccountKey: GIZLI.key, outputAddress: YABANCI }))
        expect(res.success).toBe(true)
        const req = quoteMock.mock.calls[0][0]
        expect(req.inputAddress).toBe(GIZLI.address)
        expect(req.outputs[0].address).toBe(getAddress(YABANCI))
        const rec = bg.sessionStore.private_quotes[quoteFixture().ticket]
        expect(rec).toMatchObject({ sourceAccountKey: GIZLI.key, outputAddress: YABANCI, sourceChainId: 56, sourceAsset: 'USDC', payoutUsdc: '25', outputToken: USDC_TOKEN })
        expect(rec.quote.inputAddress).toBe(GIZLI.address)
    })

    it('kapi: normal hesaptan baska adrese PRIVATE_TRANSFER_TARGET', async () => {
        await boot()
        const res = await bg.call(msg({ outputAddress: YABANCI }))
        expect(res).toEqual({ success: false, error: 'PRIVATE_TRANSFER_TARGET' })
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('teklif baska aliciya donerse PRIVATE_QUOTE_MISMATCH ve kayit yazilmaz', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        quoteMock.mockResolvedValueOnce(quoteFixture({ recipients: [{ splitIndex: 0, address: YABANCI, chainId: 56, payoutAmount: '1' }] }))
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_QUOTE_MISMATCH' })
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    // C1: sahte yatirma islemi tasiyan teklif imzaya ulasmaz, kayit yazilmaz.
    it('sahte yatirma hedefi (deposit.to gateway degil) PRIVATE_UNSUPPORTED ve kayit yazilmaz', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const q = quoteFixture()
        quoteMock.mockResolvedValueOnce({ ...q, deposit: { ...q.deposit, to: q.usdc, data: '0xa9059cbb' + '00'.repeat(64), value: '3000000000000000000' } })
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    it('odeme tutari istenenden farkli teklif PRIVATE_QUOTE_MISMATCH', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        quoteMock.mockResolvedValueOnce(quoteFixture({ payoutAmount: '24000000000000000000' }))
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_QUOTE_MISMATCH' })
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    it('bicim disi ticket PRIVATE_UNSUPPORTED ve kayit yazilmaz', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        quoteMock.mockResolvedValueOnce(quoteFixture({ ticket: '' }))
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    it('bicim disi cikti adresi PRIVATE_UNSUPPORTED (once kapi: Gizli Hesap disi hedef zaten reddedilir)', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const res = await bg.call(msg({ outputAddress: GIZLI.address.slice(2) }))
        // Kapi gecer (gizli hesap kaynak degil, hedef bicim disi), request kurucusu strictAddress ile reddeder.
        expect(res).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(quoteMock).not.toHaveBeenCalled()
    })

    // M2: arayuze yalniz kod gider; hangi pin'e takildigi yalniz konsola yazilir.
    it('sahte yanit reddinin nedeni konsola yazilir, arayuze yalniz kod gider', async () => {
        await boot()
        const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const sahte = getAddress('0x' + 'ee'.repeat(20))
        quoteMock.mockResolvedValueOnce(quoteFixture({ deposit: { ...quoteFixture().deposit, to: sahte } }))
        const res = await bg.call(msg())
        expect(res).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(JSON.stringify(res)).not.toContain('direct.to')
        expect(logSpy.mock.calls.some((args) => args.includes('direct.to'))).toBe(true)
    })

    // G-4: arayuz kurallari erken uyaridir; sinir arka plandir. SDK cagrilmadan reddedilir.
    it('desteklenmeyen zincir ya da varlik PRIVATE_UNSUPPORTED, SDK cagrilmaz', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        for (const over of [{ sourceChainId: 999999 }, { sourceAsset: 'SHIB' }, { sourceAsset: 'usdc' }, { sourceChainId: 56, sourceAsset: undefined }, { sourceChainId: 1, sourceAsset: 'BNB' },
            // Relay yonlendiricisi rotalari (Depository tablosunda yok, privateBridgedSources.js): SDK listesinde olsalar da SDK cagrilmaz.
            { sourceChainId: 56, sourceAsset: 'USDT' }, { sourceChainId: 56, sourceAsset: 'BNB' }, { sourceChainId: 56, sourceAsset: 'DAI' },
            { sourceChainId: 137, sourceAsset: 'DAI' }, { sourceChainId: 137, sourceAsset: 'POL' }, { sourceChainId: 8453, sourceAsset: 'DAI' }]) {
            expect(await bg.call(msg(over)), JSON.stringify(over)).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        }
        expect(quoteMock).not.toHaveBeenCalled()
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    // Koprulu kaynak yalniz Relay Depository rotasinda: Ethereum USDT teklifi kabul edilir; ayni teklif Relay yonlendiricisine
    // giderse (keyfi cagri listesi) arka plan reddeder ve kayit yazilmaz.
    it('koprulu kaynak (Ethereum USDT -> Relay Depository) teklifi kabul edilir; yonlendiriciye giden reddedilir', async () => {
        await boot()
        quoteMock.mockResolvedValueOnce(bridgedErc20QuoteFixture())
        const res = await bg.call(msg({ sourceChainId: 1, sourceAsset: 'USDT' }))
        expect(res.success).toBe(true)
        expect(quoteMock.mock.calls[0][0]).toMatchObject({ privacy: true, sourceChainId: 1, sourceAsset: 'USDT', inputAddress: A.address })
        expect(bg.sessionStore.private_quotes[bridgedErc20QuoteFixture().ticket]).toMatchObject({ sourceChainId: 1, sourceAsset: 'USDT' })

        vi.spyOn(console, 'error').mockImplementation(() => {})
        const yonlendirici = bridgedErc20QuoteFixture({ ticket: '0x' + '02'.repeat(32), deposit: { ...bridgedErc20QuoteFixture().deposit, to: RELAY_ERC20_ROUTER } })
        quoteMock.mockResolvedValueOnce(yonlendirici)
        expect(await bg.call(msg({ sourceChainId: 1, sourceAsset: 'USDT' }))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(bg.sessionStore.private_quotes[yonlendirici.ticket]).toBeUndefined()
    })

    // U-M5: takili saglayici busy dugmesini sonsuza dek tutmaz. Chrome 30 sn'den gec yanitli fetch'te servis calisanini sonlandirir:
    // tek bir teklif istegi 28 sn'de biter; yalniz TEKLIF zaman asiminda bir kez yeni istek atilir (olculen yavas ilk teklif 27-30 sn, tekrar 1-3 sn).
    it('teklif 28 sn te donmezse bir kez yeniden istenir; ikinci de donmezse (56 sn) PRIVATE_PROVIDER_DOWN, SDK tam iki kez cagrilir', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        quoteMock.mockImplementation(() => new Promise(() => {}))
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        try {
            const p = bg.call(msg())
            let done = false
            p.then(() => { done = true })
            await vi.advanceTimersByTimeAsync(27999)
            expect(quoteMock).toHaveBeenCalledTimes(1)
            await vi.advanceTimersByTimeAsync(1)
            expect(quoteMock).toHaveBeenCalledTimes(2)
            expect(done).toBe(false)
            await vi.advanceTimersByTimeAsync(27999)
            expect(done).toBe(false)
            await vi.advanceTimersByTimeAsync(1)
            expect(await p).toEqual({ success: false, error: 'PRIVATE_PROVIDER_DOWN' })
        } finally {
            vi.useRealTimers()
        }
        expect(quoteMock).toHaveBeenCalledTimes(2)
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    it('ilk teklif 28 sn te zaman asimina ugrar, ikinci istek doner: teklif kabul edilir ve kaydedilir', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        quoteMock.mockImplementationOnce(() => new Promise(() => {}))
        quoteMock.mockResolvedValueOnce(quoteFixture())
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        let res
        try {
            const p = bg.call(msg())
            await vi.advanceTimersByTimeAsync(28000)
            res = await p
        } finally {
            vi.useRealTimers()
        }
        expect(res.success).toBe(true)
        expect(quoteMock).toHaveBeenCalledTimes(2)
        // Tekrar ayni istegi tasir (ikinci istek ilkinin birebir aynisidir).
        expect(quoteMock.mock.calls[1][0]).toEqual(quoteMock.mock.calls[0][0])
        expect(bg.sessionStore.private_quotes[quoteFixture().ticket]).toBeDefined()
    })

    it('fetch sarmalayicisinin TimeoutError / AbortError reddi de zaman asimidir: bir kez yeniden istenir', async () => {
        for (const ad of ['TimeoutError', 'AbortError']) {
            quoteMock.mockReset(); getOrderMock.mockReset(); getOrderMock.mockImplementation(stateFromLastQuote)
            await boot()
            vi.spyOn(console, 'error').mockImplementation(() => {})
            quoteMock.mockRejectedValueOnce(new DOMException('zaman asimi', ad))
            quoteMock.mockResolvedValueOnce(quoteFixture())
            const res = await bg.call(msg())
            expect(res.success, ad).toBe(true)
            expect(quoteMock, ad).toHaveBeenCalledTimes(2)
            await teardownBackground()
        }
    })

    it('zaman asimi disindaki hatalar (HTTP 5xx, 429, ag hatasi, alt sinir) ASLA yeniden denenmez', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const { AmountOutOfRangeError } = await import('@silentswap/sdk')
        const cases = [
            [new HttpError(503, { error: 'x' }), 'PRIVATE_PROVIDER_DOWN'],
            [new HttpError(429, {}), 'PRIVATE_RATE_LIMITED'],
            [new TypeError('Failed to fetch'), 'PRIVATE_PROVIDER_DOWN'],
            [new AmountOutOfRangeError('amount_below_minimum', {}), 'PRIVATE_MIN_AMOUNT'],
        ]
        for (const [hata, kod] of cases) {
            quoteMock.mockReset()
            quoteMock.mockRejectedValueOnce(hata)
            const res = await bg.call(msg())
            expect(res.error, kod).toBe(kod)
            expect(quoteMock, kod).toHaveBeenCalledTimes(1)
        }
    })

    it('yerel hiz penceresi dolmussa zaman asimindan sonra ikinci istek ATILMAZ (15. teklif son), ilk hata doner', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        for (let i = 0; i < 14; i++) providerGuard.takeQuoteSlot()
        quoteMock.mockImplementation(() => new Promise(() => {}))
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        let res
        try {
            const p = bg.call(msg())
            await vi.advanceTimersByTimeAsync(28000)
            res = await p
        } finally {
            vi.useRealTimers()
        }
        expect(res).toEqual({ success: false, error: 'PRIVATE_PROVIDER_DOWN' })
        expect(quoteMock).toHaveBeenCalledTimes(1)
    })

    it('tekrar da hiz penceresinden bir yuva harcar: 14 yuva doluyken ilk teklif + tekrar = 16. istek olmaz, 13 doluyken olur', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        for (let i = 0; i < 13; i++) providerGuard.takeQuoteSlot()
        quoteMock.mockImplementationOnce(() => new Promise(() => {}))
        quoteMock.mockResolvedValueOnce(quoteFixture())
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        let res
        try {
            const p = bg.call(msg())
            await vi.advanceTimersByTimeAsync(28000)
            res = await p
        } finally {
            vi.useRealTimers()
        }
        expect(res.success).toBe(true)
        expect(quoteMock).toHaveBeenCalledTimes(2)
        // 13 + ilk + tekrar = 15 yuva dolu: bir sonraki teklif PRIVATE_RATE_LIMITED, SDK'ya gitmez.
        quoteMock.mockClear()
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_RATE_LIMITED' })
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('tekrardan once SW bosta sayaci icin tek ucuz eklenti cagrisi yapilir: yalniz tekrar yolunda, ikinci istekten once; cagri atsa da tekrar durmaz', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const timeoutErr = () => new DOMException('zaman asimi', 'TimeoutError')
        // Yol A: tekrarsiz (ilk teklif basarili) -> toplam oturum okumasi tabani verir.
        await boot()
        let getCount = 0
        const sarGet = () => {
            const gercek = bg.chrome.storage.session.get
            bg.chrome.storage.session.get = vi.fn(async (...a) => { getCount++; return gercek(...a) })
        }
        sarGet()
        quoteMock.mockResolvedValueOnce(quoteFixture())
        expect((await bg.call(msg())).success).toBe(true)
        const taban = getCount
        await teardownBackground()
        // Yol B: bir zaman asimi + tekrar -> tabana TAM BIR okuma eklenir ve o okuma iki istek ARASINDA olur.
        quoteMock.mockReset(); getOrderMock.mockReset(); getOrderMock.mockImplementation(stateFromLastQuote)
        await boot()
        getCount = 0
        sarGet()
        const arada = []
        quoteMock.mockImplementationOnce(async () => { arada.push(['q1', getCount]); throw timeoutErr() })
        quoteMock.mockImplementationOnce(async () => { arada.push(['q2', getCount]); return quoteFixture() })
        expect((await bg.call(msg())).success).toBe(true)
        expect(quoteMock).toHaveBeenCalledTimes(2)
        expect(getCount).toBe(taban + 1)
        expect(arada[1][1] - arada[0][1]).toBe(1)
        expect(bg.chrome.storage.session.get).toHaveBeenCalledWith('private_quotes')
        await teardownBackground()
        // Yol C: cagri atarsa tekrar yine de atilir ve teklif tamamlanir.
        quoteMock.mockReset(); getOrderMock.mockReset(); getOrderMock.mockImplementation(stateFromLastQuote)
        await boot()
        const gercekGet = bg.chrome.storage.session.get
        bg.chrome.storage.session.get = vi.fn(async (...a) => {
            if (quoteMock.mock.calls.length === 1) throw new Error('eklenti API atti')
            return gercekGet(...a)
        })
        quoteMock.mockRejectedValueOnce(timeoutErr())
        quoteMock.mockResolvedValueOnce(quoteFixture())
        expect((await bg.call(msg())).success).toBe(true)
        expect(quoteMock).toHaveBeenCalledTimes(2)
    })

    it('SDK alt sinir hatasi PRIVATE_MIN_AMOUNT; ham tutar insan birimine cevrilip limitUsdc olarak gider, okunamazsa alan yoktur', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const { AmountOutOfRangeError } = await import('@silentswap/sdk')
        quoteMock.mockRejectedValueOnce(new AmountOutOfRangeError('amount_below_minimum', { minPayoutAmount: '30000000', usdcDecimals: 6 }))
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_MIN_AMOUNT', limitUsdc: '30' })
        quoteMock.mockRejectedValueOnce(new AmountOutOfRangeError('amount_below_minimum', {}))
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_MIN_AMOUNT' })
    })

    it('hata teshis icin console.error ile ham olarak kaydedilir', async () => {
        await boot()
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const boom = new Error('ag koptu')
        quoteMock.mockRejectedValueOnce(boom)
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        expect(spy).toHaveBeenCalledWith('[private] teklif basarisiz:', boom)
    })

    it('sayfa kokeni: PRIVATE_QUOTE dahili aksiyondur, 4100 (method icinde gizlenmis olsa da)', async () => {
        await boot()
        const red = { error: { code: 4100, message: 'Unauthorized' } }
        expect(await bg.call({ type: 'PRIVATE_QUOTE', message: {} }, SAYFA)).toEqual(red)
        expect(await bg.call({ method: 'PRIVATE_QUOTE', message: {} }, SAYFA)).toEqual(red)
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('sahte yuk: kapi sayfanin account nesnesine degil kasadaki hesaba bakar', async () => {
        await boot()
        const res = await bg.call(msg({ account: GIZLI, outputAddress: YABANCI }))
        expect(res).toEqual({ success: false, error: 'PRIVATE_TRANSFER_TARGET' })
        expect(quoteMock).not.toHaveBeenCalled()
    })

    // D5 / K4: eski `outputAsset` dizgesi artik kabul edilmez; chainId'siz ya da bozuk token sessizce BSC USDC'ye donmez.
    it('outputToken yok, chainId yok ya da eski outputAsset dizgesi: PRIVATE_UNSUPPORTED; durum okumasi ve SDK cagrilmaz', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        for (const over of [
            { outputToken: undefined }, { outputToken: undefined, outputAsset: 'USDC' }, { outputToken: undefined, outputAsset: 'BNB' },
            { outputToken: { ...USDC_TOKEN, chainId: undefined } }, { outputToken: { ...USDC_TOKEN, chainId: 99999 } }, { outputToken: { ...USDC_TOKEN, chainId: 56.5 } },
        ]) {
            expect(await bg.call(msg(over)), JSON.stringify(over)).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        }
        expect(statusFetch).not.toHaveBeenCalled()
        expect(quoteMock).not.toHaveBeenCalled()
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    // S3: BNB teslimi native dest ile istenir; ozet varligi secimden (outputToken) BNB / 18 olarak tasinir.
    // Teslim degismezi (1.10): BNB Gonder kaynagi degil, yani yalniz Gonder'de (alici dis adres) teslim edilebilir.
    it('Gonder: BNB teslimi acikken (nesne bicimi outputToken): istek native dest tasir, kayit outputToken BNB, ozet dest.asset BNB / 18', async () => {
        await boot()
        quoteMock.mockResolvedValueOnce(quoteFixture({
            dest: { ...NATIVE_BNB_DEST, minDestAmount: '19141870245296857', expectedDestAmount: '19729818846935537' }, inputAddress: GIZLI.address,
            recipient: { chainId: 56, address: YABANCI },
            recipients: [{ splitIndex: 0, address: YABANCI, chainId: 56, payoutAmount: '25000000000000000000' }],
        }))
        const res = await bg.call(gonder({ payoutUsdc: '25', outputToken: { chainId: 56, address: '0x0000000000000000000000000000000000000000', symbol: 'BNB', decimals: 18 } }))
        expect(res.success).toBe(true)
        const dest = quoteMock.mock.calls[0][0].outputs[0].dest
        expect(dest).toEqual(NATIVE_BNB_DEST)
        expect(dest).toMatchObject({ assetId: '0x0000000000000000000000000000000000000000', chainId: 56 })
        expect(res.quote.dest).toEqual({ chainId: 56, asset: 'BNB', decimals: 18, expectedDestAmount: '19729818846935537', minDestAmount: '19141870245296857', quoteUsd: null })
        expect(bg.sessionStore.private_quotes[quoteFixture().ticket]).toMatchObject({ outputToken: BNB_TOKEN, payoutUsdc: '25' })
    })

    // Gonder, BSC disi ag, yerel coin: dest sifir adres, sembol ve ondalik tablodan (ETH / 18), sunucu yankisindan degil.
    it('Gonder: Arbitrum yerel coin (ETH) teslimi: istek 42161 sifir adresli dest tasir, kayit chainId ve surum 2, ozet secimden', async () => {
        await boot()
        quoteMock.mockResolvedValueOnce(gizliTeklif(arbitrumNativeQuoteFixture, 42161))
        const res = await bg.call(gonder({ outputToken: nativeTokenOf(42161) }))
        expect(res.success).toBe(true)
        expect(quoteMock.mock.calls[0][0].outputs[0]).toMatchObject({
            chainId: 42161, dest: { chainId: 42161, assetId: '0x0000000000000000000000000000000000000000', assetSymbol: 'ETH', assetDecimals: 18 },
        })
        expect(res.quote.dest).toEqual({ chainId: 42161, asset: 'ETH', decimals: 18, expectedDestAmount: '6153854783951967', minDestAmount: '5970469911390198', quoteUsd: 14.739282208687 })
        expect(bg.sessionStore.private_quotes[quoteFixture().ticket]).toMatchObject({ deliveryVersion: 2, outputToken: nativeTokenOf(42161) })
    })

    // M2-m8: paranin gidecegi yer siparis kaydinin destAddress'i. Teklif yankisi dogru olsa bile kayit baska
    // adrese/varliga gidiyorsa teklif kullaniciya gosterilmez ve saklanmaz.
    it('siparis kaydi ticket ve erisim anahtariyla okunur', async () => {
        await boot()
        quoteMock.mockResolvedValueOnce(quoteFixture())
        expect((await bg.call(msg())).success).toBe(true)
        expect(getOrderMock).toHaveBeenCalledWith({ id: quoteFixture().ticket, privacy: true, accessToken: quoteFixture().accessToken })
    })

    it('siparis kaydinin destAddress i baska adresse PRIVATE_QUOTE_MISMATCH, kayit yazilmaz', async () => {
        await boot()
        quoteMock.mockResolvedValueOnce(quoteFixture())
        getOrderMock.mockImplementationOnce(async () => orderStateFixture({ signer: A.address }, { destAddress: YABANCI }))
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_QUOTE_MISMATCH' })
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    it('siparis kaydi USDC istenirken BNB teslim ediyorsa PRIVATE_QUOTE_MISMATCH', async () => {
        await boot()
        quoteMock.mockResolvedValueOnce(quoteFixture())
        getOrderMock.mockImplementationOnce(async () => orderStateFixture({ signer: A.address }, { destAssetId: '0x0000000000000000000000000000000000000000' }))
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_QUOTE_MISMATCH' })
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    it('siparis kaydi okunamazsa teklif reddedilir (fail-closed), kayit yazilmaz', async () => {
        await boot()
        quoteMock.mockResolvedValueOnce(quoteFixture())
        getOrderMock.mockImplementationOnce(async () => { throw new HttpError(404, { error: 'not_found' }) })
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_PROVIDER_ERROR' })
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    // Alt proje 1: alici secilen BSC tokenini alir; sembol/ondalik sunucu yankisindan degil secimden.
    it('Gonder: secilen BSC tokeni (CAKE): istek CAKE dest tasir, kayit outputToken, ozet sembol/ondalik secimden', async () => {
        await boot()
        quoteMock.mockResolvedValueOnce(quoteFixture({
            dest: { ...CAKE_DEST, assetSymbol: 'SAHTE', assetDecimals: 6 }, inputAddress: GIZLI.address,
            recipient: { chainId: 56, address: YABANCI },
            recipients: [{ splitIndex: 0, address: YABANCI, chainId: 56, payoutAmount: '25000000000000000000' }],
        }))
        const res = await bg.call(gonder({ outputToken: CAKE, payoutUsdc: '25' }))
        expect(res.success).toBe(true)
        expect(quoteMock.mock.calls[0][0].outputs[0].dest).toEqual({ kind: 'evm', chainId: 56, assetId: CAKE.address, assetSymbol: 'CAKE', assetDecimals: 18 })
        expect(res.quote.dest).toEqual({ chainId: 56, asset: 'CAKE', decimals: 18, expectedDestAmount: '6500000000000000000', minDestAmount: '6000000000000000000', quoteUsd: null })
        expect(bg.sessionStore.private_quotes[quoteFixture().ticket]).toMatchObject({ outputToken: CAKE })
    })

    // 1.10 teslim degismezi: Para yukle'de Gizli Hesap'a teslim edilen varlik yalniz Gonder ile cikabilir (ATS satisi ve uretimde Takas/Kopru kapali; gelistirmede kendine Takas/Kopru da ayni kurala tabidir), yani
    // teslim = yalniz o agdaki Gonder kaynagi varliklari (yerel coin gaz istisnasi yok: ag ucreti ATS). Gonder kaynagi olmayan varlik saglayiciya, durum okumasina hic gitmeden reddedilir.
    it('Para yukle: Gonder kaynagi olmayan varlik (CAKE, BSC ATS, rastgele Base tokeni) PRIVATE_UNSUPPORTED; SDK, durum okumasi ve kayit yok', async () => {
        await boot()
        const ATS = { chainId: 56, address: getAddress('0xa184088a740c695E156F91f5cC086a06bb78b827'), symbol: 'ATS', decimals: 18 }
        const RASTGELE_BASE = { chainId: 8453, address: getAddress('0x' + '55'.repeat(20)), symbol: 'RAND', decimals: 18 }
        for (const outputToken of [CAKE, ATS, RASTGELE_BASE]) {
            expect(await bg.call(msg({ outputToken })), outputToken.symbol).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        }
        expect(quoteMock).not.toHaveBeenCalled()
        expect(statusFetch).not.toHaveBeenCalled()
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    it('Para yukle: Gonder kaynagi varliklari reddedilmez (BSC USDC, Base ETH); Gonder kaynagi olmayan yerel coin (BNB, POL) reddedilir', async () => {
        await boot()
        // Teslim degismezi gecidinden gecer: istek saglayiciya (teklif cagrisi) kadar ulasir.
        for (const outputToken of [USDC_TOKEN, nativeTokenOf(8453)]) {
            quoteMock.mockClear()
            await bg.call(msg({ outputToken }))
            expect(quoteMock, outputToken.symbol).toHaveBeenCalledTimes(1)
        }
        // Ag ucreti ATS ile odenir: yerel coin gaz istisnasi yok. BNB ve POL Gonder kaynagi degil, saglayiciya hic gidilmez.
        quoteMock.mockClear()
        statusFetch.mockClear()
        for (const outputToken of [BNB_TOKEN, nativeTokenOf(137)]) {
            expect(await bg.call(msg({ outputToken })), outputToken.symbol).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        }
        expect(quoteMock).not.toHaveBeenCalled()
        expect(statusFetch).not.toHaveBeenCalled()
    })

    it('Gizli -> kendine: Gonder kaynagi olmayan varlik (BNB, POL, xDAI, BSC ATS, CAKE, rastgele Base tokeni) PRIVATE_UNSUPPORTED; SDK, durum okumasi ve kayit yok', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await boot()
        const ATS = { chainId: 56, address: getAddress('0xa184088a740c695E156F91f5cC086a06bb78b827'), symbol: 'ATS', decimals: 18 }
        const RASTGELE_BASE = { chainId: 8453, address: getAddress('0x' + '55'.repeat(20)), symbol: 'RAND', decimals: 18 }
        for (const outputToken of [BNB_TOKEN, nativeTokenOf(137), nativeTokenOf(100), ATS, CAKE, RASTGELE_BASE]) {
            expect(await bg.call(kendine({ outputToken })), outputToken.symbol).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        }
        expect(quoteMock).not.toHaveBeenCalled()
        expect(statusFetch).not.toHaveBeenCalled()
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    it('Gizli -> kendine: kucuk harfli Gizli adres de kendine sayilir (BNB PRIVATE_UNSUPPORTED, SDK ve durum okumasi cagrilmaz)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await boot()
        expect(await bg.call(kendine({ outputAddress: GIZLI.address.toLowerCase(), outputToken: BNB_TOKEN }))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(quoteMock).not.toHaveBeenCalled()
        expect(statusFetch).not.toHaveBeenCalled()
    })

    it('Gizli -> kendine: Gonder kaynagi varliklari reddedilmez (BSC USDC, Base ETH): teklif saglayiciya kadar ulasir', async () => {
        await boot()
        for (const outputToken of [USDC_TOKEN, nativeTokenOf(8453)]) {
            quoteMock.mockClear()
            await bg.call(kendine({ outputToken }))
            expect(quoteMock, outputToken.symbol).toHaveBeenCalledTimes(1)
        }
    })

    it('Gizli -> kendine: Para yukle listesi YALNIZ BSC iken (Gonder listesi genis) Base teslimi PRIVATE_CHAIN_CLOSED; ayni tokenle Gonder (yabanci alici) reddedilmez', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await boot()
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56')
        expect(await bg.call(kendine({ outputToken: usdcTokenOf(8453) }))).toEqual({ success: false, error: 'PRIVATE_CHAIN_CLOSED' })
        expect(statusFetch).not.toHaveBeenCalled()
        expect(quoteMock).not.toHaveBeenCalled()
        expect(bg.sessionStore.private_quotes).toBeUndefined()
        const gonderRes = await bg.call(gonder({ outputToken: usdcTokenOf(8453) }))
        expect(gonderRes.error).not.toBe('PRIVATE_CHAIN_CLOSED')
        expect(quoteMock).toHaveBeenCalledTimes(1)
    })

    it('Gizli -> bir hane farkli adres: kendine DEGIL, Gonder kurallari (BNB ve CAKE reddedilmez, teklif saglayiciya ulasir)', async () => {
        await boot()
        for (const outputToken of [BNB_TOKEN, CAKE]) {
            quoteMock.mockClear()
            await bg.call(kendine({ outputAddress: BIR_HANE_FARKLI, outputToken }))
            expect(quoteMock, outputToken.symbol).toHaveBeenCalledTimes(1)
        }
    })

    it('bozuk outputToken PRIVATE_UNSUPPORTED, SDK cagrilmaz', async () => {
        await boot()
        expect(await bg.call(msg({ outputToken: { ...CAKE, decimals: 99 } }))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('hisse tokeni (bStock/xStock) teslimi PRIVATE_UNSUPPORTED: SDK, saglayici durumu ve kayit yok', async () => {
        await boot()
        const CRCLB = { chainId: 56, address: getAddress('0x80f3D493EBCe97e343c53D29a137942416B4ffC0'), symbol: 'CRCLB', decimals: 18 }
        const TSLAX = { chainId: 1, address: getAddress('0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0'), symbol: 'TSLAx', decimals: 18 }
        expect(await bg.call(msg({ outputToken: CRCLB }))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(await bg.call(gonder({ outputToken: CRCLB }))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(await bg.call(gonder({ outputToken: TSLAX }))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(quoteMock).not.toHaveBeenCalled()
        expect(statusFetch).not.toHaveBeenCalled()
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })
    it('yerel teslim kapaliyken sifir adresli outputToken PRIVATE_UNSUPPORTED, SDK cagrilmaz', async () => {
        flags.native = false
        await boot()
        expect(await bg.call(msg({ outputToken: BNB_TOKEN }))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        // Bayrak BSC disi aglar icin de gecerlidir: Base ETH'i sessizce USDC'ye ya da baska bir teslime donmez.
        expect(await bg.call(gonder({ outputToken: nativeTokenOf(8453) }))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(quoteMock).not.toHaveBeenCalled()
    })

    // ---- Cok agli teslim (gizli-mod cok-ag spec 4.1-4.4) ----

    it('Gonder: Base USDC teslimi: istek 8453 dest tasir (odeme zinciri 56 kalir), kayit chainId ve surum 2, ozet dest.chainId 8453', async () => {
        await boot()
        quoteMock.mockResolvedValueOnce(gizliTeklif(baseUsdcQuoteFixture, 8453))
        const res = await bg.call(gonder({ outputToken: usdcTokenOf(8453) }))
        expect(res.success).toBe(true)
        const req = quoteMock.mock.calls[0][0]
        // sourceChainId gateway/odeme zinciridir (56) ve teslim agiyla birlesmez; teslim agi yalniz alici ve dest'tedir.
        expect(req).toMatchObject({ privacy: true, sourceChainId: 56, sourceAsset: 'USDC', inputAddress: GIZLI.address })
        expect(req.outputs).toEqual([{
            address: getAddress(YABANCI), chainId: 8453, amount: parseUsdc('15'),
            dest: { kind: 'evm', chainId: 8453, assetId: BASE_USDC, assetSymbol: 'USDC', assetDecimals: 6 },
        }])
        expect(res.quote.dest).toEqual({ chainId: 8453, asset: 'USDC', decimals: 6, expectedDestAmount: '14787310', minDestAmount: '14346647', quoteUsd: 14.78160209834 })
        const rec = bg.sessionStore.private_quotes[quoteFixture().ticket]
        expect(rec).toMatchObject({ sourceAccountKey: GIZLI.key, sourceChainId: 56, payoutUsdc: '15', deliveryVersion: 2, outputToken: usdcTokenOf(8453) })
        expect(getOrderMock).toHaveBeenCalledTimes(1)
    })

    it('Para yukle: Base secimi PRIVATE_CHAIN_CLOSED (ekran kaynak hesaptan, mesajdaki alanlardan degil); durum okumasi, SDK ve siparis kaydi cagrilmaz', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        // Kaynak a-1 genel hesaptir: ekran 'fund', Para yukle listesi yalniz BSC (test ortami on ag acar; magaza gibi daraltilir). Sahte ekran alanlari yok sayilir.
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56')
        const res = await bg.call(msg({ payoutUsdc: '15', outputToken: usdcTokenOf(8453), screen: 'send', mode: 'send' }))
        expect(res).toEqual({ success: false, error: 'PRIVATE_CHAIN_CLOSED' })
        expect(statusFetch).not.toHaveBeenCalled()
        expect(quoteMock).not.toHaveBeenCalled()
        expect(getOrderMock).not.toHaveBeenCalled()
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    // PF-C1: ekran, kapinin imzaci kimlik kuralindan turetilir (signerIsThePrivateAccount): kasada Gizli Hesap kayitliyken
    // `private` bayragi almis BASKA bir genel hesap Gonder ayricaligini alamaz; ekran 'fund' kalir ve Base kapali olur.
    it('bayrakli genel hesap + kasada baska kayitli Gizli Hesap: ekran fund, Base PRIVATE_CHAIN_CLOSED; SDK ve durum okumasi cagrilmaz', async () => {
        const BAYRAKLI = { ...A, private: true }
        await boot(BAYRAKLI, {
            localStore: { active_account: BAYRAKLI, vaults: [{ type: 'hd', accounts: [BAYRAKLI, TON_ESKI], privateAccount: GIZLI }], dapps: {}, solana_dapps: {} },
        })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56')
        expect(await bg.call(msg({ outputToken: usdcTokenOf(8453), payoutUsdc: '15' }))).toEqual({ success: false, error: 'PRIVATE_CHAIN_CLOSED' })
        expect(statusFetch).not.toHaveBeenCalled()
        expect(quoteMock).not.toHaveBeenCalled()
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    it('derleme listesi: Gonder listesinde olmayan ag PRIVATE_CHAIN_CLOSED; liste bossa ya da Para yukle listesi Gonder listesinin altkumesi degilse BSC bile kapali (fail-closed)', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const kapali = { success: false, error: 'PRIVATE_CHAIN_CLOSED' }
        vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', '56')
        expect(await bg.call(gonder({ outputToken: usdcTokenOf(8453) }))).toEqual(kapali)
        // Bos Gonder listesi: Gonder kapali, Para yukle listesi ('56') altkume degismezini bozdugu icin o da kapali.
        vi.stubEnv('VITE_PRIVATE_SEND_CHAINS', '')
        expect(await bg.call(gonder())).toEqual(kapali)
        expect(await bg.call(msg())).toEqual(kapali)
        expect(statusFetch).not.toHaveBeenCalled()
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('saglayici bakimda (enabled false ya da maintenanceMode true): PRIVATE_PROVIDER_DOWN, teklif istenmez', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        for (const durum of [{ ...STATUS_OK, enabled: false }, { ...STATUS_OK, maintenanceMode: true }]) {
            sagla(durum)
            expect(await bg.call(msg()), JSON.stringify(durum)).toEqual({ success: false, error: 'PRIVATE_PROVIDER_DOWN' })
        }
        expect(statusFetch).toHaveBeenCalledTimes(2)
        expect(quoteMock).not.toHaveBeenCalled()
        expect(bg.sessionStore.private_quotes).toBeUndefined()
    })

    it('tutar siniri: yerlesik en az 12, sunucu daha yuksek bildirirse o, en cok 20010; limitUsdc yanita girer, SDK cagrilmaz', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const durumlar = [
            [STATUS_OK, '5', 'PRIVATE_MIN_AMOUNT', '12'],
            [{ ...STATUS_OK, limits: { minUsdc: 20, maxUsdc: 20010 } }, '15', 'PRIVATE_MIN_AMOUNT', '20'],
            [STATUS_OK, '20011', 'PRIVATE_MAX_AMOUNT', '20010'],
        ]
        for (const [durum, tutar, kod, sinir] of durumlar) {
            sagla(durum)
            expect(await bg.call(msg({ payoutUsdc: tutar })), tutar).toEqual({ success: false, error: kod, limitUsdc: sinir })
        }
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('durum okunamazsa engel konmaz: yerlesik 12 gecerli, teklif istenir', async () => {
        await boot()
        statusFetch.mockImplementation(async () => { throw new Error('ag yok') })
        quoteMock.mockResolvedValueOnce(quoteFixture())
        expect((await bg.call(msg())).success).toBe(true)
        expect(statusFetch).toHaveBeenCalledTimes(1)
        expect(quoteMock).toHaveBeenCalledTimes(1)
    })

    it('hiz penceresi: 15 teklif gecer, 16.si SDK cagrilmadan PRIVATE_RATE_LIMITED; pencere kayinca yeniden acilir', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        quoteMock.mockRejectedValue(new Error('x'))
        for (let i = 0; i < 15; i++) expect(await bg.call(msg()), 'cagri ' + (i + 1)).toEqual({ success: false, error: 'PRIVATE_FAILED' })
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_RATE_LIMITED' })
        expect(quoteMock).toHaveBeenCalledTimes(15)
        guardClock.t += 61000
        quoteMock.mockResolvedValueOnce(quoteFixture())
        expect((await bg.call(msg())).success).toBe(true)
        expect(quoteMock).toHaveBeenCalledTimes(16)
    })

    it('sunucu hatalari: etki yuksek (400 SWAP_IMPACT_TOO_HIGH) ve hiz siniri (429) kendi kodlariyla doner', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        quoteMock.mockRejectedValueOnce(new HttpError(400, { error: 'relay_preflight_failed', errorCode: 'SWAP_IMPACT_TOO_HIGH' }))
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_IMPACT_TOO_HIGH' })
        quoteMock.mockRejectedValueOnce(new HttpError(429, { error: 'rate_limited' }))
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_RATE_LIMITED' })
    })

    it('bilinmeyen sourceAccountKey PRIVATE_UNSUPPORTED', async () => {
        await boot()
        expect(await bg.call(msg({ sourceAccountKey: 'yok' }))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('EVM disi zincir (TON -239) PRIVATE_EVM_ONLY', async () => {
        await boot()
        expect(await bg.call(msg({ sourceChainId: -239 }))).toEqual({ success: false, error: 'PRIVATE_EVM_ONLY' })
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('EVM anahtari olmayan eski ton kaynak PRIVATE_EVM_ONLY', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(await bg.call(msg({ sourceAccountKey: 't-1' }))).toEqual({ success: false, error: 'PRIVATE_EVM_ONLY' })
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('depo okunamazsa PRIVATE_CHECK_FAILED (fail-closed), SDK cagrilmaz', async () => {
        await boot()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        bg.chrome.storage.local.get.mockRejectedValueOnce(new Error('disk'))
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVATE_CHECK_FAILED' })
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('ozellik bayragi kapaliyken PRIVACY_DISABLED, SDK cagrilmaz', async () => {
        await boot(GIZLI, { privacyFlag: 'false' })
        expect(await bg.call(msg())).toEqual({ success: false, error: 'PRIVACY_DISABLED' })
        expect(quoteMock).not.toHaveBeenCalled()
    })
})

describe('ATS_PRIVATE_FEE_QUOTE', () => {
    const USDC_BSC = quoteFixture().usdc
    const GATEWAY = quoteFixture().gateway
    const TICKET = quoteFixture().ticket
    const ATS_QUOTE = { ready: true, transferFee: 2, symbol: 'ATS', gas: { callGasLimit: 100000n }, maxPriorityFeePerGas: 1n, feeRaw: '2000' }
    const seedRecord = (quote = quoteFixture()) => ({ [quote.ticket]: { createdAt: Date.now(), quote, sourceAccountKey: 'a-1', sourceChainId: 56, outputAddress: GIZLI.address } })
    // G-1'in sizinti hali: saklanan kaydin KAYNAGI Gizli Hesap (GONDERME yonu), teklif normal modda istenir.
    const seedPrivateSource = () => {
        const quote = quoteFixture({ inputAddress: GIZLI.address })
        return { [quote.ticket]: { createdAt: Date.now(), quote, sourceAccountKey: GIZLI.key, sourceChainId: 56, outputAddress: YABANCI } }
    }
    const atsMsg = (over) => ({ type: 'ATS_PRIVATE_FEE_QUOTE', message: { ticket: TICKET, ...over } })

    // T6: kaynak token ATS yolunda artik izin (allowance) bir kez okunur. Okuma ethers sozlesme cagrisidir; gercek aga cikilmaz:
    // JsonRpcProvider.prototype.call taklit edilir (varsayilan izin 0).
    const okuma = { cagrilar: [], deger: 0n, hata: null }
    let callSpy
    let destroySpy
    beforeEach(() => {
        atsQuoteMock.mockReset(); flags.ats = true
        okuma.cagrilar = []; okuma.deger = 0n; okuma.hata = null
        callSpy = vi.spyOn(JsonRpcProvider.prototype, 'call').mockImplementation(async function (tx) {
            const baglanti = this._getConnection()
            okuma.cagrilar.push({ to: tx.to, data: tx.data, rpc: baglanti.url, timeout: baglanti.timeout })
            if (okuma.hata) throw okuma.hata
            return AbiCoder.defaultAbiCoder().encode(['uint256'], [okuma.deger])
        })
        destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => { callSpy.mockRestore(); destroySpy.mockRestore() })
    const kayit = () => bg.sessionStore.private_quotes[TICKET]
    const ALLOWANCE_SELECTOR = '0xdd62ed3e'
    const BSC_RPC_0 = supportedChains.find((c) => c.chainId === 56).rpc[0].url

    it('teklif yoksa basarisiz ve bilinen bicimde doner', async () => {
        await boot()
        const res = await bg.call({ type: 'ATS_PRIVATE_FEE_QUOTE', message: { ticket: '0xyok' } })
        expect(res).toMatchObject({ success: false, error: 'PRIVATE_QUOTE_NOT_FOUND' })
        expect(atsQuoteMock).not.toHaveBeenCalled()
    })

    // P2-UNTESTED-FUNDS-PATHS: basari yolu. Cagri listesi SAKLANAN tekliften kurulur; mesajdaki
    // sahte calls/chainId hic okunmaz.
    it('basari: approve + deposit saklanan tekliften kurulur, BigInt mesaja sizmaz', async () => {
        await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
        atsQuoteMock.mockResolvedValue(ATS_QUOTE)
        const res = await bg.call(atsMsg({ calls: [{ to: '0xevil' }], chainId: 1, address: YABANCI }))
        expect(res).toMatchObject({ success: true, transferFee: 2, symbol: 'ATS' })
        expect(() => JSON.stringify(res)).not.toThrow()
        expect(atsQuoteMock).toHaveBeenCalledTimes(1)
        const arg = atsQuoteMock.mock.calls[0][0]
        expect(arg).toMatchObject({ chainId: 56, address: A.address, opKind: 'private' })
        expect(arg.calls).toHaveLength(2)
        expect(arg.calls[0]).toMatchObject({ to: USDC_BSC, value: 0n })
        expect(arg.calls[0].data.startsWith('0x095ea7b3')).toBe(true)
        expect(arg.calls[1].to).toBe(GATEWAY)
    })

    // T7 (R5, PD5): agir rota siniri yalniz teklif callGasLimit bildirdiginde uygulanir; asilirsa kayit yamalanmaz.
    describe('agir rota siniri', () => {
        it('callGasLimit sinirin bir ustunde: PRIVATE_UNSUPPORTED ve kayit yamalanmaz', async () => {
            await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
            atsQuoteMock.mockResolvedValue({ ...ATS_QUOTE, callGasLimit: (DEPOSIT_EXECUTION_PROBE_GAS_CAP + 1n).toString() })
            okuma.deger = 5n
            const res = await bg.call(atsMsg())
            expect(res).toMatchObject({ success: false, error: 'PRIVATE_UNSUPPORTED' })
            expect(kayit()).not.toHaveProperty('atsAllowanceRaw')
        })

        it('callGasLimit tam sinirda: normal yanit, kayit yamalanir', async () => {
            await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
            atsQuoteMock.mockResolvedValue({ ...ATS_QUOTE, callGasLimit: DEPOSIT_EXECUTION_PROBE_GAS_CAP.toString() })
            const res = await bg.call(atsMsg())
            expect(res).toMatchObject({ success: true, transferFee: 2 })
            expect(kayit().atsAllowanceRaw).toBe('0')
        })

        it('callGasLimit yok: normal yanit (sinir atlanir)', async () => {
            await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
            atsQuoteMock.mockResolvedValue(ATS_QUOTE)
            const res = await bg.call(atsMsg())
            expect(res.success).toBe(true)
            expect(kayit().atsAllowanceRaw).toBe('0')
        })
    })

    it('kaynak zincir ATS zinciri degilse ATS not enabled, teklif istenmez', async () => {
        const q = quoteFixture({ deposit: { ...quoteFixture().deposit, chainId: 43114 } })
        await boot(GIZLI, { sessionStore: { private_quotes: seedRecord(q) } })
        const res = await bg.call(atsMsg())
        expect(res).toEqual({ success: false, error: 'ATS not enabled for chain' })
        expect(atsQuoteMock).not.toHaveBeenCalled()
        // Izin okumasi yalniz ATS zincirinde yapilir.
        expect(okuma.cagrilar).toEqual([])
    })

    // T6 (7.6 madde 1): artik izin. Okunan izin ucret teklifinin cagri listesini belirler VE kayda dondurulur: yurutme AYNI listeyi
    // kullanir (ucret teklifi ile imzalanan op ayni cagrilari gorur).
    describe('artik izin okuma ve dondurma', () => {
        const approveArgs = (c) => ERC20_IFACE.decodeFunctionData('approve', c.data).map(String)
        const TUTAR = quoteFixture().amount

        it('izin tutardan farkli (5n): uc cagri [approve(0), approve(tutar), deposit]; kayda atsAllowanceRaw "5" yazilir', async () => {
            await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
            atsQuoteMock.mockResolvedValue(ATS_QUOTE)
            okuma.deger = 5n
            const res = await bg.call(atsMsg())
            expect(res).toMatchObject({ success: true, transferFee: 2 })
            const { calls } = atsQuoteMock.mock.calls[0][0]
            expect(calls).toHaveLength(3)
            expect(approveArgs(calls[0])).toEqual([GATEWAY, '0'])
            expect(approveArgs(calls[1])).toEqual([GATEWAY, TUTAR])
            expect(calls[2].to).toBe(GATEWAY)
            expect(kayit().atsAllowanceRaw).toBe('5')
            // Diger alanlar korunur.
            expect(kayit()).toMatchObject({ sourceAccountKey: 'a-1', sourceChainId: 56, outputAddress: GIZLI.address })
            expect(() => JSON.stringify(bg.sessionStore.private_quotes)).not.toThrow()
            // Okuma: kaynak token'a, allowance(owner = kaynak hesap, spender = gateway).
            expect(okuma.cagrilar).toHaveLength(1)
            expect(okuma.cagrilar[0].to).toBe(USDC_BSC)
            expect(okuma.cagrilar[0].data.startsWith(ALLOWANCE_SELECTOR)).toBe(true)
            expect(okuma.cagrilar[0].data.toLowerCase()).toContain(A.address.slice(2).toLowerCase())
            expect(okuma.cagrilar[0].data.toLowerCase()).toContain(GATEWAY.slice(2).toLowerCase())
        })

        it('izin tutara ESIT: tek cagri (deposit); kayitta tutar dizgesi', async () => {
            await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
            atsQuoteMock.mockResolvedValue(ATS_QUOTE)
            okuma.deger = BigInt(TUTAR)
            expect((await bg.call(atsMsg())).success).toBe(true)
            const { calls } = atsQuoteMock.mock.calls[0][0]
            expect(calls).toHaveLength(1)
            expect(calls[0].to).toBe(GATEWAY)
            expect(kayit().atsAllowanceRaw).toBe(TUTAR)
        })

        it('izin 0: iki cagri [approve(tutar), deposit]; kayitta "0"', async () => {
            await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
            atsQuoteMock.mockResolvedValue(ATS_QUOTE)
            okuma.deger = 0n
            expect((await bg.call(atsMsg())).success).toBe(true)
            const { calls } = atsQuoteMock.mock.calls[0][0]
            expect(calls).toHaveLength(2)
            expect(approveArgs(calls[0])).toEqual([GATEWAY, TUTAR])
            expect(kayit().atsAllowanceRaw).toBe('0')
        })

        it('tutardan BUYUK izin (tutar + 1): uc cagri ve kayitta o deger', async () => {
            await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
            atsQuoteMock.mockResolvedValue(ATS_QUOTE)
            okuma.deger = BigInt(TUTAR) + 1n
            expect((await bg.call(atsMsg())).success).toBe(true)
            expect(atsQuoteMock.mock.calls[0][0].calls).toHaveLength(3)
            expect(kayit().atsAllowanceRaw).toBe(String(BigInt(TUTAR) + 1n))
        })

        it('native plan (approval yok): izin RPC okumasi YOK, atsAllowanceRaw null, tek cagri', async () => {
            const q = bridgedNativeQuoteFixture({ inputAddress: A.address })
            const rec = { [q.ticket]: { createdAt: Date.now(), quote: q, sourceAccountKey: 'a-1', sourceChainId: 1, outputAddress: GIZLI.address } }
            await boot(GIZLI, { sessionStore: { private_quotes: rec } })
            atsQuoteMock.mockResolvedValue(ATS_QUOTE)
            const res = await bg.call({ type: 'ATS_PRIVATE_FEE_QUOTE', message: { ticket: q.ticket } })
            expect(res.success).toBe(true)
            expect(okuma.cagrilar).toEqual([])
            expect(atsQuoteMock.mock.calls[0][0].calls).toHaveLength(1)
            expect(bg.sessionStore.private_quotes[q.ticket].atsAllowanceRaw).toBe(null)
        })

        it('izin okumasi basarisiz: PRIVATE_PROVIDER_DOWN (fail-closed), quoteAtsTransfer cagrilmaz, kayit yamalanmaz', async () => {
            await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
            okuma.hata = new Error('rpc kapali')
            expect(await bg.call(atsMsg())).toEqual({ success: false, error: 'PRIVATE_PROVIDER_DOWN' })
            expect(atsQuoteMock).not.toHaveBeenCalled()
            expect(kayit()).not.toHaveProperty('atsAllowanceRaw')
            // Okuma CALL_EXCEPTION ile reddedilse de (izin bilinmiyor) ayni kod.
            okuma.hata = Object.assign(new Error('revert'), { code: 'CALL_EXCEPTION' })
            expect(await bg.call(atsMsg())).toEqual({ success: false, error: 'PRIVATE_PROVIDER_DOWN' })
            expect(atsQuoteMock).not.toHaveBeenCalled()
        })

        it('RPC yalniz chain.rpc[0] (hiz yarisi yok), istek zaman asimli; saglayici kurulduktan sonra destroy edilir (basari ve hata yolunda)', async () => {
            await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
            atsQuoteMock.mockResolvedValue(ATS_QUOTE)
            okuma.deger = 5n
            expect((await bg.call(atsMsg())).success).toBe(true)
            expect(okuma.cagrilar.map((c) => c.rpc)).toEqual([BSC_RPC_0])
            expect(okuma.cagrilar[0].timeout).toBe(PRIVATE_RPC_TIMEOUT_MS)
            expect(destroySpy).toHaveBeenCalledTimes(1)
            destroySpy.mockClear()
            okuma.hata = new Error('rpc kapali')
            expect((await bg.call(atsMsg())).error).toBe('PRIVATE_PROVIDER_DOWN')
            expect(destroySpy).toHaveBeenCalledTimes(1)
        })

        it('bundler teklifi basarisizsa kayit yamalanmaz (donmus deger yalniz basarili tekliften sonra yazilir)', async () => {
            await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
            atsQuoteMock.mockRejectedValue(Object.assign(new Error('bundler down'), { status: 503 }))
            okuma.deger = 5n
            expect((await bg.call(atsMsg())).success).toBe(false)
            expect(kayit()).not.toHaveProperty('atsAllowanceRaw')
        })

        it('ikinci basarili teklif donmus degeri gunceller (son basarili ucret teklifi gecerli)', async () => {
            await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
            atsQuoteMock.mockResolvedValue(ATS_QUOTE)
            okuma.deger = 5n
            await bg.call(atsMsg())
            okuma.deger = 0n
            await bg.call(atsMsg())
            expect(kayit().atsAllowanceRaw).toBe('0')
        })
    })

    it('arka uc hatasi code ve httpStatus ile doner (arayuz kararini bunlardan verir)', async () => {
        await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
        const err = Object.assign(new Error('bundler down'), { code: 'x-code', status: 503 })
        atsQuoteMock.mockRejectedValue(err)
        const res = await bg.call(atsMsg())
        expect(res).toEqual({ success: false, error: 'bundler down', code: 'x-code', httpStatus: 503 })
    })

    it('kaynak hesap kasada yoksa PRIVATE_UNSUPPORTED', async () => {
        const rec = seedRecord()
        rec[TICKET].sourceAccountKey = 'yok'
        await boot(GIZLI, { sessionStore: { private_quotes: rec } })
        const res = await bg.call(atsMsg())
        expect(res).toMatchObject({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(atsQuoteMock).not.toHaveBeenCalled()
    })

    // A:M-4: ATS kapaliyken (S2 gecmedi) bundler'a hic gidilmez; teklif kaydi bile okunmaz.
    it('PRIVATE_ORDER_ATS kapaliyken PRIVATE_UNSUPPORTED, bundler cagrilmaz', async () => {
        flags.ats = false
        await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
        expect(await bg.call(atsMsg())).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(atsQuoteMock).not.toHaveBeenCalled()
    })

    // G:G-1: siniflandirma ALWAYS_ALLOWED kalir ama normal modda Gizli Hesap adresi bundler'a gitmez.
    it('normal modda (bayrak acik) PRIVACY_MODE_OFF, bundler cagrilmaz', async () => {
        await boot(A, { sessionStore: { private_quotes: seedRecord() } })
        expect(await bg.call(atsMsg())).toEqual({ success: false, error: 'PRIVACY_MODE_OFF' })
        expect(atsQuoteMock).not.toHaveBeenCalled()
    })

    it('normal modda kaydin kaynagi GIZLI HESAP ise de PRIVACY_MODE_OFF: Gizli Hesap adresi bundler a gitmez (G-1)', async () => {
        await boot(A, { sessionStore: { private_quotes: seedPrivateSource() } })
        expect(await bg.call(atsMsg())).toEqual({ success: false, error: 'PRIVACY_MODE_OFF' })
        expect(atsQuoteMock).not.toHaveBeenCalled()
    })

    it('sayfa kokeni: dahili aksiyondur, 4100 ve teklif istenmez', async () => {
        await boot(GIZLI, { sessionStore: { private_quotes: seedRecord() } })
        const red = { error: { code: 4100, message: 'Unauthorized' } }
        expect(await bg.call(atsMsg(), SAYFA)).toEqual(red)
        expect(await bg.call({ method: 'ATS_PRIVATE_FEE_QUOTE', message: { ticket: TICKET } }, SAYFA)).toEqual(red)
        expect(atsQuoteMock).not.toHaveBeenCalled()
    })

    it('ozellik bayragi kapaliyken PRIVACY_DISABLED', async () => {
        await boot(GIZLI, { privacyFlag: 'false', sessionStore: { private_quotes: seedRecord() } })
        expect(await bg.call(atsMsg())).toEqual({ success: false, error: 'PRIVACY_DISABLED' })
        expect(atsQuoteMock).not.toHaveBeenCalled()
    })
})

// ---- ATS-ONCE KAPISI KALDIRILDI (2026-10-28, kullanici karari; spec 2026-10-15 D16 / PF-F1 GERI ALINDI) ----
// Para yukle (kaynak Gizli Hesap DEGIL) + teslim agi BSC disi iken teklif artik Gizli Hesap'in BSC ATS bakiyesine BAKMAZ: ATS kontrolu
// islem aninda (Takas/Kopru ATS ucret karti) yapilir. Okuma ethers sozlesme cagrisidir (JsonRpcProvider.prototype.call taklit edilir;
// gercek aga cikilmaz): hicbir balanceOf cagrisi yapilmamali. ATS_FUEL_BALANCE (pill) ayni ortak okumayi kullanmaya devam eder.
const BSC_RPC = supportedChains.find((c) => c.chainId === 56).rpc[0].url
const ATS_TOKEN = getAddress('0x75D8BB7fBd4782a134211dc350Ba5c715197B81d')
const FON_AGLARI = '56,1,8453,42161'

describe('PRIVATE_QUOTE: ATS-once kapisi YOK (Para yukle + BSC disi teslim agi ATS bakiyesi okumaz)', () => {
    const okuma = { cagrilar: [], deger: 0n, hata: null }
    let callSpy
    let destroySpy
    // Para yukle mesaji: kaynak a-1 genel hesap, alici kasadaki Gizli Hesap, teslim Base USDC; teklif Base sekliyle.
    const fonMesaji = (over) => msg({ payoutUsdc: '15', outputToken: usdcTokenOf(8453), ...over })
    const fonTeklifi = () => baseUsdcQuoteFixture({ recipient: { chainId: 8453, address: GIZLI.address } })

    beforeEach(() => {
        quoteMock.mockReset(); getOrderMock.mockReset(); getOrderMock.mockImplementation(stateFromLastQuote); flags.native = true
        statusFetch.mockReset(); sagla(STATUS_OK)
        okuma.cagrilar = []; okuma.deger = 0n; okuma.hata = null
        callSpy = vi.spyOn(JsonRpcProvider.prototype, 'call').mockImplementation(async function (tx) {
            const baglanti = this._getConnection()
            okuma.cagrilar.push({ to: tx.to, data: tx.data, rpc: baglanti.url, timeout: baglanti.timeout })
            if (okuma.hata) throw okuma.hata
            return AbiCoder.defaultAbiCoder().encode(['uint256'], [okuma.deger])
        })
        destroySpy = vi.spyOn(JsonRpcProvider.prototype, 'destroy')
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', FON_AGLARI)
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => { callSpy.mockRestore(); destroySpy.mockRestore() })

    it('Para yukle + BSC disi teslim: Gizli Hesap ATS bakiyesi SIFIRKEN de teklif gelir; hicbir zincir okumasi yapilmaz', async () => {
        await boot()
        okuma.deger = 0n
        quoteMock.mockResolvedValueOnce(fonTeklifi())
        const res = await bg.call(fonMesaji())
        expect(res.success).toBe(true)
        expect(quoteMock).toHaveBeenCalledTimes(1)
        expect(okuma.cagrilar).toEqual([])
    })

    it('ATS okumasi hata verecek olsa bile (RPC kapali) teklif gelir: bakiye zaten okunmaz; "PRIVATE_ATS_FIRST" artik hic donmez', async () => {
        await boot()
        okuma.hata = new Error('rpc timeout')
        quoteMock.mockResolvedValueOnce(fonTeklifi())
        const res = await bg.call(fonMesaji())
        expect(res).not.toEqual({ success: false, error: 'PRIVATE_ATS_FIRST' })
        expect(res.success).toBe(true)
        expect(okuma.cagrilar).toEqual([])
        okuma.hata = null
        for (const deger of [0n, 1n, 10n ** 18n, 99n * 10n ** 18n]) {
            okuma.deger = deger
            quoteMock.mockResolvedValueOnce(fonTeklifi())
            expect((await bg.call(fonMesaji())).success, String(deger)).toBe(true)
        }
        expect(okuma.cagrilar).toEqual([])
    })

    it('BSC teslimi (Para yukle) ve Gonder (BSC disi) de ATS okumaz: bakiye sifir olsa da teklif gelir', async () => {
        await boot()
        okuma.deger = 0n
        quoteMock.mockResolvedValueOnce(quoteFixture())
        expect((await bg.call(msg())).success).toBe(true)
        quoteMock.mockResolvedValueOnce(gizliTeklif(baseUsdcQuoteFixture, 8453))
        expect((await bg.call(gonder({ outputToken: usdcTokenOf(8453) }))).success).toBe(true)
        expect(okuma.cagrilar).toEqual([])
    })

    // Ortak okuma yardimcisi (bscAtsReadConfig / readBscAtsBalance) pill icin KALIR: pill bugunku yaniti vermeye devam etmeli.
    it('ATS_FUEL_BALANCE (pill) ortak yardimciyla ayni yaniti verir: insan birimi bakiye ve sembol; hata yaninda success false', async () => {
        await boot()
        okuma.deger = 2500n * 10n ** 17n
        expect(await bg.call({ type: 'ATS_FUEL_BALANCE', message: { address: GIZLI.address } })).toEqual({ success: true, balance: '250.0', symbol: 'ATS' })
        expect(okuma.cagrilar[0]).toMatchObject({ to: ATS_TOKEN, rpc: BSC_RPC })
        okuma.hata = new Error('rpc down')
        expect(await bg.call({ type: 'ATS_FUEL_BALANCE', message: { address: GIZLI.address } })).toEqual({ success: false, error: expect.any(String) })
        expect(await bg.call({ type: 'ATS_FUEL_BALANCE', message: {} })).toEqual({ success: false, error: 'address gerekli' })
    })

    it('sira: kapali ag (adim 3) ve desteklenmeyen kaynak (adim 5) saglayici durumundan ONCE; saglayici kapaliysa ATS sifirken de PRIVATE_PROVIDER_DOWN gelir', async () => {
        await boot()
        okuma.deger = 0n
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', '56')
        expect(await bg.call(fonMesaji())).toEqual({ success: false, error: 'PRIVATE_CHAIN_CLOSED' })
        vi.stubEnv('VITE_PRIVATE_FUND_CHAINS', FON_AGLARI)
        expect(await bg.call(fonMesaji({ sourceAsset: 'XYZ' }))).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(statusFetch).not.toHaveBeenCalled()
        sagla({ ...STATUS_OK, enabled: false })
        expect(await bg.call(fonMesaji())).toEqual({ success: false, error: 'PRIVATE_PROVIDER_DOWN' })
        expect(statusFetch).toHaveBeenCalledTimes(1)
        expect(okuma.cagrilar).toEqual([])
    })
})

// ---- PRIVATE_PROVIDER_INFO (gizli transfer sade ekran, T2): salt okunur, yalniz sayi ve bayrak ----
// Ekran SilentSwap ucret orani (feeBps), limitler ve musaitligi buradan okur; yanit providerGuard.status() onbellegini kullanir
// (60 sn / 15 sn). Adres, anahtar, ticket yok; ATS, bundler ve teklif (PRIVATE_QUOTE) hicbir sahte cagrilmaz.
describe('PRIVATE_PROVIDER_INFO', () => {
    const INFO = { type: 'PRIVATE_PROVIDER_INFO' }
    beforeEach(() => {
        quoteMock.mockReset(); getOrderMock.mockReset(); atsQuoteMock.mockReset(); statusFetch.mockReset(); sagla(STATUS_OK)
    })

    it('gizli modda sayilar ve bayrak doner; yalniz dort anahtar', async () => {
        await boot()
        sagla({ enabled: true, maintenanceMode: false, limits: { minUsdc: 12, maxUsdc: 20010 }, feeBps: 100 })
        const res = await bg.call(INFO)
        expect(res).toEqual({ success: true, info: { feeBps: 100, minUsdc: 12, maxUsdc: 20010, available: true } })
        expect(Object.keys(res.info).sort()).toEqual(['available', 'feeBps', 'maxUsdc', 'minUsdc'])
        expect(statusFetch).toHaveBeenCalledTimes(1)
        expect(quoteMock).not.toHaveBeenCalled()
        expect(atsQuoteMock).not.toHaveBeenCalled()
        expect(getOrderMock).not.toHaveBeenCalled()
    })

    it('normal modda da yanit verir (kapi ALWAYS_ALLOWED)', async () => {
        await boot(A)
        const res = await bg.call(INFO)
        expect(res).toEqual({ success: true, info: { feeBps: 100, minUsdc: 12, maxUsdc: 20010, available: true } })
        expect(quoteMock).not.toHaveBeenCalled()
        expect(atsQuoteMock).not.toHaveBeenCalled()
    })

    it('fetch reddedilirse bile basari: hepsi null, musait', async () => {
        await boot()
        statusFetch.mockImplementation(async () => { throw new Error('ag yok') }); guardClock.t += 61000
        expect(await bg.call(INFO)).toEqual({ success: true, info: { feeBps: null, minUsdc: null, maxUsdc: null, available: true } })
        expect(quoteMock).not.toHaveBeenCalled()
    })

    it('bakimdaki saglayici available:false doner', async () => {
        await boot()
        sagla({ enabled: true, maintenanceMode: true, limits: { minUsdc: 12, maxUsdc: 20010 }, feeBps: 100 })
        expect((await bg.call(INFO)).info.available).toBe(false)
    })

    it('onbellek: ikinci mesaj yeni fetch atmaz', async () => {
        await boot()
        await bg.call(INFO)
        await bg.call(INFO)
        expect(statusFetch).toHaveBeenCalledTimes(1)
    })
})

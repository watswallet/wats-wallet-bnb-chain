import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { getAddress, Interface } from 'ethers'
import {
    AmountOutOfRangeError, MaintenanceModeError, HttpError, parseUsdc, formatUsdc, NATIVE_TOKEN_SENTINEL,
} from '@silentswap/sdk'
import { BSC_GATEWAY_ADDRESS } from '@silentswap/chains'
import {
    buildPrivateQuoteRequest as buildRaw, assertQuoteMatches, depositPlanFromQuote, approveCall, atsCallsFromPlan,
    expiresAtMs, quoteSummary, privacyErrorCode, limitUsdcOf, destFor, assertOrderStateMatches,
} from './silentswap'
import { usdcTokenOf, nativeTokenOf } from './deliveryTokens'
import {
    quoteFixture, USDC_BSC, GATEWAY, GIZLI, USDT_ETH, ROUTER, USDC_DEST_ECHO, USDC_BSC_DEST, NATIVE_BNB_DEST, orderStateFixture,
    requestFixture, bridgedErc20QuoteFixture, bridgedErc20RequestFixture, bridgedNativeQuoteFixture, bridgedNativeRequestFixture,
    bridgedDaiQuoteFixture, bridgedDaiRequestFixture, bridgedBscUsdtQuoteFixture, bridgedBscUsdtRequestFixture,
    BASE_USDC, BASE_USDC_DEST_ECHO, baseUsdcQuoteFixture, baseUsdcRequestFixture, baseUsdcOrderStateFixture,
    ARBITRUM_NATIVE_DEST_ECHO, arbitrumNativeQuoteFixture, arbitrumNativeRequestFixture, arbitrumNativeOrderStateFixture,
    DEPOSITORY, DEPOSITORY_ALT, RELAY_APPROVAL_PROXY, RELAY_ERC20_ROUTER, DAI_ETH,
    depositErc20Data, depositErc20AllowanceData, depositNativeData, olcum15Fixture, olcum20Fixture, olcumEski15Fixture,
} from '../../test-utils/silentswapFixtures'

// PRIVATE_BRIDGED_SOURCES uretimde KAPALIDIR. Koprulu rotanin sabitleme kodu (bridge pinleri) o
// sabiti acan gorev icin saklanir; bu dosya o kodun kurallarini AYNI testlerle sabit tutmak icin
// sabiti varsayilan olarak ACIK taklit eder. Kapali (gercek) davranis asagidaki 'koprulu kaynaklar
// KAPALI' blogunda sabiti kapatarak sinanir.
const flags = vi.hoisted(() => ({ bridged: true }))
// TEK DIKIS (T26 M3): sabit yalniz privateBridgedSources.js'tedir; hem assertQuoteMatches hem kapi yardimcilari onu oradan okur.
vi.mock('./privateBridgedSources', async (importOriginal) => {
    const real = await importOriginal()
    return { ...real, get PRIVATE_BRIDGED_SOURCES() { return flags.bridged } }
})

const ERC20 = new Interface(['function approve(address spender, uint256 amount)'])
const SIFIR = '0x0000000000000000000000000000000000000000'
const SAHTE = getAddress('0x' + 'ee'.repeat(20))
const GIRDI = quoteFixture().inputAddress
const USDC56 = usdcTokenOf(56)
const BNB56 = nativeTokenOf(56)
// Eski tek-ag testleri icin yerel sarmalayici: outputToken verilmezse BSC USDC kullanilir. GERCEK islevin varsayilani YOKTUR
// (K4); bu yuzden "outputToken ZORUNLU" testleri asagida buildRaw ile CIPLAK cagirir.
const buildPrivateQuoteRequest = (args) => buildRaw({ outputToken: USDC56, ...args })

describe('buildPrivateQuoteRequest', () => {
    it('ust duzey amount KOYMAZ, tek cikti BSC, tutar gateway USDC biriminde, varsayilan USDC dest', () => {
        const r = buildPrivateQuoteRequest({ sourceChainId: '1', sourceAsset: 'USDT', inputAddress: GIRDI, outputAddress: GIZLI, payoutUsdc: '25' })
        expect(r).toEqual({
            privacy: true, sourceChainId: 1, sourceAsset: 'USDT', inputAddress: GIRDI,
            outputs: [{ address: GIZLI, chainId: 56, amount: parseUsdc('25'), dest: USDC_BSC_DEST }],
        })
        expect('amount' in r).toBe(false)
    })

    // Canli (2026-10-10): dest'siz alici 400 direct_evm_payout_disabled. Her cikti dest tasir.
    it('her cikti dest tasir: USDC -> BSC USDC, BNB -> native BNB; bilinmeyen varlik PRIVATE_UNSUPPORTED', () => {
        const base = { sourceChainId: 56, sourceAsset: 'USDC', inputAddress: GIRDI, outputAddress: GIZLI, payoutUsdc: '15' }
        expect(buildPrivateQuoteRequest({ ...base, outputToken: USDC56 }).outputs[0].dest).toEqual(USDC_BSC_DEST)
        expect(buildPrivateQuoteRequest({ ...base, outputToken: BNB56 }).outputs[0].dest).toEqual(NATIVE_BNB_DEST)
        // Eski dizge uyumu YOK: 'USDC' ve 'BNB' dizgeleri artik gecerli bir teslim tokeni degildir.
        for (const a of ['DAI', 'usdc', '', null, 'USDC', 'BNB']) {
            expect(() => buildPrivateQuoteRequest({ ...base, outputToken: a }), String(a)).toThrow('PRIVATE_UNSUPPORTED')
        }
    })

    it('USDC dest sabiti SDK kayit defterindeki BSC USDC (adres ve ondalik); destFor yapisal esitlik ve dondurulmus nesne verir', () => {
        expect(USDC_BSC_DEST).toEqual({ kind: 'evm', chainId: 56, assetId: USDC_BSC, assetSymbol: 'USDC', assetDecimals: 18 })
        expect(destFor(USDC56)).toEqual(USDC_BSC_DEST)
        expect(destFor(BNB56)).toEqual(NATIVE_BNB_DEST)
        expect(Object.isFrozen(destFor(USDC56))).toBe(true)
    })

    // SDK bicim disi inputAddress'e RASTGELE imzaci uydurur: istek kurulmadan once reddedilir.
    it('adresler normallestirilir: kucuk harfli adres checksum bicimine doner', () => {
        const r = buildPrivateQuoteRequest({ sourceChainId: 56, sourceAsset: 'USDC', inputAddress: GIRDI.toLowerCase(), outputAddress: GIZLI.toLowerCase(), payoutUsdc: '25' })
        expect(r.inputAddress).toBe(GIRDI)
        expect(r.outputs[0].address).toBe(GIZLI)
    })

    it('bicim disi, 0x oneksiz, yanlis checksum ya da sifir adres PRIVATE_UNSUPPORTED', () => {
        // Gecerli checksum'un tek harfi (C -> c) degistirilmis: karisik harfli, checksum tutmaz.
        const yanlisChecksum = '0xccDD2B5836C08Bb7F115E8Da9EcE8605f8E7eA1D'
        const kotu = ['0xa', 'garbage', GIRDI.slice(2), SIFIR, '', undefined, null, 42, yanlisChecksum]
        const base = { sourceChainId: 56, sourceAsset: 'USDC', inputAddress: GIRDI, outputAddress: GIZLI, payoutUsdc: '25' }
        for (const v of kotu) {
            expect(() => buildPrivateQuoteRequest({ ...base, inputAddress: v }), `input ${String(v)}`).toThrow('PRIVATE_UNSUPPORTED')
            expect(() => buildPrivateQuoteRequest({ ...base, outputAddress: v }), `output ${String(v)}`).toThrow('PRIVATE_UNSUPPORTED')
        }
    })

    it('okunamayan tutar PRIVATE_UNSUPPORTED', () => {
        expect(() => buildPrivateQuoteRequest({ sourceChainId: 56, sourceAsset: 'USDC', inputAddress: GIRDI, outputAddress: GIZLI, payoutUsdc: 'abc' })).toThrow('PRIVATE_UNSUPPORTED')
    })

    // T25 U:M-8c: viem parseUnits '10.', '.5', '-12' kabul eder ve 19+ ondalikta YUVARLAR; istek kurucu ekranin
    // kanonik bicimini (en cok 18 ondalik, isaretsiz, noktali) zorlar.
    it.each(['10.', '.5', '-12', '1e1', '0x10', '1,000.5', ' 25', '25 ', '10.1234567890123456789', ''])(
        'kanonik olmayan tutar %j PRIVATE_UNSUPPORTED', (bad) => {
            expect(() => buildPrivateQuoteRequest({ sourceChainId: 56, sourceAsset: 'USDC', inputAddress: GIRDI, outputAddress: GIZLI, payoutUsdc: bad })).toThrow('PRIVATE_UNSUPPORTED')
        })

    it.each(['25', '25.5', '10.123456789012345678', '0'])('kanonik tutar %j kabul edilir', (ok) => {
        expect(() => buildPrivateQuoteRequest({ sourceChainId: 56, sourceAsset: 'USDC', inputAddress: GIRDI, outputAddress: GIZLI, payoutUsdc: ok })).not.toThrow()
    })
})

describe('assertQuoteMatches: kanonik degerler', () => {
    it('gateway sabiti SDK paketinin kanonik adresiyle ayni (fixture sapmasi)', () => {
        expect(GATEWAY).toBe(getAddress(BSC_GATEWAY_ADDRESS))
    })
})

describe('assertQuoteMatches: uyumlu teklifler', () => {
    it('dogrudan BSC USDC teklifi gecer (kucuk harfli alici dahil)', () => {
        expect(() => assertQuoteMatches(quoteFixture(), requestFixture())).not.toThrow()
        expect(() => assertQuoteMatches(quoteFixture(), requestFixture({ outputAddress: GIZLI.toLowerCase() }))).not.toThrow()
    })

    it('koprulu ERC-20 (Ethereum USDT) teklifi gecer', () => {
        expect(() => assertQuoteMatches(bridgedErc20QuoteFixture(), bridgedErc20RequestFixture())).not.toThrow()
    })

    it('koprulu native (Ethereum ETH) teklifi gecer', () => {
        expect(() => assertQuoteMatches(bridgedNativeQuoteFixture(), bridgedNativeRequestFixture())).not.toThrow()
    })

    it('BNB isteginde dest echo ayniysa gecer', () => {
        const q = quoteFixture({ dest: { ...NATIVE_BNB_DEST, minDestAmount: '1', expectedDestAmount: '2' } })
        expect(() => assertQuoteMatches(q, requestFixture({ outputToken: BNB56 }))).not.toThrow()
    })

    // api.silentswap.com'un 2026-10-10 tarihli gercek USDC yaniti (adresler fixture'inkiyle degistirildi).
    it('canli USDC teklifi gecer: 15 USDC istendi, 15 odenir, 14.85 odeme, beklenen 14.79 USDC', () => {
        const q = quoteFixture({
            amount: '15000000000000000000', payoutAmount: '14850000000000000000', serviceFee: '150000000000000000', integratorFee: '0',
            recipients: [{ splitIndex: 0, address: GIZLI, chainId: 56, payoutAmount: '14850000000000000000' }],
            sourceInput: { amount: '15000000000000000000', asset: 'USDC', decimals: 18, chainId: 56 },
            dest: { ...USDC_DEST_ECHO, minDestAmount: '14349307952063876068', expectedDestAmount: '14790051486357324334' },
        })
        expect(() => assertQuoteMatches(q, requestFixture({ payoutUsdc: '15' }))).not.toThrow()
    })
})

describe('assertQuoteMatches: alici ve tutar', () => {
    it('baska aliciya giden teklif reddedilir', () => {
        expect(() => assertQuoteMatches(quoteFixture(), requestFixture({ outputAddress: '0x' + '12'.repeat(20) }))).toThrow('PRIVATE_QUOTE_MISMATCH')
    })

    it('birden cok alici, bos alici listesi ya da baska alici zinciri reddedilir', () => {
        const r0 = quoteFixture().recipients[0]
        const cokluAlici = quoteFixture({ recipients: [r0, { ...r0, splitIndex: 1 }] })
        expect(() => assertQuoteMatches(cokluAlici, requestFixture())).toThrow('PRIVATE_QUOTE_MISMATCH')
        const bosAlici = quoteFixture({ recipients: [] })
        expect(() => assertQuoteMatches(bosAlici, requestFixture())).toThrow('PRIVATE_QUOTE_MISMATCH')
        const baskaZincir = quoteFixture({ recipients: [{ ...r0, chainId: 1 }] })
        expect(() => assertQuoteMatches(baskaZincir, requestFixture())).toThrow('PRIVATE_QUOTE_MISMATCH')
    })

    // UCRET MODELI KURALI (olcum 2026-10-29): model teklifin integratorFee'sinden okunur.
    //  integratorFee > 0 (URETIM): odeme (payoutAmount) = istenen BIREBIR; amount = odeme + serviceFee + integratorFee BIREBIR.
    //  integratorFee = 0 (ESKI): amount = istenen BIREBIR; odeme = amount - serviceFee.
    //  Iki modelde de toplam ucret istenenin %1'ini asamaz (fee.cap).
    const reason = (q, req) => { try { assertQuoteMatches(q, req) } catch (err) { return err } return null }
    const r0 = () => quoteFixture().recipients[0]
    const withPayout = (q, p) => ({ ...q, payoutAmount: p, recipients: [{ ...q.recipients[0], payoutAmount: p }] })
    const withAmount = (q, amount) => ({ ...q, amount, sourceInput: { ...q.sourceInput, amount } })

    it('uretim modeli: GERCEK olcum teklifleri gecer (15 -> 15.15/15/0.075/0.075 ve 20 -> 20.2/20/0.1/0.1)', () => {
        expect(() => assertQuoteMatches(olcum15Fixture(), requestFixture({ payoutUsdc: '15' }))).not.toThrow()
        expect(() => assertQuoteMatches(olcum20Fixture(), requestFixture({ payoutUsdc: '20' }))).not.toThrow()
        expect(() => assertQuoteMatches(quoteFixture(), requestFixture())).not.toThrow()
    })

    it('eski model (integratorFee 0): 15 -> 15/14.85/0.15/0 hala gecer', () => {
        expect(() => assertQuoteMatches(olcumEski15Fixture(), requestFixture({ payoutUsdc: '15' }))).not.toThrow()
        expect(() => assertQuoteMatches(baseUsdcQuoteFixture(), baseUsdcRequestFixture())).not.toThrow()
    })

    it('uretim modeli: alicinin odemesi istenenden farkliysa (kucuk de buyuk de) MISMATCH: payout.request', () => {
        const q = olcum15Fixture()
        for (const p of ['14999999999999999999', '15000000000000000001', '14850000000000000000', '1']) {
            const e = reason(withPayout(q, p), requestFixture({ payoutUsdc: '15' }))
            expect(e?.message, p).toBe('PRIVATE_QUOTE_MISMATCH')
            expect(e?.reason, p).toBe('payout.request')
        }
        expect(reason(olcum15Fixture(), requestFixture({ payoutUsdc: '16' }))?.reason).toBe('payout.request')
    })

    it('uretim modeli: amount != odeme + ucretler ise MISMATCH: fee.sum (kucuk de buyuk de)', () => {
        for (const amount of ['15149999999999999999', '15150000000000000001', '15000000000000000000', '15300000000000000000']) {
            const e = reason(withAmount(olcum15Fixture(), amount), requestFixture({ payoutUsdc: '15' }))
            expect(e?.message, amount).toBe('PRIVATE_QUOTE_MISMATCH')
            expect(e?.reason, amount).toBe('fee.sum')
        }
    })

    it('toplam ucret istenenin %1 ustune cikarsa MISMATCH: fee.cap (iki modelde de); tam %1 gecer', () => {
        // Uretim modeli: odeme 15, ucretler 0.1501 (> %1 = 0.15), amount tutarli.
        const fazla = withAmount(olcum15Fixture({ serviceFee: '75050000000000000', integratorFee: '75050000000000000' }), '15150100000000000000')
        expect(reason(fazla, requestFixture({ payoutUsdc: '15' }))?.reason).toBe('fee.cap')
        // Tek tarafa yigilmis ucret de toplamda sayilir: 0 + 0.16 (uretim).
        const tek = withAmount(olcum15Fixture({ serviceFee: '0', integratorFee: '160000000000000000' }), '15160000000000000000')
        expect(reason(tek, requestFixture({ payoutUsdc: '15' }))?.reason).toBe('fee.cap')
        // Eski model: serviceFee 0.16 > %1 (0.15); odeme = 15 - 0.16.
        const eski = withPayout(olcumEski15Fixture({ serviceFee: '160000000000000000' }), '14840000000000000000')
        expect(reason(eski, requestFixture({ payoutUsdc: '15' }))?.reason).toBe('fee.cap')
        // Tam %1 sinirda (0.15) gecer; bir birim ustu reddedilir.
        expect(() => assertQuoteMatches(olcum15Fixture(), requestFixture({ payoutUsdc: '15' }))).not.toThrow()
        const bir = withAmount(olcum15Fixture({ integratorFee: '75000000000000001' }), '15150000000000000001')
        expect(reason(bir, requestFixture({ payoutUsdc: '15' }))?.reason).toBe('fee.cap')
    })

    it('eski model: cuzdandan cikacak tutar istenenden farkliysa (kucuk de buyuk de) MISMATCH: amount.request', () => {
        for (const amount of ['14999999999999999999', '15000000000000000001', '15150000000000000000']) {
            const e = reason(withAmount(olcumEski15Fixture(), amount), requestFixture({ payoutUsdc: '15' }))
            expect(e?.message, amount).toBe('PRIVATE_QUOTE_MISMATCH')
            expect(e?.reason, amount).toBe('amount.request')
        }
        expect(() => assertQuoteMatches(olcumEski15Fixture(), requestFixture({ payoutUsdc: '16' }))).toThrow('PRIVATE_QUOTE_MISMATCH')
    })

    it('odeme cuzdandan cikacak tutardan buyukse ya da sifirsa MISMATCH: payout.quote', () => {
        const eski = olcumEski15Fixture()
        for (const p of ['15000000000000000001', '0']) {
            expect(reason(withPayout(eski, p), requestFixture({ payoutUsdc: '15' }))?.reason, p).toBe('payout.quote')
        }
        // Tutara esit odeme (ucretsiz, eski model) gecer.
        const esit = withPayout({ ...eski, serviceFee: '0' }, '15000000000000000000')
        expect(() => assertQuoteMatches(esit, requestFixture({ payoutUsdc: '15' }))).not.toThrow()
        // Uretim modelinde odeme amount'tan buyuk olamaz.
        expect(reason(withPayout(quoteFixture(), '26000000000000000000'), requestFixture())?.reason).toBe('payout.quote')
    })

    // Inceleme 2: kartin ucret satirlari ve odeme birbirine bagli olmali.
    it('eski model: tutar - ucretler != odeme ise MISMATCH: fee.sum; ucret alani yoksa PRIVATE_UNSUPPORTED', () => {
        const eski = olcumEski15Fixture()
        expect(reason(withPayout(eski, '1000000000000000000'), requestFixture({ payoutUsdc: '15' }))?.reason).toBe('fee.sum')
        expect(() => assertQuoteMatches({ ...eski, serviceFee: '1' }, requestFixture({ payoutUsdc: '15' }))).toThrow('PRIVATE_QUOTE_MISMATCH')
        for (const over of [{ serviceFee: undefined }, { integratorFee: '' }]) {
            expect(() => assertQuoteMatches(quoteFixture(over), requestFixture()), JSON.stringify(over)).toThrow('PRIVATE_UNSUPPORTED')
        }
    })

    it('USDC tesliminde en az teslim odemeden buyukse MISMATCH: dest.min (BNB tesliminde birim farkli, denetlenmez)', () => {
        const e = (() => { try { assertQuoteMatches(quoteFixture({ dest: { ...USDC_DEST_ECHO, minDestAmount: '25000000000000000001', expectedDestAmount: '25100000000000000000' } }), requestFixture()) } catch (err) { return err } return null })()
        expect(e?.reason).toBe('dest.min')
        const bnb = quoteFixture({ dest: { ...NATIVE_BNB_DEST, minDestAmount: '30000000000000000000', expectedDestAmount: '31000000000000000000' } })
        expect(() => assertQuoteMatches(bnb, requestFixture({ outputToken: BNB56 }))).not.toThrow()
    })

    it('alicinin odemesi teklifin odemesinden farkliysa MISMATCH: payout.recipient', () => {
        const r0 = quoteFixture().recipients[0]
        const aliciKisa = quoteFixture({ recipients: [{ ...r0, payoutAmount: '1' }] })
        expect(() => assertQuoteMatches(aliciKisa, requestFixture())).toThrow('PRIVATE_QUOTE_MISMATCH')
    })

    it('okunamayan payoutAmount PRIVATE_UNSUPPORTED', () => {
        expect(() => assertQuoteMatches(quoteFixture({ payoutAmount: 'abc' }), requestFixture())).toThrow('PRIVATE_UNSUPPORTED')
    })

    it('USDC isteginde dest yoksa ya da varligi/zinciri/turu BSC USDC degilse MISMATCH: dest.echo', () => {
        const kotu = [undefined, null, { ...NATIVE_BNB_DEST, minDestAmount: '1', expectedDestAmount: '2' },
            { ...USDC_DEST_ECHO, chainId: 1 }, { ...USDC_DEST_ECHO, kind: 'svm' }, { ...USDC_DEST_ECHO, assetId: SAHTE }]
        for (const dest of kotu) {
            const e = (() => { try { assertQuoteMatches(quoteFixture({ dest }), requestFixture()) } catch (err) { return err } return null })()
            expect(e?.message, JSON.stringify(dest)).toBe('PRIVATE_QUOTE_MISMATCH')
            expect(e?.reason, JSON.stringify(dest)).toBe('dest.echo')
        }
        // Adres buyuk/kucuk harfi tek basina red sebebi degil.
        expect(() => assertQuoteMatches(quoteFixture({ dest: { ...USDC_DEST_ECHO, assetId: USDC_BSC.toLowerCase() } }), requestFixture())).not.toThrow()
    })

    it('dest en az teslim okunamaz ya da sifirsa reddedilir; beklenen en azdan kucukse MISMATCH', () => {
        for (const minDestAmount of [undefined, '', 'abc', '-1']) {
            expect(() => assertQuoteMatches(quoteFixture({ dest: { ...USDC_DEST_ECHO, minDestAmount } }), requestFixture()), String(minDestAmount)).toThrow('PRIVATE_UNSUPPORTED')
        }
        expect(() => assertQuoteMatches(quoteFixture({ dest: { ...USDC_DEST_ECHO, minDestAmount: '0' } }), requestFixture())).toThrow('PRIVATE_QUOTE_MISMATCH')
        expect(() => assertQuoteMatches(quoteFixture({ dest: { ...USDC_DEST_ECHO, expectedDestAmount: '1' } }), requestFixture())).toThrow('PRIVATE_QUOTE_MISMATCH')
        expect(() => assertQuoteMatches(quoteFixture({ dest: { ...NATIVE_BNB_DEST, minDestAmount: '0', expectedDestAmount: '2' } }), requestFixture({ outputToken: BNB56 }))).toThrow('PRIVATE_QUOTE_MISMATCH')
    })

    it('BNB isteginde dest yok ya da kind/chainId/assetId farkliysa MISMATCH', () => {
        const echo = { ...NATIVE_BNB_DEST, minDestAmount: '1', expectedDestAmount: '2' }
        const kotu = [undefined, { ...echo, kind: 'svm' }, { ...echo, chainId: 1 }, { ...echo, assetId: USDC_BSC }]
        for (const dest of kotu) {
            expect(() => assertQuoteMatches(quoteFixture({ dest }), requestFixture({ outputToken: BNB56 }))).toThrow('PRIVATE_QUOTE_MISMATCH')
        }
    })

    it('bilinmeyen cikti varligi PRIVATE_UNSUPPORTED', () => {
        expect(() => assertQuoteMatches(quoteFixture(), requestFixture({ outputToken: 'DAI' }))).toThrow('PRIVATE_UNSUPPORTED')
    })

    it('teklifin inputAddress\'i istenen kaynak adres degilse PRIVATE_UNSUPPORTED', () => {
        expect(() => assertQuoteMatches(quoteFixture({ inputAddress: SAHTE }), requestFixture())).toThrow('PRIVATE_UNSUPPORTED')
        expect(() => assertQuoteMatches(quoteFixture({ inputAddress: undefined }), requestFixture())).toThrow('PRIVATE_UNSUPPORTED')
    })
})

describe('assertQuoteMatches: ticket', () => {
    it('bos, dizge olmayan, 32 bayt olmayan ya da hex olmayan ticket PRIVATE_UNSUPPORTED', () => {
        const kotu = ['', undefined, null, 42, '0x01', 'a'.repeat(66), '0x' + 'zz'.repeat(32), '0x' + '01'.repeat(33), '0x' + '01'.repeat(32) + ' ']
        for (const ticket of kotu) {
            expect(() => assertQuoteMatches(quoteFixture({ ticket }), requestFixture()), String(ticket)).toThrow('PRIVATE_UNSUPPORTED')
        }
    })
})

describe('assertQuoteMatches: imzalanacak islemin sabitlenmesi (dogrudan rota)', () => {
    const dep = (over) => ({ ...quoteFixture().deposit, ...over })
    const reddet = (q, req = requestFixture()) => expect(() => assertQuoteMatches(q, req)).toThrow('PRIVATE_UNSUPPORTED')

    it('sahte deposit.to (gateway degil) reddedilir', () => {
        reddet(quoteFixture({ deposit: dep({ to: SAHTE }) }))
        reddet(quoteFixture({ deposit: dep({ to: USDC_BSC }) }))
    })

    it('sahte quote.gateway (kanonik degil) reddedilir; deposit.to ile ayni olsa bile', () => {
        reddet(quoteFixture({ gateway: SAHTE }))
        reddet(quoteFixture({ gateway: SAHTE, deposit: dep({ to: SAHTE }) }))
    })

    it('sahte quote.usdc (kanonik BSC USDC degil) reddedilir', () => {
        reddet(quoteFixture({ usdc: SAHTE }))
        reddet(quoteFixture({ usdc: undefined }))
    })

    it('dogrudan rotada sifir olmayan value reddedilir', () => {
        reddet(quoteFixture({ deposit: dep({ value: '1' }) }))
        reddet(quoteFixture({ deposit: dep({ value: '3000000000000000000' }) }))
    })

    it('okunamayan ya da negatif value reddedilir', () => {
        reddet(quoteFixture({ deposit: dep({ value: 'abc' }) }))
        reddet(quoteFixture({ deposit: dep({ value: '-1' }) }))
    })

    it('yasak seciciler reddedilir: approve, transfer, transferFrom, increaseAllowance, permit, setApprovalForAll', () => {
        for (const sel of ['0x095ea7b3', '0xa9059cbb', '0x23b872dd', '0x39509351', '0xd505accf', '0xa22cb465']) {
            reddet(quoteFixture({ deposit: dep({ data: sel + '00'.repeat(64) }) }))
            reddet(quoteFixture({ deposit: dep({ data: sel.toUpperCase().replace('0X', '0x') + '00'.repeat(64) }) }))
        }
    })

    it('bos, 0x, kisa, hex olmayan ya da tek haneli veri reddedilir', () => {
        for (const data of [undefined, '', '0x', '0xdead', 'deadbeef', '0xzzzzzzzz', '0xdeadbeef0', 123]) {
            reddet(quoteFixture({ deposit: dep({ data }) }))
        }
    })

    it('0x oneksiz sifir adres, sifir adres ve bicim disi adresler reddedilir (to, gateway, usdc)', () => {
        const kotu = ['0'.repeat(40), SIFIR, '0x' + '0'.repeat(39), 'abc', '', undefined, 5]
        for (const a of kotu) {
            reddet(quoteFixture({ deposit: dep({ to: a }) }))
            reddet(quoteFixture({ gateway: a }))
            reddet(quoteFixture({ usdc: a }))
        }
    })

    it('deposit yok, txKind evm degil ya da zincir farkli reddedilir', () => {
        reddet(quoteFixture({ deposit: undefined }))
        reddet(quoteFixture({ deposit: dep({ txKind: 'ton' }) }))
        reddet(quoteFixture({ deposit: dep({ txKind: 'svm' }) }))
        reddet(quoteFixture({ deposit: dep({ chainId: 1 }) }))
        reddet(quoteFixture({ deposit: dep({ chainId: undefined }) }))
        reddet(null)
    })

    it('dogrudan rota yalniz BSC USDC kaynakta: baska varlik ya da zincir bridge olmadan reddedilir', () => {
        reddet(quoteFixture(), requestFixture({ sourceAsset: 'USDT' }))
        reddet(quoteFixture(), requestFixture({ sourceAsset: 'BNB' }))
        reddet(quoteFixture({ deposit: dep({ chainId: 1 }) }), requestFixture({ sourceChainId: 1 }))
        reddet(quoteFixture(), requestFixture({ sourceAsset: 'yok' }))
        reddet(quoteFixture(), requestFixture({ sourceAsset: undefined }))
    })
})

describe('assertQuoteMatches: koprulu rota', () => {
    const bridge = (over) => ({ ...bridgedErc20QuoteFixture().bridge, ...over })
    const reddetE = (over) => expect(() => assertQuoteMatches(bridgedErc20QuoteFixture(over), bridgedErc20RequestFixture())).toThrow('PRIVATE_UNSUPPORTED')
    const reddetN = (over) => expect(() => assertQuoteMatches(bridgedNativeQuoteFixture(over), bridgedNativeRequestFixture())).toThrow('PRIVATE_UNSUPPORTED')

    it('hedef zincir BSC degilse ya da kaynak zincir deposit zincirinden farkliysa reddedilir', () => {
        reddetE({ bridge: bridge({ destinationChainId: 1 }) })
        reddetE({ bridge: bridge({ sourceChainId: 56 }) })
        reddetE({ bridge: bridge({ sourceChainId: undefined }) })
    })

    it('ERC-20: izin tokeni secilen varligin kayit adresi degilse reddedilir', () => {
        reddetE({ bridge: bridge({ sourceToken: SAHTE }) })
        reddetE({ bridge: bridge({ sourceToken: USDC_BSC }) })
        reddetE({ bridge: bridge({ sourceToken: SIFIR }) })
        reddetE({ bridge: bridge({ sourceToken: 'native' }) })
    })

    it('ERC-20: value sifir degilse reddedilir', () => {
        reddetE({ deposit: { ...bridgedErc20QuoteFixture().deposit, value: '1' } })
    })

    it('native: token sifir adres/sentinel degilse ya da value bridge.sourceAmount degilse reddedilir', () => {
        reddetN({ bridge: { ...bridgedNativeQuoteFixture().bridge, sourceToken: USDT_ETH } })
        reddetN({ deposit: { ...bridgedNativeQuoteFixture().deposit, value: '10000000000000001' } })
        reddetN({ deposit: { ...bridgedNativeQuoteFixture().deposit, value: '0' } })
    })

    it('bridge.sourceAmount okunamaz ya da sifirsa reddedilir', () => {
        reddetE({ bridge: bridge({ sourceAmount: 'abc' }) })
        reddetE({ bridge: bridge({ sourceAmount: '0' }) })
    })

    it('koprulu rotada yasak secici reddedilir ve deposit.to sifir olamaz', () => {
        reddetE({ deposit: { ...bridgedErc20QuoteFixture().deposit, data: '0xa9059cbb' + '00'.repeat(64) } })
        reddetE({ deposit: { ...bridgedErc20QuoteFixture().deposit, to: SIFIR } })
    })

    it('koprulu rotada da quote.gateway kanonik olmak zorunda', () => {
        reddetE({ gateway: SAHTE })
    })
})

// RELAY DEPOSITORY PINLERI (privateBridgedSources.js, olculdu 2026-10-26). Koprulu rota yalniz tablodaki (zincir, varlik)
// ikililerinde ve yalniz o zincirin Depository'sine acik; calldata cozulur ve istekle BIREBIR esitlenir.
describe('assertQuoteMatches: koprulu rota Relay Depository ile sinirli', () => {
    const neden = (fn) => { try { fn() } catch (e) { return { message: e.message, reason: e.reason } } return null }
    const erc = (depositOver) => bridgedErc20QuoteFixture({ deposit: { ...bridgedErc20QuoteFixture().deposit, ...depositOver } })
    const nat = (depositOver) => bridgedNativeQuoteFixture({ deposit: { ...bridgedNativeQuoteFixture().deposit, ...depositOver } })
    const ercNeden = (q) => neden(() => assertQuoteMatches(q, bridgedErc20RequestFixture()))
    const natNeden = (q) => neden(() => assertQuoteMatches(q, bridgedNativeRequestFixture()))

    it('Ethereum DAI de Depository rotasindadir ve gecer', () => {
        expect(() => assertQuoteMatches(bridgedDaiQuoteFixture(), bridgedDaiRequestFixture())).not.toThrow()
    })

    it('deposit.to o zincirin Depository si degilse reddedilir (sahte adres, Relay yonlendiricisi, onay aracisi, diger Depository)', () => {
        for (const to of [SAHTE, ROUTER, RELAY_ERC20_ROUTER, RELAY_APPROVAL_PROXY, DEPOSITORY_ALT, GATEWAY]) {
            expect(ercNeden(erc({ to })), to).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'bridge.to' })
            expect(natNeden(nat({ to })), to).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'bridge.to' })
        }
    })

    it('tabloda olmayan (zincir, varlik) ikilisi reddedilir: BSC USDT (onay aracisi rotasi)', () => {
        expect(neden(() => assertQuoteMatches(bridgedBscUsdtQuoteFixture(), bridgedBscUsdtRequestFixture())))
            .toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'bridged.route' })
        // Ayni teklif Depository'ye gitse bile ikili tabloda olmadigi icin reddedilir.
        const depoya = bridgedBscUsdtQuoteFixture({ deposit: { ...bridgedBscUsdtQuoteFixture().deposit, to: DEPOSITORY } })
        expect(neden(() => assertQuoteMatches(depoya, bridgedBscUsdtRequestFixture())).reason).toBe('bridged.route')
    })

    it('Mantle USDC yalniz Mantle Depository sine (farkli adres) gidebilir', () => {
        const mantleUsdc = getAddress('0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9')
        const q = (to) => bridgedErc20QuoteFixture({
            deposit: { to, data: depositErc20Data(GIRDI, mantleUsdc, '25300000'), value: '0', chainId: 5000 },
            bridge: { ...bridgedErc20QuoteFixture().bridge, sourceChainId: 5000, sourceToken: mantleUsdc, sourceUsdc: mantleUsdc },
            sourceAsset: 'USDC',
            sourceInput: { amount: '25300000', asset: 'USDC', decimals: 6, chainId: 5000 },
        })
        const istek = bridgedErc20RequestFixture({ sourceChainId: 5000, sourceAsset: 'USDC' })
        expect(() => assertQuoteMatches(q(DEPOSITORY_ALT), istek)).not.toThrow()
        expect(neden(() => assertQuoteMatches(q(DEPOSITORY), istek)).reason).toBe('bridge.to')
    })

    it('bridge.protocol relay degilse reddedilir', () => {
        for (const protocol of ['debridge', undefined, '', 'RELAY']) {
            const q = bridgedErc20QuoteFixture({ bridge: { ...bridgedErc20QuoteFixture().bridge, protocol } })
            expect(ercNeden(q), String(protocol)).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'bridge.protocol' })
        }
    })

    it('ERC-20: depositor bizim adres degilse (sifir adres dahil), token ya da tutar farkliysa reddedilir', () => {
        const kotu = [
            depositErc20Data(SAHTE, USDT_ETH, '25300000'),
            depositErc20Data(SIFIR, USDT_ETH, '25300000'),
            depositErc20Data(GIRDI, DAI_ETH, '25300000'),
            depositErc20Data(GIRDI, USDT_ETH, '25300001'),
            depositErc20Data(GIRDI, USDT_ETH, '0'),
        ]
        for (const data of kotu) expect(ercNeden(erc({ data })), data).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'deposit.call' })
    })

    it('ERC-20: 3 argumanli depositErc20 (tum izni ceker), depositNative, bilinmeyen secici ve sondaki fazla bayt reddedilir', () => {
        const dogru = depositErc20Data(GIRDI, USDT_ETH, '25300000')
        const kotu = [
            depositErc20AllowanceData(GIRDI, USDT_ETH),
            depositNativeData(GIRDI),
            '0xdeadbeef' + dogru.slice(10),
            dogru + '00',
            dogru + '00'.repeat(32),
        ]
        for (const data of kotu) expect(ercNeden(erc({ data })), data.slice(0, 12)).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'deposit.call' })
    })

    it('native: depositor bizim adres degilse, cagri depositErc20 ise ya da fazla bayt varsa reddedilir', () => {
        const dogru = depositNativeData(GIRDI)
        for (const data of [depositNativeData(SAHTE), depositNativeData(SIFIR), depositErc20Data(GIRDI, USDT_ETH, '10000000000000000'), dogru + '00'.repeat(32)]) {
            expect(natNeden(nat({ data })), data.slice(0, 12)).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'deposit.call' })
        }
    })

    it('depositor girdi adresiyle buyuk/kucuk harften bagimsiz eslesir; id serbesttir (sunucunun siparis kimligi)', () => {
        const q = erc({ data: depositErc20Data(GIRDI.toLowerCase(), USDT_ETH, '25300000', '0x' + '00'.repeat(32)) })
        expect(() => assertQuoteMatches(q, bridgedErc20RequestFixture())).not.toThrow()
    })

    it('ACIK iken sahte teklifler (DAI push/move, Permit2, ERC-721, Depository e bilinmeyen secici) reddedilir', () => {
        const DAI_TOKEN = getAddress('0x6b175474e89094c44da98b954eedeac495271d0f')
        const PERMIT2 = getAddress('0x000000000022d473030f116ddee9f6b43ac78ba3')
        const dai = (over) => bridgedDaiQuoteFixture({ deposit: { ...bridgedDaiQuoteFixture().deposit, ...over } })
        const sahteler = [
            dai({ to: DAI_TOKEN, data: '0xb753a98c' + '00'.repeat(64) }),
            dai({ to: DAI_TOKEN, data: '0xbb35783b' + '00'.repeat(96) }),
            dai({ to: PERMIT2, data: '0x87517c45' + '00'.repeat(128) }),
            dai({ to: SAHTE, data: '0x42842e0e' + '00'.repeat(96) }),
            dai({ to: DEPOSITORY, data: '0xdeadbeef' + '00'.repeat(64) }),
        ]
        for (const q of sahteler) expect(neden(() => assertQuoteMatches(q, bridgedDaiRequestFixture())).message).toBe('PRIVATE_UNSUPPORTED')
    })
})

describe('assertQuoteMatches: odenen tutar kart ile sabitlenir (I1)', () => {
    const yakala = (fn) => { try { fn() } catch (e) { return e } return null }

    it('koprulu: sourceInput ile bridge.sourceAmount ayni degilse MISMATCH (sahte 5000 USDT yoklamasi)', () => {
        const q = bridgedErc20QuoteFixture({
            deposit: { ...bridgedErc20QuoteFixture().deposit, to: SAHTE },
            bridge: { ...bridgedErc20QuoteFixture().bridge, sourceAmount: '5000000000' },
            sourceInput: { amount: '25300000', asset: 'USDT', decimals: 6, chainId: 1 },
        })
        expect(() => assertQuoteMatches(q, bridgedErc20RequestFixture())).toThrow('PRIVATE_QUOTE_MISMATCH')
        // native kaynak: value ve bridge tutari 5 ETH ama kart 0.01 ETH diyor
        const n = bridgedNativeQuoteFixture({
            deposit: { ...bridgedNativeQuoteFixture().deposit, value: '5000000000000000000' },
            bridge: { ...bridgedNativeQuoteFixture().bridge, sourceAmount: '5000000000000000000' },
        })
        expect(() => assertQuoteMatches(n, bridgedNativeRequestFixture())).toThrow('PRIVATE_QUOTE_MISMATCH')
    })

    it('koprulu: sourceInput yoksa ya da okunamazsa PRIVATE_UNSUPPORTED', () => {
        expect(() => assertQuoteMatches(bridgedErc20QuoteFixture({ sourceInput: undefined }), bridgedErc20RequestFixture())).toThrow('PRIVATE_UNSUPPORTED')
        expect(() => assertQuoteMatches(bridgedNativeQuoteFixture({ sourceInput: undefined }), bridgedNativeRequestFixture())).toThrow('PRIVATE_UNSUPPORTED')
        const si = bridgedErc20QuoteFixture().sourceInput
        for (const amount of ['abc', undefined, '']) {
            expect(() => assertQuoteMatches(bridgedErc20QuoteFixture({ sourceInput: { ...si, amount } }), bridgedErc20RequestFixture())).toThrow('PRIVATE_UNSUPPORTED')
        }
    })

    it('koprulu: sourceInput varligi ya da zinciri istenenden farkliysa MISMATCH', () => {
        const si = bridgedErc20QuoteFixture().sourceInput
        for (const over of [{ asset: 'USDC' }, { asset: undefined }, { chainId: 56 }, { chainId: undefined }]) {
            expect(() => assertQuoteMatches(bridgedErc20QuoteFixture({ sourceInput: { ...si, ...over } }), bridgedErc20RequestFixture()), JSON.stringify(over)).toThrow('PRIVATE_QUOTE_MISMATCH')
        }
    })

    it('dogrudan: sourceInput varsa quote.amount ile BIREBIR ayni, USDC ve BSC olmali', () => {
        const si = quoteFixture().sourceInput
        // quote.amount 900 USDC, kart 25 diyor
        expect(() => assertQuoteMatches(quoteFixture({ amount: '900000000000000000000' }), requestFixture())).toThrow('PRIVATE_QUOTE_MISMATCH')
        for (const over of [{ amount: '25000000000000000001' }, { asset: 'USDT' }, { chainId: 1 }]) {
            expect(() => assertQuoteMatches(quoteFixture({ sourceInput: { ...si, ...over } }), requestFixture()), JSON.stringify(over)).toThrow('PRIVATE_QUOTE_MISMATCH')
        }
        expect(() => assertQuoteMatches(quoteFixture({ sourceInput: { ...si, amount: 'abc' } }), requestFixture())).toThrow('PRIVATE_UNSUPPORTED')
    })

    it('sourceInput.decimals kayit defterindekiyle ayni degilse MISMATCH (21 ondalik 1000 USDC yi 1.0 gosterirdi)', () => {
        const si = quoteFixture().sourceInput
        const q = quoteFixture({ amount: '1000000000000000000000', sourceInput: { ...si, amount: '1000000000000000000000', decimals: 21 } })
        expect(() => assertQuoteMatches(q, requestFixture({ payoutUsdc: '1000' }))).toThrow('PRIVATE_QUOTE_MISMATCH')
        expect(yakala(() => assertQuoteMatches(q, requestFixture({ payoutUsdc: '1000' }))).reason).toBe('direct.sourceInput.decimals')
        const bsi = bridgedErc20QuoteFixture().sourceInput
        expect(yakala(() => assertQuoteMatches(bridgedErc20QuoteFixture({ sourceInput: { ...bsi, decimals: 18 } }), bridgedErc20RequestFixture())).reason).toBe('bridge.sourceInput.decimals')
    })

    it('dogrudan: sourceInput yoksa quote.amount tek odeme rakamidir ve gecer', () => {
        expect(() => assertQuoteMatches(quoteFixture({ sourceInput: undefined }), requestFixture())).not.toThrow()
    })

    it('BSC USDC isteginde teklif bridge tasiyorsa dogrudan rota sabitleri kapatilamaz: MISMATCH (sahte bridge yoklamasi)', () => {
        const q = quoteFixture({
            amount: '900000000000000000000',
            deposit: { ...quoteFixture().deposit, to: SAHTE },
            bridge: { protocol: 'relay', sourceChainId: 56, destinationChainId: 56, sourceToken: USDC_BSC, sourceUsdc: USDC_BSC, estimatedDeliveryMs: 1, sourceAmount: '900000000000000000000' },
            sourceInput: { amount: '900000000000000000000', asset: 'USDC', decimals: 18, chainId: 56 },
        })
        expect(() => assertQuoteMatches(q, requestFixture())).toThrow('PRIVATE_QUOTE_MISMATCH')
        expect(yakala(() => assertQuoteMatches(q, requestFixture())).reason).toBe('route.bridge-on-direct')
    })
})

describe('assertQuoteMatches: sifir alici, bozuk yapi (S2, M1)', () => {
    it('istenen ya da teklifteki alici sifir adres ise PRIVATE_UNSUPPORTED', () => {
        const r0 = quoteFixture().recipients[0]
        const sifirAlici = quoteFixture({ recipients: [{ ...r0, address: SIFIR }] })
        expect(() => assertQuoteMatches(sifirAlici, requestFixture({ outputAddress: SIFIR }))).toThrow('PRIVATE_UNSUPPORTED')
        expect(() => assertQuoteMatches(sifirAlici, requestFixture())).toThrow('PRIVATE_UNSUPPORTED')
        expect(() => assertQuoteMatches(quoteFixture(), requestFixture({ outputAddress: SIFIR }))).toThrow('PRIVATE_UNSUPPORTED')
    })

    it('sourceAsset prototip adlari ham TypeError degil PRIVATE_UNSUPPORTED atar', () => {
        for (const a of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
            expect(() => assertQuoteMatches(quoteFixture(), requestFixture({ sourceAsset: a })), a).toThrow('PRIVATE_UNSUPPORTED')
        }
    })

    it('amount alani olmayan ya da bos teklif PRIVATE_UNSUPPORTED (MISMATCH degil)', () => {
        for (const amount of [undefined, null, '']) {
            expect(() => assertQuoteMatches(quoteFixture({ amount }), requestFixture()), String(amount)).toThrow('PRIVATE_UNSUPPORTED')
        }
    })
})

describe('assertQuoteMatches: hata nedeni (M2)', () => {
    const neden = (fn) => { try { fn() } catch (e) { return { message: e.message, reason: e.reason } } return null }
    const dep = (over) => ({ ...quoteFixture().deposit, ...over })

    it('mesaj yalniz kod kalir, neden err.reason alaninda tasinir', () => {
        expect(neden(() => assertQuoteMatches(quoteFixture({ deposit: dep({ to: SAHTE }) }), requestFixture()))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'direct.to' })
        expect(neden(() => assertQuoteMatches(quoteFixture({ gateway: SAHTE }), requestFixture()))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'gateway' })
        expect(neden(() => assertQuoteMatches(quoteFixture({ deposit: dep({ value: '1' }) }), requestFixture()))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'direct.value' })
        expect(neden(() => assertQuoteMatches(quoteFixture({ payoutAmount: '26000000000000000000' }), requestFixture()))).toEqual({ message: 'PRIVATE_QUOTE_MISMATCH', reason: 'payout.quote' })
        expect(neden(() => assertQuoteMatches(quoteFixture({ ticket: '' }), requestFixture()))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'ticket' })
        expect(neden(() => assertQuoteMatches(bridgedErc20QuoteFixture({ sourceInput: undefined }), bridgedErc20RequestFixture()))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'bridge.sourceInput' })
    })

    it('her red bir neden tasir (hicbiri bos birakilmaz)', () => {
        const kotuler = [
            [null, requestFixture()],
            [quoteFixture({ deposit: undefined }), requestFixture()],
            [quoteFixture({ deposit: dep({ chainId: 1 }) }), requestFixture()],
            [quoteFixture({ deposit: dep({ data: '0x' }) }), requestFixture()],
            [quoteFixture({ deposit: dep({ data: '0xa9059cbb' + '00'.repeat(32) }) }), requestFixture()],
            [quoteFixture({ usdc: SAHTE }), requestFixture()],
            [quoteFixture({ amount: undefined }), requestFixture()],
            [quoteFixture({ amount: '1' }), requestFixture()],
            [quoteFixture({ recipients: [] }), requestFixture()],
            [quoteFixture({ dest: {} }), requestFixture()],
            [quoteFixture(), requestFixture({ outputToken: 'DAI' })],
            [quoteFixture(), requestFixture({ sourceAsset: 'constructor' })],
            [bridgedErc20QuoteFixture({ bridge: { ...bridgedErc20QuoteFixture().bridge, sourceToken: SAHTE } }), bridgedErc20RequestFixture()],
            [bridgedNativeQuoteFixture({ deposit: { ...bridgedNativeQuoteFixture().deposit, value: '0' } }), bridgedNativeRequestFixture()],
        ]
        for (const [q, r] of kotuler) {
            const e = neden(() => assertQuoteMatches(q, r))
            expect(e, 'atmadi').not.toBeNull()
            expect(e.message).toMatch(/^PRIVATE_(UNSUPPORTED|QUOTE_MISMATCH)$/)
            expect(e.reason, e.message).toMatch(/^[a-z]+(\.[A-Za-z-]+)*$/)
        }
    })
})

describe('assertQuoteMatches: yasak secici listesi (savunma derinligi, SINIR DEGIL)', () => {
    const neden = (fn) => { try { fn() } catch (e) { return e } return null }
    const SECICILER = {
        '0x095ea7b3': 'approve', '0xa9059cbb': 'transfer', '0x23b872dd': 'transferFrom', '0x39509351': 'increaseAllowance',
        '0xd505accf': 'permit', '0xa22cb465': 'setApprovalForAll',
        '0x87517c45': 'Permit2 approve', '0x2b67b570': 'Permit2 permit', '0x36c78516': 'Permit2 transferFrom',
        '0x42842e0e': 'ERC-721 safeTransferFrom', '0xb88d4fde': 'ERC-721 safeTransferFrom(data)',
        '0xf242432a': 'ERC-1155 safeTransferFrom', '0x2eb2c2d6': 'ERC-1155 safeBatchTransferFrom',
        '0xb753a98c': 'DAI push', '0xbb35783b': 'DAI move', '0xf2d5d56b': 'DAI pull',
        '0x4000aea0': 'ERC-677 transferAndCall', '0xa457c2d7': 'decreaseAllowance',
    }

    it('her yasak secici dogrudan rotada deposit.selector ile reddedilir', () => {
        for (const [sel, ad] of Object.entries(SECICILER)) {
            const q = quoteFixture({ deposit: { ...quoteFixture().deposit, data: sel + '00'.repeat(64) } })
            const e = neden(() => assertQuoteMatches(q, requestFixture()))
            expect(e, ad).not.toBeNull()
            expect(e.message, ad).toBe('PRIVATE_UNSUPPORTED')
            expect(e.reason, ad).toBe('deposit.selector')
        }
    })

    it('yasak secici buyuk harfli yazilsa da reddedilir', () => {
        const q = quoteFixture({ deposit: { ...quoteFixture().deposit, data: '0xB753A98C' + '00'.repeat(64) } })
        expect(neden(() => assertQuoteMatches(q, requestFixture())).reason).toBe('deposit.selector')
    })
})

// C:C1 / M2-I2. Koprulu rotada deposit.to ve calldata sunucudan gelir; liste bunlari sabitleyemez.
// Kaynak hesabin onceden verdigi izinler ve elindeki varliklar da gosterilen odeme tutarinin
// ustunde risk altindadir. Sabit KAPALIYKEN hicbir koprulu teklif kabul edilmez.
describe('assertQuoteMatches: koprulu kaynaklar KAPALI (PRIVATE_BRIDGED_SOURCES=false)', () => {
    beforeAll(() => { flags.bridged = false })
    afterAll(() => { flags.bridged = true })
    const neden = (fn) => { try { fn() } catch (e) { return e } return null }
    const DAI_TOKEN = getAddress('0x6b175474e89094c44da98b954eedeac495271d0f')
    const PERMIT2 = getAddress('0x000000000022d473030f116ddee9f6b43ac78ba3')
    const dai = (over) => bridgedDaiQuoteFixture({ deposit: { ...bridgedDaiQuoteFixture().deposit, ...over } })

    // Dort kuru calistirmadaki sahte teklif (to + calldata): DAI push, DAI move, Permit2 approve, ERC-721.
    const SAHTELER = {
        'DAI push 0xb753a98c': dai({ to: DAI_TOKEN, data: '0xb753a98c' + '00'.repeat(64) }),
        'DAI move 0xbb35783b': dai({ to: DAI_TOKEN, data: '0xbb35783b' + '00'.repeat(96) }),
        'Permit2 approve 0x87517c45': dai({ to: PERMIT2, data: '0x87517c45' + '00'.repeat(128) }),
        'ERC-721 safeTransferFrom 0x42842e0e': dai({ to: SAHTE, data: '0x42842e0e' + '00'.repeat(96) }),
    }

    it('dort sahte teklif reddedilir', () => {
        for (const [ad, q] of Object.entries(SAHTELER)) {
            const e = neden(() => assertQuoteMatches(q, bridgedDaiRequestFixture()))
            expect(e, ad).not.toBeNull()
            expect(e.message, ad).toBe('PRIVATE_UNSUPPORTED')
        }
    })

    it('secici yasak listesinde olmayan sahte teklif de kapali oldugu icin reddedilir (bridged.closed)', () => {
        for (const to of [SAHTE, ROUTER, DAI_TOKEN]) {
            const e = neden(() => assertQuoteMatches(dai({ to, data: '0xdeadbeef' + '00'.repeat(64) }), bridgedDaiRequestFixture()))
            expect(e.message).toBe('PRIVATE_UNSUPPORTED')
            expect(e.reason).toBe('bridged.closed')
        }
    })

    it('onceden kabul edilen koprulu teklifler (ERC-20, native, DAI) artik reddedilir', () => {
        expect(neden(() => assertQuoteMatches(bridgedErc20QuoteFixture(), bridgedErc20RequestFixture())).reason).toBe('bridged.closed')
        expect(neden(() => assertQuoteMatches(bridgedNativeQuoteFixture(), bridgedNativeRequestFixture())).reason).toBe('bridged.closed')
        expect(neden(() => assertQuoteMatches(bridgedDaiQuoteFixture(), bridgedDaiRequestFixture())).reason).toBe('bridged.closed')
    })

    it('deposit.to sahte bir kopru yonlendiricisi olan teklif reddedilir (eski artik risk)', () => {
        const q = bridgedErc20QuoteFixture({ deposit: { ...bridgedErc20QuoteFixture().deposit, to: SAHTE } })
        expect(() => assertQuoteMatches(q, bridgedErc20RequestFixture())).toThrow('PRIVATE_UNSUPPORTED')
    })

    it('BSC kaynakli USDT (bridge.sourceChainId = destinationChainId = 56) reddedilir', () => {
        const e = neden(() => assertQuoteMatches(bridgedBscUsdtQuoteFixture(), bridgedBscUsdtRequestFixture()))
        expect(e).not.toBeNull()
        expect(e.message).toBe('PRIVATE_UNSUPPORTED')
        expect(e.reason).toBe('bridged.closed')
    })

    it('BSC USDC isteginde bridge tasiyan teklif yine MISMATCH (sahte bridge yoklamasi) olarak reddedilir', () => {
        const q = quoteFixture({ bridge: { protocol: 'relay', sourceChainId: 56, destinationChainId: 56, sourceToken: USDC_BSC, sourceUsdc: USDC_BSC, estimatedDeliveryMs: 1, sourceAmount: '25250000000000000000' } })
        expect(neden(() => assertQuoteMatches(q, requestFixture())).reason).toBe('route.bridge-on-direct')
    })

    it('dogrudan BSC USDC teklifi kapaliyken de gecer', () => {
        expect(() => assertQuoteMatches(quoteFixture(), requestFixture())).not.toThrow()
    })
})

// M2-m8: dest akisinda paranin gidecegi yer siparis kaydinin destAddress'idir (teklifin recipients yankisi
// degil; kayitta recipients[0].address SIFIR yer tutucudur). Teklif aninda, kullaniciya gostermeden once denetlenir.
describe('assertOrderStateMatches (siparis kaydi, yatirmadan once)', () => {
    const neden = (fn) => { try { fn() } catch (e) { return { message: e.message, reason: e.reason } } return null }
    const Q = quoteFixture()
    const REQ = requestFixture()

    it('canli sekilli USDC ve BNB kaydi gecer (destAddress kucuk harfli olabilir)', () => {
        expect(() => assertOrderStateMatches(orderStateFixture(), REQ, Q)).not.toThrow()
        // Canli: kayittaki en az teslim teklifinkinden YUKSEK (14.64 > 14.35); yer tutucu adres istenen adres de olabilir.
        expect(() => assertOrderStateMatches(orderStateFixture({}, { minDestAmount: '24500000000000000000', address: GIZLI }), REQ, Q)).not.toThrow()
        const bnbQ = quoteFixture({ dest: { ...NATIVE_BNB_DEST, minDestAmount: '1', expectedDestAmount: '2' } })
        const bnbState = orderStateFixture({}, { destAssetId: SIFIR, destAssetSymbol: 'BNB' })
        expect(() => assertOrderStateMatches(bnbState, requestFixture({ outputToken: BNB56 }), bnbQ)).not.toThrow()
    })

    it('hedef adres istenen degilse (ya da yok/sifir) MISMATCH: order.destAddress', () => {
        for (const destAddress of [SAHTE, undefined, SIFIR, 'garbage']) {
            expect(neden(() => assertOrderStateMatches(orderStateFixture({}, { destAddress }), REQ, Q)), String(destAddress)).toEqual({ message: 'PRIVATE_QUOTE_MISMATCH', reason: 'order.destAddress' })
        }
    })

    it('hedef varlik/zincir/tur istenen degilse MISMATCH: order.destAsset (USDC istendi, BNB kaydi dahil)', () => {
        for (const over of [{ destAssetId: SIFIR }, { destChainId: 1 }, { destChainKind: 'svm' }, { destAssetId: undefined }]) {
            expect(neden(() => assertOrderStateMatches(orderStateFixture({}, over), REQ, Q)), JSON.stringify(over)).toEqual({ message: 'PRIVATE_QUOTE_MISMATCH', reason: 'order.destAsset' })
        }
    })

    it('ticket, durum, tutar, gateway, imzaci (iade adresi) ya da alici sayisi uyusmazsa MISMATCH', () => {
        const r0 = orderStateFixture().recipients[0]
        const vakalar = [
            [orderStateFixture({ ticket: '0x' + '02'.repeat(32) }), 'order.ticket'],
            [orderStateFixture({ status: 'OPEN' }), 'order.status'],
            [orderStateFixture({ amount: '1' }), 'order.amount'],
            [orderStateFixture({ gateway: SAHTE }), 'order.gateway'],
            [orderStateFixture({ signer: SAHTE }), 'order.signer'],
            [orderStateFixture({ recipients: [] }), 'order.recipient.count'],
            [orderStateFixture({ recipients: [r0, { ...r0, splitIndex: 1 }] }), 'order.recipient.count'],
            [orderStateFixture({}, { payoutAmount: '1' }), 'order.payout'],
            // Inceleme 3-4: kaynak turu (iade order.signer'a yalniz evm kaynakli sipariste gider), kaynak varlik,
            // alici zinciri ve yer tutucu adres (sifir ya da istenen; baska adres yedek dogrudan odeme yolu olurdu).
            [orderStateFixture({ sourceChainKind: 'svm' }), 'order.sourceChainKind'],
            [orderStateFixture({ sourceAsset: 'USDT' }), 'order.sourceAsset'],
            [orderStateFixture({}, { chainId: 1 }), 'order.recipient.chain'],
            [orderStateFixture({}, { address: SAHTE }), 'order.recipient.address'],
            [orderStateFixture({}, { address: 'garbage' }), 'order.recipient.address'],
            // Inceleme 1: kartin "en az teslim" satiri tekliften gelir; iscinin uyguladigi en az (kayit) ondan KUCUK olamaz.
            [orderStateFixture({}, { minDestAmount: '1' }), 'order.minDest'],
        ]
        for (const [state, reason] of vakalar) {
            expect(neden(() => assertOrderStateMatches(state, REQ, Q)), reason).toEqual({ message: 'PRIVATE_QUOTE_MISMATCH', reason })
        }
    })

    it('bozuk kayit PRIVATE_UNSUPPORTED (sekil disi, okunamayan tutar)', () => {
        for (const state of [null, undefined, 'x', 42]) {
            expect(() => assertOrderStateMatches(state, REQ, Q), String(state)).toThrow('PRIVATE_UNSUPPORTED')
        }
        expect(() => assertOrderStateMatches(orderStateFixture({}, { payoutAmount: 'abc' }), REQ, Q)).toThrow('PRIVATE_UNSUPPORTED')
        expect(() => assertOrderStateMatches(orderStateFixture({ amount: undefined }), REQ, Q)).toThrow('PRIVATE_UNSUPPORTED')
        expect(() => assertOrderStateMatches(orderStateFixture({}, { minDestAmount: undefined }), REQ, Q)).toThrow('PRIVATE_UNSUPPORTED')
    })
})

describe('depositPlanFromQuote', () => {
    it('BSC USDC: gateway icin TAM tutarlik USDC izni', () => {
        const p = depositPlanFromQuote(quoteFixture())
        expect(p.chainId).toBe(56)
        expect(p.approval).toEqual({ token: getAddress(USDC_BSC), spender: GATEWAY, amount: 25250000000000000000n })
        expect(p.deposit).toEqual({ to: GATEWAY, data: quoteFixture().deposit.data, value: 0n })
    })

    it('koprulu ERC-20: kaynak token, spender deposit.to, tutar bridge.sourceAmount', () => {
        const q = quoteFixture({
            deposit: { to: ROUTER, data: '0xabcdef01', value: '0', chainId: 1 },
            bridge: { protocol: 'x', sourceChainId: 1, destinationChainId: 56, sourceToken: USDT_ETH, sourceUsdc: '', estimatedDeliveryMs: 1, sourceAmount: '25300000' },
        })
        expect(depositPlanFromQuote(q).approval).toEqual({ token: getAddress(USDT_ETH), spender: ROUTER, amount: 25300000n })
    })

    it('native kaynak (sifir adres): izin yok, value tasinir', () => {
        const q = quoteFixture({
            deposit: { to: ROUTER, data: '0xabcdef01', value: '10000000000000000', chainId: 1 },
            bridge: { protocol: 'x', sourceChainId: 1, destinationChainId: 56, sourceToken: '0x0000000000000000000000000000000000000000', sourceUsdc: '', estimatedDeliveryMs: 1, sourceAmount: '10000000000000000' },
        })
        const p = depositPlanFromQuote(q)
        expect(p.approval).toBe(null)
        expect(p.deposit.value).toBe(10000000000000000n)
    })

    it('native kaynak (SDK sentinel sabiti): izin yok', () => {
        const q = quoteFixture({
            deposit: { to: ROUTER, data: '0xabcdef01', value: '10000000000000000', chainId: 1 },
            bridge: { protocol: 'x', sourceChainId: 1, destinationChainId: 56, sourceToken: NATIVE_TOKEN_SENTINEL, sourceUsdc: '', estimatedDeliveryMs: 1, sourceAmount: '10000000000000000' },
        })
        expect(depositPlanFromQuote(q).approval).toBe(null)
    })

    // T2 M3: izin turetilemeyen teklif sessizce izinsiz sayilmaz.
    it('izni turetilemeyen teklif PRIVATE_UNSUPPORTED: bicim disi kopru tokeni, dogrudan rotada value', () => {
        const kopru = bridgedErc20QuoteFixture()
        expect(() => depositPlanFromQuote({ ...kopru, bridge: { ...kopru.bridge, sourceToken: 'native' } })).toThrow('PRIVATE_UNSUPPORTED')
        expect(() => depositPlanFromQuote({ ...kopru, bridge: { ...kopru.bridge, sourceToken: undefined } })).toThrow('PRIVATE_UNSUPPORTED')
        const dogrudan = quoteFixture()
        expect(() => depositPlanFromQuote({ ...dogrudan, deposit: { ...dogrudan.deposit, value: '5' } })).toThrow('PRIVATE_UNSUPPORTED')
        expect(() => depositPlanFromQuote({ ...dogrudan, usdc: 'yok' })).toThrow('PRIVATE_UNSUPPORTED')
        expect(() => depositPlanFromQuote({ ...dogrudan, gateway: SIFIR })).toThrow('PRIVATE_UNSUPPORTED')
    })

    it('approveCall dogru ABI kodlar', () => {
        const c = approveCall({ token: USDC_BSC, spender: GATEWAY, amount: 5n })
        expect(c.to).toBe(USDC_BSC)
        expect(c.value).toBe(0n)
        expect(ERC20.decodeFunctionData('approve', c.data).map(String)).toEqual([GATEWAY, '5'])
    })
})

describe('atsCallsFromPlan', () => {
    it('izinli plan: [approve, deposit], deposit AYNI nesne', () => {
        const p = depositPlanFromQuote(quoteFixture())
        const calls = atsCallsFromPlan(p)
        expect(calls).toHaveLength(2)
        expect(calls[0].to).toBe(USDC_BSC)
        expect(calls[0].data.startsWith('0x095ea7b3')).toBe(true)
        expect(calls[0].value).toBe(0n)
        expect(calls[1]).toBe(p.deposit)
    })

    it('native kaynak (izin yok): yalniz deposit', () => {
        const q = quoteFixture({
            deposit: { to: ROUTER, data: '0xabcdef01', value: '10000000000000000', chainId: 1 },
            bridge: { protocol: 'x', sourceChainId: 1, destinationChainId: 56, sourceToken: NATIVE_TOKEN_SENTINEL, sourceUsdc: '', estimatedDeliveryMs: 1, sourceAmount: '10000000000000000' },
        })
        const p = depositPlanFromQuote(q)
        const calls = atsCallsFromPlan(p)
        expect(calls).toHaveLength(1)
        expect(calls[0]).toBe(p.deposit)
    })

    // T6 (7.6 madde 1): artik izin. USDT benzeri tokenlar sifir olmayan izni dogrudan degistirmez: izin tutara esit degilse
    // ve sifirdan buyukse once approve(spender, 0). Hicbir yerde approve sayisi tahminle azaltilmaz.
    describe('artik izin (allowanceRaw)', () => {
        const plan = () => depositPlanFromQuote(quoteFixture())
        const tutar = () => plan().approval.amount
        const approveArgs = (c) => ERC20.decodeFunctionData('approve', c.data).map(String)

        it('allowanceRaw null/verilmemis: eski davranis [approve(tutar), deposit]', () => {
            const p = plan()
            for (const calls of [atsCallsFromPlan(p), atsCallsFromPlan(p, null)]) {
                expect(calls).toHaveLength(2)
                expect(approveArgs(calls[0])).toEqual([GATEWAY, String(p.approval.amount)])
                expect(calls[1]).toBe(p.deposit)
            }
        })

        it('izin tutara ESIT: yalniz deposit (approve atlanir)', () => {
            const p = plan()
            const calls = atsCallsFromPlan(p, tutar())
            expect(calls).toHaveLength(1)
            expect(calls[0]).toBe(p.deposit)
        })

        it('izin 0n: [approve(tutar), deposit]', () => {
            const p = plan()
            const calls = atsCallsFromPlan(p, 0n)
            expect(calls).toHaveLength(2)
            expect(approveArgs(calls[0])).toEqual([GATEWAY, String(p.approval.amount)])
            expect(calls[1]).toBe(p.deposit)
        })

        it.each([[5n], [tutar() + 1n]])('artik izin %s: [approve(spender,0), approve(spender,tutar), deposit]', (izin) => {
            const p = plan()
            const calls = atsCallsFromPlan(p, izin)
            expect(calls).toHaveLength(3)
            expect(calls[0].to).toBe(USDC_BSC)
            expect(calls[1].to).toBe(USDC_BSC)
            expect(approveArgs(calls[0])).toEqual([GATEWAY, '0'])
            expect(approveArgs(calls[1])).toEqual([GATEWAY, String(p.approval.amount)])
            expect(calls[0].value).toBe(0n)
            expect(calls[1].value).toBe(0n)
            expect(calls[2]).toBe(p.deposit)
        })

        it('native plan (approval yok) her izin degerinde yalniz [deposit]', () => {
            const q = quoteFixture({
                deposit: { to: ROUTER, data: '0xabcdef01', value: '10000000000000000', chainId: 1 },
                bridge: { protocol: 'x', sourceChainId: 1, destinationChainId: 56, sourceToken: NATIVE_TOKEN_SENTINEL, sourceUsdc: '', estimatedDeliveryMs: 1, sourceAmount: '10000000000000000' },
            })
            const p = depositPlanFromQuote(q)
            for (const izin of [undefined, null, 0n, 5n, 10n ** 30n]) {
                const calls = atsCallsFromPlan(p, izin)
                expect(calls).toHaveLength(1)
                expect(calls[0]).toBe(p.deposit)
            }
        })
    })
})

describe('ozet ve hata kodlari', () => {
    it('expiresAt saniye ya da milisaniye olabilir', () => {
        expect(expiresAtMs(1700000000)).toBe(1700000000000)
        expect(expiresAtMs(1700000000000)).toBe(1700000000000)
        expect(expiresAtMs(undefined)).toBe(null)
        expect(expiresAtMs(0)).toBe(null)
        expect(expiresAtMs(NaN)).toBe(null)
    })

    it('ozet yalniz dizge/sayi tasir ve tutarlar SDK formatUsdc ile bicimlenir', () => {
        const s = quoteSummary(quoteFixture(), USDC56)
        expect(s.payoutUsdc).toBe(formatUsdc('25000000000000000000'))
        expect(s.totalUsdc).toBe(formatUsdc('25250000000000000000'))
        // Teslim agi, varligi ve ondaligi sunucu yankisindan degil, SECIMDEN gelir (K6).
        expect(s.dest).toEqual({ chainId: 56, asset: 'USDC', decimals: 18, expectedDestAmount: '24650000000000000000', minDestAmount: '24000000000000000000', quoteUsd: null })
        const bnb = quoteSummary(quoteFixture({ dest: { ...NATIVE_BNB_DEST, assetSymbol: 'USDC', minDestAmount: '1', expectedDestAmount: '2' } }), BNB56)
        expect(bnb.dest).toEqual({ chainId: 56, asset: 'BNB', decimals: 18, expectedDestAmount: '2', minDestAmount: '1', quoteUsd: null })
        expect(s.serviceFeeUsdc).toBe(formatUsdc('125000000000000000'))
        expect(s.integratorFeeUsdc).toBe(formatUsdc('125000000000000000'))
        expect(s.recipientChainId).toBe(56)
        expect(JSON.parse(JSON.stringify(s))).toEqual(s)
    })

    it('SDK hatalari koda donusur', () => {
        expect(privacyErrorCode(new AmountOutOfRangeError('amount_below_minimum', {}))).toBe('PRIVATE_MIN_AMOUNT')
        expect(privacyErrorCode(new AmountOutOfRangeError('amount_above_maximum', {}))).toBe('PRIVATE_MAX_AMOUNT')
        expect(privacyErrorCode(new MaintenanceModeError())).toBe('PRIVATE_PROVIDER_DOWN')
        expect(privacyErrorCode(new HttpError(503, {}))).toBe('PRIVATE_PROVIDER_DOWN')
        expect(privacyErrorCode(new HttpError(400, {}))).toBe('PRIVATE_PROVIDER_ERROR')
        expect(privacyErrorCode(new Error('PRIVATE_QUOTE_EXPIRED'))).toBe('PRIVATE_QUOTE_EXPIRED')
        expect(privacyErrorCode(new Error('WALLET_LOCKED'))).toBe('WALLET_LOCKED')
        expect(privacyErrorCode(new Error('Wallet locked. Please enter your password.'))).toBe('WALLET_LOCKED')
        expect(privacyErrorCode(new Error('CHAIN_NOT_EVM'))).toBe('PRIVATE_EVM_ONLY')
        expect(privacyErrorCode(new TypeError('Failed to fetch'))).toBe('PRIVATE_PROVIDER_DOWN')
        expect(privacyErrorCode(new TypeError('fetch failed'))).toBe('PRIVATE_PROVIDER_DOWN')
        expect(privacyErrorCode(new TypeError('NetworkError when attempting to fetch resource.'))).toBe('PRIVATE_PROVIDER_DOWN')
        expect(privacyErrorCode(new Error('boom'))).toBe('PRIVATE_FAILED')
    })

    it('gaz yetmezligi PRIVATE_INSUFFICIENT_GAS: ethers kodu ya da mesaj', () => {
        expect(privacyErrorCode(Object.assign(new Error('x'), { code: 'INSUFFICIENT_FUNDS' }))).toBe('PRIVATE_INSUFFICIENT_GAS')
        expect(privacyErrorCode(new Error('insufficient funds for intrinsic transaction cost'))).toBe('PRIVATE_INSUFFICIENT_GAS')
        expect(privacyErrorCode(new Error('Insufficient Funds'))).toBe('PRIVATE_INSUFFICIENT_GAS')
    })

    it('fetch ile ilgisiz TypeError yerel hatadir: PRIVATE_FAILED (saglayici kesintisi degil)', () => {
        expect(privacyErrorCode(new TypeError("Cannot read properties of undefined (reading 'ticket')"))).toBe('PRIVATE_FAILED')
        expect(privacyErrorCode(new TypeError('x is not a function'))).toBe('PRIVATE_FAILED')
    })
})

// Alt proje 1 (spec 2026-10-10 teslim tokenleri): alici herhangi bir BSC tokenini alabilir.
describe('teslim tokeni: secilen BSC tokeni (CAKE)', () => {
    const neden = (fn) => { try { fn() } catch (e) { return { message: e.message, reason: e.reason } } return null }
    const CAKE = { chainId: 56, address: getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'), symbol: 'CAKE', decimals: 18 }
    const CAKE_DEST_ECHO = { kind: 'evm', chainId: 56, assetId: CAKE.address, assetSymbol: 'CAKE', assetDecimals: 18, minDestAmount: '6000000000000000000', expectedDestAmount: '6500000000000000000' }

    it('destFor token tanimindan dest blogu kurar; tablo USDC ve yerel coin icin tablo degerleri; bozuk token reddedilir', () => {
        expect(destFor(CAKE)).toEqual({ kind: 'evm', chainId: 56, assetId: CAKE.address, assetSymbol: 'CAKE', assetDecimals: 18 })
        expect(destFor({ chainId: 56, address: USDC_BSC.toLowerCase(), symbol: 'X', decimals: 6 })).toEqual(USDC_BSC_DEST)
        expect(destFor({ chainId: 56, address: SIFIR, symbol: 'BNB', decimals: 18 })).toEqual(NATIVE_BNB_DEST)
        expect(neden(() => destFor({ ...CAKE, decimals: 99 }))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'request.outputToken' })
    })

    it('istek kurucu outputToken ile secilen tokenin dest blogunu koyar', () => {
        const base = { sourceChainId: 56, sourceAsset: 'USDC', inputAddress: GIRDI, outputAddress: GIZLI, payoutUsdc: '15' }
        expect(buildPrivateQuoteRequest({ ...base, outputToken: CAKE }).outputs[0].dest).toEqual(destFor(CAKE))
    })

    it('teklif: dest secilen token ise gecer; baska varliksa dest.echo; USDC disi tokende en az > odeme serbest', () => {
        const req = requestFixture({ outputToken: CAKE })
        expect(() => assertQuoteMatches(quoteFixture({ dest: { ...CAKE_DEST_ECHO } }), req)).not.toThrow()
        expect(neden(() => assertQuoteMatches(quoteFixture(), req))).toEqual({ message: 'PRIVATE_QUOTE_MISMATCH', reason: 'dest.echo' })
        // CAKE birimi USDC degil: 30 CAKE en az teslim, 24.75 USDC odemeden "buyuk" gorunse de reddedilmez.
        const yuksek = { ...CAKE_DEST_ECHO, minDestAmount: '30000000000000000000', expectedDestAmount: '31000000000000000000' }
        expect(() => assertQuoteMatches(quoteFixture({ dest: yuksek }), req)).not.toThrow()
    })

    it('siparis kaydi: destAssetId secilen token ise gecer, USDC ise order.destAsset', () => {
        const q = quoteFixture({ dest: { ...CAKE_DEST_ECHO } })
        const req = requestFixture({ outputToken: CAKE })
        expect(() => assertOrderStateMatches(orderStateFixture({}, { destAssetId: CAKE.address.toLowerCase(), destAssetSymbol: 'CAKE', minDestAmount: '6000000000000000000' }), req, q)).not.toThrow()
        expect(neden(() => assertOrderStateMatches(orderStateFixture({}, { minDestAmount: '6000000000000000000' }), req, q))).toEqual({ message: 'PRIVATE_QUOTE_MISMATCH', reason: 'order.destAsset' })
    })

    it('bozuk outputToken beklentisi PRIVATE_UNSUPPORTED (request.outputToken)', () => {
        for (const outputToken of [{ ...CAKE, address: 'garbage' }, { ...CAKE, decimals: 37 }, { ...CAKE, symbol: '' }, 'DAI', null]) {
            expect(neden(() => assertQuoteMatches(quoteFixture(), requestFixture({ outputToken }))), JSON.stringify(outputToken)).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'request.outputToken' })
        }
    })

    it('ozet secilen tokenin sembol ve ondaligini tasir (sunucu yankisi degil)', () => {
        const s = quoteSummary(quoteFixture({ dest: { ...CAKE_DEST_ECHO, assetSymbol: 'SAHTE', assetDecimals: 6 } }), CAKE)
        expect(s.dest).toEqual({ chainId: 56, asset: 'CAKE', decimals: 18, expectedDestAmount: '6500000000000000000', minDestAmount: '6000000000000000000', quoteUsd: null })
    })

    it('rota yok (502 ROUTE_TEMPORARILY_UNAVAILABLE) PRIVATE_ROUTE_UNAVAILABLE; diger 5xx saglayici kesintisi', () => {
        expect(privacyErrorCode(new HttpError(502, { error: 'near_payout_preflight_failed', errorCode: 'ROUTE_TEMPORARILY_UNAVAILABLE', message: 'x' }))).toBe('PRIVATE_ROUTE_UNAVAILABLE')
        expect(privacyErrorCode(new HttpError(502, { error: 'near_payout_preflight_failed' }))).toBe('PRIVATE_ROUTE_UNAVAILABLE')
        // Yalniz errorCode (error alani yok) da rota yok sayilir.
        expect(privacyErrorCode(new HttpError(502, { errorCode: 'ROUTE_TEMPORARILY_UNAVAILABLE' }))).toBe('PRIVATE_ROUTE_UNAVAILABLE')
        expect(privacyErrorCode(new HttpError(502, { error: 'bad_gateway' }))).toBe('PRIVATE_PROVIDER_DOWN')
        expect(privacyErrorCode(new HttpError(503, null))).toBe('PRIVATE_PROVIDER_DOWN')
    })
})

// SP2 (gizli-mod cok-ag spec 4.1, 4.3, 4.4): teslim agi tokenin ICINDEDIR. Teklifte recipients[0].chainId teslim agidir; siparis
// kaydinda 56 sabittir ve teslim agi yalniz destChainId'dedir. Fikstur sekilleri 2026-10-15 canli olcumundendir (Base USDC,
// Arbitrum yerel coin).
describe('teslim agi: istek kurucu ve destFor (K4)', () => {
    const base = { sourceChainId: 56, sourceAsset: 'USDC', inputAddress: GIRDI, outputAddress: GIZLI, payoutUsdc: '15' }
    const nedenIstek = (fn) => { try { fn() } catch (e) { return { message: e.message, reason: e.reason } } return null }

    it('Base USDC: cikti ve dest ayni agi (8453) tasir; gateway/odeme zinciri (56) teslim zinciriyle birlesmez', () => {
        const r = buildRaw({ ...base, outputToken: usdcTokenOf(8453) })
        expect(r.sourceChainId).toBe(56)
        expect(r.outputs).toEqual([{
            address: GIZLI, chainId: 8453, amount: parseUsdc('15'),
            dest: { kind: 'evm', chainId: 8453, assetId: BASE_USDC, assetSymbol: 'USDC', assetDecimals: 6 },
        }])
        expect(r.outputs[0].chainId).toBe(r.outputs[0].dest.chainId)
    })

    it('Arbitrum yerel coin: sifir adres, ETH, 18 ondalik, ag 42161 (BNB degil)', () => {
        const r = buildRaw({ ...base, outputToken: nativeTokenOf(42161) })
        expect(r.outputs[0].chainId).toBe(42161)
        expect(r.outputs[0].dest).toEqual({ kind: 'evm', chainId: 42161, assetId: SIFIR, assetSymbol: 'ETH', assetDecimals: 18 })
    })

    it('BSC teslimi de kendi agini tasir (56); secilen sembol ve ag tablodan, istekteki sahte sembol yok sayilir', () => {
        const r = buildRaw({ ...base, outputToken: { chainId: '8453', address: SIFIR, symbol: 'BNB', decimals: 6 } })
        expect(r.outputs[0].dest).toEqual({ kind: 'evm', chainId: 8453, assetId: SIFIR, assetSymbol: 'ETH', assetDecimals: 18 })
        expect(buildRaw({ ...base, outputToken: USDC56 }).outputs[0].chainId).toBe(56)
    })

    // K4: sessiz BSC varsayilani tam olarak kapatilmak istenen tuzak; chainId'siz teslim sorgusu PARA YOLUNA GIRMEZ.
    it('outputToken ZORUNLU: yok, eski outputAsset dizgesi, chainId eksik ya da bozuk -> PRIVATE_UNSUPPORTED (sessizce BSC USDC e dusmez)', () => {
        expect(nedenIstek(() => buildRaw({ ...base }))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'request.outputToken' })
        expect(nedenIstek(() => buildRaw({ ...base, outputAsset: 'USDC' }))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'request.outputToken' })
        expect(nedenIstek(() => buildRaw({ ...base, outputAsset: 'BNB' }))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'request.outputToken' })
        const { chainId, ...chainIdsiz } = USDC56
        expect(nedenIstek(() => buildRaw({ ...base, outputToken: chainIdsiz }))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'request.outputToken.chainId' })
        expect(nedenIstek(() => buildRaw({ ...base, outputToken: { ...USDC56, chainId: 99999 } }))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'request.outputToken.chainId' })
    })

    it('destFor ag basina: ayni sifir adres her agda o agin yerel coini; ayni USDC adresi baska agda USDC degil', () => {
        expect(destFor(nativeTokenOf(137))).toEqual({ kind: 'evm', chainId: 137, assetId: SIFIR, assetSymbol: 'POL', assetDecimals: 18 })
        expect(destFor(usdcTokenOf(8453))).toEqual({ kind: 'evm', chainId: 8453, assetId: BASE_USDC, assetSymbol: 'USDC', assetDecimals: 6 })
        expect(destFor({ chainId: 8453, address: USDC_BSC, symbol: 'USDC', decimals: 18 })).toEqual({ kind: 'evm', chainId: 8453, assetId: USDC_BSC, assetSymbol: 'USDC', assetDecimals: 18 })
    })
})

describe('teslim agi: assertQuoteMatches (spec 4.4)', () => {
    const nedenTeklif = (fn) => { try { fn() } catch (e) { return { message: e.message, reason: e.reason } } return null }

    it('canli sekilli Base USDC ve Arbitrum yerel coin teklifleri gecer', () => {
        expect(() => assertQuoteMatches(baseUsdcQuoteFixture(), baseUsdcRequestFixture())).not.toThrow()
        expect(() => assertQuoteMatches(arbitrumNativeQuoteFixture(), arbitrumNativeRequestFixture())).not.toThrow()
    })

    it('recipients[0].chainId TESLIM agi olmali: Base istendi ama teklif 56 diyor ya da BSC istendi ama 8453 diyor -> recipient.chain', () => {
        const r0 = baseUsdcQuoteFixture().recipients[0]
        expect(nedenTeklif(() => assertQuoteMatches(baseUsdcQuoteFixture({ recipients: [{ ...r0, chainId: 56 }] }), baseUsdcRequestFixture())))
            .toEqual({ message: 'PRIVATE_QUOTE_MISMATCH', reason: 'recipient.chain' })
        const bsc = quoteFixture().recipients[0]
        expect(nedenTeklif(() => assertQuoteMatches(quoteFixture({ recipients: [{ ...bsc, chainId: 8453 }] }), requestFixture())))
            .toEqual({ message: 'PRIVATE_QUOTE_MISMATCH', reason: 'recipient.chain' })
        expect(nedenTeklif(() => assertQuoteMatches(baseUsdcQuoteFixture({ recipients: [{ ...r0, chainId: 42161 }] }), baseUsdcRequestFixture())).reason).toBe('recipient.chain')
    })

    it('dest.chainId teslim agi olmali (dest.echo): Base istendi, dest 56 ya da 42161 diyor', () => {
        for (const chainId of [56, 42161, 1]) {
            expect(nedenTeklif(() => assertQuoteMatches(baseUsdcQuoteFixture({ dest: { ...BASE_USDC_DEST_ECHO, chainId } }), baseUsdcRequestFixture())), String(chainId))
                .toEqual({ message: 'PRIVATE_QUOTE_MISMATCH', reason: 'dest.echo' })
        }
    })

    it('baska agin USDC adresi bu agda USDC degil: Base istendi, dest BSC USDC adresini tasiyor -> dest.echo', () => {
        expect(nedenTeklif(() => assertQuoteMatches(baseUsdcQuoteFixture({ dest: { ...BASE_USDC_DEST_ECHO, assetId: USDC_BSC } }), baseUsdcRequestFixture())).reason).toBe('dest.echo')
    })

    // K7: odeme (payoutAmount) 18 ondalikli gateway USDC'sidir; teslim USDC'si Base'de 6 ondaliktir. Olceksiz karsilastirma 6 ondalikta
    // HIC tetiklenmezdi: 14850001 (6 ondalik) "14.85e18'den kucuk" gorunur ve sinir sessizce atlanirdi.
    it('USDC alt siniri ondalikla olceklenir: en az teslim odemeyi asarsa reddedilir (dest.min), esitlik gecer', () => {
        const dest = (minDestAmount, expectedDestAmount) => ({ ...BASE_USDC_DEST_ECHO, minDestAmount, expectedDestAmount })
        expect(() => assertQuoteMatches(baseUsdcQuoteFixture({ dest: dest('14346647', '14787310') }), baseUsdcRequestFixture())).not.toThrow()
        expect(() => assertQuoteMatches(baseUsdcQuoteFixture({ dest: dest('14850000', '14850001') }), baseUsdcRequestFixture())).not.toThrow()
        expect(nedenTeklif(() => assertQuoteMatches(baseUsdcQuoteFixture({ dest: dest('14850001', '14850002') }), baseUsdcRequestFixture())))
            .toEqual({ message: 'PRIVATE_QUOTE_MISMATCH', reason: 'dest.min' })
        expect(nedenTeklif(() => assertQuoteMatches(baseUsdcQuoteFixture({ dest: dest('99999999999999', '99999999999999') }), baseUsdcRequestFixture())).reason).toBe('dest.min')
    })

    it('BSC USDC (18 ondalik) siniri olceksiz ayni kalir; yerel coin ve diger tokenlerde alt sinir YOKTUR', () => {
        const e = nedenTeklif(() => assertQuoteMatches(quoteFixture({ dest: { ...USDC_DEST_ECHO, minDestAmount: '25000000000000000001', expectedDestAmount: '25100000000000000000' } }), requestFixture()))
        expect(e?.reason).toBe('dest.min')
        const buyuk = { ...ARBITRUM_NATIVE_DEST_ECHO, minDestAmount: '99999999999999999999999', expectedDestAmount: '999999999999999999999999' }
        expect(() => assertQuoteMatches(arbitrumNativeQuoteFixture({ dest: buyuk }), arbitrumNativeRequestFixture())).not.toThrow()
    })

    it('sembol, ondalik ve ag sunucu yankisindan alinmaz: yankidaki sahte sembol/ondalik teklifi bozmaz', () => {
        const dest = { ...BASE_USDC_DEST_ECHO, assetSymbol: 'SAHTE', assetDecimals: 18 }
        expect(() => assertQuoteMatches(baseUsdcQuoteFixture({ dest }), baseUsdcRequestFixture())).not.toThrow()
    })

    it('teslim tokeni BSC dest.echo kurali: Base istendi ama teklif BSC USDC dest blogu tasiyor', () => {
        expect(nedenTeklif(() => assertQuoteMatches(baseUsdcQuoteFixture({ dest: { ...USDC_DEST_ECHO } }), baseUsdcRequestFixture())).reason).toBe('dest.echo')
    })
})

describe('teslim agi: assertOrderStateMatches (spec 4.4)', () => {
    const nedenKayit = (fn) => { try { fn() } catch (e) { return { message: e.message, reason: e.reason } } return null }
    const BASE_Q = baseUsdcQuoteFixture()
    const ARB_Q = arbitrumNativeQuoteFixture()

    it('canli sekilli Base ve Arbitrum kayitlari gecer: recipients[0].chainId 56 SABIT, teslim agi destChainId de', () => {
        const base = baseUsdcOrderStateFixture()
        expect(base.recipients[0].chainId).toBe(56)
        expect(base.recipients[0].destChainId).toBe(8453)
        expect(() => assertOrderStateMatches(base, baseUsdcRequestFixture(), BASE_Q)).not.toThrow()
        expect(() => assertOrderStateMatches(arbitrumNativeOrderStateFixture(), arbitrumNativeRequestFixture(), ARB_Q)).not.toThrow()
    })

    // Kayit kurali teslim agina CEVRILIRSE her BSC disi siparis reddedilir ya da kayit gevser: ikisi de hatadir (spec 8).
    it('kayitta recipients[0].chainId teslim agina cevrilmez: 8453 olursa order.recipient.chain', () => {
        expect(nedenKayit(() => assertOrderStateMatches(baseUsdcOrderStateFixture({}, { chainId: 8453 }), baseUsdcRequestFixture(), BASE_Q)))
            .toEqual({ message: 'PRIVATE_QUOTE_MISMATCH', reason: 'order.recipient.chain' })
    })

    it('destChainId teslim agi degilse order.destAsset: Base istendi, kayit 56 ya da 42161 diyor', () => {
        for (const destChainId of [56, 42161, 1]) {
            expect(nedenKayit(() => assertOrderStateMatches(baseUsdcOrderStateFixture({}, { destChainId }), baseUsdcRequestFixture(), BASE_Q)), String(destChainId))
                .toEqual({ message: 'PRIVATE_QUOTE_MISMATCH', reason: 'order.destAsset' })
        }
    })

    it('Base istendi ama kayit BSC USDC adresini tasiyor: order.destAsset; yerel coin istendi ama USDC adresi: order.destAsset', () => {
        expect(nedenKayit(() => assertOrderStateMatches(baseUsdcOrderStateFixture({}, { destAssetId: USDC_BSC }), baseUsdcRequestFixture(), BASE_Q)).reason).toBe('order.destAsset')
        expect(nedenKayit(() => assertOrderStateMatches(arbitrumNativeOrderStateFixture({}, { destAssetId: USDC_BSC }), arbitrumNativeRequestFixture(), ARB_Q)).reason).toBe('order.destAsset')
    })

    it('kayit hedef adresi, tutar ve en az teslim kurallari Base icin de gecerli', () => {
        expect(nedenKayit(() => assertOrderStateMatches(baseUsdcOrderStateFixture({}, { destAddress: SAHTE }), baseUsdcRequestFixture(), BASE_Q)).reason).toBe('order.destAddress')
        expect(nedenKayit(() => assertOrderStateMatches(baseUsdcOrderStateFixture({}, { minDestAmount: '1' }), baseUsdcRequestFixture(), BASE_Q)).reason).toBe('order.minDest')
        expect(nedenKayit(() => assertOrderStateMatches(baseUsdcOrderStateFixture({ amount: '1' }), baseUsdcRequestFixture(), BASE_Q)).reason).toBe('order.amount')
    })

    it('expected.outputToken eksik ya da chainId bozuk: PRIVATE_UNSUPPORTED (dogrulama varsayilan teslim agina dusmez)', () => {
        const { outputToken, ...tokensiz } = baseUsdcRequestFixture()
        expect(nedenKayit(() => assertOrderStateMatches(baseUsdcOrderStateFixture(), tokensiz, BASE_Q))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'request.outputToken' })
        expect(nedenKayit(() => assertQuoteMatches(baseUsdcQuoteFixture(), tokensiz))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'request.outputToken' })
        const eskiDizge = { ...tokensiz, outputAsset: 'USDC' }
        expect(nedenKayit(() => assertQuoteMatches(quoteFixture(), eskiDizge))).toEqual({ message: 'PRIVATE_UNSUPPORTED', reason: 'request.outputToken' })
    })
})

describe('teslim agi: quoteSummary (spec 4.3)', () => {
    const nedenOzet = (fn) => { try { fn() } catch (e) { return { message: e.message, reason: e.reason } } return null }

    it('outputToken ZORUNLU: verilmezse ya da bozuksa PRIVATE_UNSUPPORTED (eski token-siz dal yok)', () => {
        for (const v of [undefined, null, 'USDC', {}]) {
            expect(nedenOzet(() => quoteSummary(quoteFixture(), v)), String(v)).toMatchObject({ message: 'PRIVATE_UNSUPPORTED' })
        }
    })

    it('Base: dest.chainId/asset/decimals SECIMDEN, quoteUsd yankidan; recipientChainId sunucu yankisi olarak kalir', () => {
        const s = quoteSummary(baseUsdcQuoteFixture(), usdcTokenOf(8453))
        expect(s.dest).toEqual({ chainId: 8453, asset: 'USDC', decimals: 6, expectedDestAmount: '14787310', minDestAmount: '14346647', quoteUsd: 14.78160209834 })
        expect(s.recipientChainId).toBe(8453)
        expect(JSON.parse(JSON.stringify(s))).toEqual(s)
    })

    it('sunucu yankisindaki sahte ag/sembol/ondalik yok sayilir', () => {
        const q = baseUsdcQuoteFixture({ dest: { ...BASE_USDC_DEST_ECHO, chainId: 56, assetSymbol: 'SAHTE', assetDecimals: 18 } })
        expect(quoteSummary(q, usdcTokenOf(8453)).dest).toMatchObject({ chainId: 8453, asset: 'USDC', decimals: 6 })
    })

    it('quoteUsd yalniz sonlu ve > 0 ise sayidir; aksi halde null (yalniz bilgi)', () => {
        const kur = (destQuoteUsd) => quoteSummary(arbitrumNativeQuoteFixture({ dest: { ...ARBITRUM_NATIVE_DEST_ECHO, destQuoteUsd } }), nativeTokenOf(42161)).dest.quoteUsd
        expect(kur(14.739282208687)).toBe(14.739282208687)
        expect(kur('14.5')).toBe(14.5)
        for (const v of [undefined, null, 0, -1, NaN, Infinity, 'abc', '']) expect(kur(v), String(v)).toBeNull()
    })

    it('dest yoksa ozette dest null', () => {
        expect(quoteSummary(quoteFixture({ dest: undefined }), USDC56).dest).toBeNull()
    })
})

// SP2 (gizli-mod cok-ag spec 4.10): hata esleme sirasi ve sinir degeri.
describe('privacyErrorCode: SP2 eslemeleri ve sira (spec 4.10)', () => {
    const IMPACT = { error: 'relay_preflight_failed', errorCode: 'SWAP_IMPACT_TOO_HIGH', message: 'Swap impact is too high: 96.01%' }

    // Canli (2026-10-15): SilentSwap ATS teslimini 400 SWAP_IMPACT_TOO_HIGH ile reddetti (%96-97).
    it('400 SWAP_IMPACT_TOO_HIGH PRIVATE_IMPACT_TOO_HIGH (token a ozel, agi kapatmaz)', () => {
        expect(privacyErrorCode(new HttpError(400, IMPACT))).toBe('PRIVATE_IMPACT_TOO_HIGH')
        expect(privacyErrorCode(new HttpError(400, { errorCode: 'SWAP_IMPACT_TOO_HIGH' }))).toBe('PRIVATE_IMPACT_TOO_HIGH')
        expect(privacyErrorCode(new HttpError(400, { error: 'baska' }))).toBe('PRIVATE_PROVIDER_ERROR')
    })

    it('HTTP 429 PRIVATE_RATE_LIMITED (govde olsa da olmasa da)', () => {
        expect(privacyErrorCode(new HttpError(429, null))).toBe('PRIVATE_RATE_LIMITED')
        expect(privacyErrorCode(new HttpError(429, { error: 'rate_limited' }))).toBe('PRIVATE_RATE_LIMITED')
    })

    it('zaman asimi ve iptal PRIVATE_PROVIDER_DOWN: AbortError ve TimeoutError (DOMException ve ad tasiyan hata)', () => {
        expect(privacyErrorCode(new DOMException('iptal', 'AbortError'))).toBe('PRIVATE_PROVIDER_DOWN')
        expect(privacyErrorCode(new DOMException('zaman asimi', 'TimeoutError'))).toBe('PRIVATE_PROVIDER_DOWN')
        expect(privacyErrorCode(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('PRIVATE_PROVIDER_DOWN')
    })

    it('SIRA: SDK sinir hatasi, bakim, rota yok, etki yuksek, 429, diger HttpError, zaman asimi, mevcut eslemeler', () => {
        // rota yok, etki yuksek ve 429'dan ONCE gelir
        expect(privacyErrorCode(new HttpError(429, { errorCode: 'ROUTE_TEMPORARILY_UNAVAILABLE' }))).toBe('PRIVATE_ROUTE_UNAVAILABLE')
        // etki yuksek 429'dan ONCE gelir
        expect(privacyErrorCode(new HttpError(429, { errorCode: 'SWAP_IMPACT_TOO_HIGH' }))).toBe('PRIVATE_IMPACT_TOO_HIGH')
        // 429 diger HttpError'dan (4xx) once; 5xx hala saglayici kesintisi
        expect(privacyErrorCode(new HttpError(429, {}))).toBe('PRIVATE_RATE_LIMITED')
        expect(privacyErrorCode(new HttpError(500, {}))).toBe('PRIVATE_PROVIDER_DOWN')
        // PRIVATE_* ileti kodu aynen doner (providerGuard hatalari)
        for (const kod of ['PRIVATE_MIN_AMOUNT', 'PRIVATE_MAX_AMOUNT', 'PRIVATE_RATE_LIMITED', 'PRIVATE_PROVIDER_DOWN', 'PRIVATE_CHAIN_CLOSED', 'PRIVATE_UNSUPPORTED']) {
            expect(privacyErrorCode(new Error(kod)), kod).toBe(kod)
        }
        // SDK sinir hatasi her seyden once gelir
        expect(privacyErrorCode(new AmountOutOfRangeError('amount_below_minimum', {}))).toBe('PRIVATE_MIN_AMOUNT')
    })
})

describe('limitUsdcOf: hata yanitina eklenen sinir (spec 4.2)', () => {
    it('providerGuard hatasi limitUsdc dizgesini kendisi tasir', () => {
        expect(limitUsdcOf(Object.assign(new Error('PRIVATE_MIN_AMOUNT'), { limitUsdc: '12' }))).toBe('12')
        expect(limitUsdcOf(Object.assign(new Error('PRIVATE_MAX_AMOUNT'), { limitUsdc: '20010' }))).toBe('20010')
    })

    it('SDK AmountOutOfRangeError ham tutarini insan birimine cevirir (18 ve 6 ondalik, kesirli)', () => {
        const en = (code, body) => limitUsdcOf(new AmountOutOfRangeError(code, body))
        expect(en('amount_below_minimum', { minPayoutAmount: '12000000000000000000', usdcDecimals: 18 })).toBe('12')
        expect(en('amount_below_minimum', { minPayoutAmount: '12000000', usdcDecimals: 6 })).toBe('12')
        expect(en('amount_below_minimum', { minPayoutAmount: '12500000000000000000', usdcDecimals: 18 })).toBe('12.5')
        expect(en('amount_above_maximum', { maxPayoutAmount: '20010000000000000000000', usdcDecimals: 18 })).toBe('20010')
        expect(en('amount_above_maximum', { maxPayoutAmount: '100', usdcDecimals: 0 })).toBe('100')
    })

    it('okunamazsa null: sinir yok, sifir, bozuk ya da baska hata', () => {
        const en = (code, body) => limitUsdcOf(new AmountOutOfRangeError(code, body))
        expect(en('amount_below_minimum', {})).toBeNull()
        expect(en('amount_below_minimum', { minPayoutAmount: '0', usdcDecimals: 18 })).toBeNull()
        expect(en('amount_below_minimum', { minPayoutAmount: 'abc', usdcDecimals: 18 })).toBeNull()
        for (const v of [undefined, null, new Error('x'), new HttpError(400, {}), 'x', {}, Object.assign(new Error('x'), { limitUsdc: '' })]) {
            expect(limitUsdcOf(v), String(v)).toBeNull()
        }
    })
})

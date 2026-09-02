import { describe, it, expect, beforeEach, vi } from 'vitest'

// Adres artik atsConfig'ten geliyor (bkz. tonFeeConfig.tonFeePaymasterBase).
// Buradaki sahte deger URL'in SEKLINI (yol + sorgu) olcmek icin; gercek
// host tonFeeConfig.test.js'te olculen degere kilitli.
vi.mock('./tonFeeConfig', async (importActual) => ({
    ...(await importActual()),
    tonFeePaymasterBase: () => 'http://bundler.test',
}))

import { tonFeeQuote, tonFeeRelay, TonFeeError } from './tonFeeClient'
import GOLDEN from './__fixtures__/tonQuote.golden.json'

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
}

async function captureError(promise) {
    try { await promise; return null } catch (e) { return e }
}

beforeEach(() => {
    globalThis.fetch = vi.fn()
})

describe('tonFeeQuote / tonFeeRelay', () => {
    it('taban URL configStore.bundlerBase ten gelir', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(200, GOLDEN))
        await tonFeeQuote({ tonWallet: 'EQ...', tonPublicKey: '0x..', payer: '0x..', actions: [] })
        expect(fetch.mock.calls[0][0]).toMatch(/^http:\/\/bundler\.test\//)
    })

    it('quote yolu /paymaster/ton/quote', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(200, GOLDEN))
        await tonFeeQuote({ tonWallet: 'EQ...', tonPublicKey: '0x..', payer: '0x..', actions: [] })
        expect(fetch.mock.calls[0][0]).toBe('http://bundler.test/paymaster/ton/quote')
    })

    it('relay yolu /paymaster/ton/relay', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }))
        await tonFeeRelay({ quoteId: GOLDEN.quoteId, signature: 'sig', feeAuthSignature: 'fa' })
        expect(fetch.mock.calls[0][0]).toBe('http://bundler.test/paymaster/ton/relay')
    })

    // tonFeeQuote govdeyi AYNEN gondermeli - Task 2'nin dogrulama kapisi
    // sunucudan donen degerleri karsilastiriyor, istekteki alan adi da
    // sabit kalmali ki olculen sozlesmeyle uyussun.
    it('quote govdesi degistirilmeden POST edilir', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(200, GOLDEN))
        const body = { tonWallet: 'EQ...', tonPublicKey: '0x..', payer: '0x..', actions: [{ kind: 'ton', to: 'EQ...', amountNano: '1' }] }
        await tonFeeQuote(body)
        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body)
    })

    // RELAY GOVDESI TAM UC ALAN - `receipt` ve arkadaslari GITMEZ.
    //
    // Bu dosyada bir yorum, kodun YAPMADIGI bir seyi soyluyordu: kurtarmanin
    // ikinci denemesi "makbuzlu tekrar" diye anlatiliyor ama gonderilen govde
    // ilkiyle BIREBIR ayniydi. Fark hicbir yerde gorunmuyordu cunku tonFeeRelay
    // parametreyi YIKIYOR - cagiranin verdigi fazla alan sessizce dusuyor.
    //
    // Alan EKLEMEK de tehlikeli, silmek kadar: /relay govdesinin `quoteId`
    // disindaki adlari HENUZ OLCULMEDI (tasarim 10 R1) ve sunucu tanimadigi bir
    // alanda istegin TAMAMINI reddediyor - uydurulmus bir ad, ucreti zaten alinmis
    // bir kaydin son tekrar hakkini yakardi. Bu yuzden iddia ESLENMIS: uc alanin
    // VARLIGI ve fazlasinin YOKLUGU tek `toEqual` ile birlikte olculur.
    it('relay govdesi TAM { quoteId, signature, feeSignature } - fazlasi GITMEZ', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }))
        await tonFeeRelay({
            quoteId: 'q-1', signature: '0xsig', feeAuthSignature: '0xfa',
            // Cagiran bunlari verse bile istege GIRMEMELI.
            receipt: { opaque: 'makbuz' }, settlementId: 's-1',
        })
        expect(JSON.parse(fetch.mock.calls[0][1].body))
            .toEqual({ quoteId: 'q-1', signature: '0xsig', feeSignature: '0xfa' })
    })

    // OLCULDU 2026-09-01 (canli): sunucu ucret yetkisi imzasini `feeSignature`
    // adiyla okuyor. Onceki ad (`feeAuthSignature`) VARSAYIMDI ve sunucu onu hic
    // gormedigi icin "imza 65 ya da 64 bayt olmali" diye SAHTE bir uzunluk hatasi
    // veriyordu -- ikinci turda backend mesaji netlestirdi:
    //   {"code":"ton-fee-auth-signature-missing",
    //    "error":"`feeSignature` alani eksik -- imza govdede bu adla gonderilmeli"}
    //
    // IC AD DEGISMEDI: `feeAuthSignature` hem cagiranlarin (tonFeeRelayer,
    // tonFeeRecovery) hem DISKTEKI makbuzun alan adi. Ic adi da degistirmek,
    // kayitli makbuzlari okunamaz kilip odenmis bir ucretin kurtarma yolunu
    // koparirdi. Bu yuzden cevrim YALNIZ tel uzerinde, TEK yerde yapilir.
    it('tel uzerindeki ad `feeSignature`; ESKI ad govdeye SIZMAZ', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }))
        await tonFeeRelay({ quoteId: 'q-2', signature: '0xs', feeAuthSignature: '0xf' })
        const body = JSON.parse(fetch.mock.calls[0][1].body)
        expect(body.feeSignature, 'yeni ad govdede yok').toBe('0xf')
        expect(body).not.toHaveProperty('feeAuthSignature')
    })

    // Deger DOKUNULMADAN gecer: `0x` oneki KORUNUR. Onek soymak bu turda bir
    // TAHMINDI ve olcum onu curuttu -- sunucu alani hic okumamisti, yani hex
    // isleyisi hakkinda hicbir sey kanitlanmadi. ethers'in urettigi standart
    // bicimi degistirmek icin bir sebep yok.
    it('imza degerleri DOKUNULMADAN gecer (0x oneki korunur)', async () => {
        const fa = '0x' + 'ab'.repeat(65)
        const sg = '0x' + 'cd'.repeat(64)
        fetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }))
        await tonFeeRelay({ quoteId: 'q-3', signature: sg, feeAuthSignature: fa })
        const body = JSON.parse(fetch.mock.calls[0][1].body)
        expect(body.feeSignature).toBe(fa)
        expect(body.signature).toBe(sg)
    })

    it('basarili quote govdeyi OLDUGU GIBI doner', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(200, GOLDEN))
        const result = await tonFeeQuote({ tonWallet: 'EQ...', tonPublicKey: '0x..', payer: '0x..', actions: [] })
        expect(result).toEqual(GOLDEN)
    })

    it.each([[400], [502], [503]])('%s -> TonFeeError', async (status) => {
        fetch.mockResolvedValueOnce(jsonResponse(status, { error: 'boom', code: 'ton-tank-low' }))
        const err = await captureError(tonFeeQuote({}))
        expect(err).toBeInstanceOf(TonFeeError)
        expect(err.httpStatus).toBe(status)
        expect(err.code).toBe('ton-tank-low')
    })

    it('phase quote yolunda "quote", relay yolunda "relay"', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(400, { error: 'x' }))
        const errQuote = await captureError(tonFeeQuote({}))
        expect(errQuote.phase).toBe('quote')

        fetch.mockResolvedValueOnce(jsonResponse(400, { error: 'x' }))
        const errRelay = await captureError(tonFeeRelay({ quoteId: 'q-1' }))
        expect(errRelay.phase).toBe('relay')
    })

    it('kodsuz hata govdesinde .code null olur, FIRLATMAYA devam eder', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(400, { error: 'boom' }))
        const err = await captureError(tonFeeQuote({}))
        expect(err).toBeInstanceOf(TonFeeError)
        expect(err.code).toBe(null)
    })

    // BU TEK SATIR ucretin kurtarilabilirligini belirler. 502 govdesindeki makbuz
    // TonFeeError'a tasinmazsa, "odendi ama gitmedi" durumunda elimizde makbuz
    // KALMAZ ve kullanicinin ucreti kalici olarak yanar (design bolum 6).
    it('502 govdesindeki receipt ve settlementId TonFeeError a TASINIR', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(502, {
            error: 'x', code: 'ton-collect-failed', receipt: 'r-1', settlementId: 's-1',
        }))
        const err = await captureError(tonFeeRelay({ quoteId: 'q-1' }))
        expect(err.receipt).toBe('r-1')
        expect(err.settlementId).toBe('s-1')
    })

    it('400 ton-fee-already-settled govdesindeki settlementId de TASINIR', async () => {
        fetch.mockResolvedValueOnce(jsonResponse(400, {
            error: 'x', code: 'ton-fee-already-settled', settlementId: 's-2',
        }))
        const err = await captureError(tonFeeRelay({ quoteId: 'q-1' }))
        expect(err.code).toBe('ton-fee-already-settled')
        expect(err.settlementId).toBe('s-2')
    })

    it('ag hatasi TonFeeError a sarilir, ham TypeError sizmaz', async () => {
        fetch.mockRejectedValueOnce(new TypeError('failed to fetch'))
        const err = await captureError(tonFeeQuote({}))
        expect(err).toBeInstanceOf(TonFeeError)
        expect(err).not.toBeInstanceOf(TypeError)
        expect(err.phase).toBe('quote')
    })
})

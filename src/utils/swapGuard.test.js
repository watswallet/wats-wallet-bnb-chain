// Gonderim engelinin SEBEBI. Kararlar bugunku isValid() ile ayni; degisen tek sey
// sebebin ADLANDIRILMASI — buton metni artik dogru olani yazabiliyor.
import { describe, it, expect } from 'vitest'
import { swapBlockReason } from './swapGuard'

const valid = {
    chainSupported: true,
    inToken: { address: '0x0' },
    outToken: { address: '0xabc' },
    amount: '1',
    balanceLoading: false,
    insufficientBalance: false,
    loading: false,
    swapLoading: false,
    payWithAts: false,
    atsLoading: false,
    atsReady: false,
    atsCapExceeded: false,
    insufficientGas: false,
    gasToken: null,
    selectedInsufficient: false,
}
const s = (over) => swapBlockReason({ ...valid, ...over })

describe('swapBlockReason', () => {
    // T13 — ATS YALANI KILIDI. Polygon bir ATS zinciri (atsConfig.js:144) ama
    // refreshAtsOpFee `if (!crypto.swap.inToken) return` ile hic calismiyor:
    // atsReady false'ta cakiliyor ve buton KALICI olarak "ATS ile gonderilemiyor"
    // yaziyor. Oysa gercek sebep token secili olmamasi.
    it('token yokken ATS dali DEGIL, select-in-token doner', () => {
        expect(s({ inToken: null, payWithAts: true, atsReady: false, atsLoading: false }))
            .toBe('select-in-token')
    })

    // T14 — her sebep kodu icin bir ornek + tam gecerli durum.
    it('tam gecerli durumda null doner (gonderime izin)', () => {
        expect(s({})).toBeNull()
    })

    it('her bloklama sebebi kendi kodunu doner', () => {
        expect(s({ chainSupported: false })).toBe('unsupported-chain')
        expect(s({ inToken: null })).toBe('select-in-token')
        expect(s({ outToken: null })).toBe('select-out-token')
        expect(s({ amount: '' })).toBe('enter-amount')
        expect(s({ amount: 0 })).toBe('enter-amount')
        expect(s({ amount: '-1' })).toBe('enter-amount')
        expect(s({ balanceLoading: true })).toBe('balance-loading')
        expect(s({ insufficientBalance: true })).toBe('insufficient-balance')
        expect(s({ loading: true })).toBe('quote-loading')
        expect(s({ swapLoading: true })).toBe('quote-loading')
        expect(s({ payWithAts: true, atsCapExceeded: true })).toBe('ats-cap')
        expect(s({ payWithAts: true, atsLoading: true })).toBe('ats-loading')
        expect(s({ payWithAts: true, atsReady: false })).toBe('ats-not-ready')
        expect(s({ insufficientGas: true, gasToken: null })).toBe('insufficient-gas')
        expect(s({ selectedInsufficient: true })).toBe('fee-token-insufficient')
    })

    it('ATS hazirsa null doner', () => {
        expect(s({ payWithAts: true, atsReady: true })).toBeNull()
    })

    // T15 — desteklenmeyen zincir her seyi ezer.
    it('unsupported-chain token dolu olsa bile kazanir', () => {
        expect(s({ chainSupported: false, inToken: { address: '0x0' }, amount: '5' }))
            .toBe('unsupported-chain')
    })

    // T16 — BUGUNKU BILINCLI KURAL: ATS kolunda ucret zaten ATS ile odenir, native
    // yetersizligi engel DEGILDIR. Bunu engele cevirmek ozelligi bozar.
    it('ATS kolunda native gaz yetersizligi ENGEL DEGILDIR', () => {
        expect(s({ payWithAts: true, atsReady: true, insufficientGas: true, gasToken: null })).toBeNull()
        expect(s({ payWithAts: true, atsReady: true, selectedInsufficient: true })).toBeNull()
    })

    // Gasless: ucret bir token ile odenebiliyorsa native yetersizligi engel degil.
    it('gas token secilmisse insufficientGas engellemez', () => {
        expect(s({ insufficientGas: true, gasToken: { address: '0xfee' } })).toBeNull()
    })

    // Sira BAGLAYICIDIR: bakiye bilinmeden gonderime izin verilmez ve bu, teklif
    // yuklenmesinden ONCE gelir.
    it('sira: bakiye yuklenirken teklif yuklemesi sebep OLARAK gorunmez', () => {
        expect(s({ balanceLoading: true, swapLoading: true })).toBe('balance-loading')
    })
})

// 2026-09-01: ConfirmTransaction'da olculen bosluk Swap'ta da vardi - TON relay
// kolunda bloklayici bir ucret karari (kurulum gerekli, ATS gerekli, /status
// okunamadi) KART cizdiriyor ama Takas butonunu ACIK birakiyordu. Gonderim o
// durumda sessizce self-pay'e duser ve gasless soylenmisken kullanicinin KENDI
// TON'u yanar. EVM kolunda karsiligi ZATEN vardi: `ats-not-ready`.
describe('TON: bloklayici ucret karari Takas butonunu KILITLER', () => {
    const ok = { chainSupported: true, inToken: { address: '0x0' }, outToken: { address: '0x1' }, amount: '5' }

    it('tonFeeBlocked true -> ton-fee-blocked', () => {
        expect(s({ ...ok, tonFeeBlocked: true })).toBe('ton-fee-blocked')
    })

    it('tonFeeBlocked false/verilmemis -> engel YOK (gerileme korumasi)', () => {
        expect(s({ ...ok, tonFeeBlocked: false })).toBeNull()
        expect(s({ ...ok })).toBeNull()
    })

    it('bakiye ve teklif yuklemesi ONCE gelir - sebep sirasi bozulmadi', () => {
        expect(s({ ...ok, balanceLoading: true, tonFeeBlocked: true })).toBe('balance-loading')
        expect(s({ ...ok, swapLoading: true, tonFeeBlocked: true })).toBe('quote-loading')
    })

    it('ATS kolunda TON kapisi devreye GIRMEZ (iki kol ayni anda olamaz)', () => {
        // payWithAts dali kendi `return null`u ile biter; TON bayragi oraya
        // sizarsa EVM/ATS swap'lari sebepsiz kilitlenirdi.
        expect(s({ ...ok, payWithAts: true, atsReady: true, tonFeeBlocked: true })).toBeNull()
    })
})

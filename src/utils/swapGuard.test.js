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
    // TEKLIF VAR: `hasQuote` KAPALI KAPI (varsayilani "engelli"), o yuzden
    // "gecerli durum" fixture'inin onu ACIKCA tasimasi gerekiyor.
    hasQuote: true,
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

// ---------------------------------------------------------------------------
// TEKLIF ALINAMAMISKEN BUTON AKTIFLESIYORDU (2026-09-15, kullanici ekran goruntusu)
//
// Ekranda "Teklif alinamadi" karti duruyor, cikti "0.00" yaziyor ve Takas dugmesi
// PARLIYOR. Basilinca ne oluyor, iki kolda da olculdu:
//   - TON: `message.tonQuote` UNDEFINED gider; prepareTonSwap KAPI 1'de
//     TON_SWAP_QUOTE_STALE ile duser. Zincir korunuyor ama ekran gonderimden
//     hemen sonra Ana Sayfa'ya atliyor ve kullanici "bayat teklif" diye YANLIS
//     bir sebep goruyor -- gercek sebep teklifin HIC alinamamis olmasi.
//   - EVM: DURDURULMUYOR. background/swap() teklifi mesajdan almiyor,
//     MultiChainSwapManager kendi teklifini cekip takasi GERCEKTEN yapiyor --
//     yani kullanici ekranda HICBIR fiyat gormemisken parasi el degistiriyor.
//     Kapinin asil gerekcesi bu: onay, gorulmus bir fiyata verilir.
//
// BRIDGE'DE BU KAPI ZATEN VAR (Bridge.vue isValid: `|| !bridgeData.value`).
// Swap'ta hic olmadi -- ilk commit'teki (dbd1578) isValid da teklife bakmiyordu,
// yani bu, swapGuard refaktorunun getirdigi bir gerileme DEGIL, bastan acik
// kalmis bir delik.
//
// KAPI KAPALI VARSAYILANLIDIR: alan hic verilmezse de engeller. "Dogrulayamadigini
// gecirme" -- teklifi tasimayi unutan yeni bir cagiran, sessizce fiyatsiz gonderim
// yapan bir cagirandir.
// ---------------------------------------------------------------------------
describe('teklif YOKKEN Takas dugmesi KILITLI', () => {
    it('teklif yok -> no-quote', () => {
        expect(s({ hasQuote: false })).toBe('no-quote')
    })

    it('alan HIC verilmemisse de engeller (kapali varsayilan)', () => {
        expect(swapBlockReason({ ...valid, hasQuote: undefined })).toBe('no-quote')
    })

    // ESLENMIS IDDIA: kapi her durumda engelleyen bir sabite donusurse ozellik
    // tumden oldu demektir. Bu satir olmadan "return 'no-quote'" mutasyonu gecerdi.
    it('teklif VARKEN engel YOK', () => {
        expect(s({ hasQuote: true })).toBeNull()
    })

    // SIRA BAGLAYICI: teklif HENUZ YOLDAYKEN sebep "teklif yok" degil, "yukleniyor".
    // Ikisi ayni ekran durumunda birlesiyor (swapData null + swapLoading true) ve
    // yanlis sirada "teklif yok" demek, gelmekte olan teklifi OLMAYAN gibi gosterir.
    it('yuklenme ve bakiye sebepleri ONCE gelir', () => {
        expect(s({ hasQuote: false, swapLoading: true })).toBe('quote-loading')
        expect(s({ hasQuote: false, loading: true })).toBe('quote-loading')
        expect(s({ hasQuote: false, balanceLoading: true })).toBe('balance-loading')
        expect(s({ hasQuote: false, insufficientBalance: true })).toBe('insufficient-balance')
    })

    // KAPI ATS DALINDAN **ONCE** OLMALI: o dal kendi `return null`u ile bitiyor,
    // sonrasina konsaydi ATS ile odeyen kullanicida delik ACIK kalirdi -- ve
    // EVM/ATS tam olarak takasin sessizce GERCEKLESTIGI kol.
    it('ATS kolu kapiyi ATLAMAZ', () => {
        expect(s({ hasQuote: false, payWithAts: true, atsReady: true })).toBe('no-quote')
    })

    // TON kolu da atlamaz: role ucreti zaten TEKLIFTEN tureyen bir eyleme dayaniyor,
    // teklif yokken role eylemi de yok. IKISI BIRDEN dogruyken sebep 'no-quote':
    // `ton-fee-blocked` bu kapinin ARDINDAN geliyor ve daha ozel olan sebep, daha
    // temel olani gizleyemez.
    //
    // Bu testin ilk hali `tonFeeBlocked: false` gecirip 'no-quote' bekliyordu --
    // yani ustteki testin BIREBIR kopyasiydi ve HICBIR sira olcmuyordu. Karsi
    // gorusli incelemede yakalandi.
    it('TON kolu kapiyi ATLAMAZ (ve sirada ONDE gelir)', () => {
        expect(s({ hasQuote: false, tonFeeBlocked: true })).toBe('no-quote')
        // ESLENMIS IDDIA: TON kapisi ISLEVINI KAYBETMIS olmasin.
        expect(s({ hasQuote: true, tonFeeBlocked: true })).toBe('ton-fee-blocked')
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

// 2026-09-15 DUZELTMESININ GERILEME KORUMASI. TON role kolunda gaz yeterlilik
// hesabi artik rolenin odedigi gazi SAYMIYOR, yani `insufficientGas` orada false
// uretiliyor. Bu saf katman degismedi ve DEGISMEMELI; asagidaki iddialar "kart
// gizlenirken buton yanlislikla acildi/kilitlendi" gerilemesini yakalar.
describe('TON role kolu: insufficientGas dususu butonu YANLIS yonetmez', () => {
    const ok = { chainSupported: true, inToken: { address: '0x0' }, outToken: { address: '0x1' }, amount: '5' }

    it('gaz engeli kalkinca bloklayici ucret karari HALA kilitler', () => {
        // Sira baglayici: `ton-fee-blocked` gaz kapisindan ONCE gelir. Eksik ATS
        // durumunda kullanicinin gordugu sebep bu olmali, "yetersiz gaz" degil.
        expect(s({ ...ok, insufficientGas: false, tonFeeBlocked: true })).toBe('ton-fee-blocked')
    })

    it('SATILAN native TON yetmiyorsa engel KALIR (role miktari sponsorlamaz)', () => {
        expect(s({ ...ok, insufficientGas: false, insufficientBalance: true })).toBe('insufficient-balance')
    })

    it('role saglikliyken ve her sey temizken buton ACILIR', () => {
        expect(s({ ...ok, insufficientGas: false, tonFeeBlocked: false })).toBeNull()
    })

    it('ESLENMIS: role kolu cozulmemisken (self-pay) eski davranis AYNEN durur', () => {
        // `atsMaxFee` null -> gonderim self-pay'e duser -> gazi KULLANICI oder ->
        // `insufficientGas` yine true uretilir ve buton kilitli kalir.
        expect(s({ ...ok, insufficientGas: true, gasToken: null })).toBe('insufficient-gas')
    })
})


// A3 (2026-09-15): KARTIN KAPISI ILE BUTONUN KAPISI AYNI SORUYU SORMALI.
//
// Ekrandaki "Yetersiz Bakiye (Gas)" karti role kolunu `!swapRelayPaysGas` ile
// disliyordu; bu saf katman ise ayni bayragi HIC gormuyordu. Sonuc: kart gizlenirken
// buton kilitli kaliyor ve kullanici ekranda HICBIR aciklama olmadan olu bir dugmeyle
// kaliyordu - kullanicinin bildirdigi durumun ta kendisi.
describe('relayPaysGas: gazi roleci odiyorsa native yetersizlik ENGEL DEGIL', () => {
    const ok = { chainSupported: true, hasQuote: true, inToken: { address: '0x0' }, outToken: { address: '0x1' }, amount: '5' }

    it('role odiyorken insufficientGas butonu KILITLEMEZ', () => {
        expect(s({ ...ok, insufficientGas: true, relayPaysGas: true })).toBeNull()
    })

    it('ESLENMIS: role odemiyorken AYNEN eski davranis (kilit)', () => {
        expect(s({ ...ok, insufficientGas: true, relayPaysGas: false })).toBe('insufficient-gas')
    })

    it('KAPALI VARSAYILAN: alan hic verilmezse davranis DEGISMEZ', () => {
        // EVM cagiranlari bu alani tasimiyor; onlar icin kapi aynen kapali kalmali.
        expect(s({ ...ok, insufficientGas: true })).toBe('insufficient-gas')
    })

    it('SATILAN native TON yetersizligi role acikken de ENGEL (ayri kapi)', () => {
        // `amountNano` HICBIR ZAMAN sponsorlanmaz: o yetersizlik gaz kapisinda degil,
        // ondan ONCE gelen `insufficient-balance`ta engellenir ve relayPaysGas onu
        // ETKILEMEZ. Gevsetilirse kullanici gonderir, islem zincirde duser.
        expect(s({ ...ok, insufficientBalance: true, relayPaysGas: true })).toBe('insufficient-balance')
    })

    it('bloklayici ucret karari role acikken de KILITLER (sira korunur)', () => {
        expect(s({ ...ok, insufficientGas: true, relayPaysGas: true, tonFeeBlocked: true })).toBe('ton-fee-blocked')
    })
})

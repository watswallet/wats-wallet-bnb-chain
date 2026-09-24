import { describe, it, expect } from 'vitest'
import { atsRequiredFromBudget, atsShortfallAmount } from './atsShortfall'

// Canli olcum 2026-09-01 (bundler.watswallet.com, chainId=56):
//   budget.minChargeAts  = 19054878048780488167  (~19.0549 ATS)
//   budget.commissionAts =  9527439024390244083  (~9.5274 ATS)
//
// Bu iki alan BIR ARADA toplanip 28.58 olarak gosteriliyordu. ARTIK TOPLANMIYOR;
// gerekcesi asagida, "komisyon EKLENMEZ" testinin basinda.
const LIVE_BUDGET = {
    minChargeAts: '19054878048780488167',
    commissionAts: '9527439024390244083',
}

describe('atsRequiredFromBudget - /status budget -> gereken ATS (insan birimi)', () => {
    // KOK NEDEN (2026-09-16): bu fonksiyon ekranda 28.58 yaziyordu, oysa TON'da
    // gereken tutar minChargeAts'in KENDISI (19.05).
    //
    // Komisyon terimi bir OLCUME degil bir CIKARIMA dayaniyordu: 20 ATS'si olan
    // hesap src-balance-missing aldi, "demek ki esik minCharge + komisyon" diye
    // yorumlandi. Iki sebeple yanlis:
    //
    //   1. O olcum chainId=56 (BSC) uzerinde yapildi. Ama bu fonksiyon YALNIZCA
    //      TON kolunda cagriliyor (ConfirmTransaction.vue ve Swap.vue'de
    //      `isTonNetwork ? atsRequiredFromBudget(...) : ...`). EVM kolunun kendi
    //      kaynaklari var (requiredAts / totalAtsCost). Yani EVM'de gozlenen bir
    //      davranistan cikarilan terim, YALNIZ TON'da calisan bir fonksiyona kondu.
    //
    //   2. `budget.commissionAts` sozlesmede "Batch'i KURMAK icin gereken komisyon
    //      TAHMINI" diye tanimli (sdk/gasless.ts). O batch bir EVM op'unun
    //      callData'sidir; TON akisi o batch'i HIC kurmaz -- ucret tonFeeRelayer
    //      uzerinden imzalanan `feeAuth.atsMaxFee` ile alinir. TON kullanicisinin
    //      elinde tutmasi gereken tutarin parcasi DEGILDIR.
    it('komisyon EKLENMEZ: yalniz minChargeAts doner', () => {
        expect(atsRequiredFromBudget(LIVE_BUDGET)).toBe('19.054878048780488167')
    })

    it('komisyon alani YOKKEN de ayni sonuc', () => {
        expect(atsRequiredFromBudget({ minChargeAts: '19054878048780488167' }))
            .toBe('19.054878048780488167')
    })

    it('commissionAts ne olursa olsun sonucu DEGISTIRMEZ', () => {
        const min = '1000000000000000000'
        for (const c of ['0', '5', '9527439024390244083', undefined]) {
            expect(atsRequiredFromBudget({ minChargeAts: min, commissionAts: c }), String(c)).toBe('1')
        }
    })

    it('budget yok / minChargeAts yok -> null', () => {
        for (const b of [null, undefined, {}, { commissionAts: '5' }]) {
            expect(atsRequiredFromBudget(b), JSON.stringify(b)).toBeNull()
        }
    })

    it('cozulemeyen minChargeAts FIRLATMAZ, null doner', () => {
        // Bu bir GOSTERIM yolu: bozuk bir alan yuzunden onay ekrani cokmemeli.
        // null cagirana "ozel karti cizme, mevcut uyariya dus" der.
        expect(atsRequiredFromBudget({ minChargeAts: 'abc' })).toBeNull()
        expect(atsRequiredFromBudget({ minChargeAts: '1e18' })).toBeNull()
    })

    // Artik okunmayan bir alanin BOZUK olmasi karti dusurmemeli: eskiden
    // commissionAts cozulemeyince TUM sonuc null donuyordu ve kullanici gereken
    // tutari HIC goremiyordu -- sayiyla ilgisi olmayan bir alan yuzunden.
    it('bozuk commissionAts sonucu DUSURMEZ (o alan artik okunmuyor)', () => {
        expect(atsRequiredFromBudget({ minChargeAts: '1000000000000000000', commissionAts: 'xyz' })).toBe('1')
        expect(atsRequiredFromBudget({ minChargeAts: '1000000000000000000', commissionAts: '-5' })).toBe('1')
    })

    it('negatif minChargeAts -> null (sunucu bozuk; sayi uydurma)', () => {
        expect(atsRequiredFromBudget({ minChargeAts: '-5' })).toBeNull()
    })
})

describe('atsShortfallAmount - kullanicinin YUKLEMESI gereken ATS', () => {
    // Ayni canli budget: gereken artik 19.05 (komisyon EKLENMIYOR), bakiye 20 ->
    // eksik YOK, yani kart CIZILMEZ. Eski hal burada 8.58 eksik gosteriyordu.
    it('canli budget: gereken 19.05, bakiye 20 -> eksik YOK', () => {
        const required = atsRequiredFromBudget(LIVE_BUDGET)
        expect(required).toBe('19.054878048780488167')
        expect(atsShortfallAmount({ required, balance: '20' })).toBeNull()
    })

    it('canli budget: bakiye 15 -> ~4.05 eksik', () => {
        const required = atsRequiredFromBudget(LIVE_BUDGET)
        expect(atsShortfallAmount({ required, balance: '15' })).toBeCloseTo(4.0548780488, 8)
    })

    it('bakiye gerekeni KARSILIYORSA null (kart cizilmez)', () => {
        // Esitlik de yeter: "0 ATS daha gerekli" diyen bir kart bilgi tasimaz.
        expect(atsShortfallAmount({ required: 10, balance: 10 })).toBeNull()
        expect(atsShortfallAmount({ required: 10, balance: 12 })).toBeNull()
    })

    it('bakiye YOKKEN gerekenin TAMAMI eksiktir', () => {
        expect(atsShortfallAmount({ required: 10, balance: 0 })).toBe(10)
        // `balance: null` "okunamadi" demektir, "sifir" DEGIL - null doner.
        expect(atsShortfallAmount({ required: 10, balance: null })).toBeNull()
    })

    it('gereken bilinmiyorsa null - varsayilana DUSMEZ', () => {
        expect(atsShortfallAmount({ required: null, balance: 5 })).toBeNull()
        expect(atsShortfallAmount({ required: undefined, balance: 5 })).toBeNull()
        expect(atsShortfallAmount({})).toBeNull()
    })

    it('sayi olmayan girdi -> null', () => {
        expect(atsShortfallAmount({ required: 'abc', balance: 5 })).toBeNull()
        expect(atsShortfallAmount({ required: 10, balance: 'abc' })).toBeNull()
        expect(atsShortfallAmount({ required: Infinity, balance: 5 })).toBeNull()
    })
})

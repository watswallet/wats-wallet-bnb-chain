import { describe, it, expect } from 'vitest'
import { atsRequiredFromBudget, atsShortfallAmount } from './atsShortfall'

// Canli olcum 2026-09-01 (bundler.watswallet.com, chainId=56):
//   budget.minChargeAts  = 19054878048780488167  (~19.0549 ATS)
//   budget.commissionAts =  9527439024390244083  (~9.5274 ATS)
// Ayni anda zincirde okunan gercek bakiye 20 ATS idi ve sunucu yine de
// src-balance-missing dedi -> yani esik minCharge TEK BASINA degil, komisyonla
// BIRLIKTE. 19.05 + 9.53 = 28.58 > 20 bu gozlemle ortusuyor.
const LIVE_BUDGET = {
    minChargeAts: '19054878048780488167',
    commissionAts: '9527439024390244083',
}

describe('atsRequiredFromBudget - /status budget -> gereken ATS (insan birimi)', () => {
    it('minChargeAts + commissionAts toplanir', () => {
        // 19054878048780488167 + 9527439024390244083 = 28582317073170732250
        expect(atsRequiredFromBudget(LIVE_BUDGET)).toBe('28.58231707317073225')
    })

    it('komisyon KAPALIYKEN (alan yok) yalniz minChargeAts', () => {
        // Komisyon backend'de kapali olabilir (atsCommission.js notu): alanin
        // YOKLUGU 0 demektir, hata degil.
        expect(atsRequiredFromBudget({ minChargeAts: '19054878048780488167' }))
            .toBe('19.054878048780488167')
    })

    it('commissionAts "0" iken minChargeAts ile ayni', () => {
        expect(atsRequiredFromBudget({ minChargeAts: '1000000000000000000', commissionAts: '0' }))
            .toBe('1')
    })

    it('budget yok / minChargeAts yok -> null', () => {
        for (const b of [null, undefined, {}, { commissionAts: '5' }]) {
            expect(atsRequiredFromBudget(b), JSON.stringify(b)).toBeNull()
        }
    })

    it('cozulemeyen deger FIRLATMAZ, null doner', () => {
        // Bu bir GOSTERIM yolu: bozuk bir alan yuzunden onay ekrani cokmemeli.
        // null cagirana "ozel karti cizme, mevcut uyariya dus" der.
        expect(atsRequiredFromBudget({ minChargeAts: 'abc' })).toBeNull()
        expect(atsRequiredFromBudget({ minChargeAts: '1e18' })).toBeNull()
        expect(atsRequiredFromBudget({ minChargeAts: '1000', commissionAts: 'xyz' })).toBeNull()
    })

    it('negatif deger -> null (sunucu bozuk; sayi uydurma)', () => {
        expect(atsRequiredFromBudget({ minChargeAts: '-5' })).toBeNull()
    })
})

describe('atsShortfallAmount - kullanicinin YUKLEMESI gereken ATS', () => {
    it('canli vaka: gereken 28.58, bakiye 20 -> ~8.58 eksik', () => {
        const required = atsRequiredFromBudget(LIVE_BUDGET)
        expect(atsShortfallAmount({ required, balance: '20' })).toBeCloseTo(8.5823170731, 8)
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

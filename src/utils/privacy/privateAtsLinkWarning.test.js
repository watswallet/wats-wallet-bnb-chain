import { describe, it, expect } from 'vitest'
import { privateAtsLinkWarningVisible } from './privateAtsLinkWarning'

// ATS-once karti 2026-10-28'de kaldirildi; kartin kirmizi baglanti uyarisi Takas ve Kopru ekranlarindaki ATS ucret kartinin
// "ATS YETERSIZ / ATS AL" durumuna tasindi. Gorunurluk kosulunun TEK kopyasi bu saf islevdir (iki ekran da buradan okur).
describe('privateAtsLinkWarningVisible', () => {
    const tam = { privacyActive: true, payWithAts: true, shortfall: false, insufficient: false, buyAts: false }

    it('gizli mod + ATS kolu + (eksik-ATS bolumu | yetersiz blogu | buy-ats karari) icin gorunur', () => {
        expect(privateAtsLinkWarningVisible({ ...tam, shortfall: true })).toBe(true)
        expect(privateAtsLinkWarningVisible({ ...tam, insufficient: true })).toBe(true)
        expect(privateAtsLinkWarningVisible({ ...tam, buyAts: true })).toBe(true)
    })

    it('ATS yeterliyken (hicbir yetersizlik isareti yok) gorunmez', () => {
        expect(privateAtsLinkWarningVisible(tam)).toBe(false)
    })

    it('NORMAL modda hicbir durumda gorunmez', () => {
        for (const ek of [{ shortfall: true }, { insufficient: true }, { buyAts: true }]) {
            expect(privateAtsLinkWarningVisible({ ...tam, ...ek, privacyActive: false })).toBe(false)
        }
    })

    it('Para yukle: ucreti odeyen Gizli Hesap degil (privacyActive false) -> eksik-ATS isaretleri olsa da gorunmez', () => {
        const fund = { ...tam, privacyActive: false }
        expect(privateAtsLinkWarningVisible({ ...fund, shortfall: true })).toBe(false)
        expect(privateAtsLinkWarningVisible({ ...fund, shortfall: true, insufficient: true, buyAts: true })).toBe(false)
        // Gonder: ayni isaretler gorunur.
        expect(privateAtsLinkWarningVisible({ ...tam, shortfall: true })).toBe(true)
    })

    it('ATS kolu degilse (yerel gaz yolu ya da ATS satis rotasi) gorunmez', () => {
        expect(privateAtsLinkWarningVisible({ ...tam, insufficient: true, payWithAts: false })).toBe(false)
    })

    it('yalniz kesin true degerleri sayilir (truthy kacaklari yok)', () => {
        expect(privateAtsLinkWarningVisible({ ...tam, privacyActive: 1, insufficient: true })).toBe(false)
        expect(privateAtsLinkWarningVisible({ ...tam, payWithAts: 'yes', insufficient: true })).toBe(false)
        expect(privateAtsLinkWarningVisible({ ...tam, insufficient: 1 })).toBe(false)
        expect(privateAtsLinkWarningVisible({})).toBe(false)
        expect(privateAtsLinkWarningVisible()).toBe(false)
    })
})

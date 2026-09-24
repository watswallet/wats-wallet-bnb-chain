import { describe, it, expect } from 'vitest'
import { onboardingStartScreen, ONBOARDING_HASH_TARGETS } from './onboardingTarget'

describe('onboardingStartScreen -- izin verilen hedefler', () => {
    it('gizli ifade ekrani', () => {
        expect(onboardingStartScreen('#import_phrases')).toBe('import_phrases')
    })

    it('ozel anahtar ekrani', () => {
        expect(onboardingStartScreen('#import_private')).toBe('import_private')
    })

    it('# olmadan da okunur', () => {
        expect(onboardingStartScreen('import_private')).toBe('import_private')
    })

    it('buyuk/kucuk harf onemsiz', () => {
        expect(onboardingStartScreen('#IMPORT_PRIVATE')).toBe('import_private')
    })

    it('beyaz liste YALNIZCA bu iki ekran', () => {
        expect([...ONBOARDING_HASH_TARGETS].sort()).toEqual(['import_phrases', 'import_private'])
    })
})

// GUVENLIK KAPISI -- bu blogun dusmesi VERI KAYBI demektir.
//
// index.vue'nun kendi yorumu (FIRST_WALLET_ONLY): cuzdan VARKEN 'password'
// ekranina dusmek CreatePassword'u calistirir ve o `walletSalt`i KOSULSUZ ezer
// -- mevcut TUM kasalar kalici olarak acilamaz hale gelir. 'start' de oraya
// giden kapidir.
//
// Baslangic ekranini URL'den secilebilir yapmak, tam da o kapiyi adres
// cubugundan asilabilir hale getirme riskidir. Bu yuzden ikisi de beyaz listeye
// GIRMEZ ve bu testler o karari kilitler.
describe('onboardingStartScreen -- ilk-cuzdan ekranlari URL"den ACILAMAZ', () => {
    it('#password REDDEDILIR (walletSalt ezilmesi)', () => {
        expect(onboardingStartScreen('#password')).toBeNull()
    })

    it('#start REDDEDILIR', () => {
        expect(onboardingStartScreen('#start')).toBeNull()
    })

    it('akisin geri kalan ekranlari da REDDEDILIR', () => {
        for (const s of ['create_wallet', 'create_username', 'ready', 'import_wallet']) {
            expect(onboardingStartScreen('#' + s), s).toBeNull()
        }
    })
})

describe('onboardingStartScreen -- bozuk girdi', () => {
    it('bos/eksik girdi null', () => {
        for (const h of ['', '#', null, undefined, 0, {}, []]) {
            expect(onboardingStartScreen(h)).toBeNull()
        }
    })

    it('TAM eslesme sarttir -- ek tasiyan hash reddedilir', () => {
        for (const h of ['#import_private?x=1', '#import_private/password', '#import_privatex',
                         '#ximport_private', '#import_private#password', '#import_private password']) {
            expect(onboardingStartScreen(h), h).toBeNull()
        }
    })
})

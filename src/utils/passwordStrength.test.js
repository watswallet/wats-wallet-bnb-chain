import { describe, it, expect } from 'vitest'
import { passwordStrength, isPasswordStrongEnough, MIN_PASSWORD_SCORE } from './passwordStrength'

// Guc endeksi kurallari onboarding'de (CreatePassword / CreatePassword2) IKI KEZ
// kopyalanmisti ve sifre DEGISTIRME ekraninda hic yoktu: kullanici cuzdanini
// 'a' ile korunur hale getirebiliyordu. Kural artik tek yerde.

describe('passwordStrength', () => {
    it('bos deger 0', () => {
        expect(passwordStrength('')).toBe(0)
        expect(passwordStrength(null)).toBe(0)
        expect(passwordStrength(undefined)).toBe(0)
    })

    // Onboarding'deki mevcut kurallarla BIREBIR ayni olmali: bu util davranisi
    // degistirmek icin degil, tek kaynaga indirmek icin cikarildi.
    it('uzunluk > 7 bir puan', () => {
        expect(passwordStrength('abcdefg')).toBe(0)
        expect(passwordStrength('abcdefgh')).toBe(1)
    })

    it('buyuk harf VE rakam birlikte bir puan (yalniz biri yetmez)', () => {
        expect(passwordStrength('abcdefghA')).toBe(1)
        expect(passwordStrength('abcdefgh1')).toBe(1)
        expect(passwordStrength('abcdefghA1')).toBe(2)
    })

    it('alfanumerik olmayan karakter bir puan', () => {
        expect(passwordStrength('abcdefgh!')).toBe(2)
    })

    it('uzunluk > 12 ek bir puan', () => {
        expect(passwordStrength('abcdefghA1!xy')).toBe(4)
        expect(passwordStrength('abcdefghA1!x')).toBe(3)
    })

    it('en yuksek puan 4', () => {
        expect(passwordStrength('CokUzunVeGuclu1!@#')).toBe(4)
    })

    it('sayi olmayan girdi patlamaz', () => {
        expect(passwordStrength(12345678)).toBe(0)
        expect(passwordStrength({})).toBe(0)
    })
})

describe('isPasswordStrongEnough', () => {
    it('esik MIN_PASSWORD_SCORE', () => {
        expect(MIN_PASSWORD_SCORE).toBe(2)
    })

    it('esigin altinda reddeder', () => {
        expect(isPasswordStrongEnough('')).toBe(false)
        expect(isPasswordStrongEnough('a')).toBe(false)
        expect(isPasswordStrongEnough('abcdefgh')).toBe(false)
    })

    it('esikte ve uzerinde kabul eder', () => {
        expect(isPasswordStrongEnough('abcdefghA1')).toBe(true)
        expect(isPasswordStrongEnough('CokUzunVeGuclu1!@#')).toBe(true)
    })
})

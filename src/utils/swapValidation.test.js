import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { clampToDecimals, isInsufficientBalance, toDecimalString } from './swapValidation'

describe('toDecimalString', () => {
    it('#51: 1e-6 altindaki bakiye USTEL gosterime dusmez', () => {
        // String(5e-8) === '5e-8' ve ethers parseUnits bunu reddeder; MAX kucuk
        // bakiyelerde hem teklifi hem takasi sessizce cokertiyordu.
        expect(String(5e-8)).toBe('5e-8')
        expect(toDecimalString(5e-8)).toBe('0.00000005')
    })

    it('cikan metin parseUnits tarafindan kabul edilir', () => {
        expect(() => ethers.parseUnits(toDecimalString(5e-8), 18)).not.toThrow()
        expect(ethers.parseUnits(toDecimalString(5e-8), 18)).toBe(50000000000n)
    })

    it('normal degerlerde sondaki sifirlar kirpilir', () => {
        expect(toDecimalString(1.5)).toBe('1.5')
        expect(toDecimalString(12)).toBe('12')
    })

    it('sifir ve gecersiz girdide "0"', () => {
        expect(toDecimalString(0)).toBe('0')
        expect(toDecimalString(-1)).toBe('0')
        expect(toDecimalString(null)).toBe('0')
        expect(toDecimalString('abc')).toBe('0')
    })

    it('token decimal sayisina gore kirpilabilir', () => {
        expect(toDecimalString(1.23456789, 4)).toBe('1.2346')
    })
})

describe('isInsufficientBalance', () => {
    it('miktar bakiyeden buyukse yetersizdir', () => {
        expect(isInsufficientBalance(500, 10)).toBe(true)
    })

    it('miktar bakiyeye esitse yeterlidir', () => {
        expect(isInsufficientBalance(10, 10)).toBe(false)
    })

    it('miktar bakiyeden kucukse yeterlidir', () => {
        expect(isInsufficientBalance(5, 10)).toBe(false)
    })

    it('#11: token degistiginde karar YENI bakiyeye gore verilir', () => {
        // 1000 USDT varken 500 yaziliyor -> yeterli.
        expect(isInsufficientBalance('500', 1000)).toBe(false)
        // Odeme tokeni 10 TOKEN_B ile degistirildi -> ayni miktar artik YETERSIZ.
        // Eskiden karar elle atandigi icin "yeterli"de takili kaliyor ve zincirde
        // kesin revert edecek bir swap gonderilebiliyordu.
        expect(isInsufficientBalance('500', 10)).toBe(true)
    })

    it('metin olarak gelen miktar/bakiye sayiya cevrilir', () => {
        expect(isInsufficientBalance('12.5', '12.4')).toBe(true)
        expect(isInsufficientBalance('12.4', '12.5')).toBe(false)
    })

    it('miktar girilmemisse uyari gosterilmez', () => {
        expect(isInsufficientBalance(0, 10)).toBe(false)
        expect(isInsufficientBalance('', 10)).toBe(false)
        expect(isInsufficientBalance(null, 10)).toBe(false)
        expect(isInsufficientBalance(undefined, 10)).toBe(false)
    })

    it('negatif miktar uyari uretmez', () => {
        expect(isInsufficientBalance(-5, 10)).toBe(false)
    })

    it('bakiye BILINMIYORSA yetersiz sayilir (guvenli taraf)', () => {
        expect(isInsufficientBalance(1, undefined)).toBe(true)
        expect(isInsufficientBalance(1, null)).toBe(true)
        expect(isInsufficientBalance(1, 'abc')).toBe(true)
    })

    it('bakiye sifirsa her pozitif miktar yetersizdir', () => {
        expect(isInsufficientBalance(0.0001, 0)).toBe(true)
    })
})

describe('clampToDecimals', () => {
    // #? Buyuk bir bakiyede MAX, toDecimalString'in toFixed(18) ciktisini alanına
    // yaziyordu: float64'te tam temsil edilemeyen sayilarda bu, gercek hassasiyetin
    // otesindeki GURULTUYU gercek basamak olarak uretir. Kullanici elle fazla ondalik
    // yazdiginda da ayni sey olur. Sonuc: parseUnits NUMERIC_FAULT firlatiyor ve
    // "getExpectedOutput error: too many decimals" ile TUM teklif olmus oluyordu.
    it('token hassasiyetini asan ondalıkları keser', () => {
        expect(clampToDecimals('2148417.3159170001745224', 6)).toBe('2148417.315917')
        expect(clampToDecimals('1.1234567', 6)).toBe('1.123456')
    })

    it('YUVARLAMAZ, keser — MAX bakiyeyi asamaz', () => {
        // Yuvarlama .123457 verirdi ve MAX'ta bu bakiyeyi asip
        // "yetersiz bakiye" hatasina yol acardi.
        expect(clampToDecimals('0.1234569', 6)).toBe('0.123456')
        expect(clampToDecimals('9.9999999', 6)).toBe('9.999999')
    })

    it('hassasiyet zaten uygunsa metni degistirmez', () => {
        expect(clampToDecimals('2.5', 6)).toBe('2.5')
        expect(clampToDecimals('100', 6)).toBe('100')
    })

    it('kesme sonrasi sondaki sifirlar ve yalniz kalan nokta kirpilir', () => {
        expect(clampToDecimals('1.5000009', 6)).toBe('1.5')
        expect(clampToDecimals('3.0000001', 6)).toBe('3')
    })

    it('decimals 0 olan token tam sayiya duser', () => {
        expect(clampToDecimals('7.9', 0)).toBe('7')
    })

    it('token 18 haneliyse dokunmaz', () => {
        expect(clampToDecimals('2148417.315917383879423141', 18)).toBe('2148417.315917383879423141')
    })

    it('gecersiz girdide "0"', () => {
        expect(clampToDecimals('', 6)).toBe('0')
        expect(clampToDecimals(null, 6)).toBe('0')
        expect(clampToDecimals(undefined, 6)).toBe('0')
    })

    it('ustel gosterim reddedilmez — once ondalık metne cevrilir', () => {
        expect(clampToDecimals(5e-8, 18)).toBe('0.00000005')
        expect(clampToDecimals(5e-8, 6)).toBe('0')
    })
})

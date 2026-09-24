// ATS tutarinin EKRAN bicimi - TEK KAYNAK oldugu icin iki ekranin da kilidi burada.
//
// 2026-09-15 AYRISMASI: ayni bolum (AtsShortfallNote) hem Send/Dapp onayinda hem takas
// ekraninda ciziliyor ama sayilar IKI FARKLI kuralla yaziliyordu. Takas ekraninin
// yerel `fmt`si `toFixed(4)` uyguluyordu; asagidaki iki sinir deger o kuralin neden
// kullaniciya ZARAR verdigini gosteriyor ve gerilemeyi kilitliyor.
import { describe, it, expect } from 'vitest'
import { formatAtsAmount } from './atsAmountFormat'

describe('formatAtsAmount - sinir degerler', () => {
    it('cok kucuk eksik "0"a DUSMEZ (toFixed(4) tuzagi)', () => {
        // toFixed(4) bunu "0.0000" -> kuyruk kirpma ile "0" yapiyordu. "0 ATS eksik"
        // diyen bir kartin yaninda kilitli bir dugme, kullanicinin cozemeyecegi bir
        // bilmecedir: ne yukleyecegini bilemez.
        expect(formatAtsAmount(0.00004)).toBe('0.00004')
        expect(formatAtsAmount(0.000012345)).toBe('0.00001234')
    })

    it('ondalik KIRPILMAZ - gosterilen kadar yukleyen kullanici bloklu kalmamali', () => {
        // toFixed(4) bunu "8.5833" yapiyordu: kullanici o kadar yukler ve YINE bloklu
        // kalirdi. atsShortfall.js'in var olma sebebi tam olarak bu hatadan kacinmakti.
        expect(formatAtsAmount(8.583333)).toBe('8.583333')
    })

    it('binlik ayraci okunabilirlik icin var, ondalik nokta SABIT (en-US)', () => {
        // Bicim kullanicinin diline BAGLANMAZ: ondalik ayracinin virgule donmesi
        // (8,583333) kopyalayip borsaya giren kullaniciyi yanlis miktara goturur.
        expect(formatAtsAmount(1234.5)).toBe('1,234.5')
        expect(formatAtsAmount(1000000)).toBe('1,000,000')
    })

    it('6 ondaliktan uzun kuyruk YUVARLANIR (kart tek satir kalmali)', () => {
        expect(formatAtsAmount(1.23456789)).toBe('1.234568')
    })

    it('okunamayan deger "0" DEGIL "—" (sifir "bedava" demek olurdu)', () => {
        expect(formatAtsAmount(null)).toBe('—')
        expect(formatAtsAmount(undefined)).toBe('—')
        expect(formatAtsAmount('abc')).toBe('—')
        expect(formatAtsAmount(Infinity)).toBe('—')
    })

    it('GERCEK sifir "0" yazar (okunamamisliktan AYRI)', () => {
        expect(formatAtsAmount(0)).toBe('0')
        expect(formatAtsAmount('0')).toBe('0')
    })

    it('dize girdiler sayiya cevrilir (/status alanlari dize gelir)', () => {
        expect(formatAtsAmount('28.58')).toBe('28.58')
    })
})

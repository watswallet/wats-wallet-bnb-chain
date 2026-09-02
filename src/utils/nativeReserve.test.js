import { describe, it, expect } from 'vitest'
import { needsNativeReserve, reserveFromQuote, RESERVE_HEADROOM, TON_SWAP_GAS_RESERVE, SWAP_GAS_FALLBACK, BRIDGE_GAS_FALLBACK } from './nativeReserve'

describe('needsNativeReserve', () => {
    it('native girdide ve native ucrette pay GEREKIR', () => {
        expect(needsNativeReserve({ isNativeIn: true })).toBe(true)
    })

    // Girdi bir token ise ucret ONDAN odenmiyor; pay ayirmak kullanicinin
    // tokeninin tamamini takas etmesini gereksiz yere engellerdi.
    it('girdi token ise pay GEREKMEZ', () => {
        expect(needsNativeReserve({ isNativeIn: false })).toBe(false)
    })

    // ATS kolunda ucret ATS ile odenir. Ozelligin hedef kitlesi zaten native'i
    // OLMAYAN kullanici; ondan native pay istemek ozelligi anlamsiz kilardi.
    it('ucret ATS ile odeniyorsa pay GEREKMEZ', () => {
        expect(needsNativeReserve({ isNativeIn: true, payWithAts: true })).toBe(false)
    })

    it('ucret secilen gas tokeni ile odeniyorsa pay GEREKMEZ', () => {
        expect(needsNativeReserve({ isNativeIn: true, gasToken: { address: '0xabc' } })).toBe(false)
    })

    it('bos cagri pay GEREKTIRMEZ', () => {
        // Bilinmeyen durumda pay AYIRMAMAK guvenli taraf: fazla pay kullanicinin
        // parasini kilitler, eksik pay yalnizca mevcut davranisa doner.
        expect(needsNativeReserve()).toBe(false)
        expect(needsNativeReserve({})).toBe(false)
    })
})

describe('reserveFromQuote', () => {
    it('teklifin gaz tahminine marj ekler', () => {
        expect(reserveFromQuote(0.001)).toBeCloseTo(0.001 * RESERVE_HEADROOM, 12)
    })

    it('marj oraninda ustune cikar - altina DEGIL', () => {
        expect(RESERVE_HEADROOM).toBeGreaterThan(1)
    })

    // Tahmin yoksa 0 doner ve cagiran kendi ihtiyatli sabitine duser; burada
    // uydurma bir sayi dondurmek o dususu sessizce engellerdi.
    it('tahmin yoksa 0', () => {
        expect(reserveFromQuote(0)).toBe(0)
        expect(reserveFromQuote(null)).toBe(0)
        expect(reserveFromQuote(undefined)).toBe(0)
        expect(reserveFromQuote('abc')).toBe(0)
        expect(reserveFromQuote(-1)).toBe(0)
    })
})

describe('ihtiyatli sabitler', () => {
    // OLCUM: STON.fi SDK router filosunda swapTonToJetton gaz sabitlerinin en
    // buyugu 0.479 TON. Pay onun marjli halinden KUCUK olamaz, yoksa MAX yine
    // cikmaza girer.
    it('TON takas payi olculen en buyuk gazi marjiyla karsilar', () => {
        expect(TON_SWAP_GAS_RESERVE).toBeGreaterThanOrEqual(0.479 * RESERVE_HEADROOM)
    })

    // Duz transfer 21000 gaz harcar; takas ve kopru kat kat ustunde. Send'in
    // sabiti buraya tasinsaydi pay yetmezdi.
    it('takas ve kopru limitleri duz transferin cok ustunde', () => {
        expect(SWAP_GAS_FALLBACK).toBeGreaterThan(21000 * 5)
        expect(BRIDGE_GAS_FALLBACK).toBeGreaterThanOrEqual(SWAP_GAS_FALLBACK)
    })
})

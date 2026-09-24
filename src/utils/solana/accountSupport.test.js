import { describe, it, expect } from 'vitest'
import { isSolanaUnsupportedAccount, assertSolanaDerivable } from './accountSupport'

// 2026-09-10 REGRESYON KAPISI.
//
// Bu fonksiyon eskiden `accountHasTon(account)` okuyordu. accountKind.js cok
// aileli hale gelince accountHasTon HD hesapta TRUE dondu ve bu kosul her HD
// hesabin Solana destegini sessizce dusurdu. Sorunun gercek sorusu hicbir zaman
// "bu hesabin TON'u var mi" degildi -- "bu hesabin sirri bir BIP39 IFADESI mi"
// idi. Cevabi kasa tipidir.
//
// DUZELTME (R8, 2026-09-11): yukaridaki kaldirmanin AŞIRI gittigi ortaya cikti.
// Asagidaki "ice aktarilmis TON hesabi Solana imzalayabilir" testi `{type:'ton'}`
// kullaniyordu -- ama R6'ya gore ice aktarilan/hibrit TON hesabi `type:'hd'`dir
// (+ `tonFingerprint`, buildHybridTonAccount), `type:'ton'` DEGIL. Kalan
// `type:'ton'` kayitlar YALNIZCA eski/legacy profiller: kasalari 'tonMnemonic'
// ve icinde BIP-39 sirri YOKTUR. Test dogru yorumu (hd kasasindan BIP39 ile
// Solana cozulur) YANLIS nesnenin (`{type:'ton'}`) uzerine kilitlemisti.

describe('isSolanaUnsupportedAccount', () => {
    it('HD hesap Solana imzalayabilir', () => {
        expect(isSolanaUnsupportedAccount({ type: 'hd', index: 0 })).toBe(false)
    })

    // Ice aktarilan TON ifadesinden evmFromTon ile turetilen BIP39 ifadesi
    // 'hd' kasasinda yasar (tonFingerprint tasiyan hibrit kayit, R6); Solana o
    // kasadan cozulur. Hesap turu `type:'hd'`dir -- `type:'ton'` DEGIL.
    it('ice aktarilmis (hibrit) TON hesabi Solana imzalayabilir', () => {
        expect(isSolanaUnsupportedAccount({ type: 'hd', tonFingerprint: 'F1' })).toBe(false)
    })

    // R8: `type:'ton'` ESKI/legacy kayittir (accountKind.js R6), kasasi
    // 'tonMnemonic'dir ve icinde BIP-39 sirri YOKTUR -- ed25519 hic
    // TURETILEMEZ. `assertSolanaDerivable` bu kombinasyonu zaten reddediyordu;
    // bu ON KAPI da AYNI cevabi vermeli, yoksa kullanici turetmenin kesin
    // patlayacagi bir yola "destekleniyor" sanip girer.
    it('legacy type:ton hesabi (BIP-39 sirri yok) DESTEKLENMEZ', () => {
        expect(isSolanaUnsupportedAccount({ type: 'ton' })).toBe(true)
    })

    it('ozel anahtar hesaplari DESTEKLENMEZ', () => {
        expect(isSolanaUnsupportedAccount({ type: 'imported' })).toBe(true)
        expect(isSolanaUnsupportedAccount({ type: 'privateKey' })).toBe(true)
    })

    // FAIL-OPEN korunur: bilinmeyeni desteklenmiyor saymak gecerli bir hesapla
    // gelen kullaniciyi da kilitlerdi.
    it('bilinmeyen hesap ENGELLENMEZ', () => {
        expect(isSolanaUnsupportedAccount(undefined)).toBe(false)
        expect(isSolanaUnsupportedAccount({})).toBe(false)
    })
})

describe('assertSolanaDerivable — kasa tipi kapisi FAIL-CLOSED kalir', () => {
    it('hd kasasi gecer', () => {
        expect(() => assertSolanaDerivable({ type: 'hd' }, { type: 'hd' })).not.toThrow()
    })

    // R8 SONRASI: `type:'ton'` artik `isSolanaUnsupportedAccount`in ON KAPISINDA
    // erken elenir -- kasa GERCEKTEN 'hd' olsa bile. Eskiden burada "gecer"
    // bekleniyordu (Y2'nin `{type:'ton'}`i hibrit hesap sanan yanlis okumasi,
    // yukaridaki R8 notuna bakin); bugunku kayitlarda bu ikili (legacy hesap
    // turu + hd kasa) zaten OLUSAMAZ, olustuysa bozuk bir kayittir ve
    // reddedilmesi DOGRUDUR.
    it('legacy ton hesabi + hd kasasi FIRLATIR (hesap turu erken eler)', () => {
        expect(() => assertSolanaDerivable({ type: 'ton' }, { type: 'hd' }))
            .toThrow('SOLANA_UNSUPPORTED_ACCOUNT')
    })

    it('ton hesabi + tonMnemonic kasasi FIRLATIR', () => {
        expect(() => assertSolanaDerivable({ type: 'ton' }, { type: 'tonMnemonic' }))
            .toThrow('SOLANA_UNSUPPORTED_ACCOUNT')
    })

    it('bilinmeyen kasa tipi FIRLATIR', () => {
        expect(() => assertSolanaDerivable({ type: 'hd' }, { type: 'gelecek' }))
            .toThrow('SOLANA_UNSUPPORTED_ACCOUNT')
        expect(() => assertSolanaDerivable({ type: 'hd' }, undefined))
            .toThrow('SOLANA_UNSUPPORTED_ACCOUNT')
    })
})

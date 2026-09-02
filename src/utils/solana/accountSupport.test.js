import { describe, it, expect } from 'vitest'
import { isSolanaUnsupportedAccount } from './accountSupport'

describe('isSolanaUnsupportedAccount', () => {
    // secp256k1 private key'inden ed25519 anahtari TURETILEMEZ.
    it('ice aktarilmis hesaplar Solana imzalayamaz', () => {
        expect(isSolanaUnsupportedAccount({ type: 'imported' })).toBe(true)
        expect(isSolanaUnsupportedAccount({ type: 'privateKey' })).toBe(true)
    })

    it('HD hesaplari imzalayabilir', () => {
        expect(isSolanaUnsupportedAccount({ type: 'hd' })).toBe(false)
        expect(isSolanaUnsupportedAccount({ index: 0 })).toBe(false)
    })

    // Bilinmeyeni desteklenmiyor saymak, gecerli bir hesapla gelen kullaniciyi
    // da kilitlerdi.
    it('bilinmeyen/eksik hesap ENGELLENMEZ', () => {
        expect(isSolanaUnsupportedAccount(null)).toBe(false)
        expect(isSolanaUnsupportedAccount(undefined)).toBe(false)
        expect(isSolanaUnsupportedAccount({})).toBe(false)
    })
})

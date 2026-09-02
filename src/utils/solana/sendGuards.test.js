import { describe, it, expect } from 'vitest'
import { validateRecipient, sendBlockReason } from './sendGuards'

const SOL_WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
// Egri DISI adres: bir ATA (PDA). SPL Token program kimligi bu is icin
// kullanilamaz — olculdu, o adres egri USTUNDEDIR (bkz. Task 10 notu).
const SOL_OFF_CURVE = 'FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B'
const EVM = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96'

describe('validateRecipient', () => {
    it('EVM zincirinde EVM adresi gecerli', () => {
        expect(validateRecipient(EVM, 'evm')).toEqual({ valid: true, reason: null })
    })

    // EVM zincirinde base58 bir adres kabul edilirse islem kurulmaya calisilir
    // ve opak bir hatayla duser.
    it('EVM zincirinde Solana adresi gecersiz', () => {
        expect(validateRecipient(SOL_WALLET, 'evm').valid).toBe(false)
    })

    it('Solana zincirinde cuzdan adresi gecerli', () => {
        expect(validateRecipient(SOL_WALLET, 'solana')).toEqual({ valid: true, reason: null })
    })

    it('Solana zincirinde EVM adresi gecersiz', () => {
        expect(validateRecipient(EVM, 'solana')).toEqual({ valid: false, reason: 'INVALID_SOLANA_ADDRESS' })
    })

    // Ayri sebep kodu: kullaniciya "gecersiz adres" degil, "bu bir cuzdan
    // adresi degil, oraya gonderilen para geri alinamaz" denmeli.
    it('Solana da egri disi adres AYRI sebeple reddedilir', () => {
        expect(validateRecipient(SOL_OFF_CURVE, 'solana')).toEqual({
            valid: false, reason: 'RECIPIENT_NOT_WALLET'
        })
    })

    it('bos adres her iki VM de gecersiz', () => {
        expect(validateRecipient('', 'solana').valid).toBe(false)
        expect(validateRecipient(null, 'evm').valid).toBe(false)
    })
})

describe('sendBlockReason', () => {
    it('EVM de ice aktarilmis hesap ENGELLENMEZ', () => {
        expect(sendBlockReason({ account: { type: 'imported' }, vm: 'evm' })).toBe(null)
    })

    // Kullanici "Onayla"ya basip pencerenin sessizce kapanmasini gormemeli:
    // sebep ONCEDEN bilinir ve ekranda yazar.
    it('Solana da ice aktarilmis hesap ONCEDEN engellenir', () => {
        expect(sendBlockReason({ account: { type: 'imported' }, vm: 'solana' }))
            .toBe('SOLANA_UNSUPPORTED_ACCOUNT')
        expect(sendBlockReason({ account: { type: 'privateKey' }, vm: 'solana' }))
            .toBe('SOLANA_UNSUPPORTED_ACCOUNT')
    })

    it('HD hesabi Solana da engellenmez', () => {
        expect(sendBlockReason({ account: { type: 'hd' }, vm: 'solana' })).toBe(null)
    })

    it('bilinmeyen hesap engellenmez', () => {
        expect(sendBlockReason({ account: null, vm: 'solana' })).toBe(null)
    })
})

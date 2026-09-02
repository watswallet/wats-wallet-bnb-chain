import { describe, it, expect } from 'vitest'
import { Address } from '@ton/core'
import {
    parseTonAddress,
    isValidTonAddress,
    toFriendlyTon,
    normalizeTonRecipient,
} from './tonAddress'

// Depoda zaten bulunan GERCEK mainnet adresleri (server/ton/index.js gecmisi).
const UQ_MAINNET = 'UQAgPlDEUtqTMAJ1fpGT0AFebk85pdtOYKq72I5Eq9VIIy1P'
const EQ_MAINNET = 'EQDCYzNSXhwMVrgXY_YIeU2PskDKedKNldHLz1G-I4Ch4cqT'

describe('tonAddress', () => {
    it('non-bounceable mainnet adresi ayristirir', () => {
        const parsed = parseTonAddress(UQ_MAINNET)
        expect(parsed).toBeInstanceOf(Address)
        expect(toFriendlyTon(parsed)).toBe(UQ_MAINNET)
    })

    it('raw bicimi de kabul eder ve UQ ya cevirir', () => {
        const raw = Address.parse(UQ_MAINNET).toRawString()
        expect(raw).toContain(':')
        expect(normalizeTonRecipient(raw)).toBe(UQ_MAINNET)
    })

    it('bounceable EQ adresi non-bounceable UQ ya cevrilir', () => {
        // Deploy edilmemis cuzdana EQ ile gonderilen para GERI SEKER.
        const normalized = normalizeTonRecipient(EQ_MAINNET)
        expect(normalized.startsWith('UQ')).toBe(true)
        expect(Address.parse(normalized).equals(Address.parse(EQ_MAINNET))).toBe(true)
    })

    it('testnet isaretli adres mainnet te reddedilir', () => {
        const testnetForm = Address.parse(UQ_MAINNET).toString({ testOnly: true, bounceable: false })
        expect(testnetForm).not.toBe(UQ_MAINNET)
        expect(isValidTonAddress(testnetForm)).toBe(false)
        expect(() => parseTonAddress(testnetForm)).toThrow('TON_ADDRESS_WRONG_NETWORK')
    })

    it('testnet modunda testnet adresi kabul edilir, mainnet adresi reddedilir', () => {
        const testnetForm = Address.parse(UQ_MAINNET).toString({ testOnly: true, bounceable: false })
        expect(isValidTonAddress(testnetForm, { testnet: true })).toBe(true)
        expect(() => parseTonAddress(UQ_MAINNET, { testnet: true })).toThrow('TON_ADDRESS_WRONG_NETWORK')
    })

    it('EVM adresi ayri bir hatayla reddedilir', () => {
        // Genel "gecersiz adres" yetmez: kullanici TON agindayken 0x yapistirdiysa
        // ona NEDEN olmadigini soylemek, parayi yakan gonderimi engelleyen sey.
        expect(() => parseTonAddress('0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'))
            .toThrow('TON_ADDRESS_IS_EVM')
        expect(isValidTonAddress('0x75D8BB7fBd4782a134211dc350Ba5c715197B81d')).toBe(false)
    })

    it('cop girdi gecersizdir', () => {
        for (const bad of ['', '   ', null, undefined, 'merhaba', 'UQ123']) {
            expect(isValidTonAddress(bad)).toBe(false)
        }
        expect(() => parseTonAddress('merhaba')).toThrow('TON_ADDRESS_INVALID')
    })

    it('bosluklu girdi kirpilir', () => {
        expect(normalizeTonRecipient(`  ${UQ_MAINNET}  `)).toBe(UQ_MAINNET)
    })
})

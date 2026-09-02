import { describe, it, expect } from 'vitest'
import {
    isValidSolanaAddress, isWalletAddress, normalizeSolanaAddress, toPublicKey
} from './address'

// Gercek, egri ustunde bir cuzdan adresi.
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
// SPL token programi: gecerli 32 bayt bir adres (isValidSolanaAddress icin ornek).
const PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
// SPL token programindan PublicKey.findProgramAddressSync(['address-test-off-curve'], TOKEN_PROGRAM_ID)
// ile turetilmis GERCEK bir PDA: gecerli 32 bayt ama EGRI DISINDA. PROGRAM'in
// kendisi (yukarida) aslinda egri USTUNDE bir vanity-mined adres oldugundan
// (PDA degil) egri-disi ornek icin ayri, dogrulanmis bir deger kullanilir.
const PDA = '8nqnRHi4kQS7YjFmov2Khht6GQ8Fh58dDqQWe7dBE1gg'

describe('isValidSolanaAddress', () => {
    it('gecerli cuzdan adresini kabul eder', () => {
        expect(isValidSolanaAddress(WALLET)).toBe(true)
    })

    it('program adresi de gecerli bir adrestir', () => {
        expect(isValidSolanaAddress(PROGRAM)).toBe(true)
    })

    it('EVM adresi Solana adresi DEGILDIR', () => {
        expect(isValidSolanaAddress('0x098B716B8Aaf21512996dC57EB0615e2383E2f96')).toBe(false)
    })

    it('base58 disi karakter reddedilir (0, O, I, l yok)', () => {
        expect(isValidSolanaAddress('0WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).toBe(false)
    })

    it('bos / bicimsiz girdi reddedilir', () => {
        expect(isValidSolanaAddress('')).toBe(false)
        expect(isValidSolanaAddress(null)).toBe(false)
        expect(isValidSolanaAddress(undefined)).toBe(false)
        expect(isValidSolanaAddress(123)).toBe(false)
        expect(isValidSolanaAddress('abc')).toBe(false)
    })

    it('bastaki/sondaki bosluk tolere edilir', () => {
        expect(isValidSolanaAddress(`  ${WALLET}  `)).toBe(true)
    })
})

describe('isWalletAddress', () => {
    it('egri ustundeki adres bir cuzdandir', () => {
        expect(isWalletAddress(WALLET)).toBe(true)
    })

    // Egri disi bir adrese (program hesabi, PDA, ATA) gonderim yapilirsa para
    // GERI ALINAMAZ: o adresin ozel anahtari yoktur, kimse harcayamaz.
    it('egri disindaki adres cuzdan DEGILDIR', () => {
        expect(isWalletAddress(PDA)).toBe(false)
    })

    it('gecersiz adres cuzdan degildir', () => {
        expect(isWalletAddress('0xdeadbeef')).toBe(false)
    })
})

describe('normalizeSolanaAddress', () => {
    // BASE58 BUYUK/KUCUK HARF DUYARLIDIR. Kucultmek iki farkli adresi ayni
    // gosterir; zehirli adres tespiti bu yuzden sessizce yaniltilirdi.
    it('harf kasasini KORUR', () => {
        expect(normalizeSolanaAddress(WALLET)).toBe(WALLET)
        expect(normalizeSolanaAddress(WALLET)).not.toBe(WALLET.toLowerCase())
    })

    it('bosluklari atar', () => {
        expect(normalizeSolanaAddress(`\t${WALLET}\n`)).toBe(WALLET)
    })

    it('gecersiz adres icin null', () => {
        expect(normalizeSolanaAddress('0xabc')).toBe(null)
        expect(normalizeSolanaAddress(null)).toBe(null)
    })
})

describe('toPublicKey', () => {
    it('gecerli adresi PublicKey e cevirir', () => {
        expect(toPublicKey(WALLET).toBase58()).toBe(WALLET)
    })

    it('gecersiz adres acik hata ile reddedilir', () => {
        expect(() => toPublicKey('0xabc')).toThrow('INVALID_SOLANA_ADDRESS')
        expect(() => toPublicKey(null)).toThrow('INVALID_SOLANA_ADDRESS')
    })
})

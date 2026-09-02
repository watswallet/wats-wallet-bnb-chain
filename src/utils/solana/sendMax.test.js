import { describe, it, expect } from 'vitest'
import { isSolanaMaxDisabled, computeSolanaMaxAmount } from './sendMax'
import { SOL_NATIVE_MARKER, LAMPORTS_PER_SOL } from './constants'

const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

describe('isSolanaMaxDisabled', () => {
    it('SPL de HICBIR ZAMAN devre disi degil (ucret SOL dan duser, token miktarini etkilemez)', () => {
        expect(isSolanaMaxDisabled({ mint: MINT, solanaFee: null })).toBe(false)
        expect(isSolanaMaxDisabled({ mint: MINT, solanaFee: {} })).toBe(false)
    })

    it('native SOL de baglam yoksa devre disi', () => {
        expect(isSolanaMaxDisabled({ mint: SOL_NATIVE_MARKER, solanaFee: null })).toBe(true)
    })

    it('native SOL de baglam varsa etkin', () => {
        expect(isSolanaMaxDisabled({
            mint: SOL_NATIVE_MARKER,
            solanaFee: { feeLamports: 5000, rentExemptLamports: 890880 },
        })).toBe(false)
    })
})

describe('computeSolanaMaxAmount', () => {
    it('SPL: token bakiyesinin TAMAMI, ucret baglamindan BAGIMSIZ', () => {
        expect(computeSolanaMaxAmount({ mint: MINT, balance: 42.5, solanaFee: null })).toBe('42.5')
        expect(computeSolanaMaxAmount({ mint: MINT, balance: 10, solanaFee: { feeLamports: 5000, rentExemptLamports: 890880 } })).toBe('10')
    })

    it('native SOL: baglam yoksa null (Maks devre disi)', () => {
        expect(computeSolanaMaxAmount({ mint: SOL_NATIVE_MARKER, balance: 1, solanaFee: null })).toBe(null)
    })

    // ASIL MUTASYON KAPANI: rentExemptLamports GERCEK degerle gecirilmezse
    // (ornegin sessizce 0'a sabitlenirse) sonuc BURADAN farkli cikar.
    it('native SOL: ucret VE kira minimumu GERCEK degerlerle dusulur (sifir kiraya DUSULMEZ)', () => {
        const feeLamports = 5000
        const rentExemptLamports = 890880
        const balance = 1 // 1 SOL = 1_000_000_000 lamports

        const result = computeSolanaMaxAmount({
            mint: SOL_NATIVE_MARKER, balance,
            solanaFee: { feeLamports, rentExemptLamports },
        })

        const expectedLamports = 1_000_000_000 - feeLamports - rentExemptLamports
        expect(result).toBe(String(expectedLamports / LAMPORTS_PER_SOL))

        // Emniyet kemeri: rentExemptLamports=0 sanilsaydi sonuc bundan BUYUK cikardi.
        const wrongWithZeroRent = (1_000_000_000 - feeLamports) / LAMPORTS_PER_SOL
        expect(Number(result)).toBeLessThan(wrongWithZeroRent)
    })

    it('native SOL: bakiye ucret+kirayi karsilamiyorsa 0', () => {
        const result = computeSolanaMaxAmount({
            mint: SOL_NATIVE_MARKER, balance: 0.0000001,
            solanaFee: { feeLamports: 5000, rentExemptLamports: 890880 },
        })
        expect(result).toBe('0')
    })
})

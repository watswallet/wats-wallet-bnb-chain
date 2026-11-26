// final SU-16: mintDisplay.js (onay ekraninda mint etiketi) birim testi. Etiket kaynagi YALNIZ
// istemci kurasyonlu tablosu ve native wSOL'dur (Constraint 27); decimals celisiyorsa
// (bozuk/celisen veri) etiket VERILMEZ. Bu davranis ekran testlerinde dolayli kapsaniyordu,
// dogrudan birim testi yoktu.
import { describe, it, expect } from 'vitest'
import { mintDisplaySymbol, WSOL_SYMBOL } from './mintDisplay'
import { NATIVE_MINT_ADDRESS, SOL_DECIMALS } from './constants'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const BILINMEYEN = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'

describe('mintDisplaySymbol', () => {
    it('native mint + 9 decimals -> wSOL', () => {
        expect(SOL_DECIMALS).toBe(9)
        expect(WSOL_SYMBOL).toBe('wSOL')
        expect(mintDisplaySymbol(NATIVE_MINT_ADDRESS, 9)).toBe('wSOL')
    })

    it('native mint + 6 decimals -> null (celisen veri etiket almaz)', () => {
        expect(mintDisplaySymbol(NATIVE_MINT_ADDRESS, 6)).toBeNull()
    })

    it('kurasyonlu mint + dogru decimals -> kurasyonlu sembol', () => {
        expect(mintDisplaySymbol(USDC, 6)).toBe('USDC')
        expect(mintDisplaySymbol(USDT, 6)).toBe('USDT')
    })

    it('kurasyonlu mint + yanlis decimals -> null', () => {
        expect(mintDisplaySymbol(USDC, 9)).toBeNull()
        expect(mintDisplaySymbol(USDC, undefined)).toBeNull()
        expect(mintDisplaySymbol(USDC, null)).toBeNull()
    })

    it('bilinmeyen / bozuk mint -> null (ucuncu taraf sembol sizmaz)', () => {
        expect(mintDisplaySymbol(BILINMEYEN, 6)).toBeNull()
        expect(mintDisplaySymbol(USDC.toLowerCase(), 6)).toBeNull() // base58 harf kutusu duyarli
        expect(mintDisplaySymbol(null, 6)).toBeNull()
        expect(mintDisplaySymbol(undefined, 9)).toBeNull()
        expect(mintDisplaySymbol('', 6)).toBeNull()
    })
})

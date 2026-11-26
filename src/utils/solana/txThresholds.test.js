import { describe, it, expect } from 'vitest'
import {
    MAX_COMPUTE_UNIT_LIMIT, PRIORITY_FEE_BLOCK_LAMPORTS, PRIORITY_FEE_WARN_LAMPORTS, priorityFeeCeilingLamports,
} from './txThresholds'

describe('txThresholds sabitleri (Q7 baslangic degerleri)', () => {
    it('0.01 SOL uyari, 0.1 SOL kutu, runtime CU tavani 1.4M', () => {
        expect(PRIORITY_FEE_WARN_LAMPORTS).toBe(10_000_000n)
        expect(PRIORITY_FEE_BLOCK_LAMPORTS).toBe(100_000_000n)
        expect(MAX_COMPUTE_UNIT_LIMIT).toBe(1_400_000)
    })
})

describe('priorityFeeCeilingLamports', () => {
    it('ceil(fiyat * limit / 1e6), BigInt', () => {
        expect(priorityFeeCeilingLamports({ unitLimit: 200_000, unitPriceMicroLamports: '50000' })).toBe(10_000n)
        expect(priorityFeeCeilingLamports({ unitLimit: 1_400_000, unitPriceMicroLamports: '3000000000' })).toBe(4_200_000_000n)
        expect(priorityFeeCeilingLamports({ unitLimit: 1_400_000, unitPriceMicroLamports: '1000000000000' })).toBe(1_400_000_000_000n)
    })

    it('limit talimati YOKKEN runtime tavani 1.4M CU ile HESAPLANIR (null donmez)', () => {
        expect(priorityFeeCeilingLamports({ unitLimit: null, unitPriceMicroLamports: '3000000000' })).toBe(4_200_000_000n)
        expect(priorityFeeCeilingLamports({ unitPriceMicroLamports: '3000000000' })).toBe(4_200_000_000n)
    })

    it('limit tavani asarsa 1.4M ile sinirlanir', () => {
        expect(priorityFeeCeilingLamports({ unitLimit: 4_294_967_295, unitPriceMicroLamports: '3000000000' })).toBe(4_200_000_000n)
    })

    it('tamsayiya YUKARI yuvarlar', () => {
        expect(priorityFeeCeilingLamports({ unitLimit: 1, unitPriceMicroLamports: '1' })).toBe(1n)
        expect(priorityFeeCeilingLamports({ unitLimit: 1_000_000, unitPriceMicroLamports: '10000001' })).toBe(10_000_001n)
        expect(priorityFeeCeilingLamports({ unitLimit: 1_000_000, unitPriceMicroLamports: '10000000' })).toBe(10_000_000n)
    })

    it('fiyat 0 -> 0n; fiyat yok/okunamadi/gecersiz -> null', () => {
        expect(priorityFeeCeilingLamports({ unitLimit: 200_000, unitPriceMicroLamports: '0' })).toBe(0n)
        expect(priorityFeeCeilingLamports({ unitLimit: 200_000, unitPriceMicroLamports: null })).toBeNull()
        expect(priorityFeeCeilingLamports({ unitLimit: 200_000 })).toBeNull()
        expect(priorityFeeCeilingLamports({ unitLimit: 200_000, unitPriceMicroLamports: '-5' })).toBeNull()
        expect(priorityFeeCeilingLamports({ unitLimit: 200_000, unitPriceMicroLamports: 'abc' })).toBeNull()
        expect(priorityFeeCeilingLamports()).toBeNull()
    })

    it('u64 tavani: 2^64-1 fiyat tasmadan hesaplanir', () => {
        const u64 = 2n ** 64n - 1n
        expect(priorityFeeCeilingLamports({ unitLimit: 1_400_000, unitPriceMicroLamports: u64.toString() }))
            .toBe((u64 * 1_400_000n + 999_999n) / 1_000_000n)
    })

    it('esik karsilastirmasi ">" : tam esik uyari uretmez', () => {
        const tam = priorityFeeCeilingLamports({ unitLimit: 1_000_000, unitPriceMicroLamports: '10000000' })
        expect(tam > PRIORITY_FEE_WARN_LAMPORTS).toBe(false)
        const bir = priorityFeeCeilingLamports({ unitLimit: 1_000_000, unitPriceMicroLamports: '10000001' })
        expect(bir > PRIORITY_FEE_WARN_LAMPORTS).toBe(true)
    })
})

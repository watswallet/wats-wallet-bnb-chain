import { describe, it, expect } from 'vitest'
import { jettonsFromTokens } from './jettonList'

describe('jettonsFromTokens', () => {
    it('ondaligi olan kaydi gecirir', () => {
        const out = jettonsFromTokens([{ symbol: 'USDT', address: 'EQ1', decimals: 6 }])
        expect(out).toHaveLength(1)
        expect(out[0].decimals).toBe(6)
        expect(out[0].master).toBe('EQ1')
    })

    it('ondaligi OLMAYAN kaydi DUSURUR', () => {
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ2' }])).toHaveLength(0)
    })

    it('ondaligi sayi OLMAYAN kaydi DUSURUR', () => {
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ2', decimals: '6' }])).toHaveLength(0)
    })

    it('master adresi olmayan kaydi DUSURUR', () => {
        expect(jettonsFromTokens([{ symbol: 'X', decimals: 6 }])).toHaveLength(0)
    })

    it('bozuk girdide patlamaz', () => {
        expect(jettonsFromTokens(null)).toEqual([])
        expect(jettonsFromTokens(undefined)).toEqual([])
    })

    // Ku1: eskiden yalniz Number.isInteger kontrol ediliyordu - negatif ve anlamsiz
    // buyuk degerler de tamsayi oldugu icin GECIYORDU. jettonTransfer.js/
    // tonJettonHistory.js ile AYNI sinir (0..30) burada da uygulanir.
    it('negatif ondaligi olan kaydi DUSURUR', () => {
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ2', decimals: -1 }])).toHaveLength(0)
    })

    it('sinirin (30) UZERINDE ondaligi olan kaydi DUSURUR', () => {
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ2', decimals: 31 }])).toHaveLength(0)
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ2', decimals: 1e7 }])).toHaveLength(0)
    })

    it('sinir DEGERLERI (0 ve 30) GECER', () => {
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ2', decimals: 0 }])).toHaveLength(1)
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ3', decimals: 30 }])).toHaveLength(1)
    })
})

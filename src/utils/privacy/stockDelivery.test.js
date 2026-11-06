import { describe, it, expect } from 'vitest'
import { getAddress } from 'ethers'
import { isStockDeliveryToken } from './stockDelivery'
import { BSTOCKS } from '../../data/bStocks'
import { XSTOCKS } from '../../data/xStocks'
import { buildDeliveryTokenList } from './deliveryTokens'

const CRCLB = BSTOCKS.find((t) => t.symbol === 'CRCLB')
const SPCXB = BSTOCKS.find((t) => t.symbol === 'SPCXB')
const TSLAX = XSTOCKS.find((t) => t.symbol === 'TSLAx')
const CAKE = getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82')

describe('isStockDeliveryToken (ortak hisse tanima, chainId + adres)', () => {
    it('katalogdaki her bStock ve xStock (kendi zincirlerinde) hisse sayilir; adres harf boyutuna duyarsiz', () => {
        for (const t of BSTOCKS) {
            expect(isStockDeliveryToken(56, t.address), t.symbol).toBe(true)
            expect(isStockDeliveryToken('56', t.address.toLowerCase()), t.symbol).toBe(true)
        }
        for (const t of XSTOCKS) for (const c of t.chains) expect(isStockDeliveryToken(c, t.address.toLowerCase()), `${t.symbol}@${c}`).toBe(true)
    })

    it('xStocks adresi var oldugu butun zincirlerde (Optimism, Mantle dahil) hisse sayilir', () => {
        expect(isStockDeliveryToken(10, TSLAX.address)).toBe(true)
        expect(isStockDeliveryToken(5000, TSLAX.address)).toBe(true)
    })

    it('hisse olmayanlar: CAKE, baska agdaki ayni bStock adresi, sifir adres, baska adres', () => {
        expect(isStockDeliveryToken(56, CAKE)).toBe(false)
        expect(isStockDeliveryToken(8453, CRCLB.address)).toBe(false)
        expect(isStockDeliveryToken(56, getAddress('0x' + '99'.repeat(20)))).toBe(false)
        expect(isStockDeliveryToken(56, '0x0000000000000000000000000000000000000000')).toBe(false)
    })

    it('adres yoksa ya da dizge degilse hisse DEGIL (liste ayiklayici tarafindan zaten dusurulur)', () => {
        expect(isStockDeliveryToken(56, undefined)).toBe(false)
        expect(isStockDeliveryToken(56, 5)).toBe(false)
    })

    it('buildDeliveryTokenList sunucu ve ice aktarilan hisseleri atar, digerlerini korur', () => {
        const remote = [
            { address: CRCLB.address.toLowerCase(), symbol: 'CRCLB', name: 'Circle', decimals: 18 },
            { address: CAKE, symbol: 'CAKE', name: 'Cake', decimals: 18 },
        ]
        const imported = [{ address: SPCXB.address, symbol: 'SPCXB', name: 'SpaceX', decimals: 18 }]
        const list = buildDeliveryTokenList({ chainId: 56, nativeEnabled: true, imported, remote })
        expect(list.map((t) => t.symbol)).toEqual(['BNB', 'USDC', 'ATS', 'CAKE'])
    })

    it('xStock (Ethereum) ice aktarilmis ya da sunucu satiri olarak listede yoktur; hisse adli ama baska adresli token kalir', () => {
        const remote = [
            { address: TSLAX.address, symbol: 'TSLAx', name: 'Tesla xStock', decimals: 18 },
            { address: getAddress('0x' + '55'.repeat(20)), symbol: 'CRCLB', name: 'Sahte', decimals: 18 },
        ]
        const list = buildDeliveryTokenList({ chainId: 1, nativeEnabled: true, remote, imported: [{ address: TSLAX.address, symbol: 'TSLAx', decimals: 18 }] })
        expect(list.map((t) => t.symbol)).toEqual(['ETH', 'USDC', 'CRCLB'])
        expect(list.some((t) => t.address.toLowerCase() === TSLAX.address.toLowerCase())).toBe(false)
    })
})

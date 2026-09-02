import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { isNativeAsset } from './nativeAsset'

describe('isNativeAsset', () => {
    it('bos degerler native sayilir', () => {
        expect(isNativeAsset(null)).toBe(true)
        expect(isNativeAsset(undefined)).toBe(true)
        expect(isNativeAsset('')).toBe(true)
        expect(isNativeAsset('   ')).toBe(true)
    })

    it("'0x0' native sayilir (API bu degeri donduruyor)", () => {
        // Bu tam olarak #7'nin sebebi: '0x0' truthy oldugu icin ERC-20 sanilıyordu.
        expect(isNativeAsset('0x0')).toBe(true)
    })

    it('ZeroAddress ve 0xEeee... placeholder native sayilir', () => {
        expect(isNativeAsset(ethers.ZeroAddress)).toBe(true)
        expect(isNativeAsset('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')).toBe(true)
    })

    it('buyuk/kucuk harf farki onemli degil', () => {
        expect(isNativeAsset('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')).toBe(true)
        expect(isNativeAsset('0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE')).toBe(true)
    })

    it('gercek bir ERC-20 adresi native DEGILDIR', () => {
        expect(isNativeAsset('0xdAC17F958D2ee523a2206206994597C13D831ec7')).toBe(false)
    })
})

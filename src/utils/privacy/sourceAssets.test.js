import { describe, it, expect } from 'vitest'
import { LISTED_CHAINS } from '../../data/chains'
import { isAtsChain } from '../atsConfig'
import { privateSourceChains, privateSourceSupported } from './silentswapConfig'
import { pairKey, sourcePairs, sourceAssetAddress, filterSourcePairs } from './sourceAssets'

const ZERO = '0x0000000000000000000000000000000000000000'

describe('sourceAssets', () => {
    it('pairKey zincir ve varligi birlestirir', () => {
        expect(pairKey(56, 'USDC')).toBe('56:USDC')
        expect(pairKey('8453', 'ETH')).toBe('8453:ETH')
    })

    it('sourcePairs: en az bir cift, 56:USDC var, her cift kaynak olarak acik, anahtarlar benzersiz', () => {
        const pairs = sourcePairs(LISTED_CHAINS)
        expect(pairs.length).toBeGreaterThan(0)
        expect(pairs.map((p) => p.key)).toContain('56:USDC')
        for (const p of pairs) {
            expect(privateSourceSupported(p.chainId, p.asset)).toBe(true)
            expect(typeof p.chainId).toBe('number')
            expect(p.key).toBe(`${p.chainId}:${p.asset}`)
            expect(typeof p.chainName).toBe('string')
            expect(p.chainName.length).toBeGreaterThan(0)
        }
        const keys = pairs.map((p) => p.key)
        expect(new Set(keys).size).toBe(keys.length)
    })

    it('sourcePairs: zincir sirasi korunur ve her zincirin varliklari privateAssetsFor sirasindadir', () => {
        const pairs = sourcePairs(LISTED_CHAINS)
        const chainOrder = privateSourceChains(LISTED_CHAINS).map((c) => Number(c.chainId))
        const seen = []
        for (const p of pairs) if (seen[seen.length - 1] !== p.chainId) seen.push(p.chainId)
        expect(seen).toEqual(chainOrder)
        // Ethereum: USDC, USDT, DAI, ETH (once sabit coinler, sonra yerel coin).
        expect(pairs.filter((p) => p.chainId === 1).map((p) => p.asset)).toEqual(['USDC', 'USDT', 'DAI', 'ETH'])
    })

    it('sourcePairs: bos ya da gecersiz girdi bos dizi doner', () => {
        expect(sourcePairs([])).toEqual([])
        expect(sourcePairs(null)).toEqual([])
        expect(sourcePairs(undefined)).toEqual([])
    })

    it('yeni kilit: kaynak zincirlerinin hepsi ATS zinciridir (ATS zorunlu)', () => {
        const chains = privateSourceChains(LISTED_CHAINS)
        expect(chains.length).toBeGreaterThan(0)
        for (const c of chains) expect(isAtsChain(Number(c.chainId))).toBe(true)
    })

    it('sourceAssetAddress: kayit adresi; yerel coin sifir adres; bilinmeyen null', () => {
        expect(sourceAssetAddress(56, 'USDC')).toBe('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d')
        expect(sourceAssetAddress(8453, 'ETH')).toBe(ZERO)
        expect(sourceAssetAddress(56, 'YOKTOKEN')).toBeNull()
        expect(sourceAssetAddress(56, 'constructor')).toBeNull()
        expect(sourceAssetAddress(999999, 'USDC')).toBeNull()
    })

    it('filterSourcePairs: "usdc" yalniz USDC ciftleri, buyuk/kucuk harf duyarsiz', () => {
        const pairs = sourcePairs(LISTED_CHAINS)
        const out = filterSourcePairs(pairs, 'usdc')
        expect(out.length).toBeGreaterThan(0)
        for (const p of out) expect(p.asset).toBe('USDC')
        expect(out.length).toBe(pairs.filter((p) => p.asset === 'USDC').length)
        expect(filterSourcePairs(pairs, 'UsDc')).toEqual(out)
    })

    it('filterSourcePairs: "arbi" Arbitrum ciftleri (ag adi uzerinden)', () => {
        const pairs = sourcePairs(LISTED_CHAINS)
        const out = filterSourcePairs(pairs, 'arbi')
        expect(out.length).toBeGreaterThan(0)
        for (const p of out) expect(p.chainName.toLowerCase()).toContain('arbi')
        expect(out.map((p) => p.key)).toContain('42161:USDC')
    })

    it('filterSourcePairs: bos, bosluk ve null/undefined sorgu tum cifleri doner; kirpilir', () => {
        const pairs = sourcePairs(LISTED_CHAINS)
        expect(filterSourcePairs(pairs, '')).toEqual(pairs)
        expect(filterSourcePairs(pairs, '  ')).toEqual(pairs)
        expect(filterSourcePairs(pairs, null)).toEqual(pairs)
        expect(filterSourcePairs(pairs, undefined)).toEqual(pairs)
        expect(filterSourcePairs(pairs, '  usdc  ')).toEqual(filterSourcePairs(pairs, 'usdc'))
    })

    it('filterSourcePairs: eslesmeyen sorgu bos dizi; liste degilse bos dizi; girdiyi degistirmez', () => {
        const pairs = sourcePairs(LISTED_CHAINS)
        const kopya = JSON.stringify(pairs)
        expect(filterSourcePairs(pairs, 'yoktoken-xyz')).toEqual([])
        expect(filterSourcePairs(null, 'usdc')).toEqual([])
        expect(filterSourcePairs(undefined, '')).toEqual([])
        expect(JSON.stringify(pairs)).toBe(kopya)
    })
})

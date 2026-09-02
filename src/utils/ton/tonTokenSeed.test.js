import { describe, it, expect } from 'vitest'
import { ensureTonNativeToken } from './tonTokenSeed'
import { TON_MAINNET_ID } from '../chainKind'

const KEY = String(TON_MAINNET_ID)

describe('ensureTonNativeToken', () => {
    it('TON satiri yoksa ekler', () => {
        const { changed, byChain } = ensureTonNativeToken({ 1: [{ symbol: 'ETH' }] })
        expect(changed).toBe(true)
        expect(byChain[KEY]).toHaveLength(1)
        expect(byChain[KEY][0].symbol).toBe('TON')
        expect(Number(byChain[KEY][0].chainId)).toBe(TON_MAINNET_ID)
        expect(byChain[KEY][0].native).toBe(true)
    })

    it('mevcut zincirlere dokunmaz', () => {
        const { byChain } = ensureTonNativeToken({ 1: [{ symbol: 'ETH' }] })
        expect(byChain['1']).toEqual([{ symbol: 'ETH' }])
    })

    it('zaten varsa DEGISTIRMEZ', () => {
        const existing = { [KEY]: [{ symbol: 'TON', address: '0x0', chainId: TON_MAINNET_ID }] }
        const { changed, byChain } = ensureTonNativeToken(existing)
        expect(changed).toBe(false)
        expect(byChain[KEY]).toHaveLength(1)
    })

    it('bos/gecersiz girdide de calisir', () => {
        expect(ensureTonNativeToken(undefined).byChain[KEY]).toHaveLength(1)
        expect(ensureTonNativeToken(null).changed).toBe(true)
    })

    it('girdiyi YERINDE degistirmez', () => {
        const input = { 1: [] }
        const { byChain } = ensureTonNativeToken(input)
        expect(input[KEY]).toBeUndefined()
        expect(byChain).not.toBe(input)
    })
})

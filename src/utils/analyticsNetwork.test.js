import { describe, it, expect } from 'vitest'
import { networkKeyForChain, NETWORK_KEY_BY_CHAIN } from './analyticsNetwork.js'
import { NETWORK_KEYS } from './analyticsPing.js'
import supported_chains from '../data/supported_chains.json'

const TABLO = [
    [1, 'eth'], [56, 'bsc'], [10, 'op'], [100, 'gnosis'], [42220, 'celo'], [5000, 'mantle'],
    [8453, 'base'], [25, 'cronos'], [42161, 'arb'], [137, 'polygon'], [-239, 'ton'],
    ['solana-mainnet', 'solana']
]

describe('networkKeyForChain', () => {
    it.each(TABLO)('12 tablo satiri dogru: %s -> %s', (id, key) => {
        expect(networkKeyForChain(id)).toBe(key)
    })

    it('hex ve sayisal dize normalize', () => {
        expect(networkKeyForChain('0x38')).toBe('bsc')
        expect(networkKeyForChain('0x1')).toBe('eth')
        expect(networkKeyForChain('56')).toBe('bsc')
        expect(networkKeyForChain(' 137 ')).toBe('polygon')
        expect(networkKeyForChain('-239')).toBe('ton')
    })

    it('-3 (TON testnet) -> other', () => {
        expect(networkKeyForChain(-3)).toBe('other')
        expect(networkKeyForChain('-3')).toBe('other')
    })

    it('null/undefined/NaN/bos dize -> other', () => {
        for (const v of [null, undefined, NaN, '', '   ', 'abc', {}, [], 999999]) {
            expect(networkKeyForChain(v)).toBe('other')
        }
    })

    it("supported_chains.json'daki her MAINNET zincir bir anahtara esli", () => {
        const mainnets = supported_chains.filter((c) => !c.testnet && !c.isTestnet)
        expect(mainnets.length).toBeGreaterThan(0)
        for (const c of mainnets) {
            expect(networkKeyForChain(c.chainId), String(c.chainId)).not.toBe('other')
        }
    })

    it('donus her zaman NETWORK_KEYS icinde', () => {
        for (const v of [...TABLO.map((t) => t[0]), -3, null, 'x', '0xzz', 7]) {
            expect(NETWORK_KEYS).toContain(networkKeyForChain(v))
        }
    })

    it('yeni destekli zincir eklenirse test kirilir', () => {
        const destekli = supported_chains.filter((c) => !c.testnet && !c.isTestnet).map((c) => String(c.chainId)).sort()
        expect(Object.keys(NETWORK_KEY_BY_CHAIN).sort()).toEqual(destekli)
    })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
    SOLANA_SERVER_CHAIN_ID,
    toServerChainId,
    fromServerChainId,
    stampServerTokens,
} from './serverChainId'

describe('SOLANA_SERVER_CHAIN_ID', () => {
    it('sunucunun Solana kimligi -101 dir', () => {
        expect(SOLANA_SERVER_CHAIN_ID).toBe(-101)
    })

    // Sunucu sabiti ile istemci sabiti AYRI dosyalarda; ayrisirlarsa Solana
    // sorgulari sessizce yanlis kovaya gider.
    it('sunucu sabitiyle (server/utils/solanaSplTokens.js) esit -- okuma testi', () => {
        const here = dirname(fileURLToPath(import.meta.url))
        const src = readFileSync(resolve(here, '../../../server/utils/solanaSplTokens.js'), 'utf8')
        expect(src).toMatch(new RegExp(`=\\s*${SOLANA_SERVER_CHAIN_ID}\\b`))
    })
})

describe('toServerChainId', () => {
    it('Solana kimligi -101 e cevrilir', () => {
        expect(toServerChainId('solana-mainnet')).toBe(-101)
    })

    it('EVM kimlikleri sayi olarak kalir (sayi ve metin)', () => {
        expect(toServerChainId(56)).toBe(56)
        expect(toServerChainId('56')).toBe(56)
    })

    it('TON kimligi aynen kalir', () => {
        expect(toServerChainId(-239)).toBe(-239)
    })

    it('cozulemeyen deger null doner (Number(null)===0 tuzagi dahil)', () => {
        expect(toServerChainId('xyz')).toBeNull()
        expect(toServerChainId(null)).toBeNull()
        expect(toServerChainId(undefined)).toBeNull()
        expect(toServerChainId('')).toBeNull()
        expect(toServerChainId(NaN)).toBeNull()
    })
})

describe('fromServerChainId', () => {
    it('-101 istemcinin Solana kimligine doner (sayi ve metin)', () => {
        expect(fromServerChainId(-101)).toBe('solana-mainnet')
        expect(fromServerChainId('-101')).toBe('solana-mainnet')
    })

    it('pozitif 101 EVM kalir (Solana ile karismaz)', () => {
        expect(fromServerChainId(101)).toBe(101)
    })

    it('TON ve EVM kimlikleri aynen doner', () => {
        expect(fromServerChainId(-239)).toBe(-239)
        expect(fromServerChainId(56)).toBe(56)
        expect(fromServerChainId('56')).toBe(56)
    })

    it('sonlu olmayan deger null doner', () => {
        expect(fromServerChainId(NaN)).toBeNull()
        expect(fromServerChainId(null)).toBeNull()
        expect(fromServerChainId(undefined)).toBeNull()
        expect(fromServerChainId('')).toBeNull()
        expect(fromServerChainId('abc')).toBeNull()
    })
})

describe('stampServerTokens', () => {
    const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

    it("sunucunun '0x0' SOL satirini atar", () => {
        const out = stampServerTokens([{ chainId: -101, address: '0x0', symbol: 'SOL' }])
        expect(out).toEqual([])
    })

    it("Solana USDC satirini 'solana-mainnet' damgalar", () => {
        const out = stampServerTokens([{ chainId: -101, address: USDC, symbol: 'USDC' }])
        expect(out).toHaveLength(1)
        expect(out[0].chainId).toBe('solana-mainnet')
        expect(out[0].address).toBe(USDC)
    })

    it('EVM 56 satiri aynen kalir; native EVM satiri ATILMAZ', () => {
        const out = stampServerTokens([
            { chainId: 56, address: '0xabc' },
            { chainId: 56, address: '0x0' },
        ])
        expect(out.map((r) => r.chainId)).toEqual([56, 56])
    })

    it('satirin chainId si yoksa fallback kullanilir', () => {
        const out = stampServerTokens([{ address: USDC }], -101)
        expect(out[0].chainId).toBe('solana-mainnet')
        const evm = stampServerTokens([{ address: '0xabc' }], '56')
        expect(evm[0].chainId).toBe(56)
    })

    it('chainId eksik ve fallback yoksa satir elenir', () => {
        expect(stampServerTokens([{ address: '0xabc' }])).toEqual([])
        expect(stampServerTokens([{ address: '0xabc', chainId: 'abc' }])).toEqual([])
    })

    it('girdiyi degistirmez; dizi olmayan girdide bos dizi doner', () => {
        const row = { chainId: -101, address: USDC }
        stampServerTokens([row])
        expect(row.chainId).toBe(-101)
        expect(stampServerTokens(undefined)).toEqual([])
        expect(stampServerTokens(null)).toEqual([])
    })

    it('dizideki gecersiz elemanlar (null, nesne olmayan) atlanir', () => {
        expect(stampServerTokens([null, 5, { chainId: 1, address: '0xa' }])).toHaveLength(1)
    })
})

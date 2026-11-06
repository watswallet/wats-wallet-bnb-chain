import { describe, it, expect } from 'vitest'
import { getAddress } from 'ethers'
import importedTokens from '../data/imported_tokens.json'
import { CHAIN_CONFIG } from './swapChains'
import { PAY_TOKENS } from './cow/config'
import { scanChains } from './evmUsageProbe'
import {
    MULTICALL3_ADDRESS,
    MULTICALL3_CHAIN_IDS,
    EVM_USAGE_TOKENS,
    MAX_USAGE_TOKENS_PER_CHAIN,
    usageTokenAddressesFor,
} from './evmUsageTokens'

const ZERO = '0x0000000000000000000000000000000000000000'
const lc = (a) => a.toLowerCase()

// Bu liste "bu adres kullanilmis mi" sorusunu etkiler: bir adres buraya EKLENIRSE bosta duran
// hesaplar kullanilmis sayilir. Bu yuzden liste testle KILITLI: degistirmek icin bu
// beklentiyi bilerek degistirmek gerekir.
const LOCKED = {
    1: ['USDT', 'USDC', 'DAI'],
    56: ['ATS', 'USDT', 'USDC'],
    10: ['USDC', 'USDT', 'DAI'],
    100: ['USDC', 'USDT'],
    42220: ['USDT', 'USDm', 'USDC'],
    5000: ['USDT', 'USDC', 'USDe'],
    8453: ['USDC', 'USDT', 'USDbC'],
    25: ['USDC', 'USDT', 'DAI'],
    42161: ['USDC', 'USDT', 'USDC.e'],
    137: ['USDT', 'USDC', 'USDC.e'],
}

describe('evmUsageTokens: sabit token listesi', () => {
    it('Multicall3 adresi bilinen kanonik adres (EIP-55)', () => {
        expect(MULTICALL3_ADDRESS).toBe('0xcA11bde05977b3631167028862bE2a173976CA11')
        expect(getAddress(MULTICALL3_ADDRESS)).toBe(MULTICALL3_ADDRESS)
    })

    it('liste 10 EVM aginin tamamini kapsar ve tam olarak KILITLI icerige esittir', () => {
        const actual = Object.fromEntries(
            Object.entries(EVM_USAGE_TOKENS).map(([id, list]) => [id, list.map((t) => t.symbol)])
        )
        expect(actual).toEqual(LOCKED)
    })

    it('liste, taranan 10 ag ile birebir ayni zincirlerden olusur', () => {
        const scanIds = scanChains().map((c) => c.chainId).sort((a, b) => a - b)
        const listIds = Object.keys(EVM_USAGE_TOKENS).map(Number).sort((a, b) => a - b)
        expect(listIds).toEqual(scanIds)
    })

    it('ag basina en cok MAX_USAGE_TOKENS_PER_CHAIN (6) ve en az 1 token', () => {
        expect(MAX_USAGE_TOKENS_PER_CHAIN).toBe(6)
        for (const [id, list] of Object.entries(EVM_USAGE_TOKENS)) {
            expect(list.length, `zincir ${id}`).toBeGreaterThanOrEqual(1)
            expect(list.length, `zincir ${id}`).toBeLessThanOrEqual(MAX_USAGE_TOKENS_PER_CHAIN)
        }
    })

    it('her adres gecerli EIP-55, sifir adres degil, zincir icinde tekrar yok', () => {
        for (const [id, list] of Object.entries(EVM_USAGE_TOKENS)) {
            const seen = new Set()
            for (const t of list) {
                expect(getAddress(t.address), `${id} ${t.symbol}`).toBe(t.address)
                expect(lc(t.address)).not.toBe(ZERO)
                expect(seen.has(lc(t.address)), `${id} ${t.symbol} tekrar`).toBe(false)
                seen.add(lc(t.address))
            }
        }
    })

    it('UYDURMA ADRES YOK: her adres depodaki dogrulanmis veride bulunur (swapChains ara tokenleri, CoW odeme tokenleri ya da varsayilan token tohumu)', () => {
        for (const [id, list] of Object.entries(EVM_USAGE_TOKENS)) {
            const known = new Set([
                ...(CHAIN_CONFIG[id]?.intermediates ?? []).map(lc),
                ...(PAY_TOKENS[id] ?? []).map((t) => lc(t.address)),
                ...(importedTokens[id] ?? []).map((t) => lc(t.address)),
            ])
            for (const t of list) {
                expect(known.has(lc(t.address)), `zincir ${id} ${t.symbol} ${t.address} depoda yok`).toBe(true)
            }
        }
    })

    it('sarmalanmis yerli tokenler (WETH/WBNB/WPOL...) listede YOK: yerli bakiye zaten eth_getBalance ile kontrol edilir', () => {
        for (const [id, list] of Object.entries(EVM_USAGE_TOKENS)) {
            const wrapped = lc(CHAIN_CONFIG[id].wrappedNative)
            expect(list.some((t) => lc(t.address) === wrapped), `zincir ${id}`).toBe(false)
        }
    })

    it("varsayilan token tohumundaki (imported_tokens.json) yerli olmayan her token listede VAR (USDT@1, ATS@56)", () => {
        for (const [id, defaults] of Object.entries(importedTokens)) {
            for (const d of defaults.filter((x) => lc(x.address) !== ZERO)) {
                const list = EVM_USAGE_TOKENS[id] ?? []
                expect(list.some((t) => lc(t.address) === lc(d.address)), `${id} ${d.symbol}`).toBe(true)
            }
        }
    })

    it('Multicall3, 10 agin hepsinde dogrulanmis (eth_getCode, 2026-11-03)', () => {
        expect([...MULTICALL3_CHAIN_IDS].sort((a, b) => a - b)).toEqual([1, 10, 25, 56, 100, 137, 5000, 8453, 42161, 42220])
    })

    it('usageTokenAddressesFor: bilinen zincirde adres dizisi, bilinmeyen zincirde bos dizi', () => {
        expect(usageTokenAddressesFor(1)).toEqual(EVM_USAGE_TOKENS[1].map((t) => t.address))
        expect(usageTokenAddressesFor('56')).toEqual(EVM_USAGE_TOKENS[56].map((t) => t.address))
        expect(usageTokenAddressesFor(999999)).toEqual([])
        expect(usageTokenAddressesFor(undefined)).toEqual([])
        expect(usageTokenAddressesFor(-239)).toEqual([])
    })

    it('Multicall3 dogrulanmamis bir zincir icin adres donmez (token yoklamasi atlanir)', () => {
        // Dogrulanan kumenin disinda olan her zincir bos doner; kume ile liste ayni anahtarlari paylasir.
        for (const id of Object.keys(EVM_USAGE_TOKENS)) {
            expect(MULTICALL3_CHAIN_IDS).toContain(Number(id))
        }
    })

    it('liste ve dizi donusleri dondurulmustur (calisma zamaninda degistirilemez)', () => {
        expect(Object.isFrozen(EVM_USAGE_TOKENS)).toBe(true)
        expect(Object.isFrozen(EVM_USAGE_TOKENS[1])).toBe(true)
        expect(Object.isFrozen(EVM_USAGE_TOKENS[1][0])).toBe(true)
        expect(Object.isFrozen(MULTICALL3_CHAIN_IDS)).toBe(true)
    })

    it('her zincirin token ADRESLERI birebir kilitli (adres degisirse kirmizi olur)', () => {
        const beklenen = {
        1: [
            ['USDT', '0xdac17f958d2ee523a2206206994597c13d831ec7'],
            ['USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
            ['DAI', '0x6b175474e89094c44da98b954eedeac495271d0f'],
        ],
        56: [
            ['ATS', '0x75d8bb7fbd4782a134211dc350ba5c715197b81d'],
            ['USDT', '0x55d398326f99059ff775485246999027b3197955'],
            ['USDC', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'],
        ],
        10: [
            ['USDC', '0x0b2c639c533813f4aa9d7837caf62653d097ff85'],
            ['USDT', '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58'],
            ['DAI', '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1'],
        ],
        100: [
            ['USDC', '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83'],
            ['USDT', '0x4ecaba5870353805a9f068101a40e0f32ed605c6'],
        ],
        42220: [
            ['USDT', '0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e'],
            ['USDm', '0x765de816845861e75a25fca122bb6898b8b1282a'],
            ['USDC', '0xceba9300f2b948710d2653dd7b07f33a8b32118c'],
        ],
        5000: [
            ['USDT', '0x201eba5cc46d216ce6dc03f6a759e8e766e956ae'],
            ['USDC', '0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9'],
            ['USDe', '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34'],
        ],
        8453: [
            ['USDC', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
            ['USDT', '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2'],
            ['USDbC', '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca'],
        ],
        25: [
            ['USDC', '0xc21223249ca28397b4b6541dffaecc539bff0c59'],
            ['USDT', '0x66e428c3f67a68878562e79a0234c1f83c208770'],
            ['DAI', '0xf2001b145b43032aaf5ee2884e456ccd805f677d'],
        ],
        42161: [
            ['USDC', '0xaf88d065e77c8cc2239327c5edb3a432268e5831'],
            ['USDT', '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9'],
            ['USDC.e', '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8'],
        ],
        137: [
            ['USDT', '0xc2132d05d31c914a87c6611c10748aeb04b58e8f'],
            ['USDC', '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'],
            ['USDC.e', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'],
        ],
        }
        // Zincir kumesi birebir ayni: sessizce yeni zincir eklenemez/cikarilamaz.
        expect(Object.keys(EVM_USAGE_TOKENS).sort()).toEqual(Object.keys(beklenen).sort())
        for (const [id, tokens] of Object.entries(beklenen)) {
            const gercek = EVM_USAGE_TOKENS[id].map((t) => [t.symbol, lc(t.address)])
            expect(gercek, 'zincir ' + id).toEqual(tokens)
        }
    })
})

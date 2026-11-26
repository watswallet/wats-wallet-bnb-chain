// payTokens.js -- RWA (hisse) teklifinde "diger taraf" olabilen odeme tokenleri (Bolum 2, Gorev 5).
// Saf modul: ag, chrome ve zincir okumasi yok. Ondaliklar bu tablodan gelir; sunucudaki tabloyla (server/data/evmStablecoins.js)
// ayrisirsa 6 ondalikli token 18 ondalikla cevrilir ve amountIn 10^12 kat buyur: bu dosya ayrismayi yakalar.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { getAddress, ZeroAddress } from 'ethers'
import { LCX_PAY_TOKENS, lcxPayToken } from './payTokens.js'
import { LCX_CHAIN_IDS } from './select.js'

const require = createRequire(import.meta.url)
const { EVM_STABLECOINS } = require('../../../../server/data/evmStablecoins.js')

const NATIVE_SYMBOLS = { 1: 'ETH', 56: 'BNB', 10: 'ETH', 137: 'POL', 42161: 'ETH', 8453: 'ETH', 100: 'XDAI', 25: 'CRO' }

describe('LCX_PAY_TOKENS tablosu', () => {
    it('LCX nin sekiz agini kapsar, baska ag yok', () => {
        expect(Object.keys(LCX_PAY_TOKENS).map(Number).sort((a, b) => a - b)).toEqual([...LCX_CHAIN_IDS].sort((a, b) => a - b))
    })

    it('her agda sira USDC, USDT, native; native isaretcisi 0x0, 18 ondalik, native: true', () => {
        for (const chainId of LCX_CHAIN_IDS) {
            const rows = LCX_PAY_TOKENS[chainId]
            expect(rows, `ag ${chainId}`).toHaveLength(3)
            expect(rows[0].symbol.toUpperCase().startsWith('USDC'), `ag ${chainId} ilk satir USDC`).toBe(true)
            expect(rows[1].symbol, `ag ${chainId} ikinci satir USDT`).toBe('USDT')
            expect(rows[2]).toEqual({ symbol: NATIVE_SYMBOLS[chainId], address: '0x0', decimals: 18, native: true })
            expect(rows[0].native, `ag ${chainId}`).toBeUndefined()
            expect(rows[1].native, `ag ${chainId}`).toBeUndefined()
        }
    })

    it('Gnosis USDC sembolu USDC.e; digerleri USDC', () => {
        expect(LCX_PAY_TOKENS[100][0].symbol).toBe('USDC.e')
        for (const chainId of LCX_CHAIN_IDS.filter((c) => c !== 100)) expect(LCX_PAY_TOKENS[chainId][0].symbol).toBe('USDC')
    })

    it('BSC stablecoinleri 18, digerleri 6 ondalik', () => {
        for (const chainId of LCX_CHAIN_IDS) {
            for (const row of LCX_PAY_TOKENS[chainId].filter((r) => !r.native)) {
                expect(row.decimals, `ag ${chainId} ${row.symbol}`).toBe(chainId === 56 ? 18 : 6)
            }
        }
    })

    it('adresler checksum biciminde', () => {
        for (const chainId of LCX_CHAIN_IDS) {
            for (const row of LCX_PAY_TOKENS[chainId].filter((r) => !r.native)) expect(row.address).toBe(getAddress(row.address))
        }
    })

    it('SUNUCU TABLOSUYLA BIREBIR: adres, ondalik ve sembol (server/data/evmStablecoins.js)', () => {
        for (const chainId of LCX_CHAIN_IDS) {
            const server = EVM_STABLECOINS[chainId]
            expect(server, `sunucuda ag ${chainId}`).toBeTruthy()
            const [usdc, usdt] = LCX_PAY_TOKENS[chainId]
            // Sunucuda sira USDT, USDC; ikisi de sembolle bulunur (Gnosis USDC.e sunucuda usdc.e).
            const sUsdc = server.find((r) => r.symbol.startsWith('usdc'))
            const sUsdt = server.find((r) => r.symbol === 'usdt')
            expect(sUsdc && sUsdt, `sunucuda ag ${chainId} USDC ve USDT`).toBeTruthy()
            expect(usdc.address.toLowerCase(), `ag ${chainId} USDC adresi`).toBe(sUsdc.address.toLowerCase())
            expect(usdc.decimals, `ag ${chainId} USDC ondaligi`).toBe(sUsdc.decimals)
            expect(usdc.symbol.toLowerCase(), `ag ${chainId} USDC sembolu`).toBe(sUsdc.symbol)
            expect(usdt.address.toLowerCase(), `ag ${chainId} USDT adresi`).toBe(sUsdt.address.toLowerCase())
            expect(usdt.decimals, `ag ${chainId} USDT ondaligi`).toBe(sUsdt.decimals)
            expect(usdt.symbol.toLowerCase(), `ag ${chainId} USDT sembolu`).toBe(sUsdt.symbol)
        }
    })

    it('tablo ve her satir dondurulmustur', () => {
        expect(Object.isFrozen(LCX_PAY_TOKENS)).toBe(true)
        for (const chainId of LCX_CHAIN_IDS) {
            expect(Object.isFrozen(LCX_PAY_TOKENS[chainId])).toBe(true)
            for (const row of LCX_PAY_TOKENS[chainId]) expect(Object.isFrozen(row)).toBe(true)
        }
    })
})

describe('lcxPayToken', () => {
    const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    const BASE_USDT = '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2'

    it('USDC ve USDT: checksum, kucuk ve buyuk harf yazimi ayni satiri verir', () => {
        for (const form of [BASE_USDC, BASE_USDC.toLowerCase(), `0x${BASE_USDC.slice(2).toUpperCase()}`]) {
            expect(lcxPayToken(8453, form), form).toBe(LCX_PAY_TOKENS[8453][0])
        }
        expect(lcxPayToken(8453, BASE_USDT)).toBe(LCX_PAY_TOKENS[8453][1])
    })

    it('native: uc isaretci bicimi de native satirini verir', () => {
        for (const form of ['0x0', ZeroAddress, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee']) {
            expect(lcxPayToken(8453, form), form).toBe(LCX_PAY_TOKENS[8453][2])
        }
        expect(lcxPayToken(56, '0x0').symbol).toBe('BNB')
        expect(lcxPayToken(137, '0x0').symbol).toBe('POL')
    })

    it('tablo disi ve bos girdi null: baska token, baska agin USDC si, bilinmeyen ag, bos / dize olmayan adres', () => {
        expect(lcxPayToken(8453, '0x4200000000000000000000000000000000000006')).toBeNull() // WETH
        expect(lcxPayToken(8453, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBeNull() // Ethereum USDC, Base da degil
        expect(lcxPayToken(42220, BASE_USDC)).toBeNull()
        expect(lcxPayToken(42220, '0x0')).toBeNull() // Celo LCX agi degil
        // isNativeAsset null / '' i native sayar (Send akisi); takasta eksik adres native SAYILMAZ.
        for (const bad of [null, undefined, '', '   ', 5, {}, [], true]) expect(lcxPayToken(8453, bad), String(bad)).toBeNull()
        expect(lcxPayToken(undefined, BASE_USDC)).toBeNull()
        expect(lcxPayToken('8453', BASE_USDC)).toBeNull() // zincir sayi olmali
    })

    it('Object prototipi ad tuzagi yok (constructor / __proto__ zinciri)', () => {
        expect(lcxPayToken('constructor', BASE_USDC)).toBeNull()
        expect(lcxPayToken('__proto__', BASE_USDC)).toBeNull()
    })
})

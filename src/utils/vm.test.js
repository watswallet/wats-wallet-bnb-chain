import { describe, it, expect } from 'vitest'
import { chainVm, isSameChainId, rpcUrlsOf, requireEvmChain, requireEvmVm } from './vm'

const EVM_CHAIN = { chainId: 1, rpc: [{ url: 'https://eth.example' }] }
const SOLANA_CHAIN = { chainId: 'solana-mainnet', vm: 'solana' }

describe('chainVm', () => {
    it("vm alani yoksa EVM sayilir - mevcut 10 zincir dokunulmadan gecer", () => {
        expect(chainVm(EVM_CHAIN)).toBe('evm')
        expect(chainVm({})).toBe('evm')
        expect(chainVm(null)).toBe('evm')
    })

    it("vm: 'solana' Solana'dir", () => {
        expect(chainVm(SOLANA_CHAIN)).toBe('solana')
    })

    it('bilinmeyen vm degeri EVM sayilir - bilinmeyeni ozel yola sokmak sessiz cokme uretir', () => {
        expect(chainVm({ vm: 'bitcoin' })).toBe('evm')
    })
})

describe('isSameChainId', () => {
    it('sayisal kimlikler bicimden bagimsiz eslesir', () => {
        expect(isSameChainId(1, '1')).toBe(true)
        expect(isSameChainId(56, 56)).toBe(true)
        expect(isSameChainId(1, 56)).toBe(false)
    })

    it('metin kimlik kendisiyle eslesir, sayiyla eslesmez', () => {
        expect(isSameChainId('solana-mainnet', 'solana-mainnet')).toBe(true)
        expect(isSameChainId('solana-mainnet', 1)).toBe(false)
        expect(isSameChainId('solana-mainnet', 0)).toBe(false)
    })

    // Number(null) === Number(0) TRUE'dur. Kontrolsuz birakilirsa cozulememis
    // bir zincir (null) chainId 0 ile eslesir.
    it('null / undefined hicbir seyle eslesmez', () => {
        expect(isSameChainId(null, 0)).toBe(false)
        expect(isSameChainId(undefined, 0)).toBe(false)
        expect(isSameChainId(null, null)).toBe(false)
        expect(isSameChainId(0, null)).toBe(false)
    })

    // Number('') === 0. Bos dize bir kimlik DEGILDIR.
    it('bos dize sayiya cevrilmez', () => {
        expect(isSameChainId('', 0)).toBe(false)
        expect(isSameChainId('   ', 0)).toBe(false)
    })

    it('boolean sayiya cevrilmez', () => {
        expect(isSameChainId(true, 1)).toBe(false)
    })
})

describe('rpcUrlsOf', () => {
    it('EVM zincirinin uclarini dizi olarak verir', () => {
        expect(rpcUrlsOf(EVM_CHAIN)).toEqual(['https://eth.example'])
    })

    // repairNetworkData mirasi: rpc alani nesne de olabiliyor.
    it('rpc nesne bicimindeyse de calisir', () => {
        expect(rpcUrlsOf({ chainId: 1, rpc: { a: { url: 'https://x' } } })).toEqual(['https://x'])
    })

    // Solana kaydinda rpc BILEREK yok: hicbir JsonRpcProvider acilamasin.
    it('Solana icin bos dizi - cagiran dogal "RPC yok" yoluna girer', () => {
        expect(rpcUrlsOf(SOLANA_CHAIN)).toEqual([])
        expect(rpcUrlsOf(null)).toEqual([])
        expect(rpcUrlsOf({ chainId: 1 })).toEqual([])
    })

    it('url alani olmayan kayitlar elenir', () => {
        expect(rpcUrlsOf({ chainId: 1, rpc: [{}, { url: 'https://y' }] })).toEqual(['https://y'])
    })
})

describe('requireEvmChain', () => {
    it('EVM zincirini oldugu gibi geri verir', () => {
        expect(requireEvmChain(EVM_CHAIN)).toBe(EVM_CHAIN)
    })

    it('Solana CHAIN_NOT_EVM ile reddedilir', () => {
        expect(() => requireEvmChain(SOLANA_CHAIN)).toThrow('CHAIN_NOT_EVM')
    })

    it('RPC ucu olmayan EVM kaydi da reddedilir', () => {
        expect(() => requireEvmChain({ chainId: 1, rpc: [] })).toThrow('CHAIN_NOT_EVM')
        expect(() => requireEvmChain(null)).toThrow('CHAIN_NOT_EVM')
    })
})

// KOD INCELEMESI (turu 2, A): IKI KAPI, IKI AYRI SORU. Olculdu: tek kapi
// (requireEvmChain) uc noktasi da istedigi icin, `rpc` dizisi BOS olan GERCEK bir
// EVM kaydinda dapp giris noktalari CHAIN_NOT_EVM donuyordu -- Task 15 ONCESINDE
// ayni kayitla dapp NORMAL calisiyordu, ve evmGates.js'in `dapp`/`buy`/`ats`
// bayraklari da (arayuz tarafi) o kayitta ACIK diyor. Asagidaki iki test bu
// AYRIMIN KENDISIDIR: ayni kayit kimlik kapisindan GECER, uc noktasi kapisinda
// DUSER. Ikisi ayni kosula geri dondurulurse biri KESIN duser.
describe('requireEvmVm (kimlik kapisi) ile requireEvmChain (uc noktasi kapisi) AYRISIR', () => {
    const RPCSIZ_EVM = { chainId: 137, name: 'Polygon', rpc: [] }

    it('RPC ucu OLMAYAN EVM kaydi kimlik kapisindan GECER', () => {
        expect(requireEvmVm(RPCSIZ_EVM)).toBe(RPCSIZ_EVM)
        expect(requireEvmVm({ chainId: 1, name: 'Ethereum' })).toBeTruthy()
    })

    it('AYNI kayit uc noktasi kapisinda CHAIN_NOT_EVM ile DUSER', () => {
        expect(() => requireEvmChain(RPCSIZ_EVM)).toThrow('CHAIN_NOT_EVM')
    })

    it('Solana ve cozulemeyen zincir HER IKI kapida da reddedilir', () => {
        expect(() => requireEvmVm(SOLANA_CHAIN)).toThrow('CHAIN_NOT_EVM')
        expect(() => requireEvmVm(null)).toThrow('CHAIN_NOT_EVM')
        expect(() => requireEvmVm(undefined)).toThrow('CHAIN_NOT_EVM')
        expect(() => requireEvmChain(SOLANA_CHAIN)).toThrow('CHAIN_NOT_EVM')
        expect(() => requireEvmChain(null)).toThrow('CHAIN_NOT_EVM')
    })

    it('RPC ucu OLAN EVM kaydi HER IKI kapidan da gecer', () => {
        expect(requireEvmVm(EVM_CHAIN)).toBe(EVM_CHAIN)
        expect(requireEvmChain(EVM_CHAIN)).toBe(EVM_CHAIN)
    })
})

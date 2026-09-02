import { describe, it, expect } from 'vitest'
import supported_chains from '../data/supported_chains.json'
import { SOLANA_CHAIN_ID } from './solana/constants'
import { chainVm, rpcUrlsOf, isSameChainId } from './vm'
import { chainIdForSlug, nativeOwnerChainIds } from './chainIdentity'
import { explorerTxUrl, explorerSlug } from './explorer'

const solana = supported_chains.find(c => c.chainId === SOLANA_CHAIN_ID)

describe('Solana zincir kaydi', () => {
    it('supported_chains icinde var', () => {
        expect(solana).toBeDefined()
        expect(solana.name).toBe('Solana')
        expect(chainVm(solana)).toBe('solana')
    })

    // rpc alani BILEREK yok: boylece hicbir JsonRpcProvider Solana icin acilamaz.
    it('rpc alani YOKTUR', () => {
        expect(solana.rpc).toBeUndefined()
        expect(rpcUrlsOf(solana)).toEqual([])
    })

    it('native para 9 ondalikli SOL', () => {
        expect(solana.nativeCurrency).toEqual({ name: 'Solana', symbol: 'SOL', decimals: 9 })
    })

    it('chainId METINDIR ve hicbir EVM kimligiyle cakismaz', () => {
        expect(typeof solana.chainId).toBe('string')
        const evmIds = supported_chains.filter(c => c !== solana).map(c => c.chainId)
        expect(evmIds.every(id => !isSameChainId(id, SOLANA_CHAIN_ID))).toBe(true)
    })

    it('mevcut 10 EVM zinciri bozulmadi', () => {
        const evm = supported_chains.filter(c => chainVm(c) === 'evm')
        expect(evm).toHaveLength(10)
        expect(evm.every(c => rpcUrlsOf(c).length > 0)).toBe(true)

        // Review Bulgu 7: yalniz SAYI (10) ve rpc VARLIGI yeterli degil — chainId,
        // chainSlug ya da nativeCoingeckoId'den biri yanlislikla degisse (ör. Solana
        // eklenirken kopyala-yapistir kazasi) arity kontrolu bunu HIC yakalamazdi.
        // Bu parmak izi on kaydin KIMLIGINI tek tek kilitler.
        const fingerprint = (c) => ({ chainId: c.chainId, chainSlug: c.chainSlug, nativeCoingeckoId: c.nativeCoingeckoId })
        expect(evm.map(fingerprint).sort((a, b) => a.chainId - b.chainId)).toEqual([
            { chainId: 1, chainSlug: 'ethereum', nativeCoingeckoId: 'ethereum' },
            { chainId: 10, chainSlug: 'optimistic-ethereum', nativeCoingeckoId: 'ethereum' },
            { chainId: 25, chainSlug: 'cronos', nativeCoingeckoId: 'crypto-com-chain' },
            { chainId: 56, chainSlug: 'binance-smart-chain', nativeCoingeckoId: 'binancecoin' },
            { chainId: 100, chainSlug: 'xdai', nativeCoingeckoId: 'xdai' },
            { chainId: 137, chainSlug: 'polygon-pos', nativeCoingeckoId: 'polygon-ecosystem-token' },
            { chainId: 5000, chainSlug: 'mantle', nativeCoingeckoId: 'mantle' },
            { chainId: 8453, chainSlug: 'base', nativeCoingeckoId: 'ethereum' },
            { chainId: 42161, chainSlug: 'arbitrum-one', nativeCoingeckoId: 'ethereum' },
            { chainId: 42220, chainSlug: 'celo', nativeCoingeckoId: 'celo' },
        ])
    })
})

describe('chainIdentity — Solana', () => {
    // chainIdForSlug Number(entry.chainId) donuyordu: Solana icin NaN olurdu ve
    // NaN hicbir karsilastirmayi gecmez.
    it('slug cozumlemesi metin kimligi bozmadan dondurur', () => {
        expect(chainIdForSlug('solana')).toBe(SOLANA_CHAIN_ID)
    })

    it('EVM slug cozumlemesi hala SAYI dondurur', () => {
        expect(chainIdForSlug('ethereum')).toBe(1)
    })

    // Duzeltilmezse SOL kendi zincirinde 'foreign-asset' sayilir ve gonderim kilitlenir.
    it("'solana' coingecko_id'si Solana zincirinin native'idir", () => {
        expect(nativeOwnerChainIds('solana')).toEqual([SOLANA_CHAIN_ID])
    })

    it('ETH hala dort zincirin native i', () => {
        expect(nativeOwnerChainIds('ethereum').sort()).toEqual([1, 10, 8453, 42161].sort())
    })
})

describe('explorer — Solana', () => {
    it('Solana islemi solscan e gider', () => {
        expect(explorerTxUrl(SOLANA_CHAIN_ID, '5xy')).toBe('https://solscan.io/tx/5xy')
    })

    it('EVM islemi mevcut gezginde kalir', () => {
        expect(explorerTxUrl(1, '0xabc')).toBe('https://scan.alltoscan.com/tx/ethereum/0xabc')
    })

    it('hash yoksa arama sayfasina duser', () => {
        expect(explorerTxUrl(SOLANA_CHAIN_ID, null)).toContain('search')

        // Review Bulgu 7: yukaridaki satir `!hash` erken donusunde biter ve Solana
        // dalina HIC UGRAMAZ — kayit tamamen SILINSE bile ayni sonucu dondururdu.
        // explorerSlug hash'e bakmaz, yalniz chainId cozumlemesini (chainRecord)
        // sinar; bu satir Solana kaydinin GERCEKTEN bulundugunu kilitler.
        expect(explorerSlug(SOLANA_CHAIN_ID)).toBe('solana')
    })
})

import { describe, it, expect } from 'vitest'
import { privateOrderDelivery } from './orderDelivery'

const v2 = (dest, extra = {}) => ({ deliveryVersion: 2, summary: { payoutUsdc: '14.85', dest }, ...extra })
const BASE = { chainId: 8453, asset: 'USDC', decimals: 6, expectedDestAmount: '14787310', minDestAmount: '14346647', quoteUsd: 14.78 }
const ANAHTARLAR = ['deliveryChainId', 'estimated', 'expectedAmount', 'outputAsset']

describe('privateOrderDelivery: surum 2 kaydi (spec 4.3 okuma kurallari)', () => {
    it('Base USDC: ag, sembol ve tutar kayittaki SECIMDEN gelir (6 ondalik)', () => {
        expect(privateOrderDelivery(v2(BASE))).toEqual({ deliveryChainId: 8453, outputAsset: 'USDC', expectedAmount: '14.78731', estimated: true })
    })

    it('Arbitrum yerel coin (18 ondalik) ve BSC USDC (ag 56 acikca yazili)', () => {
        const eth = { chainId: 42161, asset: 'ETH', decimals: 18, expectedDestAmount: '6153854783951967', minDestAmount: '5970469911390198' }
        expect(privateOrderDelivery(v2(eth))).toEqual({ deliveryChainId: 42161, outputAsset: 'ETH', expectedAmount: '0.006153854783951967', estimated: true })
        const bsc = { chainId: 56, asset: 'USDC', decimals: 18, expectedDestAmount: '24650000000000000000', minDestAmount: '24000000000000000000' }
        expect(privateOrderDelivery(v2(bsc))).toEqual({ deliveryChainId: 56, outputAsset: 'USDC', expectedAmount: '24.65', estimated: true })
    })

    it('ondalik uc degerleri: 0 ve 36 ondalik', () => {
        expect(privateOrderDelivery(v2({ ...BASE, asset: 'ZRO', decimals: 0, expectedDestAmount: '6' })).expectedAmount).toBe('6')
        expect(privateOrderDelivery(v2({ ...BASE, asset: 'BIG', decimals: 36, expectedDestAmount: '1500000000000000000000000000000000000' })).expectedAmount).toBe('1.5')
    })

    // D5: bozuk zincir kimligi satiri "BSC" yapmaz; para yanlis aga gitmis gibi gosterilmez ve rozet cizilmez.
    it('bozuk ya da tabloda olmayan chainId deliveryChainId: null verir ve ASLA 56ya dusmez; sembol ve tutar kalir', () => {
        for (const chainId of [undefined, null, '', 'abc', 'Base', 0, -1, 8453.5, 99999, 43114, '8453 ', '08453', {}, [8453], NaN]) {
            const r = privateOrderDelivery(v2({ ...BASE, chainId }))
            expect(r.deliveryChainId, JSON.stringify(chainId) ?? String(chainId)).toBeNull()
            expect(r).toMatchObject({ outputAsset: 'USDC', expectedAmount: '14.78731', estimated: true })
        }
        expect(privateOrderDelivery(v2({ ...BASE, chainId: '8453' })).deliveryChainId).toBe(8453)
    })

    // "BNB" ya da "USDC" yedegi YOKTUR: bozuk kayit sembol ve tutar gostermez.
    it('asset ya da decimals eksik/bozuksa outputAsset ve expectedAmount null (BNB/USDC yedegi yok); ag korunur', () => {
        for (const asset of [undefined, null, '', '   ', 5, {}]) {
            expect(privateOrderDelivery(v2({ ...BASE, asset })), JSON.stringify(asset) ?? String(asset)).toEqual({ deliveryChainId: 8453, outputAsset: null, expectedAmount: null, estimated: true })
        }
        for (const decimals of [undefined, null, '6', 1.5, -1, 37, NaN, {}]) {
            expect(privateOrderDelivery(v2({ ...BASE, decimals })), JSON.stringify(decimals) ?? String(decimals)).toEqual({ deliveryChainId: 8453, outputAsset: null, expectedAmount: null, estimated: true })
        }
    })

    it('dest yok, null ya da nesne degil: tum alanlar null (eski yola DUSMEZ)', () => {
        for (const dest of [undefined, null, 'x', 5]) {
            expect(privateOrderDelivery(v2(dest)), String(dest)).toEqual({ deliveryChainId: null, outputAsset: null, expectedAmount: null, estimated: true })
        }
        expect(privateOrderDelivery({ deliveryVersion: 2 })).toEqual({ deliveryChainId: null, outputAsset: null, expectedAmount: null, estimated: true })
    })

    it('beklenen tutar okunamazsa expectedAmount null, sembol ve ag kalir (bos tutar 0.0 degil BILINMEYEN)', () => {
        for (const expectedDestAmount of [undefined, null, '', '   ', 'abc', '1.5', '-']) {
            expect(privateOrderDelivery(v2({ ...BASE, expectedDestAmount })), String(expectedDestAmount)).toEqual({ deliveryChainId: 8453, outputAsset: 'USDC', expectedAmount: null, estimated: true })
        }
    })
})

describe('privateOrderDelivery: surumsuz (eski, kalici) kayit: acik eski-kayit yolu', () => {
    it('dest yok: BSC USDC kesin tutar (payoutUsdc), tahmin degil', () => {
        expect(privateOrderDelivery({ summary: { payoutUsdc: '25.0' } })).toEqual({ deliveryChainId: 56, outputAsset: 'USDC', expectedAmount: '25.0', estimated: false })
        expect(privateOrderDelivery({ summary: {} })).toEqual({ deliveryChainId: 56, outputAsset: 'USDC', expectedAmount: null, estimated: false })
        expect(privateOrderDelivery({})).toEqual({ deliveryChainId: 56, outputAsset: 'USDC', expectedAmount: null, estimated: false })
        expect(privateOrderDelivery(null)).toEqual({ deliveryChainId: 56, outputAsset: 'USDC', expectedAmount: null, estimated: false })
    })

    it('dest var ama asset yok: eski BNB teslimi (o tarihten once dest yalniz BNB icin gonderiliyordu); tutar 18 ondalik', () => {
        const r = privateOrderDelivery({ summary: { payoutUsdc: '25.0', dest: { expectedDestAmount: '40000000000000000', minDestAmount: '39000000000000000' } } })
        expect(r).toEqual({ deliveryChainId: 56, outputAsset: 'BNB', expectedAmount: '0.04', estimated: true })
    })

    it('dest.asset ve decimals varsa onlar kullanilir (CAKE 18, XYZ 6); chainId alani okunmaz, ag 56', () => {
        const cake = privateOrderDelivery({ summary: { dest: { asset: 'CAKE', decimals: 18, expectedDestAmount: '6555238737484223626', chainId: 8453 } } })
        expect(cake).toEqual({ deliveryChainId: 56, outputAsset: 'CAKE', expectedAmount: '6.555238737484223626', estimated: true })
        expect(privateOrderDelivery({ summary: { dest: { asset: 'XYZ', decimals: 6, expectedDestAmount: '1500000' } } }).expectedAmount).toBe('1.5')
    })

    it('eski kayitta okunamayan tutar null kalir (bos tutar BILINMEYEN)', () => {
        for (const expectedDestAmount of [undefined, '', 'abc']) {
            expect(privateOrderDelivery({ summary: { dest: { expectedDestAmount } } }), String(expectedDestAmount)).toEqual({ deliveryChainId: 56, outputAsset: 'BNB', expectedAmount: null, estimated: true })
        }
    })
})

describe('privateOrderDelivery: bilinmeyen surum ve cikti bicimi', () => {
    // 2 disindaki bir surum guvenle okunamaz: eski sayilip 56'ya DUSURULMEZ.
    it('deliveryVersion 2 degilse (ve yok degilse) hicbir alan uydurulmaz', () => {
        for (const deliveryVersion of [1, 3, '2', 0, true, {}]) {
            expect(privateOrderDelivery({ deliveryVersion, summary: { payoutUsdc: '25.0', dest: BASE } }), JSON.stringify(deliveryVersion))
                .toEqual({ deliveryChainId: null, outputAsset: null, expectedAmount: null, estimated: true })
        }
    })

    it('deliveryVersion null eski kayit sayilir (alan yok ile ayni)', () => {
        expect(privateOrderDelivery({ deliveryVersion: null, summary: { payoutUsdc: '25.0' } })).toMatchObject({ deliveryChainId: 56, outputAsset: 'USDC' })
    })

    it('her durumda dort anahtar, JSON guvenli (BigInt/undefined yok)', () => {
        for (const order of [v2(BASE), v2(null), { summary: { payoutUsdc: '1' } }, { deliveryVersion: 9 }, null, undefined]) {
            const r = privateOrderDelivery(order)
            expect(Object.keys(r).sort()).toEqual(ANAHTARLAR)
            expect(JSON.parse(JSON.stringify(r))).toEqual(r)
        }
    })
})

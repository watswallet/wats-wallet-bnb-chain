import { describe, it, expect } from 'vitest'
import { rowTokenRecord, shortAssetLabel } from './tokenRowRecord'

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'

describe('shortAssetLabel', () => {
    it('ilk 4 + son 4 (useSolanaAssets shortMint ile AYNI bicim)', () => {
        expect(shortAssetLabel(MINT)).toBe('DezX...B263')
    })

    // Base58 buyuk/kucuk harf duyarli: etiket uretmek onu DEGISTIRMEZ.
    it('harf kasasini DEGISTIRMEZ', () => {
        expect(shortAssetLabel(MINT)).toBe(`${MINT.slice(0, 4)}...${MINT.slice(-4)}`)
        expect(shortAssetLabel(MINT)).not.toBe(shortAssetLabel(MINT).toLowerCase())
    })

    it('kisa/bos girdide kirpmaz, patlamaz', () => {
        expect(shortAssetLabel('0x0')).toBe('0x0')
        expect(shortAssetLabel(undefined)).toBe('')
    })
})

describe('rowTokenRecord', () => {
    it('adres YOKSA null doner (cagiran akisi surdurmemeli)', () => {
        expect(rowTokenRecord(null)).toBeNull()
        expect(rowTokenRecord(undefined)).toBeNull()
        expect(rowTokenRecord({ chainId: 'solana-mainnet' })).toBeNull()
        expect(rowTokenRecord({ address: '' })).toBeNull()
    })

    it('satirin kimligini AYNEN tasir', () => {
        const r = rowTokenRecord({ chainId: 'solana-mainnet', address: MINT, decimals: 5, symbol: 'BONK' })
        expect(r.chainId).toBe('solana-mainnet')
        expect(r.address).toBe(MINT)
        expect(r.decimals).toBe(5)
        expect(r.symbol).toBe('BONK')
    })

    // Sablon `token?.market_data.priceUSD` yaziyor: optional chaining YALNIZCA
    // ilk halkayi korur. market_data eksik bir NESNE butun ekrani cokertirdi.
    it('market_data TAM SEKILLI uretilir (sablon cokmesin)', () => {
        const r = rowTokenRecord({ chainId: 1, address: '0xabc' })
        expect(r.market_data.priceUSD).toBe(0)
        expect(r.market_data.change.h24).toBe(0)
        expect(r.market_data.sparkline.d7).toEqual([])
        expect(r.image.thumb).toBe('')
        for (const k of ['market_cap', 'volume', 'circulating_supply', 'ath', 'atl']) {
            expect(r.market_data[k], k).toBe(0)
        }
    })

    it('sembol yoksa etiket ADRESTEN turetilir (isimsiz satir olmaz)', () => {
        expect(rowTokenRecord({ chainId: 'solana-mainnet', address: MINT }).symbol).toBe('DezX...B263')
    })

    // Ondalik TAHMIN EDILMEZ: alan hic yazilmaz ki Send.vue'nun kendi
    // `?? SOL_DECIMALS` varsayilani devreye girsin.
    it('ondalik bilinmiyorsa alan HIC yazilmaz', () => {
        const r = rowTokenRecord({ chainId: 'solana-mainnet', address: MINT })
        expect('decimals' in r).toBe(false)
        expect(rowTokenRecord({ chainId: 1, address: '0xabc', decimals: '6' })).not.toHaveProperty('decimals')
    })

    it('coingecko_id ACIKCA null (grafik "yok" der, "yukleniyor" degil)', () => {
        expect(rowTokenRecord({ chainId: 1, address: '0xabc' }).coingecko_id).toBeNull()
    })
})

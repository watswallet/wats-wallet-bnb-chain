import { describe, it, expect } from 'vitest'
import { normalizeBucketChainId, normalizeKeyAddress, tokenBucketKey, dedupeTokenRows } from './homeTokenBucket'
import { SOLANA_CHAIN_ID } from './solana/constants'

describe('normalizeBucketChainId', () => {
    // Home.vue `chainId: Number(chainId)` yaziyordu: Solana kovasi 'NaN' olur ve
    // SPL tokenlar listeden sessizce duserdi.
    it('sayisal kova anahtarlari SAYI olur', () => {
        expect(normalizeBucketChainId('1')).toBe(1)
        expect(normalizeBucketChainId(56)).toBe(56)
    })

    it('metin kova anahtari OLDUGU GIBI kalir', () => {
        expect(normalizeBucketChainId(SOLANA_CHAIN_ID)).toBe(SOLANA_CHAIN_ID)
        expect(Number.isNaN(normalizeBucketChainId(SOLANA_CHAIN_ID))).toBe(false)
    })
})

describe('tokenBucketKey', () => {
    it('chainId ve adresi birlestirir', () => {
        expect(tokenBucketKey(1, '0xabc')).toBe('1_0xabc')
        expect(tokenBucketKey(SOLANA_CHAIN_ID, 'native')).toBe('solana-mainnet_native')
    })

    // Base58 buyuk/kucuk harf duyarli: anahtar kucultulurse iki farkli token
    // ayni koveya duser ve bakiyeler birbirinin ustune yazilir.
    it('adres harf kasasi KORUNUR', () => {
        expect(tokenBucketKey(SOLANA_CHAIN_ID, 'MintAbC')).toBe('solana-mainnet_MintAbC')
    })
})

describe('normalizeKeyAddress', () => {
    // EVM: checksum bir GOSTERIM bicimidir, kimligin parcasi degildir. Ayni
    // adres depodan checksum'li, arka uctan kucuk harfli gelebiliyor; anahtar
    // uzayinda ikisi AYNI kayit olmali (yoksa liste tokeni iki kez gosterir).
    it('0x ile baslayan adres KUCULTULUR', () => {
        expect(normalizeKeyAddress('0xAbCdEf')).toBe('0xabcdef')
        expect(normalizeKeyAddress('0XABC')).toBe('0xabc')
    })

    // KOD INCELEMESI (Bulgu 3): SEMBOL dali. `balanceKey` buraya bir TICKER da
    // gecirebiliyor (SearchTokens.vue:43/86 `address || symbol`). Eski kod onu
    // KOSULSUZ kucultuyordu; artik kucultmuyor ve bu ACIK bir karar: 'USDT'
    // bicimce gecerli bir base58 dizesidir, yani sembolu katlayan her kural bir
    // mint'i de katlar. Bu test tam da DEGISEN dali kilitler.
    it('SEMBOL katlanmaz (eski kosulsuz kucultmeden BILEREK ayrilir)', () => {
        const eski = (a) => String(a ?? '').toLowerCase()

        expect(normalizeKeyAddress('USDT')).toBe('USDT')
        expect(normalizeKeyAddress('USDT')).not.toBe(eski('USDT'))
        expect(normalizeKeyAddress('BonkSOL')).toBe('BonkSOL')
    })

    // Base58 alfabesinde '0' YOKTUR: bir Solana adresi bu dala hic giremez.
    it('base58 mint OLDUGU GIBI kalir', () => {
        expect(normalizeKeyAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'))
            .toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
        expect(normalizeKeyAddress('MintAbC')).toBe('MintAbC')
    })

    it('null/undefined bos dizgeye duser (anahtar uretimi patlamaz)', () => {
        expect(normalizeKeyAddress(undefined)).toBe('')
        expect(normalizeKeyAddress(null)).toBe('')
    })
})

describe('dedupeTokenRows', () => {
    it('preferred icindeki bir anahtarla CAKISAN base satiri ELENIR', () => {
        const base = [{ chainId: 'solana-mainnet', address: 'MintAbC', amount: 0 }]
        const preferred = [{ chainId: 'solana-mainnet', address: 'MintAbC', amount: 12.5 }]

        const merged = dedupeTokenRows(base, preferred)

        expect(merged).toHaveLength(1)
        expect(merged[0].amount).toBe(12.5)
    })

    // Kullanicinin SAHIP OLMADIGI ice aktarilmis bir token (base'de var, preferred'de
    // YOK) etkilenmemeli -- davranis eskisiyle AYNI kalir.
    it('preferred de OLMAYAN base satiri OLDUGU GIBI korunur', () => {
        const base = [{ chainId: 'solana-mainnet', address: 'MintOnlyImported', amount: 0 }]
        const preferred = [{ chainId: 'solana-mainnet', address: 'MintHeld', amount: 5 }]

        const merged = dedupeTokenRows(base, preferred)

        expect(merged).toHaveLength(2)
        expect(merged.map((r) => r.address).sort()).toEqual(['MintHeld', 'MintOnlyImported'])
    })

    // EVM kovalari Solana rows ile ASLA ayni anahtara sahip olamaz (farkli
    // chainId), yani EVM tarafi bu fonksiyondan HIC etkilenmemeli.
    it('farkli chainId li satirlar birbirini ELEMEZ (EVM regresyonu)', () => {
        const base = [{ chainId: 1, address: '0xabc', amount: 10 }]
        const preferred = [{ chainId: 'solana-mainnet', address: '0xabc', amount: 5 }]

        const merged = dedupeTokenRows(base, preferred)

        expect(merged).toHaveLength(2)
    })

    it('harf kasasi FARKLI olan ayni mint AYNI anahtar SAYILMAZ (base58 duyarli)', () => {
        const base = [{ chainId: 'solana-mainnet', address: 'MintAbC', amount: 0 }]
        const preferred = [{ chainId: 'solana-mainnet', address: 'mintabc', amount: 5 }]

        const merged = dedupeTokenRows(base, preferred)

        expect(merged).toHaveLength(2)
    })

    it('bos/gecersiz girdilerde patlamaz', () => {
        expect(dedupeTokenRows(null, null)).toEqual([])
        expect(dedupeTokenRows(undefined, [{ chainId: 1, address: '0xabc' }])).toEqual([{ chainId: 1, address: '0xabc' }])
    })
})

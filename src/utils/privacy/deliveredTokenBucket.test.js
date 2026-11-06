import { describe, it, expect } from 'vitest'
import { getAddress } from 'ethers'
import { addDeliveredTokenToPrivateBucket } from './deliveredTokenBucket'
import { usdcTokenOf, nativeTokenOf } from './deliveryTokens'

const CAKE = { chainId: 56, address: getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'), symbol: 'CAKE', decimals: 18 }
const PRIV = 'g-1'
const ATS = { name: 'ATS', symbol: 'ATS', decimals: 18, address: getAddress('0x' + 'a7'.repeat(20)), image: { thumb: '', small: '', large: '' }, coingecko_id: 'ats' }
const BNB_ROW = { name: 'BNB', symbol: 'BNB', decimals: 18, address: '0x0000000000000000000000000000000000000000', image: {}, coingecko_id: 'binancecoin' }
const ETH_ROW = { name: 'ETH', symbol: 'ETH', decimals: 18, address: '0x0', image: {}, coingecko_id: 'ethereum' }

// Bellek ici depo: yalniz get/set (chrome.storage.local ile ayni imza).
function fakeStorage(initial) {
    const data = { ...initial }
    return {
        data,
        get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, data[k]])),
        set: async (obj) => { Object.assign(data, obj) },
    }
}
const seeded = () => ({ imported_tokens: { [PRIV]: { 1: [], 56: [ATS, BNB_ROW] }, 'a-1': { 56: [ATS] } } })
const SATIR = (t, ad = t.symbol) => ({ name: ad, symbol: t.symbol, decimals: t.decimals, address: t.address, image: { thumb: '', small: '', large: '' }, chain: null, coingecko_id: null })

describe('addDeliveredTokenToPrivateBucket (teslim tokeni Gizli Hesap listesinde gorunsun)', () => {
    it('ImportToken ile ayni bicimde yalniz Gizli Hesabin BSC kovasina ekler; baska hesaba dokunmaz', async () => {
        const storage = fakeStorage(seeded())
        const onceki = storage.data.imported_tokens['a-1']
        const sonuc = await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: CAKE, storage })
        expect(sonuc).toBe('added')
        expect(storage.data.imported_tokens[PRIV][56]).toEqual([ATS, BNB_ROW, SATIR(CAKE)])
        // diger zincir anahtari ve diger hesap AYNEN kalir
        expect(storage.data.imported_tokens[PRIV][1]).toEqual([])
        expect(storage.data.imported_tokens['a-1']).toBe(onceki)
    })

    it('USDC (varsayilan teslim) de eklenir: varsayilan tohumda yok', async () => {
        const storage = fakeStorage(seeded())
        expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: usdcTokenOf(56), storage })).toBe('added')
        expect(storage.data.imported_tokens[PRIV][56].map((t) => t.symbol)).toEqual(['ATS', 'BNB', 'USDC'])
    })

    // K5: kova anahtari token'in agidir. Base'e teslim edilen token Base kovasina yazilir, BSC kovasina DEGIL.
    it('kova anahtari token agindan gelir: Base USDC ve CAKE yalniz 8453 kovasina yazilir (yoksa olusturulur)', async () => {
        const storage = fakeStorage(seeded())
        expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: usdcTokenOf(8453), storage })).toBe('added')
        expect(storage.data.imported_tokens[PRIV][8453]).toEqual([SATIR(usdcTokenOf(8453), 'USDC')])
        expect(storage.data.imported_tokens[PRIV][56]).toEqual([ATS, BNB_ROW])
        expect(storage.data.imported_tokens[PRIV][1]).toEqual([])
        // ayni sozlesme adresi baska agda baska bir token: iki ayri kovada iki ayri satir
        await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: CAKE, storage })
        await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: { ...CAKE, chainId: 8453 }, storage })
        expect(storage.data.imported_tokens[PRIV][56].map((t) => t.symbol)).toEqual(['ATS', 'BNB', 'CAKE'])
        expect(storage.data.imported_tokens[PRIV][8453].map((t) => t.symbol)).toEqual(['USDC', 'CAKE'])
    })

    // Yerel coin artik kabul edilir (P12, spec 4.7): Base'e gelen ETH "kayboldu" gorunmesin.
    it('yerel coin o agin kovasina yazilir (ETH Base kovasina, sembol tablodan, sifir adres) ve ikinci kez eklenmez', async () => {
        const storage = fakeStorage(seeded())
        const eth = nativeTokenOf(8453)
        expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: eth, storage })).toBe('added')
        expect(storage.data.imported_tokens[PRIV][8453]).toEqual([{
            name: 'ETH', symbol: 'ETH', decimals: 18, address: '0x0000000000000000000000000000000000000000',
            image: { thumb: '', small: '', large: '' }, chain: null, coingecko_id: null,
        }])
        expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: eth, storage })).toBe('skipped')
        expect(storage.data.imported_tokens[PRIV][8453]).toHaveLength(1)
    })

    it('yerel coin isNativeAsset ile tekil: kovada sifir adresli, "0x0" ya da 0xeeee... yerel satir varsa eklenmez', async () => {
        for (const yerel of [BNB_ROW, { ...BNB_ROW, address: '0x0' }, { ...BNB_ROW, address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' }]) {
            const storage = fakeStorage({ imported_tokens: { [PRIV]: { 56: [ATS, yerel] } } })
            expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: nativeTokenOf(56), storage }), yerel.address).toBe('skipped')
            expect(storage.data.imported_tokens[PRIV][56]).toEqual([ATS, yerel])
        }
        const eth = fakeStorage({ imported_tokens: { [PRIV]: { 1: [ATS], 8453: [ETH_ROW] } } })
        expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: nativeTokenOf(8453), storage: eth })).toBe('skipped')
    })

    it('kovada yerel coin yoksa BSC BNB de eklenir (eski "BNB eklenmez" atlamasi kalkti)', async () => {
        const storage = fakeStorage({ imported_tokens: { [PRIV]: { 56: [ATS] } } })
        expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: nativeTokenOf(56), storage })).toBe('added')
        expect(storage.data.imported_tokens[PRIV][56].map((t) => t.symbol)).toEqual(['ATS', 'BNB'])
    })

    it('adresi olmayan (bozuk) kova satiri yerel coin tekillestirmesini bozmaz', async () => {
        const storage = fakeStorage({ imported_tokens: { [PRIV]: { 56: [ATS, { symbol: 'X' }, null] } } })
        expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: nativeTokenOf(56), storage })).toBe('added')
    })

    it('kovada zaten olan token (harf boyutu fark etmez) ikinci kez eklenmez; varsayilan ATS dahil', async () => {
        const storage = fakeStorage(seeded())
        const upper = { chainId: 56, address: ATS.address.toLowerCase(), symbol: 'ATS', decimals: 18 }
        expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: upper, storage })).toBe('skipped')
        await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: CAKE, storage })
        expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: { ...CAKE, address: CAKE.address.toLowerCase() }, storage })).toBe('skipped')
        expect(storage.data.imported_tokens[PRIV][56]).toHaveLength(3)
    })

    it('kova varsayilan bekliyorsa (1/56 anahtari yok) YAZILMAZ: varsayilan tohum kapisi kapanmasin', async () => {
        for (const bucket of [undefined, {}, { '-239': [] }, []]) {
            const storage = fakeStorage({ imported_tokens: bucket === undefined ? {} : { [PRIV]: bucket } })
            expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: CAKE, storage })).toBe('skipped')
            expect(storage.data.imported_tokens[PRIV]).toEqual(bucket)
        }
        const bos = fakeStorage({})
        expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: CAKE, storage: bos })).toBe('skipped')
        expect(bos.data.imported_tokens).toBeUndefined()
    })

    it('hesap anahtari ya da token bozuksa (chainId yok dahil) hicbir sey yazmaz ve firlatmaz', async () => {
        const storage = fakeStorage(seeded())
        const once = JSON.stringify(storage.data)
        const { chainId, ...chainIdsiz } = CAKE
        for (const args of [
            { privateAccountKey: null, token: CAKE },
            { privateAccountKey: '', token: CAKE },
            { privateAccountKey: PRIV, token: null },
            { privateAccountKey: PRIV, token: chainIdsiz },
            { privateAccountKey: PRIV, token: { ...CAKE, chainId: 99999 } },
            { privateAccountKey: PRIV, token: { chainId: 56, address: 'x', symbol: 'Q', decimals: 18 } },
            { privateAccountKey: PRIV, token: { ...CAKE, decimals: 99 } },
        ]) expect(await addDeliveredTokenToPrivateBucket({ ...args, storage })).toBe('skipped')
        expect(JSON.stringify(storage.data)).toBe(once)
    })

    it('hisse tokeni (bStock/xStock) Gizli Hesap kovasina ASLA yazilmaz', async () => {
        const storage = fakeStorage(seeded())
        const onceki = structuredClone(storage.data.imported_tokens)
        for (const token of [
            { chainId: 56, address: getAddress('0x80f3D493EBCe97e343c53D29a137942416B4ffC0'), symbol: 'CRCLB', decimals: 18 },
            { chainId: 1, address: getAddress('0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0'), symbol: 'TSLAx', decimals: 18 },
        ]) {
            expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token, storage })).toBe('skipped')
        }
        expect(storage.data.imported_tokens).toEqual(onceki)
    })
    it('depo hata verirse firlatmaz', async () => {
        const storage = { get: async () => { throw new Error('depo yok') }, set: async () => {} }
        expect(await addDeliveredTokenToPrivateBucket({ privateAccountKey: PRIV, token: CAKE, storage })).toBe('failed')
    })
})

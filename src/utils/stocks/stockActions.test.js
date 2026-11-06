// T8: hisse detayindan Gonder'e devredilen varlik kaydi. Token.vue selectSend ile AYNI kimlik sozlesmesi:
// satir kimligi (chainId/address/decimals/symbol) + `market` alani (Send.vue USD tahmini) + bolunmus fiyat.
import { describe, it, expect } from 'vitest'
import { sendAssetFor } from './stockActions'
import { assetPriceUSD } from '../assetPrice'
import { companyRows } from './stockCompanies'

const rows = companyRows('AAPL', { xstocksEnabled: true })
const BS = rows.find((r) => r.issuer === 'bstocks')
const XS = rows.find((r) => r.issuer === 'xstocks')

const record = (row, priceUSD) => ({
    coingecko_id: row.coingeckoId,
    name: 'CoinGecko Adi',
    symbol: 'cg',
    image: { thumb: 't', small: 's', large: 'l' },
    market_data: { priceUSD, change: { h24: 1 }, sparkline: { d7: [priceUSD, priceUSD] } },
})
const refOf = (row) => ({ id: row.coingeckoId, chainId: row.chainId, address: row.address, decimals: row.decimals, symbol: row.symbol })

describe('sendAssetFor', () => {
    it('satir kimligi: chainId, address, decimals, symbol satirdan', () => {
        const a = sendAssetFor({ entry: BS, ref: refOf(BS), record: record(BS, 250), priceUsd: 250 })
        expect(a.chainId).toBe(BS.chainId)
        expect(a.address).toBe(BS.address)
        expect(a.decimals).toBe(BS.decimals)
        expect(a.symbol).toBe(BS.symbol)
    })

    it('ref tam sayi decimals ve sembol tasiyorsa onlar kazanir; yoksa katalog', () => {
        const a = sendAssetFor({ entry: BS, ref: { ...refOf(BS), decimals: 6, symbol: 'ZZZ' }, record: record(BS, 1), priceUsd: 1 })
        expect(a.decimals).toBe(6)
        expect(a.symbol).toBe('ZZZ')
        const b = sendAssetFor({ entry: BS, ref: { chainId: BS.chainId, address: BS.address }, record: record(BS, 1), priceUsd: 1 })
        expect(b.decimals).toBe(BS.decimals)
        expect(b.symbol).toBe(BS.symbol)
        const c = sendAssetFor({ entry: BS, ref: { ...refOf(BS), decimals: '8' }, record: null, priceUsd: null })
        expect(c.decimals).toBe(BS.decimals)
    })

    it('market alani: Send.vue USD tahmini icin priceUSD tasir (assetPriceUSD okur)', () => {
        const a = sendAssetFor({ entry: BS, ref: refOf(BS), record: record(BS, 248.31), priceUsd: 248.31 })
        expect(a.market.priceUSD).toBe(248.31)
        expect(assetPriceUSD(a)).toBe(248.31)
        expect(a.market_data).toEqual(a.market)
    })

    it('xStock: BOLUNMUS fiyat gider, ham fiyat degil; sparkline tasinmaz', () => {
        const a = sendAssetFor({ entry: XS, ref: refOf(XS), record: record(XS, 400), priceUsd: 200 })
        expect(assetPriceUSD(a)).toBe(200)
        expect(a.market.sparkline).toBeUndefined()
    })

    it('fiyat bilinmiyorsa priceUSD 0 -> assetPriceUSD null (tahmin yok), ham fiyata DUSULMEZ', () => {
        const a = sendAssetFor({ entry: XS, ref: refOf(XS), record: record(XS, 400), priceUsd: null })
        expect(a.market.priceUSD).toBe(0)
        expect(assetPriceUSD(a)).toBeNull()
    })

    it('kayit yoksa satirdan uretilir (tam sekilli, market_data cokmez)', () => {
        const a = sendAssetFor({ entry: BS, ref: refOf(BS), record: null, priceUsd: null })
        expect(a.address).toBe(BS.address)
        expect(a.market_data).toBeTruthy()
        expect(a.image).toBeTruthy()
        expect(a.name).toBeTruthy()
        expect(assetPriceUSD(a)).toBeNull()
    })

    it('kimlik katalog satirindan: kayitta farkli adres/zincir olsa da ezilir', () => {
        const a = sendAssetFor({ entry: BS, ref: refOf(BS), record: { ...record(BS, 1), chainId: 1, address: '0xdead' }, priceUsd: 1 })
        expect(a.chainId).toBe(BS.chainId)
        expect(a.address).toBe(BS.address)
    })

    it('entry yoksa null; gelen nesneler degistirilmez', () => {
        expect(sendAssetFor({ entry: null })).toBeNull()
        const rec = record(BS, 5)
        const snapshot = JSON.stringify(rec)
        sendAssetFor({ entry: XS, ref: refOf(XS), record: rec, priceUsd: 2 })
        expect(JSON.stringify(rec)).toBe(snapshot)
    })
})

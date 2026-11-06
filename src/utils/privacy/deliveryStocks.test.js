import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getAddress } from 'ethers'
import SERVER_LIST from '../../test-utils/serverTokenList.snapshot.json'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { BSTOCKS } from '../../data/bStocks'
import { XSTOCKS } from '../../data/xStocks'
import { isStockDeliveryToken } from './stockDelivery'
import { buildDeliveryTokenList } from './deliveryTokens'
import { DELIVERY_ONLY_XSTOCKS, DELIVERY_ONLY_BACKED, isDeliveryOnlyStock, hasStockIssuerMarker } from './deliveryStocks'
import { stockEntry, stocksByChain, isGeneralSwapExcluded, isBridgeBlocked, isBridgeTargetBlocked, hasUiMultiplier, XSTOCK_EXISTENCE_CHAIN_IDS } from '../tokenizedStocks'

// Gizli teslim filtresine ozel hisse listesi (deliveryStocks.js): sunucu listesindeki, ticaret katalogunda OLMAYAN 32 hisse (30 xStock Arbitrum,
// BCOIN ve BNIU Polygon). Sahip kurali (2026-10-23): tokenlastirilmis hisse hicbir kipte teslim tokeni olamaz.
const ARBITRUM = 42161
const POLYGON = 137
const STOCK_NAME = /xstock|^backed /i
const rowsWithMarker = () => Object.entries(SERVER_LIST.chains).flatMap(([chainId, list]) => list.filter((t) => STOCK_NAME.test(t.name)).map((t) => ({ ...t, chainId: Number(chainId) })))
const unknownToCatalog = (row) => stockEntry(row.chainId, row.address) === null && !isGeneralSwapExcluded(row.chainId, row.address)

describe('teslim filtresine ozel hisse listesi: sunucu listesindeki 32 katalog disi hisse', () => {
    it('liste tam 32 kayit: 30 Arbitrum xStock + Polygon BCOIN ve BNIU; sunucu listesindeki katalog-disi isaretli satirlarla birebir ayni kume', () => {
        expect(DELIVERY_ONLY_XSTOCKS).toHaveLength(30)
        expect(DELIVERY_ONLY_BACKED.map((t) => t.symbol).sort()).toEqual(['BCOIN', 'BNIU'])
        const unknown = rowsWithMarker().filter(unknownToCatalog)
        expect(unknown).toHaveLength(32)
        const fromList = new Set([
            ...DELIVERY_ONLY_XSTOCKS.map((t) => `${ARBITRUM}:${t.address}`),
            ...DELIVERY_ONLY_BACKED.map((t) => `${t.chainId}:${t.address}`),
        ])
        expect(new Set(unknown.map((t) => `${t.chainId}:${t.address.toLowerCase()}`))).toEqual(fromList)
    })

    it('32 kaydin her biri isStockDeliveryToken tarafindan (yalniz adres kuraliyla) hisse sayilir; adres harf boyutuna duyarsiz, chainId dizge de olur', () => {
        for (const t of DELIVERY_ONLY_XSTOCKS) {
            expect(isStockDeliveryToken(ARBITRUM, t.address), t.symbol).toBe(true)
            expect(isStockDeliveryToken(String(ARBITRUM), getAddress(t.address)), t.symbol).toBe(true)
            expect(isStockDeliveryToken(ARBITRUM, t.address.toUpperCase().replace('0X', '0x')), t.symbol).toBe(true)
        }
        for (const t of DELIVERY_ONLY_BACKED) {
            expect(isStockDeliveryToken(t.chainId, t.address), t.symbol).toBe(true)
            expect(isStockDeliveryToken(String(t.chainId), getAddress(t.address)), t.symbol).toBe(true)
        }
    })

    it('xStocks katalogunun kendi kurali gibi: var oldugu butun zincirlerde (Ethereum, BSC, Optimism, Mantle dahil) hisse; Polygon ve Base\'de xStock adresi degil', () => {
        for (const t of DELIVERY_ONLY_XSTOCKS) {
            for (const chainId of XSTOCK_EXISTENCE_CHAIN_IDS) expect(isStockDeliveryToken(chainId, t.address), `${t.symbol}@${chainId}`).toBe(true)
            for (const chainId of [POLYGON, 8453, 100, 42220, 25]) expect(isStockDeliveryToken(chainId, t.address), `${t.symbol}@${chainId}`).toBe(false)
        }
    })

    it('Backed Polygon tokenlari yalniz (137, adres) cifti: baska zincirde ayni adres hisse sayilmaz', () => {
        for (const t of DELIVERY_ONLY_BACKED) {
            expect(isDeliveryOnlyStock(POLYGON, t.address), t.symbol).toBe(true)
            for (const chainId of [1, 56, 8453, ARBITRUM, 10, 5000]) expect(isDeliveryOnlyStock(chainId, t.address), `${t.symbol}@${chainId}`).toBe(false)
        }
    })

    it('hisse olmayanlar kalir: Polygon\'daki ayni sembollu "Bomb Crypto" (bcoin), USDC, CAKE, sifir adres, bos/bozuk adres', () => {
        const bomb = SERVER_LIST.chains[String(POLYGON)].find((t) => t.name.startsWith('Bomb Crypto'))
        expect(bomb.symbol).toBe('bcoin')
        expect(isStockDeliveryToken(POLYGON, bomb.address)).toBe(false)
        expect(isDeliveryOnlyStock(POLYGON, bomb.address)).toBe(false)
        const cake = getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82')
        for (const [c, a] of [[56, cake], [ARBITRUM, '0x' + '99'.repeat(20)], [ARBITRUM, '0x0000000000000000000000000000000000000000'], [ARBITRUM, ''], [ARBITRUM, undefined], [ARBITRUM, 5]]) {
            expect(isDeliveryOnlyStock(c, a), `${c}:${a}`).toBe(false)
        }
    })

    it('snapshot: isaretli (xStock / Backed) her sunucu satiri hisse kuraliyla (adres) elenir ve secici listesinde HIC yok; her ag, bugunku 46 satir', () => {
        const rows = rowsWithMarker()
        expect(rows).toHaveLength(46)
        for (const row of rows) expect(isStockDeliveryToken(row.chainId, row.address), `${row.chainId}:${row.symbol}`).toBe(true)
        for (const chainId of Object.keys(SERVER_LIST.chains).map(Number)) {
            const list = buildDeliveryTokenList({ chainId, nativeEnabled: true, remote: SERVER_LIST.chains[String(chainId)] })
            const gone = new Set(rows.filter((r) => r.chainId === chainId).map((r) => r.address.toLowerCase()))
            expect(list.filter((t) => gone.has(t.address.toLowerCase())), String(chainId)).toEqual([])
        }
    })

    it('buildDeliveryTokenList: 32 hissenin her biri sunucu ya da ice aktarilan satir olarak atilir (adi isaretsiz de, logosu olsa da)', () => {
        const arb = DELIVERY_ONLY_XSTOCKS.map((t) => ({ address: t.address, symbol: t.symbol, name: 'Duz Ad', decimals: 18, image: { large: 'https://img.example/' + t.symbol + '.png' } }))
        const list = buildDeliveryTokenList({ chainId: ARBITRUM, nativeEnabled: true, remote: arb, imported: arb })
        expect(list.map((t) => t.symbol)).toEqual(['ETH', 'USDC'])
        const pol = DELIVERY_ONLY_BACKED.map((t) => ({ address: t.address, symbol: t.symbol, name: 'Duz Ad', decimals: 18 }))
        expect(buildDeliveryTokenList({ chainId: POLYGON, nativeEnabled: true, remote: pol, imported: pol }).map((t) => t.symbol)).toEqual(['POL', 'USDC'])
    })
})

describe('isaret agi: ihracci adlandirmasi (yalniz secici satirlari)', () => {
    it('"<Sirket> xStock" ve "Backed <Sirket>" adlari isaretli; ilgisiz adlar degil', () => {
        for (const name of ['Tesla xStock', 'Yeni Sirket xStock', '  Foo XSTOCK  ', 'Wrapped Tesla xStock', 'Backed Coinbase Global', 'backed Apple', 'Backed IB01 $ Treasury Bond 0-1yr']) {
            expect(hasStockIssuerMarker(name), name).toBe(true)
        }
        for (const name of ['Bomb Crypto (POL)', 'USD Coin', 'Tether USD', 'PancakeSwap', 'Backend Token', 'Unbacked Coin', 'xStockholm Coin', '', null, undefined, 5]) {
            expect(hasStockIssuerMarker(name), String(name)).toBe(false)
        }
    })

    it('katalogda ve listede olmayan YENI bir xStock / Backed satiri (sunucu yarin getirirse) secici listesine girmez; sade adli ve baska adli tokenlar kalir', () => {
        const yeni = [
            { address: '0x' + '12'.repeat(20), symbol: 'NEWx', name: 'NewCo xStock', decimals: 18 },
            { address: '0x' + '13'.repeat(20), symbol: 'bnew', name: 'Backed NewCo', decimals: 18 },
            { address: '0x' + '14'.repeat(20), symbol: 'CAKE', name: 'PancakeSwap', decimals: 18 },
            { address: '0x' + '15'.repeat(20), symbol: 'TSLAx', name: 'Sahte', decimals: 18 },
        ]
        const list = buildDeliveryTokenList({ chainId: ARBITRUM, nativeEnabled: true, remote: yeni, imported: [yeni[0]] })
        expect(list.map((t) => t.symbol.toUpperCase())).toEqual(['ETH', 'USDC', 'CAKE', 'TSLAX'])
    })
})

describe('normal mod hisse davranisi DEGISMEZ: ek liste ticaret katalogunun disinda', () => {
    it('32 hissenin hicbiri katalogda yok: stockEntry null, Takas/Kopru dislamasi ve olcekli arayuz kapalari eskisi gibi', () => {
        const all = [...DELIVERY_ONLY_XSTOCKS.map((t) => ({ chainId: ARBITRUM, address: t.address })), ...DELIVERY_ONLY_BACKED]
        expect(all).toHaveLength(32)
        for (const { chainId, address } of all) {
            expect(stockEntry(chainId, address), `${chainId}:${address}`).toBeNull()
            expect(isGeneralSwapExcluded(chainId, address), `${chainId}:${address}`).toBe(false)
            expect(isBridgeBlocked(chainId, address), `${chainId}:${address}`).toBe(false)
            expect(isBridgeTargetBlocked(chainId, address), `${chainId}:${address}`).toBe(false)
            expect(hasUiMultiplier(chainId, address), `${chainId}:${address}`).toBe(false)
        }
    })

    it('Hisseler sekmesi (stocksByChain) ek listedeki hicbir adresi icermez; satir sayisi katalog kadar (her ihracci icin katalogdaki kayit x zincir)', () => {
        const extra = new Set(DELIVERY_ONLY_XSTOCKS.map((t) => t.address).concat(DELIVERY_ONLY_BACKED.map((t) => t.address)))
        const groups = stocksByChain({ includeXstocks: true })
        const rows = groups.flatMap((g) => g.rows)
        expect(rows.filter((r) => extra.has(r.address.toLowerCase()))).toEqual([])
        expect(groups.map((g) => g.chainId).sort((a, b) => a - b)).toEqual([1, 56, 42161])
        expect(rows.filter((r) => r.issuer === 'bstocks')).toHaveLength(BSTOCKS.length)
        expect(rows.filter((r) => r.issuer === 'xstocks')).toHaveLength(XSTOCKS.reduce((n, t) => n + t.chains.length, 0))
    })

    it('tek yonlu bagimlilik: tokenizedStocks.js ve veri dosyalari deliveryStocks.js\'i ice aktarmaz; yalniz stockDelivery.js ve deliveryTokens.js eder', () => {
        const oku = (yol) => yorumsuz(readFileSync(fileURLToPath(new URL(yol, import.meta.url)), 'utf8'))
        for (const yol of ['../tokenizedStocks.js', '../../data/xStocks.js', '../../data/bStocks.js']) expect(oku(yol), yol).not.toMatch(/deliveryStocks/)
        expect(oku('./stockDelivery.js')).toMatch(/from '\.\/deliveryStocks'/)
        expect(oku('./deliveryTokens.js')).toMatch(/from '\.\/deliveryStocks'/)
        // Dosya saf: tek ice aktarma saf katalogdan (popup paketine girebilir).
        expect([...oku('./deliveryStocks.js').matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])).toEqual(['../tokenizedStocks'])
    })
})

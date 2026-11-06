// privateHomeScope.js -- Gizli modda Home'un sorgu kumesi (S), yerel coin satiri ve siralama.
// Saf katman: ag, depo, chrome yok (gizli-mod cok-ag spec 4.7).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import {
    privateScopeChainId, rowsOfChain, withScopeNativeRow, comparePrivateRows, hideLogolessZeroRows,
} from './privateHomeScope'

const ZERO = '0x0000000000000000000000000000000000000000'
const satir = (chainId, symbol, address = '0x' + symbol.toLowerCase().padEnd(40, '0').slice(0, 40)) => ({ chainId, symbol, address })

describe('privateScopeChainId -- kapsam degerinden S', () => {
    it('sayi ve rakam dizgesi SAYIYA doner', () => {
        expect(privateScopeChainId(56)).toBe(56)
        expect(privateScopeChainId('137')).toBe(137)
    })

    it("'all', bos ve metin kimlik (Solana) null: Gizli Hesap EVM-yalnizdir, bilinmeyen kapsam sorgulanmaz (fail-closed)", () => {
        for (const girdi of ['all', null, undefined, 'solana-mainnet', '', 'abc']) expect(privateScopeChainId(girdi), String(girdi)).toBeNull()
    })
})

describe('rowsOfChain -- yalniz S zincirinin satirlari', () => {
    it('chainId tipi sayi/dizge farkini yok sayar ve baska aglari eler', () => {
        const rows = [satir(56, 'AAA'), satir('56', 'BBB'), satir(1, 'CCC'), satir(137, 'DDD')]
        expect(rowsOfChain(rows, 56).map((r) => r.symbol)).toEqual(['AAA', 'BBB'])
    })

    it('S yok (null/undefined) ya da girdi dizi degilse bos doner, firlatmaz', () => {
        expect(rowsOfChain([satir(56, 'AAA')], null)).toEqual([])
        expect(rowsOfChain([satir(56, 'AAA')], undefined)).toEqual([])
        expect(rowsOfChain(null, 56)).toEqual([])
        expect(rowsOfChain(undefined, 56)).toEqual([])
    })
})

describe('withScopeNativeRow -- S icin yerel coin satiri yoksa uretilir', () => {
    it('Base (8453): kovada yerel coin satiri yok -> ETH satiri eklenir, yerel logolu, fiyat kimligi yok', () => {
        const sonuc = withScopeNativeRow([satir(8453, 'USDC')], 8453)
        expect(sonuc).toHaveLength(2)
        const eth = sonuc[1]
        expect(eth.symbol).toBe('ETH')
        expect(eth.chainId).toBe(8453)
        expect(eth.coingecko_id).toBeNull()
        // Base'te ETH: ETH elmasi, Base zincir logosu degil (coin logosu kurali, privateCoinLogo.js).
        expect(eth.image.large).toBe('/chains/1.png')
        expect(eth.amount).toBe(0)
    })

    it('sifir adresli sunucu satiri VARSA (isNativeAsset ile) ikinci satir eklenmez, AYNI dizi doner', () => {
        const rows = [{ chainId: 56, symbol: 'bnb', address: ZERO }, satir(56, 'ATS')]
        expect(withScopeNativeRow(rows, 56)).toBe(rows)
    })

    it('baska agin yerel coin satiri S icin SAYILMAZ (ayni 0x0 adresi her agda native)', () => {
        const rows = [{ chainId: 1, symbol: 'ETH', address: '0x0' }]
        const sonuc = withScopeNativeRow(rows, 56)
        expect(sonuc).toHaveLength(2)
        expect(sonuc[1].symbol).toBe('BNB')
    })

    it('S null ya da cozulemeyen ag: liste degismez; girdi dizi degilse bos dizi doner', () => {
        const rows = [satir(56, 'ATS')]
        expect(withScopeNativeRow(rows, null)).toBe(rows)
        expect(withScopeNativeRow(rows, 'solana-mainnet')).toBe(rows)
        expect(withScopeNativeRow(undefined, 56)).toHaveLength(1)
    })

    it('girdi dizisini DEGISTIRMEZ', () => {
        const rows = [satir(8453, 'USDC')]
        withScopeNativeRow(rows, 8453)
        expect(rows).toHaveLength(1)
    })
})

describe('comparePrivateRows -- yerel coin once, sonra sembol A-Z', () => {
    it('yerel coin her zaman basta; kalanlar sembole gore, buyuk/kucuk harf farksiz', () => {
        const rows = [satir(56, 'usdc'), satir(56, 'ATS'), { chainId: 56, symbol: 'BNB', address: '0x0' }, satir(56, 'cake')]
        expect([...rows].sort(comparePrivateRows).map((r) => r.symbol)).toEqual(['BNB', 'ATS', 'cake', 'usdc'])
    })

    it('ayni sembolde adrese gore SABIT sirali (karar tutarli)', () => {
        const a = { chainId: 56, symbol: 'X', address: '0x' + 'a'.repeat(40) }
        const b = { chainId: 56, symbol: 'X', address: '0x' + 'b'.repeat(40) }
        expect([b, a].sort(comparePrivateRows)).toEqual([a, b])
        expect(comparePrivateRows(a, { ...a })).toBe(0)
    })

    it('eksik alanli satirlar firlatmaz', () => {
        expect(() => [{}, null, { symbol: 'A' }, undefined].sort(comparePrivateRows)).not.toThrow()
    })
})

describe('hideLogolessZeroRows -- logosuz + KESIN sifir bakiyeli satir gizlenir, para asla', () => {
    const LOGOLU = { chainId: 56, symbol: 'CAKE', address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82' } // paketli
    const LOGOSUZ = { chainId: 56, symbol: 'NOLOGO', address: '0x' + '42'.repeat(20) }
    const USDC = { chainId: 56, symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' }
    const BNB = { chainId: 56, symbol: 'BNB', address: '0x0' }
    const bakiye = (b) => () => b

    it('logosuz satir KESIN sifir bakiyede gizlenir (sayi, dizge, ondalikli sifir)', () => {
        for (const amount of [0, '0', '0.0', '0.000000', ' 0 ']) expect(hideLogolessZeroRows([LOGOSUZ], bakiye({ amount })), JSON.stringify(amount)).toEqual([])
    })

    it('logosuz satir bakiyesi VARSA, okunamiyorsa ya da henuz yuklenmediyse GORUNUR kalir (belirsizlik para gizlemez)', () => {
        for (const entry of [{ amount: 5 }, { amount: '0.0000001' }, { amount: '12' }, { amount: 0, error: true }, { error: 'rpc' }, {}, { amount: undefined }, { amount: '' }, { amount: null }, { amount: 'NaN' }, undefined, null]) {
            expect(hideLogolessZeroRows([LOGOSUZ], bakiye(entry)), JSON.stringify(entry)).toEqual([LOGOSUZ])
        }
        // balanceOf hic verilmediyse de gizlenmez
        expect(hideLogolessZeroRows([LOGOSUZ])).toEqual([LOGOSUZ])
    })

    it('logolu satir sifir bakiyede de GORUNUR (yalniz logosuzlar elenir); yerel coin ve USDC her zaman logolu', () => {
        for (const row of [LOGOLU, USDC, BNB]) expect(hideLogolessZeroRows([row], bakiye({ amount: 0 })), row.symbol).toEqual([row])
    })

    it('karisik liste: sira korunur, girdi degismez, dizi olmayan girdi bos dizi', () => {
        const rows = [BNB, LOGOSUZ, LOGOLU, { ...LOGOSUZ, symbol: 'PARALI', address: '0x' + '43'.repeat(20) }, USDC]
        const copy = rows.slice()
        const out = hideLogolessZeroRows(rows, (r) => (r.symbol === 'PARALI' ? { amount: '3' } : { amount: 0 }))
        expect(out.map((r) => r.symbol)).toEqual(['BNB', 'CAKE', 'PARALI', 'USDC'])
        expect(rows).toEqual(copy)
        for (const bad of [null, undefined, 'x', {}, 5]) expect(hideLogolessZeroRows(bad, bakiye({ amount: 0 }))).toEqual([])
    })

    it('eksik alanli satirlar firlatmaz', () => {
        expect(() => hideLogolessZeroRows([{}, null, { symbol: 'A' }, undefined], bakiye({ amount: 0 }))).not.toThrow()
    })
})

describe('privateHomeScope -- ag ve depo yok', () => {
    it('axios, fetch, chrome, sendMessage kullanmaz', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./privateHomeScope.js', import.meta.url)), 'utf8'))
        expect(kaynak).not.toMatch(/\baxios\b|\bfetch\s*\(|\bchrome\b|sendMessage|@silentswap/)
    })
})

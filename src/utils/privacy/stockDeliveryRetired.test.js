// KOK NEDEN / KAPATILAN HATA (K28, K42; main senkronu 22f4f686 denetimi, madde A):
// Gizli modda tokenlastirilmis hisse teslimi YASAKTIR (sahip karari 2026-10-23) ve arka plan bunu `isStockDeliveryToken` ile
// teklif / siparis ANINDA reddeder. Fonksiyon yalniz KATALOGU (stockEntry), xStocks dislama kumesini ve teslim-ozel listeyi
// sorardi: katalogdan CIKMIS (emekli) hisseler -- bStocks BMNRB / FLNCB ve xStocks ADBEx / PYPLx / STRCx -- hisse sayilmazdi,
// yani gizli Takas / Kopru / Para yukle / Gonder teslimi onlari saglayiciya kadar goturebilirdi. Cikti tarafi ihraccisi
// (`stockOutputIssuer`, kapinin KENDI aramasi) ile ayni kume artik teslimde de yasaktir.
import { describe, it, expect } from 'vitest'
import { getAddress } from 'ethers'
import { isStockDeliveryToken } from './stockDelivery'
import { RETIRED_BSTOCKS } from '../../data/bStocksRetired'
import { RETIRED_XSTOCKS } from '../../data/xStocksRetired'
import { BSTOCKS_CHAIN_ID } from '../../data/bStocks'
import { XSTOCK_EXISTENCE_CHAIN_IDS, stockEntry, stockOutputIssuer } from '../tokenizedStocks'
import { DELIVERY_ONLY_XSTOCKS, DELIVERY_ONLY_BACKED } from './deliveryStocks'

const CAKE = getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82')

describe('isStockDeliveryToken -- emekli hisseler de hisse sayilir (K28, K42)', () => {
    it('pozitif bekci: emekli listeler dolu ve KATALOG DEGIL (yalniz cikti tarafi ihraccisi tanir)', () => {
        expect(RETIRED_BSTOCKS.map((r) => r.symbol)).toEqual(['BMNRB', 'FLNCB'])
        expect(RETIRED_XSTOCKS.length).toBeGreaterThanOrEqual(3)
        for (const r of RETIRED_BSTOCKS) {
            expect(stockEntry(BSTOCKS_CHAIN_ID, r.address), r.symbol).toBeNull()
            expect(stockOutputIssuer(BSTOCKS_CHAIN_ID, r.address), r.symbol).toBe('bstocks')
        }
        for (const r of RETIRED_XSTOCKS) {
            expect(stockEntry(1, r.address), r.symbol).toBeNull()
            expect(stockOutputIssuer(1, r.address), r.symbol).toBe('xstocks')
        }
    })

    it('emekli bStocks (BMNRB, FLNCB) BSC teslim tokeni olamaz; adres yazimi (kucuk / buyuk / checksum) fark etmez', () => {
        for (const r of RETIRED_BSTOCKS) {
            for (const adres of [r.address, r.address.toLowerCase(), `0x${r.address.slice(2).toUpperCase()}`, getAddress(r.address.toLowerCase())]) {
                expect(isStockDeliveryToken(BSTOCKS_CHAIN_ID, adres), `${r.symbol} ${adres}`).toBe(true)
                expect(isStockDeliveryToken(String(BSTOCKS_CHAIN_ID), adres), `${r.symbol} "56" ${adres}`).toBe(true)
            }
        }
    })

    it('emekli xStocks (ADBEx, PYPLx, STRCx) xStocks un var oldugu her zincirde teslim tokeni olamaz', () => {
        for (const r of RETIRED_XSTOCKS) {
            for (const zincir of XSTOCK_EXISTENCE_CHAIN_IDS) {
                expect(isStockDeliveryToken(zincir, r.address), `${r.symbol}@${zincir}`).toBe(true)
                expect(isStockDeliveryToken(zincir, r.address.toLowerCase()), `${r.symbol}@${zincir} kucuk`).toBe(true)
            }
        }
    })

    it('kapsam zincire bagli: emekli bStocks adresi BSC disinda, emekli xStocks adresi var olmadigi zincirde (Base, Polygon) hisse sayilmaz', () => {
        for (const r of RETIRED_BSTOCKS) expect(isStockDeliveryToken(8453, r.address), r.symbol).toBe(false)
        for (const r of RETIRED_XSTOCKS) {
            expect(isStockDeliveryToken(8453, r.address), r.symbol).toBe(false)
            expect(isStockDeliveryToken(137, r.address), r.symbol).toBe(false)
        }
    })

    it('hisse olmayanlar etkilenmez: CAKE, rastgele adres, sifir adres; adres yoksa ya da dizge degilse false', () => {
        expect(isStockDeliveryToken(56, CAKE)).toBe(false)
        expect(isStockDeliveryToken(56, getAddress('0x' + '99'.repeat(20)))).toBe(false)
        expect(isStockDeliveryToken(56, '0x0000000000000000000000000000000000000000')).toBe(false)
        expect(isStockDeliveryToken(56, undefined)).toBe(false)
        expect(isStockDeliveryToken(56, 5)).toBe(false)
    })

    // main senkron B-F1: 0x on eki olmayan 40 onaltili hane ya da kenar bosluk yazimi, tum hisse kumelerinde (emekli, katalog,
    // teslim-ozel Arbitrum xStocks, Polygon Backed) ayni sonucu vermeli; aksi halde yazim degisikligi gizli teslim yasagini atlatir.
    it('adres yazimi: 0x on eki olmayan ya da kenar bosluklu adres de hisse sayilir (emekli, teslim-ozel, Polygon Backed)', () => {
        const yazimlar = (adres) => [adres.slice(2), adres.slice(2).toUpperCase(), `  ${adres} `, ` ${adres.slice(2)}\n`]
        const durumlar = [
            ...RETIRED_BSTOCKS.map((r) => [`emekli ${r.symbol}`, BSTOCKS_CHAIN_ID, r.address]),
            ...RETIRED_XSTOCKS.map((r) => [`emekli ${r.symbol}`, 1, r.address]),
            ...DELIVERY_ONLY_XSTOCKS.slice(0, 3).map((t) => [`teslim-ozel ${t.symbol}`, 42161, t.address]),
            ...DELIVERY_ONLY_BACKED.map((t) => [`Backed ${t.symbol}`, t.chainId, t.address]),
        ]
        expect(durumlar.length).toBeGreaterThanOrEqual(8)
        for (const [ad, zincir, adres] of durumlar) {
            expect(isStockDeliveryToken(zincir, adres), `${ad} kanonik`).toBe(true)
            for (const yazim of yazimlar(adres)) expect(isStockDeliveryToken(zincir, yazim), `${ad} [${JSON.stringify(yazim)}]`).toBe(true)
        }
        // yanlis pozitif yok: hisse olmayan adres 0x'siz de hisse degil
        for (const yazim of [CAKE.slice(2), ` ${CAKE} `]) expect(isStockDeliveryToken(56, yazim), yazim).toBe(false)
    })

    it('karar yalniz (zincir, adres) ile verilir: emekli adres baska sembol ve adla gelse de hisse (sembol / ad okunmaz)', () => {
        // Fonksiyon yalniz iki arguman alir; sembol / ad yolu yoktur (kaynak imzasi): emekli adres ne diye gelirse gelsin true.
        expect(isStockDeliveryToken.length).toBe(2)
        expect(isStockDeliveryToken(BSTOCKS_CHAIN_ID, RETIRED_BSTOCKS[0].address)).toBe(true)
    })
})

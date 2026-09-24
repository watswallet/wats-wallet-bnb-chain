import { describe, it, expect } from 'vitest'
import { jettonsFromTokens } from './jettonList'

describe('jettonsFromTokens', () => {
    it('ondaligi olan kaydi gecirir', () => {
        const out = jettonsFromTokens([{ symbol: 'USDT', address: 'EQ1', decimals: 6 }])
        expect(out).toHaveLength(1)
        expect(out[0].decimals).toBe(6)
        expect(out[0].master).toBe('EQ1')
    })

    it('ondaligi OLMAYAN kaydi DUSURUR', () => {
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ2' }])).toHaveLength(0)
    })

    it('ondaligi sayi OLMAYAN kaydi DUSURUR', () => {
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ2', decimals: '6' }])).toHaveLength(0)
    })

    it('master adresi olmayan kaydi DUSURUR', () => {
        expect(jettonsFromTokens([{ symbol: 'X', decimals: 6 }])).toHaveLength(0)
    })

    it('bozuk girdide patlamaz', () => {
        expect(jettonsFromTokens(null)).toEqual([])
        expect(jettonsFromTokens(undefined)).toEqual([])
    })

    // Ku1: eskiden yalniz Number.isInteger kontrol ediliyordu - negatif ve anlamsiz
    // buyuk degerler de tamsayi oldugu icin GECIYORDU. jettonTransfer.js/
    // tonJettonHistory.js ile AYNI sinir (0..30) burada da uygulanir.
    it('negatif ondaligi olan kaydi DUSURUR', () => {
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ2', decimals: -1 }])).toHaveLength(0)
    })

    it('sinirin (30) UZERINDE ondaligi olan kaydi DUSURUR', () => {
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ2', decimals: 31 }])).toHaveLength(0)
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ2', decimals: 1e7 }])).toHaveLength(0)
    })

    it('sinir DEGERLERI (0 ve 30) GECER', () => {
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ2', decimals: 0 }])).toHaveLength(1)
        expect(jettonsFromTokens([{ symbol: 'X', address: 'EQ3', decimals: 30 }])).toHaveLength(1)
    })
})

// FIYAT KIMLIGI (canli teshis 2026-09-18): bu mapper cikti nesnesini ALAN ALAN
// kuruyor, yani listede olmayan hicbir sey disari cikmaz. `coingecko_id` listede
// YOKTU ve Home.vue jetton satirinin dolar karsiligini bu alanla esliyor -- alan
// gecmediginde satir ana ekranda DOGRU miktari ama "$0.00" degeri gosteriyordu.
//
// Bu, server/utils/tonJettonTokens.js'te BIREBIR ayni sekilde bulunan kusurun
// (bkz. e70b89d: "mapper alani GECIRMIYORDU") istemci tarafindaki ikizidir ve
// ayni kosullu desenle kapatildi: kimlik yoksa alan HIC yazilmaz.
describe('jettonsFromTokens -- fiyat kimligi', () => {
    it('satirin coingecko_id sini TASIR', () => {
        const out = jettonsFromTokens([{ symbol: 'USDT', address: 'EQ1', decimals: 6, coingecko_id: 'tether' }])
        expect(out[0].coingecko_id).toBe('tether')
    })

    it('kimliksiz satirda alan HIC yazilmaz (undefined yayilmaz)', () => {
        const out = jettonsFromTokens([{ symbol: 'STON', address: 'EQ2', decimals: 9 }])
        // `undefined` bir coingecko_id yaymak, `find(d => d.coingecko_id === undefined)`
        // cagrisinin kimligi olmayan BASKA bir kayda eslesmesine kapi acardi
        // (server/data/tonJettons.js'teki AYNI gerekce).
        expect(Object.prototype.hasOwnProperty.call(out[0], 'coingecko_id')).toBe(false)
    })
})

import { describe, it, expect } from 'vitest'
import { ensureTonNativeToken } from './tonTokenSeed'
import { TON_MAINNET_ID } from '../chainKind'

const KEY = String(TON_MAINNET_ID)

describe('ensureTonNativeToken', () => {
    it('TON satiri yoksa ekler', () => {
        const { changed, byChain } = ensureTonNativeToken({ 1: [{ symbol: 'ETH' }] })
        expect(changed).toBe(true)
        expect(byChain[KEY]).toHaveLength(1)
        expect(byChain[KEY][0].symbol).toBe('GRAM')
        expect(Number(byChain[KEY][0].chainId)).toBe(TON_MAINNET_ID)
        expect(byChain[KEY][0].native).toBe(true)
    })

    it('mevcut zincirlere dokunmaz', () => {
        const { byChain } = ensureTonNativeToken({ 1: [{ symbol: 'ETH' }] })
        expect(byChain['1']).toEqual([{ symbol: 'ETH' }])
    })

    // ------------------------------------------------------------------
    // ESKI SATIR DISKTE KALIYORDU
    //
    // Tohum satiri chrome.storage.local'a BIR KEZ yaziliyor (Home.vue
    // loadCurrentTokens) ve bir daha tazelenmiyordu; `imported_tokens` icin
    // baska hicbir yerde goc/onarim yok. Yani TON agini adlandirma
    // degisikliginden (adc23c1, 2026-09-15) ONCE bir kez acmis her kullanicinin
    // diskinde hala { symbol: 'TON', name: 'Toncoin' } duruyor -- ve Home.vue o
    // nesneyi DOGRUDAN basiyor, yani bakiyenin yaninda "TON" yaziyor.
    //
    // TON destegi 2026-09-14 duyuruldu, ad 2026-09-15'te degisti: arada surumu
    // kullanan HERKES etkilenir. Burasi o satiri tazeleyebilecek TEK yer.
    //
    // (Onceki test burada `changed === false` bekliyordu -- yani YANLIS degeri
    // kilitliyordu.)
    // ------------------------------------------------------------------
    it('diskteki ESKI adi ve sembolu tazeler', () => {
        const existing = {
            [KEY]: [{ symbol: 'TON', name: 'Toncoin', address: '0x0', chainId: TON_MAINNET_ID }],
        }
        const { changed, byChain } = ensureTonNativeToken(existing)

        expect(changed).toBe(true)
        expect(byChain[KEY]).toHaveLength(1)
        expect(byChain[KEY][0].symbol).toBe('GRAM')
        expect(byChain[KEY][0].name).toBe('GRAM')
    })

    it('tazelerken KIMLIK alanlarina dokunmaz', () => {
        const existing = {
            [KEY]: [{
                symbol: 'TON', name: 'Toncoin', address: '0x0',
                chainId: TON_MAINNET_ID, coingecko_id: 'the-open-network', decimals: 9,
            }],
        }
        const { byChain } = ensureTonNativeToken(existing)
        const row = byChain[KEY][0]

        expect(row.address).toBe('0x0')
        expect(row.chainId).toBe(TON_MAINNET_ID)
        expect(row.coingecko_id).toBe('the-open-network')
        expect(row.decimals).toBe(9)
    })

    // Kullanicinin elle ekledigi jettonlar AYNI kovada yasiyor. Tohumlayici
    // listeyi yeniden kurarsa o satirlar SESSIZCE silinirdi.
    it('ayni zincirdeki jetton satirlarini KORUR', () => {
        const jetton = { symbol: 'USDT', address: 'EQCxE6mU', chainId: TON_MAINNET_ID }
        const existing = {
            [KEY]: [{ symbol: 'TON', name: 'Toncoin', address: '0x0', chainId: TON_MAINNET_ID }, jetton],
        }
        const { byChain } = ensureTonNativeToken(existing)

        expect(byChain[KEY]).toHaveLength(2)
        expect(byChain[KEY][1]).toEqual(jetton)
    })

    // GEREKSIZ YAZMA YOK: cagiran `changed` false ise diske hic dokunmuyor.
    it('satir ZATEN GRAM ise DEGISTIRMEZ', () => {
        const existing = {
            [KEY]: [{ symbol: 'GRAM', name: 'GRAM', address: '0x0', chainId: TON_MAINNET_ID }],
        }

        expect(ensureTonNativeToken(existing).changed).toBe(false)
    })

    // Kovada native satir YOKSA (yalnizca jetton) bu tur satir EKLEMEZ: liste
    // dolu oldugu icin tohumlama kapisi zaten kapali, orayi acmak AYRI bir karar.
    it('native satir yoksa jetton listesine dokunmaz', () => {
        const jetton = { symbol: 'USDT', address: 'EQCxE6mU', chainId: TON_MAINNET_ID }
        const { changed, byChain } = ensureTonNativeToken({ [KEY]: [jetton] })

        expect(changed).toBe(false)
        expect(byChain[KEY]).toEqual([jetton])
    })

    it('bos/gecersiz girdide de calisir', () => {
        expect(ensureTonNativeToken(undefined).byChain[KEY]).toHaveLength(1)
        expect(ensureTonNativeToken(null).changed).toBe(true)
    })

    it('girdiyi YERINDE degistirmez', () => {
        const input = { 1: [] }
        const { byChain } = ensureTonNativeToken(input)
        expect(input[KEY]).toBeUndefined()
        expect(byChain).not.toBe(input)
    })
})

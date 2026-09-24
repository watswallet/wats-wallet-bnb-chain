// Adresten kurtarilan fiyat kimliginin ZINCIR DOGRULAMASI — saf katman.
//
// Bu dosyanin korudugu karar: kimlik, YALNIZCA cevabin satirla AYNI zincire ait
// oldugu KANITLANDIGINDA kabul edilir. Gerekce ve canli olcumler
// utils/tokenIdentityByAddress.js bas yorumunda; ozetle /getTokenByAddress govdedeki
// chainId'yi YOK SAYAR ve DB kolunda `address` benzersiz DEGILDIR, yani dogrulamasiz
// kabul BASKA bir tokenin fiyatini bu tokenin fiyati diye gosterirdi.
import { describe, it, expect } from 'vitest'
import { recoveredCoingeckoId } from './tokenIdentityByAddress'

const TON_ROW = { chainId: -239, address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs' }
const ETH_ROW = { chainId: 1, address: '0xdac17f958d2ee523a2206206994597c13d831ec7' }
const BASE_ROW = { chainId: 8453, address: '0x4200000000000000000000000000000000000006' }

describe('recoveredCoingeckoId -- kurasyonlu kol (cevap chainId TASIR)', () => {
    it('chainId satirla AYNI ise kimlik kabul edilir', () => {
        expect(recoveredCoingeckoId({ chainId: -239, coingecko_id: 'tether' }, TON_ROW)).toBe('tether')
    })

    it('chainId FARKLI ise kimlik reddedilir', () => {
        expect(recoveredCoingeckoId({ chainId: 1, coingecko_id: 'tether' }, TON_ROW)).toBeNull()
    })

    it('Solana nin METIN kimligi de birebir karsilastirilir', () => {
        const row = { chainId: 'solana-mainnet', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }
        expect(recoveredCoingeckoId({ chainId: 'solana-mainnet', coingecko_id: 'usd-coin' }, row)).toBe('usd-coin')
        expect(recoveredCoingeckoId({ chainId: -239, coingecko_id: 'usd-coin' }, row)).toBeNull()
    })
})

describe('recoveredCoingeckoId -- DB kolu (cevap yalniz `chain` slug u tasir)', () => {
    it('slug satirin zincirininkiyle esitse kabul edilir', () => {
        expect(recoveredCoingeckoId({ chain: 'ethereum', coingecko_id: 'tether' }, ETH_ROW)).toBe('tether')
    })

    it('CANLI OLCULEN TUZAK: ayni adres BASKA zincirin kaydini dondurur -> reddedilir', () => {
        // POST /getTokenByAddress {"address":"0x4200...0006"} -> chain "bob-network".
        // Satir Base'de; kabul etmek kullaniciya BASKA bir tokenin fiyatini gosterirdi.
        const cevap = { chain: 'bob-network', coingecko_id: 'bridged-wrapped-ethereum-bob-network' }
        expect(recoveredCoingeckoId(cevap, BASE_ROW)).toBeNull()
    })

    it('slug karsilastirmasi harf kasasindan ve bosluktan bagimsizdir', () => {
        expect(recoveredCoingeckoId({ chain: ' Ethereum ', coingecko_id: 'tether' }, ETH_ROW)).toBe('tether')
    })

    it('zincir bilgisi HIC yoksa reddedilir (sessizce kabul EDILMEZ)', () => {
        expect(recoveredCoingeckoId({ coingecko_id: 'tether' }, TON_ROW)).toBeNull()
    })
})

describe('recoveredCoingeckoId -- bozuk/eksik girdiler', () => {
    it('kimlik yoksa null doner', () => {
        expect(recoveredCoingeckoId({ chainId: -239 }, TON_ROW)).toBeNull()
        expect(recoveredCoingeckoId({ chainId: -239, coingecko_id: '' }, TON_ROW)).toBeNull()
        expect(recoveredCoingeckoId({ chainId: -239, coingecko_id: null }, TON_ROW)).toBeNull()
    })

    it('cevap ya da satir yoksa null doner (cagiran yerde ayrica kontrol gerekmez)', () => {
        expect(recoveredCoingeckoId(null, TON_ROW)).toBeNull()
        expect(recoveredCoingeckoId({ chainId: -239, coingecko_id: 'tether' }, null)).toBeNull()
    })

    it('satirin chainId si cozulemiyorsa kimlik kabul EDILMEZ', () => {
        const row = { chainId: 'abc', address: 'EQCxE6mU' }
        expect(recoveredCoingeckoId({ chainId: 'abc', coingecko_id: 'tether' }, row)).toBeNull()
    })
})

// rwaQuoteMemory.js -- RWA teklifinin bellek ici kaydi (Bolum 2, Gorev 5): quoteId -> { issuer, chainId, stock, side }.
// Hizmet iscisi her an olebilir: kayit yoksa cagiran (Gorev 6) alimi LCX_REQUOTE ile durdurur, kapiyi ATLAMAZ.
import { describe, it, expect, beforeEach } from 'vitest'
import { rememberRwaQuote, recallRwaQuote, RWA_QUOTE_TTL_MS, RWA_QUOTE_MAX, _resetRwaQuotes } from './rwaQuoteMemory.js'

const INFO = Object.freeze({ issuer: 'coinbase', chainId: 8453, stock: '0xb2000000000000000000001e800a7f5189430cD0', side: 'buy' })
const T0 = 1_795_100_000_000

beforeEach(() => _resetRwaQuotes())

describe('sabitler', () => {
    it('kayit omru 130000 ms (teklif omru 120 sn + pay), en cok 64 kayit', () => {
        expect(RWA_QUOTE_TTL_MS).toBe(130_000)
        expect(RWA_QUOTE_MAX).toBe(64)
    })
})

describe('rememberRwaQuote / recallRwaQuote', () => {
    it('yazilan kayit aynen okunur', () => {
        rememberRwaQuote('q_1', INFO, T0)
        expect(recallRwaQuote('q_1', T0 + 1)).toEqual(INFO)
    })

    it('bilinmeyen / dize olmayan / bos quoteId null', () => {
        rememberRwaQuote('q_1', INFO, T0)
        expect(recallRwaQuote('q_2', T0)).toBeNull()
        for (const bad of [undefined, null, '', 5, {}, ['q_1']]) expect(recallRwaQuote(bad, T0), String(bad)).toBeNull()
    })

    it('bos / dize olmayan quoteId ile yazim sessizce yok sayilir', () => {
        for (const bad of [undefined, null, '', 5, {}]) rememberRwaQuote(bad, INFO, T0)
        expect(recallRwaQuote('', T0)).toBeNull()
        expect(recallRwaQuote('undefined', T0)).toBeNull()
    })

    it('okunan kayit bir KOPYADIR: degistirmek bellegi degistirmez; yazilan nesne de kopyalanir', () => {
        const info = { ...INFO }
        rememberRwaQuote('q_1', info, T0)
        info.issuer = 'ondo' // yazimdan sonra cagiranin nesnesi degisti
        const out = recallRwaQuote('q_1', T0)
        expect(out.issuer).toBe('coinbase')
        out.issuer = 'robinhood'
        expect(recallRwaQuote('q_1', T0).issuer).toBe('coinbase')
    })

    it('omur: tam 130000 ms yasinda hala var, 130001 ms de yok (ve silinir)', () => {
        rememberRwaQuote('q_1', INFO, T0)
        expect(recallRwaQuote('q_1', T0 + 130_000)).toEqual(INFO)
        expect(recallRwaQuote('q_1', T0 + 130_001)).toBeNull()
        // Silindi: saat geri alinsa da geri gelmez.
        expect(recallRwaQuote('q_1', T0)).toBeNull()
    })

    it('ayni quoteId yeniden yazilinca omur yenilenir ve deger degisir', () => {
        rememberRwaQuote('q_1', INFO, T0)
        rememberRwaQuote('q_1', { ...INFO, issuer: 'ondo' }, T0 + 100_000)
        expect(recallRwaQuote('q_1', T0 + 200_000)).toEqual({ ...INFO, issuer: 'ondo' })
    })

    it('en cok 64 kayit: 65. yazim en eskiyi atar', () => {
        for (let i = 0; i < 64; i++) rememberRwaQuote(`q_${i}`, INFO, T0)
        expect(recallRwaQuote('q_0', T0)).toEqual(INFO)
        rememberRwaQuote('q_64', INFO, T0)
        expect(recallRwaQuote('q_0', T0)).toBeNull()
        expect(recallRwaQuote('q_1', T0)).toEqual(INFO)
        expect(recallRwaQuote('q_64', T0)).toEqual(INFO)
    })

    it('yeniden yazilan kayit en yeni sayilir (eviction sirasi)', () => {
        for (let i = 0; i < 64; i++) rememberRwaQuote(`q_${i}`, INFO, T0)
        rememberRwaQuote('q_0', INFO, T0) // en eski yenilendi
        rememberRwaQuote('q_64', INFO, T0)
        expect(recallRwaQuote('q_0', T0)).toEqual(INFO)
        expect(recallRwaQuote('q_1', T0)).toBeNull()
    })

    it('saat verilmezse Date.now kullanilir', () => {
        rememberRwaQuote('q_now', INFO)
        expect(recallRwaQuote('q_now')).toEqual(INFO)
    })
})

import { describe, it, expect } from 'vitest'
import { pickRecentRecipients, RECENT_RECIPIENTS_SHOWN } from './recentRecipients'

const A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const C = '0xcccccccccccccccccccccccccccccccccccccccc'

const sent = (address, lastSentAt, count = 1, label = null) => ({ address, lastSentAt, count, label })

describe('pickRecentRecipients', () => {
    it('kayitlari oldugu gibi gecirir', () => {
        expect(pickRecentRecipients([sent(A, 5, 3, 'Borsa')])).toEqual([
            { address: A, label: 'Borsa', lastSentAt: 5, count: 3 },
        ])
    })

    it('en son gonderilen basta', () => {
        const out = pickRecentRecipients([sent(A, 1), sent(B, 9), sent(C, 5)])
        expect(out.map(r => r.address)).toEqual([B, C, A])
    })

    it('ayni anda gonderilmisse cok gonderilen once', () => {
        const out = pickRecentRecipients([sent(A, 7, 1), sent(B, 7, 4)])
        expect(out.map(r => r.address)).toEqual([B, A])
    })

    // Ayni adresi uc bolumde birden listelemek dogru olani secmeyi zorlastirir -
    // zehirli adres saldirisinin tam da bekledigi kalabalik.
    it('kayitli adresler elenir', () => {
        const out = pickRecentRecipients([sent(A, 1), sent(B, 2)], { savedAddresses: [{ address: A }] })
        expect(out.map(r => r.address)).toEqual([B])
    })

    it('kullanicinin KENDI hesaplari elenir', () => {
        const out = pickRecentRecipients([sent(A, 1), sent(B, 2)], { myAccounts: [{ address: B }] })
        expect(out.map(r => r.address)).toEqual([A])
    })

    it('eleme buyuk/kucuk harfe bakmaz', () => {
        // Adres kimi kayitta checksum'li kimi kayitta kucuk harf durur; harfe
        // duyarli bir eleme ayni adresi iki kez gosterirdi.
        const out = pickRecentRecipients([sent(A.toUpperCase(), 1)], { savedAddresses: [{ address: A }] })
        expect(out).toEqual([])
    })

    it('ayni adres iki kez gorunmez', () => {
        const out = pickRecentRecipients([sent(A, 5), sent(A.toUpperCase(), 3)])
        expect(out).toHaveLength(1)
    })

    it('adresi olmayan bozuk kayitlar atlanir', () => {
        const out = pickRecentRecipients([{ lastSentAt: 9 }, sent(A, 1), { address: null }, { address: 42 }])
        expect(out.map(r => r.address)).toEqual([A])
    })

    it('varsayilan olarak en fazla RECENT_RECIPIENTS_SHOWN kayit', () => {
        const many = Array.from({ length: 20 }, (_, i) =>
            sent('0x' + String(i).padStart(40, '0'), i))
        expect(pickRecentRecipients(many)).toHaveLength(RECENT_RECIPIENTS_SHOWN)
    })

    it('sinir disaridan verilebilir', () => {
        const many = Array.from({ length: 20 }, (_, i) =>
            sent('0x' + String(i).padStart(40, '0'), i))
        expect(pickRecentRecipients(many, { limit: 3 })).toHaveLength(3)
    })

    it('liste yoksa bos dizi - cokmez', () => {
        expect(pickRecentRecipients(null)).toEqual([])
        expect(pickRecentRecipients(undefined)).toEqual([])
        expect(pickRecentRecipients('abc')).toEqual([])
        expect(pickRecentRecipients([])).toEqual([])
    })

    it('eksik sayilar 0 sayilir - NaN siralamayi bozmaz', () => {
        const out = pickRecentRecipients([{ address: A }, sent(B, 3)])
        expect(out.map(r => r.address)).toEqual([B, A])
        expect(out[1]).toMatchObject({ lastSentAt: 0, count: 0 })
    })
})

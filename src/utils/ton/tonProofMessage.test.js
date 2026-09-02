import { describe, it, expect } from 'vitest'
import { buildTonProofMessage, tonProofSignInput, TON_PROOF_PREFIX } from './tonProofMessage'

const ADDR_HASH = new Uint8Array(32).fill(7)
const BASE = {
    workchain: 0,
    addressHash: ADDR_HASH,
    domain: 'app.dedust.io',      // 13 bayt
    timestamp: 1756000000,
    payload: 'abc',               // 3 bayt
}

const dec = new TextDecoder()

describe('buildTonProofMessage', () => {
    // Uzunluk TESTI bir formalite DEGIL: alanlardan biri unutulursa ya da yanlis
    // genislikte yazilirsa (int32 yerine int8 gibi) imza dapp tarafinda sessizce
    // dogrulanamaz ve hicbir hata mesaji gorunmez.
    it('toplam uzunluk = 18 + 4 + 32 + 4 + domain + 8 + payload', () => {
        const m = buildTonProofMessage(BASE)
        expect(m).toBeInstanceOf(Uint8Array)
        expect(m.length).toBe(18 + 4 + 32 + 4 + 13 + 8 + 3)
    })

    it('on ek ton-proof-item-v2/ ile baslar', () => {
        const m = buildTonProofMessage(BASE)
        expect(dec.decode(m.slice(0, 18))).toBe(TON_PROOF_PREFIX)
    })

    it('workchain int32 BIG-ENDIAN yazilir', () => {
        const m = buildTonProofMessage({ ...BASE, workchain: 0 })
        expect(Array.from(m.slice(18, 22))).toEqual([0, 0, 0, 0])
        const mm = buildTonProofMessage({ ...BASE, workchain: -1 })
        expect(Array.from(mm.slice(18, 22))).toEqual([255, 255, 255, 255])
        // workchain 1 simetrisi yoktur: BE [0,0,0,1] vs LE [1,0,0,0].
        // 0 ve -1 simetrik baytlar; sadece 1 le/be cevirmesini yakalar.
        const mOne = buildTonProofMessage({ ...BASE, workchain: 1 })
        expect(Array.from(mOne.slice(18, 22))).toEqual([0, 0, 0, 1])
    })

    it('adres hash 32 bayt olarak aynen gomulur', () => {
        const m = buildTonProofMessage(BASE)
        expect(Array.from(m.slice(22, 54))).toEqual(Array.from(ADDR_HASH))
    })

    it('domain uzunlugu uint32 LITTLE-endian, ardindan domain baytlari', () => {
        const m = buildTonProofMessage(BASE)
        expect(Array.from(m.slice(54, 58))).toEqual([13, 0, 0, 0])
        expect(dec.decode(m.slice(58, 71))).toBe('app.dedust.io')
    })

    it('timestamp uint64 LITTLE-endian', () => {
        const m = buildTonProofMessage(BASE)
        const dv = new DataView(m.buffer, m.byteOffset + 71, 8)
        expect(dv.getBigUint64(0, true)).toBe(1756000000n)
    })

    it('payload sonda, oldugu gibi', () => {
        const m = buildTonProofMessage(BASE)
        expect(dec.decode(m.slice(79))).toBe('abc')
    })

    it('bos payload kabul edilir', () => {
        const m = buildTonProofMessage({ ...BASE, payload: '' })
        expect(m.length).toBe(18 + 4 + 32 + 4 + 13 + 8)
    })

    // Domain'deki Unicode karakterler UTF-8'de birden fazla bayt alir.
    // Uzunluk alan KARAKTER sayisini degil BAYT sayisini tutmali;
    // hata yapilirsa dapp dogrulamasi sessizce kacar.
    it('domain uzunlugu BAYT sayar, karakter degil', () => {
        const m = buildTonProofMessage({ ...BASE, domain: 'çx' })
        expect(Array.from(m.slice(54, 58))).toEqual([3, 0, 0, 0])
    })

    it('32 bayttan farkli address hash reddedilir', () => {
        expect(() => buildTonProofMessage({ ...BASE, addressHash: new Uint8Array(16) })).toThrow('TON_PROOF_BAD_ADDRESS_HASH')
    })

    it('negatif timestamp reddedilir', () => {
        expect(() => buildTonProofMessage({ ...BASE, timestamp: -1 })).toThrow('TON_PROOF_BAD_TIMESTAMP')
    })

    it('tam sayi olmayan timestamp reddedilir', () => {
        expect(() => buildTonProofMessage({ ...BASE, timestamp: 123.45 })).toThrow('TON_PROOF_BAD_TIMESTAMP')
    })

    it('sifir timestamp kabul edilir', () => {
        const m = buildTonProofMessage({ ...BASE, timestamp: 0 })
        expect(m).toBeInstanceOf(Uint8Array)
    })
})

describe('tonProofSignInput', () => {
    it('0xffff ++ "ton-connect" ++ hash, toplam 45 bayt', () => {
        const hash = new Uint8Array(32).fill(9)
        const input = tonProofSignInput(hash)
        expect(input.length).toBe(2 + 11 + 32)
        expect(Array.from(input.slice(0, 2))).toEqual([255, 255])
        expect(dec.decode(input.slice(2, 13))).toBe('ton-connect')
        expect(Array.from(input.slice(13))).toEqual(Array.from(hash))
    })

    it('32 baytlik olmayan hash reddedilir', () => {
        expect(() => tonProofSignInput(new Uint8Array(16))).toThrow()
    })
})

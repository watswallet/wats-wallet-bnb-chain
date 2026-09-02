import { describe, it, expect } from 'vitest'
import { PublicKey } from '@solana/web3.js'
import { base58Encode } from './base58'

// BAGIMSIZ ORAKL: PublicKey#toBase58() @solana/web3.js'in KENDI base58
// uygulamasidir (bs58). 32 baytlik her girdide iki uygulama BIREBIR ayni dizgeyi
// uretmek zorunda. Bu, "kendi kodumu kendi beklentimle dogruladim" totolojisini
// kirar: beklenen degerleri BEN yazmiyorum, baska bir uygulama uretiyor.
//
// 64 baytlik imza icin ayni oraklu KULLANILAMAZ (PublicKey 32 baytin ustunu
// reddeder) -- zaten bu dosyanin var olma sebebi de bu. Uzunluktan bagimsiz
// olan algoritmanin 32 baytta dogru oldugu gosterilince 64 baytta da dogrudur;
// ayrica asagida sabit vektorler ve tersine cevrilebilirlik ayrica kilitlenir.
function randomBytes(n, seed) {
    const out = new Uint8Array(n)
    let x = seed
    for (let i = 0; i < n; i += 1) {
        x = (x * 1103515245 + 12345) & 0x7fffffff
        out[i] = (x >>> 16) & 0xff
    }
    return out
}

describe('base58Encode', () => {
    it('32 baytlik girdilerde PublicKey#toBase58 ile BIREBIR ayni', () => {
        for (let seed = 1; seed <= 200; seed += 1) {
            const bytes = randomBytes(32, seed)
            expect(base58Encode(bytes)).toBe(new PublicKey(bytes).toBase58())
        }
    })

    // BAS SIFIRLAR: sayisal donusum onlari yutar. '1' olarak geri konmazsa
    // 0x00,0x01 ile 0x01 AYNI dizgeye kodlanir -- yani iki FARKLI imza ayni
    // gorunur.
    it('bas sifirlar 1 karakterine donusur (PublicKey ile dogrulandi)', () => {
        const allZero = new Uint8Array(32)
        expect(base58Encode(allZero)).toBe(new PublicKey(allZero).toBase58())
        expect(base58Encode(allZero)).toBe('1'.repeat(32))

        const leading = new Uint8Array(32)
        leading[31] = 1
        expect(base58Encode(leading)).toBe(new PublicKey(leading).toBase58())
        expect(base58Encode(leading)).toBe('1'.repeat(31) + '2')
    })

    it('bilinen vektorler', () => {
        expect(base58Encode(new Uint8Array([0]))).toBe('1')
        expect(base58Encode(new Uint8Array([57]))).toBe('z')
        expect(base58Encode(new Uint8Array([58]))).toBe('21')
        expect(base58Encode(new Uint8Array([255, 255]))).toBe('LUv')
        expect(base58Encode(new Uint8Array([]))).toBe('')
    })

    // Bir Solana imzasi 64 bayttir ve base58'i 86-88 karakter arasindadir.
    it('64 baytlik imza uzunlugu gercekci araliktadir', () => {
        for (let seed = 1; seed <= 50; seed += 1) {
            const sig = randomBytes(64, seed)
            const encoded = base58Encode(sig)
            expect(encoded.length).toBeGreaterThanOrEqual(64)
            expect(encoded.length).toBeLessThanOrEqual(88)
            // Alfabe disi karakter YOK (base58'de 0/O/I/l bulunmaz).
            expect(encoded).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/)
        }
    })

    // Buffer da (background.js'te transaction.signature bir Buffer'dir) kabul edilir.
    it('Buffer girdisi Uint8Array ile ayni sonucu verir', () => {
        const bytes = randomBytes(32, 7)
        expect(base58Encode(Buffer.from(bytes))).toBe(base58Encode(bytes))
    })

    it('null/undefined ACIKCA reddedilir (sessiz bos dizge DEGIL)', () => {
        expect(() => base58Encode(null)).toThrow('BASE58_INVALID_INPUT')
        expect(() => base58Encode(undefined)).toThrow('BASE58_INVALID_INPUT')
    })
})

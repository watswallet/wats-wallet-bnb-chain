import { describe, it, expect } from 'vitest'
import { mnemonicToSeed } from 'bip39'
import { derivePath as ed25519HdKeyDerivePath } from 'ed25519-hd-key'
import { Keypair } from '@solana/web3.js'
import {
    solanaPath,
    parsePath,
    slip10DeriveEd25519,
    slip10DeriveEd25519Full,
    deriveSolanaAddress,
    deriveSolanaKeypair
} from './derive'

// BIP-39 standart test mnemonic'i.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('solanaPath', () => {
    it("Phantom/Solflare yolu: m/44'/501'/{index}'/0'", () => {
        expect(solanaPath(0)).toBe("m/44'/501'/0'/0'")
        expect(solanaPath(3)).toBe("m/44'/501'/3'/0'")
    })
})

describe('parsePath', () => {
    it('hardened segmentleri indekse cevirir', () => {
        expect(parsePath("m/44'/501'/0'/0'")).toEqual([
            44 + 0x80000000, 501 + 0x80000000, 0x80000000, 0x80000000
        ])
    })

    it('kok yol bos dizi', () => {
        expect(parsePath('m')).toEqual([])
    })

    // SLIP-0010'da ed25519 icin YALNIZCA hardened turetme tanimlidir. Hardened
    // olmayan bir segment sessizce kabul edilirse baska cuzdanlarla UYUSMAYAN,
    // sessizce yanlis bir adres uretilir.
    it('hardened olmayan segment acikca reddedilir', () => {
        expect(() => parsePath("m/44'/501'/0'/0")).toThrow('ED25519_REQUIRES_HARDENED')
    })

    it('bicimsiz yol reddedilir', () => {
        expect(() => parsePath('44/501')).toThrow('INVALID_PATH')
        expect(() => parsePath('')).toThrow('INVALID_PATH')
        expect(() => parsePath(null)).toThrow('INVALID_PATH')
        expect(() => parsePath("m/x'")).toThrow('INVALID_PATH')
        expect(() => parsePath("m/-1'")).toThrow('INVALID_PATH')
    })
})

// SLIP-0010 resmi test vektorleri, "Test vector 1 for ed25519" bolumunden
// BIREBIR alindi (uydurulmadi):
// https://github.com/satoshilabs/slips/blob/master/slip-0010.md
//
// Bu blok slip10DeriveEd25519'un KENDISINI (uydurma degil, spesifikasyonun
// resmi vektorlerini) dogrular. Yanlis bir sonuc cikarsa hata burada, kod
// tarafinda aranir — vektorler degistirilmez (bkz. gorev talimati).
describe('SLIP-0010 resmi test vektorleri (ed25519, test vector 1)', () => {
    const SEED = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')

    it("Chain m: private key ve chain code spesifikasyonla eslesir", () => {
        const { key, chainCode } = slip10DeriveEd25519Full(SEED, 'm')
        expect(Buffer.from(key).toString('hex')).toBe(
            '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7'
        )
        expect(Buffer.from(chainCode).toString('hex')).toBe(
            '90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb'
        )
    })

    it("Chain m/0': private key ve chain code spesifikasyonla eslesir", () => {
        const { key, chainCode } = slip10DeriveEd25519Full(SEED, "m/0'")
        expect(Buffer.from(key).toString('hex')).toBe(
            '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3'
        )
        expect(Buffer.from(chainCode).toString('hex')).toBe(
            '8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69'
        )
    })

    it("Chain m/0'/1': private key ve chain code spesifikasyonla eslesir", () => {
        const { key, chainCode } = slip10DeriveEd25519Full(SEED, "m/0'/1'")
        expect(Buffer.from(key).toString('hex')).toBe(
            'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2'
        )
        expect(Buffer.from(chainCode).toString('hex')).toBe(
            'a320425f77d1b5c2505a6b1b27382b37368ee640e3557c315416801243552f14'
        )
    })

    it('slip10DeriveEd25519, slip10DeriveEd25519Full ile AYNI private key i dondurur', () => {
        expect(Buffer.from(slip10DeriveEd25519(SEED, "m/0'/1'")).toString('hex')).toBe(
            Buffer.from(slip10DeriveEd25519Full(SEED, "m/0'/1'").key).toString('hex')
        )
    })
})

// Bagimsiz ikinci bir SLIP-0010 uygulamasiyla (ed25519-hd-key) capraz dogrulama.
// Iki bagimsiz uygulama AYNI genel anahtari uretiyorsa, bu, elle Phantom'a ice
// aktarmanin yerini tutan kanittir (bkz. gorev talimati — kontrolor kurali).
// Phantom/Solflare'e karsi INSAN dogrulamasi Gorev 17 Adim 5.2'de yapilir.
describe('capraz uygulama dogrulamasi (ed25519-hd-key)', () => {
    it("m/44'/501'/0'/0' yolunda ed25519-hd-key ile AYNI genel anahtari uretir", async () => {
        const seed = await mnemonicToSeed(MNEMONIC)
        const seedHex = Buffer.from(seed).toString('hex')

        const { key } = ed25519HdKeyDerivePath("m/44'/501'/0'/0'", seedHex)
        const referenceKeypair = Keypair.fromSeed(key)

        const ourKeypair = await deriveSolanaKeypair(MNEMONIC, 0)

        expect(ourKeypair.publicKey.toBase58()).toBe(referenceKeypair.publicKey.toBase58())
    })
})

describe('deriveSolanaAddress', () => {
    it('base58 bicimli, 32-44 karakterlik bir adres uretir', async () => {
        const { address } = await deriveSolanaAddress(MNEMONIC, 0)
        expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    })

    it('ayni girdi her zaman ayni adresi verir', async () => {
        const a = await deriveSolanaAddress(MNEMONIC, 0)
        const b = await deriveSolanaAddress(MNEMONIC, 0)
        expect(a.address).toBe(b.address)
        expect(a.publicKey).toBe(b.publicKey)
    })

    it('farkli indeks farkli adres verir', async () => {
        const a = await deriveSolanaAddress(MNEMONIC, 0)
        const b = await deriveSolanaAddress(MNEMONIC, 1)
        expect(a.address).not.toBe(b.address)
    })

    it('publicKey hex olarak dondurulur ve adresle AYNI anahtardir', async () => {
        const { address, publicKey } = await deriveSolanaAddress(MNEMONIC, 0)
        const keypair = await deriveSolanaKeypair(MNEMONIC, 0)
        expect(publicKey).toMatch(/^[0-9a-f]{64}$/)
        expect(keypair.publicKey.toBase58()).toBe(address)
    })

    // REGRESYON KILIDI: bu deger, bu kodun bilinen test tohumu icin urettigi
    // adrestir. Dogrulugu SLIP-0010 resmi vektorleriyle (yukarida) ve bagimsiz
    // bir ikinci uygulamayla (ed25519-hd-key, yukarida) capraz kontrol edildi —
    // ikisi de AYNI sonuca varmasi elle Phantom kontrolunun yerini tutan
    // kanittir. Phantom/Solflare'e karsi INSAN dogrulamasi Gorev 17 Adim 5.2'de
    // yapilir; bu test yalnizca gelecekte bu deger SESSIZCE degismesin diye var.
    it('bilinen tohumdan beklenen adresi uretir — regresyon kilidi', async () => {
        const EXPECTED_ADDRESS = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk'
        const { address } = await deriveSolanaAddress(MNEMONIC, 0)
        expect(address).toBe(EXPECTED_ADDRESS)
    })
})

import { describe, it, expect } from 'vitest'
import { deriveSolanaKeypair } from './derive'
import { signMessageBytes } from './signMessage'

const hex = (bytes) => Buffer.from(bytes).toString('hex')
const fromHex = (h) => new Uint8Array(Buffer.from(h, 'hex'))

// BIP-39 standart test mnemonic'i -- derive.test.js ile AYNI tohum.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// RFC 8032, Bolum 7.1 "Test Vectors for Ed25519" -- TEST 1 ve TEST 2
// spesifikasyondan BIREBIR alindi (uydurulmadi):
// https://www.rfc-editor.org/rfc/rfc8032#section-7.1
//
// Bu blok imzalayicinin KENDISINI dogrular. Yanlis sonuc cikarsa hata kodda
// aranir, vektorler DEGISTIRILMEZ.
//
// tweetnacl'in `secretKey`i 64 bayttir ve tam olarak seed || publicKey'dir --
// @solana/web3.js'in `Keypair.secretKey`i ile ayni duzen (asagidaki capraz
// dogrulama bunu ayrica kilitliyor).
const RFC8032 = [
    {
        ad: 'TEST 1 -- bos mesaj',
        seed: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
        publicKey: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
        message: '',
        signature: 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
    },
    {
        ad: 'TEST 2 -- tek bayt (0x72)',
        seed: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
        publicKey: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
        message: '72',
        signature: '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
    },
]

describe('signMessageBytes -- RFC 8032 resmi vektorleri', () => {
    for (const v of RFC8032) {
        it(`${v.ad}: beklenen 64 baytlik imzayi uretir`, () => {
            const secretKey = fromHex(v.seed + v.publicKey)
            const signature = signMessageBytes(fromHex(v.message), secretKey)

            expect(signature).toBeInstanceOf(Uint8Array)
            expect(signature.length).toBe(64)
            expect(hex(signature)).toBe(v.signature)
        })
    }
})

// CAPRAZ DOGRULAMA -- neden gerekli: yukaridaki vektorler tweetnacl'i
// dogruluyor ama CUZDANIN gercekten kullanacagi anahtarla degil. Burada
// anahtar deriveSolanaKeypair'den (SLIP-0010 + @solana/web3.js) geliyor ve
// imza tweetnacl'a HIC dokunmayan bagimsiz bir dogrulayiciyla -- Node'un
// WebCrypto Ed25519 uygulamasiyla -- kontrol ediliyor. Yani test "tweetnacl
// tweetnacl'i dogruluyor" tuzagina dusmuyor.
describe('turetilen anahtarla capraz dogrulama (WebCrypto Ed25519)', () => {
    const verify = async (publicKeyBytes, signature, message) => {
        const key = await crypto.subtle.importKey(
            'raw', publicKeyBytes, { name: 'Ed25519' }, false, ['verify']
        )
        return crypto.subtle.verify('Ed25519', key, signature, message)
    }

    it('deriveSolanaKeypair anahtariyla uretilen imza bagimsizca DOGRULANIR', async () => {
        const keypair = await deriveSolanaKeypair(MNEMONIC, 0)
        const message = new TextEncoder().encode('wats solana dapp baglayicisi')

        const signature = signMessageBytes(message, keypair.secretKey)

        expect(await verify(keypair.publicKey.toBytes(), signature, message)).toBe(true)
    })

    // Mesajin TEK BITI degisince imza dusmeli. Bu olmadan "her zaman true
    // donen" bir dogrulayici testi sessizce gecerdi.
    it('mesaj degisirse dogrulama BASARISIZ olur', async () => {
        const keypair = await deriveSolanaKeypair(MNEMONIC, 0)
        const enc = new TextEncoder()
        const signature = signMessageBytes(enc.encode('wats solana dapp baglayicisi'), keypair.secretKey)

        expect(await verify(
            keypair.publicKey.toBytes(), signature, enc.encode('wats solana dapp baglayicisi!')
        )).toBe(false)
    })

    // Farkli hesabin anahtari ayni mesaji imzalarsa imza FARKLI olmali --
    // aksi halde secretKey hic okunmuyor demektir.
    it('farkli hesap farkli imza uretir', async () => {
        const a = await deriveSolanaKeypair(MNEMONIC, 0)
        const b = await deriveSolanaKeypair(MNEMONIC, 1)
        const message = new TextEncoder().encode('ayni mesaj')

        expect(hex(signMessageBytes(message, a.secretKey)))
            .not.toBe(hex(signMessageBytes(message, b.secretKey)))
    })
})

describe('signMessageBytes girdi kapilari', () => {
    const SECRET = fromHex(RFC8032[0].seed + RFC8032[0].publicKey)

    it('ed25519 DETERMINISTIKTIR: ayni girdi ayni imzayi verir', () => {
        const message = new TextEncoder().encode('deterministik')
        expect(hex(signMessageBytes(message, SECRET)))
            .toBe(hex(signMessageBytes(message, SECRET)))
    })

    it('girdi baytlarini DEGISTIRMEZ', () => {
        const message = fromHex('deadbeef')
        signMessageBytes(message, SECRET)
        expect(hex(message)).toBe('deadbeef')
    })

    // 32 baytlik bir "secret key" sessizce kabul edilirse tweetnacl bellek
    // disini okur ya da anlamsiz bir imza uretir; ikisi de kullaniciya
    // "imzaladim" der ve dapp tarafinda dogrulanamaz.
    it('64 bayt olmayan secretKey acikca reddedilir', () => {
        expect(() => signMessageBytes(new Uint8Array(1), fromHex(RFC8032[0].seed)))
            .toThrow('SOLANA_SIGN_BAD_SECRET_KEY')
        expect(() => signMessageBytes(new Uint8Array(1), null))
            .toThrow('SOLANA_SIGN_BAD_SECRET_KEY')
    })

    it('Uint8Array olmayan mesaj acikca reddedilir', () => {
        expect(() => signMessageBytes('merhaba', SECRET)).toThrow('SOLANA_SIGN_BAD_MESSAGE')
        expect(() => signMessageBytes(null, SECRET)).toThrow('SOLANA_SIGN_BAD_MESSAGE')
    })
})

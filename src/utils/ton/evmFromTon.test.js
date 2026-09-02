import { describe, it, expect } from 'vitest'
import { Mnemonic, HDNodeWallet } from 'ethers'
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto'
import { evmMnemonicFromTonMnemonic, EVM_FROM_TON_DOMAIN } from './evmFromTon'

// TON ifadesinden EVM CUZDANI degil, EVM IFADESI turetiyoruz. Fark her seydir:
//
// Dogrudan anahtar turetmek (bip39.mnemonicToSeed'i TON ifadesine uygulamak) sessizce
// CALISIR - o fonksiyon saf PBKDF2'dir, saglama toplamina bakmaz - ama urettigi adresi
// BASKA HICBIR CUZDAN acamaz: 300 TON ifadesi olculdu, 0 tanesi BIP39 dogrulamasindan
// gecti. Kullanici 24 kelimesini MetaMask'e yazar, "gecersiz ifade" der, parasi gider.
//
// Burada uretilen sey GECERLI bir BIP39 ifadesidir: saglama toplami dogru, her cuzdan
// kabul eder. Kullaniciya ozel olan tek sey TURETME KURALI - ve o kural belgeleniyor.

const TON_SEED_BYTES = 32

async function tonSeedOf(words) {
    const kp = await mnemonicToPrivateKey(words)
    return new Uint8Array(kp.secretKey.slice(0, TON_SEED_BYTES))
}

describe('evmMnemonicFromTonMnemonic — uretilen sey GECERLI bir BIP39 ifadesidir', () => {
    it('24 kelimelik, saglama toplami DOGRU bir ifade uretir', async () => {
        const words = await mnemonicNew()
        const phrase = await evmMnemonicFromTonMnemonic(words.join(' '))

        expect(phrase.split(' ')).toHaveLength(24)
        // ethers saglama toplamini DOGRULAR; gecersiz ifade burada firlatir.
        expect(Mnemonic.isValidMnemonic(phrase)).toBe(true)
    })

    // Bu testin varlik sebebi: standart bir cuzdanin ayni adresi bulabilmesi. Uretilen
    // ifade yalnizca "gecerli" degil, KULLANILABILIR olmali.
    it('uretilen ifadeden standart yolla EVM adresi cikar', async () => {
        const words = await mnemonicNew()
        const phrase = await evmMnemonicFromTonMnemonic(words.join(' '))

        const wallet = HDNodeWallet.fromPhrase(phrase)
        expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    })

    it('AYNI TON ifadesi HER ZAMAN ayni EVM ifadesini verir', async () => {
        const words = await mnemonicNew()
        const a = await evmMnemonicFromTonMnemonic(words.join(' '))
        const b = await evmMnemonicFromTonMnemonic(words.join(' '))
        expect(a).toBe(b)
    })

    it('FARKLI TON ifadeleri farkli EVM ifadeleri verir', async () => {
        const [w1, w2] = [await mnemonicNew(), await mnemonicNew()]
        const a = await evmMnemonicFromTonMnemonic(w1.join(' '))
        const b = await evmMnemonicFromTonMnemonic(w2.join(' '))
        expect(a).not.toBe(b)
    })

    // Bosluk/buyuk-kucuk harf toleransi TON tarafinda zaten var; ayni girdi normalize
    // edildikten sonra AYNI cikti vermeli, yoksa kullanicinin ifadeyi bir bosluk fazla
    // yapistirmasi BASKA bir cuzdan uretirdi.
    it('fazladan bosluk ayni sonucu verir', async () => {
        const words = await mnemonicNew()
        const a = await evmMnemonicFromTonMnemonic(words.join(' '))
        const b = await evmMnemonicFromTonMnemonic('  ' + words.join('   ') + '  ')
        expect(a).toBe(b)
    })

    it('gecersiz TON ifadesi FIRLATIR - sessizce bir cuzdan uydurmaz', async () => {
        await expect(evmMnemonicFromTonMnemonic('not a ton mnemonic at all'))
            .rejects.toThrow('TON_MNEMONIC_INVALID')
    })
})

describe('evmMnemonicFromTonMnemonic — turetme kurali', () => {
    // Alan ayirici SABITTIR ve degistirilemez: degisirse AYNI TON ifadesi BASKA bir EVM
    // cuzdani uretir ve kullanicinin eski adresindeki para, uygulamada artik
    // ulasilamaz hale gelir. Surum eki (v1) bilincli - kural degisirse yeni ad alir.
    it('alan ayirici sabittir', () => {
        expect(EVM_FROM_TON_DOMAIN).toBe('wats/evm-from-ton/v1')
    })

    // ALTIN VEKTOR: kural, kutuphaneden BAGIMSIZ olarak yeniden hesaplanabilmeli.
    // Bu test kuralin BELGESIDIR - biri uygulamayi degistirirse burasi kirilir ve
    // "neden kirildi" sorusunun cevabi "kullanicilarin adresleri degisecekti" olur.
    it('kural elle yeniden hesaplanabilir - HMAC-SHA512(alan, tohum)[0..32]', async () => {
        const words = await mnemonicNew()
        const seed = await tonSeedOf(words)

        const key = await crypto.subtle.importKey(
            'raw', new TextEncoder().encode(EVM_FROM_TON_DOMAIN),
            { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
        )
        const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, seed))
        const expected = Mnemonic.fromEntropy(mac.slice(0, 32)).phrase

        expect(await evmMnemonicFromTonMnemonic(words.join(' '))).toBe(expected)
    })

    // TON tohumunun KENDISI entropi olarak kullanilmamali. Kullanilsaydi EVM ozel
    // anahtari ile TON ozel anahtari ayni 32 bayttan dogardi; birini disa aktarmak
    // digerini de ele verirdi. HMAC tek yonludur ve bu bagi keser.
    it('TON tohumu DOGRUDAN entropi olarak kullanilmaz', async () => {
        const words = await mnemonicNew()
        const seed = await tonSeedOf(words)
        const naive = Mnemonic.fromEntropy(seed).phrase

        expect(await evmMnemonicFromTonMnemonic(words.join(' '))).not.toBe(naive)
    })
})

import { describe, it, expect } from 'vitest'
import { isTonMnemonic, tonKeyPairFromTonMnemonic, TON_MNEMONIC_WORDS } from './tonMnemonic'
import { tonWalletAddress } from './tonAccount'
import { toFriendlyTon } from './tonAddress'

// ALTIN VEKTOR — spec §13. Bu ifade HICBIR YERDE KULLANILMAMIS, fonsuzdur.
// Iki standartta da gecerli olmasi BILEREK secildi: Task 7'deki cakisma kapisi
// bu ayni vektoru kullaniyor ve iki turetme FARKLI adres uretiyor. Yanlis dala
// dusen bir uygulama yanlis adresi uretir ve test gorur.
const DUAL = 'logic service expect film garbage twist fabric shop grow patient toe furnace index certain gym occur rabbit caution injury zero language brother minimum water'
const DUAL_TON_ADDRESS = 'UQB1-bGBpFuFl8Ho83XCuq1dJUYcMgBu2zSobPATzsSjCm7q'

// Saglamasi testi: gercek bir BIP39 24-kelimelik ifade (tum kelimeler listede,
// BIP39 olarak gecerli) ama TON saglamasi yok. Sadece bu test mnemonicValidate'a
// uzunluk garantisi vermez de ulasiyor — saglamasi aslinda kontrollu oldugu zaman.
const NOT_TON = 'decide moment method certain olive canyon auto eager pass shift seek any march resist nest bulb convince hen lemon elder control system diet bird'

describe('isTonMnemonic', () => {
    it('gercek bir TON ifadesini tanir', async () => {
        expect(await isTonMnemonic(DUAL)).toBe(true)
    })

    // Kelime dizisi de metin de kabul edilmeli: cagiran taraflardan biri (ice
    // aktarma ekrani) diziyle, digeri (kasa cozumu) metinle geliyor.
    it('kelime dizisini de kabul eder', async () => {
        expect(await isTonMnemonic(DUAL.split(' '))).toBe(true)
    })

    // 24 DISI uzunluk HIC denenmez. TON standardi 24 kelimedir; 12 kelimelik bir
    // BIP39 ifadesini TON olarak yoklamak bos is ve yanlis pozitif riskidir.
    it('24 kelime olmayan ifadeyi DENEMEDEN reddeder', async () => {
        expect(await isTonMnemonic('abandon abandon abandon')).toBe(false)
    })

    it('bos/gecersiz girdide false doner, FIRLATMAZ', async () => {
        expect(await isTonMnemonic('')).toBe(false)
        expect(await isTonMnemonic(null)).toBe(false)
        expect(await isTonMnemonic(undefined)).toBe(false)
    })

    it('TON_MNEMONIC_WORDS 24 tir', () => {
        expect(TON_MNEMONIC_WORDS).toBe(24)
    })

    it('saglama basarisiz olan 24-kelimelik BIP39 ifadesini reddeder', async () => {
        expect(await isTonMnemonic(NOT_TON)).toBe(false)
    })
})

describe('tonKeyPairFromTonMnemonic', () => {
    // ALTIN VEKTOR: bu adres degisirse turetme degismis demektir.
    it('altin vektorun W5 adresini uretir', async () => {
        const kp = await tonKeyPairFromTonMnemonic(DUAL)
        const address = toFriendlyTon(tonWalletAddress(kp.publicKey))
        expect(address).toBe(DUAL_TON_ADDRESS)
    })

    it('ed25519 anahtar cifti dondurur', async () => {
        const kp = await tonKeyPairFromTonMnemonic(DUAL)
        expect(kp.publicKey).toHaveLength(32)
        expect(kp.secretKey).toHaveLength(64)
    })

    // Gecersiz ifade SESSIZCE bir anahtar uretmemeli: uretirse kullanici yazim
    // hatasi yaptigi bir ifadeyle bos bir cuzdana yerlesir ve sebebini goremez.
    it('gecersiz ifadeyi reddeder', async () => {
        await expect(tonKeyPairFromTonMnemonic('abandon abandon abandon'))
            .rejects.toThrow('TON_MNEMONIC_INVALID')
    })

    it('saglama basarisiz olan 24-kelimelik BIP39 ifadesini reddeder', async () => {
        await expect(tonKeyPairFromTonMnemonic(NOT_TON))
            .rejects.toThrow('TON_MNEMONIC_INVALID')
    })
})

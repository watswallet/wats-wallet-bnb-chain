/**
 * TON kurtarma ifadesinden EVM kurtarma IFADESI turetir.
 *
 * NEDEN ANAHTAR DEGIL IFADE:
 *
 * TON ifadesinden dogrudan bir EVM anahtari turetmek CALISIR ama kullaniciya
 * kurtarilamaz bir cuzdan verir. `bip39.mnemonicToSeed` saf PBKDF2'dir ve saglama
 * toplamina BAKMAZ - TON ifadesini verirsiniz, hata almazsiniz, bir adres cikar.
 * Sonra kullanici o 24 kelimeyi MetaMask'e yazar ve "gecersiz ifade" cevabini alir.
 * Olculdu: 300 TON ifadesinin 0 tanesi BIP39 dogrulamasindan gecti (2026-08-27).
 * O adresteki para yalnizca bizim uygulamamizda durur; uygulama giderse para gider.
 *
 * Bu dosya bunun yerine GECERLI BIR BIP39 IFADESI uretir: saglama toplami dogru,
 * MetaMask/Trust/Ledger kabul eder, standart yollardan kurtarilir. Kullaniciya ozel
 * olan tek sey TURETME KURALI - o da asagida yazili ve testte altin vektorle sabit.
 *
 * KURAL:
 *   TON ifadesi
 *     -> ed25519 tohumu (TON'un kendi semasi, tonMnemonic.js)
 *     -> HMAC-SHA512(anahtar = EVM_FROM_TON_DOMAIN, veri = tohum)
 *     -> ilk 32 bayt = entropi
 *     -> BIP39 ifadesi (24 kelime)
 *
 * TOHUM NEDEN DOGRUDAN ENTROPI DEGIL: dogrudan kullanilsaydi EVM ozel anahtari ile
 * TON ozel anahtari ayni 32 bayttan dogardi ve birini disa aktarmak digerini de ele
 * verirdi. HMAC tek yonludur; EVM ifadesini bilen TON tohumunu geri hesaplayamaz.
 *
 * `window` KULLANILMAZ: bu modul MV3 service worker'inda da calisabilmeli
 * (tonMnemonic.js'in bas yorumundaki ayni tuzak). Yalnizca ciplak `crypto.subtle`.
 */
import { Mnemonic } from 'ethers'
import { tonKeyPairFromTonMnemonic } from './tonMnemonic'

/**
 * Alan ayirici. DEGISTIRILEMEZ.
 *
 * Degisirse AYNI TON ifadesi BASKA bir EVM cuzdani uretir ve kullanicinin eski
 * adresindeki para uygulamada ulasilamaz hale gelir. Surum eki bilincli: kural
 * gercekten degismek zorunda kalirsa YENI bir ad alir (v2) ve eski ad, eski
 * cuzdanlari cozmek icin durur.
 */
export const EVM_FROM_TON_DOMAIN = 'wats/evm-from-ton/v1'

// ed25519 gizli anahtarinin ilk 32 bayti TOHUMDUR (kalan 32 bayt public key'dir).
const TON_SEED_BYTES = 32

// BIP39 24 kelime icin 256 bit entropi ister.
const ENTROPY_BYTES = 32

async function hmacSha512(keyBytes, dataBytes) {
    const key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-512' },
        false,
        ['sign']
    )
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes))
}

/**
 * @param {string} tonMnemonic 24 kelimelik TON kurtarma ifadesi
 * @returns {Promise<string>} 24 kelimelik GECERLI BIP39 ifadesi
 * @throws {Error} TON_MNEMONIC_INVALID — ifade TON semasina gore gecersizse
 */
export async function evmMnemonicFromTonMnemonic(tonMnemonic) {
    // Dogrulama tonKeyPairFromTonMnemonic'e birakiliyor: TON ifadesinin gecerliligi
    // TEK bir yerde tanimli olmali. Gecersizse TON_MNEMONIC_INVALID firlatir ve
    // burada YUTULMAZ - sessizce bir cuzdan uydurmak, hata vermekten kotudur.
    const keyPair = await tonKeyPairFromTonMnemonic(tonMnemonic)

    const seed = new Uint8Array(keyPair.secretKey.slice(0, TON_SEED_BYTES))
    const mac = await hmacSha512(new TextEncoder().encode(EVM_FROM_TON_DOMAIN), seed)

    return Mnemonic.fromEntropy(mac.slice(0, ENTROPY_BYTES)).phrase
}

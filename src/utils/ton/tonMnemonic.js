// TON'un KENDI mnemonic semasi.
//
// BIP39 DEGILDIR. Ayni 2048 kelimelik Ingilizce listeyi kullanir (olculdu: 720/720
// kelime listede) ama saglamasi farklidir ve TURETME YOLU YOKTUR — kelimeler
// dogrudan ed25519 anahtarina doner.
//
// Bu yuzden bir TON ifadesi BIP39 dogrulamasindan gecemez (olculdu: 0/40) ve
// bugune kadar ice aktarilamiyordu.
//
// AG YOK, DEPO YOK: yalnizca hesaplama.
//
// ---------------------------------------------------------------------------
// NEDEN @ton/crypto'nun mnemonic FONKSIYONLARI KULLANILMIYOR
// ---------------------------------------------------------------------------
// `mnemonicValidate` ve `mnemonicToPrivateKey` iki ilkel'e iner:
// `@ton/crypto/dist/primitives/{hmac_sha512,pbkdf2_sha512}` -> `@ton/crypto-primitives`.
// O paketin package.json'i YALNIZCA `main` (./dist/node.js) ve `browser`
// (./dist/browser.js) alanlarini tasir; `module` ve `exports` YOKTUR. Vite bu
// durumda `browser` derlemesini secer ve o derlemedeki
// `dist/browser/hmac_sha512.js` ile `dist/browser/pbkdf2_sha512.js`
// `window.crypto.subtle` OKUR (getSecureRandom.js de oyle).
//
// MV3'te arka plan bir SERVICE WORKER'dir ve orada `window` TANIMSIZDIR: cagri
// turetmeye baslamadan `ReferenceError: window is not defined` ile duser. Yani
// kutuphane fonksiyonu popup'ta calisir, IMZALAMA YOLUNDA calismaz — en kotu
// hata sekli: testte ve arayuzde yesil, kullanici "gonder"e bastiginda kirik.
//
// Testler bunu GOREMEZ: vitest node ortaminda kosuyor ve node cozumlemesi ayni
// paketin `main` alanini (dist/node.js) secer — window'a hic ugranmaz. Bu yuzden
// kapi `tonMnemonicSwSafety.test.js`te YAPISAL olarak kilitlendi.
//
// tonAccount.js'in bas yorumu ayni tuzagi zaten olcup anlatiyor ve HMAC'i kendi
// yaziyor. Burada da ayni sey yapiliyor: TON'un semasi CIPLAK `crypto.subtle`
// uzerine kuruldu. Ihtiyac duyulan iki ilkel de (PBKDF2-HMAC-SHA512 ve
// HMAC-SHA512) WebCrypto'da YERLESIK — hem popup'ta hem service worker'da
// calisir, hicbir global'e dokunulmaz.
//
// Semanin kaynagi tonlib'dir (Mnemonic.cpp) ve @ton/crypto ile BIREBIR ayni
// adimlardir; altin vektor `tonMnemonic.test.js`te sabit (UQB1-bGB...). Bu
// dosyada bir sapma olursa o test kirilir.

import { keyPairFromSeed, mnemonicWordList } from '@ton/crypto'

// TON standardi 24 kelimedir. Baska bir uzunluk DENENMEZ: 12 kelimelik bir BIP39
// ifadesini TON olarak yoklamak hem bos is hem de yanlis pozitif riskidir.
export const TON_MNEMONIC_WORDS = 24

// tonlib: PBKDF_ITERATIONS = 100000. "TON seed version" kontrolu bunun 256'da
// birini kullanir (Math.max(1, floor(100000/256)) = 390).
const PBKDF_ITERATIONS = 100000
const BASIC_SEED_ITERATIONS = Math.max(1, Math.floor(PBKDF_ITERATIONS / 256))
const SEED_BYTES = 64

const encoder = new TextEncoder()

// Kelime listesi @ton/crypto'dan gelir (`mnemonic/wordlist.js` — SAF VERI, hicbir
// ilkel'e dokunmaz, dolayisiyla service worker'da guvenlidir). Elle kopyalanmadi:
// ikinci bir kopya, kutuphane listesiyle sessizce sapabilecek ikinci bir gercek olurdu.
const WORDLIST = new Set(mnemonicWordList)

// DISA AKTARILDI: tonMamMnemonic.js ayni iki ilkeli kullanir (MAM'in gecerlilik
// kurali da HMAC-SHA512 + PBKDF2-HMAC-SHA512 uzerine kurulu). Ikinci bir kopya
// yazmak, sessizce sapabilecek ikinci bir gercek olurdu.
export async function hmacSha512(keyBytes, dataBytes) {
    const key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-512' },
        false,
        ['sign']
    )
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes))
}

export async function pbkdf2Sha512(keyBytes, saltBytes, iterations, byteLength) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'PBKDF2' }, false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-512', salt: saltBytes, iterations },
        key,
        byteLength * 8
    )
    return new Uint8Array(bits)
}

// tonlib Mnemonic::to_entropy — hmac_sha512(ANAHTAR = kelimeler bosluklu, VERI = parola).
// Sira onemli: anahtar ifade, veri parola. Ters cevrilirse baska bir entropi cikar.
//
// Parola DESTEKLENMIYOR (spec §4): parolali bir TON ifadesi dogrulamadan gecemez
// ve TON_MNEMONIC_INVALID verir — kabul edilen bir sinirlama. Bu yuzden veri BOS.
async function mnemonicToEntropy(words) {
    return await hmacSha512(encoder.encode(words.join(' ')), new Uint8Array(0))
}

// tonlib Mnemonic::is_basic_seed — TON'un SAGLAMASI budur. BIP39'daki gibi
// kelimelere gomulu bir saglama biti yoktur; gecerlilik, entropiden turetilen
// hash'in ilk baytinin 0 olmasidir.
async function isBasicSeed(entropy) {
    const seed = await pbkdf2Sha512(
        entropy,
        encoder.encode('TON seed version'),
        BASIC_SEED_ITERATIONS,
        SEED_BYTES
    )
    return seed[0] === 0
}

// tonlib Mnemonic::to_seed + to_private_key.
async function tonSeedFromWords(words) {
    const entropy = await mnemonicToEntropy(words)
    return await pbkdf2Sha512(
        entropy,
        encoder.encode('TON default seed'),
        PBKDF_ITERATIONS,
        SEED_BYTES
    )
}

function toWords(input) {
    if (Array.isArray(input)) return input.map((w) => String(w).trim().toLowerCase())
    if (typeof input !== 'string') return null
    const trimmed = input.trim()
    if (!trimmed) return null
    return trimmed.toLowerCase().split(/\s+/)
}

// @ton/crypto'nun `mnemonicValidate`i ile AYNI iki adim: once her kelime listede
// mi, sonra entropi "basic seed" mi. Kelime kontrolu once gelir cunku listede
// olmayan bir kelime 390 turluk PBKDF2'yi hic hak etmez.
async function isValidTonWords(words) {
    for (const word of words) {
        if (!WORDLIST.has(word)) return false
    }
    return await isBasicSeed(await mnemonicToEntropy(words))
}

/**
 * FIRLATMAZ. Cagiran taraf (ice aktarma ekrani) bunu bir SORU olarak soruyor —
 * "bu ifade TON mu?" — ve hayir cevabi bir hata degildir.
 */
export async function isTonMnemonic(input) {
    const words = toWords(input)
    if (!words || words.length !== TON_MNEMONIC_WORDS) return false
    try {
        return await isValidTonWords(words)
    } catch {
        return false
    }
}

/**
 * FIRLATIR. Buraya gelindiginde ifadenin gecerli oldugu ZATEN bilinmelidir;
 * gecersizse sessizce bir anahtar uretmek, kullaniciyi bos bir cuzdana
 * yerlestirip sebebini gizlemek olurdu.
 */
export async function tonKeyPairFromTonMnemonic(input) {
    const words = toWords(input)
    if (!words || words.length !== TON_MNEMONIC_WORDS) {
        throw new Error('TON_MNEMONIC_INVALID')
    }
    if (!(await isValidTonWords(words))) {
        throw new Error('TON_MNEMONIC_INVALID')
    }

    // Tohumun ILK 32 BAYTI ed25519 tohumudur (tonlib: PrivateKey::LENGTH).
    // keyPairFromSeed yalnizca tweetnacl'e iner — WebCrypto'ya ya da window'a
    // dokunmaz, service worker'da guvenlidir.
    const seed = await tonSeedFromWords(words)
    return keyPairFromSeed(seed.slice(0, 32))
}

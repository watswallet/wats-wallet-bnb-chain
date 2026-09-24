/**
 * Tonkeeper MAM (Multi-Account Mnemonic) TANIMA -- yalnizca tanima.
 *
 * MAM Tonkeeper'in cok hesapli semasidir: TEK ifade -> N hesap. Kelime listesi
 * ayni ama saglama farklidir: olculdu (2026-09-09), 40 MAM ifadesinden 0'i BIP39
 * checksum'indan, 0'i TON-native version kontrolunden gecti.
 *
 * NEDEN TANIYORUZ AMA ICE AKTARMIYORUZ (tasarim belgesi Y4):
 *   - MAM tek ifadeden N hesap dogurur; hesap olusturma/adlandirma/silme
 *     akislarina yeni bir kavram sokar. Ayri bir is.
 *
 * Kazanc simdiden gercek: bugun bir MAM KOK ifadesi girildiginde kullanici
 * "gecersiz ifade" goruyor ve elindeki SAGLAM ifadeyi bozuk sanip yeni cuzdan
 * kuruyor.
 *
 * KULLANICIYA NE SOYLENIYOR -- OLCULDU (2026-09-11). MAM'in her ALT HESABININ
 * kendi 24 kelimelik TON-native ifadesi var ve bizim ice aktarmamiz onu ZATEN
 * kabul ediyor (`root.getTonAccount(i).mnemonics` -> mnemonicValidate true,
 * 3/3). Reddedilen sey yalnizca KOK ifadedir. Bu yuzden mesaj kullaniciyi o
 * calisan yola yonlendirir; eski hali "Tonkeeper'da hesabi tek ifadeye cevir"
 * diyordu ve Tonkeeper'da oyle bir islem YOK -- kullaniciya imkansiz bir is
 * soyluyordu.
 *
 * ---------------------------------------------------------------------------
 * NEDEN `@ton-keychain/core` URETIM KODUNDA KULLANILMIYOR
 * ---------------------------------------------------------------------------
 * Kural once o paketten okundu, sonra buraya tasindi. Uc olculmus sebep
 * (2026-09-11):
 *
 *   1. LISANS. Paket GPL-3.0'dir. Bu uzanti kapali kaynaktir (`private: true`,
 *      LICENSE yok) ve paket yayinlanan bundle'a giriyordu
 *      (`dist/assets/onboarding-*.js`) -- deponun TEK saf GPL bagimliligiydi.
 *   2. MV3. Paket `@ton/crypto` -> `@ton/crypto-primitives`in TARAYICI
 *      derlemesine iniyor ve o derleme `window.crypto.subtle` OKUR; service
 *      worker'da `window` yoktur. Ayrintili anlatimi tonMnemonic.js'in bas
 *      yorumunda. Asagidaki uygulama CIPLAK `crypto.subtle` kullanir, yani
 *      insaat geregi hem popup'ta hem service worker'da calisir.
 *   3. KIRIK TARAYICI YOLU. Paketin `hmac_sha256`i node'un `crypto.createHmac`ini
 *      import eder; Vite bunu tarayici icin `(void 0)` olarak derliyordu
 *      (derleme uyarisi: "createHmac is not exported by __vite-browser-external").
 *      Yani `calculateId`/`getTonAccount`/`generate` tarayicida ZATEN kirikti.
 *
 * ARGON2 YOKTUR. Daha eski bir not oyle diyordu; olculdu ve YANLIS cikti --
 * v0.0.4'un bagimliliklari yalnizca @scure/bip39 + @ton/crypto.
 *
 * Paket devDependency olarak DURUYOR: tonMamMnemonic.test.js asagidaki
 * uygulamayi rastgele uretilmis ifadelerde ONA KARSI kosturur. Sema saparsa o
 * fark testi kirilir. devDependency yayinlanan pakete girmez.
 *
 * KURALIN KAYNAGI (@ton-keychain/core v0.0.4, ton-keychain-root.ts):
 *     isValidMnemonicLegacy(m) =
 *         pbkdf2_sha512(hmac_sha512("TON Keychain", m.join(" ")),
 *                       "TON Keychain Version", 1, 64)[0] === 0
 *     isValidMnemonic(m) = isValidMnemonicLegacy(m) && !mnemonicValidate(m)
 */
import { isTonMnemonic, hmacSha512, pbkdf2Sha512 } from './tonMnemonic'

// MAM her zaman 24 kelimedir (KeychainTonAccount.MNEMONICS_WORDS_NUMBER = 24).
const MAM_MNEMONIC_WORDS = 24

// Kutuphanenin sabitleri. Bunlar SEMANIN KENDISIDIR: biri degisirse baska bir
// ifade kumesi MAM sayilir. Fark testi bu dosyayi kutuphaneye bagli tutar.
const MAM_HMAC_KEY = 'TON Keychain'
const MAM_PBKDF_SALT = 'TON Keychain Version'
const MAM_PBKDF_ITERATIONS = 1
const MAM_PBKDF_BYTES = 64

const encoder = new TextEncoder()

const toWords = (input) => {
    if (Array.isArray(input)) return input.map((w) => String(w).trim().toLowerCase())
    if (typeof input !== 'string') return null
    const trimmed = input.trim()
    if (!trimmed) return null
    return trimmed.toLowerCase().split(/\s+/)
}

// isValidMnemonicLegacy. DIKKAT -- anahtar/veri sirasi TON'un kendi semasinin
// TERSIDIR: burada ANAHTAR sabit etiket, VERI ifadedir. tonMnemonic.js'te ise
// anahtar ifade, veri paroladir. Ters cevrilirse baska bir kume MAM gorunur.
async function isMamSeed(words) {
    const mnemonicHash = await hmacSha512(
        encoder.encode(MAM_HMAC_KEY),
        encoder.encode(words.join(' '))
    )
    const result = await pbkdf2Sha512(
        mnemonicHash,
        encoder.encode(MAM_PBKDF_SALT),
        MAM_PBKDF_ITERATIONS,
        MAM_PBKDF_BYTES
    )
    return result[0] === 0
}

/**
 * FIRLATMAZ. Cagiran taraf bunu bir SORU olarak soruyor -- "bu ifade MAM mi?" --
 * ve hayir cevabi bir hata degildir.
 *
 * CAGRI KOSULU -- ONEMLI. Tek iterasyonluk PBKDF2'nin ilk baytinin 0 olmasi
 * ~1/256 olasiliktir, yani RASTGELE bir ifade de MAM gorunebilir. Olculdu
 * (2026-09-11, n=3000): gecerli 24 kelimelik BIP39 ifadelerinin %0.57'si (~1/176)
 * bu kapiyi geciyor. Bu yuzden soru yalnizca ifade BIP39'dan da TON-native'den de
 * KALDIGINDA sorulmalidir -- ImportPhrases.vue'daki kosul budur ve
 * tonImportWiring.test.js onu kilitler. Kosulsuz sorulursa her ~176 MetaMask ice
 * aktarmasi kalici olarak reddedilir.
 *
 * @param {string|string[]} input
 * @returns {Promise<boolean>}
 */
export async function isMamMnemonic(input) {
    const words = toWords(input)
    if (!words || words.length !== MAM_MNEMONIC_WORDS) return false
    try {
        if (!(await isMamSeed(words))) return false
        // Kutuphane TON-uyumlu ifadeleri ACIKCA disliyor (`!isTonCompatible`):
        // aileler ORTUSMEZ. isTonMnemonic, @ton/crypto'nun `mnemonicValidate`i
        // ile ayni iki adimi yapar (kelime listesi + basic seed).
        return !(await isTonMnemonic(words))
    } catch {
        return false
    }
}

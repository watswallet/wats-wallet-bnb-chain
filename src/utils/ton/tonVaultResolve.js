// TON kasa/sema COZUMLEMESI -- SAF fonksiyonlar, AGIR IMPORT YOK.
//
// NEDEN AYRI BIR DOSYA (2026-09-11). Bu fonksiyonlar `tonIdentity.js` icindeydi.
// `TonConnectApprove.vue` hesap kapisini `tonSignerReady` ile kurunca o bilesen
// tonIdentity'nin BUTUN zincirini (crypto-utils -> deriveAccount -> masterKey ->
// tonAccount -> @ton/*) popup paketine cekti. OLCULDU: bilesenin SSR testinde 16
// testten 10'u kirildi -- bilesen artik render bile olmuyordu.
//
// Buradaki hicbir fonksiyon kasa ACMAZ, anahtar URETMEZ, agi ya da depoyu OKUMAZ:
// yalnizca elindeki `vaults` dizisine ve hesap kaydina bakar. Bu yuzden hem
// service worker'da, hem popup'ta, hem SSR testinde bedava calisirlar.
//
// `tonIdentity.js` hepsini YENIDEN DISA AKTARIR: mevcut cagiranlarin hicbiri
// degismedi ve "tek cozumleyici" sozlesmesi (sir bir kasadan, sema baska bir
// kasadan gelmesin) korunuyor.

import { accountHasTon } from '../accountKind'
import { findVaultForAccount } from '../deriveAccount'

// Kasa tipi -> turetme semasi. TEK KAYNAK: vault.type.
//
// Hesap kaydina ikinci bir kopya yazilmiyor - iki kaynak, birbirinden sapabilecek
// iki gercek demektir ve sapma bu dosyada YANLIS ADRES olarak gorunur.
//
// 2026-09-10: 'hd' dali eklendi. Once yalnizca 'tonMnemonic' kabul ediliyordu
// cunku TON adresi hicbir yerde sessizce turetilmiyordu. Artik her HD hesabin
// TON'u var ve ana ifadeden TURETILEN bir TON-native ifadeden geliyor.
//
// TAM ve FIRLATAN: 'privateKey' ve bilinmeyen tipler TON_VAULT_TYPE_INVALID alir.
// Tek secp256k1 anahtarindan ed25519 TURETILEMEZ ve bilinmeyen bir kayittan
// anahtar uretmek, kapatilmak istenen sessiz turetmenin ta kendisi.
/**
 * DISKTEKI `tonAddress` HANGI SEMADAN uretildi?
 *
 * NEDEN VAR (olculdu 2026-09-11). `origin/main` (1.7.0) her `type:'hd'` hesap
 * icin `tonAddress`i ESKI SLIP-10 semasindan (m/44'/607'/{i}') turetip DISKE
 * YAZIYOR: main'in `Header.vue`sinde `ensureTonAddress` oncesi hesap kapisi YOK
 * ve `secretKindForVault` orada 'hd' icin `undefined` donup sezgiye birakiyor.
 * Bu dal ayni hesap icin BASKA bir adres uretiyor (hesap basina turetilmis
 * TON-native ifade). Damga olmasaydi:
 *   - `ensureTonAddress` eski adresi ONBELLEK sayip donerdi -> arayuz sonsuza
 *     kadar artik imzalanamayan bir adres gosterirdi,
 *   - `tonIdentityForAccount` her imzada TON_ADDRESS_MISMATCH firlatirdi ->
 *     o hesaplarda TON tumden olurdu.
 * Damga, "eski kayitlarda tonAddress alani yoktur" varsayiminin YANLIS cikmasina
 * verilen cevaptir.
 *
 * DAMGASIZ kayit = eski sema. Yeni kayitlar acikca damgalanir.
 */
export const TON_SCHEME = 'derivedTonMnemonic'

/**
 * Diskteki `tonAddress` bu dalin semasindan mi uretildi?
 * Damgasiz (eski) kayitlarda `false` -- adres yeniden turetilir, eskisi
 * `tonAddressLegacy` altinda SAKLANIR (silinmez: kullanicinin orada fonu olabilir).
 */
export function tonAddressIsCurrentScheme(account) {
    return account?.tonScheme === TON_SCHEME
}

export function secretKindForVault(vault) {
    if (vault?.type === 'tonMnemonic') return 'tonMnemonic'
    if (vault?.type === 'hd') return 'derivedTonMnemonic'
    throw new Error('TON_VAULT_TYPE_INVALID')
}

/**
 * Hesabin TON kasasini bulur.
 *
 * Hibrit hesap (TON ifadesinden ice aktarilmis) EVM kasasinin `accounts`
 * dizisinde yasar - EVM yolu onu orada bulur ve hic degismez. TON tarafi ise
 * BASKA bir kasadan gelir; bag `account.tonFingerprint` ile kurulur.
 *
 * Bag kurulamiyorsa FIRLATIR, `findVaultForAccount`a DUSMEZ. Duseydi hibrit bir
 * hesabin TON adresi sessizce EVM kasasindan turetilir ve kullaniciya A adresi
 * gosterilirken B'nin anahtariyla imzalanirdi - background.js:290'da yazili kaza.
 *
 * 2026-09-10 ONCESINDE bu dal ERISILEMEZDI: `accountHasTon` kapisi `type:'hd'`
 * (+ `tonFingerprint` tasiyan eski hibrit kayit dahil) hesaplari tumden
 * reddediyordu. Artik HER `type:'hd'` hesabin TON'u var (Y1+Y3 karari), yani
 * kapi bu hesaplari da GECIRIYOR ve `tonFingerprint` tasiyan eski hibrit kayit
 * buraya GERCEKTEN ulasiyor - kendi TON kasasindan tam erisimle cozuluyor. Dal
 * SILINMIYOR (zaten SILINEMEZDI): iki cagiranin (`tonSecretForAccount` /
 * `tonIdentityForAccount`) AYNI cozumleyiciyi kullanma sozlesmesi buradan
 * geciyor; ayri cozumleme yazilirsa sir bir kasadan, sema baska bir kasadan gelir.
 *
 * `tonFingerprint` YOKSA bugunku davranis aynen korunur: `type:'ton'` hesap kendi
 * TON kasasinin `accounts[]` dizisinde yasar ve findVaultForAccount onu bulur.
 */
export function tonVaultForAccount(vaults, account) {
    if (account?.tonFingerprint) {
        const vault = Array.isArray(vaults)
            ? vaults.find((v) => v?.fingerprint === account.tonFingerprint)
            : null
        if (!vault) throw new Error('TON_VAULT_NOT_FOUND')
        return vault
    }
    return findVaultForAccount(vaults, account)
}

/**
 * Bu hesap TON imzalayabilir mi? FIRLATMAZ, boolean doner.
 *
 * TonConnect'in UC arka plan ucu ve onay ekrani BU fonksiyonu kullanir. Daha
 * once oralarda dogrudan `account.type === 'ton'` yaziyordu ve o tur artik
 * HICBIR akis tarafindan uretilmiyor (kayit defteri R6): yeni hesaplar da,
 * ice aktarilan Tonkeeper hesabi da `type:'hd'`. Sonuc TonConnect'in her
 * hesapta olu olmasiydi -- kullanici hicbir sey reddetmeden `code 300 /
 * "User rejected the request"` aliyordu.
 *
 * Soru TURE degil YETENEGE sorulur ve `tonIdentityForAccount`in kendi kapisiyla
 * AYNI uc adimdan gecer -- ayri bir kontrol yazilsaydi ekran "baglanabilirsin"
 * derken turetme duserdi:
 *   1. hesabin TON ailesi var mi (accountHasTon),
 *   2. TON kasasi COZULUYOR mu (tonVaultForAccount -- dangling `tonFingerprint`
 *      tasiyan eski hibrit kayit burada TON_VAULT_NOT_FOUND ile duser),
 *   3. kasa tipi gecerli bir TON semasina karsilik geliyor mu (secretKindForVault).
 * Ayrica INV-1: `type:'ton'` hesap TANIM GEREGI tonMnemonic kasasinda yasar.
 *
 * FAIL-CLOSED: kanit yoksa TON yok. Bu, "her redde sifir pencere" kuralinin
 * dayandigi sozdur -- turetilemeyecek bir anahtar icin onay penceresi ACILMAZ.
 */
export function tonSignerReady(vaults, account) {
    if (!accountHasTon(account)) return false
    try {
        const vault = tonVaultForAccount(vaults, account)
        if (!vault) return false
        if (account?.type === 'ton' && vault?.type !== 'tonMnemonic') return false
        secretKindForVault(vault)
        return true
    } catch {
        return false
    }
}

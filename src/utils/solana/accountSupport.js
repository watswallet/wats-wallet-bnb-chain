/**
 * Hesap Solana imzalayabilir mi?
 *
 * Ice aktarilmis hesaplarin sirri bir secp256k1 private key'idir ve ondan ed25519
 * anahtari TURETILEMEZ.
 *
 * 2026-09-10: bu kosul eskiden `accountHasTon(account)` da okuyordu. O zaman
 * TON hesabinin sirri bir TON ifadesiydi ve bip39.mnemonicToSeed onu KABUL EDIP
 * (saf PBKDF2, checksum yok) Phantom/Solflare'in hic uretmeyecegi bir adres
 * cikariyordu. Artik ice aktarilan TON hesabi da evmFromTon ile turetilmis
 * GECERLI bir BIP39 ifadesine sahip, yani Solana'si standart yoldan cikiyor.
 * Kosul kaldirildi -- birakilsaydi accountHasTon HD hesapta da true donecegi
 * icin HER hesap Solana'yi kaybederdi.
 *
 * DUZELTME (R8, 2026-09-11): yukaridaki kaldirma AŞIRI gitmisti. O anki
 * gerekce "ice aktarilan TON hesabi artik gecerli bir BIP39 ifadesine sahip"
 * dogruydu AMA o hesap `type:'hd'`dir (+ `tonFingerprint`, buildHybridTonAccount),
 * `type:'ton'` DEGIL. `type:'ton'` ESKI/legacy kayittir (bkz. accountKind.js
 * R6 duzeltmesi): kasasi 'tonMnemonic'dir ve icinde BIP-39 sirri YOKTUR, yani
 * ed25519 hic TURETILEMEZ. `assertSolanaDerivable` bu kombinasyonu (vault.type
 * !== 'hd') zaten reddediyordu, ama bu fonksiyon (arayuzun arka uca SORMADAN
 * ONCE sordugu ON KAPI) 'ton'u GECIRIYORDU -- yani kullanici "Solana
 * destekleniyor" sanip Onayla'ya basiyor, turetme arka planda kesin patliyor
 * ve pencere hicbir aciklama olmadan kapaniyordu. `type:'ton'` burada da
 * reddedilir; ON KAPI ile `assertSolanaDerivable` AYNI cevabi vermeli.
 * Y2'nin sozu ZARAR GORMEZ: ice aktarilan TON hesabi zaten `type:'hd'` ve bu
 * kontrolden ETKILENMEDEN gecmeye devam eder.
 *
 * Gercek/son kapi asagidaki `assertSolanaDerivable`: turetme BIP39 ifadesi
 * isteyen bir kasadan yapilir ve o kontrol KASA TIPINE bakar, hesap turune
 * degil. Bu fonksiyon o kapiyi TEKRARLAMAZ, yalnizca hesap TURUNDEN kesin
 * olarak bilinen "asla" durumlarini (ozel anahtar, legacy TON) erken eler.
 *
 * Bilinmeyen/eksik hesap ENGELLENMEZ — bilinmeyeni desteklenmiyor saymak gecerli
 * bir hesapla gelen kullaniciyi da kilitlerdi.
 */
export function isSolanaUnsupportedAccount(account) {
    return account?.type === 'imported'
        || account?.type === 'privateKey'
        || account?.type === 'ton'
}

/**
 * Turetmeden ONCE calisan kasa TIPI kapisi.
 *
 * Bunu neden bir yuklem degil de FIRLATAN bir iddia yaptik: alti cagri
 * noktasinin dordu zaten `throw` ediyordu, ikisi `sendResponse` ile donuyordu.
 * Tek bir cagri satiri hepsinin yerini alsin diye kural burada firlatir;
 * yanit kodunu KORUMASI gereken iki nokta cagriyi kendi try/catch'ine alir.
 *
 * Yerini aldigi sey: `if (!mnemonic || !mnemonic.includes(' ')) reject`.
 * O sezgi 24 kelimelik TON ifadesini BIP39 sanip GECIRIYORDU ve
 * bip39.mnemonicToSeed saf PBKDF2 oldugu icin checksum'da da yakalanmiyordu.
 *
 * Kasa tipleri UCTUR ve ucunu de BIZ yaziyoruz:
 *   'hd'          -> createVault              (crypto-utils.js:206)
 *   'privateKey'  -> createVaultWithPrivateKey (crypto-utils.js:178)
 *   'tonMnemonic' -> createTonVault           (crypto-utils.js:243)
 * BIP39 ifadesi YALNIZCA 'hd' kasasinda bulunur. Ifadeyle ICE AKTARILAN EVM
 * cuzdani da 'hd'dir (ImportPhrases.vue:390, CreatePassword2.vue:222 ->
 * createVault), yani mesru hicbir turetme kesilmez.
 *
 * FAIL-CLOSED: isSolanaUnsupportedAccount'un aksine bilinmeyen kasa tipi
 * GECMEZ. Hesap alanini kullanicinin verisi doldurabilir; kasa tipini yalnizca
 * biz yaziyoruz, dolayisiyla tanimadigimiz bir tip bozulmadir.
 */
export function assertSolanaDerivable(account, vault) {
    if (isSolanaUnsupportedAccount(account)) throw new Error('SOLANA_UNSUPPORTED_ACCOUNT')
    if (vault?.type !== 'hd') throw new Error('SOLANA_UNSUPPORTED_ACCOUNT')
}

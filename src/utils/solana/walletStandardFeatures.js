// Wallet Standard'a BILDIRILEN metadata -- TEK gercek kaynak.
//
// KOK NEDEN (tonConnectDevice.js'teki olum-sonrasi incelemenin Solana karsiligi):
// TON'da yetenek listesinin uc kopyasi vardi, ikisi `features: []` ile kalmisti ve
// SDK yetenegi bizim hic bakmadigimiz kopyadan okudugu icin her islem/imza bize
// ULASMADAN reddedildi. Baglanti calisir gorunuyordu.
//
// Solana'da ikinci bir kopya KACINILMAZ: solanaInjected.js hicbir sey import
// edemez (@crxjs import tasiyan MAIN-world betigini asenkron yukleyiciye sarar ve
// window.solana document_start'ta senkron var olmaz). O kopya ELLE degil,
// scripts/gen-wallet-standard-metadata.mjs ile buradan URETILIR ve
// solanaProviderConformance.test.js ikisinin bayt-birebir ayni oldugunu kilitler.
//
// SAF MODUL: chrome YOK, ag YOK. Yalnizca METADATA -- cagrilabilir metotlar sayfa
// betiginde `{ ...metadata[key], <metotAdi> }` ile birlestirilir; fonksiyonlar
// metadata olamaz (JSON'a yazilamazlar).

export const SOLANA_MAINNET_CHAIN = 'solana:mainnet'

// Toplu imzalama POLITIKA siniri -- bir BILDIRIM degil. Wallet Standard'da boyle
// bir alan yoktur; gerekcesi onay ekraninda gozden gecirilebilirliktir. Asildiginda
// SOLANA_TOO_MANY_TRANSACTIONS doner.
export const MAX_BATCH_TRANSACTIONS = 20

// KAPI 5 boyut sinirlamasi (spec 4.3.1: "Yuk dogrulama (base64, surum, sayi,
// BOYUT)"). Gercek bir Solana islemi tek paket sinirini (1232 bayt) asamaz;
// base64 kodlamasi bunu ceil(1232/3)*4 = 1644 karaktere sisirir.
// `parseDappTransaction`in base64Coz'u UZUNLUK SINIRI TANIMAZ -- boyut
// kontrolu olmadan onaylanmis bir origin, paylasilan MV3 service worker'ina
// keyfi uzunlukta govdeler yollayip her birinde tam regex + Buffer.from
// tahsisi tetikleyebilir. 2048 comertce ustte: gercek tavanin ustunde yeterli
// pay birakir ki kucuk kodlama farkliliklari mesru bir islemi YANLISLIKLA
// reddetmesin -- kesin tavan zaten parseDappTransaction'in deserialize
// adiminda uygulanir, burasi yalniz DoS onlemidir.
export const MAX_TX_BASE64_LENGTH = 2048

// Sinirsiz mesaj ayni zamanda bir onay ekrani DoS'udur: 50 MB'lik "mesaj" once
// base64'e sisip sonra ekranda render edilmeye calisilirdi.
export const MAX_MESSAGE_BYTES = 8192

export const WALLET_STANDARD_VERSION = '1.0.0'

// Sabit kimlik: dapp'ler cuzdani AD ve IKON dizgeleriyle eslestirir, dolayisiyla
// bunlar surumler arasinda degismez. Ad, injected.js'in EIP-6963 duyurusundaki
// adla ayni tutulur -- kullanici iki listede tek bir cuzdan gormeli.
const WALLET_NAME = 'WATS Wallet'

// Gomulu SVG: uzak ikon ziyaret edilen sayfanin CSP'si altinda engellenir ve
// injected.js'teki devasa PNG bu blogu codegen ciktisinda okunamaz hale getirirdi.
const WALLET_ICON =
    'data:image/svg+xml;base64,' +
    'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCI+' +
    'PHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiByeD0iMTIiIGZpbGw9IiMwQjBCMEYiLz48cGF0aCBk' +
    'PSJNOSAxNWw2IDE4IDktMjAgOSAyMCA2LTE4IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9r' +
    'ZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+' +
    'PC9zdmc+'

/**
 * Her cagrida TAZE ve DERIN bir nesne doner (paylasilan referans DEGIL).
 *
 * Cagiranlar: codegen betigi, sayfa betiginin uretilen blogu ve testler. Ortak bir
 * nesneyi mutate eden biri otekileri de bozmasin diye kopya paylasilir -- TON'daki
 * tek-kaynak kuralinin ayni gerekcesi.
 *
 * `supportedTransactionVersions` icindeki 0 SAYI literalidir: ['legacy','0'] ya da
 * ['legacy','v0'] yazmak adaptoru sessizce legacy-only'ye dusurur, yani v0 destegini
 * bildirmek icin var olan alan tam tersi sonucu verir.
 */
export function walletStandardMetadata() {
    return {
        version: WALLET_STANDARD_VERSION,
        name: WALLET_NAME,
        icon: WALLET_ICON,
        chains: [SOLANA_MAINNET_CHAIN],
        features: {
            'standard:connect': { version: '1.0.0' },
            'standard:disconnect': { version: '1.0.0' },
            'standard:events': { version: '1.0.0' },
            'solana:signTransaction': {
                version: '1.0.0',
                supportedTransactionVersions: ['legacy', 0],
            },
            'solana:signAndSendTransaction': {
                version: '1.0.0',
                supportedTransactionVersions: ['legacy', 0],
            },
            'solana:signMessage': { version: '1.0.0' },
            'solana:signIn': { version: '1.0.0' },
        },
    }
}

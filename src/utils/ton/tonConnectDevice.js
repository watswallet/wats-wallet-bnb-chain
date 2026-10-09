// TonConnect'e bildirilen cihaz/yetenek betimi -- TEK gercek kaynak.
//
// KOK NEDEN (final inceleme bulgusu): bu betimin UC KOPYASI vardi -- tonInjected.js
// (bridge.deviceInfo), tonDappFunctions.js (restoreConnection yaniti) ve
// TonConnectApprove.vue (connect yaniti). Ikisi `features: []` ile SESSIZCE
// KALMISTI. @tonconnect/sdk cihaz yetenegini injected koprunun deviceInfo'sundan
// DEGIL, ConnectEvent yukunun (payload) `device` alanindan okur; sendTransaction/
// signData'yi checkSendTransactionSupport/checkSignDataSupport ile bu alana gore
// KAPATIR ve istek bize HIC ULASMADAN WalletNotSupportFeatureError firlatir.
// Baglanti calisir gorunur, sonra HER islem/imza sessizce reddedilirdi.
//
// Bu yuzden burasi TEK kaynak: tonInjected.js, tonDappFunctions.js ve
// TonConnectApprove.vue UCU DE buradan import eder. Degerleri BURADA
// degistirmek ucunu birden gunceller; ikinci bir kopya ACILMAZ.
//
// SAF MODUL: chrome'a, aga, pinia'ya DOKUNMAZ -- tonInjected.js SAYFA
// dunyasinda (world: MAIN) calisir, orada bunlarin hicbiri yok.
// Sinir BAGIMSIZ dosyadan okunur (tonConnectMessages uzerinden DEGIL): bu modulu
// vite.config.js / vitest.config.js de import ediyor ve o zincir `import.meta.env`
// okuyan modullere uzandigi icin config Node'da cokuyordu. Gerekce ve olcum
// tonConnectLimits.js'in bas yorumunda.
//
// appVersion package.json'dan ADLI ve niteliksiz import ile okunur: `with {
// type: 'json' }` adli importu config yukleyicilerinde (esbuild) kirar. Bu
// yuzden modul Node'da paketleyicisiz yuklenemez; yalniz vite/vitest ile.
// Adli import tek basina YETMEZ: package.json modulu servis calisaninin da
// yukledigi ortak chunk'a duser ve uygulamadaki TEK bir varsayilan import tum
// nesneyi (scripts, dependencies, devDependencies) oraya geri getirir. OLCULDU
// (vite build, 2026-10-05): uc ekran varsayilan import ederken nesnenin tamami
// oradaydi; hepsi adli importa gecince yalniz surum dizesi kaldi. Kural tum
// src icin tonInjectedTekParca.test.js'te.
import { MAX_MESSAGES } from './tonConnectLimits'
import { version } from '../../../package.json'

/**
 * Her cagrida TAZE bir nesne doner (paylasilan bir referans DEGIL) -- uc
 * cagiran da kendi yanit govdesine gomup chrome.runtime mesajlasmasiyla
 * gonderiyor; ortak bir nesneyi MUTATE etmeye kalkan biri digerlerini de
 * etkilemesin diye referans degil kopya paylasilir.
 *
 * maxMessages BURADA sabit YAZILMAZ -- tonConnectMessages.js'teki MAX_MESSAGES'tan
 * OKUNUR. Istek dogrulamasi (validateSendTransactionRequest) da AYNI sabiti
 * kullanir; boylece ikisi YAPISAL OLARAK ayni sayidan kopamaz.
 */
export function tonConnectDeviceInfo() {
    return {
        platform: 'browser',
        // KIMLIK, GORUNEN AD DEGIL. wallets-list sartnamesi (README, "Description"):
        // "app_name: string ID of your wallet. Must be equal with
        // ConnectEventSuccess.device.appName and js bridge key". Yani bu deger
        // jsBridgeKey ('wats', window.wats) ve walletInfo.app_name ile UCU BIR
        // OLMALI. Kullaniciya gosterilen ad ayri bir alan: walletInfo.name.
        // 2026-09-11'e kadar burasi 'Wats Wallet' idi ve defter kaydiyla
        // catisiyordu; tonInjected.test.js ucunu birbirine baglar.
        appName: 'wats',
        appVersion: version,
        maxProtocolVersion: 2,
        features: [
            { name: 'SendTransaction', maxMessages: MAX_MESSAGES, extraCurrencySupported: false },
            { name: 'SignData', types: ['text', 'binary', 'cell'] },
        ],
    }
}

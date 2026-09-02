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
import { MAX_MESSAGES } from './tonConnectMessages'

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
        appName: 'Wats Wallet',
        appVersion: '1.0.0',
        maxProtocolVersion: 2,
        features: [
            { name: 'SendTransaction', maxMessages: MAX_MESSAGES, extraCurrencySupported: false },
            { name: 'SignData', types: ['text', 'binary', 'cell'] },
        ],
    }
}

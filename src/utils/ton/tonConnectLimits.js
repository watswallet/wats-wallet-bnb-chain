// TonConnect SINIRLARI -- BAGIMSIZ modul, HIC import etmez.
//
// NEDEN AYRI BIR DOSYA: bu sabit iki yerden okunuyor ve ikisinin AYNI sayidan
// kopmamasi gerekiyor (bkz. tonConnectDevice.js) --
//   1. istek dogrulamasi  (tonConnectMessages.validateSendTransactionRequest)
//   2. cihaz betimi       (tonConnectDevice.tonConnectDeviceInfo -> features)
// Sayi eskiden tonConnectMessages.js'teydi ve o dosya chainKind -> supportedChains
// -> featureFlags zincirini getiriyor, yani `import.meta.env` OKUYOR.
//
// Bu bir detay degil, DERLEMEYI KILITLEYEN sey: tonConnectDevice.js'i
// vite.config.js / vitest.config.js import ediyor (cihaz betimi tonInjected.js'e
// derleme zamaninda gomuluyor -- gerekce vite.config.js'te). Config Node'da
// calisir ve orada `import.meta.env` YOKTUR: eski zincirle vitest
// "Cannot read properties of undefined (reading 'VITE_SOLANA_ENABLED')" ile
// hic baslamiyordu. Sinir kendi basina durunca config yalnizca bu dosyayi ceker.
//
// Buraya AG, chrome, ortam degiskeni ya da baska bir import EKLENMEZ.

/**
 * Tek bir TonConnect `sendTransaction` istegine girebilecek EN FAZLA mesaj sayisi.
 *
 * Cuzdanin W5 cok-mesajli gonderim kapasitesiyle hizalidir; buyutmek yalniz
 * gonderim tarafi da dogrulandiktan sonra anlamlidir.
 */
export const MAX_MESSAGES = 4

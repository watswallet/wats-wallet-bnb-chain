import { Buffer } from 'buffer'

/**
 * `Buffer` global'ini garanti eder.
 *
 * @solana/web3.js ve @solana/spl-token, MODUL DEGERLENDIRME aninda serbest
 * `Buffer` global'ini okur. Eklenti sayfalarinda ve MV3 service worker'inda boyle
 * bir global YOKTUR. Sonuc Solana ile SINIRLI DEGIL: ilk @solana import'u
 * ReferenceError atar, popup giris parcasi degerlendirilemez ve cuzdan HER agda
 * (EVM dahil) bos acilir; service worker hic yuklenmez.
 *
 * Testler bunu YAKALAYAMAZ: vitest `environment: 'node'` ile calisiyor ve orada
 * `Buffer` gercek bir global. `build:dev`in gecmesi de bir sey kanitlamaz — hata
 * calisma anindaki modul degerlendirmesinde olusur. Bu yuzden bufferGlobal.test.js
 * kurali KAYNAK UZERINDEN kilitler.
 *
 * Bu modul, @solana'yi DOGRUDAN iceri alan HER dosyanin ILK import'udur. ES modul
 * grafigi derinlik-once ve import sirasina gore degerlendirildigi icin bu,
 * @solana grafigine giden her yolda polyfill'in once calismasini garanti eder.
 * Yalnizca giris noktalarina koymak ayni garantiyi VERMEZ: paketleyici modulu
 * giris parcasinin govdesine katarsa kod, o parcanin import'larindan SONRA calisir.
 */
if (typeof globalThis.Buffer === 'undefined') {
    globalThis.Buffer = Buffer
}

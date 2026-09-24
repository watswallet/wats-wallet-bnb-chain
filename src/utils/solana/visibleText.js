// visibleText.js -- sayfa/dapp kontrolundeki HER metnin (appMeta.name, SIWS
// `uri` gibi sayfa alanlari) EKRANA CIKMADAN once gecmesi gereken TEK
// gorunmezlik/homoglif isaretleme katmani (C3.2, Task 23/31 deferred).
// SolanaSignTx.vue ve SolanaSignMessage.vue AYNI mantigi BAGIMSIZ kopyalar
// halinde tasiyordu -- biri guncellenip digeri unutulursa yeni bir
// gorunmezlik/homoglif sinifi TEK ekranda kapanirdi. SAF katman, hicbir sey
// import etmez (bufferGlobal.test.js taramasinin @solana importer listesine
// GIRMEMESI gerekir -- bu dosya @solana'ya bagimli DEGILDIR).

// Sifir genislikli, yon degistiren ve kontrol karakterleri EKRANDA GORUNMEZ:
// "Log" + U+200B + "in" ile "Login" ayni goruntuyu verir. \t ve \n bilerek
// disarida -- mesru mesajlarin bicimidir, isaretlemek gurultu olurdu.
// KARAKTER SINIFI \u KACISLARIYLA YAZILIR, HAM BAYTLA DEGIL: bir editor,
// linter ya da yama araci ham NUL/DEL/BOM baytlarini kirpar veya
// normallestirirse sinif ya SyntaxError verir ya da SESSIZCE hicbir seyle
// eslesmez -- ve testler yalnizca U+200B ile U+0430'i kontrol ettigi icin
// savunmanin oldugu FARK EDILMEZ.
const GORUNMEZ = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/

// Latin harflerine BENZEYEN Kiril/Yunan kod noktalari: gorunur ama BASKA
// karakterdirler, imzalanan/gosterilen bayt da baskadir.
const HOMOGLIFLER = new Set(['\u0430', '\u0435', '\u043e', '\u0440', '\u0441', '\u0443', '\u0445', '\u0410', '\u0412', '\u0415', '\u041a', '\u041c', '\u041d', '\u041e', '\u0420', '\u0421', '\u0422', '\u0423', '\u0425', '\u03bf', '\u03b1', '\u0456'])

const kodNoktasi = (ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')

/**
 * Sayfa/dapp kontrolundeki bir metni GOSTERIME hazirlar: gorunmez kod
 * noktalarini kod-noktasi etiketiyle DEGISTIRIR, homoglifleri SILMEDEN
 * yaninda isaretler (kullanici metni yine oldugu gibi okur ama tuzagi gorur).
 * Duz ASCII/Latin metin DEGISMEDEN doner. `origin` bu helper'dan BILEREK
 * GECMEZ (cagiran taraflarda) -- `new URL(...).hostname` zaten IDNA/punycode
 * uygulayarak Kiril/Yunan homoglif harflerini gorunumde AYRISTIRICI bir
 * 'xn--' onekine cevirir; helper'i oraya da uygulamak, zaten URL
 * ayristirmasindan SONRA calisacagi icin gercek bir koruma EKLEMEDEN yanlis
 * bir guven duygusu verirdi.
 * @param {unknown} text
 * @returns {string}
 */
export function gorunurKil(text) {
    return Array.from(String(text)).map((ch) => {
        if (GORUNMEZ.test(ch)) return '[' + kodNoktasi(ch) + ']'
        if (HOMOGLIFLER.has(ch)) return ch + '[' + kodNoktasi(ch) + ']'
        return ch
    }).join('')
}

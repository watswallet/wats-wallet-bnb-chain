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
//
// final SU-3: sinif Unicode'un `Default_Ignorable_Code_Point` ozelligiyle GENISLETILDI
// (u bayragi): ekranda hic cizilmeyen U+034F, U+061C, U+115F/1160, U+17B4/17B5,
// U+180B-180F, U+2065-206F, U+3164, U+FE00-FE0F (varyasyon secicileri), U+FFA0 ve
// U+E0000-E0FFF (etiketler + varyasyon secicileri eki) tek tek listelenmek yerine
// ozellikle kapsanir; ozelligin DISINDA kalan ama bos gorunen U+2800 (Braille bosluk)
// ve U+FFF9-FFFB (satir arasi aciklama isaretleri) acikca eklenir. Kod nokta bazli
// kilit visibleText.test.js'te.
const GORUNMEZ = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u2800\uFEFF\uFFF9-\uFFFB\p{Default_Ignorable_Code_Point}]/u

// Emoji sunum secicileri (U+FE0F/U+FE0E) mesru emoji metninde cok yaygindir; her emoji'yi
// "[U+FE0F]" gurultusune bogmamak icin YALNIZ bir emoji tabanindan (ya da keycap
// dizisinden: rakam/#/* + secici + U+20E3) hemen sonra gelen secici isaretlenmez. Baska
// her yerde ayni karakter gorunmez bir ayristiricidir ("Log" + U+FE0F + "in") ve isaretlenir.
const EMOJI_TABANI = /\p{Extended_Pictographic}/u
const KEYCAP_TABANI = /^[0-9#*]$/
function emojiSecicisi(onceki, ch, sonraki) {
    if (ch !== '\uFE0F' && ch !== '\uFE0E') return false
    if (onceki === undefined) return false
    if (EMOJI_TABANI.test(onceki)) return true
    return KEYCAP_TABANI.test(onceki) && sonraki === '\u20E3'
}

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
    const noktalar = Array.from(String(text))
    return noktalar.map((ch, i) => {
        if (GORUNMEZ.test(ch) && !emojiSecicisi(noktalar[i - 1], ch, noktalar[i + 1])) return '[' + kodNoktasi(ch) + ']'
        if (HOMOGLIFLER.has(ch)) return ch + '[' + kodNoktasi(ch) + ']'
        return ch
    }).join('')
}

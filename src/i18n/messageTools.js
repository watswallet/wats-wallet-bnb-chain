// Ceviri mesajlarini makinece denetlemek icin SAF yardimcilar (genel yapi testleri ve
// ceviri araclari kullanir; uygulama calisma aninda import etmez).
//
// vue-i18n mesaj sozdizimi: `{ad}` yer tutucu, `{'...'}` degismez metin (icindeki `@`, `|`,
// `{` `}` ozel anlam tasimaz), `|` cogul ayirici, `<...>` HTML etiketi (v-html ile basilir).

// `{'...'}` degismez metin kacislari: yer tutucu da cogul ayirici da sayilmaz.
const DEGISMEZ_METIN = /\{'[^']*'\}/g
const YER_TUTUCU = /\{([^{}]*)\}/g
const HTML_ETIKETI = /<\/?[a-zA-Z][^>]*>/g

const kacisiCikar = (mesaj) => String(mesaj).replace(DEGISMEZ_METIN, '')

/**
 * Ic ice JSON nesnesini noktali yol / deger ciftlerine duzlestirir (sira korunur).
 * @param {Record<string, unknown>} obj
 * @returns {[string, string][]}
 */
export function flatten(obj, prefix = '') {
    return Object.entries(obj).flatMap(([anahtar, deger]) => {
        const yol = prefix ? `${prefix}.${anahtar}` : anahtar
        return deger && typeof deger === 'object' && !Array.isArray(deger)
            ? flatten(deger, yol)
            : [[yol, deger]]
    })
}

/**
 * Mesajdaki `{ad}` yer tutucu adlari: kirpilmis, tekil, sirali.
 * `{'...'}` degismez metin kacislari yer tutucu degildir.
 * @param {string} mesaj
 * @returns {string[]}
 */
export function placeholders(mesaj) {
    const adlar = new Set()
    for (const eslesme of kacisiCikar(mesaj).matchAll(YER_TUTUCU)) {
        const ad = eslesme[1].trim()
        if (ad) adlar.add(ad)
    }
    return [...adlar].sort()
}

/**
 * Mesajdaki HTML etiketleri (oznitelikleriyle), TEKRARLI ve sirali. Dizi esitligi hem
 * etiket cesidini hem adetini karsilastirir.
 * @param {string} mesaj
 * @returns {string[]}
 */
export function htmlTags(mesaj) {
    return (String(mesaj).match(HTML_ETIKETI) ?? []).sort()
}

/**
 * `|` ile ayrilan cogul bicim sayisi (`{'...'}` kaclari cikarildiktan sonra). `|` yoksa 1.
 * @param {string} mesaj
 * @returns {number}
 */
export function pluralFormCount(mesaj) {
    return kacisiCikar(mesaj).split('|').length
}

const kacis = (metin) => metin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SOZCUK_KARAKTERI = /[A-Za-z0-9]/

/**
 * `terim` metinde TAM SOZCUK olarak geciyor mu: eslesmenin iki yanindaki karakter
 * `[A-Za-z0-9]` olamaz. Latin olmayan yazilar sinir sayilir ('QRコード' icinde 'QR' gecer).
 * @param {string} metin
 * @param {string} terim
 * @param {{ignoreCase?: boolean}} [secenekler]
 * @returns {boolean}
 */
export function containsTerm(metin, terim, { ignoreCase = false } = {}) {
    if (!terim) return false
    const kaynak = String(metin)
    const desen = new RegExp(kacis(terim), ignoreCase ? 'gi' : 'g')
    let eslesme
    while ((eslesme = desen.exec(kaynak)) !== null) {
        const onceki = kaynak[eslesme.index - 1]
        const sonraki = kaynak[eslesme.index + eslesme[0].length]
        const solSinir = onceki === undefined || !SOZCUK_KARAKTERI.test(onceki)
        const sagSinir = sonraki === undefined || !SOZCUK_KARAKTERI.test(sonraki)
        if (solSinir && sagSinir) return true
        // Ust uste binen eslesmeler de denensin ('ATSATS' icinde ikinci 'ATS').
        desen.lastIndex = eslesme.index + 1
    }
    return false
}

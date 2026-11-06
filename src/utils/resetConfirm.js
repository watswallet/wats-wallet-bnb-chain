// "Uygulamayi sifirla" onay kelimesi: kullanicinin yazdigi metin ile dilin kendi kelimesinin
// (settings.security.resetApp.confirm_keyword) karsilastirilmasi.
//
// KARAR (kullanici, 2026-11-03): kelime her dilde O DILIN KENDI kelimesidir (ja/ko/vi/id dahil,
// Latin "RESET" degil). Kullanici kelimeyi yazamazsa sifirlama yapamaz, bu yuzden karsilastirma
// girdinin BICIMINE degil kelimeye bakar. Asagidaki farklar elenir; hicbiri "baska kelime"yi
// kelimeyle esitlemez, yalniz ayni kelimenin yazilis bicimlerini birlestirir:
//
//  - NFKC: NFD gelen girdi (macOS/Linux klavyeleri, Hangul, aksanlar), tam genislik Latin
//    ("ＲＥＳＥＴ") ve yari genislik katakana ("ﾘｾｯﾄ") tek bicime iner.
//  - bosluk: bastaki/sondaki bosluk (yapistirma) atilir; ic bosluk dizisi (NBSP, ideografik
//    bosluk, cift bosluk) tek bosluga iner ("ĐẶT LẠI", "ATUR ULANG").
//  - gorunmez bicim karakterleri (sifir genislikli bosluk, yon isaretleri) atilir; baska
//    siteden yapistirilan kelimeyle gelirler.
//  - buyuk/kucuk harf: toUpperCase() DIL BAGIMSIZ kullanilir (toLocaleUpperCase degil): Turkce
//    kuralla "sifirla" -> "SİFİRLA" olur ve anahtardaki "SIFIRLA" ile eslesmezdi.
//  - aksan: NFD'ye ayrilip birlestirme isaretleri atilir. ABD klavyeli kullanici "reinitialiser"
//    yazar, "RÉINITIALISER" ile eslesir; Turkce "İ" (I + nokta isareti) "I" olur ("SİFİRLA" =
//    "SIFIRLA"). "Đ" ayrisan bir isaret tasimadigi icin ayrica "D"ye indirilir.
//
// Kelime ekranda ve yer tutucuda aynen gosterilir; burasi yalniz KABUL kuralidir.

// Girdi alani sinirinin alt tabani. Sinir kelimeden BAGIMSIZ sabit olunca kisa tr/en kelimelerine
// gore yazilmis bir sayi (10) es 'RESTABLECER' (11) ve fr 'RÉINITIALISER' (13) kelimelerini
// kesiyor, 'Sil' dugmesi hic acilmiyordu.
export const RESET_INPUT_MIN_LIMIT = 32

/**
 * Karsilastirma anahtari: yukaridaki farklar elenmis, buyuk harfli metin.
 * @param {unknown} text
 * @returns {string}
 */
export function foldResetKeyword(text) {
    return String(text ?? '')
        .normalize('NFKC')
        .replace(/\p{Cf}/gu, '')
        .replace(/\s+/gu, ' ')
        .trim()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toUpperCase()
        .replace(/Đ/g, 'D')
}

/**
 * Girdi onay kelimesi mi? Bos kelime (ceviri eksik) ya da bos girdi ASLA onay sayilmaz.
 * @param {unknown} input kullanicinin yazdigi metin
 * @param {unknown} keyword dilin onay kelimesi
 * @returns {boolean}
 */
export function isResetConfirmed(input, keyword) {
    const expected = foldResetKeyword(keyword)
    if (!expected) return false
    return foldResetKeyword(input) === expected
}

/**
 * Girdi alani uzunluk siniri: kelimenin en uzun yazilis bicimini (NFD, yani aksanlar ve Hangul
 * ayrik) ve payini tasir: NFD uzunlugunun iki kati, en az RESET_INPUT_MIN_LIMIT.
 * @param {unknown} keyword
 * @returns {number}
 */
export function resetInputLimit(keyword) {
    const length = String(keyword ?? '').normalize('NFD').length
    return Math.max(RESET_INPUT_MIN_LIMIT, length * 2)
}

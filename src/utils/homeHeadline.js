// Ana ekran toplam bakiye basliginin yazi boyutu kurali.
//
// Popup 360 px genisliginde; 42 px'te yaklasik 10 karakter sigar. USD "$1,234.56" (9)
// 42 px'te kalir, ama buyuk kurlu birimlerde (IDR, VND, KRW) metin 13-17 karaktere cikar
// ve sabit 42 px taşardi. Uzunluk arttikca kademeli kucultulur.
//
// `len`: baslik metninin `prefix + number + suffix` uzunlugu. Bakiye gizliyken ("****")
// bile GERCEK uzunluk verilir: goz dugmesine basinca boyut siçramasin.

const SIZES = [
    { upTo: 10, cls: 'text-[42px]' },
    { upTo: 13, cls: 'text-[32px]' },
    { upTo: 17, cls: 'text-[26px]' },
]
const SMALLEST = 'text-[20px]'
const DEFAULT = 'text-[42px]'

/**
 * @param {number} len baslik metninin karakter sayisi
 * @returns {string} Tailwind yazi boyutu sinifi
 */
export function headlineSizeClass(len) {
    const n = Number(len)
    if (typeof len !== 'number' || !Number.isFinite(n)) return DEFAULT
    for (const { upTo, cls } of SIZES) {
        if (n <= upTo) return cls
    }
    return SMALLEST
}

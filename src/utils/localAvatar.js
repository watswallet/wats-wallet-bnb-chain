import { createAvatar } from '@dicebear/core'
import { identicon, initials } from '@dicebear/collection'

// Kimlik ikonlari YERELDE uretilir (spec 7.2). Eskiden uzak dicebear API'sine
// `?seed=<adres>` ile gidiliyordu: kullanicinin IP'si ile tum adresleri (Gizli
// Hesap ve alicilar dahil) ucuncu tarafa tasiniyordu. Surum 9.4.3'e SABIT
// (tam surum, ^ yok): identicon ciktisi eski 7.x ciktisiyla bayt bayt ayni, gorunum
// degismez; altin degerler localAvatar.test.js'te. Surum yukseltmesi KASITLI olmali:
// altin test kirilirsa ikon degisimini kabul edip hash'leri guncelle. 9.x'te
// toDataUri() senkron dize doner (7.x'teki toDataUriSync() karsiligi).
//
// Ayni tohum listelerde defalarca cizilir; kucuk bir bellek onbellegi SVG'yi
// yeniden uretmekten kurtarir.
const cache = new Map()
const MAX_ENTRIES = 300

// GIZLI MOD: NOTR AVATARLAR (grafit karari, kullanici 2026-10-26: gizli modda hicbir sey mor gorunmez). Varsayilan
// identicon satir paletinin ve initials zemin paletinin 3 rengi mor/indigodur (5e35b1, 8e24aa, 3949ab); ikon bir data
// URI <img>'dir, CSS onu yeniden boyayamaz. Anahtar MODUL DUZEYINDEDIR ve `installPrivacySync` mod degisince cevirir
// (utils/privacy/privacyUiSync.js; tokenLogo'nun setLocalLogosOnly deseni): ikonu cizen yirmiden fazla yer degismez.
// Acikken yalniz RENK degisir: identicon satirlari renkten ONCE secilir, sekil (adres tanima yardimi) aynen kalir.
let notr = false

/** Gizli mod anahtarini cevirir. Yalniz tam `true` acar. */
export function setNeutralAvatars(acik) {
    notr = acik === true
}

/** Anahtarin o anki durumu (test ve teshis icin). */
export function neutralAvatars() {
    return notr
}

// Gizli modda tek orta gri. identicon'un zemini saydamdir (arkasi cagiranin beyaz ya da koyu grafit zemini): zinc-500
// ikisinde de secilir. initials'ta yazi varsayilan beyaz kalir, zinc-600 zemin uzerinde okunur.
const NOTR_IDENTICON = { rowColor: ['71717a'] }
const NOTR_INITIALS = { backgroundColor: ['52525b'] }

function memo(kind, style, seed, notrSecenek) {
    const s = seed === undefined || seed === null ? '' : String(seed)
    // Mod anahtarin PARCASI: ayni tohum iki modda farkli SVG uretir; mod degisince oteki modun ciktisi donmesin.
    const key = (notr ? 'notr-' : '') + kind + ':' + s
    const hit = cache.get(key)
    if (hit) return hit
    // Kapaliyken kutuphaneye giden secenek eskisiyle AYNI ({ seed }): cikti bayt bayt degismez (altin degerler).
    const uri = createAvatar(style, notr ? { seed: s, ...notrSecenek } : { seed: s }).toDataUri()
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value)
    cache.set(key, uri)
    return uri
}

export const identiconUri = (seed) => memo('i', identicon, seed, NOTR_IDENTICON)
export const initialsUri = (seed) => memo('n', initials, seed, NOTR_INITIALS)

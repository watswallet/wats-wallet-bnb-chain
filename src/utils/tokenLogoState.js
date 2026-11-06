// NORMAL MODDA "LOGOSUZ TOKEN" KARARI -- tek yer (sahip karari 2026-11-03). Cozucu: tokenLogoSources.js; cizim: components/TokenAvatar.vue.
//
// Bir token "logosuz"dur eger (a) hicbir kaynak adayi yoksa ya da (b) TUM adaylari yuklenemediyse (TokenAvatar bildirir). Kurallar:
//   - SECICI ve ARAMA listeleri logosuz tokeni GIZLER (hideLogoless).
//   - MALVARLIGI listeleri (Home, Gonderilecek/Takas'ta cuzdandaki tokenler) YALNIZ bakiyesi KESIN sifir olan logosuz satiri gizler
//     (hideLogolessZero); bakiyesi sifirdan buyuk, bilinmeyen ya da henuz yuklenmemis token logosuz olsa da GORUNUR kalir (monogram cizilir):
//     para gizlenirse kayboldu gibi gorunur.
//   - Gecmis kayitlari, onay/imza ekranlari ve kullanicinin kendi ice aktardigi tokenler ASLA gizlenmez (monogram).
//
// (b) icin AG KANITI sarti: <img> hatasi 404 ile "internet yok"u ayirt edemez. Cevrimdisiyken ya da CDN dusukken butun tokenleri secicilerden
// silmemek icin, bir token ancak oturumda EN AZ BIR uzak logo basariyla yuklendikten sonra "eksik" sayilir (yuklenmeden once tukenenler beklemeye
// alinir ve ilk basarili uzak yuklemede kesinlesir). navigator.onLine === false iken hic kesinlesmez. Yalniz YEREL kaynagi olan token, ag
// kanitina bakilmadan hemen kesinlesir (yerel dosya ag yuzunden eksik olmaz). Durum bellektedir (acilir pencere kapaninca sifirlanir).
//
// GIZLI MOD: gizli modun logo/gizleme kurallari kendi dosyalarindadir (privateTokenLogo.js, hasPrivateLogo, privateHomeScope.hideLogolessZeroRows;
// secicileri Private* bilesenleri yonetir) ve DEGISMEDI. Paylasilan bilesenler gizli moda dusse bile (localLogosOnly() acik) buradaki suzgecler satir
// KUMESINI degistirmez: satirlar eskisi gibi listelenir, yalniz logo gri yer tutucu yerine notr monogramla cizilir.

import { shallowReactive } from 'vue'
import { hasLogoSource } from './tokenLogoSources'
import { localLogosOnly } from './tokenLogo'

const missing = shallowReactive(new Set())
const pending = new Set()
let remoteAlive = false

const REMOTE = /^(https?:)?\/\//i

const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '')

/** Tokenin oturum ici kimligi: (ag, adres | 'native' | sembol). */
export function logoKey(token, chainId) {
    const cid = chainId !== undefined && chainId !== null ? chainId : token?.chainId
    const address = lower(token?.address)
    return String(cid ?? '') + '|' + (address || (token?.native === true ? 'native' : '')) + '|' + (address ? '' : lower(token?.symbol ?? token?.ticker))
}

/** <img> basariyla yukledi. Ilk UZAK yukleme agin canli oldugunu kanitlar: bekleyen tukenmeler kesinlesir. */
export function reportLogoLoaded(src) {
    if (remoteAlive || typeof src !== 'string' || !REMOTE.test(src)) return
    remoteAlive = true
    for (const key of pending) missing.add(key)
    pending.clear()
}

/** Bir tokenin TUM kaynaklari yuklenemedi. `triedRemote`: denenenlerden en az biri uzak mi. */
export function reportLogoExhausted(token, { chainId, triedRemote = false } = {}) {
    const key = logoKey(token, chainId)
    if (!triedRemote || remoteAlive) {
        missing.add(key)
        return
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    pending.add(key)
}

/** Token logosuz mu: kaynak adayi yok ya da hepsi yuklenemedi (kesinlesmis). Reaktif: computed icinde cagrilirsa liste yeniden suzulur. */
export function isLogoMissing(token, { chainId } = {}) {
    if (!hasLogoSource(token, { chainId })) return true
    return missing.has(logoKey(token, chainId))
}

/** Test yardimcisi: oturum durumunu sifirlar. */
export function resetLogoState() {
    missing.clear()
    pending.clear()
    remoteAlive = false
}

/**
 * SECICI / ARAMA listesi: logosuz tokeni gizler. `chainIdOf(satir)` satir chainId tasimiyorsa agi verir. Girdiyi degistirmez.
 */
export function hideLogoless(rows, { chainIdOf } = {}) {
    if (!Array.isArray(rows)) return []
    if (localLogosOnly()) return rows
    return rows.filter((row) => !isLogoMissing(row, { chainId: typeof chainIdOf === 'function' ? chainIdOf(row) : undefined }))
}

/**
 * Bakiye kaydi KESIN sifir mi? Kayit sayi, dize ya da { amount, error } olabilir. Okunamayan (error), henuz yuklenmemis (kayit/tutar yok) ve
 * sifir olmayan her sey "sifir degil" sayilir: belirsizlik her zaman GORUNUR kalma yonundedir.
 */
export function isKnownZeroBalance(entry) {
    if (entry === undefined || entry === null) return false
    if (typeof entry === 'object') {
        if (entry.error) return false
        return isKnownZeroBalance(entry.amount)
    }
    if (typeof entry === 'number') return entry === 0
    return typeof entry === 'string' && entry.trim() !== '' && Number(entry) === 0
}

/**
 * MALVARLIGI listesi: yalniz logosuz VE bakiyesi kesin sifir olan satiri gizler; baska her satir kalir. `balanceOf(satir)` bakiye kaydini
 * (ya da undefined) doner. Girdiyi degistirmez.
 */
export function hideLogolessZero(rows, balanceOf, { chainIdOf } = {}) {
    if (!Array.isArray(rows)) return []
    if (localLogosOnly()) return rows
    return rows.filter((row) => {
        if (!isLogoMissing(row, { chainId: typeof chainIdOf === 'function' ? chainIdOf(row) : undefined })) return true
        return !isKnownZeroBalance(typeof balanceOf === 'function' ? balanceOf(row) : undefined)
    })
}

/**
 * Bakiye kaydi KESIN sifirdan buyuk mu (sayi, dize ya da { amount, error })? Okunamayan / yuklenmemis / sifir -> false.
 */
export function isKnownPositiveBalance(entry) {
    if (entry === undefined || entry === null) return false
    if (typeof entry === 'object') return !entry.error && isKnownPositiveBalance(entry.amount)
    if (typeof entry === 'number') return entry > 0
    return typeof entry === 'string' && entry.trim() !== '' && Number(entry) > 0
}

/**
 * Bakiyeli SECICI (Takas/Kopru "Gonderilen", Gonder varlik secici): sunucu listesi + cuzdandaki tokenler. Logosuz tokeni YALNIZ cuzdanda gercekten
 * bakiyesi (> 0) varsa tutar (monogramla); logosuz ve bakiyesiz her satir gizlenir. `balanceOf(satir)` bakiye kaydini doner. Girdiyi degistirmez.
 */
export function hideLogolessUnlessHeld(rows, balanceOf, { chainIdOf } = {}) {
    if (!Array.isArray(rows)) return []
    if (localLogosOnly()) return rows
    return rows.filter((row) => {
        if (!isLogoMissing(row, { chainId: typeof chainIdOf === 'function' ? chainIdOf(row) : undefined })) return true
        return isKnownPositiveBalance(typeof balanceOf === 'function' ? balanceOf(row) : undefined)
    })
}

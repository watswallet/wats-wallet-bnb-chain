import { FALLBACK_LANG, SUPPORTED_LANGS } from './languages'

// Preferences.vue bu anahtara yaziyor. Once 'lang' okunuyordu - yani ayar hicbir
// zaman bulunmuyordu.
export const LANGUAGE_STORAGE_KEY = 'language'

// Kucuk harfli birincil alt etiket ('de') -> katalogdaki kanonik kod ('de'). Bolgeli kodlar
// ('pt-BR') birincil etiketle eslesmez; onlar asagidaki BIRINCIL_ESLEME'den gelir.
// Duz nesne DEGIL Map: nesne aramasi 'constructor' gibi bir girdiyi prototip uyesine cozerdi.
const KANONIK = new Map(SUPPORTED_LANGS.map((kod) => [kod.toLowerCase(), kod]))

// Bolge/yazi sistemi ne olursa olsun TEK koda baglanan diller (spec Bolum C): Portekizce
// hep Brezilya, Cince hep Basitlestirilmis (Geleneksel Cince kullanicisi Basitlestirilmis'i
// gorur). Bu bir POLITIKADIR, katalogdan turetilmez; yeni bir bolge eklenirse burada secilir.
const BIRINCIL_ESLEME = new Map([
    ['pt', 'pt-BR'],
    ['zh', 'zh-CN'],
])

/**
 * Herhangi bir dil kodunu ('pt', 'pt_br', 'PT-br', 'zh-Hant-HK', 'es-419', 'EN') katalogdaki
 * kanonik koda cevirir; desteklenmiyorsa (ya da string degilse) null.
 *
 * ESKI HATA: kod '-' ile kesilip birincil etiketle aranirdi, bu yuzden kayitli 'pt-BR'
 * 'pt'ye kesilir ve listede bulunamayinca 'en'e duserdi.
 *
 * Kucultme yerel ayardan BAGIMSIZDIR (toLowerCase): Turkce makinede toLocaleLowerCase
 * 'ID' kodunu noktasiz-i'li bir dizgiye cevirirdi.
 */
export function resolveLanguage(raw) {
    if (typeof raw !== 'string') return null

    const birincil = raw.toLowerCase().split(/[-_]/)[0]
    return BIRINCIL_ESLEME.get(birincil) ?? KANONIK.get(birincil) ?? null
}

export function isSupportedLanguage(lang) {
    return resolveLanguage(lang) !== null
}

/**
 * Tarayici dilinden ilk tahmin. i18n senkron kurulmak zorunda oldugu icin depo
 * BURADA okunamaz: chrome.storage.local.get bir Promise dondurur, eskiden o Promise
 * destructure edilip `saved` her zaman undefined kaliyordu.
 * Kayitli secim uygulama acilirken applySavedLanguage() ile uygulanir.
 *
 * Sira: navigator.languages'in ilk desteklenen dili, sonra navigator.language, yoksa 'en'.
 *
 * @param {{languages?: readonly string[], language?: string}} [nav] test icin enjekte
 *   edilebilir; verilmezse gercek `navigator` kullanilir.
 */
export function detectLanguage(nav) {
    // TUZAK: `nav` verilmediyse `typeof window` korumasi AYNEN kalmali. Node >= 21'de
    // globalThis.navigator VARDIR ve isletim sistemi dilini verir; korumayi
    // `globalThis.navigator`a cevirmek, i18n/index.js'i import eden onlarca SSR testini
    // gelistiricinin makine diline baglayip kirar.
    if (nav == null && typeof window === 'undefined') return FALLBACK_LANG

    const kaynak = nav ?? navigator

    if (Array.isArray(kaynak.languages)) {
        for (const dil of kaynak.languages) {
            const cozulen = resolveLanguage(dil)
            if (cozulen) return cozulen
        }
    }

    return resolveLanguage(kaynak.language) ?? FALLBACK_LANG
}

/**
 * Kullanicinin Ayarlar > Tercihler'de sectigi dili uygular. Bunu cagiran olmadigi
 * icin secim her acilista kayboluyor, arayuz tarayici diline geri donuyordu.
 *
 * Depodaki deger resolveLanguage ile kanonik koda cevrilir ('pt' -> 'pt-BR'); gecersizse
 * (silinmis bir dil, bozuk kayit) mevcut dil KORUNUR ve null doner.
 */
export async function applySavedLanguage(i18n) {
    try {
        const stored = await chrome.storage.local.get(LANGUAGE_STORAGE_KEY)
        const locale = resolveLanguage(stored?.[LANGUAGE_STORAGE_KEY])
        if (!locale) return null

        i18n.global.locale.value = locale
        return locale
    } catch (e) {
        console.warn('Kayitli dil uygulanamadi:', e)
        return null
    }
}

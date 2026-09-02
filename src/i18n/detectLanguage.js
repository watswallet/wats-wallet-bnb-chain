const SUPPORTED_LANGS = ['tr', 'en']
const FALLBACK_LANG = 'en'

// Preferences.vue bu anahtara yaziyor. Once 'lang' okunuyordu - yani ayar hicbir
// zaman bulunmuyordu.
export const LANGUAGE_STORAGE_KEY = 'language'

function normalize(lang) {
    return lang.split('-')[0]
}

export function isSupportedLanguage(lang) {
    return typeof lang === 'string' && SUPPORTED_LANGS.includes(normalize(lang))
}

/**
 * Tarayici dilinden ilk tahmin. i18n senkron kurulmak zorunda oldugu icin depo
 * BURADA okunamaz: chrome.storage.local.get bir Promise dondurur, eskiden o Promise
 * destructure edilip `saved` her zaman undefined kaliyordu.
 * Kayitli secim uygulama acilirken applySavedLanguage() ile uygulanir.
 */
export function detectLanguage() {
    if (typeof window === 'undefined') return FALLBACK_LANG

    if (navigator.languages && navigator.languages.length) {
        for (const lang of navigator.languages) {
            const normalized = normalize(lang)
            if (SUPPORTED_LANGS.includes(normalized)) return normalized
        }
    }

    if (navigator.language) {
        const normalized = normalize(navigator.language)
        if (SUPPORTED_LANGS.includes(normalized)) return normalized
    }

    return FALLBACK_LANG
}

/**
 * Kullanicinin Ayarlar > Tercihler'de sectigi dili uygular. Bunu cagiran olmadigi
 * icin secim her acilista kayboluyor, arayuz tarayici diline geri donuyordu.
 */
export async function applySavedLanguage(i18n) {
    try {
        const stored = await chrome.storage.local.get(LANGUAGE_STORAGE_KEY)
        const saved = stored?.[LANGUAGE_STORAGE_KEY]
        if (!isSupportedLanguage(saved)) return null

        const locale = normalize(saved)
        i18n.global.locale.value = locale
        return locale
    } catch (e) {
        console.warn('Kayitli dil uygulanamadi:', e)
        return null
    }
}

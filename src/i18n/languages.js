// Desteklenen arayuz dillerinin TEK kaynagi (spec Bolum C).
//
// Secici (Preferences.vue), otomatik algilama (detectLanguage.js), cogul kurali
// (pluralRules), <html lang> ve magaza metinleri (_locales) ayni listeden beslenir;
// yeni bir dil buraya EKLENIR, baska yerde dil kodu listesi tutulmaz.
//
// Sabitler DONMUSTUR: paylasilan katalog calisma aninda degistirilemez (yerinde
// siralama/ekleme yapmak isteyen kopyasini alir).

// Eslesme yoksa ve eksik ceviri anahtarlarinda dusulen dil (vue-i18n fallbackLocale).
export const FALLBACK_LANG = 'en'

// Secicideki sira ve her dilin KENDI adi. Bayrak, secicide dilin yaninda gorunur.
export const LANGUAGES = Object.freeze([
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'pt-BR', name: 'Português (Brasil)', flag: '🇧🇷' },
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
    { code: 'zh-CN', name: '简体中文', flag: '🇨🇳' },
    { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
    { code: 'id', name: 'Bahasa Indonesia', flag: '🇮🇩' },
    { code: 'ko', name: '한국어', flag: '🇰🇷' },
    { code: 'ja', name: '日本語', flag: '🇯🇵' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
].map((dil) => Object.freeze(dil)))

export const SUPPORTED_LANGS = Object.freeze(LANGUAGES.map((dil) => dil.code))

// Bir mesajin `|` ile ayrilan parca (cogul bicim) sayisi. Rusca 3 (1 / 2-4 / 5+ ve 0);
// ja, zh-CN, ko, vi, id, tr tek bicimlidir ve `|` HIC kullanmaz (Turkce'de sayidan sonra
// isim tekil kalir). Cevirmenler ve genel testler bu tabloya uyar.
export const PLURAL_FORMS = Object.freeze({
    es: 2,
    'pt-BR': 2,
    ru: 3,
    'zh-CN': 1,
    vi: 1,
    id: 1,
    ko: 1,
    ja: 1,
    de: 2,
    fr: 2,
    tr: 1,
    en: 2,
})

// Dil kodu -> Chrome `_locales` klasoru. Chrome bolgeli kodlarda tire yerine alt cizgi
// ister ('pt-BR' -> 'pt_BR', 'zh-CN' -> 'zh_CN'); digerleri ayni kalir.
export const CHROME_LOCALE_DIR = Object.freeze(
    Object.fromEntries(SUPPORTED_LANGS.map((kod) => [kod, kod.replaceAll('-', '_')])),
)

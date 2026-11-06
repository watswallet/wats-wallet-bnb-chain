// Para birimi (fiat) katalogu: hangi kod gecerli sayilir, varsayilan birim ne olur,
// secim listesi nasil gruplanir ve aranir. SAF modul: chrome API'sine, agsa, depoya
// dokunmaz.
//
// NEDEN STATIK IZINLI LISTE YOK: gecerli birimlerin tek kaynagi sunucudaki allowlist'tir
// (server/utils/fx.js FIAT_CURRENCIES) ve istemciye /getRates yanitindaki `currencies`
// ile gelir. Istemci kendi izinli listesini TUTARSA sunucuya eklenen yeni bir birim,
// yeni istemci surumu cikana kadar secilemez. Bu yuzden normalizeCurrencyCode yalniz
// SOZ DIZIMINI (3 harf) ve HARIC TUTMA listesini denetler; "bu kod sunucu tablosunda
// var mi" sorusunu kur tablosuna bakan resolveDisplay cevaplar.

// Varsayilan ve "cevrilemezse" donulen birim; fiyatlarin kendisi USD tutuldugu icin
// her zaman secilebilir (kur gerektirmez).
const FALLBACK_CURRENCY = 'usd'

// Tuketici para birimi olmayan ya da kullanimdan kalkmis kodlar: sunucu listesinde ve
// kur tablosunda olsalar bile secim listesine girmez, gecerli secim de sayilmaz.
// vef = eski Venezuela bolivari, xdr = IMF ozel cekme hakki. Liste testle kilitli.
export const EXCLUDED_CURRENCIES = Object.freeze(['vef', 'xdr'])

// Secim listesinin ustunde gosterilir; SIRA, gosterim sirasidir.
export const POPULAR_CURRENCIES = Object.freeze([
    'usd', 'eur', 'try', 'gbp', 'rub', 'brl', 'cny', 'jpy', 'krw', 'vnd', 'idr', 'inr',
])

// Euro bolgesi uyeleri (ISO 3166-1 alpha-2). Bulgaristan 2026-01-01'de euroya gecti;
// yeni bir uye katilirsa yalniz buraya eklenir.
const EURO_AREA = [
    'AT', 'BE', 'BG', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR',
    'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK',
]

// Tarayici bolgesi (BUYUK harf ISO 3166-1 alpha-2) -> varsayilan birim (kucuk harf).
// Euro disindaki satirlar sunucu allowlist'indeki her birimin (vef/xdr haric) ulkesidir.
// Tabloda olmayan bolge (ya da birimi allowlist'te olmayan ulke) varsayilan olarak USD
// alir. DEGERLERIN allowlist'te olmasi currencyCatalog.test.js'te sunucu dosyasiyla
// karsilastirilarak kilitli.
//
// SV (El Salvador) kasten usd: svc (kolon) 2001'den beri fiilen dolasimda degil, tum
// fiyatlar USD. Varsayilan olarak svc gostermek kullaniciya hic kullanmadigi bir birim
// verirdi.
export const REGION_CURRENCY = Object.freeze({
    ...Object.fromEntries(EURO_AREA.map((region) => [region, 'eur'])),
    AE: 'aed', AM: 'amd', AR: 'ars', AU: 'aud', BA: 'bam', BD: 'bdt',
    BH: 'bhd', BM: 'bmd', BR: 'brl', CA: 'cad', CH: 'chf', CL: 'clp',
    CN: 'cny', CO: 'cop', CR: 'crc', CZ: 'czk', DK: 'dkk', DO: 'dop',
    GB: 'gbp', GE: 'gel', GT: 'gtq', HK: 'hkd', HN: 'hnl', HU: 'huf',
    ID: 'idr', IL: 'ils', IN: 'inr', JP: 'jpy', KE: 'kes', KR: 'krw',
    KW: 'kwd', LB: 'lbp', LK: 'lkr', MM: 'mmk', MX: 'mxn', MY: 'myr',
    NG: 'ngn', NO: 'nok', NZ: 'nzd', PE: 'pen', PH: 'php', PK: 'pkr',
    PL: 'pln', RO: 'ron', RU: 'rub', SA: 'sar', SE: 'sek', SG: 'sgd',
    SV: 'usd', TH: 'thb', TR: 'try', TW: 'twd', UA: 'uah', US: 'usd',
    VN: 'vnd', ZA: 'zar', ZM: 'zmw',
})

// Bolgesiz dil etiketinde ('tr', 'ja') yalniz TEK ULKELI diller birim verir. 'en', 'de',
// 'es', 'pt', 'zh' gibi cok ulkeli diller belirsizdir: tahmin yerine USD.
const LANGUAGE_ONLY_CURRENCY = Object.freeze({
    tr: 'try', ja: 'jpy', ko: 'krw', vi: 'vnd', id: 'idr',
})

const EXCLUDED_SET = new Set(EXCLUDED_CURRENCIES)
const POPULAR_SET = new Set(POPULAR_CURRENCIES)
const CODE_SYNTAX = /^[A-Za-z]{3}$/
const REGION_SYNTAX = /^[A-Za-z]{2}$/

/**
 * Para birimi kodunu kucuk harfli 3 harfe indirger; gecersizse ya da haric tutulansa null.
 * Yalniz SOZ DIZIMI + haric tutma denetler: 'xyz' gibi sunucu tablosunda olmayan bir kod
 * gecer (uyelik karari resolveDisplay'in).
 *
 * Sozdizimi, kucultmeden ONCE ASCII olarak dogrulanir: toLowerCase() bazi ASCII-disi
 * harfleri ASCII'ye katlar (Kelvin isareti -> 'k'), "KES" gibi bir kod uydurulabilirdi.
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeCurrencyCode(value) {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!CODE_SYNTAX.test(trimmed)) return null
    const code = trimmed.toLowerCase()
    return EXCLUDED_SET.has(code) ? null : code
}

function lookup(table, key) {
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
}

// Dil etiketi alt etiketlerinden (ilki dil) bolgeyi bulur: sonraki alt etiketlerin iki
// harfli SONUNCUSU. Betik (4 harf, 'Hans') ve sayisal bolge ('419') eslesmez. Tekil harf
// ('u', 'x', ...) uzanti / ozel kullanim baslatir ve anahtarlari ('ca', 'nu') da iki
// harflidir; bolge sanilmasin diye orada durulur ("en-US-u-ca-gregory" Kanada degil).
function regionOf(parts) {
    let region = null
    for (let i = 1; i < parts.length; i += 1) {
        const part = parts[i]
        if (part.length === 1) break
        if (REGION_SYNTAX.test(part)) region = part
    }
    return region
}

/**
 * Tarayici dil listesinden varsayilan para birimi. YALNIZ ilk eleman bakilir (kullanicinin
 * birincil dili); bolge varsa bolgeye, yoksa tek ulkeli dil tablosuna, o da eslesmezse
 * USD'ye dusulur. Donen kod her zaman normalizeCurrencyCode'dan gecmistir.
 * @param {string[]} languages ornegin navigator.languages
 * @returns {string}
 */
export function defaultCurrencyFor(languages) {
    const first = Array.isArray(languages) ? languages[0] : undefined
    if (typeof first !== 'string') return FALLBACK_CURRENCY
    // '-' BCP 47 ayiricisi; '_' chrome.i18n.getMessage('@@ui_locale') gibi kaynaklar icin.
    const parts = first.trim().split(/[-_]/)
    const region = regionOf(parts)
    const mapped = region
        ? lookup(REGION_CURRENCY, region.toUpperCase())
        : lookup(LANGUAGE_ONLY_CURRENCY, parts[0].toLowerCase())
    return normalizeCurrencyCode(mapped) || FALLBACK_CURRENCY
}

// rates[code] kullanilabilir bir kur mu (sonlu, > 0 sayi)? Sifir/negatif/NaN/dize kur,
// birimi secilebilir kilip her yerde USD'ye dusmesine yol acardi.
function hasUsableRate(rates, code) {
    if (!rates || typeof rates !== 'object') return false
    if (!Object.prototype.hasOwnProperty.call(rates, code)) return false
    const rate = rates[code]
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
}

/**
 * Sunucu listesinden kullaniciya SECTIRILEBILECEK birimleri ayiklar: kodu gecersiz ya da
 * haric tutulan (vef/xdr) ve kur tablosunda kullanilabilir kuru olmayan birimler duser.
 * USD kurdan bagimsiz hep kalir (listede varsa). Girdi nesneleri ve sirasi degismez.
 * @param {{code: string, name: string, symbol: string}[]} list
 * @param {Record<string, number>} rates
 * @returns {{code: string, name: string, symbol: string}[]}
 */
export function selectableCurrencies(list, rates) {
    if (!Array.isArray(list)) return []
    return list.filter((entry) => {
        const code = normalizeCurrencyCode(entry?.code)
        if (!code) return false
        return code === FALLBACK_CURRENCY || hasUsableRate(rates, code)
    })
}

// Karsilastirma anahtari: kirpilmis, kucuk harfli kod ('' = kodsuz kayit).
const keyOf = (entry) => (typeof entry?.code === 'string' ? entry.code.trim().toLowerCase() : '')

const byCode = (a, b) => {
    const left = keyOf(a)
    const right = keyOf(b)
    if (left < right) return -1
    return left > right ? 1 : 0
}

/**
 * Listeyi ikiye boler: `popular` POPULAR_CURRENCIES SIRASINDA (yalniz listede olanlar),
 * `rest` popularleri icermeden koda gore sirali. Girdiyi suzmez ve degistirmez.
 * @param {{code: string, name: string, symbol: string}[]} list
 * @returns {{popular: object[], rest: object[]}}
 */
export function groupCurrencies(list) {
    const entries = Array.isArray(list) ? list : []
    const popular = []
    for (const code of POPULAR_CURRENCIES) {
        const found = entries.find((entry) => keyOf(entry) === code)
        if (found) popular.push(found)
    }
    const rest = entries.filter((entry) => !POPULAR_SET.has(keyOf(entry))).sort(byCode)
    return { popular, rest }
}

// Dil basina onbellekli Intl.DisplayNames ornegi (null = bu dil icin kurulamadi).
// Onbellek, Intl.DisplayNames kurucusu degisirse (ortam yamasi / test) gecersiz sayilir.
let displayNamesCache = new Map()
let displayNamesCtor = null

function displayNamesFor(locale) {
    const ctor = typeof Intl !== 'undefined' ? Intl.DisplayNames : undefined
    if (ctor !== displayNamesCtor) {
        displayNamesCache = new Map()
        displayNamesCtor = ctor
    }
    if (displayNamesCache.has(locale)) return displayNamesCache.get(locale)
    let instance = null
    try {
        if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
            instance = new Intl.DisplayNames([locale], { type: 'currency' })
        }
    } catch {
        instance = null
    }
    displayNamesCache.set(locale, instance)
    return instance
}

/**
 * Para biriminin ADINI uygulama dilinde verir (Intl.DisplayNames). Intl yoksa, atarsa,
 * bos doner ya da kodun kendisini geri verirse (bilinmeyen birim) `fallbackName`
 * (sunucunun Ingilizce adi) kullanilir; o da metin degilse ''.
 * @param {string} code para birimi kodu (herhangi bir harf boyu)
 * @param {string} locale uygulama dili ('tr', 'pt-BR' ...)
 * @param {string} [fallbackName]
 * @returns {string}
 */
export function currencyDisplayName(code, locale, fallbackName) {
    const fallback = typeof fallbackName === 'string' ? fallbackName : ''
    if (typeof code !== 'string' || typeof locale !== 'string') return fallback
    const upper = code.trim().toUpperCase()
    const names = displayNamesFor(locale)
    if (!names) return fallback
    try {
        const name = names.of(upper)
        if (typeof name === 'string' && name.trim() && name.toUpperCase() !== upper) return name
    } catch {
        // gecersiz kod: sunucu adina dus
    }
    return fallback
}

// Arama katlamasi: kucuk harf (toLowerCase, toLocaleLowerCase DEGIL: Turkce yerel ayarda
// 'I' noktasiz i olurdu), sonra NFD ile aksan atma ve noktasiz i -> i. Boylece
// "LIRA" / "LİRA" / "lira" ve "turk" / "Türk" ayni sonucu verir. Yalniz birlestirici
// aksanlar (U+0300-036F) atilir; Japonca dakuten gibi isaretler korunur.
const foldSearch = (value) => value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')

/**
 * Kod, sembol, sunucu adi ve (verilmisse) YEREL ad uzerinde (buyuk-kucuk harf ve aksan
 * duyarsiz, duz alt dize) arar. Bos sorgu listeyi AYNEN (ayni dizi) doner. Sorgu regex
 * DEGILDIR. Haric tutma yapmaz: o selectableCurrencies'in isi. Sira korunur.
 * @param {{code: string, name: string, symbol: string}[]} list
 * @param {string} query
 * @param {(entry: object) => string} [localName] kayit icin uygulama dilindeki ad
 * @returns {{code: string, name: string, symbol: string}[]}
 */
export function searchCurrencies(list, query, localName) {
    if (!Array.isArray(list)) return []
    const needle = typeof query === 'string' ? foldSearch(query.trim()) : ''
    if (!needle) return list
    return list.filter((entry) => {
        const fields = [entry?.code, entry?.name, entry?.symbol]
        if (typeof localName === 'function') fields.push(localName(entry))
        return fields.some((field) => typeof field === 'string' && foldSearch(field).includes(needle))
    })
}

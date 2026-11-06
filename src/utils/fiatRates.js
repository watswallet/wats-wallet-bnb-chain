// Kur modulu: sunucudaki POST /getRates tablosunu ceker, dogrular, yasini yargilar ve
// kalici depoya yazar/okur. MANTIK ve G/C burada; durum (Pinia deposu), zamanlayici ve
// gosterim (money.js) baska modullerin isi. Ag ve depo PARAMETRE olarak verilir, bu yuzden
// modul chrome'a ya da global duruma bagli degildir.
//
// SNAPSHOT (zamanlar milisaniye):
//   { rates, currencies, updatedAt, stale, fetchedAt }
//   rates      : { kod: 1 USD kac birim } (yalniz sonlu, > 0 sayilar)
//   currencies : [{ code, name, symbol }] (sunucunun TAM destek listesi)
//   updatedAt  : sunucunun kuru aldigi an (yanitta yok/bozuksa null)
//   stale      : sunucu "saglayici dustu, eski kur" dediyse true. YASI BELIRLEMEZ: yas
//                yalniz updatedAt'ten hesaplanir (asagida).
//   fetchedAt  : istemcinin yaniti aldigi an. 10 dk onbellek buna bakar.
//
// IKI AYRI SAAT: fetchedAt "istemci ne zaman sordu" (yenileme gerekli mi?), updatedAt
// "kur ne kadar eski" (gostermek dogru mu?). Sunucu 3 saat onceki kuru yeni cekilmis gibi
// verebilir; ekranin gordugu yas ikincisidir.

import axios from 'axios'
import { normalizeCurrencyCode } from './currencyCatalog'

// Istemci onbellegi: sunucunun kendi 10 dk onbellegiyle uyumlu, daha sik sormanin anlami yok.
export const RATES_TTL_MS = 10 * 60 * 1000
// Bundan eski kur GOSTERILMEZ (USD'ye dusulur). Tam sinirda (24 saat) hala kullanilir.
export const RATES_MAX_AGE_MS = 24 * 60 * 60 * 1000
// Ilk acilista kullanici bekler: takilan istek ekrani kilitlemesin.
export const RATES_FETCH_TIMEOUT_MS = 8000
export const RATES_STORAGE_KEY = 'fiat_rates'

const BASE_CURRENCY = 'usd'

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// Ham oran tablosundan yalniz kullanilabilir girdileri alir: anahtar gecerli (haric
// tutulmayan) 3 harfli kod, deger sonlu ve > 0 sayi. Anahtarlar kucuk harfe iner. Tablo
// nesne degilse null.
function cleanRates(raw) {
    if (!isPlainObject(raw)) return null
    const rates = {}
    for (const [key, value] of Object.entries(raw)) {
        const code = normalizeCurrencyCode(key)
        if (code && typeof value === 'number' && Number.isFinite(value) && value > 0) {
            rates[code] = value
        }
    }
    return rates
}

// Tabloda USD DISINDA en az bir kullanilabilir oran var mi? Sunucunun "hicbir kaynak yok"
// yaniti { usd: 1 } (server/utils/fx.js getRates son dal) bos tablodur: USD kendi kuru
// oldugu icin hicbir birimi ceviremez, ama tek girdi olarak "dolu" gorunur. Bos sayilmazsa
// eldeki iyi kur tablosunu ezer ve secici yalniz USD'ye iner.
function hasNonBaseRate(rates) {
    return Object.keys(rates).some((code) => code !== BASE_CURRENCY)
}

// code/name/symbol'un UCU de metin olan girdiler kalir; fazladan alanlar kirpilir.
function cleanCurrencies(raw) {
    if (!Array.isArray(raw)) return []
    return raw
        .filter((entry) => isPlainObject(entry)
            && typeof entry.code === 'string'
            && typeof entry.name === 'string'
            && typeof entry.symbol === 'string')
        .map((entry) => ({ code: entry.code, name: entry.name, symbol: entry.symbol }))
}

// ISO metni -> ms. Metin degilse ya da cozulemezse null (yas kanitlanamaz).
function parseTimestamp(value) {
    if (typeof value !== 'string') return null
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
}

/**
 * /getRates yanit govdesini Snapshot'a cevirir; kullanilamazsa null. Kullanilamaz:
 * govde nesne degil, success true degil, base 'usd' degil (oranlar baska bir birime gore
 * olabilir), oran tablosu yok ya da ayiklamadan sonra USD disinda TEK kullanilabilir oran
 * kalmiyor (bos bir tablo, sunucunun kendi { usd: 1 } "kaynak yok" yaniti dahil, eldeki iyi
 * onbellegin yerine gecmesin).
 * @param {unknown} data
 * @param {number} now ms; fetchedAt olur
 * @returns {{rates: Record<string, number>, currencies: {code: string, name: string, symbol: string}[], updatedAt: number | null, stale: boolean, fetchedAt: number} | null}
 */
export function parseRatesResponse(data, now) {
    if (!isPlainObject(data)) return null
    if (data.success !== true || data.base !== BASE_CURRENCY) return null
    const rates = cleanRates(data.rates)
    if (!rates || !hasNonBaseRate(rates)) return null
    return {
        rates,
        currencies: cleanCurrencies(data.currencies),
        updatedAt: parseTimestamp(data.updatedAt),
        stale: data.stale === true,
        fetchedAt: now,
    }
}

/**
 * Sunucudan kur tablosunu ceker. Ag hatasinda ve gecersiz yanitta ATAR: eldeki kurla
 * devam etme karari cagirana (depo) aittir.
 * @param {{ api: string, http?: { post: Function }, now?: () => number }} options
 */
export async function fetchRatesSnapshot({ api, http = axios, now = Date.now } = {}) {
    if (typeof api !== 'string' || !api) throw new Error('Kur adresi (api) yok')
    // Govde {} : daraltma yok, sunucu TAM tabloyu verir (menu de bu listeden kurulur).
    const response = await http.post(api + '/getRates', {}, { timeout: RATES_FETCH_TIMEOUT_MS })
    const snapshot = parseRatesResponse(response?.data, now())
    if (!snapshot) throw new Error('Gecersiz kur yaniti')
    return snapshot
}

/**
 * Snapshot yenilemeden kullanilabilir mi (10 dk'dan genc mi)? Gelecekteki fetchedAt
 * (sistem saati geri alinmis) TAZE SAYILMAZ: aksi halde saat duzelene kadar yenileme hic
 * tetiklenmez, bu arada resolveDisplay'in 24 saat kurali kuru eskitir.
 * @param {object | null | undefined} snapshot
 * @param {number} now ms
 */
export function isSnapshotFresh(snapshot, now) {
    if (!snapshot || !Number.isFinite(snapshot.fetchedAt) || !Number.isFinite(now)) return false
    const age = now - snapshot.fetchedAt
    return age >= 0 && age < RATES_TTL_MS
}

/**
 * Yeni cekilen tablo eldekinin YERINE gecmeli mi? Yalniz yeni tablonun kur zamani (updatedAt)
 * BILINIYORSA ve eldekinden eski DEGILSE. Yasi kanitlanamayan (updatedAt null) ya da daha
 * eski bir tablo, eldeki daha yeni iyi tabloyu ezmesin: sunucu yeniden basladiysa ve yedegi
 * geridense istemci elindeki taze kuru korur. Esit zaman benimsenir (fetchedAt tazelenir,
 * 10 dk boyunca yeniden sorulmaz). Eldeki tablo yoksa ya da zamani bilinmiyorsa, zamani
 * bilinen her tablo gecer.
 * @param {object | null | undefined} current eldeki snapshot
 * @param {object | null | undefined} next yeni cekilen snapshot
 * @returns {boolean}
 */
export function shouldAdoptSnapshot(current, next) {
    if (!next || !Number.isFinite(next.updatedAt)) return false
    if (current && Number.isFinite(current.updatedAt) && next.updatedAt < current.updatedAt) return false
    return true
}

const usdFallback = (requested) => ({ code: BASE_CURRENCY, rate: 1, fellBack: true, requested })

/**
 * Secilen birim icin gosterim nesnesi: { code, rate, fellBack, requested? }.
 *  - 'usd' kur gerektirmez: her zaman fellBack:false.
 *  - Aksi halde kur tabloda olmali VE yasi (now - updatedAt) 24 saati gecmemeli. Tam 24
 *    saat kullanilir, 24 saat + 1 ms duser. `stale` bayragina BAKILMAZ.
 *  - updatedAt bilinmiyorsa yas kanitlanamaz: duser. Gelecekteki updatedAt (saat kaymasi)
 *    kullanilir.
 *  - Kod gecersiz / haric tutulan (vef, xdr) / tabloda yok -> USD'ye duser, fellBack:true,
 *    requested = istenen kod: ekran "USD 12.34" yazar, ASLA kur simgesiyle yazilmis eski ya da uydurma sayi.
 * Yas HER cagrida now ile hesaplanir; sonuc onbellege baglanmaz.
 * Soz diziminde gecerli ama sunucu tablosunda olmayan kodu ("xyz") burasi eler: istemcide
 * statik izinli liste yoktur (bkz. currencyCatalog.js).
 * @param {string} code
 * @param {object | null | undefined} snapshot
 * @param {number} now ms
 */
export function resolveDisplay(code, snapshot, now) {
    const normalized = normalizeCurrencyCode(code)
    if (normalized === BASE_CURRENCY) return { code: BASE_CURRENCY, rate: 1, fellBack: false }
    if (!normalized) return usdFallback(String(code))

    const rates = snapshot?.rates
    const rate = isPlainObject(rates) && Object.prototype.hasOwnProperty.call(rates, normalized)
        ? rates[normalized]
        : undefined
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return usdFallback(normalized)

    const updatedAt = snapshot.updatedAt
    if (!Number.isFinite(updatedAt) || !Number.isFinite(now)) return usdFallback(normalized)
    if (now - updatedAt > RATES_MAX_AGE_MS) return usdFallback(normalized)

    return { code: normalized, rate, fellBack: false }
}

// Depodan okunan kaydi Snapshot'a cevirir; bozuksa null. Kayit bizim yazdigimiz bicimde
// olmali: fetchedAt sonlu sayi, updatedAt sonlu sayi ya da null, oran tablosu nesne ve
// ayiklamadan sonra USD disinda en az bir oran var (eski surumun diske yazdigi { usd: 1 }
// tablosu da bos sayilir: parseRatesResponse ile ayni kural).
function cleanStored(raw) {
    if (!isPlainObject(raw)) return null
    const rates = cleanRates(raw.rates)
    if (!rates || !hasNonBaseRate(rates)) return null
    if (!Number.isFinite(raw.fetchedAt)) return null
    if (raw.updatedAt !== null && !Number.isFinite(raw.updatedAt)) return null
    return {
        rates,
        currencies: cleanCurrencies(raw.currencies),
        updatedAt: raw.updatedAt,
        stale: raw.stale === true,
        fetchedAt: raw.fetchedAt,
    }
}

// ---- depo yardimcilari ----
// Kalici kur bir KOLAYLIKTIR (popup acilisinda ilk kare dogru birimle ciksin, ag
// gelmeden). Depo hatasi ne yenilemeyi ne ekrani dusurmeli; hata YUTULUR.

/**
 * @param {{ get: Function } | null | undefined} storage chrome.storage.local benzeri
 * @returns {Promise<object | null>} bozuk / yok / depo hatasi -> null
 */
export async function readStoredSnapshot(storage) {
    try {
        const result = await storage.get(RATES_STORAGE_KEY)
        return cleanStored(result?.[RATES_STORAGE_KEY])
    } catch {
        return null
    }
}

/**
 * Snapshot nesne degilse YAZMAZ (eldeki iyi kaydi null ile ezmesin). Depo hatasi yutulur.
 * @param {{ set: Function } | null | undefined} storage chrome.storage.local benzeri
 * @param {object} snapshot
 * @returns {Promise<void>}
 */
export async function writeSnapshot(storage, snapshot) {
    if (!isPlainObject(snapshot)) return
    try {
        await storage.set({ [RATES_STORAGE_KEY]: snapshot })
    } catch {
        // yutulur
    }
}

// Token sayfasindaki fiyat grafiginin veri kaynagi.
//
// Grafik eskiden dogrudan CryptoCompare min-api'sine gidiyordu; o uc nokta artik
// anahtarsiz 401 doner, yani grafik HER token icin bostu. Veri artik kendi
// backend'imizin /getTokenPriceHistory ucundan gelir (CoinGecko proxy'si): anahtar
// istemciye sizmaz, onbellek tum kullanicilar arasinda paylasilir.
//
// TEK KURAL: hicbir hata yolu firlatmaz. Grafik ikincil icerik — veri gelmezse
// "fiyat gecmisi yok" yazisi gosterilir, token sayfasi calismaya devam eder.
//
// PARA BIRIMI: sunucu seriyi istenen birimde verir (kendi kur katmanindan, istemcinin
// kur tablosundan DEGIL). CoinGecko 13 nadir birimde (ron kes cop pen ...) seri
// vermedigi icin sunucu USD doner ve yanitta `currency: 'usd'` yazar; etiket bu yuzden
// ISTENEN birime degil YANITTAKI birime gore yazilir (chartTooltipLabel).

import axios from 'axios'
import { formatCurrencyAmount } from './money'

// Grafik acilirken kullanici bekliyor; sunucu tarafi zaten 6sn'de vazgeciyor.
const TIMEOUT_MS = 8000

const DEFAULT_DAYS = 30
const DEFAULT_CURRENCY = 'usd'

// Birim kodunu kucuk harfe indirir; metin degilse ya da bossa USD.
function normalizeCurrency(value) {
    if (typeof value !== 'string') return DEFAULT_CURRENCY
    const code = value.trim().toLowerCase()
    return code || DEFAULT_CURRENCY
}

/**
 * CoinGecko bicimi [[ms, fiyat], ...] -> Chart.js icin { time, date, close }.
 * Bozuk govdede bos dizi doner (eski koddaki TypeError'in kaynagi buydu).
 * `locale` (uygulama dili) EN SONA eklenen istege bagli parametredir: tarih etiketi o dilin
 * bicimiyle yazilir; verilmezse eski davranis (tarayici/sistem dili) korunur.
 */
export function toChartPoints(prices, locale) {
    if (!Array.isArray(prices)) return []

    return prices
        .filter(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
        .map(([ms, close]) => ({
            time: ms,
            date: new Date(ms).toLocaleDateString(locale),
            close
        }))
}

/**
 * Fiyat serisini istenen birimde ister.
 * Doner: { points, currency }. `currency` serinin GERCEK birimidir: yanittaki `currency`
 * (kucuk harf), yanitta yoksa ya da gecersizse 'usd' (eski sunucunun tek birimi; istenen birim
 * VARSAYILMAZ). Her hata yolunda { points: [], currency: istenen }; ASLA atmaz.
 * @param {string} api
 * @param {string} coingeckoId
 * @param {number} [days]
 * @param {string} [currency] istenen birim kodu (varsayilan 'usd')
 * @param {string} [locale] uygulama dili: yalniz tarih etiketlerini etkiler, istege girmez
 * @returns {Promise<{ points: Array<{ time: number, date: string, close: number }>, currency: string }>}
 */
export async function fetchPriceSeries(api, coingeckoId, days = DEFAULT_DAYS, currency = DEFAULT_CURRENCY, locale) {
    const requested = normalizeCurrency(currency)
    const failed = { points: [], currency: requested }

    // Ice aktarilan tokenlerin coingecko kimligi olmayabilir: bosuna ag istegi atma.
    if (!api || typeof coingeckoId !== 'string' || !coingeckoId) return failed

    try {
        const response = await axios.post(
            api + '/getTokenPriceHistory',
            { id: coingeckoId, days, currency: requested },
            { timeout: TIMEOUT_MS }
        )

        if (response.status !== 200 || !response.data?.success) return failed
        // Basarili gorunup fiyat dizisi bozuksa seri guvenilmezdir: hata yolu.
        if (!Array.isArray(response.data.prices)) return failed

        // Yanit `currency` tasimiyorsa (ya da metin degilse) seri USD sayilir, ISTENEN birim DEGIL:
        // `currency` alanindan ONCEKI sunucu istegin birimini yok sayip her zaman USD seri verir,
        // istenen birimi varsaymak USD sayiyi secili birimin sembolu ("₺1.02") ile yazdirirdi.
        // Guncel sunucu her basarili yolda `currency` doner (tokenController.getTokenPriceHistory).
        return {
            points: toChartPoints(response.data.prices, locale),
            currency: normalizeCurrency(response.data.currency),
        }

    } catch (e) {
        console.warn('Fiyat gecmisi alinamadi:', e.message)
        return failed
    }
}

// Eski imza: yalniz noktalar (USD). Birim bilgisi gereken cagiranlar fetchPriceSeries kullanir.
// `locale` yalniz tarih etiketleri icindir (bkz. toChartPoints).
export async function fetchPriceHistory(api, coingeckoId, days = DEFAULT_DAYS, locale) {
    return (await fetchPriceSeries(api, coingeckoId, days, undefined, locale)).points
}

/**
 * Grafik ipucu (tooltip) metni. Deger ZATEN `seriesCurrency` birimindedir: donusum yapilmaz.
 * Seri secili birimdeyse ve gorunum USD'ye DUSMEMISSE sembolle ("₺1.234,50"), aksi halde
 * kod etiketle ("USD 12.34"): sunucu nadir birimde USD verdiyse ya da kur yoksa grafik
 * secili birimin sembolunu tasiyip yanlis para gibi gorunmez. Fiyat yuzeyi oldugu icin
 * `price` stili (cok kucuk fiyat sifira yuvarlanmaz). Gecersiz degerde '' doner.
 * @param {number} value
 * @param {{ seriesCurrency: string, display?: { code: string, fellBack?: boolean }, locale?: string }} ctx
 * @returns {string}
 */
export function chartTooltipLabel(value, { seriesCurrency, display, locale } = {}) {
    const series = normalizeCurrency(seriesCurrency)
    // Gorunum verilmediyse USD gibi calisir (money.js ile ayni kural).
    const shown = display || { code: DEFAULT_CURRENCY, fellBack: false }
    const matches = series === normalizeCurrency(shown.code) && !shown.fellBack

    const text = formatCurrencyAmount(value, series, {
        style: 'price',
        locale,
        currencyDisplay: matches ? 'symbol' : 'code',
    })
    return text ?? ''
}

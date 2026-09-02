// Token sayfasindaki fiyat grafiginin veri kaynagi.
//
// Grafik eskiden dogrudan CryptoCompare min-api'sine gidiyordu; o uc nokta artik
// anahtarsiz 401 doner, yani grafik HER token icin bostu. Veri artik kendi
// backend'imizin /getTokenPriceHistory ucundan gelir (CoinGecko proxy'si): anahtar
// istemciye sizmaz, onbellek tum kullanicilar arasinda paylasilir.
//
// TEK KURAL: hicbir hata yolu firlatmaz. Grafik ikincil icerik — veri gelmezse
// "fiyat gecmisi yok" yazisi gosterilir, token sayfasi calismaya devam eder.

import axios from 'axios'

// Grafik acilirken kullanici bekliyor; sunucu tarafi zaten 6sn'de vazgeciyor.
const TIMEOUT_MS = 8000

const DEFAULT_DAYS = 30

/**
 * CoinGecko bicimi [[ms, fiyat], ...] -> Chart.js icin { time, date, close }.
 * Bozuk govdede bos dizi doner (eski koddaki TypeError'in kaynagi buydu).
 */
export function toChartPoints(prices) {
    if (!Array.isArray(prices)) return []

    return prices
        .filter(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
        .map(([ms, close]) => ({
            time: ms,
            date: new Date(ms).toLocaleDateString(),
            close
        }))
}

export async function fetchPriceHistory(api, coingeckoId, days = DEFAULT_DAYS) {
    // Ice aktarilan tokenlerin coingecko kimligi olmayabilir: bosuna ag istegi atma.
    if (!api || typeof coingeckoId !== 'string' || !coingeckoId) return []

    try {
        const response = await axios.post(
            api + '/getTokenPriceHistory',
            { id: coingeckoId, days },
            { timeout: TIMEOUT_MS }
        )

        if (response.status !== 200 || !response.data?.success) return []

        return toChartPoints(response.data.prices)

    } catch (e) {
        console.warn('Fiyat gecmisi alinamadi:', e.message)
        return []
    }
}

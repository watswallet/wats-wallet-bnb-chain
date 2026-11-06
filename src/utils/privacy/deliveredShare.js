import { parseUnits } from 'ethers'

// TAHMINI TESLIM EDILEN DEGER PAYI (gizli-mod cok-ag spec 4.8 "Teklif karti", E20). POPUP-GUVENLI: ethers disinda hicbir sey
// import etmez. Kart, kullanicinin odedigi brut tutarin yuzde kacinin teslim edilmesinin beklendigini ve maliyetin %4'u
// asip asmadigini gosterir. Bu UYARI bilgi amaclidir, kontrol DEGILDIR: gercek korumalar `min > 0`, `beklenen >= min` ve
// USDC icin `min <= odeme`dir (silentswap.js assertQuoteMatches).
//
// Tablo USDC si icin pay, teklifin KENDI tutarlarindan BigInt ile hesaplanir: beklenen teslim 18 ondaliga olceklenip brut
// tutara bolunur (USDC teslimi BSC'de 18, oteki aglarda 6 ondaliktir). Sunucunun USD yankisi bu yolda hic kullanilmaz.
// Baska tokenlerde yalniz `dest.quoteUsd` vardir (sunucu yankisi, yalniz bilgi). Hesaplanamayan her durumda pay null olur
// ve UYARI CIKMAZ; kart bunu "dogrulanamadi" notuyla soyler. Fiyat istegi yoktur.
//
// Ic gosterim "yuzde puan x 10" tam sayisidir (pay10): 98.6% -> 986. Boylece 4.0 esigi ondalik kayan nokta hatasina girmez.
export const COST_WARNING_ABOVE_PCT = 4

const DIGITS_RE = /^\d+$/
const NONE = Object.freeze({ pay: null, cost: null, warn: false })

// totalUsdc: insan birimi dizge (18 ondalik). Bozuk, sifir ya da 18'den cok ondalikli ise null.
function grossUnits(totalUsdc) {
    try {
        const gross = parseUnits(String(totalUsdc), 18)
        return gross > 0n ? gross : null
    } catch {
        return null
    }
}

export function deliveredShare(quote, { tableUsdc = false } = {}) {
    const dest = quote?.dest
    if (!dest || typeof dest !== 'object') return NONE
    let pay10 = null
    if (tableUsdc) {
        const gross = grossUnits(quote.totalUsdc)
        const decimals = dest.decimals
        const raw = typeof dest.expectedDestAmount === 'string' ? dest.expectedDestAmount : ''
        if (gross === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 18 || !DIGITS_RE.test(raw)) return NONE
        const scaled = BigInt(raw) * 10n ** BigInt(18 - decimals)
        // round(scaled * 1000 / gross), yarim yukari
        pay10 = Number((scaled * 2000n + gross) / (2n * gross))
    } else {
        const usd = Number(dest.quoteUsd)
        const total = Number(quote.totalUsdc)
        if (dest.quoteUsd === null || dest.quoteUsd === undefined || !Number.isFinite(usd) || usd <= 0 || !Number.isFinite(total) || total <= 0) return NONE
        pay10 = Math.round((usd / total) * 1000)
    }
    return { pay: pay10 / 10, cost: (1000 - pay10) / 10, warn: 1000 - pay10 > COST_WARNING_ABOVE_PCT * 10 }
}

// Kova ilkeli (token bucket) hiz siniri -- SAF katman.
//
// AG YOK, DEPO YOK, chrome API'si YOK, zamanlayici YOK: yalnizca bellekte bir sayac ve
// disaridan verilen bir saat (`now`). Saat enjekte edildigi icin testler gercek zaman
// beklemez. Durum BELLEKTEDIR: service worker yeniden baslarsa kova dolu baslar (kabul
// edilen sinir; bu yuzden okuma gecidinde ayrica global kova vardir).
//
// Kullanim:
//   const bucket = createTokenBucket({ rate: 5, burst: 20 })   // saniyede 5, patlama 20
//   const r = bucket.take(5)                                   // agirlikli istek
//   if (!r.ok) ... r.retryAfterMs ms sonra tekrar dene
//
// KARARLAR (bozulursa sessiz kayma olur):
//   - Kova DOLU baslar (ilk patlama serbest).
//   - `cost` kovanin kapasitesini (`burst`) asarsa kapasiteye KIRPILIR: kova tam doluyken
//     tek seferde gecer ve kovayi bosaltir. Asla "sonsuza dek reddet" olmaz.
//   - Gecersiz `cost` (0, negatif, NaN, sayi degil) UCRETSIZ sayilmaz: 1 jeton oder.
//   - Saat geriye giderse (sistem saati degisince) yenileme OLMAZ ve kova dondurulmaz:
//     referans nokta yeni saate cekilir.
//   - Gecersiz saat okumasi (NaN) yok sayilir.

const EPSILON = 1e-9

export function createTokenBucket({ rate, burst, now = () => Date.now() } = {}) {
    if (!(Number.isFinite(rate) && rate > 0)) {
        throw new RangeError('tokenBucket: rate pozitif ve sonlu bir sayi olmali')
    }
    if (!(Number.isFinite(burst) && burst >= 1)) {
        throw new RangeError('tokenBucket: burst en az 1 olan sonlu bir sayi olmali')
    }
    if (typeof now !== 'function') {
        throw new TypeError('tokenBucket: now bir fonksiyon olmali')
    }

    let tokens = burst
    let last = now()

    function refill() {
        const t = now()
        if (!Number.isFinite(t)) return
        if (t > last) {
            // Once carp, sonra bol: 200 ms * 5 / 1000 tam 1 verir (0.2 * 5 kayan nokta riski yok).
            tokens = Math.min(burst, tokens + ((t - last) * rate) / 1000)
        }
        last = t
    }

    function normalizeCost(cost) {
        if (!Number.isFinite(cost) || cost <= 0) return 1
        return Math.min(cost, burst)
    }

    return {
        // { ok: true } veya { ok: false, retryAfterMs } -- retryAfterMs her zaman >= 1 tamsayi.
        take(cost = 1) {
            refill()
            const c = normalizeCost(cost)
            if (tokens + EPSILON >= c) {
                tokens = Math.max(0, tokens - c)
                return { ok: true }
            }
            // 1e-6: kayan nokta artigi (1.0000000000000009) yuzunden bir ms fazla bekletmesin.
            const wait = Math.ceil(((c - tokens) * 1000) / rate - 1e-6)
            return { ok: false, retryAfterMs: Math.max(1, wait) }
        },

        // Alinmis ama KULLANILMAMIS jetonu geri verir (ust sinir: burst). Iki kovali
        // kapilarda (origin + global) ikincisi reddedince birincinin jetonunu iade etmek icin.
        refund(cost = 1) {
            refill()
            tokens = Math.min(burst, tokens + normalizeCost(cost))
        },

        // Su an alinabilir jeton (kesirli olabilir). Yalniz tani/test icin.
        available() {
            refill()
            return tokens
        },
    }
}

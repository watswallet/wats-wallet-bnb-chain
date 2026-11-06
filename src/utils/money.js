// Para birimi biçimlendirici: ekranlardaki TUM fiyat/deger metni buradan gecer.
// SAF modul: chrome API'sine, agsa, depoya dokunmaz; yalniz Intl.NumberFormat kullanir.
//
// Veri akisi: fiyatlar USD tutulur; secili birime cevirme `priceUSD x kur` ile burada
// yapilir (convertUsd). Kur yoksa ya da 24 saatten eskiyse gorunum nesnesi USD'ye
// duser (fellBack: true) ve tutar "USD 12.34" diye KOD ETIKETLIYLE yazilir; boylece
// ekran hicbir zaman eski/yanlis kurla "₺" basmaz.
//
// Gorunum nesnesi: { code: string (kucuk harf), rate: number, fellBack: boolean,
// requested?: string }. Ureticisi kur katmani (resolveDisplay); burada yalniz okunur.

export const USD_DISPLAY = Object.freeze({ code: 'usd', rate: 1, fellBack: false })

// "price" stilinin kucuk fiyatlarda gosterdigi en fazla ondalik ve altinda "<" yazilan
// esik. Cok kucuk token fiyatlari ($0.000008) sifira yuvarlanip "$0.00" gorunmesin.
const PRICE_MAX_FRACTION = 6
const PRICE_FLOOR = 1e-6
// Birimin ondaligi kucuk fiyati tasimadiginda (JPY 7.56) kullanilan anlamli basamak sayisi.
const PRICE_SIGNIFICANT = 4

// "compact" stili bu mutlak degerden itibaren devreye girer ($1.5K, $1.23M).
const COMPACT_FROM = 1000
const COMPACT_MAX_FRACTION = 2

// Intl.NumberFormat'in anlamli basamak ust siniri 21'dir.
const MAX_SIGNIFICANT = 21

// Gecerli sayiya cevirir; olmuyorsa null. Number(null) ve Number('') 0 verir: bu
// tuzak yuzunden "fiyat yok" durumu "$0.00" gorunurdu. O iki girdi (ve bosluk metni)
// sayiya cevrilmeden elenir. Yalniz sayi ve metin kabul edilir (true -> 1 olmasin).
function toNumber(value) {
    if (typeof value === 'string') {
        if (value.trim() === '') return null
    } else if (typeof value !== 'number') {
        return null
    }
    const n = Number(value)
    return Number.isFinite(n) ? n : null
}

// Sayiyi secili birime cevirir. Girdi ya da kur gecersizse null (kur 0 / negatif
// "bedava" ya da eksi deger yazdirirdi). `display` verilmezse USD gibi calisir: fiyat
// zaten USD'dir, bu yuzden dogru deger doner.
export function convertUsd(usd, display) {
    const n = toNumber(usd)
    if (n === null) return null

    const rate = Number((display || USD_DISPLAY).rate)
    if (!Number.isFinite(rate) || rate <= 0) return null

    const converted = n * rate
    return Number.isFinite(converted) ? converted : null
}

// ---- Intl onbellegi ----

// Intl.NumberFormat kurmak pahali; ana ekran listesi satir basina onlarca kez cagirir.
// Anahtar uzayi kucuk (dil x birim x stil), yine de sinirlanir.
const FORMAT_CACHE = new Map()
const FORMAT_CACHE_MAX = 300

function numberFormat(locale, code, options) {
    const key = `${locale}|${code}|${JSON.stringify(options)}`
    let nf = FORMAT_CACHE.get(key)
    if (!nf) {
        nf = new Intl.NumberFormat(locale, { style: 'currency', currency: code, ...options })
        if (FORMAT_CACHE.size >= FORMAT_CACHE_MAX) FORMAT_CACHE.clear()
        FORMAT_CACHE.set(key, nf)
    }
    return nf
}

// Birimin varsayilan ondaligi (USD 2, JPY 0, KWD 3).
function defaultDigits(locale, code) {
    return numberFormat(locale, code, {}).resolvedOptions().maximumFractionDigits
}

// "Kucuk fiyat" siniri: gosterim birimindeki deger birimin 100 en kucuk biriminden azsa
// (USD/EUR/TRY < 1, JPY/KRW/VND < 100, KWD < 0.1) birim ondaligi fiyati tasimaya yetmez.
// Ondalik `d` Intl'den gelir, sabit liste yok. 100 / 10^d tam sonuc verir (100 * 0.01 degil).
function smallPriceLimit(d) {
    return 100 / Math.pow(10, d)
}

// ---- Bicim plani ----

// Degerin hangi Intl secenekleriyle yazilacagini ve "<" onekinin gerekip gerekmedigini
// belirler. `value` Intl'e verilecek sayidir: "<" durumunda esigin kendisidir.
function plan(n, d, opts) {
    const minUnit = Math.pow(10, -d)
    const abs = Math.abs(n)
    const standard = { minimumFractionDigits: d, maximumFractionDigits: d }

    // Negatif ve birimin ondaligina yuvarlaninca sifir olan deger "-$0.00" yazmasin;
    // -0 da ayni sekilde (Intl isaret gosterir).
    const zeroed = n === 0 || (n < 0 && Math.round(abs * Math.pow(10, d)) === 0) ? 0 : n

    // Anlamli basamak: yalniz 0 < |v| < smallPriceLimit icin (USD'de 1); sifir "$0" yazmasin, ustu standart.
    if (opts.significant !== undefined && opts.significant !== null) {
        const sig = Number(opts.significant)
        if (Number.isInteger(sig) && sig >= 1 && sig <= MAX_SIGNIFICANT && abs > 0 && abs < smallPriceLimit(d)) {
            return { value: n, options: { maximumSignificantDigits: sig }, lessThan: false }
        }
        return { value: zeroed, options: standard, lessThan: false }
    }

    if (opts.style === 'price') {
        if (abs > 0 && abs < PRICE_FLOOR) {
            // Pozitif cok kucuk deger "<$0.000001"; negatif karsiligi sifir sayilir.
            if (n > 0) {
                return {
                    value: PRICE_FLOOR,
                    options: { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, PRICE_MAX_FRACTION) },
                    lessThan: true,
                }
            }
            return { value: 0, options: standard, lessThan: false }
        }
        if (abs > 0 && abs < minUnit) {
            return {
                value: n,
                options: { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, PRICE_MAX_FRACTION) },
                lessThan: false,
            }
        }
        // Ondaliksiz/3 ondalikli birimlerde (JPY, KRW, VND, KWD...) birim ondaligi kucuk fiyati
        // tasimaz: 7.56 -> "¥8". Birimin 100 en kucuk biriminin altinda 4 anlamli basamak yazilir;
        // asgari ondalik d kalir. 2 ondalikli birimler (USD/EUR/TRY) bugunku sent cozunurlugunu korur.
        if (d !== 2 && abs >= minUnit && abs < smallPriceLimit(d)) {
            const exponent = Math.floor(Math.log10(abs))
            return {
                value: n,
                options: {
                    minimumFractionDigits: d,
                    maximumFractionDigits: Math.max(d, Math.min(PRICE_MAX_FRACTION, PRICE_SIGNIFICANT - 1 - exponent)),
                },
                lessThan: false,
            }
        }
        return { value: zeroed, options: standard, lessThan: false }
    }

    if (opts.style === 'compact' && abs >= COMPACT_FROM) {
        // minimumFractionDigits 0 sart: 3 ondalikli birimde (KWD) varsayilan minimum
        // 3 > maksimum 2 olup eski motorlarda RangeError atiyor.
        return {
            value: n,
            options: { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: COMPACT_MAX_FRACTION },
            lessThan: false,
        }
    }

    // standard (ve compact'in 1000 alti)
    if (n > 0 && n < minUnit) return { value: minUnit, options: standard, lessThan: true }
    return { value: zeroed, options: standard, lessThan: false }
}

// Sayiyi Intl parcalarina boler. Intl hata atarsa (bozuk birim kodu ya da dil etiketi)
// `<deger> <KOD>` yedegi uretilir: biçimlendirici ekrani asla cokertmez.
function toParts(n, code, opts) {
    try {
        const locale = opts.locale || 'en'
        const d = defaultDigits(locale, code)
        const p = plan(n, d, opts)
        const options = { ...p.options }
        if (opts.currencyDisplay === 'code') options.currencyDisplay = 'code'
        return { parts: numberFormat(locale, code, options).formatToParts(p.value), lessThan: p.lessThan }
    } catch {
        const parts = []
        if (n < 0) parts.push({ type: 'minusSign', value: '-' })
        parts.push({ type: 'integer', value: Math.abs(n).toFixed(2) })
        parts.push({ type: 'literal', value: ' ' })
        parts.push({ type: 'currency', value: code })
        return { parts, lessThan: false }
    }
}

// Girdiyi dogrular ve parcalari dondurur; gecersizse null.
function prepare(value, code, opts) {
    const n = toNumber(value)
    if (n === null) return null
    // Kodsuz tutar hangi para oldugunu soylemez: yazilmaz.
    if (typeof code !== 'string' || code.trim() === '') return null
    return toParts(n, code.trim().toUpperCase(), opts || {})
}

// Deger ZATEN `code` biriminde olan tutari yazar (grafik etiketi gibi). Donusum yapmaz.
export function formatCurrencyAmount(value, code, opts) {
    const r = prepare(value, code, opts)
    if (!r) return null
    return (r.lessThan ? '<' : '') + r.parts.map((p) => p.value).join('')
}

// USD tutarini gorunum birimine cevirip yazar. Kur yoksa (fellBack) birim kodu yazilir.
export function formatMoney(usd, display, opts) {
    const d = display || USD_DISPLAY
    const converted = convertUsd(usd, d)
    if (converted === null) return null
    return formatCurrencyAmount(converted, d.code, withCodeLabel(d, opts))
}

// formatMoney ile ayni tutari uc parcaya boler: sembol/onek, sayi, son ek. Ekranlar
// sayiyi buyuk, sembolu kucuk cizmek icin kullanir. "<" oneki prefix'e girer.
export function moneyParts(usd, display, opts) {
    const d = display || USD_DISPLAY
    const converted = convertUsd(usd, d)
    if (converted === null) return null

    const r = prepare(converted, d.code, withCodeLabel(d, opts))
    if (!r) return null

    const { parts } = r
    const first = parts.findIndex((p) => p.type === 'integer')
    let last = -1
    parts.forEach((p, i) => {
        if (p.type === 'integer' || p.type === 'fraction') last = i
    })
    // Tamsayi parcasi olmayan bir cikti beklenmez; olursa tum metin sayi sayilir.
    if (first === -1) {
        return { prefix: '', number: parts.map((p) => p.value).join('').trim(), suffix: '' }
    }

    const join = (list) => list.map((p) => p.value).join('').trim()
    return {
        prefix: (r.lessThan ? '<' : '') + join(parts.slice(0, first)),
        number: join(parts.slice(first, last + 1)),
        suffix: join(parts.slice(last + 1)),
    }
}

// Kur yokken USD'ye dusuldu: tutar "$" ile degil "USD" koduyla yazilir.
function withCodeLabel(display, opts) {
    return display.fellBack ? { ...opts, currencyDisplay: 'code' } : opts
}

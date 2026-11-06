import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { currencyStore } from '../store/currency'
import { convertUsd, formatMoney, moneyParts } from '../utils/money'

/**
 * Ekranlarin para gosterimi icin TEK giris noktasi.
 *
 * Secili birim (currencyStore.display) ve uygulama dili (vue-i18n locale) burada
 * baglanir; ekran yalniz USD tutari verir, bicimi/cevirmeyi bu composable yapar.
 * Fonksiyonlar `display` ve `locale`i CAGRI ANINDA okur: sablonda kullanilinca birim,
 * kur ya da dil degisince (baska pencerede secim yapilsa da) ekran kendiliginden guncellenir.
 *
 * `opts` utils/money.js'in `opts`'u: { style: 'price' | 'compact', significant,
 * currencyDisplay, locale }. `locale` verilmezse uygulama dilidir. `money()` icin ek olarak
 * `invalid` (asagida).
 *
 * IKI AILE (bilerek ayri):
 *  - money / parts: gecersiz girdide `null` (money'de `invalid` metni). tire ("-") basan, yani
 *    fiyati BILINMEYEN yuzeyler bunlari kullanir ve kendi bilinmiyor dalini korur.
 *  - moneyOrZero / partsOrZero: gecersiz girdide AYNI opts ve display ile `0`in bicimini
 *    doner, hicbir zaman null degil. Bugun "0.00" / "0" basan yuzeyler icindir. Fiyati
 *    bilinmeyen yuzey bunlari KULLANMAZ: tire yerine "$0.00" yazmak yalan olur.
 *
 * Gecersiz girdi = null, undefined, '', bosluk, NaN, +-Infinity (utils/money.js).
 */
export function useMoney() {
    const store = currencyStore()
    const { locale } = useI18n()

    const display = computed(() => store.display)

    // Uygulama dilini ekler; `invalid` bicimlendiriciye gitmez (yalniz money() kullanir).
    function withLocale(opts) {
        const rest = { ...opts }
        delete rest.invalid
        return { ...rest, locale: rest.locale || locale.value }
    }

    /**
     * USD tutarini secili birimde yazar. Gecersiz girdide `opts.invalid` (verilmediyse null).
     * @param {unknown} usd
     * @param {object} [opts]
     * @returns {string | null}
     */
    function money(usd, opts) {
        const text = formatMoney(usd, display.value, withLocale(opts))
        if (text !== null) return text
        return opts?.invalid ?? null
    }

    /**
     * money ile ayni tutari { prefix, number, suffix } olarak boler (sayi buyuk, sembol
     * kucuk cizmek icin). Gecersiz girdide null; `invalid` burada anlamsizdir, yok sayilir.
     * @param {unknown} usd
     * @param {object} [opts]
     * @returns {{ prefix: string, number: string, suffix: string } | null}
     */
    function parts(usd, opts) {
        return moneyParts(usd, display.value, withLocale(opts))
    }

    /**
     * money gibi, ama gecersiz girdide `0`in bicimini doner (null degil). `invalid` yok sayilir.
     * Sifir her kurda sifirdir; display'in kuru resolveDisplay'den hep gecerli gelir.
     * @param {unknown} usd
     * @param {object} [opts]
     * @returns {string}
     */
    function moneyOrZero(usd, opts) {
        const o = withLocale(opts)
        return formatMoney(usd, display.value, o) ?? formatMoney(0, display.value, o)
    }

    /**
     * parts gibi, ama gecersiz girdide `0`in parcalarini doner (null degil).
     * @param {unknown} usd
     * @param {object} [opts]
     * @returns {{ prefix: string, number: string, suffix: string }}
     */
    function partsOrZero(usd, opts) {
        const o = withLocale(opts)
        return moneyParts(usd, display.value, o) ?? moneyParts(0, display.value, o)
    }

    /**
     * USD birim fiyatini secili birime cevirir (`priceUsd x kur`), sayi olarak. Gonder
     * ekraninin fiat girisi icin: kur yokken ekran USD'ye dustugunden rate 1'dir ve fiyat
     * degismeden doner. Gecersiz girdide null.
     * @param {unknown} priceUsd
     * @returns {number | null}
     */
    function fiatPrice(priceUsd) {
        return convertUsd(priceUsd, display.value)
    }

    return { display, locale, money, parts, moneyOrZero, partsOrZero, fiatPrice }
}

// Tutar kutusu girdisini normallestirir (Send.vue).
//
// NEDEN: `type="number"` kutusunda ondalik ayiraci TARAYICI ARAYUZ DILINE baglidir.
// Ingilizce Chrome'da TRY kullanicisi "100,50" yazinca DOM degeri '' olurdu; ham metin
// bos kalir, dugme sessizce kapanir, karsi deger "0" gosterir, hicbir hata cikmazdi.
// Kutu artik duz metin: hangi ayiraci yazdigi onemli degil, ikisi de kabul edilir.
//
// KURAL: yalniz rakam ve TEK ondalik ayiraci (',' ya da '.') gecerlidir. Binlik
// ayiraci, harf, eksi, bosluk ve ikinci ayirac KABUL EDILMEZ; bu durumda `previous`
// (son gecerli deger) aynen doner, yani yazilan karakter dusurulur.
const VALID = /^\d*[.,]?\d*$/

export function normalizeDecimalInput(raw, previous) {
    const prev = previous === null || previous === undefined ? '' : String(previous)
    if (raw === null || raw === undefined) return ''

    const text = String(raw)
    if (!VALID.test(text)) return VALID.test(prev) ? prev.replace(',', '.') : ''

    const dotted = text.replace(',', '.')
    return dotted.startsWith('.') ? `0${dotted}` : dotted
}

// "5." yazim sirasinda gecerli bir ara degerdir ama bir TUTAR degildir; zincire ve
// dogrulamaya giden deger sondaki ayiraci tasimaz.
export function trimDecimalTail(value) {
    return String(value ?? '').replace(/\.$/, '')
}

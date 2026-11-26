// Ilk alim kapisi -- ana islem dugmesinin ETIKETI ve KIPI (sahip karari D3, 2026-10-16; spec 6.3 "kilitliyken ana CTA
// etiketi nedeni soyler"; K32: kapi yalniz IP ulkesine bakar). SAF: vue, depo, ag ve i18n YOK; yalniz i18n
// ANAHTAR ADI doner (bilesen $t / t ile cozer).
// Swap, Kopru ve StockTrade etiketi ve kipi YALNIZ buradan alir: uc yerde ayri yazilan esleme bir gun birini kacirir.
//
//   mode 'open'   kapi acik (idle | ok | warn): dugme kendi normal etiketini ve davranisini korur, labelKey null.
//   mode 'locked' kapi kapali: dugme PASIF, etiket KISA nedeni soyler (uzun aciklama StockGateBand'de kalir); tiklama
//                 hicbir sey yapmaz (kilitli kapida kullaniciyi baska ekrana goturen bir eylem YOKTUR).
// Bilinmeyen durum, kume disi neden ve bozuk girdi FAIL-CLOSED: pasif, "Dogrulanamadi". Kapi kumesinden cikan eski
// nedenler ve kalkan eski durum adlari da bu yola duser.
// Acik durum kumesi C9'daki GATE_ALLOWED_STATES ile AYNI olmak ZORUNDADIR (gateCta.test.js bagi kilitler).
export const GATE_OPEN_STATES = Object.freeze(['idle', 'ok', 'warn'])

// Pasif kipteki nedenler -> stockGate.cta.<NEDEN> (PE12: 5 deger, STOCK_GATE_REASONS ile ayni kume; stockGate.cta.*
// anahtarlari locales.test.js sozlesmesiyle bu listeye bagli).
export const GATE_CTA_LOCK_REASONS = Object.freeze([
    'KILL_SWITCH', 'IP_COUNTRY_ISSUER', 'IP_COUNTRY_PRECAUTION', 'COUNTRY_UNKNOWN', 'CHECK_FAILED',
])

export const GATE_CTA_CHECKING_KEY = 'stockGate.cta.checking'

// gate: { state, reason } (reactive(useStockGate(...)) ya da duz nesne). Asla firlatmaz.
export function gateCtaOf(gate) {
    const state = gate?.state
    const reason = gate?.reason
    if (GATE_OPEN_STATES.includes(state)) return { mode: 'open', labelKey: null }
    if (state === 'checking') return { mode: 'locked', labelKey: GATE_CTA_CHECKING_KEY }
    if (state === 'blocked' && GATE_CTA_LOCK_REASONS.includes(reason)) return { mode: 'locked', labelKey: `stockGate.cta.${reason}` }
    // 'error', bilinmeyen durum, kume disi neden, bozuk girdi: fail-closed
    return { mode: 'locked', labelKey: 'stockGate.cta.CHECK_FAILED' }
}

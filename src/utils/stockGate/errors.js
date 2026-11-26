// Kapi nedenleri icin TEK kaynak (spec 5.11): kullaniciya gosterilen kapali kume, sentinel dizesi
// ve karar fonksiyonunun ic nedenlerini bu kumeye indiren tek eslesme (`toGateReason`).
// Kilit yaniti yardimcilari (gateVerdict, gateLockedReply, gateRefusalReply, denyBuyGate) CoW servis, CoW onay ve
// iki motorun ORTAK ihtiyacidir (PF18, PF19); import almaz, saf kalir.
//
// NEDEN VAR: uc tuketici (arka plan sentinel'i `STOCK_GATE:<NEDEN>`, CoW `gateReason` /
// `lockLine`, `locales.test.js`) ayri birer liste tutarsa biri kapali kumeden sapar ve kullanici
// metinsiz bir kilit gorur. Hepsi bu dosyadan beslenir. Saf: ag, depo, vue, bayrak YOK.

export const STOCK_GATE_PREFIX = 'STOCK_GATE:'

// Kullaniciya GOSTERILEN kilit nedenleri (BES deger; i18n `stockGate.lock.<NEDEN>` ile birebir; K32: kapi yalniz IP ulkesine
// bakar, PE12: kume 14 -> 5). Kume disi her ic neden (karar fonksiyonunun `OK`, `WARN_COUNTRY`, `RULES_INVALID`,
// `ISSUER_UNKNOWN` degerleri ve bozuk girdi) `toGateReason` ile CHECK_FAILED'a duser (kapali yon).
export const STOCK_GATE_REASONS = Object.freeze([
  'KILL_SWITCH',
  'IP_COUNTRY_ISSUER',
  'IP_COUNTRY_PRECAUTION',
  'COUNTRY_UNKNOWN', // IP ulkesi belirlenemedi (K33-2): gecici kilit, yeniden denenir; CHECK_FAILED (ic hata) ayri kalir
  'CHECK_FAILED',
])

// Set.has: '__proto__' / 'constructor' gibi ad-tabanli tuzaklara dusmez.
const REASON_SET = new Set(STOCK_GATE_REASONS)

// Her girdi icin bir kume degeri doner, ASLA firlatmaz.
export function toGateReason(reason) {
  if (typeof reason !== 'string') return 'CHECK_FAILED'
  if (REASON_SET.has(reason)) return reason
  return 'CHECK_FAILED'
}

export const stockGateError = (reason) => STOCK_GATE_PREFIX + toGateReason(reason)

export const isStockGateError = (value) => typeof value === 'string' && value.startsWith(STOCK_GATE_PREFIX)

// Sentinel degilse null (mevcut hata davranisi korunur); sentinel ise kumeden bir neden.
export function parseStockGateError(value) {
  if (!isStockGateError(value)) return null
  return toGateReason(value.slice(STOCK_GATE_PREFIX.length))
}

// ---- Kilit yaniti yardimcilari (PF18, PF19) ----

// Varsayilan kapi: gate verilmezse Al REDDEDILIR (fail-closed). Her cagrida yeni nesne doner.
export const denyBuyGate = async () => ({ ok: false, reason: 'CHECK_FAILED' })

// Kapi sonucunu SIKI okur. Yalniz nesne VE `ok === true` kapiyi acar ({ ok: true }, ek alan sizmaz). Her baska durum
// (bozuk sekil, 'true' / 1 gibi gevsek degerler, ask'in firlatmasi ya da reddedilmesi) kapali karardir. ASLA firlatmaz.
export async function gateVerdict(ask) {
  try {
    const r = await ask()
    if (r !== null && typeof r === 'object' && r.ok === true) return { ok: true }
    return { ok: false, reason: toGateReason(r?.reason) }
  } catch {
    return { ok: false, reason: 'CHECK_FAILED' }
  }
}

// CoW / motor KILIT yaniti (teklif asamasi): cow/config.LOCK_REASON.STOCK_GATE ile ayni deger (testle bagli).
export function gateLockedReply(reason) {
  return {
    success: true,
    locked: true,
    lockReason: 'STOCK_GATE',
    gateReason: toGateReason(reason),
    quoteId: null,
    display: null,
    approval: null,
    reference: null,
    notice: null,
    warnings: [],
  }
}

// Emir / onay reddi: cow/errors.COW_ERROR.STOCK_GATE ile ayni kod (testle bagli).
export function gateRefusalReply(reason) {
  return { success: false, code: 'STOCK_GATE', gateReason: toGateReason(reason) }
}

// Ilk alim kapisi: kural tablosu YARDIMCILARI (SAF: ag, depo, saat, vue, featureFlags YOK).
//
// Tablonun sekli ve anlami: server/data/eligibility.js (tek yetkili kaynak) ve spec 3.1. Bu dosya
// ISTEMCI dogrulayicisidir; sunucudaki server/utils/validateEligibility.js ile AYNI kurallari uygular,
// AYRI kodla (iki paket ayri dagitilir; sunucu istemci dosyasini import etmez). Uyum test zamaninda
// kilitlidir (server/test/eligibilityClientCompat.test.js: ayni tabloya ayni karar). TEK fark: istemci
// ayrica her kodun ISO listesinde (data/countryCodes) olmasini ister.
//
// NEDEN BU KADAR TUTUCU: "en yuksek surum kazanir" kurali, kalici onbellege girmis bozuk ya da gevsek bir
// tablonun gomulu kopyanin daha siki icerigini ezmesine yol acardi. Bu yuzden dogrulamasi gecmeyen
// tablo BUTUNUYLE yok sayilir (yari guven yok); anlamsal taban: cekirdek engel kodlari + makul surum tarihi.
import { COUNTRY_CODE_SET } from '../../data/countryCodes'

export const ISSUERS = Object.freeze(['bstocks', 'xstocks'])
export const CORE_BLOCK = Object.freeze(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'KP', 'IR'])
export const VERSION_RE = /^\d{4}-\d{2}-\d{2}\.\d+$/

const VERSION_PARTS_RE = /^(\d{4})-(\d{2})-(\d{2})\.(\d+)$/
const CODE_RE = /^[A-Z]{2}$/
const DAY_MS = 24 * 60 * 60 * 1000
const VERSION_FUTURE_DAYS = 30
const TOP_KEYS_SORTED = ['common', 'issuers', 'version']
const ISSUER_FIELDS_SORTED = ['blocked', 'buyEnabled', 'warn']

// Yalniz 'bstocks' | 'xstocks'. Object.hasOwn tabanli: '__proto__', 'constructor', 'toString' false.
export function isValidIssuer(x) {
  return typeof x === 'string' && Object.hasOwn({ bstocks: 1, xstocks: 1 }, x)
}

function isPlainObject(x) {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false
  const proto = Object.getPrototypeOf(x)
  return proto === Object.prototype || proto === null
}

// `keysSorted` ARTAN sirada verilir.
function hasExactKeys(obj, keysSorted) {
  const own = Object.keys(obj).sort()
  return own.length === keysSorted.length && own.every((k, i) => k === keysSorted[i])
}

function isIssuerShape(issuer) {
  return isPlainObject(issuer)
    && hasExactKeys(issuer, ISSUER_FIELDS_SORTED)
    && typeof issuer.buyEnabled === 'boolean'
    && Array.isArray(issuer.blocked)
    && Array.isArray(issuer.warn)
}

// 'YYYY-MM-DD.n' -> gun baslangicinin UTC ms'i; bicim ya da takvim gunu gecersizse null.
function versionDayMs(version) {
  if (typeof version !== 'string') return null
  const m = VERSION_PARTS_RE.exec(version)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return t
}

function nowMs(now) {
  const ms = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : NaN)
  return Number.isFinite(ms) ? ms : Date.now()
}

// -> hata kodu ya da null (gecerli). Girdiyi DEGISTIRMEZ. Denetim SIRASI sunucuyla aynidir.
function problemOf(rules, now) {
  if (!isPlainObject(rules) || !hasExactKeys(rules, TOP_KEYS_SORTED)) return 'SHAPE'
  if (!isPlainObject(rules.common) || !isPlainObject(rules.issuers)) return 'SHAPE'

  if (!hasExactKeys(rules.common, ['precaution']) || !Array.isArray(rules.common.precaution)) return 'FIELDS'
  for (const key of Object.keys(rules.issuers)) {
    if (!isIssuerShape(rules.issuers[key])) return 'FIELDS'
  }
  if (!hasExactKeys(rules.issuers, ISSUERS)) return 'ISSUERS'

  const day = versionDayMs(rules.version)
  if (day === null) return 'VERSION'
  if (day > now + VERSION_FUTURE_DAYS * DAY_MS) return 'VERSION_FUTURE'

  const precaution = rules.common.precaution
  const lists = [
    precaution,
    rules.issuers.bstocks.blocked, rules.issuers.bstocks.warn,
    rules.issuers.xstocks.blocked, rules.issuers.xstocks.warn,
  ]
  for (const list of lists) {
    for (const code of list) {
      if (typeof code !== 'string' || !CODE_RE.test(code) || !COUNTRY_CODE_SET.has(code)) return 'CODES'
    }
  }
  for (const list of lists) {
    if (new Set(list).size !== list.length) return 'DUPLICATE'
  }

  const common = new Set(precaution)
  for (const key of ISSUERS) {
    const issuer = rules.issuers[key]
    const effective = new Set([...issuer.blocked, ...common])
    if (issuer.warn.some((code) => effective.has(code))) return 'OVERLAP'
  }
  for (const key of ISSUERS) {
    const issuer = rules.issuers[key]
    const effective = new Set([...issuer.blocked, ...common])
    if (!CORE_BLOCK.every((code) => effective.has(code))) return 'CORE_BASE'
  }
  return null
}

/**
 * Kural tablosunu dogrular. ASLA firlatmaz (getter / Proxy tuzaklari dahil: SHAPE sayilir).
 * @param {unknown} rules
 * @param {{ now?: number | Date }} [opts] `now` enjekte edilir (RF5: istemci saati geri ya da ileri)
 * @returns {{ ok: true } | { ok: false, error: 'SHAPE'|'FIELDS'|'ISSUERS'|'VERSION'|'VERSION_FUTURE'|'CODES'|'DUPLICATE'|'OVERLAP'|'CORE_BASE' }}
 */
export function validateRules(rules, opts) {
  try {
    // `opts` null / dize / sayi olsa da firlatmaz (varsayilan: simdiki zaman)
    const error = problemOf(rules, nowMs(opts !== null && typeof opts === 'object' ? opts.now : undefined))
    return error === null ? { ok: true } : { ok: false, error }
  } catch {
    return { ok: false, error: 'SHAPE' }
  }
}

// 'YYYY-MM-DD.n' -> { day, n } (n basindaki sifirlari atilmis rakam dizesi) ya da null.
function parseVersion(version) {
  if (typeof version !== 'string') return null
  const m = VERSION_PARTS_RE.exec(version)
  if (!m) return null
  return { day: `${m[1]}-${m[2]}-${m[3]}`, n: m[4].replace(/^0+(?=\d)/, '') }
}

// Rakam dizelerini SAYISAL karsilastirir (buyuk sayilarda Number kaybi olmasin diye uzunluk + sozluk sirasi).
function compareDigits(a, b) {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * Surum karsilastirmasi: once tarih, sonra n SAYISAL ('.9' < '.10'). Gecersiz dize en dusuk sayilir,
 * iki gecersiz 0 doner.
 * @returns {-1 | 0 | 1}
 */
export function compareRulesVersion(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  if (pa.day !== pb.day) return pa.day < pb.day ? -1 : 1
  return compareDigits(pa.n, pb.n)
}

/**
 * Adaylar arasindan EN YUKSEK surumlu GECERLI tabloyu secer; gecersiz aday butunuyle yok sayilir; esit
 * surumde ilk aday kazanir (sira: kalici onbellek, sunucu, gomulu). Hic gecerli aday yoksa null.
 * @param {Array<unknown>} candidates
 * @param {{ now?: number | Date }} [opts]
 */
export function pickRules(candidates, opts) {
  if (!Array.isArray(candidates)) return null
  const now = opts !== null && typeof opts === 'object' ? opts.now : undefined
  let best = null
  for (const candidate of candidates) {
    if (!validateRules(candidate, { now }).ok) continue
    if (best === null || compareRulesVersion(candidate.version, best.version) > 0) best = candidate
  }
  return best
}

/**
 * Etkin engel kumesi = issuers.<issuer>.blocked birlesim common.precaution. Her cagri YENI Set doner.
 * Yalniz DOGRULANMIS tabloyla cagrilir; bilinmeyen ihracci / bozuk girdide bos Set (asla firlatmaz).
 */
export function effectiveBlocked(rules, issuer) {
  const out = new Set()
  if (!isValidIssuer(issuer)) return out
  try {
    for (const code of rules.issuers[issuer].blocked) out.add(code)
    for (const code of rules.common.precaution) out.add(code)
  } catch {
    return new Set()
  }
  return out
}

/** `code`, issuers.<issuer>.blocked icinde mi (ihtiyat-yalniz kodlar icin false). Asla firlatmaz. */
export function issuerListed(rules, issuer, code) {
  if (!isValidIssuer(issuer)) return false
  try {
    return rules.issuers[issuer].blocked.includes(code)
  } catch {
    return false
  }
}

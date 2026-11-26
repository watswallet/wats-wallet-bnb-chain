// Ilk alim kapisi: KARAR FONKSIYONU (SAF: ag, depo, saat, vue, featureFlags YOK; ASLA firlatmaz).
// Saat okunmaz (R7): zaman girdideki `now` (ms, sonlu sayi) ile gelir ve kural dogrulamasina aynen gecer.
//
// Girdileri kapi (gate.js) toplar, burasi yalniz karar verir. Sirali kurallar spec 4.2 (K33) ve dogruluk
// tablosu spec 4.5'tir (test: decide.test.js 25 satiri `it.each` ile surer). Karar yalniz ihracci, kural tablosu,
// baglanti (IP) ulkesi ve saatten verilir; baska sinyal yoktur. Kural ONCELIGI guvenlik bakimindan onemlidir;
// siralari degistirmek sessiz bir gevsemedir:
//   0a ihracci bilinmiyor                -> ISSUER_UNKNOWN
//   0b `now` sonlu sayi degil ya da kural tablosu gecersiz -> RULES_INVALID
//   1  buyEnabled === false              -> KILL_SWITCH      (acil durdurma her seyden once)
//   2  IP ulkesi bilinmiyor (null)       -> COUNTRY_UNKNOWN  (baska sinyal kalmadi: iki ihracci da kapali)
//   3  IP ulkesi etkin engelde           -> IP_COUNTRY_ISSUER (ihracci listesinde) ya da IP_COUNTRY_PRECAUTION
//   4  IP ulkesi ihraccinin uyari listesinde -> WARN_COUNTRY
//   5  aksi                              -> OK
// Kural 1, kural 2'den ONCE gelir: kapali ihracci icin neden ulke bilinse de bilinmese de KILL_SWITCH'tir.
//
// Fail-safe: bozuk girdi (null kural, bilinmeyen ihracci, bozuk ulke kodu) firlatmaz; kural / ihracci bozuksa
// BLOCKED, ulke bozuksa bilinmiyor (null) sayilir ve kapi kapali kalir.
import { COUNTRY_CODE_SET } from '../../data/countryCodes'
import { validateRules, effectiveBlocked, issuerListed, isValidIssuer } from './rules'

const COUNTRY_RE = /^[A-Z]{2}$/

/**
 * 'XX' (iki BUYUK harf) VE ISO listesinde (data/countryCodes: ISO + XK) ise kendisi, aksi halde null
 * ('tr', 12, [], null, {} ve iyi bicimli ama bilinmeyen 'EU' / 'AP' / 'ZZ' -> null).
 */
export function normalizeCountry(x) {
  return typeof x === 'string' && COUNTRY_RE.test(x) && COUNTRY_CODE_SET.has(x) ? x : null
}

function decideUnsafe({ issuer, rules, ipCountry, now }) {
  const ip = normalizeCountry(ipCountry)
  // P1: ipCountry (kararda kullanilan, dogrulanmis IP ulkesi ya da null) her sonuca eklenir.
  const out = (decision, reason) => ({ decision, reason, ipCountry: ip })

  if (!isValidIssuer(issuer)) return out('BLOCKED', 'ISSUER_UNKNOWN')
  // `now` eksik ya da sonlu sayi degilse kural dogrulamasi yapilamaz: kapali (RULES_INVALID).
  if (typeof now !== 'number' || !Number.isFinite(now)) return out('BLOCKED', 'RULES_INVALID')
  if (!validateRules(rules, { now }).ok) return out('BLOCKED', 'RULES_INVALID')

  const issuerRules = rules.issuers[issuer]

  // 1 acil durdurma
  if (issuerRules.buyEnabled === false) return out('BLOCKED', 'KILL_SWITCH')

  // 2 ulke bilinmiyor
  if (ip === null) return out('BLOCKED', 'COUNTRY_UNKNOWN')

  // 3 baglanti (IP) ulkesi etkin engelde
  if (effectiveBlocked(rules, issuer).has(ip)) {
    return out('BLOCKED', issuerListed(rules, issuer, ip) ? 'IP_COUNTRY_ISSUER' : 'IP_COUNTRY_PRECAUTION')
  }

  // 4 uyari ulkesi
  if (issuerRules.warn.includes(ip)) return out('WARN', 'WARN_COUNTRY')

  // 5
  return out('OK', 'OK')
}

/**
 * @param {{ issuer: unknown, rules: unknown, ipCountry: unknown, now: number }} input
 * @returns {{ decision: 'OK'|'WARN'|'BLOCKED', reason: string, ipCountry: string|null }}
 */
export function decideStockBuy(input) {
  try {
    return decideUnsafe(input || {})
  } catch {
    // Beklenmeyen her sey (getter / Proxy tuzagi) kural bozuklugu sayilir: kapi kapali.
    return { decision: 'BLOCKED', reason: 'RULES_INVALID', ipCountry: null }
  }
}

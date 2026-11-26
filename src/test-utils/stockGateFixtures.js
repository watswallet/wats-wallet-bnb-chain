// Ilk alim kapisi testlerinin ORTAK fiksturleri (Task 6 yaratir; kapi, bildirim, kural
// istemcisi ve CoW testleri ayni sozlesmeyi kullanir).
//
//   rulesFixture(over?)                              -> gomulu tablonun DERIN, DONUK OLMAYAN kopyasi + ezme
//   memoryArea(initial?, { failGet, failSet })       -> sahte chrome.storage alani (Promise tabanli)
//   allowAllGate / denyAllGate(reason?)              -> CoW servis / onay testleri icin sahte kapi (C10)
//   bumpVersion(version, n)                          -> 'YYYY-MM-DD.N' surumunun N sonekini n artirir (PE17)
//   versionNoonMs(version)                           -> surum gununun 12:00 UTC'si (ms); sabit saat bundan turetilir
//
// Bu dosya TEST yardimcisidir; uretim kodu import ETMEZ.
import { BUNDLED_ELIGIBILITY_RULES } from '../data/eligibilityRules'

/**
 * Gomulu tablonun derin kopyasi (donuk DEGIL: test bozabilir). `over` ile ezme:
 *   - `version`            : dize, tabloya yazilir
 *   - `common`             : { precaution } vb., common uzerine Object.assign (dizi DEGISTIRILIR, birlesmez)
 *   - `issuers.<i>`        : o ihraccinin verilen alanlari ustune yazilir (digerleri korunur); tabloda olmayan bir
 *                            ihracci adi EKLENIR. Iyi bicimli ad (ornegin 'dogecoin': /^[a-z0-9-]{2,32}$/) GECERLI bir ek
 *                            ihracci kurar; gecersiz tablo kurmak icin bicimi bozuk bir ad kullan (ornegin 'Dogecoin')
 * `over` degerleri de kopyalanir; fikstur ile cagiran nesne paylasilmaz.
 */
export const rulesFixture = (over = {}) => {
  const rules = structuredClone(BUNDLED_ELIGIBILITY_RULES)
  if (over.version !== undefined) rules.version = over.version
  if (over.common) Object.assign(rules.common, structuredClone(over.common))
  for (const issuer of Object.keys(over.issuers || {})) {
    rules.issuers[issuer] = { ...(rules.issuers[issuer] || {}), ...structuredClone(over.issuers[issuer]) }
  }
  return rules
}

/**
 * chrome.storage.<alan> sahtesi. `get(keys)` dize / dizi / { anahtar: varsayilan } / null kabul eder,
 * yalniz VAR olan anahtarlari doner; degerler HER ZAMAN kopyalanir (cagiran depoyu yan etkiyle bozamaz).
 * `_store` canli depodur (testler dogrudan okur), `getCalls` / `setCalls` / `removeCalls` cagri kayitlari.
 * `failGet` / `failSet`: ilgili cagri reddedilir (depo okunamiyor / yazilamiyor senaryolari).
 */
export const memoryArea = (initial = {}, { failGet = false, failSet = false } = {}) => {
  const store = structuredClone(initial)
  const getCalls = []
  const setCalls = []
  const removeCalls = []
  return {
    _store: store,
    getCalls,
    setCalls,
    removeCalls,
    async get(keys) {
      getCalls.push(keys)
      if (failGet) throw new Error('storage get failed')
      if (keys === null || keys === undefined) return structuredClone(store)
      const asObject = typeof keys === 'object' && !Array.isArray(keys)
      const list = typeof keys === 'string' ? [keys] : (asObject ? Object.keys(keys) : keys)
      const out = asObject ? structuredClone(keys) : {}
      for (const key of list) {
        if (Object.hasOwn(store, key)) out[key] = structuredClone(store[key])
      }
      return out
    },
    async set(obj) {
      setCalls.push(structuredClone(obj))
      if (failSet) throw new Error('storage set failed')
      for (const [key, value] of Object.entries(obj)) store[key] = structuredClone(value)
    },
    async remove(keys) {
      removeCalls.push(keys)
      if (failSet) throw new Error('storage remove failed')
      for (const key of (typeof keys === 'string' ? [keys] : keys)) delete store[key]
    },
  }
}

// Sunucu fiksturlerini GOMULU surume baglamak icin (PE17): sabit '2026-10-16.N' dizeleri tablo surumu
// yukselince +30 gun sinirini asip butun fiksturleri RULES_INVALID yapardi. Yalniz '.N' sonekini degistirir
// (gun ayni kalir); n = 0 ayni surumu doner. Gecersiz bicimde ya da n tamsayi degilse FIRLATIR (sessiz
// yanlis fikstur olmasin).
export const bumpVersion = (version, n) => {
  const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(version)
  if (!m || !Number.isSafeInteger(n)) throw new Error(`bumpVersion: gecersiz girdi ${String(version)} / ${String(n)}`)
  return `${m[1]}.${Number(m[2]) + n}`
}

// 'YYYY-MM-DD.N' -> o gunun 12:00 UTC'si (ms). Sabit test saati (T0, NOW) gomulu surumun gunune baglanir.
export const versionNoonMs = (version) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})\.\d+$/.exec(version)
  if (!m) throw new Error(`versionNoonMs: gecersiz surum ${String(version)}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
}

export const allowAllGate = async () => ({ ok: true })
export const denyAllGate = (reason = 'IP_COUNTRY_ISSUER') => async () => ({ ok: false, reason })

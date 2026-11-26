// /eligibility istemcisi (spec 2.3, 4.4, 10; K9, K11, K19, K20, K33-2): kural tablosu + IP ulkesi, kalici kural
// onbellegi, oturum IP onbellegi, tek ucus, 4 sn bekleme, hata ya da bos IP sonrasi 60 sn geri cekilme.
//
// NEDEN VAR / KORUDUKLARI:
//  (1) KURALLAR kalici (chrome.storage.local['stock_gate_rules_cache'] = { v: 1, rules }) ve herkes icin
//      aynidir: bir kez alinmis acil durdurma (`buyEnabled:false`) ya da yeni engel, sunucuya sonradan
//      erisilemese ve tarayici yeniden baslasa da surer (K20). Secim kurali: kalici onbellek, sunucu yaniti
//      ve gomulu kopya arasinda EN YUKSEK GECERLI surum (`pickRules`); dogrulamayi gecmeyen kaynak
//      BUTUNUYLE yok sayilir, silinmez.
//  (2) IP ULKESI yalniz sunucu yanitindan ve en cok 10 dk eskiyken kullanilir; chrome.storage.session'da
//      (yoksa bellekte) durur, KALICI depoya ASLA yazilmaz. Kalici kayitta IP, ipCountry, fetchedAt ya da
//      failedAt alani YOKTUR; oturum kaydinda `rules` YOKTUR. Ulke bilinmiyorsa iki ihracci da kapali olur
//      (K33-2): bu yuzden `ipCountry:null` yaniti (DB eksik, ozel IP, kayit yok) ve ISO listesinde olmayan
//      iyi bicimli kod ('EU', 'AP', 'ZZ') IP BASARISI SAYILMAZ; kurallar yine kabul edilir (acil durdurma
//      kaybolmaz) ama oturuma failedAt yazilir ve 60 sn sonra yeniden sorulur (10 dk "taze null" kilidi yok).
//  (3) Okuma yolu (taze onbellek, geri cekilme penceresi) depoya YAZMAZ: yazma -> degisim -> sorgu -> yazma
//      dongusu ve K19'un "dakikada en cok bir istek" varsayiminin bozulmasi onlenir.
//  (4) Hicbir hata disari sizmaz: ensureFresh ASLA firlatmaz. Beklenmeyen bir hata gomulu (acik) kopyaya
//      DUSURMEZ: dis catch o anki EN IYI gecerli tabloyu verir (PF5, K20).
//  (5) Hicbir aday gecmezse (saat gomulu tablonun tarihinden de > 30 gun geride, P27) gomulu kopya oldugu
//      gibi doner; karar katmani RULES_INVALID ile alimi kapatir. null sizmaz.
// Saf katman: vue, bayrak, console YOK. Saat, depo, fetch ve zamanlayici ENJEKTE edilir (`AbortSignal.timeout`
// kullanilmaz: vitest sahte zamanlayicilari onu ilerletmez).
import { validateRules, pickRules, compareRulesVersion } from './rules'
import { COUNTRY_CODE_SET } from '../../data/countryCodes'

export const RULES_CACHE_KEY = 'stock_gate_rules_cache'
export const SESSION_CACHE_KEY = 'stock_gate_cache'
export const FETCH_TIMEOUT_MS = 4000
export const IP_FRESH_MS = 600000
export const BACKOFF_MS = 60000

const COUNTRY_RE = /^[A-Z]{2}$/

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// Iyi bicimli VE ISO listesinde (data/countryCodes: ISO + XK) olan kod ulkedir; baskasi null (PE23).
const knownCountry = (v) => (typeof v === 'string' && COUNTRY_RE.test(v) && COUNTRY_CODE_SET.has(v) ? v : null)

// Oturum kaydini temiz bicime indirir; bozuk alan null olur (negatif/gelecek yas denetimi kullanimda).
function normalizeSession(raw) {
  const r = isPlainObject(raw) ? raw : {}
  return {
    ipCountry: knownCountry(r.ipCountry),
    fetchedAt: Number.isFinite(r.fetchedAt) ? r.fetchedAt : null,
    failedAt: Number.isFinite(r.failedAt) ? r.failedAt : null,
  }
}

// Yanit govdesi: metin -> korumali JSON.parse -> sema. Gecmeyen yanit BUTUNUYLE yok sayilir (null).
function parseBody(raw, nowMs) {
  let body
  try { body = JSON.parse(raw) } catch { return null }
  if (!isPlainObject(body) || body.success !== true || typeof body.version !== 'string') return null
  if (!validateRules(body.rules, { now: nowMs }).ok) return null
  const ip = body.ipCountry
  if (!(ip === null || (typeof ip === 'string' && COUNTRY_RE.test(ip)))) return null
  return { rules: body.rules, ipCountry: knownCountry(ip) }
}

export function createRulesClient({
  base,
  bundled,
  fetchFn = (...a) => fetch(...a),
  local = () => globalThis.chrome?.storage?.local,
  session = () => globalThis.chrome?.storage?.session,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let memRules = null // bu SW omru boyunca kabul edilen en yuksek sunucu tablosu (kalici yazim basarisizsa da kalir)
  let memSession = null // oturum alani yoksa ya da firlatirsa yedek
  let pending = null // tek ucus

  async function readPersisted() {
    try {
      const out = await local().get(RULES_CACHE_KEY)
      const rec = out ? out[RULES_CACHE_KEY] : undefined
      if (isPlainObject(rec) && rec.v === 1 && validateRules(rec.rules, { now: now() }).ok) return rec.rules
    } catch { /* okunamayan / bozuk kayit yok sayilir (silinmez) */ }
    return null
  }

  async function currentRules() {
    const persisted = await readPersisted()
    return pickRules([persisted, memRules, bundled], { now: now() }) ?? bundled
  }

  // Dis catch'lerin tek cikisi (PF5): ASLA firlatmaz, gomuluye KOR dusmez. Normal secim (kalici / bellek ici /
  // gomulu arasinda en yuksek gecerli surum) iki kez denenir (tek seferlik bir hata kalici acil durdurmayi
  // dusurmesin); ikisi de firlatirsa (ornegin saat okunamiyor) bu SW'de zaten dogrulanip kabul edilmis sunucu
  // kopyasi, gomuluden yuksek surumluyse, gomuluye tercih edilir.
  async function bestEffortRules() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await currentRules() } catch { /* yeniden dene, sonra yedek */ }
    }
    return memRules !== null && compareRulesVersion(memRules.version, bundled.version) > 0 ? memRules : bundled
  }

  async function readSession() {
    let raw
    try {
      const s = session()
      if (s) {
        const out = await s.get(SESSION_CACHE_KEY)
        raw = out ? out[SESSION_CACHE_KEY] : undefined
      }
    } catch { raw = undefined }
    return normalizeSession(raw === undefined ? memSession : raw)
  }

  async function writeSession(entry) {
    memSession = entry
    try { await session().set({ [SESSION_CACHE_KEY]: entry }) } catch { /* bellek yedegi yeter */ }
  }

  async function persistRules(rules) {
    try { await local().set({ [RULES_CACHE_KEY]: { v: 1, rules } }) } catch { /* kota vb: kapi etkilenmez */ }
  }

  const ipFresh = (s, t) => s.ipCountry !== null && s.fetchedAt !== null && t - s.fetchedAt >= 0 && t - s.fetchedAt <= IP_FRESH_MS
  const inBackoff = (s, t) => s.failedAt !== null && t - s.failedAt >= 0 && t - s.failedAt < BACKOFF_MS

  async function doFetch() {
    const controller = new AbortController()
    let timer = null
    let parsed = null
    try {
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimer(() => {
          controller.abort()
          reject(new Error('timeout'))
        }, FETCH_TIMEOUT_MS)
      })
      const request = (async () => {
        const res = await fetchFn(`${base}/eligibility`, {
          method: 'GET', cache: 'no-store', credentials: 'omit', signal: controller.signal,
        })
        if (!res || res.ok !== true) throw new Error('http')
        return res.text()
      })()
      request.catch(() => {}) // yarisi kaybederse yakalanmamis red olmasin
      const raw = await Promise.race([request, timeout])
      parsed = parseBody(raw, now())
    } catch {
      parsed = null
    } finally {
      if (timer !== null) clearTimer(timer)
    }

    if (!parsed) {
      await writeSession({ ipCountry: null, fetchedAt: null, failedAt: now() })
      return { rules: await currentRules(), ipCountry: null }
    }

    // Ulke yoksa (null yanit ya da ISO disi kod) IP basari sayilmaz: 60 sn geri cekilme (K33-2); kurallar asagida yine alinir.
    await writeSession(parsed.ipCountry === null
      ? { ipCountry: null, fetchedAt: null, failedAt: now() }
      : { ipCountry: parsed.ipCountry, fetchedAt: now(), failedAt: null })
    if (!memRules || compareRulesVersion(parsed.rules.version, memRules.version) > 0) memRules = parsed.rules
    const persisted = await readPersisted()
    if (!persisted || compareRulesVersion(parsed.rules.version, persisted.version) > 0) await persistRules(parsed.rules)
    return { rules: await currentRules(), ipCountry: parsed.ipCountry }
  }

  async function run() {
    try {
      const t = now()
      const s = await readSession()
      if (ipFresh(s, t)) return { rules: await currentRules(), ipCountry: s.ipCountry }
      if (inBackoff(s, t)) return { rules: await currentRules(), ipCountry: null }
      return await doFetch()
    } catch {
      return { rules: await bestEffortRules(), ipCountry: null }
    }
  }

  return {
    // Tek ucus: eszamanli cagrilar ayni sozu bekler.
    ensureFresh() {
      if (!pending) pending = run().finally(() => { pending = null })
      return pending
    },
  }
}

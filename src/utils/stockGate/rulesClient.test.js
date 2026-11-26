// rulesClient.js -- /eligibility istemcisi: kalici kural onbellegi (K20), oturum IP onbellegi, tek ucus,
// 4 sn bekleme, 60 sn geri cekilme.
//
// KOK NEDEN / KAPATILAN HATA
//  (1) Acil durdurma (`buyEnabled:false`) oturum onbellegindeydi: tarayici yeniden baslayinca ya da sunucuya
//      erisilemeyince kayboluyor, kapi gomulu (acik) kopyaya dusuyordu (R3). Kalici onbellek bunu kapatir.
//  (2) Kalici kayda IP / ipCountry / fetchedAt sizmasi: herkes icin ayni, herkese acik tablo kullaniciya
//      ozgu veri tasirsa gizlilik ihlalidir (R1, spec 9). Oturum kaydinda da `rules` olmaz.
//  (3) `ipCountry:null` yaniti (DB eksik, ozel IP, kayit yok) IP basarisi SAYILMAZ: oturuma failedAt yazilir,
//      60 sn geri cekilme baslar. Aksi halde ulkesi cozulemeyen kullanici 10 dk "taze" null ile tum hisselerden
//      kilitli kalir; her cagrida yeniden sormak ise K19'un "dakikada en cok bir istek" varsayimini bozar (R9).
//      ISO listesinde olmayan iyi bicimli kod ('EU', 'AP', 'ZZ') de null sayilir (R12, PE23).
//  (4) Okuma yolunun depoya yazmasi: yazma -> onChanged -> sorgu -> yazma dongusu (RF2).
//  (5) Saati > 30 gun geri bir istemcinin gecerli sunucu tablosunu reddetmesi: cokme/kilit olmamali, gomulu
//      ya da kalici kopyayla surmeli, saat duzelince tablo kabul edilmeli (RF5, kabul edilen bedel).
//  (6) Saat gomulu tablonun tarihinden de > 30 gun geriyse hicbir tablo gecmez: istemci bunu gizlemez, gomulu
//      kopyayi oldugu gibi verir ve karar katmani RULES_INVALID ile alimi kapatir (P27, fail-closed).
//  (7) Dis `catch` kalici acil durdurmayi dusuruyordu: beklenmeyen bir hata gomulu (acik) kopyaya dusurmemeli,
//      o anki EN IYI gecerli tabloyu (kalici / bellek ici / gomulu) vermeli (PF5, K20).
// Gercek ag/saat/depo YOK: hepsi enjekte. Pozitif bekciler: "yazmadi" iddialarinin yaninda ayni casuslarin
// yazimda GERCEKTEN calistigi gosterilir.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createRulesClient, RULES_CACHE_KEY, SESSION_CACHE_KEY, FETCH_TIMEOUT_MS, IP_FRESH_MS, BACKOFF_MS,
} from './rulesClient'
import { validateRules } from './rules'
import { decideStockBuy } from './decide'
import { BUNDLED_ELIGIBILITY_RULES } from '../../data/eligibilityRules'
import { memoryArea, bumpVersion, versionNoonMs } from '../../test-utils/stockGateFixtures'
import { yorumsuz, blokGovdesi } from '../../test-utils/kaynakTarama'

const KAYNAK = readFileSync(fileURLToPath(new URL('./rulesClient.js', import.meta.url)), 'utf8')
const BUNDLED = BUNDLED_ELIGIBILITY_RULES
// Sabit saat ve sunucu surumleri GOMULU surumden turetilir (PE17): gomulu surum yukselince sabit bir
// tablo surumu dizesi ya da sabit saat, +30 gun sinirini asip butun fiksturleri RULES_INVALID yapardi.
const T0 = versionNoonMs(BUNDLED.version)
const V = (n) => bumpVersion(BUNDLED.version, n) // V(0) = gomulu surum, V(1) = bir ust ...
const DAY = 86_400_000
const BASE = 'https://api.example.test'

// Sunucu tablosu fiksturu: gomulu kopyanin DONUK OLMAYAN kopyasi + surum + istege bagli degisiklik.
const mk = (version, patch) => {
  const r = structuredClone(BUNDLED)
  r.version = version
  if (patch) patch(r)
  return r
}
const killed = (version = V(1)) => mk(version, (r) => { r.issuers.bstocks.buyEnabled = false })
const withoutUs = (version = V(1)) => mk(version, (r) => {
  r.common.precaution = r.common.precaution.filter((c) => c !== 'US')
  for (const i of ['bstocks', 'xstocks']) r.issuers[i].blocked = r.issuers[i].blocked.filter((c) => c !== 'US')
})
const okBody = (rules, ipCountry = null) => ({ success: true, version: rules.version, ipCountry, rules })
const reply = (body, { ok = true, status = 200, raw } = {}) => ({
  ok, status, text: async () => (raw !== undefined ? raw : JSON.stringify(body)),
})
const serve = (body, init) => async () => reply(body, init)

function harness({ local = {}, session = {}, localOpts, sessionOpts, fetchImpl, bundled = BUNDLED, t = T0 } = {}) {
  const clock = { t }
  const timers = []
  const localArea = memoryArea(local, localOpts)
  const sessionArea = memoryArea(session, sessionOpts)
  const localSet = vi.spyOn(localArea, 'set')
  const sessionSet = vi.spyOn(sessionArea, 'set')
  const fetchFn = vi.fn(fetchImpl ?? (async () => { throw new Error('ag yok') }))
  const setTimer = vi.fn((fn, ms) => {
    const entry = { id: timers.length + 1, fn, ms, cleared: false }
    timers.push(entry)
    return entry.id
  })
  const clearTimer = vi.fn((id) => { timers.find((x) => x.id === id).cleared = true })
  const make = () => createRulesClient({
    base: BASE, bundled, fetchFn, local: () => localArea, session: () => sessionArea,
    now: () => clock.t, setTimer, clearTimer,
  })
  return { client: make(), make, clock, timers, fetchFn, localArea, sessionArea, localSet, sessionSet, setTimer, clearTimer }
}
const persistedOf = (h) => h.localArea._store[RULES_CACHE_KEY]
const sessionOf = (h) => h.sessionArea._store[SESSION_CACHE_KEY]
const seedLocal = (rec) => ({ [RULES_CACHE_KEY]: rec })
const seedSession = (rec) => ({ [SESSION_CACHE_KEY]: rec })

describe('sabitler', () => {
  it('spec degerleri: 4 sn, 10 dk, 60 sn ve depo anahtarlari', () => {
    expect(FETCH_TIMEOUT_MS).toBe(4000)
    expect(IP_FRESH_MS).toBe(600000)
    expect(BACKOFF_MS).toBe(60000)
    expect(RULES_CACHE_KEY).toBe('stock_gate_rules_cache')
    expect(SESSION_CACHE_KEY).toBe('stock_gate_cache')
  })
})

describe('istek sekli', () => {
  it('yalniz ${base}/eligibility; sorgu yok, headers yok, cache no-store, credentials omit, AbortSignal', async () => {
    const h = harness({ fetchImpl: serve(okBody(BUNDLED, null)) })
    await h.client.ensureFresh()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    const [url, opts] = h.fetchFn.mock.calls[0]
    expect(url).toBe(`${BASE}/eligibility`)
    expect(url).not.toContain('?')
    expect(Object.keys(opts).sort()).toEqual(['cache', 'credentials', 'method', 'signal'])
    expect(opts).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'omit' })
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(opts).not.toHaveProperty('headers')
    expect(opts).not.toHaveProperty('body')
  })

  it('zaman asimi zamanlayicisi 4000 ms ile kurulur ve basarida temizlenir', async () => {
    const h = harness({ fetchImpl: serve(okBody(BUNDLED, null)) })
    await h.client.ensureFresh()
    expect(h.setTimer).toHaveBeenCalledTimes(1)
    expect(h.timers[0].ms).toBe(4000)
    expect(h.timers[0].cleared).toBe(true)
    expect(h.clearTimer).toHaveBeenCalledWith(h.timers[0].id)
  })
})

describe('IP ulkesi: 10 dk tazelik, R9 (bos yanit basari sayilmaz), negatif yas', () => {
  it('basarili yanit: ulke doner; 10 dk icinde ikinci cagri fetch ATMAZ; 10 dk + 1 ms sonra atar', async () => {
    const h = harness({ fetchImpl: serve(okBody(BUNDLED, 'DE')) })
    expect((await h.client.ensureFresh()).ipCountry).toBe('DE')
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    h.clock.t = T0 + IP_FRESH_MS
    expect((await h.client.ensureFresh()).ipCountry).toBe('DE')
    expect(sessionOf(h)).toEqual({ ipCountry: 'DE', fetchedAt: T0, failedAt: null })
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    h.clock.t = T0 + IP_FRESH_MS + 1
    await h.client.ensureFresh()
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
    expect(sessionOf(h)).toEqual({ ipCountry: 'DE', fetchedAt: T0 + IP_FRESH_MS + 1, failedAt: null })
  })

  it('R9 (tersine): gecerli yanit ipCountry null ise kurallar yazilir ve oturuma { ipCountry:null, fetchedAt:null, failedAt:t0 } yazilir', async () => {
    const rules = killed(V(1))
    const h = harness({ fetchImpl: serve(okBody(rules, null)) })
    const res = await h.client.ensureFresh()
    expect(res.ipCountry).toBeNull()
    expect(res.rules.version).toBe(V(1))
    expect(res.rules.issuers.bstocks.buyEnabled).toBe(false)
    expect(await h.sessionArea.get(SESSION_CACHE_KEY)).toEqual({ [SESSION_CACHE_KEY]: { ipCountry: null, fetchedAt: null, failedAt: T0 } })
    expect(persistedOf(h)).toEqual({ v: 1, rules })
    const dump = JSON.stringify(h.localArea._store)
    for (const yasak of ['ipCountry', 'failedAt', 'fetchedAt']) expect(dump, yasak).not.toContain(yasak)
  })

  it('R9: 60 sn icinde ikinci ve ucuncu ensureFresh fetch ATMAZ ve ipCountry null doner; 60 sn + 1 ms sonra yeniden fetch atar', async () => {
    const h = harness({ fetchImpl: serve(okBody(BUNDLED, null)) })
    const sayilar = []
    expect((await h.client.ensureFresh()).ipCountry).toBeNull()
    sayilar.push(h.fetchFn.mock.calls.length)
    h.clock.t = T0 + 30_000
    expect((await h.client.ensureFresh()).ipCountry).toBeNull()
    sayilar.push(h.fetchFn.mock.calls.length)
    h.clock.t = T0 + BACKOFF_MS - 1
    expect((await h.client.ensureFresh()).ipCountry).toBeNull()
    sayilar.push(h.fetchFn.mock.calls.length)
    h.clock.t = T0 + BACKOFF_MS + 1
    expect((await h.client.ensureFresh()).ipCountry).toBeNull()
    sayilar.push(h.fetchFn.mock.calls.length)
    expect(sayilar).toEqual([1, 1, 1, 2])
  })

  it('R9: yeniden denemede gecerli ulke gelirse IP taze sayilir ve 10 dk ag yok', async () => {
    let ulke = null
    const h = harness({ fetchImpl: async () => reply(okBody(BUNDLED, ulke)) })
    expect((await h.client.ensureFresh()).ipCountry).toBeNull()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    ulke = 'DE'
    h.clock.t = T0 + BACKOFF_MS + 1
    expect((await h.client.ensureFresh()).ipCountry).toBe('DE')
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
    expect(sessionOf(h)).toEqual({ ipCountry: 'DE', fetchedAt: T0 + BACKOFF_MS + 1, failedAt: null })
    h.clock.t = T0 + BACKOFF_MS + 1 + IP_FRESH_MS
    expect((await h.client.ensureFresh()).ipCountry).toBe('DE')
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['404', { ok: false, status: 404, raw: JSON.stringify({ success: false, message: 'not found' }) }],
    ['429', { ok: false, status: 429, raw: JSON.stringify({ success: false, message: 'rate limited' }) }],
    ['503', { ok: false, status: 503, raw: JSON.stringify({ success: false, message: 'unavailable' }) }],
  ])('R10: %s -> ipCountry null, failedAt yazilir, kalici kural onbellegi korunur', async (_ad, init) => {
    const stored = { v: 1, rules: killed(V(1)) }
    const h = harness({ local: seedLocal(stored), fetchImpl: serve(null, init) })
    const res = await h.client.ensureFresh()
    expect(res.ipCountry).toBeNull()
    expect(res.rules.version).toBe(stored.rules.version)
    expect(res.rules.issuers.bstocks.buyEnabled).toBe(false)
    expect(sessionOf(h)).toEqual({ ipCountry: null, fetchedAt: null, failedAt: T0 })
    expect(persistedOf(h)).toEqual(stored)
    expect(h.localSet).not.toHaveBeenCalled()
  })

  it.each(['EU', 'AP', 'ZZ'])('R12 (PE23): gecerli yanit + ipCountry \'%s\' (iyi bicimli, ISO listesinde yok) -> kurallar yazilir, ipCountry null, failedAt ile 60 sn ag yok', async (kod) => {
    const rules = killed(V(1))
    const h = harness({ fetchImpl: serve(okBody(rules, kod)) })
    const res = await h.client.ensureFresh()
    expect(res.ipCountry).toBeNull()
    expect(res.rules.issuers.bstocks.buyEnabled).toBe(false) // kill-switch guncellemesi kaybolmaz
    expect(persistedOf(h)).toEqual({ v: 1, rules })
    expect(sessionOf(h)).toEqual({ ipCountry: null, fetchedAt: null, failedAt: T0 })
    h.clock.t = T0 + BACKOFF_MS - 1
    expect((await h.client.ensureFresh()).ipCountry).toBeNull()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    h.clock.t = T0 + BACKOFF_MS + 1
    await h.client.ensureFresh()
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
  })

  it.each([['kucuk harf', 'tr'], ['sayi', 12]])('R12: bicim bozuk ipCountry (%s) -> BUTUN yanit yok sayilir (mevcut davranis), kurallar da benimsenmez', async (_ad, ip) => {
    const h = harness({ fetchImpl: serve(okBody(killed(V(1)), ip)) })
    const res = await h.client.ensureFresh()
    expect(res.ipCountry).toBeNull()
    expect(res.rules.issuers.bstocks.buyEnabled).toBe(true)
    expect(res.rules.version).toBe(BUNDLED.version)
    expect(persistedOf(h)).toBeUndefined()
    expect(sessionOf(h)).toEqual({ ipCountry: null, fetchedAt: null, failedAt: T0 })
  })

  it('R12b (PE23): oturum kaydinda ipCountry EU (ISO listesinde yok) ise normalizeSession null okur; kayit ulke olarak KULLANILMAZ ve taze sayilmaz', async () => {
    const kayit = { ipCountry: 'EU', fetchedAt: T0, failedAt: null }
    const sunucusuz = harness({ session: seedSession(kayit) })
    expect((await sunucusuz.client.ensureFresh()).ipCountry).toBeNull()
    const h = harness({ session: seedSession(kayit), fetchImpl: serve(okBody(BUNDLED, 'DE')) })
    const res = await h.client.ensureFresh()
    expect(res.ipCountry).not.toBe('EU')
    expect(h.fetchFn).toHaveBeenCalledTimes(1) // ulkesiz kayit 10 dk "taze null" kilidi kurmaz
    expect(res.ipCountry).toBe('DE')
    // pozitif bekci: ayni biciminde ISO listesindeki bir kod taze sayilir ve kullanilir
    const gecerli = harness({ session: seedSession({ ipCountry: 'DE', fetchedAt: T0, failedAt: null }), fetchImpl: serve(okBody(BUNDLED, 'FR')) })
    expect((await gecerli.client.ensureFresh()).ipCountry).toBe('DE')
    expect(gecerli.fetchFn).not.toHaveBeenCalled()
  })

  it.each([
    ['fetchedAt gelecekte (saat geri alindi)', { ipCountry: 'DE', fetchedAt: T0 + 5000, failedAt: null }],
    ['fetchedAt dize', { ipCountry: 'DE', fetchedAt: 'x', failedAt: null }],
    ['fetchedAt yok', { ipCountry: 'DE', failedAt: null }],
    ['fetchedAt null', { ipCountry: 'DE', fetchedAt: null, failedAt: null }],
    ['oturum kaydi bozuk (dize)', 'bozuk'],
  ])('negatif/bozuk yas: %s -> IP null ve yeniden istek', async (_ad, rec) => {
    const h = harness({ session: seedSession(rec), fetchImpl: serve(okBody(BUNDLED, 'FR')) })
    const res = await h.client.ensureFresh()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    expect(res.ipCountry).toBe('FR')
  })

  it('bos fetchedAt\'li ama gecerli ulkeli eski kayit IP olarak KULLANILMAZ', async () => {
    const h = harness({
      session: seedSession({ ipCountry: 'TR', fetchedAt: T0 - IP_FRESH_MS - 1, failedAt: null }),
      fetchImpl: serve(okBody(BUNDLED, 'FR')),
    })
    const res = await h.client.ensureFresh()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    expect(res.ipCountry).toBe('FR')
  })
})

describe('hata, geri cekilme, zaman asimi, tek ucus', () => {
  it('ag hatasi: gomulu kurallar + IP null; oturuma failedAt yazilir', async () => {
    const h = harness()
    const res = await h.client.ensureFresh()
    expect(res).toEqual({ rules: BUNDLED, ipCountry: null })
    expect(sessionOf(h)).toEqual({ ipCountry: null, fetchedAt: null, failedAt: T0 })
  })

  it('60 sn geri cekilme: 59_999 ms sonra fetch YOK, 60_000 ms sonra VAR', async () => {
    const h = harness()
    await h.client.ensureFresh()
    h.clock.t = T0 + BACKOFF_MS - 1
    expect((await h.client.ensureFresh()).ipCountry).toBeNull()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    h.clock.t = T0 + BACKOFF_MS
    await h.client.ensureFresh()
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['failedAt gelecekte', { ipCountry: null, fetchedAt: null, failedAt: T0 + 1000 }],
    ['failedAt dize', { ipCountry: null, fetchedAt: null, failedAt: 'x' }],
    ['failedAt NaN', { ipCountry: null, fetchedAt: null, failedAt: NaN }],
  ])('%s -> yok sayilir, istek atilir', async (_ad, rec) => {
    const h = harness({ session: seedSession(rec), fetchImpl: serve(okBody(BUNDLED, 'FR')) })
    expect((await h.client.ensureFresh()).ipCountry).toBe('FR')
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
  })

  const BASARISIZ_YANITLAR = [
    ['429', serve(null, { ok: false, status: 429, raw: JSON.stringify({ success: false, message: 'rate limited' }) })],
    ['503 unavailable', serve(null, { ok: false, status: 503, raw: JSON.stringify({ success: false, message: 'unavailable' }) })],
    ['500', serve(null, { ok: false, status: 500, raw: '' })],
    ['HTML govde (CDN 502)', serve(null, { ok: false, status: 502, raw: '<html>Bad gateway</html>' })],
    ['200 ama HTML govde', serve(null, { raw: '<html>captive portal</html>' })],
    ['200 ama bos govde', serve(null, { raw: '' })],
    ['200 ama null govde', serve(null, { raw: 'null' })],
    ['200 ama dizi govde', serve(null, { raw: '[]' })],
    ['success:false', serve({ success: false, message: 'x' })],
    ['success dize', serve({ ...okBody(killed(), 'DE'), success: 'true' })],
    ['version dize degil', serve({ ...okBody(killed(), 'DE'), version: 5 })],
    ['text() firlatir', async () => ({ ok: true, status: 200, text: async () => { throw new Error('govde') } })],
    ['fetch senkron firlatir', () => { throw new Error('sync') }],
    ['fetch undefined doner', async () => undefined],
  ]
  it.each(BASARISIZ_YANITLAR)('%s -> sunucu yok: gomulu kurallar, IP null, FIRLATMAZ, kalici yazim YOK', async (_ad, fetchImpl) => {
    const h = harness({ fetchImpl })
    const res = await h.client.ensureFresh()
    expect(res).toEqual({ rules: BUNDLED, ipCountry: null })
    expect(h.localSet).not.toHaveBeenCalled()
    expect(sessionOf(h).failedAt).toBe(T0)
  })

  it.each([
    ['kucuk harf', 'tr'], ['uc harf', 'TUR'], ['sayi', 5], ['bos dize', ''], ['alan hic yok', undefined],
  ])('bozuk ipCountry (%s) -> BUTUN yanit yok sayilir: yuksek surumlu kurallar da benimsenmez', async (_ad, ip) => {
    const body = okBody(killed(), ip)
    if (ip === undefined) delete body.ipCountry
    const h = harness({ fetchImpl: serve(body) })
    const res = await h.client.ensureFresh()
    expect(res.rules.issuers.bstocks.buyEnabled).toBe(true)
    expect(res.rules.version).toBe(BUNDLED.version)
    expect(res.ipCountry).toBeNull()
    expect(h.localSet).not.toHaveBeenCalled()
  })

  it('gecersiz kural tablosu (US yok, CORE_BASE) -> yanit butunuyle yok sayilir; IP de kullanilmaz', async () => {
    const h = harness({ fetchImpl: serve(okBody(withoutUs(), 'FR')) })
    const res = await h.client.ensureFresh()
    expect(res).toEqual({ rules: BUNDLED, ipCountry: null })
    expect(h.localSet).not.toHaveBeenCalled()
  })

  it('4 sn zaman asimi (fetch sinyali DINLEMEZ ve hic donmez): zamanlayici atesleninca sunucu yok sayilir', async () => {
    let seenSignal = null
    const h = harness({ fetchImpl: (url, opts) => { seenSignal = opts.signal; return new Promise(() => {}) } })
    const p = h.client.ensureFresh()
    await vi.waitFor(() => expect(h.timers).toHaveLength(1))
    expect(h.timers[0].ms).toBe(4000)
    expect(seenSignal.aborted).toBe(false)
    h.timers[0].fn()
    const res = await p
    expect(res).toEqual({ rules: BUNDLED, ipCountry: null })
    expect(seenSignal.aborted).toBe(true)
    expect(sessionOf(h).failedAt).toBe(T0)
  })

  it('4 sn zaman asimi (fetch sinyale uyup reddeder) ayni sonucu verir ve yakalanmamis red olusmaz', async () => {
    const h = harness({
      fetchImpl: (url, opts) => new Promise((_res, rej) => {
        opts.signal.addEventListener('abort', () => rej(new Error('aborted')))
      }),
    })
    const p = h.client.ensureFresh()
    await vi.waitFor(() => expect(h.timers).toHaveLength(1))
    h.timers[0].fn()
    expect(await p).toEqual({ rules: BUNDLED, ipCountry: null })
  })

  it('tek ucus: eszamanli uc ensureFresh TEK fetch atar ve ayni sonucu alir', async () => {
    const h = harness({ fetchImpl: serve(okBody(BUNDLED, 'DE')) })
    const [a, b, c] = await Promise.all([h.client.ensureFresh(), h.client.ensureFresh(), h.client.ensureFresh()])
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    expect(a.ipCountry).toBe('DE')
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })
})

describe('kalici kural onbellegi R1-R8 (K20)', () => {
  it('R1: gecerli sunucu yaniti (.2) yazilir; kayit TAM { v:1, rules }; kalici depoda ipCountry/fetchedAt/failedAt/IP YOK; oturumda rules YOK', async () => {
    const rules = killed(V(1))
    const h = harness({ fetchImpl: serve(okBody(rules, 'CL')) })
    await h.client.ensureFresh()
    expect(h.localSet).toHaveBeenCalledTimes(1)
    expect(persistedOf(h)).toEqual({ v: 1, rules })
    expect(Object.keys(persistedOf(h)).sort()).toEqual(['rules', 'v'])
    const dump = JSON.stringify(h.localArea._store)
    for (const yasak of ['ipCountry', 'fetchedAt', 'failedAt', '"CL"']) expect(dump, yasak).not.toContain(yasak)
    expect(Object.keys(sessionOf(h)).sort()).toEqual(['failedAt', 'fetchedAt', 'ipCountry'])
    expect(sessionOf(h)).toEqual({ ipCountry: 'CL', fetchedAt: T0, failedAt: null })
    expect(JSON.stringify(h.sessionArea._store)).not.toContain('"rules"')
  })

  it('R1 korunur: ipCountry null yanitinda da kalici kayit { v:1, rules }\'tur; IP, fetchedAt, failedAt kalici depoya girmez', async () => {
    const rules = killed(V(1))
    const h = harness({ fetchImpl: serve(okBody(rules, null)) })
    await h.client.ensureFresh()
    expect(h.localSet).toHaveBeenCalledTimes(1)
    expect(persistedOf(h)).toEqual({ v: 1, rules })
    expect(Object.keys(persistedOf(h)).sort()).toEqual(['rules', 'v'])
    const dump = JSON.stringify(h.localArea._store)
    for (const yasak of ['ipCountry', 'fetchedAt', 'failedAt']) expect(dump, yasak).not.toContain(yasak)
    expect(JSON.stringify(h.sessionArea._store)).not.toContain('"rules"')
  })

  it('R2: sunucu surumu depodakiyle AYNI ya da DUSUK ise yazim YOK', async () => {
    const same = harness({ local: seedLocal({ v: 1, rules: killed(V(1)) }), fetchImpl: serve(okBody(killed(V(1)), 'FR')) })
    await same.client.ensureFresh()
    expect(same.fetchFn).toHaveBeenCalledTimes(1)
    expect(same.localSet).not.toHaveBeenCalled()
    const lower = harness({ local: seedLocal({ v: 1, rules: killed(V(1)) }), fetchImpl: serve(okBody(mk(V(0)), 'FR')) })
    await lower.client.ensureFresh()
    expect(lower.localSet).not.toHaveBeenCalled()
    expect(persistedOf(lower).rules.version).toBe(V(1))
  })

  it('depoda GECERLI kayit yoksa sunucu tablosu (gomuluyle ayni surum olsa da) yazilir', async () => {
    const h = harness({ fetchImpl: serve(okBody(mk(V(0)), null)) })
    await h.client.ensureFresh()
    expect(h.localSet).toHaveBeenCalledTimes(1)
    expect(persistedOf(h)).toEqual({ v: 1, rules: mk(V(0)) })
  })

  it('R3: depoda buyEnabled:false (.2); fetch reddedilir -> KILL_SWITCH kurali; YENI ornek (SW yeniden basladi, bos oturum) de ayni', async () => {
    const stored = seedLocal({ v: 1, rules: killed(V(1)) })
    const h1 = harness({ local: stored })
    expect((await h1.client.ensureFresh()).rules.issuers.bstocks.buyEnabled).toBe(false)
    expect(h1.fetchFn).toHaveBeenCalledTimes(1)
    const h2 = harness({ local: h1.localArea._store }) // ayni kalici depo, bos oturum, yeni bellek
    expect((await h2.client.ensureFresh()).rules.issuers.bstocks.buyEnabled).toBe(false)
    expect(h2.fetchFn).toHaveBeenCalledTimes(1)
  })

  const BOZUK_KAYITLAR = [
    ['rules yok', { v: 1 }],
    ['v:2', { v: 2, rules: killed(V(1)) }],
    ['v dize', { v: '1', rules: killed(V(1)) }],
    ['cekirdek taban eksik (US yok)', { v: 1, rules: withoutUs(V(1)) }],
    ['surum tarihi bugun + 30 gunden ileri', { v: 1, rules: killed('2027-12-31.1') }],
    ['rules dize', { v: 1, rules: 'bozuk' }],
    ['kayit dize', 'bozuk'],
    ['kayit sayi', 5],
    ['kayit dizi', [killed(V(1))]],
  ]
  it.each(BOZUK_KAYITLAR)('R4: bozuk kalici kayit (%s) YOK sayilir: gomulu kullanilir, firlatma yok, kayit SILINMEZ', async (_ad, bad) => {
    const h = harness({ local: seedLocal(bad) })
    const res = await h.client.ensureFresh()
    expect(res.rules).toEqual(BUNDLED)
    expect(res.rules.issuers.bstocks.buyEnabled).toBe(true)
    expect(persistedOf(h)).toEqual(bad)
    expect(h.localSet).not.toHaveBeenCalled()
  })

  it('rulesClient (R4): kalici kayit textVersion tasiyorsa yok sayilir, gomulu kullanilir, firlatma yok', async () => {
    // Eski sekilli kayit: gomuluden YUKSEK surumlu ve acil durdurmali; ama textVersion tasidigi icin BUTUNUYLE
    // reddedilir (K40). Kapi bu aralikta da gomulu tabloyla denetim yapar; kayit silinmez.
    const eski = killed(V(1))
    for (const issuer of ['bstocks', 'xstocks']) eski.issuers[issuer].textVersion = 1
    expect(validateRules(eski, { now: T0 })).toEqual({ ok: false, error: 'FIELDS' })
    const stored = { v: 1, rules: eski }
    const h = harness({ local: seedLocal(stored) })
    let res
    await expect((async () => { res = await h.client.ensureFresh() })()).resolves.toBeUndefined()
    expect(res.rules).toEqual(BUNDLED)
    expect(res.rules.issuers.bstocks.buyEnabled).toBe(true)
    expect(persistedOf(h)).toEqual(stored)
    expect(h.localSet).not.toHaveBeenCalled()
    // Kapi gomulu tabloyla calisir: engelli ulke BLOCKED (RULES_INVALID degil), acik ulke ALLOWED.
    const karar = (issuer, ipCountry) => decideStockBuy({ issuer, rules: res.rules, ipCountry, now: T0 })
    expect(karar('bstocks', 'DE')).toMatchObject({ decision: 'BLOCKED' })
    expect(karar('bstocks', 'DE').reason).not.toBe('RULES_INVALID')
    expect(karar('xstocks', 'CL').reason).not.toBe('RULES_INVALID')
  })

  it('R4: depo okumasi (get) firlatirsa da gomulu kopyayla surer, firlatma yok', async () => {
    const h = harness({ localOpts: { failGet: true } })
    const res = await h.client.ensureFresh()
    expect(res.rules).toEqual(BUNDLED)
    expect((await h.client.ensureFresh()).rules).toEqual(BUNDLED)
  })

  it('R4: bozuk kaydin ustune sonraki gecerli sunucu tablosu yazilir', async () => {
    const h = harness({ local: seedLocal({ v: 2, rules: killed() }), fetchImpl: serve(okBody(killed(V(2)), null)) })
    await h.client.ensureFresh()
    expect(persistedOf(h)).toEqual({ v: 1, rules: killed(V(2)) })
  })

  it('R4: surumu YUKSEK ama gecersiz (US yok) kalici kayit, sunucudaki gecerli tablonun yazilmasini ENGELLEMEZ', async () => {
    const h = harness({
      local: seedLocal({ v: 1, rules: withoutUs(V(8)) }),
      fetchImpl: serve(okBody(killed(V(2)), null)),
    })
    const res = await h.client.ensureFresh()
    expect(persistedOf(h)).toEqual({ v: 1, rules: killed(V(2)) })
    expect(res.rules.version).toBe(V(2))
  })

  it('R5: kalici kayit gomuluden DUSUKSE gomulu kazanir (en yuksek surum)', async () => {
    const h = harness({ local: seedLocal({ v: 1, rules: killed('2026-10-15.9') }) })
    const res = await h.client.ensureFresh()
    expect(res.rules.version).toBe(BUNDLED.version)
    expect(res.rules.issuers.bstocks.buyEnabled).toBe(true)
  })

  it('R6: IP kaydi 10 dk\'dan eski -> IP null; kurallar yine kalici kayittan', async () => {
    const h = harness({
      local: seedLocal({ v: 1, rules: killed(V(1)) }),
      session: seedSession({ ipCountry: 'TR', fetchedAt: T0 - IP_FRESH_MS - 1, failedAt: null }),
    })
    const res = await h.client.ensureFresh() // fetch reddedilir
    expect(res.ipCountry).toBeNull()
    expect(res.rules.issuers.bstocks.buyEnabled).toBe(false)
  })

  it('R7: kalici set firlatir -> kapi etkilenmez; bellek ici kopya ayni ornekte kullanilir, yeni ornekte yoktur', async () => {
    const h = harness({ localOpts: { failSet: true }, fetchImpl: serve(okBody(killed(V(1)), 'FR')) })
    const res = await h.client.ensureFresh()
    expect(h.localSet).toHaveBeenCalledTimes(1)
    expect(res.rules.issuers.bstocks.buyEnabled).toBe(false)
    expect(res.ipCountry).toBe('FR')
    expect((await h.client.ensureFresh()).rules.issuers.bstocks.buyEnabled).toBe(false)
    const h2 = harness({ local: h.localArea._store })
    expect((await h2.client.ensureFresh()).rules.issuers.bstocks.buyEnabled).toBe(true)
  })

  it('R8: daha yuksek surum geldiginde kalici kayit guncellenir; sonraki baslangicta yeni surum sunucuya erisilemese de kalici kayittan okunur', async () => {
    const h = harness({ local: seedLocal({ v: 1, rules: killed(V(1)) }), fetchImpl: serve(okBody(killed(V(2)), null)) })
    await h.client.ensureFresh()
    expect(h.localSet).toHaveBeenCalledTimes(1)
    expect(persistedOf(h).rules.version).toBe(V(2))
    const h2 = harness({ local: h.localArea._store })
    expect((await h2.client.ensureFresh()).rules.version).toBe(V(2))
  })

  it('surum karsilastirmasi SAYISALDIR: .10, .9\'dan yuksektir (dize karsilastirmasi yanlis sonuc verirdi)', async () => {
    const h = harness({ local: seedLocal({ v: 1, rules: killed(V(8)) }), fetchImpl: serve(okBody(killed(V(9)), null)) })
    await h.client.ensureFresh()
    expect(persistedOf(h).rules.version).toBe(V(9))
  })
})

describe('RF2: okuma yolu depoya YAZMAZ', () => {
  it('pozitif bekci: ilk basarili cekim hem oturuma hem kalici depoya yazar', async () => {
    const h = harness({ fetchImpl: serve(okBody(killed(V(1)), 'FR')) })
    await h.client.ensureFresh()
    expect(h.sessionSet).toHaveBeenCalledTimes(1)
    expect(h.localSet).toHaveBeenCalledTimes(1)
  })

  it('taze onbellekte ensureFresh hicbir depoya set ATMAZ ve fetch ATMAZ', async () => {
    const h = harness({ fetchImpl: serve(okBody(killed(V(1)), 'FR')) })
    await h.client.ensureFresh()
    h.localSet.mockClear()
    h.sessionSet.mockClear()
    const getsBefore = h.fetchFn.mock.calls.length
    h.clock.t = T0 + 60_000
    await h.client.ensureFresh()
    await h.client.ensureFresh()
    expect(h.localSet).not.toHaveBeenCalled()
    expect(h.sessionSet).not.toHaveBeenCalled()
    expect(h.fetchFn.mock.calls.length).toBe(getsBefore)
  })

  it('geri cekilme penceresinde de okuma yolu yazmaz', async () => {
    const h = harness()
    await h.client.ensureFresh() // basarisiz: failedAt yazilir
    h.sessionSet.mockClear()
    h.localSet.mockClear()
    h.clock.t = T0 + 10_000
    await h.client.ensureFresh()
    expect(h.sessionSet).not.toHaveBeenCalled()
    expect(h.localSet).not.toHaveBeenCalled()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe('RF5: istemci saati sunucu tablosunun surum tarihinden > 30 gun geride', () => {
  it('tablo SESSIZCE reddedilir (cokme yok, gomulu kullanilir); saat duzelince tablo kabul edilir', async () => {
    const eskiGomulu = mk('2026-09-01.1')
    const server = killed(V(1))
    const h = harness({ bundled: eskiGomulu, t: Date.UTC(2026, 8, 10, 12), fetchImpl: serve(okBody(server, 'FR')) })
    const bozukSaat = await h.client.ensureFresh()
    expect(bozukSaat.rules.version).toBe('2026-09-01.1')
    expect(bozukSaat.rules.issuers.bstocks.buyEnabled).toBe(true)
    expect(bozukSaat.ipCountry).toBeNull()
    expect(h.localSet).not.toHaveBeenCalled()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    h.clock.t = T0 // saat duzeldi (60 sn geri cekilme cok onceden doldu)
    const duzgun = await h.client.ensureFresh()
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
    expect(duzgun.rules.version).toBe(V(1))
    expect(duzgun.rules.issuers.bstocks.buyEnabled).toBe(false)
    expect(duzgun.ipCountry).toBe('FR')
    expect(persistedOf(h).rules.version).toBe(V(1))
  })
})

describe('P27: saat gomulu tablonun tarihinden de > 30 gun geride (hicbir tablo gecmez, alim kapali)', () => {
  const eskiGomulu = mk('2026-09-01.1') // 2026-09-01, saat 2026-07-01: 62 gun ileride
  const geriSaat = Date.UTC(2026, 6, 1, 12)
  const girdi = (rules, ipCountry, t) => ({
    issuer: 'bstocks', rules, ipCountry, now: t,
  })

  it('pozitif bekci: ayni gomulu tablo saat duzgunken gecerli ve karar RULES_INVALID DEGIL', () => {
    expect(validateRules(eskiGomulu, { now: Date.UTC(2026, 8, 10, 12) }).ok).toBe(true)
    expect(decideStockBuy(girdi(eskiGomulu, null, Date.UTC(2026, 8, 10, 12))).reason).not.toBe('RULES_INVALID')
  })

  it('sunucu, kalici kayit ve gomulu hep gecersiz: ensureFresh gomuluyu OLDUGU GIBI verir (null sizmaz, firlatmaz), karar RULES_INVALID', async () => {
    const h = harness({
      bundled: eskiGomulu,
      t: geriSaat,
      local: seedLocal({ v: 1, rules: killed('2026-10-15.1') }),
      fetchImpl: serve(okBody(killed(V(1)), 'FR')),
    })
    const res = await h.client.ensureFresh()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    expect(res.rules).toBe(eskiGomulu)
    expect(res.ipCountry).toBeNull()
    expect(validateRules(res.rules, { now: geriSaat })).toEqual({ ok: false, error: 'VERSION_FUTURE' })
    expect(decideStockBuy(girdi(res.rules, res.ipCountry, geriSaat))).toMatchObject({ decision: 'BLOCKED', reason: 'RULES_INVALID' })
    expect(h.localSet).not.toHaveBeenCalled()
    expect(persistedOf(h)).toEqual({ v: 1, rules: killed('2026-10-15.1') })
  })

  it('sunucuya hic erisilemese de ayni: gomulu oldugu gibi doner (null degil), karar RULES_INVALID', async () => {
    const h = harness({ bundled: eskiGomulu, t: geriSaat })
    const { rules, ipCountry } = await h.client.ensureFresh()
    expect(rules).toBe(eskiGomulu)
    expect(ipCountry).toBeNull()
    expect(decideStockBuy(girdi(rules, ipCountry, geriSaat)).reason).toBe('RULES_INVALID')
  })

  it('saat duzelince alim kendiliginden acilir (sunucu tablosu kabul edilir, karar RULES_INVALID degil)', async () => {
    const h = harness({ bundled: eskiGomulu, t: geriSaat, fetchImpl: serve(okBody(mk(V(1)), 'DE')) })
    await h.client.ensureFresh()
    h.clock.t = T0
    const res = await h.client.ensureFresh()
    expect(res.rules.version).toBe(V(1))
    expect(decideStockBuy(girdi(res.rules, res.ipCountry, T0)).reason).not.toBe('RULES_INVALID')
  })
})

describe('PF5: dis catch gomuluye DEGIL, o anki en iyi gecerli tabloya duser (K20)', () => {
  // `now` yalniz secilen cagri sirasinda firlatir (1 tabanli); sonraki cagrilar saglamdir.
  const nowThrowingOn = (nth) => {
    let n = 0
    return () => {
      n += 1
      if (n === nth) throw new Error('saat okunamadi')
      return T0
    }
  }
  const stored = () => seedLocal({ v: 1, rules: killed(V(1)) })

  it('ensureFresh dis catch: kalici acil durdurma korunur, fetch atilmaz, firlatmaz', async () => {
    const fetchFn = vi.fn(serve(okBody(BUNDLED, 'DE')))
    const client = createRulesClient({
      base: BASE, bundled: BUNDLED, fetchFn, local: () => memoryArea(stored()), session: () => memoryArea(), now: nowThrowingOn(1),
    })
    const res = await client.ensureFresh()
    expect(fetchFn).not.toHaveBeenCalled() // dis catch'e gercekten dusuldu
    expect(res.ipCountry).toBeNull()
    expect(res.rules.version).toBe(V(1))
    expect(res.rules.issuers.bstocks.buyEnabled).toBe(false)
  })

  it('saat tamamen bozulsa da kabul edilmis bellek ici sunucu tablosu gomuluden yuksekse o doner', async () => {
    let broken = false
    const client = createRulesClient({
      base: BASE, bundled: BUNDLED, fetchFn: serve(okBody(killed(V(1)), 'FR')),
      local: () => memoryArea({}, { failSet: true }), session: () => memoryArea(),
      now: () => { if (broken) throw new Error('saat okunamadi'); return T0 },
    })
    expect((await client.ensureFresh()).rules.issuers.bstocks.buyEnabled).toBe(false)
    broken = true
    const res = await client.ensureFresh()
    expect(res.rules.issuers.bstocks.buyEnabled).toBe(false)
    expect(res.ipCountry).toBeNull()
  })

  it('hicbir sey yoksa ve saat bozuksa gomulu doner (firlatma yok)', async () => {
    const client = createRulesClient({
      base: BASE, bundled: BUNDLED, local: () => memoryArea(), session: () => memoryArea(),
      now: () => { throw new Error('saat okunamadi') },
    })
    expect((await client.ensureFresh()).rules).toBe(BUNDLED)
  })
})

describe('oturum alani yedegi ve sert hatalar', () => {
  it('oturum alani firlatirsa bellek ici yedek: ikinci cagri fetch ATMAZ, IP okunur', async () => {
    const h = harness({ sessionOpts: { failGet: true, failSet: true }, fetchImpl: serve(okBody(BUNDLED, 'DE')) })
    await h.client.ensureFresh()
    expect((await h.client.ensureFresh()).ipCountry).toBe('DE')
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
  })

  it('oturum alani hic yoksa (undefined) ayni yedek calisir', async () => {
    const fetchFn = vi.fn(serve(okBody(BUNDLED, 'DE')))
    const client = createRulesClient({
      base: BASE, bundled: BUNDLED, fetchFn, local: () => memoryArea(), session: () => undefined, now: () => T0,
    })
    await client.ensureFresh()
    expect((await client.ensureFresh()).ipCountry).toBe('DE')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('kalici alan hic yoksa (undefined) ensureFresh FIRLATMAZ, bellek ici kopya doner; sunucu da yoksa gomulu doner', async () => {
    const client = createRulesClient({
      base: BASE, bundled: BUNDLED, fetchFn: serve(okBody(killed(), 'DE')), local: () => undefined, session: () => undefined, now: () => T0,
    })
    const res = await client.ensureFresh()
    expect(res.ipCountry).toBe('DE')
    expect(res.rules.issuers.bstocks.buyEnabled).toBe(false) // bellek ici kopya
    const agsiz = createRulesClient({
      base: BASE, bundled: BUNDLED, fetchFn: async () => { throw new Error('ag yok') }, local: () => undefined, session: () => undefined, now: () => T0,
    })
    expect((await agsiz.ensureFresh()).rules).toEqual(BUNDLED)
  })

  it('SC-1 (K20, spec 14 madde 19): ResetApp / ForgotPassword chrome.storage.local.clear() kalici kural kaydini siler; yeni SW ornegi gomuluye duser, ilk ensureFresh sunucudan GERI ALIR', async () => {
    const rules = killed(V(1))
    const h = harness({ local: seedLocal({ v: 1, rules }), fetchImpl: serve(okBody(rules, 'FR')) })
    // sunucuya erisilemeyen bir istemci kalici depoyu okur: sunucu yokken de kayit ayakta
    const agsiz = () => createRulesClient({
      base: BASE, bundled: BUNDLED, fetchFn: async () => { throw new Error('ag yok') },
      local: () => h.localArea, session: () => memoryArea(), now: () => T0,
    })
    // pozitif bekci: clear() ONCESI kalici kayit okunur
    expect((await agsiz().ensureFresh()).rules).toEqual(rules)
    expect(h.fetchFn).not.toHaveBeenCalled()
    // chrome.storage.local.clear() esdegeri: depodaki TUM anahtarlar silinir (memoryArea clear tasimaz)
    for (const k of Object.keys(h.localArea._store)) delete h.localArea._store[k]
    expect(persistedOf(h)).toBeUndefined()
    expect((await agsiz().ensureFresh()).rules).toEqual(BUNDLED) // SW yeniden basladi, sunucuya erisilemiyor
    expect(h.fetchFn).not.toHaveBeenCalled()
    const yeni = h.make()
    // sonraki akis: ilk ensureFresh sunucudan alir ve kalici kaydi YENIDEN yazar
    expect((await yeni.ensureFresh()).rules).toEqual(rules)
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    expect(persistedOf(h)).toEqual({ v: 1, rules })
  })

  it('alan erisimi (local()) firlatsa bile ensureFresh firlatmaz', async () => {
    const client = createRulesClient({
      base: BASE, bundled: BUNDLED, fetchFn: async () => { throw new Error('ag') },
      local: () => { throw new Error('storage yok') }, session: () => { throw new Error('storage yok') }, now: () => T0,
    })
    expect(await client.ensureFresh()).toEqual({ rules: BUNDLED, ipCountry: null })
  })
})

describe('kaynak kilitleri (yorumsuz tarama, spec 11.5-16)', () => {
  const kod = yorumsuz(KAYNAK)
  const persistGovde = blokGovdesi(KAYNAK, /async function persistRules\([^)]*\)\s*\{/)
  const sessionGovde = blokGovdesi(KAYNAK, /async function writeSession\([^)]*\)\s*\{/)

  it('pozitif bekci: tarama gercek kodu goruyor', () => {
    expect(kod).toContain('export function createRulesClient')
    expect(persistGovde).toContain('.set(')
    expect(sessionGovde).toContain('.set(')
  })

  it('depoya YAZIM yalniz iki yerde; kalici yazim { v: 1, rules }, oturum yazimi rules icermez', () => {
    expect(kod.match(/\.set\(/g)).toHaveLength(2)
    expect(persistGovde).toContain('{ v: 1, rules }')
    expect(persistGovde).not.toMatch(/ipCountry|fetchedAt|failedAt|now\(/)
    expect(sessionGovde).not.toMatch(/rules/)
    expect(kod).not.toMatch(/\.remove\(|\.clear\(/)
  })

  it('istek: AbortSignal.timeout yok, headers yok, credentials omit, ucun adresi tek yerde', () => {
    expect(kod).not.toMatch(/AbortSignal\.timeout/)
    expect(kod).not.toMatch(/headers/)
    expect(kod).toMatch(/credentials: 'omit'/)
    expect(kod).toMatch(/cache: 'no-store'/)
    expect(kod.match(/\/eligibility/g)).toHaveLength(1)
  })

  it('R11: createRulesClient yalniz ensureFresh dondurur; peekRules / peekIpCountry kaynakta yok', () => {
    expect(kod.length).toBeGreaterThan(0) // pozitif bekci: tarama bos degil
    expect(kod).toContain('ensureFresh')
    expect(Object.keys(harness().client)).toEqual(['ensureFresh'])
    expect(kod).not.toMatch(/peekRules|peekIpCountry/)
  })

  it('bayrak, log, gizli anahtar yok; yerel importlar yalniz ./rules ve ulke kodu verisi', () => {
    expect(kod).not.toMatch(/featureFlags/)
    expect(kod).not.toMatch(/console\./)
    expect(kod).not.toMatch(/privateKey/)
    expect(kod.match(/^import .*$/gm).map((s) => s.replace(/^.*from /, ''))).toEqual(["'./rules'", "'../../data/countryCodes'"])
  })
})

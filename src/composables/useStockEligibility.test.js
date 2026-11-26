// useStockEligibility -- hisse alim kapisinin ORTAK UYGUNLUK KAYNAGI (K34, K38; spec 5.12, 6.1; PE15, PE20).
//
// KOK NEDEN / KAPATILAN HATA SINIFLARI:
//  (1) YUKLEME = GIZLI: yanit gelmeden bir ihracci "musait" sayilirsa liste / arama / oneri yuzeyleri kilitli bir
//      ihracciyi bir an gosterir (E1);
//  (2) SONSUZ ISKELET: yanit hic gelmezse ekran sonsuza dek yuklenir; 5 sn sigorta iki ihracciyi kapatir (E3) ve gec gelen
//      gercek yanit sigortayi duzeltir (E3b); sigorta ile gercek CHECK_FAILED ayri izlenir (E3c);
//  (3) ULKE BILINMIYOR: tek zamanlayici (65 sn + sapma) ile yeniden sorulur, uygun olunca / birakilinca temizlenir (E4);
//  (4) BAYAT YANIT (RF1, E6) ve GERI BESLEME DONGUSU (RF2, E6): Task 38'de useStockGate'te olan koruma burada TEK yerde;
//  (5) TEMBELLIK: modul yuklenirken mesaj yok (E9), abone yokken mesaj yok, enabled false hic abone olmaz (E5, E10);
//  (6) HESAP / BEYAN DEGISIMI sorguyu TETIKLEMEZ (K32, K39; E8); PERIYODIK SORGU YOK (PE20 a; E14);
//  (7) ANLIK GORUNTU son abone birakinca silinmez ama 30 sn sonra bayat sayilir (PE20 b; E11, E12).
// Yetkili kapi arka plandadir; bu dosya yalniz AYNAYI sinar.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { effectScope, nextTick, ref } from 'vue'

// Bu testlerde bilesen yok: onMounted kapsam icinde HEMEN calisir (SSR testlerindeki onServerPrefetch aliasinin yerine).
vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, onMounted: (fn) => { fn() } }
})

import { yorumsuz } from '../test-utils/kaynakTarama'
import {
  createStockEligibilityStore, getStockEligibilityStore, disposeStockEligibilityStore, useStockEligibility, defaultSubscribe,
  ELIGIBILITY_FUSE_MS, ELIGIBILITY_RETRY_BASE_MS, ELIGIBILITY_RETRY_JITTER_MS, ELIGIBILITY_REUSE_MS,
  SETTLE_MS, MAX_REQUESTS_PER_BURST, STOCK_GATE_WATCHED_KEYS,
} from './useStockEligibility'

const KAYNAK = fs.readFileSync(fileURLToPath(new URL('./useStockEligibility.js', import.meta.url)), 'utf8')

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const V = (decision, reason, ipCountry = null) => ({ decision, reason, ipCountry })
const reply = (b = V('OK', 'OK', 'DE'), x = V('OK', 'OK', 'DE')) => ({ bstocks: b, xstocks: x })
const BLOCKED_IP = V('BLOCKED', 'IP_COUNTRY_ISSUER', 'TR')
const UNKNOWN = V('BLOCKED', 'COUNTRY_UNKNOWN')
const FAILED = V('BLOCKED', 'CHECK_FAILED')

// Elle cozulen istekler: hangi yanitin ne zaman geldigini test belirler (yaris testleri icin sart).
function manualSend() {
  const calls = []
  const send = vi.fn((message) => new Promise((resolve) => { calls.push({ message, resolve }) }))
  return { send, calls }
}

// Sahte zamanlayici: kurulan zamanlayicilari kaydeder, test elle tetikler.
function fakeTimers() {
  let next = 1
  const active = new Map()
  return {
    setTimer: vi.fn((fn, ms) => { const h = next++; active.set(h, { fn, ms }); return h }),
    clearTimer: vi.fn((h) => { active.delete(h) }),
    active: () => [...active.values()],
    fire: (pred) => {
      const girdi = [...active.entries()].find(([, t]) => pred(t.ms))
      if (!girdi) throw new Error('tetiklenecek zamanlayici yok')
      active.delete(girdi[0])
      girdi[1].fn()
    },
  }
}
const isFuse = (ms) => ms === ELIGIBILITY_FUSE_MS
const isRetry = (ms) => ms >= ELIGIBILITY_RETRY_BASE_MS

function setup(extra = {}) {
  const { send, calls } = manualSend()
  const timers = fakeTimers()
  let t = 0
  let trigger = null
  const unsub = vi.fn()
  const subscribe = vi.fn((fn) => { trigger = fn; return unsub })
  const store = createStockEligibilityStore({
    send, subscribe, setTimer: timers.setTimer, clearTimer: timers.clearTimer, random: () => 0.5, now: () => t, ...extra,
  })
  return {
    store, send, calls, timers, subscribe, unsub,
    fire: () => trigger?.(),
    advance: (ms) => { t += ms },
    at: (ms) => { t = ms },
  }
}

// Gercek kancayi kapsam icinde kuran, chrome sahteli duzenek (tekil store gercek).
function kurChrome(handler = async () => reply()) {
  const dinleyiciler = []
  const sendMessage = vi.fn(handler)
  const onChanged = {
    addListener: vi.fn((f) => { dinleyiciler.push(f) }),
    removeListener: vi.fn((f) => { const i = dinleyiciler.indexOf(f); if (i >= 0) dinleyiciler.splice(i, 1) }),
  }
  globalThis.chrome = { runtime: { sendMessage }, storage: { onChanged } }
  return { sendMessage, onChanged, emit: (changes) => dinleyiciler.slice().forEach((f) => f(changes, 'local')) }
}
const kurKapsam = (opts) => {
  const scope = effectScope()
  const api = scope.run(() => useStockEligibility(opts))
  return { api, scope }
}

afterEach(() => {
  disposeStockEligibilityStore()
  vi.useRealTimers()
  delete globalThis.chrome
  delete globalThis.document
})

describe('sabitler', () => {
  it('sigorta 5 sn, yeniden deneme 65 sn + 10 sn sapma, anlik goruntu 30 sn', () => {
    expect(ELIGIBILITY_FUSE_MS).toBe(5000)
    expect(ELIGIBILITY_RETRY_BASE_MS).toBe(65000)
    expect(ELIGIBILITY_RETRY_JITTER_MS).toBe(10000)
    expect(ELIGIBILITY_REUSE_MS).toBe(30000)
  })
})

describe('E1 / E2 baslangic ve yanit (gercek kanca)', () => {
  it('E1 baslangic: ready false ve isAvailable her ihracci icin false (yukleme = gizli)', async () => {
    kurChrome(() => new Promise(() => {})) // yanit hic gelmez
    const { api, scope } = kurKapsam()
    await flush()
    expect(api.ready.value).toBe(false)
    expect(api.isAvailable('bstocks')).toBe(false)
    expect(api.isAvailable('xstocks')).toBe(false)
    expect(api.verdictOf('bstocks')).toBeNull()
    expect(api.availableIssuers.value).toEqual([])
    expect(api.anyAvailable.value).toBe(false)
    scope.stop()
  })

  it('E2 yanit: bstocks BLOCKED/IP_COUNTRY_ISSUER, xstocks WARN -> isAvailable(bstocks) false, isAvailable(xstocks) true, warnOf(xstocks) true, availableIssuers [xstocks], anyAvailable true', async () => {
    kurChrome(async () => reply(BLOCKED_IP, V('WARN', 'WARN_COUNTRY', 'TR')))
    const { api, scope } = kurKapsam()
    await flush()
    expect(api.ready.value).toBe(true)
    expect(api.isAvailable('bstocks')).toBe(false)
    expect(api.isAvailable('xstocks')).toBe(true)
    expect(api.warnOf('xstocks')).toBe(true)
    expect(api.warnOf('bstocks')).toBe(false)
    expect(api.availableIssuers.value).toEqual(['xstocks'])
    expect(api.anyAvailable.value).toBe(true)
    expect(api.verdictOf('bstocks')).toEqual(BLOCKED_IP)
    scope.stop()
  })

  it('bilinmeyen / gecersiz ihracci her durumda musait DEGIL ve karari yok (hazirken bile)', async () => {
    kurChrome(async () => reply())
    const { api, scope } = kurKapsam()
    await flush()
    for (const bozuk of ['dogecoin', '__proto__', 'constructor', 'BSTOCKS', '', 42, {}, [], null, undefined]) {
      expect(api.isAvailable(bozuk), String(bozuk)).toBe(false)
      expect(api.verdictOf(bozuk), String(bozuk)).toBeNull()
    }
    expect(api.isAvailable('bstocks')).toBe(true) // pozitif bekci
    scope.stop()
  })

  it('bozuk V (decision tanimsiz, ipCountry "tr") -> o ihracci CHECK_FAILED; saglam olan etkilenmez', async () => {
    kurChrome(async () => ({ bstocks: { reason: 'OK', ipCountry: 'tr' }, xstocks: V('OK', 'OK', 'DE') }))
    const { api, scope } = kurKapsam()
    await flush()
    expect(api.verdictOf('bstocks')).toEqual(FAILED)
    expect(api.isAvailable('bstocks')).toBe(false)
    expect(api.isAvailable('xstocks')).toBe(true)
    scope.stop()
  })

  // UI-1: arka planin ic nedenleri (decide.js: RULES_INVALID, ISSUER_UNKNOWN) ve bozuk adlar kullaniciya YAZILAN neden
  // degildir. Ham tasinirsa Home bos durum dali (['COUNTRY_UNKNOWN', 'CHECK_FAILED'].includes) onu "ulke bilinmiyor"
  // saymaz ve hatali "bu bolgede urun yok" der. BLOCKED nedeni STOCK_GATE_REASONS'a indirilir (useStockGate ile ayni kural).
  it('BLOCKED nedeni kapali kumeye iner: ham RULES_INVALID / ISSUER_UNKNOWN / bozuk ad -> CHECK_FAILED; kume ici neden ve ipCountry korunur', async () => {
    for (const ham of ['RULES_INVALID', 'ISSUER_UNKNOWN', 'bogus', '__proto__', 'constructor', '']) {
      kurChrome(async () => reply(V('BLOCKED', ham), V('BLOCKED', ham, 'DE')))
      const { api, scope } = kurKapsam()
      await flush()
      expect(api.verdictOf('bstocks'), ham).toEqual(FAILED)
      expect(api.verdictOf('xstocks'), ham).toEqual(V('BLOCKED', 'CHECK_FAILED', 'DE'))
      expect(api.isAvailable('bstocks'), ham).toBe(false)
      scope.stop()
      disposeStockEligibilityStore()
    }
    // kume ici nedenler AYNEN kalir (pozitif bekci: indirgeme her seyi CHECK_FAILED yapmaz)
    kurChrome(async () => reply(BLOCKED_IP, UNKNOWN))
    const { api, scope } = kurKapsam()
    await flush()
    expect(api.verdictOf('bstocks')).toEqual(BLOCKED_IP)
    expect(api.verdictOf('xstocks')).toEqual(UNKNOWN)
    scope.stop()
  })

  it('OK / WARN karar nedeni (bilgi amacli, kume disi olabilir) DEGISMEZ: yalniz BLOCKED indirgenir', async () => {
    kurChrome(async () => reply(V('OK', 'OK', 'DE'), V('WARN', 'WARN_COUNTRY', 'DE')))
    const { api, scope } = kurKapsam()
    await flush()
    expect(api.verdictOf('bstocks')).toEqual(V('OK', 'OK', 'DE'))
    expect(api.verdictOf('xstocks')).toEqual(V('WARN', 'WARN_COUNTRY', 'DE'))
    expect(api.isAvailable('xstocks')).toBe(true)
    scope.stop()
  })

  it('bozuk yanit bicimleri (dizi, dize, ihracci eksik, reddedilen soz) iki ihracciyi da CHECK_FAILED yapar ve firlatmaz', async () => {
    for (const bozuk of [null, undefined, 'x', 42, [], {}, { error: 'x' }, { bstocks: V('OK', 'OK') }]) {
      kurChrome(async () => bozuk)
      const { api, scope } = kurKapsam()
      await flush()
      expect(api.ready.value, String(bozuk)).toBe(true)
      expect(api.isAvailable('xstocks'), String(bozuk)).toBe(false)
      scope.stop()
      disposeStockEligibilityStore()
    }
    kurChrome(async () => { throw new Error('kanal kapali') })
    const { api, scope } = kurKapsam()
    await flush()
    expect(api.verdictOf('bstocks')).toEqual(FAILED)
    expect(api.verdictOf('xstocks')).toEqual(FAILED)
    scope.stop()
  })

  it('yanit TAM uc anahtar tasir: ek alanlar (hesap, ham IP) kaynaga gecmez', async () => {
    kurChrome(async () => reply({ ...V('OK', 'OK', 'DE'), account: { privateKey: 'gizli' }, ip: '203.0.113.9' }))
    const { api, scope } = kurKapsam()
    await flush()
    expect(Object.keys(api.verdictOf('bstocks')).sort()).toEqual(['decision', 'ipCountry', 'reason'])
    expect(JSON.stringify(api.verdictOf('bstocks'))).not.toContain('gizli')
    scope.stop()
  })

  it('tek STOCK_GATE_STATUS, govdesiz ({ type } yalniz)', async () => {
    const c = kurChrome()
    const { scope } = kurKapsam()
    await flush()
    expect(c.sendMessage).toHaveBeenCalledTimes(1)
    expect(c.sendMessage).toHaveBeenCalledWith({ type: 'STOCK_GATE_STATUS' })
    scope.stop()
  })
})

describe('E3 / E3b / E3c sigorta', () => {
  it('E3 yanit hic gelmez: 5 sn sonra ready true ve iki ihracci BLOCKED/CHECK_FAILED', () => {
    const h = setup()
    h.store.acquire()
    expect(h.store.snapshot()).toEqual({ status: 'loading', verdicts: null, fused: false })
    expect(h.timers.active().some((t) => isFuse(t.ms))).toBe(true)
    h.timers.fire(isFuse)
    expect(h.store.snapshot()).toEqual({ status: 'ready', verdicts: { bstocks: FAILED, xstocks: FAILED }, fused: true })
  })

  it('E3: sigorta dolmadan gelen yanit sigortayi temizler (sigorta sonradan tetiklenmez)', async () => {
    const h = setup()
    h.store.acquire()
    h.calls[0].resolve(reply())
    await flush()
    expect(h.timers.active().some((t) => isFuse(t.ms))).toBe(false)
    expect(h.store.snapshot()).toMatchObject({ status: 'ready', fused: false })
  })

  it("E3b sigorta sonrasi gec gelen GERCEK yanit durumu degistirir ve fused temizlenir (sigorta seq'i artirmaz)", async () => {
    const h = setup()
    const degisimler = []
    h.store.onChange((s) => degisimler.push(s))
    h.store.acquire()
    h.timers.fire(isFuse)
    expect(h.store.snapshot().fused).toBe(true)
    h.calls[0].resolve(reply(V('OK', 'OK', 'DE'), BLOCKED_IP))
    await flush()
    expect(h.store.snapshot()).toEqual({ status: 'ready', verdicts: reply(V('OK', 'OK', 'DE'), BLOCKED_IP), fused: false })
    expect(degisimler.map((s) => s.fused)).toEqual([true, false]) // sigorta, sonra gercek yanit
  })

  it('E3c fused durumu zamanlayici kurar, gercek CHECK_FAILED kurmaz (snapshot().fused ikisini ayirir)', async () => {
    const fused = setup()
    fused.store.acquire()
    fused.timers.fire(isFuse)
    expect(fused.store.snapshot().fused).toBe(true)
    expect(fused.timers.active().filter((t) => isRetry(t.ms))).toHaveLength(1)

    const gercek = setup()
    gercek.store.acquire()
    gercek.calls[0].resolve(reply(FAILED, FAILED))
    await flush()
    expect(gercek.store.snapshot()).toEqual({ status: 'ready', verdicts: { bstocks: FAILED, xstocks: FAILED }, fused: false })
    expect(gercek.timers.active()).toEqual([])
  })
})

describe('E4 yeniden deneme zamanlayicisi', () => {
  it('E4 COUNTRY_UNKNOWN: tek zamanlayici (65000 + random*10000), dolunca refresh()', async () => {
    const h = setup()
    h.store.acquire()
    h.calls[0].resolve(reply(UNKNOWN, UNKNOWN))
    await flush()
    const retry = h.timers.setTimer.mock.calls.filter(([, ms]) => isRetry(ms))
    expect(retry).toHaveLength(1)
    expect(retry[0][1]).toBe(ELIGIBILITY_RETRY_BASE_MS + 0.5 * ELIGIBILITY_RETRY_JITTER_MS)
    h.timers.fire(isRetry)
    expect(h.send).toHaveBeenCalledTimes(2) // refresh() yeniden sordu
  })

  it('E4 hala bilinmiyorsa YENI tek zamanlayici; uygun duruma gecince temizlenir', async () => {
    const h = setup()
    h.store.acquire()
    h.calls[0].resolve(reply(UNKNOWN, V('OK', 'OK', 'DE')))
    await flush()
    h.timers.fire(isRetry)
    h.calls[1].resolve(reply(UNKNOWN, UNKNOWN))
    await flush()
    expect(h.timers.active().filter((t) => isRetry(t.ms))).toHaveLength(1)
    h.timers.fire(isRetry)
    h.calls[2].resolve(reply())
    await flush()
    expect(h.timers.active()).toEqual([]) // uygun: zamanlayici yok
    expect(h.store.snapshot().verdicts).toEqual(reply())
  })

  it("E4 son release'te ve dispose'ta temizlenir", async () => {
    const a = setup()
    a.store.acquire()
    a.calls[0].resolve(reply(UNKNOWN, UNKNOWN))
    await flush()
    expect(a.timers.active()).toHaveLength(1)
    a.store.release()
    expect(a.timers.active()).toEqual([])

    const b = setup()
    b.store.acquire()
    b.calls[0].resolve(reply(UNKNOWN, UNKNOWN))
    await flush()
    expect(b.timers.active()).toHaveLength(1)
    b.store.dispose()
    expect(b.timers.active()).toEqual([])
  })

  it('E4 CHECK_FAILED zamanlayici KURMAZ; kopya sirasi: ikinci abone zamanlayiciyi cogaltmaz', async () => {
    const h = setup()
    h.store.acquire()
    h.calls[0].resolve(reply(FAILED, V('OK', 'OK', 'DE')))
    await flush()
    expect(h.timers.setTimer.mock.calls.filter(([, ms]) => isRetry(ms))).toHaveLength(0)

    const u = setup()
    u.store.acquire()
    u.store.acquire()
    u.calls[0].resolve(reply(UNKNOWN, UNKNOWN))
    await flush()
    u.store.refresh()
    expect(u.timers.active().filter((t) => isRetry(t.ms))).toHaveLength(1)
  })
})

describe('E5 abone sayaci', () => {
  it('E5 abone yokken mesaj yok; ilk acquire tek mesaj; ikinci abone yeni mesaj atmaz', async () => {
    const h = setup()
    await h.store.refresh()
    h.fire()
    expect(h.send).not.toHaveBeenCalled()
    expect(h.subscribe).not.toHaveBeenCalled()
    h.store.acquire()
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send).toHaveBeenCalledWith({ type: 'STOCK_GATE_STATUS' })
    h.store.acquire()
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.subscribe).toHaveBeenCalledTimes(1)
    h.calls[0].resolve(reply())
    await flush()
    h.store.acquire() // yanit geldikten sonra gelen ucuncu abone de sormaz
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it("birakma: son abone birakinca dinleyici kalkar; ortadaki birakma kaldirmaz; fazladan release zararsiz", () => {
    const h = setup()
    h.store.acquire()
    h.store.acquire()
    h.store.release()
    expect(h.unsub).not.toHaveBeenCalled()
    h.store.release()
    expect(h.unsub).toHaveBeenCalledTimes(1)
    h.store.release()
    expect(h.unsub).toHaveBeenCalledTimes(1)
    h.store.acquire()
    expect(h.subscribe).toHaveBeenCalledTimes(2)
  })

  it('E5 enabled false hic acquire etmez (gercek kanca): mesaj yok, dinleyici yok, ready false', async () => {
    const c = kurChrome()
    const { api, scope } = kurKapsam({ enabled: false })
    await flush()
    expect(c.sendMessage).not.toHaveBeenCalled()
    expect(c.onChanged.addListener).not.toHaveBeenCalled()
    expect(api.ready.value).toBe(false)
    scope.stop()
  })

  it('kapsam kapaninca abonelik birakilir: dinleyici kalkar, zamanlayici kalmaz', async () => {
    const c = kurChrome()
    const { scope } = kurKapsam()
    await flush()
    expect(c.onChanged.addListener).toHaveBeenCalledTimes(1)
    scope.stop()
    expect(c.onChanged.removeListener).toHaveBeenCalledTimes(1)
  })
})

describe('E6 bayat yanit ve geri besleme', () => {
  it('E6 bayat yanit ezilmez (seq): eski donemin yaniti yeni donemin kararini degistirmez (iki varis sirasi)', async () => {
    for (const eskiOnce of [true, false]) {
      const h = setup()
      h.store.acquire()
      h.store.release() // donem biter
      h.store.acquire() // yeni donem
      expect(h.calls).toHaveLength(2)
      const eski = () => h.calls[0].resolve(reply(BLOCKED_IP, BLOCKED_IP))
      const yeni = () => h.calls[1].resolve(reply())
      if (eskiOnce) { eski(); await flush(); yeni() } else { yeni(); await flush(); eski() }
      await flush()
      expect(h.store.snapshot().verdicts, `eskiOnce=${eskiOnce}`).toEqual(reply())
    }
  })

  it('ucus sirasinda tetik gelirse tetikten ONCE sorulan yanit yayinlanmaz, yeniden sorulur', async () => {
    const h = setup()
    const degisimler = []
    h.store.onChange((s) => degisimler.push(s.verdicts))
    h.store.acquire()
    h.fire()
    h.calls[0].resolve(reply(BLOCKED_IP, BLOCKED_IP))
    await flush()
    expect(h.calls).toHaveLength(2)
    h.calls[1].resolve(reply())
    await flush()
    expect(h.store.snapshot().verdicts).toEqual(reply())
    expect(degisimler).toEqual([reply()]) // bayat BLOCKED hic yayinlanmadi
  })

  it('E6 geri besleme: ucus sirasinda 10 tetik TEK ek istege birlesir (toplam 2) ve ardindan sessizlik', async () => {
    const h = setup()
    h.store.acquire()
    for (let i = 0; i < 10; i++) h.fire()
    h.calls[0].resolve(reply())
    await flush()
    expect(h.calls).toHaveLength(MAX_REQUESTS_PER_BURST)
    for (let i = 0; i < 10; i++) h.fire()
    h.calls[1].resolve(reply())
    await flush()
    for (let i = 0; i < 10; i++) h.fire()
    await flush()
    expect(h.send).toHaveBeenCalledTimes(2)
  })

  it('E6 stock_gate_cache degisimi (her send bir olay uretir): toplam <= 2, sonsuz dongu yok', async () => {
    let fireFn = () => {}
    let sayac = 0
    const send = vi.fn(async () => { sayac += 1; if (sayac > 50) throw new Error('dongu'); fireFn(); return reply() })
    const h = setup({ send })
    fireFn = h.fire
    h.store.acquire()
    await flush()
    await flush()
    expect(send.mock.calls.length).toBeLessThanOrEqual(2)
    expect(h.store.snapshot().status).toBe('ready')
  })

  it('olay yanittan SONRA gelirse de (settle penceresi) en cok bir ek istek', async () => {
    const h = setup()
    h.at(1000)
    h.store.acquire()
    h.calls[0].resolve(reply())
    await flush()
    h.fire() // arka planin yazdigi onbellegin gec gelen olayi
    expect(h.calls).toHaveLength(2)
    h.calls[1].resolve(reply())
    await flush()
    h.fire()
    h.fire()
    expect(h.send).toHaveBeenCalledTimes(2)
  })

  it(`${SETTLE_MS} ms sessizlikten sonra gercek bir degisiklik yeniden sorulur (susturma kalici degil)`, async () => {
    const h = setup()
    h.store.acquire()
    h.fire()
    h.calls[0].resolve(reply())
    await flush()
    h.calls[1].resolve(reply())
    await flush()
    h.fire()
    expect(h.send).toHaveBeenCalledTimes(2) // salvo dolu: yok sayildi
    h.advance(SETTLE_MS + 1)
    h.fire()
    expect(h.send).toHaveBeenCalledTimes(3)
    h.calls[2].resolve(reply(UNKNOWN, UNKNOWN))
    await flush()
    expect(h.store.snapshot().verdicts.bstocks).toEqual(UNKNOWN)
  })

  it('abone yokken ya da dispose sonrasi tetik hicbir sey yapmaz', () => {
    const h = setup()
    h.fire()
    h.store.acquire()
    h.store.dispose()
    h.fire()
    expect(h.send).toHaveBeenCalledTimes(1)
  })
})

describe('refresh / dispose', () => {
  it('refresh() yeniden sorar; ekran loading e DONMEZ; yanit yayinlanir', async () => {
    const h = setup()
    h.store.acquire()
    h.calls[0].resolve(reply())
    await flush()
    const p = h.store.refresh()
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.store.snapshot().status).toBe('ready')
    h.calls[1].resolve(reply(BLOCKED_IP, BLOCKED_IP))
    await p
    expect(h.store.snapshot().verdicts.bstocks).toEqual(BLOCKED_IP)
  })

  it('ucus sirasinda refresh() TEK ek istege birlesir', async () => {
    const h = setup()
    h.store.acquire()
    h.store.refresh()
    h.store.refresh()
    h.store.refresh()
    h.calls[0].resolve(reply())
    await flush()
    expect(h.send).toHaveBeenCalledTimes(2)
    h.calls[1].resolve(reply())
    await flush()
    expect(h.send).toHaveBeenCalledTimes(2)
  })

  it('dispose() sonrasi gec yanit durumu degistirmez; refresh / acquire MESAJ ATMAZ; ikinci dispose zararsiz', async () => {
    const h = setup()
    h.store.acquire()
    h.store.dispose()
    expect(h.unsub).toHaveBeenCalledTimes(1)
    h.calls[0].resolve(reply())
    await flush()
    expect(h.store.snapshot().status).toBe('loading')
    await h.store.refresh()
    await h.store.acquire()
    expect(h.send).toHaveBeenCalledTimes(1)
    h.store.dispose()
    expect(h.unsub).toHaveBeenCalledTimes(1)
  })

  it('subscribe ya da onChange firlatsa da cekirdek calisir', async () => {
    const send = vi.fn(async () => reply())
    const store = createStockEligibilityStore({ send, subscribe: () => { throw new Error('dinleyici yok') } })
    store.onChange(() => { throw new Error('arayuz hatasi') })
    await store.acquire()
    expect(store.snapshot().status).toBe('ready')
    store.dispose()
  })

  it('onChange abonesi kaldirilabilir; snapshot() kopya dondurur (disaridan degistirilemez)', async () => {
    const h = setup()
    const fn = vi.fn()
    const off = h.store.onChange(fn)
    h.store.acquire()
    h.calls[0].resolve(reply())
    await flush()
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    h.store.refresh()
    h.calls[1].resolve(reply())
    await flush()
    expect(fn).toHaveBeenCalledTimes(1)
    const kopya = h.store.snapshot()
    kopya.verdicts.bstocks.decision = 'BLOCKED'
    expect(h.store.snapshot().verdicts.bstocks.decision).toBe('OK')
  })
})

describe('E11 / E12 / E13 anlik goruntu', () => {
  it("E11 anlik goruntu son release'te silinmez: 30 sn icinde yeniden acquire -> ready hemen, TEK yeniden sorgu, yeni yanit gorunurde degistirir", async () => {
    const h = setup()
    h.store.acquire()
    h.calls[0].resolve(reply())
    await flush()
    h.store.release()
    expect(h.store.snapshot()).toMatchObject({ status: 'ready', verdicts: reply() }) // silinmedi
    h.advance(ELIGIBILITY_REUSE_MS)
    const p = h.store.acquire()
    expect(h.store.snapshot()).toMatchObject({ status: 'ready', verdicts: reply() }) // iskelet yok
    expect(h.send).toHaveBeenCalledTimes(2) // TEK yeniden sorgu
    h.calls[1].resolve(reply(BLOCKED_IP, V('OK', 'OK', 'DE')))
    await p
    expect(h.store.snapshot().verdicts.bstocks).toEqual(BLOCKED_IP)
    h.store.acquire()
    expect(h.send).toHaveBeenCalledTimes(2)
  })

  it('E12 30 sn + 1 ms sonra yeniden acquire -> loading ve isAvailable false (yukleme = gizli); yeniden sorulur', async () => {
    const h = setup()
    h.store.acquire()
    h.calls[0].resolve(reply())
    await flush()
    h.store.release()
    h.advance(ELIGIBILITY_REUSE_MS + 1)
    h.store.acquire()
    expect(h.store.snapshot()).toEqual({ status: 'loading', verdicts: null, fused: false })
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.timers.active().some((t) => isFuse(t.ms))).toBe(true) // yukleme sigortasi yeniden kuruldu
  })

  it('E12 (gercek kanca): bayat goruntu ile yeniden abone olan yuzey yanit gelene kadar hicbir ihracciyi musait saymaz', async () => {
    vi.useFakeTimers()
    kurChrome(async () => reply())
    const a = kurKapsam()
    await flush()
    a.scope.stop()
    vi.setSystemTime(Date.now() + ELIGIBILITY_REUSE_MS + 1)
    const c2 = kurChrome(() => new Promise(() => {}))
    const b = kurKapsam()
    await flush()
    expect(c2.sendMessage).toHaveBeenCalledTimes(1)
    expect(b.api.ready.value).toBe(false)
    expect(b.api.isAvailable('bstocks')).toBe(false)
    b.scope.stop()
  })

  it('E13 disposeStockEligibilityStore tekili sifirlar (yeni getStockEligibilityStore ornegi loading)', async () => {
    kurChrome()
    const ilk = getStockEligibilityStore()
    expect(getStockEligibilityStore()).toBe(ilk) // tekil
    await ilk.acquire()
    expect(ilk.snapshot().status).toBe('ready')
    disposeStockEligibilityStore()
    const yeni = getStockEligibilityStore()
    expect(yeni).not.toBe(ilk)
    expect(yeni.snapshot()).toEqual({ status: 'loading', verdicts: null, fused: false })
    disposeStockEligibilityStore() // ikinci sifirlama zararsiz
  })
})

describe('E14 periyodik sorgu YOK', () => {
  it('E14 gorunur ve aboneyken 1 saat sahte zaman gecince ek mesaj gitmez (OK/OK durumda zamanlayici da yok)', async () => {
    vi.useFakeTimers()
    const listeners = []
    const doc = { visibilityState: 'visible', addEventListener: vi.fn((e, f) => listeners.push([e, f])), removeEventListener: vi.fn() }
    globalThis.document = doc
    const c = kurChrome(async () => reply())
    const store = createStockEligibilityStore() // varsayilan zamanlayici ve dinleyici: gercek yollar
    await store.acquire()
    expect(c.sendMessage).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(c.sendMessage).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    store.dispose()
  })
})

describe('E7 / E8 / E9 / E10 gercek kanca', () => {
  it('E7 ulke degisimi (yeni yanit) reaktif: izlenen depo anahtari degisince yuzey yeni karari gorur', async () => {
    let yanit = reply(BLOCKED_IP, V('WARN', 'WARN_COUNTRY', 'TR'))
    const c = kurChrome(async () => yanit)
    const { api, scope } = kurKapsam()
    await flush()
    expect(api.isAvailable('bstocks')).toBe(false)
    expect(api.warnOf('xstocks')).toBe(true)
    yanit = reply(V('OK', 'OK', 'DE'), V('OK', 'OK', 'DE'))
    c.emit({ stock_gate_cache: { newValue: 1 } })
    await flush()
    expect(api.isAvailable('bstocks')).toBe(true)
    expect(api.warnOf('xstocks')).toBe(false)
    expect(api.verdictOf('bstocks').ipCountry).toBe('DE')
    scope.stop()
  })

  it('E8 active_account ve stock_declarations degisimi yeniden sorguyu TETIKLEMEZ (karar hesaba / beyana bagli degil)', async () => {
    const c = kurChrome()
    const { scope } = kurKapsam()
    await flush()
    expect(c.sendMessage).toHaveBeenCalledTimes(1)
    c.emit({ active_account: { newValue: { address: '0x1' } } })
    c.emit({ stock_declarations: { oldValue: { 'k:k1': {} } } })
    c.emit({ theme: { newValue: 'dark' } })
    await flush()
    expect(c.sendMessage).toHaveBeenCalledTimes(1)
    // pozitif bekci: izlenen anahtar yeniden sorar
    c.emit({ stock_gate_rules_cache: { newValue: 1 } })
    await flush()
    expect(c.sendMessage).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('E9 modul yuklenirken mesaj YOK ve getStockEligibilityStore tembel (dinleyici de yok)', async () => {
    const c = kurChrome()
    vi.resetModules()
    const taze = await import('./useStockEligibility')
    expect(c.sendMessage).not.toHaveBeenCalled()
    expect(c.onChanged.addListener).not.toHaveBeenCalled()
    const store = taze.getStockEligibilityStore()
    expect(taze.getStockEligibilityStore()).toBe(store)
    expect(c.sendMessage).not.toHaveBeenCalled()
    expect(c.onChanged.addListener).not.toHaveBeenCalled()
    expect(store.snapshot().status).toBe('loading')
    taze.disposeStockEligibilityStore()
  })

  it('E9 kaynak: modul duzeyinde (fonksiyon disinda) getStockEligibilityStore() cagrisi yok', () => {
    const kod = yorumsuz(KAYNAK)
    expect(kod).toContain('export function getStockEligibilityStore')
    expect(kod).not.toMatch(/^(?!export function|\s)[^\n]*\bgetStockEligibilityStore\(/m)
    expect(kod).not.toMatch(/^(?!export function|\s)[^\n]*\bcreateStockEligibilityStore\(/m)
  })

  it('E10 enabled getter degisimi: true -> acquire, false -> release, tekrar false release i ikinci kez cagirmaz', async () => {
    const c = kurChrome()
    const acik = ref(false)
    const { api, scope } = kurKapsam({ enabled: () => acik.value })
    await flush()
    expect(c.sendMessage).not.toHaveBeenCalled()
    const store = getStockEligibilityStore()
    const acquire = vi.spyOn(store, 'acquire')
    const release = vi.spyOn(store, 'release')
    acik.value = true
    await nextTick()
    expect(acquire).toHaveBeenCalledTimes(1)
    await flush()
    expect(api.ready.value).toBe(true)
    acik.value = false
    await nextTick()
    expect(release).toHaveBeenCalledTimes(1)
    acik.value = false
    await nextTick()
    expect(release).toHaveBeenCalledTimes(1)
    scope.stop() // zaten birakilmis: ikinci kez release YOK
    expect(release).toHaveBeenCalledTimes(1)
    // yeniden ac: yeni abonelik (30 sn icinde goruntu hazir)
    expect(c.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('iki yuzey ayni kaynagi paylasir: tek mesaj; biri birakinca dinleyici kalir, ikisi birakinca kalkar', async () => {
    const c = kurChrome()
    const a = kurKapsam()
    const b = kurKapsam()
    await flush()
    expect(c.sendMessage).toHaveBeenCalledTimes(1)
    expect(a.api.isAvailable('xstocks')).toBe(true)
    expect(b.api.isAvailable('xstocks')).toBe(true)
    a.scope.stop()
    expect(c.onChanged.removeListener).not.toHaveBeenCalled()
    b.scope.stop()
    expect(c.onChanged.removeListener).toHaveBeenCalledTimes(1)
  })
})

describe('defaultSubscribe', () => {
  const kur = () => {
    const dinleyiciler = []
    const onChanged = { addListener: vi.fn((f) => dinleyiciler.push(f)), removeListener: vi.fn() }
    globalThis.chrome = { storage: { onChanged } }
    const doc = { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() }
    globalThis.document = doc
    return { onChanged, doc, depo: () => dinleyiciler[0] }
  }

  it('izlenen depo anahtarlari degisince tetikler, ilgisiz anahtarlari yok sayar', () => {
    const { depo } = kur()
    const trigger = vi.fn()
    defaultSubscribe(trigger)
    for (const k of STOCK_GATE_WATCHED_KEYS) depo()({ [k]: { newValue: 1 } }, 'local')
    expect(trigger).toHaveBeenCalledTimes(STOCK_GATE_WATCHED_KEYS.length)
    trigger.mockClear()
    depo()({ theme: { newValue: 'dark' } }, 'local')
    depo()(null, 'local')
    depo()(undefined, 'session')
    expect(trigger).not.toHaveBeenCalled()
    expect([...STOCK_GATE_WATCHED_KEYS].sort()).toEqual(['stock_gate_cache', 'stock_gate_rules_cache'])
  })

  it('K32/K39: stock_declarations ve active_account olaylari tetiklemez (karar beyana ve hesaba bagli degil)', () => {
    const { depo } = kur()
    const trigger = vi.fn()
    defaultSubscribe(trigger)
    depo()({ stock_declarations: { oldValue: { 'k:k1': { bstocks: { v: 1 } } } } }, 'local')
    depo()({ active_account: { newValue: { address: '0x1' } } }, 'local')
    expect(trigger).not.toHaveBeenCalled()
    depo()({ stock_gate_rules_cache: { newValue: 1 } }, 'local')
    expect(trigger).toHaveBeenCalledTimes(1)
  })

  it('pencere yalniz GORUNUR olunca tetikler; unsubscribe ikisini de kaldirir', () => {
    const { doc, onChanged } = kur()
    const trigger = vi.fn()
    const unsubscribe = defaultSubscribe(trigger)
    const onVisible = doc.addEventListener.mock.calls[0][1]
    expect(doc.addEventListener.mock.calls[0][0]).toBe('visibilitychange')
    doc.visibilityState = 'hidden'
    onVisible()
    expect(trigger).not.toHaveBeenCalled()
    doc.visibilityState = 'visible'
    onVisible()
    expect(trigger).toHaveBeenCalledTimes(1)
    unsubscribe()
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', onVisible)
    expect(onChanged.removeListener).toHaveBeenCalledTimes(1)
  })

  it('yalin chrome nesnesi ortaminda (onChanged / document yok) firlatmaz ve calisan bir unsubscribe doner', () => {
    globalThis.chrome = { runtime: { sendMessage: vi.fn() }, storage: { local: {} } }
    const unsubscribe = defaultSubscribe(vi.fn())
    expect(typeof unsubscribe).toBe('function')
    expect(() => unsubscribe()).not.toThrow()
    delete globalThis.chrome
    expect(() => defaultSubscribe(vi.fn())()).not.toThrow()
  })
})

describe('kaynak kilitleri (yorumsuz tarama)', () => {
  const kod = yorumsuz(KAYNAK)

  it('pozitif bekci: tarama gercek kodu goruyor', () => {
    expect(kod).toContain("type: 'STOCK_GATE_STATUS'")
    expect(kod).toContain('export function createStockEligibilityStore')
    expect(kod).toContain('mySeq !== seq')
  })

  it('arayuz aynasi depoya YAZMAZ ve depodan OKUMAZ; bayrak, log, gizli anahtar ve ag cagrisi yok', () => {
    expect(kod).not.toMatch(/storage\.(local|session|sync)/)
    expect(kod).not.toMatch(/featureFlags/)
    expect(kod).not.toMatch(/console\./)
    expect(kod).not.toMatch(/privateKey|mnemonic|seed/i)
    expect(kod).not.toMatch(/\bfetch\b/)
    expect(kod).toContain('onChanged')
  })

  it('arka plan aksiyonlarindan yalniz STOCK_GATE_STATUS gonderir ve govde eklemez', () => {
    expect(kod).not.toMatch(/STOCK_GATE_(DECLARE|RESET|LIST)/)
    expect(kod).not.toMatch(/message:\s*\{/)
  })

  it('hesap ve beyan alanlari yok (K32, K39): accountId, active_account, stock_declarations kaynakta gecmez', () => {
    expect(kod).not.toContain('accountId')
    expect(kod).not.toContain('active_account')
    expect(kod).not.toContain('stock_declarations')
    expect(kod).not.toContain('declare')
  })

  it('periyodik sorgu yok: setInterval kaynakta gecmez (PE20 a)', () => {
    expect(kod).not.toMatch(/\bsetInterval\b/)
  })
})

beforeEach(() => {
  disposeStockEligibilityStore()
})

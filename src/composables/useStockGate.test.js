// useStockGate -- hisse alim kapisinin ARAYUZ AYNASI (spec 6.1), ortak uygunluk kaynaginin INCE SARMALAYICISI (Task 40).
//
// KOK NEDEN / KAPATILAN HATA:
//  Eskiden her yuzey kendi denetleyicisi ve kendi mesajiyla TEK ihracci soruyordu. Artik karar ortak kaynaktan
//  (useStockEligibility, K34) okunur; bu dosya yalniz sarmalayicinin sozlesmesini sinar:
//   - issuer null / gecersiz / enabled false: idle (kapi ACIK) ve HICBIR abonelik, mesaj, dinleyici yok (M8);
//   - yukleniyor -> checking; OK -> ok; WARN -> warn; BLOCKED -> blocked; CHECK_FAILED / sigorta -> error;
//   - RF1: hisse olmayan tokene gecen kullanici eski bir blocked ile kilitli KALMAZ (durum her okunusta ihraccidan turer).
// Bayat yanit, geri besleme, sigorta ve yeniden deneme koruma testleri useStockEligibility.test.js'tedir.
// Yetkili kapi arka plandadir; bu dosya yalniz AYNADIR, depoya yazmaz ve depodan okumaz.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { effectScope, nextTick, reactive, ref } from 'vue'

// Bu testlerde bilesen yok: onMounted kapsam icinde HEMEN calisir (SSR testlerindeki onServerPrefetch aliasinin yerine).
vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, onMounted: (fn) => { fn() } }
})

import { yorumsuz } from '../test-utils/kaynakTarama'
import { STOCK_GATE_REASONS } from '../utils/stockGate/errors'
import { GATE_ALLOWED_STATES, gateAllows, stateOfReply, useStockGate } from './useStockGate'
import { disposeStockEligibilityStore, ELIGIBILITY_FUSE_MS } from './useStockEligibility'

const KAYNAK = fs.readFileSync(fileURLToPath(new URL('./useStockGate.js', import.meta.url)), 'utf8')

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const reply = (over = {}) => ({
  decision: 'OK', reason: 'OK', ipCountry: 'DE', ...over,
})
// STOCK_GATE_STATUS yaniti: iki ihracci tek yanitta.
const both = (b = reply(), x = reply()) => ({ bstocks: b, xstocks: x })

afterEach(() => {
  disposeStockEligibilityStore()
  vi.useRealTimers()
  delete globalThis.chrome
  delete globalThis.document
})

describe('GATE_ALLOWED_STATES / gateAllows', () => {
  it('yalniz idle, ok ve warn serbest; dondurulmus', () => {
    expect(GATE_ALLOWED_STATES).toEqual(['idle', 'ok', 'warn'])
    expect(Object.isFrozen(GATE_ALLOWED_STATES)).toBe(true)
    for (const s of ['idle', 'ok', 'warn']) expect(gateAllows(s), s).toBe(true)
    for (const s of ['checking', 'blocked', 'error', undefined, null, '', 'OK']) expect(gateAllows(s), String(s)).toBe(false)
  })

  it('declare durumu yok (K32): ne izinli kumede ne de bir yanittan uretilir', () => {
    expect(GATE_ALLOWED_STATES).not.toContain('declare')
    expect(gateAllows('declare')).toBe(false)
    const eski = reply({ decision: 'DECLARATION_REQUIRED', reason: 'DECLARATION_REQUIRED' })
    expect(stateOfReply(eski)).toEqual({ state: 'error', reason: 'CHECK_FAILED', ipCountry: null })
  })
})

describe('stateOfReply', () => {
  it('3 anahtarli yanit: OK -> ok, WARN -> warn; reason null', () => {
    expect(stateOfReply(reply())).toEqual({ state: 'ok', reason: null, ipCountry: 'DE' })
    expect(stateOfReply(reply({ decision: 'WARN', reason: 'WARN_COUNTRY' }))).toMatchObject({ state: 'warn', reason: null })
  })

  it.each(STOCK_GATE_REASONS)('BLOCKED %s kume nedeni aynen tasinir', (neden) => {
    expect(stateOfReply(reply({ decision: 'BLOCKED', reason: neden }))).toMatchObject({ state: 'blocked', reason: neden })
  })

  it('BLOCKED ic nedenleri kapali kumeye indirilir (ham RULES_INVALID arayuze cikmaz)', () => {
    const neden = (reason) => stateOfReply(reply({ decision: 'BLOCKED', reason })).reason
    expect(neden('RULES_INVALID')).toBe('CHECK_FAILED')
    expect(neden('ISSUER_UNKNOWN')).toBe('CHECK_FAILED')
    expect(neden('bogus')).toBe('CHECK_FAILED')
    expect(neden(undefined)).toBe('CHECK_FAILED')
    expect(neden('ALREADY_BLOCKED')).toBe('CHECK_FAILED')
    expect(neden('US_PERSON')).toBe('CHECK_FAILED')
  })

  it('gecersiz / reddedilen yanit error + CHECK_FAILED olur ve asla firlatmaz', () => {
    const hostile = { get decision() { throw new Error('getter patladi') } }
    for (const bozuk of [null, undefined, 'x', 42, true, [], {}, { decision: 'MAYBE' }, { error: 'x' }, { decision: 'ok' }, hostile]) {
      expect(stateOfReply(bozuk), String(bozuk)).toMatchObject({ state: 'error', reason: 'CHECK_FAILED' })
    }
  })

  it('cikti TAM 3 anahtar tasir (state, reason, ipCountry); eski alanlar ve ham hesap nesnesi arayuze gecmez', () => {
    const out = stateOfReply({ ...reply(), account: { privateKey: '0xgizli' }, accountId: 'k:abc', action: 'DECLARE', country: 'DE', stale: true, extra: 1 })
    expect(Object.keys(out).sort()).toEqual(['ipCountry', 'reason', 'state'])
    expect(JSON.stringify(out)).not.toContain('gizli')
  })

  it('ulke kodu temizlenir', () => {
    expect(stateOfReply(reply({ ipCountry: 'tr' }))).toMatchObject({ state: 'ok', ipCountry: null })
    expect(stateOfReply(reply({ ipCountry: 12 }))).toMatchObject({ ipCountry: null })
    expect(stateOfReply(reply({ ipCountry: 'TR' }))).toMatchObject({ ipCountry: 'TR' })
    expect(stateOfReply(reply({ decision: 'BLOCKED', reason: 'COUNTRY_UNKNOWN', ipCountry: null }))).toEqual({ state: 'blocked', reason: 'COUNTRY_UNKNOWN', ipCountry: null })
  })
})


const kur = (issuerSource, opts, handler) => {
  const calls = []
  const sendMessage = vi.fn(handler ?? ((m) => new Promise((resolve) => { calls.push({ m, resolve }) })))
  globalThis.chrome = { runtime: { sendMessage } }
  const scope = effectScope()
  const gate = scope.run(() => useStockGate(issuerSource, opts))
  return { gate, calls, scope, sendMessage }
}
const yanitli = (yanit) => async () => yanit

describe('useStockGate sarmalayici -- durum eslemesi', () => {
  it('useStockGate sarmalayici: issuerSource null -> idle ve acquire YOK (mesaj yok, dinleyici yok); anahtar kumesi sozlesmeyle ayni', async () => {
    const onChanged = { addListener: vi.fn(), removeListener: vi.fn() }
    const { gate, scope, sendMessage } = kur(ref(null))
    globalThis.chrome.storage = { onChanged }
    await nextTick()
    await flush()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(onChanged.addListener).not.toHaveBeenCalled()
    expect(gate.state.value).toBe('idle')
    expect(gate.reason.value).toBeNull()
    expect(gate.allowed.value).toBe(true)
    expect(Object.keys(gate).sort()).toEqual(['allowed', 'ipCountry', 'reason', 'refresh', 'state'])
    await gate.refresh()
    expect(sendMessage).not.toHaveBeenCalled()
    scope.stop()
  })

  it('gecersiz ihracci (dogecoin, __proto__, dizi) da idle: abonelik yok', async () => {
    for (const bozuk of ['dogecoin', '__proto__', 'constructor', 'BSTOCKS', '', 42, {}, []]) {
      const { gate, scope, sendMessage } = kur(bozuk)
      await flush()
      expect(sendMessage, String(bozuk)).not.toHaveBeenCalled()
      expect(gate.state.value, String(bozuk)).toBe('idle')
      expect(gate.allowed.value, String(bozuk)).toBe(true)
      scope.stop()
    }
  })

  it('OK -> ok (allowed true), WARN -> warn (allowed true); reason null', async () => {
    const a = kur('bstocks', undefined, yanitli(both(reply({ ipCountry: 'DE' }))))
    await flush()
    expect(a.gate.state.value).toBe('ok')
    expect(a.gate.reason.value).toBeNull()
    expect(a.gate.ipCountry.value).toBe('DE')
    expect(a.gate.allowed.value).toBe(true)
    a.scope.stop()
    disposeStockEligibilityStore()
    const b = kur('xstocks', undefined, yanitli(both(reply(), reply({ decision: 'WARN', reason: 'WARN_COUNTRY', ipCountry: 'TR' }))))
    await flush()
    expect(b.gate.state.value).toBe('warn')
    expect(b.gate.reason.value).toBeNull()
    expect(b.gate.allowed.value).toBe(true)
    b.scope.stop()
  })

  it.each([
    ['COUNTRY_UNKNOWN', null],
    ['IP_COUNTRY_ISSUER', 'TR'],
    ['IP_COUNTRY_PRECAUTION', 'DE'],
    ['KILL_SWITCH', null],
  ])('BLOCKED/%s -> blocked ve neden aynen tasinir (allowed false)', async (neden, ulke) => {
    expect(STOCK_GATE_REASONS).toContain(neden)
    const { gate, scope } = kur('bstocks', undefined, yanitli(both(reply({ decision: 'BLOCKED', reason: neden, ipCountry: ulke }))))
    await flush()
    expect(gate.state.value).toBe('blocked')
    expect(gate.reason.value).toBe(neden)
    expect(gate.ipCountry.value).toBe(ulke)
    expect(gate.allowed.value).toBe(false)
    scope.stop()
  })

  it('kume disi BLOCKED nedeni (ham RULES_INVALID) arayuze cikmaz: CHECK_FAILED olur', async () => {
    const { gate, scope } = kur('bstocks', undefined, yanitli(both(reply({ decision: 'BLOCKED', reason: 'RULES_INVALID', ipCountry: null }))))
    await flush()
    expect(gate.allowed.value).toBe(false)
    expect(gate.reason.value).toBe('CHECK_FAILED')
    scope.stop()
  })

  it('CHECK_FAILED (gercek yanit) -> error ve reason CHECK_FAILED, allowed false', async () => {
    const { gate, scope } = kur('xstocks', undefined, yanitli(both(reply(), reply({ decision: 'BLOCKED', reason: 'CHECK_FAILED', ipCountry: null }))))
    await flush()
    expect(gate.state.value).toBe('error')
    expect(gate.reason.value).toBe('CHECK_FAILED')
    expect(gate.allowed.value).toBe(false)
    scope.stop()
  })

  it('yukleniyor -> checking (allowed false); yanit gelince reactive() ile acilan nesne guncellenir', async () => {
    const { gate, calls, scope } = kur('bstocks')
    await flush()
    const g = reactive(gate)
    expect(g.state).toBe('checking')
    expect(g.allowed).toBe(false)
    calls[0].resolve(both(reply({ ipCountry: 'DE' })))
    await flush()
    expect(g).toMatchObject({ state: 'ok', ipCountry: 'DE', allowed: true })
    scope.stop()
  })

  it('sigorta (5 sn yanit yok) -> error + CHECK_FAILED, allowed false; gec gelen gercek yanit durumu duzeltir', async () => {
    vi.useFakeTimers()
    const { gate, calls, scope } = kur('bstocks')
    await vi.advanceTimersByTimeAsync(ELIGIBILITY_FUSE_MS)
    expect(gate.state.value).toBe('error')
    expect(gate.reason.value).toBe('CHECK_FAILED')
    expect(gate.allowed.value).toBe(false)
    calls[0].resolve(both(reply()))
    await vi.advanceTimersByTimeAsync(0)
    expect(gate.state.value).toBe('ok')
    expect(gate.allowed.value).toBe(true)
    scope.stop()
  })

  it('GATE_ALLOWED_STATES = idle|ok|warn (sarmalayici durumlari bu kumeyle ayni sonucu verir)', async () => {
    expect(GATE_ALLOWED_STATES).toEqual(['idle', 'ok', 'warn'])
    const { gate, scope } = kur('bstocks', undefined, yanitli(both()))
    await flush()
    expect(gate.allowed.value).toBe(gateAllows(gate.state.value))
    scope.stop()
  })
})

describe('useStockGate sarmalayici -- kaynak ve yarislar', () => {
  it('issuer secilince TEK govdesiz STATUS sorulur; ihracci degisince YENI mesaj YOK (tek yanit iki ihracciyi tasir)', async () => {
    const issuer = ref('bstocks')
    const { gate, calls, scope } = kur(issuer)
    await flush()
    expect(calls).toHaveLength(1)
    expect(calls[0].m).toEqual({ type: 'STOCK_GATE_STATUS' })
    calls[0].resolve(both(reply({ decision: 'BLOCKED', reason: 'KILL_SWITCH', ipCountry: null }), reply({ decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER', ipCountry: 'KP' })))
    await flush()
    const g = reactive(gate)
    expect(g).toMatchObject({ state: 'blocked', reason: 'KILL_SWITCH', allowed: false })
    issuer.value = 'xstocks'
    await nextTick()
    expect(calls).toHaveLength(1)
    expect(g).toMatchObject({ state: 'blocked', reason: 'IP_COUNTRY_ISSUER', ipCountry: 'KP', allowed: false })
    scope.stop()
  })

  it('RF1 (sarmalayici): issuer null a donunce eski blocked yaniti gelse de allowed true KALIR ve yeni mesaj yok', async () => {
    const issuer = ref('bstocks')
    const { gate, calls, scope } = kur(issuer)
    await flush()
    issuer.value = null
    await nextTick()
    calls[0].resolve(both(reply({ decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER' })))
    await flush()
    expect(gate.state.value).toBe('idle')
    expect(gate.reason.value).toBeNull()
    expect(gate.allowed.value).toBe(true)
    expect(calls).toHaveLength(1)
    scope.stop()
  })

  it('hisse olmayan cikti hisseye donunce kapi yeniden kilitlenir (idle -> kararin kendisi)', async () => {
    const issuer = ref(null)
    const { gate, sendMessage, scope } = kur(issuer, undefined, async () => both(reply({ decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER' })))
    await flush()
    expect(sendMessage).not.toHaveBeenCalled()
    issuer.value = 'bstocks'
    await nextTick()
    await flush()
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(gate.state.value).toBe('blocked')
    expect(gate.allowed.value).toBe(false)
    scope.stop()
  })

  it('getter, dize ve enabled=false kaynaklari', async () => {
    const a = kur(() => 'bstocks')
    await flush()
    expect(a.calls).toHaveLength(1)
    a.scope.stop()
    disposeStockEligibilityStore()
    const b = kur('xstocks')
    await flush()
    expect(b.calls).toHaveLength(1)
    b.scope.stop()
    disposeStockEligibilityStore()
    const c = kur(ref('bstocks'), { enabled: false })
    await nextTick()
    await flush()
    expect(c.calls).toHaveLength(0)
    expect(c.gate.state.value).toBe('idle')
    c.scope.stop()
  })

  it('enabled getter reaktif: true olunca abone olur ve sorar, false olunca idle', async () => {
    const acik = ref(false)
    const { gate, calls, scope } = kur(ref('bstocks'), { enabled: () => acik.value })
    await flush()
    expect(calls).toHaveLength(0)
    acik.value = true
    await nextTick()
    expect(calls).toHaveLength(1)
    expect(gate.state.value).toBe('checking')
    acik.value = false
    await nextTick()
    expect(gate.state.value).toBe('idle')
    scope.stop()
  })

  it('kapsam kapaninca gec yanit durumu degistirmez; refresh() mesaj atmaz', async () => {
    const { gate, calls, scope, sendMessage } = kur(ref('bstocks'))
    await flush()
    scope.stop()
    calls[0].resolve(both(reply({ decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER' })))
    await flush()
    gate.refresh()
    await flush()
    expect(gate.state.value).toBe('checking')
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('refresh() abone iken yeniden sorar', async () => {
    const { gate, calls, scope } = kur(ref('bstocks'))
    await flush()
    calls[0].resolve(both())
    await flush()
    const p = gate.refresh()
    await flush()
    expect(calls).toHaveLength(2)
    calls[1].resolve(both(reply({ decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER' })))
    await p
    expect(gate.state.value).toBe('blocked')
    scope.stop()
  })

  it('chrome.storage.onChanged olmayan ortamda (yalin chrome nesnesi) kurulum firlatmaz', async () => {
    globalThis.chrome = { runtime: { sendMessage: vi.fn(async () => both()) }, storage: { local: {} } }
    const scope = effectScope()
    let gate
    expect(() => { gate = scope.run(() => useStockGate(ref('bstocks'))) }).not.toThrow()
    await flush()
    expect(gate.state.value).toBe('ok')
    scope.stop()
  })

  it('chrome hic yoksa error + CHECK_FAILED (kapi acik KALMAZ)', async () => {
    delete globalThis.chrome
    const scope = effectScope()
    const gate = scope.run(() => useStockGate(ref('bstocks')))
    await flush()
    expect(gate.state.value).toBe('error')
    expect(gate.reason.value).toBe('CHECK_FAILED')
    expect(gate.allowed.value).toBe(false)
    scope.stop()
  })
})

describe('kaynak kilitleri (yorumsuz tarama)', () => {
  const kod = yorumsuz(KAYNAK)

  it('pozitif bekci: tarama gercek kodu goruyor; sarmalayici ortak kaynaktan okur', () => {
    expect(kod).toContain('export function useStockGate')
    expect(kod).toContain('useStockEligibility(')
    expect(kod).toContain('verdictOf(')
  })

  it('denetleyici ve kendi mesaji SILINDI: createStockGateController, defaultSubscribe, sendMessage kaynakta gecmez', () => {
    expect(kod).not.toContain('createStockGateController')
    expect(kod).not.toContain('defaultSubscribe')
    expect(kod).not.toContain('STOCK_GATE_STATUS')
    expect(kod).not.toMatch(/sendMessage/)
  })

  it('arayuz aynasi depoya YAZMAZ ve depodan OKUMAZ; bayrak, log ve gizli anahtar yok', () => {
    expect(kod).not.toMatch(/storage\.(local|session|sync)/)
    expect(kod).not.toMatch(/featureFlags/)
    expect(kod).not.toMatch(/console\./)
    expect(kod).not.toMatch(/privateKey|mnemonic|seed/i)
  })

  it('eylem ve hesap alanlari yok (K32, K39): GATE_ACTIONS, accountId, country, stale kaynakta gecmez', () => {
    expect(kod).not.toContain('GATE_ACTIONS')
    expect(kod).not.toContain('accountId')
    expect(kod).not.toContain('stale')
    expect(kod).not.toContain('action')
    expect(kod).not.toContain('country')
    expect(kod).not.toContain('declare')
  })

  it('stateOfReply saf cevirim olarak disa aktarilmaya DEVAM eder (testler dogrudan sinar)', () => {
    expect(typeof stateOfReply).toBe('function')
    expect(kod).toMatch(/export function stateOfReply/)
  })
})

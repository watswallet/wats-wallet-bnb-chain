// useStockEligibilityMock.js (yuzey SSR testlerinin ortak useStockEligibility sahtesi) gercek kancanin ANLAMINI tasir.
//
// KOK NEDEN / KAPATILAN HATA (Bolum 2: ihracci kumesi acik): sahte sabit iki ihracci listesine (bstocks, xstocks) baglanirsa
// yeni ihraccilar (coinbase, ...) icin yuzey testleri gercek kancada OLMAYAN bir davranisa karsi yesil kalir. Gercek kanca
// uyeligi durum YANITINDAN okur (Object.hasOwn); sahte de ayni: yanitta olan ihracci karar alir, olmayan (bicimi gecerli olsa
// da) karari olmayan ve musait olmayan sayilir; miras ad ('constructor') ihracci degildir.
import { describe, it, expect, afterEach } from 'vitest'
import {
  createUseStockEligibilityMock, eligibilityMock, resetEligibilityMock, ELIGIBILITY_ALL, ELIGIBILITY_LOADING,
} from './useStockEligibilityMock'

const OK = Object.freeze({ decision: 'OK', reason: 'OK', ipCountry: null })
const WARN = Object.freeze({ decision: 'WARN', reason: 'WARN_COUNTRY', ipCountry: 'DE' })
const BLOCKED = Object.freeze({ decision: 'BLOCKED', reason: 'IP_COUNTRY_PRECAUTION', ipCountry: 'US' })
const kanca = () => createUseStockEligibilityMock({}).useStockEligibility()

afterEach(() => resetEligibilityMock())

describe('useStockEligibilityMock -- tablo-gudumlu uyelik', () => {
  it('varsayilan senaryo (ELIGIBILITY_ALL): bstocks + xstocks musait, availableIssuers iki ihracci', () => {
    const api = kanca()
    expect(api.isAvailable('bstocks')).toBe(true)
    expect(api.isAvailable('xstocks')).toBe(true)
    expect(api.availableIssuers.value).toEqual(['bstocks', 'xstocks'])
    expect(api.anyAvailable.value).toBe(true)
  })

  it('yanittaki ek ihracci (coinbase) karar alir; yanitta olmayan (ondo, foo) null ve musait degil', () => {
    eligibilityMock.scenario = Object.freeze({ ready: true, verdicts: Object.freeze({ bstocks: OK, xstocks: BLOCKED, coinbase: WARN }) })
    const api = kanca()
    expect(api.verdictOf('coinbase')).toEqual(WARN)
    expect(api.isAvailable('coinbase')).toBe(true)
    expect(api.warnOf('coinbase')).toBe(true)
    for (const yok of ['ondo', 'foo']) {
      expect(api.verdictOf(yok), yok).toBeNull()
      expect(api.isAvailable(yok), yok).toBe(false)
    }
    expect(api.availableIssuers.value).toEqual(['bstocks', 'coinbase'])
  })

  it("miras ad ('constructor') ve dize olmayan girdi yanitta olmadikca null (Object.hasOwn)", () => {
    const api = kanca()
    for (const bozuk of ['constructor', '__proto__', 'toString', 42, null, undefined, {}]) {
      expect(api.verdictOf(bozuk), String(bozuk)).toBeNull()
      expect(api.isAvailable(bozuk), String(bozuk)).toBe(false)
    }
  })

  it('yuklenirken (ready false) hicbir ihracci musait degil ve availableIssuers bos (yukleme = gizli)', () => {
    eligibilityMock.scenario = ELIGIBILITY_LOADING
    const api = kanca()
    expect(api.ready.value).toBe(false)
    expect(api.verdictOf('bstocks')).toBeNull()
    expect(api.availableIssuers.value).toEqual([])
    expect(api.anyAvailable.value).toBe(false)
    eligibilityMock.scenario = ELIGIBILITY_ALL // pozitif bekci: senaryo degisince ayni kanca musait gorur (reaktif)
    expect(api.availableIssuers.value).toEqual(['bstocks', 'xstocks'])
  })
})

// Ilk alim kapisi: kural tablosu dogrulayicisi ve secici (rules.js).
//
// KOK NEDEN / KAPATILAN HATA: "en yuksek surum kazanir" kurali TEK BASINA tehlikelidir. Sema acisindan
// gecerli ama icerigi gevsek / hatali bir tablo (ABD'siz, ucu `UK` kodlu, `2062-10-16.1` surumlu) bir kez
// kalici onbellege girerse gomulu kopyanin daha siki icerigini ezer ve hicbir mesru guncelleme onu gecemez.
// Bu yuzden dogrulamasi gecmeyen tablo BUTUNUYLE yok sayilir; anlamsal taban (cekirdek engel kodlari) ve
// surum tarihi makullugu (bugun + 30 gun) zorunludur. Bu dosya (1) her reddetme sinifini, (2) "yuzde esigi
// YOK" kararini (AB gibi bir grup bilincle cikarilabilir), (3) surum karsilastirmasinin SAYISAL oldugunu
// ('.9' < '.10'), (4) pickRules secimini ve (5) RF5'i kilitler: istemci saati sunucu tablosunun tarihinden
// >30 gun geride ise tablo SESSIZCE reddedilir, kapi cokmez, gomulu / kalici kopya kullanilir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { rulesFixture, bumpVersion, versionNoonMs } from '../../test-utils/stockGateFixtures'
import { BUNDLED_ELIGIBILITY_RULES as BUNDLED } from '../../data/eligibilityRules'
import * as RULES from './rules'
import {
  REQUIRED_ISSUERS, ISSUER_NAME_RE, CORE_BLOCK, VERSION_RE, isValidIssuer, validateRules, compareRulesVersion, pickRules,
  effectiveBlocked, issuerListed, issuerKeysOf,
} from './rules'

const here = dirname(fileURLToPath(import.meta.url))
const DAY_MS = 24 * 60 * 60 * 1000
// Tablo gunu gomulu surumden TURETILIR (sabit tarih YOK, PE17): gun baslangici UTC.
const [TY, TM, TD] = BUNDLED.version.split('.')[0].split('-').map(Number)
const TABLE_DAY = Date.UTC(TY, TM - 1, TD)
const EU27 = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' ')

const bad = (fn) => {
  const r = rulesFixture()
  fn(r)
  return r
}
const expectErr = (rules, error, opts) => expect(validateRules(rules, opts)).toEqual({ ok: false, error })
// Bolum 2: tablo alti ihracci tasir (zorunlu iki + ek dort); dogrulayici her birine ayni kurallari uygular
const TABLE_ISSUERS = Object.keys(BUNDLED.issuers)
const NEW_ISSUERS = ['coinbase', 'ondo', 'robinhood', 'st0x']
// `__proto__` tablo anahtari YALNIZ kendi ozelligi olarak (defineProperty / JSON.parse govdesi) anahtar uretir
const ownProto = (issuers, value) => Object.defineProperty(issuers, '__proto__', {
  value, enumerable: true, configurable: true, writable: true,
})

describe('sabitler', () => {
  it('REQUIRED_ISSUERS ve CORE_BLOCK tam ve donuk', () => {
    expect(REQUIRED_ISSUERS).toEqual(['bstocks', 'xstocks'])
    expect(CORE_BLOCK).toEqual(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'KP', 'IR'])
    expect(Object.isFrozen(REQUIRED_ISSUERS)).toBe(true)
    expect(Object.isFrozen(CORE_BLOCK)).toBe(true)
    expect(() => CORE_BLOCK.push('TR')).toThrow(TypeError)
    expect(() => REQUIRED_ISSUERS.push('ondo')).toThrow(TypeError)
  })

  // Gecis bitti (Gorev 3): `ISSUERS` takma adi silindi; zorunlu kume yalniz REQUIRED_ISSUERS adiyla disa aktarilir.
  it('ISSUERS takma adi KALKTI: rules.js yalniz REQUIRED_ISSUERS i disa aktarir', () => {
    expect('ISSUERS' in RULES).toBe(false)
    expect(RULES.REQUIRED_ISSUERS).toBe(REQUIRED_ISSUERS)
  })

  it('issuerKeysOf: gecerli tabloda tam tablonun anahtarlari (once zorunlu iki); bozuk / eksik girdide yalniz zorunlu iki, firlatmaz', () => {
    expect(issuerKeysOf(BUNDLED)).toEqual([...REQUIRED_ISSUERS, ...NEW_ISSUERS])
    expect([...issuerKeysOf(BUNDLED)].sort()).toEqual([...TABLE_ISSUERS].sort())
    expect(issuerKeysOf(rulesFixture({ issuers: { dogecoin: { buyEnabled: true, blocked: [], warn: [] } } }))).toContain('dogecoin')
    for (const bozuk of [null, undefined, 42, 'x', [], {}, { issuers: null }, { issuers: [] }, { issuers: 'x' }]) {
      expect(issuerKeysOf(bozuk), String(bozuk)).toEqual(['bstocks', 'xstocks'])
    }
    // bicimi gecersiz anahtar elenir; getter tuzagi firlatmaz
    expect(issuerKeysOf({ issuers: { Dogecoin: {}, ondo: {}, '__proto__x': {} } })).toEqual(['bstocks', 'xstocks', 'ondo'])
    expect(issuerKeysOf({ get issuers() { throw new Error('tuzak') } })).toEqual(['bstocks', 'xstocks'])
    expect(Object.isFrozen(issuerKeysOf(BUNDLED))).toBe(false) // her cagri YENI dizi: cagiran REQUIRED_ISSUERS i bozamaz
    expect(issuerKeysOf(BUNDLED)).not.toBe(REQUIRED_ISSUERS)
  })

  it('ISSUER_NAME_RE: /^[a-z0-9-]{2,32}$/ (sunucu ile ayni kural)', () => {
    expect(ISSUER_NAME_RE.source).toBe('^[a-z0-9-]{2,32}$')
    for (const ad of ['bstocks', 'xstocks', 'ondo', 'coinbase', 'robinhood', 'st0x', 'ab', 'a'.repeat(32), 'a-b']) {
      expect(ISSUER_NAME_RE.test(ad), ad).toBe(true)
    }
    for (const ad of ['Foo', 'a', '', '__proto__', 'a_b', 'a b', 'a'.repeat(33), 'dogeCoin']) {
      expect(ISSUER_NAME_RE.test(ad), ad).toBe(false)
    }
  })

  it('VERSION_RE', () => {
    expect(VERSION_RE.test('2026-10-16.1')).toBe(true)
    expect(VERSION_RE.test('2026-10-16.10')).toBe(true)
    for (const v of ['2026-10-16', '2026-10-16.', '2026-10-16.x', '26-10-16.1', ' 2026-10-16.1']) {
      expect(VERSION_RE.test(v), v).toBe(false)
    }
  })

  it('isValidIssuer: yalniz BICIM kontrolu (string + /^[a-z0-9-]{2,32}$/); tabloya BAKMAZ', () => {
    for (const x of ['bstocks', 'xstocks', 'ondo', 'coinbase', 'robinhood', 'st0x', 'dogecoin', 'a-b']) {
      expect(isValidIssuer(x), x).toBe(true) // 'dogecoin' tabloda yok ama bicimi gecerli: uyelik kontrolu decide / yardimcilarin isi
    }
    for (const x of ['Dogecoin', '__proto__', 'toString', 'hasOwnProperty', 'BSTOCKS', 'a', '', 'a'.repeat(33), 'a_b', null, undefined, 5, {}, ['bstocks']]) {
      expect(isValidIssuer(x), String(x)).toBe(false)
    }
  })
})

describe('validateRules -- gecerli tablolar', () => {
  it('gomulu tablo gecerli (pozitif bekci)', () => {
    expect(validateRules(BUNDLED)).toEqual({ ok: true })
  })

  it('rulesFixture() gecerli ve donuk degil', () => {
    const r = rulesFixture()
    expect(validateRules(r)).toEqual({ ok: true })
    expect(Object.isFrozen(r)).toBe(false)
  })

  it('AB gibi bir grubu cikaran ama cekirdegi koruyan tablo KABUL (yuzde esigi YOK, K9)', () => {
    const r = bad((x) => {
      x.common.precaution = x.common.precaution.filter((c) => !EU27.includes(c))
      x.issuers.bstocks.blocked = x.issuers.bstocks.blocked.filter((c) => !EU27.includes(c))
      x.issuers.xstocks.blocked = x.issuers.xstocks.blocked.filter((c) => !EU27.includes(c))
    })
    expect(effectiveBlocked(r, 'bstocks').size).toBeLessThan(effectiveBlocked(BUNDLED, 'bstocks').size)
    expect(validateRules(r)).toEqual({ ok: true })
  })

  it('daha cok ulke ekleyen tablo ve buyEnabled:false tablo KABUL (acil durdurma gecerli bir tablodur)', () => {
    // "TR yi xStocks icin blocked a tasimak" tek satir degisimdir (spec 3.3). K43: gomulu uyari listesi artik BOS, bu yuzden
    // TR yi blocked a eklemek tek basina gecerli; TR hem blocked hem warn da (eski, uyari listesi dolu tablo) ise OVERLAP
    expect(validateRules(bad((x) => { x.issuers.xstocks.blocked.push('TR'); x.issuers.xstocks.warn = [] }))).toEqual({ ok: true })
    expect(validateRules(bad((x) => { x.issuers.xstocks.blocked.push('TR') }))).toEqual({ ok: true })
    expectErr(bad((x) => { x.issuers.xstocks.warn = ['TR']; x.issuers.xstocks.blocked.push('TR') }), 'OVERLAP')
    expect(validateRules(rulesFixture({ issuers: { bstocks: { buyEnabled: false } } }))).toEqual({ ok: true })
  })
})

describe('validateRules -- sema', () => {
  it.each([
    ['eksik ihracci (xstocks yok)', (r) => { delete r.issuers.xstocks }, 'ISSUERS'],
    ['eksik ihracci (bstocks yok)', (r) => { delete r.issuers.bstocks }, 'ISSUERS'],
    ['yalniz ek ihraccilar (bstocks ve xstocks yok)', (r) => { delete r.issuers.bstocks; delete r.issuers.xstocks }, 'ISSUERS'],
    ['ek ihracci buyuk harfli (Foo)', (r) => { r.issuers.Foo = structuredClone(r.issuers.bstocks) }, 'ISSUERS'],
    ['ek ihracci tek karakter (a)', (r) => { r.issuers.a = structuredClone(r.issuers.bstocks) }, 'ISSUERS'],
    ['ek ihracci 33 karakter', (r) => { r.issuers['a'.repeat(33)] = structuredClone(r.issuers.bstocks) }, 'ISSUERS'],
    ['ek ihracci alt cizgili (foo_bar)', (r) => { r.issuers.foo_bar = structuredClone(r.issuers.bstocks) }, 'ISSUERS'],
    ['ek ihracci bos anahtar', (r) => { r.issuers[''] = structuredClone(r.issuers.bstocks) }, 'ISSUERS'],
    ['ek ihracci __proto__ (kendi ozelligi)', (r) => { ownProto(r.issuers, structuredClone(r.issuers.bstocks)) }, 'ISSUERS'],
    ['ek ihracci sekilsiz (FIELDS, ISSUERS degil)', (r) => { r.issuers.Foo = { buyEnabled: true } }, 'FIELDS'],
    ['ek ust anahtar', (r) => { r.extra = 1 }, 'SHAPE'],
    ['version yok', (r) => { delete r.version }, 'SHAPE'],
    ['common dizi', (r) => { r.common = [] }, 'SHAPE'],
    ['issuers dizi', (r) => { r.issuers = [] }, 'SHAPE'],
    ['ihraccida ek alan', (r) => { r.issuers.bstocks.extra = 1 }, 'FIELDS'],
    ['ihraccida alan eksik (warn yok)', (r) => { delete r.issuers.xstocks.warn }, 'FIELDS'],
    ['buyEnabled dize', (r) => { r.issuers.bstocks.buyEnabled = 'true' }, 'FIELDS'],
    ['common ek anahtar', (r) => { r.common.extra = [] }, 'FIELDS'],
    ['precaution dizi degil', (r) => { r.common.precaution = 'US' }, 'FIELDS'],
    ['blocked dizi degil', (r) => { r.issuers.bstocks.blocked = null }, 'FIELDS'],
  ])('%s -> %s', (_ad, bozma, kod) => {
    expectErr(bad(bozma), kod)
  })

  it('ek ihracci: iyi bicimli ad (kucuk harf / rakam / tire, 2-32) KABUL, sunucudaki kuralla ayni', () => {
    expect(TABLE_ISSUERS.length).toBeGreaterThan(REQUIRED_ISSUERS.length) // pozitif bekci: gomulu tabloda ek ihracci var
    for (const ad of ['foo', 'sema', 'dogecoin', 'ab', 'a'.repeat(32), 'st0x', 'a-b', '-a', '00']) {
      expect(validateRules(bad((r) => { r.issuers[ad] = structuredClone(r.issuers.bstocks) })), ad).toEqual({ ok: true })
    }
  })

  it('ek ihracci: kod / tekrar / cakisma kurallari ona da uygulanir (CODES / DUPLICATE / OVERLAP)', () => {
    expectErr(bad((r) => { r.issuers.ondo.blocked = ['tr'] }), 'CODES')
    expectErr(bad((r) => { r.issuers.ondo.warn = ['ZZ'] }), 'CODES') // ISO listesinde yok (istemci farki)
    expectErr(bad((r) => { r.issuers.foo = { buyEnabled: true, blocked: ['TR', 'TR'], warn: [] } }), 'DUPLICATE')
    expectErr(bad((r) => { r.issuers.ondo.blocked = ['TR']; r.issuers.ondo.warn = ['TR'] }), 'OVERLAP')
    expectErr(bad((r) => { r.issuers.ondo.warn = ['DE'] }), 'OVERLAP') // yalniz ortak ihtiyatla kesisir
    expect(validateRules(bad((r) => { r.issuers.ondo.blocked = ['TR'] }))).toEqual({ ok: true })
  })
})

describe('validateRules -- textVersion kalkti (K40)', () => {
  it('rules: textVersion tasiyan eski sekil BUTUNUYLE reddedilir (her ihracci, her deger)', () => {
    for (const issuer of TABLE_ISSUERS) {
      for (const value of [1, 0, 1.5, '1', null]) {
        expectErr(bad((r) => { r.issuers[issuer].textVersion = value }), 'FIELDS')
      }
    }
    // Eski sekil tum tabloyu dusurur: pickRules gomuluyu secer, eski sekilli yuksek surumlu aday kazanmaz.
    const eski = bad((r) => {
      r.version = bumpVersion(BUNDLED.version, 1)
      for (const issuer of TABLE_ISSUERS) r.issuers[issuer].textVersion = 1
    })
    expect(pickRules([eski, BUNDLED], { now: versionNoonMs(BUNDLED.version) })).toBe(BUNDLED)
  })

  it('rules: yeni sekil kabul edilir (cekirdek taban + surum tarihi <= now + 30 gun)', () => {
    for (const issuer of TABLE_ISSUERS) {
      expect(Object.keys(BUNDLED.issuers[issuer]).sort()).toEqual(['blocked', 'buyEnabled', 'warn'])
    }
    expect(validateRules(BUNDLED, { now: TABLE_DAY })).toEqual({ ok: true })
    for (const issuer of TABLE_ISSUERS) {
      const set = effectiveBlocked(BUNDLED, issuer)
      for (const code of CORE_BLOCK) expect(set.has(code), `${issuer} ${code}`).toBe(true)
    }
    // Surum tarihi siniri: now + 30 gun kabul, + 31 gun VERSION_FUTURE.
    expect(validateRules(BUNDLED, { now: TABLE_DAY - 30 * DAY_MS })).toEqual({ ok: true })
    expectErr(BUNDLED, 'VERSION_FUTURE', { now: TABLE_DAY - 31 * DAY_MS })
  })
})

describe('validateRules -- kodlar, tekrar, cakisma', () => {
  it.each([
    ['kucuk harf', (r) => { r.issuers.xstocks.warn = ['tr'] }],
    ['uc harf', (r) => { r.common.precaution.push('USA') }],
    ['sayi', (r) => { r.common.precaution.push(5) }],
    ['bos dize', (r) => { r.issuers.bstocks.blocked.push('') }],
    ['UK (ISO listesinde YOK; GB olmali)', (r) => { r.common.precaution.push('UK') }],
    ['ISO listesinde olmayan iki harf (ZZ)', (r) => { r.issuers.bstocks.blocked.push('ZZ') }],
  ])('kod: %s -> CODES', (_ad, bozma) => {
    expectErr(bad(bozma), 'CODES')
  })

  it('XK (Kosova) listede oldugu icin KABUL', () => {
    expect(validateRules(bad((r) => { r.issuers.bstocks.blocked.push('XK') }))).toEqual({ ok: true })
  })

  it.each([
    ['ortak ihtiyatta tekrar', (r) => { r.common.precaution.push('US') }],
    ['bStocks blocked icinde tekrar', (r) => { r.issuers.bstocks.blocked.push('TR') }],
    ['xStocks warn icinde tekrar', (r) => { r.issuers.xstocks.warn = ['TR', 'TR'] }],
  ])('tekrar: %s -> DUPLICATE', (_ad, bozma) => {
    expectErr(bad(bozma), 'DUPLICATE')
  })

  it.each([
    ['warn ihracci blocked ile kesisir (bStocks FR)', (r) => { r.issuers.bstocks.warn = ['FR'] }],
    ['warn yalniz ortak ihtiyatla kesisir (xStocks DE)', (r) => { r.issuers.xstocks.warn.push('DE') }],
  ])('%s -> OVERLAP', (_ad, bozma) => {
    expectErr(bad(bozma), 'OVERLAP')
  })
})

describe('validateRules -- cekirdek taban', () => {
  it.each(CORE_BLOCK)('%s hicbir engel listesinde yoksa -> CORE_BASE (HER ihracci ayri ayri: zorunlu iki + ek dort)', (code) => {
    const strip = (list) => list.filter((c) => c !== code)
    for (const issuer of TABLE_ISSUERS) {
      const r = bad((x) => {
        x.common.precaution = strip(x.common.precaution)
        x.issuers[issuer].blocked = strip(x.issuers[issuer].blocked)
      })
      expectErr(r, 'CORE_BASE')
    }
  })

  it.each(CORE_BLOCK)('%s yalniz bStocks / xStocks kendi listesinde kalirsa ek ihracci -> CORE_BASE (dongu tum ihraccilari gezer)', (code) => {
    const r = bad((x) => {
      x.common.precaution = x.common.precaution.filter((c) => c !== code)
      for (const issuer of REQUIRED_ISSUERS) {
        if (!x.issuers[issuer].blocked.includes(code)) x.issuers[issuer].blocked = [...x.issuers[issuer].blocked, code].sort()
      }
    })
    for (const issuer of REQUIRED_ISSUERS) expect(effectiveBlocked(r, issuer).has(code), issuer).toBe(true)
    for (const issuer of NEW_ISSUERS) expect(effectiveBlocked(r, issuer).has(code), issuer).toBe(false)
    expectErr(r, 'CORE_BASE')
  })

  it('DAHA YUKSEK surumlu ama US siz tablo reddedilir ve gomulu kazanir', () => {
    const gevsek = bad((r) => {
      r.version = bumpVersion(BUNDLED.version, 1)
      for (const list of [r.common.precaution, r.issuers.bstocks.blocked, r.issuers.xstocks.blocked]) {
        list.splice(list.indexOf('US'), 1)
      }
    })
    expectErr(gevsek, 'CORE_BASE')
    expect(pickRules([gevsek, BUNDLED], { now: TABLE_DAY })).toBe(BUNDLED)
  })
})

describe('validateRules -- surum', () => {
  it.each([
    ['sayi', 5], ['bos dize', ''], ['rastgele dize', 'x'], ['n yok', '2026-10-16'], ['n bos', '2026-10-16.'],
    ['n sayi degil', '2026-10-16.x'], ['gun 61', '2026-10-61.1'], ['30 Subat', '2026-02-30.1'], ['ay 13', '2026-13-01.1'],
    ['null', null], ['nesne', {}],
  ])('gecersiz surum (%s) -> VERSION', (_ad, version) => {
    expectErr(bad((r) => { r.version = version }), 'VERSION')
  })

  it('2062-10-16.1 -> VERSION_FUTURE', () => {
    expectErr(bad((r) => { r.version = '2062-10-16.1' }), 'VERSION_FUTURE')
  })

  it('sinir: surum gunu = now + 30 gun KABUL, + 31 gun VERSION_FUTURE', () => {
    expect(validateRules(BUNDLED, { now: TABLE_DAY - 30 * DAY_MS })).toEqual({ ok: true })
    expectErr(BUNDLED, 'VERSION_FUTURE', { now: TABLE_DAY - 31 * DAY_MS })
  })

  it('now bir Date ya da bozuk olabilir: Date kabul, bozuk deger simdiki zamana duser, firlatmaz', () => {
    expect(validateRules(BUNDLED, { now: new Date(TABLE_DAY) })).toEqual({ ok: true })
    for (const opts of [null, 5, 'x', {}, { now: 'x' }, { now: NaN }, { now: null }]) {
      expect(validateRules(BUNDLED, opts), String(opts)).toEqual({ ok: true })
    }
  })
})

describe('validateRules -- asla firlatmaz', () => {
  const dongulu = {}
  dongulu.kendisi = dongulu
  const atan = new Proxy({}, {
    get() { throw new Error('get') },
    ownKeys() { throw new Error('ownKeys') },
    getPrototypeOf() { throw new Error('proto') },
  })

  it.each([
    ['null', null], ['undefined', undefined], ['sayi', 5], ['dize', 'x'], ['bos dizi', []], ['bos nesne', {}],
    ['prototipsiz nesne', Object.create(null)], ['dongulu nesne', dongulu], ['her tuzagi firlatan Proxy', atan],
  ])('%s -> { ok:false } (SHAPE)', (_ad, deger) => {
    expect(validateRules(deger)).toEqual({ ok: false, error: 'SHAPE' })
  })

  it('girdiyi degistirmez: reddedilen tablo aynen kalir', () => {
    const r = bad((x) => { x.issuers.bstocks.warn = ['FR'] })
    const onceki = JSON.stringify(r)
    expect(validateRules(r).ok).toBe(false)
    expect(JSON.stringify(r)).toBe(onceki)
  })
})

describe('compareRulesVersion', () => {
  it('once tarih, sonra n SAYISAL: .9 < .10', () => {
    expect(compareRulesVersion('2026-10-16.9', '2026-10-16.10')).toBe(-1)
    expect(compareRulesVersion('2026-10-16.10', '2026-10-16.9')).toBe(1)
    expect(compareRulesVersion('2026-10-17.1', '2026-10-16.99')).toBe(1)
    expect(compareRulesVersion('2026-09-30.50', '2026-10-01.1')).toBe(-1)
    expect(compareRulesVersion('2026-10-16.1', '2026-10-16.1')).toBe(0)
  })

  it('basinda sifir olan n esit sayilir; cok buyuk n sayi kaybi olmadan siralanir', () => {
    expect(compareRulesVersion('2026-10-16.01', '2026-10-16.1')).toBe(0)
    expect(compareRulesVersion('2026-10-16.9007199254740993', '2026-10-16.9007199254740992')).toBe(1)
  })

  it('gecersiz dize en dusuk; iki gecersiz 0', () => {
    expect(compareRulesVersion('garip', '2026-10-16.1')).toBe(-1)
    expect(compareRulesVersion('2026-10-16.1', 'garip')).toBe(1)
    expect(compareRulesVersion(null, undefined)).toBe(0)
    expect(compareRulesVersion('x', 5)).toBe(0)
    expect(compareRulesVersion(undefined, '2026-10-16.1')).toBe(-1)
  })
})

describe('pickRules', () => {
  const higher = (v) => rulesFixture({ version: v })

  it('en yuksek surumlu GECERLI tabloyu secer (sira: kalici, sunucu, gomulu)', () => {
    const persisted = higher(bumpVersion(BUNDLED.version, 1))
    const server = higher(bumpVersion(BUNDLED.version, 2))
    expect(pickRules([persisted, server, BUNDLED], { now: TABLE_DAY })).toBe(server)
    expect(pickRules([server, persisted, BUNDLED], { now: TABLE_DAY })).toBe(server)
  })

  it('kalici onbellek sunucudan YUKSEKSE kalici kazanir (sunucu erisilemezken kalici surer)', () => {
    const persisted = higher(bumpVersion(BUNDLED.version, 4))
    expect(pickRules([persisted, null, BUNDLED], { now: TABLE_DAY })).toBe(persisted)
  })

  it('sunucu gomuluden DUSUKSE gomulu kazanir (R5)', () => {
    const eski = higher('2026-10-15.9')
    expect(pickRules([null, eski, BUNDLED], { now: TABLE_DAY })).toBe(BUNDLED)
  })

  it('esit surumde ilk aday kazanir', () => {
    const ilk = rulesFixture()
    const ikinci = rulesFixture()
    expect(pickRules([ilk, ikinci, BUNDLED], { now: TABLE_DAY })).toBe(ilk)
  })

  it('bozuk aday BUTUNUYLE yok sayilir, yuksek surumlu olsa da', () => {
    const bozuk = bad((r) => { r.version = bumpVersion(BUNDLED.version, 8); r.issuers.xstocks.warn = ['tr'] })
    expect(pickRules([bozuk, BUNDLED], { now: TABLE_DAY })).toBe(BUNDLED)
  })

  it('null / undefined / bozuk adaylar: gecerli olan kalir; hic gecerli yoksa null; dizi degilse null', () => {
    expect(pickRules([null, undefined, 5, 'x', {}, BUNDLED], { now: TABLE_DAY })).toBe(BUNDLED)
    expect(pickRules([null, undefined, {}], { now: TABLE_DAY })).toBeNull()
    expect(pickRules([], { now: TABLE_DAY })).toBeNull()
    for (const x of [null, undefined, 'x', 5, {}]) expect(pickRules(x)).toBeNull()
  })

  it('opts bozuk olsa da firlatmaz (simdiki zaman kullanilir)', () => {
    for (const opts of [undefined, null, 5, 'x']) expect(() => pickRules([BUNDLED], opts)).not.toThrow()
  })
})

// Bolum 2: sunucu eski istemcilere ayni surumle iki ihraccili PROJEKSIYON doner; eski istemci onu kalici onbellege yazar. Esit surumde
// ihracci anahtari DAHA COK olan aday kazanir (ayni surumdeki ortak satirlar birebir ayni: yalniz satir EKLER); esit sayida ilk aday.
describe('pickRules -- esit surumde en cok ihraccili aday', () => {
  const projection = (version) => {
    const r = rulesFixture({ version })
    for (const k of NEW_ISSUERS) delete r.issuers[k]
    return r
  }
  const count = (r) => Object.keys(r.issuers).length

  it('[projeksiyon@V, tam@V] ve [tam@V, projeksiyon@V] ikisi de TAM tabloyu secer', () => {
    const p = projection(BUNDLED.version)
    const f = rulesFixture({ version: BUNDLED.version })
    expect([count(p), count(f)]).toEqual([2, 6]) // pozitif bekci
    expect(pickRules([p, f], { now: TABLE_DAY })).toBe(f)
    expect(pickRules([f, p], { now: TABLE_DAY })).toBe(f)
    expect(pickRules([p, null, BUNDLED], { now: TABLE_DAY })).toBe(BUNDLED) // sakli projeksiyon + gomulu tam: gomulu
    expect(pickRules([BUNDLED, null, p], { now: TABLE_DAY })).toBe(BUNDLED)
  })

  it('esit sayida ihracci: ilk aday kazanir (bugunku davranis); iki projeksiyonda da ilki', () => {
    const a = projection(BUNDLED.version)
    const b = projection(BUNDLED.version)
    expect(pickRules([a, b], { now: TABLE_DAY })).toBe(a)
    expect(pickRules([b, a], { now: TABLE_DAY })).toBe(b)
    const f1 = rulesFixture()
    const f2 = rulesFixture()
    expect(pickRules([f1, f2, BUNDLED], { now: TABLE_DAY })).toBe(f1)
  })

  it('SURUM her zaman once gelir: daha yuksek surumlu projeksiyon, daha dusuk surumlu tam tabloyu yener', () => {
    const yeni = projection(bumpVersion(BUNDLED.version, 1))
    const eski = rulesFixture({ version: BUNDLED.version })
    expect(pickRules([eski, yeni], { now: TABLE_DAY })).toBe(yeni)
    expect(pickRules([yeni, eski], { now: TABLE_DAY })).toBe(yeni)
  })

  it('ihracci sayisi yalniz GECERLI adaylar arasinda sayilir: cok ihraccili ama gecersiz aday bir sey kazanmaz', () => {
    const p = projection(BUNDLED.version)
    const gecersiz = rulesFixture({ version: BUNDLED.version })
    gecersiz.issuers.Foo = structuredClone(gecersiz.issuers.bstocks) // ISSUERS: gecersiz, 7 anahtar
    expect(pickRules([p, gecersiz], { now: TABLE_DAY })).toBe(p)
    const kotu = rulesFixture({ version: BUNDLED.version })
    kotu.issuers.ondo.blocked = ['tr'] // CODES: gecersiz, 6 anahtar
    expect(pickRules([p, kotu], { now: TABLE_DAY })).toBe(p)
  })

  it('sayi tablonun ANAHTARLARINDAN gelir: tabloya eklenen gecerli bir ek ihracci o tabloyu one gecirir', () => {
    const f = rulesFixture({ version: BUNDLED.version })
    const g = rulesFixture({ version: BUNDLED.version, issuers: { dogecoin: { buyEnabled: true, blocked: [], warn: [] } } })
    expect(pickRules([f, g], { now: TABLE_DAY })).toBe(g)
  })
})

describe('RF5 -- istemci saati sunucu tablosunun tarihinden >30 gun geride', () => {
  // Sunucu tablosu gomuluden YENI (gelecek bir kural guncellemesi: gomulu gunun 22 gun sonrasi). Istemci saati
  // sunucu tablosundan 31 gun geri; bu hala gomulu tablonun +30 gun siniri icinde (sabit tarih YOK, PE17).
  const SERVER_DAY = TABLE_DAY + 22 * DAY_MS
  const server = rulesFixture({ version: `${new Date(SERVER_DAY).toISOString().slice(0, 10)}.1`, issuers: { xstocks: { warn: [] } } })
  const CLOCK_BEHIND = SERVER_DAY - 31 * DAY_MS

  it('taze GECERLI sunucu tablosu SESSIZCE reddedilir (VERSION_FUTURE), firlatma yok', () => {
    expect(() => validateRules(server, { now: CLOCK_BEHIND })).not.toThrow()
    expectErr(server, 'VERSION_FUTURE', { now: CLOCK_BEHIND })
  })

  it('pickRules gomuluyu doner (cokme yok); saat duzelince sunucu tablosu kabul edilir', () => {
    expect(pickRules([null, server, BUNDLED], { now: CLOCK_BEHIND })).toBe(BUNDLED)
    expect(pickRules([null, server, BUNDLED], { now: SERVER_DAY - 30 * DAY_MS })).toBe(server)
    expect(pickRules([null, server, BUNDLED], { now: SERVER_DAY })).toBe(server)
  })

  it('kalici onbellekteki gelecek tarihli tablo da ayni sekilde reddedilir, gomulu kullanilir', () => {
    expect(pickRules([server, null, BUNDLED], { now: CLOCK_BEHIND })).toBe(BUNDLED)
  })

  it('saat gomulu tablodan da >30 gun geriyse HIC aday gecmez: null (fail-closed; decide RULES_INVALID verir, cokme yok)', () => {
    expect(pickRules([server, BUNDLED], { now: TABLE_DAY - 31 * DAY_MS })).toBeNull()
  })
})

describe('effectiveBlocked ve issuerListed', () => {
  it('etkin kume boyutlari: bStocks 67, xStocks 82 (degismez); ek dort ihracci yalniz ortak ihtiyat: 59', () => {
    expect(effectiveBlocked(BUNDLED, 'bstocks').size).toBe(67)
    expect(effectiveBlocked(BUNDLED, 'xstocks').size).toBe(82)
    for (const issuer of NEW_ISSUERS) {
      expect(effectiveBlocked(BUNDLED, issuer).size, issuer).toBe(59)
      expect(issuerListed(BUNDLED, issuer, 'US'), issuer).toBe(false) // kendi listesinde yok: yalniz ihtiyat
      expect(effectiveBlocked(BUNDLED, issuer).has('US'), issuer).toBe(true)
      expect(effectiveBlocked(BUNDLED, issuer).has('TR'), issuer).toBe(false)
    }
  })

  it('kume = blocked birlesim precaution; her cagri YENI Set (disaridan bozulamaz)', () => {
    const a = effectiveBlocked(BUNDLED, 'xstocks')
    expect(a).toBeInstanceOf(Set)
    for (const c of BUNDLED.issuers.xstocks.blocked) expect(a.has(c), c).toBe(true)
    for (const c of BUNDLED.common.precaution) expect(a.has(c), c).toBe(true)
    a.add('ZZ')
    expect(effectiveBlocked(BUNDLED, 'xstocks').has('ZZ')).toBe(false)
  })

  it('Turkiye: bStocks icin engelli, xStocks icin engelli DEGIL', () => {
    expect(effectiveBlocked(BUNDLED, 'bstocks').has('TR')).toBe(true)
    expect(effectiveBlocked(BUNDLED, 'xstocks').has('TR')).toBe(false)
  })

  it('issuerListed: ihracci listesinde true, ihtiyat-yalniz false', () => {
    expect(issuerListed(BUNDLED, 'bstocks', 'TR')).toBe(true)
    expect(issuerListed(BUNDLED, 'bstocks', 'CH')).toBe(false) // yalniz ihtiyat
    expect(effectiveBlocked(BUNDLED, 'bstocks').has('CH')).toBe(true)
    expect(issuerListed(BUNDLED, 'xstocks', 'US')).toBe(true)
    expect(issuerListed(BUNDLED, 'xstocks', 'DE')).toBe(false) // AB: xStocks icin yalniz ihtiyat
  })

  it('tabloda bulunan ek ihracci (kendi blocked listesiyle) etkin kume ve issuerListed ile cozulur', () => {
    const r = rulesFixture({ issuers: { dogecoin: { buyEnabled: true, blocked: ['TR'], warn: [] } } })
    expect(validateRules(r)).toEqual({ ok: true })
    expect(effectiveBlocked(r, 'dogecoin').has('TR')).toBe(true)
    expect(effectiveBlocked(r, 'dogecoin').size).toBe(60)
    expect(issuerListed(r, 'dogecoin', 'TR')).toBe(true)
    expect(issuerListed(r, 'dogecoin', 'US')).toBe(false) // ihtiyat-yalniz
  })

  it('bilinmeyen ihracci / bozuk tablo: bos Set ve false, firlatmaz', () => {
    // 'dogecoin' ve 'constructor' bicimce gecerlidir (isValidIssuer true) ama tabloda KENDI ozelligi degil: Object.hasOwn ile sinanir
    for (const issuer of ['__proto__', 'constructor', 'dogecoin', 'Dogecoin', null, undefined, 5]) {
      expect(effectiveBlocked(BUNDLED, issuer).size, String(issuer)).toBe(0)
      expect(issuerListed(BUNDLED, issuer, 'US'), String(issuer)).toBe(false)
    }
    expect(isValidIssuer('dogecoin')).toBe(true) // pozitif bekci: bos kume bicimden degil, tabloda olmamaktan
    expect(Object.hasOwn(BUNDLED.issuers, 'dogecoin')).toBe(false)
    for (const rules of [null, undefined, {}, 'x', { common: null, issuers: {} }]) {
      expect(effectiveBlocked(rules, 'bstocks').size).toBe(0)
      expect(issuerListed(rules, 'bstocks', 'US')).toBe(false)
    }
  })
})

describe('kaynak kilitleri', () => {
  const kod = yorumsuz(readFileSync(join(here, 'rules.js'), 'utf8'))

  it('saf: yalniz data/countryCodes import eder; featureFlags / vue / chrome / fetch / console YOK', () => {
    const imports = kod.match(/^\s*import\s[^\n]*$/gm) || []
    expect(imports).toHaveLength(1)
    expect(imports[0]).toMatch(/from '\.\.\/\.\.\/data\/countryCodes'/)
    expect(kod).not.toMatch(/featureFlags|from 'vue'|\bchrome\b|\bfetch\s*\(|console\./)
    expect(kod).not.toMatch(/\bprivateKey\b/)
  })

  it('catch bloklari hata nesnesine baglanmaz', () => {
    expect(kod).not.toMatch(/catch\s*\(/)
  })
})

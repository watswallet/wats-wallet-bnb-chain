// Ilk alim kapisi: karar fonksiyonu (decide.js) -- spec 4.5 dogruluk tablosunun 25 satiri + degismezler (K32, K33).
//
// KOK NEDEN / KAPATILAN HATA: beyan kalkinca baglanti (IP) ulkesi TEK sinyaldir; kural ONCELIGI ve "ulke bilinmiyorsa
// kapali" bu kapinin guvenligidir ve sessizce bozulabilir. Ornekler: kural 2 (ulke bilinmiyor) kaldirilirsa ulkesi
// cozulemeyen kullanici engelli bir ulkeden gelse bile Al acilir (satir 3, 4, 5); acil durdurma (kural 1) ulke
// kontrolunun arkasina duserse kapali bir ihracci "ulke bilinmiyor" diye gecici kilit gorur ve kilit kalkinca
// acilir (satir 2); iyi bicimli ama bilinmeyen bir kod ('EU', 'AP', 'ZZ') engelsiz ulke sayilirsa Al acilir (satir 5);
// `warn` yerine `blocked` listesine bakilirsa uyari ulkesi sessizce kapanir ya da acilir (satir 7). Bu dosya her satiri
// `it.each` ile surer, ek olarak ORAKUL taramalar yapar (her ISO kodu x iki ihracci), fuzz ile "asla firlatmaz"i ve
// cikti anahtar kumesinin TAM uc anahtar oldugunu kilitler.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { rulesFixture, bumpVersion, versionNoonMs } from '../../test-utils/stockGateFixtures'
import { BUNDLED_ELIGIBILITY_RULES as BUNDLED } from '../../data/eligibilityRules'
import { COUNTRY_CODES } from '../../data/countryCodes'
import { effectiveBlocked, issuerListed } from './rules'
import { decideStockBuy, normalizeCountry } from './decide'

const here = dirname(fileURLToPath(import.meta.url))

// decide.js saat okumaz (R7): zaman girdiyle gelir. Test "simdisi" gomulu tablo surumunun gununun 12:00 UTC'sidir
// (sabit tarih YOK, PE17: tablo surumu yukselince +30 gun siniri sabit bir saati asmasin).
const NOW = versionNoonMs(BUNDLED.version)
const BASE = { issuer: 'xstocks', rules: BUNDLED, ipCountry: null, now: NOW }
const decide = (over = {}) => decideStockBuy({ ...BASE, ...over })
const ISSUERS = ['bstocks', 'xstocks']

const KILLED_B = rulesFixture({ issuers: { bstocks: { buyEnabled: false } } })
const KILLED_X = rulesFixture({ issuers: { xstocks: { buyEnabled: false } } })
const TR_OPEN_B = rulesFixture({ issuers: { bstocks: { blocked: BUNDLED.issuers.bstocks.blocked.filter((c) => c !== 'TR') } } })
const TR_BLOCKED_X = rulesFixture({ issuers: { xstocks: { warn: [], blocked: [...BUNDLED.issuers.xstocks.blocked, 'TR'].sort() } } })
// K43 (2026-11-14): gomulu tabloda uyari listesi BOS (Turkiye xstocks icin uyarisiz uygun). WARN kararinin kendisi ise (eski ya da
// onbellekteki, uyari listesi dolu bir tablo) hala uretilir ve UYGUN sayilir; bu fikstur o eski tabloyu temsil eder.
const WARN_TR_X = rulesFixture({ issuers: { xstocks: { warn: ['TR'] } } })
const INVALID_KILLED_X = { ...KILLED_X, ekAnahtar: 1 } // buyEnabled=false AMA tablo gecersiz (0b, kural 1'den once)
const INVALID_KILLED_B = { ...KILLED_B, ekAnahtar: 1 }

const exp = (decision, reason, ipCountry = null) => ({ decision, reason, ipCountry })

// spec 4.5 satirlari (tek ihracci satirlari): [no, ad, girdi, beklenen]
const MATRIX = [
  [1, 'bstocks buyEnabled=false, ip TR', { issuer: 'bstocks', rules: KILLED_B, ipCountry: 'TR' }, exp('BLOCKED', 'KILL_SWITCH', 'TR')],
  [2, 'xstocks buyEnabled=false, ip null (kural 1, 2 den once)', { rules: KILLED_X }, exp('BLOCKED', 'KILL_SWITCH')],
  [3, 'bstocks ip null', { issuer: 'bstocks' }, exp('BLOCKED', 'COUNTRY_UNKNOWN')],
  [4, 'xstocks ip null', {}, exp('BLOCKED', 'COUNTRY_UNKNOWN')],
  [6, 'bstocks TR', { issuer: 'bstocks', ipCountry: 'TR' }, exp('BLOCKED', 'IP_COUNTRY_ISSUER', 'TR')],
  [7, 'xstocks TR (K43: gomulu tabloda uyari yok -> uyarisiz OK)', { ipCountry: 'TR' }, exp('OK', 'OK', 'TR')],
  [7, 'xstocks TR, uyari listesi dolu eski tablo -> WARN (alim yine acik)', { rules: WARN_TR_X, ipCountry: 'TR' }, exp('WARN', 'WARN_COUNTRY', 'TR')],
  [8, 'bstocks CH (ihtiyat-yalniz)', { issuer: 'bstocks', ipCountry: 'CH' }, exp('BLOCKED', 'IP_COUNTRY_PRECAUTION', 'CH')],
  [9, 'bstocks GP (dis bolge)', { issuer: 'bstocks', ipCountry: 'GP' }, exp('BLOCKED', 'IP_COUNTRY_PRECAUTION', 'GP')],
  [10, 'xstocks US', { ipCountry: 'US' }, exp('BLOCKED', 'IP_COUNTRY_ISSUER', 'US')],
  [11, 'xstocks DE (AB)', { ipCountry: 'DE' }, exp('BLOCKED', 'IP_COUNTRY_PRECAUTION', 'DE')],
  [12, 'xstocks PR', { ipCountry: 'PR' }, exp('BLOCKED', 'IP_COUNTRY_PRECAUTION', 'PR')],
  [13, 'bstocks AE', { issuer: 'bstocks', ipCountry: 'AE' }, exp('BLOCKED', 'IP_COUNTRY_ISSUER', 'AE')],
  [14, 'xstocks AE', { ipCountry: 'AE' }, exp('OK', 'OK', 'AE')],
  [15, 'bstocks BR (ihtiyat-yalniz)', { issuer: 'bstocks', ipCountry: 'BR' }, exp('BLOCKED', 'IP_COUNTRY_PRECAUTION', 'BR')],
  [15, 'xstocks BR (ihtiyat-yalniz)', { ipCountry: 'BR' }, exp('BLOCKED', 'IP_COUNTRY_PRECAUTION', 'BR')],
  [16, 'bstocks IN', { issuer: 'bstocks', ipCountry: 'IN' }, exp('OK', 'OK', 'IN')],
  [16, 'xstocks IN', { ipCountry: 'IN' }, exp('OK', 'OK', 'IN')],
  [20, 'bstocks TR, TR blocked listesinden cikarilmis surum -> OK', { issuer: 'bstocks', rules: TR_OPEN_B, ipCountry: 'TR' }, exp('OK', 'OK', 'TR')],
  [21, 'xstocks TR, TR warn dan blocked a tasinmis surum', { rules: TR_BLOCKED_X, ipCountry: 'TR' }, exp('BLOCKED', 'IP_COUNTRY_ISSUER', 'TR')],
  [22, 'xstocks rules=null', { rules: null }, exp('BLOCKED', 'RULES_INVALID')],
  [24, "'dogecoin' ihracci", { issuer: 'dogecoin', ipCountry: 'TR' }, exp('BLOCKED', 'ISSUER_UNKNOWN', 'TR')],
  [25, 'xstocks buyEnabled=false + gecersiz tablo (0b, 1 den once)', { rules: INVALID_KILLED_X }, exp('BLOCKED', 'RULES_INVALID')],
  [25, 'bstocks buyEnabled=false + gecersiz tablo (0b, 1 den once)', { issuer: 'bstocks', rules: INVALID_KILLED_B }, exp('BLOCKED', 'RULES_INVALID')],
]

describe('decide -- spec 4.5 matrisi (satir 1-25)', () => {
  it.each(MATRIX)('satir %i: %s', (_no, _ad, over, beklenen) => {
    expect(decide(over)).toEqual(beklenen)
  })

  // Satir 5: bozuk / bilinmeyen ulke kodu null sayilir -> COUNTRY_UNKNOWN (iki ihracci da).
  const BOZUK_ULKE = ['tr', '12', [], {}, 5, '__proto__', 'EU', 'AP', 'ZZ']
  it.each(BOZUK_ULKE.flatMap((ip) => ISSUERS.map((issuer) => [issuer, ip])))(
    'satir 5: %s ipCountry %j -> BLOCKED/COUNTRY_UNKNOWN, ipCountry null', (issuer, ip) => {
      expect(decide({ issuer, ipCountry: ip })).toEqual(exp('BLOCKED', 'COUNTRY_UNKNOWN'))
    },
  )

  it.each(ISSUERS)('satir 5: %s XK (ISO de yok ama listede) bilinen ulke; kural tablosunda yok -> OK/OK', (issuer) => {
    expect(decide({ issuer, ipCountry: 'XK' })).toEqual(exp('OK', 'OK', 'XK'))
  })

  it('satir 20 ve 21 pozitif bekci: degisimden onceki taban davranis farkli', () => {
    expect(decide({ issuer: 'bstocks', ipCountry: 'TR' }).reason).toBe('IP_COUNTRY_ISSUER')
    expect(decide({ ipCountry: 'TR' }).reason).toBe('OK') // K43: eskiden WARN_COUNTRY idi
    expect(decide({ rules: WARN_TR_X, ipCountry: 'TR' }).reason).toBe('WARN_COUNTRY')
  })
})

describe('decide -- satir 23: now sonlu sayi degil ya da tablo tarihi ileride', () => {
  it.each([['undefined', undefined], ['NaN', NaN], ['Infinity', Infinity], ['dize', '1'], ['null', null], ['Date', new Date(NOW)], ['nesne', {}]])(
    'now %s -> BLOCKED/RULES_INVALID (kapali, firlatmaz)', (_ad, now) => {
      expect(decide({ now, ipCountry: 'IN' })).toEqual(exp('BLOCKED', 'RULES_INVALID', 'IN'))
    })

  it('now girdi alani HIC verilmezse de kapali', () => {
    const { now: _yok, ...gir } = BASE
    expect(decideStockBuy({ ...gir, ipCountry: 'IN' })).toEqual(exp('BLOCKED', 'RULES_INVALID', 'IN'))
  })

  it('now kurallarin dogrulamasina GECER: tablo gunu now + 30 gunden ileriyse RULES_INVALID, degilse karar', () => {
    const DAY = 24 * 60 * 60 * 1000
    const tableDay = versionNoonMs(BUNDLED.version) - 12 * 60 * 60 * 1000 // gomulu surum gununun UTC baslangici
    expect(decide({ now: tableDay - 30 * DAY, ipCountry: 'IN' })).toEqual(exp('OK', 'OK', 'IN'))
    expect(decide({ now: tableDay - 31 * DAY, ipCountry: 'IN' })).toEqual(exp('BLOCKED', 'RULES_INVALID', 'IN'))
  })

  it('now tek basina kontrol akisini degistirmez: gecerli now ile acil durdurma yine once', () => {
    expect(decide({ now: 0 + NOW, rules: KILLED_X, ipCountry: 'US' }).reason).toBe('KILL_SWITCH')
  })
})

describe('decide -- satir 17: GB JE GG IM GI', () => {
  it.each(['GB', 'JE', 'GG', 'IM', 'GI'])('ip %s: bstocks hepsi ISSUER', (ip) => {
    expect(decide({ issuer: 'bstocks', ipCountry: ip })).toEqual(exp('BLOCKED', 'IP_COUNTRY_ISSUER', ip))
  })
  it('xstocks: GB ISSUER; JE GG IM GI PRECAUTION', () => {
    expect(decide({ ipCountry: 'GB' }).reason).toBe('IP_COUNTRY_ISSUER')
    for (const ip of ['JE', 'GG', 'IM', 'GI']) expect(decide({ ipCountry: ip }).reason, ip).toBe('IP_COUNTRY_PRECAUTION')
  })
})

describe('decide -- satir 18: 27 AB + IS LI NO + AX', () => {
  const EU27 = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' ')
  const AEA_PLUS = [...EU27, 'IS', 'LI', 'NO', 'AX']
  it('31 kod: bstocks ISSUER, xstocks PRECAUTION (tek tek)', () => {
    expect(AEA_PLUS).toHaveLength(31)
    for (const ip of AEA_PLUS) {
      expect(decide({ issuer: 'bstocks', ipCountry: ip }).reason, `bstocks ${ip}`).toBe('IP_COUNTRY_ISSUER')
      expect(decide({ issuer: 'xstocks', ipCountry: ip }).reason, `xstocks ${ip}`).toBe('IP_COUNTRY_PRECAUTION')
    }
  })
})

describe('decide -- satir 19: AB dis bolge kodlari', () => {
  it('GP MQ GF RE YT MF iki ihraccida da PRECAUTION', () => {
    for (const ip of ['GP', 'MQ', 'GF', 'RE', 'YT', 'MF']) {
      for (const issuer of ISSUERS) {
        expect(decide({ issuer, ipCountry: ip }).reason, `${issuer} ${ip}`).toBe('IP_COUNTRY_PRECAUTION')
      }
    }
  })
})

describe('decide -- ORAKUL taramasi (her ISO kodu x iki ihracci)', () => {
  it('etkin engel kumeleri 67 (bstocks) ve 82 (xstocks); warn engel kumesiyle kesismez', () => {
    expect(effectiveBlocked(BUNDLED, 'bstocks').size).toBe(67)
    expect(effectiveBlocked(BUNDLED, 'xstocks').size).toBe(82)
    for (const issuer of ISSUERS) {
      const eff = effectiveBlocked(BUNDLED, issuer)
      for (const w of BUNDLED.issuers[issuer].warn) expect(eff.has(w), `${issuer} warn ${w}`).toBe(false)
      expect(BUNDLED.issuers[issuer].warn, `K43 ${issuer} gomulu uyari listesi bos`).toEqual([])
    }
    // pozitif bekci: kesisimsizlik bos bir kume uzerinde sinanmadi; dolu bir uyari listesiyle de engel kumesiyle kesismez
    expect(WARN_TR_X.issuers.xstocks.warn).toEqual(['TR'])
    expect(effectiveBlocked(WARN_TR_X, 'xstocks').has('TR')).toBe(false)
  })

  it('IP ulkesi: etkin engelde BLOCKED + dogru neden; warn ise WARN; degilse OK (ipCountry = girdi)', () => {
    // K43: gomulu tabloda WARN uretilmez (0); uyari listesi dolu eski tabloda yalniz xstocks TR WARN olur (1).
    for (const [rules, beklenenWarn] of [[BUNDLED, 0], [WARN_TR_X, 1]]) {
      let blockedCount = 0
      let warnCount = 0
      for (const issuer of ISSUERS) {
        const eff = effectiveBlocked(rules, issuer)
        for (const code of COUNTRY_CODES) {
          const r = decide({ issuer, rules, ipCountry: code })
          if (eff.has(code)) {
            blockedCount++
            expect(r, `${issuer} ${code}`).toEqual(exp('BLOCKED', issuerListed(rules, issuer, code) ? 'IP_COUNTRY_ISSUER' : 'IP_COUNTRY_PRECAUTION', code))
          } else if (rules.issuers[issuer].warn.includes(code)) {
            warnCount++
            expect(r, `${issuer} ${code}`).toEqual(exp('WARN', 'WARN_COUNTRY', code))
          } else {
            expect(r, `${issuer} ${code}`).toEqual(exp('OK', 'OK', code))
          }
        }
      }
      expect(blockedCount).toBe(67 + 82) // pozitif bekci: tarama gercekten engelli kodlari gordu
      expect(warnCount).toBe(beklenenWarn)
    }
  })

  it('ulke bilinmiyorsa iki ihracci da kapali (hicbir sinyal yokken Al acilmaz)', () => {
    for (const issuer of ISSUERS) expect(decide({ issuer }), issuer).toEqual(exp('BLOCKED', 'COUNTRY_UNKNOWN'))
  })
})

describe('decide -- kural onceligi (tek tek)', () => {
  it('0b > 1: gecersiz tablo acil durdurmadan once (RULES_INVALID)', () => {
    expect(decide({ rules: INVALID_KILLED_X }).reason).toBe('RULES_INVALID')
  })
  it('1 > 2: acil durdurma ulke bilinmezliginden once', () => {
    expect(decide({ rules: KILLED_X }).reason).toBe('KILL_SWITCH')
  })
  it('1 > 3: acil durdurma IP engelinden once', () => {
    expect(decide({ rules: KILLED_X, ipCountry: 'US' }).reason).toBe('KILL_SWITCH')
  })
  it('2 > 3: ulke bilinmiyorsa engel kontrolune hic girilmez (COUNTRY_UNKNOWN, ISSUER degil)', () => {
    expect(decide({ ipCountry: 'tr' }).reason).toBe('COUNTRY_UNKNOWN')
  })
  it('3 > 4: engelli ulke uyariya dusmez (xstocks TR engellenince WARN degil BLOCKED)', () => {
    expect(decide({ rules: TR_BLOCKED_X, ipCountry: 'TR' }).decision).toBe('BLOCKED')
  })
})

describe('decide -- bozuk kural tablosu BLOCKED/RULES_INVALID (gevsek tablo kabul edilmez)', () => {
  it.each([
    ['undefined', undefined], ['dize', 'x'], ['bos nesne', {}], ['dizi', []],
    ['ek ust anahtar', { ...structuredClone(BUNDLED), extra: 1 }],
    ['kucuk harf kod', rulesFixture({ issuers: { xstocks: { warn: ['tr'] } } })],
    ['US siz (cekirdek tabansiz) yuksek surumlu tablo', (() => {
      const r = rulesFixture({ version: bumpVersion(BUNDLED.version, 1) })
      for (const l of [r.common.precaution, r.issuers.bstocks.blocked, r.issuers.xstocks.blocked]) l.splice(l.indexOf('US'), 1)
      return r
    })()],
    ['gelecek tarihli surum', rulesFixture({ version: '2062-10-16.1' })],
  ])('%s', (_ad, rules) => {
    for (const issuer of ISSUERS) {
      expect(decide({ issuer, rules, ipCountry: 'TR' }), issuer).toEqual(exp('BLOCKED', 'RULES_INVALID', 'TR'))
    }
  })
})

describe('decide -- ihracci kimligi', () => {
  it.each([['dogecoin'], [''], [null], [undefined], [5], [{}], [['bstocks']], ['BSTOCKS'], ['__proto__'], ['constructor'], ['toString']])(
    'ihracci %j -> ISSUER_UNKNOWN', (issuer) => {
      expect(decide({ issuer, ipCountry: 'IN' }).reason).toBe('ISSUER_UNKNOWN')
    })
})

describe('decide -- normalizeCountry (iyi bicim + ISO listesi)', () => {
  it('yalniz iki BUYUK harf VE listede olan kod; XK bilinir', () => {
    expect(normalizeCountry('TR')).toBe('TR')
    expect(normalizeCountry('XK')).toBe('XK')
    for (const x of ['tr', 'Tr', 'TUR', 'T', ' TR', 'TR ', '', '12', 12, [], ['TR'], null, undefined, {}, true, 'EU', 'AP', 'ZZ', 'UK']) {
      expect(normalizeCountry(x), JSON.stringify(x)).toBeNull()
    }
  })

  it('listedeki HER kod normalize edilince kendisi kalir (pozitif bekci: liste bos degil)', () => {
    expect(COUNTRY_CODES.length).toBeGreaterThan(240)
    for (const c of COUNTRY_CODES) expect(normalizeCountry(c), c).toBe(c)
  })
})

describe('decide -- sonuc sekli, saflik, asla firlatmaz', () => {
  const KEYS = ['decision', 'ipCountry', 'reason']
  const DECISIONS = ['OK', 'WARN', 'BLOCKED']

  it('cikti anahtar kumesi TAM [decision, ipCountry, reason] (P1: ipCountry dahil)', () => {
    for (const [, , over] of MATRIX) expect(Object.keys(decide(over)).sort()).toEqual(KEYS)
    expect(Object.keys(decide({ ipCountry: 'IN' })).sort()).toEqual(KEYS)
  })

  it('OK / WARN sonuclarinda ipCountry her zaman bilinen bir ulke kodudur', () => {
    for (const r of [decide({ ipCountry: 'IN' }), decide({ ipCountry: 'TR' })]) {
      expect(['OK', 'WARN']).toContain(r.decision)
      expect(r.ipCountry).toMatch(/^[A-Z]{2}$/)
    }
  })

  it('her cagri YENI nesne doner; girdi degismez', () => {
    const a = decideStockBuy({ ...BASE, ipCountry: 'IN' })
    const b = decideStockBuy({ ...BASE, ipCountry: 'IN' })
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
    a.reason = 'KURCALANDI'
    expect(decideStockBuy({ ...BASE, ipCountry: 'IN' }).reason).toBe('OK')
  })

  const dongulu = {}
  dongulu.kendisi = dongulu
  const atan = new Proxy({}, { get() { throw new Error('get') }, ownKeys() { throw new Error('ownKeys') } })
  const FUZZ = [
    undefined, null, 0, 1, NaN, '', 'x', 'TR', true, false, [], {}, dongulu, atan, Symbol.iterator,
    Object.create(null), () => 1, new Date(0), 10n,
  ]

  it('fuzz: her alan icin tum bozuk degerler (getter tuzagi, Proxy, null kural, NaN now) -> firlatmaz, sekil ve degerler gecerli', () => {
    const fields = ['issuer', 'rules', 'ipCountry', 'now']
    let n = 0
    for (const field of fields) {
      for (const value of FUZZ) {
        let r
        expect(() => { r = decide({ [field]: value }) }, `${field}#${FUZZ.indexOf(value)}`).not.toThrow()
        expect(Object.keys(r).sort()).toEqual(KEYS)
        expect(DECISIONS).toContain(r.decision)
        expect(typeof r.reason).toBe('string')
        expect(r.ipCountry === null || /^[A-Z]{2}$/.test(r.ipCountry)).toBe(true)
        n++
      }
    }
    expect(n).toBe(fields.length * FUZZ.length)
  })

  it('girdinin kendisi bozuk: decideStockBuy(undefined / null / sayi / dize) firlatmaz ve BLOCKED', () => {
    const girdiler = [undefined, null, 5, 'x', [], atan]
    for (const input of girdiler) {
      const r = decideStockBuy(input)
      expect(r.decision, `girdi#${girdiler.indexOf(input)}`).toBe('BLOCKED')
      expect(['ISSUER_UNKNOWN', 'RULES_INVALID']).toContain(r.reason)
    }
  })

  it('iceri tuzak: girdi nesnesinin alani okunurken firlatan getter -> BLOCKED/RULES_INVALID', () => {
    const tuzak = { get issuer() { throw new Error('issuer') }, rules: BUNDLED, ipCountry: 'IN', now: NOW }
    expect(decideStockBuy(tuzak)).toEqual(exp('BLOCKED', 'RULES_INVALID'))
  })
})

describe('decide -- kaynak kilitleri', () => {
  const kod = yorumsuz(readFileSync(join(here, 'decide.js'), 'utf8'))

  it('saf: yalniz ./rules ve data/countryCodes import eder; ag, depo, saat, rastgelelik, vue, featureFlags, console YOK', () => {
    const imports = kod.match(/^\s*import\s[^\n]*$/gm) || []
    expect(imports).toHaveLength(2)
    expect(imports.some((s) => /from '\.\.\/\.\.\/data\/countryCodes'/.test(s))).toBe(true)
    expect(imports.some((s) => /from '\.\/rules'/.test(s))).toBe(true)
    expect(kod).not.toMatch(/featureFlags|from 'vue'|\bchrome\b|\bfetch\s*\(|console\.|privateKey/)
    expect(kod).not.toMatch(/Date\.|new Date|Math\.random|setTimeout|await\b|async\b|Promise/)
  })

  it('onceliklerin sirasi kaynakta degismez: 1 < 2 < 3 < 4 < 5', () => {
    const idx = (s) => kod.indexOf(s)
    const order = [
      "'KILL_SWITCH'", "'COUNTRY_UNKNOWN'", "'IP_COUNTRY_ISSUER'", "'WARN_COUNTRY'", "out('OK', 'OK'",
    ].map(idx)
    for (const i of order) expect(i).toBeGreaterThan(-1)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('kaynakta declaration|clientTextVersion|stale|action|country kelimeleri yok (yorumsuz tarama, K40)', () => {
    const yasak = /\b(declaration|clientTextVersion|stale|action|country)\b/
    expect(kod).not.toMatch(yasak)
    // pozitif bekci: tarama kalibi gercekten bu kelimeleri yakalar ve kod gercekten okundu
    expect(yasak.test('const declaration = 1')).toBe(true)
    expect(yasak.test('out.country')).toBe(true)
    expect(kod).toMatch(/decideStockBuy/)
    expect(kod).toMatch(/KILL_SWITCH/)
  })
})

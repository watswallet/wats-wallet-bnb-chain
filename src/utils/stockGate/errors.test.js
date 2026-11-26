// errors.js -- kapi nedenleri icin tek kaynak: STOCK_GATE_REASONS, sentinel, toGateReason.
//
// KOK NEDEN / KAPATILAN HATA: sentinel (arka plan), CoW `gateReason` / `lockLine` ve
// `locales.test.js` ayri birer neden listesi tutarsa biri kapali kumeden sapar; ham `RULES_INVALID`
// ya da bir olu beyan nedeni kullaniciya METINSIZ bir kilit olarak gider. Hepsi `toGateReason`'dan
// gecer. Saf katman: ag / depo / vue / bayrak yok.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz, blokGovdesi } from '../../test-utils/kaynakTarama'
import { LOCK_REASON } from '../cow/config'
import { COW_ERROR } from '../cow/errors'
import {
  STOCK_GATE_REASONS, STOCK_GATE_PREFIX, toGateReason, stockGateError, parseStockGateError, isStockGateError,
  denyBuyGate, gateVerdict, gateLockedReply, gateRefusalReply,
} from './errors'
import * as ERRORS from './errors'

// Spec 5.11 / PE12 / K32: kullaniciya gosterilen BES neden (SIRA dahil kilitli; COUNTRY_UNKNOWN CHECK_FAILED'ten once).
const BEKLENEN_5 = ['KILL_SWITCH', 'IP_COUNTRY_ISSUER', 'IP_COUNTRY_PRECAUTION', 'COUNTRY_UNKNOWN', 'CHECK_FAILED']

// Kumeden CIKAN dokuz olu neden (beyan arayuzu K32 ile kalkti) ve karar fonksiyonunun kume disi ic nedenleri: HEPSI
// CHECK_FAILED'a (kapali yon) duser; ALREADY_BLOCKED esmesi (-> US_PERSON) kalkti.
const OLU_ADLAR = [
  'US_PERSON', 'DECLARED_COUNTRY_ISSUER', 'DECLARED_COUNTRY_PRECAUTION', 'COUNTRY_MISMATCH', 'TEXT_UPDATE_REQUIRED',
  'STORAGE_ERROR', 'ACCOUNT_MISMATCH', 'ACCOUNT_UNKNOWN', 'DECLARATION_REQUIRED',
]
const KUME_DISI_ADLAR = [...OLU_ADLAR, 'ALREADY_BLOCKED', 'RULES_INVALID', 'ISSUER_UNKNOWN', 'WARN_COUNTRY', 'OK']

const KAYNAK = fs.readFileSync(fileURLToPath(new URL('./errors.js', import.meta.url)), 'utf8')

describe('STOCK_GATE_REASONS', () => {
  it('errors: STOCK_GATE_REASONS TAM bes deger [KILL_SWITCH, IP_COUNTRY_ISSUER, IP_COUNTRY_PRECAUTION, COUNTRY_UNKNOWN, CHECK_FAILED], bu sirayla, tekrarsiz', () => {
    expect(STOCK_GATE_REASONS).toEqual(BEKLENEN_5)
    expect(STOCK_GATE_REASONS).toHaveLength(5)
    expect(new Set(STOCK_GATE_REASONS).size).toBe(5)
  })

  it('errors: olu dokuz ad kumede YOK (TERS TEST: kume buyuyemez)', () => {
    for (const ad of OLU_ADLAR) expect(STOCK_GATE_REASONS, ad).not.toContain(ad)
  })

  it('errors: STOCK_GATE_REASONS CHECK_FAILED son, COUNTRY_UNKNOWN ondan once', () => {
    expect(STOCK_GATE_REASONS[STOCK_GATE_REASONS.length - 1]).toBe('CHECK_FAILED')
    expect(STOCK_GATE_REASONS[STOCK_GATE_REASONS.length - 2]).toBe('COUNTRY_UNKNOWN')
  })

  it('errors: COUNTRY_UNKNOWN kapali kumede; toGateReason / stockGateError / parseStockGateError gidis-donus', () => {
    expect(STOCK_GATE_REASONS).toContain('COUNTRY_UNKNOWN')
    expect(toGateReason('COUNTRY_UNKNOWN')).toBe('COUNTRY_UNKNOWN')
    expect(stockGateError('COUNTRY_UNKNOWN')).toBe('STOCK_GATE:COUNTRY_UNKNOWN')
    expect(parseStockGateError(stockGateError('COUNTRY_UNKNOWN'))).toBe('COUNTRY_UNKNOWN')
    expect(parseStockGateError('STOCK_GATE:COUNTRY_UNKNOWN')).toBe('COUNTRY_UNKNOWN')
  })

  it('dondurulmus: dis kod kumeyi genisletemez', () => {
    expect(Object.isFrozen(STOCK_GATE_REASONS)).toBe(true)
    expect(() => STOCK_GATE_REASONS.push('BOGUS')).toThrow(TypeError)
  })

  it('on ek tam olarak "STOCK_GATE:"', () => {
    expect(STOCK_GATE_PREFIX).toBe('STOCK_GATE:')
  })
})

describe('toGateReason', () => {
  it.each(BEKLENEN_5)('kume degeri %s aynen doner', (neden) => {
    expect(toGateReason(neden)).toBe(neden)
  })

  it.each(KUME_DISI_ADLAR)('toGateReason: kume disi ad %s -> CHECK_FAILED (dokuz olu ad + ALREADY_BLOCKED + RULES_INVALID + ISSUER_UNKNOWN)', (girdi) => {
    expect(toGateReason(girdi)).toBe('CHECK_FAILED')
  })

  it('pozitif bekci: kume disi ad listesi dokuz olu adi + ALREADY_BLOCKED + RULES_INVALID + ISSUER_UNKNOWN icerir', () => {
    expect(OLU_ADLAR).toHaveLength(9)
    for (const ad of ['ALREADY_BLOCKED', 'RULES_INVALID', 'ISSUER_UNKNOWN']) expect(KUME_DISI_ADLAR).toContain(ad)
  })

  it('bilinmeyen / bozuk girdi CHECK_FAILED olur ve asla firlatmaz', () => {
    const bozuklar = [
      'bogus', '', ' KILL_SWITCH', 'kill_switch', 'KILL_SWITCH ', '__proto__', 'constructor', 'toString',
      'hasOwnProperty', undefined, null, 42, 0, true, {}, [], ['KILL_SWITCH'], () => 'KILL_SWITCH', Symbol('x'),
    ]
    for (const b of bozuklar) {
      expect(toGateReason(b), typeof b === 'symbol' ? 'symbol' : String(b)).toBe('CHECK_FAILED')
    }
  })
})

describe('stockGateError', () => {
  it.each(BEKLENEN_5)('sentinel on eki + neden: %s', (neden) => {
    expect(stockGateError(neden)).toBe(`STOCK_GATE:${neden}`)
  })

  it('kume disi nedenler (olu adlar dahil) STOCK_GATE:CHECK_FAILED yazilir (uretim tarafinda eslenir)', () => {
    for (const neden of [...KUME_DISI_ADLAR, 'bogus', undefined, null, 5]) {
      expect(stockGateError(neden), String(neden)).toBe('STOCK_GATE:CHECK_FAILED')
    }
  })
})

describe('parseStockGateError / isStockGateError', () => {
  it.each(BEKLENEN_5)('gidis-donus: %s', (neden) => {
    expect(parseStockGateError(stockGateError(neden))).toBe(neden)
    expect(isStockGateError(stockGateError(neden))).toBe(true)
  })

  it('sentinel olmayan her sey null (mevcut hata davranisi korunur)', () => {
    const sentinelDegil = [
      'hata', 'XSTOCK_USE_COW', 'BSTOCK_NOT_BRIDGEABLE', '', 'stock_gate:KILL_SWITCH', ' STOCK_GATE:KILL_SWITCH',
      'ERR STOCK_GATE:KILL_SWITCH', 42, null, undefined, {}, [], new Error('STOCK_GATE:KILL_SWITCH'),
    ]
    for (const v of sentinelDegil) {
      expect(parseStockGateError(v), String(v)).toBeNull()
      expect(isStockGateError(v), String(v)).toBe(false)
    }
  })

  it('on eki olup nedeni kume disi / bozuk olan dize CHECK_FAILED olur', () => {
    expect(parseStockGateError('STOCK_GATE:BOGUS')).toBe('CHECK_FAILED')
    expect(parseStockGateError('STOCK_GATE:')).toBe('CHECK_FAILED')
    expect(parseStockGateError('STOCK_GATE:KILL_SWITCH extra')).toBe('CHECK_FAILED')
    expect(parseStockGateError('STOCK_GATE:RULES_INVALID')).toBe('CHECK_FAILED')
    expect(parseStockGateError('STOCK_GATE:__proto__')).toBe('CHECK_FAILED')
  })

  it('sentinel icindeki olu adlar (ALREADY_BLOCKED, US_PERSON ...) CHECK_FAILED okunur', () => {
    for (const ad of KUME_DISI_ADLAR) expect(parseStockGateError(`STOCK_GATE:${ad}`), ad).toBe('CHECK_FAILED')
  })
})

// KOK NEDEN / KAPATILAN HATA (PF18, PF19): kapi sonucunu okuyan ve kilit yaniti ureten kod CoW servisinde, CoW onayinda
// ve iki motorda ayri ayri yazilirsa biri gevsek okur ({ ok: 'true' } / { ok: 1 } kapiyi acar) ya da kilit yanitinin sekli
// ayrisir. Hepsi bu dosyadan gecer; gate verilmezse Al REDDEDILIR (fail-closed).
describe('kilit yaniti yardimcilari (C15)', () => {
  const KAPALI = { ok: false, reason: 'CHECK_FAILED' }
  const KILIT_ANAHTARLARI = [
    'approval', 'display', 'gateReason', 'locked', 'lockReason', 'notice', 'quoteId', 'reference', 'success', 'warnings',
  ].sort()

  it('GATE_ACTIONS ve gateActionOf disa aktarilmaz (K32: kapi eylemi yok, yalniz neden)', () => {
    expect('GATE_ACTIONS' in ERRORS).toBe(false)
    expect('gateActionOf' in ERRORS).toBe(false)
    // pozitif bekci: ayni modulden beklenen yardimcilar gercekten disa aktarilir
    for (const ad of ['gateVerdict', 'gateLockedReply', 'gateRefusalReply', 'denyBuyGate', 'toGateReason']) {
      expect(typeof ERRORS[ad], ad).toBe('function')
    }
  })

  it("denyBuyGate { ok:false, reason:'CHECK_FAILED' } ile Al'i reddeder ve her cagrida yeni nesne doner", async () => {
    expect(await denyBuyGate()).toEqual({ ok: false, reason: 'CHECK_FAILED' })
    expect(await denyBuyGate()).not.toBe(await denyBuyGate())
  })

  describe('gateVerdict', () => {
    it('yalniz nesne VE ok === true gecer; ek alanlar sizmaz; esitzamanli ask de olur', async () => {
      expect(await gateVerdict(async () => ({ ok: true }))).toEqual({ ok: true })
      expect(await gateVerdict(async () => ({ ok: true, account: { x: 1 }, reason: 'KILL_SWITCH', action: 'DECLARE' }))).toEqual({ ok: true })
      expect(await gateVerdict(() => ({ ok: true }))).toEqual({ ok: true })
    })

    it.each([
      ['undefined', undefined], ['null', null], ['bos nesne', {}], ["ok: 'true'", { ok: 'true' }], ['ok: 1', { ok: 1 }],
      ['ok: false', { ok: false }], ['dize', 'ok'], ['dizi', []], ['sayi', 1],
    ])('%s -> kapali CHECK_FAILED', async (_ad, deger) => {
      expect(await gateVerdict(async () => deger)).toEqual(KAPALI)
    })

    it('ask firlatirsa, reddederse, fonksiyon degilse ya da ok getter i firlatirsa KAPALI; asla firlatmaz', async () => {
      expect(await gateVerdict(() => { throw new Error('x') })).toEqual(KAPALI)
      expect(await gateVerdict(async () => { throw new Error('x') })).toEqual(KAPALI)
      expect(await gateVerdict(undefined)).toEqual(KAPALI)
      expect(await gateVerdict(async () => ({ get ok() { throw new Error('tuzak') } }))).toEqual(KAPALI)
    })

    it('red: neden kapali kumeden; action ve accountChanged sonucta YOK (kapi eylem / hesap tasimaz)', async () => {
      expect(await gateVerdict(async () => ({ ok: false, reason: 'IP_COUNTRY_ISSUER', action: 'DECLARE' })))
        .toEqual({ ok: false, reason: 'IP_COUNTRY_ISSUER' })
      expect(await gateVerdict(async () => ({ ok: false, reason: 'ALREADY_BLOCKED' }))).toEqual(KAPALI)
      expect(await gateVerdict(async () => ({ ok: false, reason: 'US_PERSON' }))).toEqual(KAPALI)
      expect(await gateVerdict(async () => ({ ok: false, reason: 'RULES_INVALID', action: 'FOO' }))).toEqual(KAPALI)
      expect(await gateVerdict(async () => ({ ok: false, code: 'ACCOUNT_CHANGED' }))).toEqual(KAPALI)
      expect(await gateVerdict(async () => ({ ok: false, code: 'BASKA' }))).toEqual(KAPALI)
    })

    it('gateVerdict sonucunda action ve accountChanged yok (ne ret ne kabul dalinda)', async () => {
      const asks = [
        async () => ({ ok: true }),
        async () => ({ ok: false, reason: 'KILL_SWITCH', action: 'DECLARE', code: 'ACCOUNT_CHANGED' }),
        () => { throw new Error('x') },
      ]
      for (const ask of asks) {
        const r = await gateVerdict(ask)
        expect('action' in r).toBe(false)
        expect('accountChanged' in r).toBe(false)
      }
    })
  })

  describe('gateLockedReply', () => {
    it.each(STOCK_GATE_REASONS)('%s: TAM 10 anahtar (gateAction YOK), sabit alanlar, lockReason LOCK_REASON.STOCK_GATE', (neden) => {
      const r = gateLockedReply(neden)
      expect(Object.keys(r).sort()).toEqual(KILIT_ANAHTARLARI)
      expect(KILIT_ANAHTARLARI).toHaveLength(10)
      expect('gateAction' in r).toBe(false)
      expect(r).toMatchObject({
        success: true, locked: true, lockReason: LOCK_REASON.STOCK_GATE, gateReason: neden,
        quoteId: null, display: null, approval: null, reference: null, notice: null,
      })
      expect(r.warnings).toEqual([])
    })

    it('gateLockedReply tek argumanli: ikinci arguman (eski eylem) yok sayilir; kume disi neden CHECK_FAILED; warnings her cagrida yeni dizi', () => {
      expect(gateLockedReply.length).toBe(1)
      expect(gateLockedReply('IP_COUNTRY_ISSUER', 'UPDATE_EXTENSION')).toEqual(gateLockedReply('IP_COUNTRY_ISSUER'))
      expect(gateLockedReply('RULES_INVALID')).toMatchObject({ gateReason: 'CHECK_FAILED' })
      expect(gateLockedReply(undefined)).toMatchObject({ gateReason: 'CHECK_FAILED' })
      expect(gateLockedReply('IP_COUNTRY_ISSUER').warnings).not.toBe(gateLockedReply('IP_COUNTRY_ISSUER').warnings)
    })
  })

  describe('gateRefusalReply', () => {
    it('place / approve reddi: { success: false, code: COW_ERROR.STOCK_GATE, gateReason }', () => {
      expect(gateRefusalReply('IP_COUNTRY_ISSUER')).toEqual({ success: false, code: COW_ERROR.STOCK_GATE, gateReason: 'IP_COUNTRY_ISSUER' })
      expect(gateRefusalReply('US_PERSON')).toEqual({ success: false, code: 'STOCK_GATE', gateReason: 'CHECK_FAILED' })
      expect(gateRefusalReply('RULES_INVALID')).toEqual({ success: false, code: 'STOCK_GATE', gateReason: 'CHECK_FAILED' })
      expect(gateRefusalReply(undefined).gateReason).toBe('CHECK_FAILED')
    })
  })

  it('pozitif bekci: yardimcilar kaynakta var ve errors.js saf kalir (import / chrome / vue / bayrak / log yok)', () => {
    const kod = yorumsuz(KAYNAK)
    for (const ad of ['gateVerdict', 'gateLockedReply', 'gateRefusalReply', 'denyBuyGate']) {
      expect(kod, ad).toContain(ad)
    }
    // K32: kapi eylemi ve hesap degisimi kavramlari kaynakta hic yok
    expect(kod).not.toMatch(/GATE_ACTIONS|gateActionOf|ACTION_SET|accountChanged|ACCOUNT_CHANGED|gateAction/)
    expect(kod).not.toMatch(/^\s*import\s/m)
    expect(kod).not.toMatch(/\bchrome\b|\bvue\b|featureFlags|console\./)
  })
})

describe('kaynak kilitleri (yorumsuz tarama)', () => {
  const kod = yorumsuz(KAYNAK)

  it('pozitif bekci: tarama gercek kodu goruyor', () => {
    expect(kod).toContain('export const STOCK_GATE_REASONS')
    expect(kod).toContain('export function toGateReason')
    expect(blokGovdesi(KAYNAK, /export function toGateReason\(reason\)/)).toContain('REASON_SET.has(reason)')
  })

  it('bayrak, log, import ve gizli anahtar yok (kapi bayragin arkasinda DEGIL, saf katman)', () => {
    expect(kod).not.toMatch(/featureFlags/)
    expect(kod).not.toMatch(/console\./)
    expect(kod).not.toMatch(/privateKey/)
    expect(kod).not.toMatch(/^\s*import\s/m)
  })

  it('olu adlar ve ALREADY_BLOCKED esmesi kaynakta hic yok (PE12: kume disi her girdi CHECK_FAILED)', () => {
    for (const ad of KUME_DISI_ADLAR.filter((a) => a !== 'OK' && a !== 'WARN_COUNTRY')) expect(kod, ad).not.toContain(ad)
  })
})

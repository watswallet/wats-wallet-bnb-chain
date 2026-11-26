// Gomulu kural tablosu (data/eligibilityRules.js): sunucu tablosunun yedek kopyasi.
//
// KOK NEDEN / KAPATILAN HATA: gomulu kopya (1) sunucuya hic ulasilamayan ve kalici onbellegi bos istemcinin
// TEK kural kaynagidir. Kopyadaki sessiz bir kayma
// (eksik kod, `UK`, ABD'siz taban, donuk olmayan nesne) kapiyi ya gevsek ya da KALICI kilitli birakir.
// Sunucu tablosuyla uyum (`server >= client`, esit surumde esit icerik) server/test/eligibilityClientCompat
// dosyasinda kilitlidir; burada kopyanin KENDI degismezleri kilitlenir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { yorumsuz } from '../test-utils/kaynakTarama'
import { BUNDLED_ELIGIBILITY_RULES as R } from './eligibilityRules'
import { validateRules, effectiveBlocked, CORE_BLOCK } from '../utils/stockGate/rules'

const here = dirname(fileURLToPath(import.meta.url))
const everyFrozen = (v) => v === null || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(everyFrozen))
// Bolum 2: zorunlu iki ihracci + LCX hisselerinin dort ek satiri (kendi engel listesi yok)
const ISSUER_SET = ['bstocks', 'coinbase', 'ondo', 'robinhood', 'st0x', 'xstocks']
const NEW_ISSUERS = ['coinbase', 'ondo', 'robinhood', 'st0x']

describe('BUNDLED_ELIGIBILITY_RULES', () => {
  it('pozitif bekci: alti ihracci var (zorunlu iki + ek dort) ve dogrulayici kabul eder', () => {
    expect(Object.keys(R.issuers).sort()).toEqual(ISSUER_SET)
    expect(validateRules(R)).toEqual({ ok: true })
  })

  it('ilk icerik: surum 2026-11-20.1 (ihracci kumesi acildi), her ihraccida buyEnabled true', () => {
    expect(R.version).toBe('2026-11-20.1')
    for (const issuer of ISSUER_SET) {
      expect(R.issuers[issuer].buyEnabled).toBe(true)
    }
  })

  it('yeni dort satir TAM { buyEnabled: true, blocked: [], warn: [] }', () => {
    for (const issuer of NEW_ISSUERS) {
      expect(R.issuers[issuer], issuer).toEqual({ buyEnabled: true, blocked: [], warn: [] })
      expect(effectiveBlocked(R, issuer).size, issuer).toBe(R.common.precaution.length)
    }
  })

  it('gomulu tabloda textVersion yok, derin donuk, import yok', () => {
    for (const issuer of ISSUER_SET) {
      expect(Object.keys(R.issuers[issuer]).sort()).toEqual(['blocked', 'buyEnabled', 'warn'])
      expect(R.issuers[issuer]).not.toHaveProperty('textVersion')
    }
    expect(everyFrozen(R)).toBe(true)
    const kod = yorumsuz(readFileSync(join(here, 'eligibilityRules.js'), 'utf8'))
    expect(kod).not.toMatch(/textVersion/)
    expect(kod).not.toMatch(/^\s*import\s/m)
    expect(kod).not.toMatch(/\brequire\s*\(/)
  })

  it('liste boyutlari 59 / 55 / 30 ve etkin kumeler 67 / 82 (ek dort ihracci: 59)', () => {
    expect(R.common.precaution).toHaveLength(59)
    expect(R.issuers.bstocks.blocked).toHaveLength(55)
    expect(R.issuers.xstocks.blocked).toHaveLength(30)
    expect(effectiveBlocked(R, 'bstocks').size).toBe(67)
    expect(effectiveBlocked(R, 'xstocks').size).toBe(82)
    for (const issuer of NEW_ISSUERS) expect(effectiveBlocked(R, issuer).size, issuer).toBe(59)
  })

  it('warn (K43): HER ihraccida BOS; Turkiye bStocks icin engelli, xStocks icin engelsiz VE uyarisiz', () => {
    for (const issuer of ISSUER_SET) expect(R.issuers[issuer].warn, issuer).toEqual([])
    expect(effectiveBlocked(R, 'bstocks').has('TR')).toBe(true)
    expect(effectiveBlocked(R, 'xstocks').has('TR')).toBe(false)
  })

  it('cekirdek taban HER ihraccida var; GB var UK yok', () => {
    for (const issuer of ISSUER_SET) {
      const set = effectiveBlocked(R, issuer)
      for (const code of CORE_BLOCK) expect(set.has(code), `${issuer} ${code}`).toBe(true)
      expect(set.has('GB')).toBe(true)
      expect(set.has('UK')).toBe(false)
    }
  })

  it('her liste sirali ve tekrarsiz', () => {
    const lists = [R.common.precaution, ...Object.values(R.issuers).flatMap((i) => [i.blocked, i.warn])]
    expect(lists).toHaveLength(1 + 2 * ISSUER_SET.length) // pozitif bekci: tum ihraccilar tarandi
    for (const list of lists) {
      expect([...list].sort()).toEqual([...list])
      expect(new Set(list).size).toBe(list.length)
    }
  })

  it('DERIN donuk: her seviye donuk, degistirme denemesi firlatir', () => {
    expect(everyFrozen(R)).toBe(true)
    expect(() => R.common.precaution.push('XX')).toThrow(TypeError)
    expect(() => { R.issuers.xstocks.buyEnabled = false }).toThrow(TypeError)
  })

  it('dosya saf veridir: import / require yok, featureFlags ve console yok', () => {
    const kod = yorumsuz(readFileSync(join(here, 'eligibilityRules.js'), 'utf8'))
    expect(kod).not.toMatch(/^\s*import\s/m)
    expect(kod).not.toMatch(/\brequire\s*\(/)
    expect(kod).not.toMatch(/featureFlags|console\./)
  })
})

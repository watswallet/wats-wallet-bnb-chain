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

describe('BUNDLED_ELIGIBILITY_RULES', () => {
  it('pozitif bekci: iki ihracci var ve dogrulayici kabul eder', () => {
    expect(Object.keys(R.issuers).sort()).toEqual(['bstocks', 'xstocks'])
    expect(validateRules(R)).toEqual({ ok: true })
  })

  it('ilk icerik: surum PE17 degeri, iki ihraccida buyEnabled true', () => {
    expect(R.version).toBe('2026-11-14.1') // K43: uyari listesi bosaldi, surum yukseldi
    for (const issuer of ['bstocks', 'xstocks']) {
      expect(R.issuers[issuer].buyEnabled).toBe(true)
    }
  })

  it('gomulu tabloda textVersion yok, derin donuk, import yok', () => {
    for (const issuer of ['bstocks', 'xstocks']) {
      expect(Object.keys(R.issuers[issuer]).sort()).toEqual(['blocked', 'buyEnabled', 'warn'])
      expect(R.issuers[issuer]).not.toHaveProperty('textVersion')
    }
    expect(everyFrozen(R)).toBe(true)
    const kod = yorumsuz(readFileSync(join(here, 'eligibilityRules.js'), 'utf8'))
    expect(kod).not.toMatch(/textVersion/)
    expect(kod).not.toMatch(/^\s*import\s/m)
    expect(kod).not.toMatch(/\brequire\s*\(/)
  })

  it('liste boyutlari 59 / 55 / 30 ve etkin kumeler 67 / 82', () => {
    expect(R.common.precaution).toHaveLength(59)
    expect(R.issuers.bstocks.blocked).toHaveLength(55)
    expect(R.issuers.xstocks.blocked).toHaveLength(30)
    expect(effectiveBlocked(R, 'bstocks').size).toBe(67)
    expect(effectiveBlocked(R, 'xstocks').size).toBe(82)
  })

  it('warn (K43): iki ihraccida da BOS; Turkiye bStocks icin engelli, xStocks icin engelsiz VE uyarisiz', () => {
    expect(R.issuers.bstocks.warn).toEqual([])
    expect(R.issuers.xstocks.warn).toEqual([])
    expect(effectiveBlocked(R, 'bstocks').has('TR')).toBe(true)
    expect(effectiveBlocked(R, 'xstocks').has('TR')).toBe(false)
  })

  it('cekirdek taban her iki ihraccida var; GB var UK yok', () => {
    for (const issuer of ['bstocks', 'xstocks']) {
      const set = effectiveBlocked(R, issuer)
      for (const code of CORE_BLOCK) expect(set.has(code), `${issuer} ${code}`).toBe(true)
      expect(set.has('GB')).toBe(true)
      expect(set.has('UK')).toBe(false)
    }
  })

  it('her liste sirali ve tekrarsiz', () => {
    for (const list of [
      R.common.precaution, R.issuers.bstocks.blocked, R.issuers.bstocks.warn, R.issuers.xstocks.blocked, R.issuers.xstocks.warn,
    ]) {
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

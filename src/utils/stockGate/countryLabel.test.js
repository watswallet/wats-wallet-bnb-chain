// KOK NEDEN / KAPATILAN HATA: bant metinleri ulke adini Intl.DisplayNames'ten alir. Intl yoksa /
// locale gecersizse / kod listede degilse bu yardimci FIRLATIRSA bant cizilmez (alim kapisi
// kilitli kalir); ICU `ZZ` icin "Bilinmeyen Bolge" gibi ad uydurursa kullaniciya listede
// olmayan bir "ulke" gosterilir. K32: ulke secici kalkti, `sortedCountries` ve liste siralama
// kodu silindi (Task 47); yalniz `countryLabel` kalir. Testler ad METNINE degil
// davranisa baglidir; ICU'ya bagli tek iddia "TR / US icin ad kodun kendisi degil" bekcisidir.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import * as countryLabelModulu from './countryLabel'
import { countryLabel } from './countryLabel'

const here = dirname(fileURLToPath(import.meta.url))

// Intl.DisplayNames'i firlatan bir kurucuyla degistirir; geri alma finally'de.
function withBrokenDisplayNames(fn) {
  const spy = vi.spyOn(Intl, 'DisplayNames').mockImplementation(function BrokenDisplayNames() {
    throw new RangeError('stub: DisplayNames yok')
  })
  try {
    fn()
    expect(spy).toHaveBeenCalled()
  } finally {
    spy.mockRestore()
  }
}

describe('countryLabel', () => {
  it('pozitif bekci: bilinen kod icin ad bos degil ve kodun kendisi degil', () => {
    for (const code of ['TR', 'US']) {
      for (const locale of ['tr', 'en']) {
        const name = countryLabel(code, locale)
        expect(name, `${code}/${locale}`).not.toBe('')
        expect(name, `${code}/${locale}`).not.toBe(code)
      }
    }
  })

  it('dil gercekten kullanilir: US icin tr ve en adlari farkli', () => {
    expect(countryLabel('US', 'tr')).not.toBe(countryLabel('US', 'en'))
  })

  it('locale dize degilse ya da bossa en kullanilir', () => {
    const en = countryLabel('US', 'en')
    expect(countryLabel('US', undefined)).toBe(en)
    expect(countryLabel('US', null)).toBe(en)
    expect(countryLabel('US', '')).toBe(en)
    expect(countryLabel('US', 42)).toBe(en)
  })

  it('listede olmayan kod ICU adi DEGIL kodun kendisi doner (ZZ, UK, kucuk harf)', () => {
    expect(countryLabel('ZZ', 'tr')).toBe('ZZ')
    expect(countryLabel('UK', 'tr')).toBe('UK')
    expect(countryLabel('tr', 'tr')).toBe('tr')
    expect(countryLabel('ABC', 'en')).toBe('ABC')
    expect(countryLabel('', 'en')).toBe('')
  })

  it('dize olmayan kod icin bos dize doner, firlatmaz', () => {
    for (const bad of [5, null, undefined, {}, [], true, Symbol('x')]) {
      expect(countryLabel(bad, 'tr')).toBe('')
    }
  })

  it('Intl.DisplayNames firlatirsa kodun kendisi doner', () => {
    withBrokenDisplayNames(() => {
      expect(countryLabel('TR', 'tr')).toBe('TR')
      expect(countryLabel('XK', 'en')).toBe('XK')
    })
  })

  it('gecersiz locale firlatmaz, kodun kendisi doner', () => {
    expect(countryLabel('TR', 'xx-gecersiz-locale-zzzz')).toBe('TR')
  })
})

describe('countryLabel modulu', () => {
  it('countryLabel: sortedCountries disa aktarilmaz (yalniz countryLabel kalir)', () => {
    expect('sortedCountries' in countryLabelModulu).toBe(false)
    expect(Object.keys(countryLabelModulu)).toEqual(['countryLabel']) // pozitif bekci: modul bos degil
    expect(typeof countryLabelModulu.countryLabel).toBe('function')
  })
})

describe('countryLabel.js kaynak', () => {
  it('saf: vue / chrome / console / featureFlags kullanmaz, tek import countryCodes', () => {
    const ham = readFileSync(join(here, 'countryLabel.js'), 'utf8')
    const kaynak = yorumsuz(ham)
    expect(kaynak).not.toMatch(/\bchrome\b/)
    expect(kaynak).not.toMatch(/console\./)
    expect(kaynak).not.toMatch(/featureFlags/)
    const importlar = kaynak.match(/^\s*import[^\n]*$/gm) || []
    expect(importlar).toHaveLength(1)
    expect(importlar[0]).toContain('data/countryCodes')
    expect(importlar[0]).not.toContain('COUNTRY_CODES,')
    expect(kaynak).not.toMatch(/from\s+['"]vue['"]/)
    expect(kaynak).not.toContain('sortedCountries')
  })
})

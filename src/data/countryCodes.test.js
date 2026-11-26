// KOK NEDEN / KAPATILAN HATA: ulke kodu listesi hem ulke adi cozumleyicinin (countryLabel) hem
// de sunucu kural tablosu testinin (eligibilityData.test.js) tek kaynagidir. Bir kodun
// sessizce eksilmesi o ulkenin adinin kodla gosterilmesi, `UK`
// gibi gecersiz bir kodun sizmasi ise kural tablosunda Birlesik Krallik'i hic eslemeyen bir
// girdi demektir. Liste ICU'ya BAGLI DEGIL: ad metni degil KOD KUMESI kilitlenir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { yorumsuz } from '../test-utils/kaynakTarama'
import { COUNTRY_CODES, COUNTRY_CODE_SET } from './countryCodes'

const here = dirname(fileURLToPath(import.meta.url))

describe('COUNTRY_CODES -- icerik', () => {
  it('tam 250 kod (249 ISO atanmis + XK)', () => {
    expect(COUNTRY_CODES).toHaveLength(250)
  })

  it('pozitif bekci: liste bos degil ve ilk / son kod beklenen', () => {
    expect(COUNTRY_CODES[0]).toBe('AD')
    expect(COUNTRY_CODES[COUNTRY_CODES.length - 1]).toBe('ZW')
  })

  it('her kod iki BUYUK harf', () => {
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/)
  })

  it('tekrar yok ve alfabetik sirali', () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length)
    expect([...COUNTRY_CODES].sort()).toEqual([...COUNTRY_CODES])
  })

  it('GB var, UK yok (Birlesik Krallik GB dir)', () => {
    expect(COUNTRY_CODES).toContain('GB')
    expect(COUNTRY_CODES).not.toContain('UK')
  })

  it('XK (Kosova) var', () => {
    expect(COUNTRY_CODES).toContain('XK')
  })

  it('kural tablolarinin dayandigi kodlarin hepsi var', () => {
    const gerekli = 'TR US PR GU VI AS MP UM JE GG IM GI AX GP MQ GF RE YT MF'.split(' ')
    for (const code of gerekli) expect(COUNTRY_CODE_SET.has(code), code).toBe(true)
  })

  it('silinmis ve ozel / ayrilmis kodlar YOK', () => {
    const yasak = 'AN BU CQ CS DD DY FX HV NH RH SU TP UK VD YD YU ZR AC CP DG EA EU EZ IC QO TA UN XA XB ZZ'.split(' ')
    for (const code of yasak) expect(COUNTRY_CODE_SET.has(code), code).toBe(false)
  })
})

describe('COUNTRY_CODES -- degismezlik ve saflik', () => {
  it('liste donuk: calisma zamaninda degistirilemez', () => {
    expect(Object.isFrozen(COUNTRY_CODES)).toBe(true)
    expect(() => COUNTRY_CODES.push('ZZ')).toThrow(TypeError)
  })

  it('COUNTRY_CODE_SET listeyle ayni kume', () => {
    expect(COUNTRY_CODE_SET.size).toBe(250)
    expect([...COUNTRY_CODE_SET]).toEqual([...COUNTRY_CODES])
  })

  it('dosya hicbir sey import etmez (saf veri; sunucu testi de okur)', () => {
    const kaynak = yorumsuz(readFileSync(join(here, 'countryCodes.js'), 'utf8'))
    expect(kaynak).not.toMatch(/^\s*import\s/m)
    expect(kaynak).not.toMatch(/\bfrom\s+['"]/)
    expect(kaynak).not.toMatch(/\brequire\s*\(/)
  })
})

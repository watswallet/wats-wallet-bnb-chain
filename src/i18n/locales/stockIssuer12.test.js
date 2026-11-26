// stockIssuer.* (ihracci secici) 12 dil kilidi, Bolum 2 Gorev 10. allLocales.test.js yapisal butunlugu denetler ama hangi anahtarin
// hangi degerle her dilde bulunmasi GEREKTIGINI bilmez. Burada kilitli:
// (1) LCX ihraccilarinin marka adlari (ondo, coinbase, robinhood, st0x) 12 dilde AYNI ve cevrilmemis,
// (2) stockIssuer.sub.lcx her dilde var; en / tr birebir, diger 10 dil cevrilmis ve LCX adini korur,
// (3) stockIssuer alt agacinin anahtar kumesi her dilde en ile ayni (yarim eklenmis dil yok).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SUPPORTED_LANGS } from '../languages'
import { flatten } from '../messageTools'

const here = dirname(fileURLToPath(import.meta.url))
const issuerOf = (kod) => new Map([...flatten(JSON.parse(readFileSync(join(here, `${kod}.json`), 'utf8')))].filter(([k]) => k.startsWith('stockIssuer.')))
const EN = issuerOf('en')

describe('stockIssuer 12 dil kilidi', () => {
  it('pozitif bekci: 12 dil, en anahtar kumesi bos degil ve yeni anahtarlari iceriyor', () => {
    expect(SUPPORTED_LANGS).toHaveLength(12)
    for (const k of ['ondo', 'coinbase', 'robinhood', 'st0x', 'sub.lcx']) expect(EN.has(`stockIssuer.${k}`), k).toBe(true)
  })

  describe.each(SUPPORTED_LANGS)('%s dil dosyasi', (kod) => {
    const m = issuerOf(kod)

    it('stockIssuer anahtar kumesi en ile ayni', () => {
      expect([...m.keys()].sort()).toEqual([...EN.keys()].sort())
    })

    it('LCX ihracci adlari marka adi: 12 dilde ayni, cevrilmemis', () => {
      expect(m.get('stockIssuer.ondo')).toBe('Ondo')
      expect(m.get('stockIssuer.coinbase')).toBe('Coinbase')
      expect(m.get('stockIssuer.robinhood')).toBe('Robinhood')
      expect(m.get('stockIssuer.st0x')).toBe('st0x') // kucuk harfli yazim marka adinin parcasi
    })

    it('stockIssuer.sub.lcx dolu, LCX adini korur, yer tutucu tasimaz', () => {
      const v = m.get('stockIssuer.sub.lcx')
      expect(typeof v).toBe('string')
      expect(v.trim()).not.toBe('')
      expect(v).toContain('LCX')
      expect(v).not.toMatch(/[{}|@<>]/)
      expect(Array.from(v).length).toBeLessThanOrEqual(60) // dugme alt satiri: ~170 px'e iki satirda sigar
    })
  })

  it('stockIssuer.sub.lcx: en ve tr birebir; diger 10 dil en metninden FARKLI (cevrilmis)', () => {
    expect(issuerOf('en').get('stockIssuer.sub.lcx')).toBe('Tokenized stock via LCX')
    expect(issuerOf('tr').get('stockIssuer.sub.lcx')).toBe('LCX üzerinden tokenize hisse')
    for (const kod of SUPPORTED_LANGS.filter((k) => k !== 'en' && k !== 'tr')) {
      expect(issuerOf(kod).get('stockIssuer.sub.lcx'), kod).not.toBe('Tokenized stock via LCX')
    }
  })
})

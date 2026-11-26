// KOK NEDEN / KAPATILAN HATA (K28): 9fb92682 uc xStocks adresini katalogdan cikardi; kapi ve genel Takas / Kopru dislamasi
// katalog uyeligine bagli oldugundan BSC'de PYPLx kapisiz ve dislamasiz alinabiliyordu. Emekli liste bunlari CIKTI
// tarafinda tutar ve katalogla ASLA kesismez.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../test-utils/kaynakTarama'
import { RETIRED_XSTOCKS } from './xStocksRetired'
import { XSTOCKS } from './xStocks'

describe('emekli xStocks listesi (K28)', () => {
  it('tam uc kayit: ADBEx [1], PYPLx [1, 56], STRCx [1]; adresler 9fb92682 ile birebir', () => {
    expect(RETIRED_XSTOCKS.map((r) => `${r.symbol}:${r.address}:${r.chains.join('/')}`)).toEqual([
      'ADBEx:0x16E0B579be45bAaE54cEddd52e742B6457A7fE12:1',
      'PYPLx:0xf706585e7e8900bE0267bEE3B9A2F70835EC6628:1/56',
      'STRCx:0x1Aad217B8F78dbA5E6693460e8470F8b1A3977f3:1',
    ])
    expect(RETIRED_XSTOCKS.map((r) => r.name)).toEqual(['Adobe', 'PayPal', 'Strategy PP Variable'])
  })

  it('liste ve her kayit derin donuk', () => {
    expect(Object.isFrozen(RETIRED_XSTOCKS)).toBe(true)
    for (const r of RETIRED_XSTOCKS) {
      expect(Object.isFrozen(r)).toBe(true)
      expect(Object.isFrozen(r.chains)).toBe(true)
    }
  })

  it('emekli adresler KATALOGDA yok (kataloga geri girmez); adresler tekil', () => {
    const adresler = new Set(XSTOCKS.map((s) => s.address.toLowerCase()))
    expect(RETIRED_XSTOCKS.filter((r) => adresler.has(r.address.toLowerCase()))).toEqual([])
    expect(XSTOCKS.some((s) => ['ADBEx', 'PYPLx', 'STRCx'].includes(s.symbol))).toBe(false)
    expect(new Set(RETIRED_XSTOCKS.map((r) => r.address.toLowerCase())).size).toBe(RETIRED_XSTOCKS.length)
  })

  it('dosya saf veridir: import yok', () => {
    const kod = yorumsuz(readFileSync(fileURLToPath(new URL('./xStocksRetired.js', import.meta.url)), 'utf8'))
    expect(kod).not.toMatch(/^\s*import\s/m)
    expect(kod).toContain('RETIRED_XSTOCKS')
  })
})

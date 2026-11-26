// KOK NEDEN / KAPATILAN HATA (K28 ilkesinin bStocks karsiligi): e7089f2d (2026-09-29) BMNRB ve FLNCB'yi katalogdan
// cikardi; kapi katalog uyeligine bagli oldugundan iki token kapisiz kaldi ve sunucunun /getChainTokens listesi
// (kayitlar silinmedi) onlari genel Takas'in "Alinan" listesinde sunuyordu: TR / US / AB dahil her ulkeden SWAP
// gonderilebiliyordu. Emekli liste bunlari CIKTI tarafinda tutar ve katalogla ASLA kesismez.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../test-utils/kaynakTarama'
import { RETIRED_BSTOCKS } from './bStocksRetired'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from './bStocks'

describe('emekli bStocks listesi (K28 ilkesi)', () => {
  it('tam iki kayit: BMNRB ve FLNCB, yalniz BSC; adresler e7089f2d ile birebir', () => {
    expect(RETIRED_BSTOCKS.map((r) => `${r.symbol}:${r.address}:${r.chains.join('/')}`)).toEqual([
      'BMNRB:0x3548Da95a9eFFE481e8604664d75e95821e557F5:56',
      'FLNCB:0x4af1D41cd9dD950dcA43984b43aaA2A8702714Ac:56',
    ])
    expect(RETIRED_BSTOCKS.map((r) => r.name)).toEqual(['BitMine Immersion', 'Fluence Energy'])
    for (const r of RETIRED_BSTOCKS) expect(r.chains, r.symbol).toEqual([BSTOCKS_CHAIN_ID])
  })

  it('liste ve her kayit derin donuk', () => {
    expect(Object.isFrozen(RETIRED_BSTOCKS)).toBe(true)
    for (const r of RETIRED_BSTOCKS) {
      expect(Object.isFrozen(r)).toBe(true)
      expect(Object.isFrozen(r.chains)).toBe(true)
    }
  })

  it('emekli adresler KATALOGDA yok (kataloga geri girmez); adresler tekil', () => {
    const adresler = new Set(BSTOCKS.map((s) => s.address.toLowerCase()))
    expect(RETIRED_BSTOCKS.filter((r) => adresler.has(r.address.toLowerCase()))).toEqual([])
    expect(BSTOCKS.some((s) => ['BMNRB', 'FLNCB'].includes(s.symbol))).toBe(false)
    expect(new Set(RETIRED_BSTOCKS.map((r) => r.address.toLowerCase())).size).toBe(RETIRED_BSTOCKS.length)
  })

  it('dosya saf veridir: import yok', () => {
    const kod = yorumsuz(readFileSync(fileURLToPath(new URL('./bStocksRetired.js', import.meta.url)), 'utf8'))
    expect(kod).not.toMatch(/^\s*import\s/m)
    expect(kod).toContain('RETIRED_BSTOCKS')
  })
})

// Hangi okuma fonksiyonunun cagrilacagi (balanceOfUI mi balanceOf mu) ve harcamada ham/UI
// cevriminin gerekip gerekmedigi TEK YERDEN belirlenir: tokenizedStocks.hasUiMultiplier.
// useTokenBalance ve bstocksSpend ayni karari kullanir; biri `isBStock`a geri donerse xStocks
// eklendiginde (stockBalances) iki yol AYRISIR (spec 5.3).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { yorumsuz } from '../test-utils/kaynakTarama'

const here = dirname(fileURLToPath(import.meta.url))
const kod = (rel) => yorumsuz(readFileSync(join(here, rel), 'utf8'))

describe('uiMultiplier karari tek yerde (hasUiMultiplier)', () => {
  it('useTokenBalance karari hasUiMultiplier ile verir, isBStock ile DEGIL', () => {
    const src = kod('../composables/useTokenBalance.js')
    expect(src).toMatch(/import\s*\{\s*hasUiMultiplier\s*\}\s*from\s*["']\.\.\/utils\/tokenizedStocks["']/)
    expect(src).toContain('hasUiMultiplier(chainId, tokenAddress)')
    expect(src).not.toMatch(/\bisBStock\b/)
  })

  it('bstocksSpend dort noktada hasUiMultiplier (harcama x2, zincir cozme, teklif cikti gosterimi) kullanir, isBStock kullanmaz', () => {
    const src = kod('bstocksSpend.js')
    expect(src).toMatch(/import\s*\{\s*hasUiMultiplier\s*\}\s*from\s*['"]\.\/tokenizedStocks['"]/)
    expect(src.match(/hasUiMultiplier\(/g)).toHaveLength(4)
    expect(src).not.toMatch(/\bisBStock\b/)
  })
})

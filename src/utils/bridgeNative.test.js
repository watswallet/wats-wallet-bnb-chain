// LI.FI'ye giden native yer tutucusu.
//
// Cuzdanin ic gosterimi KATI '0x0' (swap.js `isNativeToken` tam esitlik yapar ve
// buildNativeToken bilerek onu uretiyor). LI.FI o degeri TANIMIYOR — 2026-08-20'de
// canlida olculdu ve o gun Polygon'da her kopru teklifi soyle oldu:
//   "Could not find token '0x0' on chain '137'"
// Hata, native varsayilani ekrana gelmeye BASLAYINCA ortaya cikti; oncesinde inToken
// bos kaldigi icin bu yola hic ulasilamiyordu.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ethers } from 'ethers'
import { toLifiToken } from './bridge'

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bridge.js'), 'utf8')

describe('toLifiToken', () => {
  it("cuzdanin '0x0' gosterimi LI.FI icin sifir adrese cevrilir", () => {
    expect(toLifiToken('0x0')).toBe(ethers.ZeroAddress)
  })

  it('zaten sifir adres olan deger degismez', () => {
    expect(toLifiToken(ethers.ZeroAddress)).toBe(ethers.ZeroAddress)
    expect(toLifiToken('0x0000000000000000000000000000000000000000')).toBe(ethers.ZeroAddress)
  })

  it('ERC20 adresi AYNEN gecer (buyuk/kucuk harf korunur)', () => {
    const usdt = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
    expect(toLifiToken(usdt)).toBe(usdt)
  })

  // Cozulemeyen deger native SAYILMAZ: sessizce native'e cevirmek, kullanicinin sectigi
  // tokeni baska bir varlikla degistirmek olurdu.
  it('bos/tanimsiz deger native sayilmaz', () => {
    expect(toLifiToken(undefined)).toBe(undefined)
    expect(toLifiToken('')).toBe('')
  })
})

// Yardimciyi test etmek YETMEZ: cagrildigi yer de kilitlenmeli. Mutasyonla olculdu —
// `quoteParams`tan cevirimi kaldirdim ve yalniz yardimci testleri YESIL kaldi.
describe('cagri yeri', () => {
  it('quoteParams IKI tarafi da cevirir (native->native rotasi da var)', () => {
    expect(SRC).toMatch(/fromToken:\s*toLifiToken\(inToken\.address\)/)
    expect(SRC).toMatch(/toToken:\s*toLifiToken\(outToken\.address\)/)
  })
})

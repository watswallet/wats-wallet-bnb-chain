import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { BSTOCKS, BSTOCKS_CHAIN_ID, BSTOCKS_BEACON, BSTOCKS_BEACON_SLOT, BSTOCKS_COMPLIANCE } from './bStocks'

describe('bStocks kaydi - butunluk', () => {
  it('22 kayit var', () => {
    expect(BSTOCKS).toHaveLength(22)
  })

  it('sabitler zincirde olculen degerlerle ayni', () => {
    expect(BSTOCKS_CHAIN_ID).toBe(56)
    expect(BSTOCKS_BEACON).toBe('0x156d6dce9a4f6139a3406f1f021f1a4880de93a3')
    expect(BSTOCKS_BEACON_SLOT).toBe('0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50')
    expect(BSTOCKS_COMPLIANCE).toBe('0x53dba7aabde774787a1f57236b235567da8e14f4')
  })

  it('her adres EIP-55 checksum biciminde', () => {
    // Istemcide tekillestirme DUZ string karsilastirmasiyla yapilan yerler var
    // (swapTo.vue:295). Karisik bicim ayni tokeni listede IKI KEZ gosterir.
    for (const t of BSTOCKS) {
      expect(t.address).toBe(ethers.getAddress(t.address))
    }
  })

  it('adres, sembol ve coingecko_id benzersiz', () => {
    const uniq = (key) => new Set(BSTOCKS.map((t) => t[key].toLowerCase()))
    expect(uniq('address').size).toBe(BSTOCKS.length)
    expect(uniq('symbol').size).toBe(BSTOCKS.length)
    expect(uniq('coingecko_id').size).toBe(BSTOCKS.length)
  })

  it('hepsi 18 ondalik (zincirde 22/22 dogrulandi)', () => {
    // Yanlis ondalik gosterim degil, DOGRUDAN para kaybi uretir: gonderim
    // ayni carpani kullaniyor.
    for (const t of BSTOCKS) expect(t.decimals).toBe(18)
  })

  it('image NESNE, dize degil', () => {
    // Token.vue:9 dogrudan displayToken?.image.thumb okuyor ve dize bicimini
    // COZEMEZ; detay ekraninda logo dicebear monogramina duser.
    for (const t of BSTOCKS) {
      expect(typeof t.image).toBe('object')
      expect(typeof t.image.large).toBe('string')
      expect(typeof t.image.small).toBe('string')
      expect(typeof t.image.thumb).toBe('string')
      expect(t.image.large).toMatch(/^https:\/\//)
    }
  })

  it('her kayitta ADGM ISIN kodu var', () => {
    for (const t of BSTOCKS) expect(t.isin).toMatch(/^AE000A[0-9A-Z]{6}$/)
  })

  it('coingecko_id ISIMDEN URETILMEZ - desen disi kimlikler korunur', () => {
    // 22'nin 4'u <sirket>-bstocks-tokenized-stock kalibina UYMUYOR.
    // 'nvidia-bstocks-tokenized-stock' tahmini CoinGecko'da 404 veriyor.
    const byId = Object.fromEntries(BSTOCKS.map((t) => [t.symbol, t.coingecko_id]))
    expect(byId.CRCLB).toBe('circle-internet-group-bstock')
    expect(byId.NVDAB).toBe('nvidia-bstocks')
    expect(byId.INTCB).toBe('intel-tokenized-bstocks')
    expect(byId.MSTRB).toBe('strategy-tokenized-bstocks')
  })

  it('kaldiracli ETF ve kimliksiz tokenlar KAYITTA DEGIL', () => {
    const symbols = BSTOCKS.map((t) => t.symbol)
    // Gunluk yeniden dengelenen, uzun vadede deger eriten urunler (spec bolum 3).
    for (const s of ['SOXLB', 'TQQQB', 'SQQQB', 'SOXSB', 'SNXXB']) {
      expect(symbols).not.toContain(s)
    }
    // CoinGecko kaydi yok -> fiyat ve grafik kalici bos (spec bolum 3).
    for (const s of ['MRNAB', 'CRWDB', 'STXB']) {
      expect(symbols).not.toContain(s)
    }
  })
})

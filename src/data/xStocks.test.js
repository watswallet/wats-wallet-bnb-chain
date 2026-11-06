import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getAddress, id, toBeHex } from 'ethers'
import { yorumsuz } from '../test-utils/kaynakTarama'
import supportedChains from './supported_chains.json'
import {
  XSTOCKS, XSTOCKS_CHAIN_IDS, XSTOCKS_IMPLEMENTATIONS, XSTOCKS_IMPL_SLOT,
  XSTOCKS_PLATFORM_BY_CHAIN, XSTOCK_FAMILY_ID,
} from './xStocks'

const here = dirname(fileURLToPath(import.meta.url))

describe('xStocks kaydi - butunluk', () => {
  it('sabitler zincirde olculen degerlerle ayni', () => {
    expect(XSTOCKS_CHAIN_IDS).toEqual([1, 56, 42161])
    // Iki Backed implementasyonu (ayni BackedAutoFeeTokenImplementation kaynak adi, ayni ProxyAdmin ve
    // ayni Safe sahibi; kokeni raporda ve spec 5.11 notunda). UCUNCU bir adres EKLENMEZ.
    expect(XSTOCKS_IMPLEMENTATIONS).toEqual([
      '0x65c40D624Af3B18C109fBF87B7DEff34CdC5f19b',
      '0xd865Ce1B07540b5edE20e8298f48da69770Fe22e',
    ])
    expect(XSTOCKS_IMPL_SLOT).toBe('0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc')
  })

  it('EIP-1967 slotu keccak256(eip1967.proxy.implementation) - 1 degerinden TURETILEN degerdir', () => {
    expect(toBeHex(BigInt(id('eip1967.proxy.implementation')) - 1n, 32)).toBe(XSTOCKS_IMPL_SLOT)
  })

  it('implementasyon ve her hisse adresi EIP-55 checksum biciminde', () => {
    // Istemcide tekillestirme duz string karsilastirmasiyla yapilan yerler var: karisik bicim
    // ayni tokeni listede IKI KEZ gosterir.
    for (const impl of XSTOCKS_IMPLEMENTATIONS) expect(impl).toBe(getAddress(impl))
    expect(new Set(XSTOCKS_IMPLEMENTATIONS.map((a) => a.toLowerCase())).size).toBe(XSTOCKS_IMPLEMENTATIONS.length)
    for (const s of XSTOCKS) expect(s.address, s.symbol).toBe(getAddress(s.address))
  })

  it('adres, sembol ve coingeckoId benzersiz', () => {
    const uniq = (pick) => new Set(XSTOCKS.map((s) => pick(s).toLowerCase()))
    expect(uniq((s) => s.address).size).toBe(XSTOCKS.length)
    expect(uniq((s) => s.symbol).size).toBe(XSTOCKS.length)
    expect(uniq((s) => s.coingeckoId).size).toBe(XSTOCKS.length)
  })

  it('hepsi 18 ondalik ve issuer xstocks', () => {
    // Yanlis ondalik gosterim degil, DOGRUDAN para kaybi uretir.
    for (const s of XSTOCKS) {
      expect(s.decimals, s.symbol).toBe(18)
      expect(s.issuer, s.symbol).toBe('xstocks')
    }
  })

  it('chains: bos degil, tekrarsiz ve XSTOCKS_CHAIN_IDS alt kumesi', () => {
    for (const s of XSTOCKS) {
      expect(s.chains.length, s.symbol).toBeGreaterThan(0)
      expect(new Set(s.chains).size, s.symbol).toBe(s.chains.length)
      for (const chainId of s.chains) expect(XSTOCKS_CHAIN_IDS, `${s.symbol} ${chainId}`).toContain(chainId)
    }
  })

  it('Base, Gnosis, Polygon, Optimism ve Mantle katalogda YOK (token yok ya da alim yolu yok)', () => {
    for (const s of XSTOCKS) {
      for (const bad of [8453, 100, 137, 10, 5000]) expect(s.chains, s.symbol).not.toContain(bad)
    }
  })

  it('platform haritasi supported_chains.json chainSlug ile AYNI ve uc zincir de cuzdanda tanimli', () => {
    for (const chainId of XSTOCKS_CHAIN_IDS) {
      const chain = supportedChains.find((c) => c.chainId === chainId)
      expect(chain, `zincir ${chainId} cuzdanda yok`).toBeTruthy()
      expect(XSTOCKS_PLATFORM_BY_CHAIN[chainId]).toBe(chain.chainSlug)
    }
    expect(Object.keys(XSTOCKS_PLATFORM_BY_CHAIN).map(Number)).toEqual(XSTOCKS_CHAIN_IDS)
  })

  it('coingeckoId -xstock ile biter, wrapped- ile BASLAMAZ ve XSTOCK_FAMILY_ID hepsini yakalar', () => {
    // wrapped-*-xstock (ERC-4626 sarmalayici) KATALOGA GIRMEZ; ama sunucu korumasi onu da kapsar.
    for (const s of XSTOCKS) {
      expect(s.coingeckoId, s.symbol).toMatch(/-xstock$/)
      expect(s.coingeckoId.startsWith('wrapped-'), s.symbol).toBe(false)
      expect(XSTOCK_FAMILY_ID.test(s.coingeckoId), s.symbol).toBe(true)
    }
    expect(XSTOCK_FAMILY_ID.test('wrapped-tesla-xstock')).toBe(true)
    expect(XSTOCK_FAMILY_ID.test('tether')).toBe(false)
    // Desen '-xstock' SONEKI ister: tireyi atan ya da sonuna harf ekleyen kimlikler hisse ailesi SAYILMAZ.
    expect(XSTOCK_FAMILY_ID.test('foxstock')).toBe(false)
    expect(XSTOCK_FAMILY_ID.test('tesla-xstocks')).toBe(false)
  })

  it('katalogda logo / image alani YOK (ihracci kullanim sartlari md. 6)', () => {
    for (const s of XSTOCKS) expect('image' in s, s.symbol).toBe(false)
  })

  it('dosya hicbir sey import etmez (saf veri; Node betikleri ve sunucu dogrudan okur)', () => {
    const kaynak = yorumsuz(readFileSync(join(here, 'xStocks.js'), 'utf8'))
    expect(kaynak).not.toMatch(/^\s*import\s/m)
  })

  // KATALOG ICERIGI: verify:xstocks olcum 3 (2026-10-13 14:15-16:45 UTC, piyasa acik) ve kullanici
  // onayi. Katalog degisikligi insan onayi ister: BU TEST KASITLI olarak ayni commit'te guncellenir.
  // SLVx, GSx ve MRKx olcumde gecti ama onaylanmadi (simetrik satis kilidi Faz 2): katalogda YOK.
  it('baslangic icerigi: 21 hisse; BSC 13 hisse, Arbitrum yalniz MSTRx (TSLAx, NVDAx ve SPYx Arbitrum disi)', () => {
    expect(XSTOCKS.map((s) => `${s.symbol}:${s.chains.join('/')}`)).toEqual([
      'TSLAx:1/56', 'NVDAx:1/56', 'SPYx:1/56', 'AAPLx:1',
      'QQQx:1', 'GOOGLx:1', 'MSTRx:1/56/42161', 'COINx:1',
      'AMZNx:1/56', 'MSFTx:1/56', 'AVGOx:1/56', 'Vx:1/56',
      'KOx:1/56', 'MUx:1',
      'MRNAx:1/56', 'CRCLx:1/56', 'GLXYx:1', 'BSPx:1/56',
      'VTx:1', 'VTIx:56', 'COPXx:1',
    ])
  })

  it('2026-10-21 karari: ADBEx, PYPLx, STRCx katalogda YOK; GLXYx kaldi', () => {
    const semboller = XSTOCKS.map((s) => s.symbol)
    for (const c of ['ADBEx', 'PYPLx', 'STRCx']) expect(semboller).not.toContain(c)
    expect(semboller).toContain('GLXYx')
  })

  it('olculen adresler ve CoinGecko kimlikleri (spec Ek A.1 ve olcum 3) kayitta', () => {
    const by = Object.fromEntries(XSTOCKS.map((s) => [s.symbol, s]))
    expect(by.TSLAx).toMatchObject({ address: '0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0', coingeckoId: 'tesla-xstock' })
    expect(by.NVDAx).toMatchObject({ address: '0xc845b2894dBddd03858fd2D643B4eF725fE0849d', coingeckoId: 'nvidia-xstock' })
    expect(by.SPYx).toMatchObject({ address: '0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48', coingeckoId: 'sp500-xstock' })
    expect(by.AAPLx).toMatchObject({ address: '0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a', coingeckoId: 'apple-xstock' })
    expect(by.QQQx).toMatchObject({ address: '0xa753A7395cAe905Cd615Da0B82A53E0560f250af', coingeckoId: 'nasdaq-xstock' })
    expect(by.GOOGLx).toMatchObject({ address: '0xe92f673Ca36C5E2Efd2DE7628f815f84807e803F', coingeckoId: 'alphabet-xstock' })
    expect(by.MSTRx).toMatchObject({ address: '0xAE2f842EF90C0d5213259Ab82639D5BBF649b08E', coingeckoId: 'microstrategy-xstock' })
    expect(by.COINx).toMatchObject({ address: '0x364f210f430eC2448Fc68A49203040F6124096F0', coingeckoId: 'coinbase-xstock' })
    expect(by.AMZNx).toMatchObject({ address: '0x3557Ba345B01EFa20A1bdDC61F573BFD87195081', coingeckoId: 'amazon-xstock' })
    expect(by.MSFTx).toMatchObject({ address: '0x5621737f42dAE558b81269FcB9E9E70c19Aa6b35', coingeckoId: 'microsoft-xstock' })
    expect(by.AVGOx).toMatchObject({ address: '0x38BAC69cbBd28156796e4163B2B6dcb81E336565', coingeckoId: 'broadcom-xstock' })
    expect(by.Vx).toMatchObject({ address: '0x2363FD1235C1B6d3A5088DdF8dF3A0b3A30C5293', coingeckoId: 'visa-xstock' })
    expect(by.KOx).toMatchObject({ address: '0xdCC1a2699441079dA889B1F49e12B69cC791129b', coingeckoId: 'coca-cola-xstock' })
    expect(by.MUx).toMatchObject({ address: '0xf6a873BAe4Ba1B304e45dF52A4b7D176E1C6a8c4', coingeckoId: 'micron-technology-xstock' })
    expect(by.MRNAx).toMatchObject({ address: '0xeFD30445A4ec1f4b3E0a6f4d9bDbd215F805047F', coingeckoId: 'moderna-xstock' })
    expect(by.CRCLx).toMatchObject({ address: '0xfEbDEd1B0986a8ee107f5AB1a1c5a813491DeCEB', coingeckoId: 'circle-xstock' })
    expect(by.GLXYx).toMatchObject({ address: '0xf7F4fAC56f012dE7Dd6adFF54C761986B9E0655a', coingeckoId: 'galaxy-digital-xstock' })
    expect(by.BSPx).toMatchObject({ address: '0x7796F4E23a62eF3653829c21032A9E24bEaf4Cf5', coingeckoId: 'bending-spoons-xstock' })
    expect(by.VTx).toMatchObject({ address: '0x6d5edEEbBc6A4099Eb8bb289EB3b80D799f7b28C', coingeckoId: 'vanguard-total-world-xstock' })
    expect(by.VTIx).toMatchObject({ address: '0xbD730E618bcD88C82dDeE52e10275CF2f88A4777', coingeckoId: 'vanguard-xstock' })
    expect(by.COPXx).toMatchObject({ address: '0x89BAB39D627A9e34f0dc782C53457e80Ee8Fb9D9', coingeckoId: 'global-x-copper-miners-xstock' })
  })
})

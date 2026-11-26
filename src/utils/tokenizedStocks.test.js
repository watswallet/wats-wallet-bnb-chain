// tokenizedStocks.js -- bStocks + xStocks ortak kayit tablosu ve eksen fonksiyonlari. Saf katman:
// RPC yok. bStocks sonuclari DEGISMEDI (isBStock ile birebir ayni); xStocks'ta "tokenize hisse mi"
// evet, "uiMultiplier var mi" hayir.
//
// Katalogun anlik icerigine (hisse sayisi, hangi hissenin hangi zincirde oldugu) SABITLENMEZ:
// beklenenler XSTOCKS'tan turetilir.
import { describe, it, expect } from 'vitest'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'
import { XSTOCKS, XSTOCKS_CHAIN_IDS } from '../data/xStocks'
import { RETIRED_XSTOCKS } from '../data/xStocksRetired'
import { RETIRED_BSTOCKS } from '../data/bStocksRetired'
import { isBStock, bStockImportIdentity } from './bstocks'
import {
  stockKey, stockEntry, stockIssuer, hasUiMultiplier, isBridgeBlocked, isBridgeTargetBlocked,
  isGeneralSwapExcluded, stockIssuerInfo, stockImportIdentity, isXstockFamilyId, stocksByChain, bridgeStockChainIds,
  XSTOCK_EXISTENCE_CHAIN_IDS, isRetiredXstock, isRetiredBstock, stockOutputIssuer, isGeneralSwapOutputExcluded,
} from './tokenizedStocks'

// Tum xStocks zincirlerinde listelenen bir hisse (uc zincirde ayni adres).
const TSLA = XSTOCKS.find((s) => s.symbol === 'TSLAx')
// Yalniz tek zincirde listelenen bir hisse (G2: sembole degil `chains` sekline gore secilir).
const TEK = XSTOCKS.find((s) => s.chains.length === 1)
const GOOGLB = BSTOCKS.find((s) => s.symbol === 'GOOGLB')
// Base'deki gibi katalog DISI taklit kontrat.
const SAHTE = '0x2a173c0300000000000000000000000000000000'
// Hisse listelenmeyen ama dislama kapsaminda olan bir zincir (TEK icin).
const TEK_DISI_ZINCIR = XSTOCKS_CHAIN_IDS.find((c) => !TEK.chains.includes(c))
const xstocksOn = (chainId) => XSTOCKS.filter((s) => s.chains.includes(chainId))

describe('test on kosullari (katalogdan turetilir)', () => {
  it('TSLA, TEK, GOOGLB bulundu ve tek zincirli hisse icin listelenmeyen bir zincir var', () => {
    expect(TSLA.chains.length).toBeGreaterThan(1)
    expect(TEK).toBeDefined()
    expect(TEK_DISI_ZINCIR).toBeDefined()
    expect(GOOGLB).toBeDefined()
  })
})

describe('stockKey', () => {
  it('zinciri icerir ve adresi kucuk harfe indirir', () => {
    expect(stockKey(1, TSLA.address)).toBe(`1:${TSLA.address.toLowerCase()}`)
    expect(stockKey('56', TSLA.address.toUpperCase().replace('0X', '0x'))).toBe(`56:${TSLA.address.toLowerCase()}`)
  })
})

describe('stockEntry / stockIssuer (eksen a)', () => {
  it('bStocks: tum kayitlarin HEPSI isBStock ile ayni sonucu verir (davranis degismedi)', () => {
    for (const b of BSTOCKS) {
      expect(isBStock(BSTOCKS_CHAIN_ID, b.address)).toBe(true)
      expect(stockIssuer(BSTOCKS_CHAIN_ID, b.address)).toBe('bstocks')
      expect(stockIssuer(String(BSTOCKS_CHAIN_ID), b.address.toLowerCase())).toBe('bstocks')
      expect(stockIssuer(1, b.address)).toBeNull()
    }
  })

  // Review Focus 1: AYNI adres uc zincirde; indeks zinciri de icermeli.
  it('Review Focus 1: xStocks ayni adresi listelendigi HER zincirde cozer, digerinde cozmez', () => {
    for (const chainId of TSLA.chains) expect(stockIssuer(chainId, TSLA.address), String(chainId)).toBe('xstocks')
    expect(stockIssuer(137, TSLA.address)).toBeNull()
    expect(stockIssuer(8453, TSLA.address)).toBeNull()
    // Tek zincirli hissenin AYNI adresi baska zincirde hisse SAYILMAZ (rozet kapsami `chains`).
    for (const chainId of TEK.chains) expect(stockIssuer(chainId, TEK.address)).toBe('xstocks')
    expect(stockIssuer(TEK_DISI_ZINCIR, TEK.address)).toBeNull()
    expect(stockIssuer(String(TSLA.chains[TSLA.chains.length - 1]), TSLA.address.toLowerCase())).toBe('xstocks')
  })

  it('isBStock YALNIZ bStocks icin true: xStocks icin false (eski sozlesme)', () => {
    for (const chainId of TSLA.chains) expect(isBStock(chainId, TSLA.address)).toBe(false)
  })

  it('bos ve bozuk girdide patlamaz', () => {
    expect(stockIssuer(56, undefined)).toBeNull()
    expect(stockIssuer(56, null)).toBeNull()
    expect(stockIssuer(56, '')).toBeNull()
    expect(stockIssuer(undefined, TSLA.address)).toBeNull()
    expect(stockIssuer('solana-mainnet', TSLA.address)).toBeNull()
    expect(stockEntry(1, '0x0')).toBeNull()
  })

  it('kayit sekli iki ihracci icin AYNI ve donuk', () => {
    const x = stockEntry(TSLA.chains[0], TSLA.address)
    expect(x).toEqual({
      issuer: 'xstocks', chainId: TSLA.chains[0], symbol: TSLA.symbol, name: TSLA.name, address: TSLA.address,
      decimals: TSLA.decimals, coingeckoId: TSLA.coingeckoId, image: null, isin: null, scaled: false,
      underlying: TSLA.underlying,
    })
    expect(Object.isFrozen(x)).toBe(true)

    const b = stockEntry(BSTOCKS_CHAIN_ID, GOOGLB.address)
    expect(b).toMatchObject({
      issuer: 'bstocks', chainId: BSTOCKS_CHAIN_ID, symbol: 'GOOGLB', coingeckoId: GOOGLB.coingecko_id,
      isin: GOOGLB.isin, image: GOOGLB.image, scaled: true, underlying: 'GOOGL',
    })
    expect(Object.keys(b).sort()).toEqual(Object.keys(x).sort())
  })
})

describe('hasUiMultiplier (eksen b)', () => {
  it('bStocks true (balanceOfUI); xStocks false (balanceOf ZATEN carpanli, uiMultiplier() yok)', () => {
    expect(hasUiMultiplier(BSTOCKS_CHAIN_ID, GOOGLB.address)).toBe(true)
    for (const chainId of TSLA.chains) expect(hasUiMultiplier(chainId, TSLA.address), String(chainId)).toBe(false)
    expect(hasUiMultiplier(1, GOOGLB.address)).toBe(false)
    expect(hasUiMultiplier(56, SAHTE)).toBe(false)
  })
})

describe('XSTOCK_EXISTENCE_CHAIN_IDS (dislama kapsami, ayrim: A-1)', () => {
  it('bes zincir: Ethereum, BSC, Arbitrum, Optimism, Mantle; Polygon ve Base YOK', () => {
    expect([...XSTOCK_EXISTENCE_CHAIN_IDS].sort((a, b) => a - b)).toEqual([1, 10, 56, 5000, 42161])
    expect(XSTOCK_EXISTENCE_CHAIN_IDS).not.toContain(137)
    expect(XSTOCK_EXISTENCE_CHAIN_IDS).not.toContain(8453)
  })

  it('urun kapsami (xStocks zincirleri) dislama kapsaminin icinde', () => {
    for (const chainId of XSTOCKS_CHAIN_IDS) expect(XSTOCK_EXISTENCE_CHAIN_IDS).toContain(chainId)
  })
})

describe('kopru ve takas kapilari (eksen c)', () => {
  it('KAYNAK: iki ihracci da kopruden dislanir, katalog disi adres dislanmaz', () => {
    expect(isBridgeBlocked(BSTOCKS_CHAIN_ID, GOOGLB.address)).toBe(true)
    for (const chainId of TSLA.chains) expect(isBridgeBlocked(chainId, TSLA.address), String(chainId)).toBe(true)
    expect(isBridgeBlocked(137, TSLA.address)).toBe(false)
    expect(isBridgeBlocked(56, SAHTE)).toBe(false)
    expect(isBridgeBlocked(1, GOOGLB.address)).toBe(false)
  })

  it('HEDEF: bStocks ACIK kalir (LI.FI rotaliyor), xStocks KAPALI (K2)', () => {
    expect(isBridgeTargetBlocked(BSTOCKS_CHAIN_ID, GOOGLB.address)).toBe(false)
    for (const chainId of TSLA.chains) expect(isBridgeTargetBlocked(chainId, TSLA.address), String(chainId)).toBe(true)
    expect(isBridgeTargetBlocked(137, TSLA.address)).toBe(false)
  })

  it('genel Takas: bStocks KALIR, xStocks dislanir', () => {
    expect(isGeneralSwapExcluded(BSTOCKS_CHAIN_ID, GOOGLB.address)).toBe(false)
    for (const chainId of TSLA.chains) expect(isGeneralSwapExcluded(chainId, TSLA.address), String(chainId)).toBe(true)
    expect(isGeneralSwapExcluded(137, TSLA.address)).toBe(false)
  })

  // A-1: dislama `chains`e degil, tokenin var oldugu bes zincire bakar.
  it('A-1: katalog adresi `chains`inde olmayan zincirde de (bes zincirin hepsinde) uc kapidan dislanir', () => {
    // Onkosul: bu (hisse, zincir) cifti katalogda YOK; yani rozet/satir kapsami disi.
    expect(TEK.chains).not.toContain(TEK_DISI_ZINCIR)
    expect(stockIssuer(TEK_DISI_ZINCIR, TEK.address)).toBeNull()
    for (const chainId of XSTOCK_EXISTENCE_CHAIN_IDS) {
      expect(isGeneralSwapExcluded(chainId, TEK.address), `takas ${chainId}`).toBe(true)
      expect(isBridgeBlocked(chainId, TEK.address), `kopru kaynak ${chainId}`).toBe(true)
      expect(isBridgeTargetBlocked(chainId, TEK.address), `kopru hedef ${chainId}`).toBe(true)
    }
    expect(isGeneralSwapExcluded(String(TEK_DISI_ZINCIR), TEK.address.toLowerCase())).toBe(true)
  })

  it('A-1: Polygon ve Base (dislama kapsami disi) ve katalog disi adres DISLANMAZ', () => {
    for (const chainId of [137, 8453]) {
      expect(isGeneralSwapExcluded(chainId, TEK.address), `takas ${chainId}`).toBe(false)
      expect(isBridgeBlocked(chainId, TEK.address), `kopru kaynak ${chainId}`).toBe(false)
      expect(isBridgeTargetBlocked(chainId, TEK.address), `kopru hedef ${chainId}`).toBe(false)
    }
    for (const chainId of XSTOCK_EXISTENCE_CHAIN_IDS) {
      expect(isGeneralSwapExcluded(chainId, SAHTE)).toBe(false)
      expect(isBridgeBlocked(chainId, SAHTE)).toBe(false)
      expect(isBridgeTargetBlocked(chainId, SAHTE)).toBe(false)
    }
  })

  it('bos ve bozuk girdide patlamaz, dislanmaz', () => {
    for (const fn of [isGeneralSwapExcluded, isBridgeBlocked, isBridgeTargetBlocked]) {
      expect(fn(1, undefined)).toBe(false)
      expect(fn(1, '')).toBe(false)
      expect(fn(undefined, TSLA.address)).toBe(false)
      expect(fn('solana-mainnet', TSLA.address)).toBe(false)
    }
  })
})

// KOK NEDEN / KAPATILAN HATA (K28): 9fb92682 (2026-10-21) ADBEx, PYPLx ve STRCx'i katalogdan cikarinca stockIssuer null
// dondu ve isXstockExcludedAddress (katalog uyeligine bagli) onlari birakti: BSC'de PYPLx kapisiz ve dislamasiz
// alinabiliyordu. Emekli adresler CIKTI (edinme) tarafinda xstocks sayilir; GIRDI (Sat) tarafi ve katalog
// tuketicileri (stockEntry, Hisseler sekmesi, bridgeStockChainIds) DEGISMEZ.
describe('emekli xStocks adresleri (K28)', () => {
  const emekli = (sembol) => RETIRED_XSTOCKS.find((r) => r.symbol === sembol)
  const PYPLx = emekli('PYPLx')
  const ADBEx = emekli('ADBEx')
  const STRCx = emekli('STRCx')

  it('pozitif bekci: uc emekli kayit bulundu ve hicbiri katalogda degil', () => {
    expect(PYPLx && ADBEx && STRCx).toBeTruthy()
    expect(RETIRED_XSTOCKS).toHaveLength(3)
    const katalog = new Set(XSTOCKS.map((s) => s.address.toLowerCase()))
    expect(RETIRED_XSTOCKS.filter((r) => katalog.has(r.address.toLowerCase()))).toEqual([])
  })

  it('stockOutputIssuer: emekli adres var olunan HER zincirde xstocks (kucuk harf ve chainId metin dahil)', () => {
    for (const r of RETIRED_XSTOCKS) {
      for (const chainId of XSTOCK_EXISTENCE_CHAIN_IDS) {
        expect(stockOutputIssuer(chainId, r.address), `${r.symbol} ${chainId}`).toBe('xstocks')
      }
      for (const chainId of r.chains) expect(stockOutputIssuer(chainId, r.address.toLowerCase()), `${r.symbol} kucuk ${chainId}`).toBe('xstocks')
    }
    expect(stockOutputIssuer('56', PYPLx.address)).toBe('xstocks')
    // var olunmayan zincirlerde (Polygon, Base) ayni adres hisse SAYILMAZ
    for (const chainId of [137, 8453]) expect(stockOutputIssuer(chainId, PYPLx.address), String(chainId)).toBeNull()
  })

  it('stockOutputIssuer katalog hisselerini AYNEN doner ve bozuk girdide null (firlatmaz)', () => {
    expect(stockOutputIssuer(BSTOCKS_CHAIN_ID, GOOGLB.address)).toBe('bstocks')
    expect(stockOutputIssuer(1, TSLA.address)).toBe('xstocks')
    expect(stockOutputIssuer(1, SAHTE)).toBeNull()
    for (const bozuk of [undefined, null, '', 'b', 5, {}]) expect(stockOutputIssuer(1, bozuk), String(bozuk)).toBeNull()
    expect(stockOutputIssuer(undefined, PYPLx.address)).toBeNull()
    expect(stockOutputIssuer('solana-mainnet', PYPLx.address)).toBeNull()
  })

  it('GIRDI tarafi acik (K28): stockIssuer, stockEntry, isGeneralSwapExcluded ve isBridgeBlocked emekli adresi TANIMAZ', () => {
    for (const r of RETIRED_XSTOCKS) {
      for (const chainId of r.chains) {
        expect(stockIssuer(chainId, r.address), `${r.symbol} ${chainId} stockIssuer`).toBeNull()
        expect(stockEntry(chainId, r.address), `${r.symbol} ${chainId} stockEntry`).toBeNull()
        expect(isGeneralSwapExcluded(chainId, r.address), `${r.symbol} ${chainId} takas`).toBe(false)
        expect(isBridgeBlocked(chainId, r.address), `${r.symbol} ${chainId} kopru kaynak`).toBe(false)
      }
    }
  })

  it('katalog gorunumleri degismez: Hisseler sekmesi emekli adresi icermez, bridgeStockChainIds hala [56]', () => {
    const adresler = stocksByChain({ includeXstocks: true }).flatMap((g) => g.rows).map((r) => r.address.toLowerCase())
    for (const r of RETIRED_XSTOCKS) expect(adresler, r.symbol).not.toContain(r.address.toLowerCase())
    expect(bridgeStockChainIds()).toEqual([56])
  })

  it('CIKTI dislamasi: isBridgeTargetBlocked ve isGeneralSwapOutputExcluded emekli adresi kapatir', () => {
    expect(isBridgeTargetBlocked(56, PYPLx.address)).toBe(true)
    expect(isBridgeTargetBlocked(1, PYPLx.address)).toBe(true)
    expect(isBridgeTargetBlocked(1, ADBEx.address)).toBe(true)
    expect(isBridgeTargetBlocked(1, STRCx.address.toLowerCase())).toBe(true)
    expect(isGeneralSwapOutputExcluded(56, PYPLx.address)).toBe(true)
    expect(isGeneralSwapOutputExcluded(1, ADBEx.address)).toBe(true)
    // var olunmayan zincirde engellenmez
    for (const chainId of [137, 8453]) {
      expect(isBridgeTargetBlocked(chainId, PYPLx.address), `kopru ${chainId}`).toBe(false)
      expect(isGeneralSwapOutputExcluded(chainId, PYPLx.address), `takas ${chainId}`).toBe(false)
    }
  })

  it('isGeneralSwapOutputExcluded katalog xStocks i kapatir, bStocks i ve katalog disi taklidi kapatmaz (isGeneralSwapExcluded ile ayni)', () => {
    expect(isGeneralSwapOutputExcluded(1, TSLA.address)).toBe(true)
    expect(isGeneralSwapOutputExcluded(BSTOCKS_CHAIN_ID, GOOGLB.address)).toBe(false)
    for (const chainId of XSTOCK_EXISTENCE_CHAIN_IDS) expect(isGeneralSwapOutputExcluded(chainId, SAHTE)).toBe(false)
    for (const fn of [isGeneralSwapOutputExcluded, isRetiredXstock]) {
      expect(fn(1, undefined)).toBe(false)
      expect(fn(1, '')).toBe(false)
      expect(fn(undefined, PYPLx.address)).toBe(false)
      expect(fn('solana-mainnet', PYPLx.address)).toBe(false)
    }
  })

  it('isRetiredXstock: var olunan zincirde true (buyuk / kucuk harf), Polygon / Base ve katalog hissesi icin false', () => {
    expect(isRetiredXstock(56, PYPLx.address)).toBe(true)
    expect(isRetiredXstock('56', PYPLx.address.toUpperCase().replace('0X', '0x'))).toBe(true)
    expect(isRetiredXstock(42161, ADBEx.address)).toBe(true) // chains alanina degil var olunan zincirlere bakar
    expect(isRetiredXstock(8453, PYPLx.address)).toBe(false)
    expect(isRetiredXstock(1, TSLA.address)).toBe(false)
  })
})

// KOK NEDEN / KAPATILAN HATA (K28 ilkesinin bStocks karsiligi): e7089f2d (2026-09-29) BMNRB ve FLNCB'yi katalogdan
// cikarinca stockIssuer null dondu; token zincirde ve /getChainTokens listesinde kaldigindan genel Takas'ta kapisiz
// alinabiliyordu. Emekli bStocks adresleri CIKTI tarafinda bstocks sayilir; GIRDI (Sat) tarafi, katalog tuketicileri
// ve genel Takas / Kopru DISLAMASI (xStocks'a ozgu) DEGISMEZ: bStocks acik kalir, karar kapidadir.
describe('emekli bStocks adresleri (K28 ilkesi)', () => {
  const BMNRB = RETIRED_BSTOCKS.find((r) => r.symbol === 'BMNRB')
  const FLNCB = RETIRED_BSTOCKS.find((r) => r.symbol === 'FLNCB')

  it('pozitif bekci: iki emekli kayit bulundu ve hicbiri katalogda degil', () => {
    expect(BMNRB && FLNCB).toBeTruthy()
    expect(RETIRED_BSTOCKS).toHaveLength(2)
    const katalog = new Set(BSTOCKS.map((s) => s.address.toLowerCase()))
    expect(RETIRED_BSTOCKS.filter((r) => katalog.has(r.address.toLowerCase()))).toEqual([])
  })

  it('stockOutputIssuer: emekli adres BSC\'de bstocks (kucuk / buyuk harf ve chainId metin dahil), baska zincirde null', () => {
    for (const r of RETIRED_BSTOCKS) {
      expect(stockOutputIssuer(BSTOCKS_CHAIN_ID, r.address), r.symbol).toBe('bstocks')
      expect(stockOutputIssuer(BSTOCKS_CHAIN_ID, r.address.toLowerCase()), `${r.symbol} kucuk`).toBe('bstocks')
      expect(stockOutputIssuer(String(BSTOCKS_CHAIN_ID), r.address.toUpperCase().replace('0X', '0x')), `${r.symbol} buyuk`).toBe('bstocks')
      expect(isRetiredBstock(BSTOCKS_CHAIN_ID, r.address), `${r.symbol} isRetiredBstock`).toBe(true)
      // bStocks yalniz BSC'de var: ayni adres baska zincirde hisse SAYILMAZ
      for (const chainId of [1, 137, 8453, 42161, 10, 5000]) {
        expect(stockOutputIssuer(chainId, r.address), `${r.symbol} ${chainId}`).toBeNull()
        expect(isRetiredBstock(chainId, r.address), `${r.symbol} ${chainId} isRetiredBstock`).toBe(false)
      }
    }
  })

  it('bozuk girdide null / false (firlatmaz); katalog hisseleri AYNEN doner; emekli xStocks hala xstocks', () => {
    for (const bozuk of [undefined, null, '', 'b', 5, {}]) {
      expect(stockOutputIssuer(BSTOCKS_CHAIN_ID, bozuk), String(bozuk)).toBeNull()
      expect(isRetiredBstock(BSTOCKS_CHAIN_ID, bozuk), String(bozuk)).toBe(false)
    }
    expect(stockOutputIssuer(undefined, BMNRB.address)).toBeNull()
    expect(stockOutputIssuer('solana-mainnet', BMNRB.address)).toBeNull()
    expect(stockOutputIssuer(BSTOCKS_CHAIN_ID, GOOGLB.address)).toBe('bstocks')
    expect(stockOutputIssuer(1, TSLA.address)).toBe('xstocks')
    expect(stockOutputIssuer(BSTOCKS_CHAIN_ID, RETIRED_XSTOCKS.find((r) => r.symbol === 'PYPLx').address)).toBe('xstocks')
    expect(isRetiredBstock(BSTOCKS_CHAIN_ID, GOOGLB.address)).toBe(false)
  })

  it('GIRDI tarafi ve katalog gorunumleri acik (K4, K35): stockIssuer, stockEntry, hasUiMultiplier, isGeneralSwapExcluded, isBridgeBlocked TANIMAZ', () => {
    for (const r of RETIRED_BSTOCKS) {
      expect(stockIssuer(BSTOCKS_CHAIN_ID, r.address), `${r.symbol} stockIssuer`).toBeNull()
      expect(stockEntry(BSTOCKS_CHAIN_ID, r.address), `${r.symbol} stockEntry`).toBeNull()
      expect(hasUiMultiplier(BSTOCKS_CHAIN_ID, r.address), `${r.symbol} uiMultiplier`).toBe(false)
      expect(isGeneralSwapExcluded(BSTOCKS_CHAIN_ID, r.address), `${r.symbol} takas`).toBe(false)
      expect(isBridgeBlocked(BSTOCKS_CHAIN_ID, r.address), `${r.symbol} kopru kaynak`).toBe(false)
    }
    const adresler = stocksByChain({ includeXstocks: true }).flatMap((g) => g.rows).map((r) => r.address.toLowerCase())
    for (const r of RETIRED_BSTOCKS) expect(adresler, r.symbol).not.toContain(r.address.toLowerCase())
    expect(bridgeStockChainIds()).toEqual([56])
  })

  it('DISLAMA YOK (bilincli karar): isGeneralSwapOutputExcluded ve isBridgeTargetBlocked emekli bStocks adresini kapatmaz; kapi sorar', () => {
    // xStocks'un aksine bStocks genel Takas / Kopru hedefinde acik kalir (PancakeSwap rotasi gercek); uygun olmayan ulke
    // kapidan (stockOutputIssuer 'bstocks') reddedilir. Dislamaya cevirmek urun karari: ayni commit'te bu test degisir.
    for (const r of RETIRED_BSTOCKS) {
      expect(isGeneralSwapOutputExcluded(BSTOCKS_CHAIN_ID, r.address), `${r.symbol} takas`).toBe(false)
      expect(isBridgeTargetBlocked(BSTOCKS_CHAIN_ID, r.address), `${r.symbol} kopru`).toBe(false)
    }
  })
})

// KOK NEDEN / KAPATILAN HATA (main senkron B-F1): hisse arama anahtari tam dize esitligiydi. 0x on eki OLMAYAN 40 onaltili hane
// (ethers.getAddress ve Contract bunu ayni adres sayar) ya da kenarinda bosluk olan adres hisse taninmazdi: kapi gecer, arka plan
// 'queued' kaydi yazip motoru kurardi (K36 ihlali). Tek normallestirici (normalizeStockAddress) anahtarin ve uc dislama
// kumesinin ortak girisidir; yanlis pozitif (hisse sanilan hisse-olmayan) yalniz Al'i reddeder, yanlis negatif kapiyi acar.
describe('hisse adresi yazimi: 0x on eki ve kenar bosluk kapiyi atlatamaz (B-F1)', () => {
  const RETIRED_PYPLX = RETIRED_XSTOCKS.find((r) => r.symbol === 'PYPLx')
  const RETIRED_BMNRB = RETIRED_BSTOCKS.find((r) => r.symbol === 'BMNRB')
  const varyantlar = (adres) => [
    ['0x on eki yok', adres.slice(2)],
    ['0x on eki yok, buyuk harf', adres.slice(2).toUpperCase()],
    ['kenar bosluk', `  ${adres}  `],
    ['0x on eki yok + bosluk + satir sonu', ` ${adres.slice(2)}\n`],
    ['buyuk 0X on eki', `0X${adres.slice(2)}`],
  ]
  const kabuller = [
    ['katalog bStock', BSTOCKS_CHAIN_ID, GOOGLB.address, 'bstocks'],
    ['katalog xStock (Ethereum)', 1, TSLA.address, 'xstocks'],
    ['emekli xStock (BSC)', 56, RETIRED_PYPLX.address, 'xstocks'],
    ['emekli bStock (BSC)', BSTOCKS_CHAIN_ID, RETIRED_BMNRB.address, 'bstocks'],
  ]

  it('pozitif bekci: kanonik yazim dort grupta da beklenen ihraccidir', () => {
    for (const [ad, chainId, adres, ihracci] of kabuller) expect(stockOutputIssuer(chainId, adres), ad).toBe(ihracci)
  })

  it.each(kabuller)('%s: her yazim varyanti ayni ihraccidir; stockKey ve dislama kumeleri kanonikle ayni', (_ad, chainId, adres, ihracci) => {
    for (const [vad, v] of varyantlar(adres)) {
      expect(stockOutputIssuer(chainId, v), vad).toBe(ihracci)
      expect(stockKey(chainId, v), `${vad} stockKey`).toBe(stockKey(chainId, adres))
      expect(isGeneralSwapOutputExcluded(chainId, v), `${vad} takas cikti`).toBe(isGeneralSwapOutputExcluded(chainId, adres))
      expect(isBridgeTargetBlocked(chainId, v), `${vad} kopru hedef`).toBe(isBridgeTargetBlocked(chainId, adres))
      expect(isBridgeBlocked(chainId, v), `${vad} kopru kaynak`).toBe(isBridgeBlocked(chainId, adres))
      expect(isRetiredXstock(chainId, v), `${vad} emekli xStock`).toBe(isRetiredXstock(chainId, adres))
      expect(isRetiredBstock(chainId, v), `${vad} emekli bStock`).toBe(isRetiredBstock(chainId, adres))
    }
  })

  it('katalog satiri (stockEntry / stockIssuer) de ayni: Sat tarafi tutarli kalir', () => {
    for (const [vad, v] of varyantlar(GOOGLB.address)) {
      expect(stockEntry(BSTOCKS_CHAIN_ID, v), vad).toBe(stockEntry(BSTOCKS_CHAIN_ID, GOOGLB.address))
      expect(stockIssuer(BSTOCKS_CHAIN_ID, v), vad).toBe('bstocks')
    }
  })

  it('YANLIS POZITIF YOK: hisse olmayan ve bozuk adresler 0x on ekiyle de null kalir; zincir hala belirleyici', () => {
    const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955'
    const bozuklar = [USDT_BSC.slice(2), USDT_BSC, SAHTE.slice(2), GOOGLB.address.slice(3), `${GOOGLB.address}0`, `0x${'g'.repeat(40)}`, '0x', '  ']
    for (const b of bozuklar) expect(stockOutputIssuer(BSTOCKS_CHAIN_ID, b), String(b)).toBeNull()
    // bStocks yalniz BSC'de: 0x'siz yazim baska zincirde hisse yapmaz
    expect(stockOutputIssuer(1, GOOGLB.address.slice(2))).toBeNull()
    expect(stockOutputIssuer(137, TSLA.address.slice(2))).toBeNull()
  })
})

// KOK NEDEN / KAPATILAN HATA (ilk alim kapisi, spec 5.3 ve 11.5-14): `bridge()` ve `atsBridgeFeeQuote`
// "hedef zincirde kopruyle hisse edinilebilir mi" sorusunu zincir listesiyle sorar. Liste elle yazilirsa
// katalog buyuyunce (ya da `isBridgeTargetBlocked` degisince) kapi sessizce eski kalir. Kume katalogdan
// ve `isBridgeTargetBlocked`'tan turer. Bilerek TEK sabitleme: bugunku kume tam olarak [56] (G2 istisnasi).
describe('bridgeStockChainIds (kopru hedefi hisse zincirleri)', () => {
  // Hedef olarak acik en az bir katalog satiri var mi? (kumeden BAGIMSIZ, katalogdan hesaplanir)
  const hasOpenTarget = (chainId) =>
    (chainId === BSTOCKS_CHAIN_ID && BSTOCKS.some((b) => !isBridgeTargetBlocked(chainId, b.address))) ||
    XSTOCKS.some((s) => s.chains.includes(chainId) && !isBridgeTargetBlocked(chainId, s.address))
  const ADAY_ZINCIRLER = [...new Set([BSTOCKS_CHAIN_ID, ...XSTOCKS_CHAIN_IDS, ...XSTOCK_EXISTENCE_CHAIN_IDS])]

  it('bugun tam olarak [56] (spec 11.5-14: yalniz bStocks hedef olarak acik)', () => {
    expect(bridgeStockChainIds()).toEqual([56])
  })

  it('tutarlilik: kumedeki her zincirde hedef olarak acik satir VAR, kumede olmayan hicbir zincirde YOK', () => {
    const kume = bridgeStockChainIds()
    expect(kume.length).toBeGreaterThan(0)
    for (const chainId of kume) expect(hasOpenTarget(chainId), `kumede ${chainId}`).toBe(true)
    for (const chainId of ADAY_ZINCIRLER.filter((c) => !kume.includes(c))) {
      expect(hasOpenTarget(chainId), `kume disi ${chainId}`).toBe(false)
    }
  })

  it('yalniz xStocks bulunan zincirler (1, 42161, 10, 5000) kumede DEGIL', () => {
    const kume = bridgeStockChainIds()
    for (const chainId of [1, 42161, 10, 5000]) {
      expect(chainId).not.toBe(BSTOCKS_CHAIN_ID)
      expect(kume, String(chainId)).not.toContain(chainId)
    }
  })

  it('BSC xStocks kataloginda da olsa kumede KALIR (bStocks hedef olarak acik)', () => {
    // Pozitif bekci: BSC'de gercekten xStocks satiri var; yoksa bu test BSC'nin neden kaldigini kanitlamaz.
    expect(xstocksOn(BSTOCKS_CHAIN_ID).length).toBeGreaterThan(0)
    for (const s of xstocksOn(BSTOCKS_CHAIN_ID)) expect(isBridgeTargetBlocked(BSTOCKS_CHAIN_ID, s.address)).toBe(true)
    expect(bridgeStockChainIds()).toContain(BSTOCKS_CHAIN_ID)
  })

  it('tekrarsiz, tamsayi ve artan sirali', () => {
    const kume = bridgeStockChainIds()
    expect(new Set(kume).size).toBe(kume.length)
    expect(kume.every(Number.isInteger)).toBe(true)
    expect(kume).toEqual([...kume].sort((a, b) => a - b))
  })

  it('her cagri yeni dizi doner: dis kod kumeyi bozamaz', () => {
    const ilk = bridgeStockChainIds()
    ilk.push(999)
    expect(bridgeStockChainIds()).toEqual([56])
  })
})

describe('stockIssuerInfo (eksen d)', () => {
  it('xStock: anahtarlar token.xStock*, ISIN yok', () => {
    expect(stockIssuerInfo(stockEntry(TSLA.chains[0], TSLA.address))).toEqual({
      issuer: 'xstocks', badgeKey: 'token.xStockBadge', issuerKey: 'token.xStockIssuer',
      isin: null,
    })
  })

  it('bStock: mevcut token.bStock* anahtarlari ve katalogdaki ISIN', () => {
    expect(stockIssuerInfo(stockEntry(BSTOCKS_CHAIN_ID, GOOGLB.address))).toEqual({
      issuer: 'bstocks', badgeKey: 'token.bStockBadge', issuerKey: 'token.bStockIssuer',
      isin: GOOGLB.isin,
    })
  })

  it('kayit yoksa null', () => {
    expect(stockIssuerInfo(null)).toBeNull()
    expect(stockIssuerInfo(undefined)).toBeNull()
  })
})

describe('stockImportIdentity (eksen e)', () => {
  const SUNUCU_AAPL = { coingecko_id: 'apple-xstock', image: { large: 'https://sunucu/l.png' }, chain: 'ethereum' }
  // CoinGecko platform kimligi (katalog sabiti degil, sunucu kaydinin `chain` alani).
  const PLATFORM = { 1: 'ethereum', 56: 'binance-smart-chain', 42161: 'arbitrum-one' }

  it('GERCEK xStock adresi kimligini KATALOGDAN alir (zincirin CoinGecko platformuyla)', () => {
    for (const chainId of TSLA.chains) {
      expect(stockImportIdentity({ chainId, address: TSLA.address.toLowerCase(), symbol: TSLA.symbol, name: `${TSLA.name} xStock`, backendToken: null }), String(chainId))
        .toEqual({ image: null, chain: PLATFORM[chainId], coingecko_id: TSLA.coingeckoId, known: true })
    }
  })

  // Review Focus 4: Base'deki sahte AAPLx gercek hissenin kimligini miras ALMAZ.
  it('Review Focus 4: Base de gercek hissenin adini/sembolunu tasiyan SAHTE kontrat kimlik almaz, dogrulanmamis sayilir', () => {
    expect(stockImportIdentity({ chainId: 8453, address: SAHTE, symbol: 'AAPLx', name: 'Apple xStock', backendToken: SUNUCU_AAPL }))
      .toEqual({ image: null, chain: null, coingecko_id: null, known: false })
  })

  it('Review Focus 4: sunucu eslesmese de sembolu katalog hissesi olan kontrat dogrulanmamis sayilir (harf ve bosluk duyarsiz)', () => {
    const sym = TSLA.symbol
    for (const symbol of [sym, sym.toLowerCase(), ` ${sym.toUpperCase()} `]) {
      expect(stockImportIdentity({ chainId: 8453, address: SAHTE, symbol, backendToken: null }).known, symbol).toBe(false)
    }
  })

  it('Review Focus 4: katalogda OLMAYAN hisse taklidi ("...x" + adinda xStock) dogrulanmamis sayilir', () => {
    expect(stockImportIdentity({ chainId: 1, address: SAHTE, symbol: 'MSFTx', name: 'Microsoft xStock', backendToken: null }).known).toBe(false)
  })

  // A-2: sembol farkli ("FAKE") ama ad bir katalog hissesini taklit ediyor.
  it('A-2: sembolu farkli ama adi katalog hissesi + xStock olan kontrat dogrulanmamis sayilir (harf duyarsiz)', () => {
    expect(stockImportIdentity({ chainId: 1, address: SAHTE, symbol: 'FAKE', name: `${TSLA.name} xStock`, backendToken: null }))
      .toEqual({ image: null, chain: null, coingecko_id: null, known: false })
    expect(stockImportIdentity({ chainId: 1, address: SAHTE, symbol: 'FAKE', name: `${TSLA.name.toUpperCase()} XSTOCK`, backendToken: null }).known).toBe(false)
  })

  it('A-2: adinda yalniz hisse adi (xStock yok) ya da yalniz "xStock" (katalog hissesi yok) uyari ALMAZ', () => {
    const sunucu = { coingecko_id: 'baska', image: 'i', chain: 'ethereum' }
    expect(stockImportIdentity({ chainId: 1, address: SAHTE, symbol: 'FAKE', name: TSLA.name, backendToken: sunucu }))
      .toEqual({ image: 'i', chain: 'ethereum', coingecko_id: 'baska', known: true })
    expect(stockImportIdentity({ chainId: 1, address: SAHTE, symbol: 'FAKE', name: 'Bilinmeyen xStock', backendToken: sunucu }).known).toBe(true)
  })

  it('Review Focus 4: sunucu xStocks ailesinden kimlik donuyorsa (wrapped dahil) kimlik ALINMAZ', () => {
    for (const coingecko_id of ['microsoft-xstock', 'wrapped-tesla-xstock']) {
      expect(stockImportIdentity({ chainId: 1, address: SAHTE, symbol: 'ZZZ', backendToken: { coingecko_id, image: { large: 'x' }, chain: 'ethereum' } }))
        .toEqual({ image: null, chain: null, coingecko_id: null, known: false })
    }
  })

  it('Review Focus 4: ilgisiz "ETHx" uyari ALMAZ ve sunucunun kimligini AYNEN alir', () => {
    expect(stockImportIdentity({ chainId: 1, address: SAHTE, symbol: 'ETHx', name: 'Ethereum x', backendToken: null }))
      .toEqual({ image: null, chain: null, coingecko_id: null, known: true })
    expect(stockImportIdentity({ chainId: 1, address: SAHTE, symbol: 'ETHx', name: 'Ethereum x', backendToken: { coingecko_id: 'eth-x', image: 'i', chain: 'ethereum' } }))
      .toEqual({ image: 'i', chain: 'ethereum', coingecko_id: 'eth-x', known: true })
  })

  it('bStocks: gercek adres katalogdan, sahte ve baska zincirdeki ayni adres dogrulanmamis', () => {
    expect(stockImportIdentity({ chainId: 56, address: GOOGLB.address.toLowerCase(), symbol: 'GOOGLB', backendToken: null }))
      .toEqual({ image: GOOGLB.image, chain: 'binance-smart-chain', coingecko_id: GOOGLB.coingecko_id, known: true })
    expect(stockImportIdentity({ chainId: 56, address: SAHTE, symbol: 'GOOGLB', backendToken: null }).known).toBe(false)
    expect(stockImportIdentity({ chainId: 1, address: GOOGLB.address, symbol: 'GOOGLB', backendToken: null }).known).toBe(false)
  })

  it('bStockImportIdentity ESKI AD ayni fonksiyondur (geriye donuk uyum, K6)', () => {
    expect(bStockImportIdentity).toBe(stockImportIdentity)
  })
})

describe('isXstockFamilyId', () => {
  it('xStocks ailesi (wrapped dahil) true; digerleri ve bozuk girdi false', () => {
    expect(isXstockFamilyId(TSLA.coingeckoId)).toBe(true)
    expect(isXstockFamilyId(`wrapped-${TSLA.coingeckoId}`)).toBe(true)
    expect(isXstockFamilyId('tether')).toBe(false)
    expect(isXstockFamilyId('xstock-token')).toBe(false)
    expect(isXstockFamilyId(undefined)).toBe(false)
    expect(isXstockFamilyId(null)).toBe(false)
  })
})

describe('stocksByChain (eksen f)', () => {
  const chainIds = (groups) => groups.map((g) => g.chainId)
  const SABIT = [...XSTOCKS_CHAIN_IDS] // Ethereum, BSC, Arbitrum sirasi; BSC bStocks'u da tasir
  const oneAl = (id) => [id, ...SABIT.filter((c) => c !== id)]

  it('zincir basina satir sayisi katalogdan: xStocks listelenen zincirde, BSC de bStocks + xStocks', () => {
    const groups = stocksByChain({ activeChainId: 1 })
    expect(chainIds(groups)).toEqual(oneAl(1))
    const rowsOf = (chainId) => groups.find((g) => g.chainId === chainId).rows
    for (const chainId of XSTOCKS_CHAIN_IDS) {
      const beklenen = xstocksOn(chainId).length + (chainId === BSTOCKS_CHAIN_ID ? BSTOCKS.length : 0)
      expect(rowsOf(chainId), String(chainId)).toHaveLength(beklenen)
    }
    // BSC grubunda bStocks ONCE, katalog sirasiyla (sekme eskiden bu sirayla cizilirdi).
    const bsc = rowsOf(BSTOCKS_CHAIN_ID)
    expect(bsc.slice(0, BSTOCKS.length).map((r) => r.symbol)).toEqual(BSTOCKS.map((b) => b.symbol))
    expect(bsc.slice(BSTOCKS.length).every((r) => r.issuer === 'xstocks')).toBe(true)
  })

  it('aktif ag (uc zincirden biriyse) EN USTTE; digerleri sabit sirada', () => {
    for (const id of XSTOCKS_CHAIN_IDS) {
      expect(chainIds(stocksByChain({ activeChainId: id })), String(id)).toEqual(oneAl(id))
      expect(chainIds(stocksByChain({ activeChainId: String(id) })), `dize ${id}`).toEqual(oneAl(id))
    }
    // Siralama gercekten degisiyor (aksi halde yukaridaki dongu bir sey ispatlamaz).
    const sonId = XSTOCKS_CHAIN_IDS[XSTOCKS_CHAIN_IDS.length - 1]
    expect(chainIds(stocksByChain({ activeChainId: sonId }))[0]).toBe(sonId)
    expect(oneAl(sonId)).not.toEqual(SABIT)
  })

  it('aktif ag uc zincirden biri degilse (Polygon, TON, Solana, bos) sabit sira', () => {
    for (const activeChainId of [137, -239, 'solana-mainnet', null, undefined]) {
      expect(chainIds(stocksByChain({ activeChainId })), String(activeChainId)).toEqual(SABIT)
    }
  })

  it('includeXstocks=false: yalniz BSC bStocks grubu (bugunku gorunum)', () => {
    const groups = stocksByChain({ includeXstocks: false })
    expect(chainIds(groups)).toEqual([BSTOCKS_CHAIN_ID])
    expect(groups[0].rows).toHaveLength(BSTOCKS.length)
    expect(groups[0].rows.every((r) => r.issuer === 'bstocks')).toBe(true)
  })

  it('her satir kendi grubunun zincirinde ve ayni TSLAx birden cok grupta ayri satirlar', () => {
    const groups = stocksByChain({})
    for (const g of groups) for (const r of g.rows) expect(r.chainId).toBe(g.chainId)
    const tsla = groups.flatMap((g) => g.rows).filter((r) => r.symbol === TSLA.symbol)
    expect(tsla.map((r) => r.chainId).sort((a, b) => a - b)).toEqual([...TSLA.chains].sort((a, b) => a - b))
    expect(new Set(tsla.map((r) => r.address)).size).toBe(1)
  })
})

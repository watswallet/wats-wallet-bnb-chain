// tokenizedStocks.js -- bStocks + xStocks ortak kayit tablosu ve eksen fonksiyonlari. Saf katman:
// RPC yok. bStocks sonuclari DEGISMEDI (isBStock ile birebir ayni); xStocks'ta "tokenize hisse mi"
// evet, "uiMultiplier var mi" hayir.
//
// Katalogun anlik icerigine (hisse sayisi, hangi hissenin hangi zincirde oldugu) SABITLENMEZ:
// beklenenler XSTOCKS'tan turetilir.
import { describe, it, expect } from 'vitest'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'
import { XSTOCKS, XSTOCKS_CHAIN_IDS } from '../data/xStocks'
import { isBStock, bStockImportIdentity } from './bstocks'
import {
  stockKey, stockEntry, stockIssuer, hasUiMultiplier, isBridgeBlocked, isBridgeTargetBlocked,
  isGeneralSwapExcluded, stockIssuerInfo, stockImportIdentity, isXstockFamilyId, stocksByChain,
  XSTOCK_EXISTENCE_CHAIN_IDS,
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

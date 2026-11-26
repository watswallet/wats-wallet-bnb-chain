// Tokenize hisse (bStocks + xStocks) icin saf yardimcilar: ag, saglayici, cuzdan YOK
// (swapRoutes.js ile ayni sozlesme), boylece RPC olmadan test edilir.
//
// NEDEN VAR: bugunku `isBStock(chainId, address)` TEK bayrak birden cok soruyu
// BIRLIKTE cevapliyordu ("rozet gerekli mi", "uiMultiplier var mi", "kopruden dislanmali
// mi", ...). xStocks'ta bu sorular AYRISIYOR (orn. "tokenize hisse mi" evet ama
// "uiMultiplier var mi" hayir). Her soru kendi fonksiyonunda; cagiran sordugu soruya
// uyani import eder. `bstocks.js` (isBStock / bStockByAddress) AYNEN kalir.
//
// ANAHTAR zinciri de icerir: xStocks AYNI adresi uc zincirde tasir; yalniz adrese gore
// indeks bir zincirdeki hisseyi oburunde de "hisse" sayardi.
//
// IKI KAPSAM AYRI: `chains` (urun kapsami: rozet, Hisseler satiri) ile DISLAMA kapsami
// (XSTOCK_EXISTENCE_CHAIN_IDS: tokenin var oldugu ve cuzdanin destekledigi zincirler)
// FARKLIDIR. Katalog adresi, `chains`inde olmasa bile var oldugu her zincirde Takas ve
// Kopru'den dislanir (AMM havuzlari her yerde tuzak); rozet ve satir ise yalniz `chains`.
//
// EMEKLI ADRESLER (K28): katalogdan cikarilan ama zincirde hala var olan xStocks adresleri (data/xStocksRetired.js)
// YALNIZ CIKTI (edinme) tarafinda tutulur: stockOutputIssuer, isGeneralSwapOutputExcluded ve isBridgeTargetBlocked
// onlari tanir. GIRDI (Sat) tarafi (stockIssuer, stockEntry, isGeneralSwapExcluded, isBridgeBlocked) katalog-yalniz KALIR.
//
// EMEKLI bStocks ADRESLERI (data/bStocksRetired.js; K28 ilkesinin bStocks karsiligi): BMNRB ve FLNCB (e7089f2d) ayni
// gerekceyle YALNIZ stockOutputIssuer'a girer ('bstocks'): kapi ve Alinan / Hedef seciciler (unavailableOutput) onlari
// bstocks ihraccisi sayar. isGeneralSwapOutputExcluded ve isBridgeTargetBlocked onlari BILMEZ: bStocks genel Takas /
// Kopru hedefinde acik kalir (PancakeSwap rotasi gercek), karar kapidadir.
//
// DINAMIK LCX KATMANI (Bolum 2): sunucunun GET /lcx/stocks satirlari (setLcxStockRows) statik katalogun USTUNE binen ikinci,
// bellekte tutulan bir katmandir. STATIK KATALOG HER ZAMAN KAZANIR: adresi BY_KEY'de, xStocks dislama kumesinde ya da emekli
// xStocks / bStocks kumelerinde olan dinamik satir atilir; boylece bStocks / xStocks kurallari ve motoru etkilenmez. Bu katman
// ozellik bayragina ve gizli moda BAKMAZ (cagiran bakar); bayrak kapaliyken kimse satir kurmaz, katman bos kalir ve her fonksiyon
// bugunku sonucu verir.

import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'
import { XSTOCKS, XSTOCKS_CHAIN_IDS, XSTOCKS_PLATFORM_BY_CHAIN, XSTOCK_FAMILY_ID } from '../data/xStocks'
import { RETIRED_XSTOCKS } from '../data/xStocksRetired'
import { RETIRED_BSTOCKS } from '../data/bStocksRetired'

// ADRES YAZIMI (main senkron B-F1): arama anahtari tam dize esitligiydi; `0x` on eki olmayan 40 onaltili hane (ethers.getAddress ve
// Contract bunu ayni adres sayar) ya da kenarinda bosluk bulunan adres hisse taninmaz, ilk alim kapisi (K36) acik gecerdi.
// Tek normallestirici: kirp, kucuk harfe indir, `0x`suz 40 onaltili haneye `0x` ekle. Anahtar ve uc dislama kumesi (xStocks,
// emekli xStocks, emekli bStocks) ve gizli teslimin ek listesi (deliveryStocks.js) HEP bundan gecer; baska yerde adres elle
// kucultulmez. Yanlis pozitif (hisse olmayan adresin hisse sanilmasi) yalniz Al'i reddeder; yanlis negatif kapiyi acar.
const BARE_HEX_ADDRESS = /^[0-9a-f]{40}$/
export function normalizeStockAddress(address) {
  const text = String(address).trim().toLowerCase()
  return BARE_HEX_ADDRESS.test(text) ? `0x${text}` : text
}

// `${chainId}:${normallestirilmis adres}`. chainId Number()'a cevrilir: depo kova anahtarlari
// ve rota parametreleri dize, kayitlar sayi tasiyor.
export const stockKey = (chainId, address) => `${Number(chainId)}:${normalizeStockAddress(address)}`

// xStocks kontratinin VAR oldugu ve cuzdanin destekledigi zincirler (spec 2.4 + Ek A.1):
// Ethereum, BSC, Arbitrum, Optimism, Mantle. Dislama kapilari bu listeyi kullanir.
// Polygon (137) ve Base (8453) BILEREK yok: Base'de ayni adreslerde gercek token degil taklitler var.
export const XSTOCK_EXISTENCE_CHAIN_IDS = Object.freeze([1, 56, 42161, 10, 5000])

const BSTOCKS_PLATFORM = 'binance-smart-chain'

// Normallestirilmis kayit. Alan adlari iki ihracci icin AYNI: bStocks katalogu
// snake_case (coingecko_id), xStocks camelCase (coingeckoId) tasiyor; tuketiciler
// burada tek bicim gorur.
function bstockRow(t) {
  return Object.freeze({
    issuer: 'bstocks',
    chainId: BSTOCKS_CHAIN_ID,
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    coingeckoId: t.coingecko_id,
    image: t.image ?? null,
    isin: t.isin ?? null,
    scaled: true, // BEP-677: balanceOf carpani UYGULAMAZ, balanceOfUI uygular
    underlying: t.underlying, // dayanak ticker (katalogda ACIK yazili); iki ihracci bununla eslesir
  })
}

function xstockRow(t, chainId) {
  return Object.freeze({
    issuer: 'xstocks',
    chainId,
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    coingeckoId: t.coingeckoId,
    image: null, // logo katalogda tutulmaz (data/xStocks.js baslik notu)
    isin: null,
    scaled: false, // balanceOf ZATEN carpanli; uiMultiplier() / balanceOfUI() YOK
    underlying: t.underlying, // dayanak ticker (katalogda ACIK yazili); iki ihracci bununla eslesir
  })
}

const BSTOCK_ROWS = BSTOCKS.map(bstockRow)
const XSTOCK_ROWS = XSTOCKS.flatMap((t) => t.chains.map((chainId) => xstockRow(t, chainId)))
const BY_KEY = new Map([...BSTOCK_ROWS, ...XSTOCK_ROWS].map((row) => [stockKey(row.chainId, row.address), row]))

// Dislama ekseni icin: zincirden bagimsiz katalog adresleri (kucuk harf).
const XSTOCK_ADDRESSES = new Set(XSTOCKS.map((t) => normalizeStockAddress(t.address)))

// Emekli xStocks adresleri (kucuk harf; K28): katalog DISI, yalniz cikti tarafinda dislanir.
const RETIRED_ADDRESSES = new Set(RETIRED_XSTOCKS.map((r) => normalizeStockAddress(r.address)))

// Emekli bStocks adresleri (kucuk harf; K28 ilkesi): katalog DISI, yalniz cikti tarafinda kapiya girer.
const RETIRED_BSTOCK_ADDRESSES = new Set(RETIRED_BSTOCKS.map((r) => normalizeStockAddress(r.address)))

// xStocks adresi, var oldugu zincirlerden birinde mi? (`chains`e BAKMAZ.)
function isXstockExcludedAddress(chainId, address) {
  if (typeof address !== 'string' || !address) return false
  return XSTOCK_EXISTENCE_CHAIN_IDS.includes(Number(chainId)) && XSTOCK_ADDRESSES.has(normalizeStockAddress(address))
}

// Emekli xStocks adresi, var oldugu zincirlerden birinde mi? (K28; `chains`e BAKMAZ, dislama kapsamiyla ayni kural.)
// Katalog DEGIL: stockEntry / stockIssuer / Hisseler sekmesi bunu gormez.
export function isRetiredXstock(chainId, address) {
  if (typeof address !== 'string' || !address) return false
  return XSTOCK_EXISTENCE_CHAIN_IDS.includes(Number(chainId)) && RETIRED_ADDRESSES.has(normalizeStockAddress(address))
}

// Emekli bStocks adresi, BSC'de (bStocks'un var oldugu tek zincir) mi? Katalog DEGIL: stockEntry / stockIssuer /
// Hisseler sekmesi bunu gormez. Dislama listesi DEGIL: yalniz stockOutputIssuer tanir.
export function isRetiredBstock(chainId, address) {
  if (typeof address !== 'string' || !address) return false
  return Number(chainId) === BSTOCKS_CHAIN_ID && RETIRED_BSTOCK_ADDRESSES.has(normalizeStockAddress(address))
}

// ---- DINAMIK LCX KATMANI ----------------------------------------------------------------------------------------------------
// Satir sozlesmesi (Global Constraints): ihracci sunucudaki normalizeIssuer ile ayni normallesir ve ^[a-z0-9-]{2,32}$ olmali;
// dayanak ^[A-Z0-9.]{1,10}$; fiyat sonlu ve > 0; ondalik 0-36 tamsayi. Eksik / yanlis tipli alan icin VARSAYILAN UYDURULMAZ:
// satir DUSER (sunucu suzgeciyle ayni ilke).
const LCX_ISSUER_RE = /^[a-z0-9-]{2,32}$/
const LCX_UNDERLYING_RE = /^[A-Z0-9.]{1,10}$/
const LCX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const LCX_MARKET_HOURS = Object.freeze(['us_equities', 'always'])
// Statik katalogun ihracci kimlikleri: dinamik satir bunlari tasirsa stockIssuer / kapi onu bStocks / xStocks sanardi.
const STATIC_ISSUER_IDS = Object.freeze(['bstocks', 'xstocks'])

// Sunucudaki normalizeIssuer (server/utils/lcxStockFilter.js) ile BIREBIR: kucuk harf, harf-rakam disi her dizi tek '-',
// bas / son '-' kirpilir. Sonuc gecerli ihracci biciminde degilse (ya da girdi dize degilse) null.
export function normalizeLcxIssuer(s) {
  if (typeof s !== 'string') return null
  const out = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return LCX_ISSUER_RE.test(out) ? out : null
}

// Piyasa rozeti (marketOpen) bayatligi: sunucu usEquitiesOpen degerini en cok 24 saat bayat sunabilir, depodaki kayit da her yasta olabilir;
// listenin LCX'ten yuklendigi an (`asOf`, ms) bu kadar eskiyse rozet gosterilmez (marketOpen null) -- yanlis "Acik" / "Kapali" yerine yok.
const MARKET_STATUS_MAX_AGE_MS = 30 * 60 * 1000
// Saat farki payi: istemci saati sunucudan biraz geri olabilir; ondan fazla gelecekteki asOf (saat geri alinmis) bayat sayilir.
const MARKET_STATUS_FUTURE_SKEW_MS = 5 * 60 * 1000

// `opts.asOf` ANAHTARI verilmisse (yukleyici hep verir: stockRows.js) rozet yalniz sonlu, pozitif ve taze asOf ile gecerlidir; asOf yoksa /
// gecersizse false. Anahtar hic verilmediyse (dogrudan setLcxStockRows ceken eski cagri bicimi) denetlenmez.
function marketStatusFresh(opts) {
  if (opts === null || typeof opts !== 'object' || !Object.hasOwn(opts, 'asOf')) return true
  const { asOf } = opts
  if (!Number.isFinite(asOf) || asOf <= 0) return false
  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  const age = now - asOf
  return age <= MARKET_STATUS_MAX_AGE_MS && age >= -MARKET_STATUS_FUTURE_SKEW_MS
}

// Sunucu satirini (GET /lcx/stocks `rows[]`) katalog satiri bicimine cevirir; gecersizse null. `marketOpen`: us_equities satirinda
// sunucunun usEquitiesOpen degeri (yalniz tam true acik) -- `opts.asOf` verilmisse yalniz taze ise (bkz. marketStatusFresh), yoksa null;
// always satirinda null (rozet gosterilmez). Zincir, eklentinin LCX aglariyla (CHAIN_ORDER) sinirlidir: baska zincirin satiri ne
// gosterilebilir ne islenebilir.
export function toLcxStockRow(raw, opts) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const issuer = normalizeLcxIssuer(raw.issuer)
  if (issuer === null || STATIC_ISSUER_IDS.includes(issuer)) return null
  const { chainId, address, symbol, name, decimals, underlying, priceUsd, priceUpdatedAt, marketHours } = raw
  if (!Number.isInteger(chainId) || !CHAIN_ORDER.includes(chainId)) return null
  if (typeof address !== 'string' || !LCX_ADDRESS_RE.test(address)) return null
  if (typeof symbol !== 'string' || symbol === '') return null
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null
  if (typeof underlying !== 'string' || !LCX_UNDERLYING_RE.test(underlying)) return null
  if (typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd <= 0) return null
  if (!LCX_MARKET_HOURS.includes(marketHours)) return null
  return Object.freeze({
    issuer,
    chainId,
    symbol,
    name: typeof name === 'string' && name !== '' ? name : symbol,
    address,
    decimals,
    coingeckoId: null, // LCX satiri katalog kimligi (CoinGecko, logo, ISIN) tasimaz; fiyat satirin kendi priceUsd'sidir
    image: null,
    isin: null,
    scaled: false, // uiMultiplier() / balanceOfUI() yok: balanceOf ham deger
    underlying,
    source: 'lcx',
    priceUsd,
    priceUpdatedAt: Number.isFinite(priceUpdatedAt) ? priceUpdatedAt : null,
    marketHours,
    marketOpen: marketHours === 'us_equities' && marketStatusFresh(opts) ? opts?.usEquitiesOpen === true : null,
  })
}

// Dinamik satir olamayacak adres: statik katalog (BY_KEY) + xStocks dislama kumesi + emekli xStocks + emekli bStocks.
const isStaticCatalogAddress = (chainId, address) => BY_KEY.has(stockKey(chainId, address))
  || isXstockExcludedAddress(chainId, address)
  || isRetiredXstock(chainId, address)
  || isRetiredBstock(chainId, address)

let lcxByKey = new Map()
let lcxList = Object.freeze([])

// Dinamik katmani sunucu satirlariyla TAMAMEN degistirir (oncekiler kalmaz). Gecersiz ve statik katalogla cakisan satirlar
// atilir; ayni anahtar iki kez gelirse ilki kalir. Tutulan satir sayisini dondurur. Girdi degistirilmez.
export function setLcxStockRows(rawRows, opts) {
  const next = new Map()
  if (Array.isArray(rawRows)) {
    for (const raw of rawRows) {
      const row = toLcxStockRow(raw, opts)
      if (row === null || isStaticCatalogAddress(row.chainId, row.address)) continue
      const key = stockKey(row.chainId, row.address)
      if (!next.has(key)) next.set(key, row)
    }
  }
  lcxByKey = next
  lcxList = Object.freeze([...next.values()])
  return next.size
}

// Eldeki dinamik satirlar (giris sirasi). Dondurulmus dizi; her setLcxStockRows yenisini kurar.
export const lcxStockRows = () => lcxList

// Adres YALNIZ dinamik katmanda mi? (Statik katalog adresleri icin false.)
export function isLcxStock(chainId, address) {
  if (typeof address !== 'string' || !address) return false
  return lcxByKey.has(stockKey(chainId, address))
}

/** YALNIZ testler: dinamik katmani bosaltir. */
export function _resetLcxStockRows() {
  lcxByKey = new Map()
  lcxList = Object.freeze([])
}

// Yalniz STATIK katalog (bStocks + xStocks): dinamik LCX satiri bunu golgelemez ve katalog kimligi (logo, coingecko_id) tasimaz.
function staticEntry(chainId, address) {
  if (typeof address !== 'string' || !address) return null
  return BY_KEY.get(stockKey(chainId, address)) ?? null
}

// Once statik katalog, sonra dinamik LCX katmani. Dinamik satir (`source: 'lcx'`) statik bir adresi tasiyamaz (setLcxStockRows atar).
export function stockEntry(chainId, address) {
  if (typeof address !== 'string' || !address) return null
  const key = stockKey(chainId, address)
  return BY_KEY.get(key) ?? lcxByKey.get(key) ?? null
}

// a) ROZET / IHRACCI KIMLIGI
export const stockIssuer = (chainId, address) => stockEntry(chainId, address)?.issuer ?? null

// a-2) CIKTI TARAFI IHRACCI (ilk alim kapisi, K28): katalog ihraccisi, yoksa emekli xStocks adresi icin 'xstocks',
// emekli bStocks adresi (BSC) icin 'bstocks'.
// Kapi (background.js) ve cowStockGate bunu sorar; GIRDI (Sat) tarafi stockIssuer'dir.
export const stockOutputIssuer = (chainId, address) => stockIssuer(chainId, address)
  ?? (isRetiredXstock(chainId, address) ? 'xstocks' : isRetiredBstock(chainId, address) ? 'bstocks' : null)

// b) OLCEKLI ARAYUZ (uiMultiplier). Hangi okuma fonksiyonunun cagrilacagi (balanceOfUI mi
// balanceOf mu) ve harcamada ham/UI cevriminin gerekip gerekmedigi BU fonksiyonla
// belirlenir: useTokenBalance, bstocksSpend ve stockBalances ayni karari kullanir.
export const hasUiMultiplier = (chainId, address) => stockEntry(chainId, address)?.scaled === true

// c) KOPRU YASAGI (KAYNAK taraf): iki ihracci da kopruden dislanmistir. xStocks kolu
// dislama kapsamini (var oldugu bes zincir) kullanir, `chains`i degil.
export const isBridgeBlocked = (chainId, address) =>
  stockIssuer(chainId, address) === 'bstocks' || isXstockExcludedAddress(chainId, address) || isLcxStock(chainId, address)

// c-2) KOPRU HEDEFI: bStocks hedef olarak ACIK (LI.FI baska zincirden hisse almayi
// rotaliyor, Bridge.vue 2026-10-02 notu); xStocks hedef olarak da KAPALI (emekli adresler dahil, K28).
// LCX satiri da KAPALI (Bolum 2, spec 9): LCX hissesi yalniz LCX yolundan (RWA teklifi) edinilir, koprudeki LI.FI rotasindan degil.
export const isBridgeTargetBlocked = (chainId, address) =>
  isXstockExcludedAddress(chainId, address) || isRetiredXstock(chainId, address) || isLcxStock(chainId, address)
// c-2b) KOPRUYLE HISSE EDINILEBILEN ZINCIRLER (ilk alim kapisi, spec 5.3): katalog satirlarindan,
// hedef olarak ACIK (`!isBridgeTargetBlocked`) en az bir satiri olan zincirlerin kumesi, artan sirali.
// Elle liste YOK: katalog buyurse ya da hedef kurali degisirse kapsam kendiliginden degisir. Bugun
// yalniz BSC (56): bStocks satirlari hedef olarak acik, xStocks satirlari (BSC'dekiler dahil) kapali.
// Tuketici: gate.evaluateBridgeTarget, bu kumedeki bir zincire giden koprude hedef token alani
// eksikse kapiyi KAPALI tutar. Her cagri yeni dizi doner.
export function bridgeStockChainIds() {
  const ids = new Set()
  for (const row of [...BSTOCK_ROWS, ...XSTOCK_ROWS]) {
    if (!isBridgeTargetBlocked(row.chainId, row.address)) ids.add(row.chainId)
  }
  return [...ids].sort((a, b) => a - b)
}

// c-3) GENEL TAKAS DISLAMASI: bStocks genel Takas'ta KALIR (PancakeSwap rotasi gercek);
// xStocks'un AMM havuzlari olu / tuzak, bu yuzden Takas'a hic sokulmaz.
// LCX satiri da dislanir: LCX hissesi yalniz LCX yolundan (RWA teklifi, referans korumasi) islem gorur; bugunku takas motoruna dusmez.
export const isGeneralSwapExcluded = (chainId, address) => isXstockExcludedAddress(chainId, address) || isLcxStock(chainId, address)
// c-3b) GENEL TAKAS CIKTI DISLAMASI (K28): katalog xStocks + emekli adresler. GIRDI (Sat) tarafi isGeneralSwapExcluded'dir
// ve emekli adresi DISLAMAZ: eldeki token satilabilmeli. Tuketiciler: swap.js assertNotXStock (cikti), swapTo.vue.
export const isGeneralSwapOutputExcluded = (chainId, address) => isGeneralSwapExcluded(chainId, address) || isRetiredXstock(chainId, address)

// d) IHRACCI METNI (i18n anahtarlari) ve ISIN
const ISSUER_INFO = Object.freeze({
  bstocks: Object.freeze({
    badgeKey: 'token.bStockBadge',
    issuerKey: 'token.bStockIssuer',
  }),
  xstocks: Object.freeze({
    badgeKey: 'token.xStockBadge',
    issuerKey: 'token.xStockIssuer',
  }),
})

export function stockIssuerInfo(entry) {
  if (!entry || !ISSUER_INFO[entry.issuer]) return null
  return { issuer: entry.issuer, ...ISSUER_INFO[entry.issuer], isin: entry.isin ?? null }
}

// e) ICE AKTARMA KIMLIGI
// ImportToken EVM'de tokeni sunucuya AD + SEMBOL ile soruyor (/getTokenByName adrese
// bakmiyor). "Alphabet"/"GOOGLB" ya da "Tesla xStock"/"TSLAx" adli HERHANGI bir kontrat
// gercek hissenin logosunu ve coingecko_id'sini (fiyat, grafik, USD degeri) miras
// alabilirdi; Base'de sahte AAPLx / TSLAx tokenlari VAR. Hisse kimliginin tek yetkilisi
// KATALOG:
//   - katalog adresi (kendi zincirinde) -> kimlik katalogdan, sunucu eslesmese bile
//   - hisse coingecko_id'si / sembolu tasiyan, adi bir katalog hissesini + "xStock"
//     diyen ya da "...x" + adinda "xStock" gecen katalog DISI kontrat -> kimlik
//     VERILMEZ, `known: false` (sari uyari)
//   - geri kalan her token -> sunucunun kimligi AYNEN (davranis degismez)

// `tesla-xstock` ve `wrapped-tesla-xstock` dahil xStocks ailesinin CoinGecko kimlikleri.
export const isXstockFamilyId = (id) => typeof id === 'string' && XSTOCK_FAMILY_ID.test(id)

const BSTOCK_IDS = new Set(BSTOCKS.map((t) => t.coingecko_id))
const STOCK_SYMBOLS = new Set([...BSTOCKS.map((t) => t.symbol), ...XSTOCKS.map((t) => t.symbol)].map((s) => s.toUpperCase()))
// xStocks katalog hisse adlari (kucuk harf): "Tesla xStock" gibi adlari yakalamak icin.
const XSTOCK_NAMES = XSTOCKS.map((t) => t.name.toLowerCase())

function looksLikeStock({ symbol, name, backendToken }) {
  const id = backendToken?.coingecko_id
  if (BSTOCK_IDS.has(id) || isXstockFamilyId(id)) return true

  const sym = typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''
  if (sym && STOCK_SYMBOLS.has(sym)) return true

  const ad = typeof name === 'string' ? name.toLowerCase() : ''

  // Sembolu farkli ama adi gercek bir katalog hissesini taklit eden kontrat
  // (ornek: sembol "FAKE", ad "Tesla xStock"). "xstock" kosulu sart: "Tesla" tek basina
  // ilgisiz bir token olabilir.
  if (ad.includes('xstock') && XSTOCK_NAMES.some((hisse) => ad.includes(hisse))) return true

  // Katalogda olmayan hisse taklidi: sembol "x" ile biter VE ad "xStock" der.
  // (Ilgisiz "ETHx" gibi tokenlar bu ikinci kosulu saglamaz, uyari almaz.)
  return sym.endsWith('X') && ad.includes('xstock')
}

// LCX satiri katalog kimligi (logo, coingecko_id) TASIMAZ: yalniz statik katalog adresi kimlik verir (staticEntry); LCX adresi
// katalog disi sayilir ve sunucunun kimligi aynen gecer.
export function stockImportIdentity({ chainId, address, symbol, name, backendToken }) {
  const gercek = staticEntry(chainId, address)
  if (gercek) {
    return {
      image: gercek.image,
      chain: gercek.issuer === 'bstocks' ? BSTOCKS_PLATFORM : XSTOCKS_PLATFORM_BY_CHAIN[gercek.chainId],
      coingecko_id: gercek.coingeckoId,
      known: true,
    }
  }

  if (looksLikeStock({ symbol, name, backendToken })) {
    return { image: null, chain: null, coingecko_id: null, known: false }
  }

  return {
    image: backendToken?.image || null,
    chain: backendToken?.chain || null,
    coingecko_id: backendToken?.coingecko_id || null,
    known: true,
  }
}

// f) HISSELER SEKMESI YERLESIMI: zincir gruplari. Aktif ag bu zincirlerden biriyse EN USTTE;
// degilse sabit sira (Ethereum, BSC, Arbitrum, sonra LCX'e ozgu aglar: Base, Optimism, Polygon, Gnosis, Cronos).
// `includeXstocks: false` (ozellik bayragi kapali) yalniz BSC'deki bStocks grubunu verir: bugunku gorunum.
// `includeLcx: true` her grubun SONUNA o zincirdeki dinamik LCX satirlarini ekler (statikler once); varsayilan false
// bugunku sonucu birebir korur. Satiri olmayan zincirin grubu yoktur: ek aglar LCX satiri gelene dek gorunmez.
const CHAIN_ORDER = [...new Set([...XSTOCKS_CHAIN_IDS, BSTOCKS_CHAIN_ID, 8453, 10, 137, 100, 25])]

export function stocksByChain({ activeChainId = null, includeXstocks = true, includeLcx = false } = {}) {
  const groups = CHAIN_ORDER.map((chainId) => ({
    chainId,
    rows: [
      ...(chainId === BSTOCKS_CHAIN_ID ? BSTOCK_ROWS : []),
      ...(includeXstocks ? XSTOCK_ROWS.filter((row) => row.chainId === chainId) : []),
      ...(includeLcx ? lcxList.filter((row) => row.chainId === chainId) : []),
    ],
  })).filter((group) => group.rows.length > 0)

  const active = Number(activeChainId)
  const at = groups.findIndex((group) => group.chainId === active)
  if (at > 0) groups.unshift(...groups.splice(at, 1))
  return groups
}

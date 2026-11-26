// ILK ALIM KAPISI KAYNAK KILITLERI -- Grup A (Task 24; spec 11.5, 11.7; 2026-11-06 yeni taban: K28-K30).
// KOK NEDEN / KAPATILAN HATA: kapinin guvenligi kodun SIRASINA ve YERLESIMINE dayanir (kapi `queued` kaydindan ve ilk ag
// cagrisindan ONCE; Sat kapiya girmez; hisse olmayan ciktida ek async yok; arayuz depoya dokunmaz; yanit okunur).
// Davranis testleri bu degismezleri tek tek sinar ama sonraki bir duzenleme (bir satiri yukari/asagi tasimak, bir
// import eklemek, yeni bir ic aksiyon adi) hepsini sessizce bozabilir. Bu dosya o sirayi ve yerlesimi KAYNAKTAN kilitler.
// Dosya listeleri diskten TURETILIR (yeni dosya kendiliginden taranir; elle liste yok). Tarama `yorumsuz()` ile yapilir:
// yorum / kullanilmayan satir bir iddiayi yesil tutamaz, CRLF'e guvenilmez. Her "yok" iddiasinin yaninda ayni kaynakta
// aranan seyin GERCEKTEN bulundugunu gosteren pozitif bekci var (aksi halde bos tarama vakumda gecerdi).
// Yeni tabanda ayrica kilitlenenler: TEK ortak Hisse Al/Sat ekrani (StockTrade.vue; kapi kaynagi stock.issuer ve side'dan turer,
// Sat acik), pancakeEngine kapi eslemesi (K30), emekli xStocks listesi (K28; kapi cagri yerleri stockOutputIssuer kullanir),
// COW_ ailesi tam sekiz, ISSUER_INFO iki anahtar. Uretim kodu bu testle degismez. Grup B (CoW) kilitleri Task 31'dedir;
// burada `utils/cow` taranmaz (cowStockGate / getCowRuntime adlari izinlidir, zorunlu degildir).
// Task 48: grup 4 (bir ic aksiyon), grup 8 (depo) ve grup 6'nin App.vue / rulesClient yazim testleri beyansiz tasarimin
// kilitlerine TASINDI (stockEligibilityLocks.test.js: 17, 21); numara bosluklari (3, 4, 8) bu yuzden kasitlidir.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz, blokGovdesi, diziGovdesi, cagriGovdesi, eslesenKapanis } from '../../test-utils/kaynakTarama'
import { RETIRED_XSTOCKS } from '../../data/xStocksRetired'
import { RETIRED_BSTOCKS } from '../../data/bStocksRetired'

const BU_DIZIN = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(BU_DIZIN, '../..') // client/src
const REPO = path.resolve(SRC, '../..') // depo koku (client/ ve server/ bunun altinda)

const testDosyasi = (ad) => /\.(test|spec)\.[cm]?js$/.test(ad)

function yururle(dizin) {
  const cikti = []
  for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
    const yol = path.join(dizin, girdi.name)
    if (girdi.isDirectory()) {
      if (girdi.name === 'node_modules' || girdi.name === 'test-utils') continue
      cikti.push(...yururle(yol))
    } else if (/\.(js|vue)$/.test(girdi.name) && !testDosyasi(girdi.name)) {
      cikti.push(yol)
    }
  }
  return cikti
}

const goreli = (yol) => path.relative(SRC, yol).split(path.sep).join('/')
const ham = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')
const TUM = yururle(SRC).map((yol) => ({ rel: goreli(yol), kod: yorumsuz(fs.readFileSync(yol, 'utf8')) }))
const kodu = (rel) => {
  const d = TUM.find((x) => x.rel === rel)
  if (!d) throw new Error(`taranacak dosya yok: ${rel}`)
  return d.kod
}

// kapi dosyalari: saf cekirdek + veri + arayuz kancasi (bayraga BAGLI DEGIL, K9)
const KAPI = TUM.filter(
  (d) =>
    /^utils\/stockGate\/[^/]+\.js$/.test(d.rel) ||
    d.rel === 'data/eligibilityRules.js' ||
    d.rel === 'data/countryCodes.js' ||
    d.rel === 'composables/useStockGate.js' ||
    d.rel === 'composables/useStockEligibility.js',
)
// K32 + Task 47: beyan ekranlari (StockGate / CountryPicker / StockDeclarations) silindi; kapi arayuzu yalniz bant.
const KAPI_EKRANLARI = ['components/stocks/StockGateBand.vue']

const imzaOf = (ad) => new RegExp(`async function ${ad}\\(message, sender, sendResponse\\)\\s*`)
const govdeOf = (ad) => {
  const g = blokGovdesi(ham('background.js'), imzaOf(ad))
  expect(g, `background.js ${ad}() govdesi bulunamadi`).toBeTruthy()
  return g
}
// kapi cagrisi: getStockGate().evaluate( ya da .evaluateBridgeTarget(
const kapiIndeksi = (govde, yontem) => govde.search(new RegExp(`getStockGate\\(\\)\\s*\\.\\s*${yontem}\\(`))

describe('tarama kapsami (sessizce bos kalmasin)', () => {
  it('beklenen kapi dosyalari diskten turetilen listede; test dosyasi yok', () => {
    const adlar = TUM.map((d) => d.rel)
    for (const rel of [
      'background.js',
      'utils/messageGate.js',
      'utils/tokenizedStocks.js',
      'utils/stockGate/rules.js',
      'utils/stockGate/decide.js',
      'utils/stockGate/errors.js',
      'utils/stockGate/rulesClient.js',
      'utils/stockGate/gate.js',
      'data/eligibilityRules.js',
      'data/countryCodes.js',
      'composables/useStockGate.js',
      'composables/useStockEligibility.js',
      'composables/useAtsOpFee.js',
      'components/Swap.vue',
      'components/Bridge.vue',
      'components/stocks/StockTrade.vue',
      'components/stocks/StockOrderConfirm.vue',
      'utils/stocks/engines/pancakeEngine.js',
      'utils/stocks/engines/cowEngine.js',
      'utils/stocks/engines/errors.js',
      'data/xStocksRetired.js',
      'data/bStocksRetired.js',
      'utils/swap.js',
      'components/swap/swapTo.vue',
      'components/swap/swapFrom.vue',
      'popup/App.vue',
      ...KAPI_EKRANLARI,
    ]) {
      expect(adlar, rel).toContain(rel)
    }
    expect(KAPI.length).toBeGreaterThanOrEqual(10)
    expect(TUM.some((d) => testDosyasi(d.rel))).toBe(false)
  })
})

// 1. spec 11.5-1: kapi, queued kaydindan ve ilk ag cagrisindan ONCE
// 'queued' yazimi degisken adina BAGLI DEGIL: mutasyon turu (M1) txId'den bagimsiz bir 'queued' satiri ekler
const KUYRUK = /updateTxStatus\([^)]*,\s*'queued'/
const ISLEYICILER = [
  { ad: 'swap', yontem: 'evaluate', engeller: [KUYRUK] },
  { ad: 'swapQuote', yontem: 'evaluate', engeller: ['new ethers.JsonRpcProvider('] },
  { ad: 'atsSwapFeeQuote', yontem: 'evaluate', engeller: ['new ethers.JsonRpcProvider(', 'quoteAtsTransfer('] },
  { ad: 'bridge', yontem: 'evaluateBridgeTarget', engeller: [KUYRUK] },
  { ad: 'getBridgeQuote', yontem: 'evaluate', engeller: ['bridgeQuote('] },
  { ad: 'atsBridgeFeeQuote', yontem: 'evaluateBridgeTarget', engeller: ['new ethers.JsonRpcProvider(', 'quoteAtsTransfer('] },
]

describe('1. kapi queued kaydindan ve ilk ag cagrisindan ONCE (alti isleyici)', () => {
  it.each(ISLEYICILER.map((i) => [i.ad, i.yontem, i.engeller]))('%s: getStockGate().%s( cagrisi queued kaydindan ve ag cagrilarindan ONCE gelir', (ad, yontem, engeller) => {
    const govde = govdeOf(ad)
    const kapi = kapiIndeksi(govde, yontem)
    expect(kapi, `${ad}: getStockGate().${yontem}( cagrisi yok`).toBeGreaterThan(-1)
    for (const engel of engeller) {
      const i = engel instanceof RegExp ? govde.search(engel) : govde.indexOf(engel)
      expect(i, `${ad}: pozitif bekci, ${engel} bulunamadi`).toBeGreaterThan(-1)
      expect(kapi, `${ad}: kapi ${engel} ten ONCE olmali`).toBeLessThan(i)
    }
  })

  // Alti isleyicinin HEPSI: hisse olmayan ciktida / hedefte ek async yok. Kopru yurutme ve ATS kopru ucreti de
  // esitzamanli on kontrole baglidir (TQ-2): `if (bridgeTargetGated(toChain, toTokenAddress))` yanlis ise ne
  // getStockGate() ne await calisir (ETH -> ARB gibi hedefler).
  it.each(ISLEYICILER.map((i) => [i.ad, i.yontem]))(
    '%s: hisse olmayan ciktida sifir ek async: esitzamanli on kontrol (`if (stockOutputIssuer(` / `if (bridgeTargetGated(`), kapi (%s) o if blogunun icinde',
    (ad, yontem) => {
      const govde = govdeOf(ad)
      const kapi = kapiIndeksi(govde, yontem)
      const on = govde.search(/\bif\s*\(\s*(?:stockOutputIssuer|bridgeTargetGated)\(/)
      expect(on, `${ad}: esitzamanli on kontrol (if (stockOutputIssuer( ya da if (bridgeTargetGated() yok`).toBeGreaterThan(-1)
      expect(on, `${ad}: on kontrol kapidan once olmali`).toBeLessThan(kapi)
      const ifBas = govde.indexOf('{', on)
      expect(ifBas, `${ad}: if blogu acilisi yok`).toBeGreaterThan(on)
      expect(kapi, `${ad}: kapi cagrisi if blogunun ICINDE olmali (acilistan sonra)`).toBeGreaterThan(ifBas)
      expect(kapi, `${ad}: kapi cagrisi if blogunun ICINDE olmali (kapanistan once)`).toBeLessThan(eslesenKapanis(govde, ifBas))
    },
  )

  it.each(['bridge', 'atsBridgeFeeQuote'])(
    '%s: on kontrol bridgeTargetGated(toChain, toTokenAddress); yardimci hisse hedefi VEYA bridgeStockChainIds() zinciri icin sorar, kapiya ve await e dokunmaz',
    (ad) => {
      expect(govdeOf(ad)).toMatch(/\bif\s*\(\s*bridgeTargetGated\(\s*toChain\s*,\s*toTokenAddress\s*\)\s*\)/)
      const yardimci = blokGovdesi(ham('background.js'), /function bridgeTargetGated\([^)]*\)\s*/)
      expect(yardimci, 'bridgeTargetGated govdesi bulunamadi').toBeTruthy()
      expect(yardimci).toMatch(/stockOutputIssuer\(\s*toChain\s*,\s*address\s*\)/)
      expect(yardimci).toMatch(/bridgeStockChainIds\(\)\.includes\(\s*Number\(toChain\)\s*\)/)
      expect(yardimci).not.toMatch(/getStockGate|await/)
    },
  )
})

describe('2. Sat acik: kapi yalniz CIKTI tokenina (ve kopru HEDEFINE) bakar', () => {
  it.each(['swap', 'swapQuote', 'atsSwapFeeQuote'])('%s: stockOutputIssuer( chainId ile outTokenAddress e bakar, girdi tokenina bakmaz', (ad) => {
    const govde = govdeOf(ad)
    expect(govde).toMatch(/stockOutputIssuer\(\s*chainId\s*,\s*outTokenAddress\s*\)/)
    expect(govde).not.toMatch(/stockOutputIssuer\([^)]*inTokenAddress/)
    expect(govde).not.toMatch(/\.evaluate\(\{[^}]*inTokenAddress/)
  })

  it('getBridgeQuote: stockOutputIssuer( toChain ile hedef token adresine bakar; kaynak token kapiya girmez', () => {
    const govde = govdeOf('getBridgeQuote')
    expect(govde).toMatch(/stockOutputIssuer\(\s*toChain\s*,\s*outToken\??\.address\s*\)/)
    expect(govde).not.toMatch(/stockOutputIssuer\([^)]*inToken/)
  })

  it.each(['bridge', 'atsBridgeFeeQuote'])('%s: evaluateBridgeTarget({ toChain, toTokenAddress }) hedefe bakar, kaynak tokena degil', (ad) => {
    const govde = govdeOf(ad)
    expect(govde).toMatch(/evaluateBridgeTarget\(\{\s*toChain\s*,\s*toTokenAddress\s*\}\)/)
    expect(govde).not.toMatch(/evaluateBridgeTarget\([^)]*fromToken/)
  })
})

describe('5. saf yoneticiler yalniz izinli isleyicilerden cagrilir (spec 5.0-4)', () => {
  const bgKod = () => kodu('background.js')
  const aralik = (kod, imza) => {
    const m = kod.match(imza)
    if (!m) return null
    const bas = kod.indexOf('{', m.index + m[0].length - 1)
    return [bas, eslesenKapanis(kod, bas)]
  }
  const icinde = (aralikOrani, i) => aralikOrani.some((a) => a && i > a[0] && i < a[1])

  it('getExpectedOutput / buildSwapCalls / executeSwap cagrilari background.js te yalniz swap, swapQuote, atsSwapFeeQuote govdelerinde', () => {
    const kod = bgKod()
    const izinli = ['swap', 'swapQuote', 'atsSwapFeeQuote'].map((ad) => aralik(kod, imzaOf(ad)))
    expect(izinli.every(Boolean), 'izinli isleyici govdesi bulunamadi').toBe(true)
    const cagrilar = [...kod.matchAll(/\.(getExpectedOutput|buildSwapCalls|executeSwap)\(/g)]
    expect(cagrilar.length, 'pozitif bekci: cagrilar bulunamadi').toBeGreaterThanOrEqual(4)
    const disarida = cagrilar.filter((m) => !icinde(izinli, m.index)).map((m) => m[0])
    expect(disarida).toEqual([])
    // her izinli isleyici gercekten en az bir cagri tasir (aralik hesabi vakumda gecmesin)
    for (const a of izinli) expect(cagrilar.some((m) => icinde([a], m.index))).toBe(true)
  })

  it('bridgeQuote( cagrisi background.js te yalniz getBridgeQuote govdesinde', () => {
    const kod = bgKod()
    const izinli = [aralik(kod, imzaOf('getBridgeQuote'))]
    expect(izinli[0]).toBeTruthy()
    const cagrilar = [...kod.matchAll(/\bbridgeQuote\(/g)]
    expect(cagrilar.length).toBeGreaterThanOrEqual(1)
    expect(cagrilar.filter((m) => !icinde(izinli, m.index))).toEqual([])
  })

  it('tanim dosyalari (utils/swap.js, utils/bridge.js) disinda hicbir kaynak dosya bu yontemleri cagirmaz', () => {
    const baskasi = TUM.filter(
      (d) =>
        d.rel !== 'background.js' &&
        d.rel !== 'utils/swap.js' &&
        d.rel !== 'utils/bridge.js' &&
        (/\.(getExpectedOutput|buildSwapCalls|executeSwap)\(/.test(d.kod) || /\bbridgeQuote\(/.test(d.kod)),
    ).map((d) => d.rel)
    expect(baskasi).toEqual([])
  })

  // TQ-3 (K4, guvenlik degismezi): Sat, Gonder ve goruntuleme HER KOSULDA acik. getStockGate() cagrisi background.js
  // icinde YALNIZ alti edinme isleyicisinde, tek STOCK_GATE_ ic aksiyon isleyicisinde (stockGateStatus) ve (Grup B, Task 29) CoW kapi
  // baglayicisinda bulunabilir; bir gonderim / imza isleyicisine kapi eklenirse hissenin Gonder'i de kesilirdi.
  it('getStockGate() cagrilari yalniz izinli isleyicilerde (Gonder / imza / dApp yollari kapiya girmez)', () => {
    const kod = bgKod()
    const IZINLI = [
      'swap', 'swapQuote', 'atsSwapFeeQuote', 'bridge', 'getBridgeQuote', 'atsBridgeFeeQuote',
      'stockGateStatus',
    ]
    const GRUP_B = ['cowStockGate', 'getCowRuntime'] // Task 29 ile gelir; Grup A tek basinayken yoktur, varsa izinlidir
    const aralikOf = (ad) => aralik(kod, new RegExp(`(?:async )?function ${ad}\\([^)]*\\)\\s*`))
    for (const ad of IZINLI) expect(aralikOf(ad), `${ad} govdesi bulunamadi`).toBeTruthy()
    const aralar = [...IZINLI, ...GRUP_B].map(aralikOf).filter(Boolean)
    const cagrilar = [...kod.matchAll(/(?<!function\s)getStockGate\(\)/g)]
    expect(cagrilar.length, 'pozitif bekci: getStockGate() cagrilari bulunamadi').toBeGreaterThanOrEqual(8) // olculen: alti edinme + STATUS + cowStockGate (K32 sonrasi)
    const disarida = cagrilar.filter((m) => !icinde(aralar, m.index)).map((m) => kod.slice(Math.max(0, m.index - 60), m.index + 20))
    expect(disarida).toEqual([])
  })

  it('sendTxInternal / sendTonInternal / signInternal govdeleri kapiya ve hisse sorusuna dokunmaz', () => {
    for (const ad of ['sendTxInternal', 'sendTonInternal', 'signInternal']) {
      expect(govdeOf(ad), ad).not.toMatch(/getStockGate\(|stockIssuer\(|stockOutputIssuer\(|stockGateError\(/)
    }
  })
})

describe('6. kapi modulleri: console / gizli anahtar / bayrak / ag (spec 11.5-8)', () => {
  const YASAK = [
    ['console.', /\bconsole\./],
    ['privateKey', /\bprivateKey\b/],
    ['mnemonic', /\bmnemonic\b/],
    ['featureFlags', /featureFlags/],
    ['XSTOCKS_ENABLED / SOLANA_ENABLED', /\b(XSTOCKS_ENABLED|SOLANA_ENABLED)\b/],
    ['localStorage / sessionStorage', /\b(localStorage|sessionStorage)\b/],
    ['AbortSignal.timeout', /AbortSignal\.timeout/],
    ['sendBeacon / XMLHttpRequest / WebSocket', /\b(sendBeacon|XMLHttpRequest|WebSocket)\b/],
  ]

  it.each(YASAK)('kapi dosyalarinda %s yok', (_ad, desen) => {
    for (const d of KAPI) expect(d.kod, d.rel).not.toMatch(desen)
  })

  it.each(KAPI_EKRANLARI)('%s bayraga baglanmaz (featureFlags / XSTOCKS_ENABLED / SOLANA_ENABLED yok)', (rel) => {
    expect(kodu(rel)).not.toMatch(/featureFlags|\bXSTOCKS_ENABLED\b|\bSOLANA_ENABLED\b/)
  })

  it('ag cagrisi (fetch) kapi dosyalari arasinda yalniz rulesClient.js te', () => {
    expect(KAPI.filter((d) => /\bfetch\b/.test(d.kod)).map((d) => d.rel)).toEqual(['utils/stockGate/rulesClient.js'])
  })

  // ANLAM (Bolum 2, iki katmanli yanit): onceden istek SORGUSUZDU. Simdi tek istisna sabit surum isareti `?v=2` (TAM ihracci
  // tablosu ister; sorgusuz yanit eski istemciler icin iki ihraccili projeksiyondur). Baska sorgu parametresi (ulke, hesap,
  // ihracci, kullaniciya ozgu bir sey) URL'ye GIRMEZ: adres tam olarak `/eligibility?v=2`.
  it('rulesClient.js: istek yalniz GET /eligibility?v=2 (sabit surum isareti; baska sorgu yok); basliksiz, govdesiz, cerezsiz (credentials omit)', () => {
    const args = cagriGovdesi(ham('utils/stockGate/rulesClient.js'), /\bfetchFn\(/)
    expect(args, 'fetchFn( cagrisi bulunamadi').toBeTruthy()
    expect(args).toMatch(/\/eligibility/)
    expect(args.match(/\/eligibility[^\s'"`,)]*/g)).toEqual(['/eligibility?v=2'])
    expect(args).toMatch(/method:\s*'GET'/)
    expect(args).toMatch(/cache:\s*'no-store'/)
    expect(args).toMatch(/credentials:\s*'omit'/)
    expect(args).not.toMatch(/\bheaders\b/)
    expect(args).not.toMatch(/\bbody\b/)
  })

})

describe('7. Swap / Kopru / ATS: kapi yanitini ayristirir (spec 5.11, 11.5-12)', () => {
  const IMPORT = /import\s*\{[^}]*\bparseStockGateError\b[^}]*\}\s*from\s*['"][^'"]*stockGate\/errors['"]/

  // Task 21 / 22 kod bicimi: parseStockGateError YARDIMCIDA (`rejectedByStockGate`), swap() / bridge() govdesi yardimciyi
  // cagirir. Yanit degiskene alinir ve yardimci, 'home' yazimindan (Swap) / `resp?.success` okumasindan (Bridge) ONCE gelir.
  it('Swap.vue: rejectedByStockGate parseStockGateError ile ayristirir; swap() SWAP yanitini degiskene alip home yazimindan ONCE ona sorar', () => {
    const kaynak = ham('components/Swap.vue')
    expect(kaynak).toMatch(IMPORT)
    const yardimci = blokGovdesi(kaynak, /const rejectedByStockGate = async\s*\(resp\)\s*=>\s*/)
    expect(yardimci, 'Swap.vue rejectedByStockGate govdesi bulunamadi').toBeTruthy()
    expect(yardimci).toContain('parseStockGateError(')
    const govde = blokGovdesi(kaynak, /const swap = async\s*\(\)\s*=>\s*/)
    expect(govde, 'Swap.vue swap() govdesi bulunamadi').toBeTruthy()
    expect(govde).toMatch(/\w+\s*=\s*await\s+chrome\.runtime\.sendMessage\(\{\s*type:\s*'SWAP'\s*,/)
    const sonra = govde.slice(govde.indexOf("type: 'SWAP'"))
    const red = sonra.indexOf('rejectedByStockGate(')
    const home = sonra.indexOf("currentPage = 'home'")
    expect(red, 'rejectedByStockGate( cagrisi yok').toBeGreaterThan(-1)
    expect(home, "pozitif bekci: currentPage = 'home' yok").toBeGreaterThan(-1)
    expect(red).toBeLessThan(home)
  })

  it('Bridge.vue: rejectedByStockGate parseStockGateError ile ayristirir; bridge() BRIDGE yanitini degiskene alip resp?.success okumasindan ONCE ona sorar', () => {
    const kaynak = ham('components/Bridge.vue')
    expect(kaynak).toMatch(IMPORT)
    const yardimci = blokGovdesi(kaynak, /const rejectedByStockGate = async\s*\(resp\)\s*=>\s*/)
    expect(yardimci, 'Bridge.vue rejectedByStockGate govdesi bulunamadi').toBeTruthy()
    expect(yardimci).toContain('parseStockGateError(')
    const govde = blokGovdesi(kaynak, /const bridge = async\s*\(\)\s*=>\s*/)
    expect(govde, 'Bridge.vue bridge() govdesi bulunamadi').toBeTruthy()
    expect(govde).toMatch(/\w+\s*=\s*await\s+chrome\.runtime\.sendMessage\(\{\s*type:\s*'BRIDGE'\s*,/)
    const sonra = govde.slice(govde.indexOf("type: 'BRIDGE'"))
    const red = sonra.indexOf('rejectedByStockGate(')
    const oku = sonra.search(/\bresp\?\.success\b/)
    expect(red, 'rejectedByStockGate( cagrisi yok').toBeGreaterThan(-1)
    expect(oku, 'pozitif bekci: resp?.success okumasi yok').toBeGreaterThan(-1)
    expect(red).toBeLessThan(oku)
  })

  it("useAtsOpFee.load: code === 'STOCK_GATE' dali resolveAtsBlocker( cagrisindan ONCE", () => {
    const govde = blokGovdesi(ham('composables/useAtsOpFee.js'), /const load = async \(\{ kind, payload \}\) =>\s*/)
    expect(govde, 'useAtsOpFee load() govdesi bulunamadi').toBeTruthy()
    const dal = govde.indexOf("'STOCK_GATE'")
    const blocker = govde.indexOf('resolveAtsBlocker(')
    expect(dal, "'STOCK_GATE' dali yok").toBeGreaterThan(-1)
    expect(blocker, 'pozitif bekci: resolveAtsBlocker( yok').toBeGreaterThan(-1)
    expect(dal).toBeLessThan(blocker)
  })
})

describe('9. kopru yuku: toChain ve toTokenAddress AYNI teklif nesnesinden (spec 5.3, 11.5-7)', () => {
  it('Bridge.vue: BRIDGE mesaji bridgeData.value.action ten, ATS yuku d.action ten kurar', () => {
    const kod = kodu('components/Bridge.vue')
    expect(kod).toMatch(/toChain:\s*bridgeData\.value\.action\.toChainId/)
    expect(kod).toMatch(/toTokenAddress:\s*bridgeData\.value\.action\.toToken\?\.address/)
    expect(kod).toMatch(/toChain:\s*d\.action\.toChainId/)
    expect(kod).toMatch(/toTokenAddress:\s*d\.action\.toToken\?\.address/)
  })

  it('txMetaPayloadWiring.test.js toTokenAddress icin olumlu iddia tasir ve toTokenData yasagi korunur', () => {
    const t = ham('utils/txMetaPayloadWiring.test.js')
    expect(t).toContain('toTokenAddress')
    expect(t).toMatch(/not\.toContain\(\s*'toTokenData'\s*\)/)
  })
})

describe('10. ISSUER_INFO degismez (spec 11.5-11; main noBridgeKey i kaldirdi: iki anahtar)', () => {
  it('tokenizedStocks.js ISSUER_INFO yalniz iki anahtar (badgeKey, issuerKey) tasir; noBridgeKey YOK; stockGate adini anmaz', () => {
    const govde = cagriGovdesi(ham('utils/tokenizedStocks.js'), /const ISSUER_INFO = Object\.freeze\(/)
    expect(govde, 'ISSUER_INFO bulunamadi').toBeTruthy()
    expect(govde).not.toMatch(/stockGate/)
    expect(govde).not.toMatch(/noBridgeKey/)
    for (const anahtar of ['badgeKey', 'issuerKey']) {
      expect(govde.match(new RegExp(`\\b${anahtar}\\b`, 'g')), anahtar).toHaveLength(2)
    }
  })

  it('tokenizedStocks.test.js iki toEqual i yerinde (issuerKey satirlari)', () => {
    const t = ham('utils/tokenizedStocks.test.js')
    expect(t).toContain("issuerKey: 'token.xStockIssuer'")
    expect(t).toContain("issuerKey: 'token.bStockIssuer'")
  })
})

describe('12. ortak Hisse Al/Sat ekrani: TEK, ihraccidan bagimsiz ayna (K29)', () => {
  const T = 'components/stocks/StockTrade.vue'

  it('useStockGate kaynagi stock.issuer ve side dan turer; argumanda ihracci dize sabiti YOK', () => {
    const arg = cagriGovdesi(ham(T), /\buseStockGate\(/)
    expect(arg, 'useStockGate( cagrisi yok').toBeTruthy()
    expect(arg).toContain("side.value === 'buy'")
    expect(arg).toContain('stock.value.issuer')
    expect(arg).not.toMatch(/['"](?:bstocks|xstocks)['"]/)
  })

  it('bant sayfa gecisi prop u tasimaz; beyan ekranina gidis (goToGate / openGate) ve sayfa yazimi ekranda yok', () => {
    const kod = kodu(T)
    expect(kod).toMatch(/<StockGateBand\b[^>]*:issuer="stock\.issuer"/) // pozitif bekci: tarama gercek kaynagi goruyor
    expect(kod).not.toMatch(/return-page|returnPage|goToGate|openGate|stock_gate/)
    expect(kod).not.toMatch(/currentPage\s*=/)
  })

  // K32: kapi baglari KORUNUR; yalniz beyan dali (eylem kipi) dustu. Guvenlik bagi gevsemez: ana dugme kapi kapaliyken HER ZAMAN pasif.
  it('grup 12: kapi baglari korunur (quoteEnabled stockGateOpen a, blockReason stockGateBlocked a, :disabled blockReason a bagli; onPrimary kapali kapida erken doner)', () => {
    const kod = kodu(T)
    expect(kod).toMatch(/const quoteEnabled = computed\([^\n]*stockGateOpen\.value/)
    expect(kod).toMatch(/marketBlocked\.value && stockGateOpen\.value \? 'lock-MARKET_CLOSED'/)
    expect(kod).toMatch(/stockGateBlocked:\s*!stockGateOpen\.value/)
    expect(kod).toContain(':disabled="blockReason !== null"')
    expect(kod).not.toContain('gateActionCta')
    const govde = blokGovdesi(ham(T), /function onPrimary\(\)\s*/)
    expect(govde, 'onPrimary govdesi bulunamadi').toBeTruthy()
    expect(govde).toContain("if (quote.state !== 'ready' || blockReason.value !== null) return")
    expect(govde.indexOf('blockReason.value !== null) return')).toBeLessThan(govde.indexOf("primaryAction.value === 'approve'"))
  })

  it('openApprove kapi kapaliyken onay adimini ACMAZ (savunma): govdenin ilk isi kapi kontrolu', () => {
    const govde = blokGovdesi(ham(T), /function openApprove\(\)\s*/)
    expect(govde, 'openApprove govdesi bulunamadi').toBeTruthy()
    expect(govde.indexOf('stockGateOpen.value')).toBeGreaterThan(-1)
    expect(govde.indexOf('stockGateOpen.value')).toBeLessThan(govde.indexOf('approveOpen.value = true'))
  })

  it('yaris izleyicileri: teklif STOCK_GATE kilidi, ATS ucret teklifi ve onay adimi STOCK_GATE hatasi kapiyi yeniden sorar', () => {
    const kod = kodu(T)
    expect(kod).toMatch(/watch\(\(\) => quote\.state === 'locked' && quote\.lockReason === 'STOCK_GATE'[^\n]*stockGate\.refresh\(\)/)
    expect(kod).toMatch(/watch\(\(\) => approveStep\.errorCode === 'STOCK_GATE'[^\n]*stockGate\.refresh\(\)/)
    expect(kod).toMatch(/watch\(\(\) => gates\.ats\.errorCode === 'STOCK_GATE'[^\n]*stockGate\.refresh\(\)/)
    expect(blokGovdesi(ham(T), /function onConfirmExpired\(\{ code \} = \{\}\)\s*/)).toContain("code === 'STOCK_GATE'")
  })

  it("StockOrderConfirm CLOSING_CODES 'STOCK_GATE' icerir (kapi imza oncesi reddederse katman kapanir)", () => {
    expect(kodu('components/stocks/StockOrderConfirm.vue')).toMatch(/const CLOSING_CODES = new Set\(\[[^\]]*'STOCK_GATE'/)
  })

  it('Sat acik: ekran STOCK_GATE_DECLARE / _RESET / _LIST mesaji gondermez; Sat ta kapi kaynagi null', () => {
    expect(kodu(T)).not.toMatch(/STOCK_GATE_(?:DECLARE|RESET|LIST)/)
    expect(cagriGovdesi(ham(T), /\buseStockGate\(/)).toMatch(/\?\s*stock\.value\.issuer\s*:\s*null/)
  })

  it('ihracci ve zincir gecis bilesenleri kapiya baglanmaz (gecis dugmeleri kilitlenmez, yalniz Al CTA kapanir)', () => {
    const kod = kodu(T)
    expect(kod).toMatch(/<IssuerSwitch\b(?![^>]*stockGate)[^>]*>/)
    expect(kod).toMatch(/<StockChainPicker\b(?![^>]*stockGate)[^>]*>/)
  })

  it('App.vue: StockTrade satiri bayraksiz, XSTOCKS_ENABLED adi App.vue da gecmez (StockFlagMatrix ile ayni degismez)', () => {
    const app = kodu('popup/App.vue') // yorumsuz: App.vue yorumlari bayrak adini anabilir
    expect(app).not.toContain('XSTOCKS_ENABLED')
    const st = app.match(/<StockTrade\b[^>]*>/)
    expect(st, '<StockTrade> App.vue da yok').toBeTruthy()
    // Main (gizli mod): StockTrade gizli modda ekran seviyesinde baglanmaz (!privacy.active); bu bir ozellik BAYRAGI degil
    // mod kapisidir (Hisseler sekmesi de gizli modda yoktur, P13). Tek && bu on ek; bayrak adi gecmez.
    expect(st[0]).toContain(`v-if="!privacy.active && page.currentPage === 'stock_trade'"`)
    expect(st[0]).not.toMatch(/ENABLED|featureFlags/)
    expect((st[0].match(/&&/g) || []).length).toBe(1)
  })
})

describe('13. motorlar: pancakeEngine kapi sonucunu esler (K30)', () => {
  const P = 'utils/stocks/engines/pancakeEngine.js'

  it('parseStockGateError ve gateLockedReply stockGate/errors tan alinir', () => {
    const k = ham(P)
    expect(k).toMatch(/import\s*\{[^}]*\bgateLockedReply\b[^}]*\}\s*from\s*'\.\.\/\.\.\/stockGate\/errors'/)
    expect(k).toMatch(/import\s*\{[^}]*\bparseStockGateError\b[^}]*\}\s*from\s*'\.\.\/\.\.\/stockGate\/errors'/)
  })

  it("quote: sentinel dali (reply.error dali icinde) mapBackgroundError ve console.error dan ONCE", () => {
    const g = blokGovdesi(ham(P), /async function quote\(raw\)\s*/)
    expect(g, 'quote govdesi bulunamadi').toBeTruthy()
    const dalBasi = g.indexOf("typeof reply.error === 'string'")
    expect(dalBasi, 'reply.error dali bulunamadi').toBeGreaterThan(-1)
    const dal = g.slice(dalBasi)
    const sentinel = dal.indexOf('parseStockGateError(')
    expect(sentinel).toBeGreaterThan(-1)
    expect(dal, 'pozitif bekci: mapBackgroundError( yok').toContain('mapBackgroundError(')
    expect(dal, 'pozitif bekci: console.error( yok').toContain('console.error(')
    expect(sentinel).toBeLessThan(dal.indexOf('mapBackgroundError('))
    expect(sentinel).toBeLessThan(dal.indexOf('console.error('))
    expect(g).toContain('gateLockedReply(')
  })

  it('place: sentinel dali UNVERIFIED_ERROR ayristirmasindan ve mapBackgroundError dan ONCE; ENGINE_ERROR.STOCK_GATE doner', () => {
    const g = blokGovdesi(ham(P), /async function place\([^)]*\)\s*/)
    expect(g, 'place govdesi bulunamadi').toBeTruthy()
    const sentinel = g.indexOf('parseStockGateError(')
    expect(sentinel).toBeGreaterThan(-1)
    expect(sentinel).toBeLessThan(g.indexOf('UNVERIFIED_ERROR.exec('))
    expect(sentinel).toBeLessThan(g.lastIndexOf('mapBackgroundError('))
    expect(g).toContain('placeFail(ENGINE_ERROR.STOCK_GATE)')
  })

  it("ENGINE_ERROR.STOCK_GATE CoW kodundan yayilir: PANCAKE_ERROR_CODES te 'STOCK_GATE' yok, errors.js COW_ERROR i yayar", () => {
    const dizi = diziGovdesi(ham('utils/stocks/engines/errors.js'), /export const PANCAKE_ERROR_CODES = /)
    expect(dizi, 'PANCAKE_ERROR_CODES bulunamadi').toBeTruthy()
    expect(dizi).not.toContain('STOCK_GATE')
    expect(kodu('utils/stocks/engines/errors.js')).toMatch(/\.\.\.COW_ERROR/)
  })

  it('cowEngine kapi modulunu import etmez (kapi arka planda; kilit yaniti ve kod aynen iletilir)', () => {
    expect(kodu('utils/stocks/engines/cowEngine.js')).not.toMatch(/stockGate/)
  })
})

describe('14. emekli xStocks adresleri: yalniz CIKTI tarafi (K28)', () => {
  it('data/xStocksRetired.js saf veridir; tokenizedStocks.js onu alir ama katalog indeksine (BY_KEY / stockEntry / stockIssuer) KATMAZ', () => {
    expect(kodu('data/xStocksRetired.js')).not.toMatch(/^\s*import\s/m)
    // K28 icerik bekcisi: liste bosaltilirsa emekli adresler kapisiz alinabilir (pozitif bekci: uc kayit)
    expect(RETIRED_XSTOCKS.length).toBeGreaterThanOrEqual(3)
    const k = kodu('utils/tokenizedStocks.js')
    expect(k).toMatch(/import\s*\{[^}]*\bRETIRED_XSTOCKS\b[^}]*\}\s*from\s*'\.\.\/data\/xStocksRetired'/)
    expect(k.match(/const BY_KEY = [^\n]*/)[0]).not.toMatch(/RETIRED|Retired/)
    expect(blokGovdesi(ham('utils/tokenizedStocks.js'), /export function stockEntry\(chainId, address\)\s*/)).not.toMatch(/RETIRED|Retired/)
    expect(k.match(/export const stockIssuer = [^\n]*/)[0]).not.toMatch(/RETIRED|Retired/)
  })

  it('background.js: kapi cagri yerleri stockOutputIssuer kullanir, stockIssuer( cagrisi YOK; enjeksiyon stockIssuer: stockOutputIssuer', () => {
    const kod = kodu('background.js')
    expect(kod).not.toMatch(/\bstockIssuer\s*\(/)
    // swap, swapQuote, atsSwapFeeQuote, getBridgeQuote, bridgeTargetGated
    expect((kod.match(/\bstockOutputIssuer\s*\(/g) ?? []).length).toBeGreaterThanOrEqual(5)
    expect(kod).toMatch(/stockIssuer:\s*stockOutputIssuer/)
  })

  it('swap.js assertNotXStock: girdi katalog-yalniz (isGeneralSwapExcluded), cikti emekli dahil (isGeneralSwapOutputExcluded); swapTo ciktiyi, swapFrom girdiyi sorar', () => {
    const g = blokGovdesi(ham('utils/swap.js'), /assertNotXStock\(inputToken, outputToken\)\s*/)
    expect(g, 'assertNotXStock govdesi bulunamadi').toBeTruthy()
    expect(g).toMatch(/isGeneralSwapExcluded\(\s*this\.chainId\s*,\s*inputToken\s*\)/)
    expect(g).toMatch(/isGeneralSwapOutputExcluded\(\s*this\.chainId\s*,\s*outputToken\s*\)/)
    expect(kodu('components/swap/swapTo.vue')).toContain('isGeneralSwapOutputExcluded(')
    expect(kodu('components/swap/swapFrom.vue')).not.toContain('isGeneralSwapOutputExcluded')
  })

  it('isBridgeBlocked (KAYNAK) emekli adresi bilmez: yalniz katalog dislamasi (isXstockExcludedAddress) kullanir; isBridgeTargetBlocked (HEDEF) bilir', () => {
    const k = kodu('utils/tokenizedStocks.js')
    const govde = (ad) => {
      const i = k.indexOf(`export const ${ad} =`)
      expect(i, `${ad} tanimi bulunamadi`).toBeGreaterThan(-1)
      return k.slice(i, k.indexOf('\nexport', i + 10))
    }
    expect(govde('isBridgeBlocked')).toContain('isXstockExcludedAddress')
    expect(govde('isBridgeBlocked')).not.toContain('isRetiredXstock')
    expect(govde('isGeneralSwapExcluded')).not.toContain('isRetiredXstock')
    expect(govde('isBridgeTargetBlocked')).toContain('isRetiredXstock')
    expect(govde('isGeneralSwapOutputExcluded')).toContain('isRetiredXstock')
  })
})

describe('14b. emekli bStocks adresleri: yalniz CIKTI tarafinda KAPI (K28 ilkesi; dislama listesine girmez)', () => {
  it('data/bStocksRetired.js saf veridir; tokenizedStocks.js onu alir ama katalog indeksine (BY_KEY / stockEntry / stockIssuer) KATMAZ', () => {
    expect(kodu('data/bStocksRetired.js')).not.toMatch(/^\s*import\s/m)
    // icerik bekcisi: liste bosaltilirsa BMNRB / FLNCB kapisiz alinabilir (pozitif bekci: iki kayit)
    expect(RETIRED_BSTOCKS.length).toBeGreaterThanOrEqual(2)
    const k = kodu('utils/tokenizedStocks.js')
    expect(k).toMatch(/import\s*\{[^}]*\bRETIRED_BSTOCKS\b[^}]*\}\s*from\s*'\.\.\/data\/bStocksRetired'/)
    expect(k.match(/const BY_KEY = [^\n]*/)[0]).not.toMatch(/RETIRED|Retired/)
    expect(blokGovdesi(ham('utils/tokenizedStocks.js'), /export function stockEntry\(chainId, address\)\s*/)).not.toMatch(/RETIRED|Retired/)
    expect(k.match(/export const stockIssuer = [^\n]*/)[0]).not.toMatch(/RETIRED|Retired/)
  })

  it('stockOutputIssuer emekli bStocks adresini tanir (isRetiredBstock); dislama ve girdi tarafi fonksiyonlari tanimaz', () => {
    const k = kodu('utils/tokenizedStocks.js')
    const govde = (ad) => {
      const i = k.indexOf(`export const ${ad} =`)
      expect(i, `${ad} tanimi bulunamadi`).toBeGreaterThan(-1)
      return k.slice(i, k.indexOf('\nexport', i + 10))
    }
    expect(govde('stockOutputIssuer')).toContain('isRetiredBstock')
    for (const ad of ['stockIssuer', 'isBridgeBlocked', 'isBridgeTargetBlocked', 'isGeneralSwapExcluded', 'isGeneralSwapOutputExcluded']) {
      expect(govde(ad), ad).not.toContain('isRetiredBstock')
    }
  })
})

describe('15. Sat / Gonder / goruntuleme acik (K4): ekran ve motorlar kapiyi arka plandan baska yerden calistirmaz', () => {
  it('components / composables / engines icinde getStockGate( ya da createStockGate( yok (kapi yalniz arka planda)', () => {
    const arayuz = TUM.filter((d) => /^(components|composables|utils\/stocks\/engines)\//.test(d.rel))
    expect(arayuz.length, 'pozitif bekci').toBeGreaterThan(40)
    expect(arayuz.filter((d) => /getStockGate\(|createStockGate\(/.test(d.kod)).map((d) => d.rel)).toEqual([])
  })

  it('Send / Token / StockDetail Gonder ve goruntuleme yollari kapi aynasini ice aktarmaz', () => {
    for (const rel of ['components/Send.vue', 'components/Token.vue', 'components/stocks/StockDetail.vue']) {
      const d = TUM.find((x) => x.rel === rel)
      expect(d, `pozitif bekci: ${rel} taranmali`).toBeTruthy()
      expect(d.kod, rel).not.toMatch(/useStockGate|StockGateBand|openGate/)
    }
  })
})

// server/ yoksa (istemci tek basina baska bir depoya kopyalanmissa) bu bolum atlanir; depoda ise zorunludur.
const sunucuVar = fs.existsSync(path.join(REPO, 'server', 'router.js'))

describe.skipIf(!sunucuVar)('11. sunucu: test dosyalari var, /eligibility kendi sinirlayicisinda (spec 10, 17)', () => {
  const SUNUCU_TESTLERI = [
    'eligibilityData',
    'eligibilityRateLimit',
    'eligibilityController',
    'eligibilityRouterWiring',
    'eligibilityRulesLoad',
    'eligibilityPrivacy',
    'eligibilityClientCompat',
    'geoCountry',
  ]

  it.each(SUNUCU_TESTLERI)('server/test/%s.test.js var', (ad) => {
    expect(fs.existsSync(path.join(REPO, 'server', 'test', `${ad}.test.js`))).toBe(true)
  })

  it('router.js /eligibility rotasi eligibilityIpLimiter tasir, reputationIpLimiter tasimaz', () => {
    const router = fs.readFileSync(path.join(REPO, 'server', 'router.js'), 'utf8')
    const satir = router.split(/\r?\n/).find((l) => l.includes("'/eligibility'"))
    expect(satir, "router.js te '/eligibility' satiri yok").toBeTruthy()
    expect(satir).toContain('eligibilityIpLimiter')
    expect(satir).not.toContain('reputationIpLimiter')
  })

  it('eligibilityRateLimit.js bundlerRateLimit ten yalniz ipSubnetKey alir', () => {
    const kaynak = yorumsuz(fs.readFileSync(path.join(REPO, 'server', 'middleware', 'eligibilityRateLimit.js'), 'utf8'))
    const m = kaynak.match(/const\s*\{([^}]*)\}\s*=\s*require\(\s*['"]\.\/bundlerRateLimit['"]\s*\)/)
    expect(m, 'bundlerRateLimit require satiri yok').toBeTruthy()
    expect(m[1].split(',').map((s) => s.trim()).filter(Boolean)).toEqual(['ipSubnetKey'])
  })
})

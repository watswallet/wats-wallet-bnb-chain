// ILK ALIM KAPISI -- KAYNAK KILITLERI 16-21 (Task 47 + Task 48; spec 6.5, 11.5, 11.7, Ek D.1, PE22). Alti kilidin HEPSI burada.
// KOK NEDEN / KAPATILAN HATA: beyan arayuzu K32 ile kalkti. Park edilen kod (StockGate / CountryPicker / StockDeclarations /
// openGate / screenData), dokuz olu kapi nedeni, ALREADY_BLOCKED esmesi ve beyan sozlugu bayraklar ve testlerle SESSIZCE eskir:
// bir sonraki duzenleme "hala orada" diye eski adi yeniden kullanir ya da bir yorum "beyan edilen ulke" diye olmayan bir
// davranisi anlatir. Bu dosya silmenin TAMAM kaldigini kaynaktan kilitler.
//
// Grup 18 (olu kod taramasi, PE22) iki katmanlidir:
//   (A) ayirt edici adlar TUM uretim kaynaginda (client/src ve server; yorumlar DAHIL, sozcuk sinirli);
//   (B) genis sozcukler (beyan, declar, accountId, accountChanged) YALNIZ kapi kapsami dosya kumesinde: cuzdanin ilgisiz
//       "beyan" / "declared" kullanimlari (Dapp.vue, Token.vue, addressPoisoning.js, chainIdentity.js, eip712/risk.js ...)
//       ve Solana'nin accountChanged olayi bu kumeye girmez. Izin listesi BOSTUR.
// Pozitif bekciler: (A) >= 300 dosya ve background.js ile decide.js taranir; (B) kumenin her dosyasi diskte var ve bos degil.
// Taramayi yesil yapmak icin kapsami DARALTMAK yasaktir; gerekirse dosya yolu + gerekceyle ACIK izin yazilir.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz, importsuz, blokGovdesi, cagriGovdesi, diziGovdesi, eslesenKapanis } from '../../test-utils/kaynakTarama'
import { INTERNAL_ACTIONS } from '../messageGate'
import { createStockEligibilityStore } from '../../composables/useStockEligibility'

const BU_DIZIN = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(BU_DIZIN, '../..') // client/src
const REPO = path.resolve(SRC, '../..') // depo koku
const SERVER = path.join(REPO, 'server')

const testDosyasi = (ad) => /\.(test|spec)\.[cm]?js$/.test(ad)

// Uretim kaynagi: *.test.js, test-utils/, node_modules ve (yalniz sunucuda) server/test/ HARIC.
function yururle(dizin, atlanacakDizinler) {
  const cikti = []
  for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
    const yol = path.join(dizin, girdi.name)
    if (girdi.isDirectory()) {
      if (atlanacakDizinler.includes(girdi.name)) continue
      cikti.push(...yururle(yol, atlanacakDizinler))
    } else if (/\.(js|vue)$/.test(girdi.name) && !testDosyasi(girdi.name)) {
      cikti.push(yol)
    }
  }
  return cikti
}

const goreliDepo = (yol) => path.relative(REPO, yol).split(path.sep).join('/')
const URETIM = [
  ...yururle(SRC, ['node_modules', 'test-utils']),
  ...yururle(SERVER, ['node_modules', 'test']),
].map((yol) => ({ rel: goreliDepo(yol), ham: fs.readFileSync(yol, 'utf8') }))

describe('silinen dosyalar (Task 38 + 41 + 47: 14 yol)', () => {
  const SILINEN = [
    // Task 38
    'client/src/utils/stockGate/declarations.js',
    'client/src/utils/stockGate/declarations.test.js',
    // Task 41
    'client/src/components/Settings.stockDeclarations.ssr.test.js',
    // Task 47: uretim
    'client/src/utils/stockGate/openGate.js',
    'client/src/utils/stockGate/screenData.js',
    'client/src/components/stocks/StockGate.vue',
    'client/src/components/stocks/CountryPicker.vue',
    'client/src/components/settings/StockDeclarations.vue',
    // Task 47: test / fikstur
    'client/src/utils/stockGate/openGate.test.js',
    'client/src/utils/stockGate/screenData.test.js',
    'client/src/components/stocks/StockGate.ssr.test.js',
    'client/src/components/stocks/CountryPicker.ssr.test.js',
    'client/src/components/settings/StockDeclarations.ssr.test.js',
    'client/src/test-utils/openGateFixture.js',
  ]

  it('pozitif bekci: kontrol listesi bos degil, 14 tekrarsiz yol', () => {
    expect(SILINEN).toHaveLength(14)
    expect(new Set(SILINEN).size).toBe(14)
    // kontrol, var olan bir dosyayi "yok" saymaz: bu test dosyasi diskte
    expect(fs.existsSync(path.join(REPO, 'client/src/utils/stockGate/stockEligibilityLocks.test.js'))).toBe(true)
  })

  it.each(SILINEN)('silinen dosyalar: %s existsSync false', (yol) => {
    expect(fs.existsSync(path.join(REPO, yol)), yol).toBe(false)
  })

  it('hicbir test silinen openGateFixture fiksturunu ice aktarmaz', () => {
    const testler = []
    const yuru = (dizin) => {
      for (const g of fs.readdirSync(dizin, { withFileTypes: true })) {
        const yol = path.join(dizin, g.name)
        if (g.isDirectory()) {
          if (g.name !== 'node_modules') yuru(yol)
        } else if (testDosyasi(g.name)) testler.push(yol)
      }
    }
    yuru(SRC)
    yuru(SERVER)
    expect(testler.length).toBeGreaterThan(300) // pozitif bekci: test dosyalari gercekten taraniyor
    const ihlal = testler
      .filter((yol) => !yol.endsWith('stockEligibilityLocks.test.js') && /openGateFixture/.test(fs.readFileSync(yol, 'utf8')))
      .map(goreliDepo)
    expect(ihlal).toEqual([])
  })
})

describe('18. olu kod taramasi (PE22)', () => {
  // (A) ayirt edici adlar: tum uretim kaynaginda, yorumlar dahil, sozcuk sinirli (\b)
  const AYIRT_EDICI = [
    'declarations', 'stock_declarations', 'STOCK_GATE_DECLARE', 'STOCK_GATE_LIST', 'STOCK_GATE_RESET', 'usPerson', 'textVersion',
    'TEXT_UPDATE_REQUIRED', 'ACCOUNT_UNKNOWN', 'ACCOUNT_MISMATCH', 'ALREADY_BLOCKED', 'US_PERSON', 'COUNTRY_MISMATCH',
    'DECLARATION_REQUIRED', 'DECLARED_COUNTRY_ISSUER', 'DECLARED_COUNTRY_PRECAUTION', 'UPDATE_DECLARATION', 'UPDATE_EXTENSION',
    'openGate', 'CountryPicker', 'screenData', 'StockDeclarations', 'settings_stock_declarations', 'peekRules', 'peekIpCountry',
    'gateActionCta', 'leavingForGate', 'GATE_ACTIONS', 'gateActionOf', 'stock_gate',
  ]
  const AYIRT_EDICI_RE = new RegExp(`\\b(?:${AYIRT_EDICI.join('|')})\\b`, 'g')

  // (B) genis sozcukler: yalniz kapi kapsami dosya kumesinde
  const GENIS_RE = /beyan|declar|\baccountId\b|\baccountChanged\b/i
  const HESAP_RE = /\baccountId\b|\baccountChanged\b/i // background.js: zincir kimligiyle ilgili ilgisiz "beyan" satirlari var

  const dosyalarIn = (dizin, ek) => fs.readdirSync(path.join(SRC, dizin)).filter((ad) => ad.endsWith(ek) && !testDosyasi(ad)).sort().map((ad) => `client/src/${dizin}/${ad}`)
  const KAPI_KAPSAMI = [
    ...dosyalarIn('utils/stockGate', '.js'),
    'client/src/composables/useStockGate.js',
    'client/src/composables/useStockEligibility.js',
    'client/src/utils/stockTrade.js',
    'client/src/utils/swapGuard.js',
    'client/src/utils/messageGate.js',
    'client/src/utils/stocks/engines/pancakeEngine.js',
    'client/src/utils/cow/service.js',
    'client/src/utils/cow/approve.js',
    'client/src/data/eligibilityRules.js',
    'client/src/data/countryCodes.js',
    ...dosyalarIn('components/stocks', '.vue'),
    'client/src/components/Swap.vue',
    'client/src/components/Bridge.vue',
    'client/src/components/Settings.vue',
    'client/src/components/settings/About.vue',
    'client/src/popup/App.vue',
    'server/data/eligibility.js',
    'server/utils/geoCountry.js',
    'server/utils/validateEligibility.js',
    'server/controllers/eligibilityController.js',
  ]
  const BACKGROUND = 'client/src/background.js'
  // Izin listesi BOS: gerekirse { dosya, gerekce } ile ACIK yazilir.
  const IZIN = []

  const satirlar = (ham, re) => ham.split(/\r?\n/).map((s, i) => [i + 1, s]).filter(([, s]) => re.test(s))
  const goster = (rel, ham, re) => satirlar(ham, re).map(([n, s]) => `${rel}:${n}: ${s.trim().slice(0, 110)}`)

  it('tarama kalibi: desenler gercek adlari yakalar, kardes depo anahtarlarini ve ilgisiz adlari yakalamaz (vakumda gecmesin)', () => {
    for (const ad of AYIRT_EDICI) {
      AYIRT_EDICI_RE.lastIndex = 0
      expect(AYIRT_EDICI_RE.test(`// eski ${ad} izi`), ad).toBe(true)
    }
    for (const temiz of ['stock_gate_cache', 'stock_gate_rules_cache', 'COW_ERROR.ACCOUNT_CHANGED', 'openGateFixture', 'STOCK_GATE:IP_COUNTRY_ISSUER', 'stockGate.lock.KILL_SWITCH']) {
      AYIRT_EDICI_RE.lastIndex = 0
      expect(AYIRT_EDICI_RE.test(temiz), temiz).toBe(false)
    }
    for (const yakalanan of ['beyan', 'Beyan ekrani', 'declared', 'DECLARE', 'accountId', 'this.accountChanged']) expect(GENIS_RE.test(yakalanan), yakalanan).toBe(true)
    for (const temiz of ['COW_ERROR.ACCOUNT_CHANGED', 'account', 'accountIdx']) expect(GENIS_RE.test(temiz), temiz).toBe(false)
  })

  it('(A) ayirt edici olu adlar TUM uretim kaynaginda yok (yorumlar dahil)', () => {
    // pozitif bekci: yeterince genis tarama, kritik dosyalar kapsamda
    expect(URETIM.length).toBeGreaterThanOrEqual(300)
    const adlar = URETIM.map((d) => d.rel)
    for (const rel of ['client/src/background.js', 'client/src/utils/stockGate/decide.js', 'client/src/popup/App.vue', 'server/app.js']) {
      expect(adlar, rel).toContain(rel)
    }
    expect(adlar.some((rel) => testDosyasi(rel) || rel.includes('/test-utils/') || rel.startsWith('server/test/') || rel.includes('node_modules'))).toBe(false)
    const ihlal = URETIM.flatMap((d) => goster(d.rel, d.ham, new RegExp(AYIRT_EDICI_RE.source)))
    expect(ihlal).toEqual([])
  })

  it('(B) beyan / declar / accountId / accountChanged kapi kapsami dosya kumesinde yok (izin listesi BOS)', () => {
    expect(IZIN).toEqual([])
    // pozitif bekci: kumenin her dosyasi diskte var ve bos degil
    expect(KAPI_KAPSAMI.length).toBeGreaterThanOrEqual(35) // olculen: 38
    expect(KAPI_KAPSAMI).toContain('client/src/utils/stockGate/errors.js')
    expect(KAPI_KAPSAMI).toContain('client/src/components/stocks/StockGateBand.vue')
    const bos = KAPI_KAPSAMI.filter((rel) => !fs.existsSync(path.join(REPO, rel)) || fs.readFileSync(path.join(REPO, rel), 'utf8').trim() === '')
    expect(bos).toEqual([])
    const ihlal = KAPI_KAPSAMI.flatMap((rel) => goster(rel, fs.readFileSync(path.join(REPO, rel), 'utf8'), GENIS_RE))
    expect(ihlal).toEqual([])
  })

  it('(B) background.js: yalniz accountId / accountChanged taranir (zincir kimligiyle ilgili "beyan" satirlari kapsam disi)', () => {
    const ham = fs.readFileSync(path.join(REPO, BACKGROUND), 'utf8')
    expect(ham.length).toBeGreaterThan(1000) // pozitif bekci: dosya okundu
    expect(goster(BACKGROUND, ham, HESAP_RE)).toEqual([])
  })
})

// =====================================================================================================================
// Task 48: kilitler 16, 17, 19, 20, 21 (spec 11.5, 11.7). Kaynak taramasi `kaynakTarama.js` yardimcilariyla (yorumsuz /
// blokGovdesi / cagriGovdesi: CRLF'e ve yorumlara guvenilmez). Her kilit pozitif bekcilidir: taranan dosya kumesi bos degil
// ve aranan seyin GERCEKTEN bulundugu bir ornek gosterilir (aksi halde bos tarama vakumda gecerdi). Mutasyon turu: M1-M27.
// =====================================================================================================================
const srcHam = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')
const srcKod = (rel) => yorumsuz(srcHam(rel))
const BG = 'background.js'
const izSatirlari = (rel, ham, re) =>
  ham.split(/\r?\n/).map((s, i) => [i + 1, s]).filter(([, s]) => re.test(s)).map(([n, s]) => `${rel}:${n}: ${s.trim().slice(0, 110)}`)

describe('16. hesapsiz kapi (K39; spec 11.5 madde 22, G22-G24)', () => {
  const stockGateJs = fs.readdirSync(path.join(SRC, 'utils/stockGate')).filter((ad) => ad.endsWith('.js') && !testDosyasi(ad)).sort().map((ad) => `utils/stockGate/${ad}`)
  const CEKIRDEK = [...stockGateJs, 'data/eligibilityRules.js', 'composables/useStockEligibility.js', 'composables/useStockGate.js']
  const HESAP_IZI = /\b(?:active_account|stock_declarations|getActiveAccount|accountId)\b|\bg\.account\b/

  it('tarama kalibi: desen gercek adlari yakalar, benzer ama ilgisiz adlari yakalamaz (vakumda gecmesin)', () => {
    for (const ad of ['active_account', 'stock_declarations', 'getActiveAccount', 'g.account', 'accountId']) expect(HESAP_IZI.test(`x ${ad} y`), ad).toBe(true)
    for (const temiz of ['accountIdx', 'COW_ERROR.ACCOUNT_CHANGED', 'stock_gate_rules_cache', 'background.account', 'getActiveAccountX']) expect(HESAP_IZI.test(temiz), temiz).toBe(false)
  })

  it('kapi cekirdegi (utils/stockGate/*, eligibilityRules, useStockEligibility, useStockGate): hesap izi yok (yorumlar dahil)', () => {
    expect(CEKIRDEK.length).toBeGreaterThanOrEqual(10) // olculen: 11
    expect(CEKIRDEK).toContain('utils/stockGate/decide.js')
    expect(CEKIRDEK).toContain('utils/stockGate/gate.js')
    const bos = CEKIRDEK.filter((rel) => !fs.existsSync(path.join(SRC, rel)) || srcHam(rel).trim() === '')
    expect(bos).toEqual([])
    expect(CEKIRDEK.flatMap((rel) => izSatirlari(rel, srcHam(rel), HESAP_IZI))).toEqual([])
  })

  it('background.js: message.message.account atamasi yok (hesap mesaja yazilmaz; yetkili hesap arka planda cozulur)', () => {
    const kod = srcKod(BG)
    expect(kod, 'pozitif bekci: background.js okundu ve message.message kullaniyor').toMatch(/\bmessage\??\.message\??\.\w+/)
    expect(kod).not.toMatch(/\bmessage\??\.message\??\.account\s*=(?!=)/)
    expect(/\bmessage\??\.message\??\.account\s*=(?!=)/.test('message.message.account = g.account'), 'kalip gercek atamayi yakalar').toBe(true)
  })

  it('cowStockGate yalniz { chainId, stockAddress } alir; owner / decided / accountChanged yok', () => {
    const imza = srcKod(BG).match(/async function cowStockGate\(([^)]*)\)/)
    expect(imza, 'cowStockGate imzasi bulunamadi').toBeTruthy()
    expect(imza[1].replace(/[{}\s]/g, '').split(',').filter(Boolean)).toEqual(['chainId', 'stockAddress'])
    const govde = blokGovdesi(srcHam(BG), /async function cowStockGate\([^)]*\)\s*/)
    expect(govde, 'cowStockGate govdesi bulunamadi').toBeTruthy()
    expect(govde.length).toBeGreaterThan(100)
    expect(govde).not.toMatch(/\bowner\b|\bdecided\b|\baccountChanged\b|ACCOUNT_CHANGED/)
  })

  it('COW_ERROR.ACCOUNT_CHANGED dort bagimsiz denetimde KALIR: checkQuote, service imza, approve imza, cowFeeApproveChange', () => {
    const sayim = (rel) => (srcKod(rel).match(/COW_ERROR\.ACCOUNT_CHANGED/g) ?? []).length
    const checkQuote = blokGovdesi(srcHam('utils/cow/quoteStore.js'), /export function checkQuote\([^)]*\)\s*/)
    expect(checkQuote, 'checkQuote govdesi bulunamadi').toBeTruthy()
    expect(checkQuote).toContain('COW_ERROR.ACCOUNT_CHANGED')
    expect(srcKod('utils/cow/service.js')).toMatch(/!sameAddr\(signer\?\.address,\s*owner\)\)\s*return fail\(COW_ERROR\.ACCOUNT_CHANGED\)/)
    expect(srcKod('utils/cow/approve.js')).toMatch(/!sameAddr\(signer\?\.address,\s*p\.owner\)\)\s*return fail\(COW_ERROR\.ACCOUNT_CHANGED\)/)
    const ucret = blokGovdesi(srcHam(BG), /function cowFeeApproveChange\(message, sender, sendResponse\)\s*/)
    expect(ucret, 'cowFeeApproveChange govdesi bulunamadi').toBeTruthy()
    expect(ucret).toContain('COW_ERROR.ACCOUNT_CHANGED')
    // her denetim dosyasinda TAM bir kullanim: kapi bu karari ustlenmez, dortu de birbirinden bagimsiz kalir
    for (const rel of ['utils/cow/quoteStore.js', 'utils/cow/service.js', 'utils/cow/approve.js', BG]) expect(sayim(rel), rel).toBe(1)
  })

  it("StockOrderConfirm CLOSING_CODES 'ACCOUNT_CHANGED' icerir (hesap degisince onay katmani kapanir)", () => {
    const dizi = diziGovdesi(srcHam('components/stocks/StockOrderConfirm.vue'), /const CLOSING_CODES = new Set\(/)
    expect(dizi, 'CLOSING_CODES bulunamadi').toBeTruthy()
    expect(dizi).toContain("'ACCOUNT_CHANGED'")
  })
})

describe('17. bir ic aksiyon (spec 11.5 madde 4, 19; K32)', () => {
  it('INTERNAL_ACTIONS icinde STOCK_GATE iceren TEK ad STOCK_GATE_STATUS (STOCK_GATE_ onekli de tek)', () => {
    const adlar = [...INTERNAL_ACTIONS]
    expect(adlar.length, 'pozitif bekci').toBeGreaterThan(20)
    expect(adlar.filter((a) => a.includes('STOCK_GATE')).sort()).toEqual(['STOCK_GATE_STATUS'])
    expect(adlar.filter((a) => a.startsWith('STOCK_GATE_')).sort()).toEqual(['STOCK_GATE_STATUS'])
  })

  it('background.js switch inde STOCK_GATE_ onekli TEK case: STOCK_GATE_STATUS', () => {
    const kod = srcKod(BG)
    const cases = [...kod.matchAll(/case\s+["']([A-Z_]*STOCK_GATE[A-Z_]*)["']\s*:/g)].map((m) => m[1])
    expect(cases).toEqual(['STOCK_GATE_STATUS'])
    expect([...kod.matchAll(/case\s+["']STOCK_GATE_/g)]).toHaveLength(1)
  })

  it('COW_ onekli case sayisi sekiz (background.js) ve INTERNAL_ACTIONS ta COW_ onekli sekiz ad', () => {
    expect([...srcKod(BG).matchAll(/case\s+["']COW_/g)]).toHaveLength(8)
    expect([...INTERNAL_ACTIONS].filter((a) => a.startsWith('COW_'))).toHaveLength(8)
  })

  it('messageGate.test.js DANGEROUS listesi STOCK_GATE_STATUS adini kapsar (sayfa kokenli reddin davranis testi)', () => {
    const dangerous = diziGovdesi(srcHam('utils/messageGate.test.js'), /const DANGEROUS = /)
    expect(dangerous, 'DANGEROUS dizisi bulunamadi').toBeTruthy()
    expect(dangerous).toContain("'STOCK_GATE_STATUS'")
  })
})

describe('19. K34 tek kaynak ve K35 cikmaz yok (spec 11.5 madde 27, 29)', () => {
  // Uygunluk yuzeyleri: ortak kaynaktan (useStockEligibility / offerable.js) sorar. Her dosya kendi ortak sembollerini
  // KULLANIR (import satiri degil, kullanim: importsuz + yorumsuz). `issuer === 'bstocks'` taramasi KULLANILMAZ: bu
  // dosyalarda MESRU karsilastirmalar var (referans fiyat, rozet), tarama bastan kirmizi ya da vakum olurdu.
  const TUKETICILER = {
    'components/Home.vue': ['useStockEligibility', 'offerableRows'],
    'components/stocks/StockDetail.vue': ['useStockEligibility', 'canOfferBuy'],
    'components/stocks/StockTrade.vue': ['useStockEligibility', 'buyRowFor', 'canOfferBuy'],
    'composables/useIssuerSwitch.js': ['isAvailable'],
    'components/swap/swapTo.vue': ['useStockEligibility', 'unavailableOutput'],
    'components/bridge/bridgeTo.vue': ['useStockEligibility', 'unavailableOutput'],
    'components/Swap.vue': ['useStockEligibility', 'unavailableOutput'],
  }
  const ORTAK = /\b(?:useStockEligibility|offerableRows|canOfferBuy|unavailableOutput|buyRowFor|isAvailable)\b/
  const sembolRe = (s) => new RegExp(`\\b${s}\\b`)
  const saltKodu = (rel) => importsuz(yorumsuz(srcHam(rel)))

  it('pozitif bekci: yedi tuketici dosya diskte, bos degil', () => {
    expect(Object.keys(TUKETICILER)).toHaveLength(7)
    for (const rel of Object.keys(TUKETICILER)) expect(srcHam(rel).length, rel).toBeGreaterThan(1000)
  })

  it.each(Object.keys(TUKETICILER))('(a) %s: STOCK_GATE_STATUS / decideStockBuy / getStockGate yok, STOCK_GATE eylem adiyla sendMessage yok', (rel) => {
    const kod = srcKod(rel)
    expect(kod).not.toMatch(/\b(?:STOCK_GATE_STATUS|decideStockBuy|getStockGate)\b/)
    expect(kod).not.toMatch(/sendMessage\(\s*\{[^}]*\btype:\s*['"`]STOCK_GATE/)
  })

  it('(a) tarama kalibi: desenler gercek ikinci yolu yakalar, hata kodu kullanimini yakalamaz (vakumda gecmesin)', () => {
    expect(/\b(?:STOCK_GATE_STATUS|decideStockBuy|getStockGate)\b/.test("chrome.runtime.sendMessage({ type: 'STOCK_GATE_STATUS' })")).toBe(true)
    expect(/sendMessage\(\s*\{[^}]*\btype:\s*['"`]STOCK_GATE/.test("chrome.runtime.sendMessage({ type: 'STOCK_GATE_STATUS' })")).toBe(true)
    expect(/sendMessage\(\s*\{[^}]*\btype:\s*['"`]STOCK_GATE/.test("chrome.runtime.sendMessage({ type: 'SWAP', a: 'STOCK_GATE' })")).toBe(false)
  })

  it.each(Object.entries(TUKETICILER))('(b) %s ortak kaynaktan sembol KULLANIR: %j', (rel, semboller) => {
    const kod = saltKodu(rel)
    expect(kod, 'en az bir ortak sembol').toMatch(ORTAK)
    for (const s of semboller) expect(kod, `${rel}: ${s} kullanimi yok`).toMatch(sembolRe(s))
  })

  it.each(['utils/stocks/stockCompanies.js', 'utils/tokenizedStocks.js', 'utils/stocks/stockDetailModel.js'])('(c) %s katalog fonksiyonlari uygunluk modulunu ice aktarmaz', (rel) => {
    expect(srcKod(rel)).not.toMatch(/useStockEligibility|stockGate\/offerable|\bofferable\b/)
  })

  it('(c) pozitif bekci: katalog fonksiyonlari bu dosyalarda tanimli', () => {
    const TANIM = [
      ['companyRows', 'utils/stocks/stockCompanies.js'],
      ['issuerOptions', 'utils/stocks/stockCompanies.js'],
      ['mergeGroupRows', 'utils/stocks/stockCompanies.js'],
      ['stocksByChain', 'utils/tokenizedStocks.js'],
      ['sameChainOptions', 'utils/stocks/stockDetailModel.js'],
    ]
    for (const [ad, rel] of TANIM) expect(srcKod(rel), `${rel}: ${ad}`).toMatch(new RegExp(`export function ${ad}\\(`))
  })

  it('offerableRows tutulan satiri korur: isAvailable(row.issuer) || isHeld(row) (K35; yalniz sunum suzgeci)', () => {
    const govde = blokGovdesi(srcHam('utils/stockGate/offerable.js'), /export function offerableRows\([^)]*\)\s*/)
    expect(govde, 'offerableRows govdesi bulunamadi').toBeTruthy()
    expect(govde).toMatch(/isAvailable\(row\.issuer\)\s*\|\|\s*isHeld\(row\)/)
  })

  it('K35 StockTrade.vue stock computed govdesinde uygunluk YOK (Sat tutulan hisseyi her zaman acar)', () => {
    const govde = cagriGovdesi(srcHam('components/stocks/StockTrade.vue'), /const stock = computed\(/)
    expect(govde, 'stock computed govdesi bulunamadi').toBeTruthy()
    expect(govde, 'pozitif bekci: katalog okumasi').toContain('stockEntry(')
    expect(govde).not.toMatch(/eligib|issuerAvailable|isAvailable|offerable|canOfferBuy|buyRowFor|unavailableOutput|useStockEligibility/i)
  })

  it('K35 useIssuerSwitch: suzgec yalniz Al da (side() === buy); Sat ta ve sameRows / allOptions suzulmez', () => {
    const kaynak = srcHam('composables/useIssuerSwitch.js')
    const options = cagriGovdesi(kaynak, /const options = computed\(/)
    expect(options, 'options computed govdesi bulunamadi').toBeTruthy()
    expect(options).toMatch(/side\(\)\s*===\s*'buy'\s*\?\s*allOptions\.value\.filter\(\(o\) => eligible\(o\.issuer\)\)\s*:\s*allOptions\.value\s*\)\s*$/)
    expect(cagriGovdesi(kaynak, /const allOptions = computed\(/), 'allOptions govdesi').not.toMatch(/eligib/)
    expect(cagriGovdesi(kaynak, /const sameRows = computed\(/), 'sameRows govdesi').not.toMatch(/eligib/)
  })

  it('K35 Home.vue Varliklar tohumu tam katalogdan: seedOwnedStocks(ownedRows(stockGroups ...), listedGroups ile degil', () => {
    const kod = srcKod('components/Home.vue')
    expect(kod).toMatch(/seedOwnedStocks\(\s*ownedRows\(\s*stockGroups\b/)
    expect(kod).not.toMatch(/ownedRows\(\s*listedGroups\b/)
  })

  it('K35 SearchTokens / ImportToken / SelectAssets / swapFrom uygunluk modulunu ice aktarmaz (Sat ve elle ekleme kapidan etkilenmez)', () => {
    const DOSYALAR = ['components/SearchTokens.vue', 'components/ImportToken.vue', 'components/SelectAssets.vue', 'components/swap/swapFrom.vue']
    for (const rel of DOSYALAR) {
      expect(srcHam(rel).length, `pozitif bekci: ${rel}`).toBeGreaterThan(1000)
      expect(srcKod(rel), rel).not.toMatch(/useStockEligibility|stockGate\/offerable|\bofferable\b|\bofferableRows\b|\bunavailableOutput\b/)
    }
  })
})

describe('20. yukleme = gizli ve bos durum (spec 11.5 madde 28, 30; K34)', () => {
  const UES = 'composables/useStockEligibility.js'

  it('ilk durum yukleniyor ve karar yok: hicbir ihracci musait sayilamaz (davranis)', () => {
    const store = createStockEligibilityStore({ send: () => new Promise(() => {}), subscribe: () => () => {} })
    expect(store.snapshot()).toEqual({ status: 'loading', verdicts: null, fused: false })
    store.dispose()
  })

  it('kaynak: baslangic anlik goruntusu loading / verdicts null', () => {
    expect(srcKod(UES)).toMatch(/let snap = \{ status: 'loading', verdicts: null, fused: false \}/)
  })

  it("kaynak: verdictOf ready degilse null doner; isAvailable YALNIZ verdictOf'tan beslenir (baska true dali yok)", () => {
    const verdictOf = blokGovdesi(srcHam(UES), /const verdictOf = \(issuer\) =>\s*/)
    expect(verdictOf, 'verdictOf govdesi bulunamadi').toBeTruthy()
    expect(verdictOf).toMatch(/if\s*\(\s*s\.status\s*!==\s*'ready'[^\n]*\breturn null/)
    const kod = srcKod(UES)
    expect(kod).toMatch(/const isAvailable = \(issuer\) => available\(verdictOf\(issuer\)\)\s*\r?\n/)
    expect(kod).toMatch(/const available = \(v\) => Boolean\(v\) && /)
  })

  it('bos durum (Home.vue stockListEmpty) kaynakta ready, balancesLoaded ve listedGroups.length === 0 UCUNU birlikte icerir ve sablonda kullanilir', () => {
    const govde = cagriGovdesi(srcHam('components/Home.vue'), /const stockListEmpty = computed\(/)
    expect(govde, 'stockListEmpty govdesi bulunamadi').toBeTruthy()
    expect(govde).toMatch(/\beligibilityReady\.value\b/)
    expect(govde).toMatch(/\bbalancesLoaded\.value\b/)
    expect(govde).toMatch(/\blistedGroups\.value\.length\s*===\s*0\b/)
    expect(srcKod('components/Home.vue')).toMatch(/v-if="stockListEmpty"/)
  })
})

describe('21. depo ve App.vue (spec 11.5 madde 15, 16, 25; K20, K32)', () => {
  const testsiz = (dizin) => {
    const cikti = []
    const yuru = (d) => {
      for (const g of fs.readdirSync(d, { withFileTypes: true })) {
        const yol = path.join(d, g.name)
        if (g.isDirectory()) {
          if (g.name !== 'node_modules') yuru(yol)
        } else if (/\.(js|vue)$/.test(g.name) && !testDosyasi(g.name)) cikti.push(yol)
      }
    }
    yuru(path.join(SRC, dizin))
    return cikti.map((yol) => path.relative(SRC, yol).split(path.sep).join('/'))
  }
  const UI = [...testsiz('components'), ...testsiz('composables')]
  const DEPO_ANAHTARI = /(?<!\w)(?:stock_gate_rules_cache|stock_gate_cache)(?!\w)|\b(?:RULES_CACHE_KEY|SESSION_CACHE_KEY)\b/
  const YAZIM = /\bstorage\.(?:local|session|sync)\.(?:set|remove|clear)\(/

  it('components / composables: stock_gate_rules_cache / stock_gate_cache anahtarlari depoya yazim ya da silme cagrisiyla birlikte gecmez', () => {
    expect(UI.length).toBeGreaterThan(40) // pozitif bekci
    const anan = UI.filter((rel) => DEPO_ANAHTARI.test(srcKod(rel)))
    expect(anan, 'pozitif bekci: izleme anahtari ortak kaynakta duruyor').toContain('composables/useStockEligibility.js')
    expect(anan.filter((rel) => YAZIM.test(srcKod(rel)))).toEqual([])
    // yalniz chrome.storage.onChanged anahtar adi okumasi serbest: useStockEligibility.js disinda hicbir arayuz dosyasi anmaz
    expect(anan.filter((rel) => rel !== 'composables/useStockEligibility.js')).toEqual([])
  })

  it('useStockEligibility.js yalniz onChanged dinler: storage.* ve local / session set / remove / clear yok; useStockGate.js yazmaz', () => {
    const kod = srcKod('composables/useStockEligibility.js')
    expect(kod).toMatch(/stock_gate_rules_cache/)
    expect(kod).toMatch(/onChanged/)
    expect(kod).not.toMatch(/storage\.(local|session|sync)\b/)
    expect(kod).not.toMatch(/\b(local|session)\.(set|remove|clear)\(/)
    expect(srcKod('composables/useStockGate.js')).not.toMatch(YAZIM)
  })

  it('stockGate / components/stocks chrome.storage.*.clear( cagirmaz', () => {
    const taranan = [...testsiz('utils/stockGate'), ...testsiz('components/stocks')]
    expect(taranan.length).toBeGreaterThan(8)
    for (const rel of taranan) expect(srcKod(rel), rel).not.toMatch(/storage\.(local|session)\.clear\(/)
  })

  it('rulesClient.js: kalici (local) yazim ipCountry / fetchedAt / failedAt tasimaz; oturum (session) yazimi rules tasimaz (K20)', () => {
    const kod = srcKod('utils/stockGate/rulesClient.js')
    const cagrilar = [...kod.matchAll(/\.set\(/g)].map((m) => {
      const bas = m.index + m[0].length - 1
      return kod.slice(bas, eslesenKapanis(kod, bas) + 1)
    })
    const kalici = cagrilar.filter((a) => /RULES_CACHE_KEY/.test(a))
    const oturum = cagrilar.filter((a) => /SESSION_CACHE_KEY/.test(a))
    expect(kalici.length, 'pozitif bekci: kalici yazim bulunamadi').toBeGreaterThan(0)
    expect(oturum.length, 'pozitif bekci: oturum yazimi bulunamadi').toBeGreaterThan(0)
    expect(cagrilar.length, 'baska bir yazim yok').toBe(kalici.length + oturum.length)
    for (const a of kalici) expect(a).not.toMatch(/ipCountry|fetchedAt|failedAt/)
    for (const a of oturum) expect(a).not.toMatch(/\brules\b/)
    expect(kod).toMatch(/\blocal\(\)\s*\.set\(/)
    expect(kod).toMatch(/\bsession\(\)\s*\.set\(/)
  })

  it('popup/App.vue: XSTOCKS_ENABLED adi gecmez; stock_gate / settings_stock_declarations kaydi ve importu yok; bu iki sayfa adi App.vue ve Settings.vue kaynaginda HIC gecmez', () => {
    const app = srcHam('popup/App.vue')
    const ayarlar = srcHam('components/Settings.vue')
    expect(srcKod('popup/App.vue'), 'pozitif bekci: tarama gercek App.vue yu goruyor').toMatch(/<StockTrade\b[^>]*v-if="(?:!privacy\.active && )?page\.currentPage === 'stock_trade'"/)
    expect(ayarlar.length, 'pozitif bekci: Settings.vue okundu').toBeGreaterThan(1000)
    expect(app).not.toContain('XSTOCKS_ENABLED')
    const SAYFA = /(?<![A-Za-z_])(?:stock_gate|settings_stock_declarations)(?![A-Za-z_])/
    expect(izSatirlari('popup/App.vue', app, SAYFA)).toEqual([])
    expect(izSatirlari('components/Settings.vue', ayarlar, SAYFA)).toEqual([])
    expect(SAYFA.test("currentPage === 'stock_gate'"), 'kalip gercek sayfa adini yakalar').toBe(true)
    expect(SAYFA.test('stock_gate_rules_cache'), 'kalip kardes depo anahtarini yakalamaz').toBe(false)
    expect(app).not.toMatch(/components\/stocks\/StockGate\.vue|components\/settings\/StockDeclarations\.vue/)
  })
})

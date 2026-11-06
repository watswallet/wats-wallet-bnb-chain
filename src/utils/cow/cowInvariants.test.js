// CoW guvenlik degismezleri icin KAYNAK TARAMA KILITLERI (Faz 2 Task 26; spec §10.1, §8.5).
// Uretim kodu bu testle degismez; sonraki bir duzenlemenin degismezleri sessizce bozmasini engeller.
// Dosya listeleri diskten TURETILIR (yeni dosya eklenince kendiliginden taranir; elle liste yok).
// Tarama `yorumsuz()` ile yapilir: yorum / kullanilmayan satir bir iddiayi yesil tutamaz, CRLF'e guvenilmez.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz, blokGovdesi, cagriGovdesi, eslesenKapanis } from '../../test-utils/kaynakTarama'

const BU_DIZIN = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(BU_DIZIN, '../..')
const CLIENT = path.resolve(SRC, '..')

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
const oku = (yol) => yorumsuz(fs.readFileSync(yol, 'utf8'))
const ham = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

const TUM = yururle(SRC).map((yol) => ({ rel: goreli(yol), kod: oku(yol) }))
const COW = TUM.filter((d) => /^utils\/cow\/[^/]+\.js$/.test(d.rel))
const UI = TUM.filter((d) => /^components\/stocks\/[^/]+\.vue$/.test(d.rel) || /^composables\/useCow[^/]*\.js$/.test(d.rel))
const kodu = (rel) => {
  const d = TUM.find((x) => x.rel === rel)
  if (!d) throw new Error(`taranacak dosya yok: ${rel}`)
  return d.kod
}
const satirlar = (kod) => kod.split(/\r?\n/)

describe('tarama kapsami (sessizce bos kalmasin)', () => {
  it('beklenen cekirdek dosyalar listede', () => {
    const adlar = COW.map((d) => d.rel)
    for (const ad of ['config', 'order', 'service', 'approve', 'quoteStore', 'poller', 'pricing', 'permit', 'api']) {
      expect(adlar).toContain(`utils/cow/${ad}.js`)
    }
    const ui = UI.map((d) => d.rel)
    expect(ui).toContain('components/stocks/StockTrade.vue')
    expect(ui).toContain('components/stocks/StockOrderConfirm.vue')
    expect(ui).toContain('composables/useCowQuote.js')
    expect(TUM.some((d) => d.rel === 'background.js')).toBe(true)
    expect(TUM.some((d) => testDosyasi(d.rel))).toBe(false)
  })
})

describe('1. appCode yalniz order.js te tanimli (K4)', () => {
  it('sabit `appCode:` yazimi ve APP_CODE atamasi order.js disinda hicbir src dosyasinda yok', () => {
    const appCodeYazan = TUM.filter((d) => /\bappCode\s*:/.test(d.kod)).map((d) => d.rel)
    expect(appCodeYazan).toEqual(['utils/cow/order.js'])
    const atayan = TUM.filter((d) => /\bAPP_CODE\s*=/.test(d.kod)).map((d) => d.rel)
    expect(atayan).toEqual(['utils/cow/order.js'])
  })
})

describe('2. harcayici yalniz GPV2_VAULT_RELAYER sabiti (invariant 1)', () => {
  it('GPV2_VAULT_RELAYER tanimi yalniz config.js te', () => {
    const tanimlayan = TUM.filter((d) => /\bGPV2_VAULT_RELAYER\s*=/.test(d.kod)).map((d) => d.rel)
    expect(tanimlayan).toEqual(['utils/cow/config.js'])
  })

  it('approve cagri verisi cow kapsaminda yalniz approve.js te kurulur (permit.js hook u approve kurmaz)', () => {
    const kuran = COW.filter((d) => /\bapprove\s*\(|encodeFunctionData\(\s*['"]approve['"]/.test(d.kod)).map((d) => d.rel)
    expect(kuran).toEqual(['utils/cow/approve.js'])
  })

  it('UI dosyalarinda (components/stocks, composables/useCow*) GPV2_, MaxUint256 ve approve( yok', () => {
    expect(UI.length).toBeGreaterThan(3)
    for (const d of UI) {
      expect(d.kod, d.rel).not.toMatch(/GPV2_/)
      expect(d.kod, d.rel).not.toMatch(/MaxUint256/)
      expect(d.kod, d.rel).not.toMatch(/\bapprove\s*\(/)
    }
  })
})

describe('3. COW_PLACE_ORDER yalniz { quoteId } tasir (invariant 3)', () => {
  it('COW_PLACE_ORDER mesaji yalniz cowEngine.js te gonderilir (T15: StockOrderConfirm engine.place ile) ve govdesi tam { quoteId }', () => {
    const gonderen = TUM.filter((d) => /type\s*:\s*['"]COW_PLACE_ORDER['"]/.test(d.kod)).map((d) => d.rel)
    expect(gonderen).toEqual(['utils/stocks/engines/cowEngine.js'])
    expect(kodu('utils/stocks/engines/cowEngine.js')).toMatch(
      /type\s*:\s*['"]COW_PLACE_ORDER['"]\s*,\s*message\s*:\s*\{\s*quoteId\s*\}/,
    )
    // Onay katmani mesaji kendisi kurmaz: yalniz engine.place cagirir.
    expect(kodu('components/stocks/StockOrderConfirm.vue')).not.toContain('COW_PLACE_ORDER')
  })

  it('placeOrder / placeOrderInner govdelerinde istek alani (request. req. message.) yok', () => {
    const kod = kodu('utils/cow/service.js')
    for (const imza of [/async function placeOrderInner\(\{[^}]*\}\)\s*/, /async function placeOrder\(\{[^}]*\} = \{\}\)\s*/]) {
      const govde = blokGovdesi(fs.readFileSync(path.join(SRC, 'utils/cow/service.js'), 'utf8'), imza)
      expect(govde, String(imza)).toBeTruthy()
      expect(govde).not.toMatch(/(?<![.\w])(request|req|message)\./)
    }
    expect(kod).toMatch(/async function placeOrderInner/)
  })
})

describe('4. INTERNAL_ACTIONS ve background case i esit ve tam sekiz COW_ (invariant 4; Faz 3 ile 5 + 3 COW_FEE_)', () => {
  // messageGate.test.js iki yonlu testine EK: burada yalniz COW_ ailesinin sayisi ve esitligi kilitlenir.
  const COW_AILESI = [
    'COW_QUOTE', 'COW_PLACE_ORDER', 'COW_ORDERS_REFRESH', 'COW_APPROVE_QUOTE', 'COW_APPROVE_EXECUTE',
    'COW_FEE_STATUS', 'COW_FEE_PAY', 'COW_FEE_APPROVE_CHANGE',
  ]

  const kapidaki = () => {
    const govde = cagriGovdesi(ham('utils/messageGate.js'), /export const INTERNAL_ACTIONS = new Set\(/)
    expect(govde).toBeTruthy()
    return [...govde.matchAll(/['"](COW_[A-Z_]+)['"]/g)].map((m) => m[1])
  }
  const arkadaki = () => [...kodu('background.js').matchAll(/case\s+["'](COW_[A-Z_]+)["']\s*:/g)].map((m) => m[1])

  it('messageGate INTERNAL_ACTIONS icinde tam sekiz COW_ ad', () => {
    expect([...kapidaki()].sort()).toEqual([...COW_AILESI].sort())
  })

  it('background.js te tam sekiz case "COW_', () => {
    expect(kodu('background.js').match(/case "COW_/g)).toHaveLength(8)
    expect([...arkadaki()].sort()).toEqual([...COW_AILESI].sort())
  })

  it('iki liste esit', () => {
    expect([...kapidaki()].sort()).toEqual([...arkadaki()].sort())
  })
})

describe('5. tutar hesabinda Number yok, bolme BigInt (invariant 5)', () => {
  // Tutar dosyalarinda Number(/parseFloat/toFixed/Math.* yalniz asagidaki TEK SATIRLIK, adlandirilmis istisnalarla var.
  // Anahtar: dosya, deger: { satir (kirpilmis kod), neden }.
  const YASAK = /\bNumber\(|\bparseFloat\(|\bparseInt\(|\.toFixed\(|\bMath\.(round|floor|ceil|trunc)\(/
  const IZINLI = {
    'utils/cow/order.js': [
      ['const pf = sayiTipi ? Number(v) : NaN', 'protocolFeeBps sonlulugu (bps, tutar degil)'],
      ['const pfScaled = BigInt(Math.round(pf * 100000))', 'bps kesri 1e5 olcege BigInt e CEVRILIR; sonraki bolme BigInt'],
      ['const beklenen = DOMAIN_SEPARATORS[Number(chainId)]', 'anahtar: zincir kimligi'],
    ],
    'utils/cow/service.js': [
      ['const isFiniteNumberString = (v) => typeof v === \'string\' && v.trim() !== \'\' && Number.isFinite(Number(v))', 'sonluluk denetimi'],
      ['protocolFeeBps: Number(data.protocolFeeBps),', 'bps (tutar degil)'],
      ['const validTo = Math.floor(now() / 1000) + ORDER_VALIDITY_SEC', 'saniye cinsinden zaman damgasi'],
      ['if (!sameAddr(typedData.domain?.verifyingContract, sellToken) || Number(typedData.domain?.chainId) !== Number(chainId)) {', 'zincir kimligi karsilastirmasi'],
    ],
    'utils/cow/approve.js': [['const liste = APPROVE_RESET_TOKENS[Number(chainId)]', 'anahtar: zincir kimligi']],
    'utils/cow/quoteStore.js': [['const limit = Math.max(Number(r?.expiresAt) || 0, Number(r?.approveUntil) || 0)', 'zaman damgalari (GC)']],
    // Gorunum ve referans fiyat: kullaniciya gosterilen yaklasik degerler, emre girmez.
    'utils/cow/pricing.js': [
      ['const micro = Math.round(reference * 1e6)', 'referans fiyat (mikro USD), emir tutari degil'],
      ['const usd = (amount, decimals) => Number(formatUnits(amount, decimals))', 'yalniz gorunum (ucret dokumu)'],
      // tradeGate: KARAR (feeWarning, lockReason) tam BigInt; asagidaki iki deger yalniz gorunum alanlari
      ['const networkFeeUsd = Number(formatUnits(feeNum, buy ? payDecimals : stockDecimals + 6))', 'gorunum: ag ucreti USD'],
      ['const networkFeePct = Number((networkFee * MICRO) / sellAmount) / 10000', 'gorunum: ucret yuzdesi'],
    ],
    'utils/stockTrade.js': [
      ['return `$${value.toFixed(2)}`', 'gorunum bicimlendirmesi'],
      ["const pct = typeof gapPct === 'number' && Number.isFinite(gapPct) ? Math.abs(gapPct).toFixed(1) : '-'", 'gorunum: referans farki yuzdesi'],
      ['return value.toFixed(digits)', 'gorunum: ag ucreti dolar / yuzde metni (Intl yedegi)'],
      ["? { key: 'stockTrade.quote.gap', pct: `${gapPct > 0 ? '+' : ''}${gapPct.toFixed(2)}%` }", 'gorunum: referans farki yuzdesi'],
    ],
  }

  for (const rel of Object.keys(IZINLI)) {
    it(`${rel}: yasak sayisal cagrilar yalniz adlandirilmis satirlarda`, () => {
      const izinli = new Set(IZINLI[rel].map(([satir]) => satir))
      const ihlal = satirlar(kodu(rel))
        .map((s) => s.trim())
        .filter((s) => YASAK.test(s) && !izinli.has(s))
      expect(ihlal).toEqual([])
    })
  }

  it('izin listesi bayatlamaz: her izinli satir dosyada gercekten var', () => {
    for (const [rel, liste] of Object.entries(IZINLI)) {
      const mevcut = new Set(satirlar(kodu(rel)).map((s) => s.trim()))
      for (const [satir] of liste) expect(mevcut.has(satir), `${rel}: ${satir}`).toBe(true)
    }
  })

  it('order.js computeAmounts govdesinde Number / parseFloat yok (BigInt bolme)', () => {
    const govde = blokGovdesi(ham('utils/cow/order.js'), /export function computeAmounts\(\{[^}]*\}\)\s*/)
    expect(govde).toBeTruthy()
    expect(govde).not.toMatch(/\bNumber\(|\bparseFloat\(/)
    expect(govde).toMatch(/BigInt/)
  })
})

describe('6. SDK yok, tek CoW istemcisi (K1)', () => {
  it('package.json (ve varsa kilit dosyasi) @cowprotocol icermez', () => {
    expect(fs.readFileSync(path.join(CLIENT, 'package.json'), 'utf8')).not.toContain('@cowprotocol')
    const kilit = path.join(CLIENT, 'package-lock.json')
    if (fs.existsSync(kilit)) expect(fs.readFileSync(kilit, 'utf8')).not.toContain('@cowprotocol')
  })

  it('api.cow.fi / barn.api.cow.fi yazimi cow/ disinda hicbir src dosyasinda yok; cow/ icinde yalniz config.js te', () => {
    const disarida = TUM.filter((d) => !d.rel.startsWith('utils/cow/') && /api\.cow\.fi/.test(d.kod)).map((d) => d.rel)
    expect(disarida).toEqual([])
    const iceride = COW.filter((d) => /api\.cow\.fi/.test(d.kod)).map((d) => d.rel)
    expect(iceride).toEqual(['utils/cow/config.js'])
  })
})

describe('7. ozel anahtar hijyeni (invariant 7)', () => {
  it('utils/cow ve components/stocks / composables/useCow* icinde privateKey yok', () => {
    for (const d of [...COW, ...UI]) expect(d.kod, d.rel).not.toMatch(/privateKey/)
  })

  it('background.js: privateKey yalniz getCowRuntime icindeki executeAtsTransfer cagrisinin argumanlarinda; COW isleyicilerinde yok', () => {
    const kaynak = ham('background.js')
    const kod = kodu('background.js')
    const govde = blokGovdesi(kaynak, /function getCowRuntime\(\)\s*/)
    expect(govde).toBeTruthy()
    const cagri = govde.indexOf('executeAtsTransfer(')
    expect(cagri).toBeGreaterThan(-1)
    const ac = cagri + 'executeAtsTransfer'.length
    const kapat = eslesenKapanis(govde, ac)
    expect(kapat).toBeGreaterThan(ac)
    const cagriDisi = govde.slice(0, ac) + govde.slice(kapat + 1)
    expect(govde).toMatch(/privateKey\s*:\s*signer\.privateKey/)
    expect(cagriDisi).not.toMatch(/privateKey/)
    // COW isleyicileri ve yardimcilari
    for (const ad of ['pollCowOrdersSafe', 'cowActiveAccount', 'cowLogError', 'runCow', 'runCowQueued', 'cowQuote', 'cowPlaceOrder', 'cowOrdersRefresh', 'cowApproveQuote', 'cowApproveExecute', 'cowFeeStatus', 'cowFeeSettle', 'cowFeePay', 'cowFeeApproveChange']) {
      const g = blokGovdesi(kaynak, new RegExp(`function ${ad}\\([^)]*\\)\\s*`))
      expect(g, ad).toBeTruthy()
      expect(g, ad).not.toMatch(/privateKey/)
    }
    expect(kod).toMatch(/const cowSignerFor = \(account\) => async \(\) =>/)
    expect(cagriGovdesi(kaynak, /const cowSignerFor = /)).not.toMatch(/privateKey/)
  })

  it('console. yalniz background.js cowLogError icindeki console.error(\'[cow]\', code); cow/UI/stockTrade/useCow* icinde hic yok', () => {
    for (const d of [...COW, ...UI, { rel: 'utils/stockTrade.js', kod: kodu('utils/stockTrade.js') }]) {
      expect(d.kod, d.rel).not.toMatch(/\bconsole\./)
    }
    const kaynak = ham('background.js')
    const log = blokGovdesi(kaynak, /function cowLogError\([^)]*\)\s*/)
    expect(log).toBeTruthy()
    expect(log.match(/\bconsole\./g)).toHaveLength(1)
    expect(log).toMatch(/console\.error\('\[cow\]', code\)/)
    for (const ad of ['pollCowOrdersSafe', 'cowActiveAccount', 'runCow', 'runCowQueued', 'cowQuote', 'cowPlaceOrder', 'cowOrdersRefresh', 'cowApproveQuote', 'cowApproveExecute']) {
      const g = blokGovdesi(kaynak, new RegExp(`function ${ad}\\([^)]*\\)\\s*`))
      expect(g, ad).toBeTruthy()
      expect(g, ad).not.toMatch(/\bconsole\./)
    }
    // log yalniz kisa kod yazar: gövde / imza / mesaj degiskeni cowLogError a girmez
    expect(log).not.toMatch(/signature|postBody|message|body/i)
  })
})

describe('8. bayrak kapisi yalniz background te ve isCowAction ile (K1, K10)', () => {
  it('cow/* icinde featureFlags / XSTOCKS_ENABLED yok; poller.js dahil', () => {
    expect(COW.some((d) => d.rel === 'utils/cow/poller.js')).toBe(true)
    for (const d of COW) {
      expect(d.kod, d.rel).not.toMatch(/featureFlags/)
      expect(d.kod, d.rel).not.toMatch(/XSTOCKS_ENABLED/)
    }
  })

  it('background.js bayrak kapisi `!XSTOCKS_ENABLED && isCowAction(...)` ile kurulur', () => {
    expect(kodu('background.js')).toMatch(/!\s*XSTOCKS_ENABLED\s*&&\s*isCowAction\(/)
  })
})

describe('9. swap / kopru xStock kapilari saglam (yalniz varlik; davranis testleri ayri dosyalarda)', () => {
  it('tokenizedStocks.js ve kapi testleri yerinde', () => {
    for (const rel of ['utils/tokenizedStocks.js', 'utils/swap.xstockGate.test.js', 'utils/bridgeXstocks.test.js']) {
      expect(fs.existsSync(path.join(SRC, rel)), rel).toBe(true)
    }
  })
})

describe('10. PARTNER_FEE_RECIPIENT kontrolu appData kurulmadan ONCE (invariant 9)', () => {
  it('quoteInner ve placeOrderInner: partnerRecipientCheck( ilk buildAppData( cagrisindan once', () => {
    const kaynak = ham('utils/cow/service.js')
    for (const imza of [/async function quoteInner\(\{[^}]*\}\)\s*/, /async function placeOrderInner\(\{[^}]*\}\)\s*/]) {
      const govde = blokGovdesi(kaynak, imza)
      expect(govde, String(imza)).toBeTruthy()
      const k = govde.indexOf('partnerRecipientCheck(')
      const a = govde.indexOf('buildAppData(')
      expect(k, `${imza} kontrol`).toBeGreaterThan(-1)
      expect(a, `${imza} appData`).toBeGreaterThan(-1)
      expect(k).toBeLessThan(a)
    }
  })
})

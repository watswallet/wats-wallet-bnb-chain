// Ilk alim kapisi -- CoW kaynak kilitleri (Task 31; spec 5.4-5.6, 5.9, 11.5 madde 2-5, 9, 21, 22; K14, K31).
//
// KOK NEDEN / KAPATILAN HATA: davranis testleri (Task 27-29) kapinin bugunku halini sinar; kapinin guvenligi ise SIRA ve
// YERLESIME dayanir ve bir duzenlemede sessizce kayabilir:
//   (1) kapi borc kilidinin ya da alici kontrolunun ARKASINA duserse engelli kullanici yanlis nedeni (borc, yapilandirma)
//       gorur; bayrak (VITE_XSTOCKS_ENABLED) acilinca kapisiz Al calisir;
//   (2) kapi Sat'a sokulursa eldeki hisse satilamaz (K4);
//   (3) peek kapisi claim'in arkasina duserse ret teklifi yakar; karar kayit disi bir girdiden (istek, mesaj) gelirse sahte
//       bir mesaj kapiyi atlatir;
//   (4) COW_FEE_* kapiya girerse odenmemis ucret odenemez; poller / orders / ucret modulleri kapiya baglanirsa imzali emrin
//       devami yetim kalir (K14);
//   (5) baglayici katalog disi adresi gecirir (K31). Karar hesaba bagli degildir (K39): imza / sahip esitligini kapi degil dort
//       bagimsiz denetim yapar (checkQuote, service, approve, cowFeeApproveChange); kapiya owner gitmez.
// Tarama `yorumsuz()` kaynakta yapilir (yorum bir iddiayi yesil tutamaz); her sira iddiasinda VARLIK once denetlenir
// (eksik dize -1 doner ve "-1 < N" sahte bir "once" olurdu); satir sonuna (CRLF) guvenilmez.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cagriGovdesi, eslesenKapanis, yorumsuz } from '../../test-utils/kaynakTarama'
import { INTERNAL_ACTIONS, isCowAction } from '../messageGate'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ham = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')
const kodu = (rel) => yorumsuz(ham(rel))

const SERVICE = 'utils/cow/service.js'
const APPROVE = 'utils/cow/approve.js'
const ERRORS = 'utils/stockGate/errors.js'
const BG = 'background.js'

const QUOTE_INNER = /async function quoteInner\(\{ request, owner \}\)\s*/
const PLACE_INNER = /async function placeOrderInner\(\{ quoteId, activeAddress, getSigner \}\)\s*/
const REFUSE_BUY = /async function refuseBuy\(rec\)\s*/
const PREPARE = /async function prepare\(\{ quoteId, activeAddress \}\)\s*/
const COW_RUNTIME = /function getCowRuntime\(\)\s*/
const COW_GATE = /async function cowStockGate\(\{ chainId, stockAddress \}\)\s*/

// Uretim kodundaki PINLI satirlar (Task 27-28): yorum satirlari bu testin ve mutasyonlarin capasidir.
const PIN_QUOTE_AL = "if (side === 'buy') { // ilk alim kapisi (K31): SAT asla sorulmaz"
const PIN_PLACE_PEEK = "if (peeked?.side === 'buy') { // ilk alim kapisi (K31): peek sonrasi, claim oncesi"
const PIN_PLACE_CLAIM = "if (record.side === 'buy' && !gated) { // ilk alim kapisi (K31): claim sonrasi yedek (peek yoktu); teklif yanar, guvenli"
const PIN_APPROVE_AL = "if (peek.record.side === 'buy') { // ilk alim kapisi (K31)"

// Parcalarin ILK gecisleri verilen sirada olmali; her parca govdede bulunmali.
function sirali(govde, parcalar, ad) {
  let onceki = -1
  for (const p of parcalar) {
    const i = govde.indexOf(p)
    expect(i, `${ad}: ${p} bulunamadi`).toBeGreaterThan(-1)
    expect(i, `${ad}: ${p} sira disi`).toBeGreaterThan(onceki)
    onceki = i
  }
}

// Yorumsuz kaynakta imzanin govdesi (ofsetlerle): yorumsuz() uzunlugu korudugu icin ofsetler ham kaynakla ayni sirayi verir.
function islev(rel, imza) {
  const kod = kodu(rel)
  const m = kod.match(imza)
  expect(m, `${rel}: ${imza} bulunamadi`).toBeTruthy()
  const acilis = kod.indexOf('{', m.index + m[0].length - 1)
  const kapanis = acilis < 0 ? -1 : eslesenKapanis(kod, acilis)
  expect(kapanis, `${rel}: ${imza} govdesi kapanmiyor`).toBeGreaterThan(acilis)
  return { bas: acilis, son: kapanis, govde: kod.slice(acilis + 1, kapanis) }
}

// Pinli satirdan baslayan `{` blogu. Satir YORUMLA bittigi icin pin HAM kaynakta aranir (TEK olmali), govde yorumsuz kaynaktan alinir.
function pinliBlok(rel, pin) {
  const raw = ham(rel)
  const i = raw.indexOf(pin)
  expect(i, `${rel}: pinli satir bulunamadi: ${pin}`).toBeGreaterThan(-1)
  expect(raw.indexOf(pin, i + 1), `${rel}: pinli satir TEK olmali: ${pin}`).toBe(-1)
  const kod = yorumsuz(raw)
  const acilis = kod.indexOf('{', i)
  const kapanis = acilis < 0 ? -1 : eslesenKapanis(kod, acilis)
  expect(kapanis, `${rel}: pinli blok kapanmiyor: ${pin}`).toBeGreaterThan(acilis)
  return { bas: acilis, son: kapanis, govde: kod.slice(acilis + 1, kapanis) }
}

// `ara` ile eslesen HER cagriyi koruyan en yakin `if (...)` kosulunun metni (anlamsal kilit: kosul Al a bagli mi).
function koruyanKosullar(govde, ara) {
  const kosullar = []
  for (const m of govde.matchAll(new RegExp(ara.source, 'g'))) {
    const ifBas = govde.lastIndexOf('if (', m.index)
    expect(ifBas, `${ara} oncesinde if yok`).toBeGreaterThan(-1)
    const ac = govde.indexOf('(', ifBas)
    const kapa = eslesenKapanis(govde, ac)
    expect(kapa, `${ara} oncesindeki if kosulu kapanmiyor`).toBeGreaterThan(ac)
    kosullar.push(govde.slice(ac, kapa + 1))
  }
  expect(kosullar.length, `${ara} cagrisi bulunamadi`).toBeGreaterThan(0)
  return kosullar
}

const ISTEK_ALANI = /(?<![.\w])(request|req|message)\./

describe('tarama kapsami (sessizce bos kalmasin)', () => {
  it('servis, onay, baglayici ve kapi govdeleri bulunur ve bos degil', () => {
    expect(islev(SERVICE, QUOTE_INNER).govde.length).toBeGreaterThan(1500)
    expect(islev(SERVICE, PLACE_INNER).govde.length).toBeGreaterThan(2500)
    expect(islev(SERVICE, REFUSE_BUY).govde.length).toBeGreaterThan(100)
    expect(islev(APPROVE, PREPARE).govde.length).toBeGreaterThan(300)
    expect(islev(BG, COW_RUNTIME).govde.length).toBeGreaterThan(1500)
    expect(islev(BG, COW_GATE).govde.length).toBeGreaterThan(200)
  })
})

describe('1. kapi enjekte edilir ve varsayilan Al i REDDEDER (fail-closed; K31, spec 5.4)', () => {
  it.each([
    [SERVICE, /export function createCowService\(\{[^}]*\bgate = denyBuyGate\b/],
    [APPROVE, /export function createCowApprove\(\{[^}]*\bgate = denyBuyGate\b/],
  ])('%s: imzada gate = denyBuyGate ve ../stockGate/errors tan import', (rel, imza) => {
    const kod = kodu(rel)
    expect(kod).toMatch(imza)
    expect(kod).toMatch(/import\s*\{[^}]*\bdenyBuyGate\b[^}]*\}\s*from\s*'\.\.\/stockGate\/errors'/)
  })

  it('errors.js: denyBuyGate Al i reddeder (ok: false)', () => {
    expect(kodu(ERRORS)).toMatch(/export const denyBuyGate\b[\s\S]{0,120}?ok:\s*false/)
  })

  it('kapi sonucu SIKI okunur: servis ve onay gateVerdict( ile sorar; gateVerdict yalniz ok === true gecirir ve firlatmaz', () => {
    expect(kodu(SERVICE)).toMatch(/gateVerdict\(\s*\(\)\s*=>\s*gate\(/)
    expect(islev(APPROVE, PREPARE).govde).toMatch(/gateVerdict\(\s*\(\)\s*=>\s*gate\(/)
    const g = islev(ERRORS, /export (?:async )?function gateVerdict\(ask\)\s*/).govde
    expect(g).toMatch(/\.ok === true/)
    expect(g).toMatch(/\btry\b/)
    expect(g).toMatch(/\bcatch\b/)
  })
})

describe('2. quoteInner: kapi yalniz Al da ve her kapidan ONCE (K31, K4, spec 11.5 madde 2, 21)', () => {
  it('sira: validate < kapi < alici kontrolu < borc kilidi < referans < ondalik < teklif < goruntu < ucret kapisi', () => {
    sirali(
      islev(SERVICE, QUOTE_INNER).govde,
      ['validateQuoteRequest(', 'askGate(', 'partnerRecipientCheck(', 'feeDebtLock(', 'reference.getReference(', 'chain.readDecimals(', 'api.quote(', 'buildDisplay(', 'feeGateNow('],
      'quoteInner',
    )
  })

  it('kapi cagrisi TEK ve pinli side === buy blogunun ICINDE; kosul anlamsal olarak da Al a bagli', () => {
    const q = islev(SERVICE, QUOTE_INNER)
    const blok = pinliBlok(SERVICE, PIN_QUOTE_AL)
    expect(blok.bas).toBeGreaterThan(q.bas)
    expect(blok.son).toBeLessThan(q.son)
    expect(blok.govde).toMatch(/\baskGate\(/)
    expect((q.govde.match(/\baskGate\(/g) ?? []).length).toBe(1)
    for (const kosul of koruyanKosullar(q.govde, /\baskGate\(/)) expect(kosul).toContain("'buy'")
  })

  it('ret kilit yanitidir (gateLockedReply tek argumanli); hesap dali yok (K39)', () => {
    const blok = pinliBlok(SERVICE, PIN_QUOTE_AL)
    expect(blok.govde).toMatch(/gateLockedReply\(verdict\.reason\)/)
    expect(blok.govde).not.toMatch(/accountChanged|ACCOUNT_CHANGED|\bowner\b/)
  })
})

describe('3. placeOrderInner: peek < kapi < claim < ikinci kapi < alici < tradeGate < borc < ucret kapisi < imzaci < kayit (PE3)', () => {
  it('sira: kimlik < peek < ilk kapi < claim; ikinci kapi claim den SONRA, alici kontrolunden ONCE; tam iki kapi cagrisi', () => {
    const g = islev(SERVICE, PLACE_INNER).govde
    sirali(g, ['validateQuoteId(', 'quoteStore.peekQuote(', 'refuseBuy(', 'quoteStore.claimQuote('], 'placeOrderInner')
    const ikinci = g.lastIndexOf('refuseBuy(')
    const alici = g.indexOf('partnerRecipientCheck(')
    expect(alici, 'partnerRecipientCheck(').toBeGreaterThan(-1)
    expect(ikinci, 'ikinci refuseBuy(').toBeGreaterThan(g.indexOf('quoteStore.claimQuote('))
    expect(ikinci, 'ikinci kapi alici kontrolunden once').toBeLessThan(alici)
    expect((g.match(/\brefuseBuy\(/g) ?? []).length).toBe(2)
  })

  it('claim sonrasi sira: alici < tradeGate < borc kilidi < ucret kapisi < imzaci < kayit', () => {
    const g = islev(SERVICE, PLACE_INNER).govde
    const alici = g.indexOf('partnerRecipientCheck(')
    expect(alici, 'partnerRecipientCheck(').toBeGreaterThan(-1)
    sirali(g.slice(alici), ['partnerRecipientCheck(', 'tradeGate(', 'feeDebtLock(', 'feeGateNow(', 'getSigner()', 'orders.saveOrder('], 'placeOrderInner (claim sonrasi)')
  })

  it('iki kapi cagrisi da pinli side === buy blogunda; claim sonrasi yedek peek ilk kapiyi gectiyse (gated) tekrar sormaz', () => {
    const p = islev(SERVICE, PLACE_INNER)
    const peek = pinliBlok(SERVICE, PIN_PLACE_PEEK)
    const claim = pinliBlok(SERVICE, PIN_PLACE_CLAIM)
    for (const blok of [peek, claim]) {
      expect(blok.bas).toBeGreaterThan(p.bas)
      expect(blok.son).toBeLessThan(p.son)
    }
    expect(peek.govde).toMatch(/\brefuseBuy\(peeked\)/)
    expect(claim.govde).toMatch(/\brefuseBuy\(record\)/)
    expect(peek.govde).toMatch(/\bgated = true\b/)
    const kosullar = koruyanKosullar(p.govde, /\brefuseBuy\(/)
    expect(kosullar).toHaveLength(2)
    for (const kosul of kosullar) expect(kosul).toContain("'buy'")
  })

  it('peek hatasi kapiyi ATLATMAZ ve Sat i kilitlemez: peekQuote cagrisi try / catch icinde, catch peeked = null', () => {
    const g = islev(SERVICE, PLACE_INNER).govde
    const peek = g.indexOf('quoteStore.peekQuote(')
    const tryBas = g.lastIndexOf('try {', peek)
    expect(tryBas, 'peekQuote try icinde').toBeGreaterThan(-1)
    expect(g.slice(tryBas, g.indexOf('claimQuote(')), 'catch peeked = null').toMatch(/catch\s*\{\s*peeked = null\s*\}/)
  })

  it('karar KAYITTAN gelir: govdede istek alani (request. req. message.) yok; refuseBuy argumani rec alanlarindan kurulur', () => {
    expect(islev(SERVICE, PLACE_INNER).govde).not.toMatch(ISTEK_ALANI)
    const r = islev(SERVICE, REFUSE_BUY).govde
    expect(r).not.toMatch(ISTEK_ALANI)
    expect(r).toMatch(/chainId:\s*rec\.chainId/)
    expect(r).toMatch(/stockAddress:\s*rec\.stockAddress/)
    expect(r).not.toMatch(/\bowner\b/)
    expect(r).toMatch(/gateRefusalReply\(verdict\.reason\)/)
    expect(r).not.toMatch(/accountChanged|ACCOUNT_CHANGED/)
  })
})

describe('4. approve.prepare: kapi kayittan ve yalniz Al da; quote / execute tek kapi noktasindan gecer (spec 5.5)', () => {
  it('sira: peekQuoteForApprove < gateVerdict < readAllowance (ag okumasi engelli kullaniciya gitmez)', () => {
    sirali(islev(APPROVE, PREPARE).govde, ['peekQuoteForApprove(', 'gateVerdict(', 'readAllowance('], 'prepare')
  })

  it('kapi pinli side === buy blogunda, TEK gateVerdict( cagrisi; kosul anlamsal olarak da Al a bagli', () => {
    const p = islev(APPROVE, PREPARE)
    const blok = pinliBlok(APPROVE, PIN_APPROVE_AL)
    expect(blok.bas).toBeGreaterThan(p.bas)
    expect(blok.son).toBeLessThan(p.son)
    expect(blok.govde).toMatch(/\bgateVerdict\(/)
    expect((kodu(APPROVE).match(/\bgateVerdict\(/g) ?? []).length).toBe(1)
    for (const kosul of koruyanKosullar(p.govde, /\bgateVerdict\(/)) expect(kosul).toContain("'buy'")
  })

  it('karar KAYITTAN gelir: chainId peek.record dan, stockAddress peek.record.stockAddress; owner kapiya gitmez; istek alani yok', () => {
    const g = islev(APPROVE, PREPARE).govde
    expect(g).not.toMatch(ISTEK_ALANI)
    expect(g).toMatch(/const \{[^}]*\bchainId\b[^}]*\bowner\b[^}]*\} = peek\.record/)
    const arg = cagriGovdesi(g, /\bgate(?=\()/)
    expect(arg, 'gate( argumani').toBeTruthy()
    expect(arg).toMatch(/\bchainId\b/)
    expect(arg).toMatch(/stockAddress:\s*peek\.record\.stockAddress/)
    expect(arg).not.toMatch(/\bowner\b/)
    expect(arg).not.toMatch(/quoteId|activeAddress|getSigner/)
    expect(g).toMatch(/gateRefusalReply\(verdict\.reason\)/)
    expect(g).not.toMatch(/accountChanged/)
  })

  it('quote ve execute ikisi de prepare( uzerinden gecer (kapi baska yerde sorulmaz)', () => {
    for (const ad of ['quote', 'execute']) {
      const g = islev(APPROVE, new RegExp(`async function ${ad}\\(\\{[^}]*\\} = \\{\\}\\)\\s*`)).govde
      expect(g, ad).toMatch(/\bprepare\(/)
      expect(g, ad).not.toMatch(/\bgate\(|\bgateVerdict\(/)
    }
  })
})

describe('5. baglayici: getCowRuntime ve cowStockGate (K31, spec 5.6, 11.5 madde 22)', () => {
  it('getCowRuntime: iki fabrika gate: cowStockGate alir; quoteStore SALT-OKUNUR peekQuote tasir', () => {
    const rt = islev(BG, COW_RUNTIME).govde
    for (const fabrika of ['createCowApprove', 'createCowService']) {
      const arg = cagriGovdesi(rt, new RegExp(`${fabrika}(?=\\()`))
      expect(arg, fabrika).toBeTruthy()
      expect(arg, fabrika).toMatch(/\bgate: cowStockGate\b/)
    }
    expect((rt.match(/\bgate: cowStockGate\b/g) ?? []).length).toBe(2)
    expect((rt.match(/\bpeekQuote:/g) ?? []).length).toBe(1)
    expect(rt).toMatch(/\bpeekQuote:\s*\(\{\s*quoteId\s*\}\)\s*=>\s*cowQuoteStore\.getQuote\(\s*quoteId\b/)
  })

  it('quoteStore.getQuote salt okunur (peek teklifi yakmaz): govdede set / remove / clear yok', () => {
    const g = islev('utils/cow/quoteStore.js', /export async function getQuote\(quoteId, \{ storage \} = \{\}\)\s*/).govde
    expect(g.length).toBeGreaterThan(50)
    expect(g).toMatch(/\.get\(/)
    expect(g).not.toMatch(/\.(set|remove|clear)\(/)
  })

  it('cowStockGate: hisse adresi ile evaluate, ok degilse ret, katalog disi (stock !== true) fail-closed; owner ve hesap karsilastirmasi yok (K39)', () => {
    const f = islev(BG, COW_GATE).govde
    sirali(f, ['getStockGate().evaluate(', '!g.ok', 'g.stock !== true', 'ok: true'], 'cowStockGate')
    expect(f).toMatch(/getStockGate\(\)\.evaluate\(\{\s*chainId,\s*outAddress:\s*stockAddress\s*\}\)/)
    expect(f).toContain("if (!g.ok) return { ok: false, reason: g.reason }")
    expect(f).toContain("if (g.stock !== true) return { ok: false, reason: 'CHECK_FAILED' }")
    expect(f).toMatch(/return \{ ok: true \}/)
    expect(f).not.toMatch(/\bowner\b|g\.account|toLowerCase|ACCOUNT_CHANGED|\baction\b/)
  })

  it('cowStockGate yalniz getCowRuntime da kullanilir: toplam uc gecis (tanim + iki enjeksiyon), dogrudan cagri yeri yok', () => {
    const kod = kodu(BG)
    expect((kod.match(/\bcowStockGate\b/g) ?? []).length).toBe(3)
    expect((kod.match(/\bcowStockGate\(/g) ?? []).length).toBe(1)
  })
})

describe('6. COW_FEE_* ve yoklama islevleri kapi DISINDA (K31, spec 0.4, 11.5 madde 21)', () => {
  const KAPI_DISI = [
    ['cowFeeStatus', /async function cowFeeStatus\(message, sender, sendResponse\)\s*/],
    ['cowFeeSettle', /async function cowFeeSettle\(account\)\s*/],
    ['cowFeePay', /function cowFeePay\(message, sender, sendResponse\)\s*/],
    ['cowFeeApproveChange', /function cowFeeApproveChange\(message, sender, sendResponse\)\s*/],
    ['settleCowFeesSafe', /function settleCowFeesSafe\(\)\s*/],
    ['claimRefundsSafe', /function claimRefundsSafe\(\)\s*/],
    ['pollCowOrdersSafe', /function pollCowOrdersSafe\(\)\s*/],
    ['runCow', /async function runCow\(sendResponse, isleyici\)\s*/],
    ['runCowQueued', /function runCowQueued\(sendResponse, isleyici\)\s*/],
  ]

  it.each(KAPI_DISI)('%s: govde bulunur ve kapiya dair hicbir iz yok', (_ad, imza) => {
    const g = islev(BG, imza).govde
    expect(g.length).toBeGreaterThan(40)
    expect(g).not.toMatch(/getStockGate|cowStockGate|stockOutputIssuer|gateVerdict|stockGate|STOCK_GATE/)
  })

  it('uc COW_FEE_ case i dagitici icinde var ve yukaridaki islevlere gider (pozitif bekci)', () => {
    const k = kodu(BG)
    expect(k).toMatch(/case "COW_FEE_STATUS":\s*cowFeeStatus\(/)
    expect(k).toMatch(/case "COW_FEE_PAY":\s*cowFeePay\(/)
    expect(k).toMatch(/case "COW_FEE_APPROVE_CHANGE":\s*cowFeeApproveChange\(/)
  })
})

// Bir dosyanin goreli import kapanisi (src altindaki .js / .vue dosyalari; ciplak paketler izlenmez).
const IMPORT_RE = /(?:import|export)\s[^'"`;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g
function cozumle(dosya, belirtec) {
  const taban = path.resolve(path.dirname(dosya), belirtec)
  for (const aday of [taban, `${taban}.js`, `${taban}.vue`, path.join(taban, 'index.js')]) {
    if (fs.existsSync(aday) && fs.statSync(aday).isFile()) return aday
  }
  return null
}
function kapanis(baslangicRel) {
  const goruldu = new Set()
  const yigin = [path.join(SRC, baslangicRel)]
  while (yigin.length) {
    const dosya = yigin.pop()
    if (goruldu.has(dosya)) continue
    goruldu.add(dosya)
    if (!/\.(js|vue)$/.test(dosya)) continue
    for (const m of yorumsuz(fs.readFileSync(dosya, 'utf8')).matchAll(IMPORT_RE)) {
      const hedef = cozumle(dosya, m[1] || m[2] || m[3])
      if (hedef) yigin.push(hedef)
    }
  }
  return [...goruldu].map((f) => path.relative(SRC, f).split(path.sep).join('/')).sort()
}

describe('7. K14: poller, orders ve ucret / iade modulleri kapiyi bilmez (imzali emrin yeniden gonderimi muaf, spec 5.9)', () => {
  const MUAF = ['poller', 'orders', 'fee', 'feeChain', 'feeNotice', 'feeResolve', 'feeRuntime', 'feeSettle', 'refundClaim'].map((a) => `utils/cow/${a}.js`)

  it.each(MUAF)('%s: kaynakta kapiya dair iz yok (stockGate, STOCK_GATE, kapi yardimcilari)', (rel) => {
    const kod = kodu(rel)
    expect(kod.length, `${rel} okundu`).toBeGreaterThan(200)
    expect(kod).not.toMatch(/stockGate|STOCK_GATE|\bgateVerdict\b|\baskGate\b|\brefuseBuy\b|\bdenyBuyGate\b|\bgateLockedReply\b|\bgateRefusalReply\b/)
  })

  it.each(MUAF)('%s: goreli import kapanisi kapi orkestratorunu ya da background.js i icermez (dolayli bag da yok)', (rel) => {
    const k = kapanis(rel)
    expect(k, 'yuruyus gercekten basladi').toContain(rel)
    expect(k.filter((f) => /^utils\/stockGate\/(?!errors\.js$)|^background\.js$/.test(f))).toEqual([])
  })

  it.each(['utils/cow/poller.js', 'utils/cow/orders.js'])('%s: kapanista utils/stockGate/errors.js de yok (imzali emrin devami kapi modulunden tamamen bagimsiz)', (rel) => {
    const k = kapanis(rel)
    expect(k.length, 'kapanis tek dosyadan fazla (yuruyus ithalatlari izledi)').toBeGreaterThan(1)
    expect(k.filter((f) => /^utils\/stockGate\//.test(f))).toEqual([])
  })
})

describe('8. cow/* kapi modulu sinirlari (spec 11.5 madde 9)', () => {
  const cowDosyalari = () => fs.readdirSync(path.join(SRC, 'utils/cow')).filter((a) => /\.js$/.test(a) && !/\.test\.js$/.test(a))

  it('utils/cow/*.js icinde stockGate import yolu yalniz ../stockGate/errors; servis ve onay onu GERCEKTEN alir', () => {
    const dosyalar = cowDosyalari()
    expect(dosyalar).toContain('service.js')
    expect(dosyalar).toContain('approve.js')
    const alan = []
    for (const ad of dosyalar) {
      const importlar = [...kodu(`utils/cow/${ad}`).matchAll(/from\s*['"]([^'"]*stockGate[^'"]*)['"]/g)].map((m) => m[1])
      for (const belirtec of importlar) expect(belirtec, ad).toBe('../stockGate/errors')
      if (importlar.length) alan.push(ad)
    }
    expect(alan.sort()).toEqual(['approve.js', 'service.js'])
  })
})

describe('9. aksiyon aileleri: COW_ tam sekiz, STOCK_GATE_ tek (STATUS) ve COW_ onekli degil (spec 11.5 madde 4, K32)', () => {
  const GATE_AKSIYONLARI = ['STOCK_GATE_STATUS']

  it('background.js: tam sekiz case "COW_ ve tam bir case "STOCK_GATE_; beyan aksiyonlarinin case i yok', () => {
    const k = kodu(BG)
    expect(k.match(/case "COW_/g)).toHaveLength(8)
    expect(k.match(/case "STOCK_GATE_/g)).toHaveLength(1)
    for (const ad of GATE_AKSIYONLARI) expect(k, ad).toContain(`case "${ad}":`)
    for (const ad of ['STOCK_GATE_DECLARE', 'STOCK_GATE_LIST', 'STOCK_GATE_RESET']) expect(k, ad).not.toContain(ad)
  })

  it('INTERNAL_ACTIONS: tek STOCK_GATE_ ad, uc COW_FEE_ ad, COW_ ile baslayan tam sekiz ad; hicbir COW_ ad STOCK_GATE icermez', () => {
    const adlar = [...INTERNAL_ACTIONS]
    expect(adlar.filter((a) => a.startsWith('STOCK_GATE_')).sort()).toEqual(GATE_AKSIYONLARI)
    for (const a of ['COW_FEE_PAY', 'COW_FEE_APPROVE_CHANGE', 'COW_FEE_STATUS']) expect(adlar, a).toContain(a)
    expect(adlar.filter((a) => a.startsWith('COW_'))).toHaveLength(8)
    expect(adlar.filter((a) => a.startsWith('COW_') && a.includes('STOCK_GATE'))).toEqual([])
  })

  it('isCowAction: STOCK_GATE_* xStocks bayrak kapisina GIRMEZ (bStocks kapisi bayraga bagli degildir, K9); COW_FEE_* girer', () => {
    for (const ad of GATE_AKSIYONLARI) expect(isCowAction(ad), ad).toBe(false)
    for (const ad of ['COW_QUOTE', 'COW_FEE_PAY']) expect(isCowAction(ad), ad).toBe(true)
  })
})

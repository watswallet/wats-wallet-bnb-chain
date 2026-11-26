// KOK NEDEN / KAPATILAN HATA
// Ilk alim kapisinin orkestratoru (gate.js) kurallari ve baglanti (IP) ulkesini TEK karara baglar ve her edinme
// isleyicisinin ilk satirinda cagrilir. Beyan kalkinca (K32) kapi hesaba da bagli degildir (K39). Kapatilan hata siniflari:
//  (1) hisse OLMAYAN cikti icin kapinin herhangi bir bagimliliga (kural istemcisi, depo, ag) dokunmasi: her
//      Takas/Kopru teklifine gecikme ve yeni hata yuzeyi eklerdi (G26);
//  (2) kapinin aktif hesabi ya da depodaki baska bir kaydi (active_account, stock_declarations) okumasi: karar
//      hesaba gore degisir, hesap degistirme yeni bir kapi acma/kapama yuzeyi olurdu (G22);
//  (3) ulke bilinmiyorken kapinin acilmasi ya da iki ihracci icin farkli sonuc vermesi (G21): tek anlik goruntu,
//      iki ihracci da COUNTRY_UNKNOWN;
//  (4) bagimlilik hatasinda kapinin acilmasi (G25): belirsizlik kapiyi ACMAZ (CHECK_FAILED);
//  (5) eski panelin koprude hedef token alani OLMADAN BSC'ye bStock aldirmasi (RF4, fail-closed);
//  (6) karar yanitinin birden fazla yerde elle kurulmasi (R12): bir alan eklenince/silinince yollar
//      birbirinden ayrilir; tek projeksiyon replyOf'tur ve TAM uc anahtar verir;
//  (7) decide'a saatin gecirilmemesi (R7): `now` eksikse karar RULES_INVALID olur ve kapi her seyi reddeder.
// Pozitif bekciler: her "dokunmadi" iddiasinin yaninda ayni bagimliliklarin hisse ciktisinda GERCEKTEN
// cagrildigini gosteren test var; yoksa casuslar vakumda gecerdi.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getAddress } from 'ethers'
import { createStockGate } from './gate'
import { effectiveBlocked } from './rules'
import { stockIssuer, bridgeStockChainIds } from '../tokenizedStocks'
import { BSTOCKS } from '../../data/bStocks'
import { XSTOCKS } from '../../data/xStocks'
import { BUNDLED_ELIGIBILITY_RULES } from '../../data/eligibilityRules'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { rulesFixture } from '../../test-utils/stockGateFixtures'

const BUNDLED = BUNDLED_ELIGIBILITY_RULES
// K43 (2026-11-14): gomulu tabloda uyari listesi BOS. WARN karari (eski ya da onbellekteki, uyari listesi dolu tablo) hala
// uretilir ve alim yine ACIKTIR (warn:true, uygun sayilir); bu fikstur o eski tabloyu temsil eder.
const WARN_TR_RULES = rulesFixture({ issuers: { xstocks: { warn: ['TR'] } } })
const BSTOCK = BSTOCKS[0].address
const XSTOCK = XSTOCKS.find((s) => s.chains.includes(1)).address
const BNB_ZERO = '0x0000000000000000000000000000000000000000'
const BNB_PLACEHOLDER = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const CHECK_FAILED_REPLY = { decision: 'BLOCKED', reason: 'CHECK_FAILED', ipCountry: null }
const COUNTRY_UNKNOWN_REPLY = { decision: 'BLOCKED', reason: 'COUNTRY_UNKNOWN', ipCountry: null }
// STATUS iki ihraccinin kararini TEK yanitta verir (K34): { bstocks: V, xstocks: V }
const BOTH_FAILED = { bstocks: CHECK_FAILED_REPLY, xstocks: CHECK_FAILED_REPLY }
const BOTH_COUNTRY_UNKNOWN = { bstocks: COUNTRY_UNKNOWN_REPLY, xstocks: COUNTRY_UNKNOWN_REPLY }
const REPLY_KEYS = ['decision', 'ipCountry', 'reason']
const BLOCKED_EVAL_KEYS = ['decision', 'ipCountry', 'issuer', 'ok', 'reason', 'stock']

// Kapinin dokunmamasi gereken depo / hesap bagimliliklari: fabrikaya VERILSE bile cagrilmamali (G22).
function build({ rules = BUNDLED, ipCountry = 'IN' } = {}) {
  const rulesClient = { ensureFresh: vi.fn(async () => ({ rules, ipCountry })) }
  const getActiveAccount = vi.fn(async () => ({ key: 'k1', address: '0xSECRETADDR1', importedSecret: 'enc-secret-blob' }))
  const declarations = { read: vi.fn(), declare: vi.fn(), list: vi.fn(), reset: vi.fn() }
  const storage = {
    get: vi.fn(async () => ({})),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  }
  vi.stubGlobal('chrome', { storage: { local: storage, session: storage } })
  const gate = createStockGate({
    stockIssuer, rulesClient, bridgeStockChainIds, getActiveAccount, declarations, bundled: BUNDLED,
  })
  return { gate, rulesClient, getActiveAccount, declarations, storage }
}

function expectNoDeps(c) {
  expect(c.rulesClient.ensureFresh).not.toHaveBeenCalled()
  expectNoStorage(c)
}

function expectNoStorage(c) {
  expect(c.getActiveAccount).not.toHaveBeenCalled()
  for (const fn of Object.values(c.declarations)) expect(fn).not.toHaveBeenCalled()
  for (const fn of Object.values(c.storage)) expect(fn).not.toHaveBeenCalled()
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('gate -- fikstur bekcisi', () => {
  // Testlerin "IN" / "TR" ulkelerine dayanmasi: engel tablosu degisirse sessizce yanlis nedenle gecmesin.
  it('IN iki ihraccida da etkin engel kumesinde DEGIL, TR xstocks icin engelsiz ve uyarisiz (K43)', () => {
    expect(effectiveBlocked(BUNDLED, 'bstocks').has('IN')).toBe(false)
    expect(effectiveBlocked(BUNDLED, 'xstocks').has('IN')).toBe(false)
    expect(BUNDLED.issuers.xstocks.warn).toEqual([])
    expect(effectiveBlocked(BUNDLED, 'xstocks').has('TR')).toBe(false)
    expect(effectiveBlocked(BUNDLED, 'bstocks').has('TR')).toBe(true)
    expect(WARN_TR_RULES.issuers.xstocks.warn).toEqual(['TR']) // pozitif bekci: eski-tablo fikstur gercekten uyari tasiyor
  })
})

describe('gate.evaluate -- hisse olmayan cikti (sifir bagimlilik, G26)', () => {
  const NON_STOCK_INPUTS = [
    ['outAddress undefined', { chainId: 56, outAddress: undefined }],
    ['outAddress null', { chainId: 56, outAddress: null }],
    ['outAddress sayi', { chainId: 56, outAddress: 42 }],
    ['outAddress nesne', { chainId: 56, outAddress: {} }],
    ['outAddress b', { chainId: 56, outAddress: 'b' }],
    ['solana zinciri', { chainId: 'solana-mainnet', outAddress: 'b' }],
    ['yerel BNB sifir adresi', { chainId: 56, outAddress: BNB_ZERO }],
    ['hisse adresi yanlis zincirde', { chainId: 1, outAddress: BSTOCK }],
    ['girdi hic yok', undefined],
    ['girdi null', null],
  ]

  it.each(NON_STOCK_INPUTS)('G26 %s: { ok:true, stock:false } doner, hicbir bagimlilik cagrilmaz', async (_ad, input) => {
    const c = build()
    expect(await c.gate.evaluate(input)).toEqual({ ok: true, stock: false })
    expectNoDeps(c)
  })

  // Pozitif bekci: ayni casuslar hisse ciktisinda GERCEKTEN calisiyor (kural istemcisi).
  it('pozitif bekci: bStock ciktisi kural istemcisini cagirir', async () => {
    const c = build()
    const res = await c.gate.evaluate({ chainId: 56, outAddress: BSTOCK })
    expect(res.ok).toBe(true)
    expect(c.rulesClient.ensureFresh).toHaveBeenCalledTimes(1)
  })

  it('bagimlilik beklenmedik sekilde patlarsa evaluate FIRLATMAZ ve kapiyi ACMAZ', async () => {
    const c = build()
    c.rulesClient.ensureFresh.mockRejectedValue(new Error('beklenmedik'))
    const res = await c.gate.evaluate({ chainId: 56, outAddress: BSTOCK })
    expect(res).toMatchObject({ ok: false, stock: true, issuer: 'bstocks', decision: 'BLOCKED', reason: 'CHECK_FAILED' })
    expect(await c.gate.status()).toEqual(BOTH_FAILED)
  })

  it('stockIssuer firlatirsa hisse degil sayilir ve sifir bagimlilik cagrilir', async () => {
    const rulesClient = { ensureFresh: vi.fn() }
    const gate = createStockGate({ stockIssuer: () => { throw new Error('x') }, rulesClient, bridgeStockChainIds })
    expect(await gate.evaluate({ chainId: 56, outAddress: BSTOCK })).toEqual({ ok: true, stock: false })
    expect(rulesClient.ensureFresh).not.toHaveBeenCalled()
  })
})

describe('gate.evaluate -- hisse ciktisinda yanit sekli (G26)', () => {
  it('G26 uygun ulke: { ok:true, stock:true, issuer, warn:false }, account ve accountId anahtari YOK', async () => {
    const c = build({ ipCountry: 'IN' })
    const res = await c.gate.evaluate({ chainId: 56, outAddress: BSTOCK })
    expect(res).toEqual({ ok: true, stock: true, issuer: 'bstocks', warn: false })
    expect('account' in res).toBe(false)
    expect('accountId' in res).toBe(false)
  })

  it('G26 xstocks TR (K43: uyarisiz uygun): ok:true ve warn:false, account / accountId anahtari yok', async () => {
    const c = build({ ipCountry: 'TR' })
    const res = await c.gate.evaluate({ chainId: 1, outAddress: XSTOCK })
    expect(res).toEqual({ ok: true, stock: true, issuer: 'xstocks', warn: false })
    expect(Object.keys(res).sort()).toEqual(['issuer', 'ok', 'stock', 'warn'])
  })

  it('G26 uyari listesi dolu eski tablo (xstocks TR): ok:true ve warn:true (alim acik), account / accountId anahtari yok', async () => {
    const c = build({ rules: WARN_TR_RULES, ipCountry: 'TR' })
    const res = await c.gate.evaluate({ chainId: 1, outAddress: XSTOCK })
    expect(res).toEqual({ ok: true, stock: true, issuer: 'xstocks', warn: true })
    expect(Object.keys(res).sort()).toEqual(['issuer', 'ok', 'stock', 'warn'])
  })

  it('kapali karar: ok:false, TAM anahtar kumesi, account / accountId / action / country / stale YOK', async () => {
    const c = build({ ipCountry: 'TR' })
    const res = await c.gate.evaluate({ chainId: 56, outAddress: BSTOCK })
    expect(res).toEqual({ ok: false, stock: true, issuer: 'bstocks', decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER', ipCountry: 'TR' })
    expect(Object.keys(res).sort()).toEqual(BLOCKED_EVAL_KEYS)
  })

  it('kapali karar ham hesap malzemesi tasimaz (depodaki hesap hic okunmaz)', async () => {
    const c = build({ ipCountry: 'TR' })
    const res = await c.gate.evaluate({ chainId: 56, outAddress: BSTOCK })
    const serialized = JSON.stringify(res)
    expect(serialized).not.toContain('enc-secret-blob')
    expect(serialized).not.toContain('SECRETADDR1')
    expectNoStorage(c)
  })
})

describe('gate -- hesaptan bagimsizlik (G22)', () => {
  it('G22: status ve evaluate active_account / stock_declarations okumaz; fabrikaya verilen getActiveAccount ve declarations cagrilmaz', async () => {
    const c = build({ ipCountry: 'IN' })
    await c.gate.status()
    await c.gate.status({ issuer: 'xstocks' }) // govde (varsa) yok sayilir
    await c.gate.evaluate({ chainId: 56, outAddress: BSTOCK })
    await c.gate.evaluate({ chainId: 1, outAddress: XSTOCK })
    await c.gate.evaluateBridgeTarget({ toChain: 56, toTokenAddress: BSTOCK })
    // pozitif bekci: kapi gercekten calisti (kural istemcisi cagrildi), yalniz hesap / depo cagrilmadi
    expect(c.rulesClient.ensureFresh).toHaveBeenCalledTimes(5)
    expectNoStorage(c)
  })

  it('G22: depodaki aktif hesap A, B ya da yok iken yanit birebir ayni (kapi hesabi gormez)', async () => {
    const replies = []
    for (const account of [{ key: 'A' }, { key: 'B' }, null]) {
      const c = build({ ipCountry: 'IN' })
      c.getActiveAccount.mockResolvedValue(account)
      replies.push([(await c.gate.status()).bstocks, await c.gate.evaluate({ chainId: 56, outAddress: BSTOCK })])
    }
    expect(replies[1]).toEqual(replies[0])
    expect(replies[2]).toEqual(replies[0])
    expect(replies[0][0]).toEqual({ decision: 'OK', reason: 'OK', ipCountry: 'IN' })
  })
})

describe('gate -- karar yansimasi', () => {
  it('xstocks + TR (K43): ok:true ve warn:false', async () => {
    const c = build({ ipCountry: 'TR' })
    expect(await c.gate.evaluate({ chainId: 1, outAddress: XSTOCK })).toMatchObject({ ok: true, stock: true, issuer: 'xstocks', warn: false })
  })

  it('xstocks + TR, uyari listesi dolu eski tablo: ok:true ve warn:true (alim acik kalir)', async () => {
    const c = build({ rules: WARN_TR_RULES, ipCountry: 'TR' })
    expect(await c.gate.evaluate({ chainId: 1, outAddress: XSTOCK })).toMatchObject({ ok: true, stock: true, issuer: 'xstocks', warn: true })
  })

  it('bstocks + TR: IP_COUNTRY_ISSUER; ipCountry yanitta turetilmis ulke kodu olarak gelir (P1), IP dizesi degil', async () => {
    const c = build({ ipCountry: 'TR' })
    const st = (await c.gate.status()).bstocks
    expect(st).toEqual({ decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER', ipCountry: 'TR' })
    expect(st.ipCountry).toMatch(/^[A-Z]{2}$/)
  })
})

describe('gate -- ulke bilinmiyor (G21)', () => {
  it('G21 status() iki ihracci tek ensureFresh: ulke bilinmiyor -> iki ihracci da COUNTRY_UNKNOWN, ensureFresh cagri sayisi TAM 1', async () => {
    const c = build({ ipCountry: null })
    expect(await c.gate.status()).toEqual(BOTH_COUNTRY_UNKNOWN)
    expect(c.rulesClient.ensureFresh).toHaveBeenCalledTimes(1) // ihracci basina ayri istek DEGIL (ayni ulke, ayni an)
    expect(await c.gate.status()).toEqual(BOTH_COUNTRY_UNKNOWN)
    expect(c.rulesClient.ensureFresh).toHaveBeenCalledTimes(2) // iki status ayri sayilir: her cagrida tam 1
  })

  it('G21 tek anlik goruntu: iki ihracci AYNI ulkeyi ve AYNI anda verilen karari gorur (ulke sunucu yanitinin ortasinda degismez)', async () => {
    const c = build({ ipCountry: 'TR' })
    c.rulesClient.ensureFresh.mockResolvedValueOnce({ rules: BUNDLED, ipCountry: 'TR' }).mockResolvedValue({ rules: BUNDLED, ipCountry: 'IN' })
    const st = await c.gate.status()
    expect(st.bstocks.ipCountry).toBe('TR')
    expect(st.xstocks.ipCountry).toBe('TR') // ikinci bir ensureFresh olsaydi IN gorulurdu
    expect(c.rulesClient.ensureFresh).toHaveBeenCalledTimes(1)
  })

  it('G21 evaluate de iki ihracci icin kapali (COUNTRY_UNKNOWN), Al acilmaz', async () => {
    const c = build({ ipCountry: null })
    expect(await c.gate.evaluate({ chainId: 56, outAddress: BSTOCK })).toMatchObject({ ok: false, stock: true, issuer: 'bstocks', reason: 'COUNTRY_UNKNOWN' })
    expect(await c.gate.evaluate({ chainId: 1, outAddress: XSTOCK })).toMatchObject({ ok: false, stock: true, issuer: 'xstocks', reason: 'COUNTRY_UNKNOWN' })
  })

  it('iyi bicimli ama bilinmeyen ulke kodu (EU) de COUNTRY_UNKNOWN (fail-closed)', async () => {
    const c = build({ ipCountry: 'EU' })
    expect(await c.gate.status()).toEqual(BOTH_COUNTRY_UNKNOWN)
  })
})

describe('gate -- bagimlilik hatasi (G25)', () => {
  it('G25 ensureFresh firlatir: status iki ihracci icin BLOCKED/CHECK_FAILED, evaluate hisse ciktisinda { ok:false }', async () => {
    const c = build()
    c.rulesClient.ensureFresh.mockRejectedValue(new Error('ag'))
    expect(await c.gate.status()).toEqual(BOTH_FAILED)
    const ev = await c.gate.evaluate({ chainId: 56, outAddress: BSTOCK })
    expect(ev).toMatchObject({ ok: false, stock: true, issuer: 'bstocks' })
    const ev2 = await c.gate.evaluate({ chainId: 1, outAddress: XSTOCK })
    expect(ev2).toMatchObject({ ok: false, stock: true, issuer: 'xstocks' })
    expect(c.rulesClient.ensureFresh).toHaveBeenCalledTimes(3) // pozitif bekci: firlatan bagimlilik gercekten cagrildi (status 1 + evaluate 2)
  })

  it('ensureFresh senkron firlatsa da ayni sonuc (kapi acilmaz)', async () => {
    const c = build()
    c.rulesClient.ensureFresh.mockImplementation(() => { throw new Error('senkron') })
    expect(await c.gate.status()).toEqual(BOTH_FAILED)
  })
})

describe('gate -- tek projeksiyon replyOf (R12): tum karar yollari TAM uc anahtari ve ayni degerleri verir', () => {
  it('IP engeli: evaluate kapali dali ve status ayni uc alan degerini tasir (ipCountry dahil)', async () => {
    const c = build({ ipCountry: 'TR' })
    const st = (await c.gate.status()).bstocks
    const ev = await c.gate.evaluate({ chainId: 56, outAddress: BSTOCK })
    expect(Object.keys(st).sort()).toEqual(REPLY_KEYS)
    expect(st).toEqual({ decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER', ipCountry: 'TR' })
    const { ok, stock, issuer, ...evReply } = ev
    expect([ok, stock, issuer]).toEqual([false, true, 'bstocks'])
    expect(evReply).toEqual(st)
  })

  it('reply anahtarlari TAM uc: OK, WARN ve BLOCKED status yanitlari', async () => {
    for (const [ipCountry, issuer, decision, rules] of [['IN', 'bstocks', 'OK'], ['TR', 'xstocks', 'OK'], ['TR', 'xstocks', 'WARN', WARN_TR_RULES], ['TR', 'bstocks', 'BLOCKED']]) {
      const c = build({ ipCountry, ...(rules ? { rules } : {}) })
      const all = await c.gate.status()
      expect(Object.keys(all).sort()).toEqual(['bstocks', 'xstocks'])
      const reply = all[issuer]
      expect(reply.decision).toBe(decision)
      expect(Object.keys(reply).sort(), `${issuer} ${decision}`).toEqual(REPLY_KEYS)
      expect(JSON.stringify(reply)).not.toContain('enc-secret-blob')
    }
  })

  it('kapali yanitlarin hepsi (bagimlilik patlamasi, kopru) ayni uc anahtarli biciminde', async () => {
    const broken = build()
    broken.rulesClient.ensureFresh.mockRejectedValue(new Error('x'))
    const all = await broken.gate.status()
    const replies = [all.bstocks, all.xstocks]
    for (const r of replies) {
      expect(Object.keys(r).sort()).toEqual(REPLY_KEYS)
      expect(r).toEqual(CHECK_FAILED_REPLY)
    }
    const bridge = await broken.gate.evaluateBridgeTarget({ toChain: 56, toTokenAddress: '' })
    expect(Object.keys(bridge).sort()).toEqual(['issuer', 'ok', 'stock', ...REPLY_KEYS].sort())
  })
})

describe('gate -- saat decide girdisine gecer (R7)', () => {
  it('Date.now() her kararda okunur ve decide kurallari o ana gore dogrular', async () => {
    const c = build()
    const spy = vi.spyOn(Date, 'now')
    expect((await c.gate.status()).bstocks).toMatchObject({ decision: 'OK', reason: 'OK' })
    expect(spy).toHaveBeenCalled()
  })

  // Task 40 minoru: status() iki ihracci icin ayri Date.now() okuyordu (ms farkli saatle karar). Tek okuma + ayni `now`.
  it('status(): Date.now() tam BIR kez okunur ve iki ihracciya AYNI saat gecer (tek anlik goruntu)', async () => {
    const c = build()
    let tik = 0
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => Date.parse('2026-11-11T00:00:00Z') + (tik++))
    const all = await c.gate.status()
    expect(all.bstocks).toMatchObject({ decision: 'OK' })
    expect(all.xstocks).toMatchObject({ decision: 'OK' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('evaluate(): karar aninda saat okunur (varsayilan now): tam BIR okuma', async () => {
    const c = build()
    const spy = vi.spyOn(Date, 'now')
    const res = await c.gate.evaluate({ chainId: 56, outAddress: BSTOCK })
    expect(res).toMatchObject({ ok: true, stock: true, issuer: 'bstocks' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('saat tablonun surum tarihinden cok geriye gidince (VERSION_FUTURE) karar RULES_INVALID olur: now gercekten gecer', async () => {
    const c = build()
    vi.spyOn(Date, 'now').mockReturnValue(0)
    expect((await c.gate.status()).bstocks).toMatchObject({ decision: 'BLOCKED', reason: 'RULES_INVALID' })
    const res = await c.gate.evaluate({ chainId: 56, outAddress: BSTOCK })
    expect(res).toMatchObject({ ok: false, stock: true, reason: 'RULES_INVALID' })
  })

  it('saat sonlu sayi degilse (NaN) kapi kapali kalir ve firlatmaz', async () => {
    const c = build()
    vi.spyOn(Date, 'now').mockReturnValue(NaN)
    expect((await c.gate.status()).bstocks).toMatchObject({ decision: 'BLOCKED', reason: 'RULES_INVALID' })
  })
})

describe('gate.status -- yanit sekli (K34, PE14 ara sozlesme BITTI)', () => {
  it('yanit anahtarlari TAM [bstocks, xstocks]; her biri TAM uc anahtar; ensureFresh TEK', async () => {
    const c = build({ ipCountry: 'IN' })
    const all = await c.gate.status()
    expect(Object.keys(all).sort()).toEqual(['bstocks', 'xstocks'])
    for (const v of Object.values(all)) expect(Object.keys(v).sort()).toEqual(REPLY_KEYS)
    expect(all).toEqual({ bstocks: { decision: 'OK', reason: 'OK', ipCountry: 'IN' }, xstocks: { decision: 'OK', reason: 'OK', ipCountry: 'IN' } })
    expect(c.rulesClient.ensureFresh).toHaveBeenCalledTimes(1)
  })

  it('iki ihracci farkli karar alabilir (bstocks + TR kapali, xstocks + TR uyarisiz uygun, K43)', async () => {
    const c = build({ ipCountry: 'TR' })
    expect(await c.gate.status()).toEqual({
      bstocks: { decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER', ipCountry: 'TR' },
      xstocks: { decision: 'OK', reason: 'OK', ipCountry: 'TR' },
    })
  })

  it('uyari listesi dolu eski tabloda xstocks + TR yine WARN doner (musaitlik ayni)', async () => {
    const c = build({ rules: WARN_TR_RULES, ipCountry: 'TR' })
    expect((await c.gate.status()).xstocks).toEqual({ decision: 'WARN', reason: 'WARN_COUNTRY', ipCountry: 'TR' })
  })

  it.each([
    ['govdesiz', undefined],
    ['null', null],
    ['{ issuer: bilinmeyen }', { issuer: 'dogecoin' }],
    ['{ issuer: __proto__ }', { issuer: '__proto__' }],
    ['{ issuer: bstocks } (eski govde)', { issuer: 'bstocks' }],
    ['sayi', 42],
  ])('govde YOK SAYILIR (%s): yanit degismez, firlatmaz', async (_ad, govde) => {
    const c = build({ ipCountry: 'IN' })
    const bos = await build({ ipCountry: 'IN' }).gate.status()
    expect(await c.gate.status(govde)).toEqual(bos)
    expect(c.rulesClient.ensureFresh).toHaveBeenCalledTimes(1)
  })

  it('beyan / liste / sifirlama islemleri kapidan KALKTI (yalniz evaluate, evaluateBridgeTarget, status)', () => {
    const c = build()
    expect(Object.keys(c.gate).sort()).toEqual(['evaluate', 'evaluateBridgeTarget', 'status'])
  })
})

describe('gate.evaluateBridgeTarget -- RF4 (BSC hedefi, fail-closed)', () => {
  const FAIL_CLOSED = { ok: false, stock: false, issuer: null, ...CHECK_FAILED_REPLY }

  it('toChain 56 (sayi) ve "56" (metin): bStock hedefi ulke bilinmiyorsa COUNTRY_UNKNOWN ile reddedilir', async () => {
    for (const toChain of [56, '56']) {
      const c = build({ ipCountry: null })
      expect(await c.gate.evaluateBridgeTarget({ toChain, toTokenAddress: BSTOCK }))
        .toMatchObject({ ok: false, stock: true, issuer: 'bstocks', reason: 'COUNTRY_UNKNOWN' })
    }
  })

  it.each([
    ['KUCUK harf', BSTOCK.toLowerCase()],
    ['BUYUK harf govde', '0x' + BSTOCK.slice(2).toUpperCase()],
    ['checksum', getAddress(BSTOCK.toLowerCase())],
    ['bosluklu', `  ${BSTOCK}  `],
  ])('hisse adresi %s yazimiyla gelse de YAKALANIR', async (_ad, address) => {
    const c = build({ ipCountry: null })
    expect(await c.gate.evaluateBridgeTarget({ toChain: 56, toTokenAddress: address }))
      .toMatchObject({ ok: false, stock: true, issuer: 'bstocks' })
  })

  it.each([['sifir adresi', BNB_ZERO], ['0xEeee yer tutucusu', BNB_PLACEHOLDER]])(
    'BSC\'ye yerel BNB hedefi (%s) ACIK kalir ve hicbir bagimlilik cagrilmaz', async (_ad, address) => {
      const c = build()
      expect(await c.gate.evaluateBridgeTarget({ toChain: 56, toTokenAddress: address })).toEqual({ ok: true, stock: false })
      expectNoDeps(c)
    })

  it.each([undefined, '', '   ', 5, null, {}])(
    'toChain 56 ve toTokenAddress %j (alan yok): alan eksik + BSC -> CHECK_FAILED (fail-closed)', async (toTokenAddress) => {
      const c = build()
      expect(await c.gate.evaluateBridgeTarget({ toChain: 56, toTokenAddress })).toEqual(FAIL_CLOSED)
      expect(await c.gate.evaluateBridgeTarget({ toChain: '56', toTokenAddress })).toEqual(FAIL_CLOSED)
      expectNoDeps(c)
    })

  it.each([1, 42161, -239, 'solana-mainnet', 137, undefined, null])(
    'toChain %j ve alan yok: hisse edinilemeyen hedef ACIK (eski panel gereksiz reddedilmez)', async (toChain) => {
      const c = build()
      expect(await c.gate.evaluateBridgeTarget({ toChain, toTokenAddress: undefined })).toEqual({ ok: true, stock: false })
      expectNoDeps(c)
    })

  it('girdi yok/null: firlatmaz', async () => {
    const c = build()
    expect(await c.gate.evaluateBridgeTarget()).toEqual({ ok: true, stock: false })
    expect(await c.gate.evaluateBridgeTarget(null)).toEqual({ ok: true, stock: false })
  })

  it('uygun ulkedeki kullanici icin BSC bStock hedefi: ok:true, stock:true, account / accountId anahtari yok', async () => {
    const c = build({ ipCountry: 'IN' })
    const res = await c.gate.evaluateBridgeTarget({ toChain: 56, toTokenAddress: BSTOCK })
    expect(res).toEqual({ ok: true, stock: true, issuer: 'bstocks', warn: false })
  })
})

describe('gate.js -- kaynak kilitleri', () => {
  const KOD = yorumsuz(readFileSync(fileURLToPath(new URL('./gate.js', import.meta.url)), 'utf8'))
  const count = (re) => (KOD.match(re) ?? []).length

  it('replyOf TEK tanim ve her karar yolunda kullanilir (judge, closedReply)', () => {
    expect(count(/function replyOf\(/g)).toBe(1)
    // judge ve closedReply: en az iki cagri yeri (tanimin kendisi sayilmaz).
    expect(count(/\breplyOf\(/g) - 1).toBeGreaterThanOrEqual(2)
  })

  it('karar alanlari yalniz replyOf icinde okunur: ".ipCountry" kaynakta TAM BIR kez gecer; ".stale" ve ".action" hic gecmez', () => {
    // Elle kurulan ikinci bir yanit (d.ipCountry / reply.stale ...) bu sayilari artirir ve kilidi kirar.
    expect(count(/\.ipCountry\b/g)).toBe(1)
    expect(count(/\.stale\b/g)).toBe(0)
    expect(count(/\.action\b/g)).toBe(0)
  })

  it('yanit, kapi sonucu ham yayilarak degil kapali alan listesinden kurulur: "...d" ve "...input" yok', () => {
    expect(KOD).not.toMatch(/\.\.\.\s*(d|input|written|res)\b/)
  })

  it('decide girdisine saat gecirilir: decideReply varsayilan `now = Date.now()` alir, status() tek okuyup iki ihracciya gecirir', () => {
    expect(KOD).toMatch(/\{ rules, ipCountry \}, now = Date\.now\(\)\)/)
    expect(KOD).toMatch(/decideStockBuy\(\{ issuer, rules, ipCountry, now \}\)/)
    expect(KOD).toMatch(/decideReply\(issuer, snapshot, now\)/)
    expect(count(/Date\.now\(\)/g)).toBe(2) // varsayilan parametre + status() icindeki TEK okuma
  })

  it('kapi saftir: featureFlags, console, privateKey, chrome, vue yok', () => {
    expect(KOD).not.toMatch(/featureFlags|console\.|privateKey|\bchrome\b|from 'vue'/)
  })

  it('kapi hesabi, hesap kimligini ve beyan deposunu bilmez (K39): getActiveAccount, declarations, accountId, active_account, stock_declarations yok', () => {
    expect(KOD).not.toMatch(/getActiveAccount|declarations|accountId|accountIdOf|active_account|stock_declarations|\baccount\b/)
    expect(KOD).not.toMatch(/COUNTRY_CODE_SET|normalizeCountry/)
    expect(KOD).toMatch(/rulesClient\.ensureFresh\(/) // pozitif bekci: tarama gercek kaynagi okudu
  })
})

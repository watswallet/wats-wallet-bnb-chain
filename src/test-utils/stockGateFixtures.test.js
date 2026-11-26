// Ilk alim kapisi ortak test fiksturleri (stockGateFixtures.js) kendi sozlesmelerini tasir.
//
// KOK NEDEN: onlarca test (kapi, beyan, kural istemcisi, CoW servis / onay) ayni fiksturlere dayanir. Bir
// fikstur sessizce degisirse (get'in varsayilan degerleri yok sayilmasi, set'in kopyalamamasi, rulesFixture'un
// donuk nesneyi paylasmasi) bagimli testler YANLIS NEDENLE gecer ya da kirilir. Bu dosya o sozlesmeyi kilitler.
import { describe, it, expect } from 'vitest'
import { rulesFixture, memoryArea, allowAllGate, denyAllGate, bumpVersion, versionNoonMs } from './stockGateFixtures'
import { STOCK_GATE_REASONS } from '../utils/stockGate/errors'
import { BUNDLED_ELIGIBILITY_RULES as BUNDLED } from '../data/eligibilityRules'
import { validateRules, compareRulesVersion } from '../utils/stockGate/rules'

describe('rulesFixture', () => {
  it('varsayilan: gomulu tablonun ESIT ama AYRI ve donuk OLMAYAN kopyasi', () => {
    const r = rulesFixture()
    expect(r).toEqual(BUNDLED)
    expect(r).not.toBe(BUNDLED)
    expect(Object.isFrozen(r)).toBe(false)
    r.common.precaution.push('ZZ')
    expect(BUNDLED.common.precaution).not.toContain('ZZ')
  })

  it('version, common ve issuers.<i> ezmeleri; ezilmeyen alanlar korunur', () => {
    const r = rulesFixture({
      version: '2026-12-01.4',
      common: { precaution: ['US'] },
      issuers: { bstocks: { buyEnabled: false }, xstocks: { warn: [] } },
    })
    expect(r.version).toBe('2026-12-01.4')
    expect(r.common.precaution).toEqual(['US'])
    expect(r.issuers.bstocks.buyEnabled).toBe(false)
    expect(r.issuers.bstocks.blocked).toEqual(BUNDLED.issuers.bstocks.blocked)
    expect(r.issuers.xstocks.warn).toEqual([])
    expect(r.issuers.xstocks.textVersion).toBeUndefined()
  })

  it('ezme degerleri kopyalanir (cagiran nesne paylasilmaz)', () => {
    const over = { common: { precaution: ['US'] } }
    const r = rulesFixture(over)
    r.common.precaution.push('PR')
    expect(over.common.precaution).toEqual(['US'])
  })

  it('bilinmeyen ihracci EKLENIR (gecersiz tablo kurmak icin) ve dogrulayici reddeder', () => {
    const r = rulesFixture({ issuers: { dogecoin: { buyEnabled: true, blocked: [], warn: [] } } })
    expect(Object.keys(r.issuers)).toContain('dogecoin')
    expect(validateRules(r)).toEqual({ ok: false, error: 'ISSUERS' })
  })
})

describe('bumpVersion ve versionNoonMs (PE17)', () => {
  it('bumpVersion: yalniz .N sonekini n artirir, gun ayni kalir; n = 0 ayni surumu doner', () => {
    expect(bumpVersion('2026-11-09.1', 1)).toBe('2026-11-09.2')
    expect(bumpVersion('2026-11-09.1', 0)).toBe('2026-11-09.1')
    expect(bumpVersion('2026-11-09.1', 9)).toBe('2026-11-09.10')
    expect(bumpVersion('2026-12-01.4', 3)).toBe('2026-12-01.7')
  })

  it('bumpVersion: gecersiz surum ya da tamsayi olmayan n FIRLATIR (sessiz yanlis fikstur yok)', () => {
    for (const v of [undefined, null, 5, '', 'x', '2026-11-09', '2026-11-09.', '2026-11-09.x']) {
      expect(() => bumpVersion(v, 1), String(v)).toThrow(/bumpVersion/)
    }
    for (const n of [undefined, null, '1', 1.5, NaN, Infinity]) {
      expect(() => bumpVersion('2026-11-09.1', n), String(n)).toThrow(/bumpVersion/)
    }
  })

  it('gomulu surumden turetilen surum gecerli ve gomuludan yuksektir', () => {
    const up = bumpVersion(BUNDLED.version, 1)
    expect(validateRules(rulesFixture({ version: up }), { now: versionNoonMs(BUNDLED.version) })).toEqual({ ok: true })
    expect(compareRulesVersion(up, BUNDLED.version)).toBe(1)
  })

  it('versionNoonMs: surum gununun 12:00 UTC si; gecersiz surumde firlatir', () => {
    expect(versionNoonMs('2026-11-09.1')).toBe(Date.UTC(2026, 10, 9, 12, 0, 0))
    expect(versionNoonMs('2026-11-09.77')).toBe(Date.UTC(2026, 10, 9, 12, 0, 0))
    expect(() => versionNoonMs('garip')).toThrow(/versionNoonMs/)
  })
})

describe('memoryArea', () => {
  it('get: dize / dizi / varsayilanli nesne / null; yalniz VAR olan anahtarlar', async () => {
    const area = memoryArea({ a: 1, b: { x: 1 }, c: 'k' })
    expect(await area.get('a')).toEqual({ a: 1 })
    expect(await area.get(['a', 'zz'])).toEqual({ a: 1 })
    expect(await area.get({ a: 0, d: 9 })).toEqual({ a: 1, d: 9 })
    expect(await area.get(null)).toEqual({ a: 1, b: { x: 1 }, c: 'k' })
    expect(await area.get('yok')).toEqual({})
    expect(area.getCalls).toEqual(['a', ['a', 'zz'], { a: 0, d: 9 }, null, 'yok'])
  })

  it('get ve set KOPYALAR: cagiran depoyu yan etkiyle bozamaz; _store canli depodur', async () => {
    const initial = { s: { n: 1 } }
    const area = memoryArea(initial)
    const out = await area.get('s')
    out.s.n = 99
    expect(area._store.s.n).toBe(1)
    const yazilan = { s: { n: 2 } }
    await area.set(yazilan)
    yazilan.s.n = 77
    expect(area._store.s.n).toBe(2)
    initial.s.n = 55
    expect(area._store.s.n).toBe(2)
    expect(area.setCalls).toEqual([{ s: { n: 2 } }])
  })

  it('set yalniz verilen anahtarlari degistirir; remove tek anahtari ve diziyi siler', async () => {
    const area = memoryArea({ a: 1, b: 2, c: 3 })
    await area.set({ b: 20, d: 4 })
    expect(area._store).toEqual({ a: 1, b: 20, c: 3, d: 4 })
    await area.remove('a')
    await area.remove(['b', 'zz'])
    expect(area._store).toEqual({ c: 3, d: 4 })
    expect(area.removeCalls).toEqual(['a', ['b', 'zz']])
  })

  it('failGet: get reddedilir ama set calisir; failSet: set / remove reddedilir ama get calisir', async () => {
    const g = memoryArea({ a: 1 }, { failGet: true })
    await expect(g.get('a')).rejects.toThrow('storage get failed')
    await g.set({ b: 2 })
    expect(g._store).toEqual({ a: 1, b: 2 })

    const s = memoryArea({ a: 1 }, { failSet: true })
    expect(await s.get('a')).toEqual({ a: 1 })
    await expect(s.set({ a: 2 })).rejects.toThrow('storage set failed')
    await expect(s.remove('a')).rejects.toThrow('storage remove failed')
    expect(s._store).toEqual({ a: 1 })
  })

  it('varsayilan: bos depo, hata yok', async () => {
    const area = memoryArea()
    expect(await area.get(null)).toEqual({})
    expect(area._store).toEqual({})
  })
})

describe('allowAllGate / denyAllGate', () => {
  it('allowAllGate { ok:true }; denyAllGate varsayilan IP_COUNTRY_ISSUER, eylem alani yok', async () => {
    expect(await allowAllGate({ chainId: 1, stockAddress: '0x1' })).toEqual({ ok: true })
    expect(await denyAllGate()({ chainId: 1, stockAddress: '0x1' })).toEqual({ ok: false, reason: 'IP_COUNTRY_ISSUER' })
    expect(await denyAllGate('KILL_SWITCH')({})).toEqual({ ok: false, reason: 'KILL_SWITCH' })
  })

  it('stockGateFixtures: denyAllGate varsayilani kume icinde (olu neden fikstur varsayilani olamaz)', async () => {
    const { reason } = await denyAllGate()({})
    expect(STOCK_GATE_REASONS).toContain(reason)
    expect(STOCK_GATE_REASONS).toHaveLength(5) // pozitif bekci: kume bos degil ve yeni kume
  })
})

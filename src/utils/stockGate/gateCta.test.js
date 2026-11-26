// KOK NEDEN / KAPATILAN HATA (sahip karari D3, spec 6.3; K32 sonrasi): kilitliyken ana CTA etiketi nedeni soyler. Etiket
// mantigi Swap, Kopru ve StockTrade'de ayri ayri yazilirsa her biri baska bir durumu kacirir (bos etiket, yanlis kip,
// kilitli dugmenin etkin kalmasi). gateCtaOf tek karar noktasidir: kapi durumu -> { mode, labelKey }.
//  (1) mode yalniz open | locked: beyan istemek yok, hicbir kapi durumu dugmeyi kilitliyken ETKIN yapmaz;
//  (2) her kilit PASIF ve KISA nedeni soyler; (3) bilinmeyen durum / kume disi neden / bozuk girdi FAIL-CLOSED;
//      eski beyan durumu ('declare') ve dokuz olu neden (US_PERSON, DECLARATION_REQUIRED, COUNTRY_MISMATCH, ...) artik
//      listede olmadigindan "Dogrulanamadi" (kapali yon) etiketine duser;
//  (4) PE12: pasif neden listesi 12 -> 5 (STOCK_GATE_REASONS ile ayni kume); kume disi her ad kapali yonde CHECK_FAILED.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { STOCK_GATE_REASONS } from './errors'
import { GATE_ALLOWED_STATES } from '../../composables/useStockGate'
import {
    gateCtaOf, GATE_OPEN_STATES, GATE_CTA_LOCK_REASONS, GATE_CTA_CHECKING_KEY,
} from './gateCta'
import * as gateCtaModulu from './gateCta'

const G = (state, reason = null) => ({ state, reason })
const FAIL_CLOSED = { mode: 'locked', labelKey: 'stockGate.cta.CHECK_FAILED' }
// Beyan kalkinca hicbir uretici kalmayan dokuz olu neden (PE12: kumeden ve etiket listesinden CIKTI).
const OLU_NEDENLER = [
    'US_PERSON', 'DECLARED_COUNTRY_ISSUER', 'DECLARED_COUNTRY_PRECAUTION', 'COUNTRY_MISMATCH', 'TEXT_UPDATE_REQUIRED',
    'STORAGE_ERROR', 'ACCOUNT_MISMATCH', 'ACCOUNT_UNKNOWN', 'DECLARATION_REQUIRED',
]

describe('gateCtaOf -- acik durumlar', () => {
    it('pozitif bekci: engelli IP_COUNTRY_ISSUER -> PASIF kisa neden etiketi', () => {
        expect(gateCtaOf(G('blocked', 'IP_COUNTRY_ISSUER'))).toEqual({ mode: 'locked', labelKey: 'stockGate.cta.IP_COUNTRY_ISSUER' })
    })

    it.each(['idle', 'ok', 'warn'])('acik durum %s: open, etiket yok (dugme kendi normal etiketini korur)', (state) => {
        expect(gateCtaOf(G(state))).toEqual({ mode: 'open', labelKey: null })
        expect(gateCtaOf(G(state, 'IP_COUNTRY_ISSUER'))).toEqual({ mode: 'open', labelKey: null }) // neden alani acik durumu degistirmez
    })

    it('gateCta: GATE_OPEN_STATES = GATE_ALLOWED_STATES (ayni kume, dondurulmus)', () => {
        expect(GATE_OPEN_STATES).toEqual(['idle', 'ok', 'warn'])
        expect([...GATE_OPEN_STATES]).toEqual([...GATE_ALLOWED_STATES])
        expect(Object.isFrozen(GATE_OPEN_STATES)).toBe(true)
    })
})

describe('gateCtaOf -- kip yalniz open | locked (beyan eylemi YOK)', () => {
    it('gateCta: mode yalniz open | locked (her durum x her neden x bozuk girdi)', () => {
        const durumlar = ['idle', 'checking', 'ok', 'warn', 'declare', 'blocked', 'error', 'bogus', undefined, null, 5]
        const nedenler = [...STOCK_GATE_REASONS, 'FOO', null, undefined, 5, '__proto__']
        const kipler = new Set()
        for (const state of durumlar) for (const reason of nedenler) kipler.add(gateCtaOf({ state, reason }).mode)
        for (const bozuk of [{}, null, undefined, 'blocked', 42]) kipler.add(gateCtaOf(bozuk).mode)
        expect([...kipler].sort()).toEqual(['locked', 'open'])
    })

    it('gateCta: declare durumu ve DECLARATION_REQUIRED / COUNTRY_MISMATCH fail-closed CHECK_FAILED etiketi', () => {
        expect(gateCtaOf(G('declare', 'DECLARATION_REQUIRED'))).toEqual(FAIL_CLOSED)
        expect(gateCtaOf({ state: 'declare', reason: 'DECLARATION_REQUIRED', stale: true })).toEqual(FAIL_CLOSED)
        expect(gateCtaOf(G('declare', null))).toEqual(FAIL_CLOSED)
        expect(gateCtaOf(G('blocked', 'COUNTRY_MISMATCH'))).toEqual(FAIL_CLOSED)
        expect(gateCtaOf(G('blocked', 'DECLARATION_REQUIRED'))).toEqual(FAIL_CLOSED)
        for (const neden of OLU_NEDENLER) expect(GATE_CTA_LOCK_REASONS).not.toContain(neden)
    })

    it('eylem sabiti ve eylem etiket anahtarlari modulde YOK', () => {
        expect(gateCtaModulu.GATE_CTA_ACTION_KEYS).toBeUndefined()
        expect(Object.keys(gateCtaModulu).sort()).toEqual(['GATE_CTA_CHECKING_KEY', 'GATE_CTA_LOCK_REASONS', 'GATE_OPEN_STATES', 'gateCtaOf'])
    })

    it('kilitli durumlarin HICBIRI eylem etiketi (stockGate.action.*) dondurmez', () => {
        for (const state of ['checking', 'blocked', 'error', 'declare']) {
            for (const reason of STOCK_GATE_REASONS) {
                const { labelKey } = gateCtaOf(G(state, reason))
                expect(labelKey, `${state}/${reason}`).not.toMatch(/^stockGate\.action\./)
            }
        }
    })
})

describe('gateCtaOf -- pasif kip (KISA neden etiketi)', () => {
    it('kontrol suruyor (checking): pasif "Kontrol ediliyor" etiketi', () => {
        expect(gateCtaOf(G('checking'))).toEqual({ mode: 'locked', labelKey: GATE_CTA_CHECKING_KEY })
        expect(GATE_CTA_CHECKING_KEY).toBe('stockGate.cta.checking')
    })

    it('gateCta: GATE_CTA_LOCK_REASONS TAM bes deger [KILL_SWITCH, IP_COUNTRY_ISSUER, IP_COUNTRY_PRECAUTION, COUNTRY_UNKNOWN, CHECK_FAILED] x blocked -> stockGate.cta.<NEDEN>', () => {
        expect(GATE_CTA_LOCK_REASONS).toEqual(['KILL_SWITCH', 'IP_COUNTRY_ISSUER', 'IP_COUNTRY_PRECAUTION', 'COUNTRY_UNKNOWN', 'CHECK_FAILED'])
        expect(GATE_CTA_LOCK_REASONS).toHaveLength(5)
        for (const reason of GATE_CTA_LOCK_REASONS) {
            expect(gateCtaOf(G('blocked', reason)), reason).toEqual({ mode: 'locked', labelKey: `stockGate.cta.${reason}` })
        }
    })

    it('gateCta: blocked + COUNTRY_UNKNOWN pasif ve stockGate.cta.COUNTRY_UNKNOWN etiketi', () => {
        expect(GATE_CTA_LOCK_REASONS).toContain('COUNTRY_UNKNOWN')
        expect(gateCtaOf(G('blocked', 'COUNTRY_UNKNOWN'))).toEqual({ mode: 'locked', labelKey: 'stockGate.cta.COUNTRY_UNKNOWN' })
    })

    it('error durumu: PASIF "Dogrulanamadi" (neden alani ne olursa olsun)', () => {
        expect(gateCtaOf(G('error', 'CHECK_FAILED'))).toEqual(FAIL_CLOSED)
        expect(gateCtaOf(G('error', null))).toEqual(FAIL_CLOSED)
        expect(gateCtaOf(G('error', 'COUNTRY_MISMATCH'))).toEqual(FAIL_CLOSED)
    })

    it('gateCta: olu adlar (US_PERSON, DECLARATION_REQUIRED, ...) blocked ile gelirse CHECK_FAILED etiketi (locked)', () => {
        expect(OLU_NEDENLER).toHaveLength(9) // pozitif bekci: dokuz ad da denenir
        for (const neden of OLU_NEDENLER) {
            expect(gateCtaOf(G('blocked', neden)), neden).toEqual(FAIL_CLOSED)
            expect(gateCtaOf(G('blocked', neden)).mode, neden).toBe('locked')
        }
        expect(gateCtaOf(G('blocked', 'ALREADY_BLOCKED'))).toEqual(FAIL_CLOSED)
    })
})

describe('gateCtaOf -- fail-closed ve bolusum', () => {
    it('bilinmeyen durum, kume disi neden, bozuk girdi: PASIF "Dogrulanamadi" (asla open degil)', () => {
        const bozuk = [
            G('blocked', 'FOO'), G('blocked', null), G('blocked', undefined), G('blocked', 5), G('blocked', {}), G('blocked', 'toString'),
            G('bogus', 'IP_COUNTRY_ISSUER'), G(undefined, undefined), G(null, null), G(5, 'IP_COUNTRY_ISSUER'), {}, null, undefined, 'blocked', 42,
        ]
        for (const g of bozuk) expect(gateCtaOf(g), JSON.stringify(g)).toEqual(FAIL_CLOSED)
    })

    it('bolusum: etiketli neden listesi = STOCK_GATE_REASONS (5 = 5); olu adlar listede degil, kapali yonde', () => {
        expect(GATE_CTA_LOCK_REASONS.filter((r) => OLU_NEDENLER.includes(r))).toEqual([])
        expect([...GATE_CTA_LOCK_REASONS].sort()).toEqual([...STOCK_GATE_REASONS].sort())
        expect(STOCK_GATE_REASONS).toHaveLength(5)
        // her neden blocked iken kilitli ve etiketi kendi anahtari
        expect(STOCK_GATE_REASONS.filter((r) => gateCtaOf(G('blocked', r)).mode === 'locked')).toHaveLength(5)
    })

    it('sabitler dondurulmus', () => {
        expect(Object.isFrozen(GATE_CTA_LOCK_REASONS)).toBe(true)
    })
})

describe('gateCta.js -- kaynak taramasi', () => {
    const kod = yorumsuz(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'gateCta.js'), 'utf8'))

    it('saf: vue, chrome, depo, ag, i18n, featureFlags, console ve import YOK; yalniz anahtar adi doner', () => {
        expect(kod).toContain('export function gateCtaOf') // pozitif bekci: tarama gercek kaynagi goruyor
        expect(kod).not.toMatch(/\bfrom\s+['"]vue['"]|\bchrome\b|featureFlags|vue-i18n|\bconsole\b|\bfetch\(/)
        expect(kod).not.toMatch(/\bimport\b/)
    })

    it('eylem kipi kaynakta yok: action, declare, GATE_CTA_ACTION_KEYS, stockGate.action gecmez', () => {
        expect(kod).toContain('GATE_CTA_LOCK_REASONS') // pozitif bekci
        expect(kod).not.toMatch(/GATE_CTA_ACTION_KEYS|'action'|'declare'|stockGate\.action|DECLARATION_REQUIRED|COUNTRY_MISMATCH/)
    })
})

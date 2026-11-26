// useStockGateMock.js (StockTrade ailesi SSR testlerinin ortak useStockGate sahtesi) kendi sozlesmesini tasir.
//
// KOK NEDEN / KAPATILAN HATA: beyan arayuzu K32 ile kalkti; sahte kanca eski beyan durumlarini (GATE_DECLARE,
// GATE_MISMATCH) ve eski alanlari (action / country / stale / accountId) tasimaya devam ederse SSR testleri gercek
// kancada OLMAYAN bir sekle karsi yesil kalir (sahte, gercekten ayrisir). Sahte, gercek kancanin UC alanli sekline
// (state, reason, ipCountry) ve ayni arayuze (allowed, refresh) indirilir.
import { describe, it, expect } from 'vitest'
import * as sahteModul from './useStockGateMock'
import { GATE_IDLE, GATE_OK, GATE_WARN, GATE_CHECKING, gateBlocked, createUseStockGateMock, resetGateMock } from './useStockGateMock'
import * as gercekModul from '../composables/useStockGate'

describe('useStockGateMock', () => {
  it('useStockGateMock: GATE_DECLARE ve GATE_MISMATCH yok (beyan durumlari kalkti)', () => {
    expect('GATE_DECLARE' in sahteModul).toBe(false)
    expect('GATE_MISMATCH' in sahteModul).toBe(false)
    // pozitif bekci: ayni modulden beklenen sabitler gercekten var
    for (const ad of ['GATE_IDLE', 'GATE_OK', 'GATE_WARN', 'GATE_CHECKING', 'gateBlocked', 'gateMock', 'resetGateMock', 'createUseStockGateMock']) {
      expect(ad in sahteModul, ad).toBe(true)
    }
  })

  it('GATE_IDLE ve turevleri UC alanli: state, reason, ipCountry (action / country / stale / accountId yok)', () => {
    for (const g of [GATE_IDLE, GATE_OK, GATE_WARN, GATE_CHECKING, gateBlocked('IP_COUNTRY_ISSUER')]) {
      expect(Object.keys(g).sort()).toEqual(['ipCountry', 'reason', 'state'])
    }
    expect(gateBlocked('IP_COUNTRY_ISSUER', { ipCountry: 'TR' })).toEqual({ state: 'blocked', reason: 'IP_COUNTRY_ISSUER', ipCountry: 'TR' })
  })

  it('sahte kanca gercek kancayla ayni anahtar kumesini doner (state, reason, ipCountry, allowed, refresh)', () => {
    resetGateMock()
    const sahte = createUseStockGateMock(gercekModul).useStockGate('bstocks')
    expect(Object.keys(sahte).sort()).toEqual(['allowed', 'ipCountry', 'reason', 'refresh', 'state'])
  })
})

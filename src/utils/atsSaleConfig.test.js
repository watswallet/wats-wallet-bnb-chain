// ATS satis ayari -- FAIL-CLOSED kapi (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §6.1).
// Adresler bos kaldikca bayrak acik olsa bile satis yolu KAPALI; yayin derlemesi bayragi
// acik ve iki adresli cikar.
import { describe, it, expect } from 'vitest'
import { getAddress } from 'ethers'
import {
  ATS_SALE_ENABLED, ATS_SALE_DESK, ATS_SALE_SPONSOR, ATS_SALE_ATS, ATS_SALE_CHAIN_ID,
  ATS_SALE_PAY_TOKENS, ATS_SALE_ZERO_ADDRESS, ATS_SALE_QUOTE_TTL_SEC, ATS_SALE_REQUOTE_BELOW_SEC,
  ATS_SALE_REFRESH_MS, ATS_SALE_COMMISSION_PCT, atsSaleLiveFrom, isAtsSaleLive,
} from './atsSaleConfig'
import { getAtsConfig, ATS_CHAINS } from './atsConfig'
import { CHAIN_ADDRESSES } from './sdk/gasless'

const A = '0x1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d'
const B = '0x5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b'

describe('atsSaleLiveFrom -- fail-closed', () => {
  it('bayrak + iki gecerli, farkli adres -> acik', () => {
    expect(atsSaleLiveFrom({ enabled: true, desk: A, sponsor: B })).toBe(true)
  })

  it('bayrak acik ama adresler BOS -> kapali', () => {
    expect(atsSaleLiveFrom({ enabled: true, desk: '', sponsor: '' })).toBe(false)
  })

  it('tek adres eksik -> kapali', () => {
    expect(atsSaleLiveFrom({ enabled: true, desk: A, sponsor: '' })).toBe(false)
    expect(atsSaleLiveFrom({ enabled: true, desk: '', sponsor: B })).toBe(false)
  })

  it('bicimsiz ya da sifir adres -> kapali', () => {
    expect(atsSaleLiveFrom({ enabled: true, desk: '0x1234', sponsor: B })).toBe(false)
    expect(atsSaleLiveFrom({ enabled: true, desk: ATS_SALE_ZERO_ADDRESS, sponsor: B })).toBe(false)
  })

  it('desk ile sponsor ayni adres (yanlis kopyalama) -> kapali', () => {
    expect(atsSaleLiveFrom({ enabled: true, desk: A, sponsor: A.toUpperCase().replace('0X', '0x') })).toBe(false)
  })

  it('bayrak YALNIZ `true` ile acilir (metin ya da 1 ACMAZ)', () => {
    expect(atsSaleLiveFrom({ enabled: 'true', desk: A, sponsor: B })).toBe(false)
    expect(atsSaleLiveFrom({ enabled: 1, desk: A, sponsor: B })).toBe(false)
    expect(atsSaleLiveFrom({ enabled: false, desk: A, sponsor: B })).toBe(false)
  })
})

// Adresler zincirde dogrulandiktan sonra yazildi (Task 16 Step 3; canli /sale/quote karsilastirmasi
// sunucu acilinca Task 17'de). Checksum kontrolu yanlis kopyalanmis bir adresi yakalar;
// desk/sponsor esitligi ayni adresin iki kez yazilmasini.
describe('yayin derlemesi', () => {
  it('bayrak acik, iki adres checksum bicimli ve farkli, satis yolu acik', () => {
    expect(ATS_SALE_ENABLED).toBe(true)
    expect(getAddress(ATS_SALE_DESK)).toBe(ATS_SALE_DESK)
    expect(getAddress(ATS_SALE_SPONSOR)).toBe(ATS_SALE_SPONSOR)
    expect(ATS_SALE_DESK.toLowerCase()).not.toBe(ATS_SALE_SPONSOR.toLowerCase())
    expect(isAtsSaleLive()).toBe(true)
  })
})

describe('sabitler', () => {
  it('odeme tokenleri spec §2.1 ile ayni ve oncelik sirasinda (USDT > USDC > BNB)', () => {
    expect(ATS_SALE_PAY_TOKENS.map((t) => t.symbol)).toEqual(['USDT', 'USDC', 'BNB'])
    expect(ATS_SALE_PAY_TOKENS[0]).toMatchObject({ address: '0x55d398326f99059fF775485246999027B3197955', quoteAddress: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 })
    expect(ATS_SALE_PAY_TOKENS[1]).toMatchObject({ address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', quoteAddress: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 })
    // Cuzdanda native BNB '0x0'; desk'te BNB = ZeroAddress.
    expect(ATS_SALE_PAY_TOKENS[2]).toMatchObject({ address: '0x0', quoteAddress: '0x0000000000000000000000000000000000000000', decimals: 18 })
  })

  it('ATS ve zincir atsConfig ile ayni', () => {
    expect(ATS_SALE_CHAIN_ID).toBe(56)
    expect(ATS_SALE_ATS).toBe(getAtsConfig(56).token.address)
  })

  it('sureler: teklif 30 sn, requote < 10 sn, yenileme 20 sn, komisyon yedegi %1', () => {
    expect(ATS_SALE_QUOTE_TTL_SEC).toBe(30)
    expect(ATS_SALE_REQUOTE_BELOW_SEC).toBe(10)
    expect(ATS_SALE_REFRESH_MS).toBe(20000)
    expect(ATS_SALE_COMMISSION_PCT).toBe(1)
  })

  // Adresler doldugunda (Task 16) anlam kazanir: sponsor her isleme uygulanan kayitlara GIRMEZ.
  it('satis adresleri ATS_CHAINS ve CHAIN_ADDRESSES icinde YOK (spec §6.1)', () => {
    const tablolar = (JSON.stringify(ATS_CHAINS) + JSON.stringify(CHAIN_ADDRESSES)).toLowerCase()
    for (const a of [ATS_SALE_DESK, ATS_SALE_SPONSOR].filter(Boolean)) {
      expect(tablolar).not.toContain(a.toLowerCase())
    }
  })
})

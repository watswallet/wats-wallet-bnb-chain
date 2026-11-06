// CoW sabitleri: adresler, domain, odeme tokenleri, permit tablosu, alici dogrulamasi ve yayin kapisi.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { getAddress, ZeroAddress } from 'ethers'
import { getIntermediates } from '../swapChains'
import * as cfg from './config'

const {
  GPV2_SETTLEMENT,
  GPV2_VAULT_RELAYER,
  PAY_TOKENS,
  COW_CHAIN_IDS,
  COW_PATH_BY_CHAIN,
  cowPathFor,
  cowDomain,
  payTokensFor,
  payTokenByAddress,
  permitSupported,
  partnerRecipientCheck,
  LOCK_REASON,
} = cfg

const ARB_USDC_E = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'
const HARDHAT_1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const SAFE_FEE_RECIPIENT = '0xb42f545bF8AB1A1Ba968e21a32E553d25fdF8e6d'
const usdt = (chainId) => PAY_TOKENS[chainId].find((t) => t.symbol === 'USDT')
const usdc = (chainId) => PAY_TOKENS[chainId].find((t) => t.symbol === 'USDC')

describe('cow/config adresler', () => {
  it('Settlement, VaultRelayer ve 6 odeme tokeni EIP-55 bicimindedir', () => {
    expect(getAddress(GPV2_SETTLEMENT)).toBe(GPV2_SETTLEMENT)
    expect(getAddress(GPV2_VAULT_RELAYER)).toBe(GPV2_VAULT_RELAYER)
    expect(GPV2_VAULT_RELAYER).toBe('0xC92E8bdf79f0507f65a392b0ab4667716BFE0110')
    let sayac = 0
    for (const chainId of COW_CHAIN_IDS) {
      for (const t of PAY_TOKENS[chainId]) {
        expect(getAddress(t.address)).toBe(t.address)
        sayac++
      }
    }
    expect(sayac).toBe(6)
  })
})

describe('cow/config ag yollari ve domain', () => {
  it('COW_PATH_BY_CHAIN birebir; desteklenmeyen ya da metin zincir null', () => {
    expect(COW_PATH_BY_CHAIN).toEqual({ 1: 'mainnet', 56: 'bnb', 42161: 'arbitrum_one' })
    expect(cowPathFor(56)).toBe('bnb')
    expect(cowPathFor(10)).toBeNull()
    expect(cowPathFor('1')).toBeNull()
    expect(Object.isFrozen(COW_PATH_BY_CHAIN)).toBe(true)
  })

  it('cowDomain Settlement ile kurulur, her cagrida yeni nesne, desteklenmeyen zincir firlatir', () => {
    expect(cowDomain(1)).toEqual({
      name: 'Gnosis Protocol',
      version: 'v2',
      chainId: 1,
      verifyingContract: GPV2_SETTLEMENT,
    })
    expect(cowDomain(56)).not.toBe(cowDomain(56))
    expect(cowDomain(42161n).chainId).toBe(42161)
    expect(cowDomain('56').chainId).toBe(56)
    let hata
    try {
      cowDomain(10)
    } catch (e) {
      hata = e
    }
    expect(hata).toBeInstanceOf(Error)
    expect(hata.code).toBe('UNSUPPORTED_CHAIN')
  })
})

describe('cow/config odeme tokenleri', () => {
  it('her zincirde USDC+USDT var, swapChains ara tokenleri icinde, Arbitrum USDC.e yok', () => {
    for (const chainId of COW_CHAIN_IDS) {
      expect(payTokensFor(chainId).map((t) => t.symbol)).toEqual(['USDC', 'USDT'])
      const ara = getIntermediates(chainId).map((a) => String(a).toLowerCase())
      for (const t of PAY_TOKENS[chainId]) {
        expect(ara).toContain(t.address.toLowerCase())
      }
    }
    const arb = PAY_TOKENS[42161].map((t) => t.address.toLowerCase())
    expect(arb).not.toContain(ARB_USDC_E.toLowerCase())
    expect(payTokensFor(10)).toEqual([])
  })

  it('PAY_TOKENS ve girdileri dondurulmustur', () => {
    expect(Object.isFrozen(PAY_TOKENS)).toBe(true)
    for (const chainId of COW_CHAIN_IDS) {
      expect(Object.isFrozen(PAY_TOKENS[chainId])).toBe(true)
      for (const t of PAY_TOKENS[chainId]) expect(Object.isFrozen(t)).toBe(true)
    }
    expect(Object.isFrozen(COW_CHAIN_IDS)).toBe(true)
  })

  it('payTokenByAddress buyuk/kucuk harf duyarsiz bulur, USDC.e null', () => {
    expect(payTokenByAddress(56, usdt(56).address.toLowerCase())).toBe(usdt(56))
    expect(payTokenByAddress(56, usdt(56).address.toUpperCase().replace('0X', '0x'))).toBe(usdt(56))
    expect(payTokenByAddress(42161, ARB_USDC_E)).toBeNull()
    expect(payTokenByAddress(42161, ARB_USDC_E.toLowerCase())).toBeNull()
    expect(payTokenByAddress(10, usdt(56).address)).toBeNull()
  })

  it('permitSupported tablosu (Ek D)', () => {
    expect(permitSupported(1, usdc(1).address)).toBe(true)
    expect(permitSupported(1, usdt(1).address)).toBe(false)
    expect(permitSupported(42161, usdc(42161).address)).toBe(true)
    expect(permitSupported(42161, usdt(42161).address)).toBe(false)
    expect(permitSupported(56, usdc(56).address)).toBe(false)
    expect(permitSupported(56, usdt(56).address)).toBe(false)
    expect(permitSupported(42161, ARB_USDC_E)).toBe(false)
    expect(permitSupported(1, '0x0000000000000000000000000000000000000001')).toBe(false)
  })
})

describe('cow/config alici dogrulamasi', () => {
  it('partnerRecipientCheck gecersiz girdilerde asla firlatmaz, MISSING doner', () => {
    const MISSING = { ok: false, code: 'PARTNER_FEE_RECIPIENT_MISSING' }
    for (const girdi of [
      null,
      HARDHAT_1.toLowerCase(),
      ` ${HARDHAT_1}`,
      HARDHAT_1.slice(2),
      ZeroAddress,
      '0x',
      42,
      {},
    ]) {
      expect(partnerRecipientCheck(girdi)).toEqual(MISSING)
    }
    // varsayilan bagimsiz degiskenle gercek ucret alicisi (Safe) gecerli sayilir
    expect(partnerRecipientCheck()).toEqual({ ok: true, recipient: SAFE_FEE_RECIPIENT })
    expect(partnerRecipientCheck(HARDHAT_1)).toEqual({ ok: true, recipient: HARDHAT_1 })
  })

  it('PARTNER_FEE_RECIPIENT tam olarak 2026-10-21 Safe adresi, EIP-55, sifir degil', () => {
    expect(cfg.PARTNER_FEE_RECIPIENT).toBe(SAFE_FEE_RECIPIENT)
    expect(getAddress(cfg.PARTNER_FEE_RECIPIENT)).toBe(cfg.PARTNER_FEE_RECIPIENT)
    expect(cfg.PARTNER_FEE_RECIPIENT).not.toBe(ZeroAddress)
    expect(cfg.PARTNER_FEE_BPS).toBe(10)
  })

  it('yayin kapisi: .env.production VITE_XSTOCKS_ENABLED=true ise alici zorunlu', () => {
    const metin = fs
      .readFileSync(new URL('../../../.env.production', import.meta.url), 'utf8')
      .replace(/\r/g, '')
    const bayrak = /^VITE_XSTOCKS_ENABLED=(.*)$/m.exec(metin)
    expect(bayrak).not.toBeNull()
    if (bayrak[1].trim() === 'true') {
      expect(partnerRecipientCheck().ok).toBe(true)
    }
  })
})

describe('cow/config sayilar ve kilit nedenleri', () => {
  it('LOCK_REASON tam bes deger ve dondurulmus', () => {
    expect(LOCK_REASON).toEqual({
      PRICE_PROTECTION: 'PRICE_PROTECTION',
      REFERENCE_MISSING: 'REFERENCE_MISSING',
      MARKET_CLOSED: 'MARKET_CLOSED',
      MARKET_UNKNOWN: 'MARKET_UNKNOWN',
      FEE_DEBT: 'FEE_DEBT',
    })
    expect(Object.isFrozen(LOCK_REASON)).toBe(true)
  })

  it('sayi sabitleri tablosu', () => {
    expect(cfg.ORDER_VALIDITY_SEC).toBe(1800)
    expect(cfg.PARTNER_FEE_BPS).toBe(10)
    expect(cfg.SLIPPAGE_BIPS).toBe(50)
    expect(cfg.PRICE_PROTECTION_BPS).toBe(200)
    expect(cfg.NETWORK_FEE_WARN_PCT).toBe(10)
    expect(cfg.COW_MIN_GAP_MS).toBe(2000)
    expect(cfg.PERMIT_GAS_LIMIT).toBe('100000')
    expect(cfg.QUOTE_DEBOUNCE_MS).toBe(600)
    expect(cfg.COW_TIMEOUT_MS).toBe(10000)
    expect(cfg.COW_RETRY_DEFAULT_MS).toBe(1500)
    expect(cfg.POPUP_POLL_MS).toBe(3000)
    expect(cfg.TERMINAL_RETENTION_MS).toBe(7 * 24 * 3600 * 1000)
    expect(cfg.APPROVE_WINDOW_MS).toBe(5 * 60 * 1000)
    expect(cfg.COW_API_BASE).toBe('https://api.cow.fi')
    expect(cfg.ISSUER_ASSET_URL).toBe('https://api.xstocks.fi/api/v2/public/assets/')
    expect(cfg.COW_DOMAIN_NAME).toBe('Gnosis Protocol')
    expect(cfg.COW_DOMAIN_VERSION).toBe('v2')
  })
})

describe('cow/config Faz 3 ATS ucret sabitleri', () => {
  it('ATS_FEE_CHAINS tam olarak [1,56,42161] ve dondurulmus', () => {
    expect([...cfg.ATS_FEE_CHAINS]).toEqual([1, 56, 42161])
    expect(Object.isFrozen(cfg.ATS_FEE_CHAINS)).toBe(true)
    expect([...cfg.ATS_FEE_CHAINS].sort()).toEqual(Object.keys(COW_PATH_BY_CHAIN).map(Number).sort())
  })

  it('ucret sabitleri tablosu', () => {
    expect(cfg.FEE_BSC_CHAIN_ID).toBe(56)
    expect(cfg.FEE_OP_KIND).toBe('cowFee')
    expect(cfg.FEE_DRIFT_BPS).toBe(12500n)
    expect(cfg.FEE_READY_BALANCE_BPS).toBe(12000n)
    expect(cfg.FEE_RETRY_MAX).toBe(6)
    expect(cfg.FEE_RETRY_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
    expect(cfg.FEE_STUCK_MARK_MS).toBe(30 * 24 * 60 * 60 * 1000)
    expect(cfg.FEE_NO_SERVICE_MS).toBe(10 * 60 * 1000)
    expect(cfg.FEE_SETTLE_QUEUE_WAIT_MS).toBe(30_000)
    expect(cfg.FEE_PREPARE_TIMEOUT_MS).toBe(4000)
    expect([...cfg.LOW_NETWORK_FEE_CHAINS]).toEqual([56, 42161])
    expect(Object.isFrozen(cfg.LOW_NETWORK_FEE_CHAINS)).toBe(true)
    expect([...cfg.REFUND_CLAIM_BACKOFF_MS]).toEqual([60_000, 300_000, 1_800_000])
    expect(Object.isFrozen(cfg.REFUND_CLAIM_BACKOFF_MS)).toBe(true)
    expect(cfg.REFUND_CLAIM_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
    expect(cfg.REFUND_POLL_MIN_MS).toBe(60_000)
    expect(cfg.REFUND_APPROVED_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000)
    expect(cfg.REFUND_CLAIMING_STALE_MS).toBe(120_000)
    expect(cfg.REFUND_CLAIM_PATH).toBe('/cow/refund-claim')
  })

  it('LOCK_REASON.FEE_DEBT ve isCowCode', async () => {
    expect(LOCK_REASON.FEE_DEBT).toBe('FEE_DEBT')
    const { isCowCode, cowErrorKey } = await import('./errors')
    expect(isCowCode('FEE_DEBT')).toBe(true)
    expect(cowErrorKey('FEE_DEBT')).toBe('stockTrade.error.FEE_DEBT')
  })
})

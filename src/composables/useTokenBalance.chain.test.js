// Golge bakiye ZINCIR duyarlidir (spec 5.3, 12.2). xStocks AYNI adresi uc zincirde tasir: bir zincirdeki
// bekleyen gonderi (pending_transactions) baska zincirin bakiyesinden dusulmez. chain_id'siz eski kayit ve
// chainId'siz cagri eski davranisla (her zincirde) dusulur. ethers ve chrome.storage saplaniyor; RPC yok.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { XSTOCKS } from '../data/xStocks'

const TSLA = XSTOCKS.find((t) => t.symbol === 'TSLAx')
const CUZDAN = '0x2222222222222222222222222222222222222222'
const NATIVE = '0x0000000000000000000000000000000000000000'

vi.mock('ethers', () => {
  class Contract {
    constructor(address) { this.address = address }
    async balanceOf() { return 10n * 10n ** 18n } // zincirde 10 token
    async decimals() { return 18 }
  }
  return {
    ethers: {
      ZeroAddress: '0x0000000000000000000000000000000000000000',
      JsonRpcProvider: class { async getCode() { return '0x60' } async getBalance() { return 5n * 10n ** 18n } }, // 5 native
      Contract,
      formatUnits: (v, d) => (Number(v) / 10 ** Number(d)).toString(),
      formatEther: (v) => String(Number(v) / 1e18),
    },
  }
})

// Bekleyen TSLAx gonderisi (4 token). chainId verilmezse kayit chain_id TASIMAZ (eski kayit).
const bekleyenToken = (chainId) => ({
  hash: '0xaa',
  from_address: CUZDAN.toLowerCase(),
  receipt_status: 'pending',
  block_timestamp: new Date().toISOString(),
  ...(chainId === undefined ? {} : { chain_id: chainId }),
  erc20_transfers: [{ direction: 'send', token_address: TSLA.address.toLowerCase(), value_formatted: '4' }],
})

// Bekleyen native gonderi: 1 coin + 0,01 ag ucreti.
const bekleyenNative = (chainId) => ({
  hash: '0xbb',
  from_address: CUZDAN.toLowerCase(),
  receipt_status: 'pending',
  block_timestamp: new Date().toISOString(),
  ...(chainId === undefined ? {} : { chain_id: chainId }),
  value: String(10n ** 18n),
  transaction_fee: '0.01',
  erc20_transfers: [],
})

const depo = (liste) => {
  globalThis.chrome = { storage: { local: { get: async () => ({ pending_transactions: liste }) } } }
}

const bakiye = async (token, chainId) => {
  const { useTokenBalance } = await import('./useTokenBalance')
  return useTokenBalance(CUZDAN, token, 'http://rpc', chainId)
}

beforeEach(() => { depo([]) })

describe('golge bakiye - zincir duyarli', () => {
  // Review Focus 1: BSC'deki bekleyen TSLAx gonderisi Ethereum ve Arbitrum bakiyesinden DUSULMEZ.
  it('Review Focus 1: BSC kaydi yalniz BSC bakiyesinden duser, Ethereum ve Arbitrum 10 kalir', async () => {
    depo([bekleyenToken(56)])

    expect(await bakiye(TSLA.address, 56)).toBeCloseTo(6, 9)
    expect(await bakiye(TSLA.address, 1)).toBeCloseTo(10, 9)
    expect(await bakiye(TSLA.address, 42161)).toBeCloseTo(10, 9)
  })

  it('chain_id tasimayan ESKI kayit her zincirde eskisi gibi duser', async () => {
    depo([bekleyenToken(undefined)])

    expect(await bakiye(TSLA.address, 1)).toBeCloseTo(6, 9)
    expect(await bakiye(TSLA.address, 56)).toBeCloseTo(6, 9)
  })

  it('chain_id onaltilik dize ("0x38") ya da onluk dize ("56") olsa da 56 ile eslesir', async () => {
    depo([bekleyenToken('0x38')])
    expect(await bakiye(TSLA.address, 56)).toBeCloseTo(6, 9)
    expect(await bakiye(TSLA.address, 1)).toBeCloseTo(10, 9)

    depo([bekleyenToken('56')])
    expect(await bakiye(TSLA.address, 56)).toBeCloseTo(6, 9)
    expect(await bakiye(TSLA.address, 1)).toBeCloseTo(10, 9)
  })

  it('chainId verilmeyen cagri filtre uygulamaz (geriye donuk guvenli): kayit duser', async () => {
    depo([bekleyenToken(56)])

    expect(await bakiye(TSLA.address, undefined)).toBeCloseTo(6, 9)
  })

  it('native coin de zincir duyarli: BSC gonderisi Ethereum ETH bakiyesinden DUSMEZ', async () => {
    depo([bekleyenNative(56)])

    expect(await bakiye(NATIVE, 56)).toBeCloseTo(5 - 1 - 0.01, 9)
    expect(await bakiye(NATIVE, 1)).toBeCloseTo(5, 9)
  })

  it('ayni zincirdeki ve baska zincirdeki kayitlar birlikte: yalniz eslesen duser', async () => {
    depo([bekleyenToken(56), bekleyenToken(1), bekleyenToken(42161)])

    expect(await bakiye(TSLA.address, 1)).toBeCloseTo(6, 9)
    expect(await bakiye(TSLA.address, 56)).toBeCloseTo(6, 9)
  })
})

describe('bekleyen CoW satiri', () => {
  // Review Focus 5: buildCowOrderPendingSkeleton'in urettigi bicim (USDC send 100 + xStock receive).
  const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
  const cowSatir = (over = {}) => ({
    hash: '0x' + 'ab'.repeat(56),
    cow_uid: '0x' + 'ab'.repeat(56),
    source: 'cow',
    nonce: null,
    from_address: CUZDAN.toLowerCase(),
    to_address: '0x9008d19f58aabd9ed0d60971565aa8510560ab41',
    receipt_status: 'pending',
    block_timestamp: new Date().toISOString(),
    transaction_fee: null,
    chain_id: 56,
    erc20_transfers: [
      { direction: 'send', token_address: USDC_BSC.toLowerCase(), value_formatted: '100' },
      { direction: 'receive', token_address: TSLA.address.toLowerCase(), value_formatted: '0.4' },
    ],
    ...over,
  })

  const satirTutar = (tutar) => cowSatir({ erc20_transfers: [
    { direction: 'send', token_address: USDC_BSC.toLowerCase(), value_formatted: tutar },
    { direction: 'receive', token_address: TSLA.address.toLowerCase(), value_formatted: '0.4' },
  ] })

  it('chainId=56: giden USDC bacagi duser, TEK kez (10 - 4 = 6; cift dusumde 2 olurdu)', async () => {
    depo([satirTutar('4')])
    expect(await bakiye(USDC_BSC, 56)).toBeCloseTo(6, 9)
  })

  it('chainId=56: 100 USDC bekleyen satir bakiyeden 100 duser (zincirde 10 varsa sifira iner, negatif olmaz)', async () => {
    depo([cowSatir()])
    expect(await bakiye(USDC_BSC, 56)).toBeLessThanOrEqual(0)
  })

  it('chainId=1: ayni satir Ethereum bakiyesinden DUSMEZ', async () => {
    depo([cowSatir()])
    expect(await bakiye(USDC_BSC, 1)).toBeCloseTo(10, 9)
  })

  it('chainId verilmezse (eski davranis) duser', async () => {
    depo([satirTutar('4')])
    expect(await bakiye(USDC_BSC, undefined)).toBeCloseTo(6, 9)
  })

  it('receive bacagi (xStock) DUSULMEZ', async () => {
    depo([cowSatir()])
    expect(await bakiye(TSLA.address, 56)).toBeCloseTo(10, 9)
  })

  it("'expired', '1' ve 'cancelled' satir DUSULMEZ", async () => {
    for (const st of ['expired', '1', 'cancelled']) {
      depo([cowSatir({ receipt_status: st })])
      expect(await bakiye(USDC_BSC, 56)).toBeCloseTo(10, 9)
    }
  })

  it('native BNB sorgusunda dusum 0 (transaction_fee null, value yok)', async () => {
    depo([cowSatir()])
    expect(await bakiye(NATIVE, 56)).toBeCloseTo(5, 9)
  })
})

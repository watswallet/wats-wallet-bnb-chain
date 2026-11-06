// A-1 (nihai inceleme): Al yonunde (cikti = bStock) getExpectedOutput'un expectedOutput / minimumReceived
// degerleri UI birimindedir (cuzdandaki bakiye ile ayni olcek). Girdi tarafi zaten toRawSpendAmount ile
// cevriliyordu; cikti HAM kaliyordu ve ekran "Tahmini / En az / birim fiyat / fark uyarisi"ni yanlis
// birimde uretiyordu (SPYB +%0,17, 4:1 bolunmede 4 kat az adet).
import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { MultiChainSwapManager } from './swap'
import { BSTOCK_MULTIPLIER_ERROR } from './bstocksSpend'
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'

const abiCoder = ethers.AbiCoder.defaultAbiCoder()
const SEL_UI_MULTIPLIER = ethers.id('uiMultiplier()').slice(0, 10)
const STOCK = BSTOCKS.find((t) => t.symbol === 'SPYB')
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const ROUTER = '0x9999999999999999999999999999999999999999'
const MUL = 1001730000000000000n

const provider = (mul, { reverts = false } = {}) => ({
  resolveName: async (n) => n,
  call: async (tx) => {
    const sel = (tx.data || '').slice(0, 10)
    if (sel !== SEL_UI_MULTIPLIER) throw new Error(`beklenmeyen cagri: ${sel}`)
    if (reverts) throw new Error('execution reverted')
    return abiCoder.encode(['uint256'], [mul])
  },
})

function manager({ mul, outputAmount, reverts }) {
  const m = new MultiChainSwapManager('0x' + '1'.repeat(64), BSTOCKS_CHAIN_ID)
  m.getProvider = () => provider(mul, { reverts })
  m.isNativeToken = async () => false
  m.getTokenDecimals = async () => 18
  m.estimateSwapGas = async () => ({ totalCostFormatted: '0.001 BNB' })
  m.findBestDexRoute = async (a, b) => ({
    dex: { NAME: 'TestV2', VERSION: 2, ROUTER_ADDRESS: ROUTER, FEE: 25 },
    outputAmount, fee: null, path: [a, b], pools: [],
  })
  m.getPairAddress = async () => { throw new Error('rezerv okumasi yok') }
  return m
}

describe('getExpectedOutput - cikti bStock iken UI birimi (A-1)', () => {
  it('Al: ham 0.5 SPYB, carpan 1.00173 -> expectedOutput UI (0.500865)', async () => {
    const m = manager({ mul: MUL, outputAmount: 5n * 10n ** 17n })
    const q = await m.getExpectedOutput(USDT, STOCK.address, '100', '1')
    expect(q.expectedOutput).toBe('0.500865')
  })

  it('Al: minimumReceived de UI birimine cevrilir (slippage %1)', async () => {
    const m = manager({ mul: MUL, outputAmount: 5n * 10n ** 17n })
    const q = await m.getExpectedOutput(USDT, STOCK.address, '100', '1')
    // ham min = 0.495; UI = 0.495 * 1.00173 = 0.49585635
    expect(q.minimumReceived).toBe('0.49585635')
  })

  it('Al: 4:1 bolunmede adet 4 kat gosterilir', async () => {
    const m = manager({ mul: 4n * 10n ** 18n, outputAmount: 10n ** 18n })
    const q = await m.getExpectedOutput(USDT, STOCK.address, '100', '1')
    expect(q.expectedOutput).toBe('4.0')
  })

  it('Al: exchangeRate UI birimden turetilir', async () => {
    const m = manager({ mul: 4n * 10n ** 18n, outputAmount: 10n ** 18n })
    const q = await m.getExpectedOutput(USDT, STOCK.address, '100', '1')
    expect(q.exchangeRate).toBe('0.040000')
  })

  it('Al: carpan okunamazsa teklif DURUR (sessizce ham gosterilmez)', async () => {
    const m = manager({ mul: MUL, outputAmount: 10n ** 18n, reverts: true })
    await expect(m.getExpectedOutput(USDT, STOCK.address, '100', '1')).rejects.toThrow(BSTOCK_MULTIPLIER_ERROR)
  })

  it('bStock OLMAYAN cikti degismez ve zincire carpan sorulmaz', async () => {
    const DUZ = '0x1111111111111111111111111111111111111111'
    const m = manager({ mul: MUL, outputAmount: 5n * 10n ** 17n, reverts: true })
    const q = await m.getExpectedOutput(USDT, DUZ, '100', '1')
    expect(q.expectedOutput).toBe('0.5')
  })
})

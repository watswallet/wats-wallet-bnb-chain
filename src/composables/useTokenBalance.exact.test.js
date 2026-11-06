// Tam bakiye (atom) okuma: { exact: true } bakiyeyi BigInt atom olarak da dondurur, Number yolu degismez.
// Kiran vaka: 18 ondalikli BSC USDC bakiyesi 0.188405789675366912 Number'a sigmaz (float asagi/yukari oynar).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const CUZDAN = '0x2222222222222222222222222222222222222222'
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
const RAW = 188405789675366912n

vi.mock('ethers', () => {
  class Contract {
    async balanceOf() { return 188405789675366912n }
    async decimals() { return 18 }
  }
  return {
    ethers: {
      ZeroAddress: '0x0000000000000000000000000000000000000000',
      JsonRpcProvider: class { async getCode() { return '0x60' } async getBalance() { return 5n * 10n ** 18n } },
      Contract,
      formatUnits: (v, d) => (Number(v) / 10 ** Number(d)).toString(),
      formatEther: (v) => String(Number(v) / 1e18),
    },
  }
})

const depo = (liste) => {
  globalThis.chrome = { storage: { local: { get: async () => ({ pending_transactions: liste }) } } }
}
const bekleyen = (value) => ({
  hash: '0xaa',
  from_address: CUZDAN.toLowerCase(),
  receipt_status: 'pending',
  block_timestamp: new Date().toISOString(),
  erc20_transfers: [{ direction: 'send', token_address: USDC.toLowerCase(), value_formatted: value }],
})
const oku = async (opts) => {
  const { useTokenBalance } = await import('./useTokenBalance')
  return useTokenBalance(CUZDAN, USDC, 'http://rpc', 56, opts)
}

beforeEach(() => { depo([]) })

describe('useTokenBalance { exact: true }', () => {
  it('atomu BigInt olarak, ondaligi ve Number bakiyeyle birlikte dondurur', async () => {
    const r = await oku({ exact: true })
    expect(r.atoms).toBe(RAW)
    expect(r.decimals).toBe(18)
    expect(typeof r.balance).toBe('number')
  })

  it('secenek yoksa eskisi gibi Number doner', async () => {
    expect(typeof (await oku())).toBe('number')
  })

  it('bekleyen gonderi atomdan dusulur ve atom negatife inmez', async () => {
    depo([bekleyen('0.1')])
    const r = await oku({ exact: true })
    expect(r.atoms).toBe(RAW - 10n ** 17n)
    depo([bekleyen('5')])
    expect((await oku({ exact: true })).atoms).toBe(0n)
  })

  it('bekleyen dusumu Number yuvarlamasiyla atomu bakiyenin USTUNE cikarmaz', async () => {
    depo([bekleyen('0.07')])
    const r = await oku({ exact: true })
    expect(r.atoms <= RAW - 70000000000000000n).toBe(true)
  })
})

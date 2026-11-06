import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Interface, getAddress } from 'ethers'
import { createCowChain, _resetDecimalsCache, CHAIN_READ_TIMEOUT_MS } from './chain'
import { GPV2_VAULT_RELAYER } from './config'
import { PERMIT_ABI } from './permit'

const ABI = [
  'function decimals() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function getCurrentMultiplier() view returns (uint256)',
  ...PERMIT_ABI,
]
const iface = new Interface(ABI)
const TOKEN = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const OWNER = getAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
const STOCK = getAddress('0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48')
const SEP = '0x' + 'ab'.repeat(32)

const revert = () => Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' })
const enc = (fn, values) => iface.encodeFunctionResult(fn, values)
const boom = () => {
  throw new Error('boom')
}

// handler(fnName, args, tx) -> kodlanmis yanit; firlatirsa provider reddeder
function fakeProvider(handler) {
  return {
    call: vi.fn(async (tx) => {
      const parsed = iface.parseTransaction({ data: tx.data })
      return handler(parsed.name, parsed.args, tx)
    }),
  }
}
const hang = () => ({ call: vi.fn(() => new Promise(() => {})) })

const chainOf = (...providers) => createCowChain({ makeProviders: () => providers })

beforeEach(() => _resetDecimalsCache())

describe('readDecimals', () => {
  it('18 ve 6 doner', async () => {
    const p18 = fakeProvider(() => enc('decimals', [18n]))
    const p6 = fakeProvider(() => enc('decimals', [6n]))
    expect(await chainOf(p18).readDecimals(56, TOKEN)).toBe(18)
    expect(await chainOf(p6).readDecimals(1, TOKEN)).toBe(6)
  })

  it('ikinci cagri provider a gitmez (onbellek zincir:adres)', async () => {
    const p = fakeProvider(() => enc('decimals', [6n]))
    const c = chainOf(p)
    await c.readDecimals(1, TOKEN)
    await c.readDecimals(1, TOKEN.toLowerCase())
    expect(p.call).toHaveBeenCalledTimes(1)
    // ayni adres baska zincirde AYRI anahtar
    await c.readDecimals(56, TOKEN)
    expect(p.call).toHaveBeenCalledTimes(2)
  })

  it('aralik disi (255, 37, 2^256-1) ve revert DECIMALS_UNAVAILABLE; hata onbellege girmez', async () => {
    for (const bad of [255n, 37n, 2n ** 256n - 1n]) {
      _resetDecimalsCache()
      const p = fakeProvider(() => enc('decimals', [bad]))
      await expect(chainOf(p).readDecimals(1, TOKEN)).rejects.toMatchObject({ code: 'DECIMALS_UNAVAILABLE' })
    }
    _resetDecimalsCache()
    const p = fakeProvider(() => {
      throw revert()
    })
    await expect(chainOf(p).readDecimals(1, TOKEN)).rejects.toMatchObject({ code: 'DECIMALS_UNAVAILABLE' })

    // hata sonrasi ikinci cagri yeniden dener ve bu sefer basarir
    let n = 0
    const q = fakeProvider(() => {
      n += 1
      if (n === 1) throw revert()
      return enc('decimals', [18n])
    })
    const c = chainOf(q)
    await expect(c.readDecimals(56, TOKEN)).rejects.toMatchObject({ code: 'DECIMALS_UNAVAILABLE' })
    expect(await c.readDecimals(56, TOKEN)).toBe(18)
  })

  it('sinir degerleri 0 ve 36 kabul edilir', async () => {
    expect(await chainOf(fakeProvider(() => enc('decimals', [0n]))).readDecimals(1, TOKEN)).toBe(0)
    _resetDecimalsCache()
    expect(await chainOf(fakeProvider(() => enc('decimals', [36n]))).readDecimals(1, TOKEN)).toBe(36)
  })

  it('gecersiz adres DECIMALS_UNAVAILABLE, provider a gidilmez', async () => {
    const p = fakeProvider(() => enc('decimals', [6n]))
    await expect(chainOf(p).readDecimals(1, 'x')).rejects.toMatchObject({ code: 'DECIMALS_UNAVAILABLE' })
    expect(p.call).not.toHaveBeenCalled()
  })
})

describe('readBalance / readAllowance', () => {
  it('balanceOf: dogru to/data, bigint doner', async () => {
    const p = fakeProvider(() => enc('balanceOf', [12345n]))
    expect(await chainOf(p).readBalance(1, TOKEN, OWNER)).toBe(12345n)
    const tx = p.call.mock.calls[0][0]
    expect(tx.to).toBe(TOKEN)
    expect(tx.data).toBe(iface.encodeFunctionData('balanceOf', [OWNER]))
  })

  it('allowance: spender GPV2_VAULT_RELAYER sabit', async () => {
    const p = fakeProvider(() => enc('allowance', [777n]))
    expect(await chainOf(p).readAllowance(1, TOKEN, OWNER)).toBe(777n)
    const tx = p.call.mock.calls[0][0]
    expect(tx.to).toBe(TOKEN)
    expect(tx.data).toBe(iface.encodeFunctionData('allowance', [OWNER, GPV2_VAULT_RELAYER]))
  })

  it('ilk RPC reddedilir ikincisi cevap verir -> basari', async () => {
    const bad = fakeProvider(boom)
    const good = fakeProvider(() => enc('balanceOf', [5n]))
    expect(await chainOf(bad, good).readBalance(1, TOKEN, OWNER)).toBe(5n)
    expect(bad.call).toHaveBeenCalledTimes(1)
    expect(good.call).toHaveBeenCalledTimes(1)
  })

  it('ikisi de reddedilir -> NETWORK; bos yanit (0x) da NETWORK', async () => {
    await expect(chainOf(fakeProvider(boom), fakeProvider(boom)).readBalance(1, TOKEN, OWNER)).rejects.toMatchObject({ code: 'NETWORK' })
    await expect(chainOf(fakeProvider(boom), fakeProvider(boom)).readAllowance(1, TOKEN, OWNER)).rejects.toMatchObject({ code: 'NETWORK' })
    await expect(chainOf(fakeProvider(() => '0x')).readBalance(1, TOKEN, OWNER)).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('provider listesi bos -> NETWORK', async () => {
    await expect(createCowChain({ makeProviders: () => [] }).readBalance(1, TOKEN, OWNER)).rejects.toMatchObject({ code: 'NETWORK' })
  })

  describe('zaman asimi (fake timer)', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('ikisi de zaman asimi -> TIMEOUT', async () => {
      const pr = chainOf(hang(), hang()).readBalance(1, TOKEN, OWNER)
      const assertion = expect(pr).rejects.toMatchObject({ code: 'TIMEOUT' })
      await vi.advanceTimersByTimeAsync(CHAIN_READ_TIMEOUT_MS * 2 + 10)
      await assertion
    })

    it('biri zaman asimi biri hata -> NETWORK (TIMEOUT yalniz hepsi zaman asimiysa)', async () => {
      const pr = chainOf(hang(), fakeProvider(boom)).readAllowance(1, TOKEN, OWNER)
      const assertion = expect(pr).rejects.toMatchObject({ code: 'NETWORK' })
      await vi.advanceTimersByTimeAsync(CHAIN_READ_TIMEOUT_MS + 10)
      await assertion
    })

    it('ilk RPC zaman asimi ikincisi cevap verir -> basari', async () => {
      const good = fakeProvider(() => enc('balanceOf', [9n]))
      const pr = chainOf(hang(), good).readBalance(1, TOKEN, OWNER)
      await vi.advanceTimersByTimeAsync(CHAIN_READ_TIMEOUT_MS + 10)
      expect(await pr).toBe(9n)
    })
  })
})

describe('readPermitInfo', () => {
  const full = (name) => {
    if (name === 'name') return enc('name', ['USD Coin'])
    if (name === 'version') return enc('version', ['2'])
    if (name === 'nonces') return enc('nonces', [7n])
    if (name === 'DOMAIN_SEPARATOR') return enc('DOMAIN_SEPARATOR', [SEP])
    throw revert()
  }

  it('tam yanit ok:true, nonce BigInt', async () => {
    const r = await chainOf(fakeProvider(full)).readPermitInfo(1, TOKEN, OWNER)
    expect(r).toEqual({ ok: true, name: 'USD Coin', version: '2', nonce: 7n, separator: SEP })
    expect(typeof r.nonce).toBe('bigint')
  })

  it('version() revert -> { ok:false }', async () => {
    const p = fakeProvider((name) => {
      if (name === 'version') throw revert()
      return full(name)
    })
    expect(await chainOf(p).readPermitInfo(56, TOKEN, OWNER)).toEqual({ ok: false })
  })

  it('bos dize name -> { ok:false }; bos dize version de', async () => {
    const p = fakeProvider((name) => (name === 'name' ? enc('name', ['']) : full(name)))
    expect(await chainOf(p).readPermitInfo(1, TOKEN, OWNER)).toEqual({ ok: false })
    const q = fakeProvider((name) => (name === 'version' ? enc('version', ['']) : full(name)))
    expect(await chainOf(q).readPermitInfo(1, TOKEN, OWNER)).toEqual({ ok: false })
  })

  it('hicbiri firlatmaz: tum RPC ler dusuk, gecersiz adres, cozulemez yanit', async () => {
    expect(await chainOf(fakeProvider(boom), fakeProvider(boom)).readPermitInfo(1, TOKEN, OWNER)).toEqual({ ok: false })
    expect(await chainOf(fakeProvider(full)).readPermitInfo(1, 'x', OWNER)).toEqual({ ok: false })
    expect(await chainOf(fakeProvider(full)).readPermitInfo(1, TOKEN, 'y')).toEqual({ ok: false })
    expect(await chainOf(fakeProvider(() => '0x')).readPermitInfo(1, TOKEN, OWNER)).toEqual({ ok: false })
    const bozukMakeProviders = createCowChain({ makeProviders: boom })
    expect(await bozukMakeProviders.readPermitInfo(1, TOKEN, OWNER)).toEqual({ ok: false })
  })

  it('nonces(owner) cagrisi owner i tasir', async () => {
    const p = fakeProvider(full)
    await chainOf(p).readPermitInfo(1, TOKEN, OWNER)
    const datas = p.call.mock.calls.map((c) => c[0].data)
    expect(datas).toContain(iface.encodeFunctionData('nonces', [OWNER]))
  })
})

describe('readMultiplier', () => {
  it('1005714560286254000n doner', async () => {
    const p = fakeProvider(() => enc('getCurrentMultiplier', [1005714560286254000n]))
    expect(await chainOf(p).readMultiplier(1, STOCK)).toBe(1005714560286254000n)
    expect(p.call.mock.calls[0][0].to).toBe(STOCK)
  })

  it('revert / 0 / bos yanit / gecersiz adres / makeProviders hatasi -> null (firlatmaz)', async () => {
    const rv = fakeProvider(() => {
      throw revert()
    })
    expect(await chainOf(rv).readMultiplier(1, STOCK)).toBeNull()
    expect(await chainOf(fakeProvider(() => enc('getCurrentMultiplier', [0n]))).readMultiplier(1, STOCK)).toBeNull()
    expect(await chainOf(fakeProvider(() => '0x')).readMultiplier(1, STOCK)).toBeNull()
    expect(await chainOf(rv).readMultiplier(1, 'x')).toBeNull()
    expect(await createCowChain({ makeProviders: boom }).readMultiplier(1, STOCK)).toBeNull()
  })
})

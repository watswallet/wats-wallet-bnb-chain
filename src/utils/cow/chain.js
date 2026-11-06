// CoW salt-okur zincir cagrilari (spec 6.4 adim 1-3, 6.6, K5, K8): ondalik, bakiye, allowance, permit bilgisi,
// carpan. Arka plan baglami icindir; popup ile AYRI JS baglami oldugundan stockBalances.js carpan onbellegi
// KULLANILMAZ. Bagimlilik enjekte edilir (makeProviders), agsiz test edilir.
// Guvenlik degismezi 1: allowance harcayicisi YALNIZ GPV2_VAULT_RELAYER sabitidir, cagirici veremez.
// Interface nesneleri TEMBEL kurulur (modul duzeyinde new Interface yok: kismi vi.mock('ethers') testleri bozulmasin).
import { JsonRpcProvider, Interface, getAddress } from 'ethers'
import { rpcUrlsOf } from '../vm'
import supportedChains from '../../data/supportedChains'
import { GPV2_VAULT_RELAYER } from './config'
import { codedError } from './errors'
import { PERMIT_ABI } from './permit'

export const CHAIN_READ_TIMEOUT_MS = 6000

const ERC20_ABI = [
  // uint256 olarak cozulur: aralik kontrolu bu modulde (uint8 tasmasi ethers'a birakilmaz)
  'function decimals() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner,address spender) view returns (uint256)',
  'function getCurrentMultiplier() view returns (uint256)',
]

let _iface = null
const iface = () => (_iface ??= new Interface([...ERC20_ABI, ...PERMIT_ABI]))

const decimalsCache = new Map()
/** Yalniz test. */
export const _resetDecimalsCache = () => decimalsCache.clear()

const TIMED_OUT = Symbol('timedOut')

const providerCache = new Map()
// Varsayilan: o zincirin ilk 2 RPC'si, staticNetwork (eth_chainId turu yok; stockBalances ile ayni kalip).
function defaultMakeProviders(chainId) {
  const id = Number(chainId)
  if (providerCache.has(id)) return providerCache.get(id)
  const kayit = supportedChains.find((c) => Number(c.chainId) === id)
  const list = rpcUrlsOf(kayit)
    .slice(0, 2)
    .map((url) => new JsonRpcProvider(url, { chainId: id, name: String(id) }, { staticNetwork: true }))
  providerCache.set(id, list)
  return list
}

/** Provider cagrisi + zaman asimi; zaman asiminda TIMED_OUT doner, hatada firlatir. */
async function callWithTimeout(provider, tx, timeoutMs) {
  let timer
  const zamanAsimi = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs)
  })
  try {
    return await Promise.race([provider.call(tx), zamanAsimi])
  } finally {
    clearTimeout(timer)
  }
}

export function createCowChain({ makeProviders = defaultMakeProviders, timeoutMs = CHAIN_READ_TIMEOUT_MS } = {}) {
  /**
   * Saglayicilari sirayla dener; decode(raw) firlatirsa o saglayici da dusmus sayilir.
   * Hepsi dusunce: TIMEOUT yalniz HEPSI zaman asimiysa, aksi NETWORK.
   */
  async function readVia(chainId, to, data, decode) {
    const providers = makeProviders(chainId) ?? []
    let timeouts = 0
    for (const provider of providers) {
      try {
        const raw = await callWithTimeout(provider, { to, data }, timeoutMs)
        if (raw === TIMED_OUT) {
          timeouts += 1
          continue
        }
        return decode(raw)
      } catch {
        // sonraki RPC
      }
    }
    throw codedError(providers.length > 0 && timeouts === providers.length ? 'TIMEOUT' : 'NETWORK')
  }

  const call = (chainId, to, fn, args, decode) => readVia(chainId, to, iface().encodeFunctionData(fn, args), decode)
  const first = (fn) => (raw) => {
    const r = iface().decodeFunctionResult(fn, raw)
    return r[0]
  }

  async function readDecimals(chainId, token) {
    let adres
    try {
      adres = getAddress(token)
    } catch {
      throw codedError('DECIMALS_UNAVAILABLE')
    }
    const key = `${Number(chainId)}:${adres.toLowerCase()}`
    if (decimalsCache.has(key)) return decimalsCache.get(key)
    let value
    try {
      value = await call(chainId, adres, 'decimals', [], (raw) => {
        const v = first('decimals')(raw)
        // yanlis olcek 10^12 hata demektir: aralik disi okunamamis sayilir
        if (typeof v !== 'bigint' || v < 0n || v > 36n) throw new Error('decimals range')
        return Number(v)
      })
    } catch {
      throw codedError('DECIMALS_UNAVAILABLE')
    }
    decimalsCache.set(key, value)
    return value
  }

  async function readBalance(chainId, token, owner) {
    let t
    let o
    try {
      t = getAddress(token)
      o = getAddress(owner)
    } catch {
      throw codedError('INVALID_REQUEST')
    }
    return call(chainId, t, 'balanceOf', [o], first('balanceOf'))
  }

  async function readAllowance(chainId, token, owner) {
    let t
    let o
    try {
      t = getAddress(token)
      o = getAddress(owner)
    } catch {
      throw codedError('INVALID_REQUEST')
    }
    // harcayici SABIT (degismez 1)
    return call(chainId, t, 'allowance', [o, GPV2_VAULT_RELAYER], first('allowance'))
  }

  async function readPermitInfo(chainId, token, owner) {
    try {
      const t = getAddress(token)
      const o = getAddress(owner)
      const dize = (fn) => (raw) => {
        const v = first(fn)(raw)
        if (typeof v !== 'string' || v.length === 0) throw new Error('bos dize')
        return v
      }
      const [name, version, nonce, separator] = await Promise.all([
        call(chainId, t, 'name', [], dize('name')),
        call(chainId, t, 'version', [], dize('version')),
        call(chainId, t, 'nonces', [o], first('nonces')),
        call(chainId, t, 'DOMAIN_SEPARATOR', [], (raw) => {
          const v = first('DOMAIN_SEPARATOR')(raw)
          if (typeof v !== 'string' || !/^0x[0-9a-f]{64}$/i.test(v)) throw new Error('separator')
          return v
        }),
      ])
      if (typeof nonce !== 'bigint') return { ok: false }
      return { ok: true, name, version, nonce, separator }
    } catch {
      return { ok: false }
    }
  }

  async function readMultiplier(chainId, stockAddress) {
    try {
      const s = getAddress(stockAddress)
      const v = await call(chainId, s, 'getCurrentMultiplier', [], first('getCurrentMultiplier'))
      return typeof v === 'bigint' && v > 0n ? v : null
    } catch {
      return null
    }
  }

  return { readDecimals, readBalance, readAllowance, readPermitInfo, readMultiplier }
}

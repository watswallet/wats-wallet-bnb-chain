// stockBalances: zincir basina TEK Multicall3 ile bakiye + carpan okuma ve carpan onbellegi.
// RPC yok: saglayici `call({ to, data })` taklit eder (aggregate3 girdisini cozer, tablodan yanitlar).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Interface, toBeHex } from 'ethers'
import { BSTOCKS } from '../data/bStocks'
import { XSTOCKS } from '../data/xStocks'
import { stockEntry } from './tokenizedStocks'
import { yorumsuz } from '../test-utils/kaynakTarama'
import {
  MULTICALL3_ADDRESS, MULTIPLIER_TTL_MS, MULTIPLIER_FETCH_TIMEOUT_MS, encodeAggregate3, decodeAggregate3,
  multiplierFor, rememberMultiplier, _resetMultiplierCache,
  readStockBalances, ensureMultipliers, ensureMultipliersFor,
} from './stockBalances'

const ERC20 = new Interface([
  'function balanceOf(address owner) view returns (uint256)',
  'function balanceOfUI(address owner) view returns (uint256)',
  'function getCurrentMultiplier() view returns (uint256)',
])
const MC = new Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
])
const word = (n) => toBeHex(n, 32)

// Tablo anahtari `${adres kucuk harf}:${fonksiyon}`; deger bigint ya da 'revert'. Tabloda olmayan cagri da revert eder.
function fakeProvider(table) {
  const calls = []
  return {
    calls,
    async call({ to, data }) {
      expect(to).toBe(MULTICALL3_ADDRESS)
      const [subs] = MC.decodeFunctionData('aggregate3', data)
      calls.push(subs.map((s) => ({ target: s[0], fn: ERC20.parseTransaction({ data: s[2] }).name })))
      const out = subs.map((s) => {
        const fn = ERC20.parseTransaction({ data: s[2] }).name
        const rule = table[`${s[0].toLowerCase()}:${fn}`]
        if (rule === undefined || rule === 'revert') return [false, '0x']
        return [true, word(rule)]
      })
      return MC.encodeFunctionResult('aggregate3', [out])
    },
  }
}

const OWNER = '0x1111111111111111111111111111111111111111'
const key = (address, fn) => `${address.toLowerCase()}:${fn}`
const row = (chainId, address) => stockEntry(chainId, address)
const TSLA = XSTOCKS.find((s) => s.symbol === 'TSLAx')
const NVDA = XSTOCKS.find((s) => s.symbol === 'NVDAx')
const GOOGLB = BSTOCKS.find((s) => s.symbol === 'GOOGLB')

beforeEach(() => { _resetMultiplierCache() })

describe('readStockBalances - xStocks (Ethereum)', () => {
  it('TEK Multicall3 cagrisi; her xStock icin balanceOf + getCurrentMultiplier; okunamayan bakiye null (0 DEGIL)', async () => {
    const provider = fakeProvider({
      [key(TSLA.address, 'balanceOf')]: 2_500000000000000000n,
      [key(TSLA.address, 'getCurrentMultiplier')]: 1_000000000000000000n,
      [key(NVDA.address, 'balanceOf')]: 'revert',
      [key(NVDA.address, 'getCurrentMultiplier')]: 1001701196801074000n,
    })

    const map = await readStockBalances({ chainId: 1, owner: OWNER, entries: [row(1, TSLA.address), row(1, NVDA.address)], provider, now: 1000 })

    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0].map((c) => c.fn)).toEqual(['balanceOf', 'getCurrentMultiplier', 'balanceOf', 'getCurrentMultiplier'])
    expect(map.get(TSLA.address.toLowerCase())).toEqual({ balance: 2_500000000000000000n, multiplier: 1_000000000000000000n })
    // Review Focus 2: okuma dustu -> bakiye "bilinmiyor" (null), 0 degil; carpan yine de bilinir.
    expect(map.get(NVDA.address.toLowerCase())).toEqual({ balance: null, multiplier: 1001701196801074000n })
  })

  // Review Focus 1: ayni adres uc zincirde; onbellek zincir+adres anahtarli.
  it('Review Focus 1: carpan onbellegi zincir+adres anahtarli (baska zincirdeki ayni adres AYRI kayit)', async () => {
    const provider = fakeProvider({
      [key(NVDA.address, 'balanceOf')]: 1n,
      [key(NVDA.address, 'getCurrentMultiplier')]: 1001701196801074000n,
    })

    await readStockBalances({ chainId: 1, owner: OWNER, entries: [row(1, NVDA.address)], provider, now: 1000 })

    expect(multiplierFor(1, NVDA.address, 1000)).toBe(1001701196801074000n)
    expect(multiplierFor(56, NVDA.address, 1000)).toBeNull()
    expect(multiplierFor(42161, NVDA.address, 1000)).toBeNull()
    expect(multiplierFor(137, NVDA.address, 1000)).toBeNull()
  })

  // Review Focus 2: onbellek 60 sn'yi asarsa carpan "bilinmiyor" olur.
  it('Review Focus 2: carpan 60 sn gecerli, dolunca null; saat geriye alinirsa da null', () => {
    rememberMultiplier(1, TSLA.address, 10n ** 18n, 1000)

    expect(MULTIPLIER_TTL_MS).toBe(60_000)
    expect(multiplierFor(1, TSLA.address, 1000 + MULTIPLIER_TTL_MS - 1)).toBe(10n ** 18n)
    expect(multiplierFor(1, TSLA.address, 1000 + MULTIPLIER_TTL_MS)).toBeNull()

    rememberMultiplier(1, TSLA.address, 10n ** 18n, 5000)
    expect(multiplierFor(1, TSLA.address, 4999)).toBeNull() // saat geri alindi: negatif sure gecersiz
  })

  it('Review Focus 2: getCurrentMultiplier 0 ya da revert ise carpan bilinmiyor ve onbellege YAZILMAZ', async () => {
    const sifir = fakeProvider({ [key(TSLA.address, 'balanceOf')]: 1n, [key(TSLA.address, 'getCurrentMultiplier')]: 0n })
    const m1 = await readStockBalances({ chainId: 1, owner: OWNER, entries: [row(1, TSLA.address)], provider: sifir, now: 10 })
    expect(m1.get(TSLA.address.toLowerCase()).multiplier).toBeNull()
    expect(multiplierFor(1, TSLA.address, 10)).toBeNull()

    const revert = fakeProvider({ [key(TSLA.address, 'balanceOf')]: 1n, [key(TSLA.address, 'getCurrentMultiplier')]: 'revert' })
    const m2 = await readStockBalances({ chainId: 1, owner: OWNER, entries: [row(1, TSLA.address)], provider: revert, now: 10 })
    expect(m2.get(TSLA.address.toLowerCase())).toEqual({ balance: 1n, multiplier: null })
    expect(multiplierFor(1, TSLA.address, 10)).toBeNull()
  })

  it('bos giris: ag cagrisi YOK', async () => {
    const provider = fakeProvider({})
    const map = await readStockBalances({ chainId: 1, owner: OWNER, entries: [], provider })
    expect(map.size).toBe(0)
    expect(provider.calls).toHaveLength(0)
  })

  it('Multicall3 cagrisinin KENDISI duserse FIRLATIR (cagiran o zincirin satirlarini tire yapar)', async () => {
    await expect(readStockBalances({
      chainId: 1, owner: OWNER, entries: [row(1, TSLA.address)],
      provider: { call: async () => { throw new Error('ETIMEDOUT') } },
    })).rejects.toThrow(/ETIMEDOUT/)
  })

  it('sonuc sayisi beklenenle uyusmazsa FIRLATIR (kisa yanit sessizce eksik bakiye uretmez)', async () => {
    const kisa = { call: async () => MC.encodeFunctionResult('aggregate3', [[[true, word(1n)]]]) }
    await expect(readStockBalances({ chainId: 1, owner: OWNER, entries: [row(1, TSLA.address)], provider: kisa }))
      .rejects.toThrow(/uyusmuyor/)
  })
})

describe('readStockBalances - bStocks (BSC, balanceOfUI)', () => {
  it('bStock icin balanceOfUI; UI revert ederse ikinci turda balanceOf; bStock icin carpan OKUNMAZ', async () => {
    const A = BSTOCKS[0]
    const B = BSTOCKS[1]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provider = fakeProvider({
      [key(A.address, 'balanceOfUI')]: 1_000478058978107511n,
      [key(B.address, 'balanceOfUI')]: 'revert',
      [key(B.address, 'balanceOf')]: 7n,
    })

    const map = await readStockBalances({ chainId: 56, owner: OWNER, entries: [row(56, A.address), row(56, B.address)], provider })

    expect(provider.calls).toHaveLength(2)
    expect(provider.calls[0].map((c) => c.fn)).toEqual(['balanceOfUI', 'balanceOfUI'])
    expect(provider.calls[1].map((c) => c.fn)).toEqual(['balanceOf'])
    expect(map.get(A.address.toLowerCase())).toEqual({ balance: 1_000478058978107511n, multiplier: null })
    expect(map.get(B.address.toLowerCase()).balance).toBe(7n)
    warn.mockRestore()
  })

  it('yedek tur da duserse bakiye null kalir ve FIRLATMAZ', async () => {
    const A = BSTOCKS[0]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provider = fakeProvider({ [key(A.address, 'balanceOfUI')]: 'revert' })
    const gercek = provider.call
    let tur = 0
    provider.call = async (arg) => { tur += 1; if (tur === 2) throw new Error('yedek dustu'); return gercek(arg) }

    const map = await readStockBalances({ chainId: 56, owner: OWNER, entries: [row(56, A.address)], provider })

    expect(map.get(A.address.toLowerCase()).balance).toBeNull()
    warn.mockRestore()
  })
})

// FIN-cekirdek-7: BSC'de bStock + xStock AYNI cagrida. bStock 1, xStock 2 cagri tukettiginden dizin kaymasi
// (balanceAt / multiplierAt) ve yanlis okuma fonksiyonu yalniz karisik giriste gorunur. Hisseler katalogdan
// secilir (G2); sira bilerek bStock, xStock, bStock, xStock.
describe('readStockBalances - karisik giris (BSC: bStock + xStock ayni cagrida)', () => {
  const bscXstocks = XSTOCKS.filter((s) => s.chains.includes(56))
  const [B1, B2] = BSTOCKS
  const [X1, X2] = bscXstocks

  it('her token DOGRU fonksiyonla okunur (bStock balanceOfUI, xStock balanceOf + getCurrentMultiplier) ve dogru tokene eslenir', async () => {
    expect(bscXstocks.length).toBeGreaterThanOrEqual(2)
    // Tabloda YALNIZ dogru fonksiyon tanimli: yanlis fonksiyon cagrilirsa revert -> bakiye null olur ve test kirmizi.
    const provider = fakeProvider({
      [key(B1.address, 'balanceOfUI')]: 11n,
      [key(X1.address, 'balanceOf')]: 22n,
      [key(X1.address, 'getCurrentMultiplier')]: 1_005714560286254000n,
      [key(B2.address, 'balanceOfUI')]: 33n,
      [key(X2.address, 'balanceOf')]: 44n,
      [key(X2.address, 'getCurrentMultiplier')]: 1_001701196801074000n,
    })
    const entries = [row(56, B1.address), row(56, X1.address), row(56, B2.address), row(56, X2.address)]

    const map = await readStockBalances({ chainId: 56, owner: OWNER, entries, provider, now: 1000 })

    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0].map((c) => [c.target.toLowerCase(), c.fn])).toEqual([
      [B1.address.toLowerCase(), 'balanceOfUI'],
      [X1.address.toLowerCase(), 'balanceOf'],
      [X1.address.toLowerCase(), 'getCurrentMultiplier'],
      [B2.address.toLowerCase(), 'balanceOfUI'],
      [X2.address.toLowerCase(), 'balanceOf'],
      [X2.address.toLowerCase(), 'getCurrentMultiplier'],
    ])
    expect(map.get(B1.address.toLowerCase())).toEqual({ balance: 11n, multiplier: null })
    expect(map.get(X1.address.toLowerCase())).toEqual({ balance: 22n, multiplier: 1_005714560286254000n })
    expect(map.get(B2.address.toLowerCase())).toEqual({ balance: 33n, multiplier: null })
    expect(map.get(X2.address.toLowerCase())).toEqual({ balance: 44n, multiplier: 1_001701196801074000n })
    // yalniz xStock carpani onbellege girer
    expect(multiplierFor(56, X1.address, 1000)).toBe(1_005714560286254000n)
    expect(multiplierFor(56, B1.address, 1000)).toBeNull()
  })
})

describe('ensureMultipliers ve ensureMultipliersFor', () => {
  it('eksik carpan TEK cagriyla doldurulur; onbellekte olan tekrar sorulmaz', async () => {
    const provider = fakeProvider({
      [key(TSLA.address, 'getCurrentMultiplier')]: 1_000000000000000000n,
      [key(NVDA.address, 'getCurrentMultiplier')]: 'revert',
    })

    await ensureMultipliers({ chainId: 1, addresses: [TSLA.address, NVDA.address], provider, now: 5 })
    expect(provider.calls).toHaveLength(1)
    expect(multiplierFor(1, TSLA.address, 5)).toBe(10n ** 18n)
    expect(multiplierFor(1, NVDA.address, 5)).toBeNull()

    await ensureMultipliers({ chainId: 1, addresses: [TSLA.address, NVDA.address], provider, now: 6 })
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls[1]).toHaveLength(1) // yalniz eksik olan (NVDA) soruldu
  })

  it('Hisseler Multicall i doldurdugu carpan Varliklar icin YENIDEN sorulmaz', async () => {
    const provider = fakeProvider({ [key(TSLA.address, 'balanceOf')]: 1n, [key(TSLA.address, 'getCurrentMultiplier')]: 10n ** 18n })
    await readStockBalances({ chainId: 1, owner: OWNER, entries: [row(1, TSLA.address)], provider, now: 1000 })

    const sonra = fakeProvider({})
    await ensureMultipliersFor([{ chainId: 1, address: TSLA.address }], { provider: sonra, now: 1000 })

    expect(sonra.calls).toHaveLength(0)
  })

  it('ensureMultipliersFor yalniz xStock sorar: bStock, native ve katalog disi zincir elenir', async () => {
    const provider = fakeProvider({ [key(TSLA.address, 'getCurrentMultiplier')]: 10n ** 18n })

    await ensureMultipliersFor([
      { chainId: 56, address: GOOGLB.address },
      { chainId: 1, address: '0x0000000000000000000000000000000000000000' },
      { chainId: 1, address: TSLA.address },
      { chainId: 137, address: TSLA.address }, // Review Focus 1: Polygon'daki ayni adres hisse SAYILMAZ
    ], { provider })

    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]).toHaveLength(1)
  })

  it('xStock yoksa HICBIR ag istegi yapilmaz; RPC adresi yoksa sessizce atlanir', async () => {
    const provider = fakeProvider({})
    await ensureMultipliersFor([{ chainId: 56, address: GOOGLB.address }], { provider })
    expect(provider.calls).toHaveLength(0)

    await expect(ensureMultipliersFor([{ chainId: 1, address: TSLA.address }], { rpcFor: () => null })).resolves.toBeUndefined()
  })

  it('Review Focus 2: okuma hatasi YUTULUR, uyari yazar ve carpan bilinmez kalir', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await ensureMultipliersFor([{ chainId: 1, address: TSLA.address }], { provider: { call: async () => { throw new Error('x') } } })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(multiplierFor(1, TSLA.address)).toBeNull()
    warn.mockRestore()
  })

  it('T14-GAP-1: asili RPC turu tutmaz; zaman asiminda uyari yazilir ve carpan bilinmez kalir', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const asili = { call: () => new Promise(() => {}) }
      let bitti = false
      const tur = ensureMultipliersFor([{ chainId: 1, address: TSLA.address }], { provider: asili }).then(() => { bitti = true })

      await vi.advanceTimersByTimeAsync(MULTIPLIER_FETCH_TIMEOUT_MS - 1)
      expect(bitti).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await tur
      expect(bitti).toBe(true)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(multiplierFor(1, TSLA.address)).toBeNull()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      warn.mockRestore()
      vi.useRealTimers()
    }
  })

  it('T14-GAP-1: hizli okuma bitince zaman asimi sayaci TEMIZLENIR (artakalan zamanlayici yok)', async () => {
    vi.useFakeTimers()
    try {
      const provider = fakeProvider({ [key(TSLA.address, 'getCurrentMultiplier')]: 10n ** 18n })
      await ensureMultipliersFor([{ chainId: 1, address: TSLA.address }], { provider, now: 1 })
      expect(multiplierFor(1, TSLA.address, 1)).toBe(10n ** 18n)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('T14-GAP-1: bir zincir asili olsa da hizli zincirin carpani yazilir', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const [a, b] = TSLA.chains
      const hizli = fakeProvider({ [key(TSLA.address, 'getCurrentMultiplier')]: 10n ** 18n })
      const provider = { call: (tx) => (hizli.calls.length === 0 ? hizli.call(tx) : new Promise(() => {})) }
      const tur = ensureMultipliersFor([{ chainId: a, address: TSLA.address }, { chainId: b, address: TSLA.address }], { provider, now: 1 })
      await vi.advanceTimersByTimeAsync(MULTIPLIER_FETCH_TIMEOUT_MS)
      await tur
      expect(multiplierFor(a, TSLA.address, 1)).toBe(10n ** 18n)
      expect(multiplierFor(b, TSLA.address, 1)).toBeNull()
    } finally {
      warn.mockRestore()
      vi.useRealTimers()
    }
  })

  // G4 (kararlar): ekleme testleri; mutasyon O ve P bunlar olmadan yasiyordu.
  it('RPC adresi yoksa o zincir SESSIZCE atlanir: ag kurulmaya calisilmaz, uyari de yazilmaz', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await ensureMultipliersFor([{ chainId: 1, address: TSLA.address }], { rpcFor: () => null })

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('Review Focus 1: ayni xStock iki zincirde ise HER zincir icin AYRI Multicall3 cagrisi ve ayri onbellek kaydi', async () => {
    const [a, b] = TSLA.chains
    const provider = fakeProvider({ [key(TSLA.address, 'getCurrentMultiplier')]: 10n ** 18n })

    await ensureMultipliersFor([{ chainId: a, address: TSLA.address }, { chainId: b, address: TSLA.address }], { provider, now: 7 })

    expect(provider.calls).toHaveLength(2)
    expect(multiplierFor(a, TSLA.address, 7)).toBe(10n ** 18n)
    expect(multiplierFor(b, TSLA.address, 7)).toBe(10n ** 18n)
  })
})

describe('Multicall3 kodlama', () => {
  it('aggregate3 secici 0x82ad56cb; cozme gidis-donus', () => {
    const data = encodeAggregate3([{ target: TSLA.address, allowFailure: true, callData: '0x70a08231' + '0'.repeat(64) }])
    expect(data.slice(0, 10)).toBe('0x82ad56cb')
    expect(decodeAggregate3(MC.encodeFunctionResult('aggregate3', [[[true, '0x1234']]]))).toEqual([{ success: true, returnData: '0x1234' }])
  })
})

describe('kaynak kilitleri', () => {
  const kod = yorumsuz(readFileSync(new URL('./stockBalances.js', import.meta.url), 'utf8'))

  it('okuma fonksiyonu secimi hasUiMultiplier ile verilir (useTokenBalance ile AYNI karar), isBStock ile DEGIL', () => {
    expect(kod).toContain('hasUiMultiplier(chainId, entry.address)')
    expect(kod).not.toMatch(/\bisBStock\b/)
  })

  it('ethers kismi mock olsa bile modul YUKLENIR: Interface ilk kullanimda kurulur', async () => {
    // Modul duzeyinde `new Interface` kismi `vi.mock('ethers')` yapan Token / Home testlerini import
    // aninda dusururdu (nativeAsset.js ile ayni sinif hata).
    vi.resetModules()
    vi.doMock('ethers', () => ({ JsonRpcProvider: class {} }))
    try {
      await expect(import('./stockBalances')).resolves.toHaveProperty('readStockBalances')
    } finally {
      vi.doUnmock('ethers')
      vi.resetModules()
    }
  })
})

// useIssuerSwitch -- Al/Sat ekraninda bStocks <-> xStocks gecisi (spec 5.3, TK13).
// Kritik sozlesme: secim YALNIZ katalog satirindan; cuzdanin aktif agi DEGISMEZ (applyNetworkChange hic cagrilmaz);
// ref yazilir ve ekran olayla (onSwitched) tutar/teklif/odeme tokenini sifirlar.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

const applyNetworkChange = vi.hoisted(() => vi.fn())
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: (...a) => applyNetworkChange(...a) }))

import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { ALL_CHAINS } from '../data/chains'
import { companyRows } from '../utils/stocks/stockCompanies'
import { defaultPayToken } from '../utils/stockTrade'
import { useIssuerSwitch, refOfRow } from './useIssuerSwitch'

const chain = (id) => ALL_CHAINS.find((c) => c.chainId === id)
const rowsOf = (underlying) => companyRows(underlying, { xstocksEnabled: true })
const rowFor = (underlying, issuer, chainId) =>
  rowsOf(underlying).find((r) => r.issuer === issuer && (chainId === undefined || r.chainId === chainId))

let network
let crypto

function openRow(row) {
  crypto.selected_token_ref = refOfRow(row)
  network.currentNetwork = chain(row.chainId)
}

beforeEach(() => {
  globalThis.chrome = {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
    runtime: { sendMessage: vi.fn(async () => ({})) },
  }
  setActivePinia(createPinia())
  network = networkStore()
  crypto = cryptoStore()
  applyNetworkChange.mockReset()
  applyNetworkChange.mockImplementation(async (c) => {
    network.currentNetwork = c
    return true
  })
})

describe('refOfRow', () => {
  it('Home.openStock ile ayni sekil: id, chainId, address, decimals, symbol', () => {
    const row = rowFor('TSLA', 'bstocks')
    expect(refOfRow(row)).toEqual({
      id: row.coingeckoId, chainId: row.chainId, address: row.address, decimals: row.decimals, symbol: row.symbol,
    })
  })
})

describe('options', () => {
  it('bayrak acik, BSC bStock: iki secenek (bStocks once)', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const sw = useIssuerSwitch({})
    expect(sw.options.value.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks'])
    expect(sw.selected.value).toBe('bstocks')
  })

  it('bayrak kapali: tek secenek, secici gizlenir', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const sw = useIssuerSwitch({ xstocksEnabled: false })
    expect(sw.options.value).toHaveLength(1)
  })

  it('katalogda olmayan ref -> bos secenek ve pick reddedilir', async () => {
    crypto.selected_token_ref = {
      id: 'x', chainId: 56, address: '0x000000000000000000000000000000000000dEaD', decimals: 18, symbol: 'FAKE',
    }
    const sw = useIssuerSwitch({})
    expect(sw.options.value).toEqual([])
    const r = await sw.pick('xstocks')
    expect(r.ok).toBe(false)
    expect(applyNetworkChange).not.toHaveBeenCalled()
  })
})

describe('pick -- ayni zincir', () => {
  const pair = ['TSLA', 'NVDA', 'AMZN', 'MSFT', 'CRCL', 'MSTR', 'SPY'].find(
    (u) => rowFor(u, 'bstocks') && rowFor(u, 'xstocks', rowFor(u, 'bstocks').chainId),
  )

  it('BSC (ya da bStock zincirinde xStock bulunan) cift bulunur', () => {
    expect(pair, 'bStock ile ayni zincirde xStock cifti yok').toBeTruthy()
  })

  it('ag degisimi cagrilmaz, ref hedef katalog satirina yazilir, onSwitched dolu veriyle atesler', async () => {
    const b = rowFor(pair, 'bstocks')
    const x = rowFor(pair, 'xstocks', b.chainId)
    openRow(b)
    const onSwitched = vi.fn()
    const sw = useIssuerSwitch({ onSwitched })
    const r = await sw.pick('xstocks')
    expect(r).toMatchObject({ ok: true, changed: true })
    expect(applyNetworkChange).not.toHaveBeenCalled()
    expect(crypto.selected_token_ref).toEqual(refOfRow(x))
    expect(crypto.selected_token_id).toBe(x.coingeckoId)
    expect(onSwitched).toHaveBeenCalledTimes(1)
    expect(onSwitched.mock.calls[0][0]).toEqual({ issuer: 'xstocks', row: x, payToken: defaultPayToken(x.chainId) })
    expect(sw.selected.value).toBe('xstocks')
  })

  it('ayni ihracciyi secmek no-op: ref ve olay degismez', async () => {
    const b = rowFor('NVDA', 'bstocks')
    openRow(b)
    const before = { ...crypto.selected_token_ref }
    const onSwitched = vi.fn()
    const sw = useIssuerSwitch({ onSwitched })
    const r = await sw.pick('bstocks')
    expect(r).toMatchObject({ ok: true, changed: false })
    expect(crypto.selected_token_ref).toEqual(before)
    expect(onSwitched).not.toHaveBeenCalled()
  })
})

describe('pick -- yalniz ayni ag (kullanici karari 2026-10-28)', () => {
  // AAPL / GOOGL / QQQ: xStock yalniz Ethereum, bStock BSC.
  const ETH_ONLY = ['AAPL', 'GOOGL', 'QQQ']

  it.each(ETH_ONLY)('%s: Ethereum xStocks sayfasi -> bStocks pasif, pick reddedilir, secim ve ag degismez', (u) => {
    const x = rowFor(u, 'xstocks')
    openRow(x)
    const onSwitched = vi.fn()
    const sw = useIssuerSwitch({ onSwitched })
    const b = sw.options.value.find((o) => o.issuer === 'bstocks')
    expect(b.available).toBe(false)
    expect(sw.options.value.find((o) => o.issuer === 'xstocks').available).toBe(true)
    const before = { ...crypto.selected_token_ref }
    expect(sw.pick('bstocks')).toMatchObject({ ok: false, reason: 'not-on-network' })
    expect(crypto.selected_token_ref).toEqual(before)
    expect(onSwitched).not.toHaveBeenCalled()
    expect(applyNetworkChange).not.toHaveBeenCalled()
    expect(network.currentNetwork.chainId).toBe(1)
  })

  it.each(ETH_ONLY)('%s: BSC bStocks sayfasi, xStocks BSC satiri yok -> xStocks pasif, pick reddedilir', (u) => {
    const b = rowFor(u, 'bstocks')
    expect(rowFor(u, 'xstocks', 56)).toBeUndefined()
    openRow(b)
    const sw = useIssuerSwitch({})
    expect(sw.options.value.find((o) => o.issuer === 'xstocks').available).toBe(false)
    const before = { ...crypto.selected_token_ref }
    expect(sw.pick('xstocks')).toMatchObject({ ok: false, reason: 'not-on-network' })
    expect(crypto.selected_token_ref).toEqual(before)
    expect(applyNetworkChange).not.toHaveBeenCalled()
  })

  it('BSC xStocks sayfasi (bStocks ile ayni hisse) -> bStocks secilebilir, secilen satir chainId 56', () => {
    const u = ['TSLA', 'NVDA', 'AMZN', 'MSFT', 'CRCL', 'MSTR', 'SPY'].find((n) => rowFor(n, 'bstocks') && rowFor(n, 'xstocks', 56))
    expect(u).toBeTruthy()
    const x = rowFor(u, 'xstocks', 56)
    openRow(x)
    const sw = useIssuerSwitch({})
    expect(sw.options.value.find((o) => o.issuer === 'bstocks').available).toBe(true)
    const r = sw.pick('bstocks')
    expect(r).toMatchObject({ ok: true, changed: true })
    expect(crypto.selected_token_ref.chainId).toBe(56)
    expect(crypto.selected_token_ref).toEqual(refOfRow(rowFor(u, 'bstocks')))
    expect(applyNetworkChange).not.toHaveBeenCalled()
  })

  it('bStocks sayfasi + xStocks BSC satiri var -> xStocks secilebilir ve secilen satir BSC', () => {
    const u = ['TSLA', 'NVDA', 'AMZN', 'MSFT', 'CRCL', 'MSTR', 'SPY'].find((n) => rowFor(n, 'bstocks') && rowFor(n, 'xstocks', 56))
    openRow(rowFor(u, 'bstocks'))
    network.currentNetwork = { ...chain(56), chainId: 1 } // cuzdan baska agda olsa da sayfa agi (56) belirler
    const sw = useIssuerSwitch({})
    expect(sw.options.value.find((o) => o.issuer === 'xstocks').available).toBe(true)
    expect(sw.pick('xstocks').ok).toBe(true)
    expect(crypto.selected_token_ref).toEqual(refOfRow(rowFor(u, 'xstocks', 56)))
    expect(network.currentNetwork.chainId).toBe(1)
    expect(applyNetworkChange).not.toHaveBeenCalled()
  })
})

describe('pick -- guvenlik', () => {
  it('bilinmeyen ihracci reddedilir', async () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const sw = useIssuerSwitch({})
    const r = await sw.pick('evilstocks')
    expect(r).toMatchObject({ ok: false, reason: 'unknown-issuer' })
  })

  it('bayrak kapaliyken xstocks secilemez', async () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const sw = useIssuerSwitch({ xstocksEnabled: false })
    const r = await sw.pick('xstocks')
    expect(r).toMatchObject({ ok: false, reason: 'unknown-issuer' })
    expect(applyNetworkChange).not.toHaveBeenCalled()
  })
})

describe('ag secici (kullanici istegi 2026-10-23)', () => {
  const MULTI = () => ['TSLA', 'NVDA', 'AMZN', 'MSFT', 'CRCL', 'MSTR', 'SPY'].find(
    (u) => rowsOf(u).filter((r) => r.issuer === 'xstocks').length > 1,
  )

  it('cok agli xStocks hissesinde chainRows katalogdaki tum xStocks zincirleri', () => {
    const u = MULTI()
    expect(u, 'cok zincirli xStocks hissesi yok').toBeTruthy()
    const x = rowsOf(u).filter((r) => r.issuer === 'xstocks')
    openRow(x[0])
    const sw = useIssuerSwitch({})
    expect(sw.chainRows.value.map((r) => r.chainId).sort()).toEqual(x.map((r) => r.chainId).sort())
    expect(sw.chainRows.value.every((r) => r.issuer === 'xstocks')).toBe(true)
  })

  it('bStocks: tek satir (yalniz BSC)', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const sw = useIssuerSwitch({})
    expect(sw.chainRows.value).toHaveLength(1)
    expect(sw.chainRows.value[0].chainId).toBe(56)
  })

  it('bayrak kapaliyken xStocks zincirleri listelenmez', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const sw = useIssuerSwitch({ xstocksEnabled: false })
    expect(sw.chainRows.value).toHaveLength(1)
  })

  it('pickChain: ref o zincirin satirina yazilir, applyNetworkChange CAGRILMAZ, cuzdan agi ayni, onSwitched atesler', () => {
    const x = rowsOf(MULTI()).filter((r) => r.issuer === 'xstocks')
    openRow(x[0])
    const onSwitched = vi.fn()
    const sw = useIssuerSwitch({ onSwitched })
    const walletBefore = network.currentNetwork.chainId
    const r = sw.pickChain(x[1].chainId)
    expect(r).toMatchObject({ ok: true, changed: true })
    expect(applyNetworkChange).not.toHaveBeenCalled()
    expect(network.currentNetwork.chainId).toBe(walletBefore)
    expect(crypto.selected_token_ref).toEqual(refOfRow(x[1]))
    expect(crypto.selected_token_id).toBe(x[1].coingeckoId)
    expect(onSwitched).toHaveBeenCalledTimes(1)
    expect(onSwitched.mock.calls[0][0]).toEqual({ issuer: 'xstocks', row: x[1], payToken: defaultPayToken(x[1].chainId) })
    expect(sw.chain.value).toBe(x[1].chainId)
  })

  it('pickChain: ayni zincir no-op, katalogda olmayan zincir reddedilir', () => {
    const x = rowsOf(MULTI()).filter((r) => r.issuer === 'xstocks')
    openRow(x[0])
    const onSwitched = vi.fn()
    const sw = useIssuerSwitch({ onSwitched })
    expect(sw.pickChain(x[0].chainId)).toMatchObject({ ok: true, changed: false })
    expect(sw.pickChain(999999)).toMatchObject({ ok: false, reason: 'unknown-chain' })
    expect(onSwitched).not.toHaveBeenCalled()
    expect(crypto.selected_token_ref).toEqual(refOfRow(x[0]))
  })
})

describe('piyasa kapaliyken xStocks pasif (kullanici karari 2026-10-24)', () => {
  const SAT = () => new Date(2026, 9, 24, 12, 0) // cumartesi
  const WED = () => new Date(2026, 9, 21, 12, 0) // carsamba
  const MON_OPEN = new Date(2026, 9, 26, 3, 0).toISOString()
  const THU_OPEN = new Date(2026, 9, 22, 3, 0).toISOString()
  const xOnlyUnderlying = () => {
    const all = ['TSLA', 'AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'SPY', 'QQQ', 'COIN', 'MSTR', 'HOOD', 'CRCL', 'AVGO', 'NFLX', 'LLY', 'JPM', 'V', 'MA', 'WMT', 'KO', 'PEP', 'GME', 'ABBV', 'ACN', 'AZN', 'CVX', 'DFDV', 'GLD', 'IWM', 'JNJ', 'MCD', 'NVO', 'ORCL', 'PG', 'PM', 'TQQQ', 'UNH', 'VTI', 'XOM', 'BRK', 'BRKB', 'CSCO', 'HD', 'LIN', 'MRVL', 'PLTR', 'CMCSA', 'AMBR', 'BAC', 'AMD', 'INTC']
    return all.find((u) => rowsOf(u).some((r) => r.issuer === 'xstocks') && !rowsOf(u).some((r) => r.issuer === 'bstocks'))
  }

  it('kapali + hafta sonu -> xLock weekend, acilis zamani ile', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const sw = useIssuerSwitch({ market: () => ({ state: 'closed', nextChangeAt: MON_OPEN }), now: SAT })
    expect(sw.xLock.value).toEqual({ issuer: 'xstocks', kind: 'weekend', nextChangeAt: MON_OPEN })
  })

  it('kapali hafta ici (tatil) -> kind market', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const sw = useIssuerSwitch({ market: () => ({ state: 'closed', nextChangeAt: THU_OPEN }), now: WED })
    expect(sw.xLock.value.kind).toBe('market')
  })

  it('bilinmiyor (null) veya acik -> kilit yok', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    expect(useIssuerSwitch({ market: () => null, now: SAT }).xLock.value).toBeNull()
    expect(useIssuerSwitch({ market: () => ({ state: 'open', nextChangeAt: null }), now: SAT }).xLock.value).toBeNull()
  })

  it('kapaliyken pick(xstocks) ENGELLENMEZ: dugme aktif, secim degisir', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const onSwitched = vi.fn()
    const sw = useIssuerSwitch({ onSwitched, market: () => ({ state: 'closed', nextChangeAt: MON_OPEN }), now: SAT })
    expect(sw.pick('xstocks').ok).toBe(true)
    expect(onSwitched).toHaveBeenCalledTimes(1)
    expect(sw.selected.value).toBe('xstocks')
  })

  it('xStocks secili + kapali + bStocks var -> otomatik bStocks secimi YOK, blocked=true (yalniz Al kilidi icin)', () => {
    openRow(rowFor('TSLA', 'xstocks'))
    const onSwitched = vi.fn()
    const sw = useIssuerSwitch({ onSwitched, market: () => ({ state: 'closed', nextChangeAt: MON_OPEN }), now: SAT })
    expect(sw.selected.value).toBe('xstocks')
    expect(onSwitched).not.toHaveBeenCalled()
    expect(applyNetworkChange).not.toHaveBeenCalled()
    expect(sw.blocked.value).toBe(true)
  })

  it('xStocks secili + kapali + bilinmiyor -> otomatik gecis YOK', () => {
    openRow(rowFor('TSLA', 'xstocks'))
    const sw = useIssuerSwitch({ market: () => null, now: SAT })
    expect(sw.selected.value).toBe('xstocks')
  })

  it('bStocks secili iken kapali piyasa blocked yapmaz (kilit yalniz xStocks icin)', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const sw = useIssuerSwitch({ market: () => ({ state: 'closed', nextChangeAt: MON_OPEN }), now: SAT })
    expect(sw.xLock.value).not.toBeNull()
    expect(sw.blocked.value).toBe(false)
  })

  it('bStocks yoksa da xStocks secili kalir ve blocked=true', () => {
    const u = xOnlyUnderlying()
    expect(u, 'bStocks karsiligi olmayan xStocks hissesi katalogda olmali').toBeTruthy()
    openRow(rowFor(u, 'xstocks'))
    const sw = useIssuerSwitch({ market: () => ({ state: 'closed', nextChangeAt: MON_OPEN }), now: SAT })
    expect(sw.selected.value).toBe('xstocks')
    expect(sw.blocked.value).toBe(true)
    expect(applyNetworkChange).not.toHaveBeenCalled()
  })

  it('piyasa acilinca kilit kalkar ve xStocks secilebilir', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const m = ref({ state: 'closed', nextChangeAt: MON_OPEN })
    const sw = useIssuerSwitch({ market: () => m.value, now: SAT })
    expect(sw.xLock.value).not.toBeNull()
    m.value = { state: 'open', nextChangeAt: null }
    expect(sw.xLock.value).toBeNull()
    expect(sw.pick('xstocks').ok).toBe(true)
  })
})

// useIssuerSwitch -- Al/Sat ekraninda bStocks <-> xStocks gecisi (spec 5.3, TK13).
// Kritik sozlesme: secim YALNIZ katalog satirindan; cuzdanin aktif agi DEGISMEZ (applyNetworkChange hic cagrilmaz);
// ref yazilir ve ekran olayla (onSwitched) tutar/teklif/odeme tokenini sifirlar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

const applyNetworkChange = vi.hoisted(() => vi.fn())
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: (...a) => applyNetworkChange(...a) }))

import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { ALL_CHAINS } from '../data/chains'
import { companyRows } from '../utils/stocks/stockCompanies'
import { stockEntry, setLcxStockRows, _resetLcxStockRows } from '../utils/tokenizedStocks'
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

describe('ilk alim kapisi: Al\'da yalniz uygun ihracci, Sat\'ta hepsi; pickBuyRow (Task 45; K34, K35, PE21)', () => {
  const tamam = (...uygun) => ({ isAvailable: (issuer) => uygun.includes(issuer), ready: ref(true) })

  it('side + eligibility verilmezse suzgec YOK (eski davranis)', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    expect(useIssuerSwitch({ xstocksEnabled: true }).options.value.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks'])
  })

  it('Al\'da yalniz uygun ihracci, Sat\'ta ikisi de; side reaktif', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const side = ref('buy')
    const sw = useIssuerSwitch({ xstocksEnabled: true, eligibility: tamam('xstocks'), side: () => side.value })
    expect(sw.options.value.map((o) => o.issuer)).toEqual(['xstocks'])
    side.value = 'sell'
    expect(sw.options.value.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks'])
  })

  it('ready false iken Al\'da hicbir ihracci sunulmaz (yukleme = gizli); Sat\'ta hepsi', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const ready = ref(false)
    const side = ref('buy')
    const sw = useIssuerSwitch({ xstocksEnabled: true, eligibility: { isAvailable: () => true, ready }, side: () => side.value })
    expect(sw.options.value).toEqual([])
    ready.value = true
    expect(sw.options.value).toHaveLength(2)
  })

  it('pick() Al\'da suzulmus listeden calisir: uygun olmayan ihracciya gecmez', () => {
    openRow(rowFor('TSLA', 'xstocks', 56))
    const sw = useIssuerSwitch({ xstocksEnabled: true, eligibility: tamam('xstocks'), side: () => 'buy' })
    expect(sw.pick('bstocks')).toEqual({ ok: false, reason: 'unknown-issuer' })
  })

  it('pickBuyRow: uygun kardese gecer; ref + id yazilir, onSwitched atesler, aktif ag DEGISMEZ', () => {
    const b = rowFor('TSLA', 'bstocks')
    const x = rowFor('TSLA', 'xstocks', 56)
    openRow(b)
    const onSwitched = vi.fn()
    const sw = useIssuerSwitch({ xstocksEnabled: true, onSwitched, eligibility: tamam('xstocks'), side: () => 'buy' })
    const r = sw.pickBuyRow(x)
    expect(r).toMatchObject({ ok: true, changed: true })
    expect(crypto.selected_token_ref).toEqual(refOfRow(x))
    expect(crypto.selected_token_id).toBe(x.coingeckoId)
    expect(onSwitched).toHaveBeenCalledWith({ issuer: 'xstocks', row: x, payToken: defaultPayToken(x.chainId) })
    expect(applyNetworkChange).not.toHaveBeenCalled()
    expect(network.currentNetwork.chainId).toBe(b.chainId)
  })

  it('pickBuyRow: katalog disi, baska sirketin, baska agin ya da zaten secili satiri reddeder (ref degismez)', () => {
    const b = rowFor('TSLA', 'bstocks')
    openRow(b)
    const onSwitched = vi.fn()
    const sw = useIssuerSwitch({ xstocksEnabled: true, onSwitched })
    for (const row of [null, undefined, b, rowFor('AAPL', 'bstocks'), rowFor('TSLA', 'xstocks', 1), { ...b, address: '0x000000000000000000000000000000000000dEaD' }]) {
      expect(sw.pickBuyRow(row)).toEqual({ ok: false, reason: 'unknown-row' })
    }
    expect(crypto.selected_token_ref).toEqual(refOfRow(b))
    expect(onSwitched).not.toHaveBeenCalled()
  })

  it('sameRows: secili hissenin ayni sirket + ayni zincirdeki tum ihracci satirlari (suzulmemis)', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const sw = useIssuerSwitch({ xstocksEnabled: true, eligibility: tamam(), side: () => 'buy' })
    expect(sw.sameRows.value.map((r) => r.issuer)).toEqual(['bstocks', 'xstocks'])
  })

  it('piyasa kilidi ve piyasa satiri suzulmemis listeden: xStocks Al\'da elense de piyasa durumu okunur', () => {
    openRow(rowFor('TSLA', 'bstocks'))
    const sw = useIssuerSwitch({ xstocksEnabled: true, eligibility: tamam('bstocks'), side: () => 'buy' })
    expect(sw.options.value.map((o) => o.issuer)).toEqual(['bstocks'])
    expect(sw.marketRow.value?.issuer).toBe('xstocks')
  })
})

// ---- LCX ihraccilari (Bolum 2, Gorev 10): secici N secenekte calisir; yalniz AYNI agdaki LCX secenekleri gelir -----------------
// Satirlar sunucunun /lcx/stocks bicimidir; Ethereum / ek BSC adresleri test icin uydurmadir. Dinamik katman her testten sonra bosaltilir.
const lcxRaw = (over) => ({
  category: 'stocks', priceSource: 'Chainlink', priceUpdatedAt: 1795071867, marketHours: 'us_equities', depthUsd: 1000, decimals: 18, priceUsd: 100, ...over,
})
const TSLAC = lcxRaw({
  chainId: 8453, address: '0xb2000000000000000000001e800a7f5189430cD0', symbol: 'TSLAC', name: 'Tesla (Coinbase Tokenized Stocks)',
  decimals: 8, issuer: 'coinbase', underlying: 'TSLA', priceUsd: 388.61280861,
})
const GMEON = lcxRaw({
  chainId: 56, address: '0xdABb9afF4cf02f26D2014e4cA9f94aC6fe6572a3', symbol: 'GMEON', name: 'GameStop (Ondo Tokenized Stock)',
  issuer: 'ondo', underlying: 'GME', priceUsd: 27.02536498754133,
})
const TSLAON_ETH = lcxRaw({
  chainId: 1, address: `0x${'7'.padEnd(38, '0')}01`, symbol: 'TSLAON', name: 'Tesla (Ondo Tokenized Stock)', issuer: 'Ondo', underlying: 'TSLA',
})
const TSLAON_BSC = lcxRaw({
  chainId: 56, address: `0x${'7'.padEnd(38, '0')}02`, symbol: 'TSLAON', name: 'Tesla (Ondo Tokenized Stock)', issuer: 'Ondo', underlying: 'TSLA',
})
const LCX_ON = { xstocksEnabled: true, lcxEnabled: true }
const lcxRow = (raw) => stockEntry(raw.chainId, raw.address)

describe('LCX ihraccilari: secici ve ag secici (Gorev 10)', () => {
  beforeEach(() => { setLcxStockRows([TSLAC, GMEON, TSLAON_ETH, TSLAON_BSC], { usEquitiesOpen: true }) })
  afterEach(() => { _resetLcxStockRows() })

  it('test 4: Ethereum TSLA uc secenekte calisir; baska agdaki bStocks "not-on-network", Ondo ve xStocks arasinda gecis calisir', () => {
    const x = rowFor('TSLA', 'xstocks', 1)
    openRow(x)
    const onSwitched = vi.fn()
    const sw = useIssuerSwitch({ ...LCX_ON, onSwitched })
    expect(sw.options.value.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks', 'ondo'])
    expect(sw.options.value.map((o) => [o.issuer, o.available])).toEqual([['bstocks', false], ['xstocks', true], ['ondo', true]])
    expect(sw.selected.value).toBe('xstocks')

    // baska agdaki (BSC) bStocks: pasif, secim degismez
    expect(sw.pick('bstocks')).toEqual({ ok: false, reason: 'not-on-network' })
    expect(crypto.selected_token_ref).toEqual(refOfRow(x))
    expect(onSwitched).not.toHaveBeenCalled()

    // Ondo (ayni ag): ref LCX satirina, katalog kimligi (id) null yazilir; aktif ag degismez
    const ondo = lcxRow(TSLAON_ETH)
    expect(sw.pick('ondo')).toMatchObject({ ok: true, changed: true })
    expect(crypto.selected_token_ref).toEqual({ id: null, chainId: 1, address: ondo.address, decimals: 18, symbol: 'TSLAON' })
    expect(crypto.selected_token_id).toBeNull()
    expect(onSwitched).toHaveBeenCalledTimes(1)
    expect(onSwitched.mock.calls[0][0]).toEqual({ issuer: 'ondo', row: ondo, payToken: defaultPayToken(1) })
    expect(sw.selected.value).toBe('ondo')
    expect(applyNetworkChange).not.toHaveBeenCalled()
    expect(network.currentNetwork.chainId).toBe(1)

    // Ondo secili iken: yalniz Ethereum satirlari (BSC bStocks pasif secenegi YOK)
    expect(sw.options.value.map((o) => o.issuer)).toEqual(['xstocks', 'ondo'])
    expect(sw.pick('ondo')).toMatchObject({ ok: true, changed: false })
    expect(sw.pick('bstocks')).toEqual({ ok: false, reason: 'unknown-issuer' })

    // geri: xStocks
    expect(sw.pick('xstocks')).toMatchObject({ ok: true, changed: true })
    expect(crypto.selected_token_ref).toEqual(refOfRow(x))
    expect(crypto.selected_token_id).toBe(x.coingeckoId)
  })

  it('BSC bStocks GME: iki secenek [bstocks, ondo], ikisi de gercek; gecis ve geri donus', () => {
    const b = rowFor('GME', 'bstocks')
    openRow(b)
    const sw = useIssuerSwitch(LCX_ON)
    expect(sw.options.value.map((o) => [o.issuer, o.available])).toEqual([['bstocks', true], ['ondo', true]])
    expect(sw.pick('ondo')).toMatchObject({ ok: true, changed: true })
    expect(crypto.selected_token_ref).toMatchObject({ id: null, chainId: 56, address: GMEON.address, symbol: 'GMEON' })
    expect(sw.selected.value).toBe('ondo')
    expect(sw.pick('bstocks')).toMatchObject({ ok: true, changed: true })
    expect(crypto.selected_token_ref).toEqual(refOfRow(b))
    expect(applyNetworkChange).not.toHaveBeenCalled()
  })

  it('Task 8 acigi kapandi: Base TSLAC yalniz kendi gercek secenegini sunar (pasif bStocks / xStocks YOK), secici gizlenir', () => {
    openRow(lcxRow(TSLAC))
    const sw = useIssuerSwitch(LCX_ON)
    expect(sw.options.value.map((o) => o.issuer)).toEqual(['coinbase'])
    expect(sw.options.value[0].available).toBe(true)
    expect(sw.selected.value).toBe('coinbase')
    expect(sw.pick('bstocks')).toEqual({ ok: false, reason: 'unknown-issuer' })
    expect(sw.pick('xstocks')).toEqual({ ok: false, reason: 'unknown-issuer' })
    expect(sw.chainRows.value.map((r) => r.chainId)).toEqual([8453])
  })

  it('bayrak KAPALI (lcxEnabled false): dinamik satirlar yuklu olsa da bugunku secenekler, Ondo secilemez', () => {
    openRow(rowFor('GME', 'bstocks'))
    const sw = useIssuerSwitch({ xstocksEnabled: true, lcxEnabled: false })
    expect(sw.options.value.map((o) => o.issuer)).toEqual(['bstocks'])
    expect(sw.sameRows.value.map((r) => r.issuer)).toEqual(['bstocks'])
    expect(sw.chainRows.value.map((r) => [r.issuer, r.chainId])).toEqual([['bstocks', 56]])
    expect(sw.pick('ondo')).toEqual({ ok: false, reason: 'unknown-issuer' })
    openRow(rowFor('TSLA', 'bstocks'))
    expect(useIssuerSwitch({ xstocksEnabled: true, lcxEnabled: false }).options.value.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks'])
  })

  it('xStocks piyasa kilidi yalniz xStocks: LCX secili iken xLock olsa da blocked false; xStocks secili iken blocked true (uc secenekte)', () => {
    const SAT = () => new Date(2026, 9, 24, 12, 0)
    const MON_OPEN = new Date(2026, 9, 26, 3, 0).toISOString()
    const market = () => ({ state: 'closed', nextChangeAt: MON_OPEN })
    openRow(lcxRow(TSLAON_BSC))
    const lcxSel = useIssuerSwitch({ ...LCX_ON, market, now: SAT })
    expect(lcxSel.selected.value).toBe('ondo')
    expect(lcxSel.options.value.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks', 'ondo'])
    expect(lcxSel.xLock.value).toEqual({ issuer: 'xstocks', kind: 'weekend', nextChangeAt: MON_OPEN })
    expect(lcxSel.blocked.value).toBe(false)
    expect(lcxSel.marketRow.value?.issuer).toBe('xstocks')

    openRow(rowFor('TSLA', 'xstocks', 56))
    const xSel = useIssuerSwitch({ ...LCX_ON, market, now: SAT })
    expect(xSel.options.value.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks', 'ondo'])
    expect(xSel.blocked.value).toBe(true)

    // piyasa kapali ama xStocks secenegi yok (Base): kilit yok
    openRow(lcxRow(TSLAC))
    const base = useIssuerSwitch({ ...LCX_ON, market, now: SAT })
    expect(base.xLock.value).toBeNull()
    expect(base.blocked.value).toBe(false)
  })

  it('sameRows: ayni sirket + ayni zincirdeki LCX kardesleri de gelir; pickBuyRow LCX kardese gecer (id null), baska agin LCX satirini reddeder', () => {
    const b = rowFor('GME', 'bstocks')
    openRow(b)
    const onSwitched = vi.fn()
    const sw = useIssuerSwitch({ ...LCX_ON, onSwitched })
    expect(sw.sameRows.value.map((r) => r.issuer)).toEqual(['bstocks', 'ondo'])
    expect(sw.pickBuyRow(lcxRow(TSLAC))).toEqual({ ok: false, reason: 'unknown-row' }) // baska sirket + baska ag
    const ondo = lcxRow(GMEON)
    expect(sw.pickBuyRow(ondo)).toMatchObject({ ok: true, changed: true })
    expect(crypto.selected_token_ref).toEqual({ id: null, chainId: 56, address: ondo.address, decimals: 18, symbol: 'GMEON' })
    expect(onSwitched).toHaveBeenCalledWith({ issuer: 'ondo', row: ondo, payToken: defaultPayToken(56) })

    openRow(rowFor('TSLA', 'xstocks', 1))
    const eth = useIssuerSwitch(LCX_ON)
    expect(eth.sameRows.value.map((r) => r.issuer)).toEqual(['xstocks', 'ondo'])
    expect(eth.pickBuyRow(lcxRow(TSLAON_BSC))).toEqual({ ok: false, reason: 'unknown-row' }) // ayni sirket ama BSC
    expect(eth.pickBuyRow(lcxRow(TSLAON_ETH))).toMatchObject({ ok: true, changed: true })
  })

  it("ilk alim kapisi: Al'da yalniz uygun ihracci (LCX dahil), Sat'ta hepsi", () => {
    openRow(rowFor('GME', 'bstocks'))
    const side = ref('buy')
    const tamam = (...uygun) => ({ isAvailable: (issuer) => uygun.includes(issuer), ready: ref(true) })
    const sw = useIssuerSwitch({ ...LCX_ON, eligibility: tamam('ondo'), side: () => side.value })
    expect(sw.options.value.map((o) => o.issuer)).toEqual(['ondo'])
    side.value = 'sell'
    expect(sw.options.value.map((o) => o.issuer)).toEqual(['bstocks', 'ondo'])
  })

  it("ag secici: LCX ihraccisinin ayni dayanak icin TUM zincir satirlari; pickChain ref'i o zincirin satirina yazar (id null)", () => {
    openRow(lcxRow(TSLAON_ETH))
    const onSwitched = vi.fn()
    const sw = useIssuerSwitch({ ...LCX_ON, onSwitched })
    expect(sw.chainRows.value.map((r) => [r.issuer, r.chainId])).toEqual([['ondo', 1], ['ondo', 56]])
    const walletBefore = network.currentNetwork.chainId
    expect(sw.pickChain(56)).toMatchObject({ ok: true, changed: true })
    expect(crypto.selected_token_ref).toMatchObject({ id: null, chainId: 56, address: TSLAON_BSC.address })
    expect(crypto.selected_token_id).toBeNull()
    expect(network.currentNetwork.chainId).toBe(walletBefore)
    expect(applyNetworkChange).not.toHaveBeenCalled()
    expect(onSwitched.mock.calls[0][0]).toMatchObject({ issuer: 'ondo', payToken: defaultPayToken(56) })
  })
})

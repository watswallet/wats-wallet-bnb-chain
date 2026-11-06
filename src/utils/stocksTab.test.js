// Hisseler sekmesinin VERI KATMANI: bakiye yukleme, tohum plani ve satir metinleri. RPC yok: okuyucu enjekte.
import { describe, it, expect, vi } from 'vitest'
import { BSTOCKS } from '../data/bStocks'
import { XSTOCKS } from '../data/xStocks'
import { stocksByChain, stockKey, stockEntry } from './tokenizedStocks'
import {
  UNKNOWN_TEXT, STOCK_BALANCE_TIMEOUT_MS, collectStockIds, loadGroupBalances, ownedRows, planSeed, stockPriceText, stockBalanceText,
  STOCK_CHIP_ALL, stockChipIds, initialStockChip, filterStockGroups,
  companyBalanceText, companyValueOf,
} from './stocksTab'
import { mergeGroupRows, pickRepresentative } from './stocks/stockCompanies'

const E18 = 10n ** 18n
const TSLA = XSTOCKS.find((s) => s.symbol === 'TSLAx')
const NVDA = XSTOCKS.find((s) => s.symbol === 'NVDAx')
const SPY = XSTOCKS.find((s) => s.symbol === 'MSTRx')
const GOOGLB = BSTOCKS.find((s) => s.symbol === 'GOOGLB')
const SPY_M = 1005714560286254000n

describe('UNKNOWN_TEXT', () => {
  it('tire (U+2014)', () => {
    expect(UNKNOWN_TEXT).toBe('—')
  })
})

describe('collectStockIds', () => {
  it('bStocks + xStocks kimlikleri TEKRARSIZ: ayni hisse birden cok zincirde ama tek kimlik', () => {
    const ids = collectStockIds(stocksByChain({ activeChainId: 1 }))

    expect(ids).toHaveLength(new Set(ids).size)
    expect(ids).toHaveLength(BSTOCKS.length + XSTOCKS.length)
    expect(ids).toContain('tesla-xstock')
    expect(ids).toContain(BSTOCKS[0].coingecko_id)
  })

  it('bayrak kapaliyken (includeXstocks false) yalniz bStocks kimlikleri', () => {
    const ids = collectStockIds(stocksByChain({ includeXstocks: false }))

    expect(ids).toEqual(BSTOCKS.map((s) => s.coingecko_id))
  })
})

describe('loadGroupBalances', () => {
  const groups = stocksByChain({ activeChainId: 1 })

  // Okuyucu: BSC (56) duser; NVDAx bakiyesi okunamaz; MSTRx 3 token tutulur.
  const read = vi.fn(async ({ chainId, entries }) => {
    if (chainId === 56) throw new Error('rpc dustu')
    return new Map(entries.map((e) => [
      e.address.toLowerCase(),
      e.symbol === 'NVDAx'
        ? { balance: null, multiplier: 5n }
        : { balance: e.symbol === 'MSTRx' ? 3n * E18 : 0n, multiplier: e.issuer === 'xstocks' ? E18 : null },
    ]))
  })

  it('zincir basina TEK cagri; bir zincir dusunce YALNIZ o zincirin satirlari error olur', async () => {
    read.mockClear()
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {})

    const out = await loadGroupBalances({ owner: '0xabc', groups, rpcFor: (id) => `rpc-${id}`, read })

    expect(read.mock.calls.map(([arg]) => arg.chainId).sort((a, b) => a - b)).toEqual([1, 56, 42161])
    expect(out[stockKey(1, SPY.address)]).toEqual({ status: 'ok', balance: 3n * E18, multiplier: E18 })
    // Review Focus 2: bakiye okunamadi -> error (0 DEGIL), carpan yine de bilinir.
    expect(out[stockKey(1, NVDA.address)]).toEqual({ status: 'error', balance: null, multiplier: 5n })
    // BSC dustu: xStock da bStock da error.
    expect(out[stockKey(56, SPY.address)]).toEqual({ status: 'error', balance: null, multiplier: null })
    expect(out[stockKey(56, GOOGLB.address)]).toEqual({ status: 'error', balance: null, multiplier: null })
    // Arbitrum etkilenmedi.
    expect(out[stockKey(42161, SPY.address)].status).toBe('ok')
    expect(hata).toHaveBeenCalledTimes(1)
    hata.mockRestore()
  })

  // Review Focus 1: ayni adres uc zincirde AYRI satirlar (anahtar zinciri de icerir).
  it('Review Focus 1: ayni MSTRx adresi her zincirde AYRI durum anahtari tasir; sahip olunanlar zincir basina ayri satir', async () => {
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {})

    const out = await loadGroupBalances({ owner: '0xabc', groups, rpcFor: (id) => `rpc-${id}`, read })

    expect(new Set([1, 56, 42161].map((id) => stockKey(id, SPY.address))).size).toBe(3)
    expect(ownedRows(groups, out).map((r) => [r.symbol, r.chainId])).toEqual([['MSTRx', 1], ['MSTRx', 42161]])
    hata.mockRestore()
  })

  it('RPC adresi yoksa okuyucu CAGRILMAZ ve satirlar error olur', async () => {
    const patlayan = vi.fn(async () => { throw new Error('cagrilmamaliydi') })
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {})

    const out = await loadGroupBalances({ owner: '0xabc', groups: [groups[0]], rpcFor: () => null, read: patlayan })

    expect(patlayan).not.toHaveBeenCalled()
    expect(Object.values(out).every((s) => s.status === 'error')).toBe(true)
    hata.mockRestore()
  })

  // FIN-cekirdek-1: ethers istek zaman asimi 300 sn; takili tek RPC uc zincirin tum bakiyesini
  // (ve tohumlamayi) bekletirdi. Zincir basina sinir: takili grup 'error', hizli grup 'ok'.
  describe('zincir basina zaman asimi (FIN-cekirdek-1)', () => {
    const TAKILI_ZINCIR = 42161

    it('biri takili biri hizli iki grup: hizli ok, takili error, tur sinirda biter, artakalan sayac yok', async () => {
      vi.useFakeTimers()
      const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const iki = groups.filter((g) => g.chainId === 1 || g.chainId === TAKILI_ZINCIR)
        expect(iki.map((g) => g.chainId).sort((a, b) => a - b)).toEqual([1, TAKILI_ZINCIR])
        const okuyucu = vi.fn(({ chainId, entries }) => (chainId === TAKILI_ZINCIR
          ? new Promise(() => {})
          : Promise.resolve(new Map(entries.map((e) => [e.address.toLowerCase(), { balance: 2n * E18, multiplier: null }])))))

        let bitti = false
        const tur = loadGroupBalances({ owner: '0xabc', groups: iki, rpcFor: (id) => `rpc-${id}`, read: okuyucu, timeoutMs: 5_000 })
          .then((r) => { bitti = true; return r })

        await vi.advanceTimersByTimeAsync(4_999)
        expect(bitti).toBe(false)

        await vi.advanceTimersByTimeAsync(1)
        const out = await tur

        expect(bitti).toBe(true)
        expect(out[stockKey(1, SPY.address)]).toEqual({ status: 'ok', balance: 2n * E18, multiplier: null })
        expect(out[stockKey(TAKILI_ZINCIR, SPY.address)]).toEqual({ status: 'error', balance: null, multiplier: null })
        expect(hata).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        hata.mockRestore()
        vi.useRealTimers()
      }
    })

    it('varsayilan sinir 12 sn: takili grup 12 sn dolmadan error OLMAZ, dolunca olur', async () => {
      vi.useFakeTimers()
      const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        expect(STOCK_BALANCE_TIMEOUT_MS).toBe(12_000)
        const tek = groups.filter((g) => g.chainId === TAKILI_ZINCIR)
        let bitti = false
        const tur = loadGroupBalances({ owner: '0xabc', groups: tek, rpcFor: () => 'rpc', read: () => new Promise(() => {}) })
          .then((r) => { bitti = true; return r })

        await vi.advanceTimersByTimeAsync(STOCK_BALANCE_TIMEOUT_MS - 1)
        expect(bitti).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        const out = await tur
        expect(Object.values(out).every((s) => s.status === 'error')).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        hata.mockRestore()
        vi.useRealTimers()
      }
    })

    it('hizli okuma bitince zaman asimi sayaci TEMIZLENIR (artakalan zamanlayici yok)', async () => {
      vi.useFakeTimers()
      try {
        const out = await loadGroupBalances({ owner: '0xabc', groups, rpcFor: (id) => `rpc-${id}`, read: async ({ entries }) => new Map(entries.map((e) => [e.address.toLowerCase(), { balance: 1n, multiplier: null }])) })

        expect(Object.values(out).every((s) => s.status === 'ok')).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

describe('ownedRows', () => {
  it('yalniz bakiyesi okunmus VE sifirdan buyuk satirlar; okunamayan satir sahip sayilmaz', () => {
    const groups = stocksByChain({ activeChainId: 1 })
    const balances = {
      [stockKey(1, TSLA.address)]: { status: 'ok', balance: 1n, multiplier: E18 },
      [stockKey(1, NVDA.address)]: { status: 'error', balance: null, multiplier: null },
      [stockKey(1, SPY.address)]: { status: 'ok', balance: 0n, multiplier: E18 },
    }

    expect(ownedRows(groups, balances).map((r) => r.symbol)).toEqual(['TSLAx'])
  })
})

describe('planSeed', () => {
  it('kovada olmayan satirlar zincir anahtarina gore eklenir; kovada olan TEKRAR eklenmez; bStock logosu katalogdan', () => {
    const owned = [stockEntry(1, TSLA.address), stockEntry(56, TSLA.address), stockEntry(56, GOOGLB.address)]
    const bucket = { 1: [{ address: TSLA.address.toLowerCase() }], 56: [] }

    const plan = planSeed({ owned, bucket, imageOf: (row) => ({ large: `L:${row.symbol}` }) })

    expect(Object.keys(plan)).toEqual(['56'])
    expect(plan['56']).toHaveLength(2)
    // xStock: katalogda logo yok -> sunucu kaydindaki gorsel (imageOf); coingecko_id camelCase'ten snake_case'e.
    expect(plan['56'][0]).toEqual({
      name: 'Tesla', symbol: 'TSLAx', decimals: 18, address: TSLA.address, image: { large: 'L:TSLAx' }, coingecko_id: 'tesla-xstock',
    })
    expect(plan['56'][1].image).toBe(GOOGLB.image)
  })

  it('ayni satir iki kez gelirse tek kez, bos girdi bos plan', () => {
    const row = stockEntry(1, TSLA.address)

    expect(planSeed({ owned: [row, row], bucket: {} })['1']).toHaveLength(1)
    expect(planSeed({ owned: [], bucket: {} })).toEqual({})
  })

  it('logo hicbir yerden gelmezse image null', () => {
    expect(planSeed({ owned: [stockEntry(1, NVDA.address)], bucket: {} })['1'][0].image).toBeNull()
  })
})

describe('stockPriceText', () => {
  const spy = stockEntry(1, SPY.address)
  const googlb = stockEntry(56, GOOGLB.address)

  it('xStock: CoinGecko fiyati carpana bolunur (781,30 / 1,0057 = $776.86)', () => {
    expect(stockPriceText({ row: spy, record: { market_data: { priceUSD: 781.3 } }, multiplier: SPY_M })).toBe('$776.86')
  })

  // Review Focus 2: carpan / kayit / fiyat yok -> tire; asla ham fiyat, asla $0.00.
  it('Review Focus 2: carpan bilinmiyor, kayit yok ya da fiyat 0 ise xStock icin tire', () => {
    expect(stockPriceText({ row: spy, record: { market_data: { priceUSD: 781.3 } }, multiplier: null })).toBe(UNKNOWN_TEXT)
    expect(stockPriceText({ row: spy, record: null, multiplier: SPY_M })).toBe(UNKNOWN_TEXT)
    expect(stockPriceText({ row: spy, record: { market_data: { priceUSD: 0 } }, multiplier: E18 })).toBe(UNKNOWN_TEXT)
  })

  it('bStock: eski davranis AYNEN (ham fiyat 2 hane; kayit yoksa tire; sifir fiyat $0.00)', () => {
    expect(stockPriceText({ row: googlb, record: { market_data: { priceUSD: 231.45 } }, multiplier: 5n })).toBe('$231.45')
    expect(stockPriceText({ row: googlb, record: { market_data: { priceUSD: 0 } } })).toBe('$0.00')
    expect(stockPriceText({ row: googlb, record: undefined })).toBe(UNKNOWN_TEXT)
  })

  // Controller karari C-08: bStock metni bugunku Home.vue ifadesiyle BIREBIR; yeni tire kurali yalniz xStock'ta.
  it('C-08: bStock kaydi var ama priceUSD yok/null ise eski ifade $0.00 (tire DEGIL); market_data yoksa tire', () => {
    expect(stockPriceText({ row: googlb, record: { market_data: { priceUSD: null } } })).toBe('$0.00')
    expect(stockPriceText({ row: googlb, record: { market_data: {} } })).toBe('$0.00')
    expect(stockPriceText({ row: googlb, record: {} })).toBe(UNKNOWN_TEXT)
    expect(stockPriceText({ row: googlb, record: null })).toBe(UNKNOWN_TEXT)
  })
})

describe('stockBalanceText', () => {
  it('yuklenmedi ya da sifir -> bos (hicbir sey cizilmez); okunamadi -> tire', () => {
    expect(stockBalanceText({ state: undefined })).toBe('')
    expect(stockBalanceText({ state: { status: 'ok', balance: 0n } })).toBe('')
    // Review Focus 2: okunamayan bakiye 0 DEGIL tire.
    expect(stockBalanceText({ state: { status: 'error', balance: null } })).toBe(UNKNOWN_TEXT)
  })

  it('pozitif miktar 4 hane; toz "<0.0001"', () => {
    expect(stockBalanceText({ state: { status: 'ok', balance: 1_234_500_000_000_000_000n } })).toBe('1.2345')
    expect(stockBalanceText({ state: { status: 'ok', balance: 10n ** 13n } })).toBe('<0.0001')
    expect(stockBalanceText({ state: { status: 'ok', balance: 1234n * E18 + 5678n * 10n ** 14n } })).toBe('1234.5678')
  })

  it('decimals parametresi kullanilir (18 disi): 6 ondalikli 1_500_000 = 1.5', () => {
    expect(stockBalanceText({ state: { status: 'ok', balance: 1_500_000n }, decimals: 6 })).toBe('1.5000')
  })
})

describe('Hisseler ag cipleri', () => {
  const groupsOf = (activeChainId) => stocksByChain({ activeChainId, includeXstocks: true })

  it('cipler: Tumu + hissesi olan aglar, SABIT sira (aktif ag ne olursa olsun)', () => {
    expect(stockChipIds(groupsOf(56))).toEqual([STOCK_CHIP_ALL, 1, 56, 42161])
    expect(stockChipIds(groupsOf(42161))).toEqual([STOCK_CHIP_ALL, 1, 56, 42161])
  })

  it('yalniz hissesi olan aglar cip alir (grup yoksa yalniz Tumu)', () => {
    expect(stockChipIds(groupsOf(56).filter((g) => g.chainId === 56))).toEqual([STOCK_CHIP_ALL, 56])
    expect(stockChipIds([])).toEqual([STOCK_CHIP_ALL])
  })

  it('baslangic: aktif ag hisseli ise o, degilse Tumu', () => {
    const groups = groupsOf(56)
    expect(initialStockChip(groups, 56)).toBe(56)
    expect(initialStockChip(groups, '0x38')).toBe(56)
    expect(initialStockChip(groups, 137)).toBe(STOCK_CHIP_ALL)
    expect(initialStockChip(groups, undefined)).toBe(STOCK_CHIP_ALL)
  })

  it('filtre: Tumu hepsi, tek ag yalniz o grup, bilinmeyen secim Tumu gibi', () => {
    const groups = groupsOf(1)
    expect(filterStockGroups(groups, STOCK_CHIP_ALL)).toEqual(groups)
    expect(filterStockGroups(groups, 56).map((g) => g.chainId)).toEqual([56])
    expect(filterStockGroups(groups, 999)).toEqual(groups)
  })
})

describe('sirket satiri: toplam bakiye ve temsilci degeri (T5)', () => {
  const bsc = stocksByChain({ includeXstocks: true }).find((g) => g.chainId === 56)
  const tslaCompany = mergeGroupRows(56, bsc.rows).find((c) => c.underlying === 'TSLA')
  const b = tslaCompany.options.find((r) => r.issuer === 'bstocks')
  const x = tslaCompany.options.find((r) => r.issuer === 'xstocks')
  const state = (row, balance, status = 'ok') => ({ [stockKey(row.chainId, row.address)]: { status, balance, multiplier: null } })

  it('iki secenek: bakiyeler TOPLANIR', () => {
    const balances = { ...state(b, 1n * E18), ...state(x, 2n * E18 + E18 / 4n) }
    expect(companyBalanceText({ company: tslaCompany, balances })).toBe('3.2500')
  })
  it('hicbiri yuklenmedi veya sifir -> bos', () => {
    expect(companyBalanceText({ company: tslaCompany, balances: {} })).toBe('')
    expect(companyBalanceText({ company: tslaCompany, balances: { ...state(b, 0n), ...state(x, 0n) } })).toBe('')
  })
  it('biri okunamadi, digeri pozitif -> bilinen toplam; hepsi okunamadi -> tire', () => {
    expect(companyBalanceText({ company: tslaCompany, balances: { ...state(b, E18), ...state(x, null, 'error') } })).toBe('1.0000')
    expect(companyBalanceText({ company: tslaCompany, balances: { ...state(b, null, 'error'), ...state(x, null, 'error') } })).toBe(UNKNOWN_TEXT)
  })
  it('toz -> <0.0001', () => {
    expect(companyBalanceText({ company: tslaCompany, balances: state(b, 1n) })).toBe('<0.0001')
  })
  it('companyValueOf: tutulan secenek icin held + usd, tutulmayan icin held false', () => {
    const balances = state(b, 2n * E18)
    const valueOf = companyValueOf({
      balances,
      recordOf: (row) => (row === b ? { market_data: { priceUSD: 100 } } : null),
      multiplierOf: () => null,
    })
    expect(valueOf(b)).toEqual({ held: true, usd: 200 })
    expect(valueOf(x)).toEqual({ held: false, usd: null })
  })
  it('fiyat bilinmeyen tutulan secenek: held true, usd null; pickRepresentative onu tutulan sayar', () => {
    const balances = state(x, E18)
    const valueOf = companyValueOf({ balances, recordOf: () => null, multiplierOf: () => null })
    expect(valueOf(x)).toEqual({ held: true, usd: null })
    expect(pickRepresentative(tslaCompany, valueOf)).toBe(x)
  })
})

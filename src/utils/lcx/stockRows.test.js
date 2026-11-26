// stockRows.js -- /lcx/stocks satirlarinin chrome.storage.local onbellegi ve yukleyicisi (Bolum 2, Gorev 4).
// Bayrak ve gizli moda BAKMAZ: cagiran (Gorev 5, 9) bakar. Depo okumak ag istegi degildir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LCX_STOCK_ROWS_KEY, hydrateLcxStockRows, refreshLcxStockRows } from './stockRows.js'
import { LcxUnavailableError } from './client.js'
import { lcxStockRows, stockEntry, setLcxStockRows, _resetLcxStockRows } from '../tokenizedStocks'

// Sunucunun /lcx/stocks satir bicimi (server/test/fixtures/lcx/rwa-assets.json -> applyStockFilter).
const TSLAC = {
    chainId: 8453,
    address: '0xb2000000000000000000001e800a7f5189430cD0',
    symbol: 'TSLAC',
    name: 'Tesla (Coinbase Tokenized Stocks)',
    decimals: 8,
    issuer: 'coinbase',
    underlying: 'TSLA',
    category: 'stocks',
    priceUsd: 388.61280861,
    priceSource: 'Chainlink Coinbase TSLA on Base',
    priceUpdatedAt: 1795071867,
    marketHours: 'us_equities',
    depthUsd: 252144.395038,
}
const GMEON = {
    chainId: 56,
    address: '0xdABb9afF4cf02f26D2014e4cA9f94aC6fe6572a3',
    symbol: 'GMEON',
    name: 'GameStop (Ondo Tokenized Stock)',
    decimals: 18,
    issuer: 'ondo',
    underlying: 'GME',
    category: 'stocks',
    priceUsd: 27.02536498754133,
    priceSource: 'Chainlink GME / USD on BNB Chain',
    priceUpdatedAt: 1795032524,
    marketHours: 'us_equities',
    depthUsd: 42234.209440152175,
}

const NOW = 1_795_100_000_000
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const stocksBody = (rows, extra = {}) => ({ success: true, usEquitiesOpen: true, asOf: NOW - 5_000, rows, ...extra })

// chrome.storage.local benzeri bellek ici depo (promise API).
function memoryStorage(initial = {}) {
    const data = { ...initial }
    return {
        data,
        get: vi.fn(async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {})),
        set: vi.fn(async (obj) => { Object.assign(data, structuredClone(obj)) }),
    }
}

const record = (over = {}) => ({
    fetchedAt: NOW - 30_000,
    asOf: NOW - 40_000,
    usEquitiesOpen: true,
    rows: [TSLAC, GMEON],
    ...over,
})

beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_API_URL', 'https://api.example.test')
    _resetLcxStockRows()
})

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('LCX_STOCK_ROWS_KEY', () => {
    it("depo anahtari 'lcx_stock_rows'", () => {
        expect(LCX_STOCK_ROWS_KEY).toBe('lcx_stock_rows')
    })
})

describe('refreshLcxStockRows', () => {
    it('depo bos, fetch basarili -> satirlar kurulur, depoya { fetchedAt, asOf, usEquitiesOpen, rows } yazilir', async () => {
        const storage = memoryStorage()
        const fetchImpl = vi.fn(async () => reply(200, stocksBody([TSLAC, GMEON], { usEquitiesOpen: false, asOf: NOW - 7_000 })))

        const result = await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })

        expect(result).toEqual({ ok: true, count: 2, fetched: true })
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.test/lcx/stocks')
        expect(fetchImpl.mock.calls[0][1].method).toBe('GET')
        expect(lcxStockRows().map((r) => r.symbol)).toEqual(['TSLAC', 'GMEON'])
        expect(stockEntry(8453, TSLAC.address)).toMatchObject({ source: 'lcx', marketOpen: false })
        expect(storage.set).toHaveBeenCalledTimes(1)
        expect(storage.data[LCX_STOCK_ROWS_KEY]).toEqual({
            fetchedAt: NOW,
            asOf: NOW - 7_000,
            usEquitiesOpen: false,
            rows: [TSLAC, GMEON],
        })
    })

    it('depo 30 sn yasinda, maxAgeMs 60 000 -> fetch cagrilmaz; depodaki satirlar kurulur', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record() })
        const fetchImpl = vi.fn()

        const result = await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })

        expect(result).toEqual({ ok: true, count: 2, fetched: false })
        expect(fetchImpl).not.toHaveBeenCalled()
        expect(storage.set).not.toHaveBeenCalled()
        expect(stockEntry(56, GMEON.address)).toMatchObject({ source: 'lcx', marketOpen: true })
    })

    it('sinir: tam maxAgeMs yasinda taze (ag yok), 1 ms fazlasinda bayat (ag var)', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ fetchedAt: NOW - 60_000 }) })
        const fetchImpl = vi.fn(async () => reply(200, stocksBody([TSLAC])))

        expect((await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })).fetched).toBe(false)
        expect(fetchImpl).not.toHaveBeenCalled()

        expect((await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW + 1 })).fetched).toBe(true)
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('depo bayat (60 sn < yas) -> fetch; basarili sonuc depoyu ve satirlari degistirir', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ fetchedAt: NOW - 90_000, rows: [GMEON] }) })
        const fetchImpl = vi.fn(async () => reply(200, stocksBody([TSLAC])))

        const result = await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })

        expect(result).toEqual({ ok: true, count: 1, fetched: true })
        expect(lcxStockRows().map((r) => r.symbol)).toEqual(['TSLAC'])
        expect(storage.data[LCX_STOCK_ROWS_KEY].rows).toEqual([TSLAC])
        expect(storage.data[LCX_STOCK_ROWS_KEY].fetchedAt).toBe(NOW)
    })

    it('gelecekteki fetchedAt (saat geri alinmis) taze sayilmaz: fetch gider', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ fetchedAt: NOW + 3_600_000 }) })
        const fetchImpl = vi.fn(async () => reply(200, stocksBody([TSLAC])))
        const result = await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })
        expect(result.fetched).toBe(true)
    })

    it('maxAgeMs verilmezse her zaman fetch (depo taze olsa bile)', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ fetchedAt: NOW }) })
        const fetchImpl = vi.fn(async () => reply(200, stocksBody([TSLAC])))
        expect((await refreshLcxStockRows({ storage, fetchImpl, now: () => NOW })).fetched).toBe(true)
    })

    it('fetch LcxUnavailableError atar -> eski satirlar kalir, { ok:false } doner; depo degismez', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ fetchedAt: NOW - 90_000 }) })
        await hydrateLcxStockRows({ storage })
        expect(lcxStockRows()).toHaveLength(2)
        const stored = structuredClone(storage.data[LCX_STOCK_ROWS_KEY])
        const fetchImpl = vi.fn(async () => {
            throw new LcxUnavailableError('network')
        })

        const result = await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })

        expect(result.ok).toBe(false)
        expect(result.fetched).toBe(false)
        expect(result.count).toBe(2)
        expect(lcxStockRows().map((r) => r.symbol)).toEqual(['TSLAC', 'GMEON'])
        expect(storage.set).not.toHaveBeenCalled()
        expect(storage.data[LCX_STOCK_ROWS_KEY]).toEqual(stored)
    })

    it('depo da bos ve fetch basarisiz -> { ok:false, count:0 }; katman bos', async () => {
        const storage = memoryStorage()
        for (const fetchImpl of [
            vi.fn(async () => reply(503, { success: false, code: 'lcx_unavailable', reason: 'disabled' })),
            vi.fn(async () => reply(200, { success: true })),
            vi.fn(async () => { throw new TypeError('Failed to fetch') }),
        ]) {
            const result = await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })
            expect(result).toEqual({ ok: false, count: 0, fetched: false })
        }
        expect(lcxStockRows()).toEqual([])
        expect(storage.set).not.toHaveBeenCalled()
    })

    it('ayni anda iki cagri -> tek fetch; ikisi de ayni sonucu alir; bitince yeni cagri yeniden dener', async () => {
        const storage = memoryStorage()
        let release
        const gate = new Promise((resolve) => { release = resolve })
        const fetchImpl = vi.fn(async () => {
            await gate
            return reply(200, stocksBody([TSLAC, GMEON]))
        })

        const a = refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })
        const b = refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })
        release()
        const [ra, rb] = await Promise.all([a, b])

        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(ra).toEqual({ ok: true, count: 2, fetched: true })
        expect(rb).toEqual(ra)

        // ucus bitti: depo bayatlayinca yeni cagri yeni fetch yapar
        const c = await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW + 120_000 })
        expect(c.fetched).toBe(true)
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('basarisiz ucustan sonra tek-ucus kilidi acilir: sonraki cagri yeniden dener', async () => {
        const storage = memoryStorage()
        const fetchImpl = vi
            .fn()
            .mockImplementationOnce(async () => { throw new TypeError('Failed to fetch') })
            .mockImplementationOnce(async () => reply(200, stocksBody([TSLAC])))
        expect((await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })).ok).toBe(false)
        expect((await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })).ok).toBe(true)
        expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('depoya yazma basarisiz olsa da satirlar kurulur ve sonuc ok', async () => {
        const storage = memoryStorage()
        storage.set.mockImplementation(async () => { throw new Error('QUOTA_BYTES') })
        const fetchImpl = vi.fn(async () => reply(200, stocksBody([TSLAC])))
        const result = await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })
        expect(result).toEqual({ ok: true, count: 1, fetched: true })
        expect(lcxStockRows()).toHaveLength(1)
    })

    it('depo okuma hatasi (get reddi) agi engellemez: fetch gider', async () => {
        const storage = memoryStorage()
        storage.get.mockImplementation(async () => { throw new Error('boom') })
        const fetchImpl = vi.fn(async () => reply(200, stocksBody([TSLAC])))
        const result = await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })
        expect(result).toEqual({ ok: true, count: 1, fetched: true })
    })

    it('bozuk depo kaydi yok sayilir (fetch gider); bozuk kayit satir kurmaz', async () => {
        for (const bad of [null, 'x', 7, [], { fetchedAt: 'x', rows: [] }, { fetchedAt: NOW, rows: 'x', usEquitiesOpen: true }, { fetchedAt: NOW, rows: [TSLAC], usEquitiesOpen: 'yes' }]) {
            _resetLcxStockRows()
            const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: bad })
            const fetchImpl = vi.fn(async () => reply(200, stocksBody([GMEON])))
            const result = await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })
            expect(result.fetched, JSON.stringify(bad)).toBe(true)
        }
    })

    it('gecersiz satirlar elenir: count tutulan satir sayisidir, depo ham sunucu satirlarini yazar', async () => {
        const storage = memoryStorage()
        const bad = { ...TSLAC, address: '0x2000000000000000000000000000000000000002', priceUsd: 0 }
        const fetchImpl = vi.fn(async () => reply(200, stocksBody([TSLAC, bad])))
        const result = await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })
        expect(result).toEqual({ ok: true, count: 1, fetched: true })
        expect(storage.data[LCX_STOCK_ROWS_KEY].rows).toEqual([TSLAC, bad])
    })

    it('asOf yoksa depoya null yazilir', async () => {
        const storage = memoryStorage()
        const fetchImpl = vi.fn(async () => reply(200, { success: true, usEquitiesOpen: true, rows: [TSLAC] }))
        await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })
        expect(storage.data[LCX_STOCK_ROWS_KEY].asOf).toBeNull()
    })

    it('now sayi da olabilir (zaman damgasi)', async () => {
        const storage = memoryStorage()
        const fetchImpl = vi.fn(async () => reply(200, stocksBody([TSLAC])))
        await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: NOW })
        expect(storage.data[LCX_STOCK_ROWS_KEY].fetchedAt).toBe(NOW)
    })

    it('varsayilan depo chrome.storage.local, cagri aninda cozulur', async () => {
        const storage = memoryStorage()
        vi.stubGlobal('chrome', { storage: { local: storage } })
        try {
            const fetchImpl = vi.fn(async () => reply(200, stocksBody([TSLAC])))
            await refreshLcxStockRows({ maxAgeMs: 60_000, fetchImpl, now: () => NOW })
            expect(storage.set).toHaveBeenCalledTimes(1)
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it('depo yoksa (chrome tanimsiz) yine de calisir: ag, katman kurulur, yazma yok', async () => {
        const fetchImpl = vi.fn(async () => reply(200, stocksBody([TSLAC])))
        const result = await refreshLcxStockRows({ maxAgeMs: 60_000, fetchImpl, now: () => NOW })
        expect(result).toEqual({ ok: true, count: 1, fetched: true })
    })
})

describe('hydrateLcxStockRows', () => {
    it('10 gun yasindaki depoyu da yukler (yas siniri yok); ag istegi yok', async () => {
        const tenDays = 10 * 24 * 3_600_000
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ fetchedAt: NOW - tenDays, usEquitiesOpen: false }) })
        const fetchImpl = vi.fn()

        const count = await hydrateLcxStockRows({ storage, now: () => NOW })

        expect(count).toBe(2)
        expect(fetchImpl).not.toHaveBeenCalled()
        expect(storage.set).not.toHaveBeenCalled()
        expect(stockEntry(8453, TSLAC.address)).toMatchObject({ source: 'lcx', marketOpen: false })
    })

    it('depo bos -> 0 ve katman bos', async () => {
        expect(await hydrateLcxStockRows({ storage: memoryStorage() })).toBe(0)
        expect(lcxStockRows()).toEqual([])
    })

    it('bozuk kayit -> eldeki satirlar korunur', async () => {
        setLcxStockRows([TSLAC], { usEquitiesOpen: true })
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: { rows: 'x' } })
        expect(await hydrateLcxStockRows({ storage })).toBe(1)
        expect(lcxStockRows().map((r) => r.symbol)).toEqual(['TSLAC'])
    })

    it('depo okuma hatasi firlatmaz; eldeki satirlar korunur', async () => {
        setLcxStockRows([TSLAC], { usEquitiesOpen: true })
        const storage = memoryStorage()
        storage.get.mockImplementation(async () => { throw new Error('boom') })
        expect(await hydrateLcxStockRows({ storage })).toBe(1)
    })

    it('depodaki gecersiz satirlar yine elenir; statik katalogla cakisan dusurulur', async () => {
        const storage = memoryStorage({
            [LCX_STOCK_ROWS_KEY]: record({ rows: [TSLAC, { ...GMEON, underlying: null }] }),
        })
        expect(await hydrateLcxStockRows({ storage })).toBe(1)
    })

    it('chrome tanimsizsa 0 (depo yok)', async () => {
        expect(await hydrateLcxStockRows()).toBe(0)
    })

    it('now verilmezse Date.now() kullanilir (asOf 1 sn once: rozet degeri gecerli)', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ asOf: Date.now() - 1_000, usEquitiesOpen: true }) })
        await hydrateLcxStockRows({ storage })
        expect(stockEntry(8453, TSLAC.address).marketOpen).toBe(true)
    })
})

// Servis isci uzun yasar ama popup depoyu her 60 sn tazeler: depodaki DAHA YENI kayit bellekteki listeyi degistirir, daha ESKI kayit
// ASLA daha yeni bellek satirlarini ezmez. "Yuklu" fetchedAt bu modulde tutulur; refreshLcxStockRows da satir kurunca onu gunceller.
describe('hydrateLcxStockRows: bellekteki listeden daha yeni kayit uygulanir, eski kayit uygulanmaz', () => {
    const symbols = () => lcxStockRows().map((r) => r.symbol)

    it('yeni hisse eklenmis DAHA YENI kayit uygulanir; sonra gelen ESKI kayit bellegi ezmez', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ fetchedAt: NOW - 30_000, rows: [TSLAC] }) })
        await hydrateLcxStockRows({ storage, now: () => NOW })
        expect(symbols()).toEqual(['TSLAC'])

        storage.data[LCX_STOCK_ROWS_KEY] = record({ fetchedAt: NOW - 10_000, rows: [TSLAC, GMEON] })
        expect(await hydrateLcxStockRows({ storage, now: () => NOW })).toBe(2)
        expect(symbols()).toEqual(['TSLAC', 'GMEON'])

        storage.data[LCX_STOCK_ROWS_KEY] = record({ fetchedAt: NOW - 90_000, rows: [GMEON] })
        expect(await hydrateLcxStockRows({ storage, now: () => NOW })).toBe(2)
        expect(symbols()).toEqual(['TSLAC', 'GMEON'])
    })

    it('ayni fetchedAt yeniden uygulanmaz (bellekteki dizi ayni kalir)', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record() })
        await hydrateLcxStockRows({ storage, now: () => NOW })
        const first = lcxStockRows()

        await hydrateLcxStockRows({ storage, now: () => NOW })

        expect(lcxStockRows()).toBe(first)
    })

    it('refreshLcxStockRows satir kurunca yuklu fetchedAt guncellenir: depoya yazilamadiysa eski depo kaydi daha yeni bellegi ezmez', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ fetchedAt: NOW - 90_000, rows: [GMEON] }) })
        storage.set.mockImplementation(async () => { throw new Error('QUOTA_BYTES') })
        const fetchImpl = vi.fn(async () => reply(200, stocksBody([TSLAC, GMEON])))
        await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl, now: () => NOW })
        expect(symbols()).toEqual(['TSLAC', 'GMEON'])

        expect(await hydrateLcxStockRows({ storage, now: () => NOW })).toBe(2)
        expect(symbols()).toEqual(['TSLAC', 'GMEON'])
    })

    it('taze depo kaydi da ayni kurala uyar: refresh, bellekteki daha yeni listeyi eski kayitla ezmez', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ fetchedAt: NOW - 10_000, rows: [TSLAC, GMEON] }) })
        await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl: vi.fn(), now: () => NOW })
        expect(symbols()).toEqual(['TSLAC', 'GMEON'])

        storage.data[LCX_STOCK_ROWS_KEY] = record({ fetchedAt: NOW - 50_000, rows: [GMEON] })
        const result = await refreshLcxStockRows({ maxAgeMs: 60_000, storage, fetchImpl: vi.fn(), now: () => NOW })

        expect(result).toEqual({ ok: true, count: 2, fetched: false })
        expect(symbols()).toEqual(['TSLAC', 'GMEON'])
    })

    it('katman disaridan bosaltildiysa "yuklu kayit yok" sayilir: ayni kayit yeniden uygulanir', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record() })
        await hydrateLcxStockRows({ storage, now: () => NOW })
        expect(symbols()).toEqual(['TSLAC', 'GMEON'])

        _resetLcxStockRows()
        expect(await hydrateLcxStockRows({ storage, now: () => NOW })).toBe(2)
        expect(symbols()).toEqual(['TSLAC', 'GMEON'])
    })

    it('bellekte kayitsiz (elle kurulmus) satirlar varken depodaki herhangi bir gecerli kayit uygulanir', async () => {
        setLcxStockRows([GMEON], { usEquitiesOpen: true })
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ fetchedAt: NOW - 90_000, rows: [TSLAC] }) })
        expect(await hydrateLcxStockRows({ storage, now: () => NOW })).toBe(1)
        expect(symbols()).toEqual(['TSLAC'])
    })
})

// ROZET BAYATLIGI: usEquitiesOpen sunucuda 24 saate dek bayat sunulabilir, depodaki kayit her yasta olabilir; asOf (sunucunun listeyi LCX'ten
// yukledigi an) 30 dakikadan eskiyse ya da yoksa / gecersizse piyasa rozeti gosterilmez (marketOpen null). 'always' satiri zaten null.
describe('piyasa rozeti bayatligi (asOf)', () => {
    const MIN = 60_000
    const marketOpenOf = () => stockEntry(8453, TSLAC.address).marketOpen

    it('taze asOf (5 dk): usEquitiesOpen degeri rozete gider (acik ve kapali)', async () => {
        for (const open of [true, false]) {
            _resetLcxStockRows()
            const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ asOf: NOW - 5 * MIN, usEquitiesOpen: open }) })
            await hydrateLcxStockRows({ storage, now: () => NOW })
            expect(marketOpenOf()).toBe(open)
        }
    })

    it('sinir: tam 30 dk gecerli, 30 dk + 1 ms bayat (rozet yok)', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ asOf: NOW - 30 * MIN, usEquitiesOpen: true }) })
        await hydrateLcxStockRows({ storage, now: () => NOW })
        expect(marketOpenOf()).toBe(true)

        _resetLcxStockRows()
        await hydrateLcxStockRows({ storage, now: () => NOW + 1 })
        expect(marketOpenOf()).toBeNull()
    })

    it('31 dk eski asOf: marketOpen null (hydrate); satirlarin kendisi yine kurulur', async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ asOf: NOW - 31 * MIN, usEquitiesOpen: true }) })
        expect(await hydrateLcxStockRows({ storage, now: () => NOW })).toBe(2)
        expect(marketOpenOf()).toBeNull()
        expect(stockEntry(56, GMEON.address).marketOpen).toBeNull()
    })

    it('asOf yok / null / sayi degil / sifir: marketOpen null', async () => {
        for (const asOf of [null, undefined, 'dun', 0, -5, NaN]) {
            _resetLcxStockRows()
            const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ asOf, usEquitiesOpen: true }) })
            await hydrateLcxStockRows({ storage, now: () => NOW })
            expect(marketOpenOf(), String(asOf)).toBeNull()
        }
        // asOf alani hic olmayan eski kayit
        _resetLcxStockRows()
        const legacy = record({ usEquitiesOpen: true })
        delete legacy.asOf
        await hydrateLcxStockRows({ storage: memoryStorage({ [LCX_STOCK_ROWS_KEY]: legacy }), now: () => NOW })
        expect(marketOpenOf()).toBeNull()
    })

    it("marketHours 'always' satiri her durumda null kalir (taze asOf da)", async () => {
        const storage = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ asOf: NOW - MIN, usEquitiesOpen: true, rows: [{ ...TSLAC, marketHours: 'always' }] }) })
        await hydrateLcxStockRows({ storage, now: () => NOW })
        expect(marketOpenOf()).toBeNull()
    })

    it('refresh, taze depo kaydi: 31 dk eski asOf -> null, taze asOf -> deger', async () => {
        const stale = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ asOf: NOW - 31 * MIN, usEquitiesOpen: true }) })
        await refreshLcxStockRows({ maxAgeMs: 60_000, storage: stale, fetchImpl: vi.fn(), now: () => NOW })
        expect(marketOpenOf()).toBeNull()

        _resetLcxStockRows()
        const fresh = memoryStorage({ [LCX_STOCK_ROWS_KEY]: record({ asOf: NOW - 2 * MIN, usEquitiesOpen: true }) })
        await refreshLcxStockRows({ maxAgeMs: 60_000, storage: fresh, fetchImpl: vi.fn(), now: () => NOW })
        expect(marketOpenOf()).toBe(true)
    })

    it('refresh, agdan gelen liste: sunucunun asOf degeri 31 dk eskiyse null, 1 sn eskiyse deger; asOf yoksa null', async () => {
        const cases = [
            [{ asOf: NOW - 31 * MIN }, null],
            [{ asOf: NOW - 1_000 }, true],
            [{}, null],
        ]
        for (const [extra, expected] of cases) {
            _resetLcxStockRows()
            const body = { success: true, usEquitiesOpen: true, rows: [TSLAC], ...extra }
            const fetchImpl = vi.fn(async () => reply(200, body))
            await refreshLcxStockRows({ maxAgeMs: 60_000, storage: memoryStorage(), fetchImpl, now: () => NOW })
            expect(marketOpenOf(), JSON.stringify(extra)).toBe(expected)
        }
    })
})

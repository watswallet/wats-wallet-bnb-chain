import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCowReference, REFERENCE_TTL_MS, TRADING_TTL_MS, HTTP_TIMEOUT_MS } from './reference'
import { ISSUER_ASSET_URL } from './config'

const STOCK = Object.freeze({
  symbol: 'SPYx',
  address: '0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48',
  coingeckoId: 'spyx-xstock',
})
const MULT = 1005714560286254000n
const API = 'https://api.test'

const res = (status, body) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) })
const priceBody = (id, price) => ({ tokens: [{ coingecko_id: id, market_data: { priceUSD: price } }] })

function setup({ fetchImpl, multiplier = MULT, startAt = 1_000_000 } = {}) {
  let t = startAt
  const chain = { readMultiplier: vi.fn(async () => multiplier) }
  const fetchFn = fetchImpl ?? vi.fn(async () => res(200, priceBody(STOCK.coingeckoId, 781.3)))
  const ref = createCowReference({ fetchImpl: fetchFn, apiBase: API, chain, now: () => t })
  return { ref, chain, fetchFn, advance: (ms) => (t += ms) }
}

describe('getReference', () => {
  it('SPYx fixture: fiyat 781.30, carpan 1.005714560286254e18 -> reference ~776.86', async () => {
    const { ref, chain, fetchFn } = setup()
    const r = await ref.getReference(1, STOCK)
    expect(r.reference).toBeCloseTo(776.86, 1)
    expect(r.priceUsd).toBe(781.3)
    expect(r.multiplier).toBe(MULT)
    expect(chain.readMultiplier).toHaveBeenCalledWith(1, STOCK.address)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(`${API}/getTokensDataById`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ ids: [STOCK.coingeckoId] })
  })

  it('fiyat yok (bos tokens) -> reference:null', async () => {
    const { ref } = setup({ fetchImpl: vi.fn(async () => res(200, { tokens: [] })) })
    const r = await ref.getReference(1, STOCK)
    expect(r.reference).toBeNull()
    expect(r.priceUsd).toBeNull()
  })

  it('carpan null -> reference:null', async () => {
    const { ref } = setup({ multiplier: null })
    const r = await ref.getReference(1, STOCK)
    expect(r.reference).toBeNull()
    expect(r.multiplier).toBeNull()
    expect(r.priceUsd).toBe(781.3)
  })

  it('fiyat 0 / "x" / NaN / negatif / null -> null', async () => {
    for (const bad of [0, 'x', NaN, -5, null, undefined, '']) {
      const { ref } = setup({ fetchImpl: vi.fn(async () => res(200, priceBody(STOCK.coingeckoId, bad))) })
      expect((await ref.getReference(1, STOCK)).reference, String(bad)).toBeNull()
    }
  })

  it('yanittaki kayit baska coingecko_id tasiyorsa null', async () => {
    const { ref } = setup({ fetchImpl: vi.fn(async () => res(200, priceBody('baska-id', 781.3))) })
    const r = await ref.getReference(1, STOCK)
    expect(r.reference).toBeNull()
    expect(r.priceUsd).toBeNull()
  })

  it('ilk kayit baskaysa dogru id li kaydi bulur', async () => {
    const body = {
      tokens: [
        { coingecko_id: 'baska', market_data: { priceUSD: 1 } },
        { coingecko_id: STOCK.coingeckoId, market_data: { priceUSD: 781.3 } },
      ],
    }
    const { ref } = setup({ fetchImpl: vi.fn(async () => res(200, body)) })
    expect((await ref.getReference(1, STOCK)).priceUsd).toBe(781.3)
  })

  it('basarili sonuc 30 sn onbellekte; sure dolunca yeniden ister', async () => {
    const { ref, fetchFn, advance } = setup()
    await ref.getReference(1, STOCK)
    advance(REFERENCE_TTL_MS - 1)
    await ref.getReference(1, STOCK)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    advance(2)
    await ref.getReference(1, STOCK)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('onbellek zincire gore ayri anahtar', async () => {
    const { ref, fetchFn } = setup()
    await ref.getReference(1, STOCK)
    await ref.getReference(56, STOCK)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('null sonuc onbellege girmez, tekrar denenir', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(res(200, { tokens: [] }))
      .mockResolvedValue(res(200, priceBody(STOCK.coingeckoId, 781.3)))
    const { ref } = setup({ fetchImpl: fetchFn })
    expect((await ref.getReference(1, STOCK)).reference).toBeNull()
    expect((await ref.getReference(1, STOCK)).reference).toBeCloseTo(776.86, 1)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('HTML govdeli 502 ve fetch reddi firlatmaz, null', async () => {
    const html = setup({ fetchImpl: vi.fn(async () => res(502, '<html>Bad Gateway</html>')) })
    expect((await html.ref.getReference(1, STOCK)).reference).toBeNull()
    const ok200html = setup({ fetchImpl: vi.fn(async () => res(200, '<html>x</html>')) })
    expect((await ok200html.ref.getReference(1, STOCK)).reference).toBeNull()
    const rej = setup({ fetchImpl: vi.fn(async () => Promise.reject(new Error('net'))) })
    expect((await rej.ref.getReference(1, STOCK)).reference).toBeNull()
  })

  it('chain.readMultiplier firlatsa bile firlatmaz', async () => {
    const { ref, chain } = setup()
    chain.readMultiplier.mockRejectedValueOnce(new Error('x'))
    const r = await ref.getReference(1, STOCK)
    expect(r.reference).toBeNull()
    expect(r.multiplier).toBeNull()
  })

  it('coingeckoId yoksa fetch yapilmaz, null', async () => {
    const { ref, fetchFn } = setup()
    const r = await ref.getReference(1, { symbol: 'SPYx', address: STOCK.address })
    expect(r.reference).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  describe('zaman asimi', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('asili kalan fetch HTTP_TIMEOUT_MS sonra null doner', async () => {
      const { ref } = setup({ fetchImpl: vi.fn(() => new Promise(() => {})) })
      const pr = ref.getReference(1, STOCK)
      await vi.advanceTimersByTimeAsync(HTTP_TIMEOUT_MS + 10)
      expect((await pr).reference).toBeNull()
    })
  })
})

describe('getTrading', () => {
  const TRADING = { openNow: true, currentPeriod: 'regular', limitsPerPeriod: { regular: { maxOrderFiatValue: '1000' } } }
  const tradingFetch = (body = { symbol: 'SPYx', trading: TRADING }) => vi.fn(async () => res(200, body))

  it('zarfsiz govde -> trading nesnesi; URL katalog sembolunden, credentials omit, no-store', async () => {
    const fetchFn = tradingFetch()
    const { ref } = setup({ fetchImpl: fetchFn })
    const r = await ref.getTrading(STOCK)
    expect(r).toEqual({ ok: true, trading: TRADING })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(ISSUER_ASSET_URL + encodeURIComponent('SPYx'))
    expect(init.credentials).toBe('omit')
    expect(init.cache).toBe('no-store')
  })

  it('data zarfi de kabul edilir', async () => {
    const { ref } = setup({ fetchImpl: tradingFetch({ data: { symbol: 'SPYx', trading: TRADING } }) })
    expect(await ref.getTrading(STOCK)).toEqual({ ok: true, trading: TRADING })
  })

  it('sembol URL de encodeURIComponent li ve katalogdan (ozel karakterli katalog sembolu)', async () => {
    const fetchFn = tradingFetch({ trading: TRADING })
    const { ref } = setup({ fetchImpl: fetchFn })
    await ref.getTrading({ ...STOCK, symbol: 'A/B x' })
    expect(fetchFn.mock.calls[0][0]).toBe(ISSUER_ASSET_URL + 'A%2FB%20x')
  })

  it('500 / reddedilen fetch / bozuk JSON / trading yok -> { ok:false, trading:null }', async () => {
    const hata = { ok: false, trading: null }
    expect(await setup({ fetchImpl: vi.fn(async () => res(500, { trading: TRADING })) }).ref.getTrading(STOCK)).toEqual(hata)
    expect(await setup({ fetchImpl: vi.fn(async () => res(404, { trading: TRADING })) }).ref.getTrading(STOCK)).toEqual(hata)
    expect(await setup({ fetchImpl: vi.fn(async () => Promise.reject(new Error('net'))) }).ref.getTrading(STOCK)).toEqual(hata)
    expect(await setup({ fetchImpl: vi.fn(async () => res(200, '<html>')) }).ref.getTrading(STOCK)).toEqual(hata)
    expect(await setup({ fetchImpl: tradingFetch({ symbol: 'SPYx' }) }).ref.getTrading(STOCK)).toEqual(hata)
  })

  it('govdedeki sembol katalogdakiyle farkliysa -> { ok:false, trading:null }', async () => {
    const hata = { ok: false, trading: null }
    expect(await setup({ fetchImpl: tradingFetch({ symbol: 'QQQx', trading: TRADING }) }).ref.getTrading(STOCK)).toEqual(hata)
    expect(await setup({ fetchImpl: tradingFetch({ data: { symbol: 'QQQx', trading: TRADING } }) }).ref.getTrading(STOCK)).toEqual(hata)
    // govdede sembol hic yoksa kabul edilir
    expect(await setup({ fetchImpl: tradingFetch({ trading: TRADING }) }).ref.getTrading(STOCK)).toEqual({ ok: true, trading: TRADING })
  })

  it('basari 30 sn onbellekte, hata onbellege girmez', async () => {
    const fetchFn = tradingFetch()
    const { ref, advance } = setup({ fetchImpl: fetchFn })
    await ref.getTrading(STOCK)
    advance(TRADING_TTL_MS - 1)
    await ref.getTrading(STOCK)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    advance(2)
    await ref.getTrading(STOCK)
    expect(fetchFn).toHaveBeenCalledTimes(2)

    const hataFetch = vi
      .fn()
      .mockResolvedValueOnce(res(500, ''))
      .mockResolvedValue(res(200, { trading: TRADING }))
    const b = setup({ fetchImpl: hataFetch })
    expect((await b.ref.getTrading(STOCK)).ok).toBe(false)
    expect((await b.ref.getTrading(STOCK)).ok).toBe(true)
  })

  it('sembolu olmayan katalog satiri fetch yapmadan ok:false', async () => {
    const fetchFn = tradingFetch()
    const { ref } = setup({ fetchImpl: fetchFn })
    expect(await ref.getTrading({ address: STOCK.address })).toEqual({ ok: false, trading: null })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('asili kalan fetch zaman asiminda ok:false', async () => {
    vi.useFakeTimers()
    try {
      const { ref } = setup({ fetchImpl: vi.fn(() => new Promise(() => {})) })
      const pr = ref.getTrading(STOCK)
      await vi.advanceTimersByTimeAsync(HTTP_TIMEOUT_MS + 10)
      expect(await pr).toEqual({ ok: false, trading: null })
    } finally {
      vi.useRealTimers()
    }
  })
})

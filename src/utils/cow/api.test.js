// CoW HTTP istemcisi: seri kuyruk (2 sn aralik), tek yeniden deneme, 403 denenmez, DuplicatedOrder basari (K9),
// govde korumasi, uid dogrulamasi. Asla firlatmaz. fetch / sleep / now sahtelenir; ag YOK.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createCowApi, parseFeeAmount, parseRetryAfter } from './api'

const FROM = '0x1111111111111111111111111111111111111111'
const UID = '0x' + 'ab'.repeat(56)

const sahteZaman = () => {
  const durum = { t: 0, uykular: [] }
  return {
    durum,
    sleep: async (ms) => { durum.uykular.push(ms); durum.t += ms },
    now: () => durum.t,
  }
}

// cevaplar: { status, headers?, body? (nesne -> JSON; dize -> ham metin) } | { throw: Error }
const sahteFetch = (cevaplar, zaman) => {
  const cagrilar = []
  const fetchImpl = async (url, init) => {
    cagrilar.push({ url, init, at: zaman.durum.t })
    const r = cevaplar.shift()
    if (r.throw) throw r.throw
    const metin = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})
    return { status: r.status, headers: { get: (k) => (r.headers || {})[k.toLowerCase()] ?? null }, text: async () => metin }
  }
  return { cagrilar, fetchImpl }
}

const kur = (cevaplar, opts = {}) => {
  const zaman = sahteZaman()
  const f = sahteFetch(cevaplar, zaman)
  const api = createCowApi({ fetchImpl: f.fetchImpl, sleep: zaman.sleep, now: zaman.now, ...opts })
  return { api, zaman, ...f }
}

const KOTA = { status: 200, body: { quote: { sellAmount: '1', buyAmount: '2', feeAmount: '0' }, id: 7, expiration: '2026-10-14T12:00:00Z', verified: true } }

// Anahtar sirasi bilerek alfabetik DEGIL ve appData kacisli dize: govde birebir JSON.stringify(girdi) olmali
const teklifGirdisi = () => ({
  kind: 'sell',
  sellToken: '0x2222222222222222222222222222222222222222',
  buyToken: '0x3333333333333333333333333333333333333333',
  from: FROM,
  receiver: FROM,
  sellAmountBeforeFee: '1000000',
  appData: '{"appCode":"WatsWallet","metadata":{"x":"a\\"b"}}',
  validFor: 1800,
})

const emirGovdesi = () => ({
  sellToken: '0x2222222222222222222222222222222222222222',
  buyToken: '0x3333333333333333333333333333333333333333',
  receiver: FROM,
  sellAmount: '1000000',
  buyAmount: '5',
  validTo: 1790000000,
  feeAmount: '0',
  kind: 'sell',
  partiallyFillable: false,
  sellTokenBalance: 'erc20',
  buyTokenBalance: 'erc20',
  signingScheme: 'eip712',
  signature: '0x' + '11'.repeat(65),
  from: FROM,
  appData: '{"appCode":"WatsWallet"}',
  appDataHash: '0x' + '22'.repeat(32),
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('parseRetryAfter', () => {
  it('saniye -> ms, tavan, gecersiz -> null', () => {
    expect(parseRetryAfter('3', 5000)).toBe(3000)
    expect(parseRetryAfter('60', 5000)).toBe(5000)
    expect(parseRetryAfter('1.5', 5000)).toBe(1500)
    expect(parseRetryAfter(2, 5000)).toBe(2000)
    expect(parseRetryAfter(null, 5000)).toBeNull()
    expect(parseRetryAfter('', 5000)).toBeNull()
    expect(parseRetryAfter('-1', 5000)).toBeNull()
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', 5000)).toBeNull()
  })
})

describe('hiz: seri kuyruk, >= 2 sn aralik', () => {
  it('iki ardisik istek arasi 2 sn bekler (ilk istek beklemez)', async () => {
    const { api, zaman, cagrilar } = kur([{ ...KOTA }, { ...KOTA }])
    expect((await api.quote(1, teklifGirdisi())).ok).toBe(true)
    expect((await api.quote(1, teklifGirdisi())).ok).toBe(true)
    expect(zaman.durum.uykular).toEqual([2000])
    expect(cagrilar.map((c) => c.at)).toEqual([0, 2000])
  })

  it('3 eszamanli cagri siraya girer: baslangiclar [0, 2000, 4000]', async () => {
    const { api, cagrilar } = kur([
      { status: 200, body: {} }, { status: 200, body: {} }, { status: 200, body: {} },
    ])
    const sonuc = await Promise.all([api.getOrder(1, UID), api.getOrderStatus(56, UID), api.getTrades(42161, UID)])
    expect(sonuc.every((r) => r.ok)).toBe(true)
    expect(cagrilar.map((c) => c.at)).toEqual([0, 2000, 4000])
  })
})

describe('quote', () => {
  it('URL zincir yolu, basliklar, govde JSON.stringify(girdi) BIREBIR', async () => {
    const { api, cagrilar } = kur([{ ...KOTA }, { ...KOTA }, { ...KOTA }])
    const girdi = teklifGirdisi()
    const r = await api.quote(1, girdi)
    await api.quote(56, girdi)
    await api.quote(42161, girdi)
    expect(r).toMatchObject({ ok: true, status: 200 })
    expect(r.data.id).toBe(7)
    expect(cagrilar.map((c) => c.url)).toEqual([
      'https://api.cow.fi/mainnet/api/v1/quote',
      'https://api.cow.fi/bnb/api/v1/quote',
      'https://api.cow.fi/arbitrum_one/api/v1/quote',
    ])
    const init = cagrilar[0].init
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Accept).toBe('application/json')
    expect(init.credentials).toBe('omit')
    expect(init.cache).toBe('no-store')
    expect(init.body).toBe(JSON.stringify(girdi))
  })

  it('quote / id / expiration eksik -> BAD_QUOTE_RESPONSE ve tek cagri; cozulemeyen govde -> BAD_RESPONSE', async () => {
    const eksikler = [
      { status: 200, body: { id: 7, expiration: 'x' } },
      { status: 200, body: { quote: {}, expiration: 'x' } },
      { status: 200, body: { quote: {}, id: 7 } },
      { status: 200, body: { quote: 'dize', id: 7, expiration: 'x' } },
    ]
    for (const e of eksikler) {
      const { api, cagrilar } = kur([e])
      expect(await api.quote(1, teklifGirdisi())).toEqual({ ok: false, code: 'BAD_QUOTE_RESPONSE', status: 200 })
      expect(cagrilar).toHaveLength(1)
    }
    const { api, cagrilar } = kur([{ status: 200, body: '<html>nope</html>' }])
    expect(await api.quote(1, teklifGirdisi())).toEqual({ ok: false, code: 'BAD_RESPONSE', status: 200 })
    expect(cagrilar).toHaveLength(1)
  })

  it('kind != sell ya da receiver != from -> INVALID_REQUEST, fetch cagrilmaz', async () => {
    const kotuler = [
      { ...teklifGirdisi(), kind: 'buy' },
      { ...teklifGirdisi(), receiver: '0x4444444444444444444444444444444444444444' },
      null,
    ]
    for (const g of kotuler) {
      const { api, cagrilar } = kur([])
      expect(await api.quote(1, g)).toEqual({ ok: false, code: 'INVALID_REQUEST' })
      expect(cagrilar).toHaveLength(0)
    }
  })

  it('desteklenmeyen zincir -> UNSUPPORTED_CHAIN, fetch cagrilmaz', async () => {
    const { api, cagrilar } = kur([])
    expect(await api.quote(8453, teklifGirdisi())).toEqual({ ok: false, code: 'UNSUPPORTED_CHAIN' })
    expect(await api.quote('1', teklifGirdisi())).toEqual({ ok: false, code: 'UNSUPPORTED_CHAIN' })
    expect(cagrilar).toHaveLength(0)
  })

  it('404 -> NO_LIQUIDITY (denenmez)', async () => {
    const { api, cagrilar } = kur([{ status: 404, body: { errorType: 'NoLiquidity' } }])
    expect(await api.quote(1, teklifGirdisi())).toEqual({ ok: false, code: 'NO_LIQUIDITY', status: 404 })
    expect(cagrilar).toHaveLength(1)
  })
})

describe('yeniden deneme', () => {
  it('429 Retry-After: 3 -> 3000 uyur, ikinci cagri basarili', async () => {
    const { api, zaman, cagrilar } = kur([{ status: 429, headers: { 'retry-after': '3' }, body: {} }, { ...KOTA }])
    expect((await api.quote(1, teklifGirdisi())).ok).toBe(true)
    expect(zaman.durum.uykular).toEqual([3000])
    expect(cagrilar).toHaveLength(2)
  })

  it('Retry-After: 60 -> 5000 tavani', async () => {
    const { api, zaman } = kur([{ status: 429, headers: { 'retry-after': '60' }, body: {} }, { ...KOTA }])
    await api.quote(1, teklifGirdisi())
    expect(zaman.durum.uykular[0]).toBe(5000)
  })

  it('basliksiz 429 -> 1500 (sonra 2 sn aralik kalani 500)', async () => {
    const { api, zaman } = kur([{ status: 429, body: {} }, { ...KOTA }])
    await api.quote(1, teklifGirdisi())
    expect(zaman.durum.uykular).toEqual([1500, 500])
  })

  it('ikinci de 429 -> RATE_LIMITED, tam 2 cagri', async () => {
    const { api, cagrilar } = kur([{ status: 429, body: {} }, { status: 429, body: {} }, { ...KOTA }])
    expect(await api.quote(1, teklifGirdisi())).toEqual({ ok: false, code: 'RATE_LIMITED', status: 429 })
    expect(cagrilar).toHaveLength(2)
  })

  it('403 -> FORBIDDEN, tek cagri (yeniden deneme YOK)', async () => {
    const { api, cagrilar } = kur([{ status: 403, body: { description: 'blocked' } }, { ...KOTA }])
    expect(await api.quote(1, teklifGirdisi())).toEqual({ ok: false, code: 'FORBIDDEN', status: 403 })
    expect(cagrilar).toHaveLength(1)
  })

  it('500 -> bir yeniden deneme sonra SERVER (2 cagri); HTML govdeli 502 -> SERVER', async () => {
    const a = kur([{ status: 500, body: {} }, { status: 500, body: {} }, { ...KOTA }])
    expect(await a.api.quote(1, teklifGirdisi())).toEqual({ ok: false, code: 'SERVER', status: 500 })
    expect(a.cagrilar).toHaveLength(2)
    const b = kur([{ status: 502, body: '<html><body>Bad Gateway</body></html>' }, { status: 502, body: '<html>502</html>' }])
    expect(await b.api.quote(1, teklifGirdisi())).toEqual({ ok: false, code: 'SERVER', status: 502 })
    expect(b.cagrilar).toHaveLength(2)
  })

  it('500 sonra 200 -> basari', async () => {
    const { api, cagrilar } = kur([{ status: 500, body: {} }, { ...KOTA }])
    expect((await api.quote(1, teklifGirdisi())).ok).toBe(true)
    expect(cagrilar).toHaveLength(2)
  })

  it('fetch reddi -> NETWORK (1 yeniden deneme), FIRLATMAZ', async () => {
    const { api, cagrilar } = kur([{ throw: new TypeError('Failed to fetch') }, { throw: new TypeError('Failed to fetch') }])
    expect(await api.quote(1, teklifGirdisi())).toEqual({ ok: false, code: 'NETWORK' })
    expect(cagrilar).toHaveLength(2)
  })

  it('sonsuz bekleyen fetch + 10 sn -> TIMEOUT (2 cagri)', async () => {
    vi.useFakeTimers()
    const zaman = sahteZaman()
    let cagri = 0
    const fetchImpl = () => { cagri++; return new Promise(() => {}) }
    const api = createCowApi({ fetchImpl, sleep: zaman.sleep, now: zaman.now })
    const p = api.quote(1, teklifGirdisi())
    await vi.advanceTimersByTimeAsync(9_999)
    expect(cagri).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await p).toEqual({ ok: false, code: 'TIMEOUT' })
    expect(cagri).toBe(2)
  })

  it('zaman asimi AbortController sinyalini tetikler', async () => {
    vi.useFakeTimers()
    const zaman = sahteZaman()
    const sinyaller = []
    const fetchImpl = (url, init) => { sinyaller.push(init.signal); return new Promise(() => {}) }
    const api = createCowApi({ fetchImpl, sleep: zaman.sleep, now: zaman.now, maxRetries: 0 })
    const p = api.getOrder(1, UID)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await p).toEqual({ ok: false, code: 'TIMEOUT' })
    expect(sinyaller[0].aborted).toBe(true)
  })
})

describe('postOrder', () => {
  it('201 govde JSON dize -> data = uid; URL ve govde birebir', async () => {
    const { api, cagrilar } = kur([{ status: 201, body: JSON.stringify(UID) }])
    const g = emirGovdesi()
    expect(await api.postOrder(56, g)).toEqual({ ok: true, data: UID, status: 201 })
    expect(cagrilar[0].url).toBe('https://api.cow.fi/bnb/api/v1/orders')
    expect(cagrilar[0].init.method).toBe('POST')
    expect(cagrilar[0].init.body).toBe(JSON.stringify(g))
  })

  it('201 ama dize olmayan govde -> BAD_RESPONSE', async () => {
    const { api } = kur([{ status: 201, body: { x: 1 } }])
    expect(await api.postOrder(1, emirGovdesi())).toEqual({ ok: false, code: 'BAD_RESPONSE', status: 201 })
  })

  it('400 DuplicatedOrder -> ok:true, duplicated:true (tek cagri)', async () => {
    const { api, cagrilar } = kur([{ status: 400, body: { errorType: 'DuplicatedOrder', description: 'order already exists' } }])
    expect(await api.postOrder(1, emirGovdesi())).toEqual({ ok: true, data: null, status: 400, duplicated: true })
    expect(cagrilar).toHaveLength(1)
  })

  it('once zaman asimi / ag hatasi sonra 400 Duplicated -> basari (2 cagri)', async () => {
    const { api, cagrilar } = kur([
      { throw: new TypeError('Failed to fetch') },
      { status: 400, body: { errorType: 'DuplicatedOrder' } },
    ])
    expect(await api.postOrder(1, emirGovdesi())).toMatchObject({ ok: true, duplicated: true })
    expect(cagrilar).toHaveLength(2)
  })

  it('InsufficientBalance / InsufficientAllowance / ExcessiveValidTo eslemesi, bilinmeyen 400 -> REJECTED + detail', async () => {
    const t = async (errorType) => {
      const { api } = kur([{ status: 400, body: { errorType } }])
      return api.postOrder(1, emirGovdesi())
    }
    expect(await t('InsufficientBalance')).toMatchObject({ ok: false, code: 'INSUFFICIENT_BALANCE' })
    expect(await t('InsufficientAllowance')).toMatchObject({ ok: false, code: 'INSUFFICIENT_ALLOWANCE' })
    expect(await t('ExcessiveValidTo')).toMatchObject({ ok: false, code: 'CLOCK_SKEW' })
    expect(await t('GaripHata')).toEqual({ ok: false, code: 'REJECTED', status: 400, detail: 'GaripHata' })
  })

  it('govde korumasi: alan ihlali -> INVALID_ORDER ve fetch HIC cagrilmaz', async () => {
    const ihlaller = {
      feeAmount: { feeAmount: '1' },
      kind: { kind: 'buy' },
      receiver: { receiver: '0x4444444444444444444444444444444444444444' },
      signingScheme: { signingScheme: 'presign' },
      partiallyFillable: { partiallyFillable: true },
      sellTokenBalance: { sellTokenBalance: 'external' },
      buyTokenBalance: { buyTokenBalance: 'internal' },
      appDataNesne: { appData: { appCode: 'x' } },
    }
    for (const [ad, yama] of Object.entries(ihlaller)) {
      const { api, cagrilar } = kur([{ status: 201, body: JSON.stringify(UID) }])
      expect(await api.postOrder(1, { ...emirGovdesi(), ...yama }), ad).toEqual({ ok: false, code: 'INVALID_ORDER' })
      expect(cagrilar, ad).toHaveLength(0)
    }
    const { api, cagrilar } = kur([])
    expect(await api.postOrder(1, null)).toEqual({ ok: false, code: 'INVALID_ORDER' })
    expect(cagrilar).toHaveLength(0)
  })

  it('desteklenmeyen zincir -> UNSUPPORTED_CHAIN, fetch cagrilmaz', async () => {
    const { api, cagrilar } = kur([])
    expect(await api.postOrder(10, emirGovdesi())).toEqual({ ok: false, code: 'UNSUPPORTED_CHAIN' })
    expect(cagrilar).toHaveLength(0)
  })
})

describe('getOrder / getOrderStatus / getTrades', () => {
  it('URL bicimleri, GET, govde yok', async () => {
    const { api, cagrilar } = kur([
      { status: 200, body: { status: 'open' } }, { status: 200, body: { type: 'open' } }, { status: 200, body: [] },
    ])
    expect(await api.getOrder(1, UID)).toEqual({ ok: true, data: { status: 'open' }, status: 200 })
    await api.getOrderStatus(56, UID)
    expect(await api.getTrades(42161, UID)).toEqual({ ok: true, data: [], status: 200 })
    expect(cagrilar.map((c) => c.url)).toEqual([
      `https://api.cow.fi/mainnet/api/v1/orders/${UID}`,
      `https://api.cow.fi/bnb/api/v1/orders/${UID}/status`,
      `https://api.cow.fi/arbitrum_one/api/v2/trades?orderUid=${UID}`,
    ])
    for (const c of cagrilar) {
      expect(c.init.method).toBe('GET')
      expect(c.init.body).toBeUndefined()
      expect(c.init.credentials).toBe('omit')
      expect(c.init.cache).toBe('no-store')
    }
  })

  it('404 -> ORDER_NOT_FOUND (getOrder, durum, islemler); POST emirde 404 -> REJECTED', async () => {
    const { api } = kur([{ status: 404, body: {} }, { status: 404, body: {} }, { status: 404, body: {} }, { status: 404, body: {} }])
    expect(await api.getOrderStatus(1, UID)).toMatchObject({ ok: false, code: 'ORDER_NOT_FOUND' })
    expect(await api.getTrades(1, UID)).toMatchObject({ ok: false, code: 'ORDER_NOT_FOUND' })
    expect(await api.getOrder(1, UID)).toMatchObject({ ok: false, code: 'ORDER_NOT_FOUND' })
    expect(await api.postOrder(1, emirGovdesi())).toMatchObject({ ok: false, code: 'REJECTED' })
  })

  it('GET /orders/{uid} 400 DuplicatedOrder basari SAYILMAZ (kisa devre yalniz POST)', async () => {
    const { api } = kur([{ status: 400, body: { errorType: 'DuplicatedOrder' } }])
    const r = await api.getOrder(1, UID)
    expect(r.ok).toBe(false)
    expect(r.duplicated).toBeUndefined()
  })

  it('200 ama cozulemeyen govde -> BAD_RESPONSE', async () => {
    const { api } = kur([{ status: 200, body: 'not json' }])
    expect(await api.getOrder(1, UID)).toEqual({ ok: false, code: 'BAD_RESPONSE', status: 200 })
  })

  it('kisa, uzun, ? iceren, 0x siz uid ve desteklenmeyen zincir: fetch cagrilmaz', async () => {
    const kotuUidler = [
      '0x' + 'ab'.repeat(55),
      '0x' + 'ab'.repeat(57),
      UID + '?x=1',
      UID.slice(0, -2) + '/?',
      'ab'.repeat(56),
      '0x' + 'zz'.repeat(56),
      undefined,
      12345,
    ]
    for (const uid of kotuUidler) {
      for (const yontem of ['getOrder', 'getOrderStatus', 'getTrades']) {
        const { api, cagrilar } = kur([])
        expect(await api[yontem](1, uid), `${yontem} ${String(uid)}`).toEqual({ ok: false, code: 'INVALID_REQUEST' })
        expect(cagrilar).toHaveLength(0)
      }
    }
    const { api, cagrilar } = kur([])
    expect(await api.getOrder(5, UID)).toEqual({ ok: false, code: 'UNSUPPORTED_CHAIN' })
    expect(await api.getTrades('1', UID)).toEqual({ ok: false, code: 'UNSUPPORTED_CHAIN' })
    expect(cagrilar).toHaveLength(0)
  })

  it('buyuk harfli uid kabul edilir', async () => {
    const { api, cagrilar } = kur([{ status: 200, body: {} }])
    const buyuk = '0x' + 'AB'.repeat(56)
    expect((await api.getOrder(1, buyuk)).ok).toBe(true)
    expect(cagrilar[0].url.endsWith(buyuk)).toBe(true)
  })
})

describe('quote: AMOUNT_TOO_SMALL govdesinden ag ucreti (fee_amount)', () => {
  const kucuk = (data) => ({ status: 400, body: { errorType: 'SellAmountDoesNotCoverFee', description: 'ham metin', data } })

  it('ondalik dize -> feeAtoms rakam dizesi', async () => {
    const { api } = kur([kucuk({ fee_amount: '1407872' })])
    expect(await api.quote(1, teklifGirdisi())).toEqual({ ok: false, code: 'AMOUNT_TOO_SMALL', status: 400, feeAtoms: '1407872' })
  })

  it('0x hex dize -> ondalik feeAtoms', async () => {
    const { api } = kur([kucuk({ fee_amount: '0x157c80' })])
    expect((await api.quote(1, teklifGirdisi())).feeAtoms).toBe('1408128')
  })

  it('ust sinir 10^36 gecer, bir fazlasi yok sayilir', async () => {
    const sinir = (10n ** 36n).toString()
    const { api } = kur([kucuk({ fee_amount: sinir }), kucuk({ fee_amount: (10n ** 36n + 1n).toString() })])
    expect((await api.quote(1, teklifGirdisi())).feeAtoms).toBe(sinir)
    expect('feeAtoms' in (await api.quote(1, teklifGirdisi()))).toBe(false)
  })

  it('bozuk / negatif / sifir / sayi / nesne / asiri uzun -> yok sayilir, kod ayni', async () => {
    const kotuler = ['-5', '0', '0x0', '0x', '12.5', '1e30', ' 5', '5 ', '0xZZ', 'abc', '', 5, 1e6, null, {}, ['5'], true, '9'.repeat(41), '0x' + 'f'.repeat(41)]
    for (const fee_amount of kotuler) {
      const { api } = kur([kucuk({ fee_amount })])
      const r = await api.quote(1, teklifGirdisi())
      expect(r).toEqual({ ok: false, code: 'AMOUNT_TOO_SMALL', status: 400 })
    }
  })

  it('data yok / dizi / ilkel -> yok sayilir', async () => {
    for (const data of [undefined, null, [], 'x', 7, { baska: '5' }]) {
      const { api } = kur([kucuk(data)])
      expect(await api.quote(1, teklifGirdisi())).toEqual({ ok: false, code: 'AMOUNT_TOO_SMALL', status: 400 })
    }
  })

  it('ham govde ve metin sonuca TASINMAZ (yalniz dogrulanmis sayi)', async () => {
    const { api } = kur([kucuk({ fee_amount: '99', gizli: 'SIR' })])
    const r = await api.quote(1, teklifGirdisi())
    expect(Object.keys(r).sort()).toEqual(['code', 'feeAtoms', 'ok', 'status'])
    expect(JSON.stringify(r)).not.toContain('SIR')
    expect(JSON.stringify(r)).not.toContain('ham metin')
  })

  it('baska hata turunde (NoLiquidity) fee_amount okunmaz', async () => {
    const { api } = kur([{ status: 400, body: { errorType: 'NoLiquidity', data: { fee_amount: '5' } } }])
    expect('feeAtoms' in (await api.quote(1, teklifGirdisi()))).toBe(false)
  })

  it('emir (POST /orders) hatasinda feeAtoms yok', async () => {
    const { api } = kur([kucuk({ fee_amount: '5' })])
    expect('feeAtoms' in (await api.postOrder(1, emirGovdesi()))).toBe(false)
  })

  it('parseFeeAmount: dogrudan', () => {
    expect(parseFeeAmount('12')).toBe('12')
    expect(parseFeeAmount('0x0c')).toBe('12')
    expect(parseFeeAmount('0X0c')).toBeNull()
    expect(parseFeeAmount('012')).toBe('12')
    expect(parseFeeAmount(undefined)).toBeNull()
  })
})

describe('gizlilik', () => {
  it('hicbir hata yolunda console.* cagrilmaz', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((k) => vi.spyOn(console, k).mockImplementation(() => {}))
    const yollar = [
      [{ status: 400, body: { errorType: 'GaripHata', description: 'gizli?' } }],
      [{ status: 500, body: '<html>' }, { status: 500, body: '<html>' }],
      [{ status: 429, body: {} }, { status: 429, body: {} }],
      [{ status: 403, body: {} }],
      [{ throw: new TypeError('Failed to fetch') }, { throw: new TypeError('Failed to fetch') }],
      [{ status: 200, body: 'bozuk' }],
      [{ status: 400, body: { errorType: 'DuplicatedOrder' } }],
    ]
    for (const cevaplar of yollar) {
      const { api } = kur(cevaplar)
      await api.postOrder(1, emirGovdesi())
      const ikinci = kur([...cevaplar])
      await ikinci.api.quote(1, teklifGirdisi())
    }
    const { api } = kur([])
    await api.postOrder(1, { ...emirGovdesi(), feeAmount: '5' })
    await api.getOrder(1, 'kotu')
    for (const s of spies) expect(s).not.toHaveBeenCalled()
  })
})

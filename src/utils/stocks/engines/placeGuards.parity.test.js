// Gorev 7 / duzeltme turu 1 (R8): pancake ve lcx motorlarinin `place` korumalarinin PARITE testi.
//
// Ortak saf parcalar (sanitizeTokenData, normalizeAtsQuoted, finitePositive, placeFail, send) placeGuards.js'te TEK kaynaktir; ama iki
// motorun `place` DIZILERI ayridir (mesaj alanlari farkli). Bu dosya AYNI girdi tablosunu iki motorun `place`inden (her biri icin
// gecerli bir teklifle) gecirir ve satir basina AYNI sonucu ister: sonuc kodu, SWAP gitti mi, mesajdaki atsQuoted ve kimlik meta'si.
// Bir motorun korumasi tek basina sikilastirilirsa / gevsetilirse ilgili satir kirmizi olur. Her satirin beklenen sonucu da
// elle sabitlenir: iki motor ayni yone birlikte kayarsa da yakalanir.
//
// Bilincli FARKLAR (parite disi): pancake'e ozgu hata metinleri (BSTOCK_MULTIPLIER_ERROR, Unsupported chain, XSTOCK_USE_COW) ve LCX'e
// ozgu `code` esleme tablosu (lcxEngine.test.js) burada YOKTUR.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BSTOCKS } from '../../../data/bStocks'
import { _resetLcxStockRows, setLcxStockRows } from '../../tokenizedStocks'
import { createLcxEngine } from './lcxEngine'
import { createPancakeEngine } from './pancakeEngine'

const NOW = 1_800_000_000_000
const DERIVATION = "m/44'/60'/0'/0/0"
const IMPORTED = '0x1234567890123456789012345678901234567890'

// --- pancake: BSC bStocks, USDT ile Al
const BSTOCK = BSTOCKS[0].address
const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955'
// --- lcx: Base TSLAC, USDC ile Al
const TSLAC = '0xb2000000000000000000001e800a7f5189430cD0'
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

const pancakeData = () => ({
  expectedOutput: '0.5', minimumReceived: '0.49', priceImpact: '0.30%', liquidityProviderFee: '0.25%', routerType: { name: 'PancakeSwap', version: 3 },
})
const lcxData = () => ({
  expectedOutput: '0.00513279', minimumReceived: '0.00510712', depthGateWarning: false, priceImpact: '0.02%', liquidityProviderFee: 'N/A',
  exchangeRate: '0.002566', reverseExchangeRate: '389.6',
  estimatedGasFee: { totalCost: null, totalCostFormatted: null, totalCostUSD: null, gasType: 'Estimated' },
  routerType: { name: 'lcx' },
  lcxQuote: {
    kind: 'rwa', quoteId: 'q_abc123', chainId: 8453, tokenIn: BASE_USDC, tokenOut: TSLAC, amountIn: '2000000', amountOut: '513279',
    minOut: '510712', slippageBps: 50, expiresAt: NOW / 1000 + 120, spender: '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0',
    rwa: { issuer: 'coinbase', marketOpen: false, refDeviationBps: -26.66, referenceUsd: 388.61, symbol: 'TSLAC', underlying: 'TSLA' },
  },
})

const HARNESSES = [
  {
    name: 'pancake',
    create: (now) => createPancakeEngine({ now }),
    request: (eng) => eng.buildQuoteMessage({ side: 'buy', chainId: 56, stockAddress: BSTOCK, payToken: { address: BSC_USDT }, amount: '100' }),
    data: pancakeData,
    inAddress: BSC_USDT,
    outAddress: BSTOCK,
  },
  {
    name: 'lcx',
    create: (now) => createLcxEngine({ now }),
    request: (eng) => eng.buildQuoteMessage({ side: 'buy', chainId: 8453, stockAddress: TSLAC, payToken: { address: BASE_USDC }, amount: '2' }),
    data: lcxData,
    inAddress: BASE_USDC,
    outAddress: TSLAC,
  },
]

let send
let storage
let replies

function installChrome(h, swap) {
  storage = { active_account: { type: 'derived', derivationPath: DERIVATION, address: '0xabc' }, swap_slippage: 1 }
  replies = { SWAP_QUOTE: { success: true, data: h.data() }, SWAP: swap }
  send = vi.fn(async ({ type }) => {
    const r = replies[type]
    return typeof r === 'function' ? r() : r
  })
  globalThis.chrome = {
    runtime: { sendMessage: send },
    storage: { local: { get: vi.fn(async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in storage).map((k) => [k, storage[k]]))) } },
  }
}

beforeEach(() => {
  setLcxStockRows(
    [{ issuer: 'Coinbase', chainId: 8453, address: TSLAC, symbol: 'TSLAC', name: 'Tesla (Coinbase)', decimals: 8, underlying: 'TSLA', priceUsd: 388.6, marketHours: 'us_equities' }],
    { usEquitiesOpen: false },
  )
  vi.spyOn(console, 'error').mockImplementation(() => {}) // UNKNOWN yollari konsola yazar; bu dosyada beklenen
})

afterEach(() => {
  delete globalThis.chrome
  _resetLcxStockRows()
  vi.restoreAllMocks()
})

// Sonuc: yalniz iki motorda ORTAK olan, karsilastirilabilir alanlar (teklif kimligi ve motora ozel gosterim yok).
const normResult = (r) => (r.ok
  ? { ok: true, kind: r.kind, submitted: r.submitted, hashKind: r.hashKind, hash: r.hash, unverified: r.unverified === true }
  : { ok: false, code: r.code })

// Adres motora gore degisir (USDT/stock ile USDC/TSLAC): karsilastirma icin yer tutucuya cevrilir.
const normMeta = (meta, h) => {
  if (meta === undefined) return undefined
  return { ...meta, address: meta.address === h.inAddress ? '<in>' : meta.address === h.outAddress ? '<out>' : meta.address }
}

/**
 * Bir satiri bir motorda kosar. `args(h, q)` place argumanlarini ezer, `arrange` zamani / depoyu degistirir (teklif alindiktan SONRA),
 * `then` (varsa) ayni teklifle ikinci bir place daha yapar (tek kullanim / yakmama icin).
 */
async function scenario(h, row) {
  let t = NOW
  const eng = h.create(() => t)
  installChrome(h, 'swap' in row ? row.swap : { success: true, hash: '0xuserophash' })
  const q = await eng.quote(h.request(eng))
  expect(q.success, `${h.name} teklif`).toBe(true)
  row.arrange?.({ setTime: (v) => { t = v }, storage })
  const base = { quote: q, request: q.request, accountIndex: DERIVATION, atsQuoted: { transferFee: 0.4, commissionFee: 0.1 } }
  const results = [await eng.place({ ...base, ...(row.args ? row.args(h, q) : {}) })]
  if (row.then) results.push(await eng.place({ ...base, ...row.then(h, q) }))
  const swaps = send.mock.calls.map((c) => c[0]).filter((m) => m.type === 'SWAP')
  const last = swaps.at(-1)?.message
  return {
    results: results.map(normResult),
    swapCount: swaps.length,
    sent: last
      ? { atsSwap: last.atsSwap, atsQuoted: last.atsQuoted, inTokenData: normMeta(last.inTokenData, h), outTokenData: normMeta(last.outTokenData, h) }
      : null,
  }
}

const OK = { ok: true, kind: 'tx', submitted: true, hashKind: 'userOp', hash: '0xuserophash', unverified: false }
const fail = (code) => ({ ok: false, code })
const ATS_FAIL = fail('ATS_BLOCKED')

// Sirayla (paralel DEGIL): iki senaryo ayni chrome stub'ini / send kaydini paylasir.
async function bothEngines(row) {
  const pancake = await scenario(HARNESSES[0], row)
  const lcx = await scenario(HARNESSES[1], row)
  return { pancake, lcx }
}

function runTable(title, rows) {
  describe(title, () => {
    it.each(rows)('%s', async (_name, row, expectedResults, expectedSent) => {
      const { pancake, lcx } = await bothEngines(row)
      // 1) PARITE: iki motor ayni sonucu verir (sonuc kodlari, SWAP sayisi, mesajdaki atsQuoted / kimlik meta'si)
      expect(lcx).toEqual(pancake)
      // 2) SABIT: beklenen sonuc elle yazili (iki motor birlikte kayarsa yakalanir)
      expect(pancake.results).toEqual(expectedResults)
      if (expectedSent !== undefined) expect(pancake.sent).toEqual(expectedSent)
    })
  })
}

const sentWith = (over = {}) => ({ atsSwap: true, atsQuoted: { transferFee: 0.4, commissionFee: 0.1 }, inTokenData: undefined, outTokenData: undefined, ...over })

// ---------------------------------------------------------------------------------------------------------------------------------
// ATS fail-closed kapisi (normalizeAtsQuoted + atsBlocked)
// ---------------------------------------------------------------------------------------------------------------------------------
const ats = (atsQuoted) => ({ args: () => ({ atsQuoted }) })
runTable('atsQuoted: ayni girdi, iki motorda ayni sonuc', [
  ['gecerli sayilar', ats({ transferFee: 0.4, commissionFee: 0.1 }), [OK], sentWith()],
  ['komisyon 0 gecerli', ats({ transferFee: 0.4, commissionFee: 0 }), [OK], sentWith({ atsQuoted: { transferFee: 0.4, commissionFee: 0 } })],
  ['cok kucuk pozitif ucret', ats({ transferFee: 1e-9, commissionFee: 0 }), [OK], sentWith({ atsQuoted: { transferFee: 1e-9, commissionFee: 0 } })],
  ['dize sayilari', ats({ transferFee: '0.4', commissionFee: '0' }), [OK], sentWith({ atsQuoted: { transferFee: 0.4, commissionFee: 0 } })],
  ['bosluklu dize sayilari kirpilir', ats({ transferFee: ' 0.4 ', commissionFee: ' 0.1 ' }), [OK], sentWith()],
  ['karisik sayi ve dize', ats({ transferFee: 0.4, commissionFee: '0.1' }), [OK], sentWith()],
  ['fazla alanlar mesaja GECMEZ', ats({ transferFee: 0.4, commissionFee: 0.1, evil: 1, quoteId: 'x' }), [OK], sentWith()],
  ['atsQuoted yok (undefined)', ats(undefined), [ATS_FAIL], null],
  ['atsQuoted null', ats(null), [ATS_FAIL], null],
  ['atsQuoted bos nesne', ats({}), [ATS_FAIL], null],
  ['atsQuoted dize', ats('0.4'), [ATS_FAIL], null],
  ['atsQuoted sayi', ats(0.4), [ATS_FAIL], null],
  ['atsQuoted true', ats(true), [ATS_FAIL], null],
  ['atsQuoted dizi', ats([0.4, 0.1]), [ATS_FAIL], null],
  ['ucret 0 (arka plan tavani atlardi)', ats({ transferFee: 0, commissionFee: 0.1 }), [ATS_FAIL], null],
  ['ucret 0 dize', ats({ transferFee: '0', commissionFee: '0' }), [ATS_FAIL], null],
  ['negatif ucret', ats({ transferFee: -1, commissionFee: 0 }), [ATS_FAIL], null],
  ['negatif komisyon', ats({ transferFee: 0.4, commissionFee: -0.1 }), [ATS_FAIL], null],
  ['ucret NaN', ats({ transferFee: NaN, commissionFee: 0 }), [ATS_FAIL], null],
  ['ucret Infinity', ats({ transferFee: Infinity, commissionFee: 0 }), [ATS_FAIL], null],
  ['komisyon Infinity', ats({ transferFee: 0.4, commissionFee: Infinity }), [ATS_FAIL], null],
  ['ucret yazi', ats({ transferFee: 'abc', commissionFee: 0 }), [ATS_FAIL], null],
  ['ucret ussel gosterim', ats({ transferFee: '1e3', commissionFee: 0 }), [ATS_FAIL], null],
  ['ucret isaretli dize', ats({ transferFee: '-1', commissionFee: '0' }), [ATS_FAIL], null],
  ['ucret virgullu dize', ats({ transferFee: '0,4', commissionFee: '0' }), [ATS_FAIL], null],
  ['ucret bos dize', ats({ transferFee: '', commissionFee: 0 }), [ATS_FAIL], null],
  ['komisyon bos bosluk', ats({ transferFee: 0.4, commissionFee: ' ' }), [ATS_FAIL], null],
  ['ucret boolean', ats({ transferFee: true, commissionFee: 0 }), [ATS_FAIL], null],
  ['ucret nesne', ats({ transferFee: { v: 1 }, commissionFee: 0 }), [ATS_FAIL], null],
  ['ucret null', ats({ transferFee: null, commissionFee: 0 }), [ATS_FAIL], null],
  ['komisyon alani yok', ats({ transferFee: 0.4 }), [ATS_FAIL], null],
  ['ucret alani yok', ats({ commissionFee: 0.1 }), [ATS_FAIL], null],
  ['atsBlocked true gecerli atsQuoted ile bile engeller', { args: () => ({ atsBlocked: true }) }, [ATS_FAIL], null],
  ['atsBlocked yalniz true degeriyle engeller ("true" dizesi engellemez)', { args: () => ({ atsBlocked: 'true' }) }, [OK], sentWith()],
  ['atsBlocked false engellemez', { args: () => ({ atsBlocked: false }) }, [OK], sentWith()],
  ['atsBlocked true + atsQuoted yok: ATS_BLOCKED', { args: () => ({ atsBlocked: true, atsQuoted: undefined }) }, [ATS_FAIL], null],
  ['ATS reddi teklifi YAKMAZ: ayni teklifle sonraki gecerli place calisir', { args: () => ({ atsQuoted: { transferFee: 0, commissionFee: 0 } }), then: () => ({}) }, [ATS_FAIL, OK], sentWith()],
  ['atsBlocked reddi teklifi YAKMAZ', { args: () => ({ atsBlocked: true }), then: () => ({}) }, [ATS_FAIL, OK], sentWith()],
])

// ---------------------------------------------------------------------------------------------------------------------------------
// Kimlik meta'si (sanitizeTokenData): gecmis karti sembol / logo
// ---------------------------------------------------------------------------------------------------------------------------------
const meta = (over) => ({ args: (h) => over(h) })
const long = 'x'.repeat(513)
runTable('inTokenData / outTokenData: ayni girdi, iki motorda ayni sonuc', [
  ['meta yok', { args: () => ({}) }, [OK], sentWith()],
  ['undefined ve null', { args: () => ({ inTokenData: undefined, outTokenData: null }) }, [OK], sentWith()],
  [
    'gecerli sembol + adres (kucuk harf adres eslesir) + ad + logo; fazla alanlar atilir',
    meta((h) => ({
      inTokenData: { symbol: ' USDX ', name: 'Dollar X', address: h.inAddress.toLowerCase(), image: { large: 'https://x/l.png', small: 'https://x/s.png', evil: 'z' }, display: { price: 1 }, balance: '5' },
      outTokenData: { symbol: 'STK', address: h.outAddress, image: 'https://x/stk.png', logoURI: 'https://x/u.png', logo: 'https://x/o.png', priceUSD: 388 },
    })),
    [OK],
    sentWith({
      inTokenData: { symbol: 'USDX', name: 'Dollar X', address: '<in>', image: { large: 'https://x/l.png', small: 'https://x/s.png' } },
      outTokenData: { symbol: 'STK', address: '<out>', image: 'https://x/stk.png', logoURI: 'https://x/u.png', logo: 'https://x/o.png' },
    }),
  ],
  ['yalniz sembol (adres yok): adres istekten dolar', meta(() => ({ inTokenData: { symbol: 'USDX' } })), [OK], sentWith({ inTokenData: { symbol: 'USDX', address: '<in>' } })],
  ['adres null kabul', meta(() => ({ outTokenData: { symbol: 'STK', address: null } })), [OK], sentWith({ outTokenData: { symbol: 'STK', address: '<out>' } })],
  ['sembolsuz meta atlanir (hata degil)', meta(() => ({ inTokenData: { name: 'sembolsuz' } })), [OK], sentWith()],
  ['bos sembol atlanir', meta(() => ({ inTokenData: { symbol: '   ' } })), [OK], sentWith()],
  ['cok uzun sembol atlanir (512 sinir)', meta(() => ({ inTokenData: { symbol: long } })), [OK], sentWith()],
  ['512 karakter sembol kabul', meta(() => ({ inTokenData: { symbol: 'x'.repeat(512) } })), [OK], sentWith({ inTokenData: { symbol: 'x'.repeat(512), address: '<in>' } })],
  ['sembol sayi: atlanir', meta(() => ({ inTokenData: { symbol: 5 } })), [OK], sentWith()],
  ['cok uzun ad / logo atilir, sembol kalir', meta(() => ({ inTokenData: { symbol: 'USDX', name: long, logo: long, image: long } })), [OK], sentWith({ inTokenData: { symbol: 'USDX', address: '<in>' } })],
  ['bos gorsel nesnesi atilir', meta(() => ({ inTokenData: { symbol: 'USDX', image: { evil: 'z' } } })), [OK], sentWith({ inTokenData: { symbol: 'USDX', address: '<in>' } })],
  ['dizi meta sembolsuz sayilir', meta(() => ({ inTokenData: ['x'] })), [OK], sentWith()],
  ['dize meta: eslesmez', meta(() => ({ outTokenData: 'saçma' })), [fail('QUOTE_MISMATCH')], null],
  ['sayi meta: eslesmez', meta(() => ({ inTokenData: 5 })), [fail('QUOTE_MISMATCH')], null],
  ['boolean meta: eslesmez', meta(() => ({ inTokenData: true })), [fail('QUOTE_MISMATCH')], null],
  ['islemle eslesmeyen adres', meta(() => ({ inTokenData: { symbol: 'USDX', address: '0x2222222222222222222222222222222222222222' } })), [fail('QUOTE_MISMATCH')], null],
  ['adres sayi', meta(() => ({ outTokenData: { symbol: 'STK', address: 5 } })), [fail('QUOTE_MISMATCH')], null],
  ['adres karsi tarafin adresi (yer degistirmis)', meta((h) => ({ inTokenData: { symbol: 'USDX', address: h.outAddress } })), [fail('QUOTE_MISMATCH')], null],
  ['bozuk meta ATS kontrolunden ONCE reddeder', { args: (h) => ({ inTokenData: { symbol: 'USDX', address: h.outAddress }, atsQuoted: undefined }) }, [fail('QUOTE_MISMATCH')], null],
  ['kimlik reddi teklifi YAKMAZ', { args: () => ({ inTokenData: 5 }), then: () => ({}) }, [fail('QUOTE_MISMATCH'), OK], sentWith()],
])

// ---------------------------------------------------------------------------------------------------------------------------------
// place dizisi: ayni sirayla ayni korumalar (iki ayri uygulama, ayni sonuc)
// ---------------------------------------------------------------------------------------------------------------------------------
const IMPORTED_ACCOUNT = { type: 'imported', address: IMPORTED }
runTable('place koruma dizisi: ayni girdi, iki motorda ayni sonuc', [
  ['bilinmeyen quoteId', { args: () => ({ quote: { quoteId: 'yok_999' } }) }, [fail('QUOTE_NOT_FOUND')], null],
  ['quoteId yok', { args: () => ({ quote: {} }) }, [fail('QUOTE_NOT_FOUND')], null],
  ['quote nesnesi yok', { args: () => ({ quote: undefined }) }, [fail('QUOTE_NOT_FOUND')], null],
  ['quoteId sayi', { args: () => ({ quote: { quoteId: 5 } }) }, [fail('QUOTE_NOT_FOUND')], null],
  ['ikinci place: QUOTE_USED, tek SWAP', { then: () => ({}) }, [OK, fail('QUOTE_USED')], sentWith()],
  ['ekran farkli tutar ister', { args: (_h, q) => ({ request: { ...q.request, amount: '999' } }) }, [fail('QUOTE_MISMATCH')], null],
  ['ekran farkli zincir ister', { args: (_h, q) => ({ request: { ...q.request, chainId: 1 } }) }, [fail('QUOTE_MISMATCH')], null],
  ['ekran farkli girdi tokeni ister', { args: (_h, q) => ({ request: { ...q.request, inTokenAddress: IMPORTED } }) }, [fail('QUOTE_MISMATCH')], null],
  ['ekran farkli cikti tokeni ister', { args: (_h, q) => ({ request: { ...q.request, outTokenAddress: IMPORTED } }) }, [fail('QUOTE_MISMATCH')], null],
  ['ekran istegi vermez: kayitli istekten kurulur', { args: () => ({ request: undefined }) }, [OK], sentWith()],
  ['ekranin hesabi farkli', { args: () => ({ accountIndex: IMPORTED }) }, [fail('ACCOUNT_CHANGED')], null],
  ['ekranin hesabi verilmez: depodaki aktif hesap yine denetlenir', { args: () => ({ accountIndex: undefined }) }, [OK], sentWith()],
  ['depodaki aktif hesap degisti', { arrange: ({ storage }) => { storage.active_account = IMPORTED_ACCOUNT } }, [fail('ACCOUNT_CHANGED')], null],
  ['depodaki aktif hesap silindi', { arrange: ({ storage }) => { delete storage.active_account } }, [fail('ACCOUNT_CHANGED')], null],
  ['hesap reddi teklifi YAKMAZ', { args: () => ({ accountIndex: IMPORTED }), then: () => ({}) }, [fail('ACCOUNT_CHANGED'), OK], sentWith()],
  ['omrun son milisaniyesi hala gecerli', { arrange: ({ setTime }) => setTime(NOW + 30_000) }, [OK], sentWith()],
  ['omur doldu', { arrange: ({ setTime }) => setTime(NOW + 30_001) }, [fail('QUOTE_EXPIRED')], null],
  ['omur dolunca kayit silinir: sonraki place bulunamaz', { arrange: ({ setTime }) => setTime(NOW + 30_001), then: () => ({}) }, [fail('QUOTE_EXPIRED'), fail('QUOTE_NOT_FOUND')], null],
  ['QUOTE_MISMATCH once, ATS sonra', { args: (_h, q) => ({ request: { ...q.request, amount: '999' }, atsQuoted: undefined }) }, [fail('QUOTE_MISMATCH')], null],
  ['hesap kaymasi ATS kontrolunden SONRA denetlenir (ATS reddi onde)', { args: () => ({ atsQuoted: undefined }), arrange: ({ storage }) => { storage.active_account = IMPORTED_ACCOUNT } }, [ATS_FAIL], null],
])

// ---------------------------------------------------------------------------------------------------------------------------------
// SWAP yaniti esleme (ortak kisimlar)
// ---------------------------------------------------------------------------------------------------------------------------------
const H64 = `0x${'ab'.repeat(32)}`
const reply = (swap, expected) => [`SWAP yaniti ${typeof swap === 'function' ? 'firlatir' : JSON.stringify(swap)}`, { swap }, [expected], undefined]
runTable('SWAP yaniti: ayni girdi, iki motorda ayni sonuc', [
  reply({ success: true, hash: '0xuserophash' }, OK),
  reply({ success: true }, { ...OK, hash: null, hashKind: null }),
  reply({ success: true, hash: '0xuserophash', unverified: true }, { ...OK, unverified: true }),
  reply({ success: true, hash: '0xuserophash', unverified: 'true' }, OK),
  reply({ error: `islem sonucu dogrulanamadi (txHash: ${H64})` }, { ...OK, hash: H64, unverified: true }),
  reply({ error: 'islem sonucu dogrulanamadi (txHash: 0xkisa)' }, fail('SWAP_FAILED')),
  reply({ error: 'transfer islemi basarisiz veya sonucu dogrulanamadi' }, fail('SWAP_REVERTED')),
  reply({ error: 'Insufficient balance' }, fail('INSUFFICIENT_BALANCE')),
  reply({ error: 'insufficient funds for intrinsic transaction cost' }, fail('INSUFFICIENT_BALANCE')),
  reply({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' }, fail('STOCK_GATE')),
  reply({ error: 'STOCK_GATE:US_PERSON' }, fail('STOCK_GATE')),
  reply({ error: 'ATS ucreti onaylanan tutari asti (1 > 0.5)' }, fail('SWAP_FAILED')),
  reply({ error: 'bilinmeyen' }, fail('SWAP_FAILED')),
  reply({ success: false }, fail('UNKNOWN')),
  reply({}, fail('UNKNOWN')),
  reply(undefined, fail('UNKNOWN')),
  reply(() => { throw new Error('port kapandi') }, fail('UNKNOWN')),
  ['hata sonrasi teklif yanik: ikinci place QUOTE_USED', { swap: { error: 'bilinmeyen' }, then: () => ({}) }, [fail('SWAP_FAILED'), fail('QUOTE_USED')], undefined],
  ['kapi reddi sonrasi teklif yanik', { swap: { error: 'STOCK_GATE:IP_COUNTRY_ISSUER' }, then: () => ({}) }, [fail('STOCK_GATE'), fail('QUOTE_USED')], undefined],
])

describe('es zamanli iki place: iki motorda da yalniz biri SWAP gonderir', () => {
  it.each(HARNESSES.map((h) => [h.name, h]))('%s', async (_n, h) => {
    const eng = h.create(() => NOW)
    let release
    const gate = new Promise((res) => { release = res })
    installChrome(h, () => gate.then(() => ({ success: true, hash: '0xh' })))
    const q = await eng.quote(h.request(eng))
    const args = { quote: q, request: q.request, accountIndex: DERIVATION, atsQuoted: { transferFee: 0.4, commissionFee: 0.1 } }
    const p1 = eng.place(args)
    const p2 = eng.place(args)
    release()
    const [a, b] = await Promise.all([p1, p2])
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    expect([a, b].find((r) => !r.ok).code).toBe('QUOTE_USED')
    expect(send.mock.calls.filter((c) => c[0].type === 'SWAP')).toHaveLength(1)
  })
})

describe('iki motor ayni ortak modulu kullanir (kopya yok)', () => {
  it('pancakeEngine.js ve lcxEngine.js placeGuards.js ten alir; ATS kapisi ve kimlik temizleyici iki dosyada tanimli DEGIL', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['./pancakeEngine.js', './lcxEngine.js']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(src, f).toMatch(/from '\.\/placeGuards'/)
      expect(src, f).not.toMatch(/function normalizeAtsQuoted|function sanitizeTokenData|const finitePositive|const placeFail|const send =/)
    }
  })
})

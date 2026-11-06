// verify:xstocks KOMUTU (scripts/verify-xstocks.mjs): ucundan uca akis, TUM bagimliliklar enjekte
// (RPC, ihracci, CoinGecko, CoW sahte). Kapali piyasada CoW'a HIC sorulmaz; absurt teklif elenir.
//
// Testler katalogun ANLIK icerigine sabitlenmez (controller karari G2): asagidaki KATALOG bu dosyanin
// kendi fixture'idir. Alis fiyatlari 2026-10-10 olcumunden, satis fiyatlari ve referanslar ORNEK degerlerdir.
// Ihracci yanit bicimi GERCEK yanittan (GET api.xstocks.fi/api/v2/public/assets/TSLAx, 2026-10-11) alindi:
// govde kokte, `deployments[]` her ag icin { address, network, wrapperAddress?, stablecoins[] } tasir.
import http from 'node:http'
import { AbiCoder, getAddress } from 'ethers'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { XSTOCKS_IMPLEMENTATIONS } from './xStocks'
import supportedChains from './supported_chains.json'
import { makeLiveDeps, rpcUrlFor, checkPair, formatResultLine, runVerification, main } from '../../scripts/verify-xstocks.mjs'

const E18 = 10n ** 18n
const mk = (symbol, name, hex, coingeckoId, chains) => ({
  symbol, name, address: getAddress('0x' + hex.repeat(20)), chains, coingeckoId, decimals: 18, issuer: 'xstocks',
})
const TSLA = mk('TSLAx', 'Tesla', 'a1', 'tesla-xstock', [1, 56, 42161])
const NVDA = mk('NVDAx', 'NVIDIA', 'b2', 'nvidia-xstock', [1, 56, 42161])
const SPY = mk('SPYx', 'SP500', 'c3', 'sp500-xstock', [1, 56, 42161])
const AAPL = mk('AAPLx', 'Apple', 'd4', 'apple-xstock', [1])
const COIN = mk('COINx', 'Coinbase', 'e5', 'coinbase-xstock', [1])
const MSFT = mk('MSFTx', 'Microsoft', '22', 'microsoft-xstock', [])
// Karisik harfli ama checksum'u YANLIS adres: dogru EIP-55 yazimindan tek bir harfin buyuk/kucuk hali cevrilir.
const bozSumlu = (adres) => {
  const i = adres.split('').findIndex((c, k) => k > 1 && /[a-f]/i.test(c))
  return adres.slice(0, i) + (adres[i] === adres[i].toUpperCase() ? adres[i].toLowerCase() : adres[i].toUpperCase()) + adres.slice(i + 1)
}
const BOZUK_SUMLU = { ...COIN, symbol: 'BOZx', address: bozSumlu(COIN.address) }
const CATALOG = [TSLA, NVDA, SPY, AAPL, COIN]
const KNOWN = [...CATALOG, MSFT]
const KATALOG_CIFTI = CATALOG.reduce((sayi, s) => sayi + s.chains.length, 0)

// CoinGecko HAM fiyatlari (carpanli birim) ve zincirdeki carpanlar (spec Ek B.1)
const REF = {
  'tesla-xstock': 379.3, 'nvidia-xstock': 234.54, 'sp500-xstock': 781.3, 'apple-xstock': 335.4,
  'coinbase-xstock': 176.02, 'microsoft-xstock': 410,
}
const MULT = { 'nvidia-xstock': 1001701196801074000n, 'sp500-xstock': 1005714560286254000n }

// Aday kaynaklari: TSLAx Ethereum (katalogda: elenir), MSFTx Ethereum (yeni hisse), AAPLx BSC (katalog hissesi, yeni zincir)
const TOKEN_LIST = {
  tokens: [
    { chainId: 1, address: TSLA.address.toLowerCase(), symbol: 'TSLAx', name: 'Tesla xStock', decimals: 18 },
    { chainId: 1, address: MSFT.address, symbol: 'MSFTx', name: 'Microsoft xStock', decimals: 18 },
    { chainId: 56, address: AAPL.address.toLowerCase(), symbol: 'AAPLx', name: 'Apple xStock', decimals: 18 },
  ],
}
const COINS_LIST = [
  { id: 'tesla-xstock', platforms: { ethereum: TSLA.address.toLowerCase() } },
  { id: 'microsoft-xstock', platforms: { ethereum: MSFT.address } },
  { id: 'apple-xstock', platforms: { 'binance-smart-chain': AAPL.address.toLowerCase() } },
]

const ACIK = { currentPeriod: 'market', openNow: true, nextChangeAt: '2026-10-09T20:00Z', limitsPerPeriod: { market: { maxOrderFiatValue: 1000000 } } }
const KAPALI = { currentPeriod: 'closed', openNow: false, nextChangeAt: '2026-10-12T00:00Z', limitsPerPeriod: { closed: { maxOrderFiatValue: 0 } } }

const NETWORK = { 1: 'Ethereum', 56: 'BinanceSmartChain', 42161: 'Arbitrum' }
const WRAPPER = '0x43680abf18cf54898be84c6ef78237cfbd441883'

// Gercek yanitin bicimi: kok govde + deployments[] (EVM disi aglar, EVM aglari, sarmalayici, stablecoin gurultusu).
function issuerBody(stock, { open = true, chains = [1, 56, 42161], trading = null } = {}) {
  const address = stock.address.toLowerCase()
  return {
    id: 'x', name: `${stock.name} xStock`, symbol: stock.symbol, trading: trading ?? (open ? ACIK : KAPALI),
    deployments: [
      { address: 'EQB4IwqWZPUczntdry8vSN2tsJKt-9F7iIb7gEFREYYOB563', network: 'Ton', stablecoins: [{ symbol: 'USDT', network: 'Ton', address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs' }] },
      { address: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', network: 'Solana' },
      ...chains.map((chainId) => ({
        address, network: NETWORK[chainId], wrapperAddress: WRAPPER,
        stablecoins: [{ symbol: 'USDC', network: NETWORK[chainId], address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d' }],
      })),
      { address, network: 'Optimism' },
    ],
  }
}

// `extra`: fixture'a eklenen ek hisseler (ham fiyatlari `price` alaninda); `marketCaps`: { coingeckoId: piyasa degeri }.
function makeDeps({ open = true, trading = null, buyUnitOf = () => null, sellUnitOf = () => null, tokenOf = () => ({}), cowFail = null, issuerFail = false, extra = [], marketCaps = {}, tokenList = TOKEN_LIST, coinsList = COINS_LIST } = {}) {
  const calls = { cow: [], issuer: [] }
  const known = [...KNOWN, ...extra]
  const byAddr = new Map(known.map((s) => [s.address.toLowerCase(), s]))
  const rawOf = (id) => REF[id] ?? extra.find((s) => s.coingeckoId === id)?.price
  const refOf = (stock) => rawOf(stock.coingeckoId) / (Number(MULT[stock.coingeckoId] ?? E18) / 1e18)
  return {
    calls,
    loadSources: async () => ({ tokenList, coinsList }),
    prices: async (ids) => Object.fromEntries(ids.map((id) => [id, { usd: rawOf(id), marketCap: marketCaps[id] ?? null }])),
    readToken: async (chainId, address) => {
      const stock = byAddr.get(address.toLowerCase())
      return {
        hasCode: true, symbol: stock.symbol, name: stock.name, decimals: 18, paused: false,
        multiplier: MULT[stock.coingeckoId] ?? E18, implementation: XSTOCKS_IMPLEMENTATIONS[0], ...tokenOf(chainId, stock),
      }
    },
    payDecimals: async (chainId) => (chainId === 56 ? 18 : 6),
    issuerAsset: async (symbol) => {
      calls.issuer.push(symbol)
      if (issuerFail) return { ok: false, error: 'HTTP 503' }
      return { ok: true, body: issuerBody(known.find((s) => s.symbol === symbol), { open, trading }) }
    },
    cow: {
      quote: async (chainId, body) => {
        calls.cow.push({ chainId, body })
        if (cowFail) return cowFail
        const buying = byAddr.has(body.buyToken.toLowerCase())
        const stock = byAddr.get((buying ? body.buyToken : body.sellToken).toLowerCase())
        const ref = refOf(stock)
        const payDecimals = chainId === 56 ? 18 : 6
        if (buying) {
          const unit = buyUnitOf(chainId, stock, ref) ?? ref * 1.002
          const usd = Number(BigInt(body.sellAmountBeforeFee)) / 10 ** payDecimals
          const tokens = BigInt(Math.floor((usd / unit) * 1e6)) * 10n ** 12n
          return { ok: true, verified: false, quote: { sellAmount: String(BigInt(body.sellAmountBeforeFee) - 1200000n), feeAmount: '1200000', buyAmount: String(tokens) } }
        }
        const unit = sellUnitOf(chainId, stock, ref) ?? ref * 0.9985
        const tokens = Number(BigInt(body.sellAmountBeforeFee)) / 1e18
        const usd = BigInt(Math.floor(tokens * unit * 1e6)) * 10n ** BigInt(payDecimals - 6)
        return { ok: true, verified: false, quote: { sellAmount: body.sellAmountBeforeFee, feeAmount: '0', buyAmount: String(usd) } }
      },
    },
  }
}

const sessiz = () => {}
const pair = (sonuc, symbol, chainId) => sonuc.catalogResults.find((r) => r.symbol === symbol && r.chainId === chainId)

describe('runVerification - katalog kapisi', () => {
  it('Review Focus 3: piyasa KAPALI -> hicbir CoW istegi yok, hepsi OLCULEMEDI, cikis kodu 2', async () => {
    const deps = makeDeps({ open: false })
    const sonuc = await runVerification({ catalog: CATALOG, deps, log: sessiz })

    expect(sonuc.exitCode).toBe(2)
    expect(deps.calls.cow).toHaveLength(0)
    expect(sonuc.catalogResults).toHaveLength(KATALOG_CIFTI)
    expect(sonuc.catalogResults.every((r) => r.status === 'unmeasured')).toBe(true)
    expect(sonuc.catalogResults[0].reason).toBe('piyasa kapali, acilis: 2026-10-12T00:00Z')
  })

  it('acik piyasa + adil teklifler: hepsi gecer (cikis 0), her cift icin ALIS ve SATIS teklifi sorulur', async () => {
    const deps = makeDeps()
    const satirlar = []
    const sonuc = await runVerification({ catalog: CATALOG, deps, log: (s) => satirlar.push(s) })

    expect(sonuc.exitCode, satirlar.join('\n')).toBe(0)
    expect(sonuc.catalogResults.every((r) => r.status === 'pass')).toBe(true)
    const ciftler = sonuc.catalogResults.length + sonuc.candidateResults.length
    expect(deps.calls.cow).toHaveLength(ciftler * 2)
    // emir imzasi / gonderimi YOK: yalniz teklif govdeleri
    expect(deps.calls.cow.every((c) => !('signature' in c.body) && c.body.kind === 'sell')).toBe(true)
  })

  it('aday onerileri: yeni hisse EKLE, katalog hissesinin yeni zinciri GUNCELLE (mevcut zincirlerle birlesik)', async () => {
    const sonuc = await runVerification({ catalog: CATALOG, deps: makeDeps(), log: sessiz })

    expect(sonuc.candidateResults.map((r) => `${r.symbol}:${r.chainId}`).sort()).toEqual(['AAPLx:56', 'MSFTx:1'])
    expect(sonuc.suggestions.map((s) => s.action).sort()).toEqual(['EKLE', 'GUNCELLE'])
    const guncelle = sonuc.suggestions.find((s) => s.action === 'GUNCELLE')
    expect(guncelle.entry).toContain("symbol: 'AAPLx'")
    expect(guncelle.entry).toContain('chains: [1, 56]')
    expect(sonuc.suggestions.find((s) => s.action === 'EKLE').entry).toContain("coingeckoId: 'microsoft-xstock'")
  })

  it('Review Focus 3: ETH NVDAx icin CoW 200 dondu ama $1033/token -> HATA, cikis 1; TSLAx gecer', async () => {
    const deps = makeDeps({ buyUnitOf: (chainId, stock) => (chainId === 1 && stock.symbol === 'NVDAx' ? 1033 : null) })
    const sonuc = await runVerification({ catalog: CATALOG, deps, log: sessiz })

    expect(sonuc.exitCode).toBe(1)
    const nvda = pair(sonuc, 'NVDAx', 1)
    expect(nvda.status).toBe('fail')
    expect(nvda.decision.reasons).toEqual(['ALIS_PRIMI_YUKSEK', 'ALIS_SATIS_FARKI_YUKSEK'])
    expect(formatResultLine(nvda)).toMatch(/^HATA\s+NVDAx\s+1\s+ALIS_PRIMI_YUKSEK, ALIS_SATIS_FARKI_YUKSEK/)
    expect(pair(sonuc, 'TSLAx', 1).status).toBe('pass')
  })

  // Kapinin ikinci ayagi: alis makul gorunur ama SATIS teklifi cok dusuk. Yalniz alis primine bakan bir kapi bunu
  // GECIRIRDI; alis-satis farki kapisi yakalar.
  it('yalniz SATIS yonu absurt (alis adil): alis-satis farki kapisi HATA verir', async () => {
    const deps = makeDeps({ sellUnitOf: (chainId, stock, ref) => (chainId === 1 && stock.symbol === 'SPYx' ? ref * 0.5 : null) })
    const sonuc = await runVerification({ catalog: CATALOG, deps, log: sessiz })

    const spy = pair(sonuc, 'SPYx', 1)
    expect(spy.status).toBe('fail')
    expect(spy.decision.reasons).toEqual(['ALIS_SATIS_FARKI_YUKSEK', 'SATIS_ISKONTOSU_YUKSEK'])
    expect(sonuc.exitCode).toBe(1)
  })

  it('implementasyon slotu farkli (sahte token): HATA, CoW a gidilmez', async () => {
    const deps = makeDeps({ tokenOf: (chainId, stock) => (chainId === 56 && stock.symbol === 'TSLAx' ? { implementation: '0x0000000000000000000000000000000000000001' } : {}) })
    const sonuc = await runVerification({ catalog: CATALOG, deps, log: sessiz })

    const tsla56 = pair(sonuc, 'TSLAx', 56)
    expect(tsla56.status).toBe('fail')
    expect(tsla56.problems[0]).toMatch(/SAHTE TOKEN OLABILIR/)
    expect(sonuc.exitCode).toBe(1)
    // Hisse HEM alis (buyToken) HEM satis (sellToken) teklifinde yer alabilir: ikisine de bakilir.
    expect(deps.calls.cow.every((c) => !(c.chainId === 56 && [c.body.buyToken, c.body.sellToken].includes(TSLA.address)))).toBe(true)
  })

  it('CoW 429 tukendi: OLCULEMEDI (2); ihracci API dususu da OLCULEMEDI', async () => {
    const cow429 = await runVerification({ catalog: CATALOG, deps: makeDeps({ cowFail: { ok: false, kind: 'RATE_LIMITED', status: 429 } }), log: sessiz })
    expect(cow429.exitCode).toBe(2)
    expect(cow429.catalogResults[0].reason).toMatch(/RATE_LIMITED/)

    const ihracci = await runVerification({ catalog: CATALOG, deps: makeDeps({ issuerFail: true }), log: sessiz })
    expect(ihracci.exitCode).toBe(2)
    expect(ihracci.catalogResults[0].reason).toMatch(/ihracci API'sine ulasilamadi: HTTP 503/)
  })

  // main(argv) -> parseArgs -> candidateOverride -> candidatesFromSources({ only }) zincirinin son halkasi:
  // aday kumesi yalniz istenen sembollere daralir (tum liste sinanmaz, CoW a bos yere sorulmaz).
  it('candidateOverride aday kumesini daraltir: yalniz istenen sembol sinanir', async () => {
    const tumu = await runVerification({ catalog: CATALOG, deps: makeDeps(), log: sessiz })
    expect(tumu.candidateResults.map((r) => r.symbol).sort()).toEqual(['AAPLx', 'MSFTx'])

    const deps = makeDeps()
    const sonuc = await runVerification({ catalog: CATALOG, candidateOverride: ['MSFTx'], deps, log: sessiz })
    expect(sonuc.candidateResults.map((r) => `${r.symbol}:${r.chainId}`)).toEqual(['MSFTx:1'])
    expect(deps.calls.cow.some((c) => c.chainId === 56 && [c.body.buyToken, c.body.sellToken].includes(AAPL.address))).toBe(false)
  })

  it('aday kaynaklari dusunce UYARI yazar ve yalniz katalogu sinar', async () => {
    const deps = makeDeps()
    deps.loadSources = async () => { throw new Error('aday kaynaklari alinamadi') }
    const satirlar = []
    const sonuc = await runVerification({ catalog: CATALOG, deps, log: (s) => satirlar.push(s) })

    expect(sonuc.candidateResults).toHaveLength(0)
    expect(satirlar.some((s) => s.startsWith('UYARI:'))).toBe(true)
    expect(sonuc.exitCode).toBe(0)
  })

  it('CoinGecko fiyatlari dusunce referans yok: cikis 2 (yanlis referansla gecirmez)', async () => {
    const deps = makeDeps()
    deps.prices = async () => { throw new Error('429') }
    const sonuc = await runVerification({ catalog: CATALOG, deps, log: sessiz })

    expect(sonuc.exitCode).toBe(2)
    expect(sonuc.catalogResults[0].reason).toBe('CoinGecko fiyati alinamadi')
  })
})

// B-01: ihracci dagitim kontrolu (hisse, ZINCIR) basinadir -- deployments[] icinde ilgili ag + ayni adres aranir.
describe('runVerification - katalogdaki bozuk adres tum kosuyu dusurmez (FIN-cekirdek-5)', () => {
  it('yanlis checksum li cift HATA (1), diger ciftler normal sonuc uretir ve kosu tamamlanir', async () => {
    const deps = makeDeps()
    const sonuc = await runVerification({ catalog: [BOZUK_SUMLU, AAPL], deps, log: sessiz })

    expect(sonuc.catalogResults).toHaveLength(2)
    expect(sonuc.catalogResults[0]).toMatchObject({ symbol: 'BOZx', chainId: 1, status: 'fail', problems: ['adres EIP-55 bicimde degil'] })
    expect(sonuc.catalogResults[1]).toMatchObject({ symbol: 'AAPLx', chainId: 1, status: 'pass' })
    expect(sonuc.candidateResults.length).toBeGreaterThan(0)
    expect(sonuc.exitCode).toBe(1)
    expect(deps.calls.issuer).not.toContain('BOZx')
  })

  it('FIN-cekirdek-2: referansin cok altindaki teklif katalog cifti icin cikis 2 (OLCULEMEDI), 1 degil', async () => {
    const deps = makeDeps({ buyUnitOf: (chainId, stock, ref) => (stock.symbol === 'AAPLx' ? ref * 0.5 : null), sellUnitOf: (chainId, stock, ref) => (stock.symbol === 'AAPLx' ? ref * 0.5 : null) })
    const sonuc = await runVerification({ catalog: [TSLA, AAPL], deps, log: sessiz })
    expect(pair(sonuc, 'AAPLx', 1)).toMatchObject({ status: 'unmeasured', reason: expect.stringMatching(/^REFERANS_TUTARSIZ/) })
    expect(sonuc.exitCode).toBe(2)
  })
})

describe('main - komut satiri kullanim hatasi (FIN-cekirdek-4)', () => {
  it('bilinmeyen bayrak: kullanim mesaji, cikis 2, CoW a ve zincire HIC istek yok', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const once = process.exitCode
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await main(['--candidate', 'TSLAx'], {})
      expect(process.exitCode).toBe(2)
      expect(spy).not.toHaveBeenCalled()
      const yazilan = hata.mock.calls.map((c) => c.join(' ')).join(' | ')
      expect(yazilan).toMatch(/bilinmeyen bayrak.*--candidate/)
      expect(yazilan).toMatch(/Kullanim: .*--candidates/)
    } finally {
      hata.mockRestore()
      vi.unstubAllGlobals()
      process.exitCode = once
    }
  })
})

describe('main - --limit kullanim hatasi ve aktarimi', () => {
  it('--limit 229 (ust sinir 228 asildi): kullanim mesaji, cikis 2, HIC istek yok', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const once = process.exitCode
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await main(['--limit', '229'], {})
      expect(process.exitCode).toBe(2)
      expect(spy).not.toHaveBeenCalled()
      const yazilan = hata.mock.calls.map((c) => c.join(' ')).join(' | ')
      expect(yazilan).toMatch(/--limit 1 ile 228/)
      expect(yazilan).toMatch(/Kullanim: .*--limit N/)
    } finally {
      hata.mockRestore()
      vi.unstubAllGlobals()
      process.exitCode = once
    }
  })

  it('--limit N runVerification a aktarilir: N sembol onerilince durur', async () => {
    const deps = makeDeps({ extra: LIMIT_EXTRA, marketCaps: LIMIT_CAPS, ...LIMIT_SOURCES })
    const once = process.exitCode
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await main(['--limit', '2'], {}, { makeDeps: () => deps, catalog: [TSLA] })
      const yazilan = log.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(yazilan).toMatch(/Limit 2, olculen sembol 2, onerilen sembol 2, durma nedeni: limit doldu/)
    } finally {
      log.mockRestore()
      process.exitCode = once
    }
  })
})

// --limit N: adaylar piyasa degeri sirasiyla olculur, N sembol ONERILINCE durulur; katalog hep olculur.
// Fixture: 6 sentetik aday (iki zincirli), piyasa degerleri C2 > C5 > C3 > C1 > C6 > (C4 yok).
const LIMIT_EXTRA = ['1', '2', '3', '4', '5', '6'].map((n, i) => ({
  ...mk(`C${n}x`, `Aday ${n}`, `7${n}`, `c${n}-xstock`, [1, 56]), price: 100 + i * 10,
}))
const LIMIT_CAPS = { 'c1-xstock': 100, 'c2-xstock': 600, 'c3-xstock': 300, 'c5-xstock': 500, 'c6-xstock': 50 }
const LIMIT_SOURCES = {
  tokenList: { tokens: LIMIT_EXTRA.flatMap((s) => [1, 56].map((chainId) => ({ chainId, address: s.address, symbol: s.symbol, name: `${s.name} xStock`, decimals: 18 }))) },
  coinsList: LIMIT_EXTRA.map((s) => ({ id: s.coingeckoId, platforms: { ethereum: s.address, 'binance-smart-chain': s.address } })),
}
const SIRA = ['C2x', 'C5x', 'C3x', 'C1x', 'C6x', 'C4x']

describe('runVerification - piyasa degeri sirali, sinirli olcum (--limit)', () => {
  const kos = (secenek = {}, limit) => {
    const deps = makeDeps({ extra: LIMIT_EXTRA, marketCaps: LIMIT_CAPS, ...LIMIT_SOURCES, ...secenek })
    const satirlar = []
    return runVerification({ catalog: [TSLA], limit, deps, log: (s) => satirlar.push(s) }).then((sonuc) => ({ sonuc, deps, satirlar }))
  }
  const semboller = (sonuc) => [...new Set(sonuc.candidateResults.map((r) => r.symbol))]

  it('siralama: adaylar piyasa degerine gore buyukten kucuge, degeri olmayan en sonda; her sembolun zincirleri art arda', async () => {
    const { sonuc } = await kos({}, 228)
    expect(semboller(sonuc)).toEqual(SIRA)
    expect(sonuc.candidateResults.map((r) => `${r.symbol}:${r.chainId}`)).toEqual(SIRA.flatMap((s) => [`${s}:1`, `${s}:56`]))
    expect(sonuc.stopReason).toBe('aday listesi bitti')
    expect(sonuc.skipped).toEqual({ symbols: 0, pairs: 0 })
  })

  it('durma kosulu: limit 2 -> ilk iki sembol (C2, C5) ONERILINCE durur; ucuncusu hic sorulmaz', async () => {
    const { sonuc, deps, satirlar } = await kos({}, 2)
    expect(semboller(sonuc)).toEqual(['C2x', 'C5x'])
    expect(sonuc.suggestions).toHaveLength(2)
    expect(sonuc.measuredSymbols).toBe(2)
    expect(sonuc.suggestedSymbols).toBe(2)
    expect(sonuc.skipped).toEqual({ symbols: 4, pairs: 8 })
    // Sorulmayan adaylar icin ne ihracci ne CoW istegi atilir
    for (const kalan of ['C3x', 'C1x', 'C6x', 'C4x']) expect(deps.calls.issuer, kalan).not.toContain(kalan)
    // Kalanlar TEK ozet satirinda sayilir (tek tek basilmaz)
    const ozet = satirlar.filter((s) => s.startsWith('OLCULMEDI (limit)'))
    expect(ozet).toHaveLength(1)
    expect(ozet[0]).toMatch(/8 aday cifti \(4 sembol\)/)
    expect(satirlar.some((s) => /C3x|C4x/.test(s))).toBe(false)
    expect(satirlar.at(-1)).toBe('Limit 2, olculen sembol 2, onerilen sembol 2, durma nedeni: limit doldu (2 sembol kapidan gecti)')
  })

  it('yalniz kapidan GECEN sembol sayilir: sembol elenirse limit dolmaz, sonraki aday denenir', async () => {
    // C2 iki zincirde de elenir (sahte implementasyon): sayilmaz. C5 ve C3 gecer -> limit 2 burada dolar.
    const tokenOf = (chainId, stock) => (stock.symbol === 'C2x' ? { implementation: '0x0000000000000000000000000000000000000001' } : {})
    const { sonuc } = await kos({ tokenOf }, 2)
    expect(semboller(sonuc)).toEqual(['C2x', 'C5x', 'C3x'])
    expect(sonuc.candidateResults.filter((r) => r.symbol === 'C2x').every((r) => r.status === 'fail')).toBe(true)
    expect(sonuc.suggestions).toHaveLength(2)
    expect(sonuc.measuredSymbols).toBe(3)
    expect(sonuc.skipped).toEqual({ symbols: 3, pairs: 6 })
  })

  it('bir sembol EN AZ BIR zincirde gecerse sayilir; sembolun kalan zincirleri limit dolsa da olculur', async () => {
    // C2 Ethereum'da gecer, BSC'de elenir; limit 1 -> C2 sayilir ama BSC cifti de olculur, C5'e gecilmez.
    const tokenOf = (chainId, stock) => (stock.symbol === 'C2x' && chainId === 56 ? { implementation: '0x0000000000000000000000000000000000000001' } : {})
    const { sonuc } = await kos({ tokenOf }, 1)
    expect(sonuc.candidateResults.map((r) => `${r.symbol}:${r.chainId}:${r.status}`)).toEqual(['C2x:1:pass', 'C2x:56:fail'])
    expect(sonuc.suggestedSymbols).toBe(1)
    expect(sonuc.skipped).toEqual({ symbols: 5, pairs: 10 })
  })

  it('katalog hisseleri limitten BAGIMSIZ hep olculur (limit 1, 5 hisselik katalog)', async () => {
    const deps = makeDeps({ extra: LIMIT_EXTRA, marketCaps: LIMIT_CAPS, ...LIMIT_SOURCES })
    const sonuc = await runVerification({ catalog: CATALOG, limit: 1, deps, log: sessiz })
    expect(sonuc.catalogResults).toHaveLength(KATALOG_CIFTI)
    expect(sonuc.catalogResults.every((r) => r.status === 'pass')).toBe(true)
    expect(sonuc.exitCode).toBe(0)
    expect(semboller(sonuc)).toEqual(['C2x'])
  })

  it('aday sayisi limitten az: hepsi olculur, durma nedeni "aday listesi bitti", OLCULMEDI satiri yok', async () => {
    const { sonuc, satirlar } = await kos({}, 228)
    expect(sonuc.measuredSymbols).toBe(6)
    expect(satirlar.some((s) => s.startsWith('OLCULMEDI (limit)'))).toBe(false)
    expect(satirlar.at(-1)).toBe('Limit 228, olculen sembol 6, onerilen sembol 6, durma nedeni: aday listesi bitti')
  })

  it('varsayilan limit 50: parametre verilmezse 6 aday tamamen olculur ve ozet "Limit 50" yazar', async () => {
    const deps = makeDeps({ extra: LIMIT_EXTRA, marketCaps: LIMIT_CAPS, ...LIMIT_SOURCES })
    const satirlar = []
    const sonuc = await runVerification({ catalog: [TSLA], deps, log: (s) => satirlar.push(s) })
    expect(sonuc.limit).toBe(50)
    expect(satirlar.at(-1)).toMatch(/^Limit 50, olculen sembol 6/)
  })

  it('CoinGecko fiyatlari/piyasa degerleri alinamazsa adaylar ATLANIR (siralanamaz), katalog yine sinanir, cikis 2', async () => {
    const deps = makeDeps({ extra: LIMIT_EXTRA, marketCaps: LIMIT_CAPS, ...LIMIT_SOURCES })
    deps.prices = async () => { throw new Error('CoinGecko coins/markets istegi basarisiz: HTTP 429') }
    const satirlar = []
    const sonuc = await runVerification({ catalog: [TSLA], deps, log: (s) => satirlar.push(s) })
    expect(sonuc.candidateResults).toHaveLength(0)
    expect(sonuc.catalogResults).toHaveLength(TSLA.chains.length)
    expect(sonuc.exitCode).toBe(2)
    expect(satirlar.some((s) => /^UYARI: CoinGecko fiyatlari alinamadi .*HTTP 429/.test(s))).toBe(true)
    expect(satirlar.some((s) => /adaylar atlandi/.test(s))).toBe(true)
    expect(deps.calls.issuer.every((s) => s === 'TSLAx')).toBe(true)
  })
})

// Fiyati olmayan adaylar (CoinGecko usd yok) HIC olculmez: referans yok -> sonuc onceden belli OLCULEMEDI,
// ama zincir okumasi + ihracci istegi harcanir. Tek "OLCULMEDI (fiyat yok)" ozet satirina yazilirlar.
describe('runVerification - fiyatsiz adaylar olculmez (TTD-R-1)', () => {
  // NP1x piyasa degeri OLAN ama fiyati olmayan (siralamada ilk gelirdi); NP2x ne degeri ne fiyati olan;
  // NP3x CoinGecko'nun usd: 0 dondurdugu (0 fiyat da fiyat sayilmaz).
  const FIYATSIZ = [
    { ...mk('NP1x', 'Fiyatsiz 1', '81', 'np1-xstock', [1, 56]), price: undefined },
    { ...mk('NP2x', 'Fiyatsiz 2', '82', 'np2-xstock', [1]), price: undefined },
    { ...mk('NP3x', 'Fiyatsiz 3', '83', 'np3-xstock', [1]), price: 0 },
  ]
  const extra = [...LIMIT_EXTRA, ...FIYATSIZ]
  const sources = {
    tokenList: { tokens: extra.flatMap((s) => s.chains.map((chainId) => ({ chainId, address: s.address, symbol: s.symbol, name: `${s.name} xStock`, decimals: 18 }))) },
    coinsList: extra.map((s) => ({ id: s.coingeckoId, platforms: { ethereum: s.address, 'binance-smart-chain': s.address } })),
  }
  const kos = async (limit) => {
    const deps = makeDeps({ extra, marketCaps: { ...LIMIT_CAPS, 'np1-xstock': 9e12 }, ...sources })
    const satirlar = []
    const sonuc = await runVerification({ catalog: [TSLA], limit, deps, log: (s) => satirlar.push(s) })
    return { sonuc, deps, satirlar }
  }

  it('fiyatsiz sembol icin ne ihracci ne CoW istegi atilir; fiyatlilar siradan olculur', async () => {
    const { sonuc, deps } = await kos(228)
    for (const s of ['NP1x', 'NP2x', 'NP3x']) expect(deps.calls.issuer, s).not.toContain(s)
    const fiyatsizAdresler = FIYATSIZ.map((s) => s.address.toLowerCase())
    expect(deps.calls.cow.some((c) => fiyatsizAdresler.includes(c.body.buyToken.toLowerCase()) || fiyatsizAdresler.includes(c.body.sellToken.toLowerCase()))).toBe(false)
    expect([...new Set(sonuc.candidateResults.map((r) => r.symbol))]).toEqual(SIRA)
    // fiyatsizlar olculemedi sayisini sismirmez
    expect(sonuc.candidateResults.some((r) => r.status === 'unmeasured')).toBe(false)
  })

  it('tek ozet satiri: "OLCULMEDI (fiyat yok)" cift + sembol sayisini yazar; semboller tek tek basilmaz; donus nesnesinde noPrice', async () => {
    const { sonuc, satirlar } = await kos(228)
    const ozet = satirlar.filter((s) => s.startsWith('OLCULMEDI (fiyat yok)'))
    expect(ozet).toHaveLength(1)
    expect(ozet[0]).toMatch(/4 aday cifti \(3 sembol\)/)
    expect(satirlar.some((s) => /NP1x|NP2x|NP3x/.test(s))).toBe(false)
    expect(sonuc.noPrice).toEqual({ symbols: 3, pairs: 4 })
    expect(satirlar.at(-1)).toBe('Limit 228, olculen sembol 6, onerilen sembol 6, durma nedeni: aday listesi bitti')
    // baslik yalniz olculecek adaylari sayar
    expect(satirlar[0]).toMatch(/12 aday cifti \(6 sembol; limit 228\)/)
  })

  it('limit doldugunda iki ozet satiri ayri ayri yazilir (limit + fiyat yok)', async () => {
    const { sonuc, satirlar } = await kos(2)
    expect(satirlar.filter((s) => s.startsWith('OLCULMEDI (limit)'))).toHaveLength(1)
    expect(satirlar.filter((s) => s.startsWith('OLCULMEDI (fiyat yok)'))).toHaveLength(1)
    expect(sonuc.skipped).toEqual({ symbols: 4, pairs: 8 })
    expect(sonuc.noPrice).toEqual({ symbols: 3, pairs: 4 })
  })

  it('hepsi fiyatli ise ozet satiri yok ve noPrice sifir', async () => {
    const deps = makeDeps({ extra: LIMIT_EXTRA, marketCaps: LIMIT_CAPS, ...LIMIT_SOURCES })
    const satirlar = []
    const sonuc = await runVerification({ catalog: [TSLA], limit: 228, deps, log: (s) => satirlar.push(s) })
    expect(satirlar.some((s) => s.startsWith('OLCULMEDI (fiyat yok)'))).toBe(false)
    expect(sonuc.noPrice).toEqual({ symbols: 0, pairs: 0 })
  })

  it('fiyat gelmezse hicbir aday yok: yalniz fiyatsiz adaylar kalirsa durma nedeni "fiyatli aday yok"', async () => {
    const deps = makeDeps({ extra: FIYATSIZ, ...{
      tokenList: { tokens: FIYATSIZ.flatMap((s) => s.chains.map((chainId) => ({ chainId, address: s.address, symbol: s.symbol, name: `${s.name} xStock`, decimals: 18 }))) },
      coinsList: FIYATSIZ.map((s) => ({ id: s.coingeckoId, platforms: { ethereum: s.address, 'binance-smart-chain': s.address } })),
    } })
    const satirlar = []
    const sonuc = await runVerification({ catalog: [TSLA], deps, log: (s) => satirlar.push(s) })
    expect(sonuc.candidateResults).toHaveLength(0)
    expect(sonuc.stopReason).toBe('fiyatli aday yok')
    expect(deps.calls.issuer.every((s) => s === 'TSLAx')).toBe(true)
    expect(satirlar.some((s) => s.startsWith('OLCULMEDI (fiyat yok)'))).toBe(true)
  })
})

// Backed'in iki implementasyonu kabul edilir (ayni ProxyAdmin ve Safe sahibi, bkz. data/xStocks.js);
// listede olmayan HER adres sahte token olabilir.
describe('runVerification - implementasyon kabul listesi', () => {
  const tamami = (sonuc) => sonuc.catalogResults.every((r) => r.status === 'pass')

  it('listedeki HER implementasyon kabul edilir (eski ve yeni Backed surumu)', async () => {
    expect(XSTOCKS_IMPLEMENTATIONS).toHaveLength(2)
    for (const implementation of XSTOCKS_IMPLEMENTATIONS) {
      const deps = makeDeps({ tokenOf: () => ({ implementation }) })
      const sonuc = await runVerification({ catalog: CATALOG, deps, log: sessiz })
      expect(tamami(sonuc), implementation).toBe(true)
      expect(sonuc.exitCode, implementation).toBe(0)
    }
  })

  it('listede olmayan ucuncu adres SAHTE TOKEN OLABILIR: HATA (1), CoW a gidilmez', async () => {
    // Birine cok benzeyen (son hanesi farkli) adres de ucuncu adrestir.
    const benzer = getAddress(XSTOCKS_IMPLEMENTATIONS[1].toLowerCase().slice(0, -1) + '3')
    for (const implementation of ['0x0000000000000000000000000000000000000001', benzer]) {
      expect(XSTOCKS_IMPLEMENTATIONS).not.toContain(implementation)
      const deps = makeDeps({ tokenOf: () => ({ implementation }) })
      const sonuc = await runVerification({ catalog: CATALOG, deps, log: sessiz })
      expect(sonuc.exitCode, implementation).toBe(1)
      expect(sonuc.catalogResults.every((r) => r.status === 'fail' && /SAHTE TOKEN OLABILIR/.test(r.problems[0])), implementation).toBe(true)
      expect(deps.calls.cow, implementation).toHaveLength(0)
    }
  })

  it('kucuk harfli yazim da ayni adrestir (karsilastirma harf duyarsiz)', async () => {
    const deps = makeDeps({ tokenOf: () => ({ implementation: XSTOCKS_IMPLEMENTATIONS[1].toLowerCase() }) })
    const sonuc = await runVerification({ catalog: CATALOG, deps, log: sessiz })
    expect(tamami(sonuc)).toBe(true)
  })
})

describe('runVerification - ihracci dagitimi (hisse, zincir) basina', () => {
  it('yanit hic dagitim listesi tasimiyorsa OLCULEMEDI (gecti DEGIL)', async () => {
    const adressiz = makeDeps()
    adressiz.issuerAsset = async () => ({ ok: true, body: { symbol: 'x' } })
    const sonuc = await runVerification({ catalog: CATALOG, deps: adressiz, log: sessiz })

    expect(sonuc.catalogResults.every((r) => r.status === 'unmeasured')).toBe(true)
    expect(sonuc.catalogResults[0].reason).toMatch(/yanit bicimi beklenmedik/)
    expect(sonuc.exitCode).toBe(2)
  })

  it('dagitim listesi var ama taninan ag adi yok (ihracci adlari degistirdi): OLCULEMEDI, HATA degil', async () => {
    const deps = makeDeps()
    deps.issuerAsset = async (symbol) => ({
      ok: true,
      body: { ...issuerBody(KNOWN.find((s) => s.symbol === symbol)), deployments: [{ address: TSLA.address.toLowerCase(), network: 'ETH-MAINNET' }] },
    })
    const sonuc = await runVerification({ catalog: CATALOG, deps, log: sessiz })

    expect(sonuc.catalogResults.every((r) => r.status === 'unmeasured')).toBe(true)
    expect(sonuc.exitCode).toBe(2)
  })

  it('ihracci COINx icin ayni agda BASKA adres listeliyorsa HATA', async () => {
    const baskaAdres = makeDeps()
    const asil = baskaAdres.issuerAsset
    baskaAdres.issuerAsset = async (symbol) => {
      if (symbol !== 'COINx') return asil(symbol)
      const body = issuerBody(COIN)
      body.deployments = body.deployments.map((d) => (d.network === 'Ethereum' ? { ...d, address: '0x3333333333333333333333333333333333333333' } : d))
      return { ok: true, body }
    }
    const coin = pair(await runVerification({ catalog: CATALOG, deps: baskaAdres, log: sessiz }), 'COINx', 1)

    expect(coin.status).toBe('fail')
    expect(coin.problems[0]).toMatch(/ihracci API'sinde bu adres yok/)
  })

  it('hisse yalniz Ethereum+Arbitrum dagitilmis: BSC cifti HATA, Ethereum ve Arbitrum cifti gecer', async () => {
    const deps = makeDeps()
    const asil = deps.issuerAsset
    deps.issuerAsset = async (symbol) => (symbol === 'TSLAx' ? { ok: true, body: issuerBody(TSLA, { chains: [1, 42161] }) } : asil(symbol))
    const sonuc = await runVerification({ catalog: CATALOG, deps, log: sessiz })

    const bsc = pair(sonuc, 'TSLAx', 56)
    expect(bsc.status).toBe('fail')
    expect(bsc.problems[0]).toMatch(/ihracci API'sinde bu adres yok/)
    expect(pair(sonuc, 'TSLAx', 1).status).toBe('pass')
    expect(pair(sonuc, 'TSLAx', 42161).status).toBe('pass')
    expect(sonuc.exitCode).toBe(1)
  })

  it('sarmalayici ve stablecoin adresleri dagitim sayilmaz (yalniz deployments[].address)', async () => {
    const deps = makeDeps()
    const asil = deps.issuerAsset
    deps.issuerAsset = async (symbol) => {
      if (symbol !== 'TSLAx') return asil(symbol)
      const body = issuerBody(TSLA)
      // BSC'deki asil adres BASKA; hissenin adresi yalnizca sarmalayici ve stablecoin alanlarinda geciyor
      body.deployments = body.deployments.map((d) => (d.network === 'BinanceSmartChain'
        ? { ...d, address: '0x3333333333333333333333333333333333333333', wrapperAddress: TSLA.address.toLowerCase(), stablecoins: [{ symbol: 'X', address: TSLA.address.toLowerCase() }] }
        : d))
      return { ok: true, body }
    }
    const tsla56 = pair(await runVerification({ catalog: CATALOG, deps, log: sessiz }), 'TSLAx', 56)

    expect(tsla56.status).toBe('fail')
    expect(tsla56.problems[0]).toMatch(/ihracci API'sinde bu adres yok/)
  })
})

// B-02: ag/zaman asimi (okunamadi) ile okunmus-yanlis deger ayri sonuc verir.
describe('runVerification - zincir okuma hatasi ile sapma ayrimi', () => {
  it('tek alanin okuma hatasi: cift OLCULEMEDI (2), CoW a gidilmez', async () => {
    const deps = makeDeps({
      tokenOf: (chainId, stock) => (chainId === 1 && stock.symbol === 'TSLAx' ? { implementation: null, unreadable: ['implementation'] } : {}),
    })
    const sonuc = await runVerification({ catalog: CATALOG, deps, log: sessiz })

    const tsla = pair(sonuc, 'TSLAx', 1)
    expect(tsla.status).toBe('unmeasured')
    expect(tsla.reason).toMatch(/zincir okunamadi: implementation/)
    expect(sonuc.exitCode).toBe(2)
    expect(deps.calls.cow.every((c) => !(c.chainId === 1 && [c.body.buyToken, c.body.sellToken].includes(TSLA.address)))).toBe(true)
  })

  it('okunmus ama yanlis implementasyon: HATA (1)', async () => {
    const deps = makeDeps({ tokenOf: (chainId, stock) => (chainId === 1 && stock.symbol === 'TSLAx' ? { implementation: '0x0000000000000000000000000000000000000002' } : {}) })
    const sonuc = await runVerification({ catalog: CATALOG, deps, log: sessiz })

    expect(pair(sonuc, 'TSLAx', 1).status).toBe('fail')
    expect(sonuc.exitCode).toBe(1)
  })

  it('bir alan yanlis okundu, baska bir alan okunamadi: kesin sapma kazanir (HATA)', async () => {
    const deps = makeDeps({
      tokenOf: (chainId, stock) => (chainId === 1 && stock.symbol === 'TSLAx'
        ? { symbol: 'FAKE', multiplier: null, unreadable: ['multiplier'] }
        : {}),
    })
    const tsla = pair(await runVerification({ catalog: CATALOG, deps, log: sessiz }), 'TSLAx', 1)

    expect(tsla.status).toBe('fail')
    expect(tsla.problems).toEqual(['symbol zincirde "FAKE", katalogda "TSLAx"'])
  })

  it('isPaused() okunamazsa kapiyi bloklamaz, UYARI olur (kapida karar veren alan degil)', async () => {
    const deps = makeDeps({ tokenOf: (chainId, stock) => (chainId === 1 && stock.symbol === 'TSLAx' ? { paused: null, unreadable: ['paused'] } : {}) })
    const tsla = pair(await runVerification({ catalog: CATALOG, deps, log: sessiz }), 'TSLAx', 1)

    expect(tsla.status).toBe('pass')
    expect(tsla.warnings).toEqual(['isPaused() okunamadi'])
  })

  it('odeme tokeni ondaligi okunamazsa cift OLCULEMEDI (komut dusmez)', async () => {
    const deps = makeDeps()
    deps.payDecimals = async () => { throw new Error('timeout') }
    const sonuc = await runVerification({ catalog: CATALOG, deps, log: sessiz })

    expect(sonuc.exitCode).toBe(2)
    expect(sonuc.catalogResults[0].reason).toMatch(/odeme tokeni ondaligi okunamadi: timeout/)
  })
})

// B-03: isPaused uyarisi ve name() cikti satirina yazilir.
describe('formatResultLine - uyari ve ad', () => {
  it('duraklatilmis token: satir UYARI tasir, zincirdeki ad yazilir', async () => {
    const deps = makeDeps({ tokenOf: () => ({ paused: true, name: 'Tesla xStock' }) })
    const sonuc = await checkPair({ stock: TSLA, chainId: 1, deps, state: { prices: Object.fromEntries(Object.entries(REF).map(([k, v]) => [k, { usd: v }])), payDecimals: {} } })
    const satir = formatResultLine({ symbol: 'TSLAx', chainId: 1, ...sonuc })

    expect(sonuc.status).toBe('pass')
    expect(satir).toMatch(/^TAMAM\s+TSLAx\s+1\s+alis /)
    expect(satir).toContain('UYARI: isPaused() true: transferler durdurulmus')
    expect(satir).toContain('Tesla xStock')
  })

  it('uyarisiz token: satirda UYARI yok', async () => {
    const sonuc = await runVerification({ catalog: [TSLA], deps: makeDeps(), log: sessiz })
    const satir = formatResultLine(sonuc.catalogResults[0])

    expect(satir).not.toContain('UYARI')
    expect(satir).toContain('Tesla')
  })

  it('olculemedi ve sapma satirlari da ad tasir', () => {
    expect(formatResultLine({ status: 'unmeasured', symbol: 'TSLAx', chainId: 1, reason: 'piyasa kapali', name: 'Tesla xStock' })).toBe('OLCULEMEDI  TSLAx    1      piyasa kapali [Tesla xStock]')
    expect(formatResultLine({ status: 'fail', symbol: 'TSLAx', chainId: 1, problems: ['a', 'b'], warnings: ['w'], name: 'Tesla xStock' })).toBe('HATA        TSLAx    1      a; b [Tesla xStock] UYARI: w')
  })
})

describe('checkPair - tek cift', () => {
  // FIN-cekirdek-5: getAddress KARISIK harfli ama checksum'u yanlis adreste FIRLATIR; bu cift basina HATA
  // olmali, kosuyu dusurmemeli. Tamami kucuk harfli adres gecerlidir ve EIP-55'e cevrilir.
  it('karisik harfli YANLIS checksum: firlatmaz, cift HATA (adres EIP-55), zincire hic gidilmez', async () => {
    const deps = makeDeps()
    deps.readToken = vi.fn(deps.readToken)
    expect(() => getAddress(BOZUK_SUMLU.address)).toThrow()
    const sonuc = await checkPair({ stock: BOZUK_SUMLU, chainId: 1, deps, state: { prices: {}, payDecimals: {} } })
    expect(sonuc.status).toBe('fail')
    expect(sonuc.problems).toEqual(['adres EIP-55 bicimde degil'])
    expect(deps.readToken).not.toHaveBeenCalled()
    expect(deps.calls.cow).toHaveLength(0)
  })

  it('tamami kucuk harfli adres gecerlidir: EIP-55 e cevrilip kullanilir, sorun YAZILMAZ', async () => {
    const deps = makeDeps()
    const okunan = []
    const readToken = deps.readToken
    deps.readToken = async (chainId, address) => { okunan.push(address); return readToken(chainId, address) }
    const kucuk = { ...TSLA, address: TSLA.address.toLowerCase() }
    const sonuc = await checkPair({ stock: kucuk, chainId: 1, deps, state: { prices: Object.fromEntries(Object.entries(REF).map(([k, v]) => [k, { usd: v }])), payDecimals: {} } })
    expect(okunan).toEqual([TSLA.address])
    expect(sonuc.status).toBe('pass')
    expect(deps.calls.cow.every((c) => [c.body.sellToken, c.body.buyToken].includes(TSLA.address))).toBe(true)
  })

  it('FIN-cekirdek-2: alis ve satis referansin cok altinda (carpan hatasi / bayat referans): OLCULEMEDI REFERANS_TUTARSIZ, gecti DEGIL', async () => {
    const deps = makeDeps({ buyUnitOf: (chainId, stock, ref) => ref * 0.5, sellUnitOf: (chainId, stock, ref) => ref * 0.5 })
    const sonuc = await checkPair({ stock: TSLA, chainId: 1, deps, state: { prices: Object.fromEntries(Object.entries(REF).map(([k, v]) => [k, { usd: v }])), payDecimals: {} } })
    expect(sonuc.status).toBe('unmeasured')
    expect(sonuc.reason).toMatch(/^REFERANS_TUTARSIZ/)
    expect(formatResultLine({ symbol: 'TSLAx', chainId: 1, ...sonuc })).toMatch(/OLCULEMEDI.*REFERANS_TUTARSIZ.*-50/)
  })

  it('FIN-cekirdek-2: referansin altinda AMA alis-satis farki da yuksek: kesin sapma kazanir, HATA (1) kalir', async () => {
    const deps = makeDeps({ buyUnitOf: (chainId, stock, ref) => ref * 0.5, sellUnitOf: (chainId, stock, ref) => ref })
    const sonuc = await checkPair({ stock: TSLA, chainId: 1, deps, state: { prices: Object.fromEntries(Object.entries(REF).map(([k, v]) => [k, { usd: v }])), payDecimals: {} } })
    expect(sonuc.status).toBe('fail')
    expect(sonuc.problems).toEqual(['REFERANS_TUTARSIZ', 'ALIS_SATIS_FARKI_YUKSEK'])
  })

  it('FIN-cekirdek-3: celiskili ihracci girdisi (openNow true, currentPeriod closed, limit baska donemde): CoW a istek yok, OLCULEMEDI', async () => {
    const celiski = { currentPeriod: 'closed', openNow: true, nextChangeAt: '2026-10-12T00:00Z', limitsPerPeriod: { market: { maxOrderFiatValue: 1000 } } }
    const deps = makeDeps({ trading: celiski })
    const sonuc = await checkPair({ stock: TSLA, chainId: 1, deps, state: { prices: Object.fromEntries(Object.entries(REF).map(([k, v]) => [k, { usd: v }])), payDecimals: {} } })
    expect(sonuc.status).toBe('unmeasured')
    expect(sonuc.reason).toMatch(/^PIYASA_DURUMU_BELIRSIZ/)
    expect(deps.calls.cow).toHaveLength(0)
  })

  it('kontrat kodu bos: HATA; isPaused true: UYARI (kapida kalir)', async () => {
    const bos = makeDeps()
    bos.readToken = async () => ({ hasCode: false })
    expect((await checkPair({ stock: TSLA, chainId: 1, deps: bos, state: { prices: REF, payDecimals: {} } })).problems[0]).toMatch(/eth_getCode bos/)

    const duraklatilmis = makeDeps({ tokenOf: () => ({ paused: true }) })
    const sonuc = await checkPair({ stock: TSLA, chainId: 1, deps: duraklatilmis, state: { prices: Object.fromEntries(Object.entries(REF).map(([k, v]) => [k, { usd: v }])), payDecimals: {} } })
    expect(sonuc.status).toBe('pass')
    expect(sonuc.warnings).toEqual(['isPaused() true: transferler durdurulmus'])
  })
})

describe('canli bagimliliklar (makeLiveDeps) - fetch enjekte, RPC yok', () => {
  it('rpcUrlFor: ortam degiskeni, yoksa cuzdanin kendi listesi', () => {
    expect(rpcUrlFor(56, { BSC_RPC_URL: 'https://ozel-rpc' })).toBe('https://ozel-rpc')
    expect(rpcUrlFor(1, {})).toBe(supportedChains.find((c) => c.chainId === 1).rpc[0].url)
    expect(rpcUrlFor(42161, {})).toBe(supportedChains.find((c) => c.chainId === 42161).rpc[0].url)
    expect(rpcUrlFor(999999, {})).toBeNull()
  })

  it('ihracci API hatasi {ok:false} olarak doner (FIRLATMAZ) ve sembol URL e kodlanir', async () => {
    const urller = []
    const deps = makeLiveDeps({
      fetchImpl: async (url) => { urller.push(url); return { ok: false, status: 503, json: async () => ({}) } },
      sleep: async () => {},
    })
    expect(await deps.issuerAsset('TSLAx')).toEqual({ ok: false, error: 'HTTP 503' })
    expect(urller[0]).toBe('https://api.xstocks.fi/api/v2/public/assets/TSLAx')
  })

  it('kaynaklar dusunce loadSources aciklayici hata firlatir', async () => {
    const deps = makeLiveDeps({ fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }), sleep: async () => {} })
    await expect(deps.loadSources()).rejects.toThrow(/aday kaynaklari alinamadi/)
  })

  it('modulu ice aktarmak aga GITMEZ ve cikis kodunu degistirmez', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const once = process.exitCode
    vi.resetModules()
    await import('../../scripts/verify-xstocks.mjs')
    expect(spy).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(once)
    vi.unstubAllGlobals()
  })
})

// KOK NEDEN (2026-10-13 olcumu): prices() tum kimlikleri TEK `simple/price` URL'sine koyuyordu; ~800 kimlik
// ~17,5 bin karakterlik URL eder ve CoinGecko (Cloudflare) 414 "Request-URI Too Large" verir; hata sessizce
// yutuluyor ({}), bu yuzden 14/14 katalog cifti ve 258 aday "CoinGecko fiyati alinamadi" oldu. 8,9 bin
// karakter (400 kimlik) 200 dondu. Yeni yol: `coins/markets`, 250'lik partiler, fiyat + piyasa degeri.
// Asagidaki kayit GERCEK yanittan alindi (GET coins/markets?vs_currency=usd&ids=adobe-xstock, 2026-10-13).
describe('makeLiveDeps.prices - CoinGecko toplu fiyat (414 kok nedeni)', () => {
  const GERCEK_KAYIT = {
    id: 'adobe-xstock', symbol: 'adbex', name: 'Adobe xStock',
    image: 'https://coin-images.coingecko.com/coins/images/69626/large/Ticker_ADBEx__Company_Name_Adobe_Inc__size_200x200.png?1759233243',
    current_price: 234.74, market_cap: 0, market_cap_rank: null, fully_diluted_valuation: 18380475, total_volume: 25.6,
    high_24h: 0, low_24h: 0, price_change_24h: null, price_change_percentage_24h: null, market_cap_change_24h: null,
    market_cap_change_percentage_24h: null, circulating_supply: 0, total_supply: 78299.99592091, max_supply: null,
    ath: 409.85, ath_change_percentage: -42.72413, ath_date: '2026-09-02T22:08:00.000Z', atl: 149.84,
    atl_change_percentage: 56.66012, atl_date: '2026-07-02T19:56:30.000Z', roi: null, last_updated: '2026-09-29T23:53:50.000Z',
  }
  const MAX_URL = 10_000 // olculen: 8910 karakter 200, 17464 karakter 414

  // Sahte CoinGecko: URL siniri asilirsa 414 (govde HTML), coins/markets dizi, simple/price nesne doner.
  function sahteCoinGecko({ kayitlar, sirayla429 = [] }) {
    const istekler = []
    const kuyruk = [...sirayla429]
    const fetchImpl = async (url) => {
      istekler.push(url)
      if (url.length > MAX_URL) return { ok: false, status: 414, headers: new Headers(), json: async () => { throw new Error('html') } }
      if (kuyruk.length) {
        const bekle = kuyruk.shift()
        return { ok: false, status: 429, headers: new Headers(bekle === null ? {} : { 'retry-after': String(bekle) }), json: async () => ({ status: { error_code: 429 } }) }
      }
      const ids = decodeURIComponent(new URL(url).searchParams.get('ids') ?? '').split(',').filter(Boolean)
      const bulunan = ids.filter((id) => kayitlar[id])
      const govde = url.includes('/coins/markets')
        ? bulunan.map((id) => kayitlar[id])
        : Object.fromEntries(ids.map((id) => [id, kayitlar[id] ? { usd: kayitlar[id].current_price } : {}]))
      return { ok: true, status: 200, headers: new Headers(), json: async () => govde }
    }
    return { fetchImpl, istekler }
  }

  const kimlikler = Array.from({ length: 800 }, (_, i) => `hisse${i}-xstock`)
  const kayitlar = Object.fromEntries(kimlikler.map((id, i) => [id, { ...GERCEK_KAYIT, id, current_price: 100 + i, market_cap: i % 3 === 0 ? 0 : 1_000_000 + i }]))

  it('800 kimlik tek uzun URL ile istenmez: her istek <= 250 kimlik ve URL siniri altinda, TUM fiyatlar gelir', async () => {
    const { fetchImpl, istekler } = sahteCoinGecko({ kayitlar })
    const deps = makeLiveDeps({ fetchImpl, sleep: async () => {} })
    const fiyatlar = await deps.prices(kimlikler)

    expect(Object.keys(fiyatlar)).toHaveLength(800)
    expect(fiyatlar['hisse0-xstock'].usd).toBe(100)
    expect(fiyatlar['hisse799-xstock'].usd).toBe(899)
    expect(istekler).toHaveLength(4)
    for (const url of istekler) {
      expect(url.length).toBeLessThan(MAX_URL)
      expect(new URL(url).searchParams.get('ids').split(',').length).toBeLessThanOrEqual(250)
    }
  })

  it('piyasa degeri okunur; degeri 0 / null olan kayit "yok" sayilir, fiyati olan kayitta fiyat korunur', async () => {
    const eksik = { ...GERCEK_KAYIT, id: 'eksik-xstock', current_price: null, market_cap: null }
    const { fetchImpl } = sahteCoinGecko({ kayitlar: { 'adobe-xstock': GERCEK_KAYIT, 'eksik-xstock': eksik, 'hisse1-xstock': kayitlar['hisse1-xstock'] } })
    const fiyatlar = await makeLiveDeps({ fetchImpl, sleep: async () => {} }).prices(['adobe-xstock', 'eksik-xstock', 'hisse1-xstock', 'hic-yok-xstock'])

    expect(fiyatlar['adobe-xstock']).toEqual({ usd: 234.74, marketCap: null })
    expect(fiyatlar['hisse1-xstock']).toEqual({ usd: 101, marketCap: 1_000_001 })
    expect(fiyatlar['eksik-xstock']).toEqual({ usd: null, marketCap: null })
    expect(fiyatlar['hic-yok-xstock']).toBeUndefined()
  })

  it('kimlikler tekillestirilir (ayni kimlik iki kez sorulmaz) ve bos liste aga cikmaz', async () => {
    const { fetchImpl, istekler } = sahteCoinGecko({ kayitlar })
    const deps = makeLiveDeps({ fetchImpl, sleep: async () => {} })
    await deps.prices(['hisse0-xstock', 'hisse0-xstock', 'hisse1-xstock'])
    expect(new URL(istekler[0]).searchParams.get('ids')).toBe('hisse0-xstock,hisse1-xstock')
    expect(istekler).toHaveLength(1)
    expect(await deps.prices([])).toEqual({})
    expect(istekler).toHaveLength(1)
  })

  it('429 + Retry-After: 6 -> 6 sn bekler ve yeniden dener; baslik yoksa 60 sn', async () => {
    const uyku = []
    const sleep = async (ms) => { uyku.push(ms) }

    const { fetchImpl: baslikli } = sahteCoinGecko({ kayitlar, sirayla429: [6] })
    const a = await makeLiveDeps({ fetchImpl: baslikli, sleep }).prices(['hisse2-xstock'])
    expect(a['hisse2-xstock'].usd).toBe(102)
    expect(uyku).toEqual([6000])

    uyku.length = 0
    const { fetchImpl: basliksiz } = sahteCoinGecko({ kayitlar, sirayla429: [null] })
    await makeLiveDeps({ fetchImpl: basliksiz, sleep }).prices(['hisse2-xstock'])
    expect(uyku).toEqual([60_000])
  })

  it('429 uc kez ust uste: EN FAZLA 2 yeniden deneme, sonra aciklayici hata FIRLATIR (sessiz {} DEGIL)', async () => {
    const uyku = []
    const { fetchImpl, istekler } = sahteCoinGecko({ kayitlar, sirayla429: [1, 1, 1, 1] })
    const deps = makeLiveDeps({ fetchImpl, sleep: async (ms) => { uyku.push(ms) } })
    await expect(deps.prices(['hisse2-xstock'])).rejects.toThrow(/CoinGecko.*HTTP 429/)
    expect(istekler).toHaveLength(3)
    expect(uyku).toEqual([1000, 1000])
  })

  it('429 disindaki hata (414 / 500) yeniden denenmez ve durum kodunu hata mesajinda tasir', async () => {
    const uyku = []
    const fetchImpl = async () => ({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) })
    await expect(makeLiveDeps({ fetchImpl, sleep: async (ms) => { uyku.push(ms) } }).prices(['hisse2-xstock'])).rejects.toThrow(/HTTP 500/)
    expect(uyku).toEqual([])
  })
})

// readToken'in hata siniflamasi: yerel (127.0.0.1) sahte JSON-RPC sunucusu; dis aga cikmaz.
// "Kontrat cevap vermiyor" (revert / bos veri) KESIN yanittir -> deger null, alan okunamadi DEGIL;
// sunucu hatasi / zaman asimi -> alan `unreadable` listesine girer.
describe('makeLiveDeps.readToken - hata siniflamasi (yerel sahte RPC)', () => {
  const SEL = { symbol: '0x95d89b41', name: '0x06fdde03', decimals: '0x313ce567', multiplier: '0x2b63c300', paused: '0xb187bd26' }
  const coder = AbiCoder.defaultAbiCoder()
  const SLOT_IMPL = XSTOCKS_IMPLEMENTATIONS[0].toLowerCase()
  let server
  let url
  let davranis = {}

  const varsayilan = {
    [SEL.symbol]: () => ({ result: coder.encode(['string'], ['TSLAx']) }),
    [SEL.name]: () => ({ result: coder.encode(['string'], ['Tesla xStock']) }),
    [SEL.decimals]: () => ({ result: coder.encode(['uint8'], [18]) }),
    [SEL.multiplier]: () => ({ result: coder.encode(['uint256'], [E18]) }),
    [SEL.paused]: () => ({ result: coder.encode(['bool'], [false]) }),
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let govde = ''
      req.on('data', (parca) => { govde += parca })
      req.on('end', () => {
        const yuk = JSON.parse(govde)
        const cevapla = (r) => {
          if (r.method === 'eth_getCode') return { jsonrpc: '2.0', id: r.id, result: davranis.code ?? '0x6080' }
          if (r.method === 'eth_getStorageAt') {
            if (davranis.slotHata) return { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: 'upstream timeout' } }
            return { jsonrpc: '2.0', id: r.id, result: '0x' + '0'.repeat(24) + SLOT_IMPL.slice(2) }
          }
          if (r.method === 'eth_call') {
            const secici = r.params[0].data.slice(0, 10)
            const f = davranis[secici] ?? varsayilan[secici]
            return { jsonrpc: '2.0', id: r.id, ...f() }
          }
          return { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'method not found' } }
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(Array.isArray(yuk) ? yuk.map(cevapla) : cevapla(yuk)))
      })
    })
    await new Promise((coz) => server.listen(0, '127.0.0.1', coz))
    url = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(async () => { await new Promise((coz) => server.close(coz)) })

  const oku = () => makeLiveDeps({ env: { ETH_RPC_URL: url } }).readToken(1, TSLA.address)

  it('saglikli token: tum alanlar okunur, unreadable bos', async () => {
    davranis = {}
    const t = await oku()
    expect(t).toEqual({
      hasCode: true, symbol: 'TSLAx', name: 'Tesla xStock', decimals: 18, multiplier: E18, paused: false,
      implementation: XSTOCKS_IMPLEMENTATIONS[0], unreadable: [],
    })
  })

  it('kontrat kodu bos: { hasCode: false }', async () => {
    davranis = { code: '0x' }
    expect(await oku()).toEqual({ hasCode: false })
  })

  it('getCurrentMultiplier revert ya da bos veri doner: KESIN yanit (null), okunamadi DEGIL', async () => {
    davranis = { [SEL.multiplier]: () => ({ error: { code: 3, message: 'execution reverted', data: '0x' } }) }
    const revert = await oku()
    expect(revert.multiplier).toBeNull()
    expect(revert.unreadable).toEqual([])

    davranis = { [SEL.multiplier]: () => ({ error: { code: 3, message: 'execution reverted' } }) }
    const mesajli = await oku()
    expect(mesajli.multiplier).toBeNull()
    expect(mesajli.unreadable).toEqual([])

    davranis = { [SEL.multiplier]: () => ({ result: '0x' }) }
    const bos = await oku()
    expect(bos.multiplier).toBeNull()
    expect(bos.unreadable).toEqual([])
  })

  it('RPC hiz siniri hatasi (ethers bunu da CALL_EXCEPTION yapar): KESIN yanit DEGIL, okunamadi', async () => {
    davranis = { [SEL.multiplier]: () => ({ error: { code: -32005, message: 'daily request limit exceeded' } }) }
    const t = await oku()
    expect(t.unreadable).toEqual(['multiplier'])
    expect(t.multiplier).toBeNull()
  })

  it('sunucu hatasi / zaman asimi: alan unreadable listesine girer, digerleri okunur', async () => {
    davranis = {
      [SEL.symbol]: () => ({ error: { code: -32000, message: 'upstream timeout' } }),
      slotHata: true,
    }
    const t = await oku()
    expect(t.unreadable.sort()).toEqual(['implementation', 'symbol'])
    expect(t.symbol).toBeNull()
    expect(t.implementation).toBeNull()
    expect(t.decimals).toBe(18)
    expect(t.multiplier).toBe(E18)
  })
})

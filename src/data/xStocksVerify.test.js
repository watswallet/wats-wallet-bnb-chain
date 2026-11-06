// verify:xstocks CEKIRDEGI (scripts/verify-xstocks-core.mjs): kapi karari, aday kesisimi, ihracci
// piyasa kapisi ve CoW istemcisi. Hepsi SAF ya da enjekte edilebilir: ag yok.
//
// 2026-10-10 Cumartesi olcumu (koordinator): ihracci piyasa kapaliyken CoW HATA vermedi, HTTP 200 +
// 4,5-49 kat SISKIN fiyat dondu (ETH NVDAx $1k -> $1033/token, dayanak ~$229; ETH SPYx $1k ->
// $7217; BSC TSLAx $1k -> $4477); Arbitrum 404 NoLiquidity; ~1 istek/sn'de /quote isteklerin
// yarisina 429. Asagidaki ALIS fiyatlari o olcumun birebir kopyasidir; SATIS fiyatlari ve
// referanslar ORNEK degerlerdir (olculmedi).
import { describe, it, expect } from 'vitest'
import {
  GATE_NOTIONAL_USD, MAX_BUY_PREMIUM_PCT, MIN_PREMIUM_PCT, MIN_SELL_PCT, MAX_ROUNDTRIP_SPREAD_PCT,
  COW_MIN_GAP_MS, COW_RETRY_DEFAULT_MS, COW_MAX_RETRIES, COW_PATH_BY_CHAIN,
  PAY_TOKENS, REASON, VERIFY_CHAIN_IDS, VERIFY_FROM,
  DEFAULT_LIMIT, MAX_LIMIT, rankCandidates, parseArgs, candidatesFromSources, catalogEntry, extractTrading, tradingGate,
  buyUnitFromQuote, sellUnitFromQuote, referencePrice, premiumPct, spreadPct, gateDecision,
  sellAmountForNotional, buildQuoteBody, exitCodeFor, classifyQuoteError, createCowClient,
} from '../../scripts/verify-xstocks-core.mjs'
import { formatResultLine } from '../../scripts/verify-xstocks.mjs'
import { XSTOCKS, XSTOCKS_CHAIN_IDS } from './xStocks'

describe('sabitler', () => {
  it('kapi esikleri ve CoW hiz kurallari (koordinator olcumu)', () => {
    expect(GATE_NOTIONAL_USD).toBe(10_000)
    expect(MAX_BUY_PREMIUM_PCT).toBe(1)
    expect(MIN_PREMIUM_PCT).toBe(-2)
    expect(MAX_ROUNDTRIP_SPREAD_PCT).toBe(2)
    expect(COW_MIN_GAP_MS).toBe(2000)
    expect(COW_RETRY_DEFAULT_MS).toBe(30_000)
    expect(COW_MAX_RETRIES).toBe(2)
  })

  it('zincir haritalari katalogla AYNI kaynaktan ve uc zincir de odeme tokeni + CoW yoluna sahip', () => {
    expect(VERIFY_CHAIN_IDS).toBe(XSTOCKS_CHAIN_IDS)
    for (const chainId of XSTOCKS_CHAIN_IDS) {
      expect(PAY_TOKENS[chainId], String(chainId)).toMatchObject({ symbol: 'USDC' })
      expect(COW_PATH_BY_CHAIN[chainId], String(chainId)).toBeTruthy()
    }
    expect(PAY_TOKENS[1].address).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
    expect(PAY_TOKENS[56].address).toBe('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d')
    expect(PAY_TOKENS[42161].address).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831')
  })
})

describe('parseArgs', () => {
  it('bayrak yoksa otomatik aday kumesi (null)', () => {
    expect(parseArgs([])).toEqual({ candidates: null, limit: 50 })
  })
  it('--candidates virgullu listeyi kirpar', () => {
    expect(parseArgs(['--candidates', 'TSLAx, NVDAx'])).toEqual({ candidates: ['TSLAx', 'NVDAx'], limit: 50 })
  })
  it('--candidates degersiz ya da baska bayrakla biterse HATA verir (sessizce tum kumeye dusmez)', () => {
    expect(() => parseArgs(['--candidates'])).toThrow(/sembol listesi/)
    expect(() => parseArgs(['--candidates', '--x'])).toThrow(/sembol listesi/)
  })
  // FIN-cekirdek-4: '--candidates=A,B' bicimi sessizce yok sayilip TUM kume kosulmasin.
  it('--candidates=A,B ve --candidates A,B AYNI aday kumesini verir', () => {
    expect(parseArgs(['--candidates=TSLAx,NVDAx'])).toEqual({ candidates: ['TSLAx', 'NVDAx'], limit: 50 })
    expect(parseArgs(['--candidates=TSLAx, NVDAx'])).toEqual(parseArgs(['--candidates', 'TSLAx, NVDAx']))
  })
  it('bilinmeyen -- bayragi (ornek --candidate) kullanim hatasidir; yazim hatasi tum kumeye dusmez', () => {
    expect(() => parseArgs(['--candidate', 'TSLAx'])).toThrow(/bilinmeyen bayrak.*--candidate/)
    expect(() => parseArgs(['--candidate=TSLAx'])).toThrow(/bilinmeyen bayrak/)
    expect(() => parseArgs(['--candidates', 'TSLAx', '--x'])).toThrow(/bilinmeyen bayrak.*--x/)
  })
  it('bos liste ("--candidates ," / "--candidates=") ve artan konumsal arguman HATA verir', () => {
    expect(() => parseArgs(['--candidates', ','])).toThrow(/sembol listesi/)
    expect(() => parseArgs(['--candidates='])).toThrow(/sembol listesi/)
    expect(() => parseArgs(['--candidates', 'TSLAx', 'NVDAx'])).toThrow(/beklenmeyen arguman.*NVDAx/)
  })
})

// --limit: onerilecek SEMBOL sayisi; varsayilan 50, ust sinir 228 (22 bStock + 228 = sunucunun tek istekte
// kabul ettigi 250 kimlik).
describe('parseArgs - --limit', () => {
  it('varsayilan 50, ust sinir 228 (sabitler)', () => {
    expect(DEFAULT_LIMIT).toBe(50)
    expect(MAX_LIMIT).toBe(228)
    expect(parseArgs([]).limit).toBe(DEFAULT_LIMIT)
  })
  it('--limit N ve --limit=N AYNI sonucu verir; 1 ve 228 sinirlari GECERLI', () => {
    expect(parseArgs(['--limit', '10']).limit).toBe(10)
    expect(parseArgs(['--limit=10'])).toEqual(parseArgs(['--limit', '10']))
    expect(parseArgs(['--limit', '1']).limit).toBe(1)
    expect(parseArgs(['--limit', '228']).limit).toBe(228)
  })
  it('--candidates ile birlikte verilebilir (sirasi fark etmez)', () => {
    expect(parseArgs(['--candidates', 'TSLAx', '--limit', '3'])).toEqual({ candidates: ['TSLAx'], limit: 3 })
    expect(parseArgs(['--limit=3', '--candidates=TSLAx'])).toEqual({ candidates: ['TSLAx'], limit: 3 })
  })
  it('229, 0, negatif, ondalik, sayi olmayan, degersiz, bayrakla biten: kullanim hatasi (firlatir)', () => {
    for (const bad of ['229', '0', '-1', '1.5', 'abc', '', '1e2', ' ', '50x']) {
      expect(() => parseArgs(['--limit', bad]), `--limit ${JSON.stringify(bad)}`).toThrow(/--limit 1 ile 228/)
      expect(() => parseArgs([`--limit=${bad}`]), `--limit=${JSON.stringify(bad)}`).toThrow(/--limit 1 ile 228/)
    }
    expect(() => parseArgs(['--limit'])).toThrow(/--limit 1 ile 228/)
    expect(() => parseArgs(['--limit', '--candidates', 'TSLAx'])).toThrow(/--limit 1 ile 228/)
  })
  it('--limit iki kez verilirse hata', () => {
    expect(() => parseArgs(['--limit', '5', '--limit=6'])).toThrow(/iki kez/)
  })
})

describe('rankCandidates - piyasa degeri sirasi', () => {
  const c = (symbol) => ({ symbol, coingeckoId: `${symbol.toLowerCase()}-xstock` })
  const prices = {
    'aaa-xstock': { usd: 10, marketCap: 100 },
    'bbb-xstock': { usd: 20, marketCap: 900 },
    'ccc-xstock': { usd: 30, marketCap: 500 },
    'ddd-xstock': { usd: 40, marketCap: null }, // fiyat var, piyasa degeri yok
    'eee-xstock': { usd: null, marketCap: null }, // ikisi de yok
    'fff-xstock': { usd: 5, marketCap: 0 }, // 0 = yok
    // ggg-xstock: kayit hic yok
  }

  it('buyukten kucuge; degeri olmayanlar sona (fiyatli once), esitlikte sembol alfabetik', () => {
    const sirali = rankCandidates(['GGG', 'EEE', 'AAA', 'DDD', 'CCC', 'FFF', 'BBB'].map(c), prices)
    expect(sirali.map((x) => x.symbol)).toEqual(['BBB', 'CCC', 'AAA', 'DDD', 'FFF', 'EEE', 'GGG'])
  })
  it('esit piyasa degeri sembole gore; girdi dizisi DEGISMEZ ve fiyatlar bos olsa da calisir', () => {
    const girdi = ['ZZZ', 'AAA', 'MMM'].map(c)
    const kopya = [...girdi]
    expect(rankCandidates(girdi, { 'zzz-xstock': { marketCap: 7 }, 'aaa-xstock': { marketCap: 7 }, 'mmm-xstock': { marketCap: 8 } }).map((x) => x.symbol)).toEqual(['MMM', 'AAA', 'ZZZ'])
    expect(girdi).toEqual(kopya)
    expect(rankCandidates(girdi, {}).map((x) => x.symbol)).toEqual(['AAA', 'MMM', 'ZZZ'])
    expect(rankCandidates(girdi, undefined).map((x) => x.symbol)).toEqual(['AAA', 'MMM', 'ZZZ'])
  })
})

describe('referans fiyat ve teklif birim fiyatlari', () => {
  it('referans = CoinGecko / (getCurrentMultiplier / 1e18); SPYx 781,30 / 1,005714560286254 = 776,86', () => {
    expect(referencePrice({ coingeckoUsd: 781.30, multiplier: '1005714560286254000' })).toBeCloseTo(776.86, 2)
    expect(referencePrice({ coingeckoUsd: 781.30, multiplier: 1005714560286254000n })).toBeCloseTo(776.86, 2)
  })

  it('carpan 0 / bozuk / CoinGecko fiyati yoksa null (yanlis referans uretilmez)', () => {
    expect(referencePrice({ coingeckoUsd: 781.30, multiplier: '0' })).toBeNull()
    expect(referencePrice({ coingeckoUsd: 781.30, multiplier: 'x' })).toBeNull()
    expect(referencePrice({ coingeckoUsd: undefined, multiplier: '1000000000000000000' })).toBeNull()
  })

  it('ALIS: odenen (sellAmount + feeAmount, ag ucreti DAHIL) / alinan hisse', () => {
    const quote = { sellAmount: '9998800000', feeAmount: '1200000', buyAmount: '26300000000000000000' }
    expect(buyUnitFromQuote(quote, { payDecimals: 6, stockDecimals: 18 })).toBeCloseTo(10000 / 26.3, 3)
  })

  it('SATIS: alinan USDC / satilan hisse (sellAmount + feeAmount)', () => {
    const quote = { sellAmount: '26299000000000000000', feeAmount: '1000000000000000', buyAmount: '9960000000' }
    expect(sellUnitFromQuote(quote, { payDecimals: 6, stockDecimals: 18 })).toBeCloseTo(9960 / 26.3, 3)
  })

  it('BSC USDC (18 ondalik) ayni sonucu verir ve bozuk / sifir teklif null', () => {
    const quote = { sellAmount: '9998800000000000000000', feeAmount: '1200000000000000000', buyAmount: '26300000000000000000' }
    expect(buyUnitFromQuote(quote, { payDecimals: 18, stockDecimals: 18 })).toBeCloseTo(10000 / 26.3, 3)
    expect(buyUnitFromQuote({ sellAmount: 'x', buyAmount: '1' }, { payDecimals: 6, stockDecimals: 18 })).toBeNull()
    expect(buyUnitFromQuote({ sellAmount: '1', feeAmount: '0', buyAmount: '0' }, { payDecimals: 6, stockDecimals: 18 })).toBeNull()
  })

  it('satis teklifinin buyuklugu referans fiyatta $10.000 degerinde hisse (18 ondalik, alis sonucundan TURETILMEZ)', () => {
    expect(sellAmountForNotional(380)).toBe(26315789000000000000n)
    expect(sellAmountForNotional(1)).toBe(10000n * 10n ** 18n)
  })
})

describe('fiyat kapisi (alis primi <= %1 VE alis-satis farki <= %2)', () => {
  it('adil teklif GECER', () => {
    const karar = gateDecision({ buyUnit: 234.64, sellUnit: 233.9, reference: 234.14 })
    expect(karar.pass).toBe(true)
    expect(karar.reasons).toEqual([])
    expect(karar.premiumPct).toBeCloseTo(0.2135, 3)
    expect(karar.spreadPct).toBeCloseTo(0.3159, 3)
  })

  // Review Focus 3: CoW 200 dondu ama fiyat absurt (kapali piyasa). Birim test vektoru: NVDAx 1033 vs
  // referans 229 -> kapi REDDEDER.
  it('Review Focus 3: NVDAx $1033 (CoW 200 dondu) vs referans $229 REDDEDILIR; iki neden de yazilir', () => {
    const karar = gateDecision({ buyUnit: 1033, sellUnit: 228.4, reference: 229 })
    expect(karar.pass).toBe(false)
    expect(karar.reasons).toEqual([REASON.BUY_PREMIUM, REASON.ROUNDTRIP_SPREAD])
    expect(karar.premiumPct).toBeCloseTo(351.09, 1)
  })

  it('Review Focus 3: ETH SPYx $7217 ve BSC TSLAx $4477 de reddedilir', () => {
    expect(gateDecision({ buyUnit: 7217, sellUnit: 776, reference: 776.86 }).pass).toBe(false)
    expect(gateDecision({ buyUnit: 4477, sellUnit: 379, reference: 379.3 }).pass).toBe(false)
  })

  it('referans da kaymis ama alis-satis farki yakalar: alis makul gorunur, satis cok dusuk', () => {
    const karar = gateDecision({ buyUnit: 100.5, sellUnit: 90, reference: 100 })
    expect(karar.pass).toBe(false)
    expect(karar.reasons).toEqual([REASON.ROUNDTRIP_SPREAD, REASON.SELL_DISCOUNT])
  })

  it('sinirlar: tam %1 prim ve tam %2 fark GECER (kayan nokta gurultusu yok), biraz fazlasi KALIR', () => {
    expect(premiumPct(202, 200)).toBe(1)
    expect(gateDecision({ buyUnit: 202, sellUnit: 202, reference: 200 }).pass).toBe(true)
    expect(gateDecision({ buyUnit: 202.02, sellUnit: 202.02, reference: 200 }).pass).toBe(false)
    expect(spreadPct(101, 99)).toBe(2)
    expect(gateDecision({ buyUnit: 101, sellUnit: 99, reference: 101 }).pass).toBe(true)
    expect(gateDecision({ buyUnit: 101.5, sellUnit: 99, reference: 101.5 }).pass).toBe(false)
  })

  // FIN-cekirdek-2: kapi yalniz pozitif primi sinirliyordu; referansin cok ALTINDAKI teklif (bayat
  // referans, carpan hatasi, depeg) 'gecti' sayilirdi. Simdi olculemedi (insan bakar).
  it('referansin %2 den fazla ALTINDAKI alis OLCULEMEDI: REFERANS_TUTARSIZ, gecti DEGIL', () => {
    const karar = gateDecision({ buyUnit: 50, sellUnit: 50, reference: 100 })
    expect(karar.pass).toBe(false)
    expect(karar.reasons).toEqual([REASON.REFERENCE_INCONSISTENT])
    expect(REASON.REFERENCE_INCONSISTENT).toBe('REFERANS_TUTARSIZ')
    expect(karar.premiumPct).toBe(-50)
  })

  it('prim tam -%2 GECER; biraz altinda REFERANS_TUTARSIZ', () => {
    const sinir = gateDecision({ buyUnit: 98, sellUnit: 98, reference: 100 })
    expect(sinir.premiumPct).toBe(-2)
    expect(sinir.pass).toBe(true)
    expect(sinir.reasons).toEqual([])
    expect(gateDecision({ buyUnit: 97.9, sellUnit: 97.9, reference: 100 }).reasons).toEqual([REASON.REFERENCE_INCONSISTENT])
  })

  it('indirim + alis-satis farki birlikte: kesin sapma (spread) da yazilir, neden listesi tutarsizligi de tasir', () => {
    const karar = gateDecision({ buyUnit: 50, sellUnit: 100, reference: 100 })
    expect(karar.pass).toBe(false)
    expect(karar.reasons).toEqual([REASON.REFERENCE_INCONSISTENT, REASON.ROUNDTRIP_SPREAD])
  })

  // Task 2 (K15): satis alt siniri. Satis birim fiyati referansin en cok %2 altinda olabilir.
  it('satis tam -%2 GECER, sellPct -2 (kayan nokta gurultusu yok)', () => {
    const karar = gateDecision({ buyUnit: 99, sellUnit: 98, reference: 100 })
    expect(karar.sellPct).toBe(-2)
    expect(karar.pass).toBe(true)
    expect(karar.reasons).toEqual([])
    expect(MIN_SELL_PCT).toBe(-2)
    expect(REASON.SELL_DISCOUNT).toBe('SATIS_ISKONTOSU_YUKSEK')
  })

  it('satis -%2 nin altinda (97.9): ROUNDTRIP_SPREAD ve SELL_DISCOUNT, bu sirayla', () => {
    const karar = gateDecision({ buyUnit: 100, sellUnit: 97.9, reference: 100 })
    expect(karar.pass).toBe(false)
    expect(karar.reasons).toEqual([REASON.ROUNDTRIP_SPREAD, REASON.SELL_DISCOUNT])
    expect(karar.sellPct).toBeCloseTo(-2.1, 6)
  })

  it('alis -%50 ve satis -%50: satis kurali BASTIRILIR, yalniz REFERANS_TUTARSIZ', () => {
    const karar = gateDecision({ buyUnit: 50, sellUnit: 50, reference: 100 })
    expect(karar.reasons).toEqual([REASON.REFERENCE_INCONSISTENT])
    expect(karar.sellPct).toBe(-50)
  })

  it('formatResultLine satirinda satis yuzdesi yazar', () => {
    const decision = gateDecision({ buyUnit: 100, sellUnit: 99, reference: 100 })
    const satir = formatResultLine({ status: 'pass', symbol: 'TSLAx', chainId: 1, decision, buyUnit: 100, sellUnit: 99, reference: 100 })
    expect(satir).toContain('satis -1.00%')
  })

  it('gecersiz fiyat (NaN, 0, negatif) kapidan GECMEZ', () => {
    expect(gateDecision({ buyUnit: NaN, sellUnit: 1, reference: 1 })).toEqual({
      pass: false, premiumPct: null, spreadPct: null, sellPct: null, reasons: [REASON.INVALID_PRICE],
    })
    expect(gateDecision({ buyUnit: 0, sellUnit: 1, reference: 1 }).pass).toBe(false)
    expect(gateDecision({ buyUnit: 1, sellUnit: -1, reference: 1 }).pass).toBe(false)
  })
})

describe('ihracci piyasa kapisi', () => {
  const trading = (over = {}) => ({
    tradingHoursMode: 'TwentyFourFive',
    currentPeriod: 'market',
    openNow: true,
    nextChangeAt: '2026-10-09T20:00:00Z',
    limitsPerPeriod: {
      market: { minOrderFiatValue: 1000, maxOrderFiatValue: 1000000 },
      closed: { minOrderFiatValue: 0, maxOrderFiatValue: 0 },
    },
    ...over,
  })

  it('acik piyasa', () => {
    expect(tradingGate(trading())).toEqual({ open: true, reason: null, period: 'market', nextChangeAt: '2026-10-09T20:00:00Z' })
  })

  it('Review Focus 3: Cumartesi olcumu (closed, openNow false, limit 0, acilis 2026-10-12T00:00Z) KAPALI', () => {
    const kapali = trading({ openNow: false, currentPeriod: 'closed', nextChangeAt: '2026-10-12T00:00:00Z' })
    expect(tradingGate(kapali)).toEqual({ open: false, reason: 'PIYASA_KAPALI', period: 'closed', nextChangeAt: '2026-10-12T00:00:00Z' })
  })

  it('openNow true gorunse bile donem limiti 0 ise KAPALI; limit metin "0" da sayilir', () => {
    expect(tradingGate(trading({ currentPeriod: 'closed' })).reason).toBe('PIYASA_KAPALI')
    expect(tradingGate(trading({ limitsPerPeriod: { market: { maxOrderFiatValue: '0' } } })).reason).toBe('PIYASA_KAPALI')
  })

  // FIN-cekirdek-3: acik demek icin UC kosul birlikte gerekir (openNow === true VE gecerli donemin
  // limiti var VE > 0). Celiski ya da eksik alan ACIK SAYILMAZ ve 'kapali' de denmez: BELIRSIZ.
  it('celiskili girdi (openNow true ama currentPeriod closed ve o donemin limiti yok) ACIK DEGIL: PIYASA_DURUMU_BELIRSIZ', () => {
    const celiski = tradingGate({ openNow: true, currentPeriod: 'closed', limitsPerPeriod: { market: { maxOrderFiatValue: 1000 } } })
    expect(celiski).toEqual({ open: false, reason: 'PIYASA_DURUMU_BELIRSIZ', period: 'closed', nextChangeAt: null })
  })

  it('eksik alan ACIK DEGIL: openNow yok (limit > 0 olsa bile), limit yok, donem yok, limit sayi degil', () => {
    expect(tradingGate(trading({ openNow: undefined }))).toMatchObject({ open: false, reason: 'PIYASA_DURUMU_BELIRSIZ' })
    expect(tradingGate(trading({ limitsPerPeriod: {} }))).toMatchObject({ open: false, reason: 'PIYASA_DURUMU_BELIRSIZ' })
    expect(tradingGate(trading({ currentPeriod: undefined }))).toMatchObject({ open: false, reason: 'PIYASA_DURUMU_BELIRSIZ' })
    expect(tradingGate(trading({ limitsPerPeriod: { market: { maxOrderFiatValue: null } } }))).toMatchObject({ open: false, reason: 'PIYASA_DURUMU_BELIRSIZ' })
    expect(tradingGate(trading({ limitsPerPeriod: { market: { maxOrderFiatValue: 'abc' } } }))).toMatchObject({ open: false, reason: 'PIYASA_DURUMU_BELIRSIZ' })
  })

  it('normal acik girdi ACIK; trading bilgisi hic yoksa TRADING_BILGISI_YOK; openNow false KAPALI', () => {
    expect(tradingGate(trading({ limitsPerPeriod: { market: { maxOrderFiatValue: '1000' } } })).open).toBe(true)
    expect(tradingGate(null).reason).toBe('TRADING_BILGISI_YOK')
    expect(tradingGate({ openNow: false }).reason).toBe('PIYASA_KAPALI')
  })

  it('extractTrading: yanit zarfi (ham / data / asset / dizi) fark etmez', () => {
    const t = trading()
    expect(extractTrading({ trading: t })).toBe(t)
    expect(extractTrading({ data: { trading: t } })).toBe(t)
    expect(extractTrading({ asset: { trading: t } })).toBe(t)
    expect(extractTrading([{ trading: t }])).toBe(t)
    expect(extractTrading({ data: [{ trading: t }] })).toBe(t)
    expect(extractTrading({ yok: 1 })).toBeNull()
    expect(extractTrading(null)).toBeNull()
  })
})

describe('aday kesisimi (resmi token listesi ve CoinGecko kesisimi)', () => {
  const tokenList = {
    tokens: [
      { chainId: 1, address: '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0', symbol: 'TSLAx', name: 'Tesla xStock', decimals: 18 },
      { chainId: 56, address: '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0', symbol: 'TSLAx', name: 'Tesla xStock', decimals: 18 },
      { chainId: 42161, address: '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0', symbol: 'TSLAx', name: 'Tesla xStock', decimals: 18 },
      { chainId: 8453, address: '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0', symbol: 'TSLAx', name: 'Tesla xStock', decimals: 18 },
      { chainId: 1, address: '0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a', symbol: 'AAPLx', name: 'Apple xStock', decimals: 18 },
      { chainId: 1, address: '0x1111111111111111111111111111111111111111', symbol: 'ZZZx', name: 'Zzz xStock', decimals: 18 },
      { chainId: 1, address: '0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171', symbol: 'wTSLAx', name: 'Wrapped Tesla xStock', decimals: 18 },
    ],
  }
  const coinsList = [
    { id: 'tesla-xstock', platforms: { ethereum: '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0', 'binance-smart-chain': '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0', 'arbitrum-one': '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0', solana: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB' } },
    { id: 'apple-xstock', platforms: { ethereum: '0x9D275685dC284C8eB1C79f6ABA7a63Dc75ec890a' } },
    { id: 'wrapped-tesla-xstock', platforms: { ethereum: '0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171' } },
    { id: 'tether', platforms: { ethereum: '0xdac17f958d2ee523a2206206994597c13d831ec7' } },
  ]

  it('yalniz 1/56/42161, ayni adres + CoinGecko kaydi olanlar; wrapped-* ve kayitsiz token elenir; EIP-55 ve sade ad', () => {
    const adaylar = candidatesFromSources({ tokenList, coinsList })
    expect(adaylar.map((a) => [a.symbol, a.coingeckoId, a.chains, a.address, a.name])).toEqual([
      ['AAPLx', 'apple-xstock', [1], '0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a', 'Apple'],
      ['TSLAx', 'tesla-xstock', [1, 56, 42161], '0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0', 'Tesla'],
    ])
  })

  it('ayni CoinGecko kimligi baska zincirde BASKA adresle gelirse o zincir adaya katilmaz; chainIds kumeyi daraltir', () => {
    const baskaAdres = '0x2222222222222222222222222222222222222222'
    const liste = { tokens: [
      { chainId: 1, address: '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0', symbol: 'TSLAx', name: 'Tesla xStock', decimals: 18 },
      { chainId: 56, address: baskaAdres, symbol: 'TSLAx', name: 'Tesla xStock', decimals: 18 },
    ] }
    const kaynak = [{ id: 'tesla-xstock', platforms: { ethereum: '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0', 'binance-smart-chain': baskaAdres } }]
    expect(candidatesFromSources({ tokenList: liste, coinsList: kaynak })[0].chains).toEqual([1])
    expect(candidatesFromSources({ tokenList, coinsList, chainIds: [1] }).map((a) => [a.symbol, a.chains])).toEqual([['AAPLx', [1]], ['TSLAx', [1]]])
  })

  it('--candidates (only) kumeyi daraltir, bos kaynak bos liste verir', () => {
    expect(candidatesFromSources({ tokenList, coinsList, only: ['tslax'] }).map((a) => a.symbol)).toEqual(['TSLAx'])
    expect(candidatesFromSources({ tokenList: null, coinsList: null })).toEqual([])
  })

  it('catalogEntry: data/xStocks.js bicimiyle, kesme isaretli adi kacirir', () => {
    const [, tsla] = candidatesFromSources({ tokenList, coinsList })
    expect(catalogEntry(tsla)).toBe([
      '  {',
      "    symbol: 'TSLAx',",
      "    name: 'Tesla',",
      "    address: '0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0',",
      '    chains: [1, 56, 42161],',
      "    coingeckoId: 'tesla-xstock',",
      '    decimals: 18,',
      "    issuer: 'xstocks',",
      '  },',
    ].join('\n'))
    expect(catalogEntry({ symbol: 'A', name: "O'Neil", address: '0xabc', chains: [1], coingeckoId: 'a-xstock' })).toContain("name: 'O\\'Neil',")
  })
})

describe('cikis kodu', () => {
  it('0 hepsi gecti, 2 olculemedi, 1 sapma; kesin sapma belirsizlikten once gelir', () => {
    expect(exitCodeFor([])).toBe(0)
    expect(exitCodeFor([{ status: 'pass' }])).toBe(0)
    expect(exitCodeFor([{ status: 'pass' }, { status: 'unmeasured' }])).toBe(2)
    expect(exitCodeFor([{ status: 'unmeasured' }, { status: 'fail' }])).toBe(1)
  })
})

describe('CoW teklif govdesi', () => {
  const stock = XSTOCKS[0]
  const pay = PAY_TOKENS[1]

  it('alis: USDC -> hisse, kind sell, emir IMZASI / signature YOK', () => {
    const body = buildQuoteBody({ side: 'buy', stock, pay, amount: 10_000_000_000n })
    expect(body).toEqual({
      sellToken: pay.address, buyToken: stock.address, from: VERIFY_FROM, receiver: VERIFY_FROM,
      kind: 'sell', sellAmountBeforeFee: '10000000000', validFor: 1800, signingScheme: 'eip712', onchainOrder: false,
    })
    expect(body).not.toHaveProperty('signature')
  })

  it('satis: hisse -> USDC', () => {
    const body = buildQuoteBody({ side: 'sell', stock, pay, amount: 26315789000000000000n })
    expect(body.sellToken).toBe(stock.address)
    expect(body.buyToken).toBe(pay.address)
    expect(body.sellAmountBeforeFee).toBe('26315789000000000000')
  })

  it('hata siniflari: 404 / NoLiquidity / InsufficientLiquidity -> NO_LIQUIDITY, digerleri REJECTED', () => {
    expect(classifyQuoteError(404, { errorType: 'NoLiquidity' })).toBe('NO_LIQUIDITY')
    expect(classifyQuoteError(400, { errorType: 'InsufficientLiquidity' })).toBe('NO_LIQUIDITY')
    expect(classifyQuoteError(400, { errorType: 'ZeroAmount' })).toBe('REJECTED')
    expect(classifyQuoteError(404, null)).toBe('NO_LIQUIDITY')
    expect(classifyQuoteError(500, null)).toBe('REJECTED')
  })
})

describe('CoW istemcisi - hiz siniri ve 429', () => {
  const sahteZaman = () => {
    const durum = { t: 0, uykular: [] }
    return {
      durum,
      sleep: async (ms) => { durum.uykular.push(ms); durum.t += ms },
      now: () => durum.t,
    }
  }
  const sahteFetch = (cevaplar, zaman) => {
    const cagrilar = []
    const fetchImpl = async (url, init) => {
      cagrilar.push({ url, at: zaman.durum.t, body: JSON.parse(init.body) })
      const r = cevaplar.shift()
      return { status: r.status, headers: { get: (k) => (r.headers || {})[k.toLowerCase()] ?? null }, json: async () => r.json }
    }
    return { cagrilar, fetchImpl }
  }
  const TAMAM = { status: 200, json: { quote: { sellAmount: '1', buyAmount: '2', feeAmount: '0' }, verified: false } }

  it('iki ardisik istek arasi >= 2 sn (ilk istek beklemez) ve URL zincir yolunu icerir', async () => {
    const zaman = sahteZaman()
    const { cagrilar, fetchImpl } = sahteFetch([{ ...TAMAM }, { ...TAMAM }], zaman)
    const cow = createCowClient({ fetchImpl, sleep: zaman.sleep, now: zaman.now })

    expect((await cow.quote(1, { x: 1 })).ok).toBe(true)
    expect((await cow.quote(56, { x: 2 })).ok).toBe(true)

    expect(cagrilar.map((c) => c.at)).toEqual([0, 2000])
    expect(zaman.durum.uykular).toEqual([2000])
    expect(cagrilar[0].url).toBe('https://api.cow.fi/mainnet/api/v1/quote')
    expect(cagrilar[1].url).toBe('https://api.cow.fi/bnb/api/v1/quote')
  })

  it('429 + Retry-After: 5 -> 5 sn bekler, yeniden dener', async () => {
    const zaman = sahteZaman()
    const { cagrilar, fetchImpl } = sahteFetch([{ status: 429, headers: { 'retry-after': '5' }, json: {} }, { ...TAMAM }], zaman)
    const cow = createCowClient({ fetchImpl, sleep: zaman.sleep, now: zaman.now })

    expect((await cow.quote(1, {})).ok).toBe(true)
    expect(zaman.durum.uykular).toEqual([5000])
    expect(cagrilar).toHaveLength(2)
  })

  it('429 + Retry-After: 90 -> 60 sn tavani (parseRetryAfter)', async () => {
    const zaman = sahteZaman()
    const { fetchImpl } = sahteFetch([{ status: 429, headers: { 'retry-after': '90' }, json: {} }, { ...TAMAM }], zaman)
    const cow = createCowClient({ fetchImpl, sleep: zaman.sleep, now: zaman.now })

    expect((await cow.quote(1, {})).ok).toBe(true)
    expect(zaman.durum.uykular).toEqual([60000])
  })

  it('Review Focus 3: 429, baslik yok -> 30 sn; hala 429 ise EN FAZLA 2 yeniden deneme sonra RATE_LIMITED', async () => {
    const zaman = sahteZaman()
    const { cagrilar, fetchImpl } = sahteFetch([{ status: 429, json: {} }, { status: 429, json: {} }, { status: 429, json: {} }], zaman)
    const cow = createCowClient({ fetchImpl, sleep: zaman.sleep, now: zaman.now })

    expect(await cow.quote(1, {})).toEqual({ ok: false, kind: 'RATE_LIMITED', status: 429 })
    expect(cagrilar).toHaveLength(3)
    expect(zaman.durum.uykular).toEqual([30000, 30000])
  })

  it('hata sinifi: 404 NoLiquidity, 400 InsufficientLiquidity, 400 diger, desteklenmeyen zincir', async () => {
    const zaman = sahteZaman()
    const { fetchImpl } = sahteFetch([
      { status: 404, json: { errorType: 'NoLiquidity', description: 'no route' } },
      { status: 400, json: { errorType: 'InsufficientLiquidity' } },
      { status: 400, json: { errorType: 'ZeroAmount' } },
    ], zaman)
    const cow = createCowClient({ fetchImpl, sleep: zaman.sleep, now: zaman.now, minGapMs: 0 })

    expect((await cow.quote(42161, {})).kind).toBe('NO_LIQUIDITY')
    expect((await cow.quote(1, {})).kind).toBe('NO_LIQUIDITY')
    expect((await cow.quote(1, {})).kind).toBe('REJECTED')
    expect((await cow.quote(8453, {})).kind).toBe('UNSUPPORTED_CHAIN')
  })

  it('ag hatasi FIRLATMAZ, NETWORK doner', async () => {
    const zaman = sahteZaman()
    const cow = createCowClient({ fetchImpl: async () => { throw new Error('ECONNRESET') }, sleep: zaman.sleep, now: zaman.now, minGapMs: 0 })
    expect(await cow.quote(1, {})).toEqual({ ok: false, kind: 'NETWORK', message: 'ECONNRESET' })
  })
})

// LCX teklifini Takas ekraninin BEKLEDIGI bicime (SwapData) esler -- saf modul: ag yok, chrome yok.
//
// Swap.vue saglayiciyi bilmez; `expectedOutput`, `exchangeRate`, `priceImpact`, `estimatedGasFee.totalCost`
// ve `depthGateWarning` okur (TON/ATS satis yollariyla AYNI sozlesme). Bu modul o alanlari uretir ve
// yanina `lcxQuote` ekler; `lcxQuote` yurutmeye (Gorev 7) AYNEN geri gelir ve imzalanacak islemin
// dogrulayicisina (routerGuard) beklenen degerleri verir.
//
// ONDALIKLAR CAGIRANDAN GELIR (R3), LCX yanitindan DEGIL: arka plan token ondaliklarini zincirden okur ve
// buraya acikca verir. Gosterim (expectedOutput, minimumReceived, kur) YALNIZ bu ondaliklarla bicimlenir -- yanlis/oyunlu
// bir ondalik, gosterilen cikti miktarini kat kat yanlis yapardi ve kullanici o rakama bakarak onay verirdi.
// Yanitin `input.decimals` / `output.decimals` alanlari YALNIZ TUTARLILIK denetimidir (R18): tam sayi olarak geliyorlarsa
// cagirandaki ondaliga esit olmak zorundadir, degilse teklif reddedilir. Boylece zincir okumasi sessizce 18'e dustugunde
// (6 ondalikli token icin amountIn 10^12 kat buyur ve sunucu onu aynen yansitir) imzalanacak teklif kurulmaz. Alan yoksa
// ya da tam sayi degilse denetim atlanir (LCX bunlari hep gondermeyebilir); gosterim yine cagirandan gelir.
//
// YANIT, CAGIRANIN GONDERDIGIYLE BIRE BIR ORTUSMEK ZORUNDADIR (R14). Cagiran LCX'e gonderdigi chainId, tokenIn,
// tokenOut ve ham amountIn'i buraya geri verir; yanittaki chainId, input.token, output.token ve input.amount
// bunlardan biri bile farkliysa teklif REDDEDILIR. Aksi halde ekran kullanicinin yazmadigi bir tutar icin cikti ve
// kur gosterirdi; ustelik `lcxQuote.amountIn` ayni guvenilmez yanittan gelirse routerGuard calldata'yi o degerle
// karsilastirir ve uyusmazligi YAKALAYAMAZ. `lcxQuote` bu yuzden cagiranin degerlerini tasir, yanitinkini degil.
//
// IMZALANACAK ALT SINIR KULLANICININ KAYMASINA BAGLIDIR (C1). `lcxQuote.minOut` LCX'ten gelir ve routerGuard calldata'nin
// minAmountOut'unu YALNIZ ona karsi denetler; tek basina guvenilmez bir sayidir. Bu yuzden yanit ancak su kosullarla kabul edilir:
//   output.amount > 0,  minOut > 0  ve  minOut >= floor(output.amount * (10000 - slippageBps) / 10000)
// `slippageBps` cagiranin LCX'e GONDERDIGI (kullanicinin) kaymadir; minOut rwa'da `data.rwa.minOut`, digerlerinde
// `output.minimumAmount`. floor LCX'in kendi yuvarlamasidir (dort fikstur de tam sinirda). Kosul tutmazsa bad_quote (yedek yol).
// KAYMA KURALI (I1, yurutmeyle AYNI): LCX'in UYGULADIGI kayma kullanicinin istediginden genis olamaz ve en az 1 bps olmalidir;
// daha siki kayma takasi yalniz basarisiz kilabilir, para kaybettirmez. `lcxQuote.slippageBps` LCX'in degeridir (/v1/build onu
// ister). Ayni iki kural yurutmede assertLcxQuoteMatches'te (calls.js) `lcxQuote.amountOut` ile tekrar uygulanir.
//
// RWA (hisse) teklifi `lcxQuote.rwa` tasir (Bolum 2, Gorev 5): { issuer, marketOpen, refDeviationBps, referenceUsd, symbol, underlying }.
// `issuer` LCX'in `data.rwa.asset.issuer` adidir, sunucudaki normallestirmeyle (normalizeLcxIssuer) ayni kimlige cevrilir; arka plan onu
// katalog satirinin ihraccisiyla eslestirir ve ilk alim kapisi bu kimlikle sorulur. Normallestirilemezse null (eslesme onu reddeder).
// Diger alanlar BILGI amaclidir (ekran gosterimi): sonlu sayi / boolean / dize degilse null, uydurma deger yazilmaz; karar girdisi degildir.
//
// Bozuk ya da uyusmayan LCX yaniti `LcxUnavailableError('bad_quote')` firlatir (`field` hangi alan oldugunu soyler):
// cagiran yedek yola duser, yarim ya da uydurma bir teklif ekrana ASLA yazilmaz. Cagiranin kendi hatasi
// (eksik/gecersiz secenek) TypeError'dur ve yanit hatasi gibi gizlenmez.

import { formatUnits, getAddress } from 'ethers'
import { LcxUnavailableError } from './client.js'
import { normalizeLcxIssuer } from '../tokenizedStocks'

const KINDS = new Set(['swap', 'stable', 'rwa'])
const DECIMAL_RE = /^\d+$/

function bad(field) {
    const err = new LcxUnavailableError('bad_quote')
    err.field = field
    err.message = `${err.message} (${field})`
    return err
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// Ham token miktari: ondalik dizge (ya da guvenli tam sayi) -> ondalik dizge.
function rawAmount(value, field) {
    const s = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value
    if (typeof s !== 'string' || !DECIMAL_RE.test(s)) throw bad(field)
    return s
}

function toInt(value, field) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    if (!Number.isInteger(n) || n < 0) throw bad(field)
    return n
}

function toAddress(value, field) {
    try {
        return getAddress(value)
    } catch {
        throw bad(field)
    }
}

function checkDecimals(value, name) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new TypeError(`lcxSwapData: ${name} gecerli bir ondalik sayisi olmali`)
    }
}

// Cagiranin LCX'e gonderdigi adres: LCX bicimi (0x + 40 hane). '0x0' kisaltmasi burada KABUL EDILMEZ; cagiran
// toLcxToken'dan gecirmis olmali (yanittaki native adres tam sifir adrestir).
function callerAddress(value, name) {
    if (typeof value === 'string') {
        try {
            return getAddress(value)
        } catch {
            // asagidaki TypeError
        }
    }
    throw new TypeError(`lcxSwapData: ${name} gecerli bir adres olmali (LCX bicimi)`)
}

// Cagiranin LCX'e gonderdigi ham tutar: ondalik dizge ya da bigint -> normalize ondalik dizge.
function callerAmount(value) {
    const s = typeof value === 'bigint' && value >= 0n ? value.toString() : value
    if (typeof s !== 'string' || !DECIMAL_RE.test(s)) {
        throw new TypeError('lcxSwapData: amountIn negatif olmayan ham tam sayi dizgesi (ya da bigint) olmali')
    }
    return BigInt(s).toString()
}

const finiteOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const stringOrNull = (v) => (typeof v === 'string' && v !== '' ? v : null)

// `lcxQuote.rwa`: data.rwa'dan. referenceUsd = referenceOut?.usd ?? referenceIn?.usd ?? null (cikis tarafi referansi once).
function rwaInfo(rwa) {
    const asset = isObject(rwa.asset) ? rwa.asset : {}
    return {
        issuer: normalizeLcxIssuer(asset.issuer),
        marketOpen: typeof rwa.marketOpen === 'boolean' ? rwa.marketOpen : null,
        refDeviationBps: finiteOrNull(rwa.refDeviationBps),
        referenceUsd: finiteOrNull(rwa.referenceOut?.usd ?? rwa.referenceIn?.usd ?? null),
        symbol: stringOrNull(asset.symbol),
        underlying: stringOrNull(asset.underlying),
    }
}

// Rakam gosterimi: sonlu degilse (0'a bolme, gecersiz miktar) NaN/Infinity yazilmaz.
const fixed6 = (n) => (Number.isFinite(n) ? n.toFixed(6) : '0')

/**
 * Kullanicinin kaymasiyla izin verilen en gevsek alt sinir: floor(amountOut * (10000 - slippageBps) / 10000).
 * calls.js assertLcxQuoteMatches yurutmede AYNI fonksiyonu kullanir (teklif ve yurutme tek kural).
 * @param {bigint} amountOut  > 0
 * @param {number} slippageBps tam sayi, 1..9999
 * @returns {bigint}
 */
export function lcxMinOutFloor(amountOut, slippageBps) {
    return (amountOut * BigInt(10000 - slippageBps)) / 10000n
}

/** Kullanicinin (LCX'e gonderilen) kaymasi: 1..9999 tam sayi bps. */
export const isUserSlippageBps = (v) => Number.isInteger(v) && v >= 1 && v < 10000

/**
 * @param {object} data    sunucunun /lcx/quote `data`si (LCX'in ham data'si)
 * @param {{ kind: 'swap'|'stable'|'rwa', chainId: number, tokenIn: string, tokenOut: string, amountIn: string|bigint,
 *   inDecimals: number, outDecimals: number, slippagePercent: number|string, slippageBps: number, nativeSymbol: string }} opts
 *   chainId, tokenIn (LCX bicimli adres), tokenOut, amountIn (ham ondalik dizge) ve slippageBps (kullanicinin kaymasi, bps)
 *   LCX'e GONDERILEN degerlerdir; yanit bunlarla bire bir eslesmek (kayma: asmamak) zorundadir. inDecimals/outDecimals zincirden
 *   okunan gercek ondaliklardir (yanittaki decimals varsa bunlarla ESIT olmalidir: R18).
 * @returns {object} SwapData + `routerType: { name: 'lcx' }` + `lcxQuote`
 * @throws {LcxUnavailableError} bozuk ya da cagiranin gonderdigiyle uyusmayan LCX yaniti (reason 'bad_quote', `field`:
 *   'chainId' | 'input.token' | 'output.token' | 'input.amount' | 'output.amount' | 'minOut' | 'slippageBps' | ...)
 * @throws {TypeError} cagiran hatasi (kind, chainId, adresler, amountIn, ondaliklar, slippageBps)
 */
export function lcxSwapData(
    data,
    { kind, chainId, tokenIn, tokenOut, amountIn, inDecimals, outDecimals, slippagePercent, slippageBps: userBps, nativeSymbol } = {},
) {
    if (!KINDS.has(kind)) throw new TypeError('lcxSwapData: kind swap, stable ya da rwa olmali')
    if (!Number.isInteger(chainId) || chainId <= 0) throw new TypeError('lcxSwapData: chainId pozitif tam sayi olmali')
    const sentTokenIn = callerAddress(tokenIn, 'tokenIn')
    const sentTokenOut = callerAddress(tokenOut, 'tokenOut')
    const sentAmountIn = callerAmount(amountIn)
    checkDecimals(inDecimals, 'inDecimals')
    checkDecimals(outDecimals, 'outDecimals')
    if (!isUserSlippageBps(userBps)) throw new TypeError('lcxSwapData: slippageBps 1..9999 tam sayi olmali (LCX e gonderilen)')

    if (!isObject(data) || !isObject(data.quote)) throw bad('quote')
    const q = data.quote
    if (!isObject(q.input) || !isObject(q.output)) throw bad('input/output')

    const quoteId = q.quoteId
    if (typeof quoteId !== 'string' || quoteId === '') throw bad('quoteId')

    // R14: yanit, cagiranin gonderdigiyle bire bir ortusmeli. Biri farkliysa teklif atilir.
    if (toInt(q.chainId, 'chainId') !== chainId) throw bad('chainId')
    const respTokenIn = toAddress(q.input.token, 'input.token')
    if (respTokenIn !== sentTokenIn) throw bad('input.token')
    const respTokenOut = toAddress(q.output.token, 'output.token')
    if (respTokenOut !== sentTokenOut) throw bad('output.token')
    // Tutar BigInt olarak karsilastirilir (bicim farki -- ondeki sifir, sayi/dizge -- uyusmazlik sayilmaz, deger farki sayilir).
    if (BigInt(rawAmount(q.input.amount, 'input.amount')) !== BigInt(sentAmountIn)) throw bad('input.amount')
    const outAmountRaw = rawAmount(q.output.amount, 'output.amount')

    // R18: LCX ondaligi (varsa) cagirandaki ondalikla ayni olmali. Karsilastirma yalniz gosterimi degil, ham tutarin
    // (amountIn) hangi ondalikla uretildigini de dogrular.
    if (Number.isInteger(q.input.decimals) && q.input.decimals !== inDecimals) throw bad('input.decimals')
    if (Number.isInteger(q.output.decimals) && q.output.decimals !== outDecimals) throw bad('output.decimals')

    // Yurutulecek alt sinir ve uygulanan kayma: rwa teklifinde `data.rwa` altindan (R13), digerlerinde quote'tan.
    let minOutRaw
    let slippageBps
    if (kind === 'rwa') {
        if (!isObject(data.rwa)) throw bad('rwa')
        minOutRaw = rawAmount(data.rwa.minOut, 'rwa.minOut')
        slippageBps = toInt(data.rwa.slippageBps, 'rwa.slippageBps')
    } else {
        minOutRaw = rawAmount(q.output.minimumAmount, 'output.minimumAmount')
        slippageBps = toInt(q.slippageBps, 'slippageBps')
    }

    // I1: LCX'in uyguladigi kayma en az 1 ve kullanicinin istediginden GENIS degil (yurutmeyle ayni kural).
    if (slippageBps < 1 || slippageBps > userBps) throw bad('slippageBps')
    // C1: alt sinir kullanicinin gordugu cikti ve istedigi kaymaya bagli; sifir cikti / sifir alt sinir kurulmaz.
    const outBig = BigInt(outAmountRaw)
    const minBig = BigInt(minOutRaw)
    if (outBig <= 0n) throw bad('output.amount')
    if (minBig <= 0n || minBig < lcxMinOutFloor(outBig, userBps)) throw bad('minOut')

    const lcxQuote = {
        kind,
        quoteId,
        // chainId, tokenIn, tokenOut ve amountIn: cagiranin gonderdigi (ve yanitla eslestigi dogrulanan) degerler.
        chainId,
        tokenIn: sentTokenIn,
        tokenOut: sentTokenOut,
        amountIn: sentAmountIn,
        // Kullanicinin gordugu cikti (expectedOutput'un ham hali): yurutme minOut sinirini bununla yeniden kurar.
        amountOut: outBig.toString(),
        minOut: minOutRaw,
        slippageBps,
        expiresAt: toInt(q.expiresAt, 'expiresAt'),
        spender: toAddress(q.spender, 'spender'),
        ...(kind === 'rwa' ? { rwa: rwaInfo(data.rwa) } : {}),
    }

    const expectedOutput = formatUnits(outAmountRaw, outDecimals)
    // Gosterilen alt sinir, imzalanacak islemin kontrol edecegi alt sinirla AYNI degerdir (lcxQuote.minOut).
    const minimumReceived = formatUnits(minOutRaw, outDecimals)

    // Kurun girdisi kullanicinin yazdigi tutardir (R14: inDecimals olu parametre degil).
    const inNum = Number(formatUnits(sentAmountIn, inDecimals))
    const outNum = Number(expectedOutput)

    const impact = q.priceImpactPct
    const priceImpact = typeof impact === 'number' && Number.isFinite(impact) ? `${impact.toFixed(2)}%` : 'N/A%'

    // Gaz tahmini yoksa (ya da bozuksa) null: burada uydurma bir gaz rakami yazilmaz. Swap.vue null'u 0 SAYMAZ: native gaz
    // uyarisi ve MAX payi (swapReserve) bugunku ihtiyatli sabite (SWAP_GAS_FALLBACK x gaz fiyati, utils/nativeReserve.js) duser.
    let weiRaw = null
    try {
        weiRaw = rawAmount(q.gasEstimateWei, 'gasEstimateWei')
    } catch {
        weiRaw = null
    }
    const totalCost = weiRaw === null ? null : formatUnits(weiRaw, 18)
    const gasUsd = typeof q.gasFeeUSD === 'number' && Number.isFinite(q.gasFeeUSD) ? q.gasFeeUSD : null
    const estimatedGasFee = {
        totalCost,
        totalCostFormatted: totalCost === null ? null : nativeSymbol ? `${totalCost} ${nativeSymbol}` : totalCost,
        totalCostUSD: gasUsd,
        gasType: 'Estimated',
    }

    // Kullanicinin sectigi yuzde; sayi degilse LCX'in uyguladigi kayma gosterilir.
    const pct =
        slippagePercent !== null && slippagePercent !== '' && Number.isFinite(Number(slippagePercent))
            ? Number(slippagePercent)
            : slippageBps / 100

    return {
        expectedOutput,
        slippageTolerance: `${pct.toFixed(2)}%`,
        minimumReceived,
        // V3 derinlik kapisi LCX'te yok; etki olculemediyse satir genel "olculemedi" metnini gosterir.
        depthGateWarning: false,
        priceImpact,
        liquidityProviderFee: 'N/A',
        exchangeRate: fixed6(outNum / inNum), // 1 girdi = ? cikti
        reverseExchangeRate: fixed6(inNum / outNum), // 1 cikti = ? girdi
        estimatedGasFee,
        routerType: { name: 'lcx' },
        lcxQuote,
    }
}

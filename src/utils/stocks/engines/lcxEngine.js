// LCX hisse (RWA) motoru: LCX (Liberty DEX) satirlari (`entry.source === 'lcx'`) icin Al/Sat ekraninin ARKA PLAN KOPRUSU
// (Bolum 2, Gorev 7). pancakeEngine.js ile AYNI yapi ve AYNI guvenlik kurallari; fark yalniz mesajin LCX hisse yoluna gitmesidir.
//
// YENI ARKA PLAN MESAJI YOKTUR: mevcut `SWAP_QUOTE` ve `SWAP` mesajlari `lcxKind: 'rwa'` ile kullanilir (ATS ucret teklifi ekranin
// `useAtsOpFee` yoludur: `atsPayload` ayni alanlari tasir). Arka plan (Gorev 5 / 6):
//   - SWAP_QUOTE: ihracciyi katalogla eslestirir, ALIMDA ilk alim kapisini o ihracciyla sorar, LCX'ten RWA teklifi alir ve
//     `data.lcxQuote` (kind 'rwa', `rwa: { issuer, marketOpen, refDeviationBps, referenceUsd, symbol, underlying }`) doner.
//     Red `{ error, code: 'LCX_REFUSED', lcxCode, lcxDetails }`, ulasilamazlik `LCX_UNAVAILABLE`. HICBIRI bugunku takas motoruna dusmez.
//   - SWAP / ATS ucret teklifi: AYNI `lcxQuote` (ve `side`) geri gelir; arka plan kendi kaydiyla (quoteId -> ihracci) karsilastirir
//     ve imzadan once islemi cihazda dogrular (LCX_TX_MISMATCH).
//   - `side` her mesajda ISTEGIN yonudur (R1): arka plan onu token konumlarindan turetilenle karsilastirir. Bilinmiyorsa alan
//     GONDERILMEZ (null / baska deger LCX_QUOTE_MISMATCH olur); bu motor istegi hep yonuyle kurar.
//
// BIRIM SINIRI (pancake ile ayni): tutar HEP UI birimi dizesidir ve AYNEN mesaja gider; ham birime cevrim arka planda yapilir.
//
// KILIT POLITIKASI: referans kilidi ve fiyat etkisi onayi YOKTUR (`hasReferenceLock` / `hasPriceImpactGate` false). Fiyat korumasi
// sunucuda sabittir (RWA referansindan en fazla %1 kotu); ihlal bir RED kodudur (REF_PRICE_OFF), ekran kilidi degildir.
//
// TEK KULLANIM (cift gonderim bekcisi): bir teklif EN FAZLA BIR KEZ place edilir. Arka plan ayni `lcxQuote`'u iki kez kabul edebilir
// (kaydi tuketmez); bunun ekrandaki tek bekcisi bu motordur. Tek kullanim YEREL kimlige (`lc_N`) baglidir: LCX ayni quoteId'yi
// yeniden doner ise bile `used` isareti sifirlanmaz (kayit her teklifte YENI yerel kimlikle acilir).
//
// ATS FAIL-CLOSED: gecerli `atsQuoted` (ucret > 0, komisyon >= 0) yoksa `SWAP` GONDERILMEZ (ATS_BLOCKED); arka plan tavani
// `atsQuoted` yoksa sessizce atlardi.
//
// ORTAK KORUMALAR: kimlik meta temizleme (sanitizeTokenData), ATS fail-closed kapisi (normalizeAtsQuoted), finitePositive, placeFail
// ve send pancake ile ayni dosyadan gelir (placeGuards.js, tek kaynak); iki motorun `place` dizileri ayri kalir (mesaj alanlari
// farkli) ve placeGuards.parity.test.js ayni girdi tablosunu ikisinden de gecirir.
import { formatUnits } from 'ethers'
import { isLcxStock, stockEntry } from '../../tokenizedStocks'
import { LCX_PAY_TOKENS, lcxPayToken } from '../../lcx/payTokens'
import { quoteRows as cowQuoteRows } from '../../stockTrade'
import { gateLockedReply, parseStockGateError } from '../../stockGate/errors'
import { ENGINE_ERROR, engineErrorKey } from './errors'
import { readTradeContext } from './pancakeEngine'
import { toQuoteResponse } from './pancakeQuote'
import { finitePositive, normalizeAtsQuoted, placeFail, sanitizeTokenData, send } from './placeGuards'

/** Teklif omru ust siniri: gosterilen teklif `min(LCX expiresAt, simdi + 30 sn)` kadar yasar. */
export const LCX_QUOTE_TTL_MS = 30000
/** `SWAP` mesajinin TAM alan kumesi (testle kilitli): display / teklif nesnesi bu kumede YOK. */
export const LCX_PLACE_FIELDS = Object.freeze([
  'index', 'chainId', 'inTokenAddress', 'outTokenAddress', 'amount', 'slippage', 'side', 'atsSwap', 'atsQuoted', 'lcxKind', 'lcxQuote',
])
/** Istege bagli kimlik alanlari (gecmis karti sembol / logo): yalniz kimlik meta'si, display / tutar BURADAN GECMEZ. */
export const LCX_PLACE_OPTIONAL_FIELDS = Object.freeze(['inTokenData', 'outTokenData'])
const MAX_QUOTES = 32
// Suresi dolmus kayit bu kadar daha tutulur: place QUOTE_NOT_FOUND yerine QUOTE_EXPIRED diyebilsin.
const EXPIRED_GRACE_MS = 5 * 60 * 1000

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const CLEAN_AMOUNT = /^\d+(\.\d+)?$/
// atsPaymaster.confirmUserOp: `islem sonucu dogrulanamadi (txHash: 0x...)`
const ATS_OP_FAILED = 'transfer islemi basarisiz'
const UNVERIFIED_ERROR = /islem sonucu dogrulanamadi \(txHash: (0x[0-9a-fA-F]{64})\)/

// Eslesme tablosu 1: `code: 'LCX_REFUSED'` yanitinin `lcxCode`u (LCX'in red kodu) -> motor kodu.
const REFUSAL_CODE = Object.freeze({
  below_tolerance: ENGINE_ERROR.REF_PRICE_OFF,
  off_reference: ENGINE_ERROR.REF_PRICE_OFF,
  no_reference_price: ENGINE_ERROR.NO_REFERENCE_PRICE,
  no_reference_rate: ENGINE_ERROR.NO_REFERENCE_PRICE,
  insufficient_liquidity: ENGINE_ERROR.INSUFFICIENT_LIQUIDITY,
  excluded_coin: ENGINE_ERROR.RWA_EXCLUDED,
  excluded: ENGINE_ERROR.RWA_EXCLUDED,
  not_an_rwa: ENGINE_ERROR.RWA_EXCLUDED,
  use_rwa: ENGINE_ERROR.RWA_EXCLUDED,
  issuer_mismatch: ENGINE_ERROR.ISSUER_MISMATCH,
  QUOTE_EXPIRED: ENGINE_ERROR.QUOTE_EXPIRED,
  price_moved: ENGINE_ERROR.QUOTE_EXPIRED,
  // Gorev tablosunda YOK; hisse icin rota yoklugu LCX'ten gelir (Gorev 5: yedege dusmez) ve mevcut NO_ROUTE metni dogrudur.
  no_route: ENGINE_ERROR.NO_ROUTE,
})
// Eslesme tablosu 2: arka plan yanitinin `code`u -> motor kodu. LCX_QUOTE_MISMATCH'in HER alani (lcxQuote, kind, chainId, stock,
// side, payToken, amount, slippage ya da alansiz) ve LCX_REQUOTE ayni sonuca gider: onay katmani kapanir, teklif yenilenir.
const BACKGROUND_CODE = Object.freeze({
  LCX_UNAVAILABLE: ENGINE_ERROR.LCX_UNAVAILABLE,
  LCX_REQUOTE: ENGINE_ERROR.QUOTE_EXPIRED,
  LCX_QUOTE_MISMATCH: ENGINE_ERROR.QUOTE_EXPIRED,
  QUOTE_EXPIRED: ENGINE_ERROR.QUOTE_EXPIRED,
  LCX_TX_MISMATCH: ENGINE_ERROR.LCX_TX_REJECTED,
  INSUFFICIENT_BALANCE: ENGINE_ERROR.INSUFFICIENT_BALANCE,
  ONCHAIN_FAILED: ENGINE_ERROR.SWAP_REVERTED,
})

const fail = (code, errorInfo) => (errorInfo === undefined ? { success: false, code } : { success: false, code, errorInfo })

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isLcxChain = (chainId) => typeof chainId === 'number' && Object.hasOwn(LCX_PAY_TOKENS, chainId)

// Arka plan yanitindaki `lcxQuote`'un motorun ihtiyac duydugu en az sekli: rwa teklifi, kimlikli, rwa blogu ve sayisal omur.
const isRwaQuote = (q) => isObject(q) && q.kind === 'rwa' && typeof q.quoteId === 'string' && q.quoteId !== '' && isObject(q.rwa) && Number.isFinite(q.expiresAt)

/**
 * QuoteRequest kurar. LCX agi disi / LCX satiri olmayan hisse / odeme tablosu disi token / gecersiz tutar -> null.
 * Odeme tokeni nesne ya da adres dizesi olabilir; native ('0x0', sifir adres, 0xEeee...) '0x0'a, ERC-20 tablodaki yazimina cevrilir.
 * `index` ve `slippage` (ATS ucret yuku ayni degerle kurulsun diye) istege bagli.
 */
function buildQuoteMessage({ side, chainId, stockAddress, payToken, amount, index, slippage } = {}) {
  if (side !== 'buy' && side !== 'sell') return null
  if (!isLcxChain(chainId)) return null
  if (typeof stockAddress !== 'string' || !ADDRESS.test(stockAddress)) return null
  if (!isLcxStock(chainId, stockAddress)) return null
  const pay = lcxPayToken(chainId, typeof payToken === 'string' ? payToken : payToken?.address)
  if (!pay) return null
  if (typeof amount !== 'string' || !CLEAN_AMOUNT.test(amount) || !/[1-9]/.test(amount)) return null
  const clean = amount.includes('.') ? amount.replace(/0+$/, '').replace(/\.$/, '') : amount
  const buy = side === 'buy'
  const request = {
    side,
    chainId,
    stockAddress,
    payToken: pay.address,
    inTokenAddress: buy ? pay.address : stockAddress,
    outTokenAddress: buy ? stockAddress : pay.address,
    amount: clean,
    lcxKind: 'rwa',
  }
  if (typeof index === 'string' && index !== '') request.index = index
  if (finitePositive(slippage)) request.slippage = slippage
  return request
}

/** Ekranin `useAtsOpFee().load(...)` yuku: arka planin ATS ucret teklifi mesajiyla ayni alanlar + `lcxKind`, `lcxQuote`, `side` (R1). */
function atsPayload(request) {
  if (!isObject(request)) return null
  if (request.lcxKind !== 'rwa' || !isRwaQuote(request.lcxQuote)) return null
  if (request.side !== 'buy' && request.side !== 'sell') return null
  // index/slippage yoksa yuk KURULMAZ: ATS callData'si SWAP'in kullanacagi slippage ile ayni olmak zorunda.
  if (typeof request.index !== 'string' || request.index === '' || !finitePositive(request.slippage)) return null
  return {
    kind: 'swap',
    payload: {
      index: request.index,
      chainId: request.chainId,
      inTokenAddress: request.inTokenAddress,
      outTokenAddress: request.outTokenAddress,
      amount: request.amount,
      slippage: request.slippage,
      side: request.side,
      lcxKind: 'rwa',
      lcxQuote: request.lcxQuote,
    },
  }
}

// Arka plan yaniti -> kapali motor kodu. Tanimayan kod / metin icin `fallback`; sebep UYDURULMAZ ("rota yok" asla varsayilan degildir).
function mapReply(reply, fallback) {
  const refused = reply.code === 'LCX_REFUSED'
  const table = refused ? REFUSAL_CODE : BACKGROUND_CODE
  const key = refused ? reply.lcxCode : reply.code
  if (typeof key === 'string' && Object.hasOwn(table, key)) return table[key]
  // Kodsuz arka plan metinleri (ATS yolu): userOp zincirde ic revert etti / bakiye yetmedi. pancake ile ayni.
  const text = typeof reply.error === 'string' ? reply.error : ''
  if (text.includes(ATS_OP_FAILED)) return ENGINE_ERROR.SWAP_REVERTED
  if (/insufficient (balance|funds)/i.test(text)) return ENGINE_ERROR.INSUFFICIENT_BALANCE
  return fallback
}

/**
 * ATS ucret teklifinin (ekranin useAtsOpFee yolu) LCX yaniti `{ code, lcxCode?, error? }` -> motor kodu (ekran metni icin). quote / place ile AYNI
 * esleme tablolari; taninmayan kod ya da bozuk yanit UNKNOWN (sebep uydurulmaz).
 */
export const lcxReplyCode = (reply) => (isObject(reply) ? mapReply(reply, ENGINE_ERROR.UNKNOWN) : ENGINE_ERROR.UNKNOWN)

// `lcxDetails.fillsUpTo` GUVENILMEZ sunucu verisidir: ham GIRDI tokeni birimi (rakam dizgesi ya da guvenli tam sayi) olmali ve
// girdi tokeninin ondaligiyla bicimlenir (Al: odeme tokeni, Sat: hisse). "En fazla" bir USTSINIRDIR: gosterilen sayi gercek sinirdan
// BUYUK olamaz, bu yuzden kayan noktaya girilmez; formatUnits dizgesi 4 ondaliga YUVARLANMADAN KIRPILIR. Gecersiz / sifir /
// bicimlenemeyen deger null (cagiran errorInfo yazmaz, ekran "en fazla" satirini cizmez).
function liquidityMax(details, token) {
  const raw = isObject(details) ? details.fillsUpTo : undefined
  let units = null
  if (typeof raw === 'string' && /^[0-9]{1,78}$/.test(raw)) units = BigInt(raw)
  else if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) units = BigInt(raw)
  const decimals = token?.decimals
  if (units === null || units <= 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null
  const [whole, fraction = ''] = formatUnits(units, decimals).split('.')
  const kept = fraction.slice(0, 4).replace(/0+$/, '')
  // Kirpinca hicbir sey kalmadiysa (0.00009 gibi) "en fazla 0" denmez.
  if (BigInt(whole) === 0n && kept === '') return null
  const text = kept ? `${whole}.${kept}` : whole
  const symbol = typeof token?.symbol === 'string' ? token.symbol : ''
  return symbol ? `${text} ${symbol}` : text
}

// lcxQuote yalniz JSON verisidir (dize / sayi / boolean / null): kayit ekranin tuttugu nesneden BAGIMSIZ kopyadir.
const copyJson = (value) => JSON.parse(JSON.stringify(value))

/** `now` ve teklif omru test icin enjekte edilebilir; uretimde `lcxEngine` tekilidir. */
export function createLcxEngine({ now = () => Date.now(), ttlMs = LCX_QUOTE_TTL_MS } = {}) {
  // quoteId -> { request (lcxQuote dahil), expiresAt, used }. YALNIZ UI birimi istek ve zaman; display/yanit TUTULMAZ.
  const quotes = new Map()
  let seq = 0

  const remember = (quoteId, request, expiresAt) => {
    const t = now()
    for (const [id, q] of quotes) if (q.expiresAt + EXPIRED_GRACE_MS < t) quotes.delete(id)
    quotes.set(quoteId, { request, expiresAt, used: false })
    while (quotes.size > MAX_QUOTES) quotes.delete(quotes.keys().next().value)
  }

  async function quote(raw) {
    if (!raw || typeof raw !== 'object') return fail(ENGINE_ERROR.INVALID_REQUEST)
    if (!isLcxChain(raw.chainId)) return fail(ENGINE_ERROR.CHAIN_UNSUPPORTED)
    const base = buildQuoteMessage(raw)
    if (!base) return fail(ENGINE_ERROR.INVALID_REQUEST)

    let request = base
    if (request.index === undefined || request.slippage === undefined) {
      let ctx
      try {
        ctx = await readTradeContext()
      } catch {
        ctx = null
      }
      if (!ctx) return fail(ENGINE_ERROR.INVALID_REQUEST)
      request = { ...base, index: base.index ?? ctx.index, slippage: base.slippage ?? ctx.slippage }
    }

    // Mesaj: TAM alan kumesi, tutar UI dizesi AYNEN; display / odeme tokeni meta'si mesaja GITMEZ.
    const message = {
      index: request.index,
      chainId: request.chainId,
      inTokenAddress: request.inTokenAddress,
      outTokenAddress: request.outTokenAddress,
      amount: request.amount,
      slippage: request.slippage,
      side: request.side,
      lcxKind: 'rwa',
    }
    let reply
    try {
      reply = await send({ type: 'SWAP_QUOTE', message })
    } catch (e) {
      console.error('Hisse teklifi alinamadi:', e?.message || e)
      return fail(ENGINE_ERROR.UNKNOWN)
    }

    const pay = lcxPayToken(request.chainId, request.payToken)
    if (reply && typeof reply.error === 'string') {
      // Kapi reddi 'STOCK_GATE:<NEDEN>' bir hata degil kilittir (genel hata esleme ve console.error'dan ONCE).
      const gateReason = parseStockGateError(reply.error)
      if (gateReason !== null) return gateLockedReply(gateReason)
      const code = mapReply(reply, ENGINE_ERROR.UNKNOWN)
      if (code === ENGINE_ERROR.UNKNOWN) console.error('Hisse teklifi alinamadi:', reply.error)
      if (code === ENGINE_ERROR.INSUFFICIENT_LIQUIDITY) {
        // fillsUpTo GIRDI tokenindedir: Al'da odeme tokeni, Sat'ta hisse.
        const max = liquidityMax(reply.lcxDetails, request.side === 'buy' ? pay : stockEntry(request.chainId, request.stockAddress))
        if (max !== null) return fail(code, { max })
      }
      return fail(code)
    }
    if (!reply || reply.success !== true) {
      console.error('Hisse teklifi alinamadi: gecersiz yanit')
      return fail(ENGINE_ERROR.UNKNOWN)
    }
    const data = reply.data
    const lcxQuote = data?.lcxQuote
    if (!isRwaQuote(lcxQuote)) return fail(ENGINE_ERROR.BAD_QUOTE_RESPONSE)

    const t = now()
    const quoteId = `lc_${++seq}`
    // Gosterim alanlari lcxSwapData ile AYNI adlardadir (expectedOutput, minimumReceived, priceImpact, ...): ortak donusturucu.
    const result = toQuoteResponse(data, {
      side: request.side,
      amount: request.amount,
      referencePrice: lcxQuote.rwa.referenceUsd,
      quoteId,
      now: t,
      ttlMs,
    })
    if (!result.success) return result
    // Omur: LCX'in kendi suresi (saniye) ile simdi + ttl'nin kucugu. Coktan dolmus teklif gosterilmez: ekran suresi dolan teklifi
    // HEMEN yeniler, yani gecmisteki bir expiresAt (saat kaymasi) sonsuz yenileme dongusu olurdu.
    const expiresAt = Math.min(lcxQuote.expiresAt * 1000, result.expiresAt)
    if (expiresAt <= t) return fail(ENGINE_ERROR.QUOTE_EXPIRED)

    // Native odemede birim fiyat odeme coini cinsindendir (ETH / hisse): USD referansla KIYASLANAMAZ ve "$" ile yazilamaz.
    // Bu yuzden birim fiyat ve fark bos birakilir; referans fiyat (USD) odeme tokeninden bagimsiz gosterilir.
    const display = {
      ...result.display,
      engine: 'lcx',
      routerLabel: 'LCX',
      ...(pay?.native === true ? { unitPrice: null, gapPct: null, gapWarn: false } : {}),
    }
    remember(quoteId, { ...request, lcxQuote: copyJson(lcxQuote) }, expiresAt)
    return {
      ...result,
      expiresAt,
      display,
      reference: { usd: result.display.referencePrice, source: 'lcx' },
      request: { ...request, lcxQuote },
    }
  }

  async function place({ quote: q, request: asked, atsQuoted, atsBlocked, accountIndex, inTokenData, outTokenData } = {}) {
    const quoteId = q?.quoteId
    if (typeof quoteId !== 'string' || quoteId === '') return placeFail(ENGINE_ERROR.QUOTE_NOT_FOUND)
    const entry = quotes.get(quoteId)
    if (!entry) return placeFail(ENGINE_ERROR.QUOTE_NOT_FOUND)
    if (entry.used) return placeFail(ENGINE_ERROR.QUOTE_USED)
    if (now() > entry.expiresAt) {
      quotes.delete(quoteId)
      return placeFail(ENGINE_ERROR.QUOTE_EXPIRED)
    }

    const stored = entry.request
    // Ekran teklifle FARKLI bir islem isterse (tutar/yon/token) gonderilmez; mesaj hep kayitli istekten kurulur (lcxQuote dahil:
    // ekranin elindeki lcxQuote HICBIR zaman mesaja girmez).
    if (asked && typeof asked === 'object') {
      for (const k of ['chainId', 'inTokenAddress', 'outTokenAddress', 'amount']) {
        if (asked[k] !== stored[k]) return placeFail(ENGINE_ERROR.QUOTE_MISMATCH)
      }
    }
    if (accountIndex !== undefined && accountIndex !== stored.index) return placeFail(ENGINE_ERROR.ACCOUNT_CHANGED)

    const inMeta = sanitizeTokenData(inTokenData, stored.inTokenAddress)
    const outMeta = sanitizeTokenData(outTokenData, stored.outTokenAddress)
    if (inMeta === 'mismatch' || outMeta === 'mismatch') return placeFail(ENGINE_ERROR.QUOTE_MISMATCH)

    if (atsBlocked === true) return placeFail(ENGINE_ERROR.ATS_BLOCKED)
    const approved = normalizeAtsQuoted(atsQuoted)
    if (!approved) return placeFail(ENGINE_ERROR.ATS_BLOCKED)

    // SWAP arka planda aktif hesabi DEPODAN okur: tekliften sonra hesap degistiyse imza baska hesaptan cikardi.
    let live = null
    try {
      live = await readTradeContext()
    } catch {
      live = null
    }
    if (!live || live.index !== stored.index) return placeFail(ENGINE_ERROR.ACCOUNT_CHANGED)

    // Es zamanli iki place: kontrol ile isaretleme arasinda await YOK (yukaridaki await'ten sonra yeniden bak).
    if (entry.used) return placeFail(ENGINE_ERROR.QUOTE_USED)
    if (now() > entry.expiresAt) {
      quotes.delete(quoteId)
      return placeFail(ENGINE_ERROR.QUOTE_EXPIRED)
    }
    entry.used = true

    const message = {
      index: stored.index,
      chainId: stored.chainId,
      inTokenAddress: stored.inTokenAddress,
      outTokenAddress: stored.outTokenAddress,
      amount: stored.amount,
      slippage: stored.slippage,
      side: stored.side,
      atsSwap: true,
      atsQuoted: approved,
      lcxKind: 'rwa',
      lcxQuote: stored.lcxQuote,
      ...(inMeta ? { inTokenData: inMeta } : {}),
      ...(outMeta ? { outTokenData: outMeta } : {}),
    }
    let reply
    try {
      reply = await send({ type: 'SWAP', message })
    } catch (e) {
      // Mesaj gitmis olabilir: "basarisiz" DENMEZ, belirsiz sonuc.
      console.error('Hisse islemi sonucu alinamadi:', e?.message || e)
      return placeFail(ENGINE_ERROR.UNKNOWN)
    }
    if (reply && reply.success === true) {
      const hash = typeof reply.hash === 'string' && reply.hash !== '' ? reply.hash : null
      // "gonderildi": ATS yolunda arka plan makbuzu BEKLER ve ic basariyi dogrular; success donduyse sonuc dogrulanmistir.
      // `unverified` = makbuz alinamadi: islem zincire gitmis OLABILIR, "gonderilemedi" denmez ve tekrar denenmemelidir.
      // ATS yolunda hash userOp hash'idir (tx hash DEGIL).
      return {
        ok: true, kind: 'tx', id: quoteId, hash, hashKind: hash ? 'userOp' : null, submitted: true,
        ...(reply.unverified === true ? { unverified: true } : {}),
      }
    }
    if (reply && typeof reply.error === 'string') {
      // Kapi reddi (UNVERIFIED ayristirmasindan ve genel esleme ONCE). Teklif bu noktada zaten used kalir.
      if (parseStockGateError(reply.error) !== null) return placeFail(ENGINE_ERROR.STOCK_GATE)
      // Arka plan txHash tasiyan "dogrulanamadi" metnini hata olarak cevirirse bile: islem zincire gitmis olabilir,
      // belirsiz sonuc olarak ele alinir. Cift alim yolu acilmaz.
      const unverified = UNVERIFIED_ERROR.exec(reply.error)
      if (unverified) {
        return { ok: true, kind: 'tx', id: quoteId, hash: unverified[1], hashKind: 'userOp', submitted: true, unverified: true }
      }
      return placeFail(mapReply(reply, ENGINE_ERROR.SWAP_FAILED))
    }
    console.error('Hisse islemi sonucu alinamadi: gecersiz yanit')
    return placeFail(ENGINE_ERROR.UNKNOWN)
  }

  return Object.freeze({
    id: 'lcx',
    hasApprovalStep: false,
    hasPriceImpactGate: false,
    hasReferenceLock: false,
    hasOrderLifecycle: false,
    showsCowDisclosure: false,
    usesAts: true,

    // Her LCX agi icin USDC, USDT, native (utils/lcx/payTokens.js). Kopya doner: tablo disaridan degistirilemez.
    payTokens: (chainId) => (isLcxChain(chainId) ? LCX_PAY_TOKENS[chainId].map((t) => ({ ...t })) : []),

    buildQuoteMessage,
    quote,
    atsPayload,

    // CoW satirlarini ortak yardimcidan al; CoW'a ozgu ucret / ag ucreti / bildirim satirlari LCX'te YOKTUR (pancake ile ayni).
    quoteRows(args = {}) {
      const base = cowQuoteRows(args)
      const d = args.result?.display
      if (!base || !d) return null
      return {
        ...base,
        fees: [],
        feesTotalUsd: null,
        networkFee: null,
        notice: null,
        warnings: [],
        gapWarn: d.gapWarn === true,
        priceImpact: d.priceImpact ?? null,
        ats: d.fees?.kind === 'ats' ? d.fees : null,
      }
    },

    primaryAction: () => 'trade',
    place,
    // CoW'a ozgu metin hisse ekraninda gorunmez: ag/zaman asimi/sunucu hatalari notr metne, FORBIDDEN genel hataya (pancake ile ayni).
    errorKey: (code) =>
      code === ENGINE_ERROR.NETWORK || code === ENGINE_ERROR.TIMEOUT || code === ENGINE_ERROR.SERVER
        ? 'stockTrade.error.NETWORK_GENERIC'
        : engineErrorKey(code === ENGINE_ERROR.FORBIDDEN ? ENGINE_ERROR.UNKNOWN : code),
  })
}

export const lcxEngine = createLcxEngine()

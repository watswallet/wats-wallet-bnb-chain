// bStocks (PancakeSwap) motoru: hisse Al/Sat ekraninin ARKA PLAN KOPRUSU (spec 7.3).
//
// YENI ARKA PLAN MESAJI YOKTUR: mevcut `SWAP_QUOTE`, `ATS_SWAP_FEE_QUOTE` (ekran `useAtsOpFee` ile ister)
// ve `SWAP` mesajlari kullanilir (`messageGate.js` degismez). Kaynaklar (T12'de OKUNDU, spec varsayimlari duzeltildi):
//   - Swap.vue: mesaj `{ index, chainId, inTokenAddress, outTokenAddress, amount, slippage }`; `index` =
//     ice aktarilmis hesapta adres, aksi halde derivationPath; `slippage` = depodaki `swap_slippage || 0.5`.
//     Teklif Swap.vue'da 10 sn'de bir yenilenir; spec'in 30 sn omru (PANCAKE_QUOTE_TTL_MS) KORUNDU: arka plan
//     `SWAP`ta rotayi ve minimumReceived'i yeniden hesaplar, yani gosterilen teklif bilgidir, kayit degildir.
//   - background.js `swap()`: aktif hesabi `message.account` yoksa DEPODAN okur, `index`i KULLANMAZ. Bu yuzden
//     hesap degisimi `place` icinde depoya bakilarak yakalanir (ekranin verdigi hesaba guvenilmez).
//   - `SWAP` yaniti `{ success:true, hash }` ya da `{ error }`. ATS yolunda arka plan MAKBUZU BEKLER
//     (`executeAtsTransfer` -> `confirmUserOp`, en fazla ~60 sn) ve userOp ic basarisini dogrular: success
//     donduyse sonuc dogrulanmistir (executeAtsTransfer userOp `success !== true` iken firlatir: SWAP_REVERTED);
//     makbuz alinamazsa `{ success:true, unverified:true }` (islem zincire gitmis OLABILIR: sonuc `unverified`,
//     HATA DEGIL, tekrar denenmemeli). `hash` bir USEROP hash'idir, tx hash DEGIL; sonuc `hashKind:'userOp'`.
//   - ATS tavani: `assertQuoteWithinApproval` `atsQuoted` yoksa ya da <= 0 ise tavani SESSIZCE atlar. Bu motor
//     gecerli `atsQuoted` olmadan `SWAP` GONDERMEZ (ATS_BLOCKED, fail-closed).
//
// BIRIM SINIRI (spec 8): tutar HEP UI birimi dizesidir ve AYNEN mesaja gider. Ham birime cevrim yalniz
// mevcut swap.js / arka plan yolunda yapilir; burada carpan okunmaz, uygulanmaz, UI-atom degerleri (display)
// hicbir mesaja geri gonderilmez. Carpan okunamazsa arka plan `BSTOCK_MULTIPLIER_ERROR` firlatir; bu motor onu
// MULTIPLIER_UNREADABLE yapar (teklif ve islem YOK).
//
// KILIT POLITIKASI (patron S1/TK10): referans kilidi yok; kapi fiyat etkisi onay kutusudur (ekran) ve ATS karari.
import { stockIssuer } from '../../tokenizedStocks'
import { BSTOCKS_CHAIN_ID } from '../../../data/bStocks'
import { payTokensFor } from '../../cow/config'
import { quoteRows as cowQuoteRows } from '../../stockTrade'
import { BSTOCK_MULTIPLIER_ERROR } from '../../bstocksSpend'
import { LIQUIDITY_GATE_ERROR, NO_ROUTE_ERROR } from '../../swapRoutes'
import { ENGINE_ERROR, engineErrorKey } from './errors'
import { PANCAKE_QUOTE_TTL_MS, toQuoteResponse } from './pancakeQuote'

/** Swap.vue `DEFAULT_SWAP_SLIPPAGE` ile ayni (o sabit disari acik degil). */
export const PANCAKE_DEFAULT_SLIPPAGE = 0.5
/** `SWAP` mesajinin TAM alan kumesi (testle kilitli): display/teklif nesnesi bu kumede YOK. */
export const PANCAKE_PLACE_FIELDS = Object.freeze([
  'index', 'chainId', 'inTokenAddress', 'outTokenAddress', 'amount', 'slippage', 'atsSwap', 'atsQuoted',
])
/**
 * Istege bagli kimlik alanlari: arka plan `swap()` islem gecmisi kartini (sembol / logo) YALNIZ bunlardan kurar.
 * Yalniz kimlik meta'sidir (symbol, name, address, image/logo); display / teklif / tutar BURADAN GECMEZ.
 */
export const PANCAKE_PLACE_OPTIONAL_FIELDS = Object.freeze(['inTokenData', 'outTokenData'])
const MAX_QUOTES = 32
// Suresi dolmus kayit bu kadar daha tutulur: place QUOTE_NOT_FOUND yerine QUOTE_EXPIRED diyebilsin.
const EXPIRED_GRACE_MS = 5 * 60 * 1000

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const CLEAN_AMOUNT = /^\d+(\.\d+)?$/
const NUMERIC = /^\d+(\.\d+)?$/
const ZERO_DECIMAL = /^0*\.?0*$/
const MAX_META_LEN = 512
// atsPaymaster.confirmUserOp: `islem sonucu dogrulanamadi (txHash: 0x...)`
const ATS_OP_FAILED = 'transfer islemi basarisiz'
const UNVERIFIED_ERROR = /islem sonucu dogrulanamadi \(txHash: (0x[0-9a-fA-F]{64})\)/

const fail = (code) => ({ success: false, code })
const placeFail = (code) => ({ ok: false, code })
const send = (message) => chrome.runtime.sendMessage(message)

const finitePositive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0

/** Aktif hesaptan Swap.vue ile ayni `index` ve `slippage`. Hesap yoksa null. */
export async function readTradeContext() {
  const { active_account, swap_slippage } = await chrome.storage.local.get(['active_account', 'swap_slippage'])
  if (!active_account || typeof active_account !== 'object') return null
  const index = active_account.type === 'imported' ? active_account.address : active_account.derivationPath
  if (typeof index !== 'string' || index === '') return null
  return { index, slippage: finitePositive(swap_slippage) ? swap_slippage : PANCAKE_DEFAULT_SLIPPAGE }
}

/**
 * QuoteRequest kurar. Desteklenmeyen zincir / katalog disi hisse / PAY_TOKENS disi odeme tokeni / gecersiz tutar -> null.
 * `index`, `slippage` (ayni anda ATS ucret yuku icin) ve `referencePrice` (gosterim birimi USD, mesaja GITMEZ) istege bagli.
 */
function buildQuoteMessage({ side, chainId, stockAddress, payToken, amount, index, slippage, referencePrice, atsFees } = {}) {
  if (side !== 'buy' && side !== 'sell') return null
  if (chainId !== BSTOCKS_CHAIN_ID) return null
  if (typeof stockAddress !== 'string' || !ADDRESS.test(stockAddress)) return null
  if (stockIssuer(chainId, stockAddress) !== 'bstocks') return null
  const payAddress = typeof payToken === 'string' ? payToken : payToken?.address
  if (typeof payAddress !== 'string' || !ADDRESS.test(payAddress)) return null
  const pay = payTokensFor(chainId).find((t) => t.address.toLowerCase() === payAddress.toLowerCase())
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
    referencePrice: finitePositive(referencePrice) ? referencePrice : null,
  }
  if (typeof index === 'string' && index !== '') request.index = index
  if (finitePositive(slippage)) request.slippage = slippage
  if (atsFees && typeof atsFees === 'object') request.atsFees = atsFees
  return request
}

/** Ekranin `useAtsOpFee().load(...)` yuku (Swap.vue refreshAtsOpFee ile ayni alanlar). Cozulmemis istek -> null. */
function atsPayload(request) {
  if (!request || request.chainId !== BSTOCKS_CHAIN_ID) return null
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
    },
  }
}

// Arka plan hata metni -> kapali kod. Taninmayan metin icin `fallback`; "rota yok" ASLA varsayilan degildir.
function mapBackgroundError(message, fallback, { network = false } = {}) {
  const text = typeof message === 'string' ? message : ''
  if (text.includes(BSTOCK_MULTIPLIER_ERROR)) return ENGINE_ERROR.MULTIPLIER_UNREADABLE
  if (text.includes(LIQUIDITY_GATE_ERROR)) return ENGINE_ERROR.NO_LIQUIDITY
  if (text.includes(NO_ROUTE_ERROR)) return ENGINE_ERROR.NO_ROUTE
  if (text.includes('Unsupported chain')) return ENGINE_ERROR.CHAIN_UNSUPPORTED
  if (text.includes('XSTOCK_USE_COW')) return ENGINE_ERROR.UNSUPPORTED_TOKEN
  if (/insufficient (balance|funds)/i.test(text)) return ENGINE_ERROR.INSUFFICIENT_BALANCE
  // userOp zincire indi ama IC REVERT etti (orn. slippage): atsPaymaster.executeAtsTransfer bunu txHash'siz
  // 'transfer islemi basarisiz veya sonucu dogrulanamadi' diye firlatir. Takas OLMADI: "gonderilemedi" degil.
  if (text.includes(ATS_OP_FAILED)) return ENGINE_ERROR.SWAP_REVERTED
  if (network && text.includes('Network Error')) return ENGINE_ERROR.NETWORK
  return fallback
}

// Gecmis karti icin token kimligi: yalniz bilinen alanlar, yalniz dize (logo icin tokenLogo() sekilleri), kisa.
// Sembol yoksa kimlik anlamsiz -> null. Adres verilmisse islemin gercek tokeniyle ESLESMEK zorunda (yoksa 'mismatch').
function sanitizeTokenData(data, expectedAddress) {
  if (data === undefined || data === null) return null
  if (typeof data !== 'object') return 'mismatch'
  const str = (v) => (typeof v === 'string' && v.trim() !== '' && v.length <= MAX_META_LEN ? v.trim() : null)
  if (data.address !== undefined && data.address !== null) {
    if (typeof data.address !== 'string' || data.address.toLowerCase() !== expectedAddress.toLowerCase()) return 'mismatch'
  }
  const out = {}
  const symbol = str(data.symbol)
  if (!symbol) return null
  out.symbol = symbol
  const name = str(data.name)
  if (name) out.name = name
  out.address = expectedAddress
  if (typeof data.image === 'string') {
    const image = str(data.image)
    if (image) out.image = image
  } else if (data.image && typeof data.image === 'object') {
    const image = {}
    for (const k of ['large', 'small', 'thumb']) {
      const v = str(data.image[k])
      if (v) image[k] = v
    }
    if (Object.keys(image).length) out.image = image
  }
  for (const k of ['logoURI', 'logo']) {
    const v = str(data[k])
    if (v) out[k] = v
  }
  return out
}

// ATS onayi: ucret > 0 (0 olursa arka plan tavani atlar), komisyon >= 0 ve ikisi de sayi. Gecersiz -> null.
function normalizeAtsQuoted(atsQuoted) {
  if (!atsQuoted || typeof atsQuoted !== 'object') return null
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && NUMERIC.test(v.trim()) ? Number(v) : NaN)
  const transferFee = num(atsQuoted.transferFee)
  const commissionFee = num(atsQuoted.commissionFee)
  if (!Number.isFinite(transferFee) || transferFee <= 0) return null
  if (!Number.isFinite(commissionFee) || commissionFee < 0) return null
  return { transferFee, commissionFee }
}

/** `now` ve teklif omru test icin enjekte edilebilir; uretimde `pancakeEngine` tekilidir. */
export function createPancakeEngine({ now = () => Date.now(), ttlMs = PANCAKE_QUOTE_TTL_MS } = {}) {
  // quoteId -> { request, expiresAt, used }. YALNIZ UI birimi istek ve zaman; display/yanit TUTULMAZ.
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
    if (raw.chainId !== BSTOCKS_CHAIN_ID) return fail(ENGINE_ERROR.CHAIN_UNSUPPORTED)
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

    // Mesaj: TAM alan kumesi, tutar UI dizesi AYNEN; referans fiyat / atsFees / display mesaja GITMEZ.
    const message = {
      index: request.index,
      chainId: request.chainId,
      inTokenAddress: request.inTokenAddress,
      outTokenAddress: request.outTokenAddress,
      amount: request.amount,
      slippage: request.slippage,
    }
    let reply
    try {
      reply = await send({ type: 'SWAP_QUOTE', message })
    } catch (e) {
      console.error('Hisse teklifi alinamadi:', e?.message || e)
      return fail(ENGINE_ERROR.UNKNOWN)
    }

    if (reply && typeof reply.error === 'string') {
      const code = mapBackgroundError(reply.error, ENGINE_ERROR.UNKNOWN, { network: true })
      if (code === ENGINE_ERROR.UNKNOWN) console.error('Hisse teklifi alinamadi:', reply.error)
      return fail(code)
    }
    if (!reply || reply.success !== true) {
      console.error('Hisse teklifi alinamadi: gecersiz yanit')
      return fail(ENGINE_ERROR.UNKNOWN)
    }
    const data = reply.data
    if (data && typeof data.expectedOutput === 'string' && data.expectedOutput.trim() !== '' && ZERO_DECIMAL.test(data.expectedOutput.trim())) {
      return fail(ENGINE_ERROR.AMOUNT_TOO_SMALL)
    }

    const quoteId = `ps_${++seq}`
    const result = toQuoteResponse(data, {
      side: request.side,
      amount: request.amount,
      referencePrice: request.referencePrice,
      quoteId,
      now: now(),
      ttlMs,
      atsFees: request.atsFees,
    })
    if (!result.success) return result
    remember(quoteId, request, result.expiresAt)
    return { ...result, request }
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
    // Ekran teklifle FARKLI bir islem isterse (tutar/yon/token) gonderilmez; mesaj hep kayitli istekten kurulur.
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
      atsSwap: true,
      atsQuoted: approved,
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
      // "gonderildi": ATS yolunda arka plan makbuzu (en fazla ~60 sn) BEKLER ve ic basariyi (userOp success)
      // dogrular; success donduyse sonuc dogrulanmistir. `unverified` = makbuz alinamadi ya da olay bulunamadi:
      // islem zincire gitmis OLABILIR, "gonderilemedi" denmez ve tekrar denenmemelidir (Gecmis'ten kontrol).
      // ATS yolunda hash userOp hash'idir.
      return {
        ok: true, kind: 'tx', id: quoteId, hash, hashKind: hash ? 'userOp' : null, submitted: true,
        ...(reply.unverified === true ? { unverified: true } : {}),
      }
    }
    if (reply && typeof reply.error === 'string') {
      // Arka plan txHash tasiyan "dogrulanamadi" metnini hata olarak cevirirse bile: islem zincire gitmis olabilir,
      // belirsiz sonuc olarak ele alinir. Cift alim yolu acilmaz.
      const unverified = UNVERIFIED_ERROR.exec(reply.error)
      if (unverified) {
        return { ok: true, kind: 'tx', id: quoteId, hash: unverified[1], hashKind: 'userOp', submitted: true, unverified: true }
      }
      return placeFail(mapBackgroundError(reply.error, ENGINE_ERROR.SWAP_FAILED))
    }
    console.error('Hisse islemi sonucu alinamadi: gecersiz yanit')
    return placeFail(ENGINE_ERROR.UNKNOWN)
  }

  return Object.freeze({
    id: 'pancake',
    hasApprovalStep: false,
    hasPriceImpactGate: true,
    hasReferenceLock: false,
    hasOrderLifecycle: false,
    showsCowDisclosure: false,

    // BSC USDT/USDC (ikisi de 18 ondalik); iki motor icin ayni tablo.
    payTokens: (chainId) => (chainId === BSTOCKS_CHAIN_ID ? payTokensFor(chainId).map((t) => ({ symbol: t.symbol, address: t.address, decimals: 18 })) : []),

    buildQuoteMessage,
    quote,
    atsPayload,

    // CoW satirlarini (harcama, tahmin, minimum, birim fiyat, referans, fark) ortak yardimcidan al; CoW'a ozgu
    // ucret / ag ucreti / bildirim satirlari bStocks'ta YOKTUR. ATS ve fiyat etkisi satirlari eklenir.
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
    // CoW'a ozgu metin bStocks'ta gorunmez: ag/zaman asimi/sunucu hatalari nötr metne, FORBIDDEN (CoW engeli) genel hataya.
    errorKey: (code) =>
      code === ENGINE_ERROR.NETWORK || code === ENGINE_ERROR.TIMEOUT || code === ENGINE_ERROR.SERVER
        ? 'stockTrade.error.NETWORK_GENERIC'
        : engineErrorKey(code === ENGINE_ERROR.FORBIDDEN ? ENGINE_ERROR.UNKNOWN : code),
  })
}

export const pancakeEngine = createPancakeEngine()

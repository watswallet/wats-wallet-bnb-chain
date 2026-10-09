// ATS SATISI -- arka plan katmani (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §5, §6.2).
//
// YALNIZ background.js'ten cagrilir. Teklif (/sale/quote), cagri listesi (spec §4.3) ve
// yurutme (/sale/sponsor + /paymaster/relay) burada. Arayuzun ihtiyaci olan saf kapilar
// atsSaleRoute.js ve atsSaleView.js'te: bu dosya atsPaymaster.js'i (viem, imza) ice aktarir
// ve arayuz paketine girmemeli.
import { ethers } from 'ethers'
import { GaslessClient, buildBatchCallData } from './sdk/gasless'
import { runSponsoredOp } from './sdk/flow'
import { getAtsSourceConfig } from './atsConfig'
import {
  assertPaymasterAllowed, buildAtsGasParams, confirmUserOp, makeEthersSigner, _resetAtsStatusCache,
} from './atsPaymaster'
import { isDelegatedTo } from './atsFee'
import { clearFuelCaches } from './atsFuel'
import {
  ATS_SALE_CHAIN_ID, ATS_SALE_DESK, ATS_SALE_QUOTE_TTL_SEC, ATS_SALE_REQUOTE_BELOW_SEC, ATS_SALE_SPONSOR,
  ATS_SALE_ZERO_ADDRESS,
} from './atsSaleConfig'

// --- hatalar ---

// Satis hatalari KOD tasir; ekran metne degil koda bakar (atsSaleView.js). `extra` teshis
// alanlarini (detail, cause, txHash, userOpHash) tasir.
export function saleError(code, extra = {}) {
  const err = new Error(code)
  Object.assign(err, extra, { code, saleCode: code })
  return err
}

// Ekrana KENDI cumlesiyle giden kodlar (spec §7). Sponsor retleri (sale-calldata, sale-quote-*,
// sale-balance, gas-cap), istemci kapilari ve bilinmeyen her sey "hazirlanamadi"ya duser --
// ham kod ekrana cikmaz.
const PASS_CODES = new Set([
  'sale-closed', 'amount-too-small', 'amount-too-large', 'stock-insufficient', 'price-unverified',
  'usdc-depeg', 'depth-insufficient', 'rate-limited', 'quote-failed', 'relay-failed', 'result-unknown',
])

export function saleErrorOf(e) {
  const code = (e && (e.saleCode || e.code)) || null
  if (!PASS_CODES.has(code)) return { code: 'prepare-failed' }
  if (code !== 'stock-insufficient') return { code }
  // Stok ipucu sunucunun HATA GOVDESINDE gelir (GaslessError.body).
  const src = (e && e.body) || e
  return {
    code,
    maxAts: src && src.maxAts != null ? String(src.maxAts) : null,
    maxUsd: src && src.maxUsd != null ? String(src.maxUsd) : null,
  }
}

// Arayuze giden hata yaniti. `error` teshis icin ham metin; ekran `saleError.code`a bakar.
// `sale-quote-used` icin `consumed: true` eklenir: o teklifle bir alim zaten yapilmis olabilir,
// ekran sonucu result-unknown gibi ele alir (otomatik requote yok). Ekran kodu "hazirlanamadi" kalir.
export function saleErrorResponse(e) {
  const res = { success: false, error: String((e && e.message) || 'ats-sale-failed'), saleError: saleErrorOf(e) }
  if (e && (e.saleCode || e.code) === 'sale-quote-used') res.consumed = true
  return res
}

// Sponsor teklifi BU TURDA kabul etmiyor ama yenisi verilebilir: `sale-quote-expired` (sunucu yeniden
// basladi ve teklif hafizasi kayboldu ya da teklif bitime cok yakin). Sponsor asamasinda doner:
// hicbir sey imzalanmadi ya da gonderilmedi. Cagiran "< 10 sn kaldi" kuralindaki gibi yeni teklifi
// `requote` olarak dondurur (spec §6.2/1). `sale-quote-used` BURAYA GIRMEZ: o teklifle bir alim
// zaten yapilmis olabilir ve yeni teklif ikinci bir alima kapi acardi.
export const isSaleRequoteError = (e) => !!e && (e.saleCode || e.code) === 'sale-quote-expired'

// --- teklif ---

export function saleGaslessClient() {
  const cfg = getAtsSourceConfig()
  if (!cfg) throw saleError('sale-closed')
  return new GaslessClient({ baseUrl: cfg.backendBase, chainId: ATS_SALE_CHAIN_ID })
}

// Arayuzun insan-okur tutari ("5", "0.05") -> wei. Uc odeme tokeni de 18 ondalik (spec §2.1).
export function parseSaleAmount(amount) {
  let raw
  try {
    raw = ethers.parseUnits(String(amount ?? '').trim(), 18)
  } catch {
    throw saleError('bad-request')
  }
  if (raw <= 0n) throw saleError('bad-request')
  return raw
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/
const SIG65 = /^0x[0-9a-fA-F]{130}$/
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

/**
 * Sunucunun teklifi GERCEKTEN istenen alim mi? Sabitlerle (desk, sponsor) ve istekle (alici,
 * odeme tokeni, tutar) karsilastirilir. Bozuk ya da ele gecirilmis bir sunucu cuzdana BASKA
 * bir harcayiciya ya da BASKA bir tutara izin imzalatamasin: bir alan tutmazsa teklif reddedilir.
 */
export function assertSaleQuote(resp, {
  buyer, payTokenAddress, payAmountRaw, desk = ATS_SALE_DESK, sponsor = ATS_SALE_SPONSOR,
}) {
  const bad = (what) => { throw saleError('sale-quote-mismatch', { detail: what }) }
  const q = resp && resp.quote
  if (!q) bad('quote')
  if (!sameAddress(resp.desk, desk)) bad('desk')
  if (!sameAddress(resp.sponsor, sponsor)) bad('sponsor')
  if (!sameAddress(q.buyer, buyer)) bad('buyer')
  if (!sameAddress(q.payToken, payTokenAddress)) bad('payToken')
  let pay
  let ats
  try {
    pay = BigInt(q.payAmount)
    ats = BigInt(q.atsAmount)
  } catch {
    bad('amount')
  }
  if (pay !== BigInt(payAmountRaw)) bad('payAmount')
  if (ats <= 0n) bad('atsAmount')
  if (!Number.isSafeInteger(Number(q.deadline)) || Number(q.deadline) <= 0) bad('deadline')
  if (!HEX32.test(String(q.quoteId))) bad('quoteId')
  if (!SIG65.test(String(resp.signature))) bad('signature')
  return resp
}

/**
 * /sale/quote + dogrulama. `request` atsSaleRoute.saleRequestFor ciktisidir ({ symbol, quoteAddress }).
 * Sunucunun KODLU hatalari (sale-closed, stock-insufficient + ipucu ...) oldugu gibi gecer;
 * kodsuz hata (ag kopmasi, HTML 5xx) 'quote-failed' olur.
 */
export async function fetchAtsSaleQuote({ client, buyer, request, payAmountRaw }) {
  let resp
  try {
    resp = await client.saleQuote({ buyer, payToken: request.symbol, payAmount: BigInt(payAmountRaw).toString() })
  } catch (e) {
    if (e && e.code) throw e
    throw saleError('quote-failed', { cause: e })
  }
  return assertSaleQuote(resp, { buyer, payTokenAddress: request.quoteAddress, payAmountRaw })
}

// Teklifin KALAN suresi, teklifin ALINDIGI andan olculur. `deadline` (sunucu saati) yerel saatle
// KARSILASTIRILMAZ: istemci saati kayiksa mutlak karsilastirma her teklifi bayat gosterip sonsuz
// bir requote dongusu (ya da tersi, bayat teklifle gonderim) uretirdi. Sunucu deadline'i zaten
// kendisi denetler (deadline >= simdi + 5 sn).
export function quoteMsLeft(receivedAt, nowMs = Date.now()) {
  return ATS_SALE_QUOTE_TTL_SEC * 1000 - (nowMs - Number(receivedAt))
}

/**
 * Yurutmeye gelen teklif HALA kullanilabilir mi (spec §6.2/1)? Degilse arka plan yeni teklif
 * alir ve arayuze `requote` doner. Sebepler: kalan sure 10 sn'den az; tutar/alici/token degisti
 * (ekran yeni miktari 400 ms'lik bekleme bitmeden gondermis olabilir); teklif sabitlerle tutmuyor.
 */
export function saleQuoteUsable(saleQuote, { buyer, payTokenAddress, payAmountRaw }, nowMs = Date.now()) {
  if (!saleQuote || !saleQuote.quote) return false
  try {
    assertSaleQuote(
      { quote: saleQuote.quote, signature: saleQuote.signature, desk: saleQuote.desk, sponsor: saleQuote.sponsor },
      { buyer, payTokenAddress, payAmountRaw },
    )
  } catch {
    return false
  }
  if (!Number.isFinite(Number(saleQuote.receivedAt))) return false
  return quoteMsLeft(saleQuote.receivedAt, nowMs) >= ATS_SALE_REQUOTE_BELOW_SEC * 1000
}

// Toplayici izninin tutari (spec §4.3 satir 4). Sunucu /status'un approve-collector.suggestedAmount
// formuluyle hesaplar; "0" = satir yok. Negatif olmayan TAM SAYI dizesi ve MaxUint256'dan KUCUK
// olmali, degilse "0": toplayici izni ASLA sinirsiz verilmez (sdk/onboarding.ts ile ayni kural).
export function normalizeCollectorApproveAmount(v) {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return '0'
  const n = BigInt(v)
  return n < ethers.MaxUint256 ? n.toString() : '0'
}

const fmt18 = (raw) => ethers.formatUnits(BigInt(raw), 18)

/**
 * Teklifi takas ekraninin BEKLEDIGI bicime esler (spec §6.2) -- TON'un tonSwapQuoteInternal'i
 * ile ayni sozlesme: ekran `expectedOutput`, `exchangeRate`, `priceImpact`,
 * `estimatedGasFee.totalCost` okur. Yanina `saleQuote` eklenir ve yurutmeye AYNEN geri gelir.
 */
export function mapSaleQuote(resp, { receivedAt = Date.now() } = {}) {
  const q = resp.quote
  const out = fmt18(q.atsAmount)
  const pay = Number(fmt18(q.payAmount))
  const rate = pay > 0 ? Number(out) / pay : 0
  const impact = Number(resp.display && resp.display.priceImpactPct)
  return {
    expectedOutput: out,
    exchangeRate: rate.toFixed(6),
    reverseExchangeRate: rate > 0 ? (1 / rate).toFixed(6) : '0',
    // `priceImpactPct` YUZDE birimindedir (commissionPct: 1 ile ayni birim): 0.56 = %0,56.
    priceImpact: Number.isFinite(impact) ? `${impact.toFixed(2)}%` : 'N/A%',
    depthGateWarning: false,
    // Imzali teklif: gelen ATS TAM bu tutardir, kayma yok (spec §1 basari olcutu 2).
    minimumReceived: out,
    slippageTolerance: '0.00%',
    liquidityProviderFee: 'N/A',
    routerType: { name: 'ATS_SALE', version: 1 },
    // Gazi satis sponsoru oder; kullanicidan native alinmaz. Alan ekran sozlesmesi icin var.
    estimatedGasFee: { totalCost: '0', totalCostFormatted: '0', totalCostUSD: null, gasType: 'sponsored' },
    saleQuote: {
      quote: {
        buyer: q.buyer, payToken: q.payToken, payAmount: String(q.payAmount), atsAmount: String(q.atsAmount),
        deadline: Number(q.deadline), quoteId: q.quoteId,
      },
      signature: resp.signature,
      desk: resp.desk,
      sponsor: resp.sponsor,
      collectorApproveAmount: normalizeCollectorApproveAmount(resp.collectorApproveAmount),
      deadline: Number(q.deadline),
      receivedAt,
      display: { ...(resp.display || {}) },
    },
  }
}

// --- cagri listesi (spec §4.3) ---

const ERC20_APPROVE = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)'])
const DESK_IFACE = new ethers.Interface([
  'function buy((address buyer,address payToken,uint256 payAmount,uint256 atsAmount,uint256 deadline,bytes32 quoteId) q, bytes signature) payable',
])

/**
 * Alim op'unun cagrilari -- spec §4.3, KESIN sira (sunucu baska bicimi sponsorlamaz):
 *   1. payToken.approve(desk, payAmount)        yalniz USDT/USDC (BNB'de YOK)
 *   2. desk.buy(q, sig)                         value: BNB'de payAmount, digerlerinde 0
 *   3. ATS.approve(ATSPaymaster, MaxUint256)    needsPaymasterApprove === true (zincirde izin 0; Task 5)
 *   4. ATS.approve(ATSGasCollector, n)          0 < n < MaxUint256 (n = teklifin collectorApproveAmount'u,
 *                                               zincirdeki izin ondan azsa; karar Task 5'te)
 *
 * Izin ODEME TUTARI kadardir, Max degil: buy onu tuketir, islem sonunda USDT/USDC izni sifirdir.
 * Toplayici izni ASLA sinirsiz verilmez (sdk/onboarding.ts ile ayni kural); tutar yoksa satir
 * atlanir -- alim yine olur, ucret kurulumu sonra normal akista tamamlanir.
 */
export function buildSaleCalls({
  quote, signature, desk, needsPaymasterApprove = false, collectorApproveAmount = 0n, ats, paymaster, collector,
}) {
  // Adresler checksum'a NORMALLESTIRILIR: ethers karisik harfli ama checksum'i tutmayan bir adresi
  // ABI kodlamasinda reddeder; teklif adreslerinin yazimi sunucuya bagli kalmaz (kimlik zaten
  // assertSaleQuote'ta buyuk/kucuk harften bagimsiz kiyaslandi).
  const addr = (a) => ethers.getAddress(String(a).toLowerCase())
  const payAmount = BigInt(quote.payAmount)
  const isBnb = String(quote.payToken).toLowerCase() === ATS_SALE_ZERO_ADDRESS
  const deskAddr = addr(desk)
  const calls = []
  if (!isBnb) {
    calls.push({ to: addr(quote.payToken), value: 0n, data: ERC20_APPROVE.encodeFunctionData('approve', [deskAddr, payAmount]) })
  }
  calls.push({
    to: deskAddr,
    value: isBnb ? payAmount : 0n,
    data: DESK_IFACE.encodeFunctionData('buy', [{
      buyer: addr(quote.buyer),
      payToken: addr(quote.payToken),
      payAmount,
      atsAmount: BigInt(quote.atsAmount),
      deadline: BigInt(quote.deadline),
      quoteId: quote.quoteId,
    }, signature]),
  })
  if (needsPaymasterApprove === true) {
    calls.push({ to: ats, value: 0n, data: ERC20_APPROVE.encodeFunctionData('approve', [paymaster, ethers.MaxUint256]) })
  }
  const n = typeof collectorApproveAmount === 'bigint' ? collectorApproveAmount : 0n
  if (n > 0n && n < ethers.MaxUint256) {
    calls.push({ to: ats, value: 0n, data: ERC20_APPROVE.encodeFunctionData('approve', [collector, n]) })
  }
  return calls
}

// --- yurutme (spec §6.2/2-5) ---
//
// executeAtsTransfer / sendOneOp KULLANILMAZ: ikisi de /status.ready false iken hata atiyor --
// oysa satin alanin tam da ATS'si (cogu zaman BNB'si de) YOKTUR. Yalniz cekirdek kullanilir
// (runSponsoredOp: sira /sponsor -> birlestir -> yerel userOpHash -> imza -> /relay).

const ENTRY_POINT_ABI = ['function getNonce(address sender, uint192 key) view returns (uint256)']
const ATS_ALLOWANCE_ABI = ['function allowance(address owner, address spender) view returns (uint256)']

/**
 * runSponsoredOp'un bekledigi istemci, satis uclarina bagli. `quote` AG CAGRISI YAPMAZ:
 * satista ATS ucreti yok (spec §6.2/4). runSponsoredOp donen nesneden yalniz `quoteId` ve
 * `feeAuth`a bakar, ikisi de yok -- /sale/sponsor kilitsiz ve ucret yetkisiz gider.
 */
export function saleClientFor(gc) {
  return {
    quote: async () => ({ atsFee: '0', atsFeeFormatted: '0', validUntil: 0, note: 'ats-sale: ATS ucreti yok' }),
    sponsor: (req) => gc.saleSponsor(req),
    relay: (userOp, authorization) => gc.relay(userOp, authorization),
  }
}

/**
 * Sponsor yanitinin BU teklife ait oldugunu ve kullanicidan UCRET ALMADIGINI dogrular -- op
 * imzalanmadan ve relay'e gitmeden ONCE (runSponsoredOp onSponsored'i imzadan once cagirir).
 * Izinli TEK paymaster satis sponsorudur; ATS_CHAINS[56]'ya EKLENMEZ (spec §6.1). Komisyon
 * denetimi yapilmaz: satis op'una komisyon cagrisi girmez.
 */
export function assertSaleSponsorResult(res, { quoteId, sponsor = ATS_SALE_SPONSOR }) {
  assertPaymasterAllowed({
    sponsorPaymaster: res && res.paymaster,
    paymasterAndDataPrefix: res && res.paymasterAndDataPrefix,
    allowed: [sponsor],
  })
  if (res.mode != null && res.mode !== 'sale') throw saleError('sale-sponsor-mismatch', { detail: 'mode' })
  let fee
  try {
    fee = BigInt(res.atsFee ?? '0')
  } catch {
    fee = -1n
  }
  if (fee !== 0n) throw saleError('sale-sponsor-mismatch', { detail: 'atsFee' })
  if (res.settlementId != null && String(res.settlementId).toLowerCase() !== String(quoteId).toLowerCase()) {
    throw saleError('sale-sponsor-mismatch', { detail: 'settlementId' })
  }
}

// Alimdan sonra (spec §6.2/5): /status onbellegi (30 sn) ve yakit onbellekleri BAYAT. Ekran ana
// sayfaya donunce yakit hapi zincirden tazeler.
export async function resetSaleCaches() {
  _resetAtsStatusCache()
  await clearFuelCaches()
}

/**
 * Alimi yurutur. Teklifin TAZELIGI cagiranin karari (background: saleQuoteUsable -> requote).
 *
 * Hata kodlari (saleErrorOf ile ekrana):
 *   sunucu kodlari / 'sale-*' istemci kapilari -> ekranda "hazirlanamadi" (rate-limited haric)
 *   'relay-failed'   relay YANIT VERDI ama islem gerceklesmedi (HTTP hatasi, tx revert, op
 *                    success=false). Islem atomik: odeme de ATS de yer degistirmedi.
 *   'result-unknown' relay'e gidildi ama yanit ya da makbuz yok: alim GERCEKLESMIS olabilir.
 * Sponsorun teklif retleri (relay'den ONCE, hicbir sey imzalanmadi):
 *   'sale-quote-expired' OLDUGU GIBI cikar -- cagiran yeni teklifi `requote` olarak dondurur.
 *   'sale-quote-used'    ekranda "hazirlanamadi"; bakiye ve yakit onbellekleri tazelenir.
 */
export async function executeAtsSale({ privateKey, rpcUrl, saleQuote, onRelayed, client, provider }) {
  const cfg = getAtsSourceConfig()
  if (!cfg) throw saleError('sale-closed')
  const gc = client || saleGaslessClient()
  const prov = provider || new ethers.JsonRpcProvider(rpcUrl)
  const wallet = new ethers.Wallet(privateKey)
  const address = wallet.address
  const { quote, signature, desk } = saleQuote
  if (!sameAddress(quote.buyer, address)) throw saleError('sale-quote-mismatch', { detail: 'buyer' })

  // 7702 delegasyonu ZINCIR BASINA ve zincirden okunur (runAtsOnboarding ile ayni). Bizim
  // delegemiz DISINDA bir kod varsa sunucu reddeder; imza atmadan once dur.
  const code = await prov.getCode(address)
  const delegated = isDelegatedTo(code, cfg.delegate)
  if (!delegated && code && code !== '0x') throw saleError('sale-foreign-delegation')

  // ISTEGE BAGLI ATS IZINLERI (spec §4.3 satir 3-4) ZINCIRDEN okunur, /status'tan DEGIL: ATS'si hic
  // olmayan hesapta /status `balance-missing` ile BOS nextSteps doner ve ilk alici izinleri hic
  // alamazdi. Paymaster izni zincirde 0 ise Max; toplayici izni teklifin collectorApproveAmount'undan
  // azsa o tutar. Okunamayan iznin satiri EKLENMEZ: alim yine yurur, ucret kurulumu sonra normal
  // akista tamamlanir.
  const atsToken = new ethers.Contract(cfg.token.address, ATS_ALLOWANCE_ABI, prov)
  const izinOku = async (spender) => {
    try {
      return await atsToken.allowance(address, spender)
    } catch (e) {
      console.warn('[ats-sale] ATS izni okunamadi; bu izin bu islemde verilmeyecek:', e && e.message)
      return null
    }
  }
  const [paymasterIzni, toplayiciIzni] = await Promise.all([izinOku(cfg.paymaster), izinOku(cfg.collector)])
  const toplayiciTutari = BigInt(normalizeCollectorApproveAmount(saleQuote.collectorApproveAmount))

  const calls = buildSaleCalls({
    quote, signature, desk,
    needsPaymasterApprove: paymasterIzni === 0n,
    collectorApproveAmount: toplayiciIzni !== null && toplayiciIzni < toplayiciTutari ? toplayiciTutari : 0n,
    ats: cfg.token.address, paymaster: cfg.paymaster, collector: cfg.collector,
  })
  // HER ZAMAN executeBatch (spec §4.3) -- tek cagrili BNB alimi DAHIL. buildOpCallData tek
  // cagriyi `execute`e sarardi ve sunucunun bicim kapisi (sale-calldata) onu reddederdi.
  const callData = buildBatchCallData(calls)
  const { gas, maxPriorityFeePerGas } = await buildAtsGasParams({
    provider: prov, from: address, calls,
    // Satis sponsoru ATSRemotePaymaster kodudur: postOp YOK. `crosschain` bayragi buildGasParams'ta
    // tam olarak bunu yapar (paymasterPostOpGasLimit = 0) ve maxCost'u sponsorun gaz tavaninin
    // (3e14 wei) altinda tutar. Tahsilat yoluyla ilgisi yok: satista ATS tahsilati yok.
    crosschain: true,
  })
  const nonce = await new ethers.Contract(cfg.entryPoint, ENTRY_POINT_ABI, prov).getNonce(address, 0)
  // 'pending' SART (sendOneOp ile ayni gerekce): yetkinin nonce'u, type-4 islemin uygulandigi
  // andaki hesap nonce'una esit olmali.
  const txCount = delegated ? undefined : await prov.getTransactionCount(address, 'pending')

  let sponsored = false
  try {
    const r = await runSponsoredOp({
      client: saleClientFor(gc),
      chainId: ATS_SALE_CHAIN_ID,
      signer: makeEthersSigner({ wallet, privateKey }),
      callData, nonce, gas, maxPriorityFeePerGas, delegated, txCount,
      onSponsored: (res) => {
        assertSaleSponsorResult(res, { quoteId: quote.quoteId })
        sponsored = true
      },
    })
    if (onRelayed) {
      try { onRelayed({ txHash: r.txHash }) } catch { /* best-effort */ }
    }
    let success
    try {
      success = await confirmUserOp({ provider: prov, cfg, txHash: r.txHash, userOpHash: r.userOpHash })
    } catch (e) {
      throw saleError('result-unknown', { cause: e, txHash: r.txHash, userOpHash: r.userOpHash })
    }
    if (success === false) throw saleError('relay-failed', { txHash: r.txHash, userOpHash: r.userOpHash })
    if (success !== true) throw saleError('result-unknown', { txHash: r.txHash, userOpHash: r.userOpHash })
    return { userOpHash: r.userOpHash, txHash: r.txHash }
  } catch (e) {
    if (e && e.saleCode) throw e
    // SPONSORUN TEKLIF RETLERI (relay'den once; hicbir sey imzalanmadi ya da gonderilmedi):
    //   sale-quote-expired -> kod OLDUGU GIBI cikar; cagiran (background) "< 10 sn kaldi" kuralindaki
    //                         gibi yeni teklifi `requote` olarak dondurur (isSaleRequoteError).
    //   sale-quote-used    -> ekranda "hazirlanamadi" kalir (spec §7) ama bu teklifle bir alim zaten
    //                         yapilmis olabilir: bakiye ve yakit onbellekleri tazelenir ki gorunsun.
    if (e && e.code === 'sale-quote-used') await resetSaleCaches()
    if (e && e.userOpHash) {
      // Relay'e gidildi. relay-failed ("hicbir sey yurumedi, odeme cekilmedi") YALNIZ txHash'li
      // hata (tx zincirde revert etti) ya da HTTP 4xx (400-499: sunucu istegi reddetti, op
      // yayinlanmadi) icin. HTTP 5xx, diger her durum ve ag hatasi (status yok) result-unknown:
      // 5xx op yayinlandiktan SONRA da gelebilir; "paran cekilmedi" demek yanlis olur ve ikinci
      // alima davet eder.
      const answered = !!e.txHash || (typeof e.status === 'number' && e.status >= 400 && e.status < 500)
      throw saleError(answered ? 'relay-failed' : 'result-unknown', { cause: e, txHash: e.txHash, userOpHash: e.userOpHash })
    }
    throw e
  } finally {
    if (sponsored) await resetSaleCaches()
  }
}
